import type { CollisionMask, SpriteFrame } from "../story/GameAssets";
import type { StoryActor } from "../story/StoryActor";

/** Displayed ink rectangle relative to an actor, using the same orientation as world rendering. */
export function worldPointerMask(
  actor: StoryActor,
  frame: SpriteFrame | undefined,
): CollisionMask | null {
  if (!frame) return null;
  const orientation =
    actor.renderOrientation !== undefined && actor.renderOrientation >= 0
      ? actor.renderOrientation
      : actor.direction;
  const mirror = orientation === 3;
  return [
    actor.renderOffsetX + (mirror ? frame.mox : frame.ox),
    actor.renderOffsetY + (mirror ? frame.moy : frame.oy),
    mirror ? frame.mw : frame.w,
    mirror ? frame.mh : frame.h,
  ];
}

/** Pick the foremost visible ink hit before checking interaction range; a far hit cannot click through. */
export function worldPointerTarget(
  actors: Iterable<StoryActor>,
  x: number,
  y: number,
  mask: (actor: StoryActor) => CollisionMask | null,
): number {
  const hits = [...actors].filter((actor) => {
    if (!actor.visible || actor.id < 0) return false;
    const rect = mask(actor);
    if (!rect) return false;
    const [dx, dy, width, height] = rect;
    const left = actor.x + dx,
      top = actor.y + dy;
    return width > 0 && height > 0 && x >= left && x < left + width && y >= top && y < top + height;
  });
  hits.sort(
    (a, b) =>
      b.layer - a.layer ||
      b.y + b.renderOffsetY - (a.y + a.renderOffsetY) ||
      (b.sourceOrder ?? 0) - (a.sourceOrder ?? 0) ||
      b.id - a.id,
  );
  return hits[0]?.id ?? -1;
}

/** Source activation range: 48 pixels per axis from the displayed NPC foot or prop rectangle. */
export function worldPointerNear(x: number, y: number, rect: CollisionMask): boolean {
  const [left, top, width, height] = rect;
  return (
    Math.max(0, left - x, x - left - width) <= 48 && Math.max(0, top - y, y - top - height) <= 48
  );
}
