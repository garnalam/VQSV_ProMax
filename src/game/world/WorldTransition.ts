// JavaSE parity: WorldTransitionEngine.requiredDirection plus the kind-1 actor columns
// (game.h.D / game.l.ad) that the decoded rooms already carry; and for the Cầu Vồng chapter,
// CauVongFourGateRoutes.exitTo's /4 table 1. Doors are read from data, so no per-scene
// transition table is authored here.
import type { StoryDataRegistry } from "../story/StoryDataRegistry";
import type { RoomAsset } from "../story/GameAssets";
import type { EventStateLedger } from "./EventStateLedger";
import {
  DIRECTION_DOWN,
  DIRECTION_LEFT,
  DIRECTION_RIGHT,
  DIRECTION_UP,
  PLAYER_HALF_SIZE,
} from "./MapCollision";
import { intersectsActorBox } from "./WorldInteractionEngine";

const SOURCE_PLAYER_GRID = 8;
const SOURCE_INWARD_DISTANCE = 32;
const APPROX_SNAP_GRID = 16;
const NARROW_GATE_SPRITE = 222;
const NARROW_GATE_INWARD_DISTANCE = 24;
/** Cầu Vồng's /4 table works in 20px tiles: centre on x, source foot line on y, one tile of give. */
const SOURCE_TILE = 20;
const SOURCE_TILE_CENTER = 10;
const SOURCE_TILE_FEET = 19;

/** Source columns number directions UP, LEFT, DOWN, RIGHT; the engine uses DOWN, RIGHT, UP, LEFT. */
export function sourceDirectionToEngine(sourceDirection: number): number {
  return [DIRECTION_UP, DIRECTION_LEFT, DIRECTION_DOWN, DIRECTION_RIGHT][sourceDirection] ?? -1;
}

export type SourceDoor = {
  actorId: number;
  sprite: number;
  x: number;
  y: number;
  sourceDirection: number;
  requiredDirection: number;
  directionAgnostic: boolean;
  target: { scene: number; room: number; actor: number };
  /** Column 6, the source behavior: 4 is a vortex (`game.h` behavior4) when it leads into its own room. */
  behavior?: number;
};
export type TransitionMarker = { x: number; y: number; sprite: number; direction: number };
/** The room extent; an APK map starts at `-origin` (GameAssets.prepareMap). */
export type MapBounds = { width: number; height: number; originX?: number; originY?: number };

/** Kind-1 actor rows are the door markers: id is the row index, columns 7..10 are D, scene, room, actor. */
export function sourceDoors(
  registry: StoryDataRegistry,
  scene: number,
  room: number,
): SourceDoor[] {
  const doors: SourceDoor[] = [];
  (registry.room(scene, room)?.actors ?? []).forEach((row, actorId) => {
    const v = row.values;
    if (row.kind !== 1 || v.length < 11) return;
    const requiredDirection = sourceDirectionToEngine(v[7]);
    if (requiredDirection < 0 || !Number.isInteger(v[8]) || !Number.isInteger(v[9])) return;
    doors.push({
      actorId,
      sprite: v[1],
      x: v[3],
      y: v[4],
      sourceDirection: v[7],
      requiredDirection,
      directionAgnostic: v[1] === 310 || v[1] === 320 || v[6] === 4,
      target: { scene: v[8], room: v[9], actor: v[10] },
      behavior: v[6],
    });
  });
  return doors;
}

/** Type-1 markers bypass render visibility, so the query is the plain intersection box. */
export function doorOverlaps(view: { x: number; y: number }, door: SourceDoor): boolean {
  return intersectsActorBox(view.x, view.y, door.x, door.y);
}

/** The bundled lib declarations omit Math.floorMod, so the snap uses the equivalent expression. */
const floorMod = (value: number, modulus: number): number =>
  ((value % modulus) + modulus) % modulus;

