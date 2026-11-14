import type { SignatureFxDocument, SkillFxDocument } from "../game/battle/SkillFx";
import type { DoubleSkillRules } from "../game/battle/engine/DoubleBattleTypes";
import type { SourceSkillAnimationDocument } from "../game/battle/SourceSkillAnimation";
import type { StateOneLEffectDocument } from "../game/battle/StateOneLEffect";
import type { Pack } from "../pack/Pack";

/**
 * One Pet's growth formula as the shipped stat profile holds it: a fixed-point level-one anchor and
 * the numerator that carries the value from level one to the profile's growth denominator.
 */
export type PackGrowthFormula = { baseLevelOneX10: number; growthNumeratorX10: number };

/** The unified catalog record columns the stat profile reads for a species in ids 100..201. */
export type PackUnifiedPetRecord = {
  runtimeId: number;
  stableKey: string;
  name: string;
  description: string;
  sourceGameId: number;
  elementId: number;
  elementKey: string;
  speciesId: number;
  speciesKey: string;
  speciesTraitId: number;
  speciesTraitKey: string;
  defaultQuality: number;
  rarity: number;
  visualId: number;
  spriteGroup: number;
  spriteVariant: number;
  locationsJson: string;
  acquisitionCode: string;
  provenanceJson: string;
  balanceVersion: string;
  base: number[];
  growth: number[];
  offset: number[];
  perTenLevels: boolean[];
};

/** The V4 profile anchors for a species in ids 202..273: the stat at level one and at level fifty. */
export type PackV4PetProfile = {
  runtimeId: number;
  petKey: string;
  classification: string;
  profileVersion: string;
  formula: string;
  provenance: string;
  levelOne: number[];
  levelFifty: number[];
};

/**
 * The boss, evolution and mutation record the engine reads this species' anchors from. Only the
 * identity is kept: the anchors themselves are exported as the growth tables below, replayed
 * against the engine before the pack was baked.
 */
export type PackSpeciesRecordIdentity = {
  runtimeId: number;
  stableKey: string;
  name: string;
  elementId: number;
  speciesId?: number;
  defaultQuality: number;
  rarity: number;
  visualId: number;
};

/**
 * The numbers the stat branch named by a species row's `statPath` actually reads. `source-row`,
 * `unified-record` and `v4-profile` carry a formula the Web port reimplements; the `authored-*`
 * kinds carry the constants that used to live only inside a record class.
 */
export type PackSpeciesGrowth =
  | ({ kind: "source-row"; speciesId: number } & Record<
      "hp" | "strength" | "defense" | "agility",
      PackGrowthFormula
    >)
  | { kind: "unified-record"; record: PackUnifiedPetRecord }
  | { kind: "v4-profile"; record: PackV4PetProfile }
  | {
      kind: "authored-quality-line";
      record: PackSpeciesRecordIdentity;
      growthDenominator: number;
      levelOne: number[][];
      levelFifty: number[][];
    }
  | {
      kind: "authored-five-star-line";
      record: PackSpeciesRecordIdentity;
      growthDenominator: number;
      qualityPercent: number[];
      fiveStarPercent: number;
      fiveStarLevelOne: number[];
      fiveStarLevelFifty: number[];
    }
  | {
      kind: "authored-flat";
      record: PackSpeciesRecordIdentity;
      stats: number[];
      levelAtFullStats?: number;
    };

/** Which branch of `BattleSpeciesRow.rawStat` resolves this species' own-form stat. */
export type PackSpeciesStatPath =
  | "sourceGrowthRow"
  | "unifiedRecord"
  | "unifiedV4Profile"
  | "mutation"
  | "thienLuanMutation"
  | "customBoss"
  | "kimDiemBoss"
  | "hoaDiemEvolution"
  | "thienViemEvolution"
  | "huyenThietEvolution";

/**
 * One species exactly as `VqsvBattleTables.species(id)` resolved it: identity and metadata, the
 * quality the source row authors, the stat branch the engine takes, and that branch's numbers.
 * This is the only place a species' data lives; the golden tables grade it and are never read as
 * arithmetic input.
 */
export type PackSpeciesRow = {
  speciesId: number;
  name: string;
  nameTextId: number;
  element: number;
  spriteId: number;
  rarity: number;
  relationClass: number;
  evolutionKind: number;
  learnGroup: number;
  evolutionSpeciesId: number;
  evolutionMaterialId: number;
  evolutionMaterialNeed: number;
  baseHp: number;
  qualityColumn: number;
  defaultQuality: number;
  validForBattle: boolean;
  releaseProtected: boolean;
  statPath: PackSpeciesStatPath;
  /** The ancestors whose own-form stats raise a floor on this species, as the engine walks them. */
  statAncestorIds: number[];
  growth: PackSpeciesGrowth;
  provenance: { producer: string; record: string };
};

/** Every species the engine can resolve, plus the fixed-point scale its growth rows are read with. */
export type PackSpeciesCatalog = {
  schema: string;
  profile: string;
  resource: string;
  valueScale: number;
  growthDenominator: number;
  rowWidth: number;
  minLevel: number;
  maxLevel: number;
  statChannels: { growthStat: string; battleStat: string }[];
  rowLayout: string;
  speciesCount: number;
  rows: PackSpeciesRow[];
};

/** The stable key the record behind this species carries, or undefined for a binary source row. */
export function speciesPetKey(row: PackSpeciesRow): string | undefined {
  if (row.growth.kind === "source-row") return undefined;
  return row.growth.kind === "v4-profile" ? row.growth.record.petKey : row.growth.record.stableKey;
}

/** The quality scale: its bounds, the neutral level, and the stat percent each level applies. */
export type PackPetQuality = { MIN: number; MAX: number; NEUTRAL: number; STAT_PERCENT: number[] };

/** `PetLevel`: the cap an ordinary pet or enemy level is clamped to. */
export type PackPetLevel = { MAX: number };

/**
 * `CauVongPetLevel`: the one scene whose authored content is levelled past the pet cap, and by how
 * much. An owned pet or a captured one never gets the bonus, so this is an enemy-side rule only.
 */
export type PackCauVongPetLevel = {
  SCENE_ID: number;
  BONUS: number;
  MAX_ENEMY_LEVEL: number;
};

export type PackSkill = {
  runtimeId: number;
  stableKey: string;
  name: string;
  description: string;
  combatElement: string;
  combatElementId: number;
  speciesAffinity: string;
  combatCategory: string;
  targetPattern: string;
  effectTargetPattern: string;
  battleFormat: string;
  effectKey: string;
  mechanicsType: string;
  tier: number;
  power: number;
  pp: number;
  statusChance: number;
  targetSide: number;
  status: string;
  duration: number;
  value: number;
  cap: number;
  chance: number;
  conditionalPower: number;
  secondaryValue: number;
  secondaryStatus: string;
  secondaryDuration: number;
  minimumPower: number;
  maximumPower: number;
  heal: number;
  sourceGameId: number;
  balanceVersion: string;
  mechanicsJson: string;
  secondaryStatusesJson: string;
  provenanceJson: string;
};

/**
 * One skill id exactly as `VqsvBattleTables.skill(id)` resolved it, after the three skill sources
 * competed for it. `damageBranch` names the branch `BattleUnit.computeDamage` takes for the row, so
 * a wrong power or a wrong status chance can be traced to the branch instead of argued from a guess.
 */
export type PackSkillRow = {
  skillId: number;
  stableKey: string;
  name: string;
  elementFamily: number;
  powerPercent: number;
  learnTier: number;
  ppMax: number;
  effectMode: number;
  effectId: number;
  chanceOrParam: number;
  targetSide: number;
  nameTextId: number;
  descriptionTextId: number;
  damageBranch: "unified" | "liet-hoa" | "source";
};

/** Every skill id the engine resolves, plus the skill profile the dump was taken under. */
export type PackSkillRowCatalog = {
  schema: string;
  skillProfile: string;
  scanLimit: number;
  rowLayout: string;
  branchCounts: Record<string, number>;
  skillCount: number;
  rows: PackSkillRow[];
};

/** The element pairs `BattleUnit.beats` answers true for, plus the crit-chance override per element. */
export type PackElementChart = {
  schema: string;
  note: string;
  elements: { runtimeId: number; stableKey: string; displayName: string }[];
  beats: [number, number][];
  sourceFinalVisualByElement: { element: number; visualSpriteId: number }[];
};

/** What one Liệt Hỏa debuff does when it is on a unit. */
export type PackDebuffRule = {
  id: number;
  duration: number;
  primary: number;
  secondary: number;
  actionCharges: number;
};

/** The skill that can put one Liệt Hỏa debuff on a target, and how often it tries. */
export type PackDebuffProducer = {
  skillId: number;
  debuffId: number;
  chance: number;
  duration: number;
  primary: number;
  secondary: number;
  conditionalPower: number;
};

/** The Liệt Hỏa debuff contracts, indexed by debuff id and by source skill id. */
export type PackDebuffProducers = {
  schema: string;
  balanceVersion: string;
  note: string;
  rules: PackDebuffRule[];
  producerArrayLength: number;
  producerHoles: number;
  producers: PackDebuffProducer[];
};

/** What one Liệt Hỏa buff stores on the unit that holds it. */
export type PackBuffRule = {
  id: number;
  duration: number;
  primary: number;
  secondary: number;
  stackCap: number;
  actionCharges: number;
};

/** The magnitude a buff is applied with when no skill overrides it. */
export type PackBuffProducerDefault = { buffId: number; valuePercent: number; stacks: number };

/** A skill that applies a buff with a magnitude of its own instead of the rule's. */
export type PackBuffProducerValueOverride = {
  buffId: number;
  skillId: number;
  valuePercent: number;
};

/** A skill that adds more than one stack of a buff in a single application. */
export type PackBuffProducerStackOverride = { buffId: number; skillId: number; stacks: number };

/**
 * Where the percent a stored buff magnitude carries comes from. `rulePrimaryPerStack` is the rule
 * primary times the stack count the engine resolves — `min(stackCap, stacks already held + the
 * stacks this application brings)` — so the cap only bites on a unit that is not fresh.
 */
export type PackStoredPercentFrom =
  "literal" | "rulePrimary" | "ruleSecondary" | "rulePrimaryPerStack" | "producerValue";

/**
 * What that percent is taken of. Every stat here is the unit's *base* one, never the projected one,
 * so a magnitude can be computed before the rest of the unit's statuses are known. `none` stores the
 * percent itself as the magnitude.
 */
export type PackStoredStat = "none" | "maxHp" | "baseAttack" | "baseDefense" | "baseSpeed";

/**
 * One magnitude `applySourceBuff` writes into a legacy slot column, or into the heal it returns.
 * `percent` carries the number for a literal and is 0 for the other sources, which read theirs from
 * `buffRules` or from the producer overrides at apply time.
 */
export type PackBuffStoredValue = {
  percentFrom: PackStoredPercentFrom;
  percent: number;
  stat: PackStoredStat;
};

/** One buff's whole storage contract, written the way the engine's own switch writes it. */
export type PackBuffStorage = {
  buffId: number;
  installs: boolean;
  primary: PackBuffStoredValue | null;
  secondary: PackBuffStoredValue | null;
  heal: PackBuffStoredValue | null;
  clearsOneDebuff: boolean;
  clearsDebuffs: boolean;
};

/** The grid the storage contract was replayed over before the bake was allowed to write it. */
export type PackBuffStoredValueVerification = {
  speciesIds: number[];
  levels: number[];
  cells: number;
  applications: number;
  percentSpace: number;
  stackSeeds: number[];
  separatedMagnitudes: number;
};

/** Where a finished skill goes next: which status it applies, to whom, and on what condition. */
export type PackPostSkillRoute = {
  skillId: number;
  mode: string;
  effectId: number;
  buffOwner: string;
  buffId: number;
  buffIdWhenAttackMissed: number;
  copyTargetBuffs: boolean;
  noDamageDebuff: boolean;
  targetsSelf: boolean;
  leechGateChance: number;
};

