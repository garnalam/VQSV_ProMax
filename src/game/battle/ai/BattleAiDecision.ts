import type { BattleAiUnit } from "./BattleAiUnit";

/** `BattleAiDecision.Type` — the four commands the enemy turn may issue. */
export type BattleAiDecisionType = "SKILL" | "SWITCH" | "ITEM" | "NONE";

/** `Integer.MIN_VALUE`, what Java reports for a decision that carries no score. */
const INT_MIN = -2147483648;

/**
 * `vqsv.battle.ai.BattleAiDecision` — one complete AI command.
 *
 * `target` is the unit the command acts on and `switchIndex` is the 0-based position in the enemy
 * party; both are what the runtime resolves the command against, and the golden rows record the
 * target's actor key rather than the unit, so the comparison is made on the key.
 */
export class BattleAiDecision {
  private constructor(
    readonly type: BattleAiDecisionType,
    readonly skillId: number,
    readonly target: BattleAiUnit | null,
    readonly switchIndex: number,
    readonly itemId: number,
    readonly score: number,
    readonly rationale: string,
  ) {}

  static skill(
    id: number,
    target: BattleAiUnit,
    score: number,
    rationale: string,
  ): BattleAiDecision {
    return new BattleAiDecision("SKILL", id, target, -1, -1, score, rationale ?? "");
  }

  static switchTo(index: number, score: number, rationale: string): BattleAiDecision {
    return new BattleAiDecision("SWITCH", -1, null, index, -1, score, rationale ?? "");
  }

  static item(
    itemId: number,
    target: BattleAiUnit,
    score: number,
    rationale: string,
  ): BattleAiDecision {
    return new BattleAiDecision("ITEM", -1, target, -1, itemId, score, rationale ?? "");
  }

  static none(rationale: string): BattleAiDecision {
    return new BattleAiDecision("NONE", -1, null, -1, -1, INT_MIN, rationale ?? "");
  }
}
