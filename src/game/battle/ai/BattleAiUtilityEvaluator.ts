import { BattleAiActionCandidate, BattleAiEvaluation } from "./BattleAiActionCandidate";
import { BattleAiActorKey } from "./BattleAiActorKey";
import { BUFF_BANK, DEBUFF_BANK } from "../StatusState";
import type { BattleAiEncounterCatalog } from "./BattleAiEncounterCatalog";
import {
  type BattleAiEncounterSpec,
  type BattleAiObservation,
  type SkillView,
  type StatusView,
  type UnitView,
} from "./BattleAiObservation";
import type { BattleAiPolicyProjection } from "./BattleAiPolicyProjection";
import type { BattleAiPolicyBias } from "./BattleAiPolicyBias";
import type { BattleAiRationaleToken } from "./BattleAiRationaleToken";
import { BattleAiUtilityDecision } from "./BattleAiUtilityDecision";
import { type BattleAiUtilityWeights, utilityTotal, withModifiers } from "./BattleAiUtilityWeights";
import {
  type BattleAiRulebook,
  type BattleAiSkillRecord,
  RAINBOW_STATUS_BANK,
} from "./BattleAiRulebook";
import { floorMod, javaStringHashCode } from "./JavaStringHash";

/** `SUPPORTED_MECHANICS`: the families with a reviewed branch, and the reason an unknown one throws. */
const SUPPORTED_MECHANICS = new Set([
  "apply_status",
  "chance_heal",
  "cleanse_immunity",
  "cleanse_on_hit",
  "cleanse_regeneration",
  "conditional_pierce",
  "conditional_power",
  "consume_defense_power",
  "consume_for_power",
  "corrosion_detonate",
  "corrosion_life_steal",
  "corrosion_storm",
  "damage",
  "damage_reduction_chance",
  "defense_pierce",
  "defense_reflect",
  "defense_stack",
  "delayed_damage",
  "detonate_or_apply",
  "direct_heal",
  "exhaust_pp",
  "first_action_power",
  "first_action_status",
  "heal_reflect_chance",
  "heal_regeneration",
  "life_steal",
  "low_hp_power_status",
  "missing_hp_power",
  "next_attack",
  "pp_overdrive",
  "pp_refund",
  "pet_design_signature",
  "random_power",
  "remove_buff",
  "remove_buff_power",
  "repeat_buff",
  "repeat_hit",
  "retaliation_power",
  "self_buff_on_hit",
  "self_hp_damage",
  "status_or_power",
  "steal_buffs",
  "target_hp_power",
  "tradeoff_buff",
  "tradeoff_speed",
]);

/**
 * `SignatureSkillSpec.HANDLERS`. Java validates the handler while *building* the spec, so an authored
 * signature with a new handler fails the decision instead of silently scoring nothing.
 */
const SIGNATURE_HANDLERS = new Set([
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
]);

/**
 * `MutableScore`: the running breakdown plus a de-duplicated, insertion-ordered token set. Java holds
 * the tokens in a `LinkedHashSet`, so a repeat `add` neither duplicates nor reorders them.
 */
class MutableScore {
  immediate = 0;
  survival = 0;
  setup = 0;
  tempo = 0;
  resource = 0;
  future = 0;
  risk = 0;
  repetition = 0;
  persona = 0;
  readonly tokens = new Set<BattleAiRationaleToken>();

  add(token: BattleAiRationaleToken): void {
    this.tokens.add(token);
  }
}

/**
 * `vqsv.battle.ai.v2.BattleAiUtilityEvaluator` — the pure scoring pass over the public observation.
 *
 * Every number here is Java's authored scoring arithmetic, not a derived quantity: the element table
 * is the scorer's own `beats` copy (it agrees with `data/battle/element-chart.json` today, which the
 * port test asserts), the status asks go through the observation's three banks, and a mechanics family
 * with no reviewed branch throws rather than scoring zero. Skills are scored first so that the best
 * stay-in value can bound the switch margin, exactly as Java's two passes do.
 */
export class BattleAiUtilityEvaluator {
  constructor(
    private readonly rulebook: BattleAiRulebook,
    private readonly catalog: BattleAiEncounterCatalog,
  ) {}

  evaluate(
    encounter: BattleAiEncounterSpec,
    observation: BattleAiObservation,
    candidates: readonly BattleAiActionCandidate[],
    decisionSeed: number,
  ): BattleAiUtilityDecision {
    const policy = this.catalog.project(encounter, observation.phaseKey);
    return this.evaluateWithPolicy(encounter, observation, candidates, decisionSeed, policy);
  }

