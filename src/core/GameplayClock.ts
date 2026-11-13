import type { InputSnapshot } from "./input/InputSnapshot";

/**
 * Speed x2: one host frame runs two simulation ticks. The first sees the whole snapshot; the second
 * sees only held state, so a press, click or typed character is applied exactly once.
 */
export class GameplayClock {
  private speedX2 = false;
  setSpeedX2(enabled: boolean): void {
    this.speedX2 = enabled;
  }
  get isSpeedX2(): boolean {
    return this.speedX2;
  }
  tick(
    tick: (input: InputSnapshot) => void,
    input: InputSnapshot,
    speedX2Suppressed: () => boolean = () => false,
  ): void {
    tick(input);
    // `GameFacade`: the state on screen may hold the extra tick back (the map loading screen does).
    if (this.speedX2 && !speedX2Suppressed()) tick(input.heldOnly());
  }
}
