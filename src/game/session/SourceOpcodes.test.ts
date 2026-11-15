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
const { scene1Save } = await import("../../dev/parityCheckpoints");
const { SCENE1_RESUME } = await import("../../persistence/save/migrations");
const { gameplaySources } = await import("./GameplayHost");
const { storyPlaythrough } = await import("./StoryPlaythrough");
const { SourceOpcodeInterpreter } = await import("../story/SourceOpcodeInterpreter");

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
const sources = gameplaySources(assets, boot);
const { playGroup } = storyPlaythrough(sources, assets, boot.sourceEvents);

const compileGroup = (scene: number, room: number, group: number) =>
  new SourceOpcodeInterpreter(boot.sourceEvents).compile({
    id: `world:${scene}:${room}:${group}`,
    groups: [{ sceneId: scene, roomIndex: room, groupIndex: group }],
    startEvent: 0,
  }).events;

/** After Jones' handoff (4:5:g18), with `money` kim tiền. */
function jonesSave(money: number) {
  const save = scene1Save({
    location: { sceneId: 4, roomIndex: 5, x: 120, y: 160, direction: 2 },
    owner: SCENE1_RESUME.elderReturn,
    bunnyCaught: true,
    eventStates: { "1:1:0": 3, "4:5:18": 3 },
    pets: [{ speciesId: 68, level: 30, quality: 2 }],
  });
  return { ...save, currency: { badges: 0, ...save.currency, money } };
}

describe("Jones' exchange (4:5:g15: op79, op84, op83)", () => {
  it("counts the collection, then swaps 5000 kim tiền for a pet egg", async () => {
    const played = await playGroup(jonesSave(20000), 4, 5, 15, { choices: [0] });
    // The dialog pager drops the space it wraps at, as for every line.
    const counts =
      /^Hiện tại đã tìm được (\d+) loại sủng vật, còn (\d+) loại ?chưa đạt được\.$/.exec(
        played.lines[0],
      );
    expect(counts).not.toBeNull();
    expect(Number(counts![1]) + Number(counts![2])).toBe(202);
    expect(played.choices[0].options).toEqual(["Trứng sủng vật - 5000", "Rời đi"]);
    expect(played.saved.currency?.money).toBe(15000);
    expect(played.saved.inventory.specials).toContain(0);
    expect(played.saved.eventStates?.["4:5:15"]).toBe(3);
  }, 60000);

  it("leaves the exchange without charging or granting an egg", async () => {
    const played = await playGroup(jonesSave(160000), 4, 5, 15, { choices: [1] });
    expect(played.saved.currency?.money).toBe(160000);
    expect(played.saved.inventory.specials).not.toContain(0);
    expect(played.saved.inventory.specials).not.toContain(11);
    expect(played.saved.inventory.specials).not.toContain(12);
  }, 60000);

  it("refuses the swap without the money and leaves the group open", async () => {
    const played = await playGroup(jonesSave(100), 4, 5, 15, { choices: [0] });
    expect(played.lines).toContain("Không đủ 5000 tiền để đổi trứng sủng vật.");
    expect(played.saved.currency?.money).toBe(100);
    expect(played.saved.inventory.specials).not.toContain(0);
    expect(played.saved.eventStates?.["4:5:15"]).not.toBe(3);
  }, 60000);
});

describe("compiled records", () => {
  it("op88 sends Senta's reward to the full-storage line (4:2:g2)", () => {
    const events = compileGroup(4, 2, 2),
      full = events.find((event) => event.type === "petsFull");
    expect(full).toBeDefined();
    const target = events[(full as { next: number }).next];
    expect(target).toMatchObject({
      type: "text",
      text: "Sủng vật đã đầy, lưu ý khu trang bị sủng vật của bạn.",
    });
  });

  it("op34 shows the gym preview picture over black (9:0:g5)", () => {
    expect(compileGroup(9, 0, 5)).toContainEqual({
      type: "effect",
      name: "backdrop:ikon-2:0:70",
      ticks: 26,
    });
    expect(boot.effect("ikon-2")).toBeDefined();
  });
});
