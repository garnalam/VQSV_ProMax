import { FixedStepScheduler } from "./loop/FixedStepScheduler";

/**
 * Drives the simulation at the Java tick rate from `requestAnimationFrame`. Each due tick is
 * followed by a render, as in `GamePanel.run()`; when nothing is due the frame is left untouched.
 */
export class GameLoop {
  private readonly scheduler: FixedStepScheduler;
  private running = false;

  constructor(
    stepMs: number,
    private readonly tick: () => void,
    /** Draws a frame; `alpha` is how far the frame sits between the last tick and the next. */
    private readonly render: (alpha: number) => void,
    /** Whether a frame between ticks would show motion (otherwise only ticks are drawn). */
    private readonly animating: () => boolean = () => false,
  ) {
    this.scheduler = new FixedStepScheduler(stepMs);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    document.addEventListener("visibilitychange", this.onVisibility);
    requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === "visible") this.scheduler.reset();
  };

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    const due = this.scheduler.advance(now);
    for (let i = 0; i < due; i++) this.tick();
    // A tick always draws; between ticks a frame is drawn only while something is moving, so an idle
    // screen costs nothing and a walk is drawn at the display's rate.
    if (due > 0 || this.animating()) {
      try {
        this.render(this.scheduler.progress(now));
      } catch (error) {
        console.error("VQSV_RENDER_FAILED", error);
        window.dispatchEvent(new CustomEvent("vqsv-render-error", { detail: String(error) }));
      }
    }
    requestAnimationFrame(this.frame);
  };
}
