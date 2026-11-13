// JavaSE parity: Lạc Khắc's optional rival chain (`CauVongLockeChainRuntime`), which
// `CauVongChapterRuntime.tick` hands rooms 52 (the south gate), 39 (his rescue) and 32 (the last
// duel) before any other owner. Each room has a cutscene before the fight, the fight, and one after
// it; 39's POST flag (1302) is what opens Linh's return in the hall. The parts are baked by
// rebuild_game/tools/WebCauVongCues.java (`cau-vong-world/locke.json`) and play like the opening's
// (CauVongCutscene.ts); this file is the runtime's decisions.
import type { AcademyBattle } from "./CauVongAcademy";
import type { CauVongPart } from "./CauVongCutscene";
import { type SourceRect, playerIntersectsSourceRect } from "./WorldInteractionEngine";

/** `PRE`, `WON`, `POST`, `INTRO`, and DECLINE's flag. */
export const LOCKE_PRE = 1300;
export const LOCKE_WON = 1301;
export const LOCKE_POST = 1302;
export const LOCKE_INTRO = 1303;
export const LOCKE_DECLINED = 1304;
export const LOCKE_ROOMS = [52, 39, 32] as const;

/** `Part`, in declaration order (the resume loop walks it so). */
const PART_ORDER = [
  "SOUTH_PRE",
  "SOUTH_POST",
  "RESCUE_PRE",
  "RESCUE_POST",
  "LAST_INTRO",
  "LAST_PRE",
  "LAST_POST",
  "DECLINE",
] as const;
export type LockePartName = (typeof PART_ORDER)[number];

/** `request(room, rematch)`: a Cầu Vồng boss.d roster, already at its boosted levels. */
/** `request(room, rematch)`, with what `enterBattle` makes of the roster (`AcademyBattle`). */
export type LockeBattle = AcademyBattle;
export type CauVongLockeDocument = {
  parts: Record<LockePartName, CauVongPart>;
  /** "52", "39", "32" for the first fights, "52r" and "32r" for the rematches. */
  battles: Record<string, LockeBattle>;
  /** `actorId(s, room, source)` keyed "room:source": the rival (52:23, 39:28, 32:20) and 39:27. */
  actors: Record<string, number>;
  /** `[room, flag]` the chain reads from other chapters. */
  gates: Record<
    "southEast" | "northSeaCompanion" | "labComplete" | "labFarewell" | "linhRequest",
    [number, number]
  >;
};

export const LOCKE_CHOICE = ["Khiêu chiến", "Hay là tính"];
export const LOCKE_SPEAKER = "Lạc Khắc";
export const LOCKE_LATER = "Để lần sau nhé. Tôi sẽ chờ cậu ở đây.";
export const LOCKE_LOST =
  "Trận này chưa thắng. Hãy hồi phục đội pet rồi quay lại thử. Các chặng đã hoàn thành vẫn được giữ.";
export const LOCKE_REMATCH_WON = "Bạn thắng trận tái đấu với Lạc Khắc!";
export const LOCKE_REMATCH_LOST = "Hãy hồi phục đội pet rồi thử lại.";

/** The strip at 39's south edge that starts the rescue (`playerIntersectsSourceRect(120,520,100,40)`). */
const RESCUE_RECT: SourceRect = { x: 120, y: 520, width: 100, height: 40 };

export type LockeContext = {
  /** `CauVongChapterRuntime.eventDone(s, room, event)` in scene 98. */
  done: (room: number, event: number) => boolean;
  /** `CauVongNpcGeometry.requested`. */
  requested: (actorId: number) => boolean;
  player: { x: number; y: number };
};

/** What the chain does this tick. */
export type LockeAction =
  | { kind: "part"; name: LockePartName; part: CauVongPart }
  | { kind: "battle"; battle: string; rematch: boolean }
  | { kind: "choose" }
  | null;

const sourceActor = (room: number) => (room === 52 ? 23 : room === 39 ? 28 : 20);
const post = (room: number): LockePartName =>
  room === 52 ? "SOUTH_POST" : room === 39 ? "RESCUE_POST" : "LAST_POST";
/** `startBattle` after a PRE part: the room's first fight. */
export const firstBattle = (room: number) => String(room);

