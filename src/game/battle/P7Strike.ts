import {
  calculateMissChance,
  planActionResolution,
  planHeldItemHpFloor,
} from "./BattleActionEngine";
import type { BattleRandom } from "./BattleRandom";
import type { BattleRules } from "./BattleRules";
import type { DesignTraitProjection } from "./DesignTraitProjection";
import type { DesignTraitUnit } from "./DesignTraits";
import { SignatureSkills } from "./SignatureSkills";
import type { RainbowPpEffect } from "./RainbowSkills";
import { HEAL_WITHOUT_PROJECTION, type P7HealSeams, type P7PostSkillOutcome } from "./P7PostSkill";
import {
  BUFF_BANK,
  DEBUFF_BANK,
  exactRollPasses,
  RAINBOW_BANK,
  type StatusUnit,
  type StatusUnitBase,
} from "./StatusState";

/**
 * `VqsvBattleRuntime.applyP7Damage` and the post-damage step that follows it.
 *
 * The order here is the whole point of the module. Java runs the zero-power gate, then the damage
 * formula under the `battle.P7.skill<id>` label, then the miss chance, then the hit roll, then the
 * resolution plan, then — only on a hit — the status the formula rolled for, the damage, the item-10
 * HP floor and the committed damage measured *after* that floor, then the item-8 leech and the two
 * reflects. Every one of those steps can move a number or a draw: a roll asked one step early changes
 * every value after it, and the floor measured before the committed damage changes what reflects
 * back. `data/battle/golden-held-items.json`'s `p7Step` section is the Java engine walking this exact
 * sequence over real units, so the walk is graded as a walk and not as a set of parts.
 *
 * What is left out is what this port does not own yet, and the golden rows leave it out the same
 * way: no signature-skill gate and no healing projection (the identity for a unit with no charm);
 * the rainbow-charm evasion is the optional `charmEvasion` seam, absent from every golden walk. The
 * characteristic and talent projection is not one of them: a fight that
 * carries one hands it to the walk through `trait`, and `battle/golden-trait-battle.json` grades the
 * two projections' own order — pierce, `beginAction`, the formula, the projected miss chance, the hit
 * roll, the plan, the damage projection, the commit, `afterDirectDamage`, the HP floor, `afterDamage`
 * and `afterSkillAction` — under the two trace blocks Java sets around them.
 */
export type P7StrikeRequest = {
  attacker: StatusUnit;
  receiver: StatusUnit;
  skillId: number;
  rules: Pick<BattleRules, "damage" | "status" | "web">;
  random: BattleRandom;
  /** The sprite the formula checks for a final-form crit chance, which is the combatant's own. */
  attackerSpriteId: number;
  receiverSpriteId: number;
  /**
   * `!captureForbidden() && p7Attacker == player && p7DamageReceiver == enemy`: the context the
   * Cảm Lãm Chi Diệp floor only lifts a target in.
   */
  allowsHpFloor: boolean;
  /**
   * The fight's projection, its two seats and the round it names in every seam. Absent, the walk is
   * the identity the `p7Step` rows were recorded on; present, every number below is the projected one.
   */
  trait?: P7TraitWalk;
  /**
   * Thế thân tượng gỗ (`RainbowCharmBattleState.tryEvade`): asked once a blow would land, with whether
   * the attacker holds the sure-hit item 9. True turns the hit into a clean miss with no side effects.
   */
  charmEvasion?: (receiver: StatusUnit, sureHit: boolean) => boolean;
  /**
   * `applyP7PostSkillEffects`, run where the source runs it: after the HP floor and before the
   * post-damage modifiers.
   *
   * It is a step the caller supplies instead of one this walk owns because the two are graded apart.
   * The golden `p7Step` rows walk the strike with no route spent, so a probe replaying them installs
   * nothing, while the live fight passes the real step and ends with a status on a unit. A fight that
   * never ran it would show an empty strip no matter which skill was cast.
   */
  postSkill?: (step: P7PostSkillCall) => P7PostSkillOutcome;
  /** `computeDamage`'s Power override for a secondary hit (2v2 group target); omitted is none. */
  powerOverridePercent?: number;
  /** `computeDamage`'s `suppressSkillEffects`: the secondary hit's skill effects are not run. */
  suppressSkillEffects?: boolean;
};

/**
 * `VqsvBattleRuntime`'s half of one strike: the projection the fight owns, the two units it is asked
 * about and the seats and round each seam names.
 *
 * The two units are repeated here rather than read off the request because the walk's arithmetic needs
 * only a `StatusUnit` while the projection refuses anything but the one unit class Java has — the
 * `DesignTraitUnit` behind a characteristic and a talent. They are the same objects.
 */
