import { decodeMojibake } from "../text/TextCodec";
import { LOGICAL_WIDTH } from "../../core/constants";
import { sourceTextWidth, type SourceFontData } from "./SourceFont";

/**
 * Draws text with the game's own bitmap font (font.bin). Output is identical on every OS and
 * browser because nothing goes through the platform text rasteriser.
 */
export class SourceFontRenderer {
  private readonly tinted = new Map<string, HTMLCanvasElement>();
  private atlas: HTMLCanvasElement | null = null;

  constructor(readonly data: SourceFontData) {}

  get height(): number {
    return this.data.height;
  }

  get ascent(): number {
    return this.data.ascent;
  }

  width(text: string): number {
    return sourceTextWidth(this.data, decodeMojibake(text));
  }

  /** Draw with the glyph cell's top-left at (x, top). */
  draw(
    context: CanvasRenderingContext2D,
    text: string,
    x: number,
    top: number,
    color: string,
  ): void {
    const atlas = this.colored(color);
    text = decodeMojibake(text);
    let cursor = Math.floor(x);
    const y = Math.floor(top);
    for (const ch of text) {
      const glyph = this.data.glyphs.get(ch.codePointAt(0)!);
      if (!glyph) continue;
      if (glyph.w > 0)
        context.drawImage(
          atlas,
          glyph.x,
          0,
          glyph.w,
          this.data.height,
          cursor,
          y,
          glyph.w,
          this.data.height,
        );
      cursor += glyph.w;
    }
  }

  /** Java `Graphics.drawString(text, x, baseline)` placement. */
  drawAtBaseline(
    context: CanvasRenderingContext2D,
    text: string,
    x: number,
    baseline: number,
    color: string,
  ): void {
    this.draw(context, text, x, baseline - this.data.ascent, color);
  }

  /** Horizontally centred on the logical screen, Java baseline placement. */
  centeredAtBaseline(
    context: CanvasRenderingContext2D,
    text: string,
    baseline: number,
    color: string,
  ): void {
    this.drawAtBaseline(
      context,
      text,
      Math.floor((LOGICAL_WIDTH - this.width(text)) / 2),
      baseline,
      color,
    );
  }

  /** Right edge at x, Java baseline placement. */
  rightAtBaseline(
    context: CanvasRenderingContext2D,
    text: string,
    right: number,
    baseline: number,
    color: string,
  ): void {
    this.drawAtBaseline(context, text, right - this.width(text), baseline, color);
  }

  private colored(color: string): HTMLCanvasElement {
    const cached = this.tinted.get(color);
    if (cached) return cached;
    const base = this.whiteAtlas(),
      canvas = document.createElement("canvas");
    canvas.width = base.width;
    canvas.height = base.height;
    const g = canvas.getContext("2d")!;
    g.drawImage(base, 0, 0);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = color;
    g.fillRect(0, 0, canvas.width, canvas.height);
    this.tinted.set(color, canvas);
    return canvas;
  }

  private whiteAtlas(): HTMLCanvasElement {
    if (this.atlas) return this.atlas;
    const { atlasWidth, height, mask } = this.data,
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, atlasWidth);
    canvas.height = Math.max(1, height);
    const g = canvas.getContext("2d")!,
      image = g.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      image.data[i * 4] =
        image.data[i * 4 + 1] =
        image.data[i * 4 + 2] =
        image.data[i * 4 + 3] =
          255;
    }
    g.putImageData(image, 0, 0);
    this.atlas = canvas;
    return canvas;
  }
}
