import { describe, expect, it } from "vitest";
import { KimDiemLongAn } from "./KimDiemLongAn";

/** `KimDiemLongAnBoundaryTest`'s memory rules, on the action-scoped class alone. */
describe("Long Ấn (Kim Diễm Long Vương)", () => {
  /** One damaging action: begin, project the hit, land what the boss can lose, return the reflect. */
  function hit(memory: KimDiemLongAn, skill: number, damage: number, bossHp = 1_000_000) {
    memory.beginAction(skill, true);
    const landed = memory.project(damage);
    return { landed, reflect: memory.afterHit(Math.min(bossHp, landed)) };
  }

  it("remembers a first hit, cuts the repeat to 70% and reflects 120% of it, then starts fresh", () => {
    const memory = new KimDiemLongAn();
    expect(hit(memory, 6, 100)).toEqual({ landed: 100, reflect: 0 });
    expect(memory.remembered).toBe(6);
    expect(hit(memory, 6, 100)).toEqual({ landed: 70, reflect: 84 });
    expect(memory.remembered).toBe(-1);
    // The third use is a fresh first hit again.
    expect(hit(memory, 6, 100)).toEqual({ landed: 100, reflect: 0 });
    expect(memory.remembered).toBe(6);
  });

  it("a different skill, a support skill or an interrupt forgets the chain", () => {
    const memory = new KimDiemLongAn();
    hit(memory, 6, 100);
    hit(memory, 0, 100);
    expect(memory.remembered).toBe(0);
    memory.beginAction(5, false);
    expect(memory.remembered).toBe(-1);
    hit(memory, 6, 100);
    memory.interrupt();
    expect(hit(memory, 6, 100).reflect).toBe(0);
  });

  it("an overkill repeat reflects only what the boss actually lost", () => {
    const memory = new KimDiemLongAn();
    hit(memory, 6, 1000);
    expect(hit(memory, 6, 1000, 3).reflect).toBe(3);
  });

  it("a miss neither remembers nor reflects", () => {
    const memory = new KimDiemLongAn();
    memory.beginAction(6, true);
    expect(memory.afterHit(0)).toBe(0);
    expect(memory.remembered).toBe(-1);
  });
});
