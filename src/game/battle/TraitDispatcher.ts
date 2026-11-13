import type { GameData } from "../../data/GameData";
import type { DesignTraitUnit } from "./DesignTraits";
import {
  PhysicalTraitMechanics,
  TraitMechanicRegistry,
  type AccuracyEvasionContext,
  type ExperienceContext,
  type PermanentStatContext,
  type PetTraitHook,
  type TraitMechanicSpec,
} from "./PhysicalTraits";
import type { StatusRandom } from "./StatusState";
import type { DesignTraitDamageKind } from "./DesignTraitProjection";

/** `PetTraitEventPhase`, the two halves of one seam: the number before it lands, and the HP after. */
export type TraitEventPhase = "PRE_COMMIT" | "POST_COMMIT";

const PRE_COMMIT: TraitEventPhase = "PRE_COMMIT";

/** `PetTraitEventContexts.DirectDamageContext`, reduced to what the two damage hooks read. */
export type DirectDamageContext = {
  /** `DirectDamageContext.damageSource`, which a turn tick does not have. */
  readonly source: DesignTraitUnit | undefined;
  readonly receiver: DesignTraitUnit;
  readonly damage: number;
  readonly directDamage: boolean;
  readonly phase: TraitEventPhase;
};

/** `DirectDamageContext.withDamage`: the ownership and the phase survive, the number does not. */
export function withDamage(context: DirectDamageContext, damage: number): DirectDamageContext {
  return { ...context, damage };
}

/**
 * `PetTraitEventContexts.DamageCommittedContext`, whose two HP numbers are clamped at zero on the way
 * in — which is what makes `hpAfter >= hpBefore` the test for "nothing was actually lost".
 */
export type DamageCommittedContext = {
  readonly source: DesignTraitUnit | undefined;
  readonly receiver: DesignTraitUnit;
  readonly hpBefore: number;
  readonly hpAfter: number;
  readonly damageKind: DesignTraitDamageKind;
};

export function damageCommitted(
  source: DesignTraitUnit | undefined,
  receiver: DesignTraitUnit,
  hpBefore: number,
  hpAfter: number,
  damageKind: DesignTraitDamageKind,
): DamageCommittedContext {
  return {
    source,
    receiver,
    hpBefore: Math.max(0, hpBefore),
    hpAfter: Math.max(0, hpAfter),
    damageKind,
  };
}

/**
 * `PetTraitLifecycleDispatcher`, the shared owner of every trait seam, reduced to the half of it the
 * 19 talents (thiên phú) own.
 *
 * Java answers each seam with the talent, then the species trait, then a form-owned characteristic.
 * The port implements the talent step here. The 20 species traits are refused where they would be
 * read, because projecting a pet without one would be a silent difference rather than a stated
 * boundary. The two mutation forms' characteristics, HV-01 Hỏa Tế Đoạt Tiên and TL-01 Thiên Luân Kim
 * Thân, are not talents at all: the web build runs them as those pets' characteristics in
 * `DesignTraitMechanics` (`agility_outrank_priority`, `hard_control_immunity`), so no unit ever
 * carries a `characteristicTraitId` here.
 *
 * Seams no talent declares are answered by `speciesOnlySeam`, which states the boundary and returns
 * the identity.
 */
export class TraitLifecycleDispatcher {
  private readonly mechanics = new PhysicalTraitMechanics();

  private constructor(
    readonly registry: TraitMechanicRegistry,
    /** `BattleUnit.sourceRandomPercent`: one labelled percent draw per chance family. */
    private readonly random: StatusRandom,
  ) {
    for (let id = 0; id < registry.physicalCount; id++) {
      this.mechanics.requireSupported(registry.physicalSpec(id));
    }
  }

  static async load(data: GameData, random: StatusRandom): Promise<TraitLifecycleDispatcher> {
    return TraitLifecycleDispatcher.withRegistry(await TraitMechanicRegistry.load(data), random);
  }

  /**
   * The same dispatcher over a registry the runtime already holds. This is the per-fight entry point:
   * the chance seams draw from the fight's own stream, so one dispatcher belongs to one battle while
   * the registry behind it belongs to the runtime.
   */
  static withRegistry(
    registry: TraitMechanicRegistry,
    random: StatusRandom,
  ): TraitLifecycleDispatcher {
    return new TraitLifecycleDispatcher(registry, random);
  }

