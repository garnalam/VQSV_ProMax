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
// JavaSE tryTransition tables: [scene, room, actor, javaDir, tScene, tRoom, tActor]
const T: number[][] = [
  [7, 6, 0, 0, 7, 5, 5],
  [7, 5, 4, 0, 7, 3, 2],
  [7, 5, 5, 2, 7, 6, 0],
  [7, 3, 0, 3, 7, 2, 9],
  [7, 3, 1, 0, 7, 4, 0],
  [7, 3, 2, 2, 7, 5, 4],
  [7, 2, 5, 0, 9, 7, 5],
  [7, 2, 8, 2, 7, 1, 5],
  [7, 2, 9, 1, 7, 3, 0],
  [7, 2, 10, 3, 7, 7, 0],
  [7, 2, 7, 0, 11, 3, 0],
  [7, 2, 6, 0, 11, 28, 0],
  [11, 3, 0, 2, 7, 2, 7],
  [11, 28, 0, 2, 7, 2, 6],
  [7, 4, 0, 2, 7, 3, 1],
  [7, 4, 1, 0, 10, 1, 7],
  [10, 1, 5, 3, 10, 2, 6],
  [10, 1, 7, 2, 7, 4, 1],
  [10, 2, 6, 1, 10, 1, 5],
  [10, 2, 7, 0, 10, 3, 6],
  [10, 3, 6, 2, 10, 2, 7],
  [10, 3, 7, 2, 10, 4, 9],
  [10, 4, 9, 0, 10, 3, 7],
  [7, 7, 0, 1, 7, 2, 10],
  [7, 7, 1, 0, 7, 8, 8],
  [7, 7, 2, 2, 7, 11, 0],
  [7, 7, 3, 3, 7, 10, 0],
  [7, 8, 8, 2, 7, 7, 1],
  [7, 8, 9, 3, 7, 9, 0],
  [7, 9, 0, 1, 7, 8, 9],
  [7, 9, 19, 0, 10, 5, 3],
  [7, 10, 0, 1, 7, 7, 3],
  [7, 11, 0, 0, 7, 7, 2],
  [7, 11, 1, 2, 7, 12, 0],
  [7, 12, 0, 0, 7, 11, 1],
  [7, 12, 1, 1, 10, 8, 4],
  [10, 5, 2, 0, 10, 6, 4],
  [10, 5, 3, 2, 7, 9, 19],
  [10, 6, 4, 3, 10, 5, 2],
  [10, 6, 5, 0, 10, 7, 1],
  [10, 6, 6, 2, 10, 7, 2],
  [10, 6, 7, 1, 10, 7, 0],
  [10, 7, 0, 1, 10, 6, 7],
  [10, 7, 1, 0, 10, 6, 5],
  [10, 7, 2, 3, 10, 6, 6],
  [10, 8, 4, 2, 7, 12, 1],
  [9, 7, 5, 2, 7, 2, 5],
  [7, 1, 5, 0, 7, 2, 8],
  [7, 1, 4, 2, 7, 0, 18],
  [7, 0, 18, 0, 7, 1, 4],
  [7, 0, 17, 2, 6, 1, 1],
];

/** A save past the whole chapter (task 42): every barrier lifted, every trainer beaten. */
const ALL_DONE = [
  "7:6:4",
  "7:3:2",
  "7:2:1",
  "11:3:2",
  "11:3:3",
  "7:3:3",
  "7:2:7",
  "7:4:0",
  "10:1:0",
  "10:1:3",
  "10:4:3",
  "11:3:4",
  "10:8:0",
  "10:8:1",
  "10:8:2",
  "7:8:1",
  "7:8:2",
  "10:5:0",
  "10:5:1",
  "10:7:0",
  "11:3:5",
  "9:7:0",
  "9:7:1",
  "9:7:2",
  "9:7:3",
  "9:7:4",
  "7:1:0",
  "7:1:1",
  "7:0:0",
  "7:9:1",
  "7:10:0",
  "7:10:1",
  "7:10:2",
  "7:11:0",
  "7:12:0",
  "7:12:1",
  "7:6:5",
  "7:5:0",
  "7:3:0",
  "7:3:1",
  "7:6:0",
  "7:6:1",
  "7:6:2",
  "7:6:3",
  "11:3:0",
  "11:3:1",
  "7:8:0",
];
function chapterSave(task: number, done: string[]) {
  const base = new GameplayHost(
    sources,
    new SaveService(new SaveRepository(new MemorySaveStore())),
    { onExit: () => {} },
    {
      kind: "resume",
      save: scene1Save({
        location: { sceneId: 7, roomIndex: 6, x: 48, y: 192, direction: 1 },
        owner: SCENE1_RESUME.bunnyReturnRoom0,
        bunnyCaught: true,
        pets: [{ speciesId: 68, level: 45, quality: 2 }],
      }),
    },
  );
  const s0 = base.snapshot(base.world!);
  return {
    ...s0,
    eventStates: { ...s0.eventStates, ...Object.fromEntries(done.map((k) => [k, 3])) },
    progress: { ...s0.progress, mainTaskProgress: task },
    world: { ...s0.world!, mainTaskProgress: task },
  };
}

