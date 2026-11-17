import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

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
const { platformShore } = await import("../world/PlatformRide");
type GameSave = import("../../persistence/save/GameSave").GameSave;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
const sources = gameplaySources(assets, boot);
const { playGroup, reload, standAt } = storyPlaythrough(sources, assets, boot.sourceEvents);

/** Everything the main line has closed by the landing in Thiên Giới (7:6:g4, task 33). */
const DONE_BY_LANDING = [
  ...["3:6:3", "4:0:0", "4:5:12", "4:5:13", "4:5:17", "4:5:18", "4:5:19", "4:8:0", "9:2:1"],
  ...["5:1:0", "9:4:0", "9:4:1", "9:4:2", "9:4:3", "5:3:4", "9:5:0", "9:5:1", "9:5:2", "9:5:3"],
  ...["5:5:1", "5:6:0", "5:6:2", "5:6:1", "1:3:8", "10:13:0", "10:13:1", "10:13:2", "10:14:0"],
  ...["10:14:1", "1:3:6", "1:0:10", "6:0:0", "9:6:0", "9:6:1", "9:6:2", "6:1:0", "4:8:1"],
  ...["11:2:0", "11:2:1", "11:2:2", "7:6:4"],
];

/** A save standing in Thiên Giới on task 33, with a level-45 party of four. */
function landed(
  task = 33,
  node = "thien-khong-chi-thanh",
  extra: string[] = [],
  pets: { speciesId: number; level: number; quality: number }[] = [
    { speciesId: 68, level: 45, quality: 2 },
    { speciesId: 19, level: 45, quality: 2 },
  ],
): GameSave {
  const base = new GameplayHost(
      sources,
      new SaveService(new SaveRepository(new MemorySaveStore())),
      { onExit: () => {} },
      {
        kind: "resume",
        save: scene1Save({
          location: { sceneId: 7, roomIndex: 6, x: 48, y: 192, direction: 1 },
          owner: SCENE1_RESUME.bunnyReturnRoom0,
          bunnyCaught: true,
          pets,
        }),
      },
    ),
    save = base.snapshot(base.world!);
  return {
    ...save,
    eventStates: {
      ...save.eventStates,
      ...Object.fromEntries([...DONE_BY_LANDING, ...extra].map((key) => [key, 3])),
    },
    progress: { ...save.progress, mainTaskProgress: task },
    world: { ...save.world!, mainTaskProgress: task },
    story: { ...save.story, quest: { node } },
  };
}

type Played = Awaited<ReturnType<typeof playGroup>>;

/** Level 80 with the four Địa Giới elements (thủy, hỏa, mộc, thổ) Karen checks for (7:3:0). */
const PARTY = [1, 19, 34, 50].map((speciesId) => ({ speciesId, level: 80, quality: 4 }));

/**
 * The chapter in JavaSE's order, one save carried from group to group: each `play` resumes the save
 * the last group left (as a reload would), plays the next group and keeps what it saved.
 */
let save: GameSave;
const played = new Map<string, Played>();
async function play(scene: number, room: number, group: number, options = {}) {
  const result = await playGroup(save, scene, room, group, options);
  played.set(`${scene}:${room}:${group}`, result);
  save = result.saved;
  return result;
}
const state = (key: string) => save.eventStates?.[key] ?? 0;
const visible = (world: { actors: Map<number, { visible: boolean }> }, ids: number[]) =>
  ids.map((id) => world.actors.get(id)?.visible);

beforeAll(() => {
  save = landed(33, "thien-khong-chi-thanh", [], PARTY);
});

