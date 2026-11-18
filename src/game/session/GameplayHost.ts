import { cornerShift, fromUi, viewport } from "../../core/Viewport";
import { SafariSession } from "../world/SafariSession";
import type { SafariMap } from "../meta/Safari";
import type { NpcServicesDocument } from "../world/NpcServices";
import { WharfTravel, type WharfRoute } from "../world/WharfTravel";
import { doubleBattleFallTicks } from "../battle/DoubleEventBattle";
import { battlePanelPoint } from "../battle/BattleLandscape";
import { worldPanelPoint } from "../world/WorldLandscape";
import type { TaskOptionCatalog } from "../quest/TaskOption";
import type { NpcService } from "../world/NpcServices";
import {
  recoverParty as recoverWorldParty,
  recoveryCost,
  sellItem,
  sellRows,
} from "../shop/WorldShop";
import type { CharmResult } from "../charm/RainbowCharms";
import { BAG_OPEN_CHARMS, RAINBOW_CHARM_LOCKED } from "../world/WorldPanel";
import type { InputCommand } from "../../core/input/GameCommand";
import type { BootAssets } from "../../pack/boot";
import type { SaveService } from "../../persistence/SaveService";
import type { GameSave, SavedPet } from "../../persistence/save/GameSave";
import { SKILL_SLOTS } from "../battle/engine/PetProgression";
import type { SourceUiLayout } from "../../rendering/SourceUiLayout";
import type { GameAssets, MetaSystemsDocument, WorldContract } from "../story/GameAssets";
import type { SourceGroupLocator } from "../story/SourceOpcodeInterpreter";
import { ROUTE_ID, type SourceRouteCatalog } from "../story/SourceRoutes";
import type { StoryDataRegistry } from "../story/StoryDataRegistry";
import { StoryRuntime } from "../story/StoryRuntime";
import {
  createStorySceneRuntime,
  type StorySceneRuntime,
  type StorySceneServices,
} from "../story/StorySceneRuntime";
import { WorldPanel } from "../world/WorldPanel";
import { DoorGraph, type StoryGraph } from "../story/StoryGraph";
import { StoryDirector, type StoryAction, type StorySignal } from "../story/StoryDirector";
import type { QuestCatalog } from "../quest/QuestCatalog";
import { TASK_ACTIVE, TASK_COMPLETE, TASK_NONE } from "../quest/QuestLog";
import { AREA_MAP_NO_MAP_TEXT, AreaMapView, type AreaMapCatalog } from "../world/AreaMap";
import {
  PET_ITEM_MISSING,
  PET_ITEM_REFUSALS,
  PET_ITEM_USED,
  applyPetItem,
  petAlive,
  petItemCheck,
  petSettingLabels,
  worldPetCard,
  type PetSpeciesCatalog,
} from "../pet/PetScreen";
import {
  BAG_OPEN_BADGE,
  BAG_EGG_PICKER,
  BAG_OPEN_INCUBATOR,
  BAG_OPEN_PETMAP,
  BAG_PICK_PET,
} from "../world/WorldPanel";
import {
  badgeEntries,
  petmapRows,
  recordStats,
  type BadgeCatalogDocument,
  type UnifiedBadgeRecord,
} from "../record/RecordBook";

import type { AdminGrant } from "../../account/AdminApi";
import type { ClaimedGift } from "../../account/RewardsApi";
import {
  ADMIN_KIND_LABELS,
  adminItemChoices,
  adminSpeciesChoices,
  experienceForLevels,
  grantItem,
  setCurrency,
  ADMIN_BOSS_SPECIES,
  type AdminItemChoice,
  type AdminSpeciesChoice,
} from "../admin/AdminTool";

/** Special items `useSpecialBagRow` opens a Đồ giám page with. */
const PETMAP_BOOK_SPECIAL = 5;
const BADGE_CASE_SPECIAL = 6;
import type { ChoiceRow } from "../../rendering/SourceChoiceRenderer";
import type { PetSkillRow, PetSkillSheet } from "../world/WorldPanel";
import { EvolutionSession } from "../pet/EvolutionSession";
import { repairEvolvedSprite, type EvolutionCatalog } from "../pet/Evolution";
import { QualityUpgradeSession } from "../pet/QualityUpgradeSession";
import { EconomyLedger } from "../economy/EconomyLedger";
import { ROLL_BOUND } from "../pet/QualityUpgrade";
import {
  skillElementName,
  skillRowStatus,
  skillStatus,
  type PetSkillPoolCatalog,
  type PoolEntry,
  type SkillState,
} from "../pet/PetSkillPool";
import {
  bagRows,
  HATCH_BOOST_ID,
  REPEL_ID,
  type BagContents,
  type BagRow,
  type BagTab,
} from "../inventory/Bag";
import {
  mainTaskCursor,
  taskProgressText,
  OPENING_QUEST_TASK,
  taskRows,
  type TaskBoardSource,
  type TaskRow,
} from "../quest/TaskBoard";
import { openingBranchRows, openingQuestDetail } from "../world/CauVongOpening";
import { EVENT_STATE_COMPLETE } from "../world/EventStateLedger";
import { WorldRuntime, type WorldAction, type WorldSources } from "../world/WorldRuntime";
import { worldPointerMask } from "../world/WorldPointer";
import {
  stockOffers,
  type ShopStockDocument,
  purchaseOffer,
  quotePurchase,
  type PortableShopInventory,
} from "../shop/PortableShop";
import { buyFashionBags, exchangeFashion, openFashionBag } from "../fashion/FashionEconomy";
import { redeemGiftCode, type GiftCodeDocument, type GiftCodeResult } from "../meta/GiftCodes";
import {
  cycleRematchRegion,
  recordRematchStart,
  rematchDayKey,
  rematchStatus,
  resolveRematchRegion,
} from "../meta/RegionalChallenges";
import { claimBattlePassReward, purchaseBattlePassVip } from "../meta/BattlePass";
import {
  craftTowerHearts,
  createTowerState,
  finishTowerBattle,
  nurtureTowerPet,
  sweepTower,
  towerCanChallenge,
  towerFloorStatus,
  towerSweepOffer,
  type TowerContent,
  type TowerState,
} from "../meta/BondingTower";
import {
  claimDailyBadges,
  dailyBadgeStatus,
  depositPet,
  purchasePetBankExpansion,
  releaseBankPet,
  withdrawPet,
} from "../campaign/CampaignSystems";
import {
  EGG_TEXT,
  accelerateEgg,
  availableEggIds,
  eggHatchResultText,
  eggReady,
  hatchEgg,
  previewDraw,
  selectForIncubation,
  type HatchContext,
} from "../campaign/EggService";

/**
 * What a gameplay session reads from the pack. Data only: no images, no DOM, so the whole host
 * runs under Node for traces and tests.
 */
export type GameplaySources = {
  /** `story/shop-stock.json`: the shopbuy stocks (`ExportWebShopStock`). */
  shopStock?: ShopStockDocument;
  /** `quest/task-offers.json` as `taskOption.ui` shows it (op49). */
  taskOptions?: TaskOptionCatalog;
  events: StoryDataRegistry;
  routes: SourceRouteCatalog;
  world: WorldSources;
  worldContract: WorldContract;
  layouts: ReadonlyMap<string, SourceUiLayout>;
  /**
   * The room a cutscene stages (the opening keeps its own variants of 7:2 and 5:3); defaults to the
   * world's room.
   */
  sceneRoom?: (scene: number, room: number) => import("../story/GameAssets").RoomAsset | undefined;
  /** `mTask.mid`: the main tasks the task shortcut shows. */
  mainTasks?: readonly { name: string; description: string }[];
  /** The storyline as data and every task the game knows; without them no director runs. */
  storyGraph?: StoryGraph;
  quests?: QuestCatalog;
  /** The original species table for the pet screen. */
  petSpecies?: PetSpeciesCatalog;
  petSkillPools?: PetSkillPoolCatalog;
  evolutions?: EvolutionCatalog;
  petTaxonomy?: Readonly<Record<string, string>>;
  /** The original area map's tables; without them the map key reports no map. */
  areaMaps?: AreaMapCatalog;
  /** Đồ giám: the source badges' names and descriptions, and the unified badges. */
  badgeCatalog?: BadgeCatalogDocument;
  unifiedBadges?: readonly UnifiedBadgeRecord[];
  metaSystems?: MetaSystemsDocument;
  bondingTower?: TowerContent;
  safariMap?: SafariMap;
  giftCodes?: GiftCodeDocument;
};

/**
 * `TextBox.dialog`: pages of four lines, as wide as `dialog.ui` widget 14 (230 px); in landscape
 * the box spans the canvas, so its lines are as wide as the canvas less the margins.
 */
/** A uniform draw in [0, bound) from the platform's cryptographic source (no modulo bias). */
function freshRoll(bound: number): number {
  const limit = Math.floor(0x100000000 / bound) * bound,
    word = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(word);
  while (word[0] >= limit);
  return word[0] % bound;
}

function dialogPagination(boot: BootAssets): (tagged: string) => string[] {
  const width = boot.dialogLayout.w(14, 230);
  return (tagged) =>
    boot.textLayout.paginate(tagged, viewport.landscape ? viewport.width - 10 : width, 4);
}

/** Each wharf captain's room with his dock's routes, for the director's way-out graph. */
function wharfDockRooms(services: NpcServicesDocument | undefined) {
  return (services?.services ?? []).flatMap((service) => {
    const dock = services?.wharfs?.find((row) => row.index === service.wharf);
    return service.continuation === "WHARF" && dock
      ? [{ scene: service.scene, room: service.room, routes: dock.routes }]
      : [];
  });
}

export function gameplaySources(assets: GameAssets, boot: BootAssets): GameplaySources {
  return {
    events: boot.sourceEvents,
    routes: boot.sourceRoutes,
    world: {
      room: (scene, room) => assets.getWorldRoom(scene, room),
      roomReady: (scene, room) => assets.roomReady(scene, room),
      prepareRoom: (scene, room) => void assets.prepareRoom(scene, room),
      prepareSprite: (sprite) => void assets.prepareSprite(sprite),
      doubleFallTicks: (sprite) => doubleBattleFallTicks(assets, sprite),
      collision: (mapId) => assets.getCollision(mapId),
      registry: boot.sourceEvents,
      routePatches: (id) => boot.sourceRoutes.patchesFor(id),
      animationTicks: (sprite, state) => assets.animationTicks(sprite, state),
      collisionMask: (sprite, state, tick) => assets.collisionMask(sprite, state, tick),
      hitMask: (sprite, state, tick) => assets.hitMask(sprite, state, tick),
      pointerMask: (actor) =>
        worldPointerMask(actor, assets.frame(actor.sprite, actor.state, actor.animationTick)),
      dialogPages: dialogPagination(boot),
      petStats: assets.petStats,
      battleRules: assets.battleRules,
      battle: assets.battleServices,
      roomName: (scene, room) => assets.roomName(scene, room),
      bagItems: assets.bagItems,
      worldEncounters: assets.worldEncounters,
      battlePass: assets.metaSystems?.battlePass,
      campaignSystems: assets.campaignSystems,
      rideRooms: assets.rideRooms,
      cauVongCollision: assets.cauVongCollision,
      cauVongSquare: assets.cauVongSquare,
      cauVongCues: assets.cauVongCues,
      cauVongHall: assets.cauVongHall,
      cauVongLocke: assets.cauVongLocke,
      cauVongOpening: assets.cauVongOpening,
      cauVongPrep: assets.cauVongPrep,
      cauVongAcademy: assets.cauVongAcademy,
      cauVongShops: assets.cauVongShops,
      cauVongFourGates: assets.cauVongFourGates,
      cauVongForest: assets.cauVongForest,
      cauVongLab: assets.cauVongLab,
      cauVongNorthSea: assets.cauVongNorthSea,
      cauVongCity: assets.cauVongCity,
      cauVongBranches: assets.cauVongBranches,
      cauVongSummoning: assets.cauVongSummoning,
      rainbowCharms: assets.rainbowCharms,
      npcServices: assets.npcServices,
    },
    mainTasks: assets.mainTasks,
    storyGraph: assets.storyGraph,
    quests: assets.quests,
    areaMaps: assets.areaMaps,
    petSpecies: assets.petSpecies,
    petSkillPools: assets.petSkillPools,
    evolutions: assets.evolutions,
    shopStock: assets.shopStock,
    taskOptions: assets.taskOptions,
    petTaxonomy: assets.petTaxonomy,
    badgeCatalog: assets.badgeCatalog,
    unifiedBadges: assets.unifiedBadges,
    metaSystems: assets.metaSystems,
    bondingTower: assets.bondingTower,
    safariMap: assets.safariMap,
    giftCodes: assets.giftCodes,
    sceneRoom: (scene, room) => assets.getRoom(scene, room),
    worldContract: assets.worldContract,
    layouts: boot.layouts,
  };
}

/** How a session begins: the full opening, the Scene 1 start (skip intro), or a loaded save. */
export type SessionStart =
  { kind: "opening" } | { kind: "skipIntro" } | { kind: "resume"; save: GameSave };

