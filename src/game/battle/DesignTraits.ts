import type { GameData, PackDesignTrait, PackSkillRow } from "../../data/GameData";
import {
  BUFF_BANK,
  DEBUFF_BANK,
  RAINBOW_BANK,
  StatusInstance,
  StatusUnit,
  toShort,
  type MutableStat,
  type StatusDefinition,
  type StatusEffects,
  type StatusUnitSeed,
} from "./StatusState";
import { kitState, type TraitScript } from "./traitkit/TraitKit";

/** `PetDesignTraitMechanics.SOURCE_BASE`: a characteristic status names its source by species. */
export const DESIGN_TRAIT_SOURCE_BASE = 3000;
/** `PetDesignTraitBalanceOverrides.POWER_BONUS_CAP_PERCENT`. */
export const POWER_BONUS_CAP_PERCENT = 40;
/** `PetDesignTraitBalanceOverrides.LOW_HP_BAND_REGEN_PERCENT`. */
export const LOW_HP_BAND_REGEN_PERCENT = 20;

/** The seven bank-0 identities the characteristics own, by `SignatureStatusCatalog` id. */
export const SHIELD_ID = 15;
const FAMILY_CHARGE_ID = 17;
const RESERVE_ID = 18;
/** `PetDesignTraitMechanics.RAGE`, `SPEED` and `HEAL_CHARGE`. */
const RAGE_ID = 19;
const SPEED_ID = 20;
const HEAL_CHARGE_ID = 21;

/**
 * `PetDesignTraitBalanceOverrides.percentagePower`: the six families whose workbook number is a
 * percent of the skill's own Power rather than a flat Power addition. Java has no flat-Power path,
 * so these six are the ones the recorded rows can referee end to end.
 */
const PERCENT_POWER_FAMILIES: readonly string[] = [
  "utility_next_power",
  "alternating_skill_combo",
  "status_followup",
  "debuff_resonance",
  "low_hp_power_trade",
  "electric_charge",
];

export function percentagePower(type: string): boolean {
  return PERCENT_POWER_FAMILIES.includes(type);
}

/**
 * `statusMask` as a set of bit positions rather than a Java long: the engine packs a status into
 * bit `bank * 16 + id`, and the Cầu Vồng bits start at 32, past the width JavaScript's bitwise
 * operators work at. `maskValue` turns the set back into the long the recorded rows carry.
 */
export type StatusMask = ReadonlySet<number>;

function maskValue(mask: StatusMask): number {
  let value = 0;
  for (const bit of mask) value += 2 ** bit;
  return value;
}

function maskGained(mask: StatusMask, before: StatusMask): Set<number> {
  const gained = new Set<number>();
  for (const bit of mask) {
    if (!before.has(bit)) gained.add(bit);
  }
  return gained;
}

function maskIntersects(mask: StatusMask, bits: readonly number[]): boolean {
  return bits.some((bit) => mask.has(bit));
}

/**
 * `afterAction`'s charm test, `(1L << 35) | (1L << 40)`: bank 2 id 3 is Mê Hoặc and id 8 is Ngủ,
 * the two identities `charm_heal_charge` charges on.
 */
const CHARM_MASK_BITS = [35, 40];
/**
 * `afterAction`'s seed test, `(1L << 16) | (1L << 37)`: bank 1 id 0 is Thực Loại and bank 2 id 5 is
 * Ăn Mòn, the two a seed sustain counts.
 */
const SEED_MASK_BITS = [16, 37];

/** `PetDesignTraitMechanics.pct`, which is also `VqsvBattleEffectLogic.percentOf`. */
export function percentOfBase(value: number, percent: number): number {
  return Math.max(0, Math.trunc((value * percent) / 100));
}

/**
 * One characteristic as the engine reads it: the family its handler switches on and the single
 * number that handler takes. `PetDesignTraitCatalog.Spec` carries more, but nothing in
 * `PetDesignTraitMechanics` touches the name, the description or the mechanics JSON.
 *
 * `value` is a constructor input on purpose. The shipped web balance lifts the six Power families to
 * a flat `sourceValue * 6`, while the Java engine the rows were recorded against answers a fixed
 * percent for them, so a replay feeds the row's own number and production feeds the balance one.
 */
export type DesignTraitSpec = {
  speciesId: number;
  type: string;
  value: number;
  /** HV-01 (`agility_outrank_priority`): rounds the window stays shut after its bonus lands. */
  cooldownTurns?: number;
  /** TL-01 (`hard_control_immunity`): the control statuses that never take hold. */
  immuneStatuses?: readonly string[];
  /**
   * Web balance (owner 2026-11-15, Kim Chỉ Ốc): rounds on the field before the guard works; every
   * entry, a switch back in included, starts the count again.
   */
  warmupRounds?: number;
};

/**
 * The control statuses TL-01 names, each the Liệt Hỏa or Cầu Vồng slot it stands for. "Quấn Quanh
 * hoặc Giam Cầm" is one name, `bind`, over both of its slots.
 */
const CONTROL_STATUS_SLOTS: Record<string, readonly (readonly [number, number])[]> = {
  dazed: [[1, 1]],
  bind: [
    [1, 2],
    [2, 4],
  ],
  paralysis: [[1, 10]],
  petrification: [[2, 0]],
  confusion: [[1, 9]],
  sleep: [[2, 8]],
};

/** `PetDesignTraitCatalog`: one characteristic per species, looked up by species id. */
export class DesignTraitCatalog {
  private readonly specs: Map<number, DesignTraitSpec>;

  constructor(specs: Iterable<DesignTraitSpec>) {
    this.specs = new Map();
    for (const spec of specs) {
      if (this.specs.has(spec.speciesId)) {
        throw new Error(`two characteristics for species ${spec.speciesId}`);
      }
      this.specs.set(spec.speciesId, spec);
    }
  }

  static from(rows: readonly PackDesignTrait[]): DesignTraitCatalog {
    return new DesignTraitCatalog(
      rows.map((row) => ({ speciesId: row.speciesId, type: row.type, value: row.value })),
    );
  }

  /** Kit đặc tính: loài có kịch bản riêng mang họ `scripted`, các họ cũ không chạy cho nó nữa. */
  markScripted(speciesIds: Iterable<number>): void {
    for (const id of speciesIds) this.specs.set(id, { speciesId: id, type: "scripted", value: 0 });
  }

  /** `PetDesignTraitCatalog.bySpecies`: undefined for a species the workbook does not cover. */
  bySpecies(speciesId: number): DesignTraitSpec | undefined {
    return this.specs.get(speciesId);
  }

