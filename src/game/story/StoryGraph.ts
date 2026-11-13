import type { StoryDataRegistry } from "./StoryDataRegistry";
import { sourceDoors } from "../world/WorldTransition";

/**
 * The storyline as data (`story/story-graph.json`): nodes the player passes through, each with the
 * main task it holds, a checkpoint the anti-stuck guard can return the player to, what happens on
 * entering it, and the exits — a trigger the world reports, the effects it runs, the next node.
 * Content still to be ported ends in a `frontier` node, so an unported chapter is a visible stop
 * rather than a soft-lock.
 */
export type StoryLocation = {
  scene: number;
  room: number;
  x: number;
  y: number;
  direction: number;
};

export type StoryTrigger =
  | { kind: "worldEnter" }
  | { kind: "cutsceneEnd"; route: string }
  | { kind: "roomEnter"; scene: number; room: number }
  | { kind: "eventComplete"; scene: number; room: number; group: number }
  | { kind: "battleWon"; scene: number; room: number; group: number }
  | { kind: "battleLost"; scene: number; room: number; group: number }
  | { kind: "token"; name: string };

export type StoryEffect =
  | { do: "cutscene"; route: string }
  | { do: "startMain"; task: number }
  | { do: "completeMain"; task: number }
  | { do: "branch"; task: number; status: 1 | 3 }
  | { do: "token"; name: string }
  | { do: "warp"; to: StoryLocation }
  | { do: "save" };

export type StoryExit = { on: StoryTrigger; do?: StoryEffect[]; to: string };

export type StoryNode = {
  id: string;
  chapter: string;
  title: string;
  /** The main task (mTask row) this node holds; the task card shows it. */
  mainTask?: number;
  /** The world flag the Scene 1 runtime keeps for this stretch (restores old saves). */
  activeTask?: string;
  /** Where the anti-stuck guard puts the player back. */
  checkpoint?: StoryLocation;
  enter?: StoryEffect[];
  exits?: StoryExit[];
  /** Not ported yet: the storyline stops here (reason shown to the player and in the report). */
  frontier?: string;
  /** The end of the game. */
  ending?: boolean;
};

export type StoryChapter = {
  id: string;
  title: string;
  scenes: number[];
  mainTasks: number[];
  note?: string;
};

export type StoryGraphDocument = {
  schema: string;
  start: string;
  chapters: StoryChapter[];
  nodes: StoryNode[];
};

export class StoryGraph {
  private readonly byId = new Map<string, StoryNode>();
  constructor(readonly document: StoryGraphDocument) {
    for (const node of document.nodes) {
      if (this.byId.has(node.id)) throw new Error(`story node declared twice: ${node.id}`);
      this.byId.set(node.id, node);
    }
  }
  get start(): StoryNode {
    return this.require(this.document.start);
  }
  node(id: string): StoryNode | undefined {
    return this.byId.get(id);
  }
  require(id: string): StoryNode {
    const node = this.byId.get(id);
    if (!node) throw new Error(`story node ${id} is not declared`);
    return node;
  }
  get nodes(): readonly StoryNode[] {
    return this.document.nodes;
  }
  /** The node an old save stands in, from the world flag the Scene 1 runtime saved. */
  nodeForActiveTask(activeTask: string): StoryNode | undefined {
    return this.document.nodes.find((node) => node.activeTask === activeTask);
  }
}

/** The room a trigger fires in, when it fires in one. */
export function triggerRoom(trigger: StoryTrigger): { scene: number; room: number } | null {
  return "scene" in trigger ? { scene: trigger.scene, room: trigger.room } : null;
}

/**
 * The world's door graph (`sourceDoors` of every room the event registry knows): which rooms a
 * player can walk to from which. Used to prove a node's trigger is reachable from its checkpoint.
 */
export class DoorGraph {
  private readonly edges = new Map<string, Set<string>>();
  constructor(registry: StoryDataRegistry) {
    for (const scene of registry.document.scenes) {
      if (scene.sceneId === null) continue;
      for (const room of scene.rooms) {
        const from = `${scene.sceneId}:${room.roomIndex}`,
          targets = this.edges.get(from) ?? new Set<string>();
        for (const door of sourceDoors(registry, scene.sceneId, room.roomIndex))
          targets.add(`${door.target.scene}:${door.target.room}`);
        // Cầu Vồng keeps its doors in the /4 door table instead of kind-1 actor rows.
        for (const door of room.doors ?? [])
          if (door.target) targets.add(`${door.target.scene}:${door.target.room}`);
        this.edges.set(from, targets);
      }
    }
  }
  /**
   * A wharf captain's routes (`SOURCE_WHARF_ROUTES`) are ways out of his dock room too: a boat trip
   * must not read as being stranded. The route gates are left out — the graph only answers "is
   * there a way", and a dock always has its captain.
   */
  addWharfRoutes(
    docks: readonly { scene: number; room: number; routes: readonly (readonly number[])[] }[],
  ): this {
    for (const dock of docks) {
      const from = `${dock.scene}:${dock.room}`,
        targets = this.edges.get(from) ?? new Set<string>();
      for (const route of dock.routes) targets.add(`${route[3]}:${route[4]}`);
      this.edges.set(from, targets);
    }
    return this;
  }
  /** Rooms reachable on foot (or by boat) from `scene:room` (including itself). */
  reachable(scene: number, room: number): Set<string> {
    const start = `${scene}:${room}`,
      seen = new Set([start]),
      queue = [start];
    while (queue.length) {
      for (const next of this.edges.get(queue.shift()!) ?? [])
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
    }
    return seen;
  }
}

