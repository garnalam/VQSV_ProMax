// JavaSE parity: main quest CV2 "Cầu Vồng — chăm trứng, chuẩn bị đi học" (done at 2:101). After the
// ruins egg, `CauVongChapterRuntime.tick` hands these rooms to their owners in a fixed order; this file
// is their decisions, in that order:
//
//   0   `openingSource` (INCUBATOR_RETURN), then `openingStory` (Jess's lesson) ahead of the residents
//   54  `openingStory`: Rom's lesson and the 10.000 kim gift, after the family welcome
//   55  `openingSource` (MANOR_ARRIVAL) → `openingSideQuests` (the hatchery) → `tickHousehold`
//   1   `missingBranches` (Đông Phương's scene, 1:10) ahead of the guards' triggers and `tickCity`
//   44  `missingBranches` (Đông Phương, the café) → `tickSideRoom`
//   50  `missingBranches` (the lift) → `summoning` (the hub's first scene) → the residents
//   2   `academySource` (ARRIVAL, TUITION, REGISTER) → `tickAcademy`
//
// The sequences and the runtimes' own lines are baked by rebuild_game/tools/WebCauVongPrep.java
// (`cau-vong-world/prep.json`). Where Java opens the five-slot incubator (Jess's lesson, the
// hatchery helper's `nextChoice 7` and menu answer) the web opens it too (`CauVongIncubator.ts`;
// owner decision 2026-11-12, reversing 2026-11-09's).
import { type CauVongAcademyDocument, yardArrivalCast } from "./CauVongAcademy";
import type { CauVongCue, CauVongCuesDocument, CauVongPart } from "./CauVongCutscene";
import type { OpeningAction, OpeningContext, OpeningRosterNpc } from "./CauVongOpening";
import {
  type SourceRect,
  playerIntersectsSourceRect,
  playerSourcePointInRect,
} from "./WorldInteractionEngine";

/** `HATCHERY_ROOM_INDEX`, `CAFE_ROOM_INDEX`, the Thiên Không hub and `ACADEMY_ROOM_INDEX`. */
export const PREP_ROOMS = [55, 44, 50, 2] as const;
export const SQUARE_ROOM = 0;
export const HOME_ROOM = 54;
export const HATCHERY_ROOM = 55;
export const CAFE_ROOM = 44;
export const HUB_ROOM = 50;
export const ACADEMY_ROOM = 2;
const CITY_ROOM = 1;

/** `CauVongOpeningStory`: COMPLETE 130, TUITION 131, STARTED 132, TUITION_STARTED 133. */
const STORY_COMPLETE = 130;
const HOME_TUITION = 131;
const STORY_STARTED = 132;
const TUITION_STARTED = 133;
/** `ROM_ACTOR` (54) and Jess (`SQUARE_NPCS[0]`, 0). */
const ROM = 12;
const JESS = 24;
/** 6:100, the ruins egg: everything here waits for it. */
const RUINS_EGG: [number, number] = [6, 100];
/** 0:101, Jess's lesson is over: what the academy's registration reads. */
export const LESSON_DONE = 101;
/** `CauVongOpeningSideQuests` in 55. */
const EGG_UNLOCKED = 128;
const HATCHERY_REWARDED = 123;
const HATCHERY_INTRO = 139;
const HATCHERY_INTRO_STARTED = 140;
const HATCHERY_CHECK_STARTED = 141;
const HATCHERY_EGG_RECEIPT = 7310;
const HATCHERY_PICKUP_STARTED = 7311;
/** `CauVongMissingBranchesRuntime`: Đông Phương's scene is over (1:10), 44:4 he left, menus 822000+. */
export const DONG_SEEN = 10;
const DONG_GONE = 4;
const CAFE_NOTICED = 2;
const CAFE_LIFT_OPEN = 6;
const CAFE_ACCEPTED = 100;
const CAFE_REWARDED = 101;
const MENU_BASE = 822000;
/** `CauVongSummoningRuntime.completed(50, 0)` and its task marker. */
export const HUB_SEEN = 651100;
/** `CauVongAcademySourceRuntime`: 2:100 arrived, 2:101 registered, 2:147 paid, 2:102 gate hint. */
export const ACADEMY_ARRIVED = 100;
export const ACADEMY_REGISTERED = 101;
const ACADEMY_GATE_HINT = 102;
/** `sourceCanPay(s, 0, 5000)` / `sourcePay`. */
export const ACADEMY_FEE = 5000;
/** `sourceAdjustCurrencyFloorZero(s, 0, 10000)`: Rom's gift once Jess has taught the hero. */
export const HOME_GIFT = 10000;

