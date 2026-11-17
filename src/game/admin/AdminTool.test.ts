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
const { GameplayHost, gameplaySources } = await import("../session/GameplayHost");
const { WorldPanel, MENU_LABELS, MENU_ROW_ADMIN, MENU_ROW_SAFARI, ADMIN_MENU_LABEL } =
  await import("../world/WorldPanel");
const { ADMIN_BOSS_SPECIES, experienceForLevels, grantItem, setCurrency, adminSpeciesChoices } =
  await import("./AdminTool");
const { requiredExp } = await import("../battle/engine/PetProgression");

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
const sources = gameplaySources(assets, boot),
  contract = assets.worldContract;

function session(admin?: { enabled: () => boolean; open: () => void }) {
  const repository = new SaveRepository(new MemorySaveStore()),
    host = new GameplayHost(
      sources,
      new SaveService(repository),
      { onExit: () => {}, admin },
      {
        kind: "resume",
        save: scene1Save({
          location: {
            sceneId: contract.save.scene,
            roomIndex: contract.save.room,
            x: contract.save.x,
            y: contract.save.y,
            direction: 1,
          },
          owner: SCENE1_RESUME.bunnyCapture,
          bunnyCaught: false,
          pets: [{ speciesId: 68, level: 7, quality: 2 }],
        }),
      },
    );
  while (host.mapLoadingActive) host.step([]);
  return { host, repository };
}

describe("Admin Tool rules", () => {
  it("stacks items to each list's cap", () => {
    const inventory = {
      items: { "3": 95 },
      equipment: [4],
      materials: {},
      specials: [] as number[],
    };
    expect(grantItem(inventory, "BAG", 3, 10)).toBe(4);
    expect(inventory.items["3"]).toBe(99);
    expect(grantItem(inventory, "BAG", 3, 1)).toBe(0);
    expect(grantItem(inventory, "MATERIAL", 20, 500)).toBe(500);
    expect(grantItem(inventory, "SPECIAL", 6058, 3)).toBe(3);
    expect(inventory.specials).toEqual([6058, 6058, 6058]);
    expect(grantItem(inventory, "EQUIPMENT", 4, 2)).toBe(0);
    expect(grantItem(inventory, "EQUIPMENT", 5, 2)).toBe(1);
    expect(inventory.equipment).toEqual([4, 5]);
  });

  it("sets money and badges inside 0..int max", () => {
    const currency = { money: 5, badges: 5 };
    setCurrency(currency, 1_000_000, -3);
    expect(currency).toEqual({ money: 1_000_000, badges: 0 });
  });

  it("counts the EXP for 15 more levels, capped at 100", () => {
    let sum = 0;
    for (let level = 11; level <= 25; level++) sum += requiredExp(level);
    expect(experienceForLevels({ speciesId: 1, level: 10, quality: 2, experience: 40 }, 15)).toBe(
      sum - 40,
    );
    expect(experienceForLevels({ speciesId: 1, level: 100, quality: 2 }, 15)).toBe(0);
  });

  it("never offers the two bosses", () => {
    const species = adminSpeciesChoices(assets.petStats.allSpecies());
    expect(ADMIN_BOSS_SPECIES).toEqual(new Set([278, 280]));
    expect(species.some((row) => ADMIN_BOSS_SPECIES.has(row.speciesId))).toBe(false);
    expect(species.length).toBeGreaterThan(200);
  });
});

