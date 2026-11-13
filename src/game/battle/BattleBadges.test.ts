import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(
    import.meta.dirname,
    "../../../public",
    decodeURIComponent(String(input).split("?")[0].replace(/^\//, "")),
  );
  if (!existsSync(file)) return { ok: false, status: 404 };
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, "utf8")) };
});

const { GameData } = await import("../../data/GameData");
const { Pack } = await import("../../pack/Pack");
const { loadBattleRules } = await import("./BattleRules");
const { PetStatCalculator } = await import("./PetStatCalculator");
const { BattleServices } = await import("./engine/BattleServices");
const { passiveHealAmount } = await import("./BattleOutcomeEngine");
const { NO_BADGE_PROFILE, battleBadgeProfile } = await import("./BattleBadges");
const { BadgeProgression, BADGE_HOA_PHONG, BADGE_LIET_HOA, BADGE_LOI_DIEN } =
  await import("../world/WorldFlags");
type BattleBadgeProfile = import("./BattleBadges").BattleBadgeProfile;

const data = new GameData(await Pack.load());
const rules = await loadBattleRules(data);
const petStats = await PetStatCalculator.load(data);
const services = await BattleServices.load(data, rules, petStats);
const species = new Map((await data.species()).rows.map((row) => [row.speciesId, row]));

/** Badges 0–6 achieved, as after the seven gym leaders; `enhance` lifts the listed ones too. */
function badges(achieved: readonly number[], enhanced: readonly number[] = []) {
  const progression = new BadgeProgression();
  for (const id of achieved) progression.grant(id);
  for (const id of enhanced) progression.enhance(id);
  return progression;
}

const SEVEN = [0, 1, 2, 3, 4, 5, 6];

function unit(ownerSide: number, profile: BattleBadgeProfile = NO_BADGE_PROFILE) {
  const stats = petStats.coreStats(68, 20, 2),
    built = rules.traits.unit({ speciesId: 68, ownerSide, formationSlot: 2, base: stats });
  built.restoreStatsForCheck();
  built.applySourceBadgeProfile(profile);
  return built;
}

const combatant = (u: ReturnType<typeof unit>) => ({
  speciesId: u.speciesId,
  attack: u.currentStats.attack,
  defense: u.currentStats.defense,
  visualSpriteId: -1,
  unit: u,
});

/** One hit with no crit and a fixed jitter, so only the badge moves the number. */
function hit(attacker: ReturnType<typeof unit>, target: ReturnType<typeof unit>): number {
  return rules.damage.damage({
    attacker: combatant(attacker),
    target: combatant(target),
    skillId: 40,
    randomPercent: () => 99,
  }).damage;
}

