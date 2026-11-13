import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/** Pack images are 1x1 stand-ins under Node; the host never reads pixels. */
vi.stubGlobal(
  "Image",
  class {
    complete = true;
    naturalWidth = 1;
    width = 1;
    height = 1;
    src = "";
  },
);
vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(
    import.meta.dirname,
    "../../../public",
    decodeURIComponent(String(input).split("?")[0].replace(/^\//, "")),
  );
  if (!existsSync(file)) return { ok: false, status: 404 };
  const bytes = readFileSync(file);
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(bytes.toString("utf8")),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
  };
});

const { Pack } = await import("../../pack/Pack");
const { loadBootAssets } = await import("../../pack/boot");
const { GameAssets } = await import("../story/GameAssets");
const { MemorySaveStore } = await import("../../persistence/save/SaveStore");
const { SaveRepository } = await import("../../persistence/SaveRepository");
const { SaveService } = await import("../../persistence/SaveService");
const { scene1Save } = await import("../../dev/parityCheckpoints");
const { SCENE1_RESUME } = await import("../../persistence/save/migrations");
const { GameplayHost, gameplaySources } = await import("./GameplayHost");
const { storyPlaythrough } = await import("./StoryPlaythrough");
type GameSave = import("../../persistence/save/GameSave").GameSave;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
const sources = gameplaySources(assets, boot);
const { playGroup, reload, standAt } = storyPlaythrough(sources, assets, boot.sourceEvents);

/** Everything Bích Lam Cốc closed by the return ritual (7:0:g0, task 42). */
const BLC_DONE = [
  ...["3:6:3", "4:0:0", "4:5:12", "4:5:13", "4:5:17", "4:5:18", "4:5:19", "4:8:0", "9:2:1"],
  ...["5:1:0", "9:4:0", "9:4:1", "9:4:2", "9:4:3", "5:3:4", "9:5:0", "9:5:1", "9:5:2", "9:5:3"],
  ...["5:5:1", "5:6:0", "5:6:2", "5:6:1", "1:3:8", "10:13:0", "10:13:1", "10:13:2", "10:14:0"],
  ...["10:14:1", "1:3:6", "1:0:10", "6:0:0", "9:6:0", "9:6:1", "9:6:2", "6:1:0", "4:8:1"],
  ...["11:2:0", "11:2:1", "11:2:2", "7:6:4", "7:3:2", "7:2:1", "11:3:2", "11:3:3", "7:3:3"],
  ...["7:2:7", "7:4:0", "10:1:0", "10:1:3", "10:4:3", "11:3:4", "10:8:1", "10:8:2", "10:8:0"],
  ...["7:8:1", "7:8:2", "10:5:0", "10:5:1", "10:7:0", "11:3:5", "9:7:0", "9:7:1", "9:7:2"],
  ...["9:7:3", "9:7:4", "7:1:0", "7:1:1", "7:0:0", "6:1:1"],
];
const PARTY = [68, 1, 19, 34, 50].map((speciesId) => ({ speciesId, level: 80, quality: 4 }));

function returned(): GameSave {
  const base = new GameplayHost(
      sources,
      new SaveService(new SaveRepository(new MemorySaveStore())),
      { onExit: () => {} },
      {
        kind: "resume",
        save: scene1Save({
          location: { sceneId: 6, roomIndex: 1, x: 160, y: 300, direction: 2 },
          owner: SCENE1_RESUME.bunnyReturnRoom0,
          bunnyCaught: true,
          pets: PARTY,
        }),
      },
    ),
    save = base.snapshot(base.world!),
    badges = [...(save.world?.badgesAchieved ?? [])];
  for (const badge of [0, 1, 2, 3, 4, 5]) badges[badge] = 1;
  return {
    ...save,
    eventStates: { ...save.eventStates, ...Object.fromEntries(BLC_DONE.map((key) => [key, 3])) },
    // Tất Trung Cầu (item 0) for the three captures.
    inventory: { ...save.inventory, items: { ...save.inventory.items, "0": 10 } },
    progress: { ...save.progress, mainTaskProgress: 42 },
    world: { ...save.world!, mainTaskProgress: 42, badgesAchieved: badges },
    story: { ...save.story, quest: { node: "xuong-hoang-tuyen-1" } },
  };
}

const SIDES = [
  [0, 20, 2],
  [0, -16, 0],
  [20, 0, 3],
  [-20, 0, 1],
] as const;

/**
 * Light (5 on each, `tryPuzzleSwitches`) the listed switches of a room in turn, then let the group
 * they open play out; returns the save the room would keep.
 */
