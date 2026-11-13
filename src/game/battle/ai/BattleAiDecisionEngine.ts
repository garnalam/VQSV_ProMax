import type { PackBattleAiProfile, PackSkillRow } from "../../../data/GameData";
import {
  SIGNATURE_FAMILY_CHARGE_ID,
  SIGNATURE_RESERVE_ID,
  signatureStatusLocation,
} from "../SignatureSkills";
import { BUFF_BANK } from "../StatusState";
import { BattleAiDecision } from "./BattleAiDecision";
import { hasDangerousControlStatus } from "./BattleAiObservationFactory";
import {
  numberField,
  stringField,
  type BattleAiItemOption,
  type BattleAiRulebook,
  type BattleAiSkillRecord,
} from "./BattleAiRulebook";
import type { BattleAiUnit } from "./BattleAiUnit";

/**
 * `BattleAiDecisionEngine.Roller`: the only randomness the source-v1 engine is allowed to ask for.
 *
 * The two labels are the whole contract — `"switch"` and `"skill-" + row.id` — and both are drawn
 * through the fight's own seeded stream in the live runtime, so a repeated battle repeats its bot.
 */
export type BattleAiRoller = {
  nextInt(label: string, bound: number): number;
};

/** `BattleAiDecisionEngine.Input`, with the four unit lists already narrowed to the AI's view. */
export type BattleAiEngineInput = {
  readonly actor: BattleAiUnit;
  readonly allies: readonly BattleAiUnit[];
  readonly opponents: readonly BattleAiUnit[];
  readonly reserves: readonly BattleAiUnit[];
  readonly profile: PackBattleAiProfile;
  readonly itemOptions: readonly BattleAiItemOption[];
  readonly itemBudgetRemaining: number;
  readonly lastSkillId: number;
  readonly repeatedUses: number;
  readonly turn: number;
  readonly turnsSinceSwitch: number;
  readonly roller: BattleAiRoller;
};

/** `BattleAiTier`, spelled the way the profile column spells it once the enum name is stripped. */
export type BattleAiTier = "WILD" | "TRAINER" | "ELITE" | "BOSS" | "COMPANION";

/** `BattleAiProfile.tier.toString()` reduced to the constant, as every other catalog column is. */
export function tierOfProfile(profile: PackBattleAiProfile): BattleAiTier {
  const dot = profile.tier.lastIndexOf(".");
  return (dot < 0 ? profile.tier : profile.tier.slice(dot + 1)) as BattleAiTier;
}

/** The input after `Input`'s own constructor clamps it, which is what every branch below reads. */
type NormalizedInput = {
  readonly actor: BattleAiUnit;
  readonly allies: readonly BattleAiUnit[];
  readonly opponents: readonly BattleAiUnit[];
  readonly reserves: readonly BattleAiUnit[];
  readonly profile: PackBattleAiProfile;
  readonly itemOptions: readonly BattleAiItemOption[];
  readonly itemBudgetRemaining: number;
  readonly lastSkillId: number;
  readonly repeatedUses: number;
  readonly turnsSinceSwitch: number;
  readonly roller: BattleAiRoller;
};

/** `BattleSkillRow.approvedBalance.mechanicsType`, with Java's `"source"` for a row that has none. */
const REGENERATION_TYPES = ["heal_regeneration", "cleanse_regeneration", "heal_reflect_chance"];
const CLEANSE_TYPES = ["cleanse_immunity", "cleanse_on_hit"];
const BUFF_TYPES = [
  "next_attack",
  "tradeoff_buff",
  "defense_reflect",
  "defense_stack",
  "damage_reduction_chance",
  "pp_overdrive",
  "tradeoff_speed",
  "self_buff_on_hit",
  "repeat_buff",
];
const STATUS_PRESSURE_TYPES = ["apply_status", "first_action_status", "low_hp_power_status"];
const CONDITION_TYPES = ["consume_for_power", "conditional_power", "conditional_pierce"];

