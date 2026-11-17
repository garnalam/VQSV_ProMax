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
const { loadBattleRules } = await import("../battle/BattleRules");
const { BattleRandom } = await import("../battle/BattleRandom");
const { BattleCore } = await import("../battle/engine/BattleCore");
const { BattleItems } = await import("../battle/engine/BattleItems");
const { BasicEnemyAi } = await import("../battle/engine/EnemyController");
const { WorldPanel } = await import("../world/WorldPanel");
const charms = await import("./RainbowCharms");
const battle = await import("./RainbowCharmBattle");
type CombatantSetup = import("../battle/engine/BattleTypes").CombatantSetup;
type BattleSetup = import("../battle/engine/BattleTypes").BattleSetup;
const types = await import("../battle/engine/BattleTypes");

const pack = await Pack.load();
const data = new GameData(pack);
const doc =
  await pack.json<import("./RainbowCharms").RainbowCharmsDocument>("story.rainbow-charms");
const catalog = new charms.RainbowCharmCatalog(doc);
const rules = await loadBattleRules(data);
const items = new BattleItems(await data.items());
const species = (await data.species()).rows;
const golden = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "RainbowCharmBattle.golden.json"), "utf8"),
) as {
  kimLoai: number;
  thucVat: number;
  rows: Record<string, number | boolean | number[] | string>[];
};

const loadout = (id: number, tier: number) => [{ charm: catalog.byRuntimeId(id)!, tier }];
const state = (id: number, tier: number, side: 0 | 1) =>
  new battle.RainbowCharmBattleState(catalog, loadout(id, tier), side);
/** A unit the way `BattleCore.buildSide` makes one, at the probe's stats. */
const unit = (speciesId: number, side: 0 | 1, hp: number, defense: number) => {
  const built = rules.traits.unit({
    speciesId,
    ownerSide: side,
    formationSlot: side === 0 ? 1 : 0,
    base: { hp, attack: 100, defense, speed: 50 },
  });
  built.restoreStatsForCheck();
  return built;
};
const noRandom = () => 0;

describe("RainbowCharmBattleState matches JavaSE (ProbeWebRainbowCharms golden)", () => {
  it("replays every probed answer", () => {
    for (const row of golden.rows) {
      const tier = row.tier as number;
      switch (row.kind) {
        case "choose": {
          const id = battle.chooseNpcCharm(
            catalog,
            row.roster as number[],
            () => row.pick as number,
          );
          expect(id, JSON.stringify(row)).toBe(row.id);
          break;
        }
        case "heal": {
          const charm = state(5037, tier, 0),
            hurt = unit(golden.thucVat, 0, 300, 40);
          hurt.setHp(140);
          expect([charm.tryEmergencyHeal(hurt), charm.tryEmergencyHeal(hurt)]).toEqual([
            row.first,
            row.second,
          ]);
          break;
        }
        case "revive": {
          const charm = state(5047, tier, 1),
            fallen = unit(golden.thucVat, 1, 300, 40);
          fallen.setHp(0);
          const hp = charm.tryRevive(fallen, row.roll as number),
            again = charm.tryRevive(fallen, 0);
          expect([hp, again], JSON.stringify(row)).toEqual([row.hp, row.again]);
          break;
        }
        case "defense": {
          const tank = unit(golden.kimLoai, 0, 300, row.base as number),
            other = unit(golden.thucVat, 0, 300, row.base as number);
          state(5042, tier, 0).applyUnitModifiers(tank, noRandom);
          state(5042, tier, 0).applyUnitModifiers(other, noRandom);
          expect(
            [tank.currentStats.defense, other.currentStats.defense],
            JSON.stringify(row),
          ).toEqual([row.metal, row.other]);
          break;
        }
        case "chance": {
          const roll = row.roll as number,
            target = unit(golden.thucVat, 0, 300, 40);
          expect(
            [
              state(5057, tier, 0).tryEvade(target, false, roll),
              state(5057, tier, 0).tryEvade(target, true, roll),
              state(5051, tier, 0).guaranteesWildEscape(roll),
            ],
            JSON.stringify(row),
          ).toEqual([row.evade, row.evadeSure, row.escape]);
          break;
        }
        case "capture": {
          const charm = state(5050, tier, 0),
            gains = [0, 1, 2, 3].map(() => charm.recordCaptureFailureBonus());
          expect([gains, charm.captureFailureBonusPoints()]).toEqual([row.gains, row.total]);
          break;
        }
      }
    }
    expect(golden.rows.length).toBe(80);
  });
});

