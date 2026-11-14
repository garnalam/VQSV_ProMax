import type { NpcServicesDocument } from "../world/NpcServices";
import { WharfTravel } from "../world/WharfTravel";
import { doubleBattleFallTicks } from "../battle/DoubleEventBattle";
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

/** Special items `useSpecialBagRow` opens a Đồ giám page with. */
const PETMAP_BOOK_SPECIAL = 5;
const BADGE_CASE_SPECIAL = 6;
import type { ChoiceRow } from "../../rendering/SourceChoiceRenderer";
import type { PetSkillRow, PetSkillSheet } from "../world/WorldPanel";
import { EvolutionSession } from "../pet/EvolutionSession";
import type { EvolutionCatalog } from "../pet/Evolution";
import { QualityUpgradeSession } from "../pet/QualityUpgradeSession";
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
import { redeemGiftCode, type GiftCodeDocument } from "../meta/GiftCodes";
import {
  cycleRematchRegion,
  recordRematchStart,
  rematchStatus,
  resolveRematchRegion,
} from "../meta/RegionalChallenges";
import { claimBattlePassReward, purchaseBattlePassVip } from "../meta/BattlePass";
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
  giftCodes?: GiftCodeDocument;
};

/** `TextBox.dialog`: pages of four lines, as wide as `dialog.ui` widget 14 (230 px). */
function dialogPagination(boot: BootAssets): (tagged: string) => string[] {
  const width = boot.dialogLayout.w(14, 230);
  return (tagged) => boot.textLayout.paginate(tagged, width, 4);
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
      pointerMask: (actor) => worldPointerMask(actor, assets.frame(actor.sprite, actor.state, actor.animationTick)),
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
          ? new EvolutionSession(index, pet, rule, world.bag.materials, services)
          : null;
      },
      bankCards: () => {
        const world = this.world,
          services = this.sources.world.battle;
        world?.synchronizeGoldenBankReward();
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
        if (result === "deposited") world.synchronizeGoldenBankReward();
        if (result === "deposited" && held >= 0 && !world.bag.equipment.includes(held))
          world.bag.equipment.push(held);
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
      definitions: () => this.sources.world.rainbowCharms?.definitions ?? [],
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
    this.panel.giftCodeSource = {
      redeem: (code) => {
        const world = this.world;
        return world && this.sources.giftCodes
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
  step(commands: InputCommand[]): GameplayLayer {
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
  private tickWharfTravel(): void {
    const travel = this.wharfTravelState!,
      world = this.world;
    travel.tick();
    if (travel.landingDue && world?.arriveByBoat(travel.route.target)) travel.landed();
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
    const save = world.snapshot();
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
        battle.pointer(x, y, world.inventory);
        return [];
      }
      if (this.panel.visible) {
        // Click and hover must resolve through one table. Previously click knew these aliases while
        // hover looked up the mode name directly, leaving most service/menu screens mouse-inert.
        const layout = this.panelPointerLayout();
        if (layout) this.panel.click(layout, x, y);
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
        button = layout ? world.hud.buttonAt(layout, x, y) : "none";
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
    if (this.prelude?.textKind === "dialog" && x >= 86 && x <= 154 && y >= 235 && y <= 253) {
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
      if (!battle.pressScrollbar(x, y)) return false;
      if (battle.scrollbarDragging) this.capture = "battle";
      return true;
    }
    if (this.panelOpen) {
      if (!this.panel.pressScrollbar(x, y, this.panelPointerLayout())) return false;
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
      if (battle?.scrollbarDragging) battle.dragScrollbar(y);
      else this.capture = null;
      return;
    }
    if (this.capture === "panel") {
      if (this.panel.scrollbarDragging) this.panel.dragScrollbar(y);
      else this.capture = null;
      return;
    }
    const battle = this.activeBattle;
    if (battle) {
      battle.hover(x, y);
      return;
    }
    if (this.panelOpen) {
      const layout = this.panelPointerLayout();
      if (layout) this.panel.hover(layout, x, y);
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
   * announced through op45.
   */
  private mainTaskIndex(): number {
    const world = this.world;
    return this.director ? this.director.mainTask : (world?.questState.mainTaskProgress ?? -1);
  }

  /** What `task.ui` lists: `mTask.mid` up to the current task, and the branch tasks held. */
  private taskBoard(): TaskBoardSource {
    const world = this.world;
    return {
      mainTasks: this.sources.mainTasks ?? [],
      branchCatalog: this.sources.quests?.branchTasks ?? [],
      mainCursor: mainTaskCursor(this.mainTaskIndex()),
      branches: this.director?.log.branchTasks() ?? [],
      openingRows: this.openingQuestRows(),
      openingBranchRows: this.openingBranchQuestRows(),
      goldenCollection: world ? {
        species: world.collection.allCollectedSpeciesCount(),
        shiny: world.collection.goldenShinyCollectedCount(),
        rank: world.flags.badges.goldenTier(),
      } : undefined,
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
        create: (id) =>
          world.createHatchedPet(id, 5, (lane, bound) => previewDraw(egg, lane, bound)),
        specials: world.bag.specials,
      },
      result = hatchEgg(context, kind, systems.eggTiers ?? { rates: [], species: [] });
    if (result.outcome === "not-ready") return EGG_TEXT.hatchNotReady;
    if (result.outcome !== "hatched") return null;
    world.collection.markCollected(result.speciesId, result.nature);
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
    return this.ownedEquipment(world).map((id) => {
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
      ? new EvolutionSession(index, pet, rule, world.bag.materials, services)
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
          formDistance: (a, b) => pools?.formDistance(a, b) ?? (a === b ? 0 : -1),
          protectedPet: (pet) => pools?.releaseProtected(pet.speciesId) ?? false,
          maxHp: (pet) => services.partyMember(pet).stats.hp,
        },
        roll: () => world.worldRandomBounded("quality-upgrade", ROLL_BOUND),
        onCommitted: () => this.saves.save(this.snapshot(world)),
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
   * gets off when the current terrain allows it; on foot it opens `ride.ui` when a panel may.
   */
  pressRide(world: WorldRuntime): void {
    if (world.activeRideIndex >= 0) {
      if (world.phase === "freeworld" || world.phase === "returnWorld") world.dismountRide();
      return;
    }
    if (!this.canOpenPanel(world) || this.panel.visible) return;
    this.panel.openRide();
  }

  /** The screen and the parity harness build the world from the same source-backed services. */
  createWorld(save?: GameSave): WorldRuntime {
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
        if (dock) this.panel.openWharf(dock);
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
