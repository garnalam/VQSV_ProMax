import { BattleAiActionCandidate, compareActionKey } from "./BattleAiActionCandidate";
import type { BattleAiEncounterSpec, BattleAiObservation } from "./BattleAiObservation";

/**
 * `vqsv.battle.ai.v2.BattleAiCandidateGenerator` — deterministic legal-action enumeration, no scoring.
 *
 * Legality is Java's, exactly: a skill needs `usable`, an exact PP reading and PP left; a self-side
 * skill may only target an active own unit; an item needs uses left *and* the observation's own
 * legality flag; a switch needs the policy, the cooldown and a live bench member. Then the list is
 * sorted by action key, because the fingerprint and the tie-breaks both read that order.
 */
export function generateCandidates(
  encounter: BattleAiEncounterSpec,
  observation: BattleAiObservation,
): BattleAiActionCandidate[] {
  if (encounter.encounterKey !== observation.encounterKey) {
    throw new Error("AI encounter and observation identities differ");
  }
  const actor = observation.activeOwnUnit();
  if (actor === null || !actor.alive) return [];

  const out: BattleAiActionCandidate[] = [];
  for (const skill of actor.skills) {
    if (!skill.usable || !skill.exactPpKnown || skill.currentPp <= 0) continue;
    const targets = skill.targetSide === 1 ? observation.ownRoster : observation.visibleOpponents;
    for (const target of targets) {
      if (target.alive && (skill.targetSide !== 1 || target.active)) {
        out.push(
          BattleAiActionCandidate.skill(
            actor.actorKey,
            target.actorKey,
            skill.skillKey,
            skill.runtimeId,
          ),
        );
      }
    }
  }

  if (encounter.mayUseItems) {
    for (const item of observation.itemLoadout) {
      if (item.remainingUses > 0 && item.legalForActiveActor) {
        out.push(
          BattleAiActionCandidate.item(
            actor.actorKey,
            actor.actorKey,
            item.itemKey,
            item.runtimeId,
          ),
        );
      }
    }
  }

  if (encounter.maySwitch && observation.turnsSinceNpcSwitch >= encounter.switchCooldownTurns) {
    for (const reserve of observation.ownRoster) {
      if (!reserve.active && reserve.alive) {
        out.push(
          BattleAiActionCandidate.switchTo(actor.actorKey, reserve.actorKey, reserve.memberSlot),
        );
      }
    }
  }

  out.sort((left, right) => compareActionKey(left.actionKey, right.actionKey));
  return out;
}
