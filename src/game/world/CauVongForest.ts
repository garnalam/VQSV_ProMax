// JavaSE parity: main quest CV4b "Cầu Vồng — Bốn Cổng", stages 4–6. `CauVongChapterRuntime.tick` hands
// the first visit to Rừng U Ám (38–40) to `CauVongDarkForestSourceRuntime` (its `priority` ahead of Lạc
// Khắc's chain, its `tick` after the academy owners), room 60 to `CauVongAcademyLaboratoryRuntime`
// (DEPART into the forest, the way back to 10), 10's way up to 60 to the chapter itself, the north
// gate's rooms to `CauVongNorthGateRuntime` (24's first-visit line, 26's `CauVongNorthRescueCutscene`)
// and the dorm's morning after to `CauVongNorthRecoveryCutscene` (59, ahead of the academy owners).
// CV5b (61:105 → 42:103) runs on the same owners: `CauVongAcademyLaboratoryRuntime.tickAcademyDoor`
// (2's laboratory door, the key 9006), its `tick` in 62 (the discovery, three switches, the
// betrayal) and 60 (the farewell, actor 6's advice and gifts), and the late forest (the general's
// guards in 39–41, the principal and Rafael in 42 on `CauVongFinalBattleBalance`'s teams, the
// aftermath; 41's merchant). Lạc Khắc's rescue in 39 is `CauVongLocke.ts`.
//
// Bug fix against JavaSE: `CauVongDarkForestSourceRuntime.exit` answers true for a door the route
// keeps shut, and `tick` returns before `tickFreeWorldPlayer` while that is so, so a hero who walks
// onto a shut door tile (39 → 40 after the first visit, 40 → 41 before the late return) can never
// move again. On the web a shut door simply does not take him; he keeps walking.
//
// Bug fix against JavaSE (CV5b): in 60 the native actors 10/11 stand on the spots, in the look, of
// the cue's 152/153 (Nam Cung Vân, source actors 5/6) and win `keyboardFocus` by the lower id, so
// Java never hands actor 6 the key: its advice and the 2/4/6/11 ×2 gifts can never start (a Java
// probe gives `requested(11)=true`, `requested(153)=false`). The bake lists such `twins`, and the
// web takes 5 on the native twin as 5 on the made actor (`requestedOrTwin`).
//
// The sequences and the owners' own lines are baked by rebuild_game/tools/WebCauVongForest.java
// (`cau-vong-world/forest.json`); this file is the owners' decisions.
import type { AcademyBattle } from "./CauVongAcademy";
import type { CauVongCue, CauVongPart } from "./CauVongCutscene";
import type { FourGatesAction, FourGatesWorld } from "./CauVongFourGates";

type Say = Extract<CauVongCue, { k: "say" }>;
type Line = { speaker: string; text: string };

export type CauVongForestDocument = {
  parts: Record<string, CauVongPart>;
  cast: Record<string, CauVongCue[]>;
  /** `actorId(s, room, source)`, by room then source actor. */
  actors: Record<string, Record<string, number>>;
  /** `CauVongNorthSeaNpcRuntime.passives`. */
  passives: Record<string, { actorId: number; say: Say }[]>;
  /** Native doors: [tileX, tileY, target, x, y, dir], by room. */
  doors: Record<string, [number, number, number, number, number, number][]>;
  /** `request(b)` keyed by b, and the north rescue's. */
  battles: Record<string, AcademyBattle>;
  text: { lost: Line; north24: Line; rescueLost: Line; labLocked: Line; labNoKey: Line };
  /** `CauVongRockObstacles`: the rocks of each room that has some. */
  rocks: Record<string, CauVongRock[]>;
  /** `resetCast(room, event)` a part's first `start` plays ahead of it (RAFAEL). */
  resets: Record<string, CauVongCue[]>;
  /** Asked actors a fresh room lacks: their snapshot and talk role, by room then actor id. */
  talkers: Record<string, Record<string, unknown>>;
  /**
   * Made actors drawn on a native twin (same look and spot), by room then made id: the native id.
   * Java's `keyboardFocus` hands the key to the twin (lower id), so 60's actor 6 never hears it.
   */
  twins: Record<string, Record<string, number>>;
  /** 62: the switches' spots (`nearProp`) and `applyProps` as [actorId, role, state]. */
  lab: { switches: [number, number][]; props: [number, number, number][] };
  flags: {
    raid: number;
    labComplete: number;
    farewell: number;
    rescueWon: number;
    rescueStarted: number;
    rescueEscaped: number;
    rescueRetry: number;
    recoveryPending: number;
    recoveryComplete: number;
    metalRide: number;
    principalWon: number;
    experimentWon: number;
    finaleComplete: number;
    labDiscovered: number;
    labFirstSwitch: number;
    doorStarted: number;
    doorOpened: number;
    explained: number;
    tournamentComplete: number;
    northSeaKey: number;
  };
};
export type CauVongRock = {
  actorId: number;
  canonical: number;
  x: number;
  y: number;
  /** The prop's `animationState`; the break plays the next one. */
  state: number;
  hint: string;
};

