// JavaSE parity: main quest CV4 "Cầu Vồng — Bốn Cổng và cứu pet". `CauVongChapterRuntime.tick` hands
// rooms 9–26, 52, 57 and 58 to `CauVongFourGateSourceRuntime` (after Lạc Khắc's chain in 52), then to
// the room's walker: `tickEastGateArc` (9, 12–15), `CauVongSouthGateRuntime` (21–23, 52: the south
// lever and the routes), `CauVongWestGateRuntime` (16–20: its first-visit lines and the routes), the
// lost-pet chamber (10). CV4a plays the east, south and west gates (with the lost pet, the masked
// pair of the ruins and the raid); the branches of those rooms come with it.
//
// Bug fix against JavaSE: `CauVongWestGateRuntime.tick` plays 17:0/19:0/57:0/58:2 (An Kỳ Nhi and the
// Hoàng Dực Điểu, chapter 8) on the first visit to those rooms, so walking the chapter-3 route
// through 17 played chapter 8 early and wrote 17:100/19:100, which open WEST_CHASE and the 19 → 57
// portal. The source event 17:0 opens with the condition "3:5 done" (Java's 3:113, the release plan,
// the same gate `WEST_ENTRY` 16:2 already reads), so the web waits for 3:113 before those scenes.
//
// The sequences and the owner's own lines are baked by rebuild_game/tools/WebCauVongFourGates.java
// (`cau-vong-world/four-gates.json`); this file is the owner's decisions.
import type { AcademyBattle } from "./CauVongAcademy";
import type { CauVongAward, CauVongCue, CauVongPart, CauVongPetCue } from "./CauVongCutscene";

type Say = Extract<CauVongCue, { k: "say" }>;
export type QuestItem = { id: number; name: string; description: string };

export type CauVongFourGatesDocument = {
  parts: Record<string, CauVongPart>;
  cast: Record<string, CauVongCue[]>;
  /** `CauVongFourGateDialogue.source(room, event, from, to)`, keyed "room:event:from:to". */
  replies: Record<string, Say[]>;
  /** `shopEvent`, `shopGreetingEnd`, `shopFarewell`, `shopFlag` of the merchants' rooms. */
  shops: Record<string, { event: number; greeting: number; farewell: number; flag: number }>;
  /** `actorId(s, room, source)`, by room then source actor. */
  actors: Record<string, Record<string, number>>;
  passives: Record<string, { actorId: number; canonical: number; say: Say }[]>;
  /** `request(room, event)` keyed "room:event", and the masked pair's. */
  battles: Record<string, AcademyBattle>;
  /** `options(owner)`. */
  menus: Record<string, string[]>;
  /** `CauVongFourGateRoutes.PORTALS`: room, tile x/y, target, entry tile x/y, facing, gate room/flag. */
  portals: number[][];
  /** Native doors: [tileX, tileY, target, x, y, dir], by room. */
  doors: Record<string, [number, number, number, number, number, number][]>;
  text: {
    cactusDone: string;
    mushroomDone: string;
    petDone: string;
    cactusRefused: string;
    mushroomRefused: string;
    petRefused: string;
    mushroomBought: string;
    mushroomNotBought: string;
    rematchWon: string;
    rematchLost: string;
    lost: string;
    wonNoRoom: string;
    capacity: string;
    medals: string;
    west18: { speaker: string; text: string };
  };
  /** `CauVongSwitchMechanisms`' south lever (52): its prop, start flag, checkpoint and cues. */
  southLever: {
    actorId: number;
    x: number;
    y: number;
    started: number;
    cue: number;
    steps: CauVongCue[];
  };
  items: { ball: QuestItem; mushroom: QuestItem };
  flags: {
    releasePlan: number;
    lockeAfter: number;
    lockePost: number;
    maskedStarted: number;
    maskedBefore: number;
    maskedAfter: number;
    examDone: number;
    girlPost: number;
    skyRide: number;
  };
};

/** `CauVongFourGateSourceRuntime.owns`, less 11 (Rừng Gai stays the opening's room on the web). */
export const FOUR_GATE_ROOMS = [
  9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 52, 57, 58,
] as const;
export const isFourGateRoom = (room: number) =>
  (FOUR_GATE_ROOMS as readonly number[]).includes(room);
const LOST_PET_CHAMBER = 10;
const SOUTH_DEPTH = 52;
/** `CauVongSwitchMechanisms.SOUTH_SWITCH`. */
const SOUTH_SWITCH = 101;
/** `CauVongFourGateTransactions`: committed trade/payment markers and the receipt bases. */
const COMMITTED = 41500;
const MUSHROOMS_NEEDED = 15;
const MUSHROOM_PRICE = 200;
const PET_PRICE = 600;

