import type { SavedPet } from "../../persistence/save/GameSave";

export const SAFARI_FEE = 20;
export const SAFARI_BALLS = 30;
export const SAFARI_SPECIES = [
  { id: 29, level: 30, weight: 45, catchRate: 2500 },
  { id: 46, level: 30, weight: 45, catchRate: 1800 },
  { id: 30, level: 30, weight: 45, catchRate: 2500 },
  { id: 54, level: 30, weight: 45, catchRate: 1800 },
  { id: 86, level: 30, weight: 45, catchRate: 1000 },
  { id: 5, level: 30, weight: 45, catchRate: 1200 },
  { id: 74, level: 30, weight: 45, catchRate: 1800 },
  { id: 45, level: 30, weight: 45, catchRate: 1800 },
  { id: 273, level: 40, weight: 8, catchRate: 500 },
  { id: 272, level: 40, weight: 8, catchRate: 500 },
  { id: 271, level: 40, weight: 8, catchRate: 500 },
  { id: 270, level: 40, weight: 8, catchRate: 500 },
  { id: 269, level: 40, weight: 8, catchRate: 500 },
] as const;

export type SafariAction = "ball" | "bait" | "rock" | "run";
export type SafariEncounter = {
  pet: SavedPet;
  effect: "neutral" | "bait" | "rock";
  turns: number;
};
export type SafariRun = {
  balls: number;
  x: number;
  y: number;
  direction: number;
  steps: number;
  seed: number;
  encounter: SafariEncounter | null;
};
export type SafariMap = {
  width: number;
  height: number;
  tileSize: number;
  columns: number;
  blocked: number[];
  spawn: number[];
  exitTiles: number[];
  objects: { atlas: number; source: number[]; x: number; y: number; footY: number }[];
  gate: { x: number; y: number; footY: number };
  water: {
    x: number;
    y: number;
    width: number;
    height: number;
    frameCount: number;
    frameMs: number;
  };
  sources: { id: number }[];
};

/** The seed belongs to the checkpoint so reopening a run preserves its next roll. */
export function safariRandom(run: SafariRun, bound: number): number {
  // Rejection sampling avoids modulo bias in encounter and capture rolls.
  const limit = Math.floor(0x100000000 / bound) * bound;
  do {
    run.seed = (Math.imul(run.seed, 1664525) + 1013904223) >>> 0;
  } while (run.seed >= limit);
  return run.seed % bound;
}

export function pickSafariPet(roll: number) {
  for (const pet of SAFARI_SPECIES) {
    if (roll < pet.weight) return pet;
    roll -= pet.weight;
  }
  throw new RangeError("Safari encounter roll must be between 0 and 399");
}

export function safariPassable(map: SafariMap, x: number, y: number): boolean {
  return (
    x >= 0 &&
    x < map.width &&
    y >= 0 &&
    y < map.height &&
    map.blocked[Math.floor(y / map.tileSize) * map.columns + Math.floor(x / map.tileSize)] === 0
  );
}

export function resolveSafariTurn(
  encounter: SafariEncounter,
  action: SafariAction,
  speed: number,
  random: (bound: number) => number,
): "caught" | "fled" | "stay" | "run" {
  if (action === "run") return "run";
  if (action === "bait" || action === "rock") {
    if (encounter.effect !== "neutral" && encounter.effect !== action) {
      encounter.effect = "neutral";
      encounter.turns = 0;
    } else {
      encounter.effect = action;
      encounter.turns = Math.min(255, encounter.turns + 1 + random(5));
    }
  }
  const factor = encounter.effect === "bait" ? 0.5 : encounter.effect === "rock" ? 2 : 1;
  const species = SAFARI_SPECIES.find((row) => row.id === encounter.pet.speciesId);
  if (!species) throw new Error("Unknown Safari species");
  if (action === "ball" && random(10000) < Math.min(3380, species.catchRate * factor))
    return "caught";
  if (random(256) < Math.min(256, Math.max(0, Math.floor(speed * 2 * factor)))) return "fled";
  encounter.turns = Math.max(0, encounter.turns - 1);
  if (encounter.turns === 0) encounter.effect = "neutral";
  return "stay";
}
