import type { PackSkill } from "../../data/GameData";
import { percentOfBase } from "./DesignTraits";
import type { P7HealSeams } from "./P7PostSkill";
import type { SignatureStrike } from "./SignatureSkills";
import {
  BUFF_BANK,
  DEBUFF_BANK,
  RAINBOW_BANK,
  StatusInstance,
  type StatusEffects,
  type StatusUnit,
} from "./StatusState";
import type { StatusWebRules } from "./StatusWebRules";

/** Thạch Phu: every status attempt is refused while it lasts. */
const IMMUNITY_BUFF_ID = 14;
/** Phòng ngự, the buff the DEF stacks of Thiết Phật Trấn Sơn live on. */
const DEFENSE_BUFF_ID = 4;
const AGILITY_BUFF_ID = 7;
/** The Liệt Hỏa debuffs a Cầu Vồng skill writes as a secondary effect. */
const SECONDARY_DEBUFFS: Record<string, number> = {
  agility_down: 5,
  damage_down: 6,
  defense_down: 7,
};
/** The Cầu Vồng identities a skill's `status` names. */
const RAINBOW_STATUSES: Record<string, number> = {
  petrified: 0,
  charmed: 3,
  bound: 4,
  corrosion: 5,
  bleeding: 7,
  sleep: 8,
};

/** What a Cầu Vồng skill leaves for the runtime that owns the PP. */
export type RainbowPpEffect = { refund: number; exhaust: boolean };

/** A Cầu Vồng strike: the shared strike shape plus the PP it gives back or burns. */
export type RainbowStrike = SignatureStrike & { pp: RainbowPpEffect };

/**
 * The 33 Cầu Vồng skills (`CV-SKILL-00..32`, `skills.json`), web rules only. Each one does what its
 * description says, with its numbers read from the record (`status`, `statusChance`, `duration`, `value`,
 * `cap`, `conditionalPower`, the secondary columns). The statuses land through the ordinary lifecycle
 * the web rules already run: Hủ Thực bites 3%/6%/9% at the start of its owner's turn, Xé Rách bleeds at
 * round end, Hóa Đá and Ngủ take an action, Giam Cầm locks switching and items, Mị Hoặc cuts damage.
 */
export class RainbowSkills {
  private constructor(
    private readonly skills: ReadonlyMap<number, PackSkill>,
    private readonly effects: StatusEffects,
    private readonly rules: () => StatusWebRules,
  ) {}

  static from(
    unified: readonly PackSkill[],
    effects: StatusEffects,
    rules: () => StatusWebRules,
  ): RainbowSkills {
    return new RainbowSkills(
      new Map(
        unified
          // `UnifiedSkillCatalog` holds both the Cầu Vồng and the V4 sets; the 33 V4 rows mirror the
          // CV rows of the same number (mechanics, Power, status), and Java resolves both alike.
          .filter(
            (skill) =>
              skill.stableKey.startsWith("CV-SKILL-") || skill.stableKey.startsWith("V4-SKILL-"),
          )
          .map((skill) => [skill.runtimeId, skill]),
      ),
      effects,
      rules,
    );
  }

  has(skillId: number): boolean {
    return this.skills.has(skillId);
  }

  record(skillId: number): PackSkill | undefined {
    return this.skills.get(skillId);
  }

  /** The two kinds with no damage step: the water heals and Miên Ca Lam Mộng's sleep. */
  isNoDamage(skillId: number): boolean {
    const skill = this.skills.get(skillId);
    return !!skill && skill.power === 0;
  }

  /**
   * A zero-Power Cầu Vồng skill. A heal restores its percent of the recipient's max HP (in a 1v1 the
   * user itself); a status skill rolls its chance against the target. Returns the HP healed.
   */
  noDamage(
    attacker: StatusUnit,
    target: StatusUnit,
    skillId: number,
    roll: (label: string) => number,
    heal: P7HealSeams,
  ): number {
    const skill = this.skills.get(skillId);
    if (!skill || !attacker.alive()) return 0;
    if (skill.mechanicsType === "direct_heal") {
      const recipient =
        target.alive() && target.ownerSide === attacker.ownerSide ? target : attacker;
      return heal.commit(attacker, recipient, percentOfBase(recipient.maxHp(), skill.value));
    }
    this.applyStatus(attacker, target, skill, skill.statusChance, roll);
    return 0;
  }