/** What the world reads and writes for the owner. */
export interface FourGatesWorld {
  done(room: number, event: number): boolean;
  mark(room: number, event: number): void;
  clear(room: number, event: number): void;
  /** `CauVongNpcGeometry.requested` (5 on the actor). */
  requested(id: number): boolean;
  /** `playerIntersectsSourceRect`. */
  at(x: number, y: number, width: number, height: number): boolean;
  itemCount(id: number): number;
  addItem(item: QuestItem, qty: number): void;
  removeItem(id: number, qty: number): void;
  money(): number;
  pay(amount: number): void;
  /** `CauVongDormPetQuest.hasSpace(s, 1)`. */
  petSpace(): boolean;
  /** `giftFits`: a received award, or room for it. */
  giftFits(award: CauVongAward): boolean;
  /** `tradeCactus`'s release: the lowest Cự Thứ Tiên Chưởng (111) from 55 of the party, if another lives. */
  releaseCactus(): boolean;
  /** `grantPet` with its receipt (`buyPet`). */
  grantPet(pet: CauVongPetCue): void;
  /** `CauVongAcademySideRuntime.upgrade`. */
  allianceUpgrade(): string;
  /** `claimMedals`. */
  claimMedals(): number;
}

/** What the world runs for the owner; each finished one reports back (`after`, `notice`, `answer`). */
export type FourGatesAction = FourGatesStep | null;
type FourGatesStep =
  /** `start(p)`: a part; its flag is written at the end, then `after(name)`. */
  | { kind: "part"; name: string; part: CauVongPart; restore?: CauVongCue[]; clear?: boolean }
  /** `replay` / `say`: text only, then `notice()`. */
  | { kind: "text"; steps: Say[] }
  /** `choose(owner)`: the menu (its 630000+owner marker already written), then `answer`. */
  | { kind: "menu"; owner: number; options: string[] }
  /** `startBattle`: `request(battleMap, battleEvent)`, then `result(won)`. */
  | { kind: "battle"; key: string; restore?: CauVongCue[] }
  /** `openShopUi`: the Cầu Vồng shop, category 0 unless named (its farewell flag already written). */
  | { kind: "shop"; category?: number }
  /** `openSourceConveniencePetstate(1)`: the pet panel's evolution page (Bắc Hải 56). */
  | { kind: "evolve" }
  /** Nothing to run, but the tick is spent (a boat leaving, a voyage's step). */
  | { kind: "hold" }
  /** `openCauVongIncubatorFromWorld` (34's hatchery keeper). */
  | { kind: "incubator" }
  /** `openSourceVillagePetBankFromWorld`: the pet bank. */
  | { kind: "bank" }
  /** `CauVongChapterRuntime.transition`: the room, the spot, the facing. */
  | { kind: "exit"; room: number; x: number; y: number; dir?: number }
  /** The owners' casts again (`applyCast` after a completed part). */
  | { kind: "cast" }
  /** Both, in order (the second only if the first hands the tick back). */
  | { kind: "then"; first: FourGatesAction; next: FourGatesAction };

const say = (text: string): FourGatesAction => ({
  kind: "text",
  steps: [{ k: "say", speaker: "", text, portrait: -1 }],
});

/** `CauVongFourGateSourceRuntime`: the owner and its state between ticks. */
export class FourGatesOwner {
  private capacityWarning: string | null = null;
  private battleMap = 0;
  private battleEvent = 0;
  private repeatBattle = false;
  private serviceAfterReply = 0;
  /** The `Part` names with a flag, in ordinal order. */
  private readonly order: string[];

  constructor(private readonly doc: CauVongFourGatesDocument) {
    this.order = Object.keys(doc.parts)
      .filter((name) => doc.parts[name].flag >= 1600)
      .sort((a, b) => doc.parts[a].flag - doc.parts[b].flag);
  }

  private finished(w: FourGatesWorld, name: string): boolean {
    const p = this.doc.parts[name];
    return w.done(p.room, p.flag);
  }
  private id(room: number, source: number): number {
    return this.doc.actors[String(room)]?.[String(source)] ?? -1;
  }
  private asked(w: FourGatesWorld, room: number, source: number): boolean {
    const id = this.id(room, source);
    return id >= 0 && w.requested(id);
  }

