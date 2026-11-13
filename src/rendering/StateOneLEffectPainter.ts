import {
  lEffectDraws,
  paintLEffectPixels,
  type LEffectPaint,
  type StateOneLEntry,
} from "../game/battle/StateOneLEffect";

/**
 * `VqsvBattleRenderer.drawState1LEffect`: the L's copies of the pet's picture, each coloured by
 * `tintOpaque` / `adjustRgb` / `alphaCopy` and drawn top-left at `state1LEffectX/Y` plus its offset.
 * A coloured copy is made once per picture and colouring, like Java's per-draw images but cached.
 */
export class StateOneLEffectPainter {
  private readonly cache = new Map<string, HTMLCanvasElement>();
  constructor(private readonly picture: (visual: number) => HTMLImageElement) {}

  draw(
    g: CanvasRenderingContext2D,
    entry: StateOneLEntry,
    frame: number,
    x: number,
    y: number,
  ): void {
    const image = this.picture(entry.visual);
    if (!image.complete || image.naturalWidth === 0) return;
    for (const copy of lEffectDraws(entry.row, frame))
      g.drawImage(this.painted(image, entry.visual, copy.paint), x + copy.dx, y + copy.dy);
  }

  private painted(
    image: HTMLImageElement,
    visual: number,
    paint: LEffectPaint,
  ): HTMLImageElement | HTMLCanvasElement {
    if (paint.kind === "base" || (paint.kind === "alpha" && (paint.a < 0 || paint.a > 255)))
      return image;
    const key = `${visual}:${JSON.stringify(paint)}`,
      cached = this.cache.get(key);
    if (cached) return cached;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const g = canvas.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(image, 0, 0);
    const pixels = g.getImageData(0, 0, canvas.width, canvas.height);
    paintLEffectPixels(pixels.data, paint);
    g.putImageData(pixels, 0, 0);
    this.cache.set(key, canvas);
    return canvas;
  }
}
