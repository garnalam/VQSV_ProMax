// JavaSE parity: the Cầu Vồng opening route from Sai Kỳ's manor to the inner ruins egg — CV0's room
// 54 and main quest CV1 ("khám phá di tích", done at 6:100). `CauVongChapterRuntime.tick` hands these
// rooms to several owners in a fixed order; this file is their decisions, in that order:
//
//   openingSource (5/6) → switch / guard / ambient resumes → guard / ambient triggers → the ruins
//   switches (5) → the room's own handler (tickHousehold 54, tickCity 1, tickForest 11, tickRuins 5,
//   tickRuinsInner 6), whose exits are checked before and after the step.
//
// The sequences are baked by rebuild_game/tools/WebCauVongOpening.java (`cau-vong-world/opening.json`)
// and play like every Cầu Vồng cutscene (CauVongCutscene.ts); the opening-source parts of 5 and 6
// are cues.json's. What a sequence leaves to do afterwards (a menu, a grant, a cleared guard) the
// world reads back through `cauVongOpeningAfter`.
import type { RuntimeStoryEvent } from "../story/SourceOpcodeInterpreter";
import type { CauVongCue, CauVongCuesDocument, CauVongGift, CauVongPart } from "./CauVongCutscene";
import { CAU_VONG_PART_ORDER, type CauVongPartName } from "./CauVongHall";
import type { CauVongMechanic } from "./CauVongWorld";
import { type SourceRect, playerIntersectsSourceRect } from "./WorldInteractionEngine";

/** `HOME_ROOM_INDEX`, `CITY_ROOM_INDEX`, `FOREST_ROOM_INDEX`, `RUINS_ROOM_INDEX`, `RUINS_INNER_ROOM_INDEX`. */
export const OPENING_ROOMS = [54, 1, 11, 5, 6] as const;
export const HOME_ROOM = 54;
export const CITY_ROOM = 1;
export const FOREST_ROOM = 11;
export const RUINS_ROOM = 5;
export const RUINS_INNER_ROOM = 6;

/** `CauVongOpeningStory`: COMPLETE 130, STARTED 132, FAMILY_STARTED 134 (per room). */
const STORY_COMPLETE = 130;
const STORY_STARTED = 132;
const FAMILY_STARTED = 134;
/** 54:100, the family welcome is over (also the grandfather's own receipt). */
const FAMILY_DONE = 100;
/** `CauVongLunchQuestRuntime`: 1:101 accepted, 1:102 reported, 1:103 handoff, 11:100 delivered, 11:103. */
export const LUNCH_ACCEPTED = 101;
const LUNCH_REPORTED = 102;
const LUNCH_HANDOFF = 103;
export const LUNCH_DELIVERED = 100;
const DELIVERY_STARTED = 103;
/** `FOREST_GATE_HINT_EVENT`, `RUINS_ARRIVAL_EVENT`, `RUINS_SWITCH_FIRST_EVENT`, `RUINS_SWITCH_HINT_EVENT`. */
const FOREST_GATE_HINT = 102;
const RUINS_ARRIVAL = 100;
const RUINS_SWITCH_FIRST = 103;
const RUINS_SWITCH_HINT = 106;
/** `RUINS_EGG_EVENT` / `RUINS_EGG_REWARD_EVENT` in 6, and `CauVongSwitchMechanisms.INNER_SWITCH`. */
export const RUINS_EGG = 100;
export const RUINS_EGG_REWARD = 101;
const INNER_SWITCH = 102;
/** `CauVongOpeningSideQuests` flags in 5. */
const BOY_ACCEPTED = 120;
export const BOY_TRADED = 121;
const BOY_REWARD_SCENE = 124;
const MERCHANT_SEEN = 125;
const MERCHANT_STARTED = 126;
const MERCHANT_GIFT = 135;
export const BOY_EXTRA_GIFT = 136;
const BOY_REQUEST_STARTED = 137;
const BOY_REQUEST_SEEN = 138;
/** `LUCY_ACTOR` (`CITY_GUIDE_ACTOR`), Ca Tu, the announcement's speaker, the grandfather, the boy. */
const LUCY = 1;
const CA_TU = 1;
const ANNOUNCER = 51;
const GRANDFATHER = 10;
const BOY = 50;
const MERCHANT = 1;
/** The inner ruins egg (`applyNpcVisuals`: actor 90, visual 56). */
export const INNER_EGG_ACTOR = 90;
/** The three ruins levers (`actors[90 + i]`) and the family friend of 54 (`actors[80]`). */
const LEVER_FIRST = 90;
const FAMILY_FRIEND = 80;

