import type { StatusWebRules } from "./StatusWebRules";
import type {
  GameData,
  PackDebuffProducer,
  PackElementChart,
  PackSkill,
  PackSkillRow,
} from "../../data/GameData";
import { BUFF_BANK, DEBUFF_BANK, type PendingDebuff, type StatusUnit } from "./StatusState";
import { HeldItems, NO_HELD_ITEM } from "./HeldItems";

/**
 * One side of a hit, with only the numbers `BattleUnit.computeDamage` reads.
 *
 * The stats are the unit's *current* values, because buffs and badges move them before a hit, while
 * `heldItemId` is the unit's base form slot: `PetBattleAdapter` casts the pet's held equipment into
 * `BattleUnit.fromSpecies`'s form, and the engine reads that one byte both ways.
 */
export type DamageCombatant = {
  speciesId: number;
  attack: number;
  defense: number;
  visualSpriteId: number;
  /** `baseStats[STAT_FORM]`, i.e. `PetState.heldEquipmentId`; omitted is `NO_HELD_ITEM`. */
  heldItemId?: number;
  hp?: number;
  maxHp?: number;
  /** Active buff ids, i.e. `activeStatusIds(BANK_BUFF)`. */
  buffIds?: readonly number[];
  /** Active debuff ids, i.e. `activeStatusIds(BANK_DEBUFF)`. */
  debuffIds?: readonly number[];
  /** `sourcePassiveDamagePercent`, the attacker-side badge passive that lifts outgoing damage. */
  passiveDamagePercent?: number;
  /** `sourcePassiveTargetDefensePercent`, the badge passive that lifts this unit's defended stat. */
  passiveTargetDefensePercent?: number;
  /** `PetDesignTraitMechanics.defenseIgnore` for this unit's characteristic. */
  traitDefenseIgnorePercent?: number;
  /** `PetDesignTraitMechanics.powerBonusPercent` for this unit's characteristic. */
  traitPowerBonusPercent?: number;
  /**
   * The live combatant this side is fought by, when there is one. It wins over every snapshot above
   * except `visualSpriteId`, because the statuses it carries are what the formula reads its
   * magnitudes from and what Súc Lực is spent on: a snapshot of ids alone has no columns to read.
   */
  unit?: StatusUnit;
};

export type DamageRequest = {
  attacker: DamageCombatant;
  target: DamageCombatant;
  /** -1 is what the engine uses for "no skill authored", and falls back to the unit's first hit. */
  skillId: number;
  defenseIgnorePercent?: number;
  /** `BattleUnit.randomPercent`: one percent draw (bound 100) per labelled label, in draw order. */
  randomPercent: (label: string) => number;
  /**
   * Dấu tích (`pet-design-traits.json` powerRule): flat Power the characteristic adds to this hit's
   * own Power, so the hit gains `raw × bonus / 100`. Only a damaging skill takes it.
   */
  flatPowerBonus?: number;
  /**
   * Web rules: the Power a signature skill or Phệ Thuẫn U Minh resolved for this hit. It is what lets a
   * unified-branch skill through: without it that branch is still refused.
   */
  unifiedPower?: number;
  /**
   * `computeDamage`'s `powerOverridePercent`: a secondary hit (the 2v2 group target) lands at this
   * Power instead of the skill's own, after the skill branch. -1 / omitted is the skill's own.
   */
  powerOverridePercent?: number;
  /**
   * `computeDamage`'s `suppressSkillEffects`: the secondary hit carries no skill effect — no status
   * roll, no stored next-hit Power, no characteristic Power bonus, no follow-up hit.
   */
  suppressSkillEffects?: boolean;
};

/** The graded fields of `BattleDamageResult`: the hit, the crit flag, the relation and the status. */
export type DamageOutcome = {
  damage: number;
  critFlag: number;
  relation: number;
  appliedDebuffId: number;
  supplementalDamage: number;
  /**
   * Gia Tốc (web rules): the second hit the next damaging skills land, `raw × stored Power / 100`
   * through the type relation and the damage-dealt/taken percents, with no effect of its own. 0 when
   * the attacker carries no charge.
   */
  followUpDamage?: number;
  /** Every random value the engine asked for, as `label=value`, in the order it asked. */
  draws: string[];
  /**
   * `BattleDamageResult.pendingDebuff`: the status the formula rolled for but has not planted. The
   * runtime commits it on a hit, in its `COMMIT_PENDING` arm, one step before the damage lands. Only
   * a fight that stands on live units has one: a pure-math request has no unit to plant on.
   */
  pendingDebuff?: PendingDebuff;
};

/** The five Liệt Hỏa status keys `LietHoaSkillMechanics.hasStatus` can look up, by debuff id. */
const LIET_HOA_STATUS_KEYS: Record<string, number> = {
  seeded_damage: 0,
  dazed: 1,
  entangled: 2,
};

