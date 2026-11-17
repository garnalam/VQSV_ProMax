// Web audit: where the hero can get in a Liệt Hỏa room as the game loads it, walked with his own
// step (`stepWithTerrain`, 4 px, badge gates open) and riding the room's leaves and clouds end to
// end. Used by the map audit page (`map-audit/`) and `RoomReachAudit.test.ts`.
import type { StoryDataRegistry } from "../story/StoryDataRegistry";
import type { RoomAsset } from "../story/GameAssets";
import {
  cauVongEdgeClear,
  cauVongMovementTerrain,
  stepWithTerrain,
  terrainAtWorld,
  type MapCollision,
} from "./MapCollision";
import { CV_PLANT, CV_SKY, CV_WATER } from "../ride/RideSystem";
import { isPlatform, platformCanAdvance, PLATFORM_HORIZONTAL } from "./PlatformRide";
import { safeRoomArrival } from "./RoomArrivalSafety";
import {
  CAU_VONG_ROUTE_SCENE,
  doorOverlaps,
  roomDoorArrival,
  roomDoorRow,
  sourceDoors,
  sourceRoomDoors,
  sourceRoomPortals,
  transitionArrivalForTarget,
  type SourceDoor,
} from "./WorldTransition";
import { worldEventTriggers, type WorldEventTrigger } from "./WorldEventCatalog";
import { playerIntersectsSourceRect } from "./WorldInteractionEngine";

export type Point = { x: number; y: number };
export type Arrival = { from: string; at: Point };
export type ReachFinding = { kind: "door" | "rect" | "actor" | "stuck"; text: string; at?: Point };
export type RoomReach = {
  arrivals: Arrival[];
  reached: Point[];
  lanes: Point[][];
  doors: SourceDoor[];
  triggers: WorldEventTrigger[];
  findings: ReachFinding[];
};

/** A cloud's or leaf's lane: the points along its axis it can sail over from where it rests. */
export function platformLanes(map: MapCollision, room: RoomAsset): Point[][] {
  const out: Point[][] = [];
  for (const actor of room.actors) {
    if (!actor.visible || !isPlatform(actor)) continue;
    const horizontal = actor.variant === PLATFORM_HORIZONTAL,
      sails = (x: number, y: number) => platformCanAdvance(actor, terrainAtWorld(map, x, y)),
      lane: Point[] = [{ x: actor.x, y: actor.y }];
    for (const sign of [-1, 1])
      for (let d = 4; d < 2000; d += 4) {
        const x = actor.x + (horizontal ? sign * d : 0),
          y = actor.y + (horizontal ? 0 : sign * d);
        if (!sails(x, y)) break;
        lane.push({ x, y });
      }
    out.push(lane);
  }
  return out;
}

/** Every spot the hero reaches from `start`, walking and riding the lanes. */
export function floodRoom(map: MapCollision, start: Point, rides: Point[][] = []): Map<string, Point> {
  const seen = new Map<string, Point>([[`${start.x},${start.y}`, start]]),
    queue: Point[] = [start],
    used = new Set<number>();
  for (;;) {
    for (let head = 0; head < queue.length && head < 200000; head++) {
      const at = queue[head];
      for (const direction of [0, 1, 2, 3]) {
        const to = stepWithTerrain(map, at.x, at.y, direction, true, 4);
        if (!to.moved) continue;
        const key = `${to.x},${to.y}`;
        if (seen.has(key)) continue;
        const point = { x: to.x, y: to.y };
        seen.set(key, point);
        queue.push(point);
      }
    }
    let boarded = false;
    rides.forEach((lane, i) => {
      if (used.has(i)) return;
      const near = [...seen.values()].some((p) =>
        lane.some((c) => Math.abs(c.x - p.x) <= 24 && Math.abs(c.y - p.y) <= 24),
      );
      if (!near) return;
      used.add(i);
      boarded = true;
      for (const c of lane) {
        const key = `${c.x},${c.y}`;
        if (seen.has(key)) continue;
        seen.set(key, c);
        queue.push(c);
      }
    });
    if (!boarded) return seen;
  }
}

