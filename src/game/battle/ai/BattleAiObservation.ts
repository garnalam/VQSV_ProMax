import { BattleAiActorKey } from "./BattleAiActorKey";

/** The authored enums the decision path reads, as the pack's resolved `EnumName.CONSTANT` tails. */
export type BattleAiIntelligenceProfile =
  "INSTINCT" | "BASIC" | "TACTICAL" | "STRATEGIST" | "ADAPTIVE_BOSS";
export type BattleAiBattleFormat = "SINGLE" | "SEQUENTIAL_ROSTER" | "SIMULTANEOUS_2V2";
export type BattleAiInformationPolicy = "PUBLIC_BATTLE_STATE_V1";
export type BattleAiSwitchPolicy = "NONE" | "UTILITY";
export type BattleAiItemPolicy = "NONE" | "AUTHORED_LOADOUT";
/**
 * `EncounterClass` and `PhasePolicy` are authored lists the decision path only carries around — the
 * evaluator reads a phase *key*, never a phase policy constant — so they stay open here instead of
 * freezing eleven names that a new authored battle would immediately outgrow.
 */
export type BattleAiEncounterClass = string;
export type BattleAiPhasePolicy = string;

/** `BattleAiEncounterCatalog.EncounterSpec` reduced to what the decision path consumes. */
export type BattleAiEncounterSpec = {
  readonly encounterKey: string;
  readonly profileVersion: string;
  readonly descriptorSymbol: string;
  readonly encounterClass: BattleAiEncounterClass;
  readonly intelligenceProfile: BattleAiIntelligenceProfile;
  readonly personaKey: string;
  readonly battleFormat: BattleAiBattleFormat;
  readonly switchPolicy: BattleAiSwitchPolicy;
  readonly itemPolicy: BattleAiItemPolicy;
  readonly phasePolicy: BattleAiPhasePolicy;
  readonly informationPolicy: BattleAiInformationPolicy;
  readonly mayUseItems: boolean;
  readonly maySwitch: boolean;
  readonly mayRevive: boolean;
  readonly mayPreserveAce: boolean;
  readonly mayUsePhasePolicy: boolean;
  readonly memoryHorizon: number;
  readonly controlledRandomnessBand: number;
  readonly switchCooldownTurns: number;
  readonly maxConsecutiveNonDamageActions: number;
};

/** `BattleAiObservation.StatusView`. */
export class StatusView {
  readonly remainingActions: number;
  readonly stacks: number;

  constructor(
    readonly bank: number,
    readonly effectId: number,
    remainingActions: number,
    stacks: number,
  ) {
    this.remainingActions = Math.max(0, remainingActions);
    this.stacks = Math.max(0, stacks);
  }

  /**
   * `stableKey()`: the legacy BUFF-/DEBUFF- name. The rainbow bank is not a fourth prefix — Java's
   * ternary reports it as a debuff, and that is the text the shadow fingerprint hashes.
   */
  stableKey(): string {
    return `${this.bank === 0 ? "BUFF" : "DEBUFF"}-${String(this.effectId).padStart(2, "0")}`;
  }
}

/** `BattleAiObservation.SkillView`. */
export type SkillView = {
  readonly skillKey: string;
  readonly runtimeId: number;
  readonly currentPp: number;
  readonly maxPp: number;
  readonly targetSide: number;
  readonly exactPpKnown: boolean;
  readonly usable: boolean;
};

/** `BattleAiObservation.ItemView`. */
export type ItemView = {
  readonly itemKey: string;
  readonly runtimeId: number;
  readonly eligibleTargets: string;
  readonly phaseGate: string;
  readonly remainingUses: number;
  readonly legalForActiveActor: boolean;
};

/** `BattleAiObservation.UnitView`, with the clamps the Java constructor applies. */
export class UnitView {
  readonly level: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly hpPercent: number;
  readonly physicalTraitKey: string;
  readonly speciesTraitKey: string;

  constructor(
    readonly actorKey: BattleAiActorKey,
    readonly memberSlot: number,
    readonly petKey: string,
    readonly speciesId: number,
    level: number,
    readonly active: boolean,
    readonly alive: boolean,
    hp: number,
    maxHp: number,
    readonly combatElementId: number,
    readonly attack: number,
    readonly defense: number,
    readonly agility: number,
    physicalTraitKey: string,
    speciesTraitKey: string,
    readonly skills: readonly SkillView[],
    readonly statuses: readonly StatusView[],
  ) {
    this.level = Math.max(1, level);
    this.hp = Math.max(0, hp);
    this.maxHp = Math.max(1, maxHp);
    this.hpPercent = Math.max(0, Math.min(100, Math.trunc((this.hp * 100) / this.maxHp)));
    this.physicalTraitKey = physicalTraitKey ?? "";
    this.speciesTraitKey = speciesTraitKey ?? "";
  }
}

/**
 * `vqsv.battle.ai.v2.BattleAiObservation` — the immutable public-information snapshot.
 *
 * Anti-omniscience is the point: an opponent's stats read `UNKNOWN_STAT` and its skill list is only
 * what memory has revealed, so a scorer that reaches for a live unit instead of this view is wrong.
 */
export class BattleAiObservation {
  static readonly UNKNOWN_STAT = -1;

  constructor(
    readonly profileVersion: string,
    readonly encounterKey: string,
    readonly turn: number,
    readonly battleFormat: BattleAiBattleFormat,
    readonly intelligenceProfile: BattleAiIntelligenceProfile,
    readonly personaKey: string,
    readonly informationPolicy: BattleAiInformationPolicy,
    readonly phaseKey: string,
    readonly activeActor: BattleAiActorKey,
    readonly ownRoster: readonly UnitView[],
    readonly visibleOpponents: readonly UnitView[],
    readonly itemLoadout: readonly ItemView[],
    readonly memoryEvents: readonly string[],
    readonly turnsSinceNpcSwitch: number,
    readonly consecutiveNonDamageActions: number,
  ) {}

  activeOwnUnit(): UnitView | null {
    return this.ownRoster.find((unit) => unit.actorKey.equals(this.activeActor)) ?? null;
  }
}
