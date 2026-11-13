import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(
    import.meta.dirname,
    "../../../public",
    decodeURIComponent(String(input).split("?")[0].replace(/^\//, "")),
  );
  if (!existsSync(file)) return { ok: false, status: 404 };
  const bytes = readFileSync(file);
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(bytes.toString("utf8")),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
  };
});

const { GameData } = await import("../../data/GameData");
const { Pack } = await import("../../pack/Pack");
const { loadBattleRules } = await import("./BattleRules");
const {
  StateOneLEffectTracker,
  lEffectDraws,
  lEffectFrameCount,
  loopedCursor,
  paintLEffectPixels,
} = await import("./StateOneLEffect");

const rules = await loadBattleRules(new GameData(await Pack.load()));
const catalog = rules.lEffect!;

describe("state-1 L effect (tickP7LEffect / drawState1LEffect)", () => {
  it("knows the nine species of state1LEffectSpeffectId with their speffect rows", () => {
    const species = catalog.all.map((entry) => [entry.species, entry.speffect, entry.row[0]]);
    expect(species).toEqual([
      [0, 27, 11],
      [10, 28, 15],
      [62, 24, 13],
      [75, 20, 11],
      [87, 21, 12],
      [91, 26, 14],
      [92, 25, 11],
      [97, 23, 13],
      [98, 23, 13],
    ]);
    expect(catalog.entry(10)?.drawAfter).toBe(true);
    expect(catalog.entry(75)?.drawAfter).toBe(false);
    expect(catalog.entry(68)).toBeUndefined();
  });

  it("counts frames as p7LEffectFrameCount does", () => {
    expect(lEffectFrameCount(catalog.entry(75)!.row)).toBe(3); // type 11
    expect(lEffectFrameCount(catalog.entry(87)!.row)).toBe(6); // type 12
    expect(lEffectFrameCount(catalog.entry(97)!.row)).toBe(3); // type 13
    expect(lEffectFrameCount(catalog.entry(91)!.row)).toBe(4); // type 14
    expect(lEffectFrameCount(catalog.entry(10)!.row)).toBe(7); // type 15
  });

  it("steps the looped cursor like SpriteAnimator.cursorAtElapsedTick", () => {
    const ticks = [2, 1, 1];
    expect([0, 1, 2, 3, 4, 5, 6].map((t) => loopedCursor(ticks, t))).toEqual([0, 0, 1, 2, 0, 0, 1]);
    expect(loopedCursor([], 9)).toBe(0);
  });

  it("starts on state 1 cursor 1, plays its frames once, then waits for the next cursor 1", () => {
    const entry = catalog.entry(75)!, // state 1 durations [2, 1, ...]: cursor 1 at elapsed 2
      tracker = new StateOneLEffectTracker<string>(),
      seen: (number | undefined)[] = [];
    tracker.tick(entry, "player", 0, 2); // not state 1
    seen.push(tracker.view?.frame);
    for (let elapsed = 0; elapsed < 6; elapsed++) {
      tracker.tick(entry, "player", 1, elapsed);
      seen.push(tracker.view?.frame);
    }
    // elapsed 2 starts it (frame 0), then 1, 2, and at 3 ticks it ends.
    expect(seen).toEqual([undefined, undefined, undefined, 0, 1, 2, undefined]);
    expect(tracker.view).toBeUndefined();
    tracker.tick(undefined, "player", 1, 2);
    expect(tracker.view).toBeUndefined();
  });

  it("places type 11 copies with their tints", () => {
    expect(lEffectDraws(catalog.entry(75)!.row, 0)).toEqual([
      { paint: { kind: "tint", a: 200, r: 209, g: 209, b: 155 }, dx: -12, dy: 0 },
      { paint: { kind: "tint", a: 200, r: 239, g: 224, b: 142 }, dx: -27, dy: 1 },
      { paint: { kind: "tint", a: 200, r: 255, g: 254, b: 227 }, dx: -41, dy: 1 },
    ]);
  });

  it("places type 12's two alpha copies, the second one first", () => {
    expect(lEffectDraws(catalog.entry(87)!.row, 0)).toEqual([
      { paint: { kind: "alpha", a: 180 }, dx: 0, dy: 0 },
      { paint: { kind: "alpha", a: 255 }, dx: -17, dy: -9 },
    ]);
  });

  it("places type 15's one copy per frame, tinted by its index", () => {
    const row = catalog.entry(10)!.row;
    expect(lEffectDraws(row, 0)).toEqual([
      { paint: { kind: "tint", a: 150, r: 222, g: 120, b: 28 }, dx: 0, dy: 0 },
    ]);
    expect(lEffectDraws(row, 1)[0]).toMatchObject({ dx: 0, dy: -25 });
  });

  it("colours pixels as tintOpaque, adjustRgb and alphaCopy, keeping clear pixels clear", () => {
    const pixels = () => new Uint8ClampedArray([10, 20, 30, 255, 255, 255, 255, 0]);
    const tint = pixels();
    paintLEffectPixels(tint, { kind: "tint", a: 200, r: 1, g: 2, b: 3 });
    expect([...tint]).toEqual([1, 2, 3, 200, 255, 255, 255, 0]);
    const adjust = pixels();
    paintLEffectPixels(adjust, { kind: "adjust", multiply: 1, add: 50 });
    expect([...adjust]).toEqual([60, 70, 80, 255, 255, 255, 255, 0]);
    const alpha = pixels();
    paintLEffectPixels(alpha, { kind: "alpha", a: 120 });
    expect([...alpha]).toEqual([10, 20, 30, 120, 255, 255, 255, 0]);
  });
});