  /**
   * `UnifiedSkillMechanics.resolvedPower(attacker, target, skill)`: the Power a secondary hit scales,
   * read without spending anything. `actedFirst` is the attacker being strictly faster. Undefined for
   * a skill these rules do not own.
   */
  resolvedPower(attacker: StatusUnit, target: StatusUnit, skillId: number): number | undefined {
    const skill = this.skills.get(skillId);
    if (!skill) return undefined;
    const actedFirst = attacker.currentStats.speed > target.currentStats.speed;
    switch (skill.mechanicsType) {
      case "shield_break_power":
        return target.shieldHp() > 0 ? skill.conditionalPower : skill.power;
      case "first_action_power":
        return actedFirst ? skill.conditionalPower : skill.power;
      case "target_hp_power":
        return target.hp() * 2 < target.maxHp() ? skill.conditionalPower : skill.power;
      case "self_hp_damage":
        return attacker.hp() * 2 < attacker.maxHp()
          ? Math.trunc((skill.power * (100 + skill.value)) / 100)
          : skill.power;
      case "low_hp_power_status":
        return attacker.hp() * 100 < attacker.maxHp() * 35 ? skill.conditionalPower : skill.power;
      case "conditional_power":
      case "consume_for_power":
        return this.hasStatus(target, skill.status) ? skill.conditionalPower : skill.power;
      case "consume_defense_power":
        return skill.power + Math.min(skill.cap, this.defenseStacks(attacker)) * skill.value;
      default:
        return skill.power;
    }
  }

  /** Everything read before the hit: Power, pierce, and what the target or the user already carry. */
  strike(
    attacker: StatusUnit,
    target: StatusUnit,
    skillId: number,
    actedFirst: boolean,
    roll: (label: string) => number,
  ): RainbowStrike | undefined {
    const skill = this.skills.get(skillId);
    if (!skill || skill.power === 0) return undefined;
    const corroded = target.statuses.has(RAINBOW_BANK, RAINBOW_STATUSES.corrosion),
      pp: RainbowPpEffect = { refund: 0, exhaust: false };
    let power = skill.power,
      defenseIgnore = 0;
    switch (skill.mechanicsType) {
      case "first_action_power":
        if (actedFirst) power = skill.conditionalPower;
        break;
      case "conditional_power":
      case "consume_for_power":
        if (this.hasStatus(target, skill.status)) power = skill.conditionalPower;
        break;
      case "low_hp_power_status":
        // "nếu người dùng dưới 35% HP".
        if (attacker.hp() * 100 < attacker.maxHp() * 35) power = skill.conditionalPower;
        break;
      case "consume_defense_power":
        power += Math.min(skill.cap, this.defenseStacks(attacker)) * skill.value;
        break;
      case "random_power": {
        const range = Math.max(1, skill.maximumPower - skill.minimumPower + 1);
        power = Math.min(
          skill.maximumPower,
          skill.minimumPower + Math.trunc((roll(`unified.${skill.stableKey}.power`) * range) / 100),
        );
        break;
      }
      case "defense_pierce":
        defenseIgnore = skill.value;
        break;
      case "conditional_pierce":
        if (corroded) defenseIgnore = skill.value;
        break;
    }
    return {
      power,
      defenseIgnore,
      pp,
      afterDamage: (hit, dealt, afterRoll, heal, damage) =>
        hit
          ? this.afterHit(
              attacker,
              target,
              skill,
              { dealt, corroded, actedFirst, pp },
              afterRoll,
              heal,
              damage,
            )
          : 0,
    };
  }

  // ---------------------------------------------------------------- after the hit

  private afterHit(
    attacker: StatusUnit,
    target: StatusUnit,
    skill: PackSkill,
    strike: { dealt: number; corroded: boolean; actedFirst: boolean; pp: RainbowPpEffect },
    roll: (label: string) => number,
    heal: P7HealSeams,
    damage: (amount: number) => number = (amount) => amount,
  ): number {
    let healed = 0;
    const capped = (amount: number, percent: number, cap: number) =>
      Math.min(percentOfBase(amount, percent), percentOfBase(attacker.maxHp(), cap));
    switch (skill.mechanicsType) {
      case "apply_status":
      case "low_hp_power_status":
        this.applyStatus(attacker, target, skill, skill.statusChance, roll);
        break;
      case "first_action_status":
        // "25% …; nếu hành động trước, xác suất tăng thành 40%".
        this.applyStatus(
          attacker,
          target,
          skill,
          strike.actedFirst ? skill.chance : skill.statusChance,
          roll,
        );
        break;
      case "life_steal":
        if (strike.dealt > 0)
          healed = heal.commit(attacker, attacker, capped(strike.dealt, skill.value, skill.cap));
        break;
      case "corrosion_life_steal":
        if (strike.corroded) {
          if (strike.dealt > 0)
            healed = heal.commit(attacker, attacker, capped(strike.dealt, skill.value, skill.cap));
          this.statBuff(
            attacker,
            DEFENSE_BUFF_ID,
            skill.secondaryDuration,
            skill.secondaryValue,
            skill,
          );
        } else this.applyStatus(attacker, target, skill, skill.statusChance, roll);
        break;
      case "corrosion_detonate":
        healed = this.detonate(attacker, target, skill, heal, damage);
        break;
      case "conditional_pierce":
        if (strike.corroded)
          this.secondary(
            target,
            skill.secondaryStatus,
            skill.secondaryDuration,
            skill.secondaryValue,
            skill,
          );
        break;
      case "corrosion_storm":
        healed = this.storm(attacker, target, skill, roll, heal, damage);
        break;
      case "defense_stack":
        this.stackDefense(attacker, skill);
        break;
      case "consume_defense_power":
        if (attacker.statuses.has(BUFF_BANK, DEFENSE_BUFF_ID)) {
          attacker.statuses.remove(BUFF_BANK, DEFENSE_BUFF_ID);
          attacker.restoreSourceStatusState();
        }
        break;
      case "self_buff_on_hit":
        this.statBuff(attacker, AGILITY_BUFF_ID, skill.duration, skill.value, skill);
        break;
      case "cleanse_on_hit":
        this.effects.clearOneDebuff(attacker);
        attacker.restoreSourceStatusState();
        break;
      case "consume_for_power":
        if (this.hasStatus(target, skill.status)) {
          target.statuses.remove(RAINBOW_BANK, RAINBOW_STATUSES[skill.status]);
          target.restoreSourceStatusState();
        }
        break;
      case "pp_refund":
        if (roll(`unified.${skill.stableKey}.ppRefund`) < skill.chance)
          strike.pp.refund = skill.value;
        break;
      case "exhaust_pp":
        strike.pp.exhaust = true;
        break;
      default:
        // damage, first_action_power, conditional_power, defense_pierce, random_power: Power only.
        break;
    }
    return healed;
  }

