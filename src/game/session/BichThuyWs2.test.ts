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
const { doubleBattleCommands } = await import("./StoryPlaythrough");
const { DIRECTION_UP } = await import("../world/MapCollision");
type GameSave = import("../../persistence/save/GameSave").GameSave;
type Host = InstanceType<typeof GameplayHost>;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
const sources = gameplaySources(assets, boot);

/** Bích Thủy 2:0 with the scene before WS-2 (2:0:g2) done, and one pet of the player's own. */
function beforeWs2(): GameSave {
  const save = scene1Save({
    location: { sceneId: 2, roomIndex: 0, x: 160, y: 300, direction: 0 },
    owner: SCENE1_RESUME.bunnyReturnRoom0,
    bunnyCaught: true,
    eventStates: { "2:0:0": 3, "2:0:2": 3 },
    pets: [{ speciesId: 68, level: 9, quality: 2 }],
  });
  return { ...save, progress: { ...save.progress, mainTaskProgress: 3 } };
}

/** Resume `save` facing the soldiers and press 5 until the fight opens. */
async function challenge(save: GameSave) {
  await assets.prepareRoom(2, 0);
  const host: Host = new GameplayHost(
    sources,
    new SaveService(new SaveRepository(new MemorySaveStore())),
    { onExit: () => {} },
    { kind: "resume", save },
  );
  while (host.mapLoadingActive) host.step([]);
  const world = host.world!,
    records = boot.sourceEvents.group(2, 0, 1)!.records,
    actorId = records.find((r) => r.opcode === 67)!.short_args[0],
    soldier = world.actors.get(actorId);
  if (soldier) {
    world.player.x = soldier.x;
    world.player.y = soldier.y + 20;
    world.player.direction = DIRECTION_UP;
  }
  for (let i = 0; i < 4000 && !world.battle && !world.doubleBattle; i++)
    host.step(world.eventScene?.textReady || i % 2 === 0 ? ["confirm"] : []);
  return { host, world };
}

describe("Bích Thủy WS-2 (2:0:g1): the soldiers' 2v2 beside Harry", () => {
  it("opens a 2v2 for one pet: the player commands slot 2, Harry's lent pet holds slot 3", async () => {
    const { world } = await challenge(beforeWs2());
    expect(world.battle).toBeNull();
    const battle = world.doubleBattle!;
    expect(battle).not.toBeNull();
    const core = battle.core;
    expect(core.occupant(2)).toEqual({ side: "player", index: 0 });
    expect(core.occupant(3)).toEqual({ side: "companion", index: 0 });
    expect(core.setupOf(2).speciesId).toBe(68);
    expect([core.unit(0).alive(), core.unit(1).alive()]).toEqual([true, true]);
  });

  it("won: op47 reads the win and the group plays on to its end", async () => {
    const { host, world } = await challenge(beforeWs2());
    for (let i = 0; i < 20000 && world.phase === "battleEntry"; i++) host.step([]);
    // The command bar only ever asks slot 2: Harry's pet moves on its own.
    let commanded3 = false;
    for (let i = 0; i < 20000 && world.doubleBattle; i++) {
      const bar = world.doubleBattle as unknown as { commandSlot: number; stage: string };
      if (bar.stage === "command" && bar.commandSlot === 3) commanded3 = true;
      host.step(doubleBattleCommands(world.doubleBattle));
    }
    expect(commanded3).toBe(false);
    for (let i = 0; i < 4000 && world.phase === "event"; i++)
      host.step(world.eventScene?.textReady ? ["confirm"] : []);
    expect(world.eventState.sourceEventState(2, 0, 1)).toBe(3);
  });
});
