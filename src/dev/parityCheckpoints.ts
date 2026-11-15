// Dev-only parity harness: replays source events to deterministic Java checkpoints.
// Invoked exclusively via URL checkpoint params (see GameApp); never runs in normal play.
import type { NewGameScreen } from "../screens/NewGameScreen";
import { createDoubleBattle } from "../game/battle/DoubleEventBattle";
import { TAN_NGUYET_BOSS } from "../game/battle/engine/TanNguyetLongMa";
import { requiredExp } from "../game/battle/engine/PetProgression";
import type { InputCommand } from "../core/input/GameCommand";
import {
  CURRENT_SAVE_VERSION,
  SAVE_FORMAT,
  type GameSave,
  type SavedPet,
} from "../persistence/save/GameSave";
import { SCENE1_RESUME, SCENE1_STORY } from "../persistence/save/migrations";
import type { EventStateSnapshot } from "../game/world/EventStateLedger";
import { battleUiState, type BattleUiMode, type BattleUiRow } from "../game/battle/BattleUiState";
import { MAP_LOADING_TOTAL_TICKS } from "../game/world/MapLoadingRuntime";
import {
  DIRECTION_LEFT,
  DIRECTION_RIGHT,
  DIRECTION_UP,
  stepWithTerrain,
  terrainAtWorld,
} from "../game/world/MapCollision";
import { CV_PLANT, CV_WATER, RAINBOW_RIDE_OWNED_EVENT } from "../game/ride/RideSystem";
import { roomEntryArrival } from "../game/world/WorldTransition";
import { BADGE_THUY_LAM } from "../game/world/WorldFlags";
import { CauVongMinigame } from "../game/world/CauVongMinigame";
import { SKILL_NOT_READY_WARNING } from "../game/battle/engine/BattleTypes";
import { plantStatusStrip } from "./statusStripRig";
import {
  MENU_ROW_BAG,
  MENU_ROW_PET,
  MENU_ROW_RECORD,
  MENU_ROW_SAVE,
  MENU_ROW_TASK,
  MENU_ROW_CHALLENGE,
  MENU_ROW_BATTLE_PASS,
} from "../game/world/WorldPanel";

/** `?worldPanel=`: the free-world plates, the two menus, or a gamemenu row's own panel. */
type WorldPanelCheckpoint =
  | "plates"
  | "menu"
  | "system"
  | "save"
  | "task"
  | "bag"
  | "pet"
  | "skillLearn"
  | "areaMap"
  | "record"
  | "portableShop"
  | "dailyBadge"
  | "fashionShop"
  | "fashionBuy"
  | "fashionOpen"
  | "fashionExchange"
  | "worldShop"
  | "convenience"
  | "petBank"
  | "egg"
  | "repelPrompt"
  | "wardrobe"
  | "challenge"
  | "giftCode"
  | "battlePass"
  | "battlePassHelp"
  | "ride"
  | "charm";
/** A Scene 1 tutorial save at a scripted position, in the current schema. */
export function scene1Save(options: {
  location: GameSave["location"];
  owner: string;
  bunnyCaught: boolean;
  eventStates?: EventStateSnapshot;
  pets: SavedPet[];
}): GameSave {
  return {
    format: SAVE_FORMAT,
    version: CURRENT_SAVE_VERSION,
    savedAt: new Date(0).toISOString(),
    location: options.location,
    resume: { owner: options.owner },
    progress: {},
    story: { [SCENE1_STORY]: { bunnyCaught: options.bunnyCaught, elderComplete: false } },
    repelSteps: 0,
    pendingSkillLearns: [],
    ...(options.eventStates ? { eventStates: options.eventStates } : {}),
    inventory: { items: { "0": 1, "1": 2, "4": 5 } },
    pets: options.pets,
  };
}
/**
 * A checkpoint means "the player is standing in this room", so it waits out the map-loading screen the
 * room swap starts. Java's capture tools drive the loaders directly and never sit behind that screen.
 */
