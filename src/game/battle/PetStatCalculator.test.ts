import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GameData } from "../../data/GameData";
import type { GoldenPetStats } from "../../data/GameData";
import { Pack } from "../../pack/Pack";
import { PetStatCalculator, type PetCoreStats } from "./PetStatCalculator";

const root = resolve(import.meta.dirname, "..", "..", "..");

vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(root, "public", decodeURIComponent(input.replace(/^\//, "")));
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(readFileSync(file, "utf8")),
  };
});

async function newData(): Promise<GameData> {
  return new GameData(await Pack.load());
}

/** One golden stat cell: an input triple and the number the Java engine returned for it. */
type StatCell = {
  speciesId: number;
  stat: keyof PetCoreStats;
  level: number;
  quality: number;
  expected: number;
};

/** Every stat the probe recorded, with the level grid each quality was sampled on. */
async function goldenCells(): Promise<StatCell[]> {
  const stats: GoldenPetStats = await (await newData()).goldenPetStats();
  const cells: StatCell[] = [];
  for (const [id, species] of Object.entries(stats.species)) {
    for (const [quality, slice] of Object.entries(species.qualities)) {
      // Neutral quality was probed over every level; the rest over the sampled grid.
      const grid = slice.hp.length === stats.fullLevels.length ? stats.fullLevels : stats.levels;
      for (const stat of ["hp", "attack", "defense", "speed"] as const) {
        slice[stat].forEach((expected, index) =>
          cells.push({
            speciesId: +id,
            stat,
            level: grid[index],
            quality: +quality,
            expected,
          }),
        );
      }
    }
  }
  return cells;
}

function countMismatches(cells: StatCell[], actual: (cell: StatCell) => number): number {
  return cells.filter((cell) => actual(cell) !== cell.expected).length;
}

async function calculator(): Promise<PetStatCalculator> {
  return PetStatCalculator.load(await newData());
}

function baseCoreStats(unit: { baseStats: number[] }): PetCoreStats {
  const [, hp, attack, defense, speed] = unit.baseStats;
  return { hp, attack, defense, speed };
}

/** The natures whose bend `BattleUnit.applyNatureType` applies — the shiny ones. */
const SHINY_NATURES = new Set([7, 8, 9]);

/** A calculator result in the order the referee wrote its stat rows. */
function toSlice(stats: PetCoreStats): number[] {
  return [stats.hp, stats.attack, stats.defense, stats.speed];
}