export type GameplayHooks = {
  /** The player left the finished opening (back or a press after its last line). */
  onExit: () => void;
  /** One opening tick ran before the Scene 1 prelude took over (drives the star/fire particles). */
  onOpeningTick?: () => void;
  /** The x2 speed the world.ui checkbox shows and toggles (`toggleSpeedX2`). */
  speedX2?: { enabled: () => boolean; toggle: () => void };
  /** JavaSE `settingsLevel` (0..3), backed by the app audio mixer. */
  volume?: { level: () => number; setLevel: (level: number) => void };
  /** The signed-in account is an admin: the game menu lists "Admin Tool", which opens it. */
  admin?: { enabled: () => boolean; open: () => void };
  /** An online account: gift codes the packaged catalog does not know are asked of the server. */
  rewards?: { redeem: (code: string, bankFree: number) => Promise<ClaimedGift> };
};

/** What the Admin Tool's lists show. */
export type AdminView = {
  items: AdminItemChoice[];
  species: AdminSpeciesChoice[];
  pets: { slot: number; name: string; level: number }[];
  money: number;
  badges: number;
  bank: { used: number; capacity: number };
};

/**
 * Who owns a tick, in the order `VqsvGameRuntime.tick()` asks them:
 *
 * 1. `panel`    – the `gamemenu` / `gamesystem` panel. It opens on Back when the map is quiet
 *                 (`canOpenSourcePanel`) and, while visible, nothing below it simulates.
 * 2. `cutscene` – a scripted scene that owns the screen while the world is suspended: the opening,
 *                 the Scene 1 prelude, the elder return. (Java: the active `Blocking` activity.)
 * 3. `battle`   – a world battle, including its entry transition.
 * 4. `world`    – free movement, NPC/event dispatch, the save prompt.
 *
 * A layer that owns the tick consumes all of its commands; layers below it do not run. New
 * systems (Story VM, more panels, shop, battle UI) plug in as further layers in this order.
 */
export type GameplayLayer = "panel" | "cutscene" | "battle" | "world";

/** `VqsvPanelRuntime.portableShopDescription`. */
function portableShopDescription(row: number, lastClaim: number): string {
  if (row === 1) {
    const status = dailyBadgeStatus(lastClaim, Date.now()),
      seconds = Math.max(0, Math.trunc((status.remainingMillis + 999) / 1000)),
      pad = (n: number) => String(n).padStart(2, "0");
    return (
      "Mỗi ngày nhận 20 Huy hiệu theo giờ thực tế. " +
      (status.available
        ? "Có thể nhận ngay."
        : `Nhận lại sau ${pad(Math.trunc(seconds / 3600))}:${pad(Math.trunc((seconds % 3600) / 60))}:${pad(seconds % 60)}.`)
    );
  }
  if (row === 2) return "Mua túi mù, mở trang phục và đổi mảnh thời trang.";
  if (row === 3) return "Mua tài liệu, trang sức và nguyên liệu tiến hóa.";
  return "Tùy thời mua sắm các loại đạo cụ, già trẻ không gạt.";
}

export class GameplayHost {
  readonly safari = new SafariSession({
    captureAnimation: () =>
      this.sources.world.battle?.captureAnimation ?? this.sources.worldContract.capture,
    map: () => this.sources.safariMap,
    run: () => this.world?.meta.safari,
    setRun: (run) => {
      if (this.world) this.world.meta.safari = run;
    },
    canEnter: () =>
      !!this.world &&
      this.safariEnabled &&
      this.story.worldActive &&
      !this.storyCutscene &&
      !this.mapLoadingActive &&
      this.canOpenPanel(this.world),
    wallet: () => this.world?.currency,
    blocked: () => this.saves.pending > 0 || this.saves.lastError !== null,
    hasSpace: () =>
      !!this.world &&
      (this.world.pets.length < 6 ||
        this.world.campaign.petBank.length < this.world.petBankCapacity()),
    createPet: (id, level, random) => {
      const world = this.world;
      if (!world) return undefined;
      const pet = world.createHatchedPet(id, level);
      if (!pet) return undefined;
      pet.quality = 2;
      pet.nature = random(100) < (world.kimDiemAmuletEquipped() ? 50 : 2) ? 7 + random(3) : 0;
      pet.shinyColor = pet.nature >= 7 ? random(13) : -1;
      const hp = this.sources.world.petStats.coreStats(id, level, pet.quality, pet.nature).hp;
      pet.maxHp = hp;
      pet.currentHp = hp;
      return pet;
    },
    speed: (id) => this.sources.world.petStats.coreStats(id, 1, 0).speed,
    speciesName: (id) => this.sources.world.petStats.speciesRow(id)?.name,
    today: () => rematchDayKey(Date.now()),
    entryDay: () => this.world?.meta.safariDay,
    setEntryDay: (day) => {
      if (this.world) this.world.meta.safariDay = day;
    },
    receive: (pet) => {
      const world = this.world;
      if (!world) return;
      const target = world.pets.length < 6 ? world.pets : world.campaign.petBank;
      target.push({ ...pet, slot: target.length });
      world.collectOwned(pet);
      world.synchronizeGoldenBankReward();
    },
    save: () => {
      if (this.world) this.saves.save(this.snapshot(this.world));
    },
  });
  /**
   * Owner (2026-11-18): Safari is open to every account again (it was admin-only from 2026-11-17).
   * The captain's "Khu Safari" row and the one-run-a-day rule apply to everyone alike.
   */
  get safariEnabled(): boolean {
    return true;
  }
  get safariSaving(): boolean {
    return this.saves.pending > 0;
  }
  get safariSaveFailed(): boolean {
    return this.saves.lastError !== null;
  }
  retrySafariSave(): void {
    this.saves.retryLastFailure();
  }
  /** What a pressed scrollbar thumb belongs to while it is held (`pointerCapture`). */
  private capture: "battle" | "panel" | null = null;
  readonly runtime: StorySceneRuntime;
  prelude: StorySceneRuntime | null = null;
  readonly story: StoryRuntime;
  readonly panel = new WorldPanel();
  /** Runs the story graph: quest log, cutscene/warp requests, the anti-stuck guard. */
  readonly director: StoryDirector | null;
  /** A cutscene the director asked for, playing with the world suspended. */
  private storyCutscene: StorySceneRuntime | null = null;
  /** The director's cutscene on screen, or null: the screen draws it in place of the opening. */
  get cutscene(): StorySceneRuntime | null {
    return this.storyCutscene;
  }
  /** A warp waiting for its room to load. */
  private pendingWarp: Extract<StoryAction, { kind: "warp" }> | null = null;
  /** What the last tick left behind, to turn this tick's changes into story signals. */
  private observed: { world: boolean; room: string; events: Record<string, number> } = {
    world: false,
    room: "",
    events: {},
  };
  private readonly services: StorySceneServices;
  /** An op45 task announced before the first world exists, applied when one is built. */
  private pendingTaskProgress: number | null = null;
  /** Source groups a route played before the first world existed, applied when one is built. */
  private pendingRouteGroups: SourceGroupLocator[] = [];