/**
 * `BattleUnit.isPowerPercentSkill`, plus the one skill id the engine names directly: ids that scale
 * the raw hit by their own power instead of using it unchanged.
 */
const POWER_PERCENT_SKILL_IDS = new Set([
  0, 6, 10, 11, 12, 13, 16, 17, 18, 19, 20, 26, 30, 31, 32, 33, 36, 37, 38, 39, 40, 46, 50, 51, 52,
  54, 55, 56, 57, 58, 60, 61, 63, 66, 68, 69,
]);

/** The ids whose legacy switch case reads a target status or an HP percentage instead of a power. */
const LEGACY_CONDITIONAL_SKILL_IDS = new Set([
  1, 2, 3, 7, 8, 9, 18, 19, 22, 23, 28, 29, 41, 43, 47, 49, 53, 59,
]);

/** `BattleUnit.HUYEN_THIET_TAN_CO` skill id: the one id that still takes the plain power path. */
const HUYEN_THIET_SKILL_ID = 136;

/** Java's integer division: the quotient truncates toward zero, so a negative hit is not floored. */
function divide(value: number, divisor: number): number {
  return Math.trunc(value / divisor);
}

/** The engine clamps a percent to this range before it uses it as a chance or a pierce. */
function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * Skill damage from pack data, the way `BattleUnit.computeDamage` computes it.
 *
 * Every input is a shipped row: the resolved skill row for the id, the Liệt Hỏa balance record for
 * its power, the species catalog for element and relation class, the dumped element chart for the
 * relation multiplier, the dumped debuff producers for the status chance and the item catalog for
 * what a held item is worth. The result is graded against `battle/golden-damage.json`,
 * `battle/golden-skill-branch.json` and `battle/golden-held-items.json`, all written by Java.
 *
 * The port covers the branches scene1 fights on — the Liệt Hóa branch and the plain power path —
 * plus the status hooks the engine runs inside the formula: Súc Lực spent on the next damaging skill,
 * the four percent terms of `applyDamageFormulaHooks`, the delayed Thực Loại hit that a producer
 * freezes into the status it plants, and the three held items the formula reads — item 0 below an HP
 * threshold, item 4 on the crit chance and item 3 on the incoming status chance. Everything else it
 * refuses rather than computing a number that would look right: the unified-v5 branch (which asks
 * `UnifiedSkillMechanics` for a power and takes an extra random draw first), a status magnitude with
 * no unit behind it, badge passives and characteristics. Those belong to the later slices, and a
 * silent approximation here would be a difference the player could see.
 */
export class DamageCalculator {
  private constructor(
    private readonly skillRows: Map<number, PackSkillRow>,
    private readonly lietHoaSkills: Map<number, PackSkill>,
    private readonly species: Map<number, { element: number; relationClass: number }>,
    private readonly chart: PackElementChart,
    private readonly beats: Set<string>,
    private readonly debuffProducers: Map<number, PackDebuffProducer>,
    private readonly debuffSlotCount: number,
    private readonly heldItems: HeldItems,
    /** The web build's status rules; without them the formula is the Java engine's. */
    private readonly web?: StatusWebRules,
  ) {}

  /** The same formula with the web build's status rules applied (`battle/status-web-rules.json`). */
  withWebRules(web: StatusWebRules): DamageCalculator {
    return new DamageCalculator(
      this.skillRows,
      this.lietHoaSkills,
      this.species,
      this.chart,
      this.beats,
      this.debuffProducers,
      this.debuffSlotCount,
      this.heldItems,
      web,
    );
  }

  static async load(data: GameData): Promise<DamageCalculator> {
    const [skillRows, lietHoaSkills, species, chart, debuffs, items] = await Promise.all([
      data.skillRows(),
      data.lietHoaSkills(),
      data.species(),
      data.elementChart(),
      data.debuffProducers(),
      data.items(),
    ]);
    if (skillRows.skillProfile !== "unified-v5") {
      throw new Error(
        `the damage port reads the ${skillRows.skillProfile} skill profile: the engine only skips` +
          " the speed term in its crit chance under unified-v5, so the dump has to be taken there",
      );
    }
    return new DamageCalculator(
      new Map(skillRows.rows.map((row) => [row.skillId, row])),
      new Map(lietHoaSkills.map((row) => [row.runtimeId, row])),
      new Map(
        species.rows.map((row) => [
          row.speciesId,
          { element: row.element, relationClass: row.relationClass },
        ]),
      ),
      chart,
      new Set(chart.beats.map(([attacker, defender]) => `${attacker}>${defender}`)),
      new Map(debuffs.producers.map((row) => [row.skillId, row])),
      debuffs.rules.length,
      HeldItems.from(items),
    );
  }