/** One room's roster NPC (`CauVongNpcRoster`): its line, original pose and the three facings. */
export type OpeningRosterNpc = {
  actorId: number;
  name: string;
  line: string;
  /** `CauVongInitialPoseCatalog.signedState`, restored after the line. */
  pose: number;
  /** `faceNpcTowardsPlayer`'s state for a hero looking up (0), down (1) and sideways (2). */
  faces: [number, number, number];
};
/** A `CauVongSwitchMechanisms.GATES` row of 5 or 6. */
export type OpeningGate = {
  room: number;
  event: number;
  door: number;
  flanks: number[];
  /** The door's state once open (op29's retracted gate), held on its last frame. */
  openState: number;
  closed: CauVongMechanic;
  open: CauVongMechanic;
};
export type OpeningQuest = {
  title: string;
  detail: string;
  show: [number, number] | null;
  rooms: number[];
  done: [number, number];
  /**
   * `fourGateQuestDetail`'s stages, latest first: the first whose `when` has a done flag and whose
   * `unless` has none.
   */
  variants?: {
    when: [number, number][];
    unless?: [number, number][];
    /** At least one route marker must hold, in addition to the stage marker. */
    requiresAny?: [number, number][];
    text: string;
  }[];
};
/** `fourGateQuestDetail`: the latest stage whose flag is done (the last always matches), else `detail`. */
export function openingQuestDetail(
  quest: OpeningQuest,
  done: (flag: [number, number]) => boolean,
): string {
  const variants = quest.variants;
  if (!variants?.length) return quest.detail;
  return (
    variants.find(
      (row) =>
        (row.when.length === 0 || row.when.some(done)) &&
        !row.unless?.some(done) &&
        (!row.requiresAny || row.requiresAny.some(done)),
    ) ?? variants[variants.length - 1]
  ).text;
}
/**
 * `openingQuestRows` tab 1 (the branch tab): shown once any `show` flag is done, completed by
 * `done`; its detail is the first variant whose `when` has a done flag (an empty one always
 * matches). `{count}` stands for the Cầu Vồng species collected (`rainbowCollected`).
 */
export type OpeningBranchQuest = {
  title: string;
  show: [number, number][];
  done: [number, number];
  variants: { when: [number, number][]; text: string }[];
};
/** The branch rows the flags show, as `task.ui` lists them. */
export function openingBranchRows(
  quests: readonly OpeningBranchQuest[],
  done: (room: number, event: number) => boolean,
  collected: number,
): { title: string; detail: string; completed: boolean }[] {
  return quests
    .filter((quest) => quest.show.some(([room, event]) => done(room, event)))
    .map((quest) => {
      const variant =
        quest.variants.find(
          (row) => row.when.length === 0 || row.when.some(([room, event]) => done(room, event)),
        ) ?? quest.variants[quest.variants.length - 1];
      return {
        title: quest.title,
        detail: (variant?.text ?? quest.title).replace("{count}", String(collected)),
        completed: done(...quest.done),
      };
    });
}
/** `CauVongOpeningSideQuests.add(source, qty)`: a BAG row. */
export type OpeningBagGift = { item: number; key: string; rewardId: number; qty: number };
export type CauVongOpeningDocument = {
  parts: Record<string, CauVongPart>;
  /** Guard and ambient start rectangles, `[x, y, width, height]`. */
  triggers: Record<string, [number, number, number, number]>;
  /** `castOnly` restores: "1:1" is the announcement's cast. */
  cast: Record<string, CauVongCue[]>;
  roster: Record<string, OpeningRosterNpc[]>;
  /** `tickHousehold`'s manor residents (54), lines resolved through the catalog. */
  household: { actorId: number; name: string; line: string }[];
  gates: OpeningGate[];
  /** `CauVongSwitchMechanisms.prop(6, 11)`, the inner lever. */
  innerLever: { actorId: number; x: number; y: number };
  /** `CauVongAcademySourceScenes.actorId(s, 6, 23)`, who gives INNER_GIFT. */
  innerHelper: number;
  /** Snapshots of cue-created actors the rooms talk to (the helper of 6), by room then actor. */
  extraMechanics: Record<string, Record<string, CauVongMechanic>>;
  items: {
    lunch: { id: number; name: string; description: string };
    /** `drinkRewardId()`: source item 0 as the bag row it lands as. */
    drink: number;
    /** `CauVongEggCatalog.PLANT_EGG_ITEM_ID`. */
    plantEgg: number;
  };
  /** The Thiết Đầu boy's trade: species and level wanted, the reward and the one-time extra gift. */
  boy: { species: number; level: number; reward: OpeningBagGift[]; extra: OpeningBagGift[] };
  /**
   * `openingQuestRows` in Java's order: shown once `show` is done (always when null) or while the
   * hero is in one of `rooms`, completed by `done`.
   */
  quests: OpeningQuest[];
  branchQuests: OpeningBranchQuest[];
};