  get size(): number {
    return this.specs.size;
  }
}

/**
 * `PetDesignTraitState`: battle-local state only. The proc rhythm survives switching pets; the
 * per-action marks do not, which is what `clearTemporary` is for.
 */
export class DesignTraitState {
  enabled = true;
  entryAttack = true;
  entryGuard = true;
  thresholdUsed = false;
  lastProc = -100;
  procs = 0;
  lastGuard = -100;
  /** The round this unit last came onto the field (`enter`). */
  enteredRound = 1;
  /** HV-01: armed for this action's hit, and the first round the window opens again. */
  outrankArmed = false;
  outrankCooldownUntil = -1000;
  lastCharge = -100;
  round = 1;
  actedRound = -1;
  previousSkill = -1;
  combo = 0;
  actedFirst = false;
  pendingPowerUsed = false;
  hpTrade = false;
  lowPowerTrade = false;
  actionOpen = false;
  targetOwnDot = false;
  actionSucceeded = true;
  pendingPower = 0;
  /** electric_charge before Java's 40% cap: the web data's flat Power has no cap. */
  uncappedPendingPower = 0;
  pendingBonus = 0;
  targetHpBefore = 0;
  directCommitted = 0;
  dispelledBySkill = false;
  actorDebuffsBefore = 0;
  targetDebuffsBefore = 0;
  targetBuffsBefore = 0;
  targetStatusMask: StatusMask = new Set<number>();
  actionTarget: DesignTraitUnit | undefined;
  /** `PetDesignTraitState.ownsDot`: an owner other than side and slot, which no ported path sets. */
  ownsDot: ((target: DesignTraitUnit, bit: number) => boolean) | undefined;

  ready(interval: number): boolean {
    return this.round - this.lastProc >= interval;
  }

  proc(): void {
    this.lastProc = this.round;
    this.procs++;
  }

  clearTemporary(): void {
    this.previousSkill = -1;
    this.combo = 0;
    this.pendingPower = 0;
    this.uncappedPendingPower = 0;
    this.pendingBonus = 0;
    this.actionOpen = false;
    this.hpTrade = false;
    this.lowPowerTrade = false;
    this.entryAttack = true;
    this.entryGuard = true;
  }
}

/**
 * `SignatureBattleState`, reduced to the fields a characteristic reads or a recorded row snapshots.
 * Signature skills are a later slice; `secondaryHit` is the only one that gates a characteristic, and
 * it suppresses every direct-damage path while a second hit is resolving.
 */
export class SignatureState {
  pendingPivot = false;
  secondaryHit = false;
  pivotShieldPct = 0;
  pivotShieldDuration = 0;
  round = 1;
  /** `SignatureBattleState.opponent`, which `refreshSignatureOpponents` rewrites on every entry and switch. */
  opponent: DesignTraitUnit | undefined;

  /** `SignatureBattleState.clearTemporary`: the pivot is spent, the shield it carried is not. */
  clearTemporary(): void {
    this.pendingPivot = false;
  }
}

/**
 * `PetTraitCanonicalStatus`: the ten unified identities a trait parameter can name. A talent's
 * `blocked_by` list is asked against these names, never against a bank and an id, so the alias table
 * and the five that actually have a source both belong here rather than in the family handler.
 */
export const CANONICAL_STATUS_NAMES = [
  "burn",
  "corrosion",
  "poison",
  "paralysis",
  "petrification",
  "bind",
  "accuracy_down",
  "strength_down",
  "defense_down",
  "agility_down",
] as const;

export type CanonicalStatusName = (typeof CANONICAL_STATUS_NAMES)[number];

/**
 * `PetTraitCanonicalStatus.normalizeStableKey`: three of the unified names are aliases.
 *
 * `poison` is a fourth, and a web-only one. Java carries the name in its enum but registers no status
 * for it, so nothing can ever answer it; the user folded it into Hủ Thực on 2026-11-03, the same
 * decision that made Thiêu Đốt resolve to Gieo Hạt below. No status has the semantic key `poison`, so
 * the one other caller of this table — `PetTraitBattleProjection.designStatus`, which passes
 * `damage_down`, `bound` and `agility_down` — cannot reach the new entry.
 */
const CANONICAL_STATUS_ALIASES: Record<string, CanonicalStatusName> = {
  petrified: "petrification",
  bound: "bind",
  damage_down: "strength_down",
  poison: "corrosion",
};

export function normalizeCanonicalStatus(stableKey: string): string {
  return CANONICAL_STATUS_ALIASES[stableKey] ?? stableKey;
}

/** `PetTraitCanonicalStatus.fromStableKey`: undefined for a name the enum does not carry. */
export function canonicalStatus(stableKey: string): CanonicalStatusName | undefined {
  const normalized = normalizeCanonicalStatus(stableKey);
  return (CANONICAL_STATUS_NAMES as readonly string[]).includes(normalized)
    ? (normalized as CanonicalStatusName)
    : undefined;
}

/** `PetTraitBattleState.passiveHealRoundIndex` before any round has claimed a heal. */
export const PASSIVE_HEAL_ROUND_NONE = -2147483648;

/**
 * `PetTraitBattleState`, reduced to the fields the 19 talents read. Its other ledgers — the
 * first-damage-after-entry arm, the static-base capture, the paralysis and non-damage cooldowns —
 * belong to the 20 species traits, which stay refused where they would be read. HV-01's priority
 * window is `DesignTraitState.outrankArmed` / `outrankCooldownUntil`.
 */
export class TraitBattleState {
  private permanentStats = false;
  private passiveHealRound = PASSIVE_HEAL_ROUND_NONE;
  private passiveHealing = 0;
  private revives = 0;
  private lowHpAttempted = false;
  private readonly canonical = new Set<CanonicalStatusName>();

  permanentStatsApplied(): boolean {
    return this.permanentStats;
  }

  markPermanentStatsApplied(): void {
    this.permanentStats = true;
  }

  /**
   * `PetTraitBattleState.claimPassiveHealing`: one ledger per round, so a second passive heal in the
   * same round spends what is left of the cap rather than starting a fresh one.
   */
  claimPassiveHealing(roundIndex: number, requestedAmount: number, capAmount: number): number {
    if (this.passiveHealRound !== roundIndex) {
      this.passiveHealRound = roundIndex;
      this.passiveHealing = 0;
    }
    const available = Math.max(0, capAmount - this.passiveHealing);
    const committed = Math.min(Math.max(0, requestedAmount), available);
    this.passiveHealing += committed;
    return committed;
  }

