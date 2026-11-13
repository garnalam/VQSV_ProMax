import type { MetaSystemsDocument } from "../story/GameAssets";
import type { GameSave } from "../../persistence/save/GameSave";

export type BattlePassCatalog = MetaSystemsDocument["battlePass"];
export type BattlePassState = NonNullable<GameSave["meta"]>["battlePass"];
export type BattlePassEventType =
  | "BATTLE_COMPLETED"
  | "BATTLE_WON"
  | "SKILL_RESOLVED"
  | "EGG_HATCHED"
  | "EVOLUTION_COMMITTED"
  | "MUTATION_COMMITTED"
  | "QUALITY_UPGRADE_COMMITTED"
  | "MATERIAL_ACQUIRED"
  | "LOGIN_CONFIRMED";
export type BattlePassInventory = {
  currency: { money: number; badges: number };
  items: Record<string, number>;
  materials: Record<string, number>;
  specials: number[];
};

export const battlePassLevel = (catalog: BattlePassCatalog, state: BattlePassState): number =>
  Math.min(catalog.maxLevel, 1 + Math.floor(Math.max(0, state.xp) / catalog.xpPerLevel));
export const battlePassLevelXp = (catalog: BattlePassCatalog, state: BattlePassState): number =>
  Math.max(0, state.xp) % catalog.xpPerLevel;
export const battlePassDaysRemaining = (
  catalog: BattlePassCatalog,
  state: BattlePassState,
  nowEpochMillis: number,
): number => {
  const elapsed = Math.max(0, nowEpochMillis - state.seasonStartEpochMillis);
  return Math.min(
    catalog.seasonDays,
    Math.max(0, catalog.seasonDays - Math.floor(elapsed / 86_400_000)),
  );
};
export const battlePassClaimed = (state: BattlePassState, vip: boolean, level: number): boolean =>
  (vip ? state.claimedVip : state.claimedFree).includes(level);

const BASE_XP: Readonly<Record<BattlePassEventType, number>> = {
  BATTLE_WON: 100,
  BATTLE_COMPLETED: 25,
  SKILL_RESOLVED: 5,
  EGG_HATCHED: 50,
  EVOLUTION_COMMITTED: 80,
  MUTATION_COMMITTED: 100,
  QUALITY_UPGRADE_COMMITTED: 60,
  MATERIAL_ACQUIRED: 0,
  LOGIN_CONFIRMED: 20,
};

export function applyBattlePassEvent(
  catalog: BattlePassCatalog,
  state: BattlePassState,
  event: { id: string; type: BattlePassEventType; amount?: number },
  nowEpochMillis: number,
): number {
  if (
    state.seasonKey !== catalog.seasonKey ||
    battlePassDaysRemaining(catalog, state, nowEpochMillis) <= 0 ||
    !event.id ||
    state.appliedEvents.includes(event.id)
  )
    return 0;
  state.appliedEvents.push(event.id);
  if (state.appliedEvents.length > 128) state.appliedEvents.shift();
  let gain =
    event.type === "MATERIAL_ACQUIRED"
      ? Math.min(100, Math.max(0, event.amount ?? 0))
      : BASE_XP[event.type];
  catalog.missions.forEach((mission, index) => {
    const matches =
      mission.event === event.type ||
      (mission.event === "MUTATION_COMMITTED" && event.type === "EVOLUTION_COMMITTED");
    if (!matches) return;
    const before = state.missions[index] ?? 0,
      after = Math.min(mission.target, before + Math.max(1, event.amount ?? 1));
    state.missions[index] = after;
    if (before < mission.target && after >= mission.target) gain += mission.xp;
  });
  state.xp = Math.min(catalog.maxLevel * catalog.xpPerLevel - 1, Math.max(0, state.xp) + gain);
  return gain;
}

export type BattlePassClaimResult =
  | { claimed: true }
  | {
      claimed: false;
      reason:
        "season_expired" | "level_locked" | "vip_locked" | "already_claimed" | "inventory_full";
    };

export function claimBattlePassReward(
  catalog: BattlePassCatalog,
  state: BattlePassState,
  inventory: BattlePassInventory,
  level: number,
  vip: boolean,
  nowEpochMillis: number,
): BattlePassClaimResult {
  if (battlePassDaysRemaining(catalog, state, nowEpochMillis) <= 0)
    return { claimed: false, reason: "season_expired" };
  const row = catalog.levels[level - 1];
  if (!row || level > battlePassLevel(catalog, state))
    return { claimed: false, reason: "level_locked" };
  if (vip && !state.vipUnlocked) return { claimed: false, reason: "vip_locked" };
  if (battlePassClaimed(state, vip, level)) return { claimed: false, reason: "already_claimed" };
  const rewards = vip ? row.vip : row.free,
    max = 0x7fffffff;
  let money = inventory.currency.money,
    badges = inventory.currency.badges;
  for (const reward of rewards) {
    if (reward.kind === "MONEY") money += reward.quantity;
    else if (reward.kind === "BADGES") badges += reward.quantity;
    else if (
      reward.kind === "BAG_ITEM" &&
      (inventory.items[String(reward.id)] ?? 0) + reward.quantity > 99
    )
      return { claimed: false, reason: "inventory_full" };
    else if (
      reward.kind === "MATERIAL" &&
      (inventory.materials[String(reward.id)] ?? 0) + reward.quantity > max
    )
      return { claimed: false, reason: "inventory_full" };
    else if (
      reward.kind === "SPECIAL_REWARD" &&
      inventory.specials.filter((id) => id === reward.id).length + reward.quantity > 99
    )
      return { claimed: false, reason: "inventory_full" };
  }
  if (money > max || badges > max) return { claimed: false, reason: "inventory_full" };
  for (const reward of rewards) {
    const key = String(reward.id);
    if (reward.kind === "MONEY") inventory.currency.money += reward.quantity;
    else if (reward.kind === "BADGES") inventory.currency.badges += reward.quantity;
    else if (reward.kind === "BAG_ITEM")
      inventory.items[key] = (inventory.items[key] ?? 0) + reward.quantity;
    else if (reward.kind === "MATERIAL")
      inventory.materials[key] = (inventory.materials[key] ?? 0) + reward.quantity;
    else if (reward.kind === "SPECIAL_REWARD")
      for (let i = 0; i < reward.quantity; i++) inventory.specials.push(reward.id);
  }
  (vip ? state.claimedVip : state.claimedFree).push(level);
  return { claimed: true };
}

export function purchaseBattlePassVip(
  catalog: BattlePassCatalog,
  state: BattlePassState,
  currency: { badges: number },
): boolean {
  if (state.vipUnlocked || currency.badges < catalog.vipPriceBadges) return false;
  currency.badges -= catalog.vipPriceBadges;
  state.vipUnlocked = true;
  return true;
}