/** `CauVongSourceRouteGuards.Part` and `CauVongAmbientSourceRuntime.Part` of these rooms, in order. */
const GUARDS = ["CITY_SOUTH", "ACADEMY_EARLY"] as const;
const AMBIENT = ["CITY_GATHERING", "LUNCH_SEARCH", "RUINS_ENTRANCE"] as const;
const SWITCHES = ["SWITCH_103", "SWITCH_104", "SWITCH_105"] as const;

/** The menus these rooms open (`ChoiceBox.optionUi`). */
export type OpeningMenu = "lucy" | "merchant" | "boyAccept" | "boyPet";
export const LUCY_CHOICE = ["Hỗ trợ", "Rời đi"];
export const MERCHANT_CHOICE = ["Vật phẩm — mua/bán", "Gửi/rút pet", "Rời đi"];
export const BOY_ACCEPT_CHOICE = ["Nhận nhiệm vụ", "Để lúc khác"];

/** `showForestGateHint` / `showRuinsGateHint`: `TextBox.dialog(font, "", text, -1, -1)`. */
export const FOREST_GATE_TEXT =
  "Trước khi vào di tích, hãy tìm chú Ca Tu và đưa hộp cơm của cô Lucy.";
export const RUINS_GATE_TEXT =
  "Cánh cửa vẫn khóa. Hãy tìm và bật cả ba công tắc trong Di tích Kim Loại.";
/** `choose`'s refusals while trading the pet (`say(s, "", text, 0)`). */
export const BOY_PET_CHANGED =
  "Pet đã thay đổi hoặc là pet còn sống duy nhất. Chưa giao gì; hãy chọn lại.";
export const BOY_PET_REFUSED = "Không thể giao pet; đội phải còn một pet chiến đấu được.";

/** The hero's pet as the boy's trade reads it. */
export type OpeningPet = { speciesId: number; level: number; quality: number; alive: boolean };

export type OpeningContext = {
  /** `CauVongChapterRuntime.eventDone(s, room, event)` in scene 98. */
  done: (room: number, event: number) => boolean;
  /** `CauVongNpcGeometry.requested` for a standing NPC this tick. */
  requested: (actorId: number) => boolean;
  /** The key (5 / Enter) this tick, the `consumeConfirm` of the rect-and-key starts. */
  confirm: boolean;
  player: { x: number; y: number };
  /** A room actor's position and visibility (the levers). */
  actor: (id: number) => { x: number; y: number; visible: boolean } | undefined;
  /** `lunchCount`: Lucy's lunch in the bag. */
  lunchCount: number;
  pets: readonly OpeningPet[];
};

/** What the room does this tick. */
export type OpeningAction =
  | {
      kind: "part";
      name: string;
      part: CauVongPart;
      /** cues.json's opening-source part rather than one of opening.json's. */
      source?: boolean;
      /** `clear` before `start` (EGG_EXIT_HINT). */
      clear?: boolean;
      /** Flags written once the sequence is over, before its `after`. */
      then?: [number, number][];
      /** `merchantGift` ahead of the reply. */
      gift?: CauVongGift;
    }
  | { kind: "say"; text: string; mark: [number, number] }
  | { kind: "talk"; name: string; line: string }
  | { kind: "roster"; npc: OpeningRosterNpc }
  /** `transition`; `dir` the hero's facing where the source names one (else down). */
  | { kind: "exit"; room: number; x: number; y: number; dir?: number }
  /** `openCauVongIncubatorFromWorld`: the five-slot Cầu Vồng incubator opens over the room. */
  | { kind: "incubator" }
  | null;

/** CV2's decisions inside these rooms' owners (`CauVongPrep.ts`): Rom in 54, Đông Phương in 1. */
export type OpeningHooks = { home?: () => OpeningAction; city?: () => OpeningAction };

const tiles = (rect: [number, number, number, number]): SourceRect => ({
  x: rect[0],
  y: rect[1],
  width: rect[2],
  height: rect[3],
});
const accepted = (done: OpeningContext["done"]) => done(CITY_ROOM, LUNCH_ACCEPTED);
const delivered = (done: OpeningContext["done"]) => done(FOREST_ROOM, LUNCH_DELIVERED);