export type PrepLine = { actorId: number; name: string; line: string };
export type PrepRosterNpc = OpeningRosterNpc & { battle: number };
export type PrepPetGrant = { species: number; level: number; nature: number; receipt: number };
export type CauVongPrepDocument = {
  parts: Record<string, CauVongPart>;
  /** `castOnly` restores of finished parts, by part. */
  cast: Record<string, CauVongCue[]>;
  /** `tickHousehold` in 55 and `tickSideRoom` in 44: the runtimes' own lines, by actor. */
  hatcheryLines: PrepLine[];
  cafeLines: PrepLine[];
  /** `CauVongNorthSeaNpcRuntime.passives(44)`: they answer ahead of `tickSideRoom`. */
  cafePassives: PrepLine[];
  academy: {
    guide: { early: CauVongCue; egg: CauVongCue; registered: CauVongCue };
    gateHint: string;
    pass: { id: number; name: string; description: string };
    prelimRequired: number;
  };
  roster: Record<string, PrepRosterNpc[]>;
  dong: PrepPetGrant & { ride: number };
  cafe: PrepPetGrant & { wanted: number[]; actor: number; collector: number };
  capacityText: string;
  /** `academyWestExit`: the door tiles of 2 that lead to the city, as pixel corners. */
  academyCityDoors: [number, number][];
  hatchery: {
    npc: number;
    eggRect: [number, number, number, number];
    eggActors: number[];
    eggStates: number[];
    need: number;
    eggSay: Extract<CauVongCue, { k: "say" }>;
  };
};

/** The menus these rooms open (`ChoiceBox.optionUi`), by `MissingBranches` owner or the hatchery's. */
export type PrepMenu = "cafeOffer" | "cafeLift" | "hubLift" | "hatchery";
export const PREP_MENU_OWNER: Record<Exclude<PrepMenu, "hatchery">, number> = {
  cafeOffer: 2,
  cafeLift: 3,
  hubLift: 6,
};
export const PREP_CHOICES: Record<PrepMenu, string[]> = {
  cafeOffer: ["Có", "Không"],
  cafeLift: ["Leo lên", "Rời đi"],
  hubLift: ["Xuống dưới", "Không xuống"],
  hatchery: ["Kiểm tra và mở khóa trứng", "Mở bảng ấp trước"],
};

/** What these rooms read beyond the opening's context. */
export type PrepContext = OpeningContext & {
  /** `rainbowCollected`: collected species 100..201. */
  collected: number;
  money: number;
  /** `CauVongDormPetQuest.hasSpace(s, 1)`: a free roster or bank slot. */
  hasSpace: boolean;
  /** `hasPet`: in the roster or the bank. */
  owns: (species: number) => boolean;
};

/** What the room does this tick, beyond the opening's actions. */
export type PrepAction =
  | OpeningAction
  /** A menu, its durable marker written first; `reply` plays ahead of it (the café offer). */
  | { kind: "prepMenu"; menu: PrepMenu; reply?: string }
  | { kind: "grantPet"; grant: "dong" | "cafe"; next: string }
  | { kind: "fee" };

const part = (doc: CauVongPrepDocument, name: string, clear = false): OpeningAction => ({
  kind: "part",
  name,
  part: doc.parts[name],
  clear,
});
/** One line as a sequence without checkpoints (`CauVongOpeningDialogue.play`). */
const reply = (cue: CauVongCue, name: string, room: number): OpeningAction => ({
  kind: "part",
  name,
  part: { room, event: -1, flag: -1, started: -1, cue: -1, steps: [cue] },
});
const rect = (r: [number, number, number, number]): SourceRect => ({
  x: r[0],
  y: r[1],
  width: r[2],
  height: r[3],
});
/** `at(s, x, y, x2, y2)`: the hero's source point in a tile rectangle. */
const tilesAt = (ctx: PrepContext, x: number, y: number, x2: number, y2: number) =>
  playerSourcePointInRect(ctx.player.x, ctx.player.y, {
    x: x * 20,
    y: y * 20,
    width: (x2 - x + 1) * 20,
    height: (y2 - y + 1) * 20,
  });

