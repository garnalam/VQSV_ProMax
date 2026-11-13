import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PackSpeciesRow } from "../../data/GameData";
import { BadgeProgression } from "../world/WorldFlags";
import { COLLECTION_SNAPSHOT_LENGTH, PetCollection } from "../pet/PetCollection";
import {
  badgeEntries,
  badgeStatusText,
  petmapRows,
  recordStats,
  sourcePlayTime,
  type BadgeCatalogDocument,
  type UnifiedBadgeRecord,
} from "./RecordBook";

const read = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const species = new Map(
  read<{ rows: PackSpeciesRow[] }>("public/pack/data/battle/species.json").rows.map((r) => [
    r.speciesId,
    r,
  ]),
);
const speciesRow = (id: number) => species.get(id);
const catalog = read<BadgeCatalogDocument>("public/pack/story/badge-catalog.json"),
  unified = read<UnifiedBadgeRecord[]>("public/pack/data/battle/badges.json");

describe("PetCollectionProgression", () => {
  it("moves unseen → seen → collected, never back, over species 0..275", () => {
    const collection = new PetCollection();
    expect(collection.markSeen(68)).toBe(true);
    expect(collection.markSeen(68)).toBe(false);
    expect(collection.status(68)).toBe(1);
    expect(collection.markCollected(68)).toBe(true);
    expect(collection.markSeen(68)).toBe(false);
    expect(collection.status(68)).toBe(2);
    expect(collection.markCollected(276)).toBe(false);
    expect(collection.markCollected(-1)).toBe(false);
    // V4 and mutation species are kept but not counted, as JavaSE's `states` array.
    collection.markCollected(210);
    collection.markCollected(274);
    expect(collection.collectedSpeciesCount()).toBe(1);
    expect(collection.v4CollectedSpeciesCount()).toBe(1);
    const snapshot = collection.snapshot();
    expect(snapshot).toHaveLength(COLLECTION_SNAPSHOT_LENGTH);
    expect(new PetCollection(snapshot).snapshot()).toEqual(snapshot);
    expect(new PetCollection([3, 2, -1]).snapshot().slice(0, 3)).toEqual([0, 2, 0]);
  });
});

describe("Đồ giám data (record.ui / petmap.ui / badge.ui)", () => {
  it("lists one element's battle-valid species 0..201, with seen and owned marks", () => {
    const collection = new PetCollection();
    collection.markSeen(68);
    const element = speciesRow(68)!.element,
      rows = petmapRows(speciesRow, collection, element);
    expect(rows.every((row) => row.speciesId < 202)).toBe(true);
    expect(rows.every((row) => speciesRow(row.speciesId)!.validForBattle)).toBe(true);
    expect(rows.find((row) => row.speciesId === 68)).toMatchObject({ seen: true, owned: false });
    collection.markCollected(68);
    expect(petmapRows(speciesRow, collection, element).find((r) => r.speciesId === 68)?.owned).toBe(
      true,
    );
    // Every tab together never reaches all 280: V4 and mutation species are not in the book.
    const total = [0, 1, 2, 3, 4, 5, 6].reduce(
      (sum, tab) => sum + petmapRows(speciesRow, collection, tab).length,
      0,
    );
    expect(total).toBeLessThanOrEqual(202);
  });

  it("counts the record page and writes the play time as h'm\"ss", () => {
    const collection = new PetCollection();
    collection.markCollected(68);
    const stats = recordStats({
      ownedPets: 2,
      collection,
      species: speciesRow,
      badges: 3,
      playTimeMillis: 3_725_000,
    });
    expect(stats).toMatchObject({ owned: 2, collected: 1, badges: 3 });
    expect(sourcePlayTime(stats.playTimeMillis)).toBe(`1'2"05`);
    expect(sourcePlayTime(59_000)).toBe(`0'0"59`);
  });

  it("shows the eight source badges, and a hidden unified badge only once owned", () => {
    const badges = new BadgeProgression();
    let entries = badgeEntries(badges, catalog, unified);
    expect(entries).toHaveLength(8);
    expect(entries[0]).toMatchObject({
      name: "Liệt Hỏa Chương",
      status: "Chưa đạt",
      achieved: false,
    });
    badges.grant(0);
    badges.grant(7);
    badges.grant(8);
    entries = badgeEntries(badges, catalog, unified);
    expect(entries).toHaveLength(9);
    expect(entries[8]).toMatchObject({ id: 8, icon: "UD-BADGE-DIEN-MIEU" });
    expect(badgeStatusText(badges, 0)).toBe("Đã đạt - Chưa cường hóa");
    expect(badgeStatusText(badges, 7)).toBe("Đã đạt - Không thể cường hóa");
    badges.enhance(0);
    expect(badgeStatusText(badges, 0)).toBe("Đã đạt - Đã cường hóa");
    // An enhanced badge describes its enhanced effect.
    expect(badgeEntries(badges, catalog, unified)[0].description).toBe(
      catalog.source[0].enhancedDescription,
    );
  });
});
