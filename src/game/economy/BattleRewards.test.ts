import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PackBattleAiEncounterRow } from "../../data/GameData";
import {
  isWildEncounter,
  npcVictoryMoney,
  wildVictoryBadges,
  wildVictoryMoney,
} from "./BattleRewards";

const rows = (
  JSON.parse(readFileSync("public/pack/data/battle/ai-v2-catalog.json", "utf8")) as {
    encounters: PackBattleAiEncounterRow[];
  }
).encounters;
const row = (key: string) => rows.find((r) => r.encounter.encounterKey === key);

describe("JavaSE victory rewards", () => {
  it("pays authored NPCs by difficulty, as NpcBattleRewardService quotes them", () => {
    // Values printed by the JavaSE service itself; all 109 encounters were compared once.
    expect(npcVictoryMoney(row("LH-ENC-S01-R00-G06-B01-ELDER"))).toBe(50);
    expect(npcVictoryMoney(row("LH-ENC-S01-R01-G02-B01-MAGHULL"))).toBe(50);
    // The bunny is a QUEST_PET: no NPC payout.
    expect(npcVictoryMoney(row("LH-ENC-S01-R01-G00-B01-BUNNY"))).toBeNull();
    expect(npcVictoryMoney(undefined)).toBeNull();
    const amounts = rows.map(npcVictoryMoney).filter((money): money is number => money !== null);
    expect(Math.min(...amounts)).toBeGreaterThanOrEqual(50);
    expect(Math.max(...amounts)).toBeLessThanOrEqual(3000);
    expect(amounts.every((money) => money % 25 === 0)).toBe(true);
  });

  it("pays a WILD encounter by level and stars, and rolls one badge in the 0..14 band", () => {
    // ceiling 100 + 10 x level, 70/80/90/100 % for one to four stars (five counts as four).
    expect(wildVictoryMoney(10, 1)).toBe(140);
    expect(wildVictoryMoney(10, 4)).toBe(200);
    expect(wildVictoryMoney(10, 5)).toBe(200);
    expect(wildVictoryMoney(0, 0)).toBe(77);
    expect([0, 14, 15, 99, 114, -86].map(wildVictoryBadges)).toEqual([1, 1, 0, 0, 1, 1]);
    const wild = rows.find((r) => r.encounter.encounterClass.endsWith(".WILD"));
    expect(isWildEncounter(wild)).toBe(true);
    expect(isWildEncounter(row("LH-ENC-S01-R00-G06-B01-ELDER"))).toBe(false);
  });
});
