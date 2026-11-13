import { describe, expect, it } from "vitest";
import { MotionInterpolator } from "./MotionInterpolator";

describe("MotionInterpolator", () => {
  it("draws a walk and a pan part-way between two ticks", () => {
    const motion = new MotionInterpolator(),
      actors = new Map([[-1, { id: -1, x: 100, y: 100 }]]);
    motion.capture(actors, { x: 0, y: 0 }, actors.values());
    actors.get(-1)!.x = 108;
    motion.settle(actors, { x: 4, y: 0 }, actors.values());
    expect(motion.moving).toBe(true);
    motion.alpha = 0.5;
    expect(motion.actor(actors, -1, actors.get(-1)!)).toMatchObject({ x: 104, y: 100 });
    expect(motion.camera(actors, { x: 4, y: 0 })).toMatchObject({ x: 2, y: 0 });
    motion.alpha = 1;
    expect(motion.actor(actors, -1, actors.get(-1)!)).toMatchObject({ x: 108, y: 100 });
  });
  it("puts a teleport where it lands, and stops when nothing moves", () => {
    const motion = new MotionInterpolator(),
      actors = new Map([[3, { id: 3, x: 10, y: 10 }]]);
    motion.capture(actors, { x: 0, y: 0 }, actors.values());
    actors.get(3)!.x = 200;
    motion.settle(actors, { x: 0, y: 0 }, actors.values());
    motion.alpha = 0.5;
    expect(motion.actor(actors, 3, actors.get(3)!)).toMatchObject({ x: 200, y: 10 });
    motion.capture(actors, { x: 0, y: 0 }, actors.values());
    motion.settle(actors, { x: 0, y: 0 }, actors.values());
    expect(motion.moving).toBe(false);
  });
  it("does not blend across a scene change", () => {
    const motion = new MotionInterpolator(),
      before = new Map([[1, { id: 1, x: 0, y: 0 }]]),
      after = new Map([[1, { id: 1, x: 8, y: 0 }]]);
    motion.capture(before, { x: 0, y: 0 }, before.values());
    motion.settle(after, { x: 0, y: 0 }, after.values());
    motion.alpha = 0.5;
    expect(motion.actor(after, 1, after.get(1)!)).toMatchObject({ x: 8, y: 0 });
  });
});