describe("Admin Tool menu row", () => {
  it("is hidden for a normal account and opens the tool for an admin", () => {
    const normal = new WorldPanel();
    normal.open();
    // Safari is the last game row and, for now, an admin-only one too.
    expect(normal.labels).toEqual(MENU_LABELS.slice(0, MENU_ROW_SAFARI));
    normal.selected = MENU_ROW_ADMIN;
    normal.tick(["confirm"]);
    expect(normal.labels).not.toContain(ADMIN_MENU_LABEL);

    const opened = { count: 0 },
      admin = new WorldPanel();
    admin.adminSource = { enabled: () => true, open: () => opened.count++ };
    admin.open();
    expect(admin.labels).toEqual([...MENU_LABELS, ADMIN_MENU_LABEL]);
    for (let i = 0; i < 20; i++) admin.tick(["down"]);
    expect(admin.selected).toBe(MENU_ROW_ADMIN);
    expect(admin.menuTitle).toBe(ADMIN_MENU_LABEL);
    admin.tick(["confirm"]);
    expect(opened.count).toBe(1);
    expect(admin.visible).toBe(false);
  });

  it("keeps Safari to admin accounts for now: no row, no button, no new run", () => {
    expect(MENU_LABELS[MENU_ROW_SAFARI]).toBe("Safari");
    expect(MENU_ROW_SAFARI).toBe(MENU_LABELS.length - 1);

    const normal = new WorldPanel(),
      asked = { count: 0 };
    normal.safariSource = { open: () => asked.count++ };
    normal.open();
    expect(normal.menuLabels).not.toContain("Safari");
    normal.selected = MENU_ROW_SAFARI;
    normal.tick(["confirm"]);
    expect(asked.count).toBe(0);

    const player = session().host;
    expect(player.safariEnabled).toBe(false);
    player.safari.open();
    expect(player.safari.visible).toBe(false);

    const admin = session({ enabled: () => true, open: () => {} }).host;
    expect(admin.safariEnabled).toBe(true);
    expect(admin.panel.menuLabels).toContain("Safari");
    admin.safari.open();
    expect(admin.safari.visible).toBe(true);
  });

  it("follows the session's admin hook", () => {
    expect(session().host.panel.menuLabels).not.toContain(ADMIN_MENU_LABEL);
    expect(session({ enabled: () => true, open: () => {} }).host.panel.menuLabels).toContain(
      ADMIN_MENU_LABEL,
    );
  });
});

describe("Admin Tool grants on a live session", () => {
  it("lists every bag tab and the species without bosses", () => {
    const view = session().host.adminView()!;
    for (const kind of ["BAG", "EQUIPMENT", "MATERIAL", "SPECIAL"])
      expect(view.items.some((item) => item.kind === kind)).toBe(true);
    expect(view.species.some((row) => row.speciesId === 278 || row.speciesId === 280)).toBe(false);
    expect(view.pets).toEqual([{ slot: 0, name: expect.any(String), level: 7 }]);
  });

  it("adds items, sets currency and saves", async () => {
    const { host, repository } = session(),
      world = host.world!,
      bagItem = host.adminView()!.items.find((item) => item.kind === "BAG")!;
    world.inventory[String(bagItem.id)] = 0;
    expect(
      host.applyAdminGrant({ action: "addItem", kind: "BAG", id: bagItem.id, quantity: 12 }),
    ).toContain("Đã thêm 12");
    expect(world.inventory[String(bagItem.id)]).toBe(12);
    host.applyAdminGrant({ action: "setCurrency", money: 123456, badges: 789 });
    expect(world.currency).toEqual({ money: 123456, badges: 789 });
    await vi.waitFor(async () =>
      expect((await repository.load())?.currency).toEqual({ money: 123456, badges: 789 }),
    );
  });

  it("buffs a roster pet by 15 levels with its stats", () => {
    const { host } = session(),
      pet = host.world!.pets[0];
    expect(host.applyAdminGrant({ action: "buffPet", slot: 0, levels: 15 })).toContain("7 → 22");
    expect(pet.level).toBe(22);
    expect(pet.maxHp).toBe(assets.petStats.coreStats(68, 22, pet.quality, pet.nature ?? 0).hp);
    expect(pet.currentHp).toBe(pet.maxHp);
    expect(host.applyAdminGrant({ action: "buffPet", slot: 3, levels: 15 })).toBe(
      "Không có pet ở ô này.",
    );
  });

  it("adds a pet to the bank with the server's nature and a rolled talent, never a boss", () => {
    const { host } = session(),
      world = host.world!,
      species = host.adminView()!.species[0].speciesId;
    const message = host.applyAdminGrant({
      action: "addPet",
      speciesId: species,
      nature: 8,
      shiny: true,
      talentSeed: "1234567890123",
    });
    expect(message).toContain("shiny 8");
    const pet = world.campaign.petBank.at(-1)!;
    expect(pet.speciesId).toBe(species);
    expect(pet.nature).toBe(8);
    expect(pet.physicalTraitId).toBeGreaterThanOrEqual(0);
    expect(pet.maxHp).toBe(assets.petStats.coreStats(species, pet.level, pet.quality, 8).hp);
    expect(world.collection.collected(species)).toBe(true);
    expect(world.pets).toHaveLength(1);

    const before = world.campaign.petBank.length;
    expect(
      host.applyAdminGrant({
        action: "addPet",
        speciesId: 278,
        nature: 2,
        shiny: false,
        talentSeed: "1",
      }),
    ).toBe("Không được thêm pet boss.");
    expect(world.campaign.petBank).toHaveLength(before);
  });
});
