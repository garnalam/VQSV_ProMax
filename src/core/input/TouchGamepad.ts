import type { InputState } from "./InputState";
import { KEY, type KeyCode } from "./KeyCode";

/**
 * The on-screen gamepad for touch screens. It only presses and releases keys on the `InputState`,
 * exactly like a keyboard would, so the game, its tick and the Java parity checks see nothing new:
 *
 * - Joystick: arrow keys. The knob follows the thumb inside its ring; the game walks in four
 *   directions, so the knob's angle picks one arrow, and sliding round the ring turns without lifting.
 * - A: Enter (confirm). B: Escape (back). L / R: F1 / F2 (the phone softkeys).
 */

export type PadDirection = typeof KEY.UP | typeof KEY.DOWN | typeof KEY.LEFT | typeof KEY.RIGHT;

/**
 * The arm under a thumb `dx, dy` away from the pad centre: the dominant axis wins, and nothing is
 * pressed inside the dead zone so resting the thumb on the middle does not walk.
 */
export function dpadDirection(dx: number, dy: number, deadZone: number): PadDirection | null {
  if (Math.hypot(dx, dy) < deadZone) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? KEY.RIGHT : KEY.LEFT;
  return dy > 0 ? KEY.DOWN : KEY.UP;
}

/**
 * `dpadDirection` for a joystick: near a diagonal the arrow already held is kept until the other
 * axis clearly wins (by `STICKY`), so a thumb resting at 45° does not flick between two arrows.
 */
export function joystickDirection(
  dx: number,
  dy: number,
  deadZone: number,
  held: PadDirection | null,
): PadDirection | null {
  const next = dpadDirection(dx, dy, deadZone);
  if (!next || !held || next === held) return next;
  const heldHorizontal = held === KEY.LEFT || held === KEY.RIGHT,
    nextHorizontal = next === KEY.LEFT || next === KEY.RIGHT;
  if (heldHorizontal === nextHorizontal) return next; // flipped to the opposite side
  const along = heldHorizontal ? dx : dy,
    across = Math.abs(heldHorizontal ? dy : dx),
    sign = held === KEY.RIGHT || held === KEY.DOWN ? 1 : -1;
  return along * sign > 0 && across < Math.abs(along) * STICKY ? held : next;
}

/** Share of the ring radius that is dead zone. */
const DEAD_ZONE = 0.25;
/** How much the new axis must beat the held one by before a diagonal turns. */
const STICKY = 1.3;

const ARROWS: readonly [PadDirection, string][] = [
  [KEY.UP, "up"],
  [KEY.LEFT, "left"],
  [KEY.RIGHT, "right"],
  [KEY.DOWN, "down"],
];

export class TouchGamepad {
  private readonly held = new Set<() => void>();
  private readonly arrows = new Map<PadDirection, HTMLElement>();
  private knob: HTMLElement | null = null;
  private dpadPointer: number | null = null;
  private dpadKey: PadDirection | null = null;

  constructor(
    private readonly state: InputState,
    left: HTMLElement,
    right: HTMLElement,
  ) {
    left.replaceChildren(this.button("L", KEY.F1, "soft"), this.joystick());
    const ab = document.createElement("div");
    ab.className = "ab";
    ab.append(this.button("A", KEY.ENTER, "a"), this.button("B", KEY.ESCAPE, "b"));
    right.replaceChildren(this.button("R", KEY.F2, "soft"), ab);
    for (const zone of [left, right])
      zone.addEventListener("contextmenu", (event) => event.preventDefault());
    const releaseAll = (): void => this.releaseAll();
    window.addEventListener("blur", releaseAll);
    document.addEventListener("visibilitychange", releaseAll);
  }

  /** Lets go of everything the pad holds (focus lost, tab hidden). */
  releaseAll(): void {
    for (const release of [...this.held]) release();
    this.setDpad(null);
    this.dpadPointer = null;
    if (this.knob) {
      this.knob.style.transform = "";
      this.knob.parentElement?.classList.remove("active");
    }
  }

  private button(label: string, key: KeyCode, kind: string): HTMLElement {
    const element = document.createElement("button");
    element.type = "button";
    element.className = `pad-button ${kind}`;
    element.textContent = label;
    element.setAttribute("aria-label", label);
    let pointer: number | null = null;
    const release = (): void => {
      if (pointer === null) return;
      pointer = null;
      this.held.delete(release);
      element.classList.remove("held");
      this.state.setKey(key, false);
    };
    element.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (pointer !== null) return;
      pointer = event.pointerId;
      capture(element, event.pointerId);
      element.classList.add("held");
      this.state.setKey(key, true);
      this.held.add(release);
      buzz();
    });
    const end = (event: PointerEvent): void => {
      if (event.pointerId === pointer) release();
    };
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", end);
    element.addEventListener("lostpointercapture", end);
    return element;
  }

  private joystick(): HTMLElement {
    const stick = document.createElement("div");
    stick.className = "joystick";
    stick.setAttribute("role", "group");
    stick.setAttribute("aria-label", "Joystick");
    for (const [key, name] of ARROWS) {
      const arrow = document.createElement("span");
      arrow.className = `arrow ${name}`;
      stick.append(arrow);
      this.arrows.set(key, arrow);
    }
    const knob = document.createElement("span");
    knob.className = "knob";
    stick.append(knob);
    this.knob = knob;
    const follow = (event: PointerEvent): void => {
      const box = stick.getBoundingClientRect(),
        radius = box.width / 2,
        dx = event.clientX - (box.left + radius),
        dy = event.clientY - (box.top + box.height / 2),
        // The knob stops at the ring; the thumb may wander past it and still steer.
        reach = radius * 0.55,
        distance = Math.hypot(dx, dy),
        k = distance > reach ? reach / distance : 1;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      this.setDpad(joystickDirection(dx, dy, radius * DEAD_ZONE, this.dpadKey));
    };
    stick.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (this.dpadPointer !== null) return;
      this.dpadPointer = event.pointerId;
      capture(stick, event.pointerId);
      stick.classList.add("active");
      follow(event);
    });
    stick.addEventListener("pointermove", (event) => {
      if (event.pointerId === this.dpadPointer) follow(event);
    });
    const end = (event: PointerEvent): void => {
      if (event.pointerId !== this.dpadPointer) return;
      this.dpadPointer = null;
      this.setDpad(null);
      // Let go: the knob springs back to the middle.
      knob.style.transform = "";
      stick.classList.remove("active");
    };
    stick.addEventListener("pointerup", end);
    stick.addEventListener("pointercancel", end);
    stick.addEventListener("lostpointercapture", end);
    return stick;
  }

  private setDpad(key: PadDirection | null): void {
    if (key === this.dpadKey) return;
    if (this.dpadKey) {
      this.state.setKey(this.dpadKey, false);
      this.arrows.get(this.dpadKey)?.classList.remove("held");
    }
    this.dpadKey = key;
    if (key) {
      this.state.setKey(key, true);
      this.arrows.get(key)?.classList.add("held");
      buzz();
    }
  }
}

/** Keep a moved thumb on the control; a pointer the browser no longer tracks is ignored. */
function capture(element: HTMLElement, pointerId: number): void {
  try {
    element.setPointerCapture?.(pointerId);
  } catch {
    // InvalidPointerId: the press already ended.
  }
}

function buzz(): void {
  try {
    navigator.vibrate?.(8);
  } catch {
    // Some browsers throw instead of ignoring vibration before the first user gesture.
  }
}
