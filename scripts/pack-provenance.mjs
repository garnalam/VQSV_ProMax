// Pack provenance guard.
//
// The world pack is not produced by TypeScript: map layers come from Java MapRenderer and
// sprite frames from Java SpriteAnimator. Every baked PNG is therefore only as fresh as the last
// Java run, and nothing in the build said so. This script records which Java sources and which
// source-data files produced which bytes, then refuses the build when either side drifts.
//
//   npm run oracle:verify-pack    verify against the Java source pack (needs ../rebuild_game)
//   npm run oracle:record-pack    re-record after a Java bake
//
// This is an oracle tool. The web build and tests never call it: the shipped pack is committed
// and self-contained, so web-native builds and runs without any Java tree present.
import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";

const webNativeRoot = process.cwd(),
  repoRoot = resolve(webNativeRoot, "..", ".."),
  javaRoot = "VQSV-WebNative/rebuild_game/src/main/java/vqsv",
  resourceRoot = "VQSV-WebNative/rebuild_game/src/main/resources",
  packRoot = "VQSV-WebNative/web-native/public/pack",
  worldRel = `${packRoot}/world`,
  dataRel = `${packRoot}/data`,
  ridesRel = `${packRoot}/ride-sprites`,
  packManifestRel = `${packRoot}/pack.json`,
  manifestRel = "VQSV-WebNative/web-native/pack-provenance.json",
  manifestFile = resolve(webNativeRoot, "pack-provenance.json"),
  packManifestFile = resolve(webNativeRoot, "public", "pack", "pack.json"),
  schema = "vqsv-webnative-pack-provenance-v1",
  harnessSource = "VQSV-WebNative/rebuild_game/tools/ExportWebDataCatalogs.java",
  probeSource = "VQSV-WebNative/rebuild_game/tools/ProbeWebBattleMath.java",
  classesDir = resolve(repoRoot, "VQSV-WebNative", "rebuild_game", "build", "classes"),
  recording = process.argv.includes("--record");

// The whole bake pipeline: the render and resource packages, the exporter, the room geometry
// it reads and the config that resolves the modules root.
const javaProducers = [
  `${javaRoot}/render/**/*.java`,
  `${javaRoot}/resource/**/*.java`,
  "VQSV-WebNative/rebuild_game/tools/ExportWorldWebAssets.java",
  // Every room catalog WorldRoomCatalog.room dispatches to (Liệt Hỏa, Cầu Vồng, the plaza).
  `${javaRoot}/world/**/*.java`,
  `${javaRoot}/core/**/*.java`,
];

// Sprite frames read the spr bank plus the image bank its record indexes, with bundled
// resources as fallback; tile pixels come from the mod binaries the tileset is built from.
const dataProducers = [
  "modules/spr/original/**",
  "modules/img/original/**",
  "modules/mod/original/**",
  "modules/script/original/sprite.mid",
  `${resourceRoot}/img/**`,
  `${resourceRoot}/tex/**`,
  `${resourceRoot}/font.bin`,
  // Cầu Vồng maps 201..268 are the jar's background/foreground images.
  `${resourceRoot}/vqsv/data/cau-vong/**`,
];

