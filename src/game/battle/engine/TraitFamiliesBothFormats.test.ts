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
const { BattleServices } = await import("./BattleServices");
const { BattleCore } = await import("./BattleCore");
const { DoubleBattleCore } = await import("./DoubleBattleCore");
const { BasicEnemyAi } = await import("./EnemyController");
type CombatantSetup = import("./BattleTypes").CombatantSetup;
type BattleSetup = import("./BattleTypes").BattleSetup;
type BattleEvent = import("./BattleTypes").BattleEvent;
type DoubleEvent = import("./DoubleBattleTypes").DoubleEvent;
type DoubleSlot = 0 | 1 | 2 | 3;

const data = new GameData(await Pack.load());
const rules = await loadBattleRules(data);
const services = await BattleServices.load(data, rules, await PetStatCalculator.load(data));
const species = (await data.species()).rows;
const companionProfile = await data.aiProfileForTier("COMPANION");
const trainerProfile = await data.aiProfileForTier("TRAINER");
const skillRules = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../../public/pack/double-battle/skill-scopes.json"),
    "utf8",
  ),
);

/** Every status and effect roll passes, nothing crits, every blow lands, the player wins ties. */
class Sure extends BattleRandom {
  override percent(label: string): number {
    return /crit|jitter|hitroll/.test(label) ? 99 : 0;
  }
}

/** The species' characteristic switched off for `run`, so the same fight can be read without it. */
const traitCatalog = (rules.traits as unknown as { catalog: { bySpecies(id: number): unknown } })
  .catalog;
function withoutTrait<T>(speciesId: number, run: () => T): T {
  const original = traitCatalog.bySpecies;
  traitCatalog.bySpecies = (id: number) =>
    id === speciesId ? undefined : original.call(traitCatalog, id);
  try {
    return run();
  } finally {
    traitCatalog.bySpecies = original;
  }
}

const pet = (
  id: number,
  skillIds: number[],
  extra: Partial<CombatantSetup> = {},
): CombatantSetup => {
  const base = services.encounterPet(id, 50, 2);
  return { ...base, skillIds, ...extra };
};
/** A foe that acts first and barely scratches. */
const foe = (id: number, skillIds: number[]) => {
  const base = services.encounterPet(id, 50, 2);
  return pet(id, skillIds, { stats: { ...base.stats, attack: 1, speed: 999 } });
};
const hpAt = (id: number, percent: number) =>
  Math.trunc((services.encounterPet(id, 50, 2).stats.hp * percent) / 100);

/** A 1v1 where the player casts `slots[round]` each round. */
function duel(player: CombatantSetup[], enemy: CombatantSetup[], slots: number[]): BattleEvent[] {
  const core = new BattleCore(
    rules,
    { items: services.items, relationClass: (id: number) => species[id]?.relationClass ?? 0 },
    { format: "1v1", kind: "trainer", player, enemy },
    new Sure(),
    new BasicEnemyAi(rules),
  );
  core.start();
  for (const slot of slots)
    if (core.request.kind === "command") core.submit({ kind: "skill", slot });
  return [...core.events];
}

/** A 2v2 the player commands both slots of: `rounds[i]` is [slot 2's order, slot 3's order]. */
function double(
  player: CombatantSetup[],
  enemy: CombatantSetup[],
  rounds: ((core: InstanceType<typeof DoubleBattleCore>) => [number, DoubleSlot][])[],
): DoubleEvent[] {
  const core = new DoubleBattleCore(
    rules,
    { items: services.items, skillRules, rulebook: services.rulebook, catalog: services.catalog },
    {
      controlsBoth: true,
      player,
      companion: [],
      enemy,
      enemyProfile: trainerProfile,
      companionProfile,
    },
    new Sure(),
  );
  core.start();
  for (const round of rounds) {
    const orders = round(core);
    for (const [skillIndex, target] of orders)
      if (core.request.kind === "command") core.submit({ kind: "skill", skillIndex, target });
  }
  return [...core.events];
}