describe("charm species of the pets after 201", () => {
  it("gives every pet a species, so the species charms serve Liệt Hỏa's newer pets too", () => {
    // Java's taxonomy stops at 201 (plus its mutations). The newer pets keep their old species trait
    // in their design traits (TV/KL/PH/MT/HD), which agrees with every species Java does name.
    expect([202, 205, 210, 217, 222, 273].map((id) => catalog.petSpecies(id))).toEqual([
      0, 3, 1, 4, 2, 3,
    ]);
    const unnamed = species.flatMap((_, id) => (catalog.petSpecies(id) < 0 ? [id] : []));
    // 278 is the final boss, 280 has no design trait.
    expect(unnamed).toEqual([278, 280]);
    // A Kim Loại newcomer stands on Thép thiết cốt's defense like a Kim Loại pet of 0..201.
    const metal = unit(210, 0, 300, 40);
    state(5042, 5, 0).applyUnitModifiers(metal, noRandom);
    expect(metal.rainbowCharmDefenseBonus).toBe(30);
  });
});

describe("RainbowCharmService", () => {
  const purse = (money: number, badges: number, materials: Record<string, number> = {}) => ({
    currency: { money },
    materials: { ...materials },
    equipment: [] as number[],
    achievedBadges: badges,
  });

  it("crafts behind the badge unlock, money and materials, and spends exactly the recipe", () => {
    const owned = charms.emptyCharmState();
    // Kỹ năng Phong Bế needs 4 badges.
    expect(charms.craftCharm(catalog, owned, purse(99999, 3, { 12: 9, 13: 9 }), 5039).outcome).toBe(
      "LOCKED",
    );
    expect(charms.craftCharm(catalog, owned, purse(7499, 4, { 12: 9, 13: 9 }), 5039).outcome).toBe(
      "INSUFFICIENT_MONEY",
    );
    expect(charms.craftCharm(catalog, owned, purse(7500, 4, { 12: 4, 13: 1 }), 5039).outcome).toBe(
      "INSUFFICIENT_MATERIALS",
    );
    const wallet = purse(8000, 4, { 12: 6, 13: 1 });
    const crafted = charms.craftCharm(catalog, owned, wallet, 5039);
    expect([crafted.outcome, charms.charmTier(owned, 5039)]).toEqual(["CRAFTED", 1]);
    expect([wallet.currency.money, wallet.materials, wallet.equipment]).toEqual([
      500,
      { 12: 1 },
      [5039],
    ]);
    expect(charms.craftCharm(catalog, owned, wallet, 5039).outcome).toBe("ALREADY_OWNED");
    expect(charms.charmResultMessage(crafted)).toBe("Chế tác thành công bùa cấp I.");
  });

  it("owns a charm that reached the bag without its tier (admin gift, banked pet)", () => {
    const owned = charms.emptyCharmState(),
      wallet = purse(99999, 8, { 12: 9, 15: 9 });
    owned.tiers["5048"] = 2;
    wallet.equipment.push(5037, 3);
    // 5037 in the bag only, 5057 worn by a pet only, 5048 tiered but missing from the bag.
    expect(charms.syncCharmOwnership(catalog, owned, wallet.equipment, [5057, 1])).toBe(true);
    expect(owned.tiers).toEqual({ 5037: 1, 5048: 2, 5057: 1 });
    expect(wallet.equipment.sort((a, b) => a - b)).toEqual([3, 5037, 5048, 5057]);
    expect(charms.syncCharmOwnership(catalog, owned, wallet.equipment, [5057])).toBe(false);
    // Now listed on "Trang bị" and equippable instead of refused as "already owned".
    expect(charms.equipCharm(catalog, owned, 5037).outcome).toBe("EQUIPPED");
  });

  it("upgrades tier by tier with the species recipes and stops at V", () => {
    const owned = charms.emptyCharmState(),
      wallet = purse(1_000_000, 8, { 12: 99, 13: 99, 14: 99, 3000: 99, 3001: 99, 3002: 99 });
    charms.craftCharm(catalog, owned, wallet, 5040);
    for (const tier of [2, 3, 4, 5]) {
      const result = charms.upgradeCharm(catalog, owned, wallet, 5040);
      expect([result.outcome, result.tierAfter]).toEqual(["UPGRADED", tier]);
    }
    expect(charms.upgradeCharm(catalog, owned, wallet, 5040).outcome).toBe("ALREADY_MAX");
    // Tier I -> II of a species charm: 3000 x3, 12 x2, 2000 kim, 2 badges.
    expect(catalog.byRuntimeId(5040)!.upgrades[0]).toEqual({
      money: 2000,
      badgesRequired: 2,
      materials: [
        [3000, 3],
        [12, 2],
      ],
    });
    expect(charms.charmCostLine(catalog, catalog.byRuntimeId(5040)!, 1)).toBe(
      "Cần 2 HH | 2000 kim | Thụ chướng thạchx3 | Tinh Nguyên Thạchx2",
    );
  });

  it("equips one charm per slot and restores only valid saved state", () => {
    const owned = charms.emptyCharmState();
    owned.tiers["5037"] = 2;
    owned.tiers["5057"] = 1;
    charms.equipCharm(catalog, owned, 5037);
    charms.equipCharm(catalog, owned, 5057);
    expect(owned.active.SURVIVAL).toBe(5057);
    expect(charms.activeCharmValue(catalog, owned, "EVASION")).toBe(8);
    const restored = charms.restoreCharmState(catalog, {
      starterClaimed: true,
      tiers: { "5037": 3, "9999": 2, "5040": 7 },
      active: { SURVIVAL: 5037, TACTICAL: 5040, EXPLORATION: 5037 },
    });
    expect(restored).toEqual({
      starterClaimed: true,
      tiers: { "5037": 3 },
      active: { SURVIVAL: 5037, TACTICAL: -1, EXPLORATION: -1 },
    });
  });
});

