import {
  charmCostLine,
  charmEffectDetail,
  romanTier,
  type CharmDefinition,
  type RainbowCharmCatalog,
} from "../game/charm/RainbowCharms";
import { SHOP_UI, type WorldPanel } from "../game/world/WorldPanel";
import { decodeMojibake } from "./text/TextCodec";
import type { PanelFontRenderer } from "./PanelFontRenderer";
import type { SourceUiLayout, SourceUiWidget } from "./SourceUiLayout";
import {
  bagButton,
  bagMarquee,
  bagPill,
  bagText,
  drawRoundRect,
  fillRoundRect,
  hex,
  itemIcon,
  ready,
  shopPanelBase,
  shopScrollbar,
} from "./ModernShopKit";

/**
 * JavaSE `VqsvPanelRuntime.renderRainbowCharm` (Mode.RAINBOW_CHARM / RAINBOW_CHARM_CONFIRM) and the
 * shop-panel helpers it draws with (`drawShopPanelBase`, `drawBagPill`, `drawBagText`,
 * `drawBagMarquee`, `drawBagButton`, `drawModernPanelShopScrollbar`), plus the confirmation's
 * `VqsvBattleRenderer.drawSmsInfoOverlay`. Java2D shapes are reproduced pixel for pixel: a
 * `fillRoundRect` arc is a diameter, a `drawRoundRect` outline covers x..x+w.
 */
export type RainbowCharmArt = {
  font: PanelFontRenderer;
  catalog: RainbowCharmCatalog;
  /** The charm's unified item icon (`charm-icons.<runtimeId>`). */
  icon: (runtimeId: number) => HTMLImageElement | undefined;
  /** A sprite-257 cell. */
  cell: (index: number) => HTMLImageElement | undefined;
  smsInfo: SourceUiLayout;
};

const ACCENT = 0x2e9c7b,
  TABS = ["Trang bị", "Chế tác", "Cường hóa"] as const,
  SLOT_LABEL = { SURVIVAL: "Sinh tồn", TACTICAL: "Chiến thuật", EXPLORATION: "Thám hiểm" } as const;

export function drawRainbowCharmPanel(
  g: CanvasRenderingContext2D,
  panel: WorldPanel,
  art: RainbowCharmArt,
): void {
  const { font, catalog } = art,
    source = panel.charmSource,
    tick = panel.openedTicks;
  shopPanelBase(g, font, "BÙA HỘ TRẬN CẦU VỒNG", ACCENT);
  TABS.forEach((label, tab) => {
    const x = 22 + tab * 67,
      active = tab === panel.rainbowCharmTab;
    fillRoundRect(g, x, 67, 63, 17, 5, active ? "#f2c862" : "#245d67");
    bagText(g, font, label, x + 2, 71, 59, active ? 0x173f56 : 0xffffff);
  });
  bagPill(g, font, `Kim ${source.money()}`, 20, 87, 90, 15, 0x173f56, 0xf2c862);
  bagPill(g, font, `HH ${source.achievedBadges()}`, 114, 87, 50, 15, 0x173f56, 0xffffff);

  const rows = panel.rainbowCharmRows,
    first = panel.rainbowCharmFirstRow;
  for (let row = 0; row < SHOP_UI.visibleRows; row++) {
    const index = first + row,
      y = SHOP_UI.listY + row * SHOP_UI.rowStride,
      active = index < rows.length && index === panel.selected;
    fillRoundRect(
      g,
      SHOP_UI.listX,
      y,
      SHOP_UI.listW,
      SHOP_UI.rowH,
      5,
      active ? "#eaf7f4" : "#f7fcfb",
    );
    drawRoundRect(
      g,
      SHOP_UI.listX,
      y,
      SHOP_UI.listW - 1,
      SHOP_UI.rowH - 1,
      5,
      active ? "#f2c862" : "#75aaa9",
    );
    if (index >= rows.length) continue;
    const charm = rows[index],
      tier = source.tier(charm.runtimeId);
    itemIcon(g, art.icon(charm.runtimeId), SHOP_UI.listX + 7, y + 2, 15, 15);
    bagMarquee(
      g,
      font,
      charm.name,
      SHOP_UI.listX + 27,
      y + 5,
      105,
      active ? 0x173f56 : 0x1c6c91,
      tick,
    );
    const state =
      tier > 0 ? romanTier(tier) : charm.badgeUnlock > 0 ? `${charm.badgeUnlock} HH` : "Mở sẵn";
    bagPill(
      g,
      font,
      state,
      SHOP_UI.listX + 139,
      y + 2,
      48,
      15,
      active ? 0x2e9c7b : 0x245d67,
      0xffffff,
    );
  }
  shopScrollbar(g, rows.length, first);

  const charm: CharmDefinition | undefined = rows.length
    ? rows[Math.max(0, Math.min(rows.length - 1, panel.selected))]
    : undefined;
  fillRoundRect(
    g,
    SHOP_UI.detailX,
    SHOP_UI.detailY,
    SHOP_UI.detailW,
    SHOP_UI.detailH,
    6,
    "#173f56",
  );
  drawRoundRect(
    g,
    SHOP_UI.detailX,
    SHOP_UI.detailY,
    SHOP_UI.detailW - 1,
    SHOP_UI.detailH - 1,
    6,
    "#f2c862",
  );
  if (charm) {
    const tier = source.tier(charm.runtimeId),
      x = SHOP_UI.detailX + 7,
      w = SHOP_UI.detailW - 14,
      y = SHOP_UI.detailY;
    bagMarquee(g, font, charm.name, x, y + 4, 126, 0xf2c862, tick);
    bagPill(
      g,
      font,
      SLOT_LABEL[charm.slot],
      SHOP_UI.detailX + 141,
      y + 3,
      52,
      14,
      0x2e9c7b,
      0xffffff,
    );
    const status = `${source.activeId(charm.slot) === charm.runtimeId ? "Đang dùng" : "Chưa dùng"} | Cấp ${romanTier(Math.max(1, tier))}`;
    bagText(g, font, status, x, y + 18, w, 0xffffff);
    bagMarquee(g, font, charmEffectDetail(charm, Math.max(1, tier)), x, y + 27, w, 0xf2c862, tick);
    const cost =
      panel.rainbowCharmTab === 0
        ? "Giới hạn: 1 bùa mỗi nhóm"
        : charmCostLine(catalog, charm, tier);
    bagMarquee(g, font, cost, x, y + 36, w, 0xffffff, tick);
  }
  if (panel.rainbowCharmMessage)
    bagText(g, font, panel.rainbowCharmMessage, 22, 253, 196, 0xf2c862);
  bagButton(
    g,
    font,
    TABS[panel.rainbowCharmTab],
    SHOP_UI.actionX,
    SHOP_UI.actionY,
    SHOP_UI.actionW,
    SHOP_UI.actionH,
    true,
    ACCENT,
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
    ACCENT,
  );

  if (panel.mode === "rainbowCharmConfirm") {
    const pending = catalog.byRuntimeId(panel.rainbowCharmPendingId);
    drawSmsInfoOverlay(
      g,
      art,
      panel.rainbowCharmTab === 1 ? "Xác nhận chế tác" : "Xác nhận cường hóa",
      pending ? `${pending.name} - Enter để xác nhận` : "Bùa Hộ Trận",
    );
  }
}

