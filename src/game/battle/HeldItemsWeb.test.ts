import { describe, expect, it } from "vitest";
import { planHeldItemHpFloor } from "./BattleActionEngine";
import { calculateCatchChance, type CatchInput } from "./BattleOutcomeEngine";

/** The web build's corrections to two held items; the Java answers stay graded in HeldItems.test.ts. */
describe("Cảm Lãm Chi Diệp: a hit cannot take a wild pet below 10 HP, and never heals it", () => {
  const plan = (targetHpBefore: number, targetHp: number, web = true) =>
    planHeldItemHpFloor({
      contextAllowsFloor: true,
      attackerHasHeldItem10: true,
      targetHp,
      floor: 10,
      targetHpBefore: web ? targetHpBefore : undefined,
    });

  it("holds a hit that would go under the floor at 10", () => {
    expect(plan(50, 0)).toEqual({ apply: true, hp: 10 });
    expect(plan(50, 10)).toEqual({ apply: false, hp: 10 });
  });

  it("leaves a target already under 10 where it was instead of lifting it", () => {
    expect(plan(5, 0)).toEqual({ apply: true, hp: 5 });
    expect(plan(5, 4)).toEqual({ apply: true, hp: 5 });
    // Java sets the floor whatever the HP was, which heals a target sitting at 5.
    expect(plan(5, 4, false)).toEqual({ apply: true, hp: 10 });
  });

  it("does nothing outside a capture fight", () => {
    expect(
      planHeldItemHpFloor({
        contextAllowsFloor: false,
        attackerHasHeldItem10: true,
        targetHp: 0,
        floor: 10,
        targetHpBefore: 50,
      }).apply,
    ).toBe(false);
  });
});

describe("Sủng vật lôi đạt: +20% capture chance, once", () => {
  const base: CatchInput = {
    itemId: 1,
    itemParamA: 100,
    enemyHp: 1000,
    enemyMaxHp: 1000,
    enemyNature: 1,
    targetDebuff1: false,
    targetDebuff2: false,
    targetDebuff10: false,
    attackerHeldItem11: false,
    heldItem11Bonus: 20,
    captureBonusPoints: 0,
    enemyRelationClass: 0,
    enemyLevel: 1,
    roll: 0,
    forceFail: false,
  };
  const chance = (input: Partial<CatchInput>) => calculateCatchChance({ ...base, ...input });

  it("multiplies the chance by 120%, not 144%", () => {
    expect(chance({ web: true })).toBe(22);
    expect(chance({ web: true, attackerHeldItem11: true })).toBe(26);
    expect(chance({ attackerHeldItem11: true })).toBe(31);
  });

  it("stacks with the bonus a Tê Liệt target gives instead of replacing it", () => {
    const paralysed = chance({ web: true, targetDebuff10: true });
    expect(paralysed).toBe(26);
    expect(chance({ web: true, targetDebuff10: true, attackerHeldItem11: true })).toBe(31);
  });
});
