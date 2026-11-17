import type { EventStateSnapshot } from "../../game/world/EventStateLedger";
import type { WorldFlagsSnapshot } from "../../game/world/WorldFlags";
import type { CampaignState } from "../../game/campaign/CampaignSystems";
import type { TowerState } from "../../game/meta/BondingTower";
import type { SafariRun } from "../../game/meta/Safari";

/** Bump together with a new entry in `migrations.ts`. */
export const CURRENT_SAVE_VERSION = 34;
export const SAVE_FORMAT = "vqsv-web-save";

export type SavedPet = {
  slot?: number;
  speciesId: number;
  level: number;
  quality: number;
  nature?: number;
  currentHp?: number;
  maxHp?: number;
  experience?: number;
  visualSpriteId?: number;
  /** Tháp Gắn Kết cultivation follows the individual pet through transfers and evolution. */
  towerBond?: number;
  skillIds?: number[];
  skillPp?: number[];
  /**
   * `PetState.physicalTraitId`: the talent rolled onto this pet, or -1 for none. Optional because
   * Java's default for a pet never given one is -1; `BattleRuntime.createUnit` reads it.
   */
  physicalTraitId?: number;
  /**
   * `PetState.heldEquipmentId`: the item this pet carries into battle, or -1 for none. Optional
   * because Java's default is -1; `WorldRuntime.normalizePet` applies it on load.
   */
  heldEquipmentId?: number;
  /**
   * Web only: the shiny colour this pet wears (an index into `ShinyDesigns.SHINY_THEMES`), drawn
   * at random the first time it has a shiny nature (7..9) and kept for good after that. -1
   * (`LEGACY_SHINY_COLOR`) is a shiny that was already owned before the redesign: it keeps Java's
   * palette.
   */
  shinyColor?: number;
  /** Web only: the pet's own id in the money and pet log (`EconomyLedger`), given on first sight. */
  uid?: string;
};

/** A level-up skill decision that must be completed before the finished battle resumes the world. */
export type PendingSkillLearn = { petSlot: number; skillId: number };

/** Primitive per-chapter state; a chapter owns its keys, the save only stores them. */
export type StoryRecord = Record<string, boolean | number | string>;

/**
 * The web save, independent of any single chapter. Chapter-specific facts (for example the
 * Scene 1 tutorial's capture and elder flags) live under `story[<chapter>]`, and the runtime that
 * must resume is named by `resume.owner`, so new chapters never change this shape.
 */
export type GameSave = {
  format: typeof SAVE_FORMAT;
  version: typeof CURRENT_SAVE_VERSION;
  savedAt: string;
  location: {
    sceneId: number;
    roomIndex: number;
    x: number;
    y: number;
    direction: number;
    /** Web only: an admin moved the hero here (server/live.mjs); x/y -1 means "at a door". */
    adminPlaced?: boolean;
  };
  /** Which runtime resumes the session, e.g. "scene1.bunny-capture". */
  resume: { owner: string };
  /** Quest progress; an absent field means "the chapter's initial value". */
  progress: { activeTask?: string; mainTaskProgress?: number };
  story: Record<string, StoryRecord>;
  world?: WorldFlagsSnapshot;
  eventStates?: EventStateSnapshot;
  /**
   * The bag. `items` are the consumables (db.mid group 4). The other lists are the original's M
   * (equipment ids), N (materials by id) and O (special item ids); absent means empty, so saves
   * written before the bag existed stay valid.
   */
  inventory: {
    items: Record<string, number>;
    equipment?: number[];
    materials?: Record<string, number>;
    specials?: number[];
  };
  /** JavaSE `session.pets.companionPetSlot`; -1 means no world companion. */
  companionPetSlot?: number;
  /** JavaSE inventory currency, used by skill relearn and shops. */
  currency?: { money: number; badges: number };
  /**
   * JavaSE `progression.collection.snapshot()`: the Đồ giám state, 0 unseen, 1 seen, 2 collected —
   * species 0..280, then a 512-entry block per shiny nature 7..9 (ProMax) and per shiny colour
   * 0..12 (web). An older, shorter array reads its missing entries as unseen.
   */
  collection?: number[];
  /** JavaSE `progression.playTime`: accumulated play time in milliseconds. */
  playTimeMillis?: number;
  /** JavaSE `progression.avoidMonsterTicks`; -1 means the last effect has expired. */
  repelSteps: number;
  /** JavaSE `sourceSkillLearnQueue`: unresolved level-up skills, in battle party/order. */
  pendingSkillLearns: PendingSkillLearn[];
  /** Web only: the money and pet log since the game loaded (`EconomyLedger`; the server reads it). */
  ledger?: import("../../game/economy/EconomyLedger").LedgerSnapshot;
  /**
   * JavaSE `progression.evolutionNoticeArmed` (the evolution tutorial has run, which opens the
   * convenience shop's evolve rows) and `collection.convenienceRewardsSnapshot()` (the eight
   * "Dẫn thưởng" milestones claimed: six badges, then Hoàng Kim Chương's two ranks). Absent in older saves: false and none claimed.
   */
  evolutionNoticeArmed?: boolean;
  convenienceRewardsClaimed?: boolean[];
  /** JavaSE WardrobeState, GiftCodeService, RegionalRematchState and BattlePassState. */
  meta?: {
    fashion: {
      selected: string;
      owned: string[];
      economy: {
        profileVersion: string;
        poolVersion: string;
        blindBagCount: number;
        fragmentCount: number;
        drawSeed: string;
        drawIndex: number;
      };
    };
    redeemedGiftCodes: string[];
    rematches: Record<string, { dayKey: number; usedCount: number }>;
    battlePass: {
      seasonKey: string;
      seasonStartEpochMillis: number;
      xp: number;
      vipUnlocked: boolean;
      claimedFree: number[];
      claimedVip: number[];
      missions: number[];
      appliedEvents: string[];
    };
    campaign: CampaignState;
    tower?: TowerState;
    safari?: SafariRun;
    /** The day key (`rematchDayKey`, UTC+7) of the last Safari entry: one entry a day. */
    safariDay?: number;
  };
  pets: SavedPet[];
};

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const integer = (value: unknown): value is number => finite(value) && Number.isInteger(value);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const optional = (value: unknown, check: (value: unknown) => boolean): boolean =>
  value === undefined || check(value);