const directionDx = (direction: number, amount: number): number =>
  direction === DIRECTION_RIGHT ? amount : direction === DIRECTION_LEFT ? -amount : 0;
const directionDy = (direction: number, amount: number): number =>
  direction === DIRECTION_DOWN ? amount : direction === DIRECTION_UP ? -amount : 0;

/**
 * game.l.ad() snaps the arrival marker to the 8px player grid, then steps the player
 * inward so the first movement input cannot slide them back through the doorway.
 */
export function transitionArrival(
  marker: TransitionMarker,
  bounds?: MapBounds,
): { x: number; y: number; direction: number } {
  const inward =
      marker.sprite === NARROW_GATE_SPRITE ? NARROW_GATE_INWARD_DISTANCE : SOURCE_INWARD_DISTANCE,
    x = marker.x - floorMod(marker.x, SOURCE_PLAYER_GRID) + directionDx(marker.direction, inward),
    y = marker.y - floorMod(marker.y, SOURCE_PLAYER_GRID) + directionDy(marker.direction, inward);
  return {
    x: clampToWorldAxis(x, bounds?.width, bounds?.originX),
    y: clampToWorldAxis(y, bounds?.height, bounds?.originY),
    direction: marker.direction,
  };
}

/**
 * The arrival reads the target room's own kind-1 row, because its D column is the facing
 * out of that doorway. A target that is not a door row keeps Java's approx path: 16px grid
 * snap and the actor's own facing.
 */
export function transitionArrivalForTarget(
  registry: StoryDataRegistry,
  targetRoom: RoomAsset,
  target: SourceDoor["target"],
): { x: number; y: number; direction: number } | null {
  const marker = targetRoom.actors.find((actor) => actor.id === target.actor);
  if (!marker) return null;
  const door = sourceDoors(registry, target.scene, target.room).find(
    (candidate) => candidate.actorId === target.actor,
  );
  if (door)
    return transitionArrival(
      { x: marker.x, y: marker.y, sprite: marker.sprite, direction: door.sourceDirection },
      targetRoom,
    );
  return {
    x: clampToWorldAxis(
      marker.x - floorMod(marker.x, APPROX_SNAP_GRID),
      targetRoom.width,
      targetRoom.originX,
    ),
    y: clampToWorldAxis(
      marker.y - floorMod(marker.y, APPROX_SNAP_GRID),
      targetRoom.height,
      targetRoom.originY,
    ),
    direction: marker.direction,
  };
}

/** Cầu Vồng's /4 table 1 row: a door tile and the destination room's own door row it lands on. */
export type RoomDoor = {
  scene: number;
  room: number;
  row: number;
  x: number;
  y: number;
  facing: number;
  target: { scene: number; room: number; entry: number };
};

/**
 * `CauVongFourGateRoutes.exitTo`'s authored door rules, kept as data so the loop stays generic:
 * a `(room, target)` pair that needs a completed event before it opens, and the `only` flag for the
 * three rooms whose owner adopts one native connection at a time, so every other table row in that
 * room stays closed. `oracle/cau-vong-doors.test.mjs` re-reads that method and the chapter owners
 * and fails if these rules ever change there.
 */
export type RoomDoorRule = {
  room: number;
  target: number;
  requires?: { room: number; event: number };
  only?: boolean;
};
export const CAU_VONG_DOOR_RULES: readonly RoomDoorRule[] = [
  { room: 6, target: 10, requires: { room: 9, event: 102 }, only: true },
  { room: 3, target: 9, requires: { room: 3, event: 102 }, only: true },
  { room: 10, target: 6, only: true },
  { room: 13, target: 14, requires: { room: 13, event: 100 } },
  { room: 57, target: 58, requires: { room: 57, event: 101 } },
];

/**
 * `CauVongFourGateRoutes.PORTALS`, row for row: room, pad tile x/y, destination room, arrival tile
 * x/y, direction, then the gate's room and event; a gate room of -1 is an open pad. The arrival
 * tiles are the source script's last teleport target, so a pad never drops the player on its own
 * trigger tile.
 */
