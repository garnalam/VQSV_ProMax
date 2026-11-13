import type { BagRow } from "../game/inventory/Bag";
import { BAG_LAYOUT as L, BAG_VISIBLE_ROWS, type WorldPanel } from "../game/world/WorldPanel";
import { thumbHeight, thumbY } from "../ui/UiScrollbarMath";
import type { PanelFontRenderer } from "./PanelFontRenderer";
import { drawUnifiedItemIcon } from "./UnifiedItemIcon";

/**
 * JavaSE `VqsvPanelRuntime.renderBag`: the redesigned backpack. A dimmed band, a rounded panel with
 * a "LƯNG BAO" header and item count, four coloured tabs, five rounded rows (icon, scrolling name,
 * count pill), the "CHI TIẾT" box, the bar and the two buttons, all in the JavaSE UI font.
 */
export type BagArt = {
  font: PanelFontRenderer;
  /** A baked sprite-258 item icon. */
  icon: (index: number) => HTMLImageElement | undefined;
  /** A unified Item's own PNG by pack key (the Cầu Vồng icons). */
  image?: (key: string) => HTMLImageElement | undefined;
  /** `SpriteAnimator.load(visualId).drawAligned(x, y, w, h, 4, 0)`: state 0, centred in the box. */
  petSprite?: (visualId: number, x: number, y: number, w: number, h: number) => void;
};

const hex = (value: number) => `#${((value & 0xffffff) | 0x1000000).toString(16).slice(1)}`;
const WHITE = 0xffffff;
const TABS = ["Tiêu hao", "Trang sức", "Tài liệu", "Đặc thù"];
const TAB_COLORS = [0x2a9bc3, 0x8b68bb, 0x41a36c, 0xc17b35];

/** `fillRoundRect` / `drawRoundRect` with Java's arc diameter. */
function round(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  arc: number,
  fill: number | null,
  stroke: number | null = null,
): void {
  if (fill !== null) {
    g.fillStyle = hex(fill);
    g.beginPath();
    g.roundRect(x, y, w, h, arc / 2);
    g.fill();
  }
  if (stroke !== null) {
    g.strokeStyle = hex(stroke);
    g.lineWidth = 1;
    g.beginPath();
    g.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, arc / 2);
    g.stroke();
  }
}

/** `darkerBagColor`: 62 % of each channel. */
function darker(rgb: number): number {
  const part = (shift: number) => Math.trunc((((rgb >> shift) & 0xff) * 62) / 100);
  return (part(16) << 16) | (part(8) << 8) | part(0);
}

/** `fitBagText`: cut with "..." until it fits. */
function fit(font: PanelFontRenderer, text: string, width: number): string {
  if (!text || font.taggedWidth(text) <= width) return text;
  let end = text.length;
  while (end > 0 && font.taggedWidth(text.slice(0, end) + "...") > width) end--;
  return end <= 0 ? "..." : `${text.slice(0, end).trim()}...`;
}
/** `drawBagText`: fitted and clipped to its column. */
function text(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  value: string,
  x: number,
  y: number,
  width: number,
  color: number,
): void {
  const fitted = fit(font, value, width);
  g.save();
  g.beginPath();
  g.rect(x, y - 1, Math.max(1, width), font.height + 2);
  g.clip();
  font.drawTagged(g, fitted, x, y, hex(color));
  g.restore();
}
/** `drawBagCenteredText`. */
function centered(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  value: string,
  x: number,
  y: number,
  width: number,
  color: number,
): void {
  const fitted = fit(font, value, width),
    drawX = x + Math.max(0, Math.trunc((width - font.taggedWidth(fitted)) / 2));
  text(g, font, fitted, drawX, y, Math.max(1, width - (drawX - x)), color);
}
/** `drawBagPill`. */
function pill(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  value: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: number,
  color: number,
): void {
  round(g, x, y, w, h, 7, fill, fill === 0xfff16a ? 0xffffff : 0x77b7c5);
  centered(g, font, value, x + 2, y + 3, w - 4, color);
}
/** `drawBagMarquee`: a long name waits 16 ticks, slides to its end, pauses and slides back. */
function marquee(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  value: string,
  x: number,
  y: number,
  width: number,
  color: number,
  tick: number,
): void {
  const textWidth = font.taggedWidth(value);
  let offset = 0;
  if (textWidth > width) {
    const overflow = textWidth - width,
      travel = Math.trunc(Math.max(0, tick - 16) / 3),
      cycle = Math.max(1, overflow * 2 + 32),
      phase = travel % cycle;
    offset = Math.min(overflow, phase <= overflow ? phase : Math.max(0, cycle - phase - 16));
  }
  g.save();
  g.beginPath();
  g.rect(x, y - 1, Math.max(1, width), font.height + 2);
  g.clip();
  font.drawTagged(g, value, x - offset, y, hex(color));
  g.restore();
}
/** `wrapText` + `drawBagWrappedFixed`: at most `lines` lines, the last one ending in "...". */
function wrapped(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  value: string,
  x: number,
  y: number,
  width: number,
  lines: number,
  color: number,
): void {
  const out: string[] = [];
  let line = "";
  for (const word of value.trim().split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.taggedWidth(candidate) <= width || !line) line = candidate;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  g.save();
  g.beginPath();
  g.rect(x, y - 1, Math.max(1, width), lines * (font.height + 1));
  g.clip();
  out.slice(0, lines).forEach((l, i) => {
    const shown =
      i === lines - 1 && out.length > lines ? fit(font, `${l}...`, width) : fit(font, l, width);
    font.drawTagged(g, shown, x, y + i * (font.height + 1), hex(color));
  });
  g.restore();
}
/** `drawBagButton`. */
function button(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  label: string,
  r: { x: number; y: number; w: number; h: number },
  primary: boolean,
  accent: number,
): void {
  if (!label) return;
  round(g, r.x + 2, r.y + 2, r.w, r.h, 7, 0x0b2838);
  round(g, r.x, r.y, r.w, r.h, 7, primary ? accent : 0xb7dce6, primary ? 0xfff16a : 0x467785);
  centered(g, font, label, r.x + 3, r.y + 5, r.w - 6, primary ? WHITE : 0x174f69);
}

