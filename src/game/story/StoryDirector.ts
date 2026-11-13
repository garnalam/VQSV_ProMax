import { QuestLog, type QuestLogRecord } from "../quest/QuestLog";
import {
  DoorGraph,
  StoryGraph,
  triggerRoom,
  type StoryEffect,
  type StoryLocation,
  type StoryNode,
  type StoryTrigger,
} from "./StoryGraph";

/** Something the world reports that a story exit may be waiting for. */
export type StorySignal = StoryTrigger;

/** An effect the host has to carry out (the director applies quest changes itself). */
export type StoryAction =
  | { kind: "cutscene"; route: string }
  | { kind: "warp"; to: StoryLocation; reason: "story" | "unstuck" }
  | { kind: "save" };

/** What the save keeps (`story.quest`): the node and the quest log, primitives only. */
export type StoryRecord = QuestLogRecord & { node: string };

/**
 * Runs the story graph: holds the current node, matches the world's signals against its exits,
 * applies quest effects to the log and hands everything else (cutscenes, warps, saves) back to the
 * host. One signal moves at most one exit, so a chain of nodes needs a signal per step and can
 * never skip a cutscene.
 *
 * The anti-stuck guard (`unstick`) runs when the player enters a room: if none of the current
 * node's trigger rooms can be reached on foot from where the player stands, the player is put back
 * at the node's checkpoint.
 */
export class StoryDirector {
  readonly log = new QuestLog();
  private current: StoryNode;
  /** Signals seen since the last save, in order (debug overlay, tests). */
  readonly history: string[] = [];

  constructor(
    readonly graph: StoryGraph,
    private readonly doors?: DoorGraph,
  ) {
    this.current = graph.start;
  }

  get node(): StoryNode {
    return this.current;
  }
  /** The main task the card shows: the node's, else the log's. */
  get mainTask(): number {
    return this.current.mainTask ?? this.log.main;
  }
  /** Whether the storyline has run into content that is not ported yet. */
  get atFrontier(): boolean {
    return !!this.current.frontier;
  }

  /** Enter the start node (a new game). */
  begin(): StoryAction[] {
    return this.enter(this.graph.start);
  }

  /**
   * Resume from a save: its recorded node when it names one, otherwise the node that matches the
   * world flag the older Scene 1 saves kept (`activeTask`), otherwise the start.
   */
  restore(record: Partial<StoryRecord> | undefined, activeTask?: string): void {
    const saved = record?.node ? this.graph.node(record.node) : undefined,
      inferred = activeTask ? this.graph.nodeForActiveTask(activeTask) : undefined,
      node = saved ?? inferred ?? this.graph.start;
    this.current = node;
    if (record?.node && saved) this.log.restore(record);
    else if (node.mainTask !== undefined) this.log.startMain(node.mainTask);
  }

  /**
   * Replay what the world already did but the director never saw: an exit waiting on an event
   * group or a fight that the save's ledger already has complete. A save written in the same tick
   * as the completion (the elder return commits before the director observes it) would otherwise
   * resume on a node whose trigger can never fire again.
   */
  catchUp(complete: (scene: number, room: number, group: number) => boolean): StoryAction[] {
    const actions: StoryAction[] = [];
    for (let step = 0; step < this.graph.nodes.length; step++) {
      const exit = (this.current.exits ?? []).find(
        ({ on }) =>
          (on.kind === "eventComplete" || on.kind === "battleWon") &&
          complete(on.scene, on.room, on.group),
      );
      if (!exit) break;
      actions.push(...this.signal(exit.on));
    }
    return actions;
  }

  snapshot(): StoryRecord {
    return { node: this.current.id, ...this.log.snapshot() };
  }

  /** A world signal: follow the first exit of the current node it satisfies. */
  signal(signal: StorySignal): StoryAction[] {
    if (signal.kind === "token") this.log.grantToken(signal.name);
    const exit = (this.current.exits ?? []).find((candidate) => matches(candidate.on, signal));
    if (!exit) return [];
    this.history.push(`${this.current.id} --${describe(signal)}--> ${exit.to}`);
    const actions = this.apply(exit.do);
    return [...actions, ...this.enter(this.graph.require(exit.to))];
  }

  /**
   * The anti-stuck check for the room the player stands in: when the current node waits on rooms
   * none of which can be walked to from here, send the player back to the node's checkpoint.
   */
  unstick(scene: number, room: number): StoryAction | null {
    const checkpoint = this.current.checkpoint;
    if (!this.doors || !checkpoint) return null;
    const rooms = (this.current.exits ?? [])
      .map((exit) => triggerRoom(exit.on))
      .filter((r): r is { scene: number; room: number } => r !== null);
    if (rooms.length === 0) return null;
    const reachable = this.doors.reachable(scene, room);
    if (rooms.some((r) => reachable.has(`${r.scene}:${r.room}`))) return null;
    this.history.push(`${this.current.id} unstuck from ${scene}:${room}`);
    return { kind: "warp", to: checkpoint, reason: "unstuck" };
  }

  private enter(node: StoryNode): StoryAction[] {
    this.current = node;
    if (node.mainTask !== undefined) this.log.startMain(node.mainTask);
    return this.apply(node.enter);
  }

  private apply(effects: StoryEffect[] | undefined): StoryAction[] {
    const actions: StoryAction[] = [];
    for (const effect of effects ?? []) {
      switch (effect.do) {
        case "startMain":
          this.log.startMain(effect.task);
          break;
        case "completeMain":
          this.log.completeMain(effect.task);
          break;
        case "branch":
          this.log.setBranch(effect.task, effect.status);
          break;
        case "token":
          this.log.grantToken(effect.name);
          break;
        case "cutscene":
          actions.push({ kind: "cutscene", route: effect.route });
          break;
        case "warp":
          actions.push({ kind: "warp", to: effect.to, reason: "story" });
          break;
        case "save":
          actions.push({ kind: "save" });
          break;
      }
    }
    return actions;
  }
}

function matches(trigger: StoryTrigger, signal: StorySignal): boolean {
  if (trigger.kind !== signal.kind) return false;
  switch (trigger.kind) {
    case "worldEnter":
      return true;
    case "cutsceneEnd":
      return trigger.route === (signal as typeof trigger).route;
    case "token":
      return trigger.name === (signal as typeof trigger).name;
    case "roomEnter": {
      const s = signal as typeof trigger;
      return trigger.scene === s.scene && trigger.room === s.room;
    }
    default: {
      const s = signal as typeof trigger;
      return trigger.scene === s.scene && trigger.room === s.room && trigger.group === s.group;
    }
  }
}

function describe(signal: StorySignal): string {
  return "scene" in signal
    ? `${signal.kind}@${signal.scene}:${signal.room}${"group" in signal ? `:${signal.group}` : ""}`
    : "route" in signal
      ? `${signal.kind}:${signal.route}`
      : "name" in signal
        ? `${signal.kind}:${signal.name}`
        : signal.kind;
}
