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
const { CAU_VONG_PORTAL_ROWS } = await import("./WorldTransition");
const { TIER_LOCK_WARNING, SKILL_NOT_READY_WARNING } = await import("../battle/engine/BattleTypes");
const { openingQuestDetail } = await import("./CauVongOpening");
type FourGatesDocument = import("./CauVongFourGates").CauVongFourGatesDocument;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
for (const room of [0, 5, 9, 10, 11, 12, 13, 15, 16, 17, 18, 20, 21, 22, 23, 52])
  await assets.prepareRoom(98, room);

const DOC = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../public/pack/cau-vong-world/four-gates.json"),
    "utf8",
  ),
) as FourGatesDocument;
const says = (name: string) =>
  DOC.parts[name].steps.flatMap((cue) => (cue.k === "say" ? [cue] : []));
const flag = (name: string): [number, number] => [DOC.parts[name].room, DOC.parts[name].flag];
const actor = (room: number, source: number) => DOC.actors[String(room)][String(source)];
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

/** Ticks, confirming every box and winning any fight, until nothing plays or a menu is open. */
function play(world: World, limit = 30000) {
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
      if (foe?.alive()) foe.setHp(0);
      if (mine?.alive()) mine.setHp(mine.maxHp());
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

describe("Bốn Cổng (CauVongFourGateSourceRuntime), CV4a", () => {
  it("bakes Java's parts, the routes the free world reads, and the masked pair", () => {
    expect(Object.keys(DOC.parts)).toHaveLength(60);
    expect(DOC.parts.RIVAL_EAST_POST).toMatchObject({ room: 12, flag: 1634, started: 1734 });
    expect(DOC.parts.MASKED_BEFORE).toMatchObject({ room: 5, flag: -1, started: -1 });
    // `CauVongFourGateRoutes.PORTALS` is the table the dispatcher already walks.
    expect(DOC.portals).toEqual(CAU_VONG_PORTAL_ROWS.map((row) => [...row]));
    expect(species("masked")).toEqual([102, 131]);
    expect(DOC.items.mushroom.id).toBe(9009);
  });

  it("the hub: the teacher's introduction, then the east gate's report", () => {
    const { world } = enter(9, 200, 300);
    world.tick([]);
    expect(done(world, 9, 100)).toBe(true);
    const intro = talk(world, actor(9, 6));
    expect(starts(intro.seen, says("INTRO"))).toBe(true);
    expect(done(world, ...flag("INTRO"))).toBe(true);
  });

  it("the east gate: brief, the teacher's fight, then 15:100 opens the way home", () => {
    const { world } = enter(15, 200, 300);
    const teacher = actor(15, 4);
    expect(starts(talk(world, teacher).seen, says("EAST_BRIEF"))).toBe(true);
    const fight = talk(world, teacher);
    expect(fight.fights).toEqual([species("15:0")]);
    expect(starts(fight.seen, says("EAST_POST"))).toBe(true);
    expect(done(world, 15, 100)).toBe(true);
    expect(done(world, 15, 1800)).toBe(true);
  });

  it("the rescue in 13: the strip starts the fight, the post grants pet 52 once (runtime 152, `acquire`)", () => {
    const { world } = enter(13, 310, 455);
    const before = world.pets.filter((pet) => pet.speciesId === 152).length;
    const { fights, seen } = play(world);
    expect(fights).toEqual([species("13:1")]);
    expect(starts(seen, says("RESCUE_POST"))).toBe(true);
    expect(done(world, 13, 100)).toBe(true);
    expect(done(world, 13, 41152)).toBe(true);
    const owned =
      world.pets.filter((pet) => pet.speciesId === 152).length +
      world.meta.campaign.petBank.filter((pet) => pet.speciesId === 152).length;
    expect(owned).toBe(before + 1);
  });

  it("the lost pet: notice in 9, the ball in 10, its return at the hub", () => {
    const { world } = enter(9, 190, 375, [
      [9, 101],
      [23, 100],
    ]);
    const notice = play(world);
    expect(starts(notice.seen, says("LOST_NOTICE"))).toBe(true);
    expect(done(world, 9, 102)).toBe(true);
    expect(world.roomIndex).toBe(11);
    world.warp({ scene: 98, room: 10, x: 360, y: 275, direction: 0 });
    const found = play(world);
    expect(starts(found.seen, says("LOST_FOUND"))).toBe(true);
    expect(done(world, 10, 100)).toBe(true);
    // The ball comes back with the hero, and the hub takes it.
    expect(world.roomIndex).toBe(9);
    play(world);
    expect(done(world, ...flag("LOST_RETURN"))).toBe(true);
    expect(world.inventory[String(DOC.items.ball.id)] ?? 0).toBe(0);
  });

  it("the masked pair in the ruins once the lost pet is reported", () => {
    const { world } = enter(5, 350, 340, [
      [5, 100],
      [9, 102],
    ]);
    const { seen, fights } = play(world);
    expect(starts(seen, says("MASKED_BEFORE"))).toBe(true);
    expect(fights).toEqual([species("masked")]);
    expect(starts(seen, says("MASKED_AFTER"))).toBe(true);
    for (const event of [101, 129, 130, 131]) expect(done(world, 5, event)).toBe(true);
    for (const id of [2, 3, 54]) expect(world.actors.get(id)?.visible).toBe(false);
  });

  it("bug fix: the west gate's chapter-8 scenes wait for the release plan (3:113)", () => {
    const { world } = enter(17, 300, 300);
    play(world);
    expect(done(world, 17, 100)).toBe(false);
    // 18's first visit writes its own line, as Java does.
    world.warp({ scene: 98, room: 18, x: 300, y: 300, direction: 0 });
    const line = play(world);
    expect(line.seen.map(flatten)).toContain(flatten(DOC.text.west18.text));
    expect(done(world, 18, 100)).toBe(true);
  });

  it("17's merchant sells the mushrooms, and fifteen of them buy the plant egg", () => {
    const { world } = enter(17, 300, 300, [flag("SHOP_WEST"), [18, 100]]);
    world.currency.money = 10_000;
    const greeting = talk(world, actor(17, 24));
    expect(greeting.seen.length).toBeGreaterThan(0);
    expect(world.eventScene?.choice?.options).toEqual(DOC.menus["7"]);
    pick(world, 2);
    expect(world.inventory["9009"]).toBe(15);
    expect(world.currency.money).toBe(10_000 - 3000);
    const notice = talk(world, actor(17, 27));
    expect(starts(notice.seen, says("MUSHROOM_NOTICE"))).toBe(true);
    talk(world, actor(17, 27));
    expect(world.eventScene?.choice?.options).toEqual(DOC.menus["2"]);
    const reward = pick(world, 0);
    expect(reward.seen).toContain("Nhận được Trứng Chủng Thực Vật × 1");
    expect(world.inventory["9009"] ?? 0).toBe(0);
    expect(world.bag.specials).toContain(8059);
    expect(done(world, ...flag("MUSHROOM_REWARD"))).toBe(true);
  });

  it("52's lever opens the south depth gate", () => {
    const { world } = enter(52, DOC.southLever.x, DOC.southLever.y + 30);
    world.tick(["confirm"]);
    play(world);
    expect(done(world, 52, 101)).toBe(true);
  });

  it("the east rival waits for Lạc Khắc's first duel, then fights and rewards once", () => {
    const { world } = enter(12, 300, 300, [[2, DOC.flags.lockeAfter]]);
    const before = world.inventory["5"] ?? 0;
    const first = talk(world, actor(12, 14));
    expect(first.fights).toEqual([species("12:6")]);
    expect(first.seen).toContain("Nhận được Chocolate × 1");
    expect((world.inventory["5"] ?? 0) - before).toBe(1);
    talk(world, actor(12, 14));
    expect(world.eventScene?.choice?.options).toEqual(DOC.menus["6"]);
    const rematch = pick(world, 0);
    expect(rematch.fights).toEqual([species("12:7")]);
    expect((world.inventory["5"] ?? 0) - before).toBe(1);
  });

  it("the quest row follows fourGateQuestDetail's stages", () => {
    const { world } = enter(9, 200, 300);
    const quest = assets.cauVongOpening!.quests.find((q) => q.variants)!;
    expect(quest.title).toBe("Cầu Vồng — Bốn Cổng và cứu pet");
    const row = () => ({
      detail: openingQuestDetail(quest, ([r, e]) => done(world, r, e)),
    });
    expect(row().detail).toBe(quest.variants!.at(-1)!.text);
    world.eventState.op14CompleteEvent(98, 9, 101);
    expect(row().detail).toBe(quest.variants![15].text);
    world.eventState.op14CompleteEvent(98, 20, 100);
    expect(row().detail).toBe(quest.variants![13].text);
  });
});
