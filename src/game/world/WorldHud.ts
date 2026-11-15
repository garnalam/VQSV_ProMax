import type { Corner } from "../../core/Viewport";
import type { SourceUiLayout } from "../../rendering/SourceUiLayout";

/**
 * `WorldUi` (Java `VqsvWorldActors.java`): the free-world HUD drawn over the map while no panel owns
 * the frame — the room-name banner that drops in when a room loads, the shortcut toggle and its
 * three animated buttons (task, world map, ride), the x2 speed checkbox and the two softkey plates.
 * State and hit-testing only; `NewGameScreen` draws it.
 */
export type HudButton = "none" | "system" | "menu" | "speed" | "task" | "ride" | "map" | "toggle";

/** `SHORTCUT_TOGGLE_*`: the rounded arrow button that folds the shortcut strip out and back. */
export const SHORTCUT_TOGGLE = { x: 6, y: 276, w: 28, h: 23 } as const;
/** The three shortcut buttons: world.ui widget, sprite-257 animation and code fallback rect. */
export const SHORTCUTS = [
  { button: "task", widget: 2, animation: 6, x: 42, y: 277, w: 44, h: 43 },
  { button: "map", widget: 3, animation: 7, x: 95, y: 278, w: 40, h: 42 },
  { button: "ride", widget: 4, animation: 8, x: 143, y: 277, w: 45, h: 43 },
] as const;
/** `drawSpeedCheckbox`: the box at 198,7 and its wider hit band. */
export const SPEED_CHECKBOX = { boxX: 198, boxY: 7, hit: { x0: 194, x1: 236, y0: 2, y1: 23 } };
/** `ROOM_TITLE_*`: banner widget 1 plays sprite 257 animation 3; the name sits in widget 6. */
export const ROOM_TITLE = { bannerWidget: 1, textWidget: 6, animation: 3, textFrame: 4 } as const;
/** `TASK/MAP/RIDE_SHORTCUT_ANIMATION` slide in over four one-tick frames, then hold frame 4. */
const SHORTCUT_SLIDE_TICKS = 4;
/** The held frame of the shortcut animations lasts 40 ticks, so the slide-out starts at tick 44. */
const SHORTCUT_SLIDE_OUT_AT = 44;

export class WorldHud {
  /** The room name the banner shows, and how far into its animation it is (-1: no banner). */
  roomTitle = "";
  titleTick = -1;
  /** The shortcut strip: open, and how far into its slide (in or out). */
  shortcutsExpanded = false;
  shortcutsClosing = false;
  shortcutTick = 0;
  /** The talk bubble's actor and its animation tick (restarts when it moves to another actor). */
  private promptActor = -1;
  promptTick = 0;

  constructor(private readonly animationTicks: (sprite: number, state: number) => number) {}

  /** `showRoomTitle`: a room load drops the banner with its name (an empty name shows nothing). */
  showRoomTitle(title: string): void {
    this.roomTitle = title.trim();
    this.titleTick = this.roomTitle ? 0 : -1;
  }
  clearRoomTitle(): void {
    this.roomTitle = "";
    this.titleTick = -1;
  }

  /**
   * One world tick. The banner slides in, holds the name, and (a web touch Java skips) slides back
   * out before it clears; the shortcut strip finishes its slide; the bubble follows `promptActor`.
   */
  tick(promptActor: number): void {
    if (this.titleTick >= 0) {
      this.titleTick++;
      if (this.titleTick >= this.animationTicks(257, ROOM_TITLE.animation)) this.clearRoomTitle();
    }
    if (this.shortcutsExpanded) {
      this.shortcutTick++;
      if (this.shortcutsClosing && this.shortcutTick >= SHORTCUT_SLIDE_TICKS) {
        this.shortcutsExpanded = false;
        this.shortcutsClosing = false;
      }
    }
    if (promptActor !== this.promptActor) {
      this.promptActor = promptActor;
      this.promptTick = 0;
    } else if (promptActor >= 0) this.promptTick++;
  }

  /** Ticks into the banner animation, or -1 when no banner is up. */
  get titleAnimationTick(): number {
    return this.titleTick;
  }
  /** The name is drawn while the banner holds its open frame (`ROOM_TITLE_TEXT_FRAME`). */
  get titleTextVisible(): boolean {
    const t = this.titleTick;
    return t >= ROOM_TITLE.textFrame && t < ROOM_TITLE.textFrame + 40;
  }