/** The Đông Phương and café parts of `MissingBranches.Part`, in ordinal order. */
const BRANCH_PARTS = [
  "CITY_DONG",
  "DONG_BEFORE",
  "DONG_AFTER",
  "CAFE_NOTICE",
  "CAFE_OFFER",
  "CAFE_ACCEPT",
  "CAFE_DECLINE",
  "CAFE_REWARD_BEFORE",
  "CAFE_REWARD_AFTER",
  "CAFE_UP",
  "CAFE_STAY",
  "HUB_CAFE_DOWN",
  "HUB_CAFE_STAY",
] as const;
/** `CauVongAcademySourceRuntime.Phase` of CV2, in ordinal order. */
const ACADEMY_PARTS = ["ACADEMY_ARRIVAL", "ACADEMY_REGISTER", "ACADEMY_TUITION"] as const;

/**
 * `CauVongMissingBranchesRuntime.tick`'s head in any of its rooms: a menu left open (its durable
 * 822000+owner marker), then a started part (the café reward and Đông Phương check for room first).
 */
function branchResume(doc: CauVongPrepDocument, room: number, ctx: PrepContext): PrepAction {
  const { done } = ctx;
  for (const [menu, owner] of Object.entries(PREP_MENU_OWNER))
    if (done(room, MENU_BASE + owner)) return { kind: "prepMenu", menu: menu as PrepMenu };
  for (const name of BRANCH_PARTS) {
    const p = doc.parts[name];
    if (p.room !== room || !done(room, p.started) || done(room, p.flag)) continue;
    // `preflight`: the two pet grants need a free slot before their scene starts.
    if ((name === "DONG_BEFORE" || name === "CAFE_REWARD_BEFORE") && !preflight(doc, name, ctx))
      return capacity(doc);
    return part(doc, name);
  }
  return null;
}
function preflight(
  doc: CauVongPrepDocument,
  name: "DONG_BEFORE" | "CAFE_REWARD_BEFORE",
  ctx: PrepContext,
): boolean {
  const receipt = name === "DONG_BEFORE" ? doc.dong.receipt : doc.cafe.receipt;
  return ctx.done(CAFE_ROOM, receipt) || ctx.hasSpace;
}
/** `capacity(receipt)`: the full-party notice. */
function capacity(doc: CauVongPrepDocument): PrepAction {
  return reply(
    { k: "say", speaker: "", text: doc.capacityText, portrait: -1 },
    "CAPACITY",
    CAFE_ROOM,
  );
}

/** Room 0, ahead of the square's own conversations: the incubation lesson and its walk home. */
export function cauVongPrepSquare(
  doc: CauVongPrepDocument,
  cues: CauVongCuesDocument,
  ctx: OpeningContext,
  introDone: boolean,
): OpeningAction {
  const { done, requested } = ctx;
  // `openingSource`: INCUBATOR_RETURN resumes once started.
  const back = cues.parts.INCUBATOR_RETURN;
  if (back && done(SQUARE_ROOM, back.started) && !done(SQUARE_ROOM, back.flag))
    return { kind: "part", name: "INCUBATOR_RETURN", part: back, source: true };
  if (!introDone) return null;
  // `openingStory.tick` (0): Jess's lesson after the ruins egg.
  if (
    done(...RUINS_EGG) &&
    !done(SQUARE_ROOM, STORY_COMPLETE) &&
    (done(SQUARE_ROOM, STORY_STARTED) || requested(JESS))
  )
    return part(doc, "JESS");
  return null;
}

/** `openingStory.tick` in 54 after the family welcome: Rom's lesson, then his 10.000 kim. */
export function cauVongPrepHome(doc: CauVongPrepDocument, ctx: OpeningContext): OpeningAction {
  const { done, requested } = ctx;
  if (
    done(...RUINS_EGG) &&
    !done(HOME_ROOM, STORY_COMPLETE) &&
    (done(HOME_ROOM, STORY_STARTED) || requested(ROM))
  )
    return part(doc, "STEWARD");
  if (
    done(SQUARE_ROOM, STORY_COMPLETE) &&
    !done(HOME_ROOM, HOME_TUITION) &&
    !done(ACADEMY_ROOM, ACADEMY_REGISTERED) &&
    (done(HOME_ROOM, TUITION_STARTED) || requested(ROM))
  )
    // The gift and 54:131 are written together once the scene is over (`completingFlag`).
    return {
      kind: "part",
      name: "HOME_TUITION",
      part: { ...doc.parts.HOME_TUITION, flag: -1 },
    };
  return null;
}

