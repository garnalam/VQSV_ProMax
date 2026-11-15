import { battleFrameX, fromUi, viewport } from "../../core/Viewport";
import type { BattleUiMode } from "./BattleUiState";

/**
 * How a fight's panel sits on the landscape APK's 320x240 battle screen, at full size: its shift
 * from the JAR's 240x320 screen and, for a panel a little taller than 240, the empty band (`cut`,
 * rows `y..y+h` of the JAR panel) taken out so it fits.
 */
export type LandPanel = { x: number; y: number; cut?: { y: number; h: number } };

/**
 * The layout-built boxes move as the APK's own `.ui` files move them (levelUp widget 4: 43,55 →
 * 82,15; msgwarm 8: 76,106 → 115,85; smsInfo 4: 43,55 → 81,10); the JavaSE panels are centred,
 * top to bottom. The ball list loses the gap above its buttons (255..261), the shop the gap under
 * its description (253..263); the pet dashboard is shortened instead (`LAND_PET_STATE`).
 */
const LAND_PANELS: Partial<Record<BattleUiMode, LandPanel>> = {
  CHOICE: { x: 40, y: -48 },
  CHOICE_SKILL: { x: 40, y: -53 },
  SKILL: { x: 40, y: -53 },
  LEVEL_UP: { x: 39, y: -40 },
  WARNING: { x: 39, y: -21 },
  SMS_INFO: { x: 38, y: -45 },
  TARGET: { x: 0, y: 0 },
  SHOP_BUY: { x: 40, y: -42, cut: { y: 253, h: 10 } },
  SHOP_CONFIRM: { x: 40, y: -42, cut: { y: 253, h: 10 } },
  PET_STATE: { x: 40, y: -35 },
};
const LAND_CATCH_LIST: LandPanel = { x: 40, y: -44, cut: { y: 255, h: 6 } };

type Rect = { x: number; y: number; w: number; h: number };
/**
 * The pet dashboard on the landscape battle screen: the panel ends under the roster (226 tall
 * instead of 249) and its two softkeys go to the screen's bottom corners, where the APK's
 * `petstate.ui` has them (widgets 64 and 63), 48x22 so "Xuất chiến" fits. JAR panel coordinates.
 */
export const LAND_PET_STATE: { height: number; action: Rect; back: Rect } = {
  height: 226,
  action: { x: 2 - 40, y: 214 + 35, w: 48, h: 22 },
  back: { x: 270 - 40, y: 214 + 35, w: 48, h: 22 },
};

/** What a fight's panel needs to be placed: its mode and whether the bag shows the ball list. */
export type BattlePanelView = { ui: { mode: BattleUiMode }; catchListOpen?: boolean };

/**
 * Where this panel is drawn on the landscape battle screen, or null when there is no landscape
 * screen (portrait). The command bar is laid out on the APK's `battle.ui` and has no single shift:
 * it is not listed.
 */
export function landPanel(view: BattlePanelView): LandPanel | null {
  if (!viewport.landscape) return null;
  if (view.ui.mode === "CHOICE" && view.catchListOpen) return LAND_CATCH_LIST;
  return LAND_PANELS[view.ui.mode] ?? null;
}

/** The pet dashboard's softkeys in a fight: the corner ones in landscape. */
export function landPetStateButtons(): { action: Rect; back: Rect } | null {
  return viewport.landscape ? LAND_PET_STATE : null;
}

/**
 * A press in the 240x320 UI box (what the input reports) on the open panel's JAR coordinates: the
 * panels drawn on the landscape battle screen are hit where they are painted.
 */
export function battlePanelPoint(
  view: BattlePanelView,
  x: number,
  y: number,
): { x: number; y: number } {
  const panel = landPanel(view);
  if (!panel) return { x, y };
  const point = fromUi(x + 0.5, y + 0.5),
    at = { x: Math.floor(point.x - battleFrameX() - panel.x), y: Math.floor(point.y - panel.y) };
  if (panel.cut && at.y >= panel.cut.y) at.y += panel.cut.h;
  return at;
}
