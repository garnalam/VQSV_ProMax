import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GameData } from "../../data/GameData";
import { Pack } from "../../pack/Pack";
import { TraitMechanicRegistry, traitRollEntropy } from "./PhysicalTraits";

const root = resolve(import.meta.dirname, "..", "..", "..");

/** A catalog edit standing in for a mistake a port could make, cleared once the rig is loaded. */
let mutation: ((file: string, json: unknown) => unknown) | undefined;

vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(root, "public", decodeURIComponent(input.replace(/^\//, "")));
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const normalized = file.replace(/\\/g, "/");
  const value = mutation && normalized.endsWith(".json") ? mutation(normalized, parsed) : parsed;
  return { ok: true, status: 200, json: async () => value };
});

async function registry(
  mutate?: (file: string, json: unknown) => unknown,
): Promise<TraitMechanicRegistry> {
  mutation = mutate;
  try {
    return await TraitMechanicRegistry.load(new GameData(await Pack.load()));
  } finally {
    mutation = undefined;
  }
}

async function golden() {
  mutation = undefined;
  return new GameData(await Pack.load()).goldenTraitBattle();
}

describe("physical talent roll, sanitize and permanent-stat resolver", () => {
  it("rolls the recorded talent for every swept entropy", async () => {
    const [table, mechanics] = await Promise.all([golden(), registry()]);
    expect(mechanics.totalWeight).toBe(table.roller.totalWeight);
    for (const row of table.roller.rows) {
      expect(mechanics.roll(BigInt(row.entropy)), `entropy ${row.entropy}`).toBe(
        row.physicalTraitId,
      );
    }
  });

  it("answers `valid` for every id the table probes", async () => {
    const [table, mechanics] = await Promise.all([golden(), registry()]);
    for (const row of table.roller.valid) {
      expect(mechanics.valid(row.physicalTraitId), `id ${row.physicalTraitId}`).toBe(row.valid);
    }
  });

  it("collapses an unrollable or exclusive id to the neutral talent on sanitize", async () => {
    const [table, mechanics] = await Promise.all([golden(), registry()]);
    for (const row of table.roller.sanitize) {
      expect(
        mechanics.sanitizePhysicalTraitId(row.physicalTraitId),
        `id ${row.physicalTraitId}`,
      ).toBe(row.result);
    }
  });

  it("gives one identity one talent, in this run and the next", async () => {
    const [first, second] = await Promise.all([registry(), registry()]);
    const identity = ["LH-ENC-S01-R01-G00-B01-BUNNY", 0, 7, 34, 8, 3, 3];
    const talent = first.rollFromIdentity(identity);
    expect(second.rollFromIdentity(identity)).toBe(talent);
    expect(first.valid(talent)).toBe(true);
    // Every field reaches the mixer, so a per-fight field makes a per-fight talent.
    expect(traitRollEntropy([...identity, 1])).not.toBe(traitRollEntropy(identity));
    const byFight = new Set(
      Array.from({ length: 40 }, (_, seed) =>
        first.rollFromIdentity([identity[0], seed, ...identity.slice(2)]),
      ),
    );
    expect(byFight.size).toBeGreaterThan(1);
  });

  it("spreads distinct identities over the weighted pool", async () => {
    const [mechanics, pool] = await Promise.all([
      registry(),
      new GameData(await Pack.load()).physicalTraits(),
    ]);
    const total = pool.reduce((sum, row) => sum + row.rollWeight, 0);
    const drawn = 6000;
    const counts = new Map<number, number>();
    for (let id = 0; id < drawn; id++) {
      const talent = mechanics.rollFromIdentity(["spread", id]);
      expect(mechanics.valid(talent), `sample ${id}`).toBe(true);
      counts.set(talent, (counts.get(talent) ?? 0) + 1);
    }
    let worst = 0;
    for (const row of pool) {
      const share = (counts.get(row.runtimeId) ?? 0) / drawn;
      const expected = row.rollWeight / total;
      if (expected > 0) expect(counts.has(row.runtimeId), `id ${row.runtimeId}`).toBe(true);
      worst = Math.max(worst, Math.abs(share - expected));
    }
    expect(worst).toBeLessThan(0.02);
  });

  it("projects the four permanent stats for every talent id and base the resolver was swept over", async () => {
    const [table, mechanics] = await Promise.all([golden(), registry()]);
    for (const row of table.permanentStats) {
      const [maxHp, strength, defense, agility] = row.base;
      const projected = mechanics.projectPermanentStats(row.physicalTraitId, {
        maxHp,
        strength,
        defense,
        agility,
      });
      const mine = [projected.maxHp, projected.strength, projected.defense, projected.agility];
      expect(mine, `${row.physicalTraitId}/${JSON.stringify(row.base)}`).toEqual(row.projected);
    }
  });

  it("moves a permanent stat only for a percent-stat talent, and only its own slot", async () => {
    const table = await golden();
    const movers = new Set(
      table.permanentStats
        .filter((row) => JSON.stringify(row.base) !== JSON.stringify(row.projected))
        .map((row) => row.physicalTraitId),
    );
    expect([...movers].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("disagrees with the recorded roll when the pool weights change", async () => {
    const table = await golden();
    const mechanics = await registry((file, json) => {
      if (!file.endsWith("battle/pet-physical-traits.json")) return json;
      const rows = json as { runtimeId: number; rollWeight: number }[];
      return rows.map((row) => (row.runtimeId === 0 ? { ...row, rollWeight: 0 } : row));
    });
    let disagreements = 0;
    for (const row of table.roller.rows) {
      if (mechanics.roll(BigInt(row.entropy)) !== row.physicalTraitId) disagreements++;
    }
    expect(disagreements).toBeGreaterThan(0);
  });

  it("disagrees with the recorded permanent stats when a talent's percent is raised", async () => {
    const table = await golden();
    const mechanics = await registry((file, json) => {
      if (!file.endsWith("battle/pet-trait-mechanics.json")) return json;
      const pack = json as { physical: { runtimeId: number; parametersJson: string }[] };
      return {
        ...pack,
        physical: pack.physical.map((row) =>
          row.runtimeId === 1
            ? { ...row, parametersJson: row.parametersJson.replace(/-?\d+/, "999") }
            : row,
        ),
      };
    });
    let disagreements = 0;
    for (const row of table.permanentStats) {
      if (row.physicalTraitId !== 1) continue;
      const [maxHp, strength, defense, agility] = row.base;
      const projected = mechanics.projectPermanentStats(row.physicalTraitId, {
        maxHp,
        strength,
        defense,
        agility,
      });
      const mine = [projected.maxHp, projected.strength, projected.defense, projected.agility];
      if (JSON.stringify(mine) !== JSON.stringify(row.projected)) disagreements++;
    }
    expect(disagreements).toBeGreaterThan(0);
  });
});