describe("Bùa hộ trận panel (tickRainbowCharm)", () => {
  it("lists owned charms to equip, all to craft, and confirms a craft", () => {
    const owned = charms.emptyCharmState();
    owned.tiers["5037"] = 1;
    const wallet = {
        currency: { money: 9000 },
        materials: { 12: 9, 15: 2 } as Record<string, number>,
        equipment: [] as number[],
        achievedBadges: 0,
      },
      panel = new WorldPanel();
    panel.charmSource = {
      definitions: () => catalog.definitions,
      tier: (id) => charms.charmTier(owned, id),
      owns: (id) => charms.ownsCharm(owned, id),
      activeId: (slot) => owned.active[slot],
      money: () => wallet.currency.money,
      achievedBadges: () => wallet.achievedBadges,
      mainTaskProgress: () => 5,
      equip: (id) => charms.equipCharm(catalog, owned, id),
      craft: (id) => charms.craftCharm(catalog, owned, wallet, id),
      upgrade: (id) => charms.upgradeCharm(catalog, owned, wallet, id),
    };
    expect(panel.openRainbowCharm()).toBeNull();
    expect(panel.rainbowCharmRows.map((row) => row.runtimeId)).toEqual([5037]);
    panel.tick(["confirm"]);
    expect([panel.rainbowCharmMessage, owned.active.SURVIVAL]).toEqual([
      "Đã trang bị bùa vào ô đội.",
      5037,
    ]);
    panel.tick(["right"]);
    expect(panel.rainbowCharmRows.length).toBe(12);
    panel.tick(["confirm"]);
    expect(panel.rainbowCharmMessage).toBe("Bùa này đã có trong kho.");
    panel.tick(["down"]);
    panel.tick(["down"]);
    panel.tick(["down"]);
    panel.tick(["down"]);
    panel.tick(["down"]);
    panel.tick(["down"]);
    panel.tick(["down"]);
    panel.tick(["down"]);
    // Row 8: May mắn ngôi sao (5048): 5000 kim, 12 x5, 13 x1 - no 13 in the bag.
    panel.tick(["confirm"]);
    expect(panel.mode).toBe("rainbowCharmConfirm");
    panel.tick(["confirm"]);
    expect([panel.mode, panel.rainbowCharmMessage]).toEqual([
      "rainbowCharm",
      "Không đủ nguyên liệu.",
    ]);
    panel.tick(["back"]);
    expect(panel.visible).toBe(false);
    const locked = new WorldPanel();
    locked.charmSource = { ...panel.charmSource, mainTaskProgress: () => 4 };
    expect(locked.openRainbowCharm()).toBe("Hoàn thành hướng dẫn trang bị Pet để mở Bùa Hộ Trận.");
  });
});

