// JavaSE parity: CauVongCutsceneSequence and the steps CauVongAcademySourceScenes builds from a
// reviewed JAR range (with CauVongSourcePresentation's dialogue, expressions and curtains). The steps
// are baked as data by rebuild_game/tools/WebCauVongCues.java (`cau-vong-world/cues.json`); this
// file runs them. A part plays as a short script on the event engine: dialogue is an ordinary text
// event (mode 0, with the source portrait), every other cue is a `worldHook` the world hands back
// here, and each finished cue writes its checkpoint (`firstCheckpoint + cursor`) like Java does, so a
// reload resumes after the last finished cue with the earlier ones restored.
import type { RuntimeStoryEvent } from "../story/SourceOpcodeInterpreter";
import type { StoryActor } from "../story/StoryActor";

/**
 * `CauVongOpeningSourceRuntime.gift`: source item `item` (`CV-ITEM-0-NN`), resolved in the bake to
 * its unified record `key`, the list it lands in (`kind`) and the id it is granted as (`rewardId`:
 * the species egg for a SPECIAL one). `receipt` (98:room) makes it a one-time gift.
 */
export type CauVongGift = {
  k: "gift";
  room: number;
  receipt: number;
  item: number;
  qty: number;
  key: string;
  kind: "BAG" | "SPECIAL";
  rewardId: number;
};
export type CauVongCue =
  | { k: "say"; speaker: string; text: string; portrait: number }
  | { k: "move"; id: number; x: number; y: number; speed: number }
  | { k: "face"; id: number; dir: number }
  | { k: "show"; id: number; on: boolean }
  | { k: "place"; id: number; x: number; y: number }
  | { k: "pose"; id: number; signed: number }
  | {
      k: "lockedMove";
      id: number;
      x: number;
      y: number;
      signed: number;
      ret: number;
      speed: number;
    }
  | { k: "act"; id: number; state: number; ret: number }
  | { k: "camera"; id: number }
  | { k: "cameraAt"; x: number; y: number; speed: number }
  | { k: "cameraToPlayer" }
  /** `CauVongCutsceneSequence.follow(id)`: the camera follows the actor (-1 the hero). */
  | { k: "follow"; id: number }
  | { k: "wait"; ticks: number }
  | { k: "expr"; id: number; state: number; mode: number }
  | { k: "curtain"; mode: number }
  | { k: "shake"; ticks: number }
  | { k: "flash"; ticks: number }
  | { k: "effect"; effect: number; x: number; y: number }
  /** A flag a step writes as it plays or restores (58:1's broken apparatus, `BROKEN` 58:112). */
  | { k: "mark"; room: number; event: number }
  | CauVongGift
  | { k: "gifts"; gifts: CauVongGift[] }
  | CauVongAward
  | CauVongPetCue
  /**
   * A `once(room, receipt, ...)` step that adds each quest item only when none is held (FINAL_AWARD:
   * the North Sea trophy and the ticket), then writes the receipt.
   */
  | { k: "questOnce"; room: number; receipt: number; items: number[] };

/**
 * op26 in a four-gate scene (`CauVongFourGateTransactions.grantPet`): the pet, once per `receipt`
 * (98:room), with `grantRainbowRide`'s mount when `ride` is not -1.
 */
export type CauVongPetCue = {
  k: "pet";
  room: number;
  receipt: number;
  species: number;
  level: number;
  nature: number;
  ride: number;
};

/**
 * op18 in Lạc Khắc's chain (`CauVongAcademyTransactions.gift`, then `TextBox.openBox("Nhận được
 * <name> × <qty>")`): granted once per `receipt` (98:room), into the list `kind` names.
 */
export type CauVongAward = {
  k: "award";
  room: number;
  receipt: number;
  item: number;
  qty: number;
  key: string;
  /** QUEST: a Bốn Cổng quest item (the mushrooms); NONE: a source item with no web record. */
  kind: "BAG" | "MATERIAL" | "SPECIAL" | "EQUIPMENT" | "QUEST" | "NONE";
  rewardId: number;
  charm: boolean;
  text: string;
};