const skillEvent = (events: BattleEvent[], skillId: number) =>
  events.find(
    (e): e is Extract<BattleEvent, { type: "skill" }> =>
      e.type === "skill" && e.skillId === skillId,
  )!;
const strikeEvent = (events: DoubleEvent[], skillId: number) =>
  events.find(
    (e): e is Extract<DoubleEvent, { type: "strike" }> =>
      e.type === "strike" && e.skillId === skillId,
  )!;

describe("characteristics fire in the 1v1 and the 2v2 alike", () => {
  it("charm_heal_charge (Cá Đèn Lồng): a heal after a landed Mị Hoặc heals 30% more", () => {
    const S = 57;
    const players = () => [pet(S, [90, 97], { hp: hpAt(S, 20) }), pet(68, [40])];
    const enemies = () => [foe(34, [30]), foe(34, [30])];
    const one = () => skillEvent(duel(players(), enemies(), [0, 1]), 97).targetHp;
    const two = () =>
      strikeEvent(
        double(players(), enemies(), [
          () => [
            [0, 0],
            [0, 0],
          ],
          () => [
            [1, 2],
            [0, 0],
          ],
        ]),
        97,
      ).receiverHp;
    const bonus = hpAt(S, 30);
    expect(one() - withoutTrait(S, one)).toBe(bonus);
    expect(two() - withoutTrait(S, two)).toBe(bonus);
  });

  it("successful_cleanse_heal (Độc Giác Kim Ngư): a cleanse that removed a debuff heals 30%", () => {
    const S = 62;
    const players = () => [pet(S, [1063], { hp: hpAt(S, 20) }), pet(68, [40])];
    const enemies = () => [foe(34, [12]), foe(34, [12])];
    const one = () => skillEvent(duel(players(), enemies(), [0]), 1063).targetHp;
    // Both foes are faster, so the Quấn Quanh is on before the cleanse in the same round.
    const two = () =>
      strikeEvent(
        double(players(), enemies(), [
          () => [
            [0, 2],
            [0, 0],
          ],
        ]),
        1063,
      ).receiverHp;
    const bonus = hpAt(S, 30);
    expect(one() - withoutTrait(S, one)).toBe(bonus);
    expect(two() - withoutTrait(S, two)).toBe(bonus);
  });

  it("fire_hit_recovery (Long bảo bối): a fire blow taken heals 20%", () => {
    const S = 6;
    const players = () => [pet(S, [20], { hp: hpAt(S, 50) }), pet(S, [20], { hp: hpAt(S, 50) })];
    const enemies = () => [foe(34, [0]), foe(34, [0])];
    const one = () => skillEvent(duel(players(), enemies(), [0]), 0).targetHp;
    const two = () =>
      strikeEvent(
        double(players(), enemies(), [
          () => [
            [0, 0],
            [0, 0],
          ],
        ]),
        0,
      ).receiverHp;
    const bonus = hpAt(S, 20);
    expect(one() - withoutTrait(S, one)).toBe(bonus);
    expect(two() - withoutTrait(S, two)).toBe(bonus);
  });
});

const charmsMod = await import("../../charm/RainbowCharms");
const charmBattle = await import("../../charm/RainbowCharmBattle");
const charmCatalog = new charmsMod.RainbowCharmCatalog(
  await new GameData(await Pack.load()).pack.json<
    import("../../charm/RainbowCharms").RainbowCharmsDocument
  >("story.rainbow-charms"),
);
const charm = (id: number) =>
  new charmBattle.RainbowCharmBattleState(
    charmCatalog,
    [{ charm: charmCatalog.byRuntimeId(id)!, tier: 5 }],
    0,
  );

