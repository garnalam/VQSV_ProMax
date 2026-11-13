import type { ScrollbarGeometry } from "../../ui/UiScrollbarMath";

/**
 * Where the battle's pointer targets are: Java's `VqsvBattleSkillUiLayout`, `VqsvBattleItemUiLayout`,
 * `VqsvCatchBallUiLayout` and `VqsvPetStateUiLayout`, plus the command bar's `commandIndexAt`. The
 * renderer draws on the same numbers, so a row is hit exactly where it is painted.
 */
export type Rect = { x: number; y: number; w: number; h: number };

export type BattleListLayout = {
  /** The visible rows: `rowH` tall, one every `stride` pixels from `y`. */
  list: { x: number; y: number; w: number; rowH: number; stride: number; visibleRows: number };
  /** The scrollbar's hit rect and the shortest thumb it draws. */
  scrollbar: { x: number; y: number; w: number; h: number; minThumbHeight: number };
  action: Rect;
  back: Rect;
};

export const contains = (x: number, y: number, r: Rect): boolean =>
  x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

/** `VqsvBattleSkillUiLayout`: five 23px rows, the bar beside them. */
export const SKILL_LIST: BattleListLayout = {
  list: { x: 14, y: 88, w: 121, rowH: 23, stride: 23, visibleRows: 5 },
  scrollbar: { x: 137, y: 90, w: 4, h: 111, minThumbHeight: 8 },
  action: { x: 14, y: 264, w: 91, h: 22 },
  back: { x: 135, y: 264, w: 91, h: 22 },
};

/** `VqsvBattleItemUiLayout`: the bag (Đạo cụ) panel. The hit rect is the bar widened by 1px a side. */
export const ITEM_LIST: BattleListLayout = {
  list: { x: 32, y: 88, w: 176, rowH: 21, stride: 23, visibleRows: 5 },
  scrollbar: { x: 210, y: 88, w: 6, h: 21 + 4 * 23, minThumbHeight: 9 },
  action: { x: 42, y: 254, w: 66, h: 20 },
  back: { x: 138, y: 254, w: 60, h: 20 },
};

/** `VqsvCatchBallUiLayout`: the ball list (Bắt sủng vật) panel. */
export const CATCH_LIST: BattleListLayout = {
  list: { x: 23, y: 99, w: 92, rowH: 21, stride: 23, visibleRows: 5 },
  scrollbar: { x: 115, y: 99, w: 5, h: 21 + 4 * 23, minThumbHeight: 9 },
  action: { x: 34, y: 263, w: 72, h: 19 },
  back: { x: 137, y: 263, w: 69, h: 19 },
};

/** `drawShopBuyOverlay`: five rows and its two softkeys. */
export const SHOP_LIST: BattleListLayout = {
  list: { x: 20, y: 99, w: 196, rowH: 19, stride: 21, visibleRows: 5 },
  scrollbar: { x: 217, y: 99, w: 6, h: 103, minThumbHeight: 9 },
  action: { x: 25, y: 264, w: 76, h: 19 },
  back: { x: 140, y: 264, w: 75, h: 19 },
};

/** `VqsvPetStateUiLayout`: the 3×2 roster cards, the two arrows, the tabs and the buttons. */
export const PET_STATE = {
  roster: { x: 32, y: 228, cardW: 52, cardH: 15, columnStride: 60, rowStride: 18, columns: 3 },
  visiblePets: 6,
  previous: { x: 202, y: 223, w: 14, h: 14 },
  next: { x: 202, y: 242, w: 14, h: 14 },
  tabs: [
    { x: 30, y: 68, w: 44, h: 11 },
    { x: 74, y: 68, w: 42, h: 11 },
    { x: 117, y: 68, w: 44, h: 11 },
    { x: 162, y: 68, w: 45, h: 11 },
  ],
  action: { x: 42, y: 263, w: 64, h: 22 },
  back: { x: 144, y: 263, w: 56, h: 22 },
} as const;

/** `commandIndexAt`: the six command buttons along the bottom band. */
export const COMMAND_CENTERS = [20, 56, 98, 137, 176, 218];
export function commandIndexAt(x: number, y: number): number {
  if (x < 0 || y < 286 || y > 319) return -1;
  return COMMAND_CENTERS.findIndex((center) => x >= center - 18 && x <= center + 18);
}

/** The row under the pointer (`skillIndexAt` / `itemIndexAt` / `ballIndexAt`), or -1. */
export function listIndexAt(
  layout: BattleListLayout,
  x: number,
  y: number,
  count: number,
  scroll: number,
): number {
  const { list } = layout;
  if (x < list.x || x >= list.x + list.w || y < list.y) return -1;
  const local = y - list.y,
    row = Math.floor(local / list.stride);
  if (row < 0 || row >= list.visibleRows || local % list.stride >= list.rowH) return -1;
  const index = Math.max(0, scroll) + row;
  return index < count ? index : -1;
}

/** `petIndexAt`: the roster card under the pointer, or -1. */
export function petIndexAt(x: number, y: number, count: number, scroll: number): number {
  const r = PET_STATE.roster;
  if (x < r.x || y < r.y) return -1;
  const localX = x - r.x,
    localY = y - r.y,
    column = Math.floor(localX / r.columnStride),
    row = Math.floor(localY / r.rowStride);
  if (
    column >= r.columns ||
    row >= 2 ||
    localX % r.columnStride >= r.cardW ||
    localY % r.rowStride >= r.cardH
  )
    return -1;
  const index = Math.max(0, scroll) + row * r.columns + column;
  return index < count ? index : -1;
}

/** The list's scrollbar as `UiScrollbarMath` reads it. */
export function scrollbarOf(layout: BattleListLayout, rowCount: number): ScrollbarGeometry {
  const bar = layout.scrollbar;
  return { ...bar, rowCount, visibleRows: layout.list.visibleRows };
}
