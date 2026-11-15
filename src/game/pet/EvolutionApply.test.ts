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
const { gameplaySources } = await import("../session/GameplayHost");
const { applyEvolution, repairEvolvedSprite } = await import("./Evolution");
const { EvolutionSession } = await import("./EvolutionSession");
type SavedPet = import("../../persistence/save/GameSave").SavedPet;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
const sources = gameplaySources(assets, boot),
  services = sources.world.battle!,
  evolutions = sources.evolutions!;
const spriteOf = (speciesId: number) =>
  services.partyMember({ speciesId, level: 1, quality: 1 }).spriteId;

/** A pet as the game holds it: its own form's sprite pinned, as captures and the starter do. */
function ownedPet(speciesId: number, level: number, quality: number): SavedPet {
  const pet: SavedPet = { speciesId, level, quality, nature: 2, experience: 0 };
  const setup = services.partyMember(pet);
  return {
    ...pet,
    visualSpriteId: setup.spriteId,
    skillIds: [...setup.skillIds],
    skillPp: [...(setup.skillPp ?? [])],
    currentHp: setup.stats.hp,
    maxHp: setup.stats.hp,
  };
}

describe("evolution changes the pet into its new form (VqsvSourceEvolutionRuntime.mutatePet)", () => {
  it("takes the new species' sprite, name, stats and full HP — not the old form's sprite", () => {
    const pet = ownedPet(68, 20, 1),
      before = services.partyMember(pet),
      rule = evolutions.rules(68).find((row) => row.toSpecies === 69)!;
    expect(spriteOf(69)).not.toBe(spriteOf(68));
    applyEvolution(pet, rule, services);
    const after = services.partyMember(pet);
    expect(pet.speciesId).toBe(69);
    expect(pet.visualSpriteId).toBe(spriteOf(69));
    expect(after.spriteId).toBe(spriteOf(69));
    expect(after.name).not.toBe(before.name);
    expect(pet.maxHp).toBe(after.stats.hp);
    expect(pet.currentHp).toBe(after.stats.hp);
    expect(after.stats.hp).toBeGreaterThan(before.stats.hp);
    // An inheriting edge keeps the deck.
    expect(pet.skillIds).toEqual(before.skillIds);
  });

  it("raises the stars to the target's default (up to 3) and never lowers them", () => {
    const mutation = evolutions.rules(23).find((row) => row.toSpecies === 274)!,
      targetDefault = services.petStats.defaultQuality(274),
      low = ownedPet(23, 40, 1),
      high = ownedPet(23, 40, 5);
    applyEvolution(low, mutation, services);
    applyEvolution(high, mutation, services);
    expect(low.quality).toBe(Math.max(1, Math.min(3, targetDefault)));
    expect(high.quality).toBe(5);
    // Maximum HP is the evolved pet's, at its new stars.
    expect(low.maxHp).toBe(services.partyMember(low).stats.hp);
  });

  it("deals the scripted mutations (274, 275) their own starting deck", () => {
    for (const [from, to] of [
      [23, 274],
      [34, 275],
    ]) {
      const pet = ownedPet(from, 40, 3),
        rule = evolutions.rules(from).find((row) => row.toSpecies === to)!;
      applyEvolution(pet, rule, services);
      expect(pet.skillIds).toEqual(services.progression.initialSkills(to, 40));
      expect(pet.skillPp).toHaveLength(pet.skillIds!.length);
    }
  });

  it("marks the new form collected and previews the pet it will become", () => {
    const pet = ownedPet(68, 20, 1),
      rule = evolutions.rules(68).find((row) => row.toSpecies === 69)!,
      materials: Record<string, number> = {};
    for (const item of rule.ingredients) materials[String(item.materialId)] = item.quantity;
    const collected: number[] = [],
      session = new EvolutionSession(0, pet, rule, materials, services, (id) => collected.push(id));
    expect([session.oldSprite, session.newSprite]).toEqual([spriteOf(68), spriteOf(69)]);
    session.tick(["confirm"]);
    for (let i = 0; i < 30 && !session.succeeded; i++) session.tick([]);
    expect(session.succeeded).toBe(true);
    expect(collected).toEqual([69]);
    expect(services.partyMember(pet).spriteId).toBe(spriteOf(69));
    expect(session.newStats[0]).toBe(pet.maxHp);
  });

  it("gives a pet evolved by an older build its own sprite back, and leaves others alone", () => {
    const stale = { ...ownedPet(69, 20, 1), visualSpriteId: spriteOf(68) },
      fine = ownedPet(69, 20, 1),
      unrelated = { ...ownedPet(69, 20, 1), visualSpriteId: 9999 };
    expect(repairEvolvedSprite(stale, evolutions, spriteOf)).toBe(true);
    expect(stale.visualSpriteId).toBe(spriteOf(69));
    expect(repairEvolvedSprite(fine, evolutions, spriteOf)).toBe(false);
    expect(repairEvolvedSprite(unrelated, evolutions, spriteOf)).toBe(false);
    expect(unrelated.visualSpriteId).toBe(9999);
  });
});
