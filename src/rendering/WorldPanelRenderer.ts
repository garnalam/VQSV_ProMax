import type { WorldPanel } from "../game/world/WorldPanel";
import { thumbHeight, thumbY } from "../ui/UiScrollbarMath";
import {
  GAME_MENU_SCROLLBAR,
  GAME_MENU_VISIBLE_ROWS,
  MENU_LABELS,
  MENU_ROW_WIDGETS,
  TASK_OPTION_ROWS,
  TASK_ROW_BACKGROUNDS,
  TASK_ROW_NAMES,
  TASK_ROW_NUMBERS,
  TASK_ROW_STATUS,
  TASK_SCROLLBAR,
  TASK_VISIBLE_ROWS,
} from "../game/world/WorldPanel";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
import type { PanelFontRenderer } from "./PanelFontRenderer";
import type { SourceUiLayout, SourceUiWidget } from "./SourceUiLayout";
import { HELP_CONTROLS, HELP_EFFECT_LABELS } from "../game/system/HelpContent";

/**
 * Paints the free-world softkey plates and the two panels they open. Every rectangle, cell id and
 * colour comes from the baked `world.ui`/`gamemenu.ui`/`gamesystem.ui` layouts and the sprite-257 cells,
 * so the geometry is the source's own rather than a hand-placed approximation.
 */
export type WorldPanelArt = {
  cell: (index: number) => HTMLImageElement | undefined;
  cellFor?: (sprite: number, index: number) => HTMLImageElement | undefined;
  font: PanelFontRenderer;
};
export type WorldPanelCurrency = { badges: number; money: number };

const hex = (value: number) => `#${((value & 0xffffff) | 0x1000000).toString(16).slice(1)}`;
const token = (value: number | undefined) => (value === undefined ? 0 : value);

/** `VqsvPanelRuntime.color`: an absent widget or a 0/-1 colour token keeps the caller's fallback. */
export function widgetColor(widget: SourceUiWidget | undefined, fallback: number): number {
  const value = token(widget?.lColor ?? widget?.l_color);
  return !widget || value === 0 || value === -1 ? fallback : value & 0xffffff;
}
/** `VqsvPanelRuntime.colorSelected`. */
export function selectedColor(widget: SourceUiWidget): number {
  const value = token(widget.jColor ?? widget.j_color);
  return value === 0 || value === -1 ? 0xffa500 : value & 0xffffff;
}
/** `drawRows`: the selected row swaps to the widget's alt cell. */
function rowCell(widget: SourceUiWidget, isSelected: boolean): number {
  return isSelected ? token(widget.altId) : token(widget.imageId);
}
/** `drawCell`/`drawSoftkey`: the alt cell whenever the widget has one. */
function widgetCell(widget: SourceUiWidget): number {
  const alt = token(widget.altId);
  return alt >= 0 ? alt : token(widget.imageId);
}

function cellImage(art: WorldPanelArt, index: number): HTMLImageElement | undefined {
  if (index < 0) return undefined;
  const image = art.cell(index);
  return image && image.complete && image.naturalWidth > 0 ? image : undefined;
}

/** `drawCellTopLeft`: a baked cell is already cropped to its bounds, so its origin is the top-left. */
export function drawCellTopLeft(
  g: CanvasRenderingContext2D,
  art: WorldPanelArt,
  cell: number,
  x: number,
  y: number,
): void {
  const image = cellImage(art, cell);
  if (image) g.drawImage(image, x, y);
}

export function drawWidgetCell(
  g: CanvasRenderingContext2D,
  art: WorldPanelArt,
  layout: SourceUiLayout,
  id: number,
): void {
  const widget = layout.widget(id);
  if (!widget) return;
  drawCellTopLeft(g, art, widgetCell(widget), widget.x, widget.y);
}

