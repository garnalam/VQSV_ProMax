import type { PanelFontRenderer } from "./PanelFontRenderer";
import type { SourceUiLayout, SourceUiWidget } from "./SourceUiLayout";
import {
  BADGE_GRID_COLUMNS,
  BADGE_GRID_ROWS,
  BADGE_SOURCE_SLOTS,
  PETMAP_TAB_NAMES,
  type WorldPanel,
} from "../game/world/WorldPanel";
import { sourcePlayTime } from "../game/record/RecordBook";
import { thumbHeight, thumbY } from "../ui/UiScrollbarMath";

/**
 * JavaSE Đồ giám (`VqsvPanelRuntime.renderRecord`, `renderPetmap`, `renderBadge`,
 * `renderExtendedBadgeGrid`) on the baked `record.ui`, `petmap.ui` and `badge.ui` layouts, in the
 * JavaSE UI font. Every rectangle, cell and colour is the layout's or the JavaSE code's own.
 */
export type RecordArt = {
  font: PanelFontRenderer;
  /** A sprite-257 UI cell. */
  cell: (index: number) => HTMLImageElement | undefined;
  /** A pet's idle frame (state 0, frame 0) and its top-left offset. */
  idle: (spriteId: number) => { image: HTMLImageElement; ox: number; oy: number } | undefined;
  /** A unified badge's icon by stable key. */
  badgeIcon: (key: string) => HTMLImageElement | undefined;
};
export type RecordLayouts = {
  record: SourceUiLayout;
  petmap: SourceUiLayout;
  badge: SourceUiLayout;
};

const hex = (value: number) => `#${((value & 0xffffff) | 0x1000000).toString(16).slice(1)}`;
const token = (value: number | undefined) => (value === undefined ? 0 : value);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const ready = (image: HTMLImageElement | undefined): image is HTMLImageElement =>
  !!image && image.complete && image.naturalWidth > 0;

const BADGE_SLOT_WIDGETS = [17, 18, 19, 20, 21, 22, 23, 24];
const BADGE_ICON_WIDGETS = [25, 26, 27, 28, 29, 30, 31, 32];
const BADGE_GRID_X = 50;
const BADGE_GRID_Y = 99;
const BADGE_GRID_CELL_SIZE = 30;
const BADGE_GRID_ICON_SIZE = 28;
const BADGE_GRID_X_STEP = 28;
const BADGE_GRID_Y_STEP = 33;
const BADGE_PREVIEW_X = 125;
const BADGE_PREVIEW_Y = 174;
const BADGE_PREVIEW_SIZE = 64;
const PETMAP_TAB_CELLS = [6, 7, 8, 9, 10, 11, 12];
const PETMAP_TAB_LABELS = [13, 14, 15, 16, 17, 18, 19];
const PETMAP_ROW_BACKGROUNDS = [25, 29, 33, 37, 41];
const PETMAP_ROW_MARKERS = [44, 45, 46, 47, 48];
const PETMAP_ROW_NAMES = [27, 31, 35, 39, 43];

/** `badgeGridFirst`: the first display index of the two visible rows. */
export function badgeGridFirst(selected: number, count: number): number {
  const totalRows = Math.trunc((count + BADGE_GRID_COLUMNS - 1) / BADGE_GRID_COLUMNS),
    selectedRow = Math.trunc(clamp(selected, 0, count - 1) / BADGE_GRID_COLUMNS),
    firstRow = clamp(
      selectedRow - BADGE_GRID_ROWS + 1,
      0,
      Math.max(0, totalRows - BADGE_GRID_ROWS),
    );
  return firstRow * BADGE_GRID_COLUMNS;
}
/** `badgeGridX`: a short last row is centred. */
export function badgeGridX(slot: number, visibleCount: number): number {
  const row = Math.trunc(slot / BADGE_GRID_COLUMNS),
    column = slot % BADGE_GRID_COLUMNS,
    rowCount = Math.min(BADGE_GRID_COLUMNS, visibleCount - row * BADGE_GRID_COLUMNS),
    offset = Math.trunc(((BADGE_GRID_COLUMNS - rowCount) * BADGE_GRID_X_STEP) / 2);
  return BADGE_GRID_X + offset + column * BADGE_GRID_X_STEP;
}
const badgeGridY = (slot: number) =>
  BADGE_GRID_Y + Math.trunc(slot / BADGE_GRID_COLUMNS) * BADGE_GRID_Y_STEP;

