import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { BattleSetup, CombatantSetup } from "./BattleTypes";
import type { DoubleBattleSetup } from "./DoubleBattleTypes";

vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(
    import.meta.dirname,
    "../../../../public",
    String(input).split("?")[0].replace(/^\//, ""),
  );
  return existsSync(file)
    ? { ok: true, json: async () => JSON.parse(readFileSync(file, "utf8")) }
    : { ok: false, status: 404 };
});
const { GameData } = await import("../../../data/GameData");
const { Pack } = await import("../../../pack/Pack");
const { loadBattleRules } = await import("../BattleRules");
const { BattleRandom } = await import("../BattleRandom");
const { BattleItems } = await import("./BattleItems");
const { BattleCore } = await import("./BattleCore");
const { BasicEnemyAi } = await import("./EnemyController");
const { DoubleBattleCore } = await import("./DoubleBattleCore");
const { DoubleBattleRuntime } = await import("../DoubleBattleRuntime");
const { BattleAiRulebook } = await import("../ai/BattleAiRulebook");
const { BattleAiEncounterCatalog } = await import("../ai/BattleAiEncounterCatalog");
const { BattleServices } = await import("./BattleServices");
const { PetStatCalculator } = await import("../PetStatCalculator");
const { createSourceTrainerBattle } = await import("../EventBattle");
const data = new GameData(await Pack.load());
const rules = await loadBattleRules(data);
const items = new BattleItems(await data.items());
const rulebook = await BattleAiRulebook.load(data);
const catalog = await BattleAiEncounterCatalog.load(data);
const profile = { ...(await data.aiProfileForTier("TRAINER")), itemBudget: 0 };
const companionProfile = await data.aiProfileForTier("COMPANION");
const services = await BattleServices.load(data, rules, await PetStatCalculator.load(data));
const skillRules = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../../public/pack/double-battle/skill-scopes.json"),
    "utf8",
  ),
);
const pet = (extra: Partial<CombatantSetup> = {}): CombatantSetup => ({
  speciesId: 68,
  level: 10,
  quality: 2,
  nature: 2,
  stats: { hp: 300, attack: 1, defense: 300, speed: 50 },
  skillIds: [30, 31],
  skillPp: [0, 0],
  ...extra,
});
type Context = { sceneId?: number; capturePolicy?: string; pvp?: boolean };
function single(extra: Partial<BattleSetup> & Context = {}) {
  const core = new BattleCore(
    rules,
    { items, relationClass: () => 0 },
    {
      format: "1v1",
      kind: "trainer",
      sceneId: 98,
      capturePolicy: "TRAINER_OWNED_FORBIDDEN",
      player: [pet({ hp: 10 })],
      enemy: [pet({ hp: 10 })],
      inventory: { 4: 1, 6: 1, 8: 1, 11: 1 },
      ...extra,
    } as BattleSetup,
    new BattleRandom(123n),
    new BasicEnemyAi(rules),
  );
  core.start();
  return core;
}
const ppMax = (id: number) => rules.damage.skillRow(id)!.ppMax;

describe("native battle recovery items", () => {
  it.each([
    [6, 25],
    [7, 45],
    [8, 20],
    [9, 45],
    [11, 20],
    [12, 45],
  ])("item %i restores flat %i PP to every equipped skill", (id, amount) => {
    const core = single();
    const unit = core.unit("player", 0);
    unit.skillIds.splice(0, unit.skillIds.length, 30, 31, -1);
    unit.skillPp.splice(0, unit.skillPp.length, 0, 2, 7);
    if (id >= 11) unit.setHp(0);
    const item = items.get(id)!;
    if (item.kind !== "recovery") throw new Error("recovery expected");
    items.apply(
      item,
      unit,
      undefined,
      () => 100,
      (n) => n,
      rules.status,
    );
    expect(unit.skillPp).toEqual([amount, 2 + amount, 7]);
  });

  it("accepts a PP item without a slot when any equipped skill needs PP", () => {
    const unit = single().unit("player", 0);
    expect(items.refusal(items.get(6)!, unit, undefined, ppMax)).toBeUndefined();
  });

  it.each([8, 11])("item %i restores source HP percent plus flat amount", (id) => {
    const unit = single().unit("player", 0);
    unit.setHp(id === 11 ? 0 : 10);
    const item = items.get(id)!;
    if (item.kind !== "recovery") throw new Error("recovery expected");
    items.apply(item, unit, undefined, ppMax, (n) => n, rules.status);
    expect(unit.hp()).toBe(id === 11 ? 200 : 210);
  });
});