/** `WorldUi.drawWidgetCell`: the plate falls back to its code cell and position when the layout lacks it. */
function drawWorldPlate(
  g: CanvasRenderingContext2D,
  art: WorldPanelArt,
  layout: SourceUiLayout,
  id: number,
  fallbackCell: number,
  fallbackX: number,
  fallbackY: number,
): void {
  const widget = layout.widget(id),
    alt = token(widget?.altId);
  drawCellTopLeft(
    g,
    art,
    widget && alt >= 0 ? alt : fallbackCell,
    widget ? widget.x : fallbackX,
    widget ? widget.y : fallbackY,
  );
}

/** The two free-world plates: `world.ui` widget 7 opens the system panel, widget 5 the game menu. */
export function drawWorldPlates(
  g: CanvasRenderingContext2D,
  art: WorldPanelArt,
  layout: SourceUiLayout,
): void {
  drawWorldPlate(g, art, layout, 7, 167, 1, 303);
  drawWorldPlate(g, art, layout, 5, 68, 222, 303);
}

export function fillBand(
  g: CanvasRenderingContext2D,
  layout: SourceUiLayout,
  id: number,
  fallbackColor: number,
  fallbackHeight: number,
): void {
  const widget = layout.widget(id);
  if (!widget) return;
  const value = token(widget.jColor ?? widget.j_color);
  g.fillStyle = hex(value === 0 || value === -1 ? fallbackColor : value & 0xffffff);
  g.fillRect(
    widget.x,
    widget.y,
    Math.max(1, widget.w),
    Math.max(1, layout.bandHeight(id, fallbackHeight)),
  );
}

/** `activeTextColor`: the widget's selected-row colour (`gColor`), or the caller's fallback. */
function activeColor(widget: SourceUiWidget | undefined, fallback: number): number {
  const value = token(widget?.gColor ?? widget?.g_color);
  return !widget || value === 0 || value === -1 ? fallback : value & 0xffffff;
}

/**
 * `drawTextWide`: the widget clips its own column (shifted by `dx`, `width` wide) and a `b === 4`
 * label centres inside the width. Colour tags are honoured (`drawTaggedLine`).
 */
export function drawTextWide(
  g: CanvasRenderingContext2D,
  art: WorldPanelArt,
  layout: SourceUiLayout,
  id: number,
  text: string,
  dx: number,
  width: number,
  color: number,
): void {
  const widget = layout.widget(id);
  if (!widget || !text) return;
  const w = Math.max(1, width);
  g.save();
  g.beginPath();
  g.rect(widget.x + dx, widget.y - 1, w + 6, Math.max(12, layout.h(id, 12)));
  g.clip();
  const offset = widget.b === 4 ? Math.max(0, Math.trunc((w - art.font.taggedWidth(text)) / 2)) : 0;
  art.font.drawTagged(g, text, widget.x + dx + offset, widget.y, hex(color));
  g.restore();
}

/** `drawText`: `drawTextWide` over the widget's own width. */
export function drawText(
  g: CanvasRenderingContext2D,
  art: WorldPanelArt,
  layout: SourceUiLayout,
  id: number,
  text: string,
  color: number,
): void {
  drawTextWide(
    g,
    art,
    layout,
    id,
    text,
    0,
    layout.w(id, Math.max(1, art.font.taggedWidth(text))),
    color,
  );
}

/**
 * `drawTextMarquee`: a label wider than its column scrolls left two pixels a tick, then wraps in
 * from the right; one that fits stays put (centred for `b === 4`).
 */
export function drawTextMarquee(
  g: CanvasRenderingContext2D,
  art: WorldPanelArt,
  layout: SourceUiLayout,
  id: number,
  text: string,
  width: number,
  color: number,
  tick: number,
): void {
  const widget = layout.widget(id);
  if (!widget || !text) return;
  const w = Math.max(1, width),
    textWidth = art.font.taggedWidth(text);
  let x = widget.x;
  if (textWidth > w) {
    let scroll = Math.max(0, tick * 2);
    if (scroll > textWidth - w)
      scroll = -w + ((scroll - (textWidth - w)) % Math.max(1, textWidth + w));
    x = widget.x - scroll;
  } else if (widget.b === 4) x = widget.x + Math.max(0, Math.trunc((w - textWidth) / 2));
  g.save();
  g.beginPath();
  g.rect(widget.x, widget.y - 1, w, Math.max(12, layout.h(id, 12)));
  g.clip();
  art.font.drawTagged(g, text, x, widget.y, hex(color));
  g.restore();
}

