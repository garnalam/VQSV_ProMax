// The enemy decision catalog is authored in nine TSVs the Web must not read directly, and the
// numbers that turn those rows into a choice — the intelligence-profile weights, the bias names, the
// row counts the loader refuses to load without — live in Java the browser cannot reach. The harness
// dumps the catalog the way the decision path resolves it. This guard re-reads the same Java sources
// and refuses the shipped bytes if any of them moves, so a later engine edit cannot silently
// re-scope what the ported AI is graded against.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const repo = resolve(root, "..");
const java = (...parts) => resolve(repo, "rebuild_game", "src", "main", "java", ...parts);

/** The immutable encounter catalog the runtime loads the nine TSVs through. */
const CATALOG_SOURCE = readFileSync(
  java("vqsv", "battle", "ai", "BattleAiEncounterCatalog.java"),
  "utf8",
);
/** The persona/phase policy catalog that owns the biases the utility pass reads. */
const BIAS_SOURCE = readFileSync(
  java("vqsv", "battle", "ai", "v2", "BattleAiPolicyBias.java"),
  "utf8",
);
/** The class that holds the per-profile weights as literals inside one switch. */
const WEIGHTS_SOURCE = readFileSync(
  java("vqsv", "battle", "ai", "v2", "BattleAiUtilityWeights.java"),
  "utf8",
);
/** The shipped dump. */
const AI = JSON.parse(
  readFileSync(resolve(root, "public", "pack", "data", "battle", "ai-v2-catalog.json"), "utf8"),
);

/** One `public static final int NAME = 12;` the loader validates its tables against. */
function catalogConstant(name) {
  const found = CATALOG_SOURCE.match(new RegExp(`public static final int ${name} = (\\d+);`));
  expect(found, `BattleAiEncounterCatalog.${name} no longer declares a literal count`).not.toBe(
    null,
  );
  return Number(found[1]);
}

/** The enum constant names declared in a source file, in the order the file lists them. */
function enumNames(source, enumName) {
  const start = source.indexOf(`public enum ${enumName} {`);
  expect(start, `${enumName} is no longer declared in ${source.slice(0, 40)}`).toBeGreaterThan(-1);
  return source
    .slice(start, source.indexOf("\n    }", start))
    .replace(/public enum [\w]+ \{/, "")
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && /^[A-Z][A-Z0-9_]*$/.test(part));
}

/** The nine weights `BattleAiUtilityWeights.forProfile` returns for each profile it supports. */
function sourceWeights() {
  const byProfile = new Map();
  const pattern = /case\s+([A-Z_]+):\s*return new BattleAiUtilityWeights\(\s*([\d,\s-]+)\)/g;
  for (const found of WEIGHTS_SOURCE.matchAll(pattern)) {
    byProfile.set(
      found[1],
      found[2]
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((value) => Number.isFinite(value)),
    );
  }
  return byProfile;
}

const WEIGHT_FIELDS = [
  "immediatePercent",
  "survivalPercent",
  "setupPercent",
  "tempoPercent",
  "resourcePercent",
  "futurePercent",
  "riskPercent",
  "repetitionPercent",
  "switchMargin",
];

