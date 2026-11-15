import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { QuestLog, TASK_ACTIVE, TASK_COMPLETE } from "../quest/QuestLog";
import { MapCollision, passable } from "../world/MapCollision";
import type { SourceRoutesDocument } from "./SourceRoutes";
import { StoryDataRegistry } from "./StoryDataRegistry";
import { StoryDirector } from "./StoryDirector";
import {
  DoorGraph,
  StoryGraph,
  validateStoryGraph,
  type StoryGraphDocument,
  type StoryWorldIndex,
} from "./StoryGraph";

const read = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const graphDocument = read<StoryGraphDocument>("public/pack/story/story-graph.json"),
  registry = new StoryDataRegistry(read("public/pack/story/event-scenes.json")),
  doors = new DoorGraph(registry),
  rooms = read<{ rooms: Record<string, { mapId: number }> }>("public/pack/world/rooms.json").rooms,
  routes = read<SourceRoutesDocument>("public/pack/story/routes.json"),
  mainTasks = read<{ tasks: unknown[] }>("public/pack/story/main-tasks.json").tasks,
  branchTasks = read<{ tasks: { id: number }[] }>("public/pack/data/quest/branch-tasks.json").tasks;

function worldIndex(): StoryWorldIndex {
  const collisions = new Map<number, MapCollision>();
  return {
    routes: new Set(routes.routes.map((route) => route.id)),
    rooms: (scene, room) => `${scene}:${room}` in rooms,
    group: (scene, room, group) =>
      !!registry.room(scene, room)?.eventGroups.some((g) => g.group_index === group),
    walkable: (scene, room, x, y) => {
      const mapId = rooms[`${scene}:${room}`]?.mapId;
      if (mapId === undefined) return false;
      let collision = collisions.get(mapId);
      if (!collision) {
        collision = read<MapCollision>(`public/pack/world/maps/${mapId}/collision.json`);
        collisions.set(mapId, collision);
      }
      const row = collision.rows[Math.floor(y / collision.tileSize)];
      const terrain = Number(row?.[Math.floor(x / collision.tileSize)] ?? "1");
      return passable(terrain, false);
    },
    mainTaskCount: mainTasks.length,
    branchTaskCount: Math.max(...branchTasks.map((task) => task.id)) + 1,
    doors,
  };
}

describe("QuestLog", () => {
  it("only moves the main storyline forward", () => {
    const log = new QuestLog();
    expect(log.startMain(0)).toBe(true);
    expect(log.completeMain(1)).toBe(false);
    expect(log.completeMain(0)).toBe(true);
    expect(log.startMain(0)).toBe(false);
    expect(log.mainDone).toBe(true);
    expect(log.startMain(1)).toBe(true);
    expect(log.startMain(0)).toBe(false);
    expect(log.main).toBe(1);
  });

  it("never re-opens a completed branch task and round-trips through a save", () => {
    const log = new QuestLog();
    log.setBranch(4, TASK_ACTIVE);
    log.setBranch(2, TASK_COMPLETE);
    expect(log.setBranch(2, TASK_ACTIVE)).toBe(false);
    log.grantToken("b");
    log.grantToken("a");
    const record = log.snapshot();
    expect(record).toEqual({ main: -1, mainDone: false, branch: "2:3,4:1", tokens: "a|b" });
    const back = new QuestLog();
    back.restore(JSON.parse(JSON.stringify(record)));
    expect(back.snapshot()).toEqual(record);
  });

  it("drops malformed save entries instead of inventing state", () => {
    const log = new QuestLog();
    log.restore({ main: 1.5, branch: "x:1,3:7,5:3,-1:1", tokens: "||ok" });
    expect(log.main).toBe(-1);
    expect(log.branchTasks()).toEqual([{ task: 5, status: TASK_COMPLETE }]);
    expect(log.hasToken("ok")).toBe(true);
  });
});

