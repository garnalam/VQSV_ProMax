import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GameData } from "../../data/GameData";
import type {
  GoldenStatusInstance,
  GoldenStatusLifecycleTable,
  GoldenStatusStats,
  PackDebuffProducer,
  PackSkillRow,
} from "../../data/GameData";
import { Pack } from "../../pack/Pack";
import { DamageCalculator } from "./DamageCalculator";
import { BUFF_BANK, DEBUFF_BANK, StatusEffects, type StatusUnit } from "./StatusState";

const root = resolve(import.meta.dirname, "..", "..", "..");

/** `ProbeWebBattleMath.STATUS_SKILL_SCAN_LIMIT`: the id space the probe swept for producers. */
const SCAN_LIMIT = 800;
/** `ProbeWebBattleMath.STATUS_TICK_DEPTH`: one tick past the longest Liệt Hỏa duration. */
const TICK_DEPTH = 6;
/** The four post-skill routes that apply a buff, which is what makes a skill a buff producer. */
const BUFF_PRODUCER_MODES = new Set([
  "APPLY_ATTACKER_BUFF",
  "APPLY_TARGET_BUFF",
  "LEECH_AND_BUFF",
  "COPY_TARGET_BUFFS",
]);

/** A catalog edit standing in for a mistake a port could make, cleared once the rig is loaded. */
let mutation: ((file: string, json: unknown) => unknown) | undefined;

vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(root, "public", decodeURIComponent(input.replace(/^\//, "")));
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const value = mutation && file.endsWith(".json") ? mutation(file, parsed) : parsed;
  return { ok: true, status: 200, json: async () => value };
});

/**
 * `ProbeWebBattleMath.Scripted(99, 50, other)`: the crit and jitter labels are pinned and every
 * other label takes the row's own value, clamped to the bound the engine draws under.
 */
class Scripted {
  readonly draws: string[] = [];

  constructor(private readonly other: number) {}

  next = (label: string): number => {
    const value = label.endsWith(".crit") ? 99 : label.endsWith(".jitter") ? 50 : this.other;
    const clamped = Math.max(0, Math.min(99, value));
    this.draws.push(`${label}=${clamped}`);
    return clamped;
  };
}

/** A throwaway draw sink, for the calls the probe seeded through without recording anything. */
const silent = () => 0;

function stats(unit: StatusUnit): GoldenStatusStats {
  return {
    hp: unit.hp(),
    attack: unit.currentStats.attack,
    defense: unit.currentStats.defense,
    speed: unit.currentStats.speed,
  };
}

function instance(unit: StatusUnit, bank: number, id: number): GoldenStatusInstance {
  const status = unit.statuses.get(bank, id);
  if (!status) return { present: false };
  return {
    present: true,
    remainingTurns: status.remainingTurns,
    remainingActions: status.remainingActions,
    primaryValue: status.primaryValue,
    secondaryValue: status.secondaryValue,
    stackCount: status.stackCount,
    sourceSkillId: status.sourceSkillId,
    flags: status.flags,
  };
}

/** Compare only the fields the golden row carries: the shield rows answer with less than the rest. */
function grade(found: string[], label: string, mine: unknown, row: Record<string, unknown>): void {
  for (const field of Object.keys(row)) {
    if (!(field in (mine as Record<string, unknown>))) {
      found.push(`${label} has no answer for ${field}`);
      continue;
    }
    const actual = (mine as Record<string, unknown>)[field];
    if (JSON.stringify(actual) !== JSON.stringify(row[field])) {
      found.push(`${label} ${field} ${JSON.stringify(actual)} != ${JSON.stringify(row[field])}`);
    }
  }
}

/**
 * The whole status lifecycle, graded against the table the Java engine wrote.
 *
 * Each row is one engine call on a freshly built unit, so the rig rebuilds its two combatants per row
 * exactly the way the probe did: the same species, level, side, nature and quality, and the same
 * seeding path — a debuff goes on through its own producer skill, never by hand. Nothing here states
 * a magnitude; every number the port answers with is either read back out of the port or read out of
 * the row, and the two are compared.
 */
class Rig {
  private constructor(
    readonly data: GameData,
    readonly effects: StatusEffects,
    readonly calculator: DamageCalculator,
    readonly golden: GoldenStatusLifecycleTable,
    private readonly skillRows: PackSkillRow[],
    private readonly producers: PackDebuffProducer[],
    private readonly sprites: Map<number, number>,
  ) {}

  static async load(mutate?: (file: string, json: unknown) => unknown): Promise<Rig> {
    mutation = mutate;
    try {
      const data = new GameData(await Pack.load());
      const calculator = await DamageCalculator.load(data);
      const effects = await StatusEffects.load(data, {
        // Thực Loại freezes a hit into the status it plants, and that hit is the damage formula.
        delayedStatusDamage: (source, target, power) =>
          calculator.delayedStatusDamage(source, target, power),
      });
      const [golden, skills, debuffs, species, mechanics] = await Promise.all([
        data.goldenStatusLifecycle(),
        data.skillRows(),
        data.debuffProducers(),
        data.species(),
        data.statusMechanics(),
      ]);
      const rows = [...skills.rows].sort((a, b) => a.skillId - b.skillId);
      return new Rig(
        data,
        effects,
        calculator,
        golden,
        rows.filter((row) => row.skillId < SCAN_LIMIT),
        debuffs.producers,
        new Map(species.rows.map((row) => [row.speciesId, row.spriteId])),
      ).withRoutes(mechanics.postSkillRoutes);
    } finally {
      mutation = undefined;
    }
  }

  /** The (buff id, source skill) pairs the probe scanned out of the engine's own post-skill routes. */
  private routes: [number, number][] = [];

  private withRoutes(routes: { skillId: number; mode: string; effectId: number }[]): Rig {
    this.routes = routes
      .filter((row) => BUFF_PRODUCER_MODES.has(row.mode) && row.effectId >= 0 && row.effectId < 15)
      .map((row) => [row.effectId, row.skillId] as [number, number]);
    return this;
  }

  private unit(spec: { speciesId: number; side: number; base: GoldenStatusStats }): StatusUnit {
    return this.effects.unit({
      speciesId: spec.speciesId,
      ownerSide: spec.side,
      formationSlot: 0,
      base: { ...spec.base },
    });
  }

  attacker(): StatusUnit {
    return this.unit(this.golden.unit.attacker);
  }

  target(): StatusUnit {
    return this.unit(this.golden.unit.target);
  }

  private skillRow(skillId: number): PackSkillRow | undefined {
    return this.skillRows.find((row) => row.skillId === skillId);
  }

  /** `LietHoaDebuffMechanics.producer(skillId, effectId)`: the producer only counts for its own id. */
  private producerFor(skillId: number): PackDebuffProducer | undefined {
    const row = this.skillRow(skillId);
    const producer = this.producers.find((each) => each.skillId === skillId);
    return row && producer && producer.debuffId === row.effectId ? producer : undefined;
  }

  /** Every skill the probe's scan found a producer behind, in ascending id order. */
  producerSkillIds(): number[] {
    return this.skillRows
      .map((row) => row.skillId)
      .filter((skillId) => this.producerFor(skillId) !== undefined);
  }

  /** `ProbeWebBattleMath.producerSkillFor`: the first skill that plants this debuff. */
  private seedSkillFor(debuffId: number): number | undefined {
    return this.producers
      .filter((row) => row.debuffId === debuffId)
      .map((row) => row.skillId)
      .sort((a, b) => a - b)[0];
  }

  /** `ProbeWebBattleMath.seedDebuff`: one debuff on the target through the engine's producer path. */
  seedDebuff(attacker: StatusUnit, target: StatusUnit, debuffId: number): boolean {
    const skillId = this.seedSkillFor(debuffId);
    const row = skillId === undefined ? undefined : this.skillRow(skillId);
    if (skillId === undefined || !row) return false;
    const pending = this.effects.planTargetDebuff(attacker, target, skillId, row.effectId, silent);
    if (!pending || !pending.appliesStatus()) return false;
    pending.commit();
    return true;
  }

  /** `ProbeWebBattleMath.buffProducerPairs`, filtered to the pairs that produce this buff. */
  private buffProducerSkills(buffId: number): number[] {
    return this.routes.filter(([id]) => id === buffId).map(([, skillId]) => skillId);
  }

  /** `planDebuff`: one plan under a scripted roll, with the draws it took recorded. */
  private plan(
    attacker: StatusUnit,
    target: StatusUnit,
    skillId: number,
    roll: number,
    draws: string[],
  ): ReturnType<StatusEffects["planTargetDebuff"]> {
    const row = this.skillRow(skillId);
    if (!row) return undefined;
    const scripted = new Scripted(roll);
    const pending = this.effects.planTargetDebuff(
      attacker,
      target,
      skillId,
      row.effectId,
      scripted.next,
    );
    draws.push(...scripted.draws);
    return pending;
  }

  // ------------------------------------------------------------------ grading

  gradeBuffApply(): string[] {
    const found: string[] = [];
    for (const row of this.golden.buffApply) {
      const unit = this.attacker();
      const mine = {
        buffId: row.buffId,
        sourceSkill: row.sourceSkill,
        hpBefore: unit.hp(),
        heal: this.effects.applySourceBuff(unit, row.buffId, row.sourceSkill),
        active: unit.hasBuff(row.buffId),
        slot: unit.legacyRow(BUFF_BANK, row.buffId),
        instance: instance(unit, BUFF_BANK, row.buffId),
        stats: stats(unit),
        draws: [],
      };
      grade(found, `buffApply ${row.buffId}@${row.sourceSkill}`, mine, row);
    }
    return found;
  }

  gradeBuffApplyOverDebuffs(): string[] {
    const found: string[] = [];
    for (const row of this.golden.buffApplyOverDebuffs) {
      const attacker = this.attacker();
      const unit = this.target();
      const seeded = row.debuffsBefore.filter((id) => this.seedDebuff(attacker, unit, id));
      const mine = {
        buffId: row.buffId,
        heal: this.effects.applySourceBuff(unit, row.buffId, -1),
        debuffsBefore: seeded,
        debuffsAfter: unit.activeStatusIds(DEBUFF_BANK),
        active: unit.hasBuff(row.buffId),
        slot: unit.legacyRow(BUFF_BANK, row.buffId),
        instance: instance(unit, BUFF_BANK, row.buffId),
        stats: stats(unit),
      };
      grade(found, `buffApplyOverDebuffs ${row.buffId}`, mine, row);
    }
    return found;
  }

  gradeBuffStack(): string[] {
    const found: string[] = [];
    for (let buffId = 0; buffId < 15; buffId++) {
      const skills = this.buffProducerSkills(buffId);
      if (skills.length === 0) skills.push(-1);
      const unit = this.attacker();
      for (let attempt = 1; attempt <= 5; attempt++) {
        const sourceSkill = skills[Math.min(attempt, skills.length) - 1];
        const mine = {
          buffId,
          attempt,
          sourceSkill,
          heal: this.effects.applySourceBuff(unit, buffId, sourceSkill),
          hp: unit.hp(),
          active: unit.hasBuff(buffId),
          slot: unit.legacyRow(BUFF_BANK, buffId),
          instance: instance(unit, BUFF_BANK, buffId),
          stats: stats(unit),
        };
        grade(found, `buffStack ${buffId}#${attempt}`, mine, this.stackRow(buffId, attempt));
      }
    }
    return found;
  }

  private stackRow(buffId: number, attempt: number): Record<string, unknown> {
    const row = this.golden.buffStack.find(
      (each) => each.buffId === buffId && each.attempt === attempt,
    );
    if (!row) throw new Error(`no buffStack row for buff ${buffId} attempt ${attempt}`);
    return row as unknown as Record<string, unknown>;
  }

  /**
   * The probe ticked every Liệt Hỏa buff `STATUS_TICK_DEPTH` times, so the section is a full grid and
   * the rig walks that grid rather than the row list: a row the engine never wrote cannot be graded by
   * accident, and a row it wrote twice cannot be graded twice.
   */
  gradeBuffTick(): string[] {
    const found: string[] = [];
    const buffIds = [...new Set(this.golden.buffTick.map((row) => row.buffId))].sort(
      (a, b) => a - b,
    );
    if (buffIds.length * TICK_DEPTH !== this.golden.buffTick.length) {
      found.push(`buffTick is not a ${buffIds.length} x ${TICK_DEPTH} grid`);
    }
    for (const buffId of buffIds) {
      for (let tick = 1; tick <= TICK_DEPTH; tick++) {
        const row = this.golden.buffTick.find(
          (each) => each.buffId === buffId && each.tick === tick,
        );
        if (!row) {
          found.push(`buffTick has no row for buff ${buffId} tick ${tick}`);
          continue;
        }
        // The row grades the last tick, so the rig only pre-ticks the ones before it.
        const unit = this.attacker();
        this.effects.applySourceBuff(unit, buffId, -1);
        for (let at = 1; at < tick; at++) this.effects.tickSourceBuff(unit, buffId);
        const mine = {
          buffId,
          tick,
          heal: this.effects.tickSourceBuff(unit, buffId),
          hp: unit.hp(),
          active: unit.hasBuff(buffId),
          slot: unit.legacyRow(BUFF_BANK, buffId),
          instance: instance(unit, BUFF_BANK, buffId),
          stats: stats(unit),
          draws: [],
        };
        grade(found, `buffTick ${buffId}@${tick}`, mine, row);
      }
    }
    return found;
  }

  gradeDebuffApply(): string[] {
    const found: string[] = [];
    for (const row of this.golden.debuffApply) {
      const mine = this.debuffRow(row.skillId, row.roll, []);
      grade(found, `debuffApply ${row.skillId}@${row.roll}`, mine, row);
    }
    return found;
  }

  gradeDebuffPreconditions(): string[] {
    const found: string[] = [];
    for (const row of this.golden.debuffPreconditions) {
      const seeded = row.seededDebuffs ?? [];
      const mine =
        row.precondition === "target buff 14"
          ? this.shieldRow(row.skillId)
          : this.debuffRow(row.skillId, row.roll ?? 0, seeded, row.precondition);
      grade(found, `debuffPreconditions ${row.precondition} ${row.skillId}`, mine, row);
    }
    return found;
  }

  /** `debuffApplyRow`: seed with one attacker, then plan with a fresh one at full HP. */
  private debuffRow(
    skillId: number,
    roll: number,
    seededDebuffs: number[],
    precondition?: string,
  ): Record<string, unknown> {
    let attacker = this.attacker();
    const target = this.target();
    for (const seeded of seededDebuffs) this.seedDebuff(attacker, target, seeded);
    if (seededDebuffs.length > 0) attacker = this.attacker();
    const hpBefore = target.hp();
    const draws: string[] = [];
    const pending = this.plan(attacker, target, skillId, roll, draws);
    const mine: Record<string, unknown> = {};
    if (precondition !== undefined) mine.precondition = precondition;
    const producer = this.producerFor(skillId);
    mine.skillId = skillId;
    mine.debuffId = producer?.debuffId ?? -1;
    mine.roll = roll;
    if (seededDebuffs.length > 0) mine.seededDebuffs = seededDebuffs;
    mine.planned = pending !== undefined;
    if (pending) {
      mine.operation = pending.operation;
      mine.appliesStatus = pending.appliesStatus();
      mine.supplementalDamage = pending.supplementalDamage;
      mine.delayedDamage = pending.delayedDamage;
      if (pending.appliesStatus()) pending.commit();
    }
    const debuffId = producer?.debuffId ?? -1;
    mine.active = target.hasDebuff(debuffId);
    mine.hpBefore = hpBefore;
    mine.slot = target.legacyRow(DEBUFF_BANK, debuffId);
    mine.instance = instance(target, DEBUFF_BANK, debuffId);
    mine.stats = stats(target);
    mine.draws = draws;
    return mine;
  }

  /** `shieldedDebuffRow`: buff 14 refuses every incoming status, so only the answer is recorded. */
  private shieldRow(skillId: number): Record<string, unknown> {
    const attacker = this.attacker();
    const target = this.target();
    this.effects.applySourceBuff(target, 14, -1);
    const draws: string[] = [];
    const pending = this.plan(attacker, target, skillId, 0, draws);
    return {
      precondition: "target buff 14",
      skillId,
      debuffId: this.producerFor(skillId)?.debuffId ?? -1,
      planned: pending !== undefined,
      operation: pending ? pending.operation : "",
      active: target.hasDebuff(this.producerFor(skillId)?.debuffId ?? -1),
      draws,
    };
  }

  gradeDebuffTick(): string[] {
    const found: string[] = [];
    for (const row of this.golden.debuffTick) {
      const attacker = this.attacker();
      const target = this.target();
      if (!this.seedDebuff(attacker, target, row.debuffId)) {
        found.push(`debuffTick ${row.debuffId} could not be seeded`);
        continue;
      }
      // The probe wounds the source so a Thực Loại heal is visible against a bar that is not full.
      attacker.damage(Math.max(1, Math.trunc(attacker.maxHp() / 4)));
      const hooks = {
        damageProjection: (amount: number) => amount,
        sourceResolver: (side: number) => (side === attacker.ownerSide ? attacker : undefined),
        healingProjection: (_source: StatusUnit, amount: number) => amount,
      };
      for (let tick = 1; tick < row.tick; tick++) {
        this.effects.tickSourceDebuff(target, row.debuffId, hooks);
      }
      const hpBefore = target.hp();
      const sourceHpBefore = attacker.hp();
      const damage = this.effects.tickSourceDebuff(target, row.debuffId, hooks);
      const mine = {
        debuffId: row.debuffId,
        tick: row.tick,
        damage,
        hpBefore,
        hp: target.hp(),
        sourceHpBefore,
        sourceHp: attacker.hp(),
        active: target.hasDebuff(row.debuffId),
        slot: target.legacyRow(DEBUFF_BANK, row.debuffId),
        instance: instance(target, DEBUFF_BANK, row.debuffId),
        stats: stats(target),
        draws: [],
      };
      grade(found, `debuffTick ${row.debuffId}@${row.tick}`, mine, row);
    }
    return found;
  }

  gradeStatProjection(): string[] {
    const found: string[] = [];
    for (const row of this.golden.statProjection) {
      const attacker = this.attacker();
      const unit = this.target();
      for (const debuffId of row.debuffs) this.seedDebuff(attacker, unit, debuffId);
      for (const buffId of row.buffs) this.effects.applySourceBuff(unit, buffId, -1);
      const mine = {
        buffs: row.buffs,
        debuffs: row.debuffs,
        activeBuffs: unit.activeStatusIds(BUFF_BANK),
        activeDebuffs: unit.activeStatusIds(DEBUFF_BANK),
        buffSlots: row.buffs.map((id) => ({ id, slot: unit.legacyRow(BUFF_BANK, id) })),
        debuffSlots: row.debuffs.map((id) => ({ id, slot: unit.legacyRow(DEBUFF_BANK, id) })),
        base: { ...unit.baseStats },
        stats: stats(unit),
      };
      grade(
        found,
        `statProjection ${row.buffs.join("+") || "-"}/${row.debuffs.join("+") || "-"}`,
        mine,
        row,
      );
    }
    return found;
  }

  gradeDamageWithStatuses(): string[] {
    const found: string[] = [];
    for (const row of this.golden.damageWithStatuses) {
      const attacker = this.attacker();
      const target = this.target();
      for (const buffId of row.attackerBuffs) this.effects.applySourceBuff(attacker, buffId, -1);
      for (const buffId of row.targetBuffs) this.effects.applySourceBuff(target, buffId, -1);
      const scripted = new Scripted(row.roll);
      const outcome = this.calculator.damage({
        attacker: this.combatant(attacker),
        target: this.combatant(target),
        skillId: row.skillId,
        randomPercent: scripted.next,
      });
      const mine = {
        attackerBuffs: row.attackerBuffs,
        targetBuffs: row.targetBuffs,
        roll: row.roll,
        skillId: row.skillId,
        attackerAtk: attacker.currentStats.attack,
        defenderDef: target.currentStats.defense,
        damage: outcome.damage,
        critFlag: outcome.critFlag,
        appliedDebuffId: outcome.appliedDebuffId,
        supplementalDamage: outcome.supplementalDamage,
        relation: outcome.relation,
        attackerBuffsAfter: attacker.activeStatusIds(BUFF_BANK),
        attackerSlots: row.attackerBuffs.map((id) => ({
          id,
          slot: attacker.legacyRow(BUFF_BANK, id),
        })),
        targetSlots: row.targetBuffs.map((id) => ({ id, slot: target.legacyRow(BUFF_BANK, id) })),
        attackerStats: stats(attacker),
        targetStats: stats(target),
        draws: scripted.draws,
      };
      grade(
        found,
        `damageWithStatuses ${row.attackerBuffs.join("+") || "-"}/${row.targetBuffs.join("+") || "-"}@${row.roll}`,
        mine,
        row,
      );
    }
    return found;
  }

  private combatant(unit: StatusUnit) {
    return {
      speciesId: unit.speciesId,
      attack: unit.currentStats.attack,
      defense: unit.currentStats.defense,
      visualSpriteId: this.sprites.get(unit.speciesId) ?? -1,
      unit,
    };
  }

  gradeReflect(): string[] {
    const found: string[] = [];
    const received = this.golden.unit.reflectReceivedDamage;
    for (const row of this.golden.reflect) {
      const unit = this.target();
      if (row.buff2) this.effects.applySourceBuff(unit, 2, -1);
      if (row.buff5) this.effects.applySourceBuff(unit, 5, -1);
      const buff2Percent = this.effects.buff2ReflectPercent(unit);
      const buff5Chance = this.effects.buff5ReflectChance(unit);
      const stored = this.effects.buff5Reflects(unit, row.roll) ? received : 0;
      const attacker = this.attacker();
      const plan = this.effects.planPostDamageModifiers({
        attackHit: true,
        targetSideOpponent: true,
        attackerHasHeldItem8: attacker.hasHeldItem(8),
        damage: received,
        receivedDamage: received,
        // The runtime hands the engine a roll it never drew when the attacker holds no item 8.
        heldItem8Roll: attacker.hasHeldItem(8) ? row.roll : 2147483647,
        heldItem8Chance: this.effects.heldItem8LeechChance(attacker),
        heldItem8HealPercent: this.effects.heldItem8HealPercent(attacker),
        targetHasBuff2: unit.hasBuff(2),
        buff2Percent,
        targetHasBuff5: unit.hasBuff(5),
        buff5StoredDamage: stored,
      });
      const mine = {
        buff2: unit.hasBuff(2),
        buff5: unit.hasBuff(5),
        buff2Percent,
        buff5Chance,
        roll: row.roll,
        storedDamage: stored,
        applyBuff2Reflect: plan.applyBuff2Reflect,
        buff2Reflect: plan.buff2Reflect,
        applyBuff5Reflect: plan.applyBuff5Reflect,
        buff5Reflect: plan.buff5Reflect,
        targetStats: stats(unit),
      };
      grade(found, `reflect ${row.buff2}/${row.buff5}@${row.roll}`, mine, row);
    }
    return found;
  }

  gradeClearing(): string[] {
    const found: string[] = [];
    for (const row of this.golden.clearing) {
      const attacker = this.attacker();
      const unit = this.target();
      for (const debuffId of row.debuffsBefore) this.seedDebuff(attacker, unit, debuffId);
      for (const buffId of row.buffsBefore) this.effects.applySourceBuff(unit, buffId, -1);
      // Read the two lists back out of the unit, so a debuff the producer path refused to plant shows
      // up as a disagreement instead of being echoed from the row and graded as a match.
      const buffsBefore = unit.activeStatusIds(BUFF_BANK);
      const debuffsBefore = unit.activeStatusIds(DEBUFF_BANK);
      const statsBefore = stats(unit);
      let returned = -1;
      switch (row.case) {
        case "removeBuffs 1":
          returned = this.effects.removeBuffs(unit, 1);
          break;
        case "removeBuffs 2":
          returned = this.effects.removeBuffs(unit, 2);
          break;
        case "removeBuffs 99":
          returned = this.effects.removeBuffs(unit, 99);
          break;
        case "removeDebuff 5":
          returned = this.effects.removeDebuff(unit, 5) ? 1 : 0;
          break;
        case "clearBuffs":
          this.effects.clearBuffs(unit);
          break;
        case "clearDebuffs":
          this.effects.clearDebuffs(unit);
          break;
        case "death":
          unit.setHp(0);
          break;
        case "battle end":
          this.effects.onBattleEnd(unit);
          break;
        default:
          throw new Error(`unhandled clearing row ${row.case}`);
      }
      const mine = {
        case: row.case,
        returned,
        buffsBefore,
        debuffsBefore,
        buffsAfter: unit.activeStatusIds(BUFF_BANK),
        debuffsAfter: unit.activeStatusIds(DEBUFF_BANK),
        statsBefore,
        statsAfter: stats(unit),
        alive: unit.alive(),
      };
      grade(found, `clearing ${row.case}`, mine, row);
    }
    return found;
  }

  gradeActiveQueueOrder(): string[] {
    const found: string[] = [];
    for (const row of this.golden.activeQueueOrder) {
      const attacker = this.attacker();
      const unit = this.target();
      for (const debuffId of row.debuffs) this.seedDebuff(attacker, unit, debuffId);
      for (const buffId of row.buffs) this.effects.applySourceBuff(unit, buffId, -1);
      const order = this.effects.planActiveOrder(unit);
      const mine = {
        buffs: row.buffs,
        debuffs: row.debuffs,
        outcome: order.outcome,
        entries: order.entries,
      };
      grade(found, `activeQueueOrder ${row.buffs.length}/${row.debuffs.length}`, mine, row);
    }
    return found;
  }

  /** Every section, so one call grades the whole table and the counts cannot silently shrink. */
  gradeAll(): { found: string[]; rows: number } {
    const sections: [string, () => string[], number][] = [
      ["buffApply", () => this.gradeBuffApply(), this.golden.buffApply.length],
      [
        "buffApplyOverDebuffs",
        () => this.gradeBuffApplyOverDebuffs(),
        this.golden.buffApplyOverDebuffs.length,
      ],
      ["buffStack", () => this.gradeBuffStack(), this.golden.buffStack.length],
      ["buffTick", () => this.gradeBuffTick(), this.golden.buffTick.length],
      ["debuffApply", () => this.gradeDebuffApply(), this.golden.debuffApply.length],
      [
        "debuffPreconditions",
        () => this.gradeDebuffPreconditions(),
        this.golden.debuffPreconditions.length,
      ],
      ["debuffTick", () => this.gradeDebuffTick(), this.golden.debuffTick.length],
      ["statProjection", () => this.gradeStatProjection(), this.golden.statProjection.length],
      [
        "damageWithStatuses",
        () => this.gradeDamageWithStatuses(),
        this.golden.damageWithStatuses.length,
      ],
      ["reflect", () => this.gradeReflect(), this.golden.reflect.length],
      ["clearing", () => this.gradeClearing(), this.golden.clearing.length],
      ["activeQueueOrder", () => this.gradeActiveQueueOrder(), this.golden.activeQueueOrder.length],
    ];
    const expected = [33, 15, 75, 90, 48, 96, 66, 216, 50, 202, 8, 12];
    const found: string[] = [];
    let rows = 0;
    sections.forEach(([name, run, count], index) => {
      if (count !== expected[index])
        found.push(`${name} carries ${count} rows, not ${expected[index]}`);
      rows += count;
      found.push(...run());
    });
    return { found, rows };
  }
}

describe("status lifecycle", () => {
  it("grades every row the Java engine measured", async () => {
    const rig = await Rig.load();
    const { found, rows } = rig.gradeAll();
    expect(found.slice(0, 20)).toEqual([]);
    // 33 + 15 + 75 + 90 + 48 + 96 + 66 + 216 + 50 + 202 + 8 + 12: the whole table, so a section that
    // quietly stops being graded shows up here even when every row it still has agrees.
    expect(rows).toBe(911);
  });

  it("rebuilds the two probe combatants from the row the table declares", async () => {
    const rig = await Rig.load();
    const { attacker, target } = rig.golden.unit;
    expect(rig.attacker().baseStats).toEqual(attacker.base);
    expect(rig.target().baseStats).toEqual(target.base);
    // Neither probe species carries a characteristic that moves a stat on its own, so the projection
    // a fresh unit gets back is exactly its base.
    expect(stats(rig.attacker())).toEqual(attacker.base);
    expect(stats(rig.target())).toEqual(target.base);
  });

  it("has teeth: a wrong catalog row disagrees with the golden table", async () => {
    const clean = await Rig.load();
    expect(clean.gradeAll().found).toEqual([]);

    const count = async (mutate: (file: string, json: unknown) => unknown): Promise<number> =>
      (await Rig.load(mutate)).gradeAll().found.length;

    const found: Record<string, number> = {};

    // Buff 2's secondary is the percent it throws back; the reflect rows read that column.
    found.wrongStoredValue = await count((file, json) => {
      if (!file.endsWith("status-mechanics.json")) return json;
      const table = json as {
        buffStoredValues: { buffId: number; secondary: { percent: number } | null }[];
      };
      return {
        ...table,
        buffStoredValues: table.buffStoredValues.map((row) =>
          row.buffId === 2 && row.secondary
            ? { ...row, secondary: { ...row.secondary, percent: 9 } }
            : row,
        ),
      };
    });

    // Phòng ngự stacks up to three; drop the cap and the second application stops growing.
    found.wrongStackCap = await count((file, json) => {
      if (!file.endsWith("status-mechanics.json")) return json;
      const table = json as { buffRules: { id: number; stackCap: number }[] };
      return {
        ...table,
        buffRules: table.buffRules.map((row) => (row.id === 4 ? { ...row, stackCap: 2 } : row)),
      };
    });

    // Gia Tốc is a charge status: its legacy column carries actions, not rounds.
    found.wrongConsumePolicy = await count((file, json) => {
      if (!file.endsWith("statuses.json")) return json;
      const rows = json as { stableKey: string; consumePolicy: string }[];
      return rows.map((row) =>
        row.stableKey === "LH-EFFECT-6-12"
          ? { ...row, consumePolicy: "ConsumePolicy.DURATION" }
          : row,
      );
    });

    // Tê Liệt lands on a roll below 20; make it certain and the draw disappears from the trace.
    found.certainStatus = await count((file, json) => {
      if (!file.endsWith("debuff-producers.json")) return json;
      const table = json as { producers: { skillId: number; chance: number }[] };
      return {
        ...table,
        producers: table.producers.map((row) =>
          row.skillId === 41 ? { ...row, chance: 100 } : row,
        ),
      };
    });

    // Only the ids the engine animates get a visual, and that list is data.
    found.wrongVisuals = await count((file, json) => {
      if (!file.endsWith("status-mechanics.json")) return json;
      const table = json as { activeVisualIdsByBank: Record<string, number[]> };
      return {
        ...table,
        activeVisualIdsByBank: {
          ...table.activeVisualIdsByBank,
          "0": table.activeVisualIdsByBank["0"].filter((id) => id !== 3),
        },
      };
    });

    // The hook rows are measured through skill 40, whose power the Liệt Hỏa branch scales the raw hit
    // by, so the balance record is the row to break.
    found.wrongPower = await count((file, json) => {
      if (!file.endsWith("skills-liet-hoa.json")) return json;
      const rows = json as { runtimeId: number; power: number }[];
      return rows.map((row) => (row.runtimeId === 40 ? { ...row, power: row.power + 5 } : row));
    });

    // Every count is a number a real run produced, and every one is above zero: a mutation the table
    // cannot see is a hole in the table, not a passing test.
    expect(found).toEqual({
      wrongStoredValue: 280,
      wrongStackCap: 12,
      wrongConsumePolicy: 14,
      certainStatus: 10,
      wrongVisuals: 6,
      wrongPower: 40,
    });
  });
});
