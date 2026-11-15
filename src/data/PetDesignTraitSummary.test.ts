import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PackDesignTraitBalanceTable } from "./GameData";

// Owner 2026-11-15: the player reads `summary`, the same rule as `description` in plain words.
const table = JSON.parse(
  readFileSync("public/pack/balance/pet-design-traits.json", "utf8"),
) as PackDesignTraitBalanceTable;

describe("plain-language trait summaries", () => {
  it("every characteristic has one, with every number its rule needs", () => {
    expect(table.traits).toHaveLength(280);
    for (const trait of table.traits) {
      expect(trait.summary, trait.key).toBeTruthy();
      expect(trait.summary, trait.key).not.toMatch(/undefined|NaN/);
      expect(trait.summary!.match(/\d/), trait.key).not.toBeNull();
    }
  });
});