describe("Pet stat calculator", () => {
  it("reproduces every golden species stat the pack can express", async () => {
    const cells = await goldenCells();
    const calc = await calculator();
    const expressible = cells.filter((cell) => calc.canResolve(cell.speciesId));
    const unsupported = [
      ...new Set(
        cells.filter((cell) => !calc.canResolve(cell.speciesId)).map((cell) => cell.speciesId),
      ),
    ].sort((a, b) => a - b);
    // The seven records that used to keep their stat anchors as private class constants now ship
    // them as growth tables, so nothing the referee answers for is a gap any more.
    expect(unsupported).toEqual([]);
    expect(expressible.length).toBeGreaterThan(300_000);
    expect(
      countMismatches(expressible, (cell) =>
        calc.stat(cell.speciesId, cell.stat, cell.level, cell.quality),
      ),
    ).toBe(0);
  });

  it("grades what the engine does with a level outside the range its own branch accepts", async () => {
    const data = await newData();
    const [stats, catalog, calc] = await Promise.all([
      data.goldenPetStats(),
      data.species(),
      calculator(),
    ]);
    // A Cầu Vồng enemy is levelled past PetLevel.MAX, so the ceiling and what sits just past it are
    // part of the arithmetic the port is graded on, not a range the port may choose.
    expect(stats.fullLevels[stats.fullLevels.length - 1]).toBe(150);
    const refusing: number[] = [];
    let clamped = 0;
    for (const [id, byQuality] of Object.entries(stats.levelBounds)) {
      if (!calc.canResolve(+id)) continue;
      for (const [quality, byLevel] of Object.entries(byQuality)) {
        for (const [level, expected] of Object.entries(byLevel)) {
          const at = () => calc.coreStats(+id, +level, +quality);
          if (expected === null) {
            expect(at, `species ${id} at level ${level}`).toThrow(RangeError);
            if (+level === 0) refusing.push(+id);
            continue;
          }
          expect(at(), `species ${id} at level ${level}`).toEqual({
            hp: expected[0],
            attack: expected[1],
            defense: expected[2],
            speed: expected[3],
          });
          clamped++;
        }
      }
    }
    // Which families refuse and which clamp is a property of the branch, so the split the referee
    // measured has to be the split the catalog's growth kinds imply.
    expect([...new Set(refusing)].sort((a, b) => a - b)).toEqual(
      catalog.rows
        .filter((row) => row.growth.kind === "source-row" || row.growth.kind === "v4-profile")
        .map((row) => row.speciesId),
    );
    expect(clamped).toBe(
      catalog.rows.filter(
        (row) => row.growth.kind !== "source-row" && row.growth.kind !== "v4-profile",
      ).length *
        5 *
        2,
    );
  });

  it("has one catalogued species row for every species the referee answers for", async () => {
    const data = await newData();
    const [stats, catalog, calc] = await Promise.all([
      data.goldenPetStats(),
      data.species(),
      calculator(),
    ]);
    expect(catalog.schema).toBe("vqsv-webnative-battle-species-v1");
    // The table is keyed by the id the engine resolves, so a duplicate or an unsorted gap would
    // silently point one species at another species' growth numbers.
    const ids = catalog.rows.map((row) => row.speciesId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(catalog.speciesCount).toBe(ids.length);
    for (const id of Object.keys(stats.species))
      expect(calc.speciesRow(+id), `species ${id} has no catalog row`).toBeDefined();
    // The other direction: every species the calculator resolves is one the referee answered for, so
    // no growth branch can ship as arithmetic with nothing grading it.
    for (const row of catalog.rows)
      expect(
        stats.species[String(row.speciesId)],
        `species ${row.speciesId} resolves but is not graded`,
      ).toBeDefined();

    // The growth channel order the calculator reads its formula columns in.
    expect(catalog.statChannels).toEqual([
      { growthStat: "hp", battleStat: "hp" },
      { growthStat: "strength", battleStat: "attack" },
      { growthStat: "defense", battleStat: "defense" },
      { growthStat: "agility", battleStat: "speed" },
    ]);
  });

  it("grades quality resolution against the engine and keeps the referee answers-only", async () => {
    const stats = await (await newData()).goldenPetStats();
    const calc = await calculator();
    const requests = new Set<string>();
    for (const [id, species] of Object.entries(stats.species)) {
      // A species row is only an identity table while the golden table beside it carries no identity.
      expect(Object.keys(species).sort()).toEqual(["qualities", "qualityResolution"]);
      for (const [requested, resolved] of Object.entries(species.qualityResolution)) {
        requests.add(requested);
        expect(calc.resolveQuality(+id, +requested), `${id} <- ${requested}`).toBe(resolved);
      }
      // The invalid requests fall back to the quality the species itself authors.
      expect(calc.defaultQuality(+id)).toBe(species.qualityResolution["-1"]);
    }
    expect([...requests].sort((a, b) => +a - +b)).toEqual([
      "-1",
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "99",
    ]);
  });

  it("needs the ancestry floor, its full transitive closure and the quality scale it applies", async () => {
    const data = await newData();
    const [cells, calc, evolutions, quality] = await Promise.all([
      goldenCells(),
      calculator(),
      data.evolutions(),
      data.petQuality(),
    ]);
    const expressible = cells.filter((cell) => calc.canResolve(cell.speciesId));
    const direct = new Map<number, number[]>();
    for (const rule of evolutions) {
      const edge = direct.get(rule.toSpeciesId) ?? [];
      edge.push(rule.fromSpeciesId);
      direct.set(rule.toSpeciesId, edge);
    }
    const ownFormOnly = (cell: StatCell) =>
      calc.rawStat(cell.speciesId, cell.stat, cell.level, cell.quality);
    const flooredByDirectParentsOnly = (cell: StatCell) =>
      (direct.get(cell.speciesId) ?? []).reduce(
        (value, ancestorId) =>
          Math.max(value, calc.rawStat(ancestorId, cell.stat, cell.level, cell.quality)),
        calc.rawStat(cell.speciesId, cell.stat, cell.level, cell.quality),
      );
    // Every family reads its numbers through one quality band: the percent table for the growth
    // formulas, the anchor row for the authored records. This reads the band above the request.
    const shiftedByOneQualityBand = (cell: StatCell) =>
      calc.rawStat(cell.speciesId, cell.stat, cell.level, Math.min(cell.quality + 1, quality.MAX));

    // Reading only the unified evolution edges loses every cell the V4 ancestry lifts, so the floor
    // has to come from the topology the stat path itself walks.
    expect(countMismatches(expressible, ownFormOnly)).toBeGreaterThan(16_000);
    expect(countMismatches(expressible, flooredByDirectParentsOnly)).toBeGreaterThan(5_000);
    expect(countMismatches(expressible, shiftedByOneQualityBand)).toBeGreaterThan(1_000);
  });

  it("reproduces the stat slots the Java engine built each battle unit from", async () => {
    const [units, calc] = await Promise.all([(await newData()).goldenBattleUnits(), calculator()]);
    // BattleUnit.applyNatureType runs between the species table and baseStats, so a unit's own nature
    // byte is part of the input this calculator has to take for the numbers to come out equal.
    let grown = 0;
    const shinyRows: string[] = [];
    for (const unit of [
      ...Object.values(units.encounters).flatMap((encounter) => [
        encounter.enemy,
        encounter.noTrait,
      ]),
      units.starter,
    ]) {
      if (!calc.canResolve(unit.speciesId)) continue;
      const [quality] = unit.baseStats;
      expect(
        calc.coreStats(unit.speciesId, unit.level, quality, unit.natureType),
        `${unit.speciesId}@L${unit.level}n${unit.natureType}`,
      ).toEqual(baseCoreStats(unit));
      if (SHINY_NATURES.has(unit.natureType))
        shinyRows.push(`${unit.speciesId}@L${unit.level}n${unit.natureType}`);
      else grown++;
    }
    expect(grown).toBe(215);
    expect(shinyRows).toEqual(["50@L12n9", "50@L12n9", "14@L37n8", "14@L37n8"]);

    // The numbers scene1's hand-authored world contract still carries, unchanged.
    expect(baseCoreStats(units.starter)).toEqual({ hp: 179, attack: 111, defense: 18, speed: 7 });
  });

  it("replays every natureGrid row the referee measured on built units", async () => {
    const data = await newData();
    const [stats, qualityScale, calc] = await Promise.all([
      data.goldenPetStats(),
      data.petQuality(),
      calculator(),
    ]);
    let rows = 0;
    for (const [id, byCell] of Object.entries(stats.natureGrid)) {
      for (const [cell, expected] of Object.entries(byCell)) {
        const [level, nature] = cell.split("/").map(Number);
        expect(
          toSlice(calc.coreStats(+id, level, qualityScale.NEUTRAL, nature)),
          `${id} ${cell}`,
        ).toEqual(expected);
        // A shiny row only proves the curve when the same species and level at a plain nature answers
        // something else; without this, a grid read at the wrong quality could still match.
        if (SHINY_NATURES.has(nature))
          expect(
            toSlice(calc.coreStats(+id, level, qualityScale.NEUTRAL, 1)),
            `${id} ${cell} at a plain nature`,
          ).not.toEqual(expected);
        rows++;
      }
    }
    expect(rows).toBe(200);
  });

  it("refuses a level outside the range a growth family validates", async () => {
    const calc = await calculator();
    expect(() => calc.stat(68, "hp", 0, 3)).toThrow(RangeError);
    expect(() => calc.stat(68, "hp", 151, 3)).toThrow(RangeError);
    expect(() => calc.stat(202, "hp", 0, 3)).toThrow(RangeError);
    expect(() => calc.stat(68, "resistance" as keyof PetCoreStats, 7, 3)).toThrow(
      /unknown Pet battle stat/,
    );
    expect(() => calc.rawStat(9999, "hp", 1, 3)).toThrow(/no species row for 9999/);
    // The unified family keeps its own growth columns rather than the Liệt Hỏa rows.
    expect(calc.coreStats(100, 1, 3)).not.toEqual(calc.coreStats(0, 1, 3));
  });

  it("keeps the two custom bosses flat over level and quality", async () => {
    const [stats, calc] = await Promise.all([(await newData()).goldenPetStats(), calculator()]);
    for (const speciesId of [278, 280]) {
      const flat = calc.coreStats(speciesId, 1, 1);
      for (const level of [1, 37, 150])
        for (const quality of [1, 3, 5])
          expect(
            calc.coreStats(speciesId, level, quality),
            `${speciesId} ${level}/${quality}`,
          ).toEqual(flat);
      // The referee saw the same thing: every sampled level of every quality returned those four
      // numbers, so nothing here is an assumption about what a boss "should" grow into.
      for (const [quality, slice] of Object.entries(stats.species[String(speciesId)].qualities))
        for (const stat of ["hp", "attack", "defense", "speed"] as const)
          expect(slice[stat], `species ${speciesId} ${stat} at quality ${quality}`).toEqual(
            Array(slice.hp.length).fill(flat[stat]),
          );
    }
  });

  it("resolves quality the way the engine's scale does", async () => {
    const [calc, quality] = await Promise.all([calculator(), (await newData()).petQuality()]);
    expect(quality.STAT_PERCENT).toEqual([90, 95, 100, 110, 125]);
    for (const level of [quality.MIN, 2, quality.NEUTRAL, 4, quality.MAX]) {
      expect(calc.statPercent(level)).toBe(quality.STAT_PERCENT[level - 1]);
    }
    // Out-of-range quality falls back to neutral, exactly as PetQuality.resolve does.
    expect(calc.statPercent(0)).toBe(100);
    expect(calc.statPercent(6)).toBe(100);
    expect(calc.statPercent(-2)).toBe(100);
  });
});