/** `missingBranches.tick` in 1: Đông Phương's scene, once the ruins egg is found. */
export function cauVongPrepCity(doc: CauVongPrepDocument, ctx: OpeningContext): OpeningAction {
  const { done } = ctx,
    dong = doc.parts.CITY_DONG;
  if (done(CITY_ROOM, dong.started) && !done(CITY_ROOM, dong.flag)) return part(doc, "CITY_DONG");
  if ((done(6, 1) || done(...RUINS_EGG)) && !done(CITY_ROOM, DONG_SEEN))
    return part(doc, "CITY_DONG");
  return null;
}

/** The rooms CV2 owns outright: 55, 44, 50 and 2. */
export function cauVongPrepAction(
  doc: CauVongPrepDocument,
  cues: CauVongCuesDocument,
  room: number,
  ctx: PrepContext,
): PrepAction {
  if (room === HATCHERY_ROOM) return hatchery(doc, cues, ctx);
  if (room === CAFE_ROOM) return cafe(doc, ctx);
  if (room === HUB_ROOM) return hub(doc, ctx);
  if (room === ACADEMY_ROOM) return academy(doc, ctx);
  return null;
}

/** `openingSource` (MANOR_ARRIVAL), `openingSideQuests` and `tickHousehold` in 55. */
function hatchery(
  doc: CauVongPrepDocument,
  cues: CauVongCuesDocument,
  ctx: PrepContext,
): PrepAction {
  const { done, requested, confirm } = ctx;
  const arrival = cues.parts.MANOR_ARRIVAL;
  if (
    arrival &&
    !done(HATCHERY_ROOM, arrival.flag) &&
    (done(HATCHERY_ROOM, arrival.started) || done(...RUINS_EGG))
  )
    return { kind: "part", name: "MANOR_ARRIVAL", part: arrival, source: true };
  const egg = done(...RUINS_EGG),
    rewarded = done(HATCHERY_ROOM, HATCHERY_REWARDED);
  if (egg) {
    if (done(HATCHERY_ROOM, HATCHERY_PICKUP_STARTED) && !rewarded)
      return part(doc, "HATCHERY_PICKUP");
    if (done(HATCHERY_ROOM, HATCHERY_INTRO_STARTED) && !done(HATCHERY_ROOM, HATCHERY_INTRO))
      return hatcheryIntro(doc, ctx);
    if (done(HATCHERY_ROOM, HATCHERY_CHECK_STARTED) && !done(HATCHERY_ROOM, EGG_UNLOCKED))
      return part(doc, "HATCHERY_UNLOCK");
  }
  if (egg && !rewarded && requested(doc.hatchery.npc)) {
    if (!done(HATCHERY_ROOM, HATCHERY_INTRO)) return hatcheryIntro(doc, ctx);
    if (ctx.collected < doc.hatchery.need) return part(doc, "HATCHERY_SHORT");
    if (done(HATCHERY_ROOM, EGG_UNLOCKED)) return part(doc, "HATCHERY_READY");
    return part(doc, "HATCHERY_CHECK");
  }
  if (
    egg &&
    !rewarded &&
    playerIntersectsSourceRect(ctx.player.x, ctx.player.y, rect(doc.hatchery.eggRect)) &&
    confirm
  ) {
    if (!done(HATCHERY_ROOM, EGG_UNLOCKED))
      return reply(doc.hatchery.eggSay, "HATCHERY_EGG", HATCHERY_ROOM);
    return part(doc, "HATCHERY_PICKUP");
  }
  for (const npc of doc.hatcheryLines)
    if (ctx.actor(npc.actorId)?.visible && requested(npc.actorId))
      return { kind: "talk", name: npc.name, line: npc.line };
  return null;
}
/** `hatcheryIntro`: the short variant counts the collected species; the full one asks to check. */
function hatcheryIntro(doc: CauVongPrepDocument, ctx: PrepContext): PrepAction {
  if (ctx.collected >= doc.hatchery.need) return part(doc, "HATCHERY_INTRO_FULL");
  const p = doc.parts.HATCHERY_INTRO;
  return {
    kind: "part",
    name: "HATCHERY_INTRO",
    part: {
      ...p,
      steps: p.steps.map((cue) =>
        cue.k === "say" ? { ...cue, text: cue.text.replace("{n}", String(ctx.collected)) } : cue,
      ),
    },
  };
}

