import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/** Node has no image decoder; the rooms never read pixels (see gameplayTrace.test.ts). */
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
const { applyUrlParityCheckpoint } = await import("../../dev/parityCheckpoints");
const { CV_PLANT, RAINBOW_RIDE_OWNED_EVENT } = await import("../ride/RideSystem");
const { BOY_ACCEPT_CHOICE, FOREST_GATE_TEXT, LUCY_CHOICE, MERCHANT_CHOICE, RUINS_GATE_TEXT } =
  await import("./CauVongOpening");
type OpeningDocument = import("./CauVongOpening").CauVongOpeningDocument;
type CuesDocument = import("./CauVongCutscene").CauVongCuesDocument;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
for (const room of [0, 1, 5, 6, 11, 54]) await assets.prepareRoom(98, room);

const read = (file: string) =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../public/pack", file), "utf8"));
const OPENING = read("cau-vong-world/opening.json") as OpeningDocument;
const CUES = read("cau-vong-world/cues.json") as CuesDocument;
const COLLISION = read("cau-vong-world/collision.json").rooms as Record<
  string,
  Record<string, { dx: number; dy: number }>
>;
const says = (name: string) =>
  OPENING.parts[name].steps.flatMap((cue) => (cue.k === "say" ? [cue.text] : []));
