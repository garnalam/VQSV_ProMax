import type { SavedPet } from "../../persistence/save/GameSave";
import type { CauVongMinigameState } from "../world/CauVongMinigame";

/**
 * One hatchable egg. The Liệt Hỏa eggs are the same kind of object — one bag row, one incubator,
 * item 14, the "?" preview — and differ only in their name, text, icon and what they hatch: `tiers`
 * draws the unified quality bands (`EggService.hatchUnified`), `pool` draws its own species list
 * (`hatchFromPool`). The Cầu Vồng species eggs (`CauVongEggCatalog`, the quest awards) are
 * `cauVong` rows: their bag row opens the 5-slot Cầu Vồng incubator (`CauVongIncubator.ts`),
 * which hatches their `incubator` recipe; item 14 never picks them. Their art stays in the
 * `egg-icons` pack domain.
 */
export type EggCatalogRow = {
  itemId: number;
  name: string;
  description: string;
  /** Sheet-258 icon cell. */
  iconCell: number;
  hatch: "tiers" | "pool" | "cauVong";
  pool?: number[];
  /** `CauVongSourceEggRecipe`: what a Cầu Vồng egg hatches, at what level, from what materials. */
  incubator?: {
    species: number;
    speciesName: string;
    level: number;
    materials: { source: number; kind: string; id: number; name: string; count: number }[];
  };
  /** `V4EggCatalog.price`: what Jones' exchange (4:5:15) sells a V4 egg for, in money. */
  price?: number;
  /** The preview card's species. */
  species: { speciesId: number; name: string; visualId: number }[];
};
export type RideCatalogRow = {
  id: number;
  name: string;
  speed: number;
  suppressesEncounters: boolean;
  speciesId?: number;
};
export type CharmRecipe = {
  money: number;
  badgesRequired: number;
  materials: Record<string, number>;
};
export type CharmCatalogRow = {
  runtimeId: number;
  stableKey: string;
  name: string;
  slot: "SURVIVAL" | "TACTICAL" | "EXPLORATION";
  mechanic: string;
  badgeUnlock: number;
  tierValues: number[];
  craft: CharmRecipe;
  upgrades: CharmRecipe[];
};
export type CampaignSystemsDocument = {
  profileVersion: string;
  eggs: EggCatalogRow[];
  /** `CauVongIncubationProgression.SLOTS` / `TARGET`. */
  cauVongIncubator?: { slots: number; target: number };
  /** `UnifiedWorldAcquisitionCatalog` egg bands: basis points and species per quality tier. */
  eggTiers?: { rates: number[]; species: number[][] };
  rides: RideCatalogRow[];
  charms: CharmCatalogRow[];
};

export type CampaignState = {
  petBank: SavedPet[];
  petBankExpansionPurchases: number;
  egg: {
    active: boolean;
    activeEggItemId: number;
    type: number;
    progress: number;
    drawIndex: number;
    /** `EggProgression.drawSeed` as a decimal long; drawn the first time an egg hatches. */
    drawSeed?: string;
    /** `knownSpecies`: the species each egg type has hatched (-1 unset). */
    knownSpecies?: number[];
  };
  dailyBadgeLastClaimEpochMillis: number;
  ride: { activeIndex: number; blocked: number[] };
  charms: {
    starterClaimed: boolean;
    tiers: Record<string, number>;
    active: { SURVIVAL: number; TACTICAL: number; EXPLORATION: number };
  };
  worldRandom: { seed: number; draws: number };
  /**
   * `progression.nguyenMocRace*`: the Lục Hành Điểu race's rolling window (its first start, the
   * starts used) and whether its unique pet was won. Absent until the first race.
   */
  race?: { windowStart: number; attempts: number; petClaimed: boolean };
  /** `progression.cauVongIncubation`: the five Cầu Vồng slots (item 0 empty, points 0..200). */
  cauVongIncubation?: { items: number[]; progress: number[] };
  /** `progression.cauVongMinigame`: the open summon-room board (room -1 closed) and the streak. */
  cauVongMinigame?: CauVongMinigameState;
};

export const defaultCampaignState = (seed = 0): CampaignState => ({
  petBank: [],
  petBankExpansionPurchases: 0,
  egg: { active: false, activeEggItemId: 0, type: 0, progress: 0, drawIndex: 0 },
  dailyBadgeLastClaimEpochMillis: 0,
  ride: { activeIndex: -1, blocked: new Array(9).fill(0) },
  charms: {
    starterClaimed: false,
    tiers: {},
    active: { SURVIVAL: -1, TACTICAL: -1, EXPLORATION: -1 },
  },
  worldRandom: { seed, draws: 0 },
});

