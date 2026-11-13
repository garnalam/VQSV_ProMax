import { SHOP_UI } from "../game/world/WorldPanel";
import { thumbHeight, thumbY } from "../ui/UiScrollbarMath";
import { decodeMojibake } from "./text/TextCodec";
import type { PanelFontRenderer } from "./PanelFontRenderer";

/**
 * JavaSE's "modern" shop panels (`VqsvPanelRuntime`: `drawShopPanelBase`, `drawBagText`,
 * `drawBagCenteredText`, `drawBagMarquee`, `drawBagPill`, `drawBagButton`,
 * `drawModernPanelShopScrollbar`, `UnifiedItemIconRenderer.draw`), shared by the charm manager
 * and the portable shop. Java2D shapes are reproduced pixel for pixel: a `fillRoundRect` arc is a
 * diameter, a `drawRoundRect` outline covers x..x+w.
 */
export const hex = (value: number) => `#${((value & 0xffffff) | 0x1000000).toString(16).slice(1)}`;
export const ready = (image: HTMLImageElement | undefined): image is HTMLImageElement =>
  !!image && image.complete && image.naturalWidth > 0;

export function fillRoundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  arc: number,
  color: string,
): void {
  g.fillStyle = color;
  g.beginPath();
  g.roundRect(x, y, w, h, arc / 2);
  g.fill();
}
export function drawRoundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  arc: number,
  color: string,
): void {
  g.strokeStyle = color;
  g.lineWidth = 1;
  g.beginPath();
  g.roundRect(x + 0.5, y + 0.5, w, h, arc / 2);
  g.stroke();
}

/** `darkerBagColor`: 62% of each channel. */
export const darker = (rgb: number) =>
  (((((rgb >> 16) & 0xff) * 62) / 100) << 16) |
  (((((rgb >> 8) & 0xff) * 62) / 100) << 8) |
  (((rgb & 0xff) * 62) / 100);