/** One `CauVongOpeningSourceRuntime.Part`: its room, flags and baked steps. */
export type CauVongPart = {
  room: number;
  event: number;
  /** `flag()`: 7000 + ordinal, the part is done (-1: the owner writes its own). */
  flag: number;
  /** `started()`: 7100 + ordinal, written before the first cue so a reload resumes it (-1: none). */
  started: number;
  /** `cue()`: the first checkpoint, one per step (-1: none, a repeatable reply). */
  cue: number;
  steps: CauVongCue[];
};
type CueActor = {
  id: number;
  sprite: number;
  state: number;
  renderOrientation: number;
  renderOffsetX: number;
  renderOffsetY: number;
  x: number;
  y: number;
  visible: boolean;
  layer: number;
  sourceOrder: number;
};
export type CauVongCuesDocument = {
  parts: Record<string, CauVongPart>;
  /** `applyCast`'s `castOnly` restores, by `"room:event"`. */
  cast: Record<string, CauVongCue[]>;
  /** Actors the cues create that a plain room load lacks, by `"98:room"`. */
  actors: Record<string, CueActor[]>;
};

/** `CauVongSourcePresentation`'s screen state: curtain bars, the white flash and the shake. */
export class CauVongPresentation {
  height = 0;
  enabled = false;
  shakeFrames = 0;
  flashFrames = 0;
  tick(): void {
    if (this.shakeFrames > 0) this.shakeFrames--;
    if (this.flashFrames > 0) this.flashFrames--;
  }
  get shakeOffset(): number {
    return this.shakeFrames > 0 ? this.shakeFrames % 2 : 0;
  }
  get curtainHeight(): number {
    return this.enabled ? this.height : 0;
  }
  /** `render`: a white frame every other tick of a flash. */
  get flashing(): boolean {
    return this.flashFrames > 0 && this.flashFrames % 2 === 0;
  }
  reset(): void {
    this.height = 0;
    this.enabled = false;
    this.shakeFrames = 0;
    this.flashFrames = 0;
  }
}

/** `loadRainbowExpression` (face/brow), the web's sprite 13000. */
export const CAU_VONG_EXPRESSION_SPRITE = 13000;
/** `loadRainbowEffect`'s banks battle/s0..s5, the web's sprites 13100 + bank. */
const EFFECT_SPRITE = 13100;
export const CAU_VONG_CHAMPION_SPRITE = 12000;

/** What the cues act on: the scene's actors and camera, and the world's presentation. */
export interface CauVongStage {
  /** An actor of the playing scene, -1 the hero; throws like `CauVongCutsceneSequence.actor`. */
  actor(id: number): StoryActor;
  animationTicks(sprite: number, state: number): number;
  presentation: CauVongPresentation;
  /** `stopCameraFollow`. */
  stopFollow(): void;
  /** `followActor(id)`; in scene 98, -1 follows the hero. */
  follow(id: number): void;
  /** `moveCameraToward(x, y, speed)` then `cameraCenteredOn(x, y)`. */
  panCamera(x: number, y: number, speed: number): boolean;
  /** `setCameraCenter`. */
  centerCamera(x: number, y: number): void;
  /** `Actor.setRainbowExpression(state, mode)`. */
  expression(id: number, state: number, mode: number): void;
  addEffect(effect: CauVongEffect): void;
  removeEffect(effect: CauVongEffect): void;
  gift(gift: CauVongGift): void;
  /** `CauVongAcademyTransactions.gift`: once per receipt. */
  award(award: CauVongAward): void;
  /** `CauVongFourGateTransactions.grantPet`: once per receipt. */
  pet(pet: CauVongPetCue): void;
  /** The `questOnce` step: each item added when its count is 0, once per receipt. */
  questOnce(room: number, receipt: number, items: readonly number[]): void;
  /** `op14CompleteEvent(98, room, event)`. */
  mark(room: number, event: number): void;
}
/** A fixed-position `TempSprite` from op49. */
export type CauVongEffect = { sprite: number; state: number; x: number; y: number; tick: number };

