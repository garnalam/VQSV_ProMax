import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/** Pack images are 1x1 stand-ins under Node; this rig never reads pixels. */
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
const { gameplaySources } = await import("../session/GameplayHost");
const { WorldRuntime } = await import("./WorldRuntime");
const { scene1Save } = await import("../../dev/parityCheckpoints");
const { SCENE1_RESUME } = await import("../../persistence/save/migrations");

const { terrainAtWorld, stepWithTerrain, DIRECTION_LEFT, DIRECTION_RIGHT } =
  await import("./MapCollision");
const { BATTLE_RESULT_LOST } = await import("../battle/BattleRuntime");

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
const sources = gameplaySources(assets, boot).world;
sources.battle!.seedSource = () => 7;
const contract = assets.worldContract;

/** A grass spot of "Đường nhỏ phía Nam" (1:2) from which the hero can walk right and back. */
function grassSpot(): { x: number; y: number } {
  const map = sources.collision(sources.room(1, 2)!.mapId)!;
  for (let y = 40; y < 600; y += 4)
    for (let x = 40; x < 600; x += 4)
      if (
        terrainAtWorld(map, x, y) === 0 &&
        stepWithTerrain(map, x, y, DIRECTION_RIGHT).moved &&
        stepWithTerrain(map, x + 8, y, DIRECTION_LEFT).moved
      )
        return { x, y };
  throw new Error("no grass in 1:2");
}

/** The south road with the bunny caught, so the free map runs and a main task is under way. */
function roadWorld() {
  const spot = grassSpot(),
    runtime = new WorldRuntime(
      contract,
      sources,
      scene1Save({
        location: { sceneId: 1, roomIndex: 2, ...spot, direction: 1 },
        owner: SCENE1_RESUME.bunnyReturnRoom0,
        bunnyCaught: true,
        eventStates: { "1:1:0": 3 },
        pets: [{ speciesId: 68, level: 9, quality: 2 }],
      }),
    );
  for (let i = 0; i < 64 && runtime.mapLoading; i++) runtime.tickMapLoading();
  runtime.tick([]);
  return runtime;
}
/** Walk right and left over the grass until a wild fight opens. */
function walkIntoEncounter(runtime: ReturnType<typeof roadWorld>) {
  for (let i = 0; i < 2000 && runtime.phase !== "battleEntry"; i++)
    runtime.tick([Math.trunc(i / 3) % 2 === 0 ? "holdRight" : "holdLeft"]);
  expect(runtime.phase).toBe("battleEntry");
  for (let i = 0; i < 30 && runtime.phase === "battleEntry"; i++) runtime.tick([]);
  expect(runtime.phase).toBe("battle");
  return runtime.battle!;
}

describe("free-world random wild encounters (VqsvFreeWorldEncounterProducer)", () => {
  it("opens a catchable, runnable wild fight from the room's petArea roster, and pays a win", () => {
    const runtime = roadWorld();
    expect([runtime.sceneId, runtime.roomIndex]).toEqual([1, 2]);
    expect(["freeworld", "returnWorld"]).toContain(runtime.phase);
    const before = { ...runtime.currency };
    const battle = walkIntoEncounter(runtime),
      core = battle.core!,
      enemy = core.enemySetup(0),
      roster = assets.worldEncounters!.areas.find((a) => a.scene === 1 && a.room === 2)!,
      unified = assets.worldEncounters!.unified.filter((r) => r[0] === 1 && r[1] === 2);
    expect([
      ...roster.terrains["0"].map((entry) => entry[0]),
      ...unified.map((row) => row[3]),
    ]).toContain(enemy.speciesId);
    expect(core.captureAllowed()).toBe(true);
    expect(core.runAllowed()).toBe(true);
    expect(runtime.collection.seen(enemy.speciesId)).toBe(true);
    for (let i = 0; i < 6000 && runtime.phase === "battle"; i++) {
      const foe = core.activeUnit("enemy");
      if (foe.alive()) foe.setHp(1);
      runtime.tick(["confirm"]);
    }
    // `WildBattleRewardService`: (100 + 10 x level) x (60 + 10 x stars) %.
    const stars = Math.max(1, Math.min(4, enemy.quality)),
      expected = Math.trunc(((100 + 10 * Math.max(1, enemy.level)) * (60 + stars * 10)) / 100);
    expect(runtime.currency.money - before.money).toBe(expected);
    expect(runtime.currency.badges - before.badges).toBeGreaterThanOrEqual(0);
    expect([runtime.phase, runtime.sceneId, runtime.roomIndex]).toEqual(["freeworld", 1, 2]);
  });

  it("sends the hero back to the save point after a loss, with the party revived", () => {
    const runtime = roadWorld(),
      battle = walkIntoEncounter(runtime);
    for (let i = 0; i < 6000 && runtime.phase === "battle"; i++) {
      const own = battle.core!.activeUnit("player");
      if (own.alive()) own.setHp(1);
      runtime.tick(["confirm"]);
    }
    expect(battle.result).toBe(BATTLE_RESULT_LOST);
    expect(runtime.phase).toBe("freeworld");
    expect(runtime.pets.every((pet) => (pet.currentHp ?? 1) > 0)).toBe(true);
  });

  it("keeps the repel counting down on every tick and holds encounters while it lasts", () => {
    const runtime = roadWorld();
    runtime.repelSteps = 400;
    for (let i = 0; i < 300; i++)
      runtime.tick([Math.trunc(i / 3) % 2 === 0 ? "holdRight" : "holdLeft"]);
    expect(["freeworld", "returnWorld"]).toContain(runtime.phase);
    expect(runtime.battle).toBeNull();
    expect(runtime.repelSteps).toBe(100);
  });

  it("uses the JavaSE expiry prompt, renews from the bag, and persists the duration", () => {
    const runtime = roadWorld();
    runtime.inventory["13"] = 1;
    runtime.repelSteps = 1;
    runtime.tick([]);
    expect([runtime.repelPromptVisible, runtime.repelPromptText]).toEqual([
      true,
      "Tị Quái Hoàn đã hết tác dụng. Bạn có muốn tiếp tục sử dụng không?",
    ]);
    runtime.tick(["confirm"]);
    expect(runtime.repelPromptChoice).toEqual({
      options: ["Tiếp tục dùng", "Không dùng"],
      index: 0,
    });
    runtime.tick(["confirm"]);
    expect([runtime.repelPromptVisible, runtime.inventory["13"], runtime.repelSteps]).toEqual([
      false,
      0,
      500,
    ]);
    const restored = new WorldRuntime(contract, sources, runtime.snapshot());
    expect(restored.repelSteps).toBe(500);
  });

  it("reports exhaustion and resumes without opening the choice box", () => {
    const runtime = roadWorld();
    runtime.repelSteps = 1;
    runtime.tick([]);
    expect(runtime.repelPromptText).toBe("Bạn đã hết Tị Quái Hoàn để sử dụng.");
    runtime.tick(["confirm"]);
    expect([runtime.repelPromptVisible, runtime.repelPromptChoice]).toEqual([false, null]);
  });
});
