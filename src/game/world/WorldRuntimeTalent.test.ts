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

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
const sources = gameplaySources(assets, boot).world;
const battle = sources.battle!;
const contract = assets.worldContract;

/** The starter's own save entry, the way `WorldRuntime.snapshot()` writes it. */
const starterEntry = (talent: number | undefined) => ({
  speciesId: contract.player.id,
  level: contract.player.level,
  quality: contract.player.quality,
  nature: contract.player.nature ?? 0,
  currentHp: contract.player.maxHp,
  maxHp: contract.player.maxHp,
  experience: 0,
  visualSpriteId: contract.player.spriteId,
  skillIds: (contract.player.skills ?? []).map((skill) => skill.id),
  skillPp: (contract.player.skills ?? []).map((skill) => skill.pp),
  physicalTraitId: talent,
});
const saveWith = (talent: number | undefined) =>
  ({
    location: { ...contract.save, direction: 2 },
    inventory: { items: { ...contract.initial!.items } },
    progress: { activeTask: "BUNNY_CAPTURE", mainTaskProgress: 1 },
    story: { scene1: { bunnyCaught: false, elderComplete: false } },
    pets: [starterEntry(talent)],
  }) as unknown as import("../../persistence/save/GameSave").GameSave;

describe("the thiên phú a pet is worn with", () => {
  it("rolls one for the starter and shows its name on the pet profile", () => {
    const world = new WorldRuntime(contract, sources),
      talent = world.pets[0].physicalTraitId;
    expect(talent).toBeGreaterThanOrEqual(0);
    expect(battle.rules.traitRegistry.sanitizePhysicalTraitId(talent!)).toBe(talent);
    expect(battle.profile(battle.partyMember(world.pets[0])).talent?.name).toBeTruthy();
    // Owner 2026-11-15: the characteristic reads in plain words (`summary`), not the workbook rule.
    const trait = battle.profile(battle.partyMember(world.pets[0])).trait;
    const { traits } = JSON.parse(
      readFileSync("public/pack/balance/pet-design-traits.json", "utf8"),
    ) as { traits: { speciesId: number; summary: string }[] };
    const row = traits.find((t) => t.speciesId === world.pets[0].speciesId);
    expect(row?.summary).toBeTruthy();
    expect(trait?.description).toBe(row?.summary);
  });

  it("is the same talent in the next session and the one after that", () => {
    const first = new WorldRuntime(contract, sources).pets[0].physicalTraitId,
      second = new WorldRuntime(contract, sources).pets[0].physicalTraitId;
    expect(second).toBe(first);

    // and through a save: the recorded id is what the pet wears, not a fresh draw.
    const saved = new WorldRuntime(contract, sources).snapshot();
    expect(saved.pets[0].physicalTraitId).toBe(first);
    expect(new WorldRuntime(contract, sources, saved).pets[0].physicalTraitId).toBe(first);
  });

  it("migrates a save pet that carries none to the same stable answer", () => {
    const migrated = new WorldRuntime(contract, sources, saveWith(-1)).pets[0].physicalTraitId,
      missing = new WorldRuntime(contract, sources, saveWith(undefined)).pets[0].physicalTraitId;
    expect(migrated).toBeGreaterThanOrEqual(0);
    expect(missing).toBe(migrated);
    expect(migrated).toBe(
      battle.petTalent(
        {
          speciesId: contract.player.id,
          level: contract.player.level,
          quality: contract.player.quality,
          nature: contract.player.nature ?? 0,
        },
        0,
      ),
    );
  });

  it("keeps a talent the save already recorded", () => {
    const world = new WorldRuntime(contract, sources, saveWith(7));
    expect(world.pets[0].physicalTraitId).toBe(7);
  });

  it("pins Kim Diễm Long Vương to the neutral talent instead of rolling", () => {
    expect(battle.petTalent({ speciesId: 280, level: 60, quality: 5, nature: 5 }, 0)).toBe(0);
    expect(
      battle.petTalent({ speciesId: 278, level: 60, quality: 5, nature: 5 }, 0),
    ).toBeGreaterThanOrEqual(0);
  });
});