const bakes = [
  {
    id: "world-java-bake",
    producer: "vqsv.game.ExportWorldWebAssets",
    root: worldRel,
    packRoot: "world",
    java: javaProducers,
    data: dataProducers,
    owns: (rel) => !rel.endsWith("/collision.json"),
  },
  {
    id: "world-map-collision",
    producer: "scripts/export-map-collision.mjs",
    root: worldRel,
    packRoot: "world",
    java: [],
    data: ["VQSV-WebNative/web-native/scripts/export-map-collision.mjs"],
    owns: (rel) => rel.endsWith("/collision.json"),
  },
  {
    id: "data-java-harness",
    producer: "vqsv.game.ExportWebDataCatalogs",
    root: dataRel,
    packRoot: "data",
    java: [
      "VQSV-WebNative/rebuild_game/tools/ExportWebDataCatalogs.java",
      "VQSV-WebNative/rebuild_game/tools/ProbeWebBattleMath.java",
      // The enemy decision policy is shipped data, so its sources are compared between trees too.
      `${javaRoot}/battle/ai/**/*.java`,
      // The golden referee tables pin battle math, so every engine source that feeds them is
      // cross-tree compared: a decision that only exists in one tree would silently re-scope
      // what the shipped goldens prove.
      `${javaRoot}/battle/**/*.java`,
      `${javaRoot}/pet/**/*.java`,
      `${javaRoot}/status/**/*.java`,
      `${javaRoot}/integrity/**/*.java`,
    ],
    // Every game table and every engine source the harness can reach: a change to either makes
    // the shipped dump stale, which is the failure this guard exists to catch.
    data: [`${javaRoot}/**/*.java`, `${resourceRoot}/vqsv/data/**`],
    owns: () => true,
  },
  {
    id: "ride-sprites-java-bake",
    producer: "vqsv.game.ExportWebRideSprites",
    root: ridesRel,
    packRoot: "ride-sprites",
    java: [
      "VQSV-WebNative/rebuild_game/tools/ExportWebRideSprites.java",
      `${javaRoot}/render/**/*.java`,
      `${javaRoot}/resource/**/*.java`,
      `${javaRoot}/world/**/*.java`,
    ],
    data: [
      "modules/spr/original/**",
      "modules/img/original/**",
      `${resourceRoot}/vqsv/data/cau-vong/**`,
    ],
    owns: () => true,
  },
];

// The repo ships two Java trees: the live one at the top level and the packaged copy under
// VQSV-WebNative. The bake can only run from the packaged copy because that MapRenderer adds
// renderDenseLayerFull/renderSparseLayerFull, which the live tree lacks. Every other
// bake-pipeline file must agree between the trees, and a new disagreement fails the build so
// it gets resolved per subsystem instead of quietly changing what the next bake emits.
const declaredTreeDrift = [
  {
    path: `${javaRoot}/render/MapRenderer.java`,
    note: "packaged copy adds renderDenseLayerFull/renderSparseLayerFull, required by the bake",
  },
  {
    path: `${javaRoot}/battle/ai/v2/BattleAiUtilityEvaluator.java`,
    note: "packaged copy scores pet_design_signature; decided 2026-11-01 that the newer packaged evaluator is the enemy battle AI the Web port follows",
  },
];

// The bake only proves provenance for what a producer writes into the pack. Every other pack
// domain is listed here so a shipped resource can never end up undocumented by accident; the
// list is derived from pack.json, so adding a domain without a producer shows up in the build.
function domainsOutsideBake(packManifest) {
  const outside = new Set();
  for (const domain of packManifest.domains) {
    if (domain.resolution === "root") continue;
    const paths = [
      ...(domain.entries ?? []).map((entry) => entry.file),
      ...(domain.indexes ?? []).map((index) => index.file),
      domain.template,
    ].filter(Boolean);
    for (const path of paths) outside.add(`public/pack/${path.split("/")[0]}`);
  }
  return [...outside].sort();
}

async function readPackManifest() {
  if (!existsSync(packManifestFile))
    throw new Error(`missing ${packManifestRel}: the pack has no manifest`);
  const manifest = JSON.parse(await readFile(packManifestFile, "utf8"));
  if (manifest.schema !== "vqsv-webnative-pack-v1")
    throw new Error(`${packManifestRel} schema is ${JSON.stringify(manifest.schema)}`);
  return manifest;
}

let packDomainsOutsideBake = [];

const reBakeHint = [
  "Re-bake and re-record with:",
  `  powershell -ExecutionPolicy Bypass -File "${resolve(repoRoot, "VQSV-WebNative", "rebuild_game", "build.ps1")}"`,
  `  javac -encoding UTF-8 -cp "${classesDir}" -d "${resolve(webNativeRoot, "build", "java-tools")}" "${resolve(repoRoot, "VQSV-WebNative", "rebuild_game", "tools", "ExportWorldWebAssets.java")}"`,
  `  (cd "${resolve(repoRoot, "VQSV-WebNative", "rebuild_game")}") java -cp "${classesDir};${resolve(webNativeRoot, "build", "java-tools")};${resolve(repoRoot, resourceRoot)}" vqsv.game.ExportWorldWebAssets "${resolve(webNativeRoot, "public", "pack", "world")}"`,
  "  npm run export:map-collision",
  // The probe reuses the exporter's JSON encoder, so the two tools compile in one javac call.
  `  javac -encoding UTF-8 -cp "${classesDir}" -d "${resolve(webNativeRoot, "build", "java-tools")}" "${resolve(repoRoot, harnessSource)}" "${resolve(repoRoot, probeSource)}"`,
  `  java -Dvqsv.modules="${resolve(repoRoot, "modules")}" -cp "${resolve(webNativeRoot, "build", "java-tools")};${classesDir}" vqsv.game.ExportWebDataCatalogs "${resolve(webNativeRoot, "public", "pack", "data")}"`,
  `  java -Dvqsv.modules="${resolve(repoRoot, "modules")}" -cp "${resolve(webNativeRoot, "build", "java-tools")};${classesDir}" vqsv.game.ProbeWebBattleMath "${resolve(webNativeRoot, "public", "pack", "data", "battle")}"`,
  "  npm run pack:record",
].join("\n");