  constructor(
    private readonly sources: GameplaySources,
    private readonly saves: SaveService,
    private readonly hooks: GameplayHooks,
    start: SessionStart = { kind: "opening" },
  ) {
    this.panel.safariSource.open = () => this.safari.open();
    this.services = {
      room: sources.sceneRoom ?? sources.world.room,
      animationTicks: sources.world.animationTicks,
      dialogPages: sources.world.dialogPages,
      prepareRoom: sources.world.prepareRoom,
      taskProgress: (flag) => this.announceTask(flag),
      itemName: (itemId, table) =>
        table === 3
          ? (itemId < 12
              ? sources.world.bagItems?.equipment(itemId)
              : sources.world.bagItems?.material(itemId)
            )?.name
          : table === 5
            ? sources.world.bagItems?.specialItem(itemId)?.name
            : sources.worldContract.itemCatalog.find((item) => item.id === itemId)?.name,
    };
    this.runtime = createStorySceneRuntime(
      sources.events,
      sources.routes.require(ROUTE_ID.openingIntro),
      this.services,
      false,
    );
    this.director = sources.storyGraph
      ? new StoryDirector(
          sources.storyGraph,
          new DoorGraph(sources.events).addWharfRoutes(wharfDockRooms(sources.world.npcServices)),
        )
      : null;
    if (sources.areaMaps) this.panel.areaMap = new AreaMapView(sources.areaMaps);
    this.panel.adminSource = {
      enabled: () => this.hooks.admin?.enabled() ?? false,
      open: () => this.hooks.admin?.open(),
    };
    this.panel.systemSource = {
      volumeLevel: () => this.hooks.volume?.level() ?? 0,
      setVolumeLevel: (level) => this.hooks.volume?.setLevel(level),
      speedX2: () => this.hooks.speedX2?.enabled() ?? false,
      toggleSpeedX2: () => this.hooks.speedX2?.toggle(),
      exitToTitle: () => this.hooks.onExit(),
    };
    this.panel.wharfSource = {
      gateOpen: (scene, room, group) =>
        this.world?.eventState.sourceEventStateComplete(scene, room, group) ?? false,
    };
    this.panel.taskSource = {
      rows: (tab) => taskRows(tab, this.taskBoard()),
      mainCursor: () => mainTaskCursor(this.mainTaskIndex()),
      openMap: () => (this.world ? this.showAreaMap(this.world) : false),
    };
    this.panel.petSource = {
      cards: () => {
        const world = this.world,
          services = this.sources.world.battle;
        return world && services
          ? // "Chủng" and "Hóa" come from `services.profile` (baked JavaSE taxonomy and evolutionText).
            world.pets.map((pet, i) => worldPetCard(pet, i, services))
          : [];
      },
      settingRows: (index) => {
        const world = this.world,
          pet = world?.pets[index];
        return petSettingLabels(
          pet ? (this.sources.evolutions?.label(pet.speciesId) ?? null) : null,
          world?.companionSelected(index) ?? false,
        );
      },
      lead: (index) => (this.world ? this.leadPet(this.world, index) : null),
      prepareRelease: (index) => {
        const pet = this.world?.pets[index];
        return pet && this.sources.petSpecies?.divine(pet.speciesId)
          ? "Thần thú không thể phóng sinh"
          : null;
      },
      release: (index) => (this.world ? this.releasePet(this.world, index) : null),
      useItem: (index, item) => (this.world ? this.usePetItem(this.world, index, item) : null),
      itemChoiceRows: () => (this.world ? this.petItemChoiceRows(this.world) : []),
      equipChoiceRows: (index) => (this.world ? this.petEquipmentRows(this.world, index) : []),
      heldEquipment: (index) => this.world?.pets[index]?.heldEquipmentId ?? -1,
      equip: (index, id) => (this.world ? this.selectEquipment(this.world, index, id) : null),
      skillSheet: (index) => (this.world ? this.petSkillSheet(this.world, index) : null),
      canPayBadge: () => (this.world?.currency.badges ?? 0) >= 1,
      learnSkill: (index, skillId, replaceSlot, payBadge) =>
        this.world ? this.learnPetSkill(this.world, index, skillId, replaceSlot, payBadge) : null,
      resolvePendingSkill: (petSlot, skillId) => {
        const world = this.world;
        if (world?.resolvePendingSkill(petSlot, skillId)) this.saves.save(this.snapshot(world));
      },
      evolutionSkills: (index, previousSpecies) => {
        const pet = this.world?.pets[index];
        return pet
          ? (this.sources.petSkillPools?.evolutionCandidates(
              previousSpecies,
              pet.speciesId,
              pet.level,
              pet.skillIds ?? [],
            ) ?? [])
          : [];
      },
      openQuality: (index) => (this.world ? this.openQualityUpgrade(this.world, index) : null),
      openEvolution: (index) => (this.world ? this.openEvolution(this.world, index) : null),
      openEvolutionOfKind: (index, kind) => {
        const world = this.world,
          pet = world?.pets[index],
          rule = pet
            ? this.sources.evolutions?.rules(pet.speciesId).find((row) => row.kind === kind)
            : undefined,
          services = this.sources.world.battle;
        return world && pet && rule && services
          ? new EvolutionSession(index, pet, rule, world.bag.materials, services, (species) =>
              world.collection.markCollected(species),
            )
          : null;
      },
      bankCards: () => {
        const world = this.world,
          services = this.sources.world.battle;
        return world && services
          ? world.campaign.petBank.map((pet, i) => worldPetCard(pet, i, services))
          : [];
      },
      bankDeposit: (index) => {
        const world = this.world;
        if (!world) return "invalid";
        // `equipmentEngine.applySelection`: the deposited pet's equipment goes back to the bag.
        const held = world.pets[index]?.heldEquipmentId ?? -1,
          result = depositPet(world.pets, world.campaign, index, world.petBankCapacity());
        if (result === "deposited" && held >= 0 && !world.bag.equipment.includes(held))
          world.bag.equipment.push(held);
        // Hoàng Kim Chương rank 2 raises a deposited pet to 5★ at once.
        if (result === "deposited") world.synchronizeGoldenBankReward();
        return result;
      },
      bankWithdraw: (index) => {
        const world = this.world;
        if (!world) return "invalid";
        world.synchronizeGoldenBankReward();
        return withdrawPet(world.pets, world.campaign, index);
      },
      bankReleaseProtected: (index) => {
        const pet = this.world?.campaign.petBank[index];
        return !!pet && (this.sources.petSpecies?.divine(pet.speciesId) ?? false);
      },
      bankRelease: (index) =>
        this.world
          ? releaseBankPet(
              this.world.campaign,
              index,
              (pet) => this.sources.petSpecies?.divine(pet.speciesId) ?? false,
            ) === "released"
          : false,
      toggleCompanion: (index) => this.world?.togglePetCompanion(index),
    };
    this.panel.bagSource = {
      rows: (tab) => {
        const world = this.world,
          catalog = this.sources.world.bagItems;
        return world && catalog ? bagRows(tab, this.bagContents(world), catalog) : [];
      },
      use: (tab, row) => (this.world ? this.useBagItem(this.world, tab, row) : null),
      eggActive: () => this.world?.campaign.egg.active ?? false,
      accelerateEgg: (itemId) => (this.world ? this.applyEggAccelerator(this.world, itemId) : null),
      eggPreview: (itemId) => {
        const egg = this.sources.world.campaignSystems?.eggs.find((row) => row.itemId === itemId);
        return egg ? { name: egg.name, entries: egg.species } : null;
      },
    };
    this.panel.portableShopSource = {
      money: () => this.world?.currency.money ?? 0,
      badges: () => this.world?.currency.badges ?? 0,
      description: (row) =>
        portableShopDescription(row, this.world?.campaign.dailyBadgeLastClaimEpochMillis ?? 0),
      claimDailyBadges: () => {
        const world = this.world;
        if (!world) return "Không thể nhận thưởng lúc này.";
        const result = claimDailyBadges(world.campaign, world.currency, Date.now());
        if (result.granted) return "Nhận 20 huy hiệu.";
        if (result.rollback) return "Đồng hồ hệ thống đã lùi; phần thưởng bị khóa 24 giờ.";
        const hours = Math.max(1, Math.ceil(result.remainingMillis / 3_600_000));
        return `Hôm nay đã nhận thưởng. Còn ${hours} giờ.`;
      },
      offers: (material) =>
        this.sources.shopStock ? stockOffers(this.sources.shopStock, material) : [],
      quote: (offer, quantity) =>
        this.world
          ? quotePurchase(offer, this.portableShopInventory(this.world), quantity)
          : { outcome: "full", quantity: 0, maxQuantity: 0, total: 0, currentCount: 0 },
      purchase: (offer, quantity) =>
        this.world
          ? purchaseOffer(offer, this.portableShopInventory(this.world), quantity)
          : "full",
    };
    this.panel.worldShopSource = {
      sellRows: () => {
        const world = this.world,
          catalog = this.sources.world.bagItems;
        return world && catalog
          ? sellRows(catalog, { items: world.inventory, materials: world.bag.materials })
          : [];
      },
      sell: (row, quantity) => {
        const world = this.world;
        return world
          ? sellItem(
              row,
              quantity,
              { items: world.inventory, materials: world.bag.materials },
              world.currency,
            )
          : false;
      },
      recoveryCost: () => {
        const world = this.world,
          battle = this.sources.world.battle;
        return world && battle
          ? recoveryCost(world.pets, (pet) => battle.partyMember(pet).stats.hp)
          : -1;
      },
      recover: () => {
        const world = this.world,
          battle = this.sources.world.battle;
        if (!world || !battle) return "not-needed";
        return recoverWorldParty(
          world.pets,
          world.currency,
          (pet) => battle.partyMember(pet).stats.hp,
          (id) => this.ppMax(id),
        );
      },
      money: () => this.world?.currency.money ?? 0,
      badges: () => this.world?.currency.badges ?? 0,
    };
    this.panel.cauVongShopSource = {
      doc: () => this.sources.world.cauVongShops,
      purse: () => this.world?.cauVongShopPurse(),
      room: () => (this.world?.sceneId === 98 ? this.world.roomIndex : -1),
    };
    this.panel.cauVongIncubatorSource = {
      state: () => this.world?.cauVongIncubation,
      eggs: () => this.world?.cauVongEggRows() ?? [],
      owned: (item) => this.world?.ownedSpecials(item) ?? 0,
      materialCount: (id) => this.world?.cauVongMaterialCount(id) ?? 0,
      admit: (slot, item) => this.world?.admitCauVongEgg(slot, item) ?? "MISSING_EGG",
      hatch: (slot) => this.world?.hatchCauVongEgg(slot) ?? "EMPTY",
      discard: (slot) => this.world?.discardCauVongEgg(slot),
    };
    this.panel.serviceSource = {
      evolutionArmed: () => this.world?.evolutionNoticeArmed ?? false,
      claimReward: () => this.world?.claimConvenienceReward() ?? "",
    };
    this.panel.campaignSource = {
      // `purchasePetBankExpansion`'s three `msgWarm` lines.
      expandBank: () => {
        const world = this.world;
        if (!world) return "Cần 10 Huy hiệu để mở thêm 100 ô kho Pet.";
        // Kim Diễm's reward already opened 1.000 slots: nothing left to buy.
        if (world.kimDiemRewardClaimed())
          return `Kho Pet đã đạt tối đa ${world.petBankCapacity()} ô.`;
        const result = purchasePetBankExpansion(world.campaign, world.currency);
        return result === "success"
          ? `Mở rộng thành công. Kho Pet hiện có ${world.petBankCapacity()} ô.`
          : result === "max"
            ? "Kho Pet đã đạt tối đa 400 ô."
            : "Cần 10 Huy hiệu để mở thêm 100 ô kho Pet.";
      },
    };
    this.panel.charmSource = {
      // The manager reads the list first each frame: a charm gifted since the last look is owned.
      definitions: () => {
        this.world?.syncCharms();
        return this.sources.world.rainbowCharms?.definitions ?? [];
      },
      tier: (id) => this.world?.campaign.charms.tiers[String(id)] ?? 0,
      owns: (id) => this.world?.campaign.charms.tiers[String(id)] !== undefined,
      activeId: (slot) => this.world?.campaign.charms.active[slot] ?? -1,
      money: () => this.world?.currency.money ?? 0,
      achievedBadges: () => this.world?.achievedBadgeCount() ?? 0,
      mainTaskProgress: () => this.world?.flags.mainTaskProgress ?? 0,
      equip: (id) => this.charmAction((world) => world.equipCharm(id), id),
      craft: (id) => this.charmAction((world) => world.craftCharm(id), id),
      upgrade: (id) => this.charmAction((world) => world.upgradeCharm(id), id),
    };
    this.panel.rideSource = {
      active: () => this.world?.activeRideIndex ?? -1,
      unlocked: (ride) => this.world?.rideUnlocked(ride) ?? false,
      usable: (ride) => this.world?.rideUsable(ride) ?? false,
      select: (ride) => this.world?.selectRide(ride) ?? "locked",
    };
    this.panel.wardrobeSource = {
      records: () => this.sources.metaSystems?.fashion.records ?? [],
      catalog: () => this.sources.metaSystems?.fashion.economy,
      selected: () => this.world?.meta.fashion.selected ?? "FASH-BASE-NEIL",
      owned: (key) => this.world?.meta.fashion.owned.includes(key) ?? false,
      money: () => this.world?.currency.money ?? 0,
      bags: () => this.world?.meta.fashion.economy.blindBagCount ?? 0,
      fragments: () => this.world?.meta.fashion.economy.fragmentCount ?? 0,
      buy: (quantity) => {
        const world = this.world,
          catalog = this.sources.metaSystems?.fashion.economy;
        return world && catalog
          ? buyFashionBags(catalog, world.meta.fashion.economy, world.currency, quantity)
          : "full";
      },
      openBag: () => {
        const world = this.world,
          catalog = this.sources.metaSystems?.fashion.economy;
        if (!world || !catalog) return { outcome: "no-bag" };
        const result = openFashionBag(
          catalog,
          world.meta.fashion.economy,
          world.meta.fashion.owned,
        );
        if (result.outcome === "new" || result.outcome === "duplicate")
          return {
            outcome: result.outcome,
            key: result.draw.key,
            tier: result.draw.tier.code,
            fragmentDelta: result.fragmentDelta,
          };
        return { outcome: result.outcome };
      },
      exchange: (key) => {
        const world = this.world,
          catalog = this.sources.metaSystems?.fashion.economy;
        return world && catalog
          ? exchangeFashion(catalog, world.meta.fashion.economy, world.meta.fashion.owned, key)
          : "unknown";
      },
      equip: (key) => {
        const world = this.world;
        if (!world || !world.meta.fashion.owned.includes(key)) return false;
        const record = this.sources.metaSystems?.fashion.records.find((row) => row.key === key);
        if (!record) return false;
        world.meta.fashion.selected = key;
        // Liệt Hỏa fashions reuse the normal world sprite bank. Cầu Vồng sheets are rendered by
        // their own asset adapter once selected; preserving the key keeps save/load canonical.
        if (record.kind !== "cau-vong") world.setFashionSprite(record.resourceId);
        return true;
      },
    };
    this.panel.challengeSource = {
      rematches: () => this.sources.metaSystems?.rematches ?? [],
      initialRegion: () => {
        const world = this.world;
        return world ? resolveRematchRegion(world.sceneId, world.roomIndex, world.flags) : -1;
      },
      cycleRegion: (current, direction) =>
        this.world ? cycleRematchRegion(this.world.flags, current, direction) : -1,
      status: (region) =>
        this.world
          ? rematchStatus(this.world.meta.rematches, region, Date.now())
          : {
              available: false,
              usedCount: 0,
              remainingUses: 0,
              remainingMillis: 0,
              clockRollback: false,
            },
      start: (rematch) => {
        const world = this.world;
        if (!world || !rematchStatus(world.meta.rematches, rematch.region, Date.now()).available)
          return false;
        if (!world.startRegionalRematch(rematch)) return false;
        recordRematchStart(world.meta.rematches, rematch.region, Date.now());
        return true;
      },
    };
    this.panel.towerSource = {
      view: () => {
        const world = this.world,
          content = this.sources.bondingTower;
        if (!world || !content) return undefined;
        const state = world.meta.tower ?? createTowerState(),
          now = Date.now(),
          offer = towerSweepOffer(state, now),
          last = state.last,
          prizes = last?.hearts || last?.fragments;
        return {
          highest: state.highest,
          hearts: state.hearts,
          fragments: state.fragments,
          floors: content.floors.map((floor) => ({
            ...floor,
            team: floor.team.map((id) => ({ id, name: content.pets[id]?.name ?? `Pet ${id}` })),
            status: towerFloorStatus(state, floor.floor, now),
          })),
          pets: world.pets.map((pet, index) => ({
            index,
            name:
              content.pets[pet.speciesId]?.name ??
              this.sources.world.petStats.speciesRow(pet.speciesId)?.name ??
              `Pet ${pet.speciesId}`,
            level: pet.level,
            quality: pet.quality,
            bond: pet.towerBond ?? 0,
            visualId: pet.visualSpriteId,
          })),
          sweep: {
            used: offer.used,
            limit: offer.limit,
            nextCost: offer.cost,
            group: offer.floors.length
              ? { start: offer.end - 4, end: offer.end, count: offer.floors.length }
              : undefined,
            canSweep:
              offer.cost !== null && offer.floors.length > 0 && world.currency.badges >= offer.cost,
            detail:
              offer.cost === null
                ? "Đã hết lượt quét hôm nay."
                : state.highest < 5
                  ? "Vượt 5 tầng để mở quét tầng."
                  : !offer.floors.length
                    ? "Hôm nay đã nhận hết thưởng."
                    : world.currency.badges < offer.cost
                      ? "Không đủ huy hiệu."
                      : offer.cost === 0
                        ? "Lượt này miễn phí."
                        : `Lượt này tốn ${offer.cost} huy hiệu.`,
          },
          last: last
            ? last.sweep
              ? `Quét đến tầng ${last.floor}: +${last.fragments} mảnh, +${last.hearts} tim.`
              : last.won
                ? prizes
                  ? `Thắng tầng ${last.floor}: +${last.fragments} mảnh, +${last.hearts} tim.`
                  : `Đã thắng luyện tập tầng ${last.floor}.`
                : `Chưa vượt tầng ${last.floor}.`
            : undefined,
        };
      },
      challenge: (number) => {
        const world = this.world,
          content = this.sources.bondingTower,
          floor = content?.floors[number - 1];
        if (!world || !content || !floor) return "Không tìm thấy tầng.";
        if (!this.canOpenPanel(world) || this.mapLoadingActive) return "Tháp chưa sẵn sàng.";
        const state = world.meta.tower ?? createTowerState();
        if (!towerCanChallenge(state, number)) return "Tầng chưa mở.";
        if (!world.pets.some((pet) => (pet.currentHp ?? pet.maxHp ?? 1) > 0))
          return "Cần có pet còn sức trong đội.";
        if (floor.double && world.pets.length < 2) return "Tầng đánh đôi cần ít nhất 2 pet.";
        if (
          !world.startBondingTower(floor, content.pets, (won) =>
            finishTowerBattle(state, number, won, Date.now()),
          )
        )
          return "Chưa thể khiêu chiến.";
        world.meta.tower = state;
        return null;
      },
      craft: (count) => this.mutateTower((_, state) => craftTowerHearts(state, count)),
      nurture: (index, count) =>
        this.mutateTower((world, state) => {
          const pet = world.pets[index],
            services = world.battleServices;
          if (!pet || !services) return "Hãy chọn một pet trong đội.";
          const baseHp = services.partyMember({ ...pet, towerBond: 0 }).stats.hp;
          return nurtureTowerPet(state, pet, count, baseHp);
        }),
      sweep: () =>
        this.mutateTower((world, state) => sweepTower(state, world.currency, Date.now())),
    };
    this.panel.giftCodeSource = {
      redeem: (code) => {
        const world = this.world;
        if (this.redeemingOnServer)
          return { outcome: "invalid", code, message: "Đang kiểm tra mã trên máy chủ..." };
        const local: GiftCodeResult =
          world && this.sources.giftCodes
            ? redeemGiftCode(
                this.sources.giftCodes.codes,
                {
                  currency: world.currency,
                  items: world.inventory,
                  materials: world.bag.materials,
                  specials: world.bag.specials,
                  redeemed: world.meta.redeemedGiftCodes,
                  mainTask: world.flags.mainTaskProgress,
                  achievedBadgeCount: world.flags.badges.achievedSnapshot().filter(Boolean).length,
                  eventComplete: ({ scene, room, group }) =>
                    world.eventState.sourceEventStateComplete(scene, room, group),
                  grantBadge: (id) => void world.flags.badges.grant(id),
                },
                code,
                Date.now(),
              )
            : { outcome: "invalid", code, message: "Giftcode chưa sẵn sàng." };
        // A code the packaged catalog does not know may be one an admin made on the server.
        const rewards = this.hooks.rewards;
        if (!world || !rewards || local.outcome !== "invalid" || !this.sources.giftCodes)
          return local;
        if (!/^[A-Z0-9_-]{4,32}$/.test(local.code)) return local;
        this.redeemingOnServer = true;
        rewards
          .redeem(local.code, this.petBankFree)
          .then((gift) => {
            this.ledger.expect(`gift:${local.code}`);
            const lines = this.applyGifts(gift.grants);
            this.panel.giftCodeMessage = lines
              ? `Đã nhận quà: ${gift.body}`
              : "Chỉ nhận được quà khi đang ở bản đồ.";
          })
          .catch((error: unknown) => {
            this.panel.giftCodeMessage =
              error instanceof Error ? error.message : "Không kiểm tra được giftcode.";
          })
          .finally(() => (this.redeemingOnServer = false));
        return {
          outcome: "invalid",
          code: local.code,
          message: "Đang kiểm tra mã trên máy chủ...",
        };
      },
    };
    this.panel.battlePassSource = {
      catalog: () => this.sources.metaSystems?.battlePass,
      state: () => this.world?.meta.battlePass,
      claim: (level, vip) => {
        const world = this.world,
          catalog = this.sources.metaSystems?.battlePass;
        if (!world || !catalog) return "Thẻ Fan Cứng chưa sẵn sàng.";
        const result = claimBattlePassReward(
          catalog,
          world.meta.battlePass,
          {
            currency: world.currency,
            items: world.inventory,
            materials: world.bag.materials,
            specials: world.bag.specials,
          },
          level,
          vip,
          Date.now(),
        );
        if (result.claimed) return "Đã nhận phần thưởng.";
        return {
          season_expired: "Mùa Thẻ Fan Cứng đã kết thúc.",
          level_locked: "Cấp này chưa được mở.",
          vip_locked: "Cần mở khóa VIP trước.",
          already_claimed: "Phần thưởng này đã được nhận.",
          inventory_full: "Hành trang không đủ chỗ nhận quà.",
        }[result.reason];
      },
      purchaseVip: () => {
        const world = this.world,
          catalog = this.sources.metaSystems?.battlePass;
        if (!world || !catalog) return "Thẻ Fan Cứng chưa sẵn sàng.";
        if (world.meta.battlePass.vipUnlocked) return "VIP đã được mở khóa.";
        return purchaseBattlePassVip(catalog, world.meta.battlePass, world.currency)
          ? "Đã mở khóa VIP."
          : `Cần ${catalog.vipPriceBadges} huy hiệu để mở VIP.`;
      },
    };
    this.panel.recordSource = {
      // `recordAccess(specialRewards, 5)`: the Sủng vật sách tranh.
      hasPetmapBook: () => this.world?.bag.specials.includes(PETMAP_BOOK_SPECIAL) ?? false,
      stats: () => {
        const world = this.world;
        return world
          ? recordStats({
              ownedPets: world.pets.length,
              collection: world.collection,
              species: (id) => this.sources.world.petStats.speciesRow(id),
              badges: world.currency.badges,
              playTimeMillis: world.playTimeMillis,
            })
          : { owned: 0, collected: 0, rare: 0, divine: 0, badges: 0, playTimeMillis: 0 };
      },
      petmapRows: (tab, family, variant) =>
        this.world
          ? petmapRows(
              (id) => this.sources.world.petStats.speciesRow(id),
              this.world.collection,
              tab,
              family,
              variant,
            )
          : [],
      badges: () =>
        this.world
          ? badgeEntries(
              this.world.flags.badges,
              this.sources.badgeCatalog,
              this.sources.unifiedBadges ?? [],
            )
          : [],
    };
    if (start.kind === "resume") {
      this.story = new StoryRuntime(this.runtime, sources.events);
      const world = this.story.enterWorld(this.createWorld(start.save));
      const record = start.save.story.quest as Parameters<StoryDirector["restore"]>[0];
      this.director?.restore(record, start.save.progress.activeTask ?? world.flags.activeTask);
      this.recoverBranchTasks(world);
      this.observed = {
        world: true,
        room: `${world.sceneId}:${world.roomIndex}`,
        events: world.eventState.snapshotStates(),
      };
      // The ledger may be ahead of the recorded node; then a save from a broken build may stand
      // somewhere the story cannot continue from.
      this.runActions(
        this.director?.catchUp((s, r, g) => world.eventState.sourceEventStateComplete(s, r, g)) ??
          [],
      );
      this.runActions(this.unstickAction(world));
    } else {
      if (start.kind === "skipIntro") {
        this.prelude = this.scene(ROUTE_ID.scene1Start);
        this.story = new StoryRuntime(this.prelude, sources.events).register(this.runtime);
      } else this.story = new StoryRuntime(this.runtime, sources.events);
      this.director?.begin();
    }
  }

