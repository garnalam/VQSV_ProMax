import type { PanelFontRenderer } from "./PanelFontRenderer";
import type { SourceUiLayout, SourceUiWidget } from "./SourceUiLayout";

/**
 * The JavaSE overlays over the world pet screen (`VqsvSceneView`): `renderSourcePetSetting` (the
 * `petsetting.ui` menu) and `renderSourceReleaseConfirm` (`msgconfirm.ui` asking to release).
 * Both draw with the JavaSE UI font, as the rest of the game menu does.
 */
export type WorldPetOverlayArt = {
  font: PanelFontRenderer;
  cell: (index: number) => HTMLImageElement | undefined;
};

const hex = (value: number) => `#${((value & 0xffffff) | 0x1000000).toString(16).slice(1)}`;
const token = (value: number | undefined) => value ?? 0;
const usable = (value: number) => value !== 0 && value !== -1;

function cellTopLeft(
  g: CanvasRenderingContext2D,
  art: WorldPetOverlayArt,
  index: number,
  x: number,
  y: number,
) {
  if (index < 0) return;
  const image = art.cell(index);
  if (image && image.complete && image.naturalWidth > 0) g.drawImage(image, x, y);
}

/** `drawPetSettingBand`: the widget's `jColor` (or the code colour) over its band height. */
function band(
  g: CanvasRenderingContext2D,
  layout: SourceUiLayout,
  id: number,
  height: number,
  fallback: number,
) {
  const w = layout.widget(id);
  if (!w) return;
  const j = token(w.jColor ?? w.j_color);
  g.fillStyle = hex(usable(j) ? j : fallback);
  g.fillRect(w.x, w.y, Math.max(1, w.w), Math.max(1, layout.bandHeight(id, height)));
}

/** `drawPetSettingWidgetCell`: the alt cell when selected, else the image (alt when none). */
function settingCell(
  g: CanvasRenderingContext2D,
  art: WorldPetOverlayArt,
  w: SourceUiWidget | undefined,
  on: boolean,
) {
  if (!w) return;
  const alt = token(w.altId);
  let index = on && alt >= 0 ? alt : token(w.imageId);
  if (index < 0) index = alt;
  cellTopLeft(g, art, index, w.x, w.y);
}

/** `petsetting.ui` row widgets in menu order. */
const SETTING_ROW_WIDGETS = [5, 6, 7, 8, 10, 9];

/** `renderSourcePetSetting`: six of the menu's rows from `scroll`, the cursor's in its alt cell. */
export function drawPetSetting(
  g: CanvasRenderingContext2D,
  layout: SourceUiLayout,
  art: WorldPetOverlayArt,
  labels: readonly string[],
  cursor: number,
  scroll: number,
): void {
  band(g, layout, 1, 8, 13038591);
  band(g, layout, 2, 104, 12444911);
  band(g, layout, 3, 12, 7129979);
  settingCell(g, art, layout.widget(4), false);
  SETTING_ROW_WIDGETS.forEach((id, slot) => {
    const index = scroll + slot;
    if (index >= labels.length) return;
    const w = layout.widget(id),
      on = index === cursor;
    if (!w) return;
    settingCell(g, art, w, on);
    // `drawPetSettingText`: a 76 px column starting 18 px left of the widget, centred for b == 4.
    const label = labels[index];
    if (!label) return;
    const j = token(w.jColor ?? w.j_color),
      l = token(w.lColor ?? w.l_color),
      color = on && usable(j) ? j : usable(l) ? l : 1862801,
      width = Math.max(w.w, 76),
      x =
        w.b === 4
          ? w.x - 18 + Math.max(0, Math.trunc((width - art.font.taggedWidth(label)) / 2))
          : w.x;
    g.save();
    g.beginPath();
    g.rect(w.x - 18, w.y - 1, width, Math.max(12, layout.h(id, 12)));
    g.clip();
    art.font.drawTagged(g, label, x, w.y, hex(color & 0xffffff));
    g.restore();
  });
}