  /** A Liệt Hỏa skill's balance record (name, description, mechanics), or undefined. */
  lietHoaRecord(skillId: number): PackSkill | undefined {
    return this.lietHoaSkills.get(skillId);
  }

  /** The row the engine resolves for this skill id, or undefined where it resolves none. */
  skillRow(skillId: number): PackSkillRow | undefined {
    return this.skillRows.get(skillId);
  }

  /**
   * `BattleUnit.sourceBaseAttackForCurrentTarget`: the hit the formula starts from, floored at 1 and
   * with no pierce, which is what the engine asks for when it wants the number before any skill.
   */
  /** `LietHoaSkillMechanics.resolvedPower`: a Liệt Hỏa skill's Power against `target`, or undefined. */
  lietHoaResolvedPower(skillId: number, target: DamageCombatant): number | undefined {
    const skill = this.skillRows.get(skillId);
    if (!skill || skill.damageBranch !== "liet-hoa") return undefined;
    return this.lietHoaPower(skill, this.resolve(target));
  }

  sourceBaseAttackForCurrentTarget(attacker: DamageCombatant, target: DamageCombatant): number {
    return Math.max(1, this.baseAttack(this.resolve(attacker), this.resolve(target), 0));
  }

  damage(request: DamageRequest): DamageOutcome {
    const attacker = this.resolve(request.attacker);
    const target = this.resolve(request.target);
    const skill = this.skillRows.get(request.skillId);
    const unifiedPower = this.web ? request.unifiedPower : undefined;
    // A secondary hit at an overridden Power needs no resolved unified Power: the override replaces it.
    this.refuse(
      skill,
      attacker,
      target,
      unifiedPower !== undefined || (request.powerOverridePercent ?? -1) >= 0,
    );

    const draws: string[] = [];
    const roll = (label: string): number => {
      const value = request.randomPercent(label);
      draws.push(`${label}=${value}`);
      return value;
    };

    // `defenseIgnoreCap` only drops to 35 for a signature skill that pierces on its own, and the
    // unified branch that supplies that pierce is refused above.
    const pierce = clampPercent(request.defenseIgnorePercent ?? 0);
    let raw = this.baseAttack(attacker, target, pierce);

    let critChance = 5;
    const selfElement = this.species.get(attacker.speciesId)?.element ?? -1;
    if (selfElement >= 0 && attacker.visualSpriteId === this.finalVisualForElement(selfElement)) {
      critChance = 30;
    }
    // The engine adds the speed term here for a pre-unified profile, which this port refuses above.
    if (this.heldItems.holds(attacker.heldItemId, 4)) {
      critChance += this.heldItems.param(4, 5, 0);
    }
    let critFlag = 0;
    if (roll("damage.crit") <= critChance) {
      raw = divide(raw * 3, 2);
      critFlag = 1;
    }

    let damage = raw;
    let effectId = skill?.effectId ?? -1;
    if (skill) {
      if (skill.damageBranch === "liet-hoa") {
        damage = divide(raw * Math.max(0, this.lietHoaPower(skill, target)), 100);
      } else if (skill.damageBranch === "unified" && unifiedPower !== undefined) {
        // Web: a signature or the shield breaker, whose Power its own record resolved before the hit.
        damage = divide(raw * Math.max(0, unifiedPower), 100);
        effectId = -1;
      } else if (
        skill.skillId === HUYEN_THIET_SKILL_ID ||
        POWER_PERCENT_SKILL_IDS.has(skill.skillId)
      ) {
        damage = divide(raw * skill.powerPercent, 100);
      } else {
        // The legacy switch's default leaves the raw hit standing and drops the post-effect.
        effectId = -1;
      }
    }

    // The engine spends Súc Lực on the raw hit, not on the branch result, and only for a skill that
    // carries a power of its own.
    const damagingSkill = skill !== undefined && skill.powerPercent !== 0,
      suppress = request.suppressSkillEffects === true,
      override = request.powerOverridePercent ?? -1;
    if (override >= 0) {
      damage = divide(raw * override, 100);
    } else if (!suppress) {
      if (damagingSkill && (request.flatPowerBonus ?? 0) > 0) {
        damage += divide(raw * (request.flatPowerBonus ?? 0), 100);
      }
      const spent = this.spendNextDamagingSkillPower(attacker, raw, damagingSkill);
      // Web: "đạt 190% Power" — the stored Power is a floor; a stronger skill keeps its own number.
      if (spent >= 0) damage = this.web ? Math.max(damage, spent) : spent;
    }

    const { id: appliedDebuffId, pendingDebuff } = suppress
      ? { id: -1, pendingDebuff: undefined }
      : this.appliedDebuff(skill, attacker, target, effectId, roll);
    damage = this.damageFormulaHooks(attacker, target, damage, roll);
    // Lôi Điện: the badge lifts what the player side deals, before the element relation.
    if (attacker.passiveDamagePercent > 0) {
      damage += divide(damage * attacker.passiveDamagePercent, 100);
    }
    damage = this.webStatusPercent(attacker, target, damage);

    const relation = this.relation(attacker.speciesId, target.speciesId, skill);
    damage = this.applyRelation(relation, damage);
    const followUpDamage = suppress
      ? 0
      : this.followUpDamage(attacker, target, raw, relation, damagingSkill) +
        this.repeatHitDamage(request.skillId, attacker, target, raw, relation, roll);

    if (damage > 0) {
      const jitterRoll = roll("damage.jitter");
      // The engine only nudges when the hit is small enough for two percent of it to round away.
      if (divide(damage << 1, 100) <= 0) damage += jitterRoll > 50 ? 1 : -1;
    }
    return {
      damage: damage <= 0 ? 1 : damage,
      critFlag,
      relation,
      appliedDebuffId,
      // Skill 7 on a seeded target detonates the Gieo Hạt ticks still to come instead of planting it.
      supplementalDamage:
        pendingDebuff && !pendingDebuff.appliesStatus() ? pendingDebuff.supplementalDamage : 0,
      followUpDamage,
      draws,
      pendingDebuff,
    };
  }

