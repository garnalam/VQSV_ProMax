import { RAINBOW_BANK, type StatusEffects } from "../StatusState";
import type { DesignTraitUnit } from "../DesignTraits";
import { BattleAiRulebook, TIER_LOCK_STATUS_ID } from "./BattleAiRulebook";

/**
 * `BattleUnit` reduced to exactly what the AI decision path is allowed to see.
 *
 * The narrowing is the point. Java hands the observation factory a live `BattleUnit` and the factory
 * reads ten things off it; anything the AI scores is derived from the observation, never from this
 * interface, so an evaluator that reached for a unit here would be smuggling omniscient state past
 * the anti-omniscience boundary the whole profile exists to enforce.
 */
export interface BattleAiUnit {
  readonly speciesId: number;
  readonly level: number;
  /** `BattleUnit.ownerSide`: 0 is the player's side, 1 the enemy's. */
  readonly ownerSide: number;
  readonly physicalTraitId: number;
  readonly speciesTraitId: number;
  readonly characteristicTraitId: number;
  /** `designTraitState.enabled`, which is what makes a design pet a design pet. */
  readonly designTraitEnabled: boolean;
  /** `skillIds.length`; Java's fixed five-slot row. */
  readonly skillSlotCount: number;
  skillAt(slot: number): number;
  skillPpAt(slot: number): number;
  hp(): number;
  maxHp(): number;
  alive(): boolean;
  /** The three `currentStats` the NPC may read about its own side. */
  attack(): number;
  defense(): number;
  speed(): number;
  /** `currentStats[STAT_SIDE_FLAG]`, which only the run-flag item's legality reads. */
  sideFlag(): number;
  activeStatusIds(bank: number): number[];
  /** `statusState.get(bank, id)`, the raw instance fields the rainbow group reports. */
  statusInstance(bank: number, id: number): StatusInstanceView | undefined;
  buffRemainingActions(effectId: number): number;
  unifiedBuffStacks(effectId: number): number;
  debuffRemainingActions(effectId: number): number;
  hasStatus(bank: number, id: number): boolean;
  hasDebuff(effectId: number): boolean;
  hasAnyDebuff(): boolean;
  canUseSourceSkillId(runtimeId: number): boolean;
  validateBattleItem(runtimeId: number): number;

  // ---------------------------------------------------------------- the source-v1 engine's reads

  /** `currentStats[STAT_HP] * 100 / max(1, baseStats[STAT_HP])`, i.e. Java's truncating percent. */
  hpPercentValue(): number;
  /** `BattleUnit.activeBuffCount`: bank 0 over the sixteen legacy rows only. */
  activeBuffCount(): number;
  /** `BattleUnit.activeDebuffCount`: the eleven legacy debuffs plus every rainbow identity. */
  activeDebuffCount(): number;
  /** `BattleUnit.hasBuff`, which sees the whole bank, not the sixteen rows `activeBuffCount` walks. */
  hasBuff(effectId: number): boolean;
  /** `BattleUnit.hasSemanticStatus`, the engine's own alias table. */
  hasSemanticStatus(semanticKey: string): boolean;
  /** `baseStats[STAT_DEFENSE]`, the stat a badge passive's target-defense percent scales. */
  baseDefense(): number;
  /** `BattleUnit.sourcePassiveDamagePercent`: the player-side badge passive that lifts outgoing damage. */
  sourcePassiveDamagePercent(): number;
  /** `BattleUnit.sourcePassiveTargetDefensePercent`: the badge passive that lifts this unit's defense. */
  sourcePassiveTargetDefensePercent(): number;
  /** `BattleUnit.hasSkillPp`: a slot the row still has a skill in and PP left to spend. */
  hasSkillPp(slot: number): boolean;
  /** `BattleUnit.skillPpForId`: the first slot carrying this id, `0` when none does. */
  skillPpForId(runtimeId: number): number;
  /** `BattleUnit.totalSkillPpValue`: the PP still in the row, skipping the empty slots. */
  totalSkillPpValue(): number;
  /** `BattleUnit.usableSkillCount`: the slots the same three gates let through. */
  usableSkillCount(): number;
  /**
   * `BattleUnit.skillElementRelationTo` and `elementRelationTo`: `0` the attacker's element beats the
   * defender's, `1` the reverse, `-1` neither. A unified skill fights as its own element family.
   */
  skillElementRelationTo(target: BattleAiUnit, runtimeId: number): number;
  elementRelationTo(target: BattleAiUnit): number;
  /**
   * `BattleUnit.signatureState.opponent`, the live rival a `target_is_charmed_or_asleep` condition
   * reads instead of the unit it was handed. A unit with no signature state answers `null`.
   */
  signatureOpponent(): BattleAiUnit | null;
}

