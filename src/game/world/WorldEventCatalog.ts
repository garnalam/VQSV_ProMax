// The decoded event binaries already carry the free-world trigger records, so the
// catalog is read from StoryDataRegistry instead of being authored per scene:
// leading op15/op86 (and op78, a list of op15s) records are preconditions, op13 is a player-rect trigger and
// op16 is an actor-interaction trigger. JavaSE authors the same triples as
// Op13FreeWorldTrigger / ActorInteractionFreeWorldTrigger in vqsv/game/VqsvScriptBlocks.java.
// A group with preconditions but no trigger of its own is a chain link: the original scan
// (modules/source_code/decoded/decompiled_source_cfr/game/e.java:141-296) treats the satisfied
// op15/op86 test itself as the reason to run, so the link fires as soon as the link before it ends.
import { groupActivationActor } from "../story/SourceOpcodeInterpreter";
import { ENTRY_RULES, NO_REPLAY, TRIGGER_RULES } from "./JavaRoomRules";
import type { StoryDataRegistry } from "../story/StoryDataRegistry";
import type { SourceRect } from "./WorldInteractionEngine";

export type GroupRef = { scene: number; room: number; group: number };
export type EventGate = { ref: GroupRef; opcode: 15 | 86 };
export type BranchTriggerGate = {
  taskId: number;
  kind: "offer" | "continuation" | "completion";
  sourceArgs: number[];
};
export type WorldEventTrigger = {
  group: GroupRef;
  gates: EventGate[];
  branch?: BranchTriggerGate;
  /** A gym leader's challenge only opens on the main task its op45 closes (`mainTaskProgress`). */
  mainTask?: number;
  /** `JavaRoomRules`: the main task must be at least this, and this badge won. */
  minTask?: number;
  badge?: number;
  /** op59 actors are broken by stepping on them, not by 5 (`JavaRoomRules` touch). */
  touch?: true;
} & (
  | { kind: "rect"; rect: SourceRect }
  | { kind: "actor"; actorId: number }
  /**
   * A link in a scripted chain: gated, with no position or key of its own, so it runs the
   * moment its gates pass. Java's per-tick scan makes the gate itself the trigger.
   */
  | { kind: "auto" }
  /**
   * op59: a row of torches (`RelicSwitch`): the hero lights each listed actor with 5, and the group
   * runs once every one of them burns.
   */
  | { kind: "switches"; actorIds: number[] }
  /**
   * op57 `[target, gateX, gateY, trigger]` (`BlcC2Runtime.RESET_CONTRACTS`): 5 on the trigger actor
   * while the target block is away from its gate tile runs the group, whose op58 puts it back.
   */
  | { kind: "contact"; target: number; gateX: number; gateY: number; triggerActor: number }
);

/** Scene 9: the Đạo quán rooms. */
const GYM_SCENE = 9;

const groupRef = (args: number[]): GroupRef | undefined => {
  const [scene, room, group] = args;
  return [scene, room, group].every((value) => Number.isInteger(value))
    ? { scene, room, group }
    : undefined;
};

