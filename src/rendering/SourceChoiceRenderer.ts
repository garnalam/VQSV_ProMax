import type { PanelFontRenderer } from "./PanelFontRenderer";
import type { SourceUiLayout } from "./SourceUiLayout";
import { drawUnifiedItemIcon } from "./UnifiedItemIcon";

/**
 * JavaSE `VqsvSceneView.renderSourceChoiceUi`: the `choice.ui` list the pet screen opens for
 * "Đạo cụ" (bag consumables, "Số lượng") and "Vật phẩm trang sức" (equipment, "Trạng thái"). Five
 * rows in the source's cells, an item icon per row, the scrollbar past five rows, the selected
 * row's description, and the two softkey plates, all in the JavaSE UI font.
 */
export type ChoiceRow = {
  id: number;
  name: string;
  value: string;
  description: string;
  /** Sprite-258 cell. */
  icon: number;
  /** A unified Item's own PNG (pack key), drawn instead of `icon`. */
  iconKey?: string;
};
export type SourceChoiceView = {
  title: string;
  subtitle: string;
  action: string;
  rows: readonly ChoiceRow[];
  selected: number;
  scroll: number;
};
export type SourceChoiceArt = {
  font: PanelFontRenderer;
  /** A sprite-257 UI cell. */
  cell: (index: number) => HTMLImageElement | undefined;
  /** A sprite-258 item icon. */
  icon: (index: number) => HTMLImageElement | undefined;
  /** A unified Item's own PNG by pack key. */
  image?: (key: string) => HTMLImageElement | undefined;
};

export const CHOICE_VISIBLE_ROWS = 5;
export const CHOICE_THUMB_TRAVEL_HEIGHT = 8;
const SOURCE_UI_TEXT = 1862801;
const hex = (value: number) => `#${((value & 0xffffff) | 0x1000000).toString(16).slice(1)}`;
const usable = (value: number | undefined) => value !== undefined && value !== 0 && value !== -1;

/** `visibleStart`. */
export function choiceVisibleStart(view: Pick<SourceChoiceView, "rows" | "scroll">): number {
  return Math.max(0, Math.min(view.scroll, Math.max(0, view.rows.length - CHOICE_VISIBLE_ROWS)));
}
/** `scrollbarThumbY`: an 8 px thumb over the track. */
export function choiceThumbY(
  view: Pick<SourceChoiceView, "rows" | "scroll">,
  trackY: number,
  trackHeight: number,
): number {
  const maxScroll = Math.max(0, view.rows.length - CHOICE_VISIBLE_ROWS);
  if (maxScroll === 0) return trackY;
  const thumb = Math.max(1, Math.min(trackHeight, CHOICE_THUMB_TRAVEL_HEIGHT));
  return trackY + Math.trunc(((trackHeight - thumb) * choiceVisibleStart(view)) / maxScroll);
}
/** `wrapChoiceDescription`: at most `lines` lines; the last one takes the rest. */
export function wrapChoiceDescription(
  measure: (text: string) => number,
  text: string,
  width: number,
  lines: number,
): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    const candidate = line ? `${line} ${word}` : word;
    if (line && measure(candidate) > width && out.length + 1 < lines) {
      out.push(line);
      line = word;
    } else line = candidate;
  }
  if (line && out.length < lines) out.push(line);
  return out;
}

