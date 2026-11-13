/**
 * The JavaSE skill screen's pool ("BỂ CHIÊU", `skill.ui`): what `VqsvGameRuntime` reads from
 * `UnifiedSkillLearnsetCatalog` for the selected pet, baked per species by
 * `rebuild_game/tools/ExportWebSkillPools.java` into `public/pack/story/pet-skill-pools.json`.
 */

/** `[runtimeSkillId, unlockLevel, relation, grantName]`; relation "a" ancestor, "d" descendant. */
export type PoolEntry = readonly [number, number, "a" | "d" | "o", string];
export type PetSkillPoolDocument = {
  pools: Record<string, PoolEntry[]>;
  canonical: Record<string, number>;
  /** `distance[main][fodder]`: `evolutionDistance(petKey(fodder), petKey(main))`. */
  distance?: Record<string, Record<string, number>>;
  /** Species whose `releaseProtected()` keeps them out of Nâng phẩm. */
  protected?: number[];
};

/** `sourceSkillStateAt`: 0 in use, 1 open, 2 level locked, 3 evolution locked, 4 other branch. */
export type SkillState = 0 | 1 | 2 | 3 | 4;

export class PetSkillPoolCatalog {
  constructor(private readonly document: PetSkillPoolDocument = { pools: {}, canonical: {} }) {}

  /** `sourceSkillPoolEntries`: the family pool of the pet's species. */
  entries(speciesId: number): readonly PoolEntry[] {
    return this.document.pools[String(speciesId)] ?? [];
  }
  /** `PetQualityUpgradeService.formDistance`: 0 for the same species, -1 when unrelated. */
  formDistance(mainSpecies: number, fodderSpecies: number): number {
    if (mainSpecies === fodderSpecies) return 0;
    return this.document.distance?.[String(mainSpecies)]?.[String(fodderSpecies)] ?? -1;
  }
  /** `sourceReleaseProtectedPet`. */
  releaseProtected(speciesId: number): boolean {
    return this.document.protected?.includes(speciesId) ?? false;
  }
  /** `PetDesignSkillCatalog.sameSkill`. */
  sameSkill(a: number, b: number): boolean {
    return this.canonical(a) === this.canonical(b);
  }
  private canonical(id: number): number {
    return this.document.canonical[String(id)] ?? id;
  }

  /** `sourceSkillStateAt(index, poolTab = true)`. */
  poolState(entry: PoolEntry, skills: readonly number[], level: number): SkillState {
    const [id, unlock, relation] = entry;
    if (id < 0) return 4;
    if (skills.some((skill) => skill >= 0 && this.sameSkill(skill, id))) return 0;
    if (relation === "a") return unlock <= level ? 1 : 2;
    return relation === "d" ? 3 : 4;
  }
  /** `sourceSkillPoolUnlockedCount`. */
  unlockedCount(speciesId: number, skills: readonly number[], level: number): number {
    return this.entries(speciesId).filter((entry) => this.poolState(entry, skills, level) <= 1)
      .length;
  }
  /** `UnifiedSkillLearnsetCatalog.evolutionUnlockedCandidateIds`. */
  evolutionCandidates(
    fromSpecies: number,
    toSpecies: number,
    level: number,
    known: readonly number[],
  ): number[] {
    const before = new Set(
      this.entries(fromSpecies)
        .filter((entry) => entry[2] === "a" && entry[1] <= level)
        .map((entry) => entry[0]),
    );
    const knownIds = new Set(known.filter((id) => id >= 0));
    const result: number[] = [];
    for (const entry of this.entries(toSpecies)) {
      const id = entry[0];
      if (
        entry[2] === "a" &&
        entry[1] <= level &&
        !before.has(id) &&
        !knownIds.has(id) &&
        !result.includes(id)
      )
        result.push(id);
    }
    return result;
  }
}

/** `sourceSkillStatusAt`. */
export function skillStatus(state: SkillState, pool: boolean, entry?: PoolEntry): string {
  if (state === 0) return "Đang dùng";
  if (state === 1) return pool ? "Có thể học lại" : "Đã mở";
  if (state === 2) return entry ? `Mở Lv.${entry[1]}` : "Chưa mở";
  if (state === 3) return entry ? `Cần ${entry[3]}` : "Cần tiến hóa";
  return "Khác nhánh";
}
/** `sourceSkillRowStatusAt`. */
export function skillRowStatus(state: SkillState, pool: boolean, entry?: PoolEntry): string {
  return state === 3 ? "Khóa tiến hóa" : skillStatus(state, pool, entry);
}
/** `sourceSkillStateColor`. */
export function skillStateColor(state: SkillState): number {
  return [1410141, 1472666, 11889441, 7754138][state] ?? 6845562;
}
/** `sourceSkillElementName`. */
export function skillElementName(element: number): string {
  return ["Hỏa", "Mộc", "Thổ", "Thủy", "Điện", "Quỷ", "Phong"][element] ?? "Không";
}