/** Triggers in group-declaration order: Java lets the first firing branch win. */
export function worldEventTriggers(
  registry: StoryDataRegistry,
  scene: number,
  room: number,
): WorldEventTrigger[] {
  // The opcode numbers below are the Liệt Hỏa dialect. Cầu Vồng reuses them for other commands, and
  // its own compiler is not written yet, so its groups stay unread rather than misread.
  if (registry.dialect(scene) !== "lh") return [];
  const triggers: WorldEventTrigger[] = [];
  for (const group of registry.room(scene, room)?.eventGroups ?? []) {
    const gates: EventGate[] = [];
    for (const record of group.records) {
      const args = record.short_args;
      if (record.opcode === 15 || record.opcode === 86) {
        const ref = groupRef(args);
        if (!ref) break;
        gates.push({ ref, opcode: record.opcode });
        continue;
      }
      // op78 is op15 over a list: its three strings are the scenes, rooms and groups of every
      // group that must be over (complete or retired), e.g. the dungeon's three captures that
      // free 5:6's Hắc Tinh Thạch whether each was won or given up (`capturesTerminal`).
      if (record.opcode === 78) {
        const [scenes, rooms, groups] = record.string_args.map((arg) =>
          arg.text.split(",").map(Number),
        );
        if (!scenes?.length || scenes.length !== rooms?.length || scenes.length !== groups?.length)
          break;
        for (let i = 0; i < scenes.length; i++) {
          const ref = groupRef([scenes[i], rooms[i], groups[i]]);
          if (!ref) break;
          gates.push({ ref, opcode: 15 });
        }
        continue;
      }
      // op79 `[scene, room, group, actor]` is op86 and op16 in one record: 5 on the actor once that
      // group is complete (`NiemThoC2Runtime`: Jones' exchange, 4:5:g15, after his handoff g18).
      if (record.opcode === 79) {
        const ref = groupRef(args);
        if (!ref || !Number.isInteger(args[3])) break;
        triggers.push({
          kind: "actor",
          group: { scene, room, group: group.group_index },
          gates: [...gates, { ref, opcode: 86 }],
          actorId: args[3],
        });
        break;
      }
      // Branch tasks carry their own actor activation in op43/op44 rather than a separate op16.
      // [task, ..., scene, room, actor, ...] is shared by the offer and completion records.
      if (
        (record.opcode === 43 || record.opcode === 44) &&
        Number.isInteger(args[0]) &&
        Number.isInteger(args[4])
      ) {
        triggers.push({
          kind: "actor",
          group: { scene, room, group: group.group_index },
          gates,
          actorId: args[4],
          branch: {
            taskId: args[0],
            kind:
              record.opcode === 44
                ? "completion"
                : group.records.some((next) => next.opcode === 49)
                  ? "offer"
                  : "continuation",
            sourceArgs: [...args],
          },
        });
        break;
      }
      if (record.opcode === 57 && args.length >= 4 && args.slice(0, 4).every(Number.isInteger)) {
        triggers.push({
          kind: "contact",
          group: { scene, room, group: group.group_index },
          gates,
          target: args[0],
          gateX: args[1],
          gateY: args[2],
          triggerActor: args[3],
        });
        break;
      }
      // op61 is op59's switch row (`XhtC1Runtime.tryPuzzleSwitches`): the same 5-to-light cycle,
      // flag and settled state, opening an op60 door instead of lighting a torch.
      if (record.opcode === 59 || record.opcode === 61) {
        const actorIds = (record.string_args[0]?.text ?? "").split(",").filter(Boolean).map(Number);
        if (actorIds.length && actorIds.every(Number.isInteger))
          triggers.push({
            kind: "switches",
            group: { scene, room, group: group.group_index },
            gates,
            actorIds,
          });
        break;
      }
      if (record.opcode === 13 && args.length === 4 && args.every(Number.isInteger))
        triggers.push({
          kind: "rect",
          group: { scene, room, group: group.group_index },
          gates,
          rect: { x: args[0], y: args[1], width: args[2], height: args[3] },
        });
      else if (record.opcode === 16 && args.length === 1 && Number.isInteger(args[0]))
        triggers.push({
          kind: "actor",
          group: { scene, room, group: group.group_index },
          gates,
          actorId: args[0],
        });
      // A chain link needs its own op14: without one it would never leave the dispatchable
      // states and would restart every tick. Every gated link in the pack has one.
      else if (gates.length > 0 && group.records.some((next) => next.opcode === 14))
        triggers.push({
          kind: "auto",
          group: { scene, room, group: group.group_index },
          gates,
        });
      break;
    }
  }
  // The gym leaders (`HacThachC2/C3`, `PhoenixC3` `updateGymRect`): in a Đạo quán room the group
  // that hands out the badge (op53) waits for every other fight in the room, and, when its op45
  // advances the main line, for the task just before it. A leader the source already gates
  // (Bích Thủy's op86, Nguyên Mộc's op15) keeps its own condition.
  if (scene === GYM_SCENE)
    for (const trigger of triggers) {
      const records = registry.group(scene, room, trigger.group.group)?.records ?? [];
      if (trigger.gates.length > 0 || !records.some((record) => record.opcode === 53)) continue;
      for (const other of registry.room(scene, room)?.eventGroups ?? [])
        if (
          other.group_index !== trigger.group.group &&
          other.records.some((record) => record.opcode === 32)
        )
          trigger.gates.push({ ref: { scene, room, group: other.group_index }, opcode: 86 });
      const task = records.find((record) => record.opcode === 45)?.short_args[0];
      if (task !== undefined) trigger.mainTask = task - 1;
    }
  // `JavaRoomRules`: what the room's JavaSE runtime adds to (or takes from) the source triggers.
  const rules = TRIGGER_RULES[`${scene}:${room}`] ?? [];
  for (const rule of rules)
    for (const trigger of triggers) {
      if (trigger.group.group !== rule.group) continue;
      const refs = [
        ...(rule.after ?? []).map((group) => ({ scene, room, group })),
        ...(rule.afterRefs ?? []),
      ];
      for (const ref of refs)
        if (
          !trigger.gates.some(
            (gate) =>
              gate.ref.scene === ref.scene &&
              gate.ref.room === ref.room &&
              gate.ref.group === ref.group,
          )
        )
          trigger.gates.push({ ref, opcode: 86 });
      if (rule.mainTask !== undefined) trigger.mainTask = rule.mainTask;
      if (rule.minTask !== undefined) trigger.minTask = rule.minTask;
      if (rule.badge !== undefined) trigger.badge = rule.badge;
      if (rule.touch) trigger.touch = true;
      if (rule.auto) Object.assign(trigger, { kind: "auto" });
      if (rule.actor !== undefined) Object.assign(trigger, { kind: "actor", actorId: rule.actor });
    }
  const never = new Set(rules.filter((rule) => rule.never).map((rule) => rule.group));
  return triggers.filter((trigger) => !never.has(trigger.group.group));
}

