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
const { MemorySaveStore } = await import("../../persistence/save/SaveStore");
const { SaveRepository } = await import("../../persistence/SaveRepository");
const { SaveService } = await import("../../persistence/SaveService");
const { scene1Save } = await import("../../dev/parityCheckpoints");
const { SCENE1_RESUME } = await import("../../persistence/save/migrations");
const { GameplayHost, gameplaySources } = await import("./GameplayHost");
const { BADGE_MOC_QUY } = await import("../world/WorldFlags");
const { DIRECTION_UP, DIRECTION_DOWN, terrainAtWorld } = await import("../world/MapCollision");
type GameSave = import("../../persistence/save/GameSave").GameSave;
type Host = InstanceType<typeof GameplayHost>;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
const sources = gameplaySources(assets, boot);

/** A Hắc Thạch-era save (two level-40 pets), with extra ledger entries and badges. */
function baseSave(
  states: Record<string, number> = {},
  mainTaskProgress = 25,
  badges: number[] = [],
): GameSave {
  const host = new GameplayHost(
      sources,
      new SaveService(new SaveRepository(new MemorySaveStore())),
      { onExit: () => {} },
      {
        kind: "resume",
        save: scene1Save({
          location: { sceneId: 1, roomIndex: 0, x: 200, y: 200, direction: 1 },
          owner: SCENE1_RESUME.bunnyReturnRoom0,
          bunnyCaught: true,
          pets: [
            { speciesId: 68, level: 40, quality: 2 },
            { speciesId: 19, level: 40, quality: 2 },
          ],
        }),
      },
    ),
    save = host.snapshot(host.world!),
    achieved = [...(save.world?.badgesAchieved ?? [])];
  for (const badge of badges) achieved[badge] = 1;
  return {
    ...save,
    eventStates: { ...save.eventStates, ...states },
    progress: { ...save.progress, mainTaskProgress },
    world: { ...save.world!, mainTaskProgress, badgesAchieved: achieved },
  };
}

/** Resume `save` standing at (x, y) in scene:room, with the room's map in. */
async function standAt(
  save: GameSave,
  scene: number,
  room: number,
  x: number,
  y: number,
  direction: number,
): Promise<Host> {
  await assets.prepareRoom(scene, room);
  const host = new GameplayHost(
    sources,
    new SaveService(new SaveRepository(new MemorySaveStore())),
    { onExit: () => {} },
    {
      kind: "resume",
      save: { ...save, location: { sceneId: scene, roomIndex: room, x, y, direction } },
    },
  );
  while (host.mapLoadingActive) host.step([]);
  return host;
}

/** Hold a direction for `ticks` ticks, stopping early once an event group takes over. */
function hold(host: Host, key: "holdUp" | "holdDown" | "holdLeft" | "holdRight", ticks: number) {
  for (let i = 0; i < ticks; i++) {
    host.step([key]);
    if (host.world!.activeEventGroup !== null) break;
  }
}

/** The save a reload of this session would open (the menu's Lưu dữ liệu). */
function snapshot(host: Host): GameSave {
  return host.snapshot(host.world!);
}

describe("room arrivals on blocked terrain", () => {
  it("lands on walkable ground after the forest door opens the dock room", async () => {
    await assets.prepareRoom(11, 7);
    const host = await standAt(baseSave(), 1, 4, 426, 113, DIRECTION_UP);
    const world = host.world!;
    host.step([]);
    expect([world.sceneId, world.roomIndex]).toEqual([11, 7]);
    while (host.mapLoadingActive) host.step([]);
    expectClearFootprint(world);
    const start = [world.player.x, world.player.y];
    for (const key of ["holdUp", "holdDown", "holdLeft", "holdRight"] as const) {
      host.step([key]);
      if (start[0] !== world.player.x || start[1] !== world.player.y) break;
    }
    expect([world.player.x, world.player.y]).not.toEqual(start);
  });

  it("frees the hero after a gym vortex drops him in a wall", async () => {
    const host = await standAt(baseSave({}, 31), 9, 6, 136, 328, DIRECTION_UP);
    const world = host.world!;
    const vortex = world.actors.get(3)!;
    Object.assign(world.player, { x: vortex.x, y: vortex.y });
    for (let i = 0; i < 37; i++) host.step([]);
    expect([world.sceneId, world.roomIndex]).toEqual([9, 6]);
    expectClearFootprint(world);
  });

  it.each([
    [11, 7, 176, 112],
    [7, 12, 192, 48],
    [9, 6, 168, 224],
    [10, 7, 264, 368],
    [11, 0, 40, 256],
  ])("repairs a save in a wall in room %i:%i", async (scene, room, x, y) => {
    const host = await standAt(baseSave(), scene, room, x, y, DIRECTION_DOWN);
    expectClearFootprint(host.world!);
    expect(host.snapshot(host.world!).location).toMatchObject({ sceneId: scene, roomIndex: room });
  });

  it("frees a save trapped away from a door's exact arrival when the player walks", async () => {
    const host = await standAt(baseSave(), 11, 7, 176, 114, DIRECTION_DOWN);
    const world = host.world!;
    expect(world.player).toMatchObject({ x: 176, y: 114 });
    host.step(["holdDown"]);
    expectClearFootprint(world);
  });
});

