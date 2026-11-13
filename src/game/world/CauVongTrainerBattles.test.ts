import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/** Node has no image decoder; the rooms never read pixels (see gameplayTrace.test.ts). */
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
const { NewGameScreen } = await import("../../screens/NewGameScreen");
const { applyUrlParityCheckpoint } = await import("../../dev/parityCheckpoints");
const { createSourceTrainerBattle } = await import("../battle/EventBattle");
type AcademyBattle = import("./CauVongAcademy").AcademyBattle;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
await assets.prepareRoom(98, 0);

const read = (file: string) =>
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../public/pack/cau-vong-world", file), "utf8"),
  ) as { battles: Record<string, AcademyBattle> };
/** Every Cầu Vồng document that bakes trainer requests, and the loaded copy `GameAssets` keeps. */
const DOCS = [
  ["academy.json", assets.cauVongAcademy],
  ["four-gates.json", assets.cauVongFourGates],
  ["forest.json", assets.cauVongForest],
  ["lab.json", assets.cauVongLab],
  ["north-sea.json", assets.cauVongNorthSea],
  ["locke.json", assets.cauVongLocke],
] as const;
const ROWS = DOCS.flatMap(([file, loaded]) =>
  Object.entries(read(file).battles).map(
    ([key, baked]) => [`${file} ${key}`, baked, loaded!.battles[key] as AcademyBattle] as const,
  ),
);

function world() {
  const screen = new NewGameScreen(
    false,
    assets,
    boot,
    new SaveRepository(new MemorySaveStore()),
    () => {},
  );
  expect(applyUrlParityCheckpoint(screen, new URLSearchParams("cauVongRoom=0"))).toBe(true);
  return screen.host.world!;
}

// `VqsvBattleRuntime.enterBattle` for a scene-98 trainer: `enemyQuality` 5, each member's deck after
// `CauVongEnemySkillDecks.apply` and `EarthPetrificationPriority.ensureDeck`, and the request's
// `RuntimeProfile.aiProfile`. Every Cầu Vồng request is baked with them, not only the forest's.
describe("Cầu Vồng trainer requests carry what enterBattle makes of the roster", () => {
  it("bakes quality 5, one deck per member and an AI tier for every request", () => {
    expect(ROWS.length).toBeGreaterThan(40);
    for (const [name, baked] of ROWS) {
      expect(baked.quality, name).toBe(5);
      expect(baked.skills?.length, name).toBe(baked.members.length);
      expect(
        baked.skills!.every((deck) => deck.length > 0),
        name,
      ).toBe(true);
      expect(["TRAINER", "ELITE", "BOSS"], name).toContain(baked.tier);
    }
    // Only `CauVongFinalBattleBalance`'s teams leave the TRAINER brain: the principal and Rafael in
    // 42, and the North Sea's three finals.
    const special = ROWS.filter(([, b]) => b.tier !== "TRAINER").map(([name, b]) => [name, b.tier]);
    expect(special).toEqual([
      ["forest.json 3", "ELITE"],
      ["forest.json 4", "BOSS"],
      ["north-sea.json 5", "ELITE"],
      ["north-sea.json 6", "ELITE"],
      ["north-sea.json 7", "BOSS"],
    ]);
  });

  it("resolves every request's tier to its AI profile when the pack loads", () => {
    for (const [name, baked, loaded] of ROWS)
      expect(loaded.profile?.tier, name).toBe(`BattleAiTier.${baked.tier}`);
  });

  it.each(ROWS.map(([name]) => name))("%s: the fight's enemies are the baked ones", (name) => {
    const [, baked, loaded] = ROWS.find(([n]) => n === name)!;
    const w = world();
    const services = w.battleServices!;
    const battle = createSourceTrainerBattle(services, loaded, w.pets, {});
    const core = battle.core!;
    baked.members.forEach(([species, level], i) => {
      const setup = core.enemySetup(i);
      expect([setup.speciesId, setup.level, setup.quality]).toEqual([
        species,
        services.enemyLevel.clampEnemy(level),
        5,
      ]);
      expect([...setup.skillIds]).toEqual(baked.skills![i]);
    });
  });
});
