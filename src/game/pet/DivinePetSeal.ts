// JavaSE parity: `vqsv.pet.DivinePetSeal` (user design 2026-10-25, commit e6fd0ad "Gate owned Divine
// pet stats behind North Sea golden title"). An owned Divine pet's HP, strength, defense and agility
// are 30% of its baseline until the North Sea's three finals are won (98:30:124, or all of
// 98:30:121..123), then 120%. Opponents and companions keep 100%. The percent is derived from story
// progress and never multiplied into saved stats; HP keeps its fraction when it changes.
//
// The Divine species (the roster csv's 14 keys and the V4 profiles classified divine, 19 in all) and
// the two percents are baked by rebuild_game/tools/WebCauVongNorthSea.java into north-sea.json.
//
// Order against Java: Java scales after `PetTraitPermanentStatResolver.project` and the evolution floor
// (`BattleUnit.projectProductionPermanentTraitStats`); the web scales the core stats (evolution floor
// included) that `BattleServices.partyMember` seats, and the talent's ±8% lands on them at entry
// (`DesignTraitProjection.applyPermanentStatsOnce`). The two orders agree up to a point of rounding.
import type { PetCoreStats } from "../battle/PetStatCalculator";
import type { SavedPet } from "../../persistence/save/GameSave";
import { towerBondStat } from "../meta/BondingTower";

export type DivineSealDocument = { species: number[]; sealed: number; released: number };

const SCENE = 98;
const FINAL_ROOM = 30;
const COMPLETE = 124;
const ROUNDS = [121, 122, 123];
const SHORT_MAX = 32767;

export class DivinePetSeal {
  private readonly divine: ReadonlySet<number>;

  constructor(private readonly doc: DivineSealDocument) {
    this.divine = new Set(doc.species);
  }

  isDivine(speciesId: number): boolean {
    return this.divine.has(speciesId);
  }

  /** `released(session)`: 98:30:124, or all three victory receipts. */
  released(done: (scene: number, room: number, event: number) => boolean): boolean {
    return (
      done(SCENE, FINAL_ROOM, COMPLETE) || ROUNDS.every((event) => done(SCENE, FINAL_ROOM, event))
    );
  }

  /** An owned pet's percent: Divine ones 30 or 120 by the title, the rest 100. */
  percent(speciesId: number, released: boolean): number {
    if (!this.isDivine(speciesId)) return 100;
    return released ? this.doc.released : this.doc.sealed;
  }

  /** `scale(value, percent)`: floored, kept in [1, Short.MAX_VALUE]. */
  static scale(value: number, percent: number): number {
    if (percent !== 30 && percent !== 100 && percent !== 120)
      throw new Error(`Invalid Divine stat percent ${percent}`);
    return Math.max(1, Math.min(SHORT_MAX, Math.floor((value * percent) / 100)));
  }

  static scaleStats(stats: PetCoreStats, percent: number): PetCoreStats {
    if (percent === 100) return stats;
    return {
      hp: DivinePetSeal.scale(stats.hp, percent),
      attack: DivinePetSeal.scale(stats.attack, percent),
      defense: DivinePetSeal.scale(stats.defense, percent),
      speed: DivinePetSeal.scale(stats.speed, percent),
    };
  }

  /**
   * `currentHp` measured against `oldMax`, carried to `newMax` as `synchronize` does: the fraction is
   * kept (rounded), a living pet keeps at least 1 HP and a KO stays KO. An unset HP is full.
   */
  static carryHp(
    currentHp: number | undefined,
    oldMax: number | undefined,
    newMax: number,
  ): number {
    if (currentHp === undefined) return newMax;
    if (currentHp <= 0) return currentHp;
    if (oldMax === undefined || oldMax <= 0 || oldMax === newMax)
      return Math.min(newMax, currentHp);
    return Math.max(
      1,
      Math.min(newMax, Math.floor((currentHp * newMax + Math.floor(oldMax / 2)) / oldMax)),
    );
  }

  /**
   * `synchronize(session)` for the web save: `maxHp` is the maximum `currentHp` was measured against
   * (Java's `divineStatPercent` before the change); when a Divine pet's maximum now differs, HP keeps
   * its fraction and a KO stays KO. Other species are left exactly as they are.
   */
  synchronize(
    pets: readonly SavedPet[],
    percent: (pet: SavedPet) => number,
    base: (pet: SavedPet) => number,
  ): void {
    for (const pet of pets) {
      if (!this.isDivine(pet.speciesId)) continue;
      const newMax = towerBondStat(DivinePetSeal.scale(base(pet), percent(pet)), pet.towerBond);
      if (pet.maxHp === newMax) continue;
      if (pet.currentHp !== undefined)
        pet.currentHp = DivinePetSeal.carryHp(pet.currentHp, pet.maxHp, newMax);
      pet.maxHp = newMax;
    }
  }
}
