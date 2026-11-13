import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { redeemGiftCode, type GiftCodeDefinition } from "./GiftCodes";

const code: GiftCodeDefinition = {
  code: "TRUONGCON",
  active: true,
  minTask: 0,
  maxTask: -1,
  minBadges: 0,
  requiredEvents: [],
  forbiddenEvents: [],
  startsAtEpochMillis: 0,
  expiresAtEpochMillis: -1,
  money: 0,
  badges: 100,
  bagItems: [],
  materials: [],
  specialRewards: [],
  progressionBadges: [],
  description: "100 huy hiệu",
};

describe("gift codes", () => {
  it("loads the immutable catalog baked by the Java tool", () => {
    const baked = JSON.parse(
      readFileSync(new URL("../../../public/pack/story/gift-codes.json", import.meta.url), "utf8"),
    );
    expect(baked.profileVersion).toBe("unified-giftcode-v9");
    expect(baked.codes).toContainEqual(code);
  });

  it("redeems the baked offline code once and mutates atomically", () => {
    const inventory = {
      currency: { money: 0, badges: 0 },
      items: {},
      materials: {},
      specials: [],
      redeemed: [],
      mainTask: 0,
      achievedBadgeCount: 0,
      eventComplete: () => false,
      grantBadge: () => {},
    };
    expect(redeemGiftCode([code], inventory, "truongcon", 1).outcome).toBe("redeemed");
    expect(inventory.currency.badges).toBe(100);
    expect(redeemGiftCode([code], inventory, "TRUONGCON", 1).outcome).toBe("already_redeemed");
    expect(inventory.currency.badges).toBe(100);
  });
});
