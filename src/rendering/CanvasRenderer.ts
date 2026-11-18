import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from "../core/constants";
import { viewport } from "../core/Viewport";

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
  /** Device pixels per logical pixel (`viewport` landscape keeps 4, see Viewport). */
  private backing = 1;
  private size = { width: LOGICAL_WIDTH, height: LOGICAL_HEIGHT };
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
    const next = Math.max(1, Math.trunc(scale)),
      // Landscape: at least 4 device pixels a logical one, so the 3/4 UI box stays on whole pixels.
      backing = viewport.landscape ? Math.max(4, Math.ceil(next / 4) * 4) : next;
    if (
      next === this.scale &&
      backing === this.backing &&
      this.size.width === viewport.width &&
      this.size.height === viewport.height
    )
      return;
    this.scale = next;
    this.backing = backing;
    this.size = { width: viewport.width, height: viewport.height };
    const canvas = this.context.canvas;
    canvas.width = viewport.width * backing;
    canvas.height = viewport.height * backing;
    // A resize resets the context: the transform and the sampling go with it.
    this.uiSpace();
    this.context.imageSmoothingEnabled = false;
  }
  /** Device pixels per logical pixel of the canvas. */
  get backingScale(): number {
    return this.backing;
  }
  /** Draw in canvas pixels: the world, which fills the whole (landscape) canvas. */
  worldSpace(): void {
    const k = this.backing;
    this.context.setTransform(k, 0, 0, k, 0, 0);
  }
  /**
   * Draw in the 240x320 UI box: the whole canvas in portrait, the box scaled to the canvas height
   * and centred in landscape (`viewport.ui`).
   */
  uiSpace(): void {
    const k = this.backing,
      { scale, x, y } = viewport.ui;
    this.context.setTransform(k * scale, 0, 0, k * scale, k * x, k * y);
  }
  /** Black over the whole canvas, whatever the current transform. */
  clear(): void {
    const g = this.context;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#000";
    g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    g.restore();
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

/** The current fill style over the whole canvas, whatever the transform (fades, flashes, black). */
export function fillCanvas(g: CanvasRenderingContext2D): void {
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillRect(0, 0, g.canvas.width, g.canvas.height);
  g.restore();
}

/** A capture of the whole canvas (`battleBackground`) put back over the whole canvas. */
export function drawCanvasCopy(g: CanvasRenderingContext2D, image: CanvasImageSource, offsetX = 0): void {
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (offsetX !== 0) {
    g.fillStyle = "#000";
    g.fillRect(0, 0, g.canvas.width, g.canvas.height);
  }
  g.drawImage(image, offsetX, 0, g.canvas.width, g.canvas.height);
  g.restore();
}
