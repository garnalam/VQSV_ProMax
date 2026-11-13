import type { StoryActor } from "../story/StoryActor";
import { TAN_NGUYET_BOSS, TAN_NGUYET_LONG_MA } from "../battle/engine/TanNguyetLongMa";

/**
 * The world side of Tàn Nguyệt Long Ma (`TanNguyetLongMaBossRuntime`,
 * `TanNguyetLongMaWorldDecorationRenderer`, `TanNguyetLongMaVictoryRewardRuntime`,
 * `TanNguyetLongMaDefeatCutscene` and `VqsvBattleScripts.VictoryRewardNotice`): the boss stands in
 * Cứ điểm Thánh Điện (5:3) in place of the statue, a press of 5 within 34 px challenges it, and the
 * fight's end shows either the reward notice or the defeat card.
 */

/** `Scene.tanNguyetLongMaBoss = new Actor(-3, 3004, …)`: the world's own boss actor. */
export const TAN_NGUYET_ACTOR_ID = -3;

/** The one statue sprite the giant gate (sprite 270 near (335, 160)) also marks the room by. */
const GIANT_GATE_SPRITE = 270;
const GIANT_GATE = { x: 335, y: 160 };
const ANCHOR_TOLERANCE = 8;

/** `TanNguyetLongMaDefeatCutscene.MINIMUM_TICKS`: the card ignores input before this. */
export const TAN_NGUYET_DEFEAT_MIN_TICKS = 8;

/** `TanNguyetLongMaWorldDecorationRenderer.renderNameplate`: 158 px above the boss's foot. */
export const TAN_NGUYET_NAMEPLATE_LIFT = 158;

/** The texts the boss's notices show (`TextBox.msgWarm`, prompt "Nhấn nút 5 để tiếp tục"). */
export const TAN_NGUYET_WORLD_TEXT = {
  prompt: "Nhấn nút 5 để tiếp tục",
  alreadyDefeated: "Bạn đã đánh bại Tàn Nguyệt Long Ma rồi. Không thể khiêu chiến lần hai.",
  victory:
    "Chúc mừng bạn đã đánh thắng Tàn Nguyệt Long Ma! Phần thưởng: 100 Huy hiệu, 50000 kim tiền. Nhận được LH-002 Nhiên Liệp Sư 5 sao cấp 5 (đã thêm vào ngân hàng).",
} as const;

/**
 * `findStatueAnchor`: in 5:3 (or any room the giant gate marks) the statue — sprite 289 facing 8
 * within 8 px of (337, 368) — that the boss replaces; null when the room has none.
 */
export function tanNguyetStatueAnchor(
  sceneId: number,
  roomIndex: number,
  actors: Iterable<StoryActor>,
): StoryActor | null {
  const list = [...actors];
  const giantGate = list.some(
    (actor) =>
      actor.sprite === GIANT_GATE_SPRITE &&
      Math.abs(actor.x - GIANT_GATE.x) <= ANCHOR_TOLERANCE &&
      Math.abs(actor.y - GIANT_GATE.y) <= ANCHOR_TOLERANCE,
  );
  if (
    !giantGate &&
    (sceneId !== TAN_NGUYET_BOSS.sceneId || roomIndex !== TAN_NGUYET_BOSS.roomIndex)
  )
    return null;
  return (
    list.find(
      (actor) =>
        actor.id >= 0 &&
        actor.sprite === TAN_NGUYET_BOSS.statueSprite &&
        actor.direction === TAN_NGUYET_BOSS.statueDirection &&
        Math.abs(actor.x - TAN_NGUYET_BOSS.x) <= ANCHOR_TOLERANCE &&
        Math.abs(actor.y - TAN_NGUYET_BOSS.y) <= ANCHOR_TOLERANCE,
    ) ?? null
  );
}

/** `isBossRoom`: 5:3, or a room whose statue anchor resolves. */
export function isTanNguyetBossRoom(
  sceneId: number,
  roomIndex: number,
  actors: Iterable<StoryActor>,
): boolean {
  return (
    (sceneId === TAN_NGUYET_BOSS.sceneId && roomIndex === TAN_NGUYET_BOSS.roomIndex) ||
    tanNguyetStatueAnchor(sceneId, roomIndex, actors) !== null
  );
}

/** `positionBoss`: on the statue when there is one, else at (337, 368). */
export function tanNguyetBossPosition(anchor: StoryActor | null): { x: number; y: number } {
  return anchor ? { x: anchor.x, y: anchor.y } : { x: TAN_NGUYET_BOSS.x, y: TAN_NGUYET_BOSS.y };
}

/** The boss's actor as `Scene` builds it: sprite 3004, idle state 0, facing 0, layer 1. */
export function tanNguyetBossActor(): StoryActor {
  return {
    id: TAN_NGUYET_ACTOR_ID,
    sprite: TAN_NGUYET_LONG_MA.spriteId,
    x: TAN_NGUYET_BOSS.x,
    y: TAN_NGUYET_BOSS.y,
    state: 0,
    direction: 0,
    variant: 0,
    renderOffsetX: 0,
    renderOffsetY: 0,
    visible: false,
    layer: 1,
    animationTick: 0,
  };
}

/** The press of 5 reaches the boss: within `INTERACTION_DISTANCE` (34 px) of its foot. */
export function withinTanNguyetReach(
  player: { x: number; y: number },
  boss: { x: number; y: number },
): boolean {
  const dx = player.x - boss.x,
    dy = player.y - boss.y;
  return dx * dx + dy * dy <= TAN_NGUYET_BOSS.interactionDistance ** 2;
}

/** The modal the boss puts over the world: a `msgWarm` notice, or the full-screen defeat card. */
export type TanNguyetModal =
  | { kind: "notice"; text: string; markSeen: boolean; dismissRequested: boolean }
  | { kind: "defeat"; ticks: number; dismissRequested: boolean };