/** One 1v1 and one 2v2 run with `extra` on the setup, the core handed back after the opening rounds. */
function duelCore(player: CombatantSetup[], enemy: CombatantSetup[], slots: number[], extra = {}) {
  const core = new BattleCore(
    rules,
    { items: services.items, relationClass: (id: number) => species[id]?.relationClass ?? 0 },
    { format: "1v1", kind: "trainer", player, enemy, ...extra },
    new Sure(),
    new BasicEnemyAi(rules),
  );
  core.start();
  for (const slot of slots)
    if (core.request.kind === "command") core.submit({ kind: "skill", slot });
  return core;
}
function doubleCore(
  player: CombatantSetup[],
  enemy: CombatantSetup[],
  rounds: [number, DoubleSlot][][],
  extra = {},
) {
  const core = new DoubleBattleCore(
    rules,
    { items: services.items, skillRules, rulebook: services.rulebook, catalog: services.catalog },
    {
      controlsBoth: true,
      player,
      companion: [],
      enemy,
      enemyProfile: trainerProfile,
      companionProfile,
      ...extra,
    },
    new Sure(),
  );
  core.start();
  for (const orders of rounds)
    for (const [skillIndex, target] of orders)
      if (core.request.kind === "command") core.submit({ kind: "skill", skillIndex, target });
  return core;
}

/** Foes that act last, barely scratch and cannot be knocked out in a few rounds. */
const wall = () => {
  const base = services.encounterPet(34, 50, 2);
  const unit = pet(34, [30], { stats: { ...base.stats, attack: 1, hp: 99999 }, hp: 99999 });
  return [unit, { ...unit }];
};
const fast = (id: number, skillIds: number[]) =>
  pet(id, skillIds, { stats: { ...services.encounterPet(id, 50, 2).stats, speed: 999 } });
type WithStatuses = {
  statuses: { get(bank: number, id: number): { remainingTurns: number } | undefined };
};

describe("team charms fire in the 1v1 and the 2v2 alike", () => {
  it("Nọc độc công kích: a Thực Vật pet's Hủ Thực bites harder", () => {
    const tv = () => [fast(19, [70]), fast(20, [70])];
    const one = (extra: object) => duelCore(tv(), wall(), [0, 0], extra).activeUnit("enemy").hp();
    const two = (extra: object) =>
      doubleCore(
        tv(),
        wall(),
        [
          [
            [0, 0],
            [0, 1],
          ],
          [
            [0, 0],
            [0, 1],
          ],
        ],
        extra,
      )
        .unit(0)
        .hp();
    expect(one({ charms: { player: charm(5040) } })).toBeLessThan(one({}));
    expect(two({ charms: { player: charm(5040) } })).toBeLessThan(two({}));
  });

  it("Răng nanh răng nhọn: a Mãnh Thú pet's Tê Liệt lasts two rounds longer (tier V)", () => {
    const mt = () => [fast(2, [41]), fast(3, [41])];
    const turns = (unit: WithStatuses) => unit.statuses.get(1, 10)?.remainingTurns;
    const one = (extra: object) =>
      turns(duelCore(mt(), wall(), [0], extra).activeUnit("enemy") as unknown as WithStatuses);
    const two = (extra: object) =>
      turns(
        doubleCore(
          mt(),
          wall(),
          [
            [
              [0, 0],
              [0, 1],
            ],
          ],
          extra,
        ).unit(0) as unknown as WithStatuses,
      );
    expect([one({}), one({ charms: { player: charm(5041) } })]).toEqual([1, 3]);
    expect([two({}), two({ charms: { player: charm(5041) } })]).toEqual([1, 3]);
  });
});

