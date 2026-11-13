import { BattleAiActorKey, type BattleAiSide } from "./BattleAiActorKey";

/** `BattleAiMemory.EventKind`, in the declaration order the canonical event line prints. */
export type BattleAiMemoryEventKind =
  | "SKILL_REVEALED"
  | "TRAIT_REVEALED"
  | "DAMAGE_OBSERVED"
  | "STATUS_OBSERVED"
  | "SWITCH_OBSERVED"
  | "KNOCKOUT_OBSERVED"
  | "ITEM_USED"
  | "PHASE_CHANGED";

/**
 * `BattleAiMemory.Event` — one remembered public fact.
 *
 * `canonical()` is the exact line the shadow fingerprint hashes and the candidate generator scans for
 * `SKILL_REVEALED`/`ITEM_USED`/`SWITCH_OBSERVED`, so the field order and the empty-string actors are
 * part of the contract.
 */
export class BattleAiMemoryEvent {
  constructor(
    readonly turn: number,
    readonly kind: BattleAiMemoryEventKind,
    readonly actor: BattleAiActorKey | null,
    readonly target: BattleAiActorKey | null,
    readonly stableValue: string,
    readonly numericValue: number,
  ) {}

  canonical(): string {
    return [
      this.turn,
      this.kind,
      this.actor === null ? "" : this.actor.toString(),
      this.target === null ? "" : this.target.toString(),
      this.stableValue,
      this.numericValue,
    ].join("|");
  }
}

/**
 * `vqsv.battle.ai.v2.BattleAiMemory` — the bounded, battle-local public-information memory.
 *
 * It stores stable values only: no live unit, no pending command, no future draw. Pruning runs on
 * every read *and* every record, `itemUses`, `lastSwitchTurn` and the non-damage streak are never
 * pruned, and a horizon of −1 keeps the whole battle.
 */
export class BattleAiMemory {
  static readonly FULL_BATTLE_HORIZON = -1;
  private static readonly MAX_EVENT_COUNT = 512;

  private readonly eventLog: BattleAiMemoryEvent[] = [];
  private readonly revealedSkills = new Map<string, Map<string, number>>();
  private readonly revealedTraits = new Map<string, Map<string, number>>();
  private readonly itemUses = new Map<string, number>();
  private readonly lastSwitchTurn = new Map<BattleAiSide, number>();
  private readonly nonDamageStreak = new Map<string, number>();
  private currentPhaseKey = "NONE";

  constructor(readonly horizonTurns: number) {
    if (horizonTurns === 0 || horizonTurns < BattleAiMemory.FULL_BATTLE_HORIZON) {
      throw new Error("AI memory horizon must be -1 or a positive turn count");
    }
  }

  observeSkill(
    turn: number,
    actor: BattleAiActorKey,
    skillKey: string,
    causedDamage: boolean,
  ): void {
    requireTurn(turn);
    requireKey(skillKey, "Skill");
    remember(this.revealedSkills, actor, skillKey, turn);
    this.record(turn, "SKILL_REVEALED", actor, null, skillKey, causedDamage ? 1 : 0);
    const previous = this.nonDamageStreak.get(actor.toString()) ?? 0;
    this.nonDamageStreak.set(actor.toString(), causedDamage ? 0 : previous + 1);
  }

  observeTrait(turn: number, actor: BattleAiActorKey, traitKey: string): void {
    requireTurn(turn);
    requireKey(traitKey, "Trait");
    remember(this.revealedTraits, actor, traitKey, turn);
    this.record(turn, "TRAIT_REVEALED", actor, null, traitKey, 0);
  }

  observeDamage(
    turn: number,
    actor: BattleAiActorKey,
    target: BattleAiActorKey,
    actualDamage: number,
  ): void {
    requireTurn(turn);
    if (actualDamage <= 0) return;
    this.record(turn, "DAMAGE_OBSERVED", actor, target, "", actualDamage);
  }

  observeStatus(
    turn: number,
    actor: BattleAiActorKey,
    target: BattleAiActorKey | null,
    statusKey: string,
  ): void {
    requireTurn(turn);
    requireKey(statusKey, "Status");
    this.record(turn, "STATUS_OBSERVED", actor, target, statusKey, 0);
  }

  observeSwitch(turn: number, outgoing: BattleAiActorKey | null, incoming: BattleAiActorKey): void {
    requireTurn(turn);
    this.lastSwitchTurn.set(incoming.side, turn);
    this.record(turn, "SWITCH_OBSERVED", outgoing, incoming, "", 0);
  }

