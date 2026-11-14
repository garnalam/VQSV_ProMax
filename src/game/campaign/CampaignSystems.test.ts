import { describe, expect, it } from "vitest";
import type { SavedPet } from "../../persistence/save/GameSave";
import {
  claimDailyBadges,
  defaultCampaignState,
  depositPet,
  petBankCapacity,
  purchasePetBankExpansion,
  withdrawPet,
} from "./CampaignSystems";
import {
  accelerateEgg,
  availableEggIds,
  eggDraw,
  hatchFromPool,
  hatchUnified,
  rollHatchNature,
  type HatchContext,
} from "./EggService";

const pet = (speciesId: number, currentHp = 10): SavedPet => ({
  speciesId,
  level: 1,
  quality: 1,
  currentHp,
  maxHp: 10,
});

describe("campaign foundation services", () => {
  it("persists bank capacity purchases and protects the last living party pet", () => {
    const state = defaultCampaignState(7),
      currency = { badges: 20 },
      roster = [pet(1), pet(2, 0)];
    expect(depositPet(roster, state, 0, 100)).toBe("last-living");
    expect(depositPet(roster, state, 1, 100)).toBe("deposited");
    expect(state.petBank).toHaveLength(1);
    expect(withdrawPet(roster, state, 0)).toBe("withdrawn");
    expect(purchasePetBankExpansion(state, currency)).toBe("success");
    expect(currency.badges).toBe(10);
    expect(petBankCapacity(state.petBankExpansionPurchases)).toBe(200);
  });

  it("grants daily badges once per local calendar day and locks clock rollback", () => {
    const state = defaultCampaignState(),
      currency = { badges: 0 },
      first = new Date(2026, 10, 8, 9).getTime();
    expect(claimDailyBadges(state, currency, first).granted).toBe(true);
    expect(currency.badges).toBe(20);
    expect(claimDailyBadges(state, currency, first + 1_000).granted).toBe(false);
    expect(claimDailyBadges(state, currency, first - 1).rollback).toBe(true);
    expect(claimDailyBadges(state, currency, first + 86_400_000).granted).toBe(true);
  });

  it("draws eggs from JavaSE's SHA-256 lanes (EggDrawStream.bounded)", () => {
    // Values printed by vqsv.progression.EggDrawStream for the same inputs.
    expect(eggDraw("20261109", 0, "egg.qualityTier", 10000)).toBe(5019);
    expect(eggDraw("20261109", 0, "egg.species", 8)).toBe(2);
    expect(eggDraw("20261109", 3, "egg.v4.species.11", 49)).toBe(17);
    expect(eggDraw("-7354118725018551212", 12, "egg.qualityTier", 10000)).toBe(7147);
  });

  it.each([
    [false, 1, 9],
    [false, 2, 2],
    [true, 49, 9],
    [true, 50, 2],
  ])("rolls the source hatch nature (boosted %s, roll %i)", (boosted, chance, nature) => {
    const draws: string[] = [];
    expect(
      rollHatchNature((lane: string) => {
        draws.push(lane);
        return lane === "egg.shinyChance" ? chance : 2;
      }, boosted),
    ).toBe(nature);
    expect(draws).toEqual(
      nature === 2 ? ["egg.shinyChance"] : ["egg.shinyChance", "egg.shinyForm"],
    );
  });

  it("hatches the unified egg into the bank when the party is full and queues the next egg", () => {
    const state = defaultCampaignState(123);
    state.egg.drawSeed = "20261109";
    const items = { "14": 1 },
      specials = [0, 0, 5];
    expect(availableEggIds(specials, [0, 11, 12])).toEqual([0]);
    expect(accelerateEgg(state.egg, items)).toBe("not-available");
    state.egg.active = true;
    expect(accelerateEgg(state.egg, items)).toBe("applied");
    expect([state.egg.progress, items["14"]]).toEqual([10, 0]);
    const context: HatchContext = {
      egg: state.egg,
      roster: [1, 2, 3, 4, 5, 6].map((id) => pet(id)),
      bank: state.petBank,
      bankCapacity: 100,
      collected: () => false,
      create: (speciesId) => pet(speciesId),
      specials,
    };
    // Roll 5019 lands in tier 1's 55.10 % band; draw 2 of its eight species is 95.
    const tiers = {
      rates: [0, 5510, 2700, 1000, 290, 500],
      species: [[], [0, 56, 95, 187, 190, 193, 196, 199], [58, 114], [72], [115], [185]],
    };
    expect(hatchUnified(context, tiers, true)).toEqual({
      outcome: "hatched",
      speciesId: 95,
      storage: 1,
    });
    expect(state.petBank.map((p) => [p.speciesId, p.slot])).toEqual([[95, 0]]);
    // One egg used up; the second starts from zero in the incubator; a new species raised the type.
    expect([
      specials,
      state.egg.active,
      state.egg.progress,
      state.egg.type,
      state.egg.drawIndex,
    ]).toEqual([[0, 5], true, 0, 1, 1]);
    expect(hatchUnified(context, tiers, true).outcome).toBe("not-ready");
  });

  it("keeps a V4 egg in the bag when both storages are full", () => {
    const state = defaultCampaignState();
    Object.assign(state.egg, { active: true, activeEggItemId: 11, progress: 10, drawSeed: "1" });
    const specials = [11],
      result = hatchFromPool(
        {
          egg: state.egg,
          roster: [1, 2, 3, 4, 5, 6].map((id) => pet(id)),
          bank: [pet(9)],
          bankCapacity: 1,
          collected: () => false,
          create: (speciesId) => pet(speciesId),
          specials,
        },
        [120, 121],
      );
    expect([result.outcome, specials, state.egg.drawIndex]).toEqual(["creation-failed", [11], 0]);
  });
});
