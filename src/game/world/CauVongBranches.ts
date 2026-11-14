// JavaSE parity: the rest of `CauVongMissingBranchesRuntime` (CV2's Đông Phương, the café, the
// hatchery helper and the hub's first lift are in CauVongPrep.ts):
//   67  the aux room under the North Sea's office (27): Nhất Hôi's request (67:0, 67:1), the pet 189
//       he wants to see (67:2), the passage it opens (67:3), the lift up to the Thiên Không hub
//       (menu 4, tile 13,7), Tiểu Mỹ's notice (67:6) and her trade of the quest scroll for the egg of
//       source 66 (menu 5, receipt 67:824003), the residents' lines and the native doors back to 27;
//   50  the hub's lift down to 67 once 67:3 is set (menu 7, tile 1,28), after the café lift;
//   43  the scroll clerk while Tiểu Mỹ waits (67:6, no 67:824003): the quest scroll for 7 badges or
//       the scroll shop (menu 8);
//   and `CauVongBranchTreasures`, every room's source treasure table: a floor chest that blocks its
//   tile, opens on 5 when faced within 32 px (receipt 832000 + row) and grants money, badges or an
//   item, or keeps the chest shut when the purse or the bag is full.
// `tick`'s head: a menu left open (its 822000+owner marker), then a started part. Everything is
// baked by rebuild_game/tools/WebCauVongBranches.java into branches.json, checked against Java.
import type { CauVongCue, CauVongPart } from "./CauVongCutscene";
import type { FourGatesAction } from "./CauVongFourGates";
import type { CityItem, CityWorld } from "./CauVongCity";

type Say = Extract<CauVongCue, { k: "say" }>;
export type BranchReward =
  | { kind: "money" | "badges"; qty: number }
  | { kind: "item"; item: CityItem; qty: number }
  | { kind: "omitted" };
/** A `treasureTable` row: tile, state (-1 hidden, 1 shut, 2 open), reward, `grant`'s line. */
export type BranchTreasure = {
  x: number;
  y: number;
  state: number;
  reward: BranchReward;
  line: string | null;
};
export type CauVongBranchesDocument = {
  parts: Record<string, CauVongPart>;
  cast: Record<string, CauVongCue[]>;
  /** `choose(owner)`'s options, by owner (4, 5, 7, 8). */
  menus: Record<string, string[]>;
  lines: { bought: Say; notBought: Say; tradeRefused: Say; clerk: Say };
  aux: {
    /** Source actors 2 (Nhất Hôi) and 4 (Tiểu Mỹ) of 67, the scroll clerk of 43. */
    guide: number;
    mei: number;
    clerk: number;
    wanted: number;
    badges: number;
    receipt: number;
    scroll: CityItem;
    egg: CityItem;
    /** `passive(s, 67, row)`. */
    rows: Record<string, Say>;
    passives: { actorId: number; say: Say }[];
    /** `extraDoors`: [tileX, tileY, target, x, y, dir]. */
    doors: [number, number, number, number, number, number][];
  };
  treasures: Record<string, BranchTreasure[]>;
  treasureLines: {
    opened: string;
    full: string;
    moneyCap: string;
    badgeCap: string;
    omitted: string | null;
  };
  treasureReceipt: number;
};

export const AUX_ROOM = 67;
export const BRANCH_PREFIX = "branch:";
/** Menu owners: 200 + `choose`'s owner. */
export const BRANCH_MENU_BASE = 200;
const HUB = 50,
  SCROLL_SHOP = 43,
  MENU_FLAG = 822000;
const INT_MAX = 2147483647;
/** `CauVongBranchTreasures.FLOOR`: the chest's footprint below its foot. */
export const TREASURE_FLOOR: [number, number, number, number] = [-10, -20, 20, 20];