async function lightSwitches(save: GameSave, scene: number, room: number, ids: number[]) {
  await assets.prepareRoom(scene, room);
  let current = save;
  for (const id of ids) {
    const actor = assets.getWorldRoom(scene, room)!.actors.find((a) => a.id === id)!;
    let lit = false;
    for (const [dx, dy, dir] of SIDES) {
      const at = await standAt(current, scene, room, actor.x + dx, actor.y + dy, dir);
      at.host.step(["confirm"]);
      for (let i = 0; i < 200; i++) at.host.step([]);
      for (let i = 0; i < 400 && at.world.phase === "event"; i++) at.host.step(["confirm"]);
      const next = at.host.snapshot(at.world);
      if ((next.world?.sourceWorldFlags ?? []).includes(300000 + scene * 10000 + room * 100 + id)) {
        current = next;
        lit = true;
        break;
      }
    }
    if (!lit) throw new Error(`switch ${scene}:${room}:${id} did not light`);
  }
  return current;
}

/** Walk onto each listed floor shape (`XhtC2Runtime.tryStartShapeBreak`) until it breaks. */
async function stepOnShapes(save: GameSave, scene: number, room: number, ids: number[]) {
  await assets.prepareRoom(scene, room);
  let current = save;
  for (const id of ids) {
    const actor = assets.getWorldRoom(scene, room)!.actors.find((a) => a.id === id)!,
      flag = 300000 + scene * 10000 + room * 100 + id;
    let broke = false;
    for (const dy of [2, -2, -6, 6]) {
      const at = await standAt(current, scene, room, actor.x, actor.y + dy, 0);
      // A rect notice under the shape (10:12:g2) may play first; the shape breaks after it.
      for (let round = 0; round < 3; round++) {
        for (let i = 0; i < 120; i++) at.host.step([]);
        for (let i = 0; i < 600 && at.world.phase === "event"; i++) at.host.step(["confirm"]);
      }
      const next = at.host.snapshot(at.world);
      if ((next.world?.sourceWorldFlags ?? []).includes(flag)) {
        current = next;
        broke = true;
        break;
      }
    }
    if (!broke) throw new Error(`shape ${scene}:${room}:${id} did not break`);
  }
  return current;
}

type Played = Awaited<ReturnType<typeof playGroup>>;
let save: GameSave;
const played = new Map<string, Played>();
async function play(scene: number, room: number, group: number, options = {}) {
  const result = await playGroup(save, scene, room, group, options);
  played.set(`${scene}:${room}:${group}`, result);
  save = result.saved;
  return result;
}
const state = (key: string) => save.eventStates?.[key] ?? 0;

describe("Xuống hoàng tuyền 1 (XhtC1Runtime): the Nguyên Mộc mine and Linh Quang Lộc, task 42 → 43", () => {
  it("2:7's switches only answer with the U Linh badge on task 42; lit, they open door 46 for good", async () => {
    const early = returned(),
      locked = {
        ...early,
        progress: { ...early.progress, mainTaskProgress: 41 },
        world: { ...early.world!, mainTaskProgress: 41 },
      };
    await expect(lightSwitches(locked, 2, 7, [47])).rejects.toThrow(/did not light/);
    save = await lightSwitches(returned(), 2, 7, [47, 48, 49, 50]);
    expect(state("2:7:3")).toBe(3);
    const back = reload(save).world;
    expect([47, 48, 49, 50, 46].map((id) => back.actors.get(id)!.state)).toEqual([2, 2, 2, 2, 2]);
  });

  it("10:9's two switch pairs and 10:10's four open the way to Linh Quang Lộc", async () => {
    save = await lightSwitches(save, 10, 9, [3, 4, 5, 6]);
    expect([state("10:9:0"), state("10:9:1")]).toEqual([3, 3]);
    save = await lightSwitches(save, 10, 10, [1, 2, 3, 4]);
    expect(state("10:10:0")).toBe(3);
  });

  it("10:11: knocked out, Linh Quang Lộc grants task 43 and waits; caught on the retry, he leaves", async () => {
    const meet = await play(10, 11, 0);
    expect(meet.battles).toBeGreaterThan(0);
    expect(meet.lines.at(-1)).toMatch(/^Đi Niêm Thổ Thành \[Lối vào di tích\]/);
    expect(save.progress.mainTaskProgress).toBe(43);
    expect(save.story.quest?.node).toBe("xuong-hoang-tuyen-2");
    expect(state("10:11:1")).toBe(0);
    expect(reload(save).world.actors.get(0)!.visible).toBe(true);
    await play(10, 11, 1, { catchFoe: true });
    expect(state("10:11:1")).toBe(3);
    expect(reload(save).world.actors.get(0)!.visible).toBe(false);
  });
});

