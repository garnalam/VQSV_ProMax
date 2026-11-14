import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/** Pack images are 1x1 stand-ins under Node; the host never reads pixels. */
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
const { MemorySaveStore } = await import("../../persistence/save/SaveStore");
const { SaveRepository } = await import("../../persistence/SaveRepository");
const { SaveService } = await import("../../persistence/SaveService");
const { scene1Save } = await import("../../dev/parityCheckpoints");
const { SCENE1_RESUME } = await import("../../persistence/save/migrations");
const { MAP_LOADING_TOTAL_TICKS } = await import("../world/MapLoadingRuntime");
const { GameplayHost, gameplaySources } = await import("./GameplayHost");
const {
  GAME_MENU_SCROLLBAR,
  MENU_LABELS,
  MENU_ROW_BAG,
  MENU_ROW_PET,
  MENU_ROW_RECORD,
  MENU_ROW_SAVE,
  MENU_ROW_TASK,
  MENU_ROW_WIDGETS,
  SAVE_TEXT,
} = await import("../world/WorldPanel");
const { SHORTCUT_TOGGLE } = await import("../world/WorldHud");
type SessionStart = import("./GameplayHost").SessionStart;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
const sources = gameplaySources(assets, boot),
  contract = assets.worldContract;

function session(start: SessionStart, repository = new SaveRepository(new MemorySaveStore())) {
  const saves = new SaveService(repository),
    exits = { count: 0 },
    host = new GameplayHost(sources, saves, { onExit: () => exits.count++ }, start);
  waitOutMapLoading(host);
  return { host, saves, repository, exits };
}

/**
 * JavaSE holds the whole session for 16 ticks whenever a room is swapped, sampling no input. A test
 * that wants the map itself waits that screen out first.
 */
function waitOutMapLoading(host: InstanceType<typeof GameplayHost>): void {
  while (host.mapLoadingActive) host.step([]);
}

/** Drive the data-defined Elder chain with the same input ownership as the player. */
function tickElderChain(host: InstanceType<typeof GameplayHost>, starter = 53): void {
  const world = host.world!,
    scene = world.eventScene,
    ids = scene?.activationIds ?? [],
    actor = ids.length ? world.actors.get(ids.includes(starter) ? starter : ids[0]) : undefined;
  if (actor?.visible) {
    world.player.x = actor.x;
    world.player.y = actor.y + 20;
    world.player.direction = 2;
    host.step(["confirm"]);
    return;
  }
  host.step(scene && (scene.choice || scene.textReady) ? ["confirm"] : []);
}

function reachElderBattle(host: InstanceType<typeof GameplayHost>, starter = 53): void {
  for (let i = 0; i < 30000 && !host.world!.battle; i++) tickElderChain(host, starter);
  expect(host.world!.battle).not.toBeNull();
  expect(host.world!.battleGroup).toEqual({ scene: 1, room: 0, group: 6 });
}

const freeWorld = (): SessionStart => ({
  kind: "resume",
  save: scene1Save({
    location: {
      sceneId: contract.save.scene,
      roomIndex: contract.save.room,
      x: contract.save.x,
      y: contract.save.y,
      direction: 1,
    },
    owner: SCENE1_RESUME.bunnyCapture,
    bunnyCaught: false,
    pets: [{ speciesId: 68, level: 7, quality: 2 }],
  }),
});