describe("story graph in the pack", () => {
  it("validates with no soft-lock, dangling reference or unreachable trigger", () => {
    expect(validateStoryGraph(new StoryGraph(graphDocument), worldIndex())).toEqual([]);
  });

  it("covers Liệt Hỏa and Cầu Vồng and ends in a declared frontier", () => {
    const graph = new StoryGraph(graphDocument);
    expect(graphDocument.chapters.map((chapter) => chapter.id)).toEqual(["liet-hoa", "cau-vong"]);
    expect(graph.nodes.some((node) => node.frontier || node.ending)).toBe(true);
  });

  it("has every room the chapters name in the world bake", () => {
    for (const chapter of graphDocument.chapters)
      for (const scene of chapter.scenes)
        expect(
          Object.keys(rooms).some((key) => key.startsWith(`${scene}:`)),
          `scene ${scene} of ${chapter.id} has no baked room`,
        ).toBe(true);
  });
});

describe("validateStoryGraph", () => {
  const base = (nodes: StoryGraphDocument["nodes"]): StoryGraph =>
    new StoryGraph({ schema: "t", start: "a", chapters: [], nodes });
  const cp = { scene: 1, room: 1, x: 55, y: 279, direction: 2 };

  it("reports a node with no way out", () => {
    const problems = validateStoryGraph(
      base([{ id: "a", chapter: "c", title: "a", checkpoint: cp }]),
      worldIndex(),
    );
    expect(problems.join("\n")).toMatch(/no exit/);
  });

  it("reports a closed loop that never reaches a frontier", () => {
    const loop = { kind: "roomEnter", scene: 1, room: 0 } as const;
    const problems = validateStoryGraph(
      base([
        { id: "a", chapter: "c", title: "a", exits: [{ on: loop, to: "b" }] },
        { id: "b", chapter: "c", title: "b", exits: [{ on: loop, to: "a" }] },
      ]),
      worldIndex(),
    );
    expect(problems.join("\n")).toMatch(/closed loop/);
  });

  it("reports missing groups, routes, tasks, unreachable rooms and backward tasks", () => {
    const problems = validateStoryGraph(
      base([
        {
          id: "a",
          chapter: "c",
          title: "a",
          mainTask: 3,
          checkpoint: cp,
          enter: [
            { do: "cutscene", route: "nope" },
            { do: "startMain", task: 999 },
          ],
          exits: [
            { on: { kind: "eventComplete", scene: 1, room: 0, group: 999 }, to: "b" },
            { on: { kind: "roomEnter", scene: 11, room: 28 }, to: "b" },
            { on: { kind: "token", name: "t" }, to: "ghost" },
          ],
        },
        { id: "b", chapter: "c", title: "b", mainTask: 1, frontier: "stop" },
      ]),
      worldIndex(),
    );
    const text = problems.join("\n");
    expect(text).toMatch(/route nope/);
    expect(text).toMatch(/main task 999/);
    expect(text).toMatch(/event group 1:0:999/);
    expect(text).toMatch(/11:28 cannot be reached on foot/);
    expect(text).toMatch(/target node missing/);
    expect(text).toMatch(/backwards \(3 → 1\)/);
  });
});

