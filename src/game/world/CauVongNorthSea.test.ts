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
const { TIER_LOCK_WARNING, SKILL_NOT_READY_WARNING } = await import("../battle/engine/BattleTypes");
const { CV_WATER, RAINBOW_RIDE_OWNED_EVENT } = await import("../ride/RideSystem");
const { NORTH_SEA_BOAT_SPRITE } = await import("./CauVongNorthSea");
const { openingQuestDetail } = await import("./CauVongOpening");
const { cauVongCampusNpcPassable, cauVongNpcRequested } = await import("./CauVongWorld");
type NorthSeaDocument = import("./CauVongNorthSea").CauVongNorthSeaDocument;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
for (const room of [
  0, 2, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 45, 48, 49, 50, 53, 56, 61, 66,
])
  await assets.prepareRoom(98, room);

const DOC = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../public/pack/cau-vong-world/north-sea.json"),
    "utf8",
  ),
) as NorthSeaDocument;
const says = (name: string) =>
  DOC.parts[name].steps.flatMap((cue) => (cue.k === "say" ? [cue] : []));
const species = (key: string) => DOC.battles[key].members.map(([id]) => id);
const actor = (room: number, source: number) => DOC.actors[String(room)][String(source)];

/** The restored 30:6 rumours formation, as in the blocked campus walkway report. */
const CAMPUS_PASSAGE: [number, number][] = [
  ...[100, 102, 103, 104, 107].map((flag): [number, number] => [30, flag]),
  ...["TOUR", "REPORTER", "MATCH_POST", "LEAD", "WITNESSES", "RUMOURS", "DOOR"].map(
    (name): [number, number] => [30, DOC.parts[name].flag],
  ),
];

describe("North Sea Academy's crowded walkway", () => {
  for (const [startX, right] of [
    [410, false],
    [270, true],
    [330, false],
    [330, true],
  ] as const)
    it(`crosses the witnesses: start ${startX}, right ${right}`, () => {
      const { world } = enter(30, startX, startX === 330 ? 419 : 379, CAMPUS_PASSAGE);
      for (let i = 0; i < 20 && world.player.y < 423; i++) world.tick(["down"]);
      for (let i = 0; i < 100 && (right ? world.player.x < 410 : world.player.x > 270); i++)
        world.tick([right ? "right" : "left"]);
      expect(right ? world.player.x >= 410 : world.player.x <= 270).toBe(true);
      expect(world.roomIndex).toBe(30);
      expect(world.player.y).toBeGreaterThanOrEqual(423);
      expect(world.player.y).toBeLessThanOrEqual(432);
      expect(world.eventVisible).toBe(false);
      expect(
        [28, 29, 30].map((id) => {
          const npc = world.actors.get(id)!;
          return [npc.x, npc.y, npc.visible];
        }),
      ).toEqual([
        [300, 380, true],
        [340, 380, true],
        [320, 400, true],
      ]);
    });

  it("keeps the upper witnesses solid and the alliance clerk's dialogue", () => {
    const { world } = enter(30, 410, 399, CAMPUS_PASSAGE);
    for (let i = 0; i < 70; i++) world.tick(["left"]);
    expect(world.player.x).toBeGreaterThan(350);
    world.player.x = 370;
    world.player.y = 379;
    world.player.direction = 3;
    world.tick(["confirm"]);
    play(world);
    expect(world.eventScene?.choice?.options).toEqual(DOC.menus.continuation["9"]);
  });

  it("keeps the lower witness interactive and limits the passage to the crowded pose", () => {
    const { world } = enter(30, 350, 419, CAMPUS_PASSAGE);
    const npc = world.actors.get(30)!;
    const mechanics = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, "../../../public/pack/cau-vong-world/collision.json"),
        "utf8",
      ),
    ).rooms["98:30"];
    const hero = {
      x: 350,
      y: 419,
      direction: 3,
      speed: 4,
      mask: assets.collisionMask(world.player.sprite, world.player.state, 0),
    };
    expect(cauVongNpcRequested(hero, world.actors.values(), mechanics, 30, true)).toBe(true);
    expect(
      cauVongNpcRequested(
        { ...hero, pointerTarget: 30 },
        world.actors.values(),
        mechanics,
        30,
        true,
      ),
    ).toBe(true);
    expect(cauVongCampusNpcPassable(30, npc, world.actors)).toBe(true);
    expect(cauVongCampusNpcPassable(48, npc, world.actors)).toBe(false);
    expect(cauVongCampusNpcPassable(30, world.actors.get(28)!, world.actors)).toBe(false);
    world.actors.get(29)!.x++;
    expect(cauVongCampusNpcPassable(30, npc, world.actors)).toBe(false);
    world.actors.get(29)!.x--;
    world.actors.get(28)!.visible = false;
    expect(cauVongCampusNpcPassable(30, npc, world.actors)).toBe(false);
  });
});

