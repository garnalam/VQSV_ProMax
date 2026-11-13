import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GameData } from "../../data/GameData";
import type { GoldenShieldTrackTable } from "../../data/GameData";
import { Pack } from "../../pack/Pack";
import {
  blueShieldPixels,
  HEALTH_RED,
  redHpPixels,
  SHIELD_BLUE,
  shieldTrackRects,
  shieldTrackText,
  shieldTrackUnit,
  type ShieldTrackRect,
  type ShieldTrackText,
  type ShieldTrackUnit,
} from "./ShieldTrack";
import {
  BUFF_BANK,
  SHIELD_STATUS_ID,
  StatusEffects,
  StatusInstance,
  type StatusUnit,
} from "./StatusState";

const root = resolve(import.meta.dirname, "..", "..", "..");

/** A catalog edit standing in for a mistake a port could make, cleared once the rig is loaded. */
let mutation: ((file: string, json: unknown) => unknown) | undefined;

vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(root, "public", decodeURIComponent(input.replace(/^\//, "")));
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const value = mutation && file.endsWith(".json") ? mutation(file, parsed) : parsed;
  return { ok: true, status: 200, json: async () => value };
});

/**
 * The owners `golden-shield-track.json` grades, each one replaceable by a wrong port.
 *
 * The bar's arithmetic has no pack input to mutate: every literal in it is Java renderer code. So the
 * teeth here are re-implementations of that method, and each count below is the number of rows a real
 * run found a given mistake disagrees on.
 */
type Model = {
  unit: (hp: number, maxHp: number, asked: number) => ShieldTrackUnit;
  red: (unit: ShieldTrackUnit, width: number) => number;
  blue: (unit: ShieldTrackUnit, width: number) => number;
  rects: (unit: ShieldTrackUnit, width: number, height: number) => ShieldTrackRect[];
  text: (unit: ShieldTrackUnit, barWidth: number) => ShieldTrackText;
  /** `BattleUnit.shieldHp()`, read over the live status bank. */
  shieldHpOf: (unit: StatusUnit) => number;
};

const faithful: Model = {
  unit: shieldTrackUnit,
  red: redHpPixels,
  blue: blueShieldPixels,
  rects: (unit, width, height) => shieldTrackRects(unit, 0, 0, width, height),
  text: shieldTrackText,
  shieldHpOf: (unit) => unit.shieldHp(),
};

/** The inner width the probe reads the two segments at: the shipped 82 px bar minus its frame. */
const MEASURED_INNER = 80;

function hexToArgb(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}

/** One opaque colour, written the way the probe writes a pixel. */
function argb(hex: string): string {
  return `ff${hex.slice(1)}`;
}

/** One scanline compressed to `aarrggbb:runLength` pairs, left to right. */
function runs(row: string[]): string {
  const parts: string[] = [];
  let value = "";
  let count = 0;
  for (const pixel of row) {
    if (pixel === value) {
      count++;
    } else {
      if (count > 0) parts.push(`${value}:${count}`);
      value = pixel;
      count = 1;
    }
  }
  if (count > 0) parts.push(`${value}:${count}`);
  return parts.join(",");
}

/**
 * The image the probe rasterizes into, with the same rule: a zero or negative bar is painted into a
 * one-pixel canvas because Java cannot size a `BufferedImage` at 0, and a fill that leaves the canvas
 * is clipped instead of wrapping.
 */
function rasterize(width: number, height: number, rects: ShieldTrackRect[]): string[] {
  const columns = Math.max(1, width);
  const rows = Math.max(1, height);
  const canvas = Array.from({ length: rows }, () => new Array<string>(columns).fill("00000000"));
  for (const rect of rects) {
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        if (y >= 0 && y < rows && x >= 0 && x < columns) canvas[y][x] = argb(rect.color);
      }
    }
  }
  return canvas.map(runs);
}