  evaluateWithPolicy(
    encounter: BattleAiEncounterSpec,
    observation: BattleAiObservation,
    candidates: readonly BattleAiActionCandidate[],
    decisionSeed: number,
    policy: BattleAiPolicyProjection,
  ): BattleAiUtilityDecision {
    if (encounter.encounterKey !== observation.encounterKey) {
      throw new Error("AI utility encounter and observation identities differ");
    }
    const weights = withModifiers(
      this.catalog.weights(encounter.intelligenceProfile),
      policy.modifiers,
    );
    const evaluated: BattleAiActionCandidate[] = [];
    let bestStay = Number.NEGATIVE_INFINITY;
    for (const candidate of candidates) {
      if (candidate.type === "SWITCH") continue;
      const value = this.evaluateCandidate(
        encounter,
        observation,
        candidate,
        weights,
        decisionSeed,
        policy,
        null,
      );
      evaluated.push(value);
      bestStay = Math.max(bestStay, value.finalUtility);
    }
    const stayBound = Number.isFinite(bestStay) ? bestStay : null;
    for (const candidate of candidates) {
      if (candidate.type !== "SWITCH") continue;
      evaluated.push(
        this.evaluateCandidate(
          encounter,
          observation,
          candidate,
          weights,
          decisionSeed,
          policy,
          stayBound,
        ),
      );
    }
    return new BattleAiUtilityDecision(evaluated);
  }

  private evaluateCandidate(
    encounter: BattleAiEncounterSpec,
    observation: BattleAiObservation,
    candidate: BattleAiActionCandidate,
    weights: BattleAiUtilityWeights,
    decisionSeed: number,
    policy: BattleAiPolicyProjection,
    bestStayUtility: number | null,
  ): BattleAiActionCandidate {
    const score = new MutableScore();
    let createsNewValue: boolean;
    switch (candidate.type) {
      case "SKILL":
        createsNewValue = this.evaluateSkill(observation, candidate, score);
        break;
      case "ITEM":
        createsNewValue = this.evaluateItem(observation, candidate, score);
        break;
      case "SWITCH":
        createsNewValue = this.evaluateSwitch(encounter, observation, candidate, score);
        break;
      default:
        throw new Error(`Unsupported AI candidate type ${String(candidate.type)}`);
    }

    this.applyRepetition(observation, candidate, score);
    this.applyNonDamageLimit(encounter, observation, candidate, createsNewValue, score);
    this.applyPersona(encounter, observation, candidate, policy, score);
    const jitter = this.controlledJitter(encounter, observation, candidate, decisionSeed);
    if (encounter.controlledRandomnessBand > 0) {
      score.add("DETERMINISTIC_JITTER");
    }
    const breakdown = (risk: number) => ({
      immediateValue: score.immediate,
      koAndSurvivalValue: score.survival,
      statusAndSetupValue: score.setup,
      tempoValue: score.tempo,
      ppAndResourceValue: score.resource,
      teamFutureValue: score.future,
      riskCost: risk,
      repetitionOrLoopCost: score.repetition,
      personaModifier: score.persona,
      controlledJitter: jitter,
    });
    let utility = utilityTotal(weights, breakdown(score.risk));

    if (candidate.type === "SWITCH" && bestStayUtility !== null) {
      const required = bestStayUtility + weights.switchMargin;
      if (utility < required) {
        score.add("SWITCH_MARGIN_NOT_MET");
        if (utility >= bestStayUtility) {
          const weightedGap = utility - bestStayUtility + 1;
          score.risk += Math.max(
            1,
            Math.trunc((weightedGap * 100) / Math.max(1, weights.riskPercent)),
          );
          utility = utilityTotal(weights, breakdown(score.risk));
          while (utility >= bestStayUtility) {
            score.risk++;
            utility = utilityTotal(weights, breakdown(score.risk));
          }
        }
      } else {
        score.add("SWITCH_MARGIN_MET");
      }
    }

    if (candidate.type === "SKILL") {
      const actor = this.requireUnit(observation, candidate.actor);
      const target = this.requireUnit(observation, candidate.target);
      const priority = this.rulebook.earthPetrificationPreference({
        element: actor.combatElementId,
        enemyActor: actor.actorKey.side === "NPC",
        hostileTarget: actor.actorKey.side !== target.actorKey.side,
        targetAlive: target.alive,
        alreadyPetrified: hasSemanticStatus(target, "petrified"),
        skillRuntimeId: candidate.skillRuntimeId,
      });
      if (priority > 0) {
        const bonus = 10000 + priority * 100;
        score.persona += bonus;
        utility += bonus;
      }
    }

    return candidate.withEvaluation(
      new BattleAiEvaluation(
        score.immediate,
        score.survival,
        score.setup,
        score.tempo,
        score.resource,
        score.future,
        score.risk,
        score.repetition,
        score.persona,
        jitter,
        utility,
        [...score.tokens],
      ),
    );
  }