/**
 * `BattleAiDecisionEngine` — the everyday bot brain the Java runtime runs for every NPC turn.
 *
 * This is the v1 engine the AI-v2 pipeline still falls back to, and the decision the golden table
 * grades the v2 shadow against: the urgent-item rescue, then earth petrification, then a tactical
 * switch, then every skill slot scored against every living candidate. Two properties are worth
 * naming because they are easy to "improve" away. The super-effective bucket is a *separate* winner
 * list — a type-advantaged move takes the turn even on a lower score — and the score itself is a
 * heuristic sum, not a projection of the real damage formula, so it does not have to agree with the
 * damage the hit would actually deal.
 *
 * Java reaches the catalogs through a singleton; here they arrive as the rulebook, and the units
 * arrive as `BattleAiUnit`, so the live runtime and the golden grader drive the same code.
 */
export class BattleAiDecisionEngine {
  constructor(private readonly rulebook: BattleAiRulebook) {}

  /** `BattleAiDecisionEngine.decide`, in the engine's own order. */
  decide(source: BattleAiEngineInput): BattleAiDecision {
    const input: NormalizedInput = {
      actor: source.actor,
      allies: [...source.allies],
      opponents: [...source.opponents],
      reserves: [...source.reserves],
      profile: source.profile,
      itemOptions: [...source.itemOptions],
      itemBudgetRemaining: Math.max(0, source.itemBudgetRemaining),
      lastSkillId: source.lastSkillId,
      repeatedUses: Math.max(0, source.repeatedUses),
      turnsSinceSwitch: Math.max(0, source.turnsSinceSwitch),
      roller: source.roller,
    };
    if (!input.actor.alive()) return BattleAiDecision.none("actor-fainted");

    const item = this.chooseUrgentItem(input);
    if (item !== undefined) return item;
    const petrification = this.choosePetrification(input);
    if (petrification !== undefined) return petrification;
    const tacticalSwitch = this.chooseTacticalSwitch(input);
    if (tacticalSwitch !== undefined) return tacticalSwitch;

    let best: BattleAiDecision | undefined;
    let bestSuperEffective: BattleAiDecision | undefined;
    for (let slot = 0; slot < input.actor.skillSlotCount; slot++) {
      const skillId = input.actor.skillAt(slot);
      if (
        skillId < 0 ||
        !input.actor.hasSkillPp(slot) ||
        !input.actor.canUseSourceSkillId(skillId)
      ) {
        continue;
      }
      const row = this.rulebook.skillRow(skillId);
      if (row === undefined) continue;
      for (const target of row.targetSide === 1 ? input.allies : input.opponents) {
        if (!target.alive()) continue;
        const score = this.scoreSkill(input, row, target);
        if (
          row.powerPercent > 0 &&
          row.targetSide !== 1 &&
          input.actor.skillElementRelationTo(target, row.skillId) === 0
        ) {
          if (bestSuperEffective === undefined || score > bestSuperEffective.score) {
            bestSuperEffective = BattleAiDecision.skill(
              skillId,
              target,
              score,
              `super-effective-priority,${this.skillRationale(row, target)}`,
            );
          }
        } else if (best === undefined || score > best.score) {
          best = BattleAiDecision.skill(skillId, target, score, this.skillRationale(row, target));
        }
      }
    }
    if (bestSuperEffective !== undefined) return bestSuperEffective;
    return best ?? BattleAiDecision.none("no-legal-skill");
  }

  /** `choosePetrification`: an earth enemy prefers landing Thạch Phu over anything else it could do. */
  private choosePetrification(input: NormalizedInput): BattleAiDecision | undefined {
    const element = this.rulebook.elementForSpecies(input.actor.speciesId);
    if (input.actor.ownerSide !== 1 || element !== 2) return undefined;
    let best: BattleAiDecision | undefined;
    let bestChance = 0;
    for (let slot = 0; slot < input.actor.skillSlotCount; slot++) {
      const id = input.actor.skillAt(slot);
      if (id < 0 || !input.actor.hasSkillPp(slot) || !input.actor.canUseSourceSkillId(id)) continue;
      const row = this.rulebook.skillRow(id);
      if (row === undefined) continue;
      for (const target of input.opponents) {
        const chance = this.rulebook.earthPetrificationPreference({
          element,
          enemyActor: true,
          hostileTarget: input.actor.ownerSide !== target.ownerSide,
          targetAlive: target.alive(),
          alreadyPetrified: target.hasSemanticStatus("petrified"),
          skillRuntimeId: id,
        });
        if (chance <= 0) continue;
        const score = this.scoreSkill(input, row, target);
        if (
          best === undefined ||
          chance > bestChance ||
          (chance === bestChance && score > best.score)
        ) {
          bestChance = chance;
          best = BattleAiDecision.skill(
            id,
            target,
            score,
            `earth-petrification-priority,${this.skillRationale(row, target)}`,
          );
        }
      }
    }
    return best;
  }

