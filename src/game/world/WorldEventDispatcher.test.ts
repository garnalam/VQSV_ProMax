// Data-driven dispatch: the decoded event binaries and kind-1 actor columns are the only
// source for triggers, doors and ledger writes, so these tests read the shipped catalog.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RoomAsset, WorldContract } from "../story/GameAssets";
import { StoryDataRegistry } from "../story/StoryDataRegistry";
import { SourceOpcodeInterpreter } from "../story/SourceOpcodeInterpreter";
import { DIRECTION_LEFT, DIRECTION_RIGHT } from "./MapCollision";
import { EVENT_STATE_COMPLETE, EVENT_STATE_RETIRED, EventStateLedger } from "./EventStateLedger";
import {
  worldEventTriggers,
  worldGroupLedgerWrites,
  worldGroupStartsBattle,
} from "./WorldEventCatalog";
import { WorldEventDispatcher, type WorldView } from "./WorldEventDispatcher";
import {
  sourceDoors,
  sourceRoomDoors,
  sourceRoomPortals,
  transitionArrivalForTarget,
  type RoomDoor,
} from "./WorldTransition";

const data = JSON.parse(
  readFileSync("public/pack/story/world-contract.json", "utf8"),
) as WorldContract;
const rooms = (
  JSON.parse(readFileSync("public/pack/world/rooms.json", "utf8")) as {
    rooms: Record<string, RoomAsset>;
  }
).rooms;
const registry = new StoryDataRegistry(
  JSON.parse(readFileSync("public/pack/story/event-scenes.json", "utf8")),
);
const elderActor = { x: 200, y: 190, visible: true };
const view = (over: Partial<WorldView> = {}): WorldView => ({
  scene: 1,
  room: 1,
  x: 0,
  y: 0,
  direction: DIRECTION_RIGHT,
  activation: false,
  actorAt: () => undefined,
  supportsTarget: (scene, room) => !!rooms[`${scene}:${room}`],
  ...over,
});

