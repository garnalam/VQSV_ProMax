import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { StoryDataRegistry } from "./StoryDataRegistry";
import { SourceOpcodeInterpreter } from "./SourceOpcodeInterpreter";
import { ROUTE_ID, SourceRouteCatalog } from "./SourceRoutes";
import { createStorySceneRuntime, StorySceneRuntime } from "./StorySceneRuntime";
import type { RoomAsset } from "./GameAssets";

const document = JSON.parse(readFileSync("public/pack/story/event-scenes.json", "utf8"));
const registry = new StoryDataRegistry(document);
const routes = new SourceRouteCatalog(
  JSON.parse(readFileSync("public/pack/story/routes.json", "utf8")),
);
const INTRO_ROUTE = routes.require(ROUTE_ID.openingIntro),
  PRE_TEN_YEARS_ROUTE = routes.require(ROUTE_ID.preTenYears),
  SCENE1_START_ROUTE = routes.require(ROUTE_ID.scene1Start);
const rooms = (
  JSON.parse(readFileSync("public/pack/world/rooms.json", "utf8")) as {
    rooms: Record<string, RoomAsset>;
  }
).rooms;
const services = {
  room: (scene: number, room: number) =>
    rooms[`${scene}:${room}`] ?? (scene === 5 && room === 1 ? rooms["-1:-1"] : undefined),
  animationTicks: () => 1,
};

