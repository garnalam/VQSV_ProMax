import type {
  GameData,
  PackBuffStorage,
  PackBuffStoredValue,
  PackDebuffProducer,
  PackDebuffRule,
  PackItem,
  PackSkillRow,
  PackStatus,
  PackStatusMechanics,
} from "../../data/GameData";
import { HeldItems, NO_HELD_ITEM } from "./HeldItems";
import { NO_BADGE_PROFILE, type BattleBadgeProfile } from "./BattleBadges";
import { isPostSkillMode, type PostSkillRoute } from "./BattleActionEngine";

/** `LietHoaStatusCatalog.BUFF_BANK`. */
export const BUFF_BANK = 0;
/** `LietHoaStatusCatalog.DEBUFF_BANK`. */
export const DEBUFF_BANK = 1;
/** `RainbowStatusCatalog.DEBUFF_BANK`: the Cầu Vồng identities, which are all debuffs. */
export const RAINBOW_BANK = 2;

/** `LietHoaStatusCatalog.BUFF_COUNT`: the Liệt Hỏa half of bank 0. */
const LIET_HOA_BUFF_COUNT = 15;
/** `LietHoaStatusCatalog.DEBUFF_COUNT`. */
const DEBUFF_COUNT = 11;
/**
 * `SignatureStatusCatalog.capacity()`: bank 0 runs to 22 because the seven signature identities the
 * characteristics plant (shield 15, counter 16, charge 17, reserve 18, rage 19, speed 20, heal
 * charge 21) live above the Liệt Hỏa half.
 */
const SIGNATURE_CAPACITY = 22;
/** `RainbowStatusCatalog.SOURCE_ID_CAPACITY`. */
const RAINBOW_CAPACITY = 9;
/**
 * `BattleUnit.buffSlots` is `short[16][5]`, one row short of the bank's capacity: the shield at id 15
 * still has a legacy row, the six identities above it do not, and `projectBank` skips an id whose row
 * is not there.
 */
const BUFF_LEGACY_ROWS = 16;
/**
 * `RainbowStatusCatalog.BURN_RESERVED_ID`, the identity `BattleUnit.synchronizeTraitCanonicalStatuses`
 * reads canonical BURN from. The catalog registers no definition for it, so the read is always false.
 */
export const BURN_RESERVED_ID = 1;
/** `RainbowStatusCatalog.PARALYSIS_ALIAS_ID` (2), the second id the source catalog never registers. */
const RAINBOW_UNREGISTERED_IDS = [BURN_RESERVED_ID, 2];
/** `RainbowControlMechanics.TIER_LOCK_ID`: Phong Bế, the lock Kỹ năng Phong Bế plants. */
export const TIER_LOCK_ID = 6;
/** `SignatureStatusCatalog` id 15, `semanticKey` "shield": the only bank-0 identity that absorbs. */
export const SHIELD_STATUS_ID = 15;
/** `RainbowStatusCatalog` id 4, "bound": the identity `projectAgility` reads off the base speed. */
const BOUND_STATUS_ID = 4;
/** `RainbowStatusCatalog.VQSV4_BLEEDING_ID`: the bleed the round-end pass pays out of max HP. */
export const RAINBOW_BLEEDING_STATUS_ID = 7;

/**
 * `SignatureSkillMechanics.isOwned`: a status whose source skill is a signature skill belongs to that
 * skill's own mechanic, and so does one a characteristic planted — a design trait puts its status under
 * `3000 + speciesId` and species run to 279. Both ranges are the owner's, so the round-end pass and the
 * bleeding tick leave the instance to it instead of ageing it.
 *
 * The probe's dummy is species 280, whose `3280` sits deliberately outside both ranges and is therefore
 * left to the ordinary lifecycle.
 */
export function signatureSkillOwned(instance: StatusInstance | undefined): boolean {
  if (!instance) return false;
  const skill = instance.sourceSkillId;
  return (skill >= 1000 && skill < 1258) || (skill >= 3000 && skill < 3280);
}

export type StatusKind = "BUFF" | "DEBUFF";
export type StatusTickPhase =
  "ACTIVE_OWNER_ROUND" | "OWNER_TURN_END" | "ACTION_TRIGGER" | "INSTANT";
export type StatusRefreshPolicy =
  "REPLACE_AND_REFRESH" | "STACK_AND_REFRESH" | "TRANSFER" | "INSTANT";
export type StatusConsumePolicy = "DURATION" | "ACTION" | "CHARGE" | "INSTANT";

/** One status identity, as `battle/statuses.json` carries it and the engine reads it. */
export type StatusDefinition = {
  stableKey: string;
  semanticKey: string;
  displayName: string;
  kind: StatusKind;
  sourceBank: number;
  sourceNumericId: number;
  stackCap: number;
  tickPhase: StatusTickPhase;
  refreshPolicy: StatusRefreshPolicy;
  consumePolicy: StatusConsumePolicy;
};

/** Java's `short` clamp, which every legacy status column and PP slot goes through. */
export function toShort(value: number): number {
  return Math.max(-32768, Math.min(32767, Math.trunc(value)));
}

/** `VqsvBattleEffectLogic.percentOf`: Java's integer division, floored at zero. */
function percentOf(base: number, percent: number): number {
  return Math.max(0, Math.trunc((base * Math.max(0, percent)) / 100));
}

/** `VqsvBattleEffectLogic.exactRollPasses` and `BattleActionEngine.passesExactRoll`. */
export function exactRollPasses(roll: number, chance: number): boolean {
  return roll >= 0 && roll < Math.max(0, Math.min(100, chance));
}

/** `BattleActionEngine.passesInclusiveRoll`: the roll the held-item leech is graded on. */
export function inclusiveRollPasses(roll: number, chance: number): boolean {
  return roll <= chance;
}

/** The pack spells each policy as its Java enum constant, `TickPhase.ACTION_TRIGGER`. */
function enumName<T extends string>(value: string, prefix: string, allowed: readonly T[]): T {
  const name = value.slice(value.indexOf(".") + 1) as T;
  if (!allowed.includes(name)) {
    throw new Error(`${prefix} has a value this port does not carry: ${value}`);
  }
  return name;
}

/**
 * The frozen status identities, indexed the way the engine indexes them: by bank and numeric id.
 *
 * All three banks are carried: bank 0 holds the fifteen Liệt Hỏa buffs and then the seven signature
 * identities from id 15 up, bank 1 the eleven Liệt Hỏa debuffs, and bank 2 the seven Cầu Vồng ones.
 * Every id `UnifiedStatusCatalog` routes to must be in `battle/statuses.json`, so a status the engine
 * can plant is never silently dropped here.
 */
export class StatusCatalog {
  private constructor(private readonly byBank: StatusDefinition[][]) {}

  static async load(data: GameData): Promise<StatusCatalog> {
    return StatusCatalog.from(await data.statuses());
  }

  static from(statuses: readonly PackStatus[]): StatusCatalog {
    const byBank: StatusDefinition[][] = [
      new Array<StatusDefinition>(SIGNATURE_CAPACITY).fill(null as never),
      new Array<StatusDefinition>(DEBUFF_COUNT).fill(null as never),
      new Array<StatusDefinition>(RAINBOW_CAPACITY).fill(null as never),
    ];
    for (const status of statuses) {
      const definition = StatusCatalog.define(status);
      if (definition === null) continue;
      if (byBank[definition.sourceBank][definition.sourceNumericId]) {
        throw new Error(`duplicate status identity ${definition.stableKey}`);
      }
      byBank[definition.sourceBank][definition.sourceNumericId] = definition;
    }
    for (const [bank, capacity] of [
      [BUFF_BANK, SIGNATURE_CAPACITY],
      [DEBUFF_BANK, DEBUFF_COUNT],
      [RAINBOW_BANK, RAINBOW_CAPACITY],
    ]) {
      for (let id = 0; id < capacity; id++) {
        // Hóa Đá's burn slot and the paralysis alias are left empty, as in the source catalog.
        if (bank === RAINBOW_BANK && RAINBOW_UNREGISTERED_IDS.includes(id)) {
          if (byBank[bank][id])
            throw new Error(`battle/statuses.json registers reserved ${bank}/${id}`);
          continue;
        }
        if (!byBank[bank][id]) {
          throw new Error(`battle/statuses.json is missing the status ${bank}/${id}`);
        }
      }
    }
    return new StatusCatalog(byBank);
  }

  /** The definition for one bank and id, or undefined where the source carries none. */
  definition(bank: number, id: number): StatusDefinition | undefined {
    return this.byBank[bank]?.[id] ?? undefined;
  }

  /** `UnifiedStatusCatalog.canonicalize`. */
  canonicalize(definition: StatusDefinition): StatusDefinition {
    const canonical = this.definition(definition.sourceBank, definition.sourceNumericId);
    if (!canonical || canonical.stableKey !== definition.stableKey) {
      throw new Error(`status stable/numeric identity mismatch for ${definition.stableKey}`);
    }
    return canonical;
  }

  private static define(status: PackStatus): StatusDefinition | null {
    const bank = status.sourceBank;
    const id = status.sourceNumericId;
    const capacity =
      bank === BUFF_BANK
        ? SIGNATURE_CAPACITY
        : bank === DEBUFF_BANK
          ? DEBUFF_COUNT
          : bank === RAINBOW_BANK
            ? RAINBOW_CAPACITY
            : 0;
    if (id < 0 || id >= capacity) return null;
    return {
      stableKey: status.stableKey,
      semanticKey: status.semanticKey,
      displayName: status.displayName,
      kind: enumName<StatusKind>(status.kind, "status kind", ["BUFF", "DEBUFF"]),
      sourceBank: bank,
      sourceNumericId: id,
      // `StatusDefinition` floors the cap at one, so a dumped zero still means one stack.
      stackCap: Math.max(1, status.stackCap),
      tickPhase: enumName<StatusTickPhase>(status.tickPhase, "tick phase", [
        "ACTIVE_OWNER_ROUND",
        "OWNER_TURN_END",
        "ACTION_TRIGGER",
        "INSTANT",
      ]),
      refreshPolicy: enumName<StatusRefreshPolicy>(status.refreshPolicy, "refresh policy", [
        "REPLACE_AND_REFRESH",
        "STACK_AND_REFRESH",
        "TRANSFER",
        "INSTANT",
      ]),
      consumePolicy: enumName<StatusConsumePolicy>(status.consumePolicy, "consume policy", [
        "DURATION",
        "ACTION",
        "CHARGE",
        "INSTANT",
      ]),
    };
  }
}

/**
 * `vqsv.status.StatusInstance`: the typed state of one status on one unit. The constructor clamps
 * exactly where Java clamps — turns, actions and stacks — and leaves the two magnitudes alone,
 * because a magnitude is a number the engine computed and stores verbatim.
 */