  /** `start(p)`: an offer already read replays as text only; any part marks `started` first. */
  start(w: FourGatesWorld, name: string): FourGatesAction {
    this.capacityWarning = null;
    const p = this.doc.parts[name];
    if (
      w.done(p.room, p.flag) &&
      (name === "CACTUS_OFFER" || name === "MUSHROOM_OFFER" || name === "PET_OFFER")
    )
      return {
        kind: "part",
        name,
        part: { ...p, cue: -1, steps: this.reply(p.room, p.event, from(p), to(p)) },
      };
    return { kind: "part", name, part: p };
  }
  private reply(room: number, event: number, from: number, to: number): Say[] {
    const steps = this.doc.replies[`${room}:${event}:${from}:${to}`];
    if (!steps) throw new Error(`Four Gates reply ${room}:${event}:${from}:${to} is not baked`);
    return steps;
  }
  /** `replay`: text, then `notice()`. */
  private replay(room: number, event: number, from: number, to: number): FourGatesAction {
    return { kind: "text", steps: this.reply(room, event, from, to) };
  }
  private beginBattle(name: string, event: number, w: FourGatesWorld): FourGatesAction {
    const p = this.doc.parts[name];
    this.battleMap = p.room;
    this.battleEvent = event;
    this.repeatBattle = false;
    return this.start(w, name);
  }
  private startBattle(): FourGatesAction {
    return { kind: "battle", key: `${this.battleMap}:${this.battleEvent}` };
  }
  private choose(w: FourGatesWorld, room: number, owner: number): FourGatesAction {
    w.mark(room, 630000 + owner);
    return { kind: "menu", owner, options: this.doc.menus[String(owner)] };
  }
  /** `warnCapacity`: once per part; a second time the owner stands aside this tick. */
  private warnCapacity(name: string): FourGatesAction {
    if (this.capacityWarning === name) return null;
    this.capacityWarning = name;
    return say(this.doc.text.capacity);
  }
  /** `spaceFor(p)`: a pet still owed needs room; every award not yet received must fit. */
  spaceFor(w: FourGatesWorld, name: string | null): boolean {
    if (!name) return true;
    for (const cue of this.doc.parts[name].steps) {
      if (cue.k === "pet") {
        if (!w.done(cue.room, cue.receipt) && !w.petSpace()) return false;
      } else if (cue.k === "award" && !w.giftFits(cue)) return false;
    }
    return true;
  }
  private startChecked(w: FourGatesWorld, name: string): FourGatesAction {
    return this.spaceFor(w, name) ? this.start(w, name) : this.warnCapacity(name);
  }

