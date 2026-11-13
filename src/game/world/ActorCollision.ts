// JavaSE parity: vqsv/world/WorldEngine.blockedByActor and the snapshot
// vqsv/game/VqsvFreeWorldRuntime.actorLookup builds for it.
import type { CollisionMask } from "../story/GameAssets";
import { DIRECTION_DOWN, DIRECTION_LEFT, DIRECTION_RIGHT, DIRECTION_UP } from "./MapCollision";

/** `WorldEngine.INTERACTIVE_ACTOR_FALLBACK_COLLISION`, for a person or pet whose cell has no mask. */
const INTERACTIVE_ACTOR_FALLBACK: CollisionMask = [-12, -16, 24, 32];

/** One room actor as `WorldEngine.ActorSnapshot` sees it, after the runtime's overrides. */
export type ActorSnapshot = {
  visible: boolean;
  kind: number;
  behavior: number;
  x: number;
  y: number;
  mask: CollisionMask | null;
};

/** `WorldEngine.staticSourceActorBlocks`. */
export function staticSourceActorBlocks(kind: number, behavior: number): boolean {
  if (kind === 0) return behavior === 0 || behavior === 1 || behavior === 7 || behavior === 18;
  if (kind === 1) return behavior === 3;
  return kind === 3;
}

function collisionMaskFor(actor: ActorSnapshot): CollisionMask | null {
  if (actor.mask) return actor.mask;
  if (actor.kind === 0 && (actor.behavior === 1 || actor.behavior === 18))
    return INTERACTIVE_ACTOR_FALLBACK;
  return null;
}

/** `WorldEngine.sourceMaskOverlap`: inclusive on every edge. */
export function sourceMaskOverlap(
  playerX: number,
  playerY: number,
  playerMask: CollisionMask,
  actorX: number,
  actorY: number,
  actorMask: CollisionMask,
): boolean {
  return (
    playerX + playerMask[0] + playerMask[2] >= actorX + actorMask[0] &&
    playerX + playerMask[0] <= actorX + actorMask[0] + actorMask[2] &&
    playerY + playerMask[1] <= actorY + actorMask[1] + actorMask[3] &&
    playerY + playerMask[1] + playerMask[3] >= actorY + actorMask[1]
  );
}

/**
 * `WorldEngine.movesAwayFromActor`: a hero already overlapping an actor (a terrain slide, a restored
 * save) may always take the step that carries the centre of its mask away from the actor's, or the
 * one equal-distance step across the actor's centre.
 */
function movesAwayFromActor(
  x: number,
  y: number,
  nextX: number,
  nextY: number,
  playerMask: CollisionMask,
  actorX: number,
  actorY: number,
  actorMask: CollisionMask,
): boolean {
  const ax = 2 * (actorX + actorMask[0]) + actorMask[2],
    ay = 2 * (actorY + actorMask[1]) + actorMask[3],
    cx = 2 * (x + playerMask[0]) + playerMask[2] - ax,
    cy = 2 * (y + playerMask[1]) + playerMask[3] - ay,
    nx = 2 * (nextX + playerMask[0]) + playerMask[2] - ax,
    ny = 2 * (nextY + playerMask[1]) + playerMask[3] - ay,
    current = cx * cx + cy * cy,
    next = nx * nx + ny * ny,
    crosses = (a: number, b: number) => (a < 0 && b > 0) || (a > 0 && b < 0);
  return next > current || (next === current && (crosses(cx, nx) || crosses(cy, ny)));
}

/**
 * `WorldEngine.blockedByActor`: the straight step (before any terrain slide) is refused when the
 * hero's mask would overlap a visible blocking actor's, unless it moves the hero away from it.
 */
export function blockedByActor(
  x: number,
  y: number,
  direction: number,
  speed: number,
  playerMask: CollisionMask | null,
  actors: Iterable<ActorSnapshot>,
): boolean {
  let nextX = x,
    nextY = y;
  if (direction === DIRECTION_DOWN) nextY += speed;
  else if (direction === DIRECTION_RIGHT) nextX += speed;
  else if (direction === DIRECTION_UP) nextY -= speed;
  else if (direction === DIRECTION_LEFT) nextX -= speed;
  else return false;
  if (!playerMask) return false;
  for (const actor of actors) {
    if (!actor.visible || !staticSourceActorBlocks(actor.kind, actor.behavior)) continue;
    const mask = collisionMaskFor(actor);
    if (!mask || !sourceMaskOverlap(nextX, nextY, playerMask, actor.x, actor.y, mask)) continue;
    const already = sourceMaskOverlap(x, y, playerMask, actor.x, actor.y, mask);
    if (!already || !movesAwayFromActor(x, y, nextX, nextY, playerMask, actor.x, actor.y, mask))
      return true;
  }
  return false;
}

/** A room actor and the runtime state the per-room movement rules read. */
export type MovementActor = {
  id: number;
  sprite: number;
  kind: number;
  behavior: number;
  /** The source marker animation (`sourceMarkerAnimation`); 0 when the row has none. */
  marker: number;
  mask: CollisionMask | null;
  /** A trainer whose fights are all won (`*Runtime.completedTrainerIsPassable`). */
  beaten: boolean;
  /** An uncleared Đại Địa Chương rock (`VqsvSourceWorldObstacleRuntime.blocksMovement`). */
  rockBlocks: boolean;
};