export class StatusInstance {
  remainingTurns: number;
  remainingActions: number;
  primaryValue: number;
  secondaryValue: number;
  stackCount: number;
  sourceSide: number;
  sourceSlot: number;
  sourceSkillId: number;
  flags: number;

  constructor(
    readonly definition: StatusDefinition,
    remainingTurns: number,
    remainingActions: number,
    primaryValue: number,
    secondaryValue: number,
    stackCount: number,
    sourceSide: number,
    sourceSlot: number,
    sourceSkillId: number,
    flags: number,
  ) {
    this.remainingTurns = Math.max(0, remainingTurns);
    this.remainingActions = Math.max(0, remainingActions);
    this.primaryValue = primaryValue;
    this.secondaryValue = secondaryValue;
    this.stackCount = Math.max(1, stackCount);
    this.sourceSide = sourceSide;
    this.sourceSlot = sourceSlot;
    this.sourceSkillId = sourceSkillId;
    this.flags = flags;
  }

  copy(): StatusInstance {
    return new StatusInstance(
      this.definition,
      this.remainingTurns,
      this.remainingActions,
      this.primaryValue,
      this.secondaryValue,
      this.stackCount,
      this.sourceSide,
      this.sourceSlot,
      this.sourceSkillId,
      this.flags,
    );
  }

  /** `StatusDefinition.durableOutsideBattle`: only a debuff survives leaving the battle. */
  durableOutsideBattle(): boolean {
    return this.definition.kind === "DEBUFF";
  }
}

/** `vqsv.status.StatusState`: the typed owner of every status on one unit. */
export class StatusState {
  private readonly instances: (StatusInstance | null)[][];

  constructor(private readonly catalog: StatusCatalog) {
    this.instances = [
      new Array<StatusInstance | null>(SIGNATURE_CAPACITY).fill(null),
      new Array<StatusInstance | null>(DEBUFF_COUNT).fill(null),
      new Array<StatusInstance | null>(RAINBOW_CAPACITY).fill(null),
    ];
  }

  has(bank: number, id: number): boolean {
    return this.get(bank, id) !== undefined;
  }

  get(bank: number, id: number): StatusInstance | undefined {
    return this.instances[bank]?.[id] ?? undefined;
  }

  /**
   * Whether a status the unit does not hold yet may take hold at all. A characteristic that makes its
   * pet immune (Thiên Luân Kim Thân) answers here, so every producer — a skill, a signature, a Cầu
   * Vồng debuff or another pet's characteristic — is refused the same way.
   */
  admit?: (definition: StatusDefinition) => boolean;

  /** Java stores a copy under the canonical definition, so a caller cannot mutate what is held. */
  put(instance: StatusInstance): void {
    const canonical = this.catalog.canonicalize(instance.definition);
    if (
      this.admit &&
      !this.has(canonical.sourceBank, canonical.sourceNumericId) &&
      !this.admit(canonical)
    )
      return;
    this.instances[canonical.sourceBank][canonical.sourceNumericId] = new StatusInstance(
      canonical,
      instance.remainingTurns,
      instance.remainingActions,
      instance.primaryValue,
      instance.secondaryValue,
      instance.stackCount,
      instance.sourceSide,
      instance.sourceSlot,
      instance.sourceSkillId,
      instance.flags,
    );
  }

  remove(bank: number, id: number): boolean {
    if (!this.instances[bank]?.[id]) return false;
    this.instances[bank][id] = null;
    return true;
  }

  clearBank(bank: number): void {
    this.instances[bank]?.fill(null);
  }

  clearAll(): void {
    for (let bank = 0; bank < this.instances.length; bank++) this.clearBank(bank);
  }

  count(bank: number): number {
    return this.activeIds(bank).length;
  }

  /** `StatusState.activeIds`: ascending, because the engine walks a bank in id order. */
  activeIds(bank: number): number[] {
    const ids: number[] = [];
    const row = this.instances[bank];
    if (!row) return ids;
    for (let id = 0; id < row.length; id++) {
      if (row[id]) ids.push(id);
    }
    return ids;
  }

  snapshot(bank: number): StatusInstance[] {
    return this.activeIds(bank).map((id) => this.instances[bank][id]!.copy());
  }
}

/** The four stats a unit is built with. `hp` is the maximum, which is also the starting HP. */
export type StatusUnitBase = { hp: number; attack: number; defense: number; speed: number };

/**
 * The three stats `restoreMutableStats` resets and the projection recomputes: Java indexes them 2, 3
 * and 4 in `currentStats`, and `PetDesignTraitMechanics.statBonus` answers by that index.
 */
export type MutableStat = "attack" | "defense" | "speed";

export type StatusUnitSeed = {
  speciesId: number;
  /** 0 is the player's side, 1 the enemy's; the debuff duration halving passive only reads side 0. */
  ownerSide: number;
  formationSlot: number;
  base: StatusUnitBase;
  /** `PetState.heldEquipmentId`; omitted is the same as `NO_HELD_ITEM`. */
  heldItemId?: number;
};

/**
 * `BattleUnit.hasSemanticStatus`'s alias table: a semantic name to the bank and id that carries it.
 * The eleven Liệt Hỏa debuffs and the two Liệt Hỏa buffs are spelled by id, the Cầu Vồng identities by
 * their own bank, and a name the engine does not list answers false rather than throwing.
 */
const SEMANTIC_STATUS_ALIASES: Record<string, readonly [bank: number, id: number]> = {
  seeded_damage: [DEBUFF_BANK, 0],
  dazed: [DEBUFF_BANK, 1],
  entangled: [DEBUFF_BANK, 2],
  accuracy_down: [DEBUFF_BANK, 4],
  agility_down: [DEBUFF_BANK, 5],
  damage_down: [DEBUFF_BANK, 6],
  defense_down: [DEBUFF_BANK, 7],
  ghost_mirror: [DEBUFF_BANK, 8],
  confusion: [DEBUFF_BANK, 9],
  paralysis: [DEBUFF_BANK, 10],
  petrified: [RAINBOW_BANK, 0],
  charmed: [RAINBOW_BANK, 3],
  bound: [RAINBOW_BANK, 4],
  corrosion: [RAINBOW_BANK, 5],
  bleeding: [RAINBOW_BANK, 7],
  sleep: [RAINBOW_BANK, 8],
  agility_up: [BUFF_BANK, 7],
  strength_up: [BUFF_BANK, 10],
};

/**
 * One combatant, reduced to what the status lifecycle touches: its base stats, its projected stats,
 * its HP, its statuses and the item it holds.
 *
 * A team charm (`RainbowCharmBattleState.applyUnitModifiers`) moves the same stat projection the
 * statuses and the held item move: Thép thiết cốt's defense percent is added in front of the item and
 * the item in front of the buff terms, exactly where `reapplyActiveStatEffects` puts it.
 *
 * It also carries the engine's legacy five-column rows, one per status id, as real state. They are
 * not derived from the typed statuses: a clear only zeroes the active flag in column 4 and leaves
 * the other four columns holding the last values the status had, and the stat projection reads those
 * columns whenever the typed state says the status is there. Deriving them would lose the residue the
 * engine itself keeps.
 */
export class StatusUnit {
  readonly speciesId: number;
  readonly ownerSide: number;
  /** `BattleUnit.formationSlot`: reassigned when a pet takes a 2v2 slot (`startReplacement`). */
  formationSlot: number;
  readonly baseStats: StatusUnitBase;
  readonly currentStats: StatusUnitBase;
  readonly statuses: StatusState;
  /**
   * The item this unit holds, which the engine stores in the form column: `PetBattleAdapter` casts
   * `heldEquipmentId` into `BattleUnit.fromSpecies`'s form slot and `hasSourceHeldItem(id)` asks
   * whether that byte equals the id.
   */
  readonly heldItemId: number;
  /**
   * `BattleUnit.openingAttackSuppressionActions`: how many more actions Huyền Thiết Tán Cô's opening
   * pressure still owns. It is not a status — no bank holds it — but the HUD draws a badge for it, so
   * the strip reads it.
   */
  private openingAttackSuppression: number;
  private readonly buffSlots: number[][];
  private readonly debuffSlots: number[][];

  constructor(
    /** The rules this unit's statuses were built with; only `StatusEffects.unit` supplies one. */
    readonly effects: StatusEffects,
    seed: StatusUnitSeed,
  ) {
    this.speciesId = seed.speciesId;
    this.ownerSide = seed.ownerSide;
    this.formationSlot = seed.formationSlot;
    this.baseStats = { ...seed.base };
    this.currentStats = { ...seed.base };
    this.statuses = new StatusState(effects.catalog);
    this.heldItemId = seed.heldItemId ?? NO_HELD_ITEM;
    this.openingAttackSuppression = 0;
    this.buffSlots = zeroedRows(BUFF_LEGACY_ROWS);
    this.debuffSlots = zeroedRows(DEBUFF_COUNT);
  }

  // ------------------------------------------------------------------ team charms (BattleUnit)

  /** `rainbowCharmDefenseBonusPercent`: Thép thiết cốt on a Kim Loại pet. */
  rainbowCharmDefenseBonus = 0;
  /** `rainbowCharmCorrosionBonusPercent`: Nọc độc công kích on a Thực Vật pet (its Hủ Thực bites harder). */
  rainbowCharmCorrosionBonus = 0;
  /**
   * `PetTraitStatusAttemptBridge.attackerChanceBonus`: points added to the chance of every status this
   * unit attempts, before the target's held item (Hoa Tiên Tử's +20 while Ma Mộc Cộng Sinh holds). The
   * fight sets it; 0 everywhere else.
   */
  statusChanceBonus = 0;
  /** `rainbowCharmParalysisExtensionChance/Turns`: Răng nanh răng nhọn on a Mãnh Thú pet. */
  rainbowCharmParalysis = { chance: 0, turns: 0 };
  /** The fight's `sourceRandomPercent`, which the paralysis extension draws from. */
  charmRandom?: (label: string) => number;
  /**
   * `rainbowCharmSealedSkillSlots`: how many leading skill slots Kỹ năng Phong Bế closed. It only
   * counts while the Phong Bế status (2/6) it planted is held; that status ages like any
   * `ACTIVE_OWNER_ROUND` Cầu Vồng status and shows on the HUD.
   */
  rainbowCharmSealedSkillSlots = 0;

