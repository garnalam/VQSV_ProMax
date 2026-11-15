import type { SavedPet } from "../../persistence/save/GameSave";
import type { PetCoreStats } from "../battle/PetStatCalculator";
import { rematchDayKey } from "./RegionalChallenges";

export type TowerFloor = {
  floor: number;
  level: number;
  quality: number;
  double: boolean;
  boss: boolean;
  theme: string;
  factors: [number, number, number, number];
  team: number[];
};

export type TowerPetSpec = {
  id: number;
  name: string;
  role: string;
  grants: { id: number; level: number; signature: boolean }[];
};

export type TowerContent = {
  version: number;
  rosterRevision: number;
  floors: TowerFloor[];
  pets: Record<string, TowerPetSpec>;
};

type TowerReward = { hearts: number; fragments: number };
type TowerResult = TowerReward & { floor: number; won: boolean; sweep?: boolean };
export type TowerState = {
  highest: number;
  fragments: number;
  hearts: number;
  day: number;
  claims: number[];
  repeats: number;
  sweeps: number;
  last?: TowerResult;
};

export const TOWER_FLOORS = 200;
export const TOWER_RANKING_SIZE = 10;
export type TowerRankingEntry = { username: string; highest: number };
export const TOWER_BOND_LIMIT = 255;
export const HEART_FRAGMENTS = 20;
const REPEAT_LIMIT = 30;
const SWEEP_PRICES = [0, 20, 50, 100, 200, 1000];

export const createTowerState = (): TowerState => ({
  highest: 0,
  fragments: 0,
  hearts: 0,
  day: 0,
  claims: [],
  repeats: 0,
  sweeps: 0,
});

const validFloor = (floor: number) =>
  Number.isInteger(floor) && floor >= 1 && floor <= TOWER_FLOORS;

export function towerCanChallenge(state: TowerState, floor: number): boolean {
  return validFloor(floor) && floor <= state.highest + 1;
}

export const towerFloorReward = (floor: number): TowerReward =>
  floor % 5 === 0 ? { hearts: 1, fragments: 0 } : { hearts: 0, fragments: 2 };

const lastGroup = (state: TowerState) => Math.floor(state.highest / 5) * 5;

function dailyLedger(state: TowerState, now: number) {
  const today = rematchDayKey(now);
  return today > state.day
    ? { day: today, claims: [], repeats: 0, sweeps: 0 }
    : { day: state.day, claims: state.claims, repeats: state.repeats, sweeps: state.sweeps };
}

export function towerFloorStatus(state: TowerState, floor: number, now: number) {
  if (!towerCanChallenge(state, floor)) return "locked";
  if (floor === state.highest + 1) return "first";
  const end = lastGroup(state),
    daily = dailyLedger(state, now);
  return floor >= Math.max(1, end - 29) &&
    floor <= end &&
    daily.repeats < REPEAT_LIMIT &&
    !daily.claims.includes(floor)
    ? "reward"
    : "practice";
}

export function finishTowerBattle(
  state: TowerState,
  floor: number,
  won: boolean,
  now: number,
): void {
  if (!towerCanChallenge(state, floor)) return;
  const status = towerFloorStatus(state, floor, now);
  Object.assign(state, dailyLedger(state, now));
  const prize =
    won && (status === "first" || status === "reward")
      ? towerFloorReward(floor)
      : { hearts: 0, fragments: 0 };
  if (won && status === "first") state.highest = floor;
  if (won && status === "reward") state.repeats++;
  if (prize.hearts || prize.fragments) {
    state.claims.push(floor);
    state.hearts += prize.hearts;
    state.fragments += prize.fragments;
  }
  state.last = { floor, won, ...prize };
}

export function towerSweepOffer(state: TowerState, now: number) {
  const daily = dailyLedger(state, now),
    cost = SWEEP_PRICES[daily.sweeps] ?? null,
    floors: number[] = [];
  const offer = { used: daily.sweeps, limit: SWEEP_PRICES.length, cost, floors, end: 0 };
  if (cost === null || daily.repeats >= REPEAT_LIMIT) return offer;
  const highestGroup = lastGroup(state),
    oldestGroup = Math.max(5, highestGroup - 25);
  for (let end = highestGroup; end >= oldestGroup; end -= 5) {
    for (let floor = end - 4; floor <= end && floors.length + daily.repeats < REPEAT_LIMIT; floor++)
      if (!daily.claims.includes(floor)) floors.push(floor);
    if (floors.length) return { ...offer, end };
  }
  return offer;
}

export function sweepTower(
  state: TowerState,
  wallet: { badges: number },
  now: number,
): string | null {
  const offer = towerSweepOffer(state, now);
  if (offer.cost === null) return "Đã dùng hết 6 lượt quét hôm nay.";
  if (state.highest < 5) return "Hãy vượt ít nhất 5 tầng để quét.";
  if (!offer.floors.length) return "Không còn tầng có thưởng hôm nay.";
  if (wallet.badges < offer.cost) return `Cần ${offer.cost} huy hiệu để quét.`;
  Object.assign(state, dailyLedger(state, now));
  wallet.badges -= offer.cost;
  state.sweeps++;
  let hearts = 0,
    fragments = 0;
  for (const floor of offer.floors) {
    const prize = towerFloorReward(floor);
    hearts += prize.hearts;
    fragments += prize.fragments;
  }
  state.claims.push(...offer.floors);
  state.repeats += offer.floors.length;
  state.hearts += hearts;
  state.fragments += fragments;
  state.last = { floor: offer.end, won: true, hearts, fragments, sweep: true };
  return null;
}

export function craftTowerHearts(state: TowerState, count: number): string | null {
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > Math.floor(state.fragments / HEART_FRAGMENTS)
  )
    return "Cần 20 mảnh cho mỗi trái tim.";
  state.fragments -= count * HEART_FRAGMENTS;
  state.hearts += count;
  return null;
}

export const towerBondStat = (value: number, points = 0) =>
  points ? Math.floor((value * (1000 + points)) / 1000) : value;

export function applyTowerBond(stats: PetCoreStats, points = 0): PetCoreStats {
  if (points === 0) return stats;
  return {
    ...stats,
    hp: towerBondStat(stats.hp, points),
    attack: towerBondStat(stats.attack, points),
    defense: towerBondStat(stats.defense, points),
  };
}

export function nurtureTowerPet(
  state: TowerState,
  pet: SavedPet,
  count: number,
  baseHp: number,
): string | null {
  const points = pet.towerBond ?? 0;
  if (!Number.isInteger(count) || count < 1 || points + count > TOWER_BOND_LIMIT)
    return "Mỗi pet bồi dưỡng tối đa 255 điểm.";
  if (state.hearts < count) return "Không đủ trái tim.";
  const oldMax = towerBondStat(baseHp, points),
    newMax = towerBondStat(baseHp, points + count);
  if ((pet.currentHp ?? oldMax) > 0)
    pet.currentHp = Math.min(newMax, (pet.currentHp ?? oldMax) + newMax - oldMax);
  pet.maxHp = newMax;
  pet.towerBond = points + count;
  state.hearts -= count;
  return null;
}