  /**
   * `chooseUrgentItem`: the four rescues, in Java's order, each costing one of the profile's item
   * budget. The score is a ranking label, not arithmetic the runtime spends.
   */
  private chooseUrgentItem(input: NormalizedInput): BattleAiDecision | undefined {
    if (input.profile.itemBudget <= 0 || input.itemBudgetRemaining <= 0) return undefined;
    if (input.itemOptions.length === 0) return undefined;
    const hp = input.actor.hpPercentValue();
    const heal = option(input.itemOptions, 1, 3);
    if (
      heal !== undefined &&
      hp <= input.profile.healingThresholdPercent &&
      input.actor.validateBattleItem(heal.itemId) === -1
    ) {
      return BattleAiDecision.item(heal.itemId, input.actor, 300 - hp, `low-hp=${hp}`);
    }
    const cleanse = option(input.itemOptions, 5);
    if (
      cleanse !== undefined &&
      input.actor.activeDebuffCount() > 0 &&
      input.actor.validateBattleItem(cleanse.itemId) === -1
    ) {
      const tier = tierOfProfile(input.profile);
      const controlWeight = hasDangerousControlStatus(input.actor) ? 70 : 0;
      if (controlWeight > 0 || tier === "BOSS" || tier === "ELITE") {
        return BattleAiDecision.item(
          cleanse.itemId,
          input.actor,
          230 + controlWeight,
          "cleanse-debuff",
        );
      }
    }
    const pp = option(input.itemOptions, 2, 3);
    if (
      pp !== undefined &&
      input.actor.usableSkillCount() <= 1 &&
      input.actor.totalSkillPpValue() <= 2 &&
      input.actor.validateBattleItem(pp.itemId) === -1
    ) {
      return BattleAiDecision.item(pp.itemId, input.actor, 205, "low-pp");
    }
    if (input.profile.mayRevive) {
      const revive = option(input.itemOptions, 4);
      if (revive !== undefined) {
        for (const reserve of input.reserves) {
          if (!reserve.alive() && reserve.validateBattleItem(revive.itemId) === -1) {
            return BattleAiDecision.item(revive.itemId, reserve, 215, "boss-revive");
          }
        }
      }
    }
    return undefined;
  }

  /**
   * `chooseTacticalSwitch`: only a pressured bot considers it, only a materially better bench earns
   * it (the 30-point margin), and the roll still has to come up short of the profile's chance.
   */
  private chooseTacticalSwitch(input: NormalizedInput): BattleAiDecision | undefined {
    if (
      !input.profile.tacticalSwitch ||
      input.reserves.length === 0 ||
      input.turnsSinceSwitch < input.profile.switchCooldownTurns
    ) {
      return undefined;
    }
    const opponent = mostThreateningOpponent(input.opponents);
    if (opponent === undefined) return undefined;
    const current = matchupScore(input.actor, opponent);
    const pressured =
      input.actor.hpPercentValue() <= 35 || current < 0 || hasDangerousControlStatus(input.actor);
    if (!pressured) return undefined;

    let bestIndex = -1;
    let best = current;
    for (let i = 0; i < input.reserves.length; i++) {
      const reserve = input.reserves[i];
      if (!reserve.alive() || reserve === input.actor) continue;
      const score = matchupScore(reserve, opponent) + Math.trunc(reserve.hpPercentValue() / 5);
      if (score > best) {
        best = score;
        bestIndex = i;
      }
    }
    const improvement = best - current;
    if (bestIndex < 0 || improvement < 30) return undefined;
    const chance = input.profile.switchChancePercent + Math.min(45, Math.max(0, improvement - 30));
    if (input.roller.nextInt("switch", 100) >= Math.min(100, chance)) return undefined;
    return BattleAiDecision.switchTo(
      bestIndex,
      180 + improvement,
      `matchup-improvement=${improvement}`,
    );
  }

