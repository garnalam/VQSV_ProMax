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
const { PetStatCalculator } = await import("../PetStatCalculator");
const { BattleServices } = await import("./BattleServices");
const { newDoubleBattleCore, tanNguyetBattleSetup, tanNguyetChallengeBlock, TAN_NGUYET_SYMBOL } =
  await import("../DoubleEventBattle");
const { MA_MOC_BLOCKED_ITEM_KEYS, MA_MOC_TEXT } = await import("./TanNguyetLongMa");

const data = new GameData(await Pack.load());
const rules = await loadBattleRules(data);
const services = await BattleServices.load(data, rules, await PetStatCalculator.load(data));
const golden = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../../public/pack/double-battle/golden-double-battle.json"),
    "utf8",
  ),
) as {
  scenarios: {
    name: string;
    units: {
      enemy: {
        physicalTraitId: number;
        base: { hp: number; attack: number; defense: number; speed: number };
        hp: number;
        skillIds: number[];
        skillPp: number[];
      }[];
    };
  }[];
};

/** A level-100 six with a Quỷ pet (Minh vương Long, 87) in the second seat. */
function party(level = 100) {
  return [15, 87, 75, 47, 99, 63].map((speciesId, index) => {
    const skillIds = services.progression.initialSkills(speciesId, level);
    return {
      speciesId,
      level,
      quality: 5,
      nature: 2 + (index % 4),
      currentHp: services.petStats.coreStats(speciesId, level, 5, 2 + (index % 4)).hp,
      skillIds,
      skillPp: services.progression.fullPp(skillIds),
      physicalTraitId: 0,
    };
  });
}

type Core = ReturnType<typeof newDoubleBattleCore>;

function bossFight(level = 100, enemyTrait?: number): Core {
  const setup = tanNguyetBattleSetup(services, party(level) as never);
  const core = newDoubleBattleCore(
    services,
    enemyTrait === undefined
      ? setup
      : { ...setup, enemy: setup.enemy.map((pet) => ({ ...pet, physicalTraitId: enemyTrait })) },
    TAN_NGUYET_SYMBOL,
    7,
  );
  core.start();
  return core;
}

/** Plays the open request: both player slots strike `target` with their first skill. */
function playRound(core: Core, target: 0 | 1): void {
  for (let guard = 0; guard < 20; guard++) {
    const request = core.request;
    if (request.kind === "ended") return;
    if (request.kind === "replacement") {
      let member = -1;
      for (let index = 0; index < core.playerCount && member < 0; index++) {
        const unit = core.playerUnit(index);
        const seated = [2, 3].some(
          (slot) =>
            core.occupant(slot as 2 | 3).side === "player" &&
            core.occupant(slot as 2 | 3).index === index,
        );
        if (unit.alive() && !seated) member = index;
      }
      core.submit({ kind: "member", member });
      continue;
    }
    const slot = request.slot,
      round = request.round,
      unit = core.unit(slot);
    const index = unit.skillIds.findIndex(
      (id, at) =>
        id >= 0 && unit.skillPp[at] > 0 && (rules.damage.skillRow(id)?.powerPercent ?? 0) > 0,
    );
    const targets = core.legalTargets(slot, unit.skillIds[index]);
    core.submit({
      kind: "skill",
      skillIndex: index,
      target: targets.includes(target) ? target : targets[0],
    });
    if (core.request.kind !== "command" || core.request.round !== round) {
      if (core.request.kind === "command") return;
    }
  }
}