export const petBankCapacity = (purchases: number): number =>
  100 + 100 * Math.max(0, Math.min(3, Math.trunc(purchases)));

export function purchasePetBankExpansion(
  state: CampaignState,
  currency: { badges: number },
): "success" | "insufficient" | "max" {
  if (state.petBankExpansionPurchases >= 3) return "max";
  if (currency.badges < 10) return "insufficient";
  currency.badges -= 10;
  state.petBankExpansionPurchases++;
  return "success";
}

const renumber = (pets: SavedPet[]) => pets.forEach((pet, index) => (pet.slot = index));
/** `PetSourceAdapter.ensureCurrentHp > 0`: a pet with no HP recorded counts as full. */
const living = (pet: SavedPet) => (pet.currentHp ?? pet.maxHp ?? 1) > 0;

/**
 * JavaSE `PetManagementService.depositToBank`: a full bank refuses first, then the party must keep
 * another living pet; the deposited pet puts its equipment back in the bag.
 */
export function depositPet(
  roster: SavedPet[],
  state: CampaignState,
  index: number,
): "deposited" | "invalid" | "full" | "last-living" {
  if (state.petBank.length >= petBankCapacity(state.petBankExpansionPurchases)) return "full";
  const pet = roster[index];
  if (!pet) return "invalid";
  if (!roster.some((other, at) => at !== index && living(other))) return "last-living";
  const deposited = roster.splice(index, 1)[0];
  deposited.heldEquipmentId = -1;
  state.petBank.push(deposited);
  renumber(roster);
  renumber(state.petBank);
  return "deposited";
}

/** JavaSE `PetManagementService.withdrawFromBank`: a full party (6) refuses first. */
export function withdrawPet(
  roster: SavedPet[],
  state: CampaignState,
  index: number,
): "withdrawn" | "invalid" | "roster-full" {
  if (roster.length >= 6) return "roster-full";
  if (!state.petBank[index]) return "invalid";
  roster.push(state.petBank.splice(index, 1)[0]);
  renumber(roster);
  renumber(state.petBank);
  return "withdrawn";
}

export function releaseBankPet(
  state: CampaignState,
  index: number,
  protectedPet: (pet: SavedPet) => boolean,
): "released" | "invalid" | "protected" {
  const pet = state.petBank[index];
  if (!pet) return "invalid";
  if (protectedPet(pet)) return "protected";
  state.petBank.splice(index, 1);
  renumber(state.petBank);
  return "released";
}

export type DailyBadgeStatus = { available: boolean; remainingMillis: number; rollback: boolean };
export function dailyBadgeStatus(last: number, now: number): DailyBadgeStatus {
  const current = Math.max(0, now),
    previous = Math.max(0, last);
  if (previous <= 0) return { available: true, remainingMillis: 0, rollback: false };
  if (current < previous) return { available: false, remainingMillis: 86_400_000, rollback: true };
  const currentDay = new Date(current),
    previousDay = new Date(previous),
    same =
      currentDay.getFullYear() === previousDay.getFullYear() &&
      currentDay.getMonth() === previousDay.getMonth() &&
      currentDay.getDate() === previousDay.getDate();
  if (!same) return { available: true, remainingMillis: 0, rollback: false };
  const reset = new Date(currentDay);
  reset.setHours(24, 0, 0, 0);
  return {
    available: false,
    remainingMillis: Math.max(0, reset.getTime() - current),
    rollback: false,
  };
}

export function claimDailyBadges(
  state: CampaignState,
  currency: { badges: number },
  now: number,
): DailyBadgeStatus & { granted: boolean } {
  const status = dailyBadgeStatus(state.dailyBadgeLastClaimEpochMillis, now);
  if (!status.available) return { ...status, granted: false };
  currency.badges += 20;
  state.dailyBadgeLastClaimEpochMillis = Math.max(1, now);
  return { ...status, granted: true };
}

// The charm craft/upgrade/equip transaction lives in `game/charm/RainbowCharms.ts` (JavaSE
// `RainbowCharmService`, recipes baked by `ExportWebRainbowCharms`); rides in `game/ride/RideSystem.ts`.
