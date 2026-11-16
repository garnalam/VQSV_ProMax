import { TaskOptionCatalog } from "../quest/TaskOption";
import type { SafariMap } from "../meta/Safari";
import type { ShopStockDocument } from "../shop/PortableShop";
import type { NpcServicesDocument } from "../world/NpcServices";
import {
  SHINY_BAKED_BASE,
  ShinyRecolorCache,
  shinyApplies,
  shinyBakedSpriteId,
  type ShinyPaletteDocument,
} from "../../rendering/PetShinyPalette";
import type { StateOneLEffectDocument } from "../battle/StateOneLEffect";
import {
  AreaMapCatalog,
  withCauVongAreas,
  type AreaMapDocument,
  type CauVongAreaMapDocument,
} from "../world/AreaMap";
import { BagCatalog, type BagItemsDocument } from "../inventory/Bag";
import { UnifiedItemCatalog, type UnifiedItemsDocument } from "../../data/UnifiedItems";
import { PetSpeciesCatalog, type PetSpeciesDocument } from "../pet/PetScreen";
import { PetSkillPoolCatalog, type PetSkillPoolDocument } from "../pet/PetSkillPool";
import { EvolutionCatalog, type PetEvolutionsDocument } from "../pet/Evolution";
import { BattleServices } from "../battle/engine/BattleServices";
import type { BadgeCatalogDocument, UnifiedBadgeRecord } from "../record/RecordBook";
import type { WorldEncountersDocument } from "../world/WorldEncounterEngine";
import { GameData } from "../../data/GameData";
import { PetStatCalculator } from "../battle/PetStatCalculator";
import { loadBattleRules, type BattleRules } from "../battle/BattleRules";
import { DEFAULT_BATTLE_DEFINITIONS } from "../battle/BattleDefinition";
import type { MapCollision } from "../world/MapCollision";
import type { Pack } from "../../pack/Pack";
import type { TowerContent } from "../meta/BondingTower";
import { StoryGraph, type StoryGraphDocument } from "./StoryGraph";
import { QuestCatalog, type BranchTask } from "../quest/QuestCatalog";
import type { GiftCodeDocument } from "../meta/GiftCodes";
import type { CampaignSystemsDocument } from "../campaign/CampaignSystems";
import type { RideRoomsDocument } from "../ride/RideSystem";
import { RainbowCharmCatalog, type RainbowCharmsDocument } from "../charm/RainbowCharms";
import type { CauVongCollisionDocument } from "../world/CauVongWorld";
import type { CauVongSquareDocument } from "../world/CauVongSquare";
import type { CauVongCuesDocument } from "../world/CauVongCutscene";
import type { CauVongHallDocument } from "../world/CauVongHall";
import type { CauVongLockeDocument } from "../world/CauVongLocke";
import type { CauVongOpeningDocument } from "../world/CauVongOpening";
import type { CauVongPrepDocument } from "../world/CauVongPrep";
import type { AcademyBattle, CauVongAcademyDocument } from "../world/CauVongAcademy";
import type { CauVongShopsDocument } from "../world/CauVongShop";
import type { CauVongFourGatesDocument } from "../world/CauVongFourGates";
import type { CauVongForestDocument } from "../world/CauVongForest";
import type { CauVongLabDocument } from "../world/CauVongLab";
import type { CauVongNorthSeaDocument } from "../world/CauVongNorthSea";
import type { CauVongCityDocument } from "../world/CauVongCity";
import type { CauVongBranchesDocument } from "../world/CauVongBranches";
import type { CauVongSummoningDocument } from "../world/CauVongSummoning";
/** A `banks.json` part: its image, its origin offset, and the mirrored copy's. */
export type MinigameBankPart = {
  file: string;
  ox: number;
  oy: number;
  w: number;
  h: number;
  mirrorFile: string;
  mox: number;
  moy: number;
};
export type MinigameBank = { cells: MinigameBankPart[]; regions: MinigameBankPart[] };
export type RoomActor = {
  id: number;
  sprite: number;
  state: number;
  direction: number;
  variant: number;
  sourceKind?: number;
  renderOrientation?: number;
  renderOffsetX: number;
  renderOffsetY: number;
  x: number;
  y: number;
  visible: boolean;
  layer: number;
  animationTick?: number;
  /**
   * The source row JavaSE gives a Cầu Vồng actor (`Actor.sourceOrder`): layers 0 and 2 draw in this
   * order, layer 1 by foot y and then this.
   */
  sourceOrder?: number;
};
export type RoomAsset = {
  mapId: number;
  width: number;
  height: number;
  actors: RoomActor[];
  /** An APK landscape map: where the JAR map's (0, 0) lies in it (`MapCollision.originX`). */
  originX?: number;
  originY?: number;
  /** The JAR room's own size, kept for the portrait (240x320) camera once an APK map widens it. */
  jarWidth?: number;
  jarHeight?: number;
};
export type SpriteFrame = {
  file: string;
  ox: number;
  oy: number;
  w: number;
  h: number;
  mirrorFile: string;
  mox: number;
  moy: number;
  mw: number;
  mh: number;
  ticks: number;
};
/**
 * A frame whose source cell has no pixels. It still holds the animation for `ticks` (Java keeps it in
 * the frame list) and draws nothing: sprites blink by alternating with it.
 */
export type BlankFrame = { empty: true; ticks: number };
export type StoredFrame = SpriteFrame | BlankFrame;
/** Marks a frame file that lives in the ride-sprites domain rather than the world bake. */
const RIDE_FRAME_TAG = "@ride/";
/** Marks a frame file that lives in the v4-sprites domain (`ExportWebV4PetSprites`). */
const V4_FRAME_TAG = "@v4/";
/** Marks a frame file that lives in the pet-sprites domain (`ExportWebPetSprites`). */
const PET_FRAME_TAG = "@pet/";
/** Marks a frame file in the shiny domain (`ExportWebShinyPalette`'s whole-frame bakes). */
const SHINY_FRAME_TAG = "@shiny/";
const SHINY_NATURES = [7, 8, 9] as const;
/** `ExportWebWharfTravel`'s boat (sprite 343), which no room seats. */
/** `[x, y, width, height]` relative to the actor's anchor (`SpriteData.collisionMask`). */
export type CollisionMask = readonly [number, number, number, number];
type SpriteCollisionDocument = {
  sprites: Record<string, Record<string, (CollisionMask | null)[]>>;
  /** `SpriteAnimator.currentHitMask` per frame (the laser beam's anchor height). */
  hit?: Record<string, Record<string, (CollisionMask | null)[]>>;
};
const WHARF_FRAME_TAG = "@wharf/";
/** Marks a frame file in the cau-vong-world domain (`ExportWebCauVongActors`). */
const CAU_VONG_FRAME_TAG = "@cv/";
/** Marks a frame file in the cau-vong-art domain (`ExportWebCauVongArt`). */
const CAU_VONG_ART_FRAME_TAG = "@cva/";
/** `loadRainbowExpression` (13000) and the op49 effect banks (13100..13105) a cue can show. */
const CAU_VONG_CUE_SPRITES = [13000, 13100, 13101, 13102, 13103, 13104, 13105];
/** `TextBox.withRainbowPortrait`'s seven faces (`cau-vong-art/portraits`). */
export const CAU_VONG_PORTRAITS = 7;
/** One actor `CauVongChapterRuntime.applyNpcVisuals` dressed, as `ExportWebCauVongActors` saw it. */
type CauVongActor = Pick<
  RoomActor,
  | "id"
  | "sprite"
  | "state"
  | "renderOrientation"
  | "renderOffsetX"
  | "renderOffsetY"
  | "x"
  | "y"
  | "visible"
  | "layer"