/**
 * The buff side of the frozen Liệt Hỏa contract, plus the three engine decisions the status
 * lifecycle reads: the magnitude each buff actually stores on the unit, which skill applies which
 * buff to whom, and which active statuses the round-start pass shows an effect for.
 */
export type PackStatusMechanics = {
  schema: string;
  balanceVersion: string;
  scanLimit: number;
  note: string;
  buffRules: PackBuffRule[];
  buffProducerDefaults: PackBuffProducerDefault[];
  buffProducerValueOverrides: PackBuffProducerValueOverride[];
  buffProducerStackOverrides: PackBuffProducerStackOverride[];
  buffStoredValues: PackBuffStorage[];
  buffStoredValueVerification: PackBuffStoredValueVerification;
  debuffActionSelfHitChance: { debuffId: number; chance: number }[];
  debuffImmediatePower: {
    skillId: number;
    powerPercent: number;
    powerPercentWhenTargetAlreadyAffected: number;
  }[];
  postSkillRoutes: PackPostSkillRoute[];
  activeVisualIdsByBank: Record<string, number[]>;
  statusPresentation: PackStatusPresentation;
};

/** `battle/status-web-rules.json`: what the web build adds or changes on the Java-baked tables. */
export type PackStatusWebRules = {
  schema: "vqsv-web-status-rules-v1";
  note: string;
  sucLuc: { buffId: number };
  electricPp: { buffId: number; ppPerSkill: number };
  followUpHit: { buffId: number };
  turnSkip: { bank: number; id: number; chance: number; name: string }[];
  rainbowDebuffs: {
    id: number;
    name: string;
    skipsNextAction?: boolean;
    damageTakenPercent?: number;
    damageDealtPercent?: number;
    locksSwitchAndItems?: boolean;
    rampPercent?: number;
    wakesOnDirectDamage?: boolean;
  }[];
};

/**
 * One strip slot's identity, read off `BattleStatusPresentationProjector` by the bake: the picture
 * Java cuts from the Liệt Hỏa sheet, or the resource it loads for a Cầu Vồng identity, plus the name
 * it prints beside it. The two numbers that decide those cells — `id + 12` for a buff and `id + 1` for
 * a debuff, with the signature identities aliased onto another buff's artwork — are the projector's
 * alone, which is why they are harvested rather than restated here.
 *
 * A row with `visible` false is the source's own answer, not a gap in the bake: the identity has no
 * definition at all, or the projector refuses it, as it does for the reserved and alias-only Cầu Vồng
 * ids, so the strip never shows it. Only `openingSuppression` carries `actionOwnedDuration`, because
 * that badge is drawn from an action counter rather than from a status.
 */
export type PackStatusIdentity = {
  sourceBank: number;
  sourceNumericId: number;
  visible: boolean;
  stableKey?: string;
  displayName?: string;
  iconKind?: string;
  lietHoaAtlasCell?: number;
  resourcePath?: string;
  /** The bytes the Java classpath holds for `resourcePath`, absent when the path is empty. */
  resourceSha256?: string;
  actionOwnedDuration?: boolean;
};

/**
 * `VqsvBattleRenderer.durationCell` sampled over the durations a battle can hand it. The renderer owns
 * the arithmetic that picks the numeral badge drawn over a strip icon, so the Web reads this mapping
 * instead of restating it. Outside the sampled range the badge does not change — the bake refuses the
 * harvest if it still moves at either end — so a lookup clamps `duration` into the sample.
 */
export type PackStatusDurationBadge = {
  sampleMin: number;
  sampleMax: number;
  /** The cell every duration past `sampleMax` draws, kept so a clamped lookup is checked against it. */
  saturatedCell: number;
  cells: { duration: number; cell: number }[];
};

/** The whole identity table, with the two numbers the walk itself reads: the cap and the bank order. */
export type PackStatusPresentation = {
  maxVisible: number;
  bankOrder: number[];
  openingSuppression: PackStatusIdentity;
  rows: PackStatusIdentity[];
  durationBadge: PackStatusDurationBadge;
};

/**
 * One species' characteristic as the runtime catalog holds it: the mechanic type the trait
 * mechanics dispatch on, and the one number that mechanic reads. `sourceValue` is the number the
 * user's design sheet authored and `effectMultiplier` what `PetDesignTraitBalanceOverrides` lifts
 * it by, so a balance change can be traced to the row it came from.
 */
export type PackDesignTrait = {
  key: string;
  petKey: string;
  speciesId: number;
  name: string;
  type: string;
  value: number;
  sourceValue: number;
  effectMultiplier: number;
  description: string;
};

/**
 * One row of the web-native balance layer over `PackDesignTrait`. The Java export keeps the
 * structure; this row replaces its `value` and `description` and adds the `unit` the value is
 * counted in, which the Java row does not carry at all.
 */
export type PackDesignTraitBalance = {
  speciesId: number;
  petKey: string;
  key: string;
  pet: string;
  name: string;
  group: string;
  type: string;
  factor: number;
  sourceValue: number;
  value: number;
  unit: string;
  limits: DesignTraitLimits;
  description: string;
  matchesJavaExport: boolean;
  /** HV-01 / TL-01: the form characteristic a mutation pet fights with instead of its workbook row. */
  exclusiveTrait?: string;
  /** HV-01: rounds the window stays shut after its bonus lands. */
  cooldownTurns?: number;
  /** TL-01: the control statuses that never take hold, by canonical name. */
  immuneStatuses?: string[];
};

/** The workbook's two ceiling policies, spelled out once in `limitsText` instead of 280 times. */
export type DesignTraitLimits = "capsRemoved" | "damageReductionCappedAt100";

export type PackDesignTraitBalanceTable = {
  schema: string;
  source: {
    workbook: string;
    sha256: string;
    sheet: string;
    sheetRows: string;
    balanceVersion: string;
    bossVersion: string;
    traitCount: number;
    overriddenCount: number;
    transcribed: string;
    javaExport: string;
    /** Why species 274 and 275 carry HV-01 and TL-01 instead of their workbook rows. */
    exclusiveTraits: string;
    note: string;
  };
  /**
   * The one place the web port knowingly diverges from Java: for these families the workbook
   * authors flat Power added to the skill's own power, while Java multiplies the computed damage
   * by a percent capped at 40. Java has no flat-Power path, so it cannot referee these numbers.
   */
  powerRule: {
    families: string[];
    unit: string;
    overriddenCount: number;
    web: string;
    java: string;
    cap: string;
    divergence: string;
    unresolved: string;
  };
  strengthRule: {
    formula: string;
    damageReductionCapPercent: number;
    clampedCount: number;
    limitsCounts: Record<string, number>;
    note: string;
  };
  limitsText: Record<DesignTraitLimits, string>;
  boss: {
    speciesId: number;
    pet: string;
    name: string;
    group: string;
    type: string;
    value: string;
    unit: string;
    description: string;
    limits: string;
    version: string;
    scope: string;
  };
  traits: PackDesignTraitBalance[];
};

export type PackItem = {
  runtimeId: number;
  stableKey: string;
  sourceKey: string;
  name: string;
  description: string;
  category: string;
  inventoryKind: string;
  usageScope: string;
  equipmentSlot: string;
  mechanicKey: string;
  iconResource: string;
  frameId: number;
  sourceGameId: number;
  sourceTable: number;
  mechanicsImplemented: boolean;
  balanceVersion: string;
  effectParametersJson: string;
  provenanceJson: string;
};

export type PackStatus = {
  stableKey: string;
  semanticKey: string;
  displayName: string;
  kind: string;
  sourceBank: number;
  sourceNumericId: number;
  stackCap: number;
  consumePolicy: string;
  refreshPolicy: string;
  tickPhase: string;
  /** Other keys skill rows use for the same status (Cầu Vồng and V4 copies of one identity). */
  aliases?: string[];
};

export type PackTrait = {
  runtimeId: number;
  stableKey: string;
  name: string;
  description: string;
  polarity: string;
  slotType: string;
  rollWeight: number;
  cleanseEligible: boolean;
  species: number | null;
  provenance: string;
  parametersJson: string;
};

/**
 * One trait description the web port spells differently from Java, and the Java text it replaces.
 * The original is carried beside the replacement so the guard can prove the edit is the rename it
 * claims to be rather than a rewrite of the whole sentence.
 */
export type PackTraitDescriptionBalance = {
  /** A `document()` path, so one table can override rows in more than one Java export. */
  table: string;
  stableKey: string;
  field: string;
  java: string;
  value: string;
};

export type PackTraitDescriptionBalanceTable = {
  schema: string;
  source: {
    balanceVersion: string;
    decided: string;
    javaExports: string[];
    note: string;
  };
  /** The rename rule, longest `from` first, so the guard can recompute each `value` from its `java`. */
  substitutions: { from: string; to: string }[];
  overrides: PackTraitDescriptionBalance[];
};

/** The three tables `balance/data-cuts.json` filters, named by the reader that does it. */
export type DataCutReader = "statuses" | "physicalTraits" | "physicalTraitMechanics";

/**
 * One Java row the web game decided to drop. Java still exports it, so the decision has to be a
 * declaration the reader applies rather than an edit of the dump: that way a harness re-run can
 * neither resurrect the row nor lose the cut.
 */
export type PackDataCut = {
  reader: DataCutReader;
  /** A `document()` path, so the guard can name the Java file the row still lives in. */
  table: string;
  stableKey: string;
  displayName: string;
  /** Fields of the Java row this cut was written against, rechecked on every read. */
  javaIdentity: Record<string, string | number>;
  decided: string;
  reason: string;
  guardTests: string[];
};

export type PackDataCuts = {
  schema: string;
  source: { balanceVersion: string; javaExports: string[]; note: string };
  cuts: PackDataCut[];
};

/** One trait's mechanic: the family that selects its formula and the hooks that select its moments. */
export type PackTraitMechanic = {
  runtimeId: number;
  stableKey: string;
  slotType: string;
  family: string;
  hooks: string[];
  parameterSchema: string;
  parametersJson: string;
  provenance: string;
};

export type PackTraitMechanics = {
  schema: string;
  /** `PetTraitRuntimeSelector.productionDefault().token()`. */
  profile: string;
  /** `PetTraitLifecycleDispatcher.enabled()` for the shipped runtime. */
  dispatcherEnabled: boolean;
  note: string;
  rowCount: number;
  physical: PackTraitMechanic[];
  species: PackTraitMechanic[];
};

export type PackCharm = {
  runtimeId: number;
  stableKey: string;
  slot: string;
  mechanic: string;
  tierValues: number[];
  species: number | null;
  badgeUnlock: number;
  speciesBasicMaterial: number;
};

export type PackBadge = {
  runtimeId: number;
  stableKey: string;
  name: string;
  description: string;
  assetResource: string;
  enhanceable: boolean;
  hiddenUntilOwned: boolean;
};

export type PackEvolution = {
  stableKey: string;
  kind: string;
  fromPetKey: string;
  toPetKey: string;
  fromSpeciesId: number;
  toSpeciesId: number;
  requiredLevel: number;
  costRank: number;
  recipeProvenance: string;
  topologyProvenance: string;
  ingredients: {
    itemKey: string;
    name: string;
    position: number;
    quantity: number;
    role: string;
    provenance: string;
    runtimeMaterialId: number;
  }[];
};

export type PackLearnsetEntry = {
  petKey: string;
  skillKey: string;
  runtimeSkillId: number;
  unlockLevel: number;
  sortOrder: number;
  sourceType: string;
  combatRole: string;
  progressionGrade: string;
  grantSet: string;
  requiredFormPetKey: string;
  signature: boolean;
  provenance: string;
};

export type PackTaskOffer = {
  taskId: number;
  options: string[];
  rewards: { id: number; quantity: number; type: string }[];
  grantedWorldFlag: number;
  grantedQuestTokenLabel: string;
};

export type PackNpc = {
  name: string;
  line: string;
  room: number;
  x: number;
  y: number;
  sourceIndex: number;
  sourceSpriteId: number;
  initiallyVisible: boolean;
};

