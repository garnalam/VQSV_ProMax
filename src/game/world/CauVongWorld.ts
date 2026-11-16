// JavaSE parity: the Cầu Vồng (scene 98) layer of VqsvFreeWorldRuntime — the actor snapshots
// `actorLookup` builds for movement (CauVongStandingNpcCollision / CauVongPropCollision) and the
// keyboard activation `VqsvGameRuntime.Scene.actorActivationRequested` runs through
// CauVongNpcGeometry. The per-actor overrides are baked by ExportWebCauVongActors
// (`cau-vong-world/collision.json`), so nothing here re-derives which actor is a person or a prop.
import type { CollisionMask } from "../story/GameAssets";
import type { StoryActor } from "../story/StoryActor";
import { type ActorSnapshot, sourceMaskOverlap } from "./ActorCollision";
import { DIRECTION_DOWN, DIRECTION_LEFT, DIRECTION_RIGHT, DIRECTION_UP } from "./MapCollision";
import { interactionOrigin } from "./WorldInteractionEngine";

/**
 * One room actor's `WorldEngine.ActorSnapshot` as `actorLookup` leaves it on a fresh chapter:
 * kind, behaviour and mask after the Cầu Vồng overrides, and the anchor as an offset from the
 * actor's position (a standing NPC is held at its displayed foot, `x + 10, y + 19`). `talk` marks
 * `CauVongNpcGeometry.owns` ("npc") and `CauVongNpcGeometry.prop` ("prop").
 */
export type CauVongMechanic = {
  kind: number;
  behavior: number;
  dx: number;
  dy: number;
  mask: CollisionMask | null;
  talk?: "npc" | "prop";
};
export type CauVongCollisionDocument = { rooms: Record<string, Record<string, CauVongMechanic>> };

/** `CauVongNpcGeometry.FOOTPRINT`, which is also its `INTERACTION` mask. */
export const CAU_VONG_NPC_FOOTPRINT: CollisionMask = [-8, -7, 16, 14];

/** `CauVongCampusNpcPassage`: 30:6's lower witness must leave a lane along the shore. */
export function cauVongCampusNpcPassable(
  room: number,
  actor: StoryActor,
  actors: ReadonlyMap<number, StoryActor>,
): boolean {
  if (room !== 30 || actor.id !== 30 || actor.sprite !== 10002) return false;
  return [
    [28, 300, 380],
    [29, 340, 380],
    [30, 320, 400],
  ].every(([id, x, y]) => {
    const witness = actors.get(id);
    return witness?.visible && witness.x === x && witness.y === y;
  });
}

/** `actorLookup`'s snapshots for the room's actors, positions and visibility read live. */
export function cauVongActorSnapshots(
  actors: Iterable<StoryActor>,
  mechanics: Readonly<Record<string, CauVongMechanic>>,
): ActorSnapshot[] {
  const snapshots: ActorSnapshot[] = [];
  for (const actor of actors) {
    const mechanic = actor.id >= 0 ? mechanics[String(actor.id)] : undefined;
    if (!mechanic) continue;
    snapshots.push({
      visible: actor.visible,
      kind: mechanic.kind,
      behavior: mechanic.behavior,
      x: actor.x + mechanic.dx,
      y: actor.y + mechanic.dy,
      mask: mechanic.mask,
    });
  }
  return snapshots;
}

/**
 * `CauVongNpcGeometry.interaction`: a mount's longer step can stop up to 5 px short of the footprint,
 * so only the edge the hero approaches grows by `speed - 4` (at most 16).
 */
export function cauVongInteractionMask(speed: number, direction: number): CollisionMask {
  const extra = Math.max(0, Math.min(20, speed) - 4);
  if (extra === 0) return CAU_VONG_NPC_FOOTPRINT;
  const [x, y, w, h] = CAU_VONG_NPC_FOOTPRINT;
  if (direction === DIRECTION_DOWN) return [x, y - extra, w, h + extra];
  if (direction === DIRECTION_RIGHT) return [x - extra, y, w + extra, h];
  if (direction === DIRECTION_UP) return [x, y, w, h + extra];
  if (direction === DIRECTION_LEFT) return [x, y, w + extra, h];
  return CAU_VONG_NPC_FOOTPRINT;
}

/** The hero as the activation checks read him. */
export type CauVongHero = {
  x: number;
  y: number;
  direction: number;
  /** `player.collisionMask()`. */
  mask: CollisionMask | null;
  /** `ride.playerMoveSpeed`. */
  speed: number;
  /** Present only during a map tap; -1 means the tap hit no actor. */
  pointerTarget?: number;
};

