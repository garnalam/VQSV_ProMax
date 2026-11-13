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
const { LOCKE_CHOICE, LOCKE_LOST, LOCKE_POST, LOCKE_PRE, LOCKE_WON } =
  await import("./CauVongLocke");
type LockeDocument = import("./CauVongLocke").CauVongLockeDocument;
type HallDocument = import("./CauVongHall").CauVongHallDocument;
type CuesDocument = import("./CauVongCutscene").CauVongCuesDocument;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
for (const room of [0, 32, 39, 47, 52]) await assets.prepareRoom(98, room);

const read = (file: string) =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../public/pack", file), "utf8"));
const LOCKE = read("cau-vong-world/locke.json") as LockeDocument;
const HALL = read("cau-vong-world/hall.json") as HallDocument;
const CUES = read("cau-vong-world/cues.json") as CuesDocument;
const says = (name: keyof LockeDocument["parts"]) =>
  LOCKE.parts[name].steps.flatMap((cue) => (cue.k === "say" ? [cue] : []));

/** Scene 98 with the opening behind the hero, `flags` ([room, event]) set, then `room` at (x, y). */
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
  // A party that can stand Lạc Khắc's level-80+ roster: the tests are about the chain, not damage.
  for (const pet of world.pets) {
    pet.level = 100;
    pet.currentHp = undefined;
  }
  world.warp({ scene: 98, room, x, y, direction: 0 });
  expect([world.sceneId, world.roomIndex]).toEqual([98, room]);
  return world;
}
type World = ReturnType<typeof enter>;
const done = (world: World, room: number, event: number) =>
  world.eventState.sourceEventStateComplete(98, room, event);
