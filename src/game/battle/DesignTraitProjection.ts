import type { GameData } from "../../data/GameData";
import {
  DesignTraitMechanics,
  normalizeCanonicalStatus,
  percentOfBase,
  type DesignTraitUnit,
} from "./DesignTraits";
import {
  BUFF_BANK,
  DEBUFF_BANK,
  RAINBOW_BANK,
  RAINBOW_BLEEDING_STATUS_ID,
  SHIELD_STATUS_ID,
  StatusInstance,
  signatureSkillOwned,
  toShort,
  type StatusDefinition,
  type StatusRandom,
} from "./StatusState";
import {
  TraitLifecycleDispatcher,
  damageCommitted,
  withDamage,
  type DirectDamageContext,
} from "./TraitDispatcher";
import {
  TraitMechanicRegistry,
  type AccuracyEvasionContext,
  type ExperienceContext,
  type PermanentStatContext,
} from "./PhysicalTraits";

/** `PetTraitBattleFormation`, which the recorded rows state and nothing else in the port reads. */
export type DesignTraitFormation = "ONE_V_ONE" | "TWO_V_TWO";

/** `PetTraitDamageKind`, reduced to the three kinds a ported path is called with. */
export type DesignTraitDamageKind = "DIRECT" | "REFLECT" | "TURN_DAMAGE";

function isDirectDamage(kind: DesignTraitDamageKind): boolean {
  return kind === "DIRECT";
}

/** `SignatureStatusCatalog` id 16, the counter-attack identity `reflect` spends. */
const REFLECT_STATUS_ID = 16;
/** `SignatureStatusCatalog` id 14, the immunity every status attempt refuses. */
const IMMUNITY_STATUS_ID = 14;
/** `PetTraitBattleProjection.afterStatusAttempt`'s owner table, keyed by canonical status name. */
const DOT_BITS: Record<string, number> = {
  seed: 16,
  seeded_damage: 16,
  corrosion: 37,
  bleeding: 39,
  bleed: 39,
};

/**
 * The round-end pass walks a bank snapshot, so the instance it decrements is a copy and the copy is
 * what it puts back. `dotCommitted` receives that same copy, exactly as Java's `BiConsumer` does.
 */
export type DotCommitted = (status: StatusInstance, damage: number) => void;

/** `PetTraitBattleProjection.PassiveHealingRule`: a passive that projects every heal a unit receives. */
export type PassiveHealingRule = (
  source: DesignTraitUnit,
  target: DesignTraitUnit,
  amount: number,
) => number;

function signaturePut(
  unit: DesignTraitUnit,
  definition: StatusDefinition,
  turns: number,
  primary: number,
  secondary: number,
  sourceSkill: number,
  stacks: number,
): void {
  unit.statuses.put(
    new StatusInstance(
      definition,
      Math.max(1, turns),
      definition.semanticKey === "sleep" ? 1 : 0,
      primary,
      secondary,
      stacks,
      unit.ownerSide,
      unit.formationSlot,
      sourceSkill,
      -unit.signatureState.round - 1,
    ),
  );
  unit.restoreSourceStatusState();
}

/** `SignatureSkillMechanics.shield`: a bigger shield replaces a smaller one, never the reverse. */
function signatureShield(
  unit: DesignTraitUnit,
  definition: StatusDefinition,
  percent: number,
  duration: number,
  sourceSkill: number,
): void {
  const amount = percentOfBase(unit.maxHp(), percent);
  const old = unit.statuses.get(BUFF_BANK, SHIELD_STATUS_ID);
  if (old && old.primaryValue >= amount) return;
  signaturePut(unit, definition, duration, amount, 0, sourceSkill, 1);
}

/** `SignatureSkillMechanics.reflect`: the counter-attack is spent whether or not it can land. */
function signatureReflect(
  unit: DesignTraitUnit,
  other: DesignTraitUnit | undefined,
  damage: number,
): number {
  const instance = unit.statuses.get(BUFF_BANK, REFLECT_STATUS_ID);
  if (!instance || damage <= 0 || !other || !other.alive()) return 0;
  unit.statuses.remove(BUFF_BANK, REFLECT_STATUS_ID);
  return Math.min(
    percentOfBase(damage, instance.primaryValue),
    percentOfBase(unit.maxHp(), instance.secondaryValue),
  );
}

/**
 * `SignatureSkillMechanics.roundEnd`: the pass that ages every status the signature skills and the
 * characteristics own, and pays out the three damage-over-time identities on the way.
 *
 * A status is skipped when nobody owns it and it is not one of the bank-0 marks above id 16, when it
 * was planted this very round, and when its definition is consumed by an action instead of by a
 * round. Cầu Vồng id 5 recomputes its magnitude from how long it has been ticking rather than reading
 * the one it was planted with.
 */
