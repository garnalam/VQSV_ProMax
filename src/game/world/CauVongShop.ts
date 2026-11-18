import { isRetiredShopRow } from "../shop/RetiredShopItems";
import type { InputCommand } from "../../core/input/GameCommand";

/**
 * JavaSE `CauVongShopCatalog` / `CauVongShopRuntime` / `CauVongShopPanel`: the Cầu Vồng shops keep
 * their own stock and currency, separate from Liệt Hỏa's portable shop. The stock, the sale prices
 * and the mutation document are baked from Java (`cau-vong-world/shops.json`, `WebCauVongShops`).
 */
export type CauVongShopOffer = {
  /** `sourceItem`: the `CV-ITEM-0-NN` row. */
  source: number;
  price: number;
  /** Category 2 trades in badges. */
  badges: boolean;
  name: string;
  /** The unified record it resolves to. */
  key: string;
  kind: "BAG" | "MATERIAL" | "EQUIPMENT";
  runtimeId: number;
  /** An equipment row that is also a Rainbow charm (`rainbowCharms.grant`). */
  charm: boolean;
};

export type CauVongShopsDocument = {
  /** `stock(0..2, false)`: items, materials, the badge exchange. */
  stock: CauVongShopOffer[][];
  /** `mutationDocument()`: category 3's single offer. */
  mutation: CauVongShopOffer;
  /** What `sellable` can list, in source order. */
  sale: CauVongShopOffer[];
  /** The room-43 lines that replace the single offer's result. */
  mutationText: { ok: string; noMoney: string; owned: string };
};

/** `CauVongShopRuntime.Result`. */
export type CauVongShopResult =
  "OK" | "INVALID" | "FULL" | "NO_MONEY" | "NO_ITEM" | "ALREADY_OWNED";

/** What a shop reads and writes: the save's bag lists, the charms, the purse and the pets. */
export type CauVongShopPurse = {
  /** BAG rows by runtime id. */
  items: Record<string, number>;
  /** MATERIAL rows by runtime id. */
  materials: Record<string, number>;
  /** The equipment in the bag (not held by a pet). */
  equipment: number[];
  /** Equipment a roster or bank pet holds. */
  held: () => number[];
  /** `rainbowCharms.owns(id)` / `.grant(id)`. */
  ownsCharm: (id: number) => boolean;
  grantCharm: (id: number) => void;
  currency: { money: number; badges: number };
};

const MAX_COUNT = 99;

/** `count(s, item)`: Java counts an equipped piece too. */
export function shopCount(purse: CauVongShopPurse, offer: CauVongShopOffer): number {
  const id = offer.runtimeId;
  switch (offer.kind) {
    case "BAG":
      return Math.max(0, purse.items[String(id)] ?? 0);
    case "MATERIAL":
      return Math.max(0, purse.materials[String(id)] ?? 0);
    case "EQUIPMENT":
      return (
        purse.equipment.filter((e) => e === id).length + purse.held().filter((e) => e === id).length
      );
  }
}

const sameOffer = (a: CauVongShopOffer, b: CauVongShopOffer) =>
  a.source === b.source &&
  a.price === b.price &&
  a.badges === b.badges &&
  a.key === b.key &&
  a.name === b.name;

/** `validPurchase`: the single offer is the mutation document; anything else is world stock. */
function validPurchase(doc: CauVongShopsDocument, offer: CauVongShopOffer, single: boolean) {
  if (single) return sameOffer(offer, doc.mutation);
  return doc.stock.some((category) => category.some((row) => sameOffer(row, offer)));
}

