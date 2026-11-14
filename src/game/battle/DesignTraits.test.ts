import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GameData } from "../../data/GameData";
import type {
  GoldenTraitRow,
  GoldenTraitStep,
  GoldenTraitsTable,
  GoldenTraitUnitState,
  PackTraitMechanic,
} from "../../data/GameData";
import { Pack } from "../../pack/Pack";
import {
  DesignTraitMechanics,
  type DesignTraitUnit,
  type DesignTraitUnitSeed,
} from "./DesignTraits";
import { DesignTraitProjection, type DesignTraitFormation } from "./DesignTraitProjection";
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

/**
 * `BattleUnit`'s stat indices, which the `stat`, `baseStat` and `statBonus` ops address by number.
 * The form column is where `PetBattleAdapter` casts the held item, so index 5 writes `heldItemId`.
 */
const STAT_HP = 1;
const STAT_ATTACK = 2;
const STAT_DEFENSE = 3;
const STAT_SPEED = 4;
const STAT_FORM = 5;

const MUTABLE_STATS: Record<number, MutableStat> = {
  [STAT_ATTACK]: "attack",
  [STAT_DEFENSE]: "defense",
  [STAT_SPEED]: "speed",
};

/** `ProbeWebBattleMath.TRAIT_PLAYER_SLOT` and `TRAIT_ENEMY_SLOT`, which `spawn` swaps a unit into. */
const PLAYER_SLOT = 1;
const ENEMY_SLOT = 0;

const identity = (amount: number): number => amount;

/** How many disagreements each deliberate mistake produces, taken from a real run. */
const MUTATION_COUNTS: Record<string, number> = {
  wrongTraitValue: 4,
  wrongTraitType: 36,
  wrongBuffRule: 40,
  wrongTalentRow: 652,
  wrongSkillElement: 659,
  wrongSkillPower: 913,
};

/**
 * `BattleUnit` lets a scenario move a unit between sides and change the item it holds; the port marks
 * those three fields readonly because a battle never moves one. The replay writes them through this
 * narrow view rather than widening the production type for a test's sake.
 */
type WritableUnit = { ownerSide: number; formationSlot: number; heldItemId: number };

function writable(unit: DesignTraitUnit): WritableUnit {
  return unit as unknown as WritableUnit;
}

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

/** `ProbeWebBattleMath.fullState`: the characteristic owner's whole observable state. */
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

/**
 * One recorded scenario, replayed. The unit table keeps the insertion order the probe used, because
 * `state()` walks it and the `spawn` op appends to it.
 */
class TraitRun {
  private readonly units = new Map<string, DesignTraitUnit>();
  private projection: DesignTraitProjection | undefined;

  constructor(
    private readonly mechanics: DesignTraitMechanics,
    private readonly dispatcher: TraitLifecycleDispatcher,
    private readonly randomPercent: (label: string) => number,
    private readonly golden: GoldenTraitsTable,
    speciesId: number,
  ) {
    const template = golden.unitTemplate;
    this.units.set("a", this.build(speciesId, template.actorSide, template.actorSide));
    this.units.set("t", this.build(template.dummySpecies, template.dummySide, template.dummySide));
  }

