import type { BattleAiActionCandidate } from "./BattleAiActionCandidate";

/**
 * `vqsv.battle.ai.v2.BattleAiUtilityDecision` — the ranked shadow proposal and its full trace.
 *
 * Ranking is utility descending, then action key ascending; with an empty candidate list the selected
 * key is the empty string, which is what the canary compares against before it falls back.
 */
export class BattleAiUtilityDecision {
  readonly rankedCandidates: readonly BattleAiActionCandidate[];
  readonly selectedCandidate: BattleAiActionCandidate | null;

  constructor(candidates: readonly BattleAiActionCandidate[]) {
    const ranked = [...candidates];
    ranked.sort(
      (left, right) =>
        right.finalUtility - left.finalUtility ||
        (left.actionKey < right.actionKey ? -1 : left.actionKey > right.actionKey ? 1 : 0),
    );
    this.rankedCandidates = ranked;
    this.selectedCandidate = ranked.length === 0 ? null : ranked[0];
  }

  selectedActionKey(): string {
    return this.selectedCandidate === null ? "" : this.selectedCandidate.actionKey;
  }
}
