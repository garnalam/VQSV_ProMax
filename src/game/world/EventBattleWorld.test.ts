import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Pack images are 1x1 stand-ins under Node; this rig never reads pixels. */
vi.stubGlobal(
  "Image",
  class {
    complete = true;
    naturalWidth = 1;
    width = 1;
    height = 1;
    src = "";
  },
);
vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(
    import.meta.dirname,
    "../../../public",
    decodeURIComponent(String(input).split("?")[0].replace(/^\//, "")),
  );
  if (!existsSync(file)) return { ok: false, status: 404 };
  const bytes = readFileSync(file);
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(bytes.toString("utf8")),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
  };
});

const { Pack } = await import("../../pack/Pack");
const { loadBootAssets } = await import("../../pack/boot");
const { GameAssets } = await import("../story/GameAssets");
const { gameplaySources } = await import("../session/GameplayHost");
const { WorldRuntime } = await import("./WorldRuntime");
const { scene1Save } = await import("../../dev/parityCheckpoints");
const { SCENE1_RESUME } = await import("../../persistence/save/migrations");
const { worldGroupBattleActor } = await import("./WorldEventCatalog");
const { unsupportedEventBattle, doubleEventBattleSymbol, createEventBattle } =
  await import("../battle/EventBattle");
const { doubleBattleSetup } = await import("../battle/DoubleEventBattle");
const { createBondingTowerBattle } = await import("../battle/BondingTowerBattle");
const { BattleCommandError } = await import("../battle/engine/BattleTypes");
const { BATTLE_RESULT_LOST } = await import("../battle/BattleRuntime");
import type { SavedPet } from "../../persistence/save/GameSave";

type World = InstanceType<typeof WorldRuntime>;
type Battle = ReturnType<typeof toBattle>;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
const sources = gameplaySources(assets, boot).world;
const services = sources.battle!;
const contract = assets.worldContract;
const EVENT_STATE_COMPLETE = 3;
/**
 * The party the player actually walks into the challenge with. Bunny deliberately mimics an old
 * save with no skill vector; world normalization must rebuild it from the shared learnset.
 */
function party(): SavedPet[] {
  return [
    { speciesId: 68, level: 7, quality: 2, skillIds: learnset(68, 7, 2) },
    { speciesId: 34, level: 5, quality: 1, skillIds: [], skillPp: [] },
  ];
}
function learnset(speciesId: number, level: number, quality: number): number[] {
  return [...(services.encounterPet(speciesId, level, quality).skillIds ?? [])];
}

/**
 * The village with the elder's chain one link short of his challenge: the return dialog and the gated
 * link behind it are already in the ledger, so the next room-0 tick dispatches `1:0:6` itself.
 */
function elderWorld(pets: SavedPet[] = party()): World {
  const runtime = new WorldRuntime(
    contract,
    sources,
    scene1Save({
      location: { sceneId: 1, roomIndex: 1, x: 19, y: 273, direction: 3 },
      owner: SCENE1_RESUME.bunnyReturnRoom0,
      bunnyCaught: true,
      eventStates: { "1:1:0": 3, "1:0:2": 3, "1:0:3": 3 },
      pets,
    }),
  );
  for (let i = 0; i < 64 && runtime.mapLoading; i++) runtime.tickMapLoading();
  runtime.tick([]);
  expect(runtime.roomIndex).toBe(0);
  return runtime;
}
/** Play the group's records up to its op32, then sit through the entry splash into the fight. */
function toBattle(runtime: World) {
  for (let i = 0; i < 3000 && !runtime.battle; i++)
    runtime.tick(runtime.eventScene?.textReady ? ["confirm"] : []);
  const battle = runtime.battle;
  if (!battle) throw new Error(`the elder chain never opened its op32 battle (${runtime.phase})`);
  for (let i = 0; i < 30 && runtime.phase === "battleEntry"; i++) runtime.tick([]);
  expect(runtime.phase).toBe("battle");
  return battle;
}
/**
 * Press the highlighted choice every turn until the fight closes, holding the chosen side one hit
 * from the edge. The elder keeps his roster, his levels, his thiên phú, his brain and every one of
 * his turns, so the win still comes from the player's own attack landing. Whether a level-7 party
 * beats a quality-5 NPC under real play is the battle AI's own question, graded by the AI goldens;
 * this rig asks who closes the fight and what the event group does with the answer.
 */