/** `missingBranches.tick` in 44 (Đông Phương, the café), then `tickSideRoom`'s residents. */
function cafe(doc: CauVongPrepDocument, ctx: PrepContext): PrepAction {
  const { done, requested, confirm } = ctx;
  const resumed = branchResume(doc, CAFE_ROOM, ctx);
  if (resumed) return resumed;
  const finished = (name: string) => done(CAFE_ROOM, doc.parts[name].flag);
  if (finished("DONG_BEFORE") && !finished("DONG_AFTER"))
    return { kind: "grantPet", grant: "dong", next: "DONG_AFTER" };
  if (finished("CAFE_REWARD_BEFORE") && !finished("CAFE_REWARD_AFTER"))
    return { kind: "grantPet", grant: "cafe", next: "CAFE_REWARD_AFTER" };
  if (done(CITY_ROOM, DONG_SEEN) && !done(CAFE_ROOM, DONG_GONE))
    return preflight(doc, "DONG_BEFORE", ctx) ? part(doc, "DONG_BEFORE") : capacity(doc);
  if (done(CAFE_ROOM, DONG_GONE) && !done(CAFE_ROOM, CAFE_NOTICED) && tilesAt(ctx, 0, 12, 6, 15))
    return part(doc, "CAFE_NOTICE");
  if (requested(doc.cafe.actor)) {
    if (done(CAFE_ROOM, CAFE_REWARDED)) return passive(doc, doc.cafe.actor);
    if (!done(CAFE_ROOM, CAFE_ACCEPTED))
      return { kind: "prepMenu", menu: "cafeOffer", reply: "CAFE_OFFER_REPLY" };
    if (doc.cafe.wanted.every((species) => ctx.owns(species)))
      return preflight(doc, "CAFE_REWARD_BEFORE", ctx)
        ? part(doc, "CAFE_REWARD_BEFORE")
        : capacity(doc);
    return part(doc, "CAFE_ACCEPT_REPLY");
  }
  if (done(CAFE_ROOM, CAFE_LIFT_OPEN) && tilesAt(ctx, 4, 3, 4, 3) && confirm)
    return { kind: "prepMenu", menu: "cafeLift" };
  for (const npc of doc.cafePassives)
    if (ctx.actor(npc.actorId)?.visible && requested(npc.actorId)) return passive(doc, npc.actorId);
  for (const npc of doc.cafeLines)
    if (ctx.actor(npc.actorId)?.visible && requested(npc.actorId))
      return { kind: "talk", name: npc.name, line: npc.line };
  return null;
}
function passive(doc: CauVongPrepDocument, actorId: number): PrepAction {
  const npc = doc.cafePassives.find((line) => line.actorId === actorId)!;
  return reply(
    { k: "say", speaker: npc.name, text: npc.line, portrait: -1 },
    "CAFE_PASSIVE",
    CAFE_ROOM,
  );
}

/** `missingBranches.tick` (the lift), `summoning.tick` (the first scene), then the residents of 50. */
function hub(doc: CauVongPrepDocument, ctx: PrepContext): PrepAction {
  const { done, confirm } = ctx;
  const resumed = branchResume(doc, HUB_ROOM, ctx);
  if (resumed) return resumed;
  if (done(HUB_ROOM, HUB_SEEN) && tilesAt(ctx, 22, 26, 22, 26) && confirm)
    return { kind: "prepMenu", menu: "hubLift" };
  const arrival = doc.parts.HUB_ARRIVAL;
  if (!done(HUB_ROOM, HUB_SEEN) || done(HUB_ROOM, arrival.started)) return part(doc, "HUB_ARRIVAL");
  return roster(doc, HUB_ROOM, ctx);
}

