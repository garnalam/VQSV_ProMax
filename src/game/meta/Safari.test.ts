import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  pickSafariPet,
  resolveSafariTurn,
  safariPassable,
  safariRandom,
  type SafariEncounter,
  type SafariMap,
  type SafariRun,
} from "./Safari";

const map: SafariMap = JSON.parse(readFileSync("public/pack/safari/map.json", "utf8"));
const encounter = (): SafariEncounter => ({
  pet: { speciesId: 29, level: 30, quality: 2 },
  effect: "neutral",
  turns: 0,
});
const rolls =
  (...values: number[]) =>
  (bound: number) => {
    const next = values.shift();
    if (next === undefined || next < 0 || next >= bound) throw new Error("Unexpected random draw");
    return next;
  };

describe("Safari rules", () => {
  it("preserves every encounter weight and the ten percent divine pool", () => {
    const counts = new Map<number, number>();
    for (let roll = 0; roll < 400; roll++) {
      const row = pickSafariPet(roll);
      counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
    }
    expect([...counts.values()]).toEqual([45, 45, 45, 45, 45, 45, 45, 45, 8, 8, 8, 8, 8]);
  });

  it("applies bait on its last turn and cancels it immediately with rock", () => {
    const pet = encounter();
    expect(resolveSafariTurn(pet, "bait", 40, rolls(0, 50))).toBe("stay");
    expect(pet).toMatchObject({ effect: "neutral", turns: 0 });
    pet.effect = "bait";
    pet.turns = 253;
    resolveSafariTurn(pet, "bait", 40, rolls(4, 50));
    expect(pet.turns).toBe(254);
    expect(resolveSafariTurn(pet, "rock", 40, rolls(79))).toBe("fled");
  });

  it("resolves capture before flee, caps catch chance and runs without RNG", () => {
    const pet = encounter();
    pet.effect = "rock";
    pet.turns = 1;
    expect(resolveSafariTurn(pet, "ball", 255, rolls(3379))).toBe("caught");
    expect(resolveSafariTurn(pet, "ball", 255, rolls(3380, 0))).toBe("fled");
    expect(resolveSafariTurn(pet, "run", 255, rolls())).toBe("run");
  });

  it("restores the next random draws exactly and keeps map spawn and exit connected", () => {
    const run: SafariRun = {
      balls: 30,
      x: map.spawn[0],
      y: map.spawn[1],
      direction: 0,
      steps: 12,
      seed: 42,
      encounter: null,
    };
    const copy = structuredClone(run);
    expect(Array.from({ length: 40 }, () => safariRandom(run, 400))).toEqual(
      Array.from({ length: 40 }, () => safariRandom(copy, 400)),
    );
    expect(safariPassable(map, -1, 0)).toBe(false);
    expect(safariPassable(map, map.width, map.height)).toBe(false);
    const start = Math.floor(run.y / 16) * map.columns + Math.floor(run.x / 16),
      queue = [start],
      visited = new Set(queue);
    for (let i = 0; i < queue.length; i++) {
      const cell = queue[i],
        x = cell % map.columns,
        y = Math.floor(cell / map.columns);
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const nx = x + dx,
          ny = y + dy,
          next = ny * map.columns + nx;
        if (safariPassable(map, nx * 16 + 8, ny * 16 + 8) && !visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    const [ex, ey, ew, eh] = map.exitTiles;
    expect(
      [...visited].some(
        (cell) =>
          cell % map.columns >= ex &&
          cell % map.columns < ex + ew &&
          Math.floor(cell / map.columns) >= ey &&
          Math.floor(cell / map.columns) < ey + eh,
      ),
    ).toBe(true);
    expect(visited.size).toBeGreaterThan(500);
  });
});
