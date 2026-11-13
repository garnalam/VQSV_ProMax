// JavaSE parity: CauVongChapterRuntime.tickSquare — Quảng Trường Cầu Vồng (98:0), the room the
// tribe portal (8:1) opens onto. The owner replaces the room's /4 door table: its exits are its own
// rectangles. Each conversation is a short script played on the event engine, so the dialog box,
// paging and key handling are the ones every other text uses.
//
// The intro lines and the six residents come from the bake (`cau-vong-world/square.json`,
// `INTRO_LINES` and `SQUARE_NPCS` resolved through CauVongNpcTextCatalog); the guide, portal, sign
// and steward lines are literals of tickSquare itself.
import type { RuntimeStoryEvent } from "../story/SourceOpcodeInterpreter";
import { type SourceRect, playerIntersectsSourceRect } from "./WorldInteractionEngine";

export const CAU_VONG_SCENE = 98;
/** `CauVongChapterRuntime.ROOM_INDEX`. */
export const CAU_VONG_SQUARE_ROOM = 0;

export type CauVongSquareDocument = {
  intro: string[];
  npcs: { actorId: number; name: string; line: string }[];
};

/** `ADAPTED_INTRO_EVENT`; the intro's line checkpoints are 200, 201, 202 (`arrivalSequence`). */
export const SQUARE_INTRO_EVENT = 100;
const INTRO_CHECKPOINT = 200;
/** `STEWARD_ADVICE_EVENT`, in this room. */
export const SQUARE_STEWARD_ADVICE_EVENT = 101;
/** `GUIDE_ACTOR`, `RETURN_ACTOR` and the steward (Lạc Khắc / Jess, `SQUARE_NPCS[0]`). */
export const SQUARE_GUIDE_ACTOR = 1;
const STEWARD_ACTOR = 24;
/** `RUINS_INNER_ROOM_INDEX` and its `RUINS_EGG_EVENT`. */
const RUINS_INNER_ROOM = 6;
const RUINS_EGG_EVENT = 100;

const PORTAL_RECT: SourceRect = { x: 76, y: 516, width: 48, height: 48 };
const SIGN_RECT: SourceRect = { x: 256, y: 516, width: 48, height: 48 };

/** `enterHome`, `enterHatchery`, `enterCity`: the rectangle and where `transition` puts the hero. */
export const SQUARE_EXITS: readonly { rect: SourceRect; room: number; x: number; y: number }[] = [
  { rect: { x: 170, y: 230, width: 36, height: 40 }, room: 54, x: 410, y: 370 },
  { rect: { x: 190, y: 410, width: 36, height: 40 }, room: 55, x: 115, y: 410 },
  { rect: { x: 176, y: 598, width: 68, height: 40 }, room: 1, x: 80, y: 76 },
];
/** `enterTournament`: Đại sảnh Cúp Cầu Vồng (98:47). */
const TOURNAMENT = { room: 47, x: 200, y: 320 };
/** `returnToTribe`: 8:1 at `RETURN_X`, `RETURN_Y`. */
const TRIBE = { scene: 8, room: 1, x: 200, y: 245 };

const TEXT = {
  guide: "Lính dẫn đường",
  guideLine:
    "Muốn xem Cúp Cầu Vồng à? Tôi sẽ dẫn bạn vào đại sảnh. Đội pet của bạn vẫn ở bên bạn, đừng lo.",
  portal: "Cổng truyền tống",
  portalLine:
    "Trở về Bộ lạc thất bại phẩm? Hãy đi qua cổng để quay lại Thành Cầu Vồng bất cứ lúc nào.",
  sign: "Biển chỉ dẫn",
  signLine: "Trang viên nhà Sai Kỳ ở phía bắc; phố Thành Cầu Vồng ở phía nam.",
  stewardAdvised:
    "Khi một quả trứng pet tích lũy đủ kinh nghiệm và vật liệu, trại ấp sẽ giúp nó nở. Giờ hãy đến Học viện.",
  stewardEgg:
    "Bạn thấy trứng pet ở di tích à? Nó cần kinh nghiệm từ các trận đấu và vật liệu để ấp. Hãy hỏi Học viện về nguồn gốc của nó.",
} as const;

/**
 * `TextBox.dialog(font, speaker, text, mode)`. The arrival lines are `CauVongCutsceneSequence.dialogue`
 * (mode 0: an empty speaker tab); every other square line is `TextBox.dialog(..., -1, -1)`, a box
 * with no tab at all.
 */
