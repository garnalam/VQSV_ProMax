/**
 * `vqsv.text.VqsvTextCodec.decodeMojibake`, which JavaSE runs on every string before it measures or
 * draws it (`TextBox.decodeMojibake`):
 *
 * - NFC: part of the game text spells a tone as a separate combining mark (`trư` + U+0301 + `ng`).
 *   The fonts only carry precomposed letters, so without composing them the mark is dropped and
 *   "trứng" shows as "trưng", "ấ" as "â", "ế" as "ê".
 * - Mojibake: a UTF-8 string that was once read as windows-1252 ("áº¥" for "ấ") is turned back,
 *   at most four times, and only when the round trip is exact (otherwise the text is left alone).
 */

/** windows-1252's 0x80..0x9F row; the holes (0x81, 0x8D, 0x8F, 0x90, 0x9D) cannot be encoded. */
const CP1252_HIGH: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** `decodeOnce`: strict windows-1252 bytes read back as strict UTF-8, or the text unchanged. */
function decodeOnce(text: string): string {
  const bytes: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) bytes.push(cp);
    else if (CP1252_HIGH[cp] !== undefined) bytes.push(CP1252_HIGH[cp]);
    else return text;
  }
  try {
    return utf8.decode(new Uint8Array(bytes));
  } catch {
    return text;
  }
}

/** `looksMojibake`: the lead bytes of a misread UTF-8 sequence. */
const looksMojibake = (text: string) => /[ÃÂÄÅÆâáÁ€]/.test(text);

const cache = new Map<string, string>();
const CACHE_LIMIT = 4096;

/** The string as JavaSE shows it. Cached: the renderers call it for every label every frame. */
export function decodeMojibake(text: string): string {
  if (!text) return text;
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  let current = text.normalize("NFC");
  for (let i = 0; i < 4 && looksMojibake(current); i++) {
    const decoded = decodeOnce(current);
    if (decoded === current) break;
    current = decoded.normalize("NFC");
  }
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(text, current);
  return current;
}
