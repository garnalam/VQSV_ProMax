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

/** One Liệt Hỏa pet and three Cầu Vồng ones: a held item is the same byte whichever world it is from. */
const SPECIES = [68, 210, 222, 273];
const firstStrike = (core: Core, side: "player" | "enemy") =>
  core
    .submit({ kind: "skill", slot: 0 })
    .find(
      (e): e is Extract<BattleEvent, { type: "skill" }> =>
        e.type === "skill" && e.seat.side === side,
    )!;
const ended = (core: Core) => (core.request as { outcome: { experience: number[] } }).outcome;

describe("held items (Trang sức 0-11) work on Liệt Hỏa and Cầu Vồng pets alike", () => {
  for (const id of SPECIES) {
    it(`species ${id}: Hồng Sắc Hải Loa hits harder, Quy Xác Toái Phiến takes less`, () => {
      const plain = firstStrike(fight({ player: [pet(id)] }), "player").damage,
        strong = firstStrike(fight({ player: [pet(id, { heldItemId: 1 })] }), "player").damage;
      expect(strong).toBeGreaterThan(plain);
      const taken = firstStrike(fight({ player: [pet(id)] }), "enemy").damage,
        guarded = firstStrike(fight({ player: [pet(id, { heldItemId: 2 })] }), "enemy").damage;
      expect(guarded).toBeLessThan(taken);
    });

    it(`species ${id}: Linh Trùng Thi Hài moves before a faster foe in a 1v1`, () => {
      const fast = { stats: { hp: 300, attack: 120, defense: 40, speed: 200 } };
      expect(
        skillOrder(
          fight({ player: [pet(id)], enemy: [pet(34, fast)] }).submit({ kind: "skill", slot: 0 }),
        ),
      ).toEqual(["enemy", "player"]);
      expect(
        skillOrder(
          fight({ player: [pet(id, { heldItemId: 7 })], enemy: [pet(34, fast)] }).submit({
            kind: "skill",
            slot: 0,
          }),
        ),
      ).toEqual(["player", "enemy"]);
    });

    it(`species ${id}: Mật Phong Sào adds EXP; Ký Cư Giải Xác pays the bench in a 1v1`, () => {
      const strong = { stats: { hp: 900, attack: 900, defense: 60, speed: 200 } };
      const run = (lead: Partial<CombatantSetup>, bench: Partial<CombatantSetup>) => {
        const core = fight({ player: [pet(id, { ...strong, ...lead }), pet(id, bench)] });
        slug(core);
        return ended(core).experience;
      };
      const base = run({}, {});
      expect(base[1]).toBe(0);
      expect(run({ heldItemId: 5 }, {})[0]).toBeGreaterThan(base[0]);
      expect(run({}, { heldItemId: 6 })[1]).toBeGreaterThan(0);
    });
  }
});

/** `Fixed`, with a few labels answering their own number. */
class Rolls extends Fixed {
  constructor(private readonly overrides: [RegExp, number][]) {
    super(50);
  }
  override percent(label: string): number {
    for (const [pattern, value] of this.overrides) if (pattern.test(label)) return value;
    return super.percent(label);
  }
}
const playerStrike = (setup: Partial<BattleSetup>, random?: Fixed) =>
  firstStrike(fight(setup, random), "player");
const BALL = Array.from({ length: 40 }, (_, id) => items.get(id)).find(
  (item) => item?.kind === "capture" && !item.guaranteed,
)!.id;

describe("the other held items, Liệt Hỏa and Cầu Vồng alike", () => {
  const quick = { stats: { hp: 300, attack: 120, defense: 40, speed: 200 } };
  for (const id of SPECIES) {
    it(`species ${id}: Mạn Đà La Thạch doubles the strength under its HP line`, () => {
      const low = { hp: 40, ...quick };
      expect(playerStrike({ player: [pet(id, { ...low, heldItemId: 0 })] }).damage).toBeGreaterThan(
        playerStrike({ player: [pet(id, low)] }).damage,
      );
      // Above the line it is nothing.
      expect(playerStrike({ player: [pet(id, { ...quick, heldItemId: 0 })] }).damage).toBe(
        playerStrike({ player: [pet(id, quick)] }).damage,
      );
    });

    it(`species ${id}: Ô Nha Uế takes a fifth off a status aimed at it`, () => {
      const unit = (heldItemId: number) =>
        rules.traits.unit({
          speciesId: id,
          ownerSide: 0,
          formationSlot: 0,
          base: { hp: 300, attack: 120, defense: 40, speed: 50 },
          heldItemId,
        });
      expect(unit(-1).projectIncomingStatusChance(50)).toBe(50);
      expect(unit(3).projectIncomingStatusChance(50)).toBe(40);
    });

    it(`species ${id}: Viễn Cổ Long Cốt lifts the crit chance`, () => {
      const roll = new Rolls([[/crit/, 12]]);
      expect(playerStrike({ player: [pet(id)] }, roll).crit).toBe(false);
      expect(
        playerStrike({ player: [pet(id, { heldItemId: 4 })] }, new Rolls([[/crit/, 12]])).crit,
      ).toBe(true);
    });

    it(`species ${id}: Hấp Huyết Đằng Mạn heals off the damage dealt`, () => {
      const hurt = { hp: 100, ...quick },
        roll = () => new Rolls([[/leechGate/, 1]]);
      expect(playerStrike({ player: [pet(id, hurt)] }, roll()).attackerHp).toBe(100);
      expect(
        playerStrike({ player: [pet(id, { ...hurt, heldItemId: 8 })] }, roll()).attackerHp,
      ).toBeGreaterThan(100);
    });

    it(`species ${id}: Cá Thờn Bơn never misses a faster foe`, () => {
      const setup = (heldItemId: number) => ({
          player: [pet(id, { heldItemId })],
          enemy: [pet(34, quick)],
        }),
        roll = () => new Rolls([[/hitroll/, 0]]);
      expect(firstStrike(fight(setup(-1), roll()), "player").hit).toBe(false);
      expect(firstStrike(fight(setup(9), roll()), "player").hit).toBe(true);
    });

    it(`species ${id}: Cảm Lãm Chi Diệp keeps a wild pet alive to be caught`, () => {
      const heavy = { stats: { hp: 300, attack: 2000, defense: 40, speed: 200 } };
      expect(playerStrike({ player: [pet(id, heavy)] }).targetHp).toBe(0);
      expect(
        playerStrike({ player: [pet(id, { ...heavy, heldItemId: 10 })] }).targetHp,
      ).toBeGreaterThan(0);
      // Not in a trainer fight: there is nothing to catch.
      expect(
        playerStrike({ kind: "trainer", player: [pet(id, { ...heavy, heldItemId: 10 })] }).targetHp,
      ).toBe(0);
    });

    it(`species ${id}: Sủng vật lôi đạt raises the catch chance`, () => {
      const chance = (heldItemId: number) => {
        const core = fight({ player: [pet(id, { heldItemId })], inventory: { [BALL]: 1 } });
        return core
          .submit({ kind: "catch", itemId: BALL })
          .find((e): e is Extract<BattleEvent, { type: "catch" }> => e.type === "catch")!.chance;
      };
      expect(chance(11)).toBeGreaterThan(chance(-1));
    });
  }
});
