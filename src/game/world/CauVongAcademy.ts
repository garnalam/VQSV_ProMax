// JavaSE parity: main quest CV3 "Cầu Vồng — nhập học và đời sống Học viện" (2:101 → 3:102). After the
// registration `CauVongChapterRuntime.tick` hands the academy's rooms to these owners, in this order:
//
//   2   `missingBranches.extraDoors` (3, 7, 8) → `academySource` (TOUR, CEREMONY, PRINCIPAL) →
//       `academySides` (Lạc Khắc) → `tickAcademy` (CV2's teacher and residents, the roster
//       trainers, the dorm door, the classroom gate, the middle arena)
//   8   `missingBranches` (the preliminary arena: intro, registration, offer, two rounds, finish)
//   7   `missingBranches` (the academy hatchery)
//   4   `missingBranches.needsPreliminary` → `academySource` (BRIEF, the teacher's three rounds) →
//       `tickArena` (the teacher's last word, the residents, the way out)
//   59  `academySource` (DORM, MORNING) → `academySides` (REPORT) → `tickSideRoom`
//   3   `academySource` (LESSON, FOUR_GATES) → `academySides` (the alliance) → `tickClassroom`
//
// The sequences and the runtimes' own lines are baked by rebuild_game/tools/WebCauVongAcademy.java
// (`cau-vong-world/academy.json`). The academy hatchery (7) plays its scene, then opens the
// five-slot incubator, as Java does (owner decision 2026-11-12). The
// Cầu Vồng shop panel is not on the web yet either: the arena merchant (4, actor 49) and the academy's
// trade centre (43) wait for the next slice.
import type { PackBattleAiProfile } from "../../data/GameData";
import type { CauVongCue, CauVongPart } from "./CauVongCutscene";
import type { OpeningAction, OpeningRosterNpc } from "./CauVongOpening";
import type { PrepContext } from "./CauVongPrep";
import { playerIntersectsSourceRect, playerSourcePointInRect } from "./WorldInteractionEngine";

/** The rooms CV3 owns outright; 2 stays CV2's owner with CV3's decisions ahead of it. */
export const ACADEMY_ROOMS = [3, 4, 7, 8, 43, 59] as const;
export const ACADEMY_YARD = 2;
export const CLASSROOM = 3;
export const MIDDLE_ARENA = 4;
export const ACADEMY_HATCHERY = 7;
export const PRELIM_ARENA = 8;
export const DORM = 59;
/** `ACADEMY_SHOP_ROOM_INDEX`: the campus shop (Trung Tâm Thương Mại). */
export const SHOP_ROOM = 43;

/** `CauVongAcademySourceRuntime`'s flags this bundle reads. */
const REGISTERED = 101;
const REGISTER_FLAG = 140;
const BRIEF_STARTED = 170;
const ARENA_DONE = 104;
const AWARDED = 103;
const NIGHT_DONE = 102;
const LESSON_SEEN = 101;
const CLASS_ARRIVED = 100;
export const FOUR_GATES_DONE = 102;
/** `MissingBranches`: 8:2 the preliminaries are over, 8:100 with it, menus 822000+owner. */
const PRELIM_OVER = 2;
const MENU_BASE = 822000;
const ARENA_MENU = 1;
/** `tickSideRoom`'s sleep in the dorm: 59:100. */
const DORM_SLEPT = 100;

export type AcademyText = { speaker: string; text: string };
export type AcademyLine = { actorId: number; name: string; line: string };
export type AcademyBattle = {
  label: string;
  background: number;
  members: [number, number, number][];
  /** Baked from `VqsvBattleRuntime.enterBattle` for every Cầu Vồng trainer request (`enemyQuality`). */
  quality?: number;
  /** Each member's deck after `CauVongEnemySkillDecks` / `EarthPetrificationPriority`. */
  skills?: number[][];
  /** The request's AI tier; `profile` is that tier's row, resolved when the pack loads. */
  tier?: string;
  profile?: PackBattleAiProfile;
  encounterStats?: { hp: number; attack: number; defense: number; speed: number };
};
export type CauVongAcademyDocument = {
  parts: Record<string, CauVongPart>;
  cast: Record<string, CauVongCue[]>;
  battles: Record<string, AcademyBattle>;
  /** `extraDoors`: [tileX, tileY, room, x, y, dir], by room. */
  doors: Record<string, [number, number, number, number, number, number][]>;
  roster: Record<string, (OpeningRosterNpc & { battle: number })[]>;
  passives: Record<string, { actorId: number; say: Extract<CauVongCue, { k: "say" }> }[]>;
  dormLines: AcademyLine[];
  dormSleeper: number;
  actors: {
    hatchery: number;
    arenaClerk: number;
    principal: number;
    ceremonyA: number;
    ceremonyB: number;
    locke: number;
    alliance: number;
    /** CV4c: An Kỳ Nhi in the yard (2, source actor 43). */
    angel: number;
  };
  text: {
    prelimLoss: AcademyText;
    registerFirst: AcademyText;
    needsPrelim: AcademyText;
    arenaLoss: AcademyText;
    arenaDone: AcademyText;
    rivalLoss: AcademyText;
    rosterWin: Record<string, AcademyText>;
    rank: { short: string; up: string; top: string; needed: number[]; base: number };
    allianceSpeaker: string;
    medals: { none: string; some: string; base: number };
  };
  choices: { arena: string[]; round: string[][]; alliance: string[]; locke: string[] };
  /** `CauVongAcademyShopRuntime`: the campus shop's NPCs (by `canonicalIndex`), ghost and lines. */
  shop43: {
    npcs: { actorId: number; canonical: number; say: Extract<CauVongCue, { k: "say" }> }[];
    ghost: number;
    ghostTalk: number;
    ghostRect: [number, number, number, number];
    flags: { infoPaid: number; harryWon: number; potterWon: number };
    infoChoice: string[];
    harryChoice: string[];
    infoPrice: number;
  };
  /** `CauVongAcademySideRuntime`'s arena merchant (4). */
  merchant: number;
  /** `CauVongAcademyLaterPrincipal`: its actor and the two reports' prerequisites ([room, event]). */
  laterPrincipal: { actor: number; north: [number, number]; investigation: [number, number] };
  award: { id: number; name: string; description: string };
  flags: {
    prelimRequired: number;
    roundWon: number;
    battlePending: number;
    lockeBefore: number;
    lockeWon: number;
    lockeAfter: number;
    report: number;
    allianceIntro: number;
  };
};

