import type { PackBattleAiEncounterRow } from "../../data/GameData";
import { enumName } from "../battle/ai/BattleAiEncounterCatalog";

/**
 * JavaSE victory rewards (`VqsvBattleRuntime.resolveNpcVictoryReward` / `resolveWildVictoryReward`):
 *
 * - an authored NPC encounter pays money by difficulty (`NpcBattleRewardService`, 50..3000 in 25s);
 * - otherwise a WILD encounter pays by the enemy's level and stars (`WildBattleRewardService`) and
 *   rolls a 15 % chance of one badge;
 * - a catch, a flight or a loss pays nothing (the caller only asks on a win that is not a catch).
 *
 * JavaSE only writes the "Thưởng +N kim." line into the battle debug log, so there is no text here.
 */

const MINIMUM_REWARD = 50;
const MAXIMUM_REWARD = 3000;
const REWARD_STEP = 25;
const BASE_REWARD_CAP = 100;
const REWARD_CAP_PER_LEVEL = 10;
export const BADGE_DROP_CHANCE_PERCENT = 15;

/** `NpcBattleRewardService.classBonus`. */
function classBonus(encounterClass: string): number {
  switch (encounterClass) {
    case "NPC":
      return 25;
    case "ELITE_NPC":
      return 75;
    case "GYM_TRAINER":
      return 125;
    case "GYM_LEADER":
      return 300;
    case "STORY_BOSS":
      return 450;
    case "QUEST_BOSS_CAPTURE":
      return 350;
    default:
      return 0;
  }
}

/**
 * `NpcBattleRewardService.quote`: the money an authored encounter pays, or null when it is not an
 * NPC fight (WILD and QUEST_PET are not) or has no members. Unified-design partners added for the
 * gym 2v2 do not count toward the payout.
 */
export function npcVictoryMoney(row: PackBattleAiEncounterRow | undefined): number | null {
  if (!row) return null;
  const encounter = row.encounter,
    kind = enumName(encounter.encounterClass);
  if (kind === "WILD" || kind === "QUEST_PET") return null;
  if (row.members.length === 0) return null;
  const sourceMembers = row.members.filter((member) => member.provenance !== "unified_design"),
    levelTotal = sourceMembers.reduce((sum, member) => sum + member.effectiveLevel, 0),
    simultaneous = encounter.descriptorSymbol === "SCENE2_ROOM0_GROUP1_SOLDIERS",
    maySwitch = !simultaneous && sourceMembers.length > 1,
    difficulty =
      6 * levelTotal +
      50 * (sourceMembers.length - 1) +
      classBonus(kind) +
      (encounter.mayUseItems ? 50 : 0) +
      (maySwitch ? 75 : 0) +
      (encounter.mayUsePhasePolicy ? 100 : 0) +
      (simultaneous ? 75 : 0),
    rounded = Math.trunc((difficulty + Math.trunc(REWARD_STEP / 2)) / REWARD_STEP) * REWARD_STEP;
  return Math.max(MINIMUM_REWARD, Math.min(MAXIMUM_REWARD, rounded));
}

/** Whether `WildBattleRewardService` pays this encounter: a WILD row, or a runtime-generated wild. */
export function isWildEncounter(row: PackBattleAiEncounterRow | undefined): boolean {
  return !!row && enumName(row.encounter.encounterClass) === "WILD";
}

/**
 * `WildBattleRewardService.quote`: the level formula is the four-star ceiling; one, two and three
 * stars receive 70, 80 and 90 percent.
 */
export function wildVictoryMoney(enemyLevel: number, enemyQuality: number): number {
  const level = Math.max(1, enemyLevel),
    quality = Math.max(1, Math.min(4, enemyQuality)),
    percent = 60 + quality * 10,
    ceiling = BASE_REWARD_CAP + REWARD_CAP_PER_LEVEL * level;
  return Math.trunc((ceiling * percent) / 100);
}

/** `WildBattleRewardService.badgeReward`: one badge for the 0..14 band of a d100 roll. */
export function wildVictoryBadges(roll: number): number {
  const normalized = ((roll % 100) + 100) % 100;
  return normalized < BADGE_DROP_CHANCE_PERCENT ? 1 : 0;
}