function toPosix(absolute) {
  return absolute.split(sep).join("/");
}

async function sha256(file) {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

async function walk(absRoot) {
  const found = [];
  async function into(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) await into(full);
      else if (entry.isFile()) found.push(toPosix(full).slice(toPosix(absRoot).length + 1));
    }
  }
  await into(absRoot);
  return found.sort();
}

// A pattern is an exact file, a `dir/**` tree, a `dir/**/*.ext` tree, or a wildcard in the
// last segment. Matching nothing throws: a silently empty scope would report a guard that is
// actually a hole.
async function expand(pattern) {
  const abs = resolve(repoRoot, pattern);
  const deep = pattern.indexOf("/**/");
  if (deep >= 0) {
    const dirRel = pattern.slice(0, deep),
      rest = pattern.slice(deep + 4),
      name = rest.startsWith("**/") ? rest.slice(3) : rest,
      dir = resolve(repoRoot, dirRel),
      matches = name.startsWith("*") ? (rel) => rel.endsWith(name.slice(1)) : (rel) => rel === name;
    if (!existsSync(dir)) throw new Error(`provenance pattern has no directory: ${pattern}`);
    const hits = (await walk(dir)).filter(matches).map((rel) => `${dirRel}/${rel}`);
    if (hits.length === 0) throw new Error(`provenance pattern matches nothing: ${pattern}`);
    return hits;
  }
  if (pattern.endsWith("/**")) {
    const dir = abs.slice(0, -3);
    if (!existsSync(dir)) throw new Error(`provenance pattern has no directory: ${pattern}`);
    return (await walk(dir)).map((rel) => `${pattern.slice(0, -2)}${rel}`);
  }
  if (existsSync(abs) && (await stat(abs)).isFile()) return [pattern];
  if (!pattern.includes("*")) throw new Error(`provenance pattern matches nothing: ${pattern}`);
  const dir = pattern.slice(0, pattern.lastIndexOf("/")),
    prefix = pattern.slice(dir.length + 1, pattern.lastIndexOf("*"));
  if (!existsSync(resolve(repoRoot, dir)))
    throw new Error(`provenance pattern has no directory: ${pattern}`);
  const hits = (await readdir(resolve(repoRoot, dir)))
    .filter((name) => name.startsWith(prefix))
    .map((name) => `${dir}/${name}`);
  if (hits.length === 0) throw new Error(`provenance pattern matches nothing: ${pattern}`);
  return hits.sort();
}

async function inputHashes(patterns) {
  const paths = new Set();
  for (const pattern of patterns) for (const rel of await expand(pattern)) paths.add(rel);
  const entries = [];
  for (const path of [...paths].sort())
    entries.push({ path, sha256: await sha256(resolve(repoRoot, path)) });
  return entries;
}

// Files deeper than one directory are keyed by their nearest meaningful parent so a report
// names `maps/20` or `sprites/85` instead of one opaque digest.
function groupOf(relative) {
  const parts = relative.split("/");
  if (parts.length === 1) return parts[0];
  if (parts[0] === "maps" || parts[0] === "sprites") return `${parts[0]}/${parts[1]}`;
  return parts.slice(0, -1).join("/");
}

