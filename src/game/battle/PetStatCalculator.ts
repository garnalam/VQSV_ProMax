import type {
  GameData,
  PackSpeciesCatalog,
  PackSpeciesGrowth,
  PackSpeciesRow,
  PackUnifiedPetRecord,
  PackV4PetProfile,
} from "../../data/GameData";
import { toShort } from "./StatusState";

/** The growth row the binary source table carries for a species id below 100. */
type PackSourceGrowth = Extract<PackSpeciesGrowth, { kind: "source-row" }>;

/** The battle stats a growth row stores, in the order the source profile writes its columns. */
const GROWTH_KEYS = ["hp", "strength", "defense", "agility"] as const;

/**
 * `V4PetStatProfileCatalog.GROWTH_DENOMINATOR`: the V4 branch anchors its own line at level one and
 * level fifty over this span. It is the same number the source growth resource uses but a different
 * constant, so the port keeps it separate; the shipped record names it in `growth.record.formula`
 * and the golden grid refutes it the moment the engine moves.
 */
const V4_GROWTH_DENOMINATOR = 49;

/** The four battle stats a Pet's growth data resolves to, in the order the battle layer uses. */
export type PetCoreStats = { hp: number; attack: number; defense: number; speed: number };

const BATTLE_STATS = ["hp", "attack", "defense", "speed"] as const;

/**
 * Pet core stats from pack data, the way the shipped Java profile computes them.
 *
 * `battle/species.json` is the only species data this reads: one row per species the Java engine can
 * resolve, carrying its identity and metadata, the quality its source row authors, the branch of
 * `BattleSpeciesRow.rawStat` that resolves its stats, that branch's numbers, and the ancestors whose
 * stats floor it. Every branch the catalog names is implemented here and graded against
 * `battle/golden-pet-stats.json`, which the Java engine wrote, so a wrong formula fails a test
 * instead of shipping a wrong number. Over every branch sits the evolution ancestry floor: an
 * evolved form cannot show less of a stat than any ancestor at the same level and quality.
 */
export class PetStatCalculator {
  private constructor(
    private readonly catalog: PackSpeciesCatalog,
    private readonly species: Map<number, PackSpeciesRow>,
    private readonly quality: { min: number; max: number; neutral: number; percent: number[] },
    private readonly ancestors: Map<number, number[]>,
  ) {}

  static async load(data: GameData): Promise<PetStatCalculator> {
    const [catalog, petQuality] = await Promise.all([data.species(), data.petQuality()]);
    const ancestors = new Map<number, number[]>();
    for (const row of catalog.rows)
      // The engine walks this closure once at class load, over the unified evolution edges plus the
      // V4 ones the evolution catalog does not carry, and exempts the branches that return before
      // the floor runs; the row ships the result of both decisions.
      if (row.statAncestorIds.length > 0) ancestors.set(row.speciesId, row.statAncestorIds);
    return new PetStatCalculator(
      catalog,
      new Map(catalog.rows.map((row) => [row.speciesId, row])),
      {
        min: petQuality.MIN,
        max: petQuality.MAX,
        neutral: petQuality.NEUTRAL,
        percent: petQuality.STAT_PERCENT,
      },
      ancestors,
    );
  }

  /** The species row the engine resolves for this id, or `undefined` when it resolves none. */
  speciesRow(speciesId: number): PackSpeciesRow | undefined {
    return this.species.get(speciesId);
  }

  /** Whether this pack carries the growth numbers the engine would use for this species. */
  canResolve(speciesId: number): boolean {
    return this.species.has(speciesId);
  }

  /** The quality this species falls back to when a request is outside the scale. */
  defaultQuality(speciesId: number): number {
    return this.species.get(speciesId)?.defaultQuality ?? this.quality.neutral;
  }

  /**
   * `BattleSpeciesRow.resolveQuality`: the request wins while it is a real quality, then the species'
   * own quality, then neutral. A species the pack does not carry falls straight to neutral, the way
   * the source adapter resolves it without a row.
   */
  resolveQuality(speciesId: number, requested: number): number {
    if (this.isQuality(requested)) return requested;
    const fallback = this.species.get(speciesId)?.defaultQuality;
    return fallback !== undefined && this.isQuality(fallback) ? fallback : this.quality.neutral;
  }

  /** The stat percent one quality applies, after the neutral fallback `PetQuality.resolve` gives it. */
  statPercent(quality: number): number {
    return this.quality.percent[this.toNeutral(quality) - 1];
  }