  get world(): WorldRuntime | null {
    return this.story.world;
  }

  /**
   * `Scene.sourceMapLoading.active()`: the room-swap screen owns the frame. Input is not sampled
   * and nothing else simulates while it runs, even when a cutscene holds the world.
   */
  get mapLoadingActive(): boolean {
    return !!this.world?.mapLoading;
  }

  /** The layer that owns the next tick for these commands. */
  layerFor(commands: readonly InputCommand[]): GameplayLayer {
    const world = this.story.worldActive ? this.world : null;
    if (world && (this.panel.visible || (commands.includes("back") && this.canOpenPanel(world))))
      return "panel";
    if (!world) return "cutscene";
    if (world.battleEntryVisible || world.battleVisible) return "battle";
    return "world";
  }

  /** One simulation tick with this tick's commands. Returns the layer that owned it. */
  /** Web only: where each money change and pet came from, carried in the save (`EconomyLedger`). */
  private ledger = new EconomyLedger();
  /** Names the source of the next money or pet change (a letter, a server gift code). */
  expectLedger(source: string): void {
    this.ledger.expect(source);
  }
  private ledgerContext(world: WorldRuntime): string {
    // Safari's catches and fees are its own source, not free walking (`server/ledger.mjs` NOWHERE).
    if (this.safari.run || this.safari.visible) return "safari";
    return this.panel.visible ? `panel:${this.panel.mode}` : world.ledgerContext();
  }
  private observeLedger(world: WorldRuntime, context: string): void {
    this.ledger.observe(world.currency.money, [...world.pets, ...world.campaign.petBank], context);
  }

  step(commands: InputCommand[]): GameplayLayer {
    // A change found after the tick is put down to what the game was in when the tick began (a
    // fight paying out as it closes), or, from free walking, to what the tick opened.
    const world = this.world,
      before = world ? this.ledgerContext(world) : "world",
      layer = this.stepLayers(commands);
    if (world && world === this.world) {
      const after = this.ledgerContext(world);
      this.observeLedger(world, before === "world" ? after : before);
    }
    return layer;
  }

  private stepLayers(commands: InputCommand[]): GameplayLayer {
    // The boat to and from Safari owns the session until it has landed.
    if (this.wharfTravelState?.safari) {
      this.tickWharfTravel();
      return "panel";
    }
    if (this.safari.takeArrival()) {
      this.wharfTravelState = new WharfTravel(this.safariRoute(0), "in");
      return "panel";
    }
    if (this.safari.takeDeparture()) {
      this.wharfTravelState = new WharfTravel(this.safariRoute(2), "out");
      return "panel";
    }
    if (this.safari.run || this.safari.visible) {
      if (this.world?.tickMapLoading()) return "panel";
      this.safari.tick(commands);
      return "panel";
    }
    // `Scene.tick`'s first branch, above every layer: a room swap holds the whole session for its
    // 16 ticks, so a cutscene that started on the same tick waits behind the loading screen too.
    if (this.world?.tickMapLoading()) {
      this.observeStory();
      return "world";
    }
    if (this.storyCutscene) {
      this.tickStoryCutscene(commands);
      return "cutscene";
    }
    // `VqsvWharfTravelRuntime` replaces the session's activity until the hero is ashore.
    if (this.wharfTravelState) {
      this.tickWharfTravel();
      this.observeStory();
      return "world";
    }
    this.openPendingSkillPanel();
    this.presentWorldPanels();
    const layer = this.layerFor(commands);
    switch (layer) {
      case "panel":
        this.tickPanel(commands);
        break;
      case "cutscene":
        this.tickCutscene(commands);
        break;
      case "battle":
      case "world":
        // The world runtime still owns its battle; the layer split is where a standalone battle
        // runtime will take over.
        this.tickWorld(commands);
        break;
    }
    this.openPendingSkillPanel();
    this.observeStory();
    return layer;
  }

  // ------------------------------------------------------------------ the story director

  /**
   * JavaSE opens `sourceSkillLearnQueue` after the level-up card and before the battle continuation.
   * Invalid/already-owned entries can only come from an interrupted or older save, so consume them
   * here instead of trapping the player in a queue that cannot mutate the deck.
   */
  private wharfTravelState: WharfTravel | null = null;
  /** The boat trip under way (`VqsvWharfTravelRuntime`), for the screen to draw; null otherwise. */
  get wharfTravel(): WharfTravel | null {
    return this.wharfTravelState;
  }
  /** The Safari crossing: the ocean scene of a wharf trip; the hero's room does not change. */
  private safariRoute(boatMode: 0 | 2): WharfRoute {
    const world = this.world;
    return {
      gate: { scene: 0, room: 0, group: 0 },
      target: {
        scene: world?.sceneId ?? 0,
        room: world?.roomIndex ?? 0,
        x: world?.player.x ?? 0,
        y: world?.player.y ?? 0,
        direction: 0,
      },
      boatMode,
      label: "Khu Safari",
    };
  }
  private tickWharfTravel(): void {
    const travel = this.wharfTravelState!,
      world = this.world;
    travel.tick();
    // Once the ocean is up the run that just ended is no longer drawn.
    if (travel.safari === "out" && travel.oceanVisible) this.safari.departing = null;
    if (travel.landingDue && (travel.safari || world?.arriveByBoat(travel.route.target)))
      travel.landed();
    if (travel.done) this.wharfTravelState = null;
  }

  /**
   * The panels a world group opens and waits on: op53's award (`badge.ui` on the badge just granted,
   * released by 5 or Back — `openSourceBadgeAward` → `WaitForPanelClosed`) and op49's branch offer
   * (`taskOption.ui`, whose answer the group then reads).
   */
  private presentWorldPanels(): void {
    const world = this.story.worldActive ? this.world : null;
    if (!world) return;
    const award = world.badgeAward;
    if (award) {
      if (!award.shown) {
        if (this.panel.visible || world.mapLoading) return;
        this.panel.openBadgeAward(award.badgeId);
        award.shown = true;
      } else if (!this.panel.badgeAwardOpen) world.badgeAward = null;
    }
    // op49: `openBranchTaskAcceptOption`, then the group reads the answer once the panel closes.
    const option = world.taskOption;
    if (!option || option.answer !== null) return;
    if (!option.shown) {
      if (this.panel.visible || world.mapLoading) return;
      this.panel.openTaskOption(
        this.sources.taskOptions?.view(option.task) ?? {
          taskId: option.task,
          options: option.options,
          rewards: [],
          summary: "",
        },
      );
      option.shown = true;
    } else if (!this.panel.taskOptionOpen) option.answer = this.panel.takeTaskOptionAnswer() ?? 1;
  }

  /** Admin Tool: what its lists show, or null while no world is on screen. */
  adminView(): AdminView | null {
    const world = this.world;
    if (!world) return null;
    const catalog = this.sources.world.bagItems,
      petStats = this.sources.world.petStats;
    return {
      items: catalog
        ? adminItemChoices(catalog, this.sources.world.campaignSystems?.eggs ?? [])
        : [],
      species: adminSpeciesChoices(petStats.allSpecies()),
      pets: world.pets.map((pet, slot) => ({
        slot,
        name: petStats.speciesRow(pet.speciesId)?.name ?? `Pet ${pet.speciesId}`,
        level: pet.level,
      })),
      money: world.currency.money,
      badges: world.currency.badges,
      bank: {
        used: world.campaign.petBank.length,
        capacity: world.petBankCapacity(),
      },
    };
  }

