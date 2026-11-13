// The pack manifest is the contract between the producers and the runtime, so it has to be
// checked against the shipped bytes in both directions: every declared path exists, every shipped
// file is declared, and the declared ranges are the ranges on disk.
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, ".."),
  packRoot = resolve(root, "public", "pack"),
  manifest = JSON.parse(readFileSync(resolve(packRoot, "pack.json"), "utf8"));

function walk(absDir, prefix) {
  const found = [];
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...walk(resolve(absDir, entry.name), rel));
    else if (entry.isFile()) found.push(rel);
  }
  return found.sort();
}

const shipped = walk(packRoot, "")
    .filter((rel) => rel !== "/pack.json")
    .map((rel) => rel.slice(1)),
  claimed = new Set(),
  missing = [];

function claim(path) {
  if (existsSync(resolve(packRoot, path))) claimed.add(path);
  else missing.push(path);
}

function cellPath(domain, sprite, index) {
  return domain.template.replace("{sprite}", String(sprite)).replace("{index}", String(index));
}

for (const domain of manifest.domains) {
  if (domain.resolution === "entries") for (const entry of domain.entries ?? []) claim(entry.file);
  if (domain.resolution === "template")
    for (const name of domain.names ?? []) claim(domain.template.replace("{name}", name));
  if (domain.resolution === "cells")
    for (const set of domain.sets ?? []) {
      const onDisk = walk(resolve(packRoot, "ui", "cell", String(set.sprite)), "").length;
      expect(
        onDisk,
        `cell set ${set.sprite} declares ${set.available.count} file(s) but disk has ${onDisk}`,
      ).toBe(set.available.count);
      for (
        let index = set.available.start;
        index < set.available.start + set.available.count;
        index++
      )
        claim(cellPath(domain, set.sprite, index));
    }
  if (domain.resolution === "root") {
    for (const index of domain.indexes ?? []) claim(index.file);
    const patterns = (domain.shapes ?? []).map(
      (shape) =>
        new RegExp(
          `^${shape.path
            .split(/\{[^}]+\}/)
            .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("[^/]+")}$`,
        ),
    );
    const indexInner = new Set(
      (domain.indexes ?? []).map((index) => index.file.slice(domain.root.length + 1)),
    );
    for (const rel of walk(resolve(packRoot, domain.root), domain.root)) {
      const inside = rel.slice(domain.root.length + 1);
      expect(
        indexInner.has(inside) || patterns.some((pattern) => pattern.test(inside)),
        `${rel} is shipped under the ${domain.id} root but is neither an index nor a declared shape`,
      ).toBe(true);
      claimed.add(rel);
    }
  }
}

describe("pack manifest", () => {
  it("declares a schema and a base url the runtime can fetch", () => {
    expect(manifest.schema).toBe("vqsv-webnative-pack-v1");
    expect(manifest.baseUrl).toBe("/pack");
    expect(manifest.domains.length).toBeGreaterThan(0);
  });

  it("documents who produced each domain", () => {
    const kinds = ["java-bake", "java-tool", "ts-exporter", "copy", "hand-authored", "mixed"];
    for (const domain of manifest.domains) {
      expect(domain.producer?.what, `${domain.id} has no producer`).toBeTruthy();
      expect(kinds, `${domain.id} producer kind ${domain.producer?.kind} is unknown`).toContain(
        domain.producer?.kind,
      );
      if (domain.producer.kind !== "copy")
        expect(
          domain.producer.command ??
            domain.producer.note ??
            ((domain.entries ?? []).length > 0 &&
              domain.entries.every((entry) => entry.producer?.what)),
          `${domain.id} has no way to re-produce it`,
        ).toBeTruthy();
    }
  });

  it("resolves every declared path to a shipped file", () => {
    expect(missing, `declared but missing:\n  ${missing.join("\n  ")}`).toEqual([]);
  });

  it("claims every shipped file through a declaration", () => {
    const unclaimed = shipped.filter((rel) => !claimed.has(rel));
    expect(unclaimed, `shipped but undeclared:\n  ${unclaimed.join("\n  ")}`).toEqual([]);
    expect(claimed.size).toBe(shipped.length);
  });

  it("ships nothing outside the pack", () => {
    const others = readdirSync(resolve(root, "public"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "pack")
      .map((entry) => entry.name);
    expect(others, "public/ must contain only the pack").toEqual([]);
  });

  it("keeps declared cell ranges inside the files on disk", () => {
    for (const domain of manifest.domains.filter((entry) => entry.resolution === "cells"))
      for (const set of domain.sets ?? []) {
        expect(set.used.start).toBeGreaterThanOrEqual(set.available.start);
        expect(set.used.start + set.used.count).toBeLessThanOrEqual(
          set.available.start + set.available.count,
        );
        for (let index = set.used.start; index < set.used.start + set.used.count; index++)
          expect(
            existsSync(resolve(packRoot, cellPath(domain, set.sprite, index))),
            `used cell ${set.sprite}.${index} is not shipped`,
          ).toBe(true);
      }
  });
});
