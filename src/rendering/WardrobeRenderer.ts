import type { WorldPanel } from "../game/world/WorldPanel";
import type { MetaSystemsDocument } from "../game/story/GameAssets";
import type { PanelFontRenderer } from "./PanelFontRenderer";

export type WardrobeArt = {
  font: PanelFontRenderer;
  rainbowPreview: (key: string) => HTMLImageElement | undefined;
  preview: (
    sprite: number,
    state: number,
    tick: number,
  ) => { image: HTMLImageElement; ox: number; oy: number } | undefined;
};
export const fashionName = (key: string) => {
  if (key === "FASH-BASE-NEIL") return "Neil mặc định";
  const lh = /FASH-LH-SPR(\d+)/.exec(key);
  if (lh) return `Liệt Hỏa #${Number(lh[1])}`;
  const cv = /FASH-CV-(?:NPC\d-)?(\d+)/.exec(key);
  return cv ? `Cầu Vồng #${Number(cv[1])}` : "Trang phục";
};
export const fashionLabel = (record: { key: string; displayName?: string }) =>
  record.displayName || fashionName(record.key);
export const color = (value: number) =>
  `#${((value & 0xffffff) | 0x1000000).toString(16).slice(1)}`;
export function rounded(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: number,
  stroke: number,
  radius = 7,
) {
  g.fillStyle = color(fill);
  g.beginPath();
  g.roundRect(x, y, w, h, radius);
  g.fill();
  g.strokeStyle = color(stroke);
  g.beginPath();
  g.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, radius);
  g.stroke();
}
export function label(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  value: string,
  x: number,
  y: number,
  ink = 0xffffff,
) {
  font.drawTagged(g, value, x, y, color(ink));
}
const accent = (kind: "base" | "liet-hoa" | "cau-vong") =>
  kind === "base" ? 0x4ca66a : kind === "liet-hoa" ? 0xe9822b : 0x397fbf;

function sprite(
  g: CanvasRenderingContext2D,
  p: WorldPanel,
  a: WardrobeArt,
  row: MetaSystemsDocument["fashion"]["records"][number],
  x: number,
  y: number,
  w: number,
  h: number,
  alignX: number,
  alignY: number,
) {
  const rainbow = row.kind === "cau-vong" ? a.rainbowPreview(row.key) : undefined,
    state = row.animationBase + (Math.trunc(p.openedTicks / 18) % Math.max(1, row.animationSpan)),
    f = row.kind === "cau-vong" ? undefined : a.preview(row.resourceId, state, p.openedTicks);
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  if (rainbow?.complete && rainbow.naturalWidth) g.drawImage(rainbow, x, y, w, h);
  else if (f) g.drawImage(f.image, x + alignX + f.ox, y + alignY + f.oy);
  else {
    g.fillStyle = color(0x397fbf);
    g.beginPath();
    g.arc(x + w / 2, y + h / 2, Math.min(12, w / 3), 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** Pixel-for-pixel geometry and palette from JavaSE `renderWardrobe`. */
export function drawWardrobe(g: CanvasRenderingContext2D, p: WorldPanel, a: WardrobeArt): void {
  const rows = p.wardrobeRows,
    current = rows[p.selected],
    first = Math.max(0, Math.min(p.listScroll, Math.max(0, rows.length - 5)));
  g.fillStyle = color(0x103846);
  g.fillRect(0, 0, 240, 320);
  rounded(g, 3, 3, 234, 28, 0xbde8d7, 0xbde8d7, 8);
  label(g, a.font, "Tủ thời trang", 8, 11, 0x174f69);
  rounded(g, 194, 8, 35, 18, 0x2f8290, 0x2f8290, 9);
  label(
    g,
    a.font,
    `${rows.filter((r) => p.wardrobeSource.owned(r.key)).length}/${rows.length}`,
    198,
    12,
  );
  for (let slot = 0; slot < 5; slot++) {
    const at = first + slot,
      row = rows[at],
      y = 38 + slot * 38,
      active = at === p.selected;
    if (!row) continue;
    rounded(g, 6, y, 112, 35, active ? 0xffd86b : 0xb7dce6, active ? 0xff7a00 : 0x467785);
    rounded(g, 8, y + 3, 4, 29, accent(row.kind), accent(row.kind), 4);
    rounded(g, 14, y + 4, 28, 28, active ? 0xfff0ba : 0xe8f7f3, active ? 0xfff0ba : 0xe8f7f3, 6);
    sprite(g, p, a, row, 15, y + 5, 26, 26, 13, 23);
    label(g, a.font, fashionLabel(row).slice(0, 12), 46, y + 5, 0x174f69);
    const owned = p.wardrobeSource.owned(row.key),
      state = row.key === p.wardrobeSource.selected() ? "Đang dùng" : owned ? "Đã có" : "Chưa mở";
    label(g, a.font, state, 46, y + 19, owned ? 0x27683a : 0x8a3b3b);
  }
  rounded(g, 120, 38, 6, 190, 0x315d69, 0x315d69, 4);
  const thumb = Math.max(
      8,
      Math.trunc((190 * Math.min(5, rows.length)) / Math.max(5, rows.length)),
    ),
    thumbY = 38 + Math.trunc((190 - thumb) * (first / Math.max(1, rows.length - 5)));
  rounded(g, 120, thumbY, 6, thumb, 0xffd86b, 0xffd86b, 4);
  if (current) {
    rounded(g, 130, 38, 104, 145, 0xe8f7f3, accent(current.kind), 10);
    g.fillStyle = color(0xd5eee9);
    g.beginPath();
    g.ellipse(182, 92, 34, 34, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = color(0x92bdb5);
    g.beginPath();
    g.ellipse(182, 167, 29, 5, 0, 0, Math.PI * 2);
    g.fill();
    sprite(g, p, a, current, 134, 42, 96, 132, 48, 106);
    rounded(g, 130, 188, 104, 90, 0xbde8d7, 0xbde8d7, 8);
    rounded(g, 130, 188, 4, 90, accent(current.kind), accent(current.kind), 4);
    label(g, a.font, fashionLabel(current), 138, 196, 0x174f69);
    const owned = p.wardrobeSource.owned(current.key),
      equipped = current.key === p.wardrobeSource.selected();
    rounded(
      g,
      138,
      216,
      88,
      20,
      equipped ? 0x2f8290 : owned ? 0x4c9560 : 0x7b8589,
      equipped ? 0x2f8290 : owned ? 0x4c9560 : 0x7b8589,
      10,
    );
    label(g, a.font, equipped ? "Đang sử dụng" : owned ? "Đã sở hữu" : "Chưa mở khóa", 145, 221);
  }
  const enabled = !!current && p.wardrobeSource.owned(current.key),
    action =
      current?.key === p.wardrobeSource.selected() ? "Đang mang" : enabled ? "Mang" : "Chưa sở hữu";
  rounded(g, 2, 286, 108, 28, enabled ? 0x123c47 : 0x26383d, enabled ? 0xf2c862 : 0x718489, 0);
  rounded(g, 130, 286, 108, 28, 0x123c47, 0xf2c862, 0);
  label(g, a.font, action, 20, 294, enabled ? 0xffffff : 0xc2cacc);
  label(g, a.font, "Quay lại", 157, 294);
}
