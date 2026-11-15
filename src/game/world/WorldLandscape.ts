import { battleFrameX, fromUi, viewport } from "../../core/Viewport";
import { LAND_PET_STATE } from "../battle/BattleLandscape";
import { PET_STATE } from "../battle/BattleListLayout";
import type { WorldPanelMode } from "./WorldPanel";

/**
 * Landscape: how a world panel laid out on a source `.ui` sits on the APK's 320x240 screen, at full
 * size. The APK moves each of these panels' bodies by one shift (the same for every widget of its
 * `.ui`) and puts the two softkeys in the screen's bottom corners: (1,296) → (2,215) and
 * (197,296) → (275,215), i.e. (+1,-81) and (+78,-81). `top` is the game menu's banner, which only
 * moves (+2,-2).
 */
export type LandWorldPanel = { x: number; y: number; top?: { x: number; y: number } };

/** Per mode, the shift of its `.ui` (APK widget minus JAR widget). */
const LAND_WORLD_PANELS: Partial<Record<WorldPanelMode, LandWorldPanel>> = {
  gamemenu: { x: 33, y: -19, top: { x: 2, y: -2 } },
  gamesystem: { x: 36, y: -23 },
  help: { x: 40, y: -39 },
  settings: { x: 40, y: -38 },
  optionConfirm: { x: 40, y: -39 },
  save: { x: 34, y: -37 },
  task: { x: 41, y: -39 },
  taskOption: { x: 34, y: -46 },
  record: { x: 35, y: -34 },
  petmap: { x: 45, y: -35 },
  badge: { x: 38, y: -40 },
  worldShop: { x: 35, y: -34 },
  worldShopSell: { x: 35, y: -40 },
  worldShopSellConfirm: { x: 35, y: -40 },
  worldShopRecover: { x: 42, y: -81 },
  convenience: { x: 39, y: -26 },
  petBank: { x: 35, y: -34 },
  ride: { x: 45, y: -80 },
};
/** `wharf1.ui` (the east wharf) and `wharf2.ui` (the temple's). */
const LAND_WHARF: Record<"wharf1" | "wharf2", LandWorldPanel> = {
  wharf1: { x: 38, y: -46 },
  wharf2: { x: 39, y: -26 },
};

/** The JAR rows the softkeys use (296..319) start here; the game menu's banner ends at `TOP_END`. */
export const SOFTKEY_TOP = 290;
export const TOP_END = 34;
export const LEFT_KEY = { x: 1, y: -81 };
export const RIGHT_KEY = { x: 78, y: -81 };
/** The softkeys' source boxes (JAR) and where they land (APK), wide enough for their plates. */
export const LEFT_KEY_SOURCE = { x: 0, y: SOFTKEY_TOP, w: 64, h: 320 - SOFTKEY_TOP };
export const RIGHT_KEY_SOURCE = { x: 176, y: SOFTKEY_TOP, w: 64, h: 320 - SOFTKEY_TOP };

/** What placing a world panel needs to know of it. */
export type WorldPanelView = {
  visible: boolean;
  mode: WorldPanelMode;
  wharfLayoutName: string;
  petStage?: string;
};

/**
 * Landscape: the JavaSE cards (bag, portable shop, challenge, battle pass, Cầu Vồng charms) are one
 * rounded card, `region` of the 240x320 screen, a little taller than 240: it is scaled to fit the
 * 320x240 screen, centred, and the panel's dim (`dim`) is spread over the rest of the screen.
 */
export type LandWorldFit = {
  region: { x: number; y: number; w: number; h: number };
  scale: number;
  /** Where the JAR screen's (0, 0) lands on the 320x240 screen. */
  x: number;
  y: number;
  dim: string;
};
const FIT_REGION = { x: 8, y: 40, w: 226, h: 254 };
const SHOP_DIM = "rgba(0,18,28,0.518)",
  META_DIM = "rgba(3,18,28,.58)";
const FIT_DIMS: Partial<Record<WorldPanelMode, string>> = {
  bag: SHOP_DIM,
  portableShop: SHOP_DIM,
  portableShopBuy: SHOP_DIM,
  portableShopConfirm: SHOP_DIM,
  rainbowCharm: SHOP_DIM,
  rainbowCharmConfirm: SHOP_DIM,
  challenge: META_DIM,
  giftCode: META_DIM,
  battlePass: META_DIM,
  battlePassHelp: META_DIM,
};