  /**
   * `scoreSkill`: the heuristic sum. The damage terms only run for a hostile damaging skill, then
   * exactly one mechanics family speaks for the skill — a pet-design signature through its own
   * handler, otherwise through the record's `mechanicsType` — and the repetition, low-PP and jitter
   * terms are applied to whichever answer that left.
   */
  private scoreSkill(input: NormalizedInput, row: PackSkillRow, target: BattleAiUnit): number {
    const mechanics = this.rulebook.approvedBalance(row);
    const type = mechanics === undefined ? "source" : mechanics.mechanicsType;
    const status = mechanics === undefined ? "" : mechanics.status;
    let score = Math.max(0, row.powerPercent);

    if (row.powerPercent > 0 && row.targetSide !== 1) {
      const relation = input.actor.skillElementRelationTo(target, row.skillId);
      if (relation === 0) {
        score += Math.max(35, Math.trunc(row.powerPercent / 2));
      } else if (relation === 1) {
        score -= Math.max(25, Math.trunc(row.powerPercent / 3));
      }
      score += Math.max(0, 45 - Math.trunc(target.hpPercentValue() / 2));
      const projected = projectedDamage(input.actor, target, row, mechanics, this.rulebook);
      if (projected >= target.hp()) {
        score += 700;
        score -= Math.min(200, Math.max(0, projected - target.hp()));
      } else {
        score += Math.min(80, Math.trunc((projected * 80) / Math.max(1, target.hp())));
      }
      score += Math.min(
        70,
        Math.trunc((Math.max(0, target.attack()) * 25) / Math.max(1, input.actor.defense())),
      );
      score += Math.min(36, target.activeBuffCount() * 12);
    }

    const signature =
      row.damageBranch === "unified" &&
      mechanics !== undefined &&
      mechanics.stableKey.startsWith("PD-SIG-")
        ? mechanics
        : undefined;
    if (signature !== undefined) {
      if (signature.handler === "heal_with_family_condition") {
        const missing = 100 - target.hpPercentValue();
        score = missing <= 0 ? -300 : 80 + missing * 2;
      } else if (signature.handler === "defense_and_shield") {
        score = input.actor.hasBuff(15) ? -150 : 110;
      } else {
        score += this.signaturePower(input.actor, target, signature) - row.powerPercent;
      }
    } else if (type === "direct_heal") {
      const missing = 100 - target.hpPercentValue();
      score = missing <= 0 ? -300 : 80 + missing * 2 + Math.max(0, mechanics?.heal ?? 0);
    } else if (REGENERATION_TYPES.includes(type)) {
      score += 45 + (100 - target.hpPercentValue());
    } else if (CLEANSE_TYPES.includes(type)) {
      score += target.activeDebuffCount() === 0 ? -120 : 120;
    } else if (STATUS_PRESSURE_TYPES.includes(type)) {
      const chance =
        mechanics === undefined
          ? Math.max(0, row.chanceOrParam)
          : Math.max(mechanics.statusChance, mechanics.chance);
      score += target.hasSemanticStatus(status) ? -95 : 35 + Math.trunc(Math.max(0, chance) / 2);
      if (!target.hasSemanticStatus(status) && this.comboFollowUpAvailable(input.actor, status)) {
        score += 160;
      }
    } else if (BUFF_TYPES.includes(type)) {
      score += target.activeBuffCount() > 0 ? 18 : 72;
    } else if (type === "remove_buff" || type === "remove_buff_power") {
      score += target.activeBuffCount() > 0 ? 85 : -35;
    } else if (type === "steal_buffs") {
      score = target.activeBuffCount() > 0 ? 155 : -80;
    } else if (CONDITION_TYPES.includes(type)) {
      if (target.hasSemanticStatus(status)) {
        score += 180;
      } else if (status !== "") {
        score -= 80;
      }
    } else if (type === "life_steal" || type === "corrosion_life_steal") {
      score += Math.trunc((100 - input.actor.hpPercentValue()) / 2);
    } else if (type === "self_hp_damage") {
      score -= input.actor.hpPercentValue() < 45 ? 90 : 0;
    } else if (type === "exhaust_pp") {
      score += target.totalSkillPpValue() > 3 ? 35 : -50;
    }

    if (row.skillId === input.lastSkillId) {
      score -= input.profile.repetitionPenalty * Math.max(1, input.repeatedUses);
    }
    if (
      row.ppMax > 0 &&
      input.actor.skillPpForId(row.skillId) <= 1 &&
      tierOfProfile(input.profile) !== "BOSS"
    ) {
      score -= Math.max(5, row.learnTier * 5);
    }
    const randomness = input.profile.randomness;
    const jitter =
      randomness === 0
        ? 0
        : input.roller.nextInt(`skill-${row.skillId}`, randomness * 2 + 1) - randomness;
    return score + jitter;
  }