/** The standing NPCs of a room, with their anchors (`CauVongNpcGeometry.x` / `y`). */
type Npc = { id: number; x: number; y: number };

function npcs(
  actors: Iterable<StoryActor>,
  mechanics: Readonly<Record<string, CauVongMechanic>>,
): Npc[] {
  const out: Npc[] = [];
  for (const actor of actors) {
    const mechanic = actor.id >= 0 ? mechanics[String(actor.id)] : undefined;
    if (mechanic?.talk === "npc" && actor.visible)
      out.push({ id: actor.id, x: actor.x + mechanic.dx, y: actor.y + mechanic.dy });
  }
  return out;
}

/** `playerInteractsActorSourceMask` for a standing NPC: the 4 px forward query against its footprint. */
function interacts(hero: CauVongHero, npc: Npc): boolean {
  if (!hero.mask) return false;
  const origin = interactionOrigin(hero.x, hero.y, hero.direction);
  return sourceMaskOverlap(
    origin.x,
    origin.y,
    hero.mask,
    npc.x,
    npc.y,
    cauVongInteractionMask(hero.speed, hero.direction),
  );
}

const distance = (hero: CauVongHero, npc: Npc) => (hero.x - npc.x) ** 2 + (hero.y - npc.y) ** 2;

/**
 * `CauVongNpcGeometry.keyboardFocus`: the hero faces this NPC and no other standing NPC he also
 * faces is nearer (a tie goes to the lower id).
 */
function keyboardFocus(hero: CauVongHero, all: readonly Npc[], npc: Npc): boolean {
  if (!interacts(hero, npc)) return false;
  const own = distance(hero, npc);
  for (const other of all) {
    if (other.id === npc.id) continue;
    const candidate = distance(hero, other);
    if ((candidate < own || (candidate === own && other.id < npc.id)) && interacts(hero, other))
      return false;
  }
  return true;
}

/**
 * `CauVongNpcGeometry.requested` for a standing NPC on the key (5 / Enter): visible, within 48 px of
 * its anchor on both axes, and the hero's keyboard focus.
 */
export function cauVongNpcRequested(
  hero: CauVongHero,
  actors: Iterable<StoryActor>,
  mechanics: Readonly<Record<string, CauVongMechanic>>,
  id: number,
  confirm: boolean,
): boolean {
  if (!confirm) return false;
  const all = npcs(actors, mechanics),
    npc = all.find((candidate) => candidate.id === id);
  if (!npc || Math.abs(hero.x - npc.x) > 48 || Math.abs(hero.y - npc.y) > 48) return false;
  return hero.pointerTarget !== undefined
    ? hero.pointerTarget === id
    : keyboardFocus(hero, all, npc);
}

/**
 * `CauVongNpcGeometry.propActivation` on the key (5 / Enter): a visible prop within 48 px of its
 * displayed rectangle, and the point `reach` px ahead of the hero (20–28 by the ride's step)
 * inside that rectangle widened by 8 px.
 */
export function cauVongPropRequested(
  hero: CauVongHero,
  visible: boolean,
  rect: readonly [number, number, number, number],
  confirm: boolean,
  pointerSelected?: boolean,
): boolean {
  if (!visible || !confirm) return false;
  const [left, top, width, height] = rect;
  if (width <= 0 || height <= 0) return false;
  const right = left + width,
    bottom = top + height;
  const dx = Math.max(0, left - hero.x, hero.x - right),
    dy = Math.max(0, top - hero.y, hero.y - bottom);
  if (dx > 48 || dy > 48) return false;
  if (pointerSelected !== undefined) return pointerSelected;
  const reach = Math.max(20, Math.min(28, hero.speed + 12));
  let px = hero.x,
    py = hero.y;
  if (hero.direction === DIRECTION_DOWN) py += reach;
  else if (hero.direction === DIRECTION_RIGHT) px += reach;
  else if (hero.direction === DIRECTION_UP) py -= reach;
  else if (hero.direction === DIRECTION_LEFT) px -= reach;
  else return false;
  return px + 8 >= left && px - 8 < right && py + 8 >= top && py - 8 < bottom;
}

/**
 * The talk bubble's target (`WorldTalkPromptEngine` over the Cầu Vồng candidates): the lowest-id
 * standing NPC that has the hero's keyboard focus, at its anchor.
 */
export function cauVongTalkTarget(
  hero: CauVongHero,
  actors: Iterable<StoryActor>,
  mechanics: Readonly<Record<string, CauVongMechanic>>,
): Npc | null {
  const all = npcs(actors, mechanics).sort((a, b) => a.id - b.id);
  return all.find((npc) => keyboardFocus(hero, all, npc)) ?? null;
}
