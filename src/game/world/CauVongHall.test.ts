import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/** Node has no image decoder; the hall never reads pixels (see gameplayTrace.test.ts). */
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
const { MENU_OPTIONS } = await import("./CauVongHall");
type CuesDocument = import("./CauVongCutscene").CauVongCuesDocument;
type HallDocument = import("./CauVongHall").CauVongHallDocument;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
for (const room of [0, 47, 54]) await assets.prepareRoom(98, room);

const read = (file: string) =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../public/pack", file), "utf8"));
const CUES = read("cau-vong-world/cues.json") as CuesDocument;
const HALL = read("cau-vong-world/hall.json") as HallDocument;
const lines = (part: keyof CuesDocument["parts"]) =>
  CUES.parts[part].steps.flatMap((cue) => (cue.k === "say" ? [cue] : []));

/** The hall as the guide leads in: the square's arrival is behind the hero, `extra` flags set first. */
function hall(extra: number[] = []) {
  const screen = new NewGameScreen(
    false,
    assets,
    boot,
    new SaveRepository(new MemorySaveStore()),
    () => {},
  );
  expect(applyUrlParityCheckpoint(screen, new URLSearchParams("cauVongRoom=0"))).toBe(true);
  const world = screen.host.world!;
  // The square's arrival (already playing) is read through first.
  for (let tick = 0; tick < 3000 && world.eventVisible; tick++)
    world.tick(world.eventScene?.textReady ? ["confirm"] : []);
  expect(world.eventVisible).toBe(false);
  for (const event of extra) world.eventState.op14CompleteEvent(98, 47, event);
  world.warp({ scene: 98, room: 47, x: 200, y: 320, direction: 0 });
  expect([world.sceneId, world.roomIndex]).toEqual([98, 47]);
  return world;
}
type World = ReturnType<typeof hall>;
/** Confirms the open menu and lets its script write the answer. */
function answer(world: World) {
  world.tick(["confirm"]);
  for (let tick = 0; tick < 20 && world.eventVisible; tick++) world.tick([]);
  expect(world.eventVisible).toBe(false);
}
type Box = { speaker: string; text: string; mode: number; portrait: number };
const done = (world: World, event: number) =>
  world.eventState.sourceEventStateComplete(98, 47, event);

/**
 * Ticks while a script runs, confirming every box once it is ready; returns the boxes seen. Stops at
 * a choice (left open), or when nothing plays any more.
 */
