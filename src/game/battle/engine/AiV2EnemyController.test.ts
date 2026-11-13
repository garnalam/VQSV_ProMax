import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { PackBattleAiProfile } from "../../../data/GameData";

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
const { BattleAiRulebook } = await import("../ai/BattleAiRulebook");
const { BattleAiEncounterCatalog } = await import("../ai/BattleAiEncounterCatalog");
const { RUNTIME_MODES } = await import("../ai/BattleAiV2RuntimeSelector");
const { BattleCore } = await import("./BattleCore");
const { BattleItems } = await import("./BattleItems");
const { BasicEnemyAi } = await import("./EnemyController");
const { AiV2EnemyController } = await import("./AiV2EnemyController");
const { PetProgression } = await import("./PetProgression");

const data = new GameData(await Pack.load());
const rules = await loadBattleRules(data);
const petStats = await PetStatCalculator.load(data);
const rulebook = await BattleAiRulebook.load(data);
const catalog = await BattleAiEncounterCatalog.load(data);
const items = new BattleItems(await data.items());
const species = (await data.species()).rows;
const progression = new PetProgression(
  petStats,
  await data.learnsets(),
  new Map((await data.designTraits()).map((row) => [row.speciesId, row.petKey])),
  (id) => rules.damage.skillRow(id)?.ppMax ?? 0,
);
const combatant = (speciesId: number, level: number) => ({
  speciesId,
  level,
  quality: 3,
  nature: 3,
  stats: petStats.coreStats(speciesId, level, 3),
  skillIds: progression.defaultSkills(speciesId, level),
});

/** Ten rounds of a fight against `encounterKey`'s roster, the AI v2 controller deciding. */
function play(
  encounterKey: string | undefined,
  mode = RUNTIME_MODES.ALL_ENCOUNTERS_V2,
  seed = 7,
  profile = undefined as PackBattleAiProfile | undefined,
) {
  const controller = new AiV2EnemyController(
      rules,
      rulebook,
      catalog,
      encounterKey,
      new BasicEnemyAi(rules),
      mode,
      profile,
    ),
    random = new BattleRandom(seed),
    core = new BattleCore(
      rules,
      { items, relationClass: (id) => species[id]?.relationClass ?? 0 },
      {
        format: "1v1",
        kind: "wild",
        player: [combatant(68, 12)],
        enemy: [combatant(34, 8)],
      },
      random,
      controller,
    ),
    traces = [];
  core.start();
  for (let i = 0; i < 10 && core.request.kind === "command"; i++) {
    core.submit({ kind: "skill", slot: 0 });
    traces.push(controller.lastTrace!);
  }
  return { core, traces, draws: random.draws() };
}

describe("AiV2EnemyController", () => {
  it("finds the Scene 1 bunny's encounter by its descriptor", () => {
    expect(catalog.keyForDescriptorSymbol("SCENE1_ROOM1_GROUP0_BUNNY")).toBe(
      "LH-ENC-S01-R01-G00-B01-BUNNY",
    );
    expect(catalog.isCommissioned("LH-ENC-S01-R01-G00-B01-BUNNY")).toBe(true);
  });

  it("on a commissioned encounter the v2 pick commits, and every pick is a legal enemy action", () => {
    const { core, traces } = play("LH-ENC-S01-R01-G00-B01-BUNNY");
    expect(traces.length).toBeGreaterThan(0);
    expect(traces.every((trace) => trace.fromV2 && trace.reason === "committed")).toBe(true);
    const enemySkills = core.events.flatMap((e) =>
      e.type === "skill" && e.seat.side === "enemy" ? [e.skillId] : [],
    );
    expect(enemySkills.length).toBeGreaterThan(0);
    expect(enemySkills.every((id) => core.unit("enemy", 0).skillIds.includes(id))).toBe(true);
  });

  it("a descriptor profile makes the v1 engine the production decision", () => {
    const profile = catalog.profileForDescriptor("SCENE1_ROOM1_GROUP0_BUNNY");
    expect(profile).toMatchObject({ tier: "BattleAiTier.WILD", randomness: 54, itemBudget: 0 });
    const { core, traces, draws } = play("LH-ENC-S01-R01-G00-B01-BUNNY", undefined, 7, profile);
    expect(traces.length).toBeGreaterThan(0);
    expect(traces.every((trace) => trace.fromV1)).toBe(true);
    // One raw bounded draw per scored slot, keyed by tier the way Java's trace keys it.
    const jitter = draws.filter((draw) => draw.startsWith("battle.ai.1v1.WILD.skill-"));
    expect(jitter.length).toBe(traces.length * core.unit("enemy", 0).skillIds.length);
    expect(
      jitter.every((draw) => {
        const value = Number(draw.split("=")[1]);
        return value >= 0 && value < 2 * profile!.randomness + 1;
      }),
    ).toBe(true);
    // A Dã bot with no switch policy and no item budget never reaches either.
    expect(draws.some((draw) => draw.includes(".switch="))).toBe(false);
    expect(core.events.some((e) => e.type === "item" && e.seat.side === "enemy")).toBe(false);
    const enemySkills = core.events.flatMap((e) =>
      e.type === "skill" && e.seat.side === "enemy" ? [e.skillId] : [],
    );
    expect(enemySkills.length).toBeGreaterThan(0);
    expect(enemySkills.every((id) => core.unit("enemy", 0).skillIds.includes(id))).toBe(true);
  });

  it("an unknown encounter, or a mode that only shadows, plays the basic AI's pick", () => {
    expect(play(undefined).traces.every((t) => !t.fromV2 && t.committed === t.production)).toBe(
      true,
    );
    const shadow = play("LH-ENC-S01-R01-G00-B01-BUNNY", RUNTIME_MODES.SHADOW_V2).traces;
    expect(shadow.every((t) => !t.fromV2 && t.committed === t.production)).toBe(true);
  });

  it("is deterministic for one seed", () => {
    const a = play("LH-ENC-S01-R01-G00-B01-BUNNY", undefined, 3).core.events,
      b = play("LH-ENC-S01-R01-G00-B01-BUNNY", undefined, 3).core.events;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