> & { sourceOrder: number };
type CauVongActorsDocument = { rooms: Record<string, CauVongActor[]> };
const isInk = (frame: StoredFrame | undefined): frame is SpriteFrame =>
  frame !== undefined && !("empty" in frame);
export type SourceSkillData = {
  id: number;
  name: string;
  description: string;
  element: number;
  power: number;
  learnTier: number;
  pp: number;
  effectMode: number;
  effectId: number;
  chanceOrParam: number;
  targetSide: number;
  effectRow: number[];
  animationSpriteId: number;
  animationState: number;
  animationTicks: number;
  /** The `skill-fx` effect this skill plays (a Cầu Vồng skill's stable key), instead of a sprite. */
  fxKey?: string;
};
export type SourceItemData = {
  id: number;
  name: string;
  description: string;
  iconCell: number;
  behavior: number;
  paramA: number;
  paramB: number;
  paramC: number;
};
export type SourcePetData = {
  id: number;
  name: string;
  level: number;
  quality: number;
  nature?: number;
  element: number;
  spriteId: number;
  maxHp: number;
  attack?: number;
  defense?: number;
  speed?: number;
  skills?: SourceSkillData[];
};
export type WorldContract = {
  schemaVersion: number;
  save: { scene: number; room: number; x: number; y: number; resumeMode: "BUNNY_OP13" };
  initial?: { items: Record<string, number>; activeTask: string; mainTaskProgress: number };
  trigger: { x: number; y: number; width: number; height: number };
  battleGroup: { scene: number; room: number; group: number };
  elderGroup: { scene: number; room: number; group: number };
  encounter: {
    actorId: number;
    /** The runtime descriptor symbol the AI v2 catalog files this encounter under. */
    descriptor?: string;
    request: [number, number, number];
    flags: [number, number];
    mode: [number, number];
    branchTargets: number[];
  };
  afterBattle: { scene: number; room: number; x: number; y: number; direction: number };
  elderActor: number;
  player: SourcePetData;
  opponent: SourcePetData;
  items: { sealBall: number; guaranteedBall: number };
  itemCatalog: SourceItemData[];
  capture: {
    spriteId: number;
    durations: [number, number, number, number];
    effectDurations: [number, number];
    shrinkSteps: Array<[number, number, number]>;
    restoreSteps: Array<[number, number, number]>;
  };
  text: {
    savePrompt: string;
    saveInProgress: string;
    saveSuccess: string;
    battleReport: string;
    returnTask: string;
    weak: string;
    retry: string;
  };
};
type RoomsManifest = { rooms: Record<string, RoomAsset> };
type RoomNamesDocument = { names: Record<string, string> };
/** The opening and Scene 1: what a new game or a Scene 1 save shows before anything else loads. */
const STARTUP_ROOMS = ["7:2", "-1:-1", "5:3", "1:0", "1:1", "1:2", "1:3", "1:4", "1:5", "1:6"];
type MainTasksDocument = { tasks: { name: string; description: string }[] };
type SpritesManifest = { sprites: Record<string, { states: Record<string, StoredFrame[]> }> };
/** One `hd.json` frame: the 3x cut of a logical frame and the logical box it covers. */
type HdFrame = {
  file: string;
  ox: number;
  oy: number;
  w: number;
  h: number;
  mirrorFile: string;
  mox: number;
  moy: number;
  mw: number;
  mh: number;
};
/**
 * `ExportWebCauVongActors.hd`: Kim Diễm Long Vương's visuals (3006 battle, 3007 world) as the
 * 720x960 scene98/room49 surface draws them, and each state's authored `animationBounds`.
 */
export type CauVongHdDocument = {
  scale: number;
  sprites: Record<
    string,
    {
      frames: Record<string, (HdFrame | null)[]>;
      bounds: Record<string, [number, number, number, number]>;
    }
  >;
};
export type MetaSystemsDocument = {
  fashion: {
    profileVersion: string;
    baseKey: string;
    records: Array<{
      key: string;
      displayName?: string;
      kind: "base" | "liet-hoa" | "cau-vong";
      family: string;
      resourceId: number;
      animationBase: number;
      animationSpan: number;
      collectible: boolean;
      png: string;
    }>;
    economy: {
      profileVersion: string;
      poolVersion: string;
      bagPrice: number;
      bagCapacity: number;
      fragmentCapacity: number;
      tiers: Array<{
        code: string;
        label: string;
        probabilityBps: number;
        duplicateFragments: number;
        exchangeFragments: number;
      }>;
      entries: Array<{ key: string; tier: string }>;
    };
  };
  rematches: Array<{
    region: number;
    name: string;
    descriptor: string;
    encounterKey: string;
    rewardMoney: number;
    title: string;
  }>;
  battlePass: {
    seasonKey: string;
    title: string;
    maxLevel: number;
    vipPriceBadges: number;
    xpPerLevel: number;
    seasonDays: number;
    missions: Array<{ key: string; label: string; event: string; target: number; xp: number }>;
    levels: Array<{
      level: number;
      free: Array<{ kind: string; id: number; quantity: number; label: string }>;
      vip: Array<{ kind: string; id: number; quantity: number; label: string }>;
    }>;
  };
};
/**
 * Lays `ExportWebCauVongActors`' dressed actors over the 98:* rooms by actor id: sprite, pose,
 * mirror, the (10, 19) source anchor, position, visibility, layer and source row. Every other
 * field (the exit arrows, `sourceKind`, `variant`) stays as the world bake has it.
 */
export function applyCauVongActors(
  rooms: Record<string, RoomAsset>,
  document: CauVongActorsDocument,
): void {
  for (const [key, dressed] of Object.entries(document.rooms)) {
    const room = rooms[key];
    if (!room) continue;
    for (const actor of dressed) {
      const seat = room.actors.find((candidate) => candidate.id === actor.id);
      if (seat) Object.assign(seat, actor);
      // An actor JavaSE adds on load (Sai Kỳ, 47#92, `CauVongOpeningSourceRuntime.champion`) or a
      // cue's cast has no seat in `world/rooms.json`: it joins the room as a plain source actor.
      else room.actors.push({ direction: 0, variant: 0, sourceKind: 2, ...actor });
    }
  }
}

