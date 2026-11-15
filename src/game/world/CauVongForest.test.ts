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
const { openingQuestDetail } = await import("./CauVongOpening");
type ForestDocument = import("./CauVongForest").CauVongForestDocument;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
for (const room of [0, 1, 4, 9, 10, 11, 24, 26, 38, 39, 40, 59, 60])
  await assets.prepareRoom(98, room);

const DOC = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../public/pack/cau-vong-world/forest.json"),
    "utf8",
  ),
) as ForestDocument;
const says = (name: string) =>
  DOC.parts[name].steps.flatMap((cue) => (cue.k === "say" ? [cue] : []));
const actor = (room: number, source: number) => DOC.actors[String(room)][String(source)];
const FOUR = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../public/pack/cau-vong-world/four-gates.json"),
    "utf8",
  ),
) as import("./CauVongFourGates").CauVongFourGatesDocument;
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

const RAID: [number, number] = [9, FOUR.parts.RAID.flag];
/** The metal mount owned (`rideUnlocked`: 9:41734) and ridden. */
function rideMetal(world: World) {
  world.eventState.op14CompleteEvent(98, 9, 41734);
  world.meta.campaign.ride.activeIndex = DOC.flags.metalRide;
}
const part = (name: string) => DOC.parts[name];

describe("Rừng U Ám, 60, cửa Bắc and the rocks (CV4b)", () => {
  it("bakes Java's parts, fights, doors and rocks", () => {
    expect(part("PERMISSION")).toMatchObject({ room: 38, flag: 6000, started: 6100, cue: 210000 });
    expect(part("GIRL_POST")).toMatchObject({ room: 40, flag: 6005, started: 6105 });
    expect(part("DEPART")).toMatchObject({ room: 60, flag: 1501, started: 3301, cue: 11500 });
    expect(part("RESCUE_CONFRONT")).toMatchObject({ room: 26, flag: -1, cue: 47000 });
    expect(part("RECOVERY")).toMatchObject({ room: 59, flag: 131, cue: 8000 });
    expect(part("RECOVERY").steps.slice(0, 3)).toEqual([
      { k: "place", id: -1, x: 270, y: 99 },
      { k: "face", id: -1, dir: 1 },
      { k: "cameraToPlayer" },
    ]);
    // `boss.d 84/44/51` at 29/30/30 (`rescueBattleRequest`).
    expect(species("rescue")).toEqual([184, 144, 151]);
    expect(species("5")).toHaveLength(5);
    expect(Object.keys(DOC.rocks)).toEqual(["6", "10", "24", "52"]);
    expect(DOC.doors["39"].filter((d) => d[2] === 40)).toHaveLength(3);
  });

  it("a rock: the hint without the metal mount, then it breaks on it and stays gone", () => {
    const rock = DOC.rocks["10"][1];
    const { world } = enter(10, rock.x + 10, rock.y + 10 + 25, [RAID]);
    world.player.direction = 2;
    world.tick(["confirm"]);
    const { seen } = play(world);
    expect(flatten(seen[0])).toBe(flatten(rock.hint).slice(0, flatten(seen[0]).length));
    expect(world.actors.get(rock.actorId)?.visible).toBe(true);
    // The closed rock blocks the hero walking up into it.
    const y = world.player.y;
    for (let i = 0; i < 10; i++) world.tick(["up"]);
    expect(world.player.y).toBeGreaterThan(rock.y + 20);
    expect(world.player.y).toBeLessThanOrEqual(y);
    rideMetal(world);
    world.player.y = rock.y + 10 + 25;
    world.player.direction = 2;
    world.tick(["confirm"]);
    expect(done(world, 10, 846100 + rock.canonical)).toBe(true);
    expect(world.actors.get(rock.actorId)?.state).toBe(rock.state + 1);
    for (let i = 0; i < 200 && !done(world, 10, 846000 + rock.canonical); i++) world.tick([]);
    expect(done(world, 10, 846000 + rock.canonical)).toBe(true);
    expect(world.actors.get(rock.actorId)?.visible).toBe(false);
    // A reload keeps it gone.
    world.warp({ scene: 98, room: 10, x: 300, y: 300, direction: 0 });
    expect(world.actors.get(rock.actorId)?.visible).toBe(false);
  });

  it("10 → 60 once the raid opens the forest route, and 60's DEPART into 38", () => {
    const { world } = enter(10, 460, 20);
    world.tick([]);
    expect(world.roomIndex).toBe(10);
    world.eventState.op14CompleteEvent(98, ...RAID);
    world.tick([]);
    expect([world.roomIndex, world.player.x, world.player.y]).toEqual([60, 200, 340]);
    // The south strip goes back down to 10.
    world.player.y = 380;
    world.tick([]);
    expect([world.roomIndex, world.player.x, world.player.y]).toEqual([10, 460, 45]);
    world.warp({ scene: 98, room: 60, x: 210, y: 110, direction: 2 });
    world.tick([]);
    const { seen } = play(world);
    expect(done(world, 60, 1501)).toBe(true);
    expect(world.roomIndex).toBe(38);
    // 38: PORTAL_ARRIVE (queued by `arrive`), then the soldiers' PERMISSION.
    expect(done(world, 38, part("PORTAL_ARRIVE").flag)).toBe(true);
    expect(done(world, 38, 100)).toBe(true);
    expect(starts(seen, says("PERMISSION"))).toBe(true);
  });

  it("the first visit: the blue trail, the girl's rescue, and the way back to the city", () => {
    const { world } = enter(39, 150, 560, [RAID, [38, 100]]);
    world.tick([]);
    let { seen } = play(world);
    expect(starts(seen, says("BLUE_TRAIL"))).toBe(true);
    expect(done(world, 39, 100)).toBe(true);
    world.warp({ scene: 98, room: 40, x: 300, y: 400, direction: 2 });
    world.tick([]);
    const result = play(world);
    seen = result.seen;
    expect(starts(seen, says("GIRL_PRE"))).toBe(true);
    expect(result.fights).toEqual([species("5")]);
    expect(starts(seen, says("GIRL_POST"))).toBe(true);
    expect(done(world, 40, 6305)).toBe(true);
    expect(done(world, 40, 6400)).toBe(true);
    // GIRL_POST lands in 39 (7, 0); CITY_RETURN then takes the hero to the city (23, 6).
    expect(starts(seen, says("CITY_RETURN"))).toBe(true);
    expect([world.roomIndex, world.player.x, world.player.y]).toEqual([1, 490, 139]);
    // The north notice is next at the hub.
    const quest = assets.cauVongOpening!.quests.find((q) => q.title.startsWith("Cầu Vồng 3 "))!;
    const detail = openingQuestDetail(quest, ([r, e]) => done(world, r, e));
    expect(detail).toContain("Xem hết cảnh trở về thành sau lần đầu vào Rừng U Ám");
  });

  it("a lost forest fight: the line, the party revived, and a retry waits for 5", () => {
    const { world } = enter(40, 300, 400, [RAID, [38, 100], [39, 100]]);
    world.tick([]);
    const { seen } = play(world, 30000, false);
    expect(starts(seen.slice(-1), [DOC.text.lost])).toBe(true);
    expect(done(world, 40, 6255)).toBe(true);
    expect(done(world, 40, part("GIRL_PRE").started)).toBe(false);
    expect(world.pets.every((pet) => (pet.currentHp ?? 1) > 0)).toBe(true);
    // Standing in the strip does nothing until 5.
    for (let i = 0; i < 5; i++) world.tick([]);
    expect(world.eventVisible).toBe(false);
    world.tick(["confirm"]);
    expect(world.eventVisible).toBe(true);
    const again = play(world);
    expect(again.fights).toEqual([species("5")]);
    expect(done(world, 40, 6305)).toBe(true);
    expect(done(world, 40, 6255)).toBe(false);
  });

  it("after the first visit 39 → 40 stays shut, and the hero can still walk (JavaSE froze him)", () => {
    const { world } = enter(39, 150, 39, [
      RAID,
      [38, 100],
      [39, 100],
      [40, 6005],
      [40, 6400],
      [39, 6015],
    ]);
    const [tx, ty] = DOC.doors["39"].find((d) => d[2] === 40)!;
    world.player.x = tx * 20 + 10;
    world.player.y = ty * 20 + 10;
    world.tick(["up"]);
    expect(world.roomIndex).toBe(39);
    const y = world.player.y;
    for (let i = 0; i < 5; i++) world.tick(["down"]);
    expect(world.player.y).toBeGreaterThan(y);
  });

  it("38's merchant: the greeting, then the offer's menu; 39's alliance supervisor", () => {
    const { world } = enter(38, 200, 300, [
      RAID,
      [38, 100],
      [60, 1501],
      [38, part("PORTAL_ARRIVE").flag],
    ]);
    const first = talk(world, actor(38, 13));
    expect(starts(first.seen, says("MERCHANT_38"))).toBe(true);
    expect(world.eventScene?.choice?.options).toEqual(["Mua", "Bán", "Gửi pet", "Rời đi"]);
    const tip = pick(world, 3);
    expect(starts(tip.seen, says("MERCHANT_38_TIP"))).toBe(true);
    world.warp({ scene: 98, room: 39, x: 200, y: 300, direction: 0 });
    world.eventState.op14CompleteEvent(98, 39, 100);
    world.warp({ scene: 98, room: 39, x: 200, y: 300, direction: 0 });
    talk(world, actor(39, 26));
    expect(world.eventScene?.choice?.options).toEqual([
      "Đẳng cấp huấn luyện viên",
      "Đổi huy chương",
      "Liên minh",
      "Lời khuyên",
    ]);
    const info = pick(world, 2);
    expect(starts(info.seen, says("ALLIANCE_INFO"))).toBe(true);
  });

  it("the north: 24's line once, the masked man's fight in 26, the dorm's morning after", () => {
    const { world } = enter(24, 300, 300, [RAID, [40, 6400], [9, 104]]);
    world.tick([]);
    let { seen } = play(world);
    expect(starts(seen, [DOC.text.north24])).toBe(true);
    expect(done(world, 24, 101)).toBe(true);
    world.tick([]);
    expect(world.eventVisible).toBe(false);
    world.warp({ scene: 98, room: 26, x: 170, y: 130, direction: 2 });
    world.tick([]);
    const rescue = play(world, 60000);
    seen = rescue.seen;
    expect(starts(seen, says("RESCUE_CONFRONT"))).toBe(true);
    expect(rescue.fights).toEqual([species("rescue")]);
    expect(starts(seen, says("RESCUE_EXPLOSION"))).toBe(true);
    for (const event of [110, 111, 112]) expect(done(world, 26, event)).toBe(true);
    expect(done(world, 59, 130)).toBe(true);
    // 59: the morning after, then the middle arena (4) at (250, 170).
    expect(starts(seen, says("RECOVERY"))).toBe(true);
    expect(done(world, 59, 131)).toBe(true);
    expect(done(world, 26, 100)).toBe(true);
    expect([world.roomIndex, world.player.x, world.player.y]).toEqual([4, 250, 170]);
    const quest = assets.cauVongOpening!.quests.find((q) => q.title.startsWith("Cầu Vồng 3 "))!;
    expect(openingQuestDetail(quest, ([r, e]) => done(world, r, e))).toContain(
      "Đến đấu trường trung cấp",
    );
  });

  it("requires Mao Cau Dieu to cross the cloud edge in room 24", () => {
    const { world } = enter(24, 470, 270, [RAID, [40, 6400], [9, 104]]);
    while (world.mapLoading) world.tickMapLoading();
    play(world);
    expect(world.warp({ scene: 98, room: 24, x: 470, y: 270, direction: 0 })).toBe(true);
    while (world.mapLoading) world.tickMapLoading();
    expect(world.activeRideIndex).toBe(-1);
    for (let tick = 0; tick < 5; tick++) world.tick(["holdDown"]);
    expect([world.roomIndex, world.player.y]).toEqual([24, 270]);
    expect(world.selectRide(7)).toBe("ready");
    for (let tick = 0; tick < 3; tick++) world.tick(["holdDown"]);
    expect([world.roomIndex, world.player.y]).toEqual([24, 294]);
    world.dismountRide();
    expect(world.activeRideIndex).toBe(7);
  });

  it("a lost rescue: the masked man's line, then 5 in the strip tries again", () => {
    const { world } = enter(26, 170, 130, [RAID, [40, 6400], [9, 104]]);
    world.tick([]);
    const { seen } = play(world, 30000, false);
    expect(starts(seen.slice(-1), [DOC.text.rescueLost])).toBe(true);
    expect(done(world, 26, 113)).toBe(true);
    expect(done(world, 26, 110)).toBe(false);
    for (let i = 0; i < 5; i++) world.tick([]);
    expect(world.eventVisible).toBe(false);
    world.tick(["confirm"]);
    expect(done(world, 26, 113)).toBe(false);
    const again = play(world, 60000);
    expect(again.fights).toEqual([species("rescue")]);
    expect(done(world, 26, 110)).toBe(true);
  });

  it("Rừng Gai (11): the rival's thorn duel once the west duel is over", () => {
    const post = FOUR.parts.RIVAL_WEST_POST;
    const { world } = enter(11, 300, 300, [[post.room, post.flag]]);
    const id = FOUR.actors["11"]["26"];
    expect(world.actors.get(id)?.visible).toBe(true);
    const { seen, fights } = talk(world, id);
    const pre = FOUR.parts.RIVAL_THORN_PRE.steps.flatMap((cue) => (cue.k === "say" ? [cue] : []));
    expect(starts(seen, pre)).toBe(true);
    expect(fights).toEqual([FOUR.battles["11:4"].members.map(([s]) => s)]);
    expect(done(world, 11, FOUR.parts.RIVAL_THORN_POST.flag)).toBe(true);
  });

  it("the quest row follows the forest, the recovery and the rescue", () => {
    const { world } = enter(9, 200, 300, [RAID]);
    const quest = assets.cauVongOpening!.quests.find((q) => q.title.startsWith("Cầu Vồng 3 "))!;
    const row = () => openingQuestDetail(quest, ([r, e]) => done(world, r, e));
    expect(row()).toContain("Đi Rừng U Ám lần đầu");
    world.eventState.op14CompleteEvent(98, 9, 104);
    expect(row()).toContain("Xem hết cảnh trở về thành sau lần đầu vào Rừng U Ám");
    world.eventState.op14CompleteEvent(98, 59, 130);
    expect(row()).toContain("Xem hết cuộc nói chuyện sáng hôm sau");
    world.eventState.op14CompleteEvent(98, 59, 131);
    expect(row()).toContain("Đến đấu trường trung cấp");
  });
});
