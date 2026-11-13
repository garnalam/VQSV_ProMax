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
const { applyUrlParityCheckpoint, CAU_VONG_LAB_STAGE_NAMES } =
  await import("../../dev/parityCheckpoints");
const { TIER_LOCK_WARNING, SKILL_NOT_READY_WARNING } = await import("../battle/engine/BattleTypes");
const { CV_WATER, RAINBOW_RIDE_OWNED_EVENT } = await import("../ride/RideSystem");
type ForestDocument = import("./CauVongForest").CauVongForestDocument;
type NorthSeaDocument = import("./CauVongNorthSea").CauVongNorthSeaDocument;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
for (const room of [0, 27, 30, 48]) await assets.prepareRoom(98, room);

const read = <T>(file: string) =>
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../public/pack/cau-vong-world", file), "utf8"),
  ) as T;
const DOC = read<ForestDocument>("forest.json");
const SEA = read<NorthSeaDocument>("north-sea.json");
const sayOf = (steps: { k: string }[]) =>
  steps.flatMap((cue) => (cue.k === "say" ? [cue as { k: "say"; text: string }] : []));
const seaSays = (name: string) => sayOf(SEA.parts[name].steps);

/** CV1–CV3 behind the hero: the yard (2) has nothing left to say. */
const ACADEMY: [number, number][] = [
  [6, 100],
  [0, 101],
  [2, 100],
  [2, 101],
  [2, 140],
  [2, 830000],
  [3, 102],
];
/** CV5 over (`CauVongNorthSea.test`'s flags up to 61:105). */
const NORTH_SEA: [number, number][] = [
  [9, 114],
  [27, 841006],
  [30, 841007],
  [27, 1900],
  [28, 100],
  [48, 100],
  [30, 100],
  [30, 102],
  [30, 103],
  [30, 104],
  [48, 105],
  [0, RAINBOW_RIDE_OWNED_EVENT + CV_WATER],
  [35, 100],
  [35, 101],
  [35, 102],
  [48, 106],
  [30, 107],
  [61, 100],
  [61, 101],
  [61, 102],
  [37, 100],
  [36, 101],
  [48, 107],
  [61, 104],
  [61, 105],
];
/** The laboratory over: 62's betrayal and 60's farewell (`late`), the first forest visit kept. */
const LATE: [number, number][] = [
  ...NORTH_SEA,
  [27, SEA.parts.LAB_HINT.flag],
  [2, DOC.flags.doorStarted],
  [2, DOC.flags.doorOpened],
  [62, 100],
  [62, 101],
  [62, 102],
  [62, 103],
  [62, 104],
  [62, 105],
  [60, 100],
  [60, 1500],
  [60, 1501],
  [38, 100],
  [39, 100],
  [40, 6005],
  [40, 6400],
  [38, DOC.parts.PORTAL_ARRIVE.flag],
  [39, DOC.parts.CITY_RETURN.flag],
];

/** Scene 98 past the opening, `flags` set, the party at level 100, then `room` at (x, y). */
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
  for (const [r, event] of [...ACADEMY, ...flags]) world.eventState.op14CompleteEvent(98, r, event);
  for (const pet of world.pets) {
    pet.level = 100;
    pet.currentHp = undefined;
  }
  world.warp({ scene: 98, room, x, y, direction: 0 });
  expect([world.sceneId, world.roomIndex]).toEqual([98, room]);
  return { world, host: screen.host };
}
type World = ReturnType<typeof enter>["world"];
const done = (world: World, room: number, event: number) =>
  world.eventState.sourceEventStateComplete(98, room, event);