  /**
   * Web rules: the heal a Liệt Hỏa `life_steal` / `chance_heal` skill's description names, read from its
   * record (`value` = percent, `cap` = HP ceiling, `chance`). Undefined for every other skill.
   */
  webSkillHeal(
    skillId: number,
  ):
    | { kind: "life_steal"; percent: number; capPercent: number }
    | { kind: "chance_heal"; percent: number; chance: number }
    | undefined {
    const record = this.lietHoaSkills.get(skillId);
    if (record?.mechanicsType === "life_steal")
      return {
        kind: "life_steal",
        percent: Math.max(0, record.value),
        capPercent: Math.max(0, record.cap),
      };
    if (record?.mechanicsType === "chance_heal")
      return {
        kind: "chance_heal",
        percent: Math.max(0, record.value),
        chance: Math.max(0, record.chance),
      };
    return undefined;
  }

  /**
   * What a Liệt Hỏa skill does to the target's statuses once it has hit (web rules; Java computes the
   * Power and leaves the status): `consume_for_power` clears the status it read ("…sau đó xóa trạng
   * thái"), `remove_buff` and `remove_buff_power` take one buff off ("xóa một buff").
   */
  afterHitStatusEffects(skillId: number, target: StatusUnit): string[] {
    if (!this.web) return [];
    const record = this.lietHoaSkills.get(skillId);
    if (!record) return [];
    const removed: string[] = [];
    if (record.mechanicsType === "consume_for_power") {
      const debuffId = LIET_HOA_STATUS_KEYS[record.status];
      if (debuffId !== undefined && target.hasDebuff(debuffId)) {
        removed.push(target.statuses.get(DEBUFF_BANK, debuffId)!.definition.displayName);
        target.effects.removeDebuff(target, debuffId);
      }
    } else if (
      record.mechanicsType === "remove_buff" ||
      record.mechanicsType === "remove_buff_power"
    ) {
      const [first] = target.activeStatusIds(BUFF_BANK);
      if (first !== undefined) {
        removed.push(target.statuses.get(BUFF_BANK, first)!.definition.displayName);
        target.effects.removeBuffs(target, 1);
      }
    }
    return removed;
  }

  /** `relationTo(target, skill)` by species and skill id: 0 effective, 1 resisted, -1 neutral. */
  relationFor(attackerSpeciesId: number, targetSpeciesId: number, skillId: number): number {
    return this.relation(attackerSpeciesId, targetSpeciesId, this.skillRows.get(skillId));
  }

  /** The relation multiplier the formula applies: ×2 effective, ×0.6 resisted. */
  applyRelationTo(relation: number, damage: number): number {
    return this.applyRelation(relation, damage);
  }

  private applyRelation(relation: number, damage: number): number {
    if (relation === 0) return damage * 2;
    if (relation === 1) return divide(damage * 60, 100);
    return damage;
  }

  /** Mị Hoặc on the attacker and Hóa Đá on the target (web rules). */
  private webStatusPercent(
    attacker: ResolvedCombatant,
    target: ResolvedCombatant,
    damage: number,
  ): number {
    if (!this.web) return damage;
    const percent =
      (attacker.unit ? this.web.damageDealtPercent(attacker.unit) : 0) +
      (target.unit ? this.web.damageTakenPercent(target.unit) : 0);
    return percent === 0 ? damage : Math.max(0, damage + divide(damage * percent, 100));
  }