export function drawBag(g: CanvasRenderingContext2D, panel: WorldPanel, art: BagArt): void {
  const font = art.font,
    rows: BagRow[] = panel.bagRows,
    tab = panel.bagTab,
    first = Math.max(0, Math.min(panel.listScroll, Math.max(0, rows.length - BAG_VISIBLE_ROWS))),
    accent = TAB_COLORS[tab] ?? TAB_COLORS[0],
    p = L.panel,
    h = L.header;

  g.fillStyle = "rgba(0,18,28,0.518)";
  g.fillRect(0, 32, 240, 263);
  round(g, p.x + 3, p.y + 4, p.w, p.h, 12, 0x071f2d);
  round(g, p.x, p.y, p.w, p.h, 11, 0xc9edf3, 0x174f69);

  round(g, h.x, h.y, h.w, h.h, 8, 0x103f56);
  g.fillRect(h.x, h.y + h.h - 8, h.w, 8);
  g.fillStyle = hex(0xfff16a);
  g.fillRect(h.x, h.y + h.h - 2, h.w, 2);
  centered(g, font, "LƯNG BAO", h.x + 10, h.y + 7, 112, WHITE);
  pill(g, font, `${rows.length} mục`, h.x + 155, h.y + 5, 52, 15, 0xfff16a, 0x5f4818);

  TABS.forEach((label, i) => {
    const t = L.tab,
      x = t.x + i * (t.w + t.gap),
      active = i === tab;
    round(g, x, t.y, t.w, t.h, 6, active ? TAB_COLORS[i] : 0xa8d5df, active ? 0xfff16a : 0x5d9baa);
    if (active) {
      g.fillStyle = hex(0xfff16a);
      g.fillRect(x + 5, t.y + t.h - 3, t.w - 10, 2);
    }
    centered(g, font, label, x + 2, t.y + 6, t.w - 4, active ? WHITE : 0x174f69);
  });

  const c = L.column;
  round(g, c.x, c.y, c.w, c.h, 5, 0x2f7890);
  text(g, font, "VẬT PHẨM", c.x + 8, c.y + 3, 110, WHITE);
  centered(g, font, tab === 1 ? "TRẠNG THÁI" : "SỐ LƯỢNG", c.x + 145, c.y + 3, 57, WHITE);

  const l = L.list;
  for (let i = 0; i < BAG_VISIBLE_ROWS; i++) {
    const index = first + i,
      y = l.y + i * l.stride,
      on = index < rows.length && index === panel.selected;
    if (on) round(g, l.x + 2, y + 2, l.w, l.rowH, 6, 0x092f40);
    round(g, l.x, y, l.w, l.rowH, 6, on ? darker(accent) : 0xe8f7fa, on ? 0xfff16a : 0x83bcca);
    round(g, l.x, y, 5, l.rowH, 5, on ? 0xfff16a : accent);
    const row = rows[index];
    if (!row) {
      centered(g, font, "·", l.x + 8, y + 5, l.w - 16, 0x8cb7c1);
      continue;
    }
    const ix = l.x + L.icon.x,
      iy = y + L.icon.y,
      size = L.icon.size;
    round(g, ix - 2, iy - 2, size + 4, size + 4, 5, on ? 0xffe39a : 0xc5e7ed, 0x174f69);
    // `UnifiedItemIconRenderer.draw` first, the sprite-258 cell when the row has no PNG.
    if (!row.iconKey || !drawUnifiedItemIcon(g, art.image?.(row.iconKey), ix, iy, size, size)) {
      const image = art.icon(row.icon);
      if (image && image.complete && image.naturalWidth > 0) g.drawImage(image, ix, iy);
    }
    marquee(
      g,
      font,
      row.name,
      l.x + L.name.x,
      y + 6,
      L.name.w,
      on ? WHITE : 0x174f69,
      panel.openedTicks,
    );
    // An owned egg narrows its status pill to 38 and adds the "?" preview pill.
    const eggPill = row.egg === true && (row.count ?? 0) > 0;
    pill(
      g,
      font,
      row.status,
      l.x + L.value.x,
      y + 3,
      eggPill ? 38 : L.value.w,
      14,
      on ? 0xfff16a : 0x173f56,
      on ? 0x604817 : WHITE,
    );
    if (eggPill)
      pill(
        g,
        font,
        "?",
        l.x + l.w - 20,
        y + 2,
        18,
        16,
        on ? 0xfff16a : 0x2a9bc3,
        on ? 0x604817 : WHITE,
      );
  }

  const d = L.detail,
    description = rows.length
      ? rows[Math.max(0, Math.min(panel.selected, rows.length - 1))].description
      : "Chưa có vật phẩm trong nhóm này.";
  round(g, d.x, d.y, d.w, d.h, 7, 0x173f56);
  round(g, d.x, d.y, 49, 12, 6, accent);
  round(g, d.x, d.y, d.w, d.h, 7, null, 0xfff16a);
  centered(g, font, "CHI TIẾT", d.x + 3, d.y + 2, 43, WHITE);
  wrapped(g, font, description, d.x + 54, d.y + 3, d.w - 60, 3, WHITE);

  // `drawModernBagScrollbar`: only for a list longer than its window.
  if (rows.length > BAG_VISIBLE_ROWS) {
    const s = L.scroll,
      thumb = thumbHeight(s.h, rows.length, BAG_VISIBLE_ROWS, 9),
      top = thumbY(s.y, s.h, thumb, rows.length, BAG_VISIBLE_ROWS, first);
    round(g, s.x, s.y, s.w, s.h, 4, 0x126f91);
    round(g, s.x - 1, top, s.w + 2, thumb, 4, 0xfff16a);
  }

  button(g, font, panel.bagAction ?? "", L.action, true, accent);
  button(g, font, "Rời đi", L.back, false, accent);
  if (panel.eggPreview) drawEggPreview(g, panel, art);
}

