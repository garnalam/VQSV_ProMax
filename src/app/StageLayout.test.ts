import { describe, expect, it } from "vitest";
import { dpadDirection, joystickDirection } from "../core/input/TouchGamepad";
import { KEY } from "../core/input/KeyCode";
import { fitStage, liveArea, PORTRAIT_PAD_SPACE } from "./StageLayout";

describe("game canvas layout (landscape, 240 tall)", () => {
  it("fills a desktop window edge to edge, as wide as its shape", () => {
    const fit = fitStage(1920, 1080, false);
    expect(fit).toMatchObject({ mode: "desktop", viewWidth: 426, height: 1080 });
    expect(1920 - fit.width).toBeLessThan(10);
  });

  it("fills a sideways phone: the canvas widens with the screen, within the limits", () => {
    const fit = fitStage(844, 390, true);
    expect(fit.mode).toBe("landscape");
    expect(fit.height).toBe(390);
    expect(fit.viewWidth).toBe(518);
    expect(844 - fit.width).toBeLessThan(4);
    // A 4:3 screen keeps the APK's own 320x240; an ultra-wide one stops at the widest canvas.
    expect(fitStage(1024, 768, true).viewWidth).toBe(320);
    expect(fitStage(3440, 1440, false).viewWidth).toBe(572);
  });

  it("puts the narrowest canvas on top of an upright phone, the pad below", () => {
    const fit = fitStage(390, 750, true);
    expect(fit).toMatchObject({ mode: "portrait", viewWidth: 320, width: 390 });
    expect(750 - fit.height).toBeGreaterThanOrEqual(PORTRAIT_PAD_SPACE);
  });

  it("never draws past the window", () => {
    for (const [w, h, touch] of [
      [360, 640, true],
      [1024, 768, true],
      [800, 600, false],
      [2560, 1080, false],
    ] as const) {
      const fit = fitStage(w, h, touch);
      expect(fit.width).toBeLessThanOrEqual(w);
      expect(fit.height).toBeLessThanOrEqual(h);
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

describe("returning to the game after switching apps (iPhone, sideways)", () => {
  it("caps a page box left at the old orientation by the window, so the phone stays landscape", () => {
    // iOS handed back an 844x844 page box on an 844x390 screen: laid out as is, it read as an
    // upright phone, zoomed the map past the screen and pushed the joystick off it.
    expect(fitStage(844, 844, true).mode).toBe("portrait");
    const area = liveArea({ width: 844, height: 844 }, { width: 844, height: 390 });
    expect(area).toEqual({ width: 844, height: 390 });
    const fit = fitStage(area.width, area.height, true);
    expect(fit).toMatchObject({ mode: "landscape", height: 390 });
    expect(fit.width).toBeLessThanOrEqual(844);
  });

  it("keeps the page box when it is the smaller one, and ignores a window that measures 0", () => {
    expect(liveArea({ width: 800, height: 360 }, { width: 844, height: 390 })).toEqual({
      width: 800,
      height: 360,
    });
    expect(liveArea({ width: 844, height: 390 }, { width: 0, height: 0 })).toEqual({
      width: 844,
      height: 390,
    });
  });
});
