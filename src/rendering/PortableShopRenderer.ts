import { drawShopConfirmOverlay, shopCurrencyCell } from "./WorldShopRenderer";
import type { WorldPanel } from "../game/world/WorldPanel";
import { SHOP_UI } from "../game/world/WorldPanel";
import type { PanelFontRenderer } from "./PanelFontRenderer";
import {
  bagButton,
  bagMarquee,
  bagPill,
  bagText,
  bagWrappedFixed,
  darker,
  drawRoundRect,
  fillRoundRect,
  hex,
  itemIcon,
  shopPanelBase,
  shopScrollbar,
} from "./ModernShopKit";

/**
 * JavaSE "Sủng vật thương điếm" (`Mode.PORTABLE_SHOP*`): `renderPortableShop` (the four counters),
 * `renderPortableShopBuy` (the `shopbuy` stock of table 4/0 or 3/2) and, over it,
 * `drawShopConfirmOverlay`.
 */
export type PortableShopArt = {
  font: PanelFontRenderer;
  /** A sprite-258 item icon cell. */
  icon: (index: number) => HTMLImageElement | undefined;
  /** A sprite-257 cell (currency marks). */
  cell?: (index: number) => HTMLImageElement | undefined;
  /** `shop-icons.<n>`: a unified item icon. */
  unifiedIcon?: (index: number) => HTMLImageElement | undefined;
};

/** `PORTABLE_SHOP_LABELS` and the tags/colours `renderPortableShop` gives each counter. */
const LABELS = [
    "Thương điếm bình dân",
    "Nhận 10 huy hiệu mỗi ngày",
    "Thương điếm thời trang",
    "Cửa hàng tài liệu",
  ],
  TAGS = ["Vật phẩm", "Hàng ngày", "Thời trang", "Tài liệu"],
  COLORS = [0x2e9c7b, 0xd0a83a, 0x3e91c5, 0x7b58a1],
  SERVICE = { x: 20, y: 79, w: 200, h: 27, stride: 29 },
  SERVICE_DETAIL = { x: 20, y: 226, w: 200, h: 31 },
  WALLET = { x: 20, y: 76, w: 200, h: 19 };

/** `VqsvShopCurrencyRenderer.draw`: the amount then its currency cell, centred in the box. */
function currencyAmount(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  cell: PortableShopArt["cell"],
  amount: number,
  currency: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
): void {
  const text = String(amount),
    icon = cell?.(shopCurrencyCell(currency)),
    textY = y + Math.max(0, Math.trunc((h - font.height) / 2));
  if (!icon || !icon.complete || icon.naturalWidth <= 0) {
    font.drawTagged(g, text, x, textY, hex(color));
    return;
  }
  const textW = font.width(text),
    dx = x + Math.max(0, Math.trunc((w - (textW + 2 + icon.naturalWidth)) / 2));
  font.drawTagged(g, text, dx, textY, hex(color));
  g.drawImage(icon, dx + textW + 2, y + Math.max(0, Math.trunc((h - icon.naturalHeight) / 2)));
}