export type P7TraitWalk = {
  projection: DesignTraitProjection;
  attacker: DesignTraitUnit;
  receiver: DesignTraitUnit;
  /** `TRAIT_PLAYER_SLOT` / `TRAIT_ENEMY_SLOT` for the two units, which is their side in a 1v1. */
  attackerSlot: number;
  receiverSlot: number;
  /** `VqsvBattleRuntime.turn`, the round every seam is asked on. */
  roundIndex: number;
  /**
   * `currentActorPlayer ? !enemyActionThisRound : !playerActionThisRound`, which `beginAction` stores
   * for the families that only fire when the actor moved first.
   */
  actedFirst: boolean;
  /**
   * The fight's own last word on a hit, after the trait projection (Tàn Nguyệt Long Ma's Ma Mộc
   * reduction and Hoa Tiên Tử's fire neutrality, `projectMaMoc*`): the direct hit with its skill, a
   * reflected one with -1. Omitted is none.
   */
  incomingDamage?: (target: StatusUnit, damage: number, skillId: number) => number;
  /**
   * `commitUnifiedAfterDamage(..., damageProjection)`: the fight's projection of the supplemental
   * damage a unified skill deals once its hit landed (Hủ Thực detonation, Vạn Mộc Tận Thực's first
   * bite). Only Kim Diễm Long Vương's Long Ấn sets it; omitted is none.
   */
  secondaryDamage?: (amount: number) => number;
  /**
   * The fight's gate on a heal by its source, ahead of the projection (`projectBattleHealing`'s Hoa
   * rescue penalty). Omitted is none.
   */
  healingGate?: (source: StatusUnit, amount: number) => number;
};

/** What the projection answered, recorded only for a fight that walked through one. */
export type P7TraitTrace = {
  /** `projectTargetDefenseIgnorePercent`, the pierce the formula was handed. */
  defenseIgnorePercent: number;
  /** The engine's own answer before `projectMissChance` touched it. */
  sourceMissChance: number;
  /** `projectMissChance`'s answer, which is the number the hit roll is graded against. */
  missChance: number;
  /** `afterSkillAction`'s answer, which Java discards and the recorded row keeps. */
  skillActionHealing: number;
};

/** Everything the post-skill step needs from the walk: the two units, the strike's draws and its numbers. */
export type P7PostSkillCall = {
  attacker: StatusUnit;
  /** The unit the skill was aimed at, which the walk already resolved as its receiver. */
  target: StatusUnit;
  skillId: number;
  rules: Pick<BattleRules, "damage" | "status" | "web">;
  random: BattleRandom;
  context: string;
  attackerSpriteId: number;
  receiverSpriteId: number;
  attackHit: boolean;
  damage: number;
  /** Web rules: the HP the hit actually took off the target. */
  dealtDamage?: number;
  /** The fight's heal funnel, built from the walk's projection. */
  heal?: P7HealSeams;
};

/** The four stats Java records at the end of the walk, so a projection that moved one shows up. */
export type P7StrikeStats = StatusUnitBase;

/**
 * One status a unit is still carrying, with both counters.
 *
 * `ProbeWebBattleMath.statusStrip` walks the three banks in the order the round-start pass walks
 * them, so this is the same list the presentation projector consumes and the icons are drawn from:
 * the strip is graded because a port that plants the status after the hit, or that clears it on a
 * death it should have survived, reports a different list.
 */
export type HeldStatus = {
  bank: number;
  numericId: number;
  remainingTurns: number;
  remainingActions: number;
};

export function heldStatuses(unit: StatusUnit): HeldStatus[] {
  const held: HeldStatus[] = [];
  for (const bank of [BUFF_BANK, DEBUFF_BANK, RAINBOW_BANK])
    for (const numericId of unit.activeStatusIds(bank)) {
      const instance = unit.statuses.get(bank, numericId);
      if (instance)
        held.push({
          bank,
          numericId,
          remainingTurns: instance.remainingTurns,
          remainingActions: instance.remainingActions,
        });
    }
  return held;
}

