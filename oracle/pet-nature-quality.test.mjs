// `quality` and `nature` are two separate axes of one pet in the Java engine, and only nature is what
// the player sees as shiny. Java seats both onto the battle snapshot, indexes its catch chance and its
// EXP award with nature alone, and bends hp, attack and speed for nature 7, 8 and 9 only. The Web port
// once carried quality in the field named nature, which quietly moved both formulas; this guard keeps
// the two axes apart by re-reading the six places in Java that name them.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const repo = resolve(root, "..");
const java = (...parts) =>
  readFileSync(resolve(repo, "rebuild_game", "src", "main", "java", ...parts), "utf8");

const BATTLE_UNIT = java("vqsv", "battle", "model", "BattleUnit.java");
const SNAPSHOT = java("vqsv", "battle", "model", "BattlePetSnapshot.java");
const OUTCOME = java("vqsv", "battle", "BattleOutcomeEngine.java");
const ENCOUNTER = java("vqsv", "world", "WorldEncounterEngine.java");
const SERVICES = resolve(root, "src", "game", "battle", "engine");
const TYPES = readFileSync(resolve(SERVICES, "BattleTypes.ts"), "utf8");
const SEATING = readFileSync(resolve(SERVICES, "BattleServices.ts"), "utf8");
const STATS = readFileSync(resolve(root, "src", "game", "battle", "PetStatCalculator.ts"), "utf8");

/** The slice of a source file one method occupies, from its signature to the closing brace at indent 4. */
function method(source, signature, indent = "    ") {
  const start = source.indexOf(signature);
  expect(start, `${signature} no longer exists`).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf(`\n${indent}}`, start));
}

it("keeps quality and nature as two fields of one snapshot", () => {
  expect(SNAPSHOT).toContain("public final short quality;");
  expect(SNAPSHOT).toContain("public final byte nature;");
});

it("reads an encounter's nature from the record, and 3 when the record is too short", () => {
  const enemy = method(
    BATTLE_UNIT,
    "public static BattleUnit enemyFromEncounter(int[] encounter, int presetPhysicalTraitId, int sceneId)",
  );
  expect(enemy).toContain("int nature = encounter.length > 2 ? encounter[2] : 3;");
  // The quality axis keeps its own sentinel, so a record without one is not a quality of 0.
  expect(enemy).toContain("encounter.length > 3 ? encounter[3] : -1");
});

it("seats an owned pet with the nature its save recorded", () => {
  const fromPet = method(BATTLE_UNIT, "public static BattleUnit fromPet(BattlePetSnapshot pet");
  expect(fromPet).toContain("pet.quality, pet.nature");
});

it("bends only hp, attack and speed, and only for nature 7, 8 and 9", () => {
  const apply = method(BATTLE_UNIT, "private static void applyNatureType(int[] stats, byte type)");
  expect(apply).toContain("case 7:");
  expect(apply).toContain("case 8:");
  expect(apply).toContain("case 9:");
  // 90/130 on attack, 80/130 on hp, plus 7 or minus 2 on speed, and no defense write at all.
  expect(apply.match(/stats\[1\] = toShort\(stats\[1\] \* \d+ \/ 100\)/g)).toHaveLength(3);
  expect(apply.match(/stats\[0\] = toShort\(stats\[0\] \* \d+ \/ 100\)/g)).toHaveLength(3);
  expect(apply).not.toContain("stats[2] =");
  expect(apply).toContain("stats[3] + 7");
  expect(apply.match(/stats\[3\] - 2/g)).toHaveLength(2);
});

it("applies that curve when the unit is built, on level up and on an evolution floor", () => {
  expect(BATTLE_UNIT).toContain("unit.applyNatureType(natureType);");
  const refresh = method(BATTLE_UNIT, "private void refreshBaseStatsForCurrentLevel()");
  expect(refresh).toContain("applyNatureType(natureType);");
  expect(BATTLE_UNIT).toContain("applyNatureType(ancestorStats, natureType);");
});

it("indexes catch chance and EXP with nature, never with quality", () => {
  const catchChance = method(OUTCOME, "public int calculateCatchChance(CatchInput input)");
  expect(catchChance).toContain("input.enemyNature - 1");
  const exp = method(OUTCOME, "public int expAward(ExpAwardInput input)");
  expect(exp).toContain("Math.max(1, Math.min(5, input.enemyNature))");
});

it("seats both axes in the port, so nothing copies one into the other", () => {
  expect(TYPES).toContain("quality: number;");
  expect(TYPES).toContain("nature: number;");
  expect(TYPES).toContain("export const ENCOUNTER_NATURE_FALLBACK = 3;");
  // The conflation this slice removed: quality written into the nature seat.
  expect(SEATING).not.toMatch(/nature:\s*(pet\.)?quality/);
  expect(SEATING).toMatch(/nature:\s*pet\.nature \?\? 0/);
});

// The shiny roll itself lives in the free-world encounter engine, which has no Web counterpart yet:
// every Web fight comes from a scripted encounter record. These two checks pin Java's own numbers so
// the port cannot quietly invent a different chance, and say out loud where the roll is still missing.
it("rolls the shiny nature in the wild only, at 2 percent over 7 to 9", () => {
  const resolve = method(ENCOUNTER, "private int resolveWildNature(int minNature, int maxNature)");
  expect(ENCOUNTER).toContain("private static final int CUSTOM_NATURE_CHANCE_PERCENT = 2;");
  expect(ENCOUNTER).toContain("private static final int CUSTOM_NATURE_MIN = 7;");
  expect(ENCOUNTER).toContain("private static final int CUSTOM_NATURE_MAX = 9;");
  expect(resolve).toContain('"world.encounter.customNatureChance", 100');
  expect(resolve).toContain("rareRoll < CUSTOM_NATURE_CHANCE_PERCENT");
  expect(resolve).toContain('"world.encounter.customNature", CUSTOM_NATURE_MIN, CUSTOM_NATURE_MAX');
  expect(resolve).toContain('"world.encounter.nature", minNature, maxNature');
  // A record that authored no range opts out of the roll entirely rather than rolling over nothing.
  expect(resolve).toMatch(/if \(minNature == -1\) \{\s*return -1;/);
});

it("bends the port's growth stats with the same three cases Java's switch has", () => {
  const apply = STATS.slice(STATS.indexOf("function applyNatureType"));
  expect(apply).toContain("case 7:");
  expect(apply).toContain("case 8:");
  expect(apply).toContain("case 9:");
  expect(apply.match(/attack: percent\(stats\.attack, (90|130)\)/g)).toHaveLength(3);
  expect(apply.match(/hp: percent\(stats\.hp, (80|130)\)/g)).toHaveLength(3);
  expect(apply).toContain("speed: toShort(stats.speed + 7)");
  expect(apply.match(/speed: toShort\(stats\.speed - 2\)/g)).toHaveLength(2);
  // Defense is the one stat Java's switch never writes, so the port passes it through three times.
  expect(apply.match(/defense: stats\.defense/g)).toHaveLength(3);
  // And the seat asks for the bend: a stats call that knows a nature has to hand it over.
  expect(SEATING).toMatch(
    /coreStats\(pet\.speciesId, pet\.level, pet\.quality, pet\.nature \?\? 0\)/,
  );
  expect(SEATING).toMatch(/coreStats\(speciesId, level, quality, nature\)/);
});
