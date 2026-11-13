import { describe, expect, it } from "vitest";
import { battleUiState, type BattleUiMode } from "./BattleUiState";

const modes: BattleUiMode[] = [
  "BATTLE",
  "CATCH_ANIM",
  "CHOICE",
  "CHOICE_SKILL",
  "COMMAND",
  "LEVEL_UP",
  "NPC_ENEMY",
  "PET_STATE",
  "SHOP_BUY",
  "SHOP_CONFIRM",
  "SKILL",
  "SMS_INFO",
  "TARGET",
  "WARNING",
];
describe("battle UI state contract", () => {
  it("covers every Java VqsvBattleUiMode", () => {
    expect(modes.map((mode) => battleUiState(mode).mode)).toEqual(modes);
  });
});