/** `CauVongDarkForestRuntime.owns`: 38–40 from CV4b, 41/42 from CV5b. */
export const FOREST_ROOMS = [38, 39, 40, 41, 42] as const;
export const isForestRoom = (room: number) => (FOREST_ROOMS as readonly number[]).includes(room);
export const LAB_ROOM = 60;
/** The laboratory itself (`CauVongAcademyLaboratoryRuntime.tick` in 62). */
export const LABORATORY_ROOM = 62;
const ACADEMY_YARD = 2;
/** `SourcePhase` in declaration order (the resume loop walks it so); DEPART keeps its CV4b name. */
const LAB_PHASES = [
  "LAB_DISCOVERY",
  "LAB_SWITCH0",
  "LAB_SWITCH1",
  "LAB_SWITCH2",
  "LAB_BETRAYAL",
  "LAB_GOODBYE",
  "LAB_ADVICE",
  "DEPART",
  "LAB_OVERVIEW",
] as const;
const LOST_PET_CHAMBER = 10;
const NORTH_SKY = 24;
const NORTH_RESCUE = 26;
const DORM = 59;
const INTRO = 100;
/** Forest menus, numbered past the four gates' 1–7 so the answers find their owner. */
export const FOREST_MERCHANT_MENU = 11;
export const FOREST_ALLIANCE_MENU = 12;
const MERCHANT_OPTIONS = ["Mua", "Bán", "Gửi pet", "Rời đi"];
const ALLIANCE_OPTIONS = ["Đẳng cấp huấn luyện viên", "Đổi huy chương", "Liên minh", "Lời khuyên"];
/**
 * `battlePart(b)` / `post(b)` / `opponent(b)`. PRINCIPAL is baked as FOREST_PRINCIPAL (the North
 * Sea continuation has a PRINCIPAL too); Rafael's reveal is both the principal's post and fight 4.
 */
const BATTLES: Record<number, { pre: string; post: string; opponent: number }> = {
  0: { pre: "GUARD_39", post: "AFTER_39", opponent: 25 },
  1: { pre: "GUARD_40", post: "AFTER_40", opponent: 38 },
  2: { pre: "GUARD_41", post: "AFTER_41", opponent: 26 },
  3: { pre: "FOREST_PRINCIPAL", post: "RAFAEL", opponent: 19 },
  4: { pre: "RAFAEL", post: "AFTERMATH", opponent: 21 },
  5: { pre: "GIRL_PRE", post: "GIRL_POST", opponent: 31 },
};
const battleOf = (name: string) => {
  for (const [b, row] of Object.entries(BATTLES)) if (row.pre === name) return Number(b);
  return -1;
};

/** What the forest owners read and write beyond the four gates' world. */
export interface ForestWorld extends FourGatesWorld {
  /** `playerSourcePointInRect`. */
  point(x: number, y: number, width: number, height: number): boolean;
  confirm: boolean;
  show(id: number, visible: boolean): void;
  visible(id: number): boolean;
  /** `PetSourceAdapter.reviveFull` and `statusState.clearAll` over the roster. */
  revive(): void;
}

/** `CauVongDarkForestSourceRuntime.nativeArrival`: the tile, the source facing, the spot. */
function nativeArrival(room: number, tx: number, ty: number, source: number): FourGatesAction {
  const dir = source === 1 ? 2 : source === 2 ? 0 : source === 3 ? 3 : 1;
  return {
    kind: "exit",
    room,
    x: tx * 20 + 10 + (dir === 1 ? 20 : dir === 3 ? -20 : 0),
    y: ty * 20 + 19 + (dir === 0 ? 20 : dir === 2 ? -20 : 0),
    dir,
  };
}

/**
 * `CauVongDarkForestSourceRuntime`, `CauVongAcademyLaboratoryRuntime` (60), the north gate's rescue
 * and the dorm's morning after.
 */
export class ForestOwner {
  /** The Part names with a flag, in ordinal order. */
  private readonly order: string[];

