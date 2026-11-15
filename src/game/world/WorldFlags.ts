// JavaSE parity: vqsv.progression.BadgeProgression plus the two source progression
// scalars the free world reads (game.c.f from op25 and game.e.G main task progress).
export const BADGE_COUNT = 17;
export const BADGE_LIET_HOA = 0;
export const BADGE_MOC_QUY = 1;
export const BADGE_DAI_DIA = 2;
export const BADGE_THUY_LAM = 3;
export const BADGE_HOA_PHONG = 4;
export const BADGE_U_LINH = 5;
export const BADGE_LOI_DIEN = 6;
export const BADGE_HOANG_KIM = 7;
export const BADGE_DIEN_MIEU = 8;
export const BADGE_TUYET_CAU_BAO_BAO = 9;
export const BADGE_BA_TUOC_CANH_CUT = 10;
export const BADGE_YEU_TAC_KINH = 11;
export const BADGE_TIEU_BACH_LONG = 12;
export const BADGE_LOI_QUANG_HAU = 13;
export const BADGE_HOA_MAN_DA_LA = 14;
export const BADGE_NHAM_NHAM_QUY = 15;
export const BADGE_DOC_BA_LOI = 16;

const SOURCE_ACHIEVED = 2;
const SOURCE_ENHANCED = 1;
const BASE_DARK_RADIUS = 50;
const LIET_HOA_DARK_RADIUS = 110;

export class BadgeProgression {
  private readonly achievedStates = new Array<number>(BADGE_COUNT).fill(0);
  private readonly enhancedStates = new Array<number>(BADGE_COUNT).fill(0);

  grant(badgeId: number): boolean {
    if (!this.valid(badgeId) || this.achieved(badgeId)) return false;
    this.achievedStates[badgeId] = SOURCE_ACHIEVED;
    return true;
  }

  enhance(badgeId: number): boolean {
    if (!this.enhanceable(badgeId) || !this.achieved(badgeId) || this.enhanced(badgeId))
      return false;
    this.enhancedStates[badgeId] = SOURCE_ENHANCED;
    return true;
  }

  achieved(badgeId: number): boolean {
    return this.valid(badgeId) && this.achievedStates[badgeId] === SOURCE_ACHIEVED;
  }

  enhanced(badgeId: number): boolean {
    return this.valid(badgeId) && this.enhancedStates[badgeId] === SOURCE_ENHANCED;
  }

  goldenTier(): 0 | 1 | 2 {
    return !this.achieved(BADGE_HOANG_KIM) ? 0 : this.enhanced(BADGE_HOANG_KIM) ? 2 : 1;
  }

  goldenPartyExperiencePercent(): number {
    return this.goldenTier() > 0 ? 30 : 0;
  }

  upgradeGolden(): boolean {
    if (this.goldenTier() !== 1) return false;
    this.enhancedStates[BADGE_HOANG_KIM] = SOURCE_ENHANCED;
    return true;
  }

  enhanceable(badgeId: number): boolean {
    return this.valid(badgeId) && badgeId < BADGE_DIEN_MIEU && badgeId !== BADGE_HOANG_KIM;
  }

  achievedSnapshot(): number[] {
    return [...this.achievedStates];
  }

  enhancedSnapshot(): number[] {
    return [...this.enhancedStates];
  }

  restore(achievedValues: number[] | undefined, enhancedValues: number[] | undefined): void {
    this.achievedStates.fill(0);
    this.enhancedStates.fill(0);
    for (let badgeId = 0; badgeId < BADGE_COUNT; badgeId++) {
      if (value(achievedValues, badgeId) > 0) this.achievedStates[badgeId] = SOURCE_ACHIEVED;
      if (
        (this.enhanceable(badgeId) || (badgeId === BADGE_HOANG_KIM && this.achieved(badgeId))) &&
        value(enhancedValues, badgeId) > 0
      )
        this.enhancedStates[badgeId] = SOURCE_ENHANCED;
    }
  }

  darknessVisibilityRadius(): number {
    return this.achieved(BADGE_LIET_HOA) ? LIET_HOA_DARK_RADIUS : BASE_DARK_RADIUS;
  }

  canClearTrees(): boolean {
    return this.achieved(BADGE_MOC_QUY);
  }

  canBreakRocks(): boolean {
    return this.achieved(BADGE_DAI_DIA);
  }

  canTraverseWater(): boolean {
    return this.achieved(BADGE_THUY_LAM);
  }

  canGrowSeeds(): boolean {
    return this.achieved(BADGE_U_LINH);
  }

  private valid(badgeId: number): boolean {
    return badgeId >= 0 && badgeId < BADGE_COUNT;
  }
}

const value = (values: number[] | undefined, index: number): number =>
  values !== undefined && index < values.length ? values[index] : 0;