/** What these owners read beyond the side rooms' world. */
export interface BranchWorld extends CityWorld {
  /** `hasPet`: in the roster or the bank. */
  ownsPet(species: number): boolean;
  badges(): number;
  spendBadges(n: number): void;
  money(): number;
  earn(money: number): void;
  earnBadges(n: number): void;
  /** `sourceCanAddItem`: the bag takes `qty` more of a BAG row. */
  bagFits(item: CityItem, qty: number): boolean;
}

/** `CauVongMissingBranchesRuntime` in 67, 50 and 43, and `CauVongBranchTreasures`. */
export class BranchesOwner {
  constructor(private readonly doc: CauVongBranchesDocument) {}

  owns(name: string): boolean {
    return name.startsWith(BRANCH_PREFIX);
  }
  private part(name: string, clear = false): FourGatesAction {
    return { kind: "part", name: BRANCH_PREFIX + name, part: this.doc.parts[name], clear };
  }
  private finished(w: BranchWorld, name: string): boolean {
    const p = this.doc.parts[name];
    return w.done(p.room, p.flag);
  }
  private text(...steps: Say[]): FourGatesAction {
    return { kind: "text", steps };
  }
  private reply(name: string): FourGatesAction {
    return this.text(...(this.doc.parts[name].steps as Say[]));
  }
  /** `choose(owner)`: the durable marker first, then the menu. */
  private choose(w: BranchWorld, room: number, owner: number): FourGatesAction {
    w.mark(room, MENU_FLAG + owner);
    return {
      kind: "menu",
      owner: BRANCH_MENU_BASE + owner,
      options: this.doc.menus[String(owner)],
    };
  }
  private tiles(w: BranchWorld, x: number, y: number, x2: number, y2: number): boolean {
    return w.point(x * 20, y * 20, (x2 - x + 1) * 20, (y2 - y + 1) * 20);
  }

  /** The rooms these parts and menus live in. */
  handles(room: number): boolean {
    return room === AUX_ROOM || room === HUB || room === SCROLL_SHOP;
  }

  /**
   * `tick`: the menu left open (the offer's and the clerk's come up here once their line is read),
   * a started part, the faced chest, then the room's own triggers.
   */
  tick(w: BranchWorld, room: number): FourGatesAction {
    for (const owner of [4, 5, 7, 8])
      if (w.done(room, MENU_FLAG + owner)) return this.choose(w, room, owner);
    for (const [name, p] of Object.entries(this.doc.parts))
      if (p.room === room && p.started >= 0 && w.done(room, p.started) && !w.done(room, p.flag))
        return this.part(name);
    const chest = this.interact(w, room);
    if (chest) return chest;
    const aux = this.doc.aux,
      done = (r: number, e: number) => w.done(r, e);
    if (room === AUX_ROOM) {
      if (!done(67, 0) && this.tiles(w, 17, 12, 20, 13)) return this.part("AUX_INTRO");
      if (w.requested(aux.guide)) {
        if (!done(67, 0)) return this.part("AUX_INTRO");
        if (!done(67, 1)) return this.part("AUX_REQUEST");
        if (!done(67, 2) && w.ownsPet(aux.wanted)) return this.part("AUX_SHOW");
        if (!done(67, 2)) return this.reply("AUX_REQUEST_REPLY");
        return this.text(aux.rows["1"]);
      }
      if (!done(67, 3) && this.tiles(w, 10, 5, 16, 9)) return this.part("AUX_OPEN");
      if (done(67, 3) && this.tiles(w, 13, 7, 13, 7) && w.confirm) return this.choose(w, 67, 4);
      if (w.requested(aux.mei)) {
        if (done(67, aux.receipt)) return this.text(aux.rows["3"]);
        if (!done(67, 6)) return this.part("SCROLL_NOTICE");
        if (w.stock(aux.scroll) > 0) {
          // `offer`: the marker first, the offer read again, then menu 5.
          w.mark(67, MENU_FLAG + 5);
          return this.reply("SCROLL_OFFER_REPLY");
        }
        return this.reply("SCROLL_NOTICE_REPLY");
      }
    }
    if (room === HUB && done(67, 3) && this.tiles(w, 1, 28, 1, 28) && w.confirm)
      return this.choose(w, HUB, 7);
    if (room === SCROLL_SHOP && done(67, 6) && !done(67, aux.receipt) && w.requested(aux.clerk)) {
      w.mark(SCROLL_SHOP, MENU_FLAG + 8);
      return this.text(this.doc.lines.clerk);
    }
    return null;
  }