export type PackAcquisitionRoute = {
  petKey: string;
  name: string;
  runtimeSpeciesId: number;
  familyRoot: string;
  directRoute: string;
  collectionRoute: string;
  coverageVia: string;
  routeReference: string;
  provenance: string;
};

/** One of the five Java AI tiers; the numbers change choices, never stats. */
export type PackBattleAiProfile = {
  tier: string;
  randomness: number;
  repetitionPenalty: number;
  itemBudget: number;
  tacticalSwitch: boolean;
  healingThresholdPercent: number;
  switchCooldownTurns: number;
  switchChancePercent: number;
  mayRevive: boolean;
};

/**
 * One battle the Java engine declared, keyed by its Java constant name.
 *
 * `op32Mode`, `op37Encounter`, `op47BranchTargets` and the result indices are the source opcode
 * operands, so the Web runtime drives a fight from this row instead of from a hand-written script.
 */
export type PackBattleEvent = {
  label: string;
  sceneId: number;
  roomIndex: number;
  groupIndex: number;
  op67ActorId: number;
  op37Encounter: number[];
  battleFlags: number[];
  op32Mode: number[];
  op47BranchTargets: number[];
  sourceBattleSlice: boolean;
  npcEnemyEntry: boolean;
  simultaneous2v2: boolean;
  companionRoster: number[];
  captureSuccessResultIndex: number;
  playerDefeatResultIndex: number;
  sourceOp54Roster: boolean;
  sourceOp67: boolean;
  aiProfile: PackBattleAiProfile;
};

/**
 * One authored AI-v2 encounter policy row.
 *
 * Java resolves every TSV column to an enum before the decision path sees it, and the dump prints
 * that resolved value as `EnumName.CONSTANT`, so a profile or policy can be compared by name instead
 * of the Web port restating which strings exist.
 */
export type PackBattleAiEncounter = {
  encounterKey: string;
  profileVersion: string;
  descriptorSymbol: string;
  encounterClass: string;
  intelligenceProfile: string;
  personaKey: string;
  battleFormat: string;
  rosterPolicy: string;
  switchPolicy: string;
  itemPolicy: string;
  phasePolicy: string;
  informationPolicy: string;
  mayUseItems: boolean;
  maySwitch: boolean;
  mayRevive: boolean;
  mayPreserveAce: boolean;
  mayUsePhasePolicy: boolean;
  memoryHorizon: number;
  controlledRandomnessBand: number;
  switchCooldownTurns: number;
  maxConsecutiveNonDamageActions: number;
  provenance: string;
};

/** One authored enemy member: the species and level the roster is built from plus switch values. */
export type PackBattleAiMember = {
  encounterKey: string;
  memberSlot: number;
  petKey: string;
  sourceSpeciesId: number;
  sourceLevel: number;
  authoredEffectiveLevel: number;
  effectiveLevel: number;
  sourceNature: number;
  deckPolicy: string;
  physicalTraitMode: string;
  physicalTraitKey: string;
  teamRole: string;
  entryPriority: number;
  acePriority: number;
  switchValue: number;
  provenance: string;
};

/** One authored loadout item, legal only while its phase gate and target rule allow it. */
export type PackBattleAiItem = {
  encounterKey: string;
  itemKey: string;
  quantity: number;
  eligibleTargets: string;
  useLimit: number;
  phaseGate: string;
  provenance: string;
};

/** One authored phase the persona policy can switch to. */
export type PackBattleAiPhase = {
  encounterKey: string;
  phaseOrder: number;
  phaseKey: string;
  triggerType: string;
  triggerValue: number;
  personaModifier: string;
  provenance: string;
};

/** The persona-plus-phase projection one utility pass consumes, merged by Java itself. */
export type PackBattleAiProjection = {
  commissioned: boolean;
  encounterKey: string;
  personaKey: string;
  phaseKey: string;
  biases: string[];
  personaPreferenceBonus: number;
  phasePreferenceBonus: number;
  modifiers: Record<string, number>;
};

/** The decoded-source battle this authored encounter is locked to, and the roster digest proving it. */
export type PackBattleAiSourceLock = {
  encounterKey: string;
  descriptorSymbol: string;
  sceneId: number;
  roomIndex: number;
  groupIndex: number;
  battleOrdinal: number;
  sourceOpcode: number;
  sourceActorId: number;
  sourceRoster: string;
  sourceRosterSha256: string;
  provenance: string;
};

/** The B1 canary-activation review a Leader/Boss must carry before its decisions can commit. */
export type PackBattleAiActivationReview = {
  encounterKey: string;
  strategyFamily: string;
  activationStatus: string;
  phaseRequired: boolean;
  counterplayPlanCount: number;
  informationBoundary: string;
};

/** One encounter and everything the decision path resolves from it. */
export type PackBattleAiEncounterRow = {
  encounter: PackBattleAiEncounter;
  members: PackBattleAiMember[];
  /** Each member's authored 2v2 deck, as runtime skill ids (`applyAuthoredEnemyDeck`). */
  decks: number[][];
  items: PackBattleAiItem[];
  phases: PackBattleAiPhase[];
  projections: Record<string, PackBattleAiProjection>;
  sourceLock: PackBattleAiSourceLock | null;
  activationReview: PackBattleAiActivationReview | null;
};

/** The nine weights `BattleAiUtilityWeights.forProfile` returns for one intelligence profile. */
export type PackBattleAiProfileWeights = {
  immediatePercent: number;
  survivalPercent: number;
  setupPercent: number;
  tempoPercent: number;
  resourcePercent: number;
  futurePercent: number;
  riskPercent: number;
  repetitionPercent: number;
  switchMargin: number;
};

export type PackBattleAiCatalog = {
  profileVersion: string;
  bundleSha256: string;
  counts: {
    encounters: number;
    members: number;
    items: number;
    phases: number;
    activationReviewed: number;
  };
  profileWeights: Record<string, PackBattleAiProfileWeights>;
  encounters: PackBattleAiEncounterRow[];
};

/** Field defaults of a fresh Java `ScreenEffect`, i.e. the state every effect starts from. */
export type PackScreenEffectDefaults = {
  overlayType: number;
  overlayDone: boolean;
  barsDone: boolean;
  shakeDone: boolean;
  circleColors: number[];
  particles: unknown[];
  [field: string]: unknown;
};

/**
 * The seven stat slots a built unit carries, in Java's declared index order.
 *
 * The goldens and the engine's own arrays use this order, so a port that indexes by name still has
 * to agree on which slot is which.
 */
export type GoldenStatSlice = number[];

/** One unit as the Java engine built it, before any battle mutation. */
export type GoldenBattleUnit = {
  speciesId: number;
  level: number;
  natureType: number;
  visualSpriteId: number;
  physicalTraitId: number;
  speciesTraitId: number;
  characteristicTraitId: number;
  hp: number;
  maxHp: number;
  baseStats: GoldenStatSlice;
  currentStats: GoldenStatSlice;
  skillIds: number[];
  skillPp: number[];
  previewStats: number[];
};

/** The profile, grids and fixed inputs the golden tables were probed under. */
export type GoldenBattleMeta = {
  schema: string;
  producer: string;
  petStatProfile: string;
  skillProfile: string;
  battleTables: string;
  levelMax: number;
  statIndices: Record<string, number>;
  quality: Record<string, { statPercent: number; resolveNeutral: number }>;
  natureAppliedToHpAttackDefenseSpeed: Record<string, GoldenStatSlice>;
  enemyLevelRule: { sceneId: number; bonus: number; maxEnemyLevel: number };
  starter: {
    speciesId: number;
    level: number;
    quality: number;
    nature: number;
    physicalTraitId: number;
    note: string;
  };
};

/**
 * Species stats at every probed level, as the growth formula and quality actually resolved them, and
 * the quality the engine resolves each request to. Answers only: the species' identity, metadata and
 * growth numbers live in `battle/species.json`.
 */
export type GoldenPetStats = {
  schema: string;
  levels: number[];
  fullLevels: number[];
  species: Record<
    string,
    {
      qualityResolution: Record<string, number>;
      qualities: Record<
        string,
        {
          resolvedQuality: number;
          hp: number[];
          attack: number[];
          defense: number[];
          speed: number[];
        }
      >;
    }
  >;
  /**
   * The four stats the engine returns for each level just outside the range it accepts, keyed by
   * species, quality and level, or null where it refused the level. The clamp and the refusal are
   * behaviour the port has to match, so both are measured rather than read off the formula.
   */
  levelBounds: Record<string, Record<string, Record<string, number[] | null>>>;
  natureGrid: Record<string, Record<string, GoldenStatSlice>>;
};

/** One encounter's enemy unit, with and without the permanent physical trait's stat projection. */
export type GoldenEncounterUnits = {
  label: string;
  sceneId: number;
  roomIndex: number;
  groupIndex: number;
  encounter: number[];
  battleLevel: number;
  simultaneous2v2: boolean;
  companionRoster: number[];
  enemy: GoldenBattleUnit;
  noTrait: GoldenBattleUnit;
};

export type GoldenBattleUnits = {
  schema: string;
  presetPhysicalTraitId: number;
  note: string;
  encounters: Record<string, GoldenEncounterUnits>;
  starter: GoldenBattleUnit;
};

/** The authored encounter row as the decision probe printed it, without the pack's extra columns. */
export type GoldenBattleAiEncounter = {
  encounterKey: string;
  profileVersion: string;
  descriptorSymbol: string;
  encounterClass: string;
  intelligenceProfile: string;
  personaKey: string;
  battleFormat: string;
  switchPolicy: string;
  itemPolicy: string;
  phasePolicy: string;
  informationPolicy: string;
  mayUseItems: boolean;
  maySwitch: boolean;
  mayRevive: boolean;
  mayPreserveAce: boolean;
  mayUsePhasePolicy: boolean;
  memoryHorizon: number;
  controlledRandomnessBand: number;
  switchCooldownTurns: number;
  maxConsecutiveNonDamageActions: number;
};

/** The runtime descriptor the row's encounter was resolved from, and the roster it was clamped to. */
export type GoldenBattleAiIdentity = {
  sceneId: number;
  roomIndex: number;
  groupIndex: number;
  sourceActorId: number;
  op37Encounter: number[];
  runtimeEncounterQuality: number;
  npcEnemyEntry: boolean;
};

/**
 * The scripted state of one decision point: the turn, the HP bands, the loadout budget, the switch
 * draw, and the memory events fed to the engine before the pass ran.
 */
export type GoldenBattleAiScenario = {
  turn: number;
  activeMemberSlot: number;
  enemyHpPercent: number;
  reserveHpPercent: number;
  playerHpPercent: number;
  deadMemberSlots: number[];
  lastSkillSlot: number;
  lastSkillKey: string;
  repeatedUses: number;
  itemBudget: number;
  itemBudgetRemaining: number;
  switchRoll: number;
  zeroAllPp: boolean;
  zeroPpSlot: number;
  enemyBuffIds: number[];
  playerBuffIds: number[];
  enemyControlDebuffId: number;
  lastTacticalSwitchTurn: number;
  decisionSeed: number;
};

/** The two sides of the fight exactly as Java's `BattleUnit`s were configured for the decision. */
export type GoldenBattleAiUnits = {
  player: GoldenBattleUnit;
  enemyParty: GoldenBattleUnit[];
  aliveMembers: number[];
};

/**
 * One scripted memory write. `storedAs` is the canonical line read back out of the memory after the
 * write, so the replay feeds the resolved token value and is graded on what the memory actually kept.
 */
export type GoldenBattleAiMemoryScriptRow = {
  turn: number;
  kind: string;
  actor: string;
  target: string;
  token: string;
  value: string;
  numeric: number;
  storedAs: string;
  visible: boolean;
};

export type GoldenBattleAiMemoryCounts = {
  scripted: number;
  scriptedVisible: number;
  survivedPruning: number;
  horizonTurns: number;
};