  /** The recorded `phr`, which a row snapshots before the round that first moves it. */
  passiveHealRoundIndex(): number {
    return this.passiveHealRound;
  }

  /** The recorded `phc`, which is zero for any round other than the one that is open. */
  passiveHealingCommitted(roundIndex: number): number {
    return this.passiveHealRound === roundIndex ? this.passiveHealing : 0;
  }

  /** `PetTraitBattleState.canUseRevive`: a negative maximum is the same as zero. */
  canUseRevive(maximumUses: number): boolean {
    return this.revives < Math.max(0, maximumUses);
  }

  recordReviveUse(): void {
    this.revives++;
  }

  reviveUses(): number {
    return this.revives;
  }

  /** The recorded `lha`, which the low-HP family sets even when its own roll then fails. */
  claimLowHpThresholdAttempt(): boolean {
    if (this.lowHpAttempted) return false;
    this.lowHpAttempted = true;
    return true;
  }

  lowHpThresholdAttempted(): boolean {
    return this.lowHpAttempted;
  }

  setCanonicalStatus(status: CanonicalStatusName, active: boolean): void {
    if (active) this.canonical.add(status);
    else this.canonical.delete(status);
  }

  /** `PetTraitBattleState.hasCanonicalStatus`: an alias resolves, an unknown name answers false. */
  hasCanonicalStatus(stableKey: string): boolean {
    const status = canonicalStatus(stableKey);
    return status !== undefined && this.canonical.has(status);
  }
}

/** `IntUnaryOperator` in Java: a received-healing projection, absent meaning "heal exactly this". */
export type HealProjection = (amount: number) => number;

export type DesignTraitUnitSeed = StatusUnitSeed & {
  /** `BattleUnit.selectedSkillId`, which `healingBonus` reads to tell a heal skill from a hit. */
  selectedSkillId?: number;
  skillIds?: readonly number[];
  skillPp?: readonly number[];
  /** `BattleUnit.physicalTraitId`, the talent the dispatcher reads; omitted is `-1`, "none". */
  physicalTraitId?: number;
};

/**
 * `BattleUnit` reduced to what the 42 characteristics touch: a status unit plus the characteristic
 * state, the signature state's suppression flag, the selected skill and its PP row.
 *
 * The characteristic's contribution to attack, defense and speed enters the stat projection through
 * `traitStatBonus`, exactly where `VqsvBattleEffectLogic.reapplyActiveStatEffects` puts it, so a
 * plain `StatusUnit` and this one project identically while no characteristic is active.
 */
export class DesignTraitUnit extends StatusUnit {
  readonly designTraitState = new DesignTraitState();
  readonly signatureState = new SignatureState();
  readonly traitBattleState = new TraitBattleState();
  /** `BattleUnit.physicalTraitId`, the talent this pet was rolled with; `-1` is "none". */
  readonly physicalTraitId: number;
  /** `BattleUnit.speciesTraitId`; a pet carrying one is not a design-trait pet at all. */
  speciesTraitId = -1;
  /** `BattleUnit.characteristicTraitId`, the form-owned one, which suppresses the design trait too. */
  characteristicTraitId = -1;
  selectedSkillId = -1;
  readonly skillIds: number[] = [0, 0, 0, 0, 0];
  readonly skillPp: number[] = [0, 0, 0, 0, 0];
  private mechanics!: DesignTraitMechanics;

  constructor(effects: StatusEffects, seed: DesignTraitUnitSeed) {
    super(effects, seed);
    this.selectedSkillId = seed.selectedSkillId ?? -1;
    this.physicalTraitId = seed.physicalTraitId ?? -1;
    for (let slot = 0; slot < this.skillIds.length; slot++) {
      this.skillIds[slot] = seed.skillIds?.[slot] ?? 0;
      this.skillPp[slot] = toShort(seed.skillPp?.[slot] ?? 0);
    }
  }

  /** Assigned by `DesignTraitMechanics.unit`, which is the only thing that builds one. */
  attach(mechanics: DesignTraitMechanics): void {
    this.mechanics = mechanics;
    this.statuses.admit = (definition) => mechanics.admits(this, definition);
  }

  /** `BattleUnit.restoreStatsForCheck`. */
  restoreStatsForCheck(): void {
    this.reapplyActiveStatEffects();
  }

  /**
   * `BattleUnit.restoreSourceStatusState`, whose last line is the canonical synchronisation: a talent
   * reads its `blocked_by` names off the flags that line writes, so they are refreshed with the state
   * rather than left to whoever next happens to project it.
   */
  restoreSourceStatusState(): void {
    this.projectStatusStateToLegacy();
    this.reapplyActiveStatEffects();
    this.synchronizeTraitCanonicalStatuses();
  }

  /** `BattleUnit.clearStatusesOnDeath`, which synchronises the canonical flags after the clear. */
  override clearStatusesOnDeath(): void {
    super.clearStatusesOnDeath();
    this.synchronizeTraitCanonicalStatuses();
  }

  /** `BattleUnit.clearBuffsAtBattleEnd`, which synchronises them too. */
  override clearBuffsAtBattleEnd(): void {
    super.clearBuffsAtBattleEnd();
    this.synchronizeTraitCanonicalStatuses();
  }

  /** `BattleUnit.reviveTo`: a revive sets HP, it does not heal, so no shield and no death pass. */
  reviveTo(hp: number): void {
    this.setHp(Math.max(0, hp));
  }

  /**
   * `BattleUnit.synchronizeTraitCanonicalStatuses`, the only writer of the canonical flags, in Java's
   * write order. All five are asked of the engine's own alias table.
   *
   * BURN diverges from JavaSE on purpose. Java asks it of `RainbowStatusCatalog.BURN_RESERVED_ID`, a
   * bank-2 slot that registers no `StatusDefinition`, so its flag is false in every battle the engine
   * can run and a talent's `blocked_by: ["burn"]` is only ever answered by the name beside it. Thiêu
   * Đốt was cut as a duplicate of Gieo Hạt — the Liệt Hỏa damage-over-time that `ownDot` already ranks
   * beside Hủ Thực and Xé Rách — so BURN resolves to it through the engine's own `seeded_damage`
   * alias. No recorded talent scenario plants Gieo Hạt, so the Java table cannot referee this line;
   * `PhysicalTraits.test.ts` pins it instead.
   */
  /**
   * The canonical flags read fresh off the statuses. A Liệt Hỏa debuff committed by a skill does not
   * pass through `restoreSourceStatusState`, so a talent asked at the round end (TC-10's "tạm ngừng
   * khi đang Gieo Hạt hoặc Hủ Thực") reads them through here instead of whatever was last written.
   */
  refreshTraitCanonicalStatuses(): void {
    this.synchronizeTraitCanonicalStatuses();
  }