/** The menus these rooms open. */
export type AcademyMenu = "arena" | "round" | "alliance" | "locke" | "info" | "harry";
/** A fight and the owner that reads its result. */
export type AcademyFight =
  | { owner: "prelim"; round: number }
  | { owner: "arena"; round: number }
  | { owner: "rival" }
  | { owner: "roster"; event: number; actorId: number }
  /** `CauVongAcademyShopRuntime.startBattle`: Harry (9) or Potter (10). */
  | { owner: "egg"; event: number };

/** What these rooms read beyond CV2's context. */
export type AcademyContext = PrepContext & {
  /** The hero's facing (`s.player.direction`, web numbers). */
  direction: number;
  /** `mapRenderer.terrainAtWorld`. */
  terrainAt: (x: number, y: number) => number;
};

export type AcademyAction =
  | OpeningAction
  | { kind: "academyMenu"; menu: AcademyMenu; round?: number; reply?: string }
  | { kind: "academyBattle"; key: string; fight: AcademyFight; restore?: string }
  | { kind: "line"; text: AcademyText; heal?: boolean }
  /** `arrival(...)` then a line (`needsPreliminary`). */
  | { kind: "bounce"; room: number; x: number; y: number; dir: number; text: AcademyText }
  | { kind: "dormTalk"; npc: AcademyLine; sleep: boolean }
  /**
   * `service(action)`: a Cầu Vồng shop (`openCauVongShopFromWorld`, category 0–3) or the pet bank;
   * the clerk's farewell part plays once it closes.
   */
  | { kind: "academyService"; service: "shop" | "bank"; category: number; farewell?: string }
  /** `payInfo`: the 500 kim, then the tip (or the refusal). */
  | { kind: "payInfo" };

const part = (doc: CauVongAcademyDocument, name: string, clear = false): AcademyAction => ({
  kind: "part",
  name,
  part: doc.parts[name],
  clear,
});
/** A text-only replay of a finished range (`repeat`, `CauVongNorthSeaDialogue.source`). */
const repeat = (doc: CauVongAcademyDocument, name: string): AcademyAction => {
  const p = doc.parts[name];
  return {
    kind: "part",
    name: `${name}_REPEAT`,
    part: { ...p, flag: -1, started: -1, cue: -1, steps: p.steps.filter((cue) => cue.k === "say") },
  };
};
const say = (cue: Extract<CauVongCue, { k: "say" }>, room: number): AcademyAction => ({
  kind: "part",
  name: "ACADEMY_REPLY",
  part: { room, event: -1, flag: -1, started: -1, cue: -1, steps: [cue] },
});
/** `at(s, x, y, x2, y2)` on tiles, the hero's source point. */
const tile = (ctx: AcademyContext, x: number, y: number) =>
  playerSourcePointInRect(ctx.player.x, ctx.player.y, {
    x: x * 20,
    y: y * 20,
    width: 20,
    height: 20,
  });
const box = (ctx: AcademyContext, x: number, y: number, width: number, height: number) =>
  playerIntersectsSourceRect(ctx.player.x, ctx.player.y, { x, y, width, height });
const point = (ctx: AcademyContext, x: number, y: number, width: number, height: number) =>
  playerSourcePointInRect(ctx.player.x, ctx.player.y, { x, y, width, height });

/** `CauVongAcademySourceRuntime.sourceRoute`: registered on the source route, or the brief begun. */
export const sourceRoute = (done: PrepContext["done"]) =>
  done(ACADEMY_YARD, REGISTER_FLAG) || done(MIDDLE_ARENA, BRIEF_STARTED);
/** `MissingBranches.needsPreliminary`. */
export const needsPreliminary = (doc: CauVongAcademyDocument, done: PrepContext["done"]) =>
  done(ACADEMY_YARD, doc.flags.prelimRequired) &&
  !done(PRELIM_ARENA, PRELIM_OVER) &&
  !done(MIDDLE_ARENA, ARENA_DONE);

/** The `MissingBranches` parts of CV3, in ordinal order (HATCHERY first). */
const BRANCH_PARTS = [
  "HATCHERY",
  "ARENA_INTRO",
  "ARENA_REGISTER",
  "ARENA_OFFER",
  "ARENA_FIRST",
  "ARENA_SECOND",
  "ARENA_FINISH",
  "ARENA_DECLINE",
] as const;
/** `CauVongAcademySourceRuntime.Phase` of CV3, in ordinal order. */
const SOURCE_PARTS = [
  "TOUR",
  "CEREMONY",
  "PRINCIPAL",
  "LESSON",
  "FOUR_GATES",
  "BRIEF",
  "PRE0",
  "POST0",
  "PRE1",
  "POST1",
  "PRE2",
  "POST2",
  "DORM",
  "MORNING",
] as const;
/** `CauVongAcademySideRuntime.Part` this bundle plays, in ordinal order. */
const SIDE_PARTS = ["LOCKE_PRE", "LOCKE_POST", "ANGEL", "REPORT", "NIGHT", "ALLIANCE"] as const;
/** `CauVongAcademyExpansionRuntime.INTRO` (3:110): An Kỳ Nhi introduced, her tour next. */
const ANGEL_INTRODUCED = 110;
export const isAcademyBranchPart = (name: string) =>
  (BRANCH_PARTS as readonly string[]).includes(name);