async function outputGroups(root, include) {
  const absRoot = resolve(repoRoot, root);
  if (!existsSync(absRoot)) throw new Error(`missing baked directory: ${root}`);
  const groups = new Map();
  for (const rel of await walk(absRoot)) {
    if (!include(rel)) continue;
    const group = groupOf(rel);
    const current = groups.get(group) ?? { lines: [], files: [], bytes: 0 };
    const abs = resolve(absRoot, rel);
    current.lines.push(`${rel} ${await sha256(abs)}`);
    current.files.push(rel);
    current.bytes += (await stat(abs)).size;
    groups.set(group, current);
  }
  const index = new Map(),
    out = {};
  for (const [group, { lines, files, bytes }] of [...groups].sort()) {
    out[group] = {
      fileCount: files.length,
      bytes,
      fingerprint: createHash("sha256").update(lines.sort().join("\n")).digest("hex"),
    };
    index.set(group, files);
  }
  return { groups: out, files: index };
}

async function readRooms() {
  const file = resolve(webNativeRoot, "public", "pack", "world", "rooms.json");
  return JSON.parse(await readFile(file, "utf8")).rooms;
}

function mapIdPatterns(mapIds) {
  return mapIds.map((id) => `modules/map/original/map_${id}.mid`);
}

// A baked map is only usable when meta.json, every layer it declares and its collision grid
// are present; rooms.json is the contract the runtime actually loads.
async function coverageProblems(rooms, files) {
  const problems = [];
  for (const [key, room] of Object.entries(rooms)) {
    const prefix = `maps/${room.mapId}`;
    const baked = files.get(prefix);
    if (!baked) {
      problems.push(`room ${key} loads map ${room.mapId} but ${prefix} was never baked`);
      continue;
    }
    const have = new Set(baked);
    for (const required of ["meta.json", "collision.json"])
      if (!have.has(`${prefix}/${required}`)) problems.push(`${prefix} has no ${required}`);
    if (!have.has(`${prefix}/meta.json`)) continue;
    const meta = JSON.parse(
      await readFile(resolve(repoRoot, worldRel, prefix, "meta.json"), "utf8"),
    );
    for (let layer = 0; layer < meta.layers; layer++)
      if (!have.has(`${prefix}/layer-${layer}.png`))
        problems.push(`${prefix} is missing layer-${layer}.png`);
  }
  return problems;
}

function serialize(manifest) {
  const bakeLines = manifest.bakes.map((bake, index) => {
    const inputs = bake.inputFiles
      .map(
        ({ path, sha256 }) =>
          `        { "path": ${JSON.stringify(path)}, "sha256": ${JSON.stringify(sha256)} },`,
      )
      .join("\n");
    return [
      "    {",
      `      "id": ${JSON.stringify(bake.id)},`,
      `      "producer": ${JSON.stringify(bake.producer)},`,
      `      "packRoot": ${JSON.stringify(bake.packRoot)},`,
      '      "inputFiles": [',
      inputs.replace(/,$/, ""),
      "      ],",
      '      "outputGroups": {',
      Object.entries(bake.outputGroups)
        .map(
          ([group, { fileCount, bytes, fingerprint }], groupIndex, list) =>
            `        ${JSON.stringify(group)}: { "fileCount": ${fileCount}, "bytes": ${bytes}, "fingerprint": ${JSON.stringify(fingerprint)} }${groupIndex + 1 < list.length ? "," : ""}`,
        )
        .join("\n"),
      "      }",
      "    }" + (index + 1 < manifest.bakes.length ? "," : ""),
    ].join("\n");
  });
  return [
    "{",
    `  "schema": ${JSON.stringify(manifest.schema)},`,
    `  "recordedBy": ${JSON.stringify(manifest.recordedBy)},`,
    `  "packDomainsOutsideBake": ${JSON.stringify(manifest.packDomainsOutsideBake)},`,
    `  "treeDrift": ${JSON.stringify(manifest.treeDrift)},`,
    '  "bakes": [',
    bakeLines.join("\n"),
    "  ]",
    "}",
    "",
  ].join("\n");
}

async function readManifest(optional) {
  if (!existsSync(manifestFile)) {
    if (optional) return undefined;
    throw new Error(
      `no ${manifestRel}: baked art has no recorded provenance. Run the Java bake, then npm run pack:record.`,
    );
  }
  const text = await readFile(manifestFile, "utf8");
  try {
    return JSON.parse(text);
  } catch {
    if (optional) return undefined;
    throw new Error(`${manifestRel} is not valid JSON; regenerate it with npm run pack:record.`);
  }
}