describe("Tàn Nguyệt Long Ma — TanNguyetLongMaBattleMechanics in the 2v2 core", () => {
  it("keeps both Hoa Tien Tu and Long Ma at full PP after actions and PP wipes", () => {
    const core = bossFight();
    for (const slot of [0, 1] as const) core.unit(slot).skillPp.fill(0);
    const playerPp = [...core.unit(2).skillPp];
    playRound(core, 1);
    for (const slot of [0, 1] as const) {
      const unit = core.unit(slot);
      expect(core.events.some((event) => event.type === "strike" && event.slot === slot)).toBe(
        true,
      );
      expect([...unit.skillPp]).toEqual(
        unit.skillIds.map((id) => (id < 0 ? 0 : rules.damage.skillRow(id)!.ppMax)),
      );
    }
    expect(core.unit(2).skillPp.some((pp, slot) => pp < playerPp[slot])).toBe(true);
    expect(core.events.some((event) => event.type === "ppExhausted")).toBe(false);
  });

  it("refills PP for the same species outside the boss encounter too: every 2v2 foe is an NPC", () => {
    const setup = tanNguyetBattleSetup(services, party() as never);
    const core = newDoubleBattleCore(
      services,
      {
        ...setup,
        boss: undefined,
        enemyProfile: { ...setup.enemyProfile, itemBudget: 0 },
      },
      TAN_NGUYET_SYMBOL,
      7,
    );
    core.start();
    for (const slot of [0, 1] as const) core.unit(slot).skillPp.fill(0);
    playRound(core, 1);
    for (const slot of [0, 1] as const) {
      const unit = core.unit(slot);
      expect([...unit.skillPp]).toEqual(
        unit.skillIds.map((id) => (id < 0 ? 0 : rules.damage.skillRow(id)!.ppMax)),
      );
      expect(core.events.some((event) => event.type === "strike" && event.slot === slot)).toBe(
        true,
      );
    }
  });

  it("enters Hoa Tiên Tử and the boss exactly as Java's configureEncounterUnit leaves them", () => {
    const java = golden.scenarios.find((scenario) => scenario.name === "tan-nguyet-100")!;
    const core = bossFight(100, java.units.enemy[0].physicalTraitId);
    for (const slot of [0, 1] as const) {
      const unit = core.unit(slot),
        want = java.units.enemy[slot];
      expect(
        {
          base: { ...unit.baseStats, hp: unit.maxHp() },
          hp: unit.hp(),
          skillIds: [...unit.skillIds],
          skillPp: [...unit.skillPp],
        },
        `slot ${slot}`,
      ).toEqual({
        base: want.base,
        hp: want.hp,
        skillIds: want.skillIds,
        skillPp: want.skillPp,
      });
    }
  });

  it("opens with Hoa's Đằng Chi Bích Lũy on the boss and the boss piercing the Quỷ pet", () => {
    const core = bossFight();
    playRound(core, 1);
    const strikes = core.events.flatMap((event) =>
      event.type === "strike" && event.slot < 2 && !event.secondary
        ? [[event.slot, event.skillId, event.target]]
        : [],
    );
    expect(strikes).toContainEqual([0, 14, 1]);
    // Minh vương Long sits in slot 3 (the second roster pet).
    expect(strikes).toContainEqual([1, 109, 3]);
  });

  it("Hoa Tiên Tử pays 30% HP and its speed to raise the boss once, and recovers after two actions", () => {
    const core = bossFight();
    const boss = core.unit(1),
      hoa = core.unit(0);
    boss.setHp(1);
    // Only slot 2 hits hard enough to matter; slot 3 tickles.
    core.unit(3).baseStats.attack = 1;
    core.unit(3).currentStats.attack = 1;
    const hoaBefore = hoa.hp();
    playRound(core, 1);
    const revive = core.events.find((event) => event.type === "bossRevive");
    expect(revive).toBeDefined();
    if (revive?.type !== "bossRevive") return;
    expect(revive.hp).toBe(2999);
    expect(revive.hoaSlot).toBe(0);
    expect(revive.hoaCost).toBeGreaterThan(0);
    expect(revive.hoaCost).toBeLessThanOrEqual(Math.max(1, Math.trunc(hoaBefore * 0.3)));
    expect(hoa.baseStats.speed).toBe(36);
    // No second rise: the boss falls for good the next time.
    boss.setHp(1);
    for (
      let round = 0;
      round < 3 && core.request.kind !== "ended" && hoa.baseStats.speed !== 46;
      round++
    )
      playRound(core, 0);
    expect(core.events.filter((event) => event.type === "bossRevive")).toHaveLength(1);
    if (hoa.alive()) expect(hoa.baseStats.speed).toBe(46);
  });

  it("Hoa's fall turns the boss Cuồng Nộ; it then rises alone, and its second fall wins", () => {
    const core = bossFight();
    const boss = core.unit(1),
      hoa = core.unit(0);
    hoa.setHp(0);
    boss.setHp(1);
    for (let round = 0; round < 6 && core.request.kind !== "ended"; round++) {
      playRound(core, 1);
      if (core.events.some((event) => event.type === "bossRevive") && boss.alive()) boss.setHp(1);
    }
    const enrage = core.events.find((event) => event.type === "bossEnrage");
    expect(enrage).toBeDefined();
    // 712 × 130% and 355 × 85%, on the base.
    expect(boss.baseStats.attack).toBe(925);
    expect(boss.baseStats.defense).toBe(301);
    const revive = core.events.find((event) => event.type === "bossRevive");
    expect(revive?.type === "bossRevive" && revive.hoaSlot).toBe(-1);
    expect(revive?.type === "bossRevive" && revive.hoaCost).toBe(0);
    expect(core.request.kind).toBe("ended");
    if (core.request.kind === "ended") expect(core.request.outcome.winner).toBe("player");
  });

  it("drains 15% while both stand and shares 30% of it with Hoa once a round", () => {
    const core = bossFight();
    // `applyLifeSteal` reports only HP actually gained: a boss at full HP drains nothing, so it
    // starts wounded while both players strike Hoa.
    core.unit(1).setHp(3000);
    for (let round = 0; round < 2 && core.request.kind !== "ended"; round++) playRound(core, 0);
    const steals = core.events.filter((event) => event.type === "lifeSteal");
    expect(steals.length).toBeGreaterThan(0);
    const rounds = new Map<number, number>();
    let round = 0;
    for (const event of core.events) {
      if (event.type === "roundStart") round = event.round;
      if (event.type === "lifeSteal" && event.shared > 0)
        rounds.set(round, (rounds.get(round) ?? 0) + 1);
    }
    for (const count of rounds.values()) expect(count).toBe(1);
  });

  it("seals the three Ma Mộc items at the command", () => {
    const sealed = [] as number[];
    for (let id = 0; id < 400; id++)
      if (MA_MOC_BLOCKED_ITEM_KEYS.includes(services.rulebook.bagItemKey(id))) sealed.push(id);
    expect(sealed).toHaveLength(3);
    const core = bossFight();
    for (const itemId of sealed)
      expect(() => core.submit({ kind: "item", itemId, member: 0 })).toThrow(
        MA_MOC_TEXT.sealedItem,
      );
  });

  it("refuses the challenge below six pets or below level 50", () => {
    expect(tanNguyetChallengeBlock(party(50).slice(0, 5) as never)).toBe(
      "Cần đủ 6 sủng vật trong đội hình để khiêu chiến Tàn Nguyệt Long Ma. Hiện có: 5/6.",
    );
    const low = party(50);
    low[2] = { ...low[2], level: 49 };
    low[4] = { ...low[4], level: 12 };
    expect(tanNguyetChallengeBlock(low as never)).toBe(
      "Cả 6 sủng vật phải đạt cấp 50 mới có thể khiêu chiến Tàn Nguyệt Long Ma. Chưa đạt: 2 pet.",
    );
    expect(tanNguyetChallengeBlock(party(50) as never)).toBeNull();
  });
});
