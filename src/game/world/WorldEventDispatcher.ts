// Data-driven free-world dispatch. Triggers come from the decoded event groups
// (op13/op16 with op15/op86 preconditions), Liệt Hỏa room doors from the kind-1 actor columns and
// Cầu Vồng room doors and pads from the /4 table 1 and CauVongFourGateRoutes.PORTALS, so no
// per-scene catalog is authored here.
import type { StoryDataRegistry } from "../story/StoryDataRegistry";
import { DOOR_RULES, roomOwner } from "./JavaRoomRules";
import type { EventStateLedger } from "./EventStateLedger";
import {
  playerInteractsActor,
  playerIntersectsSourceRect,
  playerSourcePointInRect,
} from "./WorldInteractionEngine";
import { op60Doors, worldEventTriggers, type WorldEventTrigger } from "./WorldEventCatalog";
import {
  doorOverlaps,
  roomDoorTriggerRect,
  roomDoorUnlocked,
  roomPortalTriggerRect,
  roomPortalUnlocked,
  sourceDoors,
  sourceRoomDoors,
  sourceRoomPortals,
  type RoomDoor,
  type RoomPortal,
  type SourceDoor,
} from "./WorldTransition";

export type WorldDispatch =
  | { kind: "event"; trigger: WorldEventTrigger }
  | { kind: "door"; door: SourceDoor }
  | { kind: "room-door"; door: RoomDoor }
  | { kind: "room-portal"; portal: RoomPortal };
export type WorldView = {
  scene: number;
  room: number;
  x: number;
  y: number;
  direction: number;
  /** Java's key0 / pointer activation: op16 triggers fire on it, op13 triggers ignore it. */
  activation: boolean;
  actorAt: (id: number) => { x: number; y: number; visible: boolean } | undefined;
  /** Mirrors WorldRoomCatalog.supportsTransition: an unloadable target leaves the world untouched. */
  supportsTarget: (scene: number, room: number) => boolean;
  /** Whether an op59 torch of this room burns (`switchActivated`). */
  lit?: (actorId: number) => boolean;
  /**
   * `BattleNpcProximityGate.pending`: the actor is a catalogued NPC/elite/gym opponent with a fight
   * still to win, so standing near it is the activation (`actorActivationRequested` without a key).
   */
  challengePending?: (actorId: number) => boolean;
};

/** `BattleNpcProximityGate.MAX_AXIS_DISTANCE` / `MAX_MANHATTAN_DISTANCE`. */
const CHALLENGE_AXIS = 48,
  CHALLENGE_MANHATTAN = 64;

/** `BattleNpcProximityGate.shouldAutoActivate`'s distance test. */
const nearChallenger = (view: WorldView, actor: { x: number; y: number }): boolean => {
  const dx = Math.abs(view.x - actor.x),
    dy = Math.abs(view.y - actor.y);
  return dx <= CHALLENGE_AXIS && dy <= CHALLENGE_AXIS && dx + dy <= CHALLENGE_MANHATTAN;
};

