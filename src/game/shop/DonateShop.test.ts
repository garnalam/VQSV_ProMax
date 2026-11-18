import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BagCatalog, type BagItemsDocument } from "../inventory/Bag";
import { UnifiedItemCatalog, type UnifiedItemsDocument } from "../../data/UnifiedItems";
import { QUALITY_GUARD_MATERIAL_ID } from "../pet/QualityUpgrade";
import { donateOffers } from "./DonateShop";
import { purchaseOffer, quotePurchase, type PortableShopInventory } from "./PortableShop";
import { shopMainMenu } from "../world/CauVongShop";
import { luongForAmount } from "../../admin/donate";

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const catalog = new BagCatalog(
  read("public/pack/story/bag-items.json") as BagItemsDocument,
  new UnifiedItemCatalog(read("public/pack/items/catalog.json") as UnifiedItemsDocument),
);
const eggs = read("public/pack/story/campaign-systems.json").eggs;
const offers = donateOffers(catalog, eggs);
const wallet = (luong: number): PortableShopInventory => ({
  items: {},
  equipment: [],
  materials: {},
  specials: [],
  currency: { money: 0, badges: 0, luong },
});

describe("Shop Donate (web only, owner 2026-11-18)", () => {
  it("sells the ball for 5, the guard charm two for 20 and the V4 egg for 2 Lượng", () => {
    expect(
      offers.map((o) => [o.kind, o.inventoryId, o.unitPrice, o.pack ?? 1, o.currency]),
    ).toEqual([
      ["item", 0, 5, 1, "luong"],
      ["material", QUALITY_GUARD_MATERIAL_ID, 20, 2, "luong"],
      ["special", 11, 2, 1, "luong"],
    ]);
    expect(offers[1].iconKey).toBe("items.icons/QUALITY-GUARD-CHARM.png");
  });

  it("charges Lượng and gives the charm only in pairs", () => {
    const bag = wallet(45);
    expect(purchaseOffer(offers[1], bag, 2)).toBe("purchased");
    expect(bag.materials[String(QUALITY_GUARD_MATERIAL_ID)]).toBe(4);
    expect(bag.currency.luong).toBe(5);
    expect(purchaseOffer(offers[1], bag, 1)).toBe("insufficient");
    expect(purchaseOffer(offers[0], bag, 1)).toBe("purchased");
    expect(bag.items["0"]).toBe(1);
    expect(bag.currency.luong).toBe(0);
    // A pair never overflows the 99 stack: 98 held leaves no room for two.
    bag.materials[String(QUALITY_GUARD_MATERIAL_ID)] = 98;
    expect(quotePurchase(offers[1], bag, 1)?.maxQuantity ?? 0).toBe(0);
  });

  it("puts one V4 egg per copy in the special rewards", () => {
    const bag = wallet(6);
    expect(purchaseOffer(offers[2], bag, 3)).toBe("purchased");
    expect(bag.specials).toEqual([11, 11, 11]);
    expect(bag.currency.luong).toBe(0);
    expect(purchaseOffer(offers[2], wallet(0), 1)).toBe("insufficient");
  });

  it("lists Donate and Shop Donate at the Cầu Vồng merchant before Rời đi, never at the hall", () => {
    expect(shopMainMenu(0, true).slice(-3)).toEqual(["Donate", "Shop Donate", "Rời đi"]);
    expect(shopMainMenu(1, true).slice(-3)).toEqual(["Donate", "Shop Donate", "Rời đi"]);
    expect(shopMainMenu(3, true)).toEqual(["Mua / trao đổi", "Rời đi"]);
    expect(shopMainMenu(0)).not.toContain("Donate");
  });

  it("the admin's Lượng for a transfer: the exact rate, else the best rate below", () => {
    const rates = [
      { vnd: 10000, luong: 10 },
      { vnd: 20000, luong: 30 },
    ];
    expect(luongForAmount(rates, 20000)).toBe(30);
    expect(luongForAmount(rates, 50000)).toBe(75);
    expect(luongForAmount(rates, 15000)).toBe(15);
    expect(luongForAmount(rates, 5000)).toBe(0);
  });
});

describe("no shop sells Đại sư cầu (owner 2026-11-18)", () => {
  it("drops it from Liệt Hỏa's shopbuy and Cầu Vồng's badge exchange", async () => {
    const { stockOffers } = await import("./PortableShop");
    const { CauVongShopPanelState } = await import("../world/CauVongShop");
    const items = stockOffers(read("public/pack/story/shop-stock.json"), false);
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((o) => o.inventoryId === 3 || /đại sư cầu/i.test(o.name))).toBe(false);
    const doc = read("public/pack/cau-vong-world/shops.json");
    for (const category of [0, 1, 2]) {
      const shop = new CauVongShopPanelState();
      shop.open(category, doc);
      expect(shop.offers.some((o) => /đại sư cầu/i.test(o.name))).toBe(false);
    }
  });
});