  constructor(
    private readonly doc: CauVongForestDocument,
    /** The four gates' "Nhận {n} huy chương…" template. */
    private readonly medals: string,
  ) {
    this.order = Object.keys(doc.parts)
      .filter((name) => doc.parts[name].flag >= 6000 && doc.parts[name].flag < 6100)
      .sort((a, b) => doc.parts[a].flag - doc.parts[b].flag);
  }

  owns(name: string): boolean {
    return name in this.doc.parts;
  }
  private finished(w: FourGatesWorld, name: string): boolean {
    const p = this.doc.parts[name];
    return w.done(p.room, p.flag);
  }
  private id(room: number, source: number): number {
    return this.doc.actors[String(room)]?.[String(source)] ?? -1;
  }
  /** `asked(source)`: 5 on the actor (consumed with it). */
  private asked(w: ForestWorld, room: number, source: number): boolean {
    const id = this.id(room, source);
    return id >= 0 && w.requested(id);
  }
  /**
   * `asked(source)`, also taken on the native twin under the made actor. Web fix of a JavaSE bug:
   * in 60 natives 10/11 sit under 152/153 with the same look, win `keyboardFocus` by lower id,
   * and actor 6's advice (and its gifts) could never start.
   */
  private requestedOrTwin(w: ForestWorld, room: number, source: number): boolean {
    const id = this.id(room, source);
    if (id < 0) return false;
    if (w.requested(id)) return true;
    const twin = this.doc.twins?.[String(room)]?.[String(id)];
    return twin !== undefined && w.requested(twin);
  }
  /** `at(x1, y1, x2, y2)`: the hero's point in those tiles. */
  private at(w: ForestWorld, x1: number, y1: number, x2: number, y2: number): boolean {
    return w.point(x1 * 20, y1 * 20, (x2 - x1 + 1) * 20, (y2 - y1 + 1) * 20);
  }
  private late(w: FourGatesWorld): boolean {
    return w.done(62, this.doc.flags.labComplete) && w.done(60, this.doc.flags.farewell);
  }
  /** `CauVongAcademyLaboratoryRuntime.firstForestVisitComplete`. */
  firstVisitComplete(w: FourGatesWorld): boolean {
    return this.finished(w, "GIRL_POST") || w.done(40, 6400) || w.done(40, 101);
  }
  /** `CauVongAcademyLaboratoryRuntime.forestRouteUnlocked`. */
  routeUnlocked(w: FourGatesWorld): boolean {
    return (
      w.done(9, this.doc.flags.raid) ||
      w.done(9, 7) ||
      w.done(38, INTRO) ||
      this.firstVisitComplete(w) ||
      (w.done(62, this.doc.flags.labComplete) && w.done(60, this.doc.flags.farewell))
    );
  }

  /**
   * `start(p)`: the part; `started` is marked by its script. RAFAEL's first start puts 42:0's cast
   * back first (`resetCast`).
   */
  private start(name: string, w?: FourGatesWorld): FourGatesAction {
    const part = this.doc.parts[name];
    const reset =
      name === "RAFAEL" && w && !w.done(part.room, part.started)
        ? this.doc.resets.RAFAEL
        : undefined;
    return reset ? { kind: "part", name, part, restore: reset } : { kind: "part", name, part };
  }
  /** `startRepeat`: the part's flag and checkpoints cleared first. */
  private startRepeat(name: string): FourGatesAction {
    return { kind: "part", name, part: this.doc.parts[name], clear: true };
  }
  private say(line: Line): FourGatesAction {
    return {
      kind: "text",
      steps: [{ k: "say", speaker: line.speaker, text: line.text, portrait: -1 }],
    };
  }
  /** `startBattle(b, restore)`: the fight marked active; a resumed one restores its scene first. */
  private startBattle(w: FourGatesWorld, b: number, restore: boolean): FourGatesAction {
    const p = this.doc.parts[BATTLES[b].pre];
    w.mark(p.room, 6200 + b);
    return { kind: "battle", key: `forest:${b}`, restore: restore ? p.steps : undefined };
  }
  private retryAllowed(w: ForestWorld, b: number): boolean {
    return !w.done(this.doc.parts[BATTLES[b].pre].room, 6250 + b) || w.confirm;
  }
  /** `challengeRequested`: 5 on the opponent, or the trigger (a retry waits for 5 there). */
  private challengeRequested(w: ForestWorld, room: number, b: number, trigger: boolean): boolean {
    return this.asked(w, room, BATTLES[b].opponent) || (trigger && this.retryAllowed(w, b));
  }
  /** `restoreRetryOpponent`: a lost fight's opponent stands again. */
  private restoreRetryOpponent(w: ForestWorld, room: number): void {
    for (const [key, row] of Object.entries(BATTLES)) {
      const b = Number(key),
        p = this.doc.parts[row.pre];
      if (
        p.room !== room ||
        !w.done(room, 6250 + b) ||
        w.done(room, 6300 + b) ||
        w.done(room, 6200 + b) ||
        w.done(room, p.started)
      )
        continue;
      if (
        (b < 4 && w.done(room, 101)) ||
        (b === 4 && w.done(42, 102)) ||
        (b === 5 && this.firstVisitComplete(w))
      )
        continue;
      const id = this.id(room, row.opponent);
      if (id >= 0 && !w.visible(id)) w.show(id, true);
    }
  }

