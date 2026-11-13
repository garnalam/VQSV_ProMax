import type {
  GameData,
  PackTrait,
  PackTraitMechanic,
  PackTraitMechanics,
} from "../../data/GameData";
import type { DesignTraitUnit } from "./DesignTraits";
import type { StatusRandom } from "./StatusState";

/** `PetTraitHook`: the eighteen moments the dispatcher asks a trait about. */
export type PetTraitHook =
  | "ON_BATTLE_ENTER"
  | "ON_ROUND_START"
  | "MODIFY_ACTION_PRIORITY"
  | "MODIFY_PERMANENT_STATS"
  | "MODIFY_ACCURACY_AND_EVASION"
  | "MODIFY_TARGET_DEFENSE"
  | "MODIFY_STATUS_CHANCE_AND_RESISTANCE"
  | "MODIFY_OUTGOING_DIRECT_DAMAGE"
  | "MODIFY_INCOMING_DIRECT_DAMAGE"
  | "MODIFY_INCOMING_DAMAGE"
  | "AFTER_DIRECT_DAMAGE"
  | "AFTER_DAMAGE"
  | "MODIFY_EXPERIENCE"
  | "MODIFY_RECEIVED_HEALING"
  | "AFTER_SKILL_ACTION"
  | "ON_ROUND_END"
  | "ON_SWITCH_OUT"
  | "ON_SWITCH_IN";

/**
 * `PetTraitMechanicFamily`, the eleven a physical trait can carry. Nine of them are the rollable
 * talents; the last two belong to the form-owned characteristics, which no rollable pet can wear and
 * which stay refused where they would be read.
 */
export type PhysicalTraitFamily =
  | "NO_EFFECT"
  | "PERMANENT_STAT_PERCENT"
  | "HEALING_RECEIVED_PERCENT"
  | "ROUND_END_PASSIVE_HEAL"
  | "DAMAGE_ACCURACY_TRADEOFF"
  | "CHANCE_INCOMING_DIRECT_DAMAGE_PERCENT"
  | "CHANCE_REVIVE_ON_FAINT"
  | "EXPERIENCE_MULTIPLIER"
  | "LOW_HP_SELF_DAMAGE_ONCE"
  | "AGILITY_OUTRANK_PRIORITY_DAMAGE_BONUS"
  | "HARD_CONTROL_IMMUNITY_DIRECT_DAMAGE_REDUCTION";

/** `PetTraitSlotType.stableKey`; only the physical half is executable here. */
const PHYSICAL_SLOT = "physical";

function unsupported(stableKey: string, detail: string): Error {
  return new Error(`Unsupported physical Pet trait ${stableKey}: ${detail}.`);
}

/** `BigDecimal.movePointRight(2).intValueExact()`: a multiplier read back as a whole percent. */
function exactPercent(value: number): number {
  const scaled = value * 100;
  if (!Number.isInteger(scaled)) {
    throw new Error(`Trait multiplier is not an exact percent: ${value}`);
  }
  return scaled;
}

/**
 * `PetTraitMechanicParameters`: one trait's numbers, typed by the schema beside them. The schema is
 * what separates an integer from a decimal, so it is read rather than guessed from the JSON — asking
 * `integer` for `experience_multiplier` is a bug, not a coercion.
 */
export class TraitParameters {
  private readonly integers = new Map<string, number>();
  private readonly decimals = new Map<string, number>();
  private readonly booleans = new Map<string, boolean>();
  private readonly strings = new Map<string, string>();
  private readonly stringLists = new Map<string, readonly string[]>();

  private constructor() {}

