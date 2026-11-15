import type { PackSkill } from "../../data/GameData";
import { percentOfBase } from "./DesignTraits";
import type { P7HealSeams } from "./P7PostSkill";
import {
  BUFF_BANK,
  DEBUFF_BANK,
  RAINBOW_BANK,
  SHIELD_STATUS_ID,
  StatusInstance,
  type StatusDefinition,
  type StatusEffects,
  type StatusUnit,
} from "./StatusState";

/** `SignatureStatusCatalog`: the bank-0 identities a signature skill plants or reads. */
const COUNTER_STATUS_ID = 16;
const FAMILY_CHARGE_ID = 17;
const RESERVE_ID = 18;
/** Thạch Phu: every status attempt is refused while it lasts. */
const IMMUNITY_BUFF_ID = 14;
/** `SignatureSkillMechanics.dispel`'s own priority: DEF, damage, speed, then the rest. */
const DISPEL_PRIORITY = [4, 10, 8, 1, 7, 15, 3, 13];
/** A signature that pierces on its own lifts the pierce cap no higher than this. */
const SIGNATURE_PIERCE_CAP = 35;

/** `SignatureSkillSpec.HANDLERS`: the twelve handler families the pet-design skills are written in. */
export const SIGNATURE_HANDLERS = [
  "first_move_speed_attack",
  "hp_cost_attack",
  "damage_family_pressure",
  "conditional_execute",
  "damage_counter_stance",
  "defense_and_shield",
  "conditional_burst",
  "damage_apply_control",
  "heal_with_family_condition",
  "damage_apply_or_cash_dot",
  "damage_optional_pivot",
  "damage_dispel_conditional",
] as const;
export type SignatureHandler = (typeof SIGNATURE_HANDLERS)[number];

/** The bank and id each status name a signature skill writes resolves to. */
const SIGNATURE_STATUSES: Record<string, readonly [bank: number, id: number]> = {
  seed: [DEBUFF_BANK, 0],
  accuracy_down: [DEBUFF_BANK, 4],
  speed_down: [DEBUFF_BANK, 5],
  damage_down: [DEBUFF_BANK, 6],
  paralysis: [DEBUFF_BANK, 10],
  imprison: [RAINBOW_BANK, 4],
  corrosion: [RAINBOW_BANK, 5],
  bleed: [RAINBOW_BANK, 7],
  sleep: [RAINBOW_BANK, 8],
};

/**
 * `SignatureSkillMechanics.definition`: where a status a signature names actually lives. Java throws
 * for a name outside this table, so a caller that has to answer for one treats the unknown name as a
 * status nothing can carry rather than inventing a bank for it.
 */
export function signatureStatusLocation(
  status: string,
): readonly [bank: number, id: number] | undefined {
  return SIGNATURE_STATUSES[status];
}

/** `SignatureSkillMechanics.buff(unit, 17, …)` / `…(18, …)`: the two counters a condition reads. */
export const SIGNATURE_FAMILY_CHARGE_ID = FAMILY_CHARGE_ID;
export const SIGNATURE_RESERVE_ID = RESERVE_ID;

/** One `PD-SIG-*` record as `SignatureSkillSpec` reads it: the handler and its named numbers. */
export class SignatureSpec {
  readonly handler: SignatureHandler;
  constructor(
    readonly skill: PackSkill,
    private readonly data: Record<string, unknown>,
  ) {
    const handler = data.handler;
    if (!SIGNATURE_HANDLERS.includes(handler as SignatureHandler))
      throw new Error(`${skill.stableKey}: unknown signature handler ${String(handler)}`);
    this.handler = handler as SignatureHandler;
  }
  number(key: string): number {
    const value = this.data[key];
    return typeof value === "number" ? Math.trunc(value) : 0;
  }
  text(key: string): string {
    const value = this.data[key];
    return typeof value === "string" ? value : "";
  }
  flag(key: string): boolean {
    return this.data[key] === true;
  }
}

/** The unit fields a signature reads beyond `StatusUnit`: the pivot and the opponent of a design unit. */
type SignatureCarrier = StatusUnit & {
  signatureState?: {
    round: number;
    opponent?: StatusUnit;
    pendingPivot: boolean;
    pivotShieldPct: number;
    pivotShieldDuration: number;
  };
  designTraitState?: { dispelledBySkill: boolean };
};

