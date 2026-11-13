import { sha256Hex } from "../battle/ai/Sha256Hex";
import type { MetaSystemsDocument } from "../story/GameAssets";

export const FASHION_PROFILE_VERSION = "unified-fashion-economy-v1";
export const FASHION_POOL_VERSION = "FASH-POOL-SOURCE-V1";

export type FashionEconomyState = {
  profileVersion: string;
  poolVersion: string;
  blindBagCount: number;
  fragmentCount: number;
  /** Signed Java `long`, encoded as text so JSON never loses low bits. */
  drawSeed: string;
  drawIndex: number;
};

export type FashionDraw = {
  key: string;
  tier: MetaSystemsDocument["fashion"]["economy"]["tiers"][number];
};

export function defaultFashionEconomyState(seed?: bigint): FashionEconomyState {
  let value = seed;
  if (value === undefined) {
    const words = new Uint32Array(2);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(words);
    else {
      words[0] = Date.now() >>> 0;
      words[1] = Math.trunc(performance.now?.() ?? 0) >>> 0;
    }
    value = BigInt.asIntN(64, (BigInt(words[0]) << 32n) | BigInt(words[1]));
  }
  return {
    profileVersion: FASHION_PROFILE_VERSION,
    poolVersion: FASHION_POOL_VERSION,
    blindBagCount: 0,
    fragmentCount: 0,
    drawSeed: BigInt.asIntN(64, value).toString(),
    drawIndex: 0,
  };
}

function bounded(state: FashionEconomyState, lane: string, bound: number): number {
  const material = `fashion-draw-v1\u0000${state.poolVersion}\u0000${state.drawSeed}\u0000${state.drawIndex}\u0000${lane}`;
  const digest = sha256Hex(material);
  return Number(BigInt(`0x${digest.slice(0, 16)}`) % BigInt(bound));
}

export function previewFashionDraw(
  catalog: MetaSystemsDocument["fashion"]["economy"],
  state: FashionEconomyState,
): FashionDraw {
  const roll = bounded(state, "tier", 10_000);
  let boundary = 0,
    tier = catalog.tiers[0];
  for (const candidate of catalog.tiers) {
    boundary += candidate.probabilityBps;
    if (roll < boundary) {
      tier = candidate;
      break;
    }
  }
  if (!tier) throw new Error("Fashion economy has no tiers");
  const entries = catalog.entries.filter((entry) => entry.tier === tier.code);
  const entry = entries[bounded(state, `within-tier:${tier.code}`, entries.length)];
  if (!entry) throw new Error(`Fashion tier ${tier.code} has no entries`);
  return { key: entry.key, tier };
}

export type FashionOpenResult =
  | { outcome: "no-bag" }
  | { outcome: "fragment-full" }
  | { outcome: "new" | "duplicate"; draw: FashionDraw; fragmentDelta: number };

export function openFashionBag(
  catalog: MetaSystemsDocument["fashion"]["economy"],
  state: FashionEconomyState,
  owned: string[],
): FashionOpenResult {
  if (state.blindBagCount <= 0) return { outcome: "no-bag" };
  const draw = previewFashionDraw(catalog, state),
    duplicate = owned.includes(draw.key),
    fragmentDelta = duplicate ? draw.tier.duplicateFragments : 0;
  if (state.fragmentCount + fragmentDelta > catalog.fragmentCapacity)
    return { outcome: "fragment-full" };
  state.blindBagCount--;
  state.drawIndex++;
  state.fragmentCount += fragmentDelta;
  if (!duplicate) owned.push(draw.key);
  return { outcome: duplicate ? "duplicate" : "new", draw, fragmentDelta };
}

export function buyFashionBags(
  catalog: MetaSystemsDocument["fashion"]["economy"],
  state: FashionEconomyState,
  currency: { money: number },
  quantity: number,
): "purchased" | "full" | "insufficient" {
  if (quantity < 1 || state.blindBagCount + quantity > catalog.bagCapacity) return "full";
  const total = quantity * catalog.bagPrice;
  if (currency.money < total) return "insufficient";
  currency.money -= total;
  state.blindBagCount += quantity;
  return "purchased";
}

export function exchangeFashion(
  catalog: MetaSystemsDocument["fashion"]["economy"],
  state: FashionEconomyState,
  owned: string[],
  key: string,
): "exchanged" | "owned" | "insufficient" | "unknown" {
  const entry = catalog.entries.find((row) => row.key === key),
    tier = entry && catalog.tiers.find((row) => row.code === entry.tier);
  if (!entry || !tier) return "unknown";
  if (owned.includes(key)) return "owned";
  if (state.fragmentCount < tier.exchangeFragments) return "insufficient";
  state.fragmentCount -= tier.exchangeFragments;
  owned.push(key);
  return "exchanged";
}
