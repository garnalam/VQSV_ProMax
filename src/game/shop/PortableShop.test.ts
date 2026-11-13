import { describe, expect, it } from "vitest";
import {
  purchaseOffer,
  quotePurchase,
  type PortableShopInventory,
  type PortableShopOffer,
} from "./PortableShop";

const offer: PortableShopOffer = {
  id: 2,
  inventoryId: 2,
  kind: "item",
  name: "Thuốc",
  icon: 0,
  description: "",
  unitPrice: 150,
  currency: "money",
};
const inventory = (): PortableShopInventory => ({
  items: {},
  equipment: [],
  materials: {},
  currency: { money: 500, badges: 2 },
});

describe("PortableShop", () => {
  it("clamps a stack to JavaSE's 99 item capacity", () => {
    const bag = inventory();
    bag.items["2"] = 98;
    expect(quotePurchase(offer, bag, 5)).toMatchObject({ quantity: 1, maxQuantity: 1, total: 150 });
  });

  it("does not mutate anything when currency is insufficient", () => {
    const bag = inventory();
    bag.currency.money = 149;
    expect(purchaseOffer(offer, bag, 1)).toBe("insufficient");
    expect(bag).toEqual({
      items: {},
      equipment: [],
      materials: {},
      currency: { money: 149, badges: 2 },
    });
  });

  it("pays and updates the bag atomically", () => {
    const bag = inventory();
    expect(purchaseOffer(offer, bag, 2)).toBe("purchased");
    expect(bag.currency.money).toBe(200);
    expect(bag.items["2"]).toBe(2);
  });

  it("only permits one copy of equipment", () => {
    const gear = {
      ...offer,
      kind: "equipment" as const,
      currency: "badges" as const,
      unitPrice: 1,
    };
    const bag = inventory();
    expect(purchaseOffer(gear, bag, 99)).toBe("purchased");
    expect(purchaseOffer(gear, bag, 1)).toBe("full");
    expect(bag.equipment).toEqual([2]);
    expect(bag.currency.badges).toBe(1);
  });
});