  /**
   * `SignatureSkillMechanics.power`: the power percent this handler would strike with, from which the
   * caller subtracts the row's own percent to get the delta the score wants.
   *
   * Only five handlers change the number. The rest answer `record.power`, which for a unified row is
   * the same value the row's `powerPercent` column already carries, so their delta is zero — the one
   * part of this family that reads like a no-op and is not a missing port.
   */
  private signaturePower(
    actor: BattleAiUnit,
    target: BattleAiUnit,
    record: BattleAiSkillRecord,
  ): number {
    const mechanics = record.mechanics;
    const conditional = numberField(mechanics, "conditionalPower");
    switch (record.handler) {
      case "first_move_speed_attack":
        return actor.speed() > target.speed() ? conditional : record.power;
      case "conditional_execute":
        return below(target, numberField(mechanics, "targetHpBelowPct"))
          ? conditional
          : record.power;
      case "conditional_burst":
        return this.signatureCondition(actor, target, record) ? conditional : record.power;
      case "damage_apply_or_cash_dot":
        return (
          record.power +
          (signatureHasStatus(target, stringField(mechanics, "status"))
            ? numberField(mechanics, "activeDotBonusPower")
            : 0)
        );
      case "damage_dispel_conditional":
        return target.activeBuffCount() > 0 ? conditional : record.power;
      default:
        return record.power;
    }
  }

  /** `SignatureSkillMechanics.condition`, the named precondition a burst or a heal checks. */
  private signatureCondition(
    actor: BattleAiUnit,
    target: BattleAiUnit,
    record: BattleAiSkillRecord,
  ): boolean {
    const mechanics = record.mechanics;
    switch (stringField(mechanics, "condition")) {
      case "self_hp_above_60":
        return actor.hp() * 100 > actor.maxHp() * 60;
      case "self_hp_below_30":
        return below(actor, 30);
      case "target_hp_below_40":
        return below(target, 40);
      case "target_has_debuff":
        return target.activeDebuffCount() > 0;
      case "has_reserve":
        return actor.hasBuff(SIGNATURE_RESERVE_ID);
      case "has_family_charge": {
        const charge = actor.statusInstance(BUFF_BANK, SIGNATURE_FAMILY_CHARGE_ID);
        return (
          charge !== undefined &&
          charge.stackCount >= Math.max(1, numberField(mechanics, "minimumCharge"))
        );
      }
      case "target_is_charmed_or_asleep": {
        const opponent = actor.signatureOpponent();
        return (
          opponent !== null &&
          (opponent.hasSemanticStatus("charmed") || opponent.hasSemanticStatus("sleep"))
        );
      }
      default:
        return false;
    }
  }

  /**
   * `comboFollowUpAvailable`: this bot's own row already carries a second skill that spends the
   * status, so planting it is worth a bonus. The gate is the same three legality tests the turn loop
   * uses, so a slot with no PP left cannot promise a follow-up.
   */
  private comboFollowUpAvailable(actor: BattleAiUnit, status: string): boolean {
    if (status === "") return false;
    for (let slot = 0; slot < actor.skillSlotCount; slot++) {
      const skillId = actor.skillAt(slot);
      if (skillId < 0 || !actor.hasSkillPp(slot) || !actor.canUseSourceSkillId(skillId)) continue;
      const row = this.rulebook.skillRow(skillId);
      const mechanics = row === undefined ? undefined : this.rulebook.approvedBalance(row);
      if (mechanics === undefined || mechanics.status !== status) continue;
      if (CONDITION_TYPES.includes(mechanics.mechanicsType)) return true;
    }
    return false;
  }