/** `Sure`, with a few labels answering their own number. */
class Rolls extends Sure {
  constructor(private readonly overrides: [RegExp, number][]) {
    super();
  }
  override percent(label: string): number {
    for (const [pattern, value] of this.overrides) if (pattern.test(label)) return value;
    return super.percent(label);
  }
}
type Double = InstanceType<typeof DoubleBattleCore>;
function doubleWith(
  player: CombatantSetup[],
  enemy: CombatantSetup[],
  rounds: [number, DoubleSlot][][],
  random: InstanceType<typeof BattleRandom> = new Sure(),
  enemyProfile = trainerProfile,
): Double {
  const core = new DoubleBattleCore(
    rules,
    { items: services.items, skillRules, rulebook: services.rulebook, catalog: services.catalog },
    {
      controlsBoth: true,
      player,
      companion: [],
      enemy,
      enemyProfile,
      companionProfile,
    },
    random,
  );
  core.start();
  for (const orders of rounds)
    for (const [skillIndex, target] of orders)
      if (core.request.kind === "command") core.submit({ kind: "skill", skillIndex, target });
  return core;
}
const strikesBy = (core: Double, slot: DoubleSlot) =>
  core.events.filter(
    (e): e is Extract<DoubleEvent, { type: "strike" }> => e.type === "strike" && e.slot === slot,
  );

describe("held items in a 2v2, on Cầu Vồng pets", () => {
  /** Cầu Vồng pets 210 and 222, the item on slot 2's. */
  const team = (held: number, extra: Partial<CombatantSetup> = {}) => [
    pet(210, [services.encounterPet(210, 50, 2).skillIds[0]], { heldItemId: held, ...extra }),
    pet(222, [services.encounterPet(222, 50, 2).skillIds[0]]),
  ];
  const hit = (
    held: number,
    extra: Partial<CombatantSetup> = {},
    random?: InstanceType<typeof BattleRandom>,
  ) =>
    strikesBy(
      doubleWith(
        team(held, extra),
        wall(),
        [
          [
            [0, 0],
            [0, 1],
          ],
        ],
        random,
      ),
      2,
    )[0];

  it("Hồng Sắc Hải Loa hits harder; Mạn Đà La Thạch only under its HP line", () => {
    expect(hit(1).damage).toBeGreaterThan(hit(-1).damage);
    expect(hit(0).damage).toBe(hit(-1).damage);
    const low = { hp: 40 };
    expect(hit(0, low).damage).toBeGreaterThan(hit(-1, low).damage);
  });

  it("Quy Xác Toái Phiến takes less from the same blows", () => {
    const strong = () => {
      const base = services.encounterPet(34, 50, 2);
      const unit = pet(34, [30], { stats: { ...base.stats, speed: 999 } });
      return [unit, { ...unit }];
    };
    const taken = (held: number) => {
      const core = doubleWith(team(held), strong(), [
        [
          [0, 0],
          [0, 1],
        ],
      ]);
      return core.events
        .filter(
          (e): e is Extract<DoubleEvent, { type: "strike" }> =>
            e.type === "strike" && e.receiver === 2,
        )
        .reduce((sum, e) => sum + e.damage, 0);
    };
    expect(taken(-1)).toBeGreaterThan(0);
    expect(taken(2)).toBeLessThan(taken(-1));
  });

  it("Viễn Cổ Long Cốt lifts the crit chance", () => {
    const roll = () => new Rolls([[/crit/, 12]]);
    expect(hit(-1, {}, roll()).crit).toBe(false);
    expect(hit(4, {}, roll()).crit).toBe(true);
  });

  it("Linh Trùng Thi Hài moves before faster foes", () => {
    const quickFoes = () => {
      const base = services.encounterPet(34, 50, 2);
      const unit = pet(34, [30], {
        stats: { ...base.stats, attack: 1, hp: 99999, speed: 999 },
        hp: 99999,
      });
      return [unit, { ...unit }];
    };
    const order = (held: number) =>
      doubleWith(team(held), quickFoes(), [
        [
          [0, 0],
          [0, 1],
        ],
      ])
        .events.filter((e): e is Extract<DoubleEvent, { type: "strike" }> => e.type === "strike")
        .map((e) => e.slot);
    expect(order(-1).indexOf(2)).toBeGreaterThan(0);
    expect(order(7)[0]).toBe(2);
  });

  it("Hấp Huyết Đằng Mạn heals off the damage dealt", () => {
    const hurt = { hp: 100 };
    const roll = () => new Rolls([[/leechGate/, 1]]);
    expect(hit(8, hurt, roll()).actorHp).toBeGreaterThan(hit(-1, hurt, roll()).actorHp);
  });

  it("Cá Thờn Bơn never misses a faster foe", () => {
    const quickFoes = () => {
      const base = services.encounterPet(34, 50, 2);
      const unit = pet(34, [30], {
        stats: { ...base.stats, attack: 1, hp: 99999, speed: 999 },
        hp: 99999,
      });
      return [unit, { ...unit }];
    };
    const roll = () => new Rolls([[/hitroll/, 0]]);
    const first = (held: number) =>
      strikesBy(
        doubleWith(
          team(held),
          quickFoes(),
          [
            [
              [0, 0],
              [0, 1],
            ],
          ],
          roll(),
        ),
        2,
      )[0];
    expect(first(-1).hit).toBe(false);
    expect(first(9).hit).toBe(true);
  });

  it("Mật Phong Sào adds EXP; Ký Cư Giải Xác pays a benched pet", () => {
    const frail = () => {
      const base = services.encounterPet(34, 50, 2);
      const unit = pet(34, [30], { stats: { ...base.stats, attack: 1, hp: 1 }, hp: 1 });
      return [unit, { ...unit }];
    };
    const strong = { stats: { hp: 900, attack: 900, defense: 60, speed: 999 } };
    const outcome = (lead: number, bench: number) => {
      const core = doubleWith(
        [
          pet(210, [services.encounterPet(210, 50, 2).skillIds[0]], {
            ...strong,
            heldItemId: lead,
          }),
          pet(222, [services.encounterPet(222, 50, 2).skillIds[0]], strong),
          pet(273, [services.encounterPet(273, 50, 2).skillIds[0]], { heldItemId: bench }),
        ],
        frail(),
        [
          [
            [0, 0],
            [0, 1],
          ],
        ],
      );
      expect(core.request.kind).toBe("ended");
      return (core.request as { outcome: { experience: number[]; reserveExperience: number[] } })
        .outcome;
    };
    const base = outcome(-1, -1);
    expect(outcome(5, -1).experience[0]).toBeGreaterThan(base.experience[0]);
    expect(base.reserveExperience[2] ?? 0).toBe(0);
    expect(outcome(-1, 6).reserveExperience[2]).toBeGreaterThan(0);
  });
});

