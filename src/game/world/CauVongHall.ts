// JavaSE parity: Đại sảnh Cúp Cầu Vồng (98:47). `CauVongChapterRuntime.tick` gives the room to
// `CauVongOpeningSourceRuntime.tick` first (the final of the Rainbow Cup, played from the JAR's 47:0
// and 47:1, and later Linh's requests), then to `tickTournament` (the spectators and the south exit).
// The cutscenes are baked parts (`cau-vong-world/cues.json`, see CauVongCutscene.ts); the choice
// after the introduction is `menu`'s `ChoiceBox.optionUi`.
import type { RuntimeStoryEvent } from "../story/SourceOpcodeInterpreter";
import type { CauVongCuesDocument, CauVongPart } from "./CauVongCutscene";
import { type SourceRect, playerIntersectsSourceRect } from "./WorldInteractionEngine";

/** `TOURNAMENT_ROOM_INDEX`. */
export const CAU_VONG_HALL_ROOM = 47;
/** `TOURNAMENT_EVENT`: the final is over. */
export const HALL_FINAL_EVENT = 100;
/** `menu`'s answer is kept before any cue opens (7200), and 7201 when it asked for the lesson. */
const MENU_ANSWERED = 7200;
const MENU_TERRAIN = 7201;
/** `CauVongLockeChainRuntime.POST` in room 39: Lạc Khắc is back from the dark forest. */
const LOCKE_ROOM = 39;
const LOCKE_POST = 1302;

/** `returnToSquare`: the strip at the hall's south door, and where it leaves the hero (98:0). */
const EXIT_RECT: SourceRect = { x: 165, y: 365, width: 70, height: 28 };
export const HALL_EXIT = { room: 0, x: 204, y: 554 };
/** `after(FINAL_MATCH)`: `transition(s, 54, 150, 239)`, Sai Kỳ's home. */
const AFTER_FINAL = { room: 54, x: 150, y: 239 };
/** The pair that leaves the stage with Sai Kỳ (`s.actors[90]`, `[91]`) and the champion (92). */
const FINAL_CAST = [92, 90, 91];

export const MENU_OPTIONS = ["Địa hình và sủng vật", "Tiếp tục xem giải đấu"];

export type CauVongHallDocument = {
  npcs: { actorId: number; name: string; line: string }[];
  /** `CauVongAcademySourceScenes.actorId(s, 47, 19)`. */
  linh: number;
};

/** `CauVongOpeningSourceRuntime.Part`, in declaration order (the resume loop walks it so). */
export const CAU_VONG_PART_ORDER = [
  "FINAL_INTRO",
  "TERRAIN_HELP",
  "FINAL_MATCH",
  "LINH_REQUEST",
  "LINH_RETURN",
  "MANOR_ARRIVAL",
  "INNER_INTRO",
  "INNER_EGG",
  "INNER_HELP",
  "INNER_GIFT",
  "EGG_EXIT_HINT",
  "INCUBATOR_RETURN",
  "LINH_REPEAT",
  "INNER_OPEN",
] as const;
export type CauVongPartName = (typeof CAU_VONG_PART_ORDER)[number];

export type CauVongHallContext = {
  /** `eventDone(s, room, event)` in scene 98. */
  done: (room: number, event: number) => boolean;
  /** `CauVongNpcGeometry.requested`. */
  requested: (actorId: number) => boolean;
  player: { x: number; y: number };
};

/** What the hall does this tick. */
export type CauVongHallAction =
  | { kind: "part"; name: CauVongPartName; part: CauVongPart; clear?: boolean }
  | { kind: "menu"; events: RuntimeStoryEvent[] }
  | { kind: "talk"; events: RuntimeStoryEvent[] }
  | { kind: "exit" }
  | null;

const mark = (event: number): RuntimeStoryEvent => ({
  type: "markComplete",
  ref: { scene: 98, room: CAU_VONG_HALL_ROOM, group: event },
});

/**
 * `menu` and its answer: the choice is written before any cue opens (7200, plus 7201 for the
 * terrain lesson), and the next tick starts the part it picked. The lesson's branch falls through
 * into 7200.
 */
function menuScript(): RuntimeStoryEvent[] {
  return [
    { type: "choice", options: MENU_OPTIONS, next: [1, 2] },
    mark(MENU_TERRAIN),
    mark(MENU_ANSWERED),
  ];
}

