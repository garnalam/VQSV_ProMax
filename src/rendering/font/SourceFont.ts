/**
 * Decoder for the original game's bitmap font, `modules/root_misc/original/font.bin`.
 *
 * Layout (big-endian, as written by J2ME `DataOutputStream`):
 *   u16        length of the character table in bytes
 *   u8[length] character table, (modified) UTF-8: glyph i is the i-th character
 *   u8         glyph height in pixels
 *   u8[n]      advance width of each glyph (n = number of characters)
 *   bits       one 1-bit strip, sum(widths) pixels wide and `height` rows tall; each row is
 *              ceil(width / 8) bytes, least-significant bit is the leftmost pixel
 *
 * No Java or baking step is involved: the web ships font.bin itself and decodes it at boot.
 */
export type SourceGlyph = { x: number; w: number };

export type SourceFontData = {
  height: number;
  /** Pixel rows above the baseline (Java `drawString` y is the baseline). */
  ascent: number;
  atlasWidth: number;
  glyphs: ReadonlyMap<number, SourceGlyph>;
  /** atlasWidth * height coverage mask, 1 = ink. */
  mask: Uint8Array;
};

/** Java `DataInput.readUTF` decoding (modified UTF-8: also accepts the 2-byte NUL form). */
function decodeModifiedUtf8(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length;) {
    const a = bytes[i++];
    if (a < 0x80) out += String.fromCharCode(a);
    else if ((a & 0xe0) === 0xc0) {
      const b = bytes[i++];
      out += String.fromCharCode(((a & 0x1f) << 6) | (b & 0x3f));
    } else if ((a & 0xf0) === 0xe0) {
      const b = bytes[i++],
        c = bytes[i++];
      out += String.fromCharCode(((a & 0x0f) << 12) | ((b & 0x3f) << 6) | (c & 0x3f));
    } else throw new Error(`font.bin: malformed UTF byte 0x${a.toString(16)} at ${i - 1}`);
  }
  return out;
}

export function decodeSourceFont(bytes: Uint8Array): SourceFontData {
  if (bytes.length < 3) throw new Error("font.bin: truncated header");
  const tableLength = (bytes[0] << 8) | bytes[1];
  let offset = 2 + tableLength;
  const chars = decodeModifiedUtf8(bytes.subarray(2, offset));
  const height = bytes[offset++];
  const count = chars.length;
  if (offset + count > bytes.length) throw new Error("font.bin: truncated width table");
  const widths = bytes.subarray(offset, offset + count);
  offset += count;

  const glyphs = new Map<number, SourceGlyph>();
  let atlasWidth = 0;
  for (let i = 0; i < count; i++) {
    const cp = chars.charCodeAt(i);
    if (!glyphs.has(cp)) glyphs.set(cp, { x: atlasWidth, w: widths[i] });
    atlasWidth += widths[i];
  }
  const stride = Math.ceil(atlasWidth / 8);
  if (offset + stride * height > bytes.length)
    throw new Error(
      `font.bin: bitmap needs ${stride * height} bytes, has ${bytes.length - offset}`,
    );

  const mask = new Uint8Array(atlasWidth * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < atlasWidth; x++)
      if (bytes[offset + y * stride + (x >> 3)] & (1 << (x & 7))) mask[y * atlasWidth + x] = 1;

  return { height, ascent: baselineOf(glyphs, mask, atlasWidth, height), atlasWidth, glyphs, mask };
}

/** The baseline sits under the last inked row of "A" (a glyph with no descender). */
function baselineOf(
  glyphs: ReadonlyMap<number, SourceGlyph>,
  mask: Uint8Array,
  atlasWidth: number,
  height: number,
): number {
  const a = glyphs.get(0x41);
  if (!a) return height;
  for (let y = height - 1; y >= 0; y--)
    for (let x = a.x; x < a.x + a.w; x++) if (mask[y * atlasWidth + x]) return y + 1;
  return height;
}

/** Sum of advances; characters missing from the table take no space (and draw nothing). */
export function sourceTextWidth(font: SourceFontData, text: string): number {
  let width = 0;
  for (const ch of text) width += font.glyphs.get(ch.codePointAt(0)!)?.w ?? 0;
  return width;
}
