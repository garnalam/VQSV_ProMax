import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GameData } from "../../data/GameData";
import type {
  GoldenPresentationRow,
  GoldenStatusPresentationTable,
  PackStatusIdentity,
  PackStatusMechanics,
  PackStatusPresentation,
} from "../../data/GameData";
import { Pack } from "../../pack/Pack";
import { StatusPresentationProjector, type StatusPresentationSlot } from "./StatusPresentation";
import { StatusEffects, StatusInstance, type StatusUnit } from "./StatusState";

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
 * One projected strip against the one Java wrote.
 *
 * `index` is the golden's own position marker, not a field of `BattleStatusPresentation`; array order
 * is the answer to the same question here. Every other key the row carries has to be answered, so a
 * column the port stops filling shows up as a disagreement instead of passing quietly.
 */
function stripDisagreements(
  label: string,
  row: GoldenPresentationRow,
  mine: StatusPresentationSlot[],
): string[] {
  const found: string[] = [];
  if (mine.length !== row.slots.length) {
    found.push(
      `${label} shows ${mine.length} slot(s) where Java shows ${row.slots.length}: ` +
        `${mine.map((slot) => slot.stableKey).join(",")} != ${row.slots.map((slot) => slot.stableKey).join(",")}`,
    );
    return found;
  }
  for (let index = 0; index < row.slots.length; index++) {
    const expected = row.slots[index] as unknown as Record<string, unknown>;
    const actual = mine[index] as unknown as Record<string, unknown>;
    for (const field of Object.keys(expected)) {
      if (field === "index") continue;
      if (JSON.stringify(actual[field]) !== JSON.stringify(expected[field])) {
        found.push(
          `${label}/${index} ${field} ${JSON.stringify(actual[field])}` +
            ` != ${JSON.stringify(expected[field])}`,
        );
      }
    }
  }
  return found;
}

/**
 * `BattleStatusPresentationProjector.project`, graded as a walk.
 *
 * The unit is rebuilt from each golden row's own `held` column — the state that survived the seed — and
 * the counters the row records are the only thing the strip reads, so the base stats here are a rig
 * detail rather than an input. Java seeded these units at level 20 through `BattleUnit.fromSpecies`,
 * and the projector reaches for nothing else on the unit than its statuses, the bank order and the cap.
 */
class Rig {
  private constructor(
    readonly effects: StatusEffects,
    readonly projector: StatusPresentationProjector,
    readonly golden: GoldenStatusPresentationTable,
    readonly mechanics: PackStatusMechanics,
  ) {}

  static async load(mutate?: (file: string, json: unknown) => unknown): Promise<Rig> {
    mutation = mutate;
    try {
      const data = new GameData(await Pack.load());
      const [effects, golden, mechanics] = await Promise.all([
        StatusEffects.load(data),
        data.goldenStatusPresentation(),
        data.statusMechanics(),
      ]);
      return new Rig(
        effects,
        new StatusPresentationProjector(mechanics.statusPresentation),
        withoutRemovedStatuses(golden),
        mechanics,
      );
    } finally {
      mutation = undefined;
    }
  }

  /** Put one row's statuses onto a fresh unit through the same typed owner a commit uses. */
  plant(row: GoldenPresentationRow): StatusUnit {
    const unit = this.effects.unit({
      speciesId: this.golden.unit.targetSpecies,
      ownerSide: 1,
      formationSlot: 3,
      base: { hp: 100, attack: 100, defense: 100, speed: 100 },
    });
    for (const held of row.held) {
      const definition = this.effects.catalog.definition(held.bank, held.numericId);
      if (!definition) {
        throw new Error(
          `the golden seeded ${held.bank}/${held.numericId} but the catalog has no row`,
        );
      }
      unit.statuses.put(
        new StatusInstance(
          definition,
          held.remainingTurns,
          held.remainingActions,
          0,
          0,
          1,
          unit.ownerSide,
          unit.formationSlot,
          -1,
          0,
        ),
      );
    }
    if (row.suppressionActions > 0) unit.applyOpeningAttackSuppression(row.suppressionActions);
    return unit;
  }

