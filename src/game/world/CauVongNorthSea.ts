// JavaSE parity: main quest CV5 "Cầu Vồng — Bắc Hải: pet mất tích và chân tướng" (9:114 → 61:105)
// and its branches. In the North Sea rooms (27–37, 45, 48, 53, 56, 61) `CauVongChapterRuntime.tick`
// runs, in order:
//
//   `sourceRouteGuards.priority` / `ambientSource.priority` (a begun guard or hint resumes first)
//   the key repair (48:106 without KEY's flag and without the key → the key again)
//   `CauVongNorthSeaBoat.active` → `northSeaBoat.tick` (a voyage owns the tick)
//   `northSeaSource.tick`        CauVongNorthSeaSourceRuntime: 27–34, 48 (OFFICE … CLUE, supplies,
//                                Thiên Mã one-horn)
//   `northSeaContinuation.tick`  CauVongNorthSeaContinuation: the old school (35), the key (48), the
//                                hidden classroom (30, 61), the guard and the principal (37, 36), the
//                                return and the switch (48, 61), and the branches (27, 29, 34, 36,
//                                53, 48, 30, 45, 56)
//   `northSeaBoat.tick`          the eight boats' offers and departures
//   `sourceRouteGuards.tick`     35's and 37's pushback lines
//   `CauVongNorthSeaRoutes.exit` the native doors (water needs Thủy Hành, the story gates, 56's way back)
//   `northSeaNpcs.tick`          the dock merchants (28, 29) and the passive lines
//   `ambientSource.tick`         27's summoning hint and 30's portal hint
//   then the walk (`tickFreeWorldPlayer`) and the doors again.
//
// 45 and 56 are only the North Sea's while 45/56:200001 is set (`sharedRoomActive`): a door from the
// North Sea writes it; any other way in clears it (`CauVongChapterRuntime` line 1698), and the room
// stays the free world's.
//
// CV5b adds LAB_HINT (27, after 61:105) and REOPEN (48, after 42:103 → 48:120, 48:130). CV6 adds
// the three finals in 30 (FINAL_NOTICE 30:120, the referee's menu, FINAL_1/2/3 → 30:121/122/123,
// FINAL_AWARD → the trophy, 30:124). `CauVongNorthSeaTournamentRuntime` is never ticked by the chapter,
// so it is not ported. CV0' (VINE_*, SKY_*, 49 and the hub 50's vines) is here; the summon rooms are
// `CauVongSummoning.ts`, the aux room 67 `CauVongBranches.ts`, Lisa (46) `CauVongCity.ts`. `CauVongNorthSeaGatewayRuntime`, `…FerryRuntime`, `…CampusRuntime`, `…OldSchoolRuntime`,
// `…HiddenClassroomRuntime` and `…RescueRuntime` never run in these rooms (the continuation owns them
// and `sharedRoomActive` returns first), so they are not ported.
//
// Web decisions:
// - 34's hatchery keeper (actor 31) opens the shared five-slot Cầu Vồng incubator, as in Java
//   (`CauVongIncubator.ts`; owner decision 2026-11-12 reversed the 2026-11-09 one).
// - `requested` reads two shapes the room's collision.json lacks (baked as `talkers`): the cue
//   actors the owners ask (151 in 34, 149 in 48, 153 in 30) and the props (`propActivation`: 61's
//   flowerpot switch, 28's sign, 35's door…). 30's classroom facade tests the web's free terrain (0;
//   Java's map reads -1 there).
// Bug fix against JavaSE (documented in the inventory):
// - A lost old-school/guard/principal/ghost/whale/chest fight is retried with 5 at its trigger. Java's
//   `begin` spends the confirm a second time after `asked` already spent it, so talking to the guard
//   never restarted the fight (only the floor trigger did); the web restarts it either way.
//
// The sequences and the owners' own lines are baked by rebuild_game/tools/WebCauVongNorthSea.java
// (`cau-vong-world/north-sea.json`); this file is the owners' decisions.
import type { AcademyBattle } from "./CauVongAcademy";
import type { CauVongAward, CauVongCue, CauVongPart } from "./CauVongCutscene";
import type { FourGatesAction, QuestItem } from "./CauVongFourGates";
import type { ForestWorld } from "./CauVongForest";
import type { CauVongMechanic } from "./CauVongWorld";
import type { DivineSealDocument } from "../pet/DivinePetSeal";

type Say = Extract<CauVongCue, { k: "say" }>;
/** A part, with its text-only replay "room:event:from:to" (a finished part's `start`). */
export type NorthSeaPart = CauVongPart & { reply?: string };
/** A native door: tile x/y, target (-1: 56's way back), arrival x/y, facing, the tile's terrain. */
type Door = [number, number, number, number, number, number, number];

export type CauVongNorthSeaDocument = {
  parts: Record<string, NorthSeaPart>;
  /**
   * What `CauVongNpcGeometry.requested` reads that collision.json lacks: the asked cue actors'
   * snapshots (by room, merged over the room's mechanics) and the props' displayed rectangles
   * (`propActivation`, `[left, top, width, height]` in world pixels).
   */
  talkers: {
    mechanics: Record<string, Record<string, CauVongMechanic>>;
    props: Record<string, Record<string, [number, number, number, number]>>;
  };
  /** `steps(..., true)`: each part's restore, and 56's service counters (`SERVICES_56`). */
  cast: Record<string, CauVongCue[]>;
  /** `CauVongNorthSeaDialogue.source(room, event, from, to)`, keyed "room:event:from:to". */
  replies: Record<string, Say[]>;
  /** `CauVongNorthSeaBoat.STARTS` with the routes: room, the gate actor, its rect, its offer, the path. */
  boats: {
    room: number;
    actor: number;
    rect: [number, number, number, number];
    offer: string;
    path: number[];
  }[];
  /** `CauVongNorthSeaNpcRuntime.merchant` / `shopEvent`, by room. */
  merchants: Record<string, { actor: number; event: number }>;
  /** `actorId(s, room, source)`, by room then source actor. */
  actors: Record<string, Record<string, number>>;
  /** `CauVongNorthSeaNpcRuntime.passives`, by room. */
  passives: Record<string, { actorId: number; say: Say }[]>;
  /** "match" and the continuation's `battleRequest(b)`. */
  battles: Record<string, AcademyBattle & { lossContinues?: boolean }>;
  menus: { source: Record<string, string[]>; continuation: Record<string, string[]> };
  doors: Record<string, Door[]>;
  /** CV0': the native doors of 49, 50 and the summon rooms (50's behind `summonCanEnter`). */
  skyDoors: Record<string, Door[]>;
  /** 56's way back: [30's door index, x, y, facing]. */
  shopReturn: [number, number, number, number][];
  /** `CauVongNorthSeaHiddenClassroomRuntime.applyProps`: [actor, visible, state] before/after 61:104. */
  props61: [number, number, number][][];
  text: Record<
    | "sourceFull"
    | "matchLost"
    | "suppliesRefused"
    | "horseRefused"
    | "full"
    | "lost"
    | "rematchWon"
    | "whaleFull"
    | "sisterAway"
    | "spiritRefused"
    | "penguinRefused"
    | "sisterRefused"
    | "medals"
    | "skyRefused"
    | "npcMedals",
    string
  >;
  items: {
    key: QuestItem;
    ticket: QuestItem;
    /** `NORTH_SEA_TROPHY_ITEM_ID` (9008), FINAL_AWARD's. */
    trophy: QuestItem;
    supplies: number[];
    spirit: number;
  };
  /** `DivinePetSeal`: the 19 Divine species ids and the sealed/released percents (30/120). */
  divine: DivineSealDocument;
  flags: Record<
    "finale" | "explained" | "matchWon" | "matchRetry" | "matchPending" | "waterRide",
    number
  >;
};

/** `setRainbowBoatVisual`: the boat the hero sails (`ExportWebRideSprites`, ride-sprites 9009). */
export const NORTH_SEA_BOAT_SPRITE = 9009;
/** The owner's part and battle names carry this prefix, so the hooks find it. */
export const NORTH_SEA_PREFIX = "sea:";
/** Menus: the source's 31–33, the continuation's 41–53, the merchants' 61, 49's alliance 62. */
export const NORTH_SEA_MENU_BASE = 30;
const CONTINUATION_MENU = 40;
const MERCHANT_MENU = 61;
/** 49's alliance clerk (`CauVongNorthSeaNpcRuntime` menu 2). */
const ALLIANCE_MENU = 62;
/** `CauVongNorthSeaContinuation.owns`, less CV0'’s 49/50 (`northSeaOwnsRoom`). */
export const NORTH_SEA_ROOMS = [
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 45, 48, 53, 56, 61,
] as const;
export const isNorthSeaRoom = (room: number) =>
  (NORTH_SEA_ROOMS as readonly number[]).includes(room);
