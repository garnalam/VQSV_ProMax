import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Pack } from "../../pack/Pack";
import {
  GameData,
  type GoldenCatchRow,
  type GoldenCatchTable,
  type GoldenExpRow,
  type GoldenExpTable,
  type GoldenFlowTable,
  type GoldenHeldItemsTable,
  type PackItem,
} from "../../data/GameData";
import {
  calculateCatchChance,
  decideCatch,
  decideCatchFailure,
  decideCatchOpenBox,
  decideCatchStorage,
  decideEvolution,
  decideExpCompletion,
  decideLose,
  decideLoseRevive,
  decideReserveShare,
  expAward,
  expEligible,
  loseResultIndex,
  loseResultIndexWithDefeat,
  passiveHealAmount,
  winResultIndex,
  winResultIndexWithCapture,
  type CatchInput,
  type ExpAwardInput,
} from "./BattleOutcomeEngine";
import { EnemyLevel } from "./EnemyLevel";
import { HeldItems, NO_HELD_ITEM } from "./HeldItems";

const root = resolve(import.meta.dirname, "..", "..", "..");

/**
 * The seam the mutation proof at the bottom pulls: every fetch is parsed and then handed to this
 * before a reader sees it, so a wrong column or a wrong answer can be injected without touching the
 * pack on disk.
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

/**
 * `expAward`'s nine inputs, in the order the probe wrote each row's `input` array. The table's own
 * `note` spells the same order out, so the check below ties this decoder to the referee rather than
 * to a guess.
 */
const EXP_INPUT_ORDER = [
  "enemyLevel",
  "enemyNature",
  "levelFactorLevel",
  "participantCount",
  "divisor",
  "heldItem5",
  "heldItem5Multiplier",
  "traitPercent",
  "traitStackable",
] as const;

/**
 * `BattleOutcomeEngine.CatchInput`'s fifteen constructor parameters, which is also the order the
 * probe wrote each catch row in: item id, its `paramA`, enemy HP, enemy max HP, enemy nature, debuff
 * 1, debuff 2, debuff 10, held item 11, that item's bonus, capture bonus points, relation class,
 * enemy level, the roll, and the tutorial's forced failure.
 */
const CATCH_INPUT_LENGTH = 15;

/** The forced result indices the probe ran the win and lose branch decisions at. */
const FORCED_RESULTS = [-1, 0, 3];

/** The branches and money the probe asked the outcome decisions about. */
const CAPTURE_SUCCESS_RESULT = 7;
const PLAYER_DEFEAT_RESULT = 4;
const REVIVE_MONEY = 500;
const REVIVE_COST = 400;
const REVIVE_BROKE = 100;
const HEAL_BASE_HP = 200;

/** The three held items that act on the outcome rather than on the damage formula. */
const OUTCOME_ITEM_IDS = [5, 6, 11];

/** The raw column every one of those items is read at, as `param(id, 5, fallback)`. */
const OUTCOME_ITEM_COLUMN = 5;

class Rig {
  private constructor(
    readonly exp: GoldenExpTable,
    readonly catches: GoldenCatchTable,
    readonly flow: GoldenFlowTable,
    readonly measured: GoldenHeldItemsTable,
    readonly held: HeldItems,
    readonly levels: EnemyLevel,
    readonly items: readonly PackItem[],
  ) {}

  static async load(mutator?: (file: string, json: unknown) => unknown): Promise<Rig> {
    mutate = mutator ?? ((_file, json) => json);
    try {
      const data = new GameData(await Pack.load());
      const [exp, catches, flow, measured, held, levels, items] = await Promise.all([
        data.goldenExp(),
        data.goldenCatch(),
        data.goldenFlow(),
        data.goldenHeldItems(),
        HeldItems.load(data),
        EnemyLevel.load(data),
        data.items(),
      ]);
      return new Rig(exp, catches, flow, measured, held, levels, items);
    } finally {
      mutate = (_file, json) => json;
    }
  }

  expRows(): GoldenExpRow[] {
    return [
      ...Object.values(this.exp.isolated).flat(),
      ...this.exp.levelGap,
      ...this.exp.combinations,
    ];
  }

