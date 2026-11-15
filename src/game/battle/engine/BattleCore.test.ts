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
const { BattleCore } = await import("./BattleCore");
const { BattleItems } = await import("./BattleItems");
const { BasicEnemyAi } = await import("./EnemyController");
const { BattleCommandError } = await import("./BattleTypes");
type BattleSetup = import("./BattleTypes").BattleSetup;
type CombatantSetup = import("./BattleTypes").CombatantSetup;
type BattleEvent = import("./BattleTypes").BattleEvent;
type Core = InstanceType<typeof BattleCore>;

const data = new GameData(await Pack.load());
const rules = await loadBattleRules(data);
const items = new BattleItems(await data.items());
const species = (await data.species()).rows;
const deps = { items, relationClass: (id: number) => species[id]?.relationClass ?? 0 };

/** Every roll answers `value`; crit and jitter stay off and every hit lands. */
class Fixed extends BattleRandom {
  constructor(private readonly value = 0) {
    super();
  }
  override percent(label: string): number {
    return /crit|jitter|hitroll/.test(label) ? 99 : this.value;
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
const fight = (setup: Partial<BattleSetup>, random = new Fixed(50)): Core => {
  const core = new BattleCore(
    rules,
    deps,
    { format: "1v1", kind: "wild", player: [pet(68)], enemy: [pet(34)], ...setup },
    random,
    new BasicEnemyAi(rules),
  );
  core.start();
  return core;
};
/** Keep attacking with slot 0 until the core asks for something else. */
const slug = (core: Core, limit = 60): BattleEvent[] => {
  const all: BattleEvent[] = [];
  for (let i = 0; i < limit && core.request.kind === "command"; i++)
    all.push(...core.submit({ kind: "skill", slot: 0 }));
  return all;
};
const skillOrder = (events: readonly BattleEvent[]) =>
  events.flatMap((e) => (e.type === "skill" ? [e.seat.side] : []));

describe("BattleCore: a whole fight", () => {
  it("resolves a unified signature turned back on its caster by Quỷ Mị", () => {
    const core = fight({
      player: [pet(13, { skillIds: [1021] })],
      enemy: [pet(34)],
    }, new Fixed(0));
    const player = core.activeUnit("player"), enemy = core.activeUnit("enemy");
    rules.status.pendingDebuffFromProducer(enemy, player, 54, 8)!.commit();
    const result = core.submit({ kind: "skill", slot: 0 });
    expect(result).toContainEqual(expect.objectContaining({
      type: "skill", skillId: 1021, seat: { side: "player", member: 0 },
      target: { side: "player", member: 0 }, damage: expect.any(Number),
    }));
    expect(player.hp()).toBeLessThan(player.maxHp());
    expect(enemy.hp()).toBe(enemy.maxHp());
  });

  it("pays living reserves 30 percent with Hoàng Kim, full EXP with item six, and none when fainted", () => {
    const core = fight({
      goldenPartyExperiencePercent: 30,
      player: [
        pet(68, { stats: { hp: 400, attack: 400, defense: 100, speed: 120 } }),
        pet(47),
        pet(47, { heldItemId: 6 }),
        pet(47, { hp: 0 }),
      ],
      enemy: [pet(34, { hp: 1 })],
    });
    slug(core);
    expect(core.request.kind).toBe("ended");
    if (core.request.kind !== "ended") return;
    const exp = core.request.outcome.experience;
    expect(exp[0]).toBeGreaterThan(0);
    expect(exp[1]).toBe(Math.trunc(exp[0] * 30 / 100));
    expect(exp[2]).toBe(exp[0]);
    expect(exp[3]).toBe(0);
  });

  it("seats both sides, then runs rounds until a side is out, and pays the EXP", () => {
    const core = fight({
      player: [pet(68, { stats: { hp: 400, attack: 200, defense: 60, speed: 120 } })],
    });
    expect(core.events.map((e) => e.type)).toEqual(["enter", "enter", "roundStart"]);
    const events = slug(core);
    expect(core.request).toMatchObject({
      kind: "ended",
      outcome: { winner: "player", reason: "knockout" },
    });
    const ended = core.request as { outcome: { experience: number[] } };
    expect(ended.outcome.experience[0]).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "faint" && e.seat.side === "enemy")).toBe(true);
    expect(events.at(-1)?.type).toBe("end");
    expect(() => core.submit({ kind: "skill", slot: 0 })).toThrow(BattleCommandError);
  });

  it("suppresses the whole party's pet traits against Kim Diễm and keeps their skills", () => {
    const player = [pet(68, { physicalTraitId: 2 }), pet(47, { physicalTraitId: 2 })];
    const normal = fight({ kind: "trainer", player });
    expect(rules.traits.enabled(normal.unit("player", 0))).toBe(true);
    expect(normal.unit("player", 1).physicalTraitId).toBe(2);
    const boss = fight({ kind: "trainer", player, enemy: [pet(280)] });
    for (const [member, setup] of player.entries()) {
      const unit = boss.unit("player", member);
      expect(rules.traits.enabled(unit)).toBe(false);
      expect(unit.physicalTraitId).toBe(-1);
      expect(unit.skillIds[0]).toBe(setup.skillIds[0]);
      expect(boss.setupOf("player", member).physicalTraitId).toBe(2);
    }
    expect(boss.submit({ kind: "skill", slot: 0 })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "skill",
          seat: expect.objectContaining({ side: "player" }),
        }),
      ]),
    );
  });

  it("reflects skill debuffs from Kim Diễm back to the living attacker", () => {
    const core = fight({
      kind: "trainer",
      player: [pet(68, { skillIds: [12], stats: { hp: 10_000, attack: 120, defense: 100, speed: 10 } })],
      enemy: [pet(280, { skillIds: [4], stats: { hp: 10_000, attack: 100, defense: 100, speed: 100 } })],
    }, new Fixed(0));
    core.submit({ kind: "skill", slot: 0 });
    expect(core.unit("enemy", 0).statuses.has(1, 2)).toBe(false);
    expect(core.unit("player", 0).statuses.get(1, 2)).toMatchObject({ sourceSide: 1 });
  });

  it("the faster pet strikes first; an equal pair is settled by the fight's roll", () => {
    const fast = fight({
      enemy: [pet(34, { stats: { hp: 300, attack: 120, defense: 40, speed: 90 } })],
    });
    expect(skillOrder(fast.submit({ kind: "skill", slot: 0 }))).toEqual(["enemy", "player"]);
    expect(skillOrder(fight({}, new Fixed(10)).submit({ kind: "skill", slot: 0 }))).toEqual([
      "player",
      "enemy",
    ]);
    expect(skillOrder(fight({}, new Fixed(90)).submit({ kind: "skill", slot: 0 }))).toEqual([
      "enemy",
      "player",
    ]);
  });

  it("Hỏa Tế Đoạt Tiên (HV-01) moves before a faster foe", () => {
    const core = fight({
      player: [pet(274)],
      enemy: [pet(34, { stats: { hp: 300, attack: 120, defense: 40, speed: 90 } })],
    });
    expect(skillOrder(core.submit({ kind: "skill", slot: 0 }))).toEqual(["player", "enemy"]);
  });

  it("switches and items act before any skill", () => {
    const core = fight({
      player: [pet(68), pet(26)],
      enemy: [pet(34, { stats: { hp: 300, attack: 120, defense: 40, speed: 200 } })],
    });
    const events = core.submit({ kind: "switch", member: 1 });
    expect(events.findIndex((e) => e.type === "switch")).toBeLessThan(
      events.findIndex((e) => e.type === "skill"),
    );
    expect(core.activeMember("player")).toBe(1);
  });
});