/** `academySource.tick` in 2 (CV2's phases), then `tickAcademy`. */
function academy(doc: CauVongPrepDocument, ctx: PrepContext): PrepAction {
  const { done, requested, player } = ctx;
  for (const name of ACADEMY_PARTS) {
    const p = doc.parts[name];
    if (done(ACADEMY_ROOM, p.started) && !done(ACADEMY_ROOM, p.flag)) return part(doc, name);
  }
  if (!done(ACADEMY_ROOM, ACADEMY_ARRIVED)) return part(doc, "ACADEMY_ARRIVAL");
  if (!done(ACADEMY_ROOM, ACADEMY_REGISTERED) && done(SQUARE_ROOM, LESSON_DONE) && requested(1))
    return { kind: "fee" };
  if (requested(1)) {
    const guide = doc.academy.guide;
    if (done(ACADEMY_ROOM, ACADEMY_REGISTERED))
      return reply(guide.registered, "ACADEMY_GUIDE", ACADEMY_ROOM);
    if (done(...RUINS_EGG)) return reply(guide.egg, "ACADEMY_GUIDE", ACADEMY_ROOM);
    return reply(guide.early, "ACADEMY_GUIDE", ACADEMY_ROOM);
  }
  const npc = roster(doc, ACADEMY_ROOM, ctx);
  if (npc) return npc;
  // The classroom gate: shut until registered, its hint once.
  if (
    !done(ACADEMY_ROOM, ACADEMY_REGISTERED) &&
    !done(ACADEMY_ROOM, ACADEMY_GATE_HINT) &&
    playerSourcePointInRect(player.x, player.y, { x: 40, y: 300, width: 40, height: 20 })
  )
    return {
      kind: "say",
      text: doc.academy.gateHint,
      mark: [ACADEMY_ROOM, ACADEMY_GATE_HINT],
    };
  return null;
}

/** `tickRosterNpc`: a visible resident the hero talks to. */
function roster(doc: CauVongPrepDocument, room: number, ctx: PrepContext): PrepAction {
  for (const npc of doc.roster[String(room)] ?? []) {
    if (!ctx.actor(npc.actorId)?.visible || !ctx.requested(npc.actorId)) continue;
    return { kind: "roster", npc };
  }
  return null;
}

/** The rooms' exits, checked before and after the step (`sideRoomExit`, `returnTo...`). */
/** The North Sea's office: its west door leads back to the yard, its north door to the dock (28). */
const NORTH_SEA_OFFICE_ROOM = 27;
/**
 * The yard's east doors (2's native rows 2 and 3, tiles 27,17 and 27,18) into 27. Each lands one
 * tile inside 27's west door (its rows 0 and 1, tiles 0,30 and 0,29), facing east, as
 * `CauVongFourGateRoutes.exit` places a native door's arrival.
 *
 * Bug fix: Java's `tickAcademy` checks only the yard's hand-written doors, never these two, so the
 * office (27), the only way to reach the North Sea, could not be entered.
 */
const ACADEMY_OFFICE_DOORS: readonly (readonly [number, number, number, number])[] = [
  [27, 17, 30, 619],
  [27, 18, 30, 599],
];
export function cauVongPrepExit(
  doc: CauVongPrepDocument,
  room: number,
  player: { x: number; y: number },
): PrepAction {
  const at = (x: number, y: number, width: number, height: number) =>
    playerIntersectsSourceRect(player.x, player.y, { x, y, width, height });
  const exit = (to: number, x: number, y: number): PrepAction => ({ kind: "exit", room: to, x, y });
  switch (room) {
    case HATCHERY_ROOM:
      return at(88, 442, 56, 48) ? exit(SQUARE_ROOM, 200, 460) : null;
    case CAFE_ROOM:
      return at(40, 520, 440, 44) ? exit(CITY_ROOM, 350, 500) : null;
    case ACADEMY_ROOM:
      for (const [x, y] of doc.academyCityDoors)
        if (playerSourcePointInRect(player.x, player.y, { x, y, width: 19, height: 19 }))
          return exit(CITY_ROOM, 482, 136);
      for (const [tx, ty, x, y] of ACADEMY_OFFICE_DOORS)
        if (
          playerSourcePointInRect(player.x, player.y, {
            x: tx * 20,
            y: ty * 20,
            width: 20,
            height: 20,
          })
        )
          return { kind: "exit", room: NORTH_SEA_OFFICE_ROOM, x, y, dir: 1 };
      return null;
    default:
      return null;
  }
}
/**
 * Where the city's café door (`citySideEntrance`, 310..430 × 424..472 in 1) lands in 44.
 *
 * Bug fix: Java's (240, 500) is under the café's south wall (its floor ends at y 479), in the closed
 * black strip between the two door corridors (x 40..79 and 440..479). That strip is walkable, so
 * the hero stood outside the room and the first step into its exit row (y 520+) threw him back to
 * the city. He now lands on the floor just inside the corridor under the door he walked through:
 * 1's door tiles 16 and 20 (x 320 and 400) are 44's west and east doors.
 */
