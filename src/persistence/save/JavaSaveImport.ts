import { defaultCampaignState, type CampaignState } from "../../game/campaign/CampaignSystems";
import {
  CURRENT_SAVE_VERSION,
  SAVE_FORMAT,
  isGameSave,
  type GameSave,
  type SavedPet,
} from "./GameSave";
import { SCENE1_RESUME, SCENE1_STORY } from "./migrations";

/**
 * What the web game knows. The web data is the reference: anything a Java save holds that is not
 * in it (an item, a piece of gear, a pet, a skill, an outfit) is left out of the imported save.
 */
export type ImportCatalog = {
  species(id: number): boolean;
  skill(id: number): boolean;
  bagItem(id: number): boolean;
  equipment(id: number): boolean;
  material(id: number): boolean;
  special(id: number): boolean;
  fashion(key: string): boolean;
};

export type JavaSaveImport = {
  save: GameSave;
  /** One line per thing left out, for the console and the tests. */
  dropped: string[];
};

/** `SavePropertiesCodec.VERSION`: the newest Java save this importer reads. */
const NEWEST_JAVA_VERSION = 22;
const MAX_PET_LEVEL = 100;
const PARTY_SIZE = 6;
const CONVENIENCE_TIERS = 8;
const BASE_OUTFIT = "FASH-BASE-NEIL";

/** `java.util.Properties.load` for the files Java writes: `key=value` lines with `\` escapes. */
export function parseJavaProperties(text: string): Map<string, string> {
  const result = new Map<string, string>();
  const unescape = (value: string) =>
    value.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_match, code: string) => {
      if (code.length === 5) return String.fromCharCode(parseInt(code.slice(1), 16));
      return code === "n" ? "\n" : code === "t" ? "\t" : code === "r" ? "\r" : code;
    });
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimStart();
    if (!line || line[0] === "#" || line[0] === "!") continue;
    let at = -1;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === "\\") i++;
      else if (line[i] === "=" || line[i] === ":") {
        at = i;
        break;
      }
    }
    if (at < 0) continue;
    result.set(unescape(line.slice(0, at)), unescape(line.slice(at + 1)));
  }
  return result;
}

/**
 * The Java game's save (`SavePropertiesCodec`, schema 1..22) as a web save, or null when there is
 * nothing to continue from: a newer schema, or a player still inside the opening's linear events.
 */
