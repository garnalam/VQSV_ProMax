import type { BattleAiActionCandidate } from "./BattleAiActionCandidate";
import type { BattleAiActorKey } from "./BattleAiActorKey";
import { convert } from "./BattleAiCanaryDecisionAdapter";
import type { BattleAiDecision } from "./BattleAiDecision";
import type { BattleAiEncounterCatalog } from "./BattleAiEncounterCatalog";
import {
  BattleAiObservationFactory,
  type BattleAiObservationInput,
} from "./BattleAiObservationFactory";
import type { BattleAiRulebook, BattleAiSkillRecord } from "./BattleAiRulebook";
import { BattleAiShadowPlanner, type BattleAiShadowResult } from "./BattleAiShadowPlanner";
import type { BattleAiV2RuntimeMode } from "./BattleAiV2RuntimeSelector";

/**
 * `BattleAiJointRoundPlanner` + `BattleAiJointRoundDecisionAdapter`: the simultaneous 2v2 NPC round.
 *
 * Both enemies are proposed alone by the shadow planner (seed 0 and 1, Java's `decisionSeed` and
 * `decisionSeed + 1`), every pair whose items the two loadouts can still afford is scored — the two
 * individual utilities plus a coordination term (focus fire, a setup landing before its finisher, a
 * duplicated status or two support moves on one target) — and the best pair, ties broken by its key,
 * replaces both source decisions at once or not at all.
 */
export type JointCandidate = {
  readonly first: BattleAiActionCandidate;
  readonly second: BattleAiActionCandidate;
  readonly jointActionKey: string;
  readonly individualUtility: number;
  readonly coordinationUtility: number;
  readonly finalUtility: number;
  readonly rationale: readonly string[];
};

export type JointRoundResult = {
  readonly encounterKey: string;
  readonly actorProposals: readonly BattleAiShadowResult[];
  readonly rankedCandidates: readonly JointCandidate[];
  readonly selectedCandidate: JointCandidate | null;
};

export type JointCommitResult = {
  readonly decisions: readonly BattleAiDecision[];
  readonly controlsGameplay: boolean;
  readonly fallback: boolean;
  readonly selectedJointKey: string;
  readonly reason: string;
};

export class BattleAiJointRoundPlanner {
  private readonly shadowPlanner: BattleAiShadowPlanner;
  private readonly observations: BattleAiObservationFactory;

  constructor(
    private readonly rulebook: BattleAiRulebook,
    catalog: BattleAiEncounterCatalog,
  ) {
    this.shadowPlanner = new BattleAiShadowPlanner(rulebook, catalog);
    this.observations = new BattleAiObservationFactory(rulebook);
  }

  /** `inspect(inputs, sourceDecisions, sourceActionKeys)`: the seedless call 2v2 makes (seed 0). */
  inspect(
    inputs: readonly BattleAiObservationInput[],
    sourceDecisions: readonly BattleAiDecision[],
    sourceActionKeys: readonly string[],
    decisionSeed = 0,
  ): JointRoundResult {
    requirePair(inputs, "inputs");
    requirePair(sourceDecisions, "sourceDecisions");
    requirePair(sourceActionKeys, "sourceActionKeys");
    const [first, second] = inputs;
    if (
      first.encounter.encounterKey !== second.encounter.encounterKey ||
      first.encounter.battleFormat !== "SIMULTANEOUS_2V2"
    )
      throw new Error("Joint AI requires two actors from one simultaneous 2v2 encounter");
    if (first.activeActor.equals(second.activeActor))
      throw new Error("Joint AI actors must be distinct");
    const proposals = [
      this.shadowPlanner.inspect(first, sourceDecisions[0], sourceActionKeys[0], decisionSeed),
      this.shadowPlanner.inspect(second, sourceDecisions[1], sourceActionKeys[1], decisionSeed + 1),
    ];
    const candidates: JointCandidate[] = [];
    for (const firstAction of proposals[0].candidates)
      for (const secondAction of proposals[1].candidates) {
        if (!this.sharedResourcesLegal(first, second, firstAction, secondAction)) continue;
        candidates.push(this.score(first, second, firstAction, secondAction));
      }
    // `RANKING`: final utility descending, then the joint key in natural order.
    candidates.sort((a, b) =>
      a.finalUtility !== b.finalUtility
        ? b.finalUtility - a.finalUtility
        : a.jointActionKey < b.jointActionKey
          ? -1
          : a.jointActionKey > b.jointActionKey
            ? 1
            : 0,
    );
    return {
      encounterKey: first.encounter.encounterKey,
      actorProposals: proposals,
      rankedCandidates: candidates,
      selectedCandidate: candidates[0] ?? null,
    };
  }

