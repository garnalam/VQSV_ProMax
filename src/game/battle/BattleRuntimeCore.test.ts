import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { InputCommand } from "../../core/input/GameCommand";

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
const { BattleDefinitionRegistry, createCaptureTutorialBattleDefinition } =
  await import("./BattleDefinition");
const { BATTLE_RESULT_LOST, BattleRuntime } = await import("./BattleRuntime");
const { BattleServices } = await import("./engine/BattleServices");
const { settleBattle } = await import("./engine/BattleSettlement");
const { ENCOUNTER_NATURE_FALLBACK } = await import("./engine/BattleTypes");
const { requiredExp } = await import("./engine/PetProgression");
const { ITEM_LIST, PET_STATE, SKILL_LIST } = await import("./BattleListLayout");
type SavedPet = import("../../persistence/save/GameSave").SavedPet;
type WorldContract = import("../story/GameAssets").WorldContract;
type Runtime = InstanceType<typeof BattleRuntime>;

const contract = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../public/pack/story/world-contract.json"),
    "utf8",
  ),
) as WorldContract;
const data = new GameData(await Pack.load());
const rules = await loadBattleRules(data, { traitScripts: false }); // golden: đặc tính cũ, không kit
const petStats = await PetStatCalculator.load(data);
const services = await BattleServices.load(data, rules, petStats);
services.seedSource = () => 3;

const pet = (speciesId: number, level: number, quality: number, hp?: number): SavedPet => {
  const stats = petStats.coreStats(speciesId, level, quality),
    skillIds =
      speciesId === contract.player.id
        ? contract.player.skills!.map((skill) => skill.id)
        : services.progression.defaultSkills(speciesId, level);
  return {
    speciesId,
    level,
    quality,
    currentHp: hp ?? stats.hp,
    maxHp: stats.hp,
    experience: 0,
    skillIds,
    skillPp: skillIds.map((id) => rules.damage.skillRow(id)!.ppMax),
  };
};

/** The Scene 1 bunny on the core, the way `WorldRuntime.createCoreBattle` builds it. */
function bunnyFight(
  party: SavedPet[],
  unkillable = true,
  inventory: Record<string, number> = {},
  bag: Record<number, number> = { 0: 1, 1: 2, 4: 5 },
  tutorial = true,
  forcedCatch: (attempt: number) => boolean | undefined = (attempt) =>
    attempt === 1 ? false : undefined,
  bank?: { pets: SavedPet[]; capacity: number },
): Runtime {
  const opponent = contract.opponent,
    core = services.newCore(
      {
        format: "1v1",
        kind: "wild",
        player: party.map((member) => services.partyMember(member)),
        enemy: [
          services.encounterPet(
            opponent.id,
            opponent.level,
            opponent.quality,
            opponent.nature ?? ENCOUNTER_NATURE_FALLBACK,
            {
              name: opponent.name,
              spriteId: opponent.spriteId,
              element: opponent.element,
            },
          ),
        ],
        inventory: bag,
        script: {
          unkillable: unkillable ? "enemy" : undefined,
          forcedCatch,
        },
      },
      contract.encounter.descriptor,
    ),
    authored = createCaptureTutorialBattleDefinition(contract, party[0], {
      player: petStats.coreStats(party[0].speciesId, party[0].level, party[0].quality),
      opponent: petStats.coreStats(opponent.id, opponent.level, opponent.quality),
    }),
    definition = tutorial
      ? authored
      : (({ tutorial: _tutorial, ...ordinary }) => ordinary)(authored);
  return new BattleRuntime(
    {
      actorId: contract.encounter.actorId,
      encounter: contract.encounter.request,
      flags: contract.encounter.flags,
      mode: contract.encounter.mode,
      branchTargets: contract.encounter.branchTargets,
    },
    new BattleDefinitionRegistry([definition]),
    rules,
    undefined,
    contract.player.skills ?? [],
    contract.itemCatalog ?? [],
    {
      core,
      party,
      services,
      settle: () => settleBattle(core, party, inventory, services.progression, bank),
    },
  );
}

const press = (battle: Runtime, ...commands: InputCommand[]) => battle.handleInput(commands, {});

