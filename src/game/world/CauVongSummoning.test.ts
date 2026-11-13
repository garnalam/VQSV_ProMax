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
type SummoningDocument = import("./CauVongSummoning").CauVongSummoningDocument;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
for (const room of [0, 49, 50, 51, 63, 64, 65, 66]) await assets.prepareRoom(98, room);

const DOC = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../public/pack/cau-vong-world/summoning.json"),
    "utf8",
  ),
) as SummoningDocument;
const says = (name: string) =>
  DOC.parts[name].steps.flatMap((cue) => (cue.k === "say" ? [cue] : []));
const replied = (key: string) => DOC.replies[key].flatMap((cue) => (cue.k === "say" ? [cue] : []));

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
const { CauVongMinigame } = await import("./CauVongMinigame");

const HUB: [number, number][] = [[50, 651100]];
const game = (room: number, event: number) =>
  DOC.games.find((g) => g.room === room && g.event === event)!;
const boss = (room: number, event: number) =>
  DOC.bosses.find((b) => b.room === room && b.event === event)!;
const WON = (kind: number) => 650200 + kind;

/** Plays the memory board through: wait the countdown out, then press each pair's cards. */
function winMemory(world: World) {
  const view = () => world.cauVongMinigameView!;
  // Rules → paid board.
  world.tick(["confirm"]);
  expect(view().m.phase).toBe(2);
  for (let i = 0; i < 400 && view().m.countdown > 0; i++) world.tick([]);
  const t = view().tables;
  const cells = [...view().m.cells];
  const pairs = new Map<number, number[]>();
  cells.forEach((c, i) => pairs.set(c, [...(pairs.get(c) ?? []), i]));
  for (const [a, b] of pairs.values()) {
    for (const i of [a, b]) {
      // Each card waits for its flip-back to finish (`flips`).
      for (let k = 0; k < 10 && view().m.flips[i] > 0; k++) world.tick([]);
      const m = view().m;
      world.minigamePointer(CauVongMinigame.cardX(t, m, i) + 5, CauVongMinigame.cardY(t, m, i) + 5);
      world.tick([]);
    }
    for (let k = 0; k < 20 && view().m.delay > 0; k++) world.tick([]);
  }
  expect(view().m.phase).toBe(3);
  expect(view().m.score).toBeGreaterThan(0);
  world.tick(["confirm"]);
  expect(world.cauVongMinigameOpen).toBe(false);
}

