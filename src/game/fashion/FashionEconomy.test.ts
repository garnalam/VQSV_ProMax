import { describe, expect, it } from "vitest";
import type { MetaSystemsDocument } from "../story/GameAssets";
import {
  buyFashionBags,
  defaultFashionEconomyState,
  exchangeFashion,
  openFashionBag,
  previewFashionDraw,
} from "./FashionEconomy";

const tier = (
  code: string,
  probabilityBps: number,
  duplicateFragments: number,
  exchangeFragments: number,
) => ({
  code,
  label: code,
  probabilityBps,
  duplicateFragments,
  exchangeFragments,
});
const rareKeys = [
  "FASH-LH-SPR031-A00",
  "FASH-LH-SPR032-A00",
  "FASH-LH-SPR069-A00",
  "FASH-LH-SPR072-A00",
  "FASH-CV-NPC0-003-A00",
  "FASH-CV-NPC0-003-A06",
  "FASH-CV-NPC0-005-A00",
  "FASH-CV-NPC0-033-A00",
  "FASH-CV-NPC0-043-A00",
  "FASH-CV-NPC0-078-A00",
];
const catalog = {
  profileVersion: "unified-fashion-economy-v1",
  poolVersion: "FASH-POOL-SOURCE-V1",
  bagPrice: 500,
  bagCapacity: 99,
  fragmentCapacity: 999_999,
  tiers: [
    tier("COMMON", 5500, 10, 20),
    tier("RARE", 2700, 12, 36),
    tier("EPIC", 1400, 15, 60),
    tier("LEGENDARY", 400, 20, 100),
  ],
  entries: rareKeys.map((key) => ({ key, tier: "RARE" })),
} as MetaSystemsDocument["fashion"]["economy"];

describe("JavaSE fashion blind-bag economy", () => {
  it("matches FashionEconomySaveFoundationTest's fixed SHA-256 draw vector", () => {
    const state = defaultFashionEconomyState(123456789n);
    expect(previewFashionDraw(catalog, state)).toMatchObject({
      key: "FASH-LH-SPR032-A00",
      tier: { code: "RARE" },
    });
  });

  it("buys atomically, grants a new fashion, then converts a duplicate to fragments", () => {
    const state = defaultFashionEconomyState(123456789n),
      currency = { money: 1000 },
      owned = ["FASH-BASE-NEIL"];
    expect(buyFashionBags(catalog, state, currency, 2)).toBe("purchased");
    expect([currency.money, state.blindBagCount]).toEqual([0, 2]);
    const first = openFashionBag(catalog, state, owned);
    expect(first.outcome).toBe("new");
    // Rewind only the draw cursor to prove duplicate conversion without involving another RNG lane.
    state.drawIndex = 0;
    const second = openFashionBag(catalog, state, owned);
    expect(second).toMatchObject({ outcome: "duplicate", fragmentDelta: 12 });
    expect(state.fragmentCount).toBe(12);
  });

  it("exchanges only locked fashions when enough fragments exist", () => {
    const state = defaultFashionEconomyState(1n),
      owned = ["FASH-BASE-NEIL"];
    state.fragmentCount = 36;
    expect(exchangeFashion(catalog, state, owned, rareKeys[0])).toBe("exchanged");
    expect([state.fragmentCount, owned.includes(rareKeys[0])]).toEqual([0, true]);
    expect(exchangeFashion(catalog, state, owned, rareKeys[0])).toBe("owned");
  });
});
