import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/** Pack images are 1x1 stand-ins under Node; the host never reads pixels. */
vi.stubGlobal(
  "Image",
  class {
    complete = true;
    naturalWidth = 1;
    width = 1;
    height = 1;
    src = "";
  },
);
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
const { scene1Save } = await import("../../dev/parityCheckpoints");
const { SCENE1_RESUME } = await import("../../persistence/save/migrations");
const { gameplaySources } = await import("./GameplayHost");
const { storyPlaythrough } = await import("./StoryPlaythrough");

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
const sources = gameplaySources(assets, boot);
const { playGroup, standAt, triggerPoint } = storyPlaythrough(sources, assets, boot.sourceEvents);

/**
 * The catchable pets the source places on the map (`QUEST_PET` / `RARE` / `AUTO_CAPTURE`
 * descriptors): each one's op13 rect, the gates its group needs and the species it fights as.
 */
const QUEST_PETS: {
  ref: [number, number, number];
  species: number;
  name: string;
  done?: string[];
}[] = [
  { ref: [2, 2, 0], species: 29, name: "Uy Qua Đệ Đệ", done: ["11:8:1"] },
  // `SCENE2_ROOM4_GROUP0_RARE` is built with actor -1, although the group's op67 names actor 6.
  { ref: [2, 4, 0], species: 52, name: "Bá tước chim cánh cụt" },
  { ref: [3, 1, 0], species: 30, name: "Thảo Diệp Cô" },
  { ref: [3, 5, 0], species: 2, name: "Nhiên Liệp Sư", done: ["9:1:2"] },
  { ref: [5, 6, 3], species: 7, name: "Phệ Hỏa Thú" },
  { ref: [5, 6, 4], species: 5, name: "Viêm Ma" },
  { ref: [5, 6, 5], species: 86, name: "Hư không hành giả" },
];

function save(done: string[] = [], level = 60) {
  const base = scene1Save({
      location: { sceneId: 1, roomIndex: 0, x: 120, y: 160, direction: 2 },
      owner: SCENE1_RESUME.elderReturn,
      bunnyCaught: true,
      eventStates: Object.fromEntries(["1:1:0", ...done].map((key) => [key, 3])),
      pets: [
        { speciesId: 68, level, quality: 4 },
        { speciesId: 58, level, quality: 4 },
      ],
    }),
    // Mộc Lâm's tree pockets (3:1) need the Mộc Quỹ badge, or the load puts the hero at the door.
    badges = [...(base.world?.badgesAchieved ?? [])];
  for (const badge of [0, 1, 2, 3, 4, 5]) badges[badge] = 1;
  return {
    ...base,
    inventory: { ...base.inventory, items: { ...base.inventory.items, "0": 10 } },
    world: { ...base.world!, badgesAchieved: badges },
  };
}

describe("quest pets on the map", () => {
  for (const { ref, species, name, done } of QUEST_PETS)
    it(`${name} (${ref.join(":")}) starts its fight on its rect and can be caught`, async () => {
      const [scene, room, group] = ref,
        played = await playGroup(save(done), scene, room, group, { catchFoe: true });
      expect(played.battles).toBeGreaterThan(0);
      expect(played.saved.pets.some((pet) => pet.speciesId === species)).toBe(true);
      // Done (3), or retired by a closing op42 (4).
      expect(played.saved.eventStates?.[ref.join(":")]).toBeGreaterThanOrEqual(3);
    }, 60000);

  it("a lost quest-pet fight revives the party, returns to the save point and keeps the pet", async () => {
    const [scene, room, group] = [3, 5, 0],
      { host, world } = await standAt(save(["9:1:2"], 2), scene, room, 120, 160, 2),
      point = triggerPoint(scene, room, group);
    world.player.x = point.x;
    world.player.y = point.y;
    let fought = false;
    for (let i = 0; i < 4000; i++) {
      const battle = world.battle;
      if (battle) {
        fought = true;
        const mine = battle.core?.activeUnit("player");
        if (mine?.alive()) mine.setHp(1);
        const foe = battle.core?.activeUnit("enemy");
        if (foe?.alive()) foe.setHp(foe.maxHp());
      } else if (fought && world.phase === "freeworld") break;
      host.step(i % 2 === 0 ? ["confirm"] : []);
    }
    expect(fought).toBe(true);
    expect(world.battle).toBeNull();
    expect({ scene: world.sceneId, room: world.roomIndex }).toEqual({ scene, room });
    expect({ x: world.player.x, y: world.player.y }).toEqual({ x: 120, y: 160 });
    expect(world.eventState.sourceEventState(scene, room, group)).toBeLessThan(3);
    expect(world.pets.every((pet) => (pet.currentHp ?? 1) > 0)).toBe(true);
  }, 60000);
});

/** Run the fight that is about to start, keeping the hero's pet at 1 HP until the party falls. */
function loseFight(
  host: { step(commands: "confirm"[]): void },
  world: {
    battle: {
      core?: {
        activeUnit(
          side: "player" | "enemy",
        ): { alive(): boolean; setHp(hp: number): void; maxHp(): number } | undefined;
      } | null;
    } | null;
    phase: string;
  },
): boolean {
  let fought = false;
  for (let i = 0; i < 4000; i++) {
    const battle = world.battle;
    if (battle) {
      fought = true;
      const mine = battle.core?.activeUnit("player");
      if (mine?.alive()) mine.setHp(1);
      const foe = battle.core?.activeUnit("enemy");
      if (foe?.alive()) foe.setHp(foe.maxHp());
    } else if (fought && world.phase === "freeworld") break;
    host.step(i % 2 === 0 ? ["confirm"] : []);
  }
  return fought;
}

describe("lost fights cannot be farmed or looped", () => {
  it("Fruita's Tất Trung Cầu (2:2:0) is handed over once, however often the Uy Qua fight is lost", async () => {
    const [scene, room, group] = [2, 2, 0],
      { host, world } = await standAt(save(["11:8:1"], 2), scene, room, 120, 160, 2),
      point = triggerPoint(scene, room, group),
      balls = () => world.inventory["0"] ?? 0,
      before = balls(),
      counts: number[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      world.player.x = point.x;
      world.player.y = point.y;
      expect(loseFight(host, world)).toBe(true);
      expect(world.eventState.sourceEventState(scene, room, group)).toBeLessThan(3);
      counts.push(balls());
    }
    // The first run pays the ball (it is not thrown in a lost fight); the replays pay nothing.
    expect(counts).toEqual([before + 1, before + 1, before + 1]);
    // The receipt is saved with the ledger, so a reloaded session does not pay it again either.
    expect(world.eventState.snapshotStates()["gift:2:2:0:4:0"]).toBe(4);
  }, 120000);

  it("a lost PaYaQi fight (2:1:1, a chain link with no rect) does not restart until the room changes", async () => {
    const [scene, room, group] = [2, 1, 1],
      { host, world } = await standAt(
        save(["11:8:1", "2:0:1", "2:1:0"], 2),
        scene,
        room,
        240,
        320,
        2,
      );
    expect(loseFight(host, world)).toBe(true);
    expect(world.eventState.sourceEventState(scene, room, group)).toBeLessThan(3);
    for (let i = 0; i < 300; i++) {
      host.step([]);
      expect(world.battle).toBeNull();
    }
    expect({ scene: world.sceneId, room: world.roomIndex }).toEqual({ scene, room });
  }, 120000);
});