  /**
   * Admin Tool: apply a grant the server approved, save, and say what happened. Only grants from
   * `AdminApi.authorize` reach here; the lists' own caps (99 per bag stack, one copy of a piece of
   * equipment, the bank's capacity) still hold.
   */
  applyAdminGrant(grant: AdminGrant, save = true): string {
    const world = this.world;
    if (!world) return "Chỉ dùng được khi đang ở bản đồ.";
    const petStats = this.sources.world.petStats;
    let message: string;
    switch (grant.action) {
      case "addItem": {
        const added = grantItem(
          {
            items: world.inventory,
            equipment: world.bag.equipment,
            materials: world.bag.materials,
            specials: world.bag.specials,
          },
          grant.kind,
          grant.id,
          grant.quantity,
        );
        const name =
          this.adminView()?.items.find((item) => item.kind === grant.kind && item.id === grant.id)
            ?.name ?? `${ADMIN_KIND_LABELS[grant.kind]} #${grant.id}`;
        if (!added) return `${name}: lưng bao đã đầy hoặc đã có, không thêm được.`;
        message = `Đã thêm ${added} × ${name} vào lưng bao.`;
        break;
      }
      case "setCurrency":
        setCurrency(world.currency, grant.money, grant.badges);
        message = `Tiền: ${world.currency.money}, huy hiệu: ${world.currency.badges}.`;
        break;
      case "addCurrency": {
        const before = { ...world.currency };
        setCurrency(
          world.currency,
          world.currency.money + grant.money,
          world.currency.badges + grant.badges,
        );
        const money = world.currency.money - before.money,
          badges = world.currency.badges - before.badges;
        message =
          [money ? `+${money} tiền` : "", badges ? `+${badges} huy hiệu` : ""]
            .filter(Boolean)
            .join(", ") + ".";
        break;
      }
      case "buffPet": {
        const pet = world.pets[grant.slot];
        if (!pet) return "Không có pet ở ô này.";
        const before = pet.level,
          gained = world.addAdminExperience(grant.slot, experienceForLevels(pet, grant.levels));
        if (gained <= 0) return "Pet đã ở cấp tối đa.";
        message = `${petStats.speciesRow(pet.speciesId)?.name ?? "Pet"}: cấp ${before} → ${pet.level}.`;
        break;
      }
      case "addPet": {
        if (ADMIN_BOSS_SPECIES.has(grant.speciesId)) return "Không được thêm pet boss.";
        const bank = world.campaign.petBank;
        if (bank.length >= world.petBankCapacity()) return "Ngân hàng sủng vật đã đầy.";
        const pet = world.createAdminPet(grant.speciesId, grant.nature, BigInt(grant.talentSeed));
        if (!pet) return "Không tạo được pet này.";
        pet.slot = bank.length;
        bank.push(pet);
        world.synchronizeGoldenBankReward();
        world.collectOwned(pet);
        const services = this.sources.world.battle,
          talent = services
            ? worldPetCard(pet, pet.slot ?? 0, services).pet?.talent?.name
            : undefined;
        message =
          `Đã thêm ${petStats.speciesRow(grant.speciesId)?.name ?? "pet"} vào ngân hàng sủng vật` +
          (grant.shiny ? ` (shiny ${grant.nature})` : "") +
          (talent ? `, thiên phú: ${talent}.` : ".");
        break;
      }
    }
    if (save) this.saves.save(this.snapshot(world));
    return message;
  }

  /** A server gift code is being checked; another confirm waits for it. */
  private redeemingOnServer = false;
  /** Gift notices that arrived while something else was on screen. */
  private readonly giftNotices: { title: string; text: string }[] = [];

  /** Free slots in the pet bank, which a gift's pets go into. */
  get petBankFree(): number {
    const world = this.world;
    return world ? Math.max(0, world.petBankCapacity() - world.campaign.petBank.length) : 0;
  }

  /** The hero stands free on the map with nothing open: a gift notice may open now. */
  get readyForGift(): boolean {
    const world = this.story.worldActive ? this.world : null;
    return !!world && !this.mapLoadingActive && !this.panel.visible && world.restingForSuspendSave;
  }

  /**
   * Gifts from the server (gift codes, the mailbox): every grant applied, then one save. Null
   * while no world is loaded; otherwise one line per grant saying what landed.
   */
  applyGifts(grants: readonly AdminGrant[]): string[] | null {
    const world = this.world;
    if (!world) return null;
    const lines = grants.map((grant) => this.applyAdminGrant(grant, false));
    this.saves.save(this.snapshot(world));
    return lines;
  }

  /** Where the player is and what holds them, for the admin page's online list (`LiveChannel`). */
  livePresence(): Record<string, string | number | boolean> {
    const world = this.world;
    if (!world) return { layer: this.storyCutscene ? "cutscene" : "story" };
    return {
      scene: world.sceneId,
      room: world.roomIndex,
      x: world.player.x,
      y: world.player.y,
      phase: world.phase,
      layer: this.storyCutscene ? "cutscene" : this.panel.visible ? "panel" : "world",
      ...(this.panel.visible ? { panel: String(this.panel.mode) } : {}),
      battle: !!world.battle || !!world.doubleBattle,
      riding: (world.meta.campaign.ride?.activeIndex ?? -1) >= 0,
      resting: this.readyForGift,
      mainTask: world.questState.mainTaskProgress,
      money: world.currency.money,
    };
  }

  /** Saves now when the hero stands free (before an admin's reload); false when it cannot. */
  saveIfResting(): boolean {
    const world = this.world;
    if (!world || !this.readyForGift) return false;
    this.saves.save(this.snapshot(world));
    return true;
  }

  /** A claimed mailbox gift: applied now, its notice shown as soon as the screen is free. */
  deliverGift(gift: ClaimedGift): boolean {
    const lines = this.applyGifts(gift.grants);
    if (!lines) return false;
    this.queueGiftNotice(gift.title, [gift.body, ...lines].filter(Boolean).join(" "));
    return true;
  }

  queueGiftNotice(title: string, text: string): void {
    this.giftNotices.push({ title, text });
    this.showGiftNotice();
  }

  /** Opens the oldest waiting gift notice when nothing else is on screen. */
  showGiftNotice(): void {
    const next = this.readyForGift ? this.giftNotices.shift() : undefined;
    if (next) this.panel.openNotice(next.text, next.title);
  }

  private openPendingSkillPanel(): void {
    const world = this.story.worldActive ? this.world : null;
    if (
      !world ||
      this.panel.visible ||
      this.storyCutscene ||
      world.mapLoading ||
      world.battleEntryVisible ||
      world.battleVisible
    )
      return;
    let repaired = false;
    for (const entry of [...world.pendingSkillLearns]) {
      const pet = world.pets[entry.petSlot],
        duplicate = pet?.skillIds?.some(
          (id) => this.sources.petSkillPools?.sameSkill(id, entry.skillId) ?? id === entry.skillId,
        );
      if (!pet || duplicate)
        repaired = world.resolvePendingSkill(entry.petSlot, entry.skillId) || repaired;
    }
    if (repaired) this.saves.save(this.snapshot(world));
    if (world.pendingSkillLearns.length > 0)
      this.panel.openPendingSkillQueue(world.pendingSkillLearns);
  }

  /**
   * Turn what this tick changed into story signals: the world opening for play, a room change, an
   * event group completed in the ledger, a fight won or lost. Then run what the director asks.
   */
  private observeStory(): void {
    const director = this.director,
      world = this.story.worldActive ? this.world : null;
    if (!director || !world) return;
    const signals: StorySignal[] = [];
    if (!this.observed.world) signals.push({ kind: "worldEnter" });
    const room = `${world.sceneId}:${world.roomIndex}`;
    const roomChanged = this.observed.world && room !== this.observed.room;
    if (roomChanged)
      signals.push({ kind: "roomEnter", scene: world.sceneId, room: world.roomIndex });
    const events = this.ledgerSignals(world, signals);
    const battle =
      world.pendingSkillLearns.length === 0 && !this.panel.postBattleSkillActive
        ? world.takeBattleResult()
        : null;
    if (battle)
      signals.push({
        kind: battle.won ? "battleWon" : "battleLost",
        scene: battle.scene,
        room: battle.room,
        group: battle.group,
      });
    this.observed = { world: true, room, events };
    for (const signal of signals) this.runActions(director.signal(signal));
    if (roomChanged) this.runActions(this.unstickAction(world));
    if (this.pendingWarp && world.warp(this.pendingWarp.to)) this.pendingWarp = null;
  }

  /** Event groups the ledger completed since the director last looked. */
  private ledgerSignals(world: WorldRuntime, signals: StorySignal[]): Record<string, number> {
    const events = world.eventState.snapshotStates();
    for (const [key, state] of Object.entries(events))
      if (state === EVENT_STATE_COMPLETE && this.observed.events[key] !== EVENT_STATE_COMPLETE) {
        const [scene, roomIndex, group] = key.split(":").map(Number);
        signals.push({ kind: "eventComplete", scene, room: roomIndex, group });
      }
    return events;
  }

  private unstickAction(world: WorldRuntime): StoryAction[] {
    if (world.phase !== "freeworld" && world.phase !== "returnWorld") return [];
    const action = this.director?.unstick(world.sceneId, world.roomIndex);
    return action ? [action] : [];
  }

  /** The director's requests. Any route it names is staged here as a cutscene over the world. */
  private runActions(actions: StoryAction[]): void {
    const world = this.world;
    for (const action of actions) {
      if (action.kind === "save" && world) this.saves.save(this.snapshot(world));
      else if (action.kind === "warp") {
        if (!world?.warp(action.to)) this.pendingWarp = action;
      } else if (action.kind === "cutscene") this.playCutscene(action.route);
    }
  }

  /** Routes the host already plays through their own runtimes. */
  private static readonly NATIVE_ROUTES: ReadonlySet<string> = new Set([
    ROUTE_ID.openingIntro,
    ROUTE_ID.preTenYears,
    ROUTE_ID.scene1Start,
  ]);

  /** Stage a story route over the suspended world; the world resumes when it ends. */
  playCutscene(route: string): void {
    if (GameplayHost.NATIVE_ROUTES.has(route) || !this.sources.routes.has(route)) return;
    const world = this.world,
      scene = this.scene(route);
    // A route that opens its own room (Sc8C2's `loadBlankWorldRoom(0, 0, 190, 160)`, hero hidden)
    // places the camera itself; the others start where the hero stands.
    if (world && !this.sources.routes.require(route).initialRoom)
      scene.setPlayer(world.player.x, world.player.y, world.player.direction);
    this.story.register(scene).switchTo(scene.id);
    this.story.suspendWorld();
    this.storyCutscene = scene;
  }

  private tickStoryCutscene(commands: InputCommand[]): void {
    const scene = this.storyCutscene!;
    if (commands.includes("confirm")) this.story.confirm();
    this.story.tick();
    if (!scene.complete) return;
    this.commitRouteGroups(scene);
    this.storyCutscene = null;
    this.story.resumeWorld();
    this.runActions(this.director?.signal({ kind: "cutsceneEnd", route: scene.id }) ?? []);
  }

  /** The save with the story director's node and quest log under `story.quest`. */
  snapshot(world: WorldRuntime) {
    this.observeLedger(world, this.ledgerContext(world));
    const save = world.snapshot();
    // `snapshot` itself may add a pet (the opening's bunny): it is the story's, and its uid is
    // copied onto the save's copies.
    this.observeLedger(world, "story");
    const uids = (pets: readonly SavedPet[] | undefined, live: readonly SavedPet[]) =>
      pets?.forEach((pet, i) => {
        const uid = (live[i] as (SavedPet & { uid?: string }) | undefined)?.uid;
        if (uid && live[i].speciesId === pet.speciesId)
          (pet as SavedPet & { uid?: string }).uid = uid;
      });
    uids(save.pets, world.pets);
    uids(save.meta?.campaign?.petBank, world.campaign.petBank);
    save.ledger = this.ledger.snapshot();
    if (this.director) save.story.quest = { ...this.director.snapshot() };
    return save;
  }