  /** `PetTraitLifecycleDispatcher.enabled`: the profile's own switch, read rather than assumed. */
  get enabled(): boolean {
    return this.registry.dispatcherEnabled;
  }

  /**
   * The seams whose only readers are the species traits and the form characteristics —
   * `ON_BATTLE_ENTER`, `MODIFY_TARGET_DEFENSE`, `MODIFY_STATUS_CHANCE_AND_RESISTANCE`,
   * `MODIFY_INCOMING_DAMAGE`, `AFTER_DIRECT_DAMAGE`, `AFTER_SKILL_ACTION`, `ON_SWITCH_OUT`,
   * `ON_SWITCH_IN` and `refreshDynamicStats`. HV-01's window lives with the characteristic in
   * `DesignTraitMechanics`, not here.
   */
  speciesOnlySeam(unit: DesignTraitUnit | undefined, hook: PetTraitHook): void {
    if (!this.enabled) return;
    this.refuseUnportedTraits(unit, hook);
  }

  /** `PetTraitLifecycleDispatcher.modifyPermanentStats`. */
  modifyPermanentStats(
    subject: DesignTraitUnit,
    context: PermanentStatContext,
  ): PermanentStatContext {
    if (!this.enabled) return context;
    this.refuseUnportedTraits(subject, "MODIFY_PERMANENT_STATS");
    const physical = this.physicalSpec(subject, "MODIFY_PERMANENT_STATS");
    return physical ? this.mechanics.modifyPermanentStats(physical, context) : context;
  }

  /**
   * `PetTraitLifecycleDispatcher.modifyAccuracyAndEvasion`. Only the attacker's talent is consulted;
   * the target's half of the seam is the species trait's evasion term.
   */
  modifyAccuracyAndEvasion(
    attacker: DesignTraitUnit,
    target: DesignTraitUnit,
    context: AccuracyEvasionContext,
  ): AccuracyEvasionContext {
    if (!this.enabled) return context;
    this.refuseUnportedTraits(attacker, "MODIFY_ACCURACY_AND_EVASION");
    this.refuseUnportedTraits(target, "MODIFY_ACCURACY_AND_EVASION");
    const physical = this.physicalSpec(attacker, "MODIFY_ACCURACY_AND_EVASION");
    return physical ? this.mechanics.modifyAccuracy(physical, context) : context;
  }

  /** `PetTraitLifecycleDispatcher.modifyOutgoingDirectDamage`. */
  modifyOutgoingDirectDamage(context: DirectDamageContext): number {
    if (!this.enabled || !context.directDamage || context.phase !== PRE_COMMIT) {
      return context.damage;
    }
    this.refuseUnportedTraits(context.source, "MODIFY_OUTGOING_DIRECT_DAMAGE");
    const attacker = context.source!;
    let damage = context.damage;
    const physical = this.physicalSpec(attacker, "MODIFY_OUTGOING_DIRECT_DAMAGE");
    if (physical && physical.family === "DAMAGE_ACCURACY_TRADEOFF") {
      damage = this.mechanics.modifyOutgoingDamage(physical, damage);
    }
    return damage;
  }

  /** `PetTraitLifecycleDispatcher.modifyIncomingDirectDamage`. */
  modifyIncomingDirectDamage(context: DirectDamageContext): number {
    if (!this.enabled || !context.directDamage || context.phase !== PRE_COMMIT) {
      return context.damage;
    }
    this.refuseUnportedTraits(context.receiver, "MODIFY_INCOMING_DIRECT_DAMAGE");
    const physical = this.physicalSpec(context.receiver, "MODIFY_INCOMING_DIRECT_DAMAGE");
    return physical
      ? this.mechanics.modifyIncomingDirectDamage(physical, context.damage, this.random)
      : context.damage;
  }

  /** `PetTraitLifecycleDispatcher.afterDamage`: the revive and the low-HP loss, and nothing else. */
  afterDamage(context: DamageCommittedContext): void {
    if (!this.enabled || context.hpAfter >= context.hpBefore) return;
    this.refuseUnportedTraits(context.receiver, "AFTER_DAMAGE");
    const physical = this.physicalSpec(context.receiver, "AFTER_DAMAGE");
    if (physical) {
      this.mechanics.afterDamage(physical, context.receiver, context.hpBefore, this.random);
    }
  }

