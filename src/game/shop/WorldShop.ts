import type { SavedPet } from "../../persistence/save/GameSave";
import type { BagCatalog } from "../inventory/Bag";

/**
 * The town merchant's "Thương điếm" (JavaSE `Mode.SOURCE_WORLD_SHOP`): its sell list
 * (`sourceWorldShopSellRows`, `WorldItemShopService`) and its party recovery
 * (`WorldPetRecoveryService`). Buying goes through the portable shop's `shopbuy` list, as in JavaSE.
 */

/** `VqsvSourceOps.ITEM_TABLE_MATERIAL_OFFSET`: an item-table entry stored as a material. */
export const ITEM_TABLE_MATERIAL_OFFSET = 1000;
const HELD_TABLE_MATERIAL_OFFSET = 2000;

/** `VqsvPanelRuntime.SOURCE_WORLD_SHOP_LABELS`, in row order. */
export const WORLD_SHOP_LABELS = ["Mua sắm", "Bán đi", "Khôi phục", "Rời đi"] as const;
/** `SOURCE_WORLD_SHOP_ROW_WIDGETS` of `shop.ui`. */
export const WORLD_SHOP_ROW_WIDGETS = [6, 7, 9, 8] as const;
/** The two merchant stocks: table 4 bucket 0 (items), table 3 bucket 2 (materials). */
export type WorldShopRoute = "item" | "material";

/** `SourceSellRow`. */
export type SellRow = {
  itemId: number;
  name: string;
  description: string;
  iconCell: number;
  count: number;
  sourcePrice: number;
  currency: number;
  unitPrice: number;
};

export type ShopStock = { items: Record<string, number>; materials: Record<string, number> };

/** `WorldItemShopService.unitSalePrice`: half the source price. */
export const unitSalePrice = (sourcePrice: number) => Math.trunc(Math.max(0, sourcePrice) / 2);

/** `WorldItemShopService.currentCount`: the bag stack plus the item-table material copy. */
export function sellCount(stock: ShopStock, itemId: number): number {
  return (
    Math.max(0, stock.items[String(itemId)] ?? 0) +
    Math.max(0, stock.materials[String(ITEM_TABLE_MATERIAL_OFFSET + itemId)] ?? 0)
  );
}

/** `sourceWorldShopSellRows`: every bag item held, plus item-table materials, by item id. */
export function sellRows(catalog: BagCatalog, stock: ShopStock): SellRow[] {
  const ids = new Set<number>();
  for (const [key, count] of Object.entries(stock.items)) if (count > 0) ids.add(Number(key));
  for (const [key, count] of Object.entries(stock.materials)) {
    const id = Number(key);
    if (count > 0 && id >= ITEM_TABLE_MATERIAL_OFFSET && id < HELD_TABLE_MATERIAL_OFFSET)
      ids.add(id - ITEM_TABLE_MATERIAL_OFFSET);
  }
  const rows: SellRow[] = [];
  for (const itemId of [...ids].sort((a, b) => a - b)) {
    const row = catalog.consumable(itemId);
    if (!row) continue;
    const count = sellCount(stock, itemId);
    if (count <= 0) continue;
    const sourcePrice = row.columns[3] ?? 0;
    rows.push({
      itemId,
      name: row.name,
      description: row.description,
      iconCell: row.icon,
      count,
      sourcePrice,
      currency: row.columns[4] ?? 0,
      unitPrice: unitSalePrice(sourcePrice),
    });
  }
  return rows;
}

/** `WorldItemShopService.quote`: quantity clamped to 1..held, total = unit x quantity. */
export function sellQuote(row: SellRow, requested: number): { quantity: number; total: number } {
  const quantity = Math.max(1, Math.min(requested, row.count));
  return { quantity, total: row.unitPrice * quantity };
}

/** `WorldItemShopService.sell`: the bag stack goes first, then the material copy; money in. */
export function sellItem(
  row: SellRow,
  requested: number,
  stock: ShopStock,
  currency: { money: number },
): boolean {
  const available = sellCount(stock, row.itemId);
  if (available <= 0) return false;
  const { quantity, total } = sellQuote({ ...row, count: available }, requested),
    bagKey = String(row.itemId),
    materialKey = String(ITEM_TABLE_MATERIAL_OFFSET + row.itemId),
    bag = Math.max(0, stock.items[bagKey] ?? 0),
    fromBag = Math.min(quantity, bag);
  if (fromBag > 0) stock.items[bagKey] = bag - fromBag;
  const fromMaterial = quantity - fromBag;
  if (fromMaterial > 0) {
    const left = (stock.materials[materialKey] ?? 0) - fromMaterial;
    if (left > 0) stock.materials[materialKey] = left;
    else delete stock.materials[materialKey];
  }
  currency.money += total;
  return true;
}

/**
 * `WorldPetRecoveryService.quote`: the cost is the largest HP gap in the party (at least 1 while a
 * pet carries a lasting debuff); -1 when nothing needs recovering.
 */
export function recoveryCost(pets: readonly SavedPet[], maxHp: (pet: SavedPet) => number): number {
  let cost = 0;
  for (const pet of pets) {
    const max = Math.max(1, maxHp(pet)),
      current = pet.currentHp === undefined || pet.currentHp < 0 ? max : pet.currentHp;
    cost = Math.max(cost, Math.max(0, max - current));
  }
  return cost === 0 ? -1 : cost;
}

export type RecoveryOutcome = "not-needed" | "insufficient" | "recovered";

/** `WorldPetRecoveryService.recover` + `PetSourceAdapter.reviveFull`: full HP and full PP. */
export function recoverParty(
  pets: SavedPet[],
  currency: { money: number },
  maxHp: (pet: SavedPet) => number,
  ppMax: (skillId: number) => number,
): RecoveryOutcome {
  const cost = recoveryCost(pets, maxHp);
  if (cost < 0) return "not-needed";
  if (currency.money < cost) return "insufficient";
  currency.money -= cost;
  for (const pet of pets) {
    pet.currentHp = maxHp(pet);
    if (pet.skillIds)
      pet.skillPp = pet.skillIds.map((id, slot) =>
        id >= 0 ? ppMax(id) : (pet.skillPp?.[slot] ?? 0),
      );
  }
  return "recovered";
}
