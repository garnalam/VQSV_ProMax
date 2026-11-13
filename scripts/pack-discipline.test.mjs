// Pack exclusivity: one object owns every resource load, so no other module can invent a path,
// bypass the manifest and fetch art directly, or hand-build an Image/Audio element. Tests are
// exempt because they read fixtures straight off disk instead of going through the runtime.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const srcRoot = resolve(import.meta.dirname, "..", "src");

const forbidden = [
  { name: "fetch", pattern: /\bfetch\s*\(/ },
  { name: "new Image", pattern: /new\s+Image\s*\(/ },
  { name: "new Audio", pattern: /new\s+Audio\s*\(/ },
  { name: "pack path literal", pattern: /["'`]\/pack\// },
  { name: "asset path literal", pattern: /["'`]\/assets\// },
];

function sourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (entry.isFile() && full.endsWith(".ts") && !full.endsWith(".test.ts")) found.push(full);
  }
  return found.sort();
}

describe("pack exclusivity", () => {
  it("keeps every resource load inside src/pack", () => {
    const offenders = [];
    for (const file of sourceFiles(srcRoot)) {
      if (file.startsWith(resolve(srcRoot, "pack"))) continue;
      const text = readFileSync(file, "utf8"),
        hits = forbidden.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
      if (hits.length > 0) offenders.push(`${file.slice(srcRoot.length + 1)}: ${hits.join(", ")}`);
    }
    expect(offenders, `only src/pack may load resources:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("has a loader module to keep it that way", () => {
    const packFiles = readdirSync(resolve(srcRoot, "pack")).sort();
    expect(packFiles).toContain("Pack.ts");
    expect(packFiles).toContain("boot.ts");
  });
});