  /**
   * `BattleUnit.applyNatureType` over the growth stats: the three shiny natures bend hp, attack and
   * speed, defense and every other nature pass through exactly as the species table has them.
   */
  coreStats(speciesId: number, level: number, requestedQuality: number, nature = 0): PetCoreStats {
    const quality = this.resolveQuality(speciesId, requestedQuality);
    return applyNatureType(
      {
        hp: this.statAt(speciesId, "hp", level, quality),
        attack: this.statAt(speciesId, "attack", level, quality),
        defense: this.statAt(speciesId, "defense", level, quality),
        speed: this.statAt(speciesId, "speed", level, quality),
      },
      nature,
    );
  }

  /** Final battle stat: the species' own form, then raised to its strongest ancestor's. */
  stat(speciesId: number, stat: keyof PetCoreStats, level: number, quality: number): number {
    return this.statAt(speciesId, stat, level, this.resolveQuality(speciesId, quality));
  }

  private statAt(
    speciesId: number,
    stat: keyof PetCoreStats,
    level: number,
    quality: number,
  ): number {
    let value = this.rawStat(speciesId, stat, level, quality);
    for (const ancestorId of this.ancestors.get(speciesId) ?? []) {
      value = Math.max(value, this.rawStat(ancestorId, stat, level, quality));
    }
    return value;
  }

  /** One species' own-form stat, before the evolution ancestry floor lifts it. */
  rawStat(speciesId: number, stat: keyof PetCoreStats, level: number, quality: number): number {
    const row = this.species.get(speciesId);
    if (!row) {
      throw new Error(
        `no species row for ${speciesId}: the Java engine resolves no species with that id`,
      );
    }
    const growth = row.growth;
    const percent = this.statPercent(quality);
    switch (growth.kind) {
      case "source-row":
        return this.sourceStat(growth, stat, level, percent);
      case "unified-record":
        return this.unifiedStat(growth.record, stat, level, percent);
      case "v4-profile":
        return this.v4Stat(growth.record, stat, level, percent);
      case "authored-quality-line":
        return this.authoredLine(
          growth.levelOne[this.clampedQuality(quality) - 1][this.statIndex(stat)],
          growth.levelFifty[this.clampedQuality(quality) - 1][this.statIndex(stat)],
          level,
          growth.growthDenominator,
        );
      case "authored-five-star-line": {
        const index = this.statIndex(stat);
        const qualityPercent = growth.qualityPercent[this.clampedQuality(quality) - 1];
        return this.authoredLine(
          Math.floor((growth.fiveStarLevelOne[index] * qualityPercent) / growth.fiveStarPercent),
          Math.floor((growth.fiveStarLevelFifty[index] * qualityPercent) / growth.fiveStarPercent),
          level,
          growth.growthDenominator,
        );
      }
      case "authored-flat": {
        const full = growth.stats[this.statIndex(stat)];
        const cap = growth.levelAtFullStats;
        return cap === undefined
          ? full
          : Math.max(1, Math.floor((full * Math.max(1, Math.min(level, cap))) / cap));
      }
    }
  }

  /**
   * The shape every authored record in the shipped engine shares: a straight line between the
   * anchors at level one and level fifty, evaluated with the integer division Java uses.
   */
  private authoredLine(
    levelOne: number,
    levelFifty: number,
    level: number,
    denominator: number,
  ): number {
    return (
      levelOne + Math.floor(((levelFifty - levelOne) * (this.enemyLevel(level) - 1)) / denominator)
    );
  }

  /**
   * `PetStatProfileOwner.UnifiedGrowthFormula`: the anchor times the growth denominator, plus the
   * growth numerator for every level past the first, then scaled by quality in fixed point. The
   * engine validates the level instead of clamping it, so an out-of-range level is an error here too.
   */
  private sourceStat(
    row: PackSourceGrowth,
    stat: keyof PetCoreStats,
    level: number,
    percent: number,
  ): number {
    if (level < this.catalog.minLevel || level > this.catalog.maxLevel) {
      throw new RangeError(
        `Pet growth stat level must be in [${this.catalog.minLevel}, ${this.catalog.maxLevel}], ` +
          `got ${level}`,
      );
    }
    const formula = row[GROWTH_KEYS[this.statIndex(stat)]];
    const denominator = this.catalog.growthDenominator;
    const numerator =
      formula.baseLevelOneX10 * denominator + formula.growthNumeratorX10 * (level - 1);
    return Math.floor((numerator * percent) / (denominator * this.catalog.valueScale * 100));
  }