export function drawSourceChoice(
  g: CanvasRenderingContext2D,
  layout: SourceUiLayout,
  art: SourceChoiceArt,
  view: SourceChoiceView,
): void {
  const font = art.font,
    cellAt = (index: number, x: number, y: number) => {
      if (index < 0) return;
      const image = art.cell(index);
      if (image && image.complete && image.naturalWidth > 0) g.drawImage(image, x, y);
    },
    // `drawSkillBand`.
    band = (id: number, height: number, fallback: number) => {
      const w = layout.widget(id);
      if (!w) return;
      const j = w.jColor ?? w.j_color;
      g.fillStyle = hex(usable(j) ? j! : fallback);
      g.fillRect(w.x, w.y, Math.max(1, w.w), Math.max(1, layout.bandHeight(id, height)));
    },
    // `drawSkillCell`.
    skillCell = (id: number, on: boolean) => {
      const w = layout.widget(id);
      if (!w) return;
      const alt = w.altId ?? -1;
      let index = on && alt >= 0 ? alt : (w.imageId ?? -1);
      if (index < 0) index = alt;
      cellAt(index, w.x, w.y);
    },
    color = (id: number, fallback: number) => {
      const l = layout.widget(id)?.lColor ?? layout.widget(id)?.l_color;
      return usable(l) ? l! & 0xffffff : fallback;
    },
    jColor = (id: number, fallback: number) => {
      const j = layout.widget(id)?.jColor ?? layout.widget(id)?.j_color;
      return usable(j) ? j! & 0xffffff : fallback;
    },
    // `drawChoiceWidgetText`.
    text = (id: number, value: string, width: number, centred: boolean, c: number) => {
      const w = layout.widget(id);
      if (!w || !value) return;
      const columns = layout.w(id, width);
      g.save();
      g.beginPath();
      g.rect(w.x, w.y - 1, Math.max(1, columns), Math.max(12, layout.h(id, 13)));
      g.clip();
      const x =
        centred || w.b === 4
          ? w.x + Math.max(0, Math.trunc((columns - font.taggedWidth(value)) / 2))
          : w.x;
      font.drawTagged(g, value, x, w.y, hex(c));
      g.restore();
    };

  band(4, 8, 13038079);
  band(2, 160, 12444911);
  band(3, 14, 8571643);
  band(7, 82, 12444911);
  skillCell(1, false);
  text(8, view.title, 46, true, color(8, SOURCE_UI_TEXT));
  text(9, view.subtitle, 36, true, color(9, SOURCE_UI_TEXT));

  const start = choiceVisibleStart(view),
    count = Math.min(CHOICE_VISIBLE_ROWS, Math.max(0, view.rows.length - start));
  for (let slot = 0; slot < CHOICE_VISIBLE_ROWS; slot++) {
    const index = start + slot,
      on = index === view.selected,
      nameId = 13 + slot * 5,
      valueId = 14 + slot * 5;
    skillCell(11 + slot * 5, on);
    if (slot >= count) continue;
    const row = view.rows[index],
      iconId = 54 + slot,
      ix = layout.x(iconId, 54),
      iy = layout.y(iconId, 95 + slot * 15);
    // `renderSourceChoiceUi`: the row's PNG at 13×13, else its sprite-258 cell.
    if (!row.iconKey || !drawUnifiedItemIcon(g, art.image?.(row.iconKey), ix, iy, 13, 13)) {
      const icon = art.icon(row.icon);
      if (icon && icon.complete && icon.naturalWidth > 0) g.drawImage(icon, ix, iy);
    }
    const nameColor = on ? jColor(nameId, 16773482) : color(nameId, SOURCE_UI_TEXT);
    text(nameId, row.name, 72, false, nameColor);
    text(
      valueId,
      row.value,
      36,
      true,
      on ? jColor(valueId, nameColor) : color(valueId, SOURCE_UI_TEXT),
    );
  }

  if (view.rows.length > CHOICE_VISIBLE_ROWS) {
    band(50, 72, 5363945);
    const top = choiceThumbY(view, layout.y(50, 98), 72),
      thumb = layout.widget(51);
    g.fillStyle = hex(jColor(51, 13038079));
    g.fillRect(layout.x(51, 183), top, layout.w(51, 4), Math.max(1, thumb ? layout.h(51, 8) : 8));
  }
  if (view.rows.length === 0) text(13, "...", 72, true, color(13, SOURCE_UI_TEXT));

  const description = view.rows.length
    ? (view.rows[Math.max(0, Math.min(view.selected, view.rows.length - 1))].description ?? "")
    : "";
  if (description.trim()) {
    skillCell(52, false);
    const lines = wrapChoiceDescription((t) => font.taggedWidth(t), description.trim(), 128, 2);
    g.save();
    g.beginPath();
    g.rect(56, 180, 128, 26);
    g.clip();
    lines.forEach((line, i) =>
      font.drawTagged(
        g,
        line,
        56 + Math.max(0, Math.trunc((128 - font.taggedWidth(line)) / 2)),
        181 + i * 12,
        hex(SOURCE_UI_TEXT),
      ),
    );
    g.restore();
  }

  skillCell(59, false);
  text(59, view.action, 43, true, color(59, 0xffffff));
  skillCell(60, false);
  text(60, "Quay lại", 43, true, color(60, 0xffffff));
}