describe("CV0' Thiên Không: the summoning rooms", () => {
  it("bakes Java's games, summoners, parts and tables", () => {
    expect(DOC.games.length).toBe(16);
    expect(DOC.bosses.map((b) => `${b.room}:${b.event}`)).toEqual([
      "49:2",
      "66:9",
      "65:4",
      "64:8",
      "63:8",
      "51:7",
      "51:8",
      "51:10",
      "51:9",
      "51:11",
    ]);
    for (const b of DOC.bosses) {
      expect(part(`BOSS_${b.room}_${b.event}`)).toBeDefined();
      expect(part(`WIN_${b.room}_${b.event}`)).toBeDefined();
    }
    expect(DOC.longVuong.species).toBe(280);
    expect(Object.keys(DOC.minigame.shellPets).sort()).toEqual(["30", "55", "83"]);
  });

  it("66's first scene, then a host's menu opens a board, and a won board marks the room", () => {
    const { world } = enter(66, 120, 300, HUB);
    settle(world);
    expect(done(world, 66, DOC.flags.complete)).toBe(true);
    const memory = game(66, 2);
    expect(memory.kind).toBe(2);
    let r = talk(world, memory.actor);
    expect(starts(r.seen, replied(memory.stages[0]))).toBe(true);
    expect(world.eventScene?.choice?.options).toEqual(DOC.menus.game);
    // "Nghe tin tức": the stage-1 text, no board.
    r = pick(world, 1);
    expect(starts(r.seen, replied(memory.stages[1]))).toBe(true);
    expect(world.cauVongMinigameOpen).toBe(false);
    // Not enough kim: the board stays on its rules.
    world.currency.money = 0;
    talk(world, memory.actor);
    pick(world, 0);
    expect(world.cauVongMinigameOpen).toBe(true);
    world.tick(["confirm"]);
    expect(world.cauVongMinigameView!.m.roundResult).toBe(-1);
    world.tick(["back"]);
    expect(world.cauVongMinigameOpen).toBe(false);
    // Paid and won.
    world.currency.money = 5000;
    talk(world, memory.actor);
    pick(world, 0);
    winMemory(world);
    expect(done(world, 66, WON(2))).toBe(true);
    expect(world.currency.money).toBeGreaterThan(5000 - 200);
  });

  it("66's summoner waits for the four games, then fights; a loss says so, a win completes 66", () => {
    const { world } = enter(66, 120, 300, HUB);
    settle(world);
    const b = boss(66, 9);
    let r = talk(world, b.actor);
    expect(r.seen.map(flatten)).toEqual([flatten(DOC.text.games)]);
    for (let k = 0; k < 4; k++) world.eventState.op14CompleteEvent(98, 66, WON(k));
    r = talk(world, b.actor);
    expect(starts(r.seen, says("BOSS_66_9"))).toBe(true);
    expect(world.eventScene?.choice?.options).toEqual(DOC.menus.boss);
    // Lost.
    world.tick(["confirm"]);
    const lost = settle(world, 60000, false);
    expect([...lost.seen].map(flatten)).toContain(flatten(DOC.text.lost));
    expect(done(world, 66, DOC.flags.complete + 9)).toBe(false);
    // Won.
    talk(world, b.actor);
    r = pick(world, 0);
    const won = settle(world);
    expect([...r.fights, ...won.fights][0]).toEqual(b.battle.members.map(([id]) => id));
    expect(starts([...r.seen, ...won.seen], says("WIN_66_9"))).toBe(true);
    expect(done(world, 66, DOC.flags.complete + 9)).toBe(true);
    expect(done(world, 66, 53953)).toBe(true);
    // Asked again: the won reply only.
    r = talk(world, b.actor);
    expect(starts(r.seen, replied(b.won))).toBe(true);
  });

  it("65's summoner waits for 66's", () => {
    const { world } = enter(65, 120, 300, HUB);
    settle(world);
    const r = talk(world, boss(65, 4).actor);
    expect(r.seen.map(flatten)).toEqual([flatten(DOC.text.prerequisite)]);
  });

  it("Long Vương stops the hero on 49's floor; the win gives his pet once", () => {
    const { world } = enter(49, 150, 300, HUB);
    settle(world);
    const dragon = world.actors.get(DOC.longVuong.actor)!;
    expect(dragon.sprite).toBe(DOC.longVuong.sprite);
    const before = world.pets.length;
    world.player.x = 150;
    world.player.y = 100;
    world.tick([]);
    const r = settle(world);
    expect(starts(r.seen, says("BOSS_49_2"))).toBe(true);
    expect(r.fights[0]).toEqual([280]);
    expect(starts(r.seen, says("WIN_49_2"))).toBe(true);
    expect(done(world, 49, DOC.flags.complete + 2)).toBe(true);
    expect(world.pets.length).toBe(before + 1);
    expect(world.pets.at(-1)!.speciesId).toBe(136);
  });

  it("a lost Long Vương fight says so; his floor waits, and talking to him fights again", () => {
    const { world } = enter(49, 150, 300, HUB);
    settle(world);
    world.player.x = 150;
    world.player.y = 100;
    world.tick([]);
    const lost = settle(world, 60000, false);
    expect(lost.fights[0]).toEqual([280]);
    expect(lost.seen.map(flatten)).toContain(flatten(DOC.text.lost));
    expect(done(world, 49, DOC.flags.complete + 2)).toBe(false);
    for (const pet of world.pets) pet.currentHp = undefined;
    // The floor does not stop the hero again (`RETRY`).
    world.player.x = 150;
    world.player.y = 100;
    world.tick([]);
    expect(settle(world).fights).toEqual([]);
    // Face him from just under his mask (he is wide, so the usual 35 px is out of reach).
    const dragon = world.actors.get(DOC.longVuong.actor)!;
    world.player.x = dragon.x;
    world.player.y = dragon.y + 16;
    world.player.direction = 2;
    world.tick(["confirm"]);
    const again = play(world);
    const won = settle(world);
    expect([...again.fights, ...won.fights][0]).toEqual([280]);
    expect(done(world, 49, DOC.flags.complete + 2)).toBe(true);
  });

  it("after 63's trial Miro opens the hub's gates, and each gate plays its portal again", () => {
    const { world } = enter(50, 310, 560, [...HUB, [63, DOC.flags.complete + 8]]);
    settle(world);
    world.player.x = 150;
    world.player.y = 100;
    world.tick([]);
    const r = settle(world);
    expect(starts(r.seen, says("FIRST_50_9"))).toBe(true);
    expect(done(world, 50, DOC.flags.complete + 9)).toBe(true);
    for (const portal of ["PORTAL_10", "PORTAL_13"]) {
      const [x, y] = portal === "PORTAL_10" ? [245, 125] : [425, 365];
      for (let round = 0; round < 2; round++) {
        world.player.x = x;
        world.player.y = y;
        world.tick([]);
        // The portal is playing (its marker 652000+e*10 is set until it ends).
        expect(done(world, 50, part(portal).started)).toBe(true);
        settle(world);
        expect(done(world, 50, part(portal).started)).toBe(false);
        expect(world.roomIndex).toBe(50);
        world.player.x = 310;
        world.player.y = 560;
        world.tick([]);
      }
    }
  });

  it("a saved board that does not read back is closed; the streak is kept", () => {
    const { world } = enter(64, 120, 300, HUB);
    world.cauVongMinigame; // the fresh board is checked
    const campaign = (world as unknown as { meta: { campaign: Record<string, unknown> } }).meta
      .campaign;
    campaign.cauVongMinigame = { room: 64, kind: 3, streak: 2, cells: "broken" };
    expect(world.cauVongMinigame.room).toBe(-1);
    expect(world.cauVongMinigame.streak).toBe(2);
    expect(world.cauVongMinigameOpen).toBe(false);
  });

  it("51's first scene, then the alliance clerk's menu and its explanation", () => {
    const { world } = enter(51, 120, 300, [...HUB, [63, DOC.flags.complete + 8]]);
    settle(world);
    expect(done(world, 51, DOC.flags.complete + 6)).toBe(true);
    const clerk = DOC.services.find((s) => s.action === 5)!;
    let r = talk(world, clerk.actor);
    expect(starts(r.seen, replied(clerk.reply))).toBe(true);
    settle(world);
    expect(world.eventScene?.choice?.options).toEqual(DOC.menus.alliance);
    r = pick(world, 2);
    expect(starts(r.seen, replied(DOC.alliance.info))).toBe(true);
  });
});
