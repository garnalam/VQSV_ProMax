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

/** `sourcePlatformTerrainAhead`: the terrain just past the platform's leading edge. */
export function platformTerrainAhead(
  map: MapCollision,
  mask: CollisionMask | null,
  x: number,
  y: number,
  direction: number,
  speed = PLATFORM_SPEED,
): number {
  const [, , width, height] = mask ?? PUZZLE_FALLBACK_MASK;
  let sampleX = x,
    sampleY = y;
  if (direction === DIRECTION_DOWN) sampleY += speed;
  else if (direction === DIRECTION_RIGHT) sampleX += speed + Math.trunc(width / 2);
  else if (direction === DIRECTION_UP) sampleY -= height + speed;
  else if (direction === DIRECTION_LEFT) sampleX -= speed + Math.trunc(width / 2);
  else return -1;
  return terrainAtWorld(map, sampleX, sampleY);
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
