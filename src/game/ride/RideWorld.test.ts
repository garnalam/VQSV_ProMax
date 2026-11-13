import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/** Pack images are 1x1 stand-ins under Node; this rig never reads pixels. */
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
const { gameplaySources } = await import("../session/GameplayHost");
const { WorldRuntime } = await import("../world/WorldRuntime");
const { WorldPanel } = await import("../world/WorldPanel");
const { scene1Save } = await import("../../dev/parityCheckpoints");
const { SCENE1_RESUME } = await import("../../persistence/save/migrations");
const { terrainAtWorld, stepWithTerrain, DIRECTION_LEFT, DIRECTION_RIGHT } =
  await import("../world/MapCollision");
const ride = await import("./RideSystem");

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
const sources = gameplaySources(assets, boot).world;
const contract = assets.worldContract;

type Save = Parameters<typeof scene1Save>[0];
function grassSpot(): { x: number; y: number } {
  const map = sources.collision(sources.room(1, 2)!.mapId)!;
  for (let y = 40; y < 600; y += 4)
    for (let x = 40; x < 600; x += 4)
      if (
        terrainAtWorld(map, x, y) === 0 &&
        stepWithTerrain(map, x, y, DIRECTION_RIGHT).moved &&
        stepWithTerrain(map, x + 8, y, DIRECTION_LEFT).moved
      )
        return { x, y };
  throw new Error("no grass in 1:2");
}
const roadSave: Save = {
  location: { sceneId: 1, roomIndex: 2, ...grassSpot(), direction: 1 },
  owner: SCENE1_RESUME.bunnyReturnRoom0,
  bunnyCaught: true,
  eventStates: { "1:1:0": 3 },
  pets: [{ speciesId: 68, level: 9, quality: 2 }],
};
function roadWorld(save = scene1Save(roadSave)) {
  const runtime = new WorldRuntime(contract, sources, save);
  for (let i = 0; i < 64 && runtime.mapLoading; i++) runtime.tickMapLoading();
  runtime.tick([]);
  return runtime;
}
/** The panel bound to the world the way `GameplayHost` binds it. */
function ridePanel(world: InstanceType<typeof WorldRuntime>) {
  const panel = new WorldPanel();
  panel.rideSource = {
    active: () => world.activeRideIndex,
    unlocked: (id) => world.rideUnlocked(id),
    usable: (id) => world.rideUsable(id),
    select: (id) => world.selectRide(id),
  };
  return panel;
}

describe("RideProgression / VqsvRideRuntime rules", () => {
  it("keeps the JavaSE speeds, encounter suppression and Rainbow species", () => {
    expect(Array.from({ length: 9 }, (_, i) => ride.rideSpeed(i))).toEqual([
      8, 8, 4, 4, 6, 8, 4, 8, 4,
    ]);
    expect(ride.rideSpeed(-1)).toBe(4);
    expect(Array.from({ length: 9 }, (_, i) => ride.rideSuppressesEncounters(i))).toEqual([
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      false,
      false,
    ]);
    expect([4, 5, 6, 7, 8].map(ride.rainbowRideSpecies)).toEqual([113, 166, 134, 149, 182]);
    expect([4, 5, 6, 7, 8].map(ride.rideTerrainIndex)).toEqual([0, 1, 0, 2, 3]);
  });

  it("reads the baked petRide.mid restrictions, blocking every ride in an unlisted room", () => {
    // Scene 1: land rides allowed, Hải âu and the sky mount not.
    expect(ride.roomRestrictions(assets.rideRooms, 1, 2)).toEqual([0, 0, 1, 0, 0, 0, 0, 1, 0]);
    expect(ride.roomRestrictions(assets.rideRooms, 99, 0)).toEqual(new Array(9).fill(1));
    // Cầu Vồng's thorn forest needs the plant mount (`applyRoomPolicy` FOREST_ROOM_INDEX).
    expect(ride.roomRestrictions(assets.rideRooms, 98, 11)[ride.CV_PLANT]).toBe(0);
  });

  it("unlocks Liệt Hỏa rides by special reward and Cầu Vồng rides by event or collection", () => {
    const none = { specials: [], rainbowEventDone: () => false, collected: () => false };
    expect(ride.rideUnlocked(0, none)).toBe(false);
    expect(ride.rideUnlocked(0, { ...none, specials: [1] })).toBe(true);
    expect(ride.rideUnlocked(3, { ...none, specials: [4] })).toBe(true);
    expect(ride.rideUnlocked(4, { ...none, collected: (id: number) => id === 113 })).toBe(true);
    expect(
      ride.rideUnlocked(5, {
        ...none,
        rainbowEventDone: (room: number, event: number) => room === 0 && event === 700105,
      }),
    ).toBe(true);
    expect(ride.rideUnlocked(8, { ...none, collected: (id: number) => id === 183 })).toBe(true);
    expect(
      ride.rideUnlocked(7, {
        ...none,
        rainbowEventDone: (room: number, event: number) => room === 9 && event === 104,
      }),
    ).toBe(true);
  });

  it("lets Hải âu land only on plain ground under both footprint corners", () => {
    expect(ride.canLandFromHaiAu(20, 20, () => 0)).toBe(true);
    expect(ride.canLandFromHaiAu(20, 20, (x) => (x > 20 ? 1 : 0))).toBe(false);
  });
});

