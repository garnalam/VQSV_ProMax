/** Web only: the currency code the Shop Donate's price pills use for "Lượng" (`DonateShop`). */
export const LUONG_SHOP_CELL = -3;
/** The pack key of the 12px Lượng mark. */
export const LUONG_ICON_KEY = "items.icons/LUONG.png";
let source: () => HTMLImageElement | undefined = () => undefined;
/** The screen hands over its pack lookup once (`NewGameScreen`). */
export function setLuongIconSource(lookup: () => HTMLImageElement | undefined): void {
  source = lookup;
}
/** A sprite-257 cell lookup that also answers the Lượng mark. */
export const withLuong =
  (cell: ((index: number) => HTMLImageElement | undefined) | undefined) =>
  (index: number): HTMLImageElement | undefined =>
    index === LUONG_SHOP_CELL ? source() : cell?.(index);