  /** `passives(67)`: the residents, after `extraDoors`. */
  residents(w: BranchWorld, room: number): FourGatesAction {
    if (room !== AUX_ROOM) return null;
    for (const npc of this.doc.aux.passives)
      if (w.requested(npc.actorId)) return this.text(npc.say);
    return null;
  }

  /** `choice`: the answer, its marker cleared first. */
  answer(w: BranchWorld, owner: number, selected: number, room: number): FourGatesAction {
    const m = owner - BRANCH_MENU_BASE;
    w.clear(room, MENU_FLAG + m);
    if (m === 8) {
      if (selected === 2) return null;
      if (selected === 0)
        return this.text(this.buyQuestScroll(w) ? this.doc.lines.bought : this.doc.lines.notBought);
      return { kind: "shop", category: 2 };
    }
    const names: Record<number, [string, string]> = {
      4: ["AUX_UP", "AUX_STAY"],
      5: ["SCROLL_TRADE", "SCROLL_DECLINE"],
      7: ["HUB_AUX_DOWN", "HUB_AUX_STAY"],
    };
    const pair = names[m];
    if (!pair) return null;
    const name = pair[selected === 0 ? 0 : 1];
    if (name === "SCROLL_TRADE" && !this.tradeScroll(w))
      return this.text(this.doc.lines.tradeRefused);
    if (this.finished(w, name)) {
      // Reusable lifts replay their movements, never their old checkpoint; the trade reads again.
      if (m !== 5) return this.part(name, true);
      return this.reply(`${name}_REPLY`);
    }
    return this.part(name);
  }

  /** `after(p)`: the flags each part leaves, and the lifts' arrivals. */
  after(w: BranchWorld, name: string): FourGatesAction {
    const exit = (room: number, tx: number, ty: number, dir: number): FourGatesAction => ({
      kind: "exit",
      room,
      x: tx * 20 + 10,
      y: ty * 20 + 19,
      dir,
    });
    switch (name.slice(BRANCH_PREFIX.length)) {
      case "AUX_INTRO":
        w.mark(67, 0);
        return null;
      case "AUX_REQUEST":
        w.mark(67, 1);
        return null;
      case "AUX_SHOW":
        w.mark(67, 2);
        return null;
      case "AUX_OPEN":
        w.mark(67, 3);
        return null;
      case "AUX_UP":
        return exit(HUB, 1, 27, 2);
      case "SCROLL_NOTICE":
        w.mark(67, 6);
        return null;
      case "SCROLL_TRADE":
        w.mark(67, 7);
        return null;
      case "HUB_AUX_DOWN":
        w.mark(HUB, 4);
        w.mark(67, 5);
        return exit(AUX_ROOM, 13, 8, 0);
      default:
        return null;
    }
  }

  /** `buyQuestScroll`: 7 badges for the quest-only scroll, when the bag takes it. */
  private buyQuestScroll(w: BranchWorld): boolean {
    const aux = this.doc.aux;
    if (w.badges() < aux.badges || !w.bagFits(aux.scroll, 1)) return false;
    w.give(aux.scroll, 1);
    w.spendBadges(aux.badges);
    return true;
  }
  /** `tradeScroll`: the scroll for the egg of source 66, once (its receipt). */
  private tradeScroll(w: BranchWorld): boolean {
    const aux = this.doc.aux;
    if (w.done(67, aux.receipt)) return true;
    if (w.stock(aux.scroll) < 1 || w.stock(aux.egg) >= 99) return false;
    w.take(aux.scroll, 1);
    w.give(aux.egg, 1);
    w.mark(67, aux.receipt);
    return true;
  }