/** `fitBagText`: cut with "..." to fit. */
export function fit(font: PanelFontRenderer, text: string, width: number): string {
  if (!text || font.taggedWidth(text) <= width) return text ?? "";
  let end = text.length;
  while (end > 0 && font.taggedWidth(`${text.slice(0, end)}...`) > width) end--;
  return end <= 0 ? "..." : `${text.slice(0, end).trim()}...`;
}
export function clipped(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  x: number,
  y: number,
  width: number,
  draw: () => void,
): void {
  g.save();
  g.beginPath();
  g.rect(x, y - 1, Math.max(1, width), font.height + 2);
  g.clip();
  draw();
  g.restore();
}
/** `drawBagText`. */
export function bagText(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  text: string,
  x: number,
  y: number,
  width: number,
  color: number,
): void {
  const fitted = fit(font, decodeMojibake(text ?? ""), width);
  clipped(g, font, x, y, width, () => font.drawTagged(g, fitted, x, y, hex(color)));
}
/** `drawBagCenteredText`. */
export function bagCentered(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  text: string,
  x: number,
  y: number,
  width: number,
  color: number,
): void {
  const fitted = fit(font, decodeMojibake(text ?? ""), width),
    drawX = x + Math.max(0, Math.trunc((width - font.taggedWidth(fitted)) / 2));
  bagText(g, font, fitted, drawX, y, Math.max(1, width - (drawX - x)), color);
}
/** `drawBagMarquee`: a line wider than its box scrolls after 16 ticks, three ticks a pixel. */
export function bagMarquee(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  text: string,
  x: number,
  y: number,
  width: number,
  color: number,
  tick: number,
): void {
  const decoded = decodeMojibake(text ?? ""),
    textWidth = font.taggedWidth(decoded);
  let offset = 0;
  if (textWidth > width) {
    const overflow = textWidth - width,
      travel = Math.trunc(Math.max(0, tick - 16) / 3),
      cycle = Math.max(1, overflow * 2 + 32),
      phase = travel % cycle;
    offset = Math.min(overflow, phase <= overflow ? phase : Math.max(0, cycle - phase - 16));
  }
  clipped(g, font, x, y, width, () => font.drawTagged(g, decoded, x - offset, y, hex(color)));
}
/** `drawBagPill`. */
export function bagPill(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: number,
  textColor: number,
): void {
  fillRoundRect(g, x, y, width, height, 7, hex(fill));
  drawRoundRect(g, x, y, width - 1, height - 1, 7, fill === 0xfff16a ? "#ffffff" : "#77b7c5");
  bagCentered(g, font, text, x + 2, y + 3, width - 4, textColor);
}
/** `drawBagButton`. */
export function bagButton(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  primary: boolean,
  accent: number,
): void {
  fillRoundRect(g, x + 2, y + 2, width, height, 7, "#0b2838");
  fillRoundRect(g, x, y, width, height, 7, hex(primary ? accent : 0xb7dce6));
  drawRoundRect(g, x, y, width - 1, height - 1, 7, primary ? "#fff16a" : "#467785");
  bagCentered(g, font, text, x + 3, y + 5, width - 6, primary ? 0xffffff : 0x174f69);
}
/** `drawShopPanelBase`. */
export function shopPanelBase(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  title: string,
  accent: number,
): void {
  g.fillStyle = "rgba(0, 18, 28, 0.5176)";
  g.fillRect(0, 32, 240, 263);
  fillRoundRect(g, 15, 46, 216, 246, 12, "#071f2d");
  fillRoundRect(g, 12, 42, 216, 246, 11, "#c8e9e8");
  drawRoundRect(g, 12, 42, 215, 245, 11, "#174f69");
  const header = hex(darker(accent));
  fillRoundRect(g, 15, 45, 210, 27, 8, header);
  g.fillStyle = header;
  g.fillRect(15, 45 + 27 - 8, 210, 8);
  g.fillStyle = "#f2c862";
  g.fillRect(15, 45 + 27 - 2, 210, 2);
  bagCentered(g, font, title, 22, 53, 132, 0xffffff);
}
/** `drawModernPanelShopScrollbar`. */
export function shopScrollbar(g: CanvasRenderingContext2D, size: number, scroll: number): void {
  if (size <= SHOP_UI.visibleRows) return;
  const x = 218,
    y = SHOP_UI.listY,
    h = SHOP_UI.rowH + (SHOP_UI.visibleRows - 1) * SHOP_UI.rowStride;
  fillRoundRect(g, x, y, 4, h, 4, "#245d67");
  const thumbH = thumbHeight(h, size, SHOP_UI.visibleRows, 9),
    top = thumbY(y, h, thumbH, size, SHOP_UI.visibleRows, scroll);
  fillRoundRect(g, x - 1, top, 6, thumbH, 4, "#f2c862");
}
/** `UnifiedItemIconRenderer.draw`: scaled to fit, nearest neighbour, centred. */
export function itemIcon(
  g: CanvasRenderingContext2D,
  image: HTMLImageElement | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (!ready(image)) return;
  const scale = Math.min(width / Math.max(1, image.width), height / Math.max(1, image.height)),
    w = Math.max(1, Math.round(image.width * scale)),
    h = Math.max(1, Math.round(image.height * scale));
  const smoothing = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = false;
  g.drawImage(image, x + Math.trunc((width - w) / 2), y + Math.trunc((height - h) / 2), w, h);
  g.imageSmoothingEnabled = smoothing;
}

/** `wrapText`: words onto lines no wider than `width` (a lone long word keeps its own line). */
export function wrapWords(font: PanelFontRenderer, text: string, width: number): string[] {
  const clean = decodeMojibake(text ?? "").trim();
  if (!clean) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of clean.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.taggedWidth(candidate) <= width || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
/** `drawBagWrappedFixed`: at most `maxLines` lines, the last cut with "..." when more remain. */
export function bagWrappedFixed(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  text: string,
  x: number,
  y: number,
  width: number,
  maxLines: number,
  color: number,
): void {
  const lines = wrapWords(font, text, width);
  g.save();
  g.beginPath();
  g.rect(x, y - 1, Math.max(1, width), maxLines * (font.height + 1));
  g.clip();
  for (let i = 0; i < Math.min(maxLines, lines.length); i++) {
    const line =
      i === maxLines - 1 && lines.length > maxLines
        ? fit(font, `${lines[i]}...`, width)
        : fit(font, lines[i], width);
    font.drawTagged(g, line, x, y + i * (font.height + 1), hex(color));
  }
  g.restore();
}
