/**
 * The battle's turn-order and menu decisions, ported from `vqsv.battle.BattleFlowEngine`.
 *
 * Every function is pure: it takes the state the runtime already holds and returns what happens
 * next. The order of the checks in `decideDispatch` is the Java engine's precedence, so a rule
 * cannot be reordered even where the outcome looks the same. Each row of
 * `data/battle/golden-flow.json` — the answers the Java engine wrote for a full input grid — grades
 * this file, so a wrong precedence fails a test instead of reaching the player.
 */

/** Whose turn it is next, or why the battle cannot dispatch one. */
export type BattleDispatchCommand =
  "PLAYER_DEFEATED" | "ENEMY_DEFEATED" | "PLAYER_TURN" | "ENEMY_TURN" | "RESET_ROUND";

/** The rule that decided the command, kept because the runtime logs and animates it. */
export type BattlePriorityReason =
  | "PLAYER_DEFEATED"
  | "ENEMY_DEFEATED"
  | "KIDNAPPING"
  | "HELD_ITEM7"
  | "TRAIT_PRIORITY"
  | "SPEED"
  | "PLAYER_REMAINING_ACTION"
  | "ENEMY_REMAINING_ACTION"
  | "ROUND_COMPLETE";

export type BattleDispatchInput = {
  playerAlive: boolean;
  enemyAlive: boolean;
  kidnappingBattle: boolean;
  playerActionThisRound: boolean;
  enemyActionThisRound: boolean;
  /** The held-item priority slot (`game.d.T f(7)`), not the item itself. */
  playerHeldItem7: boolean;
  enemyHeldItem7: boolean;
  /** Render-projected speeds, so buffs, items and trait effects are already folded in. */
  playerSpeed: number;
  enemySpeed: number;
  playerTraitPriority: boolean;
  enemyTraitPriority: boolean;
};

export type BattleDispatchResult = {
  command: BattleDispatchCommand;
  reason: BattlePriorityReason;
};

export type BattleCommandOutcome =
  | "OPEN_SKILL_LIST"
  | "WARN_CATCH_FORBIDDEN"
  | "OPEN_CATCH_LIST"
  | "WARN_ITEM_BOUND"
  | "OPEN_ITEM_LIST"
  | "WARN_PET_BOUND"
  | "OPEN_PET_LIST"
  | "OPEN_SHOP"
  | "WARN_RUN_BOUND"
  | "ENTER_RUN"
  | "RESET_INVALID_COMMAND";

export type BattleRunOutcome = "WARN_RUN_NOT_ALLOWED" | "RUN_SUCCESS";

export type BattleDefeatOutcome =
  "FORCE_PLAYER_SWITCH" | "PLAYER_LOST" | "REPLACE_ENEMY" | "ENEMY_PARTY_DEFEATED";

export type BattleWarningResumeOutcome =
  | "RETURN_COMMAND"
  | "RETURN_TARGET_SELECT"
  | "RETURN_CATCH_LIST"
  | "RETURN_SKILL_LIST"
  | "RETURN_ITEM_LIST"
  | "RETURN_ITEM_TARGET"
  | "RETURN_PET_SWITCH"
  | "RETURN_SHOP"
  | "RETURN_DISPATCH";

const WARNING_RESUME_TARGETS: Record<number, BattleWarningResumeOutcome> = {
  20: "RETURN_COMMAND",
  6: "RETURN_TARGET_SELECT",
  21: "RETURN_CATCH_LIST",
  3: "RETURN_SKILL_LIST",
  4: "RETURN_ITEM_LIST",
  16: "RETURN_ITEM_TARGET",
  5: "RETURN_PET_SWITCH",
  11: "RETURN_SHOP",
  1: "RETURN_DISPATCH",
};

