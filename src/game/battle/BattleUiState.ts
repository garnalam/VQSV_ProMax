export type BattleUiMode =
  | "BATTLE"
  | "CATCH_ANIM"
  | "CHOICE"
  | "CHOICE_SKILL"
  | "COMMAND"
  | "LEVEL_UP"
  | "NPC_ENEMY"
  | "PET_STATE"
  | "SHOP_BUY"
  | "SHOP_CONFIRM"
  | "SKILL"
  | "SMS_INFO"
  | "TARGET"
  | "WARNING";
export type BattleUiRow = {
  name: string;
  value?: string;
  /** Source shop currency: 0 Kim tiền, 1 Huy hiệu, 2 Vàng. */
  currency?: number;
  description?: string;
  iconCell?: number;
  enabled?: boolean;
  element?: number;
  power?: number;
  tier?: number;
  targetSide?: number;
  chance?: number;
  /** A party row on the pet screen: everything its four tabs show. */
  pet?: BattleUiPet;
};
/** One pet as the pet screen (`PET_STATE`) draws it. */
export type BattleUiPet = {
  spriteId: number;
  /** The pet's nature: 7..9 draws it in its shiny palette. */
  nature?: number;
  /** The pet's own shiny colour (`SavedPet.shinyColor`), when it has one. */
  shinyColor?: number;
  /** Source element family; it owns the PetState accent exactly as it owns battle skill colour. */
  element: number;
  /** Display name used by the source PetState identity band. */
  elementName?: string;
  level: number;
  hp: number;
  maxHp: number;
  /** Progress to the next level, 0..100. */
  expPercent: number;
  /** Phẩm chất, drawn as stars. */
  quality: number;
  /** "Đang ra trận", "Sẵn sàng" or "Đã gục" in a fight; "Xuất chiến", "Sẵn sàng", "Không thể chiến" on the map. */
  status: string;
  /** The party's fighting pet (the dashboard marks its card green). */
  active?: boolean;
  /** `VqsvBattlePetStateView.divineSealed`: an owned Divine pet still at 30% (`DivinePetSeal`). */
  divineSealed?: boolean;
  held: string;
  /** Mệnh, Công, Phòng, Mẫn as they stand in the fight. */
  stats: [number, number, number, number];
  trait?: { name: string; description: string };
  talent?: { name: string; description: string };
  skills: { name: string; pp: string; element?: number }[];
  /** `taxonomySpeciesName`, when known. */
  speciesName?: string;
  /** `evolutionText`: every branch ("Tiến hóa > A / Dị hóa > B"); "" or none reads "Hình thái cuối". */
  evolution?: string;
  /** Active buffs and debuffs in a fight. */
  buffCount?: number;
  debuffCount?: number;
};
export type BattleUiState = {
  mode: BattleUiMode;
  title: string;
  prompt: string;
  selectedIndex: number;
  scroll: number;
  rows: BattleUiRow[];
  description: string;
  targetName: string;
  targetPlayerSide: boolean;
  /** 2v2: the target slot's actor position; the cursor sits at (x − 10, y − 38) (`drawTargetCursor`). */
  targetSlotPosition?: { x: number; y: number };
  message: string;
  /** The pet screen's open tab: Hồ sơ, Chỉ số, Đặc tính, Kỹ năng. */
  tab?: number;
  /** On the Đặc tính tab: Thiên phú is the selected row (`TraitDetail.PHYSICAL`), not Đặc tính. */
  talent?: boolean;
  levelUp?: {
    /** The pet that levelled (the seat may show another one). */
    spriteId?: number;
    nature?: number;
    shinyColor?: number;
    /** Skills it learned, and the ones waiting for a free slot. */
    learned?: string[];
    pending?: string[];
    name: string;
    level: number;
    oldStats: [number, number, number, number];
    newStats: [number, number, number, number];
  };
  shopTotal?: number;
  shopMoney?: number;
  shopBadges?: number;
  shopCurrency?: number;
};
export const battleUiState = (mode: BattleUiMode = "BATTLE"): BattleUiState => ({
  mode,
  title: "",
  prompt: "",
  selectedIndex: 0,
  scroll: 0,
  rows: [],
  description: "",
  targetName: "",
  targetPlayerSide: false,
  message: "",
});