/** CV0': Thiên Không Chi Thành (49) and the summoning hub (50), which the continuation also owns. */
export const SKY_CITY_ROOM = 49;
export const SKY_HUB_ROOM = 50;
/** `CauVongSummoningRuntime.room`: the summoners' hall 51 and the four trial rooms 63–66. */
export const isSummonRoom = (room: number) => room === 51 || (room >= 63 && room <= 66);
/** `CauVongNorthSeaContinuation.owns`: the North Sea's rooms with CV0'’s 49 and 50. */
export const northSeaOwnsRoom = (room: number) =>
  isNorthSeaRoom(room) || room === SKY_CITY_ROOM || room === SKY_HUB_ROOM;
/** `CauVongSummoningRuntime.completed(room, event)`'s receipt. */
export const SUMMON_COMPLETE = 651100;
/** `CauVongSummoningRuntime.canEnter`: 50's doors to the trial rooms, in order, and the hall. */
export function summonCanEnter(
  target: number,
  roster: { level: number }[],
  done: (room: number, event: number) => boolean,
): boolean {
  switch (target) {
    case 66:
      return roster.filter((pet) => pet.level >= 70).length >= 3;
    case 65:
      return done(66, SUMMON_COMPLETE + 9);
    case 64:
      return done(65, SUMMON_COMPLETE + 4);
    case 63:
      return done(64, SUMMON_COMPLETE + 8);
    case 51:
      return done(63, SUMMON_COMPLETE + 8);
    default:
      return true;
  }
}
/** The vines between 33/45 and the hub: a finished one plays again from the start (`start`). */
const VINES = ["VINE_UP", "VINE_45", "VINE_DOWN_33", "VINE_DOWN_45"];
/** `sharedRoomActive`: 45 and 56 only once a North Sea door marked them. */
export const northSeaShared = (room: number, done: (room: number, event: number) => boolean) =>
  (room !== 45 && room !== 56) || done(room, SHARED);
const SHARED = 200001;
const SHOP_ENTRY = 200100;
/** `CauVongNorthSeaSourceRuntime.Part`, in ordinal order. */
const SOURCE = [
  "OFFICE",
  "ARRIVAL",
  "WELCOME",
  "TOUR",
  "REPORTER",
  "MATCH_OFFER",
  "MATCH_PRE",
  "MATCH_POST",
  "LEAD",
  "WITNESSES",
  "CLUE",
  "SUPPLIES_NOTICE",
  "SUPPLIES_OFFER",
  "SUPPLIES_GIVE",
  "DOLPHIN",
  "ISLAND_HINT",
  "HORSE_NOTICE",
  "HORSE_OFFER",
  "HORSE_GIVE",
  "HORSE_DECLINE",
  "LEAD_NOTICE",
];
/** `battleId(p)` / `battlePart(b)`. */
const BATTLES: Record<string, number> = {
  OLD_GUARDS: 0,
  OLD_COMMANDER: 1,
  GUARD: 2,
  PRINCIPAL: 3,
  GHOST: 4,
  FINAL_1: 5,
  FINAL_2: 6,
  FINAL_3: 7,
  WHALE_GUARDS: 8,
  CHEST_PRE: 9,
  COMPANION_PRE: 10,
  COMPANION_REPEAT: 11,
};
const battlePart = (b: number) => Object.keys(BATTLES).find((name) => BATTLES[name] === b)!;
/** The finals the referee's "Bắt đầu thi đấu" starts, by `nextRound`. */
const FINALS = ["FINAL_1", "FINAL_2", "FINAL_3"];
/** `CauVongNorthSeaTournamentRuntime.nextRound`: the first of 30:121..123 not yet won (3: all). */
function nextRound(done: (room: number, event: number) => boolean): number {
  let round = 0;
  while (round < 3 && done(30, 121 + round)) round++;
  return round;
}
/** `CauVongSourceRouteGuards.Part` (35, 37): eligibility, rect in tiles [l, t, r, b]. */
const GUARDS: { name: string; room: number; rect: number[] }[] = [
  { name: "GUARD_OLD_SCHOOL_RETURN", room: 35, rect: [20, 0, 23, 1] },
  { name: "GUARD_HIDDEN_CLASS", room: 37, rect: [15, 2, 15, 4] },
];
/** `CauVongAmbientSourceRuntime.Part` (27, 30): rect in tiles, or none. */
const AMBIENT: { name: string; room: number; rect: number[] | null }[] = [
  { name: "AMBIENT_SUMMONING_HINT", room: 27, rect: null },
  { name: "AMBIENT_CAMPUS_PORTAL", room: 30, rect: [6, 19, 8, 21] },
];
/** `CauVongNorthSeaBoat`: active route 28:119000+b, offered 28:119100+b, waypoint 28:120000+b·100+i. */
const BOAT_ROOM = 28;
const BOAT_ACTIVE = 119000;
const BOAT_OFFERED = 119100;
const BOAT_WAYPOINT = 120000;
const BOAT_SPEED = 5;
/** `CauVongNorthSeaNpcRuntime`: menu marker and the shop's farewell. */
const NPC_MENU = 643000;
const NPC_FAREWELL = 644000;
const SOURCE_MENU = 640000;
const CONT_MENU = 641000;
const CONT_FAREWELL = 642000;
const RETRY = 3550;
const ACTIVE = 3500;
const MAX = 2147483647;

/** A roster row the trades read. */
export type NorthSeaPet = {
  speciesId: number;
  level: number;
  held: number;
  hp: number;
  quality: number;
};

/** What the North Sea owners read and write beyond the forest's world. */
export interface NorthSeaWorld extends ForestWorld {
  /** `mapRenderer.terrainAtWorld`. */
  terrain(x: number, y: number): number;
  /** The hero's spot and facing. */
  hero(): { x: number; y: number; direction: number };
  /** `travel`'s step: the hero on the boat (`setRainbowBoatVisual`) at x/y, facing, moving. */
  steer(x: number, y: number, direction: number, moving: boolean): void;
  /** `applySelectedRide("native-boat-disembark")`: the ride (or the feet) again. */
  disembark(): void;
  /** `rainbowRideActive(s, 3) && rainbowRideUnlocked(s, 3)`: Thủy Hành mounted. */
  waterRide(): boolean;
  roster(): NorthSeaPet[];
  /** `confirmRelease(slot)`: the pet leaves (its equipment back to the list) if another lives. */
  releaseSlot(slot: number): boolean;
}

const say = (text: string): FourGatesAction => ({
  kind: "text",
  steps: [{ k: "say", speaker: "", text, portrait: -1 }],
});

/** The CV5 owners and their state between ticks. */
export class NorthSeaOwner {
  /** `capacityWarning` of the source runtime and of the continuation. */
  private sourceWarning: string | null = null;
  private contWarning: string | null = null;
  /** What a finished text hands on: the boat's offer, a merchant's menu. */
  private noticeFor:
    { kind: "boat"; boat: number } | { kind: "merchant" } | { kind: "alliance" } | null = null;
  /** The continuation's parts, in ordinal order. */
  private readonly order: string[];

  constructor(private readonly doc: CauVongNorthSeaDocument) {
    this.order = Object.keys(doc.parts)
      .filter((name) => doc.parts[name].flag >= 3000 && doc.parts[name].flag < 3100)
      .sort((a, b) => doc.parts[a].flag - doc.parts[b].flag);
  }