/** What one strike with a signature (or Phệ Thuẫn U Minh) decided before the hit, and what it spends after. */
export type SignatureStrike = {
  power: number;
  /** The pierce this skill adds on its own, before the 35% cap. */
  defenseIgnore: number;
  /**
   * The after-hit effects; `dealt` is the HP the hit actually took. Returns the heal it gave the user.
   * `damage` is `commitUnifiedAfterDamage`'s `damageProjection`: the fight's last word on the
   * supplemental damage a unified skill deals after its hit (omitted: none).
   */
  afterDamage(
    hit: boolean,
    dealt: number,
    roll: (label: string) => number,
    heal: P7HealSeams,
    damage?: (amount: number) => number,
  ): number;
};

/**
 * The pet-design signature skills (`PD-SIG-*`, 258 of them in twelve handler families) and Phệ Thuẫn U
 * Minh (2000), ported from `SignatureSkillMechanics` / `UnifiedSkillMechanics.shield_break_power`.
 * Web rules only: the Java-parity formula still refuses the unified branch. Each skill reads its own
 * numbers from `mechanicsJson`; the description is the contract.
 *
 * The online rules this follows have no per-skill cooldown (`SignatureBattleState.ready` is always true):
 * a signature costs PP like any skill. Owners and unlock levels are the learnset's business.
 */
export class SignatureSkills {
  private constructor(
    private readonly specs: ReadonlyMap<number, SignatureSpec>,
    private readonly shieldBreak: ReadonlyMap<number, PackSkill>,
    private readonly effects: StatusEffects,
    /** Tê Liệt's own magnitude, which a signature paralysis takes when it names none. */
    private readonly paralysisPrimary: number,
  ) {}

  static from(
    petDesign: readonly PackSkill[],
    unified: readonly PackSkill[],
    effects: StatusEffects,
    paralysisPrimary: number,
  ): SignatureSkills {
    const specs = new Map<number, SignatureSpec>();
    for (const skill of petDesign)
      if (skill.stableKey.startsWith("PD-SIG-"))
        specs.set(skill.runtimeId, new SignatureSpec(skill, JSON.parse(skill.mechanicsJson)));
    const shieldBreak = new Map(
      unified
        .filter((skill) => skill.mechanicsType === "shield_break_power")
        .map((skill) => [skill.runtimeId, skill]),
    );
    return new SignatureSkills(specs, shieldBreak, effects, paralysisPrimary);
  }

  /** Whether this skill id resolves here (a signature or a shield breaker). */
  has(skillId: number): boolean {
    return this.specs.has(skillId) || this.shieldBreak.has(skillId);
  }

  spec(skillId: number): SignatureSpec | undefined {
    return this.specs.get(skillId);
  }

  /** A signature's or the shield breaker's plain Power: no condition met, nothing spent. */
  basePower(skillId: number): number | undefined {
    return this.shieldBreak.get(skillId)?.power ?? this.specs.get(skillId)?.skill.power;
  }

  /** `SignatureSkillMechanics.mayUse`, the part a fight decides: the HP a sacrifice needs to pay. */
  mayUse(unit: StatusUnit, skillId: number): boolean {
    const spec = this.specs.get(skillId);
    if (!spec) return true;
    if (!unit.alive()) return false;
    return (
      !spec.flag("requireHpAboveCost") ||
      unit.hp() > percentOfBase(unit.maxHp(), spec.number("selfHpCostPct"))
    );
  }

  /** Whether the skill has no damage step: Bảo hộ (shield) and Dưỡng (heal). */
  isNoDamage(skillId: number): boolean {
    const handler = this.specs.get(skillId)?.handler;
    return handler === "defense_and_shield" || handler === "heal_with_family_condition";
  }