function signatureRoundEnd(
  unit: DesignTraitUnit,
  round: number,
  dotProjection: (damage: number) => number,
  dotCommitted: DotCommitted,
): void {
  let changed = false;
  banks: for (let bank = 0; bank < 3; bank++) {
    for (const instance of unit.statuses.snapshot(bank)) {
      const id = instance.definition.sourceNumericId;
      const owned = signatureSkillOwned(instance) || (bank === BUFF_BANK && id >= 17);
      if (
        !owned ||
        instance.flags === -round - 1 ||
        instance.definition.consumePolicy === "ACTION"
      ) {
        continue;
      }
      changed = true;
      const isDot =
        (bank === DEBUFF_BANK && id === 0) || (bank === RAINBOW_BANK && (id === 5 || id === 7));
      if (isDot && unit.alive()) {
        const magnitude =
          bank === RAINBOW_BANK && id === 5
            ? 3 * (4 - instance.remainingTurns)
            : instance.primaryValue;
        const amount = Math.max(0, dotProjection(percentOfBase(unit.maxHp(), magnitude)));
        if (amount > 0) {
          const before = unit.hp();
          unit.damage(amount);
          dotCommitted(instance, Math.max(0, before - unit.hp()));
        }
      }
      // Java labels the outer loop and continues it, so a death here abandons this bank only.
      if (!unit.alive()) continue banks;
      instance.remainingTurns--;
      if (instance.remainingTurns <= 0) unit.statuses.remove(bank, id);
      else unit.statuses.put(instance);
    }
  }
  unit.signatureState.round = round + 1;
  if (changed) unit.restoreSourceStatusState();
}

/** `SignatureSkillMechanics.clearOnSwitch`: what leaves with the pet, and what the pivot loses. */
function signatureClearOnSwitch(unit: DesignTraitUnit): void {
  for (let bank = 0; bank < 3; bank++) {
    for (const instance of unit.statuses.snapshot(bank)) {
      const id = instance.definition.sourceNumericId;
      if (!signatureSkillOwned(instance) && (bank !== BUFF_BANK || id < 17)) continue;
      unit.statuses.remove(bank, id);
    }
  }
  unit.signatureState.clearTemporary();
  unit.restoreSourceStatusState();
}

/**
 * `PetTraitBattleProjection`: the formation-aware facade the battle calls at every seam a
 * characteristic or a signature status can see.
 *
 * It owns three things of its own. The slot table, which pairs each combatant with the enemy standing
 * opposite it. The damage-over-time owner table, which `attachDesignDotOwner` closes over so a
 * characteristic can tell its own poison from someone else's and keep claiming it across a switch.
 * And the once-only permanent-stat pass, which is where a characteristic's contribution to defense
 * first reaches the projected stats.
 *
 * Everything the numbers come from lives elsewhere: the family handlers in `DesignTraitMechanics`,
 * the status identities in `battle/statuses.json`, the characteristic rows in
 * `battle/pet-design-traits.json`.
 */
export class DesignTraitProjection {
  private readonly activeUnitsBySlot = new Map<number, DesignTraitUnit>();
  private readonly dotOwners = new Map<DesignTraitUnit, Map<number, DesignTraitUnit>>();
  private passiveHealingRule: PassiveHealingRule = (_source, _target, amount) => amount;
  /**
   * `BattleUnit.randomTrace` plus the label `setRandomTrace` gave it: the block the battle is walking
   * right now, which every draw this projection or its dispatcher asks for is recorded under.
   */
  private randomPrefix: string | undefined;
  readonly dispatcher: TraitLifecycleDispatcher;

  constructor(
    readonly mechanics: DesignTraitMechanics,
    readonly formation: DesignTraitFormation,
    /** `BattleUnit.sourceRandomPercent`, which the status attempt and the chance talents share. */
    private readonly randomPercent: StatusRandom,
    registry: TraitMechanicRegistry,
  ) {
    // The dispatcher is built here rather than handed in, because its chance seams draw through the
    // same labelled stream as the status attempt above: one fight, one stream, one prefix.
    this.dispatcher = TraitLifecycleDispatcher.withRegistry(registry, (label) => this.draw(label));
  }

  /**
   * `BattleUnit.setRandomTrace(label)` and `clearRandomTrace()` around one block of the P7 walk: Java
   * records a seam's own draws as `<block>.<family label>`, and the golden rows keep that label, so a
   * port that drew the same roll unprefixed would report a different stream.
   */
  withRandomPrefix<T>(prefix: string, block: () => T): T {
    const outer = this.randomPrefix;
    this.randomPrefix = prefix;
    try {
      return block();
    } finally {
      this.randomPrefix = outer;
    }
  }

  private draw(label: string): number {
    return this.randomPercent(
      this.randomPrefix === undefined ? label : `${this.randomPrefix}.${label}`,
    );
  }

  static async load(
    data: GameData,
    mechanics: DesignTraitMechanics,
    formation: DesignTraitFormation,
    randomPercent: StatusRandom,
  ): Promise<DesignTraitProjection> {
    return new DesignTraitProjection(
      mechanics,
      formation,
      randomPercent,
      await TraitMechanicRegistry.load(data),
    );
  }