type P7StrikeCommon = {
  /** The walk's own draws, full labels in ask order, taken from the battle's stream. */
  draws: string[];
  /** The hit the walk commits: `p7Damage`, which a fight with a projection carries as its answer. */
  damage: number;
  /** `planActionResolution`'s number, before the projection was asked to change it. */
  planDamage: number;
  hit: boolean;
  critFlag: number;
  missChance: number;
  hitRoll: number;
  committedDamage: number;
  /** `p7TargetHpBefore`: the HP the receiver stood on when the walk opened, before the floor. */
  targetHpBefore: number;
  attackerHpEnd: number;
  targetHpEnd: number;
  attackerStats: P7StrikeStats;
  targetStats: P7StrikeStats;
  /** What each unit still carries once the walk is over, in the bank order the walk presents. */
  attackerHeld: HeldStatus[];
  targetHeld: HeldStatus[];
  /** What the caller's post-skill step spent, when the fight has one. */
  postSkill?: P7PostSkillOutcome;
  /** What the fight's projection answered, when the fight has one. */
  trait?: P7TraitTrace;
};

/**
 * Either the skill never entered the damage route — which is the whole trace, because the engine
 * returned before it asked for a single roll — or it did, and every step is recorded.
 */
export type P7StrikeTrace =
  | (P7StrikeCommon & {
      zeroPower: true;
    })
  | (P7StrikeCommon & {
      zeroPower: false;
      /** Web: the PP a Cầu Vồng skill gives back or burns, which the runtime owns. */
      unifiedPp?: RainbowPpEffect;
      resultDamage: number;
      resolvedDamage: number;
      critFlag: number;
      appliedDebuffId: number;
      supplementalDamage: number;
      attackerSpeed: number;
      targetSpeed: number;
      debuff4Value: number;
      heldItem9: boolean;
      sideEffectMode: "COMMIT_PENDING" | "COMMIT_SOURCE_IMMEDIATE" | "NONE";
      hpAfterDamage: number;
      floor: number;
      floorApply: boolean;
      hpAfterFloor: number;
      postDamageRan: boolean;
      heldItem8Chance: number;
      /** The leech roll, or -1 when the runtime never asked for one. */
      heldItem8Roll: number;
      heldItem8HealPercent: number;
      leech: boolean;
      heal: number;
      buff2Present: boolean;
      buff2Percent: number;
      buff2Reflect: number;
      buff5Present: boolean;
      buff5Chance: number;
      /** The reflect roll, or -1 when the runtime never asked for one. */
      buff5Roll: number;
      buff5Stored: number;
      buff5Reflect: number;
    });

function statsOf(unit: StatusUnit): P7StrikeStats {
  return {
    hp: unit.hp(),
    attack: unit.currentStats.attack,
    defense: unit.currentStats.defense,
    speed: unit.currentStats.speed,
  };
}

/**
 * `VqsvBattleRuntime.traitSlot`, over the two units a 1v1 walk knows.
 *
 * The projection refuses anything but the unit class behind a characteristic, so the pair is looked up
 * by identity rather than cast: the walk's arithmetic units and the projection units are the same
 * objects, and a third unit in the strike is not a thing this fight can do.
 */
function projectedUnit(
  trait: P7TraitWalk,
  unit: StatusUnit,
): { unit: DesignTraitUnit; slot: number } {
  if (unit === trait.attacker) return { unit: trait.attacker, slot: trait.attackerSlot };
  if (unit === trait.receiver) return { unit: trait.receiver, slot: trait.receiverSlot };
  throw new Error(`the ${trait.roundIndex} round's strike walked a unit the fight did not enter`);
}

/**
 * `projectBattleHealing` plus the commit plus `afterHealing`: the seam every heal of the strike lands
 * through, which is what lets a heal that lifts a unit back over an HP band reproject its stats. Without
 * a projection it is the identity the `p7Step` rows were measured on.
 */
function healSeams(trait: P7TraitWalk | undefined): P7HealSeams {
  if (!trait) return HEAL_WITHOUT_PROJECTION;
  const projection = trait.projection;
  const project = (source: StatusUnit, receiver: StatusUnit, amount: number): number => {
    const from = projectedUnit(trait, source),
      to = projectedUnit(trait, receiver),
      gated = trait.healingGate ? trait.healingGate(source, amount) : amount;
    return projection.projectReceivedHealing(
      from.unit,
      from.slot,
      to.unit,
      to.slot,
      trait.roundIndex,
      0,
      gated,
    );
  };
  return {
    project,
    commit(source, receiver, amount) {
      const projected = project(source, receiver, amount);
      receiver.heal(projected);
      const to = projectedUnit(trait, receiver);
      projection.afterHealing(to.unit, to.slot, trait.roundIndex);
      return projected;
    },
    afterHealing(receiver) {
      const to = projectedUnit(trait, receiver);
      projection.afterHealing(to.unit, to.slot, trait.roundIndex);
    },
  };
}

