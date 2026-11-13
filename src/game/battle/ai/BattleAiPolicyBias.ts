/**
 * `vqsv.battle.ai.v2.BattleAiPolicyBias` — the fifteen authored tactical preferences.
 *
 * Java holds them in an `EnumSet`, which iterates and prints in *declaration* order regardless of the
 * order a policy was authored in. The shadow fingerprint hashes `Set.toString()`, so this array is the
 * parity: biases are always sorted by index here before anything reads them.
 */
export type BattleAiPolicyBias =
  | "DAMAGE"
  | "SETUP"
  | "CONTROL"
  | "TEMPO"
  | "ATTRITION"
  | "EXPLOIT"
  | "SWITCH"
  | "ACE_PRESERVE"
  | "ACE_RELEASE"
  | "FINISHER"
  | "OFF_ELEMENT"
  | "FORTIFY"
  | "DEFENSE_CONVERSION"
  | "CLEANSE"
  | "PUNISH_PASSIVE";

/** `BattleAiPolicyBias.values()` order, i.e. the order an `EnumSet` reports. */
export const POLICY_BIAS_ORDER: readonly BattleAiPolicyBias[] = [
  "DAMAGE",
  "SETUP",
  "CONTROL",
  "TEMPO",
  "ATTRITION",
  "EXPLOIT",
  "SWITCH",
  "ACE_PRESERVE",
  "ACE_RELEASE",
  "FINISHER",
  "OFF_ELEMENT",
  "FORTIFY",
  "DEFENSE_CONVERSION",
  "CLEANSE",
  "PUNISH_PASSIVE",
];

/** The biases of an `EnumSet`: declaration order, comma-separated, in square brackets. */
export function policyBiasSetToString(biases: ReadonlySet<BattleAiPolicyBias>): string {
  const ordered = POLICY_BIAS_ORDER.filter((bias) => biases.has(bias));
  return `[${ordered.join(", ")}]`;
}

/** Sort an authored bias list into `EnumSet` order and drop duplicates, as `EnumSet.copyOf` does. */
export function policyBiasSet(biases: readonly BattleAiPolicyBias[]): Set<BattleAiPolicyBias> {
  const wanted = new Set(biases);
  return new Set(POLICY_BIAS_ORDER.filter((bias) => wanted.has(bias)));
}
