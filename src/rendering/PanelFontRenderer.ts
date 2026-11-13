import { decodeMojibake } from "./text/TextCodec";
import { isHexColorTag, isSourceColorTag } from "./text/TextLayout";

/** `UiFont.sourceTagColor('2')`. */
export const SOURCE_HIGHLIGHT = "#d85a00";

type FontManifest = { height: number; glyphs: Record<string, { x: number; w: number }> };
export class PanelFontRenderer {
  private readonly tinted = new Map<string, HTMLCanvasElement>();
  constructor(
    private readonly image: HTMLImageElement,
    private readonly manifest: FontManifest,
  ) {}
  width(raw: string): number {
    const text = decodeMojibake(raw);
    return Array.from(text).reduce(
      (sum, ch) => sum + (this.manifest.glyphs[String(ch.codePointAt(0))]?.w ?? 0),
      0,
    );
  }
  get height(): number {
    return this.manifest.height;
  }
  draw(context: CanvasRenderingContext2D, raw: string, x: number, y: number, color: string): void {
    const text = decodeMojibake(raw),
      atlas = this.colored(color);
    let cursor = x;
    for (const ch of text) {
      const glyph = this.manifest.glyphs[String(ch.codePointAt(0))];
      if (!glyph) continue;
      context.drawImage(
        atlas,
        glyph.x,
        0,
        glyph.w,
        this.manifest.height,
        Math.floor(cursor),
        Math.floor(y),
        glyph.w,
        this.manifest.height,
      );
      cursor += glyph.w;
    }
  }
  /** `UiFont.taggedWidth`: the advance of the visible characters, colour tags skipped. */
  taggedWidth(raw: string): number {
    const text = decodeMojibake(raw);
    let width = 0;
    for (let i = 0; i < text.length; i++) {
      if (isHexColorTag(text, i)) i += 6;
      else if (isSourceColorTag(text, i)) i += 1;
      else width += this.manifest.glyphs[String(text.codePointAt(i))]?.w ?? 0;
    }
    return width;
  }
  /**
   * `UiFont.drawTaggedLine`: `#RRGGBB` switches colour, `#2` is the source's highlight (0xD85A00),
   * `#0`/`#1` return to the line's colour. Brackets around a highlighted place are drawn as text.
   */
  drawTagged(
    context: CanvasRenderingContext2D,
    raw: string,
    x: number,
    y: number,
    color: string,
  ): void {
    const text = decodeMojibake(raw);
    let cursor = x,
      run = "",
      ink = color;
    const flush = () => {
      if (!run) return;
      this.draw(context, run, cursor, y, ink);
      cursor += this.width(run);
      run = "";
    };
    for (let i = 0; i < text.length; i++) {
      if (isHexColorTag(text, i)) {
        flush();
        ink = `#${text.slice(i + 1, i + 7).toLowerCase()}`;
        i += 6;
      } else if (isSourceColorTag(text, i)) {
        flush();
        ink = text[i + 1] === "2" ? SOURCE_HIGHLIGHT : color;
        i += 1;
      } else run += text[i];
    }
    flush();
  }
  centered(
    context: CanvasRenderingContext2D,
    text: string,
    x: number,
    width: number,
    y: number,
    color: string,
  ): void {
    this.draw(context, text, x + Math.floor((width - this.width(text)) / 2), y, color);
  }
  private colored(color: string): HTMLCanvasElement {
    const cached = this.tinted.get(color);
    if (cached) return cached;
    const canvas = document.createElement("canvas");
    canvas.width = this.image.width;
    canvas.height = this.image.height;
    const g = canvas.getContext("2d")!;
    g.drawImage(this.image, 0, 0);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = color;
    g.fillRect(0, 0, canvas.width, canvas.height);
    this.tinted.set(color, canvas);
    return canvas;
  }
}