describe("switch_ally_shield (Cương Tán Ma Cô) after its pivot, 1v1 and 2v2", () => {
  const S = 28;
  const team = () => [pet(S, [1029]), pet(68, [40]), pet(26, [20])];
  const shieldOf = (unit: { shieldHp(): number }) => unit.shieldHp();

  it("the pet that comes in carries a 30% shield in place of the pivot's smaller one", () => {
    const one = () => {
      const core = new BattleCore(
        rules,
        { items: services.items, relationClass: (id: number) => species[id]?.relationClass ?? 0 },
        { format: "1v1", kind: "trainer", player: team(), enemy: wall() },
        new Sure(),
        new BasicEnemyAi(rules),
      );
      core.start();
      core.submit({ kind: "skill", slot: 0 });
      expect(core.request.kind).toBe("pivot");
      core.submit({ kind: "member", member: 1 });
      return shieldOf(core.activeUnit("player"));
    };
    const two = () => {
      const core = doubleWith(team(), wall(), [
        [
          [0, 0],
          [0, 1],
        ],
      ]);
      expect(core.request.kind).toBe("replacement");
      core.submit({ kind: "member", member: 2 });
      return shieldOf(core.unit(2));
    };
    // A bigger shield replaces the pivot's smaller one; it does not stack on it.
    const thirty = (id: number, skill: number) =>
      Math.trunc((pet(id, [skill]).stats.hp * 30) / 100);
    expect(one()).toBe(thirty(68, 40));
    expect(withoutTrait(S, one)).toBeLessThan(thirty(68, 40));
    expect(two()).toBe(thirty(26, 20));
    expect(withoutTrait(S, two)).toBeLessThan(thirty(26, 20));
  });
});

