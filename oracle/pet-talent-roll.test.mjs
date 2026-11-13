// A thiên phú (physical trait) is rolled, never authored: Java draws it from `ThreadLocalRandom` at
// the moment a pet enters a fight or is created, and only the resulting id is persisted. The Web port
// cannot copy a draw it has no seed for, so it replays one from the pet's or the fight's identity with
// Java's own migration mixer. Every choice in `src/game/battle/PhysicalTraits.ts`,
// `engine/BattleServices.ts` and `world/WorldRuntime.ts` rests on six facts inside four Java files,
// and on one answer the exported pack carries. This guard re-reads them and refuses the port if any
// of them moves.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const repo = resolve(root, "..");
const java = (...parts) =>
  readFileSync(resolve(repo, "rebuild_game", "src", "main", "java", ...parts), "utf8");

const BATTLE_UNIT = java("vqsv", "battle", "model", "BattleUnit.java");
const ROLLER = java("vqsv", "pet", "data", "PetTraitRoller.java");
const CATALOG = java("vqsv", "pet", "data", "PetTraitCatalog.java");
const KIM_DIEM = java("vqsv", "pet", "data", "KimDiemLongVuongCatalog.java");
const SOURCE_ADAPTER = java("vqsv", "source", "PetSourceAdapter.java");
const MIGRATION = java("vqsv", "save", "PetSaveTraitMigration.java");

/** The slice of a source file one method occupies, from its signature to the closing brace at indent 4. */
function method(source, signature, indent = "    ") {
  const start = source.indexOf(signature);
  expect(start, `${signature} no longer exists`).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf(`\n${indent}}`, start));
}

/** The species the exported pack marks as fixed-stat Kim Diễm bosses. */
const kimDiemRows = JSON.parse(
  readFileSync(resolve(root, "public", "pack", "data", "battle", "species.json"), "utf8"),
).rows.filter((row) => row.statPath === "kimDiemBoss");

it("rolls an enemy's talent per battle and exempts only the fixed-stat boss", () => {
  const enemy = method(
    BATTLE_UNIT,
    "public static BattleUnit enemyFromEncounter(int[] encounter, int presetPhysicalTraitId, int sceneId)",
  );
  // The exemption comes before the draw: the boss keeps its authored stats and no talent at all.
  expect(enemy.indexOf("KimDiemLongVuongCatalog.isSpecies(species)")).toBeLessThan(
    enemy.indexOf("PetTraitRoller.instance().rollNew()"),
  );
  expect(enemy).toContain(
    "unit.physicalTraitId = PetTraitCatalog.instance().sanitizePhysicalTraitId(",
  );
  expect(enemy).toContain("unit.applyProductionPermanentTraitStats()");
  // A preset or the capture system property can force the id; only the ordinary path rolls.
  expect(enemy).toContain('System.getProperty("vqsv.capture.enemyPhysicalTrait")');
});

it("names the exempted boss as the species the pack marks kimDiemBoss", () => {
  expect(method(KIM_DIEM, "public static boolean isSpecies(int id)", "    ")).toContain(
    "return id == RUNTIME_ID;",
  );
  const id = KIM_DIEM.match(/public static final int RUNTIME_ID = (\d+);/)?.[1];
  expect(id).toBe("280");
  // The Web reads no Java constant, so its predicate is the exported `statPath`; the two must agree.
  expect(kimDiemRows.map((row) => row.speciesId)).toEqual([Number(id)]);
});

it("gives a created pet the neutral talent only for that boss", () => {
  const created = method(SOURCE_ADAPTER, "public static PetState create(int slot");
  expect(created).toContain("vqsv.pet.data.KimDiemLongVuongCatalog.isSpecies(speciesId)");
  expect(created).toMatch(
    /isSpecies\(speciesId\)\s*\?\s*0\s*:\s*PetTraitRoller\.instance\(\)\.rollNew\(\)/,
  );
});

it("draws the talent outside the battle's random stream", () => {
  expect(method(ROLLER, "public int rollNew()")).toContain(
    "return roll(ThreadLocalRandom.current().nextLong());",
  );
  // Nothing here may read the fight's own source random, which is why the port's roll takes no draw
  // from `BattleRandom` and cannot be graded against a recorded Java talent.
  expect(ROLLER).not.toContain("VqsvSourceRandom");
  expect(method(ROLLER, "public int roll(long entropy)")).toContain("Math.floorMod");
});

it("refuses a player pet that carries no talent", () => {
  expect(
    method(BATTLE_UNIT, "public static BattleUnit fromPet(BattlePetSnapshot pet, byte ownerSide)"),
  ).toContain("PetTraitRoller.instance().requireValid(pet.physicalTraitId)");
  expect(method(ROLLER, "public int requireValid(int physicalTraitId)")).toContain(
    "if (!valid(physicalTraitId))",
  );
});

it("sanitizes without looking at the species", () => {
  const allowed = method(
    CATALOG,
    "public boolean isPhysicalTraitAllowed(int physicalTraitId, int speciesId)",
  );
  // The port's `sanitizePhysicalTraitId` has no species argument; it is only equivalent while the
  // method body ignores the parameter it is handed.
  expect(allowed.slice(allowed.indexOf("{"))).not.toContain("speciesId");
  expect(allowed).toContain("definition.rollWeight > 0");
});

it("mixes the migrated draw the way the port's replay does", () => {
  const entropy = method(MIGRATION, "private static long legacyEntropy(");
  expect(MIGRATION).toContain("private static final long FNV_OFFSET = 0xcbf29ce484222325L;");
  expect(MIGRATION).toContain("private static final long FNV_PRIME = 0x100000001b3L;");
  expect(MIGRATION.match(/MIXER_VERSION = "([^"]+)"/)?.[1]).toBe("pet-trait-old-save-roll-v1");
  for (const field of [
    "MIXER_VERSION",
    "PetTraitProfileVersion.UNIFIED_PET_TRAITS_V1.token()",
    "containerKind.name()",
    "ordinal",
    "pet.slot",
    "pet.speciesId",
    "pet.level",
    "pet.quality",
    "pet.nature",
  ])
    expect(entropy, `legacyEntropy no longer mixes ${field}`).toContain(`mix(hash, ${field})`);
  expect(entropy).toContain("hash *= 0xbf58476d1ce4e5b9L;");
  expect(entropy).toContain("hash *= 0x94d049bb133111ebL;");

  // The port copies the mixer, never Java's salt: Java's salt means "this save predates the split and
  // is being migrated once", while the port uses the same mixer to re-derive any missing talent.
  const port = readFileSync(resolve(root, "src", "game", "battle", "PhysicalTraits.ts"), "utf8");
  expect(port).toContain('const TRAIT_ROLL_SALT = "pet-trait-deterministic-roll-v1";');
  expect(port).toContain("0xcbf29ce484222325n");
  expect(port).toContain("0x100000001b3n");
  expect(port).toContain("0xbf58476d1ce4e5b9n");
  expect(port).toContain("0x94d049bb133111ebn");
});
