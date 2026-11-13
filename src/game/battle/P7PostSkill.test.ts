import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GameData } from "../../data/GameData";
import type {
  GoldenHeldItemsTable,
  GoldenPostSkillRow,
  GoldenPresentationRow,
  GoldenStatusPresentationTable,
  PackSkillRow,
} from "../../data/GameData";
import { Pack } from "../../pack/Pack";
import { planPostSkillResolution } from "./BattleActionEngine";
import type { BattleRules } from "./BattleRules";
import { loadBattleRules } from "./BattleRules";
import { BattleRandom } from "./BattleRandom";
import { p7PostEffectText, resolveP7PostSkill, type P7PostSkillOutcome } from "./P7PostSkill";
import type { StatusPresentationSlot } from "./StatusPresentation";
import { heldStatuses } from "./P7Strike";
import { BUFF_BANK, DEBUFF_BANK, inclusiveRollPasses, type StatusUnit } from "./StatusState";

const root = resolve(import.meta.dirname, "..", "..", "..");

/** A catalog edit standing in for a mistake a port could make, cleared once the rig is loaded. */
let mutation: ((file: string, json: unknown) => unknown) | undefined;

vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(root, "public", decodeURIComponent(input.replace(/^\//, "")));
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const value = mutation && file.endsWith(".json") ? mutation(file, parsed) : parsed;
  return { ok: true, status: 200, json: async () => value };
});

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The seven answers `planPostSkillResolution` returns, in the order the table writes them. */
const PLAN_FIELDS = [
  "mode",
  "heal",
  "buffId",
  "buffOwner",
  "sourceTargetSelf",
  "noDamageDebuff",
  "copyTargetBuffs",
] as const;

/** The four of those the runtime's own step answers with; the other three stay inside the engine. */
const STEP_FIELDS = ["mode", "heal", "buffId", "buffOwner"] as const;

function fieldDiffs(
  mine: unknown,
  expected: unknown,
  fields: readonly string[],
  where: string,
): string[] {
  const left = mine as Record<string, unknown>;
  const right = expected as Record<string, unknown>;
  const found: string[] = [];
  for (const field of fields)
    if (!same(left[field], right[field]))
      found.push(
        `${where} ${field} ${JSON.stringify(left[field])} != ${JSON.stringify(right[field])}`,
      );
  return found;
}

/** The gates the runtime drew before it asked the engine to resolve a route. */
type Gates = { attackHit: boolean; targetAvailable: boolean; leechRollPassed: boolean };

/**
 * `BattleUnit.setRandomTrace` picks its own rolls, so the rig picks a seed by the draw it needs and
 * reports when nothing in the probe range draws it — a case that cannot be walked is a case the
 * evidence does not reach, and a silent skip would grade nothing.
 */
function seedRolling(label: string, chance: number, pass: boolean): number | undefined {
  for (let seed = 0; seed < 300; seed++)
    if (inclusiveRollPasses(new BattleRandom(seed).percent(label), chance) === pass) return seed;
  return undefined;
}

/** The seed whose stream draws exactly the roll a Java referee row drew, so both walk one value. */
function seedDrawing(label: string, roll: number): number | undefined {
  for (let seed = 0; seed < 300; seed++)
    if (new BattleRandom(seed).percent(label) === roll) return seed;
  return undefined;
}

/** One projected strip against the Java row that walked the same statuses. */
function stripDiffs(
  label: string,
  expected: GoldenPresentationRow,
  actual: readonly StatusPresentationSlot[],
): string[] {
  if (expected.slots.length !== actual.length)
    return [
      `${label} shows ${actual.length} slot(s), Java shows ${expected.slots.length}: ` +
        `${actual.map((slot) => slot.stableKey).join(",")} != ` +
        `${expected.slots.map((slot) => slot.stableKey).join(",")}`,
    ];
  const found: string[] = [];
  for (const [index, slot] of expected.slots.entries()) {
    const mine = actual[index] as unknown as Record<string, unknown>;
    for (const [field, value] of Object.entries(slot as unknown as Record<string, unknown>)) {
      if (field === "index") continue;
      if (!same(mine[field], value))
        found.push(
          `${label}/${index} ${field} ${JSON.stringify(mine[field])} != ${JSON.stringify(value)}`,
        );
    }
  }
  return found;
}

/** The route the pack carries for one skill, in the columns the step reads. */
type PackRoute = {
  mode: string;
  effectId: number;
  buffIdWhenAttackMissed: number;
  leechGateChance: number;
};

class Rig {
  private constructor(
    readonly rules: BattleRules,
    readonly golden: GoldenStatusPresentationTable,
    readonly skillRows: Map<number, PackSkillRow>,
    readonly heldItems: GoldenHeldItemsTable,
  ) {}

  static async load(mutate?: (file: string, json: unknown) => unknown): Promise<Rig> {
    mutation = mutate;
    try {
      const data = new GameData(await Pack.load());
      const [rules, golden, skills, heldItems] = await Promise.all([
        loadBattleRules(data, { web: false }),
        data.goldenStatusPresentation(),
        data.skillRows(),
        data.goldenHeldItems(),
      ]);
      return new Rig(
        rules,
        golden,
        new Map(skills.rows.map((row) => [row.skillId, row])),
        heldItems,
      );
    } finally {
      mutation = undefined;
    }
  }

  /** Java's answer for one route under one set of gates. */
  row(skillId: number, gates: Gates): GoldenPostSkillRow {
    const found = this.golden.postSkillResolution.find(
      (row) =>
        row.inputs.skillId === skillId &&
        row.inputs.attackHit === gates.attackHit &&
        row.inputs.targetAvailable === gates.targetAvailable &&
        row.inputs.leechRollPassed === gates.leechRollPassed,
    );
    if (!found)
      throw new Error(
        `the table has no post-skill row for skill ${skillId} with ${JSON.stringify(gates)}`,
      );
    return found;
  }

  /**
   * One of the two live units. The pair is pinned so the attacker's base attack against the other is
   * the `attackerBaseAttack` the probe resolved for its own level-20 pair, which is the number every
   * `HEAL_FROM_ATTACK` row is a percent of. A self-aimed skill reads the same pair off one unit.
   */
  unit(side: 0 | 1, holdsItem?: number): StatusUnit {
    return this.rules.status.unit({
      speciesId: side === 0 ? this.golden.unit.attackerSpecies : this.golden.unit.targetSpecies,
      ownerSide: side,
      formationSlot: 0,
      heldItemId: holdsItem,
      base: {
        hp: 100,
        attack: side === 0 ? this.golden.unit.attackerBaseAttack + 100 : 100,
        defense: 100,
        speed: 100,
      },
    });
  }

  /**
   * The rows Java's own held-item table walked for one producer against one item. Each carries the roll
   * it drew and whether the status landed, so a walk replays one of them and is graded against it.
   */
  private javaProducerRows(skillId: number, debuffId: number, item: number) {
    const rows = this.heldItems.debuffApply.filter(
      (row) => row.skillId === skillId && row.debuffId === debuffId && row.item === item,
    );
    if (!rows.length)
      throw new Error(
        `the held-item table never walked ${skillId}/${debuffId} against item ${item}`,
      );
    return rows;
  }

  /** `applyP7PostSkillEffects` for one finished action, with the stream it drew on. */
  step(request: {
    skillId: number;
    attacker: StatusUnit;
    target: StatusUnit;
    attackHit: boolean;
    damage: number;
    seed?: number;
  }): {
    outcome: P7PostSkillOutcome;
    draws: readonly string[];
    text: string;
    textOnPlayerSide: boolean;
  } {
    const random = new BattleRandom(request.seed ?? 0),
      outcome = resolveP7PostSkill({
        attacker: request.attacker,
        target: request.target,
        skillId: request.skillId,
        rules: this.rules,
        random,
        context: `battle.P7.skill${request.skillId}`,
        // The two sprites only feed the final-form crit chance inside the damage formula, which this
        // step never calls, so the rig hands it the pair the fight would have drawn.
        attackerSpriteId: 10,
        receiverSpriteId: 20,
        attackHit: request.attackHit,
        damage: request.damage,
      }),
      effect = p7PostEffectText(outcome, request.attacker.hp());
    return {
      outcome,
      draws: random.draws(),
      text: effect.text,
      textOnPlayerSide: effect.playerSide,
    };
  }

  held(unit: StatusUnit) {
    return heldStatuses(unit);
  }

  /** The Java row that walked a unit carrying exactly this one status. */
  private singleStatusRow(bank: number, numericId: number) {
    return this.golden.presentation.find(
      (row) =>
        row.suppressionActions === 0 &&
        row.held.length === 1 &&
        row.held[0].bank === bank &&
        row.held[0].numericId === numericId,
    );
  }

  /** What a unit must be left carrying, graded through the strip Java drew for the same status. */
  private carries(unit: StatusUnit, bank: number, numericId: number): string[] {
    const held = this.held(unit),
      row = this.singleStatusRow(bank, numericId);
    if (!row) return [`no Java strip walks ${bank}/${numericId} alone (${JSON.stringify(held)})`];
    if (!same(row.held, held))
      return [`holds ${JSON.stringify(held)} where ${row.label} is ${JSON.stringify(row.held)}`];
    return stripDiffs(row.label, row, this.rules.presentation.project(unit));
  }

  private carriesNothing(unit: StatusUnit): string[] {
    const held = this.held(unit);
    return held.length === 0
      ? []
      : [`holds ${JSON.stringify(held)} after a route that plants nothing`];
  }

  /**
   * The stream the step drew with the strike's own label prefix taken back off it, against the draws
   * Java recorded for the same producer — so a roll asked for where Java asks for none is a finding.
   */
  private producerDraws(mine: readonly string[], expected: readonly string[], context: string) {
    const relative = mine.map((draw) =>
      draw.startsWith(`${context}.`) ? draw.slice(context.length + 1) : draw,
    );
    return same(relative, expected)
      ? []
      : [`drew ${JSON.stringify(relative)}, Java drew ${JSON.stringify(expected)}`];
  }

  /** The name the runtime prints for one status row, read off the table instead of typed here. */
  private effectName(bank: number, numericId: number): string {
    const row = this.golden.effectNames.find((r) => r.bank === bank && r.numericId === numericId);
    if (!row) throw new Error(`the table never asked for the name of ${bank}/${numericId}`);
    return row.effectRowName;
  }

  /** Every Java row this port's engine answers differently, one line per disagreeing row. */
  planDisagreements(): string[] {
    const found: string[] = [];
    for (const row of this.golden.postSkillResolution) {
      const inputs = row.inputs,
        route = this.rules.status.postSkillRoute(inputs.skillId),
        skill = this.skillRows.get(inputs.skillId),
        wrong: string[] = [];
      if (!route) wrong.push("Java routed it " + row.routeMode + ", the pack has no route");
      else {
        if (route.mode !== row.routeMode) wrong.push(`the pack route says ${route.mode}`);
        if (route.effectId !== inputs.effectId) wrong.push(`the route carries ${route.effectId}`);
      }
      if (!skill) wrong.push("the pack has no skill row");
      else if (skill.effectMode !== inputs.effectMode || skill.effectId !== inputs.effectId)
        wrong.push(
          `the pack row is mode ${skill.effectMode}/effect ${skill.effectId}, the probe read ` +
            `${inputs.effectMode}/${inputs.effectId}`,
        );
      else if (skill.chanceOrParam !== inputs.chanceOrParam)
        wrong.push(
          `the pack row's parameter is ${skill.chanceOrParam}, the probe read ${inputs.chanceOrParam}`,
        );
      if (route && skill)
        wrong.push(
          ...fieldDiffs(
            planPostSkillResolution({
              route,
              chanceOrParam: inputs.chanceOrParam,
              attackerBaseAttack: this.golden.unit.attackerBaseAttack,
              damage: inputs.damage,
              leechRollPassed: inputs.leechRollPassed,
              targetAvailable: inputs.targetAvailable,
              attackHit: inputs.attackHit,
            }),
            row,
            PLAN_FIELDS,
            "plan",
          ),
        );
      if (wrong.length)
        found.push(
          `post-skill ${inputs.skillId} hit=${inputs.attackHit} target=${inputs.targetAvailable} ` +
            `leech=${inputs.leechRollPassed}: ${wrong.join("; ")}`,
        );
    }
    return found;
  }

  /**
   * The step run the way the fight runs it: two live units, the route spent, and what the pair is left
   * carrying, showing and drawing — each against the Java rows for the same route and gates.
   */
  stepCases(): Array<{ label: string; diffs: string[] }> {
    const cases: Array<{ label: string; diffs: string[] }> = [],
      add = (label: string, ...diffs: string[][]) => cases.push({ label, diffs: diffs.flat() }),
      // The gates the live cases below are all walked under, except where a case names its own.
      gates: Gates = { attackHit: true, targetAvailable: true, leechRollPassed: false };

    // A self-aimed buff is the case the player sees: the caster carries it and the caster's own side
    // of the screen prints the row's name.
    {
      const caster = this.unit(0),
        enemy = this.unit(1),
        { outcome, draws, text, textOnPlayerSide } = this.step({
          skillId: 45,
          attacker: caster,
          target: caster,
          attackHit: true,
          damage: 0,
        }),
        expected = this.row(45, gates);
      add(
        "skill 45 buffs the unit that cast it",
        fieldDiffs(outcome, expected, STEP_FIELDS, "step"),
        this.carries(caster, BUFF_BANK, expected.buffId),
        this.carriesNothing(enemy),
        draws.length === 0 ? [] : [`a plain install drew ${JSON.stringify(draws)}`],
        text === this.effectName(BUFF_BANK, expected.buffId) ? [] : [`prints "${text}"`],
        textOnPlayerSide ? [] : ["prints the buff over the other side"],
      );
    }

    // An attacker-side buff is the route that answers differently on a miss, so both are walked.
    {
      const caster = this.unit(0),
        enemy = this.unit(1),
        hit = this.step({
          skillId: 21,
          attacker: caster,
          target: enemy,
          attackHit: true,
          damage: 50,
        }),
        hitRow = this.row(21, gates),
        missedCaster = this.unit(0),
        missed = this.step({
          skillId: 21,
          attacker: missedCaster,
          target: this.unit(1),
          attackHit: false,
          damage: 50,
        }),
        missedRow = this.row(21, { ...gates, attackHit: false });
      add(
        "skill 21 buffs its caster on a hit",
        fieldDiffs(hit.outcome, hitRow, STEP_FIELDS, "step"),
        this.carries(caster, BUFF_BANK, hitRow.buffId),
        this.carriesNothing(enemy),
        hit.text === this.effectName(BUFF_BANK, hitRow.buffId) ? [] : [`prints "${hit.text}"`],
      );
      add(
        "skill 21 installs nothing when it misses",
        fieldDiffs(missed.outcome, missedRow, STEP_FIELDS, "step"),
        this.carriesNothing(missedCaster),
        missed.text === "" ? [] : [`a missed buff route prints "${missed.text}"`],
      );
    }

    // The no-damage producer is the arm that rolls, and it rolls under the strike's own label. The
    // chance it rolls against is the producer's own, held back by whatever the aimed unit wears, so
    // `golden-held-items.json.debuffApply` is walked on both of its items and both of its answers: the
    // chance that asks for no roll at all, the roll that still lands, and the roll that saves the unit.
    {
      const effectId = this.skillRows.get(54)!.effectId,
        expected = this.row(54, gates),
        context = "battle.P7.skill54",
        walk = (item: number, planned: boolean) => {
          const rows = this.javaProducerRows(54, effectId, item).filter(
            (row) => row.planned === planned,
          );
          if (!rows.length)
            return [
              `the held-item table has no ${planned ? "" : "un"}planned row for item ${item}`,
            ];
          // The row closest to the chance, because that is the boundary a wrong comparison misses.
          const java = rows.reduce((closest, row) =>
              (row.roll - closest.roll) * (planned ? 1 : -1) > 0 ? row : closest,
            ),
            seed = java.draws.length ? seedDrawing(`${context}.damage.debuff`, java.roll) : 0;
          if (seed === undefined)
            return [`no seed in the probe range draws the roll ${java.roll} Java drew`];
          const caster = this.unit(0),
            enemy = this.unit(1, item),
            step = this.step({
              skillId: 54,
              attacker: caster,
              target: enemy,
              attackHit: true,
              damage: 0,
              seed,
            });
          return [
            ...fieldDiffs(step.outcome, expected, STEP_FIELDS, "step"),
            ...(java.active
              ? this.carries(enemy, DEBUFF_BANK, effectId)
              : this.carriesNothing(enemy)),
            ...this.carriesNothing(caster),
            ...(java.active
              ? step.text === this.effectName(DEBUFF_BANK, effectId)
                ? []
                : [`prints "${step.text}"`]
              : step.text === ""
                ? []
                : [`a refused producer prints "${step.text}"`]),
            ...(java.active && step.textOnPlayerSide
              ? ["prints the debuff over the caster's side"]
              : []),
            ...this.producerDraws(step.draws, java.draws, context),
          ];
        };
      add("skill 54 lands its debuff and asks for no roll", walk(-1, true));
      add("skill 54 still lands through the item that holds it back", walk(3, true));
      add("skill 54 plants nothing when the roll saves the unit it was aimed at", walk(3, false));
    }

    // The leech is the route the runtime gates with a roll of its own, drawn before the plan is asked.
    {
      const chance = this.rules.status.postSkillRoute(52)!.leechGateChance,
        label = "battle.P7.skill52_58.leechGate",
        // A leech is a percent of the hit the damage step committed, so the walk feeds the step the
        // very damage the probe resolved its `heal` column from, and starts the caster low enough for
        // that heal to land whole.
        damage = this.golden.unit.damage,
        hpStart = 30;
      for (const leechRollPassed of [true, false]) {
        const seed = seedRolling(label, chance, leechRollPassed);
        if (seed === undefined) {
          add(`skill 52 with the leech gate ${leechRollPassed ? "passed" : "refused"}`, [
            `no seed in the probe range rolls a ${leechRollPassed ? "passing" : "failing"} ${chance}`,
          ]);
          continue;
        }
        const caster = this.unit(0),
          enemy = this.unit(1);
        caster.setHp(hpStart);
        const step = this.step({
            skillId: 52,
            attacker: caster,
            target: enemy,
            attackHit: true,
            damage,
            seed,
          }),
          expected = this.row(52, { ...gates, leechRollPassed });
        add(
          `skill 52 with the leech gate ${leechRollPassed ? "passed" : "refused"}`,
          fieldDiffs(step.outcome, expected, STEP_FIELDS, "step"),
          this.carriesNothing(caster),
          this.carriesNothing(enemy),
          step.draws.length === 1 && step.draws[0].startsWith(`${label}=`)
            ? []
            : [`drew ${JSON.stringify(step.draws)}`],
          caster.hp() === hpStart + expected.heal
            ? []
            : [`the caster stands at ${caster.hp()} after a heal of ${expected.heal}`],
          step.text === (expected.heal > 0 ? `+${expected.heal}` : "")
            ? []
            : [`prints "${step.text}" for a heal of ${expected.heal}`],
        );
      }
    }

    // A heal with no status behind it is the one case the widget takes from the plan, not from a name.
    {
      const expected = this.row(11, gates),
        caster = this.unit(0);
      caster.setHp(50);
      const step = this.step({
          skillId: 11,
          attacker: caster,
          target: this.unit(1),
          attackHit: true,
          damage: 60,
        }),
        full = this.unit(0),
        clipped = this.step({
          skillId: 11,
          attacker: full,
          target: this.unit(1),
          attackHit: true,
          damage: 60,
        });
      add(
        "skill 11 heals its caster and prints the amount",
        fieldDiffs(step.outcome, expected, STEP_FIELDS, "step"),
        this.carriesNothing(caster),
        step.draws.length === 0 ? [] : [`a route heal drew ${JSON.stringify(step.draws)}`],
        caster.hp() === 50 + expected.heal ? [] : [`the caster stands at ${caster.hp()}`],
        step.text === `+${expected.heal}` ? [] : [`prints "${step.text}"`],
        step.textOnPlayerSide ? [] : ["prints the heal over the other side"],
        // `projectBattleHealing` is the identity for a unit with no charm, so the widget keeps the
        // amount the plan asked for even where the bar cannot rise any further.
        clipped.text === `+${expected.heal}` ? [] : [`a full bar prints "${clipped.text}"`],
        full.hp() === 100 ? [] : [`a full bar rose to ${full.hp()}`],
      );
    }

    // A skill the engine routes nowhere is the common case, and it must cost the fight nothing.
    {
      const caster = this.unit(0),
        enemy = this.unit(1),
        step = this.step({
          skillId: 40,
          attacker: caster,
          target: enemy,
          attackHit: true,
          damage: 99,
        });
      add(
        "skill 40 leaves nothing behind",
        step.outcome.mode === "NONE" && step.outcome.buffId === -1 && step.outcome.heal === 0
          ? []
          : [`resolved as ${JSON.stringify(step.outcome)}`],
        this.carriesNothing(caster),
        this.carriesNothing(enemy),
        step.draws.length === 0 ? [] : [`an unrouted skill drew ${JSON.stringify(step.draws)}`],
        step.text === "" ? [] : [`an unrouted skill prints "${step.text}"`],
      );
    }
    return cases;
  }

  stepDisagreements(): string[] {
    const found: string[] = [];
    for (const { label, diffs } of this.stepCases())
      if (diffs.length) found.push(`${label}: ${diffs.join("; ")}`);
    return found;
  }
}

describe("post-skill step", () => {
  it("resolves every routed skill the way the engine does", async () => {
    const rig = await Rig.load();
    expect(rig.planDisagreements()).toEqual([]);
    // both ends of the walk are in the table: every route the pack carries, and both ends of each gate
    const rows = rig.golden.postSkillResolution,
      skills = new Set(rows.map((row) => row.inputs.skillId)),
      modesInTable = [...new Set(rows.map((row) => row.routeMode))].sort(),
      modesInPack = [
        ...new Set(
          [...skills]
            .map((skillId) => rig.rules.status.postSkillRoute(skillId)!.mode)
            .filter((mode) => mode !== "NONE"),
        ),
      ].sort();
    expect(rows.length).toBe(192);
    expect(skills.size).toBe(24);
    // Java's own route label per skill, against the mode the pack route for the same skill carries. The
    // engine's switch has one mode more than either, and it is the one no routed skill answers with.
    expect(modesInTable).toEqual(modesInPack);
    expect(modesInTable.length).toBeGreaterThan(1);
    for (const skillId of skills)
      expect(rows.filter((row) => row.inputs.skillId === skillId).length).toBe(8);
    expect(rows.filter((row) => row.inputs.attackHit === false).length).toBe(96);
    expect(rows.some((row) => row.heal > 0)).toBe(true);
  });

  it("spends the route on live units the way the source spends it", async () => {
    const rig = await Rig.load();
    expect(rig.stepDisagreements()).toEqual([]);
    expect(rig.stepCases().map((item) => item.label)).toEqual([
      "skill 45 buffs the unit that cast it",
      "skill 21 buffs its caster on a hit",
      "skill 21 installs nothing when it misses",
      "skill 54 lands its debuff and asks for no roll",
      "skill 54 still lands through the item that holds it back",
      "skill 54 plants nothing when the roll saves the unit it was aimed at",
      "skill 52 with the leech gate passed",
      "skill 52 with the leech gate refused",
      "skill 11 heals its caster and prints the amount",
      "skill 40 leaves nothing behind",
    ]);
  });

  it("is graded by a step that can be broken", async () => {
    /**
     * Every count is measured off a real run. A route is read by the eight rows of its skill in the
     * plan table, while the live walk only sees what the step spends, so the two columns say how much
     * of the evidence each edit reaches.
     */
    const count = async (mutate: (file: string, json: unknown) => unknown) => {
      const rig = await Rig.load(mutate);
      return { plan: rig.planDisagreements().length, step: rig.stepDisagreements().length };
    };
    const route = (file: string, json: unknown, skillId: number): PackRoute | undefined => {
      if (!/status-mechanics\.json$/.test(file)) return undefined;
      return (
        json as { postSkillRoutes: Array<{ skillId: number } & PackRoute> }
      ).postSkillRoutes.find((row) => row.skillId === skillId);
    };

    /** Aim the caster's buff at the status next door: the name, the cell and the plan all move. */
    const wrongBuff = await count((file, json) => {
      const edited = route(file, json, 45);
      if (edited) edited.effectId = 8;
      return json;
    });
    /** Route a target buff as the attacker's own, which is the owner the step plants on. */
    const wrongOwner = await count((file, json) => {
      const edited = route(file, json, 45);
      if (edited) edited.mode = "APPLY_ATTACKER_BUFF";
      return json;
    });
    /** Install the buff on a miss for a route that promises it only on a hit. */
    const missInstalls = await count((file, json) => {
      const edited = route(file, json, 21);
      if (edited) edited.buffIdWhenAttackMissed = 4;
      return json;
    });
    /** Widen the leech gate until it can never refuse, which is the roll leaving the walk. */
    const gateAlwaysPasses = await count((file, json) => {
      const edited = route(file, json, 52);
      if (edited) edited.leechGateChance = 100;
      return json;
    });
    /** Read the heal percent off the wrong column, the parameter the plan divides by. */
    const wrongParameter = await count((file, json) => {
      if (!/skill-rows\.json$/.test(file)) return json;
      (json as { rows: PackSkillRow[] }).rows.find((row) => row.skillId === 11)!.chanceOrParam = 11;
      return json;
    });
    /** Cut the producer's own chance, which moves both the roll and what the roll is graded against. */
    const producerChanceCut = await count((file, json) => {
      if (!/debuff-producers\.json$/.test(file)) return json;
      (
        json as { producers: Array<{ skillId: number; debuffId: number; chance: number }> }
      ).producers.find((row) => row.skillId === 54 && row.debuffId === 8)!.chance = 50;
      return json;
    });

    // Measured off the runs above. The plan column is the eight rows of the edited skill in the Java
    // table, the step column the live walks that spend it; the two gate edits are invisible to the plan
    // because the plan is handed the gate as an answer, which is exactly why the walk exists.
    expect({
      wrongBuff,
      wrongOwner,
      missInstalls,
      gateAlwaysPasses,
      wrongParameter,
      producerChanceCut,
    }).toEqual({
      wrongBuff: { plan: 8, step: 1 },
      wrongOwner: { plan: 8, step: 1 },
      missInstalls: { plan: 4, step: 1 },
      gateAlwaysPasses: { plan: 0, step: 1 },
      wrongParameter: { plan: 8, step: 1 },
      producerChanceCut: { plan: 0, step: 2 },
    });
  });
});