  /** `PetTraitMechanicRegistry.parseAndValidateParameters`, whose range checks Java has already run. */
  static from(stableKey: string, schemaText: string, parametersJson: string): TraitParameters {
    const parameters = new TraitParameters();
    if (schemaText === "none") return parameters;
    const raw = JSON.parse(parametersJson) as Record<string, unknown>;
    for (const token of schemaText.split(";")) {
      const separator = token.indexOf(":");
      const key = token.slice(0, separator);
      const type = token.slice(separator + 1);
      const value = raw[key];
      if (type.startsWith("int[")) {
        if (typeof value !== "number" || !Number.isInteger(value)) {
          throw new Error(`${stableKey}.${key} is not a schema integer: ${parametersJson}`);
        }
        parameters.integers.set(key, value);
      } else if (type.startsWith("decimal[")) {
        if (typeof value !== "number") {
          throw new Error(`${stableKey}.${key} is not a schema decimal: ${parametersJson}`);
        }
        parameters.decimals.set(key, value);
      } else if (type === "boolean") {
        if (typeof value !== "boolean") {
          throw new Error(`${stableKey}.${key} is not a schema boolean: ${parametersJson}`);
        }
        parameters.booleans.set(key, value);
      } else if (type === "string") {
        if (typeof value !== "string") {
          throw new Error(`${stableKey}.${key} is not a schema string: ${parametersJson}`);
        }
        parameters.strings.set(key, value);
      } else if (type.startsWith("string_list[")) {
        if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
          throw new Error(`${stableKey}.${key} is not a schema string list: ${parametersJson}`);
        }
        parameters.stringLists.set(key, [...(value as string[])]);
      } else {
        throw new Error(`Unknown trait parameter schema type for ${stableKey}: ${type}`);
      }
    }
    return parameters;
  }

  integer(key: string): number {
    const value = this.integers.get(key);
    if (value === undefined) throw new Error(`Trait parameter is not an integer: ${key}`);
    return value;
  }

  decimal(key: string): number {
    const value = this.decimals.get(key);
    if (value === undefined) throw new Error(`Trait parameter is not a decimal: ${key}`);
    return value;
  }

  bool(key: string): boolean {
    const value = this.booleans.get(key);
    if (value === undefined) throw new Error(`Trait parameter is not a boolean: ${key}`);
    return value;
  }

  string(key: string): string {
    const value = this.strings.get(key);
    if (value === undefined) throw new Error(`Trait parameter is not a string: ${key}`);
    return value;
  }

  stringList(key: string): readonly string[] {
    const value = this.stringLists.get(key);
    if (value === undefined) throw new Error(`Trait parameter is not a string list: ${key}`);
    return value;
  }

  contains(key: string): boolean {
    return (
      this.integers.has(key) ||
      this.decimals.has(key) ||
      this.booleans.has(key) ||
      this.strings.has(key) ||
      this.stringLists.has(key)
    );
  }

  get size(): number {
    return (
      this.integers.size +
      this.decimals.size +
      this.booleans.size +
      this.strings.size +
      this.stringLists.size
    );
  }
}

/** `PetTraitMechanicSpec`: one trait's executable identity and its typed parameters. */
export class TraitMechanicSpec {
  readonly runtimeId: number;
  readonly stableKey: string;
  readonly slotType: string;
  readonly family: string;
  readonly parameterSchema: string;
  readonly parameters: TraitParameters;
  readonly parametersJson: string;
  readonly provenance: string;
  private readonly hooks: ReadonlySet<string>;

  constructor(row: PackTraitMechanic) {
    this.runtimeId = row.runtimeId;
    this.stableKey = row.stableKey;
    this.slotType = row.slotType;
    this.family = row.family;
    this.parameterSchema = row.parameterSchema;
    this.parametersJson = row.parametersJson;
    this.provenance = row.provenance;
    this.hooks = new Set(row.hooks);
    this.parameters = TraitParameters.from(row.stableKey, row.parameterSchema, row.parametersJson);
  }

  hasHook(hook: PetTraitHook): boolean {
    return this.hooks.has(hook);
  }

  hooksOf(): ReadonlySet<string> {
    return this.hooks;
  }
}

/**
 * `PetTraitMechanicRegistry` plus the rollable-pool gate beside it, read from the two tables the Java
 * registry and catalogue exported. Ids answer by position, and `registry.physical(-1)` is how the
 * engine spells "this pet wears no talent", so an id outside the table answers undefined.
 */
export class TraitMechanicRegistry {
  private readonly physical: (TraitMechanicSpec | undefined)[];
  private readonly species: (TraitMechanicSpec | undefined)[];
  private readonly rollWeight = new Map<number, number>();
  /** `PetTraitRoller.traits`, the physical pool in catalogue order the weighted scan walks. */
  private readonly rollPool: { runtimeId: number; rollWeight: number }[];
  /** `PetTraitRoller.totalWeight`, the divisor of the entropy floor-mod. */
  private readonly rollTotalWeight: number;