describe("StoryDirector", () => {
  const graph = new StoryGraph(graphDocument);

  it("walks the opening through the complete Niêm Thổ bundle", () => {
    const director = new StoryDirector(graph, doors);
    expect(director.begin()).toEqual([{ kind: "cutscene", route: "opening-intro" }]);
    expect(director.signal({ kind: "battleWon", scene: 1, room: 1, group: 0 })).toEqual([]);
    expect(director.node.id).toBe("opening");
    director.signal({ kind: "worldEnter" });
    expect(director.node.id).toBe("bunny-capture");
    expect(director.mainTask).toBe(0);
    // A lost fight or the wrong group does not move the story.
    director.signal({ kind: "battleLost", scene: 1, room: 1, group: 0 });
    director.signal({ kind: "battleWon", scene: 1, room: 2, group: 0 });
    expect(director.node.id).toBe("bunny-capture");
    director.signal({ kind: "battleWon", scene: 1, room: 1, group: 0 });
    expect(director.node.id).toBe("return-to-elder");
    expect(director.log.hasToken("scene1.bunnyCaught")).toBe(true);
    // The elder's return dialog is a free-world group, so the edge carries no cutscene: only the
    // quest log moves, and the ladder follows the group's own op45.
    expect(director.signal({ kind: "eventComplete", scene: 1, room: 0, group: 2 })).toEqual([]);
    expect(director.node.id).toBe("elder-challenge");
    expect(director.log.snapshot()).toMatchObject({ main: 1, mainDone: false });
    expect(director.atFrontier).toBe(false);
    // The challenge closes with its own group: op47 branches to the reward records, the group writes
    // 1:0:4 and 1:0:5, its op45 raises the ladder, and only its op14 completes 1:0:6.
    expect(director.signal({ kind: "eventComplete", scene: 1, room: 0, group: 6 })).toEqual([]);
    expect(director.node.id).toBe("road-to-bich-thuy");
    expect(director.log.snapshot()).toMatchObject({ main: 2, mainDone: false });
    expect(director.atFrontier).toBe(false);

    const links = [
      [{ kind: "eventComplete", scene: 2, room: 0, group: 0 }, "help-harry", 3],
      [{ kind: "eventComplete", scene: 11, room: 9, group: 0 }, "supply-shop", 4],
      [{ kind: "eventComplete", scene: 11, room: 8, group: 1 }, "capture-uy-qua", 5],
      [{ kind: "eventComplete", scene: 2, room: 2, group: 0 }, "find-abra", 6],
      [{ kind: "eventComplete", scene: 11, room: 9, group: 1 }, "enter-bich-thuy-gym", 7],
      [{ kind: "eventComplete", scene: 2, room: 1, group: 5 }, "rescue-gym-leader", 8],
      [{ kind: "eventComplete", scene: 2, room: 1, group: 9 }, "rescue-village-elder", 9],
      [{ kind: "eventComplete", scene: 11, room: 14, group: 0 }, "return-to-bich-thuy", 10],
      [{ kind: "eventComplete", scene: 11, room: 9, group: 2 }, "road-to-nguyen-moc", 11],
      [{ kind: "roomEnter", scene: 3, room: 3 }, "nguyen-moc-frontier", 12],
      [{ kind: "eventComplete", scene: 9, room: 1, group: 1 }, "infiltrate-nguyen-moc-manor", 13],
      [{ kind: "eventComplete", scene: 11, room: 13, group: 0 }, "prepare-nguyen-moc-rescue", 14],
      [{ kind: "eventComplete", scene: 11, room: 12, group: 0 }, "rescue-nguyen-moc-manor", 15],
      [{ kind: "eventComplete", scene: 11, room: 0, group: 0 }, "farewell-nguyen-moc", 16],
      [{ kind: "eventComplete", scene: 9, room: 1, group: 2 }, "explore-west-nguyen-moc", 17],
      [{ kind: "eventComplete", scene: 3, room: 5, group: 0 }, "rejoin-yafei", 18],
      [{ kind: "eventComplete", scene: 3, room: 6, group: 3 }, "niem-tho-frontier", 19],
      [{ kind: "eventComplete", scene: 4, room: 5, group: 17 }, "exchange-niem-tho-egg", 20],
      [{ kind: "eventComplete", scene: 4, room: 5, group: 18 }, "challenge-niem-tho-gym", 21],
      [{ kind: "eventComplete", scene: 9, room: 2, group: 1 }, "inspect-airship", 22],
      [{ kind: "eventComplete", scene: 4, room: 8, group: 0 }, "return-to-niem-tho", 23],
      [{ kind: "eventComplete", scene: 4, room: 5, group: 19 }, "road-to-hac-thach", 24],
      [{ kind: "eventComplete", scene: 5, room: 1, group: 0 }, "hac-thach-frontier", 25],
      [{ kind: "eventComplete", scene: 9, room: 4, group: 3 }, "meet-yafei-hac-thach", 26],
      [{ kind: "eventComplete", scene: 5, room: 3, group: 4 }, "hac-thach-lower-gym", 27],
      [{ kind: "eventComplete", scene: 9, room: 5, group: 3 }, "hac-tinh-thach", 28],
      [{ kind: "eventComplete", scene: 5, room: 6, group: 1 }, "phoenix-relic", 29],
      [{ kind: "eventComplete", scene: 1, room: 3, group: 6 }, "tran-phong-story", 30],
      [{ kind: "eventComplete", scene: 1, room: 0, group: 10 }, "sophie-hoa-tinh-thach", 31],
      [{ kind: "eventComplete", scene: 6, room: 1, group: 0 }, "chase-airship", 32],
      [{ kind: "eventComplete", scene: 7, room: 6, group: 4 }, "thien-khong-chi-thanh", 33],
      [{ kind: "eventComplete", scene: 7, room: 3, group: 2 }, "den-thanh-dien", 34],
      [{ kind: "eventComplete", scene: 11, room: 3, group: 2 }, "loi-ky-lan", 35],
      [{ kind: "eventComplete", scene: 10, room: 4, group: 3 }, "doi-canh-troi-xanh", 36],
      [{ kind: "eventComplete", scene: 11, room: 3, group: 4 }, "minh-vuong-long", 37],
      [{ kind: "eventComplete", scene: 10, room: 8, group: 0 }, "tinh-van-hac", 38],
      [{ kind: "eventComplete", scene: 10, room: 7, group: 0 }, "thien-khong-gia-ho", 39],
      [{ kind: "eventComplete", scene: 11, room: 3, group: 5 }, "u-linh-chuong", 40],
      [{ kind: "eventComplete", scene: 9, room: 7, group: 4 }, "thien-dia-truyen-tong", 41],
      [{ kind: "eventComplete", scene: 7, room: 0, group: 0 }, "xuong-hoang-tuyen-1", 42],
      [{ kind: "eventComplete", scene: 10, room: 11, group: 0 }, "xuong-hoang-tuyen-2", 43],
      [{ kind: "eventComplete", scene: 10, room: 12, group: 1 }, "xuong-hoang-tuyen-3", 44],
      [{ kind: "eventComplete", scene: 10, room: 0, group: 1 }, "thoi-gian-truyen-tong", 45],
      [{ kind: "eventComplete", scene: 7, room: 0, group: 1 }, "thien-dia-chi-so", 46],
      [{ kind: "eventComplete", scene: 8, room: 0, group: 4 }, "bat-dau-va-ket-thuc", 47],
    ] as const;
    for (const [signal, node, task] of links) {
      director.signal(signal);
      expect(director.node.id).toBe(node);
      expect(director.log.snapshot()).toMatchObject({ main: task, mainDone: false });
    }
    // `Sc8C2Runtime`: the four guardians (8:6:g0) open the ancient-temple cinematic; when it ends
    // the hero is back in Bạch Long Thành's present, and 1:2:g4's op45 sets the last task.
    expect(director.signal({ kind: "eventComplete", scene: 8, room: 6, group: 0 })).toEqual([
      { kind: "cutscene", route: "ancient-temple-finale" },
    ]);
    expect(director.node.id).toBe("co-dai-than-dien");
    expect(director.signal({ kind: "cutsceneEnd", route: "ancient-temple-finale" })).toEqual([
      { kind: "warp", to: { scene: 7, room: 2, x: 255, y: 224, direction: 1 }, reason: "story" },
      { kind: "save" },
    ]);
    expect(director.node.id).toBe("tro-ve-hien-tai");
    director.signal({ kind: "eventComplete", scene: 1, room: 2, group: 4 });
    expect(director.node.id).toBe("huan-luyen-su-xuat-sac");
    expect(director.log.snapshot()).toMatchObject({ main: 48, mainDone: false });
    expect(director.node.ending).toBe(true);
    expect(director.atFrontier).toBe(false);
    const resumed = new StoryDirector(graph, doors);
    resumed.restore(JSON.parse(JSON.stringify(director.snapshot())));
    expect(resumed.node.id).toBe("huan-luyen-su-xuat-sac");
    expect(resumed.log.snapshot()).toMatchObject({ main: 48, mainDone: false });
  });

  it("resumes from its own record, an old save's activeTask, or the start", () => {
    const a = new StoryDirector(graph, doors);
    a.begin();
    a.signal({ kind: "worldEnter" });
    a.signal({ kind: "battleWon", scene: 1, room: 1, group: 0 });
    const b = new StoryDirector(graph, doors);
    b.restore(JSON.parse(JSON.stringify(a.snapshot())));
    expect(b.snapshot()).toEqual(a.snapshot());

    const old = new StoryDirector(graph, doors);
    old.restore(undefined, "RETURN_TO_ELDER");
    expect(old.node.id).toBe("return-to-elder");
    expect(old.log.main).toBe(0);

    const unknown = new StoryDirector(graph, doors);
    unknown.restore({ node: "deleted-node" }, "NOT_A_TASK");
    expect(unknown.node.id).toBe("opening");
  });

  it("sends the player back to the checkpoint only when the trigger room is out of reach", () => {
    const director = new StoryDirector(graph, doors);
    director.restore(undefined, "RETURN_TO_ELDER");
    expect(director.unstick(1, 1)).toBeNull();
    expect(director.unstick(1, 0)).toBeNull();
    // A room with no door path back to the elder (the opening's temple) is a soft-lock.
    const stuck = director.unstick(5, 3);
    expect(stuck).toEqual({
      kind: "warp",
      to: graph.require("return-to-elder").checkpoint,
      reason: "unstuck",
    });
  });
});