  /** Every disagreement between this rig's projector and the Java rows, over all four tables. */
  disagreements(): string[] {
    const found: string[] = [];
    for (const row of this.golden.presentation) {
      found.push(...stripDisagreements(row.label, row, this.projector.project(this.plant(row))));
    }
    for (const row of this.golden.copy) {
      found.push(
        ...stripDisagreements(
          `${row.label} attacker`,
          row.attacker,
          this.projector.project(this.plant(row.attacker)),
        ),
        ...stripDisagreements(
          `${row.label} target`,
          row.target,
          this.projector.project(this.plant(row.target)),
        ),
      );
    }
    for (const row of this.golden.durationCells) {
      const mine = this.projector.durationBadgeCell(row.duration);
      if (mine !== row.cell) {
        found.push(`duration ${row.duration} badges cell ${mine}, Java draws ${row.cell}`);
      }
    }
    return found;
  }
}

/** Statuses the web game removed (status-web-rules.json): Phong Bế, 2:6. */
const REMOVED = new Set(["2/6"]);

/**
 * Java recorded strips for units holding Phong Bế; the web game no longer has that status, so those
 * states cannot occur and their rows are not graded.
 */
function withoutRemovedStatuses(
  golden: GoldenStatusPresentationTable,
): GoldenStatusPresentationTable {
  const holdsRemoved = (row: GoldenPresentationRow) =>
    row.held.some((held) => REMOVED.has(`${held.bank}/${held.numericId}`));
  return {
    ...golden,
    presentation: golden.presentation.filter((row) => !holdsRemoved(row)),
    copy: golden.copy.filter((row) => !holdsRemoved(row.attacker) && !holdsRemoved(row.target)),
  };
}

/**
 * The harvest is only a substitute for the projector's arithmetic if the two artifacts still say the
 * same thing, so every picture and name Java wrote into a golden slot is looked up again in the table
 * the bake shipped. A re-bake against an edited projector moves one of the two and fails here.
 */
function identityDisagreements(rig: Rig): string[] {
  const found: string[] = [];
  const sourceKey = (bank: number, numericId: number) => bank * 1000 + numericId;
  const entries: [number, PackStatusIdentity][] = rig.mechanics.statusPresentation.rows.map(
    (row) => [sourceKey(row.sourceBank, row.sourceNumericId), row],
  );
  entries.push([sourceKey(-1, -1), rig.mechanics.statusPresentation.openingSuppression]);
  const bySource = new Map<number, PackStatusIdentity>(entries);
  const rows = [
    ...rig.golden.presentation,
    ...rig.golden.copy.flatMap((row) => [row.attacker, row.target]),
  ];
  for (const row of rows) {
    for (const slot of row.slots) {
      const identity = bySource.get(sourceKey(slot.sourceBank, slot.sourceNumericId));
      if (!identity || !identity.visible) {
        found.push(`${row.label}/${slot.index} ${slot.stableKey} is not in the harvested table`);
        continue;
      }
      for (const field of [
        "stableKey",
        "displayName",
        "iconKind",
        "lietHoaAtlasCell",
        "resourcePath",
      ] as const) {
        if (JSON.stringify(identity[field]) !== JSON.stringify(slot[field])) {
          found.push(
            `${row.label}/${slot.index} ${field} ${JSON.stringify(identity[field])}` +
              ` != ${JSON.stringify(slot[field])}`,
          );
        }
      }
    }
  }
  for (const row of rig.mechanics.statusPresentation.rows) {
    if (row.visible) continue;
    // An identity the projector refuses must be one the battle can never plant, or the strip would
    // drop a status the source still shows.
    if (rig.effects.catalog.definition(row.sourceBank, row.sourceNumericId)) {
      found.push(
        `${row.sourceBank}/${row.sourceNumericId} is refused but the catalog registers it`,
      );
    }
  }
  return found;
}

