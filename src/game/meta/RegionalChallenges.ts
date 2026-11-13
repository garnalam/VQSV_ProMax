import type { WorldFlags } from "../world/WorldFlags";

export type RegionalRematch = {
  region: number;
  name: string;
  descriptor: string;
  encounterKey: string;
  rewardMoney: number;
  title: string;
};

export type RematchUsage = { dayKey: number; usedCount: number };
export type RematchUsageState = Record<string, RematchUsage>;
export type RematchStatus = {
  available: boolean;
  usedCount: number;
  remainingUses: number;
  remainingMillis: number;
  clockRollback: boolean;
};

export const REMATCH_DAILY_LIMIT = 3;
const DAY_MILLIS = 86_400_000;
const UTC_PLUS_SEVEN_MILLIS = 7 * 60 * 60 * 1000;
// RegionalChallengeService.REGIONS, in its exact order.
const REGION_BADGES = [3, 1, 4, 0, 2, 6, 5] as const;

export const rematchDayKey = (epochMillis: number): number =>
  Math.floor((Math.max(0, epochMillis) + UTC_PLUS_SEVEN_MILLIS) / DAY_MILLIS);

export function rematchStatus(
  state: RematchUsageState,
  region: number,
  nowEpochMillis: number,
): RematchStatus {
  const now = Math.max(0, nowEpochMillis),
    currentDay = rematchDayKey(now),
    stored = state[String(region)];
  if (stored && stored.dayKey > currentDay)
    return {
      available: false,
      usedCount: stored.usedCount,
      remainingUses: 0,
      remainingMillis: DAY_MILLIS,
      clockRollback: true,
    };
  const usedCount = stored?.dayKey === currentDay ? stored.usedCount : 0,
    remainingMillis = Math.max(0, (currentDay + 1) * DAY_MILLIS - UTC_PLUS_SEVEN_MILLIS - now);
  return {
    available: usedCount < REMATCH_DAILY_LIMIT,
    usedCount,
    remainingUses: Math.max(0, REMATCH_DAILY_LIMIT - usedCount),
    remainingMillis,
    clockRollback: false,
  };
}

export function recordRematchStart(
  state: RematchUsageState,
  region: number,
  nowEpochMillis: number,
): RematchStatus {
  const before = rematchStatus(state, region, nowEpochMillis);
  if (!before.available) return before;
  const dayKey = rematchDayKey(nowEpochMillis),
    current = state[String(region)];
  state[String(region)] = {
    dayKey,
    usedCount: (current?.dayKey === dayKey ? current.usedCount : 0) + 1,
  };
  return rematchStatus(state, region, nowEpochMillis);
}

export const unlockedRematchRegions = (flags: WorldFlags): number[] =>
  REGION_BADGES.map((badge, region) => ({ badge, region }))
    .filter(({ badge }) => flags.badges.achieved(badge))
    .map(({ region }) => region);

function preferredRegion(scene: number, room: number, flags: WorldFlags): number {
  if (scene === 9) return [0, 1, 2, -1, 3, 4, 5, 6][room] ?? -1;
  if (scene === 1 || scene === 2) return 0;
  if (scene === 3) return 1;
  if (scene === 4) return 2;
  if (scene === 5 || scene === 8) return flags.badges.achieved(2) ? 4 : 3;
  if (scene === 6) return 3;
  if (scene === 7) return 6;
  if (scene === 10 || scene === 11) return 5;
  return -1;
}

export function resolveRematchRegion(scene: number, room: number, flags: WorldFlags): number {
  const unlocked = unlockedRematchRegions(flags),
    preferred = preferredRegion(scene, room, flags);
  return unlocked.includes(preferred) ? preferred : (unlocked.at(-1) ?? -1);
}

export function cycleRematchRegion(flags: WorldFlags, current: number, direction: number): number {
  const unlocked = unlockedRematchRegions(flags);
  if (unlocked.length === 0) return -1;
  const found = unlocked.indexOf(current),
    at = found < 0 ? 0 : found,
    step = direction < 0 ? -1 : 1;
  return unlocked[(at + step + unlocked.length) % unlocked.length];
}

export function displayRemaining(milliseconds: number): string {
  const minutes = Math.ceil(Math.max(0, milliseconds) / 60_000),
    hours = Math.floor(minutes / 60),
    rest = minutes % 60;
  return hours > 0 ? `${hours} giờ ${rest} phút` : `${rest} phút`;
}