  setRainbowCharmDefenseBonus(percent: number): void {
    this.rainbowCharmDefenseBonus = Math.max(0, Math.min(100, percent));
  }
  setRainbowCharmCorrosionBonus(percent: number): void {
    this.rainbowCharmCorrosionBonus = Math.max(0, Math.min(100, percent));
  }
  setRainbowCharmParalysisExtension(chance: number, turns: number): void {
    this.rainbowCharmParalysis = {
      chance: Math.max(0, Math.min(100, chance)),
      turns: Math.max(0, Math.min(3, turns)),
    };
  }
  /**
   * `RainbowCharmBattleState.trySeal`'s write: the Phong Bế status (`turns` rounds, primary = the
   * slot count, planted by `sourceSide`) and `setRainbowCharmSealedSkillSlots`.
   */
  sealRainbowCharmSkills(slots: number, turns: number, sourceSide: number): void {
    const definition = this.effects.catalog.definition(RAINBOW_BANK, TIER_LOCK_ID);
    if (!definition) throw new Error("battle/statuses.json has no Phong Bế (2/6)");
    const skills = (this as { skillIds?: readonly number[] }).skillIds ?? [],
      count = Math.max(0, Math.min(skills.length, slots));
    this.statuses.put(new StatusInstance(definition, turns, 0, count, 0, 1, sourceSide, -1, -1, 0));
    this.rainbowCharmSealedSkillSlots = count;
    this.restoreSourceStatusState();
  }
  /** `rainbowCharmSealedSkillSlots > 0` with the Phong Bế status still held. */
  rainbowCharmSealed(): boolean {
    return this.rainbowCharmSealedSkillSlots > 0 && this.statuses.has(RAINBOW_BANK, TIER_LOCK_ID);
  }
  /** `RainbowControlMechanics.canUseSkillTier`: Phong Bế shuts unified tiers 2 and 3, nothing else. */
  canUseSkillTier(skillTier: number): boolean {
    return !this.statuses.has(RAINBOW_BANK, TIER_LOCK_ID) || skillTier < 2 || skillTier > 3;
  }
  /**
   * `BattleUnit.tryExtendNewRainbowCharmParalysis`: a Tê Liệt this unit has just planted on a target
   * that had none lasts one or two rounds longer on the charm's chance.
   */
  tryExtendNewRainbowCharmParalysis(target: StatusUnit, absentBefore: boolean): boolean {
    const { chance, turns } = this.rainbowCharmParalysis;
    if (!absentBefore || chance <= 0 || !this.charmRandom) return false;
    const status = target.statuses.get(DEBUFF_BANK, 10);
    if (!status || this.charmRandom("rainbowCharm.paralysisExtension") >= chance) return false;
    status.remainingTurns += turns;
    target.restoreSourceStatusState();
    return true;
  }

  /** `BattleUnit.applyOpeningAttackSuppression`: the pressure does not stack, it takes the max. */
  applyOpeningAttackSuppression(actions: number): void {
    this.openingAttackSuppression = Math.max(this.openingAttackSuppression, Math.max(0, actions));
  }

  /** `BattleUnit.openingAttackSuppressionActions`. */
  openingAttackSuppressionActions(): number {
    return this.openingAttackSuppression;
  }

  maxHp(): number {
    return this.baseStats.hp;
  }

  hp(): number {
    return this.currentStats.hp;
  }

  alive(): boolean {
    return this.currentStats.hp > 0;
  }

  // ------------------------------------------------------------------ badge passives (BattleUnit)

  /** The `sourcePassive*` columns `applySourceBadgeProfile` fills; zero on every unit it skips. */
  private badge: BattleBadgeProfile = NO_BADGE_PROFILE;
  private badgeProfileApplied = false;
  /** `sourcePassiveRoundGrowthCurrent`: how far U Linh has grown this unit so far. */
  private badgeRoundGrowthCurrent = 0;

  /**
   * `BattleUnit.applySourceBadgeProfile`: once per unit, the profile's columns land, the two base-stat
   * terms reshape a player unit, the statuses re-project over the new base, and the HP is reseated —
   * at `currentHp` when the caller has one, else full.
   */
  applySourceBadgeProfile(profile: BattleBadgeProfile, currentHp = -1): void {
    if (profile === NO_BADGE_PROFILE || this.badgeProfileApplied) return;
    this.badgeProfileApplied = true;
    this.badge = { ...profile };
    this.applySourceBadgeBaseStats();
    this.restoreSourceStatusState();
    this.setHp(currentHp >= 0 ? currentHp : this.maxHp());
  }

  /** `BattleUnit.applySourceBadgeBaseStats`: Mộc Quỳ and Đại Địa, player side only. */
  private applySourceBadgeBaseStats(): void {
    if (this.ownerSide !== 0) return;
    if (this.badge.maxHpPercent > 0) {
      this.baseStats.hp = toShort(
        Math.trunc((this.baseStats.hp * (100 + this.badge.maxHpPercent)) / 100),
      );
    }
    if (this.badge.baseDefensePercent > 0) {
      this.baseStats.defense = toShort(
        Math.trunc((this.baseStats.defense * (100 + this.badge.baseDefensePercent)) / 100),
      );
    }
  }

  /**
   * `BattleUnit.advanceSourceBadgeRoundGrowth`: U Linh's end-of-round growth. The three stats are
   * overwritten from the base, not stacked on the projection, exactly as the engine does.
   */
  advanceSourceBadgeRoundGrowth(): boolean {
    const { roundGrowthPercent: percent, roundGrowthCap: cap } = this.badge;
    if (this.ownerSide !== 0 || percent <= 0 || this.badgeRoundGrowthCurrent >= cap) return false;
    this.badgeRoundGrowthCurrent = Math.min(cap, this.badgeRoundGrowthCurrent + percent);
    const grow = (base: number) =>
      toShort(Math.trunc((base * (100 + this.badgeRoundGrowthCurrent)) / 100));
    this.currentStats.attack = grow(this.baseStats.attack);
    this.currentStats.defense = grow(this.baseStats.defense);
    this.currentStats.speed = grow(this.baseStats.speed);
    return true;
  }

  /** `BattleUnit.sourceBadgeRoundGrowthCurrent`. */
  sourceBadgeRoundGrowthCurrent(): number {
    return this.badgeRoundGrowthCurrent;
  }

  /** `sourcePassiveDamagePercent`: Lôi Điện's bonus on the damage this unit deals. */
  sourcePassiveDamagePercent(): number {
    return this.badge.damagePercent;
  }

  /** `sourcePassiveTargetDefensePercent`: Hỏa Phong's bonus on the defense a hit against it reads. */
  sourcePassiveTargetDefensePercent(): number {
    return this.badge.targetDefensePercent;
  }

  /** `sourcePassiveDebuffDurationHalve`: Lôi Điện enhanced. */
  sourcePassiveDebuffDurationHalve(): boolean {
    return this.badge.halveDebuffDuration;
  }

  /**
   * The `target.ownerSide == 0 && target.sourcePassiveDebuffDurationHalve` step every debuff producer
   * runs before its own `Math.max(1, …)`: a player pet with Lôi Điện enhanced keeps half the turns.
   */
  incomingDebuffTurns(turns: number): number {
    return this.ownerSide === 0 && this.badge.halveDebuffDuration ? Math.trunc(turns / 2) : turns;
  }

  /** `BattleUnit.sourceHitCheckSpeed`: the speed the miss chance compares, plus Hỏa Phong's bonus. */
  sourceHitCheckSpeed(): number {
    return this.currentStats.speed + this.badge.hitCheckSpeedBonus;
  }

  /** `BattleUnit.setHp`, including the death pass that clears every status. */
  setHp(hp: number): void {
    const before = this.currentStats.hp;
    this.currentStats.hp = toShort(Math.max(0, Math.min(this.maxHp(), hp)));
    if (before > 0 && this.currentStats.hp <= 0) this.clearStatusesOnDeath();
  }

  /**
   * `BattleUnit.damage`, which spends the shield before it touches HP.
   *
   * `SignatureSkillMechanics.absorbShield` writes the *live* instance's magnitude down and drops the
   * status once it reaches zero, and it does not reproject anything afterwards: no stat term reads
   * the shield, so the residue is invisible until the next legacy projection.
   */
  damage(amount: number): void {
    let taken = this.absorbShield(Math.max(0, amount));
    if (taken <= 0) return;
    taken = Math.max(1, taken);
    this.setHp(this.hp() - taken);
  }

  /** `SignatureSkillMechanics.absorbShield`; what is left after the shield ate its share. */
  private absorbShield(amount: number): number {
    const shield = this.statuses.get(BUFF_BANK, SHIELD_STATUS_ID);
    if (!shield || amount <= 0) return amount;
    const absorbed = Math.min(amount, shield.primaryValue);
    shield.primaryValue -= absorbed;
    if (shield.primaryValue <= 0) this.statuses.remove(BUFF_BANK, SHIELD_STATUS_ID);
    return amount - absorbed;
  }

  /**
   * `BattleUnit.shieldHp`: the pool the health bar and its second text field show.
   *
   * A fainted combatant answers 0 even while the status is still in the bank, which is why the bar
   * cannot keep a blue segment over a KO.
   */
  shieldHp(): number {
    const shield = this.statuses.get(BUFF_BANK, SHIELD_STATUS_ID);
    return !this.alive() || !shield ? 0 : Math.max(0, shield.primaryValue);
  }

  /** `BattleUnit.heal`. */
  heal(amount: number): void {
    this.setHp(this.hp() + Math.max(0, amount));
  }

  /**
   * `BattleUnit.tickVqsv4BleedingRoundEnd`: the round-end bleed, which is a share of the unit's own
   * maximum rather than of anything it was hit with, and never a zero — a pet that carries a bleed pays
   * at least one HP even when the magnitude rounds away.
   *
   * The instance is decremented in place and only removed once it runs out, then the legacy columns are
   * rewritten, because the projection reads those rows and not the typed status. A bleed a signature
   * skill or a characteristic planted is left to its own owner, which is what stops the round-end pass
   * from paying the same tick twice.
   */
  tickVqsv4BleedingRoundEnd(): number {
    const bleeding = this.statuses.get(RAINBOW_BANK, RAINBOW_BLEEDING_STATUS_ID);
    if (!bleeding || !this.alive() || signatureSkillOwned(bleeding)) return 0;
    const before = this.hp(),
      requested = Math.floor((this.maxHp() * Math.max(0, bleeding.primaryValue) + 50) / 100);
    this.damage(Math.max(1, requested));
    bleeding.remainingTurns--;
    if (bleeding.remainingTurns <= 0)
      this.statuses.remove(RAINBOW_BANK, RAINBOW_BLEEDING_STATUS_ID);
    this.restoreSourceStatusState();
    return Math.max(0, before - this.hp());
  }

  hasBuff(id: number): boolean {
    return this.statuses.has(BUFF_BANK, id);
  }

  hasDebuff(id: number): boolean {
    return this.statuses.has(DEBUFF_BANK, id);
  }

  /** `BattleUnit.hasStatus`, which is the same question asked of an explicit bank. */
  hasStatus(bank: number, id: number): boolean {
    return this.statuses.has(bank, id);
  }