  /** `BattleAiJointRoundDecisionAdapter.project`: both candidates converted, or both sources kept. */
  project(
    mode: BattleAiV2RuntimeMode,
    catalog: BattleAiEncounterCatalog,
    inputs: readonly BattleAiObservationInput[],
    proposal: JointRoundResult,
    sourceDecisions: readonly BattleAiDecision[],
  ): JointCommitResult {
    requirePair(inputs, "inputs");
    requirePair(sourceDecisions, "sourceDecisions");
    const fallback = (reason: string): JointCommitResult => ({
      decisions: sourceDecisions,
      controlsGameplay: false,
      fallback: true,
      selectedJointKey: "",
      reason,
    });
    const encounter = inputs[0].encounter;
    if (
      encounter.battleFormat !== "SIMULTANEOUS_2V2" ||
      encounter.encounterKey !== inputs[1].encounter.encounterKey ||
      encounter.encounterKey !== proposal.encounterKey
    )
      return fallback("joint-encounter-mismatch");
    if (mode.name !== "ALL_ENCOUNTERS_V2" || !mode.canCommit(encounter, catalog))
      return fallback("mode-does-not-commit-2v2");
    if (
      proposal.actorProposals.length !== 2 ||
      !proposal.actorProposals[0].encounterCommissioned ||
      !proposal.actorProposals[1].encounterCommissioned
    )
      return fallback("policy-not-commissioned");
    const selected = proposal.selectedCandidate;
    if (!selected) return fallback("no-legal-joint-candidate");
    if (
      !inputs[0].activeActor.equals(selected.first.actor) ||
      !inputs[1].activeActor.equals(selected.second.actor) ||
      selected.first.actor.equals(selected.second.actor)
    )
      return fallback("joint-actor-mismatch");
    if (!this.sharedResourcesLegal(inputs[0], inputs[1], selected.first, selected.second))
      return fallback("joint-resource-budget-stale");
    try {
      return {
        decisions: [
          convert(inputs[0], selected.first, "ai-v2-joint:"),
          convert(inputs[1], selected.second, "ai-v2-joint:"),
        ],
        controlsGameplay: true,
        fallback: false,
        selectedJointKey: selected.jointActionKey,
        reason: "committed",
      };
    } catch (error) {
      const name = (error as { simpleName?: string }).simpleName ?? "RuntimeException";
      return fallback(`invalid-joint-candidate-${name}`);
    }
  }

  private score(
    firstInput: BattleAiObservationInput,
    secondInput: BattleAiObservationInput,
    first: BattleAiActionCandidate,
    second: BattleAiActionCandidate,
  ): JointCandidate {
    let coordination = 0;
    const rationale: string[] = [],
      firstSkill = this.skill(first),
      secondSkill = this.skill(second),
      sameTarget = first.target !== null && first.target.equals(second.target),
      firstEnemyTarget = enemyTarget(first),
      secondEnemyTarget = enemyTarget(second);
    if (
      sameTarget &&
      firstEnemyTarget &&
      secondEnemyTarget &&
      damaging(firstSkill) &&
      damaging(secondSkill)
    ) {
      coordination += 24;
      rationale.push("focus-fire");
    }
    if (sameTarget && firstEnemyTarget && secondEnemyTarget) {
      coordination += setupFinisherBonus(
        firstInput,
        secondInput,
        first,
        second,
        firstSkill,
        secondSkill,
        rationale,
      );
      coordination += setupFinisherBonus(
        secondInput,
        firstInput,
        second,
        first,
        secondSkill,
        firstSkill,
        rationale,
      );
    }
    if (sameTarget && duplicateStatus(firstSkill, secondSkill)) {
      coordination -= 120;
      rationale.push("duplicate-status-penalty");
    }
    if (sameTarget && support(firstSkill, first) && support(secondSkill, second)) {
      coordination -= 80;
      rationale.push("redundant-support-penalty");
    }
    const individual = first.finalUtility + second.finalUtility;
    return {
      first,
      second,
      jointActionKey: `${first.actor.toString()}=${first.actionKey}||${second.actor.toString()}=${second.actionKey}`,
      individualUtility: individual,
      coordinationUtility: coordination,
      finalUtility: individual + coordination,
      rationale,
    };
  }