/** A started part of `owners` in `room` that is not over (the durable start markers). */
function resume(
  doc: CauVongAcademyDocument,
  names: readonly string[],
  room: number,
  done: PrepContext["done"],
): AcademyAction {
  for (const name of names) {
    const p = doc.parts[name];
    if (p.room === room && done(room, p.started) && !done(room, p.flag)) return part(doc, name);
  }
  return null;
}

/** `extraDoors`: in 2 only 3, 7 and 8 once registered; the door tile, or the next one walked into. */
function extraDoor(doc: CauVongAcademyDocument, room: number, ctx: AcademyContext): AcademyAction {
  for (const [x, y, target, tx, ty, dir] of doc.doors[String(room)] ?? []) {
    if (room === ACADEMY_YARD && !ctx.done(ACADEMY_YARD, REGISTERED)) continue;
    if (!atDoor(ctx, x, y)) continue;
    return { kind: "exit", room: target, x: tx, y: ty, dir };
  }
  return null;
}
/** `atDoor`: the tile, else a blocked door tile with the hero pressing into it from beside it. */
function atDoor(ctx: AcademyContext, x: number, y: number): boolean {
  if (tile(ctx, x, y)) return true;
  if (ctx.terrainAt(x * 20 + 10, y * 20 + 19) !== 1) return false;
  // Java [dx, dy, facing]: below and looking up, above and looking down, left/right looking in.
  const sides: [number, number, number][] = [
    [0, 1, 2],
    [0, -1, 0],
    [-1, 0, 1],
    [1, 0, 3],
  ];
  return sides.some(([dx, dy, facing]) => ctx.direction === facing && tile(ctx, x + dx, y + dy));
}

/**
 * Room 2, ahead of CV2's owner: the doors to 3, 7 and 8, `academySource`'s CV3 phases and Lạc Khắc
 * (`academySides`). Null lets CV2's `academy` (the teacher, the residents, the gate hint) run.
 */
export function cauVongAcademyYard(
  doc: CauVongAcademyDocument,
  ctx: AcademyContext,
): AcademyAction {
  const { done, requested } = ctx;
  const door = extraDoor(doc, ACADEMY_YARD, ctx);
  if (door) return door;
  // `academySource`.
  const resumed = resume(doc, SOURCE_PARTS, ACADEMY_YARD, done);
  if (resumed) return resumed;
  const route = sourceRoute(done);
  if (route && done(MIDDLE_ARENA, ARENA_DONE) && !done(ACADEMY_YARD, doc.parts.TOUR.flag))
    return part(doc, "TOUR");
  if (route && done(DORM, NIGHT_DONE) && !done(ACADEMY_YARD, AWARDED)) return part(doc, "CEREMONY");
  if (
    done(ACADEMY_YARD, doc.parts.CEREMONY.flag) &&
    !done(ACADEMY_YARD, doc.parts.PRINCIPAL.flag) &&
    (box(ctx, 460, 560, 100, 80) || requested(doc.actors.principal))
  )
    return part(doc, "PRINCIPAL");
  // `academySides`.
  const side = resume(doc, SIDE_PARTS, ACADEMY_YARD, done);
  if (side) return side;
  const f = doc.flags;
  if (done(ACADEMY_YARD, f.lockeWon) && !done(ACADEMY_YARD, f.lockeAfter))
    return part(doc, "LOCKE_POST");
  if (
    done(MIDDLE_ARENA, ARENA_DONE) &&
    !done(ACADEMY_YARD, f.lockeAfter) &&
    requested(doc.actors.locke)
  )
    return { kind: "academyMenu", menu: "locke" };
  // CV4c: An Kỳ Nhi's tour (2:8), at her spot or on her.
  if (
    done(CLASSROOM, ANGEL_INTRODUCED) &&
    !done(ACADEMY_YARD, doc.parts.ANGEL.flag) &&
    (box(ctx, 280, 400, 60, 40) || requested(doc.actors.angel))
  )
    return part(doc, "ANGEL");
  return null;
}

/** Room 2's roster trainers (`tickRosterNpc`): after the line, the fight while it is not won. */
export function academyRosterFight(
  doc: CauVongAcademyDocument,
  actorId: number,
  battle: number,
  done: PrepContext["done"],
): AcademyAction {
  if (!battle || done(ACADEMY_YARD, battle)) return null;
  const key = `roster${actorId}`;
  if (!doc.battles[key]) return null;
  return { kind: "academyBattle", key, fight: { owner: "roster", event: battle, actorId } };
}

/** Room 2's doors `tickAcademy` checks around the step: the dorm (ahead of CV2's west exit). */
export function cauVongAcademyYardSideDoor(ctx: AcademyContext): AcademyAction {
  // `academySideEntrance`: the campus shop's door first, then the dorm's.
  if (box(ctx, 490, 166, 58, 54)) return { kind: "exit", room: SHOP_ROOM, x: 200, y: 450 };
  return box(ctx, 24, 568, 32, 32) ? { kind: "exit", room: DORM, x: 200, y: 450 } : null;
}
/** ... then the classroom gate and the middle arena, once registered (after CV2's west exit). */
export function cauVongAcademyYardGates(
  doc: CauVongAcademyDocument,
  ctx: AcademyContext,
): AcademyAction {
  const registered = ctx.done(ACADEMY_YARD, REGISTERED);
  if (registered && point(ctx, 40, 300, 40, 20))
    return { kind: "exit", room: CLASSROOM, x: 280, y: 560 };
  if (registered && box(ctx, 150, 214, 52, 68) && !needsPreliminary(doc, ctx.done))
    return { kind: "exit", room: MIDDLE_ARENA, x: 50, y: 560 };
  return null;
}