  /** `priority`: what the forest takes ahead of Lạc Khắc's chain (39). */
  priority(w: ForestWorld, room: number): boolean {
    if (!isForestRoom(room)) return false;
    this.restoreRetryOpponent(w, room);
    for (const [key, row] of Object.entries(BATTLES))
      if (this.doc.parts[row.pre].room === room && w.done(room, 6200 + Number(key))) return true;
    for (const name of this.order) {
      const p = this.doc.parts[name];
      if (p.room === room && w.done(room, p.started) && !w.done(room, p.flag)) return true;
    }
    if (room === 39 && !w.done(39, INTRO)) return true;
    return (
      room === 39 &&
      this.late(w) &&
      !w.done(39, 101) &&
      (this.at(w, 7, 28, 9, 28) || this.asked(w, 39, 25))
    );
  }

  /** `tick` in 38–42, past the sequence/menu/battle the world itself runs. */
  tick(w: ForestWorld, room: number): FourGatesAction {
    if (!isForestRoom(room)) return null;
    const finished = (name: string) => this.finished(w, name);
    const f = this.doc.flags;
    this.restoreRetryOpponent(w, room);
    for (const [key, row] of Object.entries(BATTLES))
      if (this.doc.parts[row.pre].room === room && w.done(room, 6200 + Number(key)))
        return this.startBattle(w, Number(key), true);
    for (const name of this.order) {
      const p = this.doc.parts[name];
      if (p.room === room && w.done(room, p.started) && !w.done(room, p.flag))
        return this.start(name, w);
    }
    if (room === 38 && w.done(60, 1501) && !finished("PORTAL_ARRIVE"))
      return this.start("PORTAL_ARRIVE");
    if (room === 38 && !w.done(38, INTRO)) return this.start("PERMISSION");
    if (room === 39 && !w.done(39, INTRO)) return this.start("BLUE_TRAIL");
    for (const b of [0, 1, 2, 3, 4])
      if (
        this.doc.parts[BATTLES[b].pre].room === room &&
        w.done(room, 6300 + b) &&
        !finished(BATTLES[b].post) &&
        !(b === 3 && w.done(room, 6254))
      )
        return this.start(BATTLES[b].post, w);
    if (room === 39 && finished("GIRL_POST") && !finished("CITY_RETURN") && !w.done(40, 101))
      return this.start("CITY_RETURN");
    if (room === 42 && w.done(42, f.experimentWon) && !w.done(42, f.finaleComplete))
      return this.start("AFTERMATH");
    if (room === 42 && w.done(42, f.principalWon) && !w.done(42, f.experimentWon)) {
      if (!w.done(42, 6254) || this.challengeRequested(w, room, 4, false))
        return this.start("RAFAEL", w);
    }
    if (
      room === 39 &&
      this.late(w) &&
      !w.done(39, 101) &&
      this.challengeRequested(w, room, 0, this.at(w, 7, 28, 9, 28))
    )
      return this.start("GUARD_39");
    if (room === 40) {
      if (!finished("GIRL_POST") && !w.done(40, 101)) {
        if (w.done(40, 6305)) return this.start("GIRL_POST");
        if (this.challengeRequested(w, room, 5, this.at(w, 13, 19, 17, 22)))
          return this.start("GIRL_PRE");
      }
      if (
        this.late(w) &&
        !w.done(40, 101) &&
        (finished("GIRL_POST") || w.done(40, 6400)) &&
        this.challengeRequested(w, room, 1, this.at(w, 14, 6, 17, 6))
      )
        return this.start("GUARD_40");
    }
    if (
      room === 41 &&
      this.late(w) &&
      !w.done(41, 101) &&
      this.challengeRequested(w, room, 2, this.at(w, 16, 13, 19, 13))
    )
      return this.start("GUARD_41");
    if (
      room === 42 &&
      this.late(w) &&
      !w.done(42, 101) &&
      this.challengeRequested(w, room, 3, this.at(w, 6, 16, 9, 16))
    )
      return this.start("FOREST_PRINCIPAL");
    if (room === 38 && this.asked(w, 38, 13))
      return this.startRepeat(finished("MERCHANT_38") ? "MERCHANT_38_OFFER" : "MERCHANT_38");
    if (room === 41 && this.asked(w, 41, 31)) return this.startRepeat("MERCHANT_41_OFFER");
    if (room === 39 && this.asked(w, 39, 26)) return this.startRepeat("ALLIANCE_OFFER");
    if (room === 38 && this.at(w, 3, 7, 3, 7) && w.confirm) return this.startRepeat("PORTAL_BACK");
    for (const npc of this.doc.passives[String(room)] ?? [])
      if (w.requested(npc.actorId)) return { kind: "text", steps: [npc.say] };
    return null;
  }