/** `drawShieldHealthTrack`'s fill list, with the two behaviours a variant may get wrong. */
function fillList(
  segments: (unit: ShieldTrackUnit, inner: number) => [number, number],
  behaviour: { guard: boolean; highlight: boolean; blueAfterRed: boolean },
): (unit: ShieldTrackUnit, width: number, height: number) => ShieldTrackRect[] {
  return (unit, width, height) => {
    if (behaviour.guard && (width < 3 || height < 3)) return [];
    const inner = width - 2;
    const [red, blue] = segments(unit, inner);
    const blueX = behaviour.blueAfterRed ? 1 + red : 1;
    const rects: ShieldTrackRect[] = [
      { color: "#0a121c", x: 0, y: 0, width, height },
      { color: "#263849", x: 1, y: 1, width: inner, height: height - 2 },
    ];
    if (red > 0) {
      rects.push({ color: HEALTH_RED, x: 1, y: 1, width: red, height: height - 2 });
      if (behaviour.highlight) {
        rects.push({ color: "#ff8980", x: 1, y: 1, width: red, height: 1 });
      }
    }
    if (blue > 0) {
      rects.push({ color: SHIELD_BLUE, x: blueX, y: 1, width: blue, height: height - 2 });
      if (behaviour.highlight) {
        rects.push({ color: "#80cfff", x: blueX, y: 1, width: blue, height: 1 });
      }
    }
    return rects;
  };
}

/** The three choices `redHpPixels` and `blueShieldPixels` make, one per field. */
type SegmentRules = {
  /** Java scales the whole bar by `maxHp + shieldHp`; the pre-shield formula used `maxHp` alone. */
  capacity: (unit: ShieldTrackUnit) => number;
  /** Java truncates the product; a port that rounds moves the boundary on any uneven bar. */
  divide: (pixelsPerHp: number, capacity: number) => number;
  /** Java keeps both segments at least one pixel wide. */
  minimum: boolean;
};

/** The segment arithmetic, rebuilt from Java's shape so a variant can change exactly one rule. */
function segmentsBy(rules: SegmentRules) {
  return (unit: ShieldTrackUnit, inner: number): [number, number] => {
    const capacity = rules.capacity(unit);
    if (inner <= 0 || unit.maxHp <= 0 || capacity <= 0) return [0, 0];
    const keptHp = Math.min(unit.hp, unit.maxHp);
    const rawRed = unit.hp > 0 ? rules.divide(keptHp * inner, capacity) : 0;
    const red =
      unit.shieldHp > 0 && inner > 1
        ? Math.min(inner - 1, rules.minimum ? Math.max(1, rawRed) : rawRed)
        : rawRed;
    if (unit.shieldHp <= 0) return [red, 0];
    const filled = rules.divide((keptHp + unit.shieldHp) * inner, capacity);
    const rawBlue = filled - red;
    return [red, Math.min(inner - red, rules.minimum ? Math.max(1, rawBlue) : rawBlue)];
  };
}

/** `UnitState`'s constructor without the rule that a fainted unit carries no shield. */
function unclampedUnit(hp: number, maxHp: number, asked: number): ShieldTrackUnit {
  const kept = Math.max(0, hp);
  return { hp: kept, maxHp: Math.max(0, maxHp), shieldHp: Math.max(0, asked) };
}

/** `BattleUnit.shieldHp()` read straight off the status, alive or not. */
function poolIgnoresFaint(unit: StatusUnit): number {
  const shield = unit.statuses.get(BUFF_BANK, SHIELD_STATUS_ID);
  return shield ? Math.max(0, shield.primaryValue) : 0;
}

/** `BattleUnit.shieldHp()` without the clamp that hides a negative pool. */
function poolSaysRawValue(unit: StatusUnit): number {
  const shield = unit.statuses.get(BUFF_BANK, SHIELD_STATUS_ID);
  return !unit.alive() || !shield ? 0 : shield.primaryValue;
}

/** `ProbeWebBattleMath.SHIELD_STATES`: the triples the bar is rasterized for. */
type StateRow = GoldenShieldTrackTable["states"][number];
/** One `BattleUnit.shieldHp()` row from the probe's walk. */
type UnitRow = GoldenShieldTrackTable["unitShield"][number];

/**
 * The health-and-shield bar, graded on Java's own pixels.
 *
 * `VqsvBattleRenderer.drawShieldHealthTrack` is the only owner of how hp, maxHp and shieldHp share the
 * track, and `golden-shield-track.json` is that method rasterized over thirteen triples, three widths,
 * two heights and four sizes it refuses, each scanline written back as colour runs. `unitShield` is
 * `BattleUnit.shieldHp()` walked over a planted Khiên before and after absorption and after the death
 * pass, because that getter answers for a fainted pet in a way the status itself does not.
 */