  /** `BattleUnit.hasSemanticStatus`: the engine's own alias table, ported entry for entry. */
  hasSemanticStatus(semanticKey: string): boolean {
    const target = SEMANTIC_STATUS_ALIASES[semanticKey];
    return target !== undefined && this.statuses.has(target[0], target[1]);
  }

  /**
   * `BattleUnit.activeBuffCount`: bank 0 walked over the *legacy* rows, so the six signature
   * identities above id 15 do not count even while they are active.
   */
  activeBuffCount(): number {
    let total = 0;
    for (let id = 0; id < this.buffSlots.length; id++) {
      if (this.hasBuff(id)) total++;
    }
    return total;
  }

  /** `BattleUnit.activeDebuffCount`: all eleven Liệt Hỏa debuffs plus every Cầu Vồng identity. */
  activeDebuffCount(): number {
    let total = 0;
    for (let id = 0; id < this.debuffSlots.length; id++) {
      if (this.hasDebuff(id)) total++;
    }
    return total + this.statuses.count(RAINBOW_BANK);
  }

  /** `BattleUnit.hasSourceHeldItem`. */
  hasHeldItem(itemId: number): boolean {
    return this.effects.heldItems.holds(this.heldItemId, itemId);
  }

  /** `BattleUnit.sourceHeldItemParam`: a column of the held item's own row, not of this unit's. */
  heldItemParam(itemId: number, index: number, fallback: number): number {
    return this.effects.heldItems.param(itemId, index, fallback);
  }

  /** `BattleUnit.projectIncomingStatusChanceForHeldItem`, which item 3 is the whole of. */
  projectIncomingStatusChance(chancePercent: number): number {
    return this.effects.heldItems.projectIncomingStatusChance(this.heldItemId, chancePercent);
  }

  activeStatusIds(bank: number): number[] {
    return this.statuses.activeIds(bank);
  }

  /**
   * The legacy five-column row for one status: remaining rounds (or remaining actions for a charge
   * status), primary magnitude, secondary magnitude, source skill id, and the active flag. The
   * returned array is the live row, so a caller that writes it writes the unit.
   */
  legacyRow(bank: number, id: number): number[] {
    const rows = this.rowsOf(bank);
    const row = rows[id];
    if (!row) throw new Error(`no legacy status row ${bank}/${id}`);
    return row;
  }

  /** `StatusLifecycle.projectBank` for both banks: zero every row, then rewrite it from the state. */
  projectStatusStateToLegacy(): void {
    for (const bank of [BUFF_BANK, DEBUFF_BANK]) {
      const rows = this.rowsOf(bank);
      for (const row of rows) row.fill(0);
      for (let id = 0; id < rows.length; id++) {
        const instance = this.statuses.get(bank, id);
        if (!instance) continue;
        const row = rows[id];
        row[0] = toShort(
          instance.definition.consumePolicy === "CHARGE"
            ? instance.remainingActions
            : instance.remainingTurns,
        );
        row[1] = toShort(instance.primaryValue);
        row[2] = toShort(instance.secondaryValue);
        row[3] = toShort(instance.sourceSkillId);
        row[4] = 1;
      }
    }
  }

  /** `BattleUnit.synchronizeStatusFromLegacy`: the legacy row read back into a typed instance. */
  synchronizeStatusFromLegacy(bank: number, id: number): void {
    const definition = this.effects.catalog.definition(bank, id);
    if (!definition) return;
    const row = this.legacyRow(bank, id);
    if (row[4] !== 1) {
      this.statuses.remove(bank, id);
      return;
    }
    const previous = this.statuses.get(bank, id);
    // A row with no instance behind it is a fresh one, so an action status starts with a charge.
    const remainingActions = previous
      ? previous.remainingActions
      : definition.consumePolicy === "ACTION"
        ? Math.max(1, row[0])
        : 0;
    this.statuses.put(
      new StatusInstance(
        definition,
        Math.max(0, row[0]),
        remainingActions,
        row[1],
        row[2],
        previous?.stackCount ?? 1,
        previous ? previous.sourceSide : this.ownerSide,
        previous ? previous.sourceSlot : this.formationSlot,
        row[3],
        previous?.flags ?? 0,
      ),
    );
  }

  /**
   * `VqsvBattleEffectLogic.reapplyActiveStatEffects`, from the base stats up. The engine resets the
   * three mutable stats to their bases first and then recomputes all three, so the reset is invisible
   * and only the recompute is ported.
   *
   * Every magnitude is read from a legacy column, and every term is gated on the typed state: buff 1
   * *lowers* defense by its own primary, and the two speed debuffs stack into one percent before they
   * are taken off the base.
   *
   * The held item sits between the charm and the buffs, and it multiplies where the debuffs only add:
   * items 1 and 2 scale the base attack and defense, and the debuff percents that follow still read
   * the *base* stat, so an item and a defense debuff do not cancel the way the order suggests.
   */
  reapplyActiveStatEffects(): void {
    let attack = this.baseStats.attack;
    let defense = this.baseStats.defense;
    let speed = this.baseStats.speed;

    // Thép thiết cốt: never less than one point.
    if (this.rainbowCharmDefenseBonus > 0)
      defense += Math.max(1, percentOf(this.baseStats.defense, this.rainbowCharmDefenseBonus));

    if (this.hasHeldItem(1)) {
      attack = Math.trunc((attack * (100 + Math.max(0, this.heldItemParam(1, 5, 0)))) / 100);
    }
    if (this.hasHeldItem(2)) {
      defense = Math.trunc((defense * (100 + Math.max(0, this.heldItemParam(2, 5, 0)))) / 100);
    }

    if (this.hasBuff(0)) defense += this.buffSlots[0][1];
    if (this.hasBuff(1)) defense -= this.buffSlots[1][1];
    if (this.hasBuff(2)) defense += this.buffSlots[2][1];
    if (this.hasBuff(4)) defense += this.buffSlots[4][1];
    if (this.hasBuff(7)) speed += this.buffSlots[7][1];
    if (this.hasBuff(9)) {
      speed += this.buffSlots[9][1];
      defense -= this.buffSlots[9][2];
    }
    if (this.hasBuff(10)) attack += this.buffSlots[10][1];

    let speedDownPercent = 0;
    if (this.hasDebuff(1)) speedDownPercent += this.debuffSlots[1][1];
    if (this.hasDebuff(5)) speedDownPercent += this.debuffSlots[5][1];
    if (this.hasDebuff(10)) speedDownPercent += this.debuffSlots[10][1];
    speed -= percentOf(this.baseStats.speed, speedDownPercent);

    let defenseDownPercent = 0;
    if (this.hasDebuff(2)) defenseDownPercent += this.debuffSlots[2][1];
    if (this.hasDebuff(7)) defenseDownPercent += this.debuffSlots[7][1];
    defense -= percentOf(this.baseStats.defense, defenseDownPercent);

    // The engine writes attack and defense twice, the first pair immediately overwritten by the
    // pair that adds the characteristic's contribution; only the second pair is ported.
    this.currentStats.attack = toShort(Math.max(0, attack + this.traitStatBonus("attack")));
    this.currentStats.defense = toShort(Math.max(0, defense + this.traitStatBonus("defense")));
    speed = this.projectAgility(speed);
    this.currentStats.speed = toShort(Math.max(0, speed + this.traitStatBonus("speed")));
  }

  /**
   * `RainbowControlMechanics.projectAgility`: Phong Tỏa takes a percent off the *base* speed, after
   * every buff and debuff term, and floors the result at zero. Without it the pass is the identity,
   * which is why a unit holding only Liệt Hỏa statuses projects exactly as it did before bank 2
   * existed.
   */
  private projectAgility(speed: number): number {
    const bound = this.statuses.get(RAINBOW_BANK, BOUND_STATUS_ID);
    if (!bound) return Math.max(0, speed);
    const reduction = percentOf(Math.max(0, this.baseStats.speed), Math.max(0, bound.primaryValue));
    return Math.max(0, speed - reduction);
  }

  /**
   * `PetDesignTraitMechanics.statBonus` as it enters the stat projection. A plain unit carries no
   * characteristic, so the base answer is zero and a subclass that does carry one overrides it.
   */
  protected traitStatBonus(_stat: MutableStat): number {
    return 0;
  }

  /** `BattleUnit.clearStatusesOnDeath`: a dead pet carries nothing, not even a durable debuff. */
  clearStatusesOnDeath(): void {
    this.statuses.clearAll();
    this.projectStatusStateToLegacy();
    this.reapplyActiveStatEffects();
  }

  /** `BattleUnit.clearBuffsAtBattleEnd`: buffs stay in the battle, debuffs leave with the pet. */
  clearBuffsAtBattleEnd(): void {
    this.statuses.clearBank(BUFF_BANK);
    this.projectStatusStateToLegacy();
    this.reapplyActiveStatEffects();
  }

  /**
   * `BattleUnit.restoreSourceStatusState`: rewrite the legacy columns from the typed state and rebuild
   * the three mutable stats from them. Java also syncs the two canonical trait statuses here, and that
   * half belongs to the characteristic that owns them.
   */
  restoreSourceStatusState(): void {
    this.projectStatusStateToLegacy();
    this.reapplyActiveStatEffects();
  }

  /**
   * `BattleUnit.copySourceBuffsFrom`: the one post-skill route that moves statuses instead of creating
   * them, so the buff leaves the unit it was on. `selectedIndex` and the source skill are both dropped
   * by the engine on the way through — the copy keeps the skill that originally planted it.
   */
  copySourceBuffsFrom(source: StatusUnit, sourceSkill: number): number {
    return this.effects.copySourceBuffsFrom(this, source, sourceSkill);
  }

  private rowsOf(bank: number): number[][] {
    if (bank === BUFF_BANK) return this.buffSlots;
    if (bank === DEBUFF_BANK) return this.debuffSlots;
    throw new Error(`no legacy status rows for bank ${bank}`);
  }
}

function zeroedRows(count: number): number[][] {
  return Array.from({ length: count }, () => [0, 0, 0, 0, 0]);
}

/** One percent draw per label, in the order the engine asks, as `DamageCalculator` takes it. */
export type StatusRandom = (label: string) => number;

/**
 * `VqsvBattleEffectLogic.delayedStatusDamage`: what a Thực Loại producer freezes into the status it
 * plants. It is the damage formula, so the port that owns that formula supplies it.
 */
export type DelayedStatusDamage = (
  source: StatusUnit,
  target: StatusUnit,
  powerPercent: number,
) => number;

/** `BattlePendingDebuff.Operation`. */
export type PendingDebuffOperation = "APPLY_OR_REFRESH" | "DETONATE_AND_CLEAR";

/**
 * A debuff the engine has decided to plant but has not planted yet: `planTargetDebuff` answers the
 * roll and the pre-conditions, and the caller commits after the hit lands.
 */
