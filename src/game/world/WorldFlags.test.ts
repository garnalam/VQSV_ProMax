import { describe, expect, it } from "vitest";
import {
  BADGE_COUNT,
  BADGE_DIEN_MIEU,
  BADGE_HOANG_KIM,
  BADGE_LIET_HOA,
  BADGE_MOC_QUY,
  BADGE_THUY_LAM,
  BADGE_U_LINH,
  BADGE_DAI_DIA,
  WorldFlags,
} from "./WorldFlags";

describe("source world flags", () => {
  it("grants each badge once and reports the source abilities", () => {
    const flags = new WorldFlags();
    expect(flags.badges.achieved(BADGE_THUY_LAM)).toBe(false);
    expect(flags.badges.darknessVisibilityRadius()).toBe(50);
    expect(flags.badges.grant(BADGE_LIET_HOA)).toBe(true);
    expect(flags.badges.grant(BADGE_LIET_HOA)).toBe(false);
    expect(flags.badges.darknessVisibilityRadius()).toBe(110);
    expect(flags.badges.grant(BADGE_MOC_QUY)).toBe(true);
    expect(flags.badges.grant(BADGE_DAI_DIA)).toBe(true);
    expect(flags.badges.grant(BADGE_THUY_LAM)).toBe(true);
    expect(flags.badges.grant(BADGE_U_LINH)).toBe(true);
    expect(flags.badges.canClearTrees()).toBe(true);
    expect(flags.badges.canBreakRocks()).toBe(true);
    expect(flags.badges.canTraverseWater()).toBe(true);
    expect(flags.badges.canGrowSeeds()).toBe(true);
    expect(flags.terrainBadgeGatedOpen()).toBe(true);
  });

  it("rejects ids outside the seventeen source badge columns", () => {
    const flags = new WorldFlags();
    for (const badgeId of [-1, BADGE_COUNT, BADGE_COUNT + 1]) {
      expect(flags.badges.grant(badgeId)).toBe(false);
      expect(flags.badges.achieved(badgeId)).toBe(false);
      expect(flags.badges.enhance(badgeId)).toBe(false);
      expect(flags.badges.enhanceable(badgeId)).toBe(false);
    }
  });

  it("enhances only the pre-Dien-Mieu column except Hoang Kim", () => {
    const flags = new WorldFlags();
    for (let badgeId = 0; badgeId < BADGE_COUNT; badgeId++) flags.badges.grant(badgeId);
    expect(flags.badges.enhanceable(BADGE_DIEN_MIEU)).toBe(false);
    expect(flags.badges.enhanceable(BADGE_HOANG_KIM)).toBe(false);
    expect(flags.badges.enhance(BADGE_HOANG_KIM)).toBe(false);
    expect(flags.badges.enhance(0)).toBe(true);
    expect(flags.badges.enhance(0)).toBe(false);
    expect(flags.badges.enhanced(0)).toBe(true);
    expect(flags.badges.enhanced(1)).toBe(false);
    expect(flags.badges.grant(BADGE_DIEN_MIEU)).toBe(false);
  });

  it("requires an achieved badge before an enhancement is accepted", () => {
    const flags = new WorldFlags();
    expect(flags.badges.enhance(6)).toBe(false);
    flags.badges.grant(6);
    expect(flags.badges.enhance(6)).toBe(true);
  });

  it("mirrors op25 game.c.f and clamps the main task progress", () => {
    const flags = new WorldFlags();
    expect(flags.gameCf).toBe(false);
    flags.op25SetGameFlag(1);
    expect(flags.gameCf).toBe(false);
    flags.op25SetGameFlag(0);
    expect(flags.gameCf).toBe(true);
    flags.setMainTaskProgress(1);
    expect(flags.mainTaskProgress).toBe(1);
    flags.setMainTaskProgress(-3);
    expect(flags.mainTaskProgress).toBe(0);
  });

  it("persists the seven op66 source feature rows and rejects invalid ids", () => {
    const flags = new WorldFlags();
    expect(flags.op66UnlockFeature(1)).toBe(true);
    expect(flags.op66UnlockFeature(3)).toBe(true);
    expect(flags.op66UnlockFeature(5)).toBe(true);
    expect(flags.op66UnlockFeature(-1)).toBe(false);
    expect(flags.op66UnlockFeature(7)).toBe(false);
    const restored = new WorldFlags();
    restored.restore(flags.snapshot());
    expect(restored.sourceFeatureState(1)).toBe(3);
    expect(restored.sourceFeatureState(3)).toBe(3);
    expect(restored.sourceFeatureState(5)).toBe(3);
    expect(restored.sourceFeatureState(2)).toBe(0);
  });

  it("persists op20 quest items and removes only the requested id", () => {
    const flags = new WorldFlags();
    expect(flags.mutateSourceWorldFlag(0, 6)).toBe(true);
    expect(flags.mutateSourceWorldFlag(0, 11)).toBe(true);
    expect(flags.hasSourceWorldFlag(6)).toBe(true);
    expect(flags.mutateSourceWorldFlag(1, 6)).toBe(true);
    expect(flags.hasSourceWorldFlag(6)).toBe(false);
    expect(flags.hasSourceWorldFlag(11)).toBe(true);
    const restored = new WorldFlags();
    restored.restore(flags.snapshot());
    expect(restored.hasSourceWorldFlag(11)).toBe(true);
    expect(restored.hasSourceWorldFlag(6)).toBe(false);
  });

  it("round-trips badges and flags through a save snapshot", () => {
    const flags = new WorldFlags();
    flags.badges.grant(BADGE_THUY_LAM);
    flags.badges.grant(BADGE_U_LINH);
    flags.badges.enhance(BADGE_U_LINH);
    flags.badges.grant(BADGE_DIEN_MIEU);
    flags.op25SetGameFlag(0);
    flags.setMainTaskProgress(1);
    flags.activeTask = "BUNNY_CAPTURE";
    const snapshot = flags.snapshot();
    expect(snapshot.badgesAchieved[BADGE_THUY_LAM]).toBe(2);
    expect(snapshot.badgesEnhanced[BADGE_U_LINH]).toBe(1);
    expect(snapshot.gameCf).toBe(true);
    expect(snapshot.mainTaskProgress).toBe(1);
    expect(snapshot.activeTask).toBe("BUNNY_CAPTURE");

    const restored = new WorldFlags();
    restored.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
    expect(restored.terrainBadgeGatedOpen()).toBe(true);
    // DIEN_MIEU is not enhanceable, so its enhancement column stays empty.
    expect(restored.badges.enhanceable(BADGE_DIEN_MIEU)).toBe(false);
  });

  it("clears every badge when a save has no progression block", () => {
    const flags = new WorldFlags();
    flags.badges.grant(BADGE_THUY_LAM);
    flags.activeTask = "BUNNY_CAPTURE";
    flags.restore(undefined);
    expect(flags.badges.achievedSnapshot()).toEqual(new Array(BADGE_COUNT).fill(0));
    expect(flags.gameCf).toBe(false);
    expect(flags.mainTaskProgress).toBe(0);
    expect(flags.activeTask).toBe("");
  });
});
