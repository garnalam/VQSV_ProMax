import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/** Node has no image decoder; the square never reads pixels (see gameplayTrace.test.ts). */
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
const { cauVongSquareScript } = await import("./CauVongSquare");
type InputCommand = import("../../core/input/GameCommand").InputCommand;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
for (const room of [0, 1, 47, 54, 55]) await assets.prepareRoom(98, room);
await assets.prepareRoom(8, 1);

function square() {
  const screen = new NewGameScreen(
    false,
    assets,
    boot,
    new SaveRepository(new MemorySaveStore()),
    () => {},
  );
  const params = new URLSearchParams("cauVongRoom=0");
  expect(checkpointRooms(params)).toEqual([[98, 0]]);
  expect(applyUrlParityCheckpoint(screen, params)).toBe(true);
  return screen.host.world!;
}
type World = ReturnType<typeof square>;

/** The speaker and text of the box on screen, or null. */
const box = (world: World) => {
  const scene = world.eventScene;
  return scene?.currentText
    ? { speaker: scene.currentSpeaker, text: scene.currentText, mode: scene.currentDialogMode }
    : null;
};

/** Ticks until the conversation ends, pressing 5 every few ticks; returns each box it saw. */
type Box = { speaker: string; text: string; mode: number };
function talkThrough(world: World): Box[] {
  const seen: Box[] = [];
  for (let tick = 0; tick < 2000 && world.eventVisible; tick++) {
    const shown = box(world);
    if (shown && seen.at(-1)?.text !== shown.text) seen.push(shown);
    world.tick(tick % 4 === 3 ? ["confirm"] : []);
  }
  expect(world.eventVisible).toBe(false);
  return seen;
}

/** Stand the hero at (x, y) facing `direction` and press 5 once. */
function press(world: World, x: number, y: number, direction: number, keys: InputCommand[] = []) {
  world.player.x = x;
  world.player.y = y;
  world.player.direction = direction;
  world.tick(["confirm", ...keys]);
}

/**
 * The typed text with its colour tag and every space gone: the pager drops the space at each line
 * break (`TextLayout.paginate`), so only the letters are compared.
 */