  private synchronizeTraitCanonicalStatuses(): void {
    const state = this.traitBattleState;
    state.setCanonicalStatus("burn", this.hasSemanticStatus("seeded_damage"));
    state.setCanonicalStatus("corrosion", this.hasSemanticStatus("corrosion"));
    state.setCanonicalStatus("paralysis", this.hasSemanticStatus("paralysis"));
    state.setCanonicalStatus("petrification", this.hasSemanticStatus("petrified"));
    state.setCanonicalStatus("bind", this.hasSemanticStatus("bound"));
  }

  /** `BattleUnit.restoreSkillPpForId`: the first slot holding the skill, capped at its own maximum. */
  restoreSkillPpForId(skillId: number, amount: number): void {
    for (let slot = 0; slot < this.skillIds.length; slot++) {
      if (this.skillIds[slot] !== skillId) continue;
      const row = this.mechanics.skill(skillId);
      const maximum = row ? Math.max(0, row.ppMax) : this.skillPp[slot];
      this.skillPp[slot] = toShort(
        Math.min(maximum, Math.max(0, this.skillPp[slot]) + Math.max(0, amount)),
      );
      return;
    }
  }

  /** The recorded long behind `targetStatusMask`. */
  statusMaskValue(): number {
    return maskValue(this.designTraitState.targetStatusMask);
  }

  protected override traitStatBonus(stat: MutableStat): number {
    return this.mechanics.statBonus(this, stat);
  }
}

/**
 * `PetDesignTraitMechanics`: the explicit handler for every one of the 42 characteristic families.
 *
 * Each method is one seam the battle calls at one moment — entering the battle, opening an action,
 * scaling a hit, taking a hit, landing a hit, healing, closing an action, ticking a damage-over-time
 * status, ending a round — and the family switch inside it is the whole of the design. Nothing here
 * re-declares a magnitude: the number comes from the catalog row and the statuses come from
 * `battle/statuses.json`.
 */
export class DesignTraitMechanics {
  private constructor(
    readonly effects: StatusEffects,
    readonly catalog: DesignTraitCatalog,
    private readonly skills: Map<number, PackSkillRow>,
    private readonly speciesElement: Map<number, number>,
  ) {}

  static async load(
    data: GameData,
    effects: StatusEffects,
    catalog?: DesignTraitCatalog,
  ): Promise<DesignTraitMechanics> {
    const [traits, skillRows, species] = await Promise.all([
      catalog ? Promise.resolve(undefined) : data.designTraits(),
      data.skillRows(),
      data.species(),
    ]);
    return new DesignTraitMechanics(
      effects,
      catalog ?? DesignTraitCatalog.from(traits!),
      new Map(skillRows.rows.map((row) => [row.skillId, row])),
      new Map(species.rows.map((row) => [row.speciesId, row.element])),
    );
  }

  /**
   * Build one combatant that carries a characteristic.
   *
   * This is `ProbeWebBattleMath.traitUnit`: the fields are written and the HP set, and the stats are
   * deliberately not reprojected — the recording starts from the written base, and the first step that
   * asks for a projection is what lifts a band talent into the defense. A combatant the *live* battle
   * builds ends the way `BattleUnit.fromSpeciesInternal` does with `restoreStatsForCheck()`, and that
   * call belongs to whoever builds for a fight, not here.
   */
  /** Kịch bản đặc tính theo loài (kit 2026-11-17). Rỗng với các bộ máy dựng cho test đối chiếu Java. */
  private readonly scripts = new Map<number, TraitScript>();

  installScripts(scripts: ReadonlyMap<number, TraitScript>): void {
    for (const [id, script] of scripts) this.scripts.set(id, script);
    this.catalog.markScripted(scripts.keys());
  }

  /** Kịch bản của pet này, khi đặc tính đang bật. */
  script(unit: DesignTraitUnit | undefined): TraitScript | undefined {
    if (!unit || this.spec(unit)?.type !== "scripted") return undefined;
    return this.scripts.get(unit.speciesId);
  }

  elementOf(speciesId: number): number {
    return this.speciesElement.get(speciesId) ?? -1;
  }

  unit(seed: DesignTraitUnitSeed): DesignTraitUnit {
    const unit = new DesignTraitUnit(this.effects, seed);
    unit.attach(this);
    return unit;
  }

  skill(skillId: number): PackSkillRow | undefined {
    return this.skills.get(skillId);
  }

  /** `PetDesignTraitMechanics.spec`: the row, or nothing when this unit is not a design-trait pet. */
  spec(unit: DesignTraitUnit | undefined): DesignTraitSpec | undefined {
    if (!unit || !unit.designTraitState.enabled) return undefined;
    if (unit.speciesTraitId >= 0 || unit.characteristicTraitId >= 0) return undefined;
    return this.catalog.bySpecies(unit.speciesId);
  }

  enabled(unit: DesignTraitUnit | undefined): boolean {
    return this.spec(unit) !== undefined;
  }

  /** TL-01 Thiên Luân Kim Thân: whether a status may take hold of this pet at all. */
  admits(unit: DesignTraitUnit, definition: StatusDefinition): boolean {
    const spec = this.spec(unit);
    if (spec?.type === "scripted") return kitState(unit).runtime?.admits(unit, definition) ?? true;
    if (spec?.type !== "hard_control_immunity") return true;
    return !(spec.immuneStatuses ?? []).some((name) =>
      (CONTROL_STATUS_SLOTS[name] ?? []).some(
        ([bank, id]) => definition.sourceBank === bank && definition.sourceNumericId === id,
      ),
    );
  }

  /**
   * HV-01 Hỏa Tế Đoạt Tiên: "nếu đối thủ có Linh xảo cao hơn sau buff/debuff, được ưu tiên hành
   * động" — the turn order asks this; the window is shut while the cooldown runs.
   */
  outranked(unit: DesignTraitUnit, opponent: StatusUnit | undefined, skillId?: number): boolean {
    const spec = this.spec(unit);
    if (spec?.type === "scripted")
      return (
        !!opponent &&
        opponent.ownerSide !== unit.ownerSide &&
        opponent instanceof DesignTraitUnit &&
        (kitState(unit).runtime?.priority(unit, opponent, skillId) ?? false)
      );
    return (
      spec?.type === "agility_outrank_priority" &&
      !!opponent &&
      opponent.ownerSide !== unit.ownerSide &&
      opponent.currentStats.speed > unit.currentStats.speed &&
      unit.designTraitState.round >= unit.designTraitState.outrankCooldownUntil
    );
  }