/** The runtime's own answer: the source-v1 decision, its draws, and the action key the runtime wrote. */
export type GoldenBattleAiV1Block = {
  tier: string;
  turnsSinceSwitch: number;
  draws: string[];
  decision: GoldenBattleAiDecisionRecord;
  productionActionKey: string;
};

/**
 * One `BattleAiDecision` as the probe printed it: the ids verbatim, the stable keys they resolve to
 * through the unified catalogs, and the target's actor key (empty for a command that names none).
 */
export type GoldenBattleAiDecisionRecord = {
  type: string;
  skillId: number;
  skillKey: string;
  itemId: number;
  itemKey: string;
  switchIndex: number;
  target: string;
  score: number;
  rationale: string;
};

export type GoldenBattleAiSkillView = {
  skillKey: string;
  runtimeId: number;
  currentPp: number;
  maxPp: number;
  targetSide: number;
  exactPpKnown: boolean;
  usable: boolean;
};

export type GoldenBattleAiStatusView = {
  bank: number;
  effectId: number;
  remainingActions: number;
  stacks: number;
  stableKey: string;
};

export type GoldenBattleAiItemView = {
  itemKey: string;
  runtimeId: number;
  eligibleTargets: string;
  phaseGate: string;
  remainingUses: number;
  legalForActiveActor: boolean;
};

export type GoldenBattleAiUnitView = {
  actorKey: string;
  memberSlot: number;
  petKey: string;
  speciesId: number;
  level: number;
  active: boolean;
  alive: boolean;
  hp: number;
  maxHp: number;
  hpPercent: number;
  combatElementId: number;
  attack: number;
  defense: number;
  agility: number;
  physicalTraitKey: string;
  speciesTraitKey: string;
  skills: GoldenBattleAiSkillView[];
  statuses: GoldenBattleAiStatusView[];
};

/** The observation header, with the enum constants spelled as Java's `toString()` spells them. */
export type GoldenBattleAiObservation = {
  profileVersion: string;
  encounterKey: string;
  turn: number;
  battleFormat: string;
  intelligenceProfile: string;
  personaKey: string;
  informationPolicy: string;
  phaseKey: string;
  activeActor: string;
  turnsSinceNpcSwitch: number;
  consecutiveNonDamageActions: number;
  ownRoster: GoldenBattleAiUnitView[];
  visibleOpponents: GoldenBattleAiUnitView[];
  itemLoadout: GoldenBattleAiItemView[];
  memoryEvents: string[];
};

/** The persona-plus-phase projection the utility pass consumed. */
export type GoldenBattleAiPolicy = {
  commissioned: boolean;
  encounterKey: string;
  personaKey: string;
  phaseKey: string;
  biases: string[];
  biasesSetToString: string;
  personaPreferenceBonus: number;
  phasePreferenceBonus: number;
  modifiers: Record<string, number>;
};

/** One ranked candidate with its complete score breakdown and its rationale tokens, in order. */
export type GoldenBattleAiCandidateRow = {
  rank: number;
  actionKey: string;
  type: string;
  legality: string;
  actor: string;
  target: string;
  skillKey: string;
  skillRuntimeId: number;
  itemKey: string;
  itemRuntimeId: number;
  switchMemberSlot: number;
  evaluated: boolean;
  immediateValue: number;
  koAndSurvivalValue: number;
  statusAndSetupValue: number;
  tempoValue: number;
  ppAndResourceValue: number;
  teamFutureValue: number;
  riskCost: number;
  repetitionOrLoopCost: number;
  personaModifier: number;
  controlledJitter: number;
  finalUtility: number;
  rationaleTokens: string[];
};

export type GoldenBattleAiUtility = {
  selectedCandidateKey: string;
  fingerprint: string;
  traceLine: string;
};

/** The anti-omniscience invariant the probe asserts on every row before it writes the table. */
export type GoldenBattleAiInvariant = {
  shadowControlsGameplay: boolean;
  decisionForCommitIsProduction: boolean;
  canaryRan: boolean;
};

export type GoldenBattleAiCanary = {
  ran: boolean;
  controlsGameplay: boolean;
  fallback: boolean;
  selectedCandidateKey: string;
  reason: string;
  decision: GoldenBattleAiDecisionRecord;
  traceLine: string;
};

export type GoldenBattleAiCommitted = {
  decision: GoldenBattleAiDecisionRecord;
  actionKey: string;
  fromV2: boolean;
};

export type GoldenBattleAiRow = {
  name: string;
  descriptor: string;
  label: string;
  identity: GoldenBattleAiIdentity;
  encounter: GoldenBattleAiEncounter;
  scenario: GoldenBattleAiScenario;
  units: GoldenBattleAiUnits;
  memoryScript: GoldenBattleAiMemoryScriptRow[];
  memoryCounts: GoldenBattleAiMemoryCounts;
  v1: GoldenBattleAiV1Block;
  observation: GoldenBattleAiObservation;
  policy: GoldenBattleAiPolicy;
  candidates: GoldenBattleAiCandidateRow[];
  utility: GoldenBattleAiUtility;
  invariant: GoldenBattleAiInvariant;
  canary: GoldenBattleAiCanary;
  committed: GoldenBattleAiCommitted;
};

/**
 * One enemy decision point of the production 1v1 turn, in the order the Java runtime runs it.
 *
 * The `units`, `scenario`, `memoryScript` and `v1` blocks are what the probe handed the decision path;
 * `observation`, `policy`, `candidates`, `utility`, `canary` and `committed` are what it answered.
 */
export type GoldenBattleAiTable = {
  schema: string;
  note: string;
  runtimeMode: string;
  shadowEnabled: boolean;
  gameplayCommitEnabled: boolean;
  presetPhysicalTraitId: number;
  itemOptions: { itemId: number; behavior: number; itemKey: string }[];
  profiles: Record<string, unknown>[];
  weights: Record<string, unknown>[];
  rowCount: number;
  rows: GoldenBattleAiRow[];
};

/**
 * One damage answer from `BattleUnit.computeDamage`, with the two scripted rolls that produced it.
 * `draws` names every random value the engine asked for, so a port that draws in a different order
 * is visible in the data instead of only in a symptom.
 */
export type GoldenDamageRow = {
  attacker: string;
  defender: string;
  skillId: number;
  critRoll: number;
  jitterRoll: number;
  attackerAtk: number;
  defenderDef: number;
  damage: number;
  critFlag: number;
  appliedDebuffId: number;
  supplementalDamage: number;
  relation: number;
  draws?: string[];
  trace?: string[];
  level?: number;
};

export type GoldenDamageTable = {
  schema: string;
  note: string;
  cast: { label: string; speciesId: number }[];
  rows: GoldenDamageRow[];
  levelScaling: GoldenDamageRow[];
  /** The same hit measured at every crit roll across the engine's own crit chance. */
  critThreshold: GoldenDamageRow[];
};

/** A damage row annotated with the skill row that drove it, so a branch is attributable. */
export type GoldenSkillBranchRow = GoldenDamageRow & {
  powerPercent: number;
  effectId: number;
  chanceOrParam: number;
  elementFamily: number;
  targetSide: number;
  stableKey: string;
  unifiedV5: boolean;
  lietHoaUnifiedV5: boolean;
};

export type GoldenSkillBranchTable = {
  schema: string;
  note: string;
  rows: GoldenSkillBranchRow[];
};

/** The four current stats as the engine projected them, so a status effect is checkable. */
export type GoldenStatusStats = { hp: number; attack: number; defense: number; speed: number };

/**
 * The typed status behind the legacy five-column row: `present: false` is the whole story when the
 * unit does not hold it.
 */
export type GoldenStatusInstance =
  | { present: false }
  | {
      present: true;
      remainingTurns: number;
      remainingActions: number;
      primaryValue: number;
      secondaryValue: number;
      stackCount: number;
      sourceSkillId: number;
      flags: number;
    };

/** One buff applied to a fresh unit, and everything the application left behind. */
export type GoldenBuffApplyRow = {
  buffId: number;
  sourceSkill: number;
  heal: number;
  hpBefore: number;
  active: boolean;
  slot: number[];
  instance: GoldenStatusInstance;
  stats: GoldenStatusStats;
  draws?: string[];
};

/** The same application against a unit already holding three debuffs, so the cleanses show. */
export type GoldenBuffCleanseRow = {
  buffId: number;
  heal: number;
  debuffsBefore: number[];
  debuffsAfter: number[];
  active: boolean;
  slot: number[];
  instance: GoldenStatusInstance;
  stats: GoldenStatusStats;
};

/** One of five consecutive applications of the same buff, which is where the stack cap shows. */
export type GoldenBuffStackRow = {
  buffId: number;
  attempt: number;
  sourceSkill: number;
  heal: number;
  hp: number;
  active: boolean;
  slot: number[];
  instance: GoldenStatusInstance;
  stats: GoldenStatusStats;
};

/** One round-start tick of a buff that is already on the unit. */
export type GoldenBuffTickRow = {
  buffId: number;
  tick: number;
  heal: number;
  hp: number;
  active: boolean;
  slot: number[];
  instance: GoldenStatusInstance;
  stats: GoldenStatusStats;
  draws: string[];
};

/** One producer skill rolling to put its debuff on a fresh target. */
export type GoldenDebuffApplyRow = {
  skillId: number;
  debuffId: number;
  roll: number;
  planned: boolean;
  operation?: string;
  appliesStatus?: boolean;
  supplementalDamage?: number;
  delayedDamage?: number;
  active: boolean;
  hpBefore: number;
  slot: number[];
  instance: GoldenStatusInstance;
  stats: GoldenStatusStats;
  draws: string[];
};

/**
 * The same producer against a target that already holds something: another debuff, the same debuff,
 * or the shield buff that refuses every incoming status. The shield rows only carry the answer,
 * because the engine refuses before it builds anything.
 */
export type GoldenDebuffPreconditionRow = {
  precondition: string;
  skillId: number;
  debuffId: number;
  roll?: number;
  seededDebuffs?: number[];
  planned: boolean;
  operation?: string;
  appliesStatus?: boolean;
  supplementalDamage?: number;
  delayedDamage?: number;
  active: boolean;
  hpBefore?: number;
  slot?: number[];
  instance?: GoldenStatusInstance;
  stats?: GoldenStatusStats;
  draws: string[];
};

/** One round-start tick of a debuff that is already on the target. */
export type GoldenDebuffTickRow = {
  debuffId: number;
  tick: number;
  damage: number;
  hpBefore: number;
  hp: number;
  sourceHpBefore: number;
  sourceHp: number;
  active: boolean;
  slot: number[];
  instance: GoldenStatusInstance;
  stats: GoldenStatusStats;
  draws: string[];
};

/** One set of statuses projected onto the unit's stats. */
export type GoldenStatProjectionRow = {
  buffs: number[];
  debuffs: number[];
  activeBuffs: number[];
  activeDebuffs: number[];
  buffSlots: { id: number; slot: number[] }[];
  debuffSlots: { id: number; slot: number[] }[];
  base: GoldenStatusStats;
  stats: GoldenStatusStats;
};

/** One hit measured with statuses on both sides. */
export type GoldenDamageWithStatusRow = {
  attackerBuffs: number[];
  targetBuffs: number[];
  roll: number;
  skillId: number;
  attackerAtk: number;
  defenderDef: number;
  damage: number;
  critFlag: number;
  appliedDebuffId: number;
  supplementalDamage: number;
  relation: number;
  attackerBuffsAfter: number[];
  attackerSlots: { id: number; slot: number[] }[];
  targetSlots: { id: number; slot: number[] }[];
  attackerStats: GoldenStatusStats;
  targetStats: GoldenStatusStats;
  draws: string[];
};

/** One answer from the post-damage reflect decision. */
export type GoldenReflectRow = {
  buff2: boolean;
  buff5: boolean;
  buff2Percent: number;
  buff5Chance: number;
  roll: number;
  storedDamage: number;
  applyBuff2Reflect: boolean;
  buff2Reflect: number;
  applyBuff5Reflect: boolean;
  buff5Reflect: number;
  targetStats: GoldenStatusStats;
};

