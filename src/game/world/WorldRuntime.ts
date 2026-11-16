import type { SourceRoutePatch } from "../story/SourceOpcodeInterpreter";
import { defaultShinyColor, giveShinyColor } from "../../rendering/ShinyDesigns";
import {
  claimCollectionReward,
  synchronizeGoldenBadgeBankReward,
} from "../pet/GoldenBadgeBankReward";
import {
  ENTRY_COMPLETES,
  KEYED_CHESTS,
  ROOM_PORTALS,
  roomOwner,
  WORLD_CHESTS,
} from "./JavaRoomRules";
import {
  PLATFORM_HORIZONTAL,
  PLATFORM_STEP_TICKS,
  PLATFORM_SPEED,
  PLATFORM_VERTICAL,
  downstreamLeafShore,
  isPlatform,
  platformCanAdvance,
  platformAheadPoint,
  platformShore,
  platformSpotOnTrack,
  platformTerrainAhead,
  platformTravelTerrain,
  walkableArea,
  type PlatformRideState,
} from "./PlatformRide";
import {
  npcServiceAt,
  NpcServiceFlow,
  type NpcService,
  type NpcServicesDocument,
} from "./NpcServices";
import type { InputCommand } from "../../core/input/GameCommand";
import {
  CURRENT_SAVE_VERSION,
  SAVE_FORMAT,
  type GameSave,
  type PendingSkillLearn,
  type SavedPet,
} from "../../persistence/save/GameSave";
import { defaultFashionEconomyState } from "../fashion/FashionEconomy";
import { SCENE1_RESUME, SCENE1_STORY } from "../../persistence/save/migrations";
import type { RoomAsset, WorldContract, SourceItemData, SourcePetData } from "../story/GameAssets";
import type { StoryActor } from "../story/StoryActor";
import type { StoryDataRegistry } from "../story/StoryDataRegistry";
import type { HostedBattleResolution, StorySceneRuntime } from "../story/StorySceneRuntime";
import type {
  BattleContext,
  GrantedPet,
  RuntimeStoryEvent,
} from "../story/SourceOpcodeInterpreter";
import {
  createEventBattle,
  createRepeatableBattle,
  createSourceTrainerBattle,
  createWildBattle,
  doubleEventBattleSymbol,
  eventBattleEncounter,
  unsupportedEventBattle,
} from "../battle/EventBattle";
import {
  WorldEncounterEngine,
  type EncounterRequest,
  type WorldEncountersDocument,
} from "./WorldEncounterEngine";
import {
  isWildEncounter,
  npcVictoryMoney,
  wildVictoryBadges,
  wildVictoryMoney,
} from "../economy/BattleRewards";
import type { PackBattleAiEncounterRow } from "../../data/GameData";
import { BATTLE_RESULT_LOST, BattleRuntime } from "../battle/BattleRuntime";
import { createBondingTowerBattle } from "../battle/BondingTowerBattle";
import type { BattleServices } from "../battle/engine/BattleServices";
import { ENCOUNTER_NATURE_FALLBACK } from "../battle/engine/BattleTypes";
import { settleBattle, type BattleSettlementReport } from "../battle/engine/BattleSettlement";
import type { DoubleBattleRuntime } from "../battle/DoubleBattleRuntime";
import {
  createDoubleBattle,
  createTanNguyetBattle,
  settleDoubleBattle,
  tanNguyetChallengeBlock,
} from "../battle/DoubleEventBattle";
import { TAN_NGUYET_BOSS, TAN_NGUYET_LONG_MA } from "../battle/engine/TanNguyetLongMa";
import {
  isTanNguyetBossRoom,
  TAN_NGUYET_ACTOR_ID,
  TAN_NGUYET_DEFEAT_MIN_TICKS,
  TAN_NGUYET_WORLD_TEXT,
  tanNguyetBossActor,
  tanNguyetBossPosition,
  tanNguyetStatueAnchor,
  type TanNguyetModal,
  withinTanNguyetReach,
} from "./TanNguyetBossWorld";
import type { InteractiveBattleStage } from "../battle/BattleRuntime";
import { NO_HELD_ITEM } from "../battle/HeldItems";
import type { BattleRules } from "../battle/BattleRules";
import {
  BattleDefinitionRegistry,
  createCaptureTutorialBattleDefinition,
} from "../battle/BattleDefinition";
import type { PetCoreStats, PetStatCalculator } from "../battle/PetStatCalculator";
import {
  DIRECTION_DOWN,
  DIRECTION_LEFT,
  DIRECTION_RIGHT,
  DIRECTION_UP,
  stepWithTerrain,
  type MoveStep,
  cauVongEdgeClear,
  cauVongMovementTerrain,
  TERRAIN_BADGE_GATED,
  TERRAIN_BLOCKED,
  terrainAtWorld,
  mapBottom,
  mapLeft,
  mapRight,
  mapTop,
  type MapCollision,
} from "./MapCollision";
import { cameraGoal, roomClamp } from "./Camera";
import { EventStateLedger } from "./EventStateLedger";
import { BattleRandom } from "../battle/BattleRandom";
import { MapLoadingRuntime } from "./MapLoadingRuntime";
import { safeRoomArrival, wasBlockedArrival } from "./RoomArrivalSafety";
import { worldPointerNear, worldPointerTarget } from "./WorldPointer";
import { landPoint } from "../../core/LandCenter";
import { viewport } from "../../core/Viewport";
import { WorldEventDispatcher, type WorldView } from "./WorldEventDispatcher";
import {
  settledActorStates,
  committedActorVisibility,
  switchFlag,
  worldGroupBattleActor,
  worldGroupLedgerWrites,
  type GroupRef,
  type WorldEventTrigger,
} from "./WorldEventCatalog";
import { WorldEventRuntime, type WorldEventEffects } from "./WorldEventRuntime";
import {
  roomDoorArrival,
  roomDoorRow,
  sourceDoors,
  sourceRoomDoors,
  sourceRoomPortals,
  transitionArrivalForTarget,
  type RoomDoor,
  type RoomPortal,
  type SourceDoor,
} from "./WorldTransition";
import { BADGE_HOA_PHONG, BADGE_THUY_LAM, WorldFlags } from "./WorldFlags";
import { centeredPoint } from "../../core/LandCenter";
import { choiceRowAt, talkEligible, TALK_PROMPT, WorldHud } from "./WorldHud";
import {
  type CauVongCollisionDocument,
  type CauVongHero,
  type CauVongMechanic,
  cauVongActorSnapshots,
  cauVongCampusNpcPassable,
  cauVongNpcRequested,
  cauVongPropRequested,
  cauVongTalkTarget,
} from "./CauVongWorld";
import {
  CAU_VONG_SQUARE_ROOM,
  type CauVongSquareDocument,
  cauVongSquareExit,
  cauVongSquareScript,
} from "./CauVongSquare";
import {
  BEGIN_HOOK,
  CUE_HOOK,
  type CauVongCuesDocument,
  type CauVongEffect,
  type CauVongPart,
  CauVongPresentation,
  type CauVongStage,
  type CueScratch,
  END_HOOK,
  partScript,
  restoreCue,
  tickCue,
} from "./CauVongCutscene";
import {
  CAU_VONG_HALL_ROOM,
  type CauVongHallDocument,
  type CauVongPartName,
  HALL_EXIT,
  afterPart,
  cauVongHallAction,
  cauVongHallExit,
  hallCast,
} from "./CauVongHall";
import {
  type CauVongLockeDocument,
  LOCKE_CHOICE,
  LOCKE_ROOMS,
  LOCKE_SPEAKER,
  LOCKE_WON,
  type LockePartName,
  afterLockePart,
  cauVongLockeAction,
  firstBattle,
  lockeBattleResult,
  lockeCast,
  lockeChoice,
} from "./CauVongLocke";
import {
  type CauVongFourGatesDocument,
  type FourGatesAction,
  FourGatesOwner,
  fourGatesCast,
  fourGatesWalker,
  isFourGateRoom,
  maskedCast,
} from "./CauVongFourGates";
import {
  type CauVongForestDocument,
  type CauVongRock,
  FOREST_MERCHANT_MENU,
  ForestOwner,
  LABORATORY_ROOM,
  LAB_ROOM,
  ROCK_TILE,
  forestCast,
  isForestRoom,
  laboratoryCast,
  rockCleared,
  rockClosed,
  rockStarted,
  rockTarget,
} from "./CauVongForest";
import {
  LAB_MENU,
  LAB_PREFIX,
  LabOwner,
  labCast,
  type CauVongLabDocument,
  type LabWorld,
} from "./CauVongLab";
import {
  NORTH_SEA_BOAT_SPRITE,
  NORTH_SEA_MENU_BASE,
  NORTH_SEA_PREFIX,
  NorthSeaOwner,
  SKY_CITY_ROOM,
  SKY_HUB_ROOM,
  isNorthSeaRoom,
  isSummonRoom,
  northSeaCast,
  northSeaOwnsRoom,
  northSeaShared,
  type CauVongNorthSeaDocument,
  type NorthSeaWorld,
} from "./CauVongNorthSea";
import {
  CITY_MENU_BASE,
  CityOwner,
  isCitySideRoom,
  type CauVongCityDocument,
  type CityItem,
  type CityWorld,
} from "./CauVongCity";
import {
  AUX_ROOM,
  BRANCH_MENU_BASE,
  BranchesOwner,
  TREASURE_FLOOR,
  type BranchWorld,
  type CauVongBranchesDocument,
} from "./CauVongBranches";
import {
  SUMMON_MENU_BASE,
  SummoningOwner,
  summoningRoom,
  KIM_DIEM_AMULET_ID,
  KIM_DIEM_BANK_CAPACITY,
  KIM_DIEM_BATTLE_KEY,
  KIM_DIEM_REWARD_RECEIPT,
  KIM_DIEM_ROOM,
  SUMMON_PREFIX,
  type CauVongSummoningDocument,
  type SummonWorld,
} from "./CauVongSummoning";
import {
  CauVongMinigame,
  closedMinigame,
  restoreMinigame,
  type CauVongMinigameState,
} from "./CauVongMinigame";
import {
  type CauVongOpeningDocument,
  BOY_ACCEPT_CHOICE,
  BOY_EXTRA_GIFT,
  BOY_PET_CHANGED,
  BOY_PET_REFUSED,
  BOY_TRADED,
  CITY_ROOM,
  FOREST_ROOM,
  INNER_EGG_ACTOR,
  LUCY_CHOICE,
  LUNCH_ACCEPTED,
  LUNCH_DELIVERED,
  MERCHANT_CHOICE,
  OPENING_ROOMS,
  type OpeningMenu,
  RUINS_EGG,
  RUINS_EGG_REWARD,
  RUINS_INNER_ROOM,
  RUINS_ROOM,
  boyEligible,
  boyPetChoice,
  cauVongOpeningAction,
  cauVongOpeningAfter,
  cauVongOpeningCast,
  cauVongOpeningExit,
  cauVongOpeningMechanics,
  openingMenuScript,
  openingRepairs,
} from "./CauVongOpening";
import {
  ACADEMY_FEE,
  ACADEMY_REGISTERED,
  ACADEMY_ROOM,
  type CauVongPrepDocument,
  HOME_GIFT,
  LESSON_DONE,
  PREP_CHOICES,
  PREP_MENU_OWNER,
  PREP_ROOMS,
  type PrepAction,
  type PrepMenu,
  cauVongPrepAction,
  cauVongPrepAfter,
  cauVongPrepAnswer,
  cauVongPrepCast,
  cauVongPrepCity,
  cauVongPrepCityExit,
  cauVongPrepExit,
  cauVongPrepHome,
  cauVongPrepSquare,
  isBranchPart,
} from "./CauVongPrep";
import {
  ACADEMY_ROOMS,
  SHOP_ROOM,
  type AcademyAction,
  type AcademyContext,
  type AcademyFight,
  type AcademyMenu,
  type CauVongAcademyDocument,
  CLASSROOM,
  DORM,
  DORM_SLEPT,
  MIDDLE_ARENA,
  allianceUpgrade,
  academyRosterFight,
  cauVongAcademyAction,
  cauVongAcademyAfter,
  cauVongAcademyAnswer,
  cauVongAcademyCast,
  cauVongAcademyExit,
  cauVongAcademyResult,
  cauVongAcademyYard,
  cauVongAcademyYardGates,
  cauVongAcademyYardSideDoor,
  classroomArrival,
  isAcademyBranchPart,
  medalLine,
} from "./CauVongAcademy";
import type { CauVongShopPurse, CauVongShopsDocument } from "./CauVongShop";
import {
  intersectsActorBox,
  playerInteractsActor,
  playerIntersectsSourceRect,
  playerSourcePointInRect,
} from "./WorldInteractionEngine";
import {
  LASER_BEHAVIOR,
  PUZZLE_FALLBACK_MASK,
  laserBeam,
  laserBeamSegments,
  laserCollisionMask,
  sourceMaskOverlap,
  type LaserBeam,
  beatenTrainer,
  blockedByActor,
  movementBehavior,
  obstacleKey,
  ownedObstacle,
  ROCK_BEHAVIOR,
  type ActorSnapshot,
} from "./ActorCollision";
import type { CollisionMask } from "../story/GameAssets";
import { FIRST_MATERIAL_ID, GOLDEN_KEY_ID, REPEL_ID, type BagCatalog } from "../inventory/Bag";
import { COLLECTION_REWARD_MILESTONES, PetCollection, SPECIES_COUNT } from "../pet/PetCollection";
import { javaQuestMarkers } from "../quest/JavaQuestMarkers";
import {
  COUNTDOWN_START,
  COUNTDOWN_START_TICK,
  COUNTDOWN_STEP_TICKS,
  RACE_ATTEMPT_LIMIT,
  RACE_ENTRY_FEE,
  RACE_FINISH,
  RACE_FIRST_OBSTACLE,
  RACE_JILL,
  RACE_LAST_OBSTACLE,
  RACE_PET,
  RACE_ROOM,
  RACE_SCENE,
  RACE_TEXT,
  RACE_TIME_LIMIT_MILLIS,
  formatRaceTime,
  raceEndScript,
  raceLimitScript,
  raceReward,
  raceRewardTier,
  raceStartScript,
  raceWindow,
  type RaceProgress,
  type RaceWindow,
} from "./LucHanhDieuRace";
import type { RegionalRematch } from "../meta/RegionalChallenges";
import { towerBondStat, type TowerFloor, type TowerPetSpec } from "../meta/BondingTower";
import {
  applyBattlePassEvent,
  type BattlePassCatalog,
  type BattlePassEventType,
} from "../meta/BattlePass";
import {
  defaultCampaignState,
  petBankCapacity,
  type CampaignState,
  type CampaignSystemsDocument,
  type EggCatalogRow,
} from "../campaign/CampaignSystems";
import {
  CAU_VONG_TARGET,
  admitCauVongEgg,
  advanceCauVongIncubation,
  clearCauVongSlot,
  emptyCauVongIncubation,
  hatchCauVongSlot,
  validCauVongIncubation,
  type CauVongIncubation,
  type CauVongIncubationResult,
} from "../campaign/CauVongIncubator";
import { eggTarget, rollHatchNature } from "../campaign/EggService";
import {
  activeCharmValue,
  craftCharm,
  equipCharm,
  restoreCharmState,
  upgradeCharm,
  type CharmMechanic,
  type CharmPurse,
  type CharmResult,
  type RainbowCharmCatalog,
} from "../charm/RainbowCharms";
import {
  charmLoadout,
  npcCharmLoadout,
  RainbowCharmBattleState,
} from "../charm/RainbowCharmBattle";
import type { BattleCharms } from "../battle/engine/BattleTypes";
import { DivinePetSeal } from "../pet/DivinePetSeal";
import {
  applyRideRoomPolicy,
  canDismountRainbow,
  CV_PLANT,
  CV_SKY,
  CV_WATER,
  HAI_AU,
  HAI_AU_AIRBORNE_ANCHOR_Y,
  isRainbowRide,
  migrateLegacyRides,
  rideSelection,
  rideSpeed,
  rideSuppressesEncounters,
  rideUnlocked,
  riderSprite,
  RAINBOW_RIDE_OWNED_EVENT,
  RIDE_IDS_SEPARATED_EVENT,
  roomAllowsRide,
  roomRestrictions,
  type RideRoomsDocument,
  type RideSelection,
  rideTerrainIndex,
} from "../ride/RideSystem";

/** Boards already checked by `restoreMinigame` (a loaded save is checked once). */
const CHECKED_MINIGAMES = new WeakSet<CauVongMinigameState>();

/** `PetCollectionProgression.CONVENIENCE_REWARD_MILESTONES`. */
const CONVENIENCE_REWARD_MILESTONES = COLLECTION_REWARD_MILESTONES;
/** `BadgeProgression.HOANG_KIM`. */

/** `VqsvText.Scene1ThreeMapInteractions.CHEST_EMPTY`. */
/**
 * Web-only cloud-room way back (owner 2026-11-15): each room's entrance door actor, whose arrival
 * the hero returns to — Thiên Giới Đạo Quán from 7:2, Bích Lam Cốc's route from 7:0 and from 7:3.
 */
const CLOUD_ROOM_ENTRANCES: ReadonlyMap<string, number> = new Map([
  ["9:7", 5],
  ["7:1", 4],
  ["7:4", 0],
]);
const CHEST_EMPTY = "Bảo rương này đã trống";
/** `XhtC3Runtime.ICE_TERRAIN`. */
/** `NiemThoC3Runtime`: the upper gym floor's holes and where a fall lands (9:3). */
const GYM_HOLE_ACTORS = [0, 1, 2, 3] as const,
  GYM_HOLE_FALL_TICKS = 16,
  GYM_HOLE_FALL_SPEED = 4,
  GYM_HOLE_PLAYER_OFFSET_Y = 16,
  GYM_FALL_TARGET = { x: 112, y: 256 };
/** Where `leaveClosedLedge` puts a hero stranded on ground the landscape map closed: the west door's arrival. */
const CLOSED_LEDGE_FLOOR: Readonly<Record<string, { x: number; y: number; direction: number }>> = {
  "4:10": { x: 8, y: 320, direction: DIRECTION_RIGHT },
};
/** `NiemThoC3Runtime.POST_GYM_CITY_EXIT_X/Y`: 4:5's gym door spawn after the leader is beaten. */
const POST_GYM_CITY_EXIT = { x: 92, y: 328 };
const ICE_TERRAIN = 3;

export type WorldPhase =
  | "savePrompt"
  | "saving"
  | "freeworld"
  | "event"
  | "battleEntry"
  | "battle"
  | "battleReport"
  | "returnTask"
  | "returnWorld"
  | "complete";
export type WorldBattleStage = InteractiveBattleStage;
export type WorldAction = "save" | "autosave" | null;
export type WorldSources = {
  /** Current displayed sprite ink, including its orientation and render offsets (map taps). */
  pointerMask?: (actor: StoryActor) => CollisionMask | null;
  /** `WorldEncounterEngine`'s pools (petArea.mid, the unified overlay, the Cầu Vồng V4 pets). */
  worldEncounters?: WorldEncountersDocument;
  battlePass?: BattlePassCatalog;
  campaignSystems?: CampaignSystemsDocument;
  /** `ExportWebNpcServices`: the town service NPCs (`VqsvSourceNpcDispatchFlow`). */
  npcServices?: NpcServicesDocument;
  /** `ExportWebRainbowCharms`: the team-charm catalog, recipes and species table. */
  rainbowCharms?: RainbowCharmCatalog;
  /** `ExportWebRideRooms`: each room's ride restrictions (`VqsvRideRuntime.applyRoomPolicy`). */
  rideRooms?: RideRoomsDocument;
  /** `cau-vong-world/collision.json`: the 98:* actors' movement snapshots and talk roles. */
  cauVongCollision?: CauVongCollisionDocument["rooms"];
  /** `cau-vong-world/square.json`: Quảng Trường Cầu Vồng's intro and residents. */
  cauVongSquare?: CauVongSquareDocument;
  /** `cau-vong-world/cues.json`: the opening cutscenes (`CauVongOpeningSourceRuntime`). */
  cauVongCues?: CauVongCuesDocument;
  /** `cau-vong-world/hall.json`: Đại sảnh Cúp Cầu Vồng's spectators and Linh. */
  cauVongHall?: CauVongHallDocument;
  /** `cau-vong-world/locke.json`: Lạc Khắc's chain (`CauVongLockeChainRuntime`). */
  cauVongLocke?: CauVongLockeDocument;
  /** `cau-vong-world/opening.json`: the manor-to-ruins route (CV0 room 54 and CV1). */
  cauVongOpening?: CauVongOpeningDocument;
  /** `cau-vong-world/prep.json`: CV2, the egg lessons and the road to the academy. */
  cauVongPrep?: CauVongPrepDocument;
  /** `cau-vong-world/academy.json`: CV3, the arenas and the academy's first days. */
  cauVongAcademy?: CauVongAcademyDocument;
  /** `cau-vong-world/shops.json`: the Cầu Vồng shops (`CauVongShopCatalog`). */
  cauVongShops?: CauVongShopsDocument;
  /** `cau-vong-world/four-gates.json`: CV4's Bốn Cổng owner (`CauVongFourGateSourceRuntime`). */
  cauVongFourGates?: CauVongFourGatesDocument;
  /** `cau-vong-world/forest.json`: CV4b (Rừng U Ám, 60, the north rescue, the rocks). */
  cauVongForest?: CauVongForestDocument;
  /** `cau-vong-world/lab.json`: CV4c (Hoàng Dực Điểu, the laboratory, the exam, Thiết Giáp Xà). */
  cauVongLab?: CauVongLabDocument;
  /** `cau-vong-world/north-sea.json`: CV5 (Bắc Hải, its boats, doors and branches). */
  cauVongNorthSea?: CauVongNorthSeaDocument;
  /** `cau-vong-world/city.json`: the city's side rooms (45, 46, 56), Lisa and the shop clerks. */
  cauVongCity?: CauVongCityDocument;
  /** `cau-vong-world/branches.json`: the aux room 67, its lifts, 43's quest scroll, the treasures. */
  cauVongBranches?: CauVongBranchesDocument;
  /** `cau-vong-world/summoning.json`: CV0' Thiên Không's summoning rooms and minigames. */
  cauVongSummoning?: CauVongSummoningDocument;
  room: (scene: number, room: number) => RoomAsset | undefined;
  collision: (mapId: number) => MapCollision | undefined;
  registry: StoryDataRegistry;
  /** JavaSE's deviations from a world group's decoded records (`story/routes.json`). */
  routePatches?: (id: string) => SourceRoutePatch[] | undefined;
  animationTicks: (sprite: number, state: number) => number;
  /**
   * `Actor.collisionMask()`: the collision rectangle of a sprite's frame `tick` ticks into `state`
   * (baked by `ExportWebSpriteCollision`). Absent: actors never block (the opening's tutorial).
   */
  collisionMask?: (sprite: number, state: number, tick: number) => CollisionMask | null;
  /** `Actor.hitMask()` of a sprite frame: the laser beam hangs from its height. */
  hitMask?: (sprite: number, state: number, tick: number) => CollisionMask | null;
  /** Dialog pagination for event scenes (see `StorySceneServices.dialogPages`). */
  dialogPages?: (tagged: string) => string[];
  /**
   * Lazy room loading: whether a room's map and actor art are in, and a request to fetch them. A
   * door into a room that is not ready waits on its threshold until it is (absent: always ready).
   */
  roomReady?: (scene: number, room: number) => boolean;
  prepareRoom?: (scene: number, room: number) => void;
  /** Fetch a sprite's frames ahead of drawing it (a rider the hero just mounted). */
  prepareSprite?: (sprite: number) => void;
  /** `actionDeathDuration` of a pet sprite in a 2v2 (`doubleBattleFallTicks`). */
  doubleFallTicks?: (sprite: number) => number;
  /** The original bag's item tables (db.mid groups 3/4/5), for op18/op19 names. */
  bagItems?: BagCatalog;
  /** `VqsvSourceRoomNames.roomName`: the banner text a room load shows (empty: no banner). */
  roomName?: (scene: number, room: number) => string;
  petStats: PetStatCalculator;
  battleRules: BattleRules;
  /**
   * The battle core's services. With them the encounter is a real fight on the core (the bunny hits
   * back, EXP and levels, HP/PP and the caught pet go into the save); without them it is the old
   * player-only tutorial the Java goldens grade.
   */
  battle?: BattleServices;
  /** QuestLog bridge. StoryDirector remains the owner and save source of truth. */
  branchTasks?: {
    status: (taskId: number) => number;
    set: (taskId: number, status: 1 | 3) => void;
    /** True only when this source group is the catalogued offer/completion for the branch. */
    matches: (taskId: number, kind: "offer" | "completion", ref: GroupRef) => boolean;
  };
};

/** Where the player stands when the game was last saved: a lost fight sends them back there. */
type SavePoint = { scene: number; room: number; x: number; y: number; direction: number };
type RepelPrompt =
  { phase: "message"; text: string; opensChoice: boolean } | { phase: "choice"; index: number };

const REPEL_EXPIRED = "Tị Quái Hoàn đã hết tác dụng. Bạn có muốn tiếp tục sử dụng không?";
const REPEL_EXHAUSTED = "Bạn đã hết Tị Quái Hoàn để sử dụng.";
const REPEL_FORBIDDEN = "Nơi này không cách nào sử dụng tránh quái hoàn";

/** `GymVortexTravel.SOURCE_SPIN_TICKS`. */
const VORTEX_SPIN_TICKS = 16;

/** The hooks Lạc Khắc's scripts hand back (`cauVong.` routes them to `cauVongHook`). */
const LOCKE_HOOK = "cauVong.locke.";
const FOUR_GATES_HOOK = "cauVong.fourGates.";
/** `BichThuyHubRuntime.resetGymLotusToCanonical`: the Bích Thủy gym's (9:0) lotus leaves. */
const BICH_THUY_GYM_LEAVES = [15, 16, 17, 18];
/** `trySummonLeaf`: the lotus leaves (245 along, 246 across) and clouds (298, 302) a hero can call. */
const SUMMONABLE_SPRITES = new Set([245, 246, 298, 302]);
/** `LOST_PET_CHAMBER_ROOM_INDEX` (Di tích Kim Loại) and Rừng Gai (`FOREST_ROOM_INDEX`). */
const LOST_PET_ROOM = 10;
const THORN_ROOM = 11;
/** The hooks the opening route's scripts hand back (`CauVongOpening.ts`). */
const OPENING_HOOK = "cauVong.opening.";

export class WorldRuntime {
  private static readonly COMPANION_ACTOR_ID = -2;
  phase: WorldPhase;
  sceneId: number;
  roomIndex: number;
  cameraX = 0;
  cameraY = 0;
  /** A map tap's selected actor for this tick; undefined keeps keyboard activation unchanged. */
  private pointerActor: number | undefined;
  readonly actors = new Map<number, StoryActor>();
  readonly inventory: Record<string, number>;
  /** The bag's other lists (the original's M, N, O): equipment ids, materials, special ids. */
  readonly bag: { equipment: number[]; materials: Record<string, number>; specials: number[] };
  readonly pets: SavedPet[];
  companionPetSlot = -1;
  readonly currency: { money: number; badges: number };
  readonly meta: NonNullable<GameSave["meta"]>;
  /** `progression.collection`: the Đồ giám, seen and collected species. */
  readonly collection: PetCollection;
  /** `PlayTimeProgression`: the saved total plus the wall clock since this session began. */
  private readonly playTimeSaved: number;
  private readonly playTimeStarted = Date.now();
  get playTimeMillis(): number {
    return this.playTimeSaved + Math.max(0, Date.now() - this.playTimeStarted);
  }
  private companionScene = Number.MIN_SAFE_INTEGER;
  private companionRoom = Number.MIN_SAFE_INTEGER;
  private companionBoundSlot = Number.MIN_SAFE_INTEGER;
  private readonly companionTrail: Array<{ x: number; y: number; direction: number }> = [];
  readonly flags = new WorldFlags();
  /** `WorldUi`: the room banner, shortcut strip and talk bubble over the free world. */
  readonly hud: WorldHud;
  readonly eventState = new EventStateLedger();
  /** `avoidMonsterTicks`: the repel (item 13) counting down; -1 once it has run out. */
  repelSteps = 0;
  /** `sourceSkillLearnQueue`: decisions raised by battle progression and not handled yet. */
  readonly pendingSkillLearns: PendingSkillLearn[];
  /** `progression.evolutionNoticeArmed`. */
  evolutionNoticeArmed = false;
  /**
   * `claimSourceConvenienceReward` (ProMax): six milestones pay 1 Huy hiệu each, then Hoàng Kim
   * Chương — rank 1 at all 281 species (reserve pets 30% EXP), rank 2 at every species in all three
   * shiny natures, 843 (every bank pet 5★). Colours do not count: a nature is one form however many
   * colours it comes in. Returns the `msgWarm` line.
   */
  claimConvenienceReward(): string {
    const tier = this.collection.nextConvenienceRewardTier();
    if (tier >= CONVENIENCE_REWARD_MILESTONES.length) return "Tất cả dẫn thưởng đã nhận.";
    const milestone = this.collection.convenienceRewardMilestone(tier),
      collected = this.collection.convenienceRewardCollectedCount(tier);
    if (collected < milestone) {
      if (tier === 6)
        return `Hoàng Kim bậc 1: ${collected}/${milestone} loài. Cần đủ Liệt Hỏa, Cầu Vồng và V4.`;
      if (tier === 7)
        return `Hoàng Kim bậc 2: ${collected}/${milestone} dạng shiny. Cần đủ Shiny 1, 2, 3 của mọi loài.`;
      return `Hiện đã thu thập ${collected} loài sủng vật. Cần ${milestone} loài để nhận dẫn thưởng tiếp theo.`;
    }
    const reward = claimCollectionReward(this.collection, this.flags.badges, tier);
    if (!reward.claimed) return "Tất cả dẫn thưởng đã nhận.";
    this.currency.badges = Math.max(0, this.currency.badges + reward.badgeCurrency);
    this.synchronizeGoldenBankReward();
    if (tier === 7) return "Nhận Hoàng Kim Chương bậc 2. Toàn bộ pet ngân hàng lên 5 sao.";
    if (tier === 6) return "Nhận Hoàng Kim Chương bậc 1. Pet dự bị trong đội nhận 30% EXP.";
    return "Đạt được 1 huy hiệu";
  }
  /** Hoàng Kim Chương rank 2: every bank pet at 5★, those deposited later included. */
  synchronizeGoldenBankReward(): void {
    synchronizeGoldenBadgeBankReward(this.flags.badges, this.meta.campaign.petBank, (pet) =>
      towerBondStat(
        this.sources.petStats.coreStats(pet.speciesId, pet.level, pet.quality, pet.nature ?? 0).hp,
        pet.towerBond,
      ),
    );
  }
  /**
   * An owned pet goes into the Đồ giám: its species, and a shiny its nature (Hoàng Kim's count) and
   * its colour (the colour pages). A shiny draws its colour first if it has none yet.
   */
  collectOwned(pet: SavedPet): void {
    giveShinyColor(pet);
    this.collection.markCollected(pet.speciesId, pet.nature ?? 0, pet.shinyColor);
  }
  /** `encounterStepsRemaining`: -1 until the room's first countdown is drawn. */
  encounterStepsRemaining = -1;
  /** `avoidMonsterElapsed` (`temporaryActorTicks`). */
  private temporaryActorTicks = 0;
  private repelPrompt: RepelPrompt | null = null;
  get repelPromptVisible(): boolean {
    return this.repelPrompt !== null;
  }
  get repelPromptText(): string {
    return this.repelPrompt?.phase === "message" ? this.repelPrompt.text : "";
  }
  get repelPromptChoice(): { options: readonly string[]; index: number } | null {
    return this.repelPrompt?.phase === "choice"
      ? { options: ["Tiếp tục dùng", "Không dùng"], index: this.repelPrompt.index }
      : null;
  }
  /**
   * Tàn Nguyệt Long Ma's notice (`RequirementNotice`, `VictoryRewardNotice`) or its defeat card
   * (`TanNguyetLongMaDefeatCutscene`), which own the frame and the input while up.
   */
  private tanNguyetModal: TanNguyetModal | null = null;
  /** The 2v2 on screen is the Ma Mộc Cộng Sinh boss fight (`"tan-nguyet-long-ma"` reward context). */
  private tanNguyetBattle = false;
  get tanNguyetModalVisible(): boolean {
    return this.tanNguyetModal !== null;
  }
  /** The `msgWarm` line the boss shows, or null. */
  get tanNguyetNotice(): string | null {
    return this.tanNguyetModal?.kind === "notice" ? this.tanNguyetModal.text : null;
  }
  /** `TanNguyetLongMaDefeatCutscene.renderExclusive`: the card replaces the whole frame. */
  get tanNguyetDefeatCardVisible(): boolean {
    return this.tanNguyetModal?.kind === "defeat";
  }
  /** The fight in progress is a free-world random encounter (`FreeWorldEncounterBattle`). */
  private wildBattle = false;
  /** Lạc Khắc's fight in progress (`CauVongLockeChainRuntime.battle`): its room, and a rematch. */
  private lockeBattle: { room: number; rematch: boolean } | null = null;
  /**
   * What the chain does once the script that asked for it has ended: the part's follow-up, the
   * challenge menu's answer, or a fight's result.
   */
  /** What a finished opening-route script left for the next tick (`cauVong.opening.` hooks). */
  private openingPending:
    | { kind: "after"; name: string }
    | { kind: "answer"; menu: OpeningMenu | PrepMenu | AcademyMenu; selected: number }
    | { kind: "roster"; id: number; pose: number }
    | null = null;
  /** CV3's fight in progress and the owner that reads it; its result, once the world is back. */
  private academyFight: AcademyFight | null = null;
  private academyResult: { won: boolean } | null = null;
  /** The part a Cầu Vồng clerk plays once her shop closes. */
  private academyFarewell: string | null = null;
  /** The middle-arena round the teacher's menu is asking about (`choosingRound`). */
  private academyRound = 0;
  /** Opened switch gates held on the last frame of their retracted state. */
  private readonly cauVongHeld = new Map<number, number>();
  private lockePending:
    | { kind: "after"; name: LockePartName }
    | { kind: "answer"; selected: number }
    | { kind: "result"; won: boolean }
    | null = null;
  /** CV4's owner (`CauVongFourGateSourceRuntime`), built on first use. */
  private fourGatesOwner: FourGatesOwner | null = null;
  /** What a finished Bốn Cổng script or fight left for the next tick (`cauVong.fourGates.` hooks). */
  private fourGatesPending:
    | { kind: "after"; name: string }
    | { kind: "notice" }
    | { kind: "answer"; owner: number; selected: number }
    | { kind: "result"; won: boolean; masked: boolean; key: string }
    | null = null;
  /** The Bốn Cổng fight in progress: an owner's request, the ruins' masked pair, a forest fight. */
  private fourGatesFight: { masked: boolean; key: string } | null = null;
  /** CV4b's owners (`CauVongDarkForestSourceRuntime` and the rest), built on first use. */
  private forestOwner: ForestOwner | null = null;
  /** CV4c's owners (`CauVongAcademyExpansionRuntime`, the lab, the exam, Thiết Giáp Xà). */
  private labOwner: LabOwner | null = null;
  /** CV5's owners (`CauVongNorthSeaSourceRuntime`, the continuation, the boats, the doors). */
  private northSeaOwner: NorthSeaOwner | null = null;
  private cityOwner: CityOwner | null = null;
  private branchesOwner: BranchesOwner | null = null;
  private summoningOwner: SummoningOwner | null = null;
  private minigameRulesOwner: CauVongMinigame | null = null;
  /** A press on the open minigame board, read by its next tick (`CauVongSummoningMinigame.pointer`). */
  private minigameTap: { x: number; y: number } | null = null;
  /** A rock breaking (`CauVongRockObstacles`): the hero waits for its animation. */
  private rockBreak: { rock: CauVongRock; tick: number } | null = null;
  private repeatableBattle = false;
  private repeatableRewardMoney: number | null = null;
  private encounterEngine: WorldEncounterEngine | null = null;
  saveSelected = 0;
  saveStatus = "";
  battle: BattleRuntime | null = null;
  tickCount = 0;
  /**
   * `Scene.sourceMapLoading`: the source room-swap screen, non-null while it owns the frame. The
   * world neither simulates nor draws underneath it.
   */
  mapLoading: MapLoadingRuntime | null = null;
  /** `session.world.useMap`: false until a room has actually been loaded, so the first one is a change. */
  private mapLoaded = false;
  /** How the room just loaded should be checked for a wall trap (`RoomArrivalSafety`). */
  private arrivalSafety: "entry" | "resume" | null = null;
  /** Thiên Giới Đạo Quán entered off its entrance island: bring its clouds over once the map is in. */
  private gymCloudsToHero = false;
  /** A resumed save's spot, checked on the first step so room events see it first. */
  private resumedPosition: { x: number; y: number } | null = null;
  /**
   * JavaSE's one lazily-seeded source stream (`VqsvSourceRandom.lazySourceSeeded`). The port runs it
   * from the fixed battle seed, one stream per world, so the same room sequence always draws the
   * same tips instead of following a clock it cannot replay.
   */
  private readonly sourceRandom: BattleRandom;
  presentationTick = 0;
  objectiveComplete = false;
  /** The chapter-one bunny was just won (or a scene-1 web save left it out): it joins at the next save. */
  private bunnyJoinPending = false;
  private readonly dispatcher: WorldEventDispatcher;
  private event: WorldEventRuntime | null = null;
  private eventReturnPhase: WorldPhase = "freeworld";
  private activeBattleGroup: GroupRef | null = null;
  private saveRequested = false;
  private savePoint: SavePoint;
  /** The last fight's group and result, until the host has read it (`takeBattleResult`). */
  private lastBattle: (GroupRef & { won: boolean }) | null = null;
  takeBattleResult(): (GroupRef & { won: boolean }) | null {
    const result = this.lastBattle;
    this.lastBattle = null;
    return result;
  }
  /** Complete one queued learn/replace/skip decision. Duplicate entries are intentionally distinct. */
  resolvePendingSkill(petSlot: number, skillId: number): boolean {
    const index = this.pendingSkillLearns.findIndex(
      (entry) => entry.petSlot === petSlot && entry.skillId === skillId,
    );
    if (index < 0) return false;
    this.pendingSkillLearns.splice(index, 1);
    return true;
  }
  /**
   * Put the hero somewhere else (a story warp or the anti-stuck guard). Returns false while the
   * target room is still loading; the caller retries on a later tick.
   */
  warp(to: { scene: number; room: number; x: number; y: number; direction: number }): boolean {
    if (!this.sources.room(to.scene, to.room)) return false;
    if (this.sources.roomReady && !this.sources.roomReady(to.scene, to.room)) {
      this.sources.prepareRoom?.(to.scene, to.room);
      return false;
    }
    this.loadRoom(to.scene, to.room, to.x, to.y, to.direction);
    return true;
  }
  /**
   * `VqsvWharfTravelRuntime.land`: the boat puts the hero ashore in the target room with no
   * map-loading screen (`loadWorldRoomWithoutMapLoading`). False while that room is still loading.
   */
  arriveByBoat(to: {
    scene: number;
    room: number;
    x: number;
    y: number;
    direction: number;
  }): boolean {
    if (!this.warp(to)) return false;
    this.mapLoading = null;
    return true;
  }
  /** The battle services this world builds its fights from, when the session loaded them. */
  get battleServices(): BattleServices | undefined {
    return this.sources.battle;
  }
  /** What the last fight on the core wrote into the save, for the report screen. */
  lastSettlement: BattleSettlementReport | null = null;

  constructor(
    readonly data: WorldContract,
    private readonly sources: WorldSources,
    save?: GameSave,
  ) {
    this.hud = new WorldHud(sources.animationTicks);
    this.sceneId = save?.location.sceneId ?? data.save.scene;
    this.roomIndex = save?.location.roomIndex ?? data.save.room;
    const chapter = save?.story[SCENE1_STORY];
    const initial = data.initial ?? {
      items: { "0": 1, "1": 2, "4": 5 },
      activeTask: "BUNNY_CAPTURE",
      mainTaskProgress: 1,
    };
    this.eventState.restoreStates(save?.eventStates);
    // `VqsvSaveRuntime.reconcileFoundationalSourceEventsAfterRestore`: every playable world is
    // downstream of the opening's 0:0:0, whose completion the temple wharf's Q4 routes read.
    if (!this.eventState.sourceEventStateComplete(0, 0, 0))
      this.eventState.op14CompleteEvent(0, 0, 0);
    this.objectiveComplete = chapter?.bunnyCaught === true;
    // Saves from the first web slice (scene 1 only) recorded the catch without the bunny in the
    // party; the next save puts it there. Later saves, Java ones included, keep their own party.
    this.bunnyJoinPending = this.objectiveComplete && save?.location.sceneId === 1;
    this.inventory = { ...(save?.inventory.items ?? initial.items) };
    this.bag = {
      equipment: [...(save?.inventory.equipment ?? [])],
      materials: { ...(save?.inventory.materials ?? {}) },
      specials: [...(save?.inventory.specials ?? [])],
    };
    this.pets = (save?.pets?.length ? save.pets : [this.petFromSource(data.player, 0)]).map(
      (pet, index) => this.normalizePet(pet, index),
    );
    this.companionPetSlot = save?.companionPetSlot ?? -1;
    this.currency = { money: save?.currency?.money ?? 0, badges: save?.currency?.badges ?? 0 };
    this.repelSteps = Math.max(-1, Math.trunc(save?.repelSteps ?? 0));
    this.pendingSkillLearns = (save?.pendingSkillLearns ?? []).filter(
      (entry) => entry.petSlot < this.pets.length,
    );
    this.evolutionNoticeArmed = save?.evolutionNoticeArmed === true;
    this.meta = structuredClone(
      save?.meta ?? {
        fashion: {
          selected: "FASH-BASE-NEIL",
          owned: ["FASH-BASE-NEIL"],
          economy: defaultFashionEconomyState(),
        },
        redeemedGiftCodes: [],
        rematches: {},
        battlePass: {
          seasonKey: "vqsv-fan-card-s1",
          seasonStartEpochMillis: Date.now(),
          xp: 0,
          vipUnlocked: false,
          claimedFree: [],
          claimedVip: [],
          missions: [0, 0, 0, 0, 0, 0],
          appliedEvents: [],
        },
        campaign: defaultCampaignState(0),
      },
    );
    // Every fight throws the pack's capture ball, and a seventh catch goes to this save's bank.
    const battleServices = sources.battle;
    if (battleServices) {
      if (data.capture) battleServices.captureAnimation = data.capture;
      battleServices.petBank = () => ({
        pets: this.meta.campaign.petBank,
        capacity: this.petBankCapacity(),
      });
    }
    this.sourceRandom = new BattleRandom(this.meta.campaign.worldRandom.seed);
    for (let draw = 0; draw < this.meta.campaign.worldRandom.draws; draw++)
      this.sourceRandom.nextBounded("world.restore", 1);
    // `RainbowCharmState.restore`: unknown charms, bad tiers and stray slots are dropped.
    if (sources.rainbowCharms)
      this.meta.campaign.charms = restoreCharmState(
        sources.rainbowCharms,
        this.meta.campaign.charms,
      );
    this.meta.campaign.petBank = this.meta.campaign.petBank.map((pet, index) =>
      this.normalizePet(pet, index),
    );
    this.restoreCauVongIncubation();
    // `SaveSessionSnapshotMapper`: every pet the session owns is collected, whatever the save says.
    this.collection = new PetCollection(save?.collection);
    this.collection.restoreConvenienceRewards(save?.convenienceRewardsClaimed);
    this.playTimeSaved = Math.max(0, save?.playTimeMillis ?? 0);
    // Web shiny redesign: a pet that has become shiny (nature 7..9) by any road (a catch, a gift,
    // a hatch, an old save) draws its colour once, before anything draws it; then every pet the
    // session owns, the bank's too (ProMax), counts in the Đồ giám with its nature and colour.
    for (const pet of [...this.pets, ...this.meta.campaign.petBank]) this.collectOwned(pet);
    this.flags.restore(save?.world);
    this.synchronizeGoldenBankReward();
    // ProMax: an old save's Cầu Vồng ride moves to its separated id, and a beast ride it owned stays owned.
    migrateLegacyRides(
      this.meta.campaign.ride,
      this.sceneId,
      {
        specials: this.bag.specials,
        rainbowEventDone: (room, event) =>
          this.eventState.sourceEventStateComplete(98, room, event),
        collected: (species) => this.collection.collected(species),
      },
      (event) => this.eventState.op14CompleteEvent(98, 0, event),
    );
    this.flags.activeTask = save?.progress.activeTask ?? initial.activeTask;
    this.flags.setMainTaskProgress(save?.progress.mainTaskProgress ?? initial.mainTaskProgress);
    // `session.progression.badges`, read by every fight's `toBattleUnit(pet, 0, badges)`.
    if (sources.battle)
      sources.battle.badges = {
        achieved: (badgeId) => this.flags.badges.achieved(badgeId),
        enhanced: (badgeId) => this.flags.badges.enhanced(badgeId),
      };
    // `DivinePetSeal`: every owned Divine pet's stats follow the North Sea title, in any campaign.
    if (sources.cauVongNorthSea) {
      this.divineSeal = new DivinePetSeal(sources.cauVongNorthSea.divine);
      if (sources.battle)
        sources.battle.divinePercent = (speciesId) => this.divinePercent(speciesId);
      this.synchronizeDivineSeal();
    }
    this.dispatcher = new WorldEventDispatcher(
      sources.registry,
      this.eventState,
      (taskId) => this.sources.branchTasks?.status(taskId) ?? -1,
      (taskId, args) => this.branchCompletionReady(taskId, args),
      () => this.flags.mainTaskProgress,
      (_taskId, args) => this.sourceObjectiveReady(args),
      (badgeId) => this.flags.badges.achieved(badgeId),
    );
    this.phase = save
      ? chapter?.elderComplete === true
        ? "freeworld"
        : this.objectiveComplete
          ? "returnWorld"
          : "freeworld"
      : "savePrompt";
    this.savePoint = {
      scene: this.sceneId,
      room: this.roomIndex,
      x: save?.location.x ?? data.save.x,
      y: save?.location.y ?? data.save.y,
      direction: save?.location.direction ?? 2,
    };
    this.restoringSave = save !== undefined;
    this.loadRoom(
      this.savePoint.scene,
      this.savePoint.room,
      this.savePoint.x,
      this.savePoint.y,
      this.savePoint.direction,
      save ? "resume" : null,
    );
    if (save) {
      this.repairStrandedSave();
      this.reconcilePlatformsForSide(true);
    }
    this.restoringSave = false;
  }
  /** `VqsvRideRuntime.restoreAfterLoad`: the first room of a resumed save re-checks ride ownership. */
  private restoringSave = false;
  /** The last fight was lost: the report says so and the player goes back to the save point. */
  get battleLost(): boolean {
    return this.lastSettlement?.restoredAfterLoss === true;
  }
  get player(): StoryActor {
    return this.actors.get(-1)!;
  }
  /**
   * `WorldTalkPromptEngine.evaluate`: the first talkable NPC the player faces, with the bubble's
   * world position — only on the free map (an event, battle, report or prompt hides it).
   */
  get talkPrompt(): { actorId: number; x: number; y: number } | null {
    const activationIds = this.phase === "event" ? (this.event?.activationIds ?? []) : null;
    if (
      this.phase !== "freeworld" &&
      this.phase !== "returnWorld" &&
      !(activationIds && activationIds.length > 0)
    )
      return null;
    // Scene 98's candidates are its standing NPCs at their displayed feet (`CauVongNpcGeometry`).
    const cauVong = !activationIds ? this.cauVongMechanics() : undefined;
    if (cauVong) {
      const target = cauVongTalkTarget(this.cauVongHero(), this.actors.values(), cauVong);
      return target ? { actorId: target.id, x: target.x, y: target.y - TALK_PROMPT.yOffset } : null;
    }
    for (const actor of [...this.actors.values()].sort((a, b) => a.id - b.id)) {
      if (actor.id < 0) continue;
      // op38 explicitly owns its actor list while the event frame keeps the free world moving.
      // Those actors may be Pet sprites rather than ordinary talk NPCs, so the source command —
      // not WorldTalkPromptEngine's NPC sprite filter — is their interaction eligibility.
      if (activationIds) {
        if (!activationIds.includes(actor.id) || !actor.visible) continue;
      } else if (!talkEligible(actor)) continue;
      if (this.playerFaces(actor))
        return { actorId: actor.id, x: actor.x, y: actor.y - TALK_PROMPT.yOffset };
    }
    return null;
  }
  /**
   * `game.l.E` for an op38 wait: the first actor of the record's own list the hero is facing.
   */
  private facedActor(ids: readonly number[]): number {
    for (const id of ids) {
      const actor = this.actors.get(id);
      if (actor?.visible && this.actorInteractionRequested(actor)) return id;
    }
    return -1;
  }
  /**
   * ProMax: with a map tap, the tapped actor (by its drawn ink) within 48 px of the hero is the one
   * spoken to; without one, the faced actor as before.
   */
  private actorInteractionRequested(actor: StoryActor): boolean {
    if (this.pointerActor === undefined) return this.playerFaces(actor);
    return (
      actor.visible &&
      this.pointerActor === actor.id &&
      worldPointerNear(this.player.x, this.player.y, [
        actor.x + actor.renderOffsetX,
        actor.y + actor.renderOffsetY,
        0,
        0,
      ])
    );
  }
  get questState(): { activeTask: string; mainTaskProgress: number } {
    return { activeTask: this.flags.activeTask, mainTaskProgress: this.flags.mainTaskProgress };
  }
  /** Source op44: prerequisite event plus its Pet, bag-item or invisible quest-item objective. */
  private branchCompletionReady(taskId: number, args: number[]): boolean {
    if ((this.sources.branchTasks?.status(taskId) ?? -1) !== 1) return false;
    return this.sourceObjectiveReady(args);
  }
  /** Shared op44 objective test; main-task Jones and branch quests use the same source row. */
  private sourceObjectiveReady(args: number[]): boolean {
    const prerequisite = { scene: args[5], room: args[6], group: args[7] };
    if (
      prerequisite.scene >= 0 &&
      prerequisite.room >= 0 &&
      prerequisite.group >= 0 &&
      !this.eventState.sourceEventStateComplete(
        prerequisite.scene,
        prerequisite.room,
        prerequisite.group,
      )
    )
      return false;
    // No physical objective: the prerequisite event alone proves readiness. Kind 2 is 8:0:g1's
    // alone (`Sc8C1Runtime.Task28Completion`: task 28 held and 8:4:g0 won is the whole test).
    if (args[8] === 4 || args[8] === 2) return true;
    // Intermediate op43 rows use -1: reaching their prerequisite is the whole condition.
    if (args[8] === -1) return true;
    // An invisible quest item granted by op20.
    if (args[8] === 1) return this.flags.hasSourceWorldFlag(args[9] ?? -1);
    // `[... objectiveKind=3, itemId, quantity]`: hand over ordinary bag items.
    if (args[8] === 3) return (this.inventory[String(args[9] ?? -1)] ?? 0) >= (args[10] ?? 0);
    // `BlcC1Runtime.task22ObjectiveReady`: the roster covers each of the first arg9 elements.
    if (args[8] === 6) {
      const elements = new Set(
        this.pets.map((pet) => this.sources.petStats.speciesRow(pet.speciesId)?.element ?? -1),
      );
      return Array.from({ length: args[9] ?? 0 }, (_, element) => element).every((element) =>
        elements.has(element),
      );
    }
    // Pet-record objectives put their source category in arg9 and required species in arg10.
    if (args[8] === 0) return this.pets.some((pet) => pet.speciesId === args[10]);
    return false;
  }
  get campaign(): CampaignState {
    return this.meta.campaign;
  }
  /** `progression.cauVongIncubation`: the five Cầu Vồng slots (`CauVongIncubator.ts`). */
  get cauVongIncubation(): CauVongIncubation {
    return (this.meta.campaign.cauVongIncubation ??= emptyCauVongIncubation());
  }
  /** Whether `item` is a Cầu Vồng species egg (`CauVongEggCatalog.isEgg`). */
  isCauVongEgg(item: number): boolean {
    return (
      this.sources.campaignSystems?.eggs.some(
        (row) => row.itemId === item && row.hatch === "cauVong",
      ) ?? false
    );
  }
  /** `CauVongEggCatalog.items()`: the Cầu Vồng eggs, in catalog order. */
  cauVongEggRows(): EggCatalogRow[] {
    return this.sources.campaignSystems?.eggs.filter((row) => row.hatch === "cauVong") ?? [];
  }
  /** `CauVongIncubatorPanel.owned`: how many of the egg the bag holds. */
  ownedSpecials(item: number): number {
    return this.bag.specials.filter((id) => id === item).length;
  }
  /** `CauVongOpeningSideQuests.count` of a recipe's material (every one is a MATERIAL row). */
  cauVongMaterialCount(id: number): number {
    return this.bag.materials[String(id)] ?? 0;
  }
  /** `CauVongIncubationRuntime.admit`. */
  admitCauVongEgg(slot: number, item: number): CauVongIncubationResult {
    return admitCauVongEgg(this.cauVongIncubation, this.bag.specials, slot, item, (id) =>
      this.isCauVongEgg(id),
    );
  }
  /** `CauVongIncubationRuntime.hatch`. */
  hatchCauVongEgg(slot: number): CauVongIncubationResult {
    const eggs = this.cauVongEggRows();
    const { result } = hatchCauVongSlot(
      {
        state: this.cauVongIncubation,
        roster: this.pets,
        bank: this.meta.campaign.petBank,
        bankCapacity: this.petBankCapacity(),
        recipe: (item) => eggs.find((row) => row.itemId === item)?.incubator,
        count: (material) => this.cauVongMaterialCount(material.id),
        remove: (material, count) => {
          // `sourceRemoveMaterial`.
          const key = String(material.id);
          this.bag.materials[key] = Math.max(0, (this.bag.materials[key] ?? 0) - count);
        },
        create: (species, level) =>
          this.createHatchedPet(species, level, (lane, bound) =>
            this.worldRandomBounded(lane, bound),
          ),
        markCollected: (pet) => this.collectOwned(pet),
      },
      slot,
    );
    this.synchronizeGoldenBankReward();
    return result;
  }
  /** `CauVongIncubationProgression.clear`: the discard, without refund. */
  discardCauVongEgg(slot: number): void {
    clearCauVongSlot(this.cauVongIncubation, slot);
  }
  /**
   * `SaveSessionSnapshotMapper`: a malformed incubator restores empty; a save from before the
   * incubator that had a Cầu Vồng egg in the Liệt Hỏa incubator moves it to slot 0 with its progress
   * scaled to 200 (`restoreLegacyProgress`), and the Liệt Hỏa incubator is left empty.
   */
  private restoreCauVongIncubation(): void {
    const campaign = this.meta.campaign,
      isEgg = (item: number) => this.isCauVongEgg(item),
      saved = campaign.cauVongIncubation !== undefined;
    if (saved && !validCauVongIncubation(campaign.cauVongIncubation, isEgg))
      campaign.cauVongIncubation = emptyCauVongIncubation();
    const egg = campaign.egg;
    if (!isEgg(egg.activeEggItemId)) return;
    const state = this.cauVongIncubation;
    if (!saved && egg.active && this.bag.specials.includes(egg.activeEggItemId)) {
      admitCauVongEgg(state, this.bag.specials, 0, egg.activeEggItemId, isEgg);
      state.progress[0] = Math.min(
        CAU_VONG_TARGET,
        Math.trunc((Math.max(0, egg.progress) * CAU_VONG_TARGET) / Math.max(1, eggTarget(egg))),
      );
    }
    egg.active = false;
    egg.activeEggItemId = 0;
    egg.progress = 0;
  }
  // ------------------------------------------------------------------ rides (`VqsvRideRuntime`)
  /** The mounted ride id, -1 on foot (`progression.ride.activeIndex`). */
  get activeRideIndex(): number {
    return this.meta.campaign.ride.activeIndex;
  }
  /** `RideProgression.playerMoveSpeed`. */
  get playerMoveSpeed(): number {
    return rideSpeed(this.meta.campaign.ride.activeIndex);
  }
  /** `VqsvRideRuntime.rideUnlocked`. */
  rideUnlocked(rideIndex: number): boolean {
    return rideUnlocked(rideIndex, {
      specials: this.bag.specials,
      rainbowEventDone: (room, event) => this.eventState.sourceEventStateComplete(98, room, event),
      collected: (species) => this.collection.collected(species),
    });
  }
  /** `ride.ui` "usable": owned and allowed in this room (`SelectionOutcome.READY`). */
  rideUsable(rideIndex: number): boolean {
    return (
      rideSelection(this.meta.campaign.ride, rideIndex, this.rideUnlocked(rideIndex)) === "ready"
    );
  }
  /**
   * `PanelDecisionService.selectRide` + `VqsvRideRuntime.applySelectedRide`: mount when owned and
   * allowed here; otherwise say why (the panel shows the warning).
   */
  selectRide(rideIndex: number): RideSelection {
    const outcome = rideSelection(this.meta.campaign.ride, rideIndex, this.rideUnlocked(rideIndex));
    if (outcome !== "ready") return outcome;
    if (rideIndex !== this.meta.campaign.ride.activeIndex && !this.canLeaveRide(rideIndex))
      return "airborne";
    this.meta.campaign.ride.activeIndex = rideIndex;
    this.eventState.op14CompleteEvent(98, 0, RIDE_IDS_SEPARATED_EVENT);
    this.applyPlayerVisual();
    return outcome;
  }
  /**
   * Web bug fix: in Cầu Vồng the clouds (4), the water (2) and the thorns (3) carry the hero only on
   * their own ride (`cauVongMovementTerrain`). Swapping rides or getting off over them left him
   * standing in the sky with every step a wall, or walking off the map's edge. The change waits until
   * every corner of his footprint is open to the next ride (-1 on foot).
   */
  canLeaveRide(next: number): boolean {
    if (this.sceneId !== 98) return true;
    const ride = this.meta.campaign.ride,
      map = this.currentMap();
    if (!map) return true;
    const open = (terrain: number) =>
      cauVongMovementTerrain(
        terrain,
        {
          active: next,
          allowed: (index) => roomAllowsRide(ride, index),
          owned: (index) => this.rideUnlocked(index),
        },
        { water: CV_WATER, plant: CV_PLANT, sky: CV_SKY },
      ) !== TERRAIN_BLOCKED;
    for (const dx of [-8, 7])
      for (const dy of [-8, 7]) {
        const terrain = terrainAtWorld(map, this.player.x + dx, this.player.y + dy);
        if (terrain >= 2 && terrain <= 4 && !open(terrain)) return false;
      }
    return true;
  }
  /** `VqsvRideRuntime.dismount` (key 9 while mounted). */
  dismountRide(): void {
    // ProMax: never set the hero down where his feet cannot stand (the clouds, water, thorns).
    if (!this.canLeaveRide(-1)) return;
    this.meta.campaign.ride.activeIndex = -1;
    this.applyPlayerVisual();
  }
  /** The wardrobe's sprite, worn whenever the hero is on foot. */
  setFashionSprite(sprite: number): void {
    this.fashionSprite = sprite;
    this.applyPlayerVisual();
  }
  private fashionSprite = 0;
  /** `VqsvPlayerAppearanceRuntime.applyEffectiveAppearance` + `player.applyMode(0)`. */
  private applyPlayerVisual(): void {
    const player = this.actors.get(-1);
    if (!player) return;
    player.sprite = riderSprite(this.meta.campaign.ride.activeIndex, this.fashionSprite);
    this.sources.prepareSprite?.(player.sprite);
    this.setPlayerFacing(false);
  }
  /**
   * The player's animation state for a direction. The Cầu Vồng rider banks use the Rainbow
   * order (down 0, up 1, side 2, left mirrored from right's art: `fashionDirectionalState`); every
   * other sprite the canonical one (down 0, side 1, up 2, left mirrored).
   */
  private setPlayerFacing(moving: boolean, swimCheck = false): void {
    const player = this.player;
    const swimming = swimCheck && this.playerSwimming();
    this.wearSwimSprite(swimming);
    if (isRainbowRide(this.meta.campaign.ride.activeIndex)) {
      const facing =
        player.direction === DIRECTION_DOWN ? 0 : player.direction === DIRECTION_UP ? 1 : 2;
      player.state = moving ? 3 + facing : facing;
      // Rainbow side art faces left natively, so only "right" is drawn mirrored.
      player.renderOrientation =
        player.direction === DIRECTION_RIGHT ? DIRECTION_LEFT : DIRECTION_DOWN;
      return;
    }
    player.renderOrientation = -1;
    const facing = WorldRuntime.facingState(player.direction);
    // `canonicalDirectionalState`: family × 3 + facing — idle 0, walk 3, swim 6, swim idle 9.
    player.state = (swimming ? (moving ? 6 : 9) : moving ? 3 : 0) + facing;
  }
  /**
   * `VqsvFreeWorldRuntime.sourcePlayerSwimming`: on foot, Thủy Lam Chương achieved and the hero's
   * point on water (terrain 2). Only the walk tick asks, as Java's `tickMovement` and its idle mode do.
   */
  private playerSwimming(): boolean {
    return (
      this.meta.campaign.ride.activeIndex < 0 &&
      this.flags.badges.achieved(BADGE_THUY_LAM) &&
      this.terrainAt(this.player.x, this.player.y) === TERRAIN_BADGE_GATED
    );
  }
  /**
   * `VqsvWorldActor.applyMode(6 | 9)` on a wardrobe skin: the approved skin banks hold no swim art,
   * so Neil's own sheet (sprite 0) swims and the skin comes back on land. A sprite some event put on
   * the hero is neither of the two and is left alone.
   */
  private wearSwimSprite(swimming: boolean): void {
    const player = this.player;
    if (this.fashionSprite === 0 || this.meta.campaign.ride.activeIndex >= 0) return;
    const from = swimming ? this.fashionSprite : 0,
      to = swimming ? 0 : this.fashionSprite;
    if (player.sprite !== from) return;
    player.sprite = to;
    this.sources.prepareSprite?.(to);
  }
  /**
   * `VqsvRideRuntime.applyRoomPolicy`: on a room load (and a save resume, which also re-checks
   * ownership) the room's restrictions replace the old ones and a ride it forbids is dismounted.
   */
  private applyRideRoomPolicy(validateOwnership: boolean): void {
    applyRideRoomPolicy(
      this.meta.campaign.ride,
      roomRestrictions(this.sources.rideRooms, this.sceneId, this.roomIndex),
      validateOwnership ? (ride) => this.rideUnlocked(ride) : null,
    );
    this.applyPlayerVisual();
  }
  // ------------------------------------------------------------------ team charms (`RainbowCharmService`)
  /** `RainbowCharmState.activeValue`: the equipped charm's value for a mechanic, 0 if none. */
  activeCharmValue(mechanic: CharmMechanic): number {
    const catalog = this.sources.rainbowCharms;
    return catalog ? activeCharmValue(catalog, this.meta.campaign.charms, mechanic) : 0;
  }
  /** What the charm service spends: money, materials, the equipment list and the badges won. */
  private charmPurse(): CharmPurse {
    return {
      currency: this.currency,
      materials: this.bag.materials,
      equipment: this.bag.equipment,
      achievedBadges: this.achievedBadgeCount(),
    };
  }
  /** What a Cầu Vồng shop (`CauVongShopRuntime`) reads and writes. */
  cauVongShopPurse(): CauVongShopPurse {
    const charms = this.meta.campaign.charms;
    return {
      items: this.inventory,
      materials: this.bag.materials,
      equipment: this.bag.equipment,
      held: () =>
        [...this.pets, ...this.meta.campaign.petBank]
          .map((pet) => pet.heldEquipmentId ?? NO_HELD_ITEM)
          .filter((id) => id !== NO_HELD_ITEM),
      ownsCharm: (id) => charms.tiers[String(id)] !== undefined,
      // `rainbowCharms.grant`: a charm bought or awarded starts at its first tier.
      grantCharm: (id) => {
        charms.tiers[String(id)] ??= 1;
      },
      currency: this.currency,
    };
  }
  /** `RainbowCharmService.achievedBadgeCount`. */
  achievedBadgeCount(): number {
    return this.flags.badges.achievedSnapshot().filter((value) => value > 0).length;
  }
  /**
   * The fight's team charms (`VqsvBattleRuntime.enterBattle`): the player's equipped set, and for a
   * Cầu Vồng trainer the NPC's one charm (`CauVongNpcCharms.create`), drawn when the fight opens.
   */
  battleCharms(trainerOwned: boolean): BattleCharms | undefined {
    const catalog = this.sources.rainbowCharms;
    if (!catalog) return undefined;
    const sceneId = this.sceneId;
    return {
      player: new RainbowCharmBattleState(
        catalog,
        charmLoadout(catalog, this.meta.campaign.charms),
        0,
      ),
      enemy: (next, species) => {
        const loadout = npcCharmLoadout(
          catalog,
          { sceneId, trainerOwned, pvp: false },
          species,
          next,
        );
        return loadout ? new RainbowCharmBattleState(catalog, loadout, 1) : undefined;
      },
    };
  }
  craftCharm(id: number): CharmResult {
    const catalog = this.sources.rainbowCharms;
    return catalog
      ? craftCharm(catalog, this.meta.campaign.charms, this.charmPurse(), id)
      : { outcome: "INVALID_CHARM", runtimeId: id, tierBefore: 0, tierAfter: 0 };
  }
  upgradeCharm(id: number): CharmResult {
    const catalog = this.sources.rainbowCharms;
    return catalog
      ? upgradeCharm(catalog, this.meta.campaign.charms, this.charmPurse(), id)
      : { outcome: "NOT_OWNED", runtimeId: id, tierBefore: 0, tierAfter: 0 };
  }
  equipCharm(id: number): CharmResult {
    const catalog = this.sources.rainbowCharms;
    return catalog
      ? equipCharm(catalog, this.meta.campaign.charms, id)
      : { outcome: "INVALID_CHARM", runtimeId: id, tierBefore: 0, tierAfter: 0 };
  }
  worldRandomBounded(label: string, bound: number): number {
    const value = this.sourceRandom.nextBounded(label, bound);
    this.meta.campaign.worldRandom.draws++;
    return value;
  }
  recordBattlePassEvent(type: BattlePassEventType): void {
    const pass = this.sources.battlePass;
    if (!pass) return;
    applyBattlePassEvent(
      pass,
      this.meta.battlePass,
      { id: `campaign-${type}-${this.tickCount}-${this.meta.campaign.worldRandom.draws}`, type },
      Date.now(),
    );
  }
  /** Long Vương Hộ Phù (6000), Kim Diễm's victory amulet, is owned and held by a party pet. */
  kimDiemAmuletEquipped(): boolean {
    return (
      this.bag.equipment.includes(KIM_DIEM_AMULET_ID) &&
      this.pets.some((pet) => pet.heldEquipmentId === KIM_DIEM_AMULET_ID)
    );
  }
  kimDiemRewardClaimed(): boolean {
    return this.eventState.sourceEventStateComplete(98, KIM_DIEM_ROOM, KIM_DIEM_REWARD_RECEIPT);
  }
  /** The pet bank's size: 1.000 once Kim Diễm's reward is in, else the bought expansions'. */
  petBankCapacity(): number {
    return this.kimDiemRewardClaimed()
      ? KIM_DIEM_BANK_CAPACITY
      : petBankCapacity(this.meta.campaign.petBankExpansionPurchases);
  }
  /**
   * `sourceHatchedPet`: `PetSourceAdapter.create(0, species, 5, -1, 2, element * 10, -1)` — level 5,
   * the species' resolved quality and (unified skill profile) its level-5 learnset. ProMax: with a
   * `draw` an egg rolls its nature, 2% shiny (30% with Long Vương Hộ Phù); without one, nature 2.
   */
  createHatchedPet(
    speciesId: number,
    level = 5,
    draw?: (lane: string, bound: number) => number,
  ): SavedPet | undefined {
    const species = this.sources.petStats.speciesRow(speciesId);
    if (!species) return undefined;
    const nature = draw ? rollHatchNature(draw, this.kimDiemAmuletEquipped()) : 2,
      quality = this.sources.petStats.resolveQuality(speciesId, -1),
      initial = this.sources.battle?.progression.initialSkills(speciesId, level) ?? [],
      skillIds = initial.length ? initial : [species.element * 10],
      pet = this.petFromSource(
        {
          id: species.speciesId,
          name: species.name,
          level,
          quality,
          nature,
          spriteId: species.spriteId,
          element: species.element,
          maxHp: this.sources.petStats.coreStats(speciesId, level, quality, nature).hp,
        },
        0,
      );
    pet.skillIds = skillIds;
    pet.skillPp = skillIds.map((id) => this.sources.battleRules.damage.skillRow(id)?.ppMax ?? 0);
    giveShinyColor(pet);
    return pet;
  }
  /**
   * Admin Tool: a hatched pet with the nature (7..9 shiny) and the talent entropy the server drew.
   * The talent goes through the same weighted pool and sanitizer as every other roll.
   */
  createAdminPet(speciesId: number, nature: number, talentEntropy: bigint): SavedPet | undefined {
    const pet = this.createHatchedPet(speciesId);
    if (!pet) return undefined;
    const stats = this.sources.petStats.coreStats(speciesId, pet.level, pet.quality, nature);
    pet.nature = nature;
    pet.maxHp = stats.hp;
    pet.currentHp = stats.hp;
    giveShinyColor(pet);
    const traits = this.sources.battle?.rules.traitRegistry;
    if (traits) pet.physicalTraitId = traits.sanitizePhysicalTraitId(traits.roll(talentEntropy));
    return pet;
  }
  /**
   * Admin Tool: `exp` added to the roster pet in `slot` the way a fight's settlement adds it, so
   * stats, HP, PP and learned skills follow; a skill with no free slot waits in the learn queue.
   * Returns the levels gained, or -1 when there is no such pet.
   */
  addAdminExperience(slot: number, exp: number): number {
    const pet = this.pets[slot],
      progression = this.sources.battle?.progression;
    if (!pet || !progression) return -1;
    const result = progression.addExperience(pet, exp);
    for (const skillId of result.pending)
      if (!this.pendingSkillLearns.some((e) => e.petSlot === slot && e.skillId === skillId))
        this.pendingSkillLearns.push({ petSlot: slot, skillId });
    return result.levelsGained;
  }
  get currentText(): string {
    return this.phase === "savePrompt"
      ? this.saveStatus || this.data.text.savePrompt
      : this.phase === "saving"
        ? this.saveStatus
        : this.phase === "battleReport"
          ? this.battleLost
            ? "Thua trận! Đội hình đã được hồi phục, quay về điểm lưu."
            : this.data.text.battleReport
          : this.phase === "returnTask"
            ? this.data.text.returnTask
            : this.phase === "battle"
              ? (this.battle?.prompt ?? "")
              : "";
  }
  get savePromptVisible(): boolean {
    return this.phase === "savePrompt" || this.phase === "saving";
  }
  /**
   * `ScreenEffect.startBattleEntryTransition(mode)`: the op32 wipe's pattern, the request's
   * `Mode(_, backgroundMode)` — 0 the two half bars, 1 alternating rows, 2 alternating columns.
   * Only the Cầu Vồng requests carry it here (all `Mode(0,2)`); every other fight keeps 0.
   */
  battleEntryMode = 0;
  private nextBattleEntryMode = 0;
  get battleEntryVisible(): boolean {
    return this.phase === "battleEntry";
  }
  get battleVisible(): boolean {
    return this.phase === "battle";
  }
  get battleStage(): WorldBattleStage {
    return this.battle?.interactiveStage ?? "fight";
  }
  get opponentHp(): number {
    return this.battle?.hp("enemy") ?? this.petStats(this.data.opponent).hp;
  }
  get catchChoice(): { label: string; quantity: number } | null {
    return this.battle?.catchChoice(this.inventory) ?? null;
  }
  /**
   * Web only: a moment a save taken now resumes to exactly (the phone hid the tab). The hero walks
   * freely and nothing is half-done: no event, fight, prompt, service talk, minigame or ride.
   */
  get restingForSuspendSave(): boolean {
    return (
      (this.phase === "freeworld" || this.phase === "returnWorld") &&
      !this.battle &&
      !this.platformRide &&
      !this.leafSummon &&
      !this.repelPrompt &&
      !this.tanNguyetModal &&
      !this.npcService &&
      !this.cauVongMinigameOpen
    );
  }
  /** A dispatched event group freezes movement and owns the text until its records finish. */
  get eventVisible(): boolean {
    return this.phase === "event";
  }
  /** The phases the hero walks in, and the only ones whose tick scans the trigger catalog. */
  // ------------------------------------------------------------------ service NPCs (game.l state 23)
  /** The merchant / clerk / envoy conversation running now, or null. */
  private npcService: NpcServiceFlow | null = null;
  /** The facing the NPC had before it turned to the hero (`faceActorTowardPlayer`). */
  private npcServiceFacing: { id: number; direction: number } | null = null;
  /** A finished conversation's service, waiting for the host to open its panel. */
  /**
   * op53's award card (`openSourceBadgeAward`): the badge a world group just granted, waiting for
   * the host to show it in `badge.ui` and cleared once that panel closes. Only a world whose host
   * draws panels (`presentsPanels`) asks for it; elsewhere (traces, bare tests) the grant is silent.
   */
  badgeAward: { badgeId: number; shown: boolean } | null = null;
  /** A vortex crossing (`PhoenixC3Runtime.GymVortexTravel`), or null. */
  private vortex: {
    from: SourceDoor;
    to: SourceDoor;
    phase: 0 | 1;
    enterTick: number;
    exitCounter: number;
  } | null = null;
  /** A torch being lit (`RelicSwitch`): its state-1 cycle plays, then it burns (state 2). */
  private switchCycle: { actorId: number; waited: number } | null = null;
  /** `XhtC3Runtime.iceSliding` / `iceDirection`: the slide under way on 10:0's ice, or null. */
  private iceDirection: number | null = null;
  /**
   * `session.runtime.nguyenMocRace*`: the Lục Hành Điểu attempt under way — never saved, dropped
   * whenever a room loads (`reconcileRoomEntry` / `onRoomReplacement`).
   */
  private race = { active: false, startMillis: 0, countdown: 0, countdownTicks: 0 };
  /** The wall clock the race times against (`System.currentTimeMillis`); tests replace it. */
  clock: () => number = () => Date.now();
  /** This room's gym challengers: each actor with the battle groups it owns (catalog GYM_* class). */
  private gymChallengers: { actorId: number; groups: GroupRef[] }[] = [];
  /** `BattleNpcProximityGate.GROUPS_BY_ACTOR`, read once from the AI catalog. */
  private challengeIndex: Map<string, number[]> | null = null;
  /** `Actor.sourceObstacleCleared` of this room's trees and rocks. */
  private readonly clearedObstacles = new Set<number>();
  /** `BlcC3Runtime.roomEntryX/Y`: where the hero came into this room (a vortex sends him back). */
  private roomEntry = { x: 0, y: 0 };
  /** `VortexReset`: the hero spinning in a moving vortex before he is put back, or null. */
  private hazardSpin: { ticks: number } | null = null;
  /** `NiemThoC3Runtime.GymHoleFall`: the hero dropping through a 9:2 floor hole, or null. */
  private gymHoleFall: {
    holeId: number;
    direction: number;
    startX: number;
    startY: number;
    tick: number;
  } | null = null;
  /** A lotus leaf or cloud carrying the hero (`sourceLeafRide*`), or null. */
  private platformRide: PlatformRideState | null = null;
  /** A lotus leaf or cloud sailing over to the hero who called it (`trySummonLeaf`), or null. */
  private leafSummon: {
    actorId: number;
    target: { x: number; y: number };
    direction: number;
  } | null = null;
  /** `sourceTreePromptActors`: the obstacles whose action marker shows over them. */
  private obstaclePromptIds: number[] = [];
  /** `sourceTreeCutActive` / `sourceTreeCutActors`: a clear in progress. */
  private obstacleCut: { actorIds: number[] } | null = null;
  /** op49's `taskOption.ui` request, answered by the host once the panel closes (0 accepts). */
  taskOption: {
    task: number;
    options: readonly string[];
    shown: boolean;
    answer: number | null;
  } | null = null;
  /** Set by a host that draws `badge.ui`/`taskOption.ui` for the world's groups. */
  presentsPanels = false;
  private pendingService: NpcService | null = null;
  /** The line on screen while a service NPC speaks (`TextBox.dialog`), or null. */
  get npcDialog(): { speaker: string; text: string } | null {
    const flow = this.npcService;
    return flow && !flow.done
      ? { speaker: flow.speaker, text: flow.text.slice(0, flow.visibleChars) }
      : null;
  }
  /** The service the host should open now (`VqsvSourceNpcDispatchFlow.tick`'s switch), once. */
  takeServiceRequest(): NpcService | null {
    const service = this.pendingService;
    this.pendingService = null;
    return service;
  }
  /**
   * Web-only (owner 2026-11-15): the cloud rooms' way out for a hero stranded on an island — any
   * NPC there with no service of its own (a beaten gym trainer, a bystander) offers the trip back.
   */
  private cloudReturnService(actorId: number, own?: NpcService): NpcService | undefined {
    if (!CLOUD_ROOM_ENTRANCES.has(`${this.sceneId}:${this.roomIndex}`)) return own;
    // An ordinary line (the gym leader's) is said first, then the trip back.
    if (own)
      return own.continuation === "NONE" && !own.transport ? { ...own, cloudReturn: true } : own;
    return {
      scene: this.sceneId,
      room: this.roomIndex,
      actorId,
      dialogRow: -1,
      speaker: null,
      text: "Bị kẹt giữa các đám mây à? Ta đưa ngươi về chỗ lúc mới đến, mây cũng trở lại như ban đầu.",
      continuation: "NONE",
      dialogue: true,
      bankExpansion: false,
      cloudReturn: true,
    };
  }
  /** The cloud room's entrance door arrival, every cloud back on its row, then on the hero's side. */
  private returnToCloudRoomEntrance(): void {
    const entrance = CLOUD_ROOM_ENTRANCES.get(`${this.sceneId}:${this.roomIndex}`),
      asset = this.sources.room(this.sceneId, this.roomIndex);
    if (!entrance || !asset) return;
    const arrival = transitionArrivalForTarget(this.sources.registry, asset, {
      scene: this.sceneId,
      room: this.roomIndex,
      actor: entrance,
    });
    if (!arrival) return;
    this.loadRoom(this.sceneId, this.roomIndex, arrival.x, arrival.y, arrival.direction);
    const platforms = asset.actors.filter((row) => isPlatform(row)).map((row) => row.id);
    this.stagePlatforms(platforms);
    const map = this.sources.collision(asset.mapId);
    if (map) this.bringPlatformsToHero(map, platforms);
  }
  /** The faced talkable actor of this room that runs a service, started; false when none. */
  private startNpcService(): boolean {
    const complete = (scene: number, room: number, group: number) =>
      this.eventState.sourceEventStateComplete(scene, room, group);
    const owner = roomOwner(this.sceneId, this.roomIndex, (ref) =>
      complete(ref.scene, ref.room, ref.group),
    )?.runtime;
    const serviceAt = (actorId: number) =>
      npcServiceAt(
        this.sources.npcServices,
        this.sceneId,
        this.roomIndex,
        actorId,
        owner,
        complete,
      );
    let service: NpcService | undefined;
    if (this.pointerActor !== undefined) {
      const selected = this.actors.get(this.pointerActor);
      if (selected && this.actorInteractionRequested(selected)) {
        const own = serviceAt(selected.id);
        service = talkEligible(selected) ? this.cloudReturnService(selected.id, own) : own;
      }
    } else {
      const prompt = this.talkPrompt;
      if (prompt) service = this.cloudReturnService(prompt.actorId, serviceAt(prompt.actorId));
      // Source dispatch can address named actors whose behavior never draws a talk bubble.
      service ??= this.sources.npcServices?.services.find((row) => {
        if (row.scene !== this.sceneId || row.room !== this.roomIndex) return false;
        const actor = this.actors.get(row.actorId);
        return actor && !talkEligible(actor) && this.playerFaces(actor) && serviceAt(actor.id) === row;
      });
    }
    if (!service) return false;
    const flow = new NpcServiceFlow(service),
      actor = this.actors.get(service.actorId);
    this.player.state = WorldRuntime.facingState(this.player.direction);
    if (flow.done) {
      this.pendingService = service;
      return true;
    }
    // `faceActorTowardPlayer`: an ordinary NPC sprite (<= 85) turns to face the hero.
    if (actor && actor.sprite <= 85) {
      this.npcServiceFacing = { id: actor.id, direction: actor.direction };
      actor.direction = (this.player.direction + 2) % 4;
      actor.state = WorldRuntime.facingState(actor.direction);
    }
    this.npcService = flow;
    return true;
  }
  /** The North Sea's Divine seal, from north-sea.json's baked species. */
  private divineSeal?: DivinePetSeal;

  /** `DivinePetSeal.released(session)`. */
  divineReleased(): boolean {
    return (
      this.divineSeal?.released((scene, room, event) =>
        this.eventState.sourceEventStateComplete(scene, room, event),
      ) ?? false
    );
  }

  /** `DivinePetSeal.percent` of an owned pet: 30/120 for a Divine species, else 100. */
  divinePercent(speciesId: number): number {
    return this.divineSeal?.percent(speciesId, this.divineReleased()) ?? 100;
  }

  /** `DivinePetSeal.synchronize(session)` over the roster and the bank. */
  private synchronizeDivineSeal(): void {
    const seal = this.divineSeal,
      stats = this.sources.battle?.petStats;
    if (!seal || !stats) return;
    const released = this.divineReleased();
    seal.synchronize(
      [...this.pets, ...this.meta.campaign.petBank],
      (pet) => seal.percent(pet.speciesId, released),
      (pet) => stats.coreStats(pet.speciesId, pet.level, pet.quality, pet.nature ?? 0).hp,
    );
  }

  private tickNpcService(commands: InputCommand[]): void {
    const flow = this.npcService!;
    flow.tick(commands.includes("confirm"));
    if (!flow.done) return;
    const facing = this.npcServiceFacing,
      actor = facing ? this.actors.get(facing.id) : undefined;
    if (actor && facing) {
      actor.direction = facing.direction;
      actor.state = WorldRuntime.facingState(facing.direction);
    }
    this.npcServiceFacing = null;
    this.npcService = null;
    // `case NONE: return true`: an ordinary NPC's line closes the conversation — unless she escorts
    // the hero somewhere afterwards (`LeitaTempleEscort`).
    if (flow.service.cloudReturn) {
      this.returnToCloudRoomEntrance();
      return;
    }
    const transport = flow.service.transport;
    if (transport && transport.length >= 4)
      this.loadRoom(transport[0], transport[1], transport[2], transport[3], transport[4] ?? 2);
    else if (flow.service.continuation !== "NONE") this.pendingService = flow.service;
  }
  private get onFreeMap(): boolean {
    return this.phase === "freeworld" || this.phase === "returnWorld";
  }
  /** The event group running now (its music may override the room's), or null. */
  /**
   * `VqsvQuestMarkerRuntime.render`'s markers: sprite 259 in the marker's state over each visible
   * side-quest NPC of the room (`QuestMarker`), in world coordinates 40 px above the actor.
   */
  /**
   * `VqsvDarkRoomPresentation.evaluate`: in Niêm Thổ's dark mines (4:3, 4:4) and Hắc Thạch's
   * cave (5:6) only a square of `darknessVisibilityRadius` around the hero shows — lifted by
   * `CAMERA_FOCUS_Y_OFFSETS` for the ride he sits on. World coordinates; null elsewhere.
   */
  get darkRoomView(): { x: number; y: number; radius: number } | null {
    const scene = this.sceneId,
      room = this.roomIndex;
    if (!((scene === 5 && room === 6) || (scene === 4 && (room === 3 || room === 4)))) return null;
    const offsets = [21, 35, 50, 0, 45],
      offsetIndex = rideTerrainIndex(this.meta.campaign.ride.activeIndex) + 1,
      lift = offsets[offsetIndex >= 0 && offsetIndex < offsets.length ? offsetIndex : 0];
    return {
      x: this.player.x,
      y: this.player.y - lift,
      radius: this.flags.badges.darknessVisibilityRadius(),
    };
  }
  get questMarkers(): { x: number; y: number; state: number }[] {
    if (!this.onFreeMap) return [];
    const ledger = this.eventState,
      markers = javaQuestMarkers(this.sceneId, this.roomIndex, {
        status: (task) => this.sources.branchTasks?.status(task) ?? -1,
        complete: (scene, room, group) => ledger.sourceEventStateComplete(scene, room, group),
        inactive: (scene, room, group) => ledger.sourceEventStateInactive(scene, room, group),
        flag: (flag) => this.flags.hasSourceWorldFlag(flag),
        collected: (speciesId) => this.collection.collected(speciesId),
        hasItems: (itemId, quantity) => (this.inventory[String(itemId)] ?? 0) >= quantity,
        mainTask: this.flags.mainTaskProgress,
        rosterCoversElements: () => this.sourceObjectiveReady([0, 0, 0, 0, 0, -1, -1, -1, 6, 4]),
        // JavaSE's unified egg-hatch tracking is not on the web: task 6 is ready when its own
        // hand-in (4:5:g4's op44) would be dispatched.
        eggQuestReady: () =>
          this.sourceObjectiveReady([
            ...(this.sources.registry.group(4, 5, 4)?.records[0]?.short_args ?? []),
          ]),
      });
    return markers.flatMap(({ actorId, state }) => {
      const actor = this.actors.get(actorId);
      return actor?.visible ? [{ x: actor.x, y: actor.y - 40, state }] : [];
    });
  }
  get activeEventGroup(): GroupRef | null {
    return this.phase === "event" ? (this.event?.ref ?? null) : null;
  }
  /** The battle group being fought (its battle music may be set per group), or null. */
  get battleGroup(): GroupRef | null {
    return this.activeBattleGroup;
  }
  get eventScene(): StorySceneRuntime | null {
    return this.phase === "event" ? (this.event?.scene ?? null) : null;
  }

  /**
   * `Scene.tick`'s first branch: while the map-loading screen is running it owns the tick, and
   * nothing below it — movement, events, the HUD, a cutscene — advances. True for the whole tick
   * that ends the screen, so it is on screen for `MAP_LOADING_TOTAL_TICKS` ticks.
   *
   * Rooms are fetched on demand, so a room whose map has not arrived when the ramp ends keeps the
   * full bar on screen until it has; a room that is already loaded leaves on Java's tick exactly.
   */
  tickMapLoading(): boolean {
    const loading = this.mapLoading;
    if (!loading) return false;
    if (loading.tick()) {
      if (!loading.active && this.currentRoomReady()) {
        this.checkRoomArrival();
        this.mapLoading = null;
        this.leaveClosedLedge();
      }
      return true;
    }
    if (!this.currentRoomReady()) return true;
    this.checkRoomArrival();
    this.mapLoading = null;
    this.leaveClosedLedge();
    return false;
  }
  /**
   * Web-only: a save made where the landscape map has since been closed (4:10's ledge round the
   * pit, see `scripts/landscape/apk-collision.mjs` HAND_BLOCKED) would leave the hero unable to take
   * a step. Once the room is in, a hero who can move no way at all is put on that room's floor.
   */
  private leaveClosedLedge(): void {
    const spot = CLOSED_LEDGE_FLOOR[`${this.sceneId}:${this.roomIndex}`],
      asset = this.sources.room(this.sceneId, this.roomIndex),
      map = asset ? this.sources.collision(asset.mapId) : undefined;
    if (!spot || !map) return;
    const stuck = [DIRECTION_DOWN, DIRECTION_RIGHT, DIRECTION_UP, DIRECTION_LEFT].every(
      (direction) => !stepWithTerrain(map, this.player.x, this.player.y, direction).moved,
    );
    if (!stuck) return;
    this.player.x = spot.x;
    this.player.y = spot.y;
    this.player.direction = spot.direction;
    this.setPlayerFacing(false);
    this.centerCamera();
  }
  /** Whether the room the hero stands in has its map layers loaded (always, without lazy loading). */
  private currentRoomReady(): boolean {
    return !this.sources.roomReady || this.sources.roomReady(this.sceneId, this.roomIndex);
  }
  tick(commands: InputCommand[]): WorldAction {
    this.tickCount++;
    // `VqsvGameRuntime.tick`: `DivinePetSeal.synchronize(session)` before anything reads a pet.
    this.synchronizeDivineSeal();
    if (this.sceneId === 98) this.tickCauVongPresentation();
    // Every owned pet is collected (`markCollected` on a grant, a hatch, an evolution...).
    for (const pet of this.pets) this.collectOwned(pet);
    this.hud.tick(this.talkPrompt?.actorId ?? -1);
    this.presentationTick++;
    // While an event group runs it steps the hero itself: he is the record the group walks around
    // in, so the world must not add a second animation step on top of the group's own.
    for (const [id, actor] of this.actors)
      if (
        id !== WorldRuntime.COMPANION_ACTOR_ID &&
        actor.visible &&
        !(this.phase === "event" && id === -1)
      )
        actor.animationTick++;
    for (const [id, state] of this.cauVongHeld) {
      const actor = this.actors.get(id);
      if (!actor) continue;
      actor.state = state;
      actor.animationTick = Math.max(0, this.sources.animationTicks(actor.sprite, state) - 1);
    }
    this.tickPetCompanion();
    // `TanNguyetLongMaBossRuntime.tick`, ahead of the activity: place, show and idle the boss.
    this.tickTanNguyetBoss();
    if (this.tanNguyetModal) return this.tickTanNguyetModal(commands);
    if (this.inRaceRoom) this.tickRaceObstacles();
    if (this.switchCycle) {
      this.tickSwitchCycle();
      return null;
    }
    if (this.vortex) {
      this.tickVortex();
      return null;
    }
    if (this.obstacleCut) {
      this.tickObstacleCut();
      return null;
    }
    // `advanceTraversalHazards`: 10:5–10:7's vortices sweep on through the room and its events.
    if (this.hazardRoom() && (this.onFreeMap || this.phase === "event")) this.advanceHazards();
    if (this.hazardSpin) {
      this.tickHazardSpin();
      return null;
    }
    if (this.gymHoleFall) {
      this.tickGymHoleFall();
      return null;
    }
    if (this.repelPrompt) {
      this.tickRepelPrompt(commands);
      return null;
    }
    if (this.npcService) {
      this.tickNpcService(commands);
      return null;
    }
    if (this.phase === "savePrompt") {
      if (this.saveStatus && commands.length) {
        this.saveStatus = "";
        return null;
      }
      if (commands.includes("left")) this.saveSelected = 1;
      if (commands.includes("right")) this.saveSelected = 0;
      if (commands.includes("confirm")) {
        if (this.saveSelected === 1) this.setPhase("freeworld");
        else {
          this.setPhase("saving");
          this.saveStatus = this.data.text.saveInProgress;
          return "save";
        }
      }
      return null;
    }
    if (this.phase === "saving") return null;
    if (this.phase === "battleEntry") {
      if (this.presentationTick >= 25) this.setPhase("battle");
      return null;
    }
    if (this.phase === "battle") {
      if (this.doubleBattle) return this.tickDoubleBattle(this.doubleBattle, commands);
      this.battle?.handleInput(commands, this.inventory);
      this.battle?.tick();
      if (this.battle?.complete) {
        if (this.bondingTowerRun)
          return this.finishBondingTowerBattle(this.battle.outcome?.winner === "player");
        const battle = this.battle,
          // The fight of an event group: its records carry the rewards and the ledger, so the world
          // hands the finished battle back to the scene instead of closing the group itself.
          hosted = this.event !== null;
        // A fight on the core settled itself as its end played (so its level-ups could be shown).
        this.lastSettlement = battle.settlement;
        // `commit B->S`: the participants' EXP also fills the Cầu Vồng incubator.
        advanceCauVongIncubation(
          this.cauVongIncubation,
          (battle.settlement?.members ?? []).reduce((sum, member) => sum + member.experience, 0),
        );
        for (const [petSlot, member] of (battle.settlement?.members ?? []).entries())
          for (const skillId of member.levelUp.pending)
            if (
              !this.pendingSkillLearns.some(
                (entry) => entry.petSlot === petSlot && entry.skillId === skillId,
              )
            )
              this.pendingSkillLearns.push({ petSlot, skillId });
        const pass = this.sources.battlePass;
        if (pass) {
          const event = `battle-${this.sceneId}-${this.roomIndex}-${this.tickCount}`;
          applyBattlePassEvent(
            pass,
            this.meta.battlePass,
            { id: `${event}-complete`, type: "BATTLE_COMPLETED" },
            Date.now(),
          );
          if (battle.result !== BATTLE_RESULT_LOST && battle.outcome?.reason !== "run")
            applyBattlePassEvent(
              pass,
              this.meta.battlePass,
              { id: `${event}-win`, type: "BATTLE_WON" },
              Date.now(),
            );
        }
        // `markCollected(caught.speciesId)`, before the storage decision: a released catch counts.
        if (battle.settlement?.caught) {
          this.collectOwned(battle.settlement.caught.pet);
          if (battle.settlement.caught.storage === "BANK") this.synchronizeGoldenBankReward();
        }
        const repeatable = this.repeatableBattle;
        this.payVictoryReward(battle);
        // What the story director hears: the group fought here and whether it was won.
        const fought = this.activeBattleGroup;
        if (fought)
          this.lastBattle = {
            ...fought,
            won: battle.result !== BATTLE_RESULT_LOST && battle.outcome?.reason !== "run",
          };
        this.battle = null;
        if (this.wildBattle) {
          // `FreeWorldEncounterBattle`: the world resumes where the fight began. A loss revived the
          // party (`BattleLossWorldService`); JavaSE then respawns at the region's shop entrance,
          // which the web does not have yet, so the hero goes back to the last save point.
          this.wildBattle = false;
          if (battle.result === BATTLE_RESULT_LOST) {
            const point = this.savePoint;
            this.loadRoom(point.scene, point.room, point.x, point.y, point.direction, "resume");
          }
          this.setPhase("freeworld");
          return "autosave";
        }
        if (this.academyFight) {
          // The owner's `handleBattleResult` runs once the world is back.
          this.academyResult = {
            won: battle.result !== BATTLE_RESULT_LOST && battle.outcome?.reason !== "run",
          };
          this.setPhase("freeworld");
          return "autosave";
        }
        if (this.fourGatesFight) {
          // `handleBattleResult` / `ruinsMaskedBattle` once the world is back.
          this.fourGatesPending = {
            kind: "result",
            won: battle.result !== BATTLE_RESULT_LOST && battle.outcome?.reason !== "run",
            masked: this.fourGatesFight.masked,
            key: this.fourGatesFight.key,
          };
          this.fourGatesFight = null;
          this.setPhase("freeworld");
          // ProMax: Kim Diễm saves only once his win or retry marker has replaced the battle marker.
          return this.fourGatesPending.key === KIM_DIEM_BATTLE_KEY ? null : "autosave";
        }
        if (this.lockeBattle) {
          // `handleBattleResult` runs once the world is back; the settlement healed the party.
          this.lockePending = {
            kind: "result",
            won: battle.result !== BATTLE_RESULT_LOST && battle.outcome?.reason !== "run",
          };
          this.setPhase("freeworld");
          return "autosave";
        }
        if (repeatable) {
          this.repeatableBattle = false;
          this.activeBattleGroup = null;
          this.setPhase("freeworld");
          this.resumeAfterBattle();
          return "autosave";
        }
        if (battle.outcome?.reason === "run") {
          // Fled: nothing is won, the group stays open, the player is back where the fight began.
          this.activeBattleGroup = null;
          if (hosted) {
            this.dispatcher.holdUntilRoomChange(this.event!.ref);
            this.event = null;
          }
          this.setPhase("freeworld");
          return "autosave";
        }
        if (hosted) {
          this.activeBattleGroup = null;
          if (battle.result === BATTLE_RESULT_LOST) {
            // Java sends a defeated hero to the village; until that route exists the group simply
            // stays open. The settlement already healed the party, so the retry starts on full HP.
            // A chain link (no rect, e.g. PaYaQi's 2:1:1) waits until the hero has left the room,
            // or it would restart the lost fight on the next tick (`holdUntilRoomChange`).
            this.dispatcher.holdUntilRoomChange(this.event!.ref);
            this.event = null;
            // A quest pet (Uy Qua Đệ Đệ, Nhiên Liệp Sư, Thảo Diệp Cô...) is a catchable wild
            // encounter: `BattleLossWorldService` revives the party and respawns the hero away from
            // it, which the web does as for any wild loss — back at the save point. The group stays
            // open, so the pet waits there for a retry.
            if (battle.core?.captureAllowed()) {
              const point = this.savePoint;
              this.loadRoom(point.scene, point.room, point.x, point.y, point.direction, "resume");
              this.setPhase("freeworld");
              return "autosave";
            }
            // `BattleLossWorldService.prepare` resets Thiên Giới Đạo Quán's clouds, and `GymBattle`
            // puts the hero back at its door (actor 5) to try again.
            if (this.sceneId === 9 && this.roomIndex === 7)
              this.retryGymFromDoor(5, [0, 1, 2, 3, 4]);
            // `BichThuyHubRuntime.resetGymLotusForBattleLoss`: the Bích Thủy gym's four leaves go
            // back to their rows; the web keeps the hero in the gym, at its door (actor 23).
            if (this.sceneId === 9 && this.roomIndex === 0)
              this.retryGymFromDoor(23, BICH_THUY_GYM_LEAVES);
            this.setPhase("freeworld");
            return "autosave";
          }
          // The finished battle answers for the record it was parked on; op47 reads its result and
          // the group's own records — reward text, items, task step, ledger write — play in order.
          this.event!.scene.battle = battle;
          this.setPhase("event");
          return null;
        }
        if (battle.result === BATTLE_RESULT_LOST) {
          // Nothing was won: the group stays open and the save is written once the player is back.
          this.setPhase("battleReport");
          return null;
        }
        this.objectiveComplete = true;
        this.bunnyJoinPending = true;
        const opponent = this.actors.get(this.data.encounter.actorId);
        if (opponent) opponent.visible = false;
        this.completeBattleGroup();
        this.setPhase("battleReport");
        return "autosave";
      }
      return null;
    }
    if (this.phase === "battleReport") {
      if (!commands.includes("confirm")) return null;
      if (this.battleLost) {
        const point = this.savePoint;
        this.battle = null;
        this.lastSettlement = null;
        this.loadRoom(point.scene, point.room, point.x, point.y, point.direction, "resume");
        this.setPhase("freeworld");
        return "autosave";
      }
      this.setPhase("returnTask");
      return null;
    }
    if (this.phase === "returnTask") {
      if (commands.includes("confirm")) {
        const next = this.data.afterBattle;
        this.setPhase("returnWorld");
        this.loadRoom(next.scene, next.room, next.x, next.y, next.direction);
        return "autosave";
      }
      return null;
    }
    if (this.phase === "event") {
      const event = this.event,
        // `game.e` case 38 waits on `game.l.E`, the actor the hero is facing, so the free world keeps
        // walking the hero until he presses the key in front of one of the listed actors.
        activating = event?.activationIds ?? [];
      if (activating.length) {
        this.move(commands);
        if (commands.includes("confirm")) {
          const faced = this.facedActor(activating);
          if (faced >= 0) event!.activateActor(faced);
        }
      } else if (event?.choice) {
        // `ChoiceBox.move`: the direction keys drive the option cursor, not the hero.
        const delta =
          commands.includes("up") || commands.includes("left")
            ? -1
            : commands.includes("down") || commands.includes("right")
              ? 1
              : 0;
        if (delta) event.moveChoice(delta);
      }
      event?.tick(commands);
      const transitioned =
        !!event &&
        (event.scene.sceneId !== this.sceneId || event.scene.roomIndex !== this.roomIndex);
      if (event && !transitioned) this.syncEventActors();
      this.centerCamera();
      const completed = !event || event.done;
      if (completed) {
        if (transitioned && event) {
          const player = event.scene.actors.get(-1);
          this.loadRoom(
            event.scene.sceneId,
            event.scene.roomIndex,
            player?.x ?? this.player.x,
            player?.y ?? this.player.y,
            player?.direction ?? this.player.direction,
          );
        }
        // An event that moved a block (10:1's demonstration, an op58 reset) leaves it remembered.
        if (!transitioned)
          for (const [id, actor] of this.actors)
            if (id >= 0 && (actor.variant === 8 || actor.variant === 9 || actor.variant === 10))
              this.rememberMovingActor(id);
        this.event = null;
        this.setPhase(this.eventReturnPhase);
      }
      return this.takeSaveRequest() ?? (completed ? "autosave" : null);
    }
    // CV0': `CauVongSummoningMinigame.tick` first in `summoning.tick`: an open board owns the tick.
    if (this.onFreeMap && this.sceneId === 98 && this.cauVongMinigameOpen)
      return this.tickCauVongMinigame(commands);
    // `CauVongBranchTreasures.interact` inside `missingBranches.tick`: a faced chest on 5, ahead of
    // the square and the room owners that come after it (67, 50 and 43 check it in their own tick).
    if (
      this.onFreeMap &&
      this.sceneId === 98 &&
      !this.fourGatesPending &&
      commands.includes("confirm") &&
      !this.branches()?.handles(this.roomIndex)
    ) {
      const chest = this.branches()?.interact(this.branchWorld(true), this.roomIndex) ?? null;
      if (chest && this.runFourGatesAction(chest)) return this.takeSaveRequest();
    }
    // `CauVongChapterRuntime.tick` owns Quảng Trường Cầu Vồng (`tickSquare`).
    if (this.onFreeMap && this.sceneId === 98 && this.roomIndex === CAU_VONG_SQUARE_ROOM)
      return this.tickCauVongSquare(commands);
    // A finished Bốn Cổng script or fight hands its follow-up back first, wherever it ended (the
    // masked pair's in the ruins, 5).
    if (
      this.onFreeMap &&
      this.sceneId === 98 &&
      this.fourGatesPending &&
      this.tickFourGatesPending()
    )
      return this.takeSaveRequest();
    // `rockObstacles.tick`: a breaking rock holds the hero; 5 at a closed rock tries the metal mount.
    if (this.onFreeMap && this.sceneId === 98 && this.tickCauVongRocks(commands))
      return this.takeSaveRequest();
    // The manor (54) and CV1's rooms: `tickHousehold`, `tickCity`, `tickForest`, `tickRuins`,
    // `tickRuinsInner`, behind the owners `tick` runs ahead of them.
    if (
      this.onFreeMap &&
      this.sceneId === 98 &&
      ((OPENING_ROOMS as readonly number[]).includes(this.roomIndex) ||
        (PREP_ROOMS as readonly number[]).includes(this.roomIndex) ||
        (ACADEMY_ROOMS as readonly number[]).includes(this.roomIndex))
    )
      return this.tickCauVongOpening(commands);
    // Rừng U Ám (38–40) and 60: `darkForest.source.priority` ahead of Lạc Khắc's chain (39), the
    // forest's `tick` (or the lab's) after it; these rooms walk under their owners.
    if (
      this.onFreeMap &&
      this.sceneId === 98 &&
      this.sources.cauVongForest &&
      (isForestRoom(this.roomIndex) ||
        this.roomIndex === LAB_ROOM ||
        this.roomIndex === LABORATORY_ROOM)
    ) {
      const forest = this.forest()!;
      if (
        (LOCKE_ROOMS as readonly number[]).includes(this.roomIndex) &&
        !forest.priority(this.fourGatesWorld(commands.includes("confirm")), this.roomIndex) &&
        this.tickCauVongLocke(commands)
      )
        return this.takeSaveRequest();
      return this.tickCauVongForest(commands);
    }
    // `lockeChain.tick` owns 52, 39 and 32 while it plays, fights or asks.
    if (
      this.onFreeMap &&
      this.sceneId === 98 &&
      (LOCKE_ROOMS as readonly number[]).includes(this.roomIndex) &&
      this.tickCauVongLocke(commands)
    )
      return this.takeSaveRequest();
    // The aux room 67 (`CauVongMissingBranchesRuntime`, reached from the North Sea's office 27).
    if (
      this.onFreeMap &&
      this.sceneId === 98 &&
      this.roomIndex === AUX_ROOM &&
      this.sources.cauVongBranches
    )
      return this.tickCauVongBranches(commands);
    // CV0': the summoners' hall 51 and the trial rooms 63–66 (`summoning.tick`, the walk, the doors).
    if (
      this.onFreeMap &&
      this.sceneId === 98 &&
      isSummonRoom(this.roomIndex) &&
      this.sources.cauVongSummoning
    )
      return this.tickCauVongSummonRoom(commands);
    // The city's side rooms (45, 46, 56; 45 and 56 while the North Sea has not marked them).
    if (this.onFreeMap && this.inCitySideRoom() && this.sources.cauVongCity)
      return this.tickCauVongCity(commands);
    // CV5: Bắc Hải (27–37, 45, 48, 53, 56, 61) walks under its owners; 45 and 56 only once a North
    // Sea door marked them (`sharedRoomActive`).
    if (
      this.onFreeMap &&
      this.sceneId === 98 &&
      this.sources.cauVongNorthSea &&
      (isNorthSeaRoom(this.roomIndex) || this.roomIndex === SKY_CITY_ROOM) &&
      northSeaShared(this.roomIndex, (room, event) =>
        this.eventState.sourceEventStateComplete(98, room, event),
      )
    )
      return this.tickCauVongNorthSea(commands);
    // `fourGateSource.tick` (52 after Lạc Khắc), then the room's walker (the south lever, the west
    // gate's lines); the walk, the routes and the encounters stay the free world's.
    if (
      this.onFreeMap &&
      this.sceneId === 98 &&
      isFourGateRoom(this.roomIndex) &&
      this.tickCauVongFourGates(commands)
    )
      return this.takeSaveRequest();
    // ... and Đại sảnh Cúp Cầu Vồng (`openingSource`, then `tickTournament`).
    if (this.onFreeMap && this.sceneId === 98 && this.roomIndex === CAU_VONG_HALL_ROOM)
      return this.tickCauVongHall(commands);
    if (this.onFreeMap && this.inRaceRoom) {
      // `NguyenMocC4RaceRuntime.tick`, ahead of the free world: time up, the finish, then Jill.
      const started = this.tickRaceRoom(commands);
      if (started) return null;
    }
    // `TanNguyetLongMaBossRuntime.tick` spends 5 within reach of the boss before the free world
    // reads it: the challenge, or the notice that refuses it.
    if (this.onFreeMap && this.challengeTanNguyet(commands)) return null;
    if (this.onFreeMap) {
      const before = this.probe(commands.includes("confirm"));
      if (before) return before;
      // A trigger that started an event group owns the rest of this tick. A chain link has neither a
      // position nor a key to spend, so scanning again here would restart the same group underneath
      // itself and hand `eventReturnPhase` the "event" phase it can never leave.
      if (!this.onFreeMap) return this.takeSaveRequest();
      // `VqsvSourceNpcDispatchFlow.firstRequested`: 5 on a town's service NPC.
      if (commands.includes("confirm") && this.startNpcService()) return null;
      // `tryStartChest`: 5 on a chest the room's runtime wires opens it.
      if (commands.includes("confirm") && this.startChest()) return null;
      // `tryRelicSwitches`: 5 on an unlit torch of a pending op59 group lights it.
      if (commands.includes("confirm") && this.startSwitch()) return null;
      // `VqsvSourceWorldObstacleRuntime.tick`, ahead of the movement it owns: the marker follows the
      // obstacles the hero faces, and 5 clears them.
      this.obstaclePromptIds = this.obstacleCandidates();
      if (commands.includes("confirm") && this.startObstacleCut()) return null;
      if (this.startHazardSpin()) return null;
      if (this.startGymHoleFall()) return null;
      if (this.inRaceRoom) this.touchRaceObstacle(commands);
      const moved = this.move(commands);
      if (this.inRaceRoom && this.race.active && this.inRaceFinish()) {
        this.finishRace();
        return null;
      }
      if (this.startHazardSpin()) return null;
      if (this.startGymHoleFall()) return null;
      if (this.enterRoomPortal()) return "autosave";
      if (this.startSwitch(true)) return null;
      if (this.afterFreeMovement(moved)) return null;
      const after = this.probe(false);
      if (after) return after;
      return this.takeSaveRequest();
    }
    return null;
  }
  pointer(x: number, y: number): void {
    // `clickGame`: a press anywhere confirms the boss's notice, and asks the defeat card to close.
    // The next tick closes it, so the save it asks for is not lost to the press.
    if (this.tanNguyetModal) {
      this.tanNguyetModal.dismissRequested = true;
      return;
    }
    if (this.repelPrompt) {
      const choice = this.repelPromptChoice;
      if (choice) {
        const at = centeredPoint(x, y),
          row = choiceRowAt(at.x, at.y, choice.options.length);
        if (row < 0) return;
        this.repelPrompt = { phase: "choice", index: row };
      }
      this.tick(["confirm"]);
      return;
    }
    if (this.phase === "battle") {
      this.battle?.pointer(x, y, this.inventory);
      return;
    }
    // `game.h` pointer: while an op35 box owns the frame, only a press on an option row does anything,
    // and that press both moves the cursor and is the confirm key. Anywhere else confirms.
    const choice = this.phase === "event" ? (this.event?.choice ?? null) : null;
    if (choice) {
      const at = centeredPoint(x, y),
        row = choiceRowAt(at.x, at.y, choice.options.length);
      if (row < 0) return;
      this.event!.moveChoice(row - choice.index);
    }
    // ProMax: a tap on the map picks the actor drawn under it rather than the one the hero faces.
    const mapTap = this.onFreeMap || (this.phase === "event" && !!this.event?.activationIds.length);
    if (mapTap) {
      const at = viewport.landscape ? landPoint(x, y) : { x, y };
      this.pointerActor = worldPointerTarget(
        this.actors.values(),
        at.x + this.cameraX,
        at.y + this.cameraY,
        (actor) => this.sources.pointerMask?.(actor) ?? null,
      );
    }
    try {
      if (this.tick(["confirm"]) === "autosave") this.saveRequested = true;
    } finally {
      this.pointerActor = undefined;
    }
  }
  saveSucceeded(): void {
    this.saveStatus = this.data.text.saveSuccess;
    this.setPhase("freeworld");
  }
  saveFailed(): void {
    this.saveStatus = "Lưu thất bại";
    this.saveSelected = 0;
    this.setPhase("savePrompt");
  }
  /** JavaSE `PanelDecisionService.useAvoidMonsterItem`, shared by the bag and expiry prompt. */
  useRepelItem(): "applied" | "active" | "forbidden" | "missing" {
    if (this.repelSteps > 0) return "active";
    if (this.sceneId === 3 && this.roomIndex === 7) return "forbidden";
    const key = String(REPEL_ID);
    if ((this.inventory[key] ?? 0) <= 0) return "missing";
    this.inventory[key]--;
    this.repelSteps = this.sources.bagItems?.consumable(REPEL_ID)?.columns[6] ?? 0;
    this.temporaryActorTicks = 0;
    return "applied";
  }

  private startRepelExpiryPrompt(): void {
    const hasItem = (this.inventory[String(REPEL_ID)] ?? 0) > 0;
    this.repelPrompt = {
      phase: "message",
      text: hasItem ? REPEL_EXPIRED : REPEL_EXHAUSTED,
      opensChoice: hasItem,
    };
  }

  private tickRepelPrompt(commands: readonly InputCommand[]): void {
    const prompt = this.repelPrompt;
    if (!prompt) return;
    if (prompt.phase === "message") {
      if (!commands.includes("confirm") && !commands.includes("back")) return;
      this.repelPrompt = prompt.opensChoice ? { phase: "choice", index: 0 } : null;
      return;
    }
    if (commands.includes("back")) {
      this.repelPrompt = null;
      return;
    }
    if (commands.includes("up") || commands.includes("left"))
      this.repelPrompt = { phase: "choice", index: Math.max(0, prompt.index - 1) };
    else if (commands.includes("down") || commands.includes("right"))
      this.repelPrompt = { phase: "choice", index: Math.min(1, prompt.index + 1) };
    else if (commands.includes("confirm")) {
      if (prompt.index !== 0) {
        this.repelPrompt = null;
        return;
      }
      const result = this.useRepelItem();
      if (result === "applied") this.repelPrompt = null;
      else
        this.repelPrompt = {
          phase: "message",
          text: result === "forbidden" ? REPEL_FORBIDDEN : REPEL_EXHAUSTED,
          opensChoice: false,
        };
    }
  }
  snapshot(): GameSave {
    this.savePoint = {
      scene: this.sceneId,
      room: this.roomIndex,
      x: this.player.x,
      y: this.player.y,
      direction: this.player.direction,
    };
    // Only the capture just won adds the bunny: a loaded save whose player has since let it go
    // (or a full party carried over from the Java build) is left as it is.
    if (this.bunnyJoinPending) {
      this.bunnyJoinPending = false;
      if (this.pets.length < 6 && !this.pets.some((pet) => pet.speciesId === this.data.opponent.id))
        this.pets.push(this.petFromSource(this.data.opponent, this.pets.length));
    }
    const elder = this.data.elderGroup,
      complete = elder
        ? this.eventState.sourceEventStateComplete(elder.scene, elder.room, elder.group)
        : this.phase === "complete";
    return {
      format: SAVE_FORMAT,
      version: CURRENT_SAVE_VERSION,
      savedAt: new Date().toISOString(),
      location: {
        sceneId: this.sceneId,
        roomIndex: this.roomIndex,
        x: this.player.x,
        y: this.player.y,
        direction: this.player.direction,
      },
      resume: {
        owner: complete
          ? SCENE1_RESUME.elderReturn
          : this.phase === "returnWorld"
            ? SCENE1_RESUME.bunnyReturnRoom0
            : SCENE1_RESUME.bunnyCapture,
      },
      progress: {
        activeTask: complete
          ? "SCENE1_COMPLETE"
          : this.objectiveComplete
            ? "RETURN_TO_ELDER"
            : this.flags.activeTask,
        mainTaskProgress: this.flags.mainTaskProgress,
      },
      story: {
        [SCENE1_STORY]: { bunnyCaught: this.objectiveComplete, elderComplete: complete },
      },
      world: this.flags.snapshot(),
      eventStates: this.eventState.snapshotStates(),
      inventory: {
        items: { ...this.inventory },
        equipment: [...this.bag.equipment],
        materials: { ...this.bag.materials },
        specials: [...this.bag.specials],
      },
      companionPetSlot: this.companionPetSlot,
      currency: { ...this.currency },
      collection: this.collection.snapshot(),
      playTimeMillis: this.playTimeMillis,
      repelSteps: this.repelSteps,
      pendingSkillLearns: this.pendingSkillLearns.map((entry) => ({ ...entry })),
      evolutionNoticeArmed: this.evolutionNoticeArmed,
      convenienceRewardsClaimed: this.collection.convenienceRewardsSnapshot(),
      meta: structuredClone(this.meta),
      pets: this.pets.map((pet) => ({
        ...pet,
        skillIds: [...(pet.skillIds ?? [])],
        skillPp: [...(pet.skillPp ?? [])],
      })),
    };
  }
  /**
   * A checkpoint shortcut for the state after the Elder's return dialog: it closes the group the
   * way its own op14 does. The task ladder is not touched here - the records that carry op45 write
   * it, in the tick their tip opens.
   */
  markComplete(): void {
    const elder = this.data.elderGroup;
    if (elder) this.eventState.op14CompleteEvent(elder.scene, elder.room, elder.group);
    this.setPhase("freeworld");
  }
  /** `sourceSetMainTaskProgress` for the ladder writes made by a cutscene runtime over this world. */
  setMainTaskProgress(progress: number): void {
    this.flags.setMainTaskProgress(progress);
  }

  /**
   * Java probes the free-world triggers before and after one player step, so a step
   * that lands inside an op13 rect starts the group on the same 66ms tick.
   */
  private probe(activation: boolean): WorldAction | null {
    const dispatch = this.dispatcher.probe(this.view(activation));
    if (!dispatch) return null;
    if (dispatch.kind === "door") return this.useDoor(dispatch.door);
    if (dispatch.kind === "room-door") return this.useRoomDoor(dispatch.door);
    if (dispatch.kind === "room-portal") return this.useRoomPortal(dispatch.portal);
    return this.startEvent(dispatch.trigger);
  }
  private view(activation: boolean): WorldView {
    return {
      scene: this.sceneId,
      room: this.roomIndex,
      x: this.player.x,
      y: this.player.y,
      direction: this.player.direction,
      activation,
      actorActivation:
        this.pointerActor === undefined
          ? undefined
          : (id) => {
              const actor = this.actors.get(id);
              return !!actor && this.actorInteractionRequested(actor);
            },
      actorAt: (id: number) => this.actors.get(id),
      facesActor: (id: number) => {
        const actor = this.actors.get(id);
        return !!actor && this.playerFaces(actor);
      },
      lit: (id: number) =>
        this.flags.hasSourceWorldFlag(switchFlag(this.sceneId, this.roomIndex, id)),
      challengePending: (id: number) => this.challengePending(id),
      supportsTarget: (scene: number, room: number) => !!this.sources.room(scene, room),
    };
  }
  private useDoor(door: SourceDoor): WorldAction | null {
    // `game.h` behavior4: a vortex leading into its own room spins the hero across it, no reload.
    if (
      door.behavior === 4 &&
      door.target.scene === this.sceneId &&
      door.target.room === this.roomIndex
    ) {
      const target = sourceDoors(this.sources.registry, this.sceneId, this.roomIndex).find(
        (candidate) => candidate.actorId === door.target.actor,
      );
      if (!target) return null;
      this.vortex = {
        from: door,
        to: target,
        phase: 0,
        enterTick: 0,
        exitCounter: VORTEX_SPIN_TICKS,
      };
      return null;
    }
    const target = this.sources.room(door.target.scene, door.target.room);
    if (!target) return null;
    if (this.sources.roomReady && !this.sources.roomReady(door.target.scene, door.target.room)) {
      this.sources.prepareRoom?.(door.target.scene, door.target.room);
      return null;
    }
    const arrival = transitionArrivalForTarget(this.sources.registry, target, door.target);
    if (!arrival) return null;
    this.dispatcher.markArrival(door);
    const from = { scene: this.sceneId, room: this.roomIndex };
    // `NiemThoC3Runtime.tryGymUpperSideExit`: once the gym leader is beaten, 9:2's side door (8)
    // puts the hero at the city gym door (92, 328), facing down, inside 4:5:g12's rect, so the
    // soldier who sends him to the airship base speaks at once.
    if (from.scene === 9 && from.room === 2 && door.actorId === 8 && this.postGymLeaderDefeated()) {
      this.loadRoom(4, 5, POST_GYM_CITY_EXIT.x, POST_GYM_CITY_EXIT.y, DIRECTION_DOWN);
      return null;
    }
    this.loadRoom(
      door.target.scene,
      door.target.room,
      arrival.x,
      arrival.y,
      arrival.direction,
      "entry",
    );
    this.reconcilePlatformArrival(from, door.target.actor);
    if (this.sceneId === 7 && this.roomIndex === 4) this.reconcilePlatformsForSide(false);
    return null;
  }
  /**
   * `CauVongFourGateRoutes.exitTo` then `CauVongChapterRuntime.transition`: the arrival is read from
   * the destination room's own table row, and the facing out of that doorway is the final facing.
   * Java arms the Liệt Hỏa arrival latch on the way in but its route owner never consults it, so
   * unlike `useDoor` there is nothing here to hold.
   */
  private useRoomDoor(door: RoomDoor): WorldAction | null {
    const { scene, room, entry } = door.target;
    if (this.sources.roomReady && !this.sources.roomReady(scene, room)) {
      this.sources.prepareRoom?.(scene, room);
      return null;
    }
    const row = roomDoorRow(this.sources.registry, scene, room, entry);
    if (!row) return null;
    const arrival = roomDoorArrival(row);
    this.loadRoom(scene, room, arrival.x, arrival.y, arrival.direction, "entry");
    return null;
  }
  /**
   * The other half of the same route owner: a `PORTALS` pad warps to an explicit tile in the
   * destination room rather than to another door row, so the arrival is already in pixels and needs
   * no facing maths. Java's `transition` drops the player into the room facing down and the pad's own
   * direction column then wins, which is the facing stored on the row.
   */
  private useRoomPortal(portal: RoomPortal): WorldAction | null {
    const { scene, room } = portal.target;
    if (this.sources.roomReady && !this.sources.roomReady(scene, room)) {
      this.sources.prepareRoom?.(scene, room);
      return null;
    }
    this.loadRoom(
      scene,
      room,
      portal.arrival.x,
      portal.arrival.y,
      portal.arrival.direction,
      "entry",
    );
    return null;
  }
  private startEvent(trigger: WorldEventTrigger): WorldAction | null {
    const group = trigger.group;
    if (sameGroup(group, this.data.battleGroup)) {
      this.activeBattleGroup = group;
      this.battle = this.createBattle();
      this.prepareBattleSprites(this.battle);
      this.markEnemiesSeen(this.battle);
      // `BattleEntryTransitionThenRuntime(..., request.mode().backgroundMode)`: op32's second word.
      this.nextBattleEntryMode = this.battle.context.mode[1] ?? 0;
      this.setPhase("battleEntry");
      return null;
    }
    // A source battle the group declares is fought on the world's own battle screen (a gym's 2v2 on
    // the 2v2 engine); a group whose fight has no descriptor or A2 row does not start.
    const battleActor = worldGroupBattleActor(this.sources.registry, group);
    if (battleActor !== null) {
      const services = this.sources.battle;
      if (!services || unsupportedEventBattle(services, group, battleActor)) return null;
    }
    this.runEvent(group);
    return null;
  }
  /** A runtime's own short script (`WorldEventRuntime` script) played like an event group. */
  private startScript(ref: GroupRef, id: string, events: RuntimeStoryEvent[]): void {
    this.runEvent(ref, { id, events });
  }
  private runEvent(group: GroupRef, script?: { id: string; events: RuntimeStoryEvent[] }): void {
    // `XhtC3Runtime.startEvent`: an event ends any slide.
    this.iceDirection = null;
    this.eventReturnPhase = this.phase;
    this.player.state = WorldRuntime.facingState(this.player.direction);
    this.event = new WorldEventRuntime(
      group,
      this.sources.registry,
      {
        room: (scene, room) => this.sources.room(scene, room),
        animationTicks: this.sources.animationTicks,
        dialogPages: this.sources.dialogPages,
        taskProgress: (flag) => this.flags.setMainTaskProgress(flag),
        itemName: (itemId, table) =>
          table === 3
            ? (itemId < 12
                ? this.sources.bagItems?.equipment(itemId)
                : this.sources.bagItems?.material(itemId)
              )?.name
            : table === 5
              ? this.sources.bagItems?.specialItem(itemId)?.name
              : this.data.itemCatalog?.find((item) => item.id === itemId)?.name,
        battleHost: (context) => this.startEventBattle(group, context),
        grantPet: (pet) => this.grantSourcePet(pet),
        setBranchTask: (task, status) => {
          const kind = status === 1 ? "offer" : "completion";
          if (this.sources.branchTasks?.matches(task, kind, group))
            this.sources.branchTasks.set(task, status);
        },
        grantBadge: (badgeId) => {
          this.flags.badges.grant(badgeId);
          if (this.presentsPanels) this.badgeAward = { badgeId, shown: false };
        },
        badgeAwardOpen: () => this.badgeAward !== null,
        openTaskOption: (task, options) => {
          if (!this.presentsPanels) return false;
          this.taskOption = { task, options, shown: false, answer: null };
          return true;
        },
        taskOptionAnswer: () => {
          const option = this.taskOption;
          if (!option || option.answer === null) return null;
          this.taskOption = null;
          return option.answer;
        },
        refreshPets: () => this.refreshPets(),
        unlockSourceFeature: (feature) => this.flags.op66UnlockFeature(feature),
        mutateSourceFlag: (mode, flag) => this.flags.mutateSourceWorldFlag(mode, flag),
        // op84 counter 0, Jones: species found and still missing (`PetCollectionProgression`).
        sourceCounts: (counter) => {
          const collected = this.collection.collectedSpeciesCount();
          return counter === 0 ? [collected, Math.max(0, SPECIES_COUNT - collected)] : ["", ""];
        },
        canPay: (amount) => this.currency.money >= amount,
        petStorageFull: () =>
          this.pets.length >= 6 && this.meta.campaign.petBank.length >= this.petBankCapacity(),
        worldHook: (hook, elapsed) =>
          hook.startsWith("cauVong.")
            ? this.cauVongHook(hook, elapsed)
            : this.raceHook(hook, elapsed),
      },
      this.eventState,
      this.eventEffects(),
      this.player,
      this.sources.routePatches,
      script,
    );
    this.applySettledStates(this.event.scene.actors);
    // Cầu Vồng's boxes and cutscenes play over the world's cast (`CauVongChapterRuntime` never
    // reloads it), so the reloaded room takes on where cues and `applyCast` left each actor.
    if (group.scene === 98) this.copyWorldCast(this.event.scene.actors);
    this.setPhase("event");
  }
  /**
   * The fight one event group's op32 declares. It belongs to the world's battle screen, not to the
   * scene: `startEventBattle` returns true to park the group on its op32 record, and when the fight
   * ends the finished battle is handed back so op47 reads the result and the group's own records —
   * the reward text, the items, the task step, the ledger write — play in order.
   */
  private startEventBattle(
    group: GroupRef,
    context: BattleContext,
  ): boolean | HostedBattleResolution {
    const services = this.sources.battle;
    if (!services) return false;
    const doubleSymbol = doubleEventBattleSymbol(services, group, context.actorId, this.pets);
    if (doubleSymbol) return this.startDoubleBattle(services, group, context, doubleSymbol);
    this.activeBattleGroup = group;
    this.battle = createEventBattle(
      services,
      group,
      context,
      this.pets,
      this.inventory,
      this.battleItemCatalog(),
      {
        playerActorSpriteId: this.player.sprite,
        enemyActorSpriteId: this.actors.get(context.actorId)?.sprite ?? 0,
      },
      (trainerOwned) => this.battleCharms(trainerOwned),
      this.currency,
    );
    this.prepareBattleSprites(this.battle);
    this.markEnemiesSeen(this.battle);
    this.battleEncounter = eventBattleEncounter(services, group, context.actorId);
    // `BattleEntryTransitionThenRuntime(..., request.mode().backgroundMode)`: op32's second word.
    this.nextBattleEntryMode = context.mode[1] ?? 0;
    this.setPhase("battleEntry");
    return true;
  }

  /** The gym 2v2 on screen (`VqsvDoubleBattleRuntime`), while one is up. */
  doubleBattle: DoubleBattleRuntime | null = null;
  private doubleContext: BattleContext | null = null;
  /**
   * A gym NPC's simultaneous 2v2 (`VqsvDoubleBattleEventDescriptor.request`): the same entry wipe as
   * any fight, then the 2v2 screen. The group stays parked on op32 until `tickDoubleBattle` answers.
   */
  private startDoubleBattle(
    services: BattleServices,
    group: GroupRef,
    context: BattleContext,
    symbol: string,
  ): true {
    const battle = createDoubleBattle(
      services,
      symbol,
      this.pets,
      this.inventory,
      this.battleItemCatalog(),
      (sprite) => this.sources.doubleFallTicks?.(sprite) ?? 8,
      (trainerOwned) => this.battleCharms(trainerOwned),
    );
    this.activeBattleGroup = group;
    this.doubleBattle = battle;
    this.doubleContext = context;
    this.battleEncounter = eventBattleEncounter(services, group, context.actorId);
    for (const sprite of battle.core.spriteIds()) this.sources.prepareSprite?.(sprite);
    for (const slot of [0, 1] as const)
      this.collection.markSeen(battle.core.setupOf(slot).speciesId);
    // `BattleEntryTransitionThenRuntime(..., request.mode().backgroundMode)`: op32's second word.
    this.nextBattleEntryMode = context.mode[1] ?? 0;
    this.setPhase("battleEntry");
    return true;
  }
  /**
   * One tick of the 2v2, and its end (`VqsvDoubleBattleRuntime.finish`): the roster is written back
   * and, on a win, the EXP with its level-ups and the NPC's reward; op47 then reads result 0 (won)
   * and the group's own records play. A loss revives the party and leaves the group open, as a lost
   * 1v1 gym fight does (Thiên Giới's clouds reset and the hero returns to its door).
   */
  private tickDoubleBattle(
    battle: DoubleBattleRuntime,
    commands: InputCommand[],
  ): WorldAction | null {
    battle.handleInput(commands);
    battle.tick();
    if (!battle.finished) return null;
    if (this.bondingTowerRun) return this.finishBondingTowerBattle(battle.winner === "player");
    const services = this.sources.battle!,
      settlement = settleDoubleBattle(battle.core, this.pets, this.inventory, services.progression),
      won = settlement.winner === "player",
      context = this.doubleContext,
      group = this.activeBattleGroup;
    // `cauVongIncubation.advanceExperience(var2)`: the owners' direct EXP.
    advanceCauVongIncubation(this.cauVongIncubation, settlement.direct);
    for (const [petSlot, member] of settlement.members.entries())
      for (const skillId of member.levelUp.pending)
        if (!this.pendingSkillLearns.some((e) => e.petSlot === petSlot && e.skillId === skillId))
          this.pendingSkillLearns.push({ petSlot, skillId });
    const row = this.battleEncounter;
    this.battleEncounter = undefined;
    if (won) {
      const money = npcVictoryMoney(row);
      if (money !== null) this.currency.money = Math.max(0, this.currency.money + money);
    }
    const pass = this.sources.battlePass;
    if (pass) {
      const id = `battle-${this.sceneId}-${this.roomIndex}-${this.tickCount}`;
      applyBattlePassEvent(
        pass,
        this.meta.battlePass,
        { id: `${id}-complete`, type: "BATTLE_COMPLETED" },
        Date.now(),
      );
      if (won)
        applyBattlePassEvent(
          pass,
          this.meta.battlePass,
          { id: `${id}-win`, type: "BATTLE_WON" },
          Date.now(),
        );
    }
    if (group) this.lastBattle = { ...group, won };
    this.doubleBattle = null;
    this.doubleContext = null;
    this.activeBattleGroup = null;
    if (this.tanNguyetBattle) {
      this.tanNguyetBattle = false;
      this.finishTanNguyetBattle(won);
      this.setPhase("freeworld");
      return "autosave";
    }
    if (!won || !this.event || !context) {
      this.event = null;
      if (this.sceneId === 9 && this.roomIndex === 7) this.retryGymFromDoor(5, [0, 1, 2, 3, 4]);
      if (this.sceneId === 9 && this.roomIndex === 0 && !won)
        this.retryGymFromDoor(23, BICH_THUY_GYM_LEAVES);
      this.setPhase("freeworld");
      return "autosave";
    }
    this.event.scene.finishHostedBattle({
      result: 0,
      branch: context.branchTargets[0] ?? -1,
      reason: "SIMULTANEOUS_2V2",
    });
    this.setPhase("event");
    return null;
  }

  /**
   * `TanNguyetLongMaBossRuntime.tick` / `prepareForRender`: in the boss room, while the hero walks
   * the map, the boss stands on the statue's spot (the statue hidden) idling in state 0. Anywhere
   * else, or under a fight, it is not drawn.
   */
  private tickTanNguyetBoss(): void {
    const boss = this.actors.get(TAN_NGUYET_ACTOR_ID);
    if (!boss) return;
    // While an event group runs in this room it owns the drawn actors and the hero: Java's
    // `scene.actors` and `scene.player` are then the group's, so the boss reads and hides those.
    const event = this.phase === "event" ? this.event : null,
      eventActors =
        event && event.scene.sceneId === this.sceneId && event.scene.roomIndex === this.roomIndex
          ? event.scene.actors
          : null;
    event?.scene.actors.delete(TAN_NGUYET_ACTOR_ID);
    const hero = eventActors?.get(-1) ?? this.player,
      bossRoom = isTanNguyetBossRoom(this.sceneId, this.roomIndex, this.actors.values()),
      available = (this.onFreeMap || eventActors !== null) && hero.visible;
    boss.visible = bossRoom && available;
    if (!boss.visible) return;
    const anchor = tanNguyetStatueAnchor(this.sceneId, this.roomIndex, this.actors.values());
    Object.assign(boss, tanNguyetBossPosition(anchor));
    if (boss.state !== 0) {
      boss.state = 0;
      boss.animationTick = 0;
    }
    if (anchor) anchor.visible = false;
    if (!eventActors) return;
    const eventAnchor = tanNguyetStatueAnchor(this.sceneId, this.roomIndex, eventActors.values());
    if (eventAnchor) eventAnchor.visible = false;
    // The group draws its own actor map: the boss stands in it as the world's copy of this tick.
    eventActors.set(TAN_NGUYET_ACTOR_ID, { ...boss });
  }
  /**
   * 5 within 34 px of the boss: once beaten it refuses for good; otherwise `challengeBlockReason`
   * (six pets, all level 50) either opens the fight or a notice. True when 5 was spent here.
   */
  private challengeTanNguyet(commands: readonly InputCommand[]): boolean {
    if (!commands.includes("confirm")) return false;
    const boss = this.actors.get(TAN_NGUYET_ACTOR_ID);
    if (
      !boss?.visible ||
      !withinTanNguyetReach(this.player, boss) ||
      (this.pointerActor !== undefined && this.pointerActor !== boss.id)
    )
      return false;
    const block = this.flags.hasSourceWorldFlag(TAN_NGUYET_BOSS.victoryCompletedFlag)
      ? TAN_NGUYET_WORLD_TEXT.alreadyDefeated
      : tanNguyetChallengeBlock(this.pets);
    if (block === null) return this.startTanNguyetBattle();
    this.tanNguyetModal = { kind: "notice", text: block, markSeen: false, dismissRequested: false };
    return true;
  }
  /**
   * `TanNguyetLongMaBossRuntime.startBattle`: battle entry effect 6, then the Ma Mộc Cộng Sinh 2v2
   * (Hoa Tiên Tử and the boss at level 50, the player commanding both of its slots).
   */
  private startTanNguyetBattle(): boolean {
    const services = this.sources.battle;
    if (!services) return false;
    const battle = createTanNguyetBattle(
      services,
      this.pets,
      this.inventory,
      this.battleItemCatalog(),
      (sprite) => this.sources.doubleFallTicks?.(sprite) ?? 8,
      (trainerOwned) => this.battleCharms(trainerOwned),
    );
    this.doubleBattle = battle;
    this.doubleContext = null;
    this.activeBattleGroup = null;
    this.battleEncounter = undefined;
    this.tanNguyetBattle = true;
    for (const sprite of battle.core.spriteIds()) this.sources.prepareSprite?.(sprite);
    for (const slot of [0, 1] as const)
      this.collection.markSeen(battle.core.setupOf(slot).speciesId);
    // `TanNguyetLongMaBossRuntime`: `Mode(0, 2)`, the alternating columns.
    this.nextBattleEntryMode = 2;
    this.setPhase("battleEntry");
    this.tickTanNguyetBoss();
    return true;
  }
  /**
   * The end of the boss fight (`VqsvDoubleBattleRuntime.resolveNpcVictoryReward` with the
   * `withNpcVictoryReward(50000)` override, `TanNguyetLongMaVictoryRewardRuntime.grantExtras`, then
   * `BattleThenResumeWorldRuntime`): a win pays and opens the reward notice, a loss the defeat card.
   */
  finishTanNguyetBattle(won: boolean): void {
    if (!won) {
      this.tanNguyetModal = { kind: "defeat", ticks: 0, dismissRequested: false };
      return;
    }
    this.currency.money = Math.max(0, this.currency.money + TAN_NGUYET_BOSS.victoryMoney);
    this.currency.badges = Math.min(
      2147483647,
      this.currency.badges + TAN_NGUYET_BOSS.victoryBadges,
    );
    const bank = this.meta.campaign.petBank,
      reward = this.buildSourcePet(
        TAN_NGUYET_BOSS.victoryPetSpeciesId,
        TAN_NGUYET_BOSS.victoryPetLevel,
        TAN_NGUYET_BOSS.victoryPetQuality,
        TAN_NGUYET_BOSS.victoryPetNature,
        bank.length,
        [],
      );
    bank.push(reward);
    this.synchronizeGoldenBankReward();
    this.collectOwned(reward);
    this.flags.mutateSourceWorldFlag(0, TAN_NGUYET_BOSS.victoryCompletedFlag);
    this.resumeAfterBattle();
  }
  /**
   * `BattleThenResumeWorldRuntime.resumeAfterBattle`, which ends the boss fight and a gamemenu
   * rematch alike: while the boss is beaten and its reward notice unread (`victoryNoticePending`,
   * flags 910044 without 910045 — say a save taken before it was read), the notice opens again.
   */
  private resumeAfterBattle(): void {
    if (
      this.tanNguyetModal ||
      !this.flags.hasSourceWorldFlag(TAN_NGUYET_BOSS.victoryCompletedFlag) ||
      this.flags.hasSourceWorldFlag(TAN_NGUYET_BOSS.victoryNoticeSeenFlag)
    )
      return;
    this.tanNguyetModal = {
      kind: "notice",
      text: TAN_NGUYET_WORLD_TEXT.victory,
      markSeen: true,
      dismissRequested: false,
    };
  }
  /**
   * A notice closes on 5 (the reward notice then marks itself read); the defeat card waits
   * `MINIMUM_TICKS` and closes on 5, 0 or a press, and the world resumes as after any lost fight:
   * the party already revived, the hero back at the save point.
   */
  private tickTanNguyetModal(commands: readonly InputCommand[]): WorldAction {
    const modal = this.tanNguyetModal!;
    if (modal.kind === "notice") {
      if (!modal.dismissRequested && !commands.includes("confirm")) return null;
      this.tanNguyetModal = null;
      if (!modal.markSeen) return null;
      this.flags.mutateSourceWorldFlag(0, TAN_NGUYET_BOSS.victoryNoticeSeenFlag);
      return "autosave";
    }
    modal.ticks++;
    if (
      modal.ticks < TAN_NGUYET_DEFEAT_MIN_TICKS ||
      !(modal.dismissRequested || commands.includes("confirm") || commands.includes("back"))
    )
      return null;
    this.tanNguyetModal = null;
    const point = this.savePoint;
    this.loadRoom(point.scene, point.room, point.x, point.y, point.direction, "resume");
    this.setPhase("freeworld");
    return "autosave";
  }
  /** db.mid group 4, which is the catalog Java's P11 battle shop iterates. */
  private battleItemCatalog(): SourceItemData[] {
    const source = this.sources.bagItems?.document.consumables;
    if (!source?.length) return this.data.itemCatalog ?? [];
    return source.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      iconCell: item.icon,
      behavior: item.columns[5] ?? 0,
      paramA: item.columns[3] ?? 0,
      paramB: item.columns[4] ?? 0,
      paramC: item.columns[6] ?? 0,
    }));
  }

  private bondingTowerRun: {
    returnPhase: "freeworld" | "returnWorld";
    onResult: (won: boolean) => void;
  } | null = null;

  get bondingTowerBattleActive(): boolean {
    return this.bondingTowerRun !== null;
  }

  startBondingTower(
    floor: TowerFloor,
    pets: Readonly<Record<string, TowerPetSpec>>,
    onResult: (won: boolean) => void,
  ): boolean {
    const services = this.sources.battle;
    if (
      !services ||
      !this.onFreeMap ||
      this.mapLoading ||
      this.npcService ||
      this.tanNguyetModal ||
      this.repelPrompt ||
      this.raceBlocksPanel ||
      this.cauVongMinigameOpen ||
      this.switchCycle ||
      this.obstacleCut ||
      this.hazardSpin ||
      this.vortex ||
      !this.pets.some((pet) => (pet.currentHp ?? 1) > 0) ||
      (floor.double && this.pets.length < 2)
    )
      return false;
    const battle = createBondingTowerBattle(
      services,
      floor,
      pets,
      this.pets,
      this.player.sprite,
      (sprite) => this.sources.doubleFallTicks?.(sprite) ?? 8,
      this.battleCharms(false),
    );
    this.bondingTowerRun = {
      returnPhase: this.phase === "returnWorld" ? "returnWorld" : "freeworld",
      onResult,
    };
    this.battle = battle.single ?? null;
    this.doubleBattle = battle.double ?? null;
    if (battle.single) this.prepareBattleSprites(battle.single);
    if (battle.double)
      for (const sprite of battle.double.core.spriteIds()) this.sources.prepareSprite?.(sprite);
    this.setPlayerFacing(false, true);
    this.nextBattleEntryMode = 2;
    this.setPhase("battleEntry");
    return true;
  }

  private finishBondingTowerBattle(won: boolean): WorldAction {
    const run = this.bondingTowerRun!;
    this.battle = null;
    this.doubleBattle = null;
    this.bondingTowerRun = null;
    this.setPhase(run.returnPhase);
    run.onResult(won);
    return "autosave";
  }

  /** A gamemenu rematch: authored roster/AI, but no room-script reward or ledger owner. */
  startRegionalRematch(rematch: RegionalRematch): boolean {
    const services = this.sources.battle;
    if (!services || this.phase !== "freeworld" || this.pets.length === 0) return false;
    const created = createRepeatableBattle(
      services,
      rematch.descriptor,
      this.pets,
      this.inventory,
      this.battleItemCatalog(),
      { playerActorSpriteId: this.player.sprite, enemyActorSpriteId: 0 },
      (trainerOwned) => this.battleCharms(trainerOwned),
      this.currency,
    );
    this.battle = created.battle;
    this.prepareBattleSprites(this.battle);
    this.battleEncounter = created.encounter;
    this.repeatableBattle = true;
    this.repeatableRewardMoney = rematch.rewardMoney;
    this.markEnemiesSeen(this.battle);
    // `VqsvPanelRuntime`'s rematch: `request.mode().backgroundMode` of the descriptor.
    this.nextBattleEntryMode = this.battle.context.mode[1] ?? 0;
    this.setPhase("battleEntry");
    return true;
  }
  /** The A2 row of the event fight in progress (`aiV2Encounter`), for its victory reward. */
  private battleEncounter: PackBattleAiEncounterRow | undefined;
  /**
   * `resolveNpcVictoryReward`, once per won fight: an authored NPC pays by difficulty; otherwise a
   * WILD encounter pays by the enemy's level and stars and may drop one badge. A catch, a flight
   * or a loss pays nothing.
   */
  private payVictoryReward(battle: BattleRuntime): void {
    const row = this.battleEncounter;
    this.battleEncounter = undefined;
    const repeatableReward = this.repeatableRewardMoney;
    this.repeatableRewardMoney = null;
    const outcome = battle.outcome;
    if (
      !outcome ||
      outcome.winner !== "player" ||
      outcome.reason === "catch" ||
      outcome.reason === "run"
    )
      return;
    if (repeatableReward !== null) {
      this.currency.money = Math.max(0, this.currency.money + repeatableReward);
      return;
    }
    if (this.wildBattle && battle.core) {
      const enemy = battle.core.enemySetup(battle.core.activeMember("enemy"));
      this.currency.money = Math.max(
        0,
        this.currency.money + wildVictoryMoney(enemy.level, enemy.quality),
      );
      this.currency.badges = this.wildVictoryBadgeTotal();
      return;
    }
    const npc = npcVictoryMoney(row);
    if (npc !== null) {
      this.currency.money = Math.max(0, this.currency.money + npc);
      return;
    }
    const core = battle.core;
    if (!isWildEncounter(row) || !core) return;
    const enemy = core.enemySetup(core.activeMember("enemy"));
    this.currency.money = Math.max(
      0,
      this.currency.money + wildVictoryMoney(enemy.level, enemy.quality),
    );
    this.currency.badges = this.wildVictoryBadgeTotal();
  }
  /** A wild win's badges: the source's roll, plus 1 with Long Vương Hộ Phù held (ProMax). */
  private wildVictoryBadgeTotal(): number {
    return Math.min(
      0x7fffffff,
      this.currency.badges +
        wildVictoryBadges(this.sourceRandom.next("battle.wildVictory.badge", 100)) +
        (this.kimDiemAmuletEquipped() ? 1 : 0),
    );
  }
  /**
   * `VqsvBattleRuntime` start: every species of the enemy party is seen; a shiny also its nature and
   * the colour it is drawn in.
   */
  private markEnemiesSeen(battle: BattleRuntime): void {
    const core = battle.core;
    if (!core) return;
    for (let member = 0; member < core.partySize("enemy"); member++) {
      const setup = core.enemySetup(member),
        color =
          setup.shinyColor ?? defaultShinyColor(setup.spriteId ?? setup.speciesId, setup.nature);
      this.collection.markSeen(setup.speciesId, setup.nature, color);
    }
  }
  /**
   * op18 mode 0, `game.j.c(id, n, 2)`: an equipment id (below 12) is owned once; a material adds
   * its count, the golden key five per unit.
   */
  private grantGear(itemId: number, quantity: number): void {
    if (itemId < FIRST_MATERIAL_ID) {
      if (!this.bag.equipment.includes(itemId)) this.bag.equipment.push(itemId);
      return;
    }
    const add = itemId === GOLDEN_KEY_ID ? quantity * 5 : quantity;
    this.bag.materials[String(itemId)] = (this.bag.materials[String(itemId)] ?? 0) + add;
  }
  /** `op39RefreshPets`: revive the roster and refill every learned skill's PP. */
  private refreshPets(): void {
    for (const pet of this.pets) {
      pet.currentHp = towerBondStat(
        this.sources.petStats.coreStats(pet.speciesId, pet.level, pet.quality, pet.nature ?? 0).hp,
        pet.towerBond,
      );
      pet.skillPp = (pet.skillIds ?? []).map(
        (skillId) => this.sources.battleRules.damage.skillRow(skillId)?.ppMax ?? 0,
      );
    }
  }
  private eventEffects(): WorldEventEffects {
    return {
      grantItem: (itemId, quantity, table = 4) => {
        if (table === 3) this.grantGear(itemId, quantity);
        else if (table === 5) {
          // op19, `game.j.j(id)`: a special item is held once — except an egg, which stacks
          // (`SpecialRewardState.quantity`): Jones' exchange hands one over every time.
          const egg = this.sources.campaignSystems?.eggs.some((row) => row.itemId === itemId);
          if (egg) for (let i = 0; i < Math.max(1, quantity); i++) this.bag.specials.push(itemId);
          else if (!this.bag.specials.includes(itemId)) this.bag.specials.push(itemId);
        } else this.inventory[String(itemId)] = (this.inventory[String(itemId)] ?? 0) + quantity;
      },
      consumeItem: (itemId, quantity, table = 4) => {
        if (table === 3) {
          if (itemId < FIRST_MATERIAL_ID) {
            const at = this.bag.equipment.indexOf(itemId);
            if (at >= 0) this.bag.equipment.splice(at, 1);
          } else
            this.bag.materials[String(itemId)] = Math.max(
              0,
              (this.bag.materials[String(itemId)] ?? 0) - quantity,
            );
        } else if (table === 5) {
          const at = this.bag.specials.indexOf(itemId);
          if (at >= 0) this.bag.specials.splice(at, 1);
        } else
          this.inventory[String(itemId)] = Math.max(
            0,
            (this.inventory[String(itemId)] ?? 0) - quantity,
          );
      },
      requestSave: () => {
        this.saveRequested = true;
      },
      adjustCurrency: (kind, amount) => {
        if (kind === 0) this.currency.money += amount;
        else if (kind === 1) this.currency.badges += amount;
      },
    };
  }
  /**
   * op36/op87 mode 0: the story hands over a Pet. `PetSourceAdapter.create` resolves the quality, and under the
   * unified skill profile the species' learnset at that level replaces the record's two skill args —
   * which is what every other new pet in the web build is built from. Java clamps the slot into the
   * roster, renumbers every slot after it, and the box that follows names the catalog's species.
   */
  private grantSourcePet(grant: GrantedPet): string {
    const requestedSlot = grant.slot,
      slot = Math.max(0, Math.min(requestedSlot ?? this.pets.length, this.pets.length)),
      owned = this.buildSourcePet(
        grant.speciesId,
        grant.level,
        grant.quality,
        grant.nature,
        slot,
        grant.skillIds,
      ),
      species = this.sources.petStats.speciesRow(grant.speciesId)!;
    if (requestedSlot === undefined && this.pets.length >= 6) {
      // Guaranteed story rewards are never discarded. Java's RELEASE overflow is retained in the
      // bank too; it is only reported with sourceResult=1 to the surrounding script.
      owned.slot = this.meta.campaign.petBank.length;
      this.meta.campaign.petBank.push(owned);
      this.synchronizeGoldenBankReward();
    } else {
      this.pets.splice(slot, 0, owned);
      this.pets.forEach((inserted, index) => (inserted.slot = index));
    }
    this.collectOwned(owned);
    return species.name;
  }
  /**
   * `PetSourceAdapter.create(slot, species, level, quality, nature, …)`: the quality resolved, the
   * unified learnset at that level (else `fallbackSkills`) at full PP, and a rolled thiên phú.
   */
  private buildSourcePet(
    speciesId: number,
    level: number,
    requestedQuality: number,
    nature: number,
    slot: number,
    fallbackSkills: readonly number[],
  ): SavedPet {
    const species = this.sources.petStats.speciesRow(speciesId);
    if (!species)
      throw new Error(`A source pet grant names species ${speciesId}, which the pack lacks`);
    const progression = this.sources.battle?.progression,
      initial = progression ? progression.initialSkills(species.speciesId, level) : [],
      skillIds = initial.length ? initial : [...fallbackSkills],
      quality = this.sources.petStats.resolveQuality(species.speciesId, requestedQuality),
      owned = this.petFromSource(
        {
          id: species.speciesId,
          name: species.name,
          level,
          quality,
          nature,
          element: species.element,
          spriteId: species.spriteId,
          maxHp: this.sources.petStats.coreStats(species.speciesId, level, quality, nature).hp,
        },
        slot,
      );
    owned.skillIds = skillIds;
    owned.skillPp = skillIds.map((id) => this.sources.battleRules.damage.skillRow(id)?.ppMax ?? 0);
    return owned;
  }
  /** The interactive battle frame replaces the group's op32 records, so its ledger records are applied here. */
  private completeBattleGroup(): void {
    const group = this.activeBattleGroup;
    if (!group) return;
    this.activeBattleGroup = null;
    const writes = worldGroupLedgerWrites(this.sources.registry, group);
    for (const write of writes) {
      if (write.kind === "markComplete")
        this.eventState.op23MarkEventComplete(write.ref.scene, write.ref.room, write.ref.group);
      else if (write.kind === "completeOwn")
        this.eventState.op14CompleteEvent(group.scene, group.room, group.group);
      else this.eventState.op42RepeatEvent(group.scene, group.room, group.group);
    }
  }
  /** op56/op29/op10 records move the room's own actors, so the world mirrors them each tick. */
  private syncEventActors(): void {
    const event = this.event;
    if (!event) return;
    for (const [id, actor] of event.scene.actors) {
      // The hero is not a script-owned actor: the group walks around in the world's own record, so
      // there is nothing to copy back for him.
      if (id === -1) continue;
      // The boss is the world's actor, lent to the group's map for drawing only.
      if (id === TAN_NGUYET_ACTOR_ID) continue;
      const world = this.actors.get(id);
      if (!world) {
        this.actors.set(id, { ...actor });
        continue;
      }
      world.x = actor.x;
      world.y = actor.y;
      world.visible = actor.visible;
      world.state = actor.state;
      world.direction = actor.direction;
      world.animationTick = actor.animationTick;
      // A Cầu Vồng cue turns and mirrors the cast (`setSourceRenderOrientation`).
      if (this.sceneId === 98) world.renderOrientation = actor.renderOrientation;
    }
  }
  private takeSaveRequest(): WorldAction | null {
    if (!this.saveRequested) return null;
    this.saveRequested = false;
    return "autosave";
  }

  private createBattle(): BattleRuntime {
    const services = this.sources.battle;
    if (services) return this.createCoreBattle(services);
    const active = this.pets[0],
      definition = createCaptureTutorialBattleDefinition(this.data, active, {
        player: this.sources.petStats.coreStats(
          active.speciesId,
          active.level,
          active.quality,
          active.nature ?? 0,
        ),
        opponent: this.petStats(this.data.opponent),
      }),
      registry = new BattleDefinitionRegistry([definition]),
      source = this.data.encounter;
    return new BattleRuntime(
      {
        actorId: source.actorId,
        encounter: source.request,
        flags: source.flags,
        mode: source.mode,
        branchTargets: source.branchTargets,
      },
      registry,
      this.sources.battleRules,
      active,
      this.data.player.skills ?? [],
      this.battleItemCatalog(),
    );
  }
  /**
   * The bunny on the battle core: the whole party against the encounter pet, AI v2 over the basic AI
   * for the enemy, and the tutorial's script on top — the bunny cannot be knocked out (it has to stay
   * catchable) and the first Phong ấn cầu always misses, so the Tất Trung Cầu lesson still plays.
   */
  private createCoreBattle(services: BattleServices): BattleRuntime {
    const living = this.pets.find((pet) => (pet.currentHp ?? 1) > 0) ?? this.pets[0],
      definition = createCaptureTutorialBattleDefinition(this.data, living, {
        player: this.sources.petStats.coreStats(
          living.speciesId,
          living.level,
          living.quality,
          living.nature ?? 0,
        ),
        opponent: this.petStats(this.data.opponent),
      }),
      registry = new BattleDefinitionRegistry([definition]),
      source = this.data.encounter,
      opponent = this.data.opponent,
      inventory: Record<number, number> = {};
    for (const [id, count] of Object.entries(this.inventory)) inventory[Number(id)] = count;
    const core = services.newCore(
      {
        format: "1v1",
        kind: "wild",
        player: this.pets.map((pet) =>
          services.partyMember(
            pet,
            pet.speciesId === this.data.player.id
              ? this.data.player.name
              : pet.speciesId === opponent.id
                ? opponent.name
                : undefined,
          ),
        ),
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
              fallbackSkills: (opponent.skills ?? []).map((skill) => skill.id),
            },
          ),
        ],
        inventory,
        script: {
          unkillable: "enemy",
          // The lesson's first Phong ấn cầu always misses; a Tất Trung Cầu (thrown first when the
          // seal balls are gone) keeps its 100%.
          forcedCatch: (attempt, itemId) =>
            attempt === 1 && itemId !== this.data.items.guaranteedBall ? false : undefined,
        },
      },
      source.descriptor,
    );
    return new BattleRuntime(
      {
        actorId: source.actorId,
        encounter: source.request,
        flags: source.flags,
        mode: source.mode,
        branchTargets: source.branchTargets,
      },
      registry,
      this.sources.battleRules,
      undefined,
      this.data.player.skills ?? [],
      this.battleItemCatalog(),
      {
        core,
        party: this.pets,
        services,
        settle: () =>
          settleBattle(core, this.pets, this.inventory, services.progression, services.petBank?.()),
        shopCurrency: this.currency,
      },
    );
  }
  private normalizePet(pet: SavedPet, index: number): SavedPet {
    const source =
      pet.speciesId === this.data.player.id
        ? this.data.player
        : pet.speciesId === this.data.opponent.id
          ? this.data.opponent
          : undefined;
    const talent = this.rollPetTalent(pet, index);
    const learned = this.sources.battle?.progression.initialSkills(pet.speciesId, pet.level) ?? [],
      savedSkills = pet.skillIds?.length ? pet.skillIds : undefined;
    if (!source) {
      const skillIds = [...(savedSkills ?? learned)],
        skillPp =
          pet.skillPp?.length === skillIds.length
            ? pet.skillPp
            : (this.sources.battle?.progression.fullPp(skillIds) ?? []);
      return {
        ...pet,
        slot: pet.slot ?? index,
        heldEquipmentId: pet.heldEquipmentId ?? NO_HELD_ITEM,
        skillIds,
        skillPp: [...skillPp],
        physicalTraitId: talent,
      };
    }
    const defaults = this.petFromSource(source, index),
      skillIds = savedSkills ?? (defaults.skillIds?.length ? defaults.skillIds : learned),
      skillPp =
        pet.skillPp?.length === skillIds.length
          ? pet.skillPp
          : (this.sources.battle?.progression.fullPp(skillIds) ?? defaults.skillPp);
    return {
      ...defaults,
      ...pet,
      slot: pet.slot ?? index,
      heldEquipmentId: pet.heldEquipmentId ?? defaults.heldEquipmentId,
      skillIds: [...(skillIds ?? [])],
      skillPp: [...(skillPp ?? [])],
      physicalTraitId: talent,
    };
  }
  /**
   * The thiên phú this pet is worn with: the one the save recorded, or a replay of the draw Java
   * took when the pet was created (`BattleServices.petTalent`). Without battle services — the
   * player-only tutorial the Java goldens grade — a pet stays as that recording has it: no talent.
   */
  private rollPetTalent(
    pet: {
      speciesId?: number;
      id?: number;
      level: number;
      quality: number;
      nature?: number;
      physicalTraitId?: number;
    },
    slot: number,
  ): number | undefined {
    const battle = this.sources.battle;
    if (!battle) return pet.physicalTraitId;
    if ((pet.physicalTraitId ?? -1) >= 0) return pet.physicalTraitId;
    return battle.petTalent(
      {
        speciesId: pet.speciesId ?? pet.id ?? 0,
        level: pet.level,
        quality: pet.quality,
        nature: pet.nature,
      },
      slot,
    );
  }
  /** The stats the Java engine's growth data gives an authored Pet at its own level and quality. */
  private petStats(source: SourcePetData): PetCoreStats {
    return this.sources.petStats.coreStats(
      source.id,
      source.level,
      source.quality,
      source.nature ?? 0,
    );
  }
  private petFromSource(source: SourcePetData, slot: number): SavedPet {
    const stats = this.petStats(source),
      learned = this.sources.battle?.progression.initialSkills(source.id, source.level) ?? [],
      skillIds = learned.length ? learned : (source.skills ?? []).map((skill) => skill.id),
      skillPp = learned.length
        ? (this.sources.battle?.progression.fullPp(skillIds) ?? [])
        : (source.skills ?? []).map((skill) => skill.pp);
    return {
      slot,
      speciesId: source.id,
      level: source.level,
      quality: source.quality,
      nature: source.nature ?? 0,
      currentHp: stats.hp,
      maxHp: stats.hp,
      experience: 0,
      visualSpriteId: source.spriteId,
      // Java's `PetState` starts at the sentinel form slot, so an authored pet holds nothing.
      heldEquipmentId: NO_HELD_ITEM,
      skillIds,
      skillPp,
      // `PetSourceAdapter.create` rolls a thiên phú for every pet the story hands over.
      physicalTraitId: this.rollPetTalent(source, slot),
    };
  }
  private setPhase(phase: WorldPhase): void {
    this.phase = phase;
    this.presentationTick = 0;
    if (phase === "battleEntry") {
      this.battleEntryMode = this.nextBattleEntryMode;
      this.nextBattleEntryMode = 0;
    }
  }
  private move(commands: InputCommand[]): boolean {
    // `tickSourceLeafRide`: a lotus leaf or cloud under way carries the hero, whatever is held.
    if (this.platformRide) {
      this.tickPlatformRide();
      return true;
    }
    // A called leaf is on its way: the hero waits on the bank (no step, so no encounter roll).
    if (this.leafSummon) {
      this.tickLeafSummon();
      return false;
    }
    // `XhtC3Runtime.tickIceWorld`: on Tương Quân Giải's ice the hero slides, whatever is held.
    if (this.iceDirection !== null) {
      this.tickIceSlide();
      return true;
    }
    const before = { x: this.player.x, y: this.player.y },
      moved = this.walk(commands);
    if (
      moved &&
      this.iceRoom() &&
      (this.player.x !== before.x || this.player.y !== before.y) &&
      this.terrainAt(this.player.x, this.player.y) === ICE_TERRAIN
    ) {
      this.iceDirection = this.player.direction;
      this.setPlayerFacing(false);
    }
    return moved;
  }
  /** The ordinary step: platforms, pushes, Hải âu and the terrain. */
  private walk(commands: InputCommand[]): boolean {
    const intent =
      commands.includes("up") || commands.includes("holdUp")
        ? DIRECTION_UP
        : commands.includes("down") || commands.includes("holdDown")
          ? DIRECTION_DOWN
          : commands.includes("left") || commands.includes("holdLeft")
            ? DIRECTION_LEFT
            : commands.includes("right") || commands.includes("holdRight")
              ? DIRECTION_RIGHT
              : -1;
    if (intent < 0) {
      this.setPlayerFacing(false, true);
      return false;
    }
    // A room whose collision has not arrived yet holds the hero still rather than failing.
    const asset = this.sources.room(this.sceneId, this.roomIndex);
    const map = asset && this.sources.collision(asset.mapId);
    if (!map) return false;
    // `tryStartSourceLeafRide`: stepping onto a platform that can sail that way boards it.
    if (!this.hasHaiAuFlight() && this.startPlatformRide(intent)) return true;
    if (!this.hasHaiAuFlight() && this.trySummonLeaf(intent)) return false;
    // A resumed save that left the hero inside a wall is moved out on the first step.
    const resumed = this.resumedPosition;
    this.resumedPosition = null;
    if (
      resumed?.x === this.player.x &&
      resumed.y === this.player.y &&
      this.repairRoomPosition(map, true)
    ) {
      this.roomEntry = { x: this.player.x, y: this.player.y };
      this.saveRequested = true;
      return false;
    }
    const ride = this.meta.campaign.ride,
      // `VqsvFreeWorldRuntime`: Liệt Hỏa's Hải âu flies (Cầu Vồng's sky ride keeps its gates).
      haiAuFlight =
        this.sceneId !== 98 && ride.activeIndex === HAI_AU && roomAllowsRide(ride, HAI_AU),
      // `tryPrepareBlcLaserPush`: walking into a block of Bích Lam Cốc's laser rooms shoves it first.
      push = haiAuFlight ? null : this.pushBlock(intent),
      // `WorldEngine.tickMovement`: the straight step is tested against the room's actors before any
      // terrain slide; a refused step turns the hero but leaves him where he stands.
      actorBlocked =
        !haiAuFlight &&
        this.actorBlocksMove(this.player.x, this.player.y, intent, this.playerMoveSpeed),
      step = actorBlocked
        ? { x: this.player.x, y: this.player.y, direction: intent, moved: false }
        : haiAuFlight
          ? this.haiAuFlightStep(intent)
          : this.constrainCauVongStep(
              stepWithTerrain(
                this.currentMap(),
                this.player.x,
                this.player.y,
                intent,
                this.flags.terrainBadgeGatedOpen(),
                this.playerMoveSpeed,
                this.movementTerrain,
              ),
            );
    if (push) {
      // `rememberBlcLaserPosition` when the hero followed the block, `rollback` when he did not.
      if (step.moved) this.rememberMovingActor(push.id);
      else {
        push.actor.x = push.from.x;
        push.actor.y = push.from.y;
      }
    }
    this.player.x = step.x;
    this.player.y = step.y;
    this.player.direction = step.direction;
    this.setPlayerFacing(step.moved, true);
    // Cầu Vồng's water ride lets go once the hero's footprint is back on safe floor.
    if (
      step.moved &&
      this.sceneId === 98 &&
      ride.activeIndex === CV_WATER &&
      canDismountRainbow(this.player.x, this.player.y, (x, y) =>
        terrainAtWorld(this.currentMap(), x, y),
      )
    )
      this.dismountRide();
    this.centerCamera();
    return step.moved;
  }
  /** `CauVongTerrainMechanisms.constrainMovement`: in scene 98 the crossed edge must be open too. */
  private constrainCauVongStep(step: MoveStep): MoveStep {
    if (this.sceneId !== 98 || cauVongEdgeClear(this.currentMap(), step, this.movementTerrain))
      return step;
    return { x: this.player.x, y: this.player.y, direction: step.direction, moved: false };
  }
  /** `CauVongChapterRuntime.terrainForMovement`: scene 98 reads its terrain through the rides. */
  private readonly movementTerrain = (terrain: number): number => {
    if (this.sceneId !== 98) return terrain;
    const ride = this.meta.campaign.ride;
    return cauVongMovementTerrain(
      terrain,
      {
        active: ride.activeIndex,
        allowed: (index) => roomAllowsRide(ride, index),
        owned: (index) => this.rideUnlocked(index),
      },
      { water: CV_WATER, plant: CV_PLANT, sky: CV_SKY },
    );
  };
  /** `ROOM_PORTALS`: the portal actor shows on its task, and walking into its rect takes it. */
  private roomPortal() {
    const portal = ROOM_PORTALS[`${this.sceneId}:${this.roomIndex}`];
    return portal && this.flags.mainTaskProgress >= portal.minTask ? portal : null;
  }
  private enterRoomPortal(): boolean {
    const portal = this.roomPortal();
    if (!portal || !playerIntersectsSourceRect(this.player.x, this.player.y, portal.rect))
      return false;
    const { scene, room, x, y, direction } = portal.to;
    if (this.sources.roomReady && !this.sources.roomReady(scene, room)) {
      this.sources.prepareRoom?.(scene, room);
      return false;
    }
    this.loadRoom(scene, room, x, y, direction);
    return true;
  }
  /** `XhtC3Runtime.owns`: 10:0 is the one room whose terrain 3 is ice. */
  private iceRoom(): boolean {
    return this.sceneId === 10 && this.roomIndex === 0;
  }
  private terrainAt(x: number, y: number): number {
    const asset = this.sources.room(this.sceneId, this.roomIndex),
      map = asset ? this.sources.collision(asset.mapId) : undefined;
    return map ? terrainAtWorld(map, x, y) : -1;
  }
  /**
   * `tickIceWorld` while sliding: `sourceIceCanCarry` — still on ice, and 16 px ahead neither a
   * wall nor (without Thủy Lam Chương) badge-gated water — carries the hero 8 px; otherwise one
   * last unchecked 4 px step ends the slide.
   */
  private tickIceSlide(): void {
    const direction = this.iceDirection!,
      dx = direction === DIRECTION_RIGHT ? 1 : direction === DIRECTION_LEFT ? -1 : 0,
      dy = direction === DIRECTION_DOWN ? 1 : direction === DIRECTION_UP ? -1 : 0,
      { x, y } = this.player,
      ahead = this.terrainAt(x + dx * 16, y + dy * 16),
      carry =
        this.terrainAt(x, y) === ICE_TERRAIN &&
        ahead !== TERRAIN_BLOCKED &&
        (ahead !== TERRAIN_BADGE_GATED || this.flags.badges.achieved(BADGE_THUY_LAM)),
      step = carry ? 8 : 4;
    this.player.x += dx * step;
    this.player.y += dy * step;
    this.player.direction = direction;
    if (!carry) this.iceDirection = null;
    this.setPlayerFacing(false);
    this.centerCamera();
  }
  /**
   * The states this room's finished op59/op60 groups and lit torches leave on its actors, written
   * onto `actors` — the world's own on room entry, and a starting group's copy, which reads the
   * room's raw rows and would otherwise put an open door or a burning torch back.
   */
  private applySettledStates(
    actors: Map<
      number,
      { state: number; visible: boolean; direction: number; variant: number; x: number; y: number }
    >,
  ): void {
    const scene = this.sceneId,
      room = this.roomIndex;
    // `applyPersistentMovingActorPositions`: pushed blocks stand where they were left.
    const asset = this.sources.room(scene, room),
      map = asset ? this.sources.collision(asset.mapId) : undefined;
    for (const [id, actor] of actors) {
      if (actor.variant !== 8 && actor.variant !== 9 && actor.variant !== 10) continue;
      const at = this.flags.actorPosition(scene, room, id);
      if (!at) continue;
      // Web fix: a leaf or cloud remembered off its track (a pre-APK-map save) starts on its row.
      const row = asset?.actors.find((candidate) => candidate.id === id);
      if (
        row &&
        isPlatform(row) &&
        !platformSpotOnTrack(map, row, this.sources.collisionMask?.(row.sprite, 0, 0) ?? null, at)
      ) {
        this.flags.setActorPosition(scene, room, id, null);
        continue;
      }
      Object.assign(actor, at);
    }
    // `reconcileRoomEntry`: what the finished groups' op56 committed, with `applyMode(0)` — a
    // person stands facing the listed way, anything else returns to state 0.
    for (const [id, commit] of committedActorVisibility(
      this.sources.registry,
      scene,
      room,
      (group) => this.eventState.sourceEventStateComplete(scene, room, group),
      (ref) => this.eventState.sourceEventStateComplete(ref.scene, ref.room, ref.group),
    )) {
      const actor = actors.get(id);
      if (!actor) continue;
      actor.visible = commit.visible;
      if (commit.direction !== undefined) actor.direction = commit.direction;
      actor.state = WorldRuntime.modeState(actor, commit.state ?? 0);
    }
    for (const [id, state] of settledActorStates(this.sources.registry, scene, room, (group) =>
      this.eventState.sourceEventStateComplete(scene, room, group),
    )) {
      const actor = actors.get(id);
      if (actor) actor.state = state;
    }
    for (const group of this.sources.registry.room(scene, room)?.eventGroups ?? [])
      for (const record of group.records)
        if (record.opcode === 59 || record.opcode === 61)
          for (const id of (record.string_args[0]?.text ?? "")
            .split(",")
            .filter(Boolean)
            .map(Number)) {
            const actor = actors.get(id);
            if (actor && this.flags.hasSourceWorldFlag(switchFlag(scene, room, id)))
              actor.state = 2;
          }
  }
  /**
   * `GymVortexTravel` (source `game.j` states 9 and 10): sixteen spin ticks on the entry vortex, a
   * relocation onto the target vortex snapped to its 16-px tile, then the same sixteen directions in
   * reverse while the camera eases over at 8 px a tick; the hero ends facing the target's way and
   * the arrival latch keeps him from re-entering it.
   */
  private tickVortex(): void {
    const vortex = this.vortex!,
      player = this.player;
    if (vortex.phase === 0) {
      if (vortex.enterTick === 0) {
        player.x = vortex.from.x;
        player.y = vortex.from.y;
        this.centerCamera();
      }
      if (vortex.enterTick < VORTEX_SPIN_TICKS) {
        this.spinFrame(vortex.enterTick);
        vortex.enterTick++;
        return;
      }
      player.x = vortex.to.x - (((vortex.to.x % 16) + 16) % 16);
      player.y = vortex.to.y - (((vortex.to.y % 16) + 16) % 16);
      this.moveCameraToward(8);
      vortex.phase = 1;
      return;
    }
    if (vortex.exitCounter > 0) {
      this.spinFrame(vortex.exitCounter);
      this.moveCameraToward(8);
      vortex.exitCounter--;
      return;
    }
    if (vortex.to.requiredDirection >= 0) player.direction = vortex.to.requiredDirection;
    player.state = WorldRuntime.facingState(player.direction);
    this.dispatcher.markArrival({
      ...vortex.from,
      target: { ...vortex.from.target, actor: vortex.to.actorId },
    });
    this.repairRoomPosition(this.currentMap(), true);
    this.vortex = null;
  }
  /** `applySourceSpinFrame`: the hero turns to `floorMod(direction, 4)` (left draws right mirrored). */
  private spinFrame(direction: number): void {
    const player = this.player;
    player.direction = ((direction % 4) + 4) % 4;
    player.state = WorldRuntime.facingState(player.direction);
    player.animationTick = 0;
  }
  /** `VqsvSceneView.moveCameraToward`: at most `speed` px a tick toward centring the hero. */
  private moveCameraToward(speed: number): void {
    const asset = this.sources.room(this.sceneId, this.roomIndex),
      goal = cameraGoal(asset, this.player.x, this.player.y),
      step = (from: number, to: number) => from + Math.max(-speed, Math.min(speed, to - from));
    this.cameraX = step(this.cameraX, goal.x);
    this.cameraY = step(this.cameraY, goal.y);
  }
  /** `tryRelicSwitches`: the faced, still unlit torch of a pending op59 group starts its cycle. */
  private startSwitch(touch = false): boolean {
    const playerMask = touch ? this.platformMask(this.player) : null;
    for (const group of this.dispatcher.pendingSwitches()) {
      if (!!group.touch !== touch) continue;
      for (const actorId of group.actorIds) {
        const actor = this.actors.get(actorId);
        if (
          !actor?.visible ||
          (touch && actor.state !== 0) ||
          this.flags.hasSourceWorldFlag(switchFlag(this.sceneId, this.roomIndex, actorId))
        )
          continue;
        // `playerIntersectsActorSourceMask(id, true)`: the shape's hit mask under the hero's mask.
        const hit = touch
          ? (this.sources.hitMask?.(actor.sprite, actor.state, actor.animationTick) ?? null)
          : null;
        if (
          touch
            ? !(playerMask && hit
                ? sourceMaskOverlap(this.player.x, this.player.y, playerMask, actor.x, actor.y, hit)
                : intersectsActorBox(this.player.x, this.player.y, actor.x, actor.y))
            : !this.actorInteractionRequested(actor)
        )
          continue;
        actor.state = 1;
        actor.animationTick = 0;
        this.switchCycle = { actorId, waited: 0 };
        this.setPlayerFacing(false);
        return true;
      }
    }
    return false;
  }
  /** `ActorCycle(actor, 1)` (≤ 90 ticks), then `applyMode(2)` and the persistent flag. */
  private tickSwitchCycle(): void {
    const cycle = this.switchCycle!,
      actor = this.actors.get(cycle.actorId);
    cycle.waited++;
    const ticks = actor ? Math.max(1, this.sources.animationTicks(actor.sprite, 1)) : 0;
    if (actor && actor.animationTick < ticks && cycle.waited <= 90) return;
    if (actor) {
      actor.state = 2;
      actor.animationTick = 0;
    }
    this.flags.mutateSourceWorldFlag(0, switchFlag(this.sceneId, this.roomIndex, cycle.actorId));
    this.switchCycle = null;
  }
  /**
   * `BattleNpcProximityGate`'s eligible actors, limited to the gyms: every actor whose battle group
   * the AI catalog names a GYM_TRAINER or GYM_LEADER fight. Cầu Vồng keeps its own interactions.
   */
  private roomGymChallengers(
    scene: number,
    room: number,
  ): { actorId: number; groups: GroupRef[] }[] {
    const services = this.sources.battle;
    if (!services || scene === 98) return [];
    const owners = new Map<number, GroupRef[]>();
    for (const group of this.sources.registry.room(scene, room)?.eventGroups ?? []) {
      const ref = { scene, room, group: group.group_index },
        actorId = worldGroupBattleActor(this.sources.registry, ref);
      if (actorId === null || actorId < 0) continue;
      const kind = eventBattleEncounter(services, ref, actorId)?.encounter.encounterClass ?? "";
      if (!/GYM_(TRAINER|LEADER)$/.test(kind)) continue;
      owners.set(actorId, [...(owners.get(actorId) ?? []), ref]);
    }
    return [...owners].map(([actorId, groups]) => ({ actorId, groups }));
  }
  /**
   * `BattleNpcProximityGate.eligibleActor`: a visible, uncleared kind-0 actor the AI catalog names as
   * an NPC, elite NPC, gym trainer or gym leader opponent. Cầu Vồng keeps its own interactions.
   */
  private challengeGroups(actorId: number): number[] | undefined {
    if (this.sceneId === 98) return undefined;
    const actor = this.actors.get(actorId);
    if (!actor?.visible || actor.sourceKind !== 0 || this.clearedObstacles.has(actorId))
      return undefined;
    this.challengeIndex ??= this.sources.battle?.catalog.challengeActors() ?? new Map();
    return this.challengeIndex.get(`${this.sceneId}:${this.roomIndex}:${actorId}`);
  }
  /** `BattleNpcProximityGate.pending`: an eligible challenger with a fight still to win. */
  private challengePending(actorId: number): boolean {
    return (
      this.challengeGroups(actorId)?.some(
        (group) => !this.eventState.sourceEventStateComplete(this.sceneId, this.roomIndex, group),
      ) ?? false
    );
  }
  /**
   * `VqsvFreeWorldRuntime.actorLookup`: the room's actors as `WorldEngine` sees them — the source
   * behaviour after the runtime overrides, the frame's collision mask, and an obstacle that has been
   * cleared or a hidden actor counted as absent.
   */
  private actorSnapshots(): ActorSnapshot[] {
    const scene = this.sceneId,
      room = this.roomIndex,
      rows = this.sources.registry.room(scene, room)?.actors ?? [],
      complete = (group: number) => this.eventState.sourceEventStateComplete(scene, room, group),
      snapshots: ActorSnapshot[] = [];
    for (const [id, actor] of this.actors) {
      if (id < 0 || id === WorldRuntime.COMPANION_ACTOR_ID) continue;
      const kind = actor.sourceKind ?? -1,
        frameMask =
          this.sources.collisionMask?.(actor.sprite, actor.state, actor.animationTick) ?? null,
        // `VqsvSourceLaserRuntime.expandedCollisionMask`: an emitter's wall runs the beam's length.
        mask =
          frameMask && kind === 0 && actor.variant === LASER_BEHAVIOR
            ? laserCollisionMask(frameMask, actor.direction, this.laserSegments(actor))
            : frameMask,
        cleared = this.clearedObstacles.has(id);
      let behavior = movementBehavior(scene, room, {
        id,
        sprite: actor.sprite,
        kind,
        behavior: actor.variant,
        marker: kind === 0 ? Math.max(0, rows[id]?.values[8] ?? 0) : 0,
        mask,
        beaten: beatenTrainer(scene, room, id, complete, this.flags.mainTaskProgress),
        rockBlocks:
          actor.variant === ROCK_BEHAVIOR && ownedObstacle(scene, room, actor) && !cleared,
      });
      // `BattleNpcProximityGate.movementBehavior`, last: an unbeaten challenger seals its tile even
      // when its source row is passable, and a beaten one no longer blocks.
      if (this.challengeGroups(id)) behavior = this.challengePending(id) ? 1 : 2;
      snapshots.push({
        visible: actor.visible && !cleared,
        kind,
        behavior,
        x: actor.x,
        y: actor.y,
        mask,
      });
    }
    return snapshots;
  }
  /** `WorldEngine.blockedByActor` for the hero's straight step from (x, y). */
  private actorBlocksMove(x: number, y: number, direction: number, speed: number): boolean {
    if (!this.sources.collisionMask) return false;
    const player = this.player,
      mask = this.sources.collisionMask(player.sprite, player.state, player.animationTick);
    if (this.sceneId === 98) {
      // `actorLookup` with the Cầu Vồng overrides: standing NPCs block by their floor footprint,
      // props by theirs, the rest as the source row says.
      const mechanics = this.cauVongMechanics();
      if (!mechanics) return false;
      // Only movement yields to the lower witness in 30:6's crowded formation; talking still
      // uses the unmodified actors and footprints.
      const actors =
        this.roomIndex === 30
          ? [...this.actors.values()].filter(
              (actor) => !cauVongCampusNpcPassable(this.roomIndex, actor, this.actors),
            )
          : this.actors.values();
      const snapshots = cauVongActorSnapshots(actors, mechanics);
      // `CauVongBranchTreasures.obstacle`: every shown chest blocks by its floor footprint.
      for (const t of this.branches()?.treasures(this.roomIndex) ?? [])
        if (t.state !== -1)
          snapshots.push({
            visible: true,
            kind: 0,
            behavior: 0,
            x: t.x * 20 + 10,
            y: t.y * 20 + 20,
            mask: TREASURE_FLOOR,
          });
      return blockedByActor(x, y, direction, speed, mask, snapshots);
    }
    return blockedByActor(x, y, direction, speed, mask, this.actorSnapshots());
  }
  /** This Cầu Vồng room's baked actor snapshots, or undefined outside scene 98. */
  private cauVongMechanics() {
    const base =
      this.sceneId === 98 ? this.sources.cauVongCollision?.[`98:${this.roomIndex}`] : undefined;
    // `CauVongSwitchMechanisms.closedMask` only while the gate is shut.
    if (!base) return undefined;
    const done = (room: number, event: number) =>
      this.eventState.sourceEventStateComplete(98, room, event);
    const opening = cauVongOpeningMechanics(
      this.sources.cauVongOpening,
      this.roomIndex,
      base,
      done,
    );
    // CV5: the North Sea's asked cue actors (Java's snapshot on the scene their cue made them on).
    // CV5b: the forest's and 60's (`actorId` makes them, or a cue did).
    const talkers =
      northSeaOwnsRoom(this.roomIndex) || isSummonRoom(this.roomIndex)
        ? this.sources.cauVongNorthSea?.talkers.mechanics[String(this.roomIndex)]
        : (this.sources.cauVongForest?.talkers[String(this.roomIndex)] as
            typeof opening | undefined);
    const dragon =
      this.roomIndex === SKY_CITY_ROOM ? this.sources.cauVongSummoning?.longVuong : undefined;
    const withTalkers = {
      ...opening,
      ...(talkers ?? {}),
      ...(dragon ? { [String(dragon.actor)]: dragon.mechanic as CauVongMechanic } : {}),
    };
    // `CauVongRockObstacles.closedMask`: a closed rock blocks its tile.
    const rocks = this.sources.cauVongForest?.rocks[String(this.roomIndex)];
    if (!rocks) return withTalkers;
    const result = { ...withTalkers };
    for (const rock of rocks)
      if (rockClosed(rock, this.roomIndex, this.actors.get(rock.actorId)?.visible ?? false, done))
        result[String(rock.actorId)] = { kind: 0, behavior: 0, dx: 0, dy: 0, mask: ROCK_TILE };
    return result;
  }
  /** The hero as `CauVongNpcGeometry` reads him. */
  private cauVongHero(): CauVongHero {
    const player = this.player;
    return {
      x: player.x,
      y: player.y,
      direction: player.direction,
      mask: this.sources.collisionMask?.(player.sprite, player.state, player.animationTick) ?? null,
      speed: this.playerMoveSpeed,
      pointerTarget: this.pointerActor,
    };
  }
  /**
   * `CauVongChapterRuntime.tickSquare` on the free map: a conversation the room starts, else the
   * walk and its three exits (checked before and after the step, as Java does). The room's /4 doors
   * stay shut: this owner places the hero itself.
   */
  private tickCauVongSquare(commands: InputCommand[]): WorldAction {
    const document = this.sources.cauVongSquare,
      mechanics = this.cauVongMechanics();
    const confirm = commands.includes("confirm");
    const done = (room: number, event: number) =>
      this.eventState.sourceEventStateComplete(98, room, event);
    const pending = this.openingPending;
    this.openingPending = null;
    if (pending && this.runOpeningPending(pending)) return this.takeSaveRequest();
    if (document && mechanics) {
      const hero = this.cauVongHero(),
        requested = (id: number) =>
          cauVongNpcRequested(hero, this.actors.values(), mechanics, id, confirm),
        script = cauVongSquareScript(document, { done, requested, confirm, player: this.player });
      // `openingSource` (the walk home after the lesson) ahead of everything; `openingStory`
      // (Jess's lesson) after the intro, the guide and the portal, ahead of the residents.
      const prep = this.sources.cauVongPrep,
        cues = this.sources.cauVongCues;
      if (prep && cues) {
        const ctx = this.openingContext(requested, confirm);
        const back = cauVongPrepSquare(prep, cues, ctx, false);
        const lesson =
          !script || script.id.startsWith("cau-vong:square:npc:") || script.id.endsWith(":sign")
            ? cauVongPrepSquare(prep, cues, ctx, done(CAU_VONG_SQUARE_ROOM, 100))
            : null;
        const action = back ?? lesson;
        if (action && this.runOpeningAction(action)) return this.takeSaveRequest();
      }
      if (script) {
        this.startScript(
          { scene: 98, room: CAU_VONG_SQUARE_ROOM, group: -1 },
          script.id,
          script.events,
        );
        return null;
      }
    }
    if (this.leaveCauVongSquare()) return "autosave";
    const moved = this.move(commands);
    if (this.leaveCauVongSquare()) return "autosave";
    if (this.afterFreeMovement(moved)) return null;
    return this.takeSaveRequest();
  }
  // --- Cầu Vồng cutscenes (`CauVongCutsceneSequence`) and Đại sảnh Cúp Cầu Vồng (98:47) ---

  /** `Scene.rainbowPresentation`: the curtain bars, the flash and the shake. */
  readonly cauVongPresentation = new CauVongPresentation();
  /** `Actor.rainbowExpression` by actor id (-1 the hero): the 13000 state, and whether it loops. */
  readonly cauVongExpressions = new Map<number, { state: number; repeat: boolean; tick: number }>();
  /** op49's fixed `TempSprite`s. */
  readonly cauVongEffects: CauVongEffect[] = [];
  /** The part the event engine is playing, its first unfinished cue and that cue's scratch. */
  private cauVongPlay: {
    name: string;
    part: CauVongPart;
    cursor: number;
    scratch: CueScratch;
    after: ReturnType<typeof afterPart>;
  } | null = null;
  /** `rainbowPresentation.tick()` and `Actor.tick`'s expression step, once a world tick. */
  private tickCauVongPresentation(): void {
    this.cauVongPresentation.tick();
    for (const [id, expression] of this.cauVongExpressions) {
      expression.tick++;
      if (
        !expression.repeat &&
        expression.tick >= Math.max(1, this.sources.animationTicks(13000, expression.state))
      )
        this.cauVongExpressions.delete(id);
    }
    for (const effect of this.cauVongEffects) effect.tick++;
  }
  /** `CauVongOpeningSourceRuntime.start(part)` (after `clear` for a repeatable one). */
  private startCauVongPart(
    name: CauVongPartName,
    part: CauVongPart,
    clear: boolean,
    after: ReturnType<typeof afterPart> = afterPart(name),
  ): void {
    if (clear) {
      this.eventState.op42RepeatEvent(98, part.room, part.flag);
      this.eventState.op42RepeatEvent(98, part.room, part.started);
      for (let i = 0; i < 500; i++) this.eventState.op42RepeatEvent(98, part.room, part.cue + i);
    }
    const { events, cursor } = partScript(part, (event) =>
      this.eventState.sourceEventStateComplete(98, part.room, event),
    );
    const base = events.length;
    this.cauVongPlay = { name, part, cursor, scratch: {}, after };
    this.startScript({ scene: 98, room: part.room, group: -1 }, `cau-vong:${name}`, [
      ...events,
      ...after.events.map((event) =>
        event.type === "choice" ? { ...event, next: event.next.map((n) => n + base) } : event,
      ),
    ]);
  }
  /** A cue's stage over a set of actors (the playing scene's, or the world's on a room load). */
  private cauVongStageOver(
    actors: Map<number, StoryActor>,
    camera?: {
      followCamera(id: number | null): void;
      panCameraTo(x: number, y: number, speed: number): boolean;
      centerCameraOn(x: number, y: number): void;
    },
  ): CauVongStage {
    return {
      actor: (id) => {
        const actor = actors.get(id);
        if (!actor) throw new Error(`Missing cutscene actor ${id}`);
        return actor;
      },
      animationTicks: (sprite, state) => this.sources.animationTicks(sprite, state),
      presentation: this.cauVongPresentation,
      stopFollow: () => camera?.followCamera(null),
      follow: (id) => camera?.followCamera(id),
      panCamera: (x, y, speed) => camera?.panCameraTo(x, y, speed) ?? true,
      centerCamera: (x, y) => camera?.centerCameraOn(x, y),
      expression: (id, state, mode) => {
        if (mode === 2) this.cauVongExpressions.delete(id);
        else this.cauVongExpressions.set(id, { state, repeat: mode === 1, tick: 0 });
      },
      addEffect: (effect) => this.cauVongEffects.push(effect),
      removeEffect: (effect) => {
        const at = this.cauVongEffects.indexOf(effect);
        if (at >= 0) this.cauVongEffects.splice(at, 1);
      },
      // `gift`: once per receipt, a BAG row (`sourceAddItemReward`) or a special reward
      // (`sourceGrantSpecialReward`: the species egg, which stacks like every egg).
      gift: (gift) => {
        if (this.eventState.sourceEventStateComplete(98, gift.room, gift.receipt)) return;
        this.eventEffects().grantItem(gift.rewardId, gift.qty, gift.kind === "SPECIAL" ? 5 : 4);
        this.eventState.op14CompleteEvent(98, gift.room, gift.receipt);
      },
      // `CauVongAcademyTransactions.gift`: once per receipt, into the list its record names.
      award: (award) => {
        if (this.eventState.sourceEventStateComplete(98, award.room, award.receipt)) return;
        if (award.kind === "EQUIPMENT") {
          // One owned identity in the equipment list; a charm is granted at its first tier.
          if (!this.bag.equipment.includes(award.rewardId)) this.bag.equipment.push(award.rewardId);
          if (award.charm) this.cauVongShopPurse().grantCharm(award.rewardId);
        } else if (award.kind === "NONE") {
          // Item 14: the unified inventory's approved exclusion, received without a grant.
        } else if (award.kind === "QUEST") {
          this.inventory[String(award.rewardId)] =
            (this.inventory[String(award.rewardId)] ?? 0) + award.qty;
        } else if (award.kind === "MATERIAL") {
          const id = String(award.rewardId);
          this.bag.materials[id] = (this.bag.materials[id] ?? 0) + award.qty;
        } else
          this.eventEffects().grantItem(
            award.rewardId,
            award.qty,
            award.kind === "SPECIAL" ? 5 : 4,
          );
        this.eventState.op14CompleteEvent(98, award.room, award.receipt);
      },
      mark: (room, event) => this.eventState.op14CompleteEvent(98, room, event),
      // `once(room, receipt, ...)`: `sourceAddItem(item, 1)` for each item whose count is 0.
      questOnce: (room, receipt, items) => {
        if (this.eventState.sourceEventStateComplete(98, room, receipt)) return;
        for (const item of items)
          if ((this.inventory[String(item)] ?? 0) === 0) this.inventory[String(item)] = 1;
        this.eventState.op14CompleteEvent(98, room, receipt);
      },
      // `CauVongFourGateTransactions.grantPet`: the roster, else the bank; 9:8 is a mount too.
      pet: (pet) => {
        if (this.eventState.sourceEventStateComplete(98, pet.room, pet.receipt)) return;
        if (!this.petHasSpace()) return;
        const toRoster = this.pets.length < 6,
          bank = this.meta.campaign.petBank,
          built = this.buildSourcePet(
            pet.species,
            pet.level,
            -1,
            pet.nature,
            toRoster ? this.pets.length : bank.length,
            [],
          );
        if (toRoster) this.pets.push(built);
        else bank.push(built);
        this.synchronizeGoldenBankReward();
        this.collectOwned(built);
        if (pet.ride >= 0)
          this.eventState.op14CompleteEvent(98, 0, RAINBOW_RIDE_OWNED_EVENT + pet.ride);
        this.eventState.op14CompleteEvent(98, pet.room, pet.receipt);
      },
    };
  }
  /** The `worldHook` steps of a playing Cầu Vồng part. */
  private cauVongHook(hook: string, elapsed: number): "continue" | "complete" {
    if (hook.startsWith(OPENING_HOOK)) {
      const [kind, a, b] = hook.slice(OPENING_HOOK.length).split(":");
      this.openingPending =
        kind === "answer"
          ? { kind: "answer", menu: a as OpeningMenu | PrepMenu | AcademyMenu, selected: Number(b) }
          : kind === "roster"
            ? { kind: "roster", id: Number(a), pose: Number(b) }
            : { kind: "after", name: a };
      return "complete";
    }
    if (hook.startsWith(LOCKE_HOOK)) {
      const [kind, value] = hook.slice(LOCKE_HOOK.length).split(":");
      this.lockePending =
        kind === "answer"
          ? { kind: "answer", selected: Number(value) }
          : { kind: "after", name: value as LockePartName };
      return "complete";
    }
    if (hook.startsWith(FOUR_GATES_HOOK)) {
      const [kind, a, b] = hook.slice(FOUR_GATES_HOOK.length).split(":");
      this.fourGatesPending =
        kind === "answer"
          ? { kind: "answer", owner: Number(a), selected: Number(b) }
          : kind === "notice"
            ? { kind: "notice" }
            : // A part name may carry an owner prefix ("lab:INTRO").
              { kind: "after", name: hook.slice(FOUR_GATES_HOOK.length + "after:".length) };
      return "complete";
    }
    const play = this.cauVongPlay,
      scene = this.event?.scene;
    if (!play || !scene) return "complete";
    const stage = this.cauVongStageOver(scene.actors, scene);
    if (hook === BEGIN_HOOK) {
      // `CauVongCutsceneSequence`'s first tick: follow the hero, restore every finished cue.
      scene.followCamera(-1);
      for (let i = 0; i < play.cursor; i++) restoreCue(stage, play.part.steps[i]);
      return "complete";
    }
    if (hook === END_HOOK) {
      // `scene = null; text = null; rainbowPresentation.reset(); followActor(-1)`, then `after`.
      this.cauVongPresentation.reset();
      scene.followCamera(-1);
      for (const id of play.after.hide) {
        const actor = scene.actors.get(id);
        if (actor) actor.visible = false;
      }
      if (play.after.heroVisible) this.player.visible = true;
      // The free world derives the hero's mirror from his direction again.
      this.player.renderOrientation = -1;
      this.cauVongPlay = null;
      return "complete";
    }
    const index = Number(hook.slice(CUE_HOOK.length));
    if (elapsed === 1) play.scratch = {};
    return tickCue(stage, play.part.steps[index], elapsed - 1, play.scratch)
      ? "complete"
      : "continue";
  }
  /** A scene's reloaded cast takes the world's positions, poses and visibility. */
  private copyWorldCast(actors: Map<number, StoryActor>): void {
    for (const [id, actor] of actors) {
      const world = id >= 0 ? this.actors.get(id) : undefined;
      if (!world) continue;
      actor.x = world.x;
      actor.y = world.y;
      actor.visible = world.visible;
      actor.state = world.state;
      actor.direction = world.direction;
      actor.renderOrientation = world.renderOrientation;
    }
  }
  /** `CauVongOpeningSourceRuntime.applyCast` for room 47, on the world's freshly loaded cast. */
  private applyHallCast(): void {
    const cues = this.sources.cauVongCues;
    if (!cues) return;
    const cast = hallCast(cues, (room, event) =>
      this.eventState.sourceEventStateComplete(98, room, event),
    );
    const champion = this.actors.get(92);
    if (champion) champion.visible = cast.championVisible;
    const stage = this.cauVongStageOver(this.actors);
    for (const range of cast.castRanges)
      for (const cue of cues.cast[range] ?? []) restoreCue(stage, cue);
    for (const id of cast.hide) {
      const actor = this.actors.get(id);
      if (actor) actor.visible = false;
    }
    // A cast restore never changes the screen presentation.
    this.cauVongPresentation.reset();
  }
  /**
   * `CauVongChapterRuntime.tick` in Đại sảnh Cúp Cầu Vồng: the part, menu or conversation the room
   * starts, else the walk (no encounters) and the south door, checked before and after the step.
   */
  private tickCauVongHall(commands: InputCommand[]): WorldAction {
    const cues = this.sources.cauVongCues,
      hall = this.sources.cauVongHall,
      mechanics = this.cauVongMechanics();
    const confirm = commands.includes("confirm");
    if (cues && hall && mechanics) {
      const hero = this.cauVongHero(),
        action = cauVongHallAction(cues, hall, {
          done: (room, event) => this.eventState.sourceEventStateComplete(98, room, event),
          requested: (id) =>
            cauVongNpcRequested(hero, this.actors.values(), mechanics, id, confirm),
          player: this.player,
        });
      if (action?.kind === "part") {
        this.startCauVongPart(action.name, action.part, action.clear ?? false);
        return null;
      }
      if (action?.kind === "menu" || action?.kind === "talk") {
        this.startScript(
          { scene: 98, room: CAU_VONG_HALL_ROOM, group: -1 },
          `cau-vong:hall:${action.kind}`,
          action.events,
        );
        return null;
      }
      if (action?.kind === "exit") return this.leaveCauVongHall();
    }
    const moved = this.move(commands);
    if (cauVongHallExit(this.player.x, this.player.y)) return this.leaveCauVongHall();
    // `tickFreeWorldPlayerWithoutEncounters`: the step produces no encounter.
    if (!moved) this.afterFreeMovement(false);
    return this.takeSaveRequest();
  }
  // --- The opening route: the manor (54) and CV1's city, Rừng Gai and ruins (1, 11, 5, 6) ---

  /** `CauVongOpeningStory.applyHouseholdCast`, `CauVongSwitchMechanisms.apply` and the room's casts. */
  private applyOpeningCast(): void {
    this.cauVongHeld.clear();
    const doc = this.sources.cauVongOpening,
      cues = this.sources.cauVongCues;
    const done = (room: number, event: number) =>
      this.eventState.sourceEventStateComplete(98, room, event);
    const stage = this.cauVongStageOver(this.actors);
    const prep = this.sources.cauVongPrep;
    if (prep && [...PREP_ROOMS, CITY_ROOM].includes(this.roomIndex)) {
      const extra = cauVongPrepCast(prep, this.roomIndex, done, this.sources.cauVongAcademy);
      for (const cue of extra.cues) restoreCue(stage, cue);
      for (const [id, visible] of extra.visible) {
        const actor = this.actors.get(id);
        if (actor) actor.visible = visible;
      }
      for (const [id, state] of extra.state) {
        const actor = this.actors.get(id);
        if (!actor) continue;
        if (actor.state !== state) actor.animationTick = 0;
        actor.state = state;
      }
      this.cauVongPresentation.reset();
    }
    const academy = this.sources.cauVongAcademy;
    if (
      academy &&
      (this.roomIndex === ACADEMY_ROOM ||
        (ACADEMY_ROOMS as readonly number[]).includes(this.roomIndex))
    ) {
      const cast = cauVongAcademyCast(academy, this.roomIndex, done);
      for (const cue of cast.cues) restoreCue(stage, cue);
      for (const [id, visible] of cast.visible) {
        const actor = this.actors.get(id);
        if (actor) actor.visible = visible;
      }
      this.cauVongPresentation.reset();
    }
    if (!doc || !cues || !(OPENING_ROOMS as readonly number[]).includes(this.roomIndex)) return;
    const cast = cauVongOpeningCast(doc, cues, this.roomIndex, done);
    for (const cue of cast.cues) restoreCue(stage, cue);
    for (const [id, visible] of cast.visible) {
      const actor = this.actors.get(id);
      if (actor) actor.visible = visible;
    }
    for (const [id, state] of cast.state) {
      const actor = this.actors.get(id);
      if (!actor) continue;
      if (actor.state !== state) actor.animationTick = 0;
      actor.state = state;
    }
    for (const [id, state] of cast.held) this.cauVongHeld.set(id, state);
    // A cast restore never changes the screen presentation.
    this.cauVongPresentation.reset();
  }
  /** `CauVongLunchQuestRuntime.reconcile`, the inner ruins egg repair and `laterVisit`, every tick. */
  private repairOpening(doc: CauVongOpeningDocument, cues: CauVongCuesDocument): void {
    const done = (room: number, event: number) =>
      this.eventState.sourceEventStateComplete(98, room, event);
    if (done(CITY_ROOM, LUNCH_ACCEPTED)) {
      // `grantRainbowRide(s, 0)`: Quả Tử Tiểu Tả, the thorn mount.
      this.eventState.op14CompleteEvent(98, 0, RAINBOW_RIDE_OWNED_EVENT + CV_PLANT);
      const lunch = String(doc.items.lunch.id);
      if (!done(FOREST_ROOM, LUNCH_DELIVERED) && (this.inventory[lunch] ?? 0) === 0)
        this.inventory[lunch] = 1;
    }
    if (done(RUINS_INNER_ROOM, RUINS_EGG) && !done(RUINS_INNER_ROOM, RUINS_EGG_REWARD)) {
      this.eventEffects().grantItem(doc.items.plantEgg, 1, 5);
      this.eventState.op14CompleteEvent(98, RUINS_INNER_ROOM, RUINS_EGG_REWARD);
    }
    // `openingSideQuests`: an exchange from an older save still owes its extra gift.
    if (this.roomIndex === RUINS_ROOM && done(RUINS_ROOM, BOY_TRADED)) this.boyExtraGift(doc);
    for (const [room, event] of openingRepairs(cues, this.roomIndex, done))
      this.eventState.op14CompleteEvent(98, room, event);
  }
  /** `boyExtraGift`: items 0 and 3, four each, once. */
  private boyExtraGift(doc: CauVongOpeningDocument): void {
    if (this.eventState.sourceEventStateComplete(98, RUINS_ROOM, BOY_EXTRA_GIFT)) return;
    for (const gift of doc.boy.extra) this.eventEffects().grantItem(gift.rewardId, gift.qty, 4);
    this.eventState.op14CompleteEvent(98, RUINS_ROOM, BOY_EXTRA_GIFT);
  }
  /**
   * `CauVongChapterRuntime.tick` in 54, 1, 11, 5 and 6: what a finished script left to do, the
   * repairs, then the sequence or conversation the room starts, else the walk and the exits
   * (checked before and after the step). 54 walks without encounters.
   */
  private tickCauVongOpening(commands: InputCommand[]): WorldAction {
    const doc = this.sources.cauVongOpening,
      cues = this.sources.cauVongCues,
      mechanics = this.cauVongMechanics();
    const confirm = commands.includes("confirm");
    const done = (room: number, event: number) =>
      this.eventState.sourceEventStateComplete(98, room, event);
    const prep = this.sources.cauVongPrep,
      prepRoom = (PREP_ROOMS as readonly number[]).includes(this.roomIndex),
      academy = this.sources.cauVongAcademy,
      academyRoom = (ACADEMY_ROOMS as readonly number[]).includes(this.roomIndex);
    if (doc && cues && mechanics) {
      const pending = this.openingPending;
      this.openingPending = null;
      if (pending && this.runOpeningPending(pending)) return this.takeSaveRequest();
      const result = this.academyResult;
      this.academyResult = null;
      if (result && this.academyBattleResult(result.won)) return this.takeSaveRequest();
      // The clerk's farewell once the shop has closed (`farewell` / `arenaShopFarewell`): the
      // host takes the service first, and the world does not tick while the panel is up.
      const farewell = this.pendingService ? null : this.academyFarewell;
      if (farewell) this.academyFarewell = null;
      if (farewell && academy?.parts[farewell])
        if (this.runOpeningAction({ kind: "part", name: farewell, part: academy.parts[farewell] }))
          return this.takeSaveRequest();
      this.repairOpening(doc, cues);
      const hero = this.cauVongHero(),
        ctx = this.openingContext(
          (id) => cauVongNpcRequested(hero, this.actors.values(), mechanics, id, confirm),
          confirm,
        );
      // `missingBranches.tick` in 43 (the quest scroll) and 50 (the lift to 67), ahead of their owners.
      const branches = this.branches();
      if (branches?.handles(this.roomIndex)) {
        const branch = branches.tick(this.branchWorld(confirm), this.roomIndex);
        if (branch && this.runFourGatesAction(branch)) return this.takeSaveRequest();
      }
      if (academy && this.roomIndex === CLASSROOM) {
        const arrived = classroomArrival(ctx.done);
        if (arrived) this.eventState.op14CompleteEvent(98, ...arrived);
      }
      const yard =
        prepRoom && prep && this.roomIndex === ACADEMY_ROOM && academy
          ? cauVongAcademyYard(academy, ctx)
          : null;
      // CV5b: `academyLaboratory.tickAcademyDoor` after the academy owners, ahead of `tickAcademy`.
      if (!yard && prepRoom && prep && this.roomIndex === ACADEMY_ROOM) {
        const door = this.forest()?.academyDoor(this.fourGatesWorld(confirm));
        if (door && this.runFourGatesAction(door)) return this.takeSaveRequest();
      }
      const action: PrepAction | AcademyAction = academyRoom
        ? academy
          ? cauVongAcademyAction(academy, this.roomIndex, ctx)
          : null
        : prepRoom
          ? prep
            ? (yard ?? cauVongPrepAction(prep, cues, this.roomIndex, ctx))
            : null
          : cauVongOpeningAction(
              doc,
              cues,
              this.roomIndex,
              ctx,
              prep
                ? { home: () => cauVongPrepHome(prep, ctx), city: () => cauVongPrepCity(prep, ctx) }
                : {},
            );
      // `tickRuins`: the masked pair (CauVongRuinsMaskedCutscene) resumes after the side quests;
      // its rectangle opens once the lost pet is reported (9:102), ahead of the residents.
      // `CauVongNorthRecoveryCutscene` in the dorm, ahead of the academy owners.
      const forest = this.roomIndex === DORM ? this.forest() : null;
      const recovery = forest?.recovery(this.fourGatesWorld(confirm));
      if (recovery && this.runFourGatesAction(recovery)) return this.takeSaveRequest();
      // CV4c: `CauVongLabReturnCutscene` next (59), `CauVongAcademyExpansionRuntime` in 3 ahead of
      // the classroom's teacher and residents.
      const lab = this.lab();
      if (lab && this.roomIndex === DORM) {
        const back = lab.labReturn(this.fourGatesWorld(confirm));
        if (back && this.runFourGatesAction(back)) return this.takeSaveRequest();
      }
      if (lab && this.roomIndex === CLASSROOM && done(CLASSROOM, 102)) {
        const twins = lab.classroom(this.fourGatesWorld(confirm));
        if (twins && this.runFourGatesAction(twins)) return this.takeSaveRequest();
      }
      // `CauVongDormPetQuest` (59, 11, 5): after the academy owners, ahead of the rooms' residents.
      if (
        lab &&
        (this.roomIndex === DORM ||
          this.roomIndex === THORN_ROOM ||
          this.roomIndex === RUINS_ROOM) &&
        (!action || action.kind === "roster" || action.kind === "dormTalk")
      ) {
        const quest = lab.dormPet(this.fourGatesWorld(confirm), this.roomIndex);
        if (quest && this.runFourGatesAction(quest)) return this.takeSaveRequest();
      }
      // `fourGateSource.tick` in Rừng Gai (11): the rival's thorn duel, ahead of the residents.
      const thorn = this.roomIndex === THORN_ROOM ? this.fourGates() : null;
      if (thorn && (!action || action.kind === "roster")) {
        const duel = thorn.tick(this.fourGatesWorld(confirm), THORN_ROOM);
        if (duel && this.runFourGatesAction(duel)) return this.takeSaveRequest();
      }
      // CV0': `continuation.tick` in the hub (its two vines down), after `summoning`, ahead of the
      // residents.
      const summoning = this.roomIndex === SKY_HUB_ROOM ? this.summoning() : null;
      if (summoning && (!action || action.kind === "roster")) {
        const portal = summoning.tick(this.summonWorld(confirm), SKY_HUB_ROOM);
        if (portal && this.runFourGatesAction(portal)) return this.takeSaveRequest();
      }
      const sea = this.roomIndex === SKY_HUB_ROOM ? this.northSea() : null;
      if (sea && (!action || action.kind === "roster")) {
        const vine = sea.hub(this.northSeaWorld(confirm));
        if (vine && this.runFourGatesAction(vine)) return this.takeSaveRequest();
      }
      const owner =
        this.roomIndex === RUINS_ROOM && done(RUINS_ROOM, 100) ? this.fourGates() : null;
      if (owner && (!action || action.kind === "roster")) {
        const w = this.fourGatesWorld(confirm),
          masked = owner.maskedResume(w) ?? owner.maskedTrigger(w, confirm);
        if (masked && this.runFourGatesAction(masked)) return this.takeSaveRequest();
      }
      if (action && this.runOpeningAction(action)) return this.takeSaveRequest();
    }
    const yard = academy && this.roomIndex === ACADEMY_ROOM;
    const exit = (): PrepAction | AcademyAction => {
      const ctx = yard || academyRoom ? this.openingContext(() => false, false) : null;
      return (
        (academy && academyRoom && ctx ? cauVongAcademyExit(this.roomIndex, ctx) : null) ??
        (yard && ctx ? cauVongAcademyYardSideDoor(ctx) : null) ??
        (prep && prepRoom ? cauVongPrepExit(prep, this.roomIndex, this.player) : null) ??
        (yard && ctx ? cauVongAcademyYardGates(academy, ctx) : null) ??
        (prep && this.roomIndex === CITY_ROOM ? cauVongPrepCityExit(this.player) : null) ??
        // `citySideEntrance`: the shop 56, the rooftop 45, the hall 47 and the research room 46.
        (this.roomIndex === CITY_ROOM
          ? (this.city()?.entrance(this.cityWorld(false), this.player.x) ?? null)
          : null) ??
        (academyRoom ? null : cauVongOpeningExit(this.roomIndex, this.player, done))
      );
    };
    const before = exit();
    if (before) return this.runOpeningAction(before) ? "autosave" : null;
    const moved = this.move(commands);
    const after = exit();
    if (after) return this.runOpeningAction(after) ? "autosave" : null;
    // CV0': `CauVongNorthSeaRoutes.exit` in the hub (49, the summoners' hall and the trial rooms).
    const hubDoor =
      this.roomIndex === SKY_HUB_ROOM
        ? (this.northSea()?.exit(this.northSeaWorld(false), SKY_HUB_ROOM) ?? null)
        : null;
    if (hubDoor) return this.runFourGatesAction(hubDoor) ? "autosave" : null;
    // The chapter's table doorways (`CauVongFourGateRoutes`, e.g. 3 → 9 once Tứ Môn is told, or
    // the inner ruins' 6 → 10 once the lost pet is reported) stay with the shared route owner.
    if (academyRoom || this.roomIndex === RUINS_INNER_ROOM) {
      const dispatch = this.dispatcher.probe(this.view(false));
      if (dispatch?.kind === "room-door") return this.useRoomDoor(dispatch.door) ?? "autosave";
      if (dispatch?.kind === "room-portal")
        return this.useRoomPortal(dispatch.portal) ?? "autosave";
    }
    // `tickFreeWorldPlayerWithoutEncounters` in the manor, the hatchery, the café, the academy,
    // the middle arena (`tickArena`) and the dorm (`tickSideRoom`).
    if ([54, 55, 44, ACADEMY_ROOM, MIDDLE_ARENA, DORM, SHOP_ROOM].includes(this.roomIndex)) {
      // `tickFreeWorldPlayerWithoutEncounters`.
      if (!moved) this.afterFreeMovement(false);
    } else if (this.afterFreeMovement(moved)) return null;
    return this.takeSaveRequest();
  }
  /** What the route's rooms read this tick (`CauVongPrep.PrepContext`). */
  private openingContext(requested: (id: number) => boolean, confirm: boolean): AcademyContext {
    const owned = new Set([
      ...this.pets.map((pet) => pet.speciesId),
      ...this.meta.campaign.petBank.map((pet) => pet.speciesId),
    ]);
    let collected = 0;
    for (let id = 100; id <= 201; id++) if (this.collection.collected(id)) collected++;
    return {
      done: (room, event) => this.eventState.sourceEventStateComplete(98, room, event),
      requested,
      confirm,
      player: this.player,
      actor: (id) => this.actors.get(id),
      lunchCount: this.inventory[String(this.sources.cauVongOpening?.items.lunch.id ?? -1)] ?? 0,
      pets: this.openingPets(),
      collected,
      money: this.currency.money,
      hasSpace: this.petHasSpace(),
      owns: (species) => owned.has(species),
      direction: this.player.direction,
      terrainAt: (x, y) => this.terrainAt(x, y),
    };
  }
  /** `CauVongDormPetQuest.hasSpace(s, 1)`: the roster or the bank takes one more. */
  private petHasSpace(): boolean {
    return this.pets.length < 6 || this.meta.campaign.petBank.length < this.petBankCapacity();
  }
  /** The party as the boy's trade reads it. */
  private openingPets() {
    return this.pets.map((pet) => ({
      speciesId: pet.speciesId,
      level: pet.level,
      quality: pet.quality,
      alive: (pet.currentHp ?? pet.maxHp ?? 1) > 0,
    }));
  }
  private runOpeningAction(action: NonNullable<PrepAction | AcademyAction>): boolean {
    const ref = { scene: 98, room: this.roomIndex, group: -1 };
    switch (action.kind) {
      case "incubator":
        return this.openCauVongIncubator();
      case "academyMenu":
        return this.academyMenu(action.menu, action.round ?? 0, action.reply);
      case "academyBattle":
        return this.startAcademyBattle(action.key, action.fight, action.restore);
      case "line":
        return this.academyLine(action.text.speaker, action.text.text);
      case "bounce": {
        // `arrival(s, 2, 8, 13, 0)`, then the reminder in the yard.
        if (
          !this.runOpeningAction({
            kind: "exit",
            room: action.room,
            x: action.x,
            y: action.y,
            dir: action.dir,
          })
        )
          return false;
        return this.academyLine(action.text.speaker, action.text.text);
      }
      case "academyService":
        // `service(action)`: the shop or the bank opens over the room; the farewell waits for it.
        this.academyFarewell = action.farewell ?? null;
        this.pendingService = {
          scene: 98,
          room: this.roomIndex,
          actorId: -1,
          dialogRow: -1,
          speaker: null,
          text: null,
          continuation: action.service === "bank" ? "PET_BANK" : "CAU_VONG_SHOP",
          shopCategory: action.category,
          dialogue: false,
          bankExpansion: false,
        };
        return false;
      case "payInfo": {
        // `payInfo`: once paid (43:1650) the tip plays; without 500 kim nothing is taken.
        const academy = this.sources.cauVongAcademy;
        if (!academy) return false;
        const shop = academy.shop43,
          paid = this.eventState.sourceEventStateComplete(98, SHOP_ROOM, shop.flags.infoPaid);
        if (!paid && this.currency.money < shop.infoPrice)
          return this.runOpeningAction({
            kind: "part",
            name: "SHOP_INFO_NO_MONEY",
            part: academy.parts.SHOP_INFO_NO_MONEY,
          });
        if (!paid) {
          this.currency.money = Math.max(0, this.currency.money - shop.infoPrice);
          this.eventState.op14CompleteEvent(98, SHOP_ROOM, shop.flags.infoPaid);
        }
        return this.runOpeningAction({
          kind: "part",
          name: "SHOP_INFO",
          part: academy.parts.SHOP_INFO,
        });
      }
      case "dormTalk":
        this.startScript(ref, "cau-vong:academy:dorm", [
          {
            type: "text",
            text: action.npc.line,
            speaker: action.npc.name,
            mode: -1,
            wait: true,
            kind: "dialog",
          },
          ...(action.sleep
            ? [{ type: "worldHook", hook: `${OPENING_HOOK}after:DORM_SLEEP` } as RuntimeStoryEvent]
            : []),
        ]);
        return true;
      case "prepMenu": {
        // The menus of `MissingBranches` survive a reload by their 822000+owner marker.
        if (action.menu !== "hatchery")
          this.eventState.op14CompleteEvent(
            98,
            this.roomIndex,
            822000 + PREP_MENU_OWNER[action.menu],
          );
        const prep = this.sources.cauVongPrep;
        if (action.reply && prep)
          return this.runOpeningAction({
            kind: "part",
            name: action.reply,
            part: prep.parts[action.reply],
          });
        return this.prepMenu(action.menu);
      }
      case "grantPet":
        return this.grantPrepPet(action.grant, action.next);
      case "fee":
        return this.academyFee();
      case "exit": {
        // A room the pack has no map for keeps the hero where he is (as a /4 doorway does).
        if (!this.sources.room(98, action.room)) return false;
        if (this.sources.roomReady && !this.sources.roomReady(98, action.room)) {
          this.sources.prepareRoom?.(98, action.room);
          return false;
        }
        this.loadRoom(98, action.room, action.x, action.y, action.dir ?? 0);
        return true;
      }
      case "say":
        this.startScript(ref, "cau-vong:opening:say", [
          { type: "text", text: action.text, speaker: "", mode: -1, wait: true, kind: "dialog" },
          {
            type: "markComplete",
            ref: { scene: 98, room: action.mark[0], group: action.mark[1] },
          },
        ]);
        return true;
      case "talk":
        this.startScript(ref, "cau-vong:opening:talk", [
          {
            type: "text",
            text: action.line,
            speaker: action.name,
            mode: -1,
            wait: true,
            kind: "dialog",
          },
        ]);
        return true;
      case "roster": {
        // `faceNpcTowardsPlayer`, the line, then the original pose (`applySourcePose`).
        const npc = action.npc,
          actor = this.actors.get(npc.actorId),
          facing = this.player.direction;
        if (actor) {
          const state = npc.faces[facing === DIRECTION_UP ? 0 : facing === DIRECTION_DOWN ? 1 : 2];
          if (actor.state !== state) actor.animationTick = 0;
          actor.state = state;
          actor.direction =
            facing === DIRECTION_LEFT
              ? DIRECTION_RIGHT
              : facing === DIRECTION_RIGHT
                ? DIRECTION_LEFT
                : facing === DIRECTION_DOWN
                  ? DIRECTION_UP
                  : DIRECTION_DOWN;
        }
        this.startScript(ref, "cau-vong:opening:roster", [
          { type: "text", text: npc.line, speaker: npc.name, mode: -1, wait: true, kind: "dialog" },
          { type: "worldHook", hook: `${OPENING_HOOK}roster:${npc.actorId}:${npc.pose}` },
        ]);
        return true;
      }
      case "part": {
        // `merchantGift` ahead of its reply: once, item 11.
        if (action.gift) this.cauVongStageOver(this.actors).gift(action.gift);
        const then = (action.then ?? []).map(([room, event]): RuntimeStoryEvent => ({
          type: "markComplete",
          ref: { scene: 98, room, group: event },
        }));
        this.startCauVongPart(action.name as CauVongPartName, action.part, action.clear ?? false, {
          hide: action.name === "INNER_EGG" ? [INNER_EGG_ACTOR] : [],
          heroVisible: true,
          events: [...then, { type: "worldHook", hook: `${OPENING_HOOK}after:${action.name}` }],
        });
        return true;
      }
    }
  }
  /** A finished script's follow-up: `tickDialogue`'s action, `after(part)`, or a menu answer. */
  private runOpeningPending(pending: NonNullable<WorldRuntime["openingPending"]>): boolean {
    const doc = this.sources.cauVongOpening;
    if (!doc) return false;
    if (pending.kind === "roster") {
      if (this.actors.has(pending.id))
        restoreCue(this.cauVongStageOver(this.actors), {
          k: "pose",
          id: pending.id,
          signed: pending.pose,
        });
      // `rosterBattlePendingActor`: room 2's two trainers challenge until beaten.
      const academy = this.sources.cauVongAcademy,
        npc = this.sources.cauVongPrep?.roster[String(this.roomIndex)]?.find(
          (row) => row.actorId === pending.id,
        );
      if (academy && npc && this.roomIndex === ACADEMY_ROOM) {
        const fight = academyRosterFight(academy, npc.actorId, npc.battle, (room, event) =>
          this.eventState.sourceEventStateComplete(98, room, event),
        );
        if (fight) return this.runOpeningAction(fight);
      }
      return false;
    }
    if (pending.kind === "answer") {
      if (["arena", "round", "alliance", "locke", "info", "harry"].includes(pending.menu))
        return this.academyAnswer(pending.menu as AcademyMenu, pending.selected);
      if (pending.menu in PREP_CHOICES)
        return this.prepAnswer(pending.menu as PrepMenu, pending.selected);
      return this.openingAnswer(doc, pending.menu as OpeningMenu, pending.selected);
    }
    const done = (room: number, event: number) =>
      this.eventState.sourceEventStateComplete(98, room, event);
    const after = cauVongOpeningAfter(doc, pending.name);
    if (!after)
      return cauVongPrepAfter(pending.name)
        ? this.prepAfter(pending.name)
        : this.academyAfter(pending.name);
    switch (after.kind) {
      case "menu":
        return this.openingMenu(doc, after.menu);
      case "reconcile":
        // `action == 2`: 1:101 is the part's flag; `reconcile` hands over the mount and the lunch.
        if (this.sources.cauVongCues) this.repairOpening(doc, this.sources.cauVongCues);
        return false;
      case "deliver": {
        const lunch = String(doc.items.lunch.id);
        if (!done(FOREST_ROOM, LUNCH_DELIVERED) && (this.inventory[lunch] ?? 0) > 0) {
          this.eventEffects().consumeItem(doc.items.lunch.id, 1, 4);
          this.eventEffects().grantItem(doc.items.drink, 1, 4);
          this.eventState.op14CompleteEvent(98, FOREST_ROOM, LUNCH_DELIVERED);
        }
        return false;
      }
      case "clearGuard":
        // The guard repeats: its started flag and every checkpoint go once it is over.
        this.eventState.op42RepeatEvent(98, after.room, after.started);
        for (let i = 0; i < 1000; i++)
          this.eventState.op42RepeatEvent(98, after.room, after.cue + i);
        return false;
      case "egg":
        this.eventState.op14CompleteEvent(98, RUINS_INNER_ROOM, RUINS_EGG);
        this.eventState.op14CompleteEvent(98, RUINS_INNER_ROOM, RUINS_EGG_REWARD);
        this.applyOpeningCast();
        return false;
      case "cast":
        this.applyOpeningCast();
        return false;
    }
  }
  /** `ChoiceBox.optionUi` for one of the route's menus. */
  private openingMenu(doc: CauVongOpeningDocument, menu: OpeningMenu): boolean {
    const options =
      menu === "lucy"
        ? LUCY_CHOICE
        : menu === "merchant"
          ? MERCHANT_CHOICE
          : menu === "boyAccept"
            ? BOY_ACCEPT_CHOICE
            : boyPetChoice(doc, this.openingPets());
    this.openingChoices = menu === "boyPet" ? boyEligible(doc, this.openingPets()) : [];
    this.startScript(
      { scene: 98, room: this.roomIndex, group: -1 },
      `cau-vong:opening:${menu}`,
      openingMenuScript(OPENING_HOOK, menu, options),
    );
    return true;
  }
  /** `openPetChoice`'s slots, kept while the box is open (`petChoices`). */
  private openingChoices: number[] = [];
  /** `choose(action, answer)` and the lunch offer's answer. */
  private openingAnswer(doc: CauVongOpeningDocument, menu: OpeningMenu, selected: number): boolean {
    const part = (name: string, then?: [number, number][]) =>
      this.runOpeningAction({ kind: "part", name, part: doc.parts[name], then });
    const say = (text: string) => {
      this.startScript({ scene: 98, room: this.roomIndex, group: -1 }, "cau-vong:opening:refuse", [
        { type: "text", text, speaker: "", mode: 0, wait: true, kind: "dialog" },
      ]);
      return true;
    };
    if (menu === "lucy") {
      if (selected !== 0) return part("LUCY_DECLINE");
      // `complete(1, 103)` is the gift's own `started`.
      return part("LUNCH_GIFT");
    }
    if (menu === "merchant") {
      // `openSourceWorldShopFromWorld(s, 1, 4, 0)` / `openSourceVillagePetBankFromWorld(s, 1)`.
      if (selected === 0 || selected === 1)
        this.pendingService = {
          scene: 98,
          room: RUINS_ROOM,
          actorId: 1,
          dialogRow: -1,
          speaker: null,
          text: null,
          continuation: selected === 0 ? "WORLD_ITEM_SHOP" : "PET_BANK",
          dialogue: false,
          bankExpansion: false,
        };
      return false;
    }
    if (menu === "boyAccept") {
      if (selected !== 0) return part("BOY_DECLINE");
      // `complete(5, ACCEPTED)` then the acceptance line.
      this.eventState.op14CompleteEvent(98, RUINS_ROOM, 120);
      return part("BOY_ACCEPT");
    }
    // `choose(2, answer)`: the pet trade.
    const choices = this.openingChoices;
    this.openingChoices = [];
    if (selected >= choices.length) return part("BOY_DECLINE");
    const slot = choices[selected];
    if (!boyEligible(doc, this.openingPets()).includes(slot)) return say(BOY_PET_CHANGED);
    // `PetManagementService.confirmRelease`: another pet able to fight stays; its gear goes back.
    const others = this.pets.filter(
      (pet, i) => i !== slot && (pet.currentHp ?? pet.maxHp ?? 1) > 0,
    );
    if (others.length === 0) return say(BOY_PET_REFUSED);
    const [pet] = this.pets.splice(slot, 1),
      held = pet.heldEquipmentId ?? -1;
    if (held >= 0 && !this.bag.equipment.includes(held)) this.bag.equipment.push(held);
    this.pets.forEach((p, i) => (p.slot = i));
    for (const gift of doc.boy.reward) this.eventEffects().grantItem(gift.rewardId, gift.qty, 4);
    this.boyExtraGift(doc);
    this.eventState.op14CompleteEvent(98, RUINS_ROOM, BOY_TRADED);
    return part("BOY_REWARD");
  }
  // --- CV3: the arenas, the academy's days, Lạc Khắc and the alliance ---

  /** A line the runtimes write themselves (`say` / `TextBox.dialog(..., -1, -1)`). */
  private academyLine(speaker: string, text: string): boolean {
    this.startScript({ scene: 98, room: this.roomIndex, group: -1 }, "cau-vong:academy:line", [
      { type: "text", text, speaker, mode: -1, wait: true, kind: "dialog" },
    ]);
    return true;
  }
  /** A CV3 menu; the preliminaries' survives a reload by its 822001 marker, its reply first. */
  private academyMenu(menu: AcademyMenu, round: number, reply?: string): boolean {
    const academy = this.sources.cauVongAcademy;
    if (!academy) return false;
    if (menu === "arena") this.eventState.op14CompleteEvent(98, this.roomIndex, 822001);
    if (reply)
      return this.runOpeningAction({ kind: "part", name: reply, part: academy.parts[reply] });
    this.academyRound = round;
    const options =
      menu === "round"
        ? academy.choices.round[round]
        : menu === "info"
          ? academy.shop43.infoChoice
          : menu === "harry"
            ? academy.shop43.harryChoice
            : academy.choices[menu];
    this.startScript(
      { scene: 98, room: this.roomIndex, group: -1 },
      `cau-vong:academy:${menu}`,
      openingMenuScript(OPENING_HOOK, menu, options),
    );
    return true;
  }
  /** A CV3 menu's answer. */
  private academyAnswer(menu: AcademyMenu, selected: number): boolean {
    const academy = this.sources.cauVongAcademy;
    if (!academy) return false;
    const done = (room: number, event: number) =>
      this.eventState.sourceEventStateComplete(98, room, event);
    if (menu === "arena") this.eventState.op42RepeatEvent(98, this.roomIndex, 822001);
    if (menu === "alliance" && (selected === 0 || selected === 1)) {
      const speaker = academy.text.allianceSpeaker;
      if (selected === 0) {
        let collected = 0;
        for (let id = 100; id <= 201; id++) if (this.collection.collected(id)) collected++;
        const upgrade = allianceUpgrade(academy, done, collected);
        if (upgrade.mark) this.eventState.op14CompleteEvent(98, ...upgrade.mark);
        return this.academyLine(speaker, upgrade.text);
      }
      // `claimMedals`: a badge per collected Cầu Vồng species not yet counted (3:5000+id).
      let count = 0;
      for (let id = 100; id < 202; id++)
        if (this.collection.collected(id) && !done(CLASSROOM, academy.text.medals.base + id)) {
          this.eventState.op14CompleteEvent(98, CLASSROOM, academy.text.medals.base + id);
          count++;
        }
      this.currency.badges += count;
      return this.academyLine(speaker, medalLine(academy, count));
    }
    const action = cauVongAcademyAnswer(academy, menu, selected, this.academyRound, done);
    return action ? this.runOpeningAction(action) : false;
  }
  /** `after(part)` / `finish(phase)` of CV3's owners. */
  private academyAfter(name: string): boolean {
    const academy = this.sources.cauVongAcademy;
    if (!academy) return false;
    if (name === "DORM_SLEEP") {
      // `sideRoomSleepPending`: the manager's rest heals the roster (59:100).
      this.refreshPets();
      this.eventState.op14CompleteEvent(98, DORM, DORM_SLEPT);
      return false;
    }
    const after = cauVongAcademyAfter(academy, name);
    if (!after) return false;
    switch (after.kind) {
      case "marks": {
        const p = academy.parts[name];
        if (after.clearStarted && isAcademyBranchPart(name) && p.started >= 0)
          this.eventState.op42RepeatEvent(98, p.room, p.started);
        for (const [room, event] of after.marks) this.eventState.op14CompleteEvent(98, room, event);
        this.applyOpeningCast();
        // The academy hatchery's first scene ends by opening the shared incubator.
        return name === "HATCHERY" ? this.openCauVongIncubator() : false;
      }
      case "fight":
        return after.action ? this.runOpeningAction(after.action) : false;
      case "hideArena":
        this.hideArenaRivals();
        return false;
      case "arenaOver":
        // `finish(POST2)`: 4:104, then the source's transfer to the yard (250, 499) facing north.
        this.eventState.op14CompleteEvent(98, MIDDLE_ARENA, 104);
        return this.runOpeningAction({ kind: "exit", room: ACADEMY_ROOM, x: 250, y: 499, dir: 2 });
      case "revive":
        this.refreshPets();
        return false;
      case "morning":
        this.refreshPets();
        this.eventState.op14CompleteEvent(98, DORM, 102);
        return false;
      case "ceremony": {
        // The pass goes, the academy medal comes (once), 2:103.
        const pass = String(this.sources.cauVongPrep?.academy.pass.id ?? -1),
          medal = String(academy.award.id);
        if ((this.inventory[pass] ?? 0) > 0) {
          this.inventory[pass] -= 1;
          if (this.inventory[pass] <= 0) delete this.inventory[pass];
        }
        if ((this.inventory[medal] ?? 0) === 0) this.inventory[medal] = 1;
        this.eventState.op14CompleteEvent(98, ACADEMY_ROOM, 103);
        this.applyOpeningCast();
        return false;
      }
      case "hide": {
        const actor = this.actors.get(after.id);
        if (actor) actor.visible = false;
        return false;
      }
      case "menu":
        return this.academyMenu(after.menu, this.academyRound);
      case "action":
        return after.action ? this.runOpeningAction(after.action) : false;
    }
  }
  /** `handleBattleResult`'s `for(id = 1..3) actors[id].visible = false` in the middle arena. */
  private hideArenaRivals(): void {
    for (let id = 1; id <= 3; id++) {
      const actor = this.actors.get(id);
      if (actor) actor.visible = false;
    }
  }
  /** `startBattle` of a CV3 owner: the pending marker, the pre-fight stage, the fight. */
  private startAcademyBattle(key: string, fight: AcademyFight, restore?: string): boolean {
    const services = this.sources.battle,
      academy = this.sources.cauVongAcademy,
      request = academy?.battles[key];
    if (!services || !academy || !request || this.pets.length === 0) return false;
    if (fight.owner === "prelim")
      this.eventState.op14CompleteEvent(
        98,
        this.roomIndex,
        academy.flags.battlePending + fight.round,
      );
    if (restore) {
      const stage = this.cauVongStageOver(this.actors);
      for (const cue of academy.parts[restore].steps) restoreCue(stage, cue);
      this.cauVongPresentation.reset();
    }
    this.battle = createSourceTrainerBattle(
      services,
      { ...request, sceneId: this.sceneId },
      this.pets,
      this.inventory,
      this.battleItemCatalog(),
      { playerActorSpriteId: this.player.sprite, enemyActorSpriteId: 0 },
      this.battleCharms(true),
      this.currency,
    );
    this.prepareBattleSprites(this.battle);
    this.nextBattleEntryMode = request.background ?? 0;
    this.academyFight = fight;
    this.battleEncounter = undefined;
    this.markEnemiesSeen(this.battle);
    this.setPhase("battleEntry");
    return true;
  }
  /** The owner's `handleBattleResult`. */
  private academyBattleResult(won: boolean): boolean {
    const academy = this.sources.cauVongAcademy,
      fight = this.academyFight;
    this.academyFight = null;
    if (!academy || !fight) return false;
    const result = cauVongAcademyResult(academy, fight, won);
    if (!result) return false;
    for (const [room, event] of result.clear ?? [])
      this.eventState.op42RepeatEvent(98, room, event);
    for (const [room, event] of result.marks) this.eventState.op14CompleteEvent(98, room, event);
    if (result.kind === "part")
      return this.runOpeningAction({
        kind: "part",
        name: result.name,
        part: academy.parts[result.name],
      });
    if (result.heal) this.refreshPets();
    if (result.hideArena) this.hideArenaRivals();
    return this.academyLine(result.text.speaker, result.text.text);
  }
  // --- CV2: the egg lessons, the hatchery, Đông Phương, the café, the hub and the academy ---

  /** `ChoiceBox.optionUi` for one of CV2's menus. */
  private prepMenu(menu: PrepMenu): boolean {
    this.startScript(
      { scene: 98, room: this.roomIndex, group: -1 },
      `cau-vong:prep:${menu}`,
      openingMenuScript(OPENING_HOOK, menu, PREP_CHOICES[menu]),
    );
    return true;
  }
  /** A CV2 menu's answer: its marker goes, then the part it starts. */
  private prepAnswer(menu: PrepMenu, selected: number): boolean {
    const prep = this.sources.cauVongPrep;
    if (!prep) return false;
    if (menu !== "hatchery")
      this.eventState.op42RepeatEvent(98, this.roomIndex, 822000 + PREP_MENU_OWNER[menu]);
    const action = cauVongPrepAnswer(
      prep,
      menu,
      selected,
      this.openingContext(() => false, false),
    );
    if (!action) return false;
    // `choose(6, 0)`: the check starts the unlock (55:141) once the 40 species are in; answer 1
    // ("Mở bảng ấp trước") only opens the incubator.
    if (menu === "hatchery" && selected === 0) this.eventState.op14CompleteEvent(98, 55, 141);
    return this.runOpeningAction(action);
  }
  /** `after(part)` of CV2's owners. */
  private prepAfter(name: string): boolean {
    const prep = this.sources.cauVongPrep,
      cues = this.sources.cauVongCues;
    if (!prep) return false;
    const after = cauVongPrepAfter(name);
    if (!after) return false;
    const done = (room: number, event: number) =>
      this.eventState.sourceEventStateComplete(98, room, event);
    const exit = (room: number, x: number, y: number, dir: number) =>
      this.runOpeningAction({ kind: "exit", room, x, y, dir });
    switch (after.kind) {
      case "lesson": {
        // `openingStoryAfter`: the lesson is done, INCUBATOR_RETURN is started, the incubator opens;
        // `openingSource` plays INCUBATOR_RETURN once the panel is closed.
        this.eventState.op14CompleteEvent(98, 0, LESSON_DONE);
        const back = cues?.parts.INCUBATOR_RETURN;
        if (back) this.eventState.op14CompleteEvent(98, 0, back.started);
        return this.openCauVongIncubator();
      }
      case "incubator":
        if (after.cast) this.applyOpeningCast();
        return this.openCauVongIncubator();
      case "exit":
        return exit(after.room, after.x, after.y, after.dir);
      case "homeGift":
        if (!done(54, 131)) {
          this.currency.money = Math.min(2147483647, this.currency.money + HOME_GIFT);
          this.eventState.op14CompleteEvent(98, 54, 131);
        }
        return false;
      case "menu":
        return this.runOpeningAction({ kind: "prepMenu", menu: after.menu });
      case "branch": {
        // `MissingBranches.after`: the part's started marker goes, its marks, then the move.
        const p = prep.parts[name];
        if (isBranchPart(name) && p.started >= 0)
          this.eventState.op42RepeatEvent(98, p.room, p.started);
        for (const [room, event] of after.marks) this.eventState.op14CompleteEvent(98, room, event);
        this.applyOpeningCast();
        if (after.exit) {
          const [room, tx, ty, dir] = after.exit;
          return exit(room, tx * 20 + 10, ty * 20 + 19, dir);
        }
        return false;
      }
      case "hub": {
        // `summoning.after`: the first scene's started marker goes; 50:651100 is its flag.
        this.eventState.op42RepeatEvent(98, 50, prep.parts.HUB_ARRIVAL.started);
        this.applyOpeningCast();
        return false;
      }
      case "start":
        return this.runOpeningAction({
          kind: "part",
          name: after.name,
          part: prep.parts[after.name],
        });
      case "registered": {
        // `CauVongAcademySourceRuntime.after(REGISTER)`: registered, the preliminaries owed, the pass.
        this.eventState.op14CompleteEvent(98, ACADEMY_ROOM, ACADEMY_REGISTERED);
        if (!done(4, 104))
          this.eventState.op14CompleteEvent(98, ACADEMY_ROOM, prep.academy.prelimRequired);
        const pass = String(prep.academy.pass.id);
        if ((this.inventory[pass] ?? 0) === 0) this.inventory[pass] = 1;
        this.applyOpeningCast();
        return false;
      }
      case "cast":
        this.applyOpeningCast();
        return false;
    }
  }
  /**
   * `RainbowPetCommissioningService.acquire` for Đông Phương and the café's reward: the roster,
   * else the bank, else the full-party notice; once per receipt, then the closing scene.
   */
  private grantPrepPet(grant: "dong" | "cafe", next: string): boolean {
    const prep = this.sources.cauVongPrep;
    if (!prep) return false;
    const row = prep[grant];
    if (!this.eventState.sourceEventStateComplete(98, 44, row.receipt)) {
      if (!this.petHasSpace())
        return this.runOpeningAction({
          kind: "part",
          name: "CAPACITY",
          part: {
            room: 44,
            event: -1,
            flag: -1,
            started: -1,
            cue: -1,
            steps: [{ k: "say", speaker: "", text: prep.capacityText, portrait: -1 }],
          },
        });
      const toRoster = this.pets.length < 6,
        bank = this.meta.campaign.petBank,
        pet = this.buildSourcePet(
          row.species,
          row.level,
          -1,
          row.nature,
          toRoster ? this.pets.length : bank.length,
          [],
        );
      if (toRoster) this.pets.push(pet);
      else bank.push(pet);
      this.synchronizeGoldenBankReward();
      this.collectOwned(pet);
      this.eventState.op14CompleteEvent(98, 44, row.receipt);
    }
    // `grantRainbowRide(s, 5)`: Đông Phương is a mount as well.
    if (grant === "dong")
      this.eventState.op14CompleteEvent(98, 0, RAINBOW_RIDE_OWNED_EVENT + prep.dong.ride);
    return this.runOpeningAction({ kind: "part", name: next, part: prep.parts[next] });
  }
  /** `academySource.register`: 5.000 kim once (2:147), then the lesson or the registration. */
  private academyFee(): boolean {
    const prep = this.sources.cauVongPrep;
    if (!prep) return false;
    const done = (event: number) =>
      this.eventState.sourceEventStateComplete(98, ACADEMY_ROOM, event);
    const part = (name: string) =>
      this.runOpeningAction({ kind: "part", name, part: prep.parts[name] });
    if (!done(147)) {
      if (this.currency.money < ACADEMY_FEE) return part("ACADEMY_FEE_REFUSED");
      this.currency.money -= ACADEMY_FEE;
      this.eventState.op14CompleteEvent(98, ACADEMY_ROOM, 147);
    }
    return part(done(prep.parts.ACADEMY_TUITION.flag) ? "ACADEMY_REGISTER" : "ACADEMY_TUITION");
  }
  /** `CauVongLockeChainRuntime.applyCast` on the world's freshly loaded cast. */
  private applyLockeCast(): void {
    const doc = this.sources.cauVongLocke;
    if (!doc) return;
    const done = (room: number, event: number) =>
      this.eventState.sourceEventStateComplete(98, room, event);
    for (const { id, visible } of lockeCast(doc, this.roomIndex, done)) {
      const actor = this.actors.get(id);
      if (actor) actor.visible = visible;
    }
  }
  /**
   * `CauVongLockeChainRuntime.tick` in 52, 39 and 32: what a finished script or fight left to do,
   * then a resumed or new part, a fight or the challenge menu. False lets the room's own walk run.
   */
  private tickCauVongLocke(commands: InputCommand[]): boolean {
    const doc = this.sources.cauVongLocke,
      mechanics = this.cauVongMechanics();
    if (!doc || !mechanics) return false;
    const room = this.roomIndex,
      done = (r: number, event: number) => this.eventState.sourceEventStateComplete(98, r, event);
    const pending = this.lockePending;
    this.lockePending = null;
    if (pending?.kind === "after") {
      const next = afterLockePart(pending.name);
      if (next === "battle") return this.startLockeBattle(firstBattle(room), false);
      if (next === "choose") return this.lockeChoose();
      if (next === "cast") this.applyLockeCast();
      return false;
    }
    if (pending?.kind === "answer") {
      const answer = lockeChoice(doc, done, pending.selected);
      if (answer?.kind === "say") return this.lockeSay(answer.text);
      return this.runLockeAction(answer);
    }
    if (pending?.kind === "result") {
      const fight = this.lockeBattle;
      this.lockeBattle = null;
      if (!fight) return false;
      const result = lockeBattleResult(fight.room, fight.rematch, pending.won);
      if (result.kind === "say") return this.lockeSay(result.text);
      if (result.kind === "post") {
        this.eventState.op14CompleteEvent(98, fight.room, LOCKE_WON);
        return this.runLockeAction({
          kind: "part",
          name: result.name,
          part: doc.parts[result.name],
        });
      }
      return false;
    }
    const hero = this.cauVongHero(),
      confirm = commands.includes("confirm");
    return this.runLockeAction(
      cauVongLockeAction(doc, room, {
        done,
        requested: (id) => cauVongNpcRequested(hero, this.actors.values(), mechanics, id, confirm),
        player: this.player,
      }),
    );
  }
  private runLockeAction(action: ReturnType<typeof cauVongLockeAction>): boolean {
    if (!action) return false;
    if (action.kind === "battle") return this.startLockeBattle(action.battle, action.rematch);
    if (action.kind === "choose") return this.lockeChoose();
    // `start(p)`: the part, then (once its flag is written) whatever follows it.
    this.startCauVongPart(action.name as CauVongPartName, action.part, false, {
      hide: [],
      heroVisible: false,
      events: [{ type: "worldHook", hook: `${LOCKE_HOOK}after:${action.name}` }],
    });
    return true;
  }
  /** `choose`: "Khiêu chiến" / "Hay là tính"; the answer is read once the box has closed. */
  private lockeChoose(): boolean {
    this.startScript({ scene: 98, room: this.roomIndex, group: -1 }, "cau-vong:locke:choose", [
      { type: "choice", options: LOCKE_CHOICE, next: [1, 3] },
      { type: "worldHook", hook: `${LOCKE_HOOK}answer:0` },
      { type: "jump", next: 4 },
      { type: "worldHook", hook: `${LOCKE_HOOK}answer:1` },
    ]);
    return true;
  }
  /** `say`: one line of Lạc Khắc's, without a name tab (`TextBox.dialog(..., -1, -1)`). */
  private lockeSay(text: string): boolean {
    this.startScript({ scene: 98, room: this.roomIndex, group: -1 }, "cau-vong:locke:say", [
      { type: "text", text, speaker: LOCKE_SPEAKER, mode: -1, wait: true, kind: "dialog" },
    ]);
    return true;
  }
  /** `startBattle`: `request(room, rematch)` behind the battle-entry wipe. */
  private startLockeBattle(key: string, rematch: boolean): boolean {
    const services = this.sources.battle,
      request = this.sources.cauVongLocke?.battles[key];
    if (!services || !request || this.pets.length === 0) return false;
    this.battle = createSourceTrainerBattle(
      services,
      { ...request, sceneId: this.sceneId },
      this.pets,
      this.inventory,
      this.battleItemCatalog(),
      { playerActorSpriteId: this.player.sprite, enemyActorSpriteId: 0 },
      this.battleCharms(true),
      this.currency,
    );
    this.prepareBattleSprites(this.battle);
    this.nextBattleEntryMode = request.background ?? 0;
    this.lockeBattle = { room: this.roomIndex, rematch };
    this.battleEncounter = undefined;
    this.markEnemiesSeen(this.battle);
    this.setPhase("battleEntry");
    return true;
  }
  // --- CV4a: Bốn Cổng (`CauVongFourGateSourceRuntime`), its rooms' walkers, the masked pair ---

  private fourGates(): FourGatesOwner | null {
    const doc = this.sources.cauVongFourGates;
    if (!doc) return null;
    return (this.fourGatesOwner ??= new FourGatesOwner(doc));
  }
  /** What the owner reads and writes this tick. */
  private fourGatesWorld(confirm: boolean): LabWorld {
    const mechanics = this.cauVongMechanics(),
      hero = this.cauVongHero();
    const done = (room: number, event: number) =>
      this.eventState.sourceEventStateComplete(98, room, event);
    const count = (id: number) => this.inventory[String(id)] ?? 0;
    return {
      done,
      mark: (room, event) => this.eventState.op14CompleteEvent(98, room, event),
      clear: (room, event) => this.eventState.op42RepeatEvent(98, room, event),
      requested: (id) =>
        !!mechanics && cauVongNpcRequested(hero, this.actors.values(), mechanics, id, confirm),
      at: (x, y, width, height) =>
        playerIntersectsSourceRect(this.player.x, this.player.y, { x, y, width, height }),
      point: (x, y, width, height) =>
        playerSourcePointInRect(this.player.x, this.player.y, { x, y, width, height }),
      confirm,
      show: (id, visible) => {
        const actor = this.actors.get(id);
        if (actor) actor.visible = visible;
      },
      visible: (id) => this.actors.get(id)?.visible ?? false,
      // `reviveFull` and `statusState.clearAll` over the roster.
      revive: () => this.refreshPets(),
      itemCount: count,
      addItem: (item, qty) => (this.inventory[String(item.id)] = count(item.id) + qty),
      removeItem: (id, qty) => {
        const left = count(id) - qty;
        if (left > 0) this.inventory[String(id)] = left;
        else delete this.inventory[String(id)];
      },
      money: () => this.currency.money,
      pay: (amount) => (this.currency.money = Math.max(0, this.currency.money - amount)),
      petSpace: () => this.petHasSpace(),
      // `giftFits`: received, item 14, or room under 99 in the list it lands in.
      giftFits: (award) => {
        if (done(award.room, award.receipt) || award.kind === "NONE") return true;
        if (award.kind === "MATERIAL")
          return (this.bag.materials[String(award.rewardId)] ?? 0) + award.qty <= 99;
        if (award.kind === "SPECIAL")
          return this.bag.specials.filter((id) => id === award.rewardId).length + award.qty <= 99;
        if (award.kind === "EQUIPMENT") return true;
        return count(award.rewardId) + award.qty <= 99;
      },
      releaseCactus: () => {
        // `confirmRelease` of the lowest Cự Thứ Tiên Chưởng from 55; another living pet stays.
        let slot = -1;
        this.pets.forEach((pet, i) => {
          if (
            pet.speciesId === 111 &&
            pet.level >= 55 &&
            (slot < 0 || pet.level < this.pets[slot].level)
          )
            slot = i;
        });
        if (slot < 0) return false;
        if (!this.pets.some((pet, i) => i !== slot && (pet.currentHp ?? pet.maxHp ?? 1) > 0))
          return false;
        const [pet] = this.pets.splice(slot, 1),
          held = pet.heldEquipmentId ?? -1;
        if (held >= 0 && !this.bag.equipment.includes(held)) this.bag.equipment.push(held);
        this.pets.forEach((p, i) => (p.slot = i));
        return true;
      },
      grantPet: (pet) => this.cauVongStageOver(this.actors).pet(pet),
      // `CauVongDormPetQuest.hasSpace`: free party slots plus free bank slots.
      petRoom: (count) =>
        Math.max(0, 6 - this.pets.length) +
          Math.max(0, this.petBankCapacity() - this.meta.campaign.petBank.length) >=
        count,
      releaseSnake: () => {
        // `returnPet`: `confirmRelease` of the lowest Thiết Giáp Xà (122); another living pet stays.
        let slot = -1;
        this.pets.forEach((pet, i) => {
          if (pet.speciesId === 122 && (slot < 0 || pet.level < this.pets[slot].level)) slot = i;
        });
        if (slot < 0) return false;
        if (!this.pets.some((pet, i) => i !== slot && (pet.currentHp ?? pet.maxHp ?? 1) > 0))
          return false;
        const [pet] = this.pets.splice(slot, 1),
          held = pet.heldEquipmentId ?? -1;
        if (held >= 0 && !this.bag.equipment.includes(held)) this.bag.equipment.push(held);
        this.pets.forEach((p, i) => (p.slot = i));
        return true;
      },
      allianceUpgrade: () => {
        const academy = this.sources.cauVongAcademy;
        if (!academy) return "";
        let collected = 0;
        for (let id = 100; id <= 201; id++) if (this.collection.collected(id)) collected++;
        const upgrade = allianceUpgrade(academy, done, collected);
        if (upgrade.mark) this.eventState.op14CompleteEvent(98, ...upgrade.mark);
        return upgrade.text;
      },
      claimMedals: () => {
        // `claimMedals`: a badge per collected Cầu Vồng species not yet counted (3:5000+id).
        const base = this.sources.cauVongAcademy?.text.medals.base;
        if (base === undefined) return 0;
        let n = 0;
        for (let id = 100; id < 202; id++)
          if (this.collection.collected(id) && !done(CLASSROOM, base + id)) {
            this.eventState.op14CompleteEvent(98, CLASSROOM, base + id);
            n++;
          }
        this.currency.badges += n;
        return n;
      },
    };
  }
  /** `CauVongFourGateSourceRuntime.applyCast`, the 52 lever's frame and the ruins' masked pair. */
  private applyFourGatesCast(): void {
    const doc = this.sources.cauVongFourGates;
    if (!doc) return;
    const done = (room: number, event: number) =>
      this.eventState.sourceEventStateComplete(98, room, event);
    const show = (id: number, visible: boolean) => {
      const actor = this.actors.get(id);
      if (actor) actor.visible = visible;
    };
    if (this.roomIndex === RUINS_ROOM) for (const [id, on] of maskedCast(doc, done)) show(id, on);
    const stage = this.cauVongStageOver(this.actors);
    // Rừng Gai (11) is the opening's room on the web, but its rival is the four gates'.
    if (isFourGateRoom(this.roomIndex) || this.roomIndex === THORN_ROOM) {
      const cast = fourGatesCast(doc, this.roomIndex, done);
      for (const cue of cast.cues) restoreCue(stage, cue);
      for (const [id, visible] of cast.visible) show(id, visible);
      for (const [id, state] of cast.state) {
        const actor = this.actors.get(id);
        if (!actor) continue;
        if (actor.state !== state) actor.animationTick = 0;
        actor.state = state;
      }
    }
    // CV4b: the forest's (38–40) and the north rescue's (26) casts.
    const forest = this.sources.cauVongForest;
    if (forest) {
      const cast = forestCast(forest, this.roomIndex, done);
      for (const cue of cast.cues) restoreCue(stage, cue);
      for (const [id, visible] of cast.visible) show(id, visible);
      // CV5b: the laboratory's props (62) and the farewell pair (60).
      const lab = laboratoryCast(forest, this.roomIndex, done);
      for (const [id, visible] of lab.visible) show(id, visible);
      for (const [id, state] of lab.state) {
        const actor = this.actors.get(id);
        if (!actor) continue;
        if (actor.state !== state) actor.animationTick = 0;
        actor.state = state;
      }
    }
    // CV4c: the classroom's, the bird trail's, the lab's, the dorm's and Thiết Giáp Xà's casts.
    const lab = this.sources.cauVongLab;
    if (lab) {
      const cast = labCast(lab, this.roomIndex, done);
      for (const cue of cast.cues) restoreCue(stage, cue);
      for (const [id, visible] of cast.visible) show(id, visible);
      for (const [id, state] of cast.state) {
        const actor = this.actors.get(id);
        if (!actor) continue;
        if (actor.state !== state) actor.animationTick = 0;
        actor.state = state;
      }
    }
    // CV5: the North Sea's arrival, source and continuation casts.
    const sea = this.sources.cauVongNorthSea;
    if (sea) {
      const cast = northSeaCast(sea, this.roomIndex, done);
      for (const cue of cast.cues) restoreCue(stage, cue);
      for (const [id, visible] of cast.visible) show(id, visible);
      for (const [id, state] of cast.state) {
        const actor = this.actors.get(id);
        if (!actor) continue;
        if (actor.state !== state) actor.animationTick = 0;
        actor.state = state;
      }
    }
    // A cast restore never changes the screen presentation.
    this.cauVongPresentation.reset();
  }
  /**
   * `CauVongChapterRuntime.tick` in the four gates' rooms: the owner, then the room's walker. False
   * lets the free world walk the room (its routes, its encounters).
   */
  private tickCauVongFourGates(commands: InputCommand[]): boolean {
    const owner = this.fourGates(),
      doc = this.sources.cauVongFourGates;
    if (!owner || !doc || !this.cauVongMechanics()) return false;
    const confirm = commands.includes("confirm"),
      w = this.fourGatesWorld(confirm);
    if (this.runFourGatesAction(owner.tick(w, this.roomIndex))) return true;
    // CV4c: `fourGateExam` (9) after the owner; `CauVongWestGateRuntime`'s lab and bird trail.
    const lab = this.lab();
    if (lab && this.roomIndex === 9 && this.runFourGatesAction(lab.exam(w))) return true;
    if (lab && this.runFourGatesAction(lab.west(w, this.roomIndex))) return true;
    // CV4b: 10's way up to 60 (`CauVongChapterRuntime.tick`), the north gate (`CauVongNorthGateRuntime`).
    const forest = this.forest();
    if (
      forest &&
      this.roomIndex === LOST_PET_ROOM &&
      this.runFourGatesAction(forest.lostPetChamber(w))
    )
      return true;
    if (forest && this.runFourGatesAction(forest.north(w, this.roomIndex))) return true;
    const walker = fourGatesWalker(doc, this.roomIndex, w, confirm);
    if (walker?.kind === "lever")
      return this.runFourGatesAction({ kind: "part", name: "SOUTH_LEVER", part: walker.part });
    if (walker?.kind === "line") {
      w.mark(18, 100);
      return this.runFourGatesAction({
        kind: "text",
        steps: [{ k: "say", speaker: walker.text.speaker, text: walker.text.text, portrait: -1 }],
      });
    }
    return false;
  }
  /** A finished script's or fight's follow-up. */
  private tickFourGatesPending(): boolean {
    const owner = this.fourGates(),
      pending = this.fourGatesPending;
    this.fourGatesPending = null;
    if (!owner || !pending) return false;
    // ProMax: Kim Diễm's fight is saved once its result has replaced the battle marker. A loss
    // leaves the hero in room 49 to talk to him again (owner: no recovery teleport after a loss).
    if (pending.kind === "result" && pending.key === KIM_DIEM_BATTLE_KEY) this.saveRequested = true;
    const w = this.fourGatesWorld(false),
      room = this.roomIndex;
    const forest = this.forest(),
      lab = this.lab(),
      sea = this.northSea(),
      city = this.city(),
      branches = this.branches(),
      summoning = this.summoning();
    switch (pending.kind) {
      case "after":
        if (summoning?.owns(pending.name))
          return this.runFourGatesAction(
            summoning.after(this.summonWorld(false), pending.name, room),
          );
        if (branches?.owns(pending.name))
          return this.runFourGatesAction(branches.after(this.branchWorld(false), pending.name));
        if (city?.owns(pending.name)) return this.runFourGatesAction(city.after(pending.name));
        if (sea?.owns(pending.name))
          return this.runFourGatesAction(sea.after(this.northSeaWorld(false), pending.name, room));
        if (lab?.owns(pending.name)) return this.runFourGatesAction(lab.after(w, pending.name));
        if (forest?.owns(pending.name))
          return this.runFourGatesAction(forest.after(w, pending.name));
        if (pending.name === "MASKED_BEFORE" || pending.name === "MASKED_AFTER")
          return this.runFourGatesAction(owner.maskedOver(w));
        if (pending.name === "SOUTH_LEVER") {
          // `CauVongSwitchMechanisms.apply`: the gate opens with the lever.
          this.applyOpeningCast();
          return this.runFourGatesAction({ kind: "cast" });
        }
        return this.runFourGatesAction(owner.after(w, pending.name, room));
      case "notice":
        // A side room's line hands nothing on.
        if (city && this.inCitySideRoom()) return false;
        if (branches && room === AUX_ROOM) return false;
        if (summoning && summoningRoom(room)) {
          const next = summoning.notice(this.summonWorld(false), room);
          if (next) return this.runFourGatesAction(next);
          if (isSummonRoom(room)) return false;
        }
        if (sea && northSeaOwnsRoom(room))
          return this.runFourGatesAction(sea.notice(this.northSeaWorld(false), room));
        return this.runFourGatesAction(owner.notice(w, room));
      case "answer":
        if (summoning && pending.owner >= SUMMON_MENU_BASE)
          return this.runFourGatesAction(
            summoning.answer(this.summonWorld(false), pending.owner, pending.selected, room),
          );
        if (branches && pending.owner >= BRANCH_MENU_BASE)
          return this.runFourGatesAction(
            branches.answer(this.branchWorld(false), pending.owner, pending.selected, room),
          );
        if (city && pending.owner >= CITY_MENU_BASE)
          return this.runFourGatesAction(
            city.answer(this.cityWorld(false), pending.owner, pending.selected),
          );
        if (sea && pending.owner > NORTH_SEA_MENU_BASE)
          return this.runFourGatesAction(
            sea.answer(this.northSeaWorld(false), pending.owner, pending.selected, room),
          );
        if (lab && pending.owner === LAB_MENU)
          return this.runFourGatesAction(lab.answer(w, pending.selected));
        if (forest && pending.owner >= FOREST_MERCHANT_MENU)
          return this.runFourGatesAction(forest.answer(w, pending.owner, pending.selected, room));
        return this.runFourGatesAction(owner.answer(w, pending.owner, pending.selected, room));
      case "result":
        if (summoning?.owns(pending.key)) {
          const played = this.runFourGatesAction(
            summoning.result(this.summonWorld(false), pending.key, pending.won),
          );
          return played || pending.key === KIM_DIEM_BATTLE_KEY;
        }
        if (sea?.owns(pending.key))
          return this.runFourGatesAction(
            sea.result(this.northSeaWorld(false), pending.key, pending.won),
          );
        if (lab && lab.owns(pending.key))
          return this.runFourGatesAction(lab.result(w, pending.key, pending.won));
        if (forest && pending.key.startsWith("forest:"))
          return this.runFourGatesAction(forest.result(w, pending.key, pending.won));
        return this.runFourGatesAction(
          pending.masked ? owner.maskedResult(w, pending.won) : owner.result(w, pending.won),
        );
    }
  }
  private runFourGatesAction(action: FourGatesAction): boolean {
    if (!action) return false;
    const hook = (tail: string): RuntimeStoryEvent => ({
      type: "worldHook",
      hook: `${FOUR_GATES_HOOK}${tail}`,
    });
    switch (action.kind) {
      case "part": {
        if (action.restore) {
          const stage = this.cauVongStageOver(this.actors);
          for (const cue of action.restore) restoreCue(stage, cue);
          this.cauVongPresentation.reset();
        }
        this.startCauVongPart(action.name as CauVongPartName, action.part, action.clear ?? false, {
          hide: [],
          heroVisible: true,
          events: [hook(`after:${action.name}`)],
        });
        return true;
      }
      case "text":
        // `replay` / `say`: dialogue only (no checkpoints, no flag), then `notice`.
        this.startCauVongPart(
          "FOUR_GATES_TEXT" as CauVongPartName,
          { room: this.roomIndex, event: -1, flag: -1, started: -1, cue: -1, steps: action.steps },
          false,
          { hide: [], heroVisible: true, events: [hook("notice")] },
        );
        return true;
      case "menu": {
        const events: RuntimeStoryEvent[] = [
          {
            type: "choice",
            options: action.options,
            next: action.options.map((_, i) => 1 + i * 2),
          },
        ];
        action.options.forEach((_, i) => {
          events.push(hook(`answer:${action.owner}:${i}`));
          events.push({ type: "jump", next: 1 + action.options.length * 2 });
        });
        this.startScript(
          { scene: 98, room: this.roomIndex, group: -1 },
          `cau-vong:four-gates:menu:${action.owner}`,
          events,
        );
        return true;
      }
      case "battle":
        if (action.restore) {
          // `startBattle(b, true)`: a resumed fight restores its scene first.
          const stage = this.cauVongStageOver(this.actors);
          for (const cue of action.restore) restoreCue(stage, cue);
          this.cauVongPresentation.reset();
        }
        return this.startFourGatesBattle(action.key);
      case "bank":
        // `openSourceVillagePetBankFromWorld`.
        this.pendingService = {
          scene: 98,
          room: this.roomIndex,
          actorId: -1,
          dialogRow: -1,
          speaker: null,
          text: null,
          continuation: "PET_BANK",
          shopCategory: 0,
          dialogue: false,
          bankExpansion: false,
        };
        return true;
      case "then":
        return this.runFourGatesAction(action.first) || this.runFourGatesAction(action.next);
      case "shop":
        // `openShopUi`: the Cầu Vồng shop (category 0 unless named); the farewell waits for its flag.
        this.pendingService = {
          scene: 98,
          room: this.roomIndex,
          actorId: -1,
          dialogRow: -1,
          speaker: null,
          text: null,
          continuation: "CAU_VONG_SHOP",
          shopCategory: action.category ?? 0,
          dialogue: false,
          bankExpansion: false,
        };
        return true;
      case "exit":
        if (!this.sources.room(98, action.room)) return false;
        if (this.sources.roomReady && !this.sources.roomReady(98, action.room)) {
          this.sources.prepareRoom?.(98, action.room);
          return false;
        }
        this.loadRoom(98, action.room, action.x, action.y, action.dir ?? this.player.direction);
        return true;
      case "cast":
        this.applyFourGatesCast();
        return false;
      case "incubator":
        return this.openCauVongIncubator();
      case "evolve":
        // `evolutionNoticeArmed = true; openSourceConveniencePetstate(1)`.
        this.evolutionNoticeArmed = true;
        this.pendingService = {
          scene: 98,
          room: this.roomIndex,
          actorId: -1,
          dialogRow: -1,
          speaker: null,
          text: null,
          continuation: "CONVENIENCE_EVOLVE",
          shopCategory: 0,
          dialogue: false,
          bankExpansion: false,
        };
        return true;
      case "hold":
        return true;
    }
  }
  /** `openIncubator()`: the shared five-slot Cầu Vồng incubator panel. */
  private openCauVongIncubator(): boolean {
    this.pendingService = {
      scene: 98,
      room: this.roomIndex,
      actorId: -1,
      dialogRow: -1,
      speaker: null,
      text: null,
      continuation: "CAU_VONG_INCUBATOR",
      shopCategory: 0,
      dialogue: false,
      bankExpansion: false,
    };
    return true;
  }
  private lab(): LabOwner | null {
    const doc = this.sources.cauVongLab;
    if (!doc) return null;
    return (this.labOwner ??= new LabOwner(doc));
  }
  // --- CV5: Bắc Hải ---

  private branches(): BranchesOwner | null {
    const doc = this.sources.cauVongBranches;
    if (!doc) return null;
    return (this.branchesOwner ??= new BranchesOwner(doc));
  }
  /** The side rooms' world with the purse, the bank's pets and the bag's room. */
  private branchWorld(confirm: boolean): BranchWorld {
    const city = this.cityWorld(confirm);
    return {
      ...city,
      ownsPet: (species) =>
        this.pets.some((pet) => pet.speciesId === species) ||
        this.meta.campaign.petBank.some((pet) => pet.speciesId === species),
      badges: () => this.currency.badges,
      spendBadges: (n) => (this.currency.badges = Math.max(0, this.currency.badges - n)),
      money: () => this.currency.money,
      earn: (money) => (this.currency.money += money),
      earnBadges: (n) => (this.currency.badges += n),
      bagFits: (item, qty) => city.stock(item) + qty <= 99,
    };
  }
  /** 67: `missingBranches.tick`, `extraDoors`, the residents, the walk, `extraDoors` again. */
  private tickCauVongBranches(commands: InputCommand[]): WorldAction {
    const branches = this.branches();
    if (!branches || !this.cauVongMechanics()) return null;
    if (this.pendingService) return null;
    const room = this.roomIndex,
      w = this.branchWorld(commands.includes("confirm"));
    const action = branches.tick(w, room);
    if (action && this.runFourGatesAction(action)) return this.takeSaveRequest();
    const before = branches.exit(w, room);
    if (before) return this.runFourGatesAction(before) ? "autosave" : null;
    const resident = branches.residents(w, room);
    if (resident && this.runFourGatesAction(resident)) return this.takeSaveRequest();
    const moved = this.move(commands);
    const after = branches.exit(this.branchWorld(false), room);
    if (after) return this.runFourGatesAction(after) ? "autosave" : null;
    if (!moved) this.afterFreeMovement(false);
    return this.takeSaveRequest();
  }
  /** `MissingBranches.applyCast` in 67 and 50: the finished parts' cast. */
  private applyBranchesCast(): void {
    const branches = this.branches();
    if (!branches || (this.roomIndex !== AUX_ROOM && this.roomIndex !== 50)) return;
    const cues = branches.cast(this.roomIndex, (room, event) =>
      this.eventState.sourceEventStateComplete(98, room, event),
    );
    if (cues.length === 0) return;
    const stage = this.cauVongStageOver(this.actors);
    for (const cue of cues) restoreCue(stage, cue);
    this.cauVongPresentation.reset();
  }
  // --- CV0': Thiên Không ---

  private summoning(): SummoningOwner | null {
    const doc = this.sources.cauVongSummoning,
      sea = this.sources.cauVongNorthSea;
    if (!doc || !sea) return null;
    return (this.summoningOwner ??= new SummoningOwner(doc, sea.passives));
  }
  private minigameRules(): CauVongMinigame | null {
    const doc = this.sources.cauVongSummoning;
    if (!doc) return null;
    return (this.minigameRulesOwner ??= new CauVongMinigame(doc.minigame));
  }
  /** `progression.cauVongMinigame`, saved with the campaign. */
  get cauVongMinigame(): CauVongMinigameState {
    // A board read from a save is checked once (`CauVongMinigameState.restore`): malformed is closed.
    const campaign = this.meta.campaign,
      current = campaign.cauVongMinigame;
    if (current && CHECKED_MINIGAMES.has(current)) return current;
    const board = current ? restoreMinigame(current) : closedMinigame();
    CHECKED_MINIGAMES.add(board);
    return (campaign.cauVongMinigame = board);
  }
  /** `CauVongSummoningMinigame.active`: a board is open in scene 98. */
  get cauVongMinigameOpen(): boolean {
    return this.sceneId === 98 && (this.meta.campaign.cauVongMinigame?.room ?? -1) >= 0;
  }
  /** What `CauVongMinigameView` draws: the board, its tables, the purse and the streak receipt. */
  get cauVongMinigameView(): {
    m: CauVongMinigameState;
    tables: CauVongSummoningDocument["minigame"];
    money: number;
    streakPaid: boolean;
  } | null {
    const doc = this.sources.cauVongSummoning;
    if (!doc || !this.cauVongMinigameOpen) return null;
    return {
      m: this.cauVongMinigame,
      tables: doc.minigame,
      money: this.currency.money,
      streakPaid: this.eventState.sourceEventStateComplete(98, doc.streak.room, doc.streak.receipt),
    };
  }
  /** A press on the open board (the host routes it here instead of the world). */
  minigamePointer(x: number, y: number): void {
    this.minigameTap = { x, y };
  }
  private summonWorld(confirm: boolean): SummonWorld {
    return {
      ...this.branchWorld(confirm),
      // Kim Diễm's reward (ProMax): two Long pets need two free places, in the party or the
      // 1.000-slot bank the reward opens.
      kimDiemRewardFits: () =>
        this.kimDiemRewardClaimed() ||
        Math.max(0, 6 - this.pets.length) +
          Math.max(0, KIM_DIEM_BANK_CAPACITY - this.meta.campaign.petBank.length) >=
          2,
      grantKimDiemReward: () => {
        if (this.kimDiemRewardClaimed()) return;
        // Kim Diễm Long Vương (280) and Tàn Nguyệt Long Ma (278), level 5, 5★.
        const pets = [280, 278].map((id) => this.buildSourcePet(id, 5, 5, 0, 0, []));
        for (const pet of pets) {
          const storage = this.pets.length < 6 ? this.pets : this.meta.campaign.petBank;
          pet.slot = storage.length;
          storage.push(pet);
          this.synchronizeGoldenBankReward();
          this.collectOwned(pet);
        }
        if (!this.bag.equipment.includes(KIM_DIEM_AMULET_ID))
          this.bag.equipment.push(KIM_DIEM_AMULET_ID);
        this.eventState.op14CompleteEvent(98, KIM_DIEM_ROOM, KIM_DIEM_REWARD_RECEIPT);
        this.saveRequested = true;
      },
      grant: (cue) => {
        const stage = this.cauVongStageOver(this.actors);
        if (cue.k === "pet") stage.pet(cue);
        else if (cue.k === "award") stage.award(cue);
        else stage.mark(cue.room, cue.event);
      },
      openMinigame: (kind, difficulty) =>
        this.minigameRules()?.open(
          this.cauVongMinigame,
          this.roomIndex,
          kind,
          difficulty,
          Math.floor(Math.random() * 0x7fffffff),
        ),
      streak: () => this.cauVongMinigame.streak,
    };
  }
  /** The summon rooms 51, 63–66: `summoning.tick`, the walk, `CauVongNorthSeaRoutes.exit`. */
  private tickCauVongSummonRoom(commands: InputCommand[]): WorldAction {
    const owner = this.summoning(),
      sea = this.northSea();
    if (!owner || !sea || !this.cauVongMechanics()) return null;
    if (this.pendingService) return null;
    const room = this.roomIndex;
    const action = owner.tick(this.summonWorld(commands.includes("confirm")), room);
    if (action && this.runFourGatesAction(action)) return this.takeSaveRequest();
    const moved = this.move(commands);
    const after = sea.exit(this.northSeaWorld(false), room);
    if (after) return this.runFourGatesAction(after) ? "autosave" : null;
    if (this.afterFreeMovement(moved)) return null;
    return this.takeSaveRequest();
  }
  /** `CauVongSummoningMinigame.tick` (and `pointer`): the board, its kim and its wins. */
  private tickCauVongMinigame(commands: InputCommand[]): WorldAction {
    const rules = this.minigameRules(),
      m = this.cauVongMinigame;
    if (!rules) return null;
    const tap = this.minigameTap;
    this.minigameTap = null;
    let confirm = commands.includes("confirm"),
      back = commands.includes("back");
    if (tap) {
      const key = rules.pointer(m, tap.x, tap.y);
      if (key === "confirm") confirm = true;
      if (key === "back") back = true;
    }
    const streak = this.sources.cauVongSummoning!.streak;
    rules.tick(
      m,
      this.roomIndex,
      {
        left: commands.includes("left"),
        right: commands.includes("right"),
        up: commands.includes("up"),
        down: commands.includes("down"),
        holdLeft: commands.includes("holdLeft"),
        holdRight: commands.includes("holdRight"),
        confirm,
        back,
      },
      {
        money: () => this.currency.money,
        setMoney: (value) => (this.currency.money = value),
        done: (room, event) => this.eventState.sourceEventStateComplete(98, room, event),
        mark: (room, event) => this.eventState.op14CompleteEvent(98, room, event),
        petSpace: () => this.petHasSpace(),
        streakPet: () => {
          if (!this.petHasSpace()) return false;
          this.cauVongStageOver(this.actors).pet({
            k: "pet",
            room: streak.room,
            receipt: streak.receipt,
            species: streak.species,
            level: streak.level,
            nature: 0,
            ride: -1,
          });
          return true;
        },
      },
    );
    return m.room < 0 ? "autosave" : null;
  }
  /** `CauVongSummoningRuntime.applyCast`: Long Vương in 49, the won summoners' poses. */
  private applySummoningCast(): void {
    const owner = this.summoning(),
      doc = this.sources.cauVongSummoning;
    if (!owner || !doc || !summoningRoom(this.roomIndex)) return;
    if (this.roomIndex === SKY_CITY_ROOM) {
      const dragon = this.actors.get(doc.longVuong.actor);
      if (dragon) {
        dragon.sprite = doc.longVuong.sprite;
        dragon.state = 0;
        dragon.animationTick = 0;
        dragon.renderOrientation = 0;
        dragon.renderOffsetX = 0;
        dragon.renderOffsetY = 0;
        this.sources.prepareSprite?.(doc.longVuong.sprite);
      }
    }
    const cues = owner.cast(this.roomIndex, (room, event) =>
      this.eventState.sourceEventStateComplete(98, room, event),
    );
    if (cues.length === 0) return;
    const stage = this.cauVongStageOver(this.actors);
    for (const cue of cues) restoreCue(stage, cue);
    this.cauVongPresentation.reset();
  }
  /** `CauVongBranchTreasures.render`: this room's shown chests, shut (54) or open (55). */
  get cauVongTreasures(): { x: number; y: number; open: boolean }[] {
    const branches = this.sceneId === 98 ? this.branches() : null;
    if (!branches) return [];
    const done = (room: number, event: number) =>
      this.eventState.sourceEventStateComplete(98, room, event);
    return branches.treasures(this.roomIndex).flatMap((t, row) =>
      t.state === -1
        ? []
        : [
            {
              x: t.x * 20 + 10,
              y: t.y * 20 + 20,
              open: t.state === 2 || branches.opened(this.roomIndex, row, done),
            },
          ],
    );
  }
  private city(): CityOwner | null {
    const doc = this.sources.cauVongCity;
    if (!doc) return null;
    return (this.cityOwner ??= new CityOwner(doc));
  }
  /** 45/46/56 as the city's (`sharedRoomActive` unset for 45 and 56). */
  private inCitySideRoom(): boolean {
    return (
      this.sceneId === 98 &&
      isCitySideRoom(this.roomIndex) &&
      !(
        isNorthSeaRoom(this.roomIndex) &&
        northSeaShared(this.roomIndex, (room, event) =>
          this.eventState.sourceEventStateComplete(98, room, event),
        )
      )
    );
  }
  /** The side rooms' world: the North Sea's, with stock by inventory kind. */
  private cityWorld(confirm: boolean): CityWorld {
    const stock = (item: CityItem): number => {
      if (item.kind === "MATERIAL") return this.bag.materials[String(item.id)] ?? 0;
      if (item.kind === "SPECIAL") return this.bag.specials.filter((id) => id === item.id).length;
      if (item.kind === "EQUIPMENT")
        return this.bag.equipment.filter((id) => id === item.id).length;
      return this.inventory[String(item.id)] ?? 0;
    };
    return {
      ...this.northSeaWorld(confirm),
      stock,
      take: (item, qty) => {
        if (item.kind === "MATERIAL") {
          const left = stock(item) - qty;
          if (left > 0) this.bag.materials[String(item.id)] = left;
          else delete this.bag.materials[String(item.id)];
          return;
        }
        if (item.kind === "SPECIAL" || item.kind === "EQUIPMENT") {
          const list = item.kind === "SPECIAL" ? this.bag.specials : this.bag.equipment;
          for (let i = 0; i < qty; i++) {
            const at = list.indexOf(item.id);
            if (at >= 0) list.splice(at, 1);
          }
          return;
        }
        const left = stock(item) - qty;
        if (left > 0) this.inventory[String(item.id)] = left;
        else delete this.inventory[String(item.id)];
      },
      // `sourceAddItemReward` (BAG), `op18Material` (MATERIAL), `sourceGrantSpecialReward` (SPECIAL).
      give: (item, qty) =>
        this.eventEffects().grantItem(
          item.id,
          qty,
          item.kind === "SPECIAL"
            ? 5
            : item.kind === "MATERIAL" || item.kind === "EQUIPMENT"
              ? 3
              : 4,
        ),
    };
  }
  /**
   * `tickSideRoom` in 45, 46 and 56 from the city: `CauVongOpeningSideQuests`, the residents, then the
   * way out before and after the walk (`tickFreeWorldPlayerWithoutEncounters`).
   */
  private tickCauVongCity(commands: InputCommand[]): WorldAction {
    const city = this.city();
    if (!city || !this.cauVongMechanics()) return null;
    const room = this.roomIndex,
      w = this.cityWorld(commands.includes("confirm"));
    // The host takes a pending service first; the world does not tick while the panel is up.
    if (this.pendingService) return null;
    const action = city.tick(w, room);
    if (action && this.runFourGatesAction(action)) return this.takeSaveRequest();
    const before = city.exit(w, room);
    if (before) return this.runFourGatesAction(before) ? "autosave" : null;
    const moved = this.move(commands);
    const after = city.exit(this.cityWorld(false), room);
    if (after) return this.runFourGatesAction(after) ? "autosave" : null;
    if (!moved) this.afterFreeMovement(false);
    return this.takeSaveRequest();
  }
  /** `applyHatcheryCast` in 46: Lisa's finished scenes; `applyNpcVisuals` in 56: the merchants. */
  private applyCityCast(): void {
    const city = this.city();
    if (!city) return;
    for (const [id, visible] of city.merchants(this.roomIndex, (room, event) =>
      this.eventState.sourceEventStateComplete(98, room, event),
    )) {
      const actor = this.actors.get(id);
      if (actor) actor.visible = visible;
    }
    if (this.roomIndex !== 46) return;
    const cues = city.cast(this.roomIndex, (room, event) =>
      this.eventState.sourceEventStateComplete(98, room, event),
    );
    if (cues.length === 0) return;
    const stage = this.cauVongStageOver(this.actors);
    for (const cue of cues) restoreCue(stage, cue);
    this.cauVongPresentation.reset();
  }
  private northSea(): NorthSeaOwner | null {
    const doc = this.sources.cauVongNorthSea;
    if (!doc) return null;
    return (this.northSeaOwner ??= new NorthSeaOwner(doc));
  }
  /** What the North Sea owners read and write beyond the four gates' world. */
  private northSeaWorld(confirm: boolean): NorthSeaWorld {
    const player = this.player;
    const base = this.fourGatesWorld(confirm),
      props = this.sources.cauVongNorthSea?.talkers.props[String(this.roomIndex)] ?? {},
      hero = this.cauVongHero();
    return {
      ...base,
      // `CauVongNpcGeometry.requested`: a prop by `propActivation`, the rest by keyboard focus.
      requested: (id) => {
        const rect = props[String(id)];
        if (!rect) return base.requested(id);
        return cauVongPropRequested(
          hero,
          this.actors.get(id)?.visible ?? false,
          rect,
          confirm,
          this.pointerActor === undefined ? undefined : this.pointerActor === id,
        );
      },
      terrain: (x, y) => this.terrainAt(x, y),
      hero: () => ({ x: player.x, y: player.y, direction: player.direction }),
      // `travel`: `setRainbowBoatVisual` and the step; the boat's art keeps the Rainbow order.
      steer: (x, y, direction, moving) => {
        player.x = x;
        player.y = y;
        player.direction = direction;
        if (player.sprite !== NORTH_SEA_BOAT_SPRITE) {
          player.sprite = NORTH_SEA_BOAT_SPRITE;
          player.animationTick = 0;
          this.sources.prepareSprite?.(NORTH_SEA_BOAT_SPRITE);
        }
        const facing = direction === DIRECTION_DOWN ? 0 : direction === DIRECTION_UP ? 1 : 2;
        player.state = moving ? 3 + facing : facing;
        player.renderOrientation = direction === DIRECTION_RIGHT ? DIRECTION_LEFT : DIRECTION_DOWN;
      },
      disembark: () => this.applyPlayerVisual(),
      waterRide: () =>
        this.meta.campaign.ride.activeIndex === CV_WATER && this.rideUnlocked(CV_WATER),
      roster: () =>
        this.pets.map((pet) => ({
          speciesId: pet.speciesId,
          level: pet.level,
          held: pet.heldEquipmentId ?? -1,
          hp: pet.currentHp ?? pet.maxHp ?? 1,
          quality: pet.quality,
        })),
      // `confirmRelease`: another living pet stays; the held equipment goes back to the list.
      releaseSlot: (slot) => {
        if (slot < 0 || slot >= this.pets.length) return false;
        if (!this.pets.some((pet, i) => i !== slot && (pet.currentHp ?? pet.maxHp ?? 1) > 0))
          return false;
        const [pet] = this.pets.splice(slot, 1),
          held = pet.heldEquipmentId ?? -1;
        if (held >= 0 && !this.bag.equipment.includes(held)) this.bag.equipment.push(held);
        this.pets.forEach((p, i) => (p.slot = i));
        return true;
      },
    };
  }
  /**
   * `CauVongChapterRuntime.tick` in the North Sea: the priorities, the voyage, the owners (with the
   * doors), then the walk and the doors again (`tickFreeWorldPlayer`, `CauVongNorthSeaRoutes.exit`).
   */
  private tickCauVongNorthSea(commands: InputCommand[]): WorldAction {
    const sea = this.northSea();
    if (!sea || !this.cauVongMechanics()) return null;
    const room = this.roomIndex,
      w = this.northSeaWorld(commands.includes("confirm"));
    // CV0': `summoning.tick` (Kim Diễm Long Vương) ahead of the North Sea's owners in 49.
    const summon =
      room === SKY_CITY_ROOM
        ? (this.summoning()?.tick(this.summonWorld(commands.includes("confirm")), room) ?? null)
        : null;
    if (summon && this.runFourGatesAction(summon)) return this.takeSaveRequest();
    const action = sea.priority(w, room) ?? sea.travel(w, room) ?? sea.tick(w, room);
    if (action && this.runFourGatesAction(action)) return this.takeSaveRequest();
    const moved = this.move(commands);
    const after = sea.exit(this.northSeaWorld(false), room);
    if (after) return this.runFourGatesAction(after) ? "autosave" : null;
    if (this.afterFreeMovement(moved)) return null;
    return this.takeSaveRequest();
  }
  // --- CV4b: Rừng U Ám, 60, the north gate, the dorm's morning after, the rocks ---

  private forest(): ForestOwner | null {
    const doc = this.sources.cauVongForest,
      medals = this.sources.cauVongFourGates?.text.medals;
    if (!doc || medals === undefined) return null;
    return (this.forestOwner ??= new ForestOwner(doc, medals));
  }
  /**
   * `CauVongDarkForestSourceRuntime.tick` (38–40) or `CauVongAcademyLaboratoryRuntime.tick` (60):
   * the owner, then the doors before and after the walk (`exit`, `tickFreeWorldPlayer`, `exit`).
   */
  private tickCauVongForest(commands: InputCommand[]): WorldAction {
    const forest = this.forest();
    if (!forest || !this.cauVongMechanics()) return null;
    const room = this.roomIndex,
      w = this.fourGatesWorld(commands.includes("confirm"));
    const laboratory = room === LAB_ROOM || room === LABORATORY_ROOM;
    const action = laboratory ? forest.lab(w, room) : forest.tick(w, room);
    if (action && this.runFourGatesAction(action)) return this.takeSaveRequest();
    const exit = () => (laboratory ? null : forest.exit(this.fourGatesWorld(false), room));
    const before = exit();
    if (before) return this.runFourGatesAction(before) ? "autosave" : null;
    const moved = this.move(commands);
    const after = exit();
    if (after) return this.runFourGatesAction(after) ? "autosave" : null;
    if (this.afterFreeMovement(moved)) return null;
    return this.takeSaveRequest();
  }
  /** `CauVongRockObstacles.apply`: cleared rocks are gone, a begun one breaks again. */
  private applyCauVongRocks(): void {
    this.rockBreak = null;
    const rocks = this.sources.cauVongForest?.rocks[String(this.roomIndex)];
    if (!rocks) return;
    for (const rock of rocks) {
      const actor = this.actors.get(rock.actorId);
      if (!actor) continue;
      if (this.eventState.sourceEventStateComplete(98, this.roomIndex, rockCleared(rock)))
        actor.visible = false;
      else if (this.eventState.sourceEventStateComplete(98, this.roomIndex, rockStarted(rock)))
        this.startRockBreak(rock);
    }
  }
  private startRockBreak(rock: CauVongRock): void {
    const actor = this.actors.get(rock.actorId);
    if (!actor) return;
    actor.visible = true;
    actor.state = rock.state + 1;
    actor.animationTick = 0;
    this.rockBreak = { rock, tick: 0 };
  }
  /**
   * `CauVongRockObstacles.tick`: a begun rock holds the hero until its animation's cycle is over
   * (then cleared, hidden); 5 at the nearest closed rock ahead breaks it on the metal mount, or
   * says why not.
   */
  private tickCauVongRocks(commands: InputCommand[]): boolean {
    const doc = this.sources.cauVongForest,
      room = this.roomIndex,
      rocks = doc?.rocks[String(room)];
    if (!doc || !rocks) return false;
    const done = (r: number, event: number) =>
      this.eventState.sourceEventStateComplete(98, r, event);
    const breaking = this.rockBreak;
    if (breaking) {
      const actor = this.actors.get(breaking.rock.actorId);
      breaking.tick++;
      if (!actor || breaking.tick >= this.sources.animationTicks(actor.sprite, actor.state)) {
        this.eventState.op14CompleteEvent(98, room, rockCleared(breaking.rock));
        if (actor) actor.visible = false;
        this.rockBreak = null;
      }
      return true;
    }
    if (!commands.includes("confirm")) return false;
    const target = rockTarget(rocks, this.player, (rock) =>
      rockClosed(rock, room, this.actors.get(rock.actorId)?.visible ?? false, done),
    );
    if (!target) return false;
    const ride = this.meta.campaign.ride,
      metal = doc.flags.metalRide;
    if (ride.activeIndex !== metal || !roomAllowsRide(ride, metal) || !this.rideUnlocked(metal))
      return this.runFourGatesAction({
        kind: "text",
        steps: [{ k: "say", speaker: "Đá lớn", text: target.hint, portrait: -1 }],
      });
    this.eventState.op14CompleteEvent(98, room, rockStarted(target));
    this.startRockBreak(target);
    return true;
  }
  /** `startBattle`: `request(battleMap, battleEvent)` (or the masked pair's) behind the wipe. */
  private startFourGatesBattle(key: string): boolean {
    const services = this.sources.battle,
      request = this.summoning()?.owns(key)
        ? this.summoning()?.battle(key)
        : key.startsWith("forest:")
          ? this.sources.cauVongForest?.battles[key.slice("forest:".length)]
          : key.startsWith(LAB_PREFIX)
            ? this.sources.cauVongLab?.battles[key.slice(LAB_PREFIX.length)]
            : key.startsWith(NORTH_SEA_PREFIX)
              ? this.sources.cauVongNorthSea?.battles[key.slice(NORTH_SEA_PREFIX.length)]
              : this.sources.cauVongFourGates?.battles[key];
    if (!services || !request || this.pets.length === 0) return false;
    this.battle = createSourceTrainerBattle(
      services,
      {
        ...request,
        sceneId: this.sceneId,
        // ProMax: Đại Điện's (51) hidden Divine pets fight under the same seal as an owned one.
        enemyStatPercent: key.startsWith(`${SUMMON_PREFIX}51:`)
          ? (speciesId) => this.divineSeal?.percent(speciesId, true) ?? 100
          : undefined,
      },
      this.pets,
      this.inventory,
      this.battleItemCatalog(),
      { playerActorSpriteId: this.player.sprite, enemyActorSpriteId: 0 },
      this.battleCharms(true),
      this.currency,
    );
    this.prepareBattleSprites(this.battle);
    this.nextBattleEntryMode = request.background ?? 0;
    this.fourGatesFight = { masked: key === "masked", key };
    this.battleEncounter = undefined;
    this.markEnemiesSeen(this.battle);
    this.setPhase("battleEntry");
    return true;
  }
  /** `returnToSquare`: 98:0 at (204, 554). */
  private leaveCauVongHall(): WorldAction {
    if (this.sources.roomReady && !this.sources.roomReady(98, HALL_EXIT.room)) {
      this.sources.prepareRoom?.(98, HALL_EXIT.room);
      return null;
    }
    this.loadRoom(98, HALL_EXIT.room, HALL_EXIT.x, HALL_EXIT.y, 0);
    return "autosave";
  }
  private leaveCauVongSquare(): boolean {
    const exit = cauVongSquareExit(this.player.x, this.player.y);
    if (!exit) return false;
    if (this.sources.roomReady && !this.sources.roomReady(98, exit.room)) {
      this.sources.prepareRoom?.(98, exit.room);
      return false;
    }
    this.loadRoom(98, exit.room, exit.x, exit.y, 0);
    return true;
  }
  /** Bích Lam Cốc's vortex rooms (`BlcC3Runtime`: 10:5–10:7). */
  private hazardRoom(): boolean {
    return this.sceneId === 10 && this.roomIndex >= 5 && this.roomIndex <= 7;
  }
  /**
   * `advanceTraversalHazards`: each visible vortex (behaviour 12 up/down, 13 across) moves 4 px,
   * turning back where the sample past its leading edge leaves the map or open floor.
   */
  private advanceHazards(): void {
    const asset = this.sources.room(this.sceneId, this.roomIndex),
      map = asset ? this.sources.collision(asset.mapId) : undefined;
    if (!map) return;
    for (const actor of this.actors.values()) {
      if (actor.id < 0 || !actor.visible || actor.sourceKind !== 0) continue;
      if (actor.variant !== 12 && actor.variant !== 13) continue;
      const nextX = actor.x + directionDx(actor.direction, 4),
        nextY = actor.y + directionDy(actor.direction, 4),
        [, , width, height] = this.platformMask(actor) ?? PUZZLE_FALLBACK_MASK;
      let sampleX = nextX,
        sampleY = nextY;
      if (actor.direction === DIRECTION_RIGHT) sampleX += Math.trunc(width / 2);
      if (actor.direction === DIRECTION_LEFT) sampleX -= Math.trunc(width / 2);
      if (actor.direction === DIRECTION_UP) sampleY -= height;
      const outside =
        sampleX < mapLeft(map) ||
        sampleY < mapTop(map) ||
        sampleX >= mapRight(map) ||
        sampleY >= mapBottom(map);
      if (outside || terrainAtWorld(map, sampleX, sampleY) !== 0) {
        actor.direction = (actor.direction + 2) % 4;
        continue;
      }
      actor.x = nextX;
      actor.y = nextY;
    }
  }
  /**
   * `contactingTraversalHazard`: the hero touching a vortex (both collision masks when there are
   * masks, the interaction box otherwise) starts `VortexReset`.
   */
  private startHazardSpin(): boolean {
    if (!this.hazardRoom()) return false;
    const playerMask = this.platformMask(this.player);
    for (const actor of this.actors.values()) {
      if (actor.id < 0 || !actor.visible || actor.sourceKind !== 0) continue;
      if (actor.variant !== 12 && actor.variant !== 13) continue;
      const mask = this.platformMask(actor),
        touching =
          playerMask && mask
            ? sourceMaskOverlap(this.player.x, this.player.y, playerMask, actor.x, actor.y, mask)
            : intersectsActorBox(this.player.x, this.player.y, actor.x, actor.y);
      if (!touching) continue;
      this.hazardSpin = { ticks: 16 };
      return true;
    }
    return false;
  }
  /** `VortexReset`: 16 ticks of spinning, then back where the hero entered the room. */
  private tickHazardSpin(): void {
    const spin = this.hazardSpin!;
    if (spin.ticks-- > 0) {
      this.player.direction = (((16 - spin.ticks) % 4) + 4) % 4;
      this.setPlayerFacing(true);
      return;
    }
    const asset = this.sources.room(this.sceneId, this.roomIndex);
    const entry = roomClamp(asset, this.roomEntry.x, this.roomEntry.y, 8);
    this.player.x = entry.x;
    this.player.y = entry.y;
    this.setPlayerFacing(false);
    this.centerCamera();
    this.hazardSpin = null;
  }
  /**
   * `NiemThoC3Runtime.tryStartGymHoleFall`: in Niêm Thổ Đạo Quán's upper floor (9:2) the hero's
   * mask on one of the four floor holes (actors 0–3, behaviour 16) starts the drop to the floor
   * below, where the gym's next trainers wait.
   */
  private startGymHoleFall(): boolean {
    if (this.sceneId !== 9 || this.roomIndex !== 2) return false;
    const playerMask = this.platformMask(this.player);
    for (const id of GYM_HOLE_ACTORS) {
      const hole = this.actors.get(id);
      if (!hole?.visible || hole.sourceKind !== 0 || hole.variant !== 16) continue;
      const mask = this.platformMask(hole),
        touching =
          playerMask && mask
            ? sourceMaskOverlap(this.player.x, this.player.y, playerMask, hole.x, hole.y, mask)
            : intersectsActorBox(this.player.x, this.player.y, hole.x, hole.y);
      if (!touching) continue;
      this.gymHoleFall = {
        holeId: id,
        direction: this.player.direction,
        startX: this.player.x,
        startY: this.player.y,
        tick: 0,
      };
      this.setPlayerFacing(false);
      return true;
    }
    return false;
  }
  /**
   * `GymHoleFall.tick`: 16 ticks spinning (frames 0 1 2 1, facing round the compass) while the hero
   * slides 4 px a tick onto the hole (16 px above its anchor), then 9:3 at (112, 256), facing the
   * way he came in.
   */
  private tickGymHoleFall(): void {
    const fall = this.gymHoleFall!,
      hole = this.actors.get(fall.holeId),
      player = this.player;
    if (fall.tick < GYM_HOLE_FALL_TICKS && hole) {
      const targetX = hole.x,
        targetY = hole.y - GYM_HOLE_PLAYER_OFFSET_Y,
        speed = GYM_HOLE_FALL_SPEED,
        // `alignVerticalFromSourceStart` / `alignHorizontalFromSourceStart`.
        align = (now: number, start: number, target: number) =>
          start > target
            ? now <= target
              ? target
              : now - speed
            : start < target
              ? now >= target
                ? target
                : now + speed
              : now;
      if (fall.direction === DIRECTION_LEFT || fall.direction === DIRECTION_RIGHT) {
        if (fall.direction === DIRECTION_LEFT && player.x > targetX) player.x -= speed;
        else if (fall.direction === DIRECTION_RIGHT && player.x < targetX) player.x += speed;
        player.y = align(player.y, fall.startY, targetY);
      } else {
        if (fall.direction === DIRECTION_UP && player.y > targetY) player.y -= speed;
        else if (fall.direction === DIRECTION_DOWN && player.y < targetY) player.y += speed;
        player.x = align(player.x, fall.startX, targetX);
      }
      const frame = fall.tick % 4;
      player.direction = frame;
      player.renderOrientation = -1;
      player.state = frame === 3 ? 1 : frame;
      player.animationTick = fall.tick;
      fall.tick++;
      this.centerCamera();
      return;
    }
    this.gymHoleFall = null;
    this.loadRoom(9, 3, GYM_FALL_TARGET.x, GYM_FALL_TARGET.y, fall.direction);
    this.setPlayerFacing(false);
  }
  /** `NiemThoC3Runtime.postGymLeaderDefeated`. */
  private postGymLeaderDefeated(): boolean {
    const done = (scene: number, room: number, group: number) =>
      this.eventState.sourceEventStateComplete(scene, room, group);
    return (
      done(9, 2, 1) ||
      done(4, 0, 1) ||
      done(4, 5, 14) ||
      this.flags.badges.achieved(BADGE_HOA_PHONG)
    );
  }
  /** Whether the hero flies this room on Hải âu (`VqsvFreeWorldRuntime`'s `airborne`). */
  private hasHaiAuFlight(): boolean {
    const ride = this.meta.campaign.ride;
    return this.sceneId !== 98 && ride.activeIndex === HAI_AU && roomAllowsRide(ride, HAI_AU);
  }
  /**
   * `VqsvFreeWorldRuntime.playerInteractsActorSourceMask`: the faced query with the hero's and the
   * actor's own collision masks (the box only when the sprite has none).
   */
  private playerFaces(actor: StoryActor, direction = this.player.direction): boolean {
    const player = this.player;
    return playerInteractsActor(
      player.x,
      player.y,
      direction,
      actor,
      this.platformMask(player),
      this.platformMask(actor),
    );
  }
  private platformMask(actor: StoryActor): CollisionMask | null {
    return this.sources.collisionMask?.(actor.sprite, actor.state, actor.animationTick) ?? null;
  }
  /**
   * `tryStartSourceLeafRide`: from firm ground (not terrain 1 or 2), a step that would touch a
   * visible platform of the matching axis whose way ahead is open boards it — 7 ticks walking on,
   * the platform in its moving state (1 across, 2 along), the hero in his swing frames.
   */
  private startPlatformRide(direction: number): boolean {
    const map = this.currentMap();
    const here = terrainAtWorld(map, this.player.x, this.player.y);
    if (here === 1 || here === 2) return false;
    const speed = Math.max(1, Math.abs(this.playerMoveSpeed)),
      projectedX = this.player.x + directionDx(direction, speed),
      projectedY = this.player.y + directionDy(direction, speed);
    for (const [id, actor] of this.actors) {
      if (id < 0 || !actor.visible || !isPlatform(actor)) continue;
      const horizontal = actor.variant === PLATFORM_HORIZONTAL;
      if (horizontal !== (direction === DIRECTION_LEFT || direction === DIRECTION_RIGHT)) continue;
      const mask = this.platformMask(actor);
      if (!platformCanAdvance(actor, platformTerrainAhead(map, mask, actor.x, actor.y, direction)))
        continue;
      // Web fix: on the APK maps a platform resting at its shore can stop a few pixels short of
      // the bank (9:7's cloud by Thiên Giới's centre island), out of a step's reach; one more
      // platform step of reach lets the hero board it from the edge.
      if (
        !this.touchesPlatform(projectedX, projectedY, actor, actor.x, actor.y) &&
        !this.touchesPlatform(
          projectedX + directionDx(direction, PLATFORM_SPEED),
          projectedY + directionDy(direction, PLATFORM_SPEED),
          actor,
          actor.x,
          actor.y,
        )
      )
        continue;
      this.player.direction = direction;
      this.platformRide = { actorId: id, direction, phase: 0, ticks: PLATFORM_STEP_TICKS };
      actor.direction = direction;
      actor.state = horizontal ? 1 : 2;
      actor.animationTick = 0;
      this.setPlayerFacing(true);
      return true;
    }
    return false;
  }
  /**
   * Web-only (owner's request 2026-11-13; JavaSE strands the hero here): a hero on the bank of a
   * lotus lane who steps toward the water while its leaf rests at the far shore calls the leaf, and
   * it sails back to his bank to be boarded as usual. Without it a hero who reached a bank without
   * the leaf — a lost fight sending him back to the save point, a resumed save, another door —
   * could be shut on that bank: in 2:0 that cuts Bích Thủy off from the village for good. Clouds
   * answer the same call (7:1, 7:4), except in Thiên Giới Đạo Quán (9:7), whose clouds are the
   * gym's course. A leaf answers only while the water cannot be walked (before Thủy Lam's badge);
   * Hải âu, which crosses both, is ruled out by the caller.
   */
  private trySummonLeaf(direction: number): boolean {
    // Cầu Vồng follows JavaSE as it is; its behaviour-9/10 actors are not leaves or clouds.
    if (this.sceneId === 98) return false;
    const map = this.currentMap(),
      asset = this.sources.room(this.sceneId, this.roomIndex);
    if (!asset) return false;
    const here = terrainAtWorld(map, this.player.x, this.player.y);
    if (here === 1 || here === 2) return false;
    const speed = Math.max(1, Math.abs(this.playerMoveSpeed)),
      projectedX = this.player.x + directionDx(direction, speed),
      projectedY = this.player.y + directionDy(direction, speed),
      back = (direction + 2) % 4;
    for (const [id, actor] of this.actors) {
      if (id < 0 || !actor.visible || !isPlatform(actor) || !SUMMONABLE_SPRITES.has(actor.sprite))
        continue;
      const lotus = platformTravelTerrain(actor) === 2;
      if (lotus ? this.flags.terrainBadgeGatedOpen() : this.sceneId === 9 && this.roomIndex === 7)
        continue;
      const horizontal = actor.variant === PLATFORM_HORIZONTAL;
      if (horizontal !== (direction === DIRECTION_LEFT || direction === DIRECTION_RIGHT)) continue;
      const row = asset.actors.find((candidate) => candidate.id === id);
      if (!row) continue;
      // The leaf only ever sails its own lane: a horizontal leaf keeps its row's y, a vertical its x.
      if (horizontal ? actor.y !== row.y : actor.x !== row.x) continue;
      // The bank the hero stands on is the end of the lane behind him.
      const bank = platformShore(map, actor, this.platformMask(actor), row, back);
      if (actor.x === bank.x && actor.y === bank.y) continue;
      if (!this.touchesPlatform(projectedX, projectedY, actor, bank.x, bank.y)) continue;
      this.player.direction = direction;
      this.setPlayerFacing(false);
      this.leafSummon = { actorId: id, target: bank, direction: back };
      actor.direction = back;
      actor.state = horizontal ? 1 : 2;
      actor.animationTick = 0;
      return true;
    }
    return false;
  }
  /** The called leaf or cloud sails 4 px a tick to the hero's bank, rests there and is remembered there. */
  private tickLeafSummon(): void {
    const summon = this.leafSummon!,
      actor = this.actors.get(summon.actorId);
    if (!actor) {
      this.leafSummon = null;
      return;
    }
    const { target } = summon,
      dx = target.x - actor.x,
      dy = target.y - actor.y;
    actor.x += Math.sign(dx) * Math.min(PLATFORM_SPEED, Math.abs(dx));
    actor.y += Math.sign(dy) * Math.min(PLATFORM_SPEED, Math.abs(dy));
    if (actor.x !== target.x || actor.y !== target.y) return;
    actor.state = 0;
    actor.animationTick = 0;
    this.flags.setActorPosition(this.sceneId, this.roomIndex, summon.actorId, target);
    this.leafSummon = null;
  }
  /**
   * `projectedPlayerIntersectsActorSourceMask`: the hero, projected one step, against the platform
   * standing at (x, y) — both collision masks when there are masks (a tall leaf reaches its bank
   * only through its mask), the interaction box otherwise.
   */
  private touchesPlatform(
    playerX: number,
    playerY: number,
    actor: StoryActor,
    x: number,
    y: number,
  ): boolean {
    const playerMask = this.platformMask(this.player),
      mask = this.platformMask(actor);
    return playerMask && mask
      ? sourceMaskOverlap(playerX, playerY, playerMask, x, y, mask)
      : intersectsActorBox(playerX, playerY, x, y);
  }
  /** `tickSourceLeafRide`: board, sail until the terrain ahead stops the platform, step ashore. */
  private tickPlatformRide(): void {
    const ride = this.platformRide!,
      actor = this.actors.get(ride.actorId),
      asset = this.sources.room(this.sceneId, this.roomIndex),
      map = asset ? this.sources.collision(asset.mapId) : undefined;
    if (!actor || !map) {
      this.finishPlatformRide();
      return;
    }
    const { direction } = ride,
      step = () => {
        this.player.x += directionDx(direction, PLATFORM_SPEED);
        this.player.y += directionDy(direction, PLATFORM_SPEED);
        this.player.direction = direction;
      };
    if (ride.phase === 0) {
      step();
      if (--ride.ticks <= 0) ride.phase = 1;
    } else if (ride.phase === 1) {
      const ahead = platformTerrainAhead(
        map,
        this.platformMask(actor),
        actor.x,
        actor.y,
        direction,
      );
      if (!platformCanAdvance(actor, ahead)) {
        ride.phase = 2;
        ride.ticks = PLATFORM_STEP_TICKS;
      } else {
        actor.x += directionDx(direction, PLATFORM_SPEED);
        actor.y += directionDy(direction, PLATFORM_SPEED);
        step();
      }
    } else {
      const travel = platformTravelTerrain(actor),
        blocked = travel === 1 ? 2 : 1,
        current = terrainAtWorld(map, this.player.x, this.player.y),
        next = terrainAtWorld(
          map,
          this.player.x + directionDx(direction, PLATFORM_SPEED),
          this.player.y + directionDy(direction, PLATFORM_SPEED),
        ),
        onShore = current !== 1 && current !== 2;
      if (next === blocked || (onShore && next === travel)) {
        this.finishPlatformRide();
        return;
      }
      step();
      if (--ride.ticks <= 0) {
        this.finishPlatformRide();
        return;
      }
    }
    this.setPlayerFacing(true);
    this.centerCamera();
  }
  /** `finishSourceLeafRide`: the platform rests (and is remembered) where it reached shore. */
  private finishPlatformRide(): void {
    const ride = this.platformRide!,
      actor = this.actors.get(ride.actorId);
    if (actor) {
      actor.state = 0;
      actor.animationTick = 0;
      this.flags.setActorPosition(this.sceneId, this.roomIndex, ride.actorId, actor);
    }
    this.platformRide = null;
    this.setPlayerFacing(false);
  }
  /**
   * `resetSourceLeafActorsToCanonical`: these platforms back on their room rows, forgotten. With
   * `shores`, the listed ones then sail ahead to the shore they would reach (`positionSourcePlatformAtShore`).
   */
  private stagePlatforms(reset: number[], shores: [number, number][] = []): void {
    const asset = this.sources.room(this.sceneId, this.roomIndex),
      map = asset ? this.sources.collision(asset.mapId) : undefined;
    if (!asset || !map) return;
    const rowOf = (id: number) => asset.actors.find((row) => row.id === id);
    for (const id of reset) {
      const actor = this.actors.get(id),
        row = rowOf(id);
      if (!actor || !row || !isPlatform(actor)) continue;
      Object.assign(actor, {
        x: row.x,
        y: row.y,
        direction: row.state,
        visible: row.visible,
        state: 0,
      });
      this.flags.setActorPosition(this.sceneId, this.roomIndex, id, null);
    }
    this.platformRide = null;
    this.leafSummon = null;
    for (const [id, direction] of shores) this.placePlatformAtShore(id, direction, true);
  }
  /** A lost gym fight: the room's platforms back on their rows, the hero at door `doorActor`. */
  private retryGymFromDoor(doorActor: number, platforms: number[]): void {
    this.stagePlatforms(platforms);
    const asset = this.sources.room(this.sceneId, this.roomIndex),
      arrival =
        asset &&
        transitionArrivalForTarget(this.sources.registry, asset, {
          scene: this.sceneId,
          room: this.roomIndex,
          actor: doorActor,
        });
    if (!arrival) return;
    Object.assign(this.player, arrival);
  }
  /**
   * Web fix (owner 2026-11-15, "kẹt sẵn ở đây không có đám mây nào để về"): each platform with
   * exactly one shore on the land the hero can walk to rests at that shore.
   */
  private bringPlatformsToHero(map: MapCollision, ids: number[]): void {
    const area = walkableArea(map, this.player.x, this.player.y),
      tile = map.tileSize,
      asset = this.sources.room(this.sceneId, this.roomIndex);
    if (!area.size || !asset) return;
    for (const id of ids) {
      const actor = this.actors.get(id),
        row = asset.actors.find((candidate) => candidate.id === id);
      if (!actor || !row || !actor.visible || !isPlatform(actor)) continue;
      const mask = this.platformMask(actor),
        directions =
          actor.variant === PLATFORM_HORIZONTAL
            ? [DIRECTION_LEFT, DIRECTION_RIGHT]
            : [DIRECTION_UP, DIRECTION_DOWN],
        near = directions.filter((direction) => {
          const end = platformShore(map, actor, mask, row, direction),
            ahead = platformAheadPoint(mask, end.x, end.y, direction);
          return !!ahead && area.has(`${Math.floor(ahead.x / tile)},${Math.floor(ahead.y / tile)}`);
        });
      if (near.length === 1) this.placePlatformAtShore(id, near[0], false);
    }
  }
  /** `positionSourcePlatformAtShore` (`always`) or `ensureSourcePlatformAtShore`. */
  private placePlatformAtShore(id: number, direction: number, always: boolean): void {
    const asset = this.sources.room(this.sceneId, this.roomIndex),
      map = asset ? this.sources.collision(asset.mapId) : undefined,
      actor = this.actors.get(id),
      row = asset?.actors.find((candidate) => candidate.id === id);
    if (!map || !actor || !row || !isPlatform(actor)) return;
    const horizontal = actor.variant === PLATFORM_HORIZONTAL;
    if (horizontal !== (direction === DIRECTION_LEFT || direction === DIRECTION_RIGHT)) return;
    const shore = platformShore(map, actor, this.platformMask(actor), row, direction);
    if (!always && actor.x === shore.x && actor.y === shore.y) return;
    Object.assign(actor, { x: shore.x, y: shore.y, direction, visible: row.visible, state: 0 });
    this.flags.setActorPosition(this.sceneId, this.roomIndex, id, shore);
  }
  /**
   * `reconcileBichThuyLeafArrival` / `reconcileBlcRouteCloudArrival`: a door into a platform room
   * lays its platforms out for the way the hero is travelling.
   */
  private reconcilePlatformArrival(
    from: { scene: number; room: number },
    targetActor: number,
  ): void {
    const at = (scene: number, room: number) => this.sceneId === scene && this.roomIndex === room;
    if (from.scene === 11 && from.room === 9 && at(2, 1) && targetActor === 8)
      this.stagePlatforms([13, 14]);
    else if (
      from.scene === 2 &&
      from.room === 2 &&
      at(2, 1) &&
      targetActor === 11 &&
      !this.flags.actorPosition(2, 1, 14)
    )
      this.placeLeafDownstream(14);
    else if (from.scene === 7 && from.room === 3 && at(7, 4) && targetActor === 0)
      this.stagePlatforms([2, 23, 24, 25]);
    else if (from.scene === 10 && from.room === 1 && at(7, 4) && targetActor === 1)
      this.stagePlatforms(
        [2, 23, 24, 25],
        [
          [2, DIRECTION_RIGHT],
          [23, DIRECTION_LEFT],
          [25, DIRECTION_UP],
        ],
      );
  }
  /** `positionLeafAtDownstreamShore`: a lotus leaf (behaviour 10) brought to its lower shore. */
  private placeLeafDownstream(id: number): void {
    const asset = this.sources.room(this.sceneId, this.roomIndex),
      map = asset ? this.sources.collision(asset.mapId) : undefined,
      actor = this.actors.get(id),
      row = asset?.actors.find((candidate) => candidate.id === id);
    if (!map || !actor || !row || actor.variant !== PLATFORM_VERTICAL) return;
    const shore = downstreamLeafShore(map, row);
    Object.assign(actor, { x: shore.x, y: shore.y, direction: DIRECTION_DOWN, state: 0 });
    this.flags.setActorPosition(this.sceneId, this.roomIndex, id, shore);
  }
  /**
   * `reconcileBlcRouteCloudForCurrentSide` (7:4's room entry) and
   * `reconcileLowerBichThuyLeafAfterSaveRestore` (a resumed save in 2:1): the platforms a hero
   * standing on this side needs are brought to his shore.
   */
  private reconcilePlatformsForSide(restoring: boolean): void {
    const asset = this.sources.room(this.sceneId, this.roomIndex),
      row = (id: number) => asset?.actors.find((candidate) => candidate.id === id);
    if (this.sceneId === 7 && this.roomIndex === 4 && this.actors.get(2)?.variant === 9) {
      const { x, y } = this.player,
        r2 = row(2),
        r23 = row(23),
        r24 = row(24),
        r25 = row(25);
      if (!r2 || !r23 || !r24 || !r25) return;
      if (y < r25.y - 16) {
        this.stagePlatforms(
          [2, 23, 24, 25],
          [
            [2, DIRECTION_RIGHT],
            [23, DIRECTION_LEFT],
            [25, DIRECTION_UP],
          ],
        );
        return;
      }
      if (x < r23.x - 16 && y < r24.y - 16) this.placePlatformAtShore(23, DIRECTION_LEFT, false);
      if (x > r2.x + 16 && y > r23.y - 16) this.placePlatformAtShore(2, DIRECTION_RIGHT, false);
      if (x < r24.x + 64 && y > r24.y + 16) this.placePlatformAtShore(24, DIRECTION_DOWN, false);
    } else if (
      restoring &&
      this.sceneId === 2 &&
      this.roomIndex === 1 &&
      !this.flags.actorPosition(2, 1, 14) &&
      this.actors.get(14)
    ) {
      const asset2 = this.sources.room(2, 1),
        map = asset2 ? this.sources.collision(asset2.mapId) : undefined,
        leaf = row(14);
      if (map && leaf && this.player.y > downstreamLeafShore(map, leaf).y + 16)
        this.placeLeafDownstream(14);
    }
  }
  /** `VqsvSourceLaserRuntime.beamSegments` for one of this room's emitters. */
  private laserSegments(emitter: StoryActor): number {
    const asset = this.sources.room(this.sceneId, this.roomIndex),
      map = asset ? this.sources.collision(asset.mapId) : undefined;
    if (!asset || !map || !emitter.visible) return 0;
    const actors = [...this.actors.values()]
      .filter((actor) => actor.id >= 0 && actor.id !== WorldRuntime.COMPANION_ACTOR_ID)
      .map((actor) => ({
        x: actor.x,
        y: actor.y,
        variant: actor.variant,
        mask: this.sources.collisionMask?.(actor.sprite, actor.state, actor.animationTick) ?? null,
      }));
    return laserBeamSegments(
      emitter,
      map.widthPixels,
      map.heightPixels,
      (x, y) => terrainAtWorld(map, x, y),
      actors,
    );
  }
  /** `VqsvSourceLaserRuntime.render`: the beam drawn right after this actor, if it is an emitter. */
  laserBeamFor(actorId: number): LaserBeam | null {
    const actor = this.actors.get(actorId);
    if (!actor?.visible || actor.sourceKind !== 0 || actor.variant !== LASER_BEHAVIOR) return null;
    const hit = this.sources.hitMask?.(actor.sprite, actor.state, actor.animationTick);
    // `sourceLaserPulse`: 0..4, one step a visible tick.
    return laserBeam(actor, this.laserSegments(actor), hit ? hit[3] : 0, actor.animationTick % 5);
  }
  /**
   * `tryPrepareBlcLaserPush` (10:1–10:4): the first visible block (behaviour 8) the hero's next step
   * overlaps moves the same step ahead, unless that would leave the map, land a corner on a wall
   * (terrain 1) or overlap another block or emitter base (8/11). Returns it for the rollback.
   */
  private pushBlock(
    direction: number,
  ): { id: number; actor: StoryActor; from: { x: number; y: number } } | null {
    if (this.sceneId !== 10 || this.roomIndex < 1 || this.roomIndex > 4 || direction < 0)
      return null;
    const asset = this.sources.room(this.sceneId, this.roomIndex),
      map = asset ? this.sources.collision(asset.mapId) : undefined;
    if (!map) return null;
    const speed = Math.max(1, this.playerMoveSpeed),
      dx = direction === DIRECTION_RIGHT ? speed : direction === DIRECTION_LEFT ? -speed : 0,
      dy = direction === DIRECTION_DOWN ? speed : direction === DIRECTION_UP ? -speed : 0,
      maskOf = (actor: StoryActor) =>
        this.sources.collisionMask?.(actor.sprite, actor.state, actor.animationTick) ??
        PUZZLE_FALLBACK_MASK,
      player = this.player,
      playerMask = maskOf(player);
    for (const [id, actor] of this.actors) {
      if (id < 0 || !actor.visible || actor.sourceKind !== 0 || actor.variant !== 8) continue;
      const mask = maskOf(actor);
      if (!sourceMaskOverlap(player.x + dx, player.y + dy, playerMask, actor.x, actor.y, mask))
        continue;
      const nextX = actor.x + dx,
        nextY = actor.y + dy,
        left = nextX + mask[0],
        top = nextY + mask[1],
        right = left + mask[2] - 1,
        bottom = top + mask[3] - 1;
      if (
        left < mapLeft(map) ||
        top < mapTop(map) ||
        right >= mapRight(map) ||
        bottom >= mapBottom(map)
      )
        return null;
      if (
        [
          [left, top],
          [right, top],
          [left, bottom],
          [right, bottom],
        ].some(([x, y]) => terrainAtWorld(map, x, y) === 1)
      )
        return null;
      for (const [otherId, other] of this.actors)
        if (
          otherId !== id &&
          otherId >= 0 &&
          other.visible &&
          other.sourceKind === 0 &&
          (other.variant === 8 || other.variant === 11) &&
          sourceMaskOverlap(nextX, nextY, mask, other.x, other.y, maskOf(other))
        )
          return null;
      const from = { x: actor.x, y: actor.y };
      actor.x = nextX;
      actor.y = nextY;
      return { id, actor, from };
    }
    return null;
  }
  /**
   * `rememberActorPosition` / `forgetActorPosition`: a moving actor (behaviour 8/9/10) away from its
   * room row is saved where it stands; back on the row, the record is dropped.
   */
  private rememberMovingActor(id: number): void {
    const actor = this.actors.get(id),
      row = this.sources.room(this.sceneId, this.roomIndex)?.actors.find((a) => a.id === id);
    if (!actor || !row) return;
    this.flags.setActorPosition(
      this.sceneId,
      this.roomIndex,
      id,
      row.x === actor.x && row.y === actor.y ? null : actor,
    );
  }
  /**
   * `VqsvSourceWorldObstacleRuntime.reconcile` (room load): each owned tree and rock is cleared
   * (state 2, passable) when its `openedChests` key was written, and closed (state 0) otherwise.
   */
  private reconcileObstacles(): void {
    this.clearedObstacles.clear();
    this.obstaclePromptIds = [];
    this.obstacleCut = null;
    for (const [id, actor] of this.actors) {
      if (id < 0 || !ownedObstacle(this.sceneId, this.roomIndex, actor)) continue;
      const cleared = this.flags.hasOpenedChest(
        obstacleKey(this.sceneId, this.roomIndex, id, actor.variant),
      );
      if (cleared) this.clearedObstacles.add(id);
      actor.state = cleared ? 2 : 0;
      actor.animationTick = 0;
    }
    // `VqsvSceneLoaders`: an opened chest (kind 3) loads open (state 1) and no longer blocks.
    for (const [id, actor] of this.actors)
      if (id >= 0 && actor.sourceKind === 3 && this.flags.hasOpenedChest(this.chestKey(id))) {
        this.clearedObstacles.add(id);
        actor.state = 1;
        actor.animationTick = 0;
      }
  }
  /** `Scene1ThreeMapInteractionRuntime.chestKey`. */
  private chestKey(actorId: number): string {
    return `${this.sceneId}:${this.roomIndex}:${actorId}`;
  }
  /**
   * `tryStartChest` / `NguyenMocRoom2Runtime.tryStartKeyedChest`: the faced chest this room's
   * runtime wires opens (state 1, its key written) and plays its reward, or says it is empty.
   */
  private startChest(): boolean {
    const room = `${this.sceneId}:${this.roomIndex}`,
      keyed = KEYED_CHESTS[room],
      ids = [...(keyed ? [keyed.actor] : []), ...(WORLD_CHESTS[room] ?? [])];
    for (const id of ids) {
      const actor = this.actors.get(id);
      if (!actor?.visible || actor.sourceKind !== 3 || !this.actorInteractionRequested(actor))
        continue;
      const key = this.chestKey(id),
        notice = (text: string): RuntimeStoryEvent => ({
          type: "text",
          text,
          wait: true,
          kind: "openbox",
          box: { x: 47, y: 154, width: 146, height: 26 },
        });
      let events: RuntimeStoryEvent[];
      if (this.flags.hasOpenedChest(key)) events = [notice(CHEST_EMPTY)];
      else if (keyed && id === keyed.actor) {
        if ((this.bag.materials[String(keyed.keyItem)] ?? 0) < 1)
          events = [notice("Không có cái chìa khóa, có thể đến tài liệu cửa hàng mua sắm")];
        else {
          // `game.j.w` order: open first, spend the key, then the reward.
          this.openChest(id, key);
          this.bag.materials[String(keyed.keyItem)] -= 1;
          events = [{ type: "item", mode: 0, itemId: keyed.itemId, quantity: keyed.quantity }];
        }
      } else {
        const row = this.sources.registry.room(this.sceneId, this.roomIndex)?.actors[id]?.values;
        this.openChest(id, key);
        events = [{ type: "item", mode: 0, itemId: row?.[9] ?? 0, quantity: row?.[7] ?? 0 }];
      }
      this.startScript(
        { scene: this.sceneId, room: this.roomIndex, group: -1 },
        `chest:${key}`,
        events,
      );
      return true;
    }
    return false;
  }
  private openChest(id: number, key: string): void {
    const actor = this.actors.get(id);
    if (actor) {
      actor.state = 1;
      actor.animationTick = 0;
    }
    this.flags.addOpenedChest(key);
    this.clearedObstacles.add(id);
  }
  /**
   * `obstacleCandidates`: the uncleared trees and rocks the hero faces and has the badge for (Mộc
   * Quỳ Chương cuts trees, Đại Địa Chương breaks rocks). Their action marker shows while he does.
   */
  private obstacleCandidates(): number[] {
    const ids: number[] = [];
    for (const [id, actor] of this.actors) {
      if (id < 0 || this.clearedObstacles.has(id)) continue;
      if (!ownedObstacle(this.sceneId, this.roomIndex, actor)) continue;
      const ready =
        actor.variant === ROCK_BEHAVIOR
          ? this.flags.badges.canBreakRocks()
          : this.flags.badges.canClearTrees();
      if (ready && this.actorInteractionRequested(actor)) ids.push(id);
    }
    return ids;
  }
  /** `VqsvSourceWorldObstacleRuntime.startCut`: 5 sets every candidate clearing (state 1). */
  private startObstacleCut(): boolean {
    const ids = this.obstacleCandidates();
    if (!ids.length) return false;
    this.obstaclePromptIds = [];
    this.obstacleCut = { actorIds: ids };
    for (const id of ids) {
      const actor = this.actors.get(id)!;
      actor.state = 1;
      actor.animationTick = 0;
    }
    // `player.applyMode(7)`: the hero swings (his walking frames) while the obstacles fall.
    this.setPlayerFacing(true);
    return true;
  }
  // ------------------------------------------------- Lục Hành Điểu race (`NguyenMocC4RaceRuntime`)
  private get inRaceRoom(): boolean {
    return this.sceneId === RACE_SCENE && this.roomIndex === RACE_ROOM;
  }
  private get raceProgress(): RaceProgress {
    return (this.meta.campaign.race ??= { windowStart: 0, attempts: 0, petClaimed: false });
  }
  /** `syncRaceWindow`: normalise the rolling window and write it back. */
  private syncRaceWindow(): RaceWindow {
    const window = raceWindow(this.raceProgress, this.clock());
    this.raceProgress.windowStart = window.windowStart;
    this.raceProgress.attempts = window.used;
    return window;
  }
  /** `blocksPanel`: the menu stays shut while the countdown or the run is on. */
  get raceBlocksPanel(): boolean {
    return this.inRaceRoom && (this.race.active || this.race.countdown > 0);
  }
  /** `renderOverlay`: the countdown picture (`down<n-1>`), else the run's elapsed time. */
  get raceOverlay(): { countdown: number } | { elapsed: string } | null {
    if (!this.inRaceRoom || this.battleVisible) return null;
    if (this.race.countdown > 0) return { countdown: this.race.countdown };
    if (this.race.active && this.race.startMillis > 0)
      return { elapsed: formatRaceTime(this.clock() - this.race.startMillis) };
    return null;
  }
  /** The tick's first race checks; true when one of them started a flow. */
  private tickRaceRoom(commands: InputCommand[]): boolean {
    if (this.race.active && this.clock() - this.race.startMillis >= RACE_TIME_LIMIT_MILLIS) {
      // `TimeoutFlow`.
      this.stopRace();
      this.startRaceScript("timeout", raceEndScript(RACE_TEXT.timeout));
      return true;
    }
    if (this.race.active && this.inRaceFinish()) {
      this.finishRace();
      return true;
    }
    const jill = this.actors.get(RACE_JILL),
      player = this.player;
    if (!commands.includes("confirm") || !jill?.visible || !this.actorInteractionRequested(jill))
      return false;
    // `prepareNpcEvent`: an ordinary NPC turns to face the hero.
    if (jill.sprite <= 85) {
      jill.direction = (player.direction + 2) % 4;
      jill.state = WorldRuntime.facingState(jill.direction);
    }
    const window = this.syncRaceWindow(),
      first = !this.eventState.sourceEventStateComplete(RACE_SCENE, RACE_ROOM, 0);
    if (!first && !window.available) this.startRaceScript("limit", raceLimitScript());
    else this.startRaceScript("start", raceStartScript(first, window));
    return true;
  }
  private startRaceScript(id: string, events: RuntimeStoryEvent[]): void {
    this.startScript({ scene: RACE_SCENE, room: RACE_ROOM, group: 0 }, `race:${id}`, events);
  }
  private inRaceFinish(): boolean {
    return playerIntersectsSourceRect(this.player.x, this.player.y, RACE_FINISH);
  }
  /** `stopTimer`: the run's elapsed milliseconds. */
  private stopRace(): number {
    const elapsed = this.race.startMillis > 0 ? this.clock() - this.race.startMillis : 0;
    this.race = { active: false, startMillis: 0, countdown: 0, countdownTicks: 0 };
    return Math.max(0, elapsed);
  }
  /** `FinishFlow`: the prize for the time, then back to the start line's exit. */
  private finishRace(): void {
    const reward = raceReward(raceRewardTier(this.stopRace()), this.raceProgress.petClaimed);
    let notice: string | null = null;
    if (reward.kind === "pet") {
      const toBank = this.pets.length >= 6;
      this.grantSourcePet({
        ...RACE_PET,
        // `randomRewardStars`: one to five stars.
        quality: 1 + this.worldRandomBounded("race.luc-hanh-dieu.stars", 5),
      });
      this.raceProgress.petClaimed = true;
      notice = toBank ? RACE_TEXT.petBank : RACE_TEXT.petRoster;
    } else if (reward.kind === "money") {
      this.currency.money += reward.money;
      notice = `Thưởng ${reward.money} kim`;
    }
    this.startRaceScript("finish", raceEndScript(notice));
  }
  /**
   * `activateTouchedObstacle`: running into one of the eight obstacles knocks it over at once
   * (passable from then on) and it plays its fall (state 1), settling in state 2.
   */
  private touchRaceObstacle(commands: InputCommand[]): void {
    if (!this.race.active) return;
    const direction = commands.includes("up")
      ? DIRECTION_UP
      : commands.includes("down")
        ? DIRECTION_DOWN
        : commands.includes("left")
          ? DIRECTION_LEFT
          : commands.includes("right")
            ? DIRECTION_RIGHT
            : -1;
    if (direction < 0) return;
    const player = this.player;
    player.direction = direction;
    for (let id = RACE_FIRST_OBSTACLE; id <= RACE_LAST_OBSTACLE; id++) {
      const actor = this.actors.get(id);
      if (!actor || this.clearedObstacles.has(id)) continue;
      if (!this.playerFaces(actor, direction)) continue;
      this.clearedObstacles.add(id);
      actor.state = 1;
      actor.animationTick = 0;
      break;
    }
  }
  /** `tickObstacleAnimations`: a fallen obstacle whose state-1 cycle is over lies in state 2. */
  private tickRaceObstacles(): void {
    for (let id = RACE_FIRST_OBSTACLE; id <= RACE_LAST_OBSTACLE; id++) {
      const actor = this.actors.get(id);
      if (!actor || !this.clearedObstacles.has(id) || actor.state !== 1) continue;
      if (actor.animationTick >= Math.max(1, this.sources.animationTicks(actor.sprite, 1))) {
        actor.state = 2;
        actor.animationTick = 0;
      }
    }
  }
  /** The `worldHook` steps of the race scripts. */
  private raceHook(hook: string, elapsed: number): "continue" | "complete" | { branch: number } {
    if (hook === "race.accept") {
      // `StartFlow` phase 5: today's starts, then the fee; a start is counted before it is paid.
      const window = this.syncRaceWindow();
      if (!window.available) return { branch: 0 };
      if (this.currency.money < RACE_ENTRY_FEE) return { branch: 1 };
      this.raceProgress.attempts = Math.min(RACE_ATTEMPT_LIMIT, window.used + 1);
      return "complete";
    }
    if (hook === "race.resetObstacles") {
      for (let id = RACE_FIRST_OBSTACLE; id <= RACE_LAST_OBSTACLE; id++) {
        const actor = this.actors.get(id);
        this.clearedObstacles.delete(id);
        if (actor) {
          actor.state = 0;
          actor.animationTick = 0;
        }
      }
      return "complete";
    }
    if (hook === "race.countdown") {
      // `beginCountdown`, then `advanceCountdown` once a tick: 4…1 every 10 ticks, the clock at 41.
      if (elapsed === 1) {
        this.race = {
          active: false,
          startMillis: 0,
          countdown: COUNTDOWN_START,
          countdownTicks: 0,
        };
        return "continue";
      }
      const ticks = ++this.race.countdownTicks;
      if (this.race.countdown > 0 && ticks % COUNTDOWN_STEP_TICKS === 0) this.race.countdown--;
      if (ticks < COUNTDOWN_START_TICK) return "continue";
      this.race = { active: true, startMillis: this.clock(), countdown: 0, countdownTicks: 0 };
      return "complete";
    }
    return "complete";
  }
  /**
   * `tickCut`: once every clearing obstacle has played its state-1 cycle it settles cleared (state 2),
   * passable, and its key is saved; the hero goes back to standing.
   */
  private tickObstacleCut(): void {
    const cut = this.obstacleCut!,
      done = cut.actorIds.every((id) => {
        const actor = this.actors.get(id);
        return (
          !actor || actor.animationTick >= Math.max(1, this.sources.animationTicks(actor.sprite, 1))
        );
      });
    if (!done) return;
    for (const id of cut.actorIds) {
      const actor = this.actors.get(id);
      if (!actor) continue;
      actor.state = 2;
      actor.animationTick = 0;
      this.clearedObstacles.add(id);
      this.flags.addOpenedChest(obstacleKey(this.sceneId, this.roomIndex, id, actor.variant));
    }
    this.obstacleCut = null;
    this.setPlayerFacing(false);
  }
  /**
   * The action markers (`Actor.renderSourceMarker`): sprite 259 state 7 over each prompted obstacle,
   * 30 px up for a tree and 20 for a rock. Hidden while text or a panel owns the screen.
   */
  get obstaclePrompts(): { x: number; y: number }[] {
    if (!this.onFreeMap) return [];
    return this.obstaclePromptIds.flatMap((id) => {
      const actor = this.actors.get(id);
      return actor?.visible
        ? [{ x: actor.x, y: actor.y - (actor.variant === ROCK_BEHAVIOR ? 20 : 30) }]
        : [];
    });
  }
  /**
   * `VqsvSourceWorldObstacleRuntime.repairLegacyStrandedSave`: a save the web wrote while trees did
   * not block can stand a badge-less hero inside one of Mộc Lâm's tree pockets (3:1, 3:3), which the
   * original progression never allows. Unless he can walk to the room's entry door (within 20 px,
   * stepping 4 px without the Thủy Lam terrain), he is put back at that door.
   */
  private repairStrandedSave(): void {
    if (this.flags.badges.canClearTrees() || this.sceneId !== 3) return;
    if (this.roomIndex !== 1 && this.roomIndex !== 3) return;
    const anchorId = this.roomIndex === 1 ? 49 : 0,
      anchor = this.actors.get(anchorId),
      asset = this.sources.room(this.sceneId, this.roomIndex),
      map = asset && this.sources.collision(asset.mapId);
    if (!anchor || !asset || !map) return;
    const seen = new Set<string>([`${this.player.x},${this.player.y}`]),
      queue: [number, number][] = [[this.player.x, this.player.y]];
    for (let head = 0; head < queue.length; head++) {
      const [x, y] = queue[head];
      if (Math.abs(x - anchor.x) <= 20 && Math.abs(y - anchor.y) <= 20) return;
      for (const direction of [DIRECTION_UP, DIRECTION_DOWN, DIRECTION_LEFT, DIRECTION_RIGHT]) {
        if (this.actorBlocksMove(x, y, direction, 4)) continue;
        const step = stepWithTerrain(map, x, y, direction, false, 4),
          key = `${step.x},${step.y}`;
        if (step.moved && !seen.has(key)) {
          seen.add(key);
          queue.push([step.x, step.y]);
        }
      }
    }
    const arrival = transitionArrivalForTarget(this.sources.registry, asset, {
      scene: this.sceneId,
      room: this.roomIndex,
      actor: anchorId,
    });
    if (!arrival) return;
    this.player.x = arrival.x;
    this.player.y = arrival.y;
    this.player.direction = arrival.direction;
    this.setPlayerFacing(false);
    this.centerCamera();
  }
  /**
   * `WorldEngine.tickHaiAuFlight`: one step at the ride's speed over any terrain and past any actor,
   * held only by the map edge (tested at the bird, 25 px above the feet).
   */
  private haiAuFlightStep(direction: number): {
    x: number;
    y: number;
    direction: number;
    moved: boolean;
  } {
    const map = this.currentMap(),
      speed = this.playerMoveSpeed;
    let x = this.player.x,
      y = this.player.y;
    if (direction === DIRECTION_DOWN) y += speed;
    else if (direction === DIRECTION_RIGHT) x += speed;
    else if (direction === DIRECTION_UP) y -= speed;
    else x -= speed;
    const anchorY = y - HAI_AU_AIRBORNE_ANCHOR_Y;
    if (
      x <= mapLeft(map) ||
      x >= mapRight(map) ||
      anchorY <= mapTop(map) ||
      anchorY >= mapBottom(map)
    )
      return { x: this.player.x, y: this.player.y, direction, moved: false };
    return { x, y, direction, moved: true };
  }
  /**
   * `VqsvFreeWorldRuntime.tickSourceWorldTimers`: a tick the hero really moved runs
   * `WorldEncounterEngine.afterSuccessfulMovement`; any other tick only counts the repel down
   * (`afterSuccessfulMovementWithoutEncounter`). Both wait until the story has a main task.
   * Returns true when a wild fight starts.
   */
  private afterFreeMovement(moved: boolean): boolean {
    // `tickFreeWorldPlayerWithoutEncounters` in Di tích Kim Loại (10).
    if (moved && this.sceneId === 98 && this.roomIndex === LOST_PET_ROOM) return false;
    const timersEnabled = this.flags.mainTaskProgress !== 0;
    if (!moved) {
      if (!timersEnabled) return false;
      if (this.temporaryActorTicks > 0) this.temporaryActorTicks--;
      if (this.repelSteps > 0) {
        this.repelSteps--;
        if (this.repelSteps === 0) {
          this.repelSteps = -1;
          this.startRepelExpiryPrompt();
        }
      }
      return false;
    }
    const engine = this.encounters();
    if (!engine) return false;
    const result = engine.afterSuccessfulMovement(
      {
        timersEnabled,
        scene: this.sceneId,
        room: this.roomIndex,
        rideSuppressesEncounters: rideSuppressesEncounters(this.meta.campaign.ride.activeIndex),
        mainTaskProgress: this.flags.mainTaskProgress,
        rareEncounterBonusPercent: this.activeCharmValue("RARE_ENCOUNTER"),
        shinyGearEquipped: this.kimDiemAmuletEquipped(),
      },
      {
        temporaryActorTicks: this.temporaryActorTicks,
        avoidMonsterTicks: this.repelSteps,
        encounterStepsRemaining: this.encounterStepsRemaining,
      },
      () => terrainAtWorld(this.currentMap(), this.player.x, this.player.y),
    );
    this.temporaryActorTicks = result.temporaryActorTicks;
    this.repelSteps = result.avoidMonsterTicks;
    this.encounterStepsRemaining = result.encounterStepsRemaining;
    if (result.avoidExpired) {
      this.startRepelExpiryPrompt();
      return false;
    }
    if (!result.request) return false;
    return this.startWildBattle(result.request);
  }
  /** The engine over the world's own source stream, once the pools and the battle core exist. */
  private encounters(): WorldEncounterEngine | null {
    if (this.encounterEngine) return this.encounterEngine;
    const doc = this.sources.worldEncounters,
      services = this.sources.battle;
    if (!doc || !services) return null;
    // `VqsvSourceRandom.lazySourceSeeded()`: its own stream, seeded the way a fight is.
    this.encounterEngine = new WorldEncounterEngine(doc, {
      entry: (label, bound) => this.worldRandomBounded(label, bound),
      inclusive: (label, min, max) =>
        min + this.worldRandomBounded(label, Math.max(1, max - min + 1)),
    });
    return this.encounterEngine;
  }
  /** `VqsvFreeWorldEncounterProducer`: a wild fight; no run in room 3:7. */
  private startWildBattle(request: EncounterRequest): boolean {
    const services = this.sources.battle;
    if (!services) return false;
    this.battle = createWildBattle(
      services,
      request,
      this.pets,
      this.inventory,
      !(this.sceneId === 3 && this.roomIndex === 7),
      this.battleItemCatalog(),
      { playerActorSpriteId: this.player.sprite, enemyActorSpriteId: 0 },
      this.battleCharms(false),
      this.currency,
    );
    this.prepareBattleSprites(this.battle);
    this.wildBattle = true;
    this.battleEncounter = undefined;
    this.markEnemiesSeen(this.battle);
    this.setPhase("battleEntry");
    return true;
  }
  /** Start all dynamic pet sheets during the battle-entry wipe, before the first battle frame. */
  private prepareBattleSprites(battle: BattleRuntime): void {
    const prepare = this.sources.prepareSprite;
    if (!prepare) return;
    if (battle.core) for (const sprite of battle.core.spriteIds()) prepare(sprite);
    // The catch sheet is not one of the combatants, and therefore is not returned by
    // BattleCore.spriteIds(). Loading it only on the first capture frame makes the complete throw /
    // shrink sequence race the browser image request and appear to be missing. Java has sprite 269
    // resident before P17 starts, so warm the authored capture sheet during the entry wipe too.
    const captureSprite = battle.definition.tutorial?.captureSpriteId;
    if (captureSprite !== undefined && captureSprite >= 0) prepare(captureSprite);
  }
  /**
   * `Actor.applyMode`: a person (behaviour 1/18) takes the mode's directional family — 7 swings,
   * otherwise `mode / 3` rows of three facings — and any other actor plays state `mode` itself.
   */
  private static modeState(actor: { variant: number; direction: number }, mode: number): number {
    if (actor.variant !== 1 && actor.variant !== 18) return mode;
    const facing = WorldRuntime.facingState(actor.direction);
    if (mode === 7) return 3 + facing;
    const family = Math.trunc(mode / 3);
    return family >= 0 && family <= 3 ? family * 3 + facing : facing;
  }
  private static facingState(direction: number): number {
    return direction === DIRECTION_LEFT ? DIRECTION_RIGHT : Math.max(0, Math.min(2, direction));
  }
  private currentMap(): MapCollision {
    const asset = this.sources.room(this.sceneId, this.roomIndex),
      map = asset === undefined ? undefined : this.sources.collision(asset.mapId);
    if (!map)
      throw new Error(`World room ${this.sceneId}:${this.roomIndex} has no source map collision`);
    return map;
  }
  /** `RoomArrivalSafety`: once the room's collision is in, move a hero who arrived inside a wall. */
  private checkRoomArrival(): void {
    if (this.gymCloudsToHero) {
      const asset = this.sources.room(this.sceneId, this.roomIndex),
        map = asset && this.sources.collision(asset.mapId);
      if (map) {
        this.gymCloudsToHero = false;
        this.bringPlatformsToHero(map, [1, 2, 3, 4]);
      }
    }
    const safety = this.arrivalSafety;
    if (!safety) return;
    const asset = this.sources.room(this.sceneId, this.roomIndex);
    const map = asset && this.sources.collision(asset.mapId);
    if (!map) return;
    this.arrivalSafety = null;
    if (safety === "resume" && !wasBlockedArrival(this.sceneId, this.roomIndex, this.player)) {
      // Let room events inspect their authored coordinates before checking an old save on movement.
      this.resumedPosition = { x: this.player.x, y: this.player.y };
      return;
    }
    if (this.repairRoomPosition(map, false))
      this.roomEntry = { x: this.player.x, y: this.player.y };
  }
  private repairRoomPosition(map: MapCollision, preserveEscapable: boolean): boolean {
    if (this.hasHaiAuFlight()) return false;
    const player = this.player;
    const arrival = safeRoomArrival(
      map,
      player,
      this.playerMoveSpeed,
      this.movementTerrain,
      this.sceneId !== 98 && this.flags.terrainBadgeGatedOpen(),
      this.sceneId === 98,
      preserveEscapable,
      (x, y, direction, speed) => this.actorBlocksMove(x, y, direction, speed),
    );
    if (!arrival) return false;
    Object.assign(player, arrival);
    if (this.savePoint.scene === this.sceneId && this.savePoint.room === this.roomIndex)
      Object.assign(this.savePoint, arrival);
    this.centerCamera();
    return true;
  }
  private loadRoom(
    scene: number,
    room: number,
    x: number,
    y: number,
    direction: number,
    safety: "entry" | "resume" | null = null,
  ): void {
    // Every way into a room — a door, a story load, a warp, a save — starts its map fetch here;
    // the map-loading screen holds until it has arrived.
    if (this.sources.roomReady && !this.sources.roomReady(scene, room))
      this.sources.prepareRoom?.(scene, room);
    const previousScene = this.sceneId,
      previousRoom = this.roomIndex;
    this.sceneId = scene;
    this.roomIndex = room;
    // `NguyenMocC4RaceRuntime.onRoomReplacement` / `reconcileRoomEntry`: no reward, no start counted.
    this.race = { active: false, startMillis: 0, countdown: 0, countdownTicks: 0 };
    // `reconcileRoomEntry`: barriers the chapter has outgrown close before any trigger is read.
    for (const rule of ENTRY_COMPLETES[`${scene}:${room}`] ?? [])
      if (
        this.eventState.sourceEventStateComplete(rule.when.scene, rule.when.room, rule.when.group)
      )
        for (const done of rule.complete)
          if (!this.eventState.sourceEventStateComplete(done.scene, done.room, done.group))
            this.eventState.op23MarkEventComplete(done.scene, done.room, done.group);
    this.actors.clear();
    for (const actor of this.sources.room(scene, room)?.actors ?? [])
      this.actors.set(actor.id, { ...actor, animationTick: 0 });
    // `CauVongChapterRuntime.tickRoom1`: 8:1's portal actor shows only once it is open.
    const portal = ROOM_PORTALS[`${scene}:${room}`];
    if (portal) {
      const actor = this.actors.get(portal.actor);
      if (actor) actor.visible = this.flags.mainTaskProgress >= portal.minTask;
    }
    // The caught bunny (actor 50) leaves its own room, 1:1 — not every room's actor 50.
    if (
      this.objectiveComplete &&
      scene === this.data.battleGroup.scene &&
      room === this.data.battleGroup.room
    ) {
      const opponent = this.actors.get(this.data.encounter.actorId);
      if (opponent) opponent.visible = false;
    }
    this.actors.set(-1, {
      id: -1,
      sprite: 0,
      x,
      y,
      state: WorldRuntime.facingState(direction),
      direction,
      variant: 1,
      renderOffsetX: 0,
      renderOffsetY: 0,
      visible: true,
      layer: 1,
      animationTick: 0,
    });
    this.actors.set(WorldRuntime.COMPANION_ACTOR_ID, {
      id: WorldRuntime.COMPANION_ACTOR_ID,
      sprite: 0,
      x,
      y,
      state: 0,
      direction,
      variant: 0,
      renderOffsetX: 0,
      renderOffsetY: 0,
      visible: false,
      layer: 1,
      animationTick: 0,
    });
    // `Scene.tanNguyetLongMaBoss`: the custom boss stands in for Thánh Điện's statue.
    this.actors.set(TAN_NGUYET_ACTOR_ID, tanNguyetBossActor());
    if (isTanNguyetBossRoom(scene, room, this.actors.values()))
      this.sources.prepareSprite?.(TAN_NGUYET_LONG_MA.spriteId);
    this.tickTanNguyetBoss();
    // `VqsvSceneLoaders` room load: the room's ride policy (a save resume validates ownership too).
    this.applyRideRoomPolicy(this.restoringSave);
    // Web-only: walking into Chiến Thần Đà's room from the ruins' entrance (4:10) while he is still
    // uncaught (10:12:g4 open) lays its 28 floor shapes back and replays their tableau (g0), so a
    // save whose shapes were all broken without him appearing can break them again and meet him.
    if (
      scene === 10 &&
      room === 12 &&
      previousScene === 4 &&
      previousRoom === 10 &&
      !this.restoringSave &&
      !this.eventState.sourceEventStateComplete(10, 12, 4)
    ) {
      for (let id = 0; id <= 27; id++)
        this.flags.mutateSourceWorldFlag(1, switchFlag(10, 12, id));
      this.eventState.resetEvent(10, 12, 0);
    }
    this.dispatcher.enterRoom(scene, room);
    // `reconcileRoomEntry`: lit torches burn, and finished op59/op60 groups keep their actors' states.
    this.applySettledStates(this.actors);
    // A new room's actors carry no expression; screen effects end with the scene that showed them.
    this.cauVongExpressions.clear();
    this.cauVongEffects.length = 0;
    this.cauVongPresentation.reset();
    if (scene === 98 && room === CAU_VONG_HALL_ROOM) this.applyHallCast();
    if (scene === 98) this.applyLockeCast();
    if (scene === 98) this.applyOpeningCast();
    // `CauVongChapterRuntime` 1698: any other way into 45 or 56 makes it the city's room again.
    if (
      scene === 98 &&
      (room === 45 || room === 56) &&
      !this.restoringSave &&
      !(previousScene === 98 && northSeaOwnsRoom(previousRoom))
    )
      this.eventState.op42RepeatEvent(98, room, 200001);
    if (scene === 98) this.applyFourGatesCast();
    if (scene === 98) this.applyCityCast();
    if (scene === 98) this.applyBranchesCast();
    if (scene === 98) this.applySummoningCast();
    if (scene === 98) this.applyCauVongRocks();
    this.reconcileObstacles();
    this.platformRide = null;
    this.leafSummon = null;
    this.hazardSpin = null;
    this.gymHoleFall = null;
    this.iceDirection = null;
    this.roomEntry = { x, y };
    // `BlcC3Runtime.initializeTraversalHazards`: vortices start down (12) or right (13).
    if (this.hazardRoom())
      for (const actor of this.actors.values())
        if (actor.id >= 0 && actor.sourceKind === 0) {
          if (actor.variant === 12) actor.direction = DIRECTION_DOWN;
          if (actor.variant === 13) actor.direction = DIRECTION_RIGHT;
        }
    // `BlcC2Runtime.reconcileRoomEntry`: 7:4's clouds wait on the side the hero is on.
    if (scene === 7 && room === 4) this.reconcilePlatformsForSide(false);
    // `BlcC4Runtime.resetGymCloudsForRoomEntry`: back on the gym's entrance island, every cloud
    // returns to its room row.
    if (scene === 9 && room === 7 && y >= 320) this.stagePlatforms([0, 1, 2, 3, 4]);
    // Web fix: anywhere else in the gym (a resumed save, a lost save on an island) the clouds that
    // touch the hero's island come to it once the map is in, so no island is a dead end.
    else if (scene === 9 && room === 7) this.gymCloudsToHero = true;
    // `BichThuyHubRuntime.resetGymLotusForRoomEntry`: walking into the Bích Thủy gym (or resuming a
    // save there) lays its four leaves on their rows, so the course starts from the door again.
    if (
      scene === 9 &&
      room === 0 &&
      (previousScene !== scene || previousRoom !== room || this.restoringSave)
    )
      this.stagePlatforms(BICH_THUY_GYM_LEAVES);
    this.gymChallengers = this.roomGymChallengers(scene, room);
    this.dispatcher.setChallengers(
      new Map(
        this.gymChallengers.flatMap(({ actorId, groups }) =>
          groups.map((g) => [`${g.scene}:${g.room}:${g.group}`, actorId] as const),
        ),
      ),
    );
    // Fetch the rooms behind this room's doors and pads while the player walks to them.
    if (this.sources.prepareRoom)
      for (const target of [
        ...sourceDoors(this.sources.registry, scene, room).map((door) => door.target),
        ...sourceRoomDoors(this.sources.registry, scene, room).map((door) => door.target),
        ...sourceRoomPortals(scene, room).map((portal) => portal.target),
      ])
        this.sources.prepareRoom(target.scene, target.room);
    this.hud.showRoomTitle(this.sources.roomName?.(scene, room) ?? "");
    this.resumedPosition = null;
    this.arrivalSafety = safety;
    this.checkRoomArrival();
    this.centerCamera();
    // `loadCanonicalRoom`'s gate: a different room — or the first room of the session, which is a
    // change because no map was loaded yet — gets the source loading screen.
    const roomChanged = !this.mapLoaded || previousScene !== scene || previousRoom !== room;
    this.mapLoaded = true;
    if (roomChanged)
      this.mapLoading = MapLoadingRuntime.begin((label, bound) =>
        this.sourceRandom.next(label, bound),
      );
  }
  private centerCamera(): void {
    const asset = this.sources.room(this.sceneId, this.roomIndex),
      goal = cameraGoal(asset, this.player.x, this.player.y);
    this.cameraX = goal.x;
    this.cameraY = goal.y;
  }

  /** `WorldPetCompanionRuntime`: one roster pet follows a ten-position delayed trail. */
  togglePetCompanion(rosterIndex: number): void {
    const pet = this.pets[rosterIndex];
    if (!pet) return;
    const slot = pet.slot ?? rosterIndex;
    this.companionPetSlot = this.companionPetSlot === slot ? -1 : slot;
    this.companionBoundSlot = Number.MIN_SAFE_INTEGER;
    this.companionTrail.length = 0;
  }
  companionSelected(rosterIndex: number): boolean {
    const pet = this.pets[rosterIndex];
    return !!pet && (pet.slot ?? rosterIndex) === this.companionPetSlot;
  }
  private tickPetCompanion(): void {
    const actor = this.actors.get(WorldRuntime.COMPANION_ACTOR_ID),
      pet = this.pets.find((entry, index) => (entry.slot ?? index) === this.companionPetSlot),
      player = this.actors.get(-1);
    if (!actor || !pet || !player || !this.onFreeMap || !player.visible) {
      if (actor) actor.visible = false;
      this.companionTrail.length = 0;
      return;
    }
    const reset =
      this.companionBoundSlot !== this.companionPetSlot ||
      this.companionScene !== this.sceneId ||
      this.companionRoom !== this.roomIndex ||
      Math.max(Math.abs(actor.x - player.x), Math.abs(actor.y - player.y)) > 160;
    if (reset) {
      this.companionBoundSlot = this.companionPetSlot;
      this.companionScene = this.sceneId;
      this.companionRoom = this.roomIndex;
      actor.sprite = pet.visualSpriteId ?? this.sources.battle?.partyMember(pet).spriteId ?? 0;
      // `scene.petCompanion.paletteNature = selected.nature`.
      actor.paletteNature = pet.nature;
      actor.paletteColor = pet.shinyColor;
      actor.x = player.x - directionDx(player.direction, 22);
      actor.y = player.y - directionDy(player.direction, 22);
      actor.direction = player.direction;
      actor.state = 0;
      actor.animationTick = 0;
      this.companionTrail.length = 0;
    }
    const last = this.companionTrail.at(-1);
    if (!last || last.x !== player.x || last.y !== player.y)
      this.companionTrail.push({ x: player.x, y: player.y, direction: player.direction });
    let moved = false;
    while (this.companionTrail.length > 10) {
      const target = this.companionTrail.shift()!;
      const dx = target.x - actor.x,
        dy = target.y - actor.y;
      if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) actor.direction = dx > 0 ? 1 : 3;
      else if (dy !== 0) actor.direction = dy > 0 ? 0 : 2;
      else actor.direction = target.direction;
      actor.x += Math.sign(dx) * Math.min(3, Math.abs(dx));
      actor.y += Math.sign(dy) * Math.min(3, Math.abs(dy));
      moved ||= dx !== 0 || dy !== 0;
    }
    actor.state = moved ? 1 : 0;
    actor.visible = true;
    actor.animationTick++;
  }
}

const directionDx = (direction: number, amount: number): number =>
  direction === 1 ? amount : direction === 3 ? -amount : 0;
const directionDy = (direction: number, amount: number): number =>
  direction === 0 ? amount : direction === 2 ? -amount : 0;

const sameGroup = (group: GroupRef, other: GroupRef | undefined): boolean =>
  !!other &&
  group.scene === other.scene &&
  group.room === other.room &&
  group.group === other.group;