export function importJavaSave(text: string, catalog: ImportCatalog): JavaSaveImport | null {
  const p = parseJavaProperties(text),
    dropped: string[] = [];
  const str = (key: string, fallback = "") => p.get(key)?.trim() ?? fallback;
  const int = (key: string, fallback = 0) => {
    const value = Number.parseInt(str(key), 10);
    return Number.isFinite(value) ? value : fallback;
  };
  const ints = (key: string): number[] =>
    str(key)
      .split(",")
      .filter((part) => part.trim() !== "")
      .map((part) => Number.parseInt(part, 10))
      .map((value) => (Number.isFinite(value) ? value : 0));
  const bool = (key: string) => {
    const value = str(key);
    return value === "1" || value === "true";
  };
  const rows = (prefix: string): string[] => {
    const out: string[] = [];
    for (let i = 0, count = int(`${prefix}.count`); i < count; i++) {
      const row = p.get(`${prefix}.${i}`);
      if (row !== undefined) out.push(row.trim());
    }
    return out;
  };
  // Gift codes keep their count under a key of their own (redeemedGiftCodeCount).
  const giftCodes = (): string[] =>
    Array.from({ length: int("redeemedGiftCodeCount") }, (_, i) => str(`redeemedGiftCode.${i}`));
  const intRows = (prefix: string) =>
    rows(prefix).map((row) => row.split(",").map((part) => Number.parseInt(part, 10)));

  const version = int("version", -1);
  if (version < 1 || version > NEWEST_JAVA_VERSION) return null;
  const mode = str("worldResumeMode", "LINEAR_EVENTS");
  if (mode === "LINEAR_EVENTS" || !p.has("scene")) return null;

  // Scene 1's chapter record: the bunny quest and the elder's return, as the world resumes them.
  const bunnyCaught = mode !== "BUNNY_OP13" && mode !== "BUNNY_QUEST_RETRY",
    elderComplete = mode === "POST_GROUP6_FREE_WORLD" || mode === "SCENE2_ROOM1_FREE_WORLD";

  const pet = (prefix: string, slot: number): SavedPet | null => {
    const core = ints(`${prefix}.core`);
    if (core.length < 5) return null;
    const [, speciesId, rawLevel] = core;
    if (!catalog.species(speciesId)) {
      dropped.push(`${prefix}: loài ${speciesId}`);
      return null;
    }
    const payload = ints(`${prefix}.payload`),
      at = (index: number, fallback: number) => payload[index] ?? fallback,
      level = Math.max(1, Math.min(MAX_PET_LEVEL, rawLevel));
    if (level !== rawLevel) dropped.push(`${prefix}: cấp ${rawLevel} → ${level}`);
    const skills = ints(`${prefix}.skills`),
      pp = ints(`${prefix}.cooldowns`),
      skillIds: number[] = [],
      skillPp: number[] = [];
    skills.forEach((skill, index) => {
      if (skill < 0) return;
      if (!catalog.skill(skill)) {
        dropped.push(`${prefix}: chiêu ${skill}`);
        return;
      }
      skillIds.push(skill);
      skillPp.push(Math.max(0, pp[index] ?? 0));
    });
    let held = at(2, -1);
    if (held >= 0 && !catalog.equipment(held)) {
      dropped.push(`${prefix}: đồ cầm ${held}`);
      held = -1;
    }
    const quality = at(4, core[3]) > 0 ? at(4, core[3]) : core[3],
      currentHp = at(6, -1),
      maxHp = int(`${prefix}.maxHpAtSave`, -1),
      result: SavedPet = {
        slot,
        speciesId,
        level,
        quality,
        nature: at(5, core[4]),
        experience: level >= MAX_PET_LEVEL ? 0 : Math.max(0, at(7, 0)),
        visualSpriteId: at(8, 0),
        skillIds,
        skillPp,
        physicalTraitId: int(`${prefix}.physicalTraitId`, -1),
        heldEquipmentId: held,
      };
    if (currentHp >= 0) result.currentHp = currentHp;
    if (maxHp > 0) result.maxHp = maxHp;
    // A shiny brought over from a Java save keeps Java's palette (`LEGACY_SHINY_COLOR`).
    if (result.nature !== undefined && result.nature >= 7 && result.nature <= 9)
      result.shinyColor = -1;
    return result;
  };
  const pets = (prefix: string): SavedPet[] => {
    const out: SavedPet[] = [];
    for (let i = 0, count = int(`${prefix}.count`); i < count; i++) {
      const loaded = pet(`${prefix}.${i}`, out.length);
      if (loaded) out.push(loaded);
    }
    return out;
  };

  const party = pets("pet"),
    bank = pets("bankPet");
  // A party over six (only a damaged save) keeps the first six; the rest wait in the bank.
  for (const extra of party.splice(PARTY_SIZE)) bank.push(extra);
  bank.forEach((entry, index) => (entry.slot = index));

  const items: Record<string, number> = {};
  for (const [id, count, , keepAtZero] of intRows("bag")) {
    if (!catalog.bagItem(id)) {
      dropped.push(`vật phẩm ${id} x${count}`);
      continue;
    }
    if (count > 0 || keepAtZero === 1) items[String(id)] = Math.max(0, count);
  }
  const equipment: number[] = [];
  for (const [id] of intRows("equipment")) {
    if (catalog.equipment(id)) equipment.push(id);
    else dropped.push(`trang bị ${id}`);
  }
  const materials: Record<string, number> = {};
  for (const [id, count] of intRows("material")) {
    if (catalog.material(id)) materials[String(id)] = Math.max(0, count);
    else dropped.push(`nguyên liệu ${id} x${count}`);
  }
  const specials: number[] = [];
  for (const [id, unlocked, stack] of intRows("special")) {
    if (!catalog.special(id)) {
      dropped.push(`vật phẩm đặc biệt ${id}`);
      continue;
    }
    if (unlocked === 1) for (let i = 0; i < Math.max(1, stack); i++) specials.push(id);
  }

  const owned = [BASE_OUTFIT];
  for (const key of rows("fashionOwned")) {
    if (key === BASE_OUTFIT || owned.includes(key)) continue;
    if (catalog.fashion(key)) owned.push(key);
    else dropped.push(`trang phục ${key}`);
  }
  const selected = str("fashionSelected", BASE_OUTFIT);

  const campaign: CampaignState = defaultCampaignState(0);
  campaign.petBank = bank;
  campaign.petBankExpansionPurchases = Math.max(0, Math.min(3, int("petBankExpansionPurchases")));
  campaign.egg = {
    active: bool("sourceEggActive"),
    activeEggItemId: int("sourceEggActiveItemId"),
    type: int("sourceEggType"),
    progress: int("sourceEggProgress"),
    drawIndex: Math.max(0, int("sourceEggDrawIndex")),
    ...(/^-?\d+$/.test(str("sourceEggDrawSeed")) ? { drawSeed: str("sourceEggDrawSeed") } : {}),
    ...(p.has("sourceEggKnownSpecies") ? { knownSpecies: ints("sourceEggKnownSpecies") } : {}),
  };
  campaign.dailyBadgeLastClaimEpochMillis = Math.max(0, int("dailyBadgeLastClaimEpochMillis"));
  const blocked = ints("sourceRideBlocked");
  campaign.ride = {
    activeIndex: int("sourceRideActiveIndex", -1),
    blocked: Array.from({ length: 9 }, (_, i) => (blocked[i] ? 1 : 0)),
  };
  const tiers: Record<string, number> = {};
  for (const [id, tier] of intRows("rainbowCharm")) if (tier >= 1 && tier <= 5) tiers[id] = tier;
  const active = ints("rainbowCharm.active");
  campaign.charms = {
    starterClaimed: bool("rainbowCharm.starterClaimed"),
    tiers,
    active: {
      SURVIVAL: active[0] ?? -1,
      TACTICAL: active[1] ?? -1,
      EXPLORATION: active[2] ?? -1,
    },
  };
  if (int("nguyenMocRaceAttemptCount") > 0 || bool("nguyenMocRacePetRewardClaimed"))
    campaign.race = {
      windowStart: Math.max(0, int("nguyenMocRaceWindowStartEpochMillis")),
      attempts: Math.max(0, int("nguyenMocRaceAttemptCount")),
      petClaimed: bool("nguyenMocRacePetRewardClaimed"),
    };
  // `CauVongIncubationState.encode`: "version;item,points;..." for the five slots.
  const incubation = str("cauVongIncubationState").split(";").slice(1, 6);
  if (incubation.length === 5)
    campaign.cauVongIncubation = {
      items: incubation.map((slot) => Number.parseInt(slot.split(",")[0], 10) || 0),
      progress: incubation.map((slot) =>
        Math.max(0, Math.min(200, Number.parseInt(slot.split(",")[1], 10) || 0)),
      ),
    };

  const player = ints("player"),
    eventStates: Record<string, number> = {};
  for (const row of rows("eventState")) {
    const at = row.lastIndexOf("=");
    if (at > 0) eventStates[row.slice(0, at)] = Number.parseInt(row.slice(at + 1), 10) || 0;
  }
  const mainTaskProgress = int("sourceMainTaskProgress");

  const save: GameSave = {
    format: SAVE_FORMAT,
    version: CURRENT_SAVE_VERSION,
    savedAt: new Date().toISOString(),
    location: {
      sceneId: int("scene"),
      roomIndex: int("room"),
      x: player[0] ?? 0,
      y: player[1] ?? 0,
      direction: player[2] ?? 0,
    },
    resume: {
      owner: elderComplete
        ? SCENE1_RESUME.elderReturn
        : bunnyCaught
          ? SCENE1_RESUME.bunnyReturnRoom0
          : SCENE1_RESUME.bunnyCapture,
    },
    progress: { mainTaskProgress },
    story: { [SCENE1_STORY]: { bunnyCaught, elderComplete } },
    world: {
      badgesAchieved: ints("sourceBadgeAchieved"),
      badgesEnhanced: ints("sourceBadgeEnhanced"),
      sourceWorldFlags: rows("sourceWorldFlag")
        .map((row) => Number.parseInt(row, 10))
        .filter((flag) => Number.isInteger(flag) && flag >= 0),
      openedChests: rows("sourceOpenedChest").filter((key) => key !== ""),
      actorPositions: intRows("sourceActorPosition").filter(
        (row) => row.length >= 5 && row.slice(0, 5).every(Number.isInteger),
      ),
      gameCf: bool("sourceGameCF"),
      mainTaskProgress,
      activeTask: "",
    },
    eventStates,
    inventory: { items, equipment, materials, specials },
    companionPetSlot: -1,
    currency: { money: Math.max(0, int("sourceMoney")), badges: Math.max(0, int("sourceBadges")) },
    collection: ints("sourcePetCollection").map((state) => Math.max(0, Math.min(2, state))),
    playTimeMillis: Math.max(0, int("sourcePlayTimeMillis")),
    repelSteps: Math.max(-1, int("sourceAvoidMonsterTicks")),
    pendingSkillLearns: [],
    evolutionNoticeArmed: bool("sourceEvolutionNoticeArmed"),
    // Java keeps one more tier flag than the web game has milestones (7).
    convenienceRewardsClaimed: ints("sourceConvenienceRewardsClaimed")
      .slice(0, CONVENIENCE_TIERS)
      .map((v) => v !== 0),
    meta: {
      fashion: {
        selected: owned.includes(selected) ? selected : BASE_OUTFIT,
        owned,
        economy: {
          profileVersion: str("fashionEconomyProfileVersion"),
          poolVersion: str("fashionPoolVersion"),
          blindBagCount: Math.max(0, int("fashionBlindBagCount")),
          fragmentCount: Math.max(0, int("fashionFragmentCount")),
          drawSeed: /^-?\d+$/.test(str("fashionDrawSeed")) ? str("fashionDrawSeed") : "0",
          drawIndex: Math.max(0, int("fashionDrawIndex")),
        },
      },
      redeemedGiftCodes: [...new Set(giftCodes().filter(Boolean))].sort(),
      rematches: {},
      battlePass: battlePass(str("battlePassState")),
      campaign,
    },
    pets: party,
  };
  // The repository refuses an invalid save; say so here rather than lose the player's progress.
  if (!isGameSave(save)) throw new Error("Java save converted to an invalid web save");
  return { save, dropped };
}

