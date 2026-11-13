import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/** Node has no image decoder: every pack image is a loaded 1x1 stand-in, the data the real files. */
class StubImage {
  complete = true;
  naturalWidth = 1;
  naturalHeight = 1;
  width = 1;
  height = 1;
  src = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
}
vi.stubGlobal("Image", StubImage);
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
const { MemorySaveStore } = await import("../../persistence/save/SaveStore");
const { SaveRepository } = await import("../../persistence/SaveRepository");
const { NewGameScreen } = await import("../../screens/NewGameScreen");
const { applyUrlParityCheckpoint, checkpointRooms } = await import("../../dev/parityCheckpoints");
const { mirroredPetArt } = await import("../../rendering/BattleRenderer");
const { TAN_NGUYET_BOSS, TAN_NGUYET_LONG_MA } = await import("../battle/engine/TanNguyetLongMa");
const { TAN_NGUYET_ACTOR_ID, TAN_NGUYET_WORLD_TEXT, tanNguyetStatueAnchor, withinTanNguyetReach } =
  await import("./TanNguyetBossWorld");

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
assets.battleServices.seedSource = () => 0;

/** The hero 30 px below the boss in 5:3, the checkpoint's party, and the screen live again. */
async function standBeforeBoss(stage: "room" | "blocked") {
  const screen = new NewGameScreen(
      false,
      assets,
      boot,
      new SaveRepository(new MemorySaveStore()),
      () => {},
    ),
    params = new URLSearchParams(`tanNguyet=${stage}`);
  for (const [scene, room] of checkpointRooms(params)) await assets.prepareRoom(scene, room);
  expect(applyUrlParityCheckpoint(screen, params)).toBe(true);
  screen.frozen = false;
  return { screen, world: screen.host.world! };
}