describe("fights that used to stop", () => {
  /** A fast foe whose only skill is Hỗn loạn. */
  const confusers = () => {
    const base = services.encounterPet(34, 50, 2);
    const unit = pet(34, [55], { stats: { ...base.stats, attack: 1, speed: 999 } });
    return [unit, { ...unit }];
  };

  it("a confused pet hits itself with a Cầu Vồng skill or a signature instead of throwing", () => {
    for (const skill of [86, 1065]) {
      const core = duelCore([pet(210, [skill]), pet(222, [skill])], confusers(), [0]);
      const self = core.events.find(
        (e): e is Extract<BattleEvent, { type: "skill" }> =>
          e.type === "skill" && e.seat.side === "player" && e.target.side === "player",
      );
      expect(self?.skillId).toBe(skill);
      expect(self!.damage).toBeGreaterThan(0);
      const double = doubleWith([pet(210, [skill]), pet(222, [skill])], confusers(), [
        [
          [0, 0],
          [0, 1],
        ],
      ]);
      expect(
        double.events.some(
          (e) => e.type === "strike" && e.slot === 2 && e.receiver === 2 && e.skillId === skill,
        ),
      ).toBe(true);
    }
  });

  it("a 2v2 pet with every slot dry still takes its turn, which passes on noPp", () => {
    const dry = pet(210, [services.encounterPet(210, 50, 2).skillIds[0]], { skillPp: [0] });
    const core = doubleWith([dry, pet(222, [40])], wall(), [
      [
        [0, 0],
        [0, 1],
      ],
    ]);
    expect(core.events.some((e) => e.type === "noPp" && e.slot === 2)).toBe(true);
    expect(core.request.kind).toBe("command");
  });
});

describe("Thân hòa thiên sứ in a wild 1v1", () => {
  it("a missed ball makes the next one easier", () => {
    const ball = Array.from({ length: 40 }, (_, id) => services.items.get(id)).find(
      (item) => item?.kind === "capture" && !item.guaranteed,
    )!.id;
    const chances = (extra: object) => {
      const core = new BattleCore(
        rules,
        { items: services.items, relationClass: (id: number) => species[id]?.relationClass ?? 0 },
        {
          format: "1v1",
          kind: "wild",
          player: [pet(210, [86])],
          enemy: [wall()[0]],
          inventory: { [ball]: 2 },
          ...extra,
        },
        new Rolls([[/battle\.catch/, 99]]),
        new BasicEnemyAi(rules),
      );
      core.start();
      return [0, 1].map(
        () =>
          core
            .submit({ kind: "catch", itemId: ball })
            .find((e): e is Extract<BattleEvent, { type: "catch" }> => e.type === "catch")!.chance,
      );
    };
    const [first, second] = chances({ charms: { player: charm(5050) } });
    expect(second).toBeGreaterThan(first);
    expect(chances({})).toEqual([first, first]);
  });
});

