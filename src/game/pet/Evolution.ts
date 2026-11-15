import type { PackEvolution } from "../../data/GameData";
import type { SavedPet } from "../../persistence/save/GameSave";
import type { BattleServices } from "../battle/engine/BattleServices";

export type EvolutionKind = "evolution" | "mutation";
export type EvolutionIngredient = {
  materialId: number;
  itemKey: string;
  name: string;
  quantity: number;
};
export type EvolutionRule = {
  key: string;
  kind: EvolutionKind;
  fromSpecies: number;
  toSpecies: number;
  requiredLevel: number;
  requiredQuality: number;
  ingredients: EvolutionIngredient[];
};

const kindOf = (kind: string): EvolutionKind =>
  kind.endsWith("MUTATION") ? "mutation" : "evolution";

/**
 * `public/pack/story/pet-evolutions.json`, baked by `rebuild_game/tools/ExportWebPetEvolutionText.java`
 * from the JavaSE code itself: every branch `noticeForSpecies` can open (the unified catalog plus the
 * V4 and hand-authored ones the plain `battle/evolutions.json` lacks), the Pet State "Hóa" text
 * (`VqsvBattlePetStateView.evolutionText`) and the `petsetting.ui` label per species.
 */
export type PetEvolutionsDocument = {
  schema: "vqsv-pet-evolution-text-v1";
  text: Record<string, string>;
  label: Record<string, string>;
  rules: {
    key: string;
    kind: string;
    from: number;
    to: number;
    requiredLevel: number;
    requiredQuality: number;
    /** `[materialId, itemKey, name, quantity]`. */
    ingredients: [number, string, string, number][];
  }[];
};

/** Web contract for `VqsvSourceEvolutionRuntime.noticeForSpecies`. */
export class EvolutionCatalog {
  private readonly bySpecies = new Map<number, EvolutionRule[]>();
  /**
   * `rows` is the unified catalog (`battle/evolutions.json`); `baked`, when present, is the whole
   * JavaSE set and replaces it, with the Hóa text and the menu label JavaSE shows.
   */
  constructor(
    rows: readonly PackEvolution[],
    private readonly baked?: PetEvolutionsDocument,
  ) {
    if (baked) {
      for (const row of baked.rules) {
        const rule: EvolutionRule = {
          key: row.key,
          kind: kindOf(row.kind),
          fromSpecies: row.from,
          toSpecies: row.to,
          requiredLevel: row.requiredLevel,
          requiredQuality: row.requiredQuality,
          ingredients: row.ingredients.map(([materialId, itemKey, name, quantity]) => ({
            materialId,
            itemKey,
            name,
            quantity,
          })),
        };
        this.bySpecies.set(rule.fromSpecies, [
          ...(this.bySpecies.get(rule.fromSpecies) ?? []),
          rule,
        ]);
      }
      return;
    }
    for (const row of rows) {
      const kind = kindOf(row.kind),
        rule: EvolutionRule = {
          key: row.stableKey,
          kind,
          fromSpecies: row.fromSpeciesId,
          toSpecies: row.toSpeciesId,
          requiredLevel: row.requiredLevel,
          requiredQuality: kind === "mutation" ? 3 : 1,
          ingredients: row.ingredients.map((ingredient) => ({
            materialId: ingredient.runtimeMaterialId,
            itemKey: ingredient.itemKey,
            name: ingredient.name,
            quantity: ingredient.quantity,
          })),
        };
      this.bySpecies.set(rule.fromSpecies, [...(this.bySpecies.get(rule.fromSpecies) ?? []), rule]);
    }
  }
  rules(species: number): readonly EvolutionRule[] {
    return this.bySpecies.get(species) ?? [];
  }
  /** Every earlier form that evolves or mutates, directly or in steps, into `species`. */
  ancestors(species: number): Set<number> {
    const found = new Set<number>(),
      queue = [species];
    while (queue.length) {
      const target = queue.pop()!;
      for (const [from, rows] of this.bySpecies)
        if (!found.has(from) && from !== species && rows.some((row) => row.toSpecies === target)) {
          found.add(from);
          queue.push(from);
        }
    }
    return found;
  }
  /**
   * Forms from `fodder` up to `main` along the evolution rules (0 the same species, -1 when
   * `fodder` is not an earlier form of `main`). Web-only: JavaSE's quality-upgrade distance table
   * leaves out the special forms (4 → 277, 23 → 274, 28 → 279, 34 → 275, 64 → 276).
   */
  formDistance(main: number, fodder: number): number {
    let level = [main],
      seen = new Set(level);
    for (let distance = 0; level.length; distance++) {
      if (level.includes(fodder)) return distance;
      const next: number[] = [];
      for (const target of level)
        for (const [from, rows] of this.bySpecies)
          if (!seen.has(from) && rows.some((row) => row.toSpecies === target)) {
            seen.add(from);
            next.push(from);
          }
      level = next;
    }
    return -1;
  }
  /**
   * `noticeForSpecies(id, level, null)`: the branch the menu row opens. With the baked label the
   * kind is JavaSE's own choice; otherwise the normal branch first, then the first remaining one.
   */
  notice(species: number): EvolutionRule | undefined {
    const rows = this.rules(species),
      label = this.baked?.label[String(species)],
      kind: EvolutionKind | undefined =
        label === undefined ? undefined : label === "Dị hoá" ? "mutation" : "evolution";
    if (this.baked && label === undefined) return undefined;
    return rows.find((row) => row.kind === (kind ?? "evolution")) ?? (kind ? undefined : rows[0]);
  }
  /** `sourcePetSettingEvolutionLabel`: "Tiến hóa", "Dị hoá", or no row. */
  label(species: number): string | null {
    if (this.baked) return this.baked.label[String(species)] ?? null;
    const rule = this.notice(species);
    return rule ? (rule.kind === "mutation" ? "Dị hoá" : "Tiến hóa") : null;
  }
  /**
   * `VqsvBattlePetStateView.evolutionText`: every outgoing branch ("Tiến hóa > A / Dị hóa > B"),
   * "" for a final form, "Chưa xác định" for a species JavaSE does not know.
   */
  text(species: number): string {
    return this.baked?.text[String(species)] ?? "Chưa xác định";
  }
}