/** `drawPortableShopServiceIcon`: the counter's little glyph on its pale tile. */
function serviceIcon(
  g: CanvasRenderingContext2D,
  type: number,
  x: number,
  y: number,
  color: number,
  active: boolean,
): void {
  fillRoundRect(g, x - 3, y - 3, 23, 20, 6, hex(active ? 0xf2c862 : 0xd8eeee));
  g.fillStyle = hex(color);
  g.strokeStyle = hex(color);
  g.lineWidth = 1;
  const oval = (ox: number, oy: number, w: number, h: number, fill: boolean) => {
    g.beginPath();
    g.ellipse(ox + w / 2, oy + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    if (fill) g.fill();
    else g.stroke();
  };
  switch (type) {
    case 0:
      g.fillRect(x + 1, y + 4, 13, 8);
      g.strokeRect(x + 4.5, y + 1.5, 7, 4);
      break;
    case 1:
      g.fillRect(x + 6, y, 3, 14);
      g.fillRect(x, y + 6, 15, 3);
      break;
    case 2:
      oval(x + 1, y, 13, 13, true);
      g.fillStyle = hex(active ? 0xf2c862 : 0xd8eeee);
      oval(x + 5, y + 4, 5, 5, true);
      break;
    case 3:
      oval(x, y + 2, 10, 10, true);
      oval(x + 5.5, y + 0.5, 10, 10, false);
      break;
    default:
      g.beginPath();
      g.moveTo(x + 7, y);
      g.lineTo(x + 14, y + 6);
      g.lineTo(x + 10, y + 14);
      g.lineTo(x + 4, y + 14);
      g.lineTo(x, y + 6);
      g.closePath();
      g.fill();
  }
}

/** `renderPortableShop`. */
function drawMenu(g: CanvasRenderingContext2D, panel: WorldPanel, art: PortableShopArt): void {
  const { font } = art,
    accent = 0x7b58a1;
  shopPanelBase(g, font, "SỦNG VẬT THƯƠNG ĐIẾM", accent);
  bagPill(g, font, "", 158, 51, 60, 15, 0xf2c862, 0x5c481a);
  currencyAmount(g, font, art.cell, panel.portableShopSource.money(), 0, 158, 51, 60, 15, 0x5c481a);
  for (let i = 0; i < LABELS.length; i++) {
    const y = SERVICE.y + i * SERVICE.stride,
      active = i === panel.selected;
    if (active) fillRoundRect(g, SERVICE.x + 3, y + 3, SERVICE.w, SERVICE.h, 7, "#071f2d");
    fillRoundRect(
      g,
      SERVICE.x,
      y,
      SERVICE.w,
      SERVICE.h,
      7,
      hex(active ? darker(COLORS[i]) : 0xf2fbf8),
    );
    drawRoundRect(g, SERVICE.x, y, SERVICE.w - 1, SERVICE.h - 1, 7, active ? "#f2c862" : "#75aaa9");
    fillRoundRect(g, SERVICE.x, y, 7, SERVICE.h, 7, hex(COLORS[i]));
    serviceIcon(g, i === 0 ? 0 : i + 1, SERVICE.x + 18, y + 6, COLORS[i], active);
    bagMarquee(
      g,
      font,
      LABELS[i],
      SERVICE.x + 42,
      y + 8,
      112,
      active ? 0xffffff : 0x174f69,
      panel.openedTicks,
    );
    bagPill(
      g,
      font,
      TAGS[i],
      SERVICE.x + 158,
      y + 6,
      37,
      15,
      active ? 0xf2c862 : 0x173f56,
      active ? 0x5c481a : 0xffffff,
    );
    if (active) {
      // The moving shine across the chosen counter.
      g.save();
      g.beginPath();
      g.rect(SERVICE.x + 8, y + 2, SERVICE.w - 16, SERVICE.h - 4);
      g.clip();
      const shine =
        SERVICE.x + 12 + ((Math.max(0, panel.openedTicks) * 2) % Math.max(1, SERVICE.w - 24));
      g.fillStyle = "rgba(255, 255, 255, 0.149)";
      g.fillRect(shine, y + 2, 8, SERVICE.h - 4);
      g.restore();
    }
  }
  fillRoundRect(
    g,
    SERVICE_DETAIL.x,
    SERVICE_DETAIL.y,
    SERVICE_DETAIL.w,
    SERVICE_DETAIL.h,
    7,
    "#173f56",
  );
  drawRoundRect(
    g,
    SERVICE_DETAIL.x,
    SERVICE_DETAIL.y,
    SERVICE_DETAIL.w - 1,
    SERVICE_DETAIL.h - 1,
    7,
    "#f2c862",
  );
  bagWrappedFixed(
    g,
    font,
    panel.portableShopSource.description(panel.selected),
    SERVICE_DETAIL.x + 8,
    SERVICE_DETAIL.y + 5,
    SERVICE_DETAIL.w - 16,
    2,
    0xffffff,
  );
  bagButton(
    g,
    font,
    "Mở quầy",
    SHOP_UI.actionX,
    SHOP_UI.actionY,
    SHOP_UI.actionW,
    SHOP_UI.actionH,
    true,
    accent,
  );
  bagButton(
    g,
    font,
    "Quay lại",
    SHOP_UI.backX,
    SHOP_UI.backY,
    SHOP_UI.backW,
    SHOP_UI.backH,
    false,
    accent,
  );
}

/** `drawPanelShopPricePill`. */
function pricePill(
  g: CanvasRenderingContext2D,
  art: PortableShopArt,
  price: number,
  currency: number,
  x: number,
  y: number,
  w: number,
  h: number,
  active: boolean,
): void {
  fillRoundRect(g, x, y, w, h, 6, active ? "#f2c862" : "#173f56");
  drawRoundRect(g, x, y, w - 1, h - 1, 6, active ? "#ffffff" : "#69aaa4");
  currencyAmount(
    g,
    art.font,
    art.cell,
    price,
    currency,
    x + 2,
    y,
    w - 4,
    h,
    active ? 0x5c481a : 0xffffff,
  );
}

/** `renderPortableShopBuy`. */
function drawBuy(g: CanvasRenderingContext2D, panel: WorldPanel, art: PortableShopArt): void {
  const { font } = art,
    material = panel.portableShopMaterial,
    accent = material ? 0x7b58a1 : 0x2e9c7b;
  shopPanelBase(g, font, material ? "CỬA HÀNG TÀI LIỆU" : "THƯƠNG ĐIẾM BÌNH DÂN", accent);
  fillRoundRect(g, WALLET.x, WALLET.y, WALLET.w, WALLET.h, 6, "#235f60");
  bagText(g, font, "KIM TIỀN", WALLET.x + 8, WALLET.y + 5, 48, 0xbfe9e2);
  bagText(
    g,
    font,
    String(panel.portableShopSource.money()),
    WALLET.x + 59,
    WALLET.y + 5,
    48,
    0xf2c862,
  );
  bagText(g, font, "HUY HIỆU", WALLET.x + 116, WALLET.y + 5, 51, 0xbfe9e2);
  bagText(
    g,
    font,
    String(panel.portableShopSource.badges()),
    WALLET.x + 171,
    WALLET.y + 5,
    23,
    0xf2c862,
  );
  const offers = panel.portableShopOffers,
    size = offers.length,
    first = Math.max(0, Math.min(panel.listScroll, Math.max(0, size - 5)));
  for (let i = 0; i < SHOP_UI.visibleRows; i++) {
    const index = first + i,
      y = SHOP_UI.listY + i * SHOP_UI.rowStride,
      active = index < size && index === panel.selected;
    if (active)
      fillRoundRect(g, SHOP_UI.listX + 3, y + 2, SHOP_UI.listW, SHOP_UI.rowH, 6, "#071f2d");
    fillRoundRect(
      g,
      SHOP_UI.listX,
      y,
      SHOP_UI.listW,
      SHOP_UI.rowH,
      6,
      hex(active ? darker(accent) : 0xf0fbf8),
    );
    drawRoundRect(
      g,
      SHOP_UI.listX,
      y,
      SHOP_UI.listW - 1,
      SHOP_UI.rowH - 1,
      6,
      active ? "#f2c862" : "#75aaa9",
    );
    fillRoundRect(g, SHOP_UI.listX, y, 5, SHOP_UI.rowH, 5, hex(active ? 0xf2c862 : accent));
    if (index >= size) continue;
    const offer = offers[index],
      iconX = SHOP_UI.listX + 9,
      iconY = y + 3,
      unified =
        offer.unifiedIcon !== undefined && offer.unifiedIcon !== null
          ? art.unifiedIcon?.(offer.unifiedIcon)
          : undefined;
    // `UnifiedItemIconRenderer.draw`, else the sheet-258 cell.
    if (unified?.complete && unified.naturalWidth > 0) itemIcon(g, unified, iconX, iconY, 13, 13);
    else {
      const cell = art.icon(offer.icon);
      if (cell?.complete && cell.naturalWidth > 0) g.drawImage(cell, iconX, iconY);
    }
    bagMarquee(
      g,
      font,
      offer.name,
      SHOP_UI.listX + 28,
      y + 5,
      102,
      active ? 0xffffff : 0x174f69,
      panel.openedTicks,
    );
    pricePill(
      g,
      art,
      offer.unitPrice,
      offer.currencyCode ?? (offer.currency === "badges" ? 1 : 0),
      SHOP_UI.listX + 137,
      y + 3,
      51,
      14,
      active,
    );
  }
  const selected = offers[panel.selected],
    quote = panel.portableShopQuote;
  fillRoundRect(
    g,
    SHOP_UI.detailX,
    SHOP_UI.detailY,
    SHOP_UI.detailW,
    SHOP_UI.detailH,
    7,
    "#173f56",
  );
  drawRoundRect(
    g,
    SHOP_UI.detailX,
    SHOP_UI.detailY,
    SHOP_UI.detailW - 1,
    SHOP_UI.detailH - 1,
    7,
    "#f2c862",
  );
  bagMarquee(
    g,
    font,
    selected ? selected.name : "Không có hàng",
    SHOP_UI.detailX + 8,
    SHOP_UI.detailY + 5,
    125,
    0xf2c862,
    panel.openedTicks,
  );
  if (selected)
    bagPill(
      g,
      font,
      `Có ${quote?.currentCount ?? 0}`,
      SHOP_UI.detailX + 145,
      SHOP_UI.detailY + 3,
      47,
      15,
      0x2e9c7b,
      0xffffff,
    );
  bagWrappedFixed(
    g,
    font,
    selected ? selected.description : "Chưa có món hàng trong quầy này.",
    SHOP_UI.detailX + 8,
    SHOP_UI.detailY + 18,
    SHOP_UI.detailW - 16,
    2,
    0xffffff,
  );
  shopScrollbar(g, size, first);
  bagButton(
    g,
    font,
    "Mua",
    SHOP_UI.actionX,
    SHOP_UI.actionY,
    SHOP_UI.actionW,
    SHOP_UI.actionH,
    true,
    accent,
  );
  bagButton(
    g,
    font,
    "Quay lại",
    SHOP_UI.backX,
    SHOP_UI.backY,
    SHOP_UI.backW,
    SHOP_UI.backH,
    false,
    accent,
  );
}

export function drawPortableShop(
  g: CanvasRenderingContext2D,
  panel: WorldPanel,
  art: PortableShopArt,
): void {
  if (panel.mode === "portableShop") {
    drawMenu(g, panel, art);
    return;
  }
  drawBuy(g, panel, art);
  if (panel.mode === "portableShopConfirm" && art.cell) {
    // JavaSE `renderPortableShopConfirm`: `VqsvBattleRenderer.drawShopConfirmOverlay`.
    const quote = panel.portableShopQuote,
      offer = panel.portableShopOffer;
    drawShopConfirmOverlay(
      g,
      art.font,
      art.cell,
      panel.portableShopQuantity,
      quote?.total ?? 0,
      offer?.currencyCode ?? (offer?.currency === "badges" ? 1 : 0),
    );
  }
}