export class PendingDebuff {
  constructor(
    private readonly effects: StatusEffects,
    readonly source: StatusUnit,
    readonly target: StatusUnit,
    readonly effectId: number,
    readonly skillId: number,
    readonly sourceSide: number,
    readonly sourceSlot: number,
    readonly sourceSpeciesId: number,
    readonly operation: PendingDebuffOperation,
    readonly supplementalDamage: number,
    readonly delayedDamage: number,
    readonly projectedDuration: number,
    readonly projectedMagnitude: number,
  ) {}

  appliesStatus(): boolean {
    return this.operation === "APPLY_OR_REFRESH";
  }

  /** `BattlePendingDebuff.commit`: a new Tê Liệt may be lengthened by its planter's charm. */
  commit(): void {
    const newParalysis = this.effectId === 10 && !this.target.hasSemanticStatus("paralysis");
    this.effects.commitPendingDebuff(this);
    if (newParalysis && this.appliesStatus())
      this.source.tryExtendNewRainbowCharmParalysis(this.target, true);
  }
}

/** `BattleActionEngine.PostDamageModifierPlan`. */
export type PostDamageModifierPlan = {
  heldItem8Leech: boolean;
  heldItem8Heal: number;
  applyBuff2Reflect: boolean;
  buff2Reflect: number;
  applyBuff5Reflect: boolean;
  buff5Reflect: number;
};

/**
 * `BattleActionEngine.PostDamageModifierInput`.
 *
 * `damage` is what the attacker dealt and `receivedDamage` what the target took, and the two are not
 * interchangeable: the item-8 leech is a percent of the former and the buff-2 reflect of the latter.
 * `heldItem8Roll` is the roll the runtime drew for the leech gate, or a value it never drew when the
 * attacker holds no item 8 — the gate is the boolean, so the undrawn roll cannot leak through it.
 */
export type PostDamageModifierInput = {
  attackHit: boolean;
  targetSideOpponent: boolean;
  attackerHasHeldItem8: boolean;
  damage: number;
  receivedDamage: number;
  heldItem8Roll: number;
  heldItem8Chance: number;
  heldItem8HealPercent: number;
  targetHasBuff2: boolean;
  buff2Percent: number;
  targetHasBuff5: boolean;
  buff5StoredDamage: number;
};

/** One entry of the round-start walk, as `planActiveOrder` and `decideActiveEntry` produce it. */
export type ActiveQueueEntry = {
  bank: number;
  effectId: number;
  slot: number;
  outcome: "SKIP_INACTIVE" | "APPLY_WITHOUT_VISUAL" | "START_VISUAL";
};

/**
 * The post-skill routes as the engine's switch would answer them.
 *
 * `noDamageDebuff` and `copyTargetBuffs` are the same decision the mode already states, so a pack in
 * which they disagree with their own mode is a pack that was dumped from a different switch than the
 * one the port runs, and every plan built from it would plant a status the engine never asked for.
 */
function postSkillRouteIndex(mechanics: PackStatusMechanics): Map<number, PostSkillRoute> {
  const routes = new Map<number, PostSkillRoute>();
  for (const row of mechanics.postSkillRoutes) {
    if (!isPostSkillMode(row.mode)) {
      throw new Error(
        `battle/status-mechanics.json routes skill ${row.skillId} to mode "${row.mode}",` +
          " which the engine's post-skill switch does not answer",
      );
    }
    if (row.noDamageDebuff !== (row.mode === "NO_DAMAGE_DEBUFF")) {
      throw new Error(
        `battle/status-mechanics.json skill ${row.skillId} has mode ${row.mode} but says ` +
          `noDamageDebuff=${row.noDamageDebuff}`,
      );
    }
    if (row.copyTargetBuffs !== (row.mode === "COPY_TARGET_BUFFS")) {
      throw new Error(
        `battle/status-mechanics.json skill ${row.skillId} has mode ${row.mode} but says ` +
          `copyTargetBuffs=${row.copyTargetBuffs}`,
      );
    }
    if (routes.has(row.skillId)) {
      throw new Error(
        `battle/status-mechanics.json routes skill ${row.skillId} twice, so which of the two the` +
          " engine's switch answered is not recoverable from the pack",
      );
    }
    // A chance on a route that never reads one is a dump taken from a different runtime than the
    // switch the port runs, and the gate would draw a roll the fight never asks for.
    if (row.leechGateChance > 0 !== (row.mode === "LEECH_AND_BUFF")) {
      throw new Error(
        `battle/status-mechanics.json gates skill ${row.skillId} with a leech roll of ` +
          `${row.leechGateChance} but routes it as ${row.mode}`,
      );
    }
    routes.set(row.skillId, {
      mode: row.mode,
      effectId: row.effectId,
      buffIdWhenAttackMissed: row.buffIdWhenAttackMissed,
      leechGateChance: row.leechGateChance,
    });
  }
  return routes;
}

/**
 * `SignatureSkillMechanics.isOwned`: no signature skill is ported, so an instance carrying one is a
 * boundary rather than a number to guess at.
 */
function refuseSignatureOwned(instance: StatusInstance | undefined, what: string): void {
  if (!signatureSkillOwned(instance)) return;
  throw new Error(
    `${what} came from signature skill ${instance!.sourceSkillId}, which owns its tick and its` +
      " clearing; signature skills are a later slice",
  );
}

/**
 * The Liệt Hỏa status lifecycle: applying a buff or a debuff, ticking it at the start of a round,
 * consuming it on an action, projecting it onto the unit's stats, clearing it, and planning the
 * order the round-start pass walks it in.
 *
 * Every number comes from a shipped row. `battle/statuses.json` says what each status is and how it
 * is consumed; `battle/status-mechanics.json` says what a buff stores on the unit that holds it and
 * which skill applies which buff to whom; `battle/debuff-producers.json` says what a debuff stores
 * and which skill plants it; `battle/items.json` says what the item a unit holds is worth. Nothing
 * here re-declares a magnitude, because the whole point of the tables is that the engine's own switch
 * was replayed against them before they were allowed to ship.
 *
 * The port stops at the Liệt Hỏa banks. Signature statuses, the Cầu Vồng bank, charms,
 * characteristics and badge passives all move the same state, and each is refused where it would be
 * read instead of approximated.
 */
export class StatusEffects {
  private constructor(
    readonly catalog: StatusCatalog,
    /** The held-item half of `battle/items.json`, which item 3's resistance is read from. */
    readonly heldItems: HeldItems,
    private readonly mechanics: PackStatusMechanics,
    private readonly buffStorage: Map<number, PackBuffStorage>,
    private readonly debuffProducers: Map<number, PackDebuffProducer>,
    private readonly skillRows: Map<number, PackSkillRow>,
    /** `BattleActionEngine.planPostSkill`, exported: what each finished skill still owes. */
    private readonly postSkillRoutes: Map<number, PostSkillRoute>,
    private readonly activeVisualIds: Map<number, number[]>,
    private readonly delayedStatusDamage: DelayedStatusDamage | undefined,
  ) {}

  static async load(
    data: GameData,
    hooks: { delayedStatusDamage?: DelayedStatusDamage } = {},
  ): Promise<StatusEffects> {
    const [statuses, mechanics, debuffs, skillRows, items] = await Promise.all([
      data.statuses(),
      data.statusMechanics(),
      data.debuffProducers(),
      data.skillRows(),
      data.items(),
    ]);
    return StatusEffects.from(
      statuses,
      mechanics,
      debuffs.rules,
      debuffs.producers,
      skillRows.rows,
      items,
      hooks,
    );
  }

  static from(
    statuses: readonly PackStatus[],
    mechanics: PackStatusMechanics,
    debuffRules: readonly PackDebuffRule[],
    producers: readonly PackDebuffProducer[],
    skillRows: readonly PackSkillRow[],
    items: readonly PackItem[],
    hooks: { delayedStatusDamage?: DelayedStatusDamage } = {},
  ): StatusEffects {
    const catalog = StatusCatalog.from(statuses);
    if (debuffRules.length !== DEBUFF_COUNT) {
      throw new Error(
        `battle/debuff-producers.json carries ${debuffRules.length} debuff rules, and the engine` +
          ` indexes them by debuff id up to ${DEBUFF_COUNT}`,
      );
    }
    const storage = new Map<number, PackBuffStorage>();
    for (const row of mechanics.buffStoredValues) {
      if (row.buffId < 0 || row.buffId >= LIET_HOA_BUFF_COUNT) {
        throw new Error(
          `battle/status-mechanics.json declares a buff id outside Liệt Hỏa: ${row.buffId}`,
        );
      }
      storage.set(row.buffId, row);
    }
    for (let buffId = 0; buffId < LIET_HOA_BUFF_COUNT; buffId++) {
      if (!storage.has(buffId)) {
        throw new Error(`battle/status-mechanics.json has no storage row for buff ${buffId}`);
      }
    }
    if (mechanics.buffRules.length !== LIET_HOA_BUFF_COUNT) {
      throw new Error(
        `battle/status-mechanics.json carries ${mechanics.buffRules.length} buff rules, and the` +
          ` engine indexes them by buff id up to ${LIET_HOA_BUFF_COUNT}`,
      );
    }
    const visuals = new Map<number, number[]>();
    for (const [bank, ids] of Object.entries(mechanics.activeVisualIdsByBank)) {
      visuals.set(Number(bank), [...ids]);
    }
    return new StatusEffects(
      catalog,
      HeldItems.from(items),
      mechanics,
      storage,
      new Map(producers.map((row) => [row.skillId, row])),
      new Map(skillRows.map((row) => [row.skillId, row])),
      postSkillRouteIndex(mechanics),
      visuals,
      hooks.delayedStatusDamage,
    );
  }

  /**
   * Build one combatant from this catalog.
   *
   * `BattleUnit.fromSpeciesInternal` ends with `copyBaseToCurrent()` plus `restoreStatsForCheck()`,
   * so a unit built holding an item already carries that item's stat contribution before any status
   * is applied; the projection is not something a later call has to be asked for.
   */
  unit(seed: StatusUnitSeed): StatusUnit {
    const unit = new StatusUnit(this, seed);
    unit.reapplyActiveStatEffects();
    return unit;
  }

  // ---------------------------------------------------------------- buffs