  /** `tick` past the sequence/menu/battle the world itself runs. */
  tick(w: FourGatesWorld, room: number): FourGatesAction {
    const t = this.doc.text,
      finished = (name: string) => this.finished(w, name);
    // A committed transfer/removal/payment is recovered before anything else.
    if (room === 13 && w.done(13, COMMITTED) && !finished("CACTUS_TRADE"))
      return this.startChecked(w, "CACTUS_TRADE");
    if (room === 17 && w.done(17, COMMITTED) && !finished("MUSHROOM_REWARD"))
      return this.startChecked(w, "MUSHROOM_REWARD");
    if (room === 25 && w.done(25, COMMITTED) && !finished("PET_BUY"))
      return this.start(w, "PET_BUY");
    // A menu left open is asked again.
    for (let owner = 1; owner <= 7; owner++)
      if (w.done(room, 630000 + owner)) return this.choose(w, room, owner);
    const shop = this.doc.shops[String(room)];
    if (shop && w.done(room, shop.flag)) {
      w.clear(room, shop.flag);
      return this.replay(room, shop.event, shop.farewell, Number.MAX_SAFE_INTEGER);
    }
    for (const name of this.order) {
      const p = this.doc.parts[name];
      if (p.room === room && w.done(room, p.started) && !w.done(room, p.flag))
        return this.startChecked(w, name);
    }
    for (const event of [1, 0, 2, 6, 4])
      if (w.done(room, 1800 + event)) {
        const next = post(room, event);
        if (next && !finished(next) && !legacyWon(w, room, event))
          return this.startChecked(w, next);
      }
    if (room === 9) {
      // Arrival only (`mark(s, 9, 100)`), never a teacher victory.
      w.mark(9, 100);
      if (w.done(23, 100) && !w.done(9, 102) && w.at(140, 360, 100, 20))
        return this.start(w, "LOST_NOTICE");
      if (w.done(10, 100) && !w.done(9, 103) && !finished("LOST_RETURN"))
        return this.start(w, "LOST_RETURN");
      if (
        (finished("LOST_RETURN") || w.done(9, 103)) &&
        !finished("WEST_BRIEF") &&
        this.asked(w, 9, 8)
      )
        return this.start(w, "WEST_BRIEF");
      if (w.done(20, 100) && !finished("RAID") && !w.done(9, 104) && w.at(140, 60, 20, 100))
        return this.startChecked(w, "RAID");
      if (
        (w.done(40, this.doc.flags.girlPost) || w.done(40, 6400) || w.done(40, 101)) &&
        w.done(20, 100) &&
        !w.done(9, 104)
      ) {
        if (!finished("NORTH_NOTICE") && w.at(140, 200, 100, 20))
          return this.start(w, "NORTH_NOTICE");
        if (finished("NORTH_NOTICE") && this.asked(w, 9, 13))
          return this.startChecked(w, "NORTH_BRIEF");
      }
      if (w.done(15, 100) && !w.done(9, 101) && this.asked(w, 9, 7))
        return this.start(w, "EAST_REPORT");
      if (!finished("INTRO") && !w.done(9, 101) && this.asked(w, 9, 6))
        return this.start(w, "INTRO");
    }
    if (room === LOST_PET_CHAMBER && w.done(9, 102) && !w.done(10, 100) && w.at(340, 260, 40, 20))
      return this.start(w, "LOST_FOUND");
    if (room === 12 && !finished("HIGHLAND") && w.at(0, 300, 60, 20))
      return this.start(w, "HIGHLAND");
    if (room === 16 && w.done(3, this.doc.flags.releasePlan) && !finished("WEST_ENTRY"))
      return this.start(w, "WEST_ENTRY");
    if (room === 13) {
      if (!finished("WATCH") && !w.done(13, 100) && w.at(260, 320, 40, 20))
        return this.start(w, "WATCH");
      if (
        !w.done(13, 100) &&
        ((w.at(300, 440, 20, 20) && !w.done(13, 1821)) ||
          ((w.done(13, 1821) || finished("RESCUE_PRE")) && this.asked(w, 13, 14)))
      )
        return this.beginBattle("RESCUE_PRE", 1, w);
      if (this.asked(w, 13, 18)) {
        if (!finished("CACTUS_POST")) return this.beginBattle("CACTUS_PRE", 2, w);
        if (!finished("CACTUS_TRADE")) return this.start(w, "CACTUS_OFFER");
        return say(t.cactusDone);
      }
    }
    if (room === 15 && this.asked(w, 15, 4)) {
      if (w.done(15, 100)) return this.replay(15, 0, 88, 1044);
      if (!finished("EAST_BRIEF")) return this.start(w, "EAST_BRIEF");
      return this.beginBattle("EAST_PRE", 0, w);
    }
    if (room === 23 && this.asked(w, 23, 2)) {
      if (w.done(23, 100)) return this.replay(23, 0, 345, 831);
      return this.beginBattle("SOUTH_PRE", 0, w);
    }
    if (room === 20 && this.asked(w, 20, 18)) {
      if (w.done(20, 100)) return this.replay(20, 0, 295, 841);
      return this.beginBattle("WEST_PRE", 0, w);
    }
    if (room === 17 && !finished("MUSHROOM_NOTICE") && w.at(220, 60, 40, 140))
      return this.start(w, "MUSHROOM_NOTICE");
    if (room === 17 && this.asked(w, 17, 27)) {
      if (finished("MUSHROOM_REWARD")) return say(t.mushroomDone);
      if (!finished("MUSHROOM_NOTICE")) return this.start(w, "MUSHROOM_NOTICE");
      if (w.itemCount(this.doc.items.mushroom.id) < MUSHROOMS_NEEDED)
        return this.replay(17, 4, 245, 393);
      return this.start(w, "MUSHROOM_OFFER");
    }
    if (room === 25 && this.asked(w, 25, 5)) {
      if (finished("PET_BUY")) return say(t.petDone);
      return this.start(w, "PET_OFFER");
    }
    if (room === 24 && !finished("NORTH_EGG") && w.at(260, 140, 120, 20))
      return this.startChecked(w, "NORTH_EGG");
    if (room === SOUTH_DEPTH && !finished("SOUTH_EGG") && w.at(420, 220, 100, 20))
      return this.startChecked(w, "SOUTH_EGG");
    if (room === SOUTH_DEPTH && !w.done(52, SOUTH_SWITCH) && this.asked(w, 52, 4))
      return this.start(w, "SOUTH_SWITCH");
    if (room === 18) {
      if (!finished("WEST_SIGN") && w.at(500, 500, 40, 80)) return this.start(w, "WEST_SIGN");
      if (w.done(17, 100) && !finished("WEST_CHASE")) return this.start(w, "WEST_CHASE");
    }
    const rival = rivalOf(room);
    if (rival !== 0 && this.rivalReady(w, room) && this.asked(w, room, rival)) {
      const event = room === 12 ? 6 : 4;
      if (finished(post(room, event) as string)) {
        this.battleMap = room;
        this.battleEvent = room === 12 ? 7 : 5;
        return this.choose(w, room, 6);
      }
      const pre =
        room === 12
          ? "RIVAL_EAST_PRE"
          : room === 18
            ? "RIVAL_WEST_PRE"
            : room === 11
              ? "RIVAL_THORN_PRE"
              : "RIVAL_NORTH_PRE";
      return this.beginBattle(pre, event, w);
    }
    const alliance =
      room === 12
        ? "ALLIANCE_EAST"
        : room === 18
          ? "ALLIANCE_WEST"
          : room === 22
            ? "ALLIANCE_SOUTH"
            : room === 24
              ? "ALLIANCE_NORTH"
              : null;
    const allianceActor = room === 12 || room === 22 ? 13 : room === 18 ? 59 : 6;
    if (alliance && this.asked(w, room, allianceActor)) {
      if (!finished(alliance)) return this.start(w, alliance);
      const p = this.doc.parts[alliance];
      this.serviceAfterReply = 5;
      return this.replay(room, p.event, from(p), to(p));
    }
    const shopPart =
      room === 12
        ? "SHOP_EAST"
        : room === 17
          ? "SHOP_WEST"
          : room === 22
            ? "SHOP_SOUTH"
            : room === 25
              ? "SHOP_NORTH"
              : room === 9
                ? "SHOP_HUB"
                : null;
    if (shopPart && shop && this.asked(w, room, shopActor(room))) {
      if (!finished(shopPart)) return this.start(w, shopPart);
      this.serviceAfterReply = 7;
      return this.replay(room, shop.event, 0, shop.greeting);
    }
    // The residents (never an exam teacher before the exam owner, CV4c).
    for (const npc of this.doc.passives[String(room)] ?? []) {
      if (
        room === 9 &&
        (npc.canonical <= 3 || npc.actorId === 29) &&
        w.done(26, 100) &&
        !w.done(9, this.doc.flags.examDone)
      )
        continue;
      if (!w.requested(npc.actorId)) continue;
      return { kind: "text", steps: [npc.say] };
    }
    return null;
  }
  private rivalReady(w: FourGatesWorld, room: number): boolean {
    const f = this.doc.flags;
    if (room === 12) return w.done(2, f.lockeAfter);
    if (room === 18) return w.done(52, f.lockePost);
    if (room === 11) return this.finished(w, "RIVAL_WEST_POST");
    return (
      room === 24 && (this.finished(w, "RIVAL_THORN_POST") || this.finished(w, "RIVAL_NORTH_POST"))
    );
  }