  /**
   * `SignatureSkillMechanics.Plan` / `UnifiedSkillMechanics.prepare`: everything that has to be read
   * before the hit — the Power, the pierce, whether the target was already low or the user charged.
   */
  strike(
    attacker: StatusUnit,
    target: StatusUnit,
    skillId: number,
    actedFirst: boolean,
  ): SignatureStrike | undefined {
    const breaker = this.shieldBreak.get(skillId);
    if (breaker)
      return {
        // "tăng 100% thành 220 nếu mục tiêu còn khiên lúc ra đòn"; the shield then soaks the hit first.
        power: target.shieldHp() > 0 ? breaker.conditionalPower : breaker.power,
        defenseIgnore: 0,
        afterDamage: () => 0,
      };
    const spec = this.specs.get(skillId);
    if (!spec || this.isNoDamage(skillId)) return undefined;
    const low = below(target, spec.number("targetHpBelowPct")),
      charged = this.condition(attacker, target, spec);
    // "tiêu dấu": the burst spends the family charge as it commits, so the trait that built it
    // cannot spend the same charge on its own bonus in this action.
    if (charged && spec.handler === "conditional_burst" && spec.flag("consumeCondition")) {
      attacker.statuses.remove(BUFF_BANK, FAMILY_CHARGE_ID);
      attacker.restoreSourceStatusState();
    }
    return {
      power: this.power(target, spec, actedFirst, charged),
      defenseIgnore: Math.max(0, spec.number("defenseIgnorePct")),
      afterDamage: (hit, dealt, roll, heal) =>
        this.afterDamage(attacker, target, spec, { hit, dealt, low, charged }, roll, heal),
    };
  }

  /** The pierce a strike hands the formula: the projection's plus the skill's own, capped at 35. */
  static pierce(projected: number, own: number): number {
    return own > 0 ? Math.min(SIGNATURE_PIERCE_CAP, projected + own) : projected;
  }

  /**
   * `SignatureSkillMechanics.noDamage`: Bảo hộ (DEF and a shield) and Dưỡng (a heal that a condition
   * or a cleanse raises). The heal goes through the fight's heal seam, so anti-healing applies.
   */
  noDamage(attacker: StatusUnit, target: StatusUnit, skillId: number, heal: P7HealSeams): number {
    const spec = this.specs.get(skillId);
    if (!spec || !attacker.alive()) return 0;
    const recipient = target.alive() && target.ownerSide === attacker.ownerSide ? target : attacker,
      source = spec.skill.runtimeId,
      duration = spec.number("durationTurns");
    if (spec.handler === "defense_and_shield") {
      this.buff(attacker, 4, duration, spec.number("defensePct"), source);
      this.shield(attacker, spec.number("shieldMaxHpPct"), duration, source);
      return 0;
    }
    let raised = this.condition(attacker, recipient, spec);
    if (spec.number("cleanseCount") > 0) raised = this.cleanseOne(recipient);
    const amount = percentOfBase(
      recipient.maxHp(),
      spec.number("healMaxHpPct") + (raised ? spec.number("bonusHealPct") : 0),
    );
    const healed = heal.commit(attacker, recipient, amount);
    if (raised && spec.flag("consumeCondition"))
      attacker.statuses.remove(
        BUFF_BANK,
        spec.text("condition") === "has_reserve" ? RESERVE_ID : FAMILY_CHARGE_ID,
      );
    attacker.restoreSourceStatusState();
    return healed;
  }

  // ---------------------------------------------------------------- the handlers

  private power(
    target: StatusUnit,
    spec: SignatureSpec,
    actedFirst: boolean,
    charged: boolean,
  ): number {
    const base = spec.skill.power,
      conditional = spec.number("conditionalPower");
    switch (spec.handler) {
      case "first_move_speed_attack":
        return actedFirst ? conditional : base;
      case "conditional_execute":
        return below(target, spec.number("targetHpBelowPct")) ? conditional : base;
      case "conditional_burst":
        return charged ? conditional : base;
      case "damage_apply_or_cash_dot":
        return (
          base +
          (this.hasStatus(target, spec.text("status")) ? spec.number("activeDotBonusPower") : 0)
        );
      case "damage_dispel_conditional":
        return target.activeBuffCount() > 0 ? conditional : base;
      default:
        return base;
    }
  }

  /** `SignatureSkillMechanics.condition`, named by the record's `condition`. */
  private condition(attacker: StatusUnit, target: StatusUnit, spec: SignatureSpec): boolean {
    switch (spec.text("condition")) {
      case "self_hp_above_60":
        return attacker.hp() * 100 > attacker.maxHp() * 60;
      case "self_hp_below_30":
        return below(attacker, 30);
      case "target_hp_below_40":
        return below(target, 40);
      case "target_has_debuff":
        return target.activeDebuffCount() > 0;
      case "has_reserve":
        return attacker.hasBuff(RESERVE_ID);
      case "has_family_charge": {
        const charge = attacker.statuses.get(BUFF_BANK, FAMILY_CHARGE_ID);
        return !!charge && charge.stackCount >= Math.max(1, spec.number("minimumCharge"));
      }
      case "target_is_charmed_or_asleep": {
        const opponent = (attacker as SignatureCarrier).signatureState?.opponent ?? target;
        return opponent.hasSemanticStatus("charmed") || opponent.hasSemanticStatus("sleep");
      }
      default:
        return false;
    }
  }