export class WorldEventDispatcher {
  private triggers: WorldEventTrigger[] = [];
  private doors: SourceDoor[] = [];
  private roomDoors: RoomDoor[] = [];
  private portals: RoomPortal[] = [];
  /** Doors this room's op60 opens, with the group that opens each one. */
  private gatedDoors = new Map<number, number>();
  private scene = -1;
  private room = -1;
  private arrival: { scene: number; room: number; actor: number } | null = null;
  private readonly occupiedRects = new Set<string>();
  /**
   * Chain links whose fight was just lost or fled (`holdUntilRoomChange`): they wait until the hero
   * has left the room, or a link with no rect of its own would start the same fight next tick.
   */
  private readonly heldLinks = new Set<string>();
  /**
   * Gym challengers' groups → their actor (`BattleNpcProximityGate.shouldTriggerChallenge`): such a
   * rect also fires when the hero comes within 48 px on each axis and 64 px in all of the actor.
   */
  private challengers = new Map<string, number>();
  setChallengers(groups: ReadonlyMap<string, number>): void {
    this.challengers = new Map(groups);
  }
  constructor(
    private readonly registry: StoryDataRegistry,
    private readonly ledger: EventStateLedger,
    private readonly branchStatus: (taskId: number) => number = () => -1,
    private readonly branchCompletionReady: (
      taskId: number,
      sourceArgs: number[],
    ) => boolean = () => false,
    private readonly mainTaskProgress: () => number = () => 0,
    private readonly mainCompletionReady: (taskId: number, sourceArgs: number[]) => boolean = () =>
      false,
    private readonly badgeAchieved: (badgeId: number) => boolean = () => false,
  ) {}
  get doorCount(): number {
    return this.doors.length + this.roomDoors.length;
  }
  enterRoom(scene: number, room: number): void {
    this.triggers = worldEventTriggers(this.registry, scene, room);
    this.doors = sourceDoors(this.registry, scene, room);
    this.roomDoors = sourceRoomDoors(this.registry, scene, room);
    this.portals = sourceRoomPortals(scene, room);
    this.gatedDoors = op60Doors(this.registry, scene, room);
    this.scene = scene;
    this.room = room;
    this.occupiedRects.clear();
    this.heldLinks.clear();
  }
  /**
   * Web-only (JavaSE loops here too): an auto chain link such as Bích Thủy's PaYaQi fight (2:1:1)
   * fires on any tick its gates hold, so after a lost or fled fight it would restart at once and a
   * party that cannot win could never leave. It stays quiet until the next room is entered.
   */
  holdUntilRoomChange(group: { scene: number; room: number; group: number }): void {
    this.heldLinks.add(`${group.scene}:${group.room}:${group.group}`);
  }
  /** Records the door just used; JavaSE holds this latch until the player clears the marker. */
  markArrival(door: SourceDoor): void {
    this.arrival = { scene: door.target.scene, room: door.target.room, actor: door.target.actor };
  }
  probe(view: WorldView): WorldDispatch | null {
    for (const trigger of this.triggers) {
      if (!this.dispatchable(trigger)) continue;
      if (trigger.kind === "rect") {
        const key = `${trigger.group.scene}:${trigger.group.room}:${trigger.group.group}`;
        const challenger = this.challengers.get(key),
          actor = challenger === undefined ? undefined : view.actorAt(challenger),
          near = !!actor?.visible && nearChallenger(view, actor),
          inside = near || playerIntersectsSourceRect(view.x, view.y, trigger.rect);
        if (inside && !this.occupiedRects.has(key)) {
          this.occupiedRects.add(key);
          return { kind: "event", trigger };
        }
        // A retired (op42) group stays dispatchable, so the rect only arms again once the
        // player has left it; otherwise a repeatable notice would re-fire every tick.
        if (!inside) this.occupiedRects.delete(key);
      } else if (trigger.kind === "actor") {
        const actor = view.actorAt(trigger.actorId);
        if (!actor) continue;
        if (view.activation) {
          if (playerInteractsActor(view.x, view.y, view.direction, actor))
            return { kind: "event", trigger };
          continue;
        }
        // Without a key, an unbeaten challenger calls the hero over once he comes near. Java sends a
        // beaten hero back to town, so it never re-reads him standing there; the web keeps him in
        // place after a loss or a flight, so the call waits until he has stepped away again.
        const key = `actor:${trigger.group.scene}:${trigger.group.room}:${trigger.group.group}`,
          near =
            actor.visible &&
            !!view.challengePending?.(trigger.actorId) &&
            nearChallenger(view, actor);
        if (near && !this.occupiedRects.has(key)) {
          this.occupiedRects.add(key);
          return { kind: "event", trigger };
        }
        if (!near) this.occupiedRects.delete(key);
      }
      // A chain link needs nothing from the player but the tick it becomes eligible in, so the
      // gate check above is the whole condition.
      else if (trigger.kind === "auto") {
        const key = `${trigger.group.scene}:${trigger.group.room}:${trigger.group.group}`;
        if (!this.heldLinks.has(key)) return { kind: "event", trigger };
      } else if (trigger.kind === "switches" && trigger.actorIds.every((id) => view.lit?.(id)))
        return { kind: "event", trigger };
      // `requestedReset`: 5 against the switch (`sourceObstacleActivationRequested`) while the
      // block it resets has left its gate tile.
      else if (trigger.kind === "contact" && view.activation) {
        const target = view.actorAt(trigger.target),
          switchActor = view.actorAt(trigger.triggerActor);
        if (
          target &&
          switchActor &&
          (target.x !== trigger.gateX || target.y !== trigger.gateY) &&
          playerInteractsActor(view.x, view.y, view.direction, switchActor)
        )
          return { kind: "event", trigger };
      }
    }
    if (this.arrivalBlocksDoors(view)) return null;
    for (const door of this.doors) {
      if (!view.supportsTarget(door.target.scene, door.target.room)) continue;
      // `complete(...) && tryTransition(...)`: a runtime keeps this door shut until a group is done.
      const rule = DOOR_RULES[`${this.scene}:${this.room}`]?.[door.actorId];
      if (rule && !this.ledger.sourceEventStateComplete(rule.scene, rule.room, rule.group))
        continue;
      const opener = this.gatedDoors.get(door.actorId);
      if (
        opener !== undefined &&
        !this.ledger.sourceEventStateComplete(this.scene, this.room, opener)
      )
        continue;
      if (!door.directionAgnostic && door.requiredDirection !== view.direction) continue;
      if (doorOverlaps(view, door)) return { kind: "door", door };
    }
    // Cầu Vồng's route owner reads the /4 table straight through: it arms the Liệt Hỏa arrival
    // latch on entry but never consults it, so no marker hold applies to these doors. Its PORTALS
    // pads are scanned first because that is the order the Java loop runs them in.
    for (const portal of this.portals) {
      if (!view.supportsTarget(portal.target.scene, portal.target.room)) continue;
      if (!roomPortalUnlocked(this.ledger, portal.scene, portal)) continue;
      if (playerSourcePointInRect(view.x, view.y, roomPortalTriggerRect(portal)))
        return { kind: "room-portal", portal };
    }
    for (const door of this.roomDoors) {
      if (!view.supportsTarget(door.target.scene, door.target.room)) continue;
      if (!roomDoorUnlocked(this.ledger, door.scene, door.room, door.target.room)) continue;
      if (playerSourcePointInRect(view.x, view.y, roomDoorTriggerRect(door)))
        return { kind: "room-door", door };
    }
    return null;
  }
  /** JavaSE holds nextWorldF/G/Actor until the player spends one tick off the arrival marker. */
  private arrivalBlocksDoors(view: WorldView): boolean {
    if (!this.arrival) return false;
    const marker =
      this.arrival.scene === view.scene && this.arrival.room === view.room
        ? this.doors.find((door) => door.actorId === this.arrival!.actor)
        : undefined;
    const stillOnMarker = !!marker && doorOverlaps(view, marker);
    if (!stillOnMarker) this.arrival = null;
    return stillOnMarker;
  }
  /** The unlit torches of this room's pending op59 groups: what 5 on an actor lights. */
  pendingSwitches(): { actorIds: number[]; touch?: true }[] {
    return this.triggers.filter(
      (trigger): trigger is WorldEventTrigger & { kind: "switches" } =>
        trigger.kind === "switches" && this.dispatchable(trigger),
    );
  }
  private dispatchable(trigger: WorldEventTrigger): boolean {
    if (
      !this.ledger.sourceEventStateDispatchable(
        trigger.group.scene,
        trigger.group.room,
        trigger.group.group,
      )
    )
      return false;
    if (trigger.mainTask !== undefined && this.mainTaskProgress() !== trigger.mainTask)
      return false;
    if (trigger.minTask !== undefined && this.mainTaskProgress() < trigger.minTask) return false;
    if (trigger.badge !== undefined && !this.badgeAchieved(trigger.badge)) return false;
    // The room's JavaSE owner runs only the groups it wires.
    const owner = roomOwner(trigger.group.scene, trigger.group.room, (ref) =>
      this.ledger.sourceEventStateComplete(ref.scene, ref.room, ref.group),
    );
    if (owner?.groups && !owner.groups.includes(trigger.group.group)) return false;
    const branch = trigger.branch;
    if (branch) {
      // Column one is the source's own discriminator: 1 for branch rows, 0 for Jones' main-task
      // handoff. An op43 without op49 is a held branch's intermediate step, not a fresh offer.
      if (branch.sourceArgs[1] !== 0) {
        const status = this.branchStatus(branch.taskId);
        if (branch.kind === "offer" && status !== -1) return false;
        // An offer's own prerequisite columns (5–7): Karen's second fruit waits for the first to
        // reach Doranle (`BlcC1Runtime.availableFruitOffer`: `complete(11, 3, 0)`).
        const [, , , , , needScene, needRoom, needGroup] = branch.sourceArgs;
        if (
          branch.kind === "offer" &&
          needScene >= 0 &&
          needRoom >= 0 &&
          needGroup >= 0 &&
          !this.ledger.sourceEventStateComplete(needScene, needRoom, needGroup)
        )
          return false;
        if (
          branch.kind !== "offer" &&
          (status !== 1 || !this.branchCompletionReady(branch.taskId, branch.sourceArgs))
        )
          return false;
      } else {
        // Jones' main-task 19→20 handoff reuses op43/op44's row shape. The branch catalog is the
        // authority that distinguishes it from side quests; op43 names the next main task while
        // op44 names the current one and carries the ordinary Pet/item prerequisite columns.
        const progress = this.mainTaskProgress();
        if (branch.kind !== "completion" && progress !== branch.taskId - 1) return false;
        if (
          branch.kind === "completion" &&
          (progress !== branch.taskId ||
            !this.mainCompletionReady(branch.taskId, branch.sourceArgs))
        )
          return false;
      }
    }
    return trigger.gates.every((gate) =>
      gate.opcode === 15
        ? this.ledger.op15CheckEventState(gate.ref.scene, gate.ref.room, gate.ref.group)
        : this.ledger.op86CheckEventState(gate.ref.scene, gate.ref.room, gate.ref.group),
    );
  }
}
