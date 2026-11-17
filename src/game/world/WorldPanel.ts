import type { WharfDock } from "./NpcServices";
import { wharfRoute, type WharfRoute } from "./WharfTravel";
import type { TaskOptionView } from "../quest/TaskOption";
import { charmResultMessage as charmMessage } from "../charm/RainbowCharms";
import { RIDE_LABELS, type RideSelection } from "../ride/RideSystem";
import type { InputCommand } from "../../core/input/GameCommand";
import type { SourceUiLayout } from "../../rendering/SourceUiLayout";
import type { TaskRow, TaskTab } from "../quest/TaskBoard";
import { BAG_TABS, bagActionLabel, type BagRow, type BagTab } from "../inventory/Bag";
import type { BattleUiRow } from "../battle/BattleUiState";
import {
  contains,
  PET_STATE,
  petIndexAt,
  petStatePageAt,
  stepPetStatePage,
} from "../battle/BattleListLayout";
import { SKILL_SLOTS } from "../battle/engine/PetProgression";
import type { PendingSkillLearn } from "../../persistence/save/GameSave";
import { PET_ITEM_USED, PET_PROMPT } from "../pet/PetScreen";
import {
  CHOICE_THUMB_TRAVEL_HEIGHT,
  CHOICE_VISIBLE_ROWS,
  type ChoiceRow,
} from "../../rendering/SourceChoiceRenderer";
import { SKILL_VISIBLE_ROWS, type SkillScreenView } from "../../rendering/SkillScreenRenderer";
import type { SkillState } from "../pet/PetSkillPool";
import type { QualityUpgradeSession } from "../pet/QualityUpgradeSession";
import type { EvolutionSession } from "../pet/EvolutionSession";
import type { PortableShopOffer, PurchaseQuote } from "../shop/PortableShop";
import type { MetaSystemsDocument } from "../story/GameAssets";
import type { RegionalRematch, RematchStatus } from "../meta/RegionalChallenges";
import type { GiftCodeResult } from "../meta/GiftCodes";
import type { BattlePassCatalog, BattlePassState } from "../meta/BattlePass";
import type { CharmDefinition, CharmResult } from "../charm/RainbowCharms";
import {
  WORLD_SHOP_ROW_WIDGETS,
  type RecoveryOutcome,
  type SellRow,
  type WorldShopRoute,
} from "../shop/WorldShop";

/** One row of the skill screen as the host reads it for the selected pet. */
export type PetSkillRow = {
  id: number;
  name: string;
  /** `sourceSkillRowStatusAt` (the row) and `sourceSkillStatusAt` (the detail box). */
  rowStatus: string;
  status: string;
  state: SkillState;
  /** `sourceSkillMetaAt`: "Hệ … | Lực … | PP …". */
  meta: string;
  description: string;
};
export type PetSkillSheet = {
  petName: string;
  level: number;
  spriteId: number;
  /** The pet's nature: 7..9 draws it in its shiny palette (`sourceSkillPetNature`). */
  nature?: number;
  /** The pet's own shiny colour (`SavedPet.shinyColor`), when it has one. */
  shinyColor?: number;
  equipped: PetSkillRow[];
  pool: PetSkillRow[];
  poolUnlocked: number;
};

/** The pet dashboard's six quick cards and four pages (`battlePetStateDetailUi`). */
export const PET_VISIBLE_ROWS = 6;
export const PET_TABS = 4;
import { fromUi, viewport } from "../../core/Viewport";
import {
  AREA_MAP_CLOSE_RECT,
  AREA_MAP_LEGEND_H,
  type AreaMapDoor,
  type AreaMapView,
} from "./AreaMap";
import { choiceRowAt } from "./WorldHud";
import { COLLECTION_FAMILY_NAMES, COLLECTION_VARIANT_COUNT } from "../pet/PetCollection";
import { CauVongShopPanelState, type CauVongShopSource } from "./CauVongShop";
import { CauVongIncubatorPanelState, type CauVongIncubatorSource } from "./CauVongIncubatorPanel";
import { BondingTowerPanelState, type TowerPanelSource } from "./BondingTowerPanel";
import {
  clampIndexIntoVisible,
  dragScroll,
  pressScrollbar,
  type ScrollbarGeometry,
} from "../../ui/UiScrollbarMath";

/**
 * The two free-world softkey plates open `gamemenu.ui` (right) and `gamesystem.ui` (left). Java owns
 * both inside `VqsvPanelRuntime`, where an open panel consumes the tick instead of the world, so this
 * is the screen-level owner: state and navigation only, never a second loop, clock or renderer.
 */
export type WorldPanelMode =
  | "gamemenu"
  | "gamesystem"
  | "help"
  | "settings"
  | "optionConfirm"
  | "save"
  | "task"
  | "bag"
  | "pet"
  | "areaMap"
  | "notice"
  | "record"
  | "petmap"
  | "badge"
  | "taskOption"
  | "wharf"
  | "portableShop"
  | "portableShopBuy"
  | "portableShopConfirm"
  | "fashionShop"
  | "fashionBuyConfirm"
  | "fashionOpenConfirm"
  | "fashionReveal"
  | "fashionExchange"
  | "fashionExchangeConfirm"
  | "wardrobe"
  | "challenge"
  | "giftCode"
  | "battlePass"
  | "battlePassHelp"
  | "bondingTower"
  | "worldShop"
  | "worldShopSell"
  | "worldShopSellConfirm"
  | "worldShopRecover"
  | "convenience"
  | "petBank"
  | "ride"
  | "rainbowCharm"
  | "rainbowCharmConfirm"
  | "cauVongShop"
  | "cauVongIncubator";

/** `GAMEMENU` row 4, "Nhiệm vụ". */
export const MENU_ROW_TASK = 4;
/** `GAMEMENU` row 0, JavaSE `bodyShop.ui`. */
export const MENU_ROW_PORTABLE_SHOP = 0;
export const MENU_ROW_FASHION = 6;
export const MENU_ROW_CHALLENGE = 7;
export const MENU_ROW_BATTLE_PASS = 8;
export const MENU_ROW_BONDING_TOWER = 9;
/** `GAMEMENU` row 1, "Sủng vật" (`petstate.ui`). */
export const MENU_ROW_PET = 1;
/** `GAMEMENU` row 2, "Lưng bao" (`bag.ui`). */
export const MENU_ROW_BAG = 2;

/** `VqsvBagUiLayout`: the redesigned JavaSE backpack surface and its pointer rects. */
export const BAG_LAYOUT = {
  panel: { x: 9, y: 42, w: 222, h: 246 },
  header: { x: 12, y: 45, w: 216, h: 25 },
  tab: { x: 15, y: 74, w: 51, h: 21, gap: 2 },
  column: { x: 16, y: 98, w: 208, h: 15 },
  list: { x: 16, y: 115, w: 204, rowH: 20, stride: 22 },
  icon: { x: 7, y: 3, size: 14 },
  name: { x: 27, w: 115 },
  value: { x: 148, w: 49 },
  scroll: { x: 222, y: 115, w: 4, h: 20 + 4 * 22 },
  detail: { x: 16, y: 226, w: 208, h: 35 },
  action: { x: 18, y: 265, w: 78, h: 19 },
  back: { x: 144, y: 265, w: 78, h: 19 },
} as const;
export const BAG_VISIBLE_ROWS = 5;
const inRect = (x: number, y: number, r: { x: number; y: number; w: number; h: number }) =>
  x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
/** `VqsvBagUiLayout.tabAt`. */
export function bagTabAt(x: number, y: number): number {
  const t = BAG_LAYOUT.tab;
  if (y < t.y || y >= t.y + t.h) return -1;
  for (let tab = 0; tab < 4; tab++) {
    const left = t.x + tab * (t.w + t.gap);
    if (x >= left && x < left + t.w) return tab;
  }
  return -1;
}
/** `VqsvBagUiLayout.rowIndexAt`: the visible slot under the point, or -1. */
export function bagSlotAt(x: number, y: number): number {
  const l = BAG_LAYOUT.list;
  if (x < l.x || x >= l.x + l.w || y < l.y) return -1;
  const local = y - l.y,
    slot = Math.trunc(local / l.stride);
  return slot < BAG_VISIBLE_ROWS && local % l.stride < l.rowH ? slot : -1;
}
/** The message box `af()` opens (`msgwarm.ui`): the line and its "press 5" prompt. */
export type BagMessage = { text: string; prompt: string; kind?: "openbox" };
export type EggPreviewEntry = { speciesId: number; name: string; visualId: number };
/** `smsInfoConfirmHit` / `smsInfoCancelHit`: the `smsInfo.ui` buttons or the softkeys. */
export const smsInfoConfirmHit = (x: number, y: number) =>
  (x >= 44 && x <= 116 && y >= 228 && y <= 262) || panelConfirmHit(x, y);
export const smsInfoCancelHit = (x: number, y: number) =>
  (x >= 124 && x <= 224 && y >= 228 && y <= 262) || panelBackHit(x, y);
/** `VqsvShopUiLayout`: the shared shop list geometry. */
export const SHOP_UI = {
  listX: 20,
  listY: 99,
  listW: 196,
  rowH: 19,
  rowStride: 21,
  visibleRows: 5,
  detailX: 20,
  detailY: 205,
  detailW: 200,
  detailH: 46,
  actionX: 25,
  actionY: 264,
  actionW: 76,
  actionH: 19,
  backX: 140,
  backY: 264,
  backW: 75,
  backH: 19,
} as const;
const SHOP_SERVICE = { x: 20, y: 79, w: 200, rowH: 27, stride: 29, rows: 4 } as const;
const SHOP_CONFIRM = {
  left: { x: 46, y: 136, w: 38, h: 31 },
  right: { x: 156, y: 136, w: 38, h: 31 },
  yes: { x: 45, y: 200, w: 64, h: 20 },
  no: { x: 132, y: 200, w: 64, h: 20 },
} as const;
const PET_SETTING_WIDGETS = [5, 6, 7, 8, 10, 9] as const;
const PETMAP_TAB_WIDGETS = [6, 7, 8, 9, 10, 11, 12] as const;
const PETMAP_ROW_WIDGETS = [25, 29, 33, 37, 41] as const;
const BADGE_SLOT_WIDGETS = [17, 18, 19, 20, 21, 22, 23, 24] as const;
const SHOPBUY_ROW_WIDGETS = [12, 17, 22, 27, 32] as const;
const BADGE_GRID = { columns: 5, rows: 2, x: 50, y: 99, size: 30, dx: 28, dy: 33 } as const;
/** `VqsvShopUiLayout.itemIndexAt`. */
export function shopItemIndexAt(x: number, y: number, count: number, scroll: number): number {
  if (x < SHOP_UI.listX || x >= SHOP_UI.listX + SHOP_UI.listW || y < SHOP_UI.listY) return -1;
  const local = y - SHOP_UI.listY,
    row = Math.trunc(local / SHOP_UI.rowStride);
  if (row < 0 || row >= SHOP_UI.visibleRows || local % SHOP_UI.rowStride >= SHOP_UI.rowH) return -1;
  const index = scroll + row;
  return index >= 0 && index < count ? index : -1;
}
/** `VqsvShopUiLayout.actionHit` / `backHit`. */
export const shopActionHit = (x: number, y: number) =>
  inRect(x, y, { x: SHOP_UI.actionX, y: SHOP_UI.actionY, w: SHOP_UI.actionW, h: SHOP_UI.actionH });
export const shopBackHit = (x: number, y: number) =>
  inRect(x, y, { x: SHOP_UI.backX, y: SHOP_UI.backY, w: SHOP_UI.backW, h: SHOP_UI.backH });

/** `SOURCE_CONVENIENCE_LABELS` / `BICH_THUY_ENVOY_CONVENIENCE_LABELS`. */
export const CONVENIENCE_LABELS = [
  "Dẫn thưởng",
  "Tiến hóa",
  "Dị hóa",
  "Tài liệu",
  "Cách mở",
] as const;
export const ENVOY_CONVENIENCE_LABELS = [
  "Dẫn thưởng",
  "Tiến hóa",
  "Dị hóa",
  "Tài liệu",
  "Bùa Hộ Trận",
  "Mở rộng kho Pet",
  "Cách mở",
] as const;
/** `SOURCE_CONVENIENCE_ROW_WIDGETS` of `wharf2.ui`. */
export const CONVENIENCE_ROW_WIDGETS = [5, 6, 7, 8, 9] as const;
/** `SOURCE_PET_BANK_LABELS` / `SOURCE_PET_BANK_ROW_WIDGETS` of `shop.ui`. */
export const PET_BANK_LABELS = ["Gởi lại", "Lấy ra", "Phóng sinh"] as const;
export const PET_BANK_ROW_WIDGETS = [6, 7, 9] as const;
/** The pet list's service modes (`sourcePetBank*Mode`, `sourceConveniencePetstateRow`). */
export type ServicePetPurpose =
  "bankDeposit" | "bankWithdraw" | "bankRelease" | "evolve" | "mutate";
/** `openSourceWorldShopRecover`'s warning for a party already at full strength. */
const RECOVERY_NOT_NEEDED = "Toàn bộ trạng thái đã đầy, không cần khôi phục";
/** `VqsvText.Evolution.CONTINUE_PROMPT_5`. */
export const BAG_PROMPT = "Nhấn nút 5 để tiếp tục";
/** `bagSource.use`'s answer for an item that goes on a pet: `af()` default, state 17. */
export const BAG_PICK_PET = "\u0000pick-pet";
/** `useSpecialBagRow` case 5 (Sủng vật sách tranh) opens `petmap.ui`; case 6 opens `badge.ui`. */
export const BAG_OPEN_PETMAP = "\u0000open-petmap";
export const BAG_OPEN_BADGE = "\u0000open-badge";
/** `useEggAcceleratorItem` with more than one egg kind owned: the picker is open (`eggPickerOpen`). */
export const BAG_EGG_PICKER = "\u0000egg-picker";
/** The bag's equipment tab on a team charm: the charm manager (`rainbowCharmReturnToBag`). */
export const BAG_OPEN_CHARMS = "\u0000open-charms";
/** `useEggHatchAction` on a Cầu Vồng egg: the five-slot incubator on its first empty slot. */
export const BAG_OPEN_INCUBATOR = "\u0000open-incubator";
/** `openRainbowCharm` before main task 5. */
export const RAINBOW_CHARM_LOCKED = "Hoàn thành hướng dẫn trang bị Pet để mở Bùa Hộ Trận.";
/** Gamemenu row "Đồ giám". */
export const MENU_ROW_RECORD = 3;
/** `PETMAP_TAB_NAMES`: one Sách tranh tab per element. */
export const PETMAP_TAB_NAMES = ["Hỏa", "Mộc", "Thổ", "Thủy", "Điện", "Quỷ", "Phong"];
/** `BADGE_GRID_COLUMNS` x `BADGE_GRID_ROWS` of the extended badge grid; 8 source slots. */
export const BADGE_GRID_COLUMNS = 5;
export const BADGE_GRID_ROWS = 2;
export const BADGE_SOURCE_SLOTS = 8;

/** One `petmap.ui` row (`PetmapRow`). */
export type PetmapRow = {
  speciesId: number;
  name: string;
  spriteId: number;
  seen: boolean;
  owned: boolean;
};
/** One `badge.ui` entry, in display order (`badgeDisplayIds`). */
export type BadgeEntry = {
  /** Hoàng Kim Chương's rank (1 or 2) once it is held; other badges leave it unset. */
  goldenRank?: number;
  id: number;
  name: string;
  description: string;
  /** `badgeStatusText`. */
  status: string;
  achieved: boolean;
  /** A unified badge's icon (`badge-icons` pack key); source badges use UI cells 46+id / 54+id. */
  icon?: string;
};
/** The `record.ui` numbers. */
export type RecordStats = {
  owned: number;
  collected: number;
  rare: number;
  divine: number;
  badges: number;
  playTimeMillis: number;
};
/** `SOURCE_EAST_WHARF_ROW_WIDGETS` (wharf1.ui) and `SOURCE_TEMPLE_WHARF_ROW_WIDGETS` (wharf2.ui). */
export const EAST_WHARF_ROW_WIDGETS = [5, 6, 7] as const;
export const TEMPLE_WHARF_ROW_WIDGETS = [5, 6, 7, 8, 9] as const;
/** Q4, Thần Điện Mã Đầu: the one dock on `wharf2.ui`. */
const WHARF_TEMPLE = 4;
/** The web-only Safari row a town dock's captain offers. */
export const WHARF_SAFARI_LABEL = "Khu Safari";
/** `taskOption.ui`: the two answer rows (backgrounds 10/11, cursors 7/8, labels 17/18). */
export const TASK_OPTION_ROWS = [10, 11] as const;
/** `GAMEMENU` row 5, "Lưu dữ liệu". */
export const MENU_ROW_SAVE = 5;

/** `task.ui`: five list rows (`TASK_ROW_*` widgets) and the 72 px bar on widgets 39/40. */
export const TASK_VISIBLE_ROWS = 5;
export const TASK_ROW_BACKGROUNDS = [11, 16, 21, 26, 31];
export const TASK_ROW_NUMBERS = [12, 17, 22, 27, 32];
export const TASK_ROW_NAMES = [13, 18, 23, 28, 33];
export const TASK_ROW_STATUS = [14, 19, 24, 29, 34];
export const TASK_SCROLLBAR = { x: 179, y: 104, w: 4, h: 72, minThumbHeight: 8 };

/**
 * `game.h.K` over `msgtip.ui`: 0 asks, 1 writes the save, 2 shows the result until a press closes
 * the whole panel.
 */
export type SavePhase = 0 | 1 | 2;
export const SAVE_TEXT = {
  ask: "Có lưu dữ liệu không?",
  saving: "Đang lưu...",
  success: "Lưu thành công",
  failure: "Lưu thất bại",
} as const;

/** `VqsvPanelRuntime` row widgets: the six `gamemenu.ui` slots and the four `gamesystem.ui` rows. */
export const MENU_ROW_WIDGETS = [15, 5, 6, 7, 8, 9];
export const GAME_MENU_VISIBLE_ROWS = 6;
export const GAME_MENU_SCROLLBAR = { x: 157, y: 105, w: 4, h: 100, minThumbHeight: 18 };
export const SYSTEM_ROW_WIDGETS = [6, 7, 8, 9];

/**
 * `VqsvPanelRuntime.MENU_LABELS`. Java paints these code constants over the `gamemenu.ui` rows, so the
 * longer per-widget labels the binary file carries are not what the baseline shows.
 */
export const MENU_LABELS = [
  "Tùy thân cửa hàng",
  "Sủng vật",
  "Lưng bao",
  "Đồ giám",
  "Nhiệm vụ",
  "Lưu dữ liệu",
  "Thời trang",
  "Tái đấu & Giftcode",
  "Thẻ Fan Cứng VQSV",
  "Tháp Gắn Kết",
];
/** The row an admin account sees after the nine game rows (web only; the server checks the role). */
export const ADMIN_MENU_LABEL = "Admin Tool";
export const MENU_ROW_ADMIN = MENU_LABELS.length;
export const SYSTEM_LABELS = [
  "Tiếp tục trò chơi",
  "Trợ giúp chơi",
  "Thiết lập trò chơi",
  "Trở lại menu chính",
];
/** `MENU_TITLE_TOKENS`; the `#P60x` entries are not `#RRGGBB` colour tags, so Java draws them literally. */
export const MENU_TITLE_TOKENS = [
  "#P605",
  "#P606",
  "#P607",
  "#P608",
  "#P609",
  "#P610",
  "Thời trang",
  "Quà tặng",
  "Thẻ Fan Cứng",
  "Tháp Gắn Kết",
];

export type WorldPlate = "system" | "menu";

