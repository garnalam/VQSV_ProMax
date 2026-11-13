import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GameData } from "../../data/GameData";
import type {
  GoldenHeldItemsTable,
  GoldenStatusInstance,
  GoldenStatusStats,
  PackDebuffProducer,
  PackItem,
  PackSkillRow,
} from "../../data/GameData";
import { Pack } from "../../pack/Pack";
import { calculateMissChance, planHeldItemHpFloor } from "./BattleActionEngine";
import { BattleRandom } from "./BattleRandom";
import { DamageCalculator } from "./DamageCalculator";
import { NO_HELD_ITEM } from "./HeldItems";
import { resolveP7Strike } from "./P7Strike";
import { BUFF_BANK, DEBUFF_BANK, StatusEffects, type StatusUnit } from "./StatusState";

const root = resolve(import.meta.dirname, "..", "..", "..");

/**
 * The two columns of the engine's held-item row that `battle/items.json` does not carry. Both name a
 * row of the item text table, which is a UI concern; every column a battle effect reads is present,
 * including the icon cell, so those two are the whole of what this grader does not answer.
 */
const UNREADABLE_ITEM_COLUMNS = ["nameTextId", "descriptionTextId"];

/** `BattleUnit.randomPercent` handed a value it never drew, which is what the runtime passes. */
const UNDRAWN_ROLL = 2147483647;

/** A catalog edit standing in for a mistake a port could make, cleared once the rig is loaded. */
let mutation: ((file: string, json: unknown) => unknown) | undefined;

vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(root, "public", decodeURIComponent(input.replace(/^\//, "")));
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const value = mutation && file.endsWith(".json") ? mutation(file, parsed) : parsed;
  return { ok: true, status: 200, json: async () => value };
});

/** `ProbeWebBattleMath.Scripted(crit, jitter, other)`: one pinned value per label class. */
class Scripted {
  readonly draws: string[] = [];

  constructor(
    private readonly crit: number,
    private readonly jitter: number,
    private readonly other: number,
  ) {}

  next = (label: string): number => {
    const value = label.endsWith(".crit")
      ? this.crit
      : label.endsWith(".jitter")
        ? this.jitter
        : this.other;
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

/** Compare only the fields the golden row carries, so an omitted column is a stated gap, not a pass. */
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
 * The item a pet holds into a battle, graded against the table the Java engine wrote.
 *
 * A held item is not a separate slot: `PetBattleAdapter` copies `heldEquipmentId` into the unit's
 * form column and `hasSourceHeldItem(n)` is the same test the engine makes for a form status, so
 * every combatant here is rebuilt per row with the item the row names and nothing else. No row states
 * a magnitude; every number the port answers with is either read back out of the port or read out of
 * the row, and the two are compared.
 */
class Rig {
  private constructor(
    readonly data: GameData,
    readonly effects: StatusEffects,
    readonly calculator: DamageCalculator,
    readonly golden: GoldenHeldItemsTable,
    private readonly skillRows: PackSkillRow[],
    private readonly producers: PackDebuffProducer[],
    private readonly sprites: Map<number, number>,
    private readonly iconCells: Map<number, number>,
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
      const [golden, skills, debuffs, species, items] = await Promise.all([
        data.goldenHeldItems(),
        data.skillRows(),
        data.debuffProducers(),
        data.species(),
        data.items(),
      ]);
      const held = items.filter((item) => item.runtimeId >= 0 && isHeldItem(item));
      return new Rig(
        data,
        effects,
        calculator,
        golden,
        [...skills.rows].sort((a, b) => a.skillId - b.skillId),
        debuffs.producers,
        new Map(species.rows.map((row) => [row.speciesId, row.spriteId])),
        new Map(held.map((item) => [item.runtimeId, item.frameId])),
      );
    } finally {
      mutation = undefined;
    }
  }

  private unit(
    spec: { speciesId: number; side: number; base: GoldenStatusStats },
    item: number,
  ): StatusUnit {
    return this.effects.unit({
      speciesId: spec.speciesId,
      ownerSide: spec.side,
      formationSlot: 0,
      base: { ...spec.base },
      heldItemId: item,
    });
  }

  attacker(item: number = NO_HELD_ITEM): StatusUnit {
    return this.unit(this.golden.unit.attacker, item);
  }

  target(item: number = NO_HELD_ITEM): StatusUnit {
    return this.unit(this.golden.unit.target, item);
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

  private skillRow(skillId: number): PackSkillRow | undefined {
    return this.skillRows.find((row) => row.skillId === skillId);
  }

  /** `ProbeWebBattleMath.producerSkillFor`: the first skill that plants this debuff. */
  private seedSkillFor(debuffId: number): number | undefined {
    return this.producers
      .filter((row) => row.debuffId === debuffId)
      .map((row) => row.skillId)
      .sort((a, b) => a - b)[0];
  }

  /** `ProbeWebBattleMath.seedDebuff`: one debuff on the target through the engine's producer path. */
  private seedDebuff(attacker: StatusUnit, target: StatusUnit, debuffId: number): boolean {
    const skillId = this.seedSkillFor(debuffId);
    const row = skillId === undefined ? undefined : this.skillRow(skillId);
    if (skillId === undefined || !row) return false;
    const pending = this.effects.planTargetDebuff(attacker, target, skillId, row.effectId, silent);
    if (!pending || !pending.appliesStatus()) return false;
    pending.commit();
    return true;
  }

  /** `ProbeWebBattleMath.planDebuff`: one plan under a scripted roll, with the draws it took. */
  private plan(
    attacker: StatusUnit,
    target: StatusUnit,
    skillId: number,
    roll: number,
    draws: string[],
  ): ReturnType<StatusEffects["planTargetDebuff"]> {
    const row = this.skillRow(skillId);
    if (!row) return undefined;
    const scripted = new Scripted(99, 50, roll);
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

  /**
   * The row the engine resolves for each id. The icon cell is `items.json`'s frame id, which is the
   * same column the engine's item row answers with; the two text ids have no source in the pack yet.
   */
  gradeItems(): string[] {
    const found: string[] = [];
    const held = this.effects.heldItems;
    for (const row of this.golden.items) {
      const mine = {
        id: row.id,
        iconCell: this.iconCells.get(row.id) ?? -1,
        priceOrValue: held.param(row.id, 3, 0),
        currencyOrType: held.param(row.id, 4, 0),
        paramIndexes: row.paramIndexes,
        params: row.paramIndexes.map((index) => held.param(row.id, index, -1)),
      };
      const gradable = Object.fromEntries(
        Object.entries(row).filter(([field]) => !UNREADABLE_ITEM_COLUMNS.includes(field)),
      );
      grade(found, `items ${row.id}`, mine, gradable);
    }
    return found;
  }

  /** Items 1 and 2 multiply inside the engine's stat re-projection, ahead of every buff term. */
  gradeStatProjection(): string[] {
    const found: string[] = [];
    for (const row of this.golden.statProjection) {
      const attacker = this.attacker();
      const unit = this.target(row.item);
      // The probe clears an already empty buff bank, which is its only door into the re-projection.
      this.effects.clearBuffs(unit);
      for (const debuffId of row.debuffs) this.seedDebuff(attacker, unit, debuffId);
      for (const buffId of row.buffs) this.effects.applySourceBuff(unit, buffId, -1);
      const mine = {
        item: row.item,
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
        `statProjection ${row.item} ${row.buffs.join("+") || "-"}/${row.debuffs.join("+") || "-"}`,
        mine,
        row,
      );
    }
    return found;
  }

  /** Item 0 replaces the attack term once current HP is at or below a percent of base HP. */
  gradeBaseAttack(): string[] {
    const found: string[] = [];
    for (const row of this.golden.baseAttack) {
      const attacker = this.attacker(row.item);
      const target = this.target(row.targetItem);
      this.effects.clearBuffs(attacker);
      this.effects.clearBuffs(target);
      for (const buffId of row.buffs) this.effects.applySourceBuff(attacker, buffId, -1);
      const maxHp = attacker.maxHp();
      attacker.setHp(Math.trunc((maxHp * row.hpPercent) / 100));
      // The probe reads the attack term before the hit, because the hit spends buff 0.
      const baseAttack = this.calculator.sourceBaseAttackForCurrentTarget(
        this.combatant(attacker),
        this.combatant(target),
      );
      const hpBefore = attacker.hp();
      const scripted = new Scripted(99, 50, 99);
      const outcome = this.calculator.damage({
        attacker: this.combatant(attacker),
        target: this.combatant(target),
        skillId: this.golden.unit.hookSkillId,
        randomPercent: scripted.next,
      });
      const mine = {
        item: row.item,
        targetItem: row.targetItem,
        buffs: row.buffs,
        hpPercent: row.hpPercent,
        attackerHpBefore: hpBefore,
        attackerMaxHp: maxHp,
        attackerAtk: attacker.currentStats.attack,
        targetDef: target.currentStats.defense,
        baseAttack,
        damage: outcome.damage,
        critFlag: outcome.critFlag,
        draws: scripted.draws,
      };
      grade(
        found,
        `baseAttack ${row.item}/${row.targetItem} ${row.buffs.join("+") || "-"}@${row.hpPercent}`,
        mine,
        row,
      );
    }
    return found;
  }

  /** Item 4 adds its own column to the engine's crit chance, which the roll sweep then locates. */
  gradeCrit(): string[] {
    const found: string[] = [];
    for (const row of this.golden.crit) {
      const attacker = this.attacker(row.item);
      const target = this.target();
      this.effects.clearBuffs(attacker);
      const baseAttack = this.calculator.sourceBaseAttackForCurrentTarget(
        this.combatant(attacker),
        this.combatant(target),
      );
      const scripted = new Scripted(row.critRoll, 50, 99);
      const outcome = this.calculator.damage({
        attacker: this.combatant(attacker),
        target: this.combatant(target),
        skillId: this.golden.unit.hookSkillId,
        randomPercent: scripted.next,
      });
      const mine = {
        item: row.item,
        critRoll: row.critRoll,
        attackerAtk: attacker.currentStats.attack,
        targetDef: target.currentStats.defense,
        baseAttack,
        damage: outcome.damage,
        critFlag: outcome.critFlag,
        draws: scripted.draws,
      };
      grade(found, `crit ${row.item}@${row.critRoll}`, mine, row);
    }
    return found;
  }

  /** Item 3 scales an incoming status chance down before the roll is compared against it. */
  gradeStatusChance(): string[] {
    const found: string[] = [];
    for (const row of this.golden.statusChance) {
      const unit = this.target(row.item);
      const mine = {
        item: row.item,
        chance: row.chance,
        projected: unit.projectIncomingStatusChance(row.chance),
      };
      grade(found, `statusChance ${row.item}@${row.chance}`, mine, row);
    }
    return found;
  }

  /** The same resistance through the producer path, so the roll lands on the reduced chance. */
  gradeDebuffApply(): string[] {
    const found: string[] = [];
    for (const row of this.golden.debuffApply) {
      const attacker = this.attacker();
      const target = this.target(row.item);
      const hpBefore = target.hp();
      const draws: string[] = [];
      const pending = this.plan(attacker, target, row.skillId, row.roll, draws);
      const mine: Record<string, unknown> = {
        skillId: row.skillId,
        debuffId: row.debuffId,
        item: row.item,
        producerChance: row.producerChance,
        projectedChance: target.projectIncomingStatusChance(row.producerChance),
        roll: row.roll,
        planned: pending !== undefined,
      };
      if (pending) {
        mine.operation = pending.operation;
        mine.appliesStatus = pending.appliesStatus();
        mine.supplementalDamage = pending.supplementalDamage;
        mine.delayedDamage = pending.delayedDamage;
        if (pending.appliesStatus()) pending.commit();
      }
      mine.active = target.hasDebuff(row.debuffId);
      mine.hpBefore = hpBefore;
      mine.slot = target.legacyRow(DEBUFF_BANK, row.debuffId);
      mine.instance = instance(target, DEBUFF_BANK, row.debuffId);
      mine.stats = stats(target);
      mine.draws = draws;
      grade(found, `debuffApply ${row.skillId}/${row.debuffId} ${row.item}@${row.roll}`, mine, row);
    }
    return found;
  }

  /** Item 8 leeches a percent of the damage it dealt, on an inclusive roll, beside the buff-2 throw. */
  gradePostDamage(): string[] {
    const found: string[] = [];
    for (const row of this.golden.postDamage) {
      const attacker = this.attacker(row.item);
      const target = this.target();
      if (row.targetBuff2) this.effects.applySourceBuff(target, 2, -1);
      const hasItem8 = attacker.hasHeldItem(8);
      const chance = hasItem8 ? attacker.heldItemParam(8, 5, 0) : 0;
      const healPercent = hasItem8 ? attacker.heldItemParam(8, 6, 0) : 0;
      const buff2Percent = row.targetBuff2 ? target.legacyRow(BUFF_BANK, 2)[1] : 0;
      const plan = this.effects.planPostDamageModifiers({
        attackHit: row.attackHit,
        targetSideOpponent: row.targetSideOpponent,
        attackerHasHeldItem8: hasItem8,
        damage: row.damage,
        receivedDamage: row.receivedDamage,
        heldItem8Roll: hasItem8 ? row.roll : UNDRAWN_ROLL,
        heldItem8Chance: chance,
        heldItem8HealPercent: healPercent,
        targetHasBuff2: row.targetBuff2,
        buff2Percent,
        targetHasBuff5: false,
        buff5StoredDamage: 0,
      });
      const mine = {
        item: row.item,
        targetBuff2: row.targetBuff2,
        attackHit: row.attackHit,
        targetSideOpponent: row.targetSideOpponent,
        roll: hasItem8 ? row.roll : -1,
        chance,
        healPercent,
        damage: row.damage,
        receivedDamage: row.receivedDamage,
        buff2Percent,
        leech: plan.heldItem8Leech,
        heal: plan.heldItem8Heal,
        applyBuff2Reflect: plan.applyBuff2Reflect,
        buff2Reflect: plan.buff2Reflect,
      };
      grade(
        found,
        `postDamage ${row.item} ${row.attackHit}/${row.targetSideOpponent}@${row.roll}#${row.damage}`,
        mine,
        row,
      );
    }
    return found;
  }

  /** Item 9 answers zero before either cap is applied, so it also erases the holder's own blind. */
  gradeMissChance(): string[] {
    const found: string[] = [];
    for (const row of this.golden.missChance) {
      const attacker = this.attacker(row.item);
      const missChance = calculateMissChance({
        attackerSpeed: row.attackerSpeed,
        targetSpeed: row.targetSpeed,
        attackerHasDebuff4: row.hasDebuff4,
        debuff4Value: row.debuff4Value,
        attackerHasHeldItem9: attacker.hasHeldItem(9),
      });
      const mine = {
        item: row.item,
        attackerSpeed: row.attackerSpeed,
        targetSpeed: row.targetSpeed,
        hasDebuff4: row.hasDebuff4,
        debuff4Value: row.debuff4Value,
        missChance,
      };
      grade(found, `missChance ${row.item} ${row.targetSpeed}/${row.debuff4Value}`, mine, row);
    }
    return found;
  }

  /** Item 10 leaves the target at a floor of HP instead of letting the hit finish it. */
  gradeHpFloor(): string[] {
    const found: string[] = [];
    for (const row of this.golden.hpFloor) {
      const attacker = this.attacker(row.item);
      const target = this.target();
      // The floor is read off the attacker's item row whether or not the attacker holds it.
      const floor = attacker.heldItemParam(10, 5, 0);
      target.setHp(row.targetHp);
      const hpBefore = target.hp();
      const plan = planHeldItemHpFloor({
        contextAllowsFloor: row.contextAllowsFloor,
        attackerHasHeldItem10: attacker.hasHeldItem(10),
        targetHp: hpBefore,
        floor,
      });
      if (plan.apply) target.setHp(floor);
      const mine = {
        contextAllowsFloor: row.contextAllowsFloor,
        item: row.item,
        floor,
        targetHp: row.targetHp,
        hpBefore,
        apply: plan.apply,
        hpAfter: target.hp(),
        stats: stats(target),
      };
      grade(found, `hpFloor ${row.item}@${row.targetHp}/${row.contextAllowsFloor}`, mine, row);
    }
    return found;
  }

  /**
   * The whole runtime walk, in the runtime's order: zero-power gate, formula under the
   * `battle.P7.skill<id>` labels, miss chance, hit roll, resolution, the status the formula rolled
   * for, damage, item-10 floor, committed damage, leech, reflect. Each row rebuilds both units,
   * plants the buffs the row names, sets the HP the row names and replays the row's seed through the
   * battle's own stream, so a step done out of order moves a draw label, an intermediate HP, a final
   * stat or one of the two strips the row ends with and disagrees.
   */
  gradeP7Step(): string[] {
    const found: string[] = [];
    for (const row of this.golden.p7Step) {
      const attacker = this.attacker(row.item);
      const target = this.target(NO_HELD_ITEM);
      for (const buffId of row.targetBuffs) this.effects.applySourceBuff(target, buffId, -1);
      target.setHp(Math.max(1, Math.floor((target.maxHp() * row.targetHpPercent) / 100)));
      const skill = this.skillRow(row.skill);
      const mine = {
        skill: row.skill,
        item: row.item,
        targetBuffs: row.targetBuffs,
        targetHpPercent: row.targetHpPercent,
        seed: row.seed,
        powerPercent: skill?.powerPercent,
        targetSide: skill?.targetSide,
        attackerHpStart: attacker.hp(),
        targetHpStart: target.hp(),
        ...resolveP7Strike({
          attacker,
          receiver: target,
          skillId: row.skill,
          rules: { damage: this.calculator, status: this.effects },
          random: new BattleRandom(row.seed),
          attackerSpriteId: this.sprites.get(attacker.speciesId) ?? -1,
          receiverSpriteId: this.sprites.get(target.speciesId) ?? -1,
          // The probe's walk is the 1v1 owner's, where the player throws the ball and the enemy is
          // the one being hit, which is exactly the context the floor is allowed to lift in.
          allowsHpFloor: true,
        }),
      };
      const label = `p7Step ${row.skill}/${row.item}/${row.targetBuffs}/${row.targetHpPercent}/seed${row.seed}`;
      grade(found, label, mine, row);
    }
    return found;
  }

  /** Every section, so one call grades the whole table and the counts cannot silently shrink. */
  gradeAll(): { found: string[]; rows: number } {
    const sections: [string, () => string[], number][] = [
      ["items", () => this.gradeItems(), this.golden.items.length],
      ["statProjection", () => this.gradeStatProjection(), this.golden.statProjection.length],
      ["baseAttack", () => this.gradeBaseAttack(), this.golden.baseAttack.length],
      ["crit", () => this.gradeCrit(), this.golden.crit.length],
      ["statusChance", () => this.gradeStatusChance(), this.golden.statusChance.length],
      ["debuffApply", () => this.gradeDebuffApply(), this.golden.debuffApply.length],
      ["postDamage", () => this.gradePostDamage(), this.golden.postDamage.length],
      ["missChance", () => this.gradeMissChance(), this.golden.missChance.length],
      ["hpFloor", () => this.gradeHpFloor(), this.golden.hpFloor.length],
      ["p7Step", () => this.gradeP7Step(), this.golden.p7Step.length],
    ];
    const expected = [18, 315, 192, 36, 34, 222, 240, 156, 32, 476];
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

/** `HeldItems.HELD_ITEM_SOURCE_TABLE`: the raw table the battle engine reads a held item from. */
function isHeldItem(item: PackItem): boolean {
  return item.sourceTable === 3;
}

describe("held items in battle", () => {
  it("grades every row the Java engine measured", async () => {
    const rig = await Rig.load();
    const { found, rows } = rig.gradeAll();
    expect(found.slice(0, 20)).toEqual([]);
    // 18 + 315 + 192 + 36 + 34 + 222 + 240 + 156 + 32 + 476: the whole table, so a section that
    // quietly stops being graded shows up here even when every row it still has agrees.
    expect(rows).toBe(1721);
  });

  it("rebuilds the two probe combatants and the item table they hold", async () => {
    const rig = await Rig.load();
    const { attacker, target, noItem, battleItemIds } = rig.golden.unit;
    expect(noItem).toBe(NO_HELD_ITEM);
    expect(rig.attacker().baseStats).toEqual(attacker.base);
    expect(rig.target().baseStats).toEqual(target.base);
    // Nothing is held by default, and the id the row names is the one the unit answers with.
    expect(rig.attacker().heldItemId).toBe(NO_HELD_ITEM);
    for (const id of battleItemIds) {
      expect(rig.attacker(id).hasHeldItem(id)).toBe(true);
      expect(rig.target(id).heldItemId).toBe(id);
    }
    // The engine resolves eighteen held items and the pack carries exactly those eighteen.
    expect(rig.effects.heldItems.ids()).toEqual([...battleItemIds, 12, 13, 14, 15, 16, 17]);
  });

  it("has teeth: a wrong item parameter disagrees with the golden table", async () => {
    const clean = await Rig.load();
    expect(clean.gradeAll().found).toEqual([]);

    const count = async (mutate: (file: string, json: unknown) => unknown): Promise<number> =>
      (await Rig.load(mutate)).gradeAll().found.length;

    const found: Record<string, number> = {};

    // Mạn Đà La Thạch takes its HP threshold from column 5; move it and item 0 fires on a full bar.
    found.wrongThreshold = await count(heldItemParam(0, 5, 90));

    // Kiếm Khí lifts attack by column 5 percent inside the re-projection, ahead of every buff term.
    found.wrongAttackPercent = await count(heldItemParam(1, 5, 25));

    // Item 3's resistance is column 5, clamped to a percent before it scales the chance down.
    found.wrongResistance = await count(heldItemParam(3, 5, 10));

    // Item 4's crit bonus is column 5, added after the engine's own chance.
    found.wrongCritBonus = await count(heldItemParam(4, 5, 20));

    // Item 8's leech is column 5 for the gate and column 6 for the percent it heals back.
    found.wrongLeechChance = await count(heldItemParam(8, 5, 20));
    found.wrongLeechPercent = await count(heldItemParam(8, 6, 25));

    // Item 10's floor is column 5, read off the attacker whether or not the attacker holds it.
    found.wrongFloor = await count(heldItemParam(10, 5, 1));

    // The two producer-chance edits grade the status the walk commits. At zero the hit still lands
    // with the same damage and the same draws, but nothing is planted, so the strip, the speed that
    // strip moved and the killed target's cleared row all answer the old way; at one hundred every
    // hit plants. Both counts are for the whole table, because the same producer feeds the standalone
    // `debuffApply` section.
    found.debuffNeverLands = await count(producerChance(41, 0));
    found.debuffAlwaysLands = await count(producerChance(41, 100));

    expect(found).toEqual({
      wrongThreshold: 25,
      wrongAttackPercent: 624,
      wrongResistance: 355,
      wrongCritBonus: 5,
      wrongLeechChance: 298,
      wrongLeechPercent: 294,
      wrongFloor: 711,
      debuffNeverLands: 361,
      debuffAlwaysLands: 120,
    });
  });
});

/**
 * One producer chance, edited where the pack stores it: the walk asks the engine's `damage.debuff`
 * roll against this number, so the edit decides whether a status is planted at all.
 */
function producerChance(skillId: number, chance: number): (file: string, json: unknown) => unknown {
  return (file, json) => {
    if (!/[\\/]debuff-producers\.json$/.test(file)) return json;
    const table = json as { producers: { skillId: number; chance: number }[] };
    return {
      ...table,
      producers: table.producers.map((row) => (row.skillId === skillId ? { ...row, chance } : row)),
    };
  };
}

/**
 * One parameter of one held item, edited where the pack stores it: `effectParametersJson` is the
 * engine's CSV cell, so the edit has to go back through the same double-quote escaping.
 */
function heldItemParam(
  runtimeId: number,
  index: number,
  value: number,
): (file: string, json: unknown) => unknown {
  return (file, json) => {
    // Not `endsWith("items.json")`: the referee this grader reads is golden-held-items.json.
    if (!/[\\/]items\.json$/.test(file)) return json;
    return (json as PackItem[]).map((item) =>
      isHeldItem(item) && item.runtimeId === runtimeId ? withParam(item, index, value) : item,
    );
  };
}

function withParam(item: PackItem, index: number, value: number): PackItem {
  const text = item.effectParametersJson.trim();
  const unescaped = (
    text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text
  ).replaceAll('""', '"');
  const parsed = JSON.parse(unescaped) as { values?: number[] };
  const values = [...(parsed.values ?? [])];
  values[index - 3] = value;
  const encoded = JSON.stringify({ ...parsed, values }).replaceAll('"', '""');
  return { ...item, effectParametersJson: `"${encoded}"` };
}