  owns(name: string): boolean {
    return name.startsWith(NORTH_SEA_PREFIX);
  }
  private finished(w: NorthSeaWorld, name: string): boolean {
    const p = this.doc.parts[name];
    return w.done(p.room, p.flag);
  }
  private asked(w: NorthSeaWorld, room: number, source: number): boolean {
    const id = this.doc.actors[String(room)]?.[String(source)];
    return id !== undefined && w.requested(id);
  }
  private reply(key: string): Say[] {
    const steps = this.doc.replies[key];
    if (!steps) throw new Error(`North Sea reply ${key} is not baked`);
    return steps;
  }
  private replay(key: string): FourGatesAction {
    return { kind: "text", steps: this.reply(key) };
  }
  /** `CauVongNorthSeaTransactions.space`: the reward received, or room for one pet. */
  private space(w: NorthSeaWorld, map: number, event: number, species: number): boolean {
    return w.done(map, 52000 + event * 100 + species) || w.petSpace();
  }
  /** `start(p)`: a finished part plays its text only (unless `full`); the flag and `after` follow. */
  private play(name: string, finished: boolean, full = false): FourGatesAction {
    const p = this.doc.parts[name];
    if (finished && !full) {
      if (!p.reply) throw new Error(`North Sea part ${name} has no reply`);
      return {
        kind: "part",
        name: NORTH_SEA_PREFIX + name,
        part: { ...p, cue: -1, steps: this.reply(p.reply) },
      };
    }
    return { kind: "part", name: NORTH_SEA_PREFIX + name, part: p };
  }

  // --- priority: the guards' and hints' begun scenes, the key, the voyage ---

  /** `sourceRouteGuards.priority`, `ambientSource.priority`, then the key repair. */
  priority(w: NorthSeaWorld, room: number): FourGatesAction {
    for (const g of GUARDS) {
      const p = this.doc.parts[g.name];
      if (g.room === room && w.done(room, p.started)) return this.play(g.name, false);
    }
    for (const a of AMBIENT) {
      const p = this.doc.parts[a.name];
      if (a.room === room && w.done(room, p.started) && !w.done(room, p.flag))
        return this.play(a.name, false);
    }
    // Old saves: 48:106 without KEY's flag lost the key.
    const key = this.doc.items.key;
    if (w.done(48, 106) && !this.finished(w, "KEY") && w.itemCount(key.id) === 0) w.addItem(key, 1);
    return null;
  }

  /** `CauVongNorthSeaBoat.active` → `travel`: a voyage owns the tick. */
  travel(w: NorthSeaWorld, room: number): FourGatesAction {
    for (let b = 0; b < this.doc.boats.length; b++)
      if (w.done(BOAT_ROOM, BOAT_ACTIVE + b)) return this.voyage(w, room, b);
    return null;
  }
  private voyage(w: NorthSeaWorld, room: number, b: number): FourGatesAction {
    const route = this.doc.boats[b].path;
    let waypoint = 0;
    while (waypoint < route.length / 2 && w.done(BOAT_ROOM, BOAT_WAYPOINT + b * 100 + waypoint))
      waypoint++;
    if (waypoint === route.length / 2) {
      w.clear(BOAT_ROOM, BOAT_ACTIVE + b);
      w.disembark();
      return { kind: "hold" };
    }
    const x = route[waypoint * 2] * 20 + 10,
      y = route[waypoint * 2 + 1] * 20 + 19;
    const hero = w.hero();
    const dx = x - hero.x,
      dy = y - hero.y;
    let nx = hero.x,
      ny = hero.y,
      dir = hero.direction;
    if (dx !== 0) {
      dir = dx > 0 ? 1 : 3;
      nx += Math.sign(dx) * Math.min(BOAT_SPEED, Math.abs(dx));
    } else if (dy !== 0) {
      dir = dy > 0 ? 0 : 2;
      ny += Math.sign(dy) * Math.min(BOAT_SPEED, Math.abs(dy));
    }
    w.steer(nx, ny, dir, dx !== 0 || dy !== 0);
    if (nx === x && ny === y) {
      w.mark(BOAT_ROOM, BOAT_WAYPOINT + b * 100 + waypoint);
      return this.exit(w, room, true) ?? { kind: "hold" };
    }
    return { kind: "hold" };
  }

  // --- the tick ---

  /** CV0': `continuation.tick` in the summoning hub 50 (its vines down), after CV2's owners. */
  hub(w: NorthSeaWorld): FourGatesAction {
    return this.continuation(w, SKY_HUB_ROOM);
  }

  /** The source, the continuation, the boats, the guards, the doors, the merchants, the hints. */
  tick(w: NorthSeaWorld, room: number): FourGatesAction {
    return (
      this.source(w, room) ??
      this.continuation(w, room) ??
      this.boat(w, room) ??
      this.guards(w, room) ??
      this.exit(w, room) ??
      this.npcs(w, room) ??
      (room === 27 || room === 30 ? this.ambient(w, room) : null) ??
      null
    );
  }

  // --- CauVongNorthSeaSourceRuntime (27–34, 48) ---

  private sourceStart(w: NorthSeaWorld, name: string): FourGatesAction {
    this.sourceWarning = null;
    return this.play(name, this.finished(w, name), name === "MATCH_PRE");
  }
  private sourceSpace(w: NorthSeaWorld, name: string): boolean {
    if (name === "CLUE") return this.space(w, 48, 0, 82);
    if (name === "DOLPHIN" || name === "SUPPLIES_GIVE") return this.space(w, 31, 1, 83);
    return name !== "HORSE_GIVE" || this.space(w, 27, 7, 58);
  }
  /** `warn`: the full roster's line once per part; again, the tick goes on. */
  private sourceWarn(name: string): FourGatesAction {
    if (this.sourceWarning === name) return null;
    this.sourceWarning = name;
    return say(this.doc.text.sourceFull);
  }
  private sourceBegin(w: NorthSeaWorld, name: string): FourGatesAction {
    return this.sourceSpace(w, name) ? this.sourceStart(w, name) : this.sourceWarn(name);
  }
  private sourceMenu(w: NorthSeaWorld, room: number, owner: number): FourGatesAction {
    w.mark(room, SOURCE_MENU + owner);
    return {
      kind: "menu",
      owner: NORTH_SEA_MENU_BASE + owner,
      options: this.doc.menus.source[String(owner)],
    };
  }
  /** `startMatch`: 30:1982 holds the fight across a reload. */
  private match(w: NorthSeaWorld): FourGatesAction {
    w.mark(30, this.doc.flags.matchPending);
    return { kind: "battle", key: `${NORTH_SEA_PREFIX}match` };
  }