export function cauVongCafeArrival(cityX: number): { x: number; y: number } {
  return { x: cityX < 370 ? 60 : 460, y: 465 };
}
/** `citySideEntrance`'s café door, ahead of the city's own exits. */
export function cauVongPrepCityExit(player: { x: number; y: number }): PrepAction {
  return playerIntersectsSourceRect(player.x, player.y, { x: 310, y: 424, width: 120, height: 48 })
    ? { kind: "exit", room: CAFE_ROOM, ...cauVongCafeArrival(player.x) }
    : null;
}

/** What a finished sequence leaves to do. */
export type PrepAfter =
  | { kind: "lesson" }
  /** `nextChoice 7`: the five-slot incubator (after the hatchery cast when `cast`). */
  | { kind: "incubator"; cast?: boolean }
  | { kind: "exit"; room: number; x: number; y: number; dir: number }
  | { kind: "homeGift" }
  | { kind: "menu"; menu: PrepMenu }
  | { kind: "branch"; marks: [number, number][]; exit?: [number, number, number, number] }
  | { kind: "hub" }
  | { kind: "registered" }
  | { kind: "start"; name: string }
  | { kind: "cast" }
  | null;
/** `after(part)` of each owner, by part name. */
export function cauVongPrepAfter(name: string): PrepAfter {
  const branch = (
    marks: [number, number][],
    exit?: [number, number, number, number],
  ): PrepAfter => ({
    kind: "branch",
    marks,
    exit,
  });
  switch (name) {
    case "JESS":
      return { kind: "lesson" };
    case "INCUBATOR_RETURN":
      return { kind: "exit", room: HOME_ROOM, x: 190, y: 179, dir: 0 };
    case "STEWARD":
      // `/event 54:1` ends with opcode 22 to the square (4, 9), facing 1.
      return { kind: "exit", room: SQUARE_ROOM, x: 90, y: 199, dir: 1 };
    case "HOME_TUITION":
      return { kind: "homeGift" };
    case "HATCHERY_INTRO_FULL":
      return { kind: "menu", menu: "hatchery" };
    case "HATCHERY_CHECK":
      return { kind: "menu", menu: "hatchery" };
    case "CAFE_OFFER_REPLY":
      return { kind: "menu", menu: "cafeOffer" };
    case "HATCHERY_INTRO":
      // Under 40 species the intro ends in `nextChoice 7` (the full one is HATCHERY_INTRO_FULL).
      return { kind: "incubator", cast: true };
    case "HATCHERY_SHORT":
    case "HATCHERY_READY":
      // `sourceReply(..., 7)`: the incubator after the reply.
      return { kind: "incubator" };
    case "HATCHERY_UNLOCK":
    case "HATCHERY_PICKUP":
    case "MANOR_ARRIVAL":
      return { kind: "cast" };
    case "CITY_DONG":
      return branch([[CITY_ROOM, DONG_SEEN]], [CAFE_ROOM, 3, 5, 2]);
    case "DONG_BEFORE":
      // The grant itself is the room's next tick (`grantDong`), resumable after a reload.
      return branch([]);
    case "DONG_AFTER":
      return branch([[CAFE_ROOM, DONG_GONE]], [HUB_ROOM, 22, 25, 2]);
    case "CAFE_NOTICE":
      return branch([[CAFE_ROOM, CAFE_NOTICED]]);
    case "CAFE_ACCEPT":
      return branch([
        [CAFE_ROOM, 7],
        [CAFE_ROOM, CAFE_ACCEPTED],
      ]);
    case "CAFE_REWARD_BEFORE":
      return branch([]);
    case "CAFE_REWARD_AFTER":
      return branch([
        [CAFE_ROOM, 3],
        [CAFE_ROOM, CAFE_REWARDED],
      ]);
    case "CAFE_UP":
      return branch([], [HUB_ROOM, 22, 25, 2]);
    case "HUB_CAFE_DOWN":
      return branch(
        [
          [HUB_ROOM, 1],
          [CAFE_ROOM, CAFE_LIFT_OPEN],
        ],
        [CAFE_ROOM, 4, 4, 0],
      );
    case "CAFE_DECLINE":
    case "CAFE_STAY":
    case "HUB_CAFE_STAY":
      return branch([]);
    case "HUB_ARRIVAL":
      return { kind: "hub" };
    case "ACADEMY_ARRIVAL":
      // `academySource.after(ARRIVAL)`: 2:100, the arrival the rest of the academy reads.
      return branch([[ACADEMY_ROOM, ACADEMY_ARRIVED]]);
    case "ACADEMY_TUITION":
      return { kind: "start", name: "ACADEMY_REGISTER" };
    case "ACADEMY_REGISTER":
      return { kind: "registered" };
    default:
      return null;
  }
}
/** Whether `name` is a `MissingBranches` part (its started marker is cleared once it is over). */
export const isBranchPart = (name: string) => (BRANCH_PARTS as readonly string[]).includes(name);

