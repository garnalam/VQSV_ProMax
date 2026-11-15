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

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
const sources = gameplaySources(assets, boot);
const GUARANTEED = String(assets.worldContract.items.guaranteedBall),
  SEAL = String(assets.worldContract.items.sealBall);

/** Walk into the bunny with `items` in the bag and play the lesson (confirm on every prompt). */
function playBunny(items: Record<string, number>) {
  const data = assets.worldContract,
    save = scene1Save({
      location: { sceneId: 1, roomIndex: 1, x: data.trigger.x, y: data.trigger.y, direction: 0 },
      owner: SCENE1_RESUME.bunnyCapture,
      bunnyCaught: false,
      pets: [{ speciesId: 68, level: 7, quality: 2 }],
    });
  save.inventory.items = { ...items };
  const host = new GameplayHost(
    sources,
    new SaveService(new SaveRepository(new MemorySaveStore())),
    { onExit: () => {} },
    { kind: "resume", save },
  );
  while (host.mapLoadingActive) host.step([]);
  const world = host.world!;
  let mostGuaranteed = 0;
  for (let i = 0; i < 3000 && world.phase !== "returnWorld"; i++) {
    const stage = world.battleVisible ? world.battleStage : "";
    mostGuaranteed = Math.max(
      mostGuaranteed,
      world.battle?.catchChoice(world.inventory)?.quantity ?? 0,
    );
    host.step(
      ["skillAction", "switching", "captureFail", "runExit"].includes(stage) || i % 2
        ? []
        : ["confirm"],
    );
  }
  return { world, mostGuaranteed };
}

describe("the bunny lesson's balls (JavaSE seeds a Tất Trung Cầu when the catch list is empty)", () => {
  it("plays the lesson as written with the starting bag", () => {
    const { world } = playBunny({ [GUARANTEED]: 1, [SEAL]: 2, "4": 5 });
    expect(world.phase).toBe("returnWorld");
    expect(world.pets.map((pet) => pet.speciesId)).toContain(34);
  });

  it.each([
    ["no balls at all", { [GUARANTEED]: 0, [SEAL]: 0 }],
    ["seal balls but no Tất Trung Cầu", { [GUARANTEED]: 0, [SEAL]: 2 }],
    ["a Tất Trung Cầu but no seal ball", { [GUARANTEED]: 1, [SEAL]: 0 }],
  ])("still catches the bunny with %s, and gives no ball to keep", (_name, items) => {
    const { world } = playBunny({ ...items, "4": 5 });
    expect(world.phase).toBe("returnWorld");
    expect(world.pets.map((pet) => pet.speciesId)).toContain(34);
    expect(world.inventory[GUARANTEED] ?? 0).toBeLessThanOrEqual(items[GUARANTEED]);
  });

  it("throws a Tất Trung Cầu first when the seal balls are gone, and it does not miss", () => {
    const { world } = playBunny({ [GUARANTEED]: 5, [SEAL]: 0, "4": 5 });
    expect(world.pets.map((pet) => pet.speciesId)).toContain(34);
    expect(world.inventory[GUARANTEED]).toBe(4);
  });
});