  /** `PetTraitBattleProjection.setPassiveHealingRule`; the default rule heals exactly what is asked. */
  setPassiveHealingRule(rule: PassiveHealingRule): void {
    this.passiveHealingRule = rule;
  }

  /** `PetTraitBattleProjection.onBattleEnter`. */
  onBattleEnter(
    unit: DesignTraitUnit,
    slot: number,
    roundIndex: number,
    actionIndex: number,
  ): void {
    unit.signatureState.round = roundIndex;
    unit.designTraitState.round = roundIndex;
    this.mechanics.enter(unit, roundIndex);
    this.attachDesignDotOwner(unit);
    this.activeUnitsBySlot.set(slot, unit);
    this.refreshSignatureOpponents();
    this.dispatcher.speciesOnlySeam(unit, "ON_BATTLE_ENTER");
    this.applyPermanentStatsOnce(unit, slot, roundIndex, actionIndex);
    this.dispatcher.refreshDynamicStats(unit, roundIndex);
  }

  /**
   * `BattleUnit.applyProductionPermanentTraitStats` as `enemyFromEncounter` runs it, ahead of entry: for
   * a unit the fight overwrites afterwards (`TanNguyetLongMaBattleMechanics.configureEncounterUnit`),
   * so the talent's share lands first and entry does not add it again.
   */
  applyPermanentStatsBeforeEntry(unit: DesignTraitUnit): void {
    this.applyPermanentStatsOnce(unit, -1, 1, 0);
  }

  /** `PetTraitBattleProjection.projectPermanentStats`: the four base stats a talent can reshape. */
  projectPermanentStats(
    unit: DesignTraitUnit,
    _slot: number,
    _roundIndex: number,
    _actionIndex: number,
    maxHp: number,
    strength: number,
    defense: number,
    agility: number,
  ): PermanentStatContext {
    return this.dispatcher.modifyPermanentStats(unit, { maxHp, strength, defense, agility });
  }

  /** `PetTraitBattleProjection.projectAccuracyAndEvasion`. */
  projectAccuracyAndEvasion(
    attacker: DesignTraitUnit,
    _attackerSlot: number,
    target: DesignTraitUnit,
    _targetSlot: number,
    _roundIndex: number,
    _actionIndex: number,
    accuracyPercent: number,
    evasionPercent: number,
    accuracyDebuffPoints = 0,
  ): AccuracyEvasionContext {
    return this.dispatcher.modifyAccuracyAndEvasion(attacker, target, {
      accuracyPercent,
      evasionPercent,
      accuracyDebuffPoints: Math.max(0, accuracyDebuffPoints),
    });
  }

  /**
   * `PetTraitBattleProjection.projectTargetDefenseIgnorePercent`, the pierce the runtime asks the
   * projection for before it hands the formula a defense-ignore at all. The context opens at zero and
   * only a species trait or a form characteristic lifts it, so the answer this port can give is the
   * seam call itself plus zero — which is what every recorded row reads.
   */
  projectTargetDefenseIgnorePercent(
    attacker: DesignTraitUnit,
    _attackerSlot: number,
    _target: DesignTraitUnit,
    _targetSlot: number,
    _roundIndex: number,
    _actionIndex: number,
  ): number {
    this.dispatcher.speciesOnlySeam(attacker, "MODIFY_TARGET_DEFENSE");
    return 0;
  }

  /**
   * `PetTraitBattleProjection.projectMissChance`: a guaranteed hit answers zero before the seam is
   * even asked, and anything else goes through the accuracy and evasion projection as a percent that
   * cannot leave the range. The attacker's own Tê Liệt points ride along in the context.
   */
  projectMissChance(
    attacker: DesignTraitUnit,
    attackerSlot: number,
    target: DesignTraitUnit,
    targetSlot: number,
    roundIndex: number,
    actionIndex: number,
    sourceMissChance: number,
    guaranteedHit: boolean,
    accuracyDebuffPoints = 0,
  ): number {
    if (guaranteedHit) return 0;
    const baselineMiss = Math.max(0, Math.min(100, sourceMissChance)),
      projected = this.projectAccuracyAndEvasion(
        attacker,
        attackerSlot,
        target,
        targetSlot,
        roundIndex,
        actionIndex,
        100 - baselineMiss,
        0,
        accuracyDebuffPoints,
      );
    return Math.max(0, Math.min(100, 100 - projected.accuracyPercent + projected.evasionPercent));
  }

  /** `PetTraitBattleProjection.beforeDirectDamage`. */
  beforeDirectDamage(
    attacker: DesignTraitUnit,
    attackerSlot: number,
    receiver: DesignTraitUnit,
    receiverSlot: number,
    roundIndex: number,
    actionIndex: number,
    skillId: number,
    damage: number,
  ): number {
    return this.beforeDamage(
      attacker,
      attackerSlot,
      receiver,
      receiverSlot,
      roundIndex,
      actionIndex,
      skillId,
      damage,
      "DIRECT",
    );
  }

