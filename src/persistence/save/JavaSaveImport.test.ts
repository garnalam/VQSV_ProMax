import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/** Node has no image decoder; nothing here reads pixels. */
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

const { importJavaSave, parseJavaProperties } = await import("./JavaSaveImport");
const { importCatalogFor } = await import("./JavaSaveCatalog");
const { isGameSave } = await import("./GameSave");
const { upgradeSave } = await import("./migrations");
const { Pack } = await import("../../pack/Pack");
const { loadBootAssets } = await import("../../pack/boot");
const { GameAssets } = await import("../../game/story/GameAssets");
const { MemorySaveStore } = await import("./SaveStore");
const { SaveRepository } = await import("../SaveRepository");
const { NewGameScreen } = await import("../../screens/NewGameScreen");

const fixture = readFileSync(
  resolve(import.meta.dirname, "fixtures/java-save-scene3.properties"),
  "utf8",
);
const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
const catalog = importCatalogFor(assets);

describe("parseJavaProperties", () => {
  it("reads escaped keys and values the way java.util.Properties does", () => {
    const p = parseJavaProperties("# note\na\\:b=1\\=2\nname=Ng\\u01b0\\u1eddi\nempty=\n");
    expect(p.get("a:b")).toBe("1=2");
    expect(p.get("name")).toBe("Người");
    expect(p.get("empty")).toBe("");
  });
});

describe("importJavaSave (Java online save → web save)", () => {
  const result = importJavaSave(fixture, catalog)!;

  it("retains both Golden reward claims and the commissioned recovery region", () => {
    const imported = importJavaSave(fixture + "\nsourceConvenienceRewardsClaimed=1,1,1,1,1,1,1,1\n", catalog)!;
    expect(imported.save.convenienceRewardsClaimed).toEqual(Array(8).fill(true));
    expect(imported.save.recoveryCheckpoint).toBe("nguyen-moc");
    expect(isGameSave(imported.save)).toBe(true);
  });

  it("produces a valid current web save at the Java player's place", () => {
    expect(result).not.toBeNull();
    const { save } = result;
    expect(isGameSave(save)).toBe(true);
    expect(upgradeSave(save)).toBeDefined();
    expect(save.location).toEqual({ sceneId: 3, roomIndex: 3, x: 216, y: 192, direction: 0 });
    expect(save.progress.mainTaskProgress).toBe(16);
    expect(save.eventStates?.["3:3:14"]).toBe(3);
    expect(Object.keys(save.eventStates ?? {})).toHaveLength(78);
    expect(save.world?.openedChests).toContain("1:2:25");
    expect(save.currency).toEqual({ money: 13410, badges: 117 });
    expect(save.meta?.redeemedGiftCodes).toEqual(["TRUONGCON"]);
    expect(save.meta?.battlePass).toMatchObject({ xp: 12500, claimedFree: [1, 3] });
    // Both games now preserve all eight collection reward flags.
    expect(save.convenienceRewardsClaimed).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(save.world?.sourceWorldFlags).toEqual(expect.arrayContaining([320747, 320748]));
    expect(save.meta?.campaign.charms.tiers).toMatchObject({ 5037: 1, 5039: 1 });
  });

  it("keeps the party and the bank with their skills, HP and experience", () => {
    const { save } = result;
    expect(save.pets.map((pet) => [pet.speciesId, pet.level])).toEqual([
      [46, 20],
      [77, 20],
      [156, 12],
    ]);
    expect(save.pets[0]).toMatchObject({
      quality: 5,
      nature: 8,
      currentHp: 404,
      maxHp: 600,
      experience: 2984,
      skillIds: [118, 27, 26, 117, 23],
      skillPp: [13, 7, 12, 20, 12],
    });
    // The empty fifth slot (-1) is not a skill.
    expect(save.pets[2].skillIds).toEqual([85, 10, 16, 117]);
    expect(save.meta?.campaign.petBank.map((pet) => pet.slot)).toEqual([0, 1, 2]);
  });

  it("leaves out what the web game does not have and caps pet levels", () => {
    const { save, dropped } = result;
    expect(save.inventory.items["7777"]).toBeUndefined();
    expect(save.inventory.items["9003"]).toBe(1);
    expect(save.inventory.specials).not.toContain(8066);
    expect(save.meta?.fashion.owned).toEqual(["FASH-BASE-NEIL"]);
    expect(save.meta?.fashion.selected).toBe("FASH-BASE-NEIL");
    const legend = save.meta?.campaign.petBank.find((pet) => pet.speciesId === 280);
    if (legend) expect(legend.level).toBe(100);
    expect(dropped).toEqual(
      expect.arrayContaining([
        "vật phẩm 7777 x16",
        "vật phẩm đặc biệt 8066",
        "trang phục FASH-NOT-IN-WEB-A00",
      ]),
    );
    // What the web game has is kept.
    expect(save.inventory.items["0"]).toBe(1);
    expect(save.inventory.equipment).toEqual([5, 6, 10, 0, 1, 11, 6000]);
  });

  it("treats a save still inside the opening as nothing to continue", () => {
    expect(
      importJavaSave("version=22\nscene=1\nroom=0\nworldResumeMode=LINEAR_EVENTS\n", catalog),
    ).toBeNull();
    expect(
      importJavaSave("version=23\nscene=3\nworldResumeMode=SCENE2_ROOM1_FREE_WORLD\n", catalog),
    ).toBeNull();
  });

  it("resumes the web game in the Java player's room", async () => {
    const screen = new NewGameScreen(
      false,
      assets,
      boot,
      new SaveRepository(new MemorySaveStore()),
      () => {},
      result.save,
    );
    await vi.waitFor(() => expect(screen.host.world).toBeTruthy(), { timeout: 10_000 });
    const world = screen.host.world!;
    expect([world.sceneId, world.roomIndex]).toEqual([3, 3]);
    // A loaded save keeps its own party: the chapter-one bunny is not added back on save.
    world.snapshot();
    expect(world.pets.map((pet) => pet.speciesId)).toEqual([46, 77, 156]);
    expect(world.currency.money).toBe(13410);
  });
});