/** The rooms CV3 owns outright. */
export function cauVongAcademyAction(
  doc: CauVongAcademyDocument,
  room: number,
  ctx: AcademyContext,
): AcademyAction {
  if (room === PRELIM_ARENA) return prelimArena(doc, ctx);
  if (room === ACADEMY_HATCHERY) return hatchery(doc, ctx);
  if (room === MIDDLE_ARENA) return middleArena(doc, ctx);
  if (room === DORM) return dorm(doc, ctx);
  if (room === CLASSROOM) return classroom(doc, ctx);
  if (room === SHOP_ROOM) return campusShop(doc, ctx);
  return null;
}

/** `CauVongAcademyShopRuntime.Part`, in ordinal order. */
const SHOP_PARTS = [
  "INTRO",
  "EVOLUTION_PRE",
  "EVOLUTION_POST",
  "SCROLL",
  "GHOST",
  "INFO_OFFER",
  "INFO",
  "HARRY_OFFER",
  "HARRY_PRE",
  "HARRY_POST",
  "POTTER_PRE",
  "POTTER_POST",
].map((name) => `SHOP_${name}`);
const shopService = (
  service: "shop" | "bank",
  category: number,
  farewell?: string,
): AcademyAction => ({ kind: "academyService", service, category, farewell });

/** The campus shop (43), `CauVongAcademyShopRuntime.tick` past its sequence, menu and farewell. */
function campusShop(doc: CauVongAcademyDocument, ctx: AcademyContext): AcademyAction {
  const { requested } = ctx,
    shop = doc.shop43,
    done = (flag: number) => ctx.done(SHOP_ROOM, flag),
    finished = (name: string) => done(doc.parts[`SHOP_${name}`].flag);
  const resumed = resume(doc, SHOP_PARTS, SHOP_ROOM, ctx.done);
  if (resumed) return resumed;
  if (finished("EVOLUTION_PRE") && !finished("EVOLUTION_POST"))
    return part(doc, "SHOP_EVOLUTION_POST");
  if (done(shop.flags.infoPaid) && !finished("INFO")) return part(doc, "SHOP_INFO");
  if (done(shop.flags.harryWon) && !finished("HARRY_POST")) return part(doc, "SHOP_HARRY_POST");
  if (done(shop.flags.potterWon) && !finished("POTTER_POST")) return part(doc, "SHOP_POTTER_POST");
  if (!finished("INTRO")) return part(doc, "SHOP_INTRO");
  if (!finished("GHOST") && box(ctx, ...shop.ghostRect)) return part(doc, "SHOP_GHOST");
  // The ghost merchant: his two speeches, then the mutation document (category 3).
  if (finished("GHOST") && requested(shop.ghostTalk)) return part(doc, "SHOP_GHOST_TALK");
  // `start` of an offer already read: the question again, text only, then the menu.
  const offer = (name: "INFO_OFFER" | "HARRY_OFFER") =>
    finished(name) ? part(doc, `SHOP_${name}_REPLY`) : part(doc, `SHOP_${name}`);
  for (const npc of shop.npcs) {
    if (!requested(npc.actorId)) continue;
    const passive = say(npc.say, SHOP_ROOM);
    switch (npc.canonical) {
      case 0:
        return part(doc, "SHOP_ITEMS");
      case 1:
        return part(doc, "SHOP_BANK");
      case 2:
        return finished("EVOLUTION_POST") && !finished("SCROLL")
          ? part(doc, "SHOP_SCROLL")
          : part(doc, "SHOP_BADGES");
      case 3:
        return finished("EVOLUTION_PRE")
          ? part(doc, "SHOP_MATERIALS")
          : part(doc, "SHOP_EVOLUTION_PRE");
      case 5:
        return finished("INFO") ? passive : offer("INFO_OFFER");
      case 6:
        return !finished("INFO") || done(shop.flags.harryWon) ? passive : offer("HARRY_OFFER");
      case 7:
        return done(shop.flags.harryWon) && !done(shop.flags.potterWon)
          ? part(doc, "SHOP_POTTER_PRE")
          : passive;
      default:
        return passive;
    }
  }
  return null;
}
const eggFight = (event: number): AcademyAction => ({
  kind: "academyBattle",
  key: event === 9 ? "harry" : "potter",
  fight: { owner: "egg", event },
});

/**
 * `CauVongAcademyLaterPrincipal.tick` (4): a report begun and not over, else the principal waits
 * (made visible by the cast) for the next report once its prerequisite is done.
 */
function laterPrincipal(doc: CauVongAcademyDocument, ctx: AcademyContext): AcademyAction {
  const { done } = ctx,
    later = doc.laterPrincipal;
  for (const name of ["LATER_NORTH", "LATER_INVESTIGATION"]) {
    const p = doc.parts[name];
    if (done(MIDDLE_ARENA, p.started) && !done(MIDDLE_ARENA, p.flag)) return part(doc, name);
  }
  const next = laterReport(doc, done);
  return next && ctx.requested(later.actor) ? part(doc, next) : null;
}
function laterReport(doc: CauVongAcademyDocument, done: PrepContext["done"]): string | null {
  const later = doc.laterPrincipal;
  if (done(...later.investigation) && !done(MIDDLE_ARENA, doc.parts.LATER_INVESTIGATION.flag))
    return "LATER_INVESTIGATION";
  if (done(...later.north) && !done(MIDDLE_ARENA, doc.parts.LATER_NORTH.flag)) return "LATER_NORTH";
  return null;
}