function settleMapLoading(screen: NewGameScreen): void {
  for (let i = 0; i < 64 && screen.host.mapLoadingActive; i++) screen.step([]);
}
function frozenWorldSave(screen: NewGameScreen, save: GameSave): void {
  screen.host.story.enterWorld(screen.host.createWorld(save));
  screen.host.story.tick([]);
  settleMapLoading(screen);
}
function requireWorld(screen: NewGameScreen) {
  const world = screen.host.world;
  if (!world) throw new Error("Parity harness: world runtime was not entered");
  return world;
}
export function openingCheckpoint(screen: NewGameScreen): void {
  for (let i = 0; i < 500 && !screen.host.runtime.textReady; i++) screen.step([]);
  screen.step(["confirm"]);
  for (let i = 0; i < 45; i++) screen.step([]);
  screen.frozen = true;
}
export function narrationCheckpoint(screen: NewGameScreen, index: number): void {
  const narration = screen.host.runtime.program.events.filter(
      (event) => event.type === "text" && event.kind === "full",
    )[index],
    expected =
      narration?.type === "text" ? narration.text.replace(/#[0-9A-Fa-f]{6}/g, "") : undefined,
    waits = index === 0 || index === 10 || index === 11;
  if (expected === undefined) throw new RangeError(`Unknown source narration ${index}`);
  for (let i = 0; i < 20000; i++) {
    screen.step([]);
    if (screen.host.runtime.currentText === expected && (!waits || screen.host.runtime.textReady)) {
      screen.frozen = true;
      return;
    }
    if (screen.host.runtime.textReady) screen.host.runtime.confirm();
  }
  throw new Error(`Source narration ${index} was not reached`);
}
export function afterNarrationCheckpoint(screen: NewGameScreen, index: number, ticks = 12): void {
  narrationCheckpoint(screen, index);
  screen.frozen = false;
  screen.host.runtime.confirm();
  for (let i = 0; i < ticks; i++) screen.step([]);
  screen.frozen = true;
}
export function preludeTextCheckpoint(screen: NewGameScreen, index: number): void {
  screen.host.prelude = screen.host.createPrelude();
  const prelude = screen.host.prelude;
  let seen = 0,
    lastRevision = -1;
  for (let i = 0; i < 20000; i++) {
    prelude.tick();
    if (!prelude.currentText || !prelude.textReady || prelude.textRevision === lastRevision)
      continue;
    lastRevision = prelude.textRevision;
    if (seen++ === index) {
      screen.frozen = true;
      return;
    }
    prelude.confirm();
  }
  throw new Error(`Scene1 text checkpoint ${index} was not reached`);
}
export function preludeBattleCheckpoint(screen: NewGameScreen, index: number): void {
  screen.host.prelude = screen.host.createPrelude();
  const prelude = screen.host.prelude;
  let seen = 0,
    last = "";
  for (let i = 0; i < 20000; i++) {
    if (prelude.textReady) prelude.confirm();
    prelude.tick();
    const key = prelude.battle?.phase.key ?? "";
    if (!key || key === last) continue;
    last = key;
    if (seen++ === index) {
      screen.frozen = true;
      return;
    }
  }
  throw new Error(`Scene1 battle checkpoint ${index} was not reached`);
}
export function preludeBattleTickCheckpoint(screen: NewGameScreen, target: number): void {
  screen.host.prelude = screen.host.createPrelude();
  const prelude = screen.host.prelude;
  for (let i = 0; i < 20000; i++) {
    if (prelude.textReady) prelude.confirm();
    prelude.tick();
    if (prelude.battle?.sequenceTick === target) {
      screen.frozen = true;
      return;
    }
  }
  throw new Error(`Scene1 battle tick ${target} was not reached`);
}
export function preludeMovementCheckpoint(screen: NewGameScreen, target: number): void {
  screen.host.prelude = screen.host.createPrelude();
  const prelude = screen.host.prelude;
  for (let i = 0; i <= target; i++) {
    if (prelude.textReady) prelude.confirm();
    prelude.tick();
  }
  screen.frozen = true;
}
export function preludeCompleteCheckpoint(screen: NewGameScreen): void {
  screen.host.prelude = screen.host.createPrelude();
  const prelude = screen.host.prelude;
  for (let i = 0; i < 30000 && !prelude.complete; i++) {
    if (prelude.textReady) prelude.confirm();
    prelude.tick();
  }
  if (!prelude.complete) throw new Error("Scene1 route did not complete");
  screen.frozen = true;
}
export function preludeItemCheckpoint(screen: NewGameScreen, index: number): void {
  screen.host.prelude = screen.host.createPrelude();
  const prelude = screen.host.prelude;
  let seen = 0,
    lastRevision = -1;
  for (let i = 0; i < 30000; i++) {
    prelude.tick();
    if (
      prelude.textKind === "openbox" &&
      prelude.currentText &&
      prelude.textReady &&
      prelude.textRevision !== lastRevision
    ) {
      lastRevision = prelude.textRevision;
      if (seen++ === index) {
        screen.frozen = true;
        return;
      }
    }
    if (prelude.textReady) prelude.confirm();
  }
  throw new Error(`Scene1 item checkpoint ${index} was not reached`);
}
export function preludeTaskTipCheckpoint(screen: NewGameScreen): void {
  screen.host.prelude = screen.host.createPrelude();
  const prelude = screen.host.prelude;
  for (let i = 0; i < 30000; i++) {
    prelude.tick();
    if (prelude.textKind === "tasktip" && prelude.currentText) {
      for (let j = 0; j < 24; j++) prelude.tick();
      screen.frozen = true;
      return;
    }
    if (prelude.textReady) prelude.confirm();
  }
  throw new Error("Scene1 task-tip checkpoint was not reached");
}
export function worldSavePromptCheckpoint(screen: NewGameScreen): void {
  preludeCompleteCheckpoint(screen);
  screen.frozen = false;
  screen.step([]);
  settleMapLoading(screen);
  if (!screen.host.world?.savePromptVisible) throw new Error("Scene1 save prompt was not reached");
}
export function bunnyEntryCheckpoint(screen: NewGameScreen, target: number): void {
  const data = screen.assets.worldContract;
  const save = scene1Save({
    location: { sceneId: 1, roomIndex: 1, x: data.trigger.x, y: data.trigger.y, direction: 0 },
    owner: SCENE1_RESUME.bunnyCapture,
    bunnyCaught: false,
    pets: [{ speciesId: 68, level: 7, quality: 2 }],
  });
  frozenWorldSave(screen, save);
  for (let i = 0; i < target; i++) screen.host.story.tick([]);
  if (!requireWorld(screen).battleEntryVisible)
    throw new Error(`Bunny entry tick ${target} not active`);
  screen.frozen = true;
}
export function bunnyBattleCheckpoint(screen: NewGameScreen): void {
  const data = screen.assets.worldContract;
  const save = scene1Save({
    location: { sceneId: 1, roomIndex: 1, x: data.trigger.x, y: data.trigger.y, direction: 0 },
    owner: SCENE1_RESUME.bunnyCapture,
    bunnyCaught: false,
    pets: [{ speciesId: 68, level: 7, quality: 2 }],
  });
  frozenWorldSave(screen, save);
  for (let i = 0; i < 25; i++) screen.host.story.tick([]);
  const world = requireWorld(screen);
  if (!world.battleVisible || !world.battle)
    throw new Error("Bunny battle runtime was not reached");
  screen.frozen = true;
}
export function bunnySkillTickCheckpoint(
  screen: NewGameScreen,
  target: number,
  skillIndex = 0,
): void {
  bunnyBattleCheckpoint(screen);
  screen.frozen = false;
  screen.host.story.tick(["confirm"]);
  for (let i = 0; i < skillIndex; i++) screen.host.story.tick(["down"]);
  screen.host.story.tick(["confirm"]);
  for (let i = 1; i < target; i++) screen.host.story.tick([]);
  if (requireWorld(screen).battleStage !== "skillAction")
    throw new Error(`Bunny skill tick ${target} not active`);
  screen.frozen = true;
}
/**
 * Freeze at the fight stage immediately after the first strike, when the round-end heal has already
 * lifted the Bunny back to 71 HP. The HUD bar shows 71/135, not 44/135, proving the round-end pass ran.
 */
export function bunnyAfterStrikeCheckpoint(screen: NewGameScreen): void {
  bunnyBattleCheckpoint(screen);
  screen.frozen = false;
  screen.host.story.tick(["confirm"]);
  screen.host.story.tick(["confirm"]);
  for (let i = 0; i < 100 && requireWorld(screen).battleStage === "skillAction"; i++)
    screen.host.story.tick([]);
  if (requireWorld(screen).battleStage !== "fight")
    throw new Error(
      "Bunny after-strike checkpoint expected fight stage (round-end heal not applied)",
    );
  screen.frozen = true;
}
export function bunnyCaptureTickCheckpoint(
  screen: NewGameScreen,
  target: number,
  success = false,
): void {
  bunnyBattleCheckpoint(screen);
  screen.frozen = false;
  // World phase changes to `battle` before P0 finishes deploying. Run the remaining cpos/hold ticks
  // up to P1_DISPATCH so the first confirm is not (correctly) ignored by BattleRuntime.
  const battle = requireWorld(screen).battle!,
    dispatch = battle.definition.phases.find((phase) => phase.key === "P1_DISPATCH")?.start ?? 0;
  for (let i = 0; i < 80 && battle.sequenceTick < dispatch; i++) screen.host.story.tick([]);
  const strike = () => {
    if (requireWorld(screen).battleStage === "fight") screen.host.story.tick(["confirm"]);
    if (requireWorld(screen).battleStage === "skillList") screen.host.story.tick(["confirm"]);
    for (let i = 0; i < 100 && requireWorld(screen).battleStage === "skillAction"; i++)
      screen.host.story.tick([]);
  };
  // RESET_ROUND can heal Bunny back above the weak band. Drive complete authored actions until the
  // source's weak prompt actually owns the frame instead of assuming a damage roll count.
  for (let i = 0; i < 6 && requireWorld(screen).battleStage === "fight"; i++) strike();
  if (requireWorld(screen).battleStage !== "weak")
    throw new Error(`Bunny capture checkpoint stopped at ${requireWorld(screen).battleStage}`);
  if (requireWorld(screen).battleStage === "weak") screen.host.story.tick(["confirm"]);
  if (requireWorld(screen).battleStage === "sealList") screen.host.story.tick(["confirm"]);
  if (success) {
    for (let i = 0; i < 80 && requireWorld(screen).battleStage === "captureFail"; i++)
      screen.host.story.tick([]);
    // Core battles may play the opponent's remaining action and message beats after the failed ball.
    // Animations advance without input; only the visible retry/list prompts consume confirm.
    for (let i = 0; i < 500 && requireWorld(screen).battleStage !== "captureSuccess"; i++) {
      const stage = requireWorld(screen).battleStage;
      screen.host.story.tick(
        ["skillAction", "switching", "captureFail", "runExit"].includes(stage) ? [] : ["confirm"],
      );
    }
    if (requireWorld(screen).battleStage !== "captureSuccess")
      throw new Error(`Bunny success checkpoint stopped at ${requireWorld(screen).battleStage}`);
  }
  for (let i = 1; i < target; i++) screen.host.story.tick([]);
  if (!requireWorld(screen).battle?.captureVisual)
    throw new Error(`Bunny capture tick ${target} not active`);
  screen.frozen = true;
}
/** `&battleUiNature=<n>` gives the pet screen's pets and the level-up pet that nature (7..9: shiny). */
export function battleUiCheckpoint(
  screen: NewGameScreen,
  mode: BattleUiMode,
  tab = 0,
  nature?: number,
): void {
  bunnyBattleCheckpoint(screen);
  const rows: BattleUiRow[] = Array.from({ length: 7 }, (_, i) => ({
      name: [
        "Điện Cầu",
        "Gieo Hạt",
        "Phong ấn cầu",
        "Điện Miêu",
        "Bunny",
        "Thuốc hồi phục",
        "Tất Trung Cầu",
      ][i],
      value: i < 2 ? `${8 - i}/10` : String(i + 1),
      description: "Dữ liệu giao diện battle nguồn",
      iconCell: i,
      currency: i === 1 ? 1 : 0,
    })),
    ui = {
      ...battleUiState(mode),
      tab: Math.max(0, Math.min(3, tab)),
      title: mode,
      prompt: "Xác nhận",
      selectedIndex: 1,
      rows,
      description: "Mô tả lựa chọn battle engine",
      targetName: "Thỏ Di Lặc Bunny",
      message: "Thông báo battle engine",
      levelUp: {
        name: "Điện Miêu",
        level: 8,
        nature,
        oldStats: [179, 72, 60, 48] as [number, number, number, number],
        newStats: [196, 79, 66, 53] as [number, number, number, number],
      },
      shopTotal: 500,
      shopMoney: 12_500,
      shopBadges: 8,
      shopCurrency: 0,
    };
  if (mode === "CHOICE") {
    const items = [
      ["Cao cấp cầu", 27, "19"],
      ["Đại sư cầu", 28, "26"],
      ["Bánh Sandwich", 29, "33"],
      ["Chocolate", 30, "40"],
      ["Sinh mệnh thạch", 36, "47"],
    ] as const;
    rows.length = items.length;
    rows.forEach((row, i) => {
      row.name = items[i][0];
      row.iconCell = items[i][1];
      row.value = items[i][2];
      row.description =
        i === 2 ? "Khôi phục một phần trị số sinh mạng sủng vật." : "Dữ liệu vật phẩm nguồn.";
    });
    ui.selectedIndex = 2;
  }
  if (mode === "PET_STATE") {
    const names = ["Điện Miêu", "Diệp Tán Oa", "Thỏ Di Lặc", "Hỏa Điểu", "Thủy Linh", "Mộc Thú"];
    rows.length = 6;
    rows.forEach((row, i) => {
      row.name = names[i];
      row.value = `${135 - i * 8}/${155 - i * 4}`;
      row.enabled = i !== 0;
      row.pet = {
        spriteId: [154, 162, 120, 151, 89, 95][i],
        nature,
        element: [4, 1, 2, 0, 3, 1][i],
        elementName: ["Điện", "Mộc", "Thổ", "Hỏa", "Thủy", "Mộc"][i],
        level: 7 + i,
        hp: 135 - i * 8,
        maxHp: 155 - i * 4,
        expPercent: 18 + i * 11,
        quality: Math.min(5, 2 + (i % 4)),
        status: i === 0 ? "Đang ra trận" : "Sẵn sàng",
        held: i === 0 ? "Sinh mệnh thạch" : "Trống",
        stats: [155 - i * 4, 72 + i * 6, 60 + i * 4, 48 + i * 3],
        trait: { name: "Hòa trộn", description: "Đặc tính nguồn của sủng vật đang chọn." },
        talent: { name: "Hiếu phúc tự nhiên", description: "Thiên phú được lưu cùng Pet." },
        skills: Array.from({ length: 5 }, (_, slot) => ({
          name: ["Điện giật", "Dương viêm", "Điện kích", "Nạp Điện", "Linh Xuyên Điệp"][slot],
          pp: `${30 - slot * 3}/${30 - slot * 2}`,
          element: [4, 0, 4, 4, 1][slot],
        })),
      };
    });
  }
  requireWorld(screen).battle!.setUiState(ui);
}
/**
 * The room 1:0 notice is an op13 rect group, so this walks the data-driven dispatch: the
 * world starts the group from the decoded catalog and renders the group's own text.
 */
export function worldEventCheckpoint(screen: NewGameScreen, target: number): void {
  // Stand 12px into the notice's op13 rect: (190, 300) on the JAR data, lower on the APK's.
  const rect = screen.host.story.sourceData
    ?.group(1, 0, 1)
    ?.records.find((record) => record.opcode === 13)?.short_args;
  const save = scene1Save({
    location: { sceneId: 1, roomIndex: 0, x: 190, y: (rect?.[1] ?? 288) + 12, direction: 1 },
    owner: SCENE1_RESUME.bunnyCapture,
    bunnyCaught: false,
    pets: [{ speciesId: 68, level: 7, quality: 2 }],
  });
  frozenWorldSave(screen, save);
  for (let i = 1; i < target; i++) screen.host.story.tick([]);
  if (!requireWorld(screen).eventVisible)
    throw new Error(`World event tick ${target} is not dispatching a group`);
  screen.frozen = true;
}
/**
 * The Elder's return dialog is an ordinary free-world group (`1:0:2`: an op16 actor trigger behind
 * an op86 gate on the bunny-return notice), so this walks the same data-driven dispatch the player
 * does: cross the room 1:1 doorway, stand on the Elder, press confirm. The screen keeps running so
 * the dialog plays from its first page.
 */
export function worldElderCheckpoint(screen: NewGameScreen): void {
  const save = scene1Save({
    location: { sceneId: 1, roomIndex: 1, x: 19, y: 273, direction: 3 },
    owner: SCENE1_RESUME.bunnyReturnRoom0,
    bunnyCaught: true,
    eventStates: { "1:1:0": 3 },
    pets: [
      { speciesId: 68, level: 7, quality: 2 },
      { speciesId: 34, level: 5, quality: 1 },
    ],
  });
  frozenWorldSave(screen, save);
  const world = requireWorld(screen);
  // The save starts on the room 1:1 doorway, so the first probe must walk through it.
  if (world.roomIndex !== 0) throw new Error("Elder checkpoint did not cross the source doorway");
  world.player.x = 200;
  world.player.y = 190;
  screen.host.story.tick(["confirm"]);
  const event = world.eventScene;
  if (!event || event.program.id !== "world:1:0:2")
    throw new Error("Elder interaction did not dispatch its own op16 group");
}
/** How far behind the hero Java's 4 px interaction probe reaches: 20 px north still overlaps the actor. */
const ACTIVATION_GAP = 20;
/**
 * One tick of the Elder's chain, the way the source plays it. Village group `1:0:3` is an op38 wait:
 * Java checks the actor the hero happens to face, so the probe parks him on the tile in front of the
 * first starter the record lists and presses the key. The op35 box then opens on its default row, and
 * every other record advances on the confirm key once its text is ready.
 */
function tickElderChain(screen: NewGameScreen, starter: number): void {
  const world = requireWorld(screen),
    scene = world.eventScene,
    ids = scene?.activationIds ?? [];
  const actor = ids.length ? world.actors.get(starter >= 0 ? starter : ids[0]) : undefined;
  if (actor?.visible) {
    world.player.x = actor.x;
    world.player.y = actor.y + ACTIVATION_GAP;
    world.player.direction = DIRECTION_UP;
    screen.host.story.tick(["confirm"]);
    return;
  }
  screen.host.story.tick(scene && (scene.choice || scene.textReady) ? ["confirm"] : []);
}
/**
 * The Elder's challenge as a fight on the world's own battle screen. The chain is driven through the
 * return dialog `1:0:2` and the gated link `1:0:3` — including the village starter offer, where the
 * hero walks up to a pet and answers the box — until the challenge group `1:0:6` opens its op32, then
 * the frame is held on the first live battle tick: the elder's pet at the level and phẩm chất the
 * descriptor and the AI row project, the player's party behind it, command bar and both HUDs drawn.
 */
export function worldElderBattleCheckpoint(screen: NewGameScreen, starter = -1): void {
  worldElderCheckpoint(screen);
  const world = requireWorld(screen);
  for (let i = 0; i < 30000 && !world.battle; i++) tickElderChain(screen, starter);
  const battle = world.battle;
  if (!battle) throw new Error(`Elder chain never reached its op32 battle (phase ${world.phase})`);
  for (let i = 0; i < 60 && world.phase === "battleEntry"; i++) screen.host.story.tick([]);
  if (world.phase !== "battle")
    throw new Error(`Elder battle did not come out of its entry splash (${world.phase})`);
  screen.frozen = true;
}
/** Hold the authored group-6 fade after the starter group has hidden its three display pets. */
export function worldElderTransitionCheckpoint(screen: NewGameScreen, target = 8): void {
  worldElderCheckpoint(screen);
  const world = requireWorld(screen);
  for (let i = 0; i < 30000; i++) {
    const scene = world.eventScene;
    if (
      scene?.program.id === "world:1:0:6" &&
      scene.effect === "fade-in" &&
      scene.effectTick >= target
    ) {
      screen.frozen = true;
      return;
    }
    tickElderChain(screen, -1);
  }
  throw new Error("Elder transition checkpoint did not reach group 1:0:6 fade-in");
}
/**
 * The same chain driven past the fight, so the village opening is on screen: the elder's challenge is
 * won by holding his pet one hit from the edge every turn - the roster, levels, thiên phú, brain and
 * turns are his own, only the margin is borrowed - and then the group's reward records are played to
 * the end, which is what closes `1:0:4`, `1:0:5` and `1:0:6` and writes the task ladder.
 */
export function worldElderCompleteCheckpoint(screen: NewGameScreen, starter = -1): void {
  worldElderBattleCheckpoint(screen, starter);
  const world = requireWorld(screen),
    battle = world.battle;
  if (!battle) throw new Error("Elder battle checkpoint lost its runtime");
  screen.frozen = false;
  for (let i = 0; i < 30000 && world.phase === "battle"; i++) {
    const foe = battle.core!.activeUnit("enemy");
    if (foe.alive()) foe.setHp(1);
    screen.host.story.tick(["confirm"]);
  }
  for (let i = 0; i < 30000 && world.eventVisible; i++) tickElderChain(screen, -1);
  for (const group of [2, 3, 4, 5, 6])
    if (world.eventState.sourceEventState(1, 0, group) !== 3)
      throw new Error(`Elder chain group 1:0:${group} did not close`);
  if (world.questState.mainTaskProgress !== 2)
    throw new Error("Elder chain wrote the task ladder outside its own op45 records");
  screen.frozen = true;
}
/** The Elder win held on JavaSE P8, with the real party save one visible EXP step from level-up. */
export function postBattleExpCheckpoint(screen: NewGameScreen, ticks = 0): void {
  worldElderBattleCheckpoint(screen);
  const world = requireWorld(screen),
    battle = world.battle,
    pet = world.pets[0];
  if (!battle || !pet) throw new Error("Post-battle EXP checkpoint lost its party battle");
  pet.experience = Math.max(0, requiredExp(pet.level + 1) - 16);
  screen.frozen = false;
  for (let i = 0; i < 30000 && battle.interactiveStage !== "experience"; i++) {
    const foe = battle.core!.activeUnit("enemy");
    if (foe.alive()) foe.setHp(1);
    screen.host.story.tick(["confirm"]);
  }
  if (battle.interactiveStage !== "experience")
    throw new Error(`Post-battle EXP checkpoint stopped on ${battle.interactiveStage}`);
  for (let i = 0; i < Math.max(0, ticks) && battle.interactiveStage === "experience"; i++)
    screen.host.story.tick([]);
  screen.frozen = true;
}
export function resumeCheckpoint(screen: NewGameScreen): void {
  if (screen.host.prelude)
    screen.host.story.register(screen.host.prelude).switchTo(screen.host.prelude.id);
  screen.frozen = false;
}
/**
 * The bunny fight with both status strips full, so the HUD's whole walk is on one frame.
 *
 * A tutorial fight carries at most a buff or two, which shows one slot and argues about the rest. This
 * plants `STATUS_STRIP_CHECKPOINT` on both units through the battle's own status owner, so the player's
 * side shows the opening-pressure badge ahead of five statuses and stops at the six-slot cap, while the
 * enemy's side shows the round-robin across all three banks — including the one Cầu Vồng status the
 * source has no picture bytes for, which draws its numeral and no icon.
 */
export function statusStripCheckpoint(screen: NewGameScreen): void {
  bunnyBattleCheckpoint(screen);
  const battle = requireWorld(screen).battle;
  if (!battle) throw new Error("Bunny battle runtime was not reached");
  plantStatusStrip(battle, "player");
  plantStatusStrip(battle, "enemy");
  screen.frozen = true;
}
/**
 * The free-world screen with the two softkey plates, or with one plate's panel open.
 *
 * The save starts on the source's own room 1:1 save spot, well outside the Bunny trigger rect, so the
 * phase stays `freeworld` and `canOpenSourcePanel()` holds. `row` presses down that many times before
 * freezing, which is how the nine-label game menu is scrolled to its last viewport.
 */
export function worldPanelCheckpoint(
  screen: NewGameScreen,
  target: WorldPanelCheckpoint,
  row = 0,
  keys: readonly (InputCommand | null)[] = [],
  freeze = true,
): void {
  const data = screen.assets.worldContract,
    save = scene1Save({
      location: {
        sceneId: data.save.scene,
        roomIndex: data.save.room,
        x: data.save.x,
        y: data.save.y,
        direction: 1,
      },
      owner: SCENE1_RESUME.bunnyCapture,
      bunnyCaught: false,
      pets: [{ speciesId: 68, level: 30, quality: 2 }],
    });
  frozenWorldSave(screen, save);
  const world = requireWorld(screen);
  if (world.phase !== "freeworld")
    throw new Error(`World panel checkpoint needs the free-world phase, got ${world.phase}`);
  if (target === "repelPrompt") {
    world.inventory["13"] = 1;
    world.repelSteps = 1;
    screen.step([]);
    if (!world.repelPromptVisible) throw new Error("Repel expiry prompt did not open");
  } else if (target === "challenge" || target === "giftCode") {
    world.flags.badges.grant(3);
    world.currency.badges = 24;
    screen.host.panel.open();
    for (let i = 0; i < MENU_ROW_CHALLENGE; i++) screen.step(["down"]);
    screen.step(["confirm"]);
    if (target === "giftCode") {
      screen.step(["down"]);
      screen.step(["confirm"]);
      screen.host.panel.typeText("TRUONGCON");
    }
    if (screen.host.panel.mode !== target) throw new Error(`${target} did not open`);
  } else if (target === "battlePass" || target === "battlePassHelp") {
    world.currency.badges = 25;
    world.meta.battlePass.xp = 2400;
    world.meta.battlePass.missions = [2, 4, 12, 1, 0, 3];
    screen.host.panel.open();
    for (let i = 0; i < MENU_ROW_BATTLE_PASS; i++) screen.step(["down"]);
    screen.step(["confirm"]);
    if (target === "battlePassHelp") screen.host.panel.openBattlePassHelp();
    if (screen.host.panel.mode !== target) throw new Error(`${target} did not open`);
  } else if (
    target === "fashionShop" ||
    target === "fashionBuy" ||
    target === "fashionOpen" ||
    target === "fashionExchange"
  ) {
    world.currency.money = 12_500;
    world.meta.fashion.economy.blindBagCount = 3;
    world.meta.fashion.economy.fragmentCount = 100;
    screen.host.panel.openPortableShop();
    screen.step(["down"]);
    screen.step(["down"]);
    screen.step(["confirm"]);
    if (target === "fashionBuy") screen.step(["confirm"]);
    else if (target === "fashionOpen") {
      screen.step(["down"]);
      screen.step(["confirm"]);
    } else if (target === "fashionExchange") {
      screen.step(["down"]);
      screen.step(["down"]);
      screen.step(["confirm"]);
    }
    const expected =
      target === "fashionShop"
        ? "fashionShop"
        : target === "fashionBuy"
          ? "fashionBuyConfirm"
          : target === "fashionOpen"
            ? "fashionOpenConfirm"
            : "fashionExchange";
    if (screen.host.panel.mode !== expected)
      throw new Error(`Fashion checkpoint ${target} did not open (got ${screen.host.panel.mode})`);
  } else if (target === "wardrobe") {
    const fashions = screen.assets.metaSystems?.fashion.records ?? [];
    world.meta.fashion.owned = fashions.map((fashion) => fashion.key);
    screen.host.panel.open();
    for (let i = 0; i < 6; i++) screen.step(["down"]);
    screen.step(["confirm"]);
    for (let i = 0; i < Math.max(0, row); i++) screen.step(["down"]);
    if (screen.host.panel.mode !== "wardrobe") throw new Error("Wardrobe did not open");
  } else if (target === "portableShop" || target === "dailyBadge") {
    world.currency.money = 12500;
    world.currency.badges = 24;
    screen.host.panel.open();
    screen.step(["confirm"]);
    if (target === "dailyBadge") {
      screen.step(["down"]);
      screen.step(["confirm"]);
    } else {
      if (row >= 1) screen.step(["confirm"]);
      if (row >= 2) screen.step(["confirm"]);
    }
    if (!screen.host.panel.mode.startsWith("portableShop"))
      throw new Error(`Portable shop did not open (got ${screen.host.panel.mode})`);
  } else if (target === "worldShop") {
    world.currency.money = 12500;
    world.inventory["4"] = 3;
    screen.host.panel.openWorldShop();
    if (row === 1) screen.step(["confirm"]);
    if (row === 2) {
      screen.step(["down"]);
      screen.step(["confirm"]);
    }
  } else if (target === "convenience") {
    world.currency.badges = 20;
    screen.host.panel.openConvenience();
    for (let i = 0; i < Math.max(0, row); i++) screen.step(["down"]);
  } else if (target === "petBank") {
    world.campaign.petBank.push({ ...world.pets[0], slot: 0, speciesId: 58, level: 5 });
    screen.host.panel.openPetBank();
    for (let i = 0; i < Math.min(2, row); i++) screen.step(["down"]);
    if (row >= 3) {
      screen.step(["up"]);
      screen.step(["confirm"]);
    }
  } else if (target === "egg") {
    // The bag's eggs: 0 the "Đặc thù" tab, 1 the V4 egg's preview, 2 the item-14 egg picker,
    // 3 "Ấp trứng thành công", 4 its `openbox.ui` line.
    world.bag.specials.push(0, 0, 11, 12);
    world.inventory["14"] = 2;
    const panel = screen.host.panel;
    panel.openBag();
    if (row === 2) {
      const at = panel.bagRows.findIndex((entry) => entry.id === 14);
      for (let i = 0; i < at; i++) screen.step(["down"]);
      screen.step(["confirm"]);
    } else {
      screen.step(["left"]);
      if (row === 1) panel.eggPreview = { itemId: 11, scroll: 0 };
      if (row >= 3) {
        world.campaign.egg.active = true;
        world.campaign.egg.activeEggItemId = 0;
        world.campaign.egg.progress = 10;
        world.campaign.egg.drawSeed = "20261109";
        screen.step(["confirm"]);
        if (row === 4) screen.step(["confirm"]);
      }
    }
  } else if (target === "skillLearn") {
    const pet = world.pets[0],
      available = screen.assets
        .petSkillPools!.entries(pet.speciesId)
        .filter((entry) => entry[2] === "a" && entry[1] <= pet.level)
        .map((entry) => entry[0]),
      equipped = available.slice(0, row >= 2 ? 5 : 4),
      incoming = available.find((skillId) => !equipped.includes(skillId));
    if (incoming === undefined) throw new Error("Skill-learn checkpoint has no candidate");
    pet.skillIds = equipped;
    pet.skillPp = screen.assets.battleServices.progression.fullPp(equipped);
    world.pendingSkillLearns.push({ petSlot: 0, skillId: incoming });
    screen.step([]);
    if (row >= 1) screen.step(["confirm"]);
    if (row >= 2) screen.step(["confirm"]);
    if (screen.host.panel.mode !== "pet") throw new Error("Skill-learn queue did not open");
  } else if (target === "pet") {
    // `petstate.ui` through the menu's "Sủng vật", with a second, hurt pet in the party. Row 0 is the
    // list, 1 its `petsetting.ui` menu, 2 the release question, 3 a Bánh Sandwich used from the bag,
    // 4 the Nâng phẩm picker on its [Ngân hàng] row.
    const first = world.pets[0],
      second = { ...first, slot: 1, speciesId: 58, level: 5, quality: 1, heldEquipmentId: 1 };
    second.currentHp = Math.trunc((second.maxHp ?? 20) / 3);
    world.pets.push(second);
    // A lower-star pet of the leader's species: a valid Nâng phẩm phôi (`petsetting.ui` row 5).
    world.pets.push({ ...first, slot: 2, level: 4, quality: 1 });
    world.campaign.petBank.push({ ...first, slot: 0, level: 3, quality: 1 });
    world.inventory["4"] = 5;
    world.inventory["5"] = 2;
    world.inventory["7"] = 1;
    world.bag.equipment.push(0, 5, 2);
    world.currency.badges = 3;
    // The JavaSE parity route can complete 68 -> 69, show both Cầu Vồng PNG ingredients and
    // continue into the free post-evolution skill-learning queue.
    world.bag.materials["12"] = 1;
    world.bag.materials["3009"] = 2;
    world.bag.materials["3010"] = 2;
    if (row === 3) {
      screen.host.panel.open();
      for (let i = 0; i < MENU_ROW_BAG; i++) screen.step(["down"]);
      screen.step(["confirm"]);
      while (screen.host.panel.bagSelectedRow?.id !== 4) screen.step(["down"]);
      screen.step(["confirm"]);
      screen.step(["down"]);
      screen.step(["confirm"]);
    } else {
      screen.host.panel.open();
      for (let i = 0; i < MENU_ROW_PET; i++) screen.step(["down"]);
      screen.step(["confirm"]);
      if (row !== 4) screen.step(["down"]);
      if (row >= 1) screen.step(["confirm"]);
      if (row === 4) {
        for (let i = 0; i < 5; i++) screen.step(["down"]);
        screen.step(["confirm"]);
        screen.step(["confirm"]);
        screen.step(["down"]);
      } else if (row >= 2) {
        for (let i = 0; i < 3; i++) screen.step(["down"]);
        screen.step(["confirm"]);
      }
    }
    if (screen.host.panel.mode !== "pet") throw new Error("Pet screen did not open");
  } else if (target === "bag") {
    // `bag.ui` through the menu's "Lưng bao", on tab `row`. The campaign the web reaches grants no
    // gear yet, so a sample of each list is put in the bag to show every page.
    world.bag.equipment.push(0, 5);
    world.bag.materials["12"] = 3;
    world.bag.materials["17"] = 5;
    world.bag.specials.push(5, 0);
    world.inventory["13"] = 2;
    // And one of each Cầu Vồng kind the unified catalog lists: a bag item, two evolution materials
    // and a species egg (each drawn with its own PNG, the egg as every egg).
    world.inventory["4032"] = 1;
    world.bag.materials["3009"] = 2;
    world.bag.materials["3000"] = 1;
    world.bag.specials.push(8068);
    screen.host.panel.open();
    for (let i = 0; i < MENU_ROW_BAG; i++) screen.step(["down"]);
    screen.step(["confirm"]);
    for (let i = 0; i < Math.min(3, row); i++) screen.step(["right"]);
    // Row 4: tab 0 with 5 pressed on the first ball, which `af()` answers with "Không thể sử dụng".
    if (row >= 4) {
      for (let i = 0; i < 3; i++) screen.step(["left"]);
      screen.step(["confirm"]);
    }
    if (screen.host.panel.mode !== "bag") throw new Error("Bag did not open");
  } else if (target === "areaMap") {
    // The original area map, held once its opening slide has stopped.
    screen.host.openAreaMap(world);
    const view = screen.host.panel.areaMap;
    for (let i = 0; i < 120 && view?.sliding; i++) screen.step([]);
    if (screen.host.panel.mode !== "areaMap" || view?.sliding)
      throw new Error(`Area map did not open and settle (got ${screen.host.panel.mode})`);
  } else if (target === "charm") {
    // The team-charm manager past main task 5: Cao cấp trị liệu II worn, Nọc độc công kích I owned,
    // two badges, 12000 kim and a few stones. Row 1 asks to upgrade (the smsInfo confirmation).
    world.setMainTaskProgress(5);
    world.campaign.charms.tiers = { "5037": 2, "5040": 1 };
    world.campaign.charms.active.SURVIVAL = 5037;
    world.flags.badges.grant(0);
    world.flags.badges.grant(1);
    world.currency.money = 12000;
    world.bag.materials["12"] = 6;
    world.bag.materials["13"] = 1;
    if (screen.host.panel.openRainbowCharm() !== null) throw new Error("charm manager stayed shut");
    if (row === 1) {
      screen.step(["right"]);
      screen.step(["right"]);
      screen.step(["confirm"]);
      if (screen.host.panel.mode !== "rainbowCharmConfirm")
        throw new Error("no charm confirmation");
    }
  } else if (target === "ride") {
    // `ride.ui` from key 9 with Lục đi điểu and Hải âu owned (special rewards 1 and 3) and the
    // plant mount collected. Row 1 mounts Lục đi điểu and walks; row 2 the Cầu Vồng plant mount;
    // row 3 confirms the locked Hư không hành giả card (the "Chưa có" warning).
    world.bag.specials.push(1, 3);
    world.collection.markCollected(113);
    if (row === 1 || row === 2) {
      const ride = row === 1 ? 0 : 4;
      if (world.selectRide(ride) !== "ready") throw new Error(`Ride ${ride} could not be mounted`);
      for (let i = 0; i < 6; i++) screen.step(["holdRight"]);
      for (let i = 0; i < 2; i++) screen.step([]);
    } else {
      screen.host.pressRide(world);
      if (row === 3) {
        screen.step(["right"]);
        screen.step(["confirm"]);
      }
      if (screen.host.panel.mode !== "ride") throw new Error("ride.ui did not open");
    }
  } else if (target === "record") {
    // `record.ui` through the menu's "Đồ giám", with the pet book and badge case in the bag, a few
    // species seen or collected, three badges (one unified) and some money for the counters.
    world.bag.specials.push(5, 6);
    for (const id of [1, 4, 9, 31, 58]) world.collection.markSeen(id);
    for (const id of [4, 58, 69]) world.collection.markCollected(id);
    for (const id of [0, 1, 8]) world.flags.badges.grant(id);
    world.flags.badges.enhance(0);
    world.currency.money = 1250;
    world.currency.badges = 3;
    screen.host.panel.open();
    for (let i = 0; i < MENU_ROW_RECORD; i++) screen.step(["down"]);
    screen.step(["confirm"]);
    if (screen.host.panel.mode !== "record") throw new Error("Đồ giám did not open");
  } else if (target === "save" || target === "task") {
    // A gamemenu row's own panel: "Lưu dữ liệu" (`msgtip.ui`) or "Nhiệm vụ" (`task.ui`).
    screen.host.panel.open();
    const menuRow = target === "save" ? MENU_ROW_SAVE : MENU_ROW_TASK;
    for (let i = 0; i < menuRow; i++) screen.step(["down"]);
    screen.step(["confirm"]);
    if (screen.host.panel.mode !== target)
      throw new Error(`World panel ${target} did not open (got ${screen.host.panel.mode})`);
  } else if (target !== "plates") {
    if (target === "menu") screen.host.panel.open();
    else screen.host.panel.openSystem();
    for (let i = 0; i < row; i++) screen.step(["down"]);
    if (screen.host.panel.selected !== Math.min(row, screen.host.panel.labels.length - 1))
      throw new Error(`World panel ${target} did not move the cursor to row ${row}`);
  }
  // `?worldPanelKeys=right,,,down`: commands stepped once the panel is up (empty = an idle tick),
  // so a tab, a cursor or an animation frame can be held.
  for (const key of keys) screen.step(key ? [key] : []);
  // Browser input audits can opt into a live checkpoint; screenshot parity remains frozen by default.
  screen.frozen = freeze;
}
/**
 * The source room-swap screen, held on one frame `tick` of its sixteen ticks in.
 *
 * The screen only exists for a second in play, so this is how its geometry gets checked: the black
 * frame, the brown track, the pale-yellow fill at `min(148, tick * 10)` and one elemental tip centred
 * above them, with no world drawn underneath. The tip comes from the session's source random stream,
 * so the same tick always paints the same line.
 */
export function mapLoadingCheckpoint(screen: NewGameScreen, tick: number): void {
  const data = screen.assets.worldContract,
    save = scene1Save({
      location: {
        sceneId: data.save.scene,
        roomIndex: data.save.room,
        x: data.save.x,
        y: data.save.y,
        direction: 1,
      },
      owner: SCENE1_RESUME.bunnyCapture,
      bunnyCaught: false,
      pets: [{ speciesId: 68, level: 7, quality: 2 }],
    });
  // `frozenWorldSave` waits the screen out; this one stops inside it instead.
  screen.host.story.enterWorld(screen.host.createWorld(save));
  screen.host.story.tick([]);
  const loading = requireWorld(screen).mapLoading;
  if (!loading) throw new Error("Entering the session's first room did not start the load screen");
  const held = Math.max(0, Math.min(MAP_LOADING_TOTAL_TICKS - 1, Math.floor(tick) || 0));
  for (let i = 0; i < held; i++) screen.step([]);
  if (requireWorld(screen).mapLoading !== loading)
    throw new Error(`The load screen closed before tick ${held}`);
  if (loading.progressPixels() !== Math.min(148, held * 10))
    throw new Error(`The load bar was ${loading.progressPixels()} px wide at tick ${held}`);
  screen.frozen = true;
}
/** Cầu Vồng chapter scene, the only room table whose walk-in connections are read straight from `/4`. */
const CAU_VONG_SCENE = 98;
/**
 * Stand in Cầu Vồng room `room` without playing the chapter.
 *
 * The chapter's doors are gated behind its own story flags, so the only way to see all 68 rooms is to
 * start a session inside one. The spot is the arrival the door would use: the row in that room's table
 * which another room's door points at, in 20px source tiles plus the tile of give away from the door.
 */
export function cauVongRoomCheckpoint(screen: NewGameScreen, room: number): void {
  const registry = screen.host.story.sourceData;
  if (!registry) throw new Error("Parity harness: source story data is not loaded");
  const arrival = roomEntryArrival(registry, CAU_VONG_SCENE, room);
  if (!arrival) throw new RangeError(`Cầu Vồng room ${room} has no door that walks into it`);
  frozenWorldSave(
    screen,
    scene1Save({
      location: {
        sceneId: CAU_VONG_SCENE,
        roomIndex: room,
        x: arrival.x,
        y: arrival.y,
        direction: arrival.direction,
      },
      owner: SCENE1_RESUME.bunnyCapture,
      bunnyCaught: false,
      pets: [{ speciesId: 68, level: 7, quality: 2 }],
    }),
  );
  const world = requireWorld(screen);
  if (world.sceneId !== CAU_VONG_SCENE || world.roomIndex !== room)
    throw new Error(
      `Checkpoint asked for Cầu Vồng room ${room}, the world is at ${world.sceneId}:${world.roomIndex}`,
    );
  screen.frozen = true;
}
/**
 * Quảng Trường Cầu Vồng's owner (`?cauVongSquare=<stage>`, `CauVongChapterRuntime.tickSquare`):
 * `intro` holds the first arrival line fully typed; every other stage plays the arrival through,
 * then `guide`, `npc<id>` (a resident), `portal` or `sign` opens that conversation, and `bubble`
 * stands the hero below the steward so the talk bubble shows.
 */
export function cauVongSquareCheckpoint(screen: NewGameScreen, stage: string): void {
  cauVongRoomCheckpoint(screen, 0);
  const world = requireWorld(screen);
  const typeOut = () => {
    for (let i = 0; i < 120; i++) world.tick([]);
  };
  if (stage === "intro") {
    typeOut();
    return;
  }
  for (let tick = 0; tick < 2000 && world.eventVisible; tick++)
    world.tick(tick % 4 === 3 ? ["confirm"] : []);
  const stand = (x: number, y: number) => {
    world.player.x = x;
    world.player.y = y;
    world.player.direction = 2;
  };
  const below = (id: number) => {
    const actor = world.actors.get(id);
    if (!actor) throw new Error(`Quảng trường has no actor ${id}`);
    stand(actor.x + 10, actor.y + 19 + 16);
  };
  if (stage === "guide") below(1);
  else if (stage === "portal") stand(100, 540);
  else if (stage === "sign") stand(280, 540);
  else if (stage === "bubble") below(24);
  else if (stage.startsWith("npc")) below(Number(stage.slice(3)));
  else throw new Error(`Unknown Quảng trường stage ${stage}`);
  if (stage === "bubble") {
    world.tick([]);
    return;
  }
  world.tick(["confirm"]);
  typeOut();
}
/**
 * Đại sảnh Cúp Cầu Vồng's owner (`?cauVongHall=<stage>`, `CauVongOpeningSourceRuntime` and
 * `tickTournament`), entered the way the square's guide leads in (200, 320):
 * `intro<n>` / `terrain<n>` / `match<n>` stop on the n-th line of that part fully typed (1 when n is
 * left out; `terrain` and `match` pick their option in `menu`), `menu` holds the choice; `after`
 * is the hall once the final is over, and `npc<id>` / `linh` talk to a spectator or to Linh there.
 */
export function cauVongHallCheckpoint(screen: NewGameScreen, stage: string): void {
  cauVongRoomCheckpoint(screen, 0);
  const world = requireWorld(screen);
  // The square's arrival (already playing) is read through first.
  for (let tick = 0; tick < 3000 && world.eventVisible; tick++)
    world.tick(world.eventScene?.textReady ? ["confirm"] : []);
  const enterHall = () => {
    if (!world.warp({ scene: CAU_VONG_SCENE, room: 47, x: 200, y: 320, direction: 0 }))
      throw new Error("Đại sảnh is not loaded");
    // The screen is frozen, so the world plays its own map-loading screen out.
    for (let i = 0; i < 400 && world.mapLoading; i++) world.tickMapLoading();
  };
  const typeOut = () => {
    for (let i = 0; i < 120 && !world.eventScene?.textReady; i++) world.tick([]);
  };
  /** Ticks on, confirming each box, until the `count`-th new box is up and fully typed. */
  const toLine = (count: number) => {
    let seen = 0,
      last: string | null = null;
    for (let tick = 0; tick < 6000; tick++) {
      const text = world.eventScene?.currentText ?? null;
      if (text && text !== last) {
        seen++;
        last = text;
        if (seen === count) {
          typeOut();
          return;
        }
      }
      const ready = world.eventScene?.textReady ?? false;
      world.tick(ready || world.eventScene?.choice ? ["confirm"] : []);
    }
    throw new Error(`Đại sảnh never showed line ${count}`);
  };
  const toMenu = () => {
    for (let tick = 0; tick < 8000 && !world.eventScene?.choice; tick++)
      world.tick(world.eventScene?.textReady ? ["confirm"] : []);
    if (!world.eventScene?.choice) throw new Error("Đại sảnh never offered the menu");
  };
  const number = (prefix: string) => Math.max(1, Number(stage.slice(prefix.length)) || 1);
  if (stage === "after" || stage === "linh" || stage.startsWith("npc")) {
    for (const event of [100, 7000, 7002, 7100, 7102, 7200])
      world.eventState.op14CompleteEvent(CAU_VONG_SCENE, 47, event);
    enterHall();
    if (stage === "after") {
      world.tick([]);
      return;
    }
    const id = stage === "linh" ? (screen.assets.cauVongHall?.linh ?? 28) : Number(stage.slice(3));
    const actor = world.actors.get(id);
    if (!actor) throw new Error(`Đại sảnh has no actor ${id}`);
    world.player.x = actor.x + 10;
    world.player.y = actor.y + 19 + 16;
    world.player.direction = 2;
    world.tick(["confirm"]);
    typeOut();
    return;
  }
  enterHall();
  if (stage.startsWith("intro")) toLine(number("intro"));
  else if (stage === "menu") toMenu();
  else if (stage.startsWith("terrain") || stage.startsWith("match")) {
    toMenu();
    const terrain = stage.startsWith("terrain");
    // The first option (the terrain lesson) is the default row.
    if (!terrain) world.eventScene?.moveChoice(1);
    world.tick(["confirm"]);
    toLine(number(terrain ? "terrain" : "match"));
  } else throw new Error(`Unknown Đại sảnh stage ${stage}`);
}
/**
 * Lạc Khắc's chain (`?cauVongLocke=<stage>`, `CauVongLockeChainRuntime`), with the flags each room
 * waits for set and the party at level 100: `rescue` is 39's first line, `battle` its fight (held on
 * the field), `post` the first line after winning it, `award` the south gate's first "Nhận được" box
 * (52) and `choose` the last duel's challenge menu (32).
 */
export function cauVongLockeCheckpoint(screen: NewGameScreen, stage: string): void {
  cauVongRoomCheckpoint(screen, 0);
  const world = requireWorld(screen),
    locke = screen.assets.cauVongLocke;
  if (!locke) throw new Error("locke.json is not loaded");
  for (let tick = 0; tick < 3000 && world.eventVisible; tick++)
    world.tick(world.eventScene?.textReady ? ["confirm"] : []);
  for (const pet of world.pets) {
    pet.level = 100;
    pet.currentHp = undefined;
  }
  const room = stage === "award" ? 52 : stage === "choose" ? 32 : 39;
  const gates =
    room === 52
      ? [locke.gates.southEast]
      : room === 32
        ? [locke.gates.northSeaCompanion]
        : [locke.gates.labComplete, locke.gates.labFarewell, locke.gates.linhRequest];
  for (const [r, event] of gates) world.eventState.op14CompleteEvent(CAU_VONG_SCENE, r, event);
  const at = room === 39 ? { x: 170, y: 540 } : { x: 200, y: 300 };
  if (!world.warp({ scene: CAU_VONG_SCENE, room, ...at, direction: 0 }))
    throw new Error(`98:${room} is not loaded`);
  for (let i = 0; i < 400 && world.mapLoading; i++) world.tickMapLoading();
  if (room !== 39) {
    const rival = world.actors.get(locke.actors[room === 52 ? "52:23" : "32:20"]);
    if (!rival) throw new Error(`98:${room} has no Lạc Khắc`);
    world.player.x = rival.x + 10;
    world.player.y = rival.y + 19 + 16;
    world.player.direction = 2;
  }
  const typeOut = () => {
    for (let i = 0; i < 120 && !world.eventScene?.textReady; i++) world.tick([]);
  };
  world.tick(room === 39 ? [] : ["confirm"]);
  if (stage === "rescue") return typeOut();
  /** Plays on (winning the fight) until `done` holds. */
  const until = (done: () => boolean) => {
    for (let tick = 0; tick < 30000; tick++) {
      if (done()) return;
      const battle = world.battle;
      if (battle) {
        const foe = battle.core?.activeUnit("enemy"),
          mine = battle.core?.activeUnit("player");
        if (foe?.alive()) foe.setHp(1);
        if (mine?.alive()) mine.setHp(mine.maxHp());
      }
      world.tick(battle || world.eventScene?.textReady ? ["confirm"] : []);
    }
    throw new Error(`Lạc Khắc's ${stage} never came`);
  };
  if (stage === "battle") {
    until(() => world.phase === "battle");
    for (let i = 0; i < 200; i++) world.tick([]);
    return;
  }
  if (stage === "post") {
    until(() => world.eventState.sourceEventStateComplete(CAU_VONG_SCENE, 39, 1402));
    return typeOut();
  }
  if (stage === "award") {
    until(() => world.eventScene?.currentText?.startsWith("Nhận được") ?? false);
    return typeOut();
  }
  if (stage === "choose") return until(() => !!world.eventScene?.choice);
  throw new Error(`Unknown Lạc Khắc stage ${stage}`);
}
/** Where each `?cauVongFourGates=<stage>` stands, the flags it needs and whom it talks to. */
const FOUR_GATES_STAGES: Record<
  string,
  {
    room: number;
    at: [number, number];
    flags: [number, number][];
    /** [room, source actor] asked with 5. */
    talk?: [number, number];
    /** CV4c: a `lab.json` actor (`actors[name]`, or `actors[name][index]`) asked with 5. */
    talkLab?: string;
    /** What the frame waits for. */
    until: "text" | "battle" | "choice" | "award";
  }
> = {
  intro: { room: 9, at: [200, 300], flags: [], talk: [9, 6], until: "text" },
  east: { room: 15, at: [200, 300], flags: [], talk: [15, 4], until: "text" },
  rescue: { room: 13, at: [310, 455], flags: [], until: "battle" },
  lost: {
    room: 10,
    at: [360, 275],
    flags: [
      [9, 101],
      [23, 100],
      [9, 102],
    ],
    until: "text",
  },
  masked: {
    room: 5,
    at: [350, 340],
    flags: [
      [5, 100],
      [9, 102],
    ],
    until: "text",
  },
  mushroom: {
    room: 17,
    at: [300, 300],
    flags: [
      [17, 1649],
      [18, 100],
    ],
    talk: [17, 24],
    until: "choice",
  },
  rival: { room: 12, at: [300, 300], flags: [[2, 902]], talk: [12, 14], until: "award" },
  lever: { room: 52, at: [360, 190], flags: [], until: "text" },
  // CV4b (forest.json): the raid behind the hero (9:1617) opens the forest route.
  rock: { room: 10, at: [470, 75], flags: [[9, 1617]], until: "text" },
  // DEPART's own cues have no line; its arrival in 38 (`arrive`) plays PORTAL_ARRIVE, then PERMISSION.
  depart: {
    room: 38,
    at: [70, 159],
    flags: [
      [9, 1617],
      [60, 1501],
    ],
    until: "text",
  },
  forest: {
    room: 39,
    at: [150, 560],
    flags: [
      [9, 1617],
      [38, 100],
    ],
    until: "text",
  },
  girl: {
    room: 40,
    at: [300, 400],
    flags: [
      [9, 1617],
      [38, 100],
      [39, 100],
    ],
    until: "battle",
  },
  merchant: {
    room: 38,
    at: [200, 300],
    flags: [
      [9, 1617],
      [38, 100],
      [60, 1501],
      [38, 6014],
    ],
    talk: [38, 13],
    until: "choice",
  },
  north: {
    room: 24,
    at: [300, 300],
    flags: [
      [9, 1617],
      [40, 6400],
      [9, 104],
    ],
    until: "text",
  },
  northRescue: {
    room: 26,
    at: [170, 130],
    flags: [
      [9, 1617],
      [40, 6400],
      [9, 104],
      [24, 101],
    ],
    until: "battle",
  },
  recovery: {
    room: 59,
    at: [270, 99],
    flags: [
      [9, 1617],
      [9, 104],
      [59, 130],
    ],
    until: "text",
  },
  // CV4c (lab.json): the classroom's introduction (3), the tour (2), the bird trail (17), the guards
  // (57), the lab's fight (58), the dorm's investigation (59), the exam's first round (9) and the
  // dorm's cry for Thiết Giáp Xà (59).
  classroom: {
    room: 3,
    at: [300, 400],
    flags: [
      [2, 140],
      [4, 1500],
    ],
    talkLab: "classGirl",
    until: "text",
  },
  angel: {
    room: 2,
    at: [300, 420],
    flags: [
      [2, 140],
      [3, 110],
    ],
    until: "text",
  },
  bird: { room: 17, at: [300, 300], flags: [[3, 113]], until: "text" },
  guards: {
    room: 57,
    at: [240, 310],
    flags: [
      [3, 113],
      [57, 100],
    ],
    until: "text",
  },
  lab: {
    room: 58,
    at: [200, 250],
    flags: [
      [3, 113],
      [57, 100],
      [57, 101],
      [58, 114],
      [58, 100],
    ],
    until: "battle",
  },
  labReturn: {
    room: 59,
    at: [330, 419],
    flags: [
      [3, 113],
      [58, 101],
      [59, 120],
    ],
    until: "text",
  },
  exam: {
    room: 9,
    at: [200, 300],
    flags: [
      ...[1600, 1601, 1611, 1613, 1614, 1617, 1618, 1619].map(
        (event) => [9, event] as [number, number],
      ),
      [9, 101],
      [9, 103],
      [20, 100],
      [26, 100],
      [4, 1501],
    ],
    talkLab: "teachers.0",
    until: "text",
  },
  dormPet: { room: 59, at: [200, 470], flags: [[2, 140]], until: "text" },
};
/**
 * CV4a's Bốn Cổng (`?cauVongFourGates=<stage>`, `CauVongFourGateSourceRuntime`), from Tứ Môn (3:102)
 * with the party at level 100: `intro` the hub teacher (9), `east` the east brief (15), `rescue`
 * 13's fight, `lost` the lost-pet chamber (10), `masked` the ruins' masked pair (5), `mushroom`
 * 17's merchant menu, `rival` the east rival's first "Nhận được" (12) and `lever` 52's lever.
 * CV4b: `rock` 10's rock hint (no metal mount), `depart` DEPART's arrival in 38 (the permission),
 * `forest` 39's blue trail, `girl` 40's fight, `merchant` 38's offer menu, `north` 24's line,
 * `northRescue` 26's fight and `recovery` the dorm's morning after (59). CV4c: `classroom` An Kỳ
 * Nhi's introduction (3), `angel` her tour (2), `bird` 17's Hoàng Dực Điểu, `guards` 57's
 * intercept, `lab` 58's fight, `labReturn` the dorm's investigation (59), `exam` the east
 * teacher's round (9) and `dormPet` the dorm's cry for Thiết Giáp Xà (59).
 */
export function cauVongFourGatesCheckpoint(screen: NewGameScreen, stage: string): void {
  const plan = FOUR_GATES_STAGES[stage];
  if (!plan) throw new Error(`Unknown Bốn Cổng stage ${stage}`);
  cauVongRoomCheckpoint(screen, 0);
  const world = requireWorld(screen),
    doc = screen.assets.cauVongFourGates;
  if (!doc) throw new Error("four-gates.json is not loaded");
  for (let tick = 0; tick < 3000 && world.eventVisible; tick++)
    world.tick(world.eventScene?.textReady ? ["confirm"] : []);
  for (const [r, event] of [[3, 102] as [number, number], ...plan.flags])
    world.eventState.op14CompleteEvent(CAU_VONG_SCENE, r, event);
  for (const pet of world.pets) {
    pet.level = 100;
    pet.currentHp = undefined;
  }
  world.currency.money = Math.max(world.currency.money, 10000);
  const [x, y] = plan.at;
  if (!world.warp({ scene: CAU_VONG_SCENE, room: plan.room, x, y, direction: 0 }))
    throw new Error(`98:${plan.room} is not loaded`);
  for (let i = 0; i < 400 && world.mapLoading; i++) world.tickMapLoading();
  const lab = screen.assets.cauVongLab?.actors as Record<string, number | number[]> | undefined,
    [labName, labIndex] = plan.talkLab?.split(".") ?? [];
  const labActor = labName === undefined ? undefined : lab?.[labName];
  if (plan.talk || plan.talkLab) {
    const id = plan.talk
        ? (doc.actors[String(plan.talk[0])]?.[String(plan.talk[1])] ??
          screen.assets.cauVongForest?.actors[String(plan.talk[0])]?.[String(plan.talk[1])])
        : Array.isArray(labActor)
          ? labActor[Number(labIndex)]
          : labActor,
      actor = id === undefined ? undefined : world.actors.get(id);
    if (!actor) throw new Error(`98:${plan.room} has no actor ${plan.talk?.[1] ?? plan.talkLab}`);
    world.player.x = actor.x + 10;
    world.player.y = actor.y + 19 + 16;
    world.player.direction = 2;
  } else if (stage === "lever" || stage === "rock") world.player.direction = 2;
  world.tick(plan.talk || plan.talkLab || stage === "lever" || stage === "rock" ? ["confirm"] : []);
  const done = () =>
    plan.until === "battle"
      ? world.phase === "battle"
      : plan.until === "choice"
        ? !!world.eventScene?.choice
        : plan.until === "award"
          ? (world.eventScene?.currentText?.startsWith("Nhận được") ?? false)
          : !!world.eventScene?.currentText;
  for (let tick = 0; tick < 30000 && !done(); tick++) {
    const battle = world.battle;
    if (battle) {
      const foe = battle.core?.activeUnit("enemy"),
        mine = battle.core?.activeUnit("player");
      if (foe?.alive()) foe.setHp(1);
      if (mine?.alive()) mine.setHp(mine.maxHp());
    }
    world.tick(battle || world.eventScene?.textReady ? ["confirm"] : []);
  }
  if (!done()) throw new Error(`Bốn Cổng's ${stage} never came`);
  if (plan.until === "battle") for (let i = 0; i < 200; i++) world.tick([]);
  else for (let i = 0; i < 120 && !world.eventScene?.textReady; i++) world.tick([]);
}
/** CV5's story flags up to each North Sea stage (`CauVongNorthSea.test`'s harness). */
const NS_CLUE: [number, number][] = [
  [28, 100],
  [48, 100],
  [30, 100],
  [30, 102],
  [30, 103],
  [30, 104],
  [48, 105],
  [0, RAINBOW_RIDE_OWNED_EVENT + CV_WATER],
];
const NS_ORDERED: [number, number][] = [
  ...NS_CLUE,
  [35, 100],
  [35, 101],
  [35, 102],
  [48, 106],
  [30, 107],
  [61, 100],
  [61, 101],
  [61, 102],
];
/** Where each `?cauVongNorthSea=<stage>` stands, the flags it needs and whom it asks with 5. */
const NORTH_SEA_STAGES: Record<
  string,
  {
    room: number;
    at: [number, number];
    flags: [number, number][];
    /** An actor id asked with 5 ("merchant": the room's dock merchant). */
    talk?: number | "merchant";
    until: "text" | "battle" | "choice";
  }
> = {
  office: { room: 27, at: [290, 230], flags: [], until: "text" },
  arrival: { room: 28, at: [250, 300], flags: [], until: "text" },
  merchant: { room: 28, at: [200, 300], flags: [[28, 100]], talk: "merchant", until: "choice" },
  clue: { room: 48, at: [150, 100], flags: NS_CLUE.slice(0, 6), until: "text" },
  guards: { room: 35, at: [230, 400], flags: NS_CLUE, until: "text" },
  discovery: { room: 61, at: [200, 200], flags: NS_ORDERED.slice(0, 13), until: "text" },
  switch: {
    room: 61,
    at: [200, 200],
    flags: [...NS_ORDERED, [37, 100], [36, 101], [48, 107]],
    until: "text",
  },
  spirit: { room: 34, at: [100, 100], flags: NS_CLUE, until: "text" },
};
/**
 * The five-slot incubator's pages (`?cauVongNorthSea=incubator<page>`), opened by 34's hatchery
 * keeper: `incubator` the slots, `incubatorEggs` an empty slot's owned eggs, `incubatorActions`
 * a full slot's actions, `incubatorDiscard` the discard confirmation, `incubatorHatched` a hatch.
 */
const INCUBATOR_KEYS: Record<string, InputCommand[][]> = {
  incubator: [],
  incubatorEggs: [["down"], ["confirm"]],
  incubatorActions: [["confirm"]],
  incubatorDiscard: [["confirm"], ["down"], ["confirm"]],
  incubatorHatched: [["confirm"], ["confirm"]],
};
/**
 * CV5's Bắc Hải (`?cauVongNorthSea=<stage>`, `CauVongNorthSeaSourceRuntime` and the continuation)
 * from 9:114 with the party at level 100: `office` 27's way out, `arrival` the dock's chapter
 * card (28), `merchant` the dock merchant's menu, `clue` 48's clue, `guards` the old school's
 * guards (35), `discovery` the secret classroom (61), `switch` its flowerpot switch's notice and
 * `spirit` 34's U Linh.
 */
/** `?cauVongSummon=<stage>`: CV0' Thiên Không — the hub, a room's board, Long Vương. */
const SUMMON_STAGES: Record<
  string,
  { room: number; at: [number, number]; board?: number; play?: number }
> = {
  hub: { room: 50, at: [310, 560] },
  room66: { room: 66, at: [120, 300] },
  "race-rules": { room: 66, at: [120, 300], board: 0 },
  race: { room: 66, at: [120, 300], board: 0, play: 90 },
  balls: { room: 66, at: [120, 300], board: 1, play: 60 },
  memory: { room: 66, at: [120, 300], board: 2, play: 10 },
  shells: { room: 66, at: [120, 300], board: 3, play: 12 },
  dragon: { room: 49, at: [150, 160] },
  "dragon-intro": { room: 49, at: [150, 160] },
  "dragon-skills": { room: 49, at: [150, 160] },
  "dragon-longan": { room: 49, at: [150, 160] },
};
/**
 * Long Vương's fight: walk onto his floor, play the scene, then stop on the command row
 * (`intro`), the skill list (`skills`) or the first Long Ấn reflect (`longan`, the same skill twice).
 */
function dragonFight(screen: NewGameScreen, stage: string): void {
  const world = requireWorld(screen);
  world.player.x = 150;
  world.player.y = 100;
  for (let tick = 0; tick < 6000 && !world.battle; tick++)
    world.tick(world.eventScene?.textReady ? ["confirm"] : []);
  const battle = world.battle;
  if (!battle) throw new Error("Long Vương did not fight");
  // `dragon-frame-<n>`: n ticks after the fight is set up, confirming every 6th tick like the Java
  // reference capture (`CaptureKimDiemBattle`), for a frame-by-frame comparison.
  if (stage.startsWith("dragon-frame-")) {
    const frames = Number(stage.slice("dragon-frame-".length));
    let pick = 0,
      last = "";
    for (let tick = 0; tick < frames; tick++) {
      const ui = battle.ui;
      if (ui.message !== last) {
        last = ui.message;
        if (last === SKILL_NOT_READY_WARNING || last === "Kỹ năng không còn PP.") pick++;
      }
      if (ui.mode === "CHOICE_SKILL" && pick >= ui.rows.length) pick = 0;
      world.tick(
        ui.mode === "CHOICE_SKILL" && ui.selectedIndex !== pick
          ? [ui.selectedIndex < pick ? "down" : "up"]
          : tick % 6 === 0
            ? ["confirm"]
            : [],
      );
    }
    return;
  }
  const mine = () => battle.core?.activeUnit("player");
  for (let tick = 0; tick < 400 && battle.ui.mode !== "BATTLE"; tick++) world.tick([]);
  for (let tick = 0; tick < 60; tick++) world.tick([]);
  if (stage === "dragon-intro") return;
  for (let tick = 0; tick < 60 && battle.ui.mode !== "CHOICE_SKILL"; tick++)
    world.tick(["confirm"]);
  if (stage === "dragon-skills") return;
  // Screenshot rig only: the checkpoint party is far below level 150, so the dragon's attack is
  // cut to 1 and the pet is refilled each tick; the same usable skill is repeated until Long Ấn answers.
  const dragon = battle.core?.activeUnit("enemy");
  // The base too: the projection recomputes the current attack every round.
  if (dragon) dragon.baseStats.attack = dragon.currentStats.attack = 1;
  let pick = 0,
    last = "";
  const seen: string[] = [];
  for (let tick = 0; tick < 20000; tick++) {
    const ui = battle.ui;
    if (ui.message.startsWith("Long Ấn")) return;
    if (ui.message !== last) {
      last = ui.message;
      if (last && seen.at(-1) !== last) seen.push(last);
      // A refused pick (not ready, no PP) moves to the next skill, once per warning.
      if (last === SKILL_NOT_READY_WARNING || last === "Kỹ năng không còn PP.") pick++;
    }
    if (ui.mode === "CHOICE_SKILL" && pick >= ui.rows.length) pick = 0;
    const pet = mine();
    if (pet?.alive()) pet.setHp(pet.maxHp());
    world.tick(
      ui.mode === "CHOICE_SKILL" && ui.selectedIndex !== pick
        ? [ui.selectedIndex < pick ? "down" : "up"]
        : ["confirm"],
    );
  }
  throw new Error(`Long Ấn never answered: ${seen.slice(-4).join(" | ")}`);
}
export function cauVongSummonCheckpoint(screen: NewGameScreen, stage: string): void {
  const plan = SUMMON_STAGES[stage.startsWith("dragon-frame-") ? "dragon" : stage];
  if (!plan) throw new Error(`Unknown Thiên Không stage ${stage}`);
  cauVongRoomCheckpoint(screen, 0);
  const world = requireWorld(screen),
    doc = screen.assets.cauVongSummoning;
  if (!doc) throw new Error("summoning.json is not loaded");
  for (let tick = 0; tick < 3000 && world.eventVisible; tick++)
    world.tick(world.eventScene?.textReady ? ["confirm"] : []);
  for (const [r, event] of [
    [9, 114],
    [50, 651100],
    [66, 651100],
  ])
    world.eventState.op14CompleteEvent(CAU_VONG_SCENE, r, event);
  for (const pet of world.pets) {
    pet.level = 100;
    pet.currentHp = undefined;
  }
  world.currency.money = Math.max(world.currency.money, 5000);
  // The host's first step settles its own state (it can resume the save's room): take it first.
  screen.host.step([]);
  const [x, y] = plan.at;
  if (!world.warp({ scene: CAU_VONG_SCENE, room: plan.room, x, y, direction: 0 }))
    throw new Error(`98:${plan.room} is not loaded`);
  for (let i = 0; i < 400 && world.mapLoading; i++) world.tickMapLoading();
  for (let tick = 0; tick < 3000 && world.eventVisible; tick++)
    world.tick(world.eventScene?.textReady ? ["confirm"] : []);
  if (stage.startsWith("dragon-")) {
    dragonFight(screen, stage);
    screen.frozen = true;
    return;
  }
  if (plan.board === undefined) return;
  new CauVongMinigame(doc.minigame).open(world.cauVongMinigame, plan.room, plan.board, 0, 12345);
  if (plan.play === undefined) return;
  // Rules → (race: the bird pick →) the paid board, then a few frames of play.
  world.tick(["confirm"]);
  if (plan.board === 0) world.tick(["confirm"]);
  for (let i = 0; i < plan.play; i++) world.tick([]);
}
export function cauVongNorthSeaCheckpoint(screen: NewGameScreen, stage: string): void {
  const keys = INCUBATOR_KEYS[stage];
  // The keeper needs no story flag; without the clue, 34 plays no notice on entry.
  const plan = keys
    ? { room: 34, at: [100, 100] as [number, number], flags: [], until: "text" as const }
    : NORTH_SEA_STAGES[stage];
  if (!plan) throw new Error(`Unknown Bắc Hải stage ${stage}`);
  cauVongRoomCheckpoint(screen, 0);
  const world = requireWorld(screen),
    doc = screen.assets.cauVongNorthSea;
  if (!doc) throw new Error("north-sea.json is not loaded");
  for (let tick = 0; tick < 3000 && world.eventVisible; tick++)
    world.tick(world.eventScene?.textReady ? ["confirm"] : []);
  for (const [r, event] of [
    [9, 114] as [number, number],
    [27, 841006] as [number, number],
    [30, 841007] as [number, number],
    ...plan.flags,
  ])
    world.eventState.op14CompleteEvent(CAU_VONG_SCENE, r, event);
  for (const pet of world.pets) {
    pet.level = 100;
    pet.currentHp = undefined;
  }
  const [x, y] = plan.at;
  if (!world.warp({ scene: CAU_VONG_SCENE, room: plan.room, x, y, direction: 0 }))
    throw new Error(`98:${plan.room} is not loaded`);
  for (let i = 0; i < 400 && world.mapLoading; i++) world.tickMapLoading();
  if (keys) {
    // The host's first step settles its own state (it can resume the save's room), so take it
    // before standing in 34.
    screen.host.step([]);
    if (!world.warp({ scene: CAU_VONG_SCENE, room: 34, x: 100, y: 100, direction: 0 }))
      throw new Error("98:34 is not loaded");
    for (let i = 0; i < 400 && world.mapLoading; i++) world.tickMapLoading();
    // Two kinds of egg in the bag, slot 1 full with its materials, slot 3 under way.
    for (let tick = 0; tick < 3000 && world.eventVisible; tick++)
      world.tick(world.eventScene?.textReady ? ["confirm"] : []);
    const eggs = world.cauVongEggRows(),
      [first, second] = eggs;
    world.bag.specials.push(first.itemId, first.itemId, second.itemId);
    const state = world.cauVongIncubation;
    state.items[0] = first.itemId;
    state.progress[0] = 200;
    state.items[2] = second.itemId;
    state.progress[2] = 80;
    for (const material of first.incubator?.materials ?? [])
      world.bag.materials[String(material.id)] = material.count + 1;
    const keeper = world.actors.get(doc.actors["34"]["31"]);
    if (!keeper) throw new Error("98:34 has no hatchery keeper");
    world.player.x = keeper.x + 10;
    world.player.y = keeper.y + 19 + 16;
    world.player.direction = 2;
    // One host step: the world asks, the host opens the panel the request names.
    for (let i = 0; i < 10 && !screen.host.panel.visible; i++)
      screen.host.step(i === 0 ? ["confirm"] : []);
    if (world.roomIndex !== 34)
      throw new Error(`the incubator checkpoint left 34 for ${world.roomIndex}`);
    if (screen.host.panel.mode !== "cauVongIncubator")
      throw new Error("the incubator never opened");
    for (const pressed of keys) screen.host.panel.tick(pressed);
    return;
  }
  if (plan.talk !== undefined) {
    const id = plan.talk === "merchant" ? doc.merchants[String(plan.room)]?.actor : plan.talk,
      actor = id === undefined ? undefined : world.actors.get(id);
    if (!actor) throw new Error(`98:${plan.room} has no actor ${plan.talk}`);
    world.player.x = actor.x + 10;
    world.player.y = actor.y + 19 + 16;
    world.player.direction = 2;
  }
  world.tick(plan.talk !== undefined ? ["confirm"] : []);
  const done = () =>
    plan.until === "battle"
      ? world.phase === "battle"
      : plan.until === "choice"
        ? !!world.eventScene?.choice
        : !!world.eventScene?.currentText;
  for (let tick = 0; tick < 30000 && !done(); tick++)
    world.tick(world.eventScene?.textReady ? ["confirm"] : []);
  if (!done()) throw new Error(`Bắc Hải's ${stage} never came`);
  for (let i = 0; i < 120 && !world.eventScene?.textReady && !world.eventScene?.choice; i++)
    world.tick([]);
}
/** CV5 over: the North Sea's flags up to the truth (61:105), and the academy behind the hero. */
const NS_TRUTH: [number, number][] = [
  [6, 100],
  [0, 101],
  [2, 100],
  [2, 101],
  [2, 140],
  [2, 830000],
  [3, 102],
  [27, 1900],
  ...NS_ORDERED,
  [37, 100],
  [36, 101],
  [48, 107],
  [61, 104],
  [61, 105],
];
/** CV6's way in: the forest finale and the reopening in 48. */
const FINALS_OPEN: [number, number][] = [
  [39, 101],
  [40, 101],
  [41, 101],
  [42, 101],
  [42, 102],
  [42, 103],
  [48, 120],
  [48, 130],
];
/** Each stage's room, spot, flags past the truth, and whether it presses 5 (or asks an actor). */
const LAB_STAGES: Record<
  string,
  {
    room: number;
    at: [number, number];
    /** Flags past the truth; "door" the laboratory's door opened, "late" the lab over. */
    from: "truth" | "door" | "late";
    flags: [number, number][];
    /** 5 where the hero stands, or on the actor `actorId(room, source)` of forest.json (`sea`: north-sea.json). */
    press?: true | number | { sea: number };
  }
> = {
  hint: { room: 27, at: [120, 300], from: "truth", flags: [] },
  door: { room: 2, at: [362, 547], from: "truth", flags: [], press: true },
  discovery: { room: 62, at: [60, 100], from: "door", flags: [] },
  betrayal: {
    room: 62,
    at: [240, 110],
    from: "door",
    flags: [
      [62, 100],
      [62, 101],
      [62, 102],
      [62, 103],
      [62, 1502],
    ],
  },
  goodbye: {
    room: 60,
    at: [170, 259],
    from: "door",
    flags: [
      [62, 100],
      [62, 101],
      [62, 102],
      [62, 103],
      [62, 104],
      [62, 105],
    ],
  },
  advice: { room: 60, at: [200, 300], from: "late", flags: [], press: 6 },
  guard41: {
    room: 41,
    at: [330, 270],
    from: "late",
    flags: [
      [39, 101],
      [40, 101],
    ],
  },
  principal: {
    room: 42,
    at: [150, 330],
    from: "late",
    flags: [
      [39, 101],
      [40, 101],
      [41, 101],
    ],
  },
  rafael: {
    room: 42,
    at: [150, 300],
    from: "late",
    flags: [
      [39, 101],
      [40, 101],
      [41, 101],
      [42, 6310],
      [42, 101],
    ],
  },
  locke: {
    room: 39,
    at: [160, 540],
    from: "late",
    flags: [
      [39, 101],
      [47, 7003],
    ],
  },
  reopen: {
    room: 48,
    at: [400, 80],
    from: "late",
    flags: [
      [42, 101],
      [42, 102],
      [42, 103],
    ],
  },
  // CV6: the finals in 30 once 48:120 is set.
  finals: { room: 30, at: [300, 300], from: "late", flags: FINALS_OPEN },
  referee: {
    room: 30,
    at: [300, 300],
    from: "late",
    flags: [...FINALS_OPEN, [30, 120]],
    press: { sea: 26 },
  },
  award: {
    room: 30,
    at: [300, 300],
    from: "late",
    flags: [...FINALS_OPEN, [30, 120], [30, 121], [30, 122], [30, 123]],
  },
};
export const CAU_VONG_LAB_STAGE_NAMES = Object.keys(LAB_STAGES);
/**
 * CV5b (`?cauVongLab=<stage>`, `CauVongAcademyLaboratoryRuntime`, the late Rừng U Ám, REOPEN) with
 * the party at level 100: `hint` 27's pointer back to the lab, `door` 2's door with the key, the
 * laboratory's `discovery` and `betrayal` (62), the `goodbye` and actor 6's `advice` (60), the
 * general's guard in 41 (`guard41`), the `principal` and `rafael` in 42, Lạc Khắc's rescue in 39
 * (`locke`) and the final's reopening in 48 (`reopen`); CV6's `finals` notice, the `referee`'s offer
 * and the `award` in 30.
 */
export function cauVongLabCheckpoint(screen: NewGameScreen, stage: string): void {
  const plan = LAB_STAGES[stage];
  if (!plan) throw new Error(`Unknown CV5b stage ${stage}`);
  cauVongRoomCheckpoint(screen, 0);
  const world = requireWorld(screen),
    forest = screen.assets.cauVongForest,
    sea = screen.assets.cauVongNorthSea;
  if (!forest || !sea) throw new Error("forest.json / north-sea.json is not loaded");
  for (let tick = 0; tick < 3000 && world.eventVisible; tick++)
    world.tick(world.eventScene?.textReady ? ["confirm"] : []);
  const door: [number, number][] = [
    [27, sea.parts.LAB_HINT.flag],
    [2, forest.flags.doorStarted],
    [2, forest.flags.doorOpened],
  ];
  const late: [number, number][] = [
    ...door,
    ...[100, 101, 102, 103, 104, 105].map((e): [number, number] => [62, e]),
    [60, 100],
    [60, 1500],
    [60, 1501],
    [38, 100],
    [39, 100],
    [40, 6005],
    [40, 6400],
    [38, forest.parts.PORTAL_ARRIVE.flag],
  ];
  const before = plan.from === "truth" ? [] : plan.from === "door" ? door : late,
    // 30's RUMOURS plays on the first visit after the truth; the finals' stages have heard it.
    heard: [number, number][] = plan.room === 30 ? [[30, sea.parts.RUMOURS.flag]] : [];
  for (const [r, event] of [...NS_TRUTH, ...before, ...heard, ...plan.flags])
    world.eventState.op14CompleteEvent(CAU_VONG_SCENE, r, event);
  // The advice stage asks before the advice is heard.
  if (stage === "advice") world.eventState.op42RepeatEvent(CAU_VONG_SCENE, 60, 1500);
  world.inventory[String(forest.flags.northSeaKey)] = 1;
  for (const pet of world.pets) {
    pet.level = 100;
    pet.currentHp = undefined;
  }
  const [x, y] = plan.at;
  if (!world.warp({ scene: CAU_VONG_SCENE, room: plan.room, x, y, direction: 0 }))
    throw new Error(`98:${plan.room} is not loaded`);
  for (let i = 0; i < 400 && world.mapLoading; i++) world.tickMapLoading();
  if (plan.press !== undefined && plan.press !== true) {
    const ids = typeof plan.press === "number" ? forest.actors : sea.actors,
      source = typeof plan.press === "number" ? plan.press : plan.press.sea;
    const actor = world.actors.get(ids[String(plan.room)][String(source)]);
    if (!actor) throw new Error(`98:${plan.room} has no actor ${source}`);
    world.player.x = actor.x + 10;
    world.player.y = actor.y + 19 + 16;
  }
  world.player.direction = 2;
  world.tick(plan.press !== undefined ? ["confirm"] : []);
  for (let tick = 0; tick < 30000 && !world.eventScene?.currentText; tick++)
    world.tick(world.eventScene?.textReady ? ["confirm"] : []);
  if (!world.eventScene?.currentText) throw new Error(`CV5b's ${stage} never came`);
  for (let i = 0; i < 120 && !world.eventScene?.textReady; i++) world.tick([]);
}
/** CV3's starting point: the tuition paid, on the source route, the preliminaries required. */
const CV3_REGISTERED: [number, number][] = [
  [6, 100],
  [0, 101],
  [2, 100],
  [2, 101],
  [2, 140],
  [2, 830000],
];
/** The rooms and flags each `?cauVongOpening=<stage>` stands on (CV0 room 54 to CV3). */
const CAU_VONG_OPENING_STAGES: Record<
  string,
  {
    room: number;
    at: [number, number];
    flags: [number, number][];
    talk?: number;
    /** A Cầu Vồng shop category opened over the room, on its offers. */
    panel?: number;
  }
> = {
  family: { room: 54, at: [410, 370], flags: [], talk: 10 },
  city: { room: 1, at: [80, 76], flags: [[54, 100]] },
  lucy: {
    room: 1,
    at: [200, 300],
    flags: [
      [54, 100],
      [1, 100],
      [1, 841001],
    ],
    talk: 1,
  },
  thorns: {
    room: 11,
    at: [80, 80],
    flags: [
      [54, 100],
      [1, 100],
      [1, 101],
      [11, 841003],
    ],
  },
  delivery: {
    room: 11,
    at: [80, 80],
    flags: [
      [54, 100],
      [1, 100],
      [1, 101],
      [11, 102],
      [11, 841003],
    ],
    talk: 1,
  },
  ruins: {
    room: 5,
    at: [340, 94],
    flags: [
      [54, 100],
      [1, 100],
      [1, 101],
      [11, 100],
    ],
  },
  merchant: {
    room: 5,
    at: [340, 94],
    flags: [
      [54, 100],
      [11, 100],
      [5, 100],
    ],
    talk: 1,
  },
  inner: {
    room: 6,
    at: [130, 420],
    flags: [
      [54, 100],
      [11, 100],
      [5, 100],
      [5, 103],
      [5, 104],
      [5, 105],
    ],
  },
  // CV2 ("chăm trứng, chuẩn bị đi học"), after the inner ruins egg (6:100).
  jess: { room: 0, at: [200, 300], flags: [[6, 100]], talk: 24 },
  steward: {
    room: 54,
    at: [410, 370],
    flags: [
      [54, 100],
      [6, 100],
    ],
    talk: 12,
  },
  hatchery: {
    room: 55,
    at: [115, 410],
    flags: [
      [6, 100],
      [55, 7005],
    ],
    talk: 10,
  },
  dong: {
    room: 1,
    at: [260, 300],
    flags: [
      [54, 100],
      [1, 100],
      [6, 100],
    ],
  },
  cafe: {
    room: 44,
    at: [240, 480],
    flags: [
      [6, 100],
      [1, 10],
      [44, 4],
      [44, 2],
      [50, 651100],
    ],
    talk: 70,
  },
  hub: {
    room: 50,
    at: [450, 519],
    flags: [
      [6, 100],
      [1, 10],
      [44, 4],
    ],
  },
  academy: {
    room: 2,
    at: [72, 350],
    flags: [
      [6, 100],
      [0, 101],
    ],
  },
  register: {
    room: 2,
    at: [72, 350],
    flags: [
      [6, 100],
      [0, 101],
      [2, 100],
      [2, 148],
    ],
    talk: 1,
  },
  // CV3: registered (2:101, the source route 2:140, the preliminaries required 2:830000).
  prelims: { room: 8, at: [150, 499], flags: CV3_REGISTERED },
  brief: {
    room: 4,
    at: [50, 560],
    flags: [...CV3_REGISTERED, [8, 2], [8, 100]],
  },
  tour: {
    room: 2,
    at: [250, 499],
    flags: [...CV3_REGISTERED, [8, 2], [8, 100], [4, 104]],
  },
  dorm: {
    room: 59,
    at: [200, 450],
    flags: [...CV3_REGISTERED, [8, 2], [4, 104], [2, 141]],
  },
  ceremony: {
    room: 2,
    at: [300, 400],
    flags: [...CV3_REGISTERED, [8, 2], [4, 104], [2, 141], [59, 102], [59, 905]],
  },
  locke: {
    room: 2,
    at: [300, 400],
    flags: [...CV3_REGISTERED, [8, 2], [4, 104], [2, 141]],
    talk: 64,
  },
  lesson: {
    room: 3,
    at: [280, 560],
    flags: [
      ...CV3_REGISTERED,
      [8, 2],
      [4, 104],
      [2, 141],
      [59, 102],
      [59, 905],
      [2, 103],
      [2, 143],
    ],
    talk: 1,
  },
  fourGates: {
    room: 3,
    at: [360, 390],
    flags: [
      ...CV3_REGISTERED,
      [8, 2],
      [4, 104],
      [2, 141],
      [59, 102],
      [59, 905],
      [2, 103],
      [2, 143],
      [3, 100],
      [3, 101],
    ],
  },
  alliance: {
    room: 3,
    at: [280, 560],
    flags: [...CV3_REGISTERED, [3, 100], [3, 102]],
    talk: 67,
  },
  // CV3's leftovers: the campus shop (43) — its intro, Harry's offer once the tip is paid, the
  // badge exchange — the arena merchant (4) and the later principal's first report.
  shop: { room: 43, at: [200, 450], flags: [...CV3_REGISTERED, [3, 100], [3, 102]] },
  harry: {
    room: 43,
    at: [200, 300],
    flags: [...CV3_REGISTERED, [3, 100], [3, 102], [43, 1600], [43, 1605], [43, 1606], [43, 1650]],
    talk: 16,
  },
  badges: {
    room: 43,
    at: [200, 300],
    flags: [...CV3_REGISTERED, [3, 100], [3, 102], [43, 1600]],
    panel: 2,
  },
  arenaMerchant: {
    room: 4,
    at: [120, 300],
    flags: [...CV3_REGISTERED, [3, 100], [3, 102], [4, 104]],
    talk: 49,
  },
  laterPrincipal: {
    room: 4,
    at: [240, 200],
    flags: [...CV3_REGISTERED, [3, 100], [3, 102], [4, 104], [59, 131]],
    talk: 153,
  },
};
/**
 * The Cầu Vồng opening route (`?cauVongOpening=<stage>`, `CauVongOpeningSourceRuntime` and its
 * room owners): `family` the grandfather's welcome (54), `city` Thành Cầu Vồng's arrival, `lucy`
 * Lucy's offer menu, `thorns` Rừng Gai on Quả Tử Tiểu Tả, `delivery` Ca Tu's lunch scene, `ruins`
 * the ruins' arrival, `merchant` its first line, `inner` the inner ruins' opening (6). CV2:
 * `jess` the incubation lesson (0), `steward` Rom's (54), `hatchery` the helper's count (55),
 * `dong` Đông Phương's scene (1), `cafe` the collector's offer (44), `hub` Thiên Không's first
 * scene (50), `academy` the academy's arrival and `register` its tuition (2). CV3: `prelims` the
 * preliminary arena (8), `brief` the middle arena (4), `tour` the yard's tour, `dorm` the first
 * night (59), `ceremony`, `locke` Lạc Khắc's offer (2), `lesson`, `fourGates` and `alliance` (3).
 */
export function cauVongOpeningCheckpoint(screen: NewGameScreen, stage: string): void {
  const plan = CAU_VONG_OPENING_STAGES[stage];
  if (!plan) throw new Error(`Unknown Cầu Vồng opening stage ${stage}`);
  cauVongRoomCheckpoint(screen, 0);
  const world = requireWorld(screen),
    opening = screen.assets.cauVongOpening;
  if (!opening) throw new Error("opening.json is not loaded");
  for (let tick = 0; tick < 3000 && world.eventVisible; tick++)
    world.tick(world.eventScene?.textReady ? ["confirm"] : []);
  for (const [r, event] of plan.flags) world.eventState.op14CompleteEvent(CAU_VONG_SCENE, r, event);
  if (stage === "delivery") world.inventory[String(opening.items.lunch.id)] = 1;
  if (stage === "register") world.currency.money = Math.max(world.currency.money, 20000);
  if (CAU_VONG_OPENING_STAGES[stage].flags.includes(CV3_REGISTERED[0]) && stage !== "alliance")
    world.inventory["9002"] = 1;
  const [x, y] = plan.at;
  if (!world.warp({ scene: CAU_VONG_SCENE, room: plan.room, x, y, direction: 0 }))
    throw new Error(`98:${plan.room} is not loaded`);
  for (let i = 0; i < 400 && world.mapLoading; i++) world.tickMapLoading();
  if (stage === "thorns" && world.selectRide(CV_PLANT) !== "ready")
    throw new Error("Quả Tử Tiểu Tả is not owned");
  if (plan.panel !== undefined) {
    world.currency.money = Math.max(world.currency.money, 5000);
    world.currency.badges = Math.max(world.currency.badges, 20);
    screen.host.panel.openCauVongShop(plan.panel);
    // "Mua / trao đổi": the offers.
    screen.host.panel.tick(["confirm"]);
    return;
  }
  if (plan.talk !== undefined) {
    const actor = world.actors.get(plan.talk);
    if (!actor) throw new Error(`98:${plan.room} has no actor ${plan.talk}`);
    world.player.x = actor.x + 10;
    world.player.y = actor.y + 19 + 16;
    world.player.direction = 2;
  }
  world.tick(plan.talk !== undefined ? ["confirm"] : []);
  for (let i = 0; i < 400; i++) {
    if (world.eventScene?.choice || (world.eventScene?.currentText && world.eventScene.textReady))
      return;
    if (stage === "thorns" && i > 30) return;
    world.tick([]);
  }
}
/**
 * A free-world random wild encounter (`?wildEncounter=1`): the hero on the grass of "Đường nhỏ phía
 * Nam" (1:2) one step from the end of the countdown, walked until the fight opens, then held on it.
 */
/**
 * `&lead=<speciesId>` puts that species in front (a V4 pet shows its `v4-sprites` art);
 * `&nature=<n>` gives it that nature (7..9: the shiny palette); `&wildSkillTick=<n>` uses its first
 * skill and holds the battle `n` ticks into the action, or with 0 on the first tick a state-1 L shows
 * (the lunge of species 0, 10, 62, 75, 87, 91, 92, 97 and 98).
 */
export function wildEncounterCheckpoint(
  screen: NewGameScreen,
  withCharms = false,
  lead = 68,
  freeze = true,
  leadNature?: number,
  skillTick?: number,
): void {
  const assets = screen.assets,
    room = assets.getWorldRoom(1, 2),
    map = room ? assets.getCollision(room.mapId) : undefined;
  if (!map) throw new Error("Room 1:2 has no collision for the wild encounter checkpoint");
  let spot: { x: number; y: number } | null = null;
  for (let y = 40; y < 600 && !spot; y += 4)
    for (let x = 40; x < 600 && !spot; x += 4)
      if (
        terrainAtWorld(map, x, y) === 0 &&
        stepWithTerrain(map, x, y, DIRECTION_RIGHT).moved &&
        stepWithTerrain(map, x + 8, y, DIRECTION_LEFT).moved
      )
        spot = { x, y };
  if (!spot) throw new Error("No grass in 1:2");
  frozenWorldSave(
    screen,
    scene1Save({
      location: { sceneId: 1, roomIndex: 2, ...spot, direction: 1 },
      owner: SCENE1_RESUME.bunnyReturnRoom0,
      bunnyCaught: true,
      eventStates: { "1:1:0": 3 },
      pets: [{ speciesId: lead, level: 9, quality: 2 }],
    }),
  );
  const world = requireWorld(screen);
  if (leadNature !== undefined) world.pets[0].nature = leadNature;
  // `&charms=1`: Cao cấp trị liệu III and Kỹ năng Phong Bế II worn, for the HUD badges.
  if (withCharms) {
    world.campaign.charms.tiers = { "5037": 3, "5039": 2 };
    world.campaign.charms.active.SURVIVAL = 5037;
    world.campaign.charms.active.TACTICAL = 5039;
  }
  world.encounterStepsRemaining = 2;
  screen.frozen = false;
  for (let i = 0; i < 400 && !world.battle; i++)
    screen.step([Math.trunc(i / 3) % 2 === 0 ? "holdRight" : "holdLeft"]);
  for (let i = 0; i < 60 && world.battle && world.phase !== "battle"; i++) screen.step([]);
  for (let i = 0; i < 40 && world.phase === "battle"; i++) screen.step([]);
  if (world.phase !== "battle") throw new Error(`Wild encounter did not open (${world.phase})`);
  if (skillTick !== undefined) {
    for (let i = 0; i < 200 && world.battleStage !== "fight"; i++) screen.step([]);
    screen.step(["confirm"]);
    screen.step(["confirm"]);
    // 0: hold on the first tick a state-1 L shows (whoever acts first).
    if (skillTick === 0)
      for (let i = 0; i < 400 && !world.battle?.stateOneLEffect; i++) screen.step([]);
    else for (let i = 1; i < skillTick; i++) screen.step([]);
    if (world.battleStage !== "skillAction")
      throw new Error(`Wild skill tick ${skillTick} not active (${world.battleStage})`);
  }
  screen.frozen = freeze;
}
/**
 * Swimming with Thủy Lam Chương (`?swim=<stage>`): the hero walks down off the bank of 1:6 into the
 * water. `move` holds him mid-stroke (mode 6), `idle` floating still (mode 9), `skin` swims under the
 * wardrobe skin 30 (drawn from Neil's own sheet), `bank` is that skin one step before the water.
 */
export function swimCheckpoint(screen: NewGameScreen, stage: string): void {
  frozenWorldSave(
    screen,
    scene1Save({
      location: { sceneId: 1, roomIndex: 6, x: 176, y: 248, direction: 0 },
      owner: SCENE1_RESUME.bunnyReturnRoom0,
      bunnyCaught: true,
      eventStates: { "1:1:0": 3 },
      pets: [{ speciesId: 68, level: 9, quality: 2 }],
    }),
  );
  const world = requireWorld(screen),
    room = screen.assets.getWorldRoom(1, 6),
    map = room ? screen.assets.getCollision(room.mapId) : undefined;
  if (!map) throw new Error("Room 1:6 has no collision for the swim checkpoint");
  world.flags.badges.grant(BADGE_THUY_LAM);
  if (stage === "skin" || stage === "bank") world.setFashionSprite(30);
  world.encounterStepsRemaining = 9999;
  screen.frozen = false;
  const wet = () => terrainAtWorld(map, world.player.x, world.player.y) === 2;
  if (stage === "bank") screen.step(["holdDown"]);
  else {
    for (let i = 0; i < 60 && !wet(); i++) screen.step(["holdDown"]);
    for (let i = 0; i < 6 && wet(); i++) screen.step(["holdDown"]);
  }
  if (stage === "idle") for (let i = 0; i < 6; i++) screen.step([]);
  screen.frozen = true;
}
/** The golden rosters `ProbeWebDoubleBattle` records, so a checkpoint fight matches a Java one. */
const DOUBLE_BATTLE_PARTIES: Record<
  string,
  { room: [number, number]; pets: [number, number, number, number][] }
> = {
  SCENE2_ROOM0_GROUP1_SOLDIERS: {
    room: [2, 0],
    pets: [
      [68, 9, 2, 2],
      [58, 8, 2, 3],
    ],
  },
  SCENE9_ROOM0_GROUP1_LARRY: {
    room: [9, 0],
    pets: [
      [68, 32, 2, 2],
      [58, 30, 2, 3],
      [95, 28, 1, 5],
    ],
  },
  SCENE9_ROOM0_GROUP2_PASILI: {
    room: [9, 0],
    pets: [
      [68, 28, 2, 2],
      [58, 27, 2, 3],
      [95, 26, 1, 4],
      [56, 26, 1, 6],
    ],
  },
  SCENE9_ROOM0_GROUP4_LEADER: {
    room: [9, 0],
    pets: [
      [68, 40, 2, 2],
      [58, 38, 2, 3],
      [95, 36, 1, 5],
    ],
  },
};
/**
 * A simultaneous 2v2 (`?doubleBattle=<descriptor symbol>`), opened over its room and held at
 * `&doubleStage=`: `entry` (`&doubleTicks=N` into the slide-in), `command` (the first command bar),
 * `skill` (its skill list), `target` (the target cursor on the first enemy) or `round`
 * (`&doubleTicks=N` into the first round's beats, every slot on its first skill), or
 * `act-<actor>-<phase>-<ticks>` (the same commands, held where that slot's action reaches that
 * `actionPhase` and `actionTicks`, as `RenderDoubleBattleReference` holds JavaSE), or `l-effect` (the
 * same commands, held on the first tick a state-1 L shows). `&doubleLead=<speciesId>` swaps the
 * first party pet.
 */
export function doubleBattleCheckpoint(
  screen: NewGameScreen,
  symbol: string,
  stage: string,
  ticks: number,
  lead?: number,
): void {
  const authored = DOUBLE_BATTLE_PARTIES[symbol] ?? DOUBLE_BATTLE_PARTIES.SCENE9_ROOM0_GROUP1_LARRY,
    party =
      lead === undefined
        ? authored
        : {
            ...authored,
            pets: authored.pets.map((pet, index) =>
              index === 0 ? ([lead, ...pet.slice(1)] as typeof pet) : pet,
            ),
          };
  frozenWorldSave(
    screen,
    scene1Save({
      location: { sceneId: party.room[0], roomIndex: party.room[1], x: 120, y: 200, direction: 0 },
      owner: SCENE1_RESUME.bunnyReturnRoom0,
      bunnyCaught: true,
      eventStates: { "1:1:0": 3 },
      pets: party.pets.map(([speciesId, level, quality, nature]) => ({
        speciesId,
        level,
        quality,
        nature,
      })),
    }),
  );
  const world = requireWorld(screen),
    services = world.battleServices;
  if (!services) throw new Error("The 2v2 checkpoint needs battle services");
  // The starter species takes its authored defaults (HP, deck) for what a save leaves out; Java's
  // `PetSourceAdapter.create` builds each pet at its own level, so deal those here.
  for (const pet of world.pets) {
    pet.currentHp = services.petStats.coreStats(
      pet.speciesId,
      pet.level,
      pet.quality,
      pet.nature ?? 0,
    ).hp;
    pet.skillIds = services.progression.initialSkills(pet.speciesId, pet.level);
    pet.skillPp = services.progression.fullPp(pet.skillIds);
    // `PetSourceAdapter.create` gives no physical trait; a rolled one would add a passive status.
    pet.physicalTraitId = 0;
  }
  const battle = createDoubleBattle(
    services,
    symbol,
    world.pets,
    world.inventory,
    world.data.itemCatalog ?? [],
    (spriteId) => screen.doubleBattleFallTicks(spriteId),
    (trainerOwned) => world.battleCharms(trainerOwned),
    7,
  );
  void screen.openDoubleBattle(battle);
  screen.frozen = false;
  const until = (done: () => boolean, input: InputCommand[] = []) => {
    for (let i = 0; i < 600 && !done(); i++) screen.step(input);
  };
  const act = /^act-([0-3])-([0-4])-([0-9]+)$/.exec(stage);
  if (stage === "entry") for (let i = 0; i < ticks; i++) screen.step([]);
  else if (stage === "l-effect") {
    for (let i = 0; i < 2000 && !battle.finished && !battle.stateOneLEffect; i++) {
      if (battle.stage === "command") {
        for (let press = 0; press < 3; press++) screen.step(["confirm"]);
        continue;
      }
      screen.step([]);
    }
  } else if (act) {
    // Every command slot on its first skill at its first target, held at one action tick.
    const [actor, phase, at] = act.slice(1).map(Number);
    for (let i = 0; i < 2000 && !battle.finished; i++) {
      if (battle.stage === "command") {
        for (let press = 0; press < 3; press++) screen.step(["confirm"]);
        continue;
      }
      screen.step([]);
      const now = battle.action;
      if (now && now.actor === actor && now.phase === phase && now.ticks === at) break;
    }
  } else {
    until(() => battle.stage === "command");
    if (stage === "skill" || stage === "target") screen.step(["confirm"]);
    if (stage === "target") screen.step(["confirm"]);
    if (stage === "round") {
      for (let slot = 0; slot < 2 && battle.stage === "command"; slot++) {
        screen.step(["confirm"]);
        screen.step(["confirm"]);
        screen.step(["confirm"]);
      }
      for (let i = 0; i < ticks; i++) screen.step([]);
    }
  }
  screen.frozen = true;
}
/**
 * The Bích Thủy shop (11:8), the hero facing the merchant ABell (`?worldShop=N`): 0 her line, 1 the
 * "Thương điếm" menu, 2 the sell list, 3 the sell quantity box, 4 the recovery question, 5 "Mua sắm".
 */
export function worldShopCheckpoint(screen: NewGameScreen, row: number): void {
  const merchant = screen.assets.getWorldRoom(11, 8)?.actors.find((actor) => actor.id === 1);
  if (!merchant) throw new Error("Room 11:8 has no merchant");
  frozenWorldSave(
    screen,
    scene1Save({
      location: { sceneId: 11, roomIndex: 8, x: merchant.x, y: merchant.y + 24, direction: 2 },
      owner: SCENE1_RESUME.bunnyReturnRoom0,
      bunnyCaught: true,
      eventStates: { "1:1:0": 3 },
      pets: [{ speciesId: 68, level: 20, quality: 2 }],
    }),
  );
  const world = requireWorld(screen);
  for (let dy = 12; dy <= 40 && world.talkPrompt?.actorId !== 1; dy++)
    world.player.y = merchant.y + dy;
  if (world.talkPrompt?.actorId !== 1) throw new Error("The hero does not face the merchant");
  world.inventory["0"] = 4;
  world.inventory["2"] = 2;
  world.currency.money = 900;
  if (row === 4) world.pets[0].currentHp = 10;
  if (row < 0) return;
  screen.frozen = false;
  screen.step(["confirm"]);
  for (let i = 0; i < 6; i++) screen.step([]);
  if (row >= 1) {
    screen.step(["confirm"]);
    screen.step(["confirm"]);
    for (let i = 0; i < 2; i++) screen.step([]);
    if (screen.host.panel.mode !== "worldShop")
      throw new Error(`Thương điếm did not open (${screen.host.panel.mode})`);
  }
  if (row === 2 || row === 3) {
    screen.step(["down"]);
    screen.step(["confirm"]);
    if (row === 3) {
      screen.step(["confirm"]);
      screen.step(["right"]);
    }
  } else if (row === 4) {
    screen.step(["down"]);
    screen.step(["down"]);
    screen.step(["confirm"]);
  } else if (row === 5) screen.step(["confirm"]);
  for (let i = 0; i < 2; i++) screen.step([]);
  screen.frozen = true;
}
/**
 * The town services (`?service=N`): 0 the Bích Thủy envoy's "Tiện lợi điếm", 1 its locked evolve
 * row, 2 "Ngân hàng Sủng vật", 3 the bank's "Gởi lại" pet list, 4 the portable shop's quantity box, 5 its menu, 6 the ordinary list, 7 the material list.
 */
export function serviceCheckpoint(screen: NewGameScreen, row: number): void {
  worldShopCheckpoint(screen, -1);
  const world = requireWorld(screen),
    panel = screen.host.panel;
  world.pets.push({ ...world.pets[0], slot: 1, speciesId: 58, level: 12 });
  screen.frozen = false;
  if (row <= 1) {
    panel.openConvenience(true);
    if (row === 1) {
      screen.step(["down"]);
      screen.step(["confirm"]);
    }
  } else if (row <= 3) {
    panel.openPetBank();
    if (row === 3) screen.step(["confirm"]);
  } else if (row === 4) {
    panel.openPortableShop();
    screen.step(["confirm"]);
    screen.step(["confirm"]);
    screen.step(["right"]);
  } else {
    // 5 the portable shop menu, 6 its "THƯƠNG ĐIẾM BÌNH DÂN" list, 7 "CỬA HÀNG TÀI LIỆU".
    panel.openPortableShop();
    if (row === 7) for (let i = 0; i < 3; i++) screen.step(["down"]);
    if (row >= 6) screen.step(["confirm"]);
  }
  for (let i = 0; i < 2; i++) screen.step([]);
  screen.frozen = true;
}
/**
 * The rooms a URL checkpoint stands in, so the app can fetch their maps before it applies the
 * checkpoint (rooms past the opening and Scene 1 load on demand, and a frozen frame cannot wait).
 */
export function checkpointRooms(params: URLSearchParams): [scene: number, room: number][] {
  const cauVongRoom = params.get("cauVongRoom");
  if (params.get("tanNguyet") !== null)
    return [[TAN_NGUYET_BOSS.sceneId, TAN_NGUYET_BOSS.roomIndex]];
  if (params.get("swim") !== null) return [[1, 6]];
  if (params.get("cauVongLocke") !== null)
    return [
      [CAU_VONG_SCENE, 0],
      [CAU_VONG_SCENE, 32],
      [CAU_VONG_SCENE, 39],
      [CAU_VONG_SCENE, 52],
    ];
  if (params.get("cauVongLab") !== null)
    return [0, 2, 10, 27, 30, 38, 39, 40, 41, 42, 47, 48, 60, 62].map((room): [number, number] => [
      CAU_VONG_SCENE,
      room,
    ]);
  if (params.get("cauVongSummon") !== null)
    return [0, 49, 50, 66].map((room): [number, number] => [CAU_VONG_SCENE, room]);
  if (params.get("cauVongNorthSea") !== null)
    return [0, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 45, 48, 53, 56, 61].map(
      (room): [number, number] => [CAU_VONG_SCENE, room],
    );
  if (params.get("cauVongFourGates") !== null)
    return [
      0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 15, 17, 18, 19, 24, 26, 38, 39, 40, 52, 57, 58, 59, 60,
    ].map((room): [number, number] => [CAU_VONG_SCENE, room]);
  if (params.get("cauVongOpening") !== null)
    return [0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 43, 44, 50, 54, 55, 59].map((room): [number, number] => [
      CAU_VONG_SCENE,
      room,
    ]);
  if (params.get("cauVongHall") !== null)
    return [
      [CAU_VONG_SCENE, 0],
      [CAU_VONG_SCENE, 47],
      [CAU_VONG_SCENE, 54],
    ];
  if (params.get("cauVongSquare") !== null)
    return [
      [CAU_VONG_SCENE, 0],
      [CAU_VONG_SCENE, 47],
      [8, 1],
    ];
  const doubleBattle = params.get("doubleBattle");
  if (doubleBattle !== null)
    return [
      (DOUBLE_BATTLE_PARTIES[doubleBattle] ?? DOUBLE_BATTLE_PARTIES.SCENE9_ROOM0_GROUP1_LARRY).room,
    ];
  return cauVongRoom !== null ? [[CAU_VONG_SCENE, Math.floor(Number(cauVongRoom))]] : [];
}
/**
 * Tàn Nguyệt Long Ma in Cứ điểm Thánh Điện (`?tanNguyet=<stage>`), the hero just below the boss:
 * `room` (the boss on the statue's spot), `blocked` (5 with two pets: the requirement notice),
 * `entry` (`&tanNguyetTicks=N` into the entry wipe), `command` (the first command bar), `act`
 * (every slot on its first skill, held `&tanNguyetTicks=N` into the boss's own action), `victory`
 * (the reward notice) or `defeat` (the defeat card).
 */
export function tanNguyetCheckpoint(screen: NewGameScreen, stage: string, ticks: number): void {
  const party: SavedPet[] = (stage === "blocked" ? [68, 58] : [68, 58, 95, 56, 68, 58]).map(
    (speciesId, slot) => ({
      speciesId,
      level: stage === "blocked" ? 30 : 50,
      quality: 2,
      nature: 2,
      slot,
    }),
  );
  frozenWorldSave(
    screen,
    scene1Save({
      location: {
        sceneId: TAN_NGUYET_BOSS.sceneId,
        roomIndex: TAN_NGUYET_BOSS.roomIndex,
        x: TAN_NGUYET_BOSS.x,
        y: TAN_NGUYET_BOSS.y + 30,
        direction: 2,
      },
      owner: SCENE1_RESUME.bunnyReturnRoom0,
      bunnyCaught: true,
      eventStates: { "1:1:0": 3 },
      pets: party,
    }),
  );
  const world = requireWorld(screen),
    services = world.battleServices;
  if (!services) throw new Error("The Tàn Nguyệt checkpoint needs battle services");
  for (const pet of world.pets) {
    pet.currentHp = services.petStats.coreStats(
      pet.speciesId,
      pet.level,
      pet.quality,
      pet.nature ?? 0,
    ).hp;
    pet.skillIds = services.progression.initialSkills(pet.speciesId, pet.level);
    pet.skillPp = services.progression.fullPp(pet.skillIds);
    pet.physicalTraitId = 0;
  }
  screen.frozen = false;
  for (let i = 0; i < 3; i++) screen.step([]);
  if (stage === "victory" || stage === "defeat") {
    world.finishTanNguyetBattle(stage === "victory");
    screen.step([]);
  } else if (stage !== "room") {
    screen.step(["confirm"]);
    if (stage === "entry") for (let i = 0; i < ticks; i++) screen.step([]);
    else if (stage === "command" || stage === "act") {
      for (let i = 0; i < 400 && world.doubleBattle?.stage !== "command"; i++) screen.step([]);
      const battle = world.doubleBattle;
      if (!battle) throw new Error(`The boss fight did not open (${world.phase})`);
      if (stage === "act")
        for (let i = 0; i < 2000 && !battle.finished; i++) {
          if (battle.stage === "command") {
            for (let press = 0; press < 3; press++) screen.step(["confirm"]);
            continue;
          }
          screen.step([]);
          const now = battle.action;
          if (now && now.actor === 1 && now.ticks === ticks) break;
        }
    }
  }
  screen.frozen = true;
}
export function applyUrlParityCheckpoint(screen: NewGameScreen, params: URLSearchParams): boolean {
  const checkpoint = params.get("scene0Checkpoint"),
    mapLoadingTick = params.get("mapLoadingTick"),
    cauVongRoom = params.get("cauVongRoom"),
    textCheckpoint = params.get("scene0Text"),
    afterTextCheckpoint = params.get("scene0AfterText"),
    scene1Text = params.get("scene1Text"),
    scene1Item = params.get("scene1Item"),
    scene1TaskTip = params.get("scene1TaskTip") === "1",
    scene1Battle = params.get("scene1Battle"),
    scene1BattleTick = params.get("scene1BattleTick"),
    scene1MovementTick = params.get("scene1MovementTick"),
    scene1Complete = params.get("scene1Complete") === "1",
    scene1SavePrompt = params.get("scene1SavePrompt") === "1",
    scene1Elder = params.get("scene1Elder") === "1",
    scene1ElderTransition = params.get("scene1ElderTransition") === "1",
    scene1ElderBattle = params.get("scene1ElderBattle") === "1",
    scene1ElderComplete = params.get("scene1ElderComplete") === "1",
    postBattleExp = params.get("postBattleExp"),
    worldEventTick = params.get("worldEventTick"),
    bunnyEntryTick = params.get("bunnyEntryTick"),
    bunnyBattle = params.get("bunnyBattle") === "1",
    bunnySkillTick = params.get("bunnySkillTick"),
    bunnyCaptureTick = params.get("bunnyCaptureTick"),
    bunnyAfterStrike = params.get("bunnyAfterStrike") === "1",
    statusStrip = params.get("statusStrip") === "1",
    wildEncounter = params.get("wildEncounter") === "1",
    doubleBattle = params.get("doubleBattle"),
    tanNguyet = params.get("tanNguyet"),
    swim = params.get("swim"),
    cauVongSquare = params.get("cauVongSquare"),
    cauVongHall = params.get("cauVongHall"),
    cauVongLocke = params.get("cauVongLocke"),
    cauVongOpening = params.get("cauVongOpening"),
    cauVongFourGates = params.get("cauVongFourGates"),
    cauVongNorthSea = params.get("cauVongNorthSea"),
    cauVongLab = params.get("cauVongLab"),
    cauVongSummon = params.get("cauVongSummon"),
    worldShop = params.get("worldShop"),
    service = params.get("service"),
    battleUi = params.get("battleUi") as BattleUiMode | null,
    worldPanel = params.get("worldPanel") as WorldPanelCheckpoint | null,
    worldPanelRow = Number(params.get("worldPanelRow") ?? 0),
    resume = params.get("resume") === "1",
    afterTextTicks = Number(params.get("scene0AfterTicks") ?? 12);
  const requested =
    checkpoint === "opening-after-confirm-45" ||
    mapLoadingTick !== null ||
    cauVongRoom !== null ||
    textCheckpoint !== null ||
    afterTextCheckpoint !== null ||
    scene1Text !== null ||
    scene1Item !== null ||
    scene1TaskTip ||
    scene1Battle !== null ||
    scene1BattleTick !== null ||
    scene1MovementTick !== null ||
    scene1Complete ||
    scene1SavePrompt ||
    scene1Elder ||
    scene1ElderTransition ||
    scene1ElderBattle ||
    scene1ElderComplete ||
    postBattleExp !== null ||
    worldEventTick !== null ||
    bunnyEntryTick !== null ||
    bunnyBattle ||
    bunnySkillTick !== null ||
    bunnyCaptureTick !== null ||
    bunnyAfterStrike ||
    statusStrip ||
    wildEncounter ||
    doubleBattle !== null ||
    tanNguyet !== null ||
    swim !== null ||
    cauVongSquare !== null ||
    cauVongHall !== null ||
    cauVongLocke !== null ||
    cauVongOpening !== null ||
    cauVongFourGates !== null ||
    cauVongNorthSea !== null ||
    cauVongLab !== null ||
    cauVongSummon !== null ||
    worldShop !== null ||
    service !== null ||
    battleUi !== null ||
    worldPanel !== null;
  if (!requested) return false;
  if (mapLoadingTick !== null) mapLoadingCheckpoint(screen, Number(mapLoadingTick));
  else if (cauVongRoom !== null) {
    cauVongRoomCheckpoint(screen, Math.floor(Number(cauVongRoom)));
    // `&worldPanel=areaMap`: that room's Cầu Vồng area map, once its opening slide has stopped.
    if (worldPanel === "areaMap") {
      screen.host.openAreaMap(requireWorld(screen));
      const view = screen.host.panel.areaMap;
      for (let i = 0; i < 120 && view?.sliding; i++) screen.step([]);
    }
  } else if (swim !== null) swimCheckpoint(screen, swim);
  else if (cauVongSquare !== null) cauVongSquareCheckpoint(screen, cauVongSquare);
  else if (cauVongHall !== null) cauVongHallCheckpoint(screen, cauVongHall);
  else if (cauVongLocke !== null) cauVongLockeCheckpoint(screen, cauVongLocke);
  else if (cauVongOpening !== null) cauVongOpeningCheckpoint(screen, cauVongOpening);
  else if (cauVongFourGates !== null) cauVongFourGatesCheckpoint(screen, cauVongFourGates);
  else if (cauVongNorthSea !== null) cauVongNorthSeaCheckpoint(screen, cauVongNorthSea);
  else if (cauVongLab !== null) cauVongLabCheckpoint(screen, cauVongLab);
  else if (cauVongSummon !== null) cauVongSummonCheckpoint(screen, cauVongSummon);
  else if (worldPanel)
    worldPanelCheckpoint(
      screen,
      worldPanel,
      Number.isFinite(worldPanelRow) ? worldPanelRow : 0,
      (params.get("worldPanelKeys") ?? "")
        .split(",")
        .filter((_, __, all) => all.length > 1 || all[0] !== "")
        .map((key) => (key ? (key as InputCommand) : null)),
      params.get("interactive") !== "1",
    );
  else if (statusStrip) statusStripCheckpoint(screen);
  else if (worldShop !== null) worldShopCheckpoint(screen, Number(worldShop));
  else if (service !== null) serviceCheckpoint(screen, Number(service));
  else if (tanNguyet !== null)
    tanNguyetCheckpoint(screen, tanNguyet, Number(params.get("tanNguyetTicks") ?? 0));
  else if (doubleBattle !== null)
    doubleBattleCheckpoint(
      screen,
      doubleBattle,
      params.get("doubleStage") ?? "command",
      Number(params.get("doubleTicks") ?? 0),
      params.get("doubleLead") !== null ? Number(params.get("doubleLead")) : undefined,
    );
  else if (wildEncounter)
    wildEncounterCheckpoint(
      screen,
      params.get("charms") === "1",
      Number(params.get("lead") ?? 68),
      params.get("interactive") !== "1",
      params.get("nature") !== null ? Number(params.get("nature")) : undefined,
      params.get("wildSkillTick") !== null ? Number(params.get("wildSkillTick")) : undefined,
    );
  else if (battleUi)
    battleUiCheckpoint(
      screen,
      battleUi,
      Number(params.get("battleUiTab") ?? 0),
      params.get("battleUiNature") !== null ? Number(params.get("battleUiNature")) : undefined,
    );
  else if (bunnySkillTick !== null)
    bunnySkillTickCheckpoint(screen, Number(bunnySkillTick), Number(params.get("bunnySkill") ?? 0));
  else if (bunnyCaptureTick !== null)
    bunnyCaptureTickCheckpoint(screen, Number(bunnyCaptureTick), params.get("success") === "1");
  else if (bunnyAfterStrike) bunnyAfterStrikeCheckpoint(screen);
  else if (bunnyBattle) bunnyBattleCheckpoint(screen);
  else if (bunnyEntryTick !== null) bunnyEntryCheckpoint(screen, Number(bunnyEntryTick));
  else if (worldEventTick !== null) worldEventCheckpoint(screen, Number(worldEventTick));
  else if (postBattleExp !== null) postBattleExpCheckpoint(screen, Number(postBattleExp));
  else if (scene1ElderComplete)
    worldElderCompleteCheckpoint(screen, Number(params.get("starter") ?? -1));
  else if (scene1ElderTransition)
    worldElderTransitionCheckpoint(screen, Number(params.get("tick") ?? 8));
  else if (scene1ElderBattle)
    worldElderBattleCheckpoint(screen, Number(params.get("starter") ?? -1));
  else if (scene1Elder) worldElderCheckpoint(screen);
  else if (scene1SavePrompt) worldSavePromptCheckpoint(screen);
  else if (scene1Complete) preludeCompleteCheckpoint(screen);
  else if (scene1TaskTip) preludeTaskTipCheckpoint(screen);
  else if (scene1Item !== null) preludeItemCheckpoint(screen, Number(scene1Item));
  else if (scene1MovementTick !== null)
    preludeMovementCheckpoint(screen, Number(scene1MovementTick));
  else if (scene1BattleTick !== null) preludeBattleTickCheckpoint(screen, Number(scene1BattleTick));
  else if (scene1Battle !== null) preludeBattleCheckpoint(screen, Number(scene1Battle));
  else if (scene1Text !== null) preludeTextCheckpoint(screen, Number(scene1Text));
  else if (afterTextCheckpoint !== null)
    afterNarrationCheckpoint(
      screen,
      Number(afterTextCheckpoint),
      Number.isFinite(afterTextTicks) ? Math.max(0, afterTextTicks) : 12,
    );
  else if (textCheckpoint !== null) narrationCheckpoint(screen, Number(textCheckpoint));
  else openingCheckpoint(screen);
  if (resume) resumeCheckpoint(screen);
  // `&interactive=1`: play on from the checkpoint (walk the room, open menus) instead of a still.
  if (params.get("interactive") === "1") screen.frozen = false;
  return true;
}