function play(world: World, limit = 20000): Box[] {
  const seen: Box[] = [];
  let last: string | null = null;
  for (let tick = 0; tick < limit; tick++) {
    const scene = world.eventScene;
    if (scene?.choice) return seen;
    if (!world.eventVisible && tick > 0) {
      world.tick([]);
      if (!world.eventVisible) return seen;
    }
    if (scene?.currentText && scene.currentText !== last) {
      last = scene.currentText;
      seen.push({
        speaker: scene.currentSpeaker,
        text: scene.currentText,
        mode: scene.currentDialogMode,
        portrait: scene.currentPortrait,
      });
    }
    world.tick(scene?.textReady ? ["confirm"] : []);
  }
  throw new Error("The hall kept playing");
}
const flatten = (text: string) => text.replace(/#[0-9A-Fa-f]{6}/g, "").replace(/\s+/g, "");
/** Each line's first page is what the box shows first; compare those. */
const starts = (seen: Box[], expected: { text: string }[]) =>
  expected.every((line) =>
    seen.some((box) => flatten(line.text).startsWith(flatten(box.text).slice(0, 12))),
  );

describe("Đại sảnh Cúp Cầu Vồng (CauVongOpeningSourceRuntime, tickTournament)", () => {
  it("plays the final's introduction with its speakers and portraits, then offers the menu", () => {
    const world = hall();
    world.tick([]);
    const seen = play(world);
    const intro = lines("FINAL_INTRO");
    expect(seen.length).toBeGreaterThanOrEqual(intro.length);
    expect(seen[0]).toMatchObject({ speaker: intro[0].speaker, mode: 0 });
    expect(starts(seen, intro)).toBe(true);
    // Every line's portrait is the one `CauVongSourcePresentation.portrait` gives its speaker.
    for (const line of intro) {
      const box = seen.find((b) => b.speaker === line.speaker);
      expect(box?.portrait, line.speaker).toBe(line.portrait);
    }
    const part = CUES.parts.FINAL_INTRO;
    expect(done(world, part.started)).toBe(true);
    expect(done(world, part.flag)).toBe(true);
    for (let i = 0; i < part.steps.length; i++)
      expect(done(world, part.cue + i), String(i)).toBe(true);
    expect(world.eventScene?.choice?.options).toEqual(MENU_OPTIONS);
    // The cutscene leaves no curtain and the champion on stage.
    expect(world.cauVongPresentation.curtainHeight).toBe(0);
  });

  it("watching on plays the final and leaves for Sai Kỳ's home (98:54, 150, 239)", () => {
    const world = hall();
    world.tick([]);
    play(world);
    world.eventScene!.moveChoice(1);
    answer(world);
    expect(done(world, 7200)).toBe(true);
    expect(done(world, 7201)).toBe(false);
    const seen = play(world, 40000);
    expect(starts(seen, lines("FINAL_MATCH"))).toBe(true);
    expect(done(world, CUES.parts.FINAL_MATCH.flag)).toBe(true);
    expect(done(world, 100)).toBe(true);
    expect([world.sceneId, world.roomIndex, world.player.x, world.player.y]).toEqual([
      98, 54, 150, 239,
    ]);
    expect(world.player.visible).toBe(true);
    // 54's owner (`tickHousehold`) takes the hero in: no scene starts, no exit is under him.
    for (let i = 0; i < 5; i++) world.tick([]);
    expect([world.roomIndex, world.eventVisible, world.phase]).toEqual([54, false, "freeworld"]);
  });

  it("the terrain lesson comes first when picked, then the final", () => {
    const world = hall();
    world.tick([]);
    play(world);
    answer(world);
    expect(done(world, 7200)).toBe(true);
    expect(done(world, 7201)).toBe(true);
    const seen = play(world, 40000);
    const lesson = lines("TERRAIN_HELP")[0];
    expect(flatten(seen[0].text)).toBe(flatten(lesson.text).slice(0, flatten(seen[0].text).length));
    expect(done(world, CUES.parts.TERRAIN_HELP.flag)).toBe(true);
    expect(done(world, 100)).toBe(true);
  });

  it("a reload in the middle of the introduction resumes after the last finished cue", () => {
    const part = CUES.parts.FINAL_INTRO;
    // The first six cues (up to and including the second line) are behind the hero.
    const world = hall([part.started, ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => part.cue + i)]);
    world.tick([]);
    const seen = play(world);
    const intro = lines("FINAL_INTRO");
    const firstLeft = part.steps.slice(8).find((cue) => cue.k === "say");
    expect(firstLeft && "text" in firstLeft).toBe(true);
    expect(flatten(seen[0].text).slice(0, 10)).toBe(
      flatten((firstLeft as { text: string }).text).slice(0, 10),
    );
    expect(seen.length).toBeLessThan(intro.length + 10);
    expect(world.eventScene?.choice).not.toBeNull();
  });

  it("after the final: the stage is empty, spectators answer without a name tab", () => {
    const world = hall([100, 7000, 7002, 7100, 7102, 7200]);
    for (const id of [90, 91, 92]) expect(world.actors.get(id)?.visible, String(id)).toBe(false);
    world.tick([]);
    expect(world.eventVisible).toBe(false);
    for (const npc of HALL.npcs.filter((n) => n.actorId !== HALL.linh)) {
      const actor = world.actors.get(npc.actorId)!;
      if (!actor.visible) continue;
      world.player.x = actor.x + 10;
      world.player.y = actor.y + 19 + 16;
      world.player.direction = 2;
      world.tick(["confirm"]);
      if (!world.eventVisible) continue; // another spectator stands in front
      const seen = play(world);
      expect(seen[0]).toMatchObject({ speaker: npc.name, mode: -1 });
      expect(flatten(npc.line).startsWith(flatten(seen[0].text).slice(0, 10))).toBe(true);
      // A conversation plays over the world's cast: the final's fighters stay off the stage.
      for (const id of [90, 91, 92]) expect(world.actors.get(id)?.visible, String(id)).toBe(false);
    }
  });

  it("Linh asks her favour once, then repeats her reminder", () => {
    const world = hall([100, 7000, 7002, 7100, 7102, 7200]);
    const linh = world.actors.get(HALL.linh)!;
    const talk = () => {
      world.player.x = linh.x + 10;
      world.player.y = linh.y + 19 + 16;
      world.player.direction = 2;
      world.tick(["confirm"]);
      return play(world);
    };
    const first = talk();
    expect(starts(first, lines("LINH_REQUEST"))).toBe(true);
    expect(done(world, CUES.parts.LINH_REQUEST.flag)).toBe(true);
    const again = talk();
    expect(starts(again, lines("LINH_REPEAT"))).toBe(true);
  });

  it("once Locke's chain is over, Linh's return hands over her egg (Sói mặt trăng) once", () => {
    const request = CUES.parts.LINH_REQUEST;
    const world = hall([100, 7000, 7002, 7100, 7102, 7200, request.started, request.flag]);
    world.eventState.op14CompleteEvent(98, 39, 1302);
    const linh = world.actors.get(HALL.linh)!;
    const talk = () => {
      world.player.x = linh.x + 10;
      world.player.y = linh.y + 19 + 16;
      world.player.direction = 2;
      world.tick(["confirm"]);
      return play(world, 40000);
    };
    const eggs = () => world.bag.specials.filter((id) => id === 8068).length;
    expect(starts(talk(), lines("LINH_RETURN"))).toBe(true);
    expect(done(world, CUES.parts.LINH_RETURN.flag)).toBe(true);
    // `gift(47, 7300, 68, 1)`: CV-ITEM-0-68 is the Mãnh Thú egg; the source grants species egg 8068.
    expect(done(world, 7300)).toBe(true);
    expect(eggs()).toBe(1);
    const row = assets.campaignSystems?.eggs.find((egg) => egg.itemId === 8068);
    expect(row).toMatchObject({ hatch: "cauVong", incubator: { species: 196 } });
    // The receipt keeps a replay from granting it again.
    talk();
    expect(eggs()).toBe(1);
  });

  it("the south door returns to the square at (204, 554)", () => {
    const world = hall([100, 7000, 7002, 7100, 7102, 7200]);
    world.player.x = 200;
    world.player.y = 375;
    world.tick([]);
    expect([world.sceneId, world.roomIndex, world.player.x, world.player.y]).toEqual([
      98, 0, 204, 554,
    ]);
  });
});