/** `wrapText`: greedy word wrap on the panel font's tagged widths; an over-long word keeps its line. */
function wrapText(art: WorldPanelArt, text: string, width: number): string[] {
  const clean = text.trim();
  if (!clean) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of clean.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (art.font.taggedWidth(candidate) <= width || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * `drawWrappedTextBoxScrolled`: `#n` breaks paragraphs, the rest wraps to `width`; a box too short
 * for its text holds for 18 ticks and then rolls up a pixel every three ticks, looping.
 */
export function drawWrappedTextBoxScrolled(
  g: CanvasRenderingContext2D,
  art: WorldPanelArt,
  layout: SourceUiLayout,
  id: number,
  text: string,
  width: number,
  height: number,
  color: number,
  tick: number,
): void {
  const widget = layout.widget(id);
  if (!widget || !text) return;
  const w = Math.max(1, width),
    fontHeight = art.font.height,
    h = Math.max(fontHeight + 1, height),
    lines = text.split("#n").flatMap((paragraph) => wrapText(art, paragraph, w)),
    lineStep = fontHeight + 1,
    total = lines.length * lineStep;
  let offset = 0;
  if (total > h) {
    const maxOffset = Math.max(1, total - h + lineStep);
    offset = Math.trunc(Math.max(0, tick - 18) / 3) % maxOffset;
  }
  g.save();
  g.beginPath();
  g.rect(widget.x, widget.y, w, h);
  g.clip();
  let y = widget.y - offset;
  for (const line of lines) {
    if (y > widget.y + h) break;
    if (y >= widget.y - fontHeight && line) art.font.drawTagged(g, line, widget.x, y, hex(color));
    y += lineStep;
  }
  g.restore();
}

/** `drawSoftkey`: the cell is the plate and its label sits vertically centred inside the cell bounds. */
export function drawSoftkey(
  g: CanvasRenderingContext2D,
  art: WorldPanelArt,
  layout: SourceUiLayout,
  id: number,
  text: string,
  fallbackColor: number,
): void {
  const widget = layout.widget(id);
  if (!widget) return;
  const cell = widgetCell(widget),
    image = cellImage(art, cell),
    width = image ? image.naturalWidth : Math.max(1, layout.w(id, 43)),
    height = image ? image.naturalHeight : Math.max(12, layout.h(id, 20));
  drawCellTopLeft(g, art, cell, widget.x, widget.y);
  if (!text) return;
  g.save();
  g.beginPath();
  g.rect(widget.x, widget.y - 1, Math.max(1, width), Math.max(12, height));
  g.clip();
  const x = widget.x + Math.trunc((width - art.font.width(text)) / 2),
    y = widget.y + Math.max(0, Math.trunc((height - art.font.height) / 2)) + 1,
    color =
      token(widget.lColor ?? widget.l_color) === -1 ? 0xffffff : widgetColor(widget, fallbackColor);
  art.font.draw(g, text, x, y, hex(color));
  g.restore();
}

export function drawRows(
  g: CanvasRenderingContext2D,
  art: WorldPanelArt,
  layout: SourceUiLayout,
  widgets: readonly number[],
  labels: readonly string[],
  selected: number,
): void {
  for (let index = 0; index < widgets.length; index++) {
    const widget = layout.widget(widgets[index]);
    if (!widget) continue;
    drawCellTopLeft(g, art, rowCell(widget, index === selected), widget.x, widget.y);
    drawText(
      g,
      art,
      layout,
      widgets[index],
      labels[index],
      index === selected ? selectedColor(widget) : widgetColor(widget, 0x1c6c92),
    );
  }
}

/** `drawGameMenuRows`: the six slots draw the scrolled window of the nine labels. */
function drawGameMenuRows(
  g: CanvasRenderingContext2D,
  art: WorldPanelArt,
  layout: SourceUiLayout,
  panel: WorldPanel,
): void {
  const first = panel.firstVisibleRow;
  for (let slot = 0; slot < GAME_MENU_VISIBLE_ROWS; slot++) {
    const index = first + slot;
    if (index >= MENU_LABELS.length) break;
    const widget = layout.widget(MENU_ROW_WIDGETS[slot]);
    if (!widget) continue;
    drawCellTopLeft(g, art, rowCell(widget, index === panel.selected), widget.x, widget.y);
    drawText(
      g,
      art,
      layout,
      MENU_ROW_WIDGETS[slot],
      MENU_LABELS[index],
      index === panel.selected ? selectedColor(widget) : widgetColor(widget, 0x1c6c92),
    );
  }
}

function drawGameMenuScrollbar(g: CanvasRenderingContext2D, panel: WorldPanel): void {
  if (MENU_LABELS.length <= GAME_MENU_VISIBLE_ROWS) return;
  const { x, y, w, h, minThumbHeight } = GAME_MENU_SCROLLBAR,
    thumb = thumbHeight(h, MENU_LABELS.length, GAME_MENU_VISIBLE_ROWS, minThumbHeight),
    top = thumbY(y, h, thumb, MENU_LABELS.length, GAME_MENU_VISIBLE_ROWS, panel.listScroll);
  g.fillStyle = hex(0x6cb7bb);
  g.fillRect(x, y, w, h);
  g.fillStyle = hex(0xc6f0ff);
  g.fillRect(x, top, w, thumb);
  g.strokeStyle = hex(0x1c6c91);
  g.strokeRect(x, top, w - 1, Math.max(1, thumb - 1));
}

function renderGameMenu(
  g: CanvasRenderingContext2D,
  art: WorldPanelArt,
  layout: SourceUiLayout,
  panel: WorldPanel,
  currency: WorldPanelCurrency,
): void {
  fillBand(g, layout, 2, 0xc6f0ff, 7);
  fillBand(g, layout, 3, 0xbee7f2, 102);
  fillBand(g, layout, 4, 0x6cb7bb, 8);
  drawWidgetCell(g, art, layout, 1);
  drawWidgetCell(g, art, layout, 13);
  drawGameMenuRows(g, art, layout, panel);
  drawGameMenuScrollbar(g, panel);
  drawText(
    g,
    art,
    layout,
    10,
    layout.text(10, "Menu tro choi"),
    widgetColor(layout.widget(10), 0xd0010e),
  );
  drawText(g, art, layout, 14, panel.menuTitle, widgetColor(layout.widget(14), 0xd0010e));
  drawSoftkey(g, art, layout, 12, layout.text(12, "Xac dinh"), 0xd0010e);
  drawSoftkey(g, art, layout, 11, layout.text(11, "Quay lai"), 0xd0010e);
  drawWidgetCell(g, art, layout, 16);
  drawWidgetCell(g, art, layout, 17);
  drawText(g, art, layout, 18, String(currency.badges), widgetColor(layout.widget(18), 0x1c6c91));
  drawText(g, art, layout, 19, String(currency.money), widgetColor(layout.widget(19), 0x1c6c91));
}

function renderGameSystem(
  g: CanvasRenderingContext2D,
  art: WorldPanelArt,
  layout: SourceUiLayout,
  panel: WorldPanel,
): void {
  fillBand(g, layout, 3, 0xc6f0ff, 7);
  fillBand(g, layout, 4, 0xbee7f2, 102);
  fillBand(g, layout, 5, 0x6cb7bb, 8);
  drawWidgetCell(g, art, layout, 1);
  drawRows(g, art, layout, panel.rowWidgets, panel.labels, panel.selected);
  drawText(
    g,
    art,
    layout,
    2,
    layout.text(2, "He thong menu"),
    widgetColor(layout.widget(2), 0xd0010e),
  );
  drawSoftkey(g, art, layout, 10, layout.text(10, "Xac dinh"), 0xffffff);
  drawSoftkey(g, art, layout, 11, layout.text(11, "Quay lai"), 0xffffff);
}

function drawHelpFrame(
  g: CanvasRenderingContext2D,
  art: WorldPanelArt,
  layout: SourceUiLayout,
): void {
  fillBand(g, layout, 3, 0xc6f0ff, 9);
  fillBand(g, layout, 1, 0xbee7f2, 158);
  fillBand(g, layout, 2, 0x6cb7bb, 8);
  drawWidgetCell(g, art, layout, 4);
  drawWidgetCell(g, art, layout, 6);
}

function renderHelp(
  g: CanvasRenderingContext2D,
  art: WorldPanelArt,
  layout: SourceUiLayout,
  panel: WorldPanel,
): void {
  drawHelpFrame(g, art, layout);
  drawText(g, art, layout, 5, "Trợ giúp", widgetColor(layout.widget(5), 0xd0010e));
  drawText(g, art, layout, 6, layout.text(6, "Quay lại"), widgetColor(layout.widget(6), 0xffffff));
  drawText(g, art, layout, 39, `${panel.helpPage + 1}/3`, widgetColor(layout.widget(39), 0x1c6c91));
  if (panel.helpPage > 0) drawWidgetCell(g, art, layout, 37);
  if (panel.helpPage < 2) drawWidgetCell(g, art, layout, 38);
  if (panel.helpPage === 0) {
    drawWrappedTextBoxScrolled(g, art, layout, 8, HELP_CONTROLS, 130, 149, 0x1c6c91, 0);
    return;
  }
  for (let row = 0; row < 14; row++) {
    const entry = (panel.helpPage - 1) * 14 + row,
      iconId = 9 + row * 2,
      textId = iconId + 1,
      icon = layout.widget(iconId);
    if (entry >= HELP_EFFECT_LABELS.length) continue;
    const image = art.cellFor?.(325, entry + 1);
    if (icon && image) g.drawImage(image, icon.x, icon.y);
    drawTextWide(g, art, layout, textId, HELP_EFFECT_LABELS[entry], 0, 44, 0x1c6c91);
  }
}

function renderSettings(
  g: CanvasRenderingContext2D,
  art: WorldPanelArt,
  layout: SourceUiLayout,
  panel: WorldPanel,
): void {
  drawHelpFrame(g, art, layout);
  drawWidgetCell(g, art, layout, 7);
  drawText(g, art, layout, 5, "Tùy chọn", widgetColor(layout.widget(5), 0xd0010e));
  drawTextWide(
    g,
    art,
    layout,
    7,
    panel.systemSource.speedX2() ? "x2: Bật" : "x2: Tắt",
    0,
    52,
    0xffffff,
  );
  drawTextWide(g, art, layout, 9, layout.text(9, "Âm lượng"), 0, 42, 0x1c6c91);
  for (let id = 10; id <= 12; id++) {
    const widget = layout.widget(id);
    if (!widget) continue;
    g.fillStyle = hex(id - 9 <= panel.settingsLevel ? 0xfff79c : 0x7da884);
    g.fillRect(widget.x, widget.y, Math.max(5, widget.w), 12);
    g.strokeStyle = hex(0x31526b);
    g.strokeRect(widget.x + 0.5, widget.y + 0.5, Math.max(5, widget.w), 12);
  }
  const enabled = panel.systemSource.speedX2();
  g.fillStyle = hex(0xd8f7ff);
  g.fillRect(84, 179, 74, 20);
  g.strokeStyle = hex(enabled ? 0xd0010e : 0x1c6c91);
  g.strokeRect(88.5, 184.5, 10, 10);
  if (enabled) {
    g.beginPath();
    g.moveTo(90, 189);
    g.lineTo(92, 192);
    g.lineTo(97, 186);
    g.stroke();
  }
  art.font.draw(g, "Speed x2", 104, 185, hex(enabled ? 0xd0010e : 0x1c6c91));
}

function renderOptionConfirm(
  g: CanvasRenderingContext2D,
  art: WorldPanelArt,
  layout: SourceUiLayout,
  panel: WorldPanel,
): void {
  for (const [row, bgId, textId, iconId, label] of [
    [0, 10, 12, 8, "Có"],
    [1, 11, 13, 9, "Không"],
  ] as const) {
    const bg = layout.widget(bgId),
      icon = layout.widget(iconId);
    if (bg) drawCellTopLeft(g, art, 155, bg.x, bg.y);
    if (row === panel.selected && bg) {
      g.strokeStyle = hex(0xffa500);
      g.strokeRect(bg.x - 0.5, bg.y - 0.5, Math.max(1, bg.w), 23);
    }
    if (row === panel.selected && icon) drawCellTopLeft(g, art, 31, icon.x, icon.y);
    drawText(g, art, layout, textId, label, row === panel.selected ? 0xffa500 : 0x1c6c91);
  }
}

/** `renderSave`: the `msgtip.ui` plate and message; the two softkey icons only while it asks. */
function renderSave(
  g: CanvasRenderingContext2D,
  art: WorldPanelArt,
  layout: SourceUiLayout,
  panel: WorldPanel,
): void {
  drawWidgetCell(g, art, layout, 1);
  drawText(g, art, layout, 2, panel.saveMessage, widgetColor(layout.widget(2), 0x1c6c91));
  if (panel.savePhase === 0) {
    drawWidgetCell(g, art, layout, 3);
    drawWidgetCell(g, art, layout, 4);
  }
}

/** `drawCellState`: the alt cell when the state is on, otherwise the widget's own image. */
function drawCellState(
  g: CanvasRenderingContext2D,
  art: WorldPanelArt,
  layout: SourceUiLayout,
  id: number,
  on: boolean,
): void {
  const widget = layout.widget(id);
  if (!widget) return;
  const alt = token(widget.altId);
  drawCellTopLeft(g, art, on && alt >= 0 ? alt : token(widget.imageId), widget.x, widget.y);
}

/** `TASK_TAB_SELECTED_COLOR`. */
const TASK_TAB_SELECTED = 0xac4800;

/** JavaSE `drawTaskScrollbar`: the 72 px track, and a thumb sized and placed by the scroll. */
function drawTaskScrollbar(
  g: CanvasRenderingContext2D,
  layout: SourceUiLayout,
  rowCount: number,
  scroll: number,
): void {
  const track = layout.widget(39),
    thumbWidget = layout.widget(40);
  if (!track || !thumbWidget) return;
  const trackHeight = TASK_SCROLLBAR.h,
    jColor = (w: SourceUiWidget, fallback: number) => {
      const v = token(w.jColor ?? w.j_color);
      return (v === 0 || v === -1 ? fallback : v) & 0xffffff;
    };
  g.fillStyle = hex(jColor(track, 0x51d069));
  g.fillRect(track.x, track.y, Math.max(1, track.w), trackHeight);
  const thumb = thumbHeight(
      trackHeight,
      rowCount,
      TASK_VISIBLE_ROWS,
      TASK_SCROLLBAR.minThumbHeight,
    ),
    top = thumbY(track.y, trackHeight, thumb, rowCount, TASK_VISIBLE_ROWS, scroll);
  g.fillStyle = hex(jColor(thumbWidget, 0xc6f0ff));
  g.fillRect(thumbWidget.x, top, Math.max(1, thumbWidget.w), Math.max(8, thumb));
}

/** `renderTask`: the two tabs, five rows, the objective box and the completion line. */
function renderTask(
  g: CanvasRenderingContext2D,
  art: WorldPanelArt,
  layout: SourceUiLayout,
  panel: WorldPanel,
  progress: string,
): void {
  // `drawTaskFrame`.
  drawWidgetCell(g, art, layout, 1);
  fillBand(g, layout, 3, 0xbde8d7, 10);
  fillBand(g, layout, 4, 0xbde8d7, 13);
  fillBand(g, layout, 5, 0xbde8d7, 93);
  drawWidgetCell(g, art, layout, 35);
  fillBand(g, layout, 39, 0x51d069, 72);
  drawWidgetCell(g, art, layout, 41);
  drawWidgetCell(g, art, layout, 42);

  const tab = panel.taskTab;
  drawTextWide(
    g,
    art,
    layout,
    2,
    layout.text(2, "Nhiem vu"),
    -28,
    80,
    widgetColor(layout.widget(2), 0xd0010e),
  );
  drawCellState(g, art, layout, 6, tab === 0);
  drawCellState(g, art, layout, 7, tab === 1);
  drawTextWide(
    g,
    art,
    layout,
    8,
    layout.text(8, "Nhiem vu chinh"),
    -2,
    64,
    tab === 0 ? TASK_TAB_SELECTED : widgetColor(layout.widget(8), 0x00009a),
  );
  drawTextWide(
    g,
    art,
    layout,
    9,
    layout.text(9, "Nhiem vu phu"),
    -2,
    64,
    tab === 1 ? TASK_TAB_SELECTED : widgetColor(layout.widget(9), 0x00009a),
  );
  drawSoftkey(g, art, layout, 41, layout.text(41, "Xac dinh"), 0xffffff);
  drawSoftkey(g, art, layout, 42, layout.text(42, "Quay lai"), 0xffffff);

  const rows = panel.taskRows,
    selected = clamp(panel.selected, 0, Math.max(0, rows.length - 1)),
    first = panel.visibleListStart(rows.length);
  for (let i = 0; i < TASK_ROW_BACKGROUNDS.length; i++) {
    const index = first + i,
      isSelected = index === selected,
      bg = layout.widget(TASK_ROW_BACKGROUNDS[i]);
    if (bg) drawCellTopLeft(g, art, token(isSelected ? bg.altId : bg.imageId), bg.x, bg.y);
    if (index >= rows.length) continue;
    const row = rows[index],
      rowColor = (id: number, active: number) =>
        isSelected
          ? activeColor(layout.widget(id), active)
          : widgetColor(layout.widget(id), 0x1c6c91);
    drawText(
      g,
      art,
      layout,
      TASK_ROW_NUMBERS[i],
      String(row.number),
      rowColor(TASK_ROW_NUMBERS[i], 0xef29cc),
    );
    const name = layout.widget(TASK_ROW_NAMES[i]),
      status = layout.widget(TASK_ROW_STATUS[i]),
      nameWidth =
        !name || !status ? layout.w(TASK_ROW_NAMES[i], 72) : Math.max(1, status.x - name.x - 10);
    drawTextMarquee(
      g,
      art,
      layout,
      TASK_ROW_NAMES[i],
      row.title,
      nameWidth,
      rowColor(TASK_ROW_NAMES[i], 0xef29cc),
      isSelected ? panel.openedTicks : 0,
    );
    drawTextWide(
      g,
      art,
      layout,
      TASK_ROW_STATUS[i],
      row.completed ? "Hoàn thành" : "",
      0,
      layout.w(TASK_ROW_STATUS[i], 24),
      rowColor(TASK_ROW_STATUS[i], 0xef29cc),
    );
  }
  const detail = rows.length ? rows[selected].detail : "";
  drawWrappedTextBoxScrolled(
    g,
    art,
    layout,
    36,
    detail,
    layout.w(36, 128),
    30,
    activeColor(layout.widget(36), 0x000000),
    panel.openedTicks,
  );
  drawText(
    g,
    art,
    layout,
    37,
    tab === 0 ? "Đầu mối chính hoàn thành độ: " : "Chi nhánh hoàn thành độ: ",
    widgetColor(layout.widget(37), 0x1c6c91),
  );
  drawText(g, art, layout, 38, progress, widgetColor(layout.widget(38), 0xffffff));
  drawTaskScrollbar(g, layout, rows.length, first);
}

/**
 * `renderTaskOption`: the frame (`drawTaskOptionFrame`), the two answer rows with the cursor on the
 * selected one, "Thưởng" with up to two reward icons and labels, the summary line and the softkeys.
 */
function renderTaskOption(
  g: CanvasRenderingContext2D,
  art: WorldPanelArt,
  layout: SourceUiLayout,
  panel: WorldPanel,
): void {
  const view = panel.taskOption;
  if (!view) return;
  fillBand(g, layout, 2, 0xc6f0ff, 7);
  fillBand(g, layout, 3, 0xbde8d7, 99);
  fillBand(g, layout, 4, 0x51d069, 8);
  for (const id of [1, 9, 19, 20]) drawWidgetCell(g, art, layout, id);
  const cursors = [7, 8],
    labels = [17, 18];
  for (let i = 0; i < TASK_OPTION_ROWS.length && i < view.options.length; i++) {
    const row = layout.widget(TASK_OPTION_ROWS[i]);
    if (row) {
      drawCellTopLeft(g, art, widgetCell(row), row.x, row.y);
      const cursor = layout.widget(cursors[i]);
      if (i === panel.selected && cursor && token(cursor.imageId) >= 0)
        drawCellTopLeft(g, art, token(cursor.imageId), cursor.x, cursor.y);
    }
    const label = layout.widget(labels[i]);
    drawTextWide(
      g,
      art,
      layout,
      labels[i],
      view.options[i],
      0,
      layout.w(labels[i], 60),
      i === panel.selected && label ? selectedColor(label) : widgetColor(label, 0x1c6c91),
    );
  }
  drawText(g, art, layout, 12, layout.text(12, "Thuong"), widgetColor(layout.widget(12), 0xd0010e));
  const icons = [13, 15],
    texts = [14, 16];
  for (let i = 0; i < icons.length && i < view.rewards.length; i++) {
    const reward = view.rewards[i],
      icon = layout.widget(icons[i]);
    if (icon) {
      const image =
        reward.sheet === 257 ? cellImage(art, reward.cell) : art.cellFor?.(258, reward.cell);
      if (image && image.complete && image.naturalWidth > 0) g.drawImage(image, icon.x, icon.y);
    }
    drawTextWide(
      g,
      art,
      layout,
      texts[i],
      reward.label,
      0,
      layout.w(texts[i], 48),
      widgetColor(layout.widget(texts[i]), 0xd0010e),
    );
  }
  if (view.summary)
    drawTextWide(
      g,
      art,
      layout,
      21,
      view.summary,
      0,
      layout.w(21, 72),
      widgetColor(layout.widget(21), 0xd0010e),
    );
  drawSoftkey(g, art, layout, 19, layout.text(19, "Xac dinh"), 0xffffff);
  drawSoftkey(g, art, layout, 20, layout.text(20, "Quay lai"), 0xffffff);
}

export type WorldPanelLayouts = {
  gamemenu: SourceUiLayout;
  gamesystem: SourceUiLayout;
  help: SourceUiLayout;
  settings: SourceUiLayout;
  optionConfirm: SourceUiLayout;
  msgtip: SourceUiLayout;
  task: SourceUiLayout;
  taskOption?: SourceUiLayout;
};

/** What a panel shows about the session: the task completion line and where the player stands. */
export type WorldPanelSession = {
  taskProgress: string;
};

export function drawWorldPanel(
  g: CanvasRenderingContext2D,
  panel: WorldPanel,
  layouts: WorldPanelLayouts,
  art: WorldPanelArt,
  currency: WorldPanelCurrency,
  session: WorldPanelSession,
): void {
  if (!panel.visible) return;
  switch (panel.mode) {
    case "gamemenu":
      renderGameMenu(g, art, layouts.gamemenu, panel, currency);
      break;
    case "gamesystem":
      renderGameSystem(g, art, layouts.gamesystem, panel);
      break;
    case "help":
      renderHelp(g, art, layouts.help, panel);
      break;
    case "settings":
      renderSettings(g, art, layouts.settings, panel);
      break;
    case "optionConfirm":
      renderOptionConfirm(g, art, layouts.optionConfirm, panel);
      break;
    case "save":
      renderSave(g, art, layouts.msgtip, panel);
      break;
    case "task":
      renderTask(g, art, layouts.task, panel, session.taskProgress);
      break;
    case "taskOption":
      if (layouts.taskOption) renderTaskOption(g, art, layouts.taskOption, panel);
      break;
  }
}
