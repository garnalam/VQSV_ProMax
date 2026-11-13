import { WORLD_SHOP_LABELS, WORLD_SHOP_ROW_WIDGETS } from "../game/shop/WorldShop";
import {
  CONVENIENCE_ROW_WIDGETS,
  PET_BANK_LABELS,
  PET_BANK_ROW_WIDGETS,
  type WorldPanel,
} from "../game/world/WorldPanel";
import { thumbHeight, thumbY } from "../ui/UiScrollbarMath";
import { decodeMojibake } from "./text/TextCodec";
import type { PanelFontRenderer } from "./PanelFontRenderer";
import type { SourceUiLayout } from "./SourceUiLayout";
import {
  drawCellTopLeft,
  drawRows,
  drawSoftkey,
  drawText,
  drawTextMarquee,
  drawTextWide,
  drawWidgetCell,
  drawWrappedTextBoxScrolled,
  fillBand,
  selectedColor,
  widgetColor,
  type WorldPanelArt,
} from "./WorldPanelRenderer";

/**
 * JavaSE "Thương điếm" (`Mode.SOURCE_WORLD_SHOP*`): `renderSourceWorldShop` on `shop.ui`,
 * `renderSourceWorldShopSell` on `shopbuy.ui` with `VqsvBattleRenderer.drawShopConfirmOverlay`
 * over it while confirming, and `renderSourceWorldShopRecoverConfirm` on `msgRecover.ui`.
 */
export type WorldShopLayouts = {
  shop: SourceUiLayout;
  shopbuy: SourceUiLayout;
  msgRecover: SourceUiLayout;
};
export type WorldShopArt = WorldPanelArt & {
  /** A sprite-258 item icon cell. */
  icon: (cell: number) => HTMLImageElement | undefined;
};

/** `SHOPBUY_ROW_*` widgets of `shopbuy.ui`. */
const ROW_BACKGROUNDS = [12, 17, 22, 27, 32],
  ROW_ICONS = [51, 52, 53, 54, 55],
  ROW_NAMES = [14, 19, 24, 29, 34],
  ROW_PRICES = [15, 20, 25, 30, 35],
  ROW_CURRENCIES = [45, 46, 47, 48, 49];

const hex = (value: number) => `#${((value & 0xffffff) | 0x1000000).toString(16).slice(1)}`;

/** `VqsvShopCurrencyRenderer.iconCell`: sheet-257 cell for a currency code. */
export const shopCurrencyCell = (currency: number) =>
  currency === 1 ? 83 : currency === 2 ? 74 : 84;

/** `drawMenuFrame`: the three bands and the frame cell (`shop.ui` has no widget 13). */
function drawMenuFrame(
  g: CanvasRenderingContext2D,
  art: WorldPanelArt,
  layout: SourceUiLayout,
): void {
  fillBand(g, layout, 2, 0xc6f0ff, 7);
  fillBand(g, layout, 3, 0xbee7f2, 102);
  fillBand(g, layout, 4, 0x6cb7bb, 8);
  drawWidgetCell(g, art, layout, 1);
  drawWidgetCell(g, art, layout, 13);
}

/** `renderSourceWorldShop` / `renderSourcePetBank`: `shop.ui` with a title and its rows. */
export function drawShopMenu(
  g: CanvasRenderingContext2D,
  art: WorldPanelArt,
  layout: SourceUiLayout,
  title: string,
  widgets: readonly number[],
  labels: readonly string[],
  selected: number,
): void {
  drawMenuFrame(g, art, layout);
  drawTextWide(
    g,
    art,
    layout,
    5,
    title,
    -8,
    layout.w(5, 120),
    widgetColor(layout.widget(5), 0xd0010e),
  );
  drawRows(g, art, layout, widgets, labels, selected);
  drawSoftkey(g, art, layout, 10, layout.text(10, "Xác định"), 0xffffff);
  drawSoftkey(g, art, layout, 11, layout.text(11, "Quay lại"), 0xffffff);
}