// ------------------------------------------------------------------ smsInfo.ui

/** `VqsvBattleRenderer.widgetColor` for the fill colour (`jColor`), or the fallback. */
function fillColor(widget: SourceUiWidget, fallback: number): number {
  const value = widget.jColor ?? widget.j_color ?? 0;
  if (value >>> 24 === 0 && value < 0) return value & 0xffffff;
  return value !== 0 && value !== -16777216 && value !== -1 ? value & 0xffffff : fallback;
}
function widgetFill(
  g: CanvasRenderingContext2D,
  layout: SourceUiLayout,
  id: number,
  fallbackHeight: number,
  fallback: number,
): void {
  const widget = layout.widget(id);
  if (!widget) return;
  g.fillStyle = hex(fillColor(widget, fallback));
  g.fillRect(widget.x, widget.y, Math.max(1, widget.w), layout.bandHeight(id, fallbackHeight));
}
/** `UiFont.drawTagged` with a wrap width: a glyph that would cross `x + max - 10` starts a line. */
function wrapped(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  color: string,
): void {
  const softLimit = maxWidth - font.width("nhung1");
  let cx = x,
    cy = y;
  for (const ch of decodeMojibake(text)) {
    const next = cx + font.width(ch);
    if (next > x + maxWidth - 10 || (ch === " " && next > x + softLimit)) {
      cx = x;
      cy += font.height + 1;
      if (ch === " ") continue;
    }
    font.draw(g, ch, cx, cy, color);
    cx += font.width(ch);
  }
}
/** `drawCenteredTinyText`. */
function centeredTiny(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  text: string,
  x: number,
  y: number,
  width: number,
  color: string,
): void {
  const decoded = decodeMojibake(text),
    drawX = x + Math.max(0, Math.trunc((width - Math.min(width, font.width(decoded))) / 2));
  g.save();
  g.beginPath();
  g.rect(drawX, y - 1, width, 18);
  g.clip();
  font.drawTagged(g, decoded, drawX, y, color);
  g.restore();
}
/** `VqsvBattleRenderer.drawSmsInfoOverlay(title, prompt)`. */
export function drawSmsInfoOverlay(
  g: CanvasRenderingContext2D,
  art: RainbowCharmArt,
  title: string,
  prompt: string,
): void {
  const layout = art.smsInfo,
    { font } = art,
    text = "#1c6c91";
  widgetFill(g, layout, 3, 9, 0xc6f1ff);
  widgetFill(g, layout, 1, 159, 0xbde4ef);
  widgetFill(g, layout, 2, 11, 0x82d0fb);
  const frame = layout.widget(4),
    cell = frame ? (frame.altId ?? -1) : -1,
    image = cell >= 0 ? art.cell(cell) : undefined;
  if (frame && ready(image)) g.drawImage(image, frame.x, frame.y);
  const body = layout.widget(8);
  g.save();
  g.beginPath();
  g.rect(body?.x ?? 62, (body?.y ?? 101) - 1, body?.w ?? 118, (body?.h ?? 68) + 2);
  g.clip();
  wrapped(g, font, title, body?.x ?? 62, body?.y ?? 101, Math.max(1, body?.w ?? 118), text);
  g.restore();
  const promptWidget = layout.widget(5);
  centeredTiny(
    g,
    font,
    prompt,
    promptWidget?.x ?? 66,
    promptWidget?.y ?? 188,
    Math.max(1, promptWidget?.w ?? 100),
    text,
  );
  const yes = layout.widget(10),
    no = layout.widget(11);
  centeredTiny(
    g,
    font,
    "Xác nhận",
    yes?.x ?? 52,
    yes?.y ?? 240,
    Math.max(54, yes?.w ?? 24),
    "#ffffff",
  );
  centeredTiny(
    g,
    font,
    "Phản hồi",
    Math.max(130, (no?.x ?? 167) - 36),
    no?.y ?? 240,
    Math.max(58, no?.w ?? 24),
    "#ffffff",
  );
}