/**
 * `drawPromptSoftkeyText`: the label is drawn off screen, cropped to its ink, shrunk to fit the
 * widget less a pixel each side, and centred in it.
 */
function promptSoftkeyText(
  g: CanvasRenderingContext2D,
  layout: SourceUiLayout,
  art: WorldPetOverlayArt,
  id: number,
  text: string,
  color: number,
): void {
  const w = layout.widget(id);
  if (!w || !text) return;
  const width = Math.max(1, layout.w(id, 44)),
    height = Math.max(14, layout.h(id, 13)),
    scratch = document.createElement("canvas");
  scratch.width = Math.max(1, art.font.taggedWidth(text) + 4);
  scratch.height = height + 4;
  const sg = scratch.getContext("2d")!;
  art.font.drawTagged(sg, text, 2, 2, hex(color));
  const data = sg.getImageData(0, 0, scratch.width, scratch.height).data;
  let minX = scratch.width,
    minY = scratch.height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < scratch.height; y++)
    for (let x = 0; x < scratch.width; x++)
      if (data[(y * scratch.width + x) * 4 + 3] > 0) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
  if (maxX < 0) return;
  let dw = maxX - minX + 1,
    dh = maxY - minY + 1;
  const sw = dw,
    sh = dh,
    fitW = Math.max(1, width - 2),
    fitH = Math.max(1, height - 2);
  if (dw > fitW) {
    dh = Math.max(1, Math.trunc((dh * fitW) / dw));
    dw = fitW;
  }
  if (dh > fitH) {
    dw = Math.max(1, Math.trunc((dw * fitH) / dh));
    dh = fitH;
  }
  g.save();
  g.beginPath();
  g.rect(w.x, w.y - 1, width, height);
  g.clip();
  g.imageSmoothingEnabled = false;
  g.drawImage(
    scratch,
    minX,
    minY,
    sw,
    sh,
    w.x + Math.max(0, Math.trunc((width - dw) / 2)),
    w.y + Math.max(0, Math.trunc((height - dh) / 2)),
    dw,
    dh,
  );
  g.restore();
}

/** `sourceWidgetColor`: the widget's `lColor`, or the code colour. */
function widgetColor(layout: SourceUiLayout, id: number, fallback: number): number {
  const l = token(layout.widget(id)?.lColor ?? layout.widget(id)?.l_color);
  return usable(l) ? l & 0xffffff : fallback;
}

/** `renderSourceReleaseConfirm`. */
export function drawReleaseConfirm(
  g: CanvasRenderingContext2D,
  layout: SourceUiLayout,
  art: WorldPetOverlayArt,
  message: string,
  action: string,
): void {
  const frame = layout.widget(1),
    frameCell = frame && token(frame.altId) >= 0 ? token(frame.altId) : 124;
  cellTopLeft(g, art, frameCell, layout.x(1, 50), layout.y(1, 137));
  // `drawPromptMessageText`: centred in widget 4, 28 px tall.
  const x = layout.x(4, 50),
    y = layout.y(4, 137),
    width = layout.w(4, 150);
  g.save();
  g.beginPath();
  g.rect(x, y, width, 28);
  g.clip();
  art.font.drawTagged(
    g,
    message,
    x + Math.max(0, Math.trunc((width - art.font.taggedWidth(message)) / 2)),
    y + 9,
    hex(widgetColor(layout, 4, 1862801)),
  );
  g.restore();
  // `drawPromptSoftkeyBackground` (cell 15 plates) and their labels.
  for (const [id, fx, fy, label] of [
    [2, 1, 296, action],
    [3, 196, 296, "Quay lại"],
  ] as const) {
    const w = layout.widget(id),
      alt = token(w?.altId);
    cellTopLeft(g, art, w && alt >= 0 ? alt : 15, layout.x(id, fx), layout.y(id, fy));
    promptSoftkeyText(g, layout, art, id, label, widgetColor(layout, id, 0xffffff));
  }
}
