import type { RainbowCharmBattleState } from "../../charm/RainbowCharmBattle";
import type { BattleBadgeProfile } from "../BattleBadges";
/**
 * The battle core's vocabulary: who fights, what a side asks for, and what the core reports back.
 *
 * The core is pure logic. It never draws, waits or animates: the presentation feeds it commands and
 * plays the events it returns, in order. Every rule lives in the engines the core composes (the damage
 * formula, statuses, characteristics, talents, signature and Cầu Vồng skills); the core only decides
 * who acts when.
 */

/** The two sides of a fight. Seats inside a side are numbered from 0. */
export type SideId = "player" | "enemy";

export const OTHER_SIDE: Record<SideId, SideId> = { player: "enemy", enemy: "player" };

/**
 * How many pets stand on each side at once. Only 1v1 resolves today; the seats are arrays so 2v2
 * adds targets and an order over four actors, not a new data model.
 */
export type BattleFormat = "1v1" | "2v2";

/** Whose pet the enemy side is: a wild one can be caught and fled from, a trainer's or a boss's cannot. */
export type BattleKind = "wild" | "trainer" | "boss";

/**
 * `BattleUnit.enemyFromEncounter`'s nature when the encounter record is too short to carry one:
 * Java reads `encounter.length > 2 ? encounter[2] : 3`.
 */
export const ENCOUNTER_NATURE_FALLBACK = 3;

/** `VqsvText.Battle.CATCH_NOT_ALLOWED` and `RUN_NOT_ALLOWED`, the two refusals a fight can hit. */
export const CATCH_NOT_ALLOWED_TEXT = "Trận chiến này không cho bắt sủng vật";
export const RUN_NOT_ALLOWED_TEXT = "Trận chiến này không thể trốn chạy";

/** One pet as a fight starts it: what the save (or the encounter) knows about it. */
export type CombatantSetup = {
  speciesId: number;
  level: number;
  /**
   * `BattlePetSnapshot.quality`: phẩm chất 1..5, the axis the stats were grown along; the -1
   * sentinel is an encounter record that authored none. It is not what catch chance and EXP read.
   */
  quality: number;
  /**
   * `BattlePetSnapshot.nature`: Java's own 1..9, and the seat catch chance and EXP index by it.
   * 7, 8 and 9 are the shiny ones, which also bend hp, attack and speed.
   */
  nature: number;
  /** Level-and-quality stats from `PetStatCalculator`; `hp` is the maximum. */
  stats: { hp: number; attack: number; defense: number; speed: number };
  /** Current HP; omitted is full. */
  hp?: number;
  /** Up to five skill ids; PP per slot (omitted: each skill's maximum). */
  skillIds: readonly number[];
  skillPp?: readonly number[];
  /** Thiên phú (talent) runtime id; omitted is none. */
  physicalTraitId?: number;
  heldItemId?: number;
  name?: string;
  spriteId?: number;
  /** Hệ (element) the seat's badge shows. */
  element?: number;
};

export type BattleSetup = {
  format: BattleFormat;
  kind: BattleKind;
  /**
   * `VqsvBattleRuntime.captureForbidden()`: whose pet the enemy is and what op32's mode says. `kind`
   * answers the first half only — a source battle can author `battleMode[0] === 2` on an encounter
   * that looks wild. Omitted: what `kind` says.
   */
  captureAllowed?: boolean;
  /**
   * `tickRun`'s `battleModeRestricted`: Java's second, unrelated gate — a fight can be catchable and
   * still refuse to let the player leave. Omitted: a wild fight allows it.
   */
  runAllowed?: boolean;
  player: readonly CombatantSetup[];
  enemy: readonly CombatantSetup[];
  /** Bag items the player may use, by item id; spent as they are used. */
  inventory?: Record<number, number>;
  /** Extra catch points (badges, events). */
  captureBonusPoints?: number;
  /**
   * A story fight's script on top of the rules. `unkillable`: that side's pets stop at 1 HP (the
   * Scene 1 bunny has to stay catchable). `forcedCatch`: the result of throw number `attempt` (from
   * 1), or `undefined` to roll it.
   */
  script?: {
    unkillable?: SideId;
    forcedCatch?: (attempt: number, itemId: number) => boolean | undefined;
  };
  /**
   * Each side's team charms (`VqsvBattleRuntime.rainbowCharms` / `enemyRainbowCharms`): the
   * player's equipped set in any fight but PvP, an NPC's only for a Cầu Vồng trainer. Absent: none.
   */
  charms?: BattleCharms;
  /**
   * `PetBattleAdapter.battleBadgeProfile(session.progression.badges)`: the badge passives every player
   * pet carries into the fight (`toBattleUnit(pet, 0, badges)`). Absent: none.
   */
  badgeProfile?: BattleBadgeProfile;
  /**
   * `sourcePostExpPassiveHealAmount(speciesId)` while Liệt Hỏa is enhanced, undefined otherwise: what
   * `applySourcePostExpPassiveHeal` gives every living player pet once a knockout's EXP is committed.
   */
  postExpBadgeHeal?: (speciesId: number) => number | undefined;
};

