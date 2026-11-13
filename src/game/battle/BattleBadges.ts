import type { PackItem } from "../../data/GameData";
import {
  BADGE_DAI_DIA,
  BADGE_HOA_PHONG,
  BADGE_LIET_HOA,
  BADGE_LOI_DIEN,
  BADGE_MOC_QUY,
  BADGE_U_LINH,
} from "../world/WorldFlags";
import { passiveHealAmount } from "./BattleOutcomeEngine";
import { effectValues } from "./HeldItems";

/**
 * `BattleBadgeProfile`: the badge effects a player-side unit carries into a fight, read once when the
 * unit is built (`PetBattleAdapter.toBattleUnit` → `BattleUnit.applySourceBadgeProfile`).
 */
export type BattleBadgeProfile = {
  /** Mộc Quỳ, enhanced: `effectParamB` percent onto the base HP. */
  maxHpPercent: number;
  /** Đại Địa, enhanced: `effectParamB` percent onto the base defense. */
  baseDefensePercent: number;
  /** Hỏa Phong: `effectParamA` percent onto the defense each hit against this unit reads. */
  targetDefensePercent: number;
  /** Hỏa Phong, enhanced: `effectParamB` points onto the speed the miss check compares. */
  hitCheckSpeedBonus: number;
  /** U Linh, enhanced: `effectParamA` percent more attack/defense/speed at each round's end... */
  roundGrowthPercent: number;
  /** ...up to `effectParamB` percent. */
  roundGrowthCap: number;
  /** Lôi Điện: `effectParamA` percent onto the damage this unit deals. */
  damagePercent: number;
  /** Lôi Điện, enhanced: a Cầu Vồng control or Hủ Thực lands on this unit for half its turns. */
  halveDebuffDuration: boolean;
};

/** `BattleBadgeProfile.NONE`: an enemy, a lent companion, or a player with no badge. */
export const NO_BADGE_PROFILE: BattleBadgeProfile = Object.freeze({
  maxHpPercent: 0,
  baseDefensePercent: 0,
  targetDefensePercent: 0,
  hitCheckSpeedBonus: 0,
  roundGrowthPercent: 0,
  roundGrowthCap: 0,
  damagePercent: 0,
  halveDebuffDuration: false,
});

/** The two columns of a badge row the battle reads (`BadgeRow.effectParamA` / `effectParamB`). */
export type BadgeParams = { a: number; b: number };

/** `VqsvBattleTables.badge(id)`: raw table 2 of `battle/items.json`, `values` = [paramA, paramB]. */
const BADGE_SOURCE_TABLE = 2;

export function badgeParamsFromItems(items: readonly PackItem[]): Map<number, BadgeParams> {
  const rows = new Map<number, BadgeParams>();
  for (const item of items) {
    if (item.sourceTable !== BADGE_SOURCE_TABLE) continue;
    const values = effectValues(item);
    rows.set(item.runtimeId, { a: values[0] ?? 0, b: values[1] ?? 0 });
  }
  return rows;
}

/** What `BadgeProgression` answers about one badge. */
export type BadgeStates = {
  achieved(badgeId: number): boolean;
  enhanced(badgeId: number): boolean;
};

/**
 * `PetBattleAdapter.battleBadgeProfile`. Only a verified effect is projected: an "achieved" term needs
 * the badge, an "enhanced" term needs it enhanced too, and a negative column counts as none. Thủy Lam's
 * enhanced term is left out on purpose, as in Java (the source executes −1% where its text promises a
 * rise, so no positive value is proven).
 */
export function battleBadgeProfile(
  badges: BadgeStates,
  rows: ReadonlyMap<number, BadgeParams>,
): BattleBadgeProfile {
  const achievedA = (id: number) =>
    badges.achieved(id) && rows.has(id) ? Math.max(0, rows.get(id)!.a) : 0;
  const enhancedA = (id: number) => (badges.enhanced(id) ? achievedA(id) : 0);
  const enhancedB = (id: number) =>
    badges.achieved(id) && badges.enhanced(id) && rows.has(id) ? Math.max(0, rows.get(id)!.b) : 0;
  return {
    maxHpPercent: enhancedB(BADGE_MOC_QUY),
    baseDefensePercent: enhancedB(BADGE_DAI_DIA),
    targetDefensePercent: achievedA(BADGE_HOA_PHONG),
    hitCheckSpeedBonus: enhancedB(BADGE_HOA_PHONG),
    roundGrowthPercent: enhancedA(BADGE_U_LINH),
    roundGrowthCap: enhancedB(BADGE_U_LINH),
    damagePercent: achievedA(BADGE_LOI_DIEN),
    halveDebuffDuration: badges.achieved(BADGE_LOI_DIEN) && badges.enhanced(BADGE_LOI_DIEN),
  };
}

/**
 * `VqsvBattleRuntime.applySourcePostExpPassiveHeal`: with Liệt Hỏa enhanced, once the EXP is committed
 * every living roster pet heals `effectParamB` percent of its species' base HP. Undefined otherwise.
 */
export function postExpBadgeHeal(
  badges: BadgeStates,
  rows: ReadonlyMap<number, BadgeParams>,
  speciesBaseHp: number,
): number | undefined {
  if (!badges.achieved(BADGE_LIET_HOA) || !badges.enhanced(BADGE_LIET_HOA)) return undefined;
  return passiveHealAmount(speciesBaseHp, rows.get(BADGE_LIET_HOA)?.b ?? 0);
}