  private source(w: NorthSeaWorld, room: number): FourGatesAction {
    if (!((room >= 27 && room <= 34) || room === 48)) return null;
    const f = this.doc.flags,
      done = (r: number, e: number) => w.done(r, e),
      fin = (name: string) => this.finished(w, name);
    if (room === 30 && done(30, f.matchPending)) return this.match(w);
    if (room === 31 && done(31, 51900) && !fin("DOLPHIN"))
      return this.sourceBegin(w, fin("SUPPLIES_GIVE") ? "DOLPHIN" : "SUPPLIES_GIVE");
    if (room === 27 && done(27, 51900) && !fin("HORSE_GIVE"))
      return this.sourceBegin(w, "HORSE_GIVE");
    for (let owner = 1; owner <= 3; owner++)
      if (done(room, SOURCE_MENU + owner)) return this.sourceMenu(w, room, owner);
    for (const name of SOURCE) {
      const p = this.doc.parts[name];
      if (p.room === room && done(room, p.started) && !fin(name)) return this.sourceBegin(w, name);
    }
    if (room === 28 && !done(28, 100)) return this.sourceStart(w, "ARRIVAL");
    if (room === 27) {
      if (done(9, 114) && !fin("OFFICE") && w.at(280, 140, 80, 100))
        return this.sourceStart(w, "OFFICE");
      if (this.asked(w, 27, 19)) {
        if (fin("HORSE_GIVE")) return this.replay(this.doc.parts.HORSE_GIVE.reply!);
        return this.sourceStart(w, fin("HORSE_NOTICE") ? "HORSE_OFFER" : "HORSE_NOTICE");
      }
    }
    if (
      room === 48 &&
      !done(30, 100) &&
      !done(30, 104) &&
      !done(42, f.finale) &&
      !fin("WELCOME") &&
      w.at(380, 60, 40, 40)
    )
      return this.sourceStart(w, "WELCOME");
    if (room === 30) {
      if (!done(30, 100)) return this.sourceStart(w, "TOUR");
      if (done(30, f.matchWon) && !done(30, 102)) return this.sourceStart(w, "MATCH_POST");
      if (!done(30, 102)) {
        if (!done(30, 134) && !fin("REPORTER") && (w.at(140, 180, 20, 40) || this.asked(w, 30, 27)))
          return this.sourceStart(w, "REPORTER");
        if (this.asked(w, 30, 26)) return this.sourceStart(w, "MATCH_OFFER");
      } else if (!done(30, 103)) {
        if (!fin("LEAD_NOTICE") && w.at(120, 180, 20, 40))
          return this.sourceStart(w, "LEAD_NOTICE");
        if (fin("LEAD_NOTICE") && this.asked(w, 30, 25)) return this.sourceStart(w, "LEAD");
      } else if (
        !done(30, 104) &&
        (this.asked(w, 30, 29) || this.asked(w, 30, 30) || this.asked(w, 30, 31))
      )
        return this.sourceStart(w, "WITNESSES");
    }
    if (
      room === 48 &&
      done(30, 104) &&
      !done(48, 105) &&
      (w.at(140, 0, 20, 200) || this.asked(w, 48, 1))
    )
      return this.sourceBegin(w, "CLUE");
    if (room === 31 && this.asked(w, 31, 16)) {
      if (fin("DOLPHIN")) return this.replay(this.doc.parts.DOLPHIN.reply!);
      return this.sourceStart(w, fin("SUPPLIES_NOTICE") ? "SUPPLIES_OFFER" : "SUPPLIES_NOTICE");
    }
    if (room === 31 && !fin("ISLAND_HINT") && w.at(400, 100, 80, 40))
      return this.sourceStart(w, "ISLAND_HINT");
    return null;
  }
  /** The source's `after(p)`. */
  private sourceAfter(w: NorthSeaWorld, name: string, room: number): FourGatesAction {
    switch (name) {
      case "ARRIVAL":
        w.mark(28, 100);
        return null;
      case "WELCOME":
        w.mark(48, 100);
        return null;
      case "TOUR":
        w.mark(30, 100);
        return null;
      case "REPORTER":
        w.mark(30, 134);
        return null;
      case "MATCH_OFFER":
        return this.sourceMenu(w, room, 1);
      case "MATCH_PRE":
        return this.match(w);
      case "MATCH_POST":
        w.mark(30, 102);
        return { kind: "cast" };
      case "LEAD":
        w.mark(30, 103);
        return null;
      case "WITNESSES":
        w.mark(30, 104);
        return null;
      case "CLUE":
        w.mark(48, 105);
        return null;
      case "SUPPLIES_OFFER":
        return this.sourceMenu(w, room, 2);
      case "SUPPLIES_GIVE":
        return this.sourceStart(w, "DOLPHIN");
      case "HORSE_OFFER":
        return this.sourceMenu(w, room, 3);
      default:
        return null;
    }
  }
  private sourceAnswer(
    w: NorthSeaWorld,
    owner: number,
    selected: number,
    room: number,
  ): FourGatesAction {
    w.clear(room, SOURCE_MENU + owner);
    if (selected !== 0) {
      if (owner === 3) return this.sourceStart(w, "HORSE_DECLINE");
      if (owner === 1) return this.replay("30:2:533:638");
      return this.replay("31:3:264:332");
    }
    if (owner === 1) return this.sourceStart(w, "MATCH_PRE");
    if (owner === 2)
      return this.handSupplies(w)
        ? this.sourceStart(w, "SUPPLIES_GIVE")
        : say(this.doc.text.suppliesRefused);
    return this.handHorse(w) ? this.sourceStart(w, "HORSE_GIVE") : say(this.doc.text.horseRefused);
  }

  // --- CauVongNorthSeaContinuation ---

  private contStart(w: NorthSeaWorld, name: string): FourGatesAction {
    // `start`: a finished vine clears its flag and cues and climbs again.
    if (VINES.includes(name) && this.finished(w, name))
      return {
        kind: "part",
        name: NORTH_SEA_PREFIX + name,
        part: this.doc.parts[name],
        clear: true,
      };
    return this.play(name, this.finished(w, name), name in BATTLES);
  }
  /** `fits(p)`: the pet or the gifts the part hands out have room. */
  private fits(w: NorthSeaWorld, name: string): boolean {
    if (name === "SPIRIT_GIVE") return this.space(w, 34, 1, 29);
    if (name === "WHALE") return this.space(w, 36, 2, 68);
    if (name === "SKY_TRADE" && !this.space(w, 49, 1, 47)) return false;
    if (
      name !== "CHEST_LOOT" &&
      name !== "PENGUIN_GIVE" &&
      name !== "SISTER_GIVE" &&
      name !== "COMPANION_POST" &&
      name !== "SHOP_56_GIFT" &&
      name !== "SKY_TRADE"
    )
      return true;
    return this.doc.parts[name].steps.every(
      (cue) => cue.k !== "award" || w.giftFits(cue as CauVongAward),
    );
  }
  private begin(w: NorthSeaWorld, name: string): FourGatesAction {
    if (!this.fits(w, name)) {
      if (this.contWarning === name) return null;
      this.contWarning = name;
      return say(this.doc.text.full);
    }
    const p = this.doc.parts[name],
      b = BATTLES[name];
    if (b !== undefined && w.done(p.room, RETRY + b) && !w.confirm) return null;
    this.contWarning = null;
    return this.contStart(w, name);
  }
  private contMenu(w: NorthSeaWorld, room: number, owner: number): FourGatesAction {
    w.mark(room, CONT_MENU + owner);
    return {
      kind: "menu",
      owner: CONTINUATION_MENU + owner,
      options: this.doc.menus.continuation[String(owner)],
    };
  }
  /** `startBattle(b, restore)`: 3500+b holds the fight across a reload. */
  private startBattle(w: NorthSeaWorld, b: number, restore: boolean): FourGatesAction {
    const name = battlePart(b),
      p = this.doc.parts[name];
    w.mark(p.room, ACTIVE + b);
    return {
      kind: "battle",
      key: `${NORTH_SEA_PREFIX}${b}`,
      restore: restore ? this.doc.cast[name] : undefined,
    };
  }
  /** `openService`: the farewell (642000) waits for the panel to close. */
  private openService(w: NorthSeaWorld, room: number, action: number): FourGatesAction {
    w.mark(room, CONT_FAREWELL);
    return action === 0 ? { kind: "shop" } : { kind: "bank" };
  }