  /** `PetDesignTraitMechanics.mainElement`: the skill's family is this species' own element. */
  mainElement(unit: DesignTraitUnit, skillId: number): boolean {
    const skill = this.skills.get(skillId);
    if (!skill) return false;
    const element = this.speciesElement.get(unit.speciesId);
    if (element === undefined) throw new Error(`species ${unit.speciesId} is not in species.json`);
    return skill.elementFamily === element;
  }

  /** `PetDesignTraitMechanics.statusMask`: every debuff bank the unit carries, as bit positions. */
  statusMask(unit: DesignTraitUnit | undefined): Set<number> {
    const bits = new Set<number>();
    if (!unit) return bits;
    for (const bank of [DEBUFF_BANK, RAINBOW_BANK]) {
      for (const id of unit.activeStatusIds(bank)) bits.add(bank * 16 + id);
    }
    return bits;
  }

  /** `PetDesignTraitMechanics.enter`. */
  enter(unit: DesignTraitUnit, round: number): void {
    if (!this.enabled(unit)) return;
    unit.designTraitState.round = round;
    unit.designTraitState.enteredRound = round;
    unit.designTraitState.clearTemporary();
  }

  /**
   * `PetDesignTraitMechanics.beginAction`: the snapshot at execution, before any cleanse, dispel or
   * status application, never at command selection. `pendingPowerUsed` is deliberately not reset
   * here — `alternating_skill_combo` reads it in the action that closes this one.
   */
  beginAction(
    actor: DesignTraitUnit,
    target: DesignTraitUnit | undefined,
    skillId: number,
    actedFirst: boolean,
  ): void {
    if (!this.enabled(actor)) return;
    const state = actor.designTraitState;
    state.actionOpen = true;
    state.actionTarget = target;
    state.actedFirst = actedFirst;
    state.actionSucceeded = true;
    state.directCommitted = 0;
    state.targetOwnDot = this.ownDot(actor, target);
    state.dispelledBySkill = false;
    state.actorDebuffsBefore = actor.activeDebuffCount();
    state.targetDebuffsBefore = target ? target.activeDebuffCount() : 0;
    state.targetBuffsBefore = target ? target.activeBuffCount() : 0;
    state.targetStatusMask = this.statusMask(target);
    state.targetHpBefore = target ? target.hp() : 0;
    state.pendingBonus = 0;
    state.pendingPower = 0;
    state.uncappedPendingPower = 0;
    state.hpTrade = false;
    state.lowPowerTrade = false;
    state.outrankArmed = false;

    const spec = this.spec(actor);
    if (!spec) return;
    if (spec.type === "scripted") {
      if (!actor.signatureState.secondaryHit)
        kitState(actor).runtime?.beginAction(actor, target, skillId, actedFirst);
      return;
    }
    const skill = this.skills.get(skillId);
    if (!skill || skill.powerPercent <= 0 || actor.signatureState.secondaryHit) return;
    const charge = actor.statuses.get(BUFF_BANK, FAMILY_CHARGE_ID);
    switch (spec.type) {
      case "low_hp_power_trade":
        if (
          this.below(actor, 50) &&
          state.ready(3) &&
          actor.hp() > percentOfBase(actor.maxHp(), 5)
        ) {
          state.pendingPower = spec.value;
          state.lowPowerTrade = true;
        }
        break;
      case "utility_next_power":
      case "alternating_skill_combo":
      case "status_followup":
      case "debuff_resonance":
        if (charge) {
          state.pendingPower = spec.value;
          actor.statuses.remove(BUFF_BANK, FAMILY_CHARGE_ID);
          state.pendingPowerUsed = true;
        }
        break;
      case "electric_charge":
        if (charge && this.mainElement(actor, skillId)) {
          state.pendingPower = Math.min(
            POWER_BONUS_CAP_PERCENT,
            spec.value * Math.max(0, charge.stackCount),
          );
          state.uncappedPendingPower = spec.value * Math.max(0, charge.stackCount);
          actor.statuses.remove(BUFF_BANK, FAMILY_CHARGE_ID);
        }
        break;
      case "same_element_momentum":
        if (charge && this.mainElement(actor, skillId)) {
          state.pendingBonus = charge.primaryValue * charge.stackCount;
        }
        break;
      case "first_direct_action_per_entry":
        if (state.entryAttack && actedFirst && state.ready(3)) state.pendingBonus = spec.value;
        break;
      case "agility_outrank_priority":
        // "đòn sát thương đầu tiên lên chính đối thủ tăng 15%" while the faster foe opens the window.
        if (this.outranked(actor, target)) {
          state.pendingBonus = spec.value;
          state.outrankArmed = true;
        }
        break;
      case "entry_ambush":
        if (state.entryAttack && this.above(actor, 70) && state.ready(3)) {
          state.pendingBonus = spec.value;
        }
        break;
      case "slow_target_hunt":
        if (
          target &&
          (target.hasDebuff(1) ||
            target.hasDebuff(5) ||
            target.hasDebuff(10) ||
            target.hasSemanticStatus("bound"))
        ) {
          state.pendingBonus = spec.value;
        }
        break;
      case "imprisoned_target_bonus":
        if (target?.hasSemanticStatus("bound")) state.pendingBonus = spec.value;
        break;
      case "hp_trade_boost":
        if (
          this.mainElement(actor, skillId) &&
          state.ready(1) &&
          actor.hp() > percentOfBase(actor.maxHp(), 3)
        ) {
          state.pendingBonus = spec.value;
          state.hpTrade = true;
        }
        break;
      case "buffed_target_pressure":
        if (state.targetBuffsBefore > 0 && this.mainElement(actor, skillId)) {
          state.pendingBonus = spec.value;
        }
        break;
      default:
        break;
    }
  }

  /**
   * Dấu tích as the web data defines it (`pet-design-traits.json` powerRule): the charge's value is
   * flat Power added to the qualifying hit, with no cap. Zero outside the six families.
   */
  flatPowerBonus(unit: DesignTraitUnit | undefined): number {
    const spec = this.spec(unit);
    if (!spec || !percentagePower(spec.type)) return 0;
    const state = unit!.designTraitState;
    if (spec.type === "electric_charge") return Math.max(0, state.uncappedPendingPower);
    return Math.max(0, state.pendingPower);
  }