  /**
   * Bạo Chủng Liên Thứ: every Hủ Thực bite still to come lands now (the web ramp 3%/6%/9% read from
   * where it stands), the status goes, the user heals half of it up to its cap, and a detonation that
   * landed leaves the target dealing 15% less for 2 turns.
   */
  private detonate(
    attacker: StatusUnit,
    target: StatusUnit,
    skill: PackSkill,
    heal: P7HealSeams,
    damage: (amount: number) => number,
  ): number {
    const id = RAINBOW_STATUSES.corrosion,
      corrosion = target.statuses.get(RAINBOW_BANK, id);
    if (!corrosion || !target.alive()) return 0;
    const ramp = this.rules().rampPercent(id),
      elapsed = Math.max(0, corrosion.secondaryValue);
    let percent = 0;
    for (let bite = 1; bite <= Math.max(0, corrosion.remainingTurns); bite++)
      percent += ramp * (elapsed + bite);
    target.statuses.remove(RAINBOW_BANK, id);
    target.restoreSourceStatusState();
    const before = target.hp();
    // `target.damage(max(0, damageProjection(requested)))`.
    target.damage(Math.max(0, damage(Math.max(1, percentOfBase(target.maxHp(), percent)))));
    const landed = Math.max(0, before - target.hp());
    if (landed <= 0) return 0;
    const healed = heal.commit(
      attacker,
      attacker,
      Math.min(percentOfBase(landed, skill.value), percentOfBase(attacker.maxHp(), skill.cap)),
    );
    this.secondary(
      target,
      skill.secondaryStatus,
      skill.secondaryDuration,
      skill.secondaryValue,
      skill,
    );
    return healed;
  }

  /**
   * Vạn Mộc Tận Thực: a sure Hủ Thực whose first bite lands at once, half of that bite back to the user
   * up to its cap, then the target's damage and Linh xảo cut for 2 turns without stacking.
   */
  private storm(
    attacker: StatusUnit,
    target: StatusUnit,
    skill: PackSkill,
    roll: (label: string) => number,
    heal: P7HealSeams,
    damage: (amount: number) => number,
  ): number {
    if (!this.applyStatus(attacker, target, skill, skill.statusChance, roll)) return 0;
    const id = RAINBOW_STATUSES.corrosion,
      corrosion = target.statuses.get(RAINBOW_BANK, id)!,
      before = target.hp();
    target.damage(
      Math.max(0, damage(Math.max(1, percentOfBase(target.maxHp(), this.rules().rampPercent(id))))),
    );
    corrosion.secondaryValue = 1;
    corrosion.remainingTurns--;
    if (corrosion.remainingTurns <= 0) target.statuses.remove(RAINBOW_BANK, id);
    target.restoreSourceStatusState();
    const bite = Math.max(0, before - target.hp()),
      healed =
        bite > 0
          ? heal.commit(
              attacker,
              attacker,
              Math.min(
                percentOfBase(bite, skill.value),
                percentOfBase(attacker.maxHp(), skill.cap),
              ),
            )
          : 0;
    const extra = JSON.parse(skill.secondaryStatusesJson || "{}") as Record<string, number>;
    for (const [status, value] of Object.entries(extra))
      if (value > 0 && !target.hasDebuff(SECONDARY_DEBUFFS[status]))
        this.secondary(target, status, skill.secondaryDuration, value, skill);
    return healed;
  }