  /**
   * `PetTraitBattleProjection.beforeDamage`: the two characteristic modifiers, then the outgoing and
   * incoming talent projections a direct hit carries, then the species trait's own incoming term.
   */
  beforeDamage(
    source: DesignTraitUnit | undefined,
    _sourceSlot: number,
    receiver: DesignTraitUnit,
    _receiverSlot: number,
    roundIndex: number,
    _actionIndex: number,
    _skillId: number,
    damage: number,
    damageKind: DesignTraitDamageKind,
  ): number {
    let context: DirectDamageContext = {
      source,
      receiver,
      damage,
      directDamage: isDirectDamage(damageKind),
      phase: "PRE_COMMIT",
    };
    if (context.directDamage) {
      if (!source) throw new Error("a direct hit needs a source; only the round-end pass has none");
      source.designTraitState.round = roundIndex;
      receiver.designTraitState.round = roundIndex;
      if (
        !source.signatureState.secondaryHit &&
        source.ownerSide !== receiver.ownerSide &&
        damage > 0
      ) {
        const designDamage = this.mechanics.outgoing(source, damage);
        context = withDamage(context, this.mechanics.incoming(source, receiver, designDamage));
      }
      context = withDamage(context, this.dispatcher.modifyOutgoingDirectDamage(context));
      context = withDamage(context, this.dispatcher.modifyIncomingDirectDamage(context));
    }
    // `PetTraitDamageKind.isIncomingDamage` is true for all three kinds this port can be called with;
    // only `SELF_DAMAGE`, which no ported path produces, is false.
    this.dispatcher.speciesOnlySeam(receiver, "MODIFY_INCOMING_DAMAGE");
    return context.damage;
  }

  /** `PetTraitBattleProjection.afterDirectDamage`. */
  afterDirectDamage(
    attacker: DesignTraitUnit,
    attackerSlot: number,
    receiver: DesignTraitUnit,
    receiverSlot: number,
    roundIndex: number,
    actionIndex: number,
    skillId: number,
    committedDamage: number,
  ): void {
    this.afterDirectDamageAndReflect(
      attacker,
      attackerSlot,
      receiver,
      receiverSlot,
      roundIndex,
      actionIndex,
      skillId,
      committedDamage,
    );
  }

  /**
   * `PetTraitBattleProjection.afterDirectDamageAndReflect`: the retaliation the receiver answers
   * with, the three statuses a landed hit can plant, and the reflected damage committed back onto the
   * attacker. The returned number is what the attacker actually lost to the reflection.
   */
  afterDirectDamageAndReflect(
    attacker: DesignTraitUnit,
    attackerSlot: number,
    receiver: DesignTraitUnit,
    receiverSlot: number,
    roundIndex: number,
    actionIndex: number,
    skillId: number,
    committedDamage: number,
  ): number {
    let reflect = attacker.signatureState.secondaryHit
      ? 0
      : signatureReflect(receiver, attacker, committedDamage);
    attacker.designTraitState.round = roundIndex;
    receiver.designTraitState.round = roundIndex;
    reflect += this.mechanics.afterHit(attacker, receiver, skillId, committedDamage, (amount) =>
      this.rawHealing(receiver, receiver, amount),
    );
    if (
      committedDamage > 0 &&
      !attacker.signatureState.secondaryHit &&
      attacker.ownerSide !== receiver.ownerSide
    ) {
      this.applyDesignHitStatus(
        attacker,
        attackerSlot,
        receiver,
        receiverSlot,
        committedDamage,
        roundIndex,
        actionIndex,
      );
    }
    if (committedDamage > 0 && !attacker.signatureState.secondaryHit) {
      this.signatureElectricCharge(receiver, skillId);
      this.signatureElectricCharge(attacker, skillId);
    }
    this.dispatcher.speciesOnlySeam(receiver, "AFTER_DIRECT_DAMAGE");
    let committedReflect = 0;
    if (reflect > 0 && attacker.alive()) {
      const projected = this.beforeDamage(
        receiver,
        receiverSlot,
        attacker,
        attackerSlot,
        roundIndex,
        0,
        skillId,
        reflect,
        "REFLECT",
      );
      const before = attacker.hp();
      attacker.damage(projected);
      committedReflect = Math.max(0, before - attacker.hp());
      if (committedReflect > 0) {
        this.dispatcher.afterDamage(
          damageCommitted(receiver, attacker, before, attacker.hp(), "REFLECT"),
        );
        this.mechanics.afterDamage(attacker, before, (amount) =>
          this.rawHealing(attacker, attacker, amount),
        );
      }
    }
    this.dispatcher.refreshDynamicStats(receiver, roundIndex);
    this.dispatcher.refreshDynamicStats(attacker, roundIndex);
    return committedReflect;
  }