  /** `toggleShortcutMenu`: unfold (sliding in) or fold (sliding out) the three buttons. */
  toggleShortcuts(): void {
    if (this.shortcutsExpanded && !this.shortcutsClosing) {
      this.shortcutsClosing = true;
      this.shortcutTick = 0;
      return;
    }
    this.shortcutsExpanded = true;
    this.shortcutsClosing = false;
    this.shortcutTick = 0;
  }
  /** Whether the buttons take presses (not while sliding out). */
  get shortcutsOpen(): boolean {
    return this.shortcutsExpanded && !this.shortcutsClosing;
  }
  /** Ticks into the shortcut animation the strip shows now (held frame once slid in). */
  get shortcutAnimationTick(): number {
    return this.shortcutsClosing
      ? SHORTCUT_SLIDE_OUT_AT + this.shortcutTick
      : Math.min(this.shortcutTick, SHORTCUT_SLIDE_TICKS);
  }

  /** `buttonAt`, in Java's order: toggle, speed box, the open shortcuts, then the two plates. */
  /**
   * `(x, y)` is a canvas point; `shift` is where each corner's controls were drawn (`cornerShift`:
   * none in portrait), so every button is tested in its own 240x320 layout coordinates.
   */
  buttonAt(
    layout: SourceUiLayout,
    px: number,
    py: number,
    shift: (corner: Corner) => { x: number; y: number } = () => ({ x: 0, y: 0 }),
  ): HudButton {
    const at = (corner: Corner) => {
      const d = shift(corner);
      return { x: px - d.x, y: py - d.y };
    };
    let { x, y } = at("bl");
    const t = SHORTCUT_TOGGLE;
    if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) return "toggle";
    ({ x, y } = at("tr"));
    const s = SPEED_CHECKBOX.hit;
    if (x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1) return "speed";
    ({ x, y } = at("bl"));
    if (this.shortcutsOpen)
      for (const shortcut of SHORTCUTS)
        if (
          widgetHit(layout, shortcut.widget, x, y, shortcut.x, shortcut.y, shortcut.w, shortcut.h)
        )
          return shortcut.button;
    if (widgetHit(layout, 7, x, y, 1, 303, 18, 17)) return "system";
    ({ x, y } = at("br"));
    if (widgetHit(layout, 5, x, y, 222, 303, 16, 17) || (x >= 188 && y >= 288)) return "menu";
    return "none";
  }
}

/** `WorldUi.widgetHit`: the widget rect (at least the fallback size), else the fallback rect. */
function widgetHit(
  layout: SourceUiLayout,
  id: number,
  x: number,
  y: number,
  fallbackX: number,
  fallbackY: number,
  fallbackW: number,
  fallbackH: number,
): boolean {
  const widget = layout.widget(id),
    left = widget ? widget.x : fallbackX,
    top = widget ? widget.y : fallbackY,
    width = widget ? Math.max(fallbackW, widget.w) : fallbackW,
    height = widget ? Math.max(fallbackH, widget.h) : fallbackH;
  return x >= left && x <= left + width && y >= top && y <= top + height;
}

/**
 * `WorldTalkPromptEngine.sourceEligibleTalkActor`: a plain NPC (source kind 0) whose behaviour is
 * talk (1) or talk-and-turn (18), drawn with a person sprite.
 */
export function talkEligible(actor: {
  sourceKind?: number;
  variant: number;
  sprite: number;
  visible: boolean;
}): boolean {
  if (!actor.visible || (actor.sourceKind ?? 0) !== 0) return false;
  if (actor.variant !== 1 && actor.variant !== 18) return false;
  return (
    actor.sprite <= 85 ||
    actor.sprite === 226 ||
    actor.sprite === 92 ||
    actor.sprite === 102 ||
    actor.sprite === 137
  );
}
/** `SOURCE_PROMPT_*`: sprite 259 animation 13, 40 px above the actor's anchor. */
export const TALK_PROMPT = { sprite: 259, animation: 13, yOffset: 40 } as const;
/**
 * `ChoiceBox`: the source's op35 option box is hardcoded cells on sheet 257, not a `.ui` layout — a
 * frame cell per row, the option centred inside it, and a marker cell on the row the cursor is on.
 * The box has two rows, and every op35 record in the event registry lists a pair, so the cursor's
 * row is the rendered row.
 */
export const CHOICE_BOX = {
  sheet: 257,
  frameCell: 155,
  markerCell: 31,
  x: 78,
  width: 88,
  height: 34,
  rows: 2,
  rowY: [131, 172],
  textX: 84,
  textWidth: 74,
  textY: [135, 176],
  markerX: 150,
  markerY: [138, 179],
  color: "#1c6c91",
} as const;

/** `ChoiceBox.click`: which option row a pointer press landed on, or -1 for none. */
export function choiceRowAt(x: number, y: number, optionCount: number): number {
  for (let row = 0; row < CHOICE_BOX.rows && row < optionCount; row++) {
    const top = CHOICE_BOX.rowY[row];
    if (
      x >= CHOICE_BOX.x &&
      x <= CHOICE_BOX.x + CHOICE_BOX.width &&
      y >= top &&
      y <= top + CHOICE_BOX.height
    )
      return row;
  }
  return -1;
}