describe("Tàn Nguyệt Long Ma in Cứ điểm Thánh Điện", () => {
  it("finds the statue it replaces only in 5:3, and reaches 34 px around its foot", () => {
    const statue = {
      id: 36,
      sprite: 289,
      direction: 8,
      x: 337,
      y: 368,
      state: 8,
      variant: 0,
      renderOffsetX: 0,
      renderOffsetY: 0,
      visible: true,
      layer: 1,
      animationTick: 0,
    };
    expect(tanNguyetStatueAnchor(5, 3, [statue])).toBe(statue);
    expect(tanNguyetStatueAnchor(5, 2, [statue])).toBeNull();
    expect(tanNguyetStatueAnchor(5, 3, [{ ...statue, direction: 0 }])).toBeNull();
    expect(withinTanNguyetReach({ x: 337, y: 402 }, statue)).toBe(true);
    expect(withinTanNguyetReach({ x: 337 + 24, y: 368 + 25 }, statue)).toBe(false);
  });

  it("stands idle on the statue's spot, the statue hidden", async () => {
    const { world } = await standBeforeBoss("room");
    const boss = world.actors.get(TAN_NGUYET_ACTOR_ID)!;
    expect([world.sceneId, world.roomIndex]).toEqual([5, 3]);
    expect([boss.visible, boss.sprite, boss.x, boss.y, boss.state]).toEqual([
      true,
      TAN_NGUYET_LONG_MA.spriteId,
      337,
      368,
      0,
    ]);
    expect(world.actors.get(36)?.visible).toBe(false);
  });

  it("refuses a party short of six with a notice that closes on 5", async () => {
    // The `blocked` checkpoint has already pressed 5 within reach.
    const { screen, world } = await standBeforeBoss("blocked");
    expect(world.tanNguyetNotice).toBe(
      "Cần đủ 6 sủng vật trong đội hình để khiêu chiến Tàn Nguyệt Long Ma. Hiện có: 2/6.",
    );
    expect(world.doubleBattle).toBeNull();
    screen.step(["back"]);
    expect(screen.host.panel.visible).toBe(false);
    screen.step(["confirm"]);
    expect(world.tanNguyetModalVisible).toBe(false);
  });

  it("opens the Ma Mộc Cộng Sinh 2v2 for six level-50 pets", async () => {
    const { screen, world } = await standBeforeBoss("room");
    screen.step(["confirm"]);
    expect(world.phase).toBe("battleEntry");
    // `Mode(0, 2)`: the entry transition closes in alternating columns.
    expect(world.battleEntryMode).toBe(2);
    const core = world.doubleBattle!.core;
    expect([core.setupOf(0).speciesId, core.setupOf(1).speciesId]).toEqual([
      TAN_NGUYET_BOSS.allySpeciesId,
      TAN_NGUYET_LONG_MA.speciesId,
    ]);
    expect(world.actors.get(TAN_NGUYET_ACTOR_ID)?.visible).toBe(false);
  });

  it("pays the win once, shows the reward notice, then refuses a second challenge", async () => {
    const { screen, world } = await standBeforeBoss("room");
    const money = world.currency.money,
      badges = world.currency.badges,
      bank = world.meta.campaign.petBank.length;
    world.finishTanNguyetBattle(true);
    expect(world.currency.money).toBe(money + 50000);
    expect(world.currency.badges).toBe(badges + 100);
    const reward = world.meta.campaign.petBank.at(-1)!;
    expect(world.meta.campaign.petBank.length).toBe(bank + 1);
    expect([reward.speciesId, reward.level, reward.slot]).toEqual([2, 5, bank]);
    expect(world.flags.hasSourceWorldFlag(TAN_NGUYET_BOSS.victoryCompletedFlag)).toBe(true);
    expect(world.tanNguyetNotice).toBe(TAN_NGUYET_WORLD_TEXT.victory);
    screen.step(["confirm"]);
    expect(world.tanNguyetModalVisible).toBe(false);
    expect(world.flags.hasSourceWorldFlag(TAN_NGUYET_BOSS.victoryNoticeSeenFlag)).toBe(true);
    screen.step(["confirm"]);
    expect(world.tanNguyetNotice).toBe(TAN_NGUYET_WORLD_TEXT.alreadyDefeated);
    expect(world.doubleBattle).toBeNull();
  });

  it("holds the defeat card eight ticks, then returns the hero to the save point", async () => {
    const { screen, world } = await standBeforeBoss("room");
    world.finishTanNguyetBattle(false);
    expect(world.tanNguyetDefeatCardVisible).toBe(true);
    for (let i = 0; i < 6; i++) screen.step(["confirm"]);
    // A press before `MINIMUM_TICKS` is remembered and honoured on the eighth tick.
    world.pointer(10, 10);
    screen.step([]);
    expect(world.tanNguyetDefeatCardVisible).toBe(true);
    screen.step([]);
    expect(world.tanNguyetDefeatCardVisible).toBe(false);
    expect(world.phase).toBe("freeworld");
  });

  it("stays drawn in an event group's own actor map in 5:3, the statue hidden there too", async () => {
    const { screen, world } = await standBeforeBoss("room");
    // A room script (a chest notice) is the smallest event group the world can run here.
    (
      world as unknown as {
        startScript(ref: object, id: string, events: object[]): void;
      }
    ).startScript({ scene: 5, room: 3, group: -1 }, "test:boss-event", [
      {
        type: "text",
        text: "Thử",
        wait: true,
        kind: "openbox",
        box: { x: 47, y: 154, width: 146, height: 26 },
      },
    ]);
    screen.step([]);
    expect(world.phase).toBe("event");
    const actors = world.eventScene!.actors,
      boss = actors.get(TAN_NGUYET_ACTOR_ID);
    expect([boss?.visible, boss?.x, boss?.y, boss?.sprite]).toEqual([true, 337, 368, 3004]);
    expect(actors.get(36)?.visible).toBe(false);
    // Lent for drawing only: the world keeps one boss, still animated once a tick.
    const before = world.actors.get(TAN_NGUYET_ACTOR_ID)!.animationTick;
    screen.step([]);
    expect(world.actors.get(TAN_NGUYET_ACTOR_ID)!.animationTick).toBe(before + 1);
  });

  it("reopens an unread reward notice when a later rematch returns to the map", async () => {
    const { world } = await standBeforeBoss("room");
    world.flags.mutateSourceWorldFlag(0, TAN_NGUYET_BOSS.victoryCompletedFlag);
    expect(world.tanNguyetModalVisible).toBe(false);
    (world as unknown as { resumeAfterBattle(): void }).resumeAfterBattle();
    expect(world.tanNguyetNotice).toBe(TAN_NGUYET_WORLD_TEXT.victory);
    world.flags.mutateSourceWorldFlag(0, TAN_NGUYET_BOSS.victoryNoticeSeenFlag);
    world.tick(["confirm"]);
    (world as unknown as { resumeAfterBattle(): void }).resumeAfterBattle();
    expect(world.tanNguyetModalVisible).toBe(false);
  });

  it("mirrors the boss art on either side, Cầu Vồng and V4 art only on the player's", () => {
    expect([mirroredPetArt(3004, false), mirroredPetArt(3004, true)]).toEqual([true, true]);
    expect([mirroredPetArt(1000, false), mirroredPetArt(1000, true)]).toEqual([false, true]);
    expect([mirroredPetArt(68, false), mirroredPetArt(68, true)]).toEqual([false, false]);
  });
});
