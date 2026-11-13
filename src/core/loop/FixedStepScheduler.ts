/**
 * Tick pacing of `vqsv.runtime.GamePanel.run()`, without the thread:
 *
 *   if (now >= nextFrame) { tick(); nextFrame += step; if (nextFrame < now - step) nextFrame = now + step; }
 *
 * A late frame is caught up only while the lag stays within one step; beyond that the schedule
 * resynchronises instead of replaying the backlog. A tab that was hidden for minutes therefore
 * resumes with a single tick, never a fast-forward burst.
 */
export class FixedStepScheduler {
  private nextFrame: number | null = null;

  constructor(readonly stepMs: number) {
    if (!(stepMs > 0)) throw new Error(`step must be positive, got ${stepMs}`);
  }

  /** Number of ticks due at `now` (ms, monotonic). Usually 0 or 1; at most 2 when slightly late. */
  advance(now: number): number {
    if (this.nextFrame === null) this.nextFrame = now;
    let ticks = 0;
    while (now >= this.nextFrame) {
      ticks++;
      this.nextFrame += this.stepMs;
      if (this.nextFrame < now - this.stepMs) this.nextFrame = now + this.stepMs;
    }
    return ticks;
  }

  /**
   * How far `now` is between the last tick and the next one, 0..1: the blend a frame drawn between
   * ticks uses (1 before the schedule has started).
   */
  progress(now: number): number {
    if (this.nextFrame === null) return 1;
    return Math.max(0, Math.min(1, 1 - (this.nextFrame - now) / this.stepMs));
  }

  /** Restart the schedule (e.g. after the page becomes visible again). */
  reset(): void {
    this.nextFrame = null;
  }
}