/** Every door's arrival, by target room ("scene:room"). */
export function roomArrivals(
  registry: StoryDataRegistry,
  roomKeys: readonly [number, number][],
  worldRoom: (scene: number, room: number) => RoomAsset | undefined,
  collision: (mapId: number) => MapCollision | undefined,
): Map<string, Arrival[]> {
  const arrivals = new Map<string, Arrival[]>();
  for (const [scene, index] of roomKeys)
    for (const door of sourceDoors(registry, scene, index)) {
      const { target } = door;
      if (target.scene === 98 || target.scene < 0) continue;
      const room = worldRoom(target.scene, target.room),
        map = room && collision(room.mapId);
      if (!room || !map) continue;
      const arrival = transitionArrivalForTarget(registry, room, target);
      if (!arrival) continue;
      const fix = safeRoomArrival(map, arrival, 4, (t) => t, true, false, false, () => false);
      const key = `${target.scene}:${target.room}`;
      if (!arrivals.has(key)) arrivals.set(key, []);
      arrivals.get(key)!.push({ from: `${scene}:${index}`, at: fix ?? { x: arrival.x, y: arrival.y } });
    }
  return arrivals;
}

/** The reach of one room from its arrivals, and what none of them reaches. */
export function roomReach(
  registry: StoryDataRegistry,
  scene: number,
  index: number,
  room: RoomAsset,
  map: MapCollision,
  arrivals: Arrival[],
): RoomReach {
  const key = `${scene}:${index}`,
    doors = sourceDoors(registry, scene, index).filter((door) => door.target.scene >= 0),
    triggers = worldEventTriggers(registry, scene, index),
    lanes = platformLanes(map, room),
    floods = arrivals.map((start) => floodRoom(map, start.at, lanes)),
    union = new Map<string, Point>();
  for (const f of floods) for (const [k, p] of f) union.set(k, p);
  const all = [...union.values()],
    reach = (test: (p: Point) => boolean) => all.some(test),
    findings: ReachFinding[] = [];
  if (arrivals.length) {
    for (const door of doors)
      if (!reach((p) => doorOverlaps(p, door)))
        findings.push({
          kind: "door",
          at: { x: door.x, y: door.y },
          text: `${key} cửa ${door.actorId} (${door.x},${door.y}) → ${door.target.scene}:${door.target.room}: không tới được`,
        });
    arrivals.forEach((start, i) => {
      const points = [...floods[i].values()];
      if (!doors.some((door) => points.some((p) => doorOverlaps(p, door))))
        findings.push({
          kind: "stuck",
          at: start.at,
          text: `${key} vào từ ${start.from} tại (${start.at.x},${start.at.y}): kẹt, không ra được cửa nào`,
        });
    });
    for (const trigger of triggers) {
      const g = `${trigger.group.scene}:${trigger.group.room}:g${trigger.group.group}`;
      if (trigger.kind === "rect") {
        if (!reach((p) => playerIntersectsSourceRect(p.x, p.y, trigger.rect)))
          findings.push({
            kind: "rect",
            at: { x: trigger.rect.x, y: trigger.rect.y },
            text: `${key} ô sự kiện ${g} [${trigger.rect.x},${trigger.rect.y},${trigger.rect.width},${trigger.rect.height}]: không tới được`,
          });
      } else if (trigger.kind === "actor") {
        const actor = room.actors.find((a) => a.id === trigger.actorId);
        if (!actor) {
          findings.push({ kind: "actor", text: `${key} sự kiện ${g}: NPC ${trigger.actorId} không có trong phòng` });
          continue;
        }
        let best = Infinity;
        for (const p of all) best = Math.min(best, Math.max(Math.abs(p.x - actor.x), Math.abs(p.y - actor.y)));
        if (best > 40)
          findings.push({
            kind: "actor",
            at: { x: actor.x, y: actor.y },
            text: `${key} sự kiện ${g}: NPC ${trigger.actorId} (${actor.x},${actor.y}) không tới gần được, gần nhất ${best}px`,
          });
      }
    }
  }
  return { arrivals, reached: all, lanes, doors, triggers, findings };
}

/**
 * Cầu Vồng (scene 98): its doors and pads are tiles of the /4 table and the route's pad rows
 * (`sourceRoomDoors`, `sourceRoomPortals`), the hero steps as `WorldRuntime.walk` does there
 * (`cauVongEdgeClear` over `cauVongMovementTerrain`), and any ride the room allows may be taken
 * anywhere, so a step is open if any of them makes it.
 */
export type CauVongReach = {
  arrivals: Arrival[];
  reached: Point[];
  doors: { x: number; y: number; label: string }[];
  findings: ReachFinding[];
};

export function cauVongArrivals(
  registry: StoryDataRegistry,
  roomIndexes: readonly number[],
): Map<number, Arrival[]> {
  const out = new Map<number, Arrival[]>(),
    add = (room: number, from: string, at: Point) => {
      if (!out.has(room)) out.set(room, []);
      out.get(room)!.push({ from, at });
    };
  for (const room of roomIndexes) {
    for (const door of sourceRoomDoors(registry, CAU_VONG_ROUTE_SCENE, room)) {
      const row = roomDoorRow(registry, door.target.scene, door.target.room, door.target.entry);
      if (!row || door.target.scene !== CAU_VONG_ROUTE_SCENE) continue;
      const at = roomDoorArrival(row);
      add(door.target.room, `98:${room} cửa ô (${door.x},${door.y})`, { x: at.x, y: at.y });
    }
    for (const portal of sourceRoomPortals(CAU_VONG_ROUTE_SCENE, room))
      add(portal.target.room, `98:${room} bệ (${portal.x},${portal.y})`, { x: portal.arrival.x, y: portal.arrival.y });
  }
  return out;
}

