/**
 * A finger on a list (web only; Java has no touch): a drag scrolls it like the mouse wheel, a tap
 * is still a click. The click therefore waits for the finger to lift, since a press alone cannot
 * tell a tap from the start of a swipe. Mouse presses never come here and keep Java's click-on-press.
 */

/** Logical pixels the finger must travel before the press becomes a swipe. */
export const SWIPE_START = 6;
/** Logical pixels of travel per wheel step (about one list row). */
export const SWIPE_ROW = 16;

export type SwipeResult =
  /** Nothing to do this move. */
  | { kind: "none" }
  /** Scroll by `steps` wheel notches (positive = further down the list). */
  | { kind: "wheel"; steps: number };

export class TouchSwipe {
  private startY = 0;
  private anchorY = 0;
  private swiping = false;
  private tap: { x: number; y: number } | null = null;

  /** A finger went down on a scrollable screen at (x, y). */
  press(x: number, y: number): void {
    this.tap = { x, y };
    this.startY = this.anchorY = y;
    this.swiping = false;
  }

  get active(): boolean {
    return this.tap !== null;
  }

  /** The finger moved to `y`: past the threshold the travel turns into wheel steps. */
  move(y: number): SwipeResult {
    if (!this.tap) return { kind: "none" };
    if (!this.swiping) {
      if (Math.abs(y - this.startY) < SWIPE_START) return { kind: "none" };
      this.swiping = true;
      this.anchorY = y;
      return { kind: "none" };
    }
    // A finger moving up drags the list up, showing what is further down (like a phone list).
    const steps = Math.trunc((this.anchorY - y) / SWIPE_ROW);
    if (steps === 0) return { kind: "none" };
    this.anchorY -= steps * SWIPE_ROW;
    return { kind: "wheel", steps };
  }

  /** The finger lifted: the press point to click if it never became a swipe, else null. */
  release(): { x: number; y: number } | null {
    const tap = this.swiping ? null : this.tap;
    this.tap = null;
    this.swiping = false;
    return tap;
  }
}
