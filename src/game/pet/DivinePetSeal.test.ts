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
const { DivinePetSeal } = await import("./DivinePetSeal");
const { applyEggPetBuff, eggPetBuff } = await import("./EggPetBuff");
const { worldPetCard } = await import("./PetScreen");
type SavedPet = import("../../persistence/save/GameSave").SavedPet;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
await assets.prepareRoom(98, 0);

const SEA = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../public/pack/cau-vong-world/north-sea.json"),
    "utf8",
  ),
) as { divine: { species: number[]; sealed: number; released: number } };
const DIVINE = SEA.divine.species[0];

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

/** A level-60 pet of `speciesId` joined to the roster, with HP as the save would carry it. */
function own(w: ReturnType<typeof world>, speciesId: number, hp?: (max: number) => number) {
  const services = w.battleServices!,
    core = services.petStats.coreStats(speciesId, 60, 3, 0),
    pet: SavedPet = { speciesId, level: 60, quality: 3, nature: 0 };
  if (hp) {
    pet.maxHp = core.hp;
    pet.currentHp = hp(core.hp);
  }
  w.pets.push(pet);
  return { pet, core, services };
}

// `vqsv.pet.DivinePetSeal` and `DivinePetSealTest`: owned Divine pets fight at 30% until the North
// Sea's golden title, then at 120%; HP keeps its fraction; other species and opponents keep 100%.
describe("DivinePetSeal", () => {
  it("bakes the 19 Divine species and the two percents", () => {
    expect(SEA.divine.species).toHaveLength(19);
    expect([SEA.divine.sealed, SEA.divine.released]).toEqual([30, 120]);
    expect(assets.cauVongNorthSea!.divine).toEqual(SEA.divine);
  });

  it("scales like Java: floored, at least 1, at most Short.MAX_VALUE, only 30/100/120", () => {
    expect(DivinePetSeal.scale(333, 30)).toBe(99);
    expect(DivinePetSeal.scale(333, 120)).toBe(399);
    expect(DivinePetSeal.scale(2, 30)).toBe(1);
    expect(DivinePetSeal.scale(30000, 120)).toBe(32767);
    expect(() => DivinePetSeal.scale(10, 50)).toThrow();
    // `((long)hp * newMax + oldMax / 2) / oldMax`, kept in [1, newMax]; KO stays KO.
    expect(DivinePetSeal.carryHp(50, 100, 30)).toBe(15);
    expect(DivinePetSeal.carryHp(1, 100, 30)).toBe(1);
    expect(DivinePetSeal.carryHp(0, 100, 30)).toBe(0);
    expect(DivinePetSeal.carryHp(undefined, 100, 30)).toBe(30);
  });

  it("releases on 98:30:124 or on all three final receipts", () => {
    const seal = new DivinePetSeal(SEA.divine);
    const done = (events: number[]) => (scene: number, room: number, event: number) =>
      scene === 98 && room === 30 && events.includes(event);
    expect(seal.released(done([]))).toBe(false);
    expect(seal.released(done([121, 122]))).toBe(false);
    expect(seal.released(done([121, 122, 123]))).toBe(true);
    expect(seal.released(done([124]))).toBe(true);
    expect(seal.percent(DIVINE, false)).toBe(30);
    expect(seal.percent(DIVINE, true)).toBe(120);
    expect(seal.percent(1, false)).toBe(100);
  });

  it("seals an owned Divine pet's fighting stats and keeps its HP fraction", () => {
    const w = world();
    const { pet, core, services } = own(w, DIVINE, (max) => Math.floor(max / 2));
    w.tick([]);
    const sealed = DivinePetSeal.scaleStats(core, 30);
    expect(pet.maxHp).toBe(sealed.hp);
    expect(pet.currentHp).toBe(DivinePetSeal.carryHp(Math.floor(core.hp / 2), core.hp, sealed.hp));
    const setup = services.partyMember(pet);
    expect(setup.stats).toEqual(sealed);
    expect(setup.hp).toBe(pet.currentHp);
    const card = worldPetCard(pet, 1, services);
    expect(card.pet!.divineSealed).toBe(true);
    expect(card.pet!.stats).toEqual([sealed.hp, sealed.attack, sealed.defense, sealed.speed]);
    // An opponent of the same species is not owned: it keeps its whole baseline.
    expect(services.encounterPet(DIVINE, 60, 3, 0).stats).toEqual(core);

    // The title: 120% from then on, the fraction carried again.
    const before = pet.currentHp!;
    w.eventState.op14CompleteEvent(98, 30, 124);
    w.tick([]);
    const released = DivinePetSeal.scaleStats(core, 120);
    expect(pet.maxHp).toBe(released.hp);
    expect(pet.currentHp).toBe(DivinePetSeal.carryHp(before, sealed.hp, released.hp));
    expect(services.partyMember(pet).stats).toEqual(released);
    expect(worldPetCard(pet, 1, services).pet!.divineSealed).toBe(false);
  });

  it("keeps a KO Divine pet KO and a fresh one full", () => {
    const w = world();
    const ko = own(w, DIVINE, () => 0).pet;
    const fresh = own(w, SEA.divine.species[1]);
    w.tick([]);
    expect(ko.currentHp).toBe(0);
    expect(fresh.pet.currentHp).toBeUndefined();
    expect(fresh.services.partyMember(fresh.pet).hp).toBe(fresh.pet.maxHp);
  });

  it("leaves every other species exactly as it was", () => {
    const w = world();
    const other = Array.from({ length: 279 }, (_, id) => id + 1).find(
      (id) =>
        !SEA.divine.species.includes(id) &&
        !eggPetBuff(id) &&
        w.battleServices!.petStats.coreStats(id, 60, 3, 0).hp > 0,
    )!;
    const { pet, core, services } = own(w, other, (max) => max - 7);
    const snapshot = { ...pet };
    w.tick([]);
    expect(pet).toEqual(snapshot);
    expect(services.partyMember(pet).stats).toEqual(core);
    expect(worldPetCard(pet, 1, services).pet!.divineSealed).toBe(false);
  });

  // Web only (owner 2026-11-18): an owned egg pet fights with its own buff, an opponent of its species at 100%.
  it("raises an owned egg pet by its own buff, HP fraction kept, opponents untouched", () => {
    const w = world();
    // 162 Heo đốm (weak, the biggest buff) and 223, an earlier form that takes 225's buff.
    for (const egg of [162, 223]) {
      expect(eggPetBuff(egg)).toBeDefined();
      const { pet, core, services } = own(w, egg, (max) => Math.floor(max / 2));
      w.tick([]);
      const buffed = applyEggPetBuff(egg, core);
      expect(buffed.speed - core.speed).toBe(eggPetBuff(egg)!.speed);
      expect(buffed.attack).toBeGreaterThan(core.attack);
      expect(pet.maxHp).toBe(buffed.hp);
      expect(pet.currentHp).toBe(
        DivinePetSeal.carryHp(Math.floor(core.hp / 2), core.hp, buffed.hp),
      );
      expect(services.partyMember(pet).stats).toEqual(buffed);
      expect(worldPetCard(pet, 1, services).pet!.divineSealed).toBe(false);
      expect(services.encounterPet(egg, 60, 3, 0).stats).toEqual(core);
    }
  });
});