/** `MissingBranches.tick`'s head: a menu left open, a started part, a fight left pending. */
function branchHead(doc: CauVongAcademyDocument, room: number, ctx: AcademyContext): AcademyAction {
  const { done } = ctx;
  if (done(room, MENU_BASE + ARENA_MENU)) return { kind: "academyMenu", menu: "arena" };
  const resumed = resume(doc, BRANCH_PARTS, room, done);
  if (resumed) return resumed;
  if (room === PRELIM_ARENA) {
    for (let round = 0; round < 2; round++)
      if (done(PRELIM_ARENA, doc.flags.battlePending + round)) return prelimFight(round);
    if (
      done(PRELIM_ARENA, doc.flags.roundWon + 1) &&
      !done(PRELIM_ARENA, doc.parts.ARENA_FINISH.flag)
    )
      return part(doc, "ARENA_FINISH");
  }
  return null;
}
const prelimFight = (round: number): AcademyAction => ({
  kind: "academyBattle",
  key: `prelim${round}`,
  fight: { owner: "prelim", round },
});
/** `passives(r)`: a branch room's resident replies. */
function passives(doc: CauVongAcademyDocument, room: number, ctx: AcademyContext): AcademyAction {
  for (const npc of doc.passives[String(room)] ?? [])
    if (ctx.requested(npc.actorId)) return say(npc.say, room);
  return null;
}

/** The preliminary arena (8). */
function prelimArena(doc: CauVongAcademyDocument, ctx: AcademyContext): AcademyAction {
  const { done, requested } = ctx;
  const head = branchHead(doc, PRELIM_ARENA, ctx);
  if (head) return head;
  if (!done(ACADEMY_YARD, REGISTERED)) return { kind: "line", text: doc.text.registerFirst };
  if (!done(PRELIM_ARENA, doc.parts.ARENA_INTRO.flag)) return part(doc, "ARENA_INTRO");
  if (requested(doc.actors.arenaClerk)) {
    if (done(PRELIM_ARENA, PRELIM_OVER)) {
      const clerk = doc.passives[String(PRELIM_ARENA)].find(
        (npc) => npc.actorId === doc.actors.arenaClerk,
      );
      return clerk ? say(clerk.say, PRELIM_ARENA) : null;
    }
    if (!done(PRELIM_ARENA, doc.parts.ARENA_REGISTER.flag)) return part(doc, "ARENA_REGISTER");
    // `offer(ARENA_OFFER, 1)`: the marker first, then the offer read again; the menu follows.
    return { kind: "academyMenu", menu: "arena", reply: "ARENA_OFFER_REPLY" };
  }
  const door = extraDoor(doc, PRELIM_ARENA, ctx);
  if (door) return door;
  return passives(doc, PRELIM_ARENA, ctx);
}

/** The academy hatchery (7). */
function hatchery(doc: CauVongAcademyDocument, ctx: AcademyContext): AcademyAction {
  const head = branchHead(doc, ACADEMY_HATCHERY, ctx);
  if (head) return head;
  if (ctx.requested(doc.actors.hatchery)) {
    // The scene the first time (its `after` opens the incubator), then the incubator itself.
    if (!ctx.done(ACADEMY_HATCHERY, doc.parts.HATCHERY.flag)) return part(doc, "HATCHERY");
    return { kind: "incubator" };
  }
  const door = extraDoor(doc, ACADEMY_HATCHERY, ctx);
  if (door) return door;
  return passives(doc, ACADEMY_HATCHERY, ctx);
}

/** The middle arena (4). */
function middleArena(doc: CauVongAcademyDocument, ctx: AcademyContext): AcademyAction {
  const { done, requested } = ctx;
  // `MissingBranches`: without the preliminaries, back to the yard (8, 13) with the reminder.
  if (needsPreliminary(doc, done))
    return {
      kind: "bounce",
      room: ACADEMY_YARD,
      x: 8 * 20 + 10,
      y: 13 * 20 + 19,
      dir: 0,
      text: doc.text.needsPrelim,
    };
  // `academySource`.
  if (!done(MIDDLE_ARENA, ARENA_DONE) && done(ACADEMY_YARD, REGISTERED)) {
    const resumed = resume(doc, SOURCE_PARTS, MIDDLE_ARENA, done);
    if (resumed) return resumed;
    if (!done(MIDDLE_ARENA, doc.parts.BRIEF.flag)) return part(doc, "BRIEF");
    for (let r = 0; r < 3; r++)
      if (done(MIDDLE_ARENA, 101 + r) && !done(MIDDLE_ARENA, doc.parts[`POST${r}`].flag))
        return part(doc, `POST${r}`);
    if (requested(40)) {
      let r = 0;
      while (r < 3 && done(MIDDLE_ARENA, 101 + r)) r++;
      return r < 3 ? { kind: "academyMenu", menu: "round", round: r } : null;
    }
  }
  // `academySides`: the arena merchant greets, then opens the shop (category 0).
  if (requested(doc.merchant)) return part(doc, "MERCHANT_GREETING");
  const later = laterPrincipal(doc, ctx);
  if (later) return later;
  // `tickArena`: the teacher's last word once the three rounds are won.
  if (requested(40)) {
    if ([0, 1, 2].every((r) => done(MIDDLE_ARENA, 101 + r)))
      return { kind: "line", text: doc.text.arenaDone };
    return null;
  }
  return roster(doc, MIDDLE_ARENA, ctx);
}
/** The answer to the teacher's round menu: the scene before the fight, else the fight. */
export function academyRoundAnswer(
  doc: CauVongAcademyDocument,
  round: number,
  selected: number,
  done: PrepContext["done"],
): AcademyAction {
  if (selected !== 0) return null;
  const pre = doc.parts[`PRE${round}`];
  if (done(pre.room, pre.flag)) return arenaFight(round);
  return part(doc, `PRE${round}`);
}
const arenaFight = (round: number): AcademyAction => ({
  kind: "academyBattle",
  key: `arena${round}`,
  fight: { owner: "arena", round },
  restore: `PRE${round}`,
});