/** What the validator needs to know about the pack. */
export type StoryWorldIndex = {
  routes: ReadonlySet<string>;
  rooms: (scene: number, room: number) => boolean;
  group: (scene: number, room: number, group: number) => boolean;
  /** Whether the hero can stand at (x, y) of a room (its collision says passable). */
  walkable?: (scene: number, room: number, x: number, y: number) => boolean;
  mainTaskCount: number;
  branchTaskCount: number;
  doors: DoorGraph;
};

/**
 * Static checks that make a soft-lock a test failure instead of a bug report:
 * - every node is reachable from the start and every exit leads to a declared node;
 * - every node can still reach an ending or a frontier (no closed loop);
 * - every non-terminal node has an exit, and every exit's trigger names a room, event group or
 *   cutscene that exists in the pack;
 * - a trigger's room is reachable on foot (door graph) from the node's checkpoint;
 * - checkpoints are rooms the hero can stand in, main tasks exist and never go backwards.
 */
export function validateStoryGraph(graph: StoryGraph, world: StoryWorldIndex): string[] {
  const problems: string[] = [];
  const nodes = graph.nodes;
  if (!graph.node(graph.document.start))
    problems.push(`start node ${graph.document.start} missing`);
  const checkEffects = (where: string, effects: StoryEffect[] | undefined) => {
    for (const effect of effects ?? []) {
      if (effect.do === "cutscene" && !world.routes.has(effect.route))
        problems.push(`${where}: cutscene route ${effect.route} is not in routes.json`);
      if (
        (effect.do === "startMain" || effect.do === "completeMain") &&
        (effect.task < 0 || effect.task >= world.mainTaskCount)
      )
        problems.push(`${where}: main task ${effect.task} does not exist`);
      if (effect.do === "branch" && (effect.task < 0 || effect.task >= world.branchTaskCount))
        problems.push(`${where}: branch task ${effect.task} does not exist`);
      if (effect.do === "warp" && !world.rooms(effect.to.scene, effect.to.room))
        problems.push(`${where}: warp room ${effect.to.scene}:${effect.to.room} does not exist`);
    }
  };
  for (const node of nodes) {
    const where = `node ${node.id}`;
    checkEffects(where, node.enter);
    if (node.mainTask !== undefined && (node.mainTask < 0 || node.mainTask >= world.mainTaskCount))
      problems.push(`${where}: main task ${node.mainTask} does not exist`);
    const cp = node.checkpoint;
    if (cp) {
      if (!world.rooms(cp.scene, cp.room))
        problems.push(`${where}: checkpoint room ${cp.scene}:${cp.room} does not exist`);
      else if (world.walkable && !world.walkable(cp.scene, cp.room, cp.x, cp.y))
        problems.push(
          `${where}: checkpoint ${cp.x},${cp.y} in ${cp.scene}:${cp.room} is not walkable`,
        );
    }
    const terminal = !!node.frontier || !!node.ending;
    if (!terminal && !(node.exits ?? []).length)
      problems.push(`${where}: no exit and not marked frontier/ending (the player would be stuck)`);
    for (const exit of node.exits ?? []) {
      const at = `${where} → ${exit.to}`;
      const next = graph.node(exit.to);
      if (!next) problems.push(`${at}: target node missing`);
      checkEffects(at, exit.do);
      const trigger = exit.on;
      if (trigger.kind === "cutsceneEnd" && !world.routes.has(trigger.route))
        problems.push(`${at}: cutscene route ${trigger.route} is not in routes.json`);
      const room = triggerRoom(trigger);
      if (room && !world.rooms(room.scene, room.room))
        problems.push(`${at}: trigger room ${room.scene}:${room.room} does not exist`);
      if ("group" in trigger && !world.group(trigger.scene, trigger.room, trigger.group))
        problems.push(
          `${at}: event group ${trigger.scene}:${trigger.room}:${trigger.group} is not in the event data`,
        );
      if (room && cp && !world.doors.reachable(cp.scene, cp.room).has(`${room.scene}:${room.room}`))
        problems.push(
          `${at}: ${room.scene}:${room.room} cannot be reached on foot from the checkpoint ${cp.scene}:${cp.room}`,
        );
      const before = node.mainTask ?? -1,
        after = next?.mainTask ?? before;
      if (next && after < before)
        problems.push(`${at}: main task goes backwards (${before} → ${after})`);
    }
  }
  // Reachability from the start, and a way out of every node.
  const forward = new Set<string>(),
    queue = [graph.document.start];
  while (queue.length) {
    const id = queue.shift()!;
    if (forward.has(id)) continue;
    forward.add(id);
    for (const exit of graph.node(id)?.exits ?? []) queue.push(exit.to);
  }
  for (const node of nodes)
    if (!forward.has(node.id))
      problems.push(`node ${node.id}: unreachable from ${graph.document.start}`);
  const canFinish = new Set(nodes.filter((n) => n.frontier || n.ending).map((n) => n.id));
  for (let changed = true; changed;) {
    changed = false;
    for (const node of nodes)
      if (!canFinish.has(node.id) && (node.exits ?? []).some((exit) => canFinish.has(exit.to))) {
        canFinish.add(node.id);
        changed = true;
      }
  }
  for (const node of nodes)
    if (!canFinish.has(node.id))
      problems.push(`node ${node.id}: can never reach an ending or a frontier (closed loop)`);
  return problems;
}