/** `drawShopbuyScrollbar`: track widget 38, 84 px, five rows. */
function drawShopbuyScrollbar(
  g: CanvasRenderingContext2D,
  layout: SourceUiLayout,
  rows: number,
  scroll: number,
): void {
  const track = layout.widget(38);
  if (!track || rows <= 5) return;
  const height = 84,
    thumb = thumbHeight(height, rows, 5, 8),
    y = thumbY(track.y, height, thumb, rows, 5, scroll),
    j = track.jColor ?? 0;
  g.fillStyle = hex(j === 0 || j === -1 ? 0x51d8e9 : j);
  g.fillRect(track.x, track.y, Math.max(1, track.w), height);
  g.fillStyle = "#c6f3ff";
  g.fillRect(track.x, y, Math.max(1, track.w), thumb);
}

/** `renderSourceWorldShopSell`: the bag's sellable items at half price. */
function drawSellList(
  g: CanvasRenderingContext2D,
  panel: WorldPanel,
  art: WorldShopArt,
  layout: SourceUiLayout,
): void {
  drawWidgetCell(g, art, layout, 4);
  fillBand(g, layout, 1, 0xbee7f2, 160);
  fillBand(g, layout, 2, 0x51d069, 10);
  fillBand(g, layout, 3, 0xc6f0ff, 8);
  fillBand(g, layout, 8, 0x51d8e9, 91);
  drawTextWide(
    g,
    art,
    layout,
    5,
    "Bán ra",
    0,
    layout.w(5, 100),
    widgetColor(layout.widget(5), 0xffffff),
  );
  drawTextWide(g, art, layout, 9, "Vật phẩm", 0, 48, widgetColor(layout.widget(9), 0x1c6c91));
  drawTextWide(g, art, layout, 10, "Giá bán", -6, 52, widgetColor(layout.widget(10), 0x1c6c91));
  const rows = panel.worldShopSellRows,
    size = rows.length,
    first = Math.max(0, Math.min(panel.listScroll, Math.max(0, size - 5)));
  for (let i = 0; i < ROW_BACKGROUNDS.length; i++) {
    const index = first + i,
      bg = layout.widget(ROW_BACKGROUNDS[i]);
    if (bg)
      drawCellTopLeft(
        g,
        art,
        index === panel.selected ? (bg.altId ?? -1) : (bg.imageId ?? -1),
        bg.x,
        bg.y,
      );
    if (index >= size) continue;
    const row = rows[index],
      icon = art.icon(row.iconCell);
    if (icon?.complete && icon.naturalWidth > 0)
      g.drawImage(icon, layout.x(ROW_ICONS[i], 56), layout.y(ROW_ICONS[i], 100 + i * 18));
    const color =
      index === panel.selected ? 0xffa500 : widgetColor(layout.widget(ROW_NAMES[i]), 0x1c6c91);
    drawTextMarquee(
      g,
      art,
      layout,
      ROW_NAMES[i],
      row.name,
      layout.w(ROW_NAMES[i], 48),
      color,
      panel.openedTicks,
    );
    drawTextWide(
      g,
      art,
      layout,
      ROW_PRICES[i],
      String(row.unitPrice),
      0,
      layout.w(ROW_PRICES[i], 36),
      color,
    );
    drawCellTopLeft(
      g,
      art,
      shopCurrencyCell(row.currency),
      layout.x(ROW_CURRENCIES[i], 170),
      layout.y(ROW_CURRENCIES[i], 101 + i * 18),
    );
  }
  const selected = size ? rows[Math.max(0, Math.min(size - 1, panel.selected))] : undefined;
  drawWrappedTextBoxScrolled(
    g,
    art,
    layout,
    56,
    selected?.description ?? "",
    layout.w(56, 125),
    44,
    widgetColor(layout.widget(56), 0x1c6c91),
    panel.openedTicks,
  );
  drawWidgetCell(g, art, layout, 41);
  drawWidgetCell(g, art, layout, 42);
  drawText(
    g,
    art,
    layout,
    43,
    String(panel.worldShopSource.badges()),
    widgetColor(layout.widget(43), 0x1c6c91),
  );
  drawText(
    g,
    art,
    layout,
    44,
    String(panel.worldShopSource.money()),
    widgetColor(layout.widget(44), 0x1c6c91),
  );
  drawShopbuyScrollbar(g, layout, size, first);
  drawSoftkey(g, art, layout, 57, layout.text(57, "Bán đi"), 0xffffff);
  drawSoftkey(g, art, layout, 58, layout.text(58, "Quay lại"), 0xffffff);
}

