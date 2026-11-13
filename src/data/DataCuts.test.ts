import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Pack } from "../pack/Pack";
import { GameData, type DataCutReader, type PackDataCuts } from "./GameData";

const root = resolve(import.meta.dirname, "..", "..");

/**
 * The seam the refusal tests at the bottom use: every fetch is parsed and then handed to this before
 * any reader sees it, so a stale cut can be injected without touching the pack on disk.
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

const BALANCE_FILE = "balance/data-cuts.json";

/** Which Java table each reader filters, as a `document()` path. */
const TABLE_BY_READER: Record<DataCutReader, string> = {
  statuses: "battle/statuses.json",
  physicalTraits: "battle/pet-physical-traits.json",
  physicalTraitMechanics: "battle/pet-trait-mechanics.json",
};

const READERS = Object.keys(TABLE_BY_READER) as DataCutReader[];

type Row = { stableKey: string };

class Rig {
  private constructor(
    readonly data: GameData,
    readonly cuts: PackDataCuts,
    /** Java's row list per reader, straight off the dump. */
    readonly java: Map<DataCutReader, Row[]>,
    /** The same list as the game sees it. */
    readonly web: Map<DataCutReader, Row[]>,
  ) {}

  static async load(mutator?: (file: string, json: unknown) => unknown): Promise<Rig> {
    mutate = mutator ?? ((_file, json) => json);
    const pack = await Pack.load();
    const data = new GameData(pack);
    const cuts = await data.dataCuts();
    const java = new Map<DataCutReader, Row[]>();
    const web = new Map<DataCutReader, Row[]>();
    for (const reader of READERS) {
      java.set(reader, await javaRows(pack, reader));
      web.set(
        reader,
        reader === "statuses"
          ? await data.statuses()
          : reader === "physicalTraits"
            ? await data.physicalTraits()
            : (await data.traitMechanics()).physical,
      );
    }
    return new Rig(data, cuts, java, web);
  }
}

const keys = (rows: readonly Row[]): string[] => rows.map((row) => row.stableKey);

/**
 * The Java table as the pack ships it, before any cut. The mechanic file is the odd one: the rows the
 * registry compares against the talent list live under its `physical` key, not at the top level.
 */
async function javaRows(pack: Pack, reader: DataCutReader): Promise<Row[]> {
  const document = await pack.json<Row[] | { physical: Row[] }>(`data.${TABLE_BY_READER[reader]}`);
  return Array.isArray(document) ? document : document.physical;
}

/** Resolved paths use the platform separator, so a pack-path comparison has to normalise them. */
function toPackPath(file: string): string {
  return file.split(sep).join("/");
}

/** Rewrite the cuts array of the balance file and leave every other fetch alone. */
function editCuts(edit: (cuts: PackDataCuts["cuts"]) => PackDataCuts["cuts"]) {
  return (file: string, json: unknown): unknown =>
    toPackPath(file).endsWith(BALANCE_FILE)
      ? { ...(json as PackDataCuts), cuts: edit((json as PackDataCuts).cuts) }
      : json;
}

/** Drop one row out of the Java dump, the way a future engine edit would. */
function editJavaTable(reader: DataCutReader, edit: (rows: Row[]) => Row[]) {
  const table = `data/${TABLE_BY_READER[reader]}`;
  return (file: string, json: unknown): unknown =>
    toPackPath(file).endsWith(table) ? edit(json as Row[]) : json;
}

