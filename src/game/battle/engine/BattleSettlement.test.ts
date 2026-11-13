import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(
    import.meta.dirname,
    "../../../../public",
    decodeURIComponent(String(input).split("?")[0].replace(/^\//, "")),
  );
  if (!existsSync(file)) return { ok: false, status: 404 };
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, "utf8")) };
});

const { GameData } = await import("../../../data/GameData");
const { Pack } = await import("../../../pack/Pack");
const { loadBattleRules } = await import("../BattleRules");
const { BattleRandom } = await import("../BattleRandom");
const { PetStatCalculator } = await import("../PetStatCalculator");
const { BattleCore } = await import("./BattleCore");
const { BattleItems } = await import("./BattleItems");
const { BasicEnemyAi } = await import("./EnemyController");
const { PetProgression, requiredExp } = await import("./PetProgression");
const { settleBattle } = await import("./BattleSettlement");
type SavedPet = import("../../../persistence/save/GameSave").SavedPet;

const data = new GameData(await Pack.load());
const rules = await loadBattleRules(data);
const petStats = await PetStatCalculator.load(data);
const items = new BattleItems(await data.items());
const species = (await data.species()).rows;
const petKeys = new Map((await data.designTraits()).map((row) => [row.speciesId, row.petKey]));
const progression = new PetProgression(
  petStats,
  await data.learnsets(),
  petKeys,
  (id) => rules.damage.skillRow(id)?.ppMax ?? 0,
);

class Fixed extends BattleRandom {
  constructor(private readonly value = 50) {
    super();
  }
  override percent(label: string): number {
    return /crit|jitter|hitroll/.test(label) ? 99 : this.value;
  }
}
const saved = (speciesId: number, level: number): SavedPet => {
  const skillIds = progression.defaultSkills(speciesId, level),
    stats = petStats.coreStats(speciesId, level, 3);
  return {
    speciesId,
    level,
    quality: 3,
    currentHp: stats.hp,
    maxHp: stats.hp,
    experience: 0,
    skillIds,
    skillPp: skillIds.map((id) => rules.damage.skillRow(id)!.ppMax),
  };
};
const setupOf = (pet: SavedPet) => ({
  speciesId: pet.speciesId,
  level: pet.level,
  quality: pet.quality,
  nature: pet.nature ?? 0,
  stats: petStats.coreStats(pet.speciesId, pet.level, pet.quality),
  hp: pet.currentHp,
  skillIds: pet.skillIds ?? [],
  skillPp: pet.skillPp,
});

/** The player's strongest damaging slot. */
const bestSlot = (pet: SavedPet) => {
  const ids = pet.skillIds!,
    power = (id: number) => rules.damage.skillRow(id)?.powerPercent ?? 0;
  return ids.indexOf(ids.reduce((a, b) => (power(b) > power(a) ? b : a)));
};

describe("PetProgression", () => {
  it("builds the same early unified-v5 decks as Java PetSourceAdapter", () => {
    expect(progression.initialSkills(6, 7)).toEqual([0, 85, 1, 2]);
    expect(progression.initialSkills(34, 5)).toEqual([20, 85, 21, 22]);
    expect(progression.initialSkills(68, 7)).toEqual([40, 85, 41, 43]);
  });

  it("needs 15·L² − 200 EXP for level L, and spends it on the way up", () => {
    expect([requiredExp(2), requiredExp(10), requiredExp(50), requiredExp(100)]).toEqual([
      1, 1300, 37300, 149800,
    ]);
    const pet = saved(68, 9);
    pet.currentHp = 1;
    const result = progression.addExperience(pet, requiredExp(10) + requiredExp(11) + 5);
    expect([pet.level, pet.experience, result.levelsGained]).toEqual([11, 5, 2]);
    expect(result.steps.map((step) => step.level)).toEqual([10, 11]);
    expect(result.steps[0].statsAfter).toEqual(result.steps[1].statsBefore);
    // A level-up refills HP for the new level and every PP.
    expect(pet.currentHp).toBe(petStats.coreStats(68, 11, 3).hp);
    expect(pet.skillPp).toEqual(pet.skillIds!.map((id) => rules.damage.skillRow(id)!.ppMax));
  });

  it("learns what unlocks at the new level into a free slot, and stops at level 100", () => {
    const pet = saved(34, 3),
      before = [...pet.skillIds!];
    const result = progression.addExperience(pet, requiredExp(4));
    const fresh = progression
      .unlocked(34, 4)
      .filter((id) => !progression.unlocked(34, 3).includes(id));
    expect(result.learned.concat(result.pending).sort()).toEqual(fresh.sort());
    expect(pet.skillIds!.slice(0, before.length)).toEqual(before);
    const top = saved(34, 100);
    expect(progression.addExperience(top, 99999).levelsGained).toBe(0);
    expect(top.experience).toBe(0);
  });

  it("keeps a shiny pet's nature bend through a level-up and a heal", () => {
    const pet = saved(34, 9);
    pet.nature = 8;
    pet.maxHp = pet.currentHp = petStats.coreStats(34, 9, 3, 8).hp;
    const result = progression.addExperience(pet, requiredExp(10));
    expect([pet.level, result.levelsGained]).toEqual([10, 1]);
    const after = petStats.coreStats(34, 10, 3, 8);
    expect(pet.maxHp).toBe(after.hp);
    expect(pet.currentHp).toBe(after.hp);
    // The stat line the level-up reports is the bent one, and the level shown is what a plain
    // nature of the same pet would answer — the bend survives the recompute, as it does in Java's
    // refreshBaseStatsForCurrentLevel.
    const plain = petStats.coreStats(34, 10, 3, 1);
    expect(result.statsAfter).toEqual([after.hp, after.attack, after.defense, after.speed]);
    // The stat line the level-up reports is the bent one, not what a plain nature of the same pet
    // would answer — the bend survives the recompute, as it does in Java's
    // refreshBaseStatsForCurrentLevel.
    expect(result.statsAfter).not.toEqual([plain.hp, plain.attack, plain.defense, plain.speed]);
    pet.currentHp = 1;
    progression.restore(pet);
    expect(pet.maxHp).toBe(after.hp);
    expect(pet.currentHp).toBe(after.hp);
  });
});