  private constructor(
    mechanics: PackTraitMechanics,
    pool: readonly PackTrait[],
    /** `PetTraitMechanicsProfile.token`. */
    readonly profile: string,
    /** `PetTraitMechanicsProfile.verificationEnabled`, which is the dispatcher's whole on-switch. */
    readonly dispatcherEnabled: boolean,
  ) {
    this.physical = TraitMechanicRegistry.index(mechanics.physical, PHYSICAL_SLOT);
    this.species = TraitMechanicRegistry.index(mechanics.species, "species");
    for (const row of pool) this.rollWeight.set(row.runtimeId, row.rollWeight);
    if (this.physical.length !== pool.length) {
      throw new Error(
        `battle/pet-trait-mechanics.json carries ${this.physical.length} physical traits and` +
          ` battle/pet-physical-traits.json carries ${pool.length}`,
      );
    }
    // `PetTraitRoller`'s constructor refuses a negative weight and a zero total before it can roll.
    this.rollPool = pool.map((row) => ({ runtimeId: row.runtimeId, rollWeight: row.rollWeight }));
    let weight = 0;
    for (const trait of this.rollPool) {
      if (trait.rollWeight < 0) {
        throw new Error(`Physical Pet trait has invalid roll weight: ${trait.runtimeId}`);
      }
      weight += trait.rollWeight;
    }
    if (weight <= 0) throw new Error("Physical Pet trait roll pool is empty.");
    this.rollTotalWeight = weight;
  }

  private static index(
    rows: readonly PackTraitMechanic[],
    slotType: string,
  ): (TraitMechanicSpec | undefined)[] {
    const specs: (TraitMechanicSpec | undefined)[] = [];
    for (const row of rows) {
      if (row.slotType !== slotType) {
        throw new Error(`${row.stableKey} is declared ${row.slotType}, not ${slotType}`);
      }
      if (specs[row.runtimeId] !== undefined) {
        throw new Error(`two ${slotType} traits claim runtime id ${row.runtimeId}`);
      }
      specs[row.runtimeId] = new TraitMechanicSpec(row);
    }
    for (let id = 0; id < specs.length; id++) {
      if (specs[id] === undefined) throw new Error(`no ${slotType} trait for runtime id ${id}`);
    }
    return specs;
  }

  static async load(data: GameData): Promise<TraitMechanicRegistry> {
    const [mechanics, pool] = await Promise.all([data.traitMechanics(), data.physicalTraits()]);
    return new TraitMechanicRegistry(
      mechanics,
      pool,
      mechanics.profile,
      mechanics.dispatcherEnabled,
    );
  }

  /** `PetTraitMechanicRegistry.physical`. */
  physicalSpec(runtimeId: number): TraitMechanicSpec | undefined {
    return runtimeId < 0 ? undefined : this.physical[runtimeId];
  }

  /** `PetTraitMechanicRegistry.species`. */
  speciesSpec(runtimeId: number): TraitMechanicSpec | undefined {
    return runtimeId < 0 ? undefined : this.species[runtimeId];
  }

  /**
   * `PetTraitCatalog.isPhysicalTraitAllowed`. A talent the roll cannot produce is not wearable, which
   * is what keeps the two form-owned characteristics out of the physical path entirely: they answer
   * false here and are reachable only through `characteristicTraitId`.
   */
  isPhysicalTraitAllowed(physicalTraitId: number): boolean {
    return (this.rollWeight.get(physicalTraitId) ?? 0) > 0;
  }

  /** `PetTraitRoller.totalWeight`, the size of the weighted pool the entropy is taken modulo. */
  get totalWeight(): number {
    return this.rollTotalWeight;
  }

  /**
   * `PetTraitRoller.roll(entropy)`. `Math.floorMod(entropy, totalWeight)` then a scan of the pool in
   * catalogue order that stops at the first talent whose own weight covers the running index. The
   * entropy is a `bigint` because the recorded sweep reaches `Long.MIN_VALUE` and `Long.MAX_VALUE`,
   * which a JS number would round to a different integer the floor-mod could not recover.
   */
  roll(entropy: bigint): number {
    const modulus = BigInt(this.rollTotalWeight);
    let selected = ((entropy % modulus) + modulus) % modulus;
    for (const trait of this.rollPool) {
      if (trait.rollWeight > 0 && selected < BigInt(trait.rollWeight)) return trait.runtimeId;
      selected -= BigInt(trait.rollWeight);
    }
    throw new Error("Physical Pet trait weighted selection overflowed.");
  }

  /** `PetTraitRoller.valid`, which additionally refuses a talent outside the array or with no weight. */
  valid(physicalTraitId: number): boolean {
    if (physicalTraitId < 0 || physicalTraitId >= this.physicalCount) return false;
    return this.rollWeight.get(physicalTraitId)! > 0;
  }