  /**
   * A pointer press inside the current tick, routed by the same layer order. Returns commands to
   * merge into this tick instead of running an extra simulation tick.
   */
  pointer(x: number, y: number): InputCommand[] {
    const world = this.story.worldActive ? this.world : null;
    if (this.mapLoadingActive) return [];
    if (world) {
      // A battle is rendered over the world HUD, so it owns the press first. Hover and wheel already
      // followed this order; leaving click below `world.hud.buttonAt` made the hidden HUD consume
      // the six battle command buttons along the same bottom band.
      const battle = this.activeBattle;
      if (battle) {
        const at = battlePanelPoint(battle, x, y);
        battle.pointer(at.x, at.y, world.inventory);
        return [];
      }
      if (world.battleVisible && world.bondingTowerBattleActive && world.doubleBattle) {
        world.doubleBattle.pointer(x, y);
        return [];
      }
      if (this.panel.visible) {
        // Click and hover must resolve through one table. Previously click knew these aliases while
        // hover looked up the mode name directly, leaving most service/menu screens mouse-inert.
        const layout = this.panelPointerLayout();
        const at = worldPanelPoint(this.panel, x, y);
        if (layout) this.panel.click(layout, at.x, at.y);
        return [];
      }
      // `CauVongSummoningMinigame.pointer`: an open summon-room board owns the whole screen.
      if (world.cauVongMinigameOpen) {
        world.minigamePointer(x, y);
        return [];
      }
      if (world.savePromptVisible) return [x < 120 ? "left" : "right", "confirm"];
      if (world.repelPromptVisible || world.tanNguyetModalVisible) {
        this.story.pointer(x, y);
        return [];
      }
      // `WorldUi.buttonAt` consumes a HUD press before the actor pointer, even when the
      // source's canOpenSourcePanel() gate rejects it.
      const layout = this.sources.layouts.get("world"),
        canvas = fromUi(x, y),
        button = layout ? world.hud.buttonAt(layout, canvas.x, canvas.y, cornerShift) : "none";
      if (button !== "none") {
        this.pressHudButton(world, button);
        return [];
      }
      this.story.pointer(x, y);
      return [];
    }
    if (this.story.complete) {
      this.hooks.onExit();
      return [];
    }
    // The "Bỏ qua" plate rides the dialog box, which landscape lays against the canvas bottom.
    const plate = fromUi(x, y),
      plateY = plate.y - cornerShift("bl").y;
    if (
      this.prelude?.textKind === "dialog" &&
      plate.x >= 86 &&
      plate.x <= 154 &&
      plateY >= 235 &&
      plateY <= 253
    ) {
      this.story.requestDialogueSkip();
      return [];
    }
    this.story.confirm();
    return [];
  }

  /**
   * `pointerPressedGame`'s first step: a press on the open list's scrollbar (the battle's or the
   * panel's) pages it or grabs its thumb, and is not also a click. True when the bar took the press.
   */
  pointerPress(x: number, y: number): boolean {
    this.capture = null;
    if (this.mapLoadingActive) return false;
    const battle = this.activeBattle;
    if (battle) {
      const at = battlePanelPoint(battle, x, y);
      if (!battle.pressScrollbar(at.x, at.y)) return false;
      if (battle.scrollbarDragging) this.capture = "battle";
      return true;
    }
    if (this.panelOpen) {
      const at = worldPanelPoint(this.panel, x, y);
      if (!this.panel.pressScrollbar(at.x, at.y, this.panelPointerLayout())) return false;
      if (this.panel.scrollbarDragging) this.capture = "panel";
      return true;
    }
    return false;
  }

  /** `pointerMovedGame`: a held thumb follows the pointer; otherwise what is under it is hovered. */
  pointerMove(x: number, y: number): void {
    if (this.mapLoadingActive) return;
    if (this.capture === "battle") {
      const battle = this.activeBattle;
      if (battle?.scrollbarDragging) battle.dragScrollbar(battlePanelPoint(battle, x, y).y);
      else this.capture = null;
      return;
    }
    if (this.capture === "panel") {
      if (this.panel.scrollbarDragging)
        this.panel.dragScrollbar(worldPanelPoint(this.panel, x, y).y);
      else this.capture = null;
      return;
    }
    const battle = this.activeBattle;
    if (battle) {
      const at = battlePanelPoint(battle, x, y);
      battle.hover(at.x, at.y);
      return;
    }
    if (this.panelOpen) {
      const layout = this.panelPointerLayout();
      const at = worldPanelPoint(this.panel, x, y);
      if (layout) this.panel.hover(layout, at.x, at.y);
    }
  }

  /** The Java UI resource that owns the currently rendered panel's pointer geometry. */
  private panelPointerLayout() {
    const panel = this.panel,
      name =
        panel.mode === "help"
          ? "help1"
          : panel.mode === "settings"
            ? "help"
            : panel.mode === "optionConfirm"
              ? "option"
              : panel.mode === "worldShop" || panel.mode === "petBank"
                ? "shop"
                : panel.mode === "convenience"
                  ? "wharf2"
                  : panel.mode === "wharf"
                    ? panel.wharfLayoutName
                    : panel.mode === "worldShopRecover"
                      ? "msgRecover"
                      : panel.mode === "worldShopSell" || panel.mode === "worldShopSellConfirm"
                        ? "shopbuy"
                        : panel.mode === "pet"
                          ? panel.petStage === "setting"
                            ? "petsetting"
                            : panel.petStage === "itemChoice" || panel.petStage === "equipChoice"
                              ? "choice"
                              : "petstate"
                          : panel.mode;
    return this.sources.layouts.get(name) ?? this.sources.layouts.get("gamemenu");
  }

  /** `pointerReleasedGame`: whatever thumb was held is let go. */
  pointerRelease(): void {
    // Behind the load screen the grab is only dropped, never handed back to a list.
    if (this.mapLoadingActive) {
      this.capture = null;
      return;
    }
    if (this.capture === "battle") this.activeBattle?.releaseScrollbar();
    if (this.capture === "panel") this.panel.releaseScrollbar();
    this.capture = null;
  }

  /** `mouseWheel`: the battle's open list first, then an open panel. Steps are clamped to ±5. */
  wheel(rotation: number): void {
    if (this.mapLoadingActive) return;
    const steps = Math.max(-5, Math.min(5, rotation));
    if (steps === 0) return;
    const battle = this.activeBattle;
    if (battle) battle.wheel(steps);
    else if (this.panelOpen) this.panel.wheel(steps);
  }

  /**
   * Web only: the page is being hidden (app switched, screen locked), and a phone may kill the tab
   * without warning. Saves like an autosave, but only while the hero stands free with nothing open,
   * so the save resumes exactly where play stopped. True when a save was queued.
   */
  saveBeforeSuspend(): boolean {
    if (this.world?.meta.safari) {
      this.saves.save(this.snapshot(this.world));
      return true;
    }
    const world = this.world;
    if (!world || !this.story.worldActive || this.mapLoadingActive || this.panel.visible)
      return false;
    if (!world.restingForSuspendSave) return false;
    this.saves.save(this.snapshot(world));
    return true;
  }

  /** A list a finger may swipe is on screen: the battle's, or an open panel (web touch only). */
  get swipeScrollable(): boolean {
    return !this.mapLoadingActive && (this.activeBattle !== null || this.panelOpen);
  }

  /** The battle that owns the pointer: the world's, while its screen is up. */
  private get activeBattle() {
    const world = this.story.worldActive ? this.world : null;
    return world?.battleVisible ? world.battle : null;
  }
  private get panelOpen(): boolean {
    return !!this.world && this.story.worldActive && this.panel.visible;
  }

  /**
   * A world.ui button (`clickGame`'s HUD branch): the toggle always works; everything else only
   * while a panel may open (`canOpenSourcePanel`), and is otherwise swallowed.
   */
  pressHudButton(world: WorldRuntime, button: string): void {
    if (button === "toggle") {
      world.hud.toggleShortcuts();
      return;
    }
    if (!this.canOpenPanel(world)) return;
    switch (button) {
      case "system":
        this.panel.openSystem();
        break;
      case "menu":
        this.panel.open();
        break;
      case "speed":
        this.hooks.speedX2?.toggle();
        break;
      case "task":
        this.openTask(world);
        break;
      case "map":
        this.openAreaMap(world);
        break;
      case "ride":
        this.pressRide(world);
        break;
    }
  }

  /** `openTaskFromWorld` (key 1 or the task shortcut): `task.ui` on the main tab, Back to the map. */
  openTask(world: WorldRuntime): void {
    if (!this.canOpenPanel(world) || this.panel.visible) return;
    this.panel.openTasks(true);
  }

  /**
   * `mainTaskCursor`: the story director's task when it runs, else the task index the scripts
   * announced through op45. Once op45 has announced the last task (48), which is also what opens
   * the Cầu Vồng portal (8:1, `ROOM_PORTALS`), the card follows it as JavaSE does
   * (`session.story.mainTaskProgress`): a director left behind cannot hide the Cầu Vồng rows from a
   * hero already walking there.
   */
  private mainTaskIndex(): number {
    const announced = this.world?.questState.mainTaskProgress ?? -1;
    if (!this.director) return announced;
    return announced >= OPENING_QUEST_TASK
      ? Math.max(this.director.mainTask, announced)
      : this.director.mainTask;
  }

  /**
   * Web repair: builds before this one could drop the whole quest log on resume (a saved node the
   * build no longer had), and the next save kept it empty. The event ledger still remembers the
   * groups that hand out (op43 accept) and finish (op44) each branch task, so a task whose
   * completion group is done is complete, and one whose offer group is done is held. It only ever
   * moves a task forward; a task the log already has keeps its status.
   */
  private recoverBranchTasks(world: WorldRuntime): void {
    const log = this.director?.log,
      tasks = this.sources.quests?.branchTasks;
    if (!log || !tasks) return;
    // The offer group ends in op14 (state 3) only on "Tiếp nhận"; a refusal ends it in op42. A
    // completion group may since have been retired (state 4) by op77, which still means done.
    const ledger = world.eventState,
      accepted = (ref: { scene: number; room: number; group: number }) =>
        ledger.sourceEventStateComplete(ref.scene, ref.room, ref.group),
      finished = (ref: { scene: number; room: number; group: number }) =>
        ledger.sourceEventStateInactive(ref.scene, ref.room, ref.group);
    for (const task of tasks) {
      const status = log.branchStatus(task.id);
      if (status === TASK_COMPLETE) continue;
      if (finished(task.completion)) log.setBranch(task.id, TASK_COMPLETE);
      else if (status === TASK_NONE && accepted(task.offer)) log.setBranch(task.id, TASK_ACTIVE);
    }
  }

  /** What `task.ui` lists: `mTask.mid` up to the current task, and the branch tasks held. */
  private taskBoard(): TaskBoardSource {
    return {
      mainTasks: this.sources.mainTasks ?? [],
      branchCatalog: this.sources.quests?.branchTasks ?? [],
      mainCursor: mainTaskCursor(this.mainTaskIndex()),
      branches: this.director?.log.branchTasks() ?? [],
      openingRows: this.openingQuestRows(),
      openingBranchRows: this.openingBranchQuestRows(),
      goldenCollection: this.world
        ? {
            species: this.world.collection.allCollectedSpeciesCount(),
            shiny: this.world.collection.goldenShinyCollectedCount(),
            rank: this.world.flags.badges.goldenTier(),
          }
        : undefined,
    };
  }
  /** `openingQuestRows` tab 1 from task 48 on: the Cầu Vồng branch rows. */
  private openingBranchQuestRows(): Omit<TaskRow, "number">[] {
    const quests = this.sources.world.cauVongOpening?.branchQuests,
      world = this.world;
    if (!quests || !world || this.mainTaskIndex() < OPENING_QUEST_TASK) return [];
    let collected = 0;
    for (let id = 100; id < 202; id++) if (world.collection.collected(id)) collected++;
    return openingBranchRows(
      quests,
      (room, event) => world.eventState.sourceEventStateComplete(98, room, event),
      collected,
    );
  }
  /**
   * `openingQuestRows` tab 0 from task 48 on: each Cầu Vồng row once its `show` flag is done (or
   * while the hero is in one of its rooms), completed by its `done` flag.
   */
  private openingQuestRows(): Omit<TaskRow, "number">[] {
    const quests = this.sources.world.cauVongOpening?.quests,
      world = this.world;
    if (!quests || !world || this.mainTaskIndex() < OPENING_QUEST_TASK) return [];
    const done = ([room, event]: [number, number]) =>
      world.eventState.sourceEventStateComplete(98, room, event);
    return quests
      .filter(
        (quest) =>
          !quest.show ||
          done(quest.show) ||
          (world.sceneId === 98 && quest.rooms.includes(world.roomIndex)),
      )
      .map((quest) => ({
        title: quest.title,
        detail: openingQuestDetail(quest, done),
        completed: done(quest.done),
      }));
  }

  /** The bag's lists as the world holds them; equipment counts as carried while a pet holds it. */
  private bagContents(world: WorldRuntime): BagContents {
    return {
      items: world.inventory,
      equipment: world.bag.equipment,
      materials: world.bag.materials,
      specials: world.bag.specials,
      carried: new Set(world.pets.map((pet) => pet.heldEquipmentId ?? -1).filter((id) => id >= 0)),
      egg: {
        active: world.campaign.egg.active,
        activeEggItemId: world.campaign.egg.activeEggItemId,
        ready: eggReady(world.campaign.egg),
      },
      eggs: new Map(
        (this.sources.world.campaignSystems?.eggs ?? []).map((egg) => [egg.itemId, egg] as const),
      ),
    };
  }

  private portableShopInventory(world: WorldRuntime): PortableShopInventory {
    return {
      items: world.inventory,
      equipment: world.bag.equipment,
      materials: world.bag.materials,
      currency: world.currency,
    };
  }