  private continuation(w: NorthSeaWorld, room: number): FourGatesAction {
    if (!northSeaOwnsRoom(room) || !northSeaShared(room, (r, e) => w.done(r, e))) return null;
    const f = this.doc.flags,
      done = (r: number, e: number) => w.done(r, e),
      fin = (name: string) => this.finished(w, name),
      asked = (source: number) => this.asked(w, room, source);
    // Transfers are recovered first: never restore the question after a committed handoff.
    if (room === 48 && done(48, 51901) && !fin("PENGUIN_GIVE"))
      return this.begin(w, "PENGUIN_GIVE");
    if (room === 48 && done(48, 51902) && !fin("SISTER_GIVE")) return this.begin(w, "SISTER_GIVE");
    if (room === 34 && done(34, 51900) && !fin("SPIRIT_GIVE")) return this.begin(w, "SPIRIT_GIVE");
    if (room === 49 && done(49, 51900) && !fin("SKY_TRADE")) return this.begin(w, "SKY_TRADE");
    for (const owner of Object.keys(this.doc.menus.continuation).map(Number))
      if (done(room, CONT_MENU + owner)) return this.contMenu(w, room, owner);
    if (done(room, CONT_FAREWELL)) {
      w.clear(room, CONT_FAREWELL);
      return this.replay(room === 45 ? `45:3:151:${MAX}` : `56:2:130:${MAX}`);
    }
    for (const name of Object.keys(BATTLES)) {
      const b = BATTLES[name];
      if (this.doc.parts[name].room === room && done(room, ACTIVE + b))
        return this.startBattle(w, b, true);
    }
    // A started phase owns resume even if its spatial trigger is no longer under the player.
    for (const name of this.order) {
      const p = this.doc.parts[name];
      if (p.room === room && done(room, p.started) && !fin(name)) return this.begin(w, name);
    }
    if (room === 27) {
      // CV5b: once the truth is told, the office points back to the academy's laboratory.
      if (done(61, this.doc.flags.explained) && !fin("LAB_HINT")) return this.begin(w, "LAB_HINT");
      if (!fin("COUPLE_NOTICE") && w.at(340, 300, 40, 100)) return this.begin(w, "COUPLE_NOTICE");
      if (done(27, 3514) && !fin("CHEST_POST")) return this.begin(w, "CHEST_POST");
      if (fin("CHEST_POST") && !fin("CHEST_LOOT") && w.at(340, 620, 20, 60))
        return this.begin(w, "CHEST_LOOT");
      if (!done(27, 3514) && w.at(240, 640, 160, 20)) return this.begin(w, "CHEST_PRE");
    }
    if (room === 35 && done(48, 105) && !done(35, 102)) {
      if (done(35, 101)) return this.begin(w, "OLD_RESCUE");
      if (done(35, 100)) return this.begin(w, "OLD_COMMANDER");
      if (w.at(200, 360, 60, 80) || asked(1)) return this.begin(w, "OLD_GUARDS");
    }
    if (room === 48 && done(35, 102) && !done(48, 106) && w.at(320, 40, 20, 60))
      return this.begin(w, "KEY");
    if (room === 30 && done(48, 106) && !fin("RUMOURS")) return this.begin(w, "RUMOURS");
    if (room === 30 && fin("RUMOURS") && !done(30, 107)) return this.begin(w, "DOOR");
    if (room === 61 && done(30, 107)) {
      if (!done(61, 100)) return this.begin(w, "DISCOVERY");
      if (!fin("CAPTURE") && !done(61, 101) && w.at(320, 220, 20, 60))
        return this.begin(w, "CAPTURE");
      if (fin("CAPTURE") && !done(61, 101) && w.at(20, 120, 100, 80))
        return this.begin(w, "EXIT_CLUE");
      if (done(61, 101) && !done(61, 102) && asked(44)) return this.begin(w, "ORDER");
      if (done(48, 107) && !done(61, 104)) {
        if (!fin("SWITCH_NOTICE")) return this.begin(w, "SWITCH_NOTICE");
        if (asked(3)) return this.begin(w, "SWITCH");
      }
      if (done(61, 104) && !done(61, f.explained)) return this.begin(w, "EXPLANATION");
    }
    if (room === 37 && done(61, 102) && !done(37, 100)) {
      if (done(37, 3510)) return this.begin(w, "RESCUE");
      if (w.at(300, 380, 20, 60) || asked(1) || asked(2)) return this.begin(w, "GUARD");
    }
    if (room === 36 && done(37, 100) && !done(36, 101)) {
      if (done(36, 3512)) return this.begin(w, "GHOST_AFTER");
      if (done(36, 100)) return this.begin(w, "GHOST");
      if (w.at(160, 300, 100, 20)) return this.begin(w, "PRINCIPAL");
    }
    if (room === 48 && done(36, 101) && !done(48, 107) && w.at(380, 60, 20, 40))
      return this.begin(w, "RETURN");
    // CV5b: JAR 48:3 waits for 42:0; never open the final before the forest finale.
    if (room === 48 && done(42, f.finale) && !done(48, 120) && w.at(380, 60, 40, 40))
      return this.begin(w, "REOPEN");
    // CV6: the referee (actor 26) runs the three finals.
    if (room === 30 && done(48, 120) && !done(30, 124)) {
      if (!done(30, 120)) return this.begin(w, "FINAL_NOTICE");
      if (nextRound(done) === 3) return this.begin(w, "FINAL_AWARD");
      if (asked(26)) return this.begin(w, "FINAL_OFFER");
    }
    if (room === 29 && done(48, 105) && !fin("SEA_ENTRANCE")) return this.begin(w, "SEA_ENTRANCE");
    if (room === 33) {
      if (!fin("VINE_NOTICE") && w.at(220, 100, 40, 40)) return this.begin(w, "VINE_NOTICE");
      if (fin("VINE_NOTICE") && w.at(240, 120, 20, 20) && w.confirm)
        return this.contMenu(w, room, 2);
    }
    if (room === 34 && !fin("SPIRIT_GIVE")) {
      if (!fin("SPIRIT_NOTICE") && w.at(80, 80, 40, 40)) return this.begin(w, "SPIRIT_NOTICE");
      if (fin("SPIRIT_NOTICE") && asked(52)) return this.begin(w, "SPIRIT_OFFER");
    }
    if (room === 36) {
      if (!fin("WHALE_NOTICE") && w.at(140, 360, 140, 20)) return this.begin(w, "WHALE_NOTICE");
      if (fin("WHALE_GUARDS_AFTER") && !fin("WHALE") && w.at(360, 260, 80, 100)) {
        if (!this.space(w, 36, 2, 68)) return say(this.doc.text.whaleFull);
        return this.begin(w, "WHALE");
      }
    }
    if (room === 53 && !fin("WHALE_GUARDS_AFTER")) {
      if (done(53, 3513)) return this.begin(w, "WHALE_GUARDS_AFTER");
      if (w.at(260, 280, 20, 60)) return this.begin(w, "WHALE_GUARDS");
    }
    if (room === 48) {
      if (done(48, 3515) && !fin("COMPANION_POST")) return this.begin(w, "COMPANION_POST");
      if (done(48, 51901) && !fin("PENGUIN_GIVE")) return this.begin(w, "PENGUIN_GIVE");
      if (done(48, 51902) && !fin("SISTER_GIVE")) return this.begin(w, "SISTER_GIVE");
      if (asked(28)) {
        if (fin("PENGUIN_GIVE")) return this.replay(this.doc.parts.PENGUIN_GIVE.reply!);
        return this.begin(w, fin("PENGUIN_NOTICE") ? "PENGUIN_OFFER" : "PENGUIN_NOTICE");
      }
      if (asked(26)) {
        if (fin("SISTER_GIVE")) return this.replay(this.doc.parts.SISTER_GIVE.reply!);
        if (!done(49, 1)) return say(this.doc.text.sisterAway);
        return this.begin(w, fin("SISTER_NOTICE") ? "SISTER_WAIT" : "SISTER_NOTICE");
      }
      if ((done(24, 1804) || done(24, 100)) && asked(29)) {
        if (fin("COMPANION_POST")) return this.contMenu(w, room, 7);
        return this.begin(w, "COMPANION_OFFER");
      }
    }
    if (room === 30 && asked(44)) return this.begin(w, "ALLIANCE_30");
    if (room === 48 && asked(30)) return this.begin(w, "ALLIANCE_48");
    if (room === 45) {
      if (!fin("SHOP_45")) return this.begin(w, "SHOP_45");
      if (w.at(160, 100, 20, 20) && w.confirm) return this.contMenu(w, room, 8);
      if (asked(20)) return this.begin(w, "SHOP_45_OFFER");
    }
    if (room === 56) {
      if (!fin("SHOP_56_INTRO")) return this.begin(w, "SHOP_56_INTRO");
      if (!fin("SHOP_56_GIFT")) return this.begin(w, "SHOP_56_GIFT");
      if (asked(1)) return this.begin(w, "SHOP_56_OFFER");
      if (asked(2)) return this.begin(w, "BANK_56");
      if (done(23, 100)) {
        if (asked(18)) return this.begin(w, "SKILL_56");
        if (asked(19)) return this.begin(w, "EVOLVE_56");
        if (asked(20)) return this.begin(w, "MUTATION_56");
      }
    }
    // CV0': the hub's two vines down, and Tiểu Song's trade in Thiên Không Chi Thành.
    if (room === SKY_HUB_ROOM) {
      if (w.point(580, 180, 20, 20) && w.confirm) return this.contMenu(w, room, 11);
      if (w.point(80, 180, 20, 20) && w.confirm) return this.contMenu(w, room, 12);
    }
    if (room === SKY_CITY_ROOM) {
      if (done(49, 51900) && !fin("SKY_TRADE")) return this.begin(w, "SKY_TRADE");
      if (asked(4)) {
        if (fin("SKY_TRADE")) return this.replay(this.doc.parts.SKY_TRADE.reply!);
        return this.begin(w, fin("SKY_REQUEST") ? "SKY_OFFER" : "SKY_REQUEST");
      }
      if (!fin("SKY_REQUEST") && w.at(220, 200, 120, 80)) return this.begin(w, "SKY_REQUEST");
    }
    return null;
  }
  /** The continuation's `after(p)`. */
  private contAfter(w: NorthSeaWorld, name: string, room: number): FourGatesAction {
    const b = BATTLES[name];
    if (b !== undefined) return this.startBattle(w, b, false);
    const mark = (r: number, e: number): FourGatesAction => {
      w.mark(r, e);
      return null;
    };
    switch (name) {
      case "OLD_RESCUE":
        return mark(35, 102);
      case "KEY":
        return mark(48, 106);
      case "DOOR":
        return mark(30, 107);
      case "DISCOVERY":
        return mark(61, 100);
      case "EXIT_CLUE":
        return mark(61, 101);
      case "ORDER":
        return mark(61, 102);
      case "RESCUE":
        return mark(37, 100);
      case "GHOST_AFTER":
        return mark(36, 101);
      case "RETURN":
        return mark(48, 107);
      case "SWITCH":
        // `applyProps`: the cages open.
        w.mark(61, 104);
        return { kind: "cast" };
      case "EXPLANATION":
        return mark(61, this.doc.flags.explained);
      case "REOPEN":
        w.mark(48, 120);
        return mark(48, 130);
      case "FINAL_NOTICE":
        return mark(30, 120);
      case "FINAL_OFFER":
        return this.contMenu(w, room, 1);
      case "FINAL_AWARD":
        return mark(30, 124);
      case "SPIRIT_OFFER":
        return this.contMenu(w, room, 3);
      case "PENGUIN_OFFER":
        return this.contMenu(w, room, 4);
      case "SISTER_NOTICE":
      case "SISTER_WAIT":
        return this.finished(w, "SISTER_GIVE") ? null : this.contMenu(w, room, 5);
      case "COMPANION_OFFER":
        return this.contMenu(w, room, 6);
      case "ALLIANCE_30":
      case "ALLIANCE_48":
        return this.contMenu(w, room, 9);
      case "SHOP_45_OFFER":
        return this.contMenu(w, room, 10);
      case "SHOP_56_INTRO":
        return { kind: "shop" };
      case "SHOP_56_OFFER":
        return this.openService(w, room, 0);
      case "BANK_56":
        return { kind: "bank" };
      case "SKILL_56":
        return { kind: "shop", category: 2 };
      case "EVOLVE_56":
        return { kind: "evolve" };
      case "MUTATION_56":
        return { kind: "shop", category: 3 };
      case "VINE_UP":
        return { kind: "exit", room: SKY_HUB_ROOM, x: 590, y: 179, dir: 2 };
      case "VINE_45":
        return { kind: "exit", room: SKY_HUB_ROOM, x: 90, y: 179, dir: 2 };
      case "VINE_DOWN_33":
        return { kind: "exit", room: 33, x: 250, y: 159, dir: 0 };
      case "VINE_DOWN_45":
        return { kind: "exit", room: 45, x: 170, y: 139, dir: 0 };
      case "SKY_OFFER":
        return this.contMenu(w, room, 13);
      case "SKY_TRADE":
        return mark(49, 1);
      default:
        return null;
    }
  }
  private contAnswer(
    w: NorthSeaWorld,
    owner: number,
    chosen: number,
    room: number,
  ): FourGatesAction {
    w.clear(room, CONT_MENU + owner);
    const t = this.doc.text;
    if (owner === 6)
      return chosen === 0
        ? this.replay(this.doc.parts.COMPANION_WAIT.reply!)
        : this.startBattle(w, 10, false);
    if (owner === 7) return chosen === 0 ? this.contStart(w, "COMPANION_REPEAT") : null;
    if (owner === 9) {
      if (chosen === 0) return say(w.allianceUpgrade());
      if (chosen === 1) return say(t.medals.replace("{n}", String(w.claimMedals())));
      if (chosen === 2 || chosen === 3) {
        const info = room === 30 ? "ALLIANCE_30" : "ALLIANCE_48";
        return this.replay(ALLIANCE[info][chosen - 2]);
      }
      return null;
    }
    if (owner === 10)
      return chosen < 2 ? this.openService(w, room, chosen) : this.replay("45:3:151:220");
    if (chosen !== 0) {
      if (owner === 1) return this.contStart(w, "FINAL_DECLINE");
      if (owner === 3) return this.contStart(w, "SPIRIT_DECLINE");
      if (owner === 4) return this.contStart(w, "PENGUIN_DECLINE");
      if (owner === 13) return this.contStart(w, "SKY_DECLINE");
      return null;
    }
    if (owner === 1) return this.contStart(w, FINALS[nextRound((r, e) => w.done(r, e))]);
    if (owner === 3)
      return this.handSpirit(w) ? this.contStart(w, "SPIRIT_GIVE") : say(t.spiritRefused);
    if (owner === 4)
      return this.handPenguin(w) ? this.contStart(w, "PENGUIN_GIVE") : say(t.penguinRefused);
    if (owner === 5)
      return this.handSister(w) ? this.contStart(w, "SISTER_GIVE") : say(t.sisterRefused);
    if (owner === 2) return this.contStart(w, "VINE_UP");
    if (owner === 8) return this.contStart(w, "VINE_45");
    if (owner === 11) return this.contStart(w, "VINE_DOWN_33");
    if (owner === 12) return this.contStart(w, "VINE_DOWN_45");
    if (owner === 13)
      return this.handSkyPair(w) ? this.contStart(w, "SKY_TRADE") : say(t.skyRefused);
    return null;
  }