  private evaluateSkill(
    observation: BattleAiObservation,
    candidate: BattleAiActionCandidate,
    score: MutableScore,
  ): boolean {
    const skill = this.rulebook.unifiedSkill(candidate.skillRuntimeId);
    if (skill === undefined || skill.stableKey !== candidate.skillKey) {
      throw new Error(
        `AI candidate references an inactive or mismatched Skill ${candidate.skillKey}`,
      );
    }
    const actor = this.requireUnit(observation, candidate.actor);
    const target = this.requireUnit(observation, candidate.target);
    const type = skill.mechanicsType;
    if (!SUPPORTED_MECHANICS.has(type)) {
      throw new Error(
        `AI utility has no reviewed mechanics family for ${skill.stableKey} / ${type}`,
      );
    }
    const enemyTarget = target.actorKey.side !== actor.actorKey.side;
    const damaging = skill.power > 0 && enemyTarget;
    let newValue = false;

    if (type === "pet_design_signature") {
      if (!skill.stableKey.startsWith("PD-SIG-")) {
        throw new Error(`Signature Skill has no typed contract: ${skill.stableKey}`);
      }
      if (!SIGNATURE_HANDLERS.has(skill.handler)) {
        throw new Error(`Unknown signature handler ${skill.handler}`);
      }
      if (skill.handler === "heal_with_family_condition") {
        const missing = 100 - target.hpPercent;
        if (missing <= 0) {
          score.risk += 140;
          score.repetition += 80;
          score.add("OVERHEAL");
        } else {
          score.immediate += Math.min(150, missing * 2);
          score.survival += target.hpPercent <= 35 ? 90 : missing;
          newValue = missing >= 12;
          score.add("USEFUL_HEAL");
        }
      } else if (skill.handler === "defense_and_shield") {
        score.setup += 80;
        score.survival += actor.hpPercent <= 50 ? 70 : 30;
        score.future += 25;
        newValue = true;
        score.add("NEW_STATUS_SETUP");
      }
    }

    if (damaging) {
      let projectedPower = skill.power;
      if (type === "random_power") {
        if (skill.minimumPower <= 0 || skill.maximumPower < skill.minimumPower) {
          throw new Error(`AI random-Power contract is invalid for ${skill.stableKey}`);
        }
        // The planner stays pure and deterministic: score the exact uniform-range expectation,
        // the battle runtime performs the roll.
        projectedPower = Math.trunc((skill.minimumPower + skill.maximumPower) / 2);
      }
      score.immediate += projectedPower;
      score.add("DAMAGE_PRESSURE");
      const relation = elementRelation(skill.combatElementId, target.combatElementId);
      if (relation > 0) {
        score.immediate += 42;
        score.tempo += 18;
        score.add("FAVORABLE_ELEMENT");
      } else if (relation < 0) {
        score.immediate -= 28;
        score.risk += 18;
        score.add("RESISTED_ELEMENT");
      }
      const pressure = Math.max(8, Math.trunc(projectedPower / 3) + (relation > 0 ? 18 : 0));
      if (target.hpPercent <= pressure) {
        score.survival += 105;
        score.tempo += 28;
        score.add("KO_WINDOW");
      }
    }

    if (isDirectHeal(type) || isRegeneration(type)) {
      const missing = 100 - target.hpPercent;
      if (missing <= 0) {
        score.risk += 140;
        score.repetition += 80;
        score.add("OVERHEAL");
      } else {
        score.immediate += Math.min(150, missing * 2);
        score.survival += target.hpPercent <= 35 ? 90 : missing;
        newValue = missing >= 12;
        score.add("USEFUL_HEAL");
      }
    }

    if (isCleanse(type)) {
      const recipient = type === "cleanse_on_hit" ? actor : target;
      const debuffs = debuffCount(recipient);
      if (debuffs === 0) {
        score.risk += 120;
        score.repetition += 90;
        score.add("EMPTY_CLEANSE");
      } else {
        score.setup += 65 + debuffs * 25;
        score.survival += dangerousControlCount(recipient) * 45;
        newValue = true;
        score.add("USEFUL_CLEANSE");
      }
    }

    const statusActive = skill.status !== "" && hasSemanticStatus(target, skill.status);
    if (skill.status !== "" && producesStatus(type)) {
      if (statusActive) {
        score.repetition += 10000;
        score.add("STATUS_ALREADY_ACTIVE");
        score.add("REDUNDANT_STATUS_REFRESH");
      } else {
        const chance = Math.max(skill.statusChance, skill.chance);
        score.setup += 35 + Math.max(0, chance) + Math.max(0, skill.duration) * 7;
        newValue = true;
        score.add("NEW_STATUS_SETUP");
      }
    }

    if (isExploit(type) && statusActive) {
      score.setup += 95;
      score.tempo += 35;
      newValue = true;
      score.add("SETUP_EXPLOIT");
    }
    if (type === "corrosion_detonate" && !statusActive) {
      score.risk += 110;
      score.repetition += 35;
      score.add("MISSING_SETUP");
    }
    if (isBuff(type)) {
      const hasBuff = buffCount(target) > 0;
      if (hasBuff && !damaging) {
        score.repetition += 45;
      } else {
        score.setup += 60;
        score.future += 25;
        newValue = true;
        score.add("NEW_STATUS_SETUP");
      }
    }
    if (isLifeSteal(type) && actor.hpPercent < 100) {
      score.survival += Math.min(75, 100 - actor.hpPercent);
      newValue = true;
    }
    if (type === "chance_heal" && actor.hpPercent < 100) {
      const healChance = Math.max(0, skill.chance);
      score.survival += Math.min(65, 100 - actor.hpPercent + Math.trunc(healChance / 2));
      newValue = true;
      score.add("USEFUL_HEAL");
    }
    if (type === "remove_buff" || type === "remove_buff_power" || type === "steal_buffs") {
      const removable = buffCount(target);
      if (removable > 0) {
        score.setup += 45 + removable * 25;
        score.tempo += 22;
        newValue = true;
        score.add("SETUP_EXPLOIT");
      } else if (!damaging) {
        score.repetition += 75;
      }
    }
    if (type === "defense_stack") {
      const stacks = unifiedDefenseStacks(actor);
      if (stacks >= Math.max(1, skill.cap)) {
        score.risk += 150;
        score.repetition += 10000;
        score.add("REDUNDANT_STATUS_REFRESH");
      } else {
        score.setup += 30 + (Math.max(1, skill.cap) - stacks) * 12;
        newValue = true;
      }
    }
    if (type === "consume_defense_power") {
      const stacks = unifiedDefenseStacks(actor);
      if (stacks > 0) {
        score.setup += 65 + stacks * 20;
        score.tempo += 25;
        newValue = true;
        score.add("SETUP_EXPLOIT");
      } else {
        score.risk += 170;
        score.repetition += 70;
        score.add("MISSING_SETUP");
      }
    }
    if (type === "delayed_damage") {
      score.future += 35;
    }
    if (type === "self_hp_damage") {
      const cost = Math.max(10, skill.value > 0 ? skill.value : 20);
      score.risk += actor.hpPercent <= cost + 20 ? 130 : cost;
      score.add("SELF_DAMAGE_RISK");
    }
    if (type === "exhaust_pp") {
      score.resource += target.skills.length === 0 ? 5 : 38;
    }
    if (type === "pp_refund" || type === "pp_overdrive") {
      score.resource += 45;
      newValue = true;
    }

    const skillView = ownSkill(actor, skill.stableKey);
    if (skillView !== null && skillView.exactPpKnown && skillView.maxPp > 0) {
      if (skillView.currentPp <= 1) {
        score.risk += 38 + skill.tier * 10;
        score.add("LAST_PP_RESERVED");
      } else if (skillView.currentPp * 4 <= skillView.maxPp) {
        score.risk += 16 + skill.tier * 6;
        score.add("LOW_PP_CONSERVATION");
      } else if (skill.tier <= 1) {
        score.resource += 12;
      }
    }
    return damaging || newValue;
  }

