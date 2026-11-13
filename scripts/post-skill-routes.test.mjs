// The chance the runtime gates a post-skill leech with is a literal inside a private method of
// VqsvBattleRuntime, and the skill ids it gates are named in the expression that calls it. Neither
// number may be restated in TypeScript, so the exporter harvests both into the route row that
// consumes them. This guard re-reads the Java source and refuses the shipped dump if either the gated
// ids or the chance moves, so a Java edit cannot leave the pack quietly asserting the old number.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const repo = resolve(root, "..");

/** The runtime that owns the gate. */
const RUNTIME_SOURCE = resolve(
  repo,
  "rebuild_game",
  "src",
  "main",
  "java",
  "vqsv",
  "game",
  "VqsvBattleRuntime.java",
);
/** The dump the exporter wrote those two answers into. */
const MECHANICS = resolve(root, "public", "pack", "data", "battle", "status-mechanics.json");

/**
 * The `p7SkillId == <n>` tests in the one expression that decides whether a roll is drawn at all.
 * Java writes it across two lines, so the search runs on the whole call, not on one line.
 */
function gatedSkillIds(runtime) {
  const call = runtime.match(
    /boolean leechRollPassed = ([^;]*?)&&\s*sourceP7LeechRollPassed\(s\);/,
  );
  expect(
    call,
    "the runtime no longer gates the post-skill leech with sourceP7LeechRollPassed",
  ).not.toBeUndefined();
  return [...call[1].matchAll(/p7SkillId == (-?\d+)/g)].map((match) => Number(match[1]));
}

/** The literal chance `passesInclusiveRoll` is called with inside that private method. */
function gateChance(runtime) {
  const start = runtime.indexOf("private boolean sourceP7LeechRollPassed(");
  expect(start, "sourceP7LeechRollPassed no longer exists in the runtime").toBeGreaterThan(-1);
  const body = runtime.slice(start, runtime.indexOf("\n    }", start));
  const roll = body.match(/passesInclusiveRoll\(\s*\w+\s*,\s*(\d+)\s*\)/);
  expect(
    roll,
    "the leech gate no longer passes an inclusive roll against a literal chance",
  ).not.toBeUndefined();
  return Number(roll[1]);
}

describe("post-skill route leech gate", () => {
  const runtime = readFileSync(RUNTIME_SOURCE, "utf8");
  const gated = gatedSkillIds(runtime);
  const chance = gateChance(runtime);
  const routes = JSON.parse(readFileSync(MECHANICS, "utf8")).postSkillRoutes;

  it("harvests every gate the runtime draws and nothing it does not", () => {
    expect(
      gated.length,
      "the runtime gates no skill at all, so the dump must carry zero",
    ).toBeGreaterThan(0);
    expect(new Set(gated).size, "a skill is gated twice").toBe(gated.length);
    const shipped = routes.filter((row) => row.leechGateChance > 0).map((row) => row.skillId);
    expect(shipped.sort((a, b) => a - b)).toEqual(gated.sort((a, b) => a - b));
    for (const row of routes.filter((row) => gated.includes(row.skillId)))
      expect(
        row.leechGateChance,
        `skill ${row.skillId} gates the leech with the wrong chance`,
      ).toBe(chance);
  });

  it("gates only a route the engine actually heals on", () => {
    // A roll the runtime draws for a route that cannot heal would spend a draw the Web never asks
    // for, so the two owners have to agree on which ids can leech at all.
    for (const row of routes)
      expect(
        row.leechGateChance > 0,
        `skill ${row.skillId} carries a leech roll but routes as ${row.mode}`,
      ).toBe(row.mode === "LEECH_AND_BUFF");
  });
});
