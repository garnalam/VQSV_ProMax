import type { GameAssets } from "../../game/story/GameAssets";
import type { ImportCatalog } from "./JavaSaveImport";

/** The web game's own tables, as the Java save importer checks ids against them. */
export function importCatalogFor(assets: GameAssets): ImportCatalog {
  const bag = assets.bagItems,
    services = assets.battleServices,
    outfits = new Set(assets.metaSystems?.fashion.records.map((record) => record.key) ?? []);
  return {
    species: (id) => services.speciesRow(id) !== undefined,
    skill: (id) => services.rules.damage.skillRow(id) !== undefined,
    bagItem: (id) => bag?.bagItem(id) !== undefined,
    equipment: (id) => bag?.equipment(id) !== undefined,
    material: (id) => bag?.material(id) !== undefined,
    special: (id) => bag?.specialItem(id) !== undefined,
    fashion: (key) => outfits.has(key),
  };
}