  private evaluateItem(
    observation: BattleAiObservation,
    candidate: BattleAiActionCandidate,
    score: MutableScore,
  ): boolean {
    const item = this.rulebook.itemRecord(candidate.itemKey);
    if (item.runtimeId !== candidate.itemRuntimeId) {
      throw new Error(`AI candidate references mismatched Item ${candidate.itemKey}`);
    }
    const target = this.requireUnit(observation, candidate.target);
    const mechanic = item.mechanicKey;
    let newValue = false;
    score.risk += 18;

    if (restoresHp(mechanic)) {
      const missing = 100 - target.hpPercent;
      if (missing === 0) {
        score.risk += 180;
        score.repetition += 90;
        score.add("OVERHEAL");
      } else {
        const percent = namedInteger(item.effectParametersJson, "hp_percent", 50);
        score.immediate += Math.min(missing, percent) * 2;
        score.survival += target.hpPercent <= 35 ? 115 : missing;
        newValue = missing >= 15;
        score.add("USEFUL_HEAL");
      }
    }
    if (restoresPp(mechanic)) {
      const missingPpValue = missingPp(target);
      if (missingPpValue === 0) {
        score.risk += 130;
        score.add("EMPTY_PP_RECOVERY");
      } else {
        score.resource += 55 + Math.min(80, missingPpValue * 5);
        newValue = true;
        score.add("USEFUL_PP_RECOVERY");
      }
    }
    if (mechanic === "cleanse_status") {
      const debuffs = debuffCount(target);
      if (debuffs === 0) {
        score.risk += 170;
        score.repetition += 80;
        score.add("EMPTY_CLEANSE");
      } else {
        score.survival += 70 + dangerousControlCount(target) * 55;
        score.setup += debuffs * 25;
        newValue = true;
        score.add("USEFUL_CLEANSE");
      }
    }
    if (!mechanic.includes("restore") && mechanic !== "cleanse_status") {
      score.risk += 90;
    }
    score.resource -= 12;
    return newValue;
  }