function expectClearFootprint(world: NonNullable<Host["world"]>): void {
  const asset = assets.getWorldRoom(world.sceneId, world.roomIndex)!;
  const map = assets.getCollision(asset.mapId)!;
  for (const dx of [-8, 0, 7])
    for (const dy of [-8, 0, 7])
      expect(terrainAtWorld(map, world.player.x + dx, world.player.y + dy)).toBe(0);
}

describe("WorldEngine actor collision (VqsvFreeWorldRuntime.actorLookup)", () => {
  it("rejects a land mount's sideways slide into a wall in room 1:4", async () => {
    const save = baseSave({}, 25);
    save.inventory.specials = [1];
    const host = await standAt(save, 1, 4, 312, 280, 3);
    const world = host.world!;
    expect(world.selectRide(0)).toBe("ready");
    host.step(["holdLeft"]);
    expect([world.player.x, world.player.y]).toEqual([312, 280]);
  });

  it("a beaten trainer keeps his place and his lines but lets the hero by", async () => {
    // George (5:4 actor 25, NPC) at (92,167); once 5:4:g0 is won his tile opens.
    const host = await standAt(baseSave({ "5:4:0": 3 }), 5, 4, 140, 180, 3);
    hold(host, "holdLeft", 13);
    expect(host.world!.player.x).toBeLessThan(92);
    expect(host.world!.actors.get(25)!.visible).toBe(true);
    expect(host.world!.activeEventGroup).toBeNull();
  });

  it("a person with no sprite mask blocks inside the interactive fallback box", async () => {
    // 5:4 actor 24 (sprite 128, behavior 1, no mask) stands behind George: the hero walking up
    // the column stops where {-12, -16, 24, 32} would overlap him.
    const host = await standAt(baseSave({ "5:4:0": 3 }), 5, 4, 92, 200, DIRECTION_UP);
    hold(host, "holdUp", 20);
    expect(host.world!.player.y).toBe(180);
  });

  it("an unbeaten NPC opponent calls the hero over without a key", async () => {
    // `HacThachC3Runtime.tickDungeonEntrance`: `actorActivationRequested(25)` is true within
    // 48 px per axis / 64 px in all of George while 5:4:g0 is open.
    const host = await standAt(baseSave(), 5, 4, 92, 240, DIRECTION_UP);
    hold(host, "holdUp", 40);
    const world = host.world!;
    expect(world.activeEventGroup).toEqual({ scene: 5, room: 4, group: 0 });
    expect(world.player.y).toBe(212);
  });

  it("an unbeaten opponent seals his tile even while his fight is not offered yet", async () => {
    // 9:6 Gaelle (actor 12 at 136,192) on her vortex island: g1 waits on g0, but she already
    // blocks the way across.
    // From below, clear of the island's two vortices (6 at 103,191 and 5 at 168,192).
    const shut = await standAt(baseSave({}, 31), 9, 6, 136, 216, DIRECTION_UP);
    hold(shut, "holdUp", 8);
    expect(shut.world!.activeEventGroup).toBeNull();
    expect(shut.world!.player.y).toBe(212);
    const beaten = await standAt(
      baseSave({ "9:6:0": 3, "9:6:1": 3 }, 31),
      9,
      6,
      136,
      216,
      DIRECTION_UP,
    );
    hold(beaten, "holdUp", 3);
    expect(beaten.world!.player.y).toBe(204);
  });
});