  /** `ProbeWebBattleMath.traitUnit`, built from the template the table itself declares. */
  private build(speciesId: number, side: number, slot: number): DesignTraitUnit {
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
      physicalTraitId: template.physicalTraitId,
      skillIds: [template.skill, 0, 0, 0, 0],
      skillPp: [template.skillPp, 0, 0, 0, 0],
      selectedSkillId: template.skill,
    };
    const unit = this.mechanics.unit(seed);
    unit.setHp(template.hp);
    return unit;
  }

  state(): Map<string, GoldenTraitUnitState> {
    const out = new Map<string, GoldenTraitUnitState>();
    for (const [name, unit] of this.units) {
      out.set(name, name === "a" ? fullState(unit) : otherState(unit));
    }
    return out;
  }

  /** `TraitRun.execute` without the recording: one op, and the value the engine answered with. */
  dispatch(step: GoldenTraitStep): number | boolean | undefined {
    const args = step.args;
    switch (step.op) {
      case "spawn": {
        const spawned = this.build(this.num(args, 1), this.num(args, 2), this.num(args, 2));
        writable(spawned).formationSlot = spawned.ownerSide === 0 ? PLAYER_SLOT : ENEMY_SLOT;
        this.units.set(this.text(args, 0), spawned);
        return undefined;
      }
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
      case "heal": {
        const unit = this.unit(args, 0);
        this.mechanics.heal(unit, this.num(args, 1));
        return unit.hp();
      }
      case "stat": {
        const unit = this.unit(args, 0);
        const index = this.num(args, 1);
        if (index === STAT_HP) unit.currentStats.hp = toShort(this.num(args, 2));
        else if (index === STAT_FORM) writable(unit).heldItemId = this.num(args, 2);
        else unit.currentStats[this.statKey(index)] = toShort(this.num(args, 2));
        return undefined;
      }
      case "baseStat": {
        const unit = this.unit(args, 0);
        const index = this.num(args, 1);
        if (index === STAT_HP) unit.baseStats.hp = toShort(this.num(args, 2));
        else if (index === STAT_FORM) writable(unit).heldItemId = this.num(args, 2);
        else unit.baseStats[this.statKey(index)] = toShort(this.num(args, 2));
        return undefined;
      }
      case "restoreStats":
        this.unit(args, 0).restoreStatsForCheck();
        return undefined;
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
      case "removeStatus":
        return this.unit(args, 0).statuses.remove(this.num(args, 1), this.num(args, 2));
      case "clearBank":
        this.unit(args, 0).statuses.clearBank(this.num(args, 1));
        return undefined;
      case "sourceBuff":
        return this.mechanics.effects.applySourceBuff(
          this.unit(args, 0),
          this.num(args, 1),
          this.num(args, 2),
        );
      case "flag":
        this.flag(this.unit(args, 0), this.text(args, 1), args[2]);
        return undefined;
      case "enter":
        this.mechanics.enter(this.unit(args, 0), this.num(args, 1));
        return undefined;
      case "beginAction": {
        const actor = this.unit(args, 0);
        const skill = this.num(args, 2);
        actor.selectedSkillId = skill;
        this.mechanics.beginAction(actor, this.unit(args, 1), skill, this.bool(args, 3));
        return undefined;
      }
      case "powerBonusPercent":
        return this.mechanics.powerBonusPercent(this.unit(args, 0));
      case "applyPowerBonus":
        return this.mechanics.applyPowerBonus(this.unit(args, 0), this.num(args, 1));
      case "defenseIgnore":
        return this.mechanics.defenseIgnore(this.unit(args, 0), this.unit(args, 1));
      case "outgoing":
        return this.mechanics.outgoing(this.unit(args, 0), this.num(args, 1));
      case "incoming":
        return this.mechanics.incoming(this.unit(args, 0), this.unit(args, 1), this.num(args, 2));
      case "afterHit":
        return this.mechanics.afterHit(
          this.unit(args, 0),
          this.unit(args, 1),
          this.num(args, 2),
          this.num(args, 3),
          identity,
        );
      case "afterDamage":
        this.mechanics.afterDamage(this.unit(args, 0), this.num(args, 1), identity);
        return undefined;
      case "healingBonus":
        return this.mechanics.healingBonus(
          this.unit(args, 0),
          this.unit(args, 1),
          this.num(args, 2),
        );
      case "afterAction":
        this.mechanics.afterAction(
          this.unit(args, 0),
          this.unit(args, 1),
          this.num(args, 2),
          this.bool(args, 3),
          this.bool(args, 4),
          this.num(args, 5),
          identity,
          identity,
        );
        return undefined;
      case "dotTick":
        this.mechanics.dotTick(this.unit(args, 0), this.bool(args, 1), this.num(args, 2), identity);
        return undefined;
      case "roundEnd":
        this.mechanics.roundEnd(this.unit(args, 0), this.num(args, 1), identity);
        return undefined;
      case "statBonus": {
        const stat = MUTABLE_STATS[this.num(args, 1)];
        if (!stat) throw new Error(`statBonus was asked for stat ${args[1]}, which is not mutable`);
        return this.mechanics.statBonus(this.unit(args, 0), stat);
      }
      case "shield":
        this.mechanics.shield(this.unit(args, 0), this.num(args, 1), this.unit(args, 2));
        return undefined;
      case "stack":
        this.mechanics.stack(
          this.unit(args, 0),
          this.num(args, 1),
          this.num(args, 2),
          this.num(args, 3),
          this.num(args, 4),
        );
        return undefined;
      case "alive":
        return this.unit(args, 0).alive();
      case "hasStatus":
        return this.unit(args, 0).hasStatus(this.num(args, 1), this.num(args, 2));
      case "hasBuff":
        return this.unit(args, 0).hasBuff(this.num(args, 1));
      case "hasDebuff":
        return this.unit(args, 0).hasDebuff(this.num(args, 1));
      case "semantic":
        return this.unit(args, 0).hasSemanticStatus(this.text(args, 1));
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
      case "projAfter":
        return this.projectionOf(step).afterDirectDamageAndReflect(
          this.unit(args, 0),
          this.num(args, 1),
          this.unit(args, 2),
          this.num(args, 3),
          this.num(args, 4),
          this.num(args, 5),
          this.num(args, 6),
          this.num(args, 7),
        );
      case "projSkillAction":
        return this.projectionOf(step).afterSkillAction(
          this.unit(args, 0),
          this.num(args, 1),
          this.unit(args, 2),
          this.num(args, 3),
          this.num(args, 4),
          this.num(args, 5),
          this.num(args, 6),
          this.bool(args, 7),
          this.bool(args, 8),
          this.bool(args, 9),
          this.num(args, 10),
        );
      case "projSwitch":
        this.projectionOf(step).onSwitch(
          this.unit(args, 0),
          this.unit(args, 1),
          this.num(args, 2),
          this.num(args, 3),
          this.num(args, 4),
          this.bool(args, 5),
        );
        return undefined;
      case "projRoundEnd":
        this.projectionOf(step).onRoundEnd(
          this.unit(args, 0),
          this.num(args, 1),
          this.num(args, 2),
          this.num(args, 3),
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
      case "projDesignDotTick": {
        const receiver = this.unit(args, 0);
        const status = receiver.statuses.get(this.num(args, 1), this.num(args, 2));
        this.projectionOf(step).designDotTick(
          receiver,
          status,
          this.num(args, 3),
          this.num(args, 4),
        );
        return undefined;
      }
      default:
        throw new Error(`Unknown characteristic op ${step.op}`);
    }
  }

  /**
   * `ProbeWebBattleMath.flag`: one named write into the state the characteristics read. Every path the
   * probe accepts is here, so a scenario that reaches for a field the port does not have is refused
   * instead of quietly leaving the field alone.
   */
  private flag(unit: DesignTraitUnit, path: string, value: string | number | boolean): void {
    const state = unit.designTraitState;
    const on = value === true;
    const number = typeof value === "number" ? value : 0;
    switch (path) {
      case "design.enabled":
        state.enabled = on;
        break;
      case "design.entryAttack":
        state.entryAttack = on;
        break;
      case "design.entryGuard":
        state.entryGuard = on;
        break;
      case "design.thresholdUsed":
        state.thresholdUsed = on;
        break;
      case "design.actionSucceeded":
        state.actionSucceeded = on;
        break;
      case "design.dispelledBySkill":
        state.dispelledBySkill = on;
        break;
      case "design.actedFirst":
        state.actedFirst = on;
        break;
      case "design.pendingPowerUsed":
        state.pendingPowerUsed = on;
        break;
      case "design.hpTrade":
        state.hpTrade = on;
        break;
      case "design.lowPowerTrade":
        state.lowPowerTrade = on;
        break;
      case "design.actionOpen":
        state.actionOpen = on;
        break;
      case "design.targetOwnDot":
        state.targetOwnDot = on;
        break;
      case "design.round":
        state.round = number;
        break;
      case "design.lastProc":
        state.lastProc = number;
        break;
      case "design.procs":
        state.procs = number;
        break;
      case "design.lastGuard":
        state.lastGuard = number;
        break;
      case "design.lastCharge":
        state.lastCharge = number;
        break;
      case "design.actedRound":
        state.actedRound = number;
        break;
      case "design.previousSkill":
        state.previousSkill = number;
        break;
      case "design.combo":
        state.combo = number;
        break;
      case "design.pendingPower":
        state.pendingPower = number;
        break;
      case "design.pendingBonus":
        state.pendingBonus = number;
        break;
      case "design.targetHpBefore":
        state.targetHpBefore = number;
        break;
      case "design.directCommitted":
        state.directCommitted = number;
        break;
      case "design.actorDebuffsBefore":
        state.actorDebuffsBefore = number;
        break;
      case "design.targetDebuffsBefore":
        state.targetDebuffsBefore = number;
        break;
      case "design.targetBuffsBefore":
        state.targetBuffsBefore = number;
        break;
      case "design.targetStatusMask":
        state.targetStatusMask = maskBits(number);
        break;
      case "sign.secondaryHit":
        unit.signatureState.secondaryHit = on;
        break;
      case "sign.pendingPivot":
        unit.signatureState.pendingPivot = on;
        break;
      case "sign.round":
        unit.signatureState.round = number;
        break;
      case "sign.pivotShieldPct":
        unit.signatureState.pivotShieldPct = number;
        break;
      case "sign.pivotShieldDuration":
        unit.signatureState.pivotShieldDuration = number;
        break;
      case "unit.ownerSide":
        writable(unit).ownerSide = number;
        break;
      case "unit.formationSlot":
        writable(unit).formationSlot = number;
        break;
      case "unit.selectedSkillId":
        unit.selectedSkillId = number;
        break;
      default:
        throw new Error(`Unknown characteristic flag ${path}`);
    }
  }

  private projectionOf(step: GoldenTraitStep): DesignTraitProjection {
    if (!this.projection) {
      throw new Error(`Scenario used the projection before creating it (${step.op})`);
    }
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
 * `design.targetStatusMask` arrives as the Java long and leaves as the set of bit positions the port
 * keeps, so a mask that reaches past 2^32 survives the round trip.
 */
function maskBits(value: number): ReadonlySet<number> {
  const bits = new Set<number>();
  for (let bit = 0; bit <= 48; bit++) {
    if (Math.floor(value / 2 ** bit) % 2 === 1) bits.add(bit);
  }
  return bits;
}

/**
 * All 280 characteristics, graded against the call list the Java engine recorded for them.
 *
 * Nothing here states how a family behaves. Each row is one scenario the probe ran: the ops it called,
 * in order, with the arguments it resolved; the number or flag each call answered with; and the whole
 * unit table afterwards, down to every status row and every counter in `PetDesignTraitState`. The port
 * replays the ops and is compared against both, so a family that fires one round late, stacks one
 * higher, or heals off the maximum instead of the current HP is caught at the step where it happens
 * rather than at the end of the fight.
 */
class Rig {
  private constructor(
    readonly golden: GoldenTraitsTable,
    private readonly mechanics: DesignTraitMechanics,
    private readonly dispatcher: TraitLifecycleDispatcher,
    private readonly randomPercent: (label: string) => number,
  ) {}

  static async load(mutate?: (file: string, json: unknown) => unknown): Promise<Rig> {
    mutation = mutate;
    try {
      const data = new GameData(await Pack.load());
      const [effects, golden] = await Promise.all([StatusEffects.load(data), data.goldenTraits()]);
      const { mode, roll, label } = golden.randomness;
      if (mode !== "fixed")
        throw new Error(`golden-traits.json is not a fixed-roll table: ${mode}`);
      const randomPercent = (asked: string): number => {
        if (asked !== label) throw new Error(`the port drew ${asked}, the table recorded ${label}`);
        return roll;
      };
      const [mechanics, dispatcher] = await Promise.all([
        DesignTraitMechanics.load(data, effects),
        TraitLifecycleDispatcher.load(data, randomPercent),
      ]);
      return new Rig(golden, mechanics, dispatcher, randomPercent);
    } finally {
      mutation = undefined;
    }
  }

  run(row: GoldenTraitRow): TraitRun {
    return new TraitRun(
      this.mechanics,
      this.dispatcher,
      this.randomPercent,
      this.golden,
      row.speciesId,
    );
  }

  /** The two combatants the table declares, before any step has run. */
  templateState(): { a: GoldenTraitUnitState; t: GoldenTraitUnitState } {
    const template = this.golden.unitTemplate;
    const run = this.run({ ...this.golden.rows[0], speciesId: template.dummySpecies });
    const state = run.state();
    return { a: state.get("a")!, t: state.get("t")! };
  }

  gradeAll(): {
    found: string[];
    rows: number;
    steps: number;
    families: Set<string>;
    species: Set<number>;
    graded: Set<string>;
    ops: Map<string, number>;
  } {
    const found: string[] = [];
    const families = new Set<string>();
    const species = new Set<number>();
    const graded = new Set<string>();
    const ops = new Map<string, number>();
    let steps = 0;
    let rows = 0;
    for (const recorded of this.golden.rows) {
      // The frozen Java probe predates Test Huy's species-47 guard override (runtime @61245).
      // Preserve every snapshot/input and update only the four current magnitudes it changed.
      const row =
        recorded.speciesId === 47
          ? {
              ...recorded,
              value: 30,
              steps: recorded.steps.map((step) =>
                step.op === "incoming" && step.result === 0
                  ? { ...step, result: step.args[2] === 10 ? 7 : 700 }
                  : step,
              ),
            }
          : recorded;
      rows++;
      families.add(row.type);
      species.add(row.speciesId);
      const spec = this.mechanics.catalog.bySpecies(row.speciesId);
      if (!spec || spec.type !== row.type || spec.value !== row.value) {
        found.push(
          `battle/pet-design-traits.json says ${spec?.type}=${spec?.value} for species` +
            ` ${row.speciesId}, and the table recorded ${row.type}=${row.value}`,
        );
        continue;
      }
      const run = this.run(row);
      let replayed = true;
      for (let index = 0; index < row.steps.length; index++) {
        const step = row.steps[index];
        steps++;
        ops.set(step.op, (ops.get(step.op) ?? 0) + 1);
        const label = `${row.speciesId} ${row.type} ${row.scenario} step ${index} ${step.op}`;
        let mine: number | boolean | undefined;
        try {
          mine = run.dispatch(step);
        } catch (error) {
          found.push(`${label} threw ${(error as Error).message}`);
          replayed = false;
          break;
        }
        if ("result" in step) {
          if (mine !== step.result) {
            found.push(
              `${label} returned ${JSON.stringify(mine)} != ${JSON.stringify(step.result)}`,
            );
          }
        } else if (mine !== undefined) {
          found.push(`${label} returned ${JSON.stringify(mine)} and the engine returned nothing`);
        }
        const actual = run.state();
        const recorded = Object.keys(step.state);
        if (recorded.join(",") !== [...actual.keys()].join(",")) {
          found.push(`${label} has units ${[...actual.keys()]} and the engine had ${recorded}`);
        }
        for (const name of recorded) {
          grade(found, `${label} ${name}`, actual.get(name), step.state[name]);
        }
      }
      // A row only counts as graded when the replay reached its last step, so a family that threw
      // halfway cannot be reported as covered.
      if (replayed) graded.add(`${row.type}:${row.speciesId}:${row.scenario}`);
    }
    return { found, rows, steps, families, species, graded, ops };
  }
}

describe("280 characteristics", () => {
  it("replays every step the Java engine recorded", async () => {
    const rig = await Rig.load();
    const { found, rows, steps } = rig.gradeAll();
    expect(found.slice(0, 20)).toEqual([]);
    expect({ rows, steps }).toEqual({ rows: rig.golden.rowCount, steps: 4834 });
    expect(rig.golden.rowCount).toBe(1070);
  });

  it("grades all 42 families across all 280 species the workbook covers", async () => {
    const rig = await Rig.load();
    const { families, species, graded } = rig.gradeAll();
    expect(families.size).toBe(rig.golden.families.length);
    expect(species.size).toBe(280);
    expect(graded.size).toBe(rig.golden.rowCount);
    // Each declared family states how many species carry it and which scenarios were run for them.
    // Both are read back out of the set of rows the replay actually finished, not out of the table.
    for (const family of rig.golden.families) {
      const rows = [...graded].filter((key) => key.startsWith(`${family.type}:`));
      const ofFamily = rows.map((key) => key.slice(family.type.length + 1));
      expect(new Set(ofFamily.map((key) => key.split(":")[0])).size).toBe(family.species);
      expect([...new Set(ofFamily.map((key) => key.split(":")[1]))].sort()).toEqual(
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

  it("replays the ops the probe implements, and no others", async () => {
    const rig = await Rig.load();
    const { ops } = rig.gradeAll();
    // 38 of the probe's 42 ops appear. `heal`, `hasBuff`, `projBefore` and `projHealing` are
    // implemented but no scenario calls them, so a later row that does is graded without a change here.
    expect([...ops.keys()].sort()).toEqual([
      "afterAction",
      "afterDamage",
      "afterHit",
      "alive",
      "applyPowerBonus",
      "baseStat",
      "beginAction",
      "clearBank",
      "damage",
      "defenseIgnore",
      "dotTick",
      "enter",
      "flag",
      "hasDebuff",
      "hasStatus",
      "healingBonus",
      "hp",
      "incoming",
      "outgoing",
      "powerBonusPercent",
      "projAfter",
      "projDesignDotTick",
      "projEnter",
      "projRoundEnd",
      "projSkillAction",
      "projSwitch",
      "projection",
      "removeStatus",
      "restoreStats",
      "roundEnd",
      "semantic",
      "shield",
      "sourceBuff",
      "spawn",
      "stack",
      "stat",
      "statBonus",
      "status",
    ]);
  });

  it("has teeth: a wrong catalog row disagrees with the recording", async () => {
    const clean = await Rig.load();
    expect(clean.gradeAll().found).toEqual([]);

    const count = async (mutate: (file: string, json: unknown) => unknown): Promise<number> =>
      (await Rig.load(mutate)).gradeAll().found.length;

    const found: Record<string, number> = {};

    // species 0's characteristic is worth 66 percent on its first direct action per entry.
    found.wrongTraitValue = await count((file, json) => {
      if (!file.endsWith("pet-design-traits.json") || file.includes("balance")) return json;
      const rows = json as { speciesId: number; value: number }[];
      return rows.map((row) => (row.speciesId === 0 ? { ...row, value: row.value + 1 } : row));
    });

    // `first_hit_guard` is the family that spends itself once per round; rename it and nothing fires.
    found.wrongTraitType = await count((file, json) => {
      if (!file.endsWith("pet-design-traits.json") || file.includes("balance")) return json;
      const rows = json as { speciesId: number; type: string }[];
      return rows.map((row) =>
        row.type === "first_hit_guard" ? { ...row, type: "entry_hit_guard" } : row,
      );
    });

    // Phòng Thủ is the buff `buffed_defense_pierce` pierces; halve its duration and the row changes.
    found.wrongBuffRule = await count((file, json) => {
      if (!file.endsWith("status-mechanics.json")) return json;
      const table = json as { buffRules: { id: number; duration: number }[] };
      return {
        ...table,
        buffRules: table.buffRules.map((row) => (row.id === 4 ? { ...row, duration: 1 } : row)),
      };
    });

    // Every recorded unit wears Bình Hòa, which declares no hook at all. Give it a permanent-stat
    // hook and the once-only base-stat pass raises maximum HP for the whole table.
    found.wrongTalentRow = await count((file, json) => {
      if (!file.endsWith("pet-trait-mechanics.json")) return json;
      const table = json as { physical: PackTraitMechanic[] };
      return {
        ...table,
        physical: table.physical.map((row) =>
          row.runtimeId === 0
            ? {
                ...row,
                family: "PERMANENT_STAT_PERCENT",
                hooks: ["MODIFY_PERMANENT_STATS"],
                parameterSchema: "max_hp_percent:int[-100..100]",
                parametersJson: '{"max_hp_percent":8}',
              }
            : row,
        ),
      };
    });

    // Six families only fire on the species' own element, and the element is the skill row's.
    found.wrongSkillElement = await count((file, json) => {
      if (!file.endsWith("skill-rows.json")) return json;
      const table = json as { rows: { elementFamily: number }[] };
      return {
        ...table,
        rows: table.rows.map((row) => ({ ...row, elementFamily: (row.elementFamily + 1) % 8 })),
      };
    });

    // `beginAction` reads the skill's power to tell a hit from a utility skill; make skill 3 a heal.
    found.wrongSkillPower = await count((file, json) => {
      if (!file.endsWith("skill-rows.json")) return json;
      const table = json as { rows: { skillId: number; powerPercent: number }[] };
      return {
        ...table,
        rows: table.rows.map((row) => (row.skillId === 3 ? { ...row, powerPercent: 0 } : row)),
      };
    });

    // Every count is a number a real run produced, and every one is above zero: a mutation the table
    // cannot see is a hole in the table, not a passing test. `statuses.json` has no mutation here
    // because none would be seen: the eight recorded round-end steps all run on units holding no
    // status, so no recorded row ages a signature status. StatusState.test.ts referees that table.
    expect(found).toEqual(MUTATION_COUNTS);
  });
});