  /** `PetDesignTraitMechanics.powerBonusPercent`: zero for every family outside the six. */
  powerBonusPercent(unit: DesignTraitUnit | undefined): number {
    const spec = this.spec(unit);
    if (!spec || !percentagePower(spec.type)) return 0;
    return Math.max(0, Math.min(POWER_BONUS_CAP_PERCENT, unit!.designTraitState.pendingPower));
  }

  /**
   * `PetDesignTraitMechanics.applyPowerBonus`: scale the skill-powered hit before type, held item,
   * damage and defense modifiers.
   */
  applyPowerBonus(unit: DesignTraitUnit, skillDamage: number): number {
    return Math.trunc((Math.max(0, skillDamage) * (100 + this.powerBonusPercent(unit))) / 100);
  }

  /** `PetDesignTraitMechanics.defenseIgnore`. */
  defenseIgnore(actor: DesignTraitUnit, target: DesignTraitUnit | undefined): number {
    const spec = this.spec(actor);
    if (!spec || !target || actor.signatureState.secondaryHit) return 0;
    if (spec.type === "scripted")
      return kitState(actor).runtime?.pierce(actor, target, actor.selectedSkillId) ?? 0;
    if (
      spec.type === "faster_target_pierce" &&
      target.currentStats.speed > actor.currentStats.speed
    ) {
      return spec.value;
    }
    if (
      spec.type === "buffed_defense_pierce" &&
      (target.hasBuff(4) || target.hasBuff(0) || target.hasBuff(2))
    ) {
      return spec.value;
    }
    return 0;
  }

  /** `PetDesignTraitMechanics.outgoing`. */
  outgoing(actor: DesignTraitUnit, damage: number): number {
    if (!this.enabled(actor) || actor.signatureState.secondaryHit) return damage;
    return damage + percentOfBase(damage, actor.designTraitState.pendingBonus);
  }

  /** `PetDesignTraitMechanics.incoming`, which is also where the three guards spend themselves. */
  incoming(source: DesignTraitUnit | undefined, target: DesignTraitUnit, damage: number): number {
    const spec = this.spec(target);
    if (!spec || damage <= 0 || !source || source.signatureState.secondaryHit) return damage;
    const state = target.designTraitState;
    let reduction = 0;
    if (
      spec.type === "first_hit_guard" &&
      state.lastGuard !== state.round &&
      state.round - state.enteredRound >= (spec.warmupRounds ?? 0)
    ) {
      reduction = spec.value;
      state.lastGuard = state.round;
    }
    if (spec.type === "entry_hit_guard" && state.entryGuard && state.ready(3)) {
      reduction = spec.value;
      state.entryGuard = false;
      state.proc();
    }
    if (spec.type === "accuracy_pressure_guard" && source.hasDebuff(4) && !source.hasHeldItem(9)) {
      reduction = spec.value;
    }
    // TL-01: "giảm 25% sát thương trực tiếp nhận vào" — a hit still costs at least 1.
    if (spec.type === "hard_control_immunity")
      return Math.max(1, damage - percentOfBase(damage, spec.value));
    return Math.max(0, damage - percentOfBase(damage, reduction));
  }

  /**
   * `PetDesignTraitMechanics.stack`: refresh the mark while respecting the runtime's three-stack
   * ceiling, including callers requesting a smaller cap.
   */
  stack(unit: DesignTraitUnit, id: number, duration: number, cap: number, value: number): void {
    const old = unit.statuses.get(BUFF_BANK, id);
    const stacks = !old ? 1 : Math.min(Math.max(1, Math.min(cap, 3)), old.stackCount + 1);
    this.put(unit, this.requireSignature(id), duration, value, stacks, unit);
  }

  /** `PetDesignTraitMechanics.put`. */
  put(
    unit: DesignTraitUnit,
    definition: StatusDefinition,
    turns: number,
    value: number,
    stacks: number,
    source: DesignTraitUnit,
  ): void {
    unit.statuses.put(
      new StatusInstance(
        definition,
        turns,
        0,
        value,
        0,
        stacks,
        source.ownerSide,
        source.formationSlot,
        DESIGN_TRAIT_SOURCE_BASE + source.speciesId,
        -source.designTraitState.round - 1,
      ),
    );
    unit.restoreSourceStatusState();
  }

  /** `PetDesignTraitMechanics.shield`: a bigger shield replaces a smaller one, never the reverse. */
  shield(target: DesignTraitUnit | undefined, percent: number, source: DesignTraitUnit): void {
    if (!target || !target.alive()) return;
    const amount = percentOfBase(target.maxHp(), percent);
    const old = target.statuses.get(BUFF_BANK, SHIELD_ID);
    if (old && old.primaryValue >= amount) return;
    this.put(target, this.requireSignature(SHIELD_ID), 2, amount, 1, source);
  }

  /** `PetDesignTraitMechanics.heal`. */
  heal(target: DesignTraitUnit | undefined, amount: number, projection?: HealProjection): void {
    if (!target || !target.alive() || amount <= 0) return;
    target.heal(projection ? projection(amount) : amount);
  }

  /** `PetDesignTraitMechanics.afterHit`: the retaliation families answer a number, the rest plant. */
  afterHit(
    source: DesignTraitUnit,
    target: DesignTraitUnit,
    skillId: number,
    damage: number,
    targetHeal?: HealProjection,
  ): number {
    if (
      damage <= 0 ||
      source.signatureState.secondaryHit ||
      source.ownerSide === target.ownerSide
    ) {
      return 0;
    }
    source.designTraitState.directCommitted += damage;
    this.charge(source);
    this.charge(target);
    const spec = this.spec(target);
    if (!spec || !target.alive()) return 0;
    const state = target.designTraitState;
    switch (spec.type) {
      case "taken_damage_rage":
        if (state.ready(1)) {
          this.stack(target, RAGE_ID, 3, 3, spec.value);
          state.proc();
        }
        break;
      case "reactive_retaliation":
        if (damage * 100 >= target.maxHp() * 8 && state.ready(1)) {
          state.proc();
          return percentOfBase(damage, spec.value);
        }
        break;
      case "thorn_retaliation":
        if (state.ready(1)) {
          state.proc();
          return percentOfBase(target.maxHp(), spec.value);
        }
        break;
      case "fire_hit_recovery": {
        const skill = this.skills.get(skillId);
        if (skill && skill.elementFamily === 0 && state.ready(2)) {
          state.proc();
          this.heal(target, percentOfBase(target.maxHp(), spec.value), targetHeal);
        }
        break;
      }
      default:
        break;
    }
    return 0;
  }