describe("Đạo quán 9:6 fight order (PhoenixC3Runtime.tickGym)", () => {
  it("offers Gaelle (g1) only after Abe (g0), and the leader only after both on task 31", async () => {
    const gaelleRect = { x: 120 + 16, y: 160 + 32 };
    const early = await standAt(baseSave({}, 31), 9, 6, gaelleRect.x, gaelleRect.y, DIRECTION_UP);
    early.step([]);
    expect(early.world!.activeEventGroup).toBeNull();
    const after = await standAt(
      baseSave({ "9:6:0": 3 }, 31),
      9,
      6,
      gaelleRect.x,
      gaelleRect.y,
      DIRECTION_UP,
    );
    after.step([]);
    expect(after.world!.activeEventGroup).toEqual({ scene: 9, room: 6, group: 1 });

    const leaderRect = { x: 80 + 48, y: 48 + 8 };
    const wrongTask = await standAt(
      baseSave({ "9:6:0": 3, "9:6:1": 3 }, 30),
      9,
      6,
      leaderRect.x,
      leaderRect.y,
      DIRECTION_UP,
    );
    wrongTask.step([]);
    expect(wrongTask.world!.activeEventGroup).toBeNull();
    const leader = await standAt(
      baseSave({ "9:6:0": 3, "9:6:1": 3 }, 31),
      9,
      6,
      leaderRect.x,
      leaderRect.y,
      DIRECTION_UP,
    );
    leader.step([]);
    expect(leader.world!.activeEventGroup).toEqual({ scene: 9, room: 6, group: 2 });
  });
});

describe("Mộc Quỳ trees (VqsvSourceWorldObstacleRuntime)", () => {
  // 3:1 trees 34 (71,176) and 7 (88,177) seal the gap at x 64..95 between two rock walls.
  it("block a hero without the badge", async () => {
    const host = await standAt(baseSave(), 3, 1, 80, 140, DIRECTION_DOWN);
    hold(host, "holdDown", 30);
    expect(host.world!.player.y).toBe(156);
    expect(host.world!.obstaclePrompts).toEqual([]);
  });

  it("are cut with Mộc Quỳ Chương: marker, 5, state 1 → 2, passable, and saved", async () => {
    const host = await standAt(baseSave({}, 25, [BADGE_MOC_QUY]), 3, 1, 80, 140, DIRECTION_DOWN),
      world = host.world!;
    hold(host, "holdDown", 30);
    expect(world.player.y).toBe(156);
    // `setSourceObstacleMarker(true, 30)`: the action marker, 30 px over the faced tree. Faced is
    // `playerInteractsActorSourceMask`: tree 34 (y 176) meets the hero's mask 4 px ahead, tree 7
    // (y 177) is a pixel beyond it.
    expect(world.obstaclePrompts).toEqual([{ x: 71, y: 146 }]);
    host.step(["confirm"]);
    expect([world.actors.get(34)!.state, world.actors.get(7)!.state]).toEqual([1, 0]);
    for (let i = 0; i < 200 && world.actors.get(34)!.state !== 2; i++) host.step([]);
    expect(world.actors.get(34)!.state).toBe(2);
    // One step on, against the last tree, its marker shows and 5 cuts it too.
    hold(host, "holdDown", 4);
    expect(world.player.y).toBe(160);
    expect(world.obstaclePrompts).toEqual([{ x: 88, y: 147 }]);
    host.step(["confirm"]);
    for (let i = 0; i < 200 && world.actors.get(7)!.state !== 2; i++) host.step([]);
    expect([world.actors.get(7)!.state, world.actors.get(34)!.state]).toEqual([2, 2]);
    expect(world.obstaclePrompts).toEqual([]);
    hold(host, "holdDown", 30);
    expect(world.player.y).toBeGreaterThan(190);
    const saved = snapshot(host);
    expect(saved.world?.openedChests).toEqual(["tree:3:1:34", "tree:3:1:7"]);

    // Reload: the stumps are still there and still let the hero through.
    const back = await standAt(saved, 3, 1, 80, 140, DIRECTION_DOWN);
    expect([back.world!.actors.get(7)!.state, back.world!.actors.get(34)!.state]).toEqual([2, 2]);
    hold(back, "holdDown", 30);
    expect(back.world!.player.y).toBeGreaterThan(190);
  });

  it("a badge-less save stranded below them is moved back to the room's entry door", async () => {
    // `repairLegacyStrandedSave`: (80,208) cannot reach 3:1's door 49 without cutting; a save the
    // web wrote while trees did not block is restored at that door instead.
    const stranded = await standAt(baseSave(), 3, 1, 80, 208, DIRECTION_UP);
    expect(stranded.world!.player).toMatchObject({ x: 208, y: 48, direction: DIRECTION_DOWN });
    // With the badge the hero can cut his way out, so he stays.
    const free = await standAt(baseSave({}, 25, [BADGE_MOC_QUY]), 3, 1, 80, 208, DIRECTION_UP);
    expect(free.world!.player).toMatchObject({ x: 80, y: 208 });
  });
});