/** `CauVongSourceRouteGuards.eligible`. */
function guardEligible(name: (typeof GUARDS)[number], done: OpeningContext["done"]): boolean {
  if (name === "CITY_SOUTH")
    return !accepted(done) && !delivered(done) && !done(9, 100) && !done(2, 101);
  return (
    !done(HOME_ROOM, STORY_COMPLETE) &&
    !done(0, 101) &&
    !done(2, 100) &&
    !done(2, 101) &&
    !done(9, 100)
  );
}
/** `CauVongAmbientSourceRuntime.eligible`. */
function ambientEligible(name: (typeof AMBIENT)[number], done: OpeningContext["done"]): boolean {
  if (name === "CITY_GATHERING") return done(HOME_ROOM, FAMILY_DONE);
  if (name === "LUNCH_SEARCH") return accepted(done) && !delivered(done);
  return true;
}
/** `start(p)` for a guard: CITY_SOUTH plays its post-announcement variant once 1:130 is written. */
function guardPart(doc: CauVongOpeningDocument, name: string, done: OpeningContext["done"]) {
  const variant =
    name === "CITY_SOUTH" && done(CITY_ROOM, STORY_COMPLETE) ? "CITY_SOUTH_ANNOUNCED" : name;
  return { kind: "part" as const, name: variant, part: doc.parts[variant] };
}

/** `CauVongOpeningSideQuests.eligible(species, level)`: slots another living pet would cover. */
export function boyEligible(doc: CauVongOpeningDocument, pets: readonly OpeningPet[]): number[] {
  const slots: number[] = [];
  pets.forEach((pet, i) => {
    if (pet.speciesId !== doc.boy.species || pet.level < doc.boy.level) return;
    if (pets.some((other, j) => j !== i && other.alive)) slots.push(i);
  });
  return slots;
}
/** `openPetChoice`'s rows: one per eligible slot, then "Không giao". */
export function boyPetChoice(doc: CauVongOpeningDocument, pets: readonly OpeningPet[]): string[] {
  return [
    ...boyEligible(doc, pets).map(
      (slot) => `Giao pet ô ${slot + 1} — cấp ${pets[slot].level}, ${pets[slot].quality} sao`,
    ),
    "Không giao",
  ];
}

/**
 * `CauVongOpeningSourceRuntime.tick` for 5 and 6: a started part resumes, then the egg-exit hint
 * (5) and the inner ruins parts (6). `laterVisit`'s receipts are the world's (`openingRepairs`).
 */
function openingSource(
  cues: CauVongCuesDocument,
  room: number,
  ctx: OpeningContext,
  helper: number,
): OpeningAction {
  const { done, requested, confirm, player } = ctx;
  const part = (name: CauVongPartName, clear = false): OpeningAction => ({
    kind: "part",
    name,
    part: cues.parts[name],
    source: true,
    clear,
  });
  for (const name of CAU_VONG_PART_ORDER) {
    const p = cues.parts[name];
    if (p && p.room === room && done(room, p.started) && !done(room, p.flag)) return part(name);
  }
  const at = (rect: SourceRect) => playerIntersectsSourceRect(player.x, player.y, rect);
  const finished = (name: CauVongPartName) => done(cues.parts[name].room, cues.parts[name].flag);
  if (
    room === RUINS_ROOM &&
    done(RUINS_ROOM, MERCHANT_SEEN) &&
    !done(RUINS_INNER_ROOM, RUINS_EGG) &&
    at({ x: 320, y: 40, width: 60, height: 40 })
  )
    return part("EGG_EXIT_HINT", true);
  if (room !== RUINS_INNER_ROOM) return null;
  if (!finished("INNER_INTRO") && !done(RUINS_INNER_ROOM, RUINS_EGG)) return part("INNER_INTRO");
  if (done(RUINS_ROOM, 101) && !finished("INNER_OPEN")) return part("INNER_OPEN");
  if (
    !done(RUINS_INNER_ROOM, RUINS_EGG) &&
    at({ x: 100, y: 360, width: 60, height: 80 }) &&
    (requested(INNER_EGG_ACTOR) || confirm)
  )
    return part("INNER_EGG");
  if (
    finished("INNER_INTRO") &&
    !finished("INNER_HELP") &&
    at({ x: 120, y: 140, width: 100, height: 80 })
  )
    return part("INNER_HELP");
  if (done(RUINS_INNER_ROOM, INNER_SWITCH) && requested(helper) && !finished("INNER_GIFT"))
    return part("INNER_GIFT");
  return null;
}