describe("free-world dispatch read from the decoded catalog", () => {
  it("takes the bunny trigger rect from the op13 record the contract asserts", () => {
    const triggers = worldEventTriggers(registry, 1, 1);
    expect(triggers[0]).toMatchObject({
      kind: "rect",
      group: { scene: 1, room: 1, group: 0 },
      rect: data.trigger,
      gates: [],
    });
    expect(worldGroupStartsBattle(registry, data.battleGroup)).toBe(true);
  });
  it("gates the Elder interaction on the bunny group being complete", () => {
    const trigger = worldEventTriggers(registry, 1, 0).find(
      (candidate) => candidate.group.group === data.elderGroup.group,
    );
    expect(trigger).toMatchObject({
      kind: "actor",
      actorId: data.elderActor,
      gates: [{ opcode: 86, ref: { scene: 1, room: 1, group: 0 } }],
    });
    const ledger = new EventStateLedger(),
      dispatcher = new WorldEventDispatcher(registry, ledger);
    dispatcher.enterRoom(1, 0);
    const onElder = view({
      room: 0,
      x: elderActor.x,
      y: elderActor.y,
      activation: true,
      actorAt: (id) => (id === data.elderActor ? elderActor : undefined),
    });
    expect(dispatcher.probe(onElder)).toBeNull();
    ledger.op14CompleteEvent(1, 1, 0);
    expect(dispatcher.probe(onElder)).toMatchObject({
      kind: "event",
      trigger: { group: data.elderGroup },
    });
    // op16 waits for the activation input, unlike the rect triggers that probe every tick.
    expect(dispatcher.probe({ ...onElder, activation: false })).toBeNull();
  });
  it("dispatches branch offers and completions only in their JavaSE quest state", () => {
    const statuses: Record<number, number> = { 0: 1, 1: -1, 2: 1 };
    let ready = false;
    const ledger = new EventStateLedger(),
      dispatcher = new WorldEventDispatcher(
        registry,
        ledger,
        (task) => statuses[task] ?? -1,
        (_task, args) => ready && args[0] === 1 && args[10] === 68,
      ),
      actor = { x: 294, y: 175, visible: true },
      atNpc = view({
        room: 0,
        x: actor.x,
        y: actor.y,
        activation: true,
        actorAt: (id) => (id === 35 ? actor : undefined),
      });
    dispatcher.enterRoom(1, 0);
    // The offer's prerequisite columns (5–7) name 1:0:g8: closed until it is complete.
    expect(dispatcher.probe(atNpc)).toBeNull();
    ledger.op14CompleteEvent(1, 0, 8);
    expect(
      worldEventTriggers(registry, 1, 0).find((trigger) => trigger.group.group === 9),
    ).toMatchObject({
      kind: "actor",
      actorId: 35,
      branch: { taskId: 1, kind: "offer" },
    });
    expect(dispatcher.probe(atNpc)).toMatchObject({ trigger: { group: { group: 9 } } });
    statuses[1] = 1;
    expect(dispatcher.probe(atNpc)).toBeNull();

    dispatcher.enterRoom(2, 1);
    const completionActor = rooms["2:1"].actors.find((candidate) => candidate.id === 73)!;
    const atCompletionNpc = view({
      scene: 2,
      room: 1,
      x: completionActor.x,
      y: completionActor.y,
      activation: true,
      actorAt: (id) => (id === 73 ? completionActor : undefined),
    });
    expect(dispatcher.probe(atCompletionNpc)).toBeNull();
    ready = true;
    expect(dispatcher.probe(atCompletionNpc)).toMatchObject({
      trigger: { group: { scene: 2, room: 1, group: 6 }, branch: { kind: "completion" } },
    });
    statuses[1] = 3;
    expect(dispatcher.probe(atCompletionNpc)).toBeNull();
  });
  it("distinguishes Jones' main-task op43/op44 rows from branch quests", () => {
    const ledger = new EventStateLedger();
    let mainTask = 19,
      objectiveReady = false;
    const dispatcher = new WorldEventDispatcher(
        registry,
        ledger,
        () => -1,
        () => false,
        () => mainTask,
        (task, args) => objectiveReady && task === 20 && args[10] === 19,
      ),
      jones = rooms["4:5"].actors.find((actor) => actor.id === 34)!;
    dispatcher.enterRoom(4, 5);
    const atJones = view({
      scene: 4,
      room: 5,
      x: jones.x,
      y: jones.y,
      activation: true,
      actorAt: (id) => (id === 34 ? jones : undefined),
    });
    expect(dispatcher.probe(atJones)).toMatchObject({
      trigger: { group: { scene: 4, room: 5, group: 17 } },
    });
    ledger.op14CompleteEvent(4, 5, 17);
    mainTask = 20;
    expect(dispatcher.probe(atJones)).toBeNull();
    objectiveReady = true;
    expect(dispatcher.probe(atJones)).toMatchObject({
      trigger: { group: { scene: 4, room: 5, group: 18 } },
    });
  });
  it("keeps Niêm Thổ branch intermediate op43 rows on the active quest", () => {
    const ledger = new EventStateLedger(),
      statuses: Record<number, number> = { 12: 1, 17: 1 },
      dispatcher = new WorldEventDispatcher(
        registry,
        ledger,
        (task) => statuses[task] ?? -1,
        () => true,
      );
    ledger.op14CompleteEvent(11, 21, 0);
    ledger.op14CompleteEvent(4, 5, 7);
    dispatcher.enterRoom(4, 5);
    expect(worldEventTriggers(registry, 4, 5).find((t) => t.group.group === 6)).toMatchObject({
      branch: { taskId: 12, kind: "continuation" },
    });
    const gottardo = rooms["4:5"].actors.find((actor) => actor.id === 29)!,
      soldier = rooms["4:5"].actors.find((actor) => actor.id === 31)!;
    expect(
      dispatcher.probe(
        view({
          scene: 4,
          room: 5,
          x: gottardo.x,
          y: gottardo.y,
          activation: true,
          actorAt: (id) => (id === 29 ? gottardo : undefined),
        }),
      ),
    ).toMatchObject({ trigger: { group: { group: 6 } } });
    expect(
      dispatcher.probe(
        view({
          scene: 4,
          room: 5,
          x: soldier.x,
          y: soldier.y,
          activation: true,
          actorAt: (id) => (id === 31 ? soldier : undefined),
        }),
      ),
    ).toMatchObject({ trigger: { group: { group: 8 } } });
  });
  it("reads the relic's op24 shakes, op60 door, op59 torches and op47 reward target", () => {
    const compiler = new SourceOpcodeInterpreter(registry),
      events = (sceneId: number, roomIndex: number, groupIndex: number) =>
        compiler.compile({
          id: `relic-${sceneId}-${roomIndex}-${groupIndex}`,
          groups: [{ sceneId, roomIndex, groupIndex }],
          startEvent: 0,
        }).events;
    const phoenix = events(10, 14, 0);
    expect(phoenix.filter((e) => e.type === "shake")).toEqual([
      { type: "shake", mode: 0, repeats: 4 },
      { type: "shake", mode: 0, repeats: 1 },
      { type: "shake", mode: 0, repeats: 1 },
      { type: "shake", mode: 0, repeats: 1 },
      { type: "shake", mode: 0, repeats: 1 },
    ]);
    // The win's raw record 57 is the op36 reward, not the plain reading after op47.
    const consume = phoenix.find((e) => e.type === "consumeBattle")!;
    expect(consume).toMatchObject({ branchTargets: [57, 57, 0] });
    const reward = (consume as { next: number[] }).next[0];
    expect(phoenix[reward]).toMatchObject({ type: "grantPet" });
    expect(events(10, 13, 1).filter((e) => e.type === "actorCycle")).toEqual([
      { type: "actorCycle", ids: [1], modes: [1] },
      { type: "actorCycle", ids: [1], modes: [2] },
    ]);
    expect(worldEventTriggers(registry, 10, 13).find((t) => t.kind === "switches")).toMatchObject({
      group: { scene: 10, room: 13, group: 1 },
      actorIds: [2, 3],
    });
  });

  it("takes a branch choice's task id from op43, not op49 objective metadata", () => {
    const compiler = new SourceOpcodeInterpreter(registry),
      compile = (sceneId: number, roomIndex: number, groupIndex: number) =>
        compiler
          .compile({
            id: `branch-${sceneId}-${roomIndex}-${groupIndex}`,
            groups: [{ sceneId, roomIndex, groupIndex }],
            startEvent: 0,
          })
          .events.find((event) => event.type === "branchChoice");
    expect(compile(1, 0, 9)).toMatchObject({ type: "branchChoice", task: 1 });
    // op49's second short is 5 here, while the authored task is branch 16.
    expect(compile(2, 2, 1)).toMatchObject({ type: "branchChoice", task: 16 });
  });
  it("keeps the Bích Thủy supply and capture feature unlocks in the source program", () => {
    const compiler = new SourceOpcodeInterpreter(registry),
      compile = (sceneId: number, roomIndex: number, groupIndex: number) =>
        compiler.compile({
          id: `op66-${sceneId}-${roomIndex}-${groupIndex}`,
          groups: [{ sceneId, roomIndex, groupIndex }],
          startEvent: 0,
        }).events;
    expect(compile(11, 8, 1).filter((event) => event.type === "featureUnlock")).toEqual([
      { type: "featureUnlock", feature: 3 },
      { type: "featureUnlock", feature: 1 },
    ]);
    expect(compile(2, 2, 0)).toContainEqual({ type: "featureUnlock", feature: 5 });
  });
  it("keeps Nguyên Mộc quest flags, capture hiding and the op76 Niêm Thổ handoff", () => {
    const compiler = new SourceOpcodeInterpreter(registry),
      compile = (sceneId: number, roomIndex: number, groupIndex: number) =>
        compiler.compile({
          id: `world:nguyen-moc-${sceneId}-${roomIndex}-${groupIndex}`,
          groups: [{ sceneId, roomIndex, groupIndex }],
          startEvent: 0,
        }).events;
    expect(compile(3, 3, 2)).toContainEqual({ type: "sourceFlag", mode: 0, flag: 6 });
    expect(compile(3, 3, 8)).toContainEqual({ type: "sourceFlag", mode: 1, flag: 0 });
    expect(compile(3, 5, 0)).toContainEqual({ type: "hide", ids: [5] });
    expect(compile(3, 6, 3)).toContainEqual({
      type: "load",
      scene: 4,
      room: 0,
      x: 48,
      y: 160,
      updateWorld: true,
      direction: 2,
    });
  });
  it("re-arms a retired notice only after the player leaves its rect", () => {
    const ledger = new EventStateLedger(),
      dispatcher = new WorldEventDispatcher(registry, ledger);
    dispatcher.enterRoom(1, 0);
    const inNotice = view({ room: 0, x: 190, y: 300, direction: DIRECTION_LEFT });
    expect(dispatcher.probe(inNotice)).toMatchObject({
      kind: "event",
      trigger: { group: { scene: 1, room: 0, group: 1 } },
    });
    // The notice retires itself with op42, which keeps the group dispatchable, so its rect
    // only arms again once the player has left it. The follow-up notice shares the rect and
    // its op15 gate is satisfied by that retirement, so it takes the next tick instead.
    ledger.op42RepeatEvent(1, 0, 1);
    expect(ledger.sourceEventState(1, 0, 1)).toBe(EVENT_STATE_RETIRED);
    expect(dispatcher.probe(inNotice)).toMatchObject({
      trigger: { group: { scene: 1, room: 0, group: 4 } },
    });
    expect(dispatcher.probe(inNotice)).toBeNull();
    dispatcher.probe(view({ room: 0, x: 300, y: 100 }));
    expect(dispatcher.probe(inNotice)).toMatchObject({
      kind: "event",
      trigger: { group: { scene: 1, room: 0, group: 1 } },
    });
  });
  it("reads the reciprocal scene 1 doorways from the kind-1 actor columns", () => {
    const toRoom0 = sourceDoors(registry, 1, 1).find((door) => door.actorId === 37),
      toRoom1 = sourceDoors(registry, 1, 0).find((door) => door.actorId === 30);
    expect(toRoom0).toMatchObject({
      x: 19,
      y: 273,
      sourceDirection: 1,
      requiredDirection: DIRECTION_LEFT,
      target: { scene: 1, room: 0, actor: 30 },
    });
    expect(toRoom1).toMatchObject({
      x: 408,
      y: 273,
      sourceDirection: 3,
      requiredDirection: DIRECTION_RIGHT,
      target: { scene: 1, room: 1, actor: 37 },
    });
    for (const door of [...sourceDoors(registry, 1, 0), ...sourceDoors(registry, 1, 1)])
      if (rooms[`${door.target.scene}:${door.target.room}`])
        expect(
          rooms[`${door.target.scene}:${door.target.room}`].actors.some(
            (actor) => actor.id === door.target.actor,
          ),
        ).toBe(true);
  });
  it("arrives on the target marker facing inward, not on the authored coordinates", () => {
    expect(
      transitionArrivalForTarget(registry, rooms["1:0"], { scene: 1, room: 0, actor: 30 }),
    ).toEqual({ x: 376, y: 272, direction: DIRECTION_LEFT });
    expect(
      transitionArrivalForTarget(registry, rooms["1:1"], { scene: 1, room: 1, actor: 37 }),
    ).toEqual({ x: 48, y: 272, direction: DIRECTION_RIGHT });
    expect(
      transitionArrivalForTarget(registry, rooms["1:1"], { scene: 1, room: 1, actor: 999 }),
    ).toBeNull();
  });
  it("walks through a doorway only with the facing it asks for and never back into itself", () => {
    const ledger = new EventStateLedger(),
      dispatcher = new WorldEventDispatcher(registry, ledger);
    dispatcher.enterRoom(1, 1);
    const atDoor = view({ x: 19, y: 273, direction: DIRECTION_RIGHT });
    expect(dispatcher.probe(atDoor)).toBeNull();
    const door = dispatcher.probe({ ...atDoor, direction: DIRECTION_LEFT });
    expect(door).toMatchObject({ kind: "door", door: { target: { scene: 1, room: 0 } } });
    if (door?.kind !== "door") throw new Error("doorway did not dispatch");
    dispatcher.markArrival(door.door);
    dispatcher.enterRoom(1, 0);
    // Standing on the arrival marker keeps the return doorway closed for that tick.
    expect(
      dispatcher.probe(view({ room: 0, x: 408, y: 273, direction: DIRECTION_RIGHT })),
    ).toBeNull();
    expect(
      dispatcher.probe(view({ room: 0, x: 300, y: 100, direction: DIRECTION_RIGHT })),
    ).toBeNull();
    expect(
      dispatcher.probe(view({ room: 0, x: 408, y: 273, direction: DIRECTION_RIGHT })),
    ).toMatchObject({ kind: "door", door: { target: { scene: 1, room: 1, actor: 37 } } });
    expect(
      dispatcher.probe(view({ room: 0, x: 408, y: 273, supportsTarget: () => false })),
    ).toBeNull();
  });
  it("runs a gated chain link the tick the link before it ends, without any player action", () => {
    const ledger = new EventStateLedger(),
      dispatcher = new WorldEventDispatcher(registry, ledger);
    dispatcher.enterRoom(1, 0);
    const link = worldEventTriggers(registry, 1, 0).find(
      (candidate) => candidate.group.group === 3,
    );
    expect(link).toMatchObject({
      kind: "auto",
      gates: [{ opcode: 15, ref: { scene: 1, room: 0, group: 2 } }],
    });
    // Standing away from every rect and with no key pressed: the gate alone decides.
    const standing = view({ room: 0, x: 300, y: 100 });
    expect(dispatcher.probe(standing)).toBeNull();
    ledger.op14CompleteEvent(1, 0, 2);
    expect(dispatcher.probe(standing)).toMatchObject({
      kind: "event",
      trigger: { group: { scene: 1, room: 0, group: 3 } },
    });
    // The link's own op14 hands the chain to the next link, and a link never plays twice.
    ledger.op14CompleteEvent(1, 0, 3);
    expect(dispatcher.probe(standing)).toMatchObject({
      kind: "event",
      trigger: { group: { scene: 1, room: 0, group: 6 } },
    });
    ledger.op14CompleteEvent(1, 0, 6);
    expect(dispatcher.probe(standing)).toBeNull();
  });
  it("leaves a gated group with no op14 of its own unddispatchable", () => {
    // Without its own ending record a link would stay fresh and restart every tick, so the
    // catalog does not treat it as one.
    const cyclic = new StoryDataRegistry({
      format: "test",
      version: 1,
      generatedFrom: "test",
      sceneCount: 1,
      scenes: [
        {
          format: "test",
          sceneId: 1,
          sourceFile: "test",
          blockCount: 1,
          blockSizes: [],
          rooms: [
            {
              roomIndex: 4,
              roomName: "",
              blockSize: 0,
              roomStart: 0,
              stringPool: [],
              actors: [],
              eventGroups: [
                {
                  group_index: 0,
                  scene_id: 1,
                  room_index: 4,
                  world_key: 0,
                  record_count: 2,
                  records: [
                    {
                      opcode: 15,
                      total_arg_count: 3,
                      short_args: [1, 0, 2],
                      string_args: [],
                    },
                    { opcode: 45, total_arg_count: 1, short_args: [7], string_args: [] },
                  ],
                },
              ],
              postActorStrings: [],
              unknownAb: 0,
              unknownSkip: 0,
            },
          ],
        },
      ],
    });
    expect(worldEventTriggers(cyclic, 1, 4)).toEqual([]);
  });
  it("stops the bunny ledger walk at op14 so the trailing op42 cannot retire the group", () => {
    expect(worldGroupLedgerWrites(registry, data.battleGroup)).toEqual([
      { kind: "markComplete", ref: { scene: 1, room: 0, group: 1 } },
      { kind: "completeOwn" },
    ]);
    expect(worldGroupLedgerWrites(registry, data.elderGroup)).toEqual([{ kind: "completeOwn" }]);
    expect(worldGroupLedgerWrites(registry, { scene: 1, room: 0, group: 1 })).toEqual([
      { kind: "retireOwn" },
    ]);
    const ledger = new EventStateLedger();
    for (const write of worldGroupLedgerWrites(registry, data.battleGroup))
      if (write.kind === "markComplete")
        ledger.op23MarkEventComplete(write.ref.scene, write.ref.room, write.ref.group);
      else if (write.kind === "completeOwn") ledger.op14CompleteEvent(1, 1, 0);
      else ledger.op42RepeatEvent(1, 1, 0);
    expect(ledger.sourceEventState(1, 1, 0)).toBe(EVENT_STATE_COMPLETE);
    expect(ledger.sourceEventState(1, 0, 1)).toBe(EVENT_STATE_COMPLETE);
  });
});