describe("charms in a fight (BattleCore)", () => {
  class Fixed extends BattleRandom {
    constructor(private readonly value: number) {
      super();
    }
    override percent(label: string): number {
      if (/crit|jitter/.test(label)) return 99;
      if (/hitroll/.test(label)) return 0;
      return this.value;
    }
    override next(_label: string, bound: number): number {
      return Math.min(bound - 1, this.value);
    }
  }
  const pet = (speciesId: number, extra: Partial<CombatantSetup> = {}): CombatantSetup => ({
    speciesId,
    level: 10,
    quality: 2,
    nature: 2,
    stats: { hp: 300, attack: 120, defense: 40, speed: 50 },
    skillIds: [species[speciesId].element * 10],
    ...extra,
  });
  const fight = (setup: Partial<BattleSetup>, roll = 0) => {
    const core = new BattleCore(
      rules,
      { items, relationClass: (id: number) => species[id]?.relationClass ?? 0 },
      { format: "1v1", kind: "wild", player: [pet(68)], enemy: [pet(34)], ...setup },
      new Fixed(roll),
      new BasicEnemyAi(rules),
    );
    core.start();
    return core;
  };

  it("heals the player's pet once under half HP and shows the badge", () => {
    const core = fight({
      player: [pet(68, { hp: 100 })],
      charms: { player: state(5037, 3, 0) },
    });
    expect(core.events.find((e) => e.type === "charmHeal")).toEqual({
      type: "charmHeal",
      seat: { side: "player", member: 0 },
      amount: 90,
    });
    expect(core.activeUnit("player").hp()).toBe(190);
    expect(core.charmHud("player").map((entry) => entry.charm.runtimeId)).toEqual([5037]);
  });

  it("lets Thế thân tượng gỗ dodge every blow on a passing roll", () => {
    const core = fight({ charms: { player: state(5057, 5, 0) } }, 0);
    const hp = core.activeUnit("player").hp();
    core.submit({ kind: "skill", slot: 0 });
    expect(core.activeUnit("player").hp()).toBe(hp);
    const enemyHits = core.events.filter((e) => e.type === "skill" && e.seat.side === "enemy");
    expect(enemyHits.every((e) => e.type === "skill" && !e.hit)).toBe(true);
  });

  it("revives a fallen pet with Trọng sinh làm tâm instead of ending the fight", () => {
    const core = fight(
      {
        player: [pet(68, { hp: 1, stats: { hp: 300, attack: 1, defense: 1, speed: 1 } })],
        enemy: [pet(34, { stats: { hp: 900, attack: 400, defense: 400, speed: 200 } })],
        charms: { player: state(5047, 5, 0) },
      },
      0,
    );
    core.submit({ kind: "skill", slot: 0 });
    const revive = core.events.find((e) => e.type === "charmRevive");
    expect(revive).toEqual({ type: "charmRevive", seat: { side: "player", member: 0 }, hp: 150 });
  });

  it("seals the enemy's first skills and lets a restricted run through with the escape charm", () => {
    const sealed = fight({ charms: { player: state(5039, 5, 0) } }, 0);
    const enemy = sealed.activeUnit("enemy");
    // `trySeal`: the Phong Bế status (two rounds, primary = slots) and the three sealed slots.
    expect(enemy.rainbowCharmSealedSkillSlots).toBe(3);
    expect(enemy.rainbowCharmSealed()).toBe(true);
    expect(enemy.statuses.get(2, 6)).toMatchObject({
      remainingTurns: 2,
      primaryValue: 3,
      sourceSide: 0,
    });
    const escape = fight({ runAllowed: false, charms: { player: state(5051, 5, 0) } }, 0);
    escape.submit({ kind: "run" });
    expect(escape.request.kind).toBe("ended");
    const stuck = fight({ runAllowed: false, charms: { player: state(5051, 1, 0) } }, 50);
    expect(() => stuck.submit({ kind: "run" })).toThrow();
  });

  it("an NPC's Kỹ năng Phong Bế plants Phong Bế on the player's pets and gates the pick like Java", () => {
    const { TIER_LOCK_WARNING, SKILL_NOT_READY_WARNING } = types;
    // Four tier-1 skills and a tier-2 one: `trySeal` closes known - 1 = 3 (slot 3 stays open).
    const tier = (wanted: number) =>
      Array.from({ length: 400 }, (_, id) => id).filter(
        (id) =>
          rules.damage.skillRow(id)?.learnTier === wanted &&
          rules.damage.skillRow(id)?.damageBranch !== "unified",
      );
    const ones = tier(1).slice(0, 4),
      two = tier(2)[0];
    const tough = { hp: 9000, attack: 1, defense: 900, speed: 50 };
    const core = fight(
      {
        player: [pet(68, { stats: tough, skillIds: [...ones, two] })],
        enemy: [pet(34, { stats: tough })],
        charms: { enemy: () => state(5039, 5, 1) },
      },
      0,
    );
    const mine = core.activeUnit("player");
    expect(mine.rainbowCharmSealedSkillSlots).toBe(3);
    expect(mine.statuses.get(2, 6)).toMatchObject({
      remainingTurns: 2,
      primaryValue: 3,
      sourceSide: 1,
    });
    // The HUD strip shows it like any Cầu Vồng status.
    expect(mine.statuses.has(2, 6)).toBe(true);
    // A sealed slot: `canUseSourceSkillId`'s refusal; the tier-2 skill: the tier lock comes first.
    expect(() => core.submit({ kind: "skill", slot: 0 })).toThrow(SKILL_NOT_READY_WARNING);
    expect(() => core.submit({ kind: "skill", slot: 4 })).toThrow(TIER_LOCK_WARNING);
    core.submit({ kind: "skill", slot: 3 });
    core.submit({ kind: "skill", slot: 3 });
    // Two owner rounds later the status is gone and every slot opens again.
    expect(mine.statuses.has(2, 6)).toBe(false);
    expect(mine.rainbowCharmSealed()).toBe(false);
    core.submit({ kind: "skill", slot: 0 });
    core.submit({ kind: "skill", slot: 4 });
  });

  it("drains the target's chosen skill and refunds the user's on matching species only", () => {
    const flyer = species.findIndex((_, id) => catalog.petSpecies(id) === 2),
      swimmer = species.findIndex((_, id) => catalog.petSpecies(id) === 4),
      user = unit(flyer, 0, 300, 40),
      target = unit(golden.thucVat, 1, 300, 40);
    user.skillIds[0] = 10;
    user.skillPp[0] = 3;
    target.skillIds[1] = 20;
    target.skillPp[1] = 5;
    target.selectedSkillId = 20;
    const drain = state(5043, 5, 0);
    expect(drain.afterSkillPp(user, target, 10, 0, -1, () => 9)).toBe(true);
    expect(target.skillPp[1]).toBe(4);
    expect(drain.afterSkillPp(user, target, 10, 99, -1, () => 9)).toBe(false);
    const refund = state(5044, 5, 0),
      sea = unit(swimmer, 0, 300, 40);
    sea.skillIds[0] = 10;
    sea.skillPp[0] = 3;
    expect(refund.afterSkillPp(sea, target, 10, -1, 0, () => 9)).toBe(true);
    expect(sea.skillPp[0]).toBe(4);
    // A Phi Hành pet gets nothing from the Hải Dương charm.
    expect(refund.afterSkillPp(user, target, 10, -1, 0, () => 9)).toBe(false);
  });

  it("gives a Cầu Vồng trainer one charm at tier IV or V, and none elsewhere", () => {
    const rosterSpecies = [golden.kimLoai, golden.kimLoai];
    expect(
      battle.npcCharmLoadout(
        catalog,
        { sceneId: 98, trainerOwned: true, pvp: false },
        rosterSpecies,
        () => 1,
      ),
    ).toEqual([{ charm: catalog.byRuntimeId(5042), tier: 5 }]);
    expect(
      battle.npcCharmLoadout(
        catalog,
        { sceneId: 1, trainerOwned: true, pvp: false },
        rosterSpecies,
        () => 1,
      ),
    ).toBeNull();
  });
});