/**
 * The receipts `CauVongOpeningSourceRuntime.tick` writes on entering 6 after the egg (or from the
 * Four Gates): the first-visit parts count as seen unless one had already started.
 */
export function openingRepairs(
  cues: CauVongCuesDocument,
  room: number,
  done: OpeningContext["done"],
): [number, number][] {
  if (room !== RUINS_INNER_ROOM || !(done(9, 102) || done(RUINS_INNER_ROOM, RUINS_EGG))) return [];
  const marks: [number, number][] = [];
  for (const name of ["INNER_OPEN", "INNER_INTRO"] as const) {
    const p = cues.parts[name];
    if (!done(RUINS_INNER_ROOM, p.started) && !done(RUINS_INNER_ROOM, p.flag))
      marks.push([RUINS_INNER_ROOM, p.flag]);
  }
  return marks;
}

/**
 * `CauVongChapterRuntime.tick` in 54, 1, 11, 5 and 6 up to the free movement: the sequence, line or
 * conversation the room starts this tick, or null when the hero walks on.
 */
export function cauVongOpeningAction(
  doc: CauVongOpeningDocument,
  cues: CauVongCuesDocument,
  room: number,
  ctx: OpeningContext,
  hooks: OpeningHooks = {},
): OpeningAction {
  const { done, requested, confirm, player } = ctx;
  const at = (rect: SourceRect) => playerIntersectsSourceRect(player.x, player.y, rect);
  const part = (name: string, then?: [number, number][]): OpeningAction => ({
    kind: "part",
    name,
    part: doc.parts[name],
    then,
  });

  const source = openingSource(cues, room, ctx, doc.innerHelper);
  if (source) return source;
  // `ruinsMechanisms.priority`, `sourceRouteGuards.priority`, `ambientSource.priority`: resumes.
  for (const name of [...SWITCHES, "INNER_SWITCH"]) {
    const p = doc.parts[name];
    if (p.room === room && done(room, p.started) && !done(room, p.flag)) return part(name);
  }
  for (const name of GUARDS) {
    const p = doc.parts[name];
    if (p.room === room && done(room, p.started)) return guardPart(doc, name, done);
  }
  for (const name of AMBIENT) {
    const p = doc.parts[name];
    if (p.room === room && done(room, p.started) && !done(room, p.flag)) return part(name);
  }
  // `missingBranches.tick`: Đông Phương's scene in the city, ahead of the guards' rectangles.
  if (room === CITY_ROOM) {
    const branch = hooks.city?.();
    if (branch) return branch;
  }
  // `sourceRouteGuards.tick`, then `ambientSource.tick`: a rectangle starts its part.
  for (const name of GUARDS)
    if (doc.parts[name].room === room && guardEligible(name, done) && at(tiles(doc.triggers[name])))
      return guardPart(doc, name, done);
  for (const name of AMBIENT) {
    const p = doc.parts[name];
    if (
      p.room === room &&
      !done(room, p.flag) &&
      ambientEligible(name, done) &&
      at(tiles(doc.triggers[name]))
    )
      return part(name);
  }
  if (room === RUINS_ROOM)
    // `ruinsMechanisms.tick` in 5: within 20 px of a lever, its activation or the key.
    for (let i = 0; i < 3; i++) {
      const event = RUINS_SWITCH_FIRST + i,
        lever = ctx.actor(LEVER_FIRST + i);
      if (done(RUINS_ROOM, event) || !lever) continue;
      if (
        at({ x: lever.x - 20, y: lever.y - 20, width: 40, height: 40 }) &&
        (requested(LEVER_FIRST + i) || confirm)
      )
        return part(`SWITCH_${event}`);
    }
  if (room === HOME_ROOM) return household(doc, ctx, hooks.home);
  if (room === CITY_ROOM) return city(doc, ctx);
  if (room === FOREST_ROOM) return forest(doc, ctx);
  if (room === RUINS_ROOM) return ruins(doc, ctx);
  // `tickRuinsInner`: `ruinsMechanisms.tick` — the inner lever by `nearProp`, then the key.
  if (room === RUINS_INNER_ROOM && !done(RUINS_INNER_ROOM, INNER_SWITCH)) {
    const lever = doc.innerLever;
    if (confirm && at({ x: lever.x - 25, y: lever.y - 25, width: 50, height: 65 }))
      return part("INNER_SWITCH");
  }
  return null;
}