/**
 * `commitTraitProjectedDamage` with kind `REFLECT`: what the source runs a buff-2 or buff-5 reflect
 * through, which is a damage step of its own — the projection is asked what the blow is worth, the
 * receiver pays, and the close tells the talents the hit came from the other side.
 *
 * The projection is handed skill id -1, the runtime's own sentinel for a damage step that belongs to no
 * skill, and the action index is 0 because the reflect is not an action.
 */
function commitReflectedDamage(
  trait: P7TraitWalk | undefined,
  source: StatusUnit,
  receiver: StatusUnit,
  amount: number,
): void {
  if (!trait) {
    receiver.damage(amount);
    return;
  }
  const from = projectedUnit(trait, source),
    to = projectedUnit(trait, receiver),
    projected = trait.projection.beforeDamage(
      from.unit,
      from.slot,
      to.unit,
      to.slot,
      trait.roundIndex,
      0,
      -1,
      amount,
      "REFLECT",
    ),
    landed = trait.incomingDamage ? trait.incomingDamage(receiver, projected, -1) : projected,
    hpBefore = receiver.hp();
  receiver.damage(landed);
  trait.projection.afterDamage(
    from.unit,
    from.slot,
    to.unit,
    to.slot,
    trait.roundIndex,
    0,
    hpBefore,
    "REFLECT",
  );
}

