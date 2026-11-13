import { decodeMojibake } from "./TextCodec";
/**
 * The JavaSE text layout rules, ported 1:1 from `vqsv.ui.text`:
 * `UiFont.charWidth` (advances), `UiFont.drawTagged` (line breaking), `TextBox.paginateTagged`
 * (dialog pages) and `TaggedText.visibleLength` (typing length).
 *
 * Advances come from `pack/font/text-metrics.json` (Tahoma 9 as AWT measures it), not from the
 * font the web draws with: where a line breaks, how many pages a dialog has and how many ticks the
 * typewriter needs are game behaviour, and they must match Java whatever glyphs are drawn.
 */
export type TextMetricsDocument = {
  format: "vqsv-text-metrics";
  version: number;
  font: string;
  spaceWord: number;
  widths: Record<string, number>;
};

/** `TaggedText.isHexColorTag`: `#` followed by six hex digits. */
export function isHexColorTag(text: string, index: number): boolean {
  if (index < 0 || index + 6 >= text.length || text[index] !== "#") return false;
  for (let i = index + 1; i <= index + 6; i++) if (!/[0-9a-fA-F]/.test(text[i])) return false;
  return true;
}

/** `TaggedText.isSourceColorTag`: the source's two-character `#0`/`#1`/`#2` colour codes. */
export function isSourceColorTag(text: string, index: number): boolean {
  return (
    index >= 0 &&
    index + 1 < text.length &&
    text[index] === "#" &&
    text[index + 1] >= "0" &&
    text[index + 1] <= "2"
  );
}

/** `TaggedText.visibleLength`: characters the typewriter shows (tags excluded). */
export function visibleLength(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (isHexColorTag(text, i)) i += 6;
    else if (isSourceColorTag(text, i)) i += 1;
    else count++;
  }
  return count;
}

export class TextLayout {
  readonly spaceWord: number;
  private readonly widths: ReadonlyMap<number, number>;

  constructor(document: TextMetricsDocument) {
    if (document.format !== "vqsv-text-metrics") throw new Error("text-metrics: bad format");
    this.spaceWord = document.spaceWord;
    this.widths = new Map(Object.entries(document.widths).map(([k, v]) => [Number(k), v]));
  }

  /** `UiFont.charWidth`. A character Java never measured is a data error, not a guess. */
  charWidth(ch: string): number {
    if (ch === " ") return 3;
    const width = this.widths.get(ch.charCodeAt(0));
    if (width === undefined)
      throw new Error(`text-metrics: no width for U+${ch.charCodeAt(0).toString(16)}`);
    return width;
  }

  has(ch: string): boolean {
    return ch === " " || this.widths.has(ch.charCodeAt(0));
  }

  /** The break rule both `drawTagged` and `paginateTagged` use. */
  private breaksBefore(ch: string, next: number, maxWidth: number): boolean {
    return next > maxWidth - 10 || (ch === " " && next > maxWidth - this.spaceWord);
  }

  /**
   * `TextBox.paginateTagged`: split a tagged message into pages of `maxLines` lines. A space at a
   * line break is dropped; each page starts with the colour in force. Iterates UTF-16 units, as Java.
   *
   * Deviation (owner: Vietnamese must read correctly): each break inside a page is written as `\n`.
   * Java's `drawTagged` re-wraps the page without the dropped space, so the next word slid onto the
   * line and words ran together ("luậtcủ|a"). `StorySceneRuntime` strips the marks (the typed text
   * and its ticks stay Java's) and keeps their offsets, and the dialog box draws those lines.
   */
  paginate(raw: string, maxWidth: number, maxLines: number): string[] {
    const text = decodeMojibake(raw);
    const out: string[] = [];
    let color = "#FFFFFF",
      page = color,
      line = 0,
      width = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "#" && i + 6 < text.length) {
        color = text.substring(i, i + 7);
        page += color;
        i += 6;
        continue;
      }
      const cw = this.charWidth(ch),
        next = width + cw;
      if (this.breaksBefore(ch, next, maxWidth)) {
        line++;
        width = 0;
        if (line >= maxLines) {
          out.push(page);
          page = color;
          line = 0;
        } else page += "\n";
        if (ch === " ") continue;
      }
      page += ch;
      width += cw;
    }
    if (visibleLength(page) > 0 || out.length === 0) out.push(page);
    return out;
  }

  /**
   * The lines `UiFont.drawTagged` draws for already tag-free text: a space at a break starts the
   * next line empty instead of being drawn.
   */
  wrap(raw: string, maxWidth: number): string[] {
    const text = decodeMojibake(raw);
    const lines: string[] = [];
    let line = "",
      width = 0;
    for (const ch of text) {
      if (ch === "\n") {
        lines.push(line);
        line = "";
        width = 0;
        continue;
      }
      const cw = this.charWidth(ch),
        next = width + cw;
      if (this.breaksBefore(ch, next, maxWidth)) {
        lines.push(line);
        line = ch === " " ? "" : ch;
        width = ch === " " ? 0 : cw;
      } else {
        line += ch;
        width = next;
      }
    }
    if (line) lines.push(line);
    return lines;
  }
}