/** op32 starts a source battle, which the world runs through its interactive battle frame. */
export function worldGroupStartsBattle(registry: StoryDataRegistry, ref: GroupRef): boolean {
  return (
    registry
      .group(ref.scene, ref.room, ref.group)
      ?.records.some((record) => record.opcode === 32) ?? false
  );
}

/**
 * The actor op67 names as the owner of the group's battle (else the actor the group was activated
 * on: its op16, or an op43/op44 head's NPC), or null when the group declares none.
 * op67 comes first in the record list and its operand is the actor id, so the battle can be found in
 * the descriptor table without running the interpreter that will later play the group.
 */
export function worldGroupBattleActor(registry: StoryDataRegistry, ref: GroupRef): number | null {
  const records = registry.group(ref.scene, ref.room, ref.group)?.records ?? [];
  if (!records.some((record) => record.opcode === 32)) return null;
  // Without op67 the fight is the activated actor's (`worldEventActor`).
  return (
    records.find((record) => record.opcode === 67)?.short_args[0] ??
    groupActivationActor(records) ??
    -1
  );
}

export type GroupLedgerWrite =
  { kind: "markComplete"; ref: GroupRef } | { kind: "completeOwn" } | { kind: "retireOwn" };

/**
 * Ledger records in execution order. op14 ends the group, so the records that follow it
 * in the binary are not reached - the same stop the story interpreter makes. Battle groups
 * run through the interactive battle frame, so their writes are applied by the world.
 */
export function worldGroupLedgerWrites(
  registry: StoryDataRegistry,
  ref: GroupRef,
): GroupLedgerWrite[] {
  const writes: GroupLedgerWrite[] = [];
  for (const record of registry.group(ref.scene, ref.room, ref.group)?.records ?? []) {
    if (record.opcode === 23) {
      const other = groupRef(record.short_args);
      if (other) writes.push({ kind: "markComplete", ref: other });
    } else if (record.opcode === 14) {
      writes.push({ kind: "completeOwn" });
      break;
    } else if (record.opcode === 42) writes.push({ kind: "retireOwn" });
  }
  return writes;
}

/** `PhoenixC1Runtime.switchFlag`: the persistent world flag a lit torch writes. */
export function switchFlag(scene: number, room: number, actorId: number): number {
  return 300000 + scene * 10000 + room * 100 + actorId;
}

/**
 * The actor states a room's finished groups leave behind (`reconcileRoomEntry`): every listed
 * torch of a completed op59 group burns (state 2), and an op60 actor keeps the last state its
 * completed group gave it — the relic door stays open.
 */
