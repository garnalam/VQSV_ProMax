import type { BattleAiActionCandidate } from "./BattleAiActionCandidate";
import type { BattleAiActorKey } from "./BattleAiActorKey";
import type { BattleAiEncounterCatalog } from "./BattleAiEncounterCatalog";
import { BattleAiDecision } from "./BattleAiDecision";
import type { BattleAiObservationInput, OwnedUnit } from "./BattleAiObservationFactory";
import type { BattleAiShadowResult } from "./BattleAiShadowPlanner";
import type { BattleAiUnit } from "./BattleAiUnit";
import {
  runtimeModeIsLive,
  runtimeModeTraceLabel,
  type BattleAiV2RuntimeMode,
} from "./BattleAiV2RuntimeSelector";

/** The exception name Java's `exception.getClass().getSimpleName()` reports for a rejected candidate. */
class IllegalArgumentException extends Error {
  readonly simpleName = "IllegalArgumentException";

  constructor(message: string) {
    super(message);
  }
}

/** `BattleAiCanaryDecisionAdapter.Result` — the committed decision, or the fail-closed fallback. */
export class BattleAiCanaryResult {
  constructor(
    readonly decision: BattleAiDecision,
    readonly controlsGameplay: boolean,
    readonly fallback: boolean,
    readonly selectedCandidateKey: string,
    readonly reason: string,
    private readonly traceLabel: string,
  ) {}

  traceLine(encounterKey: string): string {
    return (
      "UNIFIED-DESIGN " +
      this.traceLabel +
      " encounter=" +
      encounterKey +
      " selectedV2=" +
      (this.selectedCandidateKey === "" ? "none" : this.selectedCandidateKey) +
      " controlsGameplay=" +
      this.controlsGameplay +
      " fallback=" +
      this.fallback +
      " reason=" +
      this.reason
    );
  }
}

/**
 * `vqsv.battle.ai.v2.BattleAiCanaryDecisionAdapter` — the only place AI-v2 is allowed to speak for
 * the battle, and it re-derives every legality instead of trusting the shadow's ranking.
 *
 * The gates run in Java's order and each one is fail-closed: a 2v2 encounter is deferred, a mode that
 * does not commit or an encounter outside that mode's scope keeps source-v1, an uncommissioned policy
 * keeps it, an empty candidate list keeps it, and a candidate that no longer resolves to a legal
 * command keeps it with the exception's own name in the reason. Converting a candidate re-checks the
 * actor is alive, still owns a usable copy of the skill, and that the item or switch is still legal —
 * the observation was a snapshot, and the battle may have moved since.
 */
export class BattleAiCanaryDecisionAdapter {
  constructor(private readonly catalog: BattleAiEncounterCatalog) {}

  project(
    mode: BattleAiV2RuntimeMode,
    input: BattleAiObservationInput,
    proposal: BattleAiShadowResult,
    sourceDecision: BattleAiDecision,
  ): BattleAiCanaryResult {
    const traceLabel = runtimeModeTraceLabel(mode);
    if (input.encounter.battleFormat === "SIMULTANEOUS_2V2") {
      return fallback(sourceDecision, "simultaneous-2v2-deferred", traceLabel);
    }
    if (!mode.canCommit(input.encounter, this.catalog)) {
      return fallback(
        sourceDecision,
        mode.name === "LEADER_BOSS_CANARY_V2" ? "encounter-not-certified" : "mode-does-not-commit",
        traceLabel,
      );
    }
    if (!proposal.encounterCommissioned || !proposal.policy.commissioned) {
      return fallback(sourceDecision, "policy-not-commissioned", traceLabel);
    }
    const selected = proposal.utilityDecision.selectedCandidate;
    if (selected === null) {
      return fallback(sourceDecision, "no-legal-v2-candidate", traceLabel);
    }
    try {
      return new BattleAiCanaryResult(
        convert(input, selected, runtimeModeIsLive(mode) ? "ai-v2-live:" : "ai-v2-canary:"),
        true,
        false,
        selected.actionKey,
        "committed",
        traceLabel,
      );
    } catch (exception) {
      const simpleName =
        exception instanceof IllegalArgumentException ? exception.simpleName : "Error";
      return fallback(sourceDecision, `invalid-v2-candidate-${simpleName}`, traceLabel);
    }
  }
}

