import { describe, expect, it } from "vitest";
import { planWalk, walkKey } from "./TapWalk";

// A 10x10 grid of 1-px steps with a wall at x = 5 except for a gap at y = 8.
const DIRS = [0, 1, 2, 3]; // down, right, up, left
const D = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];
const wall = (x: number, y: number) => x < 0 || y < 0 || x > 9 || y > 9 || (x === 5 && y !== 8);
const step = (x: number, y: number, d: number) => {
  const [nx, ny] = [x + D[d][0], y + D[d][1]];
  return wall(nx, ny) ? { x, y, moved: false } : { x: nx, y: ny, moved: true };
};
const replay = (plan: { directions: number[] }, x: number, y: number) => {
  for (const d of plan.directions) ({ x, y } = step(x, y, d));
  return walkKey(x, y);
};

describe("planWalk", () => {
  it("goes round a wall through its gap", () => {
    const plan = planWalk({
      start: { x: 1, y: 1 },
      directions: DIRS,
      step,
      goal: (to) => to.x === 8 && to.y === 1,
    })!;
    expect(plan.reachesGoal).toBe(true);
    expect(plan.end).toBe("8,1");
    expect(replay(plan, 1, 1)).toBe("8,1");
    expect(plan.at[0]).toBe("1,1");
    expect(plan.directions.length).toBe(plan.at.length);
  });

  it("falls back to the closest reachable spot", () => {
    const target = { x: 5, y: 2 }; // inside the wall
    const plan = planWalk({
      start: { x: 1, y: 2 },
      directions: DIRS,
      step,
      goal: (to) => to.x === target.x && to.y === target.y,
      distance: (x, y) => Math.abs(x - target.x) + Math.abs(y - target.y),
    })!;
    expect(plan.reachesGoal).toBe(false);
    expect(["4,2", "6,2"]).toContain(plan.end);
    expect(replay(plan, 1, 2)).toBe(plan.end);
  });

  it("refuses a fallback beyond its reach, and forbidden steps", () => {
    const far = planWalk({
      start: { x: 1, y: 1 },
      directions: DIRS,
      step,
      goal: () => false,
      distance: (x, y) => Math.abs(x - 20) + Math.abs(y - 20),
      fallbackWithin: 3,
    });
    expect(far).toBeNull();
    const blocked = planWalk({
      start: { x: 1, y: 1 },
      directions: DIRS,
      step,
      goal: (to) => to.x === 8 && to.y === 1,
      forbidden: (to) => to.x === 5 && to.y === 8,
    });
    expect(blocked).toBeNull();
  });
});