export function cauVongRoomReach(
  registry: StoryDataRegistry,
  room: number,
  asset: RoomAsset,
  map: MapCollision,
  arrivals: Arrival[],
  rides: readonly number[],
  /** `cau-vong-world/collision.json`: only an actor the hero talks to has to be reachable. */
  talks: (actorId: number) => boolean = () => true,
): CauVongReach {
  const modes = [-1, ...rides].map(
    (active) => (terrain: number) =>
      cauVongMovementTerrain(
        terrain,
        { active, allowed: () => true, owned: () => true },
        { water: CV_WATER, plant: CV_PLANT, sky: CV_SKY },
      ),
  );
  const step = (x: number, y: number, direction: number) => {
    for (const terrain of modes) {
      const to = stepWithTerrain(map, x, y, direction, false, 4, terrain);
      if (to.moved && cauVongEdgeClear(map, to, terrain)) return to;
    }
    return null;
  };
  const flood = (start: Point) => {
    const seen = new Map<string, Point>([[`${start.x},${start.y}`, start]]),
      queue = [start];
    for (let head = 0; head < queue.length && head < 300000; head++)
      for (const direction of [0, 1, 2, 3]) {
        const to = step(queue[head].x, queue[head].y, direction);
        if (!to) continue;
        const key = `${to.x},${to.y}`;
        if (seen.has(key)) continue;
        const point = { x: to.x, y: to.y };
        seen.set(key, point);
        queue.push(point);
      }
    return [...seen.values()];
  };
  const tile = (x: number, y: number) => ({ x: x * 20, y: y * 20, width: 20, height: 20 }),
    exits = [
      ...sourceRoomDoors(registry, CAU_VONG_ROUTE_SCENE, room).map((d) => ({
        rect: tile(d.x, d.y),
        label: `cửa ô (${d.x},${d.y}) → 98:${d.target.room}`,
      })),
      ...sourceRoomPortals(CAU_VONG_ROUTE_SCENE, room).map((p) => ({
        rect: tile(p.x, p.y),
        label: `bệ ô (${p.x},${p.y}) → 98:${p.target.room}`,
      })),
    ],
    floods = arrivals.map((a) => flood(a.at)),
    all = floods.flat(),
    findings: ReachFinding[] = [],
    hits = (points: Point[], rect: { x: number; y: number; width: number; height: number }) =>
      points.some((p) => playerIntersectsSourceRect(p.x, p.y, rect));
  if (arrivals.length) {
    for (const exit of exits)
      if (!hits(all, exit.rect))
        findings.push({ kind: "door", at: { x: exit.rect.x + 10, y: exit.rect.y + 10 }, text: `98:${room} ${exit.label}: không tới được` });
    arrivals.forEach((a, i) => {
      if (exits.length && !exits.some((exit) => hits(floods[i], exit.rect)))
        findings.push({ kind: "stuck", at: a.at, text: `98:${room} vào từ ${a.from} tại (${a.at.x},${a.at.y}): kẹt, không ra được cửa nào` });
      if (floods[i].length <= 1)
        findings.push({ kind: "stuck", at: a.at, text: `98:${room} vào từ ${a.from} tại (${a.at.x},${a.at.y}): đứng trên ô chặn, không bước được` });
    });
    for (const actor of asset.actors) {
      // sprite 223 is the /4 placeholder seat; the dressed cast (`applyCauVongActors`) has its own.
      if (!actor.visible || actor.sprite === 223 || actor.sourceKind === 1 || !talks(actor.id)) continue;
      let best = Infinity;
      for (const p of all) best = Math.min(best, Math.max(Math.abs(p.x - actor.x), Math.abs(p.y - actor.y)));
      if (best > 32)
        findings.push({ kind: "actor", at: { x: actor.x, y: actor.y }, text: `98:${room} NPC ${actor.id} (hình ${actor.sprite}) tại (${actor.x},${actor.y}): không tới gần được, gần nhất ${best}px` });
    }
  }
  return { arrivals, reached: all, doors: exits.map((e) => ({ x: e.rect.x + 10, y: e.rect.y + 10, label: e.label })), findings };
}
