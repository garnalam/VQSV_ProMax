import type { InputSnapshot } from "./InputSnapshot";
import { KEY } from "./KeyCode";

/**
 * The semantic vocabulary the gameplay runtimes (story, world, battle, panels) consume: what
 * `GameplayState` hands to `GameFacade` (move keys, confirm, escape). Devices never produce these
 * directly; a profile below derives them from one `InputSnapshot`, so keyboard, pointer and touch
 * all arrive as the same command.
 */
export type InputCommand =
  | "up"
  | "down"
  | "left"
  | "right"
  | "holdUp"
  | "holdDown"
  | "holdLeft"
  | "holdRight"
  | "confirm"
  | "back";

const MOVE = {
  up: [KEY.UP, KEY.W, KEY.NUMPAD8],
  down: [KEY.DOWN, KEY.S, KEY.NUMPAD2],
  left: [KEY.LEFT, KEY.A, KEY.NUMPAD4],
  right: [KEY.RIGHT, KEY.D, KEY.NUMPAD6],
} as const;

export type GameplayInputOptions = {
  /** `GameFacade.textEntryActive()`: Backspace edits text instead of acting as Escape. */
  textEntryActive?: boolean;
};

/**
 * Port of `GameplayState.tick`'s key handling:
 * - movement is held state from arrows, WASD and the numpad (not the top-row digits);
 * - a pointer press on this tick suppresses confirm (`if pointerPressed ... else if confirm`);
 * - confirm is 0/Enter/Space plus 5/Numpad5;
 * - Escape, or Backspace outside text entry, is back.
 */
export function gameplayCommands(
  input: InputSnapshot,
  options: GameplayInputOptions = {},
): InputCommand[] {
  const commands: InputCommand[] = [];
  for (const [direction, keys] of Object.entries(MOVE) as [
    keyof typeof MOVE,
    readonly (typeof KEY)[keyof typeof KEY][],
  ][]) {
    if (input.anyPressed(...keys)) commands.push(direction);
  }
  if (input.anyDown(...MOVE.up)) commands.push("holdUp");
  if (input.anyDown(...MOVE.down)) commands.push("holdDown");
  if (input.anyDown(...MOVE.left)) commands.push("holdLeft");
  if (input.anyDown(...MOVE.right)) commands.push("holdRight");
  if (!input.pointer.pressed && (input.confirmPressed() || input.anyPressed(KEY.D5, KEY.NUMPAD5)))
    commands.push("confirm");
  if (
    input.wasPressed(KEY.ESCAPE) ||
    (!options.textEntryActive && input.wasPressed(KEY.BACK_SPACE))
  )
    commands.push("back");
  return commands;
}

/** Shortcuts `GameplayState` reads: task list (1), ride (9) and the PvP lobby (P, no owner yet). */
export function gameplayShortcuts(input: InputSnapshot): {
  ride: boolean;
  pvp: boolean;
  task: boolean;
} {
  return {
    ride: input.anyPressed(KEY.D9, KEY.NUMPAD9),
    pvp: input.wasPressed(KEY.P),
    task: input.anyPressed(KEY.D1, KEY.NUMPAD1),
  };
}