/** One clearing path, and the stats it handed back. */
export type GoldenStatusClearingRow = {
  case: string;
  returned: number;
  buffsBefore: number[];
  debuffsBefore: number[];
  buffsAfter: number[];
  debuffsAfter: number[];
  statsBefore: GoldenStatusStats;
  statsAfter: GoldenStatusStats;
  alive: boolean;
};

/** The order the round-start pass walks the active statuses in. */
export type GoldenActiveQueueRow = {
  buffs: number[];
  debuffs: number[];
  outcome: string;
  entries: { bank: number; effectId: number; slot: number; outcome: string }[];
};

export type GoldenStatusLifecycleTable = {
  schema: string;
  note: string;
  unit: {
    level: number;
    attacker: { speciesId: number; side: number; nature: number; base: GoldenStatusStats };
    target: { speciesId: number; side: number; nature: number; base: GoldenStatusStats };
    hookSkillId: number;
    reflectReceivedDamage: number;
  };
  buffApply: GoldenBuffApplyRow[];
  buffApplyOverDebuffs: GoldenBuffCleanseRow[];
  buffStack: GoldenBuffStackRow[];
  buffTick: GoldenBuffTickRow[];
  debuffApply: GoldenDebuffApplyRow[];
  debuffPreconditions: GoldenDebuffPreconditionRow[];
  debuffTick: GoldenDebuffTickRow[];
  statProjection: GoldenStatProjectionRow[];
  damageWithStatuses: GoldenDamageWithStatusRow[];
  reflect: GoldenReflectRow[];
  clearing: GoldenStatusClearingRow[];
  activeQueueOrder: GoldenActiveQueueRow[];
};

/** The decision made after a skill's damage step: who receives the status and how much is healed. */
export type GoldenPostSkillRow = {
  inputs: {
    skillId: number;
    effectId: number;
    effectMode: number;
    chanceOrParam: number;
    damage: number;
    attackHit: boolean;
    targetAvailable: boolean;
    leechRollPassed: boolean;
  };
  routeMode: string;
  mode: string;
  heal: number;
  buffId: number;
  buffOwner: string;
  sourceTargetSelf: boolean;
  noDamageDebuff: boolean;
  copyTargetBuffs: boolean;
};

/** One visible strip slot exactly as the battle renderer receives it. */
export type GoldenPresentationSlot = {
  index: number;
  sourceBank: number;
  sourceNumericId: number;
  stableKey: string;
  displayName: string;
  iconKind: string;
  lietHoaAtlasCell: number;
  resourcePath: string;
  remainingDuration: number;
  actionOwned: boolean;
};

/**
 * One status a unit is carrying, as the probe records it: the walk over the three banks the
 * round-start pass and the icon strip both read.
 */
export type GoldenHeldStatus = {
  bank: number;
  numericId: number;
  remainingTurns: number;
  remainingActions: number;
};

/** One seeded unit: what actually survived the apply, and the strip the projector emitted. */
export type GoldenPresentationRow = {
  label: string;
  suppressionActions: number;
  held: GoldenHeldStatus[];
  slots: GoldenPresentationSlot[];
};

/**
 * One `BattleUnit.copySourceBuffsFrom` case: the buffs it started with and both strips afterwards, so
 * the number that moved and the source it left behind are graded together.
 */
export type GoldenCopyRow = {
  label: string;
  seeded: number[];
  attacker: GoldenPresentationRow;
  target: GoldenPresentationRow;
};

/** The name the runtime prints as the post-effect text for one status row. */
export type GoldenEffectNameRow = {
  bank: number;
  numericId: number;
  hasDefinition: boolean;
  displayName: string;
  effectRowName: string;
};

export type GoldenStatusPresentationTable = {
  schema: string;
  note: string;
  unit: {
    level: number;
    attackerSpecies: number;
    targetSpecies: number;
    attackerBaseAttack: number;
    damage: number;
  };
  postSkillResolution: GoldenPostSkillRow[];
  presentation: GoldenPresentationRow[];
  copy: GoldenCopyRow[];
  effectNames: GoldenEffectNameRow[];
  durationCells: { duration: number; cell: number }[];
};

/** The row the engine resolves for one held item id, with the raw columns an effect reads. */
export type GoldenHeldItemRow = {
  id: number;
  nameTextId: number;
  iconCell: number;
  descriptionTextId: number;
  priceOrValue: number;
  currencyOrType: number;
  paramIndexes: number[];
  params: number[];
};

/** One set of statuses projected onto a unit that holds an item, so the two orders are visible. */
export type GoldenHeldStatRow = GoldenStatProjectionRow & { item: number };

/** One attack term measured on a unit that holds an item, at a named fraction of its HP. */
export type GoldenHeldBaseAttackRow = {
  item: number;
  targetItem: number;
  buffs: number[];
  hpPercent: number;
  attackerHpBefore: number;
  attackerMaxHp: number;
  attackerAtk: number;
  targetDef: number;
  baseAttack: number;
  damage: number;
  critFlag: number;
  draws: string[];
};

/** One crit decision, sweeping the roll across the chance the item adds to the engine's own. */
export type GoldenHeldCritRow = {
  item: number;
  critRoll: number;
  attackerAtk: number;
  targetDef: number;
  baseAttack: number;
  damage: number;
  critFlag: number;
  draws: string[];
};

/** One incoming status chance before and after the resistance the held item applies. */
export type GoldenHeldStatusChanceRow = { item: number; chance: number; projected: number };

/** One debuff attempt through the producer path, on a target that holds an item. */
export type GoldenHeldDebuffApplyRow = {
  skillId: number;
  debuffId: number;
  item: number;
  producerChance: number;
  projectedChance: number;
  roll: number;
  planned: boolean;
  operation?: string;
  appliesStatus?: boolean;
  supplementalDamage?: number;
  delayedDamage?: number;
  active: boolean;
  hpBefore: number;
  slot: number[];
  instance: GoldenStatusInstance;
  stats: GoldenStatusStats;
  draws: string[];
};

/** One post-damage decision: the leech the held item adds beside the two reflect terms. */
export type GoldenHeldPostDamageRow = {
  item: number;
  targetBuff2: boolean;
  attackHit: boolean;
  targetSideOpponent: boolean;
  roll: number;
  chance: number;
  healPercent: number;
  damage: number;
  receivedDamage: number;
  buff2Percent: number;
  leech: boolean;
  heal: number;
  applyBuff2Reflect: boolean;
  buff2Reflect: number;
};

/** One miss chance, which the sure-hit item answers with zero before either cap is applied. */
export type GoldenHeldMissChanceRow = {
  item: number;
  attackerSpeed: number;
  targetSpeed: number;
  hasDebuff4: boolean;
  debuff4Value: number;
  missChance: number;
};

/** One HP-floor decision on the target of a hit, and the HP it leaves behind. */
export type GoldenHeldHpFloorRow = {
  contextAllowsFloor: boolean;
  item: number;
  floor: number;
  targetHp: number;
  hpBefore: number;
  apply: boolean;
  hpAfter: number;
  stats: GoldenStatusStats;
};

/**
 * One P7 strike walked end to end by the Java runtime: a unit built from the `unit` fixture, holding
 * the row's item, hitting a target that carries the row's buffs and sits at the row's HP percent, on a
 * stream seeded with the row's seed. A zero-power row carries the fields that path actually holds.
 */
export type GoldenHeldP7StepRow = {
  skill: number;
  item: number;
  targetBuffs: number[];
  targetHpPercent: number;
  seed: number;
  powerPercent: number;
  targetSide: number;
  attackerHpStart: number;
  targetHpStart: number;
  zeroPower: boolean;
  /** The walk's own draws, as full `label=value` strings in the order the engine asked for them. */
  draws: string[];
  damage: number;
  hit: boolean;
  missChance: number;
  hitRoll: number;
  committedDamage: number;
  attackerHpEnd: number;
  targetHpEnd: number;
  attackerStats: GoldenStatusStats;
  targetStats: GoldenStatusStats;
  /**
   * What each unit carries once the walk is over. The target's strip is the proof that the status the
   * formula rolled for lands before the hit does: a row whose damage kills the target reports it gone,
   * because the same death pass that clears a dead unit's statuses already ran on it.
   */
  attackerHeld: GoldenHeldStatus[];
  targetHeld: GoldenHeldStatus[];
  resultDamage?: number;
  resolvedDamage?: number;
  critFlag?: number;
  appliedDebuffId?: number;
  supplementalDamage?: number;
  attackerSpeed?: number;
  targetSpeed?: number;
  debuff4Value?: number;
  heldItem9?: boolean;
  sideEffectMode?: string;
  hpAfterDamage?: number;
  floor?: number;
  floorApply?: boolean;
  hpAfterFloor?: number;
  postDamageRan?: boolean;
  heldItem8Chance?: number;
  heldItem8Roll?: number;
  heldItem8HealPercent?: number;
  leech?: boolean;
  heal?: number;
  buff2Present?: boolean;
  buff2Percent?: number;
  buff2Reflect?: number;
  buff5Present?: boolean;
  buff5Chance?: number;
  buff5Roll?: number;
  buff5Stored?: number;
  buff5Reflect?: number;
};

export type GoldenHeldItemsTable = {
  schema: string;
  note: string;
  unit: {
    level: number;
    noItem: number;
    attacker: { speciesId: number; side: number; nature: number; base: GoldenStatusStats };
    target: { speciesId: number; side: number; nature: number; base: GoldenStatusStats };
    hookSkillId: number;
    postDamageReceived: number;
    battleItemIds: number[];
  };
  items: GoldenHeldItemRow[];
  statProjection: GoldenHeldStatRow[];
  baseAttack: GoldenHeldBaseAttackRow[];
  crit: GoldenHeldCritRow[];
  statusChance: GoldenHeldStatusChanceRow[];
  debuffApply: GoldenHeldDebuffApplyRow[];
  postDamage: GoldenHeldPostDamageRow[];
  missChance: GoldenHeldMissChanceRow[];
  hpFloor: GoldenHeldHpFloorRow[];
  p7Step: GoldenHeldP7StepRow[];
};

/**
 * A unit as one recorded step left it. Only the characteristic owner carries the full snapshot;
 * every other unit keeps the fields a step can actually move.
 */
export type GoldenTraitUnitState = {
  hp: number;
  alive: boolean;
  side: number;
  slot: number;
  form: number;
  /** "bank:id:turns:actions:primary:secondary:stacks:sourceSide:sourceSlot:sourceSkill:flags" */
  ss: string[];
  atk?: number;
  def?: number;
  spd?: number;
  pp?: number[];
  /** PetDesignTraitState in field-declaration order, booleans as 0/1. */
  st?: number[];
  mask?: number;
  /** pendingPivot, pivotShieldPct, pivotShieldDuration, secondaryHit, round */
  sg?: number[];
};

/** One engine call the port must replay, plus what it returned and what it left behind. */
export type GoldenTraitStep = {
  op: string;
  args: (string | number | boolean)[];
  result?: number | boolean;
  state: Record<string, GoldenTraitUnitState>;
};

export type GoldenTraitRow = {
  speciesId: number;
  petKey: string;
  type: string;
  value: number;
  sourceValue: number;
  effectMultiplier: number;
  valueUnit: string;
  scenario: string;
  steps: GoldenTraitStep[];
};

export type GoldenTraitsTable = {
  schema: string;
  note: string;
  unitTemplate: {
    level: number;
    physicalTraitId: number;
    maxHp: number;
    hp: number;
    attack: number;
    defense: number;
    speed: number;
    skill: number;
    skillPp: number;
    actorSide: number;
    dummySide: number;
    dummySpecies: number;
    actorState: GoldenTraitUnitState;
    dummyState: GoldenTraitUnitState;
    note: string;
  };
  randomness: { mode: string; roll: number; label: string; note: string };
  powerRule: { families: string[]; capPercent: number; java: string; divergence: string };
  lowHpBandRegenPercent: number;
  statusTurns: number;
  families: { type: string; species: number; valueUnit: string; scenarios: string[] }[];
  rowCount: number;
  rows: GoldenTraitRow[];
};