describe("Bích Lam Cốc rooms, as the chapter runtimes wire them", () => {
  it("every door of the chapter's 24 rooms (BlcC1–C4 tryTransition) leads where JavaSE sends it, on foot", async () => {
    const { DIRECTION_DOWN, DIRECTION_UP, DIRECTION_LEFT } = await import("../world/MapCollision");
    const save = chapterSave(42, ALL_DONE),
      wrong: unknown[] = [];
    for (const [scene, room, actor, , toScene, toRoom, toActor] of T) {
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
      for (let i = 0; i < 40 && walk.world.sceneId === scene && walk.world.roomIndex === room; i++)
        walk.host.step([key]);
      if (walk.world.sceneId !== toScene || walk.world.roomIndex !== toRoom)
        wrong.push(["walk", scene, room, actor, [walk.world.sceneId, walk.world.roomIndex]]);
    }
    expect(wrong).toEqual([]);
  }, 600000);

  it("arriving inside an outgrown barrier (7:11 from 7:12) does not push the hero back", async () => {
    const save = chapterSave(37, ["11:3:4", "7:11:0"]);
    const { host, world } = await standAt(save, 7, 11, 192, 306, 0);
    for (let i = 0; i < 10; i++) host.step(["holdDown"]);
    expect([
      world.eventState.sourceEventState(7, 11, 1),
      world.eventState.sourceEventState(7, 11, 2),
    ]).toEqual([3, 3]);
    expect(host.world!.roomIndex).toBe(12);
  });

  it("every chapter NPC row says its JavaSE line once its room's events are done", async () => {
    const rows = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, "../../../public/pack/story/npc-services.json"),
        "utf8",
      ),
    ).services as {
      scene: number;
      room: number;
      actorId: number;
      text: string;
      runtime: string;
      continuation: string;
    }[];
    const c1 = ["7:6:4", "7:3:2", "7:2:1", "11:3:2", "11:3:3", "7:3:3"],
      c2 = chapterSave(36, [...c1, "10:4:3"]),
      done = chapterSave(42, ALL_DONE),
      beforeRitual = chapterSave(
        40,
        ALL_DONE.filter((k) => !/^(9:7|7:0|7:1):/.test(k)),
      ),
      silent: unknown[] = [];
    let checked = 0;
    for (const row of rows.filter((r) => r.runtime.startsWith("Blc"))) {
      // Each row is read while its runtime owns the room: the temple (11:3) is BlcC2Runtime's
      // between Lôi Kỳ Lân (10:4:g3) and the wings (11:3:g4), Tomas's 7:0 line is BlcC4Runtime's
      // before the ritual; everywhere else the chapter is over.
      const save =
        row.runtime === "BlcC2Runtime" && row.scene === 11
          ? c2
          : row.runtime === "BlcC4Runtime" && row.scene === 7 && row.room === 0
            ? beforeRitual
            : done;
      // While BlcC2Runtime owns the temple, Tomas (actor 19) is the wings event (11:3:g4) first.
      if (row.runtime === "BlcC2Runtime" && row.scene === 11 && row.actorId === 19) continue;
      await assets.prepareRoom(row.scene, row.room);
      const actor = assets
        .getWorldRoom(row.scene, row.room)!
        .actors.find((a) => a.id === row.actorId)!;
      let said: string | null = null;
      for (const [dx, dy, dir] of [
        [0, 20, 2],
        [0, -16, 0],
        [20, 0, 3],
        [-20, 0, 1],
      ] as const) {
        const talk = await standAt(save, row.scene, row.room, actor.x + dx, actor.y + dy, dir);
        talk.host.step(["confirm"]);
        for (
          let i = 0;
          i < 400 && talk.world.npcDialog && talk.world.npcDialog.text !== row.text;
          i++
        )
          talk.host.step([]);
        said = talk.world.npcDialog?.text ?? null;
        if (said) break;
      }
      checked++;
      if (said !== row.text) silent.push([row.scene, row.room, row.actorId, said]);
    }
    expect(silent).toEqual([]);
    expect(checked).toBeGreaterThan(30);
  }, 900000);
});
