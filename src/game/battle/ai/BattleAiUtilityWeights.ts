import type { BattleAiPolicyModifiers } from "./BattleAiPolicyModifiers";

/**
 * `vqsv.battle.ai.v2.BattleAiUtilityWeights` — the nine numbers one intelligence profile scores with.
 *
 * The five base rows are Java's `forProfile`, harvested into `data/battle/ai-v2-catalog.json` rather
 * than restated here; this module owns only the two operations Java defines on them: applying the
 * authored deltas and folding a breakdown into a single utility.
 */
export type BattleAiUtilityWeights = {
  readonly immediatePercent: number;
  readonly survivalPercent: number;
  readonly setupPercent: number;
  readonly tempoPercent: number;
  readonly resourcePercent: number;
  readonly futurePercent: number;
  readonly riskPercent: number;
  readonly repetitionPercent: number;
  readonly switchMargin: number;
};

/** `bounded`: the eight percent weights stay inside 25..200 after a delta; the margin only clamps low. */
function bounded(value: number): number {
  return Math.max(25, Math.min(200, value));
}

/** `with`: authored A5 deltas, applied to decision weights and to nothing else. */
export function withModifiers(
  weights: BattleAiUtilityWeights,
  modifiers: BattleAiPolicyModifiers | null,
): BattleAiUtilityWeights {
  if (modifiers === null) return weights;
  return {
    immediatePercent: bounded(weights.immediatePercent + modifiers.immediatePercentDelta),
    survivalPercent: bounded(weights.survivalPercent + modifiers.survivalPercentDelta),
    setupPercent: bounded(weights.setupPercent + modifiers.setupPercentDelta),
    tempoPercent: bounded(weights.tempoPercent + modifiers.tempoPercentDelta),
    resourcePercent: bounded(weights.resourcePercent + modifiers.resourcePercentDelta),
    futurePercent: bounded(weights.futurePercent + modifiers.futurePercentDelta),
    riskPercent: bounded(weights.riskPercent + modifiers.riskPercentDelta),
    repetitionPercent: bounded(weights.repetitionPercent + modifiers.repetitionPercentDelta),
    switchMargin: Math.max(0, weights.switchMargin + modifiers.switchMarginDelta),
  };
}

/** An unweighted breakdown, in the order `total` consumes it. */
export type UtilityBreakdown = {
  readonly immediateValue: number;
  readonly koAndSurvivalValue: number;
  readonly statusAndSetupValue: number;
  readonly tempoValue: number;
  readonly ppAndResourceValue: number;
  readonly teamFutureValue: number;
  readonly riskCost: number;
  readonly repetitionOrLoopCost: number;
  readonly personaModifier: number;
  readonly controlledJitter: number;
};

/** `total`: every term scaled by its own percent, risk and repetition subtracted, persona added. */
export function utilityTotal(weights: BattleAiUtilityWeights, parts: UtilityBreakdown): number {
  const scale = (value: number, percent: number): number => Math.trunc((value * percent) / 100);
  return (
    scale(parts.immediateValue, weights.immediatePercent) +
    scale(parts.koAndSurvivalValue, weights.survivalPercent) +
    scale(parts.statusAndSetupValue, weights.setupPercent) +
    scale(parts.tempoValue, weights.tempoPercent) +
    scale(parts.ppAndResourceValue, weights.resourcePercent) +
    scale(parts.teamFutureValue, weights.futurePercent) -
    scale(parts.riskCost, weights.riskPercent) -
    scale(parts.repetitionOrLoopCost, weights.repetitionPercent) +
    parts.personaModifier +
    parts.controlledJitter
  );
}