/** `CauVongShopRuntime.buy`: revalidate price, capacity and balance before any write. */
export function shopBuy(
  doc: CauVongShopsDocument,
  purse: CauVongShopPurse,
  offer: CauVongShopOffer | undefined,
  qty: number,
  single: boolean,
): CauVongShopResult {
  if (!offer || qty <= 0 || qty > 99 || offer.price <= 0 || (single && qty !== 1)) return "INVALID";
  if (!validPurchase(doc, offer, single)) return "INVALID";
  const current = shopCount(purse, offer);
  if (single && current > 0) return "ALREADY_OWNED";
  // Unified equipment is one owned identity, not a stack: never charge for a copy it cannot keep.
  if (offer.kind === "EQUIPMENT") {
    if (qty !== 1) return "INVALID";
    if (current > 0 || purse.ownsCharm(offer.runtimeId)) return "ALREADY_OWNED";
  }
  if (offer.kind === "BAG") {
    // `BagInventoryEngine.canAdd`: at most 99 of a row.
    if (qty > Math.max(0, MAX_COUNT - current)) return "FULL";
  } else if (offer.kind !== "MATERIAL" && offer.kind !== "EQUIPMENT") return "INVALID";
  else if (current + qty > MAX_COUNT) return "FULL";
  const total = offer.price * qty,
    balance = offer.badges ? purse.currency.badges : purse.currency.money;
  if (total > balance) return "NO_MONEY";
  const id = String(offer.runtimeId);
  switch (offer.kind) {
    case "BAG":
      purse.items[id] = (purse.items[id] ?? 0) + qty;
      break;
    case "MATERIAL":
      purse.materials[id] = (purse.materials[id] ?? 0) + qty;
      break;
    case "EQUIPMENT":
      purse.equipment.push(offer.runtimeId);
      if (offer.charm) purse.grantCharm(offer.runtimeId);
      break;
  }
  // `sourceAdjustCurrencyFloorZero`.
  if (offer.badges) purse.currency.badges = Math.max(0, purse.currency.badges - total);
  else purse.currency.money = Math.max(0, purse.currency.money - total);
  return "OK";
}

/** `sellable`: every sale row the purse holds, in source order. */
export function shopSellable(
  doc: CauVongShopsDocument,
  purse: CauVongShopPurse,
): CauVongShopOffer[] {
  return doc.sale.filter((offer) => shopCount(purse, offer) > 0);
}

/** `CauVongShopRuntime.sell`: never silently unequips a piece a pet holds. */
export function shopSell(
  doc: CauVongShopsDocument,
  purse: CauVongShopPurse,
  offer: CauVongShopOffer | undefined,
  qty: number,
): CauVongShopResult {
  const sale = offer ? doc.sale.find((row) => row.source === offer.source) : undefined;
  if (!offer || qty <= 0 || qty > 99 || !sale || offer.price !== sale.price || offer.price <= 0)
    return "INVALID";
  if (shopCount(purse, offer) < qty) return "NO_ITEM";
  if (purse.currency.money + qty * offer.price > 2147483647) return "INVALID";
  const id = String(offer.runtimeId);
  if (offer.kind === "EQUIPMENT") {
    const available = purse.equipment.filter((e) => e === offer.runtimeId).length;
    if (available < qty || purse.held().includes(offer.runtimeId)) return "NO_ITEM";
    for (let i = 0; i < qty; i++)
      purse.equipment.splice(purse.equipment.indexOf(offer.runtimeId), 1);
  } else if (offer.kind === "MATERIAL") {
    purse.materials[id] = Math.max(0, (purse.materials[id] ?? 0) - qty);
    if (purse.materials[id] === 0) delete purse.materials[id];
  } else if (offer.kind === "BAG") {
    purse.items[id] = Math.max(0, (purse.items[id] ?? 0) - qty);
    if (purse.items[id] === 0) delete purse.items[id];
  } else return "INVALID";
  purse.currency.money += qty * offer.price;
  return "OK";
}

/** The four titles `render` draws. */
export const shopTitle = (category: number) =>
  category === 3
    ? "THƯƠNG NHÂN DỊ HÓA"
    : category === 2
      ? "ĐỔI HUY HIỆU"
      : category === 1
        ? "NGUYÊN LIỆU CẦU VỒNG"
        : "CỬA HÀNG CẦU VỒNG";