  /**
   * `VqsvBattleEffectLogic.applySourceBuff`, and the heal it returns.
   *
   * The engine's `value` parameter is dead there — every magnitude comes from the storage table — so
   * this port does not take one. Each magnitude is a percent of a *base* stat, never of the projected
   * one, which is what lets the whole application be computed before the rest of the unit's statuses
   * are known.
   */
  applySourceBuff(
    unit: StatusUnit,
    buffId: number,
    sourceSkill: number,
    receivedHealingProjection?: (amount: number) => number,
  ): number {
    if (buffId < 0 || buffId >= LIET_HOA_BUFF_COUNT) return 0;
    const storage = this.buffStorage.get(buffId)!;
    const rule = this.mechanics.buffRules[buffId];

    // Buff 11 is the copy route: the engine returns before it installs anything.
    if (!storage.installs) return 0;
    if (storage.clearsOneDebuff) this.clearOneDebuff(unit);
    if (storage.clearsDebuffs) this.clearDebuffs(unit);

    const stackCount = this.stackCountFor(unit, buffId, sourceSkill, storage);
    const primary = this.magnitude(unit, storage.primary, buffId, sourceSkill, stackCount);
    const secondary = this.magnitude(unit, storage.secondary, buffId, sourceSkill, stackCount);
    const heal = this.magnitude(unit, storage.heal, buffId, sourceSkill, stackCount);

    this.installBuff(
      unit,
      buffId,
      rule.duration,
      rule.actionCharges,
      primary,
      secondary,
      stackCount,
      sourceSkill,
    );
    const projected = projectAmount(receivedHealingProjection, heal);
    if (projected > 0) unit.heal(projected);
    return projected;
  }

  /** `VqsvBattleEffectLogic.unifiedBuffStacks`: the stack count the engine itself resolved. */
  unifiedBuffStacks(unit: StatusUnit, buffId: number): number {
    return Math.max(0, unit.statuses.get(BUFF_BANK, buffId)?.stackCount ?? 0);
  }

  /** `VqsvBattleEffectLogic.consumeUnifiedSkillBuff`. */
  consumeUnifiedSkillBuff(unit: StatusUnit, buffId: number): boolean {
    if (!unit.hasBuff(buffId)) return false;
    this.clearSourceBuff(unit, buffId);
    return true;
  }

  /**
   * `VqsvBattleEffectLogic.applyNextDamagingSkillPower`: buff 0 is spent on the next damaging skill,
   * which hits with the percent stored in its secondary column. -1 is the engine's "no change".
   */
  applyNextDamagingSkillPower(unit: StatusUnit, rawDamage: number, damagingSkill: boolean): number {
    if (!damagingSkill || !unit.hasBuff(0)) return -1;
    const instance = unit.statuses.get(BUFF_BANK, 0);
    const power = instance === undefined ? 190 : Math.max(0, instance.secondaryValue);
    this.clearSourceBuff(unit, 0);
    return Math.max(1, Math.trunc((rawDamage * power) / 100));
  }

  /** `VqsvBattleEffectLogic.buffRemainingActions`. */
  buffRemainingActions(unit: StatusUnit, buffId: number): number {
    return Math.max(0, unit.statuses.get(BUFF_BANK, buffId)?.remainingActions ?? 0);
  }

  /**
   * `VqsvBattleEffectLogic.consumeBuffAction`: one action off a charge status, and the status goes
   * when the last one is spent. The engine does not reproject the stats on the way down, only when the
   * status is cleared, and neither does this.
   */
  consumeBuffAction(unit: StatusUnit, buffId: number): boolean {
    const instance = unit.statuses.get(BUFF_BANK, buffId);
    if (!instance || instance.remainingActions <= 0) return false;
    const updated = instance.copy();
    updated.remainingActions--;
    if (updated.remainingActions <= 0) {
      this.clearSourceBuff(unit, buffId);
    } else {
      unit.statuses.put(updated);
      unit.projectStatusStateToLegacy();
    }
    return true;
  }

  // ---------------------------------------------------------------- post-skill routes

  /** `BattleActionEngine.planPostSkill`'s answer for one skill, read from the pack instead of a switch. */
  postSkillRoute(skillId: number): PostSkillRoute | undefined {
    return this.postSkillRoutes.get(skillId);
  }

  /**
   * `VqsvBattleTables.effect(bank, id).name("")`: the row name the runtime prints as a skill's
   * post-effect text.
   *
   * Only the two Liệt Hỏa banks have legacy effect rows behind them; the seven signature ids above buff
   * 14 and the whole Cầu Vồng bank were authored after that table stopped growing, so the engine
   * prints nothing for them. `battle/golden-status-presentation.json`'s `effectNames` section is the
   * row-by-row answer the boundary is graded against.
   */
  effectRowName(bank: number, numericId: number): string {
    const hasLegacyRow =
      (bank === BUFF_BANK && numericId >= 0 && numericId < LIET_HOA_BUFF_COUNT) ||
      (bank === DEBUFF_BANK && numericId >= 0 && numericId < DEBUFF_COUNT);
    return hasLegacyRow ? (this.catalog.definition(bank, numericId)?.displayName ?? "") : "";
  }

  /**
   * `BattleUnit.copySourceBuffsOnlyFrom`: at most two of the source's buffs, in the order
   * `activeStatusIds` answers them, each moved whole rather than re-created.
   *
   * The buff the storage table marks as not installing is the copy route's own identity — the engine
   * names the id, and that flag is what makes the id that one — because copying it would be a skill
   * that steals the steal. A skipped buff does not spend one of the two places, and a copied instance
   * keeps the skill that originally planted it.
   */
  copySourceBuffsFrom(copier: StatusUnit, source: StatusUnit, _sourceSkill: number): number {
    const buffIds = source.activeStatusIds(BUFF_BANK);
    const limit = Math.min(2, buffIds.length);
    const transferred: StatusInstance[] = [];
    for (const buffId of buffIds) {
      if (transferred.length >= limit) break;
      const instance = source.statuses.get(BUFF_BANK, buffId);
      if (!instance || this.buffStorage.get(buffId)?.installs === false) continue;
      transferred.push(instance.copy());
    }
    for (const instance of transferred) {
      source.statuses.remove(BUFF_BANK, instance.definition.sourceNumericId);
      copier.statuses.put(instance);
    }
    source.restoreSourceStatusState();
    copier.restoreSourceStatusState();
    return transferred.length;
  }

  // ---------------------------------------------------------------- debuffs

  /**
   * `VqsvBattleEffectLogic.planTargetDebuff`: does a status land, and what does it carry.
   *
   * The chance is the producer's, clamped and then reduced by the item the *target* holds, and the
   * roll is only drawn below 100 — a guaranteed status costs no randomness, which the graded draw
   * list shows. An item 3 can therefore turn a certain status into a rolled one, and a roll of 100
   * into a saved draw.
   */
  planTargetDebuff(
    attacker: StatusUnit,
    target: StatusUnit,
    skillId: number,
    effectId: number,
    randomPercent: StatusRandom,
  ): PendingDebuff | undefined {
    if (effectId < 0 || effectId >= DEBUFF_COUNT) return undefined;
    const skill = this.skillRows.get(skillId);
    const producer = this.producer(skillId, effectId);
    if (!skill || skill.effectMode !== 2 || !producer) return undefined;
    if (skillId === 18 && target.hasDebuff(2)) return undefined;
    if (target.hasBuff(14)) return undefined;

    // The engine only skips this projection when a characteristic is bridging the attempt, and
    // characteristics are a later slice, so the held item is always the last word on the chance.
    const chance = target.projectIncomingStatusChance(
      Math.min(100, producer.chance + attacker.statusChanceBonus),
    );
    if (chance < 100 && !exactRollPasses(randomPercent("damage.debuff"), chance)) {
      return undefined;
    }

    return this.debuffFromProducer(attacker, target, skillId, effectId, producer);
  }

  /**
   * The status a producer plants once the caller has already rolled for it.
   *
   * `planTargetDebuff` answers the golden status tables and rolls there, because that is where the
   * table asks for the draw. The live fight draws inside the damage formula, which is the one place
   * the whole draw order is graded, so the formula hands its passed attempt here instead of rolling a
   * second time: same producer, same branches, no extra entry in the random stream.
   */
  pendingDebuffFromProducer(
    source: StatusUnit,
    target: StatusUnit,
    skillId: number,
    effectId: number,
  ): PendingDebuff | undefined {
    if (effectId < 0 || effectId >= DEBUFF_COUNT) return undefined;
    const producer = this.producer(skillId, effectId);
    if (!producer) return undefined;
    return this.debuffFromProducer(source, target, skillId, effectId, producer);
  }

  /** The two operations one passed producer attempt can turn into. */
  private debuffFromProducer(
    source: StatusUnit,
    target: StatusUnit,
    skillId: number,
    effectId: number,
    producer: PackDebuffProducer,
  ): PendingDebuff {
    if (skillId === 7 && target.hasDebuff(0)) {
      const seeded = target.statuses.get(DEBUFF_BANK, 0);
      const remaining = seeded === undefined ? 0 : Math.max(0, seeded.remainingTurns);
      return new PendingDebuff(
        this,
        source,
        target,
        effectId,
        skillId,
        source.ownerSide,
        source.formationSlot,
        source.speciesId,
        "DETONATE_AND_CLEAR",
        percentOf(target.maxHp(), producer.primary) * remaining,
        0,
        -1,
        -1,
      );
    }

    const delayedDamage = effectId === 3 ? this.delayedDamage(source, target, producer.primary) : 0;
    return new PendingDebuff(
      this,
      source,
      target,
      effectId,
      skillId,
      source.ownerSide,
      source.formationSlot,
      source.speciesId,
      "APPLY_OR_REFRESH",
      0,
      delayedDamage,
      producer.duration,
      producer.primary,
    );
  }

  /** `VqsvBattleEffectLogic.commitPendingDebuff`. */
  commitPendingDebuff(pending: PendingDebuff): void {
    const target = pending.target;
    if (pending.operation === "DETONATE_AND_CLEAR") {
      this.clearSourceDebuff(target, pending.effectId);
      return;
    }
    const producer = this.producer(pending.skillId, pending.effectId);
    if (!producer) return;
    const duration = Math.max(
      1,
      target.incomingDebuffTurns(
        pending.projectedDuration >= 0 ? pending.projectedDuration : producer.duration,
      ),
    );
    const flags =
      pending.effectId === 3
        ? packDelayedPayload(Math.max(1, pending.delayedDamage), pending.sourceSpeciesId)
        : 0;
    target.statuses.put(
      new StatusInstance(
        this.requireDefinition(DEBUFF_BANK, pending.effectId),
        duration,
        // Quỷ Mị and Hỗn Loạn own one action instead of one round.
        producer.debuffId === 8 || producer.debuffId === 9 ? 1 : 0,
        pending.projectedMagnitude >= 0 ? pending.projectedMagnitude : producer.primary,
        producer.secondary,
        1,
        pending.sourceSide,
        pending.sourceSlot,
        pending.skillId,
        flags,
      ),
    );
    this.reproject(target);
  }

  /** `VqsvBattleEffectLogic.debuffRemainingActions`. */
  debuffRemainingActions(unit: StatusUnit, debuffId: number): number {
    return Math.max(0, unit.statuses.get(DEBUFF_BANK, debuffId)?.remainingActions ?? 0);
  }