function playOut(runtime: World, battle: Battle, margin: "win" | "lose"): void {
  for (let i = 0; i < 6000 && runtime.phase === "battle"; i++) {
    const unit = battle.core!.activeUnit(margin === "win" ? "enemy" : "player");
    if (unit.alive()) unit.setHp(1);
    runtime.tick(["confirm"]);
  }
  expect(runtime.phase).not.toBe("battle");
}
/** Let the records that follow the fight play to the end of the group. */
function finishEvent(runtime: World): void {
  for (let i = 0; i < 6000 && runtime.eventVisible; i++)
    runtime.tick(runtime.eventScene?.textReady ? ["confirm"] : []);
}

describe("Tháp Gắn Kết battle integration", () => {
  beforeEach(() => vi.spyOn(services, "seedSource").mockReturnValue(314));
  afterEach(() => vi.restoreAllMocks());

  function arenaWorld(pets: SavedPet[]): World {
    const runtime = new WorldRuntime(
      contract,
      sources,
      scene1Save({
        location: { sceneId: 1, roomIndex: 0, x: 200, y: 200, direction: 2 },
        owner: SCENE1_RESUME.bunnyReturnRoom0,
        bunnyCaught: true,
        pets,
      }),
    );
    for (let i = 0; i < 64 && runtime.mapLoading; i++) runtime.tickMapLoading();
    return runtime;
  }

  function floor(double: boolean) {
    return {
      floor: double ? 10 : 1,
      team: [68, 68],
      level: 5,
      quality: 1,
      double,
      factors: [1, 1, 1, 1] as [number, number, number, number],
      boss: double,
      theme: "test",
    };
  }

  const pets = {
    "68": {
      id: 68,
      name: "Thỏ Ngọc",
      role: "tank" as const,
      grants: [{ id: 40, level: 1, signature: false }],
    },
  };

  it("requires a living pet and two roster pets for doubles", () => {
    const fainted = arenaWorld([{ speciesId: 68, level: 7, quality: 2, currentHp: 0 }]);
    expect(fainted.startBondingTower(floor(false), pets, vi.fn())).toBe(false);
    const solo = arenaWorld([{ speciesId: 68, level: 7, quality: 2 }]);
    expect(solo.startBondingTower(floor(true), pets, vi.fn())).toBe(false);
  });

  it.each([false, true])("isolates the challenge and handles retreat (double: %s)", (double) => {
    const runtime = arenaWorld([
      { speciesId: 68, level: 7, quality: 2, currentHp: 2, skillIds: [40, 41], skillPp: [0, 1] },
      { speciesId: 34, level: 5, quality: 1, currentHp: 0 },
    ]);
    const before = runtime.snapshot();
    const onResult = vi.fn();
    expect(runtime.startBondingTower(floor(double), pets, onResult)).toBe(true);
    expect(runtime.startBondingTower(floor(double), pets, onResult)).toBe(false);
    const unit = double
      ? runtime.doubleBattle!.core.playerUnit(0)
      : runtime.battle!.core!.unit("player", 0);
    const second = double
      ? runtime.doubleBattle!.core.playerUnit(1)
      : runtime.battle!.core!.unit("player", 1);
    expect(unit.hp()).toBe(unit.maxHp());
    expect(second.hp()).toBe(second.maxHp());
    expect(unit.skillPp.slice(0, 2)).toEqual(services.progression.fullPp([40, 41]));
    expect(runtime.snapshot().pets).toEqual(before.pets);
    for (let i = 0; i < 240; i++) runtime.tick([]);
    const battle = (runtime.battle ?? runtime.doubleBattle)!;
    expect(battle.ui.mode).toBe("COMMAND");
    const click = (x: number) => battle.pointer(x, 305, runtime.inventory);
    for (const x of [56, 98, 176]) {
      click(x);
      expect(battle.ui.mode).toBe("WARNING");
      runtime.tick(["back"]);
    }
    click(218);
    let action;
    for (let i = 0; i < 300 && !onResult.mock.calls.length; i++) action = runtime.tick([]);
    expect(onResult.mock.calls).toEqual([[false]]);
    expect(action).toBe("autosave");
    const after = runtime.snapshot();
    expect(after.pets).toEqual(before.pets);
    expect(after.inventory).toEqual(before.inventory);
    expect(after.location).toEqual(before.location);
    expect(after.meta?.battlePass).toEqual(before.meta?.battlePass);
    expect(after.collection).toEqual(before.collection);
  });

  it.each([
    { double: false, won: true },
    { double: true, won: true },
    { double: false, won: false },
    { double: true, won: false },
  ])("reports knockouts once and skips story settlement (%o)", ({ double, won }) => {
    const members = Array.from({ length: double ? 2 : 1 }, () => ({
      speciesId: 68,
      level: won ? 70 : 5,
      quality: 2,
      currentHp: 2,
      skillIds: [40, 41],
      skillPp: [0, 1],
    }));
    const runtime = arenaWorld(members);
    const before = runtime.snapshot();
    const onResult = vi.fn();
    const arena = { ...floor(double), level: won ? 5 : 70 };
    expect(runtime.startBondingTower(arena, pets, onResult)).toBe(true);
    const core = runtime.battle?.core ?? runtime.doubleBattle!.core;
    let action;
    for (let i = 0; i < 6000 && !onResult.mock.calls.length; i++) {
      if (double) {
        const battle = runtime.doubleBattle!;
        for (const slot of won ? ([0, 1] as const) : ([2, 3] as const))
          if (battle.core.unit(slot).alive()) battle.core.unit(slot).setHp(1);
      } else {
        const battle = runtime.battle!;
        const unit = battle.core!.activeUnit(won ? "enemy" : "player");
        if (unit.alive()) unit.setHp(1);
      }
      action = runtime.tick(["confirm"]);
    }
    expect(onResult.mock.calls).toEqual([[won]]);
    expect(action).toBe("autosave");
    expect(core.events.some((event) => event.type === "experience")).toBe(false);
    expect(runtime.lastSettlement).toBeNull();
    const after = runtime.snapshot();
    expect(after.pets).toEqual(before.pets);
    expect(after.inventory).toEqual(before.inventory);
    expect(after.location).toEqual(before.location);
    expect(after.meta?.battlePass).toEqual(before.meta?.battlePass);
  });

  it("constructs all 200 shipped floors with playable rosters", () => {
    const tower = assets.bondingTower!;
    expect(tower.floors).toHaveLength(200);
    for (const floor of tower.floors) {
      const battle = createBondingTowerBattle(
        services,
        floor,
        tower.pets,
        party(),
        0,
        () => 8,
        undefined,
      );
      if (floor.double) {
        expect(battle.double?.core.spriteIds().length).toBeGreaterThanOrEqual(2);
        expect(battle.double?.core.setupOf(0).speciesId).toBe(floor.team[0]);
        expect(battle.double?.core.setupOf(1).speciesId).toBe(floor.team[1]);
        expect(battle.double?.core.unit(0).hp()).toBe(battle.double?.core.unit(0).maxHp());
      } else {
        const core = battle.single!.core!;
        expect(core.partySize("enemy")).toBe(floor.team.length);
        expect(core.enemySetup(0).speciesId).toBe(floor.team[0]);
        expect(core.unit("enemy", 0).hp()).toBe(core.unit("enemy", 0).maxHp());
      }
    }
  });

  it.each([false, true])("keeps boosted HP and stats above the short range (double: %s)", (double) => {
    const arena = { ...floor(double), floor: 200 };
    const scaled = { ...arena, factors: [1000, 1000, 1, 1] as typeof arena.factors };
    const getEnemy = (input: typeof arena) => {
      const battle = createBondingTowerBattle(services, input, pets, party(), 0, () => 8, undefined);
      return battle.double?.core.unit(0) ?? battle.single!.core!.unit("enemy", 0);
    };
    const normal = getEnemy(arena);
    const boosted = getEnemy(scaled);
    expect(boosted.maxHp()).toBe(normal.maxHp() * 1000);
    expect(boosted.currentStats.attack).toBe(normal.baseStats.attack * 1000);
    expect(boosted.hp()).toBeGreaterThan(32767);
    boosted.damage(10);
    expect(boosted.hp()).toBe(boosted.maxHp() - 10);
    boosted.heal(10);
    expect(boosted.hp()).toBe(boosted.maxHp());
  });
});

