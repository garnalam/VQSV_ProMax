import type { SavedPet } from "../../persistence/save/GameSave";

/**
 * JavaSE `PetQualityUpgradeService` (Nâng phẩm): one atomic attempt to raise a pet's stars by
 * consuming one or two "phôi" pets of the same or an earlier form. Pure rules; the host gives the
 * form distances, the protected species and the HP maths.
 */

export const QUALITY_MIN = 1;
export const QUALITY_MAX = 5;
export const ROLL_BOUND = 10_000;
/**
 * Web only (owner, 2026-11-18): "Bùa bảo vệ nâng phẩm", a material sold for Lượng. While the bag
 * holds one, the Nâng phẩm screen puts it in its charm slot for an attempt that could lose a star;
 * that attempt uses it up, and a failure keeps the stars.
 */
export const QUALITY_GUARD_MATERIAL_ID = 7000;

/** `RATE_BASIS_POINTS[mainQuality][fodderQuality]`. */
const RATE_BASIS_POINTS: readonly (readonly number[])[] = [
  [],
  [0, 4_000],
  [0, 1_200, 3_000],
  [0, 300, 800, 1_800],
  [0, 50, 150, 500, 1_000],
];
const FORM_RATE_PERCENT = [100, 70, 45, 25];

export type QualityInvalidReason =
  | "INVALID_MAIN"
  | "INVALID_MAIN_QUALITY"
  | "ALREADY_MAX_QUALITY"
  | "NO_FODDER"
  | "TOO_MANY_FODDERS"
  | "INVALID_FODDER_REFERENCE"
  | "MAIN_SELECTED_AS_FODDER"
  | "ACTIVE_PET"
  | "PROTECTED_PET"
  | "DIFFERENT_SPECIES_OR_FORM"
  | "FODDER_QUALITY_TOO_HIGH"
  | "DUPLICATE_FODDER"
  | "FODDER_QUALITY_MISMATCH"
  | "UNSUPPORTED_RATE"
  | "INVALID_ROLL";

export type QualityRules = {
  /** `formDistance(main, fodder)` by species. */
  formDistance: (mainSpecies: number, fodderSpecies: number) => number;
  /** `sourceReleaseProtectedPet`. */
  protectedPet: (pet: SavedPet) => boolean;
  /** `PetSourceAdapter.maxHp`. */
  maxHp: (pet: SavedPet) => number;
};

export type QualityValidation =
  { valid: true; rateBasisPoints: number } | { valid: false; reason: QualityInvalidReason };

export type QualityAttempt =
  | { outcome: "INVALID"; reason: QualityInvalidReason }
  | {
      outcome: "SUCCESS" | "FAILURE";
      rateBasisPoints: number;
      roll: number;
      qualityBefore: number;
      qualityAfter: number;
      consumedCount: number;
      returnedEquipmentIds: number[];
      /** Web only: a guard charm was used, so a failure kept the stars. */
      guarded: boolean;
    };

const validQuality = (quality: number) =>
  Number.isInteger(quality) && quality >= QUALITY_MIN && quality <= QUALITY_MAX;

/** Failed attempts keep 1–3 stars; a 4-star main pet loses one, unless a guard charm protects it. */
export function qualityAfterFailure(before: number, guarded = false): number {
  return guarded || before < 4 ? before : Math.max(QUALITY_MIN, before - 1);
}
/** Web only: whether a failure at `quality` would lose a star, the only case a guard charm is used. */
export const qualityCanDrop = (quality: number) => qualityAfterFailure(quality) < quality;
export function rateBasisPoints(mainQuality: number, fodderQuality: number): number {
  if (
    mainQuality < QUALITY_MIN ||
    mainQuality >= QUALITY_MAX ||
    fodderQuality < QUALITY_MIN ||
    fodderQuality > mainQuality
  )
    return 0;
  return RATE_BASIS_POINTS[mainQuality][fodderQuality] ?? 0;
}
export function formRatePercent(distance: number): number {
  return distance < 0 ? 0 : FORM_RATE_PERCENT[Math.min(distance, FORM_RATE_PERCENT.length - 1)];
}
/** `contributionBasisPoints`: the same form keeps its rate, earlier forms give less. */
export function contributionBasisPoints(
  rules: QualityRules,
  main: SavedPet,
  fodder: SavedPet,
): number {
  const distance = rules.formDistance(main.speciesId, fodder.speciesId),
    base = rateBasisPoints(main.quality, fodder.quality);
  if (distance < 0 || base <= 0) return 0;
  return Math.max(1, Math.trunc((base * formRatePercent(distance) + 50) / 100));
}
/** `combinedRateBasisPoints`: two same-star phôi add up, capped at 100 %. */
export function combinedRateBasisPoints(
  rules: QualityRules,
  main: SavedPet,
  fodders: readonly SavedPet[],
): number {
  if (fodders.length === 0 || fodders.length > 2) return 0;
  let quality = -1,
    total = 0;
  for (const fodder of fodders) {
    if (quality >= 0 && quality !== fodder.quality) return 0;
    quality = fodder.quality;
    const rate = contributionBasisPoints(rules, main, fodder);
    if (rate <= 0) return 0;
    total += rate;
  }
  return Math.min(ROLL_BOUND, total);
}