  private afterDamage(
    attacker: StatusUnit,
    target: StatusUnit,
    spec: SignatureSpec,
    strike: { hit: boolean; dealt: number; low: boolean; charged: boolean },
    roll: (label: string) => number,
    heal: P7HealSeams,
  ): number {
    if (!strike.hit) return 0;
    const source = spec.skill.runtimeId,
      duration = spec.number("durationTurns");
    let healed = 0;
    switch (spec.handler) {
      case "first_move_speed_attack":
        if (attacker.alive()) this.buff(attacker, 7, duration, spec.number("speedPct"), source);
        break;
      case "damage_family_pressure":
        if (spec.text("sideEffect") === "strength_up") {
          if (attacker.alive()) this.buff(attacker, 10, duration, spec.number("valuePct"), source);
        } else
          this.status(
            attacker,
            target,
            "damage_down",
            duration,
            spec.number("valuePct"),
            spec,
            roll,
          );
        break;
      case "conditional_execute":
        // "dưới X% HP: Power Y" — and the user drinks part of the blow, measured before the hit.
        if (strike.low && strike.dealt > 0 && attacker.alive())
          healed = heal.commit(
            attacker,
            attacker,
            Math.min(
              percentOfBase(strike.dealt, spec.number("lowHpTargetHealPct")),
              percentOfBase(attacker.maxHp(), spec.number("healCapMaxHpPct")),
            ),
          );
        break;
      case "damage_counter_stance":
        if (attacker.alive())
          this.put(
            attacker,
            this.definition(BUFF_BANK, COUNTER_STATUS_ID),
            spec.number("counterDurationTurns"),
            spec.number("counterIncomingPct"),
            spec.number("counterIncomingMaxHpCapPct"),
            source,
          );
        break;
      case "damage_apply_control":
        this.status(
          attacker,
          target,
          spec.text("status"),
          duration,
          spec.number("valuePct"),
          spec,
          roll,
        );
        break;
      case "damage_apply_or_cash_dot": {
        const status = spec.text("status");
        this.status(attacker, target, status, duration, status === "bleed" ? 4 : 3, spec, roll);
        break;
      }
      case "damage_dispel_conditional": {
        const removed = this.dispel(target);
        const state = (attacker as SignatureCarrier).designTraitState;
        if (state && removed >= 0) state.dispelledBySkill = true;
        break;
      }
      case "damage_optional_pivot": {
        // The switch itself is the runtime's; a Giam Cầm or an empty bench still lets the hit land.
        const state = (attacker as SignatureCarrier).signatureState;
        if (attacker.alive() && state && !attacker.statuses.has(RAINBOW_BANK, 4)) {
          state.pendingPivot = true;
          state.pivotShieldPct = spec.number("transferShieldMaxHpPct");
          state.pivotShieldDuration = spec.number("transferDurationTurns");
        }
        break;
      }
      case "hp_cost_attack":
      default:
        break;
    }
    // Hiến: "trả X% HP tối đa sau khi gây damage … không tự gục".
    const cost = spec.number("selfHpCostPct");
    if (strike.dealt > 0 && cost > 0 && attacker.alive())
      attacker.setHp(Math.max(1, attacker.hp() - percentOfBase(attacker.maxHp(), cost)));
    return healed;
  }