describe("the battle an event group opens with op32", () => {
  it("stores Lanni's Tuyết Cầu Bảo Bảo reward in Pet State and through save/reload", () => {
    const runtime = new WorldRuntime(
      contract,
      sources,
      scene1Save({
        location: { sceneId: 1, roomIndex: 2, x: 80, y: 150, direction: 2 },
        owner: SCENE1_RESUME.bunnyReturnRoom0,
        bunnyCaught: true,
        eventStates: { "1:2:3": EVENT_STATE_COMPLETE },
        pets: party(),
      }),
    );
    for (let i = 0; i < 64 && runtime.mapLoading; i++) runtime.tickMapLoading();
    for (let i = 0; i < 3000 && !runtime.pets.some((pet) => pet.speciesId === 48); i++)
      runtime.tick(runtime.eventScene?.textReady ? ["confirm"] : []);

    const snowball = runtime.pets.find((pet) => pet.speciesId === 48);
    expect(snowball).toMatchObject({ level: 5, quality: 2, nature: 0 });
    expect(runtime.snapshot().collection?.[48]).toBe(2);

    const restored = new WorldRuntime(contract, sources, runtime.snapshot());
    expect(restored.pets.find((pet) => pet.speciesId === 48)).toMatchObject({
      level: 5,
      quality: 2,
    });
  });

  it("creates every early owned pet from the unified database, not the scene's two-skill stub", () => {
    const fresh = new WorldRuntime(contract, sources);
    // `initialSkillIds` deals from the pet-design pool (Java: [40, 41] at level 5).
    expect(fresh.pets[0].skillIds).toEqual([40, 41]);

    const legacyCaught = new WorldRuntime(
      contract,
      sources,
      scene1Save({
        location: { sceneId: 1, roomIndex: 0, x: 200, y: 200, direction: 2 },
        owner: SCENE1_RESUME.bunnyReturnRoom0,
        bunnyCaught: true,
        pets: [{ speciesId: 68, level: 7, quality: 2, skillIds: [40, 45] }],
      }),
    );
    const snapshot = legacyCaught.snapshot(),
      bunny = snapshot.pets.find((pet) => pet.speciesId === 34)!;
    expect(bunny.skillIds).toEqual([20, 21]);
    expect(bunny.skillPp).toHaveLength(2);
  });

  it("creates the selected fire starter through op87 with Java's unified-v5 deck", () => {
    const runtime = new WorldRuntime(
      contract,
      sources,
      scene1Save({
        location: { sceneId: 1, roomIndex: 0, x: 200, y: 200, direction: 0 },
        owner: SCENE1_RESUME.bunnyReturnRoom0,
        bunnyCaught: true,
        eventStates: { "1:0:2": EVENT_STATE_COMPLETE },
        pets: [
          { speciesId: 68, level: 7, quality: 2, skillIds: [40, 85, 41, 43] },
          { speciesId: 34, level: 5, quality: 1, skillIds: [20, 85, 21, 22] },
        ],
      }),
    );
    for (let i = 0; i < 64 && runtime.mapLoading; i++) runtime.tickMapLoading();
    for (let i = 0; i < 500 && !runtime.pets.some((pet) => pet.speciesId === 6); i++) {
      const scene = runtime.eventScene;
      if (scene?.activationIds.includes(55)) {
        const dragon = runtime.actors.get(55)!;
        runtime.player.x = dragon.x;
        runtime.player.y = dragon.y + 20;
        runtime.player.direction = 0;
        runtime.tick(["confirm"]);
      } else runtime.tick(scene?.choice || scene?.textReady ? ["confirm"] : []);
    }
    const starter = runtime.pets.find((pet) => pet.speciesId === 6)!;
    expect(starter.slot).toBe(0);
    expect(starter.skillIds).toEqual([0, 1]);
    expect(starter.skillPp).toHaveLength(2);
  });

  it("repairs an old Bunny save with its level-five learnset and full PP", () => {
    const runtime = elderWorld(),
      bunny = runtime.pets.find((pet) => pet.speciesId === 34)!;
    expect(bunny.skillIds).toEqual([20, 21]);
    expect(bunny.skillIds).toEqual(learnset(34, 5, 1));
    expect(bunny.skillPp?.length).toBe(bunny.skillIds?.length);
  });

  it("fights the elder's own encounter on the world's battle screen", () => {
    const runtime = elderWorld(),
      battle = toBattle(runtime);
    expect(battle.context).toMatchObject({
      actorId: 52,
      encounter: [68, 5, 1],
      branchTargets: [10, 10, 0],
    });
    expect(runtime.battleGroup).toEqual({ scene: 1, room: 0, group: 6 });
    expect(battle.phase.key).toBe("NPC_VS_ENTRY");
    expect(battle.definition.entry).toMatchObject({
      playerCount: 2,
      enemyCount: 1,
    });
    // The enemy seat is the descriptor's own triple, at the level the A2 row projects.
    const enemy = battle.combatant("enemy");
    expect([enemy.speciesId, enemy.level]).toEqual([68, 5]);
    expect(runtime.opponentHp).toBe(enemy.maxHp);
    // The elder's own pet, so neither a ball nor a way out (op32 mode [0,2], npcEnemyEntry).
    expect(battle.core!.captureAllowed()).toBe(false);
    expect(battle.core!.runAllowed()).toBe(false);
    expect(() => battle.core!.submit({ kind: "run" })).toThrow(BattleCommandError);
    // The world parked on op32 rather than finishing the group: the ledger is still open.
    expect(runtime.eventState.sourceEventState(1, 0, 6)).not.toBe(EVENT_STATE_COMPLETE);
  });

  it("opens Java's complete db.mid battle-shop stock instead of an empty placeholder", () => {
    const runtime = elderWorld(),
      battle = toBattle(runtime);
    for (let i = 0; i < 60; i++) battle.tick();
    expect(battle.ui.mode).toBe("COMMAND");
    for (let i = 0; i < 4; i++) battle.handleInput(["right"], runtime.inventory);
    battle.handleInput(["confirm"], runtime.inventory);

    expect(battle.ui.mode).toBe("SHOP_BUY");
    expect(battle.ui.rows).toHaveLength(14);
    expect(battle.ui.rows[0]).toMatchObject({
      name: "Phong ấn cầu",
      value: "100",
      currency: 0,
      iconCell: 26,
    });
    expect(battle.ui.rows.some((row) => row.name === "Tất Trung Cầu")).toBe(false);
  });

  it("hovers a battle-shop row and buys through confirmation without closing the shop", () => {
    const runtime = elderWorld(),
      battle = toBattle(runtime);
    runtime.currency.money = 1_000;
    for (let i = 0; i < 60; i++) battle.tick();
    for (let i = 0; i < 4; i++) battle.handleInput(["right"], runtime.inventory);
    battle.handleInput(["confirm"], runtime.inventory);
    battle.hover(60, 121);
    expect(battle.ui.selectedIndex).toBe(1);
    expect(battle.ui.description).toBe(battle.ui.rows[1].description);
    const itemId = 2,
      before = battle.core!.bag()[itemId] ?? 0,
      price = Number(battle.ui.rows[1].value);
    battle.pointer(60, 121, runtime.inventory);
    expect([battle.interactiveStage, battle.ui.mode]).toEqual(["shop", "SHOP_CONFIRM"]);
    battle.pointer(70, 207, runtime.inventory);
    expect([battle.interactiveStage, battle.ui.mode]).toEqual(["shop", "SHOP_BUY"]);
    expect(battle.core!.bag()[itemId]).toBe(before + 1);
    expect(runtime.currency.money).toBe(1_000 - price);
  });

  it("keeps the battle shop open when the player cannot afford the selected item", () => {
    const runtime = elderWorld(),
      battle = toBattle(runtime);
    runtime.currency.money = 0;
    for (let i = 0; i < 60; i++) battle.tick();
    for (let i = 0; i < 4; i++) battle.handleInput(["right"], runtime.inventory);
    battle.handleInput(["confirm"], runtime.inventory);
    battle.pointer(55, 268, runtime.inventory);
    expect([battle.interactiveStage, battle.ui.mode, battle.ui.description]).toEqual([
      "shop",
      "SHOP_BUY",
      "Không đủ tiền.",
    ]);
  });

  it("pays the elder's win: the NPC reward, then the group's own op31 money; the foe is seen", () => {
    const runtime = elderWorld(),
      moneyBefore = runtime.currency.money,
      badgesBefore = runtime.currency.badges;
    const battle = toBattle(runtime);
    // `VqsvBattleRuntime` start: the enemy party is seen.
    expect(runtime.collection.seen(68)).toBe(true);
    playOut(runtime, battle, "win");
    // `NpcBattleRewardService` quotes the elder at 50.
    expect(runtime.currency.money - moneyBefore).toBe(50);
    finishEvent(runtime);
    // Scene 1's op31 [0, 0, 500]: "Đạt được: 500 kim tiền".
    expect(runtime.currency.money - moneyBefore).toBe(550);
    expect(runtime.currency.badges).toBe(badgesBefore);
    expect(runtime.snapshot().currency?.money).toBe(runtime.currency.money);
    expect(runtime.snapshot().collection?.[68]).toBe(2);
  });

  it("hands the win back to the group so its records pay out and its ledger closes", () => {
    const runtime = elderWorld(),
      itemsBefore = { ...runtime.inventory };
    const battle = toBattle(runtime);
    playOut(runtime, battle, "win");
    expect(battle.result).toBe(0);
    // op47 read result 0, so the group kept running instead of the world closing it.
    expect(runtime.phase).toBe("event");
    expect(runtime.battle).toBeNull();
    finishEvent(runtime);
    expect(runtime.eventState.sourceEventState(1, 0, 6)).toBe(EVENT_STATE_COMPLETE);
    expect(runtime.eventState.sourceEventState(1, 0, 4)).toBe(EVENT_STATE_COMPLETE);
    expect(runtime.eventState.sourceEventState(1, 0, 5)).toBe(EVENT_STATE_COMPLETE);
    expect(runtime.questState.mainTaskProgress).toBe(2);
    // The two op17 rows of the group, not a reward the port invented.
    expect(runtime.inventory["4"] - itemsBefore["4"]).toBe(10);
    expect(runtime.inventory["11"] - (itemsBefore["11"] ?? 0)).toBe(2);
    expect(runtime.takeBattleResult()).toEqual({ scene: 1, room: 0, group: 6, won: true });
    // No report screen on the hosted path: the group's own records are what the player sees next.
    expect(runtime.lastSettlement).not.toBeNull();
  });

  it("keeps the group open on a loss and heals the party the settlement revived", () => {
    const runtime = elderWorld(),
      battle = toBattle(runtime);
    // The fight is the player's own: lose it by handing the elder every hit.
    playOut(runtime, battle, "lose");
    expect(battle.result).toBe(BATTLE_RESULT_LOST);
    expect(runtime.phase).toBe("freeworld");
    expect(runtime.battleGroup).toBeNull();
    expect(runtime.eventState.sourceEventState(1, 0, 6)).not.toBe(EVENT_STATE_COMPLETE);
    expect(runtime.questState.mainTaskProgress).toBe(1);
    expect(runtime.takeBattleResult()).toEqual({ scene: 1, room: 0, group: 6, won: false });
    for (const pet of runtime.pets) expect(pet.currentHp).toBe(pet.maxHp);
  });
});