/** The talent-owned fields one recorded step left on the Java `PetTraitBattleState`. */
export type GoldenTalentState = {
  /** permanentStatsApplied */
  psa: number;
  /** passiveHealRoundIndex */
  phr: number;
  /** passiveHealingCommitted */
  phc: number;
  /** reviveUses */
  ru: number;
  /** lowHpThresholdAttempted */
  lha: number;
  /** canonical [burn, corrosion, petrification, bind, paralysis] as 0/1 */
  cs: number[];
};

/**
 * A unit as one recorded talent step left it. The talent owner carries the full snapshot; the
 * talent-free dummy keeps only what a step can move there. Both carry maxHp, the four base stats
 * and the talent state, because those are what the nine families read and write.
 */
export type GoldenPhysicalTraitUnitState = GoldenTraitUnitState & {
  mh: number;
  bs: number[];
  tt: GoldenTalentState;
};

/** One engine call the port must replay, plus what it returned and what it left behind. */
export type GoldenPhysicalTraitStep = {
  op: string;
  args: (string | number | boolean)[];
  result?: number | boolean | (number | boolean)[];
  state: Record<string, GoldenPhysicalTraitUnitState>;
};

export type GoldenPhysicalTraitRow = {
  traitId: number;
  stableKey: string;
  name: string;
  family: string;
  hooks: string[];
  parametersJson: string;
  speciesId: number;
  combined: boolean;
  scenario: string;
  roll: number;
  randomLabels: string[];
  steps: GoldenPhysicalTraitStep[];
};

export type GoldenPhysicalTraitsTable = {
  schema: string;
  note: string;
  unitTemplate: {
    level: number;
    maxHp: number;
    hp: number;
    attack: number;
    defense: number;
    speed: number;
    skill: number;
    skillPp: number;
    actorSide: number;
    dummySide: number;
    dummySpecies: number;
    dummyPhysicalTraitId: number;
    actorState: GoldenPhysicalTraitUnitState;
    dummyState: GoldenPhysicalTraitUnitState;
    note: string;
  };
  randomness: {
    mode: string;
    rolls: number[];
    context: string;
    triggerRule: string;
    note: string;
  };
  /** `ProbeWebBattleMath.TRAIT_STATUS_TURNS`, the turn count the `status` op plants with. */
  statusTurns: number;
  families: { family: string; traits: number; scenarios: string[] }[];
  rowCount: number;
  rows: GoldenPhysicalTraitRow[];
};

/**
 * One unit as the live battle left it: the four stats the HUD draws, the three trait identities the
 * build wrote, whether the species characteristic is live, and the canonical status mask.
 *
 * `speciesTraitId` and `characteristicTraitId` are −1 here too, because Java forces both to −1 for
 * any species the design catalog covers, which is every live one. The characteristic still runs: it
 * is resolved by species at projection time, so `characteristicEnabled` is the field that says
 * whether it is live and `attack`/`defense`/`speed` carry what it made of them.
 */
export type GoldenTraitBattleUnit = {
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  baseAttack: number;
  baseDefense: number;
  baseSpeed: number;
  physicalTraitId: number;
  speciesTraitId: number;
  characteristicTraitId: number;
  characteristicEnabled: boolean;
  permanentStatsApplied: boolean;
  canonical: number[];
};

/** One status the live battle left on a unit, in the bank order the walk presents them. */
export type GoldenTraitBattleHeld = {
  bank: number;
  numericId: number;
  remainingTurns: number;
  remainingActions: number;
};

/** `PetDesignTraitCatalog.bySpecies` for one side of the fight. */
export type GoldenTraitBattleCharacteristic = {
  speciesId: number;
  key: string;
  type: string;
  value: number;
};

/**
 * One full round of the live fight: the strike walked in the runtime's own order, then the two
 * bleeding ticks and both `onRoundEnd` calls, then the snapshot that closes the round.
 */
export type GoldenTraitBattleRound = {
  /** The seed the strike's draws were taken from; each round of a battle uses one seed. */
  seed: number;
  round: number;
  /** `projectTargetDefenseIgnorePercent`, the pierce the target's own trait hands the attacker. */
  defenseIgnorePercent: number;
  resultDamage: number;
  resolvedDamage: number;
  critFlag: number;
  appliedDebuffId: number;
  supplementalDamage: number;
  /** The miss chance before `projectMissChance`, so a trait that moves it shows as a delta. */
  sourceMissChance: number;
  missChance: number;
  hitRoll: number;
  sideEffectMode: string;
  hit: boolean;
  planDamage: number;
  attackerSpeed: number;
  targetSpeed: number;
  /** The battle's own draw stream, full labels in ask order, for this round only. */
  draws: string[];
  targetHpBefore: number;
  /** What the outgoing and incoming projections left on the planned damage. */
  projectedDamage: number;
  floor: number;
  floorApplied: boolean;
  committedDamage: number;
  /** What `afterSkillAction` healed, which is the talent's passive-heal route. */
  skillActionHealing: number;
  player: GoldenTraitBattleUnit;
  enemy: GoldenTraitBattleUnit;
  playerHeld: GoldenTraitBattleHeld[];
  enemyHeld: GoldenTraitBattleHeld[];
  /** What `tickDesignBleeding` took from each side after the strike. */
  bleeding: { player: number; enemy: number };
  afterRoundEnd: { player: GoldenTraitBattleUnit; enemy: GoldenTraitBattleUnit };
};

/** One fight: the same two units with one talent on one side and the enemy at one HP band. */
export type GoldenTraitBattleRow = {
  talent: number;
  talentOwner: "player" | "enemy";
  enemyHpPercent: number;
  beforeEnter: { player: GoldenTraitBattleUnit; enemy: GoldenTraitBattleUnit };
  afterEnter: { player: GoldenTraitBattleUnit; enemy: GoldenTraitBattleUnit };
  rounds: GoldenTraitBattleRound[];
};

/** `PetTraitPermanentStatResolver.project` over a fixed base grid, one row per id and base. */
export type GoldenTraitPermanentStatRow = {
  physicalTraitId: number;
  /** [maxHp, strength, defense, agility] as the resolver received them. */
  base: number[];
  projected: number[];
};

/**
 * The live battle's trait evidence: what a roll answers, what the permanent resolver makes of it,
 * and the scene1 tutorial fight walked end to end with both characteristics and one talent live.
 *
 * `golden-traits.json` grades one characteristic against a dummy and `golden-physical-traits.json`
 * grades one talent against a dummy; this is the composition, so it is the table that grades the
 * wiring rather than the parts.
 */
export type GoldenTraitBattleTable = {
  schema: string;
  note: string;
  formation: string;
  slots: {
    enemy: number;
    player: number;
    roundIndexAtEnter: number;
    actionIndex: number;
  };
  units: {
    playerSpecies: number;
    enemySpecies: number;
    enemyEncounter: number[];
    skill: number;
    playerCharacteristic: GoldenTraitBattleCharacteristic;
    enemyCharacteristic: GoldenTraitBattleCharacteristic;
  };
  roller: {
    totalWeight: number;
    /**
     * `PetTraitRoller.roll(entropy)`. The entropy is a decimal string because the sweep runs out to
     * `Long.MIN_VALUE` and `Long.MAX_VALUE`, and a JSON number would round those two to a different
     * integer the port could not floor-mod back.
     */
    rows: { entropy: string; physicalTraitId: number }[];
    sanitize: { physicalTraitId: number; speciesId: number; result: number }[];
    valid: { physicalTraitId: number; valid: boolean }[];
  };
  permanentStats: GoldenTraitPermanentStatRow[];
  battles: GoldenTraitBattleRow[];
};

/** One catch attempt: the 15 positional inputs, the chance and whether the scripted roll caught. */
export type GoldenCatchRow = { input: number[]; chance: number; caught: boolean };
export type GoldenCatchTable = {
  schema: string;
  dimensions: Record<string, unknown[]>;
  isolated: Record<string, GoldenCatchRow[]>;
  combinations: GoldenCatchRow[];
  itemTable: {
    id: number;
    behavior: number;
    paramA: number;
    paramB: number;
    paramC: number;
    name: string;
  }[];
  storage: {
    rosterSize: number;
    bankSize: number;
    outcome: string;
    sourceResult: number;
  }[];
};

export type GoldenExpRow = { input: number[]; award: number };

export type GoldenExpTable = {
  schema: string;
  requiredExpPerLevel: number[];
  note: string;
  dimensions: Record<string, unknown[]>;
  isolated: Record<string, GoldenExpRow[]>;
  levelGap: GoldenExpRow[];
  combinations: GoldenExpRow[];
  expCompletion: { hasLearnSkills: boolean; canLevelAgain: boolean; outcome: string }[];
  eligibility: Record<string, boolean | { heldItem6: number; plain: string }>;
};

/** One dispatch cell: the nine booleans in `inputOrder`, then the speeds, then the answer. */
export type GoldenDispatchRow = {
  bits: boolean[];
  speed: number[];
  command: string;
  reason: string;
};

export type GoldenFlowTable = {
  schema: string;
  inputOrder: string[];
  dispatch: GoldenDispatchRow[];
  command: {
    commandIndex: number;
    catchForbidden: boolean;
    playerBound: boolean;
    outcome: string;
  }[];
  run: { battleModeRestricted: boolean; outcome: string }[];
  branch: { resultIndex: number; branchTargets: number[]; branch: number }[];
  defeat: {
    playerSide: boolean;
    hasLivingReserve: boolean;
    activeEnemyIndex: number;
    enemyAlive: boolean[];
    outcome: string;
    replacement: number;
  }[];
  warningResume: { returnStateId: number; outcome: string }[];
  /**
   * The outcome half of `BattleOutcomeEngine`, keyed the way the probe keyed it: six decisions per
   * forced result index, then the catch-failure, open-box, loss, revive and passive-heal answers.
   */
  outcome: Record<string, number | string | Record<string, number | string>>;
  evolution: {
    targetKind: number;
    currentLevel: number;
    eligible: boolean;
    sourceKind: number;
    requiredLevel: number;
    materialEnough: boolean;
  }[];
};

export type GoldenRngTable = {
  schema: string;
  note: string;
  streams: { seed: number; raw: number[]; percent: number[] }[];
};

/** One hp/maxHp/pool triple as `VqsvBattleRenderState.UnitState` kept it, plus the split for a 80px track. */
export type GoldenShieldTrackState = {
  hp: number;
  maxHp: number;
  asked: number;
  shieldHp: number;
  red: number;
  blue: number;
};

/** One bar the Java renderer rasterized: its size, its two segments, and every scanline as colour runs. */
export type GoldenShieldTrackRow = {
  state: number;
  width: number;
  height: number;
  red: number;
  blue: number;
  pixels: string[];
};

/** `BattleUnit.shieldHp` over a planted Khiên, beside what the status itself still holds. */
export type GoldenShieldUnitRow = {
  label: string;
  hp: number;
  maxHp: number;
  alive: boolean;
  planted: boolean;
  pool: number;
  shieldHp: number;
};

export type GoldenShieldTrackTable = {
  schema: string;
  note: string;
  colors: { healthRed: number; shieldBlue: number };
  states: GoldenShieldTrackState[];
  tracks: GoldenShieldTrackRow[];
  guard: GoldenShieldTrackRow[];
  unitShield: GoldenShieldUnitRow[];
};

/**
 * Typed view over the catalogs the Java engine dumped into `data`.
 *
 * Everything here is loaded from the pack on first use; the numbers the battle and story
 * runtimes need come from the same rows Java validated when it loaded them, not from a copy
 * re-typed in TypeScript.
 */
export class GameData {
  private indexes = new Map<string, unknown>();

  constructor(readonly pack: Pack) {}

  private document<T>(path: string): Promise<T> {
    return this.pack.json<T>(`data.${path}`);
  }

