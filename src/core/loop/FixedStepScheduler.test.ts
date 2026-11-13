import { describe, expect, it } from "vitest";
import { FixedStepScheduler } from "./FixedStepScheduler";

describe("FixedStepScheduler (GamePanel.run pacing)", () => {
  it("ticks once immediately, then once per 66ms step", () => {
    const s = new FixedStepScheduler(66);
    expect(s.advance(1000)).toBe(1);
    expect(s.advance(1016)).toBe(0);
    expect(s.advance(1065)).toBe(0);
    expect(s.advance(1066)).toBe(1);
    expect(s.advance(1132)).toBe(1);
  });

  it("averages 66ms per tick under a 60Hz display", () => {
    const s = new FixedStepScheduler(66);
    let ticks = 0;
    for (let frame = 0; frame <= 600; frame++) ticks += s.advance(frame * (1000 / 60));
    // 10 s of frames: Java runs 10000/66 = 151.5 ticks.
    expect(ticks).toBeGreaterThanOrEqual(151);
    expect(ticks).toBeLessThanOrEqual(152);
  });

  it("catches up at most one late tick when within one step", () => {
    const s = new FixedStepScheduler(66);
    s.advance(0); // next tick due at 66
    expect(s.advance(126)).toBe(1); // 60ms late for nothing yet: one tick, next due at 132
    expect(s.advance(200)).toBe(2); // 132 and 198 are both due and lag < one step: Java runs both
    expect(s.advance(260)).toBe(0); // next due at 264
  });

  it("drops the backlog instead of fast-forwarding after a long stall", () => {
    const s = new FixedStepScheduler(66);
    s.advance(0);
    expect(s.advance(60_000)).toBe(1);
    expect(s.advance(60_000 + 65)).toBe(0);
    expect(s.advance(60_000 + 66)).toBe(1);
  });

  it("restarts cleanly after reset (tab becomes visible)", () => {
    const s = new FixedStepScheduler(66);
    s.advance(0);
    s.reset();
    expect(s.advance(5_000)).toBe(1);
    expect(s.advance(5_066)).toBe(1);
  });

  it("reports how far a frame sits between two ticks", () => {
    const scheduler = new FixedStepScheduler(66);
    expect(scheduler.progress(0)).toBe(1);
    scheduler.advance(1000);
    expect(scheduler.progress(1000)).toBe(0);
    expect(scheduler.progress(1033)).toBeCloseTo(0.5, 1);
    expect(scheduler.progress(1066)).toBe(1);
  });
});
