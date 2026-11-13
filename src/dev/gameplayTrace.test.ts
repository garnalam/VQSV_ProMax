import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Node has no image decoder. Gameplay never reads pixels, so every pack image is a 1x1 stand-in
 * that is already "loaded"; the JSON and binary resources are the real files from public/.
 */
class StubImage {
  complete = true;
  naturalWidth = 1;
  naturalHeight = 1;
  width = 1;
  height = 1;
  src = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
}
vi.stubGlobal("Image", StubImage);
vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(
    import.meta.dirname,
    "../../public",
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

const { Pack } = await import("../pack/Pack");
const { loadBootAssets } = await import("../pack/boot");
const { GameAssets } = await import("../game/story/GameAssets");
const { MemorySaveStore } = await import("../persistence/save/SaveStore");
const { SaveRepository } = await import("../persistence/SaveRepository");
const { NewGameScreen } = await import("../screens/NewGameScreen");
const { applyUrlParityCheckpoint, checkpointRooms } = await import("./parityCheckpoints");
const { roomEntryArrival } = await import("../game/world/WorldTransition");
const { SCENARIOS, record } = await import("./gameplayTrace");

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
// A fight on the battle core seeds from the clock; the recorded trace needs one fixed stream.
assets.battleServices.seedSource = () => 0;
const GOLDEN = resolve(import.meta.dirname, "__fixtures__/gameplay-trace.json");
const golden: Record<string, unknown> = existsSync(GOLDEN)
  ? JSON.parse(readFileSync(GOLDEN, "utf8"))
  : {};
const recorded: Record<string, unknown> = {};

describe("gameplay traces match the recorded golden", () => {
  for (const scenario of SCENARIOS)
    it(scenario.name, () => {
      let exits = 0;
      const screen = new NewGameScreen(
        scenario.skipIntro ?? false,
        assets,
        boot,
        new SaveRepository(new MemorySaveStore()),
        () => exits++,
      );
      scenario.setup?.(screen);
      const trace = { digests: record(screen, scenario.steps, scenario.every), exits };
      recorded[scenario.name] = trace;
      if (process.env.VQSV_RECORD_TRACE) return;
      expect(trace).toEqual(golden[scenario.name]);
    });
  it.runIf(!!process.env.VQSV_RECORD_TRACE)("writes the golden file", () => {
    writeFileSync(GOLDEN, JSON.stringify(recorded) + "\n");
  });
});

describe("URL parity checkpoints", () => {
  /** The screen a boot URL like `?mapLoadingTick=8` is applied to. */
  const makeScreen = () =>
    new NewGameScreen(false, assets, boot, new SaveRepository(new MemorySaveStore()), () => {});

  it("freezes the room-swap screen on the tick the URL asks for", () => {
    for (const [tick, width] of [
      [0, 0],
      [8, 80],
      [15, 148],
    ]) {
      const screen = makeScreen();
      expect(applyUrlParityCheckpoint(screen, new URLSearchParams(`mapLoadingTick=${tick}`))).toBe(
        true,
      );
      expect([screen.host.world?.mapLoading?.progressPixels(), screen.frozen]).toEqual([
        width,
        true,
      ]);
    }
  });

  it("reports that no checkpoint was applied for a URL that asks for none", () => {
    expect(applyUrlParityCheckpoint(makeScreen(), new URLSearchParams("unused=1"))).toBe(false);
  });

  it("stands in any Cầu Vồng room the chapter's door table reaches", async () => {
    for (const room of [0, 1, 9, 47, 67]) {
      const screen = makeScreen(),
        params = new URLSearchParams(`cauVongRoom=${room}`);
      // The app fetches the checkpoint's room before applying it; without its map the
      // room-swap screen would (correctly) hold.
      for (const [scene, index] of checkpointRooms(params)) await assets.prepareRoom(scene, index);
      expect(applyUrlParityCheckpoint(screen, params)).toBe(true);
      const world = screen.host.world!,
        arrival = roomEntryArrival(screen.host.story.sourceData!, 98, room)!;
      expect([world.sceneId, world.roomIndex, world.mapLoading, screen.frozen]).toEqual([
        98,
        room,
        null,
        true,
      ]);
      expect([world.player.x, world.player.y, world.player.direction]).toEqual([
        arrival.x,
        arrival.y,
        arrival.direction,
      ]);
    }
  });

  it("puts the hero on the row the table points at, one tile off the pad", () => {
    const screen = makeScreen();
    expect(applyUrlParityCheckpoint(screen, new URLSearchParams("cauVongRoom=0"))).toBe(true);
    // The chapter's base room is entered through the city's top-edge pad onto row 1, tile (10,31)
    // facing up: centre x 210, foot line 639 less the one tile of give.
    expect(screen.host.world?.player.x).toBe(210);
    expect(screen.host.world?.player.y).toBe(619);
    expect(screen.host.world?.player.direction).toBe(2);
  });

  it("opens the Elder's challenge as a fight on the world's battle screen", () => {
    const screen = makeScreen();
    expect(applyUrlParityCheckpoint(screen, new URLSearchParams("scene1ElderBattle=1"))).toBe(true);
    const world = screen.host.world!;
    expect([world.phase, screen.frozen]).toEqual(["battle", true]);
    expect(world.battleGroup).toEqual({ scene: 1, room: 0, group: 6 });
    const enemy = world.battle!.combatant("enemy");
    expect([enemy.speciesId, enemy.level]).toEqual([68, 5]);
    expect(world.opponentHp).toBe(enemy.maxHp);
  });

  it("holds the authored fade between starter choice and the Elder battle", () => {
    const elder = makeScreen();
    expect(
      applyUrlParityCheckpoint(elder, new URLSearchParams("scene1ElderTransition=1&tick=8")),
    ).toBe(true);
    expect(elder.host.world!.eventScene).toMatchObject({ effect: "fade-in", effectTick: 8 });
  });

  it("reaches both capture-ball result animations through the browser checkpoints", () => {
    const failed = makeScreen();
    expect(applyUrlParityCheckpoint(failed, new URLSearchParams("bunnyCaptureTick=2"))).toBe(true);
    expect(failed.host.world!.battle?.captureVisual?.phase).toBe("throw");

    const caught = makeScreen();
    expect(
      applyUrlParityCheckpoint(caught, new URLSearchParams("bunnyCaptureTick=43&success=1")),
    ).toBe(true);
    expect(caught.host.world!.battle?.captureVisual).toMatchObject({
      phase: "ground",
      hideEnemy: true,
    });
  });

  it("plays the Elder's challenge through to the village opening", () => {
    const screen = makeScreen();
    expect(applyUrlParityCheckpoint(screen, new URLSearchParams("scene1ElderComplete=1"))).toBe(
      true,
    );
    const world = screen.host.world!;
    expect(world.battle).toBeNull();
    expect(world.questState.mainTaskProgress).toBe(2);
  });

  it("holds the real Elder win on its animated post-battle EXP stage", () => {
    const screen = makeScreen();
    expect(applyUrlParityCheckpoint(screen, new URLSearchParams("postBattleExp=0"))).toBe(true);
    const battle = screen.host.world!.battle!;
    expect([battle.interactiveStage, screen.frozen]).toEqual(["experience", true]);
    expect(battle.experienceBar.value).toBeLessThan(battle.experienceBar.max);
  });
});