// --- Actor presentation (VqsvWorldActors.Actor) ------------------------------------------------

const isPlayer = (actor: StoryActor) => actor.id === -1;
/** npc0 people and props, and Sai Kỳ: full-skin banks with directional idle/walk states. */
const fullSkin = (actor: StoryActor) =>
  (actor.sprite >= 10000 && actor.sprite < 11000) || actor.sprite === CAU_VONG_CHAMPION_SPRITE;

function setState(actor: StoryActor, state: number): void {
  if (actor.state !== state) actor.animationTick = 0;
  actor.state = state;
}
/** `applyMode(mode)`. */
function applyMode(actor: StoryActor, mode: number): void {
  if (fullSkin(actor)) {
    // `fashionDirectionalState`: down 0, up 1, sideways 2; walking adds 3.
    const facing = actor.direction === 0 ? 0 : actor.direction === 2 ? 1 : 2;
    setState(actor, mode === 3 || mode === 7 ? 3 + facing : facing);
    return;
  }
  if (isPlayer(actor) || actor.variant === 1 || actor.variant === 18) {
    // `canonicalDirectionalState`.
    const normalized = actor.direction === 3 ? 1 : actor.direction;
    if (mode === 7) setState(actor, 3 + normalized);
    else if (mode >= 0 && mode < 12) setState(actor, Math.floor(mode / 3) * 3 + normalized);
    return;
  }
  setState(actor, mode);
}
/**
 * `setSourceRenderOrientation` as the draw reads it (`renderTransform`): Cầu Vồng banks face left and
 * mirror for orientation 1 (right); other art mirrors for 3. The web mirrors `renderOrientation` 3.
 */
function orient(actor: StoryActor, orientation: number): void {
  const o = Math.max(0, Math.min(3, orientation));
  if (isPlayer(actor)) actor.renderOrientation = o;
  else actor.renderOrientation = o === 1 ? 3 : 0;
}
/** `pose(id, signed)`: a source pose, mirrored when negative. */
function pose(actor: StoryActor, signed: number): void {
  const a = Math.abs(signed);
  actor.direction = signed < 0 ? 1 : a % 3 === 1 ? 2 : a % 3 === 2 ? 3 : 0;
  setState(actor, a);
  orient(actor, signed < 0 ? 1 : 0);
}
const syncDirection = (actor: StoryActor) => orient(actor, actor.direction);

// --- Steps ----------------------------------------------------------------------------------------

/** Per-cue scratch (`TempSprite`, the curtain offset), reset when the cursor moves on. */
export type CueScratch = { effect?: CauVongEffect; duration?: number; offset?: number };

const cameraTarget = (stage: CauVongStage, id: number) => {
  const a = stage.actor(id);
  return id === -1 ? { x: a.x, y: a.y } : { x: a.x + 10, y: a.y + 19 };
};
const curtainTarget = (mode: number) =>
  mode === 1 || mode === 4 ? 176 : mode === 3 || mode === 5 ? 40 : 0;