export const CAU_VONG_PORTAL_ROWS: readonly (readonly number[])[] = [
  [9, 17, 20, 12, 1, 15, 0, -1, -1],
  [9, 2, 20, 21, 10, 6, 0, 9, 101],
  [9, 2, 4, 16, 3, 6, 0, 9, 103],
  [9, 17, 4, 24, 24, 25, 0, 9, 104],
  [12, 1, 13, 9, 17, 22, 0, -1, -1],
  [16, 3, 4, 9, 2, 6, 0, -1, -1],
  [21, 10, 4, 9, 2, 22, 0, -1, -1],
  [24, 24, 23, 9, 17, 6, 0, -1, -1],
  [15, 12, 3, 9, 17, 22, 0, 15, 100],
  [23, 12, 4, 9, 2, 22, 0, 23, 100],
  [20, 8, 11, 9, 2, 6, 0, 20, 100],
  [19, 7, 5, 57, 3, 16, 1, 19, 100],
  [57, 1, 15, 19, 7, 7, 0, 57, 100],
];

/**
 * The chapter whose route owner reads `CAU_VONG_PORTAL_ROWS` (`CauVongChapterRuntime.SCENE_ID`).
 * Room indexes repeat across scenes, so without this a Liệt Hỏa room would inherit a pad it never had.
 */
export const CAU_VONG_ROUTE_SCENE = 98;

/** A pad from that table, resolved for one room. */
export type RoomPortal = {
  scene: number;
  room: number;
  x: number;
  y: number;
  target: { scene: number; room: number };
  arrival: { x: number; y: number; direction: number };
  requires?: { room: number; event: number };
};

export function sourceRoomPortals(scene: number, room: number): RoomPortal[] {
  if (scene !== CAU_VONG_ROUTE_SCENE) return [];
  return CAU_VONG_PORTAL_ROWS.filter((row) => row[0] === room).map((row) => ({
    scene,
    room,
    x: row[1],
    y: row[2],
    target: { scene, room: row[3] },
    arrival: {
      x: row[4] * SOURCE_TILE + SOURCE_TILE_CENTER,
      y: row[5] * SOURCE_TILE + SOURCE_TILE_FEET,
      direction: row[6],
    },
    ...(row[7] >= 0 ? { requires: { room: row[7], event: row[8] } } : {}),
  }));
}

/** Java's `playerSourcePointInRect(p[1]*20, p[2]*20, 20, 20)`: the pad's own tile. */
export const roomPortalTriggerRect = (portal: RoomPortal) => ({
  x: portal.x * SOURCE_TILE,
  y: portal.y * SOURCE_TILE,
  width: SOURCE_TILE,
  height: SOURCE_TILE,
});

export function roomPortalUnlocked(
  ledger: EventStateLedger,
  scene: number,
  portal: RoomPortal,
): boolean {
  return (
    !portal.requires ||
    ledger.sourceEventStateComplete(scene, portal.requires.room, portal.requires.event)
  );
}

/**
 * A row whose destination is out of range is inert here. Java treats the same row as a data error and
 * throws, which is how the four shop rooms stay off this loop - their owners place the player
 * themselves - and a browser frame has no business throwing over a byte.
 */
export function sourceRoomDoors(
  registry: StoryDataRegistry,
  scene: number,
  room: number,
): RoomDoor[] {
  return (registry.room(scene, room)?.doors ?? [])
    .filter((door) => door.target !== undefined)
    .map((door) => ({
      scene,
      room,
      row: door.row,
      x: door.x,
      y: door.y,
      facing: door.facing,
      target: door.target!,
    }))
    .filter((door) => {
      const destination = roomDoorRow(
        registry,
        door.target.scene,
        door.target.room,
        door.target.entry,
      );
      return !!destination && nativeFacingToEngineDirection(destination.facing) >= 0;
    });
}