describe("BattleCore: parties", () => {
  it("a fallen player pet asks for a replacement; the enemy replaces its own and pays per knockout", () => {
    const weak = pet(68, { hp: 1 }),
      core = fight({
        player: [weak, pet(26, { stats: { hp: 900, attack: 400, defense: 60, speed: 10 } })],
        enemy: [pet(34), pet(34)],
      });
    core.submit({ kind: "skill", slot: 0 });
    expect(core.request).toEqual({ kind: "replacement", side: "player" });
    expect(() => core.submit({ kind: "member", member: 0 })).toThrow(BattleCommandError);
    core.submit({ kind: "member", member: 1 });
    expect(core.request.kind).toBe("command");
    const events = slug(core);
    const switches = events.filter((e) => e.type === "switch" && e.side === "enemy");
    expect(switches).toHaveLength(1);
    expect(events.filter((e) => e.type === "experience")).toHaveLength(2);
    expect(core.request).toMatchObject({ kind: "ended", outcome: { winner: "player" } });
  });

  it("a whole party down loses", () => {
    const core = fight({ player: [pet(68, { hp: 1 })] });
    core.submit({ kind: "skill", slot: 0 });
    expect(core.request).toMatchObject({
      kind: "ended",
      outcome: { winner: "enemy", reason: "knockout" },
    });
  });

  it("a PIVOT signature stops the round for the player's switch, then the round goes on", () => {
    const pivot = 1029,
      core = fight({
        player: [
          pet(68, { skillIds: [pivot], stats: { hp: 300, attack: 120, defense: 40, speed: 99 } }),
          pet(26),
        ],
      });
    const first = core.submit({ kind: "skill", slot: 0 });
    expect(core.request).toEqual({ kind: "pivot", side: "player" });
    expect(skillOrder(first)).toEqual(["player"]);
    const rest = core.submit({ kind: "member", member: 1 });
    expect(rest[0]).toMatchObject({ type: "switch", reason: "pivot", to: 1 });
    // The pivot's shield (4% of 300 = 12) went with the switch and soaked the enemy's hit first.
    expect(skillOrder(rest)).toEqual(["enemy"]);
    const hit = rest.find((e) => e.type === "skill" && e.seat.side === "enemy") as {
      damage: number;
    };
    expect(300 - core.unit("player", 1).hp()).toBe(hit.damage - 12);
    expect(core.request.kind).toBe("command");
  });

  it("no reserve: the PIVOT hits and nothing is asked", () => {
    const core = fight({
      player: [
        pet(68, { skillIds: [1029], stats: { hp: 300, attack: 120, defense: 40, speed: 99 } }),
      ],
    });
    core.submit({ kind: "skill", slot: 0 });
    expect(core.request.kind).toBe("command");
    expect(core.activeUnit("player").signatureState.pendingPivot).toBe(false);
  });
});

