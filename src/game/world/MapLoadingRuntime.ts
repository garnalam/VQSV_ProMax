import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from "../../core/constants";

/**
 * `VqsvMapLoadingRuntime` — the source `game.f` state9 screen the game shows instead of the world
 * while a room is being swapped. Nothing about it is real progress: the bar is a fixed ramp of ten
 * pixels a tick and the screen ends on the tick count, not on the map actually being decoded.
 */
export const MAP_LOADING_TOTAL_TICKS = 16;

/** `SOURCE_BAR_WIDTH`: the track and the most the progress fill ever reaches. */
const SOURCE_BAR_WIDTH = 148;

/** The ramp is `elapsedTicks * 10`, so the bar is full four ticks before the screen closes. */
const PROGRESS_PIXELS_PER_TICK = 10;

/** The seed label JavaSE writes in the trace for this draw. */
export const MAP_LOADING_TIP_LABEL = "game.f state9 map-loading tip";

/** `SOURCE_TIPS`: the seven elemental reminders, in Java's order. */
export const MAP_LOADING_TIPS = [
  "Hỏa hệ khắc mộc hệ",
  "Mộc hệ khắc thổ hệ",
  "Thổ hệ khắc thủy hệ",
  "Thủy hệ khắc hỏa hệ",
  "Quỷ hệ khắc phong hệ",
  "Phong hệ khắc điện hệ",
  "Điện hệ khắc quỷ hệ",
] as const;

/** `VqsvSourceRandom.a(label, bound)`: one draw on the session's source stream. */
export type SourceRandomDraw = (label: string, bound: number) => number;

export class MapLoadingRuntime {
  private elapsedTicks = 0;
  private isActive = true;

  private constructor(readonly tipIndex: number) {}

  /** `begin()`: one draw on the source stream picks the tip, and the ramp starts empty. */
  static begin(draw: SourceRandomDraw): MapLoadingRuntime {
    return new MapLoadingRuntime(draw(MAP_LOADING_TIP_LABEL, MAP_LOADING_TIPS.length));
  }

  get active(): boolean {
    return this.isActive;
  }

  /** `tick()`: one tick of the ramp; the last tick still owns the frame it is called on. */
  tick(): boolean {
    if (!this.isActive) return false;
    this.elapsedTicks++;
    if (this.elapsedTicks >= MAP_LOADING_TOTAL_TICKS) this.isActive = false;
    return true;
  }

  /** `progressPixels()`: the fake ramp, clamped to the track. */
  progressPixels(): number {
    return Math.min(SOURCE_BAR_WIDTH, this.elapsedTicks * PROGRESS_PIXELS_PER_TICK);
  }

  get tip(): string {
    return MAP_LOADING_TIPS[this.tipIndex];
  }

  /**
   * `render()`: black over the whole 240x320 frame — the world is not drawn under it — then the
   * source bar geometry (black frame, brown track, pale-yellow fill) and the tip centred above it.
   */
  render(
    g: CanvasRenderingContext2D,
    font: { width: (text: string) => number; draw: PanelFontDraw },
  ): void {
    g.fillStyle = "#000000";
    g.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    g.fillRect(45, LOGICAL_HEIGHT - 48, 150, 5);
    g.fillStyle = "#783322";
    g.fillRect(46, LOGICAL_HEIGHT - 47, SOURCE_BAR_WIDTH, 3);
    g.fillStyle = "#feee84";
    g.fillRect(46, LOGICAL_HEIGHT - 47, this.progressPixels(), 3);
    const x = Math.max(0, Math.floor((LOGICAL_WIDTH - font.width(this.tip)) / 2));
    font.draw(g, this.tip, x, LOGICAL_HEIGHT - 70, "#ffffff");
  }
}

/** The pack font's own draw signature, kept structural so the runtime needs no renderer class. */
export type PanelFontDraw = (
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
) => void;
