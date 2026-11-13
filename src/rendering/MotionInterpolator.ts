/**
 * Smooth motion between simulation ticks. The game simulates at Java's 15 ticks a second; drawing
 * only on a tick makes walking and camera pans step 4–8 px at a time. Before each tick the screen
 * records where every actor and the camera stood, and a frame drawn between two ticks places them
 * part-way from there to where they stand now. Sprites still change frame on the tick (pixel art),
 * nothing in the simulation reads these positions, and a jump (a door, a room change, a script that
 * places an actor) is drawn where it lands instead of sliding across the map.
 */
type Point = { x: number; y: number };

/** A move longer than this in one tick is a teleport, not a walk. */
const MAX_INTERPOLATED_STEP = 24;

export class MotionInterpolator {
  private previousActors = new Map<number, Point>();
  private previousCamera: Point | null = null;
  private source: object | null = null;
  /** 0 = the last tick's positions, 1 = the current ones. */
  alpha = 1;
  /** Whether anything moved on the last tick (an idle screen needs no in-between frames). */
  moving = false;

  /** Record where things stand before a tick runs. `source` is the actor map being tracked. */
  capture(
    source: object | null,
    camera: Point | null,
    actors?: Iterable<{ id: number; x: number; y: number }>,
  ): void {
    this.source = source;
    this.previousCamera = camera ? { ...camera } : null;
    this.previousActors = new Map();
    if (actors)
      for (const actor of actors) this.previousActors.set(actor.id, { x: actor.x, y: actor.y });
  }

  /** After the tick: did anything tracked move? */
  settle(
    source: object | null,
    camera: Point | null,
    actors?: Iterable<{ id: number; x: number; y: number }>,
  ): void {
    let moving = false;
    if (source !== this.source) {
      this.previousActors.clear();
      this.previousCamera = null;
    } else {
      if (camera && this.previousCamera)
        moving ||= camera.x !== this.previousCamera.x || camera.y !== this.previousCamera.y;
      if (actors)
        for (const actor of actors) {
          const before = this.previousActors.get(actor.id);
          if (before && (before.x !== actor.x || before.y !== actor.y)) moving = true;
        }
    }
    this.moving = moving;
  }

  camera(source: object, current: Point): Point {
    return this.lerp(source, this.previousCamera, current);
  }
  actor(source: object, id: number, current: Point): Point {
    return this.lerp(source, this.previousActors.get(id) ?? null, current);
  }

  private lerp(source: object, from: Point | null, to: Point): Point {
    if (source !== this.source || !from || this.alpha >= 1) return to;
    const dx = to.x - from.x,
      dy = to.y - from.y;
    if (Math.abs(dx) > MAX_INTERPOLATED_STEP || Math.abs(dy) > MAX_INTERPOLATED_STEP) return to;
    return { x: Math.round(from.x + dx * this.alpha), y: Math.round(from.y + dy * this.alpha) };
  }
}