// One "+/-/~ path" line per input that moved between a recorded bake and the tree on disk.
function diffInputs(recorded, current) {
  const before = new Map(recorded.map(({ path, sha256 }) => [path, sha256])),
    now = new Map(current.map(({ path, sha256 }) => [path, sha256])),
    moved = [];
  for (const [path, digest] of now) {
    const old = before.get(path);
    if (old === undefined) moved.push(`+ ${path}`);
    else if (old !== digest) moved.push(`~ ${path}`);
  }
  for (const path of before.keys()) if (!now.has(path)) moved.push(`- ${path}`);
  return moved;
}

const packPrefix = "VQSV-WebNative/";

// Compare each bake-pipeline file in the packaged tree against the live tree at the repo root.
async function treeDriftProblems(paths) {
  const declared = new Map(declaredTreeDrift.map((entry) => [entry.path, entry.note])),
    problems = [];
  let compared = 0;
  for (const path of paths.filter((entry) => entry.path.startsWith(packPrefix))) {
    const live = resolve(repoRoot, path.path.slice(packPrefix.length));
    if (!existsSync(live)) continue; // packaged-only tooling has no counterpart to agree with
    compared++;
    if ((await sha256(live)) === path.sha256) continue;
    const note = declared.get(path.path);
    if (note === undefined)
      problems.push(
        `${path.path} differs between the two Java trees and is not a declared difference; resolve this subsystem's drift before re-baking`,
      );
  }
  return { problems, compared, declared: declared.size };
}

// A declared tree difference only means something while the record carries it and a bake actually
// hashes the file; otherwise the note has itself drifted from the guard it explains.
function declaredDriftProblems(recorded, hashed) {
  const problems = [],
    stored = JSON.stringify(recorded.treeDrift ?? []),
    current = JSON.stringify(declaredTreeDrift);
  if (stored !== current)
    problems.push(
      `the declared Java-tree drift is not what the record carries (record: ${stored}); re-record so each decision stays auditable`,
    );
  const hashedPaths = new Set(hashed.map((entry) => entry.path));
  for (const { path } of declaredTreeDrift)
    if (!hashedPaths.has(path))
      problems.push(
        `${path} is declared as tree drift but no bake hashes it, so the guard cannot see it`,
      );
  return problems;
}