/** `render`'s main menu. */
/**
 * Web-only (owner 2026-11-15): a Cầu Vồng merchant also keeps the pet bank, so a pet can be
 * deposited without the trip back to Liệt Hỏa. The mutation document's counter (category 3) does not.
 */
export const SHOP_PET_BANK_ROW = "Ngân hàng sủng vật";
const SHOP_SELL_ROW = "Bán vật phẩm";
/** Web only (owner 2026-11-18): the "Ủng hộ" panel and the Shop Donate, for an online account. */
export const SHOP_DONATE_ROW = "Donate";
export const SHOP_DONATE_SHOP_ROW = "Shop Donate";
export const shopMainMenu = (category: number, donate = false): string[] => {
  const extra = donate ? [SHOP_DONATE_ROW, SHOP_DONATE_SHOP_ROW] : [];
  return category === 0
    ? ["Mua vật phẩm", SHOP_SELL_ROW, SHOP_PET_BANK_ROW, ...extra, "Rời đi"]
    : category === 3
      ? ["Mua / trao đổi", "Rời đi"]
      : ["Mua / trao đổi", SHOP_PET_BANK_ROW, ...extra, "Rời đi"];
};

/** What the panel reads from the world while it is open. */
export type CauVongShopSource = {
  doc: () => CauVongShopsDocument | undefined;
  purse: () => CauVongShopPurse | undefined;
  /** The room the shop was opened in (43 swaps the single offer's message for its own lines). */
  room: () => number;
};

/**
 * `CauVongShopPanel`'s state machine: menu 0 (buy / sell / leave), menu 1 (the offers), menu 2
 * (the quantity). Back steps out one menu; Back on the main menu closes.
 */
export class CauVongShopPanelState {
  category = 0;
  menu = 0;
  selected = 0;
  scroll = 0;
  qty = 1;
  single = false;
  selling = false;
  message = "";
  offers: CauVongShopOffer[] = [];
  /** Set when the panel closed on the pet bank row: the host opens the bank in its place. */
  bankRequested = false;
  /** Web only: the Donate rows are listed (an online account). */
  donate = false;
  /** Web only: the Donate row asked for the "Ủng hộ" panel; the shop stays open under it. */
  supportRequested = false;
  /** Web only: the panel closed on the Shop Donate row: the host opens it in its place. */
  donateShopRequested = false;

  open(category: number, doc: CauVongShopsDocument | undefined, donate = false): void {
    this.category = category;
    this.donate = donate;
    this.supportRequested = false;
    this.donateShopRequested = false;
    this.single = category === 3;
    this.selling = false;
    this.offers = this.buyOffers(doc);
    this.menu = 0;
    this.selected = 0;
    this.scroll = 0;
    this.qty = 1;
    this.message = "";
    this.bankRequested = false;
  }
  private buyOffers(doc: CauVongShopsDocument | undefined): CauVongShopOffer[] {
    if (!doc) return [];
    return this.single
      ? [doc.mutation]
      : (doc.stock[this.category] ?? []).filter(
          (row) => !isRetiredShopRow({ kind: row.kind, name: row.name, id: row.runtimeId }),
        );
  }
  /** Rows of the current list (the main menu's, or the offers). */
  get size(): number {
    return this.menu === 0 ? shopMainMenu(this.category, this.donate).length : this.offers.length;
  }