  /**
   * `exit`: the door under the hero, unless the route keeps it shut (then nothing: see the header's
   * bug fix). First visit: 38 → 39 once permitted, 39 → 40 until the girl is rescued, no further.
   */
  exit(w: ForestWorld, room: number): FourGatesAction {
    for (const [tx, ty, target, x, y, dir] of this.doc.doors[String(room)] ?? []) {
      if (!w.point(tx * 20, ty * 20, 20, 20)) continue;
      if (target > room && room >= 39 && room <= 41) {
        if (this.late(w) && !w.done(room, 101)) return null;
        if (!this.late(w) && (room >= 40 || this.firstVisitComplete(w))) return null;
      }
      if (room === 38 && target === 39 && !w.done(38, INTRO)) return null;
      return { kind: "exit", room: target, x, y, dir };
    }
    return null;
  }

  /**
   * `CauVongAcademyLaboratoryRuntime.tick` in 62 (the discovery, the overview, three switches, the
   * betrayal, the way back to 2) and 60 (the farewell, actor 6's advice, DEPART, the way to 10).
   */
  lab(w: ForestWorld, room: number): FourGatesAction {
    const f = this.doc.flags;
    // A started phase resumes first, whatever is under the hero.
    for (const name of LAB_PHASES) {
      const p = this.doc.parts[name];
      if (p.room === room && w.done(room, p.started) && !w.done(room, p.flag))
        return this.start(name);
    }
    if (room === LABORATORY_ROOM) {
      if (!w.done(62, f.labDiscovered)) return this.start("LAB_DISCOVERY");
      if (
        !w.done(62, f.labComplete) &&
        !w.done(62, this.doc.parts.LAB_OVERVIEW.flag) &&
        w.at(240, 60, 20, 100)
      )
        return this.start("LAB_OVERVIEW");
      // `nearProp(62, 20/19/21)` and 5: the switch's phase.
      for (let i = 0; i < 3; i++) {
        const [x, y] = this.doc.lab.switches[i];
        if (!w.done(62, f.labFirstSwitch + i) && w.at(x - 25, y - 25, 50, 65) && w.confirm)
          return this.start(`LAB_SWITCH${i}`);
      }
      if (this.allSwitches(w) && !w.done(62, f.labComplete) && w.at(220, 60, 40, 100))
        return this.start("LAB_BETRAYAL");
      if (w.at(0, 65, 35, 70)) return { kind: "exit", room: ACADEMY_YARD, x: 330, y: 540 };
      return null;
    }
    if (w.done(62, f.labComplete) && !w.done(LAB_ROOM, f.farewell))
      return this.start("LAB_GOODBYE");
    if (
      w.done(LAB_ROOM, f.farewell) &&
      !w.done(LAB_ROOM, this.doc.parts.LAB_ADVICE.flag) &&
      this.requestedOrTwin(w, LAB_ROOM, 6)
    )
      return this.start("LAB_ADVICE");
    if (this.routeUnlocked(w) && w.at(200, 100, 20, 20)) return this.start("DEPART");
    if (w.at(165, 365, 80, 35)) return { kind: "exit", room: LOST_PET_CHAMBER, x: 460, y: 45 };
    return null;
  }
  private allSwitches(w: FourGatesWorld): boolean {
    const first = this.doc.flags.labFirstSwitch;
    return w.done(62, first) && w.done(62, first + 1) && w.done(62, first + 2);
  }
  /**
   * `tickAcademyDoor` (2, ahead of the yard's walker): a begun opening resumes; 5 in the door's box
   * refuses before the truth (61:105, or the final 30:124) and without the key (9006), opens it the
   * first time with 2:10, and later just walks in.
   */
  academyDoor(w: ForestWorld): FourGatesAction {
    const f = this.doc.flags;
    if (w.done(ACADEMY_YARD, f.doorStarted) && !w.done(ACADEMY_YARD, f.doorOpened))
      return this.start("LAB_DOOR");
    if (!w.at(335, 520, 55, 55) || !w.confirm) return null;
    if (!w.done(61, f.explained) && !w.done(30, f.tournamentComplete))
      return this.say(this.doc.text.labLocked);
    if (w.itemCount(f.northSeaKey) === 0) return this.say(this.doc.text.labNoKey);
    if (w.done(ACADEMY_YARD, f.doorOpened))
      return { kind: "exit", room: LABORATORY_ROOM, x: 60, y: 100 };
    w.mark(ACADEMY_YARD, f.doorStarted);
    return this.start("LAB_DOOR");
  }
  /** `CauVongChapterRuntime.tick` in 10: up to 60 once the forest route is open. */
  lostPetChamber(w: ForestWorld): FourGatesAction {
    if (this.routeUnlocked(w) && w.at(435, 0, 65, 30))
      return { kind: "exit", room: LAB_ROOM, x: 200, y: 340 };
    return null;
  }
  /** `CauVongNorthGateRuntime.tick`: 26's rescue first, 24's first-visit line. */
  north(w: ForestWorld, room: number): FourGatesAction {
    const f = this.doc.flags;
    if (room === NORTH_RESCUE) {
      if (w.done(26, 100)) return null;
      if (w.done(26, f.rescueWon)) return this.start("RESCUE_EXPLOSION");
      const near = w.at(140, 120, 60, 20);
      if (w.done(26, f.rescueRetry)) {
        if (!near || !w.confirm) return null;
        w.clear(26, f.rescueRetry);
      } else if (!w.done(26, f.rescueStarted) && !near) return null;
      w.mark(26, f.rescueStarted);
      return this.start("RESCUE_CONFRONT");
    }
    if (room === NORTH_SKY && !w.done(24, 101)) {
      w.mark(24, 101);
      return this.say(this.doc.text.north24);
    }
    return null;
  }
  /** `CauVongNorthRecoveryCutscene.tick` (59, ahead of the academy owners). */
  recovery(w: FourGatesWorld): FourGatesAction {
    const f = this.doc.flags;
    if (!w.done(DORM, f.recoveryPending) || w.done(DORM, f.recoveryComplete)) return null;
    return this.start("RECOVERY");
  }