  // --- CauVongNorthSeaBoat ---

  private boat(w: NorthSeaWorld, room: number): FourGatesAction {
    if (!isNorthSeaRoom(room) || !northSeaShared(room, (r, e) => w.done(r, e))) return null;
    for (let b = 0; b < this.doc.boats.length; b++) {
      const gate = this.doc.boats[b];
      if (gate.room !== room) continue;
      if (w.done(BOAT_ROOM, BOAT_OFFERED + b) && w.point(...gate.rect)) {
        this.embark(w, b);
        return { kind: "hold" };
      }
      if (!w.requested(gate.actor)) continue;
      const ticket = this.doc.items.ticket;
      if (w.itemCount(ticket.id) === 0) w.addItem(ticket, 1);
      this.noticeFor = { kind: "boat", boat: b };
      return this.replay(gate.offer);
    }
    return null;
  }
  /** `begin(b)`: every offer is spent; the route's waypoints start again. */
  private embark(w: NorthSeaWorld, b: number): void {
    for (let i = 0; i < this.doc.boats.length; i++) {
      w.clear(BOAT_ROOM, BOAT_ACTIVE + i);
      w.clear(BOAT_ROOM, BOAT_OFFERED + i);
    }
    for (let i = 0; i < this.doc.boats[b].path.length / 2; i++)
      w.clear(BOAT_ROOM, BOAT_WAYPOINT + b * 100 + i);
    w.mark(BOAT_ROOM, BOAT_ACTIVE + b);
    const hero = w.hero();
    w.steer(hero.x, hero.y, hero.direction, false);
  }

  // --- CauVongSourceRouteGuards (35, 37) and CauVongAmbientSourceRuntime (27, 30) ---

  private guards(w: NorthSeaWorld, room: number): FourGatesAction {
    const done = (r: number, e: number) => w.done(r, e);
    for (const g of GUARDS) {
      if (g.room !== room) continue;
      const eligible =
        g.room === 35
          ? done(35, 102) && !done(61, 102)
          : !done(37, 100) && !done(36, 101) && !done(61, this.doc.flags.explained);
      const [l, t, r, b] = g.rect;
      if (eligible && w.at(l * 20, t * 20, (r - l + 1) * 20, (b - t + 1) * 20))
        return this.play(g.name, false);
    }
    return null;
  }
  private ambient(w: NorthSeaWorld, room: number): FourGatesAction {
    for (const a of AMBIENT) {
      const p = this.doc.parts[a.name];
      if (a.room !== room || w.done(room, p.flag)) continue;
      const rect = a.rect;
      if (
        !rect ||
        w.at(rect[0] * 20, rect[1] * 20, (rect[2] - rect[0] + 1) * 20, (rect[3] - rect[1] + 1) * 20)
      )
        return this.play(a.name, false);
    }
    return null;
  }

  // --- CauVongNorthSeaRoutes ---