  /** `PetTraitCatalog.sanitizePhysicalTraitId`, collapsing an unrollable or exclusive id to the neutral 0. */
  sanitizePhysicalTraitId(physicalTraitId: number): number {
    if (physicalTraitId < 0 || physicalTraitId >= this.physicalCount) return 0;
    if (this.rollWeight.get(physicalTraitId) === 0) return 0;
    return this.isPhysicalTraitAllowed(physicalTraitId) ? physicalTraitId : 0;
  }

  /**
   * The talent a pet of this identity carries, for a port that has to replay the draw.
   *
   * Java draws from `ThreadLocalRandom` (`PetTraitRoller.rollNew`), so a Java roll has no seed to
   * agree with and, just as importantly, takes nothing from the battle's own draw stream. A replayable
   * port needs both: this mixes the fields a pet is known by the way Java's save migration mixes its
   * fields (see `traitRollEntropy`) and reads the same weighted pool, so the same pet is rolled the
   * same talent in every replay while the battle's draws stay Java's.
   */
  rollFromIdentity(fields: readonly (string | number)[]): number {
    return this.sanitizePhysicalTraitId(this.roll(traitRollEntropy([this.profile, ...fields])));
  }

  /**
   * `PetTraitPermanentStatResolver.project`. The one data-driven permanent-stat projection shared by
   * the outside-of-battle stat view and the in-battle reproject; a species trait only ever moves
   * agility through its own trade-off family, which no rollable pet wears here, so only the physical
   * `PERMANENT_STAT_PERCENT` branch is live and the first matching parameter wins.
   */
  projectPermanentStats(
    physicalTraitId: number,
    context: PermanentStatContext,
  ): PermanentStatContext {
    if (!this.dispatcherEnabled) return context;
    const spec = this.physicalSpec(physicalTraitId);
    if (!spec || spec.family !== "PERMANENT_STAT_PERCENT") return context;
    return new PhysicalTraitMechanics().modifyPermanentStats(spec, context);
  }

  get physicalCount(): number {
    return this.physical.length;
  }

  get speciesCount(): number {
    return this.species.length;
  }
}

/** `PetTraitEventContexts.PermanentStatContext`, reduced to the four numbers it carries. */
export type PermanentStatContext = {
  maxHp: number;
  strength: number;
  defense: number;
  agility: number;
};

/** `PetTraitEventContexts.AccuracyEvasionContext`, reduced the same way. */
export type AccuracyEvasionContext = {
  accuracyPercent: number;
  evasionPercent: number;
  /**
   * `AccuracyEvasionContext.accuracyDebuffPoints`: the Tê Liệt points the attacker is carrying, which
   * Java floors at zero on the way in and carries across every projection. No family in the ported
   * table reads it, but a projection that dropped it would answer a different context.
   */
  accuracyDebuffPoints: number;
};

/** `PetTraitEventContexts.ExperienceContext`, reduced the same way. */
export type ExperienceContext = {
  multiplierPercent: number;
  stackable: boolean;
};

/** `Integer.MAX_VALUE`, the cap every projection in `PetPhysicalTraitMechanics` answers at. */
const INT_MAX = 2147483647;

function capInt(projected: number): number {
  return projected > INT_MAX ? INT_MAX : projected;
}

/** `PetPhysicalTraitMechanics.adjustByPercent`: truncating, and with no floor at zero. */
function adjustByPercent(value: number, percent: number): number {
  return capInt(Math.trunc((value * (100 + percent)) / 100));
}

/** `PetPhysicalTraitMechanics.percentOfMaxHp`. */
function percentOfMaxHp(maxHp: number, percent: number): number {
  return capInt(Math.max(0, Math.trunc((maxHp * percent) / 100)));
}

/** `PetPhysicalTraitMechanics.positiveStat`: a stat projection never reaches zero. */
function positiveStat(value: number, percent: number): number {
  return Math.max(1, adjustByPercent(value, percent));
}

/** `PetPhysicalTraitMechanics.clampPercent`. */
function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/** `PetPhysicalTraitMechanics.belowPercent`: strict, so sitting exactly on the band does not count. */
function belowPercent(hp: number, maxHp: number, percent: number): boolean {
  return hp * 100 < Math.max(1, maxHp) * percent;
}