const flatten = (text: string) => text.replace(/#[0-9A-Fa-f]{6}/g, "").replace(/\s+/g, "");
const read = (file: string) =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../public/pack", file), "utf8"));
const SQUARE = read("cau-vong-world/square.json") as {
  intro: string[];
  npcs: { actorId: number; name: string; line: string }[];
};
const UP = 2;

describe("Quảng Trường Cầu Vồng (CauVongChapterRuntime.tickSquare)", () => {
  it("plays the three arrival lines once, checkpointing each, then completes event 100", () => {
    const world = square();
    world.tick([]);
    expect(world.eventVisible).toBe(true);
    const seen = talkThrough(world);
    expect(seen.map((shown) => flatten(shown.text))).toEqual(SQUARE.intro.map(flatten));
    // `CauVongCutsceneSequence.dialogue`: mode 0, an empty speaker tab.
    expect(seen.every((shown) => shown.speaker === "" && shown.mode === 0)).toBe(true);
    for (const event of [200, 201, 202, 100])
      expect(world.eventState.sourceEventStateComplete(98, 0, event), String(event)).toBe(true);
    world.tick([]);
    expect(world.eventVisible).toBe(false);
  });

  it("resumes the arrival from the first line not yet checkpointed", () => {
    const done = new Set(["0:200"]);
    const script = cauVongSquareScript(SQUARE, {
      done: (room, event) => done.has(`${room}:${event}`),
      requested: () => false,
      confirm: false,
      player: { x: 0, y: 0 },
    })!;
    const texts = script.events.flatMap((event) => (event.type === "text" ? [event.text] : []));
    expect(texts).toEqual(SQUARE.intro.slice(1));
  });

  it("talks with each resident by its baked name and line, facing its displayed foot", () => {
    const world = square();
    world.tick([]);
    talkThrough(world);
    for (const npc of SQUARE.npcs) {
      const actor = world.actors.get(npc.actorId)!;
      // Below the NPC's foot (x + 10, y + 19), looking up at it.
      press(world, actor.x + 10, actor.y + 19 + 16, UP);
      expect(world.eventVisible, npc.name).toBe(true);
      const seen = talkThrough(world);
      // `TextBox.dialog(..., -1, -1)`: no speaker tab.
      expect(seen.map((shown) => [shown.speaker, flatten(shown.text), shown.mode])).toEqual([
        [npc.name, flatten(npc.line), -1],
      ]);
    }
  });

  it("does not answer the key from behind or out of reach", () => {
    const world = square();
    world.tick([]);
    talkThrough(world);
    const steward = world.actors.get(24)!;
    press(world, steward.x + 10, steward.y + 19 + 16, 0);
    expect(world.eventVisible).toBe(false);
    press(world, steward.x + 10, steward.y + 19 + 60, UP);
    expect(world.eventVisible).toBe(false);
  });

  it("the guide leads into Đại sảnh Cúp Cầu Vồng (98:47)", () => {
    const world = square();
    world.tick([]);
    talkThrough(world);
    const guide = world.actors.get(1)!;
    press(world, guide.x + 10, guide.y + 19 + 16, UP);
    const seen = talkThrough(world);
    expect(seen[0].speaker).toBe("Lính dẫn đường");
    expect([world.sceneId, world.roomIndex, world.player.x, world.player.y]).toEqual([
      98, 47, 200, 320,
    ]);
    expect(world.player.direction).toBe(0);
  });

  it("the portal square asks first, then returns to the tribe at 8:1 (200, 245)", () => {
    const world = square();
    world.tick([]);
    talkThrough(world);
    press(world, 100, 540, UP);
    const seen = talkThrough(world);
    expect(seen[0].speaker).toBe("Cổng truyền tống");
    expect([world.sceneId, world.roomIndex, world.player.x, world.player.y]).toEqual([
      8, 1, 200, 245,
    ]);
  });

  it("reads the sign, and the three exits place the hero where `transition` does", () => {
    const world = square();
    world.tick([]);
    talkThrough(world);
    press(world, 280, 540, UP);
    expect(talkThrough(world)[0]).toEqual({
      speaker: "Biển chỉ dẫn",
      text: expect.stringContaining("Trang viên nhà Sai Kỳ"),
      mode: -1,
    });
    for (const [x, y, room, ax, ay] of [
      [188, 250, 54, 410, 370],
      [208, 430, 55, 115, 410],
      [210, 610, 1, 80, 76],
    ]) {
      const fresh = square();
      talkThrough(fresh);
      fresh.player.x = x;
      fresh.player.y = y;
      fresh.tick([]);
      expect([fresh.sceneId, fresh.roomIndex, fresh.player.x, fresh.player.y]).toEqual([
        98,
        room,
        ax,
        ay,
      ]);
    }
  });

  it("once the ruins egg is found the steward's lesson (CV2) comes first, then his advice", () => {
    const world = square();
    talkThrough(world);
    world.eventState.op14CompleteEvent(98, 6, 100);
    const steward = world.actors.get(24)!;
    press(world, steward.x + 10, steward.y + 19 + 16, UP);
    // `openingStory.tick` runs ahead of the residents: Jess's lesson, then the walk home (54).
    for (let i = 0; i < 20000 && world.roomIndex === 0; i++)
      world.tick(world.eventScene?.textReady ? ["confirm"] : []);
    expect(world.eventState.sourceEventStateComplete(98, 0, 130)).toBe(true);
    expect(world.eventState.sourceEventStateComplete(98, 0, 101)).toBe(true);
    talkThrough(world);
    world.warp({ scene: 98, room: 0, x: 200, y: 300, direction: 0 });
    press(world, steward.x + 10, steward.y + 19 + 16, UP);
    expect(flatten(talkThrough(world)[0].text)).toContain(flatten("Giờ hãy đến Học viện"));
  });

  it("standing NPCs block the hero by their floor footprint", () => {
    const world = square();
    world.tick([]);
    talkThrough(world);
    const steward = world.actors.get(24)!,
      footX = steward.x + 10,
      footY = steward.y + 19;
    world.player.x = footX;
    world.player.y = footY + 30;
    world.player.direction = UP;
    for (let i = 0; i < 40; i++) world.tick(["up"]);
    // The hero stops against the footprint (bottom edge footY + 7) instead of walking through.
    expect(world.player.y).toBeGreaterThan(footY);
    expect(world.player.x).toBe(footX);
  });
});