  /** `PetDesignTraitMechanics.afterDamage`: the two thresholds that fire on the way past 30 %. */
  afterDamage(target: DesignTraitUnit, before: number, heal?: HealProjection): void {
    const spec = this.spec(target);
    if (!spec || !target.alive() || target.hp() >= before) return;
    const state = target.designTraitState;
    if (before * 100 > target.maxHp() * 30 && target.hp() * 100 <= target.maxHp() * 30) {
      if (spec.type === "threshold_regen_once") {
        state.thresholdUsed = true;
        this.heal(target, percentOfBase(target.maxHp(), spec.value), heal);
      }
      if (spec.type === "threshold_guard_once") {
        state.thresholdUsed = true;
        this.shield(target, spec.value, target);
      }
    }
    target.restoreStatsForCheck();
  }

  /**
   * `PetDesignTraitMechanics.healingBonus`: called only for an active healing skill, before every
   * received-healing modifier, which is why it reads the selected skill and refuses a powered one.
   */
  healingBonus(
    source: DesignTraitUnit,
    target: DesignTraitUnit | undefined,
    requested: number,
  ): number {
    const spec = this.spec(source);
    if (!spec || !target || requested <= 0 || !source.designTraitState.actionOpen) return requested;
    if (spec.type === "scripted")
      return kitState(source).runtime?.healOut(source, target, requested) ?? requested;
    const skill = this.skills.get(source.selectedSkillId);
    if (!skill || skill.powerPercent !== 0) return requested;
    const state = source.designTraitState;
    let bonus = 0;
    if (spec.type === "low_hp_heal_bonus" && this.below(target, 50) && state.ready(3)) {
      bonus = percentOfBase(target.maxHp(), spec.value);
      state.proc();
    }
    if (spec.type === "utility_reserve") {
      const reserve = source.statuses.get(BUFF_BANK, RESERVE_ID);
      if (reserve) {
        bonus = percentOfBase(source.maxHp(), reserve.primaryValue * reserve.stackCount);
        source.statuses.remove(BUFF_BANK, RESERVE_ID);
      }
    }
    if (spec.type === "charm_heal_charge" || spec.type === "enemy_dot_heal_support") {
      const charge = source.statuses.get(BUFF_BANK, HEAL_CHARGE_ID);
      if (charge) {
        bonus = percentOfBase(target.maxHp(), charge.primaryValue);
        source.statuses.remove(BUFF_BANK, HEAL_CHARGE_ID);
      }
    }
    return requested + bonus;
  }

  /** `PetDesignTraitMechanics.afterAction`: the close of one action, where most families fire. */
  afterAction(
    actor: DesignTraitUnit,
    target: DesignTraitUnit | undefined,
    skillId: number,
    damaging: boolean,
    hit: boolean,
    damage: number,
    selfHeal?: HealProjection,
    targetHeal?: HealProjection,
  ): void {
    const spec = this.spec(actor);
    if (!spec || actor.signatureState.secondaryHit) return;
    const state = actor.designTraitState;
    const landed = hit && state.actionSucceeded;
    const committed = state.actionOpen && damaging ? state.directCommitted : damage;
    state.actedRound = state.round;
    const direct =
      damaging && landed && committed > 0 && !!target && target.ownerSide !== actor.ownerSide;
    const gained =
      landed && target ? maskGained(this.statusMask(target), state.targetStatusMask) : undefined;
    const newStatus = gained !== undefined && gained.size > 0;
    const ally = !!target && target.ownerSide === actor.ownerSide;
    switch (spec.type) {
      case "agility_outrank_priority":
        // "hồi chiêu 2 lượt": the round it landed and the next two keep the window shut.
        if (state.outrankArmed && direct)
          state.outrankCooldownUntil = state.round + (spec.cooldownTurns ?? 2) + 1;
        state.outrankArmed = false;
        break;
      case "first_direct_action_per_entry":
      case "entry_ambush":
        if (state.pendingBonus > 0 && direct) state.proc();
        if (damaging) state.entryAttack = false;
        break;
      case "low_hp_power_trade":
        if (damaging && state.lowPowerTrade && actor.alive()) {
          actor.setHp(Math.max(1, actor.hp() - percentOfBase(actor.maxHp(), 5)));
          state.proc();
        }
        break;
      case "hp_trade_boost":
        if (direct && state.hpTrade && actor.alive()) {
          actor.setHp(Math.max(1, actor.hp() - percentOfBase(actor.maxHp(), 3)));
          state.proc();
        }
        break;
      case "alternating_skill_combo":
        if (state.pendingPowerUsed) {
          state.combo = 0;
          state.previousSkill = -1;
          state.pendingPowerUsed = false;
        } else if (direct) {
          state.combo =
            state.previousSkill >= 0 && state.previousSkill !== skillId ? state.combo + 1 : 1;
          state.previousSkill = skillId;
          if (state.combo >= 2) this.stack(actor, FAMILY_CHARGE_ID, 2, 1, spec.value);
        } else {
          state.combo = 0;
          state.previousSkill = -1;
        }
        break;
      case "utility_reserve":
        if (!damaging && landed) this.stack(actor, RESERVE_ID, 4, 3, spec.value);
        break;
      case "utility_next_power":
        if (!damaging && landed) this.stack(actor, FAMILY_CHARGE_ID, 2, 1, spec.value);
        break;
      case "same_element_momentum":
        if (direct && this.mainElement(actor, skillId)) {
          this.stack(actor, FAMILY_CHARGE_ID, 3, 3, spec.value);
        }
        break;
      case "status_followup":
      case "debuff_resonance":
        if (newStatus) this.stack(actor, FAMILY_CHARGE_ID, 2, 1, spec.value);
        break;
      case "charm_heal_charge":
        if (newStatus && maskIntersects(gained!, CHARM_MASK_BITS)) {
          this.stack(actor, HEAL_CHARGE_ID, 2, 1, spec.value);
        }
        break;
      case "status_seed_sustain":
        if (newStatus && maskIntersects(gained!, SEED_MASK_BITS) && state.ready(2)) {
          this.heal(actor, percentOfBase(actor.maxHp(), spec.value), selfHeal);
          state.proc();
        }
        break;
      case "successful_cleanse_heal": {
        const cleaned = ally ? target! : actor;
        const oldCount = ally ? state.targetDebuffsBefore : state.actorDebuffsBefore;
        if (oldCount > cleaned.activeDebuffCount() && state.ready(3)) {
          this.heal(
            cleaned,
            percentOfBase(cleaned.maxHp(), spec.value),
            ally ? targetHeal : selfHeal,
          );
          state.proc();
        }
        break;
      }
      case "support_shield":
        if (!damaging && landed && ally && state.ready(3)) {
          this.shield(target, spec.value, actor);
          state.proc();
        }
        break;
      case "successful_dispel_pp":
        if (landed && state.dispelledBySkill && state.ready(3)) {
          actor.restoreSkillPpForId(skillId, spec.value);
          state.proc();
        }
        break;
      case "damage_to_shield":
        if (direct && actor.alive() && state.ready(2)) {
          this.shield(actor, spec.value, actor);
          state.proc();
        }
        break;
      case "low_target_lifesteal":
      case "marked_target_lifesteal":
        if (direct && actor.alive() && state.ready(2) && target) {
          const qualifies =
            spec.type === "low_target_lifesteal"
              ? state.targetHpBefore * 100 < target.maxHp() * 35
              : state.targetOwnDot;
          if (qualifies) {
            this.heal(actor, percentOfBase(committed, spec.value), selfHeal);
            state.proc();
          }
        }
        break;
      default:
        break;
    }
    state.pendingPower = 0;
    state.uncappedPendingPower = 0;
    state.pendingBonus = 0;
    state.actionOpen = false;
  }

