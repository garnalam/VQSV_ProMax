import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SavedPet } from "../../persistence/save/GameSave";
import type { SafariMap, SafariRun } from "../meta/Safari";
import { SAFARI_COMMANDS, SAFARI_ENTRY_TICKS, SafariSession } from "./SafariSession";

const map: SafariMap = JSON.parse(readFileSync("public/pack/safari/map.json", "utf8"));
function fixture(day?: { today: number }) {
  let run: SafariRun | undefined,
    entryDay: number | undefined,
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
    ...(day && {
      today: () => day.today,
      entryDay: () => entryDay,
      setEntryDay: (value: number) => {
        entryDay = value;
      },
    }),
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

  it("saves on the encounter, not on every tile walked", () => {
    const f = fixture();
    f.safari.enter(42);
    const run = f.safari.run!;
    run.steps = 3;
    const saves = f.saves;
    let ticks = 0;
    while (!run.encounter && ticks++ < 200) f.safari.tick([ticks < 100 ? "holdUp" : "holdLeft"]);
    expect(run.encounter).not.toBeNull();
    expect(f.saves).toBe(saves + 1);
  });

  it("asks before the gate ends the run, and staying keeps the hero inside", () => {
    const f = fixture();
    f.safari.enter(42);
    const run = f.safari.run!;
    for (let i = 0; i < 40 && !f.safari.confirmExit; i++) f.safari.tick(["holdDown"]);
    expect(f.safari.confirmExit).toBe(true);
    expect(f.safari.run).toBeDefined();
    const [, gateY] = map.exitTiles;
    expect(run.y).toBeLessThan(gateY * map.tileSize);
    f.safari.click(170, 190); // "Ở lại"
    expect(f.safari.confirmExit).toBe(false);
    expect(f.safari.run?.balls).toBe(30);
    for (let i = 0; i < 40 && !f.safari.confirmExit; i++) f.safari.tick(["holdDown"]);
    f.safari.click(70, 190); // "Rời khu"
    expect(f.safari.run).toBeUndefined();
  });

  it("only the drawn buttons act: a stray tap neither pays nor leaves", () => {
    const f = fixture();
    f.safari.open();
    f.safari.click(120, 300); // message bar
    f.safari.click(120, 250);
    expect(f.safari.run).toBeUndefined();
    expect(f.wallet.badges).toBe(100);
    f.safari.click(68, 228); // "Vào Safari"
    expect(f.safari.run?.balls).toBe(30);
    expect(f.wallet.badges).toBe(80);
    f.safari.run!.encounter = {
      pet: { speciesId: 29, quality: 2, level: 30 },
      effect: "neutral",
      turns: 0,
    };
    f.safari.click(200, 10); // "Rời"
    expect(f.safari.confirmExit).toBe(true);
    f.safari.click(30, 297); // the "Ném bóng" tile under the dialog
    f.safari.click(120, 300);
    expect(f.safari.run).toBeDefined();
    expect(f.safari.run!.balls).toBe(30);
    f.safari.click(200, 10);
    expect(f.safari.confirmExit).toBe(false);
    f.safari.leave();
    expect(f.safari.takeDeparture()).toBe(true);
    f.safari.open();
    f.safari.click(172, 228); // "Đóng"
    expect(f.safari.visible).toBe(false);
  });

  it("each command tile throws its own item, and the odds follow the pet's mood", () => {
    const f = fixture();
    f.safari.enter(42);
    const run = f.safari.run!;
    run.encounter = { pet: { speciesId: 29, quality: 2, level: 30 }, effect: "neutral", turns: 0 };
    expect(f.safari.odds).toEqual({ catch: 25, flee: 0 });
    f.safari.click(SAFARI_COMMANDS[1][0] + 5, SAFARI_COMMANDS[1][1] + 5);
    expect(f.safari.throwAnimation?.action).toBe("bait");
    expect(f.safari.odds?.catch).toBe(13);
    for (let i = 0; i < 30; i++) f.safari.tick([]);
    f.safari.click(SAFARI_COMMANDS[3][0] + 5, SAFARI_COMMANDS[3][1] + 5);
    expect(run.encounter).toBeNull();
    expect(run.balls).toBe(30);
  });

  it("allows one entry a day, opening again once the day turns", () => {
    const day = { today: 100 },
      f = fixture(day);
    f.safari.enter(42);
    expect(f.safari.run).toBeDefined();
    f.safari.leave();
    expect(f.safari.usedToday).toBe(true);
    f.safari.enter(42);
    expect(f.safari.run).toBeUndefined();
    expect(f.wallet.badges).toBe(80);
    expect(f.safari.message).toContain("0:00");
    day.today = 101;
    expect(f.safari.usedToday).toBe(false);
    f.safari.enter(42);
    expect(f.safari.run).toBeDefined();
    expect(f.wallet.badges).toBe(60);
  });

  it("sails in on entering and out once the run ends, holding input meanwhile", () => {
    const f = fixture();
    f.safari.enter(42);
    expect(f.safari.takeArrival()).toBe(true);
    expect(f.safari.takeArrival()).toBe(false);
    const run = f.safari.run!;
    run.balls = 1;
    run.encounter = { pet: { speciesId: 29, quality: 2, level: 30 }, effect: "neutral", turns: 0 };
    f.safari.act("ball");
    expect(f.safari.run).toBeUndefined();
    // The map stays up through the throw and a short read of the closing line, then the boat goes.
    expect(f.safari.departing?.run.encounter).toBeNull();
    expect(f.safari.takeDeparture()).toBe(false);
    for (let i = 0; i < 200 && !f.safari.takeDeparture(); i++) f.safari.tick(["confirm"]);
    expect(f.safari.visible).toBe(false);
    expect(f.wallet.badges).toBe(80);
  });

  it("plays the wild-battle entry wipe before an encounter takes commands", () => {
    const f = fixture();
    f.safari.enter(42);
    const run = f.safari.run!;
    run.steps = 1;
    for (let i = 0; i < 200 && !run.encounter; i++)
      f.safari.tick([i < 100 ? "holdUp" : "holdLeft"]);
    expect(f.safari.entryTick).toBe(0);
    f.safari.tick(["confirm"]);
    expect(run.balls).toBe(30);
    for (let i = 0; i < SAFARI_ENTRY_TICKS; i++) f.safari.tick([]);
    expect(f.safari.entryTick).toBe(-1);
    f.safari.tick(["confirm"]);
    expect(f.safari.throwAnimation?.action).toBe("ball");
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