/**
 * `PetPhysicalTraitMechanics`: the formula behind each of the nine talent families. Nothing here owns
 * a magnitude — every number is a parameter the registry parsed out of the trait's own row — and the
 * three rolls that decide a chance family are drawn on the label Java draws them on, so a replay of a
 * recorded row answers with the roll that row recorded.
 *
 * The two form-owned families are declared supported and left unimplemented on purpose: `requireFamily`
 * turns them away at the hook that would run them, and no rollable pet can wear one in the first
 * place. Their behaviour is a separate slice.
 */
export class PhysicalTraitMechanics {
  /** `PetPhysicalTraitMechanics.modifyPermanentStats`: one parameter, one stat, first match wins. */
  modifyPermanentStats(
    spec: TraitMechanicSpec,
    context: PermanentStatContext,
  ): PermanentStatContext {
    this.requireFamily(spec, "PERMANENT_STAT_PERCENT");
    const parameters = spec.parameters;
    let { maxHp, strength, defense, agility } = context;
    if (parameters.contains("max_hp_percent")) {
      maxHp = positiveStat(maxHp, parameters.integer("max_hp_percent"));
    } else if (parameters.contains("strength_percent")) {
      strength = positiveStat(strength, parameters.integer("strength_percent"));
    } else if (parameters.contains("defense_percent")) {
      defense = positiveStat(defense, parameters.integer("defense_percent"));
    } else if (parameters.contains("agility_percent")) {
      agility = positiveStat(agility, parameters.integer("agility_percent"));
    } else {
      throw unsupported(spec.stableKey, "permanent stat parameter");
    }
    return { maxHp, strength, defense, agility };
  }

  /** `PetPhysicalTraitMechanics.modifyAccuracy`: the trade-off moves accuracy and leaves evasion. */
  modifyAccuracy(spec: TraitMechanicSpec, context: AccuracyEvasionContext): AccuracyEvasionContext {
    this.requireFamily(spec, "DAMAGE_ACCURACY_TRADEOFF");
    return {
      accuracyPercent: clampPercent(
        context.accuracyPercent + spec.parameters.integer("accuracy_points"),
      ),
      evasionPercent: context.evasionPercent,
      accuracyDebuffPoints: context.accuracyDebuffPoints,
    };
  }

  /** `PetPhysicalTraitMechanics.modifyOutgoingDamage`, the other half of the same trade-off. */
  modifyOutgoingDamage(spec: TraitMechanicSpec, damage: number): number {
    this.requireFamily(spec, "DAMAGE_ACCURACY_TRADEOFF");
    if (damage <= 0) return 0;
    return Math.max(1, adjustByPercent(damage, spec.parameters.integer("damage_percent")));
  }

  /**
   * `PetPhysicalTraitMechanics.modifyIncomingDirectDamage` for the chance family. The roll is drawn
   * whether or not it passes, which is what makes the label count in a recorded row a check on the
   * port rather than a decoration.
   */
  modifyIncomingDirectDamage(
    spec: TraitMechanicSpec,
    damage: number,
    random: StatusRandom,
  ): number {
    this.requireFamily(spec, "CHANCE_INCOMING_DIRECT_DAMAGE_PERCENT");
    if (damage <= 0) return damage;
    const parameters = spec.parameters;
    const chance = parameters.integer("trigger_chance_percent");
    const roll = random(`trait.${spec.stableKey}.incoming-direct-damage`);
    if (!(roll < chance)) return damage;
    let percent: number;
    if (parameters.contains("damage_reduction_percent")) {
      percent = -parameters.integer("damage_reduction_percent");
    } else if (parameters.contains("damage_received_percent")) {
      percent = parameters.integer("damage_received_percent");
    } else {
      throw unsupported(spec.stableKey, "incoming damage percent parameter");
    }
    return Math.max(1, adjustByPercent(damage, percent));
  }

  /** `PetPhysicalTraitMechanics.afterDamage`: the two families that answer a committed HP loss. */
  afterDamage(
    spec: TraitMechanicSpec,
    receiver: DesignTraitUnit,
    hpBefore: number,
    random: StatusRandom,
  ): void {
    this.requirePhysical(spec);
    if (spec.family === "CHANCE_REVIVE_ON_FAINT") {
      this.attemptRevive(spec, receiver, hpBefore, random);
      return;
    }
    if (spec.family === "LOW_HP_SELF_DAMAGE_ONCE") {
      this.attemptLowHpLoss(spec, receiver, hpBefore, random);
      return;
    }
    throw unsupported(spec.stableKey, "after-damage mechanic family");
  }