/** `StatusInstance` reduced to the two fields the status view carries. */
export type StatusInstanceView = {
  remainingActions: number;
  stackCount: number;
};

/**
 * The combatant the running battle actually owns: a `DesignTraitUnit` plus the level the roster gave
 * it. This is the only adapter the live runtime needs; the parity grader builds the same view from a
 * golden row's numbers instead.
 */
export class LiveBattleAiUnit implements BattleAiUnit {
  constructor(
    private readonly unit: DesignTraitUnit,
    readonly level: number,
    private readonly effects: StatusEffects,
    private readonly rulebook: BattleAiRulebook,
  ) {}

  get speciesId(): number {
    return this.unit.speciesId;
  }

  get ownerSide(): number {
    return this.unit.ownerSide;
  }

  get physicalTraitId(): number {
    return this.unit.physicalTraitId;
  }

  get speciesTraitId(): number {
    return this.unit.speciesTraitId;
  }

  get characteristicTraitId(): number {
    return this.unit.characteristicTraitId;
  }

  get designTraitEnabled(): boolean {
    return this.unit.designTraitState.enabled;
  }

  get skillSlotCount(): number {
    return this.unit.skillIds.length;
  }

  skillAt(slot: number): number {
    return this.unit.skillIds[slot];
  }

  skillPpAt(slot: number): number {
    return this.unit.skillPp[slot];
  }

  hp(): number {
    return this.unit.hp();
  }

  maxHp(): number {
    return this.unit.maxHp();
  }

  alive(): boolean {
    return this.unit.hp() > 0;
  }

  attack(): number {
    return this.unit.currentStats.attack;
  }

  defense(): number {
    return this.unit.currentStats.defense;
  }

  speed(): number {
    return this.unit.currentStats.speed;
  }

  /**
   * The web battle runtime has no side-flag column yet — the run-flag item that reads it is not
   * implemented — so the field answers as the empty column Java starts a fresh unit with.
   */
  sideFlag(): number {
    return 0;
  }

  activeStatusIds(bank: number): number[] {
    return this.unit.activeStatusIds(bank);
  }

  statusInstance(bank: number, id: number): StatusInstanceView | undefined {
    const instance = this.unit.statuses.get(bank, id);
    return instance === undefined
      ? undefined
      : { remainingActions: instance.remainingActions, stackCount: instance.stackCount };
  }

  buffRemainingActions(effectId: number): number {
    return this.effects.buffRemainingActions(this.unit, effectId);
  }

  unifiedBuffStacks(effectId: number): number {
    return this.effects.unifiedBuffStacks(this.unit, effectId);
  }

  debuffRemainingActions(effectId: number): number {
    return this.effects.debuffRemainingActions(this.unit, effectId);
  }

  hasStatus(bank: number, id: number): boolean {
    return this.unit.hasStatus(bank, id);
  }

  hasDebuff(effectId: number): boolean {
    return this.unit.hasDebuff(effectId);
  }

  hasAnyDebuff(): boolean {
    for (let id = 0; id < LIET_HOA_DEBUFF_COUNT; id++) {
      if (this.unit.hasDebuff(id)) return true;
    }
    return this.unit.statuses.count(RAINBOW_BANK) > 0;
  }

  /** `BattleUnit.canUseSourceSkillId`, in Java's own order. */
  canUseSourceSkillId(runtimeId: number): boolean {
    const row = this.rulebook.skillRow(runtimeId);
    if (row === undefined) return false;
    const record = this.rulebook.unifiedSkill(runtimeId);
    if (record !== undefined) {
      const allowed = this.rulebook.mayUseSignatureSkill(record, {
        petKey: this.rulebook.petKeyForSpecies(this.unit.speciesId),
        level: this.level,
        ownerSide: this.unit.ownerSide,
        isTanNguyetLongMa: this.unit.speciesId === TAN_NGUYET_LONG_MA_SPECIES_ID,
        alive: this.alive(),
        hp: this.hp(),
        maxHp: this.maxHp(),
      });
      if (!allowed) return false;
    }
    // `rainbowCharmSeal`: Kỹ năng Phong Bế replaces the tier test with its sealed slots.
    if (this.unit.rainbowCharmSealed()) {
      for (let slot = 0; slot < this.unit.rainbowCharmSealedSkillSlots; slot++)
        if (this.unit.skillIds[slot] === runtimeId) return false;
      return true;
    }
    if (
      !this.rulebook.canUseSkillTier(
        this.unit.hasStatus(RAINBOW_BANK, TIER_LOCK_STATUS_ID),
        row.learnTier,
      )
    ) {
      return false;
    }
    return true;
  }

