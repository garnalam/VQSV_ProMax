import { BUFF_BANK, DEBUFF_BANK } from "../StatusState";
import {
  BattleAiObservation,
  ItemView,
  SkillView,
  StatusView,
  UnitView,
  type BattleAiEncounterSpec,
} from "./BattleAiObservation";
import { BattleAiActorKey } from "./BattleAiActorKey";
import { BattleAiMemory } from "./BattleAiMemory";
import { BattleAiRulebook, RAINBOW_STATUS_BANK } from "./BattleAiRulebook";
import type { BattleAiUnit } from "./BattleAiUnit";

/** `BattleAiEncounterCatalog.ItemEntry` reduced to what the loadout view is built from. */
export type BattleAiItemEntry = {
  readonly itemKey: string;
  readonly quantity: number;
  readonly useLimit: number;
  readonly eligibleTargets: string;
  readonly phaseGate: string;
};

/** `BattleAiObservationFactory.OwnedUnit`. */
export type OwnedUnit = {
  readonly actorKey: BattleAiActorKey;
  readonly memberSlot: number;
  readonly unit: BattleAiUnit;
  readonly active: boolean;
};

/** `BattleAiObservationFactory.VisibleUnit`. */
export type VisibleUnit = {
  readonly actorKey: BattleAiActorKey;
  readonly unit: BattleAiUnit;
};

/**
 * `BattleAiObservationFactory.Input`.
 *
 * `loadout` is the one field Java does not carry here, because Java's factory reaches the static
 * encounter catalog itself; the Web port passes the row in so that no hidden singleton can disagree
 * with the encounter the caller chose.
 *
 * The constructor keeps Java's normalisation: the turn is clamped to at least 1, an empty opponent
 * list is refused, and `visibleOpponentKey` is the primary opponent — the historical alias the 1v1
 * phase policy still reads for `OPPONENT_NON_DAMAGE_OBSERVED`.
 */
export class BattleAiObservationInput {
  readonly visibleOpponentKey: BattleAiActorKey;

  constructor(
    readonly encounter: BattleAiEncounterSpec,
    readonly turn: number,
    readonly activeActor: BattleAiActorKey,
    readonly ownRoster: readonly OwnedUnit[],
    readonly visibleOpponents: readonly VisibleUnit[],
    readonly memory: BattleAiMemory,
    readonly loadout: readonly BattleAiItemEntry[],
  ) {
    if (visibleOpponents.length === 0) {
      throw new Error("AI observation requires at least one visible opponent");
    }
    this.visibleOpponentKey = visibleOpponents[0].actorKey;
    this.turn = Math.max(1, turn);
  }
}

/** `LietHoaMutationCatalog.EXCLUSIVE_CHARACTERISTIC_TRAIT_KEY`, the form-owned HV-01. */
const LIET_HOA_EXCLUSIVE_TRAIT_KEY = "HV-01";

/** `ThienLuanMutationCatalog.EXCLUSIVE_CHARACTERISTIC_TRAIT_KEY`, the form-owned TL-01. */
const THIEN_LUAN_EXCLUSIVE_TRAIT_KEY = "TL-01";

const LIET_HOA_MUTATION_SPECIES_ID = 274;
const THIEN_LUAN_MUTATION_SPECIES_ID = 275;

/**
 * `vqsv.battle.ai.v2.BattleAiObservationFactory` — the only place live state becomes an observation.
 *
 * Anti-omniscience is enforced here, not politely requested downstream: an opponent's attack, defense
 * and speed are `UNKNOWN_STAT`, its member slot is `-1`, and its traits and skills are whatever memory
 * has revealed, while its HP and its statuses stay visible because the player can see those.
 */
export class BattleAiObservationFactory {
  constructor(private readonly rulebook: BattleAiRulebook) {}