const cvRegistry = StoryDataRegistry.combine(
  JSON.parse(readFileSync("public/pack/story/event-scenes.json", "utf8")),
  JSON.parse(readFileSync("public/pack/story/cau-vong-event-scenes.json", "utf8")),
);
const cvDoorAt = (room: number, row: number): RoomDoor => {
  const door = sourceRoomDoors(cvRegistry, 98, room).find((candidate) => candidate.row === row);
  if (!door) throw new Error(`Cầu Vồng room ${room} has no usable door row ${row}`);
  return door;
};
const onTile = (door: RoomDoor) => ({ x: door.x * 20 + 10, y: door.y * 20 + 10 });

describe("Cầu Vồng walk-in connections read straight from the /4 table", () => {
  it("takes the doorway on the tile itself and from any facing", () => {
    const ledger = new EventStateLedger(),
      dispatcher = new WorldEventDispatcher(cvRegistry, ledger);
    dispatcher.enterRoom(98, 1);
    const door = cvDoorAt(1, 0);
    expect(door).toMatchObject({ x: 2, y: 0, target: { scene: 98, room: 0, entry: 1 } });
    expect(
      dispatcher.probe(view({ scene: 98, room: 1, direction: DIRECTION_LEFT, ...onTile(door) })),
    ).toMatchObject({ kind: "room-door", door });
    // The inclusive source point, not the padded 16px body box: one tile-width away is off the pad.
    expect(dispatcher.probe(view({ scene: 98, room: 1, x: door.x * 20 - 11, y: 10 }))).toBeNull();
    expect(dispatcher.probe(view({ scene: 98, room: 1, x: 60, y: 20 }))).toMatchObject({
      kind: "room-door",
    });
    expect(dispatcher.probe(view({ scene: 98, room: 1, x: 61, y: 21 }))).toBeNull();
  });
  it("keeps Java's four chapter gates shut until their own event group completes", () => {
    const ledger = new EventStateLedger(),
      dispatcher = new WorldEventDispatcher(cvRegistry, ledger);
    dispatcher.enterRoom(98, 3);
    const toGates = cvDoorAt(3, 4),
      toAcademy = cvDoorAt(3, 0);
    expect(dispatcher.probe(view({ scene: 98, room: 3, ...onTile(toGates) }))).toBeNull();
    expect(dispatcher.probe(view({ scene: 98, room: 3, ...onTile(toAcademy) }))).toBeNull(); // the classroom skips every exit but the one to the four gates
    ledger.op14CompleteEvent(98, 3, 102);
    expect(dispatcher.probe(view({ scene: 98, room: 3, ...onTile(toGates) }))).toMatchObject({
      kind: "room-door",
      door: { target: { room: 9 } },
    });
    expect(dispatcher.probe(view({ scene: 98, room: 3, ...onTile(toAcademy) }))).toBeNull();
  });
  it("is not held behind the Liệt Hỏa arrival latch and needs the target map in the pack", () => {
    const ledger = new EventStateLedger(),
      dispatcher = new WorldEventDispatcher(cvRegistry, ledger);
    dispatcher.enterRoom(98, 1);
    const door = cvDoorAt(1, 4);
    // The chapter's route owner arms that latch on entry but never reads it, so it cannot close a
    // doorway here the way it holds a Liệt Hỏa return open for one tick.
    dispatcher.markArrival(sourceDoors(registry, 1, 1)[0]);
    expect(dispatcher.probe(view({ scene: 98, room: 1, ...onTile(door) }))).toMatchObject({
      kind: "room-door",
      door,
    });
    expect(
      dispatcher.probe(view({ scene: 98, room: 1, supportsTarget: () => false, ...onTile(door) })),
    ).toBeNull();
  });
  it("reads the chapter's pad table from the same probe as its doorways", () => {
    const ledger = new EventStateLedger(),
      dispatcher = new WorldEventDispatcher(cvRegistry, ledger);
    dispatcher.enterRoom(98, 9);
    const pads = sourceRoomPortals(98, 9);
    expect(pads.map((pad) => [pad.x, pad.y, pad.target.room])).toEqual([
      [17, 20, 12],
      [2, 20, 21],
      [2, 4, 16],
      [17, 4, 24],
    ]);
    // Only the pad to the highland is open on a fresh save; the other three carry a flag column.
    expect(
      dispatcher.probe(view({ scene: 98, room: 9, x: 17 * 20 + 10, y: 20 * 20 + 10 })),
    ).toMatchObject({ kind: "room-portal", portal: pads[0] });
    expect(
      dispatcher.probe(view({ scene: 98, room: 9, x: 2 * 20 + 10, y: 20 * 20 + 10 })),
    ).toBeNull();
    for (const event of [101, 103, 104]) ledger.op14CompleteEvent(98, 9, event);
    expect(
      dispatcher.probe(view({ scene: 98, room: 9, x: 2 * 20 + 10, y: 20 * 20 + 10 })),
    ).toMatchObject({ kind: "room-portal", portal: pads[1] });
    expect(
      dispatcher.probe(
        view({ scene: 98, room: 9, supportsTarget: () => false, x: 17 * 20 + 10, y: 20 * 20 + 10 }),
      ),
    ).toBeNull();
  });
});