export function decideDispatch(input: BattleDispatchInput): BattleDispatchResult {
  const bothIdle = !input.playerActionThisRound && !input.enemyActionThisRound;
  if (!input.playerAlive) return { command: "PLAYER_DEFEATED", reason: "PLAYER_DEFEATED" };
  if (!input.enemyAlive) return { command: "ENEMY_DEFEATED", reason: "ENEMY_DEFEATED" };
  if (input.kidnappingBattle) return { command: "ENEMY_TURN", reason: "KIDNAPPING" };
  if (bothIdle && (input.playerHeldItem7 || input.enemyHeldItem7))
    return {
      command: input.playerHeldItem7 ? "PLAYER_TURN" : "ENEMY_TURN",
      reason: "HELD_ITEM7",
    };
  if (bothIdle && (input.playerTraitPriority || input.enemyTraitPriority))
    return {
      command:
        input.playerTraitPriority && !input.enemyTraitPriority ? "PLAYER_TURN" : "ENEMY_TURN",
      reason: "TRAIT_PRIORITY",
    };
  if (bothIdle && input.enemySpeed > input.playerSpeed)
    return { command: "ENEMY_TURN", reason: "SPEED" };
  if (!input.playerActionThisRound)
    return { command: "PLAYER_TURN", reason: "PLAYER_REMAINING_ACTION" };
  if (!input.enemyActionThisRound)
    return { command: "ENEMY_TURN", reason: "ENEMY_REMAINING_ACTION" };
  return { command: "RESET_ROUND", reason: "ROUND_COMPLETE" };
}

export function decideCommand(input: {
  commandIndex: number;
  catchForbidden: boolean;
  playerBound: boolean;
}): { outcome: BattleCommandOutcome } {
  switch (input.commandIndex) {
    case 0:
      return { outcome: "OPEN_SKILL_LIST" };
    case 1:
      return { outcome: input.catchForbidden ? "WARN_CATCH_FORBIDDEN" : "OPEN_CATCH_LIST" };
    case 2:
      return { outcome: input.playerBound ? "WARN_ITEM_BOUND" : "OPEN_ITEM_LIST" };
    case 3:
      return { outcome: input.playerBound ? "WARN_PET_BOUND" : "OPEN_PET_LIST" };
    case 4:
      return { outcome: "OPEN_SHOP" };
    case 5:
      return { outcome: input.playerBound ? "WARN_RUN_BOUND" : "ENTER_RUN" };
    default:
      return { outcome: "RESET_INVALID_COMMAND" };
  }
}

export function decideRun(input: { battleModeRestricted: boolean }): { outcome: BattleRunOutcome } {
  return {
    outcome: input.battleModeRestricted ? "WARN_RUN_NOT_ALLOWED" : "RUN_SUCCESS",
  };
}

/** The story branch a battle result selects; a missing target leaves the caller at -1. */
export function decideBranch(input: { resultIndex: number; branchTargets: number[] }): {
  branchTarget: number;
} {
  if (input.resultIndex < 0 || input.branchTargets.length === 0) return { branchTarget: -1 };
  const index = Math.min(Math.max(0, input.resultIndex), input.branchTargets.length - 1);
  return { branchTarget: input.branchTargets[index] };
}

/** Who takes the field after a side loses its active unit. */
export function decideDefeatContinuation(input: {
  playerSide: boolean;
  playerHasLivingReserve: boolean;
  activeEnemyIndex: number;
  enemyAlive: boolean[];
}): { outcome: BattleDefeatOutcome; replacementIndex: number } {
  if (input.playerSide)
    return input.playerHasLivingReserve
      ? { outcome: "FORCE_PLAYER_SWITCH", replacementIndex: -1 }
      : { outcome: "PLAYER_LOST", replacementIndex: -1 };
  for (
    let index = Math.max(0, input.activeEnemyIndex + 1);
    index < input.enemyAlive.length;
    index++
  )
    if (input.enemyAlive[index]) return { outcome: "REPLACE_ENEMY", replacementIndex: index };
  // A tactical switch can leave living members before the active slot: forward entry order first,
  // then those withdrawn members, because the Java runtime re-enters them in exactly that order.
  for (let index = 0; index < Math.min(input.activeEnemyIndex, input.enemyAlive.length); index++)
    if (input.enemyAlive[index]) return { outcome: "REPLACE_ENEMY", replacementIndex: index };
  return { outcome: "ENEMY_PARTY_DEFEATED", replacementIndex: -1 };
}

/** Where a dismissed warning returns the player to, by the state id the warning was raised from. */
export function decideWarningResume(input: { returnStateId: number }): {
  outcome: BattleWarningResumeOutcome;
} {
  return { outcome: WARNING_RESUME_TARGETS[input.returnStateId] ?? "RETURN_COMMAND" };
}