  capture(input: BattleAiObservationInput): BattleAiObservation {
    if (input.encounter.informationPolicy !== "PUBLIC_BATTLE_STATE_V1") {
      throw new Error(`unsupported AI information policy ${input.encounter.informationPolicy}`);
    }
    const own: UnitView[] = [];
    let activeUnit: BattleAiUnit | null = null;
    for (const row of input.ownRoster) {
      own.push(this.ownUnit(row));
      if (row.actorKey.equals(input.activeActor)) activeUnit = row.unit;
    }
    if (activeUnit === null) {
      throw new Error("AI observation active actor is absent from its own roster");
    }

    const opponents = input.visibleOpponents.map((row) =>
      this.visibleOpponent(row.actorKey, row.unit, input.memory, input.turn),
    );
    const items = this.itemViews(input.encounter, input.loadout, activeUnit, input.memory);
    const memoryEvents = input.memory.events(input.turn).map((event) => event.canonical());
    return new BattleAiObservation(
      input.encounter.profileVersion,
      input.encounter.encounterKey,
      input.turn,
      input.encounter.battleFormat,
      input.encounter.intelligenceProfile,
      input.encounter.personaKey,
      input.encounter.informationPolicy,
      input.memory.phaseKey(),
      input.activeActor,
      own,
      opponents,
      items,
      memoryEvents,
      input.memory.turnsSinceSwitch("NPC", input.turn),
      input.memory.consecutiveNonDamageActions(input.activeActor),
    );
  }

  /**
   * The two mutation forms' own characteristic first — they fight with HV-01 and TL-01, never with
   * their workbook row (decided 2026-11-05; Java let the workbook row win) — then
   * `PetDesignTraitMechanics.spec(unit)`, the workbook characteristic a design pet carries, then the
   * species-trait row.
   */
  private speciesTraitKey(unit: BattleAiUnit): string {
    if (unit.speciesId === LIET_HOA_MUTATION_SPECIES_ID) return LIET_HOA_EXCLUSIVE_TRAIT_KEY;
    if (unit.speciesId === THIEN_LUAN_MUTATION_SPECIES_ID) return THIEN_LUAN_EXCLUSIVE_TRAIT_KEY;
    if (unit.designTraitEnabled && unit.speciesTraitId < 0 && unit.characteristicTraitId < 0) {
      const design = this.rulebook.designTraitKey(unit.speciesId);
      if (design !== "") return design;
    }
    return this.rulebook.speciesTraitKey(unit.speciesTraitId);
  }

  private ownUnit(row: OwnedUnit): UnitView {
    const unit = row.unit;
    return new UnitView(
      row.actorKey,
      row.memberSlot,
      this.rulebook.petKeyForSpecies(unit.speciesId),
      unit.speciesId,
      unit.level,
      row.active,
      unit.alive(),
      unit.hp(),
      unit.maxHp(),
      this.rulebook.elementForSpecies(unit.speciesId),
      unit.attack(),
      unit.defense(),
      unit.speed(),
      this.rulebook.physicalTraitKey(unit.physicalTraitId),
      this.speciesTraitKey(unit),
      this.ownSkills(unit),
      this.statuses(unit),
    );
  }

  private visibleOpponent(
    actorKey: BattleAiActorKey,
    unit: BattleAiUnit,
    memory: BattleAiMemory,
    turn: number,
  ): UnitView {
    let physicalTrait = "";
    let speciesTrait = "";
    for (const traitKey of memory.revealedTraitsFor(actorKey, turn)) {
      if (traitKey.startsWith("TC-")) physicalTrait = traitKey;
      else speciesTrait = traitKey;
    }
    return new UnitView(
      actorKey,
      -1,
      this.rulebook.petKeyForSpecies(unit.speciesId),
      unit.speciesId,
      unit.level,
      true,
      unit.alive(),
      unit.hp(),
      unit.maxHp(),
      this.rulebook.elementForSpecies(unit.speciesId),
      BattleAiObservation.UNKNOWN_STAT,
      BattleAiObservation.UNKNOWN_STAT,
      BattleAiObservation.UNKNOWN_STAT,
      physicalTrait,
      speciesTrait,
      this.revealedSkills(actorKey, memory, turn),
      this.statuses(unit),
    );
  }

