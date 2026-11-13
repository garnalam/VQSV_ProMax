import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GameData } from "../../data/GameData";
import type { GoldenDispatchRow, GoldenFlowTable } from "../../data/GameData";
import { Pack } from "../../pack/Pack";
import {
  decideBranch,
  decideCommand,
  decideDefeatContinuation,
  decideDispatch,
  decideRun,
  decideWarningResume,
  type BattleDispatchInput,
} from "./BattleFlowEngine";

const root = resolve(import.meta.dirname, "..", "..", "..");

vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(root, "public", decodeURIComponent(input.replace(/^\//, "")));
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(readFileSync(file, "utf8")),
  };
});

/** The nine bit columns, in the order the probe wrote them, named the way the engine names them. */
const INPUT_ORDER = [
  "playerAlive",
  "enemyAlive",
  "kidnapping",
  "playerActed",
  "enemyActed",
  "playerHeldItem7",
  "enemyHeldItem7",
  "playerTraitPriority",
  "enemyTraitPriority",
];

function dispatchInput(row: GoldenDispatchRow): BattleDispatchInput {
  const [
    playerAlive,
    enemyAlive,
    kidnapping,
    playerActed,
    enemyActed,
    playerHeld,
    enemyHeld,
    playerTrait,
    enemyTrait,
  ] = row.bits;
  return {
    playerAlive,
    enemyAlive,
    kidnappingBattle: kidnapping,
    playerActionThisRound: playerActed,
    enemyActionThisRound: enemyActed,
    playerHeldItem7: playerHeld,
    enemyHeldItem7: enemyHeld,
    playerSpeed: row.speed[0],
    enemySpeed: row.speed[1],
    playerTraitPriority: playerTrait,
    enemyTraitPriority: enemyTrait,
  };
}

async function flow(): Promise<GoldenFlowTable> {
  return new GameData(await Pack.load()).goldenFlow();
}

describe("battle flow engine", () => {
  it("answers every dispatch row the Java probe wrote", async () => {
    const table = await flow();
    expect(table.schema).toBe("vqsv-webnative-battle-golden-flow-v1");
    expect(table.inputOrder).toEqual(INPUT_ORDER);
    // 2^9 input combinations for each of the three speed pairs the probe sampled.
    expect(table.dispatch).toHaveLength(1536);
    const mismatches = table.dispatch
      .map((row) => ({ row, got: decideDispatch(dispatchInput(row)) }))
      .filter(({ row, got }) => got.command !== row.command || got.reason !== row.reason)
      .map(
        ({ row, got }) =>
          `${JSON.stringify(row.bits)} ${row.speed} -> ${got.command}/${got.reason}`,
      );
    expect(mismatches).toEqual([]);
    // Every rule is reachable, so a passing grid cannot be one rule carrying the whole table.
    const reasons = new Set(table.dispatch.map((row) => row.reason));
    expect([...reasons].sort()).toEqual(
      [
        "ENEMY_DEFEATED",
        "ENEMY_REMAINING_ACTION",
        "HELD_ITEM7",
        "KIDNAPPING",
        "PLAYER_DEFEATED",
        "PLAYER_REMAINING_ACTION",
        "ROUND_COMPLETE",
        "SPEED",
        "TRAIT_PRIORITY",
      ].sort(),
    );
  });

  it("hands the turn to the rule the engine put first", () => {
    const idle: BattleDispatchInput = {
      playerAlive: true,
      enemyAlive: true,
      kidnappingBattle: false,
      playerActionThisRound: false,
      enemyActionThisRound: false,
      playerHeldItem7: false,
      enemyHeldItem7: false,
      playerSpeed: 5,
      enemySpeed: 5,
      playerTraitPriority: false,
      enemyTraitPriority: false,
    };
    // A tie is not "faster", so nobody gains a speed turn and the player acts by default.
    expect(decideDispatch({ ...idle, playerSpeed: 12, enemySpeed: 12 })).toEqual({
      command: "PLAYER_TURN",
      reason: "PLAYER_REMAINING_ACTION",
    });
    // The held item outranks a strictly faster enemy, and it only counts while both can still act.
    expect(decideDispatch({ ...idle, playerHeldItem7: true, enemySpeed: 20 })).toEqual({
      command: "PLAYER_TURN",
      reason: "HELD_ITEM7",
    });
    expect(
      decideDispatch({
        ...idle,
        playerHeldItem7: true,
        enemySpeed: 20,
        enemyActionThisRound: true,
      }),
    ).toEqual({ command: "PLAYER_TURN", reason: "PLAYER_REMAINING_ACTION" });
    // Both sides claiming trait priority does not cancel out: the engine's player-only test fails
    // and the enemy takes the turn.
    expect(
      decideDispatch({ ...idle, playerTraitPriority: true, enemyTraitPriority: true }),
    ).toEqual({ command: "ENEMY_TURN", reason: "TRAIT_PRIORITY" });
    // Defeat and the kidnapping fight outrank everything, including a player who has not acted.
    expect(decideDispatch({ ...idle, playerAlive: false, enemyAlive: false })).toEqual({
      command: "PLAYER_DEFEATED",
      reason: "PLAYER_DEFEATED",
    });
    expect(decideDispatch({ ...idle, kidnappingBattle: true, playerHeldItem7: true })).toEqual({
      command: "ENEMY_TURN",
      reason: "KIDNAPPING",
    });
  });

  it("answers the command, run, branch, defeat and warning rows too", async () => {
    const table = await flow();
    expect(table.command).toHaveLength(32);
    expect(table.command.map((row) => decideCommand(row).outcome)).toEqual(
      table.command.map((row) => row.outcome),
    );
    expect(table.run.map((row) => decideRun(row).outcome)).toEqual(
      table.run.map((row) => row.outcome),
    );
    expect(table.branch).toHaveLength(35);
    expect(
      table.branch.map(
        (row) =>
          decideBranch({ resultIndex: row.resultIndex, branchTargets: row.branchTargets })
            .branchTarget,
      ),
    ).toEqual(table.branch.map((row) => row.branch));
    expect(table.defeat).toHaveLength(96);
    expect(
      table.defeat.map((row) =>
        decideDefeatContinuation({
          playerSide: row.playerSide,
          playerHasLivingReserve: row.hasLivingReserve,
          activeEnemyIndex: row.activeEnemyIndex,
          enemyAlive: row.enemyAlive,
        }),
      ),
    ).toEqual(
      table.defeat.map((row) => ({ outcome: row.outcome, replacementIndex: row.replacement })),
    );
    expect(table.warningResume).toHaveLength(26);
    expect(table.warningResume.map((row) => decideWarningResume(row).outcome)).toEqual(
      table.warningResume.map((row) => row.outcome),
    );
  });

  it("resumes a warning from an unknown state the way the engine's default does", async () => {
    expect(decideWarningResume({ returnStateId: 26 }).outcome).toBe("RETURN_COMMAND");
    expect(decideWarningResume({ returnStateId: -1 }).outcome).toBe("RETURN_COMMAND");
    expect(
      decideCommand({ commandIndex: 6, catchForbidden: false, playerBound: false }).outcome,
    ).toBe("RESET_INVALID_COMMAND");
    expect(decideBranch({ resultIndex: 0, branchTargets: [] }).branchTarget).toBe(-1);
    expect(decideBranch({ resultIndex: 9, branchTargets: [10, 11, 12] }).branchTarget).toBe(12);
  });
});
