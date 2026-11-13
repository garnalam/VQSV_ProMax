import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GameData } from "../../data/GameData";
import { plantStatusStrip } from "../../dev/statusStripRig";
import { Pack } from "../../pack/Pack";
import { CURRENT_SAVE_VERSION } from "../../persistence/save/GameSave";
import { PetStatCalculator } from "../battle/PetStatCalculator";
import {
  COMBINED_TEXT,
  HP_FIELD_TEXT,
  SHIELD_FIELD_TEXT,
  blueShieldPixels,
  redHpPixels,
  shieldTrackText,
  shieldTrackUnit,
} from "../battle/ShieldTrack";
import { loadBattleRules } from "../battle/BattleRules";
import { BUFF_BANK } from "../battle/StatusState";
import type { RoomAsset, WorldContract } from "../story/GameAssets";
import { StoryDataRegistry } from "../story/StoryDataRegistry";
import { WorldRuntime, type WorldSources } from "./WorldRuntime";
import { MAP_LOADING_TOTAL_TICKS } from "./MapLoadingRuntime";
import { BADGE_THUY_LAM } from "./WorldFlags";
import { EVENT_STATE_COMPLETE, EVENT_STATE_RETIRED } from "./EventStateLedger";
import { DIRECTION_DOWN, DIRECTION_LEFT, DIRECTION_UP, type MapCollision } from "./MapCollision";
import { roomDoorArrival, roomDoorRow } from "./WorldTransition";
import { StoryRuntime, type StorySceneAdapter } from "../story/StoryRuntime";
import { worldEventTriggers } from "./WorldEventCatalog";

vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "public",
    decodeURIComponent(input.replace(/^\//, "")),
  );
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(readFileSync(file, "utf8")),
  };
});

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
const room = (scene: number, index: number) => rooms[`${scene}:${index}`];
const collisions = new Map<number, MapCollision>();
const collision = (mapId: number): MapCollision | undefined => {
  if (!collisions.has(mapId))
    collisions.set(
      mapId,
      JSON.parse(
        readFileSync(`public/pack/world/maps/${mapId}/collision.json`, "utf8"),
      ) as MapCollision,
    );
  return collisions.get(mapId);
};
const gameData = new GameData(await Pack.load());
const traitBattle = await gameData.goldenTraitBattle();
const sources = {
  room,
  collision,
  registry,
  animationTicks: () => 1,
  petStats: await PetStatCalculator.load(gameData),
  battleRules: await loadBattleRules(gameData),
};
/** The same world engine over both scripts' scenes, so the Cầu Vồng chapter's tables are readable. */
const cvRegistry = StoryDataRegistry.combine(
  registry.document,
  JSON.parse(readFileSync("public/pack/story/cau-vong-event-scenes.json", "utf8")),
);
const cvSources = { ...sources, registry: cvRegistry };
const cvWorld = (
  room: number,
  x: number,
  y: number,
  direction = 2,
  extra: Partial<WorldSources> = {},
) => {
  const base = new WorldRuntime(data, sources).snapshot();
  const runtime = new WorldRuntime(
    data,
    { ...cvSources, ...extra },
    {
      ...base,
      location: { sceneId: 98, roomIndex: room, x, y, direction },
    },
  );
  settleLoading(runtime);
  return runtime;
};
/** The host's branch: while the source load screen runs it owns the tick and the world does not step. */
function settleLoading(runtime: WorldRuntime): void {
  const ticks = runtime.tickCount;
  for (let i = 0; i < 64 && runtime.mapLoading; i++) expect(runtime.tickMapLoading()).toBe(true);
  expect(runtime.tickCount).toBe(ticks);
}
/**
 * Village group `1:0:3` waits on op38, so the chain only continues where the hero's up-facing probe
 * overlaps one of the three starters. The middle starter sits two four-pixel steps north of the
 * Elder's tile, so this walks him there with the real movement key and presses the key there.
 */
function walkUpToStarter(runtime: WorldRuntime): void {
  for (let i = 0; i < 2; i++) runtime.tick(["holdUp"]);
  runtime.tick(["confirm"]);
}
const enterBattle = (runtime: WorldRuntime) => {
  runtime.player.x = data.trigger.x;
  runtime.player.y = data.trigger.y;
  runtime.tick([]);
  expect(runtime.phase).toBe("battleEntry");
  // The Bunny's op32 is `[0, 0]`: the two half bars.
  expect(runtime.battleEntryMode).toBe(0);
  for (let i = 0; i < 25; i++) runtime.tick([]);
  expect(runtime.phase).toBe("battle");
};
const attackBunny = (runtime: WorldRuntime) => {
  // The Bunny stands above its band after the first strike because the round-end pass heals it from 44
  // back to 71, which is above weakHp; Java's RESET_ROUND does the same, so the tutorial needs two
  // actions to bring it below the capture threshold.
  runtime.tick(["confirm"]);
  expect(runtime.battleStage).toBe("skillList");
  expect(runtime.battle?.ui.rows.map((row) => row.name)).toEqual([
    "Điện giật",
    "Điện năng chuyển đổi",
  ]);
  runtime.tick(["confirm"]);
  expect(runtime.battleStage).toBe("skillAction");
  expect(runtime.pets[0].skillPp?.[0]).toBe(29);
  for (let i = 0; i < 100 && runtime.battleStage === "skillAction"; i++) runtime.tick([]);
  expect(runtime.battleStage).toBe("fight");
  expect(runtime.opponentHp).toBeLessThan(data.opponent.maxHp);
  runtime.tick(["confirm"]);
  expect(runtime.battleStage).toBe("skillList");
  runtime.tick(["confirm"]);
  expect(runtime.battleStage).toBe("skillAction");
  expect(runtime.pets[0].skillPp?.[0]).toBe(28);
  for (let i = 0; i < 100 && runtime.battleStage === "skillAction"; i++) runtime.tick([]);
  expect(runtime.battleStage).toBe("weak");
  expect(runtime.opponentHp).toBeLessThan(data.opponent.maxHp);
};
const beginCapture = (runtime: WorldRuntime) => {
  attackBunny(runtime);
  runtime.tick(["confirm"]);
  expect(runtime.battleStage).toBe("sealList");
  runtime.tick(["confirm"]);
  expect(runtime.battleStage).toBe("captureFail");
};
const completeBattle = (runtime: WorldRuntime) => {
  beginCapture(runtime);
  const failTicks =
    data.capture.durations[0] +
    data.capture.effectDurations[0] +
    data.capture.durations[2] +
    data.capture.effectDurations[1];
  for (let i = 1; i < failTicks; i++) runtime.tick([]);
  expect(runtime.battleStage).toBe("sealFail");
  runtime.tick(["confirm"]);
  runtime.tick(["confirm"]);
  runtime.tick(["confirm"]);
  expect(runtime.battleStage).toBe("captureSuccess");
  const successTicks =
    data.capture.durations[0] +
    data.capture.effectDurations[0] +
    data.capture.durations[2] +
    data.capture.durations[3];
  for (let i = 1; i < successTicks; i++) runtime.tick([]);
  expect(runtime.phase).toBe("battleReport");
};

