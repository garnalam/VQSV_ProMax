import { InputSnapshot } from "./InputSnapshot";
import { keyFromDomCode, type KeyCode } from "./KeyCode";

/**
 * Accumulates device events between ticks: port of `vqsv.input.InputState`.
 *
 * DOM listeners only record; `drainSnapshot()` is called once per simulation tick and is the single
 * point where input enters the game. Keeping this class free of DOM types makes it testable and lets
 * a recorded trace drive the same code path as a real keyboard.
 */
export class InputState {
  private readonly down = new Set<KeyCode>();
  private readonly pressed = new Set<KeyCode>();
  private pointerPressed = false;
  private pointerReleased = false;
  private pointerDown = false;
  private pointerMoved = false;
  private pointerX = -1;
  private pointerY = -1;
  private pointerPressX = -1;
  private pointerPressY = -1;
  private pointerReleaseX = -1;
  private pointerReleaseY = -1;
  private pointerTouch = false;
  private wheelRotation = 0;
  private typedText = "";

  setKey(key: KeyCode, isDown: boolean): void {
    if (isDown) {
      if (!this.down.has(key)) {
        this.down.add(key);
        this.pressed.add(key);
      }
    } else this.down.delete(key);
  }

  pressPointer(x: number, y: number, touch = false): void {
    this.pointerPressed = true;
    this.pointerTouch = touch;
    this.pointerDown = true;
    this.pointerX = this.pointerPressX = x;
    this.pointerY = this.pointerPressY = y;
  }

  releasePointer(x: number, y: number): void {
    this.pointerReleased = true;
    this.pointerDown = false;
    this.pointerX = this.pointerReleaseX = x;
    this.pointerY = this.pointerReleaseY = y;
  }

  movePointer(x: number, y: number): void {
    this.pointerMoved = true;
    this.pointerX = x;
    this.pointerY = y;
  }

  rotateWheel(rotation: number): void {
    this.wheelRotation += rotation;
  }

  typeText(value: string): void {
    this.typedText += value;
  }

  /** `cancelForFocusLoss`: forget held keys and close an open pointer press. */
  cancelForFocusLoss(): void {
    this.down.clear();
    this.pressed.clear();
    this.pointerPressed = false;
    this.pointerMoved = false;
    this.wheelRotation = 0;
    this.typedText = "";
    if (this.pointerDown) {
      this.pointerReleased = true;
      this.pointerReleaseX = this.pointerX;
      this.pointerReleaseY = this.pointerY;
    }
    this.pointerDown = false;
  }

  drainSnapshot(): InputSnapshot {
    const snapshot = new InputSnapshot({
      down: this.down,
      pressed: this.pressed,
      pointer: {
        pressed: this.pointerPressed,
        released: this.pointerReleased,
        down: this.pointerDown,
        moved: this.pointerMoved,
        x: this.pointerX,
        y: this.pointerY,
        pressX: this.pointerPressX,
        pressY: this.pointerPressY,
        releaseX: this.pointerReleaseX,
        releaseY: this.pointerReleaseY,
        touch: this.pointerTouch,
      },
      wheelRotation: this.wheelRotation,
      typedText: this.typedText,
    });
    this.pressed.clear();
    this.pointerPressed = false;
    this.pointerReleased = false;
    this.pointerMoved = false;
    this.wheelRotation = 0;
    this.typedText = "";
    return snapshot;
  }
}

/** Keys whose browser default (scrolling, history back, help) must not fire while playing. */
const PREVENT_DEFAULT = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "Backspace",
  "F1",
  "F2",
  "Enter",
  "NumpadEnter",
]);

/** The characters AWT delivers through `keyTyped` for non-printing keys. */
const TYPED_CONTROL: Readonly<Record<string, string>> = {
  Enter: "\n",
  NumpadEnter: "\n",
  Backspace: "\b",
  Escape: "\u001b",
  Tab: "\t",
};

/** Phone keyboards often leave `code` empty; Enter and Backspace are still named in `key`. */
function keyFromDomEvent(event: KeyboardEvent): KeyCode | undefined {
  return keyFromDomCode(event.code) ?? (event.code ? undefined : keyFromDomCode(event.key));
}

export type LogicalPoint = (clientX: number, clientY: number) => { x: number; y: number };

/**
 * Wires DOM events into an `InputState` (the `GamePanel` listeners). Returns a disposer.
 * `toLogical` converts client coordinates into integer logical pixels.
 */
export function bindDomInput(
  state: InputState,
  surface: HTMLElement,
  toLogical: LogicalPoint,
): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    // The phone-keyboard proxy (TextEntryProxy) reads its own text from `beforeinput`; here it only
    // reports keys, and its defaults (deleting, typing) must run.
    if (event.target instanceof HTMLInputElement) {
      const key = keyFromDomEvent(event);
      if (key) state.setKey(key, true);
      return;
    }
    if (PREVENT_DEFAULT.has(event.code)) event.preventDefault();
    if ((event.ctrlKey || event.metaKey) && event.code === "KeyV") return; // handled by "paste"
    const key = keyFromDomCode(event.code);
    if (key) state.setKey(key, true);
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const control = TYPED_CONTROL[event.code];
    if (control) state.typeText(control);
    else if (event.key.length === 1) state.typeText(event.key);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    const key = keyFromDomEvent(event);
    if (key) state.setKey(key, false);
  };
  const onPaste = (event: ClipboardEvent): void => {
    const text = event.clipboardData?.getData("text");
    if (text) state.typeText(text);
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    surface.focus();
    surface.setPointerCapture?.(event.pointerId);
    const p = toLogical(event.clientX, event.clientY);
    state.pressPointer(p.x, p.y, event.pointerType === "touch");
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const p = toLogical(event.clientX, event.clientY);
    state.releasePointer(p.x, p.y);
  };
  const onPointerMove = (event: PointerEvent): void => {
    const p = toLogical(event.clientX, event.clientY);
    state.movePointer(p.x, p.y);
  };
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (event.deltaY !== 0) state.rotateWheel(Math.sign(event.deltaY));
  };
  const onFocusLoss = (): void => state.cancelForFocusLoss();
  const onVisibility = (): void => {
    if (document.visibilityState === "hidden") state.cancelForFocusLoss();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("paste", onPaste);
  window.addEventListener("blur", onFocusLoss);
  document.addEventListener("visibilitychange", onVisibility);
  surface.addEventListener("pointerdown", onPointerDown);
  surface.addEventListener("pointerup", onPointerUp);
  surface.addEventListener("pointercancel", onPointerUp);
  surface.addEventListener("pointermove", onPointerMove);
  surface.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("paste", onPaste);
    window.removeEventListener("blur", onFocusLoss);
    document.removeEventListener("visibilitychange", onVisibility);
    surface.removeEventListener("pointerdown", onPointerDown);
    surface.removeEventListener("pointerup", onPointerUp);
    surface.removeEventListener("pointercancel", onPointerUp);
    surface.removeEventListener("pointermove", onPointerMove);
    surface.removeEventListener("wheel", onWheel);
  };
}
