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
const { openingQuestDetail } = await import("./CauVongOpening");
type ForestDocument = import("./CauVongForest").CauVongForestDocument;
type NorthSeaDocument = import("./CauVongNorthSea").CauVongNorthSeaDocument;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
for (const room of [0, 2, 10, 27, 30, 38, 39, 40, 41, 42, 47, 48, 60, 62])
  await assets.prepareRoom(98, room);

const read = <T>(file: string) =>
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../public/pack/cau-vong-world", file), "utf8"),
  ) as T;
const DOC = read<ForestDocument>("forest.json");
const SEA = read<NorthSeaDocument>("north-sea.json");
const sayOf = (steps: { k: string }[]) =>
  steps.flatMap((cue) => (cue.k === "say" ? [cue as { k: "say"; text: string }] : []));
const says = (name: string) => sayOf(DOC.parts[name].steps);
const seaSays = (name: string) => sayOf(SEA.parts[name].steps);
const actor = (room: number, source: number) => DOC.actors[String(room)][String(source)];
const members = (key: string) => DOC.battles[key].members.map(([id]) => id);

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

describe("CV5b: the laboratory, the late Rừng U Ám and the final's reopening", () => {
  it("bakes Java's phases, the door, the late forest and the final teams", () => {
    expect(DOC.parts.LAB_DISCOVERY).toMatchObject({
      room: 62,
      flag: 100,
      started: 1900,
      cue: 11000,
    });
    expect(DOC.parts.LAB_BETRAYAL).toMatchObject({ room: 62, flag: 104, cue: 11600 });
    expect(DOC.parts.LAB_GOODBYE).toMatchObject({ room: 60, flag: 100, started: 1900 });
    expect(DOC.parts.LAB_ADVICE).toMatchObject({ room: 60, flag: 1500, started: 3300 });
    expect(DOC.parts.LAB_DOOR).toMatchObject({ room: 2, flag: -1, cue: 1300000 });
    expect(DOC.parts.FOREST_PRINCIPAL).toMatchObject({ room: 42, flag: 6010, started: 6110 });
    expect(DOC.parts.AFTERMATH).toMatchObject({ room: 42, flag: 6012 });
    expect(SEA.parts.LAB_HINT).toMatchObject({ room: 27, event: 0 });
    expect(SEA.parts.REOPEN).toMatchObject({ room: 48, event: 3 });
    // `CauVongFinalBattleBalance.TEAMS[0]` (ELITE) and `TEAMS[1]` (BOSS), quality 5.
    expect(DOC.battles["3"]).toMatchObject({
      tier: "ELITE",
      quality: 5,
      members: [
        [94, 115, 1],
        [155, 116, 1],
        [225, 117, 1],
        [194, 118, 1],
        [174, 119, 1],
        [273, 120, 1],
      ],
    });
    expect(DOC.battles["4"]).toMatchObject({
      tier: "BOSS",
      quality: 5,
      members: [
        [155, 120, 1],
        [225, 121, 1],
        [85, 122, 1],
        [46, 123, 1],
        [174, 125, 1],
        [273, 130, 1],
      ],
    });
    for (const key of ["2", "3", "4"])
      expect(DOC.battles[key].skills!.every((deck) => deck.length === 5)).toBe(true);
    // Actor 6's advice gives items 2/4/6/11, two of each (`CauVongAcademyTransactions`, 60:3).
    const awards = DOC.parts.LAB_ADVICE.steps.flatMap((cue) => (cue.k === "award" ? [cue] : []));
    expect(awards.map((a) => [a.item, a.qty, a.receipt])).toEqual([
      [2, 2, 20302],
      [4, 2, 20304],
      [6, 2, 20306],
      [11, 2, 20311],
    ]);
  });

  it("27 points back to the laboratory once the truth is told", () => {
    const { world } = enter(27, 120, 300, NORTH_SEA);
    world.tick([]);
    const { seen } = settle(world);
    expect(starts(seen, seaSays("LAB_HINT"))).toBe(true);
    expect(done(world, 27, SEA.parts.LAB_HINT.flag)).toBe(true);
    world.tick([]);
    expect(world.eventVisible).toBe(false);
  });

  it("2's door: shut before the truth, then the key, then 62's discovery, switches and betrayal", () => {
    const { world } = enter(2, 362, 547, NORTH_SEA.slice(0, 20));
    let r = stand(world, 362, 547, ["confirm"]);
    expect(starts(r.seen, [DOC.text.labLocked])).toBe(true);
    expect(world.roomIndex).toBe(2);
    world.eventState.op14CompleteEvent(98, 61, 105);
    world.eventState.op14CompleteEvent(98, 27, SEA.parts.LAB_HINT.flag);
    r = stand(world, 362, 547, ["confirm"]);
    expect(starts(r.seen, [DOC.text.labNoKey])).toBe(true);
    world.inventory[String(DOC.flags.northSeaKey)] = 1;
    r = stand(world, 362, 547, ["confirm"]);
    expect(starts(r.seen, says("LAB_DOOR"))).toBe(true);
    expect(done(world, 2, DOC.flags.doorOpened)).toBe(true);
    // 62 (60, 100): the discovery plays on arrival.
    expect(world.roomIndex).toBe(62);
    expect(starts(r.seen, says("LAB_DISCOVERY"))).toBe(true);
    expect(done(world, 62, 100)).toBe(true);
    // The betrayal waits for the three switches.
    r = stand(world, 240, 110);
    expect(starts(r.seen, says("LAB_OVERVIEW"))).toBe(true);
    expect(done(world, 62, 104)).toBe(false);
    const cages = DOC.lab.props.filter(([, role]) => role < 3);
    DOC.lab.switches.forEach(([x, y], i) => {
      const s = stand(world, x, y + 10, ["confirm"]);
      expect(starts(s.seen, says(`LAB_SWITCH${i}`))).toBe(true);
      expect(done(world, 62, 101 + i)).toBe(true);
      const [cage] = cages.find(([, role]) => role === i)!;
      expect(world.actors.get(cage)?.visible).toBe(false);
    });
    r = stand(world, 240, 110);
    expect(starts(r.seen, says("LAB_BETRAYAL"))).toBe(true);
    expect(done(world, 62, 105)).toBe(true);
    // 60 (170, 259): the farewell plays on arrival.
    expect(world.roomIndex).toBe(60);
    expect(starts(r.seen, says("LAB_GOODBYE"))).toBe(true);
    expect(done(world, 60, 100)).toBe(true);
    // Coming back through the door later just walks in.
    world.warp({ scene: 98, room: 2, x: 300, y: 450, direction: 0 });
    stand(world, 362, 547, ["confirm"]);
    expect(world.roomIndex).toBe(62);
  });

  it("60: actor 6's advice and gifts once, then DEPART into the late forest", () => {
    const flags = LATE.filter(([r, e]) => !(r === 60 && e >= 1500));
    const { world } = enter(60, 200, 300, flags);
    for (const source of [5, 6]) expect(world.actors.get(actor(60, source))?.visible).toBe(true);
    const before = { ...world.inventory };
    const r = talk(world, actor(60, 6));
    expect(starts(r.seen, says("LAB_ADVICE"))).toBe(true);
    expect(done(world, 60, 1500)).toBe(true);
    for (const id of [5, 7, 9, 0])
      expect(world.inventory[String(id)] ?? 0).toBe((before[String(id)] ?? 0) + 2);
    const again = talk(world, actor(60, 6));
    expect(starts(again.seen, says("LAB_ADVICE"))).toBe(false);
    // DEPART says nothing: its flag and the room tell it played.
    stand(world, 210, 110);
    expect(done(world, 60, DOC.parts.DEPART.flag)).toBe(true);
    expect(world.roomIndex).toBe(38);
  });

  it("the general's guards in 39, 40 and 41 open the way forward one by one", () => {
    const { world } = enter(39, 300, 300, LATE);
    // The forward door stays shut until the guard is beaten.
    const forward = (room: number) => DOC.doors[String(room)].find((d) => d[2] === room + 1)!;
    const steps: [number, string, string, [number, number]][] = [
      [39, "GUARD_39", "AFTER_39", [160, 570]],
      [40, "GUARD_40", "AFTER_40", [300, 130]],
      [41, "GUARD_41", "AFTER_41", [330, 270]],
    ];
    for (const [b, [room, pre, post, [x, y]]] of steps.entries()) {
      const [tx, ty] = forward(room);
      if (world.roomIndex !== room)
        world.warp({ scene: 98, room, x: tx * 20 + 10, y: ty * 20 + 10, direction: 0 });
      world.player.x = tx * 20 + 10;
      world.player.y = ty * 20 + 10;
      world.tick([]);
      expect(world.roomIndex).toBe(room);
      const r = stand(world, x, y);
      expect(starts(r.seen, says(pre))).toBe(true);
      expect(r.fights.map((f) => f.species)).toEqual([members(String(b))]);
      // AFTER_39 says nothing; every post sets its flag.
      if (says(post).length > 0) expect(starts(r.seen, says(post))).toBe(true);
      expect(done(world, room, DOC.parts[post].flag)).toBe(true);
      expect(done(world, room, 101)).toBe(true);
      world.player.x = tx * 20 + 10;
      world.player.y = ty * 20 + 10;
      world.tick([]);
      expect(world.roomIndex).toBe(room + 1);
    }
  });

  it("42: the principal (ELITE) then Rafael (BOSS) on the final teams, then the aftermath", () => {
    const flags: [number, number][] = [...LATE, [39, 101], [40, 101], [41, 101]];
    const { world } = enter(42, 150, 330, flags);
    expect(world.actors.get(actor(42, 19))?.visible).toBe(true);
    world.tick([]);
    const r = settle(world, 90000);
    expect(starts(r.seen, says("FOREST_PRINCIPAL"))).toBe(true);
    expect(starts(r.seen, says("RAFAEL"))).toBe(true);
    expect(starts(r.seen, says("AFTERMATH"))).toBe(true);
    expect(r.fights.map((f) => f.species)).toEqual([members("3"), members("4")]);
    expect(r.fights.map((f) => f.levels)).toEqual([
      DOC.battles["3"].members.map(([, level]) => level),
      DOC.battles["4"].members.map(([, level]) => level),
    ]);
    // Each pet fights on the deck `CauVongEnemySkillDecks` gives it.
    expect(r.fights.map((f) => f.skills)).toEqual([
      DOC.battles["3"].skills,
      DOC.battles["4"].skills,
    ]);
    for (const event of [101, 102, 103]) expect(done(world, 42, event)).toBe(true);
    expect(world.actors.get(actor(42, 21))?.visible).toBe(false);
  });

  it("a lost Rafael: the line, his reveal undone, and 5 on him fights again", () => {
    const flags: [number, number][] = [
      ...LATE,
      [39, 101],
      [40, 101],
      [41, 101],
      [42, 6310],
      [42, 101],
    ];
    const { world } = enter(42, 150, 300, flags);
    world.tick([]);
    const lost = settle(world, 60000, false);
    expect(starts(lost.seen, says("RAFAEL"))).toBe(true);
    expect(starts(lost.seen.slice(-1), [DOC.text.lost])).toBe(true);
    expect(done(world, 42, 6254)).toBe(true);
    expect(done(world, 42, DOC.parts.RAFAEL.flag)).toBe(false);
    for (let i = 0; i < 5; i++) world.tick([]);
    expect(world.eventVisible).toBe(false);
    const again = talk(world, actor(42, 21));
    expect(again.fights.map((f) => f.species)).toEqual([members("4")]);
    expect(done(world, 42, 102)).toBe(true);
    expect(done(world, 42, 103)).toBe(true);
  });

  it("41's merchant: the offer's menu and its tip", () => {
    const { world } = enter(41, 200, 200, [...LATE, [39, 101], [40, 101], [41, 101]]);
    const r = talk(world, actor(41, 31));
    expect(starts(r.seen, says("MERCHANT_41_OFFER"))).toBe(true);
    expect(world.eventScene?.choice?.options).toEqual(["Mua", "Bán", "Gửi pet", "Rời đi"]);
    for (let i = 0; i < 3; i++) world.tick(["down"]);
    world.tick(["confirm"]);
    const tip = settle(world);
    expect(starts(tip.seen, says("MERCHANT_41_TIP"))).toBe(true);
  });

  it("the way back from 42: every door back to 38 is open, and 38's portal returns to 60 and 10", () => {
    const flags: [number, number][] = [
      ...LATE,
      [39, 101],
      [40, 101],
      [41, 101],
      [42, 101],
      [42, 102],
      [42, 103],
    ];
    const { world } = enter(42, 150, 300, flags);
    for (const room of [42, 41, 40, 39]) {
      const [tx, ty, target] = DOC.doors[String(room)].find((d) => d[2] === room - 1)!;
      if (world.roomIndex !== room) world.warp({ scene: 98, room, x: 200, y: 200, direction: 0 });
      world.player.x = tx * 20 + 10;
      world.player.y = ty * 20 + 10;
      world.tick([]);
      expect(world.roomIndex).toBe(target);
    }
    // PORTAL_BACK says nothing: its flag and the landing tell it played.
    stand(world, 70, 150, ["confirm"]);
    expect(done(world, 38, DOC.parts.PORTAL_BACK.flag)).toBe(true);
    expect([world.roomIndex, world.player.x, world.player.y]).toEqual([60, 210, 139]);
    stand(world, 200, 385);
    expect(world.roomIndex).toBe(10);
  });

  it("Lạc Khắc's rescue in 39 waits for the laboratory and Linh, then plays", () => {
    const locke = read<import("./CauVongLocke").CauVongLockeDocument>("locke.json");
    const { world } = enter(39, 300, 300, [...LATE, [39, 101], [47, 7003]]);
    const r = stand(world, 160, 540);
    expect(starts(r.seen, sayOf(locke.parts.RESCUE_PRE.steps))).toBe(true);
    expect(r.fights.map((f) => f.species)).toEqual([locke.battles["39"].members.map(([s]) => s)]);
    expect(starts(r.seen, sayOf(locke.parts.RESCUE_POST.steps))).toBe(true);
    expect(done(world, 39, 1302)).toBe(true);
  });

  it("48 reopens the final after 42's finale, and the finals' row appears", () => {
    const flags: [number, number][] = [...LATE, [42, 101], [42, 102], [42, 103]];
    const { world } = enter(48, 300, 200, flags);
    const girl = world.actors.get(SEA.actors["48"]["1"])!;
    expect([girl.x, girl.y, girl.visible]).toEqual([160, 60, true]);
    const r = stand(world, 400, 80);
    expect(starts(r.seen, seaSays("REOPEN"))).toBe(true);
    expect(done(world, 48, 120)).toBe(true);
    expect(done(world, 48, 130)).toBe(true);
    // Chapter 5 now points at the finals (its newest stage, 48:120).
    const sea = assets.cauVongOpening!.quests.find((q) => q.title.startsWith("Cầu Vồng 5 "))!;
    expect(sea).toMatchObject({ title: "Cầu Vồng 5 — Bắc Hải", done: [30, 124] });
    expect(openingQuestDetail(sea, ([room, event]) => done(world, room, event))).toContain(
      "Gặp trọng tài tại đấu trường (30)",
    );
  });

  it.each(CAU_VONG_LAB_STAGE_NAMES)("checkpoint %s opens on its first line", (stage) => {
    const screen = new NewGameScreen(
      false,
      assets,
      boot,
      new SaveRepository(new MemorySaveStore()),
      () => {},
    );
    expect(applyUrlParityCheckpoint(screen, new URLSearchParams(`cauVongLab=${stage}`))).toBe(true);
    const world = screen.host.world!;
    expect(world.eventScene?.currentText ?? world.eventScene?.choice).toBeTruthy();
  });
});