  /** `PetTraitBattleProjection.afterDamage`. */
  afterDamage(
    source: DesignTraitUnit | undefined,
    _sourceSlot: number,
    receiver: DesignTraitUnit,
    _receiverSlot: number,
    roundIndex: number,
    _actionIndex: number,
    hpBefore: number,
    damageKind: DesignTraitDamageKind,
  ): void {
    receiver.designTraitState.round = roundIndex;
    this.mechanics.afterDamage(receiver, hpBefore, (amount) =>
      this.rawHealing(receiver, receiver, amount),
    );
    this.dispatcher.afterDamage(
      damageCommitted(source, receiver, hpBefore, receiver.hp(), damageKind),
    );
    this.dispatcher.refreshDynamicStats(receiver, roundIndex);
  }

  /** `PetTraitBattleProjection.projectExperience`: the multiplier the award commit reads. */
  projectExperience(
    unit: DesignTraitUnit,
    _slot: number,
    _roundIndex: number,
    _actionIndex: number,
  ): ExperienceContext {
    return this.dispatcher.modifyExperience(unit, { multiplierPercent: 100, stackable: true });
  }

  /**
   * `PetTraitBattleProjection.projectReceivedHealing`. The characteristic bonus is skipped when there
   * is no source, which is what Java's `spec(null)` answers; the talent's own term still applies.
   */
  projectReceivedHealing(
    source: DesignTraitUnit | undefined,
    _sourceSlot: number,
    receiver: DesignTraitUnit,
    _receiverSlot: number,
    _roundIndex: number,
    _actionIndex: number,
    amount: number,
  ): number {
    if (source) this.refreshSignatureOpponents();
    const bonus = source ? this.mechanics.healingBonus(source, receiver, amount) : amount;
    return this.dispatcher.modifyReceivedHealing(receiver, bonus);
  }

  /**
   * `PetTraitBattleProjection.afterHealing`: the reproject that follows a heal landing. A heal can lift
   * a unit back over a characteristic's HP band or back into a talent's window, so the unit's own stats
   * are rebuilt from scratch and its dynamic terms re-projected on the round the heal was spent.
   */
  afterHealing(receiver: DesignTraitUnit, _receiverSlot: number, roundIndex: number): void {
    receiver.restoreStatsForCheck();
    this.dispatcher.refreshDynamicStats(receiver, roundIndex);
  }

  /**
   * `PetTraitBattleProjection.afterSkillAction`: the close of one action. It first files every
   * damage-over-time the actor newly planted under the actor's own name, then runs the family
   * handlers, then answers the healing the dispatcher would have granted — which is none, because
   * `requestedHealing` comes only from a species trait and `projectPassiveHealing` is reachable only
   * through it.
   */
  afterSkillAction(
    actor: DesignTraitUnit,
    actorSlot: number,
    target: DesignTraitUnit | undefined,
    _targetSlot: number,
    roundIndex: number,
    _actionIndex: number,
    skillId: number,
    damagingSkill: boolean,
    // Java passes this on to `SignatureSkillMechanics.afterAction`, which returns before reading it
    // for every unit that carries a characteristic; HV-01 reads its own window in afterAction.
    _directDamage: boolean,
    hit: boolean,
    committedDamage: number,
  ): number {
    actor.signatureState.round = roundIndex;
    actor.designTraitState.round = roundIndex;
    if (target && hit) {
      const owners = this.ownersOf(target);
      const planted = this.mechanics.statusMask(target);
      const before = actor.designTraitState.targetStatusMask;
      for (const bank of [DEBUFF_BANK, RAINBOW_BANK]) {
        for (const status of target.statuses.snapshot(bank)) {
          const bit = bank * 16 + status.definition.sourceNumericId;
          if (
            status.sourceSide === actor.ownerSide &&
            status.sourceSlot === actorSlot &&
            planted.has(bit) &&
            !before.has(bit)
          ) {
            owners.set(bit, actor);
          }
        }
      }
    }
    this.mechanics.afterAction(
      actor,
      target,
      skillId,
      damagingSkill,
      hit,
      committedDamage,
      (amount) => this.rawHealing(actor, actor, amount),
      (amount) => this.rawHealing(actor, target, amount),
    );
    this.signatureAfterAction(actor);
    this.dispatcher.speciesOnlySeam(actor, "AFTER_SKILL_ACTION");
    for (const observer of this.activeUnitsBySlot.values()) {
      // `afterOpponentSkillAction` returns at once for an observer on the actor's own side.
      if (observer.alive() && observer !== actor && observer.ownerSide !== actor.ownerSide) {
        this.dispatcher.speciesOnlySeam(observer, "AFTER_SKILL_ACTION");
      }
    }
    this.dispatcher.refreshDynamicStats(actor, roundIndex);
    return 0;
  }