  /** `skillRationale`: what the engine says about itself, which the golden table grades verbatim. */
  private skillRationale(row: PackSkillRow, target: BattleAiUnit): string {
    const mechanics = this.rulebook.approvedBalance(row);
    return `typed=${mechanics === undefined ? "source" : mechanics.mechanicsType},target=${target.speciesId}`;
  }
}

/** `BattleAiDecisionEngine.projectedDamage`: the rough damage the kill-window term compares against. */
function projectedDamage(
  actor: BattleAiUnit,
  target: BattleAiUnit,
  row: PackSkillRow,
  mechanics: BattleAiSkillRecord | undefined,
  rulebook: BattleAiRulebook,
): number {
  let targetDefense = Math.max(0, target.defense());
  if (target.ownerSide === 0 && target.sourcePassiveTargetDefensePercent() > 0) {
    targetDefense = Math.trunc(
      (target.baseDefense() * (100 + target.sourcePassiveTargetDefensePercent())) / 100,
    );
  }
  const raw = Math.max(1, actor.attack() - targetDefense);
  let power = Math.max(0, row.powerPercent);
  if (mechanics !== undefined) {
    if (
      mechanics.mechanicsType === "random_power" &&
      mechanics.minimumPower > 0 &&
      mechanics.maximumPower >= mechanics.minimumPower
    ) {
      power = Math.trunc((mechanics.minimumPower + mechanics.maximumPower) / 2);
    } else if (
      mechanics.status !== "" &&
      target.hasSemanticStatus(mechanics.status) &&
      mechanics.conditionalPower > power
    ) {
      power = mechanics.conditionalPower;
    }
  }
  let damage = Math.max(1, Math.trunc((raw * Math.max(1, power)) / 100));
  const relation = rulebook.elementRelationTo(actor.speciesId, target.speciesId, row.skillId);
  if (relation === 0) {
    damage *= 2;
  } else if (relation === 1) {
    damage = Math.max(1, Math.trunc((damage * 60) / 100));
  }
  if (actor.ownerSide === 0 && actor.sourcePassiveDamagePercent() > 0) {
    damage += Math.trunc((damage * actor.sourcePassiveDamagePercent()) / 100);
  }
  return Math.max(1, damage);
}

/** `SignatureSkillMechanics.hasStatus`: whether the unit carries the status a dot-named handler names. */
function signatureHasStatus(unit: BattleAiUnit, status: string): boolean {
  const at = signatureStatusLocation(status);
  return at !== undefined && unit.hasStatus(at[0], at[1]);
}

/** `SignatureSkillMechanics.below`: strictly under `percent`, and only for a positive threshold. */
function below(unit: BattleAiUnit, percent: number): boolean {
  return percent > 0 && unit.hp() * 100 < unit.maxHp() * percent;
}

/** `BattleAiDecisionEngine.matchupScore`. */
function matchupScore(unit: BattleAiUnit, opponent: BattleAiUnit): number {
  const relation = unit.elementRelationTo(opponent);
  return relation === 0 ? 55 : relation === 1 ? -50 : 0;
}

/** `mostThreateningOpponent`: the living opponent with the most HP left, first slot wins a tie. */
function mostThreateningOpponent(opponents: readonly BattleAiUnit[]): BattleAiUnit | undefined {
  let best: BattleAiUnit | undefined;
  for (const opponent of opponents) {
    if (!opponent.alive()) continue;
    if (best === undefined || opponent.hpPercentValue() > best.hpPercentValue()) best = opponent;
  }
  return best;
}

/** `BattleAiDecisionEngine.option`: the first option for the earliest behavior the caller asked for. */
function option(
  options: readonly BattleAiItemOption[],
  ...behaviors: number[]
): BattleAiItemOption | undefined {
  for (const behavior of behaviors) {
    for (const each of options) {
      if (each.behavior === behavior) return each;
    }
  }
  return undefined;
}