describe("Xuống hoàng tuyền 2–3 (XhtC2/C3Runtime): Chiến Thần Đà and Tương Quân Giải, task 43 → 45", () => {
  it("4:10's ruins door opens once Linh Quang Lộc is met; 10:12's 28 shapes break underfoot", async () => {
    await play(4, 10, 1);
    expect(state("4:10:0")).toBe(3);
    save = await stepOnShapes(
      save,
      10,
      12,
      Array.from({ length: 28 }, (_, i) => i),
    );
    expect(state("10:12:0")).toBe(3);
    const back = reload(save).world;
    expect(back.actors.get(29)!.visible).toBe(true);
    expect(back.actors.get(5)!.state).toBe(2);
  });

  it("Chiến Thần Đà (10:12:g1) caught: task 44, the mine warning 4:4:g1 retired, the guardian gone", async () => {
    await play(10, 12, 3);
    const guardian = await play(10, 12, 1, { catchFoe: true });
    expect(guardian.lines[0]).toBe("Ha ha! Ha ha ha ha!");
    expect(save.progress.mainTaskProgress).toBe(44);
    expect([state("4:4:1"), state("10:12:4")]).toEqual([3, 3]);
    expect(reload(save).world.actors.get(29)!.visible).toBe(false);
  });

  it("4:4's switches (10, 30) open the mine door; 10:0's ice carries the hero until something stops him", async () => {
    save = await lightSwitches(save, 4, 4, [10, 30]);
    expect(state("4:4:0")).toBe(3);
    await play(10, 0, 0);
    await play(10, 0, 2);
    // `XhtC3Runtime.tickIceWorld`: one step onto terrain 3 and the hero slides on, 8 px a tick.
    const ice = await standAt(save, 10, 0, 40, 290, 2),
      start = ice.world.player.y;
    ice.host.step(["holdUp"]);
    for (let i = 0; i < 40; i++) ice.host.step([]);
    expect(start - ice.world.player.y).toBeGreaterThan(16);
  });

  it("Tương Quân Giải (10:0:g1) knocked out: task 45; caught on the retry (g3), he leaves", async () => {
    const guardian = await play(10, 0, 1);
    expect(guardian.lines.at(-1)).toMatch(/^Trở lại Thiên Giới/);
    expect(save.progress.mainTaskProgress).toBe(45);
    expect(save.story.quest?.node).toBe("thoi-gian-truyen-tong");
    await play(10, 0, 3, { catchFoe: true });
    expect(reload(save).world.actors.get(1)!.visible).toBe(false);
  });
});

