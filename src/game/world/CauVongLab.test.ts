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
const { currentOpeningQuest, openingQuestDetail } = await import("./CauVongOpening");
type LabDocument = import("./CauVongLab").CauVongLabDocument;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
for (const room of [0, 1, 2, 3, 4, 5, 9, 11, 17, 19, 57, 58, 59])
  await assets.prepareRoom(98, room);

const DOC = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../public/pack/cau-vong-world/lab.json"),
    "utf8",
  ),
) as LabDocument;
const says = (name: string) =>
  DOC.parts[name].steps.flatMap((cue) => (cue.k === "say" ? [cue] : []));
const species = (key: string) => DOC.battles[key].members.map(([id]) => id);

/** Scene 98 past the opening, CV3's Tứ Môn told (3:102), `flags` set, then `room` at (x, y). */
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
  for (const [r, event] of [[3, 102] as [number, number], ...flags])
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
const flatten = (text: string) => text.replace(/#[0-9A-Fa-f]{6}/g, "").replace(/\s+/g, "");
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
      // Like a player reading the HUD, the cursor skips a slot the Phong Bế seal or tier lock shut,
      // so no refusal warning should ever open (`CauVongAcademy.test.ts`).
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

const part = (name: string) => DOC.parts[name];
const ROUTE: [number, number] = [2, 140];
const ACADEMY = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../public/pack/cau-vong-world/academy.json"),
    "utf8",
  ),
) as import("./CauVongAcademy").CauVongAcademyDocument;
const academySays = (name: string) =>
  ACADEMY.parts[name].steps.flatMap((cue) => (cue.k === "say" ? [cue] : []));
/** Plays on until the world is back in `room` with nothing playing. */
function settle(world: World, limit = 60000) {
  const seen: string[] = [],
    fights: number[][] = [];
  for (let i = 0; i < 6; i++) {
    const r = play(world, limit);
    seen.push(...r.seen);
    fights.push(...r.fights);
    world.tick([]);
    if (!world.eventVisible && world.phase === "freeworld") break;
  }
  return { seen, fights };
}