class Rig {
  private constructor(
    readonly effects: StatusEffects,
    readonly golden: GoldenShieldTrackTable,
  ) {}

  static async load(mutate?: (file: string, json: unknown) => unknown): Promise<Rig> {
    mutation = mutate;
    try {
      const data = new GameData(await Pack.load());
      const effects = await StatusEffects.load(data);
      return new Rig(effects, await data.goldenShieldTrack());
    } finally {
      mutation = undefined;
    }
  }

  /** Every disagreement between this model and the Java rows, one string per answer. */
  gradeAll(model: Model): string[] {
    const found: string[] = [];
    const ask = (key: string, actual: unknown, expected: unknown): void => {
      if (actual !== expected) {
        found.push(`${key}: got ${String(actual)}, want ${String(expected)}`);
      }
    };

    // The two colours the probe reflects out of the renderer's own constants.
    ask("colors.healthRed", hexToArgb(HEALTH_RED), this.golden.colors.healthRed);
    ask("colors.shieldBlue", hexToArgb(SHIELD_BLUE), this.golden.colors.shieldBlue);

    for (const [index, row] of this.golden.states.entries()) {
      const unit = model.unit(row.hp, row.maxHp, row.asked);
      ask(`state ${index}.shieldHp`, unit.shieldHp, row.shieldHp);
      ask(`state ${index}.red`, model.red(unit, MEASURED_INNER), row.red);
      ask(`state ${index}.blue`, model.blue(unit, MEASURED_INNER), row.blue);
      // Java prints one `hp/maxHp` field while the bar carries no shield and two clipped fields once it
      // does, so the branch is graded on Java's own clamped pool.
      const mode = row.shieldHp <= 0 ? "combined" : "split";
      ask(`state ${index}.text`, model.text(unit, MEASURED_INNER + 2).mode, mode);
    }

    for (const section of ["tracks", "guard"] as const) {
      for (const [index, row] of this.golden[section].entries()) {
        const state: StateRow = this.golden.states[row.state];
        const unit = model.unit(state.hp, state.maxHp, state.asked);
        const inner = row.width - 2;
        ask(`${section} ${index}.red`, model.red(unit, inner), row.red);
        ask(`${section} ${index}.blue`, model.blue(unit, inner), row.blue);
        ask(
          `${section} ${index}.pixels`,
          rasterize(row.width, row.height, model.rects(unit, row.width, row.height)).join("|"),
          row.pixels.join("|"),
        );
      }
    }

    for (const [index, row] of this.shieldRows(model).entries()) {
      for (const key of ["hp", "maxHp", "alive", "planted", "pool", "shieldHp"] as const) {
        ask(`unitShield ${row.label}.${key}`, row[key], this.golden.unitShield[index][key]);
      }
    }
    return found;
  }

  /** `ProbeWebBattleMath.shieldProbeUnit`: the 1000/100/100/100 unit the game's own shield test builds. */
  private probeUnit(hp: number): StatusUnit {
    const unit = this.effects.unit({
      speciesId: 280,
      ownerSide: 0,
      formationSlot: 0,
      base: { hp: 1000, attack: 100, defense: 100, speed: 100 },
    });
    unit.setHp(hp);
    return unit;
  }

  /** `ProbeWebBattleMath.shieldInstance`: a bank-0 id-15 Khiên carrying this pool. */
  private plant(unit: StatusUnit, pool: number): void {
    const definition = this.effects.catalog.definition(BUFF_BANK, SHIELD_STATUS_ID);
    if (!definition) throw new Error("the catalog has no Khiên at bank 0 id 15");
    unit.statuses.put(new StatusInstance(definition, 3, 0, pool, 0, 1, 0, 0, 3000, 0));
  }

