import type {
  GameData,
  PackBattleAiActivationReview,
  PackBattleAiCatalog,
  PackBattleAiEncounterRow,
  PackBattleAiMember,
  PackBattleAiPhase,
  PackBattleAiProfile,
  PackBattleAiProfileWeights,
} from "../../../data/GameData";
import {
  type BattleAiEncounterSpec,
  type BattleAiBattleFormat,
  type BattleAiInformationPolicy,
  type BattleAiIntelligenceProfile,
  type BattleAiItemPolicy,
  type BattleAiSwitchPolicy,
} from "./BattleAiObservation";
import type { BattleAiItemEntry } from "./BattleAiObservationFactory";
import { BattleAiPolicyProjection } from "./BattleAiPolicyProjection";
import { NO_POLICY_MODIFIERS, type BattleAiPolicyModifiers } from "./BattleAiPolicyModifiers";
import type { BattleAiPolicyBias } from "./BattleAiPolicyBias";
import type { BattleAiUtilityWeights } from "./BattleAiUtilityWeights";

/** `BattleAiEncounterCatalog.PhaseEntry` — the trigger one authored phase waits for. */
export type BattleAiPhaseEntry = {
  readonly phaseKey: string;
  readonly phaseOrder: number;
  readonly triggerType: string;
  readonly triggerValue: number;
  readonly personaModifier: string;
};

/** Java resolves every TSV column to an enum and the dump prints it as `EnumName.CONSTANT`. */
export function enumName(value: string): string {
  const dot = value.lastIndexOf(".");
  return dot < 0 ? value : value.slice(dot + 1);
}

function modifiersOf(values: Readonly<Record<string, number>>): BattleAiPolicyModifiers {
  const keys = Object.keys(NO_POLICY_MODIFIERS) as (keyof BattleAiPolicyModifiers)[];
  for (const key of keys) {
    if (!(key in values)) throw new Error(`AI policy projection is missing modifier ${key}`);
  }
  return { ...NO_POLICY_MODIFIERS, ...values };
}

/**
 * `BattleAiEncounterCatalog` and `BattleAiPilotPolicyCatalog` together, over the shipped dump.
 *
 * Java keeps the authored encounter rows, the phase rows, the loadout rows and the persona/phase
 * policy table in four loaders that cross-check each other at start-up; the harness already ran those
 * checks before it printed `ai-v2-catalog.json`, and it printed each encounter's persona-plus-phase
 * projection fully merged. So `project` is a lookup here rather than a second composition of the two
 * tables — and the two bindings Java *does* enforce at decision time (a persona row that no longer
 * matches its encounter, and an active phase with no typed policy) are re-checked, not dropped.
 */
const CHALLENGE_CLASSES = ["NPC", "ELITE_NPC", "GYM_TRAINER", "GYM_LEADER"];

export class BattleAiEncounterCatalog {
  private readonly byKey = new Map<string, PackBattleAiEncounterRow>();
  private readonly byDescriptor = new Map<string, PackBattleAiEncounterRow>();

  private constructor(
    private readonly catalog: PackBattleAiCatalog,
    private readonly profiles: Readonly<Record<string, PackBattleAiProfile>>,
  ) {
    for (const row of catalog.encounters) {
      this.byKey.set(row.encounter.encounterKey, row);
      const lock = row.sourceLock;
      if (lock) {
        this.byDescriptor.set(
          `${lock.sceneId}:${lock.roomIndex}:${lock.groupIndex}:${lock.sourceActorId}:${lock.sourceRoster}`,
          row,
        );
      }
    }
  }

  /** The v1 profile rows come from the runtime descriptors, keyed by the same descriptor symbol. */
  static async load(data: GameData): Promise<BattleAiEncounterCatalog> {
    const [catalog, descriptors] = await Promise.all([data.battleAiCatalog(), data.battleEvents()]);
    const profiles: Record<string, PackBattleAiProfile> = {};
    for (const [symbol, event] of Object.entries(descriptors)) profiles[symbol] = event.aiProfile;
    return new BattleAiEncounterCatalog(catalog, profiles);
  }

