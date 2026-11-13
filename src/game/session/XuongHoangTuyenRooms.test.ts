import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
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
const { storyPlaythrough } = await import("./StoryPlaythrough");
const { sourceDoors } = await import("../world/WorldTransition");
const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
const sources = gameplaySources(assets, boot);
const { standAt } = storyPlaythrough(sources, assets, boot.sourceEvents);
// JavaSE tryTransition tables (XhtC1–C3, Sc8C1): [scene, room, actor, tScene, tRoom, tActor]
const T: number[][] = [
  [2, 7, 46, 10, 9, 0],
  [10, 9, 0, 2, 7, 46],
  [10, 9, 2, 10, 10, 5],
  [10, 10, 5, 10, 9, 2],
  [10, 10, 0, 10, 11, 1],
  [10, 11, 1, 10, 10, 0],
  [10, 12, 28, 4, 10, 1],
  [4, 10, 0, 4, 9, 2],
  [4, 10, 1, 10, 12, 28],
  [10, 0, 2, 4, 4, 31],
  [4, 4, 31, 10, 0, 2],
  [8, 0, 0, 8, 1, 0],
  [8, 0, 1, 8, 5, 0],
  [8, 0, 2, 8, 3, 0],
  [8, 1, 0, 8, 0, 0],
  [8, 1, 1, 8, 2, 0],
  [8, 2, 0, 8, 1, 1],
  [8, 3, 0, 8, 0, 2],
  [8, 3, 1, 8, 4, 0],
  [8, 4, 0, 8, 3, 1],
  [8, 5, 0, 8, 0, 1],
];
const ROOMS = [...new Set(T.flatMap(([s, r, , ts, tr]) => [`${s}:${r}`, `${ts}:${tr}`]))];

/** Task 48 with every group of the arc's rooms played out, all six badges and the last node. */
function arcSave() {
  const base = new GameplayHost(
    sources,
    new SaveService(new SaveRepository(new MemorySaveStore())),
    { onExit: () => {} },
    {
      kind: "resume",
      save: scene1Save({
        location: { sceneId: 8, roomIndex: 0, x: 200, y: 200, direction: 1 },
        owner: SCENE1_RESUME.bunnyReturnRoom0,
        bunnyCaught: true,
        pets: [{ speciesId: 68, level: 45, quality: 2 }],
      }),
    },
  );
  const s0 = base.snapshot(base.world!),
    done: string[] = [];
  for (const room of ROOMS) {
    const [scene, index] = room.split(":").map(Number);
    for (let g = 0; g < 64; g++)
      if (boot.sourceEvents.group(scene, index, g)) done.push(`${room}:${g}`);
  }
  return {
    ...s0,
    eventStates: { ...s0.eventStates, ...Object.fromEntries(done.map((k) => [k, 3])) },
    progress: { ...s0.progress, mainTaskProgress: 48 },
    world: { ...s0.world!, mainTaskProgress: 48, badgesAchieved: [1, 1, 1, 1, 1, 1] },
    story: { ...s0.story, quest: { node: "huan-luyen-su-xuat-sac" } },
  };
}

describe("Xương Hoàng Tuyền and Thôn Tachi rooms, as XhtC1–C3 and Sc8C1 wire them", () => {
  it("every door of the arc leads where JavaSE sends it, on foot", async () => {
    const { DIRECTION_DOWN, DIRECTION_UP, DIRECTION_LEFT } = await import("../world/MapCollision");
    const save = arcSave(),
      wrong: unknown[] = [];
    for (const [scene, room, actor, toScene, toRoom, toActor] of T) {
      const door = sourceDoors(boot.sourceEvents, scene, room).find((d) => d.actorId === actor);
      if (!door) {
        wrong.push(["no door", scene, room, actor]);
        continue;
      }
      if (
        door.target.scene !== toScene ||
        door.target.room !== toRoom ||
        door.target.actor !== toActor
      )
        wrong.push(["target", scene, room, actor, door.target]);
      const dir = door.requiredDirection,
        vertical = dir === DIRECTION_DOWN || dir === DIRECTION_UP,
        back = dir === DIRECTION_DOWN || dir === 1 ? -14 : 14,
        key =
          dir === DIRECTION_DOWN
            ? "holdDown"
            : dir === DIRECTION_UP
              ? "holdUp"
              : dir === DIRECTION_LEFT
                ? "holdLeft"
                : "holdRight";
      await assets.prepareRoom(toScene, toRoom);
      const walk = await standAt(
        save,
        scene,
        room,
        vertical ? door.x : door.x + back,
        vertical ? door.y + back : door.y,
        dir,
      );
      for (let i = 0; i < 60 && walk.world.sceneId === scene && walk.world.roomIndex === room; i++)
        walk.host.step([key]);
      if (walk.world.sceneId !== toScene || walk.world.roomIndex !== toRoom)
        wrong.push(["walk", scene, room, actor, [walk.world.sceneId, walk.world.roomIndex]]);
    }
    expect(wrong).toEqual([]);
  }, 600000);
});