const flatten = (text: string) =>
  text
    .normalize("NFC")
    .replace(/#[0-9A-Fa-f]{6}/g, "")
    .replace(/\s+/g, "");
const starts = (seen: string[], expected: { text: string }[]) =>
  expected.length > 0 &&
  expected.every((line) =>
    seen.some((box) => flatten(line.text).startsWith(flatten(box).slice(0, 12))),
  );

type Fight = { species: number[]; levels: number[]; skills: number[][] };
/** Ticks, confirming every box and winning (or losing) any fight, until nothing plays or a menu is open. */
function play(world: World, limit = 30000, win = true) {
  const seen: string[] = [];
  const fights: Fight[] = [];
  let quiet = 0,
    last: unknown = null;
  const trail: string[] = [];
  for (let tick = 0; tick < limit; tick++) {
    const tag = `${world.phase}:${world.roomIndex}:${world.eventScene?.currentText?.slice(0, 15)}`;
    if (trail.at(-1) !== tag) trail.push(tag);
    const battle = world.battle;
    if (battle) {
      if (battle !== last) {
        last = battle;
        const core = battle.core!,
          fight: Fight = { species: [], levels: [], skills: [] };
        for (let i = 0; i < 6; i++) {
          try {
            const setup = core.enemySetup(i);
            fight.species.push(setup.speciesId);
            fight.levels.push(setup.level);
            fight.skills.push([...setup.skillIds]);
          } catch {
            break;
          }
        }
        fights.push(fight);
      }
      const foe = battle.core?.activeUnit("enemy"),
        mine = battle.core?.activeUnit("player");
      if (win) {
        if (foe?.alive()) foe.setHp(0);
        if (mine?.alive()) mine.setHp(mine.maxHp());
      } else if (mine?.alive()) mine.setHp(0);
      // The cursor skips a slot the Phong Bế seal or tier lock shut (`CauVongAcademy.test.ts`).
      const ui = battle.ui;
      expect([TIER_LOCK_WARNING, SKILL_NOT_READY_WARNING]).not.toContain(ui.message);
      const row = ui.rows[ui.selectedIndex];
      const shut =
        ui.mode === "CHOICE_SKILL" &&
        !!mine &&
        (row?.enabled === false ||
          (mine.rainbowCharmSealed()
            ? ui.selectedIndex < mine.rainbowCharmSealedSkillSlots
            : !mine.canUseSkillTier(row?.tier ?? 0)));
      world.tick([shut ? "down" : "confirm"]);
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
  throw new Error(`The owner kept playing: ${trail.slice(-12).join(" | ")}`);
}
/** Plays on until nothing plays (fights, follow-ups and room changes included). */
function settle(world: World, limit = 60000, win = true) {
  const seen: string[] = [],
    fights: Fight[] = [];
  for (let i = 0; i < 10; i++) {
    const r = play(world, limit, win);
    seen.push(...r.seen);
    fights.push(...r.fights);
    if (world.eventScene?.choice) break;
    world.tick([]);
    if (!world.eventVisible && world.phase === "freeworld" && !world.battle) {
      const again = play(world, limit, win);
      seen.push(...again.seen);
      fights.push(...again.fights);
      if (!world.eventVisible && world.phase === "freeworld") break;
    }
  }
  return { seen, fights };
}
/** Stands at (x, y), presses `keys`, and lets the owners run. */
function stand(world: World, x: number, y: number, keys: "confirm"[] = []) {
  world.player.x = x;
  world.player.y = y;
  world.player.direction = 2;
  world.tick(keys);
  return settle(world);
}
/** Stands under the actor facing it and presses 5. */
function talk(world: World, id: number) {
  const npc = world.actors.get(id)!;
  expect(npc.visible).toBe(true);
  return stand(world, npc.x + 10, npc.y + 19 + 16, ["confirm"]);
}
/** The forest finale and the reopening in 48: CV6's way in. */
const FINALS_OPEN: [number, number][] = [
  ...LATE,
  [39, 101],
  [40, 101],
  [41, 101],
  [42, 101],
  [42, 102],
  [42, 103],
  [48, 120],
  [48, 130],
  // CV5's talk in 30 (RUMOURS), played on the way to the door.
  [30, SEA.parts.RUMOURS.flag],
];
const referee = () => SEA.actors["30"]["26"];
const sea = (name: string) => SEA.parts[name];
/** Picks `index` of the open menu. */
function choose(world: World, index: number, win = true) {
  for (let i = 0; i < index; i++) world.tick(["down"]);
  world.tick(["confirm"]);
  return settle(world, 60000, win);
}
/** The final's three teams, `CauVongFinalBattleBalance.TEAMS[2..4]` as `tournament(round)` hands them. */
const finalTeam = (b: number) => SEA.battles[String(b)].members.map(([id]) => id);

describe("CV6: the North Sea's three finals", () => {
  it("bakes the finals, their teams, the referee's menu and the trophy", () => {
    expect(sea("FINAL_NOTICE")).toMatchObject({ room: 30, event: 12 });
    for (const name of [
      "FINAL_OFFER",
      "FINAL_1",
      "FINAL_2",
      "FINAL_3",
      "FINAL_AWARD",
      "FINAL_DECLINE",
    ])
      expect(sea(name)).toMatchObject({ room: 30, event: 8 });
    // R1 4 pets 115–118, R2 5 pets 118–122, R3 6 pets 122–130 (BOSS).
    const levels = [5, 6, 7].map((b) => SEA.battles[String(b)].members.map(([, level]) => level));
    expect(levels).toEqual([
      [115, 116, 117, 118],
      [118, 119, 120, 121, 122],
      [122, 123, 124, 125, 125, 130],
    ]);
    expect([5, 6, 7].map((b) => SEA.battles[String(b)].tier)).toEqual(["ELITE", "ELITE", "BOSS"]);
    expect(SEA.menus.continuation["1"]).toEqual(["Bắt đầu thi đấu", "Chờ một chút"]);
    expect(SEA.items.trophy.id).toBe(9008);
    // FINAL_AWARD's `once(30, 3600)`: the trophy and the ticket, each when none is held.
    expect(sea("FINAL_AWARD").steps).toContainEqual({
      k: "questOnce",
      room: 30,
      receipt: 3600,
      items: [9008, SEA.items.ticket.id],
    });
  });

  it("30 announces the finals once the final is reopened, and not before", () => {
    const early = enter(30, 300, 300, LATE).world;
    expect(starts(settle(early).seen, seaSays("FINAL_NOTICE"))).toBe(false);
    const { world } = enter(30, 300, 300, FINALS_OPEN);
    const r = settle(world);
    expect(starts(r.seen, seaSays("FINAL_NOTICE"))).toBe(true);
    expect(done(world, 30, 120)).toBe(true);
  });

  it("the referee: wait a moment, then three finals in a row, the award, the trophy and 30:124", () => {
    const { world } = enter(30, 300, 300, [...FINALS_OPEN, [30, 120]]);
    world.inventory[String(SEA.items.ticket.id)] = 0;
    const offer = talk(world, referee());
    expect(starts(offer.seen, seaSays("FINAL_OFFER"))).toBe(true);
    expect(world.eventScene?.choice?.options).toEqual(SEA.menus.continuation["1"]);
    const wait = choose(world, 1);
    expect(starts(wait.seen, seaSays("FINAL_DECLINE"))).toBe(true);
    expect(done(world, 30, 121)).toBe(false);

    talk(world, referee());
    const r = choose(world, 0);
    expect(r.fights.map((f) => f.species)).toEqual([finalTeam(5), finalTeam(6), finalTeam(7)]);
    expect(r.fights.map((f) => f.skills)).toEqual(
      [5, 6, 7].map((b) => SEA.battles[String(b)].skills),
    );
    for (const name of ["FINAL_1", "FINAL_2", "FINAL_3", "FINAL_AWARD"])
      expect(starts(r.seen, seaSays(name)), name).toBe(true);
    for (const event of [121, 122, 123, 124])
      expect(done(world, 30, event), String(event)).toBe(true);
    expect(world.inventory["9008"]).toBe(1);
    expect(world.inventory[String(SEA.items.ticket.id)]).toBe(1);
    // The referee has nothing more to run.
    expect(starts(talk(world, referee()).seen, seaSays("FINAL_OFFER"))).toBe(false);
  });

  it("a lost final keeps the rounds already won; 5 on the referee runs the next one", () => {
    const { world } = enter(30, 300, 300, [...FINALS_OPEN, [30, 120], [30, 121]]);
    talk(world, referee());
    const lost = choose(world, 0, false);
    expect(lost.fights.map((f) => f.species)).toEqual([finalTeam(6)]);
    expect(starts(lost.seen, [{ text: SEA.text.lost }])).toBe(true);
    expect(done(world, 30, 121)).toBe(true);
    expect(done(world, 30, 122)).toBe(false);
    expect(done(world, 30, sea("FINAL_2").flag)).toBe(false);
    // Healed, again: round 2, then 3 and the award.
    for (const pet of world.pets) pet.currentHp = undefined;
    talk(world, referee());
    const again = choose(world, 0);
    expect(again.fights.map((f) => f.species)).toEqual([finalTeam(6), finalTeam(7)]);
    expect(done(world, 30, 124)).toBe(true);
  });

  it("the finals' quest row is done at 30:124", () => {
    const finals = assets.cauVongOpening!.quests.find((q) => q.show?.[0] === 48)!;
    expect(finals).toMatchObject({ show: [48, 120], done: [30, 124] });
  });

  it.each([
    ["finals", "FINAL_NOTICE"],
    ["referee", "FINAL_OFFER"],
    ["award", "FINAL_AWARD"],
  ])("checkpoint %s opens on %s's first line", (stage, part) => {
    expect(CAU_VONG_LAB_STAGE_NAMES).toContain(stage);
    const screen = new NewGameScreen(
      false,
      assets,
      boot,
      new SaveRepository(new MemorySaveStore()),
      () => {},
    );
    expect(applyUrlParityCheckpoint(screen, new URLSearchParams(`cauVongLab=${stage}`))).toBe(true);
    const world = screen.host.world!;
    // The box wraps lines, so spacing differs: compare without whitespace.
    const bare = (text?: string | null) => (text ?? "").normalize("NFC").replace(/\s+/g, "");
    expect(bare(world.eventScene?.currentText)).toBe(bare(seaSays(part)[0].text));
  });
});