/** `tickHousehold` in 54: the family welcome and Rom's lesson (`openingStory`), then the residents. */
function household(
  doc: CauVongOpeningDocument,
  ctx: OpeningContext,
  story?: () => OpeningAction,
): OpeningAction {
  const { done, requested } = ctx;
  if (!done(HOME_ROOM, FAMILY_DONE) && (done(HOME_ROOM, FAMILY_STARTED) || requested(GRANDFATHER)))
    return { kind: "part", name: "FAMILY", part: doc.parts.FAMILY };
  // `openingStory.tick` goes on to Rom's lesson and his gift (CV2).
  const lesson = story?.();
  if (lesson) return lesson;
  for (const npc of doc.household)
    if (requested(npc.actorId)) return { kind: "talk", name: npc.name, line: npc.line };
  return null;
}

/** `tickCity`: the arrival, Lucy (`lunchQuest.tickCity`), the announcement, the residents. */
function city(doc: CauVongOpeningDocument, ctx: OpeningContext): OpeningAction {
  const { done, requested } = ctx;
  const part = (name: string, then?: [number, number][]): OpeningAction => ({
    kind: "part",
    name,
    part: doc.parts[name],
    then,
  });
  if (!done(CITY_ROOM, 100)) return part("CITY_ARRIVAL");
  if (!accepted(done) && done(CITY_ROOM, LUNCH_HANDOFF)) return part("LUNCH_GIFT");
  if (requested(LUCY)) {
    if (delivered(done) && !done(CITY_ROOM, LUNCH_REPORTED))
      return part("LUCY_PASSIVE", [[CITY_ROOM, LUNCH_REPORTED]]);
    if (accepted(done) && !delivered(done)) return part("LUCY_WAITING");
    if (done(CITY_ROOM, LUNCH_REPORTED)) return part("LUCY_PASSIVE");
    return part("LUCY_OFFER");
  }
  if (!done(CITY_ROOM, STORY_COMPLETE) && (done(CITY_ROOM, STORY_STARTED) || requested(ANNOUNCER)))
    return part("ANNOUNCEMENT");
  return roster(doc, CITY_ROOM, ctx);
}

/** `tickForest`: Ca Tu (`lunchQuest.tickForest`), then the residents. */
function forest(doc: CauVongOpeningDocument, ctx: OpeningContext): OpeningAction {
  const { done, requested } = ctx;
  const part = (name: string): OpeningAction => ({ kind: "part", name, part: doc.parts[name] });
  if (!delivered(done) && done(FOREST_ROOM, DELIVERY_STARTED) && accepted(done))
    return part("LUNCH_DELIVERY");
  if (requested(CA_TU)) {
    if (delivered(done)) return part("CATU_PASSIVE");
    // `complete(11, 103)` is the part's own `started`.
    if (accepted(done) && ctx.lunchCount > 0) return part("LUNCH_DELIVERY");
    return part("CATU_PASSIVE");
  }
  return roster(doc, FOREST_ROOM, ctx);
}

/** `tickRuins`: the arrival, `openingSideQuests` (the boy and the merchant), then the residents. */
function ruins(doc: CauVongOpeningDocument, ctx: OpeningContext): OpeningAction {
  const { done, requested } = ctx;
  const part = (name: string, then?: [number, number][]): OpeningAction => ({
    kind: "part",
    name,
    part: doc.parts[name],
    then,
  });
  if (!done(RUINS_ROOM, RUINS_ARRIVAL)) return part("RUINS_ARRIVAL", [[RUINS_ROOM, RUINS_ARRIVAL]]);
  if (done(RUINS_ROOM, BOY_REQUEST_STARTED) && !done(RUINS_ROOM, BOY_REQUEST_SEEN))
    return part("BOY_REQUEST");
  if (done(RUINS_ROOM, MERCHANT_STARTED) && !done(RUINS_ROOM, MERCHANT_SEEN))
    return part("MERCHANT");
  if (done(RUINS_ROOM, BOY_TRADED) && !done(RUINS_ROOM, BOY_REWARD_SCENE))
    return part("BOY_REWARD");
  if (requested(BOY)) {
    if (done(RUINS_ROOM, BOY_TRADED)) return part("BOY_DONE");
    if (!done(RUINS_ROOM, BOY_ACCEPTED))
      return part(done(RUINS_ROOM, BOY_REQUEST_SEEN) ? "BOY_ASK" : "BOY_REQUEST");
    if (boyEligible(doc, ctx.pets).length === 0) return part("BOY_NO_PET");
    return part("BOY_OFFER");
  }
  if (requested(MERCHANT)) {
    if (!done(RUINS_ROOM, MERCHANT_SEEN)) return part("MERCHANT");
    if (!done(RUINS_ROOM, MERCHANT_GIFT)) {
      const gift = doc.parts.MERCHANT.steps.find((cue): cue is CauVongGift => cue.k === "gift");
      return { kind: "part", name: "MERCHANT_REPLY", part: doc.parts.MERCHANT_REPLY, gift };
    }
    return part("MERCHANT_REPEAT");
  }
  return roster(doc, RUINS_ROOM, ctx);
}