describe("Bích Lam Cốc C1 (BlcC1Runtime): Sophie, the city and the temple, task 33 → 35", () => {
  it("7:3:g2 finds Sophie: task 34, and a reload keeps the guards gone and Sophie facing left", async () => {
    const reveal = await play(7, 3, 2);
    expect(reveal.lines[0]).toBe("Sophie!");
    expect(reveal.lines.at(-2)).toBe("Đến [Vĩnh Hằng Đích Kinh Phiên] thăm dò tình hình.");
    expect(state("7:3:2")).toBe(3);
    expect(save.progress.mainTaskProgress).toBe(34);
    expect(save.story.quest).toMatchObject({ node: "den-thanh-dien", main: 34 });
    const back = reload(save).world;
    expect(visible(back, [23, 24, 25])).toEqual([false, false, true]);
    expect(back.actors.get(25)!.direction).toBe(3);
    // `tryLeftTransitions`: the door down to the cloud route (7:4) stays shut until 7:3:g3.
    expect(state("7:3:3")).toBe(0);
  });

  it("7:2:g1 reaches the city: Bạch Bảo Châu glows and Sophie has gone on ahead", async () => {
    const city = await play(7, 2, 1);
    expect(city.lines[0]).toBe("Đây là Bạch Bảo Châu sao? Lớn thật!");
    expect(city.lines.at(-1)).toBe("Đến Thánh Điện.");
    const back = reload(save).world;
    expect(back.actors.get(61)!.visible).toBe(false);
    expect(back.actors.get(60)!.state).toBe(2);
  });

  it("11:3:g2 and g3 in the temple: task 35, the four extras gone, the barrier 7:3:g3 lifted", async () => {
    const temple = await play(11, 3, 2);
    expect(temple.lines.at(-1)).toBe("Đến [Phiêu phi đích vũ linh] thức tỉnh Lôi Kỳ Lân.");
    expect(save.progress.mainTaskProgress).toBe(35);
    await play(11, 3, 3);
    expect(state("11:3:3")).toBe(3);
    expect(state("7:3:3")).toBe(3);
    expect(visible(reload(save).world, [18, 20, 21, 22])).toEqual([false, false, false, false]);
  });
});

describe("Bích Lam Cốc C1 side quests: Karen's four elements and the lucky fruits", () => {
  it("7:3:g0/g1: Karen checks for thủy, hỏa, mộc and thổ, then fights them (task 22)", async () => {
    const check = await play(7, 3, 0);
    expect(check.lines).toContain(
      "Trong hành trang phải có ít nhất sủng vật mang các thuộc tính thủy, hỏa, mộc, thổ.",
    );
    expect(check.host.director!.log.branchStatus(22)).toBe(1);
    const fight = await play(7, 3, 1);
    expect(fight.battles).toBeGreaterThan(0);
    expect(state("7:3:1")).toBe(3);
    expect(fight.host.director!.log.branchStatus(22)).toBe(3);
  });

  it("the lucky fruit runs Karen → Doranle → Karen → Camille → Karen → Aimie (tasks 24, 25, 26)", async () => {
    for (const [scene, room, group] of [
      [7, 6, 0],
      [11, 3, 0],
      [7, 6, 1],
      [11, 3, 1],
      [7, 6, 2],
    ] as const) {
      await play(scene, room, group);
      expect(state(`${scene}:${room}:${group}`)).toBe(3);
    }
    expect(played.get("11:3:0")!.lines[0]).toBe(
      "Doranle bệ hạ. Đây là thứ Karen nhờ tôi giao chongài.",
    );
    expect(played.get("11:3:1")!.lines.at(-1)).toBe("Đạt được: Cao cấp cầu x 2");
    // 21:1 is the resume repair (`recoverBranchTasks`): the fixture's ledger has Jani Las's offer
    // 5:5:g1 ended in op14, which only "Tiếp nhận" reaches.
    expect(save.story.quest?.branch).toBe("21:1,22:3,24:3,25:3,26:1");
    // `AimieFruitCompletion` reads flag 20, the fruit Karen hands over in 7:6:g2.
    expect(save.world?.sourceWorldFlags).toContain(20);
  });

  it("7:6:g3 (task 27) waits for Aimie's fruit; MeterLu (7:6:g5) and the 7:5 trainer fight", async () => {
    const early = await playGroup(save, 7, 6, 3);
    expect(early.world.eventState.sourceEventState(7, 6, 3)).toBe(0);
    for (const [scene, room, group] of [
      [7, 6, 5],
      [7, 5, 0],
    ] as const) {
      const fight = await play(scene, room, group);
      expect(fight.battles).toBeGreaterThan(0);
      expect(state(`${scene}:${room}:${group}`)).toBe(3);
    }
  });
});

