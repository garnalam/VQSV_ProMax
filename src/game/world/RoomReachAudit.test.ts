// Audit (web): every Liệt Hỏa room as the game loads it (APK actors, events and map sizes), walked
// and ridden from each door's arrival (`RoomReach`). Set VQSV_REACH_REPORT to a file to print the
// report; the map audit page (`map-audit/`) shows the same per room.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyApkActors,
  applyApkEvents,
  type ApkActorsDocument,
  type ApkEventsDocument,
} from "./ApkActors";
import { StoryDataRegistry } from "../story/StoryDataRegistry";
import { applyCauVongActors, type RoomAsset } from "../story/GameAssets";
import type { MapCollision } from "./MapCollision";
import { cauVongArrivals, cauVongRoomReach, roomArrivals, roomReach } from "./RoomReach";
import { CV_PLANT, CV_SKY, CV_WATER, roomRestrictions, type RideRoomsDocument } from "../ride/RideSystem";

const root = resolve(import.meta.dirname, "../../../public/pack");
const pack = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8"));

const rooms = pack("world/rooms.json").rooms as Record<string, RoomAsset>;
const registry = StoryDataRegistry.combine(
  pack("story/event-scenes.json"),
  pack("story/cau-vong-event-scenes.json"),
);
applyApkActors(pack("world/apk-actors.json") as ApkActorsDocument, rooms, registry);
applyApkEvents(pack("world/apk-events.json") as ApkEventsDocument, registry);
applyCauVongActors(rooms, pack("cau-vong-world/actors.json"));

const collisions = new Map<number, MapCollision>();
function collision(mapId: number): MapCollision {
  let map = collisions.get(mapId);
  if (!map) {
    map = pack(`world/maps/${mapId}/collision.json`) as MapCollision;
    collisions.set(mapId, map);
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
const worldRoom = (scene: number, room: number) =>
  rooms[`${scene}:${room}#world`] ?? rooms[`${scene}:${room}`];
const lhRooms = Object.keys(rooms)
  .filter((key) => !key.endsWith("#world") && !key.startsWith("98:") && !key.startsWith("-1:"))
  .map((key) => key.split(":").map(Number) as [number, number]);

describe("room reach audit", () => {
  it.runIf(!!process.env.VQSV_REACH_REPORT)("prints every unreachable door, rect and actor", () => {
    const arrivals = roomArrivals(registry, lhRooms, worldRoom, collision),
      report: string[] = [];
    for (const [scene, index] of lhRooms) {
      const room = worldRoom(scene, index);
      if (!room) continue;
      const reach = roomReach(registry, scene, index, room, collision(room.mapId), arrivals.get(`${scene}:${index}`) ?? []);
      report.push(...reach.findings.map((f) => f.text));
    }
    // Cầu Vồng (scene 98): tile doors, pads, and whichever rides each room allows.
    const cvRooms = Object.keys(rooms)
        .filter((key) => key.startsWith("98:") && !key.includes("#"))
        .map((key) => Number(key.split(":")[1])),
      cvArrivals = cauVongArrivals(registry, cvRooms),
      rideRooms = pack("story/ride-rooms.json") as RideRoomsDocument,
      cvCollision = pack("cau-vong-world/collision.json").rooms as Record<string, Record<string, { talk?: string }>>;
    for (const index of cvRooms) {
      const room = worldRoom(98, index);
      if (!room) continue;
      const blocked = roomRestrictions(rideRooms, 98, index),
        rides = [CV_WATER, CV_PLANT, CV_SKY].filter((ride) => blocked[ride] !== 1),
        reach = cauVongRoomReach(registry, index, room, collision(room.mapId), cvArrivals.get(index) ?? [], rides, (id) =>
          cvCollision[`98:${index}`]?.[String(id)]?.talk === "npc");
      report.push(...reach.findings.map((f) => f.text));
    }
    writeFileSync(process.env.VQSV_REACH_REPORT!, report.join("\n") + "\n");
    expect(report.length).toBeGreaterThanOrEqual(0);
  }, 600_000);
});