  /** Gia Tốc's second hit, and the charge it spends (web rules). */
  private followUpDamage(
    attacker: ResolvedCombatant,
    target: ResolvedCombatant,
    raw: number,
    relation: number,
    damagingSkill: boolean,
  ): number {
    const unit = attacker.unit;
    if (!this.web || !unit || !damagingSkill) return 0;
    const buffId = this.web.document.followUpHit.buffId,
      charge = unit.statuses.get(BUFF_BANK, buffId);
    if (!charge) return 0;
    const power = Math.max(0, charge.primaryValue);
    unit.effects.consumeBuffAction(unit, buffId);
    const hit = this.webStatusPercent(attacker, target, divide(raw * power, 100));
    return Math.max(1, this.applyRelation(relation, hit));
  }

  /**
   * Long quyển / Phi Yến Hoàn Sào (web rules): on the skill's own chance, one more hit at the stored
   * percent of Power. The extra hit carries no effect of its own.
   */
  private repeatHitDamage(
    skillId: number,
    attacker: ResolvedCombatant,
    target: ResolvedCombatant,
    raw: number,
    relation: number,
    roll: (label: string) => number,
  ): number {
    if (!this.web) return 0;
    const record = this.lietHoaSkills.get(skillId);
    if (record?.mechanicsType !== "repeat_hit") return 0;
    if (roll("damage.repeatHit") >= Math.max(0, record.chance)) return 0;
    const hit = this.webStatusPercent(
      attacker,
      target,
      divide(divide(raw * Math.max(0, record.power), 100) * Math.max(0, record.value), 100),
    );
    return Math.max(1, this.applyRelation(relation, hit));
  }

  /**
   * `BattleUnit.baseAttack`: own attack against the target's defense with the pierce applied first.
   * Item 0 rewrites the attack term once the holder drops to its own HP threshold, and it keeps the
   * pierced defense it already computed: the threshold is a percent of the *base* HP while the
   * comparison is against the HP the battle has left, and the bonus multiplies the *current* attack,
   * so a buff 10 the holder is carrying is multiplied too.
   */
  private baseAttack(
    attacker: ResolvedCombatant,
    target: ResolvedCombatant,
    pierce: number,
  ): number {
    // Hỏa Phong: the engine overwrites the player target's live defense from its base before it
    // reads it, so the bonus replaces whatever buff or debuff the projection had put there.
    if (target.passiveTargetDefensePercent > 0 && target.unit) {
      const unit = target.unit;
      unit.currentStats.defense = Math.max(
        -32768,
        Math.min(
          32767,
          divide(unit.baseStats.defense * (100 + target.passiveTargetDefensePercent), 100),
        ),
      );
      target.defense = unit.currentStats.defense;
    }
    const defense = Math.max(0, target.defense);
    const piercedDefense = divide(defense * (100 - clampPercent(pierce)), 100);
    if (!this.heldItems.holds(attacker.heldItemId, 0)) {
      return attacker.attack - piercedDefense;
    }
    const threshold = divide(this.heldItems.param(0, 5, 0) * this.attackerMaxHp(attacker), 100);
    if (this.attackerHp(attacker) > threshold) {
      return attacker.attack - piercedDefense;
    }
    const strength = 100 + this.heldItems.param(0, 6, 0);
    return divide(attacker.attack * strength, 100) - piercedDefense;
  }

  private attackerHp(attacker: ResolvedCombatant): number {
    if (attacker.hp === undefined) {
      throw new Error(
        "item 0 compares the holder's HP against its own threshold, so the request has to carry the" +
          " attacker's hp",
      );
    }
    return attacker.hp;
  }

  private attackerMaxHp(attacker: ResolvedCombatant): number {
    if (attacker.maxHp === undefined) {
      throw new Error(
        "item 0 takes its HP threshold as a percent of the holder's base HP, so the request has to" +
          " carry the attacker's maxHp",
      );
    }
    return attacker.maxHp;
  }

  /** `LietHoaSkillMechanics.resolvedPower` for the id's Liệt Hỏa balance record. */
  private lietHoaPower(skill: PackSkillRow, target: ResolvedCombatant): number {
    const record = this.lietHoaSkills.get(skill.skillId);
    if (!record) {
      throw new Error(
        `skill ${skill.skillId} takes the Liệt Hỏa branch but battle/skills-liet-hoa.json has no` +
          ` record for it`,
      );
    }
    const power = Math.max(0, record.power);
    switch (record.mechanicsType) {
      case "conditional_power":
      case "consume_for_power":
      case "status_or_power":
        return this.hasLietHoaStatus(target, record.status)
          ? Math.max(power, record.conditionalPower)
          : power;
      case "missing_hp_power": {
        const { hp, maxHp } = this.targetHp(skill, target);
        const missing = Math.max(0, divide((maxHp - hp) * 100, Math.max(1, maxHp)));
        const bonus = divide(missing * Math.max(0, record.value), 10);
        const ceiling =
          record.conditionalPower > 0
            ? record.conditionalPower
            : record.cap > 0
              ? record.cap
              : power;
        return Math.min(Math.max(power, ceiling), power + bonus);
      }
      case "remove_buff_power":
        return target.buffIds.length > 0 ? Math.max(power, record.conditionalPower) : power;
      default:
        return power;
    }
  }

