import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from "../core/constants";

/**
 * The 240x320 back buffer. Text is never drawn through the platform font engine here; screens use
 * the bitmap font renderers (`SourceFontRenderer`, `PanelFontRenderer`) so output is identical on
 * every OS and browser.
 *
 * `setScale(3)` is Kim Diễm Long Vương's room (`docs/kim-diem-long-vuong-20261018.md`): the same
 * 240x320 drawing on a 720x960 surface, where a frame image with an HD twin (`hdTwin`) is drawn
 * from the twin, as `MidpTransform.drawRegion` samples the 2x atlas there. Every other image keeps
 * its pixels, scaled nearest-neighbour.
 */
export class CanvasRenderer {
  readonly context: CanvasRenderingContext2D;
  private scale = 1;
  /** The HD cut of a logical frame image, when it has one (`GameAssets.hdTwin`). */
  hdTwin: ((image: HTMLImageElement) => HTMLImageElement | undefined) | null = null;
  /** How much larger than its logical frame an HD twin is (`hd.json` scale). */
  hdScale = 3;
  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas 2D is unavailable");
    this.context = context;
    context.imageSmoothingEnabled = false;
    this.interceptHdFrames(context);
  }
  /** The surface's size in device pixels per logical pixel (1, or 3 in room 98:49). */
  get presentationScale(): number {
    return this.scale;
  }
  setScale(scale: number): void {
    const next = Math.max(1, Math.trunc(scale));
    if (next === this.scale) return;
    this.scale = next;
    const canvas = this.context.canvas;
    canvas.width = LOGICAL_WIDTH * next;
    canvas.height = LOGICAL_HEIGHT * next;
    // A resize resets the context: the transform and the sampling go with it.
    this.context.setTransform(next, 0, 0, next, 0, 0);
    this.context.imageSmoothingEnabled = false;
  }
  clear(): void {
    this.context.fillStyle = "#000";
    this.context.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  }
  image(image: CanvasImageSource, x: number, y: number): void {
    this.context.drawImage(image, Math.floor(x), Math.floor(y));
  }
  centeredImage(image: HTMLImageElement): void {
    this.image(image, (LOGICAL_WIDTH - image.width) / 2, (LOGICAL_HEIGHT - image.height) / 2);
  }
  /**
   * On a scaled surface, a logical frame with a loaded twin is drawn from the twin over the same
   * logical box: `(x, y)` gets the frame's own size, `(x, y, w, h)` is unchanged, and a source
   * rectangle is read from the twin `hdScale` times larger.
   */
  private interceptHdFrames(context: CanvasRenderingContext2D): void {
    const draw = context.drawImage.bind(context) as (...args: unknown[]) => void;
    context.drawImage = ((image: CanvasImageSource, ...rest: number[]) => {
      const twin =
        this.scale > 1 && this.hdTwin && image instanceof HTMLImageElement
          ? this.hdTwin(image)
          : undefined;
      if (!twin || !twin.complete || twin.naturalWidth === 0) return draw(image, ...rest);
      const k = this.hdScale;
      if (rest.length === 2)
        return draw(twin, rest[0], rest[1], twin.naturalWidth / k, twin.naturalHeight / k);
      if (rest.length === 4) return draw(twin, ...rest);
      const [sx, sy, sw, sh, ...destination] = rest;
      return draw(twin, sx * k, sy * k, sw * k, sh * k, ...destination);
    }) as CanvasRenderingContext2D["drawImage"];
  }
}