describe("Thiên Địa chi sơ (XhtC4, Sc8C1/C2, T42To48Epilogue): task 45 → 48", () => {
  it("Tomas (7:0:g1) leaves with the three guardians won: task 46; the city ritual (7:2:g6) opens the past", async () => {
    const tomas = await play(7, 0, 1);
    expect(tomas.lines[0]).toBe("Ta đã trở về ...");
    expect(save.progress.mainTaskProgress).toBe(46);
    const ritual = await play(7, 2, 6);
    expect(ritual.lines[0]).toBe("Chuẩn bị xong chưa?");
    expect(save.location).toMatchObject({ sceneId: 8, roomIndex: 0 });
    await play(8, 0, 4);
    expect(save.progress.mainTaskProgress).toBe(47);
    expect(save.story.quest?.node).toBe("bat-dau-va-ket-thuc");
  });

  it("Thôn Tachi's side quests: Yajin's beasts (task 28) and Kay's dragon (task 29), with their markers", async () => {
    const village = reload(save).world;
    expect(village.questMarkers).toContainEqual({
      x: village.actors.get(26)!.x,
      y: village.actors.get(26)!.y - 40,
      state: 7,
    });
    await play(8, 0, 0);
    expect(reload(save).world.questMarkers.map((m) => m.state)).toContain(15);
    await play(8, 4, 0);
    const home = await standAt(save, 8, 0, 200, 300, 0);
    expect(home.world.questMarkers.map((m) => m.state)).toContain(1);
    const reward = await play(8, 0, 1);
    expect(reward.lines.at(-1)).toBe("Đạt được: Chocolate x 3");
    await play(8, 0, 2);
    await play(8, 2, 0);
    expect(state("8:2:0")).toBe(3);
    save = {
      ...save,
      inventory: { ...save.inventory, items: { ...save.inventory.items, "5": 20 } },
    };
    const dragon = await play(8, 0, 3);
    expect(dragon.lines.at(-1)).toBe("Tìm được dây cương rồng.");
    expect(save.story.quest?.branch).toContain("29:3");
  });

  it("the Tomas portal takes the hero to the present and back (8:0:g5, 7:2:g8, 7:2:g2, 8:0:g6)", async () => {
    const there = await playGroup(save, 8, 0, 5);
    expect(there.choices[0].options).toEqual(["Đúng vậy", "Tạm thời chưa thể đi"]);
    expect(there.saved.location).toMatchObject({ sceneId: 7, roomIndex: 2 });
    const settled = await playGroup(there.saved, 7, 2, 8);
    const back = await playGroup(settled.saved, 7, 2, 2);
    expect(back.saved.location).toMatchObject({ sceneId: 8, roomIndex: 0 });
  });

  it("the four guardians (8:6:g0) lead into the ancient-temple cinematic; it ends back in Bạch Long Thành", async () => {
    const finale = await play(8, 6, 0);
    expect(finale.lines[0]).toBe(
      "Cần phải quyết định, lúc này không thể làm tổnhại đến những người vô tội!",
    );
    let blank: { x: number; y: number } | null = null;
    for (let i = 0; i < 20000 && (finale.host.layerFor([]) === "cutscene" || i < 5); i++) {
      finale.host.step(["confirm"]);
      // The screen draws this scene (not the opening); Sc8C2's blank tableau centres on (190, 160).
      const shown = finale.host.cutscene;
      if (shown && !blank && shown.renderScene === 0)
        blank = { x: shown.cameraX, y: shown.cameraY };
    }
    expect(blank).toEqual({ x: 70, y: 0 });
    save = finale.host.snapshot(finale.host.world!);
    expect(save.location).toMatchObject({ sceneId: 7, roomIndex: 2, x: 255, y: 224 });
    expect(["0:0:2", "8:6:1", "11:2:3", "8:6:2"].map(state)).toEqual([3, 3, 3, 3]);
    expect(state("7:2:2")).toBe(4);
    expect(save.story.quest?.node).toBe("tro-ve-hien-tai");
  });

  it("the egg hatches (7:2:g3–g5), half a year on Neil leaves home (1:0:g11), and 1:2:g4 sets task 48", async () => {
    for (const [scene, room, group] of [
      [7, 2, 3],
      [7, 2, 4],
      [7, 2, 5],
      [1, 0, 11],
      [1, 2, 4],
    ] as const) {
      await play(scene, room, group);
      expect([`${scene}:${room}:${group}`, state(`${scene}:${room}:${group}`)]).toEqual([
        `${scene}:${room}:${group}`,
        3,
      ]);
    }
    expect(played.get("1:2:4")!.lines[0]).toBe(
      "Tập hợp đủ tất cả sủng vật rồi tìm liên minh sứ giả đạt được Hoàng Kim huy hiệu.",
    );
    expect(save.progress.mainTaskProgress).toBe(48);
    expect(save.story.quest?.node).toBe("huan-luyen-su-xuat-sac");
  });

  it("on task 48, 8:1's portal shows and leads to Cầu Vồng (CauVongChapterRuntime.tryEnterFromTribe)", async () => {
    await assets.prepareRoom(98, 0);
    const tribe = await standAt(save, 8, 1, 202, 300, 2);
    expect(tribe.world.actors.get(12)!.visible).toBe(true);
    for (let i = 0; i < 20 && tribe.world.sceneId === 8; i++) tribe.host.step(["holdUp"]);
    expect([tribe.world.sceneId, tribe.world.roomIndex]).toEqual([98, 0]);
    const before = await standAt(
      {
        ...save,
        progress: { ...save.progress, mainTaskProgress: 47 },
        world: { ...save.world!, mainTaskProgress: 47 },
      },
      8,
      1,
      202,
      300,
      2,
    );
    expect(before.world.actors.get(12)!.visible).toBe(false);
  });
});

describe("dark rooms (VqsvDarkRoomPresentation)", () => {
  it("only 4:3, 4:4 and 5:6 are dark, lit around the hero by the badge radius", async () => {
    const mine = await standAt(returned(), 4, 4, 200, 200, 0);
    expect(mine.world.darkRoomView).toEqual({
      x: mine.world.player.x,
      y: mine.world.player.y - 21,
      radius: 110,
    });
    const open = await standAt(returned(), 4, 5, 200, 200, 0);
    expect(open.world.darkRoomView).toBeNull();
  });
});