  /** `PetTraitBattleProjection.onRoundEnd`. */
  onRoundEnd(unit: DesignTraitUnit, slot: number, roundIndex: number, actionIndex: number): void {
    signatureRoundEnd(
      unit,
      roundIndex,
      (damage) =>
        this.beforeDamage(
          undefined,
          -1,
          unit,
          slot,
          roundIndex,
          actionIndex,
          -1,
          damage,
          "TURN_DAMAGE",
        ),
      (status, damage) => this.designDotTick(unit, status, damage, roundIndex),
    );
    this.mechanics.roundEnd(unit, roundIndex, (amount) => this.rawHealing(unit, unit, amount));
    this.dispatcher.onRoundEnd(unit, roundIndex);
    this.dispatcher.refreshDynamicStats(unit, roundIndex + 1);
    if (this.mechanics.enabled(unit)) unit.restoreStatsForCheck();
  }

  /**
   * `PetTraitBattleProjection.onSwitch`. The departing pet's pivot is carried across to whoever
   * replaces it, and `switch_ally_shield` gets a shield of its own on top — but only on a voluntary
   * switch, never on a replacement after a faint, and only once every three rounds.
   */
  onSwitch(
    previous: DesignTraitUnit | undefined,
    next: DesignTraitUnit | undefined,
    slot: number,
    roundIndex: number,
    actionIndex: number,
    replacementAfterFaint: boolean,
  ): void {
    if (previous) previous.designTraitState.round = roundIndex;
    const pivot = !!previous && previous.signatureState.pendingPivot;
    const shield = pivot ? previous!.signatureState.pivotShieldPct : 0;
    const duration = pivot ? previous!.signatureState.pivotShieldDuration : 0;
    const sourceSkill = pivot ? previous!.selectedSkillId : -1;
    const previousDesign = this.mechanics.spec(previous);
    const designShield =
      pivot &&
      !replacementAfterFaint &&
      !!previous &&
      previous.alive() &&
      previousDesign?.type === "switch_ally_shield" &&
      previous.designTraitState.ready(3);
    if (previous) {
      signatureClearOnSwitch(previous);
      previous.designTraitState.clearTemporary();
    }
    if (next) {
      next.signatureState.round = roundIndex;
      if (pivot && next.alive()) {
        signatureShield(
          next,
          this.requireDefinition(BUFF_BANK, SHIELD_STATUS_ID),
          shield,
          duration,
          sourceSkill,
        );
      }
      this.mechanics.enter(next, roundIndex);
      this.attachDesignDotOwner(next);
      if (designShield && next.alive()) {
        this.mechanics.shield(next, previousDesign!.value, previous!);
        previous!.designTraitState.proc();
      }
    }
    this.dispatcher.onSwitchOut(previous);
    this.dispatcher.onSwitchIn(next);
    if (next) {
      this.activeUnitsBySlot.set(slot, next);
      this.applyPermanentStatsOnce(next, slot, roundIndex, actionIndex);
      this.dispatcher.refreshDynamicStats(next, roundIndex);
    } else {
      this.activeUnitsBySlot.delete(slot);
    }
    this.refreshSignatureOpponents();
  }

  /**
   * `PetTraitBattleProjection.tickDesignBleeding`: the round-end pass' own bleed step.
   *
   * The status is read *before* the tick because Java holds that reference across it, and the tick
   * mutates the live instance rather than a copy: the dot step that follows is told which identity paid,
   * not how much was left of it. The returned number is what the unit actually lost, which is zero when
   * a shield ate the whole bleed.
   */
  tickDesignBleeding(unit: DesignTraitUnit, round: number): number {
    const status = unit.statuses.get(RAINBOW_BANK, RAINBOW_BLEEDING_STATUS_ID);
    const damage = unit.tickVqsv4BleedingRoundEnd();
    this.designDotTick(unit, status, damage, round);
    return damage;
  }

  /**
   * `PetTraitBattleProjection.designDotTick`: the tick of one damage-over-time status, which is both
   * the receiver's threshold check and the planter's sustain.
   */
  designDotTick(
    receiver: DesignTraitUnit,
    status: StatusInstance | undefined,
    damage: number,
    round: number,
  ): void {
    if (!status || damage <= 0) return;
    const bank = status.definition.sourceBank;
    const id = status.definition.sourceNumericId;
    const isDot =
      (bank === DEBUFF_BANK && id === 0) || (bank === RAINBOW_BANK && (id === 5 || id === 7));
    if (!isDot) return;
    this.mechanics.afterDamage(receiver, receiver.hp() + damage, (amount) =>
      this.rawHealing(receiver, receiver, amount),
    );
    const source = this.dotOwners.get(receiver)?.get(bank * 16 + id);
    if (!source || source.ownerSide === receiver.ownerSide) return;
    source.designTraitState.round = round;
    this.mechanics.dotTick(source, bank === DEBUFF_BANK && id === 0, damage, (amount) =>
      this.rawHealing(source, source, amount),
    );
  }