  /** `PetDesignTraitMechanics.dotTick`. */
  dotTick(source: DesignTraitUnit, seed: boolean, damage: number, healing?: HealProjection): void {
    const spec = this.spec(source);
    if (!spec || !source.alive() || damage <= 0) return;
    if (spec.type === "dot_tick_sustain" && source.designTraitState.ready(1)) {
      this.heal(source, percentOfBase(source.maxHp(), spec.value), healing);
      source.designTraitState.proc();
    }
    if (spec.type === "enemy_dot_heal_support" && seed) {
      this.stack(source, HEAL_CHARGE_ID, 2, 1, spec.value);
    }
  }

  /**
   * `PetDesignTraitMechanics.roundEnd`. The round is written twice, once before the handlers and
   * once as `round + 1` after them, so a handler that reads `state.round` sees the round that just
   * ended and the next action sees the one after it.
   */
  roundEnd(unit: DesignTraitUnit, round: number, healing?: HealProjection): void {
    const spec = this.spec(unit);
    if (!spec || !unit.alive()) return;
    const state = unit.designTraitState;
    state.round = round;
    if (spec.type === "first_move_stacks") {
      if (state.actedRound === round && state.actedFirst) {
        this.stack(unit, SPEED_ID, 2, 3, spec.value);
      } else {
        unit.statuses.remove(BUFF_BANK, SPEED_ID);
        unit.restoreStatsForCheck();
      }
    }
    if (spec.type === "alternating_skill_combo" && state.actedRound !== round) {
      state.previousSkill = -1;
      state.combo = 0;
      unit.statuses.remove(BUFF_BANK, FAMILY_CHARGE_ID);
    }
    if (spec.type === "hp_band_defense" && this.below(unit, 40) && state.ready(2)) {
      this.heal(unit, percentOfBase(unit.maxHp(), LOW_HP_BAND_REGEN_PERCENT), healing);
      state.proc();
    }
    state.round = round + 1;
  }

  /**
   * `PetDesignTraitMechanics.statBonus`, which `reapplyActiveStatEffects` adds on top of every other
   * term. Defense is answered from the HP band, attack and speed from the stack they carry, and the
   * magnitude is always a percent of the *base* stat.
   */
  statBonus(unit: DesignTraitUnit, stat: MutableStat): number {
    const spec = this.spec(unit);
    if (!spec) return 0;
    const base = unit.baseStats[stat];
    if (spec.type === "scripted") {
      const percent = kitState(unit).runtime?.statBonus(unit, stat) ?? 0;
      return percent === 0 ? 0 : Math.trunc((base * percent) / 100);
    }
    if (stat === "defense" && spec.type === "hp_band_defense" && this.above(unit, 60)) {
      return percentOfBase(base, spec.value);
    }
    const id = stat === "attack" ? RAGE_ID : stat === "speed" ? SPEED_ID : -1;
    const status = unit.statuses.get(BUFF_BANK, id);
    if (!status) return 0;
    return percentOfBase(base, status.primaryValue * status.stackCount);
  }

  /** `PetDesignTraitMechanics.charge`: one Dấu Tích per round, for the electric family only. */
  private charge(unit: DesignTraitUnit): void {
    const spec = this.spec(unit);
    if (!spec || spec.type !== "electric_charge" || !unit.alive()) return;
    if (unit.designTraitState.lastCharge === unit.designTraitState.round) return;
    this.stack(unit, FAMILY_CHARGE_ID, 3, 3, spec.value);
    unit.designTraitState.lastCharge = unit.designTraitState.round;
  }

  /** `PetDesignTraitMechanics.ownDot`: whether this unit planted the target's damage-over-time. */
  private ownDot(actor: DesignTraitUnit, target: DesignTraitUnit | undefined): boolean {
    if (!target) return false;
    for (const bank of [DEBUFF_BANK, RAINBOW_BANK]) {
      for (const status of target.statuses.snapshot(bank)) {
        const id = status.definition.sourceNumericId;
        const isDot =
          (bank === DEBUFF_BANK && id === 0) || (bank === RAINBOW_BANK && (id === 5 || id === 7));
        if (!isDot) continue;
        const bit = bank * 16 + id;
        const owned = actor.designTraitState.ownsDot
          ? actor.designTraitState.ownsDot(target, bit)
          : status.sourceSide === actor.ownerSide && status.sourceSlot === actor.formationSlot;
        if (owned) return true;
      }
    }
    return false;
  }

  private below(unit: DesignTraitUnit | undefined, percent: number): boolean {
    return !!unit && unit.hp() * 100 < unit.maxHp() * percent;
  }

  private above(unit: DesignTraitUnit | undefined, percent: number): boolean {
    return !!unit && unit.hp() * 100 > unit.maxHp() * percent;
  }

  /** `SignatureStatusCatalog.bySource`, which is the definition the engine plants under. */
  private requireSignature(id: number): StatusDefinition {
    const definition = this.effects.catalog.definition(BUFF_BANK, id);
    if (!definition) throw new Error(`battle/statuses.json has no signature status 0/${id}`);
    return definition;
  }
}

export { maskValue };