  /** `ProbeWebBattleMath.shieldUnitRows`, replayed through this model's getter. */
  private shieldRows(model: Model): UnitRow[] {
    const rows: UnitRow[] = [];
    const record = (label: string, unit: StatusUnit): void => {
      const shield = unit.statuses.get(BUFF_BANK, SHIELD_STATUS_ID);
      rows.push({
        label,
        hp: unit.hp(),
        maxHp: unit.maxHp(),
        alive: unit.alive(),
        planted: shield !== undefined,
        pool: shield ? shield.primaryValue : 0,
        shieldHp: model.shieldHpOf(unit),
      });
    };

    record("noShield", this.probeUnit(1000));
    const shielded = this.probeUnit(1000);
    this.plant(shielded, 1200);
    record("planted", shielded);
    shielded.damage(500);
    record("partialAbsorb", shielded);
    shielded.damage(700);
    record("shieldSpent", shielded);
    shielded.damage(250);
    record("unshieldedHit", shielded);

    const overflowing = this.probeUnit(1000);
    this.plant(overflowing, 200);
    overflowing.damage(350);
    record("absorbOverflow", overflowing);
    overflowing.damage(850);
    record("faintedByDamage", overflowing);
    this.plant(overflowing, 500);
    record("shieldOnFaintedUnit", overflowing);

    const zero = this.probeUnit(1000);
    this.plant(zero, 0);
    record("plantedZero", zero);
    const negative = this.probeUnit(1000);
    this.plant(negative, -50);
    record("plantedNegative", negative);
    const dead = this.probeUnit(0);
    this.plant(dead, 400);
    record("shieldOnDeadHp", dead);
    return rows;
  }
}

/** A model with the given segment rules substituted into both pixel methods and the fill list. */
function withSegments(rules: SegmentRules, behaviour?: Record<string, boolean>): Model {
  const segments = segmentsBy(rules);
  return {
    ...faithful,
    red: (unit, inner) => segments(unit, inner)[0],
    blue: (unit, inner) => segments(unit, inner)[1],
    rects: fillList(segments, {
      guard: true,
      highlight: true,
      blueAfterRed: true,
      ...behaviour,
    }),
  };
}

const javaRules: SegmentRules = {
  capacity: (unit) => unit.maxHp + unit.shieldHp,
  divide: (pixelsPerHp, capacity) => Math.floor(pixelsPerHp / capacity),
  minimum: true,
};

describe("the health-and-shield bar against Java's pixels", () => {
  it("paints every bar and pool the probe measured", async () => {
    const rig = await Rig.load();
    expect(rig.gradeAll(faithful)).toEqual([]);
  });

  it("rebuilds the same bar from the rules restated on their own", async () => {
    const rig = await Rig.load();
    // The rules model and the shipped functions must agree before any variant is trusted to differ.
    expect(rig.gradeAll(withSegments(javaRules))).toEqual([]);
  });

  it("has teeth: a wrong bar disagrees with the golden pixels", async () => {
    const clean = await Rig.load();
    const count = (model: Model): number => clean.gradeAll(model).length;
    const found: Record<string, number> = {};

    // Scaling by maxHp alone is the pre-shield formula: right for every pool-free row, wrong for every
    // row that carries one, because the shield has nowhere to go.
    found.scaledByMaxHp = count(withSegments({ ...javaRules, capacity: (unit) => unit.maxHp }));

    // Rounding instead of truncating moves the split on any bar whose hp does not divide evenly.
    found.rounded = count(withSegments({ ...javaRules, divide: Math.round }));

    // The one-pixel minimum is what keeps a single point of hp or of shield visible on a wide bar.
    found.noMinimumSliver = count(withSegments({ ...javaRules, minimum: false }));

    // The `width<3||height<3` refusal paints nothing at all, frame included.
    found.noGuard = count(withSegments(javaRules, { guard: false }));

    // The highlight row is painted over the segment body, not instead of it.
    found.noHighlight = count(withSegments(javaRules, { highlight: false }));

    // The shield starts after the red segment; anchoring it at the track edge overwrites the hp.
    found.blueAtTrackStart = count(withSegments(javaRules, { blueAfterRed: false }));

    // `UnitState`'s constructor drops the pool of a fainted unit, so no bar keeps blue over a KO.
    found.faintKeepsShield = count({ ...faithful, unit: unclampedUnit });

    // `BattleUnit.shieldHp()` answers 0 for a fainted pet and clamps a negative pool away.
    found.getterIgnoresFaint = count({ ...faithful, shieldHpOf: poolIgnoresFaint });
    found.getterSaysRawPool = count({ ...faithful, shieldHpOf: poolSaysRawValue });

    expect(found).toEqual({
      scaledByMaxHp: 118,
      rounded: 204,
      noMinimumSliver: 70,
      noGuard: 26,
      noHighlight: 58,
      blueAtTrackStart: 36,
      faintKeepsShield: 18,
      getterIgnoresFaint: 2,
      getterSaysRawPool: 1,
    });
  });
});