  /** `after(p)` / the lab's and the north's ends: a part is over (its flag already written). */
  after(w: ForestWorld, name: string): FourGatesAction {
    const p = this.doc.parts[name];
    const b = battleOf(name);
    if (b >= 0) return this.startBattle(w, b, false);
    switch (name) {
      case "PERMISSION":
        w.mark(38, INTRO);
        return null;
      case "BLUE_TRAIL":
        w.mark(39, INTRO);
        return null;
      case "AFTER_39":
      case "AFTER_40":
      case "AFTER_41":
        w.mark(p.room, 101);
        return { kind: "cast" };
      case "AFTERMATH":
        w.mark(42, this.doc.flags.finaleComplete);
        return { kind: "cast" };
      case "MERCHANT_41_OFFER":
        return { kind: "menu", owner: FOREST_MERCHANT_MENU, options: MERCHANT_OPTIONS };
      // `CauVongAcademyLaboratoryRuntime`: 62's phases put the props back; the betrayal ends the lab.
      case "LAB_DISCOVERY":
      case "LAB_SWITCH0":
      case "LAB_SWITCH1":
      case "LAB_SWITCH2":
      case "LAB_OVERVIEW":
        return { kind: "cast" };
      case "LAB_BETRAYAL":
        w.mark(62, this.doc.flags.labComplete);
        return { kind: "exit", room: LAB_ROOM, x: 170, y: 259 };
      case "LAB_DOOR":
        w.mark(ACADEMY_YARD, this.doc.flags.doorOpened);
        return { kind: "exit", room: LABORATORY_ROOM, x: 60, y: 100 };
      case "GIRL_POST":
        w.mark(40, 6400);
        return nativeArrival(39, 7, 0, 2);
      case "PORTAL_BACK":
        return { kind: "exit", room: LAB_ROOM, x: 210, y: 139, dir: 0 };
      case "CITY_RETURN":
        return nativeArrival(1, 23, 6, 4);
      case "MERCHANT_38":
        return this.startRepeat("MERCHANT_38_OFFER");
      case "MERCHANT_38_OFFER":
        return { kind: "menu", owner: FOREST_MERCHANT_MENU, options: MERCHANT_OPTIONS };
      case "ALLIANCE_OFFER":
        return { kind: "menu", owner: FOREST_ALLIANCE_MENU, options: ALLIANCE_OPTIONS };
      case "DEPART": {
        // `CauVongDarkForestRuntime.arrive(38, 70, 159)`: PORTAL_ARRIVE plays again on arrival.
        const arrive = this.doc.parts.PORTAL_ARRIVE;
        w.clear(arrive.room, arrive.flag);
        w.clear(arrive.room, arrive.started);
        for (let i = 0; i <= arrive.steps.length; i++) w.clear(arrive.room, arrive.cue + i);
        return { kind: "exit", room: 38, x: 70, y: 159 };
      }
      case "RESCUE_CONFRONT":
        return { kind: "battle", key: "forest:rescue" };
      case "RESCUE_EXPLOSION":
        w.mark(26, this.doc.flags.rescueEscaped);
        w.mark(DORM, this.doc.flags.recoveryPending);
        return { kind: "exit", room: DORM, x: 270, y: 99, dir: 1 };
      case "RECOVERY":
        w.mark(26, 100);
        return { kind: "exit", room: 4, x: 250, y: 170 };
      default:
        return null;
    }
  }