  catchRows(): GoldenCatchRow[] {
    return [...Object.values(this.catches.isolated).flat(), ...this.catches.combinations];
  }

  /** The shipped battle-item table, source table 4, in the id order the referee walked. */
  battleItems(): PackItem[] {
    return this.items
      .filter((item) => item.sourceTable === 4)
      .sort((a, b) => a.runtimeId - b.runtimeId);
  }

  decodeExp(row: GoldenExpRow): ExpAwardInput {
    const [
      enemyLevel,
      enemyNature,
      levelFactorLevel,
      participantCount,
      divisor,
      heldItem5,
      heldItem5Multiplier,
      traitPercent,
      traitStackable,
    ] = row.input;
    return {
      enemyLevel,
      enemyNature,
      levelFactorLevel,
      participantCount,
      divisor,
      heldItem5: heldItem5 === 1,
      heldItem5Multiplier,
      experienceMultiplierPercent: traitPercent,
      experienceMultiplierStackable: traitStackable === 1,
    };
  }

  decodeCatch(row: GoldenCatchRow): CatchInput {
    const input = row.input;
    return {
      itemId: input[0],
      itemParamA: input[1],
      enemyHp: input[2],
      enemyMaxHp: input[3],
      enemyNature: input[4],
      targetDebuff1: input[5] === 1,
      targetDebuff2: input[6] === 1,
      targetDebuff10: input[7] === 1,
      attackerHeldItem11: input[8] === 1,
      heldItem11Bonus: input[9],
      captureBonusPoints: input[10],
      enemyRelationClass: input[11],
      enemyLevel: input[12],
      roll: input[13],
      forceFail: input[14] === 1,
    };
  }

  /** The outcome block rebuilt from the port, shaped exactly as the probe shaped it. */
  portOutcome(): GoldenFlowTable["outcome"] {
    const outcome: GoldenFlowTable["outcome"] = {};
    for (const forced of FORCED_RESULTS) {
      outcome[`win${forced}`] = winResultIndex(false, forced);
      outcome[`bunnyWin${forced}`] = winResultIndex(true, forced);
      outcome[`lose${forced}`] = loseResultIndex(forced);
      outcome[`withCapture${forced}`] = winResultIndexWithCapture({
        bunnyCapture: true,
        forcedResultIndex: forced,
        catchSucceeded: true,
        captureSuccessResultIndex: CAPTURE_SUCCESS_RESULT,
      });
      outcome[`captureFail${forced}`] = winResultIndexWithCapture({
        bunnyCapture: true,
        forcedResultIndex: forced,
        catchSucceeded: false,
        captureSuccessResultIndex: CAPTURE_SUCCESS_RESULT,
      });
      outcome[`defeatIndex${forced}`] = loseResultIndexWithDefeat(forced, PLAYER_DEFEAT_RESULT);
    }
    outcome.catchFailureQueue = decideCatchFailure(true);
    outcome.catchFailureReturn = decideCatchFailure(false);
    outcome.openBox = {
      0: decideCatchOpenBox(0),
      1: decideCatchOpenBox(1),
      2: decideCatchOpenBox(2),
      4: decideCatchOpenBox(4),
    };
    outcome.lose = { revive: decideLose(true), world: decideLose(false) };
    outcome.revive = {
      paid: this.revive(false, false),
      broke: decideLoseRevive({
        cancelled: false,
        insufficientPhase: false,
        money: REVIVE_BROKE,
        cost: REVIVE_COST,
      }),
      cancelled: this.revive(true, false),
      phase: this.revive(false, true),
    };
    outcome.passiveHeal = {
      0: passiveHealAmount(HEAL_BASE_HP, 0),
      10: passiveHealAmount(HEAL_BASE_HP, 10),
      100: passiveHealAmount(HEAL_BASE_HP, 100),
    };
    return outcome;
  }

  private revive(cancelled: boolean, insufficientPhase: boolean) {
    return decideLoseRevive({
      cancelled,
      insufficientPhase,
      money: REVIVE_MONEY,
      cost: REVIVE_COST,
    });
  }