  /** `sharedResourcesLegal`: the pair never spends an item more often than both loadouts allow. */
  sharedResourcesLegal(
    firstInput: BattleAiObservationInput,
    secondInput: BattleAiObservationInput,
    first: BattleAiActionCandidate,
    second: BattleAiActionCandidate,
  ): boolean {
    const uses = new Map<string, number>();
    if (first.type === "ITEM") uses.set(first.itemKey, 1);
    if (second.type === "ITEM") uses.set(second.itemKey, (uses.get(second.itemKey) ?? 0) + 1);
    for (const [key, count] of uses) {
      const available = Math.min(
        this.remainingItemUses(firstInput, key),
        this.remainingItemUses(secondInput, key),
      );
      if (count > available) return false;
    }
    return true;
  }

  private remainingItemUses(input: BattleAiObservationInput, itemKey: string): number {
    const observation = this.observations.capture(input);
    return observation.itemLoadout.find((item) => item.itemKey === itemKey)?.remainingUses ?? 0;
  }

  private skill(candidate: BattleAiActionCandidate): BattleAiSkillRecord | undefined {
    return candidate.type === "SKILL"
      ? this.rulebook.unifiedSkill(candidate.skillRuntimeId)
      : undefined;
  }
}

function setupFinisherBonus(
  setupInput: BattleAiObservationInput,
  finisherInput: BattleAiObservationInput,
  setupAction: BattleAiActionCandidate,
  finisherAction: BattleAiActionCandidate,
  setupSkill: BattleAiSkillRecord | undefined,
  finisherSkill: BattleAiSkillRecord | undefined,
  rationale: string[],
): number {
  if (
    !producesSetup(setupSkill) ||
    !damaging(finisherSkill) ||
    duplicateStatus(setupSkill, finisherSkill)
  )
    return 0;
  const ordered =
    actorSpeed(setupInput, setupAction.actor) >= actorSpeed(finisherInput, finisherAction.actor);
  rationale.push(ordered ? "setup-before-finisher" : "setup-after-finisher");
  return ordered ? 56 : 18;
}

function actorSpeed(input: BattleAiObservationInput, actorKey: BattleAiActorKey): number {
  const row = input.ownRoster.find((owned) => owned.actorKey.equals(actorKey));
  if (!row) throw new Error("Joint candidate actor is outside its roster");
  return row.unit.speed();
}

const enemyTarget = (candidate: BattleAiActionCandidate) =>
  candidate.target !== null && candidate.target.side !== candidate.actor.side;

const damaging = (skill: BattleAiSkillRecord | undefined) => skill !== undefined && skill.power > 0;

const support = (skill: BattleAiSkillRecord | undefined, candidate: BattleAiActionCandidate) =>
  skill !== undefined && (skill.targetSide === 1 || skill.power <= 0) && candidate.type === "SKILL";

const SETUP_TYPES = new Set([
  "apply_status",
  "first_action_status",
  "low_hp_power_status",
  "status_or_power",
  "detonate_or_apply",
]);
const producesSetup = (skill: BattleAiSkillRecord | undefined) =>
  skill !== undefined && (skill.status !== "" || SETUP_TYPES.has(skill.mechanicsType));

const duplicateStatus = (
  first: BattleAiSkillRecord | undefined,
  second: BattleAiSkillRecord | undefined,
) =>
  first !== undefined &&
  second !== undefined &&
  first.status !== "" &&
  first.status === second.status;

function requirePair(values: readonly unknown[], name: string): void {
  if (values.length !== 2) throw new Error(`${name} must contain exactly two entries`);
  for (const value of values)
    if (value === null || value === undefined) throw new Error(`${name} entry`);
}
