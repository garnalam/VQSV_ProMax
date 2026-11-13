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
type OpeningDocument = import("./CauVongOpening").CauVongOpeningDocument;
type CuesDocument = import("./CauVongCutscene").CauVongCuesDocument;
type PrepDocument = import("./CauVongPrep").CauVongPrepDocument;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
for (const room of [0, 1, 2, 44, 50, 54, 55]) await assets.prepareRoom(98, room);

const read = (file: string) =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../public/pack", file), "utf8"));
const OPENING = read("cau-vong-world/opening.json") as OpeningDocument;
const CUES = read("cau-vong-world/cues.json") as CuesDocument;
const COLLISION = read("cau-vong-world/collision.json").rooms as Record<
  string,
  Record<string, { dx: number; dy: number }>
>;
const flatten = (text: string) =>
  text
    .normalize("NFC")
    .replace(/#[0-9A-Fa-f]{6}/g, "")
    .replace(/\s+/g, "");

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
const PREP = read("cau-vong-world/prep.json") as PrepDocument;
const prepSays = (name: string) =>
  PREP.parts[name].steps.flatMap((cue) => (cue.k === "say" ? [cue.text] : []));
/** The hero just below a prep NPC's anchor (its snapshot or the cue actor's), facing up, presses. */
function ask(world: World, id: number) {
  const actor = world.actors.get(id)!,
    mechanic = COLLISION[`98:${world.roomIndex}`]?.[String(id)] ?? { dx: 0, dy: 0 };
  world.player.x = actor.x + mechanic.dx;
  world.player.y = actor.y + mechanic.dy + 16;
  world.player.direction = 2;
  world.tick(["confirm"]);
}
/** The open menu's answer `index`. */
function choose(world: World, index: number) {
  for (let i = 0; i < index; i++) world.tick(["down"]);
  world.tick(["confirm"]);
}
const EGG: [number, number] = [6, 100];
const says2 = (cue: { k: string }) => [(cue as unknown as { text: string }).text];

describe("Cầu Vồng CV2 (chăm trứng, chuẩn bị đi học)", () => {
  it("bakes Java's sequences with their flags and the quest rows", () => {
    expect(PREP.parts.JESS).toMatchObject({ room: 0, flag: 130, started: 132, cue: 235500 });
    expect(PREP.parts.STEWARD).toMatchObject({ room: 54, flag: 130, started: 132 });
    expect(PREP.parts.HOME_TUITION).toMatchObject({ room: 54, flag: 131, started: 133 });
    expect(PREP.parts.CITY_DONG).toMatchObject({ room: 1, flag: 810008, started: 811008 });
    expect(PREP.parts.ACADEMY_REGISTER).toMatchObject({ room: 2, flag: 140, started: 170 });
    expect(
      PREP.parts.HATCHERY_INTRO.steps.some((c) => c.k === "say" && c.text.includes("{n}")),
    ).toBe(true);
    expect(PREP.dong).toMatchObject({ species: 166, receipt: 824002, ride: 5 });
    expect(PREP.cafe.wanted).toEqual([116, 162, 148]);
    expect(PREP.academy.pass.id).toBe(9002);
    expect(OPENING.quests.map((q) => q.done)).toEqual([
      [51, 651111],
      [6, 100],
      [2, 101],
      [3, 102],
      [9, 114],
      [61, 105],
      [30, 124],
    ]);
  });

  it("0 → 54: Jess's lesson, the incubator, the walk home, then Rom's lesson and gift", () => {
    const { world } = enter(0, 200, 300, [EGG]);
    ask(world, 24);
    const lesson = play(world);
    expect(showed(lesson, prepSays("JESS"))).toBe(true);
    expect(done(world, 0, 130)).toBe(true);
    expect(done(world, 0, 101)).toBe(true);
    // `openingStoryAfter` opens the five-slot incubator; INCUBATOR_RETURN follows its close.
    expect(world.takeServiceRequest()?.continuation).toBe("CAU_VONG_INCUBATOR");
    expect(done(world, 0, CUES.parts.INCUBATOR_RETURN.flag)).toBe(true);
    expect(world.roomIndex).toBe(54);
    // Rom: the steward's scene first (it walks the hero back to the square)...
    world.eventState.op14CompleteEvent(98, 54, 100);
    world.warp({ scene: 98, room: 54, x: 410, y: 370, direction: 2 });
    ask(world, 12);
    expect(showed(play(world), prepSays("STEWARD"))).toBe(true);
    expect(done(world, 54, 130)).toBe(true);
    expect([world.roomIndex, world.player.x, world.player.y]).toEqual([0, 90, 199]);
    // ... then, Jess's lesson behind him, his tuition and the 10.000 kim.
    world.warp({ scene: 98, room: 54, x: 410, y: 370, direction: 2 });
    const money = world.currency.money;
    ask(world, 12);
    expect(showed(play(world), prepSays("HOME_TUITION"))).toBe(true);
    expect(done(world, 54, 131)).toBe(true);
    expect(world.currency.money).toBe(money + 10000);
  });

  it("55: the hatchery counts the species, unlocks at 40 and hands over the egg", () => {
    const { world } = enter(55, 115, 410, [EGG, [55, CUES.parts.MANOR_ARRIVAL.flag]]);
    play(world);
    ask(world, PREP.hatchery.npc);
    const intro = play(world);
    expect(intro.some((box) => flatten(box).includes("Bạnđãcó"))).toBe(true);
    expect(done(world, 55, 139)).toBe(true);
    // Under 40 species each reply ends in `nextChoice 7`: the incubator.
    expect(world.takeServiceRequest()?.continuation).toBe("CAU_VONG_INCUBATOR");
    ask(world, PREP.hatchery.npc);
    expect(showed(play(world), prepSays("HATCHERY_SHORT"))).toBe(true);
    expect(world.takeServiceRequest()?.continuation).toBe("CAU_VONG_INCUBATOR");
    for (let id = 100; id < 140; id++) world.collection.markCollected(id);
    ask(world, PREP.hatchery.npc);
    play(world);
    expect(world.eventScene?.choice?.options).toEqual([
      "Kiểm tra và mở khóa trứng",
      "Mở bảng ấp trước",
    ]);
    // "Mở bảng ấp trước" opens the incubator; asked again, the check unlocks.
    choose(world, 1);
    play(world);
    expect(world.takeServiceRequest()?.continuation).toBe("CAU_VONG_INCUBATOR");
    ask(world, PREP.hatchery.npc);
    play(world);
    choose(world, 0);
    expect(showed(play(world), prepSays("HATCHERY_UNLOCK"))).toBe(true);
    expect(done(world, 55, 128)).toBe(true);
    const [x, y, w, h] = PREP.hatchery.eggRect;
    world.player.x = x + w / 2;
    world.player.y = y + h / 2;
    world.tick(["confirm"]);
    const pick = play(world);
    expect(showed(pick, prepSays("HATCHERY_PICKUP"))).toBe(true);
    expect(done(world, 55, 123)).toBe(true);
  });

  it("1 → 44 → 50: Đông Phương's scene, his grant and the hub's first scene", () => {
    const { world } = enter(1, 260, 300, [[54, 100], [1, 100], EGG]);
    const pets = world.pets.length + world.meta.campaign.petBank.length;
    const seen = play(world);
    expect(showed(seen, prepSays("CITY_DONG"))).toBe(true);
    expect(done(world, 1, 10)).toBe(true);
    // The café plays Đông Phương's before-scene, the grant, then his after-scene up to the hub.
    for (let i = 0; i < 6 && !done(world, 50, 651100); i++) seen.push(...play(world));
    expect(done(world, 44, 4)).toBe(true);
    expect(done(world, 44, PREP.dong.receipt)).toBe(true);
    expect(done(world, 0, 700100 + PREP.dong.ride)).toBe(true);
    expect(world.pets.length + world.meta.campaign.petBank.length).toBe(pets + 1);
    expect([...world.pets, ...world.meta.campaign.petBank].some((p) => p.speciesId === 166)).toBe(
      true,
    );
    expect(world.roomIndex).toBe(50);
    expect(showed(seen, prepSays("DONG_AFTER"))).toBe(true);
    expect(showed(seen, prepSays("HUB_ARRIVAL"))).toBe(true);
    expect(done(world, 50, 651100)).toBe(true);
    expect(done(world, 50, PREP.parts.HUB_ARRIVAL.started)).toBe(false);
  });

  it("44: the collector's trade and the lift between the café and the hub", () => {
    const { world } = enter(44, 240, 480, [EGG, [1, 10], [44, 4], [44, 2], [50, 651100]]);
    play(world);
    ask(world, PREP.cafe.actor);
    expect(showed(play(world), prepSays("CAFE_OFFER_REPLY"))).toBe(true);
    expect(world.eventScene?.choice?.options).toEqual(["Có", "Không"]);
    expect(done(world, 44, 822002)).toBe(true);
    choose(world, 0);
    expect(showed(play(world), prepSays("CAFE_ACCEPT"))).toBe(true);
    expect(done(world, 44, 100)).toBe(true);
    expect(done(world, 44, 822002)).toBe(false);
    ask(world, PREP.cafe.actor);
    expect(showed(play(world), prepSays("CAFE_ACCEPT_REPLY"))).toBe(true);
    for (const species of PREP.cafe.wanted)
      world.meta.campaign.petBank.push({ ...world.pets[0], speciesId: species });
    ask(world, PREP.cafe.actor);
    for (let i = 0; i < 4 && !done(world, 44, 101); i++) play(world);
    expect(done(world, 44, PREP.cafe.receipt)).toBe(true);
    expect(done(world, 44, 101)).toBe(true);
    // The lift: up to the hub, and back down.
    world.eventState.op14CompleteEvent(98, 44, 6);
    world.player.x = 90;
    world.player.y = 70;
    world.tick(["confirm"]);
    play(world);
    expect(world.eventScene?.choice?.options).toEqual(["Leo lên", "Rời đi"]);
    choose(world, 0);
    play(world);
    expect([world.roomIndex, world.player.x, world.player.y]).toEqual([50, 450, 519]);
    world.player.x = 450;
    world.player.y = 530;
    world.tick(["confirm"]);
    play(world);
    expect(world.eventScene?.choice?.options).toEqual(["Xuống dưới", "Không xuống"]);
    choose(world, 0);
    play(world);
    expect([world.roomIndex, world.player.x, world.player.y]).toEqual([44, 90, 99]);
  });

  it("2: the arrival, the fee, the tuition and the registration finish CV2", () => {
    const { world } = enter(2, 72, 350, [EGG, [0, 101]]);
    expect(showed(play(world), prepSays("ACADEMY_ARRIVAL"))).toBe(true);
    expect(done(world, 2, 100)).toBe(true);
    world.currency.money = 100;
    ask(world, 1);
    expect(showed(play(world), prepSays("ACADEMY_FEE_REFUSED"))).toBe(true);
    expect(done(world, 2, 101)).toBe(false);
    world.currency.money = 20000;
    ask(world, 1);
    const seen = play(world);
    expect(showed(seen, prepSays("ACADEMY_TUITION"))).toBe(true);
    for (let i = 0; i < 3 && !done(world, 2, 101); i++) play(world);
    expect(done(world, 2, 101)).toBe(true);
    expect(world.currency.money).toBe(15000);
    expect(world.inventory["9002"]).toBe(1);
    ask(world, 1);
    expect(showed(play(world), says2(PREP.academy.guide.registered))).toBe(true);
  });

  it.each(["jess", "steward", "hatchery", "dong", "cafe", "hub", "academy", "register"])(
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
      expect(screen.host.world!.eventScene?.currentText).toBeTruthy();
    },
  );
});