/** `BattlePassState.decode`: "season|xp|vip|freeMask|vipMask|events|missions|start". */
function battlePass(encoded: string): NonNullable<GameSave["meta"]>["battlePass"] {
  const parts = encoded.split("|"),
    levels = (mask: string): number[] => {
      let bits: bigint;
      try {
        bits = BigInt(mask || "0");
      } catch {
        return [];
      }
      const out: number[] = [];
      for (let level = 1; bits > 0n; level++, bits >>= 1n) if (bits & 1n) out.push(level);
      return out;
    },
    missions = (parts[6] ?? "").split(",").map((v) => Math.max(0, Number.parseInt(v, 10) || 0));
  return {
    seasonKey: parts[0] || "vqsv-fan-card-s1",
    seasonStartEpochMillis: Math.max(0, Number.parseInt(parts[7] ?? "", 10) || Date.now()),
    xp: Math.max(0, Number.parseInt(parts[1] ?? "", 10) || 0),
    vipUnlocked: parts[2] === "true",
    claimedFree: levels(parts[3] ?? "0"),
    claimedVip: levels(parts[4] ?? "0"),
    missions: Array.from({ length: 6 }, (_, i) => missions[i] ?? 0),
    appliedEvents: (parts[5] ?? "").split(",").filter(Boolean),
  };
}