/** `renderSourceWorldShopRecoverConfirm`. */
function drawRecoverConfirm(
  g: CanvasRenderingContext2D,
  panel: WorldPanel,
  art: WorldPanelArt,
  layout: SourceUiLayout,
): void {
  drawWidgetCell(g, art, layout, 3);
  drawTextWide(
    g,
    art,
    layout,
    4,
    "Có khôi phục trạng thái ba lô sủng vật không?",
    0,
    layout.w(4, 132),
    widgetColor(layout.widget(4), 0x1c6c91),
  );
  drawTextWide(
    g,
    art,
    layout,
    5,
    "Cần tiền tài: ",
    0,
    layout.w(5, 60),
    widgetColor(layout.widget(5), 0x1c6c91),
  );
  drawTextWide(
    g,
    art,
    layout,
    6,
    String(Math.max(0, panel.worldShopRecoveryCost)),
    0,
    layout.w(6, 40),
    widgetColor(layout.widget(6), 0xef2894),
  );
  drawWidgetCell(g, art, layout, 7);
  drawTextWide(
    g,
    art,
    layout,
    8,
    String(panel.worldShopSource.money()),
    0,
    layout.w(8, 48),
    widgetColor(layout.widget(8), 0xef2894),
  );
  drawSoftkey(g, art, layout, 1, layout.text(1, "Xác định"), 0xffffff);
  drawSoftkey(g, art, layout, 2, layout.text(2, "Quay lại"), 0xffffff);
}

// ------------------------------------------------------------------ drawShopConfirmOverlay

const fill = (
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
) => {
  g.fillStyle = hex(color);
  g.fillRect(x, y, w, h);
};
const rect = (
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
) => {
  g.strokeStyle = hex(color);
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, w, h);
};
/** `drawTinyBattleText`: one line clipped to its box (18 px tall). */
function tiny(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  text: string,
  x: number,
  y: number,
  width: number,
  color: number,
): void {
  g.save();
  g.beginPath();
  g.rect(x, y - 1, width, 18);
  g.clip();
  font.drawTagged(g, text, x, y, hex(color));
  g.restore();
}
/** `drawCenteredTinyText`. */
function centeredTiny(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  text: string,
  x: number,
  y: number,
  width: number,
  color: number,
): void {
  const decoded = decodeMojibake(text);
  tiny(
    g,
    font,
    decoded,
    x + Math.max(0, Math.trunc((width - Math.min(width, font.width(decoded))) / 2)),
    y,
    width,
    color,
  );
}
/** `drawSourceWidgetText` with align 4: centred in the box, vertically by (h - 10) / 2. */
function boxText(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
): void {
  const decoded = decodeMojibake(text),
    width = font.taggedWidth(decoded),
    tx = width > w ? x : x + Math.max(0, Math.trunc((w - width) / 2)),
    ty = y + Math.max(0, Math.trunc((h - 10) / 2));
  g.save();
  g.beginPath();
  g.rect(x, y, w, Math.max(1, h));
  g.clip();
  font.drawTagged(g, decoded, tx, ty, hex(color));
  g.restore();
}
/** `drawModernChoiceSoftkey`. */
function softkey(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  primary: boolean,
  accent: number,
): void {
  fill(g, x + 2, y + 2, w, h, 0x0b2838);
  fill(g, x, y, w, h, primary ? accent : 0xb7dce6);
  fill(g, x + 2, y + 2, w - 4, 2, primary ? 0x5fc6df : 0xe3f6fa);
  fill(g, x + 2, y + h - 4, w - 4, 2, primary ? 0x0d5f7e : 0x71aebd);
  rect(g, x, y, w - 1, h - 1, primary ? 0xfff16a : 0x34606e);
  boxText(g, font, text, x + 2, y, w - 4, h, primary ? 0xffffff : 0x1c6c91);
}

