import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Pack } from "../pack/Pack";
import { canonicalStatus, TraitBattleState } from "../game/battle/DesignTraits";
import { GameData, type PackTrait, type PackTraitDescriptionBalanceTable } from "./GameData";

const root = resolve(import.meta.dirname, "..", "..");

/**
 * The seam the mutation proof at the bottom pulls: every fetch is parsed and then handed to this
 * before the reader sees it, so a wrong sentence can be injected without touching the pack on disk.
 */
let mutate: (file: string, json: unknown) => unknown = (_file, json) => json;

vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(root, "public", decodeURIComponent(input.replace(/^\//, "")));
  return {
    ok: true,
    status: 200,
    json: async () => mutate(file, JSON.parse(readFileSync(file, "utf8"))),
  };
});

/** The two Java exports the balance table names, as `GameData.document` paths. */
const TABLES = ["battle/pet-physical-traits.json", "battle/pet-species-traits.json"] as const;

/**
 * The rename rule the balance table records, applied longest match first so the TV-04 sentence — which
 * drops a whole clause rather than swapping one word — cannot be half-edited by the shorter rule.
 */
function applySubstitutions(
  text: string,
  substitutions: readonly { from: string; to: string }[],
): string {
  return [...substitutions]
    .sort((left, right) => right.from.length - left.from.length)
    .reduce((out, rule) => out.split(rule.from).join(rule.to), text);
}

class Rig {
  private constructor(
    readonly data: GameData,
    readonly balance: PackTraitDescriptionBalanceTable,
    readonly rows: Map<string, PackTrait[]>,
  ) {}

  static async load(mutator?: (file: string, json: unknown) => unknown): Promise<Rig> {
    mutate = mutator ?? ((_file, json) => json);
    try {
      const data = new GameData(await Pack.load());
      const [balance, physical, species] = await Promise.all([
        data.traitDescriptionBalance(),
        data.physicalTraits(),
        data.speciesTraits(),
      ]);
      const rows = new Map<string, PackTrait[]>([
        [TABLES[0], physical],
        [TABLES[1], species],
      ]);
      return new Rig(data, balance, rows);
    } finally {
      mutate = (_file, json) => json;
    }
  }

  rename(text: string): string {
    return applySubstitutions(text, this.balance.substitutions);
  }

  /**
   * Every claim the balance table makes, graded against the Java exports it layers over. Nothing here
   * states what the rename should be; the rule is the table's own, and each check is a way the table
   * could quietly stop being that rule.
   */
  gradeAll(): { found: string[]; effective: Map<string, string> } {
    const found: string[] = [];
    if (this.balance.substitutions.length === 0) found.push("the table declares no rename rule");
    const replacements = new Map<string, string>();
    for (const override of this.balance.overrides) {
      const key = `${override.table}::${override.stableKey}`;
      const table = this.rows.get(override.table);
      if (!table) {
        found.push(`${key}: ${override.table} is not one of the tables this guard reads`);
        continue;
      }
      const row = table.find((candidate) => candidate.stableKey === override.stableKey);
      if (!row) {
        found.push(`${key}: no such trait row`);
        continue;
      }
      if (override.field !== "description")
        found.push(`${key}: overrides ${override.field}, which is not the description`);
      // The recorded original has to be the Java export's own sentence, or the guard is comparing the
      // rename against text nobody ever shipped.
      if (override.java !== row.description)
        found.push(
          `${key}: quotes ${JSON.stringify(override.java)} and Java says` +
            ` ${JSON.stringify(row.description)}`,
        );
      const expected = this.rename(override.java);
      if (override.value !== expected)
        found.push(
          `${key}: says ${JSON.stringify(override.value)} and the rule gives` +
            ` ${JSON.stringify(expected)}`,
        );
      if (replacements.has(key)) found.push(`${key}: declared twice`);
      replacements.set(key, override.value);
    }

    // The override set has to be exactly the set of Java sentences the rule changes, so a third trait
    // that starts naming a cut status fails here rather than shipping stale text.
    const changing = [...this.rows.entries()].flatMap(([table, tableRows]) =>
      tableRows
        .filter((row) => this.rename(row.description) !== row.description)
        .map((row) => `${table}::${row.stableKey}`),
    );
    if (changing.sort().join(",") !== [...replacements.keys()].sort().join(","))
      found.push(
        `the rule changes [${changing.sort()}] and the table overrides` +
          ` [${[...replacements.keys()].sort()}]`,
      );

    // What a player would read once the layer is applied: no cut name survives anywhere.
    const effective = new Map<string, string>();
    for (const [table, tableRows] of this.rows)
      for (const row of tableRows) {
        const key = `${table}::${row.stableKey}`;
        const description = replacements.get(key) ?? row.description;
        effective.set(key, description);
        for (const rule of this.balance.substitutions)
          if (description.includes(rule.from))
            found.push(`${key}: still says ${rule.from} — ${description}`);
      }
    return { found, effective };
  }
}

describe("the cut-status rename", () => {
  it("grades every override against the Java export it layers over", async () => {
    const rig = await Rig.load();
    expect(rig.gradeAll().found).toEqual([]);
    expect(rig.balance.overrides.map((override) => override.stableKey).sort()).toEqual([
      "TC-10",
      "TV-04",
    ]);
  });

  it("rewrites the two sentences and leaves the other 37 byte for byte", async () => {
    const rig = await Rig.load();
    const { effective } = rig.gradeAll();
    // 19 talents and 20 species traits.
    expect(effective.size).toBe(39);
    expect(effective.get(`${TABLES[0]}::TC-10`)).toBe(
      "Cuối lượt hồi 2% Sinh mệnh tối đa; tạm ngừng khi đang Gieo Hạt hoặc Hủ Thực;" +
        " tổng hồi thụ động bị chặn ở 4% mỗi lượt.",
    );
    // TV-04 loses a clause rather than a word: Độc folds into the Hủ Thực already in the list.
    expect(effective.get(`${TABLES[1]}::TV-04`)).toBe(
      "Skill gây Gieo Hạt hoặc Hủ Thực được cộng 5 điểm phần trăm xác suất, tối đa 95%.",
    );
    let untouched = 0;
    for (const [table, tableRows] of rig.rows)
      for (const row of tableRows)
        if (effective.get(`${table}::${row.stableKey}`) === row.description) untouched++;
    expect(untouched).toBe(37);
  });

  it("indexes the overrides by table and stable key", async () => {
    const rig = await Rig.load();
    const overrides = await rig.data.traitDescriptionOverrides();
    expect(overrides.size).toBe(rig.balance.overrides.length);
    for (const override of rig.balance.overrides)
      expect(overrides.get(`${override.table}::${override.stableKey}`)).toBe(override.value);
  });

  it("answers the two cut names with the two statuses the text now shows", async () => {
    // The other half of the same decision, so the sentence and the logic cannot drift apart. BURN
    // keeps its own canonical flag, which `DesignTraits.synchronizeTraitCanonicalStatuses` writes from
    // Gieo Hạt; `poison` has no status of its own and resolves onto Hủ Thực instead.
    expect(canonicalStatus("burn")).toBe("burn");
    expect(canonicalStatus("poison")).toBe("corrosion");
    const state = new TraitBattleState();
    expect(state.hasCanonicalStatus("poison")).toBe(false);
    state.setCanonicalStatus("corrosion", true);
    expect(state.hasCanonicalStatus("poison")).toBe(true);
    expect(state.hasCanonicalStatus("burn")).toBe(false);
    state.setCanonicalStatus("burn", true);
    expect(state.hasCanonicalStatus("burn")).toBe(true);
  });

  it("leaves the engine's own parameter names alone", async () => {
    const rig = await Rig.load();
    // `burn` and `poison` are `PetTraitCanonicalStatus` enum names and `golden-physical-traits.json`
    // byte-compares the `parametersJson` that carries them, so only the human-readable text is renamed
    // and the Java recording still referees the talent table.
    for (const override of rig.balance.overrides) {
      const row = rig.rows
        .get(override.table)!
        .find((candidate) => candidate.stableKey === override.stableKey)!;
      expect(row.parametersJson).toContain('"burn"');
      expect(override.value).not.toMatch(/burn|poison/);
    }
    expect(
      rig.rows.get(TABLES[1])!.find((row) => row.stableKey === "TV-04")!.parametersJson,
    ).toContain('"poison"');
    const golden = JSON.parse(
      readFileSync(resolve(root, "public/pack/data/battle/golden-physical-traits.json"), "utf8"),
    ) as { rows: { stableKey: string; parametersJson: string }[] };
    const recorded = golden.rows.find((row) => row.stableKey === "TC-10")!;
    const live = rig.rows.get(TABLES[0])!.find((row) => row.stableKey === "TC-10")!;
    expect(live.parametersJson).toBe(recorded.parametersJson);
  });

  it("has teeth: a drifted sentence disagrees with the Java export", async () => {
    const clean = await Rig.load();
    expect(clean.gradeAll().found).toEqual([]);

    const count = async (mutator: (file: string, json: unknown) => unknown): Promise<number> =>
      (await Rig.load(mutator)).gradeAll().found.length;

    const found: Record<string, number> = {};

    // The Java sentence the override quotes is rewritten, so the recorded original no longer matches.
    found.javaSentenceMoved = await count((file, json) => {
      if (!file.endsWith("pet-physical-traits.json")) return json;
      return (json as PackTrait[]).map((row) =>
        row.stableKey === "TC-10" ? { ...row, description: `${row.description} Thêm chữ.` } : row,
      );
    });

    // The replacement edits more than the recorded rule allows.
    found.replacementRewritten = await count((file, json) => {
      if (!file.endsWith("pet-trait-descriptions.json")) return json;
      const table = json as PackTraitDescriptionBalanceTable;
      return {
        ...table,
        overrides: table.overrides.map((override) =>
          override.stableKey === "TC-10"
            ? { ...override, value: override.value.replace("Hủ Thực", "Ăn mòn") }
            : override,
        ),
      };
    });

    // A third trait starts naming a cut status, so the override set is no longer complete.
    found.incompleteSet = await count((file, json) => {
      if (!file.endsWith("pet-species-traits.json")) return json;
      return (json as PackTrait[]).map((row) =>
        row.stableKey === "TV-01" ? { ...row, description: "Gây Thiêu Đốt cho đối thủ." } : row,
      );
    });

    // The override points at a row the Java export does not have.
    found.missingRow = await count((file, json) => {
      if (!file.endsWith("pet-trait-descriptions.json")) return json;
      const table = json as PackTraitDescriptionBalanceTable;
      return {
        ...table,
        overrides: table.overrides.map((override) =>
          override.stableKey === "TV-04" ? { ...override, stableKey: "TV-09" } : override,
        ),
      };
    });

    // The rule itself is dropped, so nothing is renamed any more.
    found.ruleEmptied = await count((file, json) => {
      if (!file.endsWith("pet-trait-descriptions.json")) return json;
      const table = json as PackTraitDescriptionBalanceTable;
      return { ...table, substitutions: [] };
    });

    // Every count is a number a real run produced, and every one is above zero: a mutation the table
    // cannot see is a hole in the table, not a passing test.
    for (const [name, value] of Object.entries(found)) expect(value, name).toBeGreaterThan(0);
    expect(found).toEqual(MUTATION_COUNTS);
  });
});

/** Measured from a real run, so a guard that quietly stops grading shows up as a changed count. */
const MUTATION_COUNTS: Record<string, number> = {
  javaSentenceMoved: 1,
  replacementRewritten: 1,
  incompleteSet: 2,
  missingRow: 4,
  ruleEmptied: 4,
};