/** `tickRosterNpc`: a visible resident the hero talks to. */
function roster(doc: CauVongOpeningDocument, room: number, ctx: OpeningContext): OpeningAction {
  for (const npc of doc.roster[String(room)] ?? []) {
    if (!ctx.actor(npc.actorId)?.visible || !ctx.requested(npc.actorId)) continue;
    return { kind: "roster", npc };
  }
  return null;
}

/**
 * The room's exits (`returnTo...`, `enter...`), checked before and after the step: the room and
 * where `transition` leaves the hero, or the one-time hint of a gate that is still shut.
 */
export function cauVongOpeningExit(
  room: number,
  player: { x: number; y: number },
  done: OpeningContext["done"],
): OpeningAction {
  const at = (x: number, y: number, width: number, height: number) =>
    playerIntersectsSourceRect(player.x, player.y, { x, y, width, height });
  const exit = (to: number, x: number, y: number): OpeningAction => ({
    kind: "exit",
    room: to,
    x,
    y,
  });
  switch (room) {
    case HOME_ROOM:
      return at(390, 400, 58, 50) ? exit(0, 180, 280) : null;
    case CITY_ROOM:
      if (at(36, 0, 76, 52)) return exit(0, 204, 560);
      if (at(506, 105, 44, 72)) return exit(2, 72, 350);
      if (at(224, 594, 72, 44)) return exit(FOREST_ROOM, 80, 80);
      return null;
    case FOREST_ROOM:
      if (at(34, 0, 72, 50)) return exit(CITY_ROOM, 260, 560);
      if (at(574, 78, 60, 72)) {
        if (delivered(done)) return exit(RUINS_ROOM, 340, 94);
        if (!done(FOREST_ROOM, FOREST_GATE_HINT))
          return { kind: "say", text: FOREST_GATE_TEXT, mark: [FOREST_ROOM, FOREST_GATE_HINT] };
      }
      return null;
    case RUINS_ROOM:
      if (at(300, 0, 90, 64)) return exit(FOREST_ROOM, 560, 160);
      if (at(16, 590, 76, 48)) {
        if ([0, 1, 2].every((i) => done(RUINS_ROOM, RUINS_SWITCH_FIRST + i)))
          return exit(RUINS_INNER_ROOM, 160, 88);
        if (!done(RUINS_ROOM, RUINS_SWITCH_HINT))
          return { kind: "say", text: RUINS_GATE_TEXT, mark: [RUINS_ROOM, RUINS_SWITCH_HINT] };
      }
      return null;
    case RUINS_INNER_ROOM:
      return at(120, 0, 82, 54) ? exit(RUINS_ROOM, 60, 548) : null;
    default:
      return null;
  }
}

/** What a finished sequence leaves to do (`tickDialogue`'s `action`, `after(part)`, `nextChoice`). */
export type OpeningAfter =
  | { kind: "menu"; menu: OpeningMenu }
  | { kind: "reconcile" }
  | { kind: "deliver" }
  | { kind: "clearGuard"; room: number; started: number; cue: number }
  | { kind: "cast" }
  | { kind: "egg" }
  | null;
export function cauVongOpeningAfter(doc: CauVongOpeningDocument, name: string): OpeningAfter {
  switch (name) {
    case "LUNCH_GIFT":
      return { kind: "reconcile" };
    case "LUNCH_DELIVERY":
      return { kind: "deliver" };
    case "LUCY_OFFER":
      return { kind: "menu", menu: "lucy" };
    case "MERCHANT":
    case "MERCHANT_REPLY":
    case "MERCHANT_REPEAT":
      return { kind: "menu", menu: "merchant" };
    case "BOY_REQUEST":
    case "BOY_ASK":
      return { kind: "menu", menu: "boyAccept" };
    case "BOY_OFFER":
      return { kind: "menu", menu: "boyPet" };
    case "CITY_SOUTH":
    case "CITY_SOUTH_ANNOUNCED":
    case "ACADEMY_EARLY": {
      const p = doc.parts[name];
      return { kind: "clearGuard", room: p.room, started: p.started, cue: p.cue };
    }
    case "INNER_EGG":
      return { kind: "egg" };
    case "FAMILY":
    case "ANNOUNCEMENT":
    case "SWITCH_103":
    case "SWITCH_104":
    case "SWITCH_105":
    case "INNER_SWITCH":
    case "INNER_GIFT":
    case "INNER_HELP":
    case "INNER_OPEN":
      return { kind: "cast" };
    default:
      return null;
  }
}