const numberArray = (value: unknown): boolean =>
  Array.isArray(value) && value.every((item) => finite(item));

function isSavedPet(pet: unknown): pet is SavedPet {
  return (
    record(pet) &&
    integer(pet.speciesId) &&
    integer(pet.level) &&
    integer(pet.quality) &&
    optional(pet.slot, integer) &&
    optional(pet.nature, integer) &&
    optional(pet.currentHp, finite) &&
    optional(pet.maxHp, finite) &&
    optional(pet.experience, finite) &&
    optional(pet.visualSpriteId, integer) &&
    optional(pet.towerBond, (v) => integer(v) && v >= 0 && v <= 255) &&
    optional(pet.skillIds, numberArray) &&
    optional(pet.skillPp, numberArray) &&
    optional(pet.physicalTraitId, (v) => integer(v) && v >= -1) &&
    // A present id is a catalog index or Java's own -1; anything else would hand a unit an item
    // that never existed.
    optional(pet.heldEquipmentId, (v) => integer(v) && v >= -1) &&
    optional(pet.shinyColor, (v) => integer(v) && v >= -1)
  );
}

function isWorldFlags(value: unknown): value is WorldFlagsSnapshot {
  return (
    record(value) &&
    Array.isArray(value.badgesAchieved) &&
    Array.isArray(value.badgesEnhanced) &&
    optional(
      value.sourceFeatures,
      (states) =>
        Array.isArray(states) &&
        states.length <= 7 &&
        states.every((state) => state === 0 || state === 3),
    ) &&
    optional(
      value.openedChests,
      (keys) => Array.isArray(keys) && keys.every((key) => typeof key === "string"),
    ) &&
    optional(
      value.actorPositions,
      (rows) =>
        Array.isArray(rows) &&
        rows.every((row) => Array.isArray(row) && row.length === 5 && row.every(Number.isInteger)),
    ) &&
    typeof value.gameCf === "boolean" &&
    finite(value.mainTaskProgress) &&
    typeof value.activeTask === "string"
  );
}

function isStory(value: unknown): value is Record<string, StoryRecord> {
  return (
    record(value) &&
    Object.values(value).every(
      (chapter) =>
        record(chapter) &&
        Object.values(chapter).every(
          (v) => typeof v === "boolean" || typeof v === "string" || finite(v),
        ),
    )
  );
}