describe("rides on the free map", () => {
  it("mounts an owned ride, swaps the hero sprite and moves at the ride speed", () => {
    const world = roadWorld();
    expect(world.selectRide(0)).toBe("locked");
    world.bag.specials.push(1, 3);
    expect(world.selectRide(2)).toBe("blocked");
    expect(world.selectRide(0)).toBe("ready");
    expect([world.player.sprite, world.playerMoveSpeed]).toEqual([1, 8]);
    const x = world.player.x;
    world.tick(["holdRight"]);
    expect(world.player.x - x).toBe(8);
    expect(world.eventState.sourceEventStateComplete(98, 0, ride.RIDE_IDS_SEPARATED_EVENT)).toBe(
      true,
    );
    world.dismountRide();
    expect([world.activeRideIndex, world.player.sprite, world.playerMoveSpeed]).toEqual([-1, 0, 4]);
  });

  it("shows a Cầu Vồng mount as its rider projection in the Rainbow state order", () => {
    const world = roadWorld();
    world.collection.markCollected(113);
    expect(world.selectRide(ride.CV_PLANT)).toBe("ready");
    expect(world.player.sprite).toBe(9004);
    world.tick(["holdRight"]);
    // Rainbow side art is state 2 (walking 5), drawn mirrored when facing right.
    expect([world.player.state, world.player.renderOrientation]).toEqual([5, DIRECTION_LEFT]);
  });

  it("suppresses wild encounters on Hư không hành giả", () => {
    const world = roadWorld();
    world.bag.specials.push(2);
    expect(world.selectRide(1)).toBe("ready");
    world.encounterStepsRemaining = 1;
    for (let i = 0; i < 300; i++)
      world.tick([Math.trunc(i / 3) % 2 === 0 ? "holdRight" : "holdLeft"]);
    expect(world.battle).toBeNull();
  });

  it("saves the mount and re-checks ownership on resume (restoreAfterLoad)", () => {
    const world = roadWorld();
    world.bag.specials.push(1);
    world.selectRide(0);
    const save = world.snapshot();
    expect(save.meta?.campaign.ride.activeIndex).toBe(0);
    const resumed = roadWorld(save);
    expect([resumed.activeRideIndex, resumed.player.sprite]).toEqual([0, 1]);
    const lost = { ...save, inventory: { ...save.inventory, specials: [] } };
    expect(roadWorld(lost).activeRideIndex).toBe(-1);
  });

  it("ride.ui: confirm mounts and closes, a locked or forbidden card warns", () => {
    const world = roadWorld(),
      panel = ridePanel(world);
    world.bag.specials.push(1, 3);
    panel.openRide();
    expect([panel.visible, panel.mode, panel.rideSelected]).toEqual([true, "ride", 0]);
    panel.tick(["confirm"]);
    expect([panel.visible, world.activeRideIndex]).toEqual([false, 0]);
    world.dismountRide();
    panel.openRide();
    panel.tick(["right"]);
    panel.tick(["confirm"]);
    expect(panel.rideMessage?.text).toBe("Chưa có sủng vật cưỡi này");
    panel.tick(["confirm"]);
    expect(panel.rideMessage).toBeNull();
    panel.tick(["right"]);
    panel.tick(["confirm"]);
    expect(panel.rideMessage?.text).toBe("Nơi này không thể sử dụng sủng vật cưỡi");
    panel.tick(["back"]);
    panel.tick(["down"]);
    expect(panel.rideSelected).toBe(6);
    panel.tick(["up"]);
    expect(panel.rideSelected).toBe(2);
  });
});
