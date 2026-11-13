import { describe, expect, it } from "vitest";
import { WorldFlags } from "../world/WorldFlags";
import {
  cycleRematchRegion,
  recordRematchStart,
  rematchDayKey,
  rematchStatus,
  resolveRematchRegion,
} from "./RegionalChallenges";

describe("regional rematches", () => {
  it("resets at midnight UTC+7 and rejects a clock rollback", () => {
    const state = {};
    const now = Date.UTC(2026, 10, 8, 16, 59);
    expect(rematchDayKey(now)).not.toBe(rematchDayKey(now + 60_000));
    recordRematchStart(state, 0, now);
    expect(rematchStatus(state, 0, now).remainingUses).toBe(2);
    expect(rematchStatus(state, 0, now + 60_000).remainingUses).toBe(3);
    expect(rematchStatus(state, 0, now - 86_400_000).clockRollback).toBe(true);
  });

  it("allows exactly three starts per region and cycles unlocked gyms", () => {
    const state = {},
      flags = new WorldFlags(),
      now = Date.UTC(2026, 10, 8, 12);
    flags.badges.grant(3); // Bích Thủy
    flags.badges.grant(1); // Nguyên Mộc
    expect(resolveRematchRegion(3, 0, flags)).toBe(1);
    expect(cycleRematchRegion(flags, 1, 1)).toBe(0);
    for (let i = 0; i < 3; i++) recordRematchStart(state, 1, now);
    expect(rematchStatus(state, 1, now)).toMatchObject({ available: false, usedCount: 3 });
  });
});