/** `renderEggPreview`: the egg's name, five species rows with their sprite, and "Đóng". */
function drawEggPreview(g: CanvasRenderingContext2D, panel: WorldPanel, art: BagArt): void {
  const preview = panel.eggPreview,
    data = preview ? panel.bagSource.eggPreview(preview.itemId) : null;
  if (!preview || !data) return;
  const font = art.font,
    entries = data.entries,
    x = 12,
    y = 44,
    w = 240 - 24,
    h = 242;
  round(g, x + 3, y + 4, w, h, 10, 0x071f2d);
  round(g, x, y, w, h, 10, 0xc9edf3, 0x174f69);
  round(g, x + 4, y + 4, w - 8, 24, 7, 0x103f56);
  text(g, font, fit(font, data.name, w - 54), x + 12, y + 10, w - 54, WHITE);
  pill(g, font, "?", x + w - 36, y + 8, 22, 16, 0xfff16a, 0x604817);
  const start = Math.min(preview.scroll, Math.max(0, entries.length - 5)),
    rowH = 38;
  for (let i = 0; i < 5; i++) {
    const index = start + i,
      rowY = y + 34 + i * rowH;
    round(g, x + 8, rowY, w - 16, rowH - 3, 6, 0xe8f7fa);
    round(g, x + 8, rowY, w - 16, rowH - 3, 6, null, 0x83bcca);
    const entry = entries[index];
    if (!entry) continue;
    round(g, x + 12, rowY + 4, 30, 28, 5, 0xc5e7ed);
    g.save();
    g.beginPath();
    g.rect(x + 13, rowY + 5, 28, 26);
    g.clip();
    art.petSprite?.(entry.visualId, x + 13, rowY + 5, 28, 26);
    g.restore();
    marquee(g, font, entry.name, x + 50, rowY + 12, w - 66, 0x174f69, panel.openedTicks);
  }
  button(g, font, "Đóng", { x: x + 73, y: y + h - 25, w: w - 146, h: 18 }, true, 0x2a9bc3);
  // The "▲" / "▼" marks: the bitmap font has no arrow glyphs, so they are drawn as triangles.
  if (start > 0) arrow(g, x + w - 17, y + 37, -1);
  if (start < entries.length - 5) arrow(g, x + w - 17, y + h - 45, 1);
}

function arrow(g: CanvasRenderingContext2D, cx: number, top: number, dir: 1 | -1): void {
  g.fillStyle = hex(0x174f69);
  g.beginPath();
  if (dir > 0) {
    g.moveTo(cx - 4, top + 2);
    g.lineTo(cx + 4, top + 2);
    g.lineTo(cx, top + 8);
  } else {
    g.moveTo(cx - 4, top + 8);
    g.lineTo(cx + 4, top + 8);
    g.lineTo(cx, top + 2);
  }
  g.closePath();
  g.fill();
}