const flatten = (text: string) => text.replace(/#[0-9A-Fa-f]{6}/g, "").replace(/\s+/g, "");

/**
 * Ticks, confirming every ready box and winning (or losing) any fight, until nothing plays or a
 * choice is open. Returns the boxes seen and the rosters fought.
 */
function play(world: World, lose = false, limit = 30000) {
  const seen: string[] = [];
  const fights: number[][] = [];
  let quiet = 0,
    last: unknown = null;
  for (let tick = 0; tick < limit; tick++) {
    const battle = world.battle;
    if (battle) {
      if (battle !== last) {
        last = battle;
        fights.push(enemySpecies(battle));
      }
      const foe = battle.core?.activeUnit("enemy"),
        mine = battle.core?.activeUnit("player");
      if (lose) {
        if (mine?.alive()) mine.setHp(1);
        if (foe?.alive()) foe.setHp(foe.maxHp());
      } else {
        if (foe?.alive()) foe.setHp(1);
        if (mine?.alive()) mine.setHp(mine.maxHp());
      }
      world.tick(["confirm"]);
      continue;
    }
    const scene = world.eventScene;
    if (scene?.choice) return { seen, fights };
    if (scene?.currentText && seen.at(-1) !== scene.currentText) seen.push(scene.currentText);
    const busy = world.eventVisible || world.phase !== "freeworld";
    quiet = busy ? 0 : quiet + 1;
    if (quiet > 3) return { seen, fights };
    world.tick(scene?.textReady || world.phase === "battleReport" ? ["confirm"] : []);
  }
  throw new Error("The chain kept playing");
}
function enemySpecies(battle: NonNullable<World["battle"]>): number[] {
  const core = battle.core!;
  const ids: number[] = [];
  for (let i = 0; i < 6; i++) {
    try {
      ids.push(core.enemySetup(i).speciesId);
    } catch {
      break;
    }
  }
  return ids;
}
const species = (key: string) => LOCKE.battles[key].members.map(([id]) => id);
const starts = (seen: string[], expected: { text: string }[]) =>
  expected.every((line) =>
    seen.some((box) => flatten(line.text).startsWith(flatten(box).slice(0, 12))),
  );

/** What the rescue needs: the laboratory's end, its farewell, and Linh's request. */
const RESCUE_GATES: [number, number][] = [
  LOCKE.gates.labComplete,
  LOCKE.gates.labFarewell,
  LOCKE.gates.linhRequest,
];

describe("Lạc Khắc's chain (CauVongLockeChainRuntime)", () => {
  it("bakes Java's parts, rosters and gates", () => {
    expect(Object.keys(LOCKE.parts)).toEqual([
      "SOUTH_PRE",
      "SOUTH_POST",
      "RESCUE_PRE",
      "RESCUE_POST",
      "LAST_INTRO",
      "LAST_PRE",
      "LAST_POST",
      "DECLINE",
    ]);
    expect(LOCKE.parts.RESCUE_POST).toMatchObject({
      room: 39,
      event: 6,
      flag: 1302,
      started: 1402,
    });
    expect(species("39")).toEqual([131, 154, 165]);
    expect(species("52r")).toHaveLength(3);
    expect(species("32")).toHaveLength(5);
    expect(LOCKE.gates.linhRequest).toEqual([47, CUES.parts.LINH_REQUEST.flag]);
  });

  it("39 stays empty until the laboratory and Linh's request are behind the hero", () => {
    // The forest's own first visit (39:100, BLUE_TRAIL) is behind the hero.
    const world = enter(39, 170, 540, [[39, 100]]);
    expect(world.actors.get(LOCKE.actors["39:28"])?.visible).toBe(false);
    world.tick([]);
    expect(world.eventVisible).toBe(false);
    expect(done(world, 39, LOCKE_PRE)).toBe(false);
  });

  it("the rescue: the strip starts it, the fight is won, and 1302 opens Linh's return", () => {
    const world = enter(39, 170, 540, RESCUE_GATES);
    expect(world.actors.get(LOCKE.actors["39:28"])?.visible).toBe(true);
    const { seen, fights } = play(world);
    expect(starts(seen, says("RESCUE_PRE"))).toBe(true);
    expect(fights).toEqual([species("39")]);
    expect(starts(seen, says("RESCUE_POST"))).toBe(true);
    for (const flag of [LOCKE_PRE, LOCKE_WON, LOCKE_POST]) expect(done(world, 39, flag)).toBe(true);
    // `applyCast`: the rescued pair leaves the forest.
    expect(world.actors.get(LOCKE.actors["39:28"])?.visible).toBe(false);
    // In the hall, Linh now hands over her egg.
    world.warp({ scene: 98, room: 47, x: 200, y: 320, direction: 0 });
    for (const event of [100, 7000, 7002, 7100, 7102, 7200])
      world.eventState.op14CompleteEvent(98, 47, event);
    const linh = world.actors.get(HALL.linh)!;
    world.player.x = linh.x + 10;
    world.player.y = linh.y + 19 + 16;
    world.player.direction = 2;
    world.tick(["confirm"]);
    play(world);
    expect(done(world, 47, CUES.parts.LINH_RETURN.flag)).toBe(true);
    expect(world.bag.specials.filter((id) => id === 8068)).toHaveLength(1);
  });

  it("a lost rescue keeps PRE, says so, and the next talk goes straight to the fight", () => {
    const world = enter(39, 170, 540, RESCUE_GATES);
    const first = play(world, true);
    expect(first.fights).toHaveLength(1);
    expect(
      first.seen.at(-1) && flatten(LOCKE_LOST).startsWith(flatten(first.seen.at(-1)!).slice(0, 10)),
    ).toBe(true);
    expect(done(world, 39, LOCKE_PRE)).toBe(true);
    expect(done(world, 39, LOCKE_WON)).toBe(false);
    // Back on the strip: no second cutscene, the fight again.
    world.player.x = 170;
    world.player.y = 540;
    const again = play(world);
    expect(again.fights).toEqual([species("39")]);
    expect(starts(again.seen, says("RESCUE_PRE"))).toBe(false);
    expect(done(world, 39, LOCKE_POST)).toBe(true);
  });

  it("the south gate: talk, fight, rewards once, then rematches", () => {
    const world = enter(52, 200, 300, [LOCKE.gates.southEast]);
    const rival = world.actors.get(LOCKE.actors["52:23"])!;
    expect(rival.visible).toBe(true);
    const talk = () => {
      world.player.x = rival.x + 10;
      world.player.y = rival.y + 19 + 16;
      world.player.direction = 2;
      world.tick(["confirm"]);
      return play(world);
    };
    const before = world.inventory["11"] ?? 0;
    const first = talk();
    expect(first.fights).toEqual([species("52")]);
    expect(starts(first.seen, says("SOUTH_POST"))).toBe(true);
    expect(first.seen).toContain("Nhận được Sinh mệnh thạch × 3");
    expect((world.inventory["11"] ?? 0) - before).toBe(3);
    expect(world.bag.materials["3006"]).toBe(1);
    const rematch = talk();
    expect(rematch.fights).toEqual([species("52r")]);
    expect(rematch.seen.at(-1)).toBe("Bạn thắng trận tái đấu với Lạc Khắc!");
    // The rewards were a one-time receipt.
    expect((world.inventory["11"] ?? 0) - before).toBe(3);
  });

  it("the last duel offers the challenge after its introduction", () => {
    const world = enter(32, 200, 300, [LOCKE.gates.northSeaCompanion]);
    const rival = world.actors.get(LOCKE.actors["32:20"])!;
    expect(rival.visible).toBe(true);
    world.player.x = rival.x + 10;
    world.player.y = rival.y + 19 + 16;
    world.player.direction = 2;
    world.tick(["confirm"]);
    const intro = play(world);
    expect(starts(intro.seen, says("LAST_INTRO"))).toBe(true);
    expect(world.eventScene?.choice?.options).toEqual(LOCKE_CHOICE);
    world.tick(["confirm"]);
    const duel = play(world);
    expect(duel.fights).toEqual([species("32")]);
    expect(done(world, 32, LOCKE_POST)).toBe(true);
    expect(world.bag.specials).toContain(8069);
  });
});
