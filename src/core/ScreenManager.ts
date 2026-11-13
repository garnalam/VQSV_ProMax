import type { InputSnapshot } from "./input/InputSnapshot";
import type { CanvasRenderer } from "../rendering/CanvasRenderer";

/**
 * One top-level game state (`vqsv.state.GameState`). A tick receives the whole input snapshot,
 * pointer included; there is no separate pointer callback outside the simulation tick.
 */
export interface Screen {
  tick(input: InputSnapshot): void;
  /** `alpha`: how far between the last tick and the next this frame is (1 = on the tick). */
  render(renderer: CanvasRenderer, alpha?: number): void;
  /** Whether a frame drawn between ticks would differ from the last one. */
  animating?(): boolean;
  /** `GameFacade`'s rule: a state that runs one tick per frame whatever the x2 checkbox says. */
  speedX2Suppressed?(): boolean;
  /** Device pixels per logical pixel for this frame (`CanvasRenderer.setScale`); 1 if absent. */
  presentationScale?(): number;
}

export class ScreenManager {
  private current: Screen | null = null;
  replace(screen: Screen): void {
    this.current = screen;
  }
  tick(input: InputSnapshot): void {
    this.current?.tick(input);
  }
  render(renderer: CanvasRenderer, alpha = 1): void {
    renderer.setScale(this.current?.presentationScale?.() ?? 1);
    this.current?.render(renderer, alpha);
  }
  animating(): boolean {
    return this.current?.animating?.() ?? false;
  }
  speedX2Suppressed(): boolean {
    return this.current?.speedX2Suppressed?.() ?? false;
  }
}
