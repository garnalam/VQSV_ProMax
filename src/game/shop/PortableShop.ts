import { isRetiredShopRow } from "./RetiredShopItems";
/** `special` (web only): a special reward such as an egg, which the save keeps one id per copy. */
export type ShopKind = "item" | "material" | "equipment" | "special";
/** `luong` (web only): "Lượng", the Shop Donate's currency. */
export type ShopCurrency = "money" | "badges" | "luong";

export type PortableShopOffer = {
  id: number;
  inventoryId: number;
  kind: ShopKind;
  name: string;
  icon: number;
  description: string;
  unitPrice: number;
  currency: ShopCurrency;
  /** `shop-icons.<n>` when the row draws a unified icon. */
  unifiedIcon?: number | null;
  /** The source currency code (0 money, 1 badges, 2 free, 3 Lượng) the price pill draws. */
  currencyCode?: number;
  /** Web only: a unified record's own icon (pack key), drawn instead of `icon`. */
  iconKey?: string;
  /** Web only: copies one purchase gives; the price and the quantity count packs. */
  pack?: number;
};

export type PortableShopInventory = {
  items: Record<string, number>;
  equipment: number[];
  materials: Record<string, number>;
  currency: { money: number; badges: number; luong?: number };
  /** Web only: the special rewards, one id per copy (eggs...). */
  specials?: number[];
};

export type PurchaseQuote = {
  outcome: "ready" | "full";
  quantity: number;
  maxQuantity: number;
  total: number;
  currentCount: number;
};

/** One row of `story/shop-stock.json` (`ExportWebShopStock`). */
export type ShopStockRow = {
  index: number;
  kind: "BAG_ITEM" | "MATERIAL" | "EQUIPMENT";
  inventoryId: number;
  name: string;
  description: string;
  iconCell: number;
  /** `shop-icons.<n>`: the unified icon, null for a sheet-258 cell. */
  icon: number | null;
  /** `portableShopPrice`: already the unit price (ordinary money items at 150%, currency 2 free). */
  price: number;
  currency: number;
};
export type ShopStockDocument = {
  profileVersion: string;
  item: ShopStockRow[];
  material: ShopStockRow[];
};

/**
 * `portableShopSourceItem` for table 4 / bucket 0 (`material` false: "THƯƠNG ĐIẾM BÌNH DÂN") or
 * table 3 / bucket 2 ("CỬA HÀNG TÀI LIỆU"), as JavaSE lists them.
 */
export function stockOffers(doc: ShopStockDocument, material: boolean): PortableShopOffer[] {
  return (material ? doc.material : doc.item)
    .filter((row) => !isRetiredShopRow({ kind: row.kind, name: row.name, id: row.inventoryId }))
    .map((row) => ({
      id: row.index,
      inventoryId: row.inventoryId,
      kind: row.kind === "BAG_ITEM" ? "item" : row.kind === "MATERIAL" ? "material" : "equipment",
      name: row.name,
      icon: row.iconCell,
      unifiedIcon: row.icon,
      description: row.description,
      unitPrice: row.price,
      currency: row.currency === 1 ? "badges" : "money",
      currencyCode: row.currency,
    }));
}

/** A stack's cap: 99 of a bag item, a material or a special reward. */
const STACK_MAX = 99;

export function shopCount(offer: PortableShopOffer, inventory: PortableShopInventory): number {
  if (offer.kind === "equipment") return inventory.equipment.includes(offer.inventoryId) ? 1 : 0;
  if (offer.kind === "special")
    return (inventory.specials ?? []).filter((id) => id === offer.inventoryId).length;
  const record = offer.kind === "material" ? inventory.materials : inventory.items;
  return Math.max(0, record[String(offer.inventoryId)] ?? 0);
}

export function quotePurchase(
  offer: PortableShopOffer,
  inventory: PortableShopInventory,
  requestedQuantity: number,
): PurchaseQuote {
  const currentCount = shopCount(offer, inventory),
    pack = Math.max(1, offer.pack ?? 1),
    maxQuantity =
      offer.kind === "equipment"
        ? currentCount > 0
          ? 0
          : 1
        : Math.max(0, Math.floor((STACK_MAX - currentCount) / pack));
  if (maxQuantity === 0)
    return { outcome: "full", quantity: 0, maxQuantity, total: 0, currentCount };
  const quantity = Math.max(1, Math.min(Math.trunc(requestedQuantity) || 1, maxQuantity));
  return {
    outcome: "ready",
    quantity,
    maxQuantity,
    total: offer.unitPrice * quantity,
    currentCount,
  };
}

export type PurchaseResult = "purchased" | "full" | "insufficient";

/** Atomic JavaSE-style commit: re-quote, pay, then add to the correct bag channel. */
export function purchaseOffer(
  offer: PortableShopOffer,
  inventory: PortableShopInventory,
  requestedQuantity: number,
): PurchaseResult {
  const quote = quotePurchase(offer, inventory, requestedQuantity);
  if (quote.outcome === "full") return "full";
  if (offer.kind === "special" && !inventory.specials) return "full";
  if ((inventory.currency[offer.currency] ?? 0) < quote.total) return "insufficient";
  inventory.currency[offer.currency] = (inventory.currency[offer.currency] ?? 0) - quote.total;
  const copies = quote.quantity * Math.max(1, offer.pack ?? 1);
  if (offer.kind === "equipment") inventory.equipment.push(offer.inventoryId);
  else if (offer.kind === "special")
    for (let i = 0; i < copies; i++) inventory.specials!.push(offer.inventoryId);
  else {
    const record = offer.kind === "material" ? inventory.materials : inventory.items,
      key = String(offer.inventoryId);
    record[key] = (record[key] ?? 0) + copies;
  }
  return "purchased";
}