  /** `tick`: true once the panel closes. */
  tick(pressed: readonly InputCommand[], source: CauVongShopSource): boolean {
    const doc = source.doc(),
      purse = source.purse();
    if (pressed.includes("back")) {
      if (this.menu === 2) this.menu = 1;
      else if (this.menu === 1) {
        this.menu = 0;
        this.selected = 0;
        this.scroll = 0;
      } else return true;
    } else if (this.menu === 2) {
      const row = this.offers[this.selected];
      if (pressed.includes("left") || pressed.includes("down"))
        this.qty = Math.max(1, this.qty - 1);
      else if (pressed.includes("right") || pressed.includes("up"))
        this.qty = Math.min(this.single || row?.kind === "EQUIPMENT" ? 1 : 99, this.qty + 1);
      else if (pressed.includes("confirm") && doc && purse) {
        const result = this.selling
          ? shopSell(doc, purse, row, this.qty)
          : shopBuy(doc, purse, row, this.qty, this.single);
        this.message = this.resultMessage(result, row?.name ?? "");
        if (this.single && source.room() === 43) {
          const text =
            result === "OK"
              ? doc.mutationText.ok
              : result === "NO_MONEY"
                ? doc.mutationText.noMoney
                : result === "ALREADY_OWNED"
                  ? doc.mutationText.owned
                  : null;
          if (text !== null) this.message = text;
        }
        this.menu = 1;
        if (this.selling) {
          this.offers = shopSellable(doc, purse);
          this.selected = Math.min(this.selected, Math.max(0, this.offers.length - 1));
        }
      }
    } else {
      const size = this.size;
      if (size > 0) {
        if (pressed.includes("up")) this.selected = (((this.selected - 1) % size) + size) % size;
        else if (pressed.includes("down")) this.selected = (this.selected + 1) % size;
        else if (pressed.includes("confirm")) {
          if (this.menu === 0) {
            if (this.selected === size - 1) return true;
            const row = shopMainMenu(this.category, this.donate)[this.selected];
            if (row === SHOP_PET_BANK_ROW) {
              this.bankRequested = true;
              return true;
            }
            if (row === SHOP_DONATE_ROW) {
              this.supportRequested = true;
              return false;
            }
            if (row === SHOP_DONATE_SHOP_ROW) {
              this.donateShopRequested = true;
              return true;
            }
            this.selling = row === SHOP_SELL_ROW;
            this.offers =
              this.selling && doc && purse ? shopSellable(doc, purse) : this.buyOffers(doc);
            this.selected = 0;
            this.scroll = 0;
            this.menu = 1;
          } else {
            this.menu = 2;
            this.qty = 1;
          }
        }
      }
    }
    if (this.selected < this.scroll) this.scroll = this.selected;
    if (this.selected >= this.scroll + 7) this.scroll = this.selected - 6;
    return false;
  }
  private resultMessage(result: CauVongShopResult, name: string): string {
    switch (result) {
      case "OK":
        return `${this.selling ? "Đã bán " : "Đã mua "}${this.qty} ${name}`;
      case "NO_MONEY":
        return this.category === 2
          ? "Chưa đủ huy hiệu. Không mua gì."
          : "Chưa đủ kim tiền. Không mua gì.";
      case "ALREADY_OWNED":
        return this.single
          ? "Bạn đã có tài liệu. Dùng hết rồi quay lại."
          : "Bạn đã sở hữu trang bị này. Không trừ tiền.";
      case "FULL":
        return "Vật phẩm đã đầy. Không trừ tiền.";
      case "NO_ITEM":
        return "Thiếu vật phẩm hoặc đang trang bị.";
      default:
        return "Giao dịch không hợp lệ. Chưa thay đổi gì.";
    }
  }

  /** `click`: the softkeys, the quantity arrows and confirm box, or a row (select and confirm). */
  click(x: number, y: number): InputCommand[] {
    if (y >= 296) return [x < 120 ? "confirm" : "back"];
    if (this.menu === 2) {
      if (y >= 145 && y < 179) {
        if (x < 100) return ["left"];
        if (x >= 140) return ["right"];
      }
      return y >= 195 && y < 224 ? ["confirm"] : [];
    }
    const row = this.scroll + Math.floor((y - 48) / 25);
    if (x >= 10 && x < 230 && y >= 48 && y < 223 && row < this.size) {
      this.selected = row;
      return ["confirm"];
    }
    return [];
  }
}
