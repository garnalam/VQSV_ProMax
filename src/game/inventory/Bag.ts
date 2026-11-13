/**
 * The JavaSE bag (`VqsvPanelRuntime.bagRows` / `tickBag` / `renderBag`): four tabs over the
 * player's lists. Each row's name, text and icon come from where `VqsvSourceOps` takes them: the
 * unified Item catalog first (equipment, materials, specials, and the Cầu Vồng bag items), the
 * original db.mid tables for the rest.
 *
 *   tab 0 "Tiêu hao"     consumables (db.mid group 4), sorted by id
 *   tab 1 "Trang sức"    equipment (group 3 ids 0..11), "Đã mang theo" when a pet carries it
 *   tab 2 "Tài liệu"     materials (group 3 ids 12..)
 *   tab 3 "Đặc thù"      special items (group 5)
 *
 * Pure data: the panel keeps the cursor, the host applies what an action changes.
 */

import { UnifiedItemCatalog, type UnifiedItemRecord } from "../../data/UnifiedItems";

/** One row of `public/pack/story/bag-items.json` (db.mid row plus resolved chs.mid text). */
export type BagItemRow = {
  id: number;
  name: string;
  /** Sprite-258 cell (`c.g.a(258)` frame). */
  icon: number;
  description: string;
  /** The raw db.mid row: [name row, icon, description row, price, flag, kind, ...params]. */
  columns: number[];
};
export type BagItemsDocument = {
  consumables: BagItemRow[];
  gear: BagItemRow[];
  specials: BagItemRow[];
  texts: Record<string, string>;
};

export type BagTab = 0 | 1 | 2 | 3;
export const BAG_TABS = 4;
/** Gear ids below 12 are equipment (`game.j.a(.., 2)`: `n2 >= 12` goes to N). */
export const FIRST_MATERIAL_ID = 12;
/** `bt()`: material 17 is listed as "Chìa khóa vàng" whatever its name row says. */
export const GOLDEN_KEY_ID = 17;
/** Consumables the bag can use without picking a pet (`af()` cases 13 and 14). */
export const REPEL_ID = 13;
export const HATCH_BOOST_ID = 14;

/** `ItemDefinition`: what a bag row, a choice row or a reward line shows for one item. */
export type ItemDefinition = {
  id: number;
  name: string;
  description: string;
  /** Sprite-258 cell. */
  icon: number;
  /** The unified record's own icon image (pack key), drawn instead of `icon`. */
  iconKey?: string;
  /** The unified record's key, when the item has one. */
  key?: string;
};

/** `ItemDefinition(UnifiedItemRecord, ..)`. */
const fromUnified = (record: UnifiedItemRecord): ItemDefinition => ({
  id: record.runtimeId,
  name: record.name,
  description: record.description,
  icon: record.frame < 0 ? 0 : record.frame,
  iconKey: UnifiedItemCatalog.iconKey(record) ?? undefined,
  key: record.key,
});
const fromRow = (id: number, row: BagItemRow): ItemDefinition => ({
  id,
  name: row.name,
  description: row.description,
  icon: row.icon,
});
/** `VqsvSourceOps` material ids 1000.. are item-table rows (listed on tab 0), 2000.. held-table ones. */
const ITEM_TABLE_MATERIAL_OFFSET = 1000,
  HELD_TABLE_MATERIAL_OFFSET = 2000;

export class BagCatalog {
  constructor(
    readonly document: BagItemsDocument,
    readonly unified?: UnifiedItemCatalog,
  ) {}
  /** `VqsvSourceOps.sourceItem`'s quest rows (Lucy's lunch...), checked before any table. */
  private readonly questItems = new Map<number, ItemDefinition>();
  /** A quest item `sourceItem` defines by id: icon cell 0, its own name and text. */
  addQuestItem(id: number, name: string, description: string): void {
    this.questItems.set(id, { id, name, description, icon: 0 });
  }
  /** `VqsvSourceOps.sourceItem`: a quest row, a Cầu Vồng bag item from the catalog, else db.mid. */
  bagItem(id: number): ItemDefinition | undefined {
    const quest = this.questItems.get(id);
    if (quest) return quest;
    const record = this.unified?.byRuntime("BAG", id);
    if (record?.rainbowImported) return fromUnified(record);
    const row = this.consumable(id);
    return row ? fromRow(id, row) : undefined;
  }
  /** `sourceEquipmentItem`: the catalog first, then the held-item row. */
  equipment(id: number): ItemDefinition | undefined {
    const record = this.unified?.byRuntime("EQUIPMENT", id);
    if (record) return fromUnified(record);
    const row = this.gear(id);
    return row ? fromRow(id, row) : undefined;
  }
  /** `sourceMaterialItem`: the catalog first, then the held-table rows the material id points at. */
  material(id: number): ItemDefinition | undefined {
    const record = this.unified?.byRuntime("MATERIAL", id);
    if (record) return fromUnified(record);
    if (id >= HELD_TABLE_MATERIAL_OFFSET) {
      const row = this.gear(id - HELD_TABLE_MATERIAL_OFFSET);
      return row ? { ...fromRow(id, row) } : undefined;
    }
    const row = this.gear(id);
    if (!row) return undefined;
    return { ...fromRow(id, row), name: id === GOLDEN_KEY_ID ? "Chìa khóa vàng" : row.name };
  }
  /** `sourceSpecialItem`: the catalog first, then the db.mid special row. */
  specialItem(id: number): ItemDefinition | undefined {
    const record = this.unified?.byRuntime("SPECIAL", id);
    if (record) return fromUnified(record);
    const row = this.special(id);
    return row ? fromRow(id, row) : undefined;
  }
  /** Material ids 1000..1999 are item-table rows, which the bag lists with the consumables. */
  static itemTableMaterial(id: number): boolean {
    return id >= ITEM_TABLE_MATERIAL_OFFSET && id < HELD_TABLE_MATERIAL_OFFSET;
  }
  consumable(id: number): BagItemRow | undefined {
    return this.document.consumables[id];
  }
  gear(id: number): BagItemRow | undefined {
    return this.document.gear[id];
  }
  special(id: number): BagItemRow | undefined {
    return this.document.specials[id];
  }
  /** `a.b.c.c[4][id][5] == 0`: the item sits in list L (shown first) rather than K. */
  inFirstList(id: number): boolean {
    return (this.consumable(id)?.columns[5] ?? 0) === 0;
  }
  text(row: number): string {
    return this.document.texts[String(row)] ?? "";
  }
}