/** `Step.tick(scene, elapsed)` (elapsed from 0); true when the step is finished. */
export function tickCue(
  stage: CauVongStage,
  cue: CauVongCue,
  t: number,
  scratch: CueScratch,
): boolean {
  switch (cue.k) {
    case "say":
      throw new Error("Cầu Vồng dialogue plays as a text event");
    case "move": {
      const a = stage.actor(cue.id);
      if (a.x !== cue.x) {
        a.direction = a.x < cue.x ? 1 : 3;
        a.x += Math.sign(cue.x - a.x) * Math.min(cue.speed, Math.abs(cue.x - a.x));
      } else if (a.y !== cue.y) {
        a.direction = a.y < cue.y ? 0 : 2;
        a.y += Math.sign(cue.y - a.y) * Math.min(cue.speed, Math.abs(cue.y - a.y));
      }
      syncDirection(a);
      if (a.x === cue.x && a.y === cue.y) {
        restoreCue(stage, cue);
        return true;
      }
      applyMode(a, 3);
      return false;
    }
    case "lockedMove": {
      const a = stage.actor(cue.id);
      orient(a, cue.signed < 0 ? 1 : 0);
      if (t === 0) setState(a, Math.abs(cue.signed));
      const speed = Math.max(1, cue.speed);
      if (a.x !== cue.x) a.x += Math.sign(cue.x - a.x) * Math.min(speed, Math.abs(cue.x - a.x));
      else if (a.y !== cue.y)
        a.y += Math.sign(cue.y - a.y) * Math.min(speed, Math.abs(cue.y - a.y));
      if (a.x !== cue.x || a.y !== cue.y) return false;
      restoreCue(stage, cue);
      return true;
    }
    case "act": {
      const a = stage.actor(cue.id);
      if (t === 0) {
        setState(a, Math.abs(cue.state));
        orient(a, cue.state < 0 ? 1 : 0);
      }
      if (t < stage.animationTicks(a.sprite, Math.abs(cue.state))) return false;
      restoreCue(stage, cue);
      return true;
    }
    case "follow":
      restoreCue(stage, cue);
      return true;
    case "camera": {
      const target = cameraTarget(stage, cue.id);
      stage.stopFollow();
      const arrived = stage.panCamera(target.x, target.y, 10);
      if (arrived) stage.follow(cue.id);
      return arrived;
    }
    case "cameraAt":
      stage.stopFollow();
      return stage.panCamera(cue.x, cue.y, cue.speed);
    case "wait":
      return t >= cue.ticks;
    case "expr":
      stage.expression(cue.id, cue.state, cue.mode);
      return true;
    case "curtain": {
      const p = stage.presentation,
        target = curtainTarget(cue.mode);
      p.enabled = cue.mode !== 0 && cue.mode !== 6;
      if (cue.mode <= 2) {
        p.height = target;
        p.enabled = cue.mode === 1;
        return true;
      }
      p.enabled = true;
      // `at.b(int)`: 3/4 close from zero, 5 shrinks 80→40, 6 opens 40→0; 12 px a tick.
      if (t === 0) scratch.offset = cue.mode === 5 || cue.mode === 6 ? -40 : target;
      let offset = scratch.offset ?? 0;
      offset -= Math.sign(offset) * Math.min(12, Math.abs(offset));
      scratch.offset = offset;
      p.height = target - offset;
      if (offset === 0) {
        if (cue.mode === 6) p.enabled = false;
        return true;
      }
      return false;
    }
    case "shake":
      stage.presentation.shakeFrames = Math.max(0, cue.ticks);
      return true;
    case "flash":
      if (t === 0) stage.presentation.flashFrames = Math.max(0, cue.ticks);
      return true;
    case "effect": {
      if (t === 0) {
        // `loadRainbowEffect`: bank min(5, e / 5), state e % 5 (bank 5: e - 25).
        const bank = Math.min(5, Math.floor(cue.effect / 5)),
          state = bank === 5 ? cue.effect - 25 : cue.effect % 5,
          sprite = EFFECT_SPRITE + bank;
        scratch.duration = stage.animationTicks(sprite, state);
        scratch.effect = { sprite, state, x: cue.x, y: cue.y, tick: 0 };
        stage.addEffect(scratch.effect);
      }
      if (t >= (scratch.duration ?? 0)) {
        if (scratch.effect) stage.removeEffect(scratch.effect);
        return true;
      }
      return false;
    }
    case "gift":
      stage.gift(cue);
      return true;
    case "gifts":
      for (const gift of cue.gifts) stage.gift(gift);
      return true;
    case "award":
      stage.award(cue);
      return true;
    case "pet":
      stage.pet(cue);
      return true;
    case "questOnce":
      stage.questOnce(cue.room, cue.receipt, cue.items);
      return true;
    default:
      restoreCue(stage, cue);
      return true;
  }
}

