import { BattleAiActorKey } from "./BattleAiActorKey";
import type { BattleAiEncounterCatalog, BattleAiPhaseEntry } from "./BattleAiEncounterCatalog";
import type { OwnedUnit, BattleAiObservationInput } from "./BattleAiObservationFactory";

/**
 * `vqsv.battle.ai.v2.BattleAiPhasePlanner` — commissioned phase advance from public state only.
 *
 * The trigger set is closed: an authored phase whose trigger type this switch does not carry throws
 * instead of silently never firing, because a silently-never-firing phase would quietly change every
 * decision that projection was meant to steer.
 */
export class BattleAiPhasePlanner {
  constructor(private readonly catalog: BattleAiEncounterCatalog) {}

  advance(input: BattleAiObservationInput): BattleAiPhaseEntry | null {
    const encounter = input.encounter;
    if (!encounter.mayUsePhasePolicy || !this.catalog.isCommissioned(encounter.encounterKey)) {
      return null;
    }
    const phases = this.catalog.phases(encounter.encounterKey);
    const currentOrder = phaseOrder(phases, input.memory.phaseKey());
    let selected: BattleAiPhaseEntry | null = null;
    for (const phase of phases) {
      if (phase.phaseOrder >= currentOrder && triggered(phase, input)) selected = phase;
    }
    if (selected !== null && selected.phaseOrder > currentOrder) {
      input.memory.changePhase(input.turn, selected.phaseKey);
    } else if (selected !== null && currentOrder === 0) {
      input.memory.changePhase(input.turn, selected.phaseKey);
    }
    return selected;
  }
}

function triggered(phase: BattleAiPhaseEntry, input: BattleAiObservationInput): boolean {
  switch (phase.triggerType) {
    case "BATTLE_START":
      return input.turn >= phase.triggerValue;
    case "ROSTER_ALIVE_AT_MOST":
      return alive(input.ownRoster) <= phase.triggerValue;
    case "ACTIVE_MEMBER_SLOT":
      return activeSlot(input.ownRoster, input.activeActor) === phase.triggerValue;
    case "OPPONENT_NON_DAMAGE_OBSERVED":
      return (
        input.memory.consecutiveNonDamageActions(input.visibleOpponentKey) >= phase.triggerValue
      );
    case "ACTIVE_HP_PERCENT_AT_MOST":
      return activeHpPercentAtMost(input.ownRoster, input.activeActor, phase.triggerValue);
    default:
      throw new Error(`Unsupported AI A5 phase trigger ${phase.triggerType}`);
  }
}

function activeHpPercentAtMost(
  roster: readonly OwnedUnit[],
  activeActor: BattleAiActorKey,
  threshold: number,
): boolean {
  for (const row of roster) {
    if (row.actorKey.equals(activeActor)) {
      return row.unit.hp() * 100 <= row.unit.maxHp() * threshold;
    }
  }
  throw new Error("AI B1 active actor is absent from its own roster");
}

function alive(roster: readonly OwnedUnit[]): number {
  let count = 0;
  for (const row of roster) {
    if (row.unit.alive()) count++;
  }
  return count;
}

function activeSlot(roster: readonly OwnedUnit[], activeActor: BattleAiActorKey): number {
  for (const row of roster) {
    if (row.actorKey.equals(activeActor)) return row.memberSlot;
  }
  return -1;
}

function phaseOrder(phases: readonly BattleAiPhaseEntry[], phaseKey: string): number {
  if (phaseKey === "" || phaseKey === "NONE") return 0;
  for (const phase of phases) {
    if (phase.phaseKey === phaseKey) return phase.phaseOrder;
  }
  throw new Error(`AI A5 memory references an unknown phase ${phaseKey}`);
}