  /** A text sequence is over (`notice`): the service a reply was waiting for. */
  notice(w: FourGatesWorld, room: number): FourGatesAction {
    const action = this.serviceAfterReply;
    this.serviceAfterReply = 0;
    return action ? this.openShop(w, room, action) : null;
  }
  private openShop(w: FourGatesWorld, room: number, action: number): FourGatesAction {
    if (action === 5) return this.choose(w, room, 5);
    if (room === 17) return this.choose(w, room, 7);
    return this.openShopUi(w, room);
  }
  private openShopUi(w: FourGatesWorld, room: number): FourGatesAction {
    const shop = this.doc.shops[String(room)];
    if (shop) w.mark(room, shop.flag);
    return { kind: "shop" };
  }

  /** `after(p)`: a part is over (its flag already written). */
  after(w: FourGatesWorld, name: string, room: number): FourGatesAction {
    const p = this.doc.parts[name];
    switch (name) {
      case "RESCUE_PRE":
      case "EAST_PRE":
      case "SOUTH_PRE":
      case "WEST_PRE":
      case "CACTUS_PRE":
      case "RIVAL_EAST_PRE":
      case "RIVAL_WEST_PRE":
      case "RIVAL_NORTH_PRE":
      case "RIVAL_THORN_PRE":
        this.battleMap = p.room;
        this.battleEvent = p.event;
        this.repeatBattle = false;
        return this.startBattle();
      case "RESCUE_POST":
      case "EAST_POST":
      case "SOUTH_POST":
      case "WEST_POST":
        w.mark(p.room, 100);
        return { kind: "cast" };
      case "EAST_REPORT":
        w.mark(9, 101);
        return null;
      case "WEST_ENTRY":
        w.mark(16, 100);
        return null;
      case "LOST_NOTICE":
        w.mark(9, 102);
        return { kind: "exit", room: 11, x: 610, y: 179, dir: 2 };
      case "LOST_FOUND":
        if (w.itemCount(this.doc.items.ball.id) === 0) w.addItem(this.doc.items.ball, 1);
        w.mark(10, 100);
        return { kind: "exit", room: 9, x: 250, y: 279, dir: 1 };
      case "LOST_RETURN":
        if (w.itemCount(this.doc.items.ball.id) > 0) w.removeItem(this.doc.items.ball.id, 1);
        return null;
      case "WEST_BRIEF":
        w.mark(9, 103);
        return null;
      case "NORTH_BRIEF":
        w.mark(9, 104);
        return null;
      case "CACTUS_OFFER":
        return this.choose(w, room, 1);
      case "MUSHROOM_OFFER":
        return this.choose(w, room, 2);
      case "MUSHROOM_GIVE":
        return this.start(w, "MUSHROOM_REWARD");
      case "PET_OFFER":
        return this.choose(w, room, 3);
      case "RIVAL_NORTH_POST":
        return this.choose(w, room, 4);
      case "ALLIANCE_EAST":
      case "ALLIANCE_WEST":
      case "ALLIANCE_SOUTH":
      case "ALLIANCE_NORTH":
        return this.choose(w, room, 5);
      case "SHOP_EAST":
      case "SHOP_WEST":
      case "SHOP_SOUTH":
      case "SHOP_NORTH":
      case "SHOP_HUB":
        // 12's merchant opens with his own line again before the shop.
        if (room === 12) {
          this.serviceAfterReply = 7;
          return this.replay(room, 4, 0, 65);
        }
        return this.openShop(w, room, 7);
      case "SOUTH_SWITCH":
        w.mark(52, SOUTH_SWITCH);
        return { kind: "cast" };
      case "CACTUS_TRADE":
      case "MUSHROOM_REWARD":
      case "NORTH_EGG":
      case "SOUTH_EGG":
        return { kind: "cast" };
      default:
        return null;
    }
  }

