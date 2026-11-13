import type { PostSkillBuffOwner, PostSkillMode } from "./BattleActionEngine";
import { planPostSkillResolution } from "./BattleActionEngine";
import type { BattleRandom } from "./BattleRandom";
import type { BattleRules } from "./BattleRules";
import type { DamageCombatant } from "./DamageCalculator";
import { BUFF_BANK, DEBUFF_BANK, inclusiveRollPasses, type StatusUnit } from "./StatusState";

/**
 * The two heal steps the runtime owns, handed to the steps that spend one.
 *
 * `VqsvBattleRuntime` never calls `heal` with a number it has not projected: `projectBattleHealing` runs
 * first and `traitProjection.afterHealing` follows the commit, because a heal can lift a unit back over a
 * characteristic's HP band or into a talent's window. A route that installs a buff carries only the
 * projection, because the engine's own `applySourceBuff` is what spends that heal and the runtime closes
 * it afterwards.
 */
export type P7HealSeams = {
  /** `projectBattleHealing`: what the heal is worth before it lands. */
  project(source: StatusUnit, receiver: StatusUnit, amount: number): number;
  /** `projectBattleHealing`, the commit and `afterHealing`, returning the projected number. */
  commit(source: StatusUnit, receiver: StatusUnit, amount: number): number;
  /** `afterHealing` on its own, for a heal the buff's own install already spent. */
  afterHealing(receiver: StatusUnit): void;
};

/** The identity the `postSkillResolution` rows were measured on: no projection, no reproject. */
export const HEAL_WITHOUT_PROJECTION: P7HealSeams = {
  project: (_source, _receiver, amount) => amount,
  commit: (_source, receiver, amount) => {
    receiver.heal(amount);
    return amount;
  },
  afterHealing: () => {},
};

/**
 * `VqsvBattleRuntime.applyP7PostSkillEffects` for the arms this port owns.
 *
 * The runtime calls this between the hit and the post-damage modifiers, which is where Java puts it:
 * `applyP7Damage` ends at the HP floor, `applyP7PostSkillEffects` then spends the skill's own route and
 * only reaches `applyP7SourcePostDamageModifiersFromPlan` on its last line. The order is not cosmetic.
 * A heal that runs before a reflect can be clipped by max HP it would otherwise have lost to it, and
 * the leech gate's roll is drawn before the item-8 and buff-5 rolls, so a step moved one place late
 * changes both the stream and the HP the two bars end on.
 *
 * What is left out is what the source method hands to owners this port does not carry: the signature
 * gate, the Cầu Vồng and Liệt Hỏa no-damage mechanics (a zero-power skill whose own mechanics table
 * owns its heal or cleanse resolves there and never reaches this route), the characteristic heal
 * callback and the charm healing projection, which is the identity for a unit with no charm.
 * `battle/golden-status-presentation.json`'s `postSkillResolution` section is the Java engine walking
 * the route and the resolution for every skill that has one, and it is the section graded here.
 */
export type P7PostSkillRequest = {
  attacker: StatusUnit;
  /**
   * `p7Target`: the unit the skill was aimed at, which for a self-aimed skill is the attacker itself.
   * It is not necessarily the unit that took the damage.
   */
  target: StatusUnit;
  skillId: number;
  rules: Pick<BattleRules, "damage" | "status" | "web">;
  random: BattleRandom;
  /** The strike's own draw label, `battle.P7.skill<id>`: the producer roll is asked under it. */
  context: string;
  attackerSpriteId: number;
  receiverSpriteId: number;
  /** `p7AttackHit`, as the damage step left it. */
  attackHit: boolean;
  /** `p7Damage`: the hit the damage step committed, which is what a leech is a percent of. */
  damage: number;
  /** Web rules: the HP the hit actually took off the target, which a "damage thực gây ra" heal reads. */
  dealtDamage?: number;
  /** The fight's heal funnel; absent, the step heals directly, as the identity rows measured it. */
  heal?: P7HealSeams;
};