/** `southReady`: the east gate's rival is behind the hero, or the chain already began here. */
export function southReady(doc: CauVongLockeDocument, done: LockeContext["done"]): boolean {
  const [room, flag] = doc.gates.southEast;
  return (
    done(room, flag) ||
    [LOCKE_PRE + 100, LOCKE_PRE, LOCKE_WON, LOCKE_POST + 100, LOCKE_POST].some((f) => done(52, f))
  );
}
/** `rescueReady`: Linh asked her favour (47:2), or a rescue checkpoint is already kept. */
export function rescueReady(doc: CauVongLockeDocument, done: LockeContext["done"]): boolean {
  const [room, flag] = doc.gates.linhRequest;
  return (
    done(room, flag) ||
    [LOCKE_PRE + 100, LOCKE_PRE, LOCKE_WON, LOCKE_POST + 100, LOCKE_POST].some((f) => done(39, f))
  );
}
/** `finalReady`: the North Sea companion is behind the hero, or the duel already began. */
export function finalReady(doc: CauVongLockeDocument, done: LockeContext["done"]): boolean {
  const [room, flag] = doc.gates.northSeaCompanion;
  return (
    done(room, flag) ||
    [
      LOCKE_INTRO + 100,
      LOCKE_INTRO,
      LOCKE_PRE + 100,
      LOCKE_PRE,
      LOCKE_WON,
      LOCKE_POST + 100,
      LOCKE_POST,
      LOCKE_DECLINED + 100,
      LOCKE_DECLINED,
    ].some((f) => done(32, f))
  );
}
/** The rescue waits for the laboratory (62 COMPLETE, 60 FAREWELL) and Linh's request. */
function rescueOpen(doc: CauVongLockeDocument, done: LockeContext["done"]): boolean {
  const [labRoom, labFlag] = doc.gates.labComplete,
    [farewellRoom, farewellFlag] = doc.gates.labFarewell;
  return (
    done(labRoom, labFlag) &&
    done(farewellRoom, farewellFlag) &&
    rescueReady(doc, done) &&
    !done(39, LOCKE_POST)
  );
}

/**
 * `tick` up to the point a sequence, fight or choice starts: a started part resumes, a won fight
 * plays its POST part, then the room's rival (or 39's rescue strip). `requested` includes the key.
 */
export function cauVongLockeAction(
  doc: CauVongLockeDocument,
  room: number,
  context: LockeContext,
): LockeAction {
  const { done, requested, player } = context;
  const start = (name: LockePartName): LockeAction => ({
    kind: "part",
    name,
    part: doc.parts[name],
  });
  for (const name of PART_ORDER) {
    const p = doc.parts[name];
    if (p.room === room && done(room, p.started) && !done(room, p.flag)) return start(name);
  }
  if (done(room, LOCKE_WON) && !done(room, LOCKE_POST)) return start(post(room));
  // /event 52:2 @0 waits for 12:6's result scene; /event 32:0 @0 for 48:12's.
  if (room === 52 && !southReady(doc, done)) return null;
  if (room === 32 && !finalReady(doc, done)) return null;
  const rival = doc.actors[`${room}:${sourceActor(room)}`];
  if (room === 39) {
    if (
      rescueOpen(doc, done) &&
      (playerIntersectsSourceRect(player.x, player.y, RESCUE_RECT) ||
        (done(39, LOCKE_PRE) && requested(rival)))
    )
      return done(39, LOCKE_PRE)
        ? { kind: "battle", battle: "39", rematch: false }
        : start("RESCUE_PRE");
    return null;
  }
  if (!requested(rival)) return null;
  // /event 32:1 repeats on the rival after the first result.
  if (done(room, LOCKE_POST)) return { kind: "battle", battle: `${room}r`, rematch: true };
  if (room === 52) return start("SOUTH_PRE");
  if (!done(32, LOCKE_INTRO)) return start("LAST_INTRO");
  return { kind: "choose" };
}

/** What follows a finished part (after its flag is written). */
export function afterLockePart(name: LockePartName): "battle" | "choose" | "cast" | null {
  if (name === "SOUTH_PRE" || name === "RESCUE_PRE" || name === "LAST_PRE") return "battle";
  if (name === "LAST_INTRO") return "choose";
  if (name === "RESCUE_POST") return "cast";
  return null;
}

/** The answer to `choose`: `selected` 0 challenges, 1 declines; null when Back closed it. */
export function lockeChoice(
  doc: CauVongLockeDocument,
  done: LockeContext["done"],
  selected: number,
): LockeAction | { kind: "say"; text: string } {
  if (selected === 0)
    return done(32, LOCKE_PRE)
      ? { kind: "battle", battle: "32", rematch: false }
      : { kind: "part", name: "LAST_PRE", part: doc.parts.LAST_PRE };
  if (!done(32, LOCKE_DECLINED)) return { kind: "part", name: "DECLINE", part: doc.parts.DECLINE };
  return { kind: "say", text: LOCKE_LATER };
}

/**
 * `handleBattleResult`: the final's rematch ends quietly, the south rematch says how it went; a first
 * win writes WON and plays POST, a loss keeps every finished stage and says so.
 */
export function lockeBattleResult(
  room: number,
  rematch: boolean,
  won: boolean,
): { kind: "none" } | { kind: "say"; text: string } | { kind: "post"; name: LockePartName } {
  if (rematch && room === 32) return { kind: "none" };
  if (rematch) return { kind: "say", text: won ? LOCKE_REMATCH_WON : LOCKE_REMATCH_LOST };
  if (won) return { kind: "post", name: post(room) };
  return { kind: "say", text: LOCKE_LOST };
}

/** `applyCast`: which of the room's chain actors stand there. */
export function lockeCast(
  doc: CauVongLockeDocument,
  room: number,
  done: LockeContext["done"],
): { id: number; visible: boolean }[] {
  if (room === 39) {
    const visible = rescueOpen(doc, done);
    return [
      { id: doc.actors["39:28"], visible },
      { id: doc.actors["39:27"], visible },
    ];
  }
  if (room === 52) return [{ id: doc.actors["52:23"], visible: southReady(doc, done) }];
  if (room === 32) return [{ id: doc.actors["32:20"], visible: finalReady(doc, done) }];
  return [];
}