/** Scene 98 past the opening, CV4 over (9:114), `flags` set, then `room` at (x, y). */
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
  // The hints of 27 and 30 are heard; the dock's arrival too unless a test plays it.
  for (const [r, event] of [
    [9, 114] as [number, number],
    [27, 841006] as [number, number],
    [30, 841007] as [number, number],
    ...flags,
  ])
    world.eventState.op14CompleteEvent(98, r, event);
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

/** Ticks, confirming every box and winning (or losing) any fight, until nothing plays or a menu is open. */
function play(world: World, limit = 30000, win = true) {
  const seen: string[] = [];
  const fights: number[][] = [];
  let quiet = 0,
    last: unknown = null;
  const trail: string[] = [];
  for (let tick = 0; tick < limit; tick++) {
    const tag = `${world.phase}:${world.roomIndex}:${(world as unknown as { event?: { scriptId?: string } }).event?.scriptId}:${world.eventScene?.currentText?.slice(0, 15)}`;
    if (trail.at(-1) !== tag) trail.push(tag);
    const battle = world.battle;
    if (battle) {
      if (battle !== last) {
        last = battle;
        const core = battle.core!,
          ids: number[] = [];
        for (let i = 0; i < 6; i++) {
          try {
            ids.push(core.enemySetup(i).speciesId);
          } catch {
            break;
          }
        }
        fights.push(ids);
      }
      const foe = battle.core?.activeUnit("enemy"),
        mine = battle.core?.activeUnit("player");
      if (win) {
        if (foe?.alive()) foe.setHp(0);
        if (mine?.alive()) mine.setHp(mine.maxHp());
      } else if (mine?.alive()) mine.setHp(0);
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
/** Stands under the actor facing it and presses 5. */
function talk(world: World, id: number) {
  const npc = world.actors.get(id)!;
  expect(npc.visible).toBe(true);
  world.player.x = npc.x + 10;
  world.player.y = npc.y + 19 + 16;
  world.player.direction = 2;
  world.tick(["confirm"]);
  return play(world);
}
/** Picks option `index` of the open menu. */
function pick(world: World, index: number) {
  for (let i = 0; i < index; i++) world.tick(["down"]);
  world.tick(["confirm"]);
  return play(world);
}
/** Stands at (x, y) and lets the owner run. */
function stand(world: World, x: number, y: number, keys: ("confirm" | "up")[] = []) {
  world.player.x = x;
  world.player.y = y;
  world.tick(keys);
  return play(world);
}
/** Plays on until nothing plays (fights and follow-ups included). */
function settle(world: World, limit = 60000, win = true) {
  const seen: string[] = [],
    fights: number[][] = [];
  for (let i = 0; i < 8; i++) {
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
const part = (name: string) => DOC.parts[name];

describe("Bắc Hải (CV5)", () => {
  it("bakes Java's parts, fights, boats and doors", () => {
    expect(part("OFFICE")).toMatchObject({ room: 27, flag: 1900, started: 2000, cue: 56000 });
    expect(part("OFFICE").reply).toBe("27:2:0:206");
    expect(part("LEAD_NOTICE")).toMatchObject({ room: 30, flag: 1920, cue: 60000 });
    expect(part("OLD_GUARDS")).toMatchObject({ room: 35, flag: 3000, started: 3100, cue: 70000 });
    expect(part("EXPLANATION")).toMatchObject({ room: 61, flag: 3018, cue: 77200 });
    expect(part("SEA_ENTRANCE")).toMatchObject({ room: 29, flag: 3027, cue: 80800 });
    expect(part("MUTATION_56")).toMatchObject({ room: 56, flag: 3070 });
    // CV5b's hint and reopening (`CauVongLaboratory.test.ts`) and CV6's finals (`CauVongFinals.test.ts`)
    // are baked; so are CV0's vines (33/45 ↔ 50) and Tiểu Song's trade (49).
    expect(part("LAB_HINT")).toMatchObject({ room: 27 });
    expect(part("REOPEN")).toMatchObject({ room: 48 });
    expect(part("FINAL_OFFER")).toMatchObject({ room: 30 });
    expect(part("VINE_UP")).toMatchObject({ room: 33 });
    expect(part("SKY_TRADE")).toMatchObject({ room: 49 });
    // KEY hands the odd key once (48:3600); CLUE and the dolphin give Thủy Hành with the pet.
    expect(part("KEY").steps).toContainEqual(
      expect.objectContaining({ k: "award", kind: "QUEST", rewardId: 9006, receipt: 3600 }),
    );
    expect(part("CLUE").steps).toContainEqual(
      expect.objectContaining({ k: "pet", receipt: 52082, ride: CV_WATER }),
    );
    expect(part("DOLPHIN").steps).toContainEqual(
      expect.objectContaining({ k: "pet", receipt: 52183, species: 183, ride: CV_WATER }),
    );
    expect(DOC.battles["1"].lossContinues).toBe(true);
    expect(species("0")).toEqual([181, 165, 171]);
    expect(species("match")).toEqual([177, 173, 171]);
    expect(DOC.boats).toHaveLength(8);
    expect(DOC.boats[0]).toMatchObject({ room: 28, offer: "28:2:0:52" });
    expect(DOC.items.ticket).toMatchObject({ id: 9005, name: "Vé tàu Bắc Hải" });
    expect(DOC.items.key).toMatchObject({ id: 9006, name: "Chìa khóa kỳ lạ" });
  });

  it("A: 27's office points the way, and only 9:114 opens 27 → 28", () => {
    // Inside the office's rect, off the doors (15/16, 9).
    const { world } = enter(27, 290, 230);
    const r = play(world);
    expect(starts(r.seen, says("OFFICE"))).toBe(true);
    expect(done(world, 27, 1900)).toBe(true);
    world.eventState.op42RepeatEvent(98, 9, 114);
    stand(world, 15 * 20 + 10, 9 * 20 + 19);
    expect(world.roomIndex).toBe(27);
    world.eventState.op14CompleteEvent(98, 9, 114);
    stand(world, 15 * 20 + 10, 9 * 20 + 15);
    expect(world.roomIndex).toBe(28);
  });

  it("A: the yard's east doors walk into 27 and back (Java never checked them)", () => {
    const { world } = enter(2, 500, 350);
    play(world);
    for (const [y, landing, back] of [
      [350, 619, 379],
      [370, 599, 359],
    ]) {
      world.warp({ scene: 98, room: 2, x: 500, y, direction: 0 });
      play(world);
      for (let i = 0; i < 60 && world.roomIndex === 2; i++) world.tick(["holdRight"]);
      expect([world.roomIndex, world.player.x, world.player.y]).toEqual([27, 30, landing]);
      // The arrival stays put, and the west door leads back to the yard.
      for (let i = 0; i < 40; i++) world.tick([]);
      expect(world.roomIndex).toBe(27);
      for (let i = 0; i < 60 && world.roomIndex === 27; i++) world.tick(["holdLeft"]);
      expect([world.roomIndex, world.player.x, world.player.y]).toEqual([2, 530, back]);
    }
  });

  it("A: 28's arrival, then the dock keeper's ticket and a boat ride", () => {
    const { world } = enter(28, 200, 400);
    let r = play(world);
    expect(starts(r.seen, says("ARRIVAL"))).toBe(true);
    expect(done(world, 28, 100)).toBe(true);
    const keeper = DOC.boats[0].actor;
    r = talk(world, keeper);
    expect(world.inventory["9005"]).toBe(1);
    expect(done(world, 28, 119100)).toBe(true);
    expect(done(world, 28, 101)).toBe(true);
    const [x, y, w, h] = DOC.boats[0].rect;
    world.player.x = x + w / 2;
    world.player.y = y + h / 2;
    world.tick([]);
    expect(done(world, 28, 119000)).toBe(true);
    expect(done(world, 28, 119100)).toBe(false);
    let sailed = false;
    const rooms = new Set<number>();
    for (let tick = 0; tick < 20000 && done(world, 28, 119000); tick++) {
      world.tick([]);
      rooms.add(world.roomIndex);
      sailed ||= world.player.sprite === NORTH_SEA_BOAT_SPRITE;
    }
    expect(sailed).toBe(true);
    expect(done(world, 28, 119000)).toBe(false);
    const path = DOC.boats[0].path;
    expect([world.player.x, world.player.y]).toEqual([
      path.at(-2)! * 20 + 10,
      path.at(-1)! * 20 + 19,
    ]);
    expect(rooms.size).toBeGreaterThan(1);
    expect(world.player.sprite).not.toBe(NORTH_SEA_BOAT_SPRITE);
  });

  it("A: 48's welcome, 30's tour, the reporter, the friendly match and the lead", () => {
    const { world } = enter(48, 300, 100, [[28, 100]]);
    let r = stand(world, 400, 80);
    expect(starts(r.seen, says("WELCOME"))).toBe(true);
    expect(done(world, 48, 100)).toBe(true);
    world.warp({ scene: 98, room: 30, x: 300, y: 300, direction: 0 });
    r = play(world);
    expect(starts(r.seen, says("TOUR"))).toBe(true);
    expect(done(world, 30, 100)).toBe(true);
    r = stand(world, 150, 200);
    expect(starts(r.seen, says("REPORTER"))).toBe(true);
    expect(done(world, 30, 134)).toBe(true);
    r = talk(world, actor(30, 26));
    expect(starts(r.seen, says("MATCH_OFFER"))).toBe(true);
    const fought = settle(world);
    void fought;
    expect(world.eventScene?.choice?.options).toEqual(DOC.menus.source["1"]);
    r = pick(world, 0);
    const after = settle(world);
    expect([...r.fights, ...after.fights]).toEqual([species("match")]);
    expect(starts([...r.seen, ...after.seen], says("MATCH_POST"))).toBe(true);
    expect(done(world, 30, 102)).toBe(true);
    r = stand(world, 130, 200);
    expect(starts(r.seen, says("LEAD_NOTICE"))).toBe(true);
    r = talk(world, actor(30, 25));
    expect(starts(r.seen, says("LEAD"))).toBe(true);
    expect(done(world, 30, 103)).toBe(true);
    r = talk(world, actor(30, 29));
    expect(starts(r.seen, says("WITNESSES"))).toBe(true);
    expect(done(world, 30, 104)).toBe(true);
  });

  it("A: a lost match says so and waits for the referee", () => {
    const { world } = enter(30, 300, 300, [
      [28, 100],
      [48, 100],
      [30, 100],
      [30, 134],
    ]);
    talk(world, actor(30, 26));
    settle(world);
    world.tick(["confirm"]);
    const lost = settle(world, 60000, false);
    expect(lost.fights).toEqual([species("match")]);
    expect(flatten(lost.seen.at(-1)!)).toBe(flatten(DOC.text.matchLost));
    expect(done(world, 30, DOC.flags.matchRetry)).toBe(true);
    expect(done(world, 30, 102)).toBe(false);
  });

  it("A: 48's clue gives the dolphin and Thủy Hành", () => {
    const { world } = enter(48, 300, 300, [
      [28, 100],
      [48, 100],
      [30, 100],
      [30, 102],
      [30, 103],
      [30, 104],
    ]);
    const girl = world.actors.get(146)!;
    expect([girl.x, girl.y, girl.visible]).toEqual([240, 100, true]);
    const before = world.pets.length;
    const r = stand(world, 150, 100);
    expect(starts(r.seen, says("CLUE"))).toBe(true);
    expect(done(world, 48, 105)).toBe(true);
    expect(world.pets.length + world.meta.campaign.petBank.length).toBeGreaterThan(before);
    expect(done(world, 0, RAINBOW_RIDE_OWNED_EVENT + CV_WATER)).toBe(true);
  });

  const CLUE: [number, number][] = [
    [28, 100],
    [48, 100],
    [30, 100],
    [30, 102],
    [30, 103],
    [30, 104],
    [48, 105],
    [0, RAINBOW_RIDE_OWNED_EVENT + CV_WATER],
  ];

  it("B: 29's sea entrance, and 29 → 35 needs the clue, Thủy Hành and a level-88 pet", () => {
    const { world } = enter(29, 300, 300, CLUE);
    const r = play(world);
    expect(starts(r.seen, says("SEA_ENTRANCE"))).toBe(true);
    expect(done(world, 29, 3027)).toBe(true);
    // On foot the water door stays shut.
    stand(world, 10, 195);
    expect(world.roomIndex).toBe(29);
    expect(world.selectRide(CV_WATER)).toBe("ready");
    for (const pet of world.pets) pet.level = 87;
    stand(world, 10, 195);
    expect(world.roomIndex).toBe(29);
    world.pets[0].level = 88;
    stand(world, 10, 195);
    expect(world.roomIndex).toBe(35);
  });

  it("B: 35's old guards, the commander (whose defeat goes on) and the rescue", () => {
    const { world } = enter(35, 300, 300, CLUE);
    let r = stand(world, 220, 400);
    let after = settle(world);
    expect([...r.fights, ...after.fights]).toEqual([species("0"), species("1")]);
    expect(starts([...r.seen, ...after.seen], says("OLD_RESCUE"))).toBe(true);
    for (const event of [100, 101, 102]) expect(done(world, 35, event)).toBe(true);
    // The commander's defeat is the story's.
    const lost = enter(35, 300, 300, [...CLUE, [35, 100]]).world;
    r = play(lost, 30000, false);
    after = settle(lost, 60000, false);
    expect([...r.fights, ...after.fights]).toEqual([species("1")]);
    expect(done(lost, 35, 102)).toBe(true);
  });

  it("B: a lost old-guard fight is retried with 5 at its trigger", () => {
    const { world } = enter(35, 300, 300, CLUE);
    world.player.x = 220;
    world.player.y = 400;
    world.tick([]);
    const lost = settle(world, 60000, false);
    expect(lost.fights).toEqual([species("0")]);
    expect(flatten(lost.seen.at(-1)!)).toBe(flatten(DOC.text.lost));
    expect(done(world, 35, 3550)).toBe(true);
    expect(done(world, 35, 3000)).toBe(false);
    let r = stand(world, 222, 400);
    expect(r.seen).toEqual([]);
    r = stand(world, 220, 400, ["confirm"]);
    const again = settle(world);
    expect([...r.fights, ...again.fights][0]).toEqual(species("0"));
  });

  const RESCUED: [number, number][] = [...CLUE, [35, 100], [35, 101], [35, 102]];

  it("C: 48's odd key, 30's rumours and door, 61's discovery, capture and order", () => {
    const { world } = enter(48, 300, 300, RESCUED);
    let r = stand(world, 330, 70);
    expect(starts(r.seen, says("KEY"))).toBe(true);
    expect(world.inventory["9006"]).toBe(1);
    expect(done(world, 48, 106)).toBe(true);
    world.warp({ scene: 98, room: 30, x: 300, y: 300, direction: 0 });
    r = settle(world);
    expect(starts(r.seen, says("RUMOURS"))).toBe(true);
    expect(starts(r.seen, says("DOOR"))).toBe(true);
    expect(done(world, 30, 107)).toBe(true);
    // 30's classroom door is a facade: entered from the floor below, facing up.
    world.player.direction = 2;
    const entered = stand(world, 19 * 20 + 10, 8 * 20 + 15, ["up"]);
    expect(world.roomIndex).toBe(61);
    r = settle(world);
    expect(starts([...entered.seen, ...r.seen], says("DISCOVERY"))).toBe(true);
    r = stand(world, 330, 250);
    expect(starts(r.seen, says("CAPTURE"))).toBe(true);
    r = stand(world, 60, 160);
    expect(starts(r.seen, says("EXIT_CLUE"))).toBe(true);
    expect(done(world, 61, 101)).toBe(true);
    r = talk(world, actor(61, 44));
    expect(starts(r.seen, says("ORDER"))).toBe(true);
    expect(done(world, 61, 102)).toBe(true);
  });

  const ORDERED: [number, number][] = [
    ...RESCUED,
    [48, 106],
    [30, 107],
    [61, 100],
    [61, 101],
    [61, 102],
  ];

  it("D: 37's guard and rescue, 36's principal and ghost, 48's return, 61's switch and the truth", () => {
    const { world } = enter(37, 200, 200, ORDERED);
    let r = stand(world, 310, 400);
    let after = settle(world);
    expect([...r.fights, ...after.fights]).toEqual([species("2")]);
    expect(starts([...r.seen, ...after.seen], says("RESCUE"))).toBe(true);
    expect(done(world, 37, 100)).toBe(true);
    world.warp({ scene: 98, room: 36, x: 300, y: 200, direction: 0 });
    r = stand(world, 200, 310);
    after = settle(world);
    expect([...r.fights, ...after.fights]).toEqual([species("3"), species("4")]);
    expect(starts([...r.seen, ...after.seen], says("GHOST_AFTER"))).toBe(true);
    expect(done(world, 36, 101)).toBe(true);
    world.warp({ scene: 98, room: 48, x: 300, y: 300, direction: 0 });
    r = stand(world, 390, 80);
    expect(starts(r.seen, says("RETURN"))).toBe(true);
    expect(done(world, 48, 107)).toBe(true);
    world.warp({ scene: 98, room: 61, x: 200, y: 200, direction: 0 });
    r = settle(world);
    expect(starts(r.seen, says("SWITCH_NOTICE"))).toBe(true);
    r = talk(world, actor(61, 3));
    after = settle(world);
    expect(starts([...r.seen, ...after.seen], says("SWITCH"))).toBe(true);
    expect(starts([...r.seen, ...after.seen], says("EXPLANATION"))).toBe(true);
    expect(done(world, 61, 104)).toBe(true);
    expect(done(world, 61, DOC.flags.explained)).toBe(true);
    // `applyProps`: the cages are gone.
    for (const [id, visible] of DOC.props61[1])
      expect(world.actors.get(id)?.visible).toBe(visible === 1);
  });

  it("branches: 31's supplies for the dolphin, refused until the three fives are there", () => {
    const { world } = enter(31, 200, 300, CLUE);
    let r = talk(world, actor(31, 16));
    expect(starts(r.seen, says("SUPPLIES_NOTICE"))).toBe(true);
    talk(world, actor(31, 16));
    expect(world.eventScene?.choice?.options).toEqual(DOC.menus.source["2"]);
    r = pick(world, 0);
    expect(r.seen.map(flatten)).toEqual([flatten(DOC.text.suppliesRefused)]);
    for (const id of DOC.items.supplies) world.inventory[String(id)] = 5;
    talk(world, actor(31, 16));
    r = pick(world, 0);
    const after = settle(world);
    expect(starts([...r.seen, ...after.seen], says("DOLPHIN"))).toBe(true);
    for (const id of DOC.items.supplies) expect(world.inventory[String(id)] ?? 0).toBe(0);
    expect(done(world, 31, 51900)).toBe(true);
    expect(done(world, 31, 52183)).toBe(true);
  });

  it("branches: 27's Thiên Mã one-horn trade", () => {
    const { world } = enter(27, 120, 500, [[27, 1900]]);
    world.pets.push({ ...world.pets[0], speciesId: 147, slot: world.pets.length });
    let r = talk(world, actor(27, 19));
    expect(starts(r.seen, says("HORSE_NOTICE"))).toBe(true);
    talk(world, actor(27, 19));
    expect(world.eventScene?.choice?.options).toEqual(DOC.menus.source["3"]);
    r = pick(world, 0);
    const after = settle(world);
    expect(starts([...r.seen, ...after.seen], says("HORSE_GIVE"))).toBe(true);
    expect(world.pets.some((pet) => pet.speciesId === 147)).toBe(false);
    expect(done(world, 27, 52758)).toBe(true);
  });

  it("branches: 34's spirit for Đao Thương Tướng Quân", () => {
    const { world } = enter(34, 200, 300, CLUE);
    let r = stand(world, 100, 100);
    expect(starts(r.seen, says("SPIRIT_NOTICE"))).toBe(true);
    talk(world, actor(34, 52));
    expect(world.eventScene?.choice?.options).toEqual(DOC.menus.continuation["3"]);
    r = pick(world, 0);
    expect(r.seen.map(flatten)).toEqual([flatten(DOC.text.spiritRefused)]);
    world.inventory[String(DOC.items.spirit)] = 1;
    talk(world, actor(34, 52));
    r = pick(world, 0);
    expect(starts(r.seen, says("SPIRIT_GIVE"))).toBe(true);
    expect(world.inventory[String(DOC.items.spirit)] ?? 0).toBe(0);
    expect(done(world, 34, 52129)).toBe(true);
  });

  it("branches: 34's hatchery keeper opens the shared five-slot incubator", () => {
    const { world } = enter(34, 200, 300, CLUE);
    stand(world, 100, 100);
    expect(world.takeServiceRequest()).toBeNull();
    const r = talk(world, actor(34, 31));
    expect(r.seen).toEqual([]);
    expect(world.takeServiceRequest()?.continuation).toBe("CAU_VONG_INCUBATOR");
  });

  it.each([
    ["incubator", 0, 0],
    ["incubatorEggs", 1, 0],
    ["incubatorActions", 2, 0],
    ["incubatorDiscard", 3, 1],
    ["incubatorHatched", 0, 0],
  ])("?cauVongNorthSea=%s: the incubator panel through the host", (stage, menu, action) => {
    const screen = new NewGameScreen(
      false,
      assets,
      boot,
      new SaveRepository(new MemorySaveStore()),
      () => {},
    );
    expect(applyUrlParityCheckpoint(screen, new URLSearchParams(`cauVongNorthSea=${stage}`))).toBe(
      true,
    );
    const panel = screen.host.panel,
      world = screen.host.world!;
    expect([panel.visible, panel.mode]).toEqual([true, "cauVongIncubator"]);
    expect([panel.cauVongIncubator.menu, panel.cauVongIncubator.action]).toEqual([menu, action]);
    const [first] = world.cauVongEggRows();
    if (stage === "incubatorHatched") {
      expect(panel.cauVongIncubator.message).toBe("Trứng đã nở! Pet vào đội hoặc kho.");
      expect(world.cauVongIncubation.items[0]).toBe(0);
      expect(
        [...world.pets, ...world.campaign.petBank].some(
          (pet) => pet.speciesId === first.incubator!.species,
        ),
      ).toBe(true);
      for (const m of first.incubator!.materials) expect(world.cauVongMaterialCount(m.id)).toBe(1);
    }
    if (stage === "incubatorEggs") {
      panel.tick(["confirm"]);
      expect(world.cauVongIncubation.items[1]).toBe(first.itemId);
      expect(world.ownedSpecials(first.itemId)).toBe(1);
      panel.tick(["back"]);
      expect(panel.visible).toBe(false);
    }
  });

  it("branches: 30's shop door opens the shared shop (56), whose way out returns to 30", () => {
    const { world } = enter(30, 300, 300, [...ORDERED, [30, 3004], [30, 3005]]);
    const entered = stand(world, 21 * 20 + 10, 14 * 20 + 15);
    expect(world.roomIndex).toBe(56);
    expect(done(world, 56, 200001)).toBe(true);
    const r = settle(world);
    expect(starts([...entered.seen, ...r.seen], says("SHOP_56_INTRO"))).toBe(true);
    stand(world, 9 * 20 + 10, 25 * 20 + 15);
    expect([world.roomIndex, world.player.x, world.player.y]).toEqual([30, 430, 319]);
    // Any other way in (here from the square, 0) leaves 56 to the city.
    world.warp({ scene: 98, room: 0, x: 200, y: 300, direction: 0 });
    world.warp({ scene: 98, room: 56, x: 200, y: 400, direction: 0 });
    expect(done(world, 56, 200001)).toBe(false);
  });

  it("the quest row: 9:114 shows it, each stage's detail in turn, 61:105 completes it", () => {
    // Chapter 5 (Bắc Hải) runs from 9:114 through the finals (30:124).
    const quest = assets.cauVongOpening!.quests.find(
      (q) => q.show?.[0] === 9 && q.show[1] === 114,
    )!;
    expect(quest.title).toBe("Cầu Vồng 5 — Bắc Hải");
    expect(quest.done).toEqual([30, 124]);
    const stages: [number, number][] = [
      [30, 104],
      [35, 102],
      [61, 102],
      [61, 105],
      [48, 120],
    ];
    const seen: string[] = [];
    for (let n = 0; n <= stages.length; n++) {
      const set = stages.slice(0, n);
      seen.push(openingQuestDetail(quest, ([r, e]) => set.some(([a, b]) => a === r && b === e)));
    }
    expect(new Set(seen).size).toBe(6);
    expect(seen[0]).toContain("văn phòng (27)");
    expect(seen[4]).toContain("Chân tướng đã rõ");
    expect(seen[5]).toContain("Gặp trọng tài tại đấu trường (30)");
  });

  it("branches: the dock merchant's menu and a passive line", () => {
    const { world } = enter(28, 200, 300, [[28, 100]]);
    let r = talk(world, DOC.merchants["28"].actor);
    expect(world.eventScene?.choice?.options).toEqual(["Mua / bán", "Gửi pet", "Rời đi"]);
    r = pick(world, 2);
    expect(r.seen.length).toBeGreaterThan(0);
    const passive = DOC.passives["28"].find((npc) => npc.actorId === 96)!;
    r = talk(world, 96);
    expect(r.seen.map(flatten)).toEqual([flatten(passive.say.text)]);
  });

  describe("CV0': the vines and Tiểu Song", () => {
    /** The hub's first scene seen (`completed(50, 0)`). */
    const HUB: [number, number][] = [[50, 651100]];

    it("33's vine climbs to the hub, the hub's vine comes down, and a vine climbs again", () => {
      const { world } = enter(33, 240, 260, HUB);
      let r = stand(world, 240, 125);
      expect(starts(r.seen, says("VINE_NOTICE"))).toBe(true);
      expect(done(world, 33, part("VINE_NOTICE").flag)).toBe(true);
      stand(world, 250, 135, ["confirm"]);
      expect(world.eventScene?.choice?.options).toEqual(DOC.menus.continuation["2"]);
      r = pick(world, 0);
      settle(world);
      expect([world.roomIndex, world.player.x, world.player.y]).toEqual([50, 590, 179]);
      stand(world, 590, 190, ["confirm"]);
      expect(world.eventScene?.choice?.options).toEqual(DOC.menus.continuation["11"]);
      pick(world, 0);
      settle(world);
      expect([world.roomIndex, world.player.x, world.player.y]).toEqual([33, 250, 159]);
      // A finished vine restarts (`start` clears its flag and cues).
      stand(world, 250, 135, ["confirm"]);
      pick(world, 0);
      settle(world);
      expect(world.roomIndex).toBe(50);
      // "Không xuống": nothing.
      stand(world, 90, 190, ["confirm"]);
      expect(world.eventScene?.choice?.options).toEqual(DOC.menus.continuation["12"]);
      pick(world, 1);
      expect(world.roomIndex).toBe(50);
    });

    it("45's vine (once 45 is the North Sea's) climbs to the hub's west end and comes back", () => {
      // From a North Sea room, so 45 stays the North Sea's (`sharedRoomActive`).
      const { world } = enter(30, 200, 300, [...HUB, [45, 200001]]);
      world.warp({ scene: 98, room: 45, x: 170, y: 200, direction: 0 });
      settle(world);
      stand(world, 170, 115, ["confirm"]);
      expect(world.eventScene?.choice?.options).toEqual(DOC.menus.continuation["8"]);
      pick(world, 0);
      settle(world);
      expect([world.roomIndex, world.player.x, world.player.y]).toEqual([50, 90, 179]);
      stand(world, 90, 190, ["confirm"]);
      pick(world, 0);
      settle(world);
      expect([world.roomIndex, world.player.x, world.player.y]).toEqual([45, 170, 139]);
    });

    it("Tiểu Song asks, refuses an empty hand, then takes the ocean pair for Thiên Mã", () => {
      const { world } = enter(49, 280, 400, HUB);
      let r = stand(world, 280, 240);
      expect(starts(r.seen, says("SKY_REQUEST"))).toBe(true);
      talk(world, actor(49, 4));
      expect(world.eventScene?.choice?.options).toEqual(DOC.menus.continuation["13"]);
      r = pick(world, 1);
      expect(starts(r.seen, says("SKY_DECLINE"))).toBe(true);
      talk(world, actor(49, 4));
      r = pick(world, 0);
      expect(r.seen.map(flatten)).toEqual([flatten(DOC.text.skyRefused)]);
      const base = world.pets[0];
      world.pets.push(
        { ...base, speciesId: 177, level: 85, heldEquipmentId: -1, slot: world.pets.length },
        { ...base, speciesId: 181, level: 85, heldEquipmentId: -1, slot: world.pets.length + 1 },
      );
      talk(world, actor(49, 4));
      r = pick(world, 0);
      const after = settle(world);
      expect(starts([...r.seen, ...after.seen], says("SKY_TRADE"))).toBe(true);
      expect(world.pets.some((pet) => pet.speciesId === 177 || pet.speciesId === 181)).toBe(false);
      expect(done(world, 49, 51900) && done(world, 49, 1)).toBe(true);
      // The Thiên Mã reward (52147) and the gift (53167).
      expect(done(world, 49, 52147) && done(world, 49, 53167)).toBe(true);
      // Asked again: the trade's lines only.
      r = talk(world, actor(49, 4));
      expect(starts(r.seen, says("SKY_TRADE"))).toBe(true);
    });

    it("the hub's doors: 49 is open, 66 needs three level-70 pets, 51 waits for the last trial", () => {
      const { world } = enter(50, 310, 560, HUB);
      settle(world);
      // 66 (tile 28, 26) with fewer than three level-70 pets: nothing.
      world.pets.length = 1;
      stand(world, 570, 535);
      expect(world.roomIndex).toBe(50);
      // 51 (tile 15, 16) stays shut before 63's trial.
      stand(world, 310, 335);
      expect(world.roomIndex).toBe(50);
      const base = world.pets[0];
      for (let i = 0; i < 2; i++) world.pets.push({ ...base, slot: world.pets.length });
      stand(world, 570, 535);
      expect(world.roomIndex).toBe(66);
      world.warp({ scene: 98, room: 50, x: 310, y: 560, direction: 0 });
      settle(world);
      // 49 (tile 15, 31).
      stand(world, 310, 635);
      expect(world.roomIndex).toBe(49);
    });

    it("49's alliance clerk answers with the North Sea's alliance menu", () => {
      const { world } = enter(49, 200, 400, [...HUB, [49, part("SKY_REQUEST").flag]]);
      talk(world, actor(49, 8));
      expect(world.eventScene?.choice?.options).toEqual(DOC.menus.continuation["9"]);
      const r = pick(world, 1);
      expect(r.seen.length).toBe(1);
      expect(flatten(r.seen[0])).toMatch(/^Nhận\d+huychương/);
    });
  });
});
