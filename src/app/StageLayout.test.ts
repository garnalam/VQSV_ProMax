import { describe, expect, it } from "vitest";
import { dpadDirection, joystickDirection } from "../core/input/TouchGamepad";
import { KEY } from "../core/input/KeyCode";
import { fitStage, LANDSCAPE_PAD_SPACE, PORTRAIT_PAD_SPACE } from "./StageLayout";

describe("game box layout", () => {
  it("fills a desktop window with a whole-number scale and no pad", () => {
    expect(fitStage(1920, 969, false)).toMatchObject({ mode: "desktop", scale: 3 });
    expect(fitStage(1366, 657, false)).toMatchObject({ mode: "desktop", scale: 2 });
    // Never past x4, however big the screen.
    expect(fitStage(3840, 2100, false)).toMatchObject({ width: 960, height: 1280, scale: 4 });
  });

  it("keeps the fractional fit when x1 would waste most of a phone", () => {
    const fit = fitStage(390, 750, true);
    expect(fit.mode).toBe("portrait");
    expect(fit).toMatchObject({ width: 390, height: 520 });
    expect(750 - fit.height).toBeGreaterThanOrEqual(PORTRAIT_PAD_SPACE);
  });

  it("puts the box in the middle of a sideways phone, leaving both sides for the pad", () => {
    const fit = fitStage(844, 390, true);
    expect(fit.mode).toBe("landscape");
    expect(fit.height).toBe(390);
    expect((844 - fit.width) / 2).toBeGreaterThanOrEqual(LANDSCAPE_PAD_SPACE);
  });

  it("keeps the 3:4 shape everywhere", () => {
    for (const [w, h, touch] of [
      [360, 640, true],
      [1024, 768, true],
      [800, 600, false],
    ] as const) {
      const fit = fitStage(w, h, touch);
      expect(Math.abs(fit.width / fit.height - 0.75)).toBeLessThan(0.01);
      expect(fit.width).toBeLessThanOrEqual(w);
    }
  });
});

describe("D-pad", () => {
  it("presses the arm along the dominant axis, nothing in the dead zone", () => {
    expect(dpadDirection(0, -40, 10)).toBe(KEY.UP);
    expect(dpadDirection(0, 40, 10)).toBe(KEY.DOWN);
    expect(dpadDirection(-40, 10, 10)).toBe(KEY.LEFT);
    expect(dpadDirection(40, -30, 10)).toBe(KEY.RIGHT);
    expect(dpadDirection(4, 5, 10)).toBeNull();
  });

  it("joystick: keeps the held arrow near a diagonal, turns once the other axis clearly wins", () => {
    // 45°: holding right stays right, holding down stays down.
    expect(joystickDirection(30, 31, 10, KEY.RIGHT)).toBe(KEY.RIGHT);
    expect(joystickDirection(31, 30, 10, KEY.DOWN)).toBe(KEY.DOWN);
    // Clearly down now.
    expect(joystickDirection(20, 40, 10, KEY.RIGHT)).toBe(KEY.DOWN);
    // Swung to the other side: no stickiness.
    expect(joystickDirection(-30, 31, 10, KEY.RIGHT)).toBe(KEY.DOWN);
    expect(joystickDirection(-40, 0, 10, KEY.RIGHT)).toBe(KEY.LEFT);
    // Back to the middle lets go.
    expect(joystickDirection(3, 2, 10, KEY.UP)).toBeNull();
  });
});

describe("pad and finger together", () => {
  it("a held pad key and a tap on the game reach the same tick", async () => {
    const { InputState } = await import("../core/input/InputState");
    const state = new InputState();
    state.setKey(KEY.UP, true); // thumb on the D-pad
    state.pressPointer(100, 120, true); // other finger taps the game
    const snapshot = state.drainSnapshot();
    expect(snapshot.isDown(KEY.UP)).toBe(true);
    expect(snapshot.pointer).toMatchObject({
      pressed: true,
      pressX: 100,
      pressY: 120,
      touch: true,
    });
    // The tap does not let go of the pad.
    expect(state.drainSnapshot().isDown(KEY.UP)).toBe(true);
  });
});