/** `clampSourceChoiceScroll`: the window keeps the cursor and stays inside the list. */
function clampChoiceScroll(scroll: number, selected: number, size: number): number {
  const max = Math.max(0, size - CHOICE_VISIBLE_ROWS);
  let at = Math.max(0, Math.min(max, scroll));
  if (selected < at) at = selected;
  else if (selected >= at + CHOICE_VISIBLE_ROWS) at = selected - (CHOICE_VISIBLE_ROWS - 1);
  return Math.max(0, Math.min(max, at));
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** `WorldUi.buttonAt` for the two plates; the shortcut strip and x2 checkbox are not ported yet. */
export function worldPlateAt(layout: SourceUiLayout, x: number, y: number): WorldPlate | undefined {
  if (widgetHit(layout, 7, x, y, 1, 303, 18, 17)) return "system";
  if (widgetHit(layout, 5, x, y, 222, 303, 16, 17) || (x >= 188 && y >= 288)) return "menu";
  return undefined;
}

/** `WorldUi.widgetHit`: the widget rect when the layout has it, otherwise the code fallback. */
function widgetHit(
  layout: SourceUiLayout,
  id: number,
  x: number,
  y: number,
  fallbackX: number,
  fallbackY: number,
  fallbackWidth: number,
  fallbackHeight: number,
): boolean {
  const widget = layout.widget(id),
    left = widget ? widget.x : fallbackX,
    top = widget ? widget.y : fallbackY,
    width = Math.max(fallbackWidth, widget ? widget.w : 0),
    height = Math.max(fallbackHeight, widget ? widget.h : 0);
  return x >= left && x <= left + width && y >= top && y <= top + height;
}

/** `VqsvPanelRuntime.leftSoftkeyHit` / `rightSoftkeyHit` while a panel owns the frame. */
export const panelConfirmHit = (x: number, y: number) => x <= 90 && y >= 280;
export const panelBackHit = (x: number, y: number) => x >= 145 && y >= 280;

/** `VqsvText.Evolution.CONTINUE_PROMPT_5`. */
const CONTINUE_PROMPT_5 = "Nhấn nút 5 để tiếp tục";
/** `RIDE_CLOSE_X/Y/SIZE`: the ride panel's close box. */
export const RIDE_CLOSE = { x: 6, y: 6, size: 22 } as const;
/** `rideCardX` / `rideCardY`: Liệt Hỏa on the first row, Cầu Vồng on the second. */
export const rideCardX = (index: number) => 12 + (index < 4 ? index : index - 4) * 44;
export const rideCardY = (index: number) => (index < 4 ? 187 : 252);
/** `rideCloseHit`. */
export const rideCloseHit = (x: number, y: number) =>
  x >= RIDE_CLOSE.x &&
  x <= RIDE_CLOSE.x + RIDE_CLOSE.size &&
  y >= RIDE_CLOSE.y &&
  y <= RIDE_CLOSE.y + RIDE_CLOSE.size;
/** `rideSlotAt`: the 38×40 card under a point, or -1. */
export function rideCardAt(x: number, y: number): number {
  for (let i = 0; i < RIDE_LABELS.length; i++) {
    const cx = rideCardX(i),
      cy = rideCardY(i);
    if (x >= cx && x < cx + 38 && y >= cy && y < cy + 40) return i;
  }
  return -1;
}

export class WorldPanel {
  safariSource: { open: () => void } = { open: () => {} };
  readonly bondingTower = new BondingTowerPanelState();
  towerSource: TowerPanelSource = {
    view: () => undefined,
    challenge: () => "Chưa thể khiêu chiến.",
    craft: () => "Chưa thể ghép trái tim.",
    nurture: () => "Chưa thể bồi dưỡng.",
    sweep: () => "Chưa thể quét tầng.",
  };
  systemSource = {
    volumeLevel: () => 0,
    setVolumeLevel: (_level: number) => {},
    speedX2: () => false,
    toggleSpeedX2: () => {},
    exitToTitle: () => {},
  };
  /** The Admin Tool row: shown only while `enabled` (the signed-in account is an admin). */
  adminSource = { enabled: () => false, open: () => {} };
  helpPage = 0;
  settingsLevel = 0;
  visible = false;
  mode: WorldPanelMode = "gamemenu";
  selected = 0;
  listScroll = 0;
  openedTicks = 0;
  /** Java's `s.key0` / `s.keyBack` latches: a pointer press is consumed by the panel's next tick. */
  private readonly pressed: InputCommand[] = [];
  /** Where the held scrollbar thumb was grabbed, or null. */
  private scrollGrab: number | null = null;
  /** The pet item/equipment choice list's bar while its thumb or track is held (ProMax). */
  private choiceScrollBar: ScrollbarGeometry | undefined;

  /** Java's `open(Scene)`: the cursor survives a close, so re-opening resumes where it left off. */
  open(): void {
    this.visible = true;
    this.mode = "gamemenu";
    this.pressed.length = 0;
    this.selected = clamp(this.selected, 0, this.menuRowCount - 1);
    this.listScroll = 0;
    this.keepSelectedVisible(this.menuRowCount);
    this.openedTicks = 0;
  }

  /** `openGameSystemFromWorld`: the left plate always starts on "Tiếp tục trò chơi". */
  openSystem(): void {
    this.visible = true;
    this.mode = "gamesystem";
    this.pressed.length = 0;
    this.selected = 0;
    this.openedTicks = 0;
  }

  close(): void {
    this.visible = false;
    this.releaseScrollbar();
    this.pressed.length = 0;
    this.savePhase = 0;
    this.saveMessage = "";
    this.saveRequested = false;
  }

  /** `savePhase` / `saveMessage` of the `msgtip.ui` save dialog. */
  savePhase: SavePhase = 0;
  saveMessage = "";
  /** Set by the phase-1 tick; the host writes the save and answers with `saveFinished`. */
  private saveRequested = false;
  private saveInFlight = false;

  /** The host's side of phase 1: true once per write the dialog asks for. */
  takeSaveRequest(): boolean {
    if (!this.saveRequested) return false;
    this.saveRequested = false;
    this.saveInFlight = true;
    return true;
  }
  /** `VqsvSaveRuntime.save`'s result: phase 2 shows it until a press closes the panel. */
  saveFinished(success: boolean): void {
    if (!this.saveInFlight) return;
    this.saveInFlight = false;
    if (!this.visible || this.mode !== "save" || this.savePhase !== 1) return;
    this.savePhase = 2;
    this.saveMessage = success ? SAVE_TEXT.success : SAVE_TEXT.failure;
  }

  /** The notice's text (`notice` mode), wrapped onto as many lines as it needs. */
  notice = "";
  /** The notice card's header. */
  noticeTitle = "Thông báo";

  // ------------------------------------------------------------------ bodyShop.ui / shopbuy.ui / msgyn.ui

  portableShopSource: {
    money: () => number;
    badges: () => number;
    /** `portableShopDescription(row)`: the counter's line under the menu. */
    description: (row: number) => string;
    claimDailyBadges: () => string;
    offers: (material: boolean) => PortableShopOffer[];
    quote: (offer: PortableShopOffer, quantity: number) => PurchaseQuote;
    purchase: (offer: PortableShopOffer, quantity: number) => "purchased" | "full" | "insufficient";
  } = {
    money: () => 0,
    badges: () => 0,
    description: () => "",
    claimDailyBadges: () => "Phần thưởng hàng ngày chưa sẵn sàng.",
    offers: () => [],
    quote: () => ({ outcome: "full", quantity: 0, maxQuantity: 0, total: 0, currentCount: 0 }),
    purchase: () => "full",
  };
  portableShopMaterial = false;
  portableShopQuantity = 1;
  portableShopMessage: BagMessage | null = null;
  get portableShopOffers(): PortableShopOffer[] {
    return this.portableShopSource.offers(this.portableShopMaterial);
  }
  get portableShopOffer(): PortableShopOffer | undefined {
    return this.portableShopOffers[this.selected];
  }
  get portableShopQuote(): PurchaseQuote | undefined {
    const offer = this.portableShopOffer;
    return offer ? this.portableShopSource.quote(offer, this.portableShopQuantity) : undefined;
  }
  openPortableShop(): void {
    this.visible = true;
    this.mode = "portableShop";
    this.selected = 0;
    this.listScroll = 0;
    this.openedTicks = 0;
    this.portableShopMessage = null;
  }
  /** Where Back leaves the `shopbuy` list (`portableShopReturnToSourceWorldShop` / `...Convenience`). */
  portableShopReturn: "portable" | "worldShop" | "convenience" = "portable";
  private openPortableShopBuy(
    material: boolean,
    returnTo: "portable" | "worldShop" | "convenience" = "portable",
  ): void {
    this.visible = true;
    this.mode = "portableShopBuy";
    this.portableShopReturn = returnTo;
    this.portableShopMaterial = material;
    this.selected = 0;
    this.listScroll = 0;
    this.openedTicks = 0;
  }
  private tickPortableShop(pressed: readonly InputCommand[]): void {
    if (pressed.includes("up")) this.select(clamp(this.selected - 1, 0, 3));
    else if (pressed.includes("down")) this.select(clamp(this.selected + 1, 0, 3));
    else if (pressed.includes("back")) {
      this.mode = "gamemenu";
      this.selected = MENU_ROW_PORTABLE_SHOP;
      this.listScroll = 0;
    } else if (pressed.includes("confirm")) {
      if (this.selected === 0) this.openPortableShopBuy(false);
      else if (this.selected === 3) this.openPortableShopBuy(true);
      else if (this.selected === 1)
        this.portableShopMessage = {
          text: this.portableShopSource.claimDailyBadges(),
          prompt: BAG_PROMPT,
        };
      else this.openFashionShop();
    }
  }
  private tickPortableShopBuy(pressed: readonly InputCommand[]): void {
    if (this.portableShopMessage) {
      if (pressed.includes("confirm") || pressed.includes("back")) this.portableShopMessage = null;
      return;
    }
    const rows = this.portableShopOffers;
    if (pressed.includes("up"))
      this.select(clamp(this.selected - 1, 0, Math.max(0, rows.length - 1)));
    else if (pressed.includes("down"))
      this.select(clamp(this.selected + 1, 0, Math.max(0, rows.length - 1)));
    else if (pressed.includes("back")) {
      if (this.portableShopReturn === "worldShop") this.returnToWorldShop(0);
      else if (this.portableShopReturn === "convenience") {
        this.mode = "convenience";
        this.selected = 3;
        this.openedTicks = 0;
      } else this.openPortableShop();
    } else if (pressed.includes("confirm")) {
      const quote = this.portableShopQuote;
      if (!this.portableShopOffer) return;
      if (!quote || quote.outcome === "full") {
        this.portableShopMessage = { text: "Số lượng vật phẩm đã đầy", prompt: BAG_PROMPT };
        return;
      }
      this.portableShopQuantity = quote.quantity;
      this.mode = "portableShopConfirm";
      this.openedTicks = 0;
    }
    this.keepSelectedVisible(rows.length);
  }
  private tickPortableShopConfirm(pressed: readonly InputCommand[]): void {
    const offer = this.portableShopOffer,
      quote = this.portableShopQuote;
    if (!offer || !quote || quote.outcome === "full") {
      this.mode = "portableShopBuy";
      return;
    }
    if (pressed.includes("left") || pressed.includes("right")) {
      const delta = pressed.includes("left") ? -1 : 1,
        max = Math.max(1, quote.maxQuantity);
      this.portableShopQuantity += delta;
      if (this.portableShopQuantity < 1) this.portableShopQuantity = max;
      if (this.portableShopQuantity > max) this.portableShopQuantity = 1;
    } else if (pressed.includes("back")) this.mode = "portableShopBuy";
    else if (pressed.includes("confirm")) {
      const result = this.portableShopSource.purchase(offer, this.portableShopQuantity);
      this.mode = "portableShopBuy";
      this.portableShopMessage = {
        text:
          result === "purchased"
            ? `Mua ${offer.name} thành công, số lượng ${this.portableShopQuantity}`
            : result === "insufficient"
              ? offer.currency === "money"
                ? "Kim tiền chưa đủ"
                : "Số lượng Huy hiệu chưa đủ"
              : "Số lượng vật phẩm đã đầy",
        prompt: BAG_PROMPT,
      };
    }
  }

  // ------------------------------------------------------------------ JavaSE fashion shop / wardrobe
  wardrobeSource: {
    records: () => MetaSystemsDocument["fashion"]["records"];
    catalog: () => MetaSystemsDocument["fashion"]["economy"] | undefined;
    selected: () => string;
    owned: (key: string) => boolean;
    money: () => number;
    bags: () => number;
    fragments: () => number;
    buy: (quantity: number) => "purchased" | "full" | "insufficient";
    openBag: () =>
      | { outcome: "no-bag" }
      | { outcome: "fragment-full" }
      | { outcome: "new" | "duplicate"; key: string; tier: string; fragmentDelta: number };
    exchange: (key: string) => "exchanged" | "owned" | "insufficient" | "unknown";
    equip: (key: string) => boolean;
  } = {
    records: () => [],
    catalog: () => undefined,
    selected: () => "",
    owned: () => false,
    money: () => 0,
    bags: () => 0,
    fragments: () => 0,
    buy: () => "full",
    openBag: () => ({ outcome: "no-bag" }),
    exchange: () => "unknown",
    equip: () => false,
  };
  wardrobeMessage: BagMessage | null = null;
  fashionPurchaseQuantity = 1;
  fashionReveal: {
    key: string;
    tier: string;
    title: string;
    detail: string;
    exchange: boolean;
  } | null = null;
  get wardrobeRows() {
    return this.wardrobeSource.records();
  }
  openWardrobe(): void {
    this.visible = true;
    this.mode = "wardrobe";
    const rows = this.wardrobeRows,
      at = rows.findIndex((row) => row.key === this.wardrobeSource.selected());
    this.selected = Math.max(0, at);
    this.listScroll = Math.max(0, this.selected - 2);
    this.wardrobeMessage = null;
    this.openedTicks = 0;
  }
  openFashionShop(): void {
    this.visible = true;
    this.mode = "fashionShop";
    this.selected = 0;
    this.listScroll = 0;
    this.wardrobeMessage = null;
    this.fashionReveal = null;
    this.openedTicks = 0;
  }
  get fashionEntries() {
    const catalog = this.wardrobeSource.catalog(),
      records = this.wardrobeRows;
    return (catalog?.entries ?? []).map((entry) => ({
      ...entry,
      tierInfo: catalog?.tiers.find((tier) => tier.code === entry.tier),
      record: records.find((record) => record.key === entry.key),
    }));
  }
  private tickFashionShop(pressed: readonly InputCommand[]): void {
    if (this.wardrobeMessage) {
      if (pressed.includes("confirm") || pressed.includes("back")) this.wardrobeMessage = null;
      return;
    }
    if (pressed.includes("up")) this.select(clamp(this.selected - 1, 0, 3));
    else if (pressed.includes("down")) this.select(clamp(this.selected + 1, 0, 3));
    else if (pressed.includes("back") || (pressed.includes("confirm") && this.selected === 3))
      this.openPortableShop();
    else if (pressed.includes("confirm") && this.selected === 0) {
      const capacity = this.wardrobeSource.catalog()?.bagCapacity ?? 99;
      if (this.wardrobeSource.bags() >= capacity)
        this.wardrobeMessage = { text: "Túi mù đã đầy", prompt: BAG_PROMPT };
      else {
        this.fashionPurchaseQuantity = 1;
        this.mode = "fashionBuyConfirm";
        this.openedTicks = 0;
      }
    } else if (pressed.includes("confirm") && this.selected === 1) {
      if (this.wardrobeSource.bags() <= 0)
        this.wardrobeMessage = { text: "Không có túi mù để mở", prompt: BAG_PROMPT };
      else {
        this.mode = "fashionOpenConfirm";
        this.openedTicks = 0;
      }
    } else if (pressed.includes("confirm") && this.selected === 2) {
      this.mode = "fashionExchange";
      this.selected = 0;
      this.listScroll = 0;
      this.openedTicks = 0;
    }
  }
  private tickFashionBuyConfirm(pressed: readonly InputCommand[]): void {
    const catalog = this.wardrobeSource.catalog();
    if (!catalog) return;
    const max = Math.max(1, catalog.bagCapacity - this.wardrobeSource.bags());
    if (pressed.includes("left") || pressed.includes("right")) {
      this.fashionPurchaseQuantity += pressed.includes("left") ? -1 : 1;
      if (this.fashionPurchaseQuantity < 1) this.fashionPurchaseQuantity = max;
      if (this.fashionPurchaseQuantity > max) this.fashionPurchaseQuantity = 1;
    } else if (pressed.includes("back")) {
      this.mode = "fashionShop";
      this.selected = 0;
    } else if (pressed.includes("confirm")) {
      const result = this.wardrobeSource.buy(this.fashionPurchaseQuantity);
      this.mode = "fashionShop";
      this.selected = 0;
      this.wardrobeMessage = {
        text:
          result === "purchased"
            ? `Đã mua ${this.fashionPurchaseQuantity} túi mù - ${this.fashionPurchaseQuantity * catalog.bagPrice} K`
            : result === "insufficient"
              ? "Kim tiền chưa đủ"
              : "Túi mù đã đầy",
        prompt: BAG_PROMPT,
      };
    }
    this.openedTicks = 0;
  }
  private tickFashionOpenConfirm(pressed: readonly InputCommand[]): void {
    if (pressed.includes("back")) {
      this.mode = "fashionShop";
      this.selected = 1;
    } else if (pressed.includes("confirm")) {
      const result = this.wardrobeSource.openBag();
      if (result.outcome === "no-bag" || result.outcome === "fragment-full") {
        this.mode = "fashionShop";
        this.selected = 1;
        this.wardrobeMessage = {
          text: result.outcome === "no-bag" ? "Không có túi mù để mở" : "Mảnh thời trang đã đầy",
          prompt: BAG_PROMPT,
        };
      } else {
        this.fashionReveal = {
          key: result.key,
          tier: result.tier,
          title: result.outcome === "new" ? "Trang phục mới!" : "Trang phục trùng",
          detail:
            result.outcome === "new"
              ? "Đã thêm vào tủ thời trang"
              : `Đổi thành ${result.fragmentDelta} mảnh thời trang`,
          exchange: false,
        };
        this.mode = "fashionReveal";
      }
      this.openedTicks = 0;
    }
  }
  private tickFashionExchange(pressed: readonly InputCommand[]): void {
    if (this.wardrobeMessage) {
      if (pressed.includes("confirm") || pressed.includes("back")) this.wardrobeMessage = null;
      return;
    }
    const size = this.fashionEntries.length;
    if (pressed.includes("up")) this.select(clamp(this.selected - 1, 0, Math.max(0, size - 1)));
    else if (pressed.includes("down"))
      this.select(clamp(this.selected + 1, 0, Math.max(0, size - 1)));
    else if (pressed.includes("back")) {
      this.mode = "fashionShop";
      this.selected = 2;
      this.listScroll = 0;
    } else if (pressed.includes("confirm")) {
      const entry = this.fashionEntries[this.selected];
      if (!entry) return;
      if (this.wardrobeSource.owned(entry.key))
        this.wardrobeMessage = { text: "Đã sở hữu trang phục này", prompt: BAG_PROMPT };
      else if (this.wardrobeSource.fragments() < (entry.tierInfo?.exchangeFragments ?? Infinity))
        this.wardrobeMessage = { text: "Không đủ mảnh thời trang", prompt: BAG_PROMPT };
      else this.mode = "fashionExchangeConfirm";
    }
    this.keepSelectedVisible(size);
    this.openedTicks = 0;
  }
  private tickFashionExchangeConfirm(pressed: readonly InputCommand[]): void {
    if (pressed.includes("back")) this.mode = "fashionExchange";
    else if (pressed.includes("confirm")) {
      const entry = this.fashionEntries[this.selected],
        result = entry ? this.wardrobeSource.exchange(entry.key) : "unknown";
      if (result === "exchanged" && entry) {
        this.fashionReveal = {
          key: entry.key,
          tier: entry.tier,
          title: "Đổi trang phục thành công",
          detail: `Đã dùng ${entry.tierInfo?.exchangeFragments ?? 0} mảnh thời trang`,
          exchange: true,
        };
        this.mode = "fashionReveal";
      } else {
        this.mode = "fashionExchange";
        this.wardrobeMessage = {
          text: result === "owned" ? "Đã sở hữu trang phục này" : "Không đủ mảnh thời trang",
          prompt: BAG_PROMPT,
        };
      }
      this.openedTicks = 0;
    }
  }
  private tickFashionReveal(pressed: readonly InputCommand[]): void {
    if (!pressed.includes("confirm") && !pressed.includes("back")) return;
    if (this.openedTicks < 24 && !this.fashionReveal?.exchange) {
      this.openedTicks = 24;
      return;
    }
    if (this.fashionReveal?.exchange) {
      this.mode = "fashionExchange";
      this.keepSelectedVisible(this.fashionEntries.length);
    } else {
      this.mode = "fashionShop";
      this.selected = 1;
      this.listScroll = 0;
    }
    this.openedTicks = 0;
  }
  private tickWardrobe(pressed: readonly InputCommand[]): void {
    if (this.wardrobeMessage) {
      if (pressed.includes("confirm") || pressed.includes("back")) this.wardrobeMessage = null;
      return;
    }
    const rows = this.wardrobeRows;
    if (pressed.includes("up"))
      this.select(clamp(this.selected - 1, 0, Math.max(0, rows.length - 1)));
    else if (pressed.includes("down"))
      this.select(clamp(this.selected + 1, 0, Math.max(0, rows.length - 1)));
    else if (pressed.includes("back")) {
      this.mode = "gamemenu";
      this.selected = MENU_ROW_FASHION;
      this.keepSelectedVisible(this.menuRowCount);
    } else if (pressed.includes("confirm")) {
      const row = rows[this.selected];
      if (!row) return;
      if (!this.wardrobeSource.owned(row.key))
        this.wardrobeMessage = { text: "Trang phục này chưa được sở hữu", prompt: BAG_PROMPT };
      else if (this.wardrobeSource.equip(row.key))
        this.wardrobeMessage = { text: "Đã thay trang phục", prompt: BAG_PROMPT };
    }
    this.keepSelectedVisible(rows.length);
  }

  // ------------------------------------------------------------------ JavaSE CHALLENGE / GIFTCODE
  challengeSource: {
    rematches: () => readonly RegionalRematch[];
    initialRegion: () => number;
    cycleRegion: (current: number, direction: number) => number;
    status: (region: number) => RematchStatus;
    start: (rematch: RegionalRematch) => boolean;
  } = {
    rematches: () => [],
    initialRegion: () => -1,
    cycleRegion: () => -1,
    status: () => ({
      available: false,
      usedCount: 0,
      remainingUses: 0,
      remainingMillis: 0,
      clockRollback: false,
    }),
    start: () => false,
  };
  giftCodeSource: { redeem: (code: string) => GiftCodeResult } = {
    redeem: (code) => ({ outcome: "invalid", code, message: "Giftcode chưa sẵn sàng." }),
  };
  challengeRegion = -1;
  giftCodeInput = "";
  giftCodeMessage = "";
  get challengeRematch(): RegionalRematch | undefined {
    return this.challengeSource.rematches().find((row) => row.region === this.challengeRegion);
  }
  get challengeStatus(): RematchStatus {
    return this.challengeSource.status(this.challengeRegion);
  }
  openChallenge(): void {
    this.visible = true;
    this.mode = "challenge";
    this.selected = 0;
    this.challengeRegion = this.challengeSource.initialRegion();
    this.giftCodeMessage = "";
    this.openedTicks = 0;
  }
  openGiftCode(): void {
    this.mode = "giftCode";
    this.giftCodeInput = "";
    this.giftCodeMessage = "";
    this.openedTicks = 0;
  }
  typeText(value: string): void {
    if (!this.visible || this.mode !== "giftCode") return;
    for (const character of value) {
      if (character === "\b") this.giftCodeInput = this.giftCodeInput.slice(0, -1);
      else {
        const upper = character.toUpperCase();
        if (/^[A-Z0-9_-]$/.test(upper) && this.giftCodeInput.length < 32)
          this.giftCodeInput += upper;
      }
    }
    this.giftCodeMessage = "";
  }
  private tickChallenge(pressed: readonly InputCommand[]): void {
    if (pressed.includes("left"))
      this.challengeRegion = this.challengeSource.cycleRegion(this.challengeRegion, -1);
    else if (pressed.includes("right"))
      this.challengeRegion = this.challengeSource.cycleRegion(this.challengeRegion, 1);
    else if (pressed.includes("up")) this.selected = 0;
    else if (pressed.includes("down")) this.selected = 1;
    else if (pressed.includes("back")) {
      this.mode = "gamemenu";
      this.selected = MENU_ROW_CHALLENGE;
      this.keepSelectedVisible(this.menuRowCount);
    } else if (pressed.includes("confirm")) {
      if (this.selected === 1) this.openGiftCode();
      else {
        const rematch = this.challengeRematch,
          status = this.challengeStatus;
        if (!rematch) this.giftCodeMessage = "Chưa mở khu vực tái đấu.";
        else if (status.clockRollback)
          this.giftCodeMessage = "Đồng hồ hệ thống chưa hợp lệ. Hãy thử lại sau.";
        else if (!status.available) this.giftCodeMessage = "Đã hết 3 lượt tái đấu hôm nay.";
        else if (this.challengeSource.start(rematch)) this.close();
        else this.giftCodeMessage = "Không thể bắt đầu trận tái đấu lúc này.";
      }
    }
  }
  private tickGiftCode(pressed: readonly InputCommand[]): void {
    if (pressed.includes("back")) {
      this.mode = "challenge";
      this.selected = 1;
      this.giftCodeMessage = "";
      this.openedTicks = 0;
    } else if (pressed.includes("confirm"))
      this.giftCodeMessage = this.giftCodeSource.redeem(this.giftCodeInput).message;
  }

  // ------------------------------------------------------------------ JavaSE BATTLE PASS
  battlePassSource: {
    catalog: () => BattlePassCatalog | undefined;
    state: () => BattlePassState | undefined;
    claim: (level: number, vip: boolean) => string;
    purchaseVip: () => string;
  } = {
    catalog: () => undefined,
    state: () => undefined,
    claim: () => "Thẻ Fan Cứng chưa sẵn sàng.",
    purchaseVip: () => "Thẻ Fan Cứng chưa sẵn sàng.",
  };
  battlePassLevel = 1;
  battlePassVipTrack = false;
  battlePassMessage = "";
  openBattlePass(): void {
    this.visible = true;
    this.mode = "battlePass";
    this.battlePassLevel = 1;
    this.battlePassVipTrack = false;
    this.battlePassMessage = "";
    this.openedTicks = 0;
  }
  openBattlePassHelp(): void {
    this.mode = "battlePassHelp";
    this.openedTicks = 0;
  }
  private tickBattlePass(pressed: readonly InputCommand[]): void {
    const catalog = this.battlePassSource.catalog();
    if (!catalog) {
      if (pressed.includes("back")) this.mode = "gamemenu";
      return;
    }
    if (pressed.includes("left")) this.battlePassLevel = Math.max(1, this.battlePassLevel - 1);
    else if (pressed.includes("right"))
      this.battlePassLevel = Math.min(catalog.maxLevel, this.battlePassLevel + 1);
    else if (pressed.includes("up") || pressed.includes("down"))
      this.battlePassVipTrack = !this.battlePassVipTrack;
    else if (pressed.includes("back")) {
      this.mode = "gamemenu";
      this.selected = MENU_ROW_BATTLE_PASS;
      this.keepSelectedVisible(this.menuRowCount);
    } else if (pressed.includes("confirm")) {
      const state = this.battlePassSource.state();
      this.battlePassMessage =
        this.battlePassVipTrack && !state?.vipUnlocked
          ? this.battlePassSource.purchaseVip()
          : this.battlePassSource.claim(this.battlePassLevel, this.battlePassVipTrack);
    }
  }

  // ------------------------------------------------------------------ campaign foundation services
  campaignSource: {
    expandBank: () => string;
  } = {
    expandBank: () => "Ngân hàng chưa sẵn sàng.",
  };
  campaignMessage = "";
  // ------------------------------------------------------------------ Tiện lợi điếm (Mode.SOURCE_CONVENIENCE_SHOP)

  /** What the convenience shop and the pet bank read and do beyond the pet list. */
  serviceSource: {
    /** `progression.evolutionNoticeArmed`: the evolve rows open once the tutorial has run. */
    evolutionArmed: () => boolean;
    /** `claimSourceConvenienceReward`: the `msgWarm` line. */
    claimReward: () => string;
  } = {
    evolutionArmed: () => false,
    claimReward: () => "",
  };
  /** `sourceConvenienceBankExpansionEnabled`: the Bích Thủy envoy adds two rows. */
  convenienceEnvoy = false;
  /** A `TextBox.msgWarm` line over the convenience shop or the bank menu, or null. */
  serviceMessage: BagMessage | null = null;

  /** `sourceConvenienceLabels`. */
  get convenienceLabels(): readonly string[] {
    return this.convenienceEnvoy ? ENVOY_CONVENIENCE_LABELS : CONVENIENCE_LABELS;
  }
  /** `visibleListStart` over the convenience rows (five slots). */
  get convenienceFirstRow(): number {
    return clamp(this.listScroll, 0, Math.max(0, this.convenienceLabels.length - 5));
  }

  /** `openSourceConvenienceFromWorld`: "Tiện lợi điếm" on its first row. */
  openConvenience(envoy = false): void {
    this.visible = true;
    this.pressed.length = 0;
    this.mode = "convenience";
    this.convenienceEnvoy = envoy;
    this.selected = 0;
    this.listScroll = 0;
    this.openedTicks = 0;
    this.serviceMessage = null;
    this.campaignMessage = "";
  }
  /**
   * `openSourceConveniencePetstate(1)` from a world counter (Bắc Hải 56): the evolve list; Back opens
   * the convenience shop on its evolve row, as Java's does.
   */
  openConvenienceEvolve(): void {
    this.pressed.length = 0;
    this.convenienceEnvoy = false;
    this.openServicePets("evolve");
  }
  /** `reopenSourceNguyenMocConvenienceAfterPetstate`: back on the evolve row it left from. */
  private reopenConvenience(row: number): void {
    this.visible = true;
    this.mode = "convenience";
    this.selected = clamp(row, 1, 2);
    this.listScroll = 0;
    this.keepSelectedVisible(this.convenienceLabels.length);
    this.openedTicks = 0;
  }

  /** `tickSourceConvenienceShop`. */
  private tickConvenience(pressed: readonly InputCommand[]): void {
    if (this.serviceMessage || this.campaignMessage) {
      if (pressed.includes("confirm") || pressed.includes("back")) {
        this.serviceMessage = null;
        this.campaignMessage = "";
      }
      return;
    }
    const labels = this.convenienceLabels,
      last = labels.length - 1;
    if (pressed.includes("up")) {
      this.select(clamp(this.selected - 1, 0, last));
      this.keepSelectedVisible(labels.length);
    } else if (pressed.includes("down")) {
      this.select(clamp(this.selected + 1, 0, last));
      this.keepSelectedVisible(labels.length);
    } else if (pressed.includes("back") || (pressed.includes("confirm") && this.selected === last))
      this.close();
    else if (pressed.includes("confirm")) {
      const say = (text: string) => (this.serviceMessage = { text, prompt: CONTINUE_PROMPT_5 });
      if (this.selected === 0) say(this.serviceSource.claimReward());
      else if (this.selected === 1 || this.selected === 2) {
        const envoyMutation = this.convenienceEnvoy && this.selected === 2;
        if (!this.serviceSource.evolutionArmed() && !envoyMutation)
          say("Công năng theo đạo học sau mở ra");
        else this.openServicePets(this.selected === 1 ? "evolve" : "mutate");
      } else if (this.selected === 3) this.openPortableShopBuy(true, "convenience");
      else if (this.convenienceEnvoy && this.selected === 4) {
        const blocked = this.openRainbowCharm("convenience");
        if (blocked) say(blocked);
      } else if (this.convenienceEnvoy && this.selected === 5)
        say(this.campaignSource.expandBank());
    }
  }

  // ------------------------------------------------------------------ Ngân hàng Sủng vật (Mode.SOURCE_PET_BANK)

  /** `openSourceVillagePetBankFromWorld`: "Ngân hàng Sủng vật" on its first row. */
  openPetBank(): void {
    this.visible = true;
    this.pressed.length = 0;
    this.mode = "petBank";
    this.selected = 0;
    this.openedTicks = 0;
    this.serviceMessage = null;
  }
  /** `tickSourcePetBank`: each row opens the pet list in its own mode. */
  private tickPetBankMenu(pressed: readonly InputCommand[]): void {
    if (pressed.includes("up")) this.select(clamp(this.selected - 1, 0, 2));
    else if (pressed.includes("down")) this.select(clamp(this.selected + 1, 0, 2));
    else if (pressed.includes("back")) this.close();
    else if (pressed.includes("confirm"))
      this.openServicePets(
        (["bankDeposit", "bankWithdraw", "bankRelease"] as const)[this.selected],
      );
  }
  /** `click` on `wharf2.ui` / `shop.ui`: a row selects and confirms, then the softkeys. */
  private clickServiceMenu(layout: SourceUiLayout, x: number, y: number): void {
    if (this.serviceMessage || this.campaignMessage) {
      this.pressed.push("confirm");
      return;
    }
    const convenience = this.mode === "convenience",
      widgets = convenience ? CONVENIENCE_ROW_WIDGETS : PET_BANK_ROW_WIDGETS,
      first = convenience ? this.convenienceFirstRow : 0,
      count = convenience ? this.convenienceLabels.length : PET_BANK_LABELS.length;
    for (let slot = 0; slot < widgets.length; slot++) {
      const row = layout.widget(widgets[slot]);
      if (
        row &&
        first + slot < count &&
        x >= row.x - 4 &&
        x <= row.x + Math.max(convenience ? 59 : 92, row.w) + 12 &&
        y >= row.y - 2 &&
        y <= row.y + 14
      ) {
        this.select(first + slot);
        this.pressed.push("confirm");
        return;
      }
    }
    if (panelConfirmHit(x, y)) this.pressed.push("confirm");
    else if (panelBackHit(x, y)) this.pressed.push("back");
  }

  /**
   * `openSourcePetBank*Petstate` / `openSourceConveniencePetstate`: `petstate.ui` over the party (or,
   * to take out or release, the bank) with the service's action on the softkey.
   */
  private openServicePets(purpose: ServicePetPurpose): void {
    this.visible = true;
    this.mode = "pet";
    this.pressed.length = 0;
    this.petPurpose = purpose;
    this.petItem = -1;
    this.petStage = "list";
    this.petMessage = null;
    const count = this.petCards.length;
    this.selected = this.petCursor >= 0 && this.petCursor < count ? this.petCursor : 0;
    this.listScroll = 0;
    this.keepPetVisible();
    this.openedTicks = 0;
  }
  /** The list's softkey (`battleMenuAction`): empty for the ordinary dashboard. */
  get petActionLabel(): string {
    switch (this.petPurpose) {
      case "bankDeposit":
        return "Gởi lại";
      case "bankWithdraw":
        return "Lấy ra";
      case "bankRelease":
        return "Phóng sinh";
      case "evolve":
        return "Tiến hóa";
      case "mutate":
        return "Dị hoá";
      default:
        return "";
    }
  }
  /** Whether the list shows the bank (`sourcePetBankListMode != 0`). */
  get petListIsBank(): boolean {
    return this.petPurpose === "bankWithdraw" || this.petPurpose === "bankRelease";
  }
  /** `tickWorldPetstate`'s Back in a service mode. */
  private leaveServicePets(): void {
    const purpose = this.petPurpose;
    this.petPurpose = "menu";
    if (purpose === "evolve" || purpose === "mutate")
      this.reopenConvenience(purpose === "evolve" ? 1 : 2);
    else this.openPetBank();
  }
  /** `tickWorldPetstate`'s 5 in a service mode. */
  private confirmServicePet(): void {
    const index = this.selected;
    switch (this.petPurpose) {
      case "bankDeposit": {
        // `confirmSourcePetBankDeposit`.
        const result = this.petSource.bankDeposit(index);
        if (result === "full") this.petSay("Ngân hàng đã đầy, không thể gởi lại");
        else if (result === "last-living") this.petSay("Ba lô phải lưu ít nhất 1 sủng vật");
        else if (result === "deposited") this.afterBankMove();
        return;
      }
      case "bankWithdraw": {
        // `confirmSourcePetBankWithdraw`.
        const result = this.petSource.bankWithdraw(index);
        if (result === "roster-full") this.petSay("Ba lô Sủng vật đã đủ");
        else if (result === "withdrawn") this.afterBankMove();
        return;
      }
      case "bankRelease":
        // `openSourcePetBankReleaseConfirm`.
        if (index < 0 || index >= this.petCards.length) return;
        if (this.petSource.bankReleaseProtected(index))
          this.petSay("Thần thú không thể phóng sinh");
        else this.petStage = "confirmRelease";
        return;
      default: {
        // `confirmSourceConveniencePetstate`: a pet with a branch of this kind opens evolve.ui.
        const kind = this.petPurpose === "evolve" ? "evolution" : "mutation",
          session = this.petSource.openEvolutionOfKind(index, kind);
        if (session) {
          this.petPurpose = "menu";
          this.petEvolution = session;
          this.petStage = "evolution";
        } else
          this.petSay(
            kind === "evolution"
              ? "Sủng vật này không thể tiến hóa"
              : "Sủng vật này không thể dị hoá",
          );
      }
    }
  }
  /** A pet moved: the list follows it, and an emptied list returns to the bank menu. */
  private afterBankMove(): void {
    const count = this.petCards.length;
    if (count === 0) {
      this.petPurpose = "menu";
      this.openPetBank();
      return;
    }
    this.selected = clamp(this.selected, 0, count - 1);
    this.keepPetVisible();
  }

  // ------------------------------------------------------------------ Thương điếm (Mode.SOURCE_WORLD_SHOP)

  /** What the town merchant reads and does; the host binds it to the world. */
  worldShopSource: {
    sellRows: () => SellRow[];
    sell: (row: SellRow, quantity: number) => boolean;
    /** `WorldPetRecoveryService.quote`: -1 when nothing needs recovering. */
    recoveryCost: () => number;
    recover: () => RecoveryOutcome;
    money: () => number;
    badges: () => number;
  } = {
    sellRows: () => [],
    sell: () => false,
    recoveryCost: () => -1,
    recover: () => "not-needed",
    money: () => 0,
    badges: () => 0,
  };
  /** `shopTable` / `shopBucket`: which stock "Mua sắm" lists. */
  worldShopRoute: WorldShopRoute = "item";
  /** The sell confirmation's item and quantity (`sourceSellItemId` / `sourceSellQuantity`). */
  worldShopSellItem = -1;
  worldShopSellQuantity = 1;
  /** `sourceRecoveryCost` while `msgRecover.ui` is up. */
  worldShopRecoveryCost = -1;
  /** A `TextBox.msgWarm` line over the shop, or null. */
  worldShopMessage: BagMessage | null = null;
  /** `sourceRecoverySavePhase`: after a recovery the save runs and Back returns to the shop. */
  private saveReturnsToWorldShop = false;

  // ------------------------------------------------------------------ Cầu Vồng shops (CauVongShopPanel)

  /** What the Cầu Vồng shop reads; the host binds it to the world's bag and purse. */
  cauVongShopSource: CauVongShopSource = {
    doc: () => undefined,
    purse: () => undefined,
    room: () => -1,
  };
  readonly cauVongShop = new CauVongShopPanelState();
  /** `openCauVongShopFromWorld(s, actor, category)`: 0 items, 1 materials, 2 badges, 3 mutation. */
  openCauVongShop(category: number): void {
    this.visible = true;
    this.pressed.length = 0;
    this.mode = "cauVongShop";
    this.openedTicks = 0;
    this.cauVongShop.open(category, this.cauVongShopSource.doc());
  }

  // ------------------------------------------------------------------ Cầu Vồng incubator

  /** What the five-slot incubator reads and writes; the host binds it to the world. */
  cauVongIncubatorSource: CauVongIncubatorSource = {
    state: () => undefined,
    eggs: () => [],
    owned: () => 0,
    materialCount: () => 0,
    admit: () => "MISSING_EGG",
    hatch: () => "EMPTY",
    discard: () => {},
  };
  readonly cauVongIncubator = new CauVongIncubatorPanelState();
  /** `openCauVongIncubatorFromWorld`. */
  openCauVongIncubator(): void {
    this.visible = true;
    this.pressed.length = 0;
    this.mode = "cauVongIncubator";
    this.openedTicks = 0;
    this.cauVongIncubator.open();
  }

  /** `openSourceWorldShopFromWorld`: "Thương điếm" with the merchant's stock. */
  openWorldShop(route: WorldShopRoute = "item"): void {
    this.visible = true;
    this.pressed.length = 0;
    this.mode = "worldShop";
    this.worldShopRoute = route;
    this.selected = 0;
    this.listScroll = 0;
    this.openedTicks = 0;
    this.worldShopMessage = null;
  }
  private returnToWorldShop(row: number): void {
    this.mode = "worldShop";
    this.selected = row;
    this.listScroll = 0;
    this.openedTicks = 0;
  }
  get worldShopSellRows(): SellRow[] {
    return this.worldShopSource.sellRows();
  }
  get worldShopSellRow(): SellRow | undefined {
    return this.worldShopSellRows.find((row) => row.itemId === this.worldShopSellItem);
  }

  private tickWorldShop(pressed: readonly InputCommand[]): void {
    if (this.worldShopMessage) {
      // The generic `s.text` latch.
      if (pressed.includes("confirm") || pressed.includes("back")) {
        this.worldShopMessage = null;
        if (this.saveReturnsToWorldShop) {
          // `sourceRecoverySavePhase` 1 -> 2: the notice closes and the save is written.
          this.mode = "save";
          this.savePhase = 1;
          this.saveMessage = SAVE_TEXT.saving;
          this.openedTicks = 0;
        }
      }
      return;
    }
    if (this.mode === "worldShop") {
      // `tickSourceWorldShop`.
      if (pressed.includes("up")) this.select(clamp(this.selected - 1, 0, 3));
      else if (pressed.includes("down")) this.select(clamp(this.selected + 1, 0, 3));
      else if (pressed.includes("back") || (pressed.includes("confirm") && this.selected === 3))
        this.close();
      else if (pressed.includes("confirm")) {
        if (this.selected === 0)
          this.openPortableShopBuy(this.worldShopRoute === "material", "worldShop");
        else if (this.selected === 1) {
          this.mode = "worldShopSell";
          this.selected = 0;
          this.listScroll = 0;
          this.openedTicks = 0;
        } else this.openWorldShopRecover();
      }
      return;
    }
    if (this.mode === "worldShopSell") {
      // `tickSourceWorldShopSell`.
      const rows = this.worldShopSellRows,
        size = rows.length;
      this.selected = clamp(this.selected, 0, Math.max(0, size - 1));
      if (pressed.includes("up")) {
        this.select(clamp(this.selected - 1, 0, Math.max(0, size - 1)));
        this.keepSelectedVisible(size);
      } else if (pressed.includes("down")) {
        this.select(clamp(this.selected + 1, 0, Math.max(0, size - 1)));
        this.keepSelectedVisible(size);
      } else if (pressed.includes("back")) this.returnToWorldShop(1);
      else if (pressed.includes("confirm") && size > 0) {
        this.worldShopSellItem = rows[this.selected].itemId;
        this.worldShopSellQuantity = 1;
        this.mode = "worldShopSellConfirm";
        this.openedTicks = 0;
      }
      return;
    }
    if (this.mode === "worldShopSellConfirm") {
      // `tickSourceWorldShopSellConfirm`: left/right wrap the quantity over 1..held.
      const row = this.worldShopSellRow;
      if (!row) {
        this.closeWorldShopSellConfirm();
        return;
      }
      if (pressed.includes("left")) {
        this.worldShopSellQuantity--;
        if (this.worldShopSellQuantity <= 0) this.worldShopSellQuantity = row.count;
      } else if (pressed.includes("right")) {
        this.worldShopSellQuantity++;
        if (this.worldShopSellQuantity > row.count) this.worldShopSellQuantity = 1;
      } else if (pressed.includes("back")) this.closeWorldShopSellConfirm();
      else if (pressed.includes("confirm")) {
        this.worldShopSource.sell(row, this.worldShopSellQuantity);
        this.closeWorldShopSellConfirm();
      }
      return;
    }
    // `tickSourceWorldShopRecoverConfirm`.
    if (pressed.includes("back")) this.returnToWorldShop(2);
    else if (pressed.includes("confirm")) {
      const outcome = this.worldShopSource.recover();
      this.returnToWorldShop(2);
      if (outcome === "insufficient")
        this.worldShopMessage = { text: "Kim tiền chưa đủ", prompt: CONTINUE_PROMPT_5 };
      else if (outcome === "not-needed")
        this.worldShopMessage = { text: RECOVERY_NOT_NEEDED, prompt: CONTINUE_PROMPT_5 };
      else {
        this.worldShopMessage = {
          text: "Ba lô sủng vật trạng thái toàn bộ khôi phục",
          prompt: CONTINUE_PROMPT_5,
        };
        this.saveReturnsToWorldShop = true;
      }
    }
  }
  /** `openSourceWorldShopRecover`: a full party gets the warning, otherwise `msgRecover.ui`. */
  private openWorldShopRecover(): void {
    const cost = this.worldShopSource.recoveryCost();
    if (cost < 0) {
      this.selected = 2;
      this.worldShopMessage = { text: RECOVERY_NOT_NEEDED, prompt: CONTINUE_PROMPT_5 };
      return;
    }
    this.worldShopRecoveryCost = cost;
    this.mode = "worldShopRecover";
    this.openedTicks = 0;
  }
  /** `closeSourceWorldShopSellConfirm`: back to the refreshed list. */
  private closeWorldShopSellConfirm(): void {
    this.mode = "worldShopSell";
    this.worldShopSellItem = -1;
    this.worldShopSellQuantity = 1;
    const size = this.worldShopSellRows.length;
    this.selected = clamp(this.selected, 0, Math.max(0, size - 1));
    this.keepSelectedVisible(size);
    this.openedTicks = 0;
  }
  /** `click` in the merchant's modes. */
  private clickWorldShop(layout: SourceUiLayout, x: number, y: number): void {
    if (this.worldShopMessage) {
      this.pressed.push("confirm");
      return;
    }
    if (this.mode === "worldShopSellConfirm") {
      if (x >= 46 && x < 84 && y >= 136 && y < 167) this.pressed.push("left");
      else if (x >= 156 && x < 194 && y >= 136 && y < 167) this.pressed.push("right");
      else if (x >= 45 && x < 109 && y >= 200 && y < 220) this.pressed.push("confirm");
      else if (x >= 132 && x < 196 && y >= 200 && y < 220) this.pressed.push("back");
      return;
    }
    if (this.mode === "worldShop") {
      // `widgetRowAt("shop.ui", SOURCE_WORLD_SHOP_ROW_WIDGETS, x, y, 92)`.
      for (let slot = 0; slot < WORLD_SHOP_ROW_WIDGETS.length; slot++) {
        const row = layout.widget(WORLD_SHOP_ROW_WIDGETS[slot]);
        if (
          row &&
          x >= row.x - 4 &&
          x <= row.x + Math.max(92, row.w) + 12 &&
          y >= row.y - 2 &&
          y <= row.y + 14
        ) {
          this.select(slot);
          this.pressed.push("confirm");
          return;
        }
      }
    }
    if (this.mode === "worldShopSell") {
      const rows = this.worldShopSellRows,
        first = clamp(this.listScroll, 0, Math.max(0, rows.length - 5));
      for (let slot = 0; slot < SHOPBUY_ROW_WIDGETS.length; slot++) {
        const row = layout.widget(SHOPBUY_ROW_WIDGETS[slot]),
          index = first + slot;
        if (
          row &&
          index < rows.length &&
          x >= row.x - 4 &&
          x <= row.x + Math.max(128, row.w) + 12 &&
          y >= row.y - 2 &&
          y <= row.y + Math.max(16, row.h)
        ) {
          this.select(index);
          this.pressed.push("confirm");
          return;
        }
      }
    }
    if (panelConfirmHit(x, y)) this.pressed.push("confirm");
    else if (panelBackHit(x, y)) this.pressed.push("back");
  }

  // ------------------------------------------------------------------ Bùa hộ trận (Mode.RAINBOW_CHARM)

  /** What the charm manager reads and does; the host binds it to the world's `RainbowCharmState`. */
  charmSource: {
    definitions: () => readonly CharmDefinition[];
    tier: (id: number) => number;
    owns: (id: number) => boolean;
    activeId: (slot: CharmDefinition["slot"]) => number;
    money: () => number;
    achievedBadges: () => number;
    /** `story.mainTaskProgress`: the manager opens from task 5 on. */
    mainTaskProgress: () => number;
    equip: (id: number) => CharmResult;
    craft: (id: number) => CharmResult;
    upgrade: (id: number) => CharmResult;
  } = {
    definitions: () => [],
    tier: () => 0,
    owns: () => false,
    activeId: () => -1,
    money: () => 0,
    achievedBadges: () => 0,
    mainTaskProgress: () => 0,
    equip: (id) => ({ outcome: "INVALID_CHARM", runtimeId: id, tierBefore: 0, tierAfter: 0 }),
    craft: (id) => ({ outcome: "INVALID_CHARM", runtimeId: id, tierBefore: 0, tierAfter: 0 }),
    upgrade: (id) => ({ outcome: "INVALID_CHARM", runtimeId: id, tierBefore: 0, tierAfter: 0 }),
  };
  /** `rainbowCharmTab`: 0 Trang bị, 1 Chế tác, 2 Cường hóa. */
  rainbowCharmTab = 0;
  rainbowCharmMessage = "";
  rainbowCharmPendingId = -1;
  /** Where Back leaves the manager: the bag's equipment tab, the envoy's services, or the map. */
  private rainbowCharmReturn: "bag" | "convenience" | "world" = "world";
  private rainbowCharmReturnBag = { selected: 0, scroll: 0 };

  /**
   * `openRainbowCharm`: before main task 5 the manager stays shut and says why (the text is
   * returned for the caller's `msgWarm` line); otherwise it opens on "Trang bị".
   */
  openRainbowCharm(from: "convenience" | "world" = "world"): string | null {
    if (this.charmSource.mainTaskProgress() < 5) return RAINBOW_CHARM_LOCKED;
    this.visible = true;
    this.pressed.length = 0;
    this.rainbowCharmMessage = "Chọn bùa để chế tác, cường hóa hoặc trang bị.";
    this.mode = "rainbowCharm";
    this.rainbowCharmReturn = from;
    this.rainbowCharmTab = 0;
    this.selected = 0;
    this.listScroll = 0;
    this.openedTicks = 0;
    return null;
  }
  /** The bag's equipment tab on a charm (`tickBag` bagTab 1): the manager on "Trang bị". */
  private openRainbowCharmFromBag(): void {
    this.rainbowCharmReturn = "bag";
    this.rainbowCharmReturnBag = { selected: this.selected, scroll: this.listScroll };
    this.mode = "rainbowCharm";
    this.rainbowCharmTab = 0;
    this.selected = 0;
    this.listScroll = 0;
    this.rainbowCharmMessage = "Quản lý bùa đội đang sở hữu.";
  }
  /** `rainbowCharmRows`: every charm to craft, owned ones to equip or upgrade. */
  get rainbowCharmRows(): readonly CharmDefinition[] {
    const source = this.charmSource;
    return source
      .definitions()
      .filter((row) => this.rainbowCharmTab === 1 || source.owns(row.runtimeId));
  }
  /** `visibleListStart`: the first of the five rows shown. */
  get rainbowCharmFirstRow(): number {
    return clamp(this.listScroll, 0, Math.max(0, this.rainbowCharmRows.length - 5));
  }
  private keepCharmVisible(size: number): void {
    if (this.selected < this.listScroll) this.listScroll = this.selected;
    else if (this.selected >= this.listScroll + 5) this.listScroll = this.selected - 4;
    this.listScroll = clamp(this.listScroll, 0, Math.max(0, size - 5));
  }

  /** `tickRainbowCharm`. */
  private tickRainbowCharm(pressed: readonly InputCommand[]): void {
    const rows = this.rainbowCharmRows;
    if (pressed.includes("left") || pressed.includes("right")) {
      this.rainbowCharmTab = (this.rainbowCharmTab + (pressed.includes("right") ? 1 : 2)) % 3;
      this.selected = 0;
      this.listScroll = 0;
      this.rainbowCharmMessage = "";
      return;
    }
    if (pressed.includes("up") || pressed.includes("down")) {
      this.selected = clamp(
        this.selected + (pressed.includes("up") ? -1 : 1),
        0,
        Math.max(0, rows.length - 1),
      );
      this.keepCharmVisible(rows.length);
      return;
    }
    if (pressed.includes("back")) {
      if (this.rainbowCharmReturn === "bag") {
        this.mode = "bag";
        this.bagTab = 1;
        this.selected = this.rainbowCharmReturnBag.selected;
        this.listScroll = this.rainbowCharmReturnBag.scroll;
      } else if (this.rainbowCharmReturn === "convenience") {
        // `openSourceConvenienceFromWorld` on the "Bùa hộ trận" row.
        this.mode = "convenience";
        this.selected = 4;
        this.campaignMessage = "";
      } else this.close();
      return;
    }
    if (!pressed.includes("confirm") || rows.length === 0) return;
    const charm = rows[clamp(this.selected, 0, rows.length - 1)];
    if (this.rainbowCharmTab === 0) {
      this.rainbowCharmMessage = charmMessage(this.charmSource.equip(charm.runtimeId));
      return;
    }
    if (this.rainbowCharmTab === 1 && this.charmSource.owns(charm.runtimeId)) {
      this.rainbowCharmMessage = "Bùa này đã có trong kho.";
      return;
    }
    if (this.rainbowCharmTab === 2 && this.charmSource.tier(charm.runtimeId) >= 5) {
      this.rainbowCharmMessage = "Bùa đã đạt cấp V.";
      return;
    }
    this.rainbowCharmPendingId = charm.runtimeId;
    this.mode = "rainbowCharmConfirm";
  }

  /** `tickRainbowCharmConfirm`: 5 crafts or upgrades the pending charm, Back cancels. */
  private tickRainbowCharmConfirm(pressed: readonly InputCommand[]): void {
    if (pressed.includes("back")) {
      this.mode = "rainbowCharm";
      this.rainbowCharmPendingId = -1;
      return;
    }
    if (!pressed.includes("confirm")) return;
    const id = this.rainbowCharmPendingId,
      outcome =
        this.rainbowCharmTab === 1 ? this.charmSource.craft(id) : this.charmSource.upgrade(id);
    this.rainbowCharmMessage = charmMessage(outcome);
    this.mode = "rainbowCharm";
    this.rainbowCharmPendingId = -1;
    const size = this.rainbowCharmRows.length;
    this.selected = clamp(this.selected, 0, Math.max(0, size - 1));
    this.keepCharmVisible(size);
  }

  /** `click` in the charm modes: tabs, a row, then the action and back buttons (or softkeys). */
  private clickRainbowCharm(x: number, y: number): void {
    if (this.mode === "rainbowCharmConfirm") {
      if (smsInfoConfirmHit(x, y)) this.pressed.push("confirm");
      if (smsInfoCancelHit(x, y)) this.pressed.push("back");
      return;
    }
    if (y >= 65 && y <= 87 && x >= 20 && x <= 224) {
      this.rainbowCharmTab = clamp(Math.trunc((x - 20) / 67), 0, 2);
      this.selected = 0;
      this.listScroll = 0;
      return;
    }
    const rows = this.rainbowCharmRows,
      target = shopItemIndexAt(x, y, rows.length, this.rainbowCharmFirstRow);
    if (target >= 0) {
      this.selected = target;
      return;
    }
    if (shopActionHit(x, y) || panelConfirmHit(x, y)) this.pressed.push("confirm");
    if (shopBackHit(x, y) || panelBackHit(x, y)) this.pressed.push("back");
  }

  // ------------------------------------------------------------------ ride.ui (game.h.ae)

  /** What `ride.ui` reads and does; the host binds it to the world's `RideProgression`. */
  rideSource: {
    active: () => number;
    unlocked: (ride: number) => boolean;
    usable: (ride: number) => boolean;
    select: (ride: number) => RideSelection;
  } = {
    active: () => -1,
    unlocked: () => false,
    usable: () => false,
    select: () => "locked",
  };
  /** `rideSelected`: the card under the cursor. */
  rideSelected = 0;
  /** `rideMessageMode`'s `msgwarm.ui` line, or null. */
  rideMessage: { text: string; prompt: string } | null = null;

  /** `openRideFromWorld` (key 9 / the ride shortcut while on foot): the cursor starts on the mount. */
  openRide(): void {
    this.visible = true;
    this.mode = "ride";
    this.pressed.length = 0;
    const active = this.rideSource.active();
    this.rideSelected = active >= 0 ? active : 0;
    this.rideMessage = null;
    this.openedTicks = 0;
  }

  /** `tickRide`: left/right walk the nine cards, up/down jump between the two rows. */
  private tickRide(pressed: readonly InputCommand[]): void {
    if (this.rideMessage) {
      // The generic `s.text` latch: 5 or Back closes the warning and returns to the cards.
      if (pressed.includes("confirm") || pressed.includes("back")) this.rideMessage = null;
      return;
    }
    const last = RIDE_LABELS.length - 1;
    if (pressed.includes("left")) this.rideSelected = clamp(this.rideSelected - 1, 0, last);
    else if (pressed.includes("right")) this.rideSelected = clamp(this.rideSelected + 1, 0, last);
    else if (pressed.includes("up") && this.rideSelected >= 4)
      this.rideSelected = Math.min(3, this.rideSelected - 4);
    else if (pressed.includes("down") && this.rideSelected < 4) this.rideSelected += 4;
    else if (pressed.includes("back")) this.close();
    else if (pressed.includes("confirm")) {
      const outcome = this.rideSource.select(this.rideSelected);
      if (outcome === "locked")
        this.rideMessage = { text: "Chưa có sủng vật cưỡi này", prompt: CONTINUE_PROMPT_5 };
      else if (outcome === "blocked")
        this.rideMessage = {
          text: "Nơi này không thể sử dụng sủng vật cưỡi",
          prompt: CONTINUE_PROMPT_5,
        };
      else if (outcome === "airborne")
        this.rideMessage = {
          text: "Hãy về lại mặt đất rồi mới đổi sủng vật cưỡi",
          prompt: CONTINUE_PROMPT_5,
        };
      else this.close();
    }
  }

  /** `click` in `Mode.RIDE`: the close box, a card (select and confirm), then the two softkeys. */
  private clickRide(x: number, y: number): void {
    if (this.rideMessage) {
      if (panelBackHit(x, y)) this.pressed.push("back");
      else this.pressed.push("confirm");
      return;
    }
    if (rideCloseHit(x, y)) {
      this.pressed.push("back");
      return;
    }
    const card = rideCardAt(x, y);
    if (card >= 0) {
      this.rideSelected = card;
      this.pressed.push("confirm");
    } else if (panelConfirmHit(x, y)) this.pressed.push("confirm");
    else if (panelBackHit(x, y)) this.pressed.push("back");
  }

  // ------------------------------------------------------------------ task.ui (game.h.S)

  /**
   * The session's task rows for a tab (`taskRowsForRender`) and the main task cursor
   * (`mainTaskCursor`). The host supplies them; the panel only keeps the cursor.
   */
  taskSource: {
    rows: (tab: TaskTab) => TaskRow[];
    mainCursor: () => number;
    /** Opens the map for the task list; false when this area has none (the host says so). */
    openMap: () => boolean;
  } = {
    rows: () => [],
    mainCursor: () => 0,
    openMap: () => false,
  };
  taskTab: TaskTab = 0;
  /** `taskReturnToWorld`: opened from the world.ui shortcut, so Back closes instead of returning. */
  taskReturnToWorld = false;
  get taskRows(): TaskRow[] {
    return this.taskSource.rows(this.taskTab);
  }

  /** Gamemenu row 4 (`confirm` selected=4) and the world.ui shortcut (`openTaskFromWorld`). */
  openTasks(fromWorld = false): void {
    this.visible = true;
    this.mode = "task";
    this.pressed.length = 0;
    this.taskReturnToWorld = fromWorld;
    this.taskTab = 0;
    this.listScroll = 0;
    this.selected = this.taskSource.mainCursor();
    this.keepSelectedVisible(this.taskRows.length);
    this.openedTicks = 0;
  }

  // ------------------------------------------------------------------ bag.ui (game.k ab/af)

  /**
   * The bag's rows per tab and what confirming one does; the host supplies both. `use` returns the
   * message `af()` shows, or null when the source moves to a screen the web has not ported (the
   * pet picker of a healing item, the pet book, the badges...), in which case nothing happens.
   */
  bagSource: {
    rows: (tab: BagTab) => BagRow[];
    use: (tab: BagTab, row: BagRow) => string | null;
    /** `progression.egg.active`: an egg row's button reads "Ap trung" rather than "Mo ra". */
    eggActive: () => boolean;
    /** `applyEggAccelerator` for the egg the picker chose: the `msgWarm` line. */
    accelerateEgg: (itemId: number) => string | null;
    /** `EggPreviewCatalog`: the egg's name and the species it can hatch. */
    eggPreview: (itemId: number) => { name: string; entries: EggPreviewEntry[] } | null;
  } = {
    rows: () => [],
    use: () => null,
    eggActive: () => false,
    accelerateEgg: () => null,
    eggPreview: () => null,
  };
  /** `eggPickerOpen`: the `ChoiceBox.optionUi` over the bag listing the owned egg kinds. */
  eggPicker: { ids: number[]; labels: string[]; index: number; start: number } | null = null;
  /** `eggPreviewOpen` / `eggPreviewItemId` / `eggPreviewScroll`. */
  eggPreview: { itemId: number; scroll: number } | null = null;
  /** `pendingBagOpenBoxMessage`: the `openbox.ui` line that follows "Ấp trứng thành công". */
  bagOpenBox: string | null = null;
  bagTab: BagTab = 0;
  /** `f == 1`: a `msgwarm.ui` line waits for 5 (confirm) before the bag takes keys again. */
  bagMessage: BagMessage | null = null;

  get bagRows(): BagRow[] {
    return this.bagSource.rows(this.bagTab);
  }
  get bagSelectedRow(): BagRow | undefined {
    return this.bagRows[this.selected];
  }
  /** Widget 7's label for the selected row, or null when the source hides the softkey. */
  get bagAction(): string | null {
    return bagActionLabel(this.bagTab, this.bagSelectedRow, this.bagSource.eggActive());
  }

  /** `ab()`: the bag opens on "Tiêu hao" with the cursor on its first row. */
  openBag(): void {
    this.visible = true;
    this.mode = "bag";
    this.pressed.length = 0;
    this.bagMessage = null;
    this.bagOpenBox = null;
    this.eggPicker = null;
    this.eggPreview = null;
    this.selectBagTab(0);
  }
  /** `returnToBagFromState17Back`: back on "Tiêu hao" with the cursor kept on the item. */
  returnToBag(item: number): void {
    this.visible = true;
    this.mode = "bag";
    this.pressed.length = 0;
    this.bagMessage = null;
    this.bagOpenBox = null;
    this.eggPicker = null;
    this.eggPreview = null;
    this.bagTab = 0;
    this.openedTicks = 0;
    const rows = this.bagRows,
      at = rows.findIndex((row) => row.id === item);
    this.selected = at >= 0 ? at : clamp(this.selected, 0, Math.max(0, rows.length - 1));
    this.keepSelectedVisible(rows.length);
  }

  /** `ChoiceBox.move` with its two-row viewport. */
  private moveEggPicker(delta: number): void {
    const picker = this.eggPicker;
    if (!picker) return;
    picker.index = clamp(picker.index + delta, 0, Math.max(0, picker.ids.length - 1));
    if (picker.index < picker.start) picker.start = picker.index;
    else if (picker.index >= picker.start + 2) picker.start = picker.index - 1;
    picker.start = clamp(picker.start, 0, Math.max(0, picker.ids.length - 2));
  }
  /** `bq()`: a tab is shown from its top. */
  private selectBagTab(tab: BagTab): void {
    this.bagTab = tab;
    this.selected = 0;
    this.listScroll = 0;
    this.openedTicks = 0;
  }

  /** `af()`. */
  private tickBag(pressed: readonly InputCommand[]): void {
    if (this.eggPreview) {
      // `eggPreviewOpen`: 5 / Back close it, up/left and down/right scroll one row.
      const entries = this.bagSource.eggPreview(this.eggPreview.itemId)?.entries.length ?? 0;
      if (pressed.includes("back") || pressed.includes("confirm")) this.eggPreview = null;
      else if (pressed.includes("up") || pressed.includes("left"))
        this.eggPreview.scroll = Math.max(0, this.eggPreview.scroll - 1);
      else if (pressed.includes("down") || pressed.includes("right"))
        this.eggPreview.scroll = Math.min(Math.max(0, entries - 5), this.eggPreview.scroll + 1);
      return;
    }
    if (this.eggPicker) {
      // `tickEggPicker`.
      const picker = this.eggPicker;
      if (pressed.includes("up")) this.moveEggPicker(-1);
      else if (pressed.includes("down")) this.moveEggPicker(1);
      else if (pressed.includes("back")) this.eggPicker = null;
      else if (pressed.includes("confirm")) {
        this.eggPicker = null;
        const text = this.bagSource.accelerateEgg(picker.ids[picker.index]);
        if (text !== null) this.bagMessage = { text, prompt: BAG_PROMPT };
        this.clampBagCursor();
      }
      return;
    }
    if (this.bagMessage) {
      // f == 1: 5 closes the line and the lists are read again (`br()` after `f = 3`); mode 18
      // ("Ấp trứng thành công") hands over to the `openbox.ui` line naming the pet (mode 19).
      if (pressed.includes("confirm")) {
        if (this.bagOpenBox !== null && this.bagMessage.kind !== "openbox") {
          this.bagMessage = { text: this.bagOpenBox, prompt: BAG_PROMPT, kind: "openbox" };
          this.bagOpenBox = null;
          this.openedTicks = 0;
          return;
        }
        this.bagMessage = null;
        this.clampBagCursor();
      }
      return;
    }
    const rows = this.bagRows;
    if (pressed.includes("left")) {
      // JavaSE `tickBag`: the tabs wrap around.
      this.selectBagTab(((this.bagTab + BAG_TABS - 1) % BAG_TABS) as BagTab);
    } else if (pressed.includes("right")) {
      this.selectBagTab(((this.bagTab + 1) % BAG_TABS) as BagTab);
    } else if (pressed.includes("up")) {
      if (rows.length > 0) this.select(clamp(this.selected - 1, 0, rows.length - 1));
      this.keepSelectedVisible(rows.length);
    } else if (pressed.includes("down")) {
      if (rows.length > 0) this.select(clamp(this.selected + 1, 0, rows.length - 1));
      this.keepSelectedVisible(rows.length);
    } else if (pressed.includes("confirm")) {
      const row = rows[this.selected];
      if (!row || this.bagAction === null) return;
      const text = this.bagSource.use(this.bagTab, row);
      if (text === BAG_PICK_PET) this.openPets(row.id);
      else if (text === BAG_OPEN_PETMAP)
        this.openPetmap({ selected: this.selected, scroll: this.listScroll });
      else if (text === BAG_OPEN_BADGE)
        this.openBadges({ selected: this.selected, scroll: this.listScroll });
      else if (text === BAG_EGG_PICKER) this.moveEggPicker(0);
      else if (text === BAG_OPEN_CHARMS) this.openRainbowCharmFromBag();
      else if (text === BAG_OPEN_INCUBATOR) {
        this.openCauVongIncubator();
        this.cauVongIncubator.selectEmpty(this.cauVongIncubatorSource.state());
      } else if (text !== null) this.bagMessage = { text, prompt: BAG_PROMPT };
    } else if (pressed.includes("back")) {
      // `o.a(6)` with `b = 2`: back to the game menu on "Lưng bao".
      this.mode = "gamemenu";
      this.selected = MENU_ROW_BAG;
      this.listScroll = 0;
      this.keepSelectedVisible(this.menuRowCount);
      this.openedTicks = 0;
    }
  }

  /** After an item is used up the cursor stays on the list (`af()` case 13/14 tail). */
  private clampBagCursor(): void {
    const size = this.bagRows.length;
    this.selected = clamp(this.selected, 0, Math.max(0, size - 1));
    this.keepSelectedVisible(size);
  }

  /** The bag's own rects for a click: a tab plate of the shown page, or a row slot. */
  private bagHit(x: number, y: number): { tab?: BagTab; slot?: number } {
    const tab = bagTabAt(x, y);
    if (tab >= 0) return { tab: tab as BagTab };
    const slot = bagSlotAt(x, y);
    return slot >= 0 ? { slot } : {};
  }

  // ------------------------------------------------------------------ JavaSE pet screen

  /**
   * The party as the dashboard draws it and what the screen's actions do; the host supplies both.
   * Each action returns the `msgWarm` line to show, or null when it simply went through.
   */
  petSource: {
    cards: () => BattleUiRow[];
    /** `sourcePetSettingActionLabel` for pet `index`: 7 rows, 8 when it can evolve. */
    settingRows: (index: number) => string[];
    lead: (index: number) => string | null;
    prepareRelease: (index: number) => string | null;
    release: (index: number) => string | null;
    useItem: (index: number, item: number) => string | null;
    /** `sourceItemChoiceRows`: bag consumables that are not balls, by id. */
    itemChoiceRows: () => ChoiceRow[];
    /** `sourceEquipmentChoiceRows` with pet `index`'s status column. */
    equipChoiceRows: (index: number) => ChoiceRow[];
    /** The equipment pet `index` carries, or -1. */
    heldEquipment: (index: number) => number;
    /** `selectEquipment`: the `msgWarm` line, or null when nothing changed. */
    equip: (index: number, equipmentId: number) => string | null;
    /** What `skill.ui` shows for pet `index`. */
    skillSheet: (index: number) => PetSkillSheet | null;
    /** `sourceCanPay(1, 1)`: one badge for a relearn. */
    canPayBadge: () => boolean;
    /** Learn/relearn `skillId`; replace equipped slot when supplied. */
    learnSkill: (
      index: number,
      skillId: number,
      replaceSlot?: number,
      payBadge?: boolean,
    ) => string | null;
    /** Remove one persisted post-battle decision after learning, replacing or declining it. */
    resolvePendingSkill: (petSlot: number, skillId: number) => void;
    evolutionSkills: (index: number, previousSpecies: number) => number[];
    /** `openQualityUpgradeFromPetSetting` for pet `index`. */
    openQuality: (index: number) => QualityUpgradeSession | null;
    openEvolution: (index: number) => EvolutionSession | null;
    /** `noticeForPet(index, kind)`: evolve.ui for a branch of that kind, or null when the pet has none. */
    openEvolutionOfKind: (index: number, kind: "evolution" | "mutation") => EvolutionSession | null;
    /** The bank's pets as the dashboard cards them. */
    bankCards: () => BattleUiRow[];
    bankDeposit: (index: number) => "deposited" | "invalid" | "full" | "last-living";
    bankWithdraw: (index: number) => "withdrawn" | "invalid" | "roster-full";
    bankReleaseProtected: (index: number) => boolean;
    /** False when the pet turned out protected. */
    bankRelease: (index: number) => boolean;
    toggleCompanion: (index: number) => void;
  } = {
    cards: () => [],
    settingRows: () => [],
    lead: () => null,
    prepareRelease: () => null,
    release: () => null,
    useItem: () => null,
    itemChoiceRows: () => [],
    equipChoiceRows: () => [],
    heldEquipment: () => -1,
    equip: () => null,
    skillSheet: () => null,
    canPayBadge: () => false,
    learnSkill: () => null,
    resolvePendingSkill: () => {},
    evolutionSkills: () => [],
    openQuality: () => null,
    openEvolution: () => null,
    openEvolutionOfKind: () => null,
    bankCards: () => [],
    bankDeposit: () => "invalid",
    bankWithdraw: () => "invalid",
    bankReleaseProtected: () => false,
    bankRelease: () => false,
    toggleCompanion: () => undefined,
  };
  /**
   * Why the screen is open: the menu's "Sủng vật" (`openWorldPetstate`: confirm opens
   * `petsetting.ui`), or a bag item waiting for its pet (`openPanelBagState17Petstate`).
   */
  petPurpose: "menu" | "useItem" | ServicePetPurpose = "menu";
  petItem = -1;
  /** `battlePetStateDetailUi`'s page: Hồ sơ, Chỉ số, Đặc tính, Kỹ năng. */
  petTab = 0;
  /** On the Đặc tính page: Thiên phú is the row shown (`TraitDetail.PHYSICAL`). */
  petTalent = false;
  /** The list, `petsetting.ui` over it, or the release question (`sourceReleaseConfirmVisible`). */
  petStage:
    | "list"
    | "setting"
    | "confirmRelease"
    | "itemChoice"
    | "equipChoice"
    | "skill"
    | "skillReplace"
    | "skillLearn"
    | "skillLearnReplace"
    | "quality"
    | "evolution" = "list";
  /** The open Nâng phẩm screen. */
  petQuality: QualityUpgradeSession | null = null;
  petEvolution: EvolutionSession | null = null;
  /** `sourceSkillBrowseTab` (0 TRANG BỊ, 1 BỂ CHIÊU), `sourceSkillIndex`, `sourceSkillScroll`. */
  readonly skillBrowse = { tab: 0, selected: 0, scroll: 0 };
  private skillIncoming = -1;
  private skillLearnQueue: PendingSkillLearn[] = [];
  private skillLearnCurrent: PendingSkillLearn | null = null;
  private skillLearnPostBattle = false;
  private skillLearnDecision: { kind: "learn" | "skip" | "replace"; replaceSlot?: number } | null =
    null;
  /** `sourceItemChoiceIndex/Scroll` and `sourceEquipmentChoiceIndex/Scroll`, kept between openings. */
  readonly itemChoice = { selected: 0, scroll: 0 };
  readonly equipChoice = { selected: 0, scroll: 0 };
  /** Where the screen goes once `petMessage` is confirmed. */
  private petMessageThen: "list" | "itemChoice" | "skill" | null = null;
  petSettingCursor = 0;
  petSettingScroll = 0;
  petMessage: BagMessage | null = null;

  get petCards(): BattleUiRow[] {
    return this.petListIsBank ? this.petSource.bankCards() : this.petSource.cards();
  }
  get petSettingRows(): string[] {
    return this.petSource.settingRows(this.selected);
  }
  /** The open `choice.ui` list ("Đạo cụ" or "Vật phẩm trang sức"), as JavaSE builds its view. */
  get petChoiceView(): {
    title: string;
    subtitle: string;
    action: string;
    rows: ChoiceRow[];
    selected: number;
    scroll: number;
  } | null {
    if (this.petStage === "itemChoice") {
      const rows = this.petSource.itemChoiceRows();
      return { title: "Đạo cụ", subtitle: "Số lượng", action: "Sử dụng", rows, ...this.itemChoice };
    }
    if (this.petStage !== "equipChoice") return null;
    const rows = this.petSource.equipChoiceRows(this.selected),
      id = rows[this.equipChoice.selected]?.id ?? -1,
      // `sourceEquipmentActionText`.
      action =
        id >= 0 && this.petSource.heldEquipment(this.selected) === id ? "Dỡ xuống" : "Mang theo";
    return {
      title: "Vật phẩm trang sức",
      subtitle: "Trạng thái",
      action,
      rows,
      ...this.equipChoice,
    };
  }

  /** `openWorldPetstate` / `openPanelBagState17Petstate(item)`. The cursor stays where it was. */
  openPets(item = -1): void {
    this.visible = true;
    this.mode = "pet";
    this.pressed.length = 0;
    this.petPurpose = item >= 0 ? "useItem" : "menu";
    this.petItem = item;
    this.petStage = "list";
    this.petMessage = null;
    const count = this.petCards.length;
    // `battleMenuIndex` is the pet screen's own cursor, not the game menu's row.
    this.selected = this.petCursor >= 0 && this.petCursor < count ? this.petCursor : 0;
    this.listScroll = 0;
    this.keepPetVisible();
    this.openedTicks = 0;
  }
  /** `battleMenuIndex`: the pet the screen was on when it last closed. */
  private petCursor = 0;

  private petSay(text: string): void {
    this.petMessage = { text, prompt: PET_PROMPT };
    this.petStage = "list";
  }
  /** A `msgWarm` over the current screen, then `then` once it is confirmed. */
  private petSayThen(text: string, then: "list" | "itemChoice" | "skill"): void {
    this.petMessage = { text, prompt: PET_PROMPT };
    this.petMessageThen = then;
  }

  /** The open tab's rows. */
  private skillRows(): PetSkillRow[] {
    const sheet = this.petSource.skillSheet(this.selected);
    return sheet ? (this.skillBrowse.tab === 1 ? sheet.pool : sheet.equipped) : [];
  }
  /** `sourceSkillCanRelearnAt`: an open pool skill the pet no longer uses. */
  private skillCanRelearn(rows: readonly PetSkillRow[]): boolean {
    return this.skillBrowse.tab === 1 && rows[this.skillBrowse.selected]?.state === 1;
  }
  /** `renderSourceSkillUi`'s inputs. */
  get petSkillView(): SkillScreenView | null {
    if (
      this.petStage !== "skill" &&
      this.petStage !== "skillReplace" &&
      this.petStage !== "skillLearn" &&
      this.petStage !== "skillLearnReplace"
    )
      return null;
    const sheet = this.petSource.skillSheet(this.selected);
    if (!sheet) return null;
    const learn = this.petStage === "skillLearn" || this.petStage === "skillLearnReplace",
      replace = this.petStage === "skillReplace" || this.petStage === "skillLearnReplace",
      pool = this.skillBrowse.tab === 1,
      rows =
        learn && !replace
          ? sheet.pool.filter((row) => row.id === this.skillIncoming)
          : replace
            ? sheet.equipped
            : pool
              ? sheet.pool
              : sheet.equipped,
      { selected, scroll } = this.skillBrowse,
      chosen = rows[selected],
      // The post-evolution queue is free. Its candidate is also an open pool row, but it must not
      // inherit the separate Huy hiệu relearn price/description.
      relearn = !learn && this.skillCanRelearn(rows);
    return {
      petName: sheet.petName,
      level: sheet.level,
      spriteId: sheet.spriteId,
      nature: sheet.nature,
      shinyColor: sheet.shinyColor,
      equippedCount: sheet.equipped.length,
      poolUnlocked: sheet.poolUnlocked,
      poolTotal: sheet.pool.length,
      pool: learn && !replace ? true : replace ? false : pool,
      rows: rows.map((row) => ({ name: row.name, status: row.rowStatus, state: row.state })),
      selected,
      scroll,
      detail: {
        name: chosen?.name ?? "",
        status: chosen?.status ?? "",
        state: chosen?.state ?? 4,
        meta: chosen?.meta ?? "",
        // `sourceSkillDescription`.
        description: relearn
          ? `Giá: 1 Huy hiệu. ${chosen?.description ?? ""}`
          : (chosen?.description ?? ""),
      },
      // `sourceSkillPrimaryActionLabel`.
      action: replace ? "Thay thế" : learn ? "Học" : relearn ? "Học lại - 1 HH" : "Đổi tab",
    };
  }
  /** `syncSourceSkillScrollToIndex`. */
  private syncSkillScroll(count: number): void {
    const b = this.skillBrowse;
    if (b.selected < b.scroll) b.scroll = b.selected;
    else if (b.selected >= b.scroll + SKILL_VISIBLE_ROWS)
      b.scroll = b.selected - SKILL_VISIBLE_ROWS + 1;
    b.scroll = clamp(b.scroll, 0, Math.max(0, count - SKILL_VISIBLE_ROWS));
  }
  /** `openSourceSkillUiFromPetSetting`: TRANG BỊ, first row. */
  private openPetSkills(): void {
    this.skillBrowse.tab = 0;
    this.skillBrowse.selected = 0;
    this.skillBrowse.scroll = 0;
    this.petStage = "skill";
  }
  /** `tickSourceSkill` (browse): left/right pick the tab, up/down move, 5 relearns. */
  private tickPetSkills(pressed: readonly InputCommand[]): void {
    const b = this.skillBrowse;
    if (
      this.petStage !== "skillReplace" &&
      (pressed.includes("left") || pressed.includes("right"))
    ) {
      // `switchSourceSkillBrowseTab`: only a change of tab (or an empty one) resets the cursor.
      const tab = pressed.includes("left") ? 0 : 1;
      if (b.tab !== tab || this.skillRows().length <= 0) {
        b.tab = tab;
        b.selected = 0;
        b.scroll = 0;
        this.syncSkillScroll(this.skillRows().length);
      }
      return;
    }
    const rows = this.skillRows(),
      count = rows.length;
    if (pressed.includes("up") && b.selected > 0) {
      b.selected--;
      this.syncSkillScroll(count);
    } else if (pressed.includes("down") && b.selected < count - 1) {
      b.selected++;
      this.syncSkillScroll(count);
    } else if (pressed.includes("back")) {
      if (this.petStage === "skillReplace") {
        this.petStage = "skill";
        b.tab = 1;
      } else this.petStage = "list";
    } else if (pressed.includes("confirm") && this.petStage === "skillReplace") {
      const line = this.petSource.learnSkill(this.selected, this.skillIncoming, b.selected);
      this.skillIncoming = -1;
      this.petStage = "skill";
      b.tab = 0;
      b.selected = 0;
      b.scroll = 0;
      if (line) this.petSayThen(line, "skill");
    } else if (pressed.includes("confirm") && this.skillCanRelearn(rows)) {
      // `beginSourceSkillRelearn`: without a badge the screen says so and stays.
      if (!this.petSource.canPayBadge())
        this.petSayThen("Không đủ Huy hiệu để học lại kỹ năng.", "skill");
      else {
        const skill = rows[b.selected]?.id ?? -1,
          equipped = this.petSource.skillSheet(this.selected)?.equipped.length ?? 0;
        if (skill < 0) return;
        if (equipped >= SKILL_SLOTS) {
          this.skillIncoming = skill;
          this.petStage = "skillReplace";
          b.tab = 0;
          b.selected = 0;
          b.scroll = 0;
        } else {
          const line = this.petSource.learnSkill(this.selected, skill);
          if (line) this.petSayThen(line, "skill");
        }
      }
    }
  }

  private beginEvolutionSkillQueue(ids: number[]): void {
    this.skillLearnPostBattle = false;
    this.skillLearnQueue = ids.map((skillId) => ({ petSlot: this.selected, skillId }));
    this.openNextQueuedSkill();
  }
  /** Open JavaSE's mandatory post-level-up queue before the battle result returns to story. */
  openPendingSkillQueue(entries: readonly PendingSkillLearn[]): void {
    if (this.postBattleSkillActive || entries.length === 0) return;
    this.visible = true;
    this.mode = "pet";
    this.pressed.length = 0;
    this.petPurpose = "menu";
    this.petMessage = null;
    this.petMessageThen = null;
    this.skillLearnDecision = null;
    this.skillLearnPostBattle = true;
    this.skillLearnQueue = entries.map((entry) => ({ ...entry }));
    this.openedTicks = 0;
    this.openNextQueuedSkill();
  }
  get postBattleSkillActive(): boolean {
    return this.skillLearnPostBattle && this.skillLearnCurrent !== null;
  }
  private openNextQueuedSkill(): void {
    const next = this.skillLearnQueue.shift();
    if (next === undefined) {
      this.skillIncoming = -1;
      this.skillLearnCurrent = null;
      this.skillLearnDecision = null;
      this.petStage = "list";
      if (this.skillLearnPostBattle) {
        this.skillLearnPostBattle = false;
        this.close();
      }
      return;
    }
    this.skillLearnCurrent = next;
    this.selected = next.petSlot;
    this.skillIncoming = next.skillId;
    this.petStage = "skillLearn";
    this.skillBrowse.tab = 1;
    this.skillBrowse.selected = 0;
    this.skillBrowse.scroll = 0;
  }
  private finishQueuedSkill(): void {
    const current = this.skillLearnCurrent;
    if (current && this.skillLearnPostBattle)
      this.petSource.resolvePendingSkill(current.petSlot, current.skillId);
    this.skillLearnCurrent = null;
    this.openNextQueuedSkill();
  }
  private queuedSkillName(sheet: PetSkillSheet): string {
    return (
      sheet.pool.find((row) => row.id === this.skillIncoming)?.name ?? `#${this.skillIncoming}`
    );
  }
  private askQueuedSkill(
    kind: "learn" | "skip" | "replace",
    text: string,
    replaceSlot?: number,
  ): void {
    this.skillLearnDecision = { kind, replaceSlot };
    this.petMessage = { text, prompt: PET_PROMPT };
  }
  private confirmQueuedSkillDecision(): void {
    const decision = this.skillLearnDecision;
    this.skillLearnDecision = null;
    this.petMessage = null;
    if (!decision) return;
    if (decision.kind === "skip") {
      this.finishQueuedSkill();
      return;
    }
    const sheet = this.petSource.skillSheet(this.selected);
    if (!sheet) {
      this.finishQueuedSkill();
      return;
    }
    if (decision.kind === "learn" && sheet.equipped.length >= SKILL_SLOTS) {
      this.petStage = "skillLearnReplace";
      this.skillBrowse.tab = 0;
      this.skillBrowse.selected = 0;
      this.skillBrowse.scroll = 0;
      return;
    }
    const learned = this.petSource.learnSkill(
      this.selected,
      this.skillIncoming,
      decision.replaceSlot,
      false,
    );
    if (learned !== null) this.finishQueuedSkill();
  }
  /** `tickSourceSkillLearn` for the free post-evolution and post-level-up queues. */
  private tickQueuedSkillLearn(pressed: readonly InputCommand[]): void {
    const sheet = this.petSource.skillSheet(this.selected),
      replacing = this.petStage === "skillLearnReplace";
    if (!sheet) {
      this.finishQueuedSkill();
      return;
    }
    if (replacing) {
      const b = this.skillBrowse,
        count = sheet.equipped.length;
      if (pressed.includes("up") && b.selected > 0) b.selected--;
      else if (pressed.includes("down") && b.selected < count - 1) b.selected++;
      else if (pressed.includes("back")) {
        this.petStage = "skillLearn";
        b.selected = 0;
      } else if (pressed.includes("confirm") && count > 0) {
        const oldName = sheet.equipped[b.selected]?.name ?? "kỹ năng cũ";
        this.askQueuedSkill(
          "replace",
          `Quên ${oldName} để học ${this.queuedSkillName(sheet)}?`,
          b.selected,
        );
      }
      this.syncSkillScroll(count);
      return;
    }
    if (pressed.includes("back"))
      this.askQueuedSkill("skip", `Từ bỏ học ${this.queuedSkillName(sheet)}?`);
    else if (pressed.includes("confirm")) {
      this.askQueuedSkill("learn", `Học tập ${this.queuedSkillName(sheet)}`);
    }
  }

  /** `tickSourceItemChoice` / `tickSourceEquipmentChoice`: up and down wrap, five rows show. */
  private tickPetChoice(pressed: readonly InputCommand[]): void {
    const item = this.petStage === "itemChoice",
      cursor = item ? this.itemChoice : this.equipChoice,
      rows = item ? this.petSource.itemChoiceRows() : this.petSource.equipChoiceRows(this.selected),
      size = rows.length;
    if (pressed.includes("up") && size > 0) {
      cursor.selected--;
      if (cursor.selected < 0) {
        cursor.selected = size - 1;
        cursor.scroll = Math.max(0, size - CHOICE_VISIBLE_ROWS);
      } else if (cursor.selected < cursor.scroll) cursor.scroll = cursor.selected;
      cursor.scroll = clampChoiceScroll(cursor.scroll, cursor.selected, size);
    } else if (pressed.includes("down") && size > 0) {
      cursor.selected++;
      if (cursor.selected >= size) {
        cursor.selected = 0;
        cursor.scroll = 0;
      } else if (cursor.selected >= cursor.scroll + CHOICE_VISIBLE_ROWS) cursor.scroll++;
      cursor.scroll = clampChoiceScroll(cursor.scroll, cursor.selected, size);
    } else if (pressed.includes("back")) {
      // `openWorldPetstate`: the dashboard comes back, the settings menu stays closed.
      this.petStage = "list";
    } else if (pressed.includes("confirm")) {
      const id = rows[cursor.selected]?.id ?? -1;
      if (id < 0) return;
      if (item) {
        // `confirmSourceItemChoice`: a refusal stays on the list; success returns to the pets.
        const line = this.petSource.useItem(this.selected, id);
        if (line === PET_ITEM_USED) this.petSay(line);
        else if (line !== null) this.petSayThen(line, "itemChoice");
        return;
      }
      // `confirmSourceEquipmentChoice`: the line shows over the list, then the dashboard.
      const line = this.petSource.equip(this.selected, id);
      if (line !== null) this.petSayThen(line, "list");
    }
  }
  /** `clampSourceChoiceIndex` + `clampSourceChoiceScroll` on opening. */
  private openPetChoice(stage: "itemChoice" | "equipChoice"): void {
    const cursor = stage === "itemChoice" ? this.itemChoice : this.equipChoice,
      size =
        stage === "itemChoice"
          ? this.petSource.itemChoiceRows().length
          : this.petSource.equipChoiceRows(this.selected).length;
    cursor.selected = size <= 0 ? 0 : clamp(cursor.selected, 0, size - 1);
    cursor.scroll = clampChoiceScroll(cursor.scroll, cursor.selected, size);
    this.petStage = stage;
  }

  /** `keepWorldPetstateSelectionVisible`: six quick cards. */
  private keepPetVisible(): void {
    const max = Math.max(0, this.petCards.length - PET_VISIBLE_ROWS);
    if (this.selected < this.listScroll) this.listScroll = this.selected;
    else if (this.selected >= this.listScroll + PET_VISIBLE_ROWS)
      this.listScroll = this.selected - PET_VISIBLE_ROWS + 1;
    this.listScroll = clamp(this.listScroll, 0, max);
  }
  /** `keepSourcePetSettingSelectionVisible`: six of the menu's seven or eight rows. */
  private keepPetSettingVisible(rows: number): void {
    const max = Math.max(0, rows - PET_VISIBLE_ROWS);
    if (this.petSettingCursor < this.petSettingScroll)
      this.petSettingScroll = this.petSettingCursor;
    else if (this.petSettingCursor >= this.petSettingScroll + PET_VISIBLE_ROWS)
      this.petSettingScroll = this.petSettingCursor - PET_VISIBLE_ROWS + 1;
    this.petSettingScroll = clamp(this.petSettingScroll, 0, max);
  }

  /** `tickWorldPetstate`, `tickSourcePetSetting`, `tickSourceReleaseConfirm`. */
  private tickPet(pressed: readonly InputCommand[]): void {
    if (this.petMessage) {
      if (this.skillLearnDecision) {
        if (pressed.includes("back")) {
          this.petMessage = null;
          this.skillLearnDecision = null;
        } else if (pressed.includes("confirm")) this.confirmQueuedSkillDecision();
        return;
      }
      if (pressed.includes("confirm")) {
        this.petMessage = null;
        if (this.petMessageThen) this.petStage = this.petMessageThen;
        this.petMessageThen = null;
        this.selected = clamp(this.selected, 0, Math.max(0, this.petCards.length - 1));
        this.keepPetVisible();
      }
      return;
    }
    if (this.petStage === "confirmRelease") {
      if (pressed.includes("back")) this.petStage = "list";
      else if (pressed.includes("confirm") && this.petPurpose === "bankRelease") {
        // `confirmSourcePetBankRelease`.
        this.petStage = "list";
        if (this.petSource.bankRelease(this.selected)) this.afterBankMove();
        else this.petSay("Thần thú không thể phóng sinh");
      } else if (pressed.includes("confirm")) {
        this.petStage = "list";
        const line = this.petSource.release(this.selected);
        this.selected = clamp(this.selected, 0, Math.max(0, this.petCards.length - 1));
        this.keepPetVisible();
        if (line !== null) this.petSay(line);
      }
      return;
    }
    if (this.petStage === "itemChoice" || this.petStage === "equipChoice") {
      this.tickPetChoice(pressed);
      return;
    }
    if (this.petStage === "skillLearn" || this.petStage === "skillLearnReplace") {
      this.tickQueuedSkillLearn(pressed);
      return;
    }
    if (this.petStage === "skill" || this.petStage === "skillReplace") {
      this.tickPetSkills(pressed);
      return;
    }
    if (this.petStage === "quality") {
      // `tickQualityUpgrade` runs every tick: the charge and the result play on their own.
      const session = this.petQuality;
      session?.tick(pressed);
      if (!session || session.closed) {
        this.petStage = "list";
        this.petQuality = null;
        this.selected = session ? session.mainIndex : 0;
        this.keepPetVisible();
      }
      return;
    }
    if (this.petStage === "evolution") {
      const session = this.petEvolution;
      session?.tick(pressed);
      if (!session || session.closed) {
        this.petEvolution = null;
        this.selected = session?.petIndex ?? 0;
        this.keepPetVisible();
        const candidates =
          session?.succeeded === true
            ? this.petSource.evolutionSkills(this.selected, session.previousSpecies)
            : [];
        if (candidates.length) this.beginEvolutionSkillQueue(candidates);
        else this.petStage = "list";
      }
      return;
    }
    if (this.petStage === "setting") {
      const rows = this.petSettingRows.length;
      if (pressed.includes("up") && this.petSettingCursor > 0) this.petSettingCursor--;
      else if (pressed.includes("down") && this.petSettingCursor < rows - 1)
        this.petSettingCursor++;
      else if (pressed.includes("back")) this.petStage = "list";
      else if (pressed.includes("confirm")) this.confirmPetSetting(rows);
      this.keepPetSettingVisible(rows);
      return;
    }
    // `battlePetStateDetailUi.handleKeyboard(left, right)` turns the dashboard's page first.
    if (pressed.includes("left") || pressed.includes("right")) {
      const page = stepPetStatePage(
        { tab: this.petTab, talent: this.petTalent },
        pressed.includes("right"),
      );
      this.petTab = page.tab % PET_TABS;
      this.petTalent = page.talent;
      return;
    }
    const count = this.petCards.length;
    if (pressed.includes("up") && this.selected > 0) this.select(this.selected - 1);
    else if (pressed.includes("down") && this.selected < count - 1) this.select(this.selected + 1);
    this.keepPetVisible();
    if (pressed.includes("back")) {
      this.petCursor = this.selected;
      if (this.petPurpose !== "menu" && this.petPurpose !== "useItem") {
        this.leaveServicePets();
        return;
      }
      if (this.petPurpose === "useItem") {
        this.returnToBag(this.petItem);
        return;
      }
      // `openMenuAt(1)`: the game menu on "Sủng vật".
      this.mode = "gamemenu";
      this.selected = MENU_ROW_PET;
      this.listScroll = 0;
      this.keepSelectedVisible(this.menuRowCount);
      this.openedTicks = 0;
    } else if (pressed.includes("confirm")) {
      if (count === 0) return;
      if (this.petPurpose !== "menu" && this.petPurpose !== "useItem") {
        this.confirmServicePet();
        return;
      }
      if (this.petPurpose === "useItem") {
        const line = this.petSource.useItem(this.selected, this.petItem);
        if (line !== null) this.petSay(line);
        return;
      }
      // `openSourcePetSettingFromPetstate`: the menu keeps its last row.
      this.petStage = "setting";
      const rows = this.petSettingRows.length;
      this.petSettingCursor = clamp(this.petSettingCursor, 0, rows - 1);
      this.keepPetSettingVisible(rows);
    }
  }

  /**
   * `tickSourcePetSetting` confirm: Đạo cụ (row 0), Chiến đấu (1), Vật phẩm trang sức (2),
   * Phóng sinh (3), Kỹ năng (4) and Nâng phẩm (5).
   */
  private confirmPetSetting(rows: number): void {
    if (this.petSettingCursor === rows - 1) {
      this.petSource.toggleCompanion(this.selected);
      this.petStage = "list";
      return;
    }
    switch (this.petSettingCursor) {
      case 0:
        this.openPetChoice("itemChoice");
        return;
      case 2:
        this.openPetChoice("equipChoice");
        return;
      case 4:
        this.openPetSkills();
        return;
      case 5: {
        const session = this.petSource.openQuality(this.selected);
        if (session) {
          this.petQuality = session;
          this.petStage = "quality";
        }
        return;
      }
      case 1: {
        const line = this.petSource.lead(this.selected);
        this.petStage = "list";
        this.selected = 0;
        this.listScroll = 0;
        // `confirmSourcePetSettingActivePet`: only a move to the front resets the menu's row.
        if (line !== null) this.petSay(line);
        else this.petSettingCursor = 0;
        return;
      }
      case 3: {
        const line = this.petSource.prepareRelease(this.selected);
        if (line !== null) this.petSay(line);
        else this.petStage = "confirmRelease";
        return;
      }
    }
    // The evolution row exists immediately before the companion row.
    if (rows === 8 && this.petSettingCursor === 6) {
      const session = this.petSource.openEvolution(this.selected);
      if (session) {
        this.petEvolution = session;
        this.petStage = "evolution";
      }
    }
    void rows;
  }

  // ------------------------------------------------------------------ area map (game.l state 4)

  /** The session's area map; the host builds it once so the pan survives between openings. */
  areaMap: AreaMapView | null = null;
  /** A press on the legend band (`a(0, 270, w, 30)`), consumed by the next tick. */
  private areaMapClose = false;

  /** The map key: state 4 over the frozen world. False when this area has no map. */
  openAreaMap(
    scene: number,
    room: number,
    mapSize: { width: number; height: number },
    doors: AreaMapDoor[],
  ): boolean {
    if (!this.areaMap?.open(scene, room, mapSize, doors)) return false;
    this.areaMapReturn = null;
    this.visible = true;
    this.mode = "areaMap";
    this.pressed.length = 0;
    this.areaMapClose = false;
    this.openedTicks = 0;
    return true;
  }

  private tickTask(pressed: readonly InputCommand[]): void {
    let rows = this.taskRows;
    const max = () => Math.max(0, rows.length - 1);
    this.selected = clamp(this.selected, 0, max());
    this.keepSelectedVisible(rows.length);
    if (pressed.includes("up")) {
      this.selected = clamp(this.selected - 1, 0, max());
      this.keepSelectedVisible(rows.length);
    } else if (pressed.includes("down")) {
      this.selected = clamp(this.selected + 1, 0, max());
      this.keepSelectedVisible(rows.length);
    } else if (pressed.includes("left")) {
      if (this.taskTab !== 0) {
        this.taskTab = 0;
        this.listScroll = 0;
        this.selected = this.taskSource.mainCursor();
        rows = this.taskRows;
        this.keepSelectedVisible(rows.length);
      }
    } else if (pressed.includes("right")) {
      if (this.taskTab !== 1) {
        this.taskTab = 1;
        this.selected = 0;
        this.listScroll = 0;
      }
    } else if (pressed.includes("confirm")) {
      // JavaSE `openTaskMap`: confirm shows the map, and closing it comes back to this row. The map
      // itself is the original game's area map.
      const back = { tab: this.taskTab, selected: this.selected, scroll: this.listScroll };
      if (this.taskSource.openMap()) this.areaMapReturn = back;
    } else if (pressed.includes("back")) {
      // JavaSE `tickTask` back: to the world when the shortcut opened it, else the menu's row.
      if (this.taskReturnToWorld) {
        this.taskReturnToWorld = false;
        this.close();
        this.openedTicks = 0;
        return;
      }
      this.mode = "gamemenu";
      this.selected = MENU_ROW_TASK;
      this.listScroll = 0; // `resetGameMenuViewport`
      this.keepSelectedVisible(this.menuRowCount);
      this.openedTicks = 0;
    }
  }

  /** State 4's tick: the slide, held-arrow panning, Back or a legend press to close. */
  private tickAreaMap(commands: readonly InputCommand[]): void {
    const close = this.areaMapClose;
    this.areaMapClose = false;
    if (!(this.areaMap?.tick(commands, close) ?? true)) return;
    const back = this.areaMapReturn;
    this.areaMapReturn = null;
    if (!back) {
      this.close();
      return;
    }
    // `tickTaskMap`: back to the task list where it was.
    this.visible = true;
    this.mode = "task";
    this.taskTab = back.tab;
    this.selected = back.selected;
    this.listScroll = back.scroll;
    this.openedTicks = 0;
  }
  /** Where a map opened from the task list returns (`taskMapReturn*`), or null for the world. */
  private areaMapReturn: { tab: TaskTab; selected: number; scroll: number } | null = null;

  /** `TASK_ROW_BACKGROUNDS` hit test; `width` is the click's 136 or the hover's widened rect. */
  private taskRowAt(layout: SourceUiLayout, x: number, y: number, hover: boolean): number {
    for (let slot = 0; slot < TASK_ROW_BACKGROUNDS.length; slot++) {
      const row = layout.widget(TASK_ROW_BACKGROUNDS[slot]);
      const right = hover ? row && row.x + Math.max(136, row.w) + 12 : row && row.x + 136;
      if (
        row &&
        right !== undefined &&
        x >= row.x - 4 &&
        x <= right &&
        y >= row.y - 2 &&
        y <= row.y + 14
      )
        return slot;
    }
    return -1;
  }

  /** `visibleListStart`: the row index drawn in a five-row list's top slot. */
  visibleListStart(rowCount: number): number {
    return clamp(this.listScroll, 0, Math.max(0, rowCount - TASK_VISIBLE_ROWS));
  }
  /** A notice card (a shortcut whose panel is not open yet, a gift), closed by confirm or back. */
  openNotice(text: string, title = "Thông báo"): void {
    this.visible = true;
    this.mode = "notice";
    this.notice = text;
    this.noticeTitle = title;
    this.pressed.length = 0;
    this.openedTicks = 0;
  }
  /** A card mode: no rows, any confirm, back or press closes it. */
  /** What `record.ui`, `petmap.ui` and `badge.ui` read; the host supplies it. */
  recordSource: {
    /** `recordAccess(specialRewards, 5)`: the Sủng vật sách tranh is held. */
    hasPetmapBook: () => boolean;
    stats: () => RecordStats;
    petmapRows: (tab: number, family: number, variant: number) => PetmapRow[];
    badges: () => BadgeEntry[];
  } = {
    hasPetmapBook: () => false,
    stats: () => ({ owned: 0, collected: 0, rare: 0, divine: 0, badges: 0, playTimeMillis: 0 }),
    petmapRows: () => [],
    badges: () => [],
  };
  /** `recordSelected`: 0 the pet book, 1 the badges. */
  recordSelected = 0;
  /** `recordMessageMode`'s line ("Không đạt được sủng vật sách tranh đạo cụ"). */
  recordMessage: BagMessage | null = null;
  petmapTab = 0;
  /** The Đồ giám page: the family (0 Liệt Hỏa, 1 Cầu Vồng, 2 V4)... */
  petmapFamily = 0;
  /** ...and the form: 0 the original, 1..13 shiny colour 0..12 (`COLLECTION_VARIANT_COUNT`). */
  petmapVariant = 0;
  /** The shiny colour the page's pictures are drawn in, or undefined on the original page. */
  get petmapShinyColor(): number | undefined {
    return this.petmapVariant === 0 ? undefined : this.petmapVariant - 1;
  }
  changePetmapPage(family: number, variant: number): void {
    const families = COLLECTION_FAMILY_NAMES.length,
      variants = COLLECTION_VARIANT_COUNT;
    this.petmapFamily = ((Math.trunc(family) % families) + families) % families;
    this.petmapVariant = ((Math.trunc(variant) % variants) + variants) % variants;
    this.selected = 0;
    this.listScroll = 0;
    this.openedTicks = 0;
  }
  private petmapReturnToBag: { selected: number; scroll: number } | null = null;
  private badgeReturnToBag: { selected: number; scroll: number } | null = null;

  get petmapRows(): PetmapRow[] {
    return this.recordSource.petmapRows(this.petmapTab, this.petmapFamily, this.petmapVariant);
  }
  get badgeEntries(): BadgeEntry[] {
    return this.recordSource.badges();
  }

  /** Gamemenu row 3: `record.ui`. */
  private openRecord(): void {
    this.mode = "record";
    this.selected = 0;
    this.recordSelected = 0;
    this.recordMessage = null;
    this.openedTicks = 0;
  }
  /** `tickRecord`. */
  private tickRecord(pressed: readonly InputCommand[]): void {
    if (this.recordMessage) {
      if (pressed.includes("confirm")) this.recordMessage = null;
      return;
    }
    if (pressed.includes("left")) this.recordSelected = 0;
    else if (pressed.includes("right")) this.recordSelected = 1;
    else if (pressed.includes("back")) {
      this.mode = "gamemenu";
      this.selected = MENU_ROW_RECORD;
      this.listScroll = 0;
      this.keepSelectedVisible(this.menuRowCount);
      this.openedTicks = 0;
    } else if (pressed.includes("confirm")) {
      if (this.recordSelected === 0) {
        if (!this.recordSource.hasPetmapBook()) {
          this.recordMessage = {
            text: "Không đạt được sủng vật sách tranh đạo cụ",
            prompt: PET_PROMPT,
          };
          return;
        }
        this.openPetmap(null);
      } else this.openBadges(null);
    }
  }
  private openPetmap(returnToBag: { selected: number; scroll: number } | null): void {
    this.petmapReturnToBag = returnToBag;
    this.mode = "petmap";
    this.selected = 0;
    this.petmapTab = 0;
    this.changePetmapPage(0, 0);
    this.listScroll = 0;
    this.openedTicks = 0;
  }
  /**
   * `openSourceBadgeAward`: op53 shows the badge just won in `badge.ui`, its cell selected, and the
   * world event that granted it waits until 5 or Back closes the panel straight back to the map.
   */
  openBadgeAward(badgeId: number): void {
    this.visible = true;
    this.mode = "badge";
    this.pressed.length = 0;
    this.selected = Math.max(
      0,
      this.badgeEntries.findIndex((entry) => entry.id === badgeId),
    );
    this.openedTicks = 0;
    this.badgeReturnToBag = null;
    this.badgeAward = true;
  }
  /** True while an op53 award is on screen (`badgeAwardReturnToWorld`). */
  get badgeAwardOpen(): boolean {
    return this.visible && this.badgeAward;
  }
  private badgeAward = false;

  /**
   * `openBranchTaskAcceptOption`: op49 shows `taskOption.ui` over the world for one branch task —
   * the two answers ("Tiếp nhận" / "Từ chối"), the rewards and their summary line. 5 answers with the
   * row under the cursor, Back answers 1; the answer waits in `takeTaskOptionAnswer` for the group.
   */
  openTaskOption(view: TaskOptionView): void {
    this.visible = true;
    this.mode = "taskOption";
    this.pressed.length = 0;
    this.taskOption = view;
    this.taskOptionAnswer = null;
    this.selected = 0;
    this.openedTicks = 0;
  }
  /** True while op49's `taskOption.ui` waits for an answer. */
  get taskOptionOpen(): boolean {
    return this.visible && this.mode === "taskOption";
  }
  /** The answer `closeTaskOption` gave (0 accepts), once; null while there is none. */
  takeTaskOptionAnswer(): number | null {
    const answer = this.taskOptionAnswer;
    this.taskOptionAnswer = null;
    return answer;
  }
  taskOption: TaskOptionView | null = null;

  // ------------------------------------------------------------------ Bến tàu (Mode.SOURCE_EAST_WHARF)

  /** The dock the captain opened (`sourceWharfIndex`), with its titles, rows and routes. */
  wharf: WharfDock | null = null;
  /** `showClosedWaterRoute`'s `msgWarm` line over the menu, or null. */
  wharfMessage: BagMessage | null = null;
  /** Whether a route's source gate group is complete (`sourceEventStateComplete`). */
  wharfSource: { gateOpen: (scene: number, room: number, group: number) => boolean } = {
    gateOpen: () => false,
  };
  private wharfTravel: WharfRoute | null = null;
  /** The "Khu Safari" row of the open dock, or -1 (web only). */
  wharfSafariRow = -1;
  /**
   * `openSourceWharfFromWorld`: `wharf1.ui` (Q0–Q3) or `wharf2.ui` (Q4) on its first row. Web only
   * (owner, 2026-11-17): with `safari` the captain also offers "Khu Safari" above "Không ra hàng";
   * a dock with that extra row is drawn on the five-row `wharf2.ui`. The temple dock's five rows
   * already fill it, so it has no Safari row.
   */
  openWharf(dock: WharfDock, safari = false): void {
    this.visible = true;
    this.mode = "wharf";
    this.pressed.length = 0;
    const room = safari && dock.labels.length < TEMPLE_WHARF_ROW_WIDGETS.length;
    this.wharfSafariRow = room ? dock.labels.length - 1 : -1;
    this.wharf = room
      ? { ...dock, labels: [...dock.labels.slice(0, -1), WHARF_SAFARI_LABEL, dock.labels.at(-1)!] }
      : dock;
    this.wharfMessage = null;
    this.wharfTravel = null;
    this.selected = 0;
    this.listScroll = 0;
    this.openedTicks = 0;
  }
  /** `wharf2.ui` is the temple dock's five-row menu; the others use `wharf1.ui`. */
  get wharfLayoutName(): "wharf1" | "wharf2" {
    return this.wharf?.index === WHARF_TEMPLE ||
      (this.wharf?.labels.length ?? 0) > EAST_WHARF_ROW_WIDGETS.length
      ? "wharf2"
      : "wharf1";
  }
  get wharfRowWidgets(): readonly number[] {
    return this.wharfLayoutName === "wharf2" ? TEMPLE_WHARF_ROW_WIDGETS : EAST_WHARF_ROW_WIDGETS;
  }
  /** The route the player sailed on, once (`travelSourceWharfRoute`); null otherwise. */
  takeWharfTravel(): WharfRoute | null {
    const route = this.wharfTravel;
    this.wharfTravel = null;
    return route;
  }
  /** `tickSourceEastWharf`. */
  private tickWharf(pressed: readonly InputCommand[]): void {
    if (this.wharfMessage) {
      if (pressed.includes("confirm") || pressed.includes("back")) this.wharfMessage = null;
      return;
    }
    const dock = this.wharf;
    if (!dock) return;
    const last = dock.labels.length - 1;
    if (pressed.includes("up")) this.select(clamp(this.selected - 1, 0, last));
    else if (pressed.includes("down")) this.select(clamp(this.selected + 1, 0, last));
    else if (pressed.includes("back") || (pressed.includes("confirm") && this.selected === last))
      this.close();
    else if (pressed.includes("confirm") && this.selected === this.wharfSafariRow) {
      this.close();
      this.safariSource.open();
    } else if (pressed.includes("confirm")) {
      const row = dock.routes[this.selected];
      if (!row) return;
      const route = wharfRoute(row, dock.labels[this.selected]);
      if (!this.wharfSource.gateOpen(route.gate.scene, route.gate.room, route.gate.group)) {
        this.wharfMessage = { text: "Đường thủy chưa mở", prompt: CONTINUE_PROMPT_5 };
        this.openedTicks = 0;
        return;
      }
      this.wharfTravel = route;
      this.close();
    }
  }
  /**
   * The dock row under a point: a row's band reaches 27 px down, but never into the next row's
   * (`wharf2.ui` rows are 18 px apart, so the bands would otherwise pick the row above).
   */
  private wharfRowAt(layout: SourceUiLayout, x: number, y: number): number {
    const labels = this.wharf?.labels ?? [],
      widgets = this.wharfRowWidgets;
    for (let i = 0; i < widgets.length && i < labels.length; i++) {
      const row = layout.widget(widgets[i]),
        next = i + 1 < labels.length ? layout.widget(widgets[i + 1] ?? -1) : undefined,
        bottom = next ? Math.min(row ? row.y + 27 : 0, next.y - 5) : (row?.y ?? 0) + 27;
      if (row && x >= row.x - 4 && x <= row.x + row.w + 12 && y >= row.y - 4 && y <= bottom)
        return i;
    }
    return -1;
  }
  /** A row selects and sails (5); the softkeys are 5 and Back. */
  private clickWharf(layout: SourceUiLayout, x: number, y: number): void {
    if (this.wharfMessage) {
      this.pressed.push("confirm");
      return;
    }
    const hit = this.wharfRowAt(layout, x, y);
    if (hit >= 0) {
      this.select(hit);
      this.pressed.push("confirm");
      return;
    }
    if (panelConfirmHit(x, y)) this.pressed.push("confirm");
    else if (panelBackHit(x, y)) this.pressed.push("back");
  }
  private taskOptionAnswer: number | null = null;
  /** `tickTaskOption`: up/down move between the two rows; 5 answers the row, Back answers 1. */
  private tickTaskOption(pressed: readonly InputCommand[]): void {
    const last = Math.max(0, (this.taskOption?.options.length ?? 0) - 1);
    this.selected = clamp(this.selected, 0, last);
    if (pressed.includes("up")) this.selected = clamp(this.selected - 1, 0, last);
    else if (pressed.includes("down")) this.selected = clamp(this.selected + 1, 0, last);
    else if (pressed.includes("confirm")) this.closeTaskOption(this.selected);
    else if (pressed.includes("back")) this.closeTaskOption(1);
  }
  private closeTaskOption(answer: number): void {
    this.taskOptionAnswer = answer;
    this.taskOption = null;
    this.close();
  }
  /** `taskOption.ui` rows 10 and 11: 15 px high, 23 px apart; a press on one answers it. */
  private taskOptionRowAt(layout: SourceUiLayout, x: number, y: number): number {
    const count = this.taskOption?.options.length ?? 0;
    for (let i = 0; i < TASK_OPTION_ROWS.length && i < count; i++) {
      const row = layout.widget(TASK_OPTION_ROWS[i]);
      if (
        row &&
        x >= row.x - 4 &&
        x <= row.x + 84 &&
        y >= row.y - 2 &&
        y < row.y + Math.max(15, row.h) + 2
      )
        return i;
    }
    return -1;
  }
  private openBadges(returnToBag: { selected: number; scroll: number } | null): void {
    this.badgeAward = false;
    this.badgeReturnToBag = returnToBag;
    this.mode = "badge";
    this.selected = 0;
    this.openedTicks = 0;
  }
  /** Back to "Đặc thù" on the row that was used (`petmapReturnBag*`, `badgeReturnBag*`). */
  private backToSpecials(at: { selected: number; scroll: number }): void {
    this.mode = "bag";
    this.bagTab = 3;
    const size = this.bagRows.length;
    this.selected = clamp(at.selected, 0, Math.max(0, size - 1));
    this.listScroll = at.scroll;
    this.keepSelectedVisible(size);
    this.openedTicks = 0;
  }
  /**
   * `tickPetmap`: up/down within the tab, left/right turn the tab; 5 turns the page (ProMax): each
   * family's original form and 13 shiny colours, then the next family.
   */
  private tickPetmap(pressed: readonly InputCommand[]): void {
    const rows = this.petmapRows,
      max = Math.max(0, rows.length - 1);
    this.selected = clamp(this.selected, 0, max);
    if (pressed.includes("up")) {
      this.selected = clamp(this.selected - 1, 0, max);
      this.keepSelectedVisible(rows.length);
    } else if (pressed.includes("down")) {
      this.selected = clamp(this.selected + 1, 0, max);
      this.keepSelectedVisible(rows.length);
    } else if (pressed.includes("left") || pressed.includes("right")) {
      const tab = clamp(
        this.petmapTab + (pressed.includes("left") ? -1 : 1),
        0,
        PETMAP_TAB_NAMES.length - 1,
      );
      if (tab !== this.petmapTab) {
        this.petmapTab = tab;
        this.selected = 0;
        this.listScroll = 0;
      }
    } else if (pressed.includes("confirm")) {
      const page =
        (this.petmapFamily * COLLECTION_VARIANT_COUNT + this.petmapVariant + 1) %
        (COLLECTION_FAMILY_NAMES.length * COLLECTION_VARIANT_COUNT);
      this.changePetmapPage(
        Math.trunc(page / COLLECTION_VARIANT_COUNT),
        page % COLLECTION_VARIANT_COUNT,
      );
    } else if (pressed.includes("back")) {
      const bag = this.petmapReturnToBag;
      this.petmapReturnToBag = null;
      if (bag) {
        this.backToSpecials(bag);
        return;
      }
      this.mode = "record";
      this.selected = 0;
      this.recordSelected = 0;
      this.recordMessage = null;
      this.openedTicks = 0;
    }
  }
  /** `tickBadge`: a five-wide grid; Back to `record.ui` (or the bag it came from). */
  private tickBadge(pressed: readonly InputCommand[]): void {
    const count = Math.max(1, this.badgeEntries.length);
    this.selected = clamp(this.selected, 0, count - 1);
    if (this.badgeAward && (pressed.includes("confirm") || pressed.includes("back"))) {
      this.badgeAward = false;
      this.openedTicks = 0;
      this.close();
      return;
    }
    if (pressed.includes("back")) {
      const bag = this.badgeReturnToBag;
      this.badgeReturnToBag = null;
      if (bag) {
        this.backToSpecials(bag);
        return;
      }
      this.mode = "record";
      this.selected = 0;
      this.recordSelected = 1;
      this.recordMessage = null;
      this.openedTicks = 0;
      return;
    }
    const before = this.selected,
      lastRowStart = Math.trunc((count - 1) / BADGE_GRID_COLUMNS) * BADGE_GRID_COLUMNS;
    if (pressed.includes("up") && this.selected >= BADGE_GRID_COLUMNS)
      this.selected -= BADGE_GRID_COLUMNS;
    else if (pressed.includes("down") && this.selected < lastRowStart)
      this.selected = Math.min(count - 1, this.selected + BADGE_GRID_COLUMNS);
    else if (pressed.includes("left") && this.selected % BADGE_GRID_COLUMNS !== 0) this.selected--;
    else if (
      pressed.includes("right") &&
      this.selected % BADGE_GRID_COLUMNS !== BADGE_GRID_COLUMNS - 1 &&
      this.selected + 1 < count
    )
      this.selected++;
    if (this.selected !== before) this.openedTicks = 0;
  }

  get isCard(): boolean {
    return this.mode === "notice";
  }

  get labels(): string[] {
    return this.mode === "gamesystem"
      ? SYSTEM_LABELS
      : this.mode === "gamemenu"
        ? this.menuLabels
        : [];
  }
  /** The game menu's rows; "Admin Tool" is listed for an admin account only. */
  get menuLabels(): string[] {
    return this.adminSource.enabled() ? [...MENU_LABELS, ADMIN_MENU_LABEL] : MENU_LABELS;
  }
  get menuRowCount(): number {
    return this.menuLabels.length;
  }
  get rowWidgets(): number[] {
    return this.mode === "gamesystem"
      ? SYSTEM_ROW_WIDGETS
      : this.mode === "gamemenu"
        ? MENU_ROW_WIDGETS
        : [];
  }
  /** `drawGameMenuRows`' `first`: the row index drawn in the top slot. */
  get firstVisibleRow(): number {
    return clamp(this.listScroll, 0, Math.max(0, this.menuRowCount - GAME_MENU_VISIBLE_ROWS));
  }

  /** `MENU_TITLE_TOKENS[selected]`: the token line under the title bar. */
  get menuTitle(): string {
    if (this.selected === MENU_ROW_ADMIN) return this.adminSource.enabled() ? ADMIN_MENU_LABEL : "";
    return MENU_TITLE_TOKENS[this.selected] ?? "";
  }

  tick(commands: InputCommand[]): void {
    if (!this.visible) return;
    this.openedTicks++;
    const pressed = [...commands, ...this.pressed];
    this.pressed.length = 0;
    if (this.isCard) {
      if (pressed.includes("confirm") || pressed.includes("back")) this.close();
      return;
    }
    if (this.mode === "save") {
      this.tickSave(pressed);
      return;
    }
    if (this.mode === "task") {
      this.tickTask(pressed);
      return;
    }
    if (this.mode === "areaMap") {
      this.tickAreaMap(pressed);
      return;
    }
    if (this.mode === "bag") {
      this.tickBag(pressed);
      return;
    }
    if (this.mode === "pet") {
      this.tickPet(pressed);
      return;
    }
    if (this.mode === "record") {
      this.tickRecord(pressed);
      return;
    }
    if (this.mode === "petmap") {
      this.tickPetmap(pressed);
      return;
    }
    if (this.mode === "badge") {
      this.tickBadge(pressed);
      return;
    }
    if (this.mode === "taskOption") {
      this.tickTaskOption(pressed);
      return;
    }
    if (this.mode === "wharf") {
      this.tickWharf(pressed);
      return;
    }
    if (this.mode === "portableShop") {
      if (this.portableShopMessage && (pressed.includes("confirm") || pressed.includes("back")))
        this.portableShopMessage = null;
      else this.tickPortableShop(pressed);
      return;
    }
    if (this.mode === "portableShopBuy") {
      this.tickPortableShopBuy(pressed);
      return;
    }
    if (this.mode === "portableShopConfirm") {
      this.tickPortableShopConfirm(pressed);
      return;
    }
    if (this.mode === "fashionShop") {
      this.tickFashionShop(pressed);
      return;
    }
    if (this.mode === "fashionBuyConfirm") {
      this.tickFashionBuyConfirm(pressed);
      return;
    }
    if (this.mode === "fashionOpenConfirm") {
      this.tickFashionOpenConfirm(pressed);
      return;
    }
    if (this.mode === "fashionReveal") {
      this.tickFashionReveal(pressed);
      return;
    }
    if (this.mode === "fashionExchange") {
      this.tickFashionExchange(pressed);
      return;
    }
    if (this.mode === "fashionExchangeConfirm") {
      this.tickFashionExchangeConfirm(pressed);
      return;
    }
    if (this.mode === "wardrobe") {
      this.tickWardrobe(pressed);
      return;
    }
    if (this.mode === "challenge") {
      this.tickChallenge(pressed);
      return;
    }
    if (this.mode === "giftCode") {
      this.tickGiftCode(pressed);
      return;
    }
    if (this.mode === "battlePass") {
      this.tickBattlePass(pressed);
      return;
    }
    if (this.mode === "battlePassHelp") {
      if (pressed.includes("back") || pressed.includes("confirm")) this.mode = "battlePass";
      return;
    }
    if (this.mode === "bondingTower") {
      const next = this.bondingTower.tick(pressed, this.towerSource);
      if (next === "battle") this.close();
      else if (next === "menu") {
        this.mode = "gamemenu";
        this.select(MENU_ROW_BONDING_TOWER);
        this.keepSelectedVisible(MENU_LABELS.length);
      }
      return;
    }
    if (this.mode === "convenience") {
      this.tickConvenience(pressed);
      return;
    }
    if (this.mode === "petBank") {
      this.tickPetBankMenu(pressed);
      return;
    }
    if (
      this.mode === "worldShop" ||
      this.mode === "worldShopSell" ||
      this.mode === "worldShopSellConfirm" ||
      this.mode === "worldShopRecover"
    ) {
      this.tickWorldShop(pressed);
      return;
    }
    if (this.mode === "rainbowCharm") {
      this.tickRainbowCharm(pressed);
      return;
    }
    if (this.mode === "rainbowCharmConfirm") {
      this.tickRainbowCharmConfirm(pressed);
      return;
    }
    if (this.mode === "ride") {
      this.tickRide(pressed);
      return;
    }
    if (this.mode === "cauVongShop") {
      if (this.cauVongShop.tick(pressed, this.cauVongShopSource)) {
        if (this.cauVongShop.bankRequested) this.openPetBank();
        else this.close();
      }
      return;
    }
    if (this.mode === "cauVongIncubator") {
      if (this.cauVongIncubator.tick(pressed, this.cauVongIncubatorSource)) this.close();
      return;
    }
    if (this.mode === "help") {
      if (pressed.includes("left")) this.helpPage = clamp(this.helpPage - 1, 0, 2);
      else if (pressed.includes("right")) this.helpPage = clamp(this.helpPage + 1, 0, 2);
      else if (pressed.includes("back")) {
        this.mode = "gamesystem";
        this.selected = 1;
        this.helpPage = 0;
        this.openedTicks = 0;
      }
      return;
    }
    if (this.mode === "settings") {
      if (pressed.includes("left")) this.setSettingsLevel(this.settingsLevel - 1);
      else if (pressed.includes("right")) this.setSettingsLevel(this.settingsLevel + 1);
      else if (pressed.includes("confirm") || pressed.includes("back")) {
        this.mode = "gamesystem";
        this.selected = 2;
        this.openedTicks = 0;
      }
      return;
    }
    if (this.mode === "optionConfirm") {
      if (pressed.includes("up")) this.selected = 0;
      else if (pressed.includes("down")) this.selected = 1;
      else if (pressed.includes("back") || (pressed.includes("confirm") && this.selected === 1)) {
        this.mode = "gamesystem";
        this.selected = 3;
        this.openedTicks = 0;
      } else if (pressed.includes("confirm")) {
        this.close();
        this.systemSource.exitToTitle();
      }
      return;
    }
    const max = this.labels.length - 1;
    if (pressed.includes("up")) this.selected = clamp(this.selected - 1, 0, max);
    else if (pressed.includes("down")) this.selected = clamp(this.selected + 1, 0, max);
    else if (pressed.includes("confirm")) this.confirm();
    else if (pressed.includes("back")) this.close();
    if (this.mode === "gamemenu") this.keepSelectedVisible(this.menuRowCount);
  }

  private sourceChoiceIndexAt(layout: SourceUiLayout, x: number, y: number): number {
    const choice = this.petStage === "itemChoice" ? this.itemChoice : this.equipChoice,
      size = this.petChoiceView?.rows.length ?? 0;
    for (let slot = 0; slot < CHOICE_VISIBLE_ROWS; slot++) {
      const row = layout.widget(11 + slot * 5),
        index = choice.scroll + slot;
      if (
        row &&
        index < size &&
        x >= row.x - 4 &&
        x <= row.x + 136 &&
        y >= row.y - 2 &&
        y <= row.y + 14
      )
        return index;
    }
    return -1;
  }

  private petSettingIndexAt(layout: SourceUiLayout, x: number, y: number): number {
    for (let slot = 0; slot < PET_SETTING_WIDGETS.length; slot++) {
      const row = layout.widget(PET_SETTING_WIDGETS[slot]),
        index = this.petSettingScroll + slot;
      if (
        row &&
        index < this.petSettingRows.length &&
        x >= row.x - 18 &&
        x <= row.x + Math.max(76, row.w) + 8 &&
        y >= row.y - 2 &&
        y <= row.y + 14
      )
        return index;
    }
    return -1;
  }

  /** World Petstate and all of its Java-owned child lists share the panel input latch. */
  private clickPet(layout: SourceUiLayout, x: number, y: number): void {
    if (this.petMessage) {
      this.pressed.push("confirm");
      return;
    }
    if (this.petStage === "setting") {
      const index = this.petSettingIndexAt(layout, x, y);
      if (index >= 0) {
        this.petSettingCursor = index;
        this.pressed.push("confirm");
      } else if (panelConfirmHit(x, y)) this.pressed.push("confirm");
      else if (panelBackHit(x, y)) this.pressed.push("back");
      return;
    }
    if (this.petStage === "itemChoice" || this.petStage === "equipChoice") {
      const index = this.sourceChoiceIndexAt(layout, x, y),
        cursor = this.petStage === "itemChoice" ? this.itemChoice : this.equipChoice;
      if (index >= 0) {
        cursor.selected = index;
        this.pressed.push("confirm");
      } else if (x <= 50 && y >= 288) this.pressed.push("confirm");
      else if (x >= 190 && y >= 288) this.pressed.push("back");
      return;
    }
    if (
      this.petStage === "skill" ||
      this.petStage === "skillReplace" ||
      this.petStage === "skillLearn" ||
      this.petStage === "skillLearnReplace"
    ) {
      const learning = this.petStage === "skillLearn" || this.petStage === "skillLearnReplace";
      if (!learning && x >= 18 && x < 222 && y >= 110 && y < 132) {
        this.skillBrowse.tab = x < 120 ? 0 : 1;
        this.skillBrowse.selected = 0;
        this.skillBrowse.scroll = 0;
        return;
      }
      if (x >= 18 && x < 222 && y >= 134 && y < 210) {
        const index = this.skillBrowse.scroll + Math.trunc((y - 134) / 19),
          rows = this.skillRows(),
          activate =
            index === this.skillBrowse.selected && (learning || this.skillCanRelearn(rows));
        if (index >= 0 && index < rows.length) {
          this.skillBrowse.selected = index;
          if (activate) this.pressed.push("confirm");
        }
      } else if (x <= 50 && y >= 288) this.pressed.push("confirm");
      else if (x >= 190 && y >= 288) this.pressed.push("back");
      return;
    }
    if (this.petStage === "confirmRelease") {
      if (panelConfirmHit(x, y)) this.pressed.push("confirm");
      else if (panelBackHit(x, y)) this.pressed.push("back");
      return;
    }
    if (this.petStage === "quality" || this.petStage === "evolution") {
      if (panelConfirmHit(x, y)) this.pressed.push("confirm");
      else if (panelBackHit(x, y)) this.pressed.push("back");
      return;
    }
    const page = petStatePageAt({ tab: this.petTab, talent: this.petTalent }, x, y);
    if (page) {
      this.petTab = page.tab;
      this.petTalent = page.talent;
    } else if (contains(x, y, PET_STATE.previous)) {
      this.select(Math.max(0, this.selected - 1));
      this.keepPetVisible();
    } else if (contains(x, y, PET_STATE.next)) {
      this.select(Math.min(this.petCards.length - 1, this.selected + 1));
      this.keepPetVisible();
    } else if (contains(x, y, PET_STATE.action)) this.pressed.push("confirm");
    else if (contains(x, y, PET_STATE.back)) this.pressed.push("back");
    else {
      const index = petIndexAt(x, y, this.petCards.length, this.listScroll);
      if (index >= 0) this.select(index);
    }
  }

  private petmapTabAt(layout: SourceUiLayout, x: number, y: number): number {
    return PETMAP_TAB_WIDGETS.findIndex((id) => {
      const tab = layout.widget(id);
      return (
        !!tab && x >= tab.x && x < tab.x + Math.max(16, tab.w) && y >= tab.y - 2 && y < tab.y + 20
      );
    });
  }

  private petmapRowAt(layout: SourceUiLayout, x: number, y: number): number {
    return PETMAP_ROW_WIDGETS.findIndex((id) => {
      const row = layout.widget(id);
      return !!row && x >= row.x - 4 && x <= row.x + 136 && y >= row.y - 2 && y <= row.y + 14;
    });
  }

  private badgeIndexAt(layout: SourceUiLayout, x: number, y: number): number {
    const count = this.badgeEntries.length;
    if (count > BADGE_SLOT_WIDGETS.length) {
      const selectedRow = Math.trunc(clamp(this.selected, 0, count - 1) / BADGE_GRID.columns),
        totalRows = Math.ceil(count / BADGE_GRID.columns),
        firstRow = clamp(selectedRow - BADGE_GRID.rows + 1, 0, Math.max(0, totalRows - 2)),
        first = firstRow * BADGE_GRID.columns,
        visible = Math.min(BADGE_GRID.columns * BADGE_GRID.rows, count - first);
      for (let slot = 0; slot < visible; slot++) {
        const row = Math.trunc(slot / BADGE_GRID.columns),
          column = slot % BADGE_GRID.columns,
          rowCount = Math.min(BADGE_GRID.columns, visible - row * BADGE_GRID.columns),
          offset = Math.trunc(((BADGE_GRID.columns - rowCount) * BADGE_GRID.dx) / 2),
          left = BADGE_GRID.x + offset + column * BADGE_GRID.dx,
          top = BADGE_GRID.y + row * BADGE_GRID.dy;
        if (x >= left && x < left + BADGE_GRID.size && y >= top && y < top + BADGE_GRID.size)
          return first + slot;
      }
      return -1;
    }
    return BADGE_SLOT_WIDGETS.findIndex((id, index) => {
      const slot = layout.widget(id);
      return (
        index < count &&
        !!slot &&
        x >= slot.x &&
        x < slot.x + Math.max(30, slot.w) &&
        y >= slot.y &&
        y < slot.y + 31
      );
    });
  }

  /**
   * `VqsvPanelRuntime.click`'s tail: a row rect moves the cursor and latches confirm, the two bottom
   * bands latch confirm/back, and any other point inside an open panel is still consumed by the panel.
   */
  click(layout: SourceUiLayout, x: number, y: number): boolean {
    if (!this.visible) return false;
    if (this.mode === "bondingTower") {
      this.pressed.push(...this.bondingTower.click(x, y, this.towerSource.view()));
      return true;
    }
    if (this.mode === "wharf") {
      this.clickWharf(layout, x, y);
      return true;
    }
    if (this.mode === "taskOption") {
      const row = this.taskOptionRowAt(layout, x, y);
      if (row >= 0) {
        this.selected = row;
        this.pressed.push("confirm");
      } else if (panelConfirmHit(x, y)) this.pressed.push("confirm");
      else if (panelBackHit(x, y)) this.pressed.push("back");
      return true;
    }
    if (this.mode === "ride") {
      this.clickRide(x, y);
      return true;
    }
    if (this.mode === "cauVongShop") {
      this.pressed.push(...this.cauVongShop.click(x, y));
      return true;
    }
    if (this.mode === "cauVongIncubator") {
      this.pressed.push(...this.cauVongIncubator.click(x, y));
      return true;
    }
    if (this.mode === "fashionShop") {
      if (this.wardrobeMessage) this.pressed.push("confirm");
      else {
        const cards = [
          { x: 106, y: 66, w: 126, h: 48 },
          { x: 106, y: 118, w: 126, h: 48 },
          { x: 106, y: 170, w: 126, h: 48 },
          { x: 8, y: 250, w: 224, h: 28 },
        ];
        const row = cards.findIndex((card) => inRect(x, y, card));
        if (row >= 0) {
          this.select(row);
          this.pressed.push("confirm");
        } else if (panelBackHit(x, y)) this.pressed.push("back");
      }
      return true;
    }
    if (this.mode === "fashionBuyConfirm") {
      if (inRect(x, y, { x: 48, y: 151, w: 48, h: 32 })) this.pressed.push("left");
      else if (inRect(x, y, { x: 144, y: 151, w: 48, h: 32 })) this.pressed.push("right");
      else if (inRect(x, y, { x: 42, y: 196, w: 156, h: 32 }) || panelConfirmHit(x, y))
        this.pressed.push("confirm");
      else if (panelBackHit(x, y)) this.pressed.push("back");
      return true;
    }
    if (this.mode === "fashionOpenConfirm" || this.mode === "fashionExchangeConfirm") {
      if (inRect(x, y, { x: 42, y: 196, w: 156, h: 32 }) || panelConfirmHit(x, y))
        this.pressed.push("confirm");
      else if (panelBackHit(x, y)) this.pressed.push("back");
      return true;
    }
    if (this.mode === "fashionReveal") {
      this.pressed.push("confirm");
      return true;
    }
    if (this.mode === "fashionExchange") {
      if (this.wardrobeMessage) this.pressed.push("confirm");
      else if (x >= 8 && x < 120 && y >= 64 && y < 244) {
        const slot = Math.trunc((y - 64) / 36),
          index = this.listScroll + slot;
        if (index < this.fashionEntries.length) {
          this.select(index);
          this.pressed.push("confirm");
        }
      } else if (inRect(x, y, { x: 128, y: 226, w: 104, h: 30 }) || panelConfirmHit(x, y))
        this.pressed.push("confirm");
      else if (panelBackHit(x, y)) this.pressed.push("back");
      return true;
    }
    if (this.mode === "rainbowCharm" || this.mode === "rainbowCharmConfirm") {
      this.clickRainbowCharm(x, y);
      return true;
    }
    if (this.mode === "portableShop") {
      if (this.portableShopMessage) this.pressed.push("confirm");
      else {
        for (let row = 0; row < SHOP_SERVICE.rows; row++) {
          const top = SHOP_SERVICE.y + row * SHOP_SERVICE.stride;
          if (
            x >= SHOP_SERVICE.x &&
            x < SHOP_SERVICE.x + SHOP_SERVICE.w &&
            y >= top &&
            y < top + SHOP_SERVICE.rowH
          ) {
            this.select(row);
            this.pressed.push("confirm");
            return true;
          }
        }
        if (shopActionHit(x, y) || panelConfirmHit(x, y)) this.pressed.push("confirm");
        else if (shopBackHit(x, y) || panelBackHit(x, y)) this.pressed.push("back");
      }
      return true;
    }
    if (this.mode === "portableShopBuy") {
      if (this.portableShopMessage) this.pressed.push("confirm");
      else {
        const index = shopItemIndexAt(x, y, this.portableShopOffers.length, this.listScroll);
        if (index >= 0) {
          this.select(index);
          this.pressed.push("confirm");
        } else if (shopActionHit(x, y) || panelConfirmHit(x, y)) this.pressed.push("confirm");
        else if (shopBackHit(x, y) || panelBackHit(x, y)) this.pressed.push("back");
      }
      return true;
    }
    if (this.mode === "portableShopConfirm") {
      if (this.portableShopMessage) this.pressed.push("confirm");
      else if (inRect(x, y, SHOP_CONFIRM.left)) this.pressed.push("left");
      else if (inRect(x, y, SHOP_CONFIRM.right)) this.pressed.push("right");
      else if (inRect(x, y, SHOP_CONFIRM.yes) || panelConfirmHit(x, y))
        this.pressed.push("confirm");
      else if (inRect(x, y, SHOP_CONFIRM.no) || panelBackHit(x, y)) this.pressed.push("back");
      return true;
    }
    if (this.mode === "wardrobe") {
      if (this.wardrobeMessage) this.pressed.push("confirm");
      else if (x >= 6 && x < 118 && y >= 38 && y < 228) {
        const slot = Math.trunc((y - 38) / 38),
          index = this.listScroll + slot;
        if ((y - 38) % 38 < 35 && index < this.wardrobeRows.length) {
          this.select(index);
          this.pressed.push("confirm");
        }
      } else if (inRect(x, y, { x: 0, y: 286, w: 112, h: 34 }) || panelConfirmHit(x, y))
        this.pressed.push("confirm");
      else if (inRect(x, y, { x: 128, y: 286, w: 112, h: 34 }) || panelBackHit(x, y))
        this.pressed.push("back");
      return true;
    }
    if (
      this.mode === "worldShop" ||
      this.mode === "worldShopSell" ||
      this.mode === "worldShopSellConfirm" ||
      this.mode === "worldShopRecover"
    ) {
      this.clickWorldShop(layout, x, y);
      return true;
    }
    if (this.isCard) {
      this.pressed.push("confirm");
      return true;
    }
    if (this.mode === "challenge") {
      if (y >= 108 && y < 160) this.selected = 0;
      else if (y >= 169 && y < 211) this.selected = 1;
      if ((y >= 108 && y < 211) || panelConfirmHit(x, y)) this.pressed.push("confirm");
      else if (panelBackHit(x, y)) this.pressed.push("back");
      return true;
    }
    if (this.mode === "giftCode") {
      if (panelConfirmHit(x, y)) this.pressed.push("confirm");
      else if (panelBackHit(x, y)) this.pressed.push("back");
      return true;
    }
    if (this.mode === "battlePass") {
      if (x >= 198 && y >= 72 && y < 94) this.openBattlePassHelp();
      else if (x >= 18 && x < 222 && y >= 108 && y < 132) {
        const max = this.battlePassSource.catalog()?.maxLevel ?? 1;
        this.battlePassLevel = clamp(this.battlePassLevel + (x < 120 ? -1 : 1), 1, max);
      } else if (x >= 17 && x < 223 && y >= 136 && y < 182) {
        this.battlePassVipTrack = false;
        this.pressed.push("confirm");
      } else if (x >= 17 && x < 223 && y >= 189 && y < 235) {
        this.battlePassVipTrack = true;
        this.pressed.push("confirm");
      } else if (panelConfirmHit(x, y)) this.pressed.push("confirm");
      else if (panelBackHit(x, y)) this.pressed.push("back");
      return true;
    }
    if (this.mode === "battlePassHelp") {
      this.pressed.push("back");
      return true;
    }
    if (this.mode === "convenience" || this.mode === "petBank") {
      this.clickServiceMenu(layout, x, y);
      return true;
    }
    if (this.mode === "help") {
      const hit = (id: number, pad = 12) => {
        const w = layout.widget(id);
        return (
          !!w && x >= w.x - pad && x <= w.x + w.w + pad && y >= w.y - pad && y <= w.y + w.h + pad
        );
      };
      if (hit(37)) this.pressed.push("left");
      else if (hit(38)) this.pressed.push("right");
      else if (panelBackHit(x, y)) this.pressed.push("back");
      return true;
    }
    if (this.mode === "settings") {
      if (x >= 84 && x <= 158 && y >= 179 && y <= 199) this.systemSource.toggleSpeedX2();
      else if (x >= 112 && x <= 166 && y >= 136 && y <= 174)
        this.setSettingsLevel(x < 133 ? 1 : x < 147 ? 2 : 3);
      else if (panelConfirmHit(x, y)) this.systemSource.toggleSpeedX2();
      else if (panelBackHit(x, y)) this.pressed.push("back");
      return true;
    }
    if (this.mode === "optionConfirm") {
      for (const [row, id] of [
        [0, 10],
        [1, 11],
      ] as const) {
        const w = layout.widget(id);
        if (w && x >= w.x - 4 && x <= w.x + w.w + 12 && y >= w.y - 4 && y <= w.y + 27) {
          this.selected = row;
          this.pressed.push("confirm");
          break;
        }
      }
      return true;
    }
    if (this.mode === "save") {
      // `click`'s SAVE branch: only the two softkey bands latch; any other press is swallowed.
      if (panelConfirmHit(x, y)) this.pressed.push("confirm");
      else if (panelBackHit(x, y)) this.pressed.push("back");
      return true;
    }
    if (this.mode === "pet") {
      this.clickPet(layout, x, y);
      return true;
    }
    if (this.mode === "record") {
      if (this.recordMessage) this.pressed.push("confirm");
      else {
        const left = layout.widget(4),
          right = layout.widget(32),
          hit = (widget: ReturnType<SourceUiLayout["widget"]>) =>
            !!widget &&
            x >= widget.x - 2 &&
            x < widget.x + Math.max(65, widget.w) + 2 &&
            y >= widget.y - 2 &&
            y < widget.y + 27;
        if (hit(left)) {
          this.recordSelected = 0;
          this.pressed.push("confirm");
        } else if (hit(right)) {
          this.recordSelected = 1;
          this.pressed.push("confirm");
        } else if (panelConfirmHit(x, y)) this.pressed.push("confirm");
        else if (panelBackHit(x, y)) this.pressed.push("back");
      }
      return true;
    }
    if (this.mode === "petmap") {
      // The page title (ProMax): "< family >" and "< form >", each half turning back or on.
      if (y >= 49 && y < 71 && x >= 41 && x < 191) {
        const family = x < 127,
          step = x < (family ? 84 : 159) ? -1 : 1;
        if (family) this.changePetmapPage(this.petmapFamily + step, this.petmapVariant);
        else this.changePetmapPage(this.petmapFamily, this.petmapVariant + step);
        return true;
      }
      const tab = this.petmapTabAt(layout, x, y),
        slot = this.petmapRowAt(layout, x, y);
      if (tab >= 0 && tab !== this.petmapTab) {
        this.petmapTab = tab;
        this.selected = 0;
        this.listScroll = 0;
      } else if (slot >= 0) {
        const index = this.visibleListStart(this.petmapRows.length) + slot;
        if (index < this.petmapRows.length) this.select(index);
      } else if (panelConfirmHit(x, y)) this.pressed.push("confirm");
      else if (panelBackHit(x, y)) this.pressed.push("back");
      return true;
    }
    if (this.mode === "badge") {
      // An award answers only the two softkeys, as 5 and Back.
      if (this.badgeAward) {
        if (panelConfirmHit(x, y)) this.pressed.push("confirm");
        else if (panelBackHit(x, y)) this.pressed.push("back");
        return true;
      }
      const index = this.badgeIndexAt(layout, x, y);
      if (index >= 0) this.select(index);
      else if (panelBackHit(x, y)) this.pressed.push("back");
      return true;
    }
    if (this.mode === "bag") {
      // `VqsvBagUiLayout`: a press closes a message; a tab switches to it, a row moves the
      // cursor, the two buttons act as 5 / Back.
      if (this.eggPreview) {
        // A press on the preview card closes it.
        if (x >= 10 && x < 230 && y >= 40 && y < 290) this.pressed.push("back");
      } else if (this.eggPicker) {
        const row = choiceRowAt(x, y, this.eggPicker.ids.length - this.eggPicker.start);
        if (row >= 0) {
          this.eggPicker.index = this.eggPicker.start + row;
          this.pressed.push("confirm");
        }
      } else if (this.bagMessage) this.pressed.push("confirm");
      else {
        const hit = this.bagHit(x, y),
          size = this.bagRows.length;
        if (hit.tab !== undefined) {
          if (hit.tab !== this.bagTab) this.selectBagTab(hit.tab);
        } else if (hit.slot !== undefined) {
          const index = this.listScroll + hit.slot,
            row = this.bagRows[index];
          if (index < size) this.select(index);
          // `eggPreviewHit`: the "?" pill at the right end of an owned egg's row.
          const pill = BAG_LAYOUT.list.x + BAG_LAYOUT.list.w - 23;
          if (row?.egg && (row.count ?? 0) > 0 && x >= pill && x < pill + 20)
            this.eggPreview = { itemId: row.id, scroll: 0 };
        } else if (inRect(x, y, BAG_LAYOUT.action)) this.pressed.push("confirm");
        else if (inRect(x, y, BAG_LAYOUT.back)) this.pressed.push("back");
      }
      return true;
    }
    if (this.mode === "areaMap") {
      // `a(0, 270, w, 30)`: a press on the legend band closes the map; anywhere else does nothing.
      // Landscape: the map fills the canvas, so its band is the canvas's bottom 30 px.
      if (viewport.landscape) {
        if (fromUi(x, y).y >= viewport.height - AREA_MAP_LEGEND_H) this.areaMapClose = true;
      } else if (y >= AREA_MAP_CLOSE_RECT.y && y < AREA_MAP_CLOSE_RECT.y + AREA_MAP_CLOSE_RECT.h)
        this.areaMapClose = true;
      return true;
    }
    if (this.mode === "task") {
      // The two tab plates (widgets 6/7) latch left/right; a row moves the cursor and confirms
      // (its map), as JavaSE does.
      const tab = (id: number) => {
        const w = layout.widget(id);
        return !!w && x >= w.x - 4 && x <= w.x + 68 && y >= w.y - 4 && y <= w.y + 22;
      };
      if (tab(6)) this.pressed.push("left");
      else if (tab(7)) this.pressed.push("right");
      else {
        const slot = this.taskRowAt(layout, x, y, false),
          size = this.taskRows.length;
        if (slot >= 0) {
          // JavaSE `click`: the row becomes the cursor and latches confirm (its map).
          this.selected = clamp(this.visibleListStart(size) + slot, 0, Math.max(0, size - 1));
          this.pressed.push("confirm");
        } else if (panelConfirmHit(x, y)) this.pressed.push("confirm");
        else if (panelBackHit(x, y)) this.pressed.push("back");
      }
      return true;
    }
    const slot = this.rowAt(layout, x, y);
    if (slot >= 0) {
      this.selected = this.mode === "gamemenu" ? this.indexAtSlot(slot) : slot;
      this.pressed.push("confirm");
      return true;
    }
    if (panelConfirmHit(x, y)) this.pressed.push("confirm");
    else if (panelBackHit(x, y)) this.pressed.push("back");
    return true;
  }

  /** `VqsvPanelRuntime.hover`: the row under the pointer becomes the cursor. */
  hover(layout: SourceUiLayout, x: number, y: number): void {
    if (!this.visible) return;
    if (this.mode === "wharf") {
      if (this.wharfMessage) return;
      const hit = this.wharfRowAt(layout, x, y);
      if (hit >= 0) this.select(hit);
      return;
    }
    if (this.mode === "taskOption") {
      const row = this.taskOptionRowAt(layout, x, y);
      if (row >= 0) this.select(row);
      return;
    }
    if (this.mode === "ride") {
      const card = rideCardAt(x, y);
      if (card >= 0 && !this.rideMessage) this.rideSelected = card;
      return;
    }
    if (this.mode === "rainbowCharm") {
      const index = shopItemIndexAt(x, y, this.rainbowCharmRows.length, this.rainbowCharmFirstRow);
      if (index >= 0) this.select(index);
      return;
    }
    if (this.mode === "portableShop") {
      if (this.portableShopMessage) return;
      for (let row = 0; row < SHOP_SERVICE.rows; row++) {
        const top = SHOP_SERVICE.y + row * SHOP_SERVICE.stride;
        if (
          x >= SHOP_SERVICE.x &&
          x < SHOP_SERVICE.x + SHOP_SERVICE.w &&
          y >= top &&
          y < top + SHOP_SERVICE.rowH
        ) {
          this.select(row);
          return;
        }
      }
      return;
    }
    if (this.mode === "portableShopBuy") {
      if (this.portableShopMessage) return;
      const index = shopItemIndexAt(x, y, this.portableShopOffers.length, this.listScroll);
      if (index >= 0) this.select(index);
      return;
    }
    if (this.mode === "wardrobe") {
      if (this.wardrobeMessage || x < 6 || x >= 118 || y < 38 || y >= 228) return;
      const slot = Math.trunc((y - 38) / 38),
        index = this.listScroll + slot;
      if ((y - 38) % 38 < 35 && index < this.wardrobeRows.length) this.select(index);
      return;
    }
    if (this.mode === "fashionShop") {
      const cards = [
        { x: 106, y: 66, w: 126, h: 48 },
        { x: 106, y: 118, w: 126, h: 48 },
        { x: 106, y: 170, w: 126, h: 48 },
        { x: 8, y: 250, w: 224, h: 28 },
      ];
      const row = cards.findIndex((card) => inRect(x, y, card));
      if (row >= 0 && !this.wardrobeMessage) this.select(row);
      return;
    }
    if (this.mode === "fashionExchange") {
      if (!this.wardrobeMessage && x >= 8 && x < 120 && y >= 64 && y < 244) {
        const index = this.listScroll + Math.trunc((y - 64) / 36);
        if (index < this.fashionEntries.length) this.select(index);
      }
      return;
    }
    if (this.mode === "worldShop") {
      if (this.worldShopMessage) return;
      for (let slot = 0; slot < WORLD_SHOP_ROW_WIDGETS.length; slot++) {
        const row = layout.widget(WORLD_SHOP_ROW_WIDGETS[slot]);
        if (
          row &&
          x >= row.x - 4 &&
          x <= row.x + Math.max(92, row.w) + 12 &&
          y >= row.y - 2 &&
          y <= row.y + 14
        ) {
          this.select(slot);
          return;
        }
      }
      return;
    }
    if (this.mode === "worldShopSell") {
      if (this.worldShopMessage) return;
      const rows = this.worldShopSellRows,
        first = clamp(this.listScroll, 0, Math.max(0, rows.length - 5));
      for (let slot = 0; slot < SHOPBUY_ROW_WIDGETS.length; slot++) {
        const row = layout.widget(SHOPBUY_ROW_WIDGETS[slot]),
          index = first + slot;
        if (
          row &&
          index < rows.length &&
          x >= row.x - 4 &&
          x <= row.x + Math.max(128, row.w) + 12 &&
          y >= row.y - 2 &&
          y <= row.y + Math.max(16, row.h)
        ) {
          this.select(index);
          return;
        }
      }
      return;
    }
    if (this.mode === "challenge") {
      if (x >= 17 && x < 223 && y >= 108 && y < 160) this.select(0);
      else if (x >= 17 && x < 223 && y >= 169 && y < 211) this.select(1);
      return;
    }
    if (this.mode === "battlePass") {
      if (x >= 17 && x < 223 && y >= 136 && y < 182) this.battlePassVipTrack = false;
      else if (x >= 17 && x < 223 && y >= 189 && y < 235) this.battlePassVipTrack = true;
      return;
    }
    if (this.mode === "convenience" || this.mode === "petBank") {
      if (this.serviceMessage || this.campaignMessage) return;
      const convenience = this.mode === "convenience",
        widgets = convenience ? CONVENIENCE_ROW_WIDGETS : PET_BANK_ROW_WIDGETS,
        first = convenience ? this.convenienceFirstRow : 0,
        count = convenience ? this.convenienceLabels.length : PET_BANK_LABELS.length;
      for (let slot = 0; slot < widgets.length; slot++) {
        const row = layout.widget(widgets[slot]);
        if (
          row &&
          first + slot < count &&
          x >= row.x - 4 &&
          x <= row.x + Math.max(convenience ? 59 : 92, row.w) + 12 &&
          y >= row.y - 2 &&
          y <= row.y + 14
        ) {
          this.select(first + slot);
          return;
        }
      }
      return;
    }
    if (this.mode === "pet") {
      if (this.petMessage) return;
      if (this.petStage === "setting") {
        const index = this.petSettingIndexAt(layout, x, y);
        if (index >= 0) this.petSettingCursor = index;
        return;
      }
      if (this.petStage === "itemChoice" || this.petStage === "equipChoice") {
        // A press already queued as confirm keeps the row it confirmed.
        if (this.pressed.includes("confirm")) return;
        const index = this.sourceChoiceIndexAt(layout, x, y),
          cursor = this.petStage === "itemChoice" ? this.itemChoice : this.equipChoice;
        if (index >= 0) cursor.selected = index;
        return;
      }
      if (
        this.petStage === "skill" ||
        this.petStage === "skillReplace" ||
        this.petStage === "skillLearn" ||
        this.petStage === "skillLearnReplace"
      ) {
        if (x >= 18 && x < 222 && y >= 134 && y < 210) {
          const index = this.skillBrowse.scroll + Math.trunc((y - 134) / 19);
          if (index < this.skillRows().length) this.skillBrowse.selected = index;
        }
        return;
      }
      if (this.petStage === "list") {
        const index = petIndexAt(x, y, this.petCards.length, this.listScroll);
        if (index >= 0) this.select(index);
      }
      return;
    }
    if (this.mode === "record") {
      if (this.recordMessage) return;
      for (const [index, id] of [
        [0, 4],
        [1, 32],
      ] as const) {
        const row = layout.widget(id);
        if (
          row &&
          x >= row.x - 2 &&
          x < row.x + Math.max(65, row.w) + 2 &&
          y >= row.y - 2 &&
          y < row.y + 27
        ) {
          this.recordSelected = index;
          return;
        }
      }
      return;
    }
    if (this.mode === "petmap") {
      const slot = this.petmapRowAt(layout, x, y),
        index = this.visibleListStart(this.petmapRows.length) + slot;
      if (slot >= 0 && index < this.petmapRows.length) this.select(index);
      return;
    }
    if (this.mode === "badge") {
      const index = this.badgeIndexAt(layout, x, y);
      if (index >= 0) this.select(index);
      return;
    }
    if (this.mode === "optionConfirm") {
      for (const [index, id] of [
        [0, 10],
        [1, 11],
      ] as const) {
        const row = layout.widget(id);
        if (row && x >= row.x - 4 && x <= row.x + row.w + 12 && y >= row.y - 4 && y <= row.y + 27) {
          this.select(index);
          return;
        }
      }
      return;
    }
    if (this.mode === "bag") {
      if (this.bagMessage || this.eggPicker || this.eggPreview) return;
      const slot = this.bagHit(x, y).slot;
      if (slot !== undefined && this.listScroll + slot < this.bagRows.length)
        this.select(this.listScroll + slot);
      return;
    }
    if (this.mode === "task") {
      const slot = this.taskRowAt(layout, x, y, true),
        size = this.taskRows.length;
      if (slot >= 0)
        this.select(clamp(this.visibleListStart(size) + slot, 0, Math.max(0, size - 1)));
      return;
    }
    const slot = this.rowAt(layout, x, y);
    if (slot < 0) return;
    this.select(this.mode === "gamemenu" ? this.indexAtSlot(slot) : slot);
  }

  /**
   * `VqsvPanelRuntime.mouseWheel`: the game menu scrolls in its six-row window and keeps the
   * cursor inside the window; the system menu moves its cursor.
   */
  wheel(steps: number): void {
    if (
      !this.visible ||
      steps === 0 ||
      this.isCard ||
      this.mode === "save" ||
      this.mode === "areaMap"
    )
      return;
    if (this.mode === "gamemenu") {
      this.applyScroll(this.listScroll + steps);
      return;
    }
    if (this.mode === "task") {
      // A list longer than its window scrolls; a short one moves the cursor instead.
      const size = this.taskRows.length;
      if (size > TASK_VISIBLE_ROWS) this.applyScroll(this.listScroll + steps);
      else if (size > 0) {
        this.select(clamp(this.selected + steps, 0, size - 1));
        this.keepSelectedVisible(size);
      }
      return;
    }
    if (this.mode === "bag") {
      // The wheel walks the cursor, as the arrow keys do.
      const size = this.bagRows.length;
      if (this.eggPreview) {
        this.pressed.push(steps < 0 ? "up" : "down");
        return;
      }
      if (this.bagMessage || this.eggPicker || size === 0) return;
      this.select(clamp(this.selected + steps, 0, size - 1));
      this.keepSelectedVisible(size);
      return;
    }
    if (this.mode === "portableShop") {
      this.select(clamp(this.selected + steps, 0, SHOP_SERVICE.rows - 1));
      return;
    }
    if (this.mode === "portableShopBuy") {
      const size = this.portableShopOffers.length;
      if (size > 0) {
        this.select(clamp(this.selected + steps, 0, size - 1));
        this.keepSelectedVisible(size);
      }
      return;
    }
    if (this.mode === "wardrobe") {
      const size = this.wardrobeRows.length;
      if (size > 0) {
        this.select(clamp(this.selected + steps, 0, size - 1));
        this.keepSelectedVisible(size);
      }
      return;
    }
    if (this.mode === "fashionShop") {
      this.select(clamp(this.selected + steps, 0, 3));
      return;
    }
    if (this.mode === "fashionExchange") {
      const size = this.fashionEntries.length;
      if (size > 0) {
        this.select(clamp(this.selected + steps, 0, size - 1));
        this.keepSelectedVisible(size);
      }
      return;
    }
    if (this.mode === "worldShopSell") {
      const size = this.worldShopSellRows.length;
      if (size > 0) {
        this.select(clamp(this.selected + steps, 0, size - 1));
        this.keepSelectedVisible(size);
      }
      return;
    }
    if (this.mode === "rainbowCharm") {
      const size = this.rainbowCharmRows.length;
      if (size > 0) {
        this.select(clamp(this.selected + steps, 0, size - 1));
        this.keepCharmVisible(size);
      }
      return;
    }
    if (this.mode === "petmap") {
      const size = this.petmapRows.length;
      if (size > 0) {
        this.select(clamp(this.selected + steps, 0, size - 1));
        this.keepSelectedVisible(size);
      }
      return;
    }
    if (this.mode === "badge") {
      const size = this.badgeEntries.length;
      if (size > 0) this.select(clamp(this.selected + steps, 0, size - 1));
      return;
    }
    if (this.mode === "pet") {
      if (this.petMessage) return;
      if (this.petStage === "setting") {
        const size = this.petSettingRows.length;
        this.petSettingCursor = clamp(this.petSettingCursor + steps, 0, Math.max(0, size - 1));
        this.keepPetSettingVisible(size);
      } else if (this.petStage === "itemChoice" || this.petStage === "equipChoice") {
        const cursor = this.petStage === "itemChoice" ? this.itemChoice : this.equipChoice,
          size = this.petChoiceView?.rows.length ?? 0;
        cursor.selected = clamp(cursor.selected + steps, 0, Math.max(0, size - 1));
        cursor.scroll = clampChoiceScroll(cursor.scroll, cursor.selected, size);
      } else if (
        this.petStage === "skill" ||
        this.petStage === "skillReplace" ||
        this.petStage === "skillLearn" ||
        this.petStage === "skillLearnReplace"
      ) {
        const size = this.skillRows().length;
        this.skillBrowse.selected = clamp(
          this.skillBrowse.selected + steps,
          0,
          Math.max(0, size - 1),
        );
        this.skillBrowse.scroll = clamp(
          this.skillBrowse.scroll,
          Math.max(0, this.skillBrowse.selected - SKILL_VISIBLE_ROWS + 1),
          this.skillBrowse.selected,
        );
      } else if (this.petStage === "list") {
        const size = this.petCards.length;
        if (size > 0) {
          this.select(clamp(this.selected + steps, 0, size - 1));
          this.keepPetVisible();
        }
      }
      return;
    }
    const size = this.labels.length;
    if (size > 0) this.select(clamp(this.selected + steps, 0, size - 1));
  }

  /** `pointerPressedScrollbar`: the thumb is grabbed, the track pages. True when the bar took it. */
  pressScrollbar(x: number, y: number, layout?: SourceUiLayout): boolean {
    this.releaseScrollbar();
    // ProMax: the pet item/equipment choice list's bar (widgets 50/51) can be dragged and paged too.
    const view = this.mode === "pet" && !this.petMessage ? this.petChoiceView : null;
    const track = view && layout?.widget(50);
    if (track && view.rows.length > CHOICE_VISIBLE_ROWS) {
      this.choiceScrollBar = {
        x: track.x,
        y: track.y,
        w: layout?.widget(51)?.w ?? track.w,
        h: track.h,
        rowCount: view.rows.length,
        visibleRows: CHOICE_VISIBLE_ROWS,
        minThumbHeight: CHOICE_THUMB_TRAVEL_HEIGHT,
        fixedThumbHeight: CHOICE_THUMB_TRAVEL_HEIGHT,
      };
    }
    const bar = this.scrollbar;
    if (!bar) return false;
    const pressed = pressScrollbar(x, y, view?.scroll ?? this.listScroll, bar);
    if (!pressed) {
      this.choiceScrollBar = undefined;
      return false;
    }
    if ("drag" in pressed) this.scrollGrab = pressed.drag;
    else {
      this.applyScroll(pressed.scroll);
      this.choiceScrollBar = undefined;
    }
    return true;
  }
  get scrollbarDragging(): boolean {
    return this.scrollGrab !== null;
  }
  /** `dragScrollbar`: the held thumb follows the pointer. */
  dragScrollbar(y: number): void {
    const bar = this.scrollbar;
    if (this.scrollGrab === null || !bar) {
      this.releaseScrollbar();
      return;
    }
    this.applyScroll(dragScroll(y, this.scrollGrab, bar));
  }
  releaseScrollbar(): void {
    this.scrollGrab = null;
    this.choiceScrollBar = undefined;
  }

  /** `scrollbarGeometry`: the game menu's and the task list's bars (the system menu has none). */
  private get scrollbar(): ScrollbarGeometry | undefined {
    if (!this.visible) return undefined;
    if (this.mode === "pet" && this.petChoiceView) return this.choiceScrollBar;
    if (this.mode === "gamemenu")
      return {
        ...GAME_MENU_SCROLLBAR,
        rowCount: this.menuRowCount,
        visibleRows: GAME_MENU_VISIBLE_ROWS,
      };
    if (this.mode === "task") {
      const rowCount = this.taskRows.length;
      // `pointerPressedScrollbar` ignores a bar whose list fits its window.
      if (rowCount <= TASK_VISIBLE_ROWS) return undefined;
      return { ...TASK_SCROLLBAR, rowCount, visibleRows: TASK_VISIBLE_ROWS };
    }
    return undefined;
  }
  /** `applyScrollbarScroll`: move the window and pull the cursor back inside it. */
  private applyScroll(next: number): void {
    if (this.choiceScrollBar) {
      const cursor = this.petStage === "itemChoice" ? this.itemChoice : this.equipChoice;
      cursor.scroll = next;
      cursor.selected = clampIndexIntoVisible(
        cursor.selected,
        next,
        this.choiceScrollBar.rowCount,
        CHOICE_VISIBLE_ROWS,
      );
      return;
    }
    const [rows, visible] =
      this.mode === "task"
        ? [this.taskRows.length, TASK_VISIBLE_ROWS]
        : [this.menuRowCount, GAME_MENU_VISIBLE_ROWS];
    this.listScroll = clamp(next, 0, Math.max(0, rows - visible));
    this.select(clampIndexIntoVisible(this.selected, this.listScroll, rows, visible));
  }
  /** `selectFromHover`: a new cursor restarts the row's opening animation. */
  private select(index: number): void {
    if (index !== this.selected) this.openedTicks = 0;
    this.selected = index;
  }
  /** `widgetRowAt`: the row widget whose rect (widened the way Java's is) holds the point, or -1. */
  private rowAt(layout: SourceUiLayout, x: number, y: number): number {
    const widgets = this.rowWidgets;
    for (let slot = 0; slot < widgets.length; slot++) {
      const row = layout.widget(widgets[slot]);
      if (
        row &&
        x >= row.x - 4 &&
        x <= row.x + Math.max(59, row.w) + 12 &&
        y >= row.y - 2 &&
        y <= row.y + 14
      )
        return slot;
    }
    return -1;
  }

  /** `gameMenuIndexAtSlot`: the visible slot maps through the scrolled viewport. */
  indexAtSlot(slot: number): number {
    return clamp(this.firstVisibleRow + slot, 0, this.menuRowCount - 1);
  }

  /**
   * `VqsvPanelRuntime.confirm`: each row opens its own sub-panel. Rows whose sub-panel is not ported
   * yet keep the cursor where it is, the way the source's PENDING branch does.
   */
  private confirm(): void {
    if (this.mode === "gamesystem") {
      if (this.selected === 0) this.close();
      else if (this.selected === 1) {
        this.mode = "help";
        this.helpPage = 0;
        this.selected = 0;
        this.openedTicks = 0;
      } else if (this.selected === 2) {
        this.mode = "settings";
        this.settingsLevel = clamp(this.systemSource.volumeLevel(), 0, 3);
        this.selected = 0;
        this.openedTicks = 0;
      } else if (this.selected === 3) {
        this.mode = "optionConfirm";
        this.selected = 1;
        this.openedTicks = 0;
      }
      return;
    }
    if (this.mode === "gamemenu" && this.selected === MENU_ROW_ADMIN) {
      if (!this.adminSource.enabled()) return;
      this.close();
      this.adminSource.open();
      return;
    }
    if (this.mode === "gamemenu" && this.selected === MENU_ROW_PET) {
      this.openPets();
      return;
    }
    if (this.mode === "gamemenu" && this.selected === MENU_ROW_PORTABLE_SHOP) {
      this.openPortableShop();
      return;
    }
    if (this.mode === "gamemenu" && this.selected === MENU_ROW_FASHION) {
      this.openWardrobe();
      return;
    }
    if (this.mode === "gamemenu" && this.selected === MENU_ROW_CHALLENGE) {
      this.openChallenge();
      return;
    }
    if (this.mode === "gamemenu" && this.selected === MENU_ROW_BATTLE_PASS) {
      this.openBattlePass();
      return;
    }
    if (this.mode === "gamemenu" && this.selected === MENU_ROW_BONDING_TOWER) {
      this.mode = "bondingTower";
      this.openedTicks = 0;
      this.bondingTower.open();
      return;
    }
    if (this.mode === "gamemenu" && this.selected === MENU_ROW_BAG) {
      this.openBag();
      return;
    }
    if (this.mode === "gamemenu" && this.selected === MENU_ROW_RECORD) {
      this.openRecord();
      return;
    }
    if (this.mode === "gamemenu" && this.selected === MENU_ROW_TASK) {
      this.openTasks(false);
      return;
    }
    if (this.mode === "gamemenu" && this.selected === MENU_ROW_SAVE) {
      this.mode = "save";
      this.savePhase = 0;
      this.saveMessage = SAVE_TEXT.ask;
      this.openedTicks = 0;
    }
  }

  private setSettingsLevel(level: number): void {
    this.settingsLevel = clamp(level, 0, 3);
    this.systemSource.setVolumeLevel(this.settingsLevel);
  }

  /** `tickSave`. Phase 1 is the tick the save is written; the web write answers asynchronously. */
  private tickSave(pressed: readonly InputCommand[]): void {
    if (this.savePhase === 0) {
      if (pressed.includes("confirm")) {
        this.savePhase = 1;
        this.saveMessage = SAVE_TEXT.saving;
      } else if (pressed.includes("back")) {
        this.mode = "gamemenu";
        this.selected = MENU_ROW_SAVE;
        this.listScroll = 0; // `resetGameMenuViewport`
        this.keepSelectedVisible(this.menuRowCount);
        this.openedTicks = 0;
        this.saveMessage = "";
      }
      return;
    }
    if (this.savePhase === 1) {
      if (!this.saveInFlight) this.saveRequested = true;
      return;
    }
    if (pressed.includes("confirm") || pressed.includes("back")) {
      if (this.saveReturnsToWorldShop) {
        // The recovery save acknowledged: `shop.ui` on "Khôi phục", the recovery not replayed.
        this.saveReturnsToWorldShop = false;
        this.savePhase = 0;
        this.saveMessage = "";
        this.returnToWorldShop(2);
      } else this.close();
    }
  }

  /** `keepSelectedVisible(this.menuRowCount)` after every gamesystem-free tick. */
  private keepSelectedVisible(rowCount: number): void {
    const visibleRows = this.mode === "gamemenu" ? GAME_MENU_VISIBLE_ROWS : 5,
      maxScroll = Math.max(0, rowCount - visibleRows);
    if (this.selected < this.listScroll) this.listScroll = this.selected;
    else if (this.selected >= this.listScroll + visibleRows)
      this.listScroll = this.selected - visibleRows + 1;
    this.listScroll = clamp(this.listScroll, 0, maxScroll);
  }
}
