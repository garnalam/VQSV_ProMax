import { describe, expect, it } from "vitest";
import {
  applyBattlePassEvent,
  battlePassLevel,
  claimBattlePassReward,
  purchaseBattlePassVip,
  type BattlePassCatalog,
  type BattlePassState,
} from "./BattlePass";

const catalog: BattlePassCatalog = {
  seasonKey: "s1",
  title: "Fan",
  maxLevel: 50,
  vipPriceBadges: 20,
  xpPerLevel: 1000,
  seasonDays: 18,
  missions: [{ key: "win", label: "Thắng", event: "BATTLE_WON", target: 1, xp: 250 }],
  levels: [
    {
      level: 1,
      free: [{ kind: "MONEY", id: 0, quantity: 750, label: "750 kim tiền" }],
      vip: [{ kind: "BADGES", id: 0, quantity: 2, label: "2 huy hiệu" }],
    },
  ],
};
const state = (): BattlePassState => ({
  seasonKey: "s1",
  seasonStartEpochMillis: 0,
  xp: 0,
  vipUnlocked: false,
  claimedFree: [],
  claimedVip: [],
  missions: [0],
  appliedEvents: [],
});

describe("battle pass", () => {
  it("deduplicates events and awards mission xp", () => {
    const pass = state();
    expect(applyBattlePassEvent(catalog, pass, { id: "w1", type: "BATTLE_WON" }, 1)).toBe(350);
    expect(applyBattlePassEvent(catalog, pass, { id: "w1", type: "BATTLE_WON" }, 1)).toBe(0);
    expect(pass.xp).toBe(350);
    expect(battlePassLevel(catalog, pass)).toBe(1);
  });

  it("claims each track once and purchases VIP atomically", () => {
    const pass = state(),
      inventory = { currency: { money: 0, badges: 20 }, items: {}, materials: {}, specials: [] };
    expect(claimBattlePassReward(catalog, pass, inventory, 1, false, 1).claimed).toBe(true);
    expect(inventory.currency.money).toBe(750);
    expect(claimBattlePassReward(catalog, pass, inventory, 1, false, 1)).toMatchObject({
      claimed: false,
      reason: "already_claimed",
    });
    expect(purchaseBattlePassVip(catalog, pass, inventory.currency)).toBe(true);
    expect(inventory.currency.badges).toBe(0);
  });
});