it("ships the catalog the loader counts refuse to accept otherwise", () => {
  expect(AI.profileVersion).toBe("unified-battle-ai-v2");
  expect(AI.bundleSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(AI.counts).toEqual({
    encounters: catalogConstant("ENCOUNTER_COUNT"),
    members: catalogConstant("MEMBER_COUNT"),
    items: catalogConstant("ITEM_COUNT"),
    phases: catalogConstant("PHASE_COUNT"),
    activationReviewed: catalogConstant("ACTIVATION_REVIEW_COUNT"),
  });
  const members = AI.encounters.reduce((sum, row) => sum + row.members.length, 0);
  const items = AI.encounters.reduce((sum, row) => sum + row.items.length, 0);
  const phases = AI.encounters.reduce((sum, row) => sum + row.phases.length, 0);
  const reviewed = AI.encounters.filter((row) => row.activationReview).length;
  expect([AI.encounters.length, members, items, phases, reviewed]).toEqual([
    AI.counts.encounters,
    AI.counts.members,
    AI.counts.items,
    AI.counts.phases,
    AI.counts.activationReviewed,
  ]);
});

it("ships every weight the profile switch returns, and no profile the switch lacks", () => {
  const fromSource = sourceWeights();
  expect(Object.keys(AI.profileWeights).sort()).toEqual(
    enumNames(CATALOG_SOURCE, "IntelligenceProfile").sort(),
  );
  for (const [profile, values] of fromSource) {
    expect(values, `${profile} weights are no longer nine numbers`).toHaveLength(9);
    const shipped = AI.profileWeights[profile];
    expect(Object.fromEntries(WEIGHT_FIELDS.map((f, i) => [f, shipped[f]])), profile).toEqual(
      Object.fromEntries(WEIGHT_FIELDS.map((field, index) => [field, values[index]])),
    );
  }
});

it("resolves every encounter to one commissioned persona projection with authored biases", () => {
  const biases = new Set(
    enumNames(BIAS_SOURCE, "BattleAiPolicyBias").map((name) => `BattleAiPolicyBias.${name}`),
  );
  for (const row of AI.encounters) {
    const projection = row.projections.NONE;
    expect(projection, `${row.encounter.encounterKey} has no persona projection`).toBeTruthy();
    expect(projection.commissioned, `${row.encounter.encounterKey} is not commissioned`).toBe(true);
    expect(projection.personaKey).toBe(row.encounter.personaKey);
    for (const bias of projection.biases)
      expect(biases, `${row.encounter.encounterKey} biases ${bias}`).toContain(bias);
    expect(Object.keys(projection.modifiers)).toHaveLength(9);
    // A phase policy only exists where the encounter is allowed to use one.
    for (const phase of row.phases) {
      expect(
        row.projections[phase.phaseKey],
        `${row.encounter.encounterKey} phase ${phase.phaseKey} has no policy`,
      ).toBeTruthy();
    }
    if (!row.encounter.mayUsePhasePolicy)
      expect(row.phases, `${row.encounter.encounterKey} gates phases it cannot use}`).toEqual([]);
  }
});

it("ships a canary review for exactly the Leader and Boss encounters", () => {
  const leaderBoss = [
    "EncounterClass.GYM_LEADER",
    "EncounterClass.STORY_BOSS",
    "EncounterClass.QUEST_BOSS_CAPTURE",
  ];
  for (const row of AI.encounters) {
    const isLeaderBoss = leaderBoss.includes(row.encounter.encounterClass);
    expect(row.activationReview !== null, row.encounter.encounterKey).toBe(isLeaderBoss);
    if (!row.activationReview) continue;
    expect(row.activationReview.activationStatus).toBe("ActivationStatus.CERTIFIED_FOR_CANARY");
    expect(row.activationReview.informationBoundary).toBe(
      "InformationBoundary.PUBLIC_STATE_NO_HIDDEN_BONUS",
    );
    expect(row.activationReview.phaseRequired).toBe(true);
    expect(row.activationReview.counterplayPlanCount).toBe(3);
    expect(row.encounter.mayUsePhasePolicy).toBe(true);
    expect(row.phases.length).toBeGreaterThan(0);
  }
});

it("locks each encounter to the runtime descriptor the battle request resolves", () => {
  const byLocator = new Map();
  for (const row of AI.encounters) {
    const lock = row.sourceLock;
    expect(lock, `${row.encounter.encounterKey} has no source lock`).toBeTruthy();
    expect(lock.sourceRosterSha256).toMatch(/^[0-9a-f]{64}$/);
    const locator = `${lock.sceneId}:${lock.roomIndex}:${lock.groupIndex}:${lock.sourceActorId}:${lock.sourceRoster}`;
    expect(byLocator.has(locator), `duplicate source lock ${locator}`).toBe(false);
    byLocator.set(locator, row.encounter.encounterKey);
  }
  // The two Scene 1 fights the Web runtime plays today, checked the way the descriptor lookup does.
  expect(byLocator.get("1:1:0:-1:34,5,1")).toBe("LH-ENC-S01-R01-G00-B01-BUNNY");
});
