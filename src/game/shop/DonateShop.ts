import type { BagCatalog } from "../inventory/Bag";
import { QUALITY_GUARD_MATERIAL_ID } from "../pet/QualityUpgrade";
import type { PortableShopOffer } from "./PortableShop";

/**
 * Web only (owner, 2026-11-18): "Shop Donate", sold for Lượng (the supporters' thank-you currency)
 * at the Liệt Hỏa item merchants and the Cầu Vồng merchants, in the same `shopbuy` list as the
 * other counters. The guard charm is sold two at a time only.
 */
export const DONATE_SHOP_TITLE = "SHOP DONATE";
/** The source currency code the price pills draw: 0 money, 1 badges, 2 free, 3 Lượng. */
export const LUONG_CURRENCY_CODE = 3;

const TAT_TRUNG_CAU_ID = 0;
const EGG_V4_ID = 11;

type EggRow = { itemId: number; name: string; description: string; iconCell: number };

/** The three offers, in stock order; a row whose item the catalog lacks is left out. */
export function donateOffers(
  catalog: BagCatalog | undefined,
  eggs: readonly EggRow[] = [],
): PortableShopOffer[] {
  const offers: PortableShopOffer[] = [];
  const ball = catalog?.bagItem(TAT_TRUNG_CAU_ID);
  if (ball)
    offers.push({
      id: 0,
      inventoryId: TAT_TRUNG_CAU_ID,
      kind: "item",
      name: ball.name,
      icon: ball.icon,
      description: ball.description,
      unitPrice: 5,
      currency: "luong",
      currencyCode: LUONG_CURRENCY_CODE,
    });
  const guard = catalog?.material(QUALITY_GUARD_MATERIAL_ID);
  if (guard)
    offers.push({
      id: 1,
      inventoryId: QUALITY_GUARD_MATERIAL_ID,
      kind: "material",
      name: `${guard.name} (gói 2 cái)`,
      icon: guard.icon,
      iconKey: guard.iconKey,
      description: guard.description,
      unitPrice: 20,
      pack: 2,
      currency: "luong",
      currencyCode: LUONG_CURRENCY_CODE,
    });
  const egg = eggs.find((row) => row.itemId === EGG_V4_ID);
  if (egg)
    offers.push({
      id: 2,
      inventoryId: EGG_V4_ID,
      kind: "special",
      name: egg.name,
      icon: egg.iconCell,
      description: egg.description,
      unitPrice: 2,
      currency: "luong",
      currencyCode: LUONG_CURRENCY_CODE,
    });
  return offers;
}