  /**
   * `PetTraitBattleProjection.applyDesignHitStatus`: the three families that plant on a landed hit.
   * Two belong to the attacker and one to the receiver, and the receiver's lands on the *attacker*,
   * which is why `reactive_chill` passes its two units the other way round.
   */
  private applyDesignHitStatus(
    attacker: DesignTraitUnit,
    attackerSlot: number,
    target: DesignTraitUnit,
    targetSlot: number,
    damage: number,
    roundIndex: number,
    actionIndex: number,
  ): void {
    const offense = this.mechanics.spec(attacker);
    const defense = this.mechanics.spec(target);
    if (offense && target.alive() && attacker.alive() && attacker.designTraitState.ready(3)) {
      if (
        offense.type === "damage_debuff_followup" &&
        !target.hasDebuff(6) &&
        this.designStatus(
          attacker,
          attackerSlot,
          target,
          targetSlot,
          "damage_down",
          DEBUFF_BANK,
          6,
          2,
          offense.value,
          roundIndex,
          actionIndex,
        )
      ) {
        attacker.designTraitState.proc();
      }
      if (
        offense.type === "first_hit_imprison" &&
        !target.hasSemanticStatus("bound") &&
        this.designStatus(
          attacker,
          attackerSlot,
          target,
          targetSlot,
          "bound",
          RAINBOW_BANK,
          4,
          offense.value,
          0,
          roundIndex,
          actionIndex,
        )
      ) {
        attacker.designTraitState.proc();
      }
    }
    if (
      defense &&
      target.alive() &&
      attacker.alive() &&
      defense.type === "reactive_chill" &&
      damage * 100 >= target.maxHp() * 8 &&
      target.designTraitState.ready(2) &&
      this.designStatus(
        target,
        targetSlot,
        attacker,
        attackerSlot,
        "agility_down",
        DEBUFF_BANK,
        5,
        2,
        defense.value,
        roundIndex,
        actionIndex,
      )
    ) {
      target.designTraitState.proc();
    }
  }

  /**
   * `PetTraitBattleProjection.designStatus`, with `PetTraitStatusAttemptBridge` folded in. Immunity
   * refuses it, an existing status at least as strong refuses it, and the roll is taken against a
   * chance the receiver's held item has already projected — always a full 100 here, because the
   * bridge's attacker bonus is only ever zero on this path and `modifyStatusChanceAndResistance` reads
   * only a species trait or a form characteristic, neither of which a talent carries.
   *
   * `first_hit_imprison` puts its characteristic value in the turn count and leaves the magnitude at
   * zero: it is the one family whose number is a duration.
   */
  private designStatus(
    source: DesignTraitUnit,
    _sourceSlot: number,
    target: DesignTraitUnit,
    _targetSlot: number,
    semantic: string,
    bank: number,
    id: number,
    turns: number,
    value: number,
    roundIndex: number,
    _actionIndex: number,
  ): boolean {
    if (target.hasBuff(IMMUNITY_STATUS_ID)) return false;
    const old = target.statuses.get(bank, id);
    if (old && old.primaryValue >= value) return false;
    this.dispatcher.speciesOnlySeam(source, "MODIFY_STATUS_CHANCE_AND_RESISTANCE");
    this.dispatcher.speciesOnlySeam(target, "MODIFY_STATUS_CHANCE_AND_RESISTANCE");
    const statusKey = normalizeCanonicalStatus(semantic);
    const chance = Math.max(0, Math.min(100, target.projectIncomingStatusChance(100)));
    const roll = this.draw("pet-design-trait.status");
    if (!(roll >= 0 && roll < chance)) {
      this.afterStatusAttempt(source, target, statusKey, false, roundIndex);
      return false;
    }
    this.mechanics.put(
      target,
      this.requireDefinition(bank, id),
      Math.max(0, turns),
      Math.max(0, value),
      1,
      source,
    );
    this.afterStatusAttempt(source, target, statusKey, true, roundIndex);
    return true;
  }

  /** `PetTraitBattleProjection.afterStatusAttempt`: the damage-over-time owner table. */
  private afterStatusAttempt(
    attacker: DesignTraitUnit,
    receiver: DesignTraitUnit,
    statusKey: string,
    applied: boolean,
    roundIndex: number,
  ): void {
    if (applied) {
      const bit = DOT_BITS[statusKey];
      if (bit !== undefined) this.ownersOf(receiver).set(bit, attacker);
    }
    this.dispatcher.speciesOnlySeam(receiver, "MODIFY_STATUS_CHANCE_AND_RESISTANCE");
    this.dispatcher.refreshDynamicStats(receiver, roundIndex);
  }

  /**
   * `PetTraitBattleProjection.rawHealing`: what a characteristic's heal is worth before it lands. A
   * dead receiver heals nothing, the passive-healing rule defaults to the identity, and the receiver's
   * own talent takes its term last.
   */
  private rawHealing(
    source: DesignTraitUnit,
    target: DesignTraitUnit | undefined,
    amount: number,
  ): number {
    if (!target || !target.alive()) return 0;
    const projected = Math.max(0, this.passiveHealingRule(source, target, amount));
    return this.dispatcher.modifyReceivedHealing(target, projected);
  }