const flatten = (text: string) => text.replace(/#[0-9A-Fa-f]{6}/g, "").replace(/\s+/g, "");

/** Scene 98 past the square's arrival, `flags` ([room, event]) set, then `room` at (x, y). */
function enter(room: number, x: number, y: number, flags: [number, number][] = []) {
  const screen = new NewGameScreen(
    false,
    assets,
    boot,
    new SaveRepository(new MemorySaveStore()),
    () => {},
  );
  expect(applyUrlParityCheckpoint(screen, new URLSearchParams("cauVongRoom=0"))).toBe(true);
  const world = screen.host.world!;
  for (let tick = 0; tick < 3000 && world.eventVisible; tick++)
    world.tick(world.eventScene?.textReady ? ["confirm"] : []);
  for (const [r, event] of flags) world.eventState.op14CompleteEvent(98, r, event);
  world.warp({ scene: 98, room, x, y, direction: 0 });
  expect([world.sceneId, world.roomIndex]).toEqual([98, room]);
  return { world, screen };
}
type World = ReturnType<typeof enter>["world"];
const done = (world: World, room: number, event: number) =>
  world.eventState.sourceEventStateComplete(98, room, event);

/** Ticks, confirming every ready box, until nothing plays or a choice is open; the boxes seen. */
function play(world: World, limit = 20000): string[] {
  const seen: string[] = [];
  let quiet = 0;
  for (let tick = 0; tick < limit; tick++) {
    const scene = world.eventScene;
    if (scene?.choice) return seen;
    if (scene?.currentText && seen.at(-1) !== scene.currentText) seen.push(scene.currentText);
    quiet = world.eventVisible || world.phase !== "freeworld" ? 0 : quiet + 1;
    if (quiet > 3) return seen;
    world.tick(scene?.textReady ? ["confirm"] : []);
  }
  throw new Error("The room kept playing");
}
/** Every expected line was shown (boxes page long lines, so the start of each box is matched). */
const showed = (seen: string[], lines: string[]) =>
  lines.every((line) => seen.some((box) => flatten(line).startsWith(flatten(box).slice(0, 12))));
/** The hero just below the NPC's anchor, facing up, presses the key. */
function talk(world: World, id: number) {
  const actor = world.actors.get(id)!,
    mechanic =
      COLLISION[`98:${world.roomIndex}`]?.[String(id)] ??
      OPENING.extraMechanics[String(world.roomIndex)]?.[String(id)];
  world.player.x = actor.x + mechanic.dx;
  world.player.y = actor.y + mechanic.dy + 16;
  world.player.direction = 2;
  world.tick(["confirm"]);
}
/** The first tile of `room`'s map holding `terrain` with three open tiles of floor below it. */
function terrainEdge(room: number, terrain: string): { x: number; y: number } {
  const map = assets.getCollision(assets.getWorldRoom(98, room)!.mapId)!;
  for (let ty = 0; ty + 2 < map.heightTiles; ty++)
    for (let tx = 1; tx + 1 < map.widthTiles; tx++) {
      if (map.rows[ty][tx] !== terrain) continue;
      const below = [map.rows[ty + 1], map.rows[ty + 2]];
      if (below.every((row) => [tx - 1, tx, tx + 1].every((x) => row[x] === "0")))
        return { x: tx * 20 + 10, y: (ty + 1) * 20 + 8 };
    }
  throw new Error(`no ${terrain} edge in 98:${room}`);
}

describe("Cầu Vồng opening route (CV0 room 54 and CV1)", () => {
  it("bakes Java's sequences with their flags and checkpoints", () => {
    expect(OPENING.parts.FAMILY).toMatchObject({ room: 54, flag: 100, started: 134, cue: 245000 });
    expect(OPENING.parts.LUNCH_GIFT).toMatchObject({
      room: 1,
      flag: 101,
      started: 103,
      cue: 244000,
    });
    expect(OPENING.parts.LUNCH_DELIVERY).toMatchObject({ room: 11, flag: -1, started: 103 });
    expect(OPENING.parts.CITY_SOUTH).toMatchObject({ started: 843000, cue: 1600000 });
    expect(OPENING.parts.SWITCH_104).toMatchObject({ room: 5, flag: 104, started: 844104 });
    expect(OPENING.parts.INNER_SWITCH).toMatchObject({ room: 6, flag: 102, started: 7312 });
    expect(OPENING.parts.LUNCH_GIFT.steps.at(-2)).toMatchObject({ k: "say", speaker: "Tọa Kỵ" });
    expect(OPENING.parts.CITY_SOUTH.steps.at(-1)).toEqual({ k: "follow", id: -1 });
    expect(OPENING.items.lunch.name).toBe("Hộp cơm của Lucy");
    expect(OPENING.gates.map((g) => [g.room, g.event])).toEqual([
      [5, 103],
      [5, 104],
      [5, 105],
      [6, 102],
      // CV4a's south lever (`CauVongSwitchMechanisms`, 52).
      [52, 101],
    ]);
  });

  it("54: the grandfather's welcome plays once and the family leaves with it", () => {
    const { world } = enter(54, 410, 370);
    expect(world.actors.get(10)?.visible).toBe(true);
    talk(world, 10);
    const seen = play(world);
    expect(showed(seen, says("FAMILY").slice(0, 3))).toBe(true);
    expect(done(world, 54, 100)).toBe(true);
    expect(world.actors.get(10)?.visible).toBe(false);
    expect(world.actors.get(80)?.visible).toBe(false);
  });

  it("1: the arrival, Lucy's offer and her gift hand over the thorn mount and the lunch", () => {
    const { world } = enter(1, 80, 76, [[54, 100]]);
    const arrival = play(world);
    // `ambientSource` (CITY_GATHERING at the north door) runs ahead of `tickCity`'s arrival.
    expect(done(world, 1, OPENING.parts.CITY_GATHERING.flag)).toBe(true);
    expect(showed(arrival, says("CITY_ARRIVAL"))).toBe(true);
    expect(done(world, 1, 100)).toBe(true);
    talk(world, 1);
    expect(showed(play(world), says("LUCY_OFFER"))).toBe(true);
    expect(world.eventScene?.choice?.options).toEqual(LUCY_CHOICE);
    world.tick(["confirm"]);
    const gift = play(world);
    expect(showed(gift, says("LUNCH_GIFT"))).toBe(true);
    expect(done(world, 1, 101)).toBe(true);
    expect(done(world, 0, RAINBOW_RIDE_OWNED_EVENT + CV_PLANT)).toBe(true);
    expect(world.inventory[String(OPENING.items.lunch.id)]).toBe(1);
    // Asked again, Lucy only reminds the hero where Ca Tu is.
    talk(world, 1);
    expect(showed(play(world), says("LUCY_WAITING"))).toBe(true);
  });

  it("1: the south guard turns the hero back until Lucy's errand is accepted, and repeats", () => {
    const { world } = enter(1, 260, 560, [
      [54, 100],
      [1, 100],
    ]);
    for (let round = 0; round < 2; round++) {
      world.player.x = 255;
      world.player.y = 605;
      world.tick([]);
      expect(showed(play(world), says("CITY_SOUTH"))).toBe(true);
      expect(world.roomIndex).toBe(1);
      expect(world.player.y).toBeLessThan(600);
      expect(done(world, 1, OPENING.parts.CITY_SOUTH.started)).toBe(false);
    }
  });

  it("11: thorns stop the hero on foot and let Quả Tử Tiểu Tả through", () => {
    const { world } = enter(11, 80, 80, [
      [54, 100],
      [1, 100],
      [1, 101],
    ]);
    play(world);
    const edge = terrainEdge(11, "3");
    const tryStep = () => {
      world.player.x = edge.x;
      world.player.y = edge.y;
      world.player.direction = 2;
      world.tick(["up"]);
      return world.player.y < edge.y;
    };
    expect(tryStep()).toBe(false);
    expect(world.selectRide(CV_PLANT)).toBe("ready");
    expect(tryStep()).toBe(true);
  });

  it("11 → 5 → 6: the delivery, the switches and the inner egg finish CV1", () => {
    const { world } = enter(11, 80, 80, [
      [54, 100],
      [1, 100],
      [1, 101],
    ]);
    play(world);
    world.inventory[String(OPENING.items.lunch.id)] = 1;
    // The east gate first says why it is shut, once.
    world.player.x = 600;
    world.player.y = 110;
    world.tick([]);
    expect(play(world).map(flatten)).toEqual([flatten(FOREST_GATE_TEXT)]);
    expect(world.roomIndex).toBe(11);
    talk(world, 1);
    expect(showed(play(world), says("LUNCH_DELIVERY"))).toBe(true);
    expect(done(world, 11, 100)).toBe(true);
    expect(world.inventory[String(OPENING.items.lunch.id)] ?? 0).toBe(0);
    expect(world.inventory[String(OPENING.items.drink)]).toBeGreaterThan(0);
    world.player.x = 600;
    world.player.y = 110;
    world.tick([]);
    expect(world.roomIndex).toBe(5);
    while (world.mapLoading) world.tickMapLoading();

    expect(showed(play(world), says("RUINS_ARRIVAL"))).toBe(true);
    expect(done(world, 5, 100)).toBe(true);
    world.player.x = 50;
    world.player.y = 610;
    world.tick([]);
    expect(play(world).map(flatten)).toEqual([flatten(RUINS_GATE_TEXT)]);
    for (let i = 0; i < 3; i++) {
      const lever = world.actors.get(90 + i)!;
      world.player.x = lever.x;
      world.player.y = lever.y + 12;
      world.player.direction = 2;
      world.tick(["confirm"]);
      play(world);
      expect(done(world, 5, 103 + i)).toBe(true);
      expect(world.actors.get(90 + i)?.state).toBe(1);
    }
    world.player.x = 50;
    world.player.y = 610;
    world.tick([]);
    expect(world.roomIndex).toBe(6);
    while (world.mapLoading) world.tickMapLoading();

    expect(showed(play(world), [])).toBe(true);
    expect(done(world, 6, CUES.parts.INNER_INTRO.flag)).toBe(true);
    world.player.x = 130;
    world.player.y = 400;
    world.tick(["confirm"]);
    play(world);
    expect(done(world, 6, 100)).toBe(true);
    expect(done(world, 6, 101)).toBe(true);
    expect(world.actors.get(90)?.visible).toBe(false);
    expect(world.bag.specials).toContain(OPENING.items.plantEgg);
  });

  it("5: the merchant's scene gives its gift once and opens the shop menu", () => {
    const { world } = enter(5, 340, 94, [
      [54, 100],
      [5, 100],
    ]);
    talk(world, 1);
    play(world);
    expect(done(world, 5, 125)).toBe(true);
    expect(done(world, 5, 135)).toBe(true);
    expect(world.eventScene?.choice?.options).toEqual(MERCHANT_CHOICE);
    world.tick(["confirm"]);
    play(world);
    expect(world.takeServiceRequest()?.continuation).toBe("WORLD_ITEM_SHOP");
  });

  it("5: the boy's errand takes a Thiết Đầu, gives its reward and the extra gift once", () => {
    const { world } = enter(5, 340, 94, [
      [54, 100],
      [5, 100],
      // Lever 90 stands under the boy; `ruinsMechanisms.tick` runs ahead of the side quests.
      [5, 103],
      [5, 104],
      [5, 105],
    ]);
    play(world);
    expect(world.pets.length).toBeGreaterThan(0);
    const before = world.pets.length;
    talk(world, 50);
    play(world);
    expect(world.eventScene?.choice?.options).toEqual(BOY_ACCEPT_CHOICE);
    world.tick(["confirm"]);
    play(world);
    expect(done(world, 5, 120)).toBe(true);
    // Without a Thiết Đầu the boy only says what he wants.
    talk(world, 50);
    expect(showed(play(world), says("BOY_NO_PET"))).toBe(true);
    world.pets.push({ ...world.pets[0], speciesId: OPENING.boy.species, slot: before });
    talk(world, 50);
    play(world);
    expect(world.eventScene?.choice?.options.length).toBe(2);
    world.tick(["confirm"]);
    expect(showed(play(world), says("BOY_REWARD"))).toBe(true);
    expect(world.pets.length).toBe(before);
    expect(done(world, 5, 121)).toBe(true);
    expect(done(world, 5, 136)).toBe(true);
    talk(world, 50);
    expect(showed(play(world), says("BOY_DONE"))).toBe(true);
  });
  it.each(["family", "city", "lucy", "thorns", "delivery", "ruins", "merchant", "inner"])(
    "?cauVongOpening=%s stands on its room with a line typed out",
    (stage) => {
      const screen = new NewGameScreen(
        false,
        assets,
        boot,
        new SaveRepository(new MemorySaveStore()),
        () => {},
      );
      expect(applyUrlParityCheckpoint(screen, new URLSearchParams(`cauVongOpening=${stage}`))).toBe(
        true,
      );
      const world = screen.host.world!;
      if (stage === "thorns") expect(world.activeRideIndex).toBe(CV_PLANT);
      else expect(world.eventScene?.currentText).toBeTruthy();
    },
  );
});
