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
type CityDocument = import("./CauVongCity").CauVongCityDocument;
type CityItem = import("./CauVongCity").CityItem;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
for (const room of [0, 1, 45, 46, 47, 56]) await assets.prepareRoom(98, room);

const read = (file: string) =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../public/pack", file), "utf8"));
const CITY = read("cau-vong-world/city.json") as CityDocument;
const COLLISION = read("cau-vong-world/collision.json").rooms as Record<
  string,
  Record<string, { dx: number; dy: number }>
>;
const flatten = (text: string) =>
  text
    .normalize("NFC")
    .replace(/#[0-9A-Fa-f]{6}/g, "")
    .replace(/\s+/g, "");

/** CV1 behind the hero (the city's lunch delivered: 1:100), `flags` set, then `room` at (x, y). */
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
  const base: [number, number][] = [
    [6, 100],
    [0, 101],
    [1, 100],
  ];
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
  CITY.parts[name].steps.flatMap((cue) => (cue.k === "say" ? [cue.text] : []));
const showed = (seen: string[], name: string) =>
  says(name).every((line) =>
    seen.some((box) => flatten(line).startsWith(flatten(box).slice(0, 12))),
  );
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
const stock = (world: World, item: CityItem) =>
  item.kind === "MATERIAL"
    ? (world.bag.materials[String(item.id)] ?? 0)
    : (world.inventory[String(item.id)] ?? 0);

describe("the city's side rooms (citySideEntrance, CauVongOpeningSideQuests, tickSideRoom)", () => {
  it("enters 56, 45, 47 and 46 from the city and comes back where sideRoomExit says", () => {
    for (const [x, y, w, h, room, tx, ty] of CITY.entrances) {
      if (room === 44) continue;
      const world = enter(1, 260, 300);
      play(world);
      world.player.x = x + w / 2;
      world.player.y = y + h / 2;
      world.tick([]);
      expect([world.roomIndex, world.player.x, world.player.y], `door to ${room}`).toEqual([
        room,
        tx,
        ty,
      ]);
      const back = CITY.exits[String(room)];
      if (!back) continue;
      play(world);
      world.player.x = back[0] + back[2] / 2;
      world.player.y = back[1] + back[3] / 2;
      world.tick([]);
      expect([world.roomIndex, world.player.x, world.player.y]).toEqual([1, back[4], back[5]]);
    }
  });

  it("Lisa: request, refusal, offer, acceptance, the pet and materials, the document, the Mộc pet", () => {
    const world = enter(46, 320, 320),
      lisa = CITY.lisa;
    expect(showed(ask(world, lisa.actor), "LISA_REQUEST")).toBe(true);
    expect(options(world)).toEqual(lisa.accept);
    expect(showed(choose(world, 1), "LISA_DECLINE")).toBe(true);
    expect(done(world, 46, lisa.flags.accepted)).toBe(false);
    // Asked again: the offer replays as text, the menu again; this time accepted.
    expect(showed(ask(world, lisa.actor), "LISA_OFFER")).toBe(true);
    expect(options(world)).toEqual(lisa.accept);
    expect(showed(choose(world, 0), "LISA_ACCEPTED")).toBe(true);
    expect([lisa.flags.accepted, 145, 146].every((e) => done(world, 46, e))).toBe(true);
    // No Mạn Đà La of level 85 yet.
    expect(showed(ask(world, lisa.actor), "LISA_SHORT")).toBe(true);
    // With one, and the materials, the pet menu lists it.
    world.pets.push({
      ...world.pets[0],
      speciesId: lisa.trade.species,
      level: 90,
      slot: world.pets.length,
    });
    for (const { item, qty } of lisa.materials) world.bag.materials[String(item.id)] = qty;
    const party = world.pets.length,
      slot = party - 1;
    ask(world, lisa.actor);
    expect(options(world)).toEqual([
      lisa.petOption
        .replace("{slot}", String(slot + 1))
        .replace("{level}", "90")
        .replace("{quality}", String(world.pets[slot].quality)),
      lisa.keep,
    ]);
    expect(showed(choose(world, 0), "LISA_MATERIALS")).toBe(true);
    expect(world.pets).toHaveLength(party - 1);
    expect(lisa.materials.every(({ item }) => stock(world, item) === 0)).toBe(true);
    expect([lisa.flags.traded, 122].every((e) => done(world, 46, e))).toBe(true);
    // The document: missing, then given for the Mộc pet.
    expect(showed(ask(world, lisa.actor), "LISA_NO_DOCUMENT")).toBe(true);
    world.bag.materials[String(lisa.document.id)] = 1;
    expect(showed(ask(world, lisa.actor), "LISA_DOCUMENT")).toBe(true);
    expect(options(world)).toEqual(lisa.give);
    const before = world.pets.length;
    expect(showed(choose(world, 0), "LISA_REWARD")).toBe(true);
    expect(world.pets).toHaveLength(before + 1);
    expect([world.pets.at(-1)!.speciesId, world.pets.at(-1)!.level]).toEqual([
      lisa.reward.species,
      lisa.reward.level,
    ]);
    expect(stock(world, lisa.document)).toBe(0);
    expect([lisa.flags.rewarded, 124].every((e) => done(world, 46, e))).toBe(true);
    expect(showed(ask(world, lisa.actor), "LISA_PASSIVE")).toBe(true);
  });

  it("Lisa keeps the document when neither party nor bank has room", () => {
    const lisa = CITY.lisa,
      world = enter(46, 320, 320, [
        [46, lisa.flags.accepted],
        [46, 145],
        [46, 146],
        [46, lisa.flags.requestSeen],
        [46, lisa.flags.traded],
        [46, 122],
      ]);
    world.bag.materials[String(lisa.document.id)] = 1;
    while (world.pets.length < 6) world.pets.push({ ...world.pets[0], slot: world.pets.length });
    for (let i = 0; i < 300; i++) world.meta.campaign.petBank.push({ ...world.pets[0], slot: i });
    ask(world, lisa.actor);
    expect(options(world)).toEqual(lisa.give);
    expect(choose(world, 0).map(flatten)).toContain(flatten(lisa.noRoom.text));
    expect(stock(world, lisa.document)).toBe(1);
    expect(done(world, 46, lisa.flags.rewarded)).toBe(false);
  });

  it("the shop (56): its merchants wait for the south gate's victory (applyNpcVisuals)", () => {
    const hidden = enter(56, 200, 450);
    expect(CITY.merchants.actors.map((id) => hidden.actors.get(id)!.visible)).toEqual([
      false,
      false,
      false,
    ]);
    for (const [room, event] of CITY.merchants.after) {
      const shown = enter(56, 200, 450, [[room, event]]);
      expect(CITY.merchants.actors.every((id) => shown.actors.get(id)!.visible)).toBe(true);
    }
  });

  it("the shop (56): its gift once, then the clerks' greetings and services", () => {
    const world = enter(56, 200, 450, [[23, 100]]),
      gift = CITY.shopGift;
    const held = gift.items.map(({ item }) => world.inventory[String(item.id)] ?? 0);
    expect(showed(ask(world, gift.actor), "SHOP_GIFT")).toBe(true);
    gift.items.forEach(({ item, qty }, i) =>
      expect(world.inventory[String(item.id)] ?? 0).toBe(held[i] + qty),
    );
    expect([gift.flag, 124].every((e) => done(world, 56, e))).toBe(true);
    const services: Record<string, [string, string, number?]> = {
      items: ["SHOP_ITEMS", "CAU_VONG_SHOP", 0],
      bank: ["SHOP_BANK", "PET_BANK"],
      badges: ["SHOP_BADGES", "CAU_VONG_SHOP", 2],
      materials: ["SHOP_MATERIALS", "CAU_VONG_SHOP", 1],
      documents: ["SHOP_DOCUMENTS", "CAU_VONG_SHOP", 3],
    };
    const after = gift.items.map(({ item }) => world.inventory[String(item.id)] ?? 0);
    for (const npc of CITY.residents["56"]) {
      if (npc.role === "talk") {
        expect(ask(world, npc.actorId).map(flatten)).toContain(flatten(npc.say!.text));
        continue;
      }
      const [part, continuation, category] = services[npc.role];
      expect(showed(ask(world, npc.actorId), part), npc.role).toBe(true);
      world.tick([]);
      const service = world.takeServiceRequest();
      expect(service?.continuation, npc.role).toBe(continuation);
      if (category !== undefined) expect(service?.shopCategory).toBe(category);
      // The item clerk says goodbye once the shop is closed.
      if (npc.role === "items") expect(showed(play(world), "SHOP_ITEMS_BYE")).toBe(true);
    }
    // The gift is not given twice.
    expect(gift.items.map(({ item }) => world.inventory[String(item.id)] ?? 0)).toEqual(after);
  });

  it("the rooftop (45): the merchant opens the shop, the residents talk", () => {
    const world = enter(45, 180, 285);
    for (const npc of CITY.residents["45"]) {
      if (npc.role === "rooftop") {
        ask(world, npc.actorId);
        world.tick([]);
        expect(world.takeServiceRequest()).toMatchObject({
          continuation: "CAU_VONG_SHOP",
          shopCategory: 0,
        });
      } else expect(ask(world, npc.actorId).map(flatten)).toContain(flatten(npc.say!.text));
    }
  });

  it("56 stays the North Sea's while its door has marked it", () => {
    const world = enter(56, 200, 450);
    world.eventState.op14CompleteEvent(98, 56, 200001);
    ask(world, CITY.shopGift.actor);
    expect(done(world, 56, CITY.shopGift.flag)).toBe(false);
  });
});