  // ---------------------------------------------------------------- statuses

  /**
   * One status attempt at `chance`: Thạch Phu refuses it, Ô Nha Uế takes its share off the chance, and a
   * Hóa Đá already standing is not refreshed by a skill whose description says so (Bá Kim Trảm Địa).
   */
  private applyStatus(
    attacker: StatusUnit,
    target: StatusUnit,
    skill: PackSkill,
    chance: number,
    roll: (label: string) => number,
  ): boolean {
    const id = RAINBOW_STATUSES[skill.status];
    if (id === undefined)
      throw new Error(`${skill.stableKey}: unknown Cầu Vồng status ${skill.status}`);
    if (!target.alive() || target.hasBuff(IMMUNITY_BUFF_ID)) return false;
    if (target.statuses.has(RAINBOW_BANK, id) && skill.description.includes("Không làm mới"))
      return false;
    const projected = target.projectIncomingStatusChance(
      Math.min(100, Math.max(0, chance) + attacker.statusChanceBonus),
    );
    if (projected < 100 && !(roll(`unified.${skill.stableKey}.status`) < projected)) return false;
    this.rules().applyRainbowDebuff(target, id, {
      turns: Math.max(1, target.incomingDebuffTurns(skill.duration)),
      primary: Math.max(0, skill.value),
      sourceSkill: skill.runtimeId,
    });
    const planted = target.statuses.get(RAINBOW_BANK, id);
    // Đặc tính miễn hiệu ứng xấu có thể chặn ngay lúc gắn: khi đó coi như không trúng.
    if (!planted) return false;
    planted.sourceSide = attacker.ownerSide;
    planted.sourceSlot = attacker.formationSlot;
    return true;
  }

  /** A secondary Liệt Hỏa debuff (`damage_down`, `agility_down`, `defense_down`) worth `value`%. */
  private secondary(
    target: StatusUnit,
    status: string,
    turns: number,
    value: number,
    skill: PackSkill,
  ): void {
    const id = SECONDARY_DEBUFFS[status];
    if (id === undefined || !target.alive() || target.hasBuff(IMMUNITY_BUFF_ID)) return;
    // `applyUnifiedSkillDebuff`: the floor first, then Lôi Điện's halving, then the floor again.
    const halved = Math.max(1, target.incomingDebuffTurns(Math.max(1, turns)));
    this.put(target, DEBUFF_BANK, id, halved, value, 0, 1, skill.runtimeId);
  }

  /** A stat buff worth `percent` of the base stat; it refreshes, it never stacks. */
  private statBuff(
    unit: StatusUnit,
    id: number,
    turns: number,
    percent: number,
    skill: PackSkill,
  ): void {
    const base = id === DEFENSE_BUFF_ID ? unit.baseStats.defense : unit.baseStats.speed;
    this.put(unit, BUFF_BANK, id, turns, percentOfBase(base, percent), percent, 1, skill.runtimeId);
  }

  /** Thiết Phật Trấn Sơn: one more DEF layer (up to `cap`), the whole stack refreshed. */
  private stackDefense(unit: StatusUnit, skill: PackSkill): void {
    const stacks = Math.min(Math.max(1, skill.cap), this.defenseStacks(unit) + 1);
    this.put(
      unit,
      BUFF_BANK,
      DEFENSE_BUFF_ID,
      skill.duration,
      stacks * percentOfBase(unit.baseStats.defense, skill.value),
      skill.value,
      stacks,
      skill.runtimeId,
    );
  }

  /** The DEF layers a unit carries: a stacked Phòng ngự counts its layers, any other counts as one. */
  private defenseStacks(unit: StatusUnit): number {
    const buff = unit.statuses.get(BUFF_BANK, DEFENSE_BUFF_ID);
    return buff ? Math.max(1, buff.stackCount) : 0;
  }

  private hasStatus(unit: StatusUnit, status: string): boolean {
    const id = RAINBOW_STATUSES[status];
    return id !== undefined && unit.statuses.has(RAINBOW_BANK, id);
  }

  private put(
    unit: StatusUnit,
    bank: number,
    id: number,
    turns: number,
    primary: number,
    secondary: number,
    stacks: number,
    source: number,
  ): void {
    const definition = this.effects.catalog.definition(bank, id);
    if (!definition) throw new Error(`no status ${bank}/${id} in battle/statuses.json`);
    unit.statuses.put(
      new StatusInstance(
        definition,
        Math.max(1, turns),
        definition.consumePolicy === "ACTION" ? 1 : 0,
        primary,
        secondary,
        stacks,
        unit.ownerSide,
        unit.formationSlot,
        source,
        0,
      ),
    );
    unit.restoreSourceStatusState();
  }
}