/**
 * The movement behaviour `VqsvFreeWorldRuntime.actorLookup` hands `WorldEngine` for a room actor,
 * in Java's order, before the challenge gate (`BattleNpcProximityGate.movementBehavior`) the
 * caller applies last.
 */
export function movementBehavior(scene: number, room: number, actor: MovementActor): number {
  const { id, sprite, kind, mask } = actor;
  let behavior = actor.behavior;
  // `VqsvSourceLaserRuntime.isLaser`: a laser beam is a wall.
  if (kind === 0 && behavior === 14) behavior = 0;
  // Bích Lam Cốc's laser rooms: movable mirrors (8) and fixed emitters (11) are walls.
  if (scene === 10 && room >= 1 && room <= 4 && kind === 0 && (behavior === 8 || behavior === 11))
    behavior = 0;
  // A beaten trainer keeps its actor and its dialogue, but no longer seals the route.
  if (behavior === 1 && actor.beaten) behavior = 2;
  // 10:12 actor 29 (sprite 133) has no mask: no invisible wall before opcode13 [160,80,64,16].
  if (
    scene === 10 &&
    room === 12 &&
    id === 29 &&
    sprite === 133 &&
    kind === 0 &&
    behavior === 1 &&
    !mask
  )
    behavior = 2;
  // 3:7's start barriers are owned walls; no other behavior6 actor is one.
  if (scene === 3 && room === 7 && (id === 0 || id === 1) && kind === 0 && behavior === 6)
    behavior = 0;
  if (kind === 0 && behavior === 6 && actor.rockBlocks) behavior = 0;
  // 3:6's decorative dock birds (sprite 140, no mask) leave the route to Yafei open.
  if (
    scene === 3 &&
    room === 6 &&
    [38, 39, 40, 44, 45, 46].includes(id) &&
    sprite === 140 &&
    kind === 0 &&
    behavior === 1 &&
    !mask
  )
    behavior = 2;
  // 3:7's finish marker keeps its mask but never blocked in the source.
  if (scene === 3 && room === 7 && id === 42 && sprite === 320 && kind === 0 && behavior === 0)
    behavior = 2;
  // `sourceMineDecorIsMovementPassable`: inert cave sprites; the terrain owns their collision.
  if (kind === 0 && actor.marker === 0) {
    const niemThoMine = scene === 4 && room >= 2 && room <= 4 && (sprite === 238 || sprite === 278);
    const iceDecor = scene === 10 && room === 0 && sprite === 278 && !mask;
    if (niemThoMine || iceDecor) behavior = 2;
  }
  return behavior;
}

/**
 * The trainers the chapter runtimes let the hero pass once their own fight is won
 * (`completedTrainerIsPassable` in NiemThoC3, HacThachC2, HacThachC3, PhoenixC3, BlcC3 and BlcC4):
 * `scene:room` → actor → the group that must be complete.
 */
const BEATEN_TRAINERS: Readonly<Record<string, Readonly<Record<number, number>>>> = {
  "9:2": { 10: 0 },
  "9:3": { 1: 0, 2: 1 },
  "9:4": { 2: 0, 4: 1, 1: 2, 3: 3 },
  "5:4": { 25: 0 },
  "9:5": { 23: 0, 22: 1, 24: 2, 21: 3 },
  "6:0": { 4: 0 },
  "9:6": { 13: 0, 12: 1, 11: 2 },
  "7:9": { 22: 1 },
  "7:10": { 16: 2 },
  "7:11": { 9: 0 },
  "7:12": { 24: 0, 26: 1 },
  "9:7": { 10: 0, 8: 1, 9: 2, 7: 3, 6: 4 },
};

/**
 * Whether a source actor that blocks as a person no longer does: its fight is won, or (BlcC2's
 * Ailie tableau, 7:4 actors 28 and 29) 7:4:g0 is complete or the main line has reached task 36.
 */
export function beatenTrainer(
  scene: number,
  room: number,
  actorId: number,
  complete: (group: number) => boolean,
  mainTaskProgress: number,
): boolean {
  if (scene === 7 && room === 4 && (actorId === 28 || actorId === 29))
    return complete(0) || mainTaskProgress >= 36;
  const group = BEATEN_TRAINERS[`${scene}:${room}`]?.[actorId];
  return group !== undefined && complete(group);
}

/** `VqsvSourceWorldObstacleRuntime.ROCK_BEHAVIOR` / `TREE_BEHAVIOR`. */
export const ROCK_BEHAVIOR = 6;
export const TREE_BEHAVIOR = 7;

/**
 * `VqsvSourceWorldObstacleRuntime.isOwnedObstacle`: a visible kind-0 tree (7) or rock (6) the
 * shared Mộc Quỳ / Đại Địa Chương owner clears. 3:7 uses both as race barriers (opcode60/80) and
 * 10:12's rocks are an atomic tableau, so those stay with their rooms. Cầu Vồng's rocks have their
 * own owner (`CauVongRockObstacles`).
 */