  private evaluateSwitch(
    encounter: BattleAiEncounterSpec,
    observation: BattleAiObservation,
    candidate: BattleAiActionCandidate,
    score: MutableScore,
  ): boolean {
    const actor = this.requireUnit(observation, candidate.actor);
    const reserve = this.requireUnit(observation, candidate.target);
    const opponent = firstAlive(observation.visibleOpponents);
    if (opponent === null) {
      score.risk += 200;
      return false;
    }
    const currentMatchup = this.matchupValue(actor, opponent);
    const reserveMatchup = this.matchupValue(reserve, opponent);
    const improvement = reserveMatchup - currentMatchup;
    const emergency = actor.hpPercent <= 28 || currentMatchup <= -45;

    if (currentMatchup < 0 || actor.hpPercent <= 35) {
      score.survival += 75 + Math.max(0, 35 - actor.hpPercent) * 2;
      score.add("BAD_MATCHUP_ESCAPE");
    }
    if (improvement > 0) {
      score.tempo += improvement;
      score.survival += Math.min(60, Math.trunc(improvement / 2));
      score.add("RESERVE_MATCHUP_GAIN");
    } else {
      score.risk += 55 + Math.abs(improvement);
    }
    score.future += Math.trunc(Math.max(0, reserve.hpPercent - 25) / 3);
    const member = this.catalog
      .members(encounter.encounterKey)
      .find((row) => row.memberSlot === reserve.memberSlot);
    if (member !== undefined) {
      score.future += Math.trunc(member.switchValue / 2);
      score.add("TEAM_FUTURE_VALUE");
      if (encounter.mayPreserveAce && member.acePriority > 0) {
        if (emergency || improvement >= 75 || actor.hpPercent <= 20) {
          score.tempo += Math.trunc(member.acePriority / 4);
          score.add("ACE_EMERGENCY_OVERRIDE");
        } else {
          score.risk += Math.trunc(member.acePriority / 2);
          score.future += Math.trunc(member.acePriority / 5);
          score.add("ACE_PRESERVED");
        }
      }
    }
    if (reserve.hpPercent <= 25) {
      score.risk += 75;
    }
    if (recentSwitchTo(observation, reserve.actorKey)) {
      score.repetition += 150;
      score.add("SWITCH_LOOP");
    }
    return improvement >= 35 || emergency;
  }

  private applyRepetition(
    observation: BattleAiObservation,
    candidate: BattleAiActionCandidate,
    score: MutableScore,
  ): void {
    const repeats = recentActionCount(observation, candidate);
    if (repeats > 0) {
      score.repetition += 28 * repeats * repeats;
      score.add("REPEATED_ACTION");
    }
  }

  private applyNonDamageLimit(
    encounter: BattleAiEncounterSpec,
    observation: BattleAiObservation,
    candidate: BattleAiActionCandidate,
    createsNewValue: boolean,
    score: MutableScore,
  ): void {
    if (
      this.isDamaging(candidate) ||
      observation.consecutiveNonDamageActions < encounter.maxConsecutiveNonDamageActions
    ) {
      return;
    }
    if (createsNewValue) {
      score.add("GENUINE_NEW_VALUE");
      return;
    }
    score.repetition += 280;
    score.add("STALE_NON_DAMAGE_ACTION");
  }