describe("status presentation strip", () => {
  it("projects the same strip Java does, over every seeded unit", async () => {
    const rig = await Rig.load();
    expect(rig.disagreements()).toEqual([]);
    // both ends of the walk are actually in the table: a unit over the cap and a unit with nothing
    expect(rig.golden.presentation.some((row) => row.held.length > row.slots.length)).toBe(true);
    expect(rig.golden.presentation.some((row) => row.slots.length === 0)).toBe(true);
  });

  it("reads every picture and name off the harvested table", async () => {
    const rig = await Rig.load();
    expect(identityDisagreements(rig)).toEqual([]);
  });

  it("names each identity the way the source names it", async () => {
    const rig = await Rig.load();
    const bySource = new Map(
      rig.mechanics.statusPresentation.rows.map((row) => [
        row.sourceBank * 1000 + row.sourceNumericId,
        row,
      ]),
    );
    const found: string[] = [];
    let refused = 0;
    for (const row of rig.golden.effectNames) {
      const identity = bySource.get(row.bank * 1000 + row.numericId);
      // The probe asks the catalog what a status is called; the bake asks the projector what it
      // prints. They part company exactly where the projector refuses, and only there.
      if (!identity?.visible) {
        refused++;
        continue;
      }
      if (row.hasDefinition && identity.displayName !== row.displayName) {
        found.push(
          `${row.bank}/${row.numericId} prints "${identity.displayName}", catalog says "${row.displayName}"`,
        );
      }
    }
    expect(found).toEqual([]);
    expect(refused).toBeGreaterThan(0);
  });

  it("is graded by a projector that can be broken", async () => {
    /**
     * Every mutation is measured off a real run, so a wrong answer has to be a counted one. The count
     * below each one is the number of Java rows that stop agreeing, and each is the whole of what that
     * edit could reach: the golden carries ten Cầu Vồng slots, so a lost resource path is ten rows and
     * not an unexplained larger one.
     */
    const count = async (mutate: (table: PackStatusPresentation) => void): Promise<number> => {
      const rig = await Rig.load((file, json) => {
        if (!/status-mechanics\.json$/.test(file)) return json;
        const mechanics = json as PackStatusMechanics;
        mutate(mechanics.statusPresentation);
        return mechanics;
      });
      return rig.disagreements().length;
    };

    /** Swap two Liệt Hỏa buffs' artwork: the wrong picture next to the right name. */
    const swappedCells = await count((table) => {
      const first = table.rows.find((row) => row.sourceBank === 0 && row.sourceNumericId === 0)!;
      const second = table.rows.find((row) => row.sourceBank === 0 && row.sourceNumericId === 1)!;
      [first.lietHoaAtlasCell, second.lietHoaAtlasCell] = [
        second.lietHoaAtlasCell!,
        first.lietHoaAtlasCell!,
      ];
    });
    /** Walk the banks in the other order, which is how one bank starves another. */
    const reversedBanks = await count((table) => {
      table.bankOrder = [...table.bankOrder].reverse();
    });
    /** Shrink the six-slot cap, which drops the tail of every long strip. */
    const shorterCap = await count((table) => {
      table.maxVisible = 4;
    });
    /** Drop the Cầu Vồng resource path, so those identities lose their picture entirely. */
    const lostRainbowArt = await count((table) => {
      for (const row of table.rows) {
        if (row.sourceBank === 2 && row.visible) row.resourcePath = "";
      }
    });
    /** Refuse an identity the source shows, which deletes a slot rather than repainting it. */
    const hidden = await count((table) => {
      table.rows.find((row) => row.sourceBank === 0 && row.sourceNumericId === 12)!.visible = false;
    });
    /** Alias a signature identity onto the wrong buff, the reuse the source itself makes on purpose. */
    const wrongAlias = await count((table) => {
      table.rows.find(
        (row) => row.sourceBank === 0 && row.sourceNumericId === 15,
      )!.lietHoaAtlasCell = 26;
    });
    /** Draw the opening-pressure badge with another status's picture. */
    const wrongOpeningBadge = await count((table) => {
      table.openingSuppression.lietHoaAtlasCell = 6;
    });

    expect({
      swappedCells,
      reversedBanks,
      shorterCap,
      lostRainbowArt,
      hidden,
      wrongAlias,
      wrongOpeningBadge,
    }).toEqual({
      swappedCells: 18,
      reversedBanks: 84,
      shorterCap: 5,
      // 10 in the Java golden; the one Phong Bế row is no longer graded.
      lostRainbowArt: 9,
      hidden: 1,
      wrongAlias: 2,
      wrongOpeningBadge: 2,
    });
  });
});
