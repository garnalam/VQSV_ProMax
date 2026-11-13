/**
 * Logical key identities, named after the `java.awt.event.KeyEvent.VK_*` constants the JavaSE
 * baseline reads. The web keeps the same vocabulary so every input predicate can be ported 1:1
 * from `vqsv.input.InputSnapshot`, `BootFlowState` and `GameplayState`.
 */
export const KEY = {
  UP: "UP",
  DOWN: "DOWN",
  LEFT: "LEFT",
  RIGHT: "RIGHT",
  W: "W",
  A: "A",
  S: "S",
  D: "D",
  P: "P",
  V: "V",
  ENTER: "ENTER",
  SPACE: "SPACE",
  ESCAPE: "ESCAPE",
  BACK_SPACE: "BACK_SPACE",
  F1: "F1",
  F2: "F2",
  D0: "0",
  D1: "1",
  D2: "2",
  D3: "3",
  D4: "4",
  D5: "5",
  D6: "6",
  D7: "7",
  D8: "8",
  D9: "9",
  NUMPAD0: "NUMPAD0",
  NUMPAD1: "NUMPAD1",
  NUMPAD2: "NUMPAD2",
  NUMPAD3: "NUMPAD3",
  NUMPAD4: "NUMPAD4",
  NUMPAD5: "NUMPAD5",
  NUMPAD6: "NUMPAD6",
  NUMPAD7: "NUMPAD7",
  NUMPAD8: "NUMPAD8",
  NUMPAD9: "NUMPAD9",
} as const;

export type KeyCode = (typeof KEY)[keyof typeof KEY];

/**
 * `KeyboardEvent.code` (physical key) to the Java virtual key. Java's AWT reports numpad Enter as
 * `VK_ENTER`, so both Enter keys map to ENTER.
 */
const DOM_CODE_TO_KEY: Readonly<Record<string, KeyCode>> = {
  ArrowUp: KEY.UP,
  ArrowDown: KEY.DOWN,
  ArrowLeft: KEY.LEFT,
  ArrowRight: KEY.RIGHT,
  KeyW: KEY.W,
  KeyA: KEY.A,
  KeyS: KEY.S,
  KeyD: KEY.D,
  KeyP: KEY.P,
  KeyV: KEY.V,
  Enter: KEY.ENTER,
  NumpadEnter: KEY.ENTER,
  Space: KEY.SPACE,
  Escape: KEY.ESCAPE,
  Backspace: KEY.BACK_SPACE,
  F1: KEY.F1,
  F2: KEY.F2,
  Digit0: KEY.D0,
  Digit1: KEY.D1,
  Digit2: KEY.D2,
  Digit3: KEY.D3,
  Digit4: KEY.D4,
  Digit5: KEY.D5,
  Digit6: KEY.D6,
  Digit7: KEY.D7,
  Digit8: KEY.D8,
  Digit9: KEY.D9,
  Numpad0: KEY.NUMPAD0,
  Numpad1: KEY.NUMPAD1,
  Numpad2: KEY.NUMPAD2,
  Numpad3: KEY.NUMPAD3,
  Numpad4: KEY.NUMPAD4,
  Numpad5: KEY.NUMPAD5,
  Numpad6: KEY.NUMPAD6,
  Numpad7: KEY.NUMPAD7,
  Numpad8: KEY.NUMPAD8,
  Numpad9: KEY.NUMPAD9,
};

export function keyFromDomCode(code: string): KeyCode | undefined {
  return DOM_CODE_TO_KEY[code];
}