/** The dorm (59). */
function dorm(doc: CauVongAcademyDocument, ctx: AcademyContext): AcademyAction {
  const { done } = ctx;
  if (sourceRoute(done) && done(ACADEMY_YARD, doc.parts.TOUR.flag) && !done(DORM, NIGHT_DONE)) {
    const resumed = resume(doc, SOURCE_PARTS, DORM, done);
    if (resumed) return resumed;
    if (!done(DORM, doc.parts.DORM.flag)) return part(doc, "DORM");
    // The source bed trigger, tile (13, 4)..(13, 5).
    if (box(ctx, 260, 80, 20, 40)) return part(doc, "MORNING");
  }
  const side = resume(doc, SIDE_PARTS, DORM, done);
  if (side) return side;
  if (sourceRoute(done) && done(DORM, NIGHT_DONE) && !done(DORM, doc.flags.report))
    return part(doc, "REPORT");
  // CV4c: the night after An Kỳ Nhi's tour, the bed's tiles (13, 4)..(13, 5).
  if (
    done(ACADEMY_YARD, doc.parts.ANGEL.flag) &&
    !done(DORM, doc.parts.NIGHT.flag) &&
    box(ctx, 260, 80, 20, 40)
  )
    return part(doc, "NIGHT");
  // `tickSideRoom`: the residents, the manager's sleep.
  for (const npc of doc.dormLines)
    if (ctx.actor(npc.actorId)?.visible && ctx.requested(npc.actorId))
      return { kind: "dormTalk", npc, sleep: npc.actorId === doc.dormSleeper };
  return null;
}

/** The classroom (3). */
function classroom(doc: CauVongAcademyDocument, ctx: AcademyContext): AcademyAction {
  const { done, requested } = ctx;
  if (sourceRoute(done) && !done(CLASSROOM, FOUR_GATES_DONE)) {
    const resumed = resume(doc, SOURCE_PARTS, CLASSROOM, done);
    if (resumed) return resumed;
    if (done(ACADEMY_YARD, doc.parts.PRINCIPAL.flag) && box(ctx, 320, 380, 80, 20))
      return part(doc, "FOUR_GATES");
    // The terrain lesson: 3:100 is written on every tick here (`complete(s, 3, 100)`).
    if (requested(1)) {
      if (!done(CLASSROOM, doc.parts.LESSON.flag)) return part(doc, "LESSON");
      return part(doc, "LESSON_REPLY");
    }
  }
  // `academySides`: the alliance supervisor.
  const side = resume(doc, SIDE_PARTS, CLASSROOM, done);
  if (side) return side;
  if (done(ACADEMY_YARD, REGISTERED) && requested(doc.actors.alliance)) {
    if (!done(CLASSROOM, doc.flags.allianceIntro)) return part(doc, "ALLIANCE");
    return { kind: "academyMenu", menu: "alliance", reply: "ALLIANCE_GREETING" };
  }
  // `tickClassroom`: the teacher's lesson again (3:101), then the residents.
  if (requested(1))
    return {
      kind: "part",
      name: "LESSON_REPLY",
      part: doc.parts.LESSON_REPLY,
      then: [[CLASSROOM, LESSON_SEEN]],
    };
  return roster(doc, CLASSROOM, ctx);
}
/** `complete(s, 3, 100)` while the source route's classroom is not over. */
export const classroomArrival = (done: PrepContext["done"]): [number, number] | null =>
  sourceRoute(done) && !done(CLASSROOM, FOUR_GATES_DONE) && !done(CLASSROOM, CLASS_ARRIVED)
    ? [CLASSROOM, CLASS_ARRIVED]
    : null;

/** `tickRosterNpc` in 3 and 4. */
function roster(doc: CauVongAcademyDocument, room: number, ctx: AcademyContext): AcademyAction {
  for (const npc of doc.roster[String(room)] ?? []) {
    if (!ctx.actor(npc.actorId)?.visible || !ctx.requested(npc.actorId)) continue;
    return { kind: "roster", npc };
  }
  return null;
}

/** The rooms' exits, around the step (`sideRoomExit`, `returnTo...`). */
export function cauVongAcademyExit(room: number, ctx: AcademyContext): AcademyAction {
  const exit = (to: number, x: number, y: number): AcademyAction => ({
    kind: "exit",
    room: to,
    x,
    y,
  });
  switch (room) {
    case MIDDLE_ARENA:
      return box(ctx, 20, 594, 56, 46) ? exit(ACADEMY_YARD, 170, 300) : null;
    case DORM:
      return box(ctx, 160, 480, 82, 44) ? exit(ACADEMY_YARD, 40, 620) : null;
    case SHOP_ROOM:
      return box(ctx, 160, 480, 82, 44) ? exit(ACADEMY_YARD, 490, 260) : null;
    case CLASSROOM:
      return point(ctx, 240, 620, 80, 20) ? exit(ACADEMY_YARD, 300, 130) : null;
    case ACADEMY_HATCHERY:
    case PRELIM_ARENA:
      return null;
    default:
      return null;
  }
}

/** What a finished sequence leaves to do. */
export type AcademyAfter =
  | { kind: "marks"; marks: [number, number][]; clearStarted?: boolean }
  | { kind: "fight"; action: AcademyAction }
  | { kind: "hideArena" }
  | { kind: "arenaOver" }
  | { kind: "morning" }
  /** `reviveFull` over the roster (the night after An Kỳ Nhi's tour). */
  | { kind: "revive" }
  | { kind: "ceremony" }
  | { kind: "hide"; id: number }
  | { kind: "menu"; menu: AcademyMenu }
  | { kind: "action"; action: AcademyAction }
  | null;