/** `Step.restore(scene)`: the state a finished step leaves, for a resumed or cast-restored scene. */
export function restoreCue(stage: CauVongStage, cue: CauVongCue): void {
  switch (cue.k) {
    case "show":
      stage.actor(cue.id).visible = cue.on;
      return;
    case "face": {
      const a = stage.actor(cue.id);
      a.direction = cue.dir;
      applyMode(a, 0);
      orient(a, cue.dir);
      return;
    }
    case "place": {
      const a = stage.actor(cue.id);
      a.x = cue.x;
      a.y = cue.y;
      return;
    }
    case "move": {
      const a = stage.actor(cue.id);
      a.x = cue.x;
      a.y = cue.y;
      applyMode(a, 0);
      return;
    }
    case "pose":
      pose(stage.actor(cue.id), cue.signed);
      return;
    case "mark":
      stage.mark(cue.room, cue.event);
      return;
    case "act":
      pose(stage.actor(cue.id), cue.ret);
      return;
    case "lockedMove": {
      const a = stage.actor(cue.id);
      a.x = cue.x;
      a.y = cue.y;
      pose(a, cue.ret);
      return;
    }
    case "camera":
    case "follow":
      stage.follow(cue.id);
      return;
    case "cameraAt":
      stage.stopFollow();
      stage.centerCamera(cue.x, cue.y);
      return;
    case "cameraToPlayer": {
      const hero = stage.actor(-1);
      stage.stopFollow();
      stage.centerCamera(hero.x, hero.y);
      return;
    }
    case "expr":
      // Only persistent expressions survive a completed cue.
      if (cue.mode !== 0) stage.expression(cue.id, cue.state, cue.mode);
      return;
    case "curtain":
      stage.presentation.height = curtainTarget(cue.mode);
      stage.presentation.enabled = cue.mode !== 0 && cue.mode !== 6;
      return;
    default:
      return;
  }
}

/** The hook name a cue plays under, and the one that opens a part. */
export const CUE_HOOK = "cauVong.cue:";
export const BEGIN_HOOK = "cauVong.begin";
export const END_HOOK = "cauVong.end";

/**
 * A part as a script: its `started` flag, the restore hook (`initialized`: every finished cue's
 * `restore`, in order), each remaining cue with its checkpoint, then the closing hook and `flag`.
 * `done(event)` reads 98:`room`. Returns the events and the first cue still to play.
 */
export function partScript(
  part: CauVongPart,
  done: (event: number) => boolean,
): { events: RuntimeStoryEvent[]; cursor: number } {
  const mark = (event: number): RuntimeStoryEvent => ({
    type: "markComplete",
    ref: { scene: 98, room: part.room, group: event },
  });
  // A -1 `cue` is `CauVongOpeningDialogue.play`: no checkpoints, so it always plays from the top.
  const checkpoints = part.cue >= 0;
  let cursor = 0;
  while (checkpoints && cursor < part.steps.length && done(part.cue + cursor)) cursor++;
  for (let i = cursor; checkpoints && i < part.steps.length; i++)
    if (done(part.cue + i)) throw new Error("Non-prefix cutscene checkpoint");
  const events: RuntimeStoryEvent[] = [];
  if (part.started >= 0) events.push(mark(part.started));
  events.push({ type: "worldHook", hook: BEGIN_HOOK });
  for (let i = cursor; i < part.steps.length; i++) {
    const cue = part.steps[i];
    events.push(
      cue.k === "say"
        ? {
            type: "text",
            text: cue.text,
            speaker: cue.speaker,
            mode: 0,
            portrait: cue.portrait,
            wait: true,
            kind: "dialog",
          }
        : { type: "worldHook", hook: `${CUE_HOOK}${i}` },
    );
    // An award's step grants at t == 0 and then waits on its `TextBox.openBox` notice.
    // A source item with no record grants nothing and shows no notice.
    if (cue.k === "award" && cue.text)
      events.push({
        type: "text",
        text: cue.text,
        wait: true,
        kind: "openbox",
        box: { x: 47, y: 154, width: 146, height: 26 },
      });
    if (checkpoints) events.push(mark(part.cue + i));
  }
  events.push({ type: "worldHook", hook: END_HOOK });
  if (part.flag >= 0) events.push(mark(part.flag));
  return { events, cursor };
}