describe("Hoàng Dực Điểu, the laboratory and the exam (CV4c)", () => {
  it("bakes Java's parts, fights and lines", () => {
    expect(part("INTRO")).toMatchObject({ room: 3, flag: 110, started: 114, cue: 7000 });
    expect(part("CONFRONTATION")).toMatchObject({ room: 3, flag: 111, started: 115, cue: 7300 });
    expect(part("RELEASE")).toMatchObject({ room: 3, flag: 113, cue: 7600 });
    for (const room of [17, 19, 57, 58])
      expect(part(`BIRD_${room}`)).toMatchObject({ room, flag: 100, cue: 46000 });
    expect(part("PROLOGUE")).toMatchObject({ room: 58, flag: 114, cue: 48000 });
    expect(part("PROLOGUE").steps[0]).toEqual({ k: "show", id: -1, on: false });
    expect(part("PROLOGUE").steps.at(-2)).toEqual({ k: "show", id: -1, on: true });
    // The broken apparatus writes 58:112 as it turns (`CauVongLabRescueRuntime.BROKEN`).
    expect(part("LAB_RESCUE").steps).toContainEqual({ k: "mark", room: 58, event: 112 });
    expect(part("LAB_RETURN")).toMatchObject({ room: 59, flag: 121, started: 120, cue: 8200 });
    expect(part("EXAM_PRE3")).toMatchObject({ room: 9, flag: -1, cue: 41480 });
    expect(part("DORM_FIND_POST").steps.filter((cue) => cue.k === "pet")).toHaveLength(2);
    // `rescueRequest`: boss.d 65/47/41/23 at 30; the exam's four rosters.
    expect(species("bird")).toEqual([81, 174, 139, 98]);
    expect(species("exam0")).toEqual([171, 21]);
    expect(species("exam3")).toEqual([46, 155]);
    expect(DOC.text.examLost.map((line) => line.speaker)).toEqual([
      "Giáo viên cửa Đông",
      "Giáo viên cửa Nam",
      "Giáo viên cửa Tây",
      "Giáo viên cửa Bắc",
    ]);
    expect(ACADEMY.parts.ANGEL).toMatchObject({ room: 2, flag: 904, started: 984 });
    expect(ACADEMY.parts.NIGHT).toMatchObject({ room: 59, flag: 907, started: 987 });
  });

  it("3: An Kỳ Nhi's introduction, the tour and night first, then the twins' fight and the plan", () => {
    const { world } = enter(3, 300, 400, [ROUTE, [4, 1500]]);
    const girl = DOC.actors.classGirl;
    let r = talk(world, girl);
    expect(starts(r.seen, says("INTRO"))).toBe(true);
    expect(done(world, 3, 110)).toBe(true);
    expect(done(world, 3, 114)).toBe(true);
    world.warp({ scene: 98, room: 3, x: 300, y: 400, direction: 0 });
    r = talk(world, girl);
    expect(r.seen.map(flatten)).toEqual([flatten(DOC.text.expansionWait.text)]);
    world.eventState.op14CompleteEvent(98, 2, 904);
    world.eventState.op14CompleteEvent(98, 59, 907);
    world.warp({ scene: 98, room: 3, x: 300, y: 400, direction: 0 });
    r = talk(world, girl);
    const after = settle(world);
    expect(starts(r.seen, says("CONFRONTATION"))).toBe(true);
    expect([...r.fights, ...after.fights]).toEqual([species("bird")]);
    expect(starts([...r.seen, ...after.seen], says("RELEASE"))).toBe(true);
    for (const event of [111, 112, 113]) expect(done(world, 3, event)).toBe(true);
    expect(world.actors.get(girl)?.visible).toBe(false);
  });

  it("3: a lost fight says so, and talking to her again fights again", () => {
    const flags: [number, number][] = [ROUTE, [3, 110], [2, 904], [59, 907], [3, 111]];
    const { world } = enter(3, 300, 400, flags);
    world.player.x = world.actors.get(DOC.actors.classGirl)!.x + 10;
    world.player.y = world.actors.get(DOC.actors.classGirl)!.y + 35;
    world.player.direction = 2;
    world.tick(["confirm"]);
    const lost = play(world, 30000, false);
    expect(lost.fights).toEqual([species("bird")]);
    expect(flatten(lost.seen.at(-1)!)).toBe(flatten(DOC.text.expansionLost.text));
    expect(done(world, 3, 112)).toBe(false);
  });

  it("2 and 59: the tour once she is introduced, then the night at the bed heals", () => {
    const { world } = enter(2, 300, 420, [ROUTE, [3, 110]]);
    expect(world.actors.get(ACADEMY.actors.angel)?.visible).toBe(true);
    world.tick([]);
    let r = play(world);
    expect(starts(r.seen, academySays("ANGEL"))).toBe(true);
    expect(done(world, 2, 904)).toBe(true);
    world.warp({ scene: 98, room: 59, x: 270, y: 100, direction: 0 });
    world.pets[0].currentHp = 1;
    world.tick([]);
    r = play(world);
    expect(starts(r.seen, academySays("NIGHT"))).toBe(true);
    expect(done(world, 59, 907)).toBe(true);
    expect(world.pets[0].currentHp ?? world.pets[0].maxHp).not.toBe(1);
  });

  it("17's bird scene waits for the release plan (the JavaSE bug fix), then plays once", () => {
    const { world } = enter(17, 300, 300);
    for (let i = 0; i < 5; i++) world.tick([]);
    expect(done(world, 17, 100)).toBe(false);
    world.eventState.op14CompleteEvent(98, 3, 113);
    world.warp({ scene: 98, room: 17, x: 300, y: 300, direction: 0 });
    world.tick([]);
    const { seen } = play(world);
    expect(starts(seen, says("BIRD_17"))).toBe(true);
    expect(done(world, 17, 100)).toBe(true);
  });

  it("57 → 58 → 59: the guards, the prologue, the rescue, the dorm's investigation", () => {
    const { world } = enter(57, 240, 310, [
      [3, 113],
      [57, 100],
    ]);
    world.tick([]);
    const guards = settle(world);
    expect(starts(guards.seen, says("GUARD_INTERCEPT"))).toBe(true);
    expect(guards.fights[0]).toEqual(species("guard"));
    expect(starts(guards.seen, says("GUARD_ESCAPE"))).toBe(true);
    expect(done(world, 57, 101)).toBe(true);
    // 58: the prologue (58:114), then An Kỳ Nhi and the bird (58:100).
    expect(world.roomIndex).toBe(58);
    expect(starts(guards.seen, says("PROLOGUE"))).toBe(true);
    expect(starts(guards.seen, says("BIRD_58"))).toBe(true);
    expect(done(world, 58, 114)).toBe(true);
    expect(done(world, 58, 100)).toBe(true);
    world.player.x = 200;
    world.player.y = 250;
    world.tick([]);
    const lab = settle(world);
    expect(lab.fights).toEqual([species("lab")]);
    expect(starts(lab.seen, says("LAB_ESCAPE"))).toBe(true);
    for (const event of [101, 110, 111, 112]) expect(done(world, 58, event)).toBe(true);
    // 59 (330, 419): the investigation (59:6), then the principal's report is next.
    expect(starts(lab.seen, says("LAB_RETURN"))).toBe(true);
    expect(done(world, 59, 121)).toBe(true);
    expect(world.roomIndex).toBe(59);
  });

  it("57: a lost fight waits for 5 in the strip", () => {
    const { world } = enter(57, 240, 310, [
      [3, 113],
      [57, 100],
      [57, 101 + 10],
    ]);
    world.eventState.op42RepeatEvent(98, 57, 111);
    world.eventState.op14CompleteEvent(98, 57, 111);
    world.tick([]);
    const lost = play(world, 30000, false);
    expect(flatten(lost.seen.at(-1)!)).toBe(flatten(DOC.text.guardLost.text));
    expect(done(world, 57, 113)).toBe(true);
    for (let i = 0; i < 5; i++) world.tick([]);
    expect(world.eventVisible).toBe(false);
    // The intercept left the hero up the corridor: back to the strip first.
    world.player.x = 240;
    world.player.y = 310;
    world.tick(["confirm"]);
    expect(done(world, 57, 113)).toBe(false);
  });

  it("9: four rounds, each from its own teacher; a loss writes 9:131", () => {
    // The four gates' story in 9 is behind the hero (`CauVongFourGateSourceRuntime`).
    const story = [1600, 1601, 1611, 1613, 1614, 1617, 1618, 1619].map(
      (e) => [9, e] as [number, number],
    );
    const { world } = enter(9, 200, 300, [
      ...story,
      [9, 101],
      [9, 103],
      [20, 100],
      [26, 100],
      [4, 1501],
    ]);
    const teacher = (round: number) => DOC.actors.teachers[round];
    let r = talk(world, teacher(0));
    expect(starts(r.seen, says("EXAM_PRE0"))).toBe(true);
    expect(r.fights).toEqual([species("exam0")]);
    expect(starts(r.seen, says("EXAM_POST0"))).toBe(true);
    expect([110, 120, 130, 140].filter((event) => !done(world, 9, event))).toEqual([]);
    world.warp({ scene: 98, room: 9, x: 200, y: 300, direction: 0 });
    world.player.x = world.actors.get(teacher(1))!.x + 10;
    world.player.y = world.actors.get(teacher(1))!.y + 35;
    world.player.direction = 2;
    world.tick(["confirm"]);
    r = play(world, 30000, false);
    expect(flatten(r.seen.at(-1)!)).toBe(flatten(DOC.text.examLost[1].text));
    expect(done(world, 9, 131)).toBe(true);
    expect(done(world, 9, 141)).toBe(false);
    for (const round of [1, 2, 3]) {
      world.warp({ scene: 98, room: 9, x: 200, y: 300, direction: 0 });
      r = talk(world, teacher(round));
      expect(r.fights).toEqual([species(`exam${round}`)]);
    }
    expect(done(world, 9, 114)).toBe(true);
    // The exam closes chapter 4 (An Kỳ Nhi); chapter 5 (Bắc Hải) is the open row.
    const quests = assets.cauVongOpening!.quests,
      flag = ([room, event]: [number, number]) => done(world, room, event);
    expect(
      assets.cauVongOpening!.quests.find((q) => q.title.startsWith("Cầu Vồng 4 "))!.done,
    ).toEqual([9, 114]);
    const sea = quests.find((q) => q.title === "Cầu Vồng 5 — Bắc Hải")!;
    expect(flag(sea.show!)).toBe(true);
    expect(flag(sea.done)).toBe(false);
    expect(openingQuestDetail(sea, flag)).toContain("văn phòng (27)");
  });

  it("Thiết Giáp Xà: the cry, the pursuit in 11, the rescue in 5, the return in 59", () => {
    const { world } = enter(59, 200, 470);
    world.tick([]);
    let r = play(world);
    expect(starts(r.seen, says("DORM_NOTICE"))).toBe(true);
    r = talk(world, DOC.actors.dormGirl);
    expect(starts(r.seen, says("DORM_ACCEPT"))).toBe(true);
    expect(done(world, 59, 1101)).toBe(true);
    world.warp({ scene: 98, room: 11, x: 60, y: 140, direction: 0 });
    for (const id of DOC.actors.thorn) expect(world.actors.get(id)?.visible).toBe(true);
    world.tick([]);
    r = play(world);
    expect(done(world, 11, 1130)).toBe(true);
    world.player.x = 210;
    world.player.y = 170;
    world.tick([]);
    r = settle(world);
    expect(r.fights).toEqual([species("pursuit")]);
    expect(done(world, 11, 1133)).toBe(true);
    world.warp({ scene: 98, room: 5, x: 50, y: 300, direction: 0 });
    world.tick([]);
    r = settle(world);
    expect(r.fights).toEqual([species("dorm")]);
    expect(done(world, 5, 1104)).toBe(true);
    expect(world.pets.some((pet) => pet.speciesId === 122)).toBe(true);
    world.warp({ scene: 98, room: 59, x: 100, y: 200, direction: 0 });
    talk(world, DOC.actors.dormGirl);
    expect(world.eventScene?.choice?.options).toEqual(DOC.menus.dormReturn);
    r = pick(world, 0);
    expect(starts(r.seen, says("DORM_RETURN"))).toBe(true);
    expect(done(world, 59, 1106)).toBe(true);
    expect(world.pets.some((pet) => pet.speciesId === 122)).toBe(false);
  });

  it("the quest row follows the expansion, the lab and the exam", () => {
    const { world } = enter(9, 200, 300, [ROUTE, [26, 100], [59, 131]]);
    // The chapter route the panel would show: chapter 3's last step, chapter 4 step by step, then 5.
    const flag = ([room, event]: [number, number]) => done(world, room, event);
    const row = () => {
      const open = currentOpeningQuest(assets.cauVongOpening!.quests, flag)!;
      return `${open.title}: ${openingQuestDetail(open, flag)}`;
    };
    for (const prior of [
      [6, 100],
      [3, 102],
    ] as [number, number][])
      world.eventState.op14CompleteEvent(98, ...prior);
    const steps: [number, number][] = [
      [4, 1500],
      [3, 110],
      [2, 904],
      [59, 907],
      [3, 113],
      [58, 101],
      [59, 121],
      [4, 1501],
      [9, 114],
    ];
    const seen = [row()];
    for (const [room, event] of steps) {
      world.eventState.op14CompleteEvent(98, room, event);
      seen.push(row());
    }
    const expected = [
      ["Cầu Vồng 3", "nghe hết báo cáo cứu giáo viên"],
      ["Cầu Vồng 4", "để xem hết cảnh giới thiệu học viên trao đổi"],
      ["Cầu Vồng 4", "xem hết cảnh tham quan trường"],
      ["Cầu Vồng 4", "nghỉ qua đêm"],
      ["Cầu Vồng 4", "hai anh em bắt Hoàng Dực Điểu"],
      ["Cầu Vồng 4", "vào phòng thí nghiệm (58)"],
      ["Cầu Vồng 4", "Xem hết cuộc điều tra tại ký túc xá"],
      ["Cầu Vồng 4", "nghe hết báo cáo điều tra"],
      ["Cầu Vồng 4", "giáo viên Đông, Nam, Tây, Bắc"],
      ["Cầu Vồng 5", "văn phòng (27)"],
    ];
    expect(seen).toHaveLength(expected.length);
    seen.forEach((text, i) => {
      expect(text.startsWith(expected[i][0]), text).toBe(true);
      expect(text, text).toContain(expected[i][1]);
    });
  });
});
