import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GameData } from "../../data/GameData";
import type { GoldenTraitBattleRow } from "../../data/GameData";
import { NO_HELD_ITEM } from "./HeldItems";
import { Pack } from "../../pack/Pack";
import type { SavedPet } from "../../persistence/SaveRepository";
import {
  BattleDefinitionRegistry,
  createCaptureTutorialBattleDefinition,
} from "./BattleDefinition";
import { BattleRuntime } from "./BattleRuntime";
import { loadBattleRules } from "./BattleRules";
import { PetStatCalculator } from "./PetStatCalculator";
import type { WorldContract } from "../story/GameAssets";

const root = resolve(import.meta.dirname, "..", "..", "..");

/** A catalog edit standing in for a mistake the pack could carry. */
let mutation: ((file: string, json: unknown) => unknown) | undefined;

vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(root, "public", decodeURIComponent(input.replace(/^\//, "")));
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const normalized = file.replace(/\\/g, "/");
  const value = mutation && normalized.endsWith(".json") ? mutation(normalized, parsed) : parsed;
  return { ok: true, status: 200, json: async () => value };
});

const contract = JSON.parse(
  readFileSync(resolve(root, "public/pack/story/world-contract.json"), "utf8"),
) as WorldContract;

/**
 * Load a fresh BattleRuntime for the scene1 fight together with the golden row that grades it.
 *
 * `golden-trait-battle.json` is a Java-exported answer table, not a TS projection, so it stays clean
 * regardless of which catalog the mutation touches. The runtime's rules ARE built from the mutated
 * pack, so its numbers diverge from the golden row in exactly the ways the mutation causes.
 *
 * The first round's committed damage and post-heal HP are the graded observables. Round 2 cannot be
 * graded against golden.rounds[1] because the golden walk injects a fresh `BattleRandom` per round
 * (seed=0, seed=1) while BattleRuntime uses one continuous stream — the two agree on round 1's
 * opening draw only. Round 2's structural outcome (enemy dies, stage → "weak") is checked instead.
 */
async function makeFight(
  mutate?: (file: string, json: unknown) => unknown,
): Promise<{ battle: BattleRuntime; golden: GoldenTraitBattleRow }> {
  mutation = mutate;
  try {
    const gameData = new GameData(await Pack.load());
    const [rules, goldenTable] = await Promise.all([
      loadBattleRules(gameData),
      gameData.goldenTraitBattle(),
    ]);
    const petStats = await PetStatCalculator.load(gameData);
    const golden = goldenTable.battles.find(
      (r) => r.talent === 0 && r.talentOwner === "player" && r.enemyHpPercent === 100,
    )!;
    const stats = {
      player: petStats.coreStats(68, contract.player.level, contract.player.quality),
      opponent: petStats.coreStats(34, contract.opponent.level, contract.opponent.quality),
    };
    const pet: SavedPet = {
      slot: 0,
      speciesId: 68,
      level: contract.player.level,
      quality: contract.player.quality,
      nature: contract.player.nature ?? 0,
      currentHp: stats.player.hp,
      maxHp: stats.player.hp,
      experience: 0,
      visualSpriteId: contract.player.spriteId,
      heldEquipmentId: NO_HELD_ITEM,
      skillIds: (contract.player.skills ?? []).map((s) => s.id),
      skillPp: (contract.player.skills ?? []).map((s) => s.pp),
    };
    const battle = new BattleRuntime(
      {
        actorId: contract.encounter.actorId,
        encounter: contract.encounter.request,
        flags: contract.encounter.flags,
        mode: contract.encounter.mode,
        branchTargets: contract.encounter.branchTargets,
      },
      new BattleDefinitionRegistry([createCaptureTutorialBattleDefinition(contract, pet, stats)]),
      rules,
      pet,
      contract.player.skills ?? [],
      contract.itemCatalog ?? [],
    );
    return { battle, golden };
  } finally {
    mutation = undefined;
  }
}

/**
 * Drive one confirm-pair strike through BattleRuntime's public interface.
 *
 * The runtime must be in "fight" stage when this is called. `damage` is the number the HUD's damage
 * text shows during the tween window, `enemyHp` is what the runtime reads after the round-end pass,
 * and `stage` is the stage the runtime transitioned to.
 */
function driveStrike(battle: BattleRuntime): {
  damage: number;
  enemyHp: number;
  stage: string;
} {
  const inv: Record<string, number> = { "0": 1, "1": 2, "4": 5 };
  battle.handleInput(["confirm"], inv); // fight → skillList
  battle.handleInput(["confirm"], inv); // skillList → skillAction
  const texts = new Set<string>();
  for (let i = 0; i < 100 && battle.interactiveStage === "skillAction"; i++) {
    const d = battle.damage;
    if (d) texts.add(d.text);
    battle.tick();
  }
  return {
    damage: Number([...texts][0].slice(1)),
    enemyHp: battle.hp("enemy"),
    stage: battle.interactiveStage,
  };
}

/** Grade round 1's damage and HP against golden.rounds[0]; returns one string per disagreement. */
function gradeRound1(battle: BattleRuntime, golden: GoldenTraitBattleRow): string[] {
  const r1 = driveStrike(battle);
  const found: string[] = [];
  if (r1.damage !== golden.rounds[0].committedDamage)
    found.push(
      `round 1 damage ${r1.damage} != ${golden.rounds[0].committedDamage} (Java golden answer)`,
    );
  if (r1.enemyHp !== golden.rounds[0].afterRoundEnd.enemy.hp)
    found.push(
      `round 1 enemyHp ${r1.enemyHp} != ` +
        `${golden.rounds[0].afterRoundEnd.enemy.hp} (post-heal Java golden answer)`,
    );
  return found;
}

describe("BattleRuntime scene1 fight, graded against golden-trait-battle.json", () => {
  /**
   * The scene1 tutorial fight replayed through BattleRuntime's tick loop and read through its public
   * HP and damage getters.
   *
   * `TraitBattleWalk.test.ts` drives the raw engines directly with per-round seeds; this grades the
   * runtime as the game drives it — one stream, HP tween boundaries, endRound call, stage machine.
   * The golden round 1 (talent 0, player, enemy at 100 percent) is the first-round answer; round 2
   * is checked structurally because the per-round seed model and the continuous-stream model diverge
   * from round 2 onward.
   */
  it("matches round 1's golden damage and post-heal HP", async () => {
    const { battle, golden } = await makeFight();
    expect(gradeRound1(battle, golden)).toEqual([]);
  });

  it("keeps the fight open after the first strike because the round-end heal lifts the Bunny above weakHp", async () => {
    const { battle, golden } = await makeFight();
    const r1 = driveStrike(battle);
    // The committed strike brings the Bunny to 44 HP (135 − 91).
    // The round-end pass heals 20 percent of max (27) → 71 HP.
    // weakHp = floor(135/2) = 67. 71 > 67 so stage stays "fight".
    const weakHp = Math.floor(golden.rounds[0].enemy.maxHp / 2);
    expect(r1.damage).toBe(golden.rounds[0].committedDamage); // 91
    expect(r1.enemyHp).toBe(golden.rounds[0].afterRoundEnd.enemy.hp); // 71
    expect(r1.enemyHp).toBeGreaterThan(weakHp); // 71 > 67
    expect(r1.stage).toBe("fight");
  });

  /**
   * Nhịp nhanh (status 20, trait_speed) is planted during the first round-end pass by the species-68
   * first_move_stacks characteristic. It is visible in the status strip after round 1 closes.
   */
  it("plants the Nhịp nhanh buff on the player during the first round-end pass", async () => {
    const { battle } = await makeFight();
    driveStrike(battle);
    const ids = battle
      .statusStrip("player")
      .map((slot) => slot.sourceNumericId)
      .includes(20);
    expect(ids).toBe(true);
  });

  /**
   * Two strikes are required to bring the Bunny below weakHp.
   *
   * The first strike lands 91 damage (enemy → 44) but the round-end heal lifts it to 71 (above weakHp).
   * The second strike kills the enemy (its HP reaches 0), and `endRound` returns early because the
   * enemy is not alive, so `hpOverride.enemy = 0` and stage → "weak".
   *
   * Round 2's exact committedDamage is not compared against golden.rounds[1] because the golden walk
   * uses a fresh stream (seed=1) for each round while the runtime advances the same seed-0 stream.
   */
  it("reaches the weak stage after exactly two strikes", async () => {
    const { battle, golden } = await makeFight();
    const r1 = driveStrike(battle);
    expect(r1.stage).toBe("fight"); // round-end heal kept it above weakHp
    // Round 2's committedDamage differs from golden due to the stream model, but the outcome is:
    // the Bunny starts at 71, the stream-0 continuation gives some damage ≥ 71, enemy falls to 0,
    // and endRound returns early (enemy not alive), so stage → "weak".
    const r2 = driveStrike(battle);
    expect(r2.stage).toBe("weak");
    expect(r2.enemyHp).toBeLessThanOrEqual(Math.floor(golden.rounds[0].enemy.maxHp / 2));
  });

  /**
   * Reducing Thỏ Di Lặc's defense buff value (from 70 to 40 percent) lowers its defense at 100% HP
   * from 20 to 16, which changes round 1's committedDamage away from the golden 91.
   */
  it("reports a disagreement when species 34's defense buff value changes", async () => {
    const { battle, golden } = await makeFight((file, json) => {
      // The web engine reads the value from the balance layer over the Java table: change both.
      const change = (rows: Record<string, unknown>[]) =>
        rows.map((row) => (row.speciesId === 34 ? { ...row, value: 40 } : row));
      if (file.endsWith("battle/pet-design-traits.json"))
        return change(json as Record<string, unknown>[]);
      if (file.endsWith("balance/pet-design-traits.json")) {
        const table = json as { traits: Record<string, unknown>[] };
        return { ...table, traits: change(table.traits) };
      }
      return json;
    });
    expect(gradeRound1(battle, golden).length).toBeGreaterThan(0);
  });

  /**
   * Reducing skill 40's power from 100 to 90 changes round 1's committedDamage away from the golden 91.
   */
  it("reports a disagreement when skill 40's power changes", async () => {
    const { battle, golden } = await makeFight((file, json) => {
      if (!file.endsWith("battle/skills-liet-hoa.json")) return json;
      return (json as Record<string, unknown>[]).map((row) =>
        row.runtimeId === 40 ? { ...row, power: 90 } : row,
      );
    });
    expect(gradeRound1(battle, golden).length).toBeGreaterThan(0);
  });

  /**
   * Visual handoff for the user (no browser assertions in this test — check these URLs in the dev
   * server yourself):
   *
   * `?bunnyAfterStrike=1`
   *   Freezes at the "fight" stage after the first strike. The HUD shows Thỏ Di Lặc at 71/135 — the
   *   round-end heal lifted it from 44 — and the Nhịp nhanh icon (status 20) is visible on the
   *   player's status strip. The stage is still "fight" because 71 > weakHp 67.
   *
   * `?bunnySkillTick=8&bunnySkill=0`
   *   Shows the damage "-91" text at the start of the strike tween, confirming round 1's committed
   *   damage.
   *
   * `?bunnyBattle=1`
   *   Pre-action fight stage: both pets at full HP, no statuses, command bar open.
   */
});