/**
 * `VqsvBattleRenderer.drawShopConfirmOverlay(quantity, total, currency)`: the shared quantity box of
 * every shop (buy and sell alike say "XÁC NHẬN MUA", as in JavaSE).
 */
export function drawShopConfirmOverlay(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  cell: (index: number) => HTMLImageElement | undefined,
  quantity: number,
  total: number,
  currency: number,
): void {
  const x = 31,
    y = 92,
    w = 178,
    h = 139;
  g.fillStyle = "rgba(0, 16, 24, 0.667)";
  g.fillRect(0, 36, 240, 252);
  fill(g, x + 3, y + 4, w, h, 0x071f2d);
  fill(g, x, y, w, h, 0xd4efec);
  fill(g, x + 2, y + 2, w - 4, 28, 0x184e4f);
  fill(g, x + 2, y + 29, w - 4, 3, 0xf2c862);
  // `drawChoiceFrame`.
  rect(g, x, y, w - 1, h - 1, 0xe8f4ff);
  rect(g, x + 1, y + 1, w - 3, h - 3, 0x34606e);
  centeredTiny(g, font, "XÁC NHẬN MUA", x + 20, y + 9, w - 40, 0xffffff);
  tiny(g, font, "Số lượng", x + 10, y + 43, 56, 0x1c6c91);
  fill(g, x + 64, y + 38, 50, 23, 0xffffff);
  g.strokeStyle = hex(0x2e9c7b);
  g.beginPath();
  g.roundRect(x + 64 + 0.5, y + 38 + 0.5, 49, 22, 3.5);
  g.stroke();
  centeredTiny(g, font, String(quantity), x + 68, y + 45, 42, 0x184e4f);
  softkey(g, font, 46, 136, 38, 31, "-", false, 0x2e9c7b);
  softkey(g, font, 156, 136, 38, 31, "+", false, 0x2e9c7b);
  fill(g, x + 11, y + 78, w - 22, 23, 0x235f60);
  tiny(g, font, "TổNG", x + 20, y + 85, 38, 0xbfe9e2);
  // `VqsvShopCurrencyRenderer.draw`: the amount then its currency cell, centred in 84x20.
  const text = String(total),
    icon = cell(shopCurrencyCell(currency)),
    iconW = icon?.naturalWidth ?? 0,
    iconH = icon?.naturalHeight ?? 0,
    textW = font.width(text),
    content = textW + 2 + iconW,
    dx = x + 70 + Math.max(0, Math.trunc((84 - content) / 2)),
    ty = y + 80 + Math.max(0, Math.trunc((20 - font.height) / 2));
  font.drawTagged(g, text, dx, ty, hex(0xf2c862));
  if (icon?.complete && icon.naturalWidth > 0)
    g.drawImage(icon, dx + textW + 2, y + 80 + Math.max(0, Math.trunc((20 - iconH) / 2)));
  softkey(g, font, 45, 200, 64, 20, "Xác nhận", true, 0x2e9c7b);
  softkey(g, font, 132, 200, 64, 20, "Hủy", false, 0x2e9c7b);
}

export function drawWorldShop(
  g: CanvasRenderingContext2D,
  panel: WorldPanel,
  layouts: WorldShopLayouts,
  art: WorldShopArt,
): void {
  if (panel.mode === "worldShop")
    drawShopMenu(
      g,
      art,
      layouts.shop,
      "Thương điếm",
      WORLD_SHOP_ROW_WIDGETS,
      WORLD_SHOP_LABELS,
      panel.selected,
    );
  else if (panel.mode === "worldShopRecover") drawRecoverConfirm(g, panel, art, layouts.msgRecover);
  else {
    drawSellList(g, panel, art, layouts.shopbuy);
    const row = panel.worldShopSellRow;
    if (panel.mode === "worldShopSellConfirm" && row)
      drawShopConfirmOverlay(
        g,
        art.font,
        art.cell,
        Math.max(1, Math.min(panel.worldShopSellQuantity, row.count)),
        row.unitPrice * Math.max(1, Math.min(panel.worldShopSellQuantity, row.count)),
        row.currency,
      );
  }
}

