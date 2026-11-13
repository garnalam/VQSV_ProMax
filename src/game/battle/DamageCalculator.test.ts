import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GameData } from "../../data/GameData";
import type {
  GoldenDamageRow,
  PackBattleEvent,
  PackDesignTrait,
  PackSpeciesRow,
} from "../../data/GameData";
import { Pack } from "../../pack/Pack";
import { DamageCalculator, type DamageCombatant } from "./DamageCalculator";
import { EnemyLevel } from "./EnemyLevel";
import { NO_HELD_ITEM } from "./HeldItems";
import { PetStatCalculator } from "./PetStatCalculator";

const root = resolve(import.meta.dirname, "..", "..", "..");
const SCENE1 = 1;

/** A catalog edit standing in for a mistake a port could make, cleared once the rig is loaded. */
let mutation: ((file: string, json: unknown) => unknown) | undefined;

vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(root, "public", decodeURIComponent(input.replace(/^\//, "")));
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const value = mutation && file.endsWith(".json") ? mutation(file, parsed) : parsed;
  return { ok: true, status: 200, json: async () => value };
});

/** The four authored inputs the engine builds a unit from before a single stat is read. */
type Fighter = { speciesId: number; level: number; nature: number; quality: number };

/** The four inputs the probe used for its level-scaling pair, read back out of the row label. */
function scalingFighter(label: string): Fighter | undefined {
  const match = /^(\d+)@lv(\d+)$/.exec(label);
  if (!match) return undefined;
  // `speciesCombatant(68, level, side 0, quality 3, nature 2)` against
  // `speciesCombatant(34, level, side 1, quality 3, nature 3)`.
  return { speciesId: +match[1], level: +match[2], nature: +match[1] === 68 ? 2 : 3, quality: 3 };
}

/** The pack rows a damage grade needs, loaded once so every test reads the same tables. */
class Rig {
  private constructor(
    readonly data: GameData,
    readonly stats: PetStatCalculator,
    readonly levels: EnemyLevel,
    readonly calculator: DamageCalculator,
    private readonly species: Map<number, PackSpeciesRow>,
    private readonly traits: Map<number, PackDesignTrait>,
  ) {}

  static async load(mutate?: (file: string, json: unknown) => unknown): Promise<Rig> {
    mutation = mutate;
    try {
      const data = new GameData(await Pack.load());
      const [stats, levels, calculator, catalog, designTraits] = await Promise.all([
        PetStatCalculator.load(data),
        EnemyLevel.load(data),
        DamageCalculator.load(data),
        data.species(),
        data.designTraits(),
      ]);
      return new Rig(
        data,
        stats,
        levels,
        calculator,
        new Map(catalog.rows.map((row) => [row.speciesId, row])),
        new Map(designTraits.map((row) => [row.speciesId, row])),
      );
    } finally {
      mutation = undefined;
    }
  }

  /** `BattleUnit.enemyFromEncounter`, including which operand carries which input. */
  enemy(sceneId: number, encounter: number[]): Fighter {
    return {
      speciesId: encounter.length > 0 ? encounter[0] : -1,
      level: this.levels.forScene(sceneId, encounter.length > 1 ? encounter[1] : 1),
      nature: encounter.length > 2 ? encounter[2] : 3,
      quality: encounter.length > 3 ? encounter[3] : -1,
    };
  }

  /** The scene1 cast the probe measured: the starter, then one unit per distinct encounter. */
  async scene1Fighters(): Promise<Map<string, Fighter>> {
    const fighters = new Map<string, Fighter>([["starter", await this.starterFighter()]]);
    const seen = new Set<string>();
    for (const event of Object.values(await this.data.battleEvents()) as PackBattleEvent[]) {
      if (event.sceneId !== SCENE1 || event.op37Encounter.length === 0) continue;
      // The probe keeps the first descriptor for each distinct encounter operand, in dump order.
      if (!seen.add(event.op37Encounter.join(","))) continue;
      fighters.set(`enemy-${event.label}`, this.enemy(event.sceneId, event.op37Encounter));
    }
    return fighters;
  }

  /** The starter the probe built its rows from, as the four inputs that define a unit. */
  async starterFighter(): Promise<Fighter> {
    const starter = (await this.data.goldenBattleMeta()).starter;
    return {
      speciesId: starter.speciesId,
      level: starter.level,
      nature: starter.nature,
      quality: starter.quality,
    };
  }

  combatant(fighter: Fighter): DamageCombatant {
    const core = this.stats.coreStats(fighter.speciesId, fighter.level, fighter.quality);
    return {
      speciesId: fighter.speciesId,
      attack: core.attack,
      defense: core.defense + this.buildDefenseBonus(fighter, core.defense),
      visualSpriteId: this.species.get(fighter.speciesId)?.spriteId ?? -1,
      hp: core.hp,
      maxHp: core.hp,
      // The units the golden tables measured are built without a form, so no held item is in play.
      heldItemId: NO_HELD_ITEM,
    };
  }

  /**
   * The one characteristic effect that changes a stat the moment a unit is built.
   *
   * `PetDesignTraitMechanics.statBonus` lifts defense by the characteristic's percent for an
   * `hp_band_defense` trait once the unit stands above 60 % of its own HP, which a freshly built
   * unit always does; its attack and speed branches read a stacked status a fresh unit does not
   * carry, and `spec()` is null while a species or characteristic trait id is set, which none of
   * the measured units have. Both unit paths run that pass, so the bonus belongs to every row.
   * Porting the rest of the characteristic rules is the L5 slice.
   */
  private buildDefenseBonus(fighter: Fighter, baseDefense: number): number {
    const trait = this.traits.get(fighter.speciesId);
    if (trait === undefined || trait.type !== "hp_band_defense") return 0;
    return Math.max(0, Math.floor((baseDefense * trait.value) / 100));
  }
}

/** The scripted value the probe ran behind each label family, clamped to the same bound. */
function scripted(row: GoldenDamageRow): (label: string) => number {
  return (label) => {
    const value = label.endsWith(".crit")
      ? row.critRoll
      : label.endsWith(".jitter")
        ? row.jitterRoll
        : 99;
    return Math.max(0, Math.min(99, value));
  };
}

/** Every field the golden table answers with, so a disagreement names the field that moved. */
function disagreements(
  rig: Rig,
  row: GoldenDamageRow,
  attacker: Fighter,
  target: Fighter,
): string[] {
  const mine = rig.combatant(attacker);
  const theirs = rig.combatant(target);
  const found: string[] = [];
  if (mine.attack !== row.attackerAtk) {
    found.push(`attackerAtk ${mine.attack} != ${row.attackerAtk} for ${JSON.stringify(attacker)}`);
  }
  if (theirs.defense !== row.defenderDef) {
    found.push(`defenderDef ${theirs.defense} != ${row.defenderDef} for ${JSON.stringify(target)}`);
  }
  const outcome = rig.calculator.damage({
    attacker: mine,
    target: theirs,
    skillId: row.skillId,
    randomPercent: scripted(row),
  });
  const expected = {
    damage: row.damage,
    critFlag: row.critFlag,
    relation: row.relation,
    appliedDebuffId: row.appliedDebuffId,
    supplementalDamage: row.supplementalDamage,
    draws: row.draws ?? [],
  };
  for (const field of Object.keys(expected) as (keyof typeof expected)[]) {
    const actual = JSON.stringify(outcome[field]);
    if (actual !== JSON.stringify(expected[field])) {
      found.push(
        `${row.attacker} -> ${row.defender} skill ${row.skillId} ${field} ${actual} != ${JSON.stringify(
          expected[field],
        )}`,
      );
    }
  }
  return found;
}

describe("damage calculator", () => {
  it("grades every damage row the Java engine measured, stat input included", async () => {
    const rig = await Rig.load();
    const table = await rig.data.goldenDamage();
    const fighters = await rig.scene1Fighters();
    const wild: Fighter = rig.enemy(SCENE1, [34, 5, 1]);
    let graded = 0;
    const failures: string[] = [];
    const refused: string[] = [];
    const fighterFor = (label: string): Fighter => {
      const authored = fighters.get(label) ?? scalingFighter(label);
      if (authored) return authored;
      if (label === "enemy-wild") return wild;
      throw new Error(`no fighter built from pack data for ${label}`);
    };
    // A nature that moves a stat is the L5 boundary; scene1 never asks for one, so the grade below
    // reads the growth layer alone. If an authored encounter starts using one, this pins the fact.
    const movingNatures = [...fighters.values()].filter((each) => [7, 8, 9].includes(each.nature));
    expect(movingNatures).toEqual([]);
    for (const row of [...table.rows, ...table.levelScaling, ...table.critThreshold]) {
      if (rig.calculator.skillRow(row.skillId)?.damageBranch === "unified") {
        // A signature skill takes the unified branch, which is a separate slice: it asks
        // UnifiedSkillMechanics for a power and draws a skill-effect roll before the crit roll.
        refused.push(`${row.attacker} -> ${row.defender} skill ${row.skillId}`);
        expect(() =>
          rig.calculator.damage({
            attacker: rig.combatant(fighterFor(row.attacker)),
            target: rig.combatant(fighterFor(row.defender)),
            skillId: row.skillId,
            randomPercent: scripted(row),
          }),
        ).toThrow(/unified-v5 branch/);
        continue;
      }
      failures.push(...disagreements(rig, row, fighterFor(row.attacker), fighterFor(row.defender)));
      graded++;
    }
    expect(graded).toBe(883);
    // The starter learns a Cầu Vồng signature skill from level 20 up, and that is the only skill on
    // the unified branch the measured rows use: three roll pairs at each of levels 20, 50 and 100.
    expect(refused).toEqual(
      [20, 50, 100].flatMap((level) =>
        [0, 1, 2].map(() => `68@lv${level} -> 34@lv${level} skill 1071`),
      ),
    );
    expect(failures).toEqual([]);
  });

  it("keeps the crit chance exactly where the engine put it", async () => {
    const rows = (await (await Rig.load()).data.goldenDamage()).critThreshold;
    expect(rows.length).toBe(13);
    const crits = rows.filter((row) => row.critFlag === 1);
    // Rolls 0..5 crit, 6..12 do not: the chance is five, not a speed-derived number.
    expect(crits.map((row) => row.critRoll)).toEqual([0, 1, 2, 3, 4, 5]);
    // 91 raw becomes 136, so the multiplier is three halves with Java's truncating division.
    expect(crits.every((row) => row.damage === 136)).toBe(true);
    expect(rows.filter((row) => row.critFlag === 0).every((row) => row.damage === 91)).toBe(true);
  });

  it("grades one row per skill id and refuses the branch this slice does not carry", async () => {
    const rig = await Rig.load();
    const table = await rig.data.goldenSkillBranch();
    const starter = await rig.starterFighter();
    const wild: Fighter = rig.enemy(SCENE1, [34, 5, 1]);
    const failures: string[] = [];
    const refused: number[] = [];
    const graded: number[] = [];
    for (const row of table.rows) {
      if (rig.calculator.skillRow(row.skillId)?.damageBranch === "unified") {
        expect(() =>
          rig.calculator.damage({
            attacker: rig.combatant(starter),
            target: rig.combatant(wild),
            skillId: row.skillId,
            randomPercent: scripted(row),
          }),
        ).toThrow(/unified-v5 branch/);
        refused.push(row.skillId);
        continue;
      }
      failures.push(...disagreements(rig, row, starter, wild));
      graded.push(row.skillId);
    }
    expect(failures).toEqual([]);
    expect(graded.length).toBe(71);
    // Java's runtime table resolves 66 ids on the unified branch: the 33 Cầu Vồng skills at 70..100
    // and 134..135 plus the 33 numeric clones at 101..133, which the learnset still names.
    expect(refused.length).toBe(66);
    expect(refused[0]).toBe(70);
    expect(refused[refused.length - 1]).toBe(135);
  });

  it("rolls a status chance only when the producer makes it worth rolling", async () => {
    const rig = await Rig.load();
    const starter = await rig.starterFighter();
    const wild: Fighter = rig.enemy(SCENE1, [34, 5, 1]);
    // Lôi thiểm: producer chance 20 on debuff 10, so 19 lands and 20 does not.
    const roll =
      (debuff: number) =>
      (label: string): number =>
        label.endsWith(".debuff") ? debuff : label.endsWith(".crit") ? 99 : 50;
    const hit = (debuff: number) =>
      rig.calculator.damage({
        attacker: rig.combatant(starter),
        target: rig.combatant(wild),
        skillId: 41,
        randomPercent: roll(debuff),
      });
    expect(hit(19).appliedDebuffId).toBe(10);
    expect(hit(20).appliedDebuffId).toBe(-1);
    expect(hit(19).draws).toEqual(["damage.crit=99", "damage.debuff=19", "damage.jitter=50"]);
    // A chance of 100 skips the roll entirely, the way the engine's certain statuses do.
    const certain = rig.calculator.damage({
      attacker: rig.combatant(starter),
      target: rig.combatant(wild),
      skillId: 1,
      randomPercent: roll(0),
    });
    expect(certain.appliedDebuffId).toBe(0);
    expect(certain.draws).toEqual(["damage.crit=99", "damage.jitter=50"]);
  });

  it("holds a defense pierce to the same bounds the engine does", async () => {
    const rig = await Rig.load();
    const attacker: DamageCombatant = {
      speciesId: 68,
      attack: 100,
      defense: 10,
      visualSpriteId: 154,
    };
    const target: DamageCombatant = {
      speciesId: 34,
      attack: 10,
      defense: 50,
      visualSpriteId: 120,
    };
    const hit = (defenseIgnorePercent: number) =>
      rig.calculator.damage({
        attacker,
        target,
        skillId: 0,
        randomPercent: (label) => (label.endsWith(".crit") ? 99 : 50),
        defenseIgnorePercent,
      }).damage;
    // Hỏa trảo is 100 % power, so each number here is the raw hit after the pierce has shrunk the
    // target's defense and before anything else touches it.
    expect(hit(0)).toBe(50);
    expect(hit(50)).toBe(75);
    expect(hit(100)).toBe(100);
    expect(hit(150)).toBe(100);
    expect(hit(-40)).toBe(50);
  });

  it("refuses an input whose rule a later slice owns", async () => {
    const rig = await Rig.load();
    const attacker = rig.combatant({ speciesId: 68, level: 7, nature: 2, quality: 2 });
    const target = rig.combatant({ speciesId: 34, level: 5, nature: 1, quality: 1 });
    const hit = (overrides: Record<string, unknown>, side: "attacker" | "target") => () =>
      rig.calculator.damage({
        attacker: side === "attacker" ? { ...attacker, ...overrides } : attacker,
        target: side === "target" ? { ...target, ...overrides } : target,
        skillId: 40,
        randomPercent: () => 50,
      });
    expect(hit({ skillId: 70 }, "attacker")).not.toThrow();
    // Item 0 reads the holder's own HP against a percent of its base HP, which a snapshot without
    // either cannot supply; the item itself is no longer a refusal.
    expect(hit({ heldItemId: 0, hp: undefined, maxHp: undefined }, "attacker")).toThrow(/item 0/);
    expect(hit({ heldItemId: 4 }, "attacker")).not.toThrow();
    expect(hit({ buffIds: [1] }, "attacker")).toThrow(/stored on the status/);
    expect(hit({ buffIds: [8] }, "attacker")).toThrow(/stored on the status/);
    expect(hit({ debuffIds: [6] }, "attacker")).toThrow(/scales damage by a stored percent/);
    expect(hit({ buffIds: [6] }, "target")).toThrow(/scales damage by a stored percent/);
    // Lôi Điện is a plain multiplier and needs nothing more; Hỏa Phong rewrites a live defense.
    expect(hit({ passiveDamagePercent: 10 }, "attacker")).not.toThrow();
    expect(hit({ passiveTargetDefensePercent: 10 }, "target")).toThrow(/Hỏa Phong/);
    expect(hit({ traitDefenseIgnorePercent: 20 }, "attacker")).toThrow(/characteristic/);
    expect(hit({ traitPowerBonusPercent: 20 }, "attacker")).toThrow(/characteristic/);
    // The unified branch is a whole module of its own, and it draws before the crit roll.
    expect(() =>
      rig.calculator.damage({
        attacker,
        target,
        skillId: 70,
        randomPercent: () => 50,
      }),
    ).toThrow(/unified-v5 branch/);
    // A skill that scales with missing HP cannot be graded without the current hit points.
    expect(() =>
      rig.calculator.damage({
        attacker: { ...attacker, hp: undefined, maxHp: undefined },
        target: { ...target, hp: undefined, maxHp: undefined },
        skillId: 53,
        randomPercent: () => 50,
      }),
    ).toThrow(/missing HP/);
  });

  it("has teeth: a wrong catalog row disagrees with the golden table", async () => {
    const clean = await Rig.load();
    const table = await clean.data.goldenDamage();
    const fighters = await clean.scene1Fighters();
    const grade = (rig: Rig): number => {
      let wrong = 0;
      for (const row of table.rows) {
        const attacker = fighters.get(row.attacker);
        const target = fighters.get(row.defender);
        if (!attacker || !target) throw new Error(`cast row for ${row.attacker}/${row.defender}`);
        if (disagreements(rig, row, attacker, target).length > 0) wrong++;
      }
      return wrong;
    };
    expect(grade(clean)).toBe(0);

    // Drop the pair that lets Hỏa beat Mộc and every relation-0 row stops doubling.
    const withoutOnePair = await Rig.load((file, json) => {
      if (!file.endsWith("element-chart.json")) return json;
      const chart = json as { beats: number[][] };
      return { ...chart, beats: chart.beats.filter(([a, b]) => !(a === 0 && b === 1)) };
    });
    expect(grade(withoutOnePair)).toBe(66);

    // The legacy row's effect mode is the gate on the status a Liệt Hỏa skill can apply: turn it off
    // and the certain-or-rolled status disappears from the answer.
    const wrongEffectMode = await Rig.load((file, json) => {
      if (!file.endsWith("skill-rows.json")) return json;
      const catalog = json as { rows: { skillId: number; effectMode: number }[] };
      return {
        ...catalog,
        rows: catalog.rows.map((row) => (row.skillId === 41 ? { ...row, effectMode: 0 } : row)),
      };
    });
    expect(grade(wrongEffectMode)).toBe(99);

    // Make a 20 % status certain and the roll the engine took disappears from the draw sequence.
    const certainStatus = await Rig.load((file, json) => {
      if (!file.endsWith("debuff-producers.json")) return json;
      const dumped = json as { producers: { skillId: number; chance: number }[] };
      return {
        ...dumped,
        producers: dumped.producers.map((row) =>
          row.skillId === 41 ? { ...row, chance: 100 } : row,
        ),
      };
    });
    expect(grade(certainStatus)).toBe(99);

    // The Liệt Hỏa record carries the power this branch scales by, not the legacy row.
    const wrongRecord = await Rig.load((file, json) => {
      if (!file.endsWith("skills-liet-hoa.json")) return json;
      const rows = json as { runtimeId: number; power: number }[];
      return rows.map((row) => (row.runtimeId === 40 ? { ...row, power: row.power + 5 } : row));
    });
    expect(grade(wrongRecord)).toBe(99);
  });
});