  get profileVersion(): string {
    return this.catalog.profileVersion;
  }

  encounter(encounterKey: string): PackBattleAiEncounterRow | undefined {
    return this.byKey.get(encounterKey);
  }

  /** `BattleAiEncounterCatalog.byRuntimeDescriptor`, over the roster string the lock carries. */
  encounterForDescriptor(
    sceneId: number,
    roomIndex: number,
    groupIndex: number,
    sourceActorId: number,
    sourceRoster: readonly number[],
  ): PackBattleAiEncounterRow | undefined {
    return this.byDescriptor.get(
      `${sceneId}:${roomIndex}:${groupIndex}:${sourceActorId}:${sourceRoster.join(",")}`,
    );
  }

  /**
   * `BattleNpcProximityGate.indexChallengeActors`: every NPC, elite NPC, gym trainer and gym leader
   * encounter whose source lock names a room actor, grouped by that actor (`scene:room:actor`) with
   * the event groups that fight it. Cầu Vồng (scene 98) keeps its own interactions.
   */
  challengeActors(): Map<string, number[]> {
    const groups = new Map<string, number[]>();
    for (const row of this.catalog.encounters) {
      if (!CHALLENGE_CLASSES.includes(enumName(row.encounter.encounterClass))) continue;
      const lock = row.sourceLock;
      if (!lock || lock.sourceActorId < 0 || lock.sceneId === 98) continue;
      const key = `${lock.sceneId}:${lock.roomIndex}:${lock.sourceActorId}`,
        list = groups.get(key) ?? [];
      if (!list.includes(lock.groupIndex)) list.push(lock.groupIndex);
      groups.set(key, list);
    }
    return groups;
  }

  /** The encounter a runtime descriptor symbol (e.g. "SCENE1_ROOM1_GROUP0_BUNNY") names, if any. */
  keyForDescriptorSymbol(symbol: string): string | undefined {
    for (const [key, row] of this.byKey)
      if (row.sourceLock?.descriptorSymbol === symbol) return key;
    return undefined;
  }

  spec(encounterKey: string): BattleAiEncounterSpec | undefined {
    const row = this.byKey.get(encounterKey);
    return row === undefined ? undefined : toSpec(row, this.catalog.profileVersion);
  }

  items(encounterKey: string): BattleAiItemEntry[] {
    const row = this.byKey.get(encounterKey);
    if (row === undefined) return [];
    return row.items.map((item) => ({
      itemKey: item.itemKey,
      quantity: item.quantity,
      useLimit: item.useLimit,
      eligibleTargets: item.eligibleTargets,
      phaseGate: item.phaseGate,
    }));
  }

  phases(encounterKey: string): BattleAiPhaseEntry[] {
    const row = this.byKey.get(encounterKey);
    if (row === undefined) return [];
    return row.phases.map((phase: PackBattleAiPhase) => ({
      phaseKey: phase.phaseKey,
      phaseOrder: phase.phaseOrder,
      triggerType: enumName(phase.triggerType),
      triggerValue: phase.triggerValue,
      personaModifier: phase.personaModifier,
    }));
  }

  members(encounterKey: string): PackBattleAiMember[] {
    return this.byKey.get(encounterKey)?.members ?? [];
  }

  /** `deck(encounterKey, memberSlot)`, resolved to runtime skill ids; `memberSlot` is 1-based. */
  deck(encounterKey: string, memberSlot: number): readonly number[] {
    return this.byKey.get(encounterKey)?.decks?.[memberSlot - 1] ?? [];
  }

  activationReview(encounterKey: string): PackBattleAiActivationReview | null {
    return this.byKey.get(encounterKey)?.activationReview ?? null;
  }

