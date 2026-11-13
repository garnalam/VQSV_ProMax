import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SavedPet } from "../../persistence/save/GameSave";
import { BagCatalog, type BagItemsDocument } from "../inventory/Bag";
import {
  PetSpeciesCatalog,
  applyPetItem,
  petSettingLabels,
  petItemCheck,
  type PetSpeciesDocument,
} from "./PetScreen";

const json = <T>(file: string) => JSON.parse(readFileSync(file, "utf8")) as T;
const species = new PetSpeciesCatalog(
  json<PetSpeciesDocument>("public/pack/story/pet-species.json"),
);
const bag = new BagCatalog(json<BagItemsDocument>("public/pack/story/bag-items.json"));
const ppMax = () => 20;
const pet = (patch: Partial<SavedPet> = {}): SavedPet => ({
  speciesId: 68,
  level: 7,
  quality: 2,
  maxHp: 100,
  currentHp: 40,
  experience: 50,
  skillIds: [1, 2],
  skillPp: [5, 20],
  heldEquipmentId: -1,
  ...patch,
});

describe("baked species (db.mid group 0)", () => {
  it("names the species and marks the divine beasts release refuses", () => {
    expect(species.row(68)).toMatchObject({
      name: "Điện Miêu",
      element: 4,
      elementName: "Điện hệ",
    });
    expect(species.divine(68)).toBe(false);
    const divine = species.document.species.find((row) => row.columns[22] === 2);
    if (divine) expect(species.divine(divine.id)).toBe(true);
  });
});

describe("petSettingLabels (sourcePetSettingActionLabel)", () => {
  it("lists seven rows, eight with an evolution, the companion row last", () => {
    expect(petSettingLabels(null, false)).toEqual([
      "Đạo cụ",
      "Chiến đấu",
      "Vật phẩm trang sức",
      "Phóng sinh",
      "Kỹ năng",
      "Nâng phẩm",
      "Dắt đi theo",
    ]);
    expect(petSettingLabels("Tiến hóa", true).slice(-2)).toEqual(["Tiến hóa", "Ngừng đồng hành"]);
  });
});

describe("petItemCheck / applyPetItem (game.i.x / w)", () => {
  it("refuses with the source's codes", () => {
    expect(petItemCheck(pet({ currentHp: 100 }), 4, bag, ppMax)).toBe(2); // HP full
    expect(petItemCheck(pet({ skillPp: [20, 20] }), 6, bag, ppMax)).toBe(3); // PP full
    expect(petItemCheck(pet({ currentHp: 0 }), 4, bag, ppMax)).toBe(8); // dead
    expect(petItemCheck(pet(), 11, bag, ppMax)).toBe(1); // revive on a living pet
    expect(petItemCheck(pet(), 10, bag, ppMax)).toBe(4); // nothing to cure
    expect(petItemCheck(pet({ currentHp: 100, skillPp: [20, 20] }), 8, bag, ppMax)).toBe(7);
    expect(petItemCheck(pet(), 4, bag, ppMax)).toBe(-1);
  });

  it("heals max * [6] / 100 + [7], restores PP and revives", () => {
    const sandwich = pet({ maxHp: 300, currentHp: 40 });
    applyPetItem(sandwich, 4, bag, ppMax); // 40 + 300 * 50 / 100 + 50
    expect(sandwich.currentHp).toBe(240);
    const capped = pet();
    applyPetItem(capped, 4, bag, ppMax); // 40 + 100, capped at the maximum
    expect(capped.currentHp).toBe(100);
    const energy = pet();
    applyPetItem(energy, 6, bag, ppMax); // +25 PP each, capped
    expect(energy.skillPp).toEqual([20, 20]);
    const dead = pet({ currentHp: 0 });
    expect(petItemCheck(dead, 11, bag, ppMax)).toBe(-1);
    applyPetItem(dead, 11, bag, ppMax); // 100 * 50 / 100 + 50, +20 PP
    expect([dead.currentHp, dead.skillPp]).toEqual([100, [20, 20]]);
  });
});