describe("gym badges in battle (PetBattleAdapter.battleBadgeProfile)", () => {
  it("reads the seven badge rows the way Java does: achieved terms only without an enhance", () => {
    const profile = battleBadgeProfile(badges(SEVEN), services.badgeRows);
    expect(profile).toEqual({
      maxHpPercent: 0,
      baseDefensePercent: 0,
      targetDefensePercent: 5,
      hitCheckSpeedBonus: 0,
      roundGrowthPercent: 0,
      roundGrowthCap: 0,
      damagePercent: 5,
      halveDebuffDuration: false,
    });
    expect(battleBadgeProfile(badges([]), services.badgeRows)).toEqual(NO_BADGE_PROFILE);
  });

  it("adds every enhanced term, and never one for Thủy Lam or the disabled Hoàng Kim", () => {
    const profile = battleBadgeProfile(badges(SEVEN, SEVEN), services.badgeRows);
    expect(profile).toEqual({
      maxHpPercent: 5,
      baseDefensePercent: 5,
      targetDefensePercent: 5,
      hitCheckSpeedBonus: 2,
      roundGrowthPercent: 1,
      roundGrowthCap: 20,
      damagePercent: 5,
      halveDebuffDuration: true,
    });
  });

  it("Mộc Quỳ and Đại Địa (enhanced) reshape a player pet's base; an enemy is untouched", () => {
    const plain = unit(0),
      profile = battleBadgeProfile(badges(SEVEN, SEVEN), services.badgeRows),
      player = unit(0, profile),
      enemy = unit(1, profile);
    expect(player.maxHp()).toBe(Math.trunc((plain.maxHp() * 105) / 100));
    expect(player.hp()).toBe(player.maxHp());
    expect(player.baseStats.defense).toBe(Math.trunc((plain.baseStats.defense * 105) / 100));
    expect(player.sourceHitCheckSpeed()).toBe(player.currentStats.speed + 2);
    expect(enemy.maxHp()).toBe(plain.maxHp());
    expect(enemy.baseStats.defense).toBe(plain.baseStats.defense);
  });

  it("Lôi Điện adds 5% to what a player pet deals, before the relation", () => {
    const profile = battleBadgeProfile(badges([BADGE_LOI_DIEN]), services.badgeRows),
      without = hit(unit(0), unit(1)),
      withBadge = hit(unit(0, profile), unit(1));
    expect(without).toBeGreaterThan(20);
    expect(withBadge).toBeGreaterThan(without);
    // An enemy carrying the same profile gains nothing: the bonus reads `ownerSide == 0`.
    expect(hit(unit(1, profile), unit(0))).toBe(hit(unit(1), unit(0)));
  });

  it("Hỏa Phong rewrites the player target's defense to base +5% before the hit reads it", () => {
    const profile = battleBadgeProfile(badges([BADGE_HOA_PHONG]), services.badgeRows),
      guarded = unit(0, profile),
      base = guarded.baseStats.defense;
    const taken = hit(unit(1), guarded);
    expect(guarded.currentStats.defense).toBe(Math.trunc((base * 105) / 100));
    expect(taken).toBeLessThan(hit(unit(1), unit(0)));
  });

  it("U Linh (enhanced) grows attack, defense and speed 1% a round up to 20%", () => {
    const grower = unit(0, battleBadgeProfile(badges(SEVEN, SEVEN), services.badgeRows)),
      base = { ...grower.baseStats };
    for (let round = 0; round < 25; round++) grower.advanceSourceBadgeRoundGrowth();
    expect(grower.sourceBadgeRoundGrowthCurrent()).toBe(20);
    expect(grower.currentStats.attack).toBe(Math.trunc((base.attack * 120) / 100));
    expect(grower.currentStats.speed).toBe(Math.trunc((base.speed * 120) / 100));
    expect(grower.advanceSourceBadgeRoundGrowth()).toBe(false);
  });

  it("Lôi Điện (enhanced) halves a debuff's turns on a player pet only", () => {
    const profile = battleBadgeProfile(badges(SEVEN, [BADGE_LOI_DIEN]), services.badgeRows);
    expect(unit(0, profile).incomingDebuffTurns(3)).toBe(1);
    expect(unit(1, profile).incomingDebuffTurns(3)).toBe(3);
    expect(unit(0).incomingDebuffTurns(3)).toBe(3);
  });

  it("Liệt Hỏa (enhanced) heals each pet a share of its species' base HP after the EXP", () => {
    services.badges = badges(SEVEN);
    expect(services.postExpBadgeHeal(68)).toBeUndefined();
    services.badges = badges(SEVEN, [BADGE_LIET_HOA]);
    expect(services.postExpBadgeHeal(68)).toBe(
      passiveHealAmount(species.get(68)!.baseHp, services.badgeRows.get(BADGE_LIET_HOA)!.b),
    );
    services.badges = undefined;
  });

  it("every fight the services build carries the world's badges into the player side", () => {
    services.badges = badges(SEVEN);
    const party = [
      services.partyMember({
        speciesId: 68,
        level: 20,
        quality: 2,
        currentHp: 1,
        maxHp: 1,
        experience: 0,
        skillIds: [40],
        skillPp: [20],
      }),
    ];
    const core = services.newCore({
      format: "1v1",
      kind: "wild",
      player: party,
      enemy: [services.encounterPet(34, 5, 1, 1, {})],
    });
    services.badges = undefined;
    expect(core.unit("player", 0).sourcePassiveDamagePercent()).toBe(5);
    expect(core.unit("enemy", 0).sourcePassiveDamagePercent()).toBe(0);
  });
});
