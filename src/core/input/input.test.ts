import { describe, expect, it } from "vitest";
import { InputState } from "./InputState";
import { InputSnapshot } from "./InputSnapshot";
import { KEY } from "./KeyCode";
import { gameplayCommands, gameplayShortcuts } from "./GameCommand";

describe("InputState (vqsv.input.InputState)", () => {
  it("reports a press once and keeps the key held until release", () => {
    const state = new InputState();
    state.setKey(KEY.UP, true);
    state.setKey(KEY.UP, true); // OS key repeat
    const first = state.drainSnapshot();
    expect(first.wasPressed(KEY.UP)).toBe(true);
    expect(first.isDown(KEY.UP)).toBe(true);
    const second = state.drainSnapshot();
    expect(second.wasPressed(KEY.UP)).toBe(false);
    expect(second.isDown(KEY.UP)).toBe(true);
    state.setKey(KEY.UP, false);
    expect(state.drainSnapshot().isDown(KEY.UP)).toBe(false);
  });

  it("keeps a press-and-release inside one tick as a press", () => {
    const state = new InputState();
    state.setKey(KEY.ENTER, true);
    state.setKey(KEY.ENTER, false);
    const snapshot = state.drainSnapshot();
    expect(snapshot.confirmPressed()).toBe(true);
    expect(snapshot.isDown(KEY.ENTER)).toBe(false);
  });

  it("drains pointer, wheel and typed text exactly once", () => {
    const state = new InputState();
    state.pressPointer(100, 300);
    state.movePointer(101, 301);
    state.releasePointer(102, 302);
    state.rotateWheel(1);
    state.rotateWheel(1);
    state.typeText("ab");
    const snapshot = state.drainSnapshot();
    expect(snapshot.pointer).toMatchObject({
      pressed: true,
      released: true,
      moved: true,
      down: false,
      pressX: 100,
      pressY: 300,
      releaseX: 102,
      releaseY: 302,
    });
    expect(snapshot.wheelRotation).toBe(2);
    expect(snapshot.typedText).toBe("ab");
    const next = state.drainSnapshot();
    expect(next.pointer.pressed || next.pointer.released || next.pointer.moved).toBe(false);
    expect(next.wheelRotation).toBe(0);
    expect(next.typedText).toBe("");
  });

  it("releases everything on focus loss (cancelForFocusLoss)", () => {
    const state = new InputState();
    state.setKey(KEY.RIGHT, true);
    state.pressPointer(5, 6);
    state.drainSnapshot();
    state.cancelForFocusLoss();
    const snapshot = state.drainSnapshot();
    expect(snapshot.isDown(KEY.RIGHT)).toBe(false);
    expect(snapshot.pointer).toMatchObject({
      released: true,
      down: false,
      releaseX: 5,
      releaseY: 6,
    });
  });
});

describe("InputSnapshot predicates (vqsv.input.InputSnapshot)", () => {
  it("confirm is 0, Enter or Space", () => {
    for (const key of [KEY.D0, KEY.ENTER, KEY.SPACE])
      expect(InputSnapshot.keys(key).confirmPressed()).toBe(true);
    expect(InputSnapshot.keys(KEY.D5).confirmPressed()).toBe(false);
  });
  it("soft keys include the arrow keys and the 40x40 corners", () => {
    expect(InputSnapshot.keys(KEY.LEFT).softLeftPressed()).toBe(true);
    expect(InputSnapshot.keys(KEY.F1).softLeftPressed()).toBe(true);
    expect(InputSnapshot.tap(40, 280).softLeftPressed()).toBe(true);
    expect(InputSnapshot.tap(41, 300).softLeftPressed()).toBe(false);
    expect(InputSnapshot.keys(KEY.RIGHT).softRightPressed()).toBe(true);
    expect(InputSnapshot.tap(200, 320).softRightPressed()).toBe(true);
    expect(InputSnapshot.tap(199, 300).softRightPressed()).toBe(false);
  });
  it("back is Escape or Backspace", () => {
    expect(InputSnapshot.keys(KEY.ESCAPE).backPressed()).toBe(true);
    expect(InputSnapshot.keys(KEY.BACK_SPACE).backPressed()).toBe(true);
  });
});

describe("gameplayCommands (GameplayState.tick)", () => {
  it("moves with arrows, WASD and the numpad, but not top-row digits", () => {
    expect(gameplayCommands(InputSnapshot.keys(KEY.W))).toEqual(["up", "holdUp"]);
    expect(gameplayCommands(InputSnapshot.keys(KEY.NUMPAD6))).toEqual(["right", "holdRight"]);
    expect(gameplayCommands(InputSnapshot.keys(KEY.D8))).toEqual([]);
  });
  it("holds without re-pressing", () => {
    expect(gameplayCommands(new InputSnapshot({ down: [KEY.A] }))).toEqual(["holdLeft"]);
  });
  it("confirms with 0/Enter/Space/5/Numpad5", () => {
    for (const key of [KEY.D0, KEY.ENTER, KEY.SPACE, KEY.D5, KEY.NUMPAD5])
      expect(gameplayCommands(InputSnapshot.keys(key))).toEqual(["confirm"]);
  });
  it("a pointer press on the same tick suppresses keyboard confirm", () => {
    const input = new InputSnapshot({
      down: [KEY.ENTER],
      pressed: [KEY.ENTER],
      pointer: { pressed: true, down: true, pressX: 1, pressY: 1 },
    });
    expect(gameplayCommands(input)).toEqual([]);
  });
  it("Backspace is back except during text entry", () => {
    expect(gameplayCommands(InputSnapshot.keys(KEY.BACK_SPACE))).toEqual(["back"]);
    expect(gameplayCommands(InputSnapshot.keys(KEY.BACK_SPACE), { textEntryActive: true })).toEqual(
      [],
    );
    expect(gameplayCommands(InputSnapshot.keys(KEY.ESCAPE), { textEntryActive: true })).toEqual([
      "back",
    ]);
  });
  it("F1/F2 are not gameplay keys (the Java GameplayState ignores them)", () => {
    expect(gameplayCommands(InputSnapshot.keys(KEY.F1, KEY.F2))).toEqual([]);
  });
  it("exposes the ride (9) and PvP (P) shortcuts", () => {
    expect(gameplayShortcuts(InputSnapshot.keys(KEY.NUMPAD9))).toEqual({
      ride: true,
      pvp: false,
      task: false,
    });
    expect(gameplayShortcuts(InputSnapshot.keys(KEY.P))).toEqual({
      ride: false,
      pvp: true,
      task: false,
    });
  });
});