  /** `SignatureSkillMechanics.status`: one roll at the record's chance; never refreshes an active one. */
  private status(
    attacker: StatusUnit,
    target: StatusUnit,
    name: string,
    turns: number,
    magnitude: number,
    spec: SignatureSpec,
    roll: (label: string) => number,
  ): void {
    const key = SIGNATURE_STATUSES[name];
    if (!key) throw new Error(`${spec.skill.stableKey}: unknown signature status ${name}`);
    if (!target.alive() || target.hasBuff(IMMUNITY_BUFF_ID) || target.statuses.has(key[0], key[1]))
      return;
    const chance = target.projectIncomingStatusChance(spec.number("chancePct"));
    if (!(roll(`signature.${spec.skill.stableKey}.status`) < chance)) return;
    const primary = name === "paralysis" && magnitude === 0 ? this.paralysisPrimary : magnitude;
    // Lôi Điện enhanced: `Math.max(1, n6 / 2)` on a player target, the authored turns otherwise.
    const halved = target.incomingDebuffTurns(turns),
      plantedTurns = halved === turns ? turns : Math.max(1, halved);
    this.put(
      target,
      this.definition(key[0], key[1]),
      plantedTurns,
      primary,
      0,
      spec.skill.runtimeId,
    );
    const planted = target.statuses.get(key[0], key[1]);
    if (planted) {
      planted.sourceSide = attacker.ownerSide;
      planted.sourceSlot = attacker.formationSlot;
    }
  }

  private hasStatus(unit: StatusUnit, name: string): boolean {
    const key = SIGNATURE_STATUSES[name];
    return !!key && unit.statuses.has(key[0], key[1]);
  }

  /** `SignatureSkillMechanics.buff`: a Liệt Hỏa stat buff worth a percent of the base stat. */
  private buff(unit: StatusUnit, id: number, turns: number, percent: number, source: number): void {
    const base =
      id === 4 ? unit.baseStats.defense : id === 7 ? unit.baseStats.speed : unit.baseStats.attack;
    this.put(
      unit,
      this.definition(BUFF_BANK, id),
      turns,
      percentOfBase(base, percent),
      percent,
      source,
    );
  }

  /** `SignatureSkillMechanics.shield`: a bigger shield replaces a smaller one, never the reverse. */
  private shield(unit: StatusUnit, percent: number, turns: number, source: number): void {
    const amount = percentOfBase(unit.maxHp(), percent),
      old = unit.statuses.get(BUFF_BANK, SHIELD_STATUS_ID);
    if (old && old.primaryValue >= amount) return;
    this.put(unit, this.definition(BUFF_BANK, SHIELD_STATUS_ID), turns, amount, 0, source);
  }

  /** `SignatureSkillMechanics.cleanseOne`: the first Liệt Hỏa debuff, else the first Cầu Vồng one. */
  private cleanseOne(unit: StatusUnit): boolean {
    for (const bank of [DEBUFF_BANK, RAINBOW_BANK]) {
      const [first] = unit.statuses.activeIds(bank);
      if (first === undefined) continue;
      unit.statuses.remove(bank, first);
      unit.restoreSourceStatusState();
      return true;
    }
    return false;
  }

  /** `SignatureSkillMechanics.dispel`: one buff, by priority, then the lowest id left. */
  private dispel(unit: StatusUnit): number {
    const pick =
      DISPEL_PRIORITY.find((id) => unit.hasBuff(id)) ?? unit.statuses.activeIds(BUFF_BANK)[0];
    if (pick === undefined) return -1;
    unit.statuses.remove(BUFF_BANK, pick);
    unit.restoreSourceStatusState();
    return pick;
  }

  private definition(bank: number, id: number): StatusDefinition {
    const definition = this.effects.catalog.definition(bank, id);
    if (!definition) throw new Error(`no status ${bank}/${id} in battle/statuses.json`);
    return definition;
  }

  /** `SignatureSkillMechanics.put`: owned by the skill, so the signature round-end pass ages it. */
  private put(
    unit: StatusUnit,
    definition: StatusDefinition,
    turns: number,
    primary: number,
    secondary: number,
    source: number,
  ): void {
    const round = (unit as SignatureCarrier).signatureState?.round ?? 1;
    unit.statuses.put(
      new StatusInstance(
        definition,
        Math.max(1, turns),
        definition.semanticKey === "sleep" ? 1 : 0,
        primary,
        secondary,
        1,
        unit.ownerSide,
        unit.formationSlot,
        source,
        -round - 1,
      ),
    );
    unit.restoreSourceStatusState();
  }
}

/** `SignatureSkillMechanics.below`: strictly under the percent of max HP. */
function below(unit: StatusUnit, percent: number): boolean {
  return percent > 0 && unit.hp() * 100 < unit.maxHp() * percent;
}