export function resolveP7Strike(request: P7StrikeRequest): P7StrikeTrace {
  const { attacker, receiver, skillId, rules, random } = request,
    trait = request.trait,
    row = rules.damage.skillRow(skillId),
    context = `battle.P7.skill${skillId}`,
    drawsFrom = random.draws().length,
    hpBefore = receiver.hp(),
    healSteps = healSeams(trait);
  // The zero-power rule: a skill whose own power is 0 resolves its buff or heal in the post-effect
  // phase and must never enter the damage route, which floors a real hit at 1. Java zeroes the miss
  // chance and the hit roll here and installs no side effects, which means no draw either.
  if (row && row.powerPercent === 0 && row.damageBranch !== "source") {
    // `applyP7PostSkillEffects` opens with the actor's own snapshot, and only for a skill that has no
    // power of its own: the damage route takes the same snapshot from inside `computeDamage`.
    if (trait)
      trait.projection.mechanics.beginAction(
        trait.attacker,
        trait.receiver,
        skillId,
        trait.actedFirst,
      );
    // Web: a zero-Power unified skill — Bảo hộ and Dưỡng signatures, the Cầu Vồng heals, the sleep song.
    if (rules.web?.unifiedNoDamage(skillId))
      rules.web.resolveUnifiedNoDamage(
        attacker,
        receiver,
        skillId,
        (label) => random.percent(`${context}.${label}`),
        healSteps,
      );
    // A zero-power skill resolves its own effect here, which is the only reason the gate exists: Java
    // leaves `p7AttackHit` true and `p7Damage` zero and lets the post-skill step do the work.
    const postSkill = request.postSkill?.({
      attacker,
      target: receiver,
      skillId,
      rules,
      random,
      context,
      attackerSpriteId: request.attackerSpriteId,
      receiverSpriteId: request.receiverSpriteId,
      attackHit: true,
      damage: 0,
      heal: healSteps,
    });
    // `finishP7` closes every action with `afterSkillAction`, damage route or not, with the hit it
    // never landed and the damage it never committed.
    const skillActionHealing = trait
      ? trait.projection.afterSkillAction(
          trait.attacker,
          trait.attackerSlot,
          trait.receiver,
          trait.receiverSlot,
          trait.roundIndex,
          0,
          skillId,
          false,
          true,
          true,
          0,
        )
      : 0;
    return {
      zeroPower: true,
      // The gate itself asks for no roll, but the step it hands over to can, so the stream is read
      // back here instead of being written as empty.
      draws: random.draws().slice(drawsFrom),
      damage: 0,
      planDamage: 0,
      hit: true,
      // Java builds this path's result as `new BattleDamageResult(0, 0, -1)`, so the flag is zero.
      critFlag: 0,
      missChance: 0,
      hitRoll: 0,
      committedDamage: 0,
      targetHpBefore: hpBefore,
      attackerHpEnd: attacker.hp(),
      targetHpEnd: receiver.hp(),
      attackerStats: statsOf(attacker),
      targetStats: statsOf(receiver),
      attackerHeld: heldStatuses(attacker),
      targetHeld: heldStatuses(receiver),
      postSkill,
      trait: trait && {
        defenseIgnorePercent: 0,
        sourceMissChance: 0,
        missChance: 0,
        skillActionHealing,
      },
    };
  }
  // Web: a signature skill or Phệ Thuẫn U Minh reads its Power, pierce and conditions before the hit —
  // and before the trait's `beginAction`, so a "tiêu dấu" burst has taken its charge by the time a
  // trait looks for one to spend (Java read it after, and the trait always spent it first).
  const suppress = request.suppressSkillEffects === true;
  const signature = suppress
    ? undefined
    : rules.web?.unifiedStrike(
        attacker,
        receiver,
        skillId,
        trait?.actedFirst ?? attacker.currentStats.speed > receiver.currentStats.speed,
        (label) => random.percent(`${context}.${label}`),
      );
  // Java's first trace block: the pierce, the `beginAction` inside `computeDamage` and every roll the
  // formula asks for are recorded under the strike's own label.
  const pierce = trait
    ? trait.projection.withRandomPrefix(context, () => {
        const projected = trait.projection.projectTargetDefenseIgnorePercent(
          trait.attacker,
          trait.attackerSlot,
          trait.receiver,
          trait.receiverSlot,
          trait.roundIndex,
          0,
        );
        if (!suppress)
          trait.projection.mechanics.beginAction(
            trait.attacker,
            trait.receiver,
            skillId,
            trait.actedFirst,
          );
        return projected;
      })
    : 0;
  // `BattleUnit.computeDamage`: a characteristic that pierces (faster_target_pierce,
  // buffed_defense_pierce) adds its percent on top and lifts the 35% cap a piercing signature keeps —
  // "the user removed the characteristic's former 35% cap; remaining DEF cannot be negative".
  const designPierce = trait
    ? trait.projection.mechanics.defenseIgnore(trait.attacker, trait.receiver)
    : 0;
  const strikePierce =
    designPierce > 0
      ? Math.min(100, Math.max(0, pierce) + designPierce + (signature?.defenseIgnore ?? 0))
      : signature
        ? SignatureSkills.pierce(pierce, signature.defenseIgnore)
        : pierce;
  const outcome = rules.damage.damage({
      attacker: {
        speciesId: attacker.speciesId,
        attack: attacker.currentStats.attack,
        defense: attacker.currentStats.defense,
        visualSpriteId: request.attackerSpriteId,
        unit: attacker,
      },
      target: {
        speciesId: receiver.speciesId,
        attack: receiver.currentStats.attack,
        defense: receiver.currentStats.defense,
        visualSpriteId: request.receiverSpriteId,
        unit: receiver,
      },
      skillId,
      defenseIgnorePercent: strikePierce,
      randomPercent: (label) => random.percent(`${context}.${label}`),
      unifiedPower: signature?.power,
      // Dấu tích: the flat Power the characteristic's charge adds to this hit (web rules only).
      flatPowerBonus:
        rules.web && trait && !suppress
          ? trait.projection.mechanics.flatPowerBonus(trait.attacker)
          : 0,
      powerOverridePercent: request.powerOverridePercent,
      suppressSkillEffects: suppress,
    }),
    // The miss chance is the engine's own snapshot from before the status lands: the formula has
    // rolled a debuff but the runtime has not committed it yet, so the speeds it reads are still the
    // ones the round started with. The probe reports all four of these again at the end of the walk,
    // where a committed Tê Liệt has already moved the target's speed.
    attackerSpeedAtMissCheck = attacker.sourceHitCheckSpeed(),
    targetSpeedAtMissCheck = receiver.currentStats.speed,
    debuff4AtMissCheck = attacker.hasDebuff(4) ? attacker.legacyRow(DEBUFF_BANK, 4)[1] : 0,
    heldItem9AtMissCheck = attacker.hasHeldItem(9),
    sourceMissChance = calculateMissChance({
      attackerSpeed: attackerSpeedAtMissCheck,
      targetSpeed: targetSpeedAtMissCheck,
      attackerHasDebuff4: attacker.hasDebuff(4),
      debuff4Value: debuff4AtMissCheck,
      attackerHasHeldItem9: heldItem9AtMissCheck,
    }),
    // `sourceP7MissChance` returns the projection's answer, not the engine's: a talent that sharpens
    // the aim or a Tê Liệt the attacker is carrying is what the hit roll is graded against.
    missChance = trait
      ? trait.projection.projectMissChance(
          trait.attacker,
          trait.attackerSlot,
          trait.receiver,
          trait.receiverSlot,
          trait.roundIndex,
          0,
          sourceMissChance,
          heldItem9AtMissCheck,
          debuff4AtMissCheck,
        )
      : sourceMissChance,
    hitRoll = random.percent(`${context}.hitroll`),
    resolved = planActionResolution({ rawDamage: outcome.damage, missChance, hitRoll }),
    // `rainbowCharmEvaded`: the defender's charm turns the landed blow into a miss (damage 0).
    charmEvaded =
      resolved.hit && request.charmEvasion?.(receiver, attacker.hasHeldItem(9)) === true,
    plan = charmEvaded ? { hit: false, damage: 0 } : resolved;
  // The two reflect snapshots are taken before the damage lands, because a hit that clears or
  // consumes a buff must not change what the same hit reflects.
  const targetHasBuff2 = receiver.hasBuff(2),
    buff2Percent = rules.status.buff2ReflectPercent(receiver),
    targetHasBuff5 = receiver.hasBuff(5),
    buff5Chance = rules.status.buff5ReflectChance(receiver);
  // Java reaches the floor only from the `COMMIT_PENDING` arm of the switch, so a miss leaves the
  // target exactly where it stood and cannot lift a near-dead one back up.
  let hpAfterDamage = receiver.hp(),
    hpBeforeHit = receiver.hp(),
    /** Web: the hit Vô hình sent back whole, or 0. */
    reflectedWhole = 0,
    floorApply = false,
    // `p7Damage` is reassigned by the projection in the runtime, and the HP bars and the damage text
    // both read the reassigned number, so the walk carries it instead of the plan's.
    appliedDamage = plan.damage;
  const floor = attacker.heldItemParam(10, 5, 0),
    // `BattleDamageResult.commitPendingSideEffects`, the first step of Java's `COMMIT_PENDING` arm:
    // the status the formula rolled for is planted one step before the hit lands, so a target the
    // damage kills clears the status it was given in the same death pass the engine runs.
    commitHit = (damage: number): void => {
      // Web: Vô hình (buff 5) turns the whole hit back on the attacker before it lands. The holder
      // takes nothing and gets none of the hit's statuses; the attacker takes it as a direct hit.
      if (
        rules.web &&
        targetHasBuff5 &&
        receiver !== attacker &&
        exactRollPasses(random.percent("battle.P7.buff5"), buff5Chance)
      ) {
        reflectedWhole = Math.max(0, damage);
        hpBeforeHit = receiver.hp();
        hpAfterDamage = receiver.hp();
        return;
      }
      // Ngủ: a direct hit wakes the sleeper before this hit's own status lands.
      rules.web?.wakeOnDirectDamage(receiver);
      outcome.pendingDebuff?.commit();
      hpBeforeHit = receiver.hp();
      receiver.damage(damage);
      hpAfterDamage = receiver.hp();
    },
    applyFloor = (): void => {
      const floorPlan = planHeldItemHpFloor({
        contextAllowsFloor: request.allowsHpFloor,
        attackerHasHeldItem10: attacker.hasHeldItem(10),
        targetHp: receiver.hp(),
        floor,
        targetHpBefore: rules.web ? hpBeforeHit : undefined,
      });
      floorApply = floorPlan.apply;
      if (floorApply) receiver.setHp(floorPlan.hp);
    };
  // The port has no Long An, no Hoa Diem recoil and no buff-12 second hit, so of the three gates Java
  // wraps this stretch in only `rainbowCharmEvaded` can open, and it already turned the plan into a
  // miss above; the walk runs the arm they all fall through to.
  if (trait) {
    // Java's second trace block, which runs from the damage projection to `afterDamage` and is where a
    // talent that hardens the blow or a characteristic that bleeds the attacker shows up in the stream.
    appliedDamage = trait.projection.withRandomPrefix(`battle.P7.traits.skill${skillId}`, () => {
      const traitProjected = trait.projection.beforeDirectDamage(
          trait.attacker,
          trait.attackerSlot,
          trait.receiver,
          trait.receiverSlot,
          trait.roundIndex,
          0,
          skillId,
          plan.damage,
        ),
        projected = trait.incomingDamage
          ? trait.incomingDamage(trait.receiver, traitProjected, skillId)
          : traitProjected;
      if (plan.hit) {
        commitHit(projected);
        trait.projection.afterDirectDamage(
          trait.attacker,
          trait.attackerSlot,
          trait.receiver,
          trait.receiverSlot,
          trait.roundIndex,
          0,
          skillId,
          Math.max(0, hpBefore - receiver.hp()),
        );
        applyFloor();
        trait.projection.afterDamage(
          trait.attacker,
          trait.attackerSlot,
          trait.receiver,
          trait.receiverSlot,
          trait.roundIndex,
          0,
          hpBefore,
          "DIRECT",
        );
      }
      return projected;
    });
  } else if (plan.hit) {
    commitHit(appliedDamage);
    applyFloor();
  }
  // Web rules: what the hit still owes once it has landed — the Gieo Hạt ticks skill 7 detonates,
  // Gia Tốc's second hit (no effect of its own), and the status a skill consumes or strips.
  if (reflectedWhole > 0) {
    // The reflected hit is an attack on the attacker, graded like any hit: the same blow (Power, crit,
    // relation) lands against the attacker's own defense instead of the holder's, so the number is
    // rescaled by the two base hits. It wakes a sleeper and Hóa Đá softens it.
    rules.web!.wakeOnDirectDamage(attacker);
    const side = (unit: StatusUnit, spriteId: number) => ({
        speciesId: unit.speciesId,
        attack: unit.currentStats.attack,
        defense: unit.currentStats.defense,
        visualSpriteId: spriteId,
        unit,
      }),
      attackerSide = side(attacker, request.attackerSpriteId),
      againstHolder = rules.damage.sourceBaseAttackForCurrentTarget(
        attackerSide,
        side(receiver, request.receiverSpriteId),
      ),
      againstSelf = rules.damage.sourceBaseAttackForCurrentTarget(attackerSide, attackerSide),
      regraded = Math.trunc((reflectedWhole * againstSelf) / Math.max(1, againstHolder)),
      taken = rules.web!.damageTakenPercent(attacker),
      bounced = Math.max(1, regraded + Math.trunc((regraded * taken) / 100));
    commitReflectedDamage(trait, receiver, attacker, bounced);
  } else if (plan.hit && rules.web) {
    if (outcome.supplementalDamage > 0) receiver.damage(outcome.supplementalDamage);
    if ((outcome.followUpDamage ?? 0) > 0 && receiver.alive())
      receiver.damage(outcome.followUpDamage!);
    rules.damage.afterHitStatusEffects(skillId, receiver);
  }
  // Web: what the signature does once its hit has landed (a buff, a status, a counter stance…).
  signature?.afterDamage(
    plan.hit && reflectedWhole === 0,
    Math.max(0, hpBefore - receiver.hp()),
    (label) => random.percent(`${context}.${label}`),
    healSteps,
    trait?.secondaryDamage,
  );
  const committedDamage = Math.max(0, hpBefore - receiver.hp()),
    // The route the skill's own table carries runs before any of the modifiers below, because that is
    // where the source runs it: its heal can be clipped by the HP a reflect would otherwise have taken,
    // and its leech gate is drawn before the item-8 gate.
    postSkill = request.postSkill?.({
      attacker,
      target: receiver,
      skillId,
      rules,
      random,
      context,
      attackerSpriteId: request.attackerSpriteId,
      receiverSpriteId: request.receiverSpriteId,
      // A hit Vô hình sent back never reached the target, so nothing feeds off it.
      attackHit: plan.hit && reflectedWhole === 0,
      // `planPostSkillResolution` is handed `p7Damage`, and that field was reassigned by
      // `beforeDirectDamage` a few steps above, so a talent that hardened the blow heals off the
      // bigger number too.
      damage: reflectedWhole > 0 ? 0 : appliedDamage,
      dealtDamage: reflectedWhole > 0 ? 0 : committedDamage,
      heal: healSteps,
    }),
    // `applyP7SourcePostDamageModifiersFromPlan` returns before its first roll on a missed hit and
    // on a skill aimed at the attacker's own side, so both gates are walked here and the two draws
    // only join the stream when the runtime would actually have asked for them.
    targetSideOpponent = row !== undefined && row.targetSide === 0,
    postDamageRan = plan.hit && reflectedWhole === 0 && targetSideOpponent,
    holdsItem8 = postDamageRan && attacker.hasHeldItem(8),
    heldItem8Chance = holdsItem8 ? attacker.heldItemParam(8, 5, 0) : 0,
    heldItem8HealPercent = holdsItem8 ? attacker.heldItemParam(8, 6, 0) : 0,
    // `BattleActionEngine` takes a `Integer.MAX_VALUE` roll for a gate that never asked, so the
    // leech and the reflect keep Java's sentinel instead of a value that could accidentally pass.
    noRollAsked = 2147483647,
    heldItem8Roll = holdsItem8 ? random.percent("battle.P7.heldItem8.leechGate") : noRollAsked,
    // Web rules roll Vô hình before the hit lands (above), so the Java after-the-fact reflect is off.
    drawsBuff5 = postDamageRan && targetHasBuff5 && !rules.web,
    buff5Roll = drawsBuff5 ? random.percent("battle.P7.buff5") : noRollAsked,
    buff5Stored = drawsBuff5 && exactRollPasses(buff5Roll, buff5Chance) ? committedDamage : 0,
    modifiers = rules.status.planPostDamageModifiers({
      attackHit: plan.hit,
      targetSideOpponent,
      attackerHasHeldItem8: holdsItem8,
      damage: appliedDamage,
      receivedDamage: committedDamage,
      heldItem8Roll,
      heldItem8Chance,
      heldItem8HealPercent,
      targetHasBuff2,
      buff2Percent,
      targetHasBuff5,
      buff5StoredDamage: buff5Stored,
    });
  // The leech lands through the same funnel as the skill's own heal, and the two reflects land through
  // the runtime's projected commit, so a talent that hardens an incoming blow or reads its sustain off
  // the receiver's HP sees them the way it sees a direct hit.
  if (modifiers.heldItem8Leech) healSteps.commit(attacker, attacker, modifiers.heldItem8Heal);
  if (modifiers.applyBuff2Reflect && modifiers.buff2Reflect > 0)
    commitReflectedDamage(trait, receiver, attacker, modifiers.buff2Reflect);
  if (modifiers.applyBuff5Reflect && modifiers.buff5Reflect > 0)
    commitReflectedDamage(trait, receiver, attacker, modifiers.buff5Reflect);
  // `finishP7` closes the action a few render ticks after the modifiers have landed, which is why the
  // leech and the two reflects are already on the attacker when the talents read its HP. The step runs
  // with no trace block — Java cleared the damage one before those ticks — and `p7NoDamageSkill()` is
  // the engine's own power gate, so a skill that carries no power of its own is not a damaging one.
  const skillActionHealing = trait
    ? trait.projection.afterSkillAction(
        trait.attacker,
        trait.attackerSlot,
        trait.receiver,
        trait.receiverSlot,
        trait.roundIndex,
        0,
        skillId,
        row === undefined || row.powerPercent !== 0,
        true,
        plan.hit,
        plan.hit ? committedDamage : 0,
      )
    : 0;
  return {
    zeroPower: false,
    ...(signature?.pp ? { unifiedPp: signature.pp } : {}),
    draws: random.draws().slice(drawsFrom),
    resultDamage: outcome.damage,
    resolvedDamage: outcome.damage,
    critFlag: outcome.critFlag,
    appliedDebuffId: outcome.appliedDebuffId,
    supplementalDamage: outcome.supplementalDamage,
    attackerSpeed: attacker.sourceHitCheckSpeed(),
    targetSpeed: receiver.currentStats.speed,
    debuff4Value: attacker.hasDebuff(4) ? attacker.legacyRow(DEBUFF_BANK, 4)[1] : 0,
    heldItem9: attacker.hasHeldItem(9),
    missChance,
    hitRoll,
    // The third mode is unreachable through this port: it needs a skill that clears the target's
    // buffs before the damage, and the formula refuses the only two ids that do.
    sideEffectMode: plan.hit ? "COMMIT_PENDING" : "NONE",
    hit: plan.hit,
    damage: appliedDamage,
    planDamage: plan.damage,
    hpAfterDamage,
    floor,
    floorApply,
    hpAfterFloor: receiver.hp(),
    committedDamage,
    targetHpBefore: hpBefore,
    postDamageRan,
    heldItem8Chance,
    heldItem8Roll: holdsItem8 ? heldItem8Roll : -1,
    heldItem8HealPercent,
    leech: modifiers.heldItem8Leech,
    heal: modifiers.heldItem8Heal,
    buff2Present: targetHasBuff2,
    buff2Percent,
    buff2Reflect: modifiers.buff2Reflect,
    buff5Present: targetHasBuff5,
    buff5Chance,
    buff5Roll: drawsBuff5 ? buff5Roll : -1,
    buff5Stored,
    buff5Reflect: modifiers.buff5Reflect,
    attackerHpEnd: attacker.hp(),
    targetHpEnd: receiver.hp(),
    attackerStats: statsOf(attacker),
    targetStats: statsOf(receiver),
    attackerHeld: heldStatuses(attacker),
    targetHeld: heldStatuses(receiver),
    postSkill,
    trait: trait && {
      defenseIgnorePercent: pierce,
      sourceMissChance,
      missChance,
      skillActionHealing,
    },
  };
}
