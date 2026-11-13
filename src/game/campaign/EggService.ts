import type { SavedPet } from "../../persistence/save/GameSave";
import { sha256Hex } from "../battle/ai/Sha256Hex";
import type { CampaignState, EggCatalogRow } from "./CampaignSystems";

/**
 * JavaSE `EggProgression` + `EggService` + `EggDrawStream`: the one incubator, the hatch-boost item,
 * and the unified / V4 hatch transactions the bag's "Ap trung" row runs (`useEggHatchAction`).
 */
export type EggState = CampaignState["egg"];

/** `egg-pools.tsv` as `ExportWebCampaignSystems` bakes it: basis-point bands and tier pools. */
export type EggTierTable = { rates: number[]; species: number[][] };

/** `bagItems` id 14: "Ấp trứng nhanh" (`applyEggAccelerator(..., 14)`). */
export const EGG_ACCELERATOR_ID = 14;
const ROSTER_CAPACITY = 6;
const KNOWN_SPECIES = 39;

export const EGG_TEXT = {
  accelSuccess: "Thành công sử dụng, tranh thủ thời gian đi ấp trứng trứng sủng vật a!",
  accelWarning: "Không có trứng có thể ấp trứng",
  hatchSuccess: "Ấp trứng thành công",
  hatchNotReady: "Vẫn chưa thể ấp trứng",
  wrongActive: "Trứng này chưa được chọn để ấp.",
} as const;

/** `VqsvText.Battle.panelBagEggHatchResult`: the `openbox.ui` line after "Ấp trứng thành công". */
export function eggHatchResultText(petName: string, storage: number): string {
  if (storage === 0) return `Ấp trứng tìm được #2${petName}#0 để vào ba lô`;
  if (storage === 1) return `Ấp trứng tìm được #2${petName}#0 để vào ngân hàng`;
  return "Không có không gian, đã phóng sinh";
}

export const eggTarget = (egg: EggState) => (egg.type === 0 ? 10 : 30);
export const eggReady = (egg: EggState) => egg.progress >= eggTarget(egg);

/** `selectForIncubation`: changing the incubated tier restarts its progress. */
export function selectForIncubation(egg: EggState, itemId: number): boolean {
  if (itemId < 0) return false;
  if (egg.active && egg.activeEggItemId !== itemId) egg.progress = 0;
  egg.active = true;
  egg.activeEggItemId = itemId;
  return true;
}

/** `EggProgression`'s seed: a `SecureRandom` long, written as Java prints it. */
export function ensureEggSeed(egg: EggState): string {
  if (egg.drawSeed === undefined) {
    const words = new Uint32Array(2);
    crypto.getRandomValues(words);
    egg.drawSeed = BigInt.asIntN(64, (BigInt(words[0]) << 32n) | BigInt(words[1])).toString();
  }
  return egg.drawSeed;
}

/** `EggDrawStream.bounded`: SHA-256 of the lane material, the first 8 bytes mod `bound`. */
export function eggDraw(seed: string, drawIndex: number, lane: string, bound: number): number {
  if (!lane || drawIndex < 0 || bound <= 0) throw new Error("Invalid egg draw request.");
  const digest = sha256Hex(`egg-draw-v1\u0000${seed}\u0000${drawIndex}\u0000${lane}`);
  return Number(BigInt(`0x${digest.slice(0, 16)}`) % BigInt(bound));
}

/** `previewDraw`: the cursor only moves in `completeHatch`. */
export function previewDraw(egg: EggState, lane: string, bound: number): number {
  return eggDraw(ensureEggSeed(egg), egg.drawIndex, lane, bound);
}

/** `completeHatch` with `rememberSpecies`: the type only grows for a species not met before. */
function completeHatch(egg: EggState, speciesId: number): void {
  const known = (egg.knownSpecies ??= new Array(KNOWN_SPECIES).fill(-1));
  let seen = false;
  for (let i = 0; i < egg.type && i < known.length; i++) if (known[i] === speciesId) seen = true;
  if (!seen) {
    if (egg.type < known.length) known[egg.type] = speciesId;
    egg.type = Math.min(egg.type + 1, known.length);
  }
  egg.drawIndex++;
  egg.progress = 0;
  egg.active = false;
  egg.activeEggItemId = 0;
}

/** `activateNextQueuedEgg`: the next owned egg of the same tier starts from zero. */
function activateNextQueuedEgg(egg: EggState, owned: number, itemId: number): void {
  if (owned <= 0) {
    egg.active = false;
    egg.activeEggItemId = 0;
    return;
  }
  egg.progress = 0;
  egg.active = true;
  egg.activeEggItemId = itemId;
}