describe("StoryDirector.catchUp", () => {
  const graph = new StoryGraph(graphDocument);
  it("advances a resumed node whose trigger the save's ledger already completed", () => {
    const director = new StoryDirector(graph, doors);
    director.restore({ node: "bunny-capture", main: 0, mainDone: false, branch: "", tokens: "" });
    const done = new Set(["1:1:0", "1:0:2"]);
    expect(director.catchUp((s, r, g) => done.has(`${s}:${r}:${g}`))).toEqual([]);
    expect(director.node.id).toBe("elder-challenge");
    const replayed = director.catchUp(() => true);
    expect(replayed.length).toBeGreaterThan(9);
    expect(replayed.every((action) => action.kind === "save")).toBe(true);
    expect(director.node.id).toBe("huan-luyen-su-xuat-sac");
    expect(director.mainTask).toBe(48);
  });

  it("crosses a cutscene or room exit the ledger proves passed, without replaying it", () => {
    const director = new StoryDirector(graph, doors);
    // A save resumed while the ancient temple's finale played: the cutscene never ends again.
    director.restore({
      node: "co-dai-than-dien",
      main: 47,
      mainDone: false,
      branch: "",
      tokens: "",
    });
    expect(director.catchUp(() => false)).toEqual([]);
    expect(director.node.id).toBe("co-dai-than-dien");
    // Back in Scene 1 the elder's last event (1:2:4) is done: the finale was crossed long ago.
    const actions = director.catchUp((s, r, g) => `${s}:${r}:${g}` === "1:2:4");
    expect(actions.some((action) => action.kind === "warp" || action.kind === "cutscene")).toBe(
      false,
    );
    expect(director.node.id).toBe("huan-luyen-su-xuat-sac");
    expect(director.mainTask).toBe(48);
  });

  it("leaves a cutscene exit alone while the node behind it is still waiting", () => {
    const director = new StoryDirector(graph, doors);
    director.restore({
      node: "co-dai-than-dien",
      main: 47,
      mainDone: false,
      branch: "",
      tokens: "",
    });
    expect(director.catchUp((s, r, g) => `${s}:${r}:${g}` === "8:6:0")).toEqual([]);
    expect(director.node.id).toBe("co-dai-than-dien");
  });
});