  /**
   * Every disagreement between the port and the four tables that referee it, as one flat list. Each
   * entry names its row, so a mutation's count is a count of rows rather than of assertions.
   */
  gradeAll(): string[] {
    const found: string[] = [];

    if (Object.keys(this.exp.dimensions).join(",") !== EXP_INPUT_ORDER.join(","))
      found.push(`exp dimensions are ${Object.keys(this.exp.dimensions).join(",")}`);
    if (!this.exp.note.includes(EXP_INPUT_ORDER.join(", ")))
      found.push("the exp table's note no longer spells the input order this decoder reads");

    for (const row of this.expRows()) {
      const award = expAward(this.decodeExp(row));
      if (award !== row.award) found.push(`exp ${row.input} -> ${award}, Java says ${row.award}`);
    }

    for (const key of ["enemyHp-1", "enemyHp0", "enemyHp1", "enemyHp50"] as const) {
      const enemyHp = Number(key.slice("enemyHp".length));
      const eligible = expEligible({
        enemyPresent: true,
        enemyHp,
        playerPresent: true,
        playerUnitPresent: true,
        bunnyCapture: false,
      });
      if (eligible !== this.exp.eligibility[key])
        found.push(`expEligible ${key} -> ${eligible}, Java says ${this.exp.eligibility[key]}`);
    }
    const bunny = expEligible({
      enemyPresent: true,
      enemyHp: 0,
      playerPresent: true,
      playerUnitPresent: true,
      bunnyCapture: true,
    });
    if (bunny !== this.exp.eligibility.bunnyCapture)
      found.push(
        `expEligible bunnyCapture -> ${bunny}, Java says ${this.exp.eligibility.bunnyCapture}`,
      );

    const share = this.exp.eligibility.reserveShare;
    if (typeof share === "boolean") found.push("reserveShare is not the object the probe wrote");
    else {
      const heldShare = decideReserveShare({ globalShare: false, heldItem6: true });
      const plain = decideReserveShare({ globalShare: true, heldItem6: false });
      if (heldShare.divisor !== share.heldItem6)
        found.push(
          `reserveShare heldItem6 divisor -> ${heldShare.divisor}, Java says ${share.heldItem6}`,
        );
      if (plain.outcome !== share.plain)
        found.push(`reserveShare plain -> ${plain.outcome}, Java says ${share.plain}`);
    }

    for (const row of this.exp.expCompletion) {
      const outcome = decideExpCompletion(row.hasLearnSkills, row.canLevelAgain);
      if (outcome !== row.outcome)
        found.push(`expCompletion ${row.hasLearnSkills}/${row.canLevelAgain} -> ${outcome}`);
    }

    this.exp.requiredExpPerLevel.forEach((required, index) => {
      const got = this.levels.requiredExp(index + 1);
      if (got !== required)
        found.push(`requiredExp(${index + 1}) -> ${got}, Java says ${required}`);
    });

    // The three outcome items are read at one column, and that column is a value Java measured off the
    // same shipped table. Comparing the helper against the measurement is what makes "reads the wrong
    // column" a failure here rather than a value that quietly moves on both sides at once.
    for (const id of OUTCOME_ITEM_IDS) {
      const row = this.measured.items.find((candidate) => candidate.id === id);
      if (!row) {
        found.push(`golden-held-items carries no measurement for item ${id}`);
        continue;
      }
      const at = row.paramIndexes.indexOf(OUTCOME_ITEM_COLUMN);
      const measured = row.params[at];
      const read = this.held.param(id, OUTCOME_ITEM_COLUMN, -1);
      if (read !== measured)
        found.push(
          `held item ${id} column ${OUTCOME_ITEM_COLUMN} -> ${read}, Java measured ${measured}`,
        );
      // Ký Cư Giải Xác is the reserve-share gate, not a multiplier, so it has no helper to grade: the
      // divisor it opens is checked against the reserveShare row below.
      if (id === 6) continue;
      const gated = id === 11 ? this.held.captureRateBonus(id) : this.held.experienceMultiplier(id);
      if (gated !== measured)
        found.push(`held item ${id}'s outcome helper -> ${gated}, Java measured ${measured}`);
      const nothing =
        id === 11
          ? this.held.captureRateBonus(NO_HELD_ITEM)
          : this.held.experienceMultiplier(NO_HELD_ITEM);
      if (nothing !== 0)
        found.push(`held item ${id}'s helper answers ${nothing} for a pet holding nothing`);
    }

    for (const row of this.catchRows()) {
      if (row.input.length !== CATCH_INPUT_LENGTH)
        found.push(`catch row ${row.input} is not ${CATCH_INPUT_LENGTH} inputs long`);
      const result = decideCatch(this.decodeCatch(row));
      if (result.chance !== row.chance)
        found.push(`catch ${row.input} chance -> ${result.chance}, Java says ${row.chance}`);
      if (result.caught !== row.caught)
        found.push(`catch ${row.input} caught -> ${result.caught}, Java says ${row.caught}`);
    }

    for (const row of this.catches.storage) {
      const storage = decideCatchStorage({ rosterSize: row.rosterSize, bankSize: row.bankSize });
      if (storage.outcome !== row.outcome || storage.sourceResult !== row.sourceResult)
        found.push(
          `catchStorage ${row.rosterSize}/${row.bankSize} -> ` +
            `${storage.outcome}/${storage.sourceResult}, Java says ${row.outcome}/${row.sourceResult}`,
        );
    }

    this.catches.itemTable.forEach((row, index) => {
      const item = this.battleItems()[index];
      if (!item) {
        found.push(`itemTable ${row.id} has no shipped catalog row`);
        return;
      }
      const values = effectValues(item);
      const params = [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
      if (item.runtimeId !== row.id)
        found.push(`itemTable ${row.id} sits at catalog id ${item.runtimeId}`);
      if (item.name !== row.name)
        found.push(`itemTable ${row.id} is named ${row.name}, the catalog says ${item.name}`);
      if (params[0] !== row.paramA || params[1] !== row.paramB || params[2] !== row.paramC)
        found.push(
          `itemTable ${row.id} params ${row.paramA}/${row.paramB}/${row.paramC}, ` +
            `the catalog says ${params.join("/")}`,
        );
    });

    const outcome = this.portOutcome();
    for (const key of Object.keys(this.flow.outcome))
      if (JSON.stringify(outcome[key]) !== JSON.stringify(this.flow.outcome[key]))
        found.push(
          `flow outcome ${key} -> ${JSON.stringify(outcome[key])}, ` +
            `Java says ${JSON.stringify(this.flow.outcome[key])}`,
        );
    for (const key of Object.keys(outcome))
      if (!(key in this.flow.outcome))
        found.push(`flow outcome ${key} is not a row the probe wrote`);

    for (const row of this.flow.evolution) {
      const evolution = decideEvolution({
        currentValid: true,
        targetValid: true,
        targetSpeciesId: 5,
        targetKind: row.targetKind,
        currentLevel: row.currentLevel,
        materialNeed: 2,
        materialCount: 3,
      });
      const got = `${evolution.eligible}/${evolution.sourceKind}/${evolution.requiredLevel}/${evolution.materialEnough}`;
      const want = `${row.eligible}/${row.sourceKind}/${row.requiredLevel}/${row.materialEnough}`;
      if (got !== want)
        found.push(
          `evolution kind ${row.targetKind} level ${row.currentLevel} -> ${got}, Java says ${want}`,
        );
    }

    return found;
  }
}

/**
 * One shipped item's effect parameters, unescaped the way the exporter wrote them: wrapped in quotes
 * of their own with every inner quote doubled.
 */
function effectValues(item: PackItem): number[] {
  return (effectJson(item).values as number[] | undefined) ?? [];
}

function effectJson(item: PackItem): Record<string, unknown> {
  const text = item.effectParametersJson.trim();
  const unescaped = (
    text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text
  ).replaceAll('""', '"');
  return JSON.parse(unescaped) as Record<string, unknown>;
}

/**
 * `battle/items.json` and nothing else. The bare filename would also match `golden-held-items.json`,
 * whose document is an object rather than the row array this edit needs.
 */
function isItemsCatalog(file: string): boolean {
  return /[\\/]items\.json$/.test(file);
}

/** One column of one shipped item's `values`, edited where the pack stores it. */
function withItemColumn(
  json: unknown,
  sourceTable: number,
  runtimeId: number,
  valueIndex: number,
  value: number,
): unknown {
  return (json as PackItem[]).map((item) => {
    if (item.sourceTable !== sourceTable || item.runtimeId !== runtimeId) return item;
    const parsed = effectJson(item);
    const values = (parsed.values as number[]).slice();
    values[valueIndex] = value;
    const encoded = JSON.stringify({ ...parsed, values }).replaceAll('"', '""');
    return { ...item, effectParametersJson: `"${encoded}"` };
  });
}

describe("battle outcome engine", () => {
  it("grades every row the Java engine measured", async () => {
    const rig = await Rig.load();
    expect(rig.gradeAll()).toEqual([]);
    // 52 isolated + 324 level-gap + 60 randomised EXP rows; 49 isolated + 60 randomised captures.
    expect(rig.expRows()).toHaveLength(436);
    expect(rig.catchRows()).toHaveLength(109);
    expect(rig.catches.storage).toHaveLength(16);
    expect(rig.catches.itemTable).toHaveLength(15);
    expect(rig.flow.evolution).toHaveLength(30);
    expect(rig.exp.requiredExpPerLevel).toHaveLength(100);
    expect(rig.exp.expCompletion).toHaveLength(4);
  });

  it("answers the whole catch chain from the ball's own paramA up", async () => {
    const rig = await Rig.load();
    // Tất Trung Cầu answers 100 before anything else is read, whatever the enemy's HP, quality or
    // relation to the player's team.
    const guaranteed = rig.catches.isolated.itemId[0];
    expect(guaranteed.input[0]).toBe(0);
    expect(decideCatch(rig.decodeCatch(guaranteed))).toEqual({ chance: 100, caught: true });
    // The tutorial's forced failure beats a chance of 100, which is the one row where `caught` and
    // `chance` come apart.
    expect(decideCatch({ ...rig.decodeCatch(guaranteed), forceFail: true }).caught).toBe(false);
    // Java's three HP fractions land the eight sampled fractions on three plateaus, and the referee
    // answers them in that shape: 0/10/15 are under the 15% line, 20/50 are under 50%, 51/85/100 are not.
    const bands = rig.catches.isolated.enemyHpFraction.map((row) => row.chance);
    expect(bands).toEqual([40, 40, 40, 21, 21, 9, 9, 9]);
    // Each of Java's four status tests overwrites the last, so the second and third debuff slots both
    // answer the same 12/10 and only Sủng vật lôi đạt — which gets that 12/10 *and* its own bonus —
    // pulls ahead. The last two rows are the item at a synthetic bonus and at the number its catalog
    // row actually carries; they land together here because this baseline's chance is small enough that
    // the extra fifth of a percent the two bonuses differ by rounds away.
    const status = rig.catches.isolated.status;
    expect(status.map((row) => row.chance)).toEqual([9, 10, 11, 11, 13, 13]);
    expect(status[5].input[9]).toBe(rig.held.captureRateBonus(11));
  });

  it("reads held items 5 and 11 through the catalog, and item 6 as a gate", async () => {
    const rig = await Rig.load();
    const multiplier = rig.held.experienceMultiplier(5);
    const bonus = rig.held.captureRateBonus(11);
    // Each helper answers the column Java measured, and no neighbouring column of the same row: the
    // raw column reading is graded above, so this pins which column the outcome engine is handed.
    for (const column of [3, 4, 6, 7]) {
      expect(multiplier, `item 5 column ${column}`).not.toBe(rig.held.param(5, column, -1));
      expect(bonus, `item 11 column ${column}`).not.toBe(rig.held.param(11, column, -1));
    }
    // The gate is Java's own: a pet holding nothing answers zero, so the multiplier never reaches the
    // formula as a bare column read would.
    expect(rig.held.experienceMultiplier(NO_HELD_ITEM)).toBe(0);
    expect(rig.held.captureRateBonus(NO_HELD_ITEM)).toBe(0);

    // Item 6 is not a number in a formula. It is the only thing that opens the reserve share, and the
    // global flag Java carries beside it is read and then ignored.
    expect(decideReserveShare({ globalShare: true, heldItem6: false }).outcome).toBe("SKIP");
    expect(decideReserveShare({ globalShare: true, heldItem6: true })).toEqual({
      outcome: "SHARE",
      divisor: 1000,
      percent: 100,
    });

    // Holding Mật Phong Sào and reading nothing from it is the same as not holding it, which is the
    // referee's own isolated pair for the dimension.
    const pair = rig.exp.isolated.heldItem5;
    expect(pair[0].input[5]).toBe(0);
    expect(pair[1].input[5]).toBe(1);
    expect(pair[1].input[6]).toBe(0);
    expect(pair[0].award).toBe(pair[1].award);

    // Mật Phong Sào's own multiplier is one of the values the referee walks, and it is the row where the
    // column read and the formula meet: the probe turns the hold on for this dimension, so the answer
    // moves with the number instead of sitting on the baseline.
    const multiplierRows = rig.exp.isolated.heldItem5Multiplier;
    expect(multiplierRows.map((row) => row.input[6])).toContain(multiplier);
    for (const row of multiplierRows) {
      expect(row.input[5]).toBe(1);
      expect(expAward(rig.decodeExp(row))).toBe(row.award);
    }
    expect(multiplierRows.find((row) => row.input[6] === multiplier)!.award).not.toBe(
      multiplierRows.find((row) => row.input[6] === 0)!.award,
    );

    // Sủng vật lôi đạt's own bonus likewise appears as a grid input, so the whole path — read the column,
    // hand it to the chance formula, land on Java's answer — is graded end to end rather than argued.
    const graded = rig.catchRows().filter((row) => row.input[8] === 1 && row.input[9] === bonus);
    expect(graded.length).toBeGreaterThan(0);
    for (const row of graded) {
      const replayed = decideCatch(rig.decodeCatch(row));
      expect(replayed.chance).toBe(row.chance);
      expect(replayed.caught).toBe(row.caught);
    }
    // Not holding it has to change the answer, so the bonus is doing work and not riding along. The
    // ball that answers 100 before reading anything cannot move, and a row held at its level cap by
    // both readings cannot either, so this counts the rows that do rather than the whole set.
    const moved = graded.filter(
      (row) =>
        row.input[0] !== 0 &&
        calculateCatchChance({ ...rig.decodeCatch(row), attackerHeldItem11: false }) !== row.chance,
    );
    expect(moved.length).toBeGreaterThan(0);
  });

  it("has teeth: a wrong answer or a wrong column disagrees with the tables", async () => {
    const clean = await Rig.load();
    expect(clean.gradeAll()).toEqual([]);

    const count = async (mutator: (file: string, json: unknown) => unknown): Promise<number> =>
      (await Rig.load(mutator)).gradeAll().length;

    const found: Record<string, number> = {};

    // One EXP answer is off by one, so exactly one row disagrees.
    found.awardDrifted = await count((file, json) => {
      if (!file.endsWith("golden-exp.json")) return json;
      const table = json as GoldenExpTable;
      return {
        ...table,
        combinations: table.combinations.map((row, index) =>
          index === 0 ? { ...row, award: row.award + 1 } : row,
        ),
      };
    });

    // One capture chance is off by one.
    found.chanceDrifted = await count((file, json) => {
      if (!file.endsWith("golden-catch.json")) return json;
      const table = json as GoldenCatchTable;
      return {
        ...table,
        combinations: table.combinations.map((row, index) =>
          index === 0 ? { ...row, chance: row.chance + 1 } : row,
        ),
      };
    });

    // A capture Java caught is recorded as escaped: the roll comparison is graded apart from the
    // chance, so this is its own disagreement.
    found.caughtFlipped = await count((file, json) => {
      if (!file.endsWith("golden-catch.json")) return json;
      const table = json as GoldenCatchTable;
      return {
        ...table,
        combinations: table.combinations.map((row, index) =>
          index === 0 ? { ...row, caught: !row.caught } : row,
        ),
      };
    });

    // Two catch input columns trade places, so the decoder reads debuff 1 where the referee wrote
    // debuff 2. Only the rows that distinguish the two statuses disagree, which is why this count sits
    // far below the row count and far above zero.
    found.catchColumnsSwapped = await count((file, json) => {
      if (!file.endsWith("golden-catch.json")) return json;
      const table = json as GoldenCatchTable;
      const swap = (row: GoldenCatchRow): GoldenCatchRow => {
        const input = row.input.slice();
        [input[5], input[6]] = [input[6], input[5]];
        return { ...row, input };
      };
      return {
        ...table,
        isolated: Object.fromEntries(
          Object.entries(table.isolated).map(([key, rows]) => [key, rows.map(swap)]),
        ),
        combinations: table.combinations.map(swap),
      };
    });

    // The catalog's item-5 column moves, so the outcome helper no longer answers what Java measured.
    found.experienceColumnMoved = await count((file, json) => {
      if (!isItemsCatalog(file)) return json;
      return withItemColumn(json, 3, 5, 2, 0);
    });

    // The same for item 11's capture bonus.
    found.captureColumnMoved = await count((file, json) => {
      if (!isItemsCatalog(file)) return json;
      return withItemColumn(json, 3, 11, 2, 0);
    });

    // Item 6's column moves. Nothing reads it as a multiplier, so the disagreement has to come from
    // the raw column check rather than from a formula that was never there.
    found.benchColumnMoved = await count((file, json) => {
      if (!isItemsCatalog(file)) return json;
      return withItemColumn(json, 3, 6, 2, 0);
    });

    // One evolution answer is rewritten.
    found.evolutionDrifted = await count((file, json) => {
      if (!file.endsWith("golden-flow.json")) return json;
      const table = json as GoldenFlowTable;
      return {
        ...table,
        evolution: table.evolution.map((row, index) =>
          index === 0 ? { ...row, requiredLevel: row.requiredLevel + 1 } : row,
        ),
      };
    });

    // One outcome answer is rewritten.
    found.outcomeDrifted = await count((file, json) => {
      if (!file.endsWith("golden-flow.json")) return json;
      const table = json as GoldenFlowTable;
      return { ...table, outcome: { ...table.outcome, lose3: 99 } };
    });

    // The ball table the chance formula reads `paramA` from is renamed, so the catalog comparison
    // notices even though no chance row moves.
    found.ballRenamed = await count((file, json) => {
      if (!file.endsWith("golden-catch.json")) return json;
      const table = json as GoldenCatchTable;
      return {
        ...table,
        itemTable: table.itemTable.map((row, index) =>
          index === 0 ? { ...row, name: "Cầu đổi tên" } : row,
        ),
      };
    });

    // Every count is a number a real run produced, and every one is above zero: a mutation the guard
    // cannot see is a hole in the guard, not a passing test.
    for (const [name, value] of Object.entries(found)) expect(value, name).toBeGreaterThan(0);
    expect(found).toEqual(MUTATION_COUNTS);
  });
});

/**
 * Measured from a real run, so a guard that quietly stops grading shows up as a changed count.
 *
 * The three single-row mutations each move one answer, and the column swaps move six of the 109 capture
 * rows: swapping the debuff-1 and debuff-2 inputs only shows up on a row where the 11/10 and 12/10
 * steps survive every later truncation, so most rows answer the same chance either way. The two
 * multiplier columns each produce two findings because the raw column and the gated helper are graded
 * as separate claims about the same number.
 */
const MUTATION_COUNTS: Record<string, number> = {
  awardDrifted: 1,
  chanceDrifted: 1,
  caughtFlipped: 1,
  catchColumnsSwapped: 6,
  experienceColumnMoved: 2,
  captureColumnMoved: 2,
  benchColumnMoved: 1,
  evolutionDrifted: 1,
  outcomeDrifted: 1,
  ballRenamed: 1,
};