  private applyPersona(
    encounter: BattleAiEncounterSpec,
    observation: BattleAiObservation,
    candidate: BattleAiActionCandidate,
    policy: BattleAiPolicyProjection,
    score: MutableScore,
  ): void {
    if (!policy.commissioned) return;
    const skill =
      candidate.type === "SKILL" ? this.rulebook.unifiedSkill(candidate.skillRuntimeId) : undefined;
    const damaging = skill !== undefined && skill.power > 0;
    const setup =
      skill !== undefined && (producesStatus(skill.mechanicsType) || isBuff(skill.mechanicsType));
    let matched = false;
    const bonus = policy.personaPreferenceBonus + policy.phasePreferenceBonus;
    const prefers = (bias: BattleAiPolicyBias) => policy.prefers(bias);

    if (prefers("DAMAGE") && damaging) {
      score.persona += bonus;
      score.add("PERSONA_DAMAGE");
      matched = true;
    }
    if (prefers("SETUP") && setup) {
      score.persona += bonus;
      score.add("PERSONA_SETUP");
      matched = true;
    }
    if (prefers("CONTROL") && skill !== undefined && producesStatus(skill.mechanicsType)) {
      score.persona += bonus;
      score.add("PERSONA_CONTROL");
      matched = true;
    }
    if (prefers("TEMPO") && isTempo(candidate, skill)) {
      score.persona += bonus;
      score.add("PERSONA_TEMPO");
      matched = true;
    }
    if (
      prefers("ATTRITION") &&
      skill !== undefined &&
      (isLifeSteal(skill.mechanicsType) ||
        isRegeneration(skill.mechanicsType) ||
        isDirectHeal(skill.mechanicsType))
    ) {
      score.persona += bonus;
      score.add("PERSONA_ATTRITION");
      matched = true;
    }
    if (prefers("EXPLOIT") && skill !== undefined && isExploit(skill.mechanicsType)) {
      score.persona += bonus;
      score.add("PERSONA_EXPLOIT");
      matched = true;
    }
    if (prefers("SWITCH") && candidate.type === "SWITCH") {
      score.persona += bonus;
      score.add("PERSONA_TEMPO");
      matched = true;
    }
    if (prefers("FINISHER") && damaging && this.finisherWindow(observation, candidate, skill)) {
      score.persona += bonus;
      score.add("PERSONA_FINISHER");
      matched = true;
    }
    if (prefers("OFF_ELEMENT") && damaging && this.offElement(observation, candidate, skill)) {
      score.persona += bonus;
      score.add("PERSONA_OFF_ELEMENT");
      matched = true;
    }
    if (prefers("FORTIFY") && skill !== undefined && isFortify(skill.mechanicsType)) {
      score.persona += bonus * 2;
      score.add("PERSONA_DEFENSE");
      matched = true;
    }
    if (
      prefers("DEFENSE_CONVERSION") &&
      skill !== undefined &&
      skill.mechanicsType === "consume_defense_power"
    ) {
      score.persona += bonus * 2;
      score.add("PERSONA_DEFENSE");
      matched = true;
    }
    if (prefers("CLEANSE") && this.isCleanseCandidate(candidate, skill)) {
      score.persona += bonus;
      score.add("PERSONA_CLEANSE");
      matched = true;
    }
    if (prefers("PUNISH_PASSIVE") && damaging) {
      score.persona += bonus;
      score.add("PERSONA_PUNISH");
      matched = true;
    }
    if (prefers("ACE_RELEASE") && this.aceCandidate(encounter, observation, candidate)) {
      score.persona += bonus;
      score.add("PERSONA_ACE");
      matched = true;
    } else if (prefers("ACE_PRESERVE") && this.aceCandidate(encounter, observation, candidate)) {
      score.persona +=
        candidate.type === "SWITCH"
          ? -Math.max(1, Math.trunc(bonus / 2))
          : Math.max(1, Math.trunc(bonus / 3));
      score.add("PERSONA_ACE");
      matched = true;
    }
    if (matched && policy.phaseKey !== "NONE") {
      score.add("PHASE_POLICY");
    }
  }

  private finisherWindow(
    observation: BattleAiObservation,
    candidate: BattleAiActionCandidate,
    skill: BattleAiSkillRecord | undefined,
  ): boolean {
    const target = this.requireUnit(observation, candidate.target);
    const record = requireSkill(skill);
    return target.hpPercent <= 40 || record.power >= 130 || record.tier >= 2;
  }

  private offElement(
    observation: BattleAiObservation,
    candidate: BattleAiActionCandidate,
    skill: BattleAiSkillRecord | undefined,
  ): boolean {
    const actor = this.requireUnit(observation, candidate.actor);
    const record = requireSkill(skill);
    return (
      record.combatElementId >= 0 &&
      actor.combatElementId >= 0 &&
      record.combatElementId !== actor.combatElementId
    );
  }

  private isCleanseCandidate(
    candidate: BattleAiActionCandidate,
    skill: BattleAiSkillRecord | undefined,
  ): boolean {
    if (skill !== undefined && isCleanse(skill.mechanicsType)) return true;
    if (candidate.type !== "ITEM") return false;
    return this.rulebook.itemRecord(candidate.itemKey).mechanicKey === "cleanse_status";
  }

  private aceCandidate(
    encounter: BattleAiEncounterSpec,
    observation: BattleAiObservation,
    candidate: BattleAiActionCandidate,
  ): boolean {
    const slot =
      candidate.type === "SWITCH"
        ? candidate.switchMemberSlot
        : this.requireUnit(observation, candidate.actor).memberSlot;
    const member = this.catalog
      .members(encounter.encounterKey)
      .find((row) => row.memberSlot === slot);
    return member !== undefined && member.acePriority > 0;
  }

  private controlledJitter(
    encounter: BattleAiEncounterSpec,
    observation: BattleAiObservation,
    candidate: BattleAiActionCandidate,
    decisionSeed: number,
  ): number {
    const band = Math.max(0, encounter.controlledRandomnessBand);
    if (band === 0) return 0;
    const material = `${decisionSeed}|${observation.encounterKey}|${observation.turn}|${observation.activeActor.toString()}|${observation.phaseKey}|${candidate.actionKey}`;
    const spread = band * 2 + 1;
    return floorMod(javaStringHashCode(material), spread) - band;
  }