  /** `exit(s, boat)`: the native door under the hero, if its gate is open. */
  exit(w: NorthSeaWorld, room: number, boat = false): FourGatesAction {
    const done = (r: number, e: number) => w.done(r, e);
    const sky = room === SKY_CITY_ROOM || room === SKY_HUB_ROOM || isSummonRoom(room);
    if (!sky && (!isNorthSeaRoom(room) || !northSeaShared(room, done))) return null;
    const doors = (sky ? this.doc.skyDoors : this.doc.doors)[String(room)] ?? [];
    for (let i = 0; i < doors.length; i++) {
      const [tx, ty, target, x, y, dir, terrain] = doors[i];
      if (room === SKY_HUB_ROOM && !summonCanEnter(target, w.roster(), done)) continue;
      // Do not turn water crossings into free teleports on foot.
      const water = room !== 27 && !isSummonRoom(room) && terrain === 2;
      if (water && !boat && !w.waterRide()) continue;
      if (room === 27 && target === 28 && !done(9, 114)) continue;
      if (room === 30 && target === 61 && !done(30, 107)) continue;
      if (
        room === 29 &&
        target === 35 &&
        (!done(48, 105) || !w.roster().some((pet) => pet.level >= 88))
      )
        continue;
      if (room === 35 && target === 36 && !done(61, 102)) continue;
      if (!this.atDoor(w, room, tx, ty, terrain)) continue;
      let to = { room: target, x, y, dir };
      if (target === -1) {
        // 255: back to the entrance that opened the shared shop.
        let back = this.doc.shopReturn[0];
        for (const row of this.doc.shopReturn)
          if (done(56, SHOP_ENTRY + row[0])) {
            back = row;
            break;
          }
        to = { room: 30, x: back[1], y: back[2], dir: back[3] };
      }
      if (to.room === 45 || to.room === 56) w.mark(to.room, SHARED);
      if (to.room === 56)
        doors.forEach((_, j) => {
          if (j === i) w.mark(56, SHOP_ENTRY + j);
          else if (done(56, SHOP_ENTRY + j)) w.clear(56, SHOP_ENTRY + j);
        });
      return { kind: "exit", room: to.room, x: to.x, y: to.y, dir: to.dir };
    }
    return null;
  }
  /** `atDoor`: the door's tile, or (30) a facade door from the floor beside it, facing it. */
  private atDoor(w: NorthSeaWorld, room: number, tx: number, ty: number, terrain: number): boolean {
    if (w.point(tx * 20, ty * 20, 20, 20)) return true;
    if ((room !== 30 && room !== SKY_HUB_ROOM) || terrain !== 1) return false;
    const facing = w.hero().direction;
    for (const [ax, ay, face] of [
      [0, 1, 2],
      [0, -1, 0],
      [-1, 0, 1],
      [1, 0, 3],
    ]) {
      const x = (tx + ax) * 20,
        y = (ty + ay) * 20;
      if (facing === face && w.terrain(x + 10, y + 19) === 0 && w.point(x, y, 20, 20)) return true;
    }
    return false;
  }

  // --- CauVongNorthSeaNpcRuntime ---

  private npcs(w: NorthSeaWorld, room: number): FourGatesAction {
    const done = (r: number, e: number) => w.done(r, e);
    if (!northSeaOwnsRoom(room) || !northSeaShared(room, done)) return null;
    if (done(room, NPC_MENU + 1)) return this.merchantMenu(w, room);
    if (done(room, NPC_MENU + 2)) return this.allianceMenu(w, room);
    const merchant = this.doc.merchants[String(room)];
    if (done(room, NPC_FAREWELL)) {
      w.clear(room, NPC_FAREWELL);
      return merchant ? this.replay(`${room}:${merchant.event}:146:${MAX}`) : null;
    }
    // Native 34:2, actor 31, opcode 16(0,5): the North Sea hatchery opens the shared five slots.
    if (room === 34 && this.asked(w, 34, 31)) return { kind: "incubator" };
    if (merchant && w.requested(merchant.actor)) {
      this.noticeFor = { kind: "merchant" };
      return this.replay(`${room}:${merchant.event}:0:60`);
    }
    // 49's alliance clerk (source 8): `reply(4, 0, 140)`, then menu 2.
    if (room === SKY_CITY_ROOM && this.asked(w, 49, 8)) {
      this.noticeFor = { kind: "alliance" };
      return this.replay("49:4:0:140");
    }
    for (const npc of this.doc.passives[String(room)] ?? [])
      if (w.requested(npc.actorId)) return { kind: "text", steps: [npc.say] };
    return null;
  }
  private merchantMenu(w: NorthSeaWorld, room: number): FourGatesAction {
    w.mark(room, NPC_MENU + 1);
    return { kind: "menu", owner: MERCHANT_MENU, options: MERCHANT_OPTIONS };
  }
  private allianceMenu(w: NorthSeaWorld, room: number): FourGatesAction {
    w.mark(room, NPC_MENU + 2);
    return { kind: "menu", owner: ALLIANCE_MENU, options: this.doc.menus.continuation["9"] };
  }
  private allianceAnswer(w: NorthSeaWorld, selected: number, room: number): FourGatesAction {
    w.clear(room, NPC_MENU + 2);
    if (selected === 0) return say(w.allianceUpgrade());
    if (selected === 1) return say(this.doc.text.npcMedals.replace("{n}", String(w.claimMedals())));
    if (selected === 2) return this.replay("49:4:282:1701");
    if (selected === 3) return this.replay("49:4:1701:1892");
    return null;
  }
  private merchantAnswer(w: NorthSeaWorld, selected: number, room: number): FourGatesAction {
    w.clear(room, NPC_MENU + 1);
    const merchant = this.doc.merchants[String(room)];
    if (selected < 2) {
      w.mark(room, NPC_FAREWELL);
      return selected === 0 ? { kind: "shop" } : { kind: "bank" };
    }
    return merchant ? this.replay(`${room}:${merchant.event}:146:${MAX}`) : null;
  }

  // --- CauVongNorthSeaTransactions ---

  private handSupplies(w: NorthSeaWorld): boolean {
    if (w.done(31, 51900)) return true;
    if (!this.space(w, 31, 1, 83)) return false;
    const supplies = this.doc.items.supplies;
    if (supplies.some((id) => w.itemCount(id) < 5)) return false;
    for (const id of supplies) w.removeItem(id, 5);
    w.mark(31, 51900);
    return true;
  }
  private handSpirit(w: NorthSeaWorld): boolean {
    if (w.done(34, 51900)) return true;
    const item = this.doc.items.spirit;
    if (!this.space(w, 34, 1, 29) || w.itemCount(item) < 1) return false;
    w.removeItem(item, 1);
    w.mark(34, 51900);
    return true;
  }
  /** `handHorse`: the first Thiên Mã one-horn (147) of the party. */
  private handHorse(w: NorthSeaWorld): boolean {
    if (w.done(27, 51900)) return true;
    if (!this.space(w, 27, 7, 58)) return false;
    const slot = w.roster().findIndex((pet) => pet.speciesId === 147);
    if (slot < 0 || !w.releaseSlot(slot)) return false;
    w.mark(27, 51900);
    return true;
  }
  private handPenguin(w: NorthSeaWorld): boolean {
    return this.handPet(w, 174, 51, 51901, "PENGUIN_GIVE");
  }
  private handSister(w: NorthSeaWorld): boolean {
    return w.done(49, 1) && this.handPet(w, 147, 70, 51902, "SISTER_GIVE");
  }
  /**
   * `handSkyPair`: the first Thiên Sứ Cua (177) and Rùa ma biển sâu (181) at level 85+ without
   * equipment leave together, once another pet lives and the gifts fit.
   */
  private handSkyPair(w: NorthSeaWorld): boolean {
    if (w.done(49, 51900)) return true;
    if (!this.fits(w, "SKY_TRADE")) return false;
    const roster = w.roster();
    let first = -1,
      second = -1;
    roster.forEach((pet, i) => {
      if (pet.level < 85 || pet.held >= 0) return;
      if (pet.speciesId === 177 && first < 0) first = i;
      if (pet.speciesId === 181 && second < 0) second = i;
    });
    if (first < 0 || second < 0) return false;
    if (!roster.some((pet, i) => i !== first && i !== second && pet.hp > 0)) return false;
    for (const slot of [Math.max(first, second), Math.min(first, second)])
      if (!w.releaseSlot(slot)) throw new Error("Preflighted ocean pair failed");
    w.mark(49, 51900);
    return true;
  }
  /** `handPet`: the lowest such pet without equipment leaves, once its gifts fit. */
  private handPet(
    w: NorthSeaWorld,
    species: number,
    minimum: number,
    receipt: number,
    gifts: string,
  ): boolean {
    if (w.done(48, receipt)) return true;
    if (!this.fits(w, gifts)) return false;
    const roster = w.roster();
    let slot = -1;
    roster.forEach((pet, i) => {
      if (
        pet.speciesId === species &&
        pet.held < 0 &&
        pet.level >= minimum &&
        (slot < 0 || pet.level < roster[slot].level)
      )
        slot = i;
    });
    if (slot < 0 || !w.releaseSlot(slot)) return false;
    w.mark(48, receipt);
    return true;
  }

