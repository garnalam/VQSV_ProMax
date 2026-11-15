import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from "../constants";
import { landPoint } from "../LandCenter";
import { viewport } from "../Viewport";
import { KEY, type KeyCode } from "./KeyCode";

/** Pointer coordinates are logical pixels (240x320); -1 means "no such event this tick". */
export type PointerFields = {
  pressed: boolean;
  released: boolean;
  down: boolean;
  moved: boolean;
  x: number;
  y: number;
  pressX: number;
  pressY: number;
  releaseX: number;
  releaseY: number;
  /** The press came from a finger (web only): a drag on a list scrolls it instead of clicking. */
  touch: boolean;
};

export type InputSnapshotInit = {
  down?: Iterable<KeyCode>;
  pressed?: Iterable<KeyCode>;
  pointer?: Partial<PointerFields>;
  wheelRotation?: number;
  typedText?: string;
};

const NO_POINTER: PointerFields = {
  pressed: false,
  released: false,
  down: false,
  moved: false,
  x: -1,
  y: -1,
  pressX: -1,
  pressY: -1,
  releaseX: -1,
  releaseY: -1,
  touch: false,
};

/**
 * Immutable input for exactly one simulation tick: port of `vqsv.input.InputSnapshot`.
 *
 * Everything a tick may react to (keys, pointer, wheel, typed text) is drained into one snapshot
 * by `InputState.drainSnapshot()`; nothing reaches the simulation from a DOM callback directly.
 * That is what makes a recorded snapshot sequence replay to the same state.
 */
export class InputSnapshot {
  static readonly EMPTY = new InputSnapshot();

  private readonly down: ReadonlySet<KeyCode>;
  private readonly pressed: ReadonlySet<KeyCode>;
  readonly pointer: Readonly<PointerFields>;
  readonly wheelRotation: number;
  readonly typedText: string;

  constructor(init: InputSnapshotInit = {}) {
    this.down = new Set(init.down ?? []);
    this.pressed = new Set(init.pressed ?? []);
    this.pointer = Object.freeze({ ...NO_POINTER, ...init.pointer });
    this.wheelRotation = init.wheelRotation ?? 0;
    this.typedText = init.typedText ?? "";
  }

  /** Convenience for tests and scripted traces: keys pressed (and held) this tick. */
  static keys(...pressed: KeyCode[]): InputSnapshot {
    return new InputSnapshot({ down: pressed, pressed });
  }

  /** Convenience for tests and scripted traces: one pointer press at logical x/y. */
  static tap(x: number, y: number): InputSnapshot {
    return new InputSnapshot({
      pointer: { pressed: true, down: true, x, y, pressX: x, pressY: y },
    });
  }

  /**
   * The same held state with every one-shot event removed. Speed x2 runs a second tick per frame;
   * Java applies a press once, so the extra tick only sees what is still held.
   */
  heldOnly(): InputSnapshot {
    return new InputSnapshot({
      down: this.down,
      pointer: { down: this.pointer.down, x: this.pointer.x, y: this.pointer.y },
    });
  }

  isDown(key: KeyCode): boolean {
    return this.down.has(key);
  }

  wasPressed(key: KeyCode): boolean {
    return this.pressed.has(key);
  }

  anyDown(...keys: KeyCode[]): boolean {
    return keys.some((key) => this.down.has(key));
  }

  anyPressed(...keys: KeyCode[]): boolean {
    return keys.some((key) => this.pressed.has(key));
  }

  /** True when the tick carries any key press or pointer press at all. */
  get hasPress(): boolean {
    return this.pressed.size > 0 || this.pointer.pressed;
  }

  /** `InputSnapshot.confirmPressed`: 0, Enter or Space. */
  confirmPressed(): boolean {
    return this.anyPressed(KEY.D0, KEY.ENTER, KEY.SPACE);
  }

  /**
   * `InputSnapshot.softLeftPressed`: F1, Left, or a press in the bottom-left 40x40 corner (of the
   * 320x240 screen in landscape, where the softkey labels are drawn).
   */
  softLeftPressed(): boolean {
    return this.anyPressed(KEY.F1, KEY.LEFT) || this.softCornerPressed("left");
  }

  /** `InputSnapshot.softRightPressed`: F2, Right, or a press in the bottom-right 40x40 corner. */
  softRightPressed(): boolean {
    return this.anyPressed(KEY.F2, KEY.RIGHT) || this.softCornerPressed("right");
  }

  private softCornerPressed(side: "left" | "right"): boolean {
    if (!viewport.landscape)
      return side === "left"
        ? this.pointerPressedIn(0, LOGICAL_HEIGHT - 40, 40, LOGICAL_HEIGHT)
        : this.pointerPressedIn(
            LOGICAL_WIDTH - 40,
            LOGICAL_HEIGHT - 40,
            LOGICAL_WIDTH,
            LOGICAL_HEIGHT,
          );
    if (!this.pointer.pressed) return false;
    const at = landPoint(this.pointer.pressX, this.pointer.pressY);
    return at.y >= 200 && (side === "left" ? at.x <= 40 : at.x >= 280);
  }

  /** `InputSnapshot.backPressed`: Escape or Backspace. */
  backPressed(): boolean {
    return this.anyPressed(KEY.ESCAPE, KEY.BACK_SPACE);
  }

  /** Inclusive rectangle test on the press position, the way the Java predicates are written. */
  pointerPressedIn(x0: number, y0: number, x1: number, y1: number): boolean {
    const p = this.pointer;
    return p.pressed && p.pressX >= x0 && p.pressX <= x1 && p.pressY >= y0 && p.pressY <= y1;
  }
}
