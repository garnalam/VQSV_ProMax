import { RIDE_LABELS } from "../game/ride/RideSystem";
import { RIDE_CLOSE, rideCardX, rideCardY, type WorldPanel } from "../game/world/WorldPanel";
import type { PanelFontRenderer } from "./PanelFontRenderer";
import type { SourceUiLayout } from "./SourceUiLayout";

/**
 * JavaSE `VqsvPanelRuntime.renderRide`: the `ride.ui` softkey cells, a pale card sheet with the
 * Liệt Hỏa row (sprite-260 icons) and the Cầu Vồng row (`CauVongRideIcons`), a "?" on a ride not
 * owned and a "×" on one this room forbids, the status line and the close box.
 */
export type RideArt = {
  font: PanelFontRenderer;
  /** A sprite-257 / sprite-260 cell, already cropped to its bounds. */
  cell: (sprite: number, index: number) => HTMLImageElement | undefined;
  /** `CauVongRideIcons.image(index)`, index 0..4 in menu order. */
  rainbowIcon: (index: number) => HTMLImageElement | undefined;
};

const hex = (value: number) => `#${((value & 0xffffff) | 0x1000000).toString(16).slice(1)}`;
const ready = (image: HTMLImageElement | undefined): image is HTMLImageElement =>
  !!image && image.complete && image.naturalWidth > 0;

/** `Graphics.fillRoundRect` (arc diameters, so the corner radius is half). */
function fillRoundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  arc: number,
  color: number,
): void {
  g.fillStyle = hex(color);
  g.beginPath();
  g.roundRect(x, y, w, h, arc / 2);
  g.fill();
}
/** `Graphics.drawRoundRect`: a 1 px outline covering x..x+w, y..y+h. */
function drawRoundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  arc: number,
  color: number,
): void {
  g.strokeStyle = hex(color);
  g.lineWidth = 1;
  g.beginPath();
  g.roundRect(x + 0.5, y + 0.5, w, h, arc / 2);
  g.stroke();
}
/** `Graphics.drawLine`, one pixel wide. */
function drawLine(
  g: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  g.beginPath();
  g.moveTo(x1 + 0.5, y1 + 0.5);
  g.lineTo(x2 + 0.5, y2 + 0.5);
  g.stroke();
}

/** `drawCell`: the widget's alt cell when it has one, else its image cell, at the widget origin. */
function drawWidgetCell(
  g: CanvasRenderingContext2D,
  art: RideArt,
  layout: SourceUiLayout,
  id: number,
): void {
  const widget = layout.widget(id);
  if (!widget) return;
  const alt = widget.altId ?? -1,
    cell = alt >= 0 ? alt : (widget.imageId ?? -1),
    image = cell >= 0 ? art.cell(257, cell) : undefined;
  if (ready(image)) g.drawImage(image, widget.x, widget.y);
}

export function drawRidePanel(
  g: CanvasRenderingContext2D,
  panel: WorldPanel,
  layout: SourceUiLayout,
  art: RideArt,
): void {
  const source = panel.rideSource,
    selected = panel.rideSelected,
    { font } = art,
    text = (value: string, x: number, y: number, color: number) =>
      font.drawTagged(g, value, x, y, hex(color));
  drawWidgetCell(g, art, layout, 1);
  drawWidgetCell(g, art, layout, 2);
  drawWidgetCell(g, art, layout, 3);
  fillRoundRect(g, 8, 141, 224, 173, 8, 0xe7f8fa);
  drawRoundRect(g, 8, 141, 224, 173, 8, 0x1c6c91);
  text(RIDE_LABELS[selected] ?? "", 16, 149, 0x1c6c91);
  text("Liệt Hỏa", 16, 171, 0x94431e);
  text("Cầu Vồng", 16, 237, 0x1c6c91);
  for (let i = 0; i < RIDE_LABELS.length; i++) {
    const unlocked = source.unlocked(i),
      usable = source.usable(i),
      x = rideCardX(i),
      y = rideCardY(i);
    fillRoundRect(g, x, y, 38, 40, 5, i === selected ? 0xffd67b : 0xcce7eb);
    drawRoundRect(g, x, y, 38, 40, 5, i === selected ? 0xe98517 : 0x44899b);
    if (i < 4) {
      const icon = art.cell(260, unlocked ? (i === selected ? i : i + 8) : i + 4);
      if (ready(icon)) g.drawImage(icon, x + 2, y + 2);
    } else {
      const icon = art.rainbowIcon(i - 4);
      if (ready(icon)) g.drawImage(icon, x + 3, y + 2);
    }
    if (!unlocked || !usable)
      text(unlocked ? "×" : "?", x + 27, y + 27, unlocked ? 0xa55a20 : 0x68747c);
  }
  const status = !source.unlocked(selected)
    ? "Chưa mở khóa"
    : source.usable(selected)
      ? "Đã có · Có thể cưỡi"
      : "Đã có · Không dùng ở map này";
  text(status, 16, 297, 0x1c6c91);
  // `drawRideCloseButton`.
  const { x, y, size } = RIDE_CLOSE,
    inset = 6,
    right = x + size - inset,
    bottom = y + size - inset;
  fillRoundRect(g, x, y, size, size, 7, 0x102f3d);
  drawRoundRect(g, x, y, size, size, 7, 0xf4d36b);
  g.strokeStyle = "#ffffff";
  drawLine(g, x + inset, y + inset, right, bottom);
  drawLine(g, right, y + inset, x + inset, bottom);
}
