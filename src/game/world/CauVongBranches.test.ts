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
type BranchesDocument = import("./CauVongBranches").CauVongBranchesDocument;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
for (const room of [0, 1, 27, 43, 44, 50, 67]) await assets.prepareRoom(98, room);

const read = (file: string) =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../public/pack", file), "utf8"));
const BRANCHES = read("cau-vong-world/branches.json") as BranchesDocument;
const COLLISION = read("cau-vong-world/collision.json").rooms as Record<
  string,
  Record<string, { dx: number; dy: number }>
>;
const AUX = BRANCHES.aux;
const MENU = 822000;
/** `CauVongSummoningRuntime.completed(50, 0)`: the hub's first scene is over. */
const HUB_SEEN: [number, number] = [50, 651100];
const flatten = (text: string) =>
  text
    .normalize("NFC")
    .replace(/#[0-9A-Fa-f]{6}/g, "")
    .replace(/\s+/g, "");

/** CV1 behind the hero (the city's lunch delivered), `flags` set, then `room` at (x, y). */
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
  const base: [number, number][] = [[6, 100], [0, 101], [1, 100], HUB_SEEN];
  for (const [r, event] of [...base, ...flags]) world.eventState.op14CompleteEvent(98, r, event);
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

/** Ticks, confirming every box, until quiet or a choice opens. */
function play(world: World, limit = 20000) {
  const seen: string[] = [];
  let quiet = 0;
  for (let tick = 0; tick < limit; tick++) {
    const scene = world.eventScene;
    if (scene?.choice) return seen;
    if (scene?.currentText && seen.at(-1) !== scene.currentText) seen.push(scene.currentText);
    const busy = world.eventVisible || world.phase !== "freeworld";
    quiet = busy ? 0 : quiet + 1;
    if (quiet > 3) return seen;
    world.tick(scene?.textReady ? ["confirm"] : []);
  }
  throw new Error("The room kept playing");
}
const says = (name: string) =>
  BRANCHES.parts[name].steps.flatMap((cue) => (cue.k === "say" ? [cue.text] : []));
const saw = (seen: string[], text: string) =>
  seen.some((box) => flatten(text).startsWith(flatten(box).slice(0, 12)));
const showed = (seen: string[], name: string) => says(name).every((line) => saw(seen, line));
function ask(world: World, id: number) {
  const actor = world.actors.get(id)!,
    mechanic = COLLISION[`98:${world.roomIndex}`]?.[String(id)] ?? { dx: 0, dy: 0 };
  world.player.x = actor.x + mechanic.dx;
  world.player.y = actor.y + mechanic.dy + 16;
  world.player.direction = 2;
  world.tick(["confirm"]);
  return play(world);
}
function choose(world: World, index: number) {
  for (let i = 0; i < index; i++) world.tick(["down"]);
  world.tick(["confirm"]);
  return play(world);
}
const options = (world: World) => world.eventScene?.choice?.options ?? [];
/** The hero on tile (tx, ty), 5 pressed. */
function press(world: World, tx: number, ty: number) {
  world.player.x = tx * 20 + 10;
  world.player.y = ty * 20 + 19;
  world.tick(["confirm"]);
  return play(world);
}

/** The city's arrival plays its scene, which ends in the cafe (44); the hero is put back in 1. */
function arriveInCity(world: World) {
  play(world);
  if (world.roomIndex === 1) return;
  world.warp({ scene: 98, room: 1, x: 260, y: 300, direction: 0 });
  play(world);
}

describe("the aux room 67 and its lifts (CauVongMissingBranchesRuntime)", () => {
  it("plays Nhất Hôi's request, the pet he wants to see, the passage and the lift to 50 and back", () => {
    const world = enter(67, 230, 330);
    // `at(17, 12, 20, 13)`: the intro on the way in.
    world.player.x = 370;
    world.player.y = 259;
    world.tick([]);
    expect(showed(play(world), "AUX_INTRO")).toBe(true);
    expect(done(world, 67, 0)).toBe(true);
    expect(showed(ask(world, AUX.guide), "AUX_REQUEST")).toBe(true);
    expect(done(world, 67, 1)).toBe(true);
    // Without the pet 189 the request is read again.
    expect(showed(ask(world, AUX.guide), "AUX_REQUEST_REPLY")).toBe(true);
    expect(done(world, 67, 2)).toBe(false);
    world.pets.push({ ...world.pets[0], speciesId: AUX.wanted });
    expect(showed(ask(world, AUX.guide), "AUX_SHOW")).toBe(true);
    expect(done(world, 67, 2)).toBe(true);
    expect(saw(ask(world, AUX.guide), AUX.rows["1"].text)).toBe(true);
    // `at(10, 5, 16, 9)`: the passage opens.
    world.player.x = 250;
    world.player.y = 139;
    world.tick([]);
    expect(showed(play(world), "AUX_OPEN")).toBe(true);
    expect(done(world, 67, 3)).toBe(true);
    // Tile (13, 7): the lift up (menu 4).
    press(world, 13, 7);
    expect(options(world)).toEqual(BRANCHES.menus["4"]);
    expect(done(world, 67, MENU + 4)).toBe(true);
    choose(world, 0);
    expect(done(world, 67, MENU + 4)).toBe(false);
    expect([world.roomIndex, world.player.x, world.player.y]).toEqual([50, 30, 559]);
    // The hub's lift down (menu 7, tile 1,28) once 67:3 is set.
    press(world, 1, 28);
    expect(options(world)).toEqual(BRANCHES.menus["7"]);
    choose(world, 0);
    expect([world.roomIndex, world.player.x, world.player.y]).toEqual([67, 270, 179]);
    expect([done(world, 50, 4), done(world, 67, 5)]).toEqual([true, true]);
    // The lift is reusable: its movements replay.
    press(world, 13, 7);
    choose(world, 0);
    expect(world.roomIndex).toBe(50);
    press(world, 1, 28);
    choose(world, 1);
    expect(world.roomIndex).toBe(50);
  });

  it("opens the vine to the sky hub without showing the flower pet", () => {
    const world = enter(67, 250, 139, [
      [67, 0],
      [67, 1],
    ]);
    expect(world.pets.some((pet) => pet.speciesId === AUX.wanted)).toBe(false);
    world.tick([]);
    expect(showed(play(world), "AUX_OPEN")).toBe(true);
    expect(done(world, 67, 2)).toBe(false);
    press(world, 13, 7);
    expect(options(world)).toEqual(BRANCHES.menus["4"]);
    choose(world, 0);
    expect(world.roomIndex).toBe(50);
  });

  it("Tiểu Mỹ's notice, 43's quest scroll for 7 badges, and the scroll traded for the egg", () => {
    const world = enter(67, 230, 330, [[67, 0]]);
    expect(showed(ask(world, AUX.mei), "SCROLL_NOTICE")).toBe(true);
    expect(done(world, 67, 6)).toBe(true);
    expect(showed(ask(world, AUX.mei), "SCROLL_NOTICE_REPLY")).toBe(true);
    // 43: the clerk's line, then menu 8.
    const shop = enter(43, 120, 200, [[67, 6]]);
    shop.currency.badges = 6;
    expect(saw(ask(shop, AUX.clerk), BRANCHES.lines.clerk.text)).toBe(true);
    expect(options(shop)).toEqual(BRANCHES.menus["8"]);
    expect(saw(choose(shop, 0), BRANCHES.lines.notBought.text)).toBe(true);
    expect([shop.currency.badges, shop.inventory[String(AUX.scroll.id)] ?? 0]).toEqual([6, 0]);
    shop.currency.badges = 7;
    ask(shop, AUX.clerk);
    expect(saw(choose(shop, 0), BRANCHES.lines.bought.text)).toBe(true);
    expect([shop.currency.badges, shop.inventory[String(AUX.scroll.id)]]).toEqual([0, 1]);
    // "Cửa hàng quyển trục": the badge shop.
    ask(shop, AUX.clerk);
    choose(shop, 1);
    expect(shop.takeServiceRequest()).toMatchObject({
      continuation: "CAU_VONG_SHOP",
      shopCategory: 2,
    });
    // Back in 67 with the scroll: the offer, menu 5, the trade.
    const back = enter(67, 230, 330, [
      [67, 0],
      [67, 6],
    ]);
    back.inventory[String(AUX.scroll.id)] = 1;
    const eggs = back.bag.specials.filter((id) => id === AUX.egg.id).length;
    expect(showed(ask(back, AUX.mei), "SCROLL_OFFER_REPLY")).toBe(true);
    expect(options(back)).toEqual(BRANCHES.menus["5"]);
    expect(showed(choose(back, 0), "SCROLL_TRADE")).toBe(true);
    expect(back.inventory[String(AUX.scroll.id)] ?? 0).toBe(0);
    expect(back.bag.specials.filter((id) => id === AUX.egg.id).length).toBe(eggs + 1);
    expect([done(back, 67, AUX.receipt), done(back, 67, 7)]).toEqual([true, true]);
    expect(saw(ask(back, AUX.mei), AUX.rows["3"].text)).toBe(true);
    // 43's clerk is no longer selling the quest scroll.
    const after = enter(43, 120, 200, [
      [67, 6],
      [67, AUX.receipt],
    ]);
    ask(after, AUX.clerk);
    expect(options(after)).not.toEqual(BRANCHES.menus["8"]);
  });

  it("refuses the trade without the scroll, and leaves through the native doors to 27", () => {
    const world = enter(67, 230, 330, [
      [67, 0],
      [67, 6],
      [67, MENU + 5],
    ]);
    // The menu left open comes back first (`tick`'s head).
    play(world);
    expect(options(world)).toEqual(BRANCHES.menus["5"]);
    expect(saw(choose(world, 0), BRANCHES.lines.tradeRefused.text)).toBe(true);
    expect(done(world, 67, AUX.receipt)).toBe(false);
    for (const [tx, ty, target, x, y] of AUX.doors) {
      const door = enter(67, 230, 330, [[67, 0]]);
      door.player.x = tx * 20 + 10;
      door.player.y = ty * 20 + 19;
      door.tick([]);
      expect([door.roomIndex, door.player.x, door.player.y], `door ${tx},${ty}`).toEqual([
        target,
        x,
        y,
      ]);
    }
  });
});

describe("the branch treasures (CauVongBranchTreasures)", () => {
  /** The hero below the chest, facing it. */
  function face(world: World, tx: number, ty: number) {
    world.player.x = tx * 20 + 10;
    world.player.y = ty * 20 + 40;
    world.player.direction = 2;
  }

  it("bakes every room's table with the line Java's grant returns", () => {
    const rooms = Object.keys(BRANCHES.treasures);
    expect(rooms.length).toBeGreaterThan(40);
    for (const room of rooms)
      for (const t of BRANCHES.treasures[room]) {
        if (t.state === -1) continue;
        if (t.reward.kind === "money") expect(t.line).toBe(`Đạt được: ${t.reward.qty} kim tiền.`);
        if (t.reward.kind === "badges") expect(t.line).toBe(`Đạt được: ${t.reward.qty} huy hiệu.`);
        if (t.reward.kind === "item")
          expect(t.line).toBe(`Đạt được: ${t.reward.item.name} × ${t.reward.qty}.`);
      }
  });

  it("opens a chest once in 67 (money), blocks its tile, and reads open after", () => {
    const world = enter(67, 230, 330, [[67, 0]]),
      row = BRANCHES.treasures["67"].findIndex((t) => t.reward.kind === "money"),
      t = BRANCHES.treasures["67"][row];
    expect(world.cauVongTreasures.map((c) => c.open)).toEqual([false, false, false]);
    const money = world.currency.money;
    face(world, t.x, t.y);
    expect(saw(press2(world), t.line!)).toBe(true);
    expect(world.currency.money).toBe(money + (t.reward.kind === "money" ? t.reward.qty : 0));
    expect(done(world, 67, BRANCHES.treasureReceipt + row)).toBe(true);
    expect(world.cauVongTreasures[row].open).toBe(true);
    face(world, t.x, t.y);
    expect(saw(press2(world), BRANCHES.treasureLines.opened)).toBe(true);
    expect(world.currency.money).toBe(money + (t.reward.kind === "money" ? t.reward.qty : 0));
    // The chest's floor stops the hero.
    face(world, t.x, t.y);
    for (let i = 0; i < 30; i++) world.tick(["up"]);
    expect(world.player.y).toBeGreaterThan(t.y * 20 + 20);
  });

  it("opens the city's chests through the global hook, and keeps a chest shut on a full bag", () => {
    const table = BRANCHES.treasures["1"];
    const money = table.findIndex((t) => t.reward.kind === "money");
    const world = enter(1, 260, 300);
    arriveInCity(world);
    const before = world.currency.money;
    face(world, table[money].x, table[money].y);
    expect(saw(press2(world), table[money].line!)).toBe(true);
    expect(world.currency.money - before).toBe(
      table[money].reward.kind === "money" ? table[money].reward.qty : 0,
    );
    const bag = table.findIndex((t) => t.reward.kind === "item" && t.reward.item.kind === "BAG");
    const t = table[bag];
    if (t.reward.kind !== "item") throw new Error("no bag chest in 1");
    world.inventory[String(t.reward.item.id)] = 99;
    face(world, t.x, t.y);
    expect(saw(press2(world), BRANCHES.treasureLines.full)).toBe(true);
    expect(done(world, 1, BRANCHES.treasureReceipt + bag)).toBe(false);
  });
});

/** 5 where the hero stands, then the boxes it opened. */
function press2(world: World) {
  world.tick(["confirm"]);
  return play(world);
}