describe("Cầu Vồng player-item recovery", () => {
  it("the source trainer factory preserves scene ownership through the runtime", () => {
    const request = {
      label: "Cầu Vồng recovery",
      sceneId: 98,
      members: [[68, 10, 2] as const],
      quality: 2,
    };
    const battle = createSourceTrainerBattle(
      services,
      request,
      [{ speciesId: 68, level: 10, quality: 2, nature: 2, currentHp: 1 }],
      { "4": 1 },
    );
    const core = battle.core!;
    core.activeUnit("enemy").setHp(1);
    const events = core.submit({ kind: "item", itemId: 4 });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item",
        seat: { side: "enemy", member: 0 },
        hpGained: expect.any(Number),
      }),
    );
    expect(core.activeUnit("enemy").hp()).toBeGreaterThan(1);
  });
  it("mirrors recovery to the active enemy and consumes only the player's item", () => {
    const core = single();
    const events = core.submit({ kind: "item", itemId: 4 });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "item", seat: { side: "enemy", member: 0 }, hpGained: 200 }),
    );
    expect(core.bag()[4]).toBe(0);
  });

  it("has no PP to restore on a full-HP NPC pet, whose PP never runs out (ProMax)", () => {
    const core = single({ enemy: [pet()] });
    const events = core.submit({ kind: "item", itemId: 8 });
    // The fight refills the NPC's PP itself, so the mirrored PP item finds nothing missing.
    expect(
      events.some((e) => e.type === "item" && e.seat.side === "enemy" && (e.ppGained ?? 0) > 0),
    ).toBe(false);
    const enemy = core.unit("enemy", 0);
    expect(enemy.skillIds.every((id, slot) => id < 0 || enemy.skillPp[slot] > 0)).toBe(true);
  });

  it.each([{ sceneId: 97 }, { capturePolicy: "WILD_ALLOWED" }, { pvp: true }])(
    "excludes context %j",
    (context) => {
      const core = single(context);
      core.submit({ kind: "item", itemId: 4 });
      expect(core.unit("enemy", 0).hp()).toBe(10);
    },
  );

  it("prefers any eligible active enemy over a weaker reserve", () => {
    const core = single({ enemy: [pet({ hp: 290 }), pet({ hp: 1 })] });
    core.submit({ kind: "item", itemId: 4 });
    expect([core.unit("enemy", 0).hp(), core.unit("enemy", 1).hp()]).toEqual([300, 1]);
  });

  it("falls back to the living reserve with the lowest HP fraction", () => {
    const core = single({
      enemy: [
        pet(),
        pet({ hp: 100 }),
        pet({ hp: 150, stats: { hp: 600, attack: 1, defense: 300, speed: 50 } }),
        pet({ hp: 0 }),
      ],
    });
    core.submit({ kind: "item", itemId: 4 });
    expect([
      core.unit("enemy", 1).hp(),
      core.unit("enemy", 2).hp(),
      core.unit("enemy", 3).hp(),
    ]).toEqual([100, 500, 0]);
  });

  it("a revive item heals a living enemy without reviving a fallen reserve", () => {
    const core = single({
      player: [pet(), pet({ hp: 0 })],
      enemy: [pet({ hp: 20 }), pet({ hp: 0 })],
    });
    core.submit({ kind: "item", itemId: 11, member: 1 });
    expect([core.unit("enemy", 0).hp(), core.unit("enemy", 1).hp()]).toEqual([220, 0]);
  });

  it("2v2 picks the weakest active HP fraction before reserves", () => {
    const core = new DoubleBattleCore(
      rules,
      { items, skillRules, rulebook, catalog },
      {
        controlsBoth: true,
        sceneId: 98,
        capturePolicy: "TRAINER_OWNED_FORBIDDEN",
        player: [pet({ hp: 10 }), pet({ skillPp: [20, 20] })],
        companion: [],
        enemy: [pet({ hp: 150 }), pet({ hp: 100 }), pet({ hp: 1 })],
        inventory: { 4: 1 },
        enemyProfile: profile,
        companionProfile,
      } as DoubleBattleSetup,
      new BattleRandom(123n),
    );
    core.start();
    core.submit({ kind: "item", itemId: 4, member: 0 });
    const events = core.submit({ kind: "skill", skillIndex: 0, target: 0 });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "item", target: 1, hpGained: 200 }),
    );
    expect(core.bag()[4]).toBe(0);
  });

  it("2v2 PP items find no PP missing on NPC pets, whose PP never runs out (ProMax)", () => {
    const core = new DoubleBattleCore(
      rules,
      { items, skillRules, rulebook, catalog },
      {
        controlsBoth: true,
        sceneId: 98,
        capturePolicy: "TRAINER_OWNED_FORBIDDEN",
        player: [
          pet({ stats: { hp: 300, attack: 1, defense: 300, speed: 500 } }),
          pet({ skillPp: [20, 20] }),
        ],
        companion: [],
        enemy: [pet({ skillIds: [30], skillPp: [10] }), pet({ skillPp: [0, 12] })],
        inventory: { 6: 1 },
        enemyProfile: profile,
        companionProfile,
      } as DoubleBattleSetup,
      new BattleRandom(123n),
    );
    core.start();
    core.submit({ kind: "item", itemId: 6, member: 0 });
    const events = core.submit({ kind: "skill", skillIndex: 0, target: 0 });
    expect(
      events.some(
        (e) => e.type === "item" && (e.target ?? -1) >= 0 && e.target! < 2 && (e.ppGained ?? 0) > 0,
      ),
    ).toBe(false);
    for (const slot of [0, 1] as const) {
      const enemy = core.unit(slot);
      expect(enemy.skillIds.every((id, i) => id < 0 || enemy.skillPp[i] > 0)).toBe(true);
    }
  });

  it("2v2 falls back to a living reserve and names its free recovery", () => {
    const core = new DoubleBattleCore(
      rules,
      { items, skillRules, rulebook, catalog },
      {
        controlsBoth: true,
        sceneId: 98,
        capturePolicy: "TRAINER_OWNED_FORBIDDEN",
        player: [pet({ hp: 10 }), pet({ skillPp: [20, 20] })],
        companion: [],
        enemy: [pet(), pet(), pet({ hp: 100 }), pet({ hp: 0 })],
        inventory: { 4: 1 },
        enemyProfile: profile,
        companionProfile,
      },
      new BattleRandom(123n),
    );
    const runtime = new DoubleBattleRuntime(core, rules, {
      items,
      itemInfo: () => undefined,
      speciesName: () => "Pet đối thủ",
      speciesElement: () => 0,
      fallTicks: () => 1,
    });
    for (let tick = 0; tick < 200 && runtime.stage !== "command"; tick++) runtime.tick();
    runtime.handleInput(["right"]);
    runtime.handleInput(["right"]);
    runtime.handleInput(["confirm"]);
    runtime.handleInput(["confirm"]);
    runtime.handleInput(["confirm"]);
    runtime.handleInput(["confirm"]);
    runtime.handleInput(["confirm"]);
    runtime.handleInput(["confirm"]);
    const logs = new Set<string>();
    for (let tick = 0; tick < 200; tick++) {
      runtime.tick();
      logs.add(runtime.log);
    }
    expect(logs).toContain("Đối phương hồi 200 HP cho Pet đối thủ.");
    expect(core.events).toContainEqual(
      expect.objectContaining({
        type: "item",
        target: -1,
        hpGained: 200,
        revived: false,
        cauVongRecovery: { speciesId: 68 },
      }),
    );
    expect(core.bag()[4]).toBe(0);
  });
});