/** `VqsvPanelRuntime.color`. */
function color(widget: SourceUiWidget | undefined, fallback: number): number {
  const value = token(widget?.lColor ?? widget?.l_color);
  return !widget || value === 0 || value === -1 ? fallback : value & 0xffffff;
}
/** `colorSelected`. */
function colorSelected(widget: SourceUiWidget | undefined): number {
  const value = token(widget?.jColor ?? widget?.j_color);
  return !widget || value === 0 || value === -1 ? 0xffa500 : value & 0xffffff;
}
/** `activeTextColor`: the selected-state text colour when the widget has one. */
function activeTextColor(widget: SourceUiWidget | undefined, fallback: number): number {
  const value = token(widget?.gColor ?? widget?.g_color);
  return !widget || value === 0 || value === -1 ? fallback : value & 0xffffff;
}

export function drawRecordPanel(
  g: CanvasRenderingContext2D,
  panel: WorldPanel,
  layouts: RecordLayouts,
  art: RecordArt,
): void {
  const font = art.font,
    cellAt = (index: number, x: number, y: number) => {
      if (index < 0) return;
      const image = art.cell(index);
      if (ready(image)) g.drawImage(image, x, y);
    },
    drawCell = (layout: SourceUiLayout, id: number) => {
      const w = layout.widget(id);
      if (!w) return;
      const alt = token(w.altId);
      cellAt(alt >= 0 ? alt : token(w.imageId), w.x, w.y);
    },
    drawCellState = (layout: SourceUiLayout, id: number, on: boolean) => {
      const w = layout.widget(id);
      if (!w) return;
      const alt = token(w.altId);
      cellAt(on && alt >= 0 ? alt : token(w.imageId), w.x, w.y);
    },
    // `fillBand`: the widget's jColor (or the code colour) over its band height.
    fillBand = (layout: SourceUiLayout, id: number, fallback: number, height: number) => {
      const w = layout.widget(id);
      if (!w) return;
      const j = token(w.jColor ?? w.j_color);
      g.fillStyle = hex(j === 0 || j === -1 ? fallback : j);
      g.fillRect(w.x, w.y, Math.max(1, w.w), Math.max(1, layout.bandHeight(id, height)));
    },
    // `drawTextWide`: clipped to `width`, `dx` px left of the widget.
    textWide = (
      layout: SourceUiLayout,
      id: number,
      text: string,
      dx: number,
      width: number,
      c: number,
    ) => {
      const w = layout.widget(id);
      if (!w || !text) return;
      const x = w.x + dx,
        columns = Math.max(1, width),
        drawX = w.b === 4 ? x + Math.max(0, Math.trunc((columns - font.taggedWidth(text)) / 2)) : x;
      g.save();
      g.beginPath();
      g.rect(x, w.y - 1, columns + 6, Math.max(12, layout.h(id, 12)));
      g.clip();
      font.drawTagged(g, text, drawX, w.y, hex(c));
      g.restore();
    },
    // `drawText`: the widget's width, or the text's own.
    text = (layout: SourceUiLayout, id: number, value: string, c: number) =>
      textWide(layout, id, value, 0, layout.w(id, Math.max(1, font.taggedWidth(value))), c),
    centredLine = (value: string, x: number, y: number, width: number, c: number) =>
      font.drawTagged(
        g,
        value,
        x + Math.max(0, Math.trunc((width - font.taggedWidth(value)) / 2)),
        y,
        hex(c),
      ),
    strokeRect = (x: number, y: number, w: number, h: number, c: number) => {
      g.strokeStyle = hex(c);
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, w, h);
    };

  if (panel.mode === "record") {
    // `renderRecord` / `drawRecordFrame`.
    const layout = layouts.record,
      stats = panel.recordSource.stats(),
      on = panel.recordSelected;
    drawCell(layout, 1);
    fillBand(layout, 2, 0xbde8d7, 7);
    fillBand(layout, 3, 0x51d069, 132);
    const left = layout.widget(4),
      cursor = layout.widget(6);
    if (left && cursor) {
      g.fillStyle = hex(0x51d069);
      g.fillRect(left.x - 8, left.y - 5, 144, Math.max(34, cursor.y - left.y + 18));
    }
    // `drawRecordOptionButton`.
    for (const [id, cursorId, line2, index] of [
      [4, 6, "Sủng vật", 0],
      [32, 7, "Huy chương", 1],
    ] as const) {
      const w = layout.widget(id);
      if (!w) continue;
      const selected = on === index;
      g.fillStyle = hex(selected ? 0xffe866 : 0xfff29a);
      g.fillRect(w.x, w.y, Math.max(1, w.w), 24);
      strokeRect(w.x, w.y, Math.max(1, w.w), 24, selected ? 0xff7a00 : 0xb97000);
      centredLine("Hệ thống", w.x, w.y + 3, Math.max(1, w.w), 0x162c27);
      centredLine(line2, w.x, w.y + 13, Math.max(1, w.w), 0x162c27);
      if (selected) {
        const c = layout.widget(cursorId);
        if (c && token(c.imageId) >= 0) cellAt(token(c.imageId), c.x, c.y);
      }
    }
    drawCell(layout, 33);
    drawCell(layout, 34);
    textWide(layout, 11, layout.text(11, "Hinh Kam"), -8, 156, color(layout.widget(11), 0xd0010e));
    const line = (label: number, value: number, fallback: string, number: string) => {
      text(layout, label, layout.text(label, fallback), color(layout.widget(label), 0x1c6c91));
      text(layout, value, number, color(layout.widget(value), 0xff0000));
    };
    line(12, 14, "Bat duoc sung vat", String(stats.owned));
    line(15, 17, "Bat duoc sung vat", String(stats.collected));
    line(18, 20, "Dat duoc sung vat hiem", String(stats.rare));
    line(24, 26, "Dat duoc than thu", String(stats.divine));
    line(27, 29, "Dat duoc huy hieu", String(stats.badges));
    line(30, 31, "Tong thoi gian choi", sourcePlayTime(stats.playTimeMillis));
    text(layout, 33, layout.text(33, "Xac dinh"), color(layout.widget(33), 0xffffff));
    text(layout, 34, layout.text(34, "Quay lai"), color(layout.widget(34), 0xffffff));
    // `drawRecordSelection`.
    const pick = layout.widget(on === 0 ? 4 : 32);
    if (pick) strokeRect(pick.x - 1, pick.y - 1, 65, 22, 0xffa500);
    return;
  }

  if (panel.mode === "petmap") {
    // `renderPetmap` / `drawPetmapFrame`.
    const layout = layouts.petmap;
    drawCell(layout, 1);
    fillBand(layout, 3, 0xbde8d7, 15);
    fillBand(layout, 4, 0xbde8d7, 8);
    fillBand(layout, 5, 0xbde8d7, 93);
    fillBand(layout, 22, 0x51d069, 72);
    drawCell(layout, 49);
    drawCell(layout, 50);
    textWide(layout, 2, layout.text(2, "Minh hoa"), -28, 84, color(layout.widget(2), 0xd0010e));
    PETMAP_TAB_CELLS.forEach((cellId, i) => {
      const on = i === panel.petmapTab,
        label = layout.widget(PETMAP_TAB_LABELS[i]);
      drawCellState(layout, cellId, on);
      textWide(
        layout,
        PETMAP_TAB_LABELS[i],
        PETMAP_TAB_NAMES[i],
        -1,
        Math.max(1, layout.w(PETMAP_TAB_LABELS[i], 12) - 6),
        on ? colorSelected(label) : color(label, 0x00009a),
      );
    });
    const rows = panel.petmapRows,
      first = Math.max(0, Math.min(panel.listScroll, Math.max(0, rows.length - 5)));
    PETMAP_ROW_BACKGROUNDS.forEach((bgId, i) => {
      const index = first + i,
        bg = layout.widget(bgId);
      if (bg) cellAt(index === panel.selected ? token(bg.altId) : token(bg.imageId), bg.x, bg.y);
      const row = rows[index];
      if (!row) return;
      cellAt(
        row.owned ? 101 : 102,
        layout.x(PETMAP_ROW_MARKERS[i], 50),
        layout.y(PETMAP_ROW_MARKERS[i], 101),
      );
      text(
        layout,
        PETMAP_ROW_NAMES[i],
        row.name,
        index === panel.selected ? 0xffa500 : color(layout.widget(PETMAP_ROW_NAMES[i]), 0x1c6c91),
      );
    });
    if (rows.length > 0) {
      const row = rows[clamp(panel.selected, 0, rows.length - 1)],
        owned = rows.filter((r) => r.owned).length;
      text(
        layout,
        20,
        `${PETMAP_TAB_NAMES[panel.petmapTab]} ${owned}/${rows.length}`,
        color(layout.widget(20), 0x1c6c91),
      );
      // `drawSpriteIdleTopLeft`: only a pet already seen shows its picture.
      if (row.seen && row.spriteId >= 0) {
        const idle = art.idle(row.spriteId);
        if (idle && ready(idle.image))
          g.drawImage(idle.image, layout.x(21, 104) + idle.ox, layout.y(21, 172) + idle.oy);
      }
    }
    // `drawPetmapScrollbar`: the 72 px track and a thumb of at least 8.
    const track = layout.widget(22),
      thumb = layout.widget(23);
    if (track && thumb) {
      const jt = token(track.jColor ?? track.j_color),
        jh = token(thumb.jColor ?? thumb.j_color),
        height = thumbHeight(72, rows.length, 5, 8),
        top = thumbY(track.y, 72, height, rows.length, 5, first);
      g.fillStyle = hex(jt === 0 || jt === -1 ? 0x51d069 : jt);
      g.fillRect(track.x, track.y, Math.max(1, track.w), 72);
      g.fillStyle = hex(jh === 0 || jh === -1 ? 0xc6f0ff : jh);
      g.fillRect(thumb.x, top, Math.max(1, thumb.w), Math.max(8, height));
    }
    text(layout, 49, layout.text(49, "Xac dinh"), color(layout.widget(49), 0xffffff));
    text(layout, 50, layout.text(50, "Quay lai"), color(layout.widget(50), 0xffffff));
    return;
  }

  if (panel.mode !== "badge") return;
  // `renderBadge` / `drawBadgeFrame`.
  const layout = layouts.badge,
    entries = panel.badgeEntries,
    count = entries.length,
    selected = clamp(panel.selected, 0, Math.max(0, count - 1));
  fillBand(layout, 3, 0xc6f0ff, 9);
  fillBand(layout, 1, 0xbee7f2, 159);
  fillBand(layout, 2, 0x6cb7bb, 8);
  for (const id of [4, 6, 8, 9, 10, 11, 12]) drawCell(layout, id);
  textWide(
    layout,
    5,
    layout.text(5, "Huy hieu"),
    0,
    layout.w(5, 100),
    color(layout.widget(5), 0xd0010e),
  );
  // `drawSoftkey` 6: the plate cell and its label centred in it.
  const back = layout.widget(6);
  if (back) {
    const alt = token(back.altId),
      plate = art.cell(alt >= 0 ? alt : token(back.imageId)),
      width = ready(plate) ? plate.naturalWidth : Math.max(1, layout.w(6, 43)),
      height = ready(plate) ? plate.naturalHeight : Math.max(12, layout.h(6, 20)),
      label = layout.text(6, "Quay lai"),
      l = token(back.lColor ?? back.l_color);
    drawCell(layout, 6);
    g.save();
    g.beginPath();
    g.rect(back.x, back.y - 1, Math.max(1, width), Math.max(12, height));
    g.clip();
    font.drawTagged(
      g,
      label,
      back.x + Math.trunc((width - font.taggedWidth(label)) / 2),
      back.y + Math.max(0, Math.trunc((height - font.height) / 2)) + 1,
      hex(l === -1 ? 0xffffff : color(back, 0xffffff)),
    );
    g.restore();
  }
  if (count > BADGE_SOURCE_SLOTS) {
    // `renderExtendedBadgeGrid`: five by two, the selected slot in the alt cell.
    const slot0 = layout.widget(BADGE_SLOT_WIDGETS[0]),
      normal = slot0 ? token(slot0.imageId) : 36,
      chosen = !slot0 || token(slot0.altId) < 0 ? 37 : token(slot0.altId),
      first = badgeGridFirst(selected, count),
      visible = Math.min(BADGE_GRID_COLUMNS * BADGE_GRID_ROWS, count - first);
    for (let slot = 0; slot < visible; slot++) {
      const index = first + slot,
        badge = entries[index],
        x = badgeGridX(slot, visible),
        y = badgeGridY(slot);
      cellAt(index === selected ? chosen : normal, x, y);
      if (badge.icon) {
        const icon = art.badgeIcon(badge.icon);
        if (ready(icon)) {
          g.save();
          g.imageSmoothingEnabled = true;
          g.drawImage(icon, x + 1, y + 1, BADGE_GRID_ICON_SIZE, BADGE_GRID_ICON_SIZE);
          g.restore();
        }
        continue;
      }
      const cell = art.cell(badge.achieved ? 46 + badge.id : 54 + badge.id);
      if (ready(cell))
        g.drawImage(
          cell,
          x + Math.trunc((BADGE_GRID_CELL_SIZE - cell.naturalWidth) / 2),
          y + Math.trunc((BADGE_GRID_CELL_SIZE - cell.naturalHeight) / 2),
        );
    }
  } else {
    BADGE_SLOT_WIDGETS.forEach((slotId, i) => {
      const slot = layout.widget(slotId);
      if (slot)
        cellAt(
          i === selected && token(slot.altId) >= 0 ? token(slot.altId) : token(slot.imageId),
          slot.x,
          slot.y,
        );
      const icon = layout.widget(BADGE_ICON_WIDGETS[i]);
      if (icon) {
        const alt = token(icon.altId);
        cellAt(
          entries[i]?.achieved ? 46 + i : alt >= 0 ? alt : token(icon.imageId),
          icon.x,
          icon.y,
        );
      }
    });
  }
  const badge = entries[selected];
  if (!badge) return;
  textWide(layout, 13, badge.name, 0, 68, color(layout.widget(13), 0x1c6c91));
  // `drawWrappedTextBox` 14: 68 x 45, wrapped on words, `#n` breaks.
  const box = layout.widget(14);
  if (box && badge.description) {
    const lines: string[] = [];
    for (const paragraph of badge.description.split("#n")) {
      let current = "";
      for (const word of paragraph.trim().split(/\s+/)) {
        if (!word) continue;
        const candidate = current ? `${current} ${word}` : word;
        if (font.taggedWidth(candidate) <= 68 || !current) current = candidate;
        else {
          lines.push(current);
          current = word;
        }
      }
      lines.push(current);
    }
    g.save();
    g.beginPath();
    g.rect(box.x, box.y, 68, Math.max(font.height + 1, 45));
    g.clip();
    let y = box.y;
    for (const value of lines) {
      if (y > box.y + Math.max(font.height + 1, 45) - font.height) break;
      if (value) font.drawTagged(g, value, box.x, y, hex(activeTextColor(box, 0x1c6c91)));
      y += font.height + 1;
    }
    g.restore();
  }
  // `drawTextMarquee(.., -4)`: the status label and line, four pixels up.
  const marquee = (id: number, value: string, width: number) => {
    const w = layout.widget(id);
    if (!w || !value) return;
    const columns = Math.max(1, width),
      textWidth = font.taggedWidth(value),
      y = w.y - 4;
    let x = w.x;
    if (textWidth > columns) {
      let scroll = Math.max(0, panel.openedTicks * 2);
      if (scroll > textWidth - columns)
        scroll = -columns + ((scroll - (textWidth - columns)) % Math.max(1, textWidth + columns));
      x = w.x - scroll;
    } else if (w.b === 4) x = w.x + Math.max(0, Math.trunc((columns - textWidth) / 2));
    g.save();
    g.beginPath();
    g.rect(w.x, y - 1, columns, Math.max(12, layout.h(id, 12) + 4));
    g.clip();
    font.drawTagged(g, value, x, y, hex(color(w, 0x204954)));
    g.restore();
  };
  marquee(15, layout.text(15, "Trang thai"), layout.w(15, 24));
  marquee(16, badge.status, layout.w(16, 40));
  if (badge.achieved) {
    // `badgePreviewImage`: the badge fitted into 60 px of a 64 px square.
    const image = badge.icon ? art.badgeIcon(badge.icon) : art.cell(46 + badge.id);
    if (ready(image)) {
      const content = BADGE_PREVIEW_SIZE - 4,
        scale = Math.min(content / image.naturalWidth, content / image.naturalHeight),
        w = Math.max(1, Math.round(image.naturalWidth * scale)),
        h = Math.max(1, Math.round(image.naturalHeight * scale));
      g.save();
      g.imageSmoothingEnabled = !!badge.icon;
      g.drawImage(
        image,
        BADGE_PREVIEW_X + Math.trunc((BADGE_PREVIEW_SIZE - w) / 2),
        BADGE_PREVIEW_Y + Math.trunc((BADGE_PREVIEW_SIZE - h) / 2),
        w,
        h,
      );
      g.restore();
    }
  } else textWide(layout, 33, badge.name, 0, layout.w(33, 36), color(layout.widget(33), 0x1c6c91));
}