  observeKnockout(turn: number, target: BattleAiActorKey): void {
    requireTurn(turn);
    this.record(turn, "KNOCKOUT_OBSERVED", null, target, "", 0);
  }

  observeItem(turn: number, actor: BattleAiActorKey, itemKey: string): void {
    requireTurn(turn);
    requireKey(itemKey, "Item");
    const uses = (this.itemUses.get(itemKey) ?? 0) + 1;
    this.itemUses.set(itemKey, uses);
    this.record(turn, "ITEM_USED", actor, null, itemKey, uses);
  }

  changePhase(turn: number, nextPhaseKey: string): void {
    requireTurn(turn);
    requireKey(nextPhaseKey, "Phase");
    if (nextPhaseKey === this.currentPhaseKey) return;
    this.currentPhaseKey = nextPhaseKey;
    this.record(turn, "PHASE_CHANGED", null, null, nextPhaseKey, 0);
  }

  revealedSkillsFor(actor: BattleAiActorKey, currentTurn: number): string[] {
    this.prune(currentTurn);
    return knownKeys(this.revealedSkills.get(actor.toString()));
  }

  revealedTraitsFor(actor: BattleAiActorKey, currentTurn: number): string[] {
    this.prune(currentTurn);
    return knownKeys(this.revealedTraits.get(actor.toString()));
  }

  usesOf(itemKey: string): number {
    return this.itemUses.get(itemKey) ?? 0;
  }

  /** `turnsSinceSwitch`: no switch at all is `Integer.MAX_VALUE`, never a large guess. */
  turnsSinceSwitch(side: BattleAiSide, currentTurn: number): number {
    const previous = this.lastSwitchTurn.get(side);
    return previous === undefined ? 2147483647 : Math.max(0, currentTurn - previous);
  }

  consecutiveNonDamageActions(actor: BattleAiActorKey): number {
    return this.nonDamageStreak.get(actor.toString()) ?? 0;
  }

  phaseKey(): string {
    return this.currentPhaseKey;
  }

  events(currentTurn: number): BattleAiMemoryEvent[] {
    this.prune(currentTurn);
    return [...this.eventLog];
  }

  eventCount(currentTurn: number): number {
    this.prune(currentTurn);
    return this.eventLog.length;
  }

  clear(): void {
    this.eventLog.length = 0;
    this.revealedSkills.clear();
    this.revealedTraits.clear();
    this.itemUses.clear();
    this.lastSwitchTurn.clear();
    this.nonDamageStreak.clear();
    this.currentPhaseKey = "NONE";
  }

  private record(
    turn: number,
    kind: BattleAiMemoryEventKind,
    actor: BattleAiActorKey | null,
    target: BattleAiActorKey | null,
    stableValue: string,
    numericValue: number,
  ): void {
    this.prune(turn);
    this.eventLog.push(
      new BattleAiMemoryEvent(turn, kind, actor, target, stableValue ?? "", numericValue),
    );
    while (this.eventLog.length > BattleAiMemory.MAX_EVENT_COUNT) {
      this.eventLog.shift();
    }
  }

  private prune(currentTurn: number): void {
    requireTurn(currentTurn);
    if (this.horizonTurns === BattleAiMemory.FULL_BATTLE_HORIZON) return;
    const minimumTurn = Math.max(1, currentTurn - this.horizonTurns + 1);
    for (let index = this.eventLog.length - 1; index >= 0; index--) {
      if (this.eventLog[index].turn < minimumTurn) this.eventLog.splice(index, 1);
    }
    pruneKnowledge(this.revealedSkills, minimumTurn);
    pruneKnowledge(this.revealedTraits, minimumTurn);
  }
}

function pruneKnowledge(knowledge: Map<string, Map<string, number>>, minimumTurn: number): void {
  for (const [actorKey, values] of knowledge) {
    for (const [key, turn] of values) {
      if (turn < minimumTurn) values.delete(key);
    }
    if (values.size === 0) knowledge.delete(actorKey);
  }
}

function remember(
  knowledge: Map<string, Map<string, number>>,
  actor: BattleAiActorKey,
  key: string,
  turn: number,
): void {
  const actorKey = actor.toString();
  const values = knowledge.get(actorKey) ?? new Map<string, number>();
  knowledge.set(actorKey, values);
  values.set(key, turn);
}

function knownKeys(knowledge: Map<string, number> | undefined): string[] {
  return knowledge === undefined || knowledge.size === 0 ? [] : [...knowledge.keys()];
}

function requireKey(value: string, kind: string): void {
  if (value.trim() === "") throw new Error(`${kind} key is required`);
}

function requireTurn(turn: number): void {
  if (turn < 1) throw new Error("Battle AI turn must be positive");
}