describe("Java source event registry parity", () => {
  it("contains the decoded source route groups used by the Web runtime", () => {
    expect(document.generatedFrom).toContain("modules/event/decoded");
    expect(registry.group(0, 0, 0)?.records.length).toBeGreaterThan(0);
    expect(registry.group(1, 3, 0)?.records.length).toBeGreaterThan(0);
    expect(INTRO_ROUTE.groups.length).toBeGreaterThan(1);
    expect(PRE_TEN_YEARS_ROUTE.groups).toEqual([
      { sceneId: 1, roomIndex: 3, groupIndex: 0 },
      { sceneId: 1, roomIndex: 0, groupIndex: 0, entry: { x: 199, y: 218 } },
    ]);
    expect(routes.require(ROUTE_ID.scene1ElderReturn).groups).toEqual([
      { sceneId: 1, roomIndex: 0, groupIndex: 2 },
    ]);
  });

  it("keeps route composition in the JSON document rather than in code", () => {
    expect(INTRO_ROUTE.openingSolidBlack).toBe(true);
    expect(PRE_TEN_YEARS_ROUTE.fadeAfterFirstText).toBe(true);
    expect(PRE_TEN_YEARS_ROUTE).toMatchObject({
      startEvent: 121,
      initialRoom: { scene: 1, room: 3, x: 199, y: 79 },
      startupDelay: 16,
    });
    expect(SCENE1_START_ROUTE.openingSolidBlack).toBeUndefined();
    expect(() => routes.require("scene9-unwritten")).toThrow(/routes\.json/);
  });

  it("projects source opcodes into reusable runtime events instead of scene scripts", () => {
    const program = new SourceOpcodeInterpreter(registry).compile(PRE_TEN_YEARS_ROUTE);
    const battle = program.events.find((event) => event.type === "battle");
    expect(battle).toMatchObject({
      type: "battle",
      context: {
        actorId: 56,
        encounter: [5, 20, 4],
        flags: [1, 1],
        mode: [0, 2],
        branchTargets: [78, 78, 0],
      },
    });
    const consume = program.events.find((event) => event.type === "consumeBattle");
    expect(consume).toMatchObject({ type: "consumeBattle", branchTargets: [78, 78, 0] });
  });

  it("does not inject room boundaries into source groups without an explicit entry", () => {
    const program = new SourceOpcodeInterpreter(registry).compile(INTRO_ROUTE);
    expect(program.events.some((event) => event.type === "routeBoundary")).toBe(false);
  });

  it("keeps the source scene runtime generic for both routes", () => {
    const intro = createStorySceneRuntime(registry, INTRO_ROUTE, services);
    const prelude = createStorySceneRuntime(registry, PRE_TEN_YEARS_ROUTE, services);
    for (let i = 0; i < 64; i++) {
      intro.tick();
      prelude.tick();
    }
    expect(intro.sourceGroups).toEqual(INTRO_ROUTE.groups);
    expect(prelude.sourceGroups).toEqual(PRE_TEN_YEARS_ROUTE.groups);
    expect(prelude.battle).toBeNull();
  });

  it("retains source battle metadata through the generic BattleRuntime", () => {
    const runtime = createStorySceneRuntime(registry, PRE_TEN_YEARS_ROUTE, services);
    for (let i = 0; i < 10000 && !runtime.battle; i++) {
      if (runtime.textReady) runtime.confirm();
      runtime.tick();
    }
    expect(runtime.battle?.context).toMatchObject({
      actorId: 56,
      encounter: [5, 20, 4],
      flags: [1, 1],
      mode: [0, 2],
    });
  });

  it("consumes the source branch and continues through the ten-years group", () => {
    const runtime = createStorySceneRuntime(registry, PRE_TEN_YEARS_ROUTE, services);
    for (let i = 0; i < 20000 && !runtime.complete; i++) {
      if (runtime.textReady) runtime.confirm();
      runtime.tick();
    }
    expect(runtime.battleConsumed).toBe(true);
    expect(runtime.battle).toBeNull();
    expect(runtime.complete).toBe(true);
    expect(runtime.sceneId).toBe(1);
    expect(runtime.roomIndex).toBe(1);
  });

  it("starts the skip-intro route from the same source ten-years group", () => {
    const runtime = createStorySceneRuntime(registry, SCENE1_START_ROUTE, services);
    for (let i = 0; i < 20000 && !runtime.actors.has(-1); i++) {
      if (runtime.textReady) runtime.confirm();
      runtime.tick();
    }
    expect(runtime.actors.get(-1)?.sprite).toBe(0);
    for (let i = 0; i < 20000 && !runtime.complete; i++) {
      if (runtime.textReady) runtime.confirm();
      runtime.tick();
    }
    expect(runtime.complete).toBe(true);
    expect(runtime.sceneId).toBe(1);
    expect(runtime.roomIndex).toBe(1);
    expect(runtime.program.groups).toEqual([{ sceneId: 1, roomIndex: 0, groupIndex: 0 }]);
  });

  it("keeps the Java camera centered on adult Neil during timed movement", () => {
    const runtime = createStorySceneRuntime(registry, SCENE1_START_ROUTE, services);
    let previousX = -1,
      checked = 0;
    for (let i = 0; i < 20000 && !runtime.complete; i++) {
      if (runtime.textReady) runtime.confirm();
      runtime.tick();
      const player = runtime.actors.get(-1),
        room = rooms[`${runtime.renderScene}:${runtime.renderRoom}`];
      if (!player || !room || previousX < 0) {
        if (player) previousX = player.x;
        continue;
      }
      if (player.x !== previousX) {
        expect(runtime.cameraX).toBe(
          Math.max(0, Math.min(Math.max(0, room.width - 240), player.x - 120)),
        );
        expect(runtime.cameraY).toBe(
          Math.max(0, Math.min(Math.max(0, room.height - 320), player.y - 160)),
        );
        checked++;
      }
      previousX = player.x;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("projects the elder item rewards as source openbox events", () => {
    const program = new SourceOpcodeInterpreter(registry).compile(SCENE1_START_ROUTE);
    expect(program.events.filter((event) => event.type === "item")).toEqual([
      { type: "item", mode: 0, itemId: 0, quantity: 1 },
      { type: "item", mode: 0, itemId: 1, quantity: 2 },
      { type: "item", mode: 0, itemId: 4, quantity: 5 },
    ]);
  });

  it("decodes op19 as a special-item grant: the elder hands over the pet book (1:0:6)", () => {
    const program = new SourceOpcodeInterpreter(registry).compile({
      id: "elder-challenge",
      groups: [{ sceneId: 1, roomIndex: 0, groupIndex: 6 }],
      startEvent: 0,
    });
    expect(program.events.filter((event) => event.type === "item" && event.table === 5)).toEqual([
      { type: "item", mode: 0, itemId: 5, quantity: 1, table: 5 },
    ]);
  });

  it("decodes Lanni's op36 reward as Tuyết Cầu Bảo Bảo instead of only showing its text", () => {
    const program = new SourceOpcodeInterpreter(registry).compile({
      id: "lanni-snowball-reward",
      groups: [{ sceneId: 1, roomIndex: 2, groupIndex: 0 }],
      startEvent: 0,
    });
    expect(program.events.filter((event) => event.type === "grantPet")).toEqual([
      {
        type: "grantPet",
        speciesId: 48,
        level: 5,
        quality: 2,
        nature: 0,
        skillIds: [30, 45],
      },
    ]);
  });

  it("names an op18/op19 reward from its own table", () => {
    const runtime = new StorySceneRuntime(
      {
        id: "special-name",
        groups: [{ sceneId: 1, roomIndex: 0, groupIndex: 6 }],
        events: [{ type: "item", mode: 0, itemId: 5, quantity: 1, table: 5 }],
        startEvent: 0,
        startupDelay: 0,
        stopAtTenYears: false,
      },
      {
        ...services,
        itemName: (id, table) => (table === 5 && id === 5 ? "Trang sách" : "nhầm bảng"),
      },
    );
    runtime.tick();
    expect(runtime.currentText).toBe("Đạt được: Trang sách x 1");
  });

  it("names story rewards through the shared pack item catalog", () => {
    const runtime = new StorySceneRuntime(
      {
        id: "item-name",
        groups: [{ sceneId: 1, roomIndex: 0, groupIndex: 6 }],
        events: [{ type: "item", mode: 0, itemId: 11, quantity: 2 }],
        startEvent: 0,
        startupDelay: 0,
        stopAtTenYears: false,
      },
      { ...services, itemName: (id) => (id === 11 ? "Sinh mệnh thạch" : undefined) },
    );
    runtime.tick();
    expect(runtime.currentText).toBe("Đạt được: Sinh mệnh thạch x 2");
  });

  it("commits op66's source feature without inserting a presentation pause", () => {
    const unlocked: number[] = [];
    const runtime = new StorySceneRuntime(
      {
        id: "source-panel",
        groups: [{ sceneId: 11, roomIndex: 8, groupIndex: 1 }],
        events: [{ type: "featureUnlock", feature: 3 }, { type: "groupEnd" }],
        startEvent: 0,
        startupDelay: 0,
        stopAtTenYears: false,
      },
      {
        ...services,
        unlockSourceFeature: (feature) => unlocked.push(feature),
      },
    );
    runtime.tick();
    expect(unlocked).toEqual([3]);
    runtime.tick();
    expect(runtime.complete).toBe(true);
  });
});