describe("shared world workflow from source contracts", () => {
  it("is owned and ticked by the shared StoryRuntime", () => {
    let sceneTicks = 0;
    const scene: StorySceneAdapter = {
        id: "source-scene",
        complete: false,
        tick() {
          sceneTicks++;
        },
        confirm() {},
      },
      story = new StoryRuntime(scene),
      world = story.enterWorld(new WorldRuntime(data, sources));
    world.saveSucceeded();
    const x = world.player.x;
    story.tick(["holdRight"]);
    expect(world.player.x).toBe(x + 4);
    expect(sceneTicks).toBe(0);
    story.suspendWorld();
    story.tick();
    expect(sceneTicks).toBe(1);
  });
  it("saves and restores the canonical Bunny free-world owner", () => {
    const runtime = new WorldRuntime(data, sources);
    expect(runtime.phase).toBe("savePrompt");
    expect(runtime.tick(["confirm"])).toBe("save");
    const snapshot = runtime.snapshot();
    expect(snapshot).toMatchObject({
      format: "vqsv-web-save",
      version: CURRENT_SAVE_VERSION,
      location: { sceneId: 1, roomIndex: 1 },
      resume: { owner: "scene1.bunny-capture" },
      progress: { activeTask: "BUNNY_CAPTURE", mainTaskProgress: 1 },
      story: { scene1: { bunnyCaught: false, elderComplete: false } },
      pets: [
        {
          speciesId: 68,
          nature: 2,
          currentHp: 179,
          maxHp: 179,
          visualSpriteId: 154,
          skillIds: [40, 45],
          skillPp: [30, 4],
        },
      ],
    });
    const restored = new WorldRuntime(data, sources, snapshot);
    expect(restored.phase).toBe("freeworld");
    expect(restored.player.x).toBe(snapshot.location.x);
    expect(restored.player.y).toBe(snapshot.location.y);
    expect(restored.snapshot().pets).toEqual(snapshot.pets);
  });
  it("runs the source Bunny capture tutorial order", () => {
    const runtime = new WorldRuntime(data, sources);
    runtime.saveSucceeded();
    enterBattle(runtime);
    beginCapture(runtime);
    expect(runtime.inventory["1"]).toBe(1);
    const failTicks =
      data.capture.durations[0] +
      data.capture.effectDurations[0] +
      data.capture.durations[2] +
      data.capture.effectDurations[1];
    for (let i = 1; i < failTicks; i++) runtime.tick([]);
    expect(runtime.battleStage).toBe("sealFail");
    runtime.tick(["confirm"]);
    expect(runtime.battleStage).toBe("retry");
    runtime.tick(["confirm"]);
    expect(runtime.battleStage).toBe("guaranteedList");
    runtime.tick(["confirm"]);
    expect(runtime.battleStage).toBe("captureSuccess");
    const successTicks =
      data.capture.durations[0] +
      data.capture.effectDurations[0] +
      data.capture.durations[2] +
      data.capture.durations[3];
    let persisted: null | string = null;
    for (let i = 1; i < successTicks; i++) persisted = runtime.tick([]) ?? persisted;
    expect(persisted).toBe("autosave");
    expect(runtime.phase).toBe("battleReport");
    expect(runtime.inventory["0"]).toBe(0);
    expect(runtime.actors.get(data.encounter.actorId)?.visible).toBe(false);
    runtime.tick(["confirm"]);
    expect(runtime.tick(["confirm"])).toBe("autosave");
    expect(runtime.phase).toBe("returnWorld");
    const snapshot = runtime.snapshot();
    expect(snapshot.pets.some((pet) => pet.speciesId === 34)).toBe(true);
    expect(snapshot.pets[0]).toMatchObject({ speciesId: 68, skillIds: [40, 45], skillPp: [28, 4] });
  });
  it("carries the pet's held item from the save into the hit", () => {
    // The same fight, the same seeded rolls, only the save's item slot changed.
    const strike = (heldEquipmentId: number) => {
      const runtime = new WorldRuntime(data, sources);
      runtime.saveSucceeded();
      runtime.pets[0].heldEquipmentId = heldEquipmentId;
      enterBattle(runtime);
      runtime.tick(["confirm"]);
      expect(runtime.battleStage).toBe("skillList");
      runtime.tick(["confirm"]);
      expect(runtime.battleStage).toBe("skillAction");
      const texts = new Set<string>();
      for (let i = 0; i < 100 && runtime.battleStage === "skillAction"; i++) {
        const shown = runtime.battle?.damage;
        if (shown) texts.add(shown.text);
        runtime.tick([]);
      }
      expect(texts.size).toBe(1);
      return { damage: Number([...texts][0].slice(1)), opponentHp: runtime.opponentHp };
    };

    const bare = strike(-1);
    // The plain hit is the golden fight's own opening answer: the first round of the no-talent row on
    // the full-HP band commits 91 and leaves Thỏ Trắng at 44 of 135, then the round-end pass heals it
    // back to 71 before the runtime reads the bars. It reads the row instead of pinning a number
    // because the row is the evidence — the Bunny stands on defense 20 while it is above its 60 percent
    // band, and a fight built without its characteristic planned 99 here.
    const opening = traitBattle.battles.find(
      (row) => row.talentOwner === "player" && row.talent === 0 && row.enemyHpPercent === 100,
    )!.rounds[0];
    expect(bare).toEqual({
      damage: opening.committedDamage,
      opponentHp: opening.afterRoundEnd.enemy.hp,
    });
    // Kiếm Khí: the +10 percent attack is projected into the player's unit when the fight is built —
    // the answer `golden-held-items.json` grades at build time — so the hit the player sees is the
    // bigger one. 102 is this pipeline's answer for that attack against the same band; after the
    // round-end heal the Bunny stands at 60, which is below weakHp and lets the tutorial capture
    // without a second action. The row above only covers the unarmed pet.
    const armed = strike(1);
    expect(armed).toEqual({ damage: 102, opponentHp: 60 });
    expect(armed.damage).toBeGreaterThan(bare.damage);
    expect(armed.opponentHp).toBeLessThan(bare.opponentHp);
  });
  it("builds the scene1 cast from growth data, keeping the authored numbers", () => {
    const runtime = new WorldRuntime(data, sources);
    runtime.saveSucceeded();
    enterBattle(runtime);
    const { player, enemy } = runtime.battle!.definition.combatants;
    expect([player.maxHp, player.attack, player.defense, player.speed]).toEqual([
      data.player.maxHp,
      data.player.attack,
      data.player.defense,
      data.player.speed,
    ]);
    expect([enemy.maxHp, enemy.attack, enemy.defense, enemy.speed]).toEqual([
      data.opponent.maxHp,
      data.opponent.attack,
      data.opponent.defense,
      data.opponent.speed,
    ]);
    expect(runtime.battle!.definition.tutorial!.weakHp).toBe(Math.floor(data.opponent.maxHp / 2));
  });
  it("preserves the exported catch animation phase boundaries", () => {
    const runtime = new WorldRuntime(data, sources);
    runtime.saveSucceeded();
    enterBattle(runtime);
    beginCapture(runtime);
    expect(runtime.battle?.captureVisual).toMatchObject({
      state: 0,
      phase: "throw",
      hideEnemy: false,
    });
    for (let i = 1; i < data.capture.durations[0]; i++) runtime.tick([]);
    expect(runtime.battle?.captureVisual).toMatchObject({
      state: 1,
      phase: "capture",
      hideEnemy: true,
      effect: { scale10: 10, dx: 0, dy: 0 },
    });
    for (let i = 1; i < data.capture.effectDurations[0]; i++) runtime.tick([]);
    runtime.tick([]);
    expect(runtime.battle?.captureVisual).toMatchObject({
      state: 2,
      phase: "capture",
      hideEnemy: true,
    });
    for (let i = 1; i < data.capture.durations[2]; i++) runtime.tick([]);
    runtime.tick([]);
    expect(runtime.battle?.captureVisual).toMatchObject({
      state: 1,
      phase: "capture",
      hideEnemy: true,
      effect: { scale10: 4, dx: 0, dy: -20 },
    });
    for (let i = 1; i < data.capture.effectDurations[1]; i++) runtime.tick([]);
    runtime.tick([]);
    expect(runtime.battleStage).toBe("sealFail");
    runtime.tick(["confirm"]);
    runtime.tick(["confirm"]);
    runtime.tick(["confirm"]);
    expect(runtime.battleStage).toBe("captureSuccess");
    for (
      let i = 1;
      i < data.capture.durations[0] + data.capture.effectDurations[0] + data.capture.durations[2];
      i++
    )
      runtime.tick([]);
    expect(runtime.battle?.captureVisual).toMatchObject({
      state: 3,
      phase: "ground",
      hideEnemy: true,
    });
  });
  it("warms the capture sheet during battle entry", () => {
    const prepared: number[] = [],
      runtime = new WorldRuntime(data, {
        ...sources,
        prepareSprite: (sprite) => void prepared.push(sprite),
      });
    runtime.saveSucceeded();
    enterBattle(runtime);
    expect(prepared).toContain(data.capture.spriteId);
  });
  it("crosses the source doorway and reaches the Elder through his op16 gate", () => {
    const runtime = new WorldRuntime(data, sources);
    runtime.saveSucceeded();
    enterBattle(runtime);
    completeBattle(runtime);
    runtime.tick(["confirm"]);
    runtime.tick(["confirm"]);
    expect(runtime.phase).toBe("returnWorld");
    expect(runtime.roomIndex).toBe(1);
    expect(runtime.eventState.sourceEventState(1, 1, 0)).toBe(EVENT_STATE_COMPLETE);
    expect(runtime.eventState.sourceEventState(1, 0, 1)).toBe(EVENT_STATE_COMPLETE);
    runtime.player.x = 19;
    runtime.player.y = 273;
    runtime.player.direction = DIRECTION_LEFT;
    runtime.tick([]);
    expect(runtime.roomIndex).toBe(0);
    expect(runtime.player).toMatchObject({ x: 376, y: 272, direction: DIRECTION_LEFT });
    expect(runtime.tick(["confirm"])).toBeNull();
    runtime.player.x = 200;
    runtime.player.y = 190;
    expect(runtime.tick(["confirm"])).toBeNull();
    // The Elder is a data-driven group like any other notice: his records run in the world frame,
    // and the chain link behind him takes over on the next tick without any player action.
    expect(runtime.eventScene!.program.id).toBe("world:1:0:2");
    let quiet = 0,
      sawStarterOffer = false;
    for (let i = 0; i < 3000 && quiet < 2; i++) {
      const scene = runtime.eventScene;
      if (scene?.activationIds.length) {
        sawStarterOffer = true;
        walkUpToStarter(runtime);
      } else runtime.tick(scene?.choice || scene?.textReady ? ["confirm"] : []);
      quiet = runtime.eventVisible ? 0 : quiet + 1;
    }
    expect(sawStarterOffer).toBe(true);
    expect(quiet).toBe(2);
    expect(runtime.eventState.sourceEventState(1, 0, 2)).toBe(EVENT_STATE_COMPLETE);
    expect(runtime.eventState.sourceEventState(1, 0, 3)).toBe(EVENT_STATE_COMPLETE);
    expect(runtime.questState.mainTaskProgress).toBe(1);
  });
  it("shows the interaction prompt for an op38 Pet actor while the event owns movement", () => {
    const base = new WorldRuntime(data, sources);
    base.saveSucceeded();
    const save = base.snapshot(),
      runtime = new WorldRuntime(data, sources, {
        ...save,
        location: { sceneId: 1, roomIndex: 0, x: 200, y: 190, direction: DIRECTION_UP },
        eventStates: { ...save.eventStates, "1:0:2": EVENT_STATE_COMPLETE },
      });
    settleLoading(runtime);
    runtime.tick([]);
    expect(runtime.eventScene?.program.id).toBe("world:1:0:3");
    for (let i = 0; i < 10 && !runtime.eventScene?.activationIds.length; i++) runtime.tick([]);
    expect(runtime.eventScene?.activationIds).toEqual([53, 54, 55]);

    const starter = runtime.actors.get(53)!;
    runtime.player.x = starter.x;
    runtime.player.y = starter.y + 20;
    runtime.player.direction = DIRECTION_UP;
    expect(runtime.talkPrompt?.actorId).toBe(53);
  });
  it("dispatches the Neil/Sophie promise memory from room 1:3", () => {
    expect(worldEventTriggers(registry, 1, 3)).toContainEqual({
      kind: "rect",
      group: { scene: 1, room: 3, group: 1 },
      gates: [{ opcode: 15, ref: { scene: 1, room: 2, group: 0 } }],
      rect: { x: 160, y: 72, width: 90, height: 16 },
    });
    const base = new WorldRuntime(data, sources),
      save = base.snapshot(),
      runtime = new WorldRuntime(data, sources, {
        ...save,
        location: { sceneId: 1, roomIndex: 3, x: 170, y: 72, direction: DIRECTION_UP },
        eventStates: { ...save.eventStates, "1:2:0": 3, "1:3:0": 3 },
      });
    settleLoading(runtime);
    runtime.tick([]);
    expect(runtime.eventScene?.program.id).toBe("world:1:3:1");
    for (let i = 0; i < 200 && runtime.eventScene?.effect !== "fade-in"; i++) runtime.tick([]);
    const memory = runtime.eventScene!;
    expect(memory.effect).toBe("fade-in");
    expect(memory.actors.get(-1)?.visible).toBe(false);
    expect([memory.actors.get(58)?.visible, memory.actors.get(59)?.visible]).toEqual([true, true]);
  });
  it("dispatches a rect notice as its own event group and retires it when its records end", () => {
    const runtime = new WorldRuntime(
      data,
      sources,
      (() => {
        const base = new WorldRuntime(data, sources);
        base.saveSucceeded();
        return {
          ...base.snapshot(),
          location: { sceneId: 1, roomIndex: 0, x: 190, y: 300, direction: 1 },
        };
      })(),
    );
    expect(runtime.phase).toBe("freeworld");
    expect(runtime.tick([])).toBeNull();
    expect(runtime.eventVisible).toBe(true);
    const notice = runtime.eventScene!;
    expect(notice.program.id).toBe("world:1:0:1");
    for (let i = 0; i < 200; i++) runtime.tick([]);
    expect(runtime.eventVisible).toBe(true);
    expect(notice.currentText).toContain("trưởng thôn");
    // The group's records are dialog, a timed wait, then the retire op, so it takes
    // more than one confirm to reach the end.
    for (let i = 0; i < 20 && runtime.eventVisible; i++) runtime.tick(["confirm"]);
    expect(runtime.eventVisible).toBe(false);
    expect(runtime.eventState.sourceEventState(1, 0, 1)).toBe(EVENT_STATE_RETIRED);
  });
  it("raises the task ladder in the tick the group's op45 tip opens", () => {
    // Every real free-world group that carries an op45 first runs a camera follow the world event
    // frame cannot finish yet, so this group holds only the trigger, the tip and the retire op.
    const ladder = new StoryDataRegistry({
      format: "event_scene",
      version: 1,
      generatedFrom: "test",
      sceneCount: 1,
      scenes: [
        {
          format: "event_scene",
          sceneId: 3,
          sourceFile: "test",
          blockCount: 1,
          blockSizes: [0],
          rooms: [
            {
              roomIndex: 3,
              roomName: "test",
              blockSize: 0,
              roomStart: 0,
              stringPool: [],
              actors: [],
              postActorStrings: [],
              unknownAb: 0,
              unknownSkip: 0,
              eventGroups: [
                {
                  group_index: 0,
                  scene_id: 3,
                  room_index: 3,
                  world_key: 771,
                  record_count: 3,
                  records: [
                    {
                      opcode: 13,
                      total_arg_count: 4,
                      short_args: [33, 48, 64, 16],
                      string_args: [],
                    },
                    {
                      opcode: 45,
                      total_arg_count: 2,
                      short_args: [12],
                      string_args: [
                        { string_index: 0, text: "Đến Nguyên Mộc Đạo Quán hỏi tình hình." },
                      ],
                    },
                    { opcode: 14, total_arg_count: 0, short_args: [], string_args: [] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const runtime = new WorldRuntime(
      data,
      { ...sources, registry: ladder },
      (() => {
        const base = new WorldRuntime(data, sources);
        base.saveSucceeded();
        return {
          ...base.snapshot(),
          location: { sceneId: 3, roomIndex: 3, x: 60, y: 56, direction: 2 },
        };
      })(),
    );
    expect(runtime.tick([])).toBeNull();
    expect(runtime.eventScene!.program.id).toBe("world:3:3:0");
    expect(runtime.questState.mainTaskProgress).toBe(1);
    // The tip is the record that follows the trigger, so it opens on the next tick.
    runtime.tick([]);
    expect(runtime.eventScene!.textKind).toBe("tasktip");
    expect(runtime.eventScene!.currentText).toContain("Nguyên Mộc Đạo Quán");
    expect(runtime.questState.mainTaskProgress).toBe(12);
    for (let i = 0; i < 20 && runtime.eventVisible; i++) runtime.tick(["confirm"]);
    expect(runtime.eventVisible).toBe(false);
    expect(runtime.eventState.sourceEventState(3, 3, 0)).toBe(EVENT_STATE_COMPLETE);
    expect(runtime.questState.mainTaskProgress).toBe(12);
  });
  it("commits Nguyên Mộc's op76 departure into the live world and save", () => {
    const base = new WorldRuntime(data, sources);
    base.saveSucceeded();
    const save = base.snapshot(),
      runtime = new WorldRuntime(data, sources, {
        ...save,
        location: { sceneId: 3, roomIndex: 6, x: 272, y: 224, direction: 1 },
        eventStates: { ...save.eventStates, "3:5:0": EVENT_STATE_COMPLETE },
      });
    settleLoading(runtime);
    for (let i = 0; i < 500 && runtime.sceneId !== 4; i++)
      runtime.tick(runtime.eventScene?.textReady ? ["confirm"] : []);
    expect(runtime.sceneId).toBe(4);
    expect(runtime.roomIndex).toBe(0);
    expect(runtime.player).toMatchObject({ x: 48, y: 160, direction: 2 });
    expect(runtime.eventState.sourceEventState(3, 6, 3)).toBe(EVENT_STATE_COMPLETE);
    const restored = new WorldRuntime(data, sources, runtime.snapshot());
    expect(restored.sceneId).toBe(4);
    expect(restored.roomIndex).toBe(0);
  });
  it("runs Jones' task 19→21 egg handoff without corrupting branch task 20", () => {
    const base = new WorldRuntime(data, sources),
      save = base.snapshot(),
      jones = rooms["4:5"].actors.find((actor) => actor.id === 34)!,
      branchWrites: Array<[number, number]> = [],
      branchTasks = {
        status: () => -1,
        set: (taskId: number, status: 1 | 3) => void branchWrites.push([taskId, status]),
        matches: (
          _taskId: number,
          _kind: "offer" | "completion",
          ref: { scene: number; room: number; group: number },
        ) => !(ref.scene === 4 && ref.room === 5 && (ref.group === 17 || ref.group === 18)),
      },
      runtime = new WorldRuntime(
        data,
        { ...sources, branchTasks },
        {
          ...save,
          location: {
            sceneId: 4,
            roomIndex: 5,
            x: jones.x,
            y: jones.y,
            direction: DIRECTION_UP,
          },
          progress: { ...save.progress, mainTaskProgress: 19 },
          world: { ...save.world!, mainTaskProgress: 19 },
          pets: [{ ...save.pets[0], speciesId: 19 }],
        },
      );
    settleLoading(runtime);
    runtime.tick(["confirm"]);
    expect(runtime.eventScene?.program.id).toBe("world:4:5:17");
    for (let i = 0; i < 1000 && runtime.eventVisible; i++)
      runtime.tick(runtime.eventScene?.textReady ? ["confirm"] : []);
    expect(runtime.questState.mainTaskProgress).toBe(20);
    expect(runtime.eventState.sourceEventState(4, 5, 17)).toBe(EVENT_STATE_COMPLETE);

    runtime.tick(["confirm"]);
    expect(runtime.eventScene?.program.id).toBe("world:4:5:18");
    for (let i = 0; i < 1000 && runtime.eventVisible; i++)
      runtime.tick(runtime.eventScene?.textReady ? ["confirm"] : []);
    expect(runtime.questState.mainTaskProgress).toBe(21);
    expect(runtime.inventory["14"]).toBe((save.inventory.items["14"] ?? 0) + 1);
    expect(runtime.snapshot().inventory.specials).toContain(0);
    expect(runtime.flags.sourceFeatureState(6)).toBe(3);
    expect(runtime.eventState.sourceEventState(4, 5, 13)).toBe(EVENT_STATE_COMPLETE);
    expect(branchWrites).toEqual([]);

    const restored = new WorldRuntime(data, { ...sources, branchTasks }, runtime.snapshot());
    expect(restored.questState.mainTaskProgress).toBe(21);
    expect(restored.flags.sourceFeatureState(6)).toBe(3);
    expect(restored.snapshot().inventory.specials).toContain(0);
  });
  it("proves Nguyên Mộc branch completions from their authored event, Pet and quest flag", () => {
    const statuses = new Map<number, number>([
        [2, 1],
        [13, 1],
        [18, 3],
      ]),
      branchTasks = {
        status: (taskId: number) => statuses.get(taskId) ?? -1,
        set: (taskId: number, status: 1 | 3) => void statuses.set(taskId, status),
        matches: () => true,
      },
      base = new WorldRuntime(data, sources),
      save = base.snapshot(),
      pet = { ...save.pets[0], speciesId: 24 };
    const kate = new WorldRuntime(
      data,
      { ...sources, branchTasks },
      {
        ...save,
        location: { sceneId: 3, roomIndex: 3, x: 483, y: 205, direction: DIRECTION_UP },
        eventStates: { ...save.eventStates, "2:1:7": EVENT_STATE_COMPLETE },
        pets: [pet],
      },
    );
    settleLoading(kate);
    kate.tick(["confirm"]);
    expect(kate.eventScene?.program.id).toBe("world:3:3:1");
    for (let i = 0; i < 1000 && kate.eventVisible; i++)
      kate.tick(kate.eventScene?.textReady ? ["confirm"] : []);
    expect(statuses.get(2)).toBe(3);

    const arnold = new WorldRuntime(
      data,
      { ...sources, branchTasks },
      {
        ...save,
        location: { sceneId: 3, roomIndex: 3, x: 230, y: 406, direction: DIRECTION_UP },
        eventStates: { ...save.eventStates, "11:10:0": EVENT_STATE_COMPLETE },
        world: { ...save.world!, sourceWorldFlags: [0] },
      },
    );
    settleLoading(arnold);
    arnold.tick(["confirm"]);
    expect(arnold.eventScene?.program.id).toBe("world:3:3:8");
    for (let i = 0; i < 1000 && arnold.eventVisible; i++)
      arnold.tick(arnold.eventScene?.textReady ? ["confirm"] : []);
    expect(statuses.get(13)).toBe(3);
    expect(arnold.flags.hasSourceWorldFlag(0)).toBe(false);
  });
  it("advances held movement and ambient actor animation every simulation tick", () => {
    const runtime = new WorldRuntime(data, sources);
    runtime.saveSucceeded();
    const x = runtime.player.x,
      actor = runtime.actors.get(data.encounter.actorId)!,
      animation = actor.animationTick;
    for (let i = 0; i < 5; i++) runtime.tick(["holdRight"]);
    expect(runtime.player.x).toBe(x + 20);
    expect(actor.animationTick).toBe(animation + 5);
  });
  it("resolves free-world movement against the exported map terrain", () => {
    const runtime = new WorldRuntime(data, sources);
    runtime.saveSucceeded();
    runtime.player.x = 100;
    runtime.player.y = 296;
    runtime.player.direction = 0;
    runtime.tick(["holdDown"]);
    expect(runtime.player.y).toBe(296);
    expect(runtime.player.direction).toBe(0);
    runtime.tick(["holdUp"]);
    expect(runtime.player.y).toBe(292);
  });
  it("keeps badge-gated terrain closed until the Thuy Lam badge is granted", () => {
    const base = new WorldRuntime(data, sources);
    base.saveSucceeded();
    const runtime = new WorldRuntime(data, sources, {
      ...base.snapshot(),
      location: { ...base.snapshot().location, sceneId: 1, roomIndex: 6 },
    });
    expect(runtime.roomIndex).toBe(6);
    runtime.player.x = 176;
    runtime.player.y = 248;
    runtime.player.direction = 0;
    runtime.tick(["holdDown"]);
    expect(runtime.player.y).toBe(248);
    expect(runtime.flags.badges.grant(BADGE_THUY_LAM)).toBe(true);
    runtime.tick(["holdDown"]);
    expect(runtime.player.y).toBe(252);
  });
  it("swims on Thủy Lam water (modes 6/9), in Neil's own sheet under a wardrobe skin", () => {
    const base = new WorldRuntime(data, sources);
    base.saveSucceeded();
    const runtime = new WorldRuntime(data, sources, {
      ...base.snapshot(),
      location: { ...base.snapshot().location, sceneId: 1, roomIndex: 6 },
    });
    const terrain = () =>
      (runtime as unknown as { terrainAt(x: number, y: number): number }).terrainAt(
        runtime.player.x,
        runtime.player.y,
      );
    runtime.flags.badges.grant(BADGE_THUY_LAM);
    runtime.setFashionSprite(36);
    runtime.player.x = 176;
    runtime.player.y = 248;
    runtime.player.direction = 0;
    runtime.tick(["holdDown"]);
    // Still on the bank: the skin walks (family 1).
    expect(terrain()).not.toBe(2);
    expect([runtime.player.sprite, runtime.player.state]).toEqual([36, 3]);
    for (let i = 0; i < 40 && terrain() !== 2; i++) runtime.tick(["holdDown"]);
    expect(terrain()).toBe(2);
    // In the water: swim family 2 (state 6 + down), drawn from sprite 0.
    expect([runtime.player.sprite, runtime.player.state]).toEqual([0, 6]);
    runtime.tick([]);
    expect([runtime.player.sprite, runtime.player.state]).toEqual([0, 9]);
    // Back up onto the bank: the skin returns and walks.
    for (let i = 0; i < 40 && terrain() === 2; i++) runtime.tick(["holdUp"]);
    expect([runtime.player.sprite, runtime.player.state]).toEqual([36, 5]);
  });
  it("fetches every room it enters and keeps the loading screen up until the map arrives", () => {
    const ready = new Set<string>(),
      requested: string[] = [],
      lazy = {
        ...sources,
        roomReady: (scene: number, room: number) => ready.has(`${scene}:${room}`),
        prepareRoom: (scene: number, room: number) => void requested.push(`${scene}:${room}`),
      },
      base = new WorldRuntime(data, sources);
    base.saveSucceeded();
    const save = base.snapshot();
    // A story crossing: Nguyên Mộc's op76 boat lands on Niêm Thổ's dock, a room no door prefetched.
    ready.add("3:6");
    const runtime = new WorldRuntime(data, lazy, {
      ...save,
      location: { sceneId: 3, roomIndex: 6, x: 272, y: 224, direction: 1 },
      eventStates: { ...save.eventStates, "3:5:0": EVENT_STATE_COMPLETE },
    });
    settleLoading(runtime);
    for (let i = 0; i < 500 && runtime.sceneId !== 4; i++)
      runtime.tick(runtime.eventScene?.textReady ? ["confirm"] : []);
    expect([runtime.sceneId, runtime.roomIndex]).toEqual([4, 0]);
    expect(requested).toContain("4:0");
    // The ramp runs its source length and then holds the full bar while the dock is still loading.
    for (let i = 0; i < MAP_LOADING_TOTAL_TICKS + 20; i++)
      expect(runtime.tickMapLoading()).toBe(true);
    expect(runtime.mapLoading).not.toBeNull();
    ready.add("4:0");
    expect(runtime.tickMapLoading()).toBe(false);
    expect(runtime.mapLoading).toBeNull();
  });
  it("holds the hero still until the room's collision has loaded", () => {
    const runtime = new WorldRuntime(data, { ...sources, collision: () => undefined });
    runtime.saveSucceeded();
    const { x, y } = runtime.player;
    expect(() => runtime.tick(["holdRight"])).not.toThrow();
    expect([runtime.player.x, runtime.player.y]).toEqual([x, y]);
  });
  it("uses the saved second skill PP and plants its buff on the caster", () => {
    const runtime = new WorldRuntime(data, sources);
    runtime.saveSucceeded();
    enterBattle(runtime);
    runtime.tick(["confirm"]);
    runtime.tick(["down"]);
    runtime.tick(["confirm"]);
    expect(runtime.battleStage).toBe("skillAction");
    expect(runtime.pets[0].skillPp).toEqual([30, 3]);
    const posts: string[] = [];
    for (let i = 0; i < 100 && runtime.battleStage === "skillAction"; i++) {
      const post = runtime.battle?.postEffect;
      if (post) posts.push(`${post.target} ${post.text}`);
      runtime.tick([]);
    }
    // Điện năng chuyển đổi aims at its own caster, so the route's buff belongs to the player's unit and
    // the widget prints the name the effect row carries, not a description the port wrote for it.
    expect([...new Set(posts)]).toEqual([
      `player ${sources.battleRules.status.effectRowName(BUFF_BANK, 9)}`,
    ]);
    expect(runtime.battle?.statusStrip("player").map((slot) => slot.sourceNumericId)).toEqual([
      9, 20,
    ]);
    expect(runtime.battle?.statusStrip("enemy")).toEqual([]);
    expect(runtime.opponentHp).toBe(data.opponent.maxHp);
  });
  /**
   * The whole strip, in the real fight, at the frame `?statusStrip=1` freezes.
   *
   * This is the handover table the player checks with their eyes, so every field of it is pinned here
   * off the same walk the HUD reads: the six slots in the order the source spends them, the picture and
   * name the harvest says that identity owns, the counter the numeral is read from, and the badge cell
   * the renderer's sampled mapping gives it. Nothing in it is inferred from a screenshot.
   */
  it("draws the full six-slot strip on both sides of a live battle", () => {
    const runtime = new WorldRuntime(data, sources);
    runtime.saveSucceeded();
    enterBattle(runtime);
    const battle = runtime.battle;
    if (!battle) throw new Error("the bunny battle runtime was not reached");
    plantStatusStrip(battle, "player");
    plantStatusStrip(battle, "enemy");
    /**
     * The same frame's two health bars, as Java splits the track.
     *
     * The renderer passes the widget's own 82 px width, so the inner is 80. The enemy's 300-point pool
     * comes out of the red segment instead of pushing the bar past its end, and the bar with no pool
     * stays the ordinary one `hp/max` field.
     */
    const bar = (side: "player" | "enemy") => {
      const unit = battle.statusUnit(side);
      if (!unit) throw new Error(`the live battle has no ${side} unit`);
      const track = shieldTrackUnit(battle.hp(side), unit.maxHp(), battle.shield(side));
      return {
        red: redHpPixels(track, 80),
        blue: blueShieldPixels(track, 80),
        text: shieldTrackText(track, 82),
      };
    };
    expect(bar("enemy")).toEqual({
      red: 24,
      blue: 56,
      text: {
        mode: "split",
        hp: "135",
        shield: "+300",
        fieldWidth: 39,
        hpColor: HP_FIELD_TEXT,
        shieldColor: SHIELD_FIELD_TEXT,
      },
    });
    expect(bar("player")).toEqual({
      red: 80,
      blue: 0,
      text: { mode: "combined", value: "179/179", color: COMBINED_TEXT },
    });
    const strip = (side: "player" | "enemy") =>
      battle.statusStrip(side).map((slot) => ({
        key: slot.stableKey,
        name: slot.displayName,
        // The two ways an icon is reached: a cell of the Liệt Hỏa sheet, or a Cầu Vồng resource.
        art:
          slot.iconKind === "RAINBOW_RESOURCE"
            ? slot.resourcePath.slice(slot.resourcePath.lastIndexOf("/") + 1)
            : `cell ${slot.lietHoaAtlasCell}`,
        shown: `${slot.remainingDuration}${slot.actionOwned ? " actions" : " turns"}`,
        badge: slot.badgeCell,
      }));
    expect(strip("player")).toEqual([
      // The pressure belongs to no bank and still takes the first slot, drawn with Nhụt Chí's picture.
      {
        key: "HTTC-OPENING-SUPPRESSION",
        name: "Áp Chế Khai Trận - Giảm 25% sức mạnh",
        art: "cell 7",
        shown: "4 actions",
        badge: 138,
      },
      { key: "LH-EFFECT-6-04", name: "Phòng ngự", art: "cell 16", shown: "10 turns", badge: 144 },
      { key: "LH-EFFECT-7-00", name: "Gieo Hạt", art: "cell 1", shown: "6 turns", badge: 140 },
      { key: "CV-EFFECT-11-00", name: "Hóa Đá", art: "e0.png", shown: "1 actions", badge: 135 },
      { key: "LH-EFFECT-6-09", name: "Hỏa Thạch", art: "cell 21", shown: "3 turns", badge: 137 },
      { key: "LH-EFFECT-7-08", name: "Quỷ Mị", art: "cell 9", shown: "2 actions", badge: 136 },
    ]);
    expect(strip("enemy")).toEqual([
      { key: "LH-EFFECT-6-00", name: "Súc Lực", art: "cell 12", shown: "7 actions", badge: 141 },
      { key: "LH-EFFECT-7-06", name: "Nhụt Chí", art: "cell 7", shown: "2 turns", badge: 136 },
      { key: "CV-EFFECT-11-05", name: "Hủ Thực", art: "e5.png", shown: "4 turns", badge: 138 },
      // The signature status drawn with a Liệt Hỏa buff's picture on purpose, next to its own name.
      { key: "PD-EFFECT-15", name: "Khiên", art: "cell 16", shown: "10 turns", badge: 144 },
      { key: "LH-EFFECT-7-09", name: "Hỗn Loạn", art: "cell 10", shown: "3 actions", badge: 137 },
      // No bytes for this picture in the source either, so the slot keeps its numeral and loses the icon.
      { key: "V4-EFFECT-01", name: "Ngủ", art: "e8.png", shown: "5 actions", badge: 139 },
    ]);
    // Six is the cap, not a lost status: the player still holds the two the walk never reached.
    const unit = battle.statusUnit("player");
    if (!unit) throw new Error("the live battle has no unit to plant on");
    expect([unit.activeStatusIds(0), unit.activeStatusIds(1), unit.activeStatusIds(2)]).toEqual([
      [4, 9, 12],
      [0, 8],
      [0, 3],
    ]);
  });
  it("persists the Elder milestone and restores into free world for the Bích Thủy arc", () => {
    const runtime = new WorldRuntime(data, sources);
    runtime.objectiveComplete = true;
    runtime.markComplete();
    const snapshot = runtime.snapshot();
    expect(snapshot.resume.owner).toBe("scene1.elder-return");
    expect(snapshot.story.scene1).toEqual({ bunnyCaught: true, elderComplete: true });
    // The ladder is written by the op45 records in the elder chain, never by this shortcut.
    expect(snapshot.progress).toEqual({ activeTask: "SCENE1_COMPLETE", mainTaskProgress: 1 });
    const restored = new WorldRuntime(data, sources, snapshot);
    expect(restored.phase).toBe("freeworld");
  });
  it("continues from a completed capture save with inventory, roster, PP and return task intact", () => {
    const runtime = new WorldRuntime(data, sources);
    runtime.objectiveComplete = true;
    runtime.pets[0].skillPp = [29, 4];
    runtime.inventory["0"] = 0;
    runtime.inventory["1"] = 1;
    const snapshot = runtime.snapshot(),
      restored = new WorldRuntime(data, sources, snapshot);
    expect(restored.phase).toBe("returnWorld");
    expect(restored.inventory).toEqual(snapshot.inventory.items);
    expect(restored.pets).toEqual(snapshot.pets);
    expect(restored.questState).toEqual({ activeTask: "RETURN_TO_ELDER", mainTaskProgress: 1 });
    expect(restored.player.x).toBe(snapshot.location.x);
    expect(restored.player.y).toBe(snapshot.location.y);
  });
});

describe("walking the Cầu Vồng chapter's doorways", () => {
  it("leaves Thành Cầu Vồng by tickCity's north rectangle for the square (204, 560)", () => {
    const runtime = cvWorld(1, 210, 619, 2);
    expect(runtime.sceneId).toBe(98);
    expect(runtime.roomIndex).toBe(1);
    runtime.player.x = 50;
    runtime.player.y = 10;
    runtime.tick([]);
    expect(runtime.roomIndex).toBe(0);
    // The room swap runs through the source load screen instead of cutting straight to the map.
    expect(runtime.mapLoading).not.toBeNull();
    settleLoading(runtime);
    // `returnToSquareFromCity`: `transition(s, 0, 204, 560)`, facing down.
    expect(runtime.snapshot().location).toEqual({
      sceneId: 98,
      roomIndex: 0,
      x: 204,
      y: 560,
      direction: 0,
    });
  });
  it("leaves a gated doorway shut and opens it when the chapter event completes", () => {
    const runtime = cvWorld(3, 13 * 20 + 10, 31 * 20 + 10, 2);
    runtime.player.x = 0 * 20 + 10;
    runtime.player.y = 26 * 20 + 10;
    for (let i = 0; i < 5; i++) runtime.tick([]);
    expect(runtime.roomIndex).toBe(3);
    runtime.eventState.op14CompleteEvent(98, 3, 102);
    runtime.tick([]);
    expect(runtime.roomIndex).toBe(9);
    settleLoading(runtime);
    const destination = roomDoorRow(cvRegistry, 98, 9, 0)!;
    expect(runtime.player).toMatchObject(roomDoorArrival(destination));
  });
  it("leaves a doorway alone when the destination room has no map", () => {
    const runtime = cvWorld(1, 210, 619, 2, {
      room: (scene, index) => (scene === 98 && index === 0 ? undefined : room(scene, index)),
    });
    runtime.player.x = 50;
    runtime.player.y = 10;
    for (let i = 0; i < 5; i++) runtime.tick([]);
    expect(runtime.roomIndex).toBe(1);
    expect(runtime.mapLoading).toBeNull();
  });
  it("warping from a chapter pad lands on the tile its own table row names", () => {
    const runtime = cvWorld(12, 210, 210, 2);
    // The four gates' return pad: room 12, tile (1,13), and no event gate on Java's row.
    runtime.player.x = 1 * 20 + 10;
    runtime.player.y = 13 * 20 + 10;
    runtime.tick([]);
    expect(runtime.roomIndex).toBe(9);
    expect(runtime.mapLoading).not.toBeNull();
    settleLoading(runtime);
    expect(runtime.player.x).toBe(17 * 20 + 10);
    expect(runtime.player.y).toBe(22 * 20 + 19);
    expect(runtime.player.direction).toBe(DIRECTION_DOWN);
  });
  it("fetches the room behind a pad while the hero is still walking to it", () => {
    const prepared: string[] = [];
    cvWorld(12, 210, 210, 2, {
      prepareRoom: (scene, room) => prepared.push(`${scene}:${room}`),
    });
    expect(prepared).toContain("98:9");
  });
});
