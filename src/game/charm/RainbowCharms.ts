/**
 * Team charms ("Bùa hộ trận Cầu Vồng"), ported from JavaSE `vqsv.charm`: `RainbowCharmCatalog`,
 * `RainbowCharmState`, `RainbowCharmService` and the panel text helpers of `VqsvPanelRuntime`
 * (`rainbowCharmEffectDetail`, `rainbowCharmCostLine`, `charmResultMessage`).
 *
 * The catalog, the recipes, the material names and the species table are baked by
 * `ExportWebRainbowCharms.java` into `story/rainbow-charms.json`.
 */

export type CharmSlot = "SURVIVAL" | "TACTICAL" | "EXPLORATION";
export const CHARM_SLOTS: readonly CharmSlot[] = ["SURVIVAL", "TACTICAL", "EXPLORATION"];
export type CharmMechanic =
  | "EMERGENCY_HEAL"
  | "SKILL_SEAL"
  | "CORROSION_POWER"
  | "PARALYSIS_DURATION"
  | "METAL_DEFENSE"
  | "ENEMY_PP_DRAIN"
  | "SELF_PP_REFUND"
  | "BATTLE_REVIVE"
  | "RARE_ENCOUNTER"
  | "PREVENT_CAPTURE_FLEE"
  | "ESCAPE_RETRY"
  | "EVASION";

/** `RainbowCharmService.Recipe`; materials keep the recipe's order (`[materialId, count]`). */
export type CharmRecipe = { money: number; badgesRequired: number; materials: [number, number][] };
export type CharmDefinition = {
  runtimeId: number;
  stableKey: string;
  name: string;
  slot: CharmSlot;
  mechanic: CharmMechanic;
  /** `PetSpecies.runtimeId` the charm serves, -1 for every pet. */
  species: number;
  badgeUnlock: number;
  /** Tier I..V values. */
  tierValues: number[];
  craft: CharmRecipe;
  /** The recipe that lifts tier I..IV to the next one. */
  upgrades: CharmRecipe[];
};
export type RainbowCharmsDocument = {
  profileVersion: string;
  charms: CharmDefinition[];
  materialNames: Record<string, string>;
  /** Runtime species id → `PetSpecies.runtimeId` (`PetTaxonomyCatalog`). */
  petSpecies: Record<string, number>;
};

/** The saved `RainbowCharmState` (`campaign.charms`). */
export type CharmState = {
  starterClaimed: boolean;
  tiers: Record<string, number>;
  active: Record<CharmSlot, number>;
};

export const MIN_TIER = 1,
  MAX_TIER = 5,
  /** `RainbowCharmService.STARTER_ID`. */
  STARTER_CHARM_ID = 5037;

export const clampTier = (tier: number) => Math.max(MIN_TIER, Math.min(MAX_TIER, tier));
/** `RainbowCharmCatalog.romanTier`. */
export const romanTier = (tier: number) => ["", "I", "II", "III", "IV", "V"][clampTier(tier)];
/** `Definition.valueAtTier`. */
export const charmValue = (charm: CharmDefinition, tier: number) =>
  charm.tierValues[clampTier(tier) - 1] ?? 0;

export class RainbowCharmCatalog {
  private readonly byId = new Map<number, CharmDefinition>();
  constructor(readonly doc: RainbowCharmsDocument) {
    for (const charm of doc.charms) this.byId.set(charm.runtimeId, charm);
  }
  get definitions(): readonly CharmDefinition[] {
    return this.doc.charms;
  }
  byRuntimeId(id: number): CharmDefinition | undefined {
    return this.byId.get(id);
  }
  /** `PetTaxonomyCatalog.byRuntimeSpeciesId(id).species.runtimeId`, -1 when unknown. */
  petSpecies(speciesId: number): number {
    return this.doc.petSpecies[String(speciesId)] ?? -1;
  }
  materialName(id: number): string {
    return this.doc.materialNames[String(id)] ?? `Tài liệu ${id}`;
  }
}

// ------------------------------------------------------------------ RainbowCharmState

export const emptyCharmState = (): CharmState => ({
  starterClaimed: false,
  tiers: {},
  active: { SURVIVAL: -1, TACTICAL: -1, EXPLORATION: -1 },
});
export const ownsCharm = (state: CharmState, id: number) => state.tiers[String(id)] !== undefined;
export const charmTier = (state: CharmState, id: number) => state.tiers[String(id)] ?? 0;

/** `RainbowCharmState.restore`: drop unknown charms and bad tiers; an active id must be owned and of its slot. */
export function restoreCharmState(
  catalog: RainbowCharmCatalog,
  saved: Partial<CharmState> | undefined,
): CharmState {
  const state = emptyCharmState();
  for (const [key, tier] of Object.entries(saved?.tiers ?? {}))
    if (
      catalog.byRuntimeId(Number(key)) &&
      Number.isInteger(tier) &&
      tier >= MIN_TIER &&
      tier <= MAX_TIER
    )
      state.tiers[key] = tier;
  state.starterClaimed = saved?.starterClaimed === true;
  for (const slot of CHARM_SLOTS) {
    const id = saved?.active?.[slot] ?? -1,
      charm = catalog.byRuntimeId(id);
    state.active[slot] = charm && charm.slot === slot && ownsCharm(state, id) ? id : -1;
  }
  return state;
}