  /** `LietHoaSkillMechanics.hasStatus`: only three status keys can raise a Liệt Hỏa power. */
  private hasLietHoaStatus(target: ResolvedCombatant, status: string): boolean {
    const debuffId = LIET_HOA_STATUS_KEYS[status];
    return debuffId !== undefined && target.debuffIds.includes(debuffId);
  }

  /**
   * `VqsvBattleEffectLogic.planTargetDebuff`, reduced to the question the golden table asks: does a
   * status land, and what is its id? A roll below the chance lands; at or above it does not, and a
   * chance of 100 skips the roll entirely. The chance is the producer's after the item the *target*
   * holds has taken its percent off, so an item 3 can turn a guaranteed status into a drawn roll.
   *
   * On a fight that stands on live units the passed attempt also comes back as the pending status the
   * runtime commits after the hit, because this is the one place the engine's `damage.debuff` draw is
   * asked for: a caller that rolled again for the same attempt would shift every draw after it.
   */
  private appliedDebuff(
    skill: PackSkillRow | undefined,
    attacker: ResolvedCombatant,
    target: ResolvedCombatant,
    effectId: number,
    roll: (label: string) => number,
  ): { id: number; pendingDebuff?: PendingDebuff } {
    if (!skill || effectId < 0 || effectId >= this.debuffSlotCount) return { id: -1 };
    if (skill.effectMode !== 2) return { id: -1 };
    const producer = this.debuffProducers.get(skill.skillId);
    if (!producer || producer.debuffId !== effectId) return { id: -1 };
    if (skill.skillId === 18 && target.debuffIds.includes(2)) return { id: -1 };
    if (target.buffIds.includes(14)) return { id: -1 };
    if (skill.skillId === 7 && target.debuffIds.includes(0) && !this.web) {
      throw new Error(
        "skill 7 detonates an existing Gieo Hạt instead of applying it, and the detonation reads the" +
          " remaining turns stored on that status, which the Java-parity formula does not grade",
      );
    }
    // The engine only skips this projection when a characteristic is bridging the attempt, and
    // characteristics are a later slice.
    const chance = this.heldItems.projectIncomingStatusChance(
      target.heldItemId,
      Math.min(100, producer.chance + (attacker.unit?.statusChanceBonus ?? 0)),
    );
    if (chance < 100) {
      // `VqsvBattleEffectLogic.exactRollPasses`: below the chance lands, at or above it does not.
      const result = roll("damage.debuff");
      if (!(result >= 0 && result < chance)) return { id: -1 };
    }
    const source = attacker.unit;
    // A caller that hands only the numbers has no unit to plant into, but the engine still reports
    // the id it rolled, so the golden `debuffApply` table keeps grading on this side.
    if (!source || !target.unit) return { id: effectId };
    return {
      id: effectId,
      pendingDebuff: source.effects.pendingDebuffFromProducer(
        source,
        target.unit,
        skill.skillId,
        effectId,
      ),
    };
  }

  /**
   * `VqsvBattleEffectLogic.applyNextDamagingSkillPower`: buff 0 is spent on the next damaging skill,
   * which hits with the percent stored in its secondary column, and the buff is gone afterwards. -1 is
   * the engine's "no change".
   */
  private spendNextDamagingSkillPower(
    attacker: ResolvedCombatant,
    raw: number,
    damagingSkill: boolean,
  ): number {
    const unit = attacker.unit;
    if (!unit) return -1;
    return unit.effects.applyNextDamagingSkillPower(unit, raw, damagingSkill);
  }