  /**
   * `af()`'s confirm for the selected row: the message it shows, or null where the source leaves
   * the bag for a screen the web has not ported yet (the pet picker of a healing item, the pet book,
   * the badges, the transmit stone, the attribute stones).
   */
  private useBagItem(world: WorldRuntime, tab: BagTab, row: BagRow): string | null {
    if (tab === 3) {
      // `useSpecialBagRow`: 5 is the pet book (`petmap.ui`), 6 the badge case (`badge.ui`).
      if (row.id === PETMAP_BOOK_SPECIAL) return BAG_OPEN_PETMAP;
      if (row.id === BADGE_CASE_SPECIAL) return BAG_OPEN_BADGE;
      return row.egg ? this.useEggHatchAction(world, row) : null;
    }
    if (tab === 1 && this.sources.world.rainbowCharms?.byRuntimeId(row.id)) {
      // `tickBag` bagTab 1: a team charm opens the manager from main task 5 on.
      return world.flags.mainTaskProgress < 5 ? RAINBOW_CHARM_LOCKED : BAG_OPEN_CHARMS;
    }
    if (tab !== 0) return null;
    if (row.id >= 0 && row.id <= 3) return "Không thể sử dụng";
    if (row.id === HATCH_BOOST_ID) return this.useEggAcceleratorItem(world);
    if (row.id !== REPEL_ID) return BAG_PICK_PET;
    if (row.id === REPEL_ID) {
      const result = world.useRepelItem();
      if (result === "active") return "Đã có được thời gian ngắn tránh quái hiệu quả";
      if (result === "forbidden") return "Nơi này không cách nào sử dụng tránh quái hoàn";
      if (result === "missing") return null;
      return "Thành công sử dụng đạo cụ, cũng có thời gian ngắn tránh quái hiệu quả";
    }
    return null;
  }

  /**
   * `useEggAcceleratorItem`: no owned egg is a warning, several open the picker, one is boosted
   * (the incubated one when it is among them).
   */
  private useEggAcceleratorItem(world: WorldRuntime): string | null {
    // `availableEggRewardIds`: the Cầu Vồng eggs have their own incubator, never item 14.
    const eggs = (this.sources.world.campaignSystems?.eggs ?? []).filter(
        (egg) => egg.hatch !== "cauVong",
      ),
      ids = availableEggIds(
        world.bag.specials,
        eggs.map((egg) => egg.itemId),
      );
    if (!ids.length) return EGG_TEXT.accelWarning;
    if (ids.length > 1) {
      this.panel.eggPicker = {
        ids,
        labels: ids.map((id) => eggs.find((egg) => egg.itemId === id)?.name ?? ""),
        index: 0,
        start: 0,
      };
      return BAG_EGG_PICKER;
    }
    const egg = world.campaign.egg;
    return this.applyEggAccelerator(
      world,
      egg.active && ids.includes(egg.activeEggItemId) ? egg.activeEggItemId : ids[0],
    );
  }
  /** `applyEggAccelerator`: the egg goes into the incubator, then item 14 fills its progress. */
  private applyEggAccelerator(world: WorldRuntime, itemId: number): string | null {
    if (!selectForIncubation(world.campaign.egg, itemId)) return null;
    const result = accelerateEgg(world.campaign.egg, world.inventory);
    return result === "applied"
      ? EGG_TEXT.accelSuccess
      : result === "not-available"
        ? EGG_TEXT.accelWarning
        : null;
  }
  /**
   * `useEggHatchAction`: the row's egg goes into an empty incubator; another tier already in it
   * refuses; then the incubated egg hatches as its catalog row says (`hatchEgg`), and a hatch
   * queues the `openbox.ui` line naming the pet.
   */
  private useEggHatchAction(world: WorldRuntime, row: BagRow): string | null {
    const egg = world.campaign.egg,
      systems = this.sources.world.campaignSystems;
    if (!systems?.eggs.some((entry) => entry.itemId === row.id)) return null;
    // A Cầu Vồng egg opens the five-slot incubator on its first empty slot.
    if (world.isCauVongEgg(row.id)) return BAG_OPEN_INCUBATOR;
    if (!egg.active) selectForIncubation(egg, row.id);
    else if (egg.activeEggItemId !== row.id) return EGG_TEXT.wrongActive;
    const kind = systems.eggs.find((entry) => entry.itemId === egg.activeEggItemId);
    if (!kind) return null;
    const context: HatchContext = {
        egg,
        roster: world.pets,
        bank: world.campaign.petBank,
        bankCapacity: world.petBankCapacity(),
        collected: (id) => world.collection.collected(id),
        // ProMax: an egg hatches shiny 2% of the time (30% with Long Vương Hộ Phù held).
        create: (id) =>
          world.createHatchedPet(id, 5, (lane, bound) => previewDraw(egg, lane, bound)),
        specials: world.bag.specials,
      },
      result = hatchEgg(context, kind, systems.eggTiers ?? { rates: [], species: [] });
    if (result.outcome === "not-ready") return EGG_TEXT.hatchNotReady;
    if (result.outcome !== "hatched") return null;
    world.collection.markCollected(result.speciesId, result.nature, result.shinyColor);
    world.synchronizeGoldenBankReward();
    world.recordBattlePassEvent("EGG_HATCHED");
    const name =
      this.sources.world.petStats.speciesRow(result.speciesId)?.name ?? `Pet ${result.speciesId}`;
    this.panel.bagOpenBox = eggHatchResultText(name, result.storage);
    return EGG_TEXT.hatchSuccess;
  }

  /** `MAX skill PP`: a skill's full PP as the battle core counts it. */
  private ppMax(skill: number): number {
    return this.sources.world.battle?.progression.fullPp([skill])[0] ?? 0;
  }

  /** "Chiến đấu" (`aa()` c = 1, `j.p`): the pet moves to the front, the others shift down. */
  private leadPet(world: WorldRuntime, index: number): string | null {
    const pet = world.pets[index];
    if (!pet || !petAlive(pet)) return "Sủng vật này không thể tham chiến";
    if (index === 0) return "Sủng vật này đã xuất chiến";
    world.pets.splice(index, 1);
    world.pets.unshift(pet);
    world.pets.forEach((p, slot) => (p.slot = slot));
    return null;
  }

  /**
   * "Phóng sinh" confirmed (`aa()` c = 3, `j.i` / `j.n`): another pet able to fight must stay, and
   * the released pet's equipment goes back to the bag.
   */
  private releasePet(world: WorldRuntime, index: number): string | null {
    const others = world.pets.filter((pet, i) => i !== index && petAlive(pet));
    if (others.length === 0) return "Ba lô phải lưu ít nhất 1 sủng vật";
    const [pet] = world.pets.splice(index, 1),
      held = pet.heldEquipmentId ?? -1;
    if (held >= 0 && !world.bag.equipment.includes(held)) world.bag.equipment.push(held);
    world.pets.forEach((p, slot) => (p.slot = slot));
    return null;
  }

  /** `bx()`: a bag item on pet `index`. Every outcome has its line; success uses one up. */
  private usePetItem(world: WorldRuntime, index: number, item: number): string | null {
    const pet = world.pets[index],
      bag = this.sources.world.bagItems;
    if (!pet || !bag) return null;
    const refusal = petItemCheck(pet, item, bag, (id) => this.ppMax(id));
    if (refusal >= 0) return PET_ITEM_REFUSALS[refusal] ?? null;
    const key = String(item);
    if ((world.inventory[key] ?? 0) <= 0) return PET_ITEM_MISSING;
    applyPetItem(pet, item, bag, (id) => this.ppMax(id));
    world.inventory[key] -= 1;
    return PET_ITEM_USED;
  }

  /**
   * `sourceItemChoiceRows`: the bag's consumables in a channel other than 0 (`aq.c[4][id][5]`,
   * which leaves the balls out) with a count above zero, by id.
   */
  private petItemChoiceRows(world: WorldRuntime): ChoiceRow[] {
    const bag = this.sources.world.bagItems;
    if (!bag) return [];
    return Object.entries(world.inventory)
      .map(([key, count]) => ({ id: Number(key), count }))
      .filter(({ id, count }) => count > 0 && !!bag.consumable(id) && !bag.inFirstList(id))
      .sort((a, b) => a.id - b.id)
      .map(({ id, count }) => {
        const row = bag.consumable(id)!;
        return {
          id,
          name: row.name,
          value: String(count),
          description: row.description,
          icon: row.icon,
        };
      });
  }

  /** The equipment the player owns, carried pieces included, in the bag's order. */
  private ownedEquipment(world: WorldRuntime): number[] {
    const owned = [...world.bag.equipment];
    for (const pet of world.pets) {
      const held = pet.heldEquipmentId ?? -1;
      if (held >= 0 && !owned.includes(held)) owned.push(held);
    }
    return owned;
  }

  /** `sourceEquipmentChoiceView`: "Đã mang theo" on this pet, "Bị mang theo" on another. */
  private petEquipmentRows(world: WorldRuntime, index: number): ChoiceRow[] {
    const bag = this.sources.world.bagItems,
      mine = world.pets[index]?.heldEquipmentId ?? -1;
    if (!bag) return [];
    // Bug fix: the team charms (Bùa hộ trận 5037-5057) share the equipment list with the pet pieces,
    // so Java offered them here too, where wearing one did nothing — they work only from the charm
    // panel. They are left out, except one a pet already wears from an old save so it can come off.
    const charms = this.sources.world.rainbowCharms;
    return this.ownedEquipment(world)
      .filter((id) => !charms?.byRuntimeId(id) || id === mine)
      .map((id) => {
        // `sourceEquipmentItem`: the unified record first (Cầu Vồng pieces included).
        const row = bag.equipment(id),
          worn = world.pets.some((pet) => (pet.heldEquipmentId ?? -1) === id);
        return {
          id,
          name: row?.name ?? `Trang sức ${id}`,
          value: mine === id ? "Đã mang theo" : worn ? "Bị mang theo" : "",
          description: row?.description ?? "",
          icon: row?.icon ?? 0,
          ...(row?.iconKey ? { iconKey: row.iconKey } : {}),
        };
      });
  }

  /**
   * `PetManagementService.selectEquipment`: the piece the pet wears comes off; any other piece goes
   * on it, taken from whichever pet wore it.
   */
  private selectEquipment(world: WorldRuntime, index: number, id: number): string | null {
    const pet = world.pets[index];
    if (!pet || id < 0 || !this.ownedEquipment(world).includes(id)) return null;
    if (!world.bag.equipment.includes(id)) world.bag.equipment.push(id);
    if ((pet.heldEquipmentId ?? -1) === id) {
      pet.heldEquipmentId = -1;
      return "Thành công dỡ xuống";
    }
    for (const other of world.pets)
      if ((other.heldEquipmentId ?? -1) === id) other.heldEquipmentId = -1;
    pet.heldEquipmentId = id;
    return "Thành công mang theo";
  }

  /**
   * `skill.ui` for pet `index`: its equipped skills (TRANG BỊ) and its family pool (BỂ CHIÊU),
   * each row with `sourceSkillStateAt`, its status lines, `sourceSkillMetaAt` and description.
   */
  private petSkillSheet(world: WorldRuntime, index: number): PetSkillSheet | null {
    const pet = world.pets[index],
      services = this.sources.world.battle,
      pools = this.sources.petSkillPools;
    if (!pet || !services) return null;
    const setup = services.partyMember(pet),
      skills = setup.skillIds,
      rules = services.rules,
      row = (id: number, state: SkillState, pool: boolean, entry?: PoolEntry): PetSkillRow => {
        const skill = rules.damage.skillRow(id),
          slot = skills.indexOf(id),
          pp = !skill
            ? "PP --"
            : slot >= 0
              ? `PP ${setup.skillPp?.[slot] ?? 0}/${skill.ppMax}`
              : `PP --/${skill.ppMax}`;
        return {
          id,
          name: skill ? skill.name : `Skill ${id}`,
          rowStatus: skillRowStatus(state, pool, entry),
          status: skillStatus(state, pool, entry),
          state,
          meta: skill
            ? `Hệ ${skillElementName(skill.elementFamily)}  |  Lực ${skill.powerPercent > 0 ? skill.powerPercent : "--"}  |  ${pp}`
            : "",
          description:
            rules.damage.lietHoaRecord(id)?.description ?? rules.web?.skillDescription(id) ?? "",
        };
      },
      entries = pools?.entries(pet.speciesId) ?? [];
    return {
      petName: setup.name ?? `Pet ${pet.speciesId}`,
      level: pet.level,
      spriteId: setup.spriteId ?? -1,
      nature: pet.nature,
      shinyColor: pet.shinyColor,
      equipped: skills.filter((id) => id >= 0).map((id) => row(id, 0, false)),
      pool: entries.map((entry) =>
        row(entry[0], pools!.poolState(entry, skills, pet.level), true, entry),
      ),
      poolUnlocked: pools?.unlockedCount(pet.speciesId, skills, pet.level) ?? 0,
    };
  }

  /** JavaSE relearn transaction: pay one Huy hiệu only after the deck mutation succeeds. */
  private learnPetSkill(
    world: WorldRuntime,
    index: number,
    skillId: number,
    replaceSlot?: number,
    payBadge = true,
  ): string | null {
    const pet = world.pets[index],
      services = this.sources.world.battle;
    if (!pet || !services || (payBadge && world.currency.badges < 1) || skillId < 0) return null;
    const ids = [...(pet.skillIds ?? [])],
      duplicate = ids.some(
        (id) => this.sources.petSkillPools?.sameSkill(id, skillId) ?? id === skillId,
      );
    if (duplicate) return null;
    if (replaceSlot === undefined) {
      if (ids.filter((id) => id >= 0).length >= SKILL_SLOTS) return null;
      const empty = ids.findIndex((id) => id < 0);
      if (empty >= 0) ids[empty] = skillId;
      else ids.push(skillId);
    } else {
      if (replaceSlot < 0 || replaceSlot >= ids.length) return null;
      ids[replaceSlot] = skillId;
    }
    pet.skillIds = ids;
    pet.skillPp = services.progression.fullPp(ids);
    if (payBadge) world.currency.badges--;
    return "Học tập kỹ năng thành công";
  }

