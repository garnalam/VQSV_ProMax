// JavaSE parity: the city's side rooms (98:45, 98:46, 98:56) as `CauVongChapterRuntime` runs them
// from the city (1): `citySideEntrance` (the doors into 56, 45, 47, 44 and 46), `tickSideRoom` and
// `sideRoomExit`, with `CauVongOpeningSideQuests` ahead of the residents:
//   46  Lisa's mutation research: the request (46:137/138), the offer menu, the accepted scene
//       (46:120, 145/146), a Mạn Đà La of level 85 with 1 + 2 materials (46:121, 122), the document
//       for the Mộc pet (46:123, 124);
//   56  the shop's gift once 1:100 is set (2 + 2 items, 56:123/124), then the five clerks: items
//       (with the farewell after the shop), the pet bank, badges, materials and mutation documents;
//   45  the rooftop's merchant (source 17) and the residents' own lines.
// 45 and 56 are the city's only while the North Sea has not marked them (`sharedRoomActive`).
// Everything is baked by rebuild_game/tools/WebCauVongCity.java into city.json, checked against Java.
// The web's Cầu Vồng shop stands in for `openSourceWorldShopFromWorld(4, 0)` as in the campus shop.
import type { CauVongCue, CauVongPart, CauVongPetCue } from "./CauVongCutscene";
import type { FourGatesAction } from "./CauVongFourGates";
import type { NorthSeaWorld } from "./CauVongNorthSea";
import { CAFE_ROOM, cauVongCafeArrival } from "./CauVongPrep";

type Say = Extract<CauVongCue, { k: "say" }>;
export type CityItem = {
  id: number;
  kind: "BAG" | "MATERIAL" | "SPECIAL" | "EQUIPMENT";
  name: string;
  /** Quest-only rows carry their bag description. */
  description?: string;
};
type Rect = [number, number, number, number];

export type CauVongCityDocument = {
  parts: Record<string, CauVongPart>;
  cast: Record<string, CauVongCue[]>;
  lisa: {
    actor: number;
    trade: { species: number; level: number };
    materials: { item: CityItem; qty: number }[];
    document: CityItem;
    reward: CauVongPetCue;
    flags: {
      accepted: number;
      acceptedScene: number;
      traded: number;
      rewarded: number;
      requestStarted: number;
      requestSeen: number;
    };
    accept: string[];
    give: string[];
    /** "Giao pet ô {slot} — cấp {level}, {quality} sao". */
    petOption: string;
    keep: string;
    changed: Say;
    short: Say;
    noRoom: Say;
  };
  shopGift: {
    actor: number;
    opens: [number, number];
    flag: number;
    items: { item: CityItem; qty: number }[];
  };
  /** `applyNpcVisuals`: the merchants 13..15 of 56, shown once any [room, event] is done. */
  merchants: { actors: number[]; after: [number, number][] };
  residents: Record<string, { actorId: number; row: number; role: string; say?: Say }[]>;
  /** `citySideEntrance`: [x, y, w, h, room, x, y]. */
  entrances: [number, number, number, number, number, number, number][];
  /** `sideRoomExit`: [x, y, w, h, city x, city y], by room. */
  exits: Record<string, [...Rect, number, number]>;
};

export const CITY_SIDE_ROOMS = [45, 46, 56] as const;
export const CITY_PREFIX = "city:";
/** Menu owners: Lisa's offer (`openChoice(3)`), her pet choice (4) and the document (5). */
export const CITY_MENU_BASE = 100;
const MENU_ACCEPT = 100,
  MENU_PET = 101,
  MENU_DOCUMENT = 102;
const CITY = 1,
  RESEARCH = 46,
  SHOP = 56;
const MATERIAL_SCENE = 122,
  REWARD_SCENE = 124;

/** What the side rooms read beyond the North Sea's world: stock by inventory kind. */
export interface CityWorld extends NorthSeaWorld {
  stock(item: CityItem): number;
  take(item: CityItem, qty: number): void;
  give(item: CityItem, qty: number): void;
}

export function isCitySideRoom(room: number): boolean {
  return (CITY_SIDE_ROOMS as readonly number[]).includes(room);
}

/** `CauVongOpeningSideQuests` and `tickSideRoom` in 45, 46 and 56. */
export class CityOwner {
  /** `petChoices`: the roster slots the pet menu lists. */
  private petChoices: number[] = [];
  /** `shopFarewell`: the items clerk says goodbye once the shop closes. */
  private farewell = false;