  /**
   * `PetTraitBattleProjection.attachDesignDotOwner`. The closure keeps the *setter's* identity, so a
   * replacement standing in the same slot does not inherit the departed pet's poisons.
   */
  private attachDesignDotOwner(unit: DesignTraitUnit): void {
    unit.designTraitState.ownsDot = (target, bit) => this.dotOwners.get(target)?.get(bit) === unit;
  }

  /** `PetTraitBattleProjection.refreshSignatureOpponents`. */
  private refreshSignatureOpponents(): void {
    for (const unit of this.activeUnitsBySlot.values()) {
      unit.signatureState.opponent = this.opponentOf(unit);
    }
  }

  private opponentOf(unit: DesignTraitUnit): DesignTraitUnit | undefined {
    for (const other of this.activeUnitsBySlot.values()) {
      if (other.alive() && other.ownerSide !== unit.ownerSide) return other;
    }
    return undefined;
  }

  private ownersOf(receiver: DesignTraitUnit): Map<number, DesignTraitUnit> {
    let owners = this.dotOwners.get(receiver);
    if (!owners) {
      owners = new Map<number, DesignTraitUnit>();
      this.dotOwners.set(receiver, owners);
    }
    return owners;
  }

  /**
   * `PetTraitBattleProjection.applyPermanentStatsOnce`. The four base stats go out through
   * `projectPermanentStats` and come back through `toShort`, so this is where a talent's ±8 percent
   * first reaches the base — and where `hp_band_defense` first reaches the projected defense, because
   * the write is followed by a reproject. The HP ratio is carried across the change.
   */
  private applyPermanentStatsOnce(
    unit: DesignTraitUnit,
    slot: number,
    roundIndex: number,
    actionIndex: number,
  ): void {
    if (!this.dispatcher.enabled || unit.traitBattleState.permanentStatsApplied()) return;
    const oldMaxHp = Math.max(1, unit.maxHp());
    const oldHp = Math.max(0, unit.hp());
    const projected = this.projectPermanentStats(
      unit,
      slot,
      roundIndex,
      actionIndex,
      oldMaxHp,
      unit.baseStats.attack,
      unit.baseStats.defense,
      unit.baseStats.speed,
    );
    unit.baseStats.hp = toShort(projected.maxHp);
    unit.baseStats.attack = toShort(projected.strength);
    unit.baseStats.defense = toShort(projected.defense);
    unit.baseStats.speed = toShort(projected.agility);
    unit.restoreSourceStatusState();
    unit.setHp(projectHpRatio(oldHp, oldMaxHp, unit.maxHp()));
    unit.traitBattleState.markPermanentStatsApplied();
  }

  private requireDefinition(bank: number, id: number): StatusDefinition {
    const definition = this.mechanics.effects.catalog.definition(bank, id);
    if (!definition) throw new Error(`battle/statuses.json has no status ${bank}/${id}`);
    return definition;
  }

  /**
   * `SignatureSkillMechanics.afterAction`, whose first line hands the whole of it back to the
   * characteristics: a design-trait pet never reaches the catalogue lookup.
   */
  private signatureAfterAction(unit: DesignTraitUnit): void {
    if (this.mechanics.enabled(unit)) return;
    this.refuseSignatureConditionSource(unit, "afterAction");
  }

  /** `SignatureSkillMechanics.electricCharge`, which opens with the same two guards. */
  private signatureElectricCharge(unit: DesignTraitUnit, _skillId: number): void {
    if (this.mechanics.enabled(unit)) return;
    this.refuseSignatureConditionSource(unit, "electricCharge");
  }

  /**
   * Both methods go on to ask `PetDesignSkillCatalog.conditionSource(petKey(speciesId))`, and that
   * catalogue is a later slice. It is not needed here, and this is not a guess: its 53 rows are keyed
   * `LH-*`, `CV-*` and `V4-*`, which `UnifiedSkillLearnsetCatalog.petKey` answers only for species
   * 0..279, and `battle/pet-design-traits.json` covers exactly those 280 species. So a species the
   * characteristic catalogue does not cover has no condition source, and the lookup returns nothing.
   *
   * A species the catalogue *does* cover can still reach the lookup — with a species trait, a form
   * trait or `designTraitState.enabled` switched off — and there the answer may be a real row, so
   * that is refused instead.
   */
  private refuseSignatureConditionSource(unit: DesignTraitUnit, what: string): void {
    if (this.mechanics.catalog.bySpecies(unit.speciesId) === undefined) return;
    throw new Error(
      `SignatureSkillMechanics.${what} reached species ${unit.speciesId} without the design trait` +
        " enabled, so it would read PetDesignSkillCatalog.conditionSource; that catalogue is a later slice",
    );
  }
}

/** `PetTraitBattleProjection.projectHpRatio`: the HP a unit keeps when its maximum changes. */
export function projectHpRatio(oldHp: number, oldMaxHp: number, newMaxHp: number): number {
  if (oldHp <= 0) return 0;
  const projected = Math.trunc((oldHp * newMaxHp + Math.trunc(oldMaxHp / 2)) / oldMaxHp);
  return Math.max(1, Math.min(newMaxHp, projected));
}