describe("both teams out of PP: the team that ran dry first loses (web rule)", () => {
  /** A pet that neither side can knock out, with `pp` uses of its one skill. */
  const sturdy = (id: number, pp: number) => {
    const base = services.encounterPet(id, 50, 2);
    return pet(id, [base.skillIds[0]], {
      stats: { ...base.stats, attack: 1, hp: 99999 },
      hp: 99999,
      skillPp: [pp],
    });
  };
  // A wild fight: an NPC's PP never runs out in ProMax, so only here can both teams go dry.
  const duelToEnd = (
    player: CombatantSetup[],
    enemy: CombatantSetup[],
    npc: Partial<BattleSetup> = { kind: "wild" },
  ) => {
    const core = new BattleCore(
      rules,
      { items: services.items, relationClass: (id: number) => species[id]?.relationClass ?? 0 },
      { format: "1v1", kind: "wild", ...npc, player, enemy },
      new Sure(),
      new BasicEnemyAi(rules),
    );
    core.start();
    for (let guard = 0; guard < 50 && core.request.kind === "command"; guard++)
      core.submit({ kind: "skill", slot: 0 });
    return core;
  };
  const doubleToEnd = (player: CombatantSetup[], enemy: CombatantSetup[]) => {
    // No enemy items: with native values its PP potion (item 6) would refill every skill.
    const core = doubleWith(player, enemy, [], new Sure(), { ...trainerProfile, itemBudget: 0 });
    for (let guard = 0; guard < 100 && core.request.kind === "command"; guard++) {
      const slot = core.request.slot,
        targets = core.legalTargets(slot, core.unit(slot).skillIds[0]);
      core.submit({ kind: "skill", skillIndex: 0, target: targets[0] });
    }
    return core;
  };

  it("1v1: the side whose last PP went first loses, whichever side that is", () => {
    const lost = duelToEnd([sturdy(210, 1)], [sturdy(34, 3)]);
    expect(lost.request).toMatchObject({
      kind: "ended",
      outcome: { winner: "enemy", reason: "ppExhausted" },
    });
    expect(lost.events.find((e) => e.type === "ppExhausted")).toEqual({
      type: "ppExhausted",
      side: "player",
    });
    // The foe's dry lead hands over to its reserve (a round spent), which then spends its PP too.
    const won = duelToEnd([sturdy(210, 4)], [sturdy(34, 1), sturdy(26, 1)]);
    expect(won.activeMember("enemy")).toBe(1);
    expect(won.request).toMatchObject({
      kind: "ended",
      outcome: { winner: "player", reason: "ppExhausted" },
    });
  });

  it("a team with PP left keeps fighting, so one dry side alone ends nothing", () => {
    const core = duelToEnd([sturdy(210, 1)], [sturdy(34, 99)]);
    // 50 rounds of the dry player passing while the foe still swings: no early verdict.
    expect(core.events.some((e) => e.type === "ppExhausted")).toBe(false);
  });

  it("1v1 against an NPC: its PP never runs out, so the player loses once dry with no PP item", () => {
    for (const kind of ["trainer", "boss"] as const) {
      // The NPC starts with a single use, yet out-lasting it is no longer a way to win.
      const lost = duelToEnd([sturdy(210, 3)], [sturdy(34, 1)], { kind });
      expect(lost.request, kind).toMatchObject({
        kind: "ended",
        outcome: { winner: "enemy", reason: "ppExhausted" },
      });
      expect(lost.unit("enemy", 0).skillPp[0], kind).toBeGreaterThan(0);
    }
    // A PP potion (item 6) in the bag keeps the dry player in the fight: it can still drink it.
    const waiting = duelToEnd([sturdy(210, 1)], [sturdy(34, 1)], {
      kind: "trainer",
      inventory: { 6: 1 },
    });
    expect(waiting.events.some((e) => e.type === "ppExhausted")).toBe(false);
  });

  it("2v2 (always an NPC): the player's side loses once dry; the NPC never runs out", () => {
    const lost = doubleToEnd([sturdy(210, 1), sturdy(222, 1)], [sturdy(34, 3), sturdy(26, 3)]);
    expect(lost.request).toMatchObject({
      kind: "ended",
      outcome: { winner: "enemy", ppExhausted: true },
    });
    // Before ProMax the NPC's one use each meant the player won on PP; now it cannot.
    const notWon = doubleToEnd([sturdy(210, 3), sturdy(222, 3)], [sturdy(34, 1), sturdy(26, 1)]);
    expect(notWon.request).toMatchObject({
      kind: "ended",
      outcome: { winner: "enemy", ppExhausted: true },
    });
    expect(notWon.events.find((e) => e.type === "ppExhausted")).toEqual({
      type: "ppExhausted",
      side: "player",
    });
  });
});