describe("campaign service wiring", () => {
  it("binds shop, daily badge, pet bank and incubator to the live world instead of stubs", () => {
    const { host } = session(freeWorld()),
      world = host.world!;
    world.currency.money = 100_000;
    world.currency.badges = 0;

    // The merchant buys at half the source price (`WorldItemShopService`).
    world.inventory["2"] = 3;
    const shop = host.panel.worldShopSource,
      row = shop.sellRows().find((entry) => entry.itemId === 2)!;
    expect([row.count, row.unitPrice]).toEqual([3, Math.trunc(row.sourcePrice / 2)]);
    const money = world.currency.money;
    expect(shop.sell(row, 2)).toBe(true);
    expect([world.inventory["2"], world.currency.money]).toEqual([1, money + row.unitPrice * 2]);
    const beforeBadges = world.currency.badges;
    expect(host.panel.portableShopSource.claimDailyBadges()).toContain("20 huy hiệu");
    expect(world.currency.badges).toBe(beforeBadges + 20);

    world.pets.push({ ...world.pets[0], slot: 1, speciesId: 58, currentHp: 0 });
    // `confirmSourcePetBankDeposit` through the bank's pet list.
    expect(host.panel.petSource.bankDeposit(1)).toBe("deposited");
    expect(world.campaign.petBank).toHaveLength(1);

    // The bag's egg: item 14 puts it in the incubator and fills it, "Ap trung" hatches it.
    world.bag.specials.push(0);
    world.campaign.egg.drawSeed = "9"; // egg.shinyChance rolls zero at draw index 0.
    world.inventory["14"] = 1;
    const bag = host.panel.bagSource,
      boost = bag.rows(0).find((row) => row.id === 14)!;
    expect(bag.use(0, boost)).toBe(
      "Thành công sử dụng, tranh thủ thời gian đi ấp trứng trứng sủng vật a!",
    );
    const egg = bag.rows(3).find((row) => row.id === 0)!;
    expect([egg.status, egg.egg, bag.eggActive()]).toEqual(["Hoàn thành - 1 cái", true, true]);
    expect(bag.use(3, egg)).toBe("Ấp trứng thành công");
    expect(host.panel.bagOpenBox).toMatch(/^Ấp trứng tìm được #2.+#0 để vào ba lô$/);
    expect(world.bag.specials).not.toContain(0);
    expect(world.campaign.egg).toMatchObject({ drawIndex: 1, type: 1, active: false });
    const hatched = world.pets[world.pets.length - 1];
    expect(hatched.level).toBe(5);
    expect([7, 8, 9]).toContain(hatched.nature);
    expect(world.collection.status(hatched.speciesId, hatched.nature)).toBe(2);
  });
});

function reachPostEvolutionSkillQueue(host: InstanceType<typeof GameplayHost>): number[] {
  const world = host.world!,
    pet = world.pets[0];
  pet.level = 30;
  world.bag.materials["12"] = 1;
  world.bag.materials["3009"] = 2;
  world.bag.materials["3010"] = 2;
  const expected = assets.petSkillPools!.evolutionCandidates(
    pet.speciesId,
    69,
    pet.level,
    pet.skillIds ?? [],
  );
  host.step(["back"]);
  for (let i = 0; i < MENU_ROW_PET; i++) host.step(["down"]);
  host.step(["confirm"]);
  host.step(["confirm"]);
  for (let i = 0; i < 6; i++) host.step(["down"]);
  host.step(["confirm"]); // Tiến hóa
  host.step(["confirm"]); // begin the effect
  for (let i = 0; i < 24; i++) host.step([]);
  host.step(["confirm"]); // close the success message and open the learn queue
  expect([pet.speciesId, host.panel.petStage]).toEqual([69, "skillLearn"]);
  return expected;
}

describe("GameplayHost layer order (VqsvGameRuntime.tick)", () => {
  it("opens ingame Help, Settings and confirms returning to the title", () => {
    const { host, exits } = session(freeWorld());
    host.step([]);
    let volume = 2,
      speed = false;
    host.panel.systemSource = {
      volumeLevel: () => volume,
      setVolumeLevel: (level) => (volume = level),
      speedX2: () => speed,
      toggleSpeedX2: () => (speed = !speed),
      exitToTitle: () => exits.count++,
    };
    host.panel.openSystem();
    host.step(["down"]);
    host.step(["confirm"]);
    expect([host.panel.mode, host.panel.helpPage]).toEqual(["help", 0]);
    host.step(["right"]);
    host.step(["right"]);
    expect(host.panel.helpPage).toBe(2);
    host.step(["back"]);
    expect([host.panel.mode, host.panel.selected]).toEqual(["gamesystem", 1]);
    host.step(["down"]);
    host.step(["confirm"]);
    expect([host.panel.mode, host.panel.settingsLevel]).toEqual(["settings", 2]);
    host.step(["right"]);
    expect(volume).toBe(3);
    host.pointer(90, 185);
    expect(speed).toBe(true);
    host.step(["confirm"]);
    expect([host.panel.mode, host.panel.selected]).toEqual(["gamesystem", 2]);
    host.step(["down"]);
    host.step(["confirm"]);
    expect([host.panel.mode, host.panel.selected]).toEqual(["optionConfirm", 1]);
    host.step(["up"]);
    host.step(["confirm"]);
    expect([host.panel.visible, exits.count]).toEqual([false, 1]);
  });

  it("loads the complete Liệt Hỏa bag icon mapping instead of treating item ids as atlas cells", () => {
    const icons = new Map(assets.worldContract.itemCatalog.map((item) => [item.id, item.iconCell]));
    expect(icons.size).toBe(15);
    expect(icons.get(0)).toBe(25);
    expect(icons.get(4)).toBe(29);
    expect(icons.get(11)).toBe(36);
    expect(icons.get(13)).toBe(53);
    expect(icons.get(14)).toBe(41);
  });

  it("an open panel owns the tick: the world does not move under it", () => {
    const { host } = session(freeWorld());
    host.step([]);
    expect(host.world!.phase).toBe("freeworld");
    expect(host.step(["back"])).toBe("panel");
    expect(host.panel.visible).toBe(true);
    const { x, y } = host.world!.player;
    for (let i = 0; i < 10; i++) expect(host.step(["holdRight"])).toBe("panel");
    expect([host.world!.player.x, host.world!.player.y]).toEqual([x, y]);
    host.step(["back"]);
    expect(host.panel.visible).toBe(false);
    for (let i = 0; i < 10; i++) expect(host.step(["holdRight"])).toBe("world");
    expect(host.world!.player.x).toBeGreaterThan(x);
  });

  it("Back during a battle stays with the battle: canOpenSourcePanel() is false there", () => {
    const { host } = session(freeWorld());
    host.world!.player.x = contract.trigger.x;
    host.world!.player.y = contract.trigger.y;
    for (let i = 0; i < 40 && !host.world!.battleVisible; i++) host.step([]);
    expect(host.world!.battleVisible).toBe(true);
    expect(host.layerFor(["back"])).toBe("battle");
    expect(host.step(["back"])).toBe("battle");
    expect(host.panel.visible).toBe(false);
  });

  it("the opening is a cutscene layer and leaving it is the host's exit hook", () => {
    const { host, exits } = session({ kind: "opening" });
    expect(host.step(["back"])).toBe("cutscene");
    expect(exits.count).toBe(0);
    expect(host.pointer(120, 160)).toEqual([]);
    expect(exits.count).toBe(0);
  });

  it("the elder return is a free-world event group, and the next link in the chain follows it", () => {
    const { host } = session({
      kind: "resume",
      save: scene1Save({
        location: { sceneId: 1, roomIndex: 1, x: 19, y: 273, direction: 3 },
        owner: SCENE1_RESUME.bunnyReturnRoom0,
        bunnyCaught: true,
        eventStates: { "1:1:0": 3 },
        pets: [
          { speciesId: 68, level: 7, quality: 2 },
          { speciesId: 34, level: 5, quality: 1 },
        ],
      }),
    });
    host.step([]);
    waitOutMapLoading(host);
    expect(host.world!.roomIndex).toBe(0);
    host.world!.player.x = 200;
    host.world!.player.y = 190;
    expect(host.step(["confirm"])).toBe("world");
    // The records run in the world's own event frame, so the map, the camera and the actors stay live.
    expect(host.world!.eventScene!.program.id).toBe("world:1:0:2");
    const rosterBefore = host.world!.pets.length;
    reachElderBattle(host);
    expect(host.world!.eventState.sourceEventState(1, 0, 2)).toBe(3);
    expect(host.world!.eventState.sourceEventState(1, 0, 3)).toBe(3);
    expect(host.world!.questState.mainTaskProgress).toBe(1);
    expect(host.world!.pets).toHaveLength(rosterBefore + 1);
    expect(host.world!.pets[0].speciesId).toBe(51);
  });
});

describe("GameplayHost main task ladder (op45)", () => {
  const ladderSave = (progress: number) => ({
    ...scene1Save({
      location: { sceneId: 1, roomIndex: 1, x: 19, y: 273, direction: 3 },
      owner: SCENE1_RESUME.bunnyReturnRoom0,
      bunnyCaught: true,
      eventStates: { "1:1:0": 3 },
      pets: [
        { speciesId: 68, level: 7, quality: 2 },
        { speciesId: 34, level: 5, quality: 1 },
      ],
    }),
    progress: { mainTaskProgress: progress },
  });

  it("carries the prelude's op45 into the first world the session builds", () => {
    const { host } = session({ kind: "skipIntro" });
    for (let i = 0; i < 20000 && !host.world; i++) host.step(i % 7 === 6 ? ["confirm"] : []);
    expect(host.world).not.toBeNull();
    // The opening announces task 0 before any world exists; that write, not the contract's literal,
    // is what the player's ladder reads.
    expect(host.world!.questState.mainTaskProgress).toBe(0);
  });

  it("writes the ladder when the Elder event's own op45 tip opens", () => {
    const { host } = session({ kind: "resume", save: ladderSave(0) });
    host.step([]);
    waitOutMapLoading(host);
    expect(host.world!.questState.mainTaskProgress).toBe(0);
    host.world!.player.x = 200;
    host.world!.player.y = 190;
    expect(host.step(["confirm"])).toBe("world");
    const elder = () => host.world!.eventScene;
    for (let i = 0; i < 30000 && elder()?.textKind !== "tasktip"; i++)
      host.step(i % 7 === 6 ? ["confirm"] : []);
    expect(elder()!.textKind).toBe("tasktip");
    expect(elder()!.currentText).toContain("trưởng thôn tỷ thí");
    expect(host.world!.questState.mainTaskProgress).toBe(1);
    // The next rung is the challenge group's own op45, which sits behind the battle that group opens.
  });

  it("shows the card for the announced task index when no story director runs", () => {
    const saves = new SaveService(new SaveRepository(new MemorySaveStore())),
      host = new GameplayHost(
        { ...sources, storyGraph: undefined },
        saves,
        { onExit: () => {} },
        { kind: "resume", save: ladderSave(2) },
      );
    host.step([]);
    waitOutMapLoading(host);
    // The checkpoint stands on the room-1 doorway, so step the hero off the marker: a swap that
    // starts during the shortcut presses would hold the frame and swallow them.
    host.world!.player.x = 200;
    host.world!.player.y = 190;
    host.step([]);
    waitOutMapLoading(host);
    expect(host.world!.questState.mainTaskProgress).toBe(2);
    host.pointer(SHORTCUT_TOGGLE.x + 3, SHORTCUT_TOGGLE.y + 3);
    for (let i = 0; i < 5; i++) host.step([]);
    host.pointer(50, 290);
    expect([host.panel.visible, host.panel.mode]).toEqual([true, "task"]);
    expect(host.panel.taskRows[host.panel.selected].title).toBe("Đến Bích Thủy Thành");
  });
});

describe("GameplayHost saving through SaveService", () => {
  const toSavePrompt = (repository?: InstanceType<typeof SaveRepository>) => {
    const s = session({ kind: "skipIntro" }, repository);
    for (let i = 0; i < 20000 && s.host.world?.phase !== "savePrompt"; i++)
      s.host.step(i % 7 === 6 ? ["confirm"] : []);
    waitOutMapLoading(s.host);
    expect(s.host.world?.phase).toBe("savePrompt");
    return s;
  };

  it("the prompt's Save writes the snapshot, then returns to the free world", async () => {
    const { host, saves, repository } = toSavePrompt();
    host.step(["right"]);
    host.step(["confirm"]);
    expect(host.world!.phase).toBe("saving");
    expect(saves.pending).toBe(1);
    host.step([]);
    expect(host.world!.phase).toBe("saving");
    await saves.flush();
    expect(saves.pending).toBe(0);
    expect(host.world!.phase).toBe("freeworld");
    expect(await repository.load()).toBeDefined();
  });

  it("the game menu's Lưu dữ liệu writes the session and reports the result", async () => {
    const { host, saves, repository } = session(freeWorld());
    host.step(["back"]);
    for (let i = 0; i < MENU_ROW_SAVE; i++) host.step(["down"]);
    host.step(["confirm"]);
    expect([host.panel.mode, host.panel.saveMessage]).toEqual(["save", SAVE_TEXT.ask]);
    host.step(["confirm"]);
    expect(saves.pending).toBe(0);
    host.step([]);
    expect(saves.pending).toBe(1);
    expect(host.panel.saveMessage).toBe(SAVE_TEXT.saving);
    await saves.flush();
    expect([host.panel.savePhase, host.panel.saveMessage]).toEqual([2, SAVE_TEXT.success]);
    const saved = await repository.load();
    expect(saved?.location.sceneId).toBe(contract.save.scene);
    host.step(["confirm"]);
    expect(host.panel.visible).toBe(false);
    expect(host.layerFor([])).toBe("world");
  });

  it("a failed menu save says so and still closes on the next press", async () => {
    const repository = new SaveRepository(new MemorySaveStore());
    vi.spyOn(repository, "save").mockRejectedValue(new Error("quota"));
    const { host, saves } = session(freeWorld(), repository);
    host.step(["back"]);
    for (let i = 0; i < MENU_ROW_SAVE; i++) host.step(["down"]);
    host.step(["confirm"]);
    host.step(["confirm"]);
    host.step([]);
    await saves.flush();
    expect(host.panel.saveMessage).toBe(SAVE_TEXT.failure);
    host.step(["back"]);
    expect(host.panel.visible).toBe(false);
  });

  it("a failed write puts the prompt back", async () => {
    const repository = new SaveRepository(new MemorySaveStore());
    vi.spyOn(repository, "save").mockRejectedValue(new Error("quota"));
    const { host, saves } = toSavePrompt(repository);
    host.step(["right"]);
    host.step(["confirm"]);
    await saves.flush();
    expect(host.world!.phase).toBe("savePrompt");
  });
});

describe("GameplayHost mouse routing (pointerPressedGame / pointerMovedGame / mouseWheel)", () => {
  it("hovers and wheels the open game menu, and a held thumb drags it", () => {
    const { host } = session(freeWorld());
    host.step([]);
    host.step(["back"]);
    host.panel.open();
    const layout = sources.layouts.get("gamemenu")!,
      row = layout.widget(MENU_ROW_WIDGETS[3])!;
    host.pointerMove(row.x + 10, row.y + 5);
    expect(host.panel.selected).toBe(3);
    host.wheel(9);
    expect(host.panel.listScroll).toBe(MENU_LABELS.length - 6);
    const bar = GAME_MENU_SCROLLBAR;
    host.wheel(-9);
    // The bar takes the press (no click), then the moving pointer drags the thumb.
    expect(host.pointerPress(bar.x + 1, bar.y + 2)).toBe(true);
    host.pointerMove(bar.x + 1, bar.y + bar.h);
    expect(host.panel.listScroll).toBe(MENU_LABELS.length - 6);
    host.pointerRelease();
    host.pointerMove(row.x + 10, row.y + 5);
    expect(host.panel.selected).toBe(host.panel.listScroll + 3);
    expect(host.pointerPress(5, 5)).toBe(false);
  });

  it("sends the mouse to the battle while its screen is up", () => {
    const { host } = session(freeWorld());
    host.world!.player.x = contract.trigger.x;
    host.world!.player.y = contract.trigger.y;
    for (let i = 0; i < 40 && !host.world!.battleVisible; i++) host.step([]);
    const battle = host.world!.battle!;
    host.pointerMove(176, 300);
    expect(battle.ui.selectedIndex).toBe(4);
    host.pointerMove(20, 300);
    expect(battle.ui.selectedIndex).toBe(0);
    host.pointer(20, 300);
    expect(battle.interactiveStage).toBe("skillList");
  });

  it("uses the rendered layout alias for hover as well as click", () => {
    const { host } = session(freeWorld()),
      shop = sources.layouts.get("shop")!;
    host.panel.openWorldShop();
    const sell = shop.widget(7)!;
    host.pointerMove(sell.x + 10, sell.y + 5);
    expect(host.panel.selected).toBe(1);

    host.panel.openPetBank();
    const withdraw = shop.widget(7)!;
    host.pointerMove(withdraw.x + 10, withdraw.y + 5);
    expect(host.panel.selected).toBe(1);
  });
});

describe("free-world HUD (WorldUi, talk prompt)", () => {
  it("shows the talk bubble over the NPC the hero faces, and only on the free map", () => {
    const { host } = session(freeWorld());
    host.step([]);
    const world = host.world!,
      npc = world.actors.get(49)!;
    expect(world.talkPrompt).toBeNull();
    world.player.x = npc.x;
    world.player.y = npc.y + 22;
    world.player.direction = 2;
    expect(world.talkPrompt).toEqual({ actorId: 49, x: npc.x, y: npc.y - 40 });
    world.player.direction = 0;
    expect(world.talkPrompt).toBeNull();
  });

  it("drops the room banner with the room's name when the world loads", () => {
    const { host } = session(freeWorld());
    expect(host.world!.hud.roomTitle).toBe("Đường nhỏ phía Đông");
    expect(host.world!.hud.titleAnimationTick).toBeGreaterThanOrEqual(0);
  });

  it("the game menu's Nhiệm vụ lists the story's main task; confirm opens the area map", () => {
    const { host } = session(freeWorld());
    host.step([]);
    host.step(["back"]);
    for (let i = 0; i < MENU_ROW_TASK; i++) host.step(["down"]);
    host.step(["confirm"]);
    expect([host.panel.mode, host.panel.selected]).toEqual(["task", 0]);
    expect(host.panel.taskRows.map((row) => [row.title, row.completed])).toEqual([
      ["Vòng loại sơ khảo", false],
    ]);
    expect(host.taskProgress()).toBe("0.1%");
    host.step(["right"]);
    expect([host.panel.taskTab, host.panel.taskRows]).toEqual([1, []]);
    expect(host.taskProgress()).toBe("0.0%");
    host.step(["left"]);
    host.step(["confirm"]);
    // JavaSE opens the map from the list; the map is the original area map, and Back returns.
    expect(host.panel.mode).toBe("areaMap");
    const view = host.panel.areaMap!;
    for (let i = 0; i < 60 && view.sliding; i++) host.step([]);
    host.step(["back"]);
    expect([host.panel.mode, host.panel.taskTab, host.panel.selected]).toEqual(["task", 0, 0]);
    host.step(["back"]);
    expect([host.panel.mode, host.panel.selected]).toEqual(["gamemenu", MENU_ROW_TASK]);
  });

  it("the game menu's Lưng bao lists the bag and answers its items as af() does", () => {
    const { host } = session(freeWorld());
    host.step([]);
    const world = host.world!;
    world.inventory["13"] = 1;
    world.inventory["1"] = 2;
    host.step(["back"]);
    for (let i = 0; i < MENU_ROW_BAG; i++) host.step(["down"]);
    host.step(["confirm"]);
    expect([host.panel.mode, host.panel.bagTab, host.panel.selected]).toEqual(["bag", 0, 0]);
    const ids = host.panel.bagRows.map((row) => row.id);
    expect(ids).toContain(13);
    // A ball (list L, shown first) cannot be used outside a fight; 5 closes the line again.
    expect(ids[0]).toBeLessThanOrEqual(3);
    host.step(["confirm"]);
    expect(host.panel.bagMessage?.text).toBe("Không thể sử dụng");
    host.step(["down"]);
    expect(host.panel.selected).toBe(0);
    host.step(["confirm"]);
    expect(host.panel.bagMessage).toBeNull();
    // Tị quái hàn: one is used up and the repel runs for the row's 500 steps.
    while (host.panel.bagSelectedRow?.id !== 13) host.step(["down"]);
    host.step(["confirm"]);
    expect(host.panel.bagMessage?.text).toBe(
      "Thành công sử dụng đạo cụ, cũng có thời gian ngắn tránh quái hiệu quả",
    );
    expect([world.inventory["13"], world.repelSteps]).toEqual([0, 500]);
    host.step(["confirm"]);
    expect(host.panel.bagRows.map((row) => row.id)).not.toContain(13);
    // The other tabs are empty until the story grants gear; Back returns to the menu row.
    host.step(["right"]);
    expect([host.panel.bagTab, host.panel.bagRows, host.panel.bagAction]).toEqual([
      1,
      [],
      "Sử dụng",
    ]);
    host.step(["back"]);
    expect([host.panel.mode, host.panel.selected]).toEqual(["gamemenu", MENU_ROW_BAG]);
  });

  it("the game menu's Sủng vật shows the party; Chiến đấu leads, Phóng sinh keeps one", () => {
    const { host } = session(freeWorld());
    host.step([]);
    const world = host.world!,
      second = { ...world.pets[0], slot: 1, speciesId: 58, level: 5, heldEquipmentId: 3 };
    world.pets.push(second);
    host.step(["back"]);
    for (let i = 0; i < MENU_ROW_PET; i++) host.step(["down"]);
    host.step(["confirm"]);
    expect([host.panel.mode, host.panel.petCards.length]).toEqual(["pet", 2]);
    expect(host.panel.petCards[0]).toMatchObject({ name: "Điện Miêu" });
    expect(host.panel.petCards[0].pet).toMatchObject({ status: "Xuất chiến", active: true });
    expect(host.panel.petCards[1].pet?.status).toBe("Sẵn sàng");
    expect(host.panel.petSettingRows).toContain("Tiến hóa");
    expect(host.panel.petSettingRows.at(-1)).toBe("Dắt đi theo");
    // Left/right turn the dashboard page (Hồ sơ, Chỉ số, Đặc tính, Kỹ năng).
    host.step(["right"]);
    expect(host.panel.petTab).toBe(1);
    host.step(["left"]);
    // Chiến đấu on the second pet puts it first.
    host.step(["down"]);
    host.step(["confirm"]);
    expect(host.panel.petStage).toBe("setting");
    host.step(["down"]);
    host.step(["confirm"]);
    expect([host.panel.petStage, host.panel.selected, world.pets[0].speciesId]).toEqual([
      "list",
      0,
      58,
    ]);
    // Chiến đấu on the leader says so.
    host.step(["confirm"]);
    host.step(["down"]);
    host.step(["confirm"]);
    expect(host.panel.petMessage?.text).toBe("Sủng vật này đã xuất chiến");
    host.step(["confirm"]);
    // Phóng sinh asks first; its equipment returns to the bag. The menu kept its row (1).
    host.step(["confirm"]);
    for (let i = 0; i < 2; i++) host.step(["down"]);
    host.step(["confirm"]);
    expect(host.panel.petStage).toBe("confirmRelease");
    host.step(["confirm"]);
    expect(world.pets.map((p) => p.speciesId)).toEqual([68]);
    expect(world.bag.equipment).toContain(3);
    // The last pet cannot go (the menu is still on Phóng sinh).
    host.step(["confirm"]);
    host.step(["confirm"]);
    host.step(["confirm"]);
    expect(host.panel.petMessage?.text).toBe("Ba lô phải lưu ít nhất 1 sủng vật");
    host.step(["confirm"]);
    host.step(["back"]);
    expect([host.panel.mode, host.panel.selected]).toEqual(["gamemenu", MENU_ROW_PET]);
  });

  it("persists a selected world companion and follows the player after the ten-step trail", () => {
    const { host } = session(freeWorld());
    host.step([]);
    const world = host.world!;
    host.step(["back"]);
    for (let i = 0; i < MENU_ROW_PET; i++) host.step(["down"]);
    host.step(["confirm"]);
    host.step(["confirm"]);
    const last = host.panel.petSettingRows.length - 1;
    for (let i = 0; i < last; i++) host.step(["down"]);
    host.step(["confirm"]);
    expect(world.companionSelected(0)).toBe(true);
    host.step(["back"]);
    host.step(["back"]);
    host.step([]);
    const initial = world.actors.get(-2)!,
      initialX = initial.x;
    expect(initial).toMatchObject({ visible: true, sprite: 154, state: 0 });
    for (let i = 0; i < 12; i++) host.step(["right"]);
    expect(world.actors.get(-2)).toMatchObject({ visible: true, sprite: 154, state: 1 });
    expect(world.actors.get(-2)!.x).toBeGreaterThan(initialX - 1);
    const save = world.snapshot();
    expect(save.companionPetSlot).toBe(world.pets[0].slot);
    const resumed = session({ kind: "resume", save }).host;
    resumed.step([]);
    expect(resumed.world!.companionSelected(0)).toBe(true);
    expect(resumed.world!.actors.get(-2)).toMatchObject({ visible: true, sprite: 154 });
  });

  it("teleports the companion when far away and rebinds it after a room change", () => {
    const { host } = session(freeWorld());
    host.step([]);
    const world = host.world!;
    world.togglePetCompanion(0);
    host.step([]);
    const actor = world.actors.get(-2)!;
    actor.x = world.player.x - 161;
    actor.y = world.player.y - 161;
    host.step([]);
    expect(Math.max(Math.abs(actor.x - world.player.x), Math.abs(actor.y - world.player.y))).toBe(
      22,
    );
    world.roomIndex++;
    actor.x += 50;
    host.step([]);
    expect(Math.max(Math.abs(actor.x - world.player.x), Math.abs(actor.y - world.player.y))).toBe(
      22,
    );
  });

  it("learns a post-evolution skill into a free slot with full PP and no badge cost", () => {
    const { host } = session(freeWorld());
    host.step([]);
    const world = host.world!,
      pet = world.pets[0],
      oldSkills = (pet.skillIds ?? []).slice(0, 3);
    pet.skillIds = oldSkills;
    pet.skillPp = oldSkills.map(() => 1);
    world.currency.badges = 3;
    const candidates = reachPostEvolutionSkillQueue(host);
    expect(candidates.length).toBeGreaterThan(0);
    host.step(["confirm"]);
    expect(host.panel.petMessage?.text).toContain("Học tập");
    host.step(["confirm"]);
    expect(pet.skillIds).toContain(candidates[0]);
    expect(pet.skillPp).toEqual(assets.battleServices.progression.fullPp(pet.skillIds!));
    expect(world.currency.badges).toBe(3);
    const save = world.snapshot(),
      resumed = session({ kind: "resume", save }).host;
    resumed.step([]);
    expect(resumed.world!.pets[0]).toMatchObject({
      speciesId: 69,
      skillIds: pet.skillIds,
      skillPp: pet.skillPp,
    });
  });

  it("replaces a chosen skill after evolution with full PP and no badge cost", () => {
    const { host } = session(freeWorld());
    host.step([]);
    const world = host.world!,
      pet = world.pets[0],
      oldSkills = assets
        .petSkillPools!.entries(68)
        .filter((entry) => entry[2] === "a" && entry[1] <= 30)
        .slice(0, 5)
        .map((entry) => entry[0]);
    expect(oldSkills).toHaveLength(5);
    pet.skillIds = oldSkills;
    pet.skillPp = oldSkills.map(() => 1);
    world.currency.badges = 3;
    const candidates = reachPostEvolutionSkillQueue(host);
    expect(candidates.length).toBeGreaterThan(0);
    host.step(["confirm"]);
    host.step(["confirm"]);
    expect(host.panel.petStage).toBe("skillLearnReplace");
    host.step(["down"]);
    host.step(["confirm"]);
    expect(host.panel.petMessage?.text).toContain("Quên");
    host.step(["confirm"]);
    expect(pet.skillIds).toEqual([
      oldSkills[0],
      candidates[0],
      oldSkills[2],
      oldSkills[3],
      oldSkills[4],
    ]);
    expect(pet.skillPp).toEqual(assets.battleServices.progression.fullPp(pet.skillIds!));
    expect(world.currency.badges).toBe(3);
    const save = world.snapshot(),
      resumed = session({ kind: "resume", save }).host;
    resumed.step([]);
    expect(resumed.world!.pets[0].skillIds).toEqual(pet.skillIds);
    expect(resumed.world!.pets[0].skillPp).toEqual(pet.skillPp);
  });

  it("restores and resolves a persisted post-battle level-up skill before world input", () => {
    const save = scene1Save({
        location: {
          sceneId: contract.save.scene,
          roomIndex: contract.save.room,
          x: contract.save.x,
          y: contract.save.y,
          direction: 1,
        },
        owner: SCENE1_RESUME.bunnyCapture,
        bunnyCaught: false,
        pets: [{ speciesId: 68, level: 30, quality: 2 }],
      }),
      pet = save.pets[0],
      equipped = assets
        .petSkillPools!.entries(68)
        .filter((entry) => entry[2] === "a" && entry[1] <= pet.level)
        .slice(0, 4)
        .map((entry) => entry[0]),
      incoming = assets
        .petSkillPools!.entries(68)
        .find((entry) => entry[2] === "a" && !equipped.includes(entry[0]))![0];
    pet.skillIds = equipped;
    pet.skillPp = equipped.map(() => 1);
    save.pendingSkillLearns = [{ petSlot: 0, skillId: incoming }];
    const { host } = session({ kind: "resume", save });
    host.step([]);
    expect([host.panel.visible, host.panel.mode, host.panel.petStage]).toEqual([
      true,
      "pet",
      "skillLearn",
    ]);
    host.step(["confirm"]);
    host.step(["confirm"]);
    expect(host.world!.pets[0].skillIds).toContain(incoming);
    expect(host.world!.pendingSkillLearns).toEqual([]);
    expect(host.panel.visible).toBe(false);
    expect(host.world!.snapshot().pendingSkillLearns).toEqual([]);
  });

  it("keeps a declined post-battle skill until the JavaSE confirmation is accepted", () => {
    const save = scene1Save({
      location: {
        sceneId: contract.save.scene,
        roomIndex: contract.save.room,
        x: contract.save.x,
        y: contract.save.y,
        direction: 1,
      },
      owner: SCENE1_RESUME.bunnyCapture,
      bunnyCaught: false,
      pets: [{ speciesId: 68, level: 30, quality: 2 }],
    });
    save.pendingSkillLearns = [{ petSlot: 0, skillId: 1070 }];
    const { host } = session({ kind: "resume", save });
    host.step([]);
    host.step(["back"]);
    expect(host.panel.petMessage?.text).toBe("Từ bỏ học #1070?");
    expect(host.world!.pendingSkillLearns).toHaveLength(1);
    host.step(["back"]);
    expect(host.world!.pendingSkillLearns).toHaveLength(1);
    host.step(["back"]);
    host.step(["confirm"]);
    expect(host.world!.pendingSkillLearns).toEqual([]);
    expect(host.panel.visible).toBe(false);
  });

  it("a healing item from the bag picks its pet (state 17) and is used up there", () => {
    const { host } = session(freeWorld());
    host.step([]);
    const world = host.world!,
      pet = world.pets[0];
    pet.currentHp = 1;
    world.inventory["4"] = 2;
    host.step(["back"]);
    for (let i = 0; i < MENU_ROW_BAG; i++) host.step(["down"]);
    host.step(["confirm"]);
    while (host.panel.bagSelectedRow?.id !== 4) host.step(["down"]);
    host.step(["confirm"]);
    expect([host.panel.mode, host.panel.petPurpose, host.panel.petItem]).toEqual([
      "pet",
      "useItem",
      4,
    ]);
    host.step(["confirm"]);
    expect(host.panel.petMessage?.text).toBe("Thành công sử dụng đạo cụ");
    expect(pet.currentHp).toBeGreaterThan(1);
    expect(world.inventory["4"]).toBe(1);
    host.step(["confirm"]);
    // Back returns to the bag.
    host.step(["back"]);
    expect([host.panel.mode, host.panel.bagTab]).toEqual(["bag", 0]);
  });

  it("Đạo cụ lists the non-ball consumables in choice.ui; a refusal stays, a use returns", () => {
    const { host } = session(freeWorld());
    host.step([]);
    const world = host.world!,
      pet = world.pets[0];
    world.inventory["0"] = 3; // a ball: channel 0, never listed
    world.inventory["4"] = 2;
    host.step(["back"]);
    for (let i = 0; i < MENU_ROW_PET; i++) host.step(["down"]);
    host.step(["confirm"]);
    host.step(["confirm"]);
    host.step(["confirm"]); // petsetting row 0
    expect(host.panel.petStage).toBe("itemChoice");
    const view = host.panel.petChoiceView!;
    expect([view.title, view.subtitle, view.action]).toEqual(["Đạo cụ", "Số lượng", "Sử dụng"]);
    expect(view.rows.map((row) => row.id)).not.toContain(0);
    const sandwich = view.rows.findIndex((row) => row.id === 4);
    expect(view.rows[sandwich]?.value).toBe("2");
    for (let i = 0; i < sandwich; i++) host.step(["down"]);
    // Full HP: the refusal shows over the list and the list stays.
    host.step(["confirm"]);
    expect(host.panel.petMessage?.text).toBe("Máu đầy, không cần sử dụng");
    host.step(["confirm"]);
    expect(host.panel.petStage).toBe("itemChoice");
    pet.currentHp = 1;
    host.step(["confirm"]);
    expect([host.panel.petStage, host.panel.petMessage?.text]).toEqual([
      "list",
      "Thành công sử dụng đạo cụ",
    ]);
    expect(world.inventory["4"]).toBe(1);
    // The list keeps its row when it opens again.
    host.step(["confirm"]);
    host.step(["confirm"]);
    host.step(["confirm"]);
    expect(host.panel.itemChoice.selected).toBe(sandwich);
    host.step(["back"]);
    expect(host.panel.petStage).toBe("list");
  });

  it("Kỹ năng opens QUẢN LÝ KỸ NĂNG on TRANG BỊ; BỂ CHIÊU lists the family pool", () => {
    const { host } = session(freeWorld());
    host.step([]);
    const world = host.world!;
    world.pets[0].level = 30;
    host.step(["back"]);
    for (let i = 0; i < MENU_ROW_PET; i++) host.step(["down"]);
    host.step(["confirm"]);
    host.step(["confirm"]);
    for (let i = 0; i < 4; i++) host.step(["down"]);
    host.step(["confirm"]); // petsetting row 4
    expect(host.panel.petStage).toBe("skill");
    let view = host.panel.petSkillView!;
    expect([view.pool, view.selected, view.action]).toEqual([false, 0, "Đổi tab"]);
    expect(view.rows.length).toBe(view.equippedCount);
    expect(view.rows.every((row) => row.status === "Đang dùng")).toBe(true);
    expect(view.detail.meta).toMatch(/^Hệ .+ {2}\| {2}Lực .+ {2}\| {2}PP \d+\/\d+$/);
    host.step(["right"]);
    view = host.panel.petSkillView!;
    expect(view.pool).toBe(true);
    expect(view.poolTotal).toBeGreaterThan(view.equippedCount);
    // An open skill the pet no longer uses offers a relearn for one badge, which the web lacks.
    const open = view.rows.findIndex((row) => row.state === 1);
    expect(open).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < open; i++) host.step(["down"]);
    view = host.panel.petSkillView!;
    expect(view.action).toBe("Học lại - 1 HH");
    expect(view.detail.description.startsWith("Giá: 1 Huy hiệu. ")).toBe(true);
    expect(view.scroll).toBe(Math.max(0, open - 3));
    host.step(["confirm"]);
    expect(host.panel.petMessage?.text).toBe("Không đủ Huy hiệu để học lại kỹ năng.");
    host.step(["confirm"]);
    expect(host.panel.petStage).toBe("skill");
    host.step(["back"]);
    expect(host.panel.petStage).toBe("list");
  });

  it("Nâng phẩm opens on the selected pet and returns to the list on Back", () => {
    const { host } = session(freeWorld());
    host.step([]);
    const world = host.world!;
    world.pets.push({ ...world.pets[0], slot: 1, level: 3, quality: 1 });
    world.campaign.petBank.push({ ...world.pets[0], slot: 0, level: 2, quality: 1 });
    host.step(["back"]);
    for (let i = 0; i < MENU_ROW_PET; i++) host.step(["down"]);
    host.step(["confirm"]);
    host.step(["confirm"]);
    for (let i = 0; i < 5; i++) host.step(["down"]);
    host.step(["confirm"]); // petsetting row 5
    expect(host.panel.petStage).toBe("quality");
    const quality = host.panel.petQuality!;
    expect(quality.main).toBe(world.pets[0]);
    // The leader is the main pet; the second, same species with fewer stars, is a phôi.
    host.step(["confirm"]);
    expect(quality.candidates).toEqual([world.pets[1], world.campaign.petBank[0]]);
    expect(quality.candidateLocation(world.campaign.petBank[0])).toBe("Ngân hàng");
    host.step(["back"]);
    host.step(["back"]);
    expect([host.panel.petStage, host.panel.selected]).toEqual(["list", 0]);
  });

  it.each([
    { roll: 0, outcome: "SUCCESS", stars: 3 },
    { roll: 9999, outcome: "FAILURE", stars: 2 },
  ])(
    "saves a committed quality upgrade ($outcome) exactly once",
    async ({ roll, outcome, stars }) => {
      const { host, saves, repository } = session(freeWorld());
      const world = host.world!;
      vi.spyOn(world, "worldRandomBounded").mockReturnValue(roll);
      world.pets.push({ ...world.pets[0], slot: 1, quality: 1, heldEquipmentId: 4 });
      const upgrade = host.panel.petSource.openQuality(0)!;
      upgrade.tick(["confirm"]);
      upgrade.tick(["confirm"]);
      upgrade.tick(["left"]);
      upgrade.tick(["confirm"]);
      expect(saves.pending).toBe(0);
      for (let i = 0; i < 100 && !upgrade.result; i++) upgrade.tick([]);
      expect(upgrade.result?.outcome).toBe(outcome);
      expect(saves.pending).toBe(1);
      for (let i = 0; i < 100; i++) upgrade.tick([]);
      expect(saves.pending).toBe(1);
      await saves.flush();
      const persisted = await repository.load();
      expect(persisted?.pets.map((pet) => pet.quality)).toEqual([stars]);
      expect(persisted?.inventory.equipment).toContain(4);
    },
  );

  it("Vật phẩm trang sức puts a piece on, takes it from another pet, and takes it off", () => {
    const { host } = session(freeWorld());
    host.step([]);
    const world = host.world!;
    world.pets.push({ ...world.pets[0], slot: 1, speciesId: 58, level: 5, heldEquipmentId: 1 });
    world.bag.equipment.push(0);
    host.step(["back"]);
    for (let i = 0; i < MENU_ROW_PET; i++) host.step(["down"]);
    host.step(["confirm"]);
    host.step(["confirm"]);
    host.step(["down"]);
    host.step(["down"]);
    host.step(["confirm"]); // petsetting row 2
    expect(host.panel.petStage).toBe("equipChoice");
    let view = host.panel.petChoiceView!;
    expect(view.rows.map((row) => [row.id, row.value])).toEqual([
      [0, ""],
      [1, "Bị mang theo"],
    ]);
    expect(view.action).toBe("Mang theo");
    host.step(["down"]);
    host.step(["confirm"]);
    expect(host.panel.petMessage?.text).toBe("Thành công mang theo");
    expect(world.pets.map((p) => p.heldEquipmentId)).toEqual([1, -1]);
    host.step(["confirm"]);
    expect(host.panel.petStage).toBe("list");
    host.step(["confirm"]);
    host.step(["confirm"]);
    view = host.panel.petChoiceView!;
    expect([view.rows[1].value, view.action]).toEqual(["Đã mang theo", "Dỡ xuống"]);
    host.step(["confirm"]);
    expect(host.panel.petMessage?.text).toBe("Thành công dỡ xuống");
    expect(world.pets[0].heldEquipmentId).toBe(-1);
  });

  it.each([
    { x: 80, edge: 14, hover: false, equipped: 1 },
    { x: 80, edge: 5, hover: true, equipped: 1 },
    { x: 184, edge: 5, hover: false, equipped: -1 },
  ])(
    "uses the clicked equipment row at x=$x, edge=$edge, hover=$hover",
    ({ x, edge, hover, equipped }) => {
      const { host } = session(freeWorld());
      host.step([]);
      const world = host.world!;
      world.bag.equipment.push(0, 1, 2, 3, 4, 5);
      host.panel.openPets();
      host.step(["confirm"]);
      host.step(["down"]);
      host.step(["down"]);
      host.step(["confirm"]);
      expect(host.panel.petStage).toBe("equipChoice");
      const choice = sources.layouts.get("choice")!;
      const row = choice.widget(16)!;
      if (!host.pointerPress(x, row.y + edge)) host.pointer(x, row.y + edge);
      if (hover) host.pointerMove(80, choice.widget(21)!.y + 5);
      host.step([]);
      expect(world.pets[0].heldEquipmentId).toBe(equipped);
      if (equipped < 0) {
        expect(host.panel.petChoiceView?.scroll).toBe(1);
        const last = choice.widget(31)!;
        expect(host.pointerPress(80, last.y + 5)).toBe(false);
        host.pointer(80, last.y + 5);
        host.step([]);
        expect(world.pets[0].heldEquipmentId).toBe(5);
      }
    },
  );

  it("Đồ giám: record.ui asks for the pet book, then petmap.ui and badge.ui navigate as JavaSE", () => {
    const { host } = session(freeWorld());
    host.step([]);
    const world = host.world!;
    host.step(["back"]);
    for (let i = 0; i < MENU_ROW_RECORD; i++) host.step(["down"]);
    host.step(["confirm"]);
    expect([host.panel.mode, host.panel.recordSelected]).toEqual(["record", 0]);
    expect(host.panel.recordSource.stats()).toMatchObject({ owned: 1, collected: 1 });
    // No Sủng vật sách tranh yet.
    host.step(["confirm"]);
    expect(host.panel.recordMessage?.text).toBe("Không đạt được sủng vật sách tranh đạo cụ");
    host.step(["confirm"]);
    expect([host.panel.mode, host.panel.recordMessage]).toEqual(["record", null]);
    world.bag.specials.push(5);
    host.step(["confirm"]);
    expect([host.panel.mode, host.panel.petmapTab, host.panel.selected]).toEqual(["petmap", 0, 0]);
    const leaderTab = assets.petStats.speciesRow(world.pets[0].speciesId)!.element;
    for (let i = 0; i < leaderTab; i++) host.step(["right"]);
    expect(host.panel.petmapTab).toBe(leaderTab);
    expect(
      host.panel.petmapRows.find((row) => row.speciesId === world.pets[0].speciesId)?.owned,
    ).toBe(true);
    host.step(["down"]);
    expect(host.panel.selected).toBe(Math.min(1, host.panel.petmapRows.length - 1));
    host.step(["back"]);
    expect([host.panel.mode, host.panel.recordSelected]).toEqual(["record", 0]);
    // Right picks the badges; the grid starts on Liệt Hỏa Chương.
    host.step(["right"]);
    host.step(["confirm"]);
    expect(host.panel.mode).toBe("badge");
    expect(host.panel.badgeEntries[0]).toMatchObject({
      name: "Liệt Hỏa Chương",
      status: "Chưa đạt",
    });
    host.step(["right"]);
    host.step(["down"]);
    expect(host.panel.selected).toBe(6);
    host.step(["back"]);
    expect([host.panel.mode, host.panel.recordSelected]).toEqual(["record", 1]);
    host.step(["back"]);
    expect([host.panel.mode, host.panel.selected]).toEqual(["gamemenu", MENU_ROW_RECORD]);
  });

  it("the bag's pet book and badge case open petmap.ui and badge.ui and come back to Đặc thù", () => {
    const { host } = session(freeWorld());
    host.step([]);
    const world = host.world!;
    world.bag.specials.push(5, 6);
    host.step(["back"]);
    for (let i = 0; i < MENU_ROW_BAG; i++) host.step(["down"]);
    host.step(["confirm"]);
    host.step(["left"]); // Đặc thù
    expect(host.panel.bagTab).toBe(3);
    const at = (id: number) => host.panel.bagRows.findIndex((row) => row.id === id);
    while (host.panel.selected < at(5)) host.step(["down"]);
    host.step(["confirm"]);
    expect(host.panel.mode).toBe("petmap");
    host.step(["back"]);
    expect([host.panel.mode, host.panel.bagTab, host.panel.selected]).toEqual(["bag", 3, at(5)]);
    while (host.panel.selected < at(6)) host.step(["down"]);
    host.step(["confirm"]);
    expect(host.panel.mode).toBe("badge");
    host.step(["back"]);
    expect([host.panel.mode, host.panel.bagTab, host.panel.selected]).toEqual(["bag", 3, at(6)]);
  });

  it("keeps equipment, materials and specials in the save", () => {
    const { host } = session(freeWorld());
    host.step([]);
    const world = host.world!;
    world.bag.equipment.push(3);
    world.bag.materials["12"] = 4;
    world.bag.specials.push(5);
    const save = host.snapshot(world);
    expect(save.inventory).toMatchObject({ equipment: [3], materials: { "12": 4 }, specials: [5] });
    const again = session({ kind: "resume", save }).host;
    again.step([]);
    expect(again.world!.bag).toEqual({ equipment: [3], materials: { "12": 4 }, specials: [5] });
  });

  it("the HUD map button opens the original area map of the hero's area", () => {
    const { host } = session(freeWorld());
    host.step([]);
    const world = host.world!;
    expect([world.sceneId, world.roomIndex]).toEqual([1, 1]);
    host.pressHudButton(world, "map");
    const view = host.panel.areaMap!;
    expect([host.panel.mode, view.area, view.heroBox]).toEqual(["areaMap", 0, 1]);
    expect(view.data!.rooms[view.heroBox].name).toBe("Đường nhỏ phía Đông");
    // Room 1:1's one visible door, at map pixel (19, 273) of its 448 x 320 map.
    expect(view.doors).toEqual([{ x: 19, y: 273, direction: 2 }]);
    // The opening slide runs 8 px a tick; Back does nothing until it has stopped.
    host.step(["back"]);
    expect(host.panel.visible).toBe(true);
    for (let i = 0; i < 60 && view.sliding; i++) host.step([]);
    expect(view.sliding).toBe(false);
    host.step(["back"]);
    expect(host.panel.visible).toBe(false);
  });

  it("an area without a map says so (Đạo quán scenes are in the source's no-map list)", () => {
    const { host } = session(freeWorld());
    host.step([]);
    const world = host.world!;
    world.sceneId = 9;
    host.openAreaMap(world);
    expect([host.panel.mode, host.panel.notice]).toEqual(["notice", "Khu này không có bản đồ"]);
  });

  it("opens task.ui from the task shortcut, and Back returns straight to the map", () => {
    const { host } = session(freeWorld());
    host.step([]);
    const world = host.world!;
    host.pointer(SHORTCUT_TOGGLE.x + 3, SHORTCUT_TOGGLE.y + 3);
    for (let i = 0; i < 5; i++) host.step([]);
    host.pointer(50, 290);
    expect([host.panel.visible, host.panel.mode, host.panel.taskTab]).toEqual([true, "task", 0]);
    expect(host.panel.taskRows.map((row) => row.title)).toEqual(["Vòng loại sơ khảo"]);
    expect(host.panel.taskRows[0].detail).toContain("#2[");
    const { x, y } = world.player;
    host.step(["holdRight"]);
    expect([world.player.x, world.player.y]).toEqual([x, y]);
    host.step(["back"]);
    expect(host.panel.visible).toBe(false);
    // Key 9 on foot opens ride.ui (`openRideFromWorld`), owned rides or not.
    host.pressRide(world);
    expect(host.panel.mode).toBe("ride");
  });

  it("toggles x2 from the checkbox through the app's clock", () => {
    let speed = false;
    const saves = new SaveService(new SaveRepository(new MemorySaveStore())),
      host = new GameplayHost(
        sources,
        saves,
        {
          onExit: () => {},
          speedX2: { enabled: () => speed, toggle: () => (speed = !speed) },
        },
        freeWorld(),
      );
    host.step([]);
    waitOutMapLoading(host);
    host.pointer(200, 10);
    expect(speed).toBe(true);
  });
});