  private matchupValue(unit: UnitView, opponent: UnitView): number {
    let best = relationScore(elementRelation(unit.combatElementId, opponent.combatElementId));
    for (const view of unit.skills) {
      const record = this.rulebook.unifiedSkill(view.runtimeId);
      if (record === undefined || record.power <= 0 || !view.usable) continue;
      best = Math.max(
        best,
        relationScore(elementRelation(record.combatElementId, opponent.combatElementId)),
      );
    }
    return best;
  }

  private isDamaging(candidate: BattleAiActionCandidate): boolean {
    if (candidate.type !== "SKILL") return false;
    const skill = this.rulebook.unifiedSkill(candidate.skillRuntimeId);
    return skill !== undefined && skill.power > 0;
  }

  /**
   * Java takes the key as given: a candidate with no target simply matches no unit and fails with the
   * hidden-unit error, so the nullable key is part of the contract rather than a caller-side guard.
   */
  private requireUnit(observation: BattleAiObservation, key: BattleAiActorKey | null): UnitView {
    for (const unit of observation.ownRoster) {
      if (unit.actorKey.equals(key)) return unit;
    }
    for (const unit of observation.visibleOpponents) {
      if (unit.actorKey.equals(key)) return unit;
    }
    throw new Error(`AI candidate references hidden unit ${String(key)}`);
  }
}

function requireSkill(skill: BattleAiSkillRecord | undefined): BattleAiSkillRecord {
  if (skill === undefined) throw new Error("AI persona branch has no Skill record");
  return skill;
}

/** `BattleAiObservation.SkillView` lookup by stable key. */
function ownSkill(actor: UnitView, skillKey: string): SkillView | null {
  return actor.skills.find((skill) => skill.skillKey === skillKey) ?? null;
}

function firstAlive(units: readonly UnitView[]): UnitView | null {
  return units.find((unit) => unit.alive) ?? null;
}

function buffCount(unit: UnitView): number {
  return unit.statuses.filter((status) => status.bank === BUFF_BANK).length;
}

/** Java's `status.bank == 0 && status.effectId == 4`, the unified defense-stack buff. */
function unifiedDefenseStacks(unit: UnitView): number {
  for (const status of unit.statuses) {
    if (status.bank === BUFF_BANK && status.effectId === 4) return Math.max(1, status.stacks);
  }
  return 0;
}

function debuffCount(unit: UnitView): number {
  return unit.statuses.filter((status: StatusView) => status.bank !== BUFF_BANK).length;
}

/** The eight control identities `BattleUnit.hasDangerousControlStatus` counts. */
function dangerousControlCount(unit: UnitView): number {
  let count = 0;
  for (const status of unit.statuses) {
    const dangerous =
      (status.bank === DEBUFF_BANK &&
        (status.effectId === 2 ||
          status.effectId === 8 ||
          status.effectId === 9 ||
          status.effectId === 10)) ||
      (status.bank === RAINBOW_STATUS_BANK &&
        (status.effectId === 0 ||
          status.effectId === 3 ||
          status.effectId === 4 ||
          status.effectId === 6));
    if (dangerous) count++;
  }
  return count;
}

/** Java's `hasSemanticStatus` switch: the semantic key is a bank/id pair, anything else is false. */
const SEMANTIC_STATUSES: Readonly<Record<string, [number, number]>> = {
  seeded_damage: [DEBUFF_BANK, 0],
  dazed: [DEBUFF_BANK, 1],
  entangled: [DEBUFF_BANK, 2],
  accuracy_down: [DEBUFF_BANK, 4],
  agility_down: [DEBUFF_BANK, 5],
  damage_down: [DEBUFF_BANK, 6],
  defense_down: [DEBUFF_BANK, 7],
  ghost_mirror: [DEBUFF_BANK, 8],
  confusion: [DEBUFF_BANK, 9],
  paralysis: [DEBUFF_BANK, 10],
  petrified: [RAINBOW_STATUS_BANK, 0],
  charmed: [RAINBOW_STATUS_BANK, 3],
  bound: [RAINBOW_STATUS_BANK, 4],
  corrosion: [RAINBOW_STATUS_BANK, 5],
  tier_lock: [RAINBOW_STATUS_BANK, 6],
  agility_up: [BUFF_BANK, 7],
  strength_up: [BUFF_BANK, 10],
};

function hasSemanticStatus(unit: UnitView, semanticKey: string): boolean {
  const pair = SEMANTIC_STATUSES[semanticKey];
  if (pair === undefined) return false;
  return unit.statuses.some((status) => status.bank === pair[0] && status.effectId === pair[1]);
}

function missingPp(target: UnitView): number {
  let missing = 0;
  for (const skill of target.skills) {
    if (skill.exactPpKnown && skill.maxPp > 0)
      missing += Math.max(0, skill.maxPp - skill.currentPp);
  }
  return missing;
}

/** `JSON_INTEGER`: the first `"key": <integer>` scan, in the order the JSON text lists them. */
function namedInteger(json: string | undefined, key: string, fallback: number): number {
  const pattern = /"([a-z_]+)"\s*:\s*(-?\d+)/g;
  const text = json ?? "";
  let match = pattern.exec(text);
  while (match !== null) {
    if (match[1] === key) return Number.parseInt(match[2], 10);
    match = pattern.exec(text);
  }
  return fallback;
}