/** One actor's look as the room's owners leave it (`applyNpcVisuals` and the casts after it). */
export type OpeningCast = {
  visible: [number, boolean][];
  /** `setState(s)` (the levers, a closed gate). */
  state: [number, number][];
  /** Gates held on the last frame of their open state. */
  held: [number, number][];
  /** `castOnly` ranges to restore, in order. */
  cues: CauVongCue[];
};

/**
 * `CauVongOpeningStory.applyHouseholdCast`, `CauVongSwitchMechanisms.apply`,
 * `CauVongOpeningSourceRuntime.applyCast` and the egg of `applyNpcVisuals`, for this room.
 */
export function cauVongOpeningCast(
  doc: CauVongOpeningDocument,
  cues: CauVongCuesDocument,
  room: number,
  done: OpeningContext["done"],
): OpeningCast {
  const cast: OpeningCast = { visible: [], state: [], held: [], cues: [] };
  if (room === CITY_ROOM && done(CITY_ROOM, STORY_COMPLETE))
    cast.cues.push(...(doc.cast["1:1"] ?? []));
  if (room === HOME_ROOM) {
    cast.visible.push([
      FAMILY_FRIEND,
      done(HOME_ROOM, FAMILY_STARTED) && !done(HOME_ROOM, FAMILY_DONE),
    ]);
    cast.visible.push([GRANDFATHER, !done(HOME_ROOM, FAMILY_DONE)]);
  }
  for (const gate of doc.gates) {
    if (gate.room !== room) continue;
    const open = done(room, gate.event);
    // Source mode 2: the door stays drawn, on its retracted frame once open.
    cast.visible.push([gate.door, true]);
    if (open) cast.held.push([gate.door, gate.openState]);
    else cast.state.push([gate.door, 0]);
    for (const flank of gate.flanks) cast.visible.push([flank, false]);
  }
  if (room === RUINS_ROOM)
    for (let i = 0; i < 3; i++)
      cast.state.push([LEVER_FIRST + i, done(RUINS_ROOM, RUINS_SWITCH_FIRST + i) ? 1 : 0]);
  if (room === RUINS_INNER_ROOM) {
    cast.state.push([doc.innerLever.actorId, 0]);
    cast.visible.push([INNER_EGG_ACTOR, !done(RUINS_INNER_ROOM, RUINS_EGG)]);
    const finished = (name: CauVongPartName) => done(RUINS_INNER_ROOM, cues.parts[name].flag);
    if (finished("INNER_HELP") || done(RUINS_INNER_ROOM, INNER_SWITCH))
      cast.visible.push([doc.innerHelper, !finished("INNER_GIFT")]);
    if (finished("INNER_OPEN")) cast.cues.push(...(cues.cast["6:3"] ?? []));
  }
  return cast;
}

/**
 * This room's actor snapshots with the cue actors it talks to, and each opened gate's own
 * (`closedMask` gone once it is open).
 */
export function cauVongOpeningMechanics(
  doc: CauVongOpeningDocument | undefined,
  room: number,
  base: Readonly<Record<string, CauVongMechanic>>,
  done: OpeningContext["done"],
): Readonly<Record<string, CauVongMechanic>> {
  const open = doc?.gates.filter((gate) => gate.room === room && done(room, gate.event)) ?? [],
    extra = doc?.extraMechanics[String(room)];
  if (open.length === 0 && !extra) return base;
  const result: Record<string, CauVongMechanic> = { ...base, ...extra };
  for (const gate of open) result[String(gate.door)] = gate.open;
  return result;
}

/** A menu as a script: the box, then one hook per answer (`<prefix>answer:<menu>:<i>`). */
export function openingMenuScript(
  prefix: string,
  menu: string,
  options: string[],
): RuntimeStoryEvent[] {
  const end = 1 + options.length * 2;
  const events: RuntimeStoryEvent[] = [
    { type: "choice", options, next: options.map((_, i) => 1 + i * 2) },
  ];
  options.forEach((_, i) =>
    events.push(
      { type: "worldHook", hook: `${prefix}answer:${menu}:${i}` },
      { type: "jump", next: end },
    ),
  );
  return events;
}
