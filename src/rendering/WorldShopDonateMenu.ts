import { SourceUiLayout, type SourceUiWidget } from "./SourceUiLayout";

/**
 * Web only (owner, 2026-11-18): the Liệt Hỏa item merchant's "Thương điếm" (`shop.ui`) lists two
 * more rows, "Donate" and "Shop Donate", before "Rời đi". The frame grows by two rows (and 14 px wider)
 * and stays centred; the new rows reuse the row art of the ones above.
 */
export const WORLD_SHOP_DONATE_LABELS = [
  "Mua sắm",
  "Bán đi",
  "Khôi phục",
  "Donate",
  "Shop Donate",
  "Rời đi",
] as const;
/** Rows 3 and 4 are synthetic widgets 106 and 107; "Rời đi" keeps widget 8, moved down. */
export const WORLD_SHOP_DONATE_WIDGETS = [6, 7, 9, 106, 107, 8] as const;
export const WORLD_SHOP_DONATE_ROW = 3;
export const WORLD_SHOP_DONATE_SHOP_ROW = 4;

/** Frame bands and title: 1..5; the four rows: 6..9. Softkeys (10, 11) stay put. */
const FRAME = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]);
/** Extra width for the longer labels. */
const WIDEN = 14;
const cache = new WeakMap<SourceUiLayout, SourceUiLayout>();

/** `shop.ui` with the two donate rows, or the layout itself when it lacks the rows to copy. */
export function worldShopDonateLayout(layout: SourceUiLayout): SourceUiLayout {
  const cached = cache.get(layout);
  if (cached) return cached;
  const first = layout.widget(6),
    second = layout.widget(7),
    leave = layout.widget(8);
  if (!first || !second || !leave) return layout;
  const step = second.y - first.y,
    grow = step * 2,
    widgets: Record<string, SourceUiWidget> = {};
  for (const widget of layout.all()) {
    const copy: SourceUiWidget = { ...widget };
    if (copy.id === 2 || copy.id === 4) {
      copy.h += grow;
      if (copy.bandHeight !== undefined) copy.bandHeight += grow;
    }
    if (copy.id === 3 || copy.id === 8) copy.y += grow;
    if (FRAME.has(copy.id)) {
      copy.y -= step;
      // "Shop Donate" is wider than the 40 px rows: widen the frame and rows, centred.
      copy.x -= WIDEN / 2;
      copy.w += WIDEN;
    }
    widgets[String(copy.id)] = copy;
  }
  const wide = widgets["8"];
  widgets["106"] = { ...wide, id: 106, text: undefined, y: leave.y - step };
  widgets["107"] = { ...wide, id: 107, text: undefined, y: leave.y };
  const result = new SourceUiLayout({ widgets });
  cache.set(layout, result);
  return result;
}