  /** `VqsvBattleEffectLogic.consumeDebuffAction`. */
  consumeDebuffAction(unit: StatusUnit, debuffId: number): boolean {
    const instance = unit.statuses.get(DEBUFF_BANK, debuffId);
    if (!instance || instance.remainingActions <= 0) return false;
    const updated = instance.copy();
    updated.remainingActions--;
    if (updated.remainingActions <= 0) {
      this.clearSourceDebuff(unit, debuffId);
    } else {
      unit.statuses.put(updated);
      unit.projectStatusStateToLegacy();
    }
    return true;
  }

  // ---------------------------------------------------------------- ticking

  /**
   * `VqsvBattleEffectLogic.tickSourceBuff`, and the heal it returns. Only the two regeneration buffs
   * heal on a tick; buff 12 is a charge status and returns before its duration is touched, because an
   * action spends it instead.
   */
  tickSourceBuff(
    unit: StatusUnit,
    buffId: number,
    receivedHealingProjection?: (amount: number) => number,
  ): number {
    refuseSignatureOwned(unit.statuses.get(BUFF_BANK, buffId), `buff ${buffId}`);
    if (!unit.hasBuff(buffId)) return 0;
    let heal = 0;
    if (buffId === 3 || buffId === 13) {
      heal = projectAmount(
        receivedHealingProjection,
        Math.max(0, unit.legacyRow(BUFF_BANK, buffId)[1]),
      );
      unit.heal(heal);
    } else if (buffId === 12) {
      return 0;
    }
    this.tickSourceBuffDuration(unit, buffId);
    return heal;
  }

  /**
   * `VqsvBattleEffectLogic.tickSourceDebuff`, and the damage it returns. Gieo Hạt bites every round
   * for a percent of the target's own maximum HP; Thực Loại bites once, on the round it expires, for
   * the damage frozen into its flags, and heals whoever planted it.
   */
  tickSourceDebuff(
    unit: StatusUnit,
    debuffId: number,
    hooks: {
      damageProjection?: (amount: number) => number;
      sourceResolver?: (sourceSide: number, sourceSlot: number) => StatusUnit | undefined;
      healingProjection?: (source: StatusUnit, amount: number) => number;
    } = {},
  ): number {
    if (!unit.hasDebuff(debuffId)) return 0;
    const instance = unit.statuses.get(DEBUFF_BANK, debuffId);
    if (!instance) return 0;
    refuseSignatureOwned(instance, `debuff ${debuffId}`);
    // Action-owned debuffs survive the active-status presentation pass.
    if (debuffId === 8 || debuffId === 9) return 0;

    let damage = 0;
    if (debuffId === 0) {
      damage = projectAmount(
        hooks.damageProjection,
        Math.max(1, percentOf(unit.maxHp(), instance.primaryValue)),
      );
      if (damage > 0) unit.damage(damage);
    } else if (debuffId === 3 && instance.remainingTurns <= 1) {
      damage = projectAmount(hooks.damageProjection, Math.max(1, delayedDamageOf(instance.flags)));
      if (damage > 0) unit.damage(damage);
      const source = hooks.sourceResolver?.(instance.sourceSide, instance.sourceSlot);
      // The frozen payload names the species that planted it, and only that species is fed.
      if (source && source.alive() && source.speciesId === delayedSourceSpeciesOf(instance.flags)) {
        const requested = percentOf(source.maxHp(), instance.secondaryValue);
        source.heal(
          hooks.healingProjection
            ? Math.max(0, hooks.healingProjection(source, requested))
            : requested,
        );
      }
    }
    this.tickSourceDebuffDuration(unit, debuffId);
    return damage;
  }

  // ---------------------------------------------------------------- stat projection

  /** `VqsvBattleEffectLogic.reapplyActiveStatEffects`; the terms read the unit's own columns. */
  reapplyActiveStatEffects(unit: StatusUnit): void {
    unit.reapplyActiveStatEffects();
  }

  /** `VqsvBattleEffectLogic.restoreStatsForCheck`. */
  restoreStatsForCheck(unit: StatusUnit): void {
    unit.reapplyActiveStatEffects();
  }

  // ---------------------------------------------------------------- clearing

  /**
   * `VqsvBattleEffectLogic.clearDebuffs`, which is `StatusLifecycle.cleanseDebuffs`: a cleanse takes
   * the Cầu Vồng identities with the Liệt Hỏa ones, because both banks are debuffs.
   */
  clearDebuffs(unit: StatusUnit): void {
    unit.statuses.clearBank(DEBUFF_BANK);
    unit.statuses.clearBank(RAINBOW_BANK);
    this.reproject(unit);
  }

  /** `StatusLifecycle.shopRecovery`: the shop cleanses exactly what a battle cleanse does. */
  shopRecovery(unit: StatusUnit): void {
    this.clearDebuffs(unit);
  }

  /**
   * `VqsvBattleEffectLogic.clearOneDebuff`: the lowest debuff id, or -1 when there is none. Thạch Hóa
   * says "Xóa một debuff", so a Cầu Vồng debuff counts too once the Liệt Hỏa bank is empty (Java only
   * looked at bank 1). The returned id is the bank-local id.
   */
  clearOneDebuff(unit: StatusUnit): number {
    const ids = unit.activeStatusIds(DEBUFF_BANK);
    if (ids.length > 0) {
      unit.statuses.remove(DEBUFF_BANK, ids[0]);
      this.reproject(unit);
      return ids[0];
    }
    const rainbow = unit.statuses
      .activeIds(RAINBOW_BANK)
      .filter((id) => !signatureSkillOwned(unit.statuses.get(RAINBOW_BANK, id)));
    if (rainbow.length === 0) return -1;
    unit.statuses.remove(RAINBOW_BANK, rainbow[0]);
    this.reproject(unit);
    return rainbow[0];
  }

  /** `VqsvBattleEffectLogic.clearBuffs`. */
  clearBuffs(unit: StatusUnit): void {
    unit.statuses.clearBank(BUFF_BANK);
    this.reproject(unit);
  }

  /** `VqsvBattleEffectLogic.removeBuffs`: the lowest ids first, up to the limit. */
  removeBuffs(unit: StatusUnit, limit: number): number {
    let removed = 0;
    for (const id of unit.activeStatusIds(BUFF_BANK)) {
      if (removed >= Math.max(0, limit)) break;
      if (unit.statuses.remove(BUFF_BANK, id)) removed++;
    }
    if (removed > 0) this.reproject(unit);
    return removed;
  }

  /** `VqsvBattleEffectLogic.removeDebuff`. */
  removeDebuff(unit: StatusUnit, debuffId: number): boolean {
    if (debuffId < 0 || !unit.statuses.remove(DEBUFF_BANK, debuffId)) return false;
    this.reproject(unit);
    return true;
  }

  /** `BattleUnit.clearStatusesOnDeath`, which is `StatusLifecycle.onDeath`. */
  onDeath(unit: StatusUnit): void {
    unit.clearStatusesOnDeath();
  }

  /** `BattleUnit.clearBuffsAtBattleEnd`, which is `StatusLifecycle.onBattleEnd`. */
  onBattleEnd(unit: StatusUnit): void {
    unit.clearBuffsAtBattleEnd();
  }

  /** `StatusLifecycle.durableDebuffs`: what leaves the battle with the pet, lowest id first. */
  durableDebuffs(unit: StatusUnit): StatusInstance[] {
    return unit.statuses.snapshot(DEBUFF_BANK);
  }

  hasDurableDebuffs(unit: StatusUnit): boolean {
    return this.durableDebuffs(unit).length > 0;
  }

  /** `StatusLifecycle.restoreDurableDebuffs`: a buff in the list is a caller bug, not a restore. */
  restoreDurableDebuffs(unit: StatusUnit, durable: readonly StatusInstance[]): void {
    unit.statuses.clearAll();
    for (const instance of durable) {
      if (!instance.durableOutsideBattle()) {
        throw new Error(`cannot restore durable buff ${instance.definition.stableKey}`);
      }
      unit.statuses.put(instance);
    }
    this.reproject(unit);
  }

  // ---------------------------------------------------------------- reflect

  /** The percent buff 2 throws back, read from the column the runtime reads. */
  buff2ReflectPercent(target: StatusUnit): number {
    return target.hasBuff(2) ? target.legacyRow(BUFF_BANK, 2)[2] : 0;
  }

  /** The chance buff 5 throws the whole hit back on. */
  buff5ReflectChance(target: StatusUnit): number {
    return target.hasBuff(5) ? target.legacyRow(BUFF_BANK, 5)[1] : 0;
  }

  /** `VqsvBattleEffectLogic.buff5Reflects`. */
  buff5Reflects(target: StatusUnit, roll: number): boolean {
    return target.hasBuff(5) && exactRollPasses(roll, this.buff5ReflectChance(target));
  }

  /** The chance item 8 heals on, which is zero for an attacker that does not hold it. */
  heldItem8LeechChance(attacker: StatusUnit): number {
    return attacker.hasHeldItem(8) ? attacker.heldItemParam(8, 5, 0) : 0;
  }

  /** The percent of its own hit item 8 heals back. */
  heldItem8HealPercent(attacker: StatusUnit): number {
    return attacker.hasHeldItem(8) ? attacker.heldItemParam(8, 6, 0) : 0;
  }

  /**
   * `BattleActionEngine.planPostDamageModifiers`: what one landed hit does to the two units after the
   * damage is on the target. Item 8 heals the attacker, buff 2 and buff 5 throw damage back at it,
   * and none of the three runs on a hit that missed or on a skill aimed at the attacker's own side.
   *
   * The item-8 roll is inclusive — a roll equal to the chance heals — where the buff-5 roll one step
   * below is exact, so the two gates disagree at the boundary and each has to stay its own predicate.
   */
  planPostDamageModifiers(input: PostDamageModifierInput): PostDamageModifierPlan {
    if (!input.attackHit || !input.targetSideOpponent) {
      return {
        heldItem8Leech: false,
        heldItem8Heal: 0,
        applyBuff2Reflect: false,
        buff2Reflect: 0,
        applyBuff5Reflect: false,
        buff5Reflect: 0,
      };
    }
    const leech =
      input.attackerHasHeldItem8 && inclusiveRollPasses(input.heldItem8Roll, input.heldItem8Chance);
    return {
      heldItem8Leech: leech,
      heldItem8Heal: leech ? percentAmount(input.damage, input.heldItem8HealPercent) : 0,
      applyBuff2Reflect: input.targetHasBuff2,
      buff2Reflect: input.targetHasBuff2
        ? percentAmount(Math.max(0, input.receivedDamage), input.buff2Percent)
        : 0,
      applyBuff5Reflect: input.targetHasBuff5,
      buff5Reflect: input.targetHasBuff5 ? Math.max(0, input.buff5StoredDamage) : 0,
    };
  }