describe("Bích Lam Cốc C2 (BlcC2Runtime): the cloud route, the laser hall and Lôi Kỳ Lân, task 35 → 37", () => {
  it("7:4:g0 on the cloud route, then the laser hall's introduction (10:1:g0, g3)", async () => {
    const route = await play(7, 4, 0);
    expect(route.battles).toBeGreaterThan(0);
    const intro = await play(10, 1, 0);
    expect(intro.lines).toContain(
      "Dùng tia laser có thể thông qua. Nếu bạn vô tình đẩy sai, có thể nhấn vào nút màu trắng để phục hồi.",
    );
    await play(10, 1, 3);
    expect(state("10:1:3")).toBe(3);
  });

  it("the laser stops the hero; blocks are saved where they stand and the white button resets them", async () => {
    // `RouteDemonstrationMove`: the introduction pushed block 2 from its gate (112,208) to 144.
    expect(save.world?.actorPositions).toContainEqual([10, 1, 2, 112, 144]);
    expect(reload(save).world.actors.get(2)).toMatchObject({ x: 112, y: 144 });
    const blocked = await standAt(save, 10, 1, 72, 200, 2);
    expect(blocked.world.laserBeamFor(0)).toMatchObject({ vertical: false, y: 134, length: 144 });
    for (let i = 0; i < 20; i++) blocked.host.step(["holdUp"]);
    expect(blocked.world.player.y).toBe(172);

    // The introduction left the block above the beam, so the way through starts at the white
    // button (actor 3, op57 [2,112,208,3]): `VqsvSourceLaserRuntime` puts the block back on its gate.
    const reset = await standAt(save, 10, 1, 72, 290, 2);
    for (let i = 0; i < 30; i++) reset.host.step(i < 12 ? ["holdUp"] : ["confirm"]);
    expect(reset.world.actors.get(2)).toMatchObject({ x: 112, y: 208 });
    const gate = reset.host.snapshot(reset.world);
    // Back on its room row, the block's saved position is forgotten (`forgetActorPosition`).
    expect(
      gate.world?.actorPositions?.some(([sc, r, id]) => sc === 10 && r === 1 && id === 2),
    ).toBe(false);

    // Pushed up until the beam stops it, the block cuts the beam at its right edge, the hero walks
    // through on its left, and a reload finds the block where it was left.
    const push = await standAt(gate, 10, 1, 112, 240, 2);
    for (let i = 0; i < 30; i++) push.host.step(["holdUp"]);
    expect(push.world.actors.get(2)!.y).toBe(156);
    expect(push.world.laserBeamFor(0)).toMatchObject({ x: 127, length: 64 });
    for (let i = 0; i < 8; i++) push.host.step(["holdLeft"]);
    for (let i = 0; i < 30; i++) push.host.step(["holdUp"]);
    expect(push.world.player.y).toBeLessThan(134);
    const pushed = push.host.snapshot(push.world);
    expect(pushed.world?.actorPositions).toContainEqual([10, 1, 2, 112, 156]);
    expect(reload(pushed).world.actors.get(2)).toMatchObject({ x: 112, y: 156 });
  });

  it("10:4:g3: Lôi Kỳ Lân's challenge brings task 36, and Tomas's wings (11:3:g4) task 37", async () => {
    const guardian = await play(10, 4, 3);
    expect(guardian.lines[0]).toBe("Một con người mang theo Hắc Long thú tìm ta, cóchuyện gì?");
    expect(guardian.lines.at(-1)).toBe("Trở lại [Vĩnh Hằng Đích Kinh Phiên] Thánh Điện tìm Tomas.");
    expect(save.progress.mainTaskProgress).toBe(36);
    const wings = await play(11, 3, 4);
    expect(wings.lines).toContain("Đạt được: Dây cương cưỡi sủng 3 x 1");
    expect(save.progress.mainTaskProgress).toBe(37);
  });
});