  constructor(private readonly doc: CauVongCityDocument) {}

  owns(name: string): boolean {
    return name.startsWith(CITY_PREFIX);
  }
  private part(name: string): FourGatesAction {
    return { kind: "part", name: CITY_PREFIX + name, part: this.doc.parts[name] };
  }
  private say(line: Say): FourGatesAction {
    return { kind: "text", steps: [line] };
  }

  /** `eligible(species, level)`: slots of the species at the level, with another living pet. */
  private eligible(w: CityWorld): number[] {
    const roster = w.roster(),
      { species, level } = this.doc.lisa.trade;
    return roster.flatMap((pet, i) =>
      pet.speciesId === species && pet.level >= level && roster.some((p, j) => j !== i && p.hp > 0)
        ? [i]
        : [],
    );
  }
  private materialsReady(w: CityWorld): boolean {
    return this.doc.lisa.materials.every(({ item, qty }) => w.stock(item) >= qty);
  }

  /** `CauVongOpeningSideQuests.tick`, then `tickSideRoom`'s residents. */
  tick(w: CityWorld, room: number): FourGatesAction {
    const lisa = this.doc.lisa,
      f = lisa.flags,
      done = (event: number) => w.done(room, event);
    if (room === SHOP && this.farewell) {
      this.farewell = false;
      return this.part("SHOP_ITEMS_BYE");
    }
    if (room === RESEARCH) {
      if (done(f.acceptedScene) && !done(this.doc.parts.LISA_ACCEPTED.flag))
        return this.part("LISA_ACCEPTED");
      if (done(f.requestStarted) && !done(f.requestSeen)) return this.part("LISA_REQUEST");
      if (done(f.rewarded) && !done(REWARD_SCENE)) return this.part("LISA_REWARD");
      if (done(f.traded) && !done(MATERIAL_SCENE)) return this.part("LISA_MATERIALS");
      if (w.requested(lisa.actor)) {
        if (done(f.rewarded)) return this.part("LISA_PASSIVE");
        if (!done(f.accepted)) {
          if (done(f.requestSeen)) return this.part("LISA_OFFER");
          w.mark(RESEARCH, f.requestStarted);
          return this.part("LISA_REQUEST");
        }
        if (!done(f.traded)) {
          if (this.eligible(w).length === 0 || !this.materialsReady(w))
            return this.part("LISA_SHORT");
          return this.petMenu(w);
        }
        if (w.stock(lisa.document) < 1) return this.part("LISA_NO_DOCUMENT");
        return this.part("LISA_DOCUMENT");
      }
    }
    if (room === SHOP) {
      const gift = this.doc.shopGift;
      if (w.done(gift.opens[0], gift.opens[1]) && !done(gift.flag) && w.requested(gift.actor)) {
        // Source 56:0 grants item 0 ×2 and item 7 ×2, then the scene.
        for (const { item, qty } of gift.items) w.give(item, qty);
        w.mark(SHOP, gift.flag);
        return this.part("SHOP_GIFT");
      }
      if (done(gift.flag) && !done(REWARD_SCENE)) return this.part("SHOP_GIFT");
    }
    for (const npc of this.doc.residents[String(room)] ?? []) {
      if (npc.role === "lisa" || !w.requested(npc.actorId)) continue;
      switch (npc.role) {
        case "items":
          return this.part("SHOP_ITEMS");
        case "bank":
          return this.part("SHOP_BANK");
        case "badges":
          return this.part("SHOP_BADGES");
        case "materials":
          return this.part("SHOP_MATERIALS");
        case "documents":
          return this.part("SHOP_DOCUMENTS");
        case "rooftop":
          // `tickSideRoom`: the rooftop's merchant opens the shop at once.
          return { kind: "shop", category: 0 };
        default:
          return npc.say ? this.say(npc.say) : null;
      }
    }
    return null;
  }

  /** `openPetChoice(4, 108, 85)`. */
  private petMenu(w: CityWorld): FourGatesAction {
    this.petChoices = this.eligible(w);
    const roster = w.roster(),
      options = this.petChoices.map((slot) =>
        this.doc.lisa.petOption
          .replace("{slot}", String(slot + 1))
          .replace("{level}", String(roster[slot].level))
          .replace("{quality}", String(roster[slot].quality)),
      );
    return { kind: "menu", owner: MENU_PET, options: [...options, this.doc.lisa.keep] };
  }

