import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GameData } from "../../data/GameData";
import { Pack } from "../../pack/Pack";
import { BattleDefinitionRegistry, type BattleDefinition } from "./BattleDefinition";
import { loadBattleRules } from "./BattleRules";
import { BattleRuntime } from "./BattleRuntime";

vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "public",
    decodeURIComponent(input.replace(/^\//, "")),
  );
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, "utf8")) };
});

// A fight is scored by the shipped rules, so even the scripted-definition test carries the real ones.
const rules = await loadBattleRules(new GameData(await Pack.load()));

const definition: BattleDefinition = {
  id: "source-encounter-9-8-7",
  combatants: {
    player: {
      side: "player",
      speciesId: 1,
      name: "P",
      level: 2,
      spriteId: 10,
      element: 1,
      maxHp: 50,
      origin: { x: 1, y: 2 },
    },
    enemy: {
      side: "enemy",
      speciesId: 2,
      name: "E",
      level: 3,
      spriteId: 20,
      element: 2,
      maxHp: 80,
      origin: { x: 3, y: 4 },
    },
  },
  phases: [
    { key: "START", start: 0 },
    { key: "END", start: 2 },
  ],
  duration: 4,
  resultAt: 3,
  resultIndex: 2,
  offsets: { player: [{ from: 1, to: 1, x: 7, y: 8 }], enemy: [] },
  hp: {
    player: [
      { from: 0, value: 50 },
      { from: 2, value: 10 },
    ],
    enemy: [{ from: 0, value: 80 }],
  },
  animations: {
    player: { stateWindows: [{ from: 1, to: 2, state: 4 }], cursor: (t) => t },
    enemy: { stateWindows: [], cursor: () => -1 },
  },
  activeWindows: [{ from: 1, to: 2 }],
  hiddenWindows: {},
  effects: [],
  damage: [],
  entry: { leftActorSpriteId: 1, rightActorSpriteId: 2 },
  experience: { value: 5, max: 9 },
};

describe("generic BattleRuntime", () => {
  it("runs an injected definition and selects the source result branch", () => {
    const runtime = new BattleRuntime(
      {
        actorId: 4,
        encounter: [9, 8, 7],
        flags: [0, 1],
        mode: [2, 3],
        branchTargets: [11, 22, 33],
      },
      new BattleDefinitionRegistry([definition]),
      rules,
    );
    runtime.tick();
    runtime.tick();
    expect(runtime.offset("player")).toEqual({ x: 7, y: 8 });
    expect(runtime.state("player")).toBe(4);
    runtime.tick();
    expect(runtime.hp("player")).toBe(10);
    expect(runtime.result).toBe(2);
    expect(runtime.branch).toBe(33);
    runtime.tick();
    expect(runtime.complete).toBe(true);
  });
});