/** `RainbowCharmState.activeValue`: the value of the equipped charm with this mechanic, 0 if none. */
export function activeCharmValue(
  catalog: RainbowCharmCatalog,
  state: CharmState,
  mechanic: CharmMechanic,
): number {
  for (const slot of CHARM_SLOTS) {
    const id = state.active[slot],
      charm = catalog.byRuntimeId(id);
    if (charm && charm.mechanic === mechanic && ownsCharm(state, id))
      return charmValue(charm, charmTier(state, id));
  }
  return 0;
}

// ------------------------------------------------------------------ RainbowCharmService

export type CharmOutcome =
  | "STARTER_GRANTED"
  | "CRAFTED"
  | "UPGRADED"
  | "EQUIPPED"
  | "INVALID_CHARM"
  | "NOT_OWNED"
  | "ALREADY_OWNED"
  | "ALREADY_MAX"
  | "LOCKED"
  | "INSUFFICIENT_MONEY"
  | "INSUFFICIENT_MATERIALS";
export type CharmResult = {
  outcome: CharmOutcome;
  runtimeId: number;
  tierBefore: number;
  tierAfter: number;
};

/** What the service reads and spends: the session's money, materials, equipment and badges. */
export type CharmPurse = {
  currency: { money: number };
  materials: Record<string, number>;
  /** `inventory.equipmentItems` ids: a charm is also an equipment item. */
  equipment: number[];
  /** `achievedBadgeCount`: badges won. */
  achievedBadges: number;
};

const result = (
  outcome: CharmOutcome,
  runtimeId: number,
  tierBefore: number,
  tierAfter: number,
): CharmResult => ({ outcome, runtimeId, tierBefore, tierAfter });
const hasMaterials = (purse: CharmPurse, recipe: CharmRecipe) =>
  recipe.materials.every(([id, count]) => (purse.materials[String(id)] ?? 0) >= count);
function spend(purse: CharmPurse, recipe: CharmRecipe): void {
  for (const [id, count] of recipe.materials) {
    const key = String(id),
      left = (purse.materials[key] ?? 0) - count;
    if (left > 0) purse.materials[key] = left;
    else delete purse.materials[key];
  }
  purse.currency.money -= recipe.money;
}
/** `ensureEquipment`. */
function ensureEquipment(purse: CharmPurse, id: number): void {
  if (!purse.equipment.includes(id)) purse.equipment.push(id);
}

/** `RainbowCharmService.claimStarter` (retired in the panel, kept for the data path). */
export function claimStarterCharm(state: CharmState, purse: CharmPurse): CharmResult {
  if (state.starterClaimed) return result("ALREADY_OWNED", STARTER_CHARM_ID, 0, 0);
  ensureEquipment(purse, STARTER_CHARM_ID);
  state.tiers[String(STARTER_CHARM_ID)] ??= MIN_TIER;
  state.active.SURVIVAL = STARTER_CHARM_ID;
  state.starterClaimed = true;
  return result("STARTER_GRANTED", STARTER_CHARM_ID, 0, 1);
}

/** `RainbowCharmService.craft`: the badge unlock gates a craft, then money, then materials. */
export function craftCharm(
  catalog: RainbowCharmCatalog,
  state: CharmState,
  purse: CharmPurse,
  id: number,
): CharmResult {
  const charm = catalog.byRuntimeId(id);
  if (!charm) return result("INVALID_CHARM", id, 0, 0);
  if (ownsCharm(state, id) || purse.equipment.includes(id))
    return result("ALREADY_OWNED", id, charmTier(state, id), charmTier(state, id));
  if (purse.achievedBadges < charm.badgeUnlock) return result("LOCKED", id, 0, 0);
  if (purse.currency.money < charm.craft.money) return result("INSUFFICIENT_MONEY", id, 0, 0);
  if (!hasMaterials(purse, charm.craft)) return result("INSUFFICIENT_MATERIALS", id, 0, 0);
  spend(purse, charm.craft);
  ensureEquipment(purse, id);
  state.tiers[String(id)] ??= MIN_TIER;
  return result("CRAFTED", id, 0, 1);
}

/** `RainbowCharmService.upgrade`: the recipe's badge count gates the step. */
export function upgradeCharm(
  catalog: RainbowCharmCatalog,
  state: CharmState,
  purse: CharmPurse,
  id: number,
): CharmResult {
  const charm = catalog.byRuntimeId(id);
  if (!charm || !ownsCharm(state, id)) return result("NOT_OWNED", id, 0, 0);
  const before = charmTier(state, id);
  if (before >= MAX_TIER) return result("ALREADY_MAX", id, before, before);
  const recipe = charm.upgrades[before - 1];
  if (purse.achievedBadges < recipe.badgesRequired) return result("LOCKED", id, before, before);
  if (purse.currency.money < recipe.money) return result("INSUFFICIENT_MONEY", id, before, before);
  if (!hasMaterials(purse, recipe)) return result("INSUFFICIENT_MATERIALS", id, before, before);
  spend(purse, recipe);
  state.tiers[String(id)] = before + 1;
  return result("UPGRADED", id, before, before + 1);
}

