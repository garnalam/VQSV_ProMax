import type { PackBattleAiProfile } from "../../../data/GameData";
import type { BattleBadgeProfile } from "../BattleBadges";
import type { BattleCharms, CombatantSetup } from "./BattleTypes";

/**
 * The simultaneous 2v2 (`VqsvDoubleBattleRuntime`): four formation slots — 0 and 1 the NPC's pets,
 * 2 the player's, 3 the player's second pet (a gym, `playerControlsBoth`) or the companion an NPC
 * lends for the fight (Harry's at Bích Thủy, played by the COMPANION AI).
 */
export type DoubleSlot = 0 | 1 | 2 | 3;
export type PlayerSlot = 2 | 3;

export const ENEMY_SLOTS = [0, 1] as const;
export const PLAYER_SLOTS = [2, 3] as const;

/** `double-battle/skill-scopes.json`, baked by `ProbeWebDoubleBattle` from Java. */
export type DoubleSkillRules = {
  profileVersion: string;
  /** `DoubleBattleSkillScopeCatalog.scope` for every skill that is not single-target. */
  scopes: Record<string, "ALL_ENEMIES" | "ALL_ALLIES">;
  /** `SkillActionPriority.forSkillId == DEFENSIVE`: these act before the speed order. */
  defensivePriority: number[];
};

export type DoubleBattleSetup = {
  /** Hoàng Kim rank one or two: reserve EXP percentage (30). */
  goldenPartyExperiencePercent?: number;
  /** Source scene and encounter ownership for Cầu Vồng's mirrored item recovery. */
  sceneId?: number;
  capturePolicy?: string;
  /** `playerControlsBoth`: a gym fight, the player commands slots 2 and 3. */
  controlsBoth: boolean;
  /** The player's battle owners: the first six roster pets, in roster order. */
  player: readonly CombatantSetup[];
  /** The lent pets (`companionRoster`, at most three) when the player does not control slot 3. */
  companion: readonly CombatantSetup[];
  /** The NPC's roster; the first two open the fight. */
  enemy: readonly CombatantSetup[];
  /** The descriptor's `aiProfile` (the NPC's tier, item budget...). */
  enemyProfile: PackBattleAiProfile;
  /** `BattleAiProfile.COMPANION`, the lent pet's brain. */
  companionProfile: PackBattleAiProfile;
  /** The AI-v2 encounter (`encounters.tsv`), which turns the joint planner on. */
  encounterKey?: string;
  /** Bag items by id; spent when the queued item resolves. */
  inventory?: Record<number, number>;
  charms?: BattleCharms;
  /** The player's badge passives, for its own units only — a lent companion carries none. */
  badgeProfile?: BattleBadgeProfile;
  /**
   * The units arrive with their talent's permanent stats already in `stats` (a replay of a Java
   * fight records them after `applyProductionPermanentTraitStats`), so the projection must not add
   * them again on entry.
   */
  permanentStatsApplied?: boolean;
  /**
   * The authored boss fight this is (`repeatableRewardContext`), which switches its own rules on: only
   * Tàn Nguyệt Long Ma's Ma Mộc Cộng Sinh today.
   */
  boss?: "tan-nguyet-long-ma";
};

/** One slot's command for the round (`tickCommand`): Chiến đấu, Đạo cụ, or Đổi pet. */
export type DoubleCommand =
  /** `skillIndex` into the pet's skill slots; `target` a formation slot from `legalTargets`. */
  | { kind: "skill"; skillIndex: number; target: DoubleSlot }
  /** `member` is the player battle owner the item is for. */
  | { kind: "item"; itemId: number; member: number }
  /** A manual switch: done at once, and the slot gives no other command this round. */
  | { kind: "switch"; member: number };

export type DoubleRequest =
  | { kind: "command"; slot: PlayerSlot; round: number }
  /** A fallen (or pivoting) player slot needs a benched pet; there is no declining. */
  | { kind: "replacement"; slot: PlayerSlot }
  | { kind: "ended"; outcome: DoubleOutcome };

export type DoubleOutcome = {
  winner: "player" | "enemy";
  /** Direct EXP by player battle owner (living participants share the defeated roster). */
  experience: number[];
  /** Benched EXP by player battle owner (held item 6). */
  reserveExperience: number[];
};

/** Who stands in a slot: a player owner, a companion, or an NPC roster member. */
export type DoubleOccupant = { side: "player" | "companion" | "enemy"; index: number };

export type DoubleEvent =
  | { type: "enter" }
  | { type: "roundStart"; round: number }
  | { type: "statusTick"; slot: DoubleSlot; damage: number; heal: number }
  | { type: "blocked"; slot: DoubleSlot; status: string }
  | { type: "controlled"; slot: DoubleSlot; status: string; selfHit: boolean }
  | { type: "noPp"; slot: DoubleSlot }
  | {
      type: "strike";
      slot: DoubleSlot;
      /** The slot the skill was declared on (a self-hit lands on `receiver` instead). */
      target: DoubleSlot;
      receiver: DoubleSlot;
      skillId: number;
      hit: boolean;
      damage: number;
      crit: boolean;
      receiverHp: number;
      actorHp: number;
      /** The group target's second hit (`groupSecondary`), at the scaled Power. */
      secondary: boolean;
    }
  | {
      type: "item";
      slot: DoubleSlot;
      target: DoubleSlot | -1;
      itemId: number;
      hpGained: number;
      ppGained: number;
      revived: boolean;
      /** Free enemy recovery after a player item; the species also names a benched target. */
      cauVongRecovery?: { speciesId: number };
      /** Set when the queued item could not be used any more (`itemWarning`). */
      refused?: string;
    }
  | {
      type: "replacement";
      slot: DoubleSlot;
      from: DoubleOccupant;
      to: DoubleOccupant;
      forced: boolean;
    }
  | { type: "faint"; slot: DoubleSlot }
  | { type: "charmHeal"; slot: DoubleSlot; amount: number }
  | { type: "charmRevive"; slot: DoubleSlot; hp: number }
  /** The boss drained HP off a hit; Hoa Tiên Tử's once-a-round share rides with it. */
  | {
      type: "lifeSteal";
      slot: DoubleSlot;
      amount: number;
      shared: number;
      sharedSlot: DoubleSlot | -1;
    }
  /** Tàn Nguyệt Long Ma rose once at half HP, Hoa Tiên Tử paying for it when it still stood. */
  | { type: "bossRevive"; slot: DoubleSlot; hp: number; hoaSlot: DoubleSlot | -1; hoaCost: number }
  /** Hoa Tiên Tử fell with the boss standing: Cuồng Nộ to the end of the fight. */
  | { type: "bossEnrage"; slot: DoubleSlot }
  /** A player item Ma Mộc Cộng Sinh seals, refused when its turn came. */
  | { type: "sealedItem"; slot: DoubleSlot; itemId: number }
  | { type: "experience"; member: number; amount: number; reserve: boolean }
  | { type: "end"; outcome: DoubleOutcome };
