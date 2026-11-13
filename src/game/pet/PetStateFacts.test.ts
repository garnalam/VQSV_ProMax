import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { PackEvolution } from "../../data/GameData";
import { EvolutionCatalog, type PetEvolutionsDocument } from "./Evolution";
import { worldPetCard } from "./PetScreen";

/**
 * Pet State's "Chủng", "Hóa" and the petsetting.ui evolution row, read from the JavaSE bake
 * (`ExportWebPetTaxonomy`, `ExportWebPetEvolutionText`) through the real pack.
 */
vi.stubGlobal(
  "Image",
  class {
    complete = true;
    naturalWidth = 1;
    width = 1;
    height = 1;
    src = "";
  },
);
vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(
    import.meta.dirname,
    "../../../public",
    decodeURIComponent(String(input).split("?")[0].replace(/^\//, "")),
  );
  if (!existsSync(file)) return { ok: false, status: 404 };
  const bytes = readFileSync(file);
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(bytes.toString("utf8")),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
  };
});

const read = <T>(path: string): T =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../public/pack", path), "utf8")) as T;
const baked = read<PetEvolutionsDocument>("story/pet-evolutions.json"),
  unified = read<PackEvolution[]>("data/battle/evolutions.json"),
  catalog = new EvolutionCatalog(unified, baked);

describe("baked JavaSE evolution branches", () => {
  it("covers the unified catalog exactly and adds the V4 and hand-authored branches", () => {
    expect(baked.rules.length).toBeGreaterThan(unified.length);
    for (const row of unified) {
      const rule = catalog
        .rules(row.fromSpeciesId)
        .find((candidate) => candidate.toSpecies === row.toSpeciesId);
      expect(rule, row.stableKey).toBeDefined();
      expect(rule!.requiredLevel).toBe(row.requiredLevel);
      expect(rule!.ingredients.map((i) => [i.materialId, i.quantity])).toEqual(
        row.ingredients.map((i) => [i.runtimeMaterialId, i.quantity]),
      );
    }
    // Thiên Viêm Hổ (LH-004) and the Liệt Hỏa mutation (LH-023) live outside evolutions.json.
    expect(catalog.notice(4)).toMatchObject({
      kind: "evolution",
      toSpecies: 277,
      requiredLevel: 30,
    });
    expect(catalog.notice(23)).toMatchObject({ kind: "mutation", requiredQuality: 3 });
    expect(catalog.label(23)).toBe("Dị hoá");
    // A V4 species.
    expect(catalog.label(202)).toBe("Tiến hóa");
    expect(catalog.notice(202)?.toSpecies).toBe(203);
  });

  it("keeps both branches of a species that can evolve or mutate", () => {
    const kinds = catalog.rules(104).map((rule) => [rule.kind, rule.toSpecies]);
    expect(kinds).toEqual([
      ["evolution", 105],
      ["mutation", 106],
    ]);
    expect(catalog.notice(104)?.kind).toBe("evolution");
    expect(catalog.text(104)).toBe("Tiến hóa > Hoa ngũ sắc / Dị hóa > Hoa ăn thịt người");
  });

  it("writes the Hóa chip as evolutionText: a target name, or empty for a final form", () => {
    expect(catalog.text(68)).toBe("Tiến hóa > Thiểm Điện Miêu");
    expect(catalog.text(69)).toBe("");
    expect(catalog.label(69)).toBeNull();
    expect(catalog.notice(69)).toBeUndefined();
  });
});

describe("Pet State facts on the party cards", async () => {
  const { Pack } = await import("../../pack/Pack");
  const { GameAssets } = await import("../story/GameAssets");
  const assets = await GameAssets.fromPack(await Pack.load()),
    services = assets.battleServices,
    pet = (speciesId: number) => ({ slot: 0, speciesId, level: 10, quality: 2, experience: 0 });

  it("fills Chủng from the taxonomy and Hóa from evolutionText", () => {
    const card = worldPetCard(pet(68) as never, 0, services).pet!;
    expect(card.speciesName).toBe(assets.petTaxonomy["68"]);
    expect(card.speciesName).toBeTruthy();
    expect(card.evolution).toBe("Tiến hóa > Thiểm Điện Miêu");
    const last = worldPetCard(pet(69) as never, 0, services).pet!;
    expect(last.evolution).toBe("");
  });

  it("starts a map card with no buffs or debuffs, as a fresh BattleUnit does", () => {
    const card = worldPetCard(pet(68) as never, 0, services).pet!;
    expect([card.buffCount ?? 0, card.debuffCount ?? 0]).toEqual([0, 0]);
  });
});
