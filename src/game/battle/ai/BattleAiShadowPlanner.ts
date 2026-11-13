import { BattleAiActionCandidate } from "./BattleAiActionCandidate";
import { generateCandidates } from "./BattleAiCandidateGenerator";
import { BattleAiEncounterCatalog } from "./BattleAiEncounterCatalog";
import type { BattleAiObservation, UnitView } from "./BattleAiObservation";
import {
  BattleAiObservationFactory,
  type BattleAiObservationInput,
} from "./BattleAiObservationFactory";
import { BattleAiPhasePlanner } from "./BattleAiPhasePlanner";
import type { BattleAiPolicyProjection } from "./BattleAiPolicyProjection";
import { policyBiasSetToString } from "./BattleAiPolicyBias";
import type { BattleAiRulebook } from "./BattleAiRulebook";
import type { BattleAiDecision } from "./BattleAiDecision";
import { BattleAiUtilityDecision } from "./BattleAiUtilityDecision";
import { BattleAiUtilityEvaluator } from "./BattleAiUtilityEvaluator";
import { sha256Hex } from "./Sha256Hex";

/** `BattleAiShadowPlanner.Result` — one shadow evaluation, with the production decision untouched. */
export class BattleAiShadowResult {
  readonly controlsGameplay = false;
  readonly encounterCommissioned: boolean;
  readonly selectedCandidateKey: string;

  constructor(
    readonly observation: BattleAiObservation,
    readonly candidates: readonly BattleAiActionCandidate[],
    readonly productionDecision: BattleAiDecision,
    readonly productionActionKey: string,
    readonly productionCandidateMatched: boolean,
    readonly utilityDecision: BattleAiUtilityDecision,
    readonly policy: BattleAiPolicyProjection,
    readonly fingerprint: string,
  ) {
    this.encounterCommissioned = policy.commissioned;
    this.selectedCandidateKey = utilityDecision.selectedActionKey();
  }

  /** The shadow never commits: what goes back to the battle is always the source-v1 answer. */
  decisionForCommit(): BattleAiDecision {
    return this.productionDecision;
  }

  traceLine(): string {
    const selected = this.utilityDecision.selectedCandidate;
    return (
      "UNIFIED-DESIGN " +
      (this.encounterCommissioned ? "AI-V2-B encounter-shadow" : "AI-V2-A4 shadow") +
      " encounter=" +
      this.observation.encounterKey +
      " turn=" +
      this.observation.turn +
      " actor=" +
      this.observation.activeActor.toString() +
      " candidates=" +
      this.candidates.length +
      " production=" +
      this.productionDecision.type +
      " candidateMatch=" +
      this.productionCandidateMatched +
      " selectedV2=" +
      (selected === null ? "none" : selected.actionKey) +
      " selectedUtility=" +
      (selected === null ? "none" : selected.finalUtility) +
      " commissioned=" +
      this.encounterCommissioned +
      " persona=" +
      this.policy.personaKey +
      " phase=" +
      this.policy.phaseKey +
      " controlsGameplay=false" +
      " fingerprint=" +
      this.fingerprint
    );
  }
}

/**
 * `vqsv.battle.ai.v2.BattleAiShadowPlanner` — the whole commissioned v2 pass, run beside the
 * production decision and returned without touching it.
 *
 * The order is the parity: advance the authored phase first (it mutates the memory the observation is
 * captured from), then capture, project, enumerate, rank, and only then hash. The fingerprint is taken
 * over the observation, the policy and the *ranked* candidates, so a port that scores one term
 * differently shows up as a different digest even when it picks the same action.
 */
export class BattleAiShadowPlanner {
  private readonly observationFactory: BattleAiObservationFactory;
  private readonly utilityEvaluator: BattleAiUtilityEvaluator;
  private readonly phasePlanner: BattleAiPhasePlanner;

  constructor(
    rulebook: BattleAiRulebook,
    private readonly catalog: BattleAiEncounterCatalog,
  ) {
    this.observationFactory = new BattleAiObservationFactory(rulebook);
    this.utilityEvaluator = new BattleAiUtilityEvaluator(rulebook, catalog);
    this.phasePlanner = new BattleAiPhasePlanner(catalog);
  }

  inspect(
    input: BattleAiObservationInput,
    productionDecision: BattleAiDecision,
    productionActionKey: string,
    decisionSeed = 0,
  ): BattleAiShadowResult {
    this.phasePlanner.advance(input);
    const observation = this.observationFactory.capture(input);
    const policy = this.catalog.project(input.encounter, observation.phaseKey);
    const legalCandidates = generateCandidates(input.encounter, observation);
    const proposal = this.utilityEvaluator.evaluateWithPolicy(
      input.encounter,
      observation,
      legalCandidates,
      decisionSeed,
      policy,
    );
    const actionKey = productionActionKey ?? "";
    const matched = proposal.rankedCandidates.some(
      (candidate) => candidate.actionKey === actionKey,
    );
    return new BattleAiShadowResult(
      observation,
      proposal.rankedCandidates,
      productionDecision,
      actionKey,
      matched,
      proposal,
      policy,
      fingerprint(observation, proposal.rankedCandidates, policy),
    );
  }
}

function fingerprint(
  observation: BattleAiObservation,
  candidates: readonly BattleAiActionCandidate[],
  policy: BattleAiPolicyProjection,
): string {
  const material: string[] = [
    [
      observation.profileVersion,
      observation.encounterKey,
      String(observation.turn),
      observation.activeActor.toString(),
      observation.phaseKey,
      String(policy.commissioned),
      policy.personaKey,
      policy.phaseKey,
      policyBiasSetToString(policy.biases),
      String(observation.turnsSinceNpcSwitch),
      String(observation.consecutiveNonDamageActions),
    ].join("|"),
  ];
  appendUnits(material, observation.ownRoster);
  appendUnits(material, observation.visibleOpponents);
  for (const item of observation.itemLoadout) {
    material.push(`|I:${item.itemKey}:${item.remainingUses}:${item.legalForActiveActor}`);
  }
  for (const event of observation.memoryEvents) {
    material.push(`|M:${event}`);
  }
  for (const candidate of candidates) {
    material.push(
      `|C:${candidate.actionKey}:${candidate.immediateValue}:${candidate.koAndSurvivalValue}` +
        `:${candidate.statusAndSetupValue}:${candidate.tempoValue}:${candidate.ppAndResourceValue}` +
        `:${candidate.teamFutureValue}:${candidate.riskCost}:${candidate.repetitionOrLoopCost}` +
        `:${candidate.personaModifier}:${candidate.controlledJitter}:${candidate.finalUtility}` +
        candidate.rationaleTokens.map((token) => `/${token}`).join(""),
    );
  }
  return sha256Hex(material.join(""));
}

function appendUnits(material: string[], units: readonly UnitView[]): void {
  for (const unit of units) {
    material.push(
      `|U:${unit.actorKey.toString()}:${unit.petKey}:${unit.active}:${unit.hp}:${unit.maxHp}` +
        `:${unit.attack}:${unit.defense}:${unit.agility}:${unit.physicalTraitKey}` +
        `:${unit.speciesTraitKey}` +
        unit.skills
          .map((skill) => `/S:${skill.skillKey}:${skill.currentPp}:${skill.exactPpKnown}`)
          .join("") +
        unit.statuses
          .map((status) => `/T:${status.stableKey()}:${status.remainingActions}:${status.stacks}`)
          .join(""),
    );
  }
}