  /**
   * `VqsvBattleEffectLogic.applyDamageFormulaHooks`: Phá Phủ adds its stored percent, Nhụt Chí on the
   * attacker takes its stored percent back off, Kiên Nhẫn on the target halves the hit on a roll below
   * its stored chance, and Điện áp adds its stored percent — in that order, each one reading the
   * result of the one before it.
   *
   * The engine skips the Kiên Nhẫn roll for a skill that clears the target's buffs. Under the unified
   * profile those ids go through the Liệt Hỏa branch, which sets a buff-removal count instead of that
   * flag, so the roll is never skipped here.
   */
  private damageFormulaHooks(
    attacker: ResolvedCombatant,
    target: ResolvedCombatant,
    damage: number,
    roll: (label: string) => number,
  ): number {
    if (attacker.buffIds.includes(1)) {
      damage += divide(damage * this.buffColumn(attacker, 1, 2), 100);
    }
    if (attacker.debuffIds.includes(6)) {
      damage -= divide(damage * this.debuffColumn(attacker, 6, 1), 100);
    }
    if (target.buffIds.includes(6)) {
      const chance = Math.max(0, this.buffColumn(target, 6, 1));
      // Kiên nhẫn: the stored secondary is the share the hit loses (50 = "giảm một nửa").
      const kept = 100 - Math.max(0, Math.min(100, this.buffColumn(target, 6, 2) || 50));
      if (roll("damage.buff6") < chance) damage = divide(damage * kept, 100);
    }
    if (attacker.buffIds.includes(8)) {
      damage += divide(damage * this.buffColumn(attacker, 8, 1), 100);
    }
    return damage;
  }

  /**
   * `VqsvBattleEffectLogic.delayedStatusDamage`: the hit a Thực Loại producer freezes into the status
   * it plants. It is the same formula on a smaller stage — the attacker's own attack against the
   * target's defense, three of the four hooks, the badge passive these units do not carry, and the
   * relation multiplier — and it draws nothing, which is why the golden draw list for a debuff-3
   * application has no entry for it.
   */
  delayedStatusDamage(source: StatusUnit, target: StatusUnit, powerPercent: number): number {
    const raw = Math.max(1, source.currentStats.attack - Math.max(0, target.currentStats.defense));
    let damage = Math.max(1, divide(raw * Math.max(0, powerPercent), 100));
    if (source.hasBuff(1)) damage += divide(damage * source.legacyRow(BUFF_BANK, 1)[2], 100);
    if (source.hasDebuff(6)) damage -= divide(damage * source.legacyRow(DEBUFF_BANK, 6)[1], 100);
    if (source.hasBuff(8)) damage += divide(damage * source.legacyRow(BUFF_BANK, 8)[1], 100);
    const relation = this.relation(source.speciesId, target.speciesId);
    if (relation === 0) {
      damage *= 2;
    } else if (relation === 1) {
      damage = divide(damage * 60, 100);
    }
    return Math.max(1, damage);
  }

  /** `BattleUnit.elementRelationTo`: the species' own elements, no skill. */
  speciesRelation(attackerSpeciesId: number, targetSpeciesId: number): number {
    return this.relation(attackerSpeciesId, targetSpeciesId);
  }

  /** A magnitude the formula reads off a live status, which is why a snapshot of ids is not enough. */
  private buffColumn(side: ResolvedCombatant, buffId: number, column: number): number {
    if (!side.unit) throw new Error(`buff ${buffId} has no unit to read column ${column} from`);
    return side.unit.legacyRow(BUFF_BANK, buffId)[column];
  }

  private debuffColumn(side: ResolvedCombatant, debuffId: number, column: number): number {
    if (!side.unit) throw new Error(`debuff ${debuffId} has no unit to read column ${column} from`);
    return side.unit.legacyRow(DEBUFF_BANK, debuffId)[column];
  }

  /**
   * `BattleUnit.relationTo(target, skill)`: a unified skill (Cầu Vồng, V4, signature — the rows
   * `unifiedV5()` answers for) attacks with its own element family instead of the species'.
   */
  private relation(
    attackerSpeciesId: number,
    targetSpeciesId: number,
    skill?: PackSkillRow,
  ): number {
    const self = this.species.get(attackerSpeciesId);
    const other = this.species.get(targetSpeciesId);
    const selfClass = self?.relationClass ?? 0;
    const otherClass = other?.relationClass ?? 0;
    const attackerEffective = !(selfClass !== 2 && otherClass === 2);
    const defenderEffective = !(selfClass === 2 && otherClass !== 2);
    const selfElement =
      skill?.damageBranch === "unified" && skill.elementFamily >= 0
        ? skill.elementFamily
        : (self?.element ?? -1);
    const otherElement = other?.element ?? -1;
    if (attackerEffective && this.beats.has(`${selfElement}>${otherElement}`)) return 0;
    if (defenderEffective && this.beats.has(`${otherElement}>${selfElement}`)) return 1;
    return -1;
  }

  /** `sourceFinalVisualForElement`: the visual that lifts this element's crit chance to 30. */
  private finalVisualForElement(element: number): number {
    return this.chart.sourceFinalVisualByElement[element]?.visualSpriteId ?? -1;
  }

  private targetHp(skill: PackSkillRow, target: ResolvedCombatant): { hp: number; maxHp: number } {
    if (target.hp === undefined || target.maxHp === undefined) {
      throw new Error(
        `skill ${skill.skillId} scales with the target's missing HP (${skill.stableKey}), so the` +
          " request has to carry the target's hp and maxHp",
      );
    }
    return { hp: target.hp, maxHp: target.maxHp };
  }