/**
 * `CauVongOpeningSourceRuntime.tick` for room 47 and then `tickTournament` up to the free movement.
 * `confirm` is the key this tick; `requested` already includes it.
 */
export function cauVongHallAction(
  cues: CauVongCuesDocument,
  hall: CauVongHallDocument,
  context: CauVongHallContext,
): CauVongHallAction {
  const { done, requested, player } = context;
  const part = (name: CauVongPartName) => cues.parts[name];
  const finished = (name: CauVongPartName) => done(part(name).room, part(name).flag);
  const start = (name: CauVongPartName, clear = false): CauVongHallAction => ({
    kind: "part",
    name,
    part: part(name),
    clear,
  });
  // A part started and not finished resumes first (a reload in the middle of a cutscene).
  for (const name of CAU_VONG_PART_ORDER) {
    const p = part(name);
    if (p.room === CAU_VONG_HALL_ROOM && done(p.room, p.started) && !done(p.room, p.flag))
      return start(name);
  }
  if (!done(CAU_VONG_HALL_ROOM, HALL_FINAL_EVENT)) {
    if (!finished("FINAL_INTRO")) return start("FINAL_INTRO");
    if (!done(CAU_VONG_HALL_ROOM, MENU_ANSWERED)) return { kind: "menu", events: menuScript() };
    if (done(CAU_VONG_HALL_ROOM, MENU_TERRAIN) && !finished("TERRAIN_HELP"))
      return start("TERRAIN_HELP");
    return start("FINAL_MATCH");
  }
  if (requested(hall.linh)) {
    if (!finished("LINH_REQUEST")) return start("LINH_REQUEST");
    if (done(LOCKE_ROOM, LOCKE_POST) && !finished("LINH_RETURN")) return start("LINH_RETURN");
    return start("LINH_REPEAT", true);
  }
  // `tickTournament`: the spectators, then the south door.
  for (const npc of hall.npcs) {
    if (!requested(npc.actorId)) continue;
    return {
      kind: "talk",
      events: [
        { type: "text", text: npc.line, speaker: npc.name, mode: -1, wait: true, kind: "dialog" },
      ],
    };
  }
  if (playerIntersectsSourceRect(player.x, player.y, EXIT_RECT)) return { kind: "exit" };
  return null;
}

/** The south door after the free movement (`tickTournament`'s second check). */
export const cauVongHallExit = (x: number, y: number) =>
  playerIntersectsSourceRect(x, y, EXIT_RECT);

/**
 * `after(part)`, run once the part's last cue and its flag are written: what the closing hook does
 * to the cast and the hero, and the events that follow it in the same script.
 */
export function afterPart(name: CauVongPartName): {
  hide: number[];
  heroVisible: boolean;
  events: RuntimeStoryEvent[];
} {
  if (name === "FINAL_INTRO") return { hide: [], heroVisible: false, events: menuScript() };
  if (name === "FINAL_MATCH")
    return {
      hide: FINAL_CAST,
      heroVisible: true,
      events: [
        mark(HALL_FINAL_EVENT),
        {
          type: "load",
          scene: 98,
          room: AFTER_FINAL.room,
          x: AFTER_FINAL.x,
          y: AFTER_FINAL.y,
          updateWorld: true,
          direction: 0,
        },
      ],
    };
  // TERRAIN_HELP goes on to FINAL_MATCH the next tick (the resume and menu rules above pick it).
  return { hide: [], heroVisible: true, events: [] };
}

/**
 * `applyCast` for room 47 on load: the champion stands until the final is over, and the cast is
 * where the finished introduction and final left it.
 */
export function hallCast(
  cues: CauVongCuesDocument,
  done: (room: number, event: number) => boolean,
): { castRanges: string[]; championVisible: boolean; hide: number[] } {
  const final = done(CAU_VONG_HALL_ROOM, HALL_FINAL_EVENT);
  const castRanges: string[] = [];
  if (done(CAU_VONG_HALL_ROOM, cues.parts.FINAL_INTRO.flag)) castRanges.push("47:0");
  if (final) castRanges.push("47:1");
  return { castRanges, championVisible: !final, hide: final ? FINAL_CAST : [] };
}