/** Java's `playerSourcePointInRect(door[0]*20, door[1]*20, 20, 20)`: the door's own tile. */
export const roomDoorTriggerRect = (door: RoomDoor) => ({
  x: door.x * SOURCE_TILE,
  y: door.y * SOURCE_TILE,
  width: SOURCE_TILE,
  height: SOURCE_TILE,
});

/** One room's door row by index - the arrival half of the same table. */
export function roomDoorRow(
  registry: StoryDataRegistry,
  scene: number,
  room: number,
  entry: number,
): RoomDoor | null {
  const door = (registry.room(scene, room)?.doors ?? []).find(
    (candidate) => candidate.row === entry,
  );
  if (!door || !door.target) return null;
  return {
    scene,
    room,
    row: door.row,
    x: door.x,
    y: door.y,
    facing: door.facing,
    target: door.target,
  };
}

/** The /4 table's facing column is 1-based and in source order: DOWN, UP, RIGHT, LEFT. */
export function nativeFacingToEngineDirection(facing: number): number {
  switch (facing) {
    case 1:
      return DIRECTION_DOWN;
    case 2:
      return DIRECTION_UP;
    case 3:
      return DIRECTION_RIGHT;
    case 4:
      return DIRECTION_LEFT;
    default:
      return -1;
  }
}

/**
 * The destination row's own tile, one centre in, then one tile back along the facing out of that
 * doorway - so the first step after arrival cannot slide the player straight back through it.
 */
export function roomDoorArrival(row: RoomDoor): { x: number; y: number; direction: number } {
  const direction = nativeFacingToEngineDirection(row.facing);
  return {
    x:
      row.x * SOURCE_TILE +
      SOURCE_TILE_CENTER +
      (direction === DIRECTION_RIGHT
        ? SOURCE_TILE
        : direction === DIRECTION_LEFT
          ? -SOURCE_TILE
          : 0),
    y:
      row.y * SOURCE_TILE +
      SOURCE_TILE_FEET +
      (direction === DIRECTION_DOWN ? SOURCE_TILE : direction === DIRECTION_UP ? -SOURCE_TILE : 0),
    direction,
  };
}

/**
 * Where the table says the hero lands when a room is entered: the destination row of the lowest
 * door that points at it. A room no door points at has no source arrival to place anyone in.
 */
export function roomEntryArrival(
  registry: StoryDataRegistry,
  scene: number,
  room: number,
): { x: number; y: number; direction: number } | null {
  const candidates = [...(registry.scene(scene)?.rooms ?? [])].sort(
    (a, b) => a.roomIndex - b.roomIndex,
  );
  for (const candidate of candidates)
    for (const door of candidate.doors ?? []) {
      if (door.target?.room !== room || door.target.scene !== scene) continue;
      const row = roomDoorRow(registry, scene, room, door.target.entry);
      if (row && nativeFacingToEngineDirection(row.facing) >= 0) return roomDoorArrival(row);
    }
  return null;
}

/** Java's authored skip conditions: an empty ledger leaves exactly the doors Java starts with shut. */
export function roomDoorUnlocked(
  ledger: EventStateLedger,
  scene: number,
  room: number,
  target: number,
  rules: readonly RoomDoorRule[] = CAU_VONG_DOOR_RULES,
): boolean {
  for (const rule of rules) {
    if (rule.room !== room) continue;
    if (rule.only && rule.target !== target) return false;
    if (
      rule.target === target &&
      rule.requires &&
      !ledger.sourceEventStateComplete(scene, rule.requires.room, rule.requires.event)
    )
      return false;
  }
  return true;
}

function clampToWorldAxis(value: number, extent: number | undefined, origin = 0): number {
  if (extent === undefined) return value;
  const margin = Math.max(0, Math.min(PLAYER_HALF_SIZE, Math.floor(extent / 2)));
  return Math.max(margin - origin, Math.min(value, extent - origin - margin));
}
