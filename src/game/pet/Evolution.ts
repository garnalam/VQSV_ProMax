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

export function applyEvolution(pet: SavedPet, rule: EvolutionRule, services: BattleServices): void {
  const oldSkills = [...(pet.skillIds ?? [])],
    target = services.partyMember({ ...pet, speciesId: rule.toSpecies }),
    maxHp = target.stats.hp;
  pet.speciesId = rule.toSpecies;
  pet.quality = evolvedQuality(pet.quality, target.quality ?? pet.quality);
  pet.visualSpriteId = target.spriteId;
  pet.maxHp = maxHp;
  pet.currentHp = Math.max(1, maxHp);
  // The baked family pool is the inheritance boundary used by Java. Preserve an existing deck;
  // evolution-learn candidates are handled by the learn queue after the effect.
  pet.skillIds = oldSkills;
  pet.skillPp = services.progression.fullPp(oldSkills);
}