describe("map-loading screen on a room swap (VqsvMapLoadingRuntime)", () => {
  /** A host whose own construction is under test, so the first screen is not waited out. */
  const bare = (start: SessionStart) =>
    new GameplayHost(
      sources,
      new SaveService(new SaveRepository(new MemorySaveStore())),
      { onExit: () => {} },
      start,
    );

  it("opens the session's first room behind the screen, which samples no input", () => {
    const host = bare(freeWorld()),
      world = host.world!,
      { x, y, direction } = world.player,
      ticks = world.tickCount;
    expect(host.mapLoadingActive).toBe(true);
    for (let i = 0; i < MAP_LOADING_TOTAL_TICKS - 1; i++) {
      expect(host.step(["right", "holdRight"])).toBe("world");
      expect(host.pointer(120, 200)).toEqual([]);
      expect(host.pointerPress(120, 200)).toBe(false);
    }
    expect([world.player.x, world.player.y, world.player.direction]).toEqual([x, y, direction]);
    expect(world.tickCount).toBe(ticks);
    expect(host.mapLoadingActive).toBe(true);
    host.step([]);
    expect(host.mapLoadingActive).toBe(false);
    expect(world.phase).toBe("freeworld");
  });

  it("shows the screen again on arrival through a source doorway", () => {
    const { host } = session({
      kind: "resume",
      save: scene1Save({
        location: { sceneId: 1, roomIndex: 1, x: 19, y: 273, direction: 3 },
        owner: SCENE1_RESUME.bunnyReturnRoom0,
        bunnyCaught: true,
        eventStates: { "1:1:0": 3 },
        pets: [
          { speciesId: 68, level: 7, quality: 2 },
          { speciesId: 34, level: 5, quality: 1 },
        ],
      }),
    });
    expect(host.world!.roomIndex).toBe(1);
    // The save stands on the room 1:1 doorway facing into it, so the first probe walks through.
    host.step([]);
    expect(host.world!.roomIndex).toBe(0);
    expect(host.mapLoadingActive).toBe(true);
    const { x, y } = host.world!.player;
    for (let i = 0; i < 10; i++) expect(host.step(["holdRight"])).toBe("world");
    expect([host.world!.player.x, host.world!.player.y]).toEqual([x, y]);
    waitOutMapLoading(host);
    // This save resumes a caught bunny, whose room 1 is the hand-in phase: the screen must release
    // back into the walking phase it was holding, not into a story or battle owner.
    expect(host.world!.phase).toBe("returnWorld");
  });

  it("keeps a reload of the room the hero already stands in off the screen", () => {
    const { host } = session(freeWorld()),
      world = host.world!,
      { x, y } = world.player;
    expect(world.warp({ scene: world.sceneId, room: world.roomIndex, x, y, direction: 1 })).toBe(
      true,
    );
    expect(host.mapLoadingActive).toBe(false);
    expect(world.warp({ scene: 1, room: 0, x: 190, y: 300, direction: 1 })).toBe(true);
    expect(host.mapLoadingActive).toBe(true);
  });
});