/**
 * What the step decided and spent, so the caller can finish the presentation the way the runtime does.
 *
 * `attackerHpBefore` is `p7Attacker.hp()` read before the route ran, and the runtime compares it against
 * the attacker's HP *after the modifiers*: a route that costs the attacker HP, or a reflect that lands
 * afterwards, both print as a negative number over the same widget. It is returned rather than resolved
 * here because the walk owns the modifiers.
 */
export type P7PostSkillOutcome = {
  mode: PostSkillMode;
  attackerHpBefore: number;
  /** The heal the route spent, which is the number `+N` prints when nothing else claimed the text. */
  heal: number;
  buffId: number;
  buffOwner: PostSkillBuffOwner;
  /** The debuff the no-damage producer planted, or -1 for a route that plants nothing. */
  debuffId: number;
  /** `p7PostEffectText` as the two arms left it, before the HP rules are applied. */
  text: string;
  /** `p7PostEffectPlayerSide`: the side of the screen the text belongs over. */
  textOnPlayerSide: boolean;
  attackerOnPlayerSide: boolean;
  /** The leech gate's roll, or -1 for a route that never asks for one. */
  leechGateRoll: number;
};

/** `p7Attacker == player`: the player's side is the one the runtime calls side 0. */
const PLAYER_SIDE = 0;

function combatant(unit: StatusUnit, visualSpriteId: number): DamageCombatant {
  return {
    speciesId: unit.speciesId,
    attack: unit.currentStats.attack,
    defense: unit.currentStats.defense,
    visualSpriteId,
    unit,
  };
}

