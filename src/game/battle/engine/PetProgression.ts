import type { PackLearnsetEntry } from "../../../data/GameData";
import type { SavedPet } from "../../../persistence/save/GameSave";
import { applyTowerBond, towerBondStat } from "../../meta/BondingTower";
import type { PetStatCalculator } from "../PetStatCalculator";

/** `PetLevel.MAX`. */
export const MAX_PET_LEVEL = 100;
/** A pet carries at most this many skills. */
export const SKILL_SLOTS = 5;

/**
 * `PetLevel.requiredExp`: the EXP it takes to reach `level` from the one before. "Preserve every old
 * threshold through 50, then extend the same quadratic curve."
 */
export function requiredExp(level: number): number {
  const clamped = Math.max(1, Math.min(MAX_PET_LEVEL, level));
  return Math.max(1, 15 * clamped * clamped - 200);
}

export type LevelUpResult = {
  levelsGained: number;
  /** HP, Công, Phòng, Mẫn before the first level and after the last (only when a level was gained). */
  statsBefore?: [number, number, number, number];
  statsAfter?: [number, number, number, number];
  /** Skills the pet learned into a free slot. */
  learned: number[];
  /** Skills it could learn but had no free slot for: the player decides later. */
  pending: number[];
  /**
   * Each individual level crossed, in presentation order. The save is committed in one operation,
   * but JavaSE presents EXP -> one level card -> skills -> the next EXP threshold, so the battle
   * runtime needs the non-collapsed stat and learn results.
   */
  steps: LevelUpStep[];
};

export type LevelUpStep = {
  level: number;
  statsBefore: [number, number, number, number];
  statsAfter: [number, number, number, number];
  learned: number[];
  pending: number[];
};

/**
 * Levels, skills and stats as the save keeps them. One instance per session: it reads the growth
 * table (`PetStatCalculator`), the learnsets and the PP of every skill row.
 */
export class PetProgression {
  constructor(
    private readonly petStats: PetStatCalculator,
    private readonly learnsets: Readonly<Record<string, readonly PackLearnsetEntry[]>>,
    /** speciesId → the petKey its learnset is filed under. */
    private readonly petKeys: ReadonlyMap<number, string>,
    private readonly ppMax: (skillId: number) => number,
    /**
     * `battle/skill-initial-pools.json`: per petKey, the [skill, unlock level] rows Java deals a new
     * pet's deck from (the pet-design catalog when it lists the pet). Without it the learnset is used.
     */
    private readonly initialPools?: Readonly<
      Record<string, readonly (readonly [number, number])[]>
    >,
  ) {}

  /** The skills a species has unlocked by `level`, in the order it learns them. */
  unlocked(speciesId: number, level: number): number[] {
    const key = this.petKeys.get(speciesId);
    return (key ? (this.learnsets[key] ?? []) : [])
      .filter((entry) => entry.unlockLevel <= level)
      .sort((a, b) => a.unlockLevel - b.unlockLevel || a.sortOrder - b.sortOrder)
      .map((entry) => entry.runtimeSkillId)
      .filter((id, index, all) => all.indexOf(id) === index);
  }

  /**
   * `UnifiedSkillLearnsetCatalog.initialSkillIds`: the deterministic deck of every newly created
   * owned, wild or trainer pet. Java walks the pet-design pool when that catalog lists the pet (every
   * accessible row otherwise), keeps the rows unlocked by `level` in pool order, falls back to the
   * pool's first row when none is, and keeps the first five distinct ids. Explicit opcode skill
   * arguments are only the source-v1 fallback and do not win under unified-v5.
   */
  initialSkills(speciesId: number, level: number): number[] {
    const key = this.petKeys.get(speciesId),
      pool = key ? this.initialPools?.[key] : undefined;
    if (!pool) return this.unlocked(speciesId, level).slice(0, SKILL_SLOTS);
    const unlocked = pool.filter(([, unlock]) => unlock <= level).map(([id]) => id);
    if (unlocked.length === 0 && pool.length > 0) unlocked.push(pool[0][0]);
    return unlocked.filter((id, index, all) => all.indexOf(id) === index).slice(0, SKILL_SLOTS);
  }

  /** Backwards-compatible name for callers that ask for a newly created pet's deck. */
  defaultSkills(speciesId: number, level: number): number[] {
    return this.initialSkills(speciesId, level);
  }

  /** Full PP for an ordered skill loadout, used when an old save has no matching PP vector. */
  fullPp(skillIds: readonly number[]): number[] {
    return skillIds.map((id) => this.ppMax(id));
  }

  /**
   * `BattleUnit.addSourceExp` + `sourceLevelUpOnce`, applied to the save: EXP is added, and each
   * time it reaches the next level's threshold the pet levels up — the threshold is spent, the stats
   * are recomputed for the new level, HP and PP are refilled, and every skill unlocked at the new
   * level is learned into a free slot (or left pending when all five are taken). Level 100 keeps no
   * EXP.
   */
  addExperience(pet: SavedPet, amount: number): LevelUpResult {
    const result: LevelUpResult = { levelsGained: 0, learned: [], pending: [], steps: [] };
    if (pet.level >= MAX_PET_LEVEL || amount <= 0) return result;
    pet.experience = (pet.experience ?? 0) + amount;
    const statLine = (level: number): [number, number, number, number] => {
      const stats = applyTowerBond(
        this.petStats.coreStats(pet.speciesId, level, pet.quality, pet.nature ?? 0),
        pet.towerBond,
      );
      return [stats.hp, stats.attack, stats.defense, stats.speed];
    };
    const levelBefore = pet.level;
    while (pet.level < MAX_PET_LEVEL && pet.experience >= requiredExp(pet.level + 1)) {
      const before = pet.level;
      const step: LevelUpStep = {
        level: before + 1,
        statsBefore: statLine(before),
        statsAfter: [0, 0, 0, 0],
        learned: [],
        pending: [],
      };
      pet.level++;
      pet.experience -= requiredExp(pet.level);
      result.levelsGained++;
      const [hp] = statLine(pet.level);
      pet.maxHp = hp;
      pet.currentHp = hp;
      const ids = (pet.skillIds ??= []);
      for (const id of this.unlocked(pet.speciesId, pet.level)) {
        if (ids.includes(id) || this.unlocked(pet.speciesId, before).includes(id)) continue;
        if (ids.length < SKILL_SLOTS) {
          ids.push(id);
          result.learned.push(id);
          step.learned.push(id);
        } else {
          result.pending.push(id);
          step.pending.push(id);
        }
      }
      pet.skillPp = ids.map((id) => this.ppMax(id));
      step.statsAfter = statLine(pet.level);
      result.steps.push(step);
    }
    if (pet.level >= MAX_PET_LEVEL) pet.experience = 0;
    if (result.levelsGained > 0) {
      result.statsBefore = statLine(levelBefore);
      result.statsAfter = statLine(pet.level);
    }
    return result;
  }

  /** A full heal: HP to the maximum for its level and every slot's PP to its skill's maximum. */
  restore(pet: SavedPet): void {
    pet.maxHp = towerBondStat(
      this.petStats.coreStats(pet.speciesId, pet.level, pet.quality, pet.nature ?? 0).hp,
      pet.towerBond,
    );
    pet.currentHp = pet.maxHp;
    pet.skillPp = (pet.skillIds ?? []).map((id) => this.ppMax(id));
  }
}
