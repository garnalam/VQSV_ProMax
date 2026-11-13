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
const { terrainAtWorld } = await import("../world/MapCollision");

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
const sources = gameplaySources(assets, boot);
const { standAt } = storyPlaythrough(sources, assets, boot.sourceEvents);

/** A Bích Thủy-era save: no Thủy Lam badge yet, so the water cannot be walked. */
function save(actorPositions: number[][] = []) {
  const base = scene1Save({
    location: { sceneId: 1, roomIndex: 0, x: 120, y: 160, direction: 2 },
    owner: SCENE1_RESUME.elderReturn,
    bunnyCaught: true,
    eventStates: { "1:1:0": 3 },
    pets: [{ speciesId: 68, level: 60, quality: 4 }],
  });
  return { ...base, world: { ...base.world!, actorPositions } };
}

type Leaf = { x: number; y: number; state: number };
type World = {
  actors: Map<number, Leaf>;
  player: { x: number; y: number };
  flags: { actorPosition(s: number, r: number, a: number): { x: number; y: number } | undefined };
  currentMap(): Parameters<typeof terrainAtWorld>[0];
};

/** Stand on dry ground `offset` px behind `bank` (against `step`), the first such spot from 12 px. */
function standBehind(
  world: World,
  bank: { x: number; y: number },
  step: { dx: number; dy: number },
) {
  const map = world.currentMap();
  for (let offset = 12; offset <= 48; offset += 4) {
    const x = bank.x - step.dx * offset,
      y = bank.y - step.dy * offset,
      terrain = terrainAtWorld(map, x, y);
    if (terrain === 1 || terrain === 2) continue;
    world.player.x = x;
    world.player.y = y;
    return;
  }
  throw new Error("no dry bank behind the leaf");
}

describe("lotus leaves can always be called back (web-only, owner 2026-11-13)", () => {
  it("2:0: the leaf left on the far shore sails back to the hero, who then rides it across", async () => {
    // Leaf 4 rests on its right shore (234,94) while the hero stands on the left bank — the state a
    // lost fight on the islands leaves behind when it sends him back to the save point.
    const { host, world } = (await standAt(
      save([[2, 0, 4, 234, 94]]),
      2,
      0,
      152,
      40,
      0,
    )) as unknown as {
      host: { step(c: string[]): void };
      world: World;
    };
    const leaf = world.actors.get(4)!;
    expect({ x: leaf.x, y: leaf.y }).toEqual({ x: 234, y: 94 });
    // A leaf's mask sits 11–18 px above its anchor, so the hero boards a horizontal one from 12 px up.
    standBehind(world, { x: 194, y: 82 }, { dx: 1, dy: 0 });
    const start = world.player.x;
    let arrived = false;
    for (let i = 0; i < 200; i++) {
      host.step(["right"]);
      if (leaf.x === 194 && leaf.y === 94) arrived = true;
      if (world.player.x > 234) break;
    }
    expect(arrived).toBe(true);
    // Called back, then boarded and sailed: the hero is across, the leaf with him on the far shore.
    expect(world.player.x).toBeGreaterThan(start + 40);
    // (a leaf under way has its sailing mask, so it may rest a step short of the stationary shore)
    expect(leaf.x).toBeGreaterThanOrEqual(230);
  }, 60000);

  it("2:1: a hero back on the north bank calls leaf 14 up from the south shore", async () => {
    const { host, world } = (await standAt(
      save([[2, 1, 14, 305, 335]]),
      2,
      1,
      296,
      40,
      0,
    )) as unknown as {
      host: { step(c: string[]): void };
      world: World;
    };
    const leaf = world.actors.get(14)!;
    standBehind(world, { x: 305, y: 271 }, { dx: 0, dy: 1 });
    for (let i = 0; i < 60 && !(leaf.x === 305 && leaf.y === 271); i++) {
      host.step(["down"]);
    }
    expect({ x: leaf.x, y: leaf.y }).toEqual({ x: 305, y: 271 });
    // The leaf is remembered on the hero's bank, as a ride would leave it.
    expect(world.flags.actorPosition(2, 1, 14)).toEqual({ x: 305, y: 271 });
  }, 60000);

  it("9:0: resuming in the Bích Thủy gym lays its four leaves back on their rows", async () => {
    const { world } = (await standAt(
      save([
        [9, 0, 15, 194, 397],
        [9, 0, 16, 98, 357],
        [9, 0, 17, 141, 268],
        [9, 0, 18, 183, 176],
      ]),
      9,
      0,
      120,
      440,
      2,
    )) as unknown as { world: World };
    const at = (id: number) => ({ x: world.actors.get(id)!.x, y: world.actors.get(id)!.y });
    expect([at(15), at(16), at(17), at(18)]).toEqual([
      { x: 194, y: 433 },
      { x: 142, y: 357 },
      { x: 97, y: 268 },
      { x: 183, y: 224 },
    ]);
    for (const id of [15, 16, 17, 18]) expect(world.flags.actorPosition(9, 0, id)).toBeUndefined();
  }, 60000);
});