  /** `BattleUnit.validateBattleItem`, `-1` meaning legal. */
  validateBattleItem(runtimeId: number): number {
    const behavior = this.rulebook.itemBehavior(runtimeId);
    if (!this.alive() && behavior !== 4) return 8;
    switch (behavior) {
      case 0:
        return 6;
      case 1:
        return this.hp() === this.maxHp() ? 2 : -1;
      case 2:
        return this.allSkillPpFull() ? 3 : -1;
      case 3: {
        const hpCode = this.hp() === this.maxHp() || !this.alive() ? 2 : -1;
        if (!this.allSkillPpFull()) return -1;
        return hpCode === 2 ? 7 : -1;
      }
      case 4:
        return this.alive() ? 1 : -1;
      case 5:
        return this.hasAnyDebuff() ? -1 : 4;
      case 6:
        return this.sideFlag() >= 2 ? 5 : -1;
      default:
        return -1;
    }
  }

  /** `BattleUnit.allSkillPpFull`, including the `-1` slot it skips and the missing row it reads as 0. */
  private allSkillPpFull(): boolean {
    for (let slot = 0; slot < this.unit.skillIds.length; slot++) {
      const skillId = this.unit.skillIds[slot];
      if (skillId === -1) continue;
      const row = this.rulebook.skillRow(skillId);
      const maximum = row === undefined ? 0 : row.ppMax;
      if (this.unit.skillPp[slot] < maximum) return false;
    }
    return true;
  }

  hpPercentValue(): number {
    return Math.trunc((this.unit.hp() * 100) / Math.max(1, this.unit.maxHp()));
  }

  activeBuffCount(): number {
    return this.unit.activeBuffCount();
  }

  activeDebuffCount(): number {
    return this.unit.activeDebuffCount();
  }

  hasBuff(effectId: number): boolean {
    return this.unit.hasBuff(effectId);
  }

  hasSemanticStatus(semanticKey: string): boolean {
    return this.unit.hasSemanticStatus(semanticKey);
  }

  hasSkillPp(slot: number): boolean {
    return (
      slot >= 0 &&
      slot < this.unit.skillIds.length &&
      this.unit.skillIds[slot] !== -1 &&
      this.unit.skillPp[slot] > 0
    );
  }

  skillPpForId(runtimeId: number): number {
    const slot = this.unit.skillIds.indexOf(runtimeId);
    return slot < 0 ? 0 : Math.max(0, this.unit.skillPp[slot]);
  }

  baseDefense(): number {
    return this.unit.baseStats.defense;
  }

  /** `BattleUnit.sourcePassiveDamagePercent`: Lôi Điện on a player unit, 0 everywhere else. */
  sourcePassiveDamagePercent(): number {
    return this.unit.sourcePassiveDamagePercent();
  }

  /** `BattleUnit.sourcePassiveTargetDefensePercent`: Hỏa Phong on a player unit. */
  sourcePassiveTargetDefensePercent(): number {
    return this.unit.sourcePassiveTargetDefensePercent();
  }

  totalSkillPpValue(): number {
    let total = 0;
    for (let slot = 0; slot < this.unit.skillIds.length; slot++) {
      if (this.unit.skillIds[slot] !== -1) total += Math.max(0, this.unit.skillPp[slot]);
    }
    return total;
  }

  usableSkillCount(): number {
    let count = 0;
    for (let slot = 0; slot < this.unit.skillIds.length; slot++) {
      const skillId = this.unit.skillIds[slot];
      if (skillId >= 0 && this.unit.skillPp[slot] > 0 && this.canUseSourceSkillId(skillId)) count++;
    }
    return count;
  }

  skillElementRelationTo(target: BattleAiUnit, runtimeId: number): number {
    return this.rulebook.elementRelationTo(this.unit.speciesId, target.speciesId, runtimeId);
  }

  elementRelationTo(target: BattleAiUnit): number {
    return this.rulebook.elementRelationTo(this.unit.speciesId, target.speciesId);
  }

  /**
   * `BattleUnit.signatureState.opponent`. The rig's units and a Liệt Hỏa pet both have no signature
   * state, and Java's `condition` treats a `null` opponent as "no answer", which is what `null` is here.
   */
  signatureOpponent(): BattleAiUnit | null {
    const opponent = this.unit.signatureState.opponent;
    return opponent === undefined || opponent === null
      ? null
      : new LiveBattleAiUnit(opponent, this.level, this.effects, this.rulebook);
  }
}

/** `LietHoaStatusCatalog.DEBUFF_COUNT`, the width of the Liệt Hỏa debuff row block. */
export const LIET_HOA_DEBUFF_COUNT = 11;

/** `TanNguyetLongMaCatalog.RUNTIME_ID`, the one species whose own-side signature is refused. */
export const TAN_NGUYET_LONG_MA_SPECIES_ID = 278;
