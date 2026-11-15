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
const { attemptQualityUpgrade, qualityReason, validateQualityUpgrade } =
  await import("./QualityUpgrade");
type SavedPet = import("../../persistence/save/GameSave").SavedPet;
type QualityRules = import("./QualityUpgrade").QualityRules;
type Session = import("./QualityUpgradeSession").QualityUpgradeSession;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
const sources = gameplaySources(assets, boot);

/** 100 → 101 → 102 → 103 (Thụ quái … Cổ Thụ Chi Vương); 104 → 105, or mutated, 106. */
const FORM = [100, 101, 102, 103] as const,
  BRANCH = { base: 104, evolved: 105, mutated: 106 },
  UNRELATED = 68,
  DIVINE = 15;

/** JavaSE `PetQualityUpgradeService.RATE_BASIS_POINTS`: [main★][phôi★], in 1/100 %. */
const BASE: Record<number, Record<number, number>> = {
  1: { 1: 4000 },
  2: { 1: 1200, 2: 3000 },
  3: { 1: 300, 2: 800, 3: 1800 },
  4: { 1: 50, 2: 150, 3: 500, 4: 1000 },
};
/** `FORM_RATE_PERCENT` by evolution distance (same form, one, two, three forms earlier). */
const FORM_PERCENT = [100, 70, 45, 25];

let host: InstanceType<typeof GameplayHost>;
/** A session whose party is exactly `roster` and whose bank is exactly `bank`. */
function start(roster: SavedPet[], bank: SavedPet[] = []) {
  host = new GameplayHost(
    sources,
    new SaveService(new SaveRepository(new MemorySaveStore())),
    { onExit: () => {} },
    {
      kind: "resume",
      save: scene1Save({
        location: { sceneId: 1, roomIndex: 0, x: 200, y: 200, direction: 1 },
        owner: SCENE1_RESUME.bunnyReturnRoom0,
        bunnyCaught: true,
        pets: [{ speciesId: UNRELATED, level: 10, quality: 2 }],
      }),
    },
  );
  const world = host.world!;
  world.pets.splice(0, world.pets.length, ...roster);
  world.campaign.petBank.splice(0, world.campaign.petBank.length, ...bank);
  world.pets.forEach((pet, slot) => (pet.slot = slot));
  return world;
}
const pet = (speciesId: number, quality: number, level = 10, extra: Partial<SavedPet> = {}) =>
  ({
    speciesId,
    level,
    quality,
    nature: 2,
    experience: 0,
    heldEquipmentId: -1,
    ...extra,
  }) as SavedPet;
const lead = () => pet(UNRELATED, 2, 20);
/** The real Nâng phẩm screen the pet menu opens on party pet `index`, with phôi 1's picker open. */
const open = (index: number) => {
  const session = host.panel.petSource.openQuality(index) as Session;
  session.tick(["confirm"]);
  expect(session.pickerVisible).toBe(true);
  return session;
};
/** The rules that screen runs on (the game's own form distances and protected species). */
const rules = () => (open(0) as unknown as { world: { rules: QualityRules } }).world.rules;

