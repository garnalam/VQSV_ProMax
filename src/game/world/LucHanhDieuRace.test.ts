import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  RACE_WINDOW_MILLIS,
  formatRaceTime,
  raceReward,
  raceRewardTier,
  raceWindow,
} from "./LucHanhDieuRace";

/** Pack images are 1x1 stand-ins under Node; the host never reads pixels. */
vi.stubGlobal(
  "Image",
  class {
    complete = true;
    naturalWidth = 1;
    width = 1;
    height = 1;
    src = "";
  },
);
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

const { Pack } = await import("../../pack/Pack");
const { loadBootAssets } = await import("../../pack/boot");
const { GameAssets } = await import("../story/GameAssets");
const { scene1Save } = await import("../../dev/parityCheckpoints");
const { SCENE1_RESUME } = await import("../../persistence/save/migrations");
const { gameplaySources } = await import("../session/GameplayHost");
const { storyPlaythrough } = await import("../session/StoryPlaythrough");
const { DIRECTION_UP } = await import("./MapCollision");

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
const sources = gameplaySources(assets, boot);
const { standAt } = storyPlaythrough(sources, assets, boot.sourceEvents);

describe("race rules (RepeatableEconomyService, NguyenMocC4RaceRuntime)", () => {
  it("allows five starts per rolling day", () => {
    const now = 10_000_000;
    expect(raceWindow({ windowStart: 0, attempts: 3, petClaimed: false }, now)).toMatchObject({
      windowStart: now,
      used: 0,
      available: true,
    });
    expect(
      raceWindow({ windowStart: now - 1000, attempts: 5, petClaimed: false }, now),
    ).toMatchObject({ used: 5, available: false, remaining: 0 });
    expect(
      raceWindow({ windowStart: now - RACE_WINDOW_MILLIS, attempts: 5, petClaimed: false }, now),
    ).toMatchObject({ used: 0, available: true });
  });

  it("pays by time: the pet once under a minute, then 1000 / 750 kim", () => {
    expect(raceRewardTier(59_999)).toBe(0);
    expect(raceRewardTier(60_999)).toBe(0);
    expect(raceRewardTier(65_500)).toBe(1);
    expect(raceRewardTier(119_000)).toBe(2);
    expect(raceReward(0, false)).toEqual({ kind: "pet" });
    expect(raceReward(0, true)).toEqual({ kind: "money", money: 1000 });
    expect(raceReward(2, true)).toEqual({ kind: "money", money: 750 });
    expect(raceReward(5, false)).toEqual({ kind: "none" });
    expect(formatRaceTime(65_042)).toBe("1'05\"042");
  });
});

describe("Jill's race in 3:7", () => {
  async function atJill(money: number, race?: { windowStart: number; attempts: number }) {
    const save = scene1Save({
      location: { sceneId: 3, roomIndex: 7, x: 240, y: 48, direction: 0 },
      owner: SCENE1_RESUME.elderReturn,
      bunnyCaught: true,
      eventStates: { "1:1:0": 3 },
      pets: [{ speciesId: 68, level: 30, quality: 2 }],
    });
    const { host, world } = await standAt(
      { ...save, currency: { badges: 0, ...save.currency, money } },
      3,
      7,
      240,
      48,
      0,
    );
    let now = 1_000_000_000;
    world.clock = () => now;
    if (race) world.campaign.race = { ...race, petClaimed: false };
    const jill = world.actors.get(40)!;
    world.player.x = jill.x;
    world.player.y = jill.y + 20;
    world.player.direction = DIRECTION_UP;
    const lines: string[] = [];
    /** Step until `done`, answering every box and menu with its first row. */
    const run = (done: () => boolean, limit = 3000) => {
      for (let i = 0; i < limit && !done(); i++) {
        const scene = world.eventScene;
        if (scene?.textReady && scene.currentText && lines.at(-1) !== scene.currentText)
          lines.push(scene.currentText);
        host.step(i % 2 === 0 ? ["confirm"] : []);
      }
    };
    return { host, world, lines, run, advance: (ms: number) => (now += ms) };
  }

  it("a first run under a minute wins the Lục hành điểu and closes the first visit", async () => {
    const { world, lines, run, advance } = await atJill(2000);
    run(
      () => world.raceBlocksPanel && world.raceOverlay !== null && "elapsed" in world.raceOverlay,
    );
    expect(world.currency.money).toBe(1500);
    expect(world.campaign.race?.attempts).toBe(1);
    expect({ x: world.player.x, y: world.player.y }).toEqual({ x: 128, y: 72 });
    expect(world.eventState.sourceEventStateComplete(3, 7, 0)).toBe(true);
    advance(42_000);
    world.player.x = 240;
    world.player.y = 104;
    run(
      () =>
        world.phase !== "event" &&
        !world.raceBlocksPanel &&
        lines.includes("Đạt được Lục hành điểu"),
    );
    expect(world.pets.some((pet) => pet.speciesId === 54)).toBe(true);
    expect(world.campaign.race?.petClaimed).toBe(true);
    run(() => world.phase !== "event");
    expect({ x: world.player.x, y: world.player.y }).toEqual({ x: 240, y: 48 });
  }, 60000);

  it("time running out pays nothing", async () => {
    const { world, lines, run, advance } = await atJill(2000);
    run(() => world.raceOverlay !== null && "elapsed" in world.raceOverlay);
    advance(120_000);
    run(() => lines.includes("Hết giờ, bạn chưa về đích. Không nhận được phần thưởng."));
    run(() => world.phase !== "event");
    expect(world.raceBlocksPanel).toBe(false);
    expect(world.pets.some((pet) => pet.speciesId === 54)).toBe(false);
    expect(world.currency.money).toBe(1500);
  }, 60000);

  it("after five starts today Jill turns the hero away", async () => {
    const { world, lines, run } = await atJill(2000, {
      windowStart: 1_000_000_000 - 1000,
      attempts: 5,
    });
    world.eventState.op14CompleteEvent(3, 7, 0);
    run(() => lines.length > 0);
    run(() => world.phase !== "event");
    // The dialog pager drops the space where a line wraps (as for every box).
    expect(lines.map((line) => line.replace(/\s+/g, ""))).toEqual([
      "Đã đạt mức giới hạn trong hôm nay, không thể tiếp tục tham gia!".replace(/\s+/g, ""),
    ]);
    expect(world.currency.money).toBe(2000);
  }, 60000);
});