/**
 * The two sides' team charms. The NPC's set is drawn at entry from the fight's own stream
 * (`CauVongNpcCharms.create` with `battle.npcCharm.select`), so it is a factory over the draw and
 * the enemy team's species; it answers undefined for every fight but a Cầu Vồng trainer's.
 */
export type BattleCharms = {
  player?: RainbowCharmBattleState;
  enemy?: (
    next: (bound: number) => number,
    enemySpecies: readonly number[],
  ) => RainbowCharmBattleState | undefined;
};

/** What the player (or the enemy controller) tells the core to do with an active pet. */
export type BattleCommand =
  | { kind: "skill"; slot: number }
  | { kind: "switch"; member: number }
  /** `member` is the party pet the item is for (default: the active one); `skillSlot` for PP items. */
  | { kind: "item"; itemId: number; member?: number; skillSlot?: number }
  | { kind: "catch"; itemId: number }
  | { kind: "run" };

/** What the core is waiting for. Nothing advances until it gets it. */
export type BattleRequest =
  | { kind: "command"; side: "player"; round: number }
  /** The active pet fainted: pick who comes in (`member`), there is no declining. */
  | { kind: "replacement"; side: "player" }
  /** A PIVOT signature offers a switch after its hit: a member, or `null` to stay. */
  | { kind: "pivot"; side: "player" }
  | { kind: "ended"; outcome: BattleOutcome };

export type BattleOutcome = {
  /** "none" when nobody won: the player ran. */
  winner: SideId | "none";
  reason: "knockout" | "run" | "catch";
  /** EXP each player party member earned, by member index (summed over every enemy knocked out). */
  experience: number[];
  /** The caught enemy member, when `reason` is "catch". */
  caught?: number;
};

/** Where a pet stands: its side and its index in that side's party. */
export type Seat = { side: SideId; member: number };

/**
 * What happened, in the order it happened. A presentation plays these one after another; the core
 * has already applied every one of them to the units.
 */
export type BattleEvent =
  | { type: "enter"; seat: Seat }
  | { type: "roundStart"; round: number }
  | { type: "statusTick"; seat: Seat; damage: number; heal: number }
  | { type: "blocked"; seat: Seat; status: string }
  | { type: "controlled"; seat: Seat; status: string; skillSlot: number; selfHit: boolean }
  | {
      type: "skill";
      seat: Seat;
      skillId: number;
      target: Seat;
      hit: boolean;
      damage: number;
      crit: boolean;
      targetHp: number;
      attackerHp: number;
    }
  | { type: "noPp"; seat: Seat }
  /** Phong Bế left no legal skill: the turn passes. */
  | { type: "noLegalSkill"; seat: Seat }
  | {
      type: "switch";
      side: SideId;
      from: number;
      to: number;
      reason: "command" | "pivot" | "faint";
    }
  | {
      type: "item";
      seat: Seat;
      itemId: number;
      hpGained: number;
      ppGained: number;
      revived: boolean;
    }
  | { type: "catch"; target: Seat; itemId: number; chance: number; caught: boolean }
  | { type: "run"; success: boolean }
  | { type: "faint"; seat: Seat }
  | { type: "experience"; member: number; amount: number; from: Seat }
  | { type: "roundEnd"; round: number }
  /** Cao cấp trị liệu: a team charm healed a pet under half HP. */
  | { type: "charmHeal"; seat: Seat; amount: number }
  /** Trọng sinh làm tâm: a team charm brought a fallen pet back. */
  | { type: "charmRevive"; seat: Seat; hp: number }
  /** Long Ấn (Kim Diễm Long Vương): a repeated skill's damage turned back on the attacker. */
  | { type: "longAn"; seat: Seat; damage: number; attackerHp: number }
  | { type: "end"; outcome: BattleOutcome };

/** A command the core refused, and why. Nothing was spent. */
export class BattleCommandError extends Error {}

/** `VqsvBattleRuntime` P3: a tier-2/3 pick while Phong Bế (2/6) is held. */
export const TIER_LOCK_WARNING = "Phong Bế: không thể dùng Skill Tier 2–3.";
/** `VqsvBattleRuntime` P3: a pick `canUseSourceSkillId` refuses (a sealed slot, an unpaid sacrifice). */
export const SKILL_NOT_READY_WARNING = "Tuyệt kỹ chưa sẵn sàng hoặc không đủ HP.";
/** `tickSelectExecute`: Phong Bế left the actor nothing it may use, so its turn passes. */
export const NO_LEGAL_SKILL_MESSAGE = "Phong Bế: không còn Skill hợp lệ trong lượt này.";