  private openEvolution(world: WorldRuntime, index: number): EvolutionSession | null {
    const pet = world.pets[index],
      rule = pet ? this.sources.evolutions?.notice(pet.speciesId) : undefined,
      services = this.sources.world.battle;
    return pet && rule && services
      ? new EvolutionSession(index, pet, rule, world.bag.materials, services, (species) =>
          world.collection.markCollected(species),
        )
      : null;
  }

  /** A pet's species name and idle sprite, as the Nâng phẩm cards draw it. */
  petLook(pet: SavedPet): { name: string; spriteId: number } {
    const setup = this.sources.world.battle?.partyMember(pet);
    return { name: setup?.name ?? `Pet ${pet.speciesId}`, spriteId: setup?.spriteId ?? -1 };
  }

  /** `openQualityUpgradeFromPetSetting`: the screen over the party as it stands. */
  private openQualityUpgrade(world: WorldRuntime, index: number): QualityUpgradeSession | null {
    const main = world.pets[index],
      services = this.sources.world.battle,
      pools = this.sources.petSkillPools;
    if (!main || !services) return null;
    return new QualityUpgradeSession(
      {
        roster: world.pets,
        bank: world.campaign.petBank,
        equipment: world.bag.equipment,
        rules: {
          // JavaSE's table first; the evolution rules fill in the special forms it leaves out.
          formDistance: (a, b) => {
            const java = pools?.formDistance(a, b) ?? (a === b ? 0 : -1);
            return java >= 0 ? java : (this.sources.evolutions?.formDistance(a, b) ?? -1);
          },
          protectedPet: (pet) => pools?.releaseProtected(pet.speciesId) ?? false,
          maxHp: (pet) => services.partyMember(pet).stats.hp,
        },
        // Owner (2026-11-17): a fresh draw each attempt. The seeded world stream (seed 0 for every
        // new save, its position kept in the save) handed the same failing roll back after a reload.
        roll: () => freshRoll(ROLL_BOUND),
        // The result is saved at once, so a reload can neither undo a failure nor repeat a roll.
        attempted: () => this.saves.save(this.snapshot(world)),
      },
      main,
    );
  }

  /** `taskProgressText` for the open tab. */
  taskProgress(): string {
    return taskProgressText(this.panel.taskTab, this.taskBoard());
  }

  /**
   * The original's map key (`game.l`, `g(1)` on the free map): state 4 over the frozen world with
   * the current area's rooms, or "Khu này không có bản đồ" where the area has none.
   */
  openAreaMap(world: WorldRuntime): void {
    if (!this.canOpenPanel(world) || this.panel.visible) return;
    this.showAreaMap(world);
  }

  /** State 4 over the frozen world, or the "no map" notice; true when the map opened. */
  private showAreaMap(world: WorldRuntime): boolean {
    const scene = world.sceneId,
      room = world.roomIndex,
      asset = this.sources.world.room(scene, room),
      // `l.o`: the room's kind-1 actors (doors) that were visible when it loaded.
      doors = (asset?.actors ?? [])
        .filter((actor) => actor.sourceKind === 1 && actor.visible)
        .map((actor) => ({ x: actor.x, y: actor.y, direction: actor.state })),
      size = { width: asset?.width ?? 1, height: asset?.height ?? 1 };
    if (this.panel.openAreaMap(scene, room, size, doors)) return true;
    this.panel.openNotice(AREA_MAP_NO_MAP_TEXT);
    return false;
  }

  /** A charm service call on the live world (none: the charm is invalid). */
  private charmAction(act: (world: WorldRuntime) => CharmResult, id: number): CharmResult {
    return this.world
      ? act(this.world)
      : { outcome: "INVALID_CHARM", runtimeId: id, tierBefore: 0, tierAfter: 0 };
  }

  /**
   * `pressRideShortcut` / `dispatchRideShortcut` (key 9 or the ride shortcut): mounted, the hero
   * gets off at once (no landing test, as in JavaSE); on foot it opens `ride.ui` when a panel may.
   */
  pressRide(world: WorldRuntime): void {
    if (world.activeRideIndex >= 0) {
      // Web bug fix: not over the clouds, the water or the thorns of Cầu Vồng (`canLeaveRide`).
      if ((world.phase === "freeworld" || world.phase === "returnWorld") && world.canLeaveRide(-1))
        world.dismountRide();
      return;
    }
    if (!this.canOpenPanel(world) || this.panel.visible) return;
    this.panel.openRide();
  }

  /** The screen and the parity harness build the world from the same source-backed services. */
  createWorld(save?: GameSave): WorldRuntime {
    // The ledger follows the save it loads; a new game keeps counting where this session was.
    this.ledger = new EconomyLedger(
      save?.ledger ?? { seq: this.ledger.snapshot().seq, entries: [] },
    );
    const world = new WorldRuntime(
      this.sources.worldContract,
      {
        ...this.sources.world,
        branchTasks: this.director
          ? {
              status: (taskId) => this.director!.log.branchStatus(taskId),
              set: (taskId, status) => void this.director!.log.setBranch(taskId, status),
              matches: (taskId, kind, ref) => {
                const task = this.sources.quests?.branch(taskId);
                if (!task) return false;
                const expected = kind === "offer" ? task.offer : task.completion;
                return (
                  expected.scene === ref.scene &&
                  expected.room === ref.room &&
                  expected.group === ref.group
                );
              },
            }
          : undefined,
      },
      save,
    );
    world.presentsPanels = true;
    // Pets evolved by an older build kept their first form's sprite: give them their own back.
    const evolutions = this.sources.evolutions,
      services = this.sources.world.battle;
    if (evolutions && services) {
      const spriteOf = (speciesId: number) =>
        services.partyMember({ speciesId, level: 1, quality: 1 }).spriteId;
      for (const pet of [...world.pets, ...world.campaign.petBank])
        repairEvolvedSprite(pet, evolutions, spriteOf);
    }
    const fashion = this.sources.metaSystems?.fashion.records.find(
      (row) => row.key === world.meta.fashion.selected,
    );
    if (fashion && fashion.kind !== "cau-vong") world.setFashionSprite(fashion.resourceId);
    if (this.pendingTaskProgress !== null) {
      world.setMainTaskProgress(this.pendingTaskProgress);
      this.pendingTaskProgress = null;
    }
    for (const group of this.pendingRouteGroups.splice(0))
      world.eventState.op14CompleteEvent(group.sceneId, group.roomIndex, group.groupIndex);
    return world;
  }

  /**
   * A route runs a group's own records, so the op14 at its end belongs to that group: Java's
   * scripted routes write the ledger themselves (`Scene1Room0Group0Script` calls
   * `op14CompleteEvent(1, 0, 0)`). Without this the free world would read a group the opening
   * already played as fresh and dispatch it again - re-granting its items and re-warping the player.
   */
  private commitRouteGroups(scene: StorySceneRuntime): void {
    for (const group of scene.program.groups) {
      const world = this.world;
      if (world)
        world.eventState.op14CompleteEvent(group.sceneId, group.roomIndex, group.groupIndex);
      else this.pendingRouteGroups.push(group);
    }
    // The route's own op23/op77 writes (`Sc8C2Runtime.SophieG2` retires 7:2:g2) land as they did.
    const world = this.world;
    if (world)
      for (const event of scene.completedEvents)
        if (event.type === "markComplete")
          world.eventState.op23MarkEventComplete(event.ref.scene, event.ref.room, event.ref.group);
        else if (event.type === "markRetired")
          world.eventState.op77RetireEvent(event.ref.scene, event.ref.room, event.ref.group);
  }

  createPrelude(): StorySceneRuntime {
    return this.scene(ROUTE_ID.preTenYears);
  }

  /**
   * op45's write. The scalar belongs to the world's flags, so a task announced by the opening or
   * the Scene 1 prelude waits here until the first world is built.
   */
  private announceTask(flag: number): void {
    const world = this.world;
    if (world) world.setMainTaskProgress(flag);
    else this.pendingTaskProgress = flag;
  }

  /** `canOpenSourcePanel()`: only the quiet map phases may take a softkey. */
  private canOpenPanel(world: WorldRuntime): boolean {
    return (
      !world.repelPromptVisible &&
      // Tàn Nguyệt Long Ma's notice or defeat card owns the frame.
      !world.tanNguyetModalVisible &&
      // `NguyenMocC4RaceRuntime.blocksPanel`: no menu once the countdown or the run is on.
      !world.raceBlocksPanel &&
      (world.phase === "freeworld" || world.phase === "returnWorld")
    );
  }

  private mutateTower(
    action: (world: WorldRuntime, state: TowerState) => string | null,
  ): string | null {
    const world = this.world;
    if (!world || !this.sources.bondingTower || !this.canOpenPanel(world) || this.mapLoadingActive)
      return "Tháp chưa sẵn sàng.";
    const state = world.meta.tower ?? createTowerState();
    const error = action(world, state);
    if (error) return error;
    world.meta.tower = state;
    this.saves.save(this.snapshot(world));
    return null;
  }

  /** Java: `if (!panel.visible && keyBack && canOpenSourcePanel()) open; else if (visible) tick`. */
  private tickPanel(commands: InputCommand[]): void {
    if (this.panel.visible) this.panel.tick(commands);
    else this.panel.open();
    const route = this.panel.takeWharfTravel();
    if (route) {
      // The target room's map is fetched while the boat sails.
      this.sources.world.prepareRoom?.(route.target.scene, route.target.room);
      this.wharfTravelState = new WharfTravel(route);
    }
    // `tickSave` phase 1: the menu's "Lưu dữ liệu" writes the canonical save in this tick.
    const world = this.world;
    if (world && this.panel.takeSaveRequest())
      this.saves.save(this.snapshot(world), {
        onSuccess: () => this.panel.saveFinished(true),
        onFailure: () => this.panel.saveFinished(false),
      });
  }

  private tickCutscene(commands: InputCommand[]): void {
    if (commands.includes("back") && this.story.complete) {
      this.hooks.onExit();
      return;
    }
    if (commands.includes("confirm")) this.story.confirm();
    this.story.tick();
    if (!this.prelude) this.hooks.onOpeningTick?.();
    if (this.runtime.complete && !this.prelude) {
      // The opening's closing `groupEnd` is a web marker, not a Java event: in Java the Scene 1
      // room 3 script starts in this very tick, so the prelude takes its first tick now.
      this.commitRouteGroups(this.runtime);
      this.startPrelude();
      this.story.tick();
    }
    if (this.prelude?.complete && !this.world) {
      this.commitRouteGroups(this.prelude);
      this.story.enterWorld(this.createWorld());
    }
  }

  private tickWorld(commands: InputCommand[]): void {
    const world = this.world!;
    this.handle(this.story.tick(commands), world);
    const service = world.takeServiceRequest();
    if (service) this.openNpcService(service);
  }

  /** `VqsvSourceNpcDispatchFlow.tick`'s continuation switch: the panel a service NPC opens. */
  private openNpcService(service: NpcService): void {
    switch (service.continuation) {
      case "WORLD_ITEM_SHOP":
        this.panel.openWorldShop("item");
        break;
      case "WORLD_MATERIAL_SHOP":
        this.panel.openWorldShop("material");
        break;
      case "PET_BANK":
        this.panel.openPetBank();
        break;
      case "CONVENIENCE_SHOP":
        this.panel.openConvenience(service.bankExpansion);
        break;
      case "WHARF": {
        const dock = this.sources.world.npcServices?.wharfs?.find(
          (row) => row.index === service.wharf,
        );
        if (dock) this.panel.openWharf(dock, this.safariEnabled);
        break;
      }
      case "CAU_VONG_SHOP":
        this.panel.openCauVongShop(service.shopCategory ?? 0);
        break;
      case "CONVENIENCE_EVOLVE":
        this.panel.openConvenienceEvolve();
        break;
      case "CAU_VONG_INCUBATOR":
        this.panel.openCauVongIncubator();
        break;
      case "ITEM_SHOP":
      case "MATERIAL_SHOP":
        // `openSourceVillageItemShopFromWorld` / `openSourceMaterialShopFromWorld`: the shopbuy list
        // straight away, Back returns to the map.
        this.panel.openWorldShop(service.continuation === "MATERIAL_SHOP" ? "material" : "item");
        break;
    }
  }

  private handle(action: WorldAction, world: WorldRuntime): void {
    if (action === "save")
      this.saves.save(this.snapshot(world), {
        onSuccess: () => world.saveSucceeded(),
        onFailure: () => world.saveFailed(),
      });
    else if (action === "autosave") this.saves.save(this.snapshot(world));
  }

  private startPrelude(): void {
    if (this.prelude) return;
    this.prelude = this.createPrelude();
    this.story.register(this.prelude).switchTo(this.prelude.id);
  }

  private scene(route: string): StorySceneRuntime {
    return createStorySceneRuntime(
      this.sources.events,
      this.sources.routes.require(route),
      this.services,
    );
  }
}