describe("room re-entry keeps what finished groups committed (reconcileRoomEntry)", () => {
  it("6:1: Sophie (actor 19) is gone once 6:1:g0 is done", async () => {
    const open = await standAt(baseSave({}, 31), 6, 1, 160, 386, DIRECTION_UP);
    expect(open.world!.actors.get(19)!.visible).toBe(true);
    const done = await standAt(baseSave({ "6:1:0": 3 }, 32), 6, 1, 160, 386, DIRECTION_UP);
    expect(done.world!.actors.get(19)!.visible).toBe(false);
  });

  it("5:6: each captured pet stays caught", async () => {
    const host = await standAt(
      baseSave({ "5:6:3": 3, "5:6:5": 3 }, 28),
      5,
      6,
      400,
      300,
      DIRECTION_DOWN,
    );
    const actors = host.world!.actors;
    expect(actors.get(10)!.visible).toBe(false);
    expect(actors.get(9)!.visible).toBe(true);
    expect(actors.get(11)!.visible).toBe(false);
  });

  it("2:5: g0 runs after the g2 it waits on, so its hide wins", async () => {
    const host = await standAt(
      baseSave({ "2:5:2": 3, "2:5:0": 3 }),
      2,
      5,
      100,
      200,
      DIRECTION_DOWN,
    );
    expect(host.world!.actors.get(12)!.visible).toBe(false);
    expect(host.world!.actors.get(13)!.visible).toBe(false);
  });
});

describe("ordinary NPC lines (VqsvSourceNpcDispatchFlow.ordinary)", () => {
  it("9:6: a beaten Abe only has his line to say, then the hero walks on", async () => {
    // `PhoenixC3Runtime.GYM_NPCS`: actor 13 (137,287), "Binh lính" ambient row 125.
    const host = await standAt(baseSave({ "9:6:0": 3 }, 31), 9, 6, 137, 307, DIRECTION_UP),
      world = host.world!;
    host.step(["confirm"]);
    expect(world.npcDialog?.speaker).toBe("Abe");
    for (let i = 0; i < 200 && world.npcDialog; i++) host.step(["confirm"]);
    expect(world.npcDialog).toBeNull();
    expect(host.panel.visible).toBe(false);
    expect(world.activeEventGroup).toBeNull();
  });
});

describe("Niêm Thổ Đạo Quán's floor holes (NiemThoC3Runtime.GymHoleFall)", () => {
  it("stepping onto a 9:2 hole spins the hero 16 ticks, then drops him into 9:3 at (112,256)", async () => {
    await assets.prepareRoom(9, 3);
    // Hole 2 (behaviour 16) at (97,240): walk down onto it from the floor above.
    const host = await standAt(baseSave({}, 30), 9, 2, 97, 205, DIRECTION_DOWN),
      world = host.world!;
    let ticks = 0;
    while (world.roomIndex === 2 && ticks < 60) {
      host.step(["holdDown"]);
      ticks++;
    }
    expect(world.sceneId).toBe(9);
    expect(world.roomIndex).toBe(3);
    expect([world.player.x, world.player.y]).toEqual([112, 256]);
    expect(world.player.direction).toBe(DIRECTION_DOWN);
    // The hole caught him a few steps in; the fall itself is 16 ticks of spinning.
    expect(ticks).toBeGreaterThan(16);
    expect(ticks).toBeLessThan(30);
  });
});