describe("Bích Lam Cốc C3 (BlcC3Runtime): the sky route, Minh Vương Long and Tinh Vân Hạc, task 37 → 40", () => {
  it("7:8:g0: Aimie takes the fruit (flag 20 spent, task 26 done), which opens task 27 (7:6:g3)", async () => {
    const aimie = await play(7, 8, 0);
    expect(aimie.lines.length).toBeGreaterThan(0);
    expect(state("7:8:0")).toBe(3);
    expect(save.world?.sourceWorldFlags ?? []).not.toContain(20);
    expect(save.story.quest?.branch).toContain("26:3");
    await play(7, 6, 3);
    expect(state("7:6:3")).toBe(3);
  });

  it("the sky route's trainers and the quiz: only the right answer (the fourth) closes 7:10:g1", async () => {
    await play(7, 9, 1);
    const offer = await play(7, 10, 0);
    expect(offer.lines[0]).toMatch(/^Thiên Giới Bạch Long thần có ba con thú giữ nhà/);
    const wrong = await playGroup(save, 7, 10, 1, { choices: [0] });
    expect(wrong.choices[0].options).toHaveLength(4);
    expect(wrong.world.eventState.sourceEventState(7, 10, 1)).not.toBe(3);
    await play(7, 10, 1, { choices: [3] });
    expect(state("7:10:1")).toBe(3);
    for (const [scene, room, group] of [
      [7, 10, 2],
      [7, 11, 0],
      [7, 12, 0],
      [7, 12, 1],
    ] as const) {
      const fight = await play(scene, room, group);
      expect(fight.battles).toBeGreaterThan(0);
      expect([`${scene}:${room}:${group}`, state(`${scene}:${room}:${group}`)]).toEqual([
        `${scene}:${room}:${group}`,
        3,
      ]);
    }
  });

  it("10:8: the save prompt raises Minh Vương Long (task 38); reload keeps it risen", async () => {
    await play(10, 8, 1);
    await play(10, 8, 2);
    expect([state("10:8:1"), state("10:8:2"), save.progress.mainTaskProgress]).toEqual([3, 3, 37]);
    const rise = await play(10, 8, 0);
    expect(rise.lines[0]).toBe("Xuất hiện rồi! Minh Vương Long.");
    expect(save.progress.mainTaskProgress).toBe(38);
    expect(visible(reload(save).world, [5, 6])).toEqual([false, true]);
    await play(7, 8, 2);
    expect(state("7:8:1")).toBe(3);
  });

  it("10:5: a vortex spins the hero and sends him back to where he entered the room", async () => {
    const { host, world } = await standAt(save, 10, 5, 119, 296, 0);
    const vortex = world.actors.get(1)!;
    Object.assign(world.player, { x: vortex.x, y: vortex.y });
    for (let i = 0; i < 40; i++) host.step([]);
    expect(world.player).toMatchObject({ x: 119, y: 296 });
  });

  it("10:5's vortex warning is Neil's line (BlcC3Runtime.NoticeThenFinish)", async () => {
    const { host, world } = await standAt(save, 10, 5, 120, 282, 2);
    for (let i = 0; i < 60 && !world.eventScene?.textReady; i++) host.step([]);
    expect(world.eventScene?.currentText).toMatch(/^Trông thấy sự chuyển động/);
    expect(world.eventScene?.currentSpeaker).toBe("Neil");
  });

  it("10:5's vortices, Tinh Vân Hạc (10:7:g0, task 39) and Tomas (11:3:g5, task 40)", async () => {
    await play(10, 5, 0);
    await play(10, 5, 1);
    const crane = await play(10, 7, 0);
    expect(crane.lines.at(-1)).toBe("Trở lại [Vĩnh Hằng Đích Kinh Phiên] Thánh Điện tìm Tomas.");
    expect(save.progress.mainTaskProgress).toBe(39);
    const tomas = await play(11, 3, 5);
    expect(tomas.lines.at(-1)).toBe("Đến [Thiên Giới Đạo Quán] lấy U Linh Chương.");
    expect(save.progress.mainTaskProgress).toBe(40);
  });
});

