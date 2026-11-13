import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
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
const { GameplayHost, gameplaySources } = await import("../session/GameplayHost");
const { storyPlaythrough } = await import("../session/StoryPlaythrough");
const { WORLD_CHESTS, KEYED_CHESTS } = await import("./JavaRoomRules");
type GameSave = import("../../persistence/save/GameSave").GameSave;
const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
const sources = gameplaySources(assets, boot);
const { standAt } = storyPlaythrough(sources, assets, boot.sourceEvents);

function baseSave(): GameSave {
  const base = new GameplayHost(
    sources,
    new SaveService(new SaveRepository(new MemorySaveStore())),
    { onExit: () => {} },
    {
      kind: "resume",
      save: scene1Save({
        location: { sceneId: 1, roomIndex: 0, x: 200, y: 200, direction: 1 },
        owner: SCENE1_RESUME.bunnyReturnRoom0,
        bunnyCaught: true,
        pets: [{ speciesId: 68, level: 45, quality: 2 }],
      }),
    },
  );
  const save = base.snapshot(base.world!);
  // Mộc Quỳ Chương (1): without it a load into Nguyên Mộc's tree-blocked 3:1 is sent to its entry.
  const badges = [...(save.world?.badgesAchieved ?? [])];
  badges[1] = 1;
  // The story's last node: no anti-stuck checkpoint pulls a load in Thôn Tachi (8:x) back.
  return {
    ...save,
    world: { ...save.world!, badgesAchieved: badges },
    story: { ...save.story, quest: { node: "huan-luyen-su-xuat-sac" } },
  };
}

const SIDES = [
  [0, 20, 2],
  [0, -16, 0],
  [20, 0, 3],
  [-20, 0, 1],
] as const;
let lastSide = 0;

/**
 * Stand beside `actor` facing it, from whichever side opens it (`side` forces one), and press 5.
 * With `anyEvent` any event counts (the empty notice); otherwise the chest itself must open.
 */
async function faceAndConfirm(
  save: GameSave,
  scene: number,
  room: number,
  id: number,
  anyEvent = false,
  side?: number,
) {
  await assets.prepareRoom(scene, room);
  const actor = assets.getWorldRoom(scene, room)!.actors.find((a) => a.id === id)!;
  for (let i = 0; i < SIDES.length; i++) {
    if (side !== undefined && i !== side) continue;
    const [dx, dy, dir] = SIDES[i],
      at = await standAt(save, scene, room, actor.x + dx, actor.y + dy, dir);
    at.host.step(["confirm"]);
    if (at.world.eventScene && (anyEvent || at.world.actors.get(id)?.state === 1)) {
      lastSide = i;
      return at;
    }
  }
  return null;
}

describe("world chests (Scene1ThreeMapInteractionRuntime.tryStartChest and its callers)", () => {
  it("every wired chest opens once with its source reward, stays open on reload, then is empty", async () => {
    const rows = boot.sourceEvents,
      wrong: unknown[] = [];
    let opened = 0;
    for (const [room, ids] of Object.entries(WORLD_CHESTS)) {
      const [scene, index] = room.split(":").map(Number);
      for (const id of ids) {
        const values = rows.room(scene, index)!.actors[id].values,
          quantity = values[7],
          itemId = values[9],
          save = baseSave(),
          before = save.inventory.items[String(itemId)] ?? 0,
          open = await faceAndConfirm(save, scene, index, id),
          side = lastSide;
        if (!open) {
          wrong.push(["unreachable", room, id]);
          continue;
        }
        for (let i = 0; i < 60 && !open.world.eventScene?.textReady; i++) open.host.step([]);
        const text = open.world.eventScene?.currentText ?? "";
        for (let i = 0; i < 200 && open.world.eventScene; i++) open.host.step(["confirm"]);
        const after = open.host.snapshot(open.world);
        if (!/^Đạt được: .+ x \d+$/.test(text) || !text.endsWith(` x ${quantity}`))
          wrong.push(["text", room, id, text]);
        if ((after.inventory.items[String(itemId)] ?? 0) !== before + quantity)
          wrong.push(["reward", room, id, after.inventory.items[String(itemId)]]);
        if (!after.world?.openedChests?.includes(`${room}:${id}`)) wrong.push(["key", room, id]);
        const again = await faceAndConfirm(after, scene, index, id, true, side);
        if (again?.world.actors.get(id)?.state !== 1) wrong.push(["reload state", room, id]);
        for (let i = 0; i < 60 && again && !again.world.eventScene?.textReady; i++)
          again.host.step([]);
        if (again?.world.eventScene?.currentText !== "Bảo rương này đã trống")
          wrong.push(["empty", room, id, again?.world.eventScene?.currentText]);
        opened++;
      }
    }
    expect(wrong).toEqual([]);
    expect(opened).toBe(36);
  }, 900000);

  it("3:2's keyed chest needs a Chìa khóa vàng, spends it and gives 2 of item 2", async () => {
    const keyed = KEYED_CHESTS["3:2"],
      none = await faceAndConfirm(baseSave(), 3, 2, keyed.actor, true);
    for (let i = 0; i < 60 && none && !none.world.eventScene?.textReady; i++) none.host.step([]);
    expect(none?.world.eventScene?.currentText).toBe(
      "Không có cái chìa khóa, có thể đến tài liệu cửa hàng mua sắm",
    );
    const withKey = baseSave();
    withKey.inventory = {
      ...withKey.inventory,
      materials: { ...withKey.inventory.materials, "17": 1 },
    };
    const open = await faceAndConfirm(withKey, 3, 2, keyed.actor);
    for (let i = 0; i < 200 && open?.world.eventScene; i++) open!.host.step(["confirm"]);
    const after = open!.host.snapshot(open!.world);
    expect(after.inventory.materials?.["17"] ?? 0).toBe(0);
    expect(after.inventory.items["2"] ?? 0).toBe((withKey.inventory.items["2"] ?? 0) + 2);
    expect(after.world?.openedChests).toContain("3:2:13");
  }, 300000);

  it("a chest no JavaSE runtime wires (Bích Lam Cốc 7:3:21) does not open", async () => {
    expect(await faceAndConfirm(baseSave(), 7, 3, 21)).toBeNull();
  });
});