/** `EggService.accelerate` / `routeAcceleration`. */
export function accelerateEgg(
  egg: EggState,
  items: Record<string, number>,
): "not-available" | "missing" | "applied" {
  if (!egg.active || eggReady(egg)) return "not-available";
  const key = String(EGG_ACCELERATOR_ID);
  if ((items[key] ?? 0) < 1) return "missing";
  items[key]--;
  egg.progress = eggTarget(egg);
  return "applied";
}

/** One owned egg per entry of the bag's special list (`SpecialRewardState.stackCount`). */
export const eggCount = (specials: readonly number[], itemId: number) =>
  specials.reduce((n, id) => (id === itemId ? n + 1 : n), 0);

/** `availableEggRewardIds`: every egg kind the player owns, which item 14 can pick from. */
export function availableEggIds(specials: readonly number[], eggIds: readonly number[]): number[] {
  return eggIds.filter((id) => eggCount(specials, id) > 0);
}

export type HatchOutcome = "inactive" | "not-ready" | "creation-failed" | "hatched";
export type HatchResult = { outcome: HatchOutcome; speciesId: number; storage: number };
export type HatchContext = {
  egg: EggState;
  roster: SavedPet[];
  bank: SavedPet[];
  bankCapacity: number;
  collected: (speciesId: number) => boolean;
  /** `sourceHatchedPet`. */
  create: (speciesId: number) => SavedPet | undefined;
  /** The owned eggs: one is used up by a hatch. */
  specials: number[];
};

const storageResult = (c: HatchContext) =>
  c.roster.length < ROSTER_CAPACITY ? 0 : c.bank.length < Math.max(0, c.bankCapacity) ? 1 : 2;

const unowned = (pool: readonly number[], collected: (id: number) => boolean) =>
  pool.filter((id) => !collected(id));

/** The shared tail: place the pet, advance the draw cursor, use up the egg, queue the next one. */
function place(c: HatchContext, speciesId: number, storage: number): HatchResult {
  const pet = c.create(speciesId);
  if (!pet) return { outcome: "creation-failed", speciesId, storage };
  const into = storage === 0 ? c.roster : c.bank;
  pet.slot = into.length;
  into.push(pet);
  const itemId = c.egg.activeEggItemId;
  completeHatch(c.egg, speciesId);
  const at = c.specials.indexOf(itemId);
  if (at >= 0) {
    c.specials.splice(at, 1);
    activateNextQueuedEgg(c.egg, eggCount(c.specials, itemId), itemId);
  }
  return { outcome: "hatched", speciesId, storage };
}

/** `hatchUnified`: a 50/25/15/8/2-style quality band, then an unowned species of that band. */
export function hatchUnified(
  c: HatchContext,
  tiers: EggTierTable,
  divineEligible: boolean,
): HatchResult {
  const egg = c.egg;
  if (!egg.active) return { outcome: "inactive", speciesId: -1, storage: -1 };
  if (!eggReady(egg)) return { outcome: "not-ready", speciesId: -1, storage: -1 };
  const storage = storageResult(c);
  if (storage === 2) return { outcome: "creation-failed", speciesId: -1, storage };
  const bound = divineEligible ? 10_000 : 10_000 - tiers.rates[5],
    roll = previewDraw(egg, "egg.qualityTier", bound);
  let tier = 1;
  for (let t = 5, cursor = 0; t >= 1; t--) {
    if (t === 5 && !divineEligible) continue;
    cursor += tiers.rates[t];
    if (roll < cursor) {
      tier = t;
      break;
    }
  }
  const pool = tiers.species[tier] ?? [],
    preferred = unowned(pool, c.collected),
    candidates = preferred.length ? preferred : pool,
    speciesId = candidates[previewDraw(egg, "egg.species", candidates.length)];
  return place(c, speciesId, storage);
}

/** `hatchFromPool`: a V4 egg draws from its own fixed pool on its own lane. */
export function hatchFromPool(c: HatchContext, pool: readonly number[]): HatchResult {
  const egg = c.egg;
  if (!egg.active) return { outcome: "inactive", speciesId: -1, storage: -1 };
  if (!eggReady(egg)) return { outcome: "not-ready", speciesId: -1, storage: -1 };
  const storage = storageResult(c);
  if (storage === 2 || !pool.length) return { outcome: "creation-failed", speciesId: -1, storage };
  const preferred = unowned(pool, c.collected),
    candidates = preferred.length ? preferred : pool,
    speciesId =
      candidates[previewDraw(egg, `egg.v4.species.${egg.activeEggItemId}`, candidates.length)];
  return place(c, speciesId, storage);
}

/** Hatch the incubated egg the way its catalog row says. */
export function hatchEgg(c: HatchContext, egg: EggCatalogRow, tiers: EggTierTable): HatchResult {
  return egg.hatch === "pool" ? hatchFromPool(c, egg.pool ?? []) : hatchUnified(c, tiers, true);
}