export function ownedObstacle(
  scene: number,
  room: number,
  actor: { visible: boolean; sourceKind?: number; variant: number },
): boolean {
  if (scene === 98 || !actor.visible || actor.sourceKind !== 0) return false;
  if (actor.variant === TREE_BEHAVIOR) return !(scene === 3 && room === 7);
  if (actor.variant === ROCK_BEHAVIOR)
    return !(scene === 3 && room === 7) && !(scene === 10 && room === 12);
  return false;
}

/** `VqsvSourceWorldObstacleRuntime.obstacleKey`: the `openedChests` key a cleared obstacle writes. */
export function obstacleKey(
  scene: number,
  room: number,
  actorId: number,
  behavior: number,
): string {
  return `${behavior === ROCK_BEHAVIOR ? "rock" : "tree"}:${scene}:${room}:${actorId}`;
}

/** `VqsvSourceLaserRuntime`: a kind-0 behaviour-14 actor is a laser emitter. */
export const LASER_BEHAVIOR = 14;
const LASER_SEGMENT = 16;

const laserDx = (direction: number, amount: number) =>
  direction === DIRECTION_RIGHT ? amount : direction === DIRECTION_LEFT ? -amount : 0;
const laserDy = (direction: number, amount: number) =>
  direction === DIRECTION_DOWN ? amount : direction === DIRECTION_UP ? -amount : 0;

/**
 * `VqsvSourceLaserRuntime.beamSegments`: how many 16 px segments the beam runs before a sample
 * lands in another actor's collision mask (any actor but a laser, hidden ones included) or on
 * terrain that is not open floor.
 */
export function laserBeamSegments(
  emitter: { x: number; y: number; direction: number },
  mapWidth: number,
  mapHeight: number,
  terrainAt: (x: number, y: number) => number,
  actors: Iterable<{ x: number; y: number; variant: number; mask: CollisionMask | null }>,
): number {
  const others = [...actors].filter((actor) => actor.variant !== LASER_BEHAVIOR && actor.mask),
    max = Math.trunc((mapWidth + mapHeight) / LASER_SEGMENT) + 2;
  for (let segments = 0; segments < max; segments++) {
    const distance = LASER_SEGMENT * (segments + 1),
      x = emitter.x + laserDx(emitter.direction, distance),
      y = emitter.y + laserDy(emitter.direction, distance);
    const hit = others.some(({ x: ax, y: ay, mask }) => {
      const [mx, my, mw, mh] = mask!;
      return x >= ax + mx && x <= ax + mx + mw && y >= ay + my && y <= ay + my + mh;
    });
    if (hit || terrainAt(x, y) !== 0) return segments;
  }
  return max;
}

/** `VqsvSourceLaserRuntime.expandedCollisionMask`: the emitter's mask stretched over its beam. */
export function laserCollisionMask(
  mask: CollisionMask,
  direction: number,
  segments: number,
): CollisionMask {
  const beam = segments * LASER_SEGMENT;
  let [x, y, width, height] = mask;
  if (direction === DIRECTION_RIGHT) width += beam;
  else if (direction === DIRECTION_LEFT) {
    x -= beam;
    width += beam;
  } else if (direction === DIRECTION_UP) {
    y -= beam;
    height += beam;
  } else if (direction === DIRECTION_DOWN) height += beam;
  return [x, y, width, height];
}

/** One beam as `VqsvSourceLaserRuntime.render` fills it: green outside, white core, in world px. */
export type LaserBeam = {
  vertical: boolean;
  /** The beam's start along its axis and its centre across it. */
  x: number;
  y: number;
  length: number;
  outer: number;
  inner: number;
};

/** `VqsvSourceLaserRuntime.render`: where the beam starts for each facing (`hitHeight` lifts it). */
export function laserBeam(
  emitter: { x: number; y: number; direction: number },
  segments: number,
  hitHeight: number,
  pulse: number,
): LaserBeam | null {
  const beam = segments * LASER_SEGMENT,
    outer = pulse + 5,
    inner = pulse + 3,
    { x, y, direction } = emitter;
  if (direction === DIRECTION_UP)
    return { vertical: true, x, y: y - hitHeight - beam + 8, length: beam, outer, inner };
  if (direction === DIRECTION_DOWN)
    return {
      vertical: true,
      x,
      y: y - hitHeight + 20,
      length: (segments + 1) * LASER_SEGMENT,
      outer,
      inner,
    };
  if (direction === DIRECTION_LEFT)
    return { vertical: false, x: x - 8 - beam, y: y - hitHeight + 13, length: beam, outer, inner };
  if (direction === DIRECTION_RIGHT)
    return { vertical: false, x: x + 7, y: y - hitHeight + 13, length: beam, outer, inner };
  return null;
}

/** `VqsvFreeWorldRuntime.BLC_PUZZLE_FALLBACK_MASK`: a pushed block with no mask of its own. */
export const PUZZLE_FALLBACK_MASK: CollisionMask = [-8, -8, 16, 16];