  /** `BattleAiPilotPolicyCatalog.instance().project`. */
  project(encounter: BattleAiEncounterSpec, phaseKey: string | null): BattleAiPolicyProjection {
    const activePhase = phaseKey === null || phaseKey === "" ? "NONE" : phaseKey;
    const row = this.byKey.get(encounter.encounterKey);
    if (row === undefined) {
      return BattleAiPolicyProjection.uncommissioned(
        encounter.encounterKey,
        encounter.personaKey,
        activePhase,
      );
    }
    const persona = row.projections["NONE"];
    if (persona === undefined || persona.personaKey !== encounter.personaKey) {
      throw new Error(`AI persona binding changed for ${encounter.encounterKey}`);
    }
    const phase = activePhase === "NONE" ? null : (row.projections[activePhase] ?? null);
    if (encounter.mayUsePhasePolicy && activePhase !== "NONE" && phase === null) {
      throw new Error(
        `AI policy has no typed phase policy ${encounter.encounterKey}/${activePhase}`,
      );
    }
    const selected = phase ?? persona;
    return new BattleAiPolicyProjection(
      selected.commissioned,
      encounter.encounterKey,
      selected.personaKey,
      activePhase,
      selected.biases.map(enumName) as BattleAiPolicyBias[],
      selected.personaPreferenceBonus,
      selected.phasePreferenceBonus,
      modifiersOf(selected.modifiers),
    );
  }

  isCommissioned(encounterKey: string): boolean {
    const row = this.byKey.get(encounterKey);
    return row !== undefined && row.projections["NONE"] !== undefined;
  }

  /** `BattleAiUtilityWeights.forProfile`. */
  weights(profile: BattleAiIntelligenceProfile): BattleAiUtilityWeights {
    const row: PackBattleAiProfileWeights | undefined = this.catalog.profileWeights[profile];
    if (row === undefined) throw new Error(`no AI utility weights for profile ${profile}`);
    return {
      immediatePercent: row.immediatePercent,
      survivalPercent: row.survivalPercent,
      setupPercent: row.setupPercent,
      tempoPercent: row.tempoPercent,
      resourcePercent: row.resourcePercent,
      futurePercent: row.futurePercent,
      riskPercent: row.riskPercent,
      repetitionPercent: row.repetitionPercent,
      switchMargin: row.switchMargin,
    };
  }

  /** `BattleAiCatalog.profile` for the descriptor this encounter is locked to. */
  profileForDescriptor(descriptorSymbol: string): PackBattleAiProfile | undefined {
    return this.profiles[descriptorSymbol];
  }
}

/** The authored row, with every `EnumName.CONSTANT` reduced to the constant the decision path reads. */
export function toSpec(
  row: PackBattleAiEncounterRow,
  profileVersion: string,
): BattleAiEncounterSpec {
  const encounter = row.encounter;
  if (encounter.profileVersion !== profileVersion) {
    throw new Error(`AI encounter profile version changed for ${encounter.encounterKey}`);
  }
  return {
    encounterKey: encounter.encounterKey,
    profileVersion: encounter.profileVersion,
    descriptorSymbol: encounter.descriptorSymbol,
    encounterClass: enumName(encounter.encounterClass),
    intelligenceProfile: enumName(encounter.intelligenceProfile) as BattleAiIntelligenceProfile,
    personaKey: encounter.personaKey,
    battleFormat: enumName(encounter.battleFormat) as BattleAiBattleFormat,
    switchPolicy: enumName(encounter.switchPolicy) as BattleAiSwitchPolicy,
    itemPolicy: enumName(encounter.itemPolicy) as BattleAiItemPolicy,
    phasePolicy: enumName(encounter.phasePolicy),
    informationPolicy: enumName(encounter.informationPolicy) as BattleAiInformationPolicy,
    mayUseItems: encounter.mayUseItems,
    maySwitch: encounter.maySwitch,
    mayRevive: encounter.mayRevive,
    mayPreserveAce: encounter.mayPreserveAce,
    mayUsePhasePolicy: encounter.mayUsePhasePolicy,
    memoryHorizon: encounter.memoryHorizon,
    controlledRandomnessBand: encounter.controlledRandomnessBand,
    switchCooldownTurns: encounter.switchCooldownTurns,
    maxConsecutiveNonDamageActions: encounter.maxConsecutiveNonDamageActions,
  };
}