/** Tick until `done`, confirming every message box on the way; the stages seen, in order. */
function playUntil(battle: Runtime, done: (battle: Runtime) => boolean, limit = 2000): string[] {
  const seen: string[] = [];
  for (let tick = 0; tick < limit && !done(battle); tick++) {
    if (seen[seen.length - 1] !== battle.interactiveStage) seen.push(battle.interactiveStage);
    if (battle.interactiveStage === "warning") press(battle, "confirm");
    battle.tick();
  }
  if (!done(battle)) throw new Error(`stuck on ${battle.interactiveStage}`);
  return seen;
}
const atMenu = (battle: Runtime) =>
  battle.complete || ["fight", "weak", "petList", "sealFail"].includes(battle.interactiveStage);

/** The command bar's entry `index`, opened. */
function menu(battle: Runtime, index: number): void {
  battle.ui.selectedIndex = index;
  press(battle, "confirm");
}

/** Open Bắt được and throw the first ball in the bag. */
function throwBall(battle: Runtime): void {
  menu(battle, 1);
  expect(battle.catchListOpen).toBe(true);
  press(battle, "confirm");
}

/** The message boxes shown until `done`, confirming each. */
function messagesUntil(battle: Runtime, done: (battle: Runtime) => boolean): string[] {
  const said: string[] = [];
  for (let tick = 0; tick < 2000 && !done(battle); tick++) {
    if (battle.interactiveStage === "warning") {
      said.push(battle.ui.message);
      press(battle, "confirm");
    }
    battle.tick();
  }
  return said;
}

describe("the capture ball in an ordinary fight (VqsvBattleRuntime P17)", () => {
  const spec = services.captureAnimation,
    [throwTicks, , shakeTicks, holdTicks] = spec.durations,
    [shrinkTicks, restoreTicks] = spec.effectDurations;

  it("flies, swallows the pet and lets it out on a miss, then says so before the enemy acts", () => {
    const battle = bunnyFight([pet(68, 7, 2)], false, {}, undefined, false, () => false);
    throwBall(battle);
    // The ball is on screen for the whole miss: throw, shrink, shake, spring back.
    const frames: string[] = [];
    while (battle.interactiveStage === "captureFail") {
      const shown = battle.captureVisual;
      expect(shown?.spriteId).toBe(spec.spriteId);
      frames.push(shown!.phase);
      battle.tick();
    }
    expect(frames.length).toBe(throwTicks + shrinkTicks + shakeTicks + restoreTicks);
    expect(frames[0]).toBe("throw");
    expect(new Set(frames)).toEqual(new Set(["throw", "capture"]));
    expect(battle.interactiveStage).toBe("warning");
    expect(battle.ui.message).toBe("Đáng tiếc đã bắt trượt");
    expect(battle.core!.activeUnit("enemy").alive()).toBe(true);
  });

  it("holds the ball on the ground on a catch and names the pet before the fight closes", () => {
    const party = [pet(68, 7, 2)],
      battle = bunnyFight(party, false, {}, undefined, false, () => true);
    throwBall(battle);
    let ticks = 0;
    while (battle.interactiveStage === "captureSuccess") {
      expect(battle.captureVisual?.spriteId).toBe(spec.spriteId);
      ticks++;
      battle.tick();
    }
    expect(ticks).toBe(throwTicks + shrinkTicks + shakeTicks + holdTicks);
    const said = messagesUntil(battle, (b) => b.complete);
    expect(said[0]).toBe(`Bắt thành công ${contract.opponent.name}`);
    expect(party.map((member) => member.speciesId)).toEqual([68, contract.opponent.id]);
  });

  it("sends a seventh pet to the bank, and lets it go when the bank is full too", () => {
    for (const [capacity, storage, notice] of [
      [10, "BANK", "Sủng vật ba lô đã đủ, đã để vào ngân hàng"],
      [0, "RELEASE", "Không còn không gian, sủng vật này đã phóng sinh"],
    ] as const) {
      const party = Array.from({ length: 6 }, () => pet(68, 7, 2)),
        bank = { pets: [] as SavedPet[], capacity },
        battle = bunnyFight(party, false, {}, undefined, false, () => true, bank);
      throwBall(battle);
      const said = messagesUntil(battle, (b) => b.complete);
      expect(battle.settlement?.caught?.storage).toBe(storage);
      expect(said).toContain(notice);
      expect(party).toHaveLength(6);
      expect(bank.pets.map((member) => [member.speciesId, member.slot])).toEqual(
        storage === "BANK" ? [[contract.opponent.id, 0]] : [],
      );
    }
  });
});