describe("Lối vào di tích (4:10): the ledge round the pit is closed", () => {
  /** Every spot the hero can walk to from (x, y), by single steps. */
  function reachable(host: Host, x: number, y: number): [number, number][] {
    const world = host.world! as unknown as {
        player: { x: number; y: number };
        walk(commands: string[]): boolean;
      },
      seen = new Set([`${x},${y}`]),
      queue: [number, number][] = [[x, y]];
    while (queue.length) {
      const [px, py] = queue.shift()!;
      for (const key of ["holdUp", "holdDown", "holdLeft", "holdRight"]) {
        world.player.x = px;
        world.player.y = py;
        world.walk([key]);
        const spot = `${world.player.x},${world.player.y}`;
        if (seen.has(spot)) continue;
        seen.add(spot);
        queue.push([world.player.x, world.player.y]);
      }
    }
    return [...seen].map((spot) => spot.split(",").map(Number) as [number, number]);
  }

  it("from the west door the pit and the cave are reachable, the ledge, top and east are not", async () => {
    const host = await standAt(baseSave({}, 43), 4, 10, 8, 320, DIRECTION_UP),
      spots = reachable(host, 8, 320);
    expect(spots.some(([x, y]) => Math.abs(x - 120) <= 8 && y <= 88)).toBe(true);
    expect(spots.some(([x, y]) => x < 40 && y < 200)).toBe(false);
    expect(spots.some(([, y]) => y < 20)).toBe(false);
    expect(spots.some(([x]) => x > 200)).toBe(false);
  });

  it("a save left on the old ledge comes back at the west door", async () => {
    const host = await standAt(baseSave({}, 43), 4, 10, 0, 95, DIRECTION_DOWN);
    expect([host.world!.player.x, host.world!.player.y]).toEqual([8, 320]);
  });
});

describe("Kiểm tra Phi Không Đĩnh (task 23): the soldier, then Yafei at the airship base", () => {
  /** Step with a confirm every few ticks; the groups that ran, in order. */
  function run(host: Host, ticks: number, held: "holdDown" | null = null): string[] {
    const world = host.world!,
      groups: string[] = [];
    for (let i = 0; i < ticks; i++) {
      host.step(i % 3 === 0 ? ["confirm"] : held ? [held] : []);
      const g = world.activeEventGroup;
      const key = g ? `${g.scene}:${g.room}:${g.group}` : null;
      if (key && groups.at(-1) !== key) groups.push(key);
    }
    return groups;
  }

  it("leaving the gym by its side door after the leader lands on the soldier's rect (4:5:g12)", async () => {
    await assets.prepareRoom(4, 5);
    // 9:2 actor 8 (32,320) leads out; `tryGymUpperSideExit` lands at (92,328) facing down.
    const host = await standAt(
        baseSave({ "9:2:0": 3, "9:2:1": 3 }, 22),
        9,
        2,
        32,
        300,
        DIRECTION_DOWN,
      ),
      world = host.world!;
    for (let i = 0; i < 20 && world.sceneId === 9; i++) host.step(["holdDown"]);
    expect([world.sceneId, world.roomIndex]).toEqual([4, 5]);
    // (92, 328), plus the step the held key still takes on the tick of the door: inside g12's
    // rect [48, 321, 64, 16].
    expect(world.player.x).toBe(92);
    expect(world.player.y).toBeGreaterThanOrEqual(321);
    expect(world.player.y).toBeLessThanOrEqual(337);
    expect(world.player.direction).toBe(DIRECTION_DOWN);
    expect(run(host, 300)).toContain("4:5:12");
    expect(snapshot(host).eventStates?.["4:5:12"]).toBe(3);
  });

  it("with the soldier heard, Yafei's scene plays on arrival and the task moves on", async () => {
    const host = await standAt(
      baseSave({ "9:2:1": 3, "4:5:12": 3 }, 22),
      4,
      8,
      112,
      260,
      DIRECTION_UP,
    );
    expect(run(host, 400)).toEqual(["4:8:0"]);
    expect(snapshot(host).progress.mainTaskProgress).toBe(23);
  });

  it("a save that skipped the soldier still gets Yafei's scene at the base", async () => {
    const host = await standAt(baseSave({ "9:2:1": 3 }, 22), 4, 8, 112, 260, DIRECTION_UP);
    expect(run(host, 400)).toEqual(["4:8:0"]);
    expect(snapshot(host).progress.mainTaskProgress).toBe(23);
  });
});

describe("talking across a shop counter (WorldTalkPromptEngine with source masks)", () => {
  // 11:8's merchant ABell (sprite 24, 141,229) has a 16x53 mask reaching over her counter: the hero
  // walking up stops at its edge, and from there — not only from inside the counter — he talks.
  it("the hero walks up to ABell's counter and is spoken to from its edge", async () => {
    const host = await standAt(baseSave(), 11, 8, 141, 300, DIRECTION_UP),
      world = host.world!;
    hold(host, "holdUp", 20);
    expect(world.player.y).toBe(284);
    expect(world.talkPrompt?.actorId).toBe(1);
    host.step(["confirm"]);
    for (let i = 0; i < 20; i++) host.step([]);
    expect(world.npcDialog?.speaker).toBe("ABell");
  });
});