  /** `tickChoice`: the answer (the menu's marker is cleared by the world). */
  answer(w: FourGatesWorld, owner: number, selection: number, room: number): FourGatesAction {
    const t = this.doc.text;
    w.clear(room, 630000 + owner);
    switch (owner) {
      case 1:
        if (selection !== 0) return this.replay(13, 3, 768, 871);
        return this.tradeCactus(w) ? this.start(w, "CACTUS_TRADE") : say(t.cactusRefused);
      case 2:
        if (selection !== 0) return this.replay(17, 4, 240, 403);
        return this.giveMushrooms(w) ? this.start(w, "MUSHROOM_GIVE") : say(t.mushroomRefused);
      case 3:
        if (selection !== 0) return this.replay(25, 1, 466, 534);
        return this.buyPet(w) ? this.start(w, "PET_BUY") : say(t.petRefused);
      case 4:
        return this.start(w, selection === 0 ? "RIVAL_ADVICE" : "RIVAL_IGNORE");
      case 5: {
        if (selection === 0) return say(w.allianceUpgrade());
        if (selection === 1) return say(t.medals.replace("{n}", String(w.claimMedals())));
        if (selection === 2 || selection === 3) {
          const event = room === 12 ? 5 : room === 18 ? 3 : 2;
          const info = room === 12 ? 998 : room === 18 ? 612 : room === 22 ? 428 : 338,
            open = room === 12 ? 2417 : room === 18 ? 2019 : room === 22 ? 1835 : 1745,
            end = room === 12 ? 2608 : room === 18 ? 2216 : room === 22 ? 2032 : 1942;
          return selection === 2
            ? this.replay(room, event, info, open)
            : this.replay(room, event, open, end);
        }
        return null;
      }
      case 6:
        if (selection !== 0) return null;
        this.battleMap = room;
        this.battleEvent = room === 12 ? 7 : 5;
        this.repeatBattle = true;
        return this.startBattle();
      case 7:
        if (selection === 0) return this.openShopUi(w, room);
        if (selection === 1 || selection === 2)
          return say(
            this.buyMushrooms(w, selection === 1 ? 1 : 15) ? t.mushroomBought : t.mushroomNotBought,
          );
        return this.replay(17, 1, 214, Number.MAX_SAFE_INTEGER);
      default:
        return null;
    }
  }

  /** `handleBattleResult`. */
  result(w: FourGatesWorld, won: boolean): FourGatesAction {
    const t = this.doc.text;
    if (this.repeatBattle) return say(won ? t.rematchWon : t.rematchLost);
    if (!won) {
      w.mark(this.battleMap, 1820 + this.battleEvent);
      return say(t.lost);
    }
    w.mark(this.battleMap, 1800 + this.battleEvent);
    const next = post(this.battleMap, this.battleEvent);
    if (this.spaceFor(w, next)) return next ? this.start(w, next) : null;
    return say(t.wonNoRoom);
  }