describe("the op32 probe over the harvested descriptors", () => {
  it("seats a 2v2 for a gym facing two living pets and for WS-2 with Harry's pets; nothing wins by talking", () => {
    const soldiers = { scene: 2, room: 0, group: 1 },
      soldiersActor = worldGroupBattleActor(sources.registry, soldiers),
      ordinary = contract.battleGroup,
      ordinaryActor = worldGroupBattleActor(sources.registry, ordinary);
    expect(soldiersActor).not.toBeNull();
    expect(ordinaryActor).not.toBeNull();
    // Bích Thủy WS-2: the player commands slot 2 alone, Harry's lent pets hold slot 3 (COMPANION AI).
    // One living pet is enough, unlike a gym (`playerPairAvailable` asks two only of a gym).
    const [only] = party(),
      ws2 = doubleEventBattleSymbol(services, soldiers, soldiersActor!, [only]);
    expect(ws2).toBe("SCENE2_ROOM0_GROUP1_SOLDIERS");
    const ws2Setup = doubleBattleSetup(services, ws2!, [only]);
    expect(ws2Setup.controlsBoth).toBe(false);
    expect(ws2Setup.player.length).toBe(1);
    expect(ws2Setup.companion.length).toBeGreaterThanOrEqual(1);
    expect(ws2Setup.enemy.length).toBeGreaterThanOrEqual(2);
    expect(unsupportedEventBattle(services, soldiers, soldiersActor!)).toBeNull();
    expect(doubleEventBattleSymbol(services, ordinary, ordinaryActor!, party())).toBeNull();
    let gyms = 0;
    for (const room of sources.registry.document.scenes.find((s) => s.sceneId === 9)?.rooms ?? [])
      for (const group of room.eventGroups) {
        const ref = { scene: 9, room: room.roomIndex, group: group.group_index },
          actor = worldGroupBattleActor(sources.registry, ref);
        if (actor === null) continue;
        const symbol = doubleEventBattleSymbol(services, ref, actor, party());
        if (!symbol) continue;
        gyms++;
        // One living pet: Java's gym request falls back to the decoded source roster (1v1).
        const [lead, second] = party();
        expect(
          doubleEventBattleSymbol(services, ref, actor, [lead, { ...second, currentHp: 0 }]),
        ).toBeNull();
        const setup = doubleBattleSetup(services, symbol, party());
        expect(setup.controlsBoth).toBe(true);
        expect(setup.enemy.length).toBeGreaterThanOrEqual(2);
      }
    // `encounters.tsv`: 22 GYM_TRAINER + 6 GYM_LEADER simultaneous 2v2 fights, all in scene 9.
    expect(gyms).toBe(28);
  });

  it("names the actor every battle group's op67 declares", () => {
    const registry = sources.registry;
    let battleGroups = 0;
    for (const scene of registry.document.scenes) {
      if (scene.sceneId === null) continue;
      for (const room of scene.rooms)
        for (const group of room.eventGroups) {
          const actor = worldGroupBattleActor(registry, {
            scene: scene.sceneId,
            room: room.roomIndex,
            group: group.group_index,
          });
          if (actor === null) continue;
          battleGroups++;
          expect(actor).toBeGreaterThanOrEqual(-1);
        }
    }
    expect(battleGroups).toBeGreaterThan(0);
  });

  it("gives a fight with no op67 to the actor the group is activated on (worldEventActor)", () => {
    const registry = sources.registry,
      george = { scene: 5, room: 4, group: 0 },
      branchFight = { scene: 4, room: 5, group: 6 };
    expect(worldGroupBattleActor(registry, george)).toBe(25);
    expect(unsupportedEventBattle(services, george, 25)).toBeNull();
    // An op43 branch head names its NPC in the fifth short.
    expect(worldGroupBattleActor(registry, branchFight)).toBe(29);
    for (const scene of registry.document.scenes) {
      if (scene.sceneId === null) continue;
      for (const room of scene.rooms)
        for (const group of room.eventGroups) {
          const ref = { scene: scene.sceneId, room: room.roomIndex, group: group.group_index };
          if (group.records.some((record) => record.opcode === 16))
            expect(worldGroupBattleActor(registry, ref), JSON.stringify(ref)).not.toBe(-1);
        }
    }
  });

  it("builds a runtime for every fight the world is able to run", () => {
    const registry = sources.registry;
    let simultaneous = 0,
      built = 0;
    for (const scene of registry.document.scenes) {
      if (scene.sceneId === null) continue;
      for (const room of scene.rooms)
        for (const group of room.eventGroups) {
          const ref = { scene: scene.sceneId, room: room.roomIndex, group: group.group_index },
            actorId = worldGroupBattleActor(registry, ref);
          if (actorId === null) continue;
          if (doubleEventBattleSymbol(services, ref, actorId, party())) {
            // A gym 2v2 runs on the 2v2 engine (checked above).
            simultaneous++;
            continue;
          }
          const why = unsupportedEventBattle(services, ref, actorId);
          if (why) {
            // A fight whose descriptor row was never harvested is a gap in the catalog; it is named,
            // so another kind of refusal cannot hide among them.
            if (!/has no battle record for actor|lacks an A2 encounter identity/.test(why))
              throw new Error(
                `unexpected refusal for ${ref.scene}:${ref.room}:${ref.group}: ${why}`,
              );
            continue;
          }
          const battle = createEventBattle(
            services,
            ref,
            { actorId, encounter: [0, 0, 0], flags: [0, 0], mode: [0, 0], branchTargets: [] },
            party(),
            {},
            contract.itemCatalog,
          );
          expect(battle.core).toBeDefined();
          if (built === 0) {
            const eventBattle = battle as unknown as {
              openItems(inventory: Record<string, number>, kind: "recovery"): void;
            };
            eventBattle.openItems({ "4": 5 }, "recovery");
            expect(battle.ui.rows[0]).toMatchObject({
              name: "Bánh Sandwich",
              iconCell: 29,
              value: "5",
            });
          }
          built++;
        }
    }
    expect(built).toBeGreaterThan(0);
    expect(simultaneous).toBeGreaterThan(0);
  });
});