export class GameAssets {
  private constructor(
    readonly pack: Pack,
    readonly rooms: Record<string, RoomAsset>,
    readonly sprites: SpritesManifest["sprites"],
    readonly maps: Map<number, HTMLImageElement[]>,
    readonly collisions: Map<number, MapCollision>,
    readonly worldContract: WorldContract,
    readonly petStats: PetStatCalculator,
    readonly battleRules: BattleRules,
    /** Bag items, AI v2 and level progression for fights on the battle core. */
    readonly battleServices: BattleServices,
    /** `VqsvSourceRoomNames`: "scene:room" → the banner name. */
    readonly roomNames: Readonly<Record<string, string>> = {},
    /** `mTask.mid`: the main tasks' names and objectives, by task index. */
    readonly mainTasks: readonly { name: string; description: string }[] = [],
    /** `story/story-graph`: the storyline from Liệt Hỏa to Cầu Vồng, absent in a pack without it. */
    readonly storyGraph?: StoryGraph,
    /** Main tasks plus the `bTask`/`bqTask` branch tasks. */
    readonly quests?: QuestCatalog,
    /** The original area map (`game.l` state 4): rooms per area, colours, markers. */
    readonly areaMaps?: AreaMapCatalog,
    /** The original bag's item tables (db.mid groups 3/4/5). */
    readonly bagItems?: BagCatalog,
    /** The original species table (db.mid group 0) the pet screen reads. */
    readonly petSpecies?: PetSpeciesCatalog,
    /** The skill screen's family pools ("BỂ CHIÊU"). */
    readonly petSkillPools?: PetSkillPoolCatalog,
    /** JavaSE `UnifiedEvolutionCatalog` / `VqsvSourceEvolutionRuntime` rules. */
    readonly evolutions?: EvolutionCatalog,
    readonly petTaxonomy: Readonly<Record<string, string>> = {},
    /** `items/catalog.json`: the JavaSE unified Item catalog (both games). */
    readonly items?: UnifiedItemCatalog,
    /** Đồ giám: the eight source badges (`ExportWebBadgeCatalog`) and the unified ones. */
    readonly badgeCatalog?: BadgeCatalogDocument,
    readonly unifiedBadges: readonly UnifiedBadgeRecord[] = [],
    /** `WorldEncounterEngine`'s pools for the free-world random wild encounters. */
    readonly worldEncounters?: WorldEncountersDocument,
    readonly metaSystems?: MetaSystemsDocument,
    readonly giftCodes?: GiftCodeDocument,
    readonly campaignSystems?: CampaignSystemsDocument,
    readonly bondingTower?: TowerContent,
  ) {}
  safariMap?: SafariMap;
  roomName(scene: number, room: number): string {
    return this.roomNames[`${scene}:${room}`] ?? "";
  }
  static async fromPack(pack: Pack): Promise<GameAssets> {
    const data = new GameData(pack);
    const [
      roomData,
      spriteData,
      quest,
      petStats,
      battleRules,
      roomNames,
      mainTasks,
      graph,
      branches,
      itemRows,
      areaMaps,
      bagItems,
      petSpecies,
      petSkillPools,
      evolutions,
      petTaxonomy,
      itemsDocument,
      petEvolutions,
      badgeCatalog,
      unifiedBadges,
      worldEncounters,
      metaSystems,
      bondingTower,
      giftCodes,
      campaignSystems,
      rideSprites,
      rideRooms,
      rainbowCharms,
      npcServices,
      shopStock,
      v4Sprites,
      petSprites,
      taskOffers,
      wharfSprites,
      spriteCollision,
      cauVongSprites,
      cauVongActors,
      cauVongCollision,
      cauVongSquare,
      cauVongCues,
      cauVongHall,
      cauVongLocke,
      cauVongOpening,
      cauVongPrep,
      cauVongAcademy,
      cauVongShops,
      cauVongFourGates,
      cauVongForest,
      cauVongLab,
      cauVongNorthSea,
      cauVongCity,
      cauVongBranches,
      cauVongSummoning,
      cauVongArtSprites,
      cauVongIcons,
      cauVongBanks,
      cauVongHd,
      shinyPalette,
      shinyFrames,
    ] = await Promise.all([
      pack.json<RoomsManifest>("world.rooms"),
      pack.json<SpritesManifest>("world.sprites"),
      pack.json<WorldContract>("story.world-contract"),
      PetStatCalculator.load(data),
      loadBattleRules(data),
      pack.json<RoomNamesDocument>("story.room-names"),
      pack.json<MainTasksDocument>("story.main-tasks"),
      pack.json<StoryGraphDocument>("story.story-graph"),
      pack.json<{ tasks: BranchTask[] }>("data.quest/branch-tasks.json"),
      data.items(),
      Promise.all([
        pack.json<AreaMapDocument>("story.area-maps"),
        pack.json<CauVongAreaMapDocument>("cau-vong-world.area-map"),
      ]).then(([lietHoa, cauVong]) => withCauVongAreas(lietHoa, cauVong)),
      pack.json<BagItemsDocument>("story.bag-items"),
      pack.json<PetSpeciesDocument>("story.pet-species"),
      pack.json<PetSkillPoolDocument>("story.pet-skill-pools"),
      data.evolutions(),
      pack.json<{ species: Record<string, string> }>("story.pet-taxonomy"),
      pack.json<UnifiedItemsDocument>("items.catalog"),
      pack.json<PetEvolutionsDocument>("story.pet-evolutions"),
      pack.json<BadgeCatalogDocument>("story.badge-catalog"),
      data.badges(),
      pack.json<WorldEncountersDocument>("story.world-encounters"),
      pack.json<MetaSystemsDocument>("story.meta-systems"),
      pack.json<TowerContent>("story.bonding-tower"),
      pack.json<GiftCodeDocument>("story.gift-codes"),
      pack.json<CampaignSystemsDocument>("story.campaign-systems"),
      pack.json<SpritesManifest>("ride-sprites.sprites"),
      pack.json<RideRoomsDocument>("story.ride-rooms"),
      pack.json<RainbowCharmsDocument>("story.rainbow-charms"),
      pack.json<NpcServicesDocument>("story.npc-services"),
      pack.json<ShopStockDocument>("story.shop-stock"),
      pack.json<SpritesManifest>("v4-sprites.sprites"),
      pack.json<SpritesManifest>("pet-sprites.sprites"),
      data.taskOffers(),
      pack.json<SpritesManifest>("wharf.sprites"),
      pack.json<SpriteCollisionDocument>("sprite-collision.masks"),
      pack.json<SpritesManifest>("cau-vong-world.sprites"),
      pack.json<CauVongActorsDocument>("cau-vong-world.actors"),
      pack.json<CauVongCollisionDocument>("cau-vong-world.collision"),
      pack.json<CauVongSquareDocument>("cau-vong-world.square"),
      pack.json<CauVongCuesDocument>("cau-vong-world.cues"),
      pack.json<CauVongHallDocument>("cau-vong-world.hall"),
      pack.json<CauVongLockeDocument>("cau-vong-world.locke"),
      pack.json<CauVongOpeningDocument>("cau-vong-world.opening"),
      pack.json<CauVongPrepDocument>("cau-vong-world.prep"),
      pack.json<CauVongAcademyDocument>("cau-vong-world.academy"),
      pack.json<CauVongShopsDocument>("cau-vong-world.shops"),
      pack.json<CauVongFourGatesDocument>("cau-vong-world.four-gates"),
      pack.json<CauVongForestDocument>("cau-vong-world.forest"),
      pack.json<CauVongLabDocument>("cau-vong-world.lab"),
      pack.json<CauVongNorthSeaDocument>("cau-vong-world.north-sea"),
      pack.json<CauVongCityDocument>("cau-vong-world.city"),
      pack.json<CauVongBranchesDocument>("cau-vong-world.branches"),
      pack.json<CauVongSummoningDocument>("cau-vong-world.summoning"),
      pack.json<SpritesManifest>("cau-vong-art.sprites"),
      pack.json<{
        ui: [number, number, number, number][];
        item: [number, number, number, number][];
        itemAlias: Record<string, number>;
      }>("cau-vong-art.icons"),
      pack.json<Record<string, MinigameBank>>("cau-vong-art.banks"),
      pack.json<CauVongHdDocument>("cau-vong-world.hd"),
      pack.json<ShinyPaletteDocument>("shiny.palette"),
      Promise.all(
        SHINY_NATURES.map((nature) => pack.json<SpritesManifest>(`shiny.sprites-${nature}`)),
      ),
      // The state-1 L lasts a handful of ticks, too short to wait for its picture: all nine load
      // with the rest.
      pack
        .json<StateOneLEffectDocument>("l-effect.l-effect")
        .then((document) =>
          pack.imagesFor(
            Object.values(document.species).map((entry) => `l-effect.${entry.visual}.png`),
          ),
        ),
    ]);
    const items = new UnifiedItemCatalog(itemsDocument);
    // The mounted hero (`ExportWebRideSprites`) joins the world's sprite table; its frames are
    // tagged so `frameKey` resolves them in the ride-sprites domain.
    const merge = (manifest: SpritesManifest, tag: string) => {
      for (const [id, sprite] of Object.entries(manifest.sprites)) {
        for (const frames of Object.values(sprite.states))
          for (const frame of frames)
            if (isInk(frame)) {
              frame.file = tag + frame.file;
              frame.mirrorFile = tag + frame.mirrorFile;
            }
        spriteData.sprites[id] ??= sprite;
      }
    };
    merge(rideSprites, RIDE_FRAME_TAG);
    // The 72 V4 pets (visual 2000..), `V4PetSpriteCatalog`'s registered cute set: the battle, the
    // pet screens and the egg preview draw them like any world sprite.
    merge(v4Sprites, V4_FRAME_TAG);
    // Every other battle visual no room shows (`ExportWebPetSprites`): an NPC's roster, a lent
    // companion, the Cầu Vồng pets and the custom bosses.
    merge(petSprites, PET_FRAME_TAG);
    merge(wharfSprites, WHARF_FRAME_TAG);
    // The Cầu Vồng cast: `world/rooms.json` seats every 98:* actor on the placeholder sprite 223;
    // JavaSE dresses them only when the room loads (`applyNpcVisuals`), so the bake of that load
    // is laid over the room here.
    merge(cauVongSprites, CAU_VONG_FRAME_TAG);
    applyCauVongActors(roomData.rooms, cauVongActors);
    applyCauVongActors(roomData.rooms, { rooms: cauVongCues.actors });
    merge(cauVongArtSprites, CAU_VONG_ART_FRAME_TAG);
    // `PetShinyPalette` for Hỏa Diễm Hầu Vương, whose swap masks by sheet position: its recoloured
    // frames, seated at `shinyBakedSpriteId(visual, nature)`.
    SHINY_NATURES.forEach((nature, index) => {
      const baked: SpritesManifest = { sprites: {} };
      for (const [visual, sprite] of Object.entries(shinyFrames[index].sprites))
        baked.sprites[String(shinyBakedSpriteId(Number(visual), nature))] = sprite;
      merge(baked, `${SHINY_FRAME_TAG}n${nature}/`);
    });
    // `world-contract.json` only carries the three items needed by the opening tutorial. The live
    // bag, however, can contain every Liệt Hỏa BAG row. Keep one source-owned catalogue here so a
    // later item never falls back to `iconCell = itemId` (the atlas starts at cell 25 and is sparse).
    const sourceItems = new Map<number, SourceItemData>();
    for (const item of itemRows) {
      if (item.sourceKey !== "liet-hoa" || item.inventoryKind !== "UnifiedItemInventoryKind.BAG")
        continue;
      sourceItems.set(item.runtimeId, {
        id: item.runtimeId,
        name: item.name,
        description: item.description,
        iconCell: item.frameId,
        behavior: 0,
        paramA: 0,
        paramB: 0,
        paramC: 0,
      });
    }
    // The focused world contract remains authoritative for authored tutorial behavior/parameters.
    for (const item of quest.itemCatalog ?? []) sourceItems.set(item.id, item);
    const worldContract: WorldContract = { ...quest, itemCatalog: [...sourceItems.values()] };
    const battleServices = await BattleServices.load(data, battleRules, petStats),
      evolutionCatalog = new EvolutionCatalog(evolutions, petEvolutions);
    // Pet State's "Chủng" and "Hóa", in a fight and on the map alike.
    battleServices.petFacts = {
      species: (id) => petTaxonomy.species[String(id)],
      evolution: (id) => evolutionCatalog.text(id),
    };
    const result = new GameAssets(
      pack,
      roomData.rooms,
      spriteData.sprites,
      new Map(),
      new Map(),
      worldContract,
      petStats,
      battleRules,
      battleServices,
      roomNames.names,
      mainTasks.tasks,
      new StoryGraph(graph),
      new QuestCatalog(mainTasks.tasks, branches.tasks),
      new AreaMapCatalog(areaMaps),
      new BagCatalog(bagItems, items),
      new PetSpeciesCatalog(petSpecies),
      new PetSkillPoolCatalog(petSkillPools),
      evolutionCatalog,
      petTaxonomy.species,
      items,
      badgeCatalog,
      unifiedBadges,
      worldEncounters,
      metaSystems,
      giftCodes,
      campaignSystems,
      bondingTower,
    );
    // The whole world (Liệt Hỏa and Cầu Vồng) is in the bake now; only the opening and Scene 1
    // are fetched before the first frame, every other room when the world first needs it.
    result.safariMap = await pack.json<SafariMap>("safari.map.json");
    await pack.imagesFor([
      "safari.ground.png",
      "safari.gate.png",
      "safari.water.png",
      "safari.battle-platform.png",
      ...result.safariMap.sources.map((source) => `safari.atlas-${source.id}.png`),
    ]);
    result.rideRooms = rideRooms;
    result.cauVongCollision = cauVongCollision.rooms;
    result.cauVongSquare = cauVongSquare;
    result.cauVongCues = cauVongCues;
    result.cauVongHall = cauVongHall;
    result.cauVongLocke = cauVongLocke;
    result.cauVongOpening = cauVongOpening;
    // `VqsvSourceOps.sourceItem`: Lucy's lunch is a quest row of its own, ahead of the tables.
    const lunch = cauVongOpening.items.lunch;
    result.bagItems?.addQuestItem(lunch.id, lunch.name, lunch.description);
    result.cauVongPrep = cauVongPrep;
    // The academy pass (`CauVongAcademyCatalog.PASS_ITEM`) is a quest row as well.
    const pass = cauVongPrep.academy.pass;
    result.bagItems?.addQuestItem(pass.id, pass.name, pass.description);
    result.cauVongAcademy = cauVongAcademy;
    result.cauVongShops = cauVongShops;
    // The ceremony's medal (`ACADEMY_AWARD_ITEM_ID`) replaces the pass in the same list.
    const medal = cauVongAcademy.award;
    result.bagItems?.addQuestItem(medal.id, medal.name, medal.description);
    // CV4's recovered ball and the excitement mushrooms (`CauVongFourGateTransactions`).
    result.cauVongFourGates = cauVongFourGates;
    for (const item of [cauVongFourGates.items.ball, cauVongFourGates.items.mushroom])
      result.bagItems?.addQuestItem(item.id, item.name, item.description);
    // Every Cầu Vồng trainer request names its AI tier (`BattleRequest.RuntimeProfile.aiProfile`):
    // the forest's principal ELITE, Rafael BOSS (`CauVongFinalBattleBalance`), the rest TRAINER.
    for (const doc of [
      cauVongAcademy,
      cauVongFourGates,
      cauVongForest,
      cauVongLab,
      cauVongNorthSea,
      cauVongLocke,
    ])
      for (const battle of Object.values<AcademyBattle>(doc.battles))
        if (battle.tier) battle.profile = await data.aiProfileForTier(battle.tier);
    result.cauVongForest = cauVongForest;
    result.cauVongLab = cauVongLab;
    // CV5: Bắc Hải, with its ticket and the odd key; CV6's trophy (`VqsvSourceOps.sourceItem`).
    result.cauVongNorthSea = cauVongNorthSea;
    // The city's side rooms (45, 46, 56): Lisa, the shop's gift and clerks, the rooftop.
    result.cauVongCity = cauVongCity;
    // The aux room 67, its lifts, 43's quest scroll and every room's treasures.
    result.cauVongBranches = cauVongBranches;
    // CV0': the summoning hub, the trial rooms and their games, the summoners' hall, Long Vương.
    result.cauVongSummoning = cauVongSummoning;
    result.cauVongUiRegions = cauVongIcons.ui;
    result.cauVongItemRegions = cauVongIcons.item;
    result.cauVongItemAlias = cauVongIcons.itemAlias;
    result.cauVongBanks = cauVongBanks;
    result.cauVongHd = cauVongHd;
    result.shiny = new ShinyRecolorCache(shinyPalette);
    // Pet State's "Đeo": the equipment table's name, as the equip menu shows it.
    const bag = result.bagItems;
    if (bag && battleServices.petFacts)
      battleServices.petFacts.heldName = (id) => bag.equipment(id)?.name;
    const scroll = cauVongBranches.aux.scroll;
    result.bagItems?.addQuestItem(scroll.id, scroll.name, scroll.description ?? "");
    const sea = cauVongNorthSea.items;
    for (const item of [sea.ticket, sea.key, sea.trophy])
      result.bagItems?.addQuestItem(item.id, item.name, item.description);
    result.rainbowCharms = new RainbowCharmCatalog(rainbowCharms);
    result.npcServices = npcServices;
    result.shopStock = shopStock;
    result.spriteCollision = spriteCollision.sprites;
    result.spriteHit = spriteCollision.hit ?? {};
    result.taskOptions = new TaskOptionCatalog(
      taskOffers,
      itemRows,
      (species) => petStats.speciesRow(species)?.name,
    );
    await Promise.all(STARTUP_ROOMS.map((key) => result.prepareRoomKey(key)));
    await result.preloadRoomFrames();
    return result;
  }

