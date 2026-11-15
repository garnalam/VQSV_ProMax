// Every Liệt Hỏa door as the game plays it (APK actors and events applied, APK map sizes): the
// target room exists, its map files ship, and the arrival point is one the hero can walk out of.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyApkActors,
  applyApkEvents,
  type ApkActorsDocument,
  type ApkEventsDocument,
} from "./ApkActors";
import { StoryDataRegistry } from "../story/StoryDataRegistry";
import type { RoomAsset } from "../story/GameAssets";
import type { MapCollision } from "./MapCollision";
import { safeRoomArrival } from "./RoomArrivalSafety";
import { sourceDoors, transitionArrivalForTarget } from "./WorldTransition";

const root = resolve(import.meta.dirname, "../../../public/pack");
const pack = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8"));

const rooms = pack("world/rooms.json").rooms as Record<string, RoomAsset>;
const registry = StoryDataRegistry.combine(
  pack("story/event-scenes.json"),
  pack("story/cau-vong-event-scenes.json"),
);
applyApkActors(pack("world/apk-actors.json") as ApkActorsDocument, rooms, registry);
applyApkEvents(pack("world/apk-events.json") as ApkEventsDocument, registry);

const collisions = new Map<number, MapCollision>();
function collision(mapId: number): MapCollision {
  let map = collisions.get(mapId);
  if (!map) {
    map = pack(`world/maps/${mapId}/collision.json`) as MapCollision;
    collisions.set(mapId, map);
    // GameAssets.prepareMap: an APK map larger than the JAR room gives every room on it its size.
    if (map.originX !== undefined || map.originY !== undefined)
      for (const room of Object.values(rooms))
        if (room.mapId === mapId) {
          room.width = map.widthPixels;
          room.height = map.heightPixels;
          room.originX = map.originX ?? 0;
          room.originY = map.originY ?? 0;
        }
  }
  return map;
}
/** GameAssets.getWorldRoom. */
const worldRoom = (scene: number, room: number) =>
  rooms[`${scene}:${room}#world`] ?? rooms[`${scene}:${room}`];

const lhRooms = Object.keys(rooms)
  .filter((key) => !key.endsWith("#world") && !key.startsWith("98:") && !key.startsWith("-1:"))
  .map((key) => key.split(":").map(Number) as [number, number]);

describe("every Liệt Hỏa room and door, as the game loads them", () => {
  it("ships each world room's map: meta, collision and every layer", () => {
    const missing: string[] = [];
    for (const [scene, index] of lhRooms) {
      const mapId = worldRoom(scene, index).mapId,
        dir = resolve(root, `world/maps/${mapId}`);
      if (!existsSync(resolve(dir, "meta.json")) || !existsSync(resolve(dir, "collision.json"))) {
        missing.push(`${scene}:${index} map ${mapId}`);
        continue;
      }
      const meta = JSON.parse(readFileSync(resolve(dir, "meta.json"), "utf8")) as {
        layers: number;
      };
      for (let layer = 0; layer < meta.layers; layer++)
        if (!existsSync(resolve(dir, `layer-${layer}.png`)))
          missing.push(`${scene}:${index} map ${mapId} layer ${layer}`);
    }
    expect(missing).toEqual([]);
  });

  it("lands every door on a walkable point of an existing room", () => {
    const broken: string[] = [];
    let doors = 0;
    const repaired: string[] = [];
    for (const [scene, index] of lhRooms)
      for (const door of sourceDoors(registry, scene, index)) {
        const { target } = door,
          label = `${scene}:${index} door ${door.actorId} → ${target.scene}:${target.room}#${target.actor}`;
        // Doors into Cầu Vồng run through its own table; a negative scene is a script exit.
        if (target.scene === 98 || target.scene < 0) continue;
        doors++;
        const room = worldRoom(target.scene, target.room);
        if (!room) {
          broken.push(`${label}: no room`);
          continue;
        }
        const map = collision(room.mapId),
          arrival = transitionArrivalForTarget(registry, room, target);
        if (!arrival) {
          broken.push(`${label}: no arrival actor`);
          continue;
        }
        const fix = safeRoomArrival(
          map,
          arrival,
          4,
          (terrain) => terrain,
          true,
          false,
          false,
          () => false,
        );
        // Four JAR arrivals sit a tile inside a wall; the entry check (`checkRoomArrival`) steps the
        // hero out to the nearest free tile. That must stay beside the doorway, never across a wall.
        if (fix && Math.hypot(fix.x - arrival.x, fix.y - arrival.y) > 32)
          broken.push(`${label}: (${arrival.x},${arrival.y}) walled in → ${fix.x},${fix.y}`);
        else if (fix) repaired.push(label);
      }
    expect(doors).toBe(248);
    expect(broken).toEqual([]);
    expect(repaired).toEqual([
      "1:4 door 50 → 11:7#0",
      "7:11 door 1 → 7:12#0",
      "9:6 door 0 → 9:6#5",
      "10:6 door 5 → 10:7#1",
    ]);
  });
});