  /** `nextChoice` and the services once a sequence ends. */
  after(name: string): FourGatesAction {
    switch (name.slice(CITY_PREFIX.length)) {
      case "LISA_REQUEST":
      case "LISA_OFFER":
        return { kind: "menu", owner: MENU_ACCEPT, options: this.doc.lisa.accept };
      case "LISA_DOCUMENT":
        return { kind: "menu", owner: MENU_DOCUMENT, options: this.doc.lisa.give };
      case "SHOP_ITEMS":
        this.farewell = true;
        return { kind: "shop", category: 0 };
      case "SHOP_BANK":
        return { kind: "bank" };
      case "SHOP_BADGES":
        return { kind: "shop", category: 2 };
      case "SHOP_MATERIALS":
        return { kind: "shop", category: 1 };
      case "SHOP_DOCUMENTS":
        return { kind: "shop", category: 3 };
      default:
        return null;
    }
  }

  /** `choose(action, answer)`. */
  answer(w: CityWorld, owner: number, selected: number): FourGatesAction {
    const lisa = this.doc.lisa,
      f = lisa.flags;
    if (owner === MENU_ACCEPT) {
      if (selected !== 0) return this.part("LISA_DECLINE");
      w.mark(RESEARCH, f.accepted);
      w.mark(RESEARCH, f.acceptedScene);
      return this.part("LISA_ACCEPTED");
    }
    if (owner === MENU_DOCUMENT) {
      if (selected !== 0 || w.done(RESEARCH, f.rewarded) || w.stock(lisa.document) < 1) return null;
      if (!w.petSpace()) return this.say(lisa.noRoom);
      // `acquire(15, 24)` (its receipt is the reward flag), then the document is used.
      w.grantPet(lisa.reward);
      w.take(lisa.document, 1);
      w.mark(RESEARCH, f.rewarded);
      return this.part("LISA_REWARD");
    }
    if (owner === MENU_PET) {
      if (selected >= this.petChoices.length) return this.part("LISA_PASSIVE");
      const slot = this.petChoices[selected];
      if (!this.eligible(w).includes(slot)) return this.say(lisa.changed);
      if (!this.materialsReady(w)) return this.say(lisa.short);
      if (!w.releaseSlot(slot)) return this.say(lisa.changed);
      for (const { item, qty } of lisa.materials) w.take(item, qty);
      w.mark(RESEARCH, f.traded);
      return this.part("LISA_MATERIALS");
    }
    return null;
  }

  /** `sideRoomExit`: back to the city. */
  exit(w: CityWorld, room: number): FourGatesAction {
    const row = this.doc.exits[String(room)];
    if (!row || !w.at(row[0], row[1], row[2], row[3])) return null;
    return { kind: "exit", room: CITY, x: row[4], y: row[5], dir: 0 };
  }

  /** `citySideEntrance` in the city (1). */
  entrance(
    w: Pick<CityWorld, "at">,
    heroX: number,
  ): { kind: "exit"; room: number; x: number; y: number } | null {
    for (const [x, y, width, height, room, tx, ty] of this.doc.entrances)
      if (w.at(x, y, width, height))
        // The café's Java landing is under its wall (`cauVongCafeArrival`).
        return room === CAFE_ROOM
          ? { kind: "exit", room, ...cauVongCafeArrival(heroX) }
          : { kind: "exit", room, x: tx, y: ty };
    return null;
  }

  /** `applyNpcVisuals` in 56: the merchants' visibility, by the south gate's victory. */
  merchants(room: number, done: (room: number, event: number) => boolean): Map<number, boolean> {
    if (room !== SHOP) return new Map();
    const { actors, after } = this.doc.merchants,
      shown = after.some(([r, e]) => done(r, e));
    return new Map(actors.map((id) => [id, shown]));
  }

  /** `applyHatcheryCast` in 46: the finished research scenes' cast. */
  cast(room: number, done: (room: number, event: number) => boolean): CauVongCue[] {
    if (room !== RESEARCH) return [];
    if (done(RESEARCH, REWARD_SCENE)) return this.doc.cast.LISA_REWARD ?? [];
    if (done(RESEARCH, MATERIAL_SCENE)) return this.doc.cast.LISA_MATERIALS ?? [];
    return [];
  }
}