  /** `skill-fx/animations.json`: the Cầu Vồng skill effects, frame tables and timing. */
  skillFx(): Promise<SkillFxDocument> {
    return this.pack.json<SkillFxDocument>("skill-fx.animations");
  }

  /** `skill-fx/signatures.json`: the pet-design signature effects, timed world sprite events. */
  signatureFx(): Promise<SignatureFxDocument> {
    return this.pack.json<SignatureFxDocument>("skill-fx.signatures");
  }

  /** `effect.mid` + `speffect.mid`, resolved and timed by the Java pack exporter. */
  sourceSkillAnimations(): Promise<SourceSkillAnimationDocument> {
    return this.document<SourceSkillAnimationDocument>("battle/source-skill-animations.json");
  }

  /** The state-1 L effect (`l-effect/l-effect.json`, ExportWebStateOneLEffect). */
  stateOneLEffect(): Promise<StateOneLEffectDocument> {
    return this.pack.json<StateOneLEffectDocument>("l-effect.l-effect");
  }

  /** Cache a derived lookup promise so repeated calls do not rebuild the same map. */
  private indexed<T>(name: string, build: () => Promise<T>): Promise<T> {
    const existing = this.indexes.get(name);
    if (existing !== undefined) return existing as Promise<T>;
    const created = build();
    this.indexes.set(name, created);
    return created;
  }

  species(): Promise<PackSpeciesCatalog> {
    return this.document<PackSpeciesCatalog>("battle/species.json");
  }
  speciesByRuntimeId(runtimeId: number): Promise<PackSpeciesRow | undefined> {
    return this.indexed("speciesById", () =>
      this.species().then((catalog) => new Map(catalog.rows.map((row) => [row.speciesId, row]))),
    ).then((byId) => byId.get(runtimeId));
  }
  /** The species whose record carries this pet key; binary source rows have no key. */
  speciesByPetKey(petKey: string): Promise<PackSpeciesRow | undefined> {
    return this.indexed("speciesByPetKey", () =>
      this.species().then((catalog) => {
        const byKey = new Map<string, PackSpeciesRow>();
        for (const row of catalog.rows) {
          const key = speciesPetKey(row);
          if (key !== undefined) byKey.set(key, row);
        }
        return byKey;
      }),
    ).then((byKey) => byKey.get(petKey));
  }
  petQuality(): Promise<PackPetQuality> {
    return this.document<PackPetQuality>("battle/pet-quality.json");
  }
  petLevel(): Promise<PackPetLevel> {
    return this.document<PackPetLevel>("battle/pet-level.json");
  }
  cauVongPetLevel(): Promise<PackCauVongPetLevel> {
    return this.document<PackCauVongPetLevel>("battle/cau-vong-pet-level.json");
  }
  skills(): Promise<PackSkill[]> {
    return this.document<PackSkill[]>("battle/skills.json");
  }
  skillByRuntimeId(runtimeId: number): Promise<PackSkill | undefined> {
    return this.indexed("skillById", () =>
      this.skills().then((rows) => new Map(rows.map((row) => [row.runtimeId, row]))),
    ).then((byId) => byId.get(runtimeId));
  }
  /** The Liệt Hỏa balance records, one per skill id 0..69, which is the whole scene1 skill set. */
  lietHoaSkills(): Promise<PackSkill[]> {
    return this.document<PackSkill[]>("battle/skills-liet-hoa.json");
  }
  /**
   * The unified skill records Java reaches through `UnifiedSkillCatalog.byRuntimeId`'s special cases
   * instead of its `records()` list — today the user-authored Quỷ shield-break, id 2000.
   *
   * `skills.json` is `records()` and does not carry them, so a caller that reads only that file
   * refuses a skill the engine will happily resolve.
   */
  userAuthoredSkills(): Promise<PackSkill[]> {
    return this.document<PackSkill[]>("battle/skills-user-authored.json");
  }
  /**
   * The 258 `PD-SIG-*` signature records, ids 1000..1257. Java reaches them through
   * `UnifiedSkillCatalog.byRuntimeId`'s fallback for any id at or above 1000, so a caller that only
   * reads `skills.json` cannot see a signature slot at all.
   */
  petDesignSkills(): Promise<PackSkill[]> {
    return this.document<PackSkill[]>("battle/skills-pet-design.json");
  }
  /** One skill id as the engine resolved it, so the damage branch is a fact and not a guess. */
  skillRows(): Promise<PackSkillRowCatalog> {
    return this.document<PackSkillRowCatalog>("battle/skill-rows.json");
  }
  skillRowById(skillId: number): Promise<PackSkillRow | undefined> {
    return this.indexed("skillRowById", () =>
      this.skillRows().then((catalog) => new Map(catalog.rows.map((row) => [row.skillId, row]))),
    ).then((byId) => byId.get(skillId));
  }
  elementChart(): Promise<PackElementChart> {
    return this.document<PackElementChart>("battle/element-chart.json");
  }
  debuffProducers(): Promise<PackDebuffProducers> {
    return this.document<PackDebuffProducers>("battle/debuff-producers.json");
  }
  items(): Promise<PackItem[]> {
    return this.document<PackItem[]>("battle/items.json");
  }
  /** Java's status catalog minus the statuses this build dropped. */
  statuses(): Promise<PackStatus[]> {
    return this.indexed("statuses", async () =>
      this.cutRows(
        "statuses",
        "battle/statuses.json",
        await this.document<PackStatus[]>("battle/statuses.json"),
      ),
    );
  }
  /** How strong each buff is, which skill overrides that, and where a finished skill goes next. */
  statusMechanics(): Promise<PackStatusMechanics> {
    return this.document<PackStatusMechanics>("battle/status-mechanics.json");
  }
  /** The web build's own status rules (hand-authored, see the file's note). */
  statusWebRules(): Promise<PackStatusWebRules> {
    return this.document<PackStatusWebRules>("battle/status-web-rules.json");
  }
  statusByStableKey(stableKey: string): Promise<PackStatus | undefined> {
    return this.indexed("statusByKey", () =>
      this.statuses().then(
        (rows) =>
          new Map(
            rows.flatMap((row) =>
              [row.stableKey, ...(row.aliases ?? [])].map((key) => [key, row] as const),
            ),
          ),
      ),
    ).then((byKey) => byKey.get(stableKey));
  }
  /** The rollable talent table, minus the two form characteristics. */
  physicalTraits(): Promise<PackTrait[]> {
    return this.indexed("physicalTraits", async () =>
      this.cutRows(
        "physicalTraits",
        "battle/pet-physical-traits.json",
        await this.document<PackTrait[]>("battle/pet-physical-traits.json"),
      ),
    );
  }
  speciesTraits(): Promise<PackTrait[]> {
    return this.document<PackTrait[]>("battle/pet-species-traits.json");
  }
  /**
   * The web-native balance layer over `physicalTraits()` and `speciesTraits()`. Both Java exports stay
   * untouched; this one applies the cut-status rename to the two descriptions that spell a name the
   * battle logic no longer carries, and keeps the Java sentence beside the replacement so the guard can
   * prove nothing else moved.
   */
  traitDescriptionBalance(): Promise<PackTraitDescriptionBalanceTable> {
    return this.pack.json<PackTraitDescriptionBalanceTable>("balance.pet-trait-descriptions");
  }
  /** The replacement description per Java trait row, keyed by `<table>::<stableKey>`. */
  traitDescriptionOverrides(): Promise<Map<string, string>> {
    return this.indexed("traitDescriptionOverrides", () =>
      this.traitDescriptionBalance().then((table) => {
        const byRow = new Map<string, string>();
        for (const override of table.overrides) {
          const key = `${override.table}::${override.stableKey}`;
          if (byRow.has(key)) throw new Error(`balance declares ${key} twice`);
          byRow.set(key, override.value);
        }
        return byRow;
      }),
    );
  }
  /**
   * The rows the web game decided to drop while Java still exports them. Declared in the balance
   * domain, not as an edit of the dump, because `data/` is the harness bake's root: bytes hand-pruned
   * there are refreshed away by the next run, and a cut that only lives in the file can silently
   * resurrect the row it removed.
   */
  dataCuts(): Promise<PackDataCuts> {
    return this.pack.json<PackDataCuts>("balance.data-cuts");
  }
  /** The cuts for one reader, refusing a stable key declared twice for it. */
  dataCutsFor(reader: DataCutReader): Promise<PackDataCut[]> {
    return this.indexed(`dataCuts.${reader}`, () =>
      this.dataCuts().then((table) => {
        const cuts: PackDataCut[] = [];
        const seen = new Set<string>();
        for (const cut of table.cuts) {
          if (cut.reader !== reader) continue;
          if (seen.has(cut.stableKey)) {
            throw new Error(`balance/data-cuts.json cuts ${reader} ${cut.stableKey} twice`);
          }
          seen.add(cut.stableKey);
          cuts.push(cut);
        }
        return cuts;
      }),
    );
  }
  /**
   * `rows` without the Java rows this build dropped. Each cut is re-checked against the row it names
   * and a cut whose row Java no longer exports is refused rather than ignored, so the declaration
   * cannot rot into a file describing rows that are gone.
   */
  private async cutRows<T extends { stableKey: string }>(
    reader: DataCutReader,
    table: string,
    rows: readonly T[],
  ): Promise<T[]> {
    const cuts = await this.dataCutsFor(reader);
    if (cuts.length === 0) return [...rows];
    for (const cut of cuts) {
      if (cut.table !== table) {
        throw new Error(
          `balance/data-cuts.json cuts ${cut.stableKey} from ${cut.table}, not ${table}`,
        );
      }
      const row = rows.find((each) => each.stableKey === cut.stableKey);
      if (row === undefined) {
        throw new Error(
          `balance/data-cuts.json cuts ${table} ${cut.stableKey}, which Java no longer exports`,
        );
      }
      for (const [field, value] of Object.entries(cut.javaIdentity)) {
        const actual = (row as Record<string, unknown>)[field];
        if (actual !== value) {
          throw new Error(
            `balance/data-cuts.json says ${table} ${cut.stableKey}.${field} is ${String(value)},` +
              ` Java says ${String(actual)}`,
          );
        }
      }
    }
    const dropped = new Set(cuts.map((cut) => cut.stableKey));
    return rows.filter((row) => !dropped.has(row.stableKey));
  }
  /** The family and hook mask behind every trait id, plus whether the dispatcher runs at all. */
  traitMechanics(): Promise<PackTraitMechanics> {
    return this.indexed("traitMechanics", async () => {
      const table = await this.document<PackTraitMechanics>("battle/pet-trait-mechanics.json");
      const physical = await this.cutRows(
        "physicalTraitMechanics",
        "battle/pet-trait-mechanics.json",
        table.physical,
      );
      return { ...table, physical, rowCount: physical.length + table.species.length };
    });
  }
  /** One characteristic per species; `PetDesignTraitCatalog.bySpecies` reads this table. */
  designTraits(): Promise<PackDesignTrait[]> {
    return this.document<PackDesignTrait[]>("battle/pet-design-traits.json");
  }
  /**
   * The web-native balance layer over `designTraits()`. Java stays untouched and still owns the
   * structure; this table replaces `value` and `description` and adds the `unit` the value counts
   * in. `PetDesignTraitBalance.test.ts` proves the two agree on everything it does not replace.
   */
  designTraitBalance(): Promise<PackDesignTraitBalanceTable> {
    return this.pack.json<PackDesignTraitBalanceTable>("balance.pet-design-traits");
  }
  designTraitBalanceBySpecies(): Promise<Map<number, PackDesignTraitBalance>> {
    return this.indexed("designTraitBalanceBySpecies", () =>
      this.designTraitBalance().then((table) => {
        const bySpecies = new Map<number, PackDesignTraitBalance>();
        for (const trait of table.traits) {
          if (bySpecies.has(trait.speciesId))
            throw new Error(`balance declares species ${trait.speciesId} twice`);
          bySpecies.set(trait.speciesId, trait);
        }
        return bySpecies;
      }),
    );
  }
  charms(): Promise<PackCharm[]> {
    return this.document<PackCharm[]>("battle/charms.json");
  }
  badges(): Promise<PackBadge[]> {
    return this.document<PackBadge[]>("battle/badges.json");
  }
  evolutions(): Promise<PackEvolution[]> {
    return this.document<PackEvolution[]>("battle/evolutions.json");
  }
  evolutionsFrom(petKey: string): Promise<PackEvolution[]> {
    return this.indexed("evolutionsByFrom", () =>
      this.evolutions().then((rows) => {
        const byFrom = new Map<string, PackEvolution[]>();
        for (const row of rows)
          byFrom.set(row.fromPetKey, [...(byFrom.get(row.fromPetKey) ?? []), row]);
        return byFrom;
      }),
    ).then((byFrom) => byFrom.get(petKey) ?? []);
  }
  learnsets(): Promise<Record<string, PackLearnsetEntry[]>> {
    return this.document<Record<string, PackLearnsetEntry[]>>("battle/skill-learnsets.json");
  }
  /** `battle/skill-initial-pools.json`: the pool `initialSkillIds` deals a new pet's deck from. */
  initialSkillPools(): Promise<Record<string, [number, number][]>> {
    return this.document<Record<string, [number, number][]>>("battle/skill-initial-pools.json");
  }
  learnset(petKey: string): Promise<PackLearnsetEntry[]> {
    return this.learnsets().then((all) => all[petKey] ?? []);
  }
  taskOffers(): Promise<Record<string, PackTaskOffer>> {
    return this.document<Record<string, PackTaskOffer>>("quest/task-offers.json");
  }
  npcRoster(): Promise<PackNpc[]> {
    return this.document<PackNpc[]>("npc/cau-vong-roster.json");
  }
  acquisitionRoutes(): Promise<PackAcquisitionRoute[]> {
    return this.document<PackAcquisitionRoute[]>("world/acquisition-routes.json");
  }

