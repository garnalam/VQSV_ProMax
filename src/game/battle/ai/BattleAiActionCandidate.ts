import { BattleAiActorKey } from "./BattleAiActorKey";
import type { BattleAiRationaleToken } from "./BattleAiRationaleToken";

/** The three action types the candidate generator enumerates. */
export type BattleAiActionType = "SKILL" | "ITEM" | "SWITCH";

/** Compare two action keys the way Java's `String.compareTo` orders them. */
export function compareActionKey(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * `BattleAiActionCandidate.Evaluation` — the complete score breakdown of one pure evaluator pass.
 *
 * Only risk and repetition are clamped on the way in; every other term is reported exactly as the
 * evaluator accumulated it, including a negative persona or jitter.
 */
export class BattleAiEvaluation {
  readonly riskCost: number;
  readonly repetitionOrLoopCost: number;

  constructor(
    readonly immediateValue: number,
    readonly koAndSurvivalValue: number,
    readonly statusAndSetupValue: number,
    readonly tempoValue: number,
    readonly ppAndResourceValue: number,
    readonly teamFutureValue: number,
    riskCost: number,
    repetitionOrLoopCost: number,
    readonly personaModifier: number,
    readonly controlledJitter: number,
    readonly finalUtility: number,
    readonly rationaleTokens: readonly BattleAiRationaleToken[],
  ) {
    this.riskCost = Math.max(0, riskCost);
    this.repetitionOrLoopCost = Math.max(0, repetitionOrLoopCost);
  }
}

/**
 * `vqsv.battle.ai.v2.BattleAiActionCandidate` — one legal action, and after scoring, its trace.
 *
 * The legal identity (`SKILL:<skillKey>:<target>` and friends) is the action key the fingerprint, the
 * shadow trace and the canary all compare, so it is built here exactly once per factory, as Java does.
 */
export class BattleAiActionCandidate {
  readonly actionKey: string;
  readonly type: BattleAiActionType;
  readonly legality = "LEGAL" as const;
  readonly actor: BattleAiActorKey;
  readonly target: BattleAiActorKey | null;
  readonly skillKey: string;
  readonly skillRuntimeId: number;
  readonly itemKey: string;
  readonly itemRuntimeId: number;
  readonly switchMemberSlot: number;
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
  readonly finalUtility: number;
  readonly evaluated: boolean;
  readonly rationaleTokens: readonly BattleAiRationaleToken[];

  private constructor(
    actionKey: string,
    type: BattleAiActionType,
    actor: BattleAiActorKey,
    target: BattleAiActorKey | null,
    skillKey: string,
    skillRuntimeId: number,
    itemKey: string,
    itemRuntimeId: number,
    switchMemberSlot: number,
    rationaleTokens: readonly BattleAiRationaleToken[],
    evaluation: BattleAiEvaluation | null,
  ) {
    this.actionKey = required(actionKey, "actionKey");
    this.type = type;
    this.actor = actor;
    this.target = target;
    this.skillKey = skillKey;
    this.skillRuntimeId = skillRuntimeId;
    this.itemKey = itemKey;
    this.itemRuntimeId = itemRuntimeId;
    this.switchMemberSlot = switchMemberSlot;
    this.immediateValue = evaluation === null ? 0 : evaluation.immediateValue;
    this.koAndSurvivalValue = evaluation === null ? 0 : evaluation.koAndSurvivalValue;
    this.statusAndSetupValue = evaluation === null ? 0 : evaluation.statusAndSetupValue;
    this.tempoValue = evaluation === null ? 0 : evaluation.tempoValue;
    this.ppAndResourceValue = evaluation === null ? 0 : evaluation.ppAndResourceValue;
    this.teamFutureValue = evaluation === null ? 0 : evaluation.teamFutureValue;
    this.riskCost = evaluation === null ? 0 : evaluation.riskCost;
    this.repetitionOrLoopCost = evaluation === null ? 0 : evaluation.repetitionOrLoopCost;
    this.personaModifier = evaluation === null ? 0 : evaluation.personaModifier;
    this.controlledJitter = evaluation === null ? 0 : evaluation.controlledJitter;
    this.finalUtility = evaluation === null ? 0 : evaluation.finalUtility;
    this.evaluated = evaluation !== null;
    this.rationaleTokens = rationaleTokens;
  }

  static skill(
    actor: BattleAiActorKey,
    target: BattleAiActorKey,
    skillKey: string,
    skillRuntimeId: number,
  ): BattleAiActionCandidate {
    return new BattleAiActionCandidate(
      `SKILL:${required(skillKey, "skillKey")}:${target.toString()}`,
      "SKILL",
      actor,
      target,
      skillKey,
      skillRuntimeId,
      "",
      -1,
      -1,
      ["LEGAL_SKILL"],
      null,
    );
  }

  static item(
    actor: BattleAiActorKey,
    target: BattleAiActorKey,
    itemKey: string,
    itemRuntimeId: number,
  ): BattleAiActionCandidate {
    return new BattleAiActionCandidate(
      `ITEM:${required(itemKey, "itemKey")}:${target.toString()}`,
      "ITEM",
      actor,
      target,
      "",
      -1,
      itemKey,
      itemRuntimeId,
      -1,
      ["LEGAL_ITEM"],
      null,
    );
  }

  static switchTo(
    actor: BattleAiActorKey,
    incoming: BattleAiActorKey,
    memberSlot: number,
  ): BattleAiActionCandidate {
    if (memberSlot < 1) throw new Error("Switch member slot must be positive");
    return new BattleAiActionCandidate(
      `SWITCH:${incoming.toString()}`,
      "SWITCH",
      actor,
      incoming,
      "",
      -1,
      "",
      -1,
      memberSlot,
      ["LEGAL_SWITCH"],
      null,
    );
  }

  /** `evaluated`: an immutable copy that keeps the legal identity and prepends nothing. */
  withEvaluation(evaluation: BattleAiEvaluation): BattleAiActionCandidate {
    const tokens = [...this.rationaleTokens, ...evaluation.rationaleTokens];
    return new BattleAiActionCandidate(
      this.actionKey,
      this.type,
      this.actor,
      this.target,
      this.skillKey,
      this.skillRuntimeId,
      this.itemKey,
      this.itemRuntimeId,
      this.switchMemberSlot,
      tokens,
      evaluation,
    );
  }
}

function required(value: string, name: string): string {
  const text = value.trim();
  if (text === "") throw new Error(`${name} is required`);
  return text;
}