// The gym's five fights are real 2v2s now (played through their menus).
describe(
  "Bích Lam Cốc C4 (BlcC4Runtime): the gym, the U Linh badge and the way home, task 40 → 42",
  { timeout: 120_000 },
  () => {
    it("Tomas only has his line before the badge, and 7:1's barrier turns the hero back", async () => {
      const temple = await standAt(save, 7, 0, 159, 111, 2);
      temple.host.step(["confirm"]);
      expect(temple.world.npcDialog?.speaker).toBe("Tomas");
      for (let i = 0; i < 40 && temple.world.npcDialog?.text !== "Ta sẽ lại đợi cậu."; i++)
        temple.host.step([]);
      expect(temple.world.npcDialog?.text).toBe("Ta sẽ lại đợi cậu.");
      expect(temple.world.activeEventGroup).toBeNull();

      const route = await standAt(save, 7, 1, 128, 290, 0);
      for (let i = 0; i < 6; i++) route.host.step(["holdDown"]);
      for (let i = 0; i < 300 && route.world.phase === "event"; i++) route.host.step(["confirm"]);
      expect(route.world.player.y).toBeLessThan(288);
      expect(route.world.eventState.sourceEventState(7, 1, 1)).not.toBe(3);
    });

    it("doors: 7:1 → temple and 7:0 → Địa Giới stay shut; the gym's clouds reset on the entrance island", async () => {
      const route = await standAt(save, 7, 1, 128, 316, 0);
      for (let i = 0; i < 10; i++) route.host.step(["holdDown"]);
      expect([route.world.sceneId, route.world.roomIndex]).toEqual([7, 1]);
      const temple = await standAt(save, 7, 0, 160, 436, 0);
      for (let i = 0; i < 10; i++) temple.host.step(["holdDown"]);
      expect([temple.world.sceneId, temple.world.roomIndex]).toEqual([7, 0]);

      // `resetGymCloudsForRoomEntry`: a save on the entrance island (y >= 320) with a cloud left at a
      // far shore loads with every cloud back on its room row.
      const drifted = {
          ...save,
          world: {
            ...save.world!,
            actorPositions: [[9, 7, 4, 120, 270] as [number, number, number, number, number]],
          },
        },
        gym = await standAt(drifted, 9, 7, 104, 340, 2);
      expect(gym.world.actors.get(4)).toMatchObject({ x: 206, y: 270 });
      expect(gym.host.snapshot(gym.world).world?.actorPositions ?? []).toEqual([]);

      // Web fix: a cloud remembered off the track its row sails today (a save from before the APK
      // maps) starts on its row; one remembered on the track stays where it was left.
      const stale = {
          ...save,
          world: {
            ...save.world!,
            actorPositions: [[7, 1, 3, 168, 132] as [number, number, number, number, number]],
          },
        },
        route2 = await standAt(stale, 7, 1, 128, 316, 0);
      expect(route2.world.actors.get(3)).toMatchObject({ x: 128, y: 132, visible: true });
      expect(route2.host.snapshot(route2.world).world?.actorPositions ?? []).toEqual([]);
      const kept = {
          ...save,
          world: {
            ...save.world!,
            actorPositions: [[7, 1, 3, 128, 160] as [number, number, number, number, number]],
          },
        },
        route3 = await standAt(kept, 7, 1, 128, 316, 0);
      expect(route3.world.actors.get(3)).toMatchObject({ x: 128, y: 160 });
    });

    it("the gym's five trainers fight strictly in order; the leader awards U Linh and task 41", async () => {
      const early = await playGroup(save, 9, 7, 1);
      expect(early.world.eventState.sourceEventState(9, 7, 1)).toBe(0);
      for (const group of [0, 1, 2, 3, 4]) {
        await play(9, 7, group);
        expect(state(`9:7:${group}`)).toBe(3);
      }
      expect(played.get("9:7:0")!.lines).toEqual([
        "Chúng ta không hoan nghênh con người.",
        "Con người luôn phách lối không biết lượng sức.",
      ]);
      expect(played.get("9:7:4")!.awards).toEqual([5]);
      expect(save.progress.mainTaskProgress).toBe(41);
    });

    it("web-only: a stranded hero talks to the gym leader and is taken back with the clouds reset", async () => {
      // The leader on the centre island, his fight won, cloud 4 left at the far shore.
      const stranded = {
          ...save,
          world: {
            ...save.world!,
            actorPositions: [[9, 7, 4, 206, 270] as [number, number, number, number, number]],
          },
        },
        { host, world } = await standAt(stranded, 9, 7, 125, 178, 2);
      expect(world.talkPrompt?.actorId).toBe(6);
      host.step(["confirm"]);
      for (let i = 0; i < 400 && world.player.y < 320; i++)
        host.step(i % 20 === 19 ? ["confirm"] : []);
      expect([world.sceneId, world.roomIndex]).toEqual([9, 7]);
      expect(world.player.y).toBeGreaterThanOrEqual(320);
      expect([1, 2, 3, 4].map((id) => [world.actors.get(id)!.x, world.actors.get(id)!.y])).toEqual([
        // Cloud 1 rests at the entrance island's shore, where the hero now stands.
        [21, 319],
        [81, 52],
        [248, 116],
        [206, 270],
      ]);
    });

    it("the badge lifts 7:1's barrier, and Tomas's return ritual (7:0:g0) brings task 42", async () => {
      await play(7, 1, 0);
      expect(state("7:1:1")).toBe(3);
      // `tryStartReturnRitual`: only Tomas's activation (actor 19) starts it.
      const away = await standAt(save, 7, 0, 160, 300, 0);
      for (let i = 0; i < 5; i++) away.host.step(["confirm"]);
      expect(away.world.activeEventGroup).toBeNull();
      const ritual = await play(7, 0, 0);
      expect(ritual.lines[0]).toBe("Đã lấy được U Linh Chương rồi hả?");
      expect(ritual.lines.at(-1)).toBe(
        "Đi phía bắc Nguyên Mộc Thành [Nguyên Mộc Quặng Mỏ] tìm kiếm Linh Quang Lộc.",
      );
      expect(save.progress.mainTaskProgress).toBe(42);
      expect(save.story.quest).toMatchObject({ node: "xuong-hoang-tuyen-1", main: 42 });
      expect(reload(save).host.director?.node.id).toBe("xuong-hoang-tuyen-1");
      expect(state("6:1:1")).toBe(3);
      // `tryTempleTransition`: after the ritual 7:0's door 17 leads down to Địa Giới (6:1).
      const home = await standAt(save, 7, 0, 160, 436, 0);
      for (let i = 0; i < 40 && home.world.sceneId === 7; i++) home.host.step(["holdDown"]);
      expect([home.world.sceneId, home.world.roomIndex]).toEqual([6, 1]);
      expect(visible(reload(save).world, [19, 20, 21, 22, 23, 24])).toEqual(Array(6).fill(true));
      // XhtC4's 7:0:g1 needs the three guardians; on task 42 Tomas is back to his line.
      expect((await playGroup(save, 7, 0, 1)).world.eventState.sourceEventState(7, 0, 1)).toBe(0);
    });
  },
);

