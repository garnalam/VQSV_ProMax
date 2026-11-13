import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BagCatalog,
  bagActionLabel,
  bagRows,
  type BagContents,
  type BagItemsDocument,
} from "./Bag";
import { UnifiedItemCatalog, type UnifiedItemsDocument } from "../../data/UnifiedItems";

const catalog = new BagCatalog(
  JSON.parse(readFileSync("public/pack/story/bag-items.json", "utf8")) as BagItemsDocument,
);
const contents = (patch: Partial<BagContents> = {}): BagContents => ({
  items: {},
  equipment: [],
  materials: {},
  specials: [],
  carried: new Set(),
  ...patch,
});

describe("baked bag items (db.mid groups 3/4/5)", () => {
  it("keeps the original rows: name, sprite-258 icon, description and raw columns", () => {
    expect(catalog.consumable(0)).toMatchObject({ name: "Tất Trung Cầu", icon: 25 });
    expect(catalog.consumable(13)?.columns).toEqual([509, 53, 510, 300, 0, 10, 500]);
    expect(catalog.gear(12)).toMatchObject({ name: "Tinh Nguyên Thạch", icon: 13 });
    expect(catalog.special(5)?.name).toBe("Trang sách tương ứng của sủng vật");
    expect([catalog.inFirstList(1), catalog.inFirstList(4)]).toEqual([true, false]);
  });
});

describe("bagRows / bagActionLabel (JavaSE)", () => {
  it("lists the consumables with a count, sorted by id (JavaSE bagRows)", () => {
    const rows = bagRows(0, contents({ items: { "4": 5, "13": 2, "1": 2, "0": 0 } }), catalog);
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      [1, "2"],
      [4, "5"],
      [13, "2"],
    ]);
  });

  it("marks equipment a pet carries, renames the golden key and counts the egg", () => {
    expect(
      bagRows(1, contents({ equipment: [5, 0], carried: new Set([0]) }), catalog).map((r) => [
        r.id,
        r.status,
      ]),
    ).toEqual([
      // JavaSE sorts the equipment tab by id.
      [0, "Đã mang theo"],
      [5, ""],
    ]);
    expect(
      bagRows(2, contents({ materials: { "17": 5, "12": 3 } }), catalog).map((r) => r.name),
    ).toEqual(["Tinh Nguyên Thạch", "Chìa khóa vàng"]);
    // Every egg is the same kind of row, named by its catalog entry; none left hides the row.
    const egg = (name: string) => ({ name, description: name, iconCell: 55 }),
      eggs = new Map([
        [0, egg("Trứng sủng vật")],
        [11, egg("Trứng Pet V4")],
      ]),
      rows = (specials: number[], state = { active: false, activeEggItemId: 0, ready: false }) =>
        bagRows(3, contents({ specials, eggs, egg: state }), catalog).map((r) => [
          r.id,
          r.name,
          r.status,
        ]);
    expect(rows([5, 0, 11, 11])).toEqual([
      [0, "Trứng sủng vật", "1 cái"],
      [5, catalog.special(5)!.name, ""],
      [11, "Trứng Pet V4", "2 cái"],
    ]);
    expect(rows([11, 0, 0], { active: true, activeEggItemId: 11, ready: false })).toEqual([
      [0, "Trứng sủng vật", "2 cái"],
      [11, "Trứng Pet V4", "Đang ấp - 1 cái"],
    ]);
    expect(rows([0], { active: true, activeEggItemId: 0, ready: true })[0][2]).toBe(
      "Hoàn thành - 1 cái",
    );
    expect(rows([5], { active: true, activeEggItemId: 0, ready: false }).map((r) => r[0])).toEqual([
      5,
    ]);
  });

  it("labels the action button as JavaSE bagActionLabel does, or hides it", () => {
    const row = (id: number) => ({
      id,
      icon: 0,
      name: "",
      status: "",
      description: "",
      egg: id === 0,
    });
    expect(bagActionLabel(0, undefined)).toBe("Sử dụng");
    expect([bagActionLabel(1, row(0)), bagActionLabel(2, row(12))]).toEqual(["Sử dụng", null]);
    expect([0, 1, 5, 7, 10].map((id) => bagActionLabel(3, row(id)))).toEqual([
      "Mo ra",
      null,
      "Mo ra",
      "Su dung",
      "Mo ra",
    ]);
    expect(bagActionLabel(3, row(0), true)).toBe("Ap trung");
    expect(bagActionLabel(3, undefined)).toBeNull();
  });
});

describe("the unified Item catalog behind the bag (VqsvSourceOps)", () => {
  const unified = new UnifiedItemCatalog(
      JSON.parse(readFileSync("public/pack/items/catalog.json", "utf8")) as UnifiedItemsDocument,
    ),
    bag = new BagCatalog(catalog.document, unified);

  it("bakes JavaSE's 87 records, 25 aliases and their icons", () => {
    expect(unified.records).toHaveLength(87);
    expect(unified.records.filter((r) => r.rainbowImported)).toHaveLength(35);
    expect(Object.keys(unified.document.aliases)).toHaveLength(25);
    // An alias resolves to its canonical record (CV "Đồ uống" is the Sandwich).
    expect(unified.requireActive("CV-ITEM-0-00").key).toBe("LH-ITEM-4-04");
    expect(unified.requireActive("CV-ITEM-0-68")).toMatchObject({
      kind: "SPECIAL",
      runtimeId: 6063,
    });
    expect(() => unified.requireActive("CV-ITEM-0-35")).toThrow();
  });

  it("consumables keep the db.mid row; the Cầu Vồng bag items come from the catalog", () => {
    expect(bag.bagItem(4)?.description).toBe(catalog.consumable(4)?.description);
    expect(bag.bagItem(4032)).toMatchObject({
      name: "Bảo rương",
      iconKey: "items.icons/CV-ITEM-0-32.png",
    });
  });

  it("equipment, materials and specials read the catalog first", () => {
    expect(bag.equipment(1)?.description).toBe("Tăng 10% Sức mạnh của Pet đang mang.");
    expect(bag.material(17)?.name).toBe("Chìa khóa");
    expect(bag.specialItem(10)?.name).toBe("Truyền Tống Thạch");
    const rows = (tab: 1 | 2, patch: Partial<BagContents>) =>
      bagRows(tab, contents(patch), bag).map((r) => [r.id, r.name, r.iconKey ?? null]);
    // Cầu Vồng pieces and materials now have rows (the old bag dropped every id past the db.mid tables).
    expect(rows(1, { equipment: [5037, 3] })).toEqual([
      [3, "Ô Nha Uế", null],
      [5037, "Cao cấp trị liệu", "items.icons/CV-ITEM-0-37.png"],
    ]);
    expect(rows(2, { materials: { "3009": 2, "12": 1, "1004": 3 } })).toEqual([
      [12, "Tinh Nguyên Thạch", null],
      [3009, "Cứng cỏi thạch", "items.icons/CV-ITEM-0-16.png"],
    ]);
  });
});
