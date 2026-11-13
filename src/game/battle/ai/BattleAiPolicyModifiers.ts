/** `vqsv.battle.ai.v2.BattleAiPolicyModifiers` — the authored weight deltas of one policy. */
export type BattleAiPolicyModifiers = {
  readonly immediatePercentDelta: number;
  readonly survivalPercentDelta: number;
  readonly setupPercentDelta: number;
  readonly tempoPercentDelta: number;
  readonly resourcePercentDelta: number;
  readonly futurePercentDelta: number;
  readonly riskPercentDelta: number;
  readonly repetitionPercentDelta: number;
  readonly switchMarginDelta: number;
};

export const NO_POLICY_MODIFIERS: BattleAiPolicyModifiers = {
  immediatePercentDelta: 0,
  survivalPercentDelta: 0,
  setupPercentDelta: 0,
  tempoPercentDelta: 0,
  resourcePercentDelta: 0,
  futurePercentDelta: 0,
  riskPercentDelta: 0,
  repetitionPercentDelta: 0,
  switchMarginDelta: 0,
};

/** `plus`: the additive composition of the persona and the active phase. */
export function plusModifiers(
  left: BattleAiPolicyModifiers,
  right: BattleAiPolicyModifiers | null,
): BattleAiPolicyModifiers {
  if (right === null) return left;
  return {
    immediatePercentDelta: left.immediatePercentDelta + right.immediatePercentDelta,
    survivalPercentDelta: left.survivalPercentDelta + right.survivalPercentDelta,
    setupPercentDelta: left.setupPercentDelta + right.setupPercentDelta,
    tempoPercentDelta: left.tempoPercentDelta + right.tempoPercentDelta,
    resourcePercentDelta: left.resourcePercentDelta + right.resourcePercentDelta,
    futurePercentDelta: left.futurePercentDelta + right.futurePercentDelta,
    riskPercentDelta: left.riskPercentDelta + right.riskPercentDelta,
    repetitionPercentDelta: left.repetitionPercentDelta + right.repetitionPercentDelta,
    switchMarginDelta: left.switchMarginDelta + right.switchMarginDelta,
  };
}