describe("BattleRuntime on the battle core", () => {
  it("shows the state-1 L while Lôi Kỳ Lân lunges (tickP7LEffect)", () => {
    const battle = bunnyFight([pet(75, 9, 2)]);
    menu(battle, 0);
    press(battle, "confirm");
    expect(battle.interactiveStage).toBe("skillAction");
    const shown: string[] = [];
    for (let tick = 0; tick < 200 && battle.interactiveStage === "skillAction"; tick++) {
      battle.tick();
      const l = battle.stateOneLEffect;
      if (l) shown.push(`${l.side}:${l.entry.speffect}:${l.frame}`);
    }
    expect(shown.slice(0, 3)).toEqual(["player:20:0", "player:20:1", "player:20:2"]);
  });

  it("plays the bunny's own turn and the player's, on the player's bar", () => {
    const battle = bunnyFight([pet(68, 7, 2)]),
      playerMax = battle.combatant("player").maxHp;
    expect(battle.combatant("enemy").name).toBe(contract.opponent.name);
    menu(battle, 0);
    expect(battle.interactiveStage).toBe("skillList");
    press(battle, "confirm");
    expect(battle.interactiveStage).toBe("skillAction");
    const casters: string[] = [];
    for (let tick = 0; tick < 500 && !atMenu(battle); tick++) {
      if (battle.interactiveStage === "skillAction" && battle.activeMarkerSide !== casters.at(-1))
        casters.push(battle.activeMarkerSide);
      if (battle.interactiveStage === "warning") press(battle, "confirm");
      battle.tick();
    }
    // The bunny's Java deck ([20, 21]) holds 21, a DEFENSIVE-priority skill, so it may move first.
    expect([...casters].sort()).toEqual(["enemy", "player"]);
    expect(battle.hp("enemy")).toBeLessThan(battle.combatant("enemy").maxHp);
    expect(battle.hp("player")).toBeLessThan(playerMax);
    // The bars end on the units: nothing the screen walked is left behind.
    expect(battle.hp("player")).toBe(battle.core!.activeUnit("player").hp());
    expect(battle.hp("enemy")).toBe(battle.core!.activeUnit("enemy").hp());
  });

  it("keeps the tutorial's catch lesson: the Phong ấn cầu misses, the Tất Trung Cầu lands", () => {
    const party = [pet(68, 7, 2)],
      inventory: Record<string, number> = { "0": 1, "1": 2, "4": 5 },
      battle = bunnyFight(party, true, inventory);
    while (battle.interactiveStage !== "weak") {
      menu(battle, 0);
      press(battle, "confirm");
      playUntil(battle, atMenu);
    }
    expect(battle.core!.activeUnit("enemy").alive()).toBe(true);
    press(battle, "confirm");
    expect(battle.interactiveStage).toBe("sealList");
    press(battle, "confirm");
    expect(playUntil(battle, atMenu)).toContain("captureFail");
    expect(battle.interactiveStage).toBe("sealFail");
    press(battle, "confirm");
    press(battle, "confirm");
    expect(battle.interactiveStage).toBe("guaranteedList");
    press(battle, "confirm");
    expect(playUntil(battle, (b) => b.complete)).toContain("captureSuccess");
    expect(battle.result).toBe(0);
    expect(battle.outcome).toMatchObject({ winner: "player", reason: "catch" });

    // The runtime settled the fight as its end played.
    const report = battle.settlement!;
    expect(report.caught?.storage).toBe("ROSTER");
    // The caught pet keeps the thiên phú this fight rolled for the enemy, the way Java persists it.
    expect(report.caught!.pet.physicalTraitId).toBe(battle.core!.enemySetup(0).physicalTraitId);
    expect(report.caught!.pet.physicalTraitId).toBeGreaterThanOrEqual(0);
    // Its two axes come out as the two fields they are, not one number written twice.
    expect(report.caught!.pet.quality).toBe(battle.core!.enemySetup(0).quality);
    expect(report.caught!.pet.nature).toBe(battle.core!.enemySetup(0).nature);
    expect(party.map((member) => member.speciesId)).toEqual([68, contract.opponent.id]);
    expect(inventory).toMatchObject({ "0": 0, "1": 1 });
    expect(party[0].currentHp).toBe(battle.core!.unit("player", 0).hp());
  });

  it("recalls the active pet and sends the chosen one out, and the seat shows it", () => {
    const battle = bunnyFight([pet(68, 7, 2), pet(30, 6, 2)]),
      first = battle.combatant("player");
    menu(battle, 3);
    expect(battle.interactiveStage).toBe("petList");
    expect(battle.ui.rows).toHaveLength(2);
    expect(battle.ui.rows[0].enabled).toBe(false);
    battle.ui.selectedIndex = 1;
    press(battle, "confirm");
    // The recall: the old pet slides back out along its seat's cpos row, then the newcomer holds
    // off-stage and slides in (Java's P15), and only then is the switch told.
    expect(battle.interactiveStage).toBe("switching");
    const slide: { x: number; species: number }[] = [];
    while (battle.interactiveStage === "switching") {
      slide.push({ x: battle.offset("player").x, species: battle.combatant("player").speciesId });
      battle.tick();
    }
    const swap = slide.findIndex((frame) => frame.species === 30);
    expect(swap).toBeGreaterThan(0);
    expect(slide.slice(0, swap).every((frame) => frame.species === 68)).toBe(true);
    expect(slide[swap - 1].x).toBeLessThan(slide[0].x);
    expect(slide[swap].x).toBeLessThan(-200);
    expect(slide.at(-1)!.x).toBeGreaterThan(slide[swap].x);
    expect(battle.offset("player")).toEqual({ x: 0, y: 0 });
    expect(battle.interactiveStage).toBe("warning");
    expect(battle.ui.message).toBe("Đã thay đổi sủng vật: " + battle.combatant("player").name);
    const second = battle.combatant("player");
    expect(second.speciesId).toBe(30);
    expect(second.spriteId).not.toBe(first.spriteId);
    // The bar shows the pet as it walks in, before the bunny's answer lands on it.
    expect(battle.hp("player")).toBe(second.maxHp);
    playUntil(battle, atMenu);
    expect(battle.core!.activeMember("player")).toBe(1);
  });

  it("asks for a replacement when the active pet falls, and the bar follows the new pet", () => {
    const battle = bunnyFight([pet(68, 7, 2, 1), pet(30, 6, 2)]);
    menu(battle, 0);
    press(battle, "confirm");
    const seen = playUntil(battle, atMenu);
    expect(seen).toContain("warning");
    expect(battle.interactiveStage).toBe("petList");
    expect(battle.core!.request.kind).toBe("replacement");
    press(battle, "back");
    expect(battle.interactiveStage).toBe("petList");
    battle.ui.selectedIndex = 1;
    press(battle, "confirm");
    playUntil(battle, atMenu);
    expect(battle.combatant("player").speciesId).toBe(30);
    expect(battle.core!.request.kind).toBe("command");
  });

  it("loses when the last pet falls, and the settlement restores the whole party", () => {
    const party = [pet(68, 7, 2, 1)],
      battle = bunnyFight(party);
    menu(battle, 0);
    press(battle, "confirm");
    expect(battle.faintTick("player")).toBe(-1);
    for (let tick = 0; tick < 200 && !/đã gục/.test(battle.ui.message); tick++) battle.tick();
    // The fallen pet leaves its seat and plays its fall from the beat that knocked it out.
    expect(battle.hidden("player")).toBe(true);
    expect(battle.faintTick("player")).toBe(0);
    battle.tick();
    expect(battle.faintTick("player")).toBe(1);
    expect(battle.faintTick("enemy")).toBe(-1);
    playUntil(battle, (b) => b.complete);
    expect(battle.result).toBe(BATTLE_RESULT_LOST);
    const report = battle.settlement!;
    expect(report.restoredAfterLoss).toBe(true);
    expect(party[0].currentHp).toBe(party[0].maxHp);
  });

  it("uses a recovery item from the bag on the active pet", () => {
    const battle = bunnyFight([pet(68, 7, 2, 40)]);
    menu(battle, 2);
    expect(battle.interactiveStage).toBe("itemList");
    expect(battle.ui.rows.map((row) => row.name)).toEqual(["Bánh Sandwich"]);
    press(battle, "confirm");
    expect(battle.interactiveStage).toBe("warning");
    expect(battle.ui.message).toMatch(/hồi \d+ HP/);
    expect(battle.hp("player")).toBeGreaterThan(40);
    playUntil(battle, atMenu);
    expect(battle.core!.bag()[4]).toBe(4);
  });

  it("refuses what the core refuses, with the reason, and spends nothing", () => {
    const battle = bunnyFight([pet(68, 7, 2)]);
    menu(battle, 2);
    press(battle, "confirm");
    expect(battle.interactiveStage).toBe("warning");
    expect(battle.ui.message).toBe("HP đã đầy.");
    press(battle, "confirm");
    expect(battle.interactiveStage).toBe("fight");
    expect(battle.core!.bag()[4]).toBe(5);
  });

  it("animates EXP, shows each Thăng cấp card, then closes", () => {
    const hero = pet(68, 7, 2);
    hero.experience = requiredExp(8) - 1;
    const party = [hero],
      battle = bunnyFight(party, false);
    for (
      let round = 0;
      round < 10 && !battle.complete && battle.interactiveStage !== "experience";
      round++
    ) {
      menu(battle, 0);
      press(battle, "confirm");
      playUntil(battle, (b) => atMenu(b) || b.interactiveStage === "experience");
    }
    expect(battle.interactiveStage).toBe("experience");
    const before = battle.experienceBar.value;
    expect(battle.experienceBar.max).toBe(requiredExp(8));
    battle.tick();
    expect(battle.experienceBar.value).toBeGreaterThan(before);
    playUntil(battle, (b) => b.interactiveStage === "levelUp");
    expect(battle.interactiveStage).toBe("levelUp");
    expect(battle.complete).toBe(false);
    const card = battle.ui.levelUp!;
    expect(battle.ui.mode).toBe("LEVEL_UP");
    expect(card.level).toBe(8);
    expect(card.newStats[0]).toBeGreaterThan(card.oldStats[0]);
    expect(battle.settlement?.members[0].levelUp.levelsGained).toBe(1);
    press(battle, "confirm");
    playUntil(battle, (b) => b.complete);
    expect(battle.complete).toBe(true);
    expect(battle.result).toBe(0);
    expect(party[0].level).toBe(8);
  });

  it("fills the pet screen's four tabs from the party", () => {
    const battle = bunnyFight([pet(68, 7, 2), pet(30, 6, 2, 0)]);
    menu(battle, 3);
    const [first, second] = battle.ui.rows;
    expect(first.pet).toMatchObject({ level: 7, status: "Đang ra trận", quality: 2 });
    expect(first.pet!.stats[1]).toBe(battle.core!.unit("player", 0).currentStats.attack);
    expect(first.pet!.skills.map((skill) => skill.name)).toHaveLength(2);
    expect(first.pet!.trait?.name).toBeTruthy();
    expect(second.pet!.status).toBe("Đã gục");
    expect(second.enabled).toBe(false);
    expect(battle.ui.tab).toBe(0);
    press(battle, "right");
    press(battle, "right");
    expect(battle.ui.tab).toBe(2);
    press(battle, "left");
    expect(battle.ui.tab).toBe(1);
  });

  it("draws the bag's balls in the catch panel and its recovery items in the plain one", () => {
    const battle = bunnyFight([pet(68, 7, 2, 40)]);
    menu(battle, 2);
    expect(battle.catchListOpen).toBe(false);
    press(battle, "back");
    expect(battle.experienceBar).toEqual({ value: 0, max: requiredExp(8) });
  });

  describe("mouse (Java PC QoL)", () => {
    const fullBag = { 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1 };
    const rowY = (row: number) => ITEM_LIST.list.y + row * ITEM_LIST.list.stride + 5;

    it("moves the command cursor under the mouse and runs a clicked command", () => {
      const battle = bunnyFight([pet(68, 7, 2)]);
      battle.hover(56, 300);
      expect(battle.ui.selectedIndex).toBe(1);
      battle.hover(137, 300);
      expect(battle.ui.selectedIndex).toBe(3);
      battle.hover(137, 200);
      expect(battle.ui.selectedIndex).toBe(3);
      battle.pointer(20, 300, {});
      expect(battle.interactiveStage).toBe("skillList");
      battle.pointer(60, SKILL_LIST.list.y + 5, {});
      expect(battle.interactiveStage).toBe("skillAction");
    });

    it("holds JavaSE's Chạy trốn notice for 12 ticks before closing a wild fight", () => {
      const battle = bunnyFight([pet(68, 7, 2)], false, {}, {}, false);
      menu(battle, 5);
      expect(battle.interactiveStage).toBe("runExit");
      expect(battle.ui.message).toBe("Chạy trốn");
      expect(battle.complete).toBe(false);
      for (let tick = 0; tick < 11; tick++) battle.tick();
      expect([battle.interactiveStage, battle.complete]).toEqual(["runExit", false]);
      battle.tick();
      expect([battle.complete, battle.result]).toEqual([true, -1]);
    });

    it("hovers, wheels and drags the bag list, and its buttons confirm and go back", () => {
      const battle = bunnyFight([pet(68, 7, 2, 40)], true, {}, fullBag);
      battle.pointer(98, 300, {});
      expect(battle.interactiveStage).toBe("itemList");
      const size = battle.ui.rows.length;
      expect(size).toBeGreaterThan(5);
      battle.hover(40, rowY(2));
      expect(battle.ui.selectedIndex).toBe(2);
      expect(battle.ui.description).toBe(battle.ui.rows[2].description);
      // The 2px gap between two rows is no row.
      battle.hover(40, ITEM_LIST.list.y + 3 * ITEM_LIST.list.stride - 1);
      expect(battle.ui.selectedIndex).toBe(2);
      battle.wheel(1);
      expect([battle.ui.scroll, battle.ui.selectedIndex]).toEqual([1, 2]);
      battle.hover(40, rowY(0));
      expect(battle.ui.selectedIndex).toBe(1);
      battle.wheel(5);
      expect(battle.ui.scroll).toBe(size - 5);
      expect(battle.ui.selectedIndex).toBe(size - 5);

      const bar = ITEM_LIST.scrollbar;
      expect(battle.pressScrollbar(bar.x + 2, bar.y + 1)).toBe(true);
      expect(battle.ui.scroll).toBe(0);
      expect(battle.scrollbarDragging).toBe(false);
      expect(battle.pressScrollbar(bar.x + 2, bar.y + 2)).toBe(true);
      expect(battle.scrollbarDragging).toBe(true);
      battle.dragScrollbar(bar.y + bar.h + 40);
      expect(battle.ui.scroll).toBe(size - 5);
      battle.releaseScrollbar();
      expect(battle.scrollbarDragging).toBe(false);
      expect(battle.pressScrollbar(40, rowY(0))).toBe(false);

      // Keyboard keeps the cursor in the window too.
      press(battle, "down");
      press(battle, "down");
      press(battle, "down");
      press(battle, "down");
      press(battle, "down");
      expect(battle.ui.selectedIndex).toBe(0);
      expect(battle.ui.scroll).toBe(0);

      battle.pointer(10, 150, {});
      expect(battle.interactiveStage).toBe("itemList");
      battle.pointer(ITEM_LIST.back.x + 2, ITEM_LIST.back.y + 2, {});
      expect(battle.interactiveStage).toBe("fight");
      battle.pointer(98, 300, {});
      battle.pointer(40, rowY(0), {});
      expect(battle.interactiveStage).toBe("warning");
    });

    it("fills the fight's pet cards with Chủng, Hóa and the seat's live buff counts", () => {
      services.petFacts = {
        species: (id) => (id === 68 ? "Mãnh Thú" : undefined),
        evolution: (id) => (id === 68 ? "Tiến hóa > Thiểm Điện Miêu" : ""),
      };
      try {
        const battle = bunnyFight([pet(68, 7, 2), pet(30, 6, 2)]);
        battle.pointer(137, 300, {});
        expect(battle.interactiveStage).toBe("petList");
        const [first, second] = battle.ui.rows.map((row) => row.pet!);
        expect([first.speciesName, first.evolution]).toEqual([
          "Mãnh Thú",
          "Tiến hóa > Thiểm Điện Miêu",
        ]);
        expect([second.speciesName, second.evolution]).toEqual([undefined, ""]);
        expect([first.buffCount, first.debuffCount]).toEqual([0, 0]);
      } finally {
        services.petFacts = undefined;
      }
    });

    it("selects a pet card on click and switches only on the action button", () => {
      const battle = bunnyFight([pet(68, 7, 2), pet(30, 6, 2)]);
      battle.pointer(137, 300, {});
      expect(battle.interactiveStage).toBe("petList");
      const card = (index: number) => ({
        x: PET_STATE.roster.x + index * PET_STATE.roster.columnStride + 10,
        y: PET_STATE.roster.y + 5,
      });
      battle.hover(card(1).x, card(1).y);
      expect(battle.ui.selectedIndex).toBe(1);
      battle.pointer(card(0).x, card(0).y, {});
      expect([battle.interactiveStage, battle.ui.selectedIndex]).toEqual(["petList", 0]);
      battle.pointer(PET_STATE.next.x + 3, PET_STATE.next.y + 3, {});
      expect(battle.ui.selectedIndex).toBe(1);
      battle.pointer(PET_STATE.tabs[3].x + 3, PET_STATE.tabs[3].y + 3, {});
      expect(battle.ui.tab).toBe(3);
      battle.pointer(PET_STATE.action.x + 3, PET_STATE.action.y + 3, {});
      expect(battle.interactiveStage).toBe("switching");
    });
  });
});