export function validateQualityUpgrade(
  rules: QualityRules,
  roster: readonly SavedPet[],
  bank: readonly SavedPet[],
  main: SavedPet | undefined,
  fodders: readonly SavedPet[],
): QualityValidation {
  const invalid = (reason: QualityInvalidReason): QualityValidation => ({ valid: false, reason });
  if (!main || !roster.includes(main)) return invalid("INVALID_MAIN");
  if (!validQuality(main.quality)) return invalid("INVALID_MAIN_QUALITY");
  if (main.quality >= QUALITY_MAX) return invalid("ALREADY_MAX_QUALITY");
  if (fodders.length === 0) return invalid("NO_FODDER");
  if (fodders.length > 2) return invalid("TOO_MANY_FODDERS");
  let first: SavedPet | null = null;
  for (const fodder of fodders) {
    const rosterIndex = roster.indexOf(fodder),
      bankIndex = bank.indexOf(fodder);
    if (rosterIndex < 0 && bankIndex < 0) return invalid("INVALID_FODDER_REFERENCE");
    if (fodder === main) return invalid("MAIN_SELECTED_AS_FODDER");
    if (rosterIndex === 0) return invalid("ACTIVE_PET");
    if (rules.protectedPet(fodder)) return invalid("PROTECTED_PET");
    if (rules.formDistance(main.speciesId, fodder.speciesId) < 0)
      return invalid("DIFFERENT_SPECIES_OR_FORM");
    if (!validQuality(fodder.quality) || fodder.quality > main.quality)
      return invalid("FODDER_QUALITY_TOO_HIGH");
    if (first) {
      if (first === fodder) return invalid("DUPLICATE_FODDER");
      if (first.quality !== fodder.quality) return invalid("FODDER_QUALITY_MISMATCH");
    }
    first = fodder;
  }
  const rate = combinedRateBasisPoints(rules, main, fodders);
  return rate > 0 ? { valid: true, rateBasisPoints: rate } : invalid("UNSUPPORTED_RATE");
}

/**
 * `attempt`: `roll < rate` succeeds. The phôi leave the party (their equipment back to the bag),
 * the slots are renumbered, and the main pet keeps its share of HP at its new maximum.
 */
export function attemptQualityUpgrade(
  rules: QualityRules,
  roster: SavedPet[],
  bank: SavedPet[],
  equipment: number[],
  main: SavedPet,
  fodders: readonly SavedPet[],
  roll: number,
  guarded = false,
): QualityAttempt {
  const validation = validateQualityUpgrade(rules, roster, bank, main, fodders);
  if (!validation.valid) return { outcome: "INVALID", reason: validation.reason };
  if (roll < 0 || roll >= ROLL_BOUND) return { outcome: "INVALID", reason: "INVALID_ROLL" };
  const qualityBefore = main.quality,
    oldMaxHp = rules.maxHp(main),
    oldHp = Math.max(0, Math.min(oldMaxHp, main.currentHp ?? oldMaxHp)),
    succeeded = roll < validation.rateBasisPoints,
    qualityAfter = succeeded ? qualityBefore + 1 : qualityAfterFailure(qualityBefore, guarded),
    returnedEquipmentIds: number[] = [];
  for (const fodder of fodders) {
    const held = fodder.heldEquipmentId ?? -1;
    if (held >= 0) {
      if (!equipment.includes(held)) equipment.push(held);
      fodder.heldEquipmentId = -1;
      returnedEquipmentIds.push(held);
    }
  }
  for (const fodder of fodders) {
    const owner = roster.includes(fodder) ? roster : bank,
      index = owner.indexOf(fodder);
    if (index >= 0) owner.splice(index, 1);
  }
  roster.forEach((pet, slot) => (pet.slot = slot));
  bank.forEach((pet, slot) => (pet.slot = slot));
  main.quality = qualityAfter;
  const newMaxHp = rules.maxHp(main);
  main.currentHp =
    oldHp === 0
      ? 0
      : Math.max(
          1,
          Math.min(newMaxHp, Math.trunc((oldHp * newMaxHp + Math.trunc(oldMaxHp / 2)) / oldMaxHp)),
        );
  return {
    outcome: succeeded ? "SUCCESS" : "FAILURE",
    rateBasisPoints: validation.rateBasisPoints,
    roll,
    qualityBefore,
    qualityAfter,
    consumedCount: fodders.length,
    returnedEquipmentIds,
    guarded,
  };
}