describe("rect triggers that share one rect share one latch (JavaSE legendaryTriggerLatched)", () => {
  // Linh Quang Lộc (10:11 g0 → g1) and Tương Quân Giải (10:0 g1 → g3): the knockout ends the first
  // group with the hero still on the rect; its follow-up waits until he steps off and back on.
  for (const [room, first, second, x, y] of [
    [11, 0, 1, 112, 244],
    [0, 1, 3, 120, 100],
  ] as const)
    it(`10:${room} g${second} waits for the hero to leave the rect g${first} fired on`, () => {
      const ledger = new EventStateLedger(),
        dispatcher = new WorldEventDispatcher(registry, ledger);
      dispatcher.enterRoom(10, room);
      const on = view({ scene: 10, room, x, y }),
        off = view({ scene: 10, room, x, y: y + 80 });
      expect(dispatcher.probe(on)).toMatchObject({
        kind: "event",
        trigger: { group: { scene: 10, room, group: first } },
      });
      ledger.op14CompleteEvent(10, room, first);
      expect(dispatcher.probe(on)).toBeNull();
      expect(dispatcher.probe(off)).toBeNull();
      expect(dispatcher.probe(on)).toMatchObject({
        kind: "event",
        trigger: { group: { scene: 10, room, group: second } },
      });
    });
});