/** `recentActionCount`: the last six memory events, matched on actor and the action's own key. */
function recentActionCount(
  observation: BattleAiObservation,
  candidate: BattleAiActionCandidate,
): number {
  const events = observation.memoryEvents;
  let count = 0;
  for (let index = events.length - 1; index >= 0 && index >= events.length - 6; index--) {
    const parts = events[index].split("|");
    if (parts.length < 6 || parts[2] !== candidate.actor.toString()) continue;
    if (
      candidate.type === "SKILL" &&
      parts[1] === "SKILL_REVEALED" &&
      candidate.skillKey === parts[4]
    ) {
      count++;
    } else if (
      candidate.type === "ITEM" &&
      parts[1] === "ITEM_USED" &&
      candidate.itemKey === parts[4]
    ) {
      count++;
    }
  }
  return count;
}

function recentSwitchTo(observation: BattleAiObservation, incoming: BattleAiActorKey): boolean {
  const events = observation.memoryEvents;
  for (let index = events.length - 1; index >= 0 && index >= events.length - 4; index--) {
    const parts = events[index].split("|");
    if (parts.length >= 4 && parts[1] === "SWITCH_OBSERVED" && incoming.toString() === parts[3]) {
      return true;
    }
  }
  return false;
}

function relationScore(relation: number): number {
  return relation > 0 ? 55 : relation < 0 ? -50 : 0;
}

function elementRelation(attacker: number, defender: number): number {
  if (attacker < 0 || defender < 0) return 0;
  if (beats(attacker, defender)) return 1;
  return beats(defender, attacker) ? -1 : 0;
}

/** The scorer's own copy of the element cycle, asserted against the pack chart by the port test. */
function beats(attacker: number, defender: number): boolean {
  return (
    (attacker === 0 && defender === 1) ||
    (attacker === 1 && defender === 2) ||
    (attacker === 2 && defender === 3) ||
    (attacker === 3 && defender === 0) ||
    (attacker === 5 && defender === 6) ||
    (attacker === 6 && defender === 4) ||
    (attacker === 4 && defender === 5)
  );
}

function isDirectHeal(type: string): boolean {
  return type === "direct_heal";
}

function restoresHp(mechanic: string): boolean {
  return mechanic === "restore_hp" || mechanic === "restore_hp_pp";
}

function restoresPp(mechanic: string): boolean {
  return mechanic === "restore_pp" || mechanic === "restore_hp_pp";
}

function isRegeneration(type: string): boolean {
  return (
    type === "heal_regeneration" ||
    type === "cleanse_regeneration" ||
    type === "heal_reflect_chance"
  );
}

function isCleanse(type: string): boolean {
  return (
    type === "cleanse_immunity" || type === "cleanse_regeneration" || type === "cleanse_on_hit"
  );
}

function isLifeSteal(type: string): boolean {
  return (
    type === "life_steal" ||
    type === "corrosion_life_steal" ||
    type === "corrosion_detonate" ||
    type === "corrosion_storm"
  );
}

function producesStatus(type: string): boolean {
  return (
    type === "apply_status" ||
    type === "first_action_status" ||
    type === "low_hp_power_status" ||
    type === "detonate_or_apply" ||
    type === "status_or_power" ||
    type === "corrosion_life_steal"
  );
}

function isExploit(type: string): boolean {
  return (
    type === "consume_for_power" ||
    type === "conditional_power" ||
    type === "conditional_pierce" ||
    type === "status_or_power" ||
    type === "corrosion_life_steal" ||
    type === "corrosion_detonate" ||
    type === "corrosion_storm" ||
    type === "detonate_or_apply"
  );
}

function isBuff(type: string): boolean {
  return (
    type === "next_attack" ||
    type === "tradeoff_buff" ||
    type === "defense_reflect" ||
    type === "defense_stack" ||
    type === "damage_reduction_chance" ||
    type === "pp_overdrive" ||
    type === "tradeoff_speed" ||
    type === "self_buff_on_hit" ||
    type === "repeat_buff"
  );
}

function isFortify(type: string): boolean {
  return (
    type === "defense_stack" || type === "defense_reflect" || type === "damage_reduction_chance"
  );
}

function isTempo(
  candidate: BattleAiActionCandidate,
  skill: BattleAiSkillRecord | undefined,
): boolean {
  return (
    candidate.type === "SWITCH" ||
    (skill !== undefined &&
      (skill.mechanicsType === "exhaust_pp" ||
        skill.mechanicsType === "pp_refund" ||
        (skill.mechanicsType === "apply_status" &&
          (skill.status === "bound" ||
            skill.status === "agility_down" ||
            skill.status === "tier_lock"))))
  );
}
