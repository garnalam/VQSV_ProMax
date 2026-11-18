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
type AcademyDocument = import("./CauVongAcademy").CauVongAcademyDocument;
type OpeningDocument = import("./CauVongOpening").CauVongOpeningDocument;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
for (const room of [0, 1, 2, 3, 4, 7, 8, 27, 59]) await assets.prepareRoom(98, room);

const read = (file: string) =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../public/pack", file), "utf8"));
const ACADEMY = read("cau-vong-world/academy.json") as AcademyDocument;
const OPENING = read("cau-vong-world/opening.json") as OpeningDocument;
const COLLISION = read("cau-vong-world/collision.json").rooms as Record<
  string,
  Record<string, { dx: number; dy: number }>
>;
const flatten = (text: string) =>
  text
    .normalize("NFC")
    .replace(/#[0-9A-Fa-f]{6}/g, "")
    .replace(/\s+/g, "");

/** Registered at the academy (CV2 over), `flags` set, then `room` at (x, y). */
const REGISTERED: [number, number][] = [
  [6, 100],
  [0, 101],
  [2, 100],
  [2, 101],
  [2, 140],
  [2, 830000],
];
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
  for (const [r, event] of [...REGISTERED, ...flags])
    world.eventState.op14CompleteEvent(98, r, event);
  world.inventory["9002"] = 1;
  // A party that outlasts the trainers: the tests are about the route, not damage.
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

/**
 * Ticks, confirming every ready box and winning (or losing) any fight, until nothing plays or a
 * choice is open. Returns the boxes seen and the fights' first enemy species.
 */
function play(world: World, lose = false, limit = 40000) {
  const seen: string[] = [];
  const fights: number[] = [];
  let quiet = 0,
    last: unknown = null;
  for (let tick = 0; tick < limit; tick++) {
    const battle = world.battle;
    if (battle) {
      if (battle !== last) {
        last = battle;
        fights.push(battle.core!.enemySetup(0).speciesId);
      }
      const foe = battle.core?.activeUnit("enemy"),
        mine = battle.core?.activeUnit("player");
      if (lose) {
        if (mine?.alive()) mine.setHp(0);
      } else {
        if (foe?.alive()) foe.setHp(0);
        if (mine?.alive()) mine.setHp(mine.maxHp());
      }
      // The trainers carry Kỹ năng Phong Bế: like a player reading the HUD, the cursor skips a slot
      // the seal closed or the Phong Bế tier lock shuts, so no warning should ever open.
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
  throw new Error("The room kept playing");
}
/** Every expected line was shown (boxes page long lines, so the start of each box is matched). */
const showed = (seen: string[], lines: string[]) =>
  lines.every((line) => seen.some((box) => flatten(line).startsWith(flatten(box).slice(0, 12))));
const says = (name: string) =>
  ACADEMY.parts[name].steps.flatMap((cue) => (cue.k === "say" ? [cue.text] : []));
/** The hero just below an NPC's anchor, facing up (or above it, facing down), presses. */
function ask(world: World, id: number, above = false) {
  const actor = world.actors.get(id)!,
    mechanic = COLLISION[`98:${world.roomIndex}`]?.[String(id)] ?? { dx: 0, dy: 0 };
  world.player.x = actor.x + mechanic.dx;
  world.player.y = actor.y + mechanic.dy + (above ? -16 : 16);
  world.player.direction = above ? 0 : 2;
  world.tick(["confirm"]);
}
function choose(world: World, index: number) {
  for (let i = 0; i < index; i++) world.tick(["down"]);
  world.tick(["confirm"]);
}
/** The hero on a source point, one still tick. */
function stand(world: World, x: number, y: number) {
  world.player.x = x;
  world.player.y = y;
  world.tick([]);
}
const species = (key: string) => ACADEMY.battles[key].members[0][0];

describe("Cầu Vồng CV3 (nhập học và đời sống Học viện)", () => {
  it("bakes Java's sequences, fights, doors and the quest row", () => {
    expect(ACADEMY.parts.ARENA_INTRO).toMatchObject({ room: 8, flag: 810001, started: 811001 });
    expect(ACADEMY.parts.BRIEF).toMatchObject({ room: 4, flag: 140, started: 170, cue: 3000 });
    expect(ACADEMY.parts.POST2).toMatchObject({ room: 4, flag: 146, started: 176 });
    expect(ACADEMY.parts.TOUR).toMatchObject({ room: 2, flag: 141, started: 171 });
    expect(ACADEMY.parts.FOUR_GATES).toMatchObject({ room: 3, flag: 141, started: 171 });
    expect(ACADEMY.parts.LOCKE_PRE).toMatchObject({ room: 2, flag: 900, started: 980 });
    expect(ACADEMY.parts.ALLIANCE).toMatchObject({ room: 3, flag: 906, started: 986 });
    // The ceremony's three gifts, each once under its own receipt.
    const gifts = ACADEMY.parts.CEREMONY.steps.flatMap((c) => (c.k === "award" ? [c.receipt] : []));
    expect(gifts).toEqual([150, 151, 152]);
    expect(ACADEMY.battles.prelim0.members).toEqual([[103, 59, 1]]);
    expect(ACADEMY.battles.arena2.members).toEqual([[107, 63, 1]]);
    expect(ACADEMY.battles.roster47.members).toHaveLength(3);
    expect(ACADEMY.doors["2"].map(([, , room]) => room)).toEqual([3, 3, 8, 8, 7, 7]);
    expect(ACADEMY.award.id).toBe(9003);
    // Chapter 2 (Học viện) ends at Tứ Môn's lesson, which opens chapter 3 (Bốn Cổng).
    expect(OPENING.quests[1]).toMatchObject({ title: "Cầu Vồng 2 — Học viện", done: [3, 102] });
    expect(OPENING.quests[2]).toMatchObject({ title: "Cầu Vồng 3 — Bốn Cổng", show: [3, 102] });
  });

  it.each([
    [359, 619],
    [379, 599],
  ])("takes the academy's right exit at y=%i to the North Sea office", (y, arrivalY) => {
    const world = enter(2, 530, y);
    play(world);
    expect(world.roomIndex).toBe(2);
    for (let tick = 0; tick < 10 && world.roomIndex === 2; tick++) world.tick(["right"]);
    expect([world.roomIndex, world.player.x, world.player.y, world.player.direction]).toEqual([
      27,
      30,
      arrivalY,
      1,
    ]);
  });

  it("2 → 8: the doors open once registered; the preliminaries, a loss and the retry", () => {
    const world = enter(2, 300, 400);
    play(world);
    // The east door tile (21, 11) leads to the preliminary arena.
    stand(world, 21 * 20 + 10, 11 * 20 + 10);
    play(world);
    expect(world.roomIndex).toBe(8);
    play(world);
    expect(done(world, 8, 0)).toBe(true);
    ask(world, ACADEMY.actors.arenaClerk);
    expect(showed(play(world).seen, says("ARENA_REGISTER"))).toBe(true);
    expect(done(world, 8, 1)).toBe(true);
    ask(world, ACADEMY.actors.arenaClerk);
    play(world);
    expect(world.eventScene?.choice?.options).toEqual(ACADEMY.choices.arena);
    expect(done(world, 8, 822001)).toBe(true);
    choose(world, 0);
    // The first round lost: healed, told to come back; the won-round marker untouched.
    const lost = play(world, true);
    expect(done(world, 8, 822001)).toBe(false);
    expect(lost.fights).toEqual([species("prelim0")]);
    expect(showed(lost.seen, [ACADEMY.text.prelimLoss.text])).toBe(true);
    expect(done(world, 8, 823000)).toBe(false);
    expect(done(world, 8, 823100)).toBe(false);
    expect(world.pets.every((pet) => (pet.currentHp ?? 1) > 0)).toBe(true);
    // Asked again: the offer, then straight into the fight (ARENA_FIRST is over).
    ask(world, ACADEMY.actors.arenaClerk);
    play(world);
    choose(world, 0);
    const won = play(world);
    for (let i = 0; i < 4 && !done(world, 8, 100); i++) won.fights.push(...play(world).fights);
    expect(won.fights).toEqual([species("prelim0"), species("prelim1")]);
    expect(done(world, 8, 2)).toBe(true);
    expect(done(world, 8, 100)).toBe(true);
  });

  it("4: without the preliminaries the arena sends the hero back to the yard", () => {
    const world = enter(4, 50, 560);
    const seen = play(world).seen;
    expect(world.roomIndex).toBe(2);
    expect(showed(seen, [ACADEMY.text.needsPrelim.text])).toBe(true);
  });

  it("4: the brief, three rounds (one lost and retried), then the yard and the tour", () => {
    const world = enter(4, 50, 560, [
      [8, 2],
      [8, 100],
    ]);
    expect(showed(play(world).seen, says("BRIEF"))).toBe(true);
    expect(done(world, 4, 140)).toBe(true);
    ask(world, 40);
    play(world);
    expect(world.eventScene?.choice?.options).toEqual(ACADEMY.choices.round[0]);
    choose(world, 0);
    const lost = play(world, true);
    expect(lost.fights).toEqual([species("arena0")]);
    expect(showed(lost.seen, [ACADEMY.text.arenaLoss.text])).toBe(true);
    expect(done(world, 4, 101)).toBe(false);
    const fights: number[] = [];
    for (let round = 0; round < 3; round++) {
      ask(world, 40);
      play(world);
      expect(world.eventScene?.choice?.options).toEqual(ACADEMY.choices.round[round]);
      choose(world, 0);
      for (let i = 0; i < 4 && !done(world, 4, ACADEMY.parts[`POST${round}`].flag); i++)
        fights.push(...play(world).fights);
    }
    expect(fights).toEqual([species("arena0"), species("arena1"), species("arena2")]);
    expect(done(world, 4, 104)).toBe(true);
    // POST2 moves the hero to the yard, where the tour starts.
    for (let i = 0; i < 4 && !done(world, 2, 141); i++) play(world);
    expect(world.roomIndex).toBe(2);
    expect(done(world, 2, 141)).toBe(true);
  });

  it("59 → 2 → 3: the dorm night, the ceremony, the principal and Tứ Môn finish CV3", () => {
    const world = enter(2, 300, 400, [
      [8, 2],
      [4, 104],
      [2, 141],
    ]);
    play(world);
    // The dorm door.
    stand(world, 40, 584);
    const night = play(world).seen;
    expect(world.roomIndex).toBe(59);
    expect(showed(night, says("DORM"))).toBe(true);
    for (const pet of world.pets) pet.currentHp = 1;
    stand(world, 270, 100);
    for (let i = 0; i < 4 && !done(world, 59, 102); i++) play(world);
    expect(done(world, 59, 102)).toBe(true);
    expect(world.pets.every((pet) => (pet.currentHp ?? 0) > 1)).toBe(true);
    for (let i = 0; i < 4 && !done(world, 59, 905); i++) play(world);
    expect(done(world, 59, 905)).toBe(true);
    // Back to the yard: the ceremony trades the pass for the medal and hands out three gifts.
    world.warp({ scene: 98, room: 2, x: 300, y: 400, direction: 0 });
    const ceremony = play(world).seen;
    expect(showed(ceremony, says("CEREMONY"))).toBe(true);
    expect(done(world, 2, 103)).toBe(true);
    expect(world.inventory["9002"] ?? 0).toBe(0);
    expect(world.inventory["9003"]).toBe(1);
    expect([150, 151, 152].every((receipt) => done(world, 2, receipt))).toBe(true);
    stand(world, 500, 600);
    expect(showed(play(world).seen, says("PRINCIPAL"))).toBe(true);
    expect(done(world, 2, 143)).toBe(true);
    // The classroom gate, the lesson, then Tứ Môn at the front.
    stand(world, 60, 310);
    play(world);
    expect(world.roomIndex).toBe(3);
    expect(done(world, 3, 100)).toBe(true);
    ask(world, 1);
    expect(showed(play(world).seen, says("LESSON"))).toBe(true);
    expect(done(world, 3, 101)).toBe(true);
    stand(world, 360, 390);
    expect(showed(play(world).seen, says("FOUR_GATES"))).toBe(true);
    expect(done(world, 3, 102)).toBe(true);
  });

  it("2: Lạc Khắc's duel after the arena, lost then won, with its gifts", () => {
    const world = enter(2, 300, 400, [
      [8, 2],
      [4, 104],
      [2, 141],
    ]);
    play(world);
    expect(world.actors.get(ACADEMY.actors.locke)?.visible).toBe(true);
    ask(world, ACADEMY.actors.locke);
    play(world);
    expect(world.eventScene?.choice?.options).toEqual(ACADEMY.choices.locke);
    choose(world, 0);
    const lost = play(world, true);
    expect(lost.fights).toEqual([species("rival")]);
    expect(showed(lost.seen, [ACADEMY.text.rivalLoss.text])).toBe(true);
    expect(done(world, 2, 900)).toBe(true);
    ask(world, ACADEMY.actors.locke);
    play(world);
    choose(world, 0);
    const won = play(world);
    for (let i = 0; i < 3 && !done(world, 2, 902); i++) play(world);
    expect(won.fights).toEqual([species("rival")]);
    expect(done(world, 2, 902)).toBe(true);
    expect([261, 266, 269].every((receipt) => done(world, 2, receipt))).toBe(true);
    expect(world.actors.get(ACADEMY.actors.locke)?.visible).toBe(false);
  });

  it("2: the roster trainers fight once after their line", () => {
    const world = enter(2, 300, 400);
    play(world);
    // 46 stands right below him: Red is asked from above.
    ask(world, 44, true);
    const fight = play(world);
    for (let i = 0; i < 3 && !done(world, 2, 12); i++) fight.seen.push(...play(world).seen);
    expect(fight.fights).toEqual([species("roster44")]);
    expect(done(world, 2, 12)).toBe(true);
    expect(showed(fight.seen, [ACADEMY.text.rosterWin["12"].text])).toBe(true);
    ask(world, 44, true);
    expect(play(world).fights).toEqual([]);
  });

  it("3: the alliance's introduction, its gifts and the rank menu", () => {
    const world = enter(3, 280, 560, [
      [3, 100],
      [3, 102],
    ]);
    play(world);
    ask(world, ACADEMY.actors.alliance);
    expect(showed(play(world).seen, says("ALLIANCE"))).toBe(true);
    expect(done(world, 3, 906)).toBe(true);
    expect([262, 263].every((receipt) => done(world, 3, receipt))).toBe(true);
    expect(world.eventScene?.choice?.options).toEqual(ACADEMY.choices.alliance);
    for (let id = 100; id < 106; id++) world.collection.markCollected(id);
    choose(world, 0);
    const up = play(world).seen;
    expect(up.some((box) => flatten(box).includes("bậc2"))).toBe(true);
    expect(done(world, 3, 922)).toBe(true);
    ask(world, ACADEMY.actors.alliance);
    play(world);
    const badges = world.currency.badges;
    choose(world, 1);
    play(world);
    expect(world.currency.badges).toBe(badges + 6);
    expect(done(world, 3, 5100)).toBe(true);
  });

  it("7: the academy hatchery's scene, the incubator, then its door back", () => {
    const world = enter(7, 30, 600);
    play(world);
    ask(world, ACADEMY.actors.hatchery);
    expect(showed(play(world).seen, says("HATCHERY"))).toBe(true);
    expect(done(world, 7, 0)).toBe(true);
    expect(world.takeServiceRequest()?.continuation).toBe("CAU_VONG_INCUBATOR");
    // Later asks open the incubator straight away.
    ask(world, ACADEMY.actors.hatchery);
    expect(play(world).seen).toEqual([]);
    expect(world.takeServiceRequest()?.continuation).toBe("CAU_VONG_INCUBATOR");
    stand(world, 30, 630);
    play(world);
    expect(world.roomIndex).toBe(2);
  });

  it.each([
    ["prelims", 8, "ARENA_INTRO"],
    ["brief", 4, "BRIEF"],
    ["tour", 2, "TOUR"],
    ["dorm", 59, "DORM"],
    ["ceremony", 2, "CEREMONY"],
    ["locke", 2, "LOCKE_PRE"],
    ["lesson", 3, "LESSON"],
    ["fourGates", 3, "FOUR_GATES"],
    ["alliance", 3, "ALLIANCE"],
  ])("?cauVongOpening=%s opens room %i on %s", (stage, room, part) => {
    const screen = new NewGameScreen(
      false,
      assets,
      boot,
      new SaveRepository(new MemorySaveStore()),
      () => {},
    );
    expect(applyUrlParityCheckpoint(screen, new URLSearchParams("cauVongOpening=" + stage))).toBe(
      true,
    );
    const world = screen.host.world!;
    expect(world.roomIndex).toBe(room);
    const text = world.eventScene?.currentText ?? "";
    expect(says(part).some((line) => flatten(line).startsWith(flatten(text).slice(0, 12)))).toBe(
      true,
    );
  });
});
