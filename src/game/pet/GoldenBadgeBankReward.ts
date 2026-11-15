import type { SavedPet } from "../../persistence/save/GameSave";
import { BADGE_HOANG_KIM, type BadgeProgression } from "../world/WorldFlags";
import type { PetCollection } from "./PetCollection";

/** Apply the collection reward once; the host persists the claim and adds the returned currency. */
export function claimCollectionReward(
  collection: PetCollection,
  badges: BadgeProgression,
  tier = collection.nextConvenienceRewardTier(),
): { claimed: boolean; badgeCurrency: number; goldenTier: number } {
  const claimed = collection.claimConvenienceReward(tier);
  if (claimed && tier >= 6) {
    badges.grant(BADGE_HOANG_KIM);
    if (tier === 7) badges.upgradeGolden();
  }
  return { claimed, badgeCurrency: claimed && tier < 6 ? 1 : 0, goldenTier: badges.goldenTier() };
}

/** `GoldenBadgeBankReward.raise`: preserve HP fraction with Java's half-up integer rounding. */
export function raiseGoldenBadgeBankPet(
  pet: SavedPet | null | undefined,
  maxHp: (pet: SavedPet) => number,
): boolean {
  if (!pet || pet.quality >= 5) return false;
  const oldMax = Math.max(1, maxHp(pet));
  const oldHp = Math.max(0, Math.min(oldMax, pet.currentHp ?? oldMax));
  pet.quality = 5;
  const newMax = Math.max(1, maxHp(pet));
  pet.maxHp = newMax;
  pet.currentHp =
    oldHp === 0
      ? 0
      : Math.max(
          1,
          Math.min(newMax, Math.trunc((oldHp * newMax + Math.trunc(oldMax / 2)) / oldMax)),
        );
  return true;
}

/** Call after loading a save, claiming rank two, and every insertion/mutation in the bank. */
export function synchronizeGoldenBadgeBankReward(
  badges: BadgeProgression,
  bank: readonly SavedPet[],
  maxHp: (pet: SavedPet) => number,
): number {
  if (badges.goldenTier() < 2) return 0;
  return bank.reduce((count, pet) => count + (raiseGoldenBadgeBankPet(pet, maxHp) ? 1 : 0), 0);
}