  // --- the ends ---

  /** A part is over (its flag already written). */
  after(w: NorthSeaWorld, name: string, room: number): FourGatesAction {
    const part = name.slice(NORTH_SEA_PREFIX.length);
    if (part.startsWith("GUARD_")) {
      // The pushback repeats: its start and checkpoints are cleared.
      const p = this.doc.parts[part];
      w.clear(p.room, p.started);
      for (let i = 0; i < 1000; i++) w.clear(p.room, p.cue + i);
      return null;
    }
    if (part.startsWith("AMBIENT_")) return null;
    if (SOURCE.includes(part)) return this.sourceAfter(w, part, room);
    return this.contAfter(w, part, room);
  }
  /** A text is over: the boat's offer is open, or a merchant's menu follows. */
  notice(w: NorthSeaWorld, room: number): FourGatesAction {
    const notice = this.noticeFor;
    this.noticeFor = null;
    if (notice?.kind === "boat") {
      w.mark(BOAT_ROOM, BOAT_OFFERED + notice.boat);
      if (notice.boat === 0) w.mark(28, 101);
      return null;
    }
    if (notice?.kind === "merchant") return this.merchantMenu(w, room);
    if (notice?.kind === "alliance") return this.allianceMenu(w, room);
    return null;
  }
  /** A menu's answer. */
  answer(w: NorthSeaWorld, owner: number, selected: number, room: number): FourGatesAction {
    if (owner === MERCHANT_MENU) return this.merchantAnswer(w, selected, room);
    if (owner === ALLIANCE_MENU) return this.allianceAnswer(w, selected, room);
    if (owner > CONTINUATION_MENU)
      return this.contAnswer(w, owner - CONTINUATION_MENU, selected, room);
    return this.sourceAnswer(w, owner - NORTH_SEA_MENU_BASE, selected, room);
  }
  /** `handleBattleResult`, keyed "sea:match" or "sea:<b>". */
  result(w: NorthSeaWorld, key: string, won: boolean): FourGatesAction {
    const battle = key.slice(NORTH_SEA_PREFIX.length),
      t = this.doc.text,
      f = this.doc.flags;
    if (battle === "match") {
      w.clear(30, f.matchPending);
      if (won) {
        w.mark(30, f.matchWon);
        return this.sourceStart(w, "MATCH_POST");
      }
      w.mark(30, f.matchRetry);
      return say(t.matchLost);
    }
    const b = Number(battle),
      name = battlePart(b),
      p = this.doc.parts[name];
    w.clear(p.room, ACTIVE + b);
    // OLD_COMMANDER's defeat is the story's (SCRIPTED_EVENT_CONTINUE: result 0).
    if (!won && !this.doc.battles[battle]?.lossContinues) {
      // Re-enter through the same interaction/trigger; do not resume a losing battle automatically.
      w.mark(p.room, RETRY + b);
      w.clear(p.room, p.started);
      w.clear(p.room, p.flag);
      for (let i = 0; i < 400; i++) w.clear(p.room, p.cue + i);
      return say(t.lost);
    }
    w.clear(p.room, RETRY + b);
    const next = (r: number, e: number, part: string): FourGatesAction => {
      w.mark(r, e);
      return this.contStart(w, part);
    };
    switch (b) {
      case 0:
        return next(35, 100, "OLD_COMMANDER");
      case 1:
        return next(35, 101, "OLD_RESCUE");
      case 2:
        return next(37, 3510, "RESCUE");
      case 3:
        return next(36, 100, "GHOST");
      case 4:
        return next(36, 3512, "GHOST_AFTER");
      case 5:
      case 6:
        return next(30, 121 + b - 5, b === 5 ? "FINAL_2" : "FINAL_3");
      case 7:
        return next(30, 123, "FINAL_AWARD");
      case 8:
        return next(53, 3513, "WHALE_GUARDS_AFTER");
      case 9:
        return next(27, 3514, "CHEST_POST");
      case 10:
        w.mark(48, 3515);
        return this.begin(w, "COMPANION_POST");
      default:
        return say(t.rematchWon);
    }
  }
}

const MERCHANT_OPTIONS = ["Mua / bán", "Gửi pet", "Rời đi"];
/** 9's "Liên minh nói rõ" / "Cách mở" (`ALLIANCE_30_INFO` … `ALLIANCE_48_TIP`). */
const ALLIANCE: Record<string, string[]> = {
  ALLIANCE_30: ["30:11:620:2027", "30:11:2027:2224"],
  ALLIANCE_48: ["48:14:732:2151", "48:14:2151:2342"],
};

/** The CV5 owners' `applyCast`s for `room` (the arrival's, the source's, the continuation's). */
export function northSeaCast(
  doc: CauVongNorthSeaDocument,
  room: number,
  done: (room: number, event: number) => boolean,
): { cues: CauVongCue[]; visible: [number, boolean][]; state: [number, number][] } {
  const cast = {
    cues: [] as CauVongCue[],
    visible: [] as [number, boolean][],
    state: [] as [number, number][],
  };
  if (!northSeaOwnsRoom(room)) return cast;
  const finished = (name: string) => done(doc.parts[name].room, doc.parts[name].flag);
  // `CauVongNorthSeaArrivalCutscene.applyCast`: An Kỳ Nhi waits hidden on 28's dock.
  if (room === 28) {
    cast.visible.push([146, false]);
    cast.state.push([146, 2]);
  }
  // `CauVongNorthSeaSourceRuntime.applyCast`.
  if ((room >= 27 && room <= 34) || room === 48) {
    for (const name of SOURCE)
      if (doc.parts[name].room === room && finished(name))
        cast.cues.push(...(doc.cast[name] ?? []));
    // LEAD_NOTICE was appended later; its pose must not override the completed departure.
    if (room === 30 && finished("LEAD")) cast.cues.push(...doc.cast.LEAD);
    if (room === 48 && done(30, 104) && !done(48, 105))
      cast.cues.push({ k: "place", id: 146, x: 240, y: 100 }, { k: "show", id: 146, on: true });
    if (room === 30 && done(30, doc.flags.matchWon) && !done(30, 102))
      cast.cues.push(...doc.cast.MATCH_PRE);
  }
  // `CauVongNorthSeaContinuation.applyCast`.
  for (const name of Object.keys(doc.parts)) {
    const p = doc.parts[name];
    if (p.flag < 3000 || p.flag >= 3100 || p.room !== room || !done(room, p.flag)) continue;
    cast.cues.push(...(doc.cast[name] ?? []));
  }
  // After the forest finale An Kỳ Nhi waits at the square's north door until REOPEN.
  if (room === 48 && done(42, doc.flags.finale) && !done(48, 120)) {
    const girl = doc.actors["48"]?.["1"];
    if (girl !== undefined)
      cast.cues.push({ k: "place", id: girl, x: 160, y: 60 }, { k: "show", id: girl, on: true });
  }
  if (room === 61)
    for (const [id, visible, state] of doc.props61[done(61, 104) ? 1 : 0]) {
      cast.visible.push([id, visible === 1]);
      cast.state.push([id, state]);
    }
  if (room === 56 && northSeaShared(room, done) && done(23, 100))
    cast.cues.push(...doc.cast.SERVICES_56);
  if (room === 48 && (done(24, 1804) || done(24, 100))) {
    const companion = doc.actors["48"]?.["29"];
    if (companion !== undefined) cast.visible.push([companion, true]);
  }
  return cast;
}