/** `after(part)` / `finish(phase)` / the side owner's end of each CV3 part. */
export function cauVongAcademyAfter(doc: CauVongAcademyDocument, name: string): AcademyAfter {
  const branch = (marks: [number, number][]): AcademyAfter => ({
    kind: "marks",
    marks,
    clearStarted: true,
  });
  switch (name) {
    case "HATCHERY":
      return branch([[ACADEMY_HATCHERY, 0]]);
    case "ARENA_INTRO":
      return branch([[PRELIM_ARENA, 0]]);
    case "ARENA_REGISTER":
      return branch([[PRELIM_ARENA, 1]]);
    case "ARENA_OFFER":
    case "ARENA_DECLINE":
      return branch([]);
    case "ARENA_FIRST":
      return { kind: "fight", action: prelimFight(0) };
    case "ARENA_SECOND":
      return { kind: "fight", action: prelimFight(1) };
    case "ARENA_FINISH":
      return branch([
        [PRELIM_ARENA, PRELIM_OVER],
        [PRELIM_ARENA, 100],
      ]);
    case "PRE0":
    case "PRE1":
    case "PRE2":
      return { kind: "fight", action: arenaFight(Number(name.slice(3))) };
    case "POST0":
    case "POST1":
      return { kind: "hideArena" };
    case "POST2":
      return { kind: "arenaOver" };
    case "MORNING":
      return { kind: "morning" };
    case "CEREMONY":
      return { kind: "ceremony" };
    case "LESSON":
      return { kind: "marks", marks: [[CLASSROOM, LESSON_SEEN]] };
    case "FOUR_GATES":
      return {
        kind: "marks",
        marks: [
          [CLASSROOM, CLASS_ARRIVED],
          [CLASSROOM, FOUR_GATES_DONE],
        ],
      };
    case "LOCKE_PRE":
      return { kind: "fight", action: rivalFight() };
    case "LOCKE_POST":
      return { kind: "hide", id: doc.actors.locke };
    case "NIGHT":
      return { kind: "revive" };
    case "ALLIANCE":
    case "ALLIANCE_GREETING":
      return { kind: "menu", menu: "alliance" };
    case "ARENA_OFFER_REPLY":
      return { kind: "menu", menu: "arena" };
    // `CauVongAcademyShopRuntime`: the part's `nextAction`.
    case "SHOP_EVOLUTION_PRE":
    case "SHOP_MATERIALS":
      return { kind: "action", action: shopService("shop", 1) };
    case "SHOP_SCROLL":
    case "SHOP_BADGES":
      return { kind: "action", action: shopService("shop", 2, "SHOP_BADGES_BYE") };
    case "SHOP_ITEMS":
      return { kind: "action", action: shopService("shop", 0, "SHOP_ITEMS_BYE") };
    case "SHOP_BANK":
      return { kind: "action", action: shopService("bank", 0) };
    case "SHOP_GHOST_TALK":
      return { kind: "action", action: shopService("shop", 3) };
    case "SHOP_GHOST":
      return { kind: "marks", marks: [] };
    case "SHOP_INFO_OFFER":
    case "SHOP_INFO_OFFER_REPLY":
      return { kind: "menu", menu: "info" };
    case "SHOP_HARRY_OFFER":
    case "SHOP_HARRY_OFFER_REPLY":
      return { kind: "menu", menu: "harry" };
    case "SHOP_HARRY_PRE":
      return { kind: "fight", action: eggFight(9) };
    case "SHOP_POTTER_PRE":
      return { kind: "fight", action: eggFight(10) };
    // `CauVongAcademySideRuntime`: the arena merchant's greeting opens the shop.
    case "MERCHANT_GREETING":
      return { kind: "action", action: shopService("shop", 0, "MERCHANT_BYE") };
    default:
      return null;
  }
}
const rivalFight = (): AcademyAction => ({
  kind: "academyBattle",
  key: "rival",
  fight: { owner: "rival" },
});

/** A menu's answer (its marker already cleared): the part, the fight, or a line. */
export function cauVongAcademyAnswer(
  doc: CauVongAcademyDocument,
  menu: AcademyMenu,
  selected: number,
  round: number,
  done: PrepContext["done"],
): AcademyAction {
  if (menu === "round") return academyRoundAnswer(doc, round, selected, done);
  // `CauVongAcademyShopRuntime`'s two offers.
  if (menu === "info") return selected === 0 ? { kind: "payInfo" } : part(doc, "SHOP_INFO_DECLINE");
  if (menu === "harry")
    return selected === 0 ? part(doc, "SHOP_HARRY_PRE") : part(doc, "SHOP_HARRY_DECLINE");
  if (menu === "locke") {
    if (selected !== 0) return null;
    return done(ACADEMY_YARD, doc.flags.lockeBefore) ? rivalFight() : part(doc, "LOCKE_PRE");
  }
  if (menu === "alliance") {
    if (selected === 2) return part(doc, "INFORMATION");
    if (selected === 3) return part(doc, "ADVICE");
    return null;
  }
  // `choice(owner 1)`: the next round, or the decline; a finished one fights or reads again.
  const won = done(PRELIM_ARENA, doc.flags.roundWon);
  const name = selected === 0 ? (won ? "ARENA_SECOND" : "ARENA_FIRST") : "ARENA_DECLINE";
  const p = doc.parts[name];
  if (done(p.room, p.flag)) return selected === 0 ? prelimFight(won ? 1 : 0) : repeat(doc, name);
  return part(doc, name);
}

/** What a fight's result does (`handleBattleResult` of each owner). */
export type AcademyResult =
  | { kind: "part"; name: string; marks: [number, number][]; clear?: [number, number][] }
  | {
      kind: "line";
      text: AcademyText;
      marks: [number, number][];
      clear?: [number, number][];
      heal?: boolean;
      hideArena?: boolean;
    }
  | null;
