import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GameData } from "../../data/GameData";
import type {
  GoldenPhysicalTraitRow,
  GoldenPhysicalTraitStep,
  GoldenPhysicalTraitsTable,
  GoldenPhysicalTraitUnitState,
  GoldenTalentState,
  GoldenTraitUnitState,
} from "../../data/GameData";
import { Pack } from "../../pack/Pack";
import { DesignTraitMechanics, type DesignTraitUnitSeed } from "./DesignTraits";
import type { DesignTraitUnit } from "./DesignTraits";
import {
  DesignTraitProjection,
  type DesignTraitDamageKind,
  type DesignTraitFormation,
} from "./DesignTraitProjection";
import { type PhysicalTraitFamily } from "./PhysicalTraits";
import { StatusEffects, toShort, type MutableStat, type StatusDefinition } from "./StatusState";
import { TraitLifecycleDispatcher } from "./TraitDispatcher";

const root = resolve(import.meta.dirname, "..", "..", "..");

/** A catalog edit standing in for a mistake a port could make, cleared once the rig is loaded. */
let mutation: ((file: string, json: unknown) => unknown) | undefined;

vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(root, "public", decodeURIComponent(input.replace(/^\//, "")));
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const value = mutation && file.endsWith(".json") ? mutation(file, parsed) : parsed;
  return { ok: true, status: 200, json: async () => value };
});

/** `BattleUnit`'s stat indices, which the `baseStat` op addresses by number. */
const STAT_HP = 1;
const STAT_ATTACK = 2;
const STAT_DEFENSE = 3;
const STAT_SPEED = 4;

const MUTABLE_STATS: Record<number, MutableStat> = {
  [STAT_ATTACK]: "attack",
  [STAT_DEFENSE]: "defense",
  [STAT_SPEED]: "speed",
};

/** How many disagreements each deliberate mistake produces, taken from a real run. */
const MUTATION_COUNTS: Record<string, number> = {
  wrongStatPercent: 25,
  wrongHealCap: 4,
  wrongTriggerChance: 6,
  dispatcherOff: 987,
};

/**
 * `ProbeWebBattleMath`'s eleven physical families, so a row the table records under a name the port
 * does not have is a failure rather than a string the switch never matches. Declaring the map against
 * `PhysicalTraitFamily` is what makes it exhaustive: dropping a family from the union fails the build.
 */
const FAMILIES: Record<PhysicalTraitFamily, true> = {
  NO_EFFECT: true,
  PERMANENT_STAT_PERCENT: true,
  HEALING_RECEIVED_PERCENT: true,
  ROUND_END_PASSIVE_HEAL: true,
  DAMAGE_ACCURACY_TRADEOFF: true,
  CHANCE_INCOMING_DIRECT_DAMAGE_PERCENT: true,
  CHANCE_REVIVE_ON_FAINT: true,
  EXPERIENCE_MULTIPLIER: true,
  LOW_HP_SELF_DAMAGE_ONCE: true,
  AGILITY_OUTRANK_PRIORITY_DAMAGE_BONUS: true,
  HARD_CONTROL_IMMUNITY_DIRECT_DAMAGE_REDUCTION: true,
};

/** `ProbeWebBattleMath.statusRows`: sorted by bank and id, so the bytes cannot depend on order. */
function statusRows(unit: DesignTraitUnit): string[] {
  const rows: [key: number, row: string][] = [];
  for (const bank of [0, 1, 2]) {
    for (const status of unit.statuses.snapshot(bank)) {
      rows.push([
        bank * 1000 + status.definition.sourceNumericId,
        [
          bank,
          status.definition.sourceNumericId,
          status.remainingTurns,
          status.remainingActions,
          status.primaryValue,
          status.secondaryValue,
          status.stackCount,
          status.sourceSide,
          status.sourceSlot,
          status.sourceSkillId,
          status.flags,
        ].join(":"),
      ]);
    }
  }
  return rows.sort((a, b) => a[0] - b[0]).map(([, row]) => row);
}

const bit = (value: boolean): number => (value ? 1 : 0);

/** `ProbeWebBattleMath.otherState`: the fields every unit in the run carries. */
function otherState(unit: DesignTraitUnit): GoldenTraitUnitState {
  return {
    hp: unit.hp(),
    alive: unit.alive(),
    side: unit.ownerSide,
    slot: unit.formationSlot,
    form: unit.heldItemId,
    ss: statusRows(unit),
  };
}

/** `ProbeWebBattleMath.fullState`: the talent owner's whole observable state. */
function fullState(unit: DesignTraitUnit): GoldenTraitUnitState {
  const state = unit.designTraitState;
  const signature = unit.signatureState;
  return {
    ...otherState(unit),
    atk: unit.currentStats.attack,
    def: unit.currentStats.defense,
    spd: unit.currentStats.speed,
    pp: [...unit.skillPp],
    st: [
      bit(state.enabled),
      bit(state.entryAttack),
      bit(state.entryGuard),
      bit(state.thresholdUsed),
      state.lastProc,
      state.procs,
      state.lastGuard,
      state.lastCharge,
      state.round,
      state.actedRound,
      state.previousSkill,
      state.combo,
      bit(state.actedFirst),
      bit(state.pendingPowerUsed),
      bit(state.hpTrade),
      bit(state.lowPowerTrade),
      bit(state.actionOpen),
      bit(state.targetOwnDot),
      bit(state.actionSucceeded),
      state.pendingPower,
      state.pendingBonus,
      state.targetHpBefore,
      state.directCommitted,
      bit(state.dispelledBySkill),
      state.actorDebuffsBefore,
      state.targetDebuffsBefore,
      state.targetBuffsBefore,
    ],
    mask: unit.statusMaskValue(),
    sg: [
      bit(signature.pendingPivot),
      signature.pivotShieldPct,
      signature.pivotShieldDuration,
      bit(signature.secondaryHit),
      signature.round,
    ],
  };
}

/**
 * `ProbeWebBattleMath.talentState`, in the probe's own field order because `tt` is compared as one
 * value. Java reads the passive-heal ledger by reflection, since it has no getter; asking the port for
 * the round that is open returns the same number, because a claim resets it on any other round.
 */
function talentState(unit: DesignTraitUnit): GoldenTalentState {
  const state = unit.traitBattleState;
  return {
    psa: bit(state.permanentStatsApplied()),
    phr: state.passiveHealRoundIndex(),
    phc: state.passiveHealingCommitted(state.passiveHealRoundIndex()),
    ru: state.reviveUses(),
    lha: bit(state.lowHpThresholdAttempted()),
    cs: [
      bit(state.hasCanonicalStatus("burn")),
      bit(state.hasCanonicalStatus("corrosion")),
      bit(state.hasCanonicalStatus("petrification")),
      bit(state.hasCanonicalStatus("bind")),
      bit(state.hasCanonicalStatus("paralysis")),
    ],
  };
}

/** `ProbeWebBattleMath.appendTalentSnapshot`, laid over whichever half of the unit state this is. */
function talentSnapshot(unit: DesignTraitUnit, actor: boolean): GoldenPhysicalTraitUnitState {
  return {
    ...(actor ? fullState(unit) : otherState(unit)),
    mh: unit.maxHp(),
    bs: [unit.baseStats.hp, unit.baseStats.attack, unit.baseStats.defense, unit.baseStats.speed],
    tt: talentState(unit),
  };
}

/** Compare only the fields the recorded step carries, and say so when the port has no answer. */
function grade(found: string[], label: string, mine: unknown, row: unknown): void {
  for (const field of Object.keys(row as Record<string, unknown>)) {
    if (!(field in (mine as Record<string, unknown>))) {
      found.push(`${label} has no answer for ${field}`);
      continue;
    }
    const actual = (mine as Record<string, unknown>)[field];
    const expected = (row as Record<string, unknown>)[field];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      found.push(`${label} ${field} ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
    }
  }
}

type Result = number | boolean | (number | boolean)[];

/** Three of the ops answer with a context reduced to a list, so equality is not identity. */
function sameResult(actual: Result | undefined, expected: Result | undefined): boolean {
  return Array.isArray(expected)
    ? JSON.stringify(actual) === JSON.stringify(expected)
    : actual === expected;
}

/**
 * The labelled percent draws one row makes. The probe pins every draw in a scenario to that row's
 * roll, so the port has to ask for the same labels in the same order and no others: a talent that
 * rolls when the engine short-circuited is a difference even when the number it lands on agrees.
 */
class RandomRecorder {
  private roll = 0;
  private readonly drawn: string[] = [];

  percent(label: string): number {
    this.drawn.push(label);
    return this.roll;
  }

  begin(row: GoldenPhysicalTraitRow): void {
    this.roll = row.roll;
    this.drawn.length = 0;
  }

  finish(found: string[], label: string, row: GoldenPhysicalTraitRow): void {
    if (JSON.stringify(this.drawn) !== JSON.stringify(row.randomLabels)) {
      found.push(
        `${label} drew ${JSON.stringify(this.drawn)} and the engine drew ${JSON.stringify(
          row.randomLabels,
        )}`,
      );
    }
  }
}

/** One recorded scenario, replayed against the two combatants the table declares. */
class TalentRun {
  private readonly units = new Map<string, DesignTraitUnit>();
  private projection: DesignTraitProjection | undefined;

  constructor(
    private readonly mechanics: DesignTraitMechanics,
    private readonly randomPercent: (label: string) => number,
    private readonly dispatcher: TraitLifecycleDispatcher,
    private readonly golden: GoldenPhysicalTraitsTable,
    speciesId: number,
    physicalTraitId: number,
  ) {
    const template = golden.unitTemplate;
    this.units.set(
      "a",
      this.build(speciesId, physicalTraitId, template.actorSide, template.actorSide),
    );
    this.units.set(
      "t",
      this.build(
        template.dummySpecies,
        template.dummyPhysicalTraitId,
        template.dummySide,
        template.dummySide,
      ),
    );
  }

  /** `ProbeWebBattleMath.traitUnit`, built from the template the table itself declares. */
  private build(
    speciesId: number,
    physicalTraitId: number,
    side: number,
    slot: number,
  ): DesignTraitUnit {
    const template = this.golden.unitTemplate;
    const seed: DesignTraitUnitSeed = {
      speciesId,
      ownerSide: side,
      formationSlot: slot,
      base: {
        hp: template.maxHp,
        attack: template.attack,
        defense: template.defense,
        speed: template.speed,
      },
      // The probe leaves `baseStats[STAT_FORM]` at the zeroed array default, so its units hold item 0.
      heldItemId: 0,
      physicalTraitId,
      skillIds: [template.skill, 0, 0, 0, 0],
      skillPp: [template.skillPp, 0, 0, 0, 0],
      selectedSkillId: template.skill,
    };
    const unit = this.mechanics.unit(seed);
    unit.setHp(template.hp);
    return unit;
  }

  state(): Map<string, GoldenPhysicalTraitUnitState> {
    const out = new Map<string, GoldenPhysicalTraitUnitState>();
    for (const [name, unit] of this.units) out.set(name, talentSnapshot(unit, name === "a"));
    return out;
  }

  /** One op, and the value the engine answered with. */
  dispatch(step: GoldenPhysicalTraitStep): Result | undefined {
    const args = step.args;
    switch (step.op) {
      case "hp": {
        const unit = this.unit(args, 0);
        unit.setHp(this.num(args, 1));
        return unit.hp();
      }
      case "damage": {
        const unit = this.unit(args, 0);
        unit.damage(this.num(args, 1));
        return unit.hp();
      }
      case "baseStat": {
        const unit = this.unit(args, 0);
        const index = this.num(args, 1);
        if (index === STAT_HP) unit.baseStats.hp = toShort(this.num(args, 2));
        else unit.baseStats[this.statKey(index)] = toShort(this.num(args, 2));
        return undefined;
      }
      case "status":
        this.mechanics.put(
          this.unit(args, 0),
          this.definition(this.num(args, 1), this.num(args, 2)),
          this.golden.statusTurns,
          this.num(args, 3),
          1,
          this.unit(args, 4),
        );
        return undefined;
      case "beginAction": {
        const actor = this.unit(args, 0);
        const skill = this.num(args, 2);
        actor.selectedSkillId = skill;
        this.mechanics.beginAction(actor, this.unit(args, 1), skill, this.bool(args, 3));
        return undefined;
      }
      case "projection":
        this.projection = new DesignTraitProjection(
          this.mechanics,
          this.text(args, 0) as DesignTraitFormation,
          this.randomPercent,
          this.dispatcher.registry,
        );
        return undefined;
      case "projEnter":
        this.projectionOf(step).onBattleEnter(
          this.unit(args, 0),
          this.num(args, 1),
          this.num(args, 2),
          this.num(args, 3),
        );
        return undefined;
      case "projPermanentStats": {
        const context = this.projectionOf(step).projectPermanentStats(
          this.unit(args, 0),
          this.num(args, 1),
          this.num(args, 2),
          this.num(args, 3),
          this.num(args, 4),
          this.num(args, 5),
          this.num(args, 6),
          this.num(args, 7),
        );
        return [context.maxHp, context.strength, context.defense, context.agility];
      }
      case "projAccuracy": {
        const context = this.projectionOf(step).projectAccuracyAndEvasion(
          this.unit(args, 0),
          this.num(args, 1),
          this.unit(args, 2),
          this.num(args, 3),
          this.num(args, 4),
          this.num(args, 5),
          this.num(args, 6),
          this.num(args, 7),
        );
        return [context.accuracyPercent, context.evasionPercent];
      }
      case "projExperience": {
        const context = this.projectionOf(step).projectExperience(
          this.unit(args, 0),
          this.num(args, 1),
          this.num(args, 2),
          this.num(args, 3),
        );
        return [context.multiplierPercent, context.stackable];
      }
      case "projBefore":
        return this.projectionOf(step).beforeDirectDamage(
          this.unit(args, 0),
          this.num(args, 1),
          this.unit(args, 2),
          this.num(args, 3),
          this.num(args, 4),
          this.num(args, 5),
          this.num(args, 6),
          this.num(args, 7),
        );
      case "projBeforeDamage":
        return this.projectionOf(step).beforeDamage(
          this.unit(args, 0),
          this.num(args, 1),
          this.unit(args, 2),
          this.num(args, 3),
          this.num(args, 4),
          this.num(args, 5),
          this.num(args, 6),
          this.num(args, 7),
          this.text(args, 8) as DesignTraitDamageKind,
        );
      case "projAfterDamage":
        this.projectionOf(step).afterDamage(
          this.unit(args, 0),
          this.num(args, 1),
          this.unit(args, 2),
          this.num(args, 3),
          this.num(args, 4),
          this.num(args, 5),
          this.num(args, 6),
          this.text(args, 7) as DesignTraitDamageKind,
        );
        return undefined;
      case "projHealing":
        return this.projectionOf(step).projectReceivedHealing(
          this.unit(args, 0),
          this.num(args, 1),
          this.unit(args, 2),
          this.num(args, 3),
          this.num(args, 4),
          this.num(args, 5),
          this.num(args, 6),
        );
      case "projRoundEnd":
        this.projectionOf(step).onRoundEnd(
          this.unit(args, 0),
          this.num(args, 1),
          this.num(args, 2),
          this.num(args, 3),
        );
        return undefined;
      default:
        throw new Error(`Unknown talent op ${step.op}`);
    }
  }

  private projectionOf(step: GoldenPhysicalTraitStep): DesignTraitProjection {
    if (!this.projection)
      throw new Error(`Scenario used the projection before creating it (${step.op})`);
    return this.projection;
  }

  private definition(bank: number, id: number): StatusDefinition {
    const definition = this.mechanics.effects.catalog.definition(bank, id);
    if (!definition) throw new Error(`No status ${bank}/${id}`);
    return definition;
  }

  private statKey(index: number): MutableStat {
    const stat = MUTABLE_STATS[index];
    if (!stat) throw new Error(`stat index ${index} is not one of the three mutable stats`);
    return stat;
  }

  private unit(args: readonly (string | number | boolean)[], index: number): DesignTraitUnit {
    const name = this.text(args, index);
    const unit = this.units.get(name);
    if (!unit) throw new Error(`Unknown scenario unit ${name}`);
    return unit;
  }

  private text(args: readonly (string | number | boolean)[], index: number): string {
    const value = args[index];
    if (typeof value !== "string") throw new Error(`argument ${index} is not a name: ${value}`);
    return value;
  }

  private num(args: readonly (string | number | boolean)[], index: number): number {
    const value = args[index];
    if (typeof value !== "number") throw new Error(`argument ${index} is not a number: ${value}`);
    return value;
  }

  private bool(args: readonly (string | number | boolean)[], index: number): boolean {
    const value = args[index];
    if (typeof value !== "boolean") throw new Error(`argument ${index} is not a flag: ${value}`);
    return value;
  }
}

/**
 * The 19 rollable talents, graded against the call list the Java engine recorded for them.
 *
 * Nothing here states how a family behaves. Each row is one scenario the probe ran on a unit wearing
 * one talent: the ops it called, in order, with the arguments it resolved; the number, flag or reduced
 * context each call answered with; every label the engine drew a random percent under; and the whole
 * unit table afterwards, down to the four base stats, maximum HP and the six `PetTraitBattleState`
 * ledgers. The port replays the ops and is compared against all of it, so a talent that fires one
 * round late, spends its once-per-battle revive early, or heals off the current HP instead of the
 * maximum is caught at the step where it happens.
 *
 * Rows with `combined: true` wear a real characteristic on species 0 beside the talent, which is what
 * proves the two systems compose rather than merely coexist.
 */
class Rig {
  private constructor(
    readonly golden: GoldenPhysicalTraitsTable,
    readonly dispatcher: TraitLifecycleDispatcher,
    private readonly mechanics: DesignTraitMechanics,
    private readonly random: RandomRecorder,
  ) {}

  static async load(mutate?: (file: string, json: unknown) => unknown): Promise<Rig> {
    mutation = mutate;
    try {
      const data = new GameData(await Pack.load());
      const [effects, golden] = await Promise.all([
        StatusEffects.load(data),
        data.goldenPhysicalTraits(),
      ]);
      const random = new RandomRecorder();
      const [mechanics, dispatcher] = await Promise.all([
        DesignTraitMechanics.load(data, effects),
        TraitLifecycleDispatcher.load(data, (label) => random.percent(label)),
      ]);
      return new Rig(golden, dispatcher, mechanics, random);
    } finally {
      mutation = undefined;
    }
  }

  run(row: GoldenPhysicalTraitRow): TalentRun {
    return new TalentRun(
      this.mechanics,
      (label) => this.random.percent(label),
      this.dispatcher,
      this.golden,
      row.speciesId,
      row.traitId,
    );
  }

  /** One recorded row, so a scenario the probe ran can be replayed with a different status planted. */
  row(stableKey: string, scenario: string): GoldenPhysicalTraitRow {
    const row = this.golden.rows.find(
      (candidate) => candidate.stableKey === stableKey && candidate.scenario === scenario,
    );
    if (!row) throw new Error(`no recorded row for ${stableKey} ${scenario}`);
    return row;
  }

  /** The two combatants the table declares, before any step has run. */
  templateState(): { a: GoldenPhysicalTraitUnitState; t: GoldenPhysicalTraitUnitState } {
    const template = this.golden.unitTemplate;
    const run = this.run({
      ...this.golden.rows[0],
      speciesId: template.dummySpecies,
      traitId: template.dummyPhysicalTraitId,
    });
    const state = run.state();
    return { a: state.get("a")!, t: state.get("t")! };
  }

  /**
   * The recording against the table the dispatcher actually reads. Kept apart from the replay so a
   * mutated parameter is graded as a wrong *number* by `gradeAll` rather than being turned away here
   * before the arithmetic ever runs.
   */
  checkCatalog(): { found: string[]; families: Set<string>; traits: Set<number> } {
    const found: string[] = [];
    const families = new Set<string>();
    const traits = new Set<number>();
    for (const row of this.golden.rows) {
      families.add(row.family);
      traits.add(row.traitId);
      const label = `${row.stableKey} ${row.scenario}`;
      const spec = this.dispatcher.registry.physicalSpec(row.traitId);
      // The two tables list a talent's hooks in different orders — the probe sorts them by enum name,
      // the registry exports them in declaration order — so they are compared as sets.
      const specHooks = spec ? [...spec.hooksOf()].sort() : [];
      const rowHooks = [...row.hooks].sort();
      if (
        !spec ||
        spec.stableKey !== row.stableKey ||
        spec.family !== row.family ||
        spec.parametersJson !== row.parametersJson ||
        specHooks.join(",") !== rowHooks.join(",")
      ) {
        found.push(
          `battle/pet-trait-mechanics.json says ${spec?.stableKey} ${spec?.family}` +
            ` ${spec?.parametersJson} [${specHooks}] for runtime id ${row.traitId}, and the` +
            ` table recorded ${row.stableKey} ${row.family} ${row.parametersJson} [${rowHooks}]`,
        );
      }
      // The rollable pool is what keeps the two form-owned characteristics out of this path, so a
      // talent the table records has to be one a roll can actually produce.
      if (!this.dispatcher.registry.isPhysicalTraitAllowed(row.traitId)) {
        found.push(`${label}: talent ${row.traitId} is not in the rollable pool`);
      }
      if (!(row.family in FAMILIES)) {
        found.push(`${label}: family ${row.family} is not one the port declares`);
      }
    }
    return { found, families, traits };
  }

  gradeAll(): {
    found: string[];
    rows: number;
    steps: number;
    graded: Set<string>;
    ops: Map<string, number>;
    draws: number;
  } {
    const found: string[] = [];
    const graded = new Set<string>();
    const ops = new Map<string, number>();
    let draws = 0;
    let steps = 0;
    let rows = 0;
    for (const row of this.golden.rows) {
      rows++;
      draws += row.randomLabels.length;
      const label = `${row.stableKey} ${row.scenario}${row.combined ? " combined" : ""}`;
      this.random.begin(row);
      const run = this.run(row);
      let replayed = true;
      for (let index = 0; index < row.steps.length; index++) {
        const step = row.steps[index];
        steps++;
        ops.set(step.op, (ops.get(step.op) ?? 0) + 1);
        const at = `${label} step ${index} ${step.op}`;
        let mine: Result | undefined;
        try {
          mine = run.dispatch(step);
        } catch (error) {
          found.push(`${at} threw ${(error as Error).message}`);
          replayed = false;
          break;
        }
        if ("result" in step) {
          if (!sameResult(mine, step.result)) {
            found.push(`${at} returned ${JSON.stringify(mine)} != ${JSON.stringify(step.result)}`);
          }
        } else if (mine !== undefined) {
          found.push(`${at} returned ${JSON.stringify(mine)} and the engine returned nothing`);
        }
        const actual = run.state();
        const recorded = Object.keys(step.state);
        if (recorded.join(",") !== [...actual.keys()].join(",")) {
          found.push(`${at} has units ${[...actual.keys()]} and the engine had ${recorded}`);
        }
        for (const name of recorded) {
          grade(found, `${at} ${name}`, actual.get(name), step.state[name]);
        }
      }
      this.random.finish(found, label, row);
      // A row only counts as graded when the replay reached its last step, so a family that threw
      // halfway cannot be reported as covered. The combined rows run the same scenario on the same
      // talent beside a real characteristic, so they need their own half of the key.
      if (replayed) {
        graded.add(
          `${row.family}:${row.traitId}:${row.combined ? "combined" : "plain"}:${row.scenario}`,
        );
      }
    }
    return { found, rows, steps, graded, ops, draws };
  }
}

describe("19 talents", () => {
  it("replays every step the Java engine recorded", async () => {
    const rig = await Rig.load();
    const { found, rows, steps, draws } = rig.gradeAll();
    expect(found.slice(0, 20)).toEqual([]);
    expect({ rows, steps }).toEqual({ rows: rig.golden.rowCount, steps: 547 });
    expect(rig.golden.rowCount).toBe(112);
    // 36 of them run the talent beside a real characteristic on species 0, which is what proves the
    // two systems compose rather than merely coexist.
    expect(rig.golden.rows.filter((row) => row.combined).length).toBe(36);
    // The four chance families, once per scenario that reaches the roll: 21 rows draw one label each,
    // and the other 91 short-circuit before asking, which is what their empty `randomLabels` states.
    expect(draws).toBe(21);
  });

  it("grades all 9 families across all 19 rollable talents", async () => {
    const rig = await Rig.load();
    const { found, families, traits } = rig.checkCatalog();
    expect(found).toEqual([]);
    expect(families.size).toBe(rig.golden.families.length);
    expect([...traits].sort((a, b) => a - b)).toEqual(Array.from({ length: 19 }, (_, id) => id));

    const { graded } = rig.gradeAll();
    expect(graded.size).toBe(rig.golden.rowCount);
    // Each declared family states how many talents carry it and which scenarios were run for them.
    // Both are read back out of the set of rows the replay actually finished, not out of the table.
    for (const family of rig.golden.families) {
      const rows = [...graded].filter((key) => key.startsWith(`${family.family}:`));
      const ofFamily = rows.map((key) => key.slice(family.family.length + 1).split(":"));
      expect(new Set(ofFamily.map((part) => part[0])).size).toBe(family.traits);
      expect([...new Set(ofFamily.map((part) => part[2]))].sort()).toEqual(
        [...family.scenarios].sort(),
      );
    }
  });

  it("rebuilds both probe combatants from the template the table declares", async () => {
    const rig = await Rig.load();
    const { a, t } = rig.templateState();
    expect(a).toEqual(rig.golden.unitTemplate.actorState);
    expect(t).toEqual(rig.golden.unitTemplate.dummyState);
  });

  it("replays the ops the table records, and no others", async () => {
    const rig = await Rig.load();
    const { ops } = rig.gradeAll();
    expect([...ops.keys()].sort()).toEqual([
      "baseStat",
      "beginAction",
      "damage",
      "hp",
      "projAccuracy",
      "projAfterDamage",
      "projBefore",
      "projBeforeDamage",
      "projEnter",
      "projExperience",
      "projHealing",
      "projPermanentStats",
      "projRoundEnd",
      "projection",
      "status",
    ]);
  });

  it("answers TC-10's blocked_by burn with Gieo Hạt, the branch Java cannot referee", async () => {
    const rig = await Rig.load();
    const blocked = rig.row("TC-10", "blockedByCorrosion");
    // The probe recorded this row planting Hủ Thực, bank 2 id 5. Replaying the identical op list with
    // Gieo Hạt instead, bank 1 id 0, is the one branch of `blocked_by: ["burn","corrosion"]` the
    // recording cannot cover: Java resolves BURN through `RainbowStatusCatalog.BURN_RESERVED_ID`, a
    // bank-2 slot that registers no `StatusDefinition`, so no scenario it could run ever raises the
    // flag. The port resolves it through the engine's own `seeded_damage` alias instead, which is
    // Gieo Hạt — the Liệt Hỏa damage-over-time `DesignTraitMechanics.ownDot` already ranks beside
    // Hủ Thực and Xé Rách. Species 280 wears no characteristic, so nothing else moves HP here.
    const replay = (bank: number, id: number): GoldenPhysicalTraitUnitState => {
      const run = rig.run(blocked);
      for (const step of blocked.steps) {
        run.dispatch(
          step.op === "status"
            ? { ...step, args: [step.args[0], bank, id, step.args[3], step.args[4]] }
            : step,
        );
      }
      return run.state().get("a")!;
    };

    // The recorded branch, replayed unchanged: Hủ Thực raises canonical corrosion and blocks the heal.
    const corrosion = replay(2, 5);
    expect(corrosion.tt.cs).toEqual([0, 1, 0, 0, 0]);
    expect(corrosion.hp).toBe(500);

    // The new branch: Gieo Hạt raises canonical burn and blocks the same heal.
    const seeded = replay(1, 0);
    expect(seeded.tt.cs).toEqual([1, 0, 0, 0, 0]);
    expect(seeded.hp).toBe(500);

    // And the heal it blocks is the recorded one: 2% of the 1000 maximum HP, so 500 becomes 520.
    const healed = rig.row("TC-10", "healsAtRoundEnd");
    const run = rig.run(healed);
    for (const step of healed.steps) run.dispatch(step);
    expect(run.state().get("a")!.hp).toBe(520);
  });

  it("has teeth: a wrong talent table disagrees with the recording", async () => {
    const clean = await Rig.load();
    expect(clean.gradeAll().found).toEqual([]);

    const count = async (mutate: (file: string, json: unknown) => unknown): Promise<number> =>
      (await Rig.load(mutate)).gradeAll().found.length;

    type Mechanics = {
      dispatcherEnabled: boolean;
      physical: { runtimeId: number; parametersJson: string }[];
    };

    /** One talent's numbers rewritten, its schema left alone so the keys still cover it. */
    const retune = (json: unknown, runtimeId: number, parametersJson: string): Mechanics => {
      const table = json as Mechanics;
      return {
        ...table,
        physical: table.physical.map((row) =>
          row.runtimeId === runtimeId ? { ...row, parametersJson } : row,
        ),
      };
    };

    const found: Record<string, number> = {};

    // Yếu Đuối takes 8 percent off maximum HP; make it 9 and every permanent-stat row moves.
    found.wrongStatPercent = await count((file, json) =>
      file.endsWith("pet-trait-mechanics.json") ? retune(json, 1, '{"max_hp_percent":-9}') : json,
    );

    // Hồi Phục caps one round's passive heal at 4 percent of maximum HP; double the cap.
    found.wrongHealCap = await count((file, json) =>
      file.endsWith("pet-trait-mechanics.json")
        ? retune(
            json,
            10,
            '{"heal_max_hp_percent":2,"blocked_by":["burn","corrosion"],' +
              '"passive_heal_cap_percent":8}',
          )
        : json,
    );

    // Tái Sinh rolls 40; a pinned roll of 99 must fail it, so make the talent always fire.
    found.wrongTriggerChance = await count((file, json) =>
      file.endsWith("pet-trait-mechanics.json")
        ? retune(
            json,
            14,
            '{"trigger_chance_percent":100,"revive_hp_percent":30,"max_uses_per_battle":1}',
          )
        : json,
    );

    // The profile's own switch: turn the dispatcher off and every talent becomes the identity.
    found.dispatcherOff = await count((file, json) =>
      file.endsWith("pet-trait-mechanics.json")
        ? { ...(json as Mechanics), dispatcherEnabled: false }
        : json,
    );

    // Every count is a number a real run produced, and every one is above zero: a mutation the table
    // cannot see is a hole in the table, not a passing test.
    expect(found).toEqual(MUTATION_COUNTS);
    for (const [name, value] of Object.entries(found)) expect(value, name).toBeGreaterThan(0);
  });
});