  /** `choice`: the merchant (11) and the alliance supervisor (12). */
  answer(w: ForestWorld, owner: number, selection: number, room: number): FourGatesAction {
    if (owner === FOREST_MERCHANT_MENU) {
      if (selection < 2) return { kind: "shop" };
      if (selection === 2) return { kind: "bank" };
      return this.startRepeat(room === 38 ? "MERCHANT_38_TIP" : "MERCHANT_41_TIP");
    }
    if (selection === 0) return this.say({ speaker: "", text: w.allianceUpgrade() });
    if (selection === 1)
      return this.say({ speaker: "", text: this.medals.replace("{n}", String(w.claimMedals())) });
    return this.startRepeat(selection === 2 ? "ALLIANCE_INFO" : "ALLIANCE_TIP");
  }

  /** `handleBattleResult` (key "forest:b") and the rescue's. */
  result(w: ForestWorld, key: string, won: boolean): FourGatesAction {
    if (key === "forest:rescue") {
      // `CauVongNorthRescueCutscene.handleBattleResult`.
      if (won) {
        w.mark(26, this.doc.flags.rescueWon);
        return this.start("RESCUE_EXPLOSION");
      }
      w.mark(26, this.doc.flags.rescueRetry);
      return this.say(this.doc.text.rescueLost);
    }
    const b = Number(key.slice("forest:".length)),
      p = this.doc.parts[BATTLES[b].pre];
    w.clear(p.room, 6200 + b);
    if (!won) {
      w.mark(p.room, 6250 + b);
      w.clear(p.room, p.started);
      w.clear(p.room, p.flag);
      for (let i = 0; i <= p.steps.length; i++) w.clear(p.room, p.cue + i);
      w.revive();
      return { kind: "then", first: { kind: "cast" }, next: this.say(this.doc.text.lost) };
    }
    w.clear(p.room, 6250 + b);
    w.mark(p.room, 6300 + b);
    if (b === 3) w.mark(42, this.doc.flags.principalWon);
    if (b === 4) w.mark(42, this.doc.flags.experimentWon);
    return this.start(BATTLES[b].post, w);
  }
}