/** `RainbowCharmService.equip`: one charm per slot. */
export function equipCharm(
  catalog: RainbowCharmCatalog,
  state: CharmState,
  id: number,
): CharmResult {
  const charm = catalog.byRuntimeId(id);
  if (!charm) return result("INVALID_CHARM", id, 0, 0);
  if (!ownsCharm(state, id)) return result("NOT_OWNED", id, 0, 0);
  const tier = charmTier(state, id);
  state.active[charm.slot] = id;
  return result("EQUIPPED", id, tier, tier);
}

/** `RainbowCharmService.craftRecipe` / `nextUpgradeRecipe`: the next step's recipe, null at V. */
export function nextCharmRecipe(charm: CharmDefinition, tier: number): CharmRecipe | null {
  if (tier <= 0) return charm.craft;
  return tier >= MAX_TIER ? null : (charm.upgrades[tier - 1] ?? null);
}

// ------------------------------------------------------------------ panel text

/** `VqsvPanelRuntime.charmResultMessage`. */
export function charmResultMessage(outcome: CharmResult): string {
  switch (outcome.outcome) {
    case "STARTER_GRANTED":
      return "Đã nhận bùa khởi đầu.";
    case "CRAFTED":
      return "Chế tác thành công bùa cấp I.";
    case "UPGRADED":
      return `Cường hóa thành công lên cấp ${romanTier(outcome.tierAfter)}.`;
    case "EQUIPPED":
      return "Đã trang bị bùa vào ô đội.";
    case "LOCKED":
      return "Chưa đủ số huy hiệu tiến trình yêu cầu.";
    case "INSUFFICIENT_MONEY":
      return "Không đủ kim tiền.";
    case "INSUFFICIENT_MATERIALS":
      return "Không đủ nguyên liệu.";
    case "ALREADY_MAX":
      return "Bùa đã đạt cấp V.";
    case "ALREADY_OWNED":
      return "Bùa này đã có trong kho.";
    case "NOT_OWNED":
      return "Chưa sở hữu bùa này.";
    default:
      return "Bùa không hợp lệ.";
  }
}

/** `rainbowCharmEffectDetail`. */
export function charmEffectDetail(charm: CharmDefinition, tier: number): string {
  const value = charmValue(charm, tier);
  switch (charm.mechanic) {
    case "EMERGENCY_HEAL":
      return `Hồi ${value}% HP khi dưới 50%, 1 lần/trận`;
    case "SKILL_SEAL":
      return `${value}% phong 3 Skill đối thủ trong 2 hiệp`;
    case "CORROSION_POWER":
      return `+${value}% sát thương Hủ Thực cho Thực Vật`;
    case "PARALYSIS_DURATION":
      return `${value}% cộng ${tier >= 3 ? 2 : 1} hiệp Tê Liệt cho Mãnh Thú`;
    case "METAL_DEFENSE":
      return `+${value}% Phòng ngự cho Kim Loại`;
    case "ENEMY_PP_DRAIN":
      return `${value}% trừ thêm 1 PP đối thủ cho Phi Hành`;
    case "SELF_PP_REFUND":
      return `${value}% hoàn 1 PP cho Hải Dương`;
    case "BATTLE_REVIVE":
      return `${value}% hồi sinh với ${REVIVE_HP_PERCENT[clampTier(tier)]}% HP, 1 lần/trận`;
    case "RARE_ENCOUNTER":
      return `+${value} điểm lượt xác định độ hiếm`;
    case "PREVENT_CAPTURE_FLEE":
      return `+${value} điểm bắt sau mỗi lần trượt, cộng dồn`;
    case "ESCAPE_RETRY":
      return `${value}% phá cấm chạy ở trận Pet hoang thường`;
    case "EVASION":
      return `${value}% né hoàn toàn đòn đánh`;
    default:
      return `Hiệu lực ${value}%`;
  }
}

/** `rainbowCharmCostLine`: what the next craft or upgrade costs. */
export function charmCostLine(
  catalog: RainbowCharmCatalog,
  charm: CharmDefinition,
  tier: number,
): string {
  const recipe = nextCharmRecipe(charm, tier);
  if (!recipe) return "Đã đạt cấp V";
  let text = "Cần ";
  if (recipe.badgesRequired > 0) text += `${recipe.badgesRequired} HH | `;
  text += `${recipe.money} kim`;
  for (const [id, count] of recipe.materials) text += ` | ${catalog.materialName(id)}x${count}`;
  return text;
}

/** `RainbowCharmBattleState.tryRevive`: the HP a revive leaves, by tier. */
export const REVIVE_HP_PERCENT = [0, 20, 25, 30, 40, 50] as const;
