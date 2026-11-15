import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyApkActors,
  applyApkEvents,
  type ApkActorsDocument,
  type ApkEventsDocument,
} from "./ApkActors";
import { SourceOpcodeInterpreter } from "../story/SourceOpcodeInterpreter";
import { SourceRouteCatalog } from "../story/SourceRoutes";
import { StoryDataRegistry } from "../story/StoryDataRegistry";
import { sourceDoors } from "./WorldTransition";
import type { RoomAsset } from "../story/GameAssets";

const pack = (path: string) =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../public/pack", path), "utf8"));

/** Fresh copies each time: `applyApkActors` writes into the rooms and the registry. */
function landscapeData() {
  const apk = pack("world/apk-actors.json") as ApkActorsDocument,
    rooms = pack("world/rooms.json").rooms as Record<string, RoomAsset>,
    registry = new StoryDataRegistry(pack("story/event-scenes.json")),
    jarRooms = pack("world/rooms.json").rooms as Record<string, RoomAsset>,
    jarRegistry = new StoryDataRegistry(pack("story/event-scenes.json"));
  applyApkActors(apk, rooms, registry);
  return { apk, rooms, registry, jarRooms, jarRegistry };
}

describe("APK landscape actor positions (applyApkActors)", () => {
  it("puts 1:1's doorway home where the APK draws its arrow, on the path out of the bunny meadow", () => {
    // The byte-scanned `records` table put this row on the fence post below the arrow (22, 342),
    // where the hero cannot stand: the walk back to the Elder after the bunny never left the room.
    const { registry, rooms } = landscapeData(),
      door = sourceDoors(registry, 1, 1).find((candidate) => candidate.actorId === 37)!,
      arrow = rooms["1:1"].actors.find((actor) => actor.id === 37)!;
    expect(door.target).toEqual({ scene: 1, room: 0, actor: 30 });
    expect([door.x, door.y]).toEqual([18, 272]);
    expect([arrow.x, arrow.y]).toEqual([door.x, door.y]);
  });

  it("moves every registry row together with the room actor it is, in every APK room", () => {
    const { apk, rooms, registry, jarRooms, jarRegistry } = landscapeData();
    let checked = 0;
    for (const key of Object.keys(apk.rooms)) {
      if (key.endsWith("#world")) continue;
      const [scene, index] = key.split(":").map(Number),
        jarRows = jarRegistry.room(scene, index)?.actors ?? [];
      registry.room(scene, index)?.actors.forEach((row, record) => {
        const jar = jarRooms[key]?.actors.find((actor) => actor.id === record),
          now = rooms[key]?.actors.find((actor) => actor.id === record),
          source = jarRows[record]?.values ?? [];
        // Only rows that are this actor in the JAR data (same sprite and spot) follow it.
        if (!jar || !now || jar.sprite !== source[1] || jar.x !== source[3] || jar.y !== source[4])
          return;
        expect([key, record, row.values[3], row.values[4]]).toEqual([key, record, now.x, now.y]);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(2000);
  });
});

describe("story routes over the APK event edits (GameApp's order)", () => {
  /** The registry as the game holds it: both event packs, the APK actors, then the APK events. */
  function gameRegistry() {
    const registry = StoryDataRegistry.combine(
      pack("story/event-scenes.json"),
      pack("story/cau-vong-event-scenes.json"),
    );
    applyApkActors(
      pack("world/apk-actors.json") as ApkActorsDocument,
      pack("world/rooms.json").rooms as Record<string, RoomAsset>,
      registry,
    );
    applyApkEvents(pack("world/apk-events.json") as ApkEventsDocument, registry);
    return registry;
  }

  it("compiles every route and world-group patch, so no patch throws on the game's own records", () => {
    // A patch that stops matching throws on every tick of the group: 10:14:0 froze Hỏa Phượng
    // Hoàng's capture, and a save in the room never left the loading screen again.
    const catalog = new SourceRouteCatalog(pack("story/routes.json")),
      interpreter = new SourceOpcodeInterpreter(gameRegistry());
    for (const route of catalog.document.routes)
      expect(() => interpreter.compile(catalog.require(route.id)), route.id).not.toThrow();
  });

  it("compiles every source event group the world can start, with its patches", () => {
    // `WorldEventRuntime` compiles a group the moment it starts: a throw there freezes the game
    // on every tick. Every group of both packs, over the APK edits, with its route patches.
    const registry = gameRegistry(),
      catalog = new SourceRouteCatalog(pack("story/routes.json")),
      interpreter = new SourceOpcodeInterpreter(registry),
      failures: string[] = [];
    let compiled = 0;
    for (const name of ["story/event-scenes.json", "story/cau-vong-event-scenes.json"])
      for (const scene of pack(name).scenes as {
        sceneId: number;
        rooms: { roomIndex: number; eventGroups: unknown[] }[];
      }[])
        // `worldEventTriggers` only dispatches the Liệt Hỏa dialect; Cầu Vồng (98) runs its own
        // runtimes (`CauVong*`) and never compiles its raw groups.
        for (const room of registry.dialect(scene.sceneId) === "lh" ? scene.rooms : [])
          room.eventGroups.forEach((_, group) => {
            const id = `world:${scene.sceneId}:${room.roomIndex}:${group}`;
            try {
              interpreter.compile({
                id,
                patches: catalog.patchesFor(id),
                groups: [{ sceneId: scene.sceneId, roomIndex: room.roomIndex, groupIndex: group }],
                startEvent: 0,
              });
              compiled++;
            } catch (error) {
              failures.push(`${id}: ${(error as Error).message.slice(0, 160)}`);
            }
          });
    expect(failures).toEqual([]);
    // All 333 Liệt Hỏa groups.
    expect(compiled).toBe(333);
  });

  it("10:14:0: the win closes the group, prompts the save, then returns to 1:3 at the APK's point", () => {
    const catalog = new SourceRouteCatalog(pack("story/routes.json")),
      program = new SourceOpcodeInterpreter(gameRegistry()).compile(
        catalog.require("world:10:14:0"),
      ),
      // The win branch (op47 → the op36 reward) is the last return to the village.
      at = program.events.map((event) => event.type).lastIndexOf("load");
    expect(program.events.slice(at - 3, at + 1)).toEqual([
      { type: "markComplete", ref: { scene: 10, room: 14, group: 0 } },
      { type: "savePrompt" },
      { type: "markComplete", ref: { scene: 10, room: 14, group: 1 } },
      // apk-events moves the arrival to y 176 (the JAR's 192); the patch keeps the program's point.
      { type: "load", scene: 1, room: 3, x: 56, y: 176, updateWorld: true },
    ]);
  });
});
