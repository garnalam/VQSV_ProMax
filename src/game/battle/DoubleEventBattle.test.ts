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
const { doubleBattleSetup, newDoubleBattleCore, tanNguyetBattleSetup, TAN_NGUYET_SYMBOL } =
  await import("./DoubleEventBattle");

type GoldenUnit = {
  speciesId: number;
  level: number;
  nature: number;
  quality: number;
  hp: number;
  skillIds: number[];
};
type GoldenScenario = {
  name: string;
  symbol: string;
  controlsBoth: boolean;
  units: { enemy: GoldenUnit[]; player: GoldenUnit[]; companion: GoldenUnit[] };
};

const golden = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../public/pack/double-battle/golden-double-battle.json"),
    "utf8",
  ),
) as { scenarios: GoldenScenario[] };
const data = new GameData(await Pack.load());
const rules = await loadBattleRules(data, { traitScripts: false }); // golden: đặc tính cũ, không kit
const services = await BattleServices.load(data, rules, await PetStatCalculator.load(data));

const identity = (unit: GoldenUnit) => ({
  speciesId: unit.speciesId,
  level: unit.level,
  nature: unit.nature,
  quality: unit.quality,
  skillIds: unit.skillIds.filter((id) => id >= 0),
});

describe("doubleBattleSetup — the rosters VqsvDoubleBattleRuntime.enter seats", () => {
  for (const scenario of golden.scenarios)
    it(`${scenario.name}: enemies with their authored decks, and the lent companions`, () => {
      const party = scenario.units.player.map((unit) => ({
          speciesId: unit.speciesId,
          level: unit.level,
          quality: unit.quality,
          nature: unit.nature,
          currentHp: unit.hp,
          skillIds: unit.skillIds.filter((id) => id >= 0),
        })),
        setup =
          scenario.symbol === TAN_NGUYET_SYMBOL
            ? tanNguyetBattleSetup(services, party as never)
            : doubleBattleSetup(services, scenario.symbol, party as never);
      expect(setup.controlsBoth).toBe(scenario.controlsBoth);
      expect(setup.enemy.map((pet) => identity(pet as never))).toEqual(
        scenario.units.enemy.map(identity),
      );
      expect(setup.companion.map((pet) => identity(pet as never))).toEqual(
        scenario.units.companion.map(identity),
      );
      const core = newDoubleBattleCore(services, setup, scenario.symbol, 7);
      core.start();
      expect(core.request.kind).toBe("command");
    });
});

describe("PetProgression.initialSkills — UnifiedSkillLearnsetCatalog.initialSkillIds", () => {
  it("deals from the pet-design pool when the catalog lists the pet", () => {
    // Java: [10, 12] for Harry's lent LH-016 at level 7; the full learnset would add CV-SKILL-20.
    expect(services.progression.initialSkills(16, 7)).toEqual([10, 12]);
    // LH-000 at 20 keeps pool order (80 before 6), not unlock order.
    expect(services.progression.initialSkills(0, 20)).toEqual([0, 1, 5, 80, 6]);
  });
});

describe("DoubleBattleRuntime entry — VqsvDoubleBattleRuntime.tickEntry", () => {
  it("slides the four slots in on Java's frames (applied, then advanced)", async () => {
    const { createDoubleBattle } = await import("./DoubleEventBattle");
    const battle = createDoubleBattle(
      services,
      "SCENE9_ROOM0_GROUP1_LARRY",
      [
        { speciesId: 68, level: 32, quality: 2, nature: 2 },
        { speciesId: 58, level: 30, quality: 2, nature: 3 },
        { speciesId: 95, level: 28, quality: 1, nature: 5 },
      ] as never,
      {},
      [],
      () => 8,
      undefined,
      7,
    );
    const at = () =>
      ([0, 1, 2, 3] as const).map((slot) => {
        const view = battle.slot(slot);
        return [view.actorX, view.actorY, view.markerX, view.markerY];
      });
    // Recorded from JavaSE (actorX/actorY/markerX/markerY after each tick).
    const java: Record<number, number[][]> = {
      1: [
        [400, 17, 240, 48],
        [400, 77, 240, 76],
        [-80, 123, -70, 196],
        [-80, 103, -70, 182],
      ],
      14: [
        [121, 63, 88, 46],
        [195, 100, 163, 83],
        [-80, 123, -70, 196],
        [-80, 103, -70, 182],
      ],
      15: [
        [121, 63, 88, 46],
        [195, 100, 163, 83],
        [47, 141, 17, 188],
        [-80, 103, -70, 182],
      ],
      20: [
        [121, 63, 88, 46],
        [195, 100, 163, 83],
        [122, 216, 89, 189],
        [36, 155, 2, 161],
      ],
    };
    for (let tick = 1; tick <= 20; tick++) {
      battle.tick();
      if (java[tick]) expect(at(), `tick ${tick}`).toEqual(java[tick]);
    }
  });
});

