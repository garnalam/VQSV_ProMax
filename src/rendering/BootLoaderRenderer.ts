import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from "../core/constants";
import type { BootProgress } from "../pack/BootProgress";

/** Source bar geometry, copied from `VqsvMapLoadingRuntime.render`. */
const BAR_FRAME_X = 45,
  BAR_FRAME_Y = LOGICAL_HEIGHT - 48,
  BAR_X = 46,
  BAR_Y = LOGICAL_HEIGHT - 47,
  BAR_TRACK_WIDTH = 148,
  BAR_HEIGHT = 3,
  LABEL_BASELINE = LOGICAL_HEIGHT - 70;

/**
 * The frame the game paints while the pack is still arriving. The canvas gets its first pixels here
 * because nothing else has run yet: the screens only start once every boot resource is decoded, so
 * without this the player would watch a black rectangle and could not tell a slow load from a crash.
 *
 * The bar is the source map-loading bar, but it is filled with something real: the share of pack
 * files the startup asked for that have come back. The list of files grows while it loads (the room
 * and sprite indexes name theirs), so a share of what is known so far is only allowed to reach
 * SHOWCASE_CAP of the track until every known file has come back — otherwise the bar would read
 * full at a tenth of the load. The count beside it is never rounded or capped.
 *
 * Its label is the one exception to the bitmap-font rule, drawn with the platform font, because the
 * game font is itself one of the files loading.
 */
export class BootLoaderRenderer {
  /** The most the bar shows while files are still outstanding, as a share of the 148 px track. */
  private static readonly showcaseCap = 0.95;
  private running = false;
  private handle = 0;

  constructor(
    private readonly context: CanvasRenderingContext2D,
    private readonly progress: BootProgress,
  ) {}

  /** Whether the startup has everything it asked for. */
  private finished(): boolean {
    return this.progress.total > 0 && this.progress.loaded === this.progress.total;
  }

  /** How far the fill reaches, 0..148. Never shrinks, so a late burst of files cannot undo it. */
  progressPixels(): number {
    const share = this.finished()
      ? 1
      : Math.min(BootLoaderRenderer.showcaseCap, this.progress.fraction());
    return Math.round(BAR_TRACK_WIDTH * share);
  }

  label(): string {
    return `Đang tải tài nguyên ${this.progress.loaded}/${this.progress.total}`;
  }

  draw(): void {
    const g = this.context;
    g.fillStyle = "#000000";
    g.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    g.fillRect(BAR_FRAME_X, BAR_FRAME_Y, 150, 5);
    g.fillStyle = "#783322";
    g.fillRect(BAR_X, BAR_Y, BAR_TRACK_WIDTH, BAR_HEIGHT);
    g.fillStyle = "#feee84";
    g.fillRect(BAR_X, BAR_Y, this.progressPixels(), BAR_HEIGHT);
    g.fillStyle = "#ffffff";
    g.font = "9px monospace";
    g.textAlign = "center";
    g.fillText(this.label(), LOGICAL_WIDTH / 2, LABEL_BASELINE);
  }

  /** Draws every animation frame until `stop`; the first frame is painted immediately. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.draw();
    const frame = (): void => {
      if (!this.running) return;
      this.draw();
      this.handle = requestAnimationFrame(frame);
    };
    this.handle = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    if (this.handle) cancelAnimationFrame(this.handle);
    this.handle = 0;
  }
}