function isTower(value: unknown): boolean {
  const within = (v: unknown, min: number, max: number) => integer(v) && v >= min && v <= max;
  return (
    record(value) &&
    within(value.highest, 0, 200) &&
    within(value.hearts, 0, Number.MAX_SAFE_INTEGER) &&
    within(value.fragments, 0, Number.MAX_SAFE_INTEGER) &&
    within(value.day, 0, 10_000_000) &&
    within(value.repeats, 0, 30) &&
    within(value.sweeps, 0, 6) &&
    Array.isArray(value.claims) &&
    value.claims.length <= 200 &&
    new Set(value.claims).size === value.claims.length &&
    value.claims.every((floor) => within(floor, 1, Number(value.highest))) &&
    optional(
      value.last,
      (last) =>
        record(last) &&
        within(last.floor, 1, 200) &&
        typeof last.won === "boolean" &&
        within(last.hearts, 0, 5) &&
        within(last.fragments, 0, 10) &&
        optional(last.sweep, (sweep) => typeof sweep === "boolean"),
    )
  );
}

function isSafari(value: unknown): boolean {
  if (!record(value)) return false;
  const encounter = value.encounter;
  return (
    integer(value.balls) &&
    value.balls >= 1 &&
    value.balls <= 30 &&
    integer(value.x) &&
    value.x >= 0 &&
    value.x < 960 &&
    integer(value.y) &&
    value.y >= 0 &&
    value.y < 768 &&
    integer(value.direction) &&
    value.direction >= 0 &&
    value.direction <= 3 &&
    integer(value.steps) &&
    value.steps >= 1 &&
    value.steps <= 22 &&
    integer(value.seed) &&
    value.seed >= 0 &&
    value.seed <= 0xffffffff &&
    (encounter === null ||
      (record(encounter) &&
        isSavedPet(encounter.pet) &&
        [29, 46, 30, 54, 86, 5, 74, 45, 273, 272, 271, 270, 269].includes(
          encounter.pet.speciesId,
        ) &&
        ["neutral", "bait", "rock"].includes(String(encounter.effect)) &&
        integer(encounter.turns) &&
        encounter.turns >= 0 &&
        encounter.turns <= 255 &&
        (encounter.effect === "neutral") === (encounter.turns === 0)))
  );
}

function isMeta(value: unknown): boolean {
  if (
    !record(value) ||
    !record(value.fashion) ||
    !record(value.battlePass) ||
    !record(value.campaign)
  )
    return false;
  const fashion = value.fashion,
    pass = value.battlePass,
    campaign = value.campaign,
    charms = record(campaign.charms) ? campaign.charms : {},
    charmActive = record(charms.active) ? charms.active : {};
  return (
    optional(value.tower, isTower) &&
    optional(value.safari, isSafari) &&
    optional(value.safariDay, integer) &&
    typeof fashion.selected === "string" &&
    Array.isArray(fashion.owned) &&
    fashion.owned.every((key) => typeof key === "string") &&
    record(fashion.economy) &&
    typeof fashion.economy.profileVersion === "string" &&
    typeof fashion.economy.poolVersion === "string" &&
    integer(fashion.economy.blindBagCount) &&
    fashion.economy.blindBagCount >= 0 &&
    fashion.economy.blindBagCount <= 99 &&
    integer(fashion.economy.fragmentCount) &&
    fashion.economy.fragmentCount >= 0 &&
    fashion.economy.fragmentCount <= 999999 &&
    /^-?\d+$/.test(String(fashion.economy.drawSeed)) &&
    integer(fashion.economy.drawIndex) &&
    fashion.economy.drawIndex >= 0 &&
    Array.isArray(value.redeemedGiftCodes) &&
    value.redeemedGiftCodes.every((code) => typeof code === "string") &&
    record(value.rematches) &&
    Object.values(value.rematches).every(
      (usage) =>
        record(usage) &&
        integer(usage.dayKey) &&
        usage.dayKey >= -1 &&
        integer(usage.usedCount) &&
        usage.usedCount >= 0 &&
        usage.usedCount <= 3,
    ) &&
    typeof pass.seasonKey === "string" &&
    integer(pass.seasonStartEpochMillis) &&
    pass.seasonStartEpochMillis >= 0 &&
    integer(pass.xp) &&
    pass.xp >= 0 &&
    typeof pass.vipUnlocked === "boolean" &&
    [pass.claimedFree, pass.claimedVip, pass.missions].every(numberArray) &&
    Array.isArray(pass.appliedEvents) &&
    pass.appliedEvents.every((id) => typeof id === "string") &&
    Array.isArray(campaign.petBank) &&
    campaign.petBank.every(isSavedPet) &&
    integer(campaign.petBankExpansionPurchases) &&
    campaign.petBankExpansionPurchases >= 0 &&
    campaign.petBankExpansionPurchases <= 3 &&
    record(campaign.egg) &&
    typeof campaign.egg.active === "boolean" &&
    integer(campaign.egg.activeEggItemId) &&
    integer(campaign.egg.type) &&
    integer(campaign.egg.progress) &&
    integer(campaign.egg.drawIndex) &&
    (campaign.egg.drawSeed === undefined || /^-?\d+$/.test(String(campaign.egg.drawSeed))) &&
    (campaign.egg.knownSpecies === undefined || numberArray(campaign.egg.knownSpecies)) &&
    // `cauVongIncubation`: the five Cầu Vồng slots; their contents are checked on restore.
    (campaign.cauVongIncubation === undefined ||
      (record(campaign.cauVongIncubation) &&
        numberArray(campaign.cauVongIncubation.items) &&
        numberArray(campaign.cauVongIncubation.progress))) &&
    // `cauVongMinigame`: the open summon-room board and the streak; checked on restore.
    (campaign.cauVongMinigame === undefined || record(campaign.cauVongMinigame)) &&
    integer(campaign.dailyBadgeLastClaimEpochMillis) &&
    record(campaign.ride) &&
    integer(campaign.ride.activeIndex) &&
    numberArray(campaign.ride.blocked) &&
    record(campaign.charms) &&
    typeof charms.starterClaimed === "boolean" &&
    record(charms.tiers) &&
    Object.values(charms.tiers).every(integer) &&
    record(charms.active) &&
    ["SURVIVAL", "TACTICAL", "EXPLORATION"].every((slot) => integer(charmActive[slot])) &&
    record(campaign.worldRandom) &&
    integer(campaign.worldRandom.seed) &&
    integer(campaign.worldRandom.draws)
  );
}