describe("DoubleBattleRuntime actions — VqsvDoubleBattleRuntime.tickAction", () => {
  it("plays the first rounds tick for tick like JavaSE: effects, poses, hit and fall", async () => {
    const { createDoubleBattle } = await import("./DoubleEventBattle");
    const java = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "__fixtures__/double-round-java.json"), "utf8"),
    ) as { rows: string[] };
    const party = [
      [68, 32, 2, 2],
      [58, 30, 2, 3],
      [95, 28, 1, 5],
    ].map(([speciesId, level, quality, nature]) => {
      const skillIds = services.progression.initialSkills(speciesId, level);
      return {
        speciesId,
        level,
        quality,
        nature,
        currentHp: services.petStats.coreStats(speciesId, level, quality, nature).hp,
        skillIds,
        skillPp: services.progression.fullPp(skillIds),
        physicalTraitId: 0,
      };
    });
    // `actionDeathDuration` of the two fallen enemies' visuals, as JavaSE measured them.
    const fall: Record<number, number> = { 142: 11, 143: 12 };
    const battle = createDoubleBattle(
      services,
      "SCENE9_ROOM0_GROUP1_LARRY",
      party as never,
      {},
      [],
      (sprite) => fall[sprite] ?? 8,
      undefined,
      7,
    );
    const rows: string[] = [];
    for (let guard = 0; guard < 600 && !battle.finished; guard++) {
      if (battle.stage === "command") {
        for (let press = 0; press < 3; press++) battle.handleInput(["confirm"]);
        continue;
      }
      battle.tick();
      const action = battle.action;
      if (!action) continue;
      const fx = battle.fxView,
        effect = fx.actorEffect,
        special = fx.special,
        death = battle.death,
        states = ([0, 1, 2, 3] as const).map((slot) => battle.slot(slot).spriteState);
      rows.push(
        [
          action.actor,
          action.target,
          action.skillId,
          action.phase,
          action.ticks,
          states.join(", "),
          effect ? `${effect.sprite}/${effect.state}/${effect.cursor}` : "-",
          special ? `${special.type}@${special.ticks}/${special.duration}` : "-",
          death ? `${death.spriteId}@${death.tick}/${death.duration}` : "-",
        ].join(" | "),
      );
    }
    expect(rows).toEqual(java.rows);
  });
});

describe("DoubleBattleRuntime state-1 L — VqsvDoubleBattleRuntime.tickActionLEffect", () => {
  it("plays Lôi Kỳ Lân's L on its own slot while its action's phase 0 runs", async () => {
    const { createDoubleBattle } = await import("./DoubleEventBattle");
    const party = [
      [75, 32, 2, 2],
      [58, 30, 2, 3],
    ].map(([speciesId, level, quality, nature]) => {
      const skillIds = services.progression.initialSkills(speciesId, level);
      return {
        speciesId,
        level,
        quality,
        nature,
        currentHp: services.petStats.coreStats(speciesId, level, quality, nature).hp,
        skillIds,
        skillPp: services.progression.fullPp(skillIds),
        physicalTraitId: 0,
      };
    });
    const battle = createDoubleBattle(
      services,
      "SCENE9_ROOM0_GROUP1_LARRY",
      party as never,
      {},
      [],
      () => 8,
      undefined,
      7,
    );
    const shown: string[] = [];
    for (let guard = 0; guard < 600 && !battle.finished && !shown.length; guard++) {
      if (battle.stage === "command") {
        for (let press = 0; press < 3; press++) battle.handleInput(["confirm"]);
        continue;
      }
      battle.tick();
      for (let tick = 0; tick < 3 && battle.stateOneLEffect; tick++) {
        const l = battle.stateOneLEffect;
        shown.push(`${l.slot}:${l.entry.speffect}:${l.frame}:${battle.action?.phase}`);
        battle.tick();
      }
    }
    expect(shown).toEqual(["2:20:0:0", "2:20:1:0", "2:20:2:0"]);
  });
});