  /** Every battle the Java engine declared, keyed by its Java constant name. */
  battleEvents(): Promise<Record<string, PackBattleEvent>> {
    return this.document<Record<string, PackBattleEvent>>("battle/event-descriptors.json");
  }

  /** The groups declared for one scene room, in Java constant-name order. */
  battleEventsAt(
    sceneId: number,
    roomIndex: number,
    groupIndex: number,
  ): Promise<PackBattleEvent[]> {
    return this.indexed("battleEventsByGroup", () =>
      this.battleEvents().then((events) => {
        const byGroup = new Map<string, PackBattleEvent[]>();
        for (const event of Object.values(events)) {
          const key = `${event.sceneId}/${event.roomIndex}/${event.groupIndex}`;
          byGroup.set(key, [...(byGroup.get(key) ?? []), event]);
        }
        return byGroup;
      }),
    ).then((byGroup) => byGroup.get(`${sceneId}/${roomIndex}/${groupIndex}`) ?? []);
  }

  /**
   * The five everyday decision policies, keyed by tier name.
   *
   * `BattleAiProfile.WILD/TRAINER/ELITE/BOSS/COMPANION` are Java's static finals; the descriptor rows
   * already carry a resolved copy per battle, so this file is what a battle without a descriptor
   * (a wild encounter or an NPC entry) falls back to.
   */
  aiProfiles(): Promise<Record<string, PackBattleAiProfile>> {
    return this.document<Record<string, PackBattleAiProfile>>("battle/ai-profiles.json");
  }
  /** `double-battle/skill-scopes.json`: the 2v2 target scopes and the defensive priority list. */
  doubleSkillRules(): Promise<DoubleSkillRules> {
    return this.pack.json<DoubleSkillRules>("double-battle.skill-scopes");
  }
  /** `BattleAiProfile.forTier`, using the tier name as the dump keys it. */
  async aiProfileForTier(tier: string): Promise<PackBattleAiProfile> {
    const profile = (await this.aiProfiles())[tier];
    if (profile === undefined) throw new Error(`no Java AI profile ${tier}`);
    return profile;
  }

  /** The AI-v2 encounter catalog, resolved by the same loaders the Java decision path calls. */
  battleAiCatalog(): Promise<PackBattleAiCatalog> {
    return this.document<PackBattleAiCatalog>("battle/ai-v2-catalog.json");
  }

  /** One authored encounter by its `LH-ENC-...` key. */
  battleAiEncounter(encounterKey: string): Promise<PackBattleAiEncounterRow | undefined> {
    return this.indexed("battleAiByKey", () =>
      this.battleAiCatalog().then(
        (catalog) => new Map(catalog.encounters.map((row) => [row.encounter.encounterKey, row])),
      ),
    ).then((byKey) => byKey.get(encounterKey));
  }

  /**
   * The encounter a runtime descriptor resolves to, exactly as Java's `byRuntimeDescriptor` does.
   *
   * The lock carries the roster string Java compares, so collocated battles cannot collapse to one
   * identity; the guard test proves no two encounters share a locator, which is why a map is enough
   * here where Java scans the values.
   */
  battleAiEncounterForDescriptor(
    sceneId: number,
    roomIndex: number,
    groupIndex: number,
    sourceActorId: number,
    sourceRoster: number[],
  ): Promise<PackBattleAiEncounterRow | undefined> {
    return this.indexed("battleAiByDescriptor", () =>
      this.battleAiCatalog().then((catalog) => {
        const byDescriptor = new Map<string, PackBattleAiEncounterRow>();
        for (const row of catalog.encounters) {
          const lock = row.sourceLock;
          if (!lock) continue;
          byDescriptor.set(
            `${lock.sceneId}:${lock.roomIndex}:${lock.groupIndex}:${lock.sourceActorId}:${lock.sourceRoster}`,
            row,
          );
        }
        return byDescriptor;
      }),
    ).then((byDescriptor) =>
      byDescriptor.get(
        `${sceneId}:${roomIndex}:${groupIndex}:${sourceActorId}:${sourceRoster.join(",")}`,
      ),
    );
  }

  /** Tunables declared as `static final` in the Java effect renderer, keyed `Class.FIELD`. */
  screenEffectConstants(): Promise<Record<string, number | number[]>> {
    return this.document<Record<string, number | number[]>>("battle/screen-effect-constants.json");
  }

  screenEffectDefaults(): Promise<PackScreenEffectDefaults> {
    return this.document<PackScreenEffectDefaults>("battle/screen-effect-defaults.json");
  }

  /** World and protocol flag numbers, keyed `Class.FIELD`, as the engine declares them. */
  flagConstants(): Promise<Record<string, number>> {
    return this.document<Record<string, number>>("flags/constants.json");
  }

  /** One flag by its exact `Class.FIELD` key, e.g. `TanNguyetLongMaBossRuntime.VICTORY_COMPLETED_FLAG`. */
  async flag(key: string): Promise<number> {
    const constants = await this.flagConstants();
    const value = constants[key];
    if (value === undefined) {
      const sample = Object.keys(constants)
        .slice(0, 3)
        .map((name) => `\t${name}`)
        .join("");
      throw new Error(`no flag ${key} in the Java flag dump:${sample}`);
    }
    return value;
  }

  /** One `VqsvText` nested class, as `group -> constant -> string`. */
  text(group: string): Promise<Record<string, string>> {
    return this.indexed("text", () => this.textCatalog()).then((groups) => {
      const rows = groups[group];
      if (!rows) throw new Error(`no VqsvText group named ${group}`);
      return rows;
    });
  }
  private textCatalog(): Promise<Record<string, Record<string, string>>> {
    return this.document<Record<string, Record<string, string>>>("text/vqsv-text.json");
  }

  /** One per-scene story text holder dumped as `text/story-<Class>.json`. */
  storyText(className: string): Promise<Record<string, string>> {
    return this.document<Record<string, string>>(`text/story-${className}.json`);
  }

  /**
   * The golden battle tables: answers the Java engine gave for fixed inputs.
   *
   * These are the referee, not a data source the runtime reads at battle time. A port is graded by
   * recomputing the inputs in TypeScript and comparing against the row; nothing here may be copied
   * into a formula, because then the check would only prove the copy agrees with itself.
   */
  goldenBattleMeta(): Promise<GoldenBattleMeta> {
    return this.document<GoldenBattleMeta>("battle/golden-meta.json");
  }
  goldenPetStats(): Promise<GoldenPetStats> {
    return this.document<GoldenPetStats>("battle/golden-pet-stats.json");
  }
  goldenBattleUnits(): Promise<GoldenBattleUnits> {
    return this.document<GoldenBattleUnits>("battle/golden-battle-units.json");
  }
  /**
   * One enemy decision point of the production 1v1 turn, as the Java AI pipeline answered it.
   *
   * The referee for the AI-v2 port: the row replays through the TypeScript observation, policy,
   * candidate, utility, invariant and canary passes, and every block the port produces is compared.
   * Nothing in the `observation`/`utility`/`canary` blocks may be read as a table the runtime consults.
   */
  goldenBattleAi(): Promise<GoldenBattleAiTable> {
    return this.document<GoldenBattleAiTable>("battle/golden-battle-ai.json");
  }
  goldenDamage(): Promise<GoldenDamageTable> {
    return this.document<GoldenDamageTable>("battle/golden-damage.json");
  }
  goldenSkillBranch(): Promise<GoldenSkillBranchTable> {
    return this.document<GoldenSkillBranchTable>("battle/golden-skill-branch.json");
  }
  /** Every answer the Java engine gave about one status, from application to expiry. */
  goldenStatusLifecycle(): Promise<GoldenStatusLifecycleTable> {
    return this.document<GoldenStatusLifecycleTable>("battle/golden-status-lifecycle.json");
  }
  /** What the engine attaches after a skill, and the strip the battle HUD draws from it. */
  goldenStatusPresentation(): Promise<GoldenStatusPresentationTable> {
    return this.document<GoldenStatusPresentationTable>("battle/golden-status-presentation.json");
  }
  /** Every answer the Java engine gave about the item a pet holds into the battle. */
  goldenHeldItems(): Promise<GoldenHeldItemsTable> {
    return this.document<GoldenHeldItemsTable>("battle/golden-held-items.json");
  }
  goldenCatch(): Promise<GoldenCatchTable> {
    return this.document<GoldenCatchTable>("battle/golden-catch.json");
  }
  goldenExp(): Promise<GoldenExpTable> {
    return this.document<GoldenExpTable>("battle/golden-exp.json");
  }
  goldenFlow(): Promise<GoldenFlowTable> {
    return this.document<GoldenFlowTable>("battle/golden-flow.json");
  }
  goldenRng(): Promise<GoldenRngTable> {
    return this.document<GoldenRngTable>("battle/golden-rng.json");
  }
  /** The health-and-shield bar as pixels the Java renderer actually painted. */
  goldenShieldTrack(): Promise<GoldenShieldTrackTable> {
    return this.document<GoldenShieldTrackTable>("battle/golden-shield-track.json");
  }
  /**
   * The recorded call list for all 280 characteristics: every step is an engine call the port
   * replays, with the value it returned and the unit state it left behind.
   */
  goldenTraits(): Promise<GoldenTraitsTable> {
    return this.document<GoldenTraitsTable>("battle/golden-traits.json");
  }
  /**
   * The recorded call list for the 19 rollable talents (thien phu, physicalTraitId 0..18). Each row
   * runs one scenario of that talent's own mechanic family, alone on the species with no
   * characteristic and again composed with characteristic species 0.
   */
  goldenPhysicalTraits(): Promise<GoldenPhysicalTraitsTable> {
    return this.document<GoldenPhysicalTraitsTable>("battle/golden-physical-traits.json");
  }
  /**
   * The same two engines composed: the roll and the permanent-stat resolver, then the scene1
   * tutorial fight walked with both species characteristics live and one talent on one side.
   */
  goldenTraitBattle(): Promise<GoldenTraitBattleTable> {
    return this.document<GoldenTraitBattleTable>("battle/golden-trait-battle.json");
  }
}