/** `BattleAiCanaryDecisionAdapter.convert`, shared with the 2v2 joint adapter. */
export function convert(
  input: BattleAiObservationInput,
  candidate: BattleAiActionCandidate,
  rationalePrefix: string,
): BattleAiDecision {
  if (!input.activeActor.equals(candidate.actor)) {
    throw new IllegalArgumentException("Candidate actor is not active");
  }
  const actor = resolve(input, candidate.actor);
  if (actor === null || !actor.alive()) {
    throw new IllegalArgumentException("Candidate actor is unavailable");
  }
  switch (candidate.type) {
    case "SKILL": {
      const skillTarget = resolve(input, candidate.target);
      if (
        skillTarget === null ||
        !skillTarget.alive() ||
        !ownsUsableSkill(actor, candidate.skillRuntimeId)
      ) {
        throw new IllegalArgumentException("Skill or target is no longer legal");
      }
      return BattleAiDecision.skill(
        candidate.skillRuntimeId,
        skillTarget,
        candidate.finalUtility,
        rationalePrefix + candidate.actionKey,
      );
    }
    case "ITEM": {
      if (
        !input.encounter.mayUseItems ||
        !candidate.actor.equals(candidate.target) ||
        actor.validateBattleItem(candidate.itemRuntimeId) !== -1
      ) {
        throw new IllegalArgumentException("Item is no longer legal");
      }
      return BattleAiDecision.item(
        candidate.itemRuntimeId,
        actor,
        candidate.finalUtility,
        rationalePrefix + candidate.actionKey,
      );
    }
    case "SWITCH": {
      const incoming = owned(input, candidate.switchMemberSlot);
      if (
        !input.encounter.maySwitch ||
        incoming === null ||
        incoming.active ||
        !incoming.unit.alive() ||
        !incoming.actorKey.equals(candidate.target)
      ) {
        throw new IllegalArgumentException("Switch is no longer legal");
      }
      return BattleAiDecision.switchTo(
        candidate.switchMemberSlot - 1,
        candidate.finalUtility,
        rationalePrefix + candidate.actionKey,
      );
    }
    default:
      throw new IllegalArgumentException(
        `Unsupported AI-v2 candidate type ${String(candidate.type)}`,
      );
  }
}

function ownsUsableSkill(actor: BattleAiUnit, runtimeId: number): boolean {
  for (let slot = 0; slot < actor.skillSlotCount; slot++) {
    if (
      actor.skillAt(slot) === runtimeId &&
      actor.skillPpAt(slot) > 0 &&
      actor.canUseSourceSkillId(runtimeId)
    ) {
      return true;
    }
  }
  return false;
}

function resolve(
  input: BattleAiObservationInput,
  actorKey: BattleAiActorKey | null,
): BattleAiUnit | null {
  if (actorKey === null) return null;
  for (const row of input.visibleOpponents) {
    if (row.actorKey.equals(actorKey)) return row.unit;
  }
  for (const row of input.ownRoster) {
    if (row.actorKey.equals(actorKey)) return row.unit;
  }
  return null;
}

function owned(input: BattleAiObservationInput, memberSlot: number): OwnedUnit | null {
  for (const row of input.ownRoster) {
    if (row.memberSlot === memberSlot) return row;
  }
  return null;
}

function fallback(
  sourceDecision: BattleAiDecision,
  reason: string,
  traceLabel: string,
): BattleAiCanaryResult {
  return new BattleAiCanaryResult(sourceDecision, false, true, "", reason, traceLabel);
}