export function resolveP7PostSkill(request: P7PostSkillRequest): P7PostSkillOutcome {
  const { attacker, target, skillId, rules, random, context } = request,
    seams = request.heal ?? HEAL_WITHOUT_PROJECTION,
    row = rules.damage.skillRow(skillId),
    route = rules.status.postSkillRoute(skillId);
  if (!row || !route)
    return {
      mode: "NONE",
      attackerHpBefore: attacker.hp(),
      heal: 0,
      buffId: -1,
      buffOwner: "NONE",
      debuffId: -1,
      text: "",
      textOnPlayerSide: attacker.ownerSide === PLAYER_SIDE,
      attackerOnPlayerSide: attacker.ownerSide === PLAYER_SIDE,
      leechGateRoll: -1,
    };
  // `sourceP7LeechRollPassed` is the one roll the runtime draws before it asks the engine anything, and
  // the label is fixed: Java names it after the pair of skills that gate, not after the skill being cast.
  // Web rules replace the Java heal of the four Liệt Hỏa heal skills with the one their description names.
  const webHeal = rules.web ? rules.damage.webSkillHeal(skillId) : undefined,
    leechGateRoll =
      route.leechGateChance > 0 && !webHeal ? random.percent("battle.P7.skill52_58.leechGate") : -1,
    attackerHpBefore = attacker.hp(),
    plan = planPostSkillResolution({
      route,
      chanceOrParam: row.chanceOrParam,
      attackerBaseAttack: rules.damage.sourceBaseAttackForCurrentTarget(
        combatant(attacker, request.attackerSpriteId),
        combatant(target, request.receiverSpriteId),
      ),
      damage: request.damage,
      leechRollPassed:
        leechGateRoll >= 0 && inclusiveRollPasses(leechGateRoll, route.leechGateChance),
      targetAvailable: target.alive(),
      attackHit: request.attackHit,
    }),
    outcome: P7PostSkillOutcome = {
      mode: plan.mode,
      attackerHpBefore,
      heal: 0,
      buffId: plan.buffId,
      buffOwner: plan.buffOwner,
      debuffId: -1,
      text: "",
      textOnPlayerSide: attacker.ownerSide === PLAYER_SIDE,
      attackerOnPlayerSide: attacker.ownerSide === PLAYER_SIDE,
      leechGateRoll,
    };
  if (plan.noDamageDebuff) {
    // `applyP7NoDamageDebuffProducer`: the zero-power producer rolls under the strike's own label and
    // commits straight away, because there is no damage step left to hold it for it.
    const pending = rules.status.planTargetDebuff(
      attacker,
      target,
      skillId,
      row.effectId,
      (label) => random.percent(`${context}.${label}`),
    );
    if (pending) {
      pending.commit();
      outcome.debuffId = row.effectId;
      outcome.text = rules.status.effectRowName(DEBUFF_BANK, row.effectId);
      outcome.textOnPlayerSide = target.ownerSide === PLAYER_SIDE;
    }
  }
  if (webHeal) {
    plan.heal = 0;
    const maxHp = attacker.maxHp(),
      percentOf = (value: number, percent: number) =>
        Math.trunc((Math.max(0, value) * percent) / 100);
    if (webHeal.kind === "life_steal" && request.attackHit) {
      // "Hồi X% damage thực gây ra, tối đa Y% HP tối đa".
      const healed = percentOf(request.dealtDamage ?? request.damage, webHeal.percent);
      plan.heal =
        webHeal.capPercent > 0 ? Math.min(healed, percentOf(maxHp, webHeal.capPercent)) : healed;
    } else if (
      webHeal.kind === "chance_heal" &&
      request.attackHit &&
      random.percent(`${context}.chanceHeal`) < webHeal.chance
    )
      // "Sau khi gây damage, có X% hồi Y% HP tối đa".
      plan.heal = percentOf(maxHp, webHeal.percent);
  }
  if (plan.heal > 0) {
    // The `+N` the widget prints is the projected number, not the one the route asked for, so the seam's
    // answer is what the outcome carries.
    outcome.heal = seams.commit(attacker, attacker, plan.heal);
  }
  const buffOwner =
    plan.buffOwner === "ATTACKER" ? attacker : plan.buffOwner === "TARGET" ? target : undefined;
  if (plan.buffId >= 0 && buffOwner) {
    let buffHeal = 0;
    if (plan.copyTargetBuffs) rules.status.copySourceBuffsFrom(attacker, target, skillId);
    else
      // `applySourceBuff` spends the heal itself, so the step hands it the projection only and closes
      // the commit with `afterHealing` afterwards — but only when the buff actually healed something.
      buffHeal = rules.status.applySourceBuff(buffOwner, plan.buffId, skillId, (amount) =>
        seams.project(buffOwner, buffOwner, amount),
      );
    if (buffHeal > 0) seams.afterHealing(buffOwner);
    outcome.text =
      buffHeal > 0 ? `+${buffHeal}` : rules.status.effectRowName(BUFF_BANK, plan.buffId);
    outcome.textOnPlayerSide = buffOwner.ownerSide === PLAYER_SIDE;
  }
  return outcome;
}

/**
 * The runtime's last two branches for `p7PostEffectText`, which it takes after the reflects have landed.
 *
 * HP the attacker lost during the whole step wins over everything, then the buff or debuff name the
 * arms left behind, and a heal only claims the widget when nothing else said anything — the same
 * precedence that makes a self-damaging buff print its cost instead of its name.
 */
export function p7PostEffectText(
  outcome: P7PostSkillOutcome,
  attackerHpEnd: number,
): { text: string; playerSide: boolean } {
  if (attackerHpEnd < outcome.attackerHpBefore)
    return {
      text: `-${outcome.attackerHpBefore - attackerHpEnd}`,
      playerSide: outcome.attackerOnPlayerSide,
    };
  if (outcome.text === "" && outcome.heal > 0)
    return { text: `+${outcome.heal}`, playerSide: outcome.attackerOnPlayerSide };
  return { text: outcome.text, playerSide: outcome.textOnPlayerSide };
}
