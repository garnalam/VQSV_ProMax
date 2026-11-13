/**
 * JavaSE `VqsvWharfTravelRuntime` (source `game.k.aP` → state 29 → `game.f` state 23): the boat trip a
 * wharf captain's route starts. The world fades to black (`startFade(2, 0)`: +17 alpha a tick), black
 * bars close in (`startBars(13, 5, 1, 240, 30, 30)`), the ocean (map 101) scrolls the boat (sprite
 * 343, animation `boatMode`) five pixels a tick off the far edge, the hero lands in the target room
 * without the map-loading screen, and the bars open again (`startBars(12, …)`) over the new room.
 *
 * Only the state lives here; the host owns the tick and the screen draws it.
 */
export type WharfRoute = {
  gate: { scene: number; room: number; group: number };
  target: { scene: number; room: number; x: number; y: number; direction: number };
  /** The boat's animation state and heading: 0 sails down the screen, 2 sails up. */
  boatMode: 0 | 2;
  label: string;
};

/** `VqsvWharfTravelRuntime.SOURCE_MAP` / `SOURCE_SPRITE` / `SOURCE_STEP`. */
export const WHARF_OCEAN_MAP = 101;
export const WHARF_BOAT_SPRITE = 343;
const STEP = 5,
  BAR_TICKS = 5,
  BAR_SIZE = 30,
  SCREEN_H = 320;

/** The nine-value source row as a route; a malformed row is a data bug, as in Java. */
export function wharfRoute(row: readonly number[], label: string): WharfRoute {
  if (row.length !== 9) throw new Error("Source wharf route must contain nine values");
  const [gateScene, gateRoom, gateGroup, scene, room, x, y, direction, boatMode] = row;
  if (boatMode !== 0 && boatMode !== 2) throw new Error("Source wharf boat mode must be 0 or 2");
  return {
    gate: { scene: gateScene, room: gateRoom, group: gateGroup },
    target: { scene, room, x, y, direction },
    boatMode,
    label,
  };
}

export class WharfTravel {
  /** 0 start, 1 fade-out, 2 bars closing, 3 sailing, 4 bars opening over the new room, 5 done. */
  phase = 0;
  fadeAlpha = 0;
  private fadeDone = false;
  /** `ScreenEffect` bars: 13 closing, 12 opening, -1 none. */
  barsMode = -1;
  barsProgress = 0;
  private barsDone = true;
  boatY: number;
  /** Ticks of the boat's looping animation (`boat.tick()` only runs while sailing). */
  boatTicks = 0;
  /** Set on the tick the boat leaves the screen: the host lands the hero, then calls `landed`. */
  landingDue = false;

  constructor(readonly route: WharfRoute) {
    this.boatY = route.boatMode === 0 ? 10 : SCREEN_H - 10;
  }

  get done(): boolean {
    return this.phase >= 5;
  }
  /** The ocean scene owns the frame from the bars closing until the hero has landed. */
  get oceanVisible(): boolean {
    return this.phase === 2 || this.phase === 3;
  }
  /** `ScreenEffect.renderOverlay`'s bar heights this frame (top and bottom are both 30 px). */
  get bars(): { top: number; bottom: number } | null {
    if (this.barsMode === 13) {
      const h = Math.trunc((this.barsProgress * BAR_SIZE) / BAR_TICKS);
      return { top: h, bottom: h };
    }
    if (this.barsMode === 12) {
      const h = BAR_SIZE - Math.trunc((this.barsProgress * BAR_SIZE) / BAR_TICKS);
      return { top: h, bottom: h };
    }
    return null;
  }

  /** One session tick: `ScreenEffect.tick` first, then the travel runtime's own step. */
  tick(): void {
    this.tickEffect();
    switch (this.phase) {
      case 0:
        this.fadeAlpha = 0;
        this.fadeDone = false;
        this.phase = 1;
        return;
      case 1:
        if (!this.fadeDone) return;
        this.fadeAlpha = 0;
        this.startBars(13);
        this.phase = 2;
        return;
      case 2:
        if (this.barsDone) this.phase = 3;
        return;
      case 3:
        if (this.landingDue) return;
        this.boatTicks++;
        this.boatY += this.route.boatMode === 0 ? STEP : -STEP;
        if (this.route.boatMode === 0 ? this.boatY <= SCREEN_H : this.boatY >= 0) return;
        this.landingDue = true;
        return;
      case 4:
        if (this.barsDone) this.phase = 5;
        return;
    }
  }
  /** The hero stands in the target room: open the bars over it. */
  landed(): void {
    this.landingDue = false;
    this.startBars(12);
    this.phase = 4;
  }

  private startBars(mode: 12 | 13): void {
    this.barsMode = mode;
    this.barsProgress = 0;
    this.barsDone = false;
  }
  private tickEffect(): void {
    if (!this.barsDone) {
      this.barsProgress++;
      if (this.barsProgress > BAR_TICKS) {
        this.barsProgress = BAR_TICKS;
        this.barsDone = true;
        if (this.barsMode === 12) this.barsMode = -1;
      }
    }
    // `startFade(2, 0)`: +17 a tick, done on the tick it passes 255.
    if (this.phase === 1 && !this.fadeDone) {
      this.fadeAlpha += 17;
      if (this.fadeAlpha > 255) {
        this.fadeAlpha = 255;
        this.fadeDone = true;
      }
    }
  }
}