  /**
   * `UnifiedPetRecord.stat`, which clamps the level first and then picks between a flat anchor plus
   * per-level growth and a per-ten-levels shape, depending on the stat.
   */
  private unifiedStat(
    pet: PackUnifiedPetRecord,
    stat: keyof PetCoreStats,
    level: number,
    percent: number,
  ): number {
    const index = this.statIndex(stat);
    // Cầu Vồng hands a level past PetLevel.MAX, and this family absorbs it: the engine clamps into
    // its own enemy ceiling instead of refusing, which the golden levelBounds table separates from
    // the families that throw.
    const safeLevel = this.enemyLevel(level);
    const numerator = pet.perTenLevels[index]
      ? (pet.base[index] + pet.offset[index]) * 10 + pet.growth[index] * safeLevel
      : (pet.base[index] + pet.offset[index] + pet.growth[index] * safeLevel) * 10;
    return Math.floor((numerator * percent) / 1000);
  }

  /**
   * `V4PetStatProfileCatalog.Profile.stat`: the level-one and level-fifty anchors joined by a straight
   * line, scaled by quality in the same fixed point. Like the source family it validates the level
   * against the enemy ceiling rather than clamping it.
   */
  private v4Stat(
    pet: PackV4PetProfile,
    stat: keyof PetCoreStats,
    level: number,
    percent: number,
  ): number {
    if (level < this.catalog.minLevel || level > this.catalog.maxLevel) {
      throw new RangeError(
        `V4 battle stat level must be in [${this.catalog.minLevel}, ${this.catalog.maxLevel}], ` +
          `got ${level}`,
      );
    }
    const index = this.statIndex(stat);
    const unscaled =
      pet.levelOne[index] * V4_GROWTH_DENOMINATOR +
      (pet.levelFifty[index] - pet.levelOne[index]) * (level - 1);
    return Math.floor((unscaled * percent) / (V4_GROWTH_DENOMINATOR * 100));
  }

  /** `CauVongPetLevel.clampEnemyLevel`: the level the families that absorb a request actually use. */
  private enemyLevel(level: number): number {
    return Math.max(this.catalog.minLevel, Math.min(this.catalog.maxLevel, level));
  }

  /** `Math.max(1, Math.min(5, quality))`, the clamp the authored records put on their own quality. */
  private clampedQuality(quality: number): number {
    return Math.max(this.quality.min, Math.min(this.quality.max, quality));
  }

  private isQuality(quality: number): boolean {
    return quality >= this.quality.min && quality <= this.quality.max;
  }

  private toNeutral(quality: number): number {
    return this.isQuality(quality) ? quality : this.quality.neutral;
  }

  /** The growth column one battle stat reads, so a mistyped stat name cannot become NaN. */
  private statIndex(stat: keyof PetCoreStats): number {
    const index = BATTLE_STATS.indexOf(stat);
    if (index < 0) throw new Error(`unknown Pet battle stat ${String(stat)}`);
    return index;
  }
}

/**
 * `BattleUnit.applyNatureType`: the shiny natures' stat curve, applied to the growth stats before any
 * other modifier so that the pet screen, the battle seat and a level-up all agree on the number.
 * Nature 7 trades hp and part of its attack for speed, 8 buys attack with speed and hp, and 9 turns
 * hp into attack. Defense is not in the switch, and no other nature appears in it.
 */
function applyNatureType(stats: PetCoreStats, nature: number): PetCoreStats {
  const percent = (value: number, by: number) => toShort(Math.trunc((value * by) / 100));
  switch (nature) {
    case 7:
      return {
        hp: percent(stats.hp, 80),
        attack: percent(stats.attack, 90),
        defense: stats.defense,
        speed: toShort(stats.speed + 7),
      };
    case 8:
      return {
        hp: percent(stats.hp, 80),
        attack: percent(stats.attack, 130),
        defense: stats.defense,
        speed: toShort(stats.speed - 2),
      };
    case 9:
      return {
        hp: percent(stats.hp, 130),
        attack: percent(stats.attack, 90),
        defense: stats.defense,
        speed: toShort(stats.speed - 2),
      };
    default:
      return stats;
  }
}