export function cauVongAcademyResult(
  doc: CauVongAcademyDocument,
  fight: AcademyFight,
  won: boolean,
): AcademyResult {
  switch (fight.owner) {
    case "prelim": {
      const pending: [number, number] = [PRELIM_ARENA, doc.flags.battlePending + fight.round];
      if (won)
        return {
          kind: "part",
          name: fight.round === 0 ? "ARENA_SECOND" : "ARENA_FINISH",
          marks: [[PRELIM_ARENA, doc.flags.roundWon + fight.round]],
          clear: [pending],
        };
      return { kind: "line", text: doc.text.prelimLoss, marks: [], clear: [pending], heal: true };
    }
    case "arena":
      if (won)
        return {
          kind: "part",
          name: `POST${fight.round}`,
          marks: [[MIDDLE_ARENA, 101 + fight.round]],
        };
      return { kind: "line", text: doc.text.arenaLoss, marks: [], hideArena: true };
    case "rival":
      if (won)
        return { kind: "part", name: "LOCKE_POST", marks: [[ACADEMY_YARD, doc.flags.lockeWon]] };
      return { kind: "line", text: doc.text.rivalLoss, marks: [] };
    case "egg": {
      // `handleBattleResult`: the win flag and the scene after it; a loss keeps what was paid/won.
      const harry = fight.event === 9;
      if (won)
        return {
          kind: "part",
          name: harry ? "SHOP_HARRY_POST" : "SHOP_POTTER_POST",
          marks: [[SHOP_ROOM, harry ? doc.shop43.flags.harryWon : doc.shop43.flags.potterWon]],
        };
      return { kind: "part", name: harry ? "SHOP_HARRY_DECLINE" : "SHOP_POTTER_LOSS", marks: [] };
    }
    case "roster": {
      if (!won) return null;
      const text = doc.text.rosterWin[String(fight.event)];
      return { kind: "line", text, marks: [[ACADEMY_YARD, fight.event]] };
    }
  }
}

/** `CauVongAcademySideRuntime.rank`. */
export function allianceRank(doc: CauVongAcademyDocument, done: PrepContext["done"]): number {
  let rank = 1;
  for (let r = 2; r <= 5; r++) if (done(CLASSROOM, doc.text.rank.base + r)) rank = r;
  return rank;
}
/** `upgrade`: the line, and the rank flag it writes (if any). */
export function allianceUpgrade(
  doc: CauVongAcademyDocument,
  done: PrepContext["done"],
  collected: number,
): { text: string; mark: [number, number] | null } {
  const rank = allianceRank(doc, done),
    t = doc.text.rank;
  if (rank === 5) return { text: t.top, mark: null };
  const needed = t.needed[rank - 1];
  if (collected < needed)
    return {
      text: t.short
        .replace("{rank}", String(rank))
        .replace("{count}", String(collected))
        .replace("{needed}", String(needed))
        .replace("{missing}", String(needed - collected)),
      mark: null,
    };
  return { text: t.up.replace("{rank}", String(rank + 1)), mark: [CLASSROOM, t.base + rank + 1] };
}
/** `claimMedals`'s line for `n` new species. */
export const medalLine = (doc: CauVongAcademyDocument, n: number) =>
  n === 0 ? doc.text.medals.none : doc.text.medals.some.replaceAll("{n}", String(n));

/** The cast these owners leave in a room (`applyCast`s, in Java's order). */
export function cauVongAcademyCast(
  doc: CauVongAcademyDocument,
  room: number,
  done: PrepContext["done"],
): { cues: CauVongCue[]; visible: [number, boolean][] } {
  const cast = { cues: [] as CauVongCue[], visible: [] as [number, boolean][] };
  const finished = (name: string) => done(doc.parts[name].room, doc.parts[name].flag);
  // `CauVongAcademySourceRuntime.applyCast` (CV2's arrival cast is its fallback in 2).
  if (!done(CLASSROOM, FOUR_GATES_DONE)) {
    if (room === ACADEMY_YARD) {
      if (finished("CEREMONY")) cast.cues.push(...(doc.cast.CEREMONY ?? []));
      else if (finished("TOUR")) cast.cues.push(...(doc.cast.TOUR ?? []));
      if (done(DORM, NIGHT_DONE))
        cast.visible.push([doc.actors.ceremonyA, false], [doc.actors.ceremonyB, false]);
      if (finished("PRINCIPAL")) cast.cues.push(...(doc.cast.PRINCIPAL ?? []));
    } else if (room === DORM && finished("DORM")) {
      cast.cues.push(...(doc.cast.DORM ?? []));
      if (finished("MORNING")) cast.cues.push(...(doc.cast.MORNING ?? []));
    }
  }
  // `CauVongAcademySideRuntime.applyCast`: Lạc Khắc waits in the yard after the arena.
  if (room === ACADEMY_YARD && sourceRoute(done))
    cast.visible.push(
      [
        doc.actors.locke,
        done(MIDDLE_ARENA, ARENA_DONE) && !done(ACADEMY_YARD, doc.flags.lockeAfter),
      ],
      // CV4c: An Kỳ Nhi waits in the yard for her tour.
      [
        doc.actors.angel,
        done(CLASSROOM, ANGEL_INTRODUCED) && !done(ACADEMY_YARD, doc.parts.ANGEL.flag),
      ],
    );
  // `CauVongAcademyShopRuntime.applyCast`: the ghost merchant once he has shown himself.
  if (room === SHOP_ROOM)
    cast.visible.push([doc.shop43.ghost, done(SHOP_ROOM, doc.parts.SHOP_GHOST.flag)]);
  // `CauVongAcademyLaterPrincipal.applyCast`: the principal waits for a report.
  if (room === MIDDLE_ARENA)
    cast.visible.push([doc.laterPrincipal.actor, laterReport(doc, done) !== null]);
  // `MissingBranches.applyCast`: every finished part of the room.
  for (const name of BRANCH_PARTS) {
    const p = doc.parts[name];
    if (p.room === room && done(room, p.flag)) cast.cues.push(...(doc.cast[name] ?? []));
  }
  return cast;
}
/** Whether CV2's arrival cast still belongs to the yard (no later phase owns it). */
export const yardArrivalCast = (doc: CauVongAcademyDocument, done: PrepContext["done"]) =>
  !done(CLASSROOM, FOUR_GATES_DONE) &&
  !done(ACADEMY_YARD, doc.parts.TOUR.flag) &&
  !done(ACADEMY_YARD, doc.parts.CEREMONY.flag);
export { DORM_SLEPT };