  // --- CauVongFourGateTransactions ---

  private tradeCactus(w: FourGatesWorld): boolean {
    if (w.done(13, COMMITTED)) return true;
    const trade = this.doc.parts.CACTUS_TRADE.steps.find((cue) => cue.k === "award");
    if (trade && !w.giftFits(trade)) return false;
    if (!w.releaseCactus()) return false;
    w.mark(13, COMMITTED);
    return true;
  }
  private giveMushrooms(w: FourGatesWorld): boolean {
    if (w.done(17, COMMITTED)) return true;
    const egg = this.doc.parts.MUSHROOM_REWARD.steps.find((cue) => cue.k === "award");
    if (egg && !w.giftFits(egg)) return false;
    const id = this.doc.items.mushroom.id;
    if (w.itemCount(id) < MUSHROOMS_NEEDED) return false;
    w.removeItem(id, MUSHROOMS_NEEDED);
    w.mark(17, COMMITTED);
    return true;
  }
  private buyPet(w: FourGatesWorld): boolean {
    if (w.done(25, COMMITTED)) return true;
    const pet = this.doc.parts.PET_BUY.steps.find((cue): cue is CauVongPetCue => cue.k === "pet");
    if (!pet) return false;
    if (w.money() < PET_PRICE || (!w.done(pet.room, pet.receipt) && !w.petSpace())) return false;
    w.grantPet(pet);
    w.pay(PET_PRICE);
    w.mark(25, COMMITTED);
    return true;
  }
  private buyMushrooms(w: FourGatesWorld, qty: number): boolean {
    const price = qty * MUSHROOM_PRICE,
      item = this.doc.items.mushroom;
    if (w.money() < price || w.itemCount(item.id) + qty > 99) return false;
    w.addItem(item, qty);
    w.pay(price);
    return true;
  }

  // --- CauVongRuinsMaskedCutscene (5:6), inside `tickRuins` ---

  /** The masked pair begun and not over: the scene before the fight, or after the win. */
  maskedResume(w: FourGatesWorld): FourGatesAction {
    const f = this.doc.flags;
    if (!w.done(5, f.maskedStarted)) return null;
    if (w.done(5, 101) && !w.done(5, f.maskedAfter)) return this.maskedAfter();
    if (!w.done(5, 101) && !w.done(5, f.maskedBefore)) return this.maskedBefore();
    return null;
  }
  /** The rectangle (300, 300, 100, 80) once 9:102 is told; a retry waits for 5. */
  maskedTrigger(w: FourGatesWorld, confirm: boolean): FourGatesAction {
    const f = this.doc.flags;
    if (
      !w.done(5, 101) &&
      (w.done(9, 102) || w.done(5, f.maskedStarted)) &&
      w.at(300, 300, 100, 80) &&
      (!w.done(5, f.maskedStarted) || confirm)
    ) {
      w.mark(5, f.maskedStarted);
      return this.maskedBefore();
    }
    return null;
  }
  private maskedBefore(): FourGatesAction {
    return { kind: "part", name: "MASKED_BEFORE", part: this.doc.parts.MASKED_BEFORE };
  }
  private maskedAfter(): FourGatesAction {
    // The committed pre-battle cast first, without its dialogue.
    return {
      kind: "part",
      name: "MASKED_AFTER",
      part: this.doc.parts.MASKED_AFTER,
      restore: this.doc.cast.MASKED_BEFORE,
    };
  }
  /** `ruinsMasked` over: before the win the fight, after it 5:130 and the cast. */
  maskedOver(w: FourGatesWorld): FourGatesAction {
    const f = this.doc.flags;
    if (!w.done(5, 101)) {
      w.mark(5, f.maskedBefore);
      return { kind: "battle", key: "masked" };
    }
    w.mark(5, f.maskedAfter);
    return { kind: "cast" };
  }
  /** `ruinsMaskedBattle` over: a win writes 5:101 and plays the scene after it; a loss says nothing. */
  maskedResult(w: FourGatesWorld, won: boolean): FourGatesAction {
    if (!won) return null;
    w.mark(5, 101);
    return this.maskedAfter();
  }
}

const from = (p: CauVongPart) => (p as CauVongPart & { from?: number }).from ?? 0;
const to = (p: CauVongPart) => (p as CauVongPart & { to?: number }).to ?? 0;