export function settledActorStates(
  registry: StoryDataRegistry,
  scene: number,
  room: number,
  complete: (group: number) => boolean,
): Map<number, number> {
  const states = new Map<number, number>();
  for (const group of registry.room(scene, room)?.eventGroups ?? []) {
    if (!complete(group.group_index)) continue;
    for (const record of group.records) {
      const list = (index: number) =>
        (record.string_args[index]?.text ?? "").split(",").filter(Boolean).map(Number);
      if (record.opcode === 59 || record.opcode === 61) for (const id of list(0)) states.set(id, 2);
      if (record.opcode === 60) {
        const ids = list(0),
          modes = list(1);
        ids.forEach((id, i) => states.set(id, modes[i] ?? modes.at(-1) ?? 0));
      }
    }
  }
  return states;
}

/**
 * What a room's finished groups committed with op56 (`VqsvSourceEffects.op56ActorVisibility`), as
 * the chapter runtimes' `reconcileRoomEntry` rebuild it on every load: mode 1 hides an actor for
 * good (5:6's captured pets, 6:1's Sophie at the altar), mode 0 shows it facing its listed
 * direction. The groups replay in the order their same-room gates (op15/op86) force — 2:5:g0 waits
 * on 2:5:g2, so g2's reveal comes first and g0's hide wins — then by index.
 */
export function committedActorVisibility(
  registry: StoryDataRegistry,
  scene: number,
  room: number,
  complete: (group: number) => boolean,
  completeRef?: (ref: GroupRef) => boolean,
): Map<number, { visible: boolean; direction?: number; state?: number }> {
  const skip = NO_REPLAY[`${scene}:${room}`] ?? [],
    groups = (registry.room(scene, room)?.eventGroups ?? []).filter(
      (group) => complete(group.group_index) && !skip.includes(group.group_index),
    ),
    byIndex = new Map(groups.map((group) => [group.group_index, group])),
    ordered: typeof groups = [],
    placed = new Set<number>(),
    visiting = new Set<number>();
  const place = (group: (typeof groups)[number]): void => {
    if (placed.has(group.group_index) || visiting.has(group.group_index)) return;
    visiting.add(group.group_index);
    for (const record of group.records) {
      const [gateScene, gateRoom, gateGroup] = record.short_args;
      if (
        (record.opcode === 15 || record.opcode === 86) &&
        gateScene === scene &&
        gateRoom === room
      ) {
        const before = byIndex.get(gateGroup);
        if (before) place(before);
      }
    }
    visiting.delete(group.group_index);
    placed.add(group.group_index);
    ordered.push(group);
  };
  for (const group of groups) place(group);
  const committed = new Map<number, { visible: boolean; direction?: number; state?: number }>();
  for (const group of ordered)
    for (const record of group.records) {
      if (record.opcode !== 56) continue;
      const mode = record.short_args[0],
        list = (index: number) =>
          (record.string_args[index]?.text ?? "").split(",").filter(Boolean).map(Number),
        ids = list(0),
        directions = list(1);
      ids.forEach((id, i) => {
        if (mode === 0)
          committed.set(id, {
            visible: true,
            direction: directions[Math.min(i, directions.length - 1)] ?? 0,
          });
        else if (mode === 1) committed.set(id, { visible: false });
      });
    }
  for (const rule of ENTRY_RULES[`${scene}:${room}`] ?? []) {
    if (rule.ref ? !completeRef?.(rule.ref) : !complete(rule.after)) continue;
    if (rule.unless !== undefined && complete(rule.unless)) continue;
    for (const id of rule.hide ?? []) committed.set(id, { visible: false });
    for (const { id, state, direction } of rule.show ?? [])
      committed.set(id, { visible: true, direction, state });
  }
  return committed;
}

/**
 * Kind-1 doors a room's own op60 opens (`PhoenixC1Runtime`: the relic door to 10:14 waits for
 * 10:13:1): the actor and the group that opens it.
 */
export function op60Doors(
  registry: StoryDataRegistry,
  scene: number,
  room: number,
): Map<number, number> {
  const doors = new Map<number, number>(),
    rows = registry.room(scene, room)?.actors ?? [];
  for (const group of registry.room(scene, room)?.eventGroups ?? [])
    for (const record of group.records)
      if (record.opcode === 60)
        for (const id of (record.string_args[0]?.text ?? "").split(",").filter(Boolean).map(Number))
          if (rows[id]?.kind === 1 && !doors.has(id)) doors.set(id, group.group_index);
  return doors;
}