/** What the player carries, as the save keeps it. */
export type BagContents = {
  /** Consumables by id (the existing `inventory.items`). */
  items: Readonly<Record<string, number>>;
  /** Equipment ids owned (list M). */
  equipment: readonly number[];
  /** Materials by id (list N). */
  materials: Readonly<Record<string, number>>;
  /** Special item ids held (list O). */
  specials: readonly number[];
  /** Equipment ids a pet is carrying (`M[i][1] == 1`). */
  carried: ReadonlySet<number>;
  /** `progression.egg`: the incubator the egg rows describe. */
  egg?: { active: boolean; activeEggItemId: number; ready: boolean };
  /** The hatchable eggs by item id: their bag rows (name, text, icon). */
  eggs?: ReadonlyMap<number, { name: string; description: string; iconCell: number }>;
};

export type BagRow = {
  id: number;
  icon: number;
  /** A unified record's own icon image (pack key), drawn instead of `icon`. */
  iconKey?: string;
  name: string;
  /** The right-hand column: a count, "Đã mang theo", "1 cái"... */
  status: string;
  description: string;
  /** `BagRow.specialEgg`: the row hatches, and shows the "?" preview pill while owned. */
  egg?: boolean;
  count?: number;
};

const counted = (record: Readonly<Record<string, number>>) =>
  Object.entries(record)
    .map(([id, count]) => ({ id: Number(id), count }))
    .filter((entry) => Number.isInteger(entry.id) && entry.count > 0)
    .sort((a, b) => a.id - b.id);

const row = (item: ItemDefinition): Omit<BagRow, "status"> => ({
  id: item.id,
  icon: item.icon,
  ...(item.iconKey ? { iconKey: item.iconKey } : {}),
  name: item.name,
  description: item.description,
});

/** The rows tab `tab` lists (`bs`, `br` case 1, `bt`, `bu`). */
export function bagRows(tab: BagTab, contents: BagContents, catalog: BagCatalog): BagRow[] {
  switch (tab) {
    case 0: {
      // JavaSE `bagRows` tab 0: every bag item with a count, sorted by id.
      return counted(contents.items)
        .filter((entry) => catalog.bagItem(entry.id))
        .map(({ id, count }) => ({ ...row(catalog.bagItem(id)!), status: String(count) }));
    }
    case 1:
      // JavaSE tab 1: every owned piece, Liệt Hỏa and Cầu Vồng, sorted by id.
      return [...contents.equipment]
        .filter((id) => catalog.equipment(id))
        .sort((a, b) => a - b)
        .map((id) => ({
          ...row(catalog.equipment(id)!),
          status: contents.carried.has(id) ? "Đã mang theo" : "",
        }));
    case 2:
      // JavaSE tab 2: every material with a count, the item-table ids (listed on tab 0) aside.
      return counted(contents.materials)
        .filter((entry) => !BagCatalog.itemTableMaterial(entry.id) && catalog.material(entry.id))
        .map(({ id, count }) => ({ ...row(catalog.material(id)!), status: String(count) }));
    default: {
      // JavaSE `bagRows` tab 3: one row per special reward, sorted by id. Every egg is the same
      // kind of row: "N cái", "Đang ấp - N cái" on the incubated egg, "Hoàn thành - N cái" once it
      // is ready, and no row at all when none is left.
      const egg = contents.egg ?? { active: false, activeEggItemId: 0, ready: false },
        counts = new Map<number, number>();
      for (const id of contents.specials) counts.set(id, (counts.get(id) ?? 0) + 1);
      return [...counts.entries()]
        .filter(([id]) => contents.eggs?.has(id) || catalog.specialItem(id))
        .sort((a, b) => a[0] - b[0])
        .map(([id, count]) => {
          const eggRow = contents.eggs?.get(id);
          if (!eggRow) return { ...row(catalog.specialItem(id)!), status: "" };
          const incubating = egg.active && egg.activeEggItemId === id;
          return {
            id,
            icon: eggRow.iconCell,
            name: eggRow.name,
            status: !incubating
              ? `${count} cái`
              : egg.ready
                ? `Hoàn thành - ${count} cái`
                : `Đang ấp - ${count} cái`,
            description: eggRow.description,
            egg: true,
            count,
          };
        });
    }
  }
}

/**
 * JavaSE `bagActionLabel`: "Sử dụng" on the consumable and equipment tabs, nothing on materials,
 * and on the special tab the source's own unaccented labels ("Mo ra", "Su dung"). Null hides the
 * button.
 */
export function bagActionLabel(
  tab: BagTab,
  row: BagRow | undefined,
  eggActive = false,
): string | null {
  if (tab === 0 || tab === 1) return "Sử dụng";
  if (tab === 2 || !row) return null;
  if (row.egg) return eggActive ? "Ap trung" : "Mo ra";
  switch (row.id) {
    case 5:
    case 6:
    case 10:
      return "Mo ra";
    case 7:
    case 8:
    case 9:
      return "Su dung";
    default:
      return null;
  }
}