const dialog = (speaker: string, text: string, mode = -1): RuntimeStoryEvent => ({
  type: "text",
  text,
  speaker,
  mode,
  wait: true,
  kind: "dialog",
});
const mark = (room: number, event: number): RuntimeStoryEvent => ({
  type: "markComplete",
  ref: { scene: CAU_VONG_SCENE, room, group: event },
});
const load = (scene: number, room: number, x: number, y: number): RuntimeStoryEvent => ({
  type: "load",
  scene,
  room,
  x,
  y,
  updateWorld: true,
  // `transition` / `returnToTribe`: `player.direction = 0`.
  direction: 0,
});

/** What the square needs from the world this tick. */
export type CauVongSquareContext = {
  /** `eventDone(s, room, event)` in scene 98. */
  done: (room: number, event: number) => boolean;
  /** `CauVongNpcGeometry.requested` for a standing NPC this tick. */
  requested: (actorId: number) => boolean;
  /** The key (5 / Enter) this tick. */
  confirm: boolean;
  player: { x: number; y: number };
};

export type CauVongSquareScript = { id: string; events: RuntimeStoryEvent[] };

/**
 * `tickSquare` up to the free movement: the script the room starts this tick, or null when the hero
 * walks on. `openingStory.tick` (the incubation lesson, after the inner ruins egg) sits between the
 * portal and the residents: the world asks `CauVongPrep.cauVongPrepSquare` there (CV2).
 */
export function cauVongSquareScript(
  document: CauVongSquareDocument,
  context: CauVongSquareContext,
): CauVongSquareScript | null {
  const { done, requested, confirm, player } = context;
  // `arrivalSequence(ROOM_INDEX, INTRO_LINES)`: one checkpoint per line, resumed after a reload,
  // then the legacy completion 100.
  if (!done(CAU_VONG_SQUARE_ROOM, SQUARE_INTRO_EVENT)) {
    const events: RuntimeStoryEvent[] = [];
    document.intro.forEach((line, i) => {
      if (done(CAU_VONG_SQUARE_ROOM, INTRO_CHECKPOINT + i)) return;
      events.push(dialog("", line, 0), mark(CAU_VONG_SQUARE_ROOM, INTRO_CHECKPOINT + i));
    });
    events.push(mark(CAU_VONG_SQUARE_ROOM, SQUARE_INTRO_EVENT));
    return { id: "cau-vong:square:intro", events };
  }
  if (requested(SQUARE_GUIDE_ACTOR))
    return {
      id: "cau-vong:square:guide",
      events: [
        dialog(TEXT.guide, TEXT.guideLine),
        load(CAU_VONG_SCENE, TOURNAMENT.room, TOURNAMENT.x, TOURNAMENT.y),
      ],
    };
  // `actorActivationRequested(RETURN_ACTOR) || consumeConfirm()`: the portal arrow is no talkable
  // actor, so on the keyboard this is the key inside the portal's square.
  if (confirm && playerIntersectsSourceRect(player.x, player.y, PORTAL_RECT))
    return {
      id: "cau-vong:square:portal",
      events: [
        dialog(TEXT.portal, TEXT.portalLine),
        load(TRIBE.scene, TRIBE.room, TRIBE.x, TRIBE.y),
      ],
    };
  for (const npc of document.npcs) {
    if (!requested(npc.actorId)) continue;
    let line = npc.line;
    const events: RuntimeStoryEvent[] = [];
    if (npc.actorId === STEWARD_ACTOR && done(RUINS_INNER_ROOM, RUINS_EGG_EVENT)) {
      const advised = done(CAU_VONG_SQUARE_ROOM, SQUARE_STEWARD_ADVICE_EVENT);
      line = advised ? TEXT.stewardAdvised : TEXT.stewardEgg;
      events.push(dialog(npc.name, line));
      if (!advised) events.push(mark(CAU_VONG_SQUARE_ROOM, SQUARE_STEWARD_ADVICE_EVENT));
    } else events.push(dialog(npc.name, line));
    return { id: `cau-vong:square:npc:${npc.actorId}`, events };
  }
  if (confirm && playerIntersectsSourceRect(player.x, player.y, SIGN_RECT))
    return { id: "cau-vong:square:sign", events: [dialog(TEXT.sign, TEXT.signLine)] };
  return null;
}

/** The exit rectangle the hero stands in (`enterHome` / `enterHatchery` / `enterCity`), or null. */
export function cauVongSquareExit(x: number, y: number): (typeof SQUARE_EXITS)[number] | null {
  return SQUARE_EXITS.find((exit) => playerIntersectsSourceRect(x, y, exit.rect)) ?? null;
}