  // ---------------------------------------------------------------- round-start order

  /**
   * `BattleActionEngine.planActiveOrder` plus `decideActiveEntry`: bank 0 then bank 1, ascending id
   * within a bank, and an animation only for the ids `activeVisualIdsByBank` names.
   */
  planActiveOrder(
    unit: StatusUnit,
    stillActive: (bank: number, effectId: number) => boolean = () => true,
  ): {
    outcome: "EMPTY" | "READY";
    entries: ActiveQueueEntry[];
  } {
    const banks = [unit.activeStatusIds(BUFF_BANK), unit.activeStatusIds(DEBUFF_BANK)];
    const entries: ActiveQueueEntry[] = [];
    for (let bank = 0; bank < banks.length; bank++) {
      for (let slot = 0; slot < banks[bank].length; slot++) {
        const effectId = banks[bank][slot];
        entries.push({
          bank,
          effectId,
          slot,
          outcome: !stillActive(bank, effectId)
            ? "SKIP_INACTIVE"
            : this.needsActiveVisual(bank, effectId)
              ? "START_VISUAL"
              : "APPLY_WITHOUT_VISUAL",
        });
      }
    }
    return { outcome: entries.length === 0 ? "EMPTY" : "READY", entries };
  }

  /**
   * `StatusDefinition.tickPhase` is data, and this is the filter the round-start pass applies with it:
   * only a status ticked at the start of its owner's round is walked there.
   */
  ticksAtRoundStart(bank: number, effectId: number): boolean {
    return this.catalog.definition(bank, effectId)?.tickPhase === "ACTIVE_OWNER_ROUND";
  }

  private needsActiveVisual(bank: number, id: number): boolean {
    if (bank !== BUFF_BANK && bank !== DEBUFF_BANK) return false;
    return (this.activeVisualIds.get(bank) ?? []).includes(id);
  }

  // ---------------------------------------------------------------- internals

  private installBuff(
    unit: StatusUnit,
    buffId: number,
    remainingTurns: number,
    remainingActions: number,
    primary: number,
    secondary: number,
    stackCount: number,
    sourceSkill: number,
  ): void {
    unit.statuses.put(
      new StatusInstance(
        this.requireDefinition(BUFF_BANK, buffId),
        remainingTurns,
        remainingActions,
        primary,
        secondary,
        stackCount,
        unit.ownerSide,
        unit.formationSlot,
        sourceSkill,
        0,
      ),
    );
    this.reproject(unit);
  }

  /** `projectStatusStateToLegacy` + `restoreMutableStats` + `reapplyActiveStatEffects`. */
  private reproject(unit: StatusUnit): void {
    unit.projectStatusStateToLegacy();
    unit.reapplyActiveStatEffects();
  }

  /**
   * `VqsvBattleEffectLogic.clearSourceBuff`: only the active flag goes. The other four columns keep
   * the last values the status had, and the typed instance is dropped by the read-back that follows.
   */
  private clearSourceBuff(unit: StatusUnit, buffId: number): void {
    if (buffId < 0 || buffId >= LIET_HOA_BUFF_COUNT) return;
    unit.legacyRow(BUFF_BANK, buffId)[4] = 0;
    unit.synchronizeStatusFromLegacy(BUFF_BANK, buffId);
    unit.reapplyActiveStatEffects();
  }

  /** `VqsvBattleEffectLogic.clearSourceDebuff`, which leaves the same residue. */
  private clearSourceDebuff(unit: StatusUnit, debuffId: number): void {
    if (debuffId < 0 || debuffId >= DEBUFF_COUNT) return;
    unit.legacyRow(DEBUFF_BANK, debuffId)[4] = 0;
    unit.synchronizeStatusFromLegacy(DEBUFF_BANK, debuffId);
    unit.reapplyActiveStatEffects();
  }

  /**
   * `tickSourceBuffDuration` and `tickSourceDebuffDuration`. The engine decrements the legacy round
   * column and reads the result back into the typed state, which is why the decrement goes through the
   * same restore path Java uses: a charge status carries its actions in that column, so decrementing
   * it spends a charge. A status that survives the tick is read back and nothing else — the engine
   * does not reproject the stats, because no magnitude changed.
   */
  private tickSourceBuffDuration(unit: StatusUnit, buffId: number): void {
    this.tickDuration(unit, BUFF_BANK, buffId);
  }

  private tickSourceDebuffDuration(unit: StatusUnit, debuffId: number): void {
    this.tickDuration(unit, DEBUFF_BANK, debuffId);
  }

  private tickDuration(unit: StatusUnit, bank: number, id: number): void {
    if (!unit.statuses.has(bank, id)) return;
    const row = unit.legacyRow(bank, id);
    if (row[0] > 0) row[0] = toShort(row[0] - 1);
    if (row[0] <= 0) {
      if (bank === BUFF_BANK) this.clearSourceBuff(unit, id);
      else this.clearSourceDebuff(unit, id);
      return;
    }
    unit.synchronizeStatusFromLegacy(bank, id);
  }

  private requireDefinition(bank: number, id: number): StatusDefinition {
    const definition = this.catalog.definition(bank, id);
    if (!definition) throw new Error(`no Liệt Hỏa status ${bank}/${id} in battle/statuses.json`);
    return definition;
  }

  /** `LietHoaDebuffMechanics.producer`: the producer only counts when it makes this debuff. */
  private producer(skillId: number, debuffId: number): PackDebuffProducer | undefined {
    const producer = this.debuffProducers.get(skillId);
    return producer && producer.debuffId === debuffId ? producer : undefined;
  }

  private delayedDamage(source: StatusUnit, target: StatusUnit, powerPercent: number): number {
    if (!this.delayedStatusDamage) {
      throw new Error(
        "a Thực Loại producer freezes a delayed hit into the status it plants, and that hit is the" +
          " damage formula: load StatusEffects with the delayedStatusDamage hook",
      );
    }
    return this.delayedStatusDamage(source, target, powerPercent);
  }

  /**
   * The stack count this application resolves. Only a magnitude declared `rulePrimaryPerStack`
   * carries one, and the cap bites on the stacks the unit already holds plus the stacks this skill
   * brings — which is why the same buff applied twice is not twice the buff.
   */
  private stackCountFor(
    unit: StatusUnit,
    buffId: number,
    sourceSkill: number,
    storage: PackBuffStorage,
  ): number {
    const perStack = [storage.primary, storage.secondary, storage.heal].some(
      (value) => value?.percentFrom === "rulePrimaryPerStack",
    );
    if (!perStack) return 1;
    const rule = this.mechanics.buffRules[buffId];
    return Math.min(
      rule.stackCap,
      this.unifiedBuffStacks(unit, buffId) + this.producerStacks(buffId, sourceSkill),
    );
  }

  /** `ExportWebDataCatalogs.expected`: the declared magnitude, as the engine's switch computes it. */
  private magnitude(
    unit: StatusUnit,
    value: PackBuffStoredValue | null,
    buffId: number,
    sourceSkill: number,
    stackCount: number,
  ): number {
    if (!value) return 0;
    const percent = this.declaredPercent(value, buffId, sourceSkill, stackCount);
    if (value.stat === "none") return Math.max(0, percent);
    return percentOf(this.baseOf(value.stat, unit), percent);
  }

  private declaredPercent(
    value: PackBuffStoredValue,
    buffId: number,
    sourceSkill: number,
    stackCount: number,
  ): number {
    const rule = this.mechanics.buffRules[buffId];
    switch (value.percentFrom) {
      case "literal":
        return value.percent;
      case "rulePrimary":
        return rule.primary;
      case "ruleSecondary":
        return rule.secondary;
      case "rulePrimaryPerStack":
        return rule.primary * stackCount;
      case "producerValue":
        return this.producerValue(buffId, sourceSkill);
      default:
        throw new Error(
          `battle/status-mechanics.json declares a percent source this port does not carry:` +
            ` ${String(value.percentFrom)}`,
        );
    }
  }

  private baseOf(stat: PackBuffStoredValue["stat"], unit: StatusUnit): number {
    switch (stat) {
      case "maxHp":
        return unit.maxHp();
      case "baseAttack":
        return unit.baseStats.attack;
      case "baseDefense":
        return unit.baseStats.defense;
      case "baseSpeed":
        return unit.baseStats.speed;
      case "none":
        return 0;
      default:
        throw new Error(
          `battle/status-mechanics.json declares a stat this port does not carry: ${String(stat)}`,
        );
    }
  }

  /** `LietHoaBuffMechanics.producerValue`: the skill's own override, else the buff's default. */
  private producerValue(buffId: number, sourceSkill: number): number {
    const override = this.mechanics.buffProducerValueOverrides.find(
      (row) => row.buffId === buffId && row.skillId === sourceSkill,
    );
    if (override) return override.valuePercent;
    const fallback = this.mechanics.buffProducerDefaults.find((row) => row.buffId === buffId);
    if (!fallback) {
      throw new Error(`battle/status-mechanics.json has no producer default for buff ${buffId}`);
    }
    return fallback.valuePercent;
  }

  /** `LietHoaBuffMechanics.producerStacks`. */
  private producerStacks(buffId: number, sourceSkill: number): number {
    const override = this.mechanics.buffProducerStackOverrides.find(
      (row) => row.buffId === buffId && row.skillId === sourceSkill,
    );
    if (override) return override.stacks;
    const fallback = this.mechanics.buffProducerDefaults.find((row) => row.buffId === buffId);
    if (!fallback) {
      throw new Error(`battle/status-mechanics.json has no producer default for buff ${buffId}`);
    }
    return fallback.stacks;
  }
}

/** `VqsvBattleEffectLogic.projectHealing` and `projectDamage`, which are the same clamp. */
function projectAmount(
  projection: ((amount: number) => number) | undefined,
  amount: number,
): number {
  const nonNegative = Math.max(0, amount);
  return projection === undefined ? nonNegative : Math.max(0, projection(nonNegative));
}

/** `BattleActionEngine.percentAmount`. */
function percentAmount(base: number, percent: number): number {
  return Math.max(0, Math.trunc((base * percent) / 100));
}

/** `LietHoaDebuffMechanics.packDelayedPayload`: the frozen hit and its source species in one int. */
export function packDelayedPayload(frozenDamage: number, sourceSpeciesId: number): number {
  const damage = Math.max(0, Math.min(0x00ffffff, frozenDamage));
  const species = Math.max(0, Math.min(255, sourceSpeciesId + 1));
  return (species << 24) | damage;
}

/** `LietHoaDebuffMechanics.delayedDamage`. */
export function delayedDamageOf(payload: number): number {
  return payload & 0x00ffffff;
}

/** `LietHoaDebuffMechanics.delayedSourceSpeciesId`. */
export function delayedSourceSpeciesOf(payload: number): number {
  return (payload >>> 24) - 1;
}