  /** `PetPhysicalTraitMechanics.modifyExperience`: the talent's own number replaces the incoming one. */
  modifyExperience(spec: TraitMechanicSpec, context: ExperienceContext): ExperienceContext {
    this.requireFamily(spec, "EXPERIENCE_MULTIPLIER");
    return {
      ...context,
      multiplierPercent: exactPercent(spec.parameters.decimal("experience_multiplier")),
      stackable: spec.parameters.bool("stackable"),
    };
  }

  /** `PetPhysicalTraitMechanics.modifyReceivedHealing`: a negative percent can erase a heal. */
  modifyReceivedHealing(spec: TraitMechanicSpec, amount: number): number {
    this.requireFamily(spec, "HEALING_RECEIVED_PERCENT");
    if (amount <= 0) return 0;
    return Math.max(
      0,
      adjustByPercent(amount, spec.parameters.integer("healing_received_percent")),
    );
  }

  /**
   * `PetPhysicalTraitMechanics.onRoundEnd`. The cap is per round and shared, so two passive heals in
   * one round split it rather than each taking a full share.
   */
  onRoundEnd(spec: TraitMechanicSpec, subject: DesignTraitUnit, roundIndex: number): void {
    this.requireFamily(spec, "ROUND_END_PASSIVE_HEAL");
    if (!subject.alive() || this.blocked(subject, spec)) return;
    const parameters = spec.parameters;
    const missingHp = Math.max(0, subject.maxHp() - subject.hp());
    const requested = percentOfMaxHp(subject.maxHp(), parameters.integer("heal_max_hp_percent"));
    const cap = percentOfMaxHp(subject.maxHp(), parameters.integer("passive_heal_cap_percent"));
    const granted = subject.traitBattleState.claimPassiveHealing(
      roundIndex,
      Math.min(missingHp, requested),
      cap,
    );
    if (granted > 0) subject.heal(granted);
  }

  /**
   * `PetPhysicalTraitMechanics.requireSupported`, which the dispatcher runs over every physical id it
   * is built with. Declaring a family supported is not implementing it: the two form-owned ones are
   * listed here and turned away by `requireFamily` at the hooks that would run them.
   */
  requireSupported(spec: TraitMechanicSpec | undefined): void {
    this.requirePhysical(spec);
    switch (spec!.family as PhysicalTraitFamily) {
      case "NO_EFFECT":
      case "PERMANENT_STAT_PERCENT":
      case "HEALING_RECEIVED_PERCENT":
      case "ROUND_END_PASSIVE_HEAL":
      case "DAMAGE_ACCURACY_TRADEOFF":
      case "CHANCE_INCOMING_DIRECT_DAMAGE_PERCENT":
      case "CHANCE_REVIVE_ON_FAINT":
      case "EXPERIENCE_MULTIPLIER":
      case "LOW_HP_SELF_DAMAGE_ONCE":
      case "AGILITY_OUTRANK_PRIORITY_DAMAGE_BONUS":
      case "HARD_CONTROL_IMMUNITY_DIRECT_DAMAGE_REDUCTION":
        return;
      default:
        throw unsupported(spec!.stableKey, "physical mechanic family");
    }
  }

  /** `PetPhysicalTraitMechanics.blocked`: any one of the named canonical statuses is enough. */
  private blocked(unit: DesignTraitUnit, spec: TraitMechanicSpec): boolean {
    for (const statusKey of spec.parameters.stringList("blocked_by")) {
      if (unit.traitBattleState.hasCanonicalStatus(statusKey)) return true;
    }
    return false;
  }

  /**
   * `PetPhysicalTraitMechanics.attemptRevive`. The use is spent only on a revive that lands, so a
   * failed roll leaves the talent available for the next faint.
   */
  private attemptRevive(
    spec: TraitMechanicSpec,
    unit: DesignTraitUnit,
    hpBefore: number,
    random: StatusRandom,
  ): void {
    const parameters = spec.parameters;
    const maximumUses = parameters.integer("max_uses_per_battle");
    if (hpBefore <= 0 || unit.hp() > 0 || !unit.traitBattleState.canUseRevive(maximumUses)) return;
    const roll = random(`trait.${spec.stableKey}.revive`);
    if (!(roll < parameters.integer("trigger_chance_percent"))) return;
    const reviveHp = Math.max(
      1,
      percentOfMaxHp(unit.maxHp(), parameters.integer("revive_hp_percent")),
    );
    unit.reviveTo(reviveHp);
    unit.traitBattleState.recordReviveUse();
  }