/** The fitted card for this panel, or null (portrait, or a panel placed otherwise). */
export function landWorldFit(panel: WorldPanelView): LandWorldFit | null {
  if (!viewport.landscape || !panel.visible) return null;
  const dim = FIT_DIMS[panel.mode];
  if (!dim) return null;
  const region = FIT_REGION,
    scale = Math.min(1, 236 / region.h);
  return {
    region,
    scale,
    x: (320 - region.w * scale) / 2 - region.x * scale,
    y: (240 - region.h * scale) / 2 - region.y * scale,
    dim,
  };
}

/** The world pet dashboard's shift on the landscape screen: the battle's (`LAND_PANELS.PET_STATE`). */
export const LAND_WORLD_PET = { x: 40, y: -35 };
/**
 * Landscape: the pet dashboard (and `petsetting.ui` over it) is drawn at full size, shortened as
 * in a fight (`LAND_PET_STATE`). Its other pages (skills, items, release, quality, evolution) are
 * laid out on the whole 240x320 screen and stay in the UI box.
 */
export function landWorldPet(panel: WorldPanelView): boolean {
  return (
    viewport.landscape &&
    panel.visible &&
    panel.mode === "pet" &&
    (panel.petStage === "list" || panel.petStage === "setting")
  );
}

/** Where the open panel is drawn on the landscape screen, or null (portrait, or not laid out yet). */
export function landWorldPanel(panel: WorldPanelView): LandWorldPanel | null {
  if (!viewport.landscape || !panel.visible) return null;
  if (panel.mode === "wharf") return LAND_WHARF[panel.wharfLayoutName as "wharf1" | "wharf2"];
  return LAND_WORLD_PANELS[panel.mode] ?? null;
}

const inside = (x: number, y: number, r: { x: number; y: number; w: number; h: number }) =>
  x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

/**
 * A press in the 240x320 UI box (what the input reports) back on the open panel's JAR coordinates:
 * the softkeys in the corners first, then the game menu's banner, then the panel's body.
 */
export function worldPanelPoint(
  panel: WorldPanelView,
  x: number,
  y: number,
): { x: number; y: number } {
  const land = landWorldPanel(panel),
    fit = land ? null : landWorldFit(panel),
    pet = !land && !fit && landWorldPet(panel);
  if (!land && !fit && !pet) return { x, y };
  const point = fromUi(x + 0.5, y + 0.5),
    fx = point.x - battleFrameX(),
    fy = point.y;
  if (fit)
    return { x: Math.floor((fx - fit.x) / fit.scale), y: Math.floor((fy - fit.y) / fit.scale) };
  if (!land) {
    // The corner softkeys answer for the dashboard's own two buttons.
    const at = { x: Math.floor(fx - LAND_WORLD_PET.x), y: Math.floor(fy - LAND_WORLD_PET.y) },
      centre = (r: { x: number; y: number; w: number; h: number }) => ({
        x: r.x + (r.w >> 1),
        y: r.y + (r.h >> 1),
      });
    if (panel.petStage === "list") {
      if (inside(at.x, at.y, LAND_PET_STATE.action)) return centre(PET_STATE.action);
      if (inside(at.x, at.y, LAND_PET_STATE.back)) return centre(PET_STATE.back);
      // The short dashboard does not draw its softkeys where the JAR's are.
      if (inside(at.x, at.y, PET_STATE.action) || inside(at.x, at.y, PET_STATE.back))
        return { x: -1, y: -1 };
    }
    return at;
  }
  const back = (shift: { x: number; y: number }) => ({
    x: Math.floor(fx - shift.x),
    y: Math.floor(fy - shift.y),
  });
  for (const [source, shift] of [
    [LEFT_KEY_SOURCE, LEFT_KEY],
    [RIGHT_KEY_SOURCE, RIGHT_KEY],
  ] as const) {
    const at = back(shift);
    if (inside(at.x, at.y, source)) return at;
  }
  if (land.top) {
    const at = back(land.top);
    if (at.y < TOP_END) return at;
  }
  return back(land);
}