  /** `sprite-collision/masks.json`: each world sprite frame's collision mask. */
  spriteCollision: SpriteCollisionDocument["sprites"] = {};
  /**
   * `Actor.collisionMask()`: the collision rectangle of the frame `tick` ticks into `state` (the
   * frame `frameAt` draws), or null when the sprite's cell has none.
   */
  collisionMask(sprite: number, state: number, tick: number): CollisionMask | null {
    return this.frameMask(this.spriteCollision, sprite, state, tick);
  }
  /** `spriteHit`: each world sprite frame's hit mask (`Actor.hitMask()`). */
  spriteHit: SpriteCollisionDocument["sprites"] = {};
  /** `Actor.hitMask()`: the hit rectangle of the frame `tick` ticks into `state`, or null. */
  hitMask(sprite: number, state: number, tick: number): CollisionMask | null {
    return this.frameMask(this.spriteHit, sprite, state, tick);
  }
  private frameMask(
    table: SpriteCollisionDocument["sprites"],
    sprite: number,
    state: number,
    tick: number,
  ): CollisionMask | null {
    const masks = table[String(sprite)],
      frames = this.sprites[String(sprite)]?.states,
      key = frames?.[String(state)] ? String(state) : "0",
      list = frames?.[key];
    if (!masks || !list?.length) return null;
    const total = list.reduce((sum, f) => sum + Math.max(1, f.ticks), 0);
    let cursor = total ? tick % total : 0,
      index = 0;
    for (; index < list.length - 1; index++) {
      if (cursor < list[index].ticks) break;
      cursor -= list[index].ticks;
    }
    return masks[key]?.[index] ?? null;
  }
  /** `story/shop-stock.json`: the two shopbuy stocks. */
  shopStock?: ShopStockDocument;
  /** `quest/task-offers.json`: what `taskOption.ui` shows for each branch task offer (op49). */
  taskOptions?: TaskOptionCatalog;
  /** `story/npc-services.json`: the town service NPCs. */
  npcServices?: NpcServicesDocument;
  /** `story/rainbow-charms.json`: the team charms. */
  rainbowCharms?: RainbowCharmCatalog;
  /** `story/ride-rooms.json`: each room's ride restrictions. */
  rideRooms?: RideRoomsDocument;
  /** `cau-vong-world/collision.json`: each 98:* actor's movement snapshot and talk role. */
  cauVongCollision: CauVongCollisionDocument["rooms"] = {};
  /** `cau-vong-world/square.json`: Quảng Trường Cầu Vồng's intro and residents. */
  cauVongSquare?: CauVongSquareDocument;
  /** `cau-vong-world/cues.json`: the opening cutscenes (`CauVongOpeningSourceRuntime`). */
  cauVongCues?: CauVongCuesDocument;
  /** `cau-vong-world/hall.json`: Đại sảnh Cúp Cầu Vồng's spectators and Linh. */
  cauVongHall?: CauVongHallDocument;
  /** `cau-vong-world/locke.json`: Lạc Khắc's rival chain (`CauVongLockeChainRuntime`). */
  cauVongLocke?: CauVongLockeDocument;
  /** `cau-vong-world/opening.json`: the manor-to-ruins route (CV0 room 54 and CV1). */
  cauVongOpening?: CauVongOpeningDocument;
  /** `cau-vong-world/prep.json`: CV2, the egg lessons and the road to the academy. */
  cauVongPrep?: CauVongPrepDocument;
  /** `cau-vong-world/academy.json`: CV3, the arenas and the academy's first days. */
  cauVongAcademy?: CauVongAcademyDocument;
  /** `cau-vong-world/shops.json`: the Cầu Vồng shops' stock, sale prices and mutation document. */
  cauVongShops?: CauVongShopsDocument;
  /** `cau-vong-world/four-gates.json`: CV4's Bốn Cổng owner (`CauVongFourGateSourceRuntime`). */
  cauVongFourGates?: CauVongFourGatesDocument;
  /** `cau-vong-world/forest.json`: CV4b, Rừng U Ám, 60, the north rescue and the rocks. */
  cauVongForest?: CauVongForestDocument;
  /** `cau-vong-world/lab.json`: CV4c, Hoàng Dực Điểu, the laboratory, the exam, Thiết Giáp Xà. */
  cauVongLab?: CauVongLabDocument;
  /** `cau-vong-world/north-sea.json`: CV5, Bắc Hải (its owners, boats, doors and branches). */
  cauVongNorthSea?: CauVongNorthSeaDocument;
  /** `cau-vong-world/city.json`: the city's side rooms (45, 46, 56), Lisa and the shop clerks. */
  cauVongCity?: CauVongCityDocument;
  /** `cau-vong-world/branches.json`: the aux room 67, its lifts, 43's quest scroll, the treasures. */
  cauVongBranches?: CauVongBranchesDocument;
  /** `cau-vong-world/summoning.json`: CV0' Thiên Không's summoning rooms and minigames. */
  cauVongSummoning?: CauVongSummoningDocument;
  /** `RainbowMinigameArt`'s ui_m.d regions ([x, y, w, h] into minigame/ui.png). */
  cauVongUiRegions?: [number, number, number, number][];
  /** `RainbowMinigameArt`'s item_m.d regions ([x, y, w, h] into minigame/item.png) and the 35 → 38 alias. */
  cauVongItemRegions?: [number, number, number, number][];
  cauVongItemAlias?: Record<string, number>;
  /** The finish line (13300) and arena (13301) composition banks (`loadRainbowMinigame`). */
  cauVongBanks?: Record<string, MinigameBank>;
  /** `RainbowMinigameArt.image(name)`: cloud, brow/m0, brow/m2, brow/m3, ui, item. */
  cauVongArt(name: string): HTMLImageElement {
    return this.pack.imageElement(`cau-vong-art.minigame/${name.replace("/", "-")}.png`);
  }
  /** A composition bank part's image (`cau-vong-art` file). */
  cauVongBankImage(file: string): HTMLImageElement {
    return this.pack.imageElement(`cau-vong-art.${file}`);
  }
  /** `RainbowMinigameArt.image("ui")`. */
  cauVongUi(): HTMLImageElement {
    return this.pack.imageElement("cau-vong-art.minigame/ui.png");
  }
  /** `TextBox.withRainbowPortrait(index)`'s face. */
  cauVongPortrait(index: number): HTMLImageElement {
    return this.pack.imageElement(`cau-vong-art.portraits/${index}.png`);
  }
  /** A sprite frame's pack key: the world bake, or the ride-sprites domain for a tagged rider frame. */
  private frameKey(file: string): string {
    if (file.startsWith(RIDE_FRAME_TAG)) return `ride-sprites.${file.slice(RIDE_FRAME_TAG.length)}`;
    if (file.startsWith(V4_FRAME_TAG)) return `v4-sprites.${file.slice(V4_FRAME_TAG.length)}`;
    if (file.startsWith(PET_FRAME_TAG)) return `pet-sprites.${file.slice(PET_FRAME_TAG.length)}`;
    if (file.startsWith(SHINY_FRAME_TAG)) return `shiny.${file.slice(SHINY_FRAME_TAG.length)}`;
    if (file.startsWith(WHARF_FRAME_TAG)) return `wharf.${file.slice(WHARF_FRAME_TAG.length)}`;
    if (file.startsWith(CAU_VONG_FRAME_TAG))
      return `cau-vong-world.${file.slice(CAU_VONG_FRAME_TAG.length)}`;
    if (file.startsWith(CAU_VONG_ART_FRAME_TAG))
      return `cau-vong-art.${file.slice(CAU_VONG_ART_FRAME_TAG.length)}`;
    return this.pack.worldKey(file);
  }
  /** Fetch every frame of a sprite (a rider the hero just mounted). */
  prepareSprite(sprite: number): Promise<void> {
    const files = new Set<string>();
    for (const state of Object.keys(this.sprites[String(sprite)]?.states ?? {}))
      this.collectState(files, sprite, Number(state));
    return this.pack.imagesFor([...files].map((file) => this.frameKey(file))).then(() => undefined);
  }