function rivalOf(room: number): number {
  return room === 12 ? 14 : room === 18 ? 60 : room === 24 ? 13 : room === 11 ? 26 : 0;
}
function shopActor(room: number): number {
  return room === 12 ? 12 : room === 17 ? 24 : room === 22 ? 14 : room === 25 ? 4 : 28;
}
/** `post(map, event)`. */
function post(map: number, event: number): string | null {
  if (map === 13 && event === 1) return "RESCUE_POST";
  if (map === 13 && event === 2) return "CACTUS_POST";
  if (map === 15) return "EAST_POST";
  if (map === 23) return "SOUTH_POST";
  if (map === 20) return "WEST_POST";
  if (map === 12 && event === 6) return "RIVAL_EAST_POST";
  if (map === 18 && event === 4) return "RIVAL_WEST_POST";
  if (map === 24 && event === 4) return "RIVAL_NORTH_POST";
  if (map === 11 && event === 4) return "RIVAL_THORN_POST";
  return null;
}
/** `legacyWon`: the teachers' older 100 victories. */
function legacyWon(w: FourGatesWorld, map: number, event: number): boolean {
  return (
    ((map === 13 && event === 1) || map === 15 || map === 23 || map === 20) && w.done(map, 100)
  );
}

/** The room's walker ahead of the routes: the south lever (52) and the west gate's first visits. */
export function fourGatesWalker(
  doc: CauVongFourGatesDocument,
  room: number,
  w: FourGatesWorld,
  confirm: boolean,
):
  | { kind: "lever"; part: CauVongPart }
  | { kind: "line"; text: { speaker: string; text: string } }
  | null {
  if (room === SOUTH_DEPTH && !w.done(52, SOUTH_SWITCH)) {
    // `CauVongSwitchMechanisms.tick`: begun → resume; else `nearProp(52, 1)` and 5.
    const lever = doc.southLever,
      resuming = w.done(52, lever.started);
    if (resuming || (confirm && w.at(lever.x - 25, lever.y - 25, 50, 65)))
      return {
        kind: "lever",
        part: {
          room: 52,
          event: 0,
          flag: SOUTH_SWITCH,
          started: lever.started,
          cue: lever.cue,
          steps: lever.steps,
        },
      };
  }
  // `CauVongWestGateRuntime`: 18's first visit writes its line (18:100). 17/19/57/58 are chapter 8.
  if (room === 18 && !w.done(18, 100)) return { kind: "line", text: doc.text.west18 };
  return null;
}

/** `CauVongFourGateSourceRuntime.applyCast` (and the 52 lever's frame). */
export function fourGatesCast(
  doc: CauVongFourGatesDocument,
  room: number,
  done: FourGatesWorld["done"],
): { cues: CauVongCue[]; visible: [number, boolean][]; state: [number, number][] } {
  const cast = {
    cues: [] as CauVongCue[],
    visible: [] as [number, boolean][],
    state: [] as [number, number][],
  };
  const finished = (name: string) => done(doc.parts[name].room, doc.parts[name].flag);
  const id = (source: number) => doc.actors[String(room)]?.[String(source)];
  for (const name of Object.keys(doc.parts)) {
    const p = doc.parts[name];
    if (p.flag < 1600 || p.room !== room || !done(room, p.flag)) continue;
    cast.cues.push(...(doc.cast[name] ?? []));
  }
  if (room === 13) {
    if (done(13, 100))
      for (const s of [14, 15]) if (id(s) !== undefined) cast.visible.push([id(s), false]);
    if (finished("CACTUS_TRADE"))
      for (const s of [16, 18, 19]) if (id(s) !== undefined) cast.visible.push([id(s), false]);
  }
  if (room === 17 && finished("MUSHROOM_REWARD") && id(26) !== undefined)
    cast.visible.push([id(26), false]);
  const rival = rivalOf(room);
  if (rival !== 0 && id(rival) !== undefined) {
    const f = doc.flags;
    cast.visible.push([
      id(rival),
      room === 12
        ? done(2, f.lockeAfter)
        : room === 18
          ? done(52, f.lockePost)
          : room === 11
            ? finished("RIVAL_WEST_POST")
            : finished("RIVAL_THORN_POST") || finished("RIVAL_NORTH_POST"),
    ]);
  }
  if (room === SOUTH_DEPTH)
    cast.state.push([doc.southLever.actorId, done(52, SOUTH_SWITCH) ? 1 : 0]);
  return cast;
}

/** `CauVongRuinsMaskedCutscene.applyCast`: actors 2, 3 and 54 of 5 while the pair is pending. */
export function maskedCast(
  doc: CauVongFourGatesDocument,
  done: FourGatesWorld["done"],
): [number, boolean][] {
  const f = doc.flags,
    pending = done(5, f.maskedStarted) && !done(5, f.maskedAfter);
  return [2, 3, 54].map((id): [number, boolean] => [id, pending]);
}
