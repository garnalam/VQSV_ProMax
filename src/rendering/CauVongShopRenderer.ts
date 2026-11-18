import {
  type CauVongShopPanelState,
  type CauVongShopPurse,
  shopCount,
  shopMainMenu,
  shopTitle,
} from "../game/world/CauVongShop";
import type { PanelFontRenderer } from "./PanelFontRenderer";

/**
 * JavaSE `CauVongShopPanel.render`: a flat 240×320 sheet — the title, the purse, then the main menu
 * or the offers (seven 23 px rows, 25 px apart) with the selected row's price, or the quantity page;
 * the last message (33 characters a line, three lines at most) and the two softkey labels.
 */
const hex = (value: number) => `#${((value & 0xffffff) | 0x1000000).toString(16).slice(1)}`;

export function drawCauVongShop(
  g: CanvasRenderingContext2D,
  shop: CauVongShopPanelState,
  purse: CauVongShopPurse | undefined,
  font: PanelFontRenderer,
): void {
  const text = (value: string, x: number, y: number, color: number) =>
    font.drawTagged(g, value, x, y, hex(color));
  const wrap = (value: string, x: number, y: number, color: number) => {
    const max = 33;
    for (let i = 0; i < value.length && i < max * 3; i += max)
      text(value.substring(i, Math.min(value.length, i + max)), x, y + (i / max) * 12, color);
  };
  g.fillStyle = hex(0x102b3c);
  g.fillRect(0, 0, 240, 320);
  text(shopTitle(shop.category), 12, 12, 0xffe19a);
  const money = purse?.currency.money ?? 0,
    badges = purse?.currency.badges ?? 0;
  text(`Kim: ${money} · Huy hiệu: ${badges}`, 12, 30, 0xffffff);
  if (shop.menu === 2) {
    const row = shop.offers[shop.selected];
    if (row) {
      wrap(row.name, 12, 65, 0xffe19a);
      text(`Đang có: ${purse ? shopCount(purse, row) : 0}`, 12, 111, 0xffffff);
      text(`<       Số lượng: ${shop.qty}       >`, 20, 154, 0xffffff);
      text(
        `${shop.selling ? "Nhận: " : "Cần: "}${shop.qty * row.price}${row.badges ? " huy hiệu" : " kim tiền"}`,
        12,
        180,
        0xffe19a,
      );
    }
    g.fillStyle = hex(0x376478);
    g.fillRect(10, 195, 220, 29);
    text(shop.selling ? "Xác nhận bán" : "Xác nhận mua", 49, 204, 0xffffff);
  } else {
    const main = shopMainMenu(shop.category, shop.donate),
      size = shop.menu === 0 ? main.length : shop.offers.length;
    for (let i = shop.scroll; i < Math.min(size, shop.scroll + 7); i++) {
      const y = 48 + (i - shop.scroll) * 25;
      g.fillStyle = hex(i === shop.selected ? 0x376478 : 0x183d50);
      g.fillRect(10, y, 220, 23);
      text(shop.menu === 0 ? main[i] : shop.offers[i].name, 14, y + 5, 0xffffff);
    }
    if (shop.menu === 1 && shop.offers.length > 0) {
      const row = shop.offers[shop.selected];
      text(
        `${shop.selling ? "Bán: " : "Giá: "}${row.price}${row.badges ? " huy hiệu" : " kim tiền"} · Có: ${purse ? shopCount(purse, row) : 0}`,
        12,
        232,
        0xffe19a,
      );
    } else if (shop.menu === 1) text("Không có vật phẩm bán được.", 12, 232, 0xffffff);
  }
  wrap(shop.message, 12, 252, 0xffe19a);
  text(shop.menu === 2 ? "Xác nhận / 5" : "Chọn / 5", 12, 304, 0xffffff);
  text("Quay lại", 177, 304, 0xffffff);
}