/** `qualityUpgradeReason`. */
export function qualityReason(reason: QualityInvalidReason | null): string {
  switch (reason) {
    case null:
      return "Không thể nâng phẩm";
    case "ALREADY_MAX_QUALITY":
      return "Pet đã đạt phẩm tối đa";
    case "NO_FODDER":
      return "Hãy chọn ít nhất 1 Pet phôi";
    case "ACTIVE_PET":
      return "Pet đang xuất chiến không thể làm phôi";
    case "PROTECTED_PET":
      return "Pet bảo hộ không thể làm phôi";
    case "DIFFERENT_SPECIES_OR_FORM":
      return "Chỉ dùng cùng form hoặc form tiến hóa trước";
    case "FODDER_QUALITY_TOO_HIGH":
      return "Sao phôi không được cao hơn Pet chính";
    case "DUPLICATE_FODDER":
      return "Hai ô không thể dùng cùng một Pet";
    case "FODDER_QUALITY_MISMATCH":
      return "Hai Pet phôi phải cùng số sao";
    default:
      return "Không thể nâng phẩm với lựa chọn này";
  }
}
/** `qualityPercent`: "12%" or "12,5%". */
export function qualityPercent(basisPoints: number): string {
  return basisPoints % 100 === 0
    ? `${Math.trunc(basisPoints / 100)}%`
    : `${Math.trunc(basisPoints / 100)},${Math.trunc((basisPoints % 100) / 10)}%`;
}

/** `PetQualityUpgradeAssets`: frame timings in ms on the 66 ms original tick. */
export const QUALITY_FX = {
  starGlow: [90, 90, 90, 90, 90],
  energyCore: [110, 100, 100, 110, 130, 100, 180],
  energyStream: [90, 90, 100, 110, 130, 150],
  success: [80, 80, 90, 110, 90, 90, 80, 70, 70, 360],
  failure: [100, 100, 100, 110, 110, 100, 120, 260],
} as const;
const TICK_MS = 66;
const total = (durations: readonly number[]) =>
  durations.reduce((sum, d) => sum + Math.max(1, d), 0);
/** `frameIndex`. */
export function qualityFrameIndex(
  durations: readonly number[],
  tick: number,
  loop: boolean,
): number {
  const totalMs = total(durations);
  if (totalMs <= 0) return 0;
  const elapsed = Math.max(0, tick) * TICK_MS,
    at = loop ? elapsed % totalMs : Math.min(totalMs - 1, elapsed);
  let cursor = 0;
  for (let i = 0; i < durations.length; i++) {
    cursor += Math.max(1, durations[i]);
    if (at < cursor) return i;
  }
  return durations.length - 1;
}
/** `durationTicks`. */
export function qualityDurationTicks(durations: readonly number[]): number {
  return Math.max(1, Math.trunc((total(durations) + TICK_MS - 1) / TICK_MS));
}
export const CORE_START_TICK = 4;
export const STREAM_START_TICK = 10;
/** `CHARGE_COMMIT_TICK`. */
export const CHARGE_COMMIT_TICK =
  Math.max(
    CORE_START_TICK + qualityDurationTicks(QUALITY_FX.energyCore),
    STREAM_START_TICK + qualityDurationTicks(QUALITY_FX.energyStream),
  ) + 5;
/** `resultDurationTicks`. */
export const resultDurationTicks = (success: boolean) =>
  qualityDurationTicks(success ? QUALITY_FX.success : QUALITY_FX.failure);