describe("GameplayHost story director", () => {
  it("resumes an old Scene 1 save on the node its activeTask names", () => {
    const { host } = session(freeWorld());
    expect(host.director?.node.id).toBe("bunny-capture");
    expect(host.director?.mainTask).toBe(0);
  });

  it("starts a new game on the opening and enters the bunny hunt when the world opens", () => {
    const { host } = session({ kind: "opening" });
    expect(host.director?.node.id).toBe("opening");
    const skipped = session({ kind: "skipIntro" }).host;
    for (let i = 0; i < 30000 && !skipped.story.worldActive; i++)
      skipped.step(i % 7 === 6 ? ["confirm"] : []);
    skipped.step([]);
    expect(skipped.director?.node.id).toBe("bunny-capture");
    expect(skipped.director?.log.main).toBe(0);
  });

  it("moves to the elder's challenge when his return group closes", () => {
    const { host } = session({
      kind: "resume",
      save: scene1Save({
        location: { sceneId: 1, roomIndex: 1, x: 19, y: 273, direction: 3 },
        owner: SCENE1_RESUME.bunnyReturnRoom0,
        bunnyCaught: true,
        eventStates: { "1:1:0": 3 },
        pets: [
          { speciesId: 68, level: 7, quality: 2 },
          { speciesId: 34, level: 5, quality: 1 },
        ],
      }),
    });
    expect(host.director?.node.id).toBe("return-to-elder");
    host.step([]);
    waitOutMapLoading(host);
    expect(host.world!.roomIndex).toBe(0);
    host.world!.player.x = 200;
    host.world!.player.y = 190;
    host.step(["confirm"]);
    reachElderBattle(host);
    // The graph edge hangs on the group's own ledger write, so the director moves without a cutscene.
    expect(host.director?.node.id).toBe("elder-challenge");
    // The challenge is fought now, so the ladder does not end here.
    expect(host.director?.atFrontier).toBe(false);
    expect(host.director?.log.main).toBe(1);
  });
});
