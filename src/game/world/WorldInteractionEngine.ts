// JavaSE parity: vqsv/world/WorldInteractionEngine.evaluate and
// vqsv/game/VqsvFreeWorldRuntime.playerIntersectsSourceRect.
// Source masks are not exported yet, so every query takes Java's box fallback path.
import {
  DIRECTION_DOWN,
  DIRECTION_LEFT,
  DIRECTION_RIGHT,
  DIRECTION_UP,
  PLAYER_HALF_SIZE,
} from "./MapCollision";

export const INTERACTION_OFFSET = 4;
export const ACTOR_HALF_WIDTH = 12;
export const ACTOR_HALF_HEIGHT = 16;
export type SourceRect = { x: number; y: number; width: number; height: number };

/** WorldInteractionEngine offsets the player box 4px ahead of the facing direction. */
export function interactionOrigin(
  x: number,
  y: number,
  direction: number,
): { x: number; y: number } {
  if (direction === DIRECTION_DOWN) return { x, y: y + INTERACTION_OFFSET };
  if (direction === DIRECTION_RIGHT) return { x: x + INTERACTION_OFFSET, y };
  if (direction === DIRECTION_UP) return { x, y: y - INTERACTION_OFFSET };
  if (direction === DIRECTION_LEFT) return { x: x - INTERACTION_OFFSET, y };
  return { x, y };
}

/** Java's box fallback: the player's 16x16 body against an actor's 24x32 body. */
export function intersectsActorBox(
  centerX: number,
  centerY: number,
  actorX: number,
  actorY: number,
): boolean {
  const left = centerX - PLAYER_HALF_SIZE,
    right = centerX - PLAYER_HALF_SIZE + PLAYER_HALF_SIZE * 2,
    top = centerY - PLAYER_HALF_SIZE,
    bottom = centerY - PLAYER_HALF_SIZE + PLAYER_HALF_SIZE * 2;
  return (
    actorX + ACTOR_HALF_WIDTH >= left &&
    actorX - ACTOR_HALF_WIDTH <= right &&
    actorY + ACTOR_HALF_HEIGHT >= top &&
    actorY - ACTOR_HALF_HEIGHT <= bottom
  );
}

export function playerInteractsActor(
  x: number,
  y: number,
  direction: number,
  actor: { x: number; y: number; visible: boolean },
): boolean {
  if (!actor.visible) return false;
  const origin = interactionOrigin(x, y, direction);
  return intersectsActorBox(origin.x, origin.y, actor.x, actor.y);
}

export function playerIntersectsActor(
  x: number,
  y: number,
  actor: { x: number; y: number; visible: boolean },
): boolean {
  if (!actor.visible) return false;
  return intersectsActorBox(x, y, actor.x, actor.y);
}

export function playerIntersectsSourceRect(x: number, y: number, rect: SourceRect): boolean {
  const left = x - PLAYER_HALF_SIZE,
    right = left + PLAYER_HALF_SIZE * 2,
    top = y - PLAYER_HALF_SIZE,
    bottom = top + PLAYER_HALF_SIZE * 2;
  return (
    rect.x + rect.width >= left &&
    rect.x <= right &&
    rect.y <= bottom &&
    rect.y + rect.height >= top
  );
}

/**
 * `VqsvFreeWorldRuntime.playerSourcePointInRect`: the player's raw source point inside an inclusive
 * rectangle, with no 16px body box. The padded box would catch the path leading up to a door tile.
 */
export function playerSourcePointInRect(x: number, y: number, rect: SourceRect): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/**
 * `WorldEngine`'s actor test with the interactive fallback mask (`{-12, -16, 24, 32}`): a step is
 * refused when the player's box would overlap the actor, unless it takes the player's centre away
 * from the actor's (`movesAwayFromActor`), so a hero already touching one can always back off.
 */
export function actorBlocksStep(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  actor: { x: number; y: number },
): boolean {
  if (!intersectsActorBox(toX, toY, actor.x, actor.y)) return false;
  const before = (fromX - actor.x) ** 2 + (fromY - actor.y) ** 2,
    after = (toX - actor.x) ** 2 + (toY - actor.y) ** 2,
    crosses = (a: number, b: number) => (a < 0 && b > 0) || (a > 0 && b < 0);
  const away =
    after > before ||
    (after === before &&
      (crosses(fromX - actor.x, toX - actor.x) || crosses(fromY - actor.y, toY - actor.y)));
  return !away;
}