describe("settleBattle", () => {
  const fight = (party: SavedPet[], enemy: SavedPet, extra = {}) => {
    const core = new BattleCore(
      rules,
      { items, relationClass: (id) => species[id]?.relationClass ?? 0 },
      {
        format: "1v1",
        kind: "wild",
        player: party.map(setupOf),
        enemy: [setupOf(enemy)],
        inventory: { 0: 2, 1: 3 },
        ...extra,
      },
      new Fixed(),
      new BasicEnemyAi(rules),
    );
    core.start();
    return core;
  };

  it("a win writes HP, PP and EXP back, and levels the pet up", () => {
    const party = [saved(68, 20)],
      core = fight(party, saved(34, 18));
    for (let i = 0; i < 80 && core.request.kind === "command"; i++)
      core.submit({ kind: "skill", slot: bestSlot(party[0]) });
    const inventory: Record<string, number> = {},
      report = settleBattle(core, party, inventory, progression);
    expect(report.outcome.winner).toBe("player");
    expect(report.members[0].experience).toBeGreaterThan(0);
    expect(party[0].experience! + (party[0].level > 20 ? 1 : 0)).toBeGreaterThan(0);
    // The slot it fought with is down on PP — unless a level-up refilled it.
    const used = bestSlot(party[0]),
      max = rules.damage.skillRow(party[0].skillIds![used])!.ppMax;
    if (report.members[0].levelUp.levelsGained === 0)
      expect(party[0].skillPp![used]).toBeLessThan(max);
    else expect(party[0].skillPp![used]).toBe(max);
    expect(inventory).toEqual({ "0": 2, "1": 3 });
  });

  it("a catch puts the pet in the roster with the HP it was caught at, and spends the ball", () => {
    const party = [saved(68, 10)],
      core = fight(party, saved(34, 5));
    core.submit({ kind: "catch", itemId: 0 });
    const inventory: Record<string, number> = {},
      report = settleBattle(core, party, inventory, progression);
    expect(report.caught?.storage).toBe("ROSTER");
    expect(party).toHaveLength(2);
    expect(party[1]).toMatchObject({ speciesId: 34, level: 5, slot: 1 });
    expect(party[1].skillIds).toEqual([20, 85, 21, 22]);
    expect(party[1].skillPp).toHaveLength(4);
    expect(party[1].currentHp).toBe(core.unit("enemy", 0).hp());
    expect(inventory["0"]).toBe(1);
  });

  it("a loss restores the whole party to full", () => {
    const party = [saved(68, 2)],
      core = fight(party, saved(34, 40));
    for (let i = 0; i < 80 && core.request.kind === "command"; i++)
      core.submit({ kind: "skill", slot: bestSlot(party[0]) });
    const report = settleBattle(core, party, {}, progression);
    expect(report.outcome.winner).toBe("enemy");
    expect(report.restoredAfterLoss).toBe(true);
    expect(party[0].currentHp).toBe(petStats.coreStats(68, 2, 3).hp);
  });

  it("the story script: the first throw fails, the bunny never falls", () => {
    const party = [saved(68, 30)],
      core = fight(party, saved(34, 3), {
        script: { unkillable: "enemy", forcedCatch: (attempt: number) => attempt > 1 },
      });
    core.submit({ kind: "catch", itemId: 1 });
    expect(core.request.kind).toBe("command");
    for (let i = 0; i < 5; i++) {
      const hit = core
        .submit({ kind: "skill", slot: bestSlot(party[0]) })
        .find((e) => e.type === "skill" && e.seat.side === "player");
      expect(hit).toMatchObject({ targetHp: 1 });
    }
    // Its own characteristic (Di lặc cân bằng: under 40%, 20% at the round end) heals it back up.
    expect(core.unit("enemy", 0).alive()).toBe(true);
    core.submit({ kind: "catch", itemId: 1 });
    expect(core.request).toMatchObject({ kind: "ended", outcome: { reason: "catch" } });
  });
});
