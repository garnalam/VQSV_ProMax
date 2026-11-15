// JavaSE parity: vqsv/game/VqsvFreeWorldRuntime tryStartSourceLeafRide / tickSourceLeafRide and the
// platform shore helpers (Bích Thủy's lotus leaves, Bích Lam Cốc's clouds).
import type { CollisionMask } from "../story/GameAssets";
import { terrainAtWorld, type MapCollision } from "./MapCollision";
import { DIRECTION_DOWN, DIRECTION_LEFT, DIRECTION_RIGHT, DIRECTION_UP } from "./MapCollision";
import { PUZZLE_FALLBACK_MASK } from "./ActorCollision";

/** Behaviour 9 rides left/right, behaviour 10 up/down. */
export const PLATFORM_HORIZONTAL = 9;
export const PLATFORM_VERTICAL = 10;
/** `movePlayerUnchecked(s, direction, 4)` and the platform's own 4 px a tick. */
export const PLATFORM_SPEED = 4;
/** `sourceLeafRideTicks = 7`: the boarding and landing steps. */
export const PLATFORM_STEP_TICKS = 7;

export type PlatformActor = { x: number; y: number; sprite: number; variant: number };

export const isPlatform = (actor: { sourceKind?: number; variant: number }): boolean =>
  actor.sourceKind === 0 &&
  (actor.variant === PLATFORM_HORIZONTAL || actor.variant === PLATFORM_VERTICAL);

/** `sourcePlatformTravelTerrain`: clouds (sprites 298/302) sail over terrain 1, leaves over water (2). */
export function platformTravelTerrain(actor: PlatformActor): number {
  return actor.sprite === 298 || actor.sprite === 302 ? 1 : 2;
}

/** `sourcePlatformCanAdvance`. */
export function platformCanAdvance(actor: PlatformActor, terrain: number): boolean {
  return terrain === 2 || (terrain === 1 && (actor.sprite === 298 || actor.sprite === 302));
}

export const directionDx = (direction: number, amount: number): number =>
  direction === DIRECTION_RIGHT ? amount : direction === DIRECTION_LEFT ? -amount : 0;
export const directionDy = (direction: number, amount: number): number =>
  direction === DIRECTION_DOWN ? amount : direction === DIRECTION_UP ? -amount : 0;

/** The point `platformTerrainAhead` samples: just past the platform's leading edge. */
export function platformAheadPoint(
  mask: CollisionMask | null,
  x: number,
  y: number,
  direction: number,
  speed = PLATFORM_SPEED,
): { x: number; y: number } | null {
  const [, , width, height] = mask ?? PUZZLE_FALLBACK_MASK;
  if (direction === DIRECTION_DOWN) return { x, y: y + speed };
  if (direction === DIRECTION_RIGHT) return { x: x + speed + Math.trunc(width / 2), y };
  if (direction === DIRECTION_UP) return { x, y: y - height - speed };
  if (direction === DIRECTION_LEFT) return { x: x - speed - Math.trunc(width / 2), y };
  return null;
}

/** `sourcePlatformTerrainAhead`: the terrain just past the platform's leading edge. */
export function platformTerrainAhead(
  map: MapCollision,
  mask: CollisionMask | null,
  x: number,
  y: number,
  direction: number,
  speed = PLATFORM_SPEED,
): number {
  const at = platformAheadPoint(mask, x, y, direction, speed);
  return at ? terrainAtWorld(map, at.x, at.y) : -1;
}

/**
 * Web fix: the land a hero standing at (x, y) can walk to, as tile keys (terrain neither blocked
 * nor gated). Used to bring a gym cloud to the island the hero is on.
 */
export function walkableArea(map: MapCollision, x: number, y: number): Set<string> {
  const tile = map.tileSize,
    key = (tx: number, ty: number) => `${tx},${ty}`,
    walkable = (tx: number, ty: number) => {
      const t = terrainAtWorld(map, tx * tile + tile / 2, ty * tile + tile / 2);
      return t !== 1 && t !== 2;
    },
    left = Math.floor(-(map.originX ?? 0) / tile),
    top = Math.floor(-(map.originY ?? 0) / tile),
    right = left + map.widthTiles,
    bottom = top + map.heightTiles,
    seen = new Set<string>(),
    start: [number, number] = [Math.floor(x / tile), Math.floor(y / tile)];
  if (!walkable(...start)) return seen;
  const queue = [start];
  seen.add(key(...start));
  while (queue.length) {
    const [tx, ty] = queue.pop()!;
    for (const [nx, ny] of [
      [tx + 1, ty],
      [tx - 1, ty],
      [tx, ty + 1],
      [tx, ty - 1],
    ] as const) {
      if (nx < left || ny < top || nx >= right || ny >= bottom || seen.has(key(nx, ny))) continue;
      if (!walkable(nx, ny)) continue;
      seen.add(key(nx, ny));
      queue.push([nx, ny]);
    }
  }
  return seen;
}

/**
 * `sourcePlatformEndpointFromCanonical`: where a platform starting on its room row comes to rest
 * when it sails `direction` until the terrain ahead stops it.
 */
export function platformShore(
  map: MapCollision,
  actor: PlatformActor,
  mask: CollisionMask | null,
  row: { x: number; y: number },
  direction: number,
): { x: number; y: number } {
  let x = row.x,
    y = row.y;
  for (let step = 0; step < 512; step++) {
    if (!platformCanAdvance(actor, platformTerrainAhead(map, mask, x, y, direction))) break;
    x += directionDx(direction, PLATFORM_SPEED);
    y += directionDy(direction, PLATFORM_SPEED);
  }
  return { x, y };
}

/**
 * Web fix: whether a remembered platform spot still lies on the track its row sails today. Saves
 * written before the APK landscape maps keep JAR-map spots, which on the new map can float off the
 * track (a cloud beside nothing, or out of view); such a spot is dropped and the row is used.
 */
export function platformSpotOnTrack(
  map: MapCollision | undefined,
  row: PlatformActor,
  mask: CollisionMask | null,
  at: { x: number; y: number },
): boolean {
  const horizontal = row.variant === PLATFORM_HORIZONTAL;
  // Before the room's terrain has loaded (a resumed save), the axis alone already tells.
  if (!map) return horizontal ? at.y === row.y : at.x === row.x;
  const low = platformShore(map, row, mask, row, horizontal ? DIRECTION_LEFT : DIRECTION_UP),
    high = platformShore(map, row, mask, row, horizontal ? DIRECTION_RIGHT : DIRECTION_DOWN),
    slack = PLATFORM_SPEED;
  return horizontal
    ? at.y === row.y && at.x >= low.x - slack && at.x <= high.x + slack
    : at.x === row.x && at.y >= low.y - slack && at.y <= high.y + slack;
}

/** `downstreamLeafEndpoint`: a lotus leaf's lower shore — down the water until it is left. */
export function downstreamLeafShore(map: MapCollision, row: { x: number; y: number }) {
  const x = row.x;
  let y = row.y;
  for (let step = 0; step < 512; step++) {
    const nextY = y + 4,
      terrain = terrainAtWorld(map, x, nextY);
    if (terrain === 1) break;
    y = nextY;
    if (terrain !== 2) break;
  }
  return { x, y };
}

/** One ride in progress: 0 boarding, 1 sailing, 2 landing (`sourceLeafRidePhase`). */
export type PlatformRideState = {
  actorId: number;
  direction: number;
  phase: 0 | 1 | 2;
  ticks: number;
};