/** `CauVongDarkForestSourceRuntime.applyCast` (38–40) and the rescue's (26). */
export function forestCast(
  doc: CauVongForestDocument,
  room: number,
  done: FourGatesWorld["done"],
): { cues: CauVongCue[]; visible: [number, boolean][] } {
  const cast = { cues: [] as CauVongCue[], visible: [] as [number, boolean][] };
  const id = (source: number) => doc.actors[String(room)]?.[String(source)];
  const late = done(62, doc.flags.labComplete) && done(60, doc.flags.farewell);
  const finished = (name: string) => done(doc.parts[name].room, doc.parts[name].flag);
  if (room === NORTH_RESCUE) {
    // `CauVongNorthRescueCutscene.applyCast`: the mantis waits hidden; the pair leave once over.
    cast.visible.push([146, false]);
    if (done(26, 100) || done(26, doc.flags.rescueEscaped))
      cast.visible.push([10, false], [11, false]);
    return cast;
  }
  if (!isForestRoom(room)) return cast;
  for (const name of Object.keys(doc.parts)) {
    const p = doc.parts[name];
    if (p.flag < 6000 || p.flag >= 6100 || p.room !== room || !done(room, p.flag)) continue;
    cast.cues.push(...(doc.cast[name] ?? []));
  }
  if (room === 38)
    for (const s of [8, 9])
      if (id(s) !== undefined)
        cast.visible.push([id(s)!, !done(60, doc.flags.farewell) || !done(38, INTRO)]);
  if (room === 39) {
    cast.visible.push([70, late && !done(39, 101)]);
    if (done(39, INTRO) && id(23) !== undefined) cast.visible.push([id(23)!, false]);
  }
  if (room === 40) {
    cast.visible.push([70, late && !done(40, 101)]);
    if (finished("GIRL_POST") || done(40, 101))
      for (let s = 31; s <= 37; s++) if (id(s) !== undefined) cast.visible.push([id(s)!, false]);
  }
  if (room === 41 && id(26) !== undefined) cast.visible.push([id(26)!, !done(41, 101)]);
  if (room === 42) {
    const f = doc.flags;
    const revealPending =
      done(42, f.principalWon) && !finished("RAFAEL") && !done(42, f.experimentWon);
    cast.visible.push(
      [25, !done(42, f.principalWon) || revealPending],
      [26, !done(42, f.experimentWon) && (!done(42, f.principalWon) || revealPending)],
    );
    if (id(21) !== undefined)
      cast.visible.push([id(21)!, done(42, f.principalWon) && !done(42, f.finaleComplete)]);
  }
  return cast;
}

/**
 * `CauVongAcademyLaboratoryRuntime.applyProps` (62: a lifted switch's cage is gone, the bases stay,
 * the levers rest) and `applyCast` (60: the pair stay once they said goodbye).
 */
export function laboratoryCast(
  doc: CauVongForestDocument,
  room: number,
  done: FourGatesWorld["done"],
): { visible: [number, boolean][]; state: [number, number][] } {
  const cast = { visible: [] as [number, boolean][], state: [] as [number, number][] };
  if (room === LABORATORY_ROOM)
    for (const [id, role, state] of doc.lab.props) {
      if (role < 3) cast.visible.push([id, !done(62, doc.flags.labFirstSwitch + role)]);
      if (role === 3) cast.visible.push([id, true]);
      cast.state.push([id, state]);
    }
  if (room === LAB_ROOM && done(LAB_ROOM, doc.flags.farewell))
    for (const source of [5, 6]) {
      const id = doc.actors[String(LAB_ROOM)]?.[String(source)];
      if (id !== undefined) cast.visible.push([id, true]);
    }
  return cast;
}

// --- CauVongRockObstacles ---

const ROCK_CLEARED = 846000;
const ROCK_STARTED = 846100;
/** `TILE`: a closed rock blocks its 20 px tile. */
export const ROCK_TILE: [number, number, number, number] = [0, 0, 20, 20];
export const rockCleared = (rock: CauVongRock) => ROCK_CLEARED + rock.canonical;
export const rockStarted = (rock: CauVongRock) => ROCK_STARTED + rock.canonical;

/** `closedMask`: the rock is visible and not cleared. */
export function rockClosed(
  rock: CauVongRock,
  room: number,
  visible: boolean,
  done: FourGatesWorld["done"],
): boolean {
  return visible && !done(room, rockCleared(rock));
}

/**
 * `target`: the nearest closed rock within 35 px whose centre lies ahead of the hero (forward ≥ 0,
 * at most 20 px aside).
 */
export function rockTarget(
  rocks: readonly CauVongRock[],
  hero: { x: number; y: number; direction: number },
  closed: (rock: CauVongRock) => boolean,
): CauVongRock | null {
  let nearest: CauVongRock | null = null,
    distance = Number.MAX_SAFE_INTEGER;
  for (const rock of rocks) {
    if (!closed(rock)) continue;
    const dx = rock.x + 10 - hero.x,
      dy = rock.y + 10 - hero.y;
    if (Math.abs(dx) > 35 || Math.abs(dy) > 35) continue;
    const d = hero.direction;
    const forward = d === 2 ? -dy : d === 0 ? dy : d === 1 ? dx : -dx;
    const side = d === 2 || d === 0 ? dx : dy;
    if (forward < 0 || Math.abs(side) > 20) continue;
    const span = Math.abs(dx) + Math.abs(dy);
    if (span < distance) {
      nearest = rock;
      distance = span;
    }
  }
  return nearest;
}