  /** `PetTraitLifecycleDispatcher.modifyExperience`. */
  modifyExperience(subject: DesignTraitUnit, context: ExperienceContext): ExperienceContext {
    if (!this.enabled) return context;
    this.refuseUnportedTraits(subject, "MODIFY_EXPERIENCE");
    const physical = this.physicalSpec(subject, "MODIFY_EXPERIENCE");
    return physical ? this.mechanics.modifyExperience(physical, context) : context;
  }

  /**
   * `PetTraitLifecycleDispatcher.modifyReceivedHealing`, which is also what `projectPassiveHealing`
   * asks before it applies the cap. A talent's own round-end heal does not pass through it: Java
   * calls `BattleUnit.heal` with the granted amount directly.
   */
  modifyReceivedHealing(receiver: DesignTraitUnit, amount: number): number {
    if (!this.enabled) return amount;
    this.refuseUnportedTraits(receiver, "MODIFY_RECEIVED_HEALING");
    const physical = this.physicalSpec(receiver, "MODIFY_RECEIVED_HEALING");
    return physical ? this.mechanics.modifyReceivedHealing(physical, amount) : amount;
  }

  /**
   * `PetTraitLifecycleDispatcher.onRoundEnd`. Java finishes with the species trait's own round-end and
   * a `refreshDynamicStats` for the round that is opening, both of which read only a species trait.
   */
  onRoundEnd(subject: DesignTraitUnit, roundIndex: number): void {
    if (!this.enabled) return;
    this.refuseUnportedTraits(subject, "ON_ROUND_END");
    const physical = this.physicalSpec(subject, "ON_ROUND_END");
    if (!physical) return;
    // TC-10 pauses under Gieo Hạt or Hủ Thực: ask the statuses the pet holds now.
    subject.refreshTraitCanonicalStatuses();
    this.mechanics.onRoundEnd(physical, subject, roundIndex);
  }

  /**
   * `PetTraitLifecycleDispatcher.refreshDynamicStats`, which reads only a species trait. Java calls it
   * after the battle enter, the switch, the skill action, the committed damage, the reflected damage,
   * the status attempt, the heal and the round end, always with the round it is opening.
   */
  refreshDynamicStats(unit: DesignTraitUnit | undefined, _roundIndex: number): void {
    if (!this.enabled) return;
    this.refuseUnportedTraits(unit, "refreshDynamicStats");
  }

  /**
   * `PetTraitLifecycleDispatcher.onSwitchOut`. Java reads no spec here: it clears HV-01's agility
   * window, which the web build keeps with that characteristic in `DesignTraitMechanics`.
   */
  onSwitchOut(_previous: DesignTraitUnit | undefined): void {}

  /**
   * `PetTraitLifecycleDispatcher.onSwitchIn`, whose `ownsFamily(FIRST_DAMAGE_AFTER_ENTRY_BONUS)` reads
   * the species trait and the form characteristic. No talent declares that family.
   */
  onSwitchIn(next: DesignTraitUnit | undefined): void {
    if (!this.enabled) return;
    this.refuseUnportedTraits(next, "ON_SWITCH_IN");
  }

  /** `PetTraitLifecycleDispatcher.physicalSpec`: the wearable gate first, then the hook mask. */
  private physicalSpec(
    unit: DesignTraitUnit | undefined,
    hook: PetTraitHook,
  ): TraitMechanicSpec | undefined {
    if (!unit || !this.registry.isPhysicalTraitAllowed(unit.physicalTraitId)) return undefined;
    const spec = this.registry.physicalSpec(unit.physicalTraitId);
    return spec && spec.hasHook(hook) ? spec : undefined;
  }

  private refuseUnportedTraits(unit: DesignTraitUnit | undefined, seam: string): void {
    if (!unit) return;
    if (unit.speciesTraitId >= 0) {
      throw new Error(
        `species trait ${unit.speciesTraitId} is read at ${seam} by PetSpeciesTraitMechanics,` +
          " a later slice",
      );
    }
    if (unit.characteristicTraitId >= 0) {
      throw new Error(
        `form trait ${unit.characteristicTraitId} is read at ${seam} as an exclusive` +
          " characteristic, a later slice",
      );
    }
  }
}
