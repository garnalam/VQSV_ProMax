import type { CaptureVisual } from "../game/battle/CaptureAnimation";
import type { GameAssets } from "../game/story/GameAssets";
type Actor = { spriteId: number; origin: { x: number; y: number } };
/** Original frame anchoring and throw path used by battle and Safari. */
export function drawCaptureBall(
  g: CanvasRenderingContext2D,
  assets: GameAssets,
  capture: CaptureVisual,
  actors: { player: Actor; enemy: Actor; marker: { x: number; y: number } },
  drawEffect?: (effect: NonNullable<CaptureVisual["effect"]>) => void,
): void {
  const frame = assets.frame(capture.spriteId, capture.state, capture.tick);
  if (!frame) return;
  const image = assets.imageFor(frame);
  if (!image.complete || !image.naturalWidth) return;
  const enemy = actors.enemy,
    player = actors.player,
    enemyBounds = assets.animationBounds(enemy.spriteId, 0),
    playerBounds = assets.animationBounds(player.spriteId, 0),
    markerBounds = assets.animationBounds(294, 0);
  if (!enemyBounds || !playerBounds || !markerBounds) return;
  if (capture.effect) drawEffect?.(capture.effect);
  const playerCenter = {
      x: player.origin.x + playerBounds.x + playerBounds.width / 2,
      y: player.origin.y + playerBounds.y + playerBounds.height / 2,
    },
    markerCenter = {
      x: actors.marker.x + markerBounds.x + markerBounds.width / 2,
      y: actors.marker.y + markerBounds.y + markerBounds.height / 2,
    },
    spriteId = capture.spriteId,
    // A frame's visible box (frames are cut to their ink): its centre in the frame's own space.
    centre = (f: { ox: number; oy: number; w: number; h: number }) => ({
      x: f.ox + f.w / 2,
      y: f.oy + f.h / 2,
    }),
    // Where the sprite's origin goes so that `ref`'s centre lands on `target`. Every frame of the
    // phase is then drawn from that one origin, so the ball keeps the shake and bounce its own
    // frames carry instead of being re-centred (and jolted) frame by frame.
    originFor = (target: { x: number; y: number }, ref: typeof frame) => {
      const c = centre(ref);
      return { x: target.x - c.x, y: target.y - c.y };
    };
  let origin: { x: number; y: number };
  if (capture.phase === "ground") {
    // `enemyCatchSuccessGroundPoint`: the ball at rest on the enemy's ground marker.
    const count = assets.sprites[String(spriteId)]?.states["3"]?.length ?? 1,
      rest = assets.frameAtCursor(spriteId, 3, count - 1) ?? frame;
    origin = originFor(markerCenter, rest);
  } else {
    // `enemyCaptureBallPoint`: above the enemy's head, measured on the hovering ball (state 1).
    const hover = assets.frameAtCursor(spriteId, 1, 0) ?? frame,
      enemyCapture = {
        x: markerCenter.x,
        y: enemy.origin.y + enemyBounds.y - Math.max(3, hover.h / 2) + 1,
      };
    if (capture.phase === "throw") {
      // `catchThrowPoint`: from the player to that point, one step per frame.
      const count = Math.max(
          1,
          assets.sprites[String(spriteId)]?.states[String(capture.state)]?.length ?? 1,
        ),
        cursor = Math.max(0, Math.min(capture.tick, count - 1)),
        denominator = Math.max(1, count - 1),
        c = centre(frame);
      origin = {
        x: playerCenter.x + ((enemyCapture.x - playerCenter.x) * cursor) / denominator - c.x,
        y: playerCenter.y + ((enemyCapture.y - playerCenter.y) * cursor) / denominator - c.y,
      };
    } else origin = originFor(enemyCapture, hover);
  }
  g.drawImage(image, Math.floor(origin.x + frame.ox), Math.floor(origin.y + frame.oy));
}

export function drawCapturedPetEffect(
  g: CanvasRenderingContext2D,
  assets: GameAssets,
  enemy: Actor,
  effect: { scale10: number; dx: number; dy: number },
): void {
  const frame = assets.frameAtCursor(enemy.spriteId, 0, 0);
  if (!frame) return;
  const image = assets.imageFor(frame);
  if (!image.complete || !image.naturalWidth) return;
  const scale = Math.max(0.1, effect.scale10 / 10);
  g.save();
  g.imageSmoothingEnabled = false;
  g.filter = "brightness(1.5)";
  g.drawImage(
    image,
    Math.floor(enemy.origin.x + frame.ox * scale + effect.dx),
    Math.floor(enemy.origin.y + frame.oy * scale + effect.dy),
    Math.max(1, Math.floor(frame.w * scale)),
    Math.max(1, Math.floor(frame.h * scale)),
  );
  g.restore();
}