/** `renderSourceConvenienceShop` on `wharf2.ui`: five row slots over the scrolled labels. */
export function drawConvenienceShop(
  g: CanvasRenderingContext2D,
  panel: WorldPanel,
  art: WorldPanelArt,
  layout: SourceUiLayout,
): void {
  fillBand(g, layout, 2, 0xc6f0ff, 7);
  fillBand(g, layout, 3, 0xbee7f2, 102);
  fillBand(g, layout, 4, 0x6cb7bb, 8);
  drawWidgetCell(g, art, layout, 1);
  const labels = panel.convenienceLabels,
    first = panel.convenienceFirstRow;
  for (let slot = 0; slot < CONVENIENCE_ROW_WIDGETS.length; slot++) {
    const index = first + slot;
    if (index >= labels.length) break;
    const id = CONVENIENCE_ROW_WIDGETS[slot],
      widget = layout.widget(id);
    if (!widget) continue;
    const active = index === panel.selected;
    drawCellTopLeft(
      g,
      art,
      active ? (widget.altId ?? -1) : (widget.imageId ?? -1),
      widget.x,
      widget.y,
    );
    drawText(
      g,
      art,
      layout,
      id,
      labels[index],
      active ? selectedColor(widget) : widgetColor(widget, 0x1c6c92),
    );
  }
  drawTextWide(
    g,
    art,
    layout,
    10,
    "Tiện lợi điếm",
    -8,
    layout.w(10, 72),
    widgetColor(layout.widget(10), 0xd0010e),
  );
  drawSoftkey(g, art, layout, 12, "Tiến vào", 0xffffff);
  drawSoftkey(g, art, layout, 11, layout.text(11, "Quay lại"), 0xffffff);
}

/**
 * `renderSourceEastWharf`: the dock's destinations on `wharf1.ui` (Q0–Q3, three rows) or `wharf2.ui`
 * (Q4, five rows), its title, and the "Di chuyển nhanh" / "Quay lại" softkeys.
 */
export function drawWharfPanel(
  g: CanvasRenderingContext2D,
  panel: WorldPanel,
  art: WorldPanelArt,
  layout: SourceUiLayout,
): void {
  const dock = panel.wharf;
  if (!dock) return;
  const temple = panel.wharfLayoutName === "wharf2",
    titleWidget = temple ? 10 : 8,
    confirmWidget = temple ? 12 : 9,
    backWidget = temple ? 11 : 10;
  fillBand(g, layout, 2, 0xc6f0ff, 7);
  fillBand(g, layout, 3, 0xbee7f2, 102);
  fillBand(g, layout, 4, 0x6cb7bb, 8);
  drawWidgetCell(g, art, layout, 1);
  drawRows(g, art, layout, panel.wharfRowWidgets, dock.labels, panel.selected);
  drawTextWide(
    g,
    art,
    layout,
    titleWidget,
    dock.title,
    -8,
    layout.w(titleWidget, 72),
    widgetColor(layout.widget(titleWidget), 0xd0010e),
  );
  drawSoftkey(
    g,
    art,
    layout,
    confirmWidget,
    layout.text(confirmWidget, "Di chuyển nhanh"),
    0xffffff,
  );
  drawSoftkey(g, art, layout, backWidget, layout.text(backWidget, "Quay lại"), 0xffffff);
}

/** `renderSourcePetBank`: "Ngân hàng Sủng vật" on `shop.ui`. */
export function drawPetBankMenu(
  g: CanvasRenderingContext2D,
  panel: WorldPanel,
  art: WorldPanelArt,
  layout: SourceUiLayout,
): void {
  drawShopMenu(
    g,
    art,
    layout,
    "Ngân hàng Sủng vật",
    PET_BANK_ROW_WIDGETS,
    PET_BANK_LABELS,
    panel.selected,
  );
}