describe("Nâng phẩm on the game's own data (JavaSE PetQualityUpgradeService)", () => {
  it("a level 6 pet takes a level 5 pet of the same species and stars as phôi (40%)", () => {
    const main = pet(FORM[0], 1, 6),
      fodder = pet(FORM[0], 1, 5);
    start([lead(), main, fodder]);
    const session = open(1);
    expect(session.candidates).toEqual([fodder]);
    expect(session.candidateRate(fodder)).toBe(4000);
  });

  it("levels never matter, either way round", () => {
    for (const [mainLevel, fodderLevel] of [
      [6, 5],
      [5, 6],
      [100, 1],
      [1, 100],
    ]) {
      const fodder = pet(FORM[1], 2, fodderLevel);
      start([lead(), pet(FORM[1], 2, mainLevel), fodder]);
      expect(open(1).candidates).toEqual([fodder]);
    }
  });

  it("offers bank pets too, and spends the phôi from the bank", () => {
    const fodder = pet(FORM[0], 1, 5);
    const world = start([lead(), pet(FORM[0], 1, 6)], [fodder]);
    const session = open(1);
    expect(session.candidates).toEqual([fodder]);
    expect(session.candidateLocation(fodder)).toBe("Ngân hàng");
    const result = attemptQualityUpgrade(
      rules(),
      world.pets,
      world.campaign.petBank,
      world.bag.equipment,
      world.pets[1],
      [fodder],
      0,
    );
    expect(result.outcome).toBe("SUCCESS");
    expect(world.campaign.petBank).toEqual([]);
    expect(world.pets[1].quality).toBe(2);
  });

  it("refuses the pet in the lead slot (the one fighting), and says why", () => {
    const fodder = pet(FORM[0], 1, 5),
      main = pet(FORM[0], 1, 6),
      world = start([fodder, main]);
    expect(open(1).candidates).toEqual([]);
    expect(
      validateQualityUpgrade(rules(), world.pets, world.campaign.petBank, main, [fodder]),
    ).toEqual({ valid: false, reason: "ACTIVE_PET" });
    expect(qualityReason("ACTIVE_PET")).toBe("Pet đang xuất chiến không thể làm phôi");
    // The lead itself can be raised, with the pet behind it as phôi.
    expect(open(0).candidates).toEqual([main]);
  });

  it("an empty picker names the reason the pet's own kin was turned down", () => {
    start([pet(FORM[0], 1, 5), pet(FORM[0], 1, 6)]);
    expect(open(1).status).toBe(
      "Không có Pet phôi phù hợp: Pet đang xuất chiến không thể làm phôi",
    );
    start([lead(), pet(FORM[1], 2), pet(FORM[2], 1)]);
    expect(open(1).status).toBe(
      `Không có Pet phôi phù hợp: ${qualityReason("DIFFERENT_SPECIES_OR_FORM")}`,
    );
    start([lead(), pet(FORM[1], 2), pet(FORM[1], 3)]);
    expect(open(1).status).toBe(
      `Không có Pet phôi phù hợp: ${qualityReason("FODDER_QUALITY_TOO_HIGH")}`,
    );
    // Nothing of its line at all: the plain message.
    start([lead(), pet(FORM[1], 2), pet(BRANCH.base, 1)]);
    expect(open(1).status).toBe("Không có Pet phôi phù hợp");
  });

  it("rates every star pair of the same form exactly as the JavaSE table", () => {
    for (let main = 1; main <= 4; main++)
      for (let fodder = 1; fodder <= 5; fodder++) {
        const phoi = pet(FORM[2], fodder);
        start([lead(), pet(FORM[2], main), phoi]);
        const session = open(1);
        if (fodder > main) expect(session.candidates, `${main}★ ← ${fodder}★`).toEqual([]);
        else expect(session.candidateRate(phoi), `${main}★ ← ${fodder}★`).toBe(BASE[main][fodder]);
      }
  });

  it("a phôi with fewer stars always gives less than one with more", () => {
    for (let main = 2; main <= 4; main++)
      for (let fodder = 1; fodder < main; fodder++)
        expect(BASE[main][fodder]).toBeLessThan(BASE[main][fodder + 1]);
  });

  it("an earlier form gives less than the same form at the same stars: 70%, 45%, 25% of it", () => {
    for (let main = 1; main <= 4; main++)
      for (let fodder = 1; fodder <= main; fodder++) {
        // FORM[3] is the main pet; FORM[3..0] are 0..3 forms earlier.
        const rates = [...FORM].reverse().map((species) => {
          const phoi = pet(species, fodder);
          start([lead(), pet(FORM[3], main), phoi]);
          return open(1).candidateRate(phoi);
        });
        rates.forEach((rate, distance) =>
          expect(rate, `${main}★ ← ${fodder}★, ${distance} forms earlier`).toBe(
            Math.max(1, Math.trunc((BASE[main][fodder] * FORM_PERCENT[distance] + 50) / 100)),
          ),
        );
        for (let distance = 1; distance < rates.length; distance++)
          expect(rates[distance]).toBeLessThan(rates[distance - 1]);
      }
  });

  it("refuses a later form, the other branch, an unrelated species and a divine pet", () => {
    for (const [main, fodder, reason] of [
      [FORM[1], FORM[2], "DIFFERENT_SPECIES_OR_FORM"],
      [FORM[0], FORM[3], "DIFFERENT_SPECIES_OR_FORM"],
      [BRANCH.evolved, BRANCH.mutated, "DIFFERENT_SPECIES_OR_FORM"],
      [BRANCH.mutated, BRANCH.evolved, "DIFFERENT_SPECIES_OR_FORM"],
      [FORM[3], BRANCH.base, "DIFFERENT_SPECIES_OR_FORM"],
      [DIVINE, DIVINE, "PROTECTED_PET"],
    ] as const) {
      const phoi = pet(fodder, 1),
        world = start([lead(), pet(main, 2), phoi]);
      expect(open(1).candidates, `${main} ← ${fodder}`).toEqual([]);
      expect(
        validateQualityUpgrade(rules(), world.pets, world.campaign.petBank, world.pets[1], [phoi]),
      ).toEqual({ valid: false, reason });
    }
    // The branches' shared base is an earlier form of both.
    for (const branch of [BRANCH.evolved, BRANCH.mutated]) {
      const phoi = pet(BRANCH.base, 1);
      start([lead(), pet(branch, 1), phoi]);
      expect(open(1).candidates).toEqual([phoi]);
    }
  });

  it("a special form takes its own pre-form as phôi, one form earlier (70%)", () => {
    for (const [base, special] of [
      [4, 277],
      [23, 274],
      [28, 279],
      [34, 275],
      [64, 276],
    ]) {
      const phoi = pet(base, 2);
      start([lead(), pet(special, 3), phoi]);
      const session = open(1);
      expect(session.candidates, `${special} ← ${base}`).toEqual([phoi]);
      expect(session.candidateDistance(phoi)).toBe(1);
      expect(session.candidateRate(phoi)).toBe(Math.trunc((800 * 70 + 50) / 100));
      // Never the other way round: the special form is not an earlier form of its base.
      start([lead(), pet(base, 3), pet(special, 2)]);
      expect(open(1).candidates, `${base} ← ${special}`).toEqual([]);
    }
  });

  it("the evolution rules add only those five pairs to JavaSE's distance table", () => {
    const evolutions = sources.evolutions!,
      pools = sources.petSkillPools!,
      added: string[] = [];
    for (let main = 0; main <= 300; main++)
      for (let fodder = 0; fodder <= 300; fodder++) {
        const java = pools.formDistance(main, fodder),
          ours = evolutions.formDistance(main, fodder);
        if (java >= 0) continue;
        if (ours >= 0) added.push(`${main}←${fodder}:${ours}`);
      }
    expect(added.sort()).toEqual(["274←23:1", "275←34:1", "276←64:1", "277←4:1", "279←28:1"]);
  });

  it("two phôi share their stars, add up, cap at 100%, and cannot be one pet twice", () => {
    const a = pet(FORM[0], 1),
      b = pet(FORM[0], 1),
      c = pet(FORM[0], 2),
      world = start([lead(), pet(FORM[0], 2), a, b, c]),
      main = world.pets[1],
      check = (fodders: SavedPet[]) =>
        validateQualityUpgrade(rules(), world.pets, world.campaign.petBank, main, fodders);
    expect(check([a, b])).toEqual({ valid: true, rateBasisPoints: 2400 });
    expect(check([c, a])).toEqual({ valid: false, reason: "FODDER_QUALITY_MISMATCH" });
    expect(check([a, a])).toEqual({ valid: false, reason: "DUPLICATE_FODDER" });
    expect(check([a, b, c])).toEqual({ valid: false, reason: "TOO_MANY_FODDERS" });
    expect(check([main])).toEqual({ valid: false, reason: "MAIN_SELECTED_AS_FODDER" });
    // Two 1★ phôi on a 1★ pet: 40% + 40%.
    const one = start([lead(), pet(FORM[0], 1), pet(FORM[0], 1), pet(FORM[0], 1)]);
    expect(
      validateQualityUpgrade(
        rules(),
        one.pets,
        one.campaign.petBank,
        one.pets[1],
        one.pets.slice(2),
      ),
    ).toEqual({ valid: true, rateBasisPoints: 8000 });
  });

  it("a 5★ pet cannot be raised; a failed try keeps 1–3★ and costs a 4★ pet one star", () => {
    start([lead(), pet(FORM[0], 5), pet(FORM[0], 1)]);
    expect(open(1).candidates).toEqual([]);
    for (const [stars, after] of [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 3],
    ]) {
      const world = start([
        lead(),
        pet(FORM[0], stars),
        pet(FORM[0], 1, 5, { heldEquipmentId: 7 }),
      ]);
      const result = attemptQualityUpgrade(
        rules(),
        world.pets,
        world.campaign.petBank,
        world.bag.equipment,
        world.pets[1],
        [world.pets[2]],
        9_999,
      );
      expect(result.outcome).toBe("FAILURE");
      expect(world.pets[1].quality).toBe(after);
      // The phôi is spent either way, and what it held goes back to the bag.
      expect(world.pets).toHaveLength(2);
      expect(world.bag.equipment).toContain(7);
    }
  });
});
