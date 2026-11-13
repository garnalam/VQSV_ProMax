/**
 * `vqsv.ui.layout.UiScrollbarMath`: pure clamped geometry for the painted list scrollbars — the
 * thumb's size and place, a press on the track paging the list, and a dragged thumb mapping back to
 * a scroll. Every value is a non-negative integer, so Java's integer division is `Math.floor`.
 */

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const div = (a: number, b: number) => Math.floor(a / b);

/** A list's scrollbar: the track rect, the rows it scrolls and the shortest thumb it draws. */
export type ScrollbarGeometry = {
  x: number;
  y: number;
  w: number;
  h: number;
  rowCount: number;
  visibleRows: number;
  minThumbHeight: number;
};

export function maxScroll(rowCount: number, visibleRows: number): number {
  return Math.max(0, rowCount - Math.max(1, visibleRows));
}

export function thumbHeight(
  trackHeight: number,
  rowCount: number,
  visibleRows: number,
  minimumHeight: number,
): number {
  const height = Math.max(1, trackHeight);
  if (rowCount <= Math.max(1, visibleRows)) return height;
  return Math.min(
    height,
    Math.max(
      Math.max(1, minimumHeight),
      div(height * Math.max(1, visibleRows), Math.max(1, rowCount)),
    ),
  );
}

export function thumbY(
  trackY: number,
  trackHeight: number,
  thumb: number,
  rowCount: number,
  visibleRows: number,
  scroll: number,
): number {
  const most = maxScroll(rowCount, visibleRows),
    travel = Math.max(0, trackHeight - thumb);
  if (most === 0 || travel === 0) return trackY;
  return trackY + div(travel * clamp(scroll, 0, most), most);
}

export function trackContains(px: number, py: number, bar: ScrollbarGeometry): boolean {
  return (
    px >= bar.x && px < bar.x + Math.max(1, bar.w) && py >= bar.y && py < bar.y + Math.max(1, bar.h)
  );
}

export function thumbContains(
  px: number,
  py: number,
  bar: ScrollbarGeometry,
  top: number,
  thumb: number,
): boolean {
  return (
    px >= bar.x && px < bar.x + Math.max(1, bar.w) && py >= top && py < top + Math.max(1, thumb)
  );
}

/** `pageScroll`: a press above the thumb pages up, below it pages down, on it changes nothing. */
export function pageScroll(pointerY: number, scroll: number, bar: ScrollbarGeometry): number {
  const most = maxScroll(bar.rowCount, bar.visibleRows),
    current = clamp(scroll, 0, most),
    thumb = thumbHeight(bar.h, bar.rowCount, bar.visibleRows, bar.minThumbHeight),
    top = thumbY(bar.y, bar.h, thumb, bar.rowCount, bar.visibleRows, current),
    page = Math.max(1, bar.visibleRows);
  if (pointerY < top) return clamp(current - page, 0, most);
  if (pointerY >= top + thumb) return clamp(current + page, 0, most);
  return current;
}

/** `dragScroll`: the thumb follows the pointer (less where it was grabbed), rounded to a row. */
export function dragScroll(pointerY: number, grabOffset: number, bar: ScrollbarGeometry): number {
  const most = maxScroll(bar.rowCount, bar.visibleRows),
    thumb = thumbHeight(bar.h, bar.rowCount, bar.visibleRows, bar.minThumbHeight),
    travel = Math.max(0, bar.h - thumb);
  if (most === 0 || travel === 0) return 0;
  const top = clamp(pointerY - grabOffset, bar.y, bar.y + travel);
  return clamp(div((top - bar.y) * most + div(travel, 2), travel), 0, most);
}

/** `clampIndexIntoVisible`: the selection pulled into the rows a scroll shows. */
export function clampIndexIntoVisible(
  index: number,
  scroll: number,
  size: number,
  visibleRows: number,
): number {
  if (size <= 0) return 0;
  const result = clamp(index, 0, size - 1);
  if (result < scroll) return scroll;
  if (result >= scroll + visibleRows) return Math.min(size - 1, scroll + visibleRows - 1);
  return result;
}

/** The scroll that keeps `index` in view, the way the lists follow a keyboard cursor. */
export function scrollToShow(
  index: number,
  scroll: number,
  size: number,
  visibleRows: number,
): number {
  let next = scroll;
  if (index < next) next = index;
  else if (index >= next + visibleRows) next = index - visibleRows + 1;
  return clamp(next, 0, maxScroll(size, visibleRows));
}

/**
 * A press on a list's scrollbar: the thumb starts a drag (the grab offset to keep), the track pages.
 * `null` when the press is not on the bar or the list does not scroll.
 */
export function pressScrollbar(
  px: number,
  py: number,
  scroll: number,
  bar: ScrollbarGeometry,
): { drag: number } | { scroll: number } | null {
  if (bar.rowCount <= bar.visibleRows || !trackContains(px, py, bar)) return null;
  const thumb = thumbHeight(bar.h, bar.rowCount, bar.visibleRows, bar.minThumbHeight),
    top = thumbY(bar.y, bar.h, thumb, bar.rowCount, bar.visibleRows, scroll);
  if (thumbContains(px, py, bar, top, thumb)) return { drag: py - top };
  return { scroll: pageScroll(py, scroll, bar) };
}
