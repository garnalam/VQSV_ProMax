// The numbers that close a battle live in three places the Web cannot read at runtime: the forced
// result index is an argument at the Scene 1 call site, the capture flag is a species comparison
// inside a private predicate, and the level-up hold/tween counts are literals inside one tick method.
// None of them may be restated in TypeScript, so the exporters write them into the shipped pack.
// This guard re-reads the Java sources and refuses the dump if any of them moves.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const repo = resolve(root, "..");
const java = (...parts) => resolve(repo, "rebuild_game", "src", "main", "java", ...parts);

/** The runtime that owns the closing states and the EXP panel. */
const RUNTIME_SOURCE = readFileSync(java("vqsv", "game", "VqsvBattleRuntime.java"), "utf8");
/** The authored Scene 1 script that opens the Bunny fight. */
const SCRIPTS_SOURCE = readFileSync(java("vqsv", "game", "VqsvBattleScripts.java"), "utf8");
/** The dump the quest exporter wrote those answers into. */
const CONTRACT = JSON.parse(
  readFileSync(resolve(root, "public", "pack", "story", "world-contract.json"), "utf8"),
);
/** The dump the catalog harness reflected the wait constants into. */
const WAITS = JSON.parse(
  readFileSync(
    resolve(root, "public", "pack", "data", "battle", "runtime-wait-constants.json"),
    "utf8",
  ),
);
/** The dump the catalog harness read the level-up literals out of the runtime's source into. */
const EXP = JSON.parse(
  readFileSync(resolve(root, "public", "pack", "data", "battle", "exp-presentation.json"), "utf8"),
);

/** The body of one method of the runtime, sliced from its signature to the closing brace at indent 4. */
function runtimeMethod(signature) {
  const start = RUNTIME_SOURCE.indexOf(signature);
  expect(start, `${signature} no longer exists in the runtime`).toBeGreaterThan(-1);
  return RUNTIME_SOURCE.slice(start, RUNTIME_SOURCE.indexOf("\n    }", start));
}

it("ships the forced result index the Scene 1 Bunny call site passes", () => {
  const start = SCRIPTS_SOURCE.indexOf("room1BunnyBattleCaptureRuntime");
  expect(start, "the Bunny battle script no longer exists").toBeGreaterThan(-1);
  const body = SCRIPTS_SOURCE.slice(start, SCRIPTS_SOURCE.indexOf("\n    }", start));
  const call = body.match(/questPetWorldRetryRequest\(\s*\w+\s*,\s*(-?\d+)\s*\)/);
  expect(
    call,
    "the Bunny script no longer forces a result index on the quest-pet retry",
  ).not.toBeUndefined();
  expect(CONTRACT.encounter.forcedResultIndex).toBe(Number(call[1]));
});

it("ships the species the capture-battle predicate compares the encounter against", () => {
  const predicate = runtimeMethod("private boolean isBunnyCaptureBattle()");
  const compare = predicate.match(/encounter\[0\]\s*==\s*(\d+)/);
  expect(
    compare,
    "the runtime no longer recognizes the capture battle by an encounter species",
  ).not.toBeUndefined();
  expect(CONTRACT.encounter.captureSpeciesId).toBe(Number(compare[1]));
});

it("ships the hold, finish and tween counts the level-up pass runs on", () => {
  const tick = runtimeMethod("private boolean tickWinExpLevelUp(");
  const answers = {
    holdTicks: tick.match(/expHoldTicks\s*=\s*(\d+);/),
    finishHoldTicks: tick.match(/expHoldTicks\+\+\s*>=\s*(\d+)/),
    tweenStep: tick.match(/expDisplayValue\s*\+\s*(\d+)/),
  };
  for (const [key, match] of Object.entries(answers))
    expect(match, `tickWinExpLevelUp no longer carries its ${key} literal`).not.toBeUndefined();
  expect(EXP).toEqual({
    holdTicks: Number(answers.holdTicks[1]),
    finishHoldTicks: Number(answers.finishHoldTicks[1]),
    tweenStep: Number(answers.tweenStep[1]),
  });
});

it("ships every wait the closing states hold for, as the runtime declares them", () => {
  const declared = {};
  for (const [, name, value] of RUNTIME_SOURCE.matchAll(
    /static final int (\w*WAIT\w*)\s*=\s*(\d+);/g,
  ))
    declared[`VqsvBattleRuntime.${name}`] = Number(value);
  expect(Object.keys(declared).sort(), "the runtime declares no wait constant").toContain(
    "VqsvBattleRuntime.EXIT_WAIT",
  );
  const shipped = Object.fromEntries(
    Object.entries(WAITS).filter(([key]) => key.startsWith("VqsvBattleRuntime.")),
  );
  expect(shipped).toEqual(declared);
});