describe("an encounter enemy's thiên phú", () => {
  /** One wild seat on the core, built the way `WorldRuntime` builds an encounter: no talent given. */
  function oneEnemy(
    speciesId: number,
    level: number,
    quality: number,
    seed: number,
    descriptor = contract.encounter.descriptor,
  ) {
    const core = services.newCore(
      {
        format: "1v1",
        kind: "wild",
        player: [
          services.partyMember(
            pet(contract.player.id, contract.player.level, contract.player.quality),
          ),
        ],
        enemy: [services.encounterPet(speciesId, level, quality)],
      },
      descriptor,
      seed,
    );
    core.start();
    return core;
  }

  it("rolls a wearable talent for the enemy and moves its four stats the resolver way", () => {
    const bunny = contract.opponent;
    for (let seed = 0; seed < 12; seed++) {
      const core = oneEnemy(bunny.id, bunny.level, bunny.quality, seed),
        talent = core.enemySetup(0).physicalTraitId,
        base = petStats.coreStats(bunny.id, bunny.level, bunny.quality),
        projected = rules.traitRegistry.projectPermanentStats(talent!, {
          maxHp: base.hp,
          strength: base.attack,
          defense: base.defense,
          agility: base.speed,
        }),
        stats = core.unit("enemy", 0).baseStats;
      expect(talent, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      expect(rules.traitRegistry.sanitizePhysicalTraitId(talent!), `seed ${seed}`).toBe(talent);
      expect(
        [stats.hp, stats.attack, stats.defense, stats.speed],
        `seed ${seed} talent ${talent}`,
      ).toEqual([projected.maxHp, projected.strength, projected.defense, projected.agility]);
    }
  });

  it("leaves Kim Diễm Long Vương on the stats its record authored", () => {
    for (const seed of [0, 1, 2]) {
      const core = oneEnemy(280, 60, 5, seed, "SCENE10_ROOM14_GROUP0_PHOENIX");
      expect(core.enemySetup(0).physicalTraitId, `seed ${seed}`).toBeUndefined();
      expect(core.unit("enemy", 0).baseStats.hp, `seed ${seed}`).toBe(
        petStats.coreStats(280, 60, 5).hp,
      );
    }
  });

  it("replays one fight and varies between fights", () => {
    const bunny = contract.opponent,
      bySeed = new Set<number>();
    for (let seed = 0; seed < 40; seed++) {
      const once = oneEnemy(bunny.id, bunny.level, bunny.quality, seed).enemySetup(
        0,
      ).physicalTraitId;
      expect(
        oneEnemy(bunny.id, bunny.level, bunny.quality, seed).enemySetup(0).physicalTraitId,
      ).toBe(once);
      bySeed.add(once!);
    }
    expect(bySeed.size).toBeGreaterThan(1);

    // The descriptor is part of the identity, so the same seed at another encounter rolls elsewhere.
    const others = [
      "SCENE1_ROOM1_GROUP2_MAGHULL",
      "SCENE1_ROOM2_GROUP1_LANNI",
      "SCENE1_ROOM3_GROUP0_SOPHIE",
      "SCENE1_ROOM4_GROUP0_CHALCONE",
      "SCENE1_ROOM6_GROUP0_HARRY",
      "SCENE2_ROOM4_GROUP1_KULUOLI",
      "SCENE2_ROOM6_GROUP0_BOEN",
      "SCENE4_ROOM3_GROUP1_HAGEN",
      "SCENE9_ROOM0_GROUP1_LARRY",
    ].map(
      (descriptor) =>
        oneEnemy(bunny.id, bunny.level, bunny.quality, 0, descriptor).enemySetup(0).physicalTraitId,
    );
    expect(new Set(others).size).toBeGreaterThan(1);
  });

  it("takes no draw from the fight's own random stream", () => {
    const bunny = contract.opponent,
      // What seat 0 of this exact fight is rolled, pinned as an already-known talent instead.
      pinned = rules.traitRegistry.rollFromIdentity([
        contract.encounter.descriptor ?? "",
        11,
        0,
        bunny.id,
        bunny.level,
        bunny.nature ?? ENCOUNTER_NATURE_FALLBACK,
      ]);
    const round = (given: number | undefined) => {
      const core = services.newCore(
        {
          format: "1v1",
          kind: "wild",
          player: [services.partyMember(pet(68, 7, 2))],
          enemy: [
            {
              ...services.encounterPet(bunny.id, bunny.level, bunny.quality),
              physicalTraitId: given,
            },
          ],
        },
        contract.encounter.descriptor,
        11,
      );
      core.start();
      return core
        .submit({ kind: "skill", slot: 0 })
        .map((event) => JSON.stringify(event))
        .join("\n");
    };
    // Java's `rollNew` reads `ThreadLocalRandom`, never the fight's `VqsvSourceRandom`, so giving the
    // enemy its talent by rolling must leave the stream the round draws from exactly where it started.
    expect(round(undefined)).toBe(round(pinned));
  });
});

describe("the two axes a pet is seated with", () => {
  /** One round of a level 30 pet against a bunny left at 1 HP, and what that earns. */
  function expAgainst(quality: number, nature: number): number {
    const core = services.newCore(
      {
        format: "1v1",
        kind: "wild",
        player: [services.partyMember(pet(contract.player.id, 30, 5))],
        enemy: [{ ...services.encounterPet(contract.opponent.id, 5, quality, nature), hp: 1 }],
      },
      contract.encounter.descriptor,
      7,
    );
    core.start();
    const earned = core
      .submit({ kind: "skill", slot: 0 })
      .find((event) => event.type === "experience");
    expect(earned?.type).toBe("experience");
    return (earned as { amount: number }).amount;
  }

  it("seats an encounter with its own nature, not a copy of its quality", () => {
    const core = services.newCore(
      {
        format: "1v1",
        kind: "wild",
        player: [services.partyMember(pet(contract.player.id, contract.player.level, 2))],
        enemy: [services.encounterPet(contract.opponent.id, contract.opponent.level, 1)],
      },
      contract.encounter.descriptor,
      0,
    );
    const bunny = core.enemySetup(0);
    // `enemyFromEncounter` reads `encounter[2]`, and 3 when the record is too short for one, so the
    // tutorial's bunny sits on nature 3 while its quality stays 1. A seat that copies one into the
    // other loses both the catch chance and the EXP the nature column was chosen for.
    expect(bunny.quality).toBe(1);
    expect(bunny.nature).toBe(ENCOUNTER_NATURE_FALLBACK);
    expect(bunny.nature).not.toBe(bunny.quality);
  });

  it("seats a party pet with the nature its save recorded", () => {
    const seated = services.partyMember({ ...pet(68, 7, 2), nature: 5 });
    expect(seated.nature).toBe(5);
    expect(seated.quality).toBe(2);
    expect(services.partyMember(pet(68, 7, 2)).nature).toBe(0);
  });

  it("awards EXP by nature and leaves quality out of it", () => {
    // `expAward` clamps nature into the five columns, so 1 and 5 read factors 10 and 15, while two
    // qualities at the same level and nature award the same amount.
    expect(expAgainst(1, 5)).toBeGreaterThan(expAgainst(1, 1));
    expect(expAgainst(5, 3)).toBe(expAgainst(1, 3));
  });
});
