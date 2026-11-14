import { describe, expect, it } from "vitest";
import { migrateLegacyRides, rideUnlocked, type RideState } from "./RideSystem";

function migrate(scene: number, active: number, collected: number[], flags: number[] = []) {
  const state: RideState = { activeIndex: active, blocked: [] };
  const events = new Set(flags);
  const ownership = { specials: [], collected: (id: number) => collected.includes(id),
    rainbowEventDone: (room: number, event: number) => room === 0 && events.has(event) };
  const run = () => migrateLegacyRides(state, scene, ownership, (event) => events.add(event));
  run();
  return { state, events, ownership, run };
}

describe("legacy ride ownership is converted once", () => {
  it.each([[0, 113, 4], [1, 149, 7], [3, 182, 8]])("converts CV slot %i", (old, pet, want) => {
    const result = migrate(98, old, [pet]);
    expect(result.state.activeIndex).toBe(want);
    result.run();
    expect(result.state.activeIndex).toBe(want);
  });
  it("keeps current-format rides and grants the old beast entitlement", () => {
    const result = migrate(98, 1, [117], [700099]);
    expect(result.state.activeIndex).toBe(1);
    expect(rideUnlocked(5, result.ownership)).toBe(true);
    expect(result.events.has(700097)).toBe(true);
  });
  it("does not grant the beast from species 117 on unseparated saves", () => {
    const result = migrate(98, -1, [117]);
    expect(rideUnlocked(5, result.ownership)).toBe(false);
    result.run();
    expect(rideUnlocked(5, result.ownership)).toBe(false);
  });
  it("leaves Liet Hoa indexes unchanged and does not convert a locked CV mount", () => {
    expect(migrate(1, 0, [113]).state.activeIndex).toBe(0);
    expect(migrate(98, 0, []).state.activeIndex).toBe(0);
  });
});