export const evolutionMaterialCount = (materials: Record<string, number>, id: number): number =>
  (materials[String(id)] ?? 0) + (materials[String(2000 + id)] ?? 0);

export function consumeEvolutionMaterials(
  materials: Record<string, number>,
  ingredients: readonly EvolutionIngredient[],
): boolean {
  const required = new Map<number, number>();
  for (const ingredient of ingredients)
    required.set(
      ingredient.materialId,
      (required.get(ingredient.materialId) ?? 0) + ingredient.quantity,
    );
  for (const [id, count] of required)
    if (evolutionMaterialCount(materials, id) < count) return false;
  for (const [id, count] of required) {
    const encoded = String(2000 + id),
      encodedUse = Math.min(count, materials[encoded] ?? 0),
      plain = String(id);
    if (encodedUse) materials[encoded] = (materials[encoded] ?? 0) - encodedUse;
    if (count > encodedUse) materials[plain] = (materials[plain] ?? 0) - (count - encodedUse);
  }
  return true;
}

/** `EvolutionProgression.evolvedQuality`. */
export const evolvedQuality = (current: number, targetDefault: number): number =>
  Math.max(current >= 1 && current <= 5 ? current : 1, Math.min(3, Math.max(1, targetDefault)));

/**
 * `UnifiedSkillLearnsetCatalog.inheritsSkills`: the two scripted mutations (Liệt Hỏa's 274 from
 * 23, Thiên Luân's 275 from 34) start over on their own deck; every other edge keeps the old one.
 */
const NON_INHERITING_TARGETS = new Set([274, 275]);

/**
 * The pet `target` becomes, as `VqsvSourceEvolutionRuntime.mutatePet` builds it: the target
 * species at `evolvedQuality(current, target's default)`, with the target species' own sprite —
 * never the old form's `visualSpriteId`, which `partyMember` would otherwise prefer.
 */
export function evolvedForm(pet: SavedPet, toSpecies: number, services: BattleServices) {
  const quality = evolvedQuality(pet.quality, services.petStats.defaultQuality(toSpecies));
  return services.partyMember({
    ...pet,
    speciesId: toSpecies,
    quality,
    visualSpriteId: undefined,
    currentHp: undefined,
    maxHp: undefined,
  });
}

/** `mutatePet` → `EvolutionProgression.apply`: species, stars, sprite, full HP and the deck. */
export function applyEvolution(pet: SavedPet, rule: EvolutionRule, services: BattleServices): void {
  const target = evolvedForm(pet, rule.toSpecies, services),
    maxHp = target.stats.hp;
  pet.speciesId = rule.toSpecies;
  pet.quality = target.quality;
  pet.visualSpriteId = target.spriteId;
  pet.maxHp = maxHp;
  pet.currentHp = Math.max(1, maxHp);
  // The family pool is the inheritance boundary used by Java: an inheriting edge keeps the deck
  // (evolution-learn candidates come from the learn queue after the effect), a non-inheriting one
  // is dealt the new form's starting deck (`PetSourceAdapter.resetLearnsetDeck`).
  const skills = NON_INHERITING_TARGETS.has(rule.toSpecies)
    ? services.progression.initialSkills(rule.toSpecies, pet.level)
    : [...(pet.skillIds ?? [])];
  pet.skillIds = skills;
  pet.skillPp = services.progression.fullPp(skills);
}

/**
 * Pets evolved before `applyEvolution` resolved the target's sprite kept their first form's
 * `visualSpriteId`: one that is an earlier form's sprite goes back to the species' own.
 */
export function repairEvolvedSprite(
  pet: SavedPet,
  catalog: EvolutionCatalog,
  spriteOf: (speciesId: number) => number | undefined,
): boolean {
  if (pet.visualSpriteId === undefined) return false;
  const own = spriteOf(pet.speciesId);
  if (own === undefined || own === pet.visualSpriteId) return false;
  for (const ancestor of catalog.ancestors(pet.speciesId))
    if (spriteOf(ancestor) === pet.visualSpriteId) {
      pet.visualSpriteId = own;
      return true;
    }
  return false;
}
