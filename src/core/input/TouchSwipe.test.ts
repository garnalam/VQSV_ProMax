import { describe, expect, it } from "vitest";
import { SWIPE_ROW, SWIPE_START, TouchSwipe } from "./TouchSwipe";

describe("finger on a list", () => {
  it("a tap that stays put is the click, at the press point, on release", () => {
    const swipe = new TouchSwipe();
    swipe.press(100, 150);
    expect(swipe.move(150 + SWIPE_START - 1)).toEqual({ kind: "none" });
    expect(swipe.release()).toEqual({ x: 100, y: 150 });
    expect(swipe.active).toBe(false);
  });

  it("a drag scrolls one wheel step per row of travel and is not a click", () => {
    const swipe = new TouchSwipe();
    swipe.press(100, 200);
    expect(swipe.move(200 - SWIPE_START)).toEqual({ kind: "none" }); // becomes a swipe here
    // Finger up: further down the list (wheel down, positive).
    expect(swipe.move(200 - SWIPE_START - SWIPE_ROW * 2 - 3)).toEqual({ kind: "wheel", steps: 2 });
    // The leftover 3 px count towards the next step.
    expect(swipe.move(200 - SWIPE_START - SWIPE_ROW * 3)).toEqual({ kind: "wheel", steps: 1 });
    // Back down: back up the list.
    expect(swipe.move(200 - SWIPE_START - SWIPE_ROW)).toEqual({ kind: "wheel", steps: -2 });
    expect(swipe.release()).toBeNull();
  });

  it("does nothing without a press", () => {
    const swipe = new TouchSwipe();
    expect(swipe.move(10)).toEqual({ kind: "none" });
    expect(swipe.release()).toBeNull();
  });
});