  /** `extraDoors` in 67: the native doors back to 27 (a facade tile from the floor beside it). */
  exit(w: BranchWorld, room: number): FourGatesAction {
    if (room !== AUX_ROOM) return null;
    const facing = w.hero().direction;
    for (const [tx, ty, target, x, y, dir] of this.doc.aux.doors) {
      let at = this.tiles(w, tx, ty, tx, ty);
      if (!at && w.terrain(tx * 20 + 10, ty * 20 + 19) === 1)
        for (const [ax, ay, face] of [
          [0, 1, 2],
          [0, -1, 0],
          [-1, 0, 1],
          [1, 0, 3],
        ])
          if (facing === face && this.tiles(w, tx + ax, ty + ay, tx + ax, ty + ay)) at = true;
      if (at) return { kind: "exit", room: target, x, y, dir };
    }
    return null;
  }

  /** `applyCast`: every finished part of the room restores its cast. */
  cast(room: number, done: (room: number, event: number) => boolean): CauVongCue[] {
    const cues: CauVongCue[] = [];
    for (const [name, p] of Object.entries(this.doc.parts))
      if (p.room === room && p.flag >= 0 && done(room, p.flag))
        cues.push(...(this.doc.cast[name] ?? []));
    return cues;
  }

  // --- CauVongBranchTreasures ---

  treasures(room: number): BranchTreasure[] {
    return this.doc.treasures[String(room)] ?? [];
  }
  /** `opened(row)`. */
  opened(room: number, row: number, done: (room: number, event: number) => boolean): boolean {
    return done(room, this.doc.treasureReceipt + row);
  }
  /** `interact`: the shown chest faced within 32 px (12 across) on 5, granted. */
  interact(w: BranchWorld, room: number): FourGatesAction {
    if (!w.confirm) return null;
    const hero = w.hero(),
      table = this.treasures(room);
    for (let row = 0; row < table.length; row++) {
      const t = table[row];
      if (t.state === -1) continue;
      const dx = t.x * 20 + 10 - hero.x,
        dy = t.y * 20 + 20 - hero.y;
      const near =
        hero.direction === 0
          ? dy >= 0 && dy <= 32 && Math.abs(dx) <= 12
          : hero.direction === 2
            ? dy <= 0 && dy >= -32 && Math.abs(dx) <= 12
            : hero.direction === 1
              ? dx >= 0 && dx <= 32 && Math.abs(dy) <= 12
              : hero.direction === 3
                ? dx <= 0 && dx >= -32 && Math.abs(dy) <= 12
                : false;
      if (near)
        return this.text({ k: "say", speaker: "", text: this.grant(w, room, row), portrait: -1 });
    }
    return null;
  }
  /** `grant(row)`: the reward and its receipt, or why the chest stays shut. */
  private grant(w: BranchWorld, room: number, row: number): string {
    const t = this.treasures(room)[row],
      lines = this.doc.treasureLines,
      receipt = this.doc.treasureReceipt + row;
    if (w.done(room, receipt) || t.state === 2) return lines.opened;
    const r = t.reward;
    if (r.kind === "money") {
      if (r.qty > INT_MAX - w.money()) return lines.moneyCap;
      w.earn(r.qty);
    } else if (r.kind === "badges") {
      if (r.qty > INT_MAX - w.badges()) return lines.badgeCap;
      w.earnBadges(r.qty);
    } else if (r.kind === "item") {
      if (r.item.kind === "BAG" && !w.bagFits(r.item, r.qty)) return lines.full;
      w.give(r.item, r.qty);
    }
    w.mark(room, receipt);
    return t.line ?? lines.opened;
  }
}