  private readonly preparing = new Map<string, Promise<void>>();
  private readonly mapLoads = new Map<number, Promise<void>>();

  /** Whether a room's map layers, collision and actor frames are loaded (`prepareRoom` done). */
  roomReady(scene: number, room: number): boolean {
    const asset = this.getWorldRoom(scene, room);
    return !!asset && this.maps.has(asset.mapId) && this.collisions.has(asset.mapId);
  }
  /**
   * Fetch what a room needs before the world can enter it: its map's layers and collision and the
   * frames of the actors standing in it. Safe to call again; the second call reuses the first.
   */
  prepareRoom(scene: number, room: number): Promise<void> {
    const key = this.rooms[`${scene}:${room}#world`]
      ? `${scene}:${room}#world`
      : `${scene}:${room}`;
    return this.prepareRoomKey(key);
  }
  private prepareRoomKey(key: string): Promise<void> {
    const cached = this.preparing.get(key);
    if (cached) return cached;
    const asset = this.rooms[key];
    if (!asset) return Promise.resolve();
    const loading = (async () => {
      await this.prepareMap(asset.mapId);
      const files = new Set<string>();
      for (const actor of asset.actors) {
        this.collectState(files, actor.sprite, actor.state);
        // A tree or rock (behaviour 7/6) falls through states 1 and 2 when it is cleared, under the
        // action marker (sprite 259 state 7) that offers the clear.
        if (actor.sourceKind === 0 && (actor.variant === 6 || actor.variant === 7)) {
          this.collectState(files, actor.sprite, 1);
          this.collectState(files, actor.sprite, 2);
          this.collectState(files, 259, 7);
        }
      }
      // A Cầu Vồng cue walks, turns and poses any actor, puts expressions over heads, effects and
      // portraits on screen: the room loads every state of its cast and those sprites with it.
      const cauVong = key.startsWith("98:");
      if (cauVong) {
        for (const sprite of [
          ...asset.actors.map((actor) => actor.sprite),
          ...CAU_VONG_CUE_SPRITES,
        ])
          for (const state of Object.keys(this.sprites[String(sprite)]?.states ?? {}))
            this.collectState(files, sprite, Number(state));
      }
      const keys = [...files].map((file) => this.frameKey(file));
      if (cauVong)
        for (let index = 0; index < CAU_VONG_PORTRAITS; index++)
          keys.push(`cau-vong-art.portraits/${index}.png`);
      await this.pack.imagesFor(keys);
    })();
    this.preparing.set(key, loading);
    return loading;
  }
  private prepareMap(id: number): Promise<void> {
    const cached = this.mapLoads.get(id);
    if (cached) return cached;
    const loading = (async () => {
      const meta = await this.pack.json<{ layers: number }>(
        this.pack.worldKey(`maps/${id}/meta.json`),
      );
      const [layers, collision] = await Promise.all([
        Promise.all(
          Array.from({ length: meta.layers }, (_, i) =>
            this.pack.image(this.pack.worldKey(`maps/${id}/layer-${i}.png`)),
          ),
        ),
        this.pack.json<MapCollision>(this.pack.worldKey(`maps/${id}/collision.json`)),
      ]);
      this.maps.set(id, layers);
      this.collisions.set(id, collision);
      // An APK landscape map is larger than the JAR room it replaces and starts at its origin: every
      // room on it takes the map's size and origin (the game keeps the JAR's coordinates).
      if (collision.originX !== undefined || collision.originY !== undefined)
        for (const room of Object.values(this.rooms))
          if (room.mapId === id) {
            room.jarWidth ??= room.width;
            room.jarHeight ??= room.height;
            room.width = collision.widthPixels;
            room.height = collision.heightPixels;
            room.originX = collision.originX ?? 0;
            room.originY = collision.originY ?? 0;
          }
    })();
    this.mapLoads.set(id, loading);
    return loading;
  }
  private collectState(files: Set<string>, sprite: number, state: number): void {
    for (const frame of this.sprites[String(sprite)]?.states[String(state)] ??
      this.sprites[String(sprite)]?.states["0"] ??
      []) {
      if (!isInk(frame)) continue;
      files.add(frame.file);
      files.add(frame.mirrorFile);
    }
  }
  /**
   * The room as the free world plays it. Two rooms (7:2 and 5:3) also have an opening variant that
   * owns the plain key; the world's own version is filed under "scene:room#world".
   */
  getWorldRoom(scene: number, room: number): RoomAsset | undefined {
    return this.rooms[`${scene}:${room}#world`] ?? this.rooms[`${scene}:${room}`];
  }
  /**
   * The room a cutscene stages. The opening's 5:1 is the cinematic `introRoom1` (filed as -1:-1),
   * not Hắc Thạch's world room of the same index.
   */
  getRoom(scene: number, room: number): RoomAsset | undefined {
    if (scene === -1 && room === -1) return undefined;
    if (scene === 5 && room === 1) return this.rooms["-1:-1"];
    return this.rooms[`${scene}:${room}`];
  }
  getCollision(mapId: number): MapCollision | undefined {
    return this.collisions.get(mapId);
  }
  /** The frame showing at `tick`, or undefined when that frame is blank (or the state is missing). */
  frame(sprite: number, state: number, tick: number): SpriteFrame | undefined {
    const stored = this.storedFrame(sprite, state, tick);
    return isInk(stored) ? stored : undefined;
  }
  /** True while the animation is on a blank frame: draw nothing, and do not fall back. */
  blankAt(sprite: number, state: number, tick: number): boolean {
    const stored = this.storedFrame(sprite, state, tick);
    return stored !== undefined && !isInk(stored);
  }
  private storedFrame(sprite: number, state: number, tick: number): StoredFrame | undefined {
    const states = this.sprites[String(sprite)]?.states;
    const frames = states?.[String(state)] ?? states?.["0"];
    if (!frames?.length) return;
    const total = frames.reduce((sum, f) => sum + Math.max(1, f.ticks), 0);
    let cursor = total ? tick % total : 0;
    for (const frame of frames) {
      if (cursor < frame.ticks) return frame;
      cursor -= frame.ticks;
    }
    return frames[0];
  }
  /**
   * The frame `elapsed` ticks into an animation played once and held on its last frame
   * (`SignatureSkillAnimationCatalog`'s stepping), or undefined when that frame is blank.
   */
  heldFrame(sprite: number, state: number, elapsed: number): SpriteFrame | undefined {
    const states = this.sprites[String(sprite)]?.states,
      frames = states?.[String(state)] ?? states?.["0"];
    if (!frames?.length) return;
    let index = 0,
      left = elapsed;
    while (index < frames.length - 1 && left >= frames[index].ticks) {
      left -= Math.max(1, frames[index].ticks);
      index++;
    }
    const stored = frames[index];
    return isInk(stored) ? stored : undefined;
  }
  frameAtCursor(sprite: number, state: number, cursor: number): SpriteFrame | undefined {
    const states = this.sprites[String(sprite)]?.states,
      frames = states?.[String(state)] ?? states?.["0"];
    const stored = frames?.[Math.max(0, Math.min(cursor, frames.length - 1))];
    return isInk(stored) ? stored : undefined;
  }
  /**
   * A pet's frame image as `SpriteAnimator.setPaletteNature(nature)` draws it (`visual` already
   * through `shinySprite`), or undefined until it has loaded.
   */
  petImage(
    frame: SpriteFrame,
    visual: number,
    nature: number | undefined,
    mirror = false,
    shinyColor?: number,
  ): HTMLImageElement | HTMLCanvasElement | undefined {
    const image = this.imageFor(frame, mirror);
    if (!image.complete || image.naturalWidth === 0) return undefined;
    return this.shinyImage(image, nature, visual, shinyColor);
  }
  /** `l-effect/<visual>.png`: the picture a state-1 L copies (`renderSpriteAnimationFrameImage`). */
  lEffectPicture(visual: number): HTMLImageElement {
    return this.pack.imageElement(`l-effect.${visual}.png`);
  }
  /** Kim Diễm Long Vương's HD presentation (`cau-vong-world.hd`). */
  cauVongHd?: CauVongHdDocument;
  /** `PetShinyPalette`: natures 7..9 recolour a pet's frames (`shiny/palette.json`). */
  shiny?: ShinyRecolorCache;
  /**
   * The sprite a pet of `visual` is drawn from: always its own, which `shinyImage` recolours. Java's
   * whole-frame bake of Hầu Vương (`shiny/n<nature>`) is never drawn (owner, 2026-11-15): Hầu Vương
   * takes the new colours like every pet, an old shiny one included.
   */
  shinySprite(visual: number, _nature?: number, _shinyColor?: number): number {
    return visual;
  }
  /** The frame a visual's colour regions are read from: state 0, its first drawn frame. */
  private shinyReference(visual: number): HTMLImageElement | undefined {
    const frame = this.sprites[String(visual)]?.states["0"]?.find((stored) => isInk(stored));
    return frame ? this.imageFor(frame) : undefined;
  }
  /** A pet frame image in its shiny palette when `nature` is 7..9 (not for a whole-frame bake). */
  shinyImage(
    image: HTMLImageElement,
    nature: number | undefined,
    visual: number,
    shinyColor?: number,
  ): HTMLImageElement | HTMLCanvasElement {
    if (!shinyApplies(nature) || !this.shiny || visual >= SHINY_BAKED_BASE) return image;
    return this.shiny.image(image, nature!, visual, shinyColor, this.shinyReference(visual));
  }
  private hdBySource?: Map<string, string>;
  /**
   * `MidpTransform.drawRegion` on the 720x960 room-49 surface: the 3x cut of a logical frame image
   * (only when it covers exactly the same box), or undefined.
   */
  hdTwin(image: HTMLImageElement): HTMLImageElement | undefined {
    const doc = this.cauVongHd;
    if (!doc) return;
    if (!this.hdBySource) {
      const index = new Map<string, string>(),
        absolute = (key: string) => new URL(this.pack.url(key), document.baseURI).href;
      for (const [id, sprite] of Object.entries(doc.sprites))
        for (const [state, frames] of Object.entries(sprite.frames))
          frames.forEach((hd, i) => {
            const own = this.sprites[id]?.states[state]?.[i];
            if (!hd || !own || !isInk(own)) return;
            if (own.ox === hd.ox && own.oy === hd.oy && own.w === hd.w && own.h === hd.h)
              index.set(absolute(this.frameKey(own.file)), `cau-vong-world.${hd.file}`);
            if (own.mox === hd.mox && own.moy === hd.moy && own.mw === hd.mw && own.mh === hd.mh)
              index.set(absolute(this.frameKey(own.mirrorFile)), `cau-vong-world.${hd.mirrorFile}`);
          });
      this.hdBySource = index;
    }
    const key = this.hdBySource.get(image.src);
    return key ? this.pack.imageElement(key) : undefined;
  }
  animationBounds(
    sprite: number,
    state: number,
  ): { x: number; y: number; width: number; height: number } | undefined {
    // Kim Diễm Long Vương's authored boxes (`CustomBossSpriteCatalog`); every other sprite's frames
    // are cut to their ink, so their union stands in for the authored box.
    const authored = this.cauVongHd?.sprites[String(sprite)]?.bounds;
    const box = authored?.[String(state)] ?? authored?.["0"];
    if (box) return { x: box[0], y: box[1], width: box[2], height: box[3] };
    const states = this.sprites[String(sprite)]?.states,
      frames = states?.[String(state)] ?? states?.["0"];
    if (!frames?.length) return;
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (const frame of frames) {
      if (!isInk(frame)) continue;
      left = Math.min(left, frame.ox);
      top = Math.min(top, frame.oy);
      right = Math.max(right, frame.ox + frame.w);
      bottom = Math.max(bottom, frame.oy + frame.h);
    }
    if (left === Infinity) return;
    return { x: left, y: top, width: right - left, height: bottom - top };
  }
  /** Whether the sprite has its own animation for `state` (no fallback to state 0). */
  hasState(sprite: number, state: number): boolean {
    return !!this.sprites[String(sprite)]?.states[String(state)]?.length;
  }
  animationTicks(sprite: number, state: number): number {
    return (
      this.sprites[String(sprite)]?.states[String(state)] ??
      this.sprites[String(sprite)]?.states["0"] ??
      []
    ).reduce((sum, frame) => sum + Math.max(1, frame.ticks), 0);
  }
  imageFor(frame: SpriteFrame, mirror = false): HTMLImageElement {
    return this.pack.imageElement(this.frameKey(mirror ? frame.mirrorFile : frame.file));
  }
  private async preloadRoomFrames(): Promise<void> {
    const files = new Set<string>(),
      addState = (sprite: number, state: number) => {
        for (const frame of this.sprites[String(sprite)]?.states[String(state)] ??
          this.sprites[String(sprite)]?.states["0"] ??
          []) {
          if (!isInk(frame)) continue;
          files.add(frame.file);
          files.add(frame.mirrorFile);
        }
      },
      addSprite = (sprite: number) => {
        for (const state of Object.keys(this.sprites[String(sprite)]?.states ?? {}))
          addState(sprite, Number(state));
      };
    for (const sprite of this.pack.introSpriteIds()) addState(sprite, 0);
    for (const skill of this.worldContract.player.skills ?? [])
      if (skill.animationSpriteId >= 0) addState(skill.animationSpriteId, skill.animationState);
    for (const definition of DEFAULT_BATTLE_DEFINITIONS) {
      for (const combatant of Object.values(definition.combatants)) addSprite(combatant.spriteId);
      for (const effect of definition.effects) addState(effect.spriteId, effect.state);
      addSprite(definition.entry.leftActorSpriteId);
      addSprite(definition.entry.rightActorSpriteId);
    }
    addState(294, 0);
    addState(294, 1);
    // The capture ball: each of its ~40 frames is its own picture, and a frame still loading on the
    // first throw would blink the ball out.
    addSprite(this.worldContract.capture?.spriteId ?? 269);
    for (const [sprite, state] of this.battleRules.signatureFx.spriteStates())
      addState(sprite, state);
    for (const [sprite, state] of this.battleRules.sourceFx.actorSpriteStates())
      addState(sprite, state);
    await this.pack.imagesFor([...files].map((file) => this.frameKey(file)));
  }
}