  private ownSkills(unit: BattleAiUnit): SkillView[] {
    const out: SkillView[] = [];
    for (let slot = 0; slot < unit.skillSlotCount; slot++) {
      const runtimeId = unit.skillAt(slot);
      const record = this.rulebook.unifiedSkill(runtimeId);
      if (runtimeId < 0 || record === undefined) continue;
      const row = this.rulebook.skillRow(runtimeId);
      const currentPp = unit.skillPpAt(slot);
      out.push({
        skillKey: record.stableKey,
        runtimeId,
        currentPp,
        maxPp: row === undefined ? record.pp : row.ppMax,
        targetSide: row === undefined ? record.targetSide : row.targetSide,
        exactPpKnown: true,
        usable: currentPp > 0 && unit.canUseSourceSkillId(runtimeId),
      });
    }
    return out;
  }

  private revealedSkills(actorKey: BattleAiActorKey, memory: BattleAiMemory, turn: number) {
    const out: SkillView[] = [];
    for (const skillKey of memory.revealedSkillsFor(actorKey, turn)) {
      const record = this.rulebook.unifiedSkillByKey(skillKey);
      if (record === undefined) {
        throw new Error(`AI memory references an inactive Skill ${skillKey}`);
      }
      out.push({
        skillKey: record.stableKey,
        runtimeId: record.runtimeId,
        currentPp: BattleAiObservation.UNKNOWN_STAT,
        maxPp: record.pp,
        targetSide: record.targetSide,
        exactPpKnown: false,
        usable: true,
      });
    }
    return out;
  }

  /**
   * The three banks Java walks, in order, with the accessor each bank uses: buffs ask the engine
   * (`buffRemainingActions`/`unifiedBuffStacks`, which resolve producer overrides), debuffs ask the
   * engine for duration but report zero stacks, and the rainbow bank reports its instance verbatim.
   */
  private statuses(unit: BattleAiUnit): StatusView[] {
    const out: StatusView[] = [];
    for (const id of unit.activeStatusIds(BUFF_BANK)) {
      out.push(
        new StatusView(BUFF_BANK, id, unit.buffRemainingActions(id), unit.unifiedBuffStacks(id)),
      );
    }
    for (const id of unit.activeStatusIds(DEBUFF_BANK)) {
      out.push(new StatusView(DEBUFF_BANK, id, unit.debuffRemainingActions(id), 0));
    }
    for (const id of unit.activeStatusIds(RAINBOW_STATUS_BANK)) {
      const instance = unit.statusInstance(RAINBOW_STATUS_BANK, id);
      if (instance !== undefined) {
        out.push(
          new StatusView(RAINBOW_STATUS_BANK, id, instance.remainingActions, instance.stackCount),
        );
      }
    }
    return out;
  }

  private itemViews(
    encounter: BattleAiEncounterSpec,
    loadout: readonly BattleAiItemEntry[],
    activeUnit: BattleAiUnit,
    memory: BattleAiMemory,
  ): ItemView[] {
    if (!encounter.mayUseItems) return [];
    const out: ItemView[] = [];
    for (const item of loadout) {
      const runtimeId = this.rulebook.itemRuntimeId(item.itemKey);
      const allowance = Math.min(item.quantity, item.useLimit);
      const remaining = Math.max(0, allowance - memory.usesOf(item.itemKey));
      const phaseOpen = item.phaseGate === "ANY" || item.phaseGate === memory.phaseKey();
      const targetOpen = item.eligibleTargets === "ACTIVE_SELF";
      const legal =
        remaining > 0 && phaseOpen && targetOpen && activeUnit.validateBattleItem(runtimeId) === -1;
      out.push({
        itemKey: item.itemKey,
        runtimeId,
        eligibleTargets: item.eligibleTargets,
        phaseGate: item.phaseGate,
        remainingUses: remaining,
        legalForActiveActor: legal,
      });
    }
    return out;
  }
}

/** `BattleUnit.hasDangerousControlStatus`, the eight control identities the scorers ask about. */
export function hasDangerousControlStatus(unit: BattleAiUnit): boolean {
  for (const id of [2, 8, 9, 10]) {
    if (unit.hasDebuff(id)) return true;
  }
  for (const id of [0, 3, 4, 6]) {
    if (unit.hasStatus(RAINBOW_STATUS_BANK, id)) return true;
  }
  return false;
}
