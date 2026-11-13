// Build contract for the pack provenance guard: the record must cover every map the runtime
// loads and every catalog the harness dumps, the build must refuse to run without checking it,
// and data that is not yet covered has to stay declared instead of silently disappearing.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, ".."),
  javaRoot = "VQSV-WebNative/rebuild_game/src/main/java/vqsv",
  manifest = JSON.parse(readFileSync(resolve(root, "pack-provenance.json"), "utf8")),
  packManifest = JSON.parse(readFileSync(resolve(root, "public", "pack", "pack.json"), "utf8")),
  rooms = JSON.parse(
    readFileSync(resolve(root, "public", "pack", "world", "rooms.json"), "utf8"),
  ).rooms,
  scripts = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).scripts,
  mapIds = [...new Set(Object.values(rooms).map((room) => room.mapId))];

function bake(id) {
  const entry = manifest.bakes.find((candidate) => candidate.id === id);
  expect(entry, `${id} is missing from the provenance record`).toBeDefined();
  return entry;
}

function shippedGroups(directory, prefix = "") {
  const entries = readdirSync(directory, { withFileTypes: true });
  const groups = entries.some((entry) => entry.isFile()) && prefix ? [prefix] : [];
  for (const entry of entries)
    if (entry.isDirectory())
      groups.push(
        ...shippedGroups(
          resolve(directory, entry.name),
          prefix ? `${prefix}/${entry.name}` : entry.name,
        ),
      );
  return groups;
}

describe("pack provenance record", () => {
  it("hashes the Java bake pipeline that produced the shipped art", () => {
    expect(manifest.schema).toBe("vqsv-webnative-pack-provenance-v1");
    const java = bake("world-java-bake"),
      producers = java.inputFiles.filter((entry) => entry.path.endsWith(".java"));
    expect(producers.map((entry) => entry.path)).toContain(
      "VQSV-WebNative/rebuild_game/tools/ExportWorldWebAssets.java",
    );
    expect(producers.some((entry) => entry.path.endsWith("MapRenderer.java"))).toBe(true);
    expect(producers.some((entry) => entry.path.endsWith("SpriteAnimator.java"))).toBe(true);
  });

  it("records a baked group for every map the runtime loads", () => {
    const java = bake("world-java-bake").outputGroups,
      collision = bake("world-map-collision").outputGroups;
    expect(mapIds.length).toBeGreaterThan(0);
    for (const mapId of mapIds) {
      expect(Object.keys(java), `maps/${mapId} has no recorded Java bake`).toContain(
        `maps/${mapId}`,
      );
      expect(collision[`maps/${mapId}`].fileCount).toBe(1);
      expect(java[`maps/${mapId}`].fileCount).toBeGreaterThan(2);
    }
  });

  it("is exposed as an explicit oracle command, never as a build prerequisite", () => {
    expect(scripts["oracle:verify-pack"]).toContain("pack-provenance.mjs");
    expect(scripts.prebuild ?? "").not.toContain("pack-provenance");
    expect(scripts.predev ?? "").not.toContain("pack-provenance");
  });

  it("records the Java harness that dumped the game catalogs", () => {
    const data = bake("data-java-harness"),
      producers = data.inputFiles.filter((entry) => entry.path.endsWith(".java"));
    expect(data.packRoot).toBe("data");
    expect(producers.map((entry) => entry.path)).toContain(
      "VQSV-WebNative/rebuild_game/tools/ExportWebDataCatalogs.java",
    );
    expect(producers.some((entry) => entry.path.endsWith("UnifiedPetCatalog.java"))).toBe(true);
    expect(
      data.inputFiles.some((entry) => entry.path.includes("/vqsv/data/unified/rainbow-pets/")),
      "the pet tables the catalog reads are not hashed",
    ).toBe(true);
    const shipped = shippedGroups(resolve(root, "public", "pack", "data")).sort();
    expect(Object.keys(data.outputGroups).sort()).toEqual(shipped);
    expect(data.outputGroups.battle.fileCount).toBeGreaterThan(20);
    expect(data.outputGroups.flags.fileCount).toBeGreaterThan(0);
    expect(data.outputGroups.text.fileCount).toBeGreaterThan(20);
  });

  it("keeps the Java-tree decisions in the record, not only in the script", () => {
    const drift = manifest.treeDrift.map((entry) => entry.path);
    expect(drift).toContain(`${javaRoot}/battle/ai/v2/BattleAiUtilityEvaluator.java`);
    expect(
      manifest.treeDrift.find((entry) => entry.path.endsWith("BattleAiUtilityEvaluator.java")).note,
    ).toContain("the newer packaged evaluator is the enemy battle AI");
    // A declared difference is worthless unless a bake hashes that file, so the guard can see it.
    expect(
      bake("data-java-harness").inputFiles.map((entry) => entry.path),
      "the enemy AI sources are not part of the shipped dump's provenance",
    ).toContain(`${javaRoot}/battle/ai/v2/BattleAiUtilityEvaluator.java`);
  });

  it("lists every pack domain the bake does not prove", () => {
    const outside = [
      ...new Set(
        packManifest.domains
          .filter((domain) => domain.resolution !== "root")
          .flatMap((domain) =>
            [
              ...(domain.entries ?? []).map((entry) => entry.file),
              ...(domain.indexes ?? []).map((index) => index.file),
              domain.template,
            ]
              .filter(Boolean)
              .map((path) => `public/pack/${path.split("/")[0]}`),
          ),
      ),
    ].sort();
    expect(manifest.packDomainsOutsideBake).toEqual(outside);
    const proven = new Set(manifest.bakes.map((entry) => entry.packRoot));
    for (const domain of packManifest.domains.filter((entry) => entry.resolution === "root"))
      expect(proven.has(domain.root), `${domain.id} ships from a root but no bake claims it`).toBe(
        true,
      );
  });
});