/** A menu answer: the part it starts (`reset` first for a lift already ridden), or nothing. */
export function cauVongPrepAnswer(
  doc: CauVongPrepDocument,
  menu: PrepMenu,
  selected: number,
  ctx: PrepContext,
): PrepAction {
  const { done } = ctx;
  if (menu === "hatchery") {
    // `choose(6, 0)`: the 40-species check; "Mở bảng ấp trước" (answer 1) opens the incubator.
    if (selected === 1) return { kind: "incubator" };
    if (
      selected === 0 &&
      !done(HATCHERY_ROOM, HATCHERY_REWARDED) &&
      ctx.collected >= doc.hatchery.need
    )
      return part(doc, "HATCHERY_UNLOCK");
    return null;
  }
  const name =
    menu === "cafeOffer"
      ? selected === 0
        ? "CAFE_ACCEPT"
        : "CAFE_DECLINE"
      : menu === "cafeLift"
        ? selected === 0
          ? "CAFE_UP"
          : "CAFE_STAY"
        : selected === 0
          ? "HUB_CAFE_DOWN"
          : "HUB_CAFE_STAY";
  const p = doc.parts[name];
  // `start(p)`: a part already over is reset first, so the lifts replay their movements.
  return part(doc, name, done(p.room, p.flag));
}

/** The cast of a room as its owners leave it (`applyCast`s and `applyHatcheryCast`). */
export type PrepCast = {
  visible: [number, boolean][];
  state: [number, number][];
  cues: CauVongCue[];
};
export function cauVongPrepCast(
  doc: CauVongPrepDocument,
  room: number,
  done: OpeningContext["done"],
  academy?: CauVongAcademyDocument,
): PrepCast {
  const cast: PrepCast = { visible: [], state: [], cues: [] };
  // `MissingBranches.applyCast`: every finished part of the room restores its cast.
  for (const name of BRANCH_PARTS) {
    const p = doc.parts[name];
    if (p.room === room && done(room, p.flag)) cast.cues.push(...(doc.cast[name] ?? []));
  }
  if (room === CAFE_ROOM)
    cast.visible.push([
      doc.cafe.collector,
      done(CAFE_ROOM, DONG_GONE) ||
        done(CAFE_ROOM, CAFE_ACCEPTED) ||
        done(CAFE_ROOM, CAFE_REWARDED),
    ]);
  if (room === HUB_ROOM && done(HUB_ROOM, HUB_SEEN))
    cast.cues.push(...(doc.cast.HUB_ARRIVAL ?? []));
  // `CauVongAcademySourceRuntime.applyCast`: the arrival's cast until CV3's tour/ceremony own the yard.
  if (
    room === ACADEMY_ROOM &&
    done(ACADEMY_ROOM, doc.parts.ACADEMY_ARRIVAL.flag) &&
    (!academy || yardArrivalCast(academy, done))
  )
    cast.cues.push(...(doc.cast.ACADEMY_ARRIVAL ?? []));
  if (room === HATCHERY_ROOM) {
    if (done(HATCHERY_ROOM, EGG_UNLOCKED)) cast.cues.push(...(doc.cast.HATCHERY_UNLOCK ?? []));
    const eggVisible =
      done(...RUINS_EGG) &&
      !done(HATCHERY_ROOM, HATCHERY_REWARDED) &&
      !done(HATCHERY_ROOM, HATCHERY_EGG_RECEIPT);
    doc.hatchery.eggActors.forEach((id, i) => {
      cast.visible.push([id, eggVisible]);
      cast.state.push([id, doc.hatchery.eggStates[i]]);
    });
  }
  return cast;
}