async function main() {
  packDomainsOutsideBake = domainsOutsideBake(await readPackManifest());
  const rooms = await readRooms(),
    mapIds = [...new Set(Object.values(rooms).map((room) => room.mapId))].sort((a, b) => a - b),
    collected = [];
  for (const bake of bakes) {
    const patterns = [
      ...bake.java,
      ...bake.data,
      ...(bake.packRoot === "world" ? mapIdPatterns(mapIds) : []),
    ];
    collected.push({
      id: bake.id,
      producer: bake.producer,
      packRoot: bake.packRoot,
      inputFiles: await inputHashes(patterns),
      javaFiles: await inputHashes(bake.java),
      outputs: await outputGroups(bake.root, bake.owns),
    });
  }

  const bakedFiles = new Map();
  for (const { packRoot: owned, outputs } of collected) {
    if (owned !== "world") continue;
    for (const [group, list] of outputs.files)
      bakedFiles.set(group, [...(bakedFiles.get(group) ?? []), ...list]);
  }
  const coverage = await coverageProblems(rooms, bakedFiles);

  if (recording) {
    if (coverage.length > 0) {
      console.error(
        `refusing to record an incomplete bake:\n      ${coverage.join("\n      ")}\n\n${reBakeHint}`,
      );
      process.exit(1);
    }
    const manifest = {
      schema,
      recordedBy: "node scripts/pack-provenance.mjs --record",
      packDomainsOutsideBake,
      treeDrift: declaredTreeDrift.map(({ path, note }) => ({ path, note })),
      bakes: collected.map(({ id, producer, packRoot: owned, inputFiles, outputs }) => ({
        id,
        producer,
        packRoot: owned,
        inputFiles,
        outputGroups: outputs.groups,
      })),
    };
    const previous = await readManifest(true);
    const text = serialize(manifest);
    JSON.parse(text);
    await writeFile(manifestFile, text, "utf8");
    const moved = (previous?.bakes ?? []).flatMap((bake) => {
      const entry = collected.find((candidate) => candidate.id === bake.id);
      return entry ? diffInputs(bake.inputFiles, entry.inputFiles) : [];
    });
    console.log(
      `recorded ${manifest.bakes.reduce((n, b) => n + b.inputFiles.length, 0)} input hash(es) across ${manifest.bakes.length} bake(s) in ${manifestRel}` +
        (moved.length > 0
          ? `; ${moved.length} input(s) changed since the previous record:\n      ${moved.join("\n      ")}`
          : ""),
    );
    return;
  }

  const manifest = await readManifest(false);
  if (manifest.schema !== schema)
    throw new Error(
      `asset provenance schema is ${JSON.stringify(manifest.schema)}, expected ${schema}`,
    );

  const failures = [];
  const recordedDomains = (manifest.packDomainsOutsideBake ?? []).join(", ");
  if (recordedDomains !== packDomainsOutsideBake.join(", "))
    failures.push(
      `pack.json declares pack domains outside the bake as ${packDomainsOutsideBake.join(", ")} but the record says ${recordedDomains || "(nothing)"}; re-record after documenting the producer`,
    );
  for (const { id, producer, inputFiles, outputs } of collected) {
    const bake = manifest.bakes.find((entry) => entry.id === id);
    if (!bake) {
      failures.push(`${id}: not present in the provenance record`);
      continue;
    }
    const inputs = diffInputs(bake.inputFiles, inputFiles);
    if (inputs.length > 0)
      failures.push(
        `${id} (${producer}): ${inputs.length} input(s) changed since the record\n      ${inputs.join("\n      ")}`,
      );

    const outputsChanged = [];
    for (const [group, expected] of Object.entries(bake.outputGroups)) {
      const now = outputs.groups[group];
      if (!now) outputsChanged.push(`- ${group} (${expected.fileCount} file(s)) disappeared`);
      else if (now.fingerprint !== expected.fingerprint)
        outputsChanged.push(
          `~ ${group} (${expected.fileCount} -> ${now.fileCount} file(s)) no longer matches the recorded bake`,
        );
    }
    for (const group of Object.keys(outputs.groups))
      if (!bake.outputGroups[group]) outputsChanged.push(`+ ${group} is not in the recorded bake`);
    if (outputsChanged.length > 0)
      failures.push(
        `${id} (${producer}): baked output no longer matches the recorded inputs\n      ${outputsChanged.join("\n      ")}`,
      );
  }

  for (const problem of coverage) failures.push(`coverage: ${problem}`);

  const pipeline = await treeDriftProblems(collected.flatMap((entry) => entry.javaFiles));
  failures.push(...pipeline.problems);
  failures.push(
    ...declaredDriftProblems(
      manifest,
      collected.flatMap((entry) => entry.javaFiles),
    ),
  );

  const decoded = (await walk(resolve(repoRoot, "modules", "map", "decoded"))).filter((rel) =>
    rel.startsWith("data__map__map_"),
  ).length;
  if (failures.length > 0) {
    console.error(
      `pack provenance check failed (${failures.length} problem(s)); shipped art may be stale.\n\n  ${failures.join("\n  ")}\n\n${reBakeHint}` +
        (pipeline.problems.length > 0
          ? "\n\nFor a tree difference, decide which Java tree is the spec for that subsystem, fix it there, or add the path to declaredTreeDrift in scripts/pack-provenance.mjs with the reason. Re-baking alone does not resolve it."
          : ""),
    );
    process.exit(1);
  }
  console.log(
    `pack provenance ok: ${mapIds.length} of ${decoded} decoded map(s) baked, ${Object.keys(rooms).length} room(s), ${collected.reduce((n, b) => n + b.inputFiles.length, 0)} recorded input(s) unchanged`,
  );
  console.log(
    `java trees: ${pipeline.compared} bake-pipeline file(s) compared, ${pipeline.declared} declared difference(s)`,
  );
  console.log(`pack domains without a recorded producer yet: ${packDomainsOutsideBake.join(", ")}`);
}

main().catch((error) => {
  console.error(String(error?.stack ?? error));
  process.exit(1);
});
