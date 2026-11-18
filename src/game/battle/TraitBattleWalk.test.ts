import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GameData } from "../../data/GameData";
import type {
  GoldenTraitBattleRound,
  GoldenTraitBattleRow,
  GoldenTraitBattleTable,
  GoldenTraitBattleUnit,
} from "../../data/GameData";
import { Pack } from "../../pack/Pack";
import type { BattleRules } from "./BattleRules";
import { loadBattleRules } from "./BattleRules";
import { BattleRandom } from "./BattleRandom";
import type { DesignTraitProjection } from "./DesignTraitProjection";
import type { DesignTraitUnit, DesignTraitUnitSeed } from "./DesignTraits";
import { heldStatuses, resolveP7Strike } from "./P7Strike";

const root = resolve(import.meta.dirname, "..", "..", "..");

/** A catalog edit standing in for a mistake a port could make, cleared once the rig is loaded. */
let mutation: ((file: string, json: unknown) => unknown) | undefined;

vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(root, "public", decodeURIComponent(input.replace(/^\//, "")));
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const normalized = file.replace(/\\/g, "/");
  const value = mutation && normalized.endsWith(".json") ? mutation(normalized, parsed) : parsed;
  return { ok: true, status: 200, json: async () => value };
});

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** `ProbeWebBattleMath.TRAIT_ENEMY_SLOT` and `TRAIT_BATTLE_PLAYER_SLOT`, the two seats of the 1v1. */
const ENEMY_SLOT = 0;
const PLAYER_SLOT = 1;

/** `PetTraitBattleState` canonical names, in the order the probe writes them into `canonical`. */
const CANONICAL_NAMES = ["burn", "corrosion", "paralysis", "petrification", "bind"] as const;

/**
 * How many disagreements each deliberate mistake produces, taken from a real run.
 *
 * The four are chosen because each one lands on a different owner of the walk: the two characteristics
 * are what the round-end pass pays out of, the skill row is what the strike is drawn from, and the
 * talent chance is the only draw the traits block asks for. A count of zero would mean the mistake is
 * invisible, which is the thing this table exists to rule out.
 */
const MUTATION_COUNTS = {
  wrongSpeedGrowth: 80,
  wrongBandDefense: 241,
  wrongSkillPower: 274,
  wrongTalentChance: 13,
};

/** `ProbeWebBattleMath.unitSnapshot`, field for field. */
function snapshotOf(
  unit: DesignTraitUnit,
  mechanics: BattleRules["traits"],
): GoldenTraitBattleUnit {
  return {
    hp: unit.hp(),
    maxHp: unit.maxHp(),
    attack: unit.currentStats.attack,
    defense: unit.currentStats.defense,
    speed: unit.currentStats.speed,
    baseAttack: unit.baseStats.attack,
    baseDefense: unit.baseStats.defense,
    baseSpeed: unit.baseStats.speed,
    physicalTraitId: unit.physicalTraitId,
    speciesTraitId: unit.speciesTraitId,
    characteristicTraitId: unit.characteristicTraitId,
    characteristicEnabled: mechanics.enabled(unit),
    permanentStatsApplied: unit.traitBattleState.permanentStatsApplied(),
    canonical: CANONICAL_NAMES.map((name) =>
      unit.traitBattleState.hasCanonicalStatus(name) ? 1 : 0,
    ),
  };
}

/** Report every field of one unit snapshot the replay left different from the row. */
function snapshotDiffs(
  label: string,
  field: string,
  mine: GoldenTraitBattleUnit,
  recorded: GoldenTraitBattleUnit,
): string[] {
  const found: string[] = [];
  for (const key of Object.keys(recorded) as (keyof GoldenTraitBattleUnit)[])
    if (!same(mine[key], recorded[key]))
      found.push(
        `${label} ${field}.${String(key)} ${JSON.stringify(mine[key])} != ` +
          JSON.stringify(recorded[key]),
      );
  return found;
}

/**
 * One recorded round, walked in the order the runtime now walks it: the strike through the fight's
 * projection, then the bleed on both seats, then `onRoundEnd` on both seats, then the advance.
 *
 * The returned object carries the row's own keys, so the caller compares key by key and a field the
 * port stops producing reads `undefined` and disagrees instead of dropping out of the grading.
 */
function replayRound(
  table: GoldenTraitBattleTable,
  rules: BattleRules,
  projection: DesignTraitProjection,
  player: DesignTraitUnit,
  enemy: DesignTraitUnit,
  recorded: GoldenTraitBattleRound,
  random: BattleRandom,
  sprites: { player: number; enemy: number },
): Record<string, unknown> {
  const trace = resolveP7Strike({
    attacker: player,
    receiver: enemy,
    skillId: table.units.skill,
    rules,
    random,
    attackerSpriteId: sprites.player,
    receiverSpriteId: sprites.enemy,
    // The player is the actor of the round, so the floor context `captureForbidden() && p7Attacker
    // == player && p7DamageReceiver == enemy` opens is open here.
    allowsHpFloor: true,
    trait: {
      projection,
      attacker: player,
      receiver: enemy,
      attackerSlot: PLAYER_SLOT,
      receiverSlot: ENEMY_SLOT,
      roundIndex: recorded.round,
      actedFirst: true,
    },
  });
  if (trace.zeroPower)
    throw new Error(
      `skill ${table.units.skill} took the zero-power route, which no recorded round of this table did`,
    );
  // The row's `player` and `enemy` close the strike, before the round-end pass has taken a single
  // point, so both snapshots and both strips are read here rather than at the return below.
  const strikeEnd = {
    player: snapshotOf(player, rules.traits),
    enemy: snapshotOf(enemy, rules.traits),
    playerHeld: heldStatuses(player),
    enemyHeld: heldStatuses(enemy),
  };
  const playerBleeding = projection.tickDesignBleeding(player, recorded.round),
    enemyBleeding = projection.tickDesignBleeding(enemy, recorded.round);
  projection.onRoundEnd(player, PLAYER_SLOT, recorded.round, 0);
  projection.onRoundEnd(enemy, ENEMY_SLOT, recorded.round, 0);
  return {
    seed: recorded.seed,
    round: recorded.round,
    defenseIgnorePercent: trace.trait?.defenseIgnorePercent,
    resultDamage: trace.resultDamage,
    resolvedDamage: trace.resolvedDamage,
    critFlag: trace.critFlag,
    appliedDebuffId: trace.appliedDebuffId,
    supplementalDamage: trace.supplementalDamage,
    sourceMissChance: trace.trait?.sourceMissChance,
    missChance: trace.missChance,
    hitRoll: trace.hitRoll,
    sideEffectMode: trace.sideEffectMode,
    hit: trace.hit,
    planDamage: trace.planDamage,
    attackerSpeed: trace.attackerSpeed,
    targetSpeed: trace.targetSpeed,
    draws: [...trace.draws],
    targetHpBefore: trace.targetHpBefore,
    projectedDamage: trace.damage,
    floor: trace.floor,
    floorApplied: trace.floorApply,
    committedDamage: trace.committedDamage,
    skillActionHealing: trace.trait?.skillActionHealing,
    ...strikeEnd,
    bleeding: { player: playerBleeding, enemy: enemyBleeding },
    afterRoundEnd: {
      player: snapshotOf(player, rules.traits),
      enemy: snapshotOf(enemy, rules.traits),
    },
  };
}

/**
 * The scene1 tutorial fight replayed from `battle/golden-trait-battle.json`.
 *
 * `golden-traits.json` grades one characteristic against a dummy and `golden-physical-traits.json`
 * grades one talent against a dummy; this table is the composition the battle actually runs — both
 * characteristics live, one talent live on one side, the enemy standing in one HP band — so it is the
 * evidence that grades the wiring rather than the parts. The round-end pass is the newest seam: the
 * player's speed grows on it, the Bunny below its band heals on it, and the bleed is asked of both
 * seats, which is why the round's snapshot is taken after it and not before.
 */
class TraitBattleWalk {
  private constructor(
    readonly table: GoldenTraitBattleTable,
    private readonly rules: BattleRules,
    /** The pair as Java builds it before a talent has moved a stat: the talent-0 row's own units. */
    private readonly template: { player: GoldenTraitBattleUnit; enemy: GoldenTraitBattleUnit },
    private readonly sprites: { player: number; enemy: number },
  ) {}

  static async load(mutate?: (file: string, json: unknown) => unknown): Promise<TraitBattleWalk> {
    mutation = mutate;
    try {
      const data = new GameData(await Pack.load());
      const [table, rules] = await Promise.all([data.goldenTraitBattle(), loadBattleRules(data, { traitScripts: false })]);
      const bare = table.battles.find((row) => row.talent === 0);
      if (!bare)
        throw new Error("the table has no talent-0 row, so the unprojected build is unknown");
      if (
        bare.beforeEnter.player.physicalTraitId !== 0 ||
        bare.beforeEnter.enemy.physicalTraitId !== 0
      )
        throw new Error("the talent-0 row carries a talent, so it is not the unprojected build");
      const [playerSpecies, enemySpecies] = await Promise.all([
        data.speciesByRuntimeId(table.units.playerSpecies),
        data.speciesByRuntimeId(table.units.enemySpecies),
      ]);
      return new TraitBattleWalk(
        table,
        rules,
        { player: bare.beforeEnter.player, enemy: bare.beforeEnter.enemy },
        {
          player: playerSpecies?.spriteId ?? -1,
          enemy: enemySpecies?.spriteId ?? -1,
        },
      );
    } finally {
      mutation = undefined;
    }
  }

  get battles(): number {
    return this.table.battles.length;
  }

  get rounds(): number {
    return this.table.battles.reduce((total, row) => total + row.rounds.length, 0);
  }

  coverage(): { talents: number[]; owners: string[]; bands: number[] } {
    const talents = new Set<number>(),
      owners = new Set<string>(),
      bands = new Set<number>();
    for (const row of this.table.battles) {
      talents.add(row.talent);
      owners.add(row.talentOwner);
      bands.add(row.enemyHpPercent);
    }
    return {
      talents: [...talents].sort((a, b) => a - b),
      owners: [...owners].sort(),
      bands: [...bands].sort((a, b) => a - b),
    };
  }

  /**
   * `starterUnit` and `enemyFromEncounter`, one side at a time.
   *
   * The four stats are the talent-0 build, so the permanent resolver has nothing to have moved yet:
   * `onBattleEnter` is what has to grow the player to 193 for talent 2 and lift the Bunny's attack for
   * talent 4, which is the same resolver the row's `afterEnter` snapshot reports as done.
   */
  private build(side: "player" | "enemy", row: GoldenTraitBattleRow): DesignTraitUnit {
    const template = this.template[side],
      physicalTraitId =
        side === "player"
          ? row.beforeEnter.player.physicalTraitId
          : row.beforeEnter.enemy.physicalTraitId,
      seed: DesignTraitUnitSeed = {
        speciesId:
          side === "player" ? this.table.units.playerSpecies : this.table.units.enemySpecies,
        ownerSide: side === "player" ? 0 : 1,
        formationSlot: 0,
        base: {
          hp: template.maxHp,
          attack: template.baseAttack,
          defense: template.baseDefense,
          speed: template.baseSpeed,
        },
        // The probe leaves the form slot at the zeroed array default, so neither unit holds an item.
        heldItemId: 0,
        physicalTraitId,
      };
    if (side === "player") {
      seed.skillIds = [this.table.units.skill, 0, 0, 0, 0];
      seed.skillPp = [30, 0, 0, 0, 0];
      seed.selectedSkillId = this.table.units.skill;
    }
    return this.rules.traits.unit(seed);
  }

  gradeRow(row: GoldenTraitBattleRow, found: string[]): void {
    const label = `talent ${row.talent} on ${row.talentOwner} at ${row.enemyHpPercent}%`,
      player = this.build("player", row),
      enemy = this.build("enemy", row);
    // One stream for the fight, swapped per round the way Java swaps the trace: the projection's own
    // chance draws and the walk's rolls have to come from the same sequence.
    let stream: BattleRandom | undefined;
    const projection = this.rules.newTraitProjection((label) => {
      if (!stream)
        throw new Error(`the projection drew ${label} before the round's stream was installed`);
      return stream.percent(label);
    });
    projection.onBattleEnter(enemy, ENEMY_SLOT, this.table.slots.roundIndexAtEnter, 0);
    projection.onBattleEnter(player, PLAYER_SLOT, this.table.slots.roundIndexAtEnter, 0);
    // `enemy.setHp(maxHp * percent / 100)` with Java's integer division, on the max HP the talent left.
    enemy.setHp(Math.max(1, Math.floor((enemy.maxHp() * row.enemyHpPercent) / 100)));
    found.push(
      ...snapshotDiffs(
        `${label} enter`,
        "player",
        snapshotOf(player, this.rules.traits),
        row.afterEnter.player,
      ),
      ...snapshotDiffs(
        `${label} enter`,
        "enemy",
        snapshotOf(enemy, this.rules.traits),
        row.afterEnter.enemy,
      ),
    );
    for (const recorded of row.rounds) {
      stream = new BattleRandom(recorded.seed);
      const mine = replayRound(
        this.table,
        this.rules,
        projection,
        player,
        enemy,
        recorded,
        stream,
        this.sprites,
      );
      for (const field of Object.keys(recorded) as (keyof GoldenTraitBattleRound)[]) {
        const expected = recorded[field] as unknown,
          actual = mine[field];
        if (!same(actual, expected))
          found.push(
            `${label} round ${recorded.round} ${field} ${JSON.stringify(actual)} != ` +
              JSON.stringify(expected),
          );
      }
    }
  }

  gradeAll(): string[] {
    const found: string[] = [];
    for (const row of this.table.battles) this.gradeRow(row, found);
    return found;
  }
}

describe("the scene1 trait fight, replayed round by round against the Java engine", () => {
  it("replays every recorded battle without a disagreement", async () => {
    const walk = await TraitBattleWalk.load();
    expect(walk.gradeAll()).toEqual([]);
  });

  it("walks the sweep the probe ran, not a shorter one", async () => {
    const walk = await TraitBattleWalk.load();
    expect(walk.battles).toBe(32);
    expect(walk.rounds).toBe(48);
    expect(walk.coverage()).toEqual({
      talents: [0, 2, 4, 8, 11, 12, 13, 16],
      owners: ["enemy", "player"],
      bands: [30, 100],
    });
  });

  it("grades the round-end pass as the round's closing step", async () => {
    const walk = await TraitBattleWalk.load(),
      // The pass is not a no-op on this table: the player's characteristic grows its speed every round
      // it moves first, and a Bunny under its band heals a fifth of its maximum. If either stopped
      // happening the afterRoundEnd snapshot would disagree, so the rows that carry the movement are
      // counted here to keep the seam from grading nothing.
      grown = walk.table.battles.filter((row) =>
        row.rounds.some((round) => round.afterRoundEnd.player.speed > round.player.speed),
      ).length,
      healed = walk.table.battles.filter((row) =>
        row.rounds.some((round) => round.afterRoundEnd.enemy.hp > round.enemy.hp),
      ).length,
      paidBleed = walk.table.battles.reduce(
        (total, row) =>
          total +
          row.rounds.filter((round) => round.bleeding.player + round.bleeding.enemy > 0).length,
        0,
      );
    expect(grown).toBe(32);
    expect(healed).toBe(16);
    // No round of this table ever carries the bank-2 bleed, so the payout arithmetic has no referee
    // row here; the walk only proves the seam is asked and answers zero on both seats.
    expect(paidBleed).toBe(0);
    expect(walk.gradeAll()).toEqual([]);
  });

  it("reports a characteristic, skill or talent the catalogs changed under it", async () => {
    const clean = await TraitBattleWalk.load();
    expect(clean.gradeAll()).toEqual([]);
    const count = async (mutate: (file: string, json: unknown) => unknown): Promise<number> =>
      (await TraitBattleWalk.load(mutate)).gradeAll().length;
    const changeDesignTrait =
      (speciesId: number, value: number) =>
      (file: string, json: unknown): unknown => {
        // The web engine reads the value from the balance layer over the Java table: change both.
        const change = (rows: Record<string, unknown>[]) =>
          rows.map((row) => (row.speciesId === speciesId ? { ...row, value } : row));
        if (file.endsWith("battle/pet-design-traits.json"))
          return change(json as Record<string, unknown>[]);
        if (file.endsWith("balance/pet-design-traits.json")) {
          const table = json as { traits: Record<string, unknown>[] };
          return { ...table, traits: change(table.traits) };
        }
        return json;
      };
    expect({
      wrongSpeedGrowth: await count(changeDesignTrait(68, 20)),
      wrongBandDefense: await count(changeDesignTrait(34, 60)),
      wrongSkillPower: await count((file, json) => {
        if (!file.endsWith("battle/skills-liet-hoa.json")) return json;
        return (json as Record<string, unknown>[]).map((row) =>
          row.runtimeId === 40 ? { ...row, power: 90 } : row,
        );
      }),
      wrongTalentChance: await count((file, json) => {
        if (!file.endsWith("battle/pet-trait-mechanics.json")) return json;
        const mechanics = json as { physical: Record<string, unknown>[] };
        return {
          ...mechanics,
          physical: mechanics.physical.map((row) =>
            row.runtimeId === 13
              ? {
                  ...row,
                  parametersJson: '{"trigger_chance_percent":90,"damage_reduction_percent":50}',
                }
              : row,
          ),
        };
      }),
    }).toEqual(MUTATION_COUNTS);
  });
});