  /**
   * A live unit wins over the snapshot fields, because it is the thing the engine actually reads. The
   * three inputs it cannot carry — a badge passive and a characteristic — are forced to "none" rather
   * than taken from the request, since a `StatusUnit` provably holds none of them and honouring one
   * would be a number with nothing behind it. The held item is the one input the unit does carry, so
   * it wins over the request the same way the stats do.
   */
  private resolve(combatant: DamageCombatant): ResolvedCombatant {
    const unit = combatant.unit;
    return {
      speciesId: unit ? unit.speciesId : combatant.speciesId,
      attack: unit ? unit.currentStats.attack : combatant.attack,
      defense: unit ? unit.currentStats.defense : combatant.defense,
      visualSpriteId: combatant.visualSpriteId,
      heldItemId: unit ? unit.heldItemId : (combatant.heldItemId ?? NO_HELD_ITEM),
      hp: unit ? unit.hp() : combatant.hp,
      maxHp: unit ? unit.maxHp() : combatant.maxHp,
      buffIds: unit ? unit.activeStatusIds(BUFF_BANK) : [...(combatant.buffIds ?? [])],
      debuffIds: unit ? unit.activeStatusIds(DEBUFF_BANK) : [...(combatant.debuffIds ?? [])],
      passiveDamagePercent: unit
        ? unit.ownerSide === 0
          ? unit.sourcePassiveDamagePercent()
          : 0
        : (combatant.passiveDamagePercent ?? 0),
      passiveTargetDefensePercent: unit
        ? unit.ownerSide === 0
          ? unit.sourcePassiveTargetDefensePercent()
          : 0
        : (combatant.passiveTargetDefensePercent ?? 0),
      traitDefenseIgnorePercent: unit ? 0 : (combatant.traitDefenseIgnorePercent ?? 0),
      traitPowerBonusPercent: unit ? 0 : (combatant.traitPowerBonusPercent ?? 0),
      unit,
    };
  }

  /** Stop at the first input whose rule this slice does not carry, before any number is drawn. */
  private refuse(
    skill: PackSkillRow | undefined,
    attacker: ResolvedCombatant,
    target: ResolvedCombatant,
    unifiedResolved = false,
  ): void {
    if (skill?.damageBranch === "unified" && !unifiedResolved) {
      throw new Error(
        `skill ${skill.skillId} (${skill.stableKey}) takes the unified-v5 branch: the engine asks` +
          " UnifiedSkillMechanics for its power and pierce and draws a skill-effect roll before the" +
          " crit roll, which is not ported yet",
      );
    }
    if (
      skill &&
      skill.damageBranch === "source" &&
      LEGACY_CONDITIONAL_SKILL_IDS.has(skill.skillId)
    ) {
      throw new Error(
        `skill ${skill.skillId} (${skill.stableKey}) has a legacy damage case that reads a target` +
          " status or an HP percentage; the unified profile routes this id through the Liệt Hỏa" +
          " branch, so this row has no graded path",
      );
    }
    if (target.passiveTargetDefensePercent > 0 && !target.unit) {
      throw new Error(
        "Hỏa Phong rewrites the target's live defense from its base, so the request has to carry the" +
          " unit that holds it",
      );
    }
    if (attacker.traitDefenseIgnorePercent !== 0 || attacker.traitPowerBonusPercent !== 0) {
      throw new Error(
        "the unit's characteristic pierces defense or scales skill power, which is a later slice",
      );
    }
    for (const buff of attacker.buffIds) {
      if ((buff === 0 || buff === 1 || buff === 8) && !attacker.unit) {
        throw new Error(
          `attacker buff ${buff} changes damage by an amount stored on the status, so the request has` +
            " to carry the unit that holds it",
        );
      }
    }
    if (
      (attacker.debuffIds.includes(6) || target.buffIds.includes(6)) &&
      !(attacker.unit && target.unit)
    ) {
      throw new Error(
        "debuff 6 on the attacker or buff 6 on the target scales damage by a stored percent, so the" +
          " request has to carry the unit that holds it",
      );
    }
  }
}

/** A combatant reduced to the values the damage formula reads. */
type ResolvedCombatant = {
  speciesId: number;
  attack: number;
  defense: number;
  visualSpriteId: number;
  heldItemId: number;
  hp?: number;
  maxHp?: number;
  buffIds: number[];
  debuffIds: number[];
  passiveDamagePercent: number;
  passiveTargetDefensePercent: number;
  traitDefenseIgnorePercent: number;
  traitPowerBonusPercent: number;
  unit?: StatusUnit;
};