describe("balance/data-cuts.json", () => {
  it("cuts the four rows the web game dropped and nothing else in those tables", async () => {
    const rig = await Rig.load();
    expect(Object.keys(rig.cuts.source)).toEqual(["balanceVersion", "javaExports", "note"]);

    // The declaration names its rows exactly once per reader, and the Java dump still carries all of them.
    const declared = rig.cuts.cuts.map((cut) => `${cut.reader}/${cut.stableKey}`);
    expect(new Set(declared).size).toBe(declared.length);
    expect([...declared].sort()).toEqual([
      "physicalTraitMechanics/HV-01",
      "physicalTraitMechanics/TL-01",
      "physicalTraits/HV-01",
      "physicalTraits/TL-01",
    ]);
    for (const cut of rig.cuts.cuts) {
      expect(READERS).toContain(cut.reader);
      expect(cut.table).toBe(TABLE_BY_READER[cut.reader]);
      const javaRow = (rig.java.get(cut.reader) as Record<string, unknown>[]).find(
        (each) => each.stableKey === cut.stableKey,
      );
      expect(javaRow, `${cut.table} still exports ${cut.stableKey}`).toBeDefined();
      for (const [field, value] of Object.entries(cut.javaIdentity)) {
        expect(javaRow![field], `${cut.stableKey}.${field}`).toBe(value);
      }
      expect(cut.displayName).toBeTruthy();
      expect(cut.decided).toMatch(/2026-11-/);
      expect(cut.reason.length).toBeGreaterThan(40);
      expect(cut.guardTests.length).toBeGreaterThan(0);
      expect(keys(rig.web.get(cut.reader)!)).not.toContain(cut.stableKey);
    }

    // What the game sees is Java's list minus the declared keys, in Java's order, with no other move.
    for (const reader of READERS) {
      const dropped = new Set(
        rig.cuts.cuts.filter((cut) => cut.reader === reader).map((cut) => cut.stableKey),
      );
      expect(keys(rig.web.get(reader)!), reader).toEqual(
        keys(rig.java.get(reader)!).filter((key) => !dropped.has(key)),
      );
    }
  });

  it("leaves the tables at the counts the battle code is written against", async () => {
    const rig = await Rig.load();
    expect({
      statuses: [rig.java.get("statuses")!.length, rig.web.get("statuses")!.length],
      talents: [rig.java.get("physicalTraits")!.length, rig.web.get("physicalTraits")!.length],
      mechanics: [
        rig.java.get("physicalTraitMechanics")!.length,
        rig.web.get("physicalTraitMechanics")!.length,
      ],
    }).toEqual({ statuses: [40, 40], talents: [21, 19], mechanics: [21, 19] });

    // Phong Bế (2/6) is back (2026-11-12): Kỹ năng Phong Bế plants it as in the source.
    expect(await rig.data.statusByStableKey("CV-EFFECT-11-06")).toMatchObject({
      sourceBank: 2,
      sourceNumericId: 6,
      semanticKey: "tier_lock",
    });
    expect(await rig.data.statusByStableKey("CV-EFFECT-11-05")).toMatchObject({
      sourceBank: 2,
      sourceNumericId: 5,
    });

    // The talent table is only the rollable ones, and the mechanic rows still line up with it by id.
    const talents = await rig.data.physicalTraits();
    expect(talents.every((talent) => talent.rollWeight > 0)).toBe(true);
    expect(talents.map((talent) => talent.runtimeId)).toEqual(talents.map((_, i) => i));
    const mechanics = await rig.data.traitMechanics();
    expect(mechanics.physical.map((row) => row.runtimeId)).toEqual(
      talents.map((talent) => talent.runtimeId),
    );
    // rowCount is Java's number for the whole dump; the filtered view recomputes it, not restates it.
    expect(mechanics.rowCount).toBe(mechanics.physical.length + mechanics.species.length);
    expect(mechanics.species.length).toBe(20);

    // The registry the battle builds from these two tables agrees with both, which is the point.
    const { TraitMechanicRegistry } = await import("../game/battle/PhysicalTraits");
    const registry = await TraitMechanicRegistry.load(rig.data);
    expect(registry.physicalCount).toBe(19);
    expect(registry.isPhysicalTraitAllowed(19)).toBe(false);
    expect(registry.physicalSpec(19)).toBeUndefined();
  });

  it("refuses a cut that no longer matches what Java exports", async () => {
    // Java dropping the row itself would leave a declaration describing nothing, so it is rot, refused.
    await expect(
      Rig.load(
        editJavaTable("physicalTraits", (rows) => rows.filter((row) => row.stableKey !== "HV-01")),
      ),
    ).rejects.toThrow(/cuts battle\/pet-physical-traits\.json HV-01, which Java no longer exports/);

    // A cut aimed at a different identity is refused rather than silently dropping another row.
    await expect(
      Rig.load(
        editCuts((cuts) =>
          cuts.map((cut) =>
            cut.stableKey === "HV-01" && cut.reader === "physicalTraits"
              ? { ...cut, javaIdentity: { ...cut.javaIdentity, runtimeId: 18 } }
              : cut,
          ),
        ),
      ),
    ).rejects.toThrow(/HV-01\.runtimeId is 18, Java says 19/);

    // Two cuts of one key for one reader is a declaration nobody can read as one decision.
    await expect(
      Rig.load(
        editCuts((cuts) => [
          ...cuts,
          { ...cuts.find((cut) => cut.stableKey === "HV-01" && cut.reader === "physicalTraits")! },
        ]),
      ),
    ).rejects.toThrow(/cuts physicalTraits HV-01 twice/);

    // Losing the declaration is not a refusal, and that is why the counts above are guarded separately.
    const uncut = await Rig.load(
      editCuts((cuts) => cuts.filter((cut) => cut.reader !== "statuses")),
    );
    expect(uncut.web.get("statuses")!.length).toBe(40);
  });
});