export type WorldFlagsSnapshot = {
  badgesAchieved: number[];
  badgesEnhanced: number[];
  /** JavaSE `a.a.r[0..6][0]`; op66 writes state 3 to the selected feature. */
  sourceFeatures?: number[];
  /** JavaSE `game.e.D`: ids of invisible quest items granted/removed by op20. */
  sourceWorldFlags?: number[];
  /**
   * JavaSE `WorldState.openedChests`: string keys of persistent room objects. The obstacle owner
   * writes `tree:<scene>:<room>:<actor>` and `rock:<scene>:<room>:<actor>` for a cleared obstacle.
   */
  openedChests?: string[];
  /**
   * JavaSE `WorldState.actorPositionOverrides`: where a moving actor (behaviour 8/9/10 — Bích Lam
   * Cốc's pushed blocks) was left, as `[scene, room, actor, x, y]`.
   */
  actorPositions?: number[][];
  gameCf: boolean;
  mainTaskProgress: number;
  activeTask: string;
};

export class WorldFlags {
  readonly badges = new BadgeProgression();
  private readonly sourceFeatures = new Array<number>(7).fill(0);
  private readonly sourceWorldFlags = new Set<number>();
  private readonly openedChests = new Set<string>();
  private readonly actorPositions = new Map<string, { x: number; y: number }>();
  gameCf = false;
  mainTaskProgress = 0;
  activeTask = "";

  // VqsvSourceEffects.op25SetGameFlag: game.c.f is set only by arg0 == 0.
  op25SetGameFlag(arg0: number): void {
    this.gameCf = arg0 === 0;
  }

  op66UnlockFeature(feature: number): boolean {
    if (!Number.isInteger(feature) || feature < 0 || feature >= this.sourceFeatures.length)
      return false;
    this.sourceFeatures[feature] = 3;
    return true;
  }

  sourceFeatureState(feature: number): number {
    return this.sourceFeatures[feature] ?? 0;
  }

  mutateSourceWorldFlag(mode: number, flag: number): boolean {
    if (!Number.isInteger(flag) || flag < 0) return false;
    if (mode === 0) this.sourceWorldFlags.add(flag);
    else if (mode === 1) this.sourceWorldFlags.delete(flag);
    else return false;
    return true;
  }

  hasSourceWorldFlag(flag: number): boolean {
    return this.sourceWorldFlags.has(flag);
  }

  hasOpenedChest(key: string): boolean {
    return this.openedChests.has(key);
  }

  addOpenedChest(key: string): void {
    this.openedChests.add(key);
  }

  /** `WorldState.actorPosition`: a moving actor's remembered place, or undefined. */
  actorPosition(scene: number, room: number, actor: number): { x: number; y: number } | undefined {
    return this.actorPositions.get(`${scene}:${room}:${actor}`);
  }

  /** `rememberActorPosition` / `forgetActorPosition` (null forgets). */
  setActorPosition(
    scene: number,
    room: number,
    actor: number,
    at: { x: number; y: number } | null,
  ): void {
    const key = `${scene}:${room}:${actor}`;
    if (at) this.actorPositions.set(key, { x: at.x, y: at.y });
    else this.actorPositions.delete(key);
  }

  // VqsvGameRuntime.Scene.sourceSetMainTaskProgress.
  setMainTaskProgress(progress: number): void {
    this.mainTaskProgress = Math.max(0, progress);
  }

  terrainBadgeGatedOpen(): boolean {
    return this.badges.achieved(BADGE_THUY_LAM);
  }

  snapshot(): WorldFlagsSnapshot {
    return {
      badgesAchieved: this.badges.achievedSnapshot(),
      badgesEnhanced: this.badges.enhancedSnapshot(),
      sourceFeatures: [...this.sourceFeatures],
      sourceWorldFlags: [...this.sourceWorldFlags].sort((a, b) => a - b),
      openedChests: [...this.openedChests].sort(),
      actorPositions: [...this.actorPositions]
        .map(([key, at]) => [...key.split(":").map(Number), at.x, at.y])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]),
      gameCf: this.gameCf,
      mainTaskProgress: this.mainTaskProgress,
      activeTask: this.activeTask,
    };
  }

  restore(snapshot: WorldFlagsSnapshot | undefined): void {
    this.badges.restore(snapshot?.badgesAchieved, snapshot?.badgesEnhanced);
    this.sourceFeatures.fill(0);
    for (let feature = 0; feature < this.sourceFeatures.length; feature++)
      if (snapshot?.sourceFeatures?.[feature] === 3) this.sourceFeatures[feature] = 3;
    this.sourceWorldFlags.clear();
    for (const flag of snapshot?.sourceWorldFlags ?? [])
      if (Number.isInteger(flag) && flag >= 0) this.sourceWorldFlags.add(flag);
    this.openedChests.clear();
    for (const key of snapshot?.openedChests ?? [])
      if (typeof key === "string") this.openedChests.add(key);
    this.actorPositions.clear();
    for (const row of snapshot?.actorPositions ?? [])
      if (Array.isArray(row) && row.length === 5 && row.every(Number.isInteger))
        this.actorPositions.set(`${row[0]}:${row[1]}:${row[2]}`, { x: row[3], y: row[4] });
    this.gameCf = snapshot?.gameCf ?? false;
    this.mainTaskProgress = Math.max(0, snapshot?.mainTaskProgress ?? 0);
    this.activeTask = snapshot?.activeTask ?? "";
  }
}
