/**
 * The health-and-shield bar: how one combatant's hp, maxHp and shield pool share the track.
 *
 * `VqsvBattleRenderState.UnitState` is the render-state owner of that split, and its two pixel
 * methods are the arithmetic: the whole bar is scaled by `maxHp + shieldHp` rather than by `maxHp`,
 * so planting a shield shrinks the red segment to make room for the blue one instead of pushing the
 * bar off its widget. `golden-shield-track.json` is the Java renderer rasterized over a grid of
 * triples and bar sizes, and every row of this file is graded against its pixels.
 */
export type ShieldTrackUnit = {
  hp: number;
  maxHp: number;
  shieldHp: number;
};

/**
 * `VqsvBattleRenderState.UnitState`'s constructor clamps, and the clamp is what the pixel methods
 * then read: a negative hp or pool cannot reach the bar, and a fainted unit has no shield at all.
 */
export function shieldTrackUnit(hp: number, maxHp: number, shieldHp: number): ShieldTrackUnit {
  const kept = Math.max(0, hp);
  return {
    hp: kept,
    maxHp: Math.max(0, maxHp),
    shieldHp: kept > 0 ? Math.max(0, shieldHp) : 0,
  };
}

/** `VqsvBattleRenderState.UnitState.redHpPixels`. */
export function redHpPixels(unit: ShieldTrackUnit, width: number): number {
  if (width <= 0 || unit.maxHp <= 0 || unit.hp <= 0) return 0;
  const capacity = unit.maxHp + unit.shieldHp;
  const red = Math.floor((Math.min(unit.hp, unit.maxHp) * width) / capacity);
  return unit.shieldHp > 0 && width > 1 ? Math.max(1, Math.min(width - 1, red)) : red;
}

/** `VqsvBattleRenderState.UnitState.blueShieldPixels`. */
export function blueShieldPixels(unit: ShieldTrackUnit, width: number): number {
  if (width <= 0 || unit.maxHp <= 0 || unit.shieldHp <= 0) return 0;
  const capacity = unit.maxHp + unit.shieldHp;
  const red = redHpPixels(unit, width);
  const filled = Math.floor(((Math.min(unit.hp, unit.maxHp) + unit.shieldHp) * width) / capacity);
  return Math.max(1, Math.min(width - red, filled - red));
}

/** One `fillRect` the track paints, in the order Java paints them. */
export type ShieldTrackRect = {
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * `VqsvBattleRenderer.drawShieldHealthTrack`, as the rectangle list it fills.
 *
 * Keeping the order matters more than keeping the shapes: the one-pixel highlight row is painted
 * over the segment body, and the depleted track is painted before it, so a port that reorders the
 * fills shows a different bar while getting every width right.
 */
export function shieldTrackRects(
  unit: ShieldTrackUnit,
  x: number,
  y: number,
  width: number,
  height: number,
): ShieldTrackRect[] {
  if (width < 3 || height < 3) return [];
  const inner = width - 2;
  const red = redHpPixels(unit, inner);
  const blue = blueShieldPixels(unit, inner);
  const rects: ShieldTrackRect[] = [
    { color: FRAME, x, y, width, height },
    { color: DEPLETED, x: x + 1, y: y + 1, width: inner, height: height - 2 },
  ];
  if (red > 0) {
    rects.push({ color: HEALTH_RED, x: x + 1, y: y + 1, width: red, height: height - 2 });
    rects.push({ color: HEALTH_HIGHLIGHT, x: x + 1, y: y + 1, width: red, height: 1 });
  }
  if (blue > 0) {
    rects.push({ color: SHIELD_BLUE, x: x + 1 + red, y: y + 1, width: blue, height: height - 2 });
    rects.push({ color: SHIELD_HIGHLIGHT, x: x + 1 + red, y: y + 1, width: blue, height: 1 });
  }
  return rects;
}

/** The two text shapes `drawShieldHealthWidget` chooses between. */
export type ShieldTrackText =
  | { mode: "combined"; value: string; color: string }
  | {
      mode: "split";
      hp: string;
      shield: string;
      fieldWidth: number;
      hpColor: string;
      shieldColor: string;
    };

/**
 * `VqsvBattleRenderer.drawShieldHealthWidget`'s branch and field width.
 *
 * With no shield the widget is the ordinary one-field `hp/maxHp`; with a shield the two numbers are
 * printed as separate clipped fields over the bar, so a big pool stays readable instead of rounding
 * into a percentage.
 */
export function shieldTrackText(unit: ShieldTrackUnit, barWidth: number): ShieldTrackText {
  if (unit.shieldHp <= 0) {
    return {
      mode: "combined",
      value: `${unit.hp}/${unit.maxHp}`,
      color: COMBINED_TEXT,
    };
  }
  return {
    mode: "split",
    hp: String(unit.hp),
    shield: `+${unit.shieldHp}`,
    fieldWidth: Math.max(1, Math.floor((barWidth - 4) / 2)),
    hpColor: HP_FIELD_TEXT,
    shieldColor: SHIELD_FIELD_TEXT,
  };
}

/** `VqsvBattleRenderer.HEALTH_RED`. */
export const HEALTH_RED = "#e95151";
/** The `0xE95151`-family highlight row the source paints over the top of the red segment. */
export const HEALTH_HIGHLIGHT = "#ff8980";
/** `VqsvBattleRenderer.SHIELD_BLUE`. */
export const SHIELD_BLUE = "#2b90f5";
/** The highlight row over the blue segment. */
export const SHIELD_HIGHLIGHT = "#80cfff";
/** The outer frame and the depleted track behind both segments. */
export const FRAME = "#0a121c";
export const DEPLETED = "#263849";
/** The three text colours `drawShieldHealthWidget` picks between. */
export const COMBINED_TEXT = "#ffb9ad";
export const HP_FIELD_TEXT = "#ffd0c5";
export const SHIELD_FIELD_TEXT = "#80d0ff";