describe("BattleCore: statuses on the acting pet", () => {
  it("a sleeping pet loses its turn (moving first, before a hit can wake it)", () => {
    const core = fight({
      player: [pet(68, { stats: { hp: 300, attack: 120, defense: 40, speed: 99 } })],
    });
    rules.web!.applyRainbowDebuff(core.activeUnit("player"), 8, { turns: 1 });
    const events = core.submit({ kind: "skill", slot: 0 });
    expect(events.some((e) => e.type === "blocked" && e.seat.side === "player")).toBe(true);
    expect(skillOrder(events)).toEqual(["enemy"]);
  });

  it("a sleeping pet hit first wakes up and takes its turn", () => {
    const core = fight({
      enemy: [pet(34, { stats: { hp: 300, attack: 120, defense: 40, speed: 99 } })],
    });
    rules.web!.applyRainbowDebuff(core.activeUnit("player"), 8, { turns: 1 });
    const events = core.submit({ kind: "skill", slot: 0 });
    expect(events.some((e) => e.type === "blocked")).toBe(false);
    expect(skillOrder(events)).toEqual(["enemy", "player"]);
  });

  it("Gieo Hạt bites at its owner's turn start", () => {
    const core = fight({});
    rules.status
      .pendingDebuffFromProducer(core.activeUnit("enemy"), core.activeUnit("player"), 1, 0)!
      .commit();
    const events = core.submit({ kind: "skill", slot: 0 });
    expect(events.find((e) => e.type === "statusTick")).toMatchObject({ seat: { side: "player" } });
  });

  it("Giam Cầm refuses a switch and an item, and leaves skills alone", () => {
    const core = fight({ player: [pet(68), pet(26)], inventory: { 5: 1 } });
    rules.web!.applyRainbowDebuff(core.activeUnit("player"), 4, { turns: 2 });
    expect(() => core.submit({ kind: "switch", member: 1 })).toThrow(/Giam Cầm/);
    expect(() => core.submit({ kind: "item", itemId: 5 })).toThrow(/Giam Cầm/);
    expect(() => core.submit({ kind: "skill", slot: 0 })).not.toThrow();
  });
});

describe("BattleCore: the bag, the ball and the exit", () => {
  it("Chocolate fills HP; a full pet refuses it; the bag counts down", () => {
    const core = fight({ player: [pet(68, { hp: 100 })], inventory: { 5: 2 } });
    const events = core.submit({ kind: "item", itemId: 5 });
    expect(events.find((e) => e.type === "item")).toMatchObject({ hpGained: 200 });
    expect(core.bag()[5]).toBe(1);
    core.activeUnit("player").setHp(300);
    expect(() => core.submit({ kind: "item", itemId: 5 })).toThrow(/HP đã đầy/);
  });

  it("Linh Hồn Thạch revives a fallen reserve with full HP and PP", () => {
    const core = fight({
      player: [pet(68), pet(26, { hp: 0, skillPp: [0] })],
      inventory: { 12: 1 },
    });
    core.submit({ kind: "item", itemId: 12, member: 1 });
    const back = core.unit("player", 1);
    expect([back.hp(), back.skillPp[0]]).toEqual([
      300,
      rules.damage.skillRow(back.skillIds[0])!.ppMax,
    ]);
  });

  it("Tất Trung Cầu always catches a wild pet; a trainer's pet cannot be caught or fled", () => {
    const core = fight({ inventory: { 0: 1 } });
    core.submit({ kind: "catch", itemId: 0 });
    expect(core.request).toMatchObject({ kind: "ended", outcome: { reason: "catch", caught: 0 } });
    const trainer = fight({ kind: "trainer", inventory: { 0: 1 } });
    expect(() => trainer.submit({ kind: "catch", itemId: 0 })).toThrow(BattleCommandError);
    expect(() => trainer.submit({ kind: "run" })).toThrow(BattleCommandError);
  });

  it("running from a wild pet ends the fight with no winner", () => {
    const core = fight({});
    const events = core.submit({ kind: "run" });
    expect(events.map((event) => event.type).slice(-2)).toEqual(["run", "end"]);
    expect(core.request).toMatchObject({
      kind: "ended",
      outcome: { winner: "none", reason: "run" },
    });
  });
});

describe("BattleCore: the enemy controller", () => {
  it("picks its strongest usable skill and never an empty or dry slot", () => {
    const core = fight({ enemy: [pet(34, { skillIds: [30, 36, -1], skillPp: [5, 0] })] });
    const events = core.submit({ kind: "skill", slot: 0 });
    const enemySkill = events.find((e) => e.type === "skill" && e.seat.side === "enemy");
    // 36 (Power 155) has no PP left: 30 is the one it can use.
    expect(enemySkill).toMatchObject({ skillId: 30 });
  });
});