/** Structural validation of the current schema. Anything older goes through `upgradeSave`. */
export function isGameSave(value: unknown): value is GameSave {
  if (!record(value)) return false;
  const { location, resume, progress, inventory, pets } = value;
  return (
    value.format === SAVE_FORMAT &&
    value.version === CURRENT_SAVE_VERSION &&
    typeof value.savedAt === "string" &&
    record(location) &&
    integer(location.sceneId) &&
    integer(location.roomIndex) &&
    finite(location.x) &&
    finite(location.y) &&
    integer(location.direction) &&
    record(resume) &&
    typeof resume.owner === "string" &&
    resume.owner.length > 0 &&
    record(progress) &&
    optional(progress.activeTask, (v) => typeof v === "string") &&
    optional(progress.mainTaskProgress, finite) &&
    isStory(value.story) &&
    optional(value.world, isWorldFlags) &&
    // Only the states the ledger can write restore; anything else would fabricate progress.
    optional(
      value.eventStates,
      (states) =>
        record(states) && Object.values(states).every((state) => state === 3 || state === 4),
    ) &&
    record(inventory) &&
    record(inventory.items) &&
    Object.values(inventory.items).every((count) => integer(count) && count >= 0) &&
    optional(
      inventory.equipment,
      (ids) => Array.isArray(ids) && ids.every((id) => integer(id) && id >= 0),
    ) &&
    optional(
      inventory.materials,
      (counts) =>
        record(counts) && Object.values(counts).every((count) => integer(count) && count >= 0),
    ) &&
    optional(
      inventory.specials,
      (ids) => Array.isArray(ids) && ids.every((id) => integer(id) && id >= 0),
    ) &&
    optional(value.companionPetSlot, (v) => integer(v) && v >= -1) &&
    // `CurrencyEngine.adjustRaw` (op31) may leave a balance below zero, so only integers are required.
    optional(value.currency, (v) => record(v) && integer(v.money) && integer(v.badges)) &&
    optional(value.playTimeMillis, (v) => integer(v) && v >= 0) &&
    integer(value.repelSteps) &&
    value.repelSteps >= -1 &&
    Array.isArray(value.pendingSkillLearns) &&
    value.pendingSkillLearns.every(
      (entry) =>
        record(entry) &&
        integer(entry.petSlot) &&
        entry.petSlot >= 0 &&
        integer(entry.skillId) &&
        entry.skillId >= 0,
    ) &&
    optional(value.evolutionNoticeArmed, (v) => typeof v === "boolean") &&
    optional(
      value.convenienceRewardsClaimed,
      (v) =>
        Array.isArray(v) && v.length <= 8 && v.every((claimed) => typeof claimed === "boolean"),
    ) &&
    optional(
      value.collection,
      (states) =>
        Array.isArray(states) && states.every((state) => state === 0 || state === 1 || state === 2),
    ) &&
    optional(value.meta, isMeta) &&
    Array.isArray(pets) &&
    pets.length > 0 &&
    pets.every(isSavedPet)
  );
}
