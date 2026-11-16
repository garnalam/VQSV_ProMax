import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SavedPet } from "../../persistence/save/GameSave";
import type { SafariMap, SafariRun } from "../meta/Safari";
import { SafariSession } from "./SafariSession";

const map: SafariMap = JSON.parse(readFileSync("public/pack/safari/map.json", "utf8"));
function fixture() {
  let run: SafariRun | undefined,
    saves = 0,
    roomBlocked = false,
    full = false,
    pending = false;
  const wallet = { badges: 100 },
    received: SavedPet[] = [];
  const safari = new SafariSession({
    map: () => map,
    run: () => run,
    setRun: (value) => {
      run = value;
    },
    wallet: () => wallet,
    canEnter: () => !roomBlocked,
    blocked: () => pending,
    hasSpace: () => !full,
    createPet: (id, level) => ({ speciesId: id, level, quality: 2 }),
    speed: () => 0,
    receive: (pet) => {
      received.push(pet);
    },
    save: () => {
      saves++;
    },
  });
  return {
    safari,
    wallet,
    received,
    get saves() {
      return saves;
    },
    setFull: () => {
      full = true;
    },
    setBlocked: () => {
      roomBlocked = true;
    },
    setPending: (value: boolean) => {
      pending = value;
    },
  };
}

describe("Safari session", () => {
  it("uses the game's original ball phases and blocks another turn throughout capture", () => {
    const f = fixture();
    f.safari.enter(42);
    const run = f.safari.run!;
    run.encounter = { pet: { speciesId: 29, level: 30, quality: 2 }, effect: "neutral", turns: 0 };
    // Force a miss so the original shrink, shake and restore phases can all be observed.
    let seed = 0;
    while (((Math.imul(seed, 1664525) + 1013904223) >>> 0) % 10000 < 2500) seed++;
    run.seed = seed;
    f.safari.act("ball");
    expect(f.safari.captureVisual).toMatchObject({ spriteId: 269, state: 0, phase: "throw" });
    for (let i = 0; i < 8; i++) f.safari.tick([]);
    expect(f.safari.captureVisual).toMatchObject({
      state: 1,
      hideEnemy: true,
      effect: { scale10: 10 },
    });
    for (let i = 0; i < 9; i++) f.safari.tick([]);
    expect(f.safari.captureVisual).toMatchObject({ state: 2, phase: "capture" });
    for (let i = 0; i < 25; i++) f.safari.tick([]);
    expect(f.safari.captureVisual).toMatchObject({ state: 1, effect: { scale10: 4 } });
    f.safari.act("ball");
    expect(run.balls).toBe(29);
    for (let i = 0; i < 16; i++) f.safari.tick([]);
    expect(f.safari.throwAnimation).toBeNull();
  });

  it("shows a throw once and locks actions until the wild pet reaction finishes", () => {
    const f = fixture();
    f.safari.enter(42);
    f.safari.run!.encounter = {
      pet: { speciesId: 29, quality: 2, level: 30 },
      effect: "neutral",
      turns: 0,
    };
    f.safari.act("bait");
    expect(f.safari.throwAnimation).toMatchObject({ action: "bait", tick: 0, outcome: "stay" });
    const seed = f.safari.run!.seed;
    const saves = f.saves;
    f.safari.act("rock");
    f.safari.leave();
    for (let i = 0; i < 26; i++) f.safari.tick(["confirm"]);
    expect(f.safari.throwAnimation).toBeNull();
    expect(f.safari.run!.seed).toBe(seed);
    expect(f.saves).toBe(saves);
    expect(f.safari.run!.balls).toBe(30);
    f.safari.act("rock");
    expect(f.safari.throwAnimation?.action).toBe("rock");
    expect(f.saves).toBe(saves + 1);
  });

  it("charges once, rejects insufficient badges and respects the world entry guard", () => {
    const f = fixture();
    f.wallet.badges = 19;
    f.safari.open();
    f.safari.enter(42);
    expect(f.safari.run).toBeUndefined();
    expect(f.wallet.badges).toBe(19);
    f.wallet.badges = 20;
    f.safari.enter(42);
    f.safari.enter(42);
    expect(f.wallet.badges).toBe(0);
    expect(f.safari.run?.balls).toBe(30);
    expect(f.saves).toBe(1);
    const blocked = fixture();
    blocked.setBlocked();
    blocked.safari.open();
    blocked.safari.enter();
    expect(blocked.safari.visible).toBe(false);
    expect(blocked.safari.run).toBeUndefined();
  });

  it("keeps the ball when both pet stores are full", () => {
    const f = fixture();
    f.safari.enter(0);
    f.setFull();
    f.safari.run!.encounter = {
      pet: { speciesId: 29, quality: 2, level: 30 },
      effect: "neutral",
      turns: 0,
    };
    f.safari.act("ball");
    expect(f.safari.run?.balls).toBe(30);
    expect(f.saves).toBe(1);
  });

  it("awards the pet on the last ball before ending and saves both in one checkpoint", () => {
    const f = fixture();
    f.safari.enter(0);
    // The first random draw from seed 0 is 4223; seed 1 yields 8748, seed 2 yields 3273.
    // Find a seed whose next catch roll is below Uy Qua's 2500/10000 threshold.
    const run = f.safari.run!;
    run.balls = 1;
    run.encounter = { pet: { speciesId: 29, quality: 2, level: 30 }, effect: "neutral", turns: 0 };
    let seed = 0;
    while (((Math.imul(seed, 1664525) + 1013904223) >>> 0) % 10000 >= 2500) seed++;
    run.seed = seed;
    f.safari.act("ball");
    expect(f.received).toHaveLength(1);
    expect(f.safari.run).toBeUndefined();
    expect(f.saves).toBe(2);
  });

  it("pauses actions during saving and lets run leave only the encounter", () => {
    const f = fixture();
    f.safari.enter(42);
    f.setPending(true);
    f.safari.leave();
    expect(f.safari.run).toBeDefined();
    f.setPending(false);
    f.safari.run!.encounter = {
      pet: { speciesId: 29, quality: 2, level: 30 },
      effect: "neutral",
      turns: 0,
    };
    f.safari.act("run");
    expect(f.safari.run?.encounter).toBeNull();
    expect(f.safari.run?.balls).toBe(30);
    f.safari.leave();
    expect(f.safari.run).toBeUndefined();
  });

  it("stays active without a time limit and cannot move through a blocked tile", () => {
    const f = fixture();
    f.safari.enter(42);
    for (let i = 0; i < 5000; i++) f.safari.tick([]);
    expect(f.safari.run?.balls).toBe(30);
    const run = f.safari.run!,
      before = { x: run.x, y: run.y };
    f.safari.tick(["holdUp"]);
    expect(Math.abs(run.x - before.x) + Math.abs(run.y - before.y)).toBeLessThanOrEqual(3);
    expect(map.blocked[Math.floor(run.y / 16) * map.columns + Math.floor(run.x / 16)]).toBe(0);
  });
});