  /**
   * `PetPhysicalTraitMechanics.attemptLowHpLoss`: the crossing of the band, in one direction, once per
   * battle. The attempt is claimed before the roll, so a failed roll still spends it — and the claim
   * is what makes the second crossing in the same battle inert.
   */
  private attemptLowHpLoss(
    spec: TraitMechanicSpec,
    unit: DesignTraitUnit,
    hpBefore: number,
    random: StatusRandom,
  ): void {
    if (hpBefore <= 0 || unit.hp() <= 0) return;
    const parameters = spec.parameters;
    const threshold = parameters.integer("hp_below_percent");
    if (belowPercent(hpBefore, unit.maxHp(), threshold)) return;
    if (!belowPercent(unit.hp(), unit.maxHp(), threshold)) return;
    if (!unit.traitBattleState.claimLowHpThresholdAttempt()) return;
    if (parameters.integer("max_uses_per_battle") !== 1) {
      throw unsupported(spec.stableKey, "low-HP trigger requires one attempt per battle");
    }
    const roll = random(`trait.${spec.stableKey}.low-hp-loss`);
    if (!(roll < parameters.integer("trigger_chance_percent"))) return;
    const loss = percentOfMaxHp(unit.maxHp(), parameters.integer("lose_max_hp_percent"));
    const minimumHp = Math.max(1, parameters.integer("minimum_hp"));
    unit.setHp(Math.max(minimumHp, unit.hp() - loss));
  }

  private requireFamily(spec: TraitMechanicSpec, family: PhysicalTraitFamily): void {
    this.requirePhysical(spec);
    if (spec.family !== family) {
      throw unsupported(spec.stableKey, `expected family ${family}`);
    }
  }

  private requirePhysical(spec: TraitMechanicSpec | undefined): void {
    if (!spec || spec.slotType !== PHYSICAL_SLOT) {
      throw new Error("Physical trait mechanic spec is required.");
    }
  }
}

/** `PetSaveTraitMigration.FNV_OFFSET` and `FNV_PRIME`, as unsigned 64-bit values. */
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const UINT64 = 0xffffffffffffffffn;

/**
 * The salt a web roll is keyed by. It is deliberately not Java's `pet-trait-old-save-roll-v1`: that
 * one is the migration's own, and mixing it in would suggest a bit-for-bit agreement with a Java
 * migration that this port makes no claim to — Java's live roll is `ThreadLocalRandom`, unmatchable.
 */
const TRAIT_ROLL_SALT = "pet-trait-deterministic-roll-v1";

/** `PetSaveTraitMigration.mix(long, String)`: FNV-1a over the field's UTF-8 bytes. */
function fnvBytes(hash: bigint, value: Uint8Array): bigint {
  for (const byte of value) hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & UINT64;
  return hash;
}

/** `PetSaveTraitMigration.mix(long, int)`: the same walk over the value's four bytes. */
function fnvInt(hash: bigint, value: number): bigint {
  const unsigned = BigInt(value) & 0xffffffffn;
  for (const shift of [0n, 8n, 16n, 24n]) {
    hash = ((hash ^ ((unsigned >> shift) & 0xffn)) * FNV_PRIME) & UINT64;
  }
  return hash;
}

/**
 * The entropy a pet of this identity rolls to: Java's migration mixer — FNV-1a over the salt and each
 * field in order, then splitmix64's finalizer — over `pet-trait-deterministic-roll-v1`, the salt, the
 * registry profile and the caller's own field list.
 */
export function traitRollEntropy(fields: readonly (string | number)[]): bigint {
  const encoder = new TextEncoder();
  let hash = FNV_OFFSET;
  for (const field of [TRAIT_ROLL_SALT, ...fields]) {
    hash =
      typeof field === "number"
        ? fnvInt(hash, Math.trunc(field))
        : fnvBytes(hash, encoder.encode(field));
  }
  hash ^= hash >> 30n;
  hash = (hash * 0xbf58476d1ce4e5b9n) & UINT64;
  hash ^= hash >> 27n;
  hash = (hash * 0x94d049bb133111ebn) & UINT64;
  return (hash ^ (hash >> 31n)) & UINT64;
}
