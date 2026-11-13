import { policyBiasSet, type BattleAiPolicyBias } from "./BattleAiPolicyBias";
import { NO_POLICY_MODIFIERS, type BattleAiPolicyModifiers } from "./BattleAiPolicyModifiers";

/**
 * `vqsv.battle.ai.v2.BattleAiPolicyProjection` — one persona plus phase, consumed by a single
 * utility pass.
 *
 * `biases` is an `EnumSet` in Java: de-duplicated and iterated in declaration order, which is the
 * order the shadow fingerprint hashes. Constructing through `policyBiasSet` keeps that true here.
 */
export class BattleAiPolicyProjection {
  readonly biases: ReadonlySet<BattleAiPolicyBias>;

  constructor(
    readonly commissioned: boolean,
    readonly encounterKey: string,
    readonly personaKey: string,
    readonly phaseKey: string,
    biases: readonly BattleAiPolicyBias[],
    readonly personaPreferenceBonus: number,
    readonly phasePreferenceBonus: number,
    readonly modifiers: BattleAiPolicyModifiers,
  ) {
    this.biases = biases.length === 0 ? new Set<BattleAiPolicyBias>() : policyBiasSet(biases);
    this.personaPreferenceBonus = Math.max(0, personaPreferenceBonus);
    this.phasePreferenceBonus = Math.max(0, phasePreferenceBonus);
    this.modifiers = modifiers ?? NO_POLICY_MODIFIERS;
  }

  /** `uncommissioned`: the neutral projection the non-pilot encounters use. */
  static uncommissioned(
    encounterKey: string,
    personaKey: string,
    phaseKey: string,
  ): BattleAiPolicyProjection {
    return new BattleAiPolicyProjection(
      false,
      encounterKey,
      personaKey,
      phaseKey,
      [],
      0,
      0,
      NO_POLICY_MODIFIERS,
    );
  }

  prefers(bias: BattleAiPolicyBias): boolean {
    return this.biases.has(bias);
  }
}