describe("clouds can be called back like lotus leaves (web-only, owner 2026-11-13)", () => {
  type Cloud = { x: number; y: number; variant: number; sprite: number; state: number };
  type Probe = {
    actors: Map<number, Cloud>;
    player: { x: number; y: number };
    phase: string;
    leafSummon: unknown;
    flags: { actorPosition(s: number, r: number, a: number): { x: number; y: number } | undefined };
    currentMap(): unknown;
    platformMask(actor: Cloud): unknown;
    sources: { room(s: number, r: number): { actors: { id: number; x: number; y: number }[] } };
  };
  const DIRS = { down: 0, right: 1, up: 2, left: 3 } as const;

  /**
   * Park cloud `id` on one shore, then look for a bank spot at the other where stepping toward the
   * sky calls it: true once the cloud has sailed back to that bank.
   */
  async function callBack(scene: number, room: number, id: number): Promise<boolean> {
    const { host, world } = (await standAt(landed(41), scene, room, 120, 160, 2)) as unknown as {
      host: { step(c: string[]): void };
      world: Probe;
    };
    const cloud = world.actors.get(id)!,
      row = world.sources.room(scene, room).actors.find((r) => r.id === id)!,
      map = world.currentMap() as Parameters<typeof platformShore>[0],
      mask = world.platformMask(cloud) as Parameters<typeof platformShore>[2],
      lanes: [keyof typeof DIRS, keyof typeof DIRS][] =
        cloud.variant === 9
          ? [
              ["left", "right"],
              ["right", "left"],
            ]
          : [
              ["up", "down"],
              ["down", "up"],
            ];
    for (const [bankSide, far] of lanes) {
      const bank = platformShore(map, cloud, mask, row, DIRS[bankSide]),
        away = platformShore(map, cloud, mask, row, DIRS[far]),
        step = {
          dx: far === "right" ? 1 : far === "left" ? -1 : 0,
          dy: far === "down" ? 1 : far === "up" ? -1 : 0,
        };
      if (bank.x === away.x && bank.y === away.y) continue;
      for (let side = -24; side <= 24; side += 4)
        for (let back = 8; back <= 56; back += 4) {
          Object.assign(cloud, { x: away.x, y: away.y, state: 0 });
          world.leafSummon = null;
          world.player.x = bank.x - step.dx * back + (step.dy !== 0 ? side : 0);
          world.player.y = bank.y - step.dy * back + (step.dx !== 0 ? side : 0);
          host.step([far]);
          if (!world.leafSummon) continue;
          for (let i = 0; i < 200 && world.leafSummon; i++) host.step([]);
          return cloud.x === bank.x && cloud.y === bank.y;
        }
    }
    return false;
  }

  it("7:1's cloud (3), which JavaSE never re-stages, comes back to the hero's bank", async () => {
    expect(await callBack(7, 1, 3)).toBe(true);
  }, 60000);

  it("7:4's route clouds come back too", async () => {
    expect(await callBack(7, 4, 2)).toBe(true);
  }, 60000);

  it("Thiên Giới Đạo Quán's clouds (9:7) are the gym's course and never answer", async () => {
    for (const id of [1, 2, 4]) expect(await callBack(9, 7, id)).toBe(false);
  }, 120000);
});
