import { CURRENT_SAVE_VERSION, SAVE_FORMAT, isGameSave, type GameSave } from "./GameSave";
import { defaultCampaignState } from "../../game/campaign/CampaignSystems";
import { defaultFashionEconomyState } from "../../game/fashion/FashionEconomy";

/**
 * Save schema migrations. Every older shape is upgraded one version at a time until it reaches
 * `CURRENT_SAVE_VERSION`, then validated. Migrations are pure functions over plain JSON so they
 * can be unit-tested with fixture files and never touch storage.
 *
 * To change the schema: add `MIGRATIONS[n] = (vN) => vN+1`, bump `CURRENT_SAVE_VERSION`, and add a
 * fixture for vN to `migrations.test.ts`.
 */
type Raw = Record<string, unknown>;
type Migration = (save: Raw) => Raw;

/** The resume owners of the Scene 1 tutorial (formerly `resumeMode`). */
export const SCENE1_STORY = "scene1";
export const SCENE1_RESUME = {
  bunnyCapture: "scene1.bunny-capture",
  bunnyReturnRoom0: "scene1.bunny-return-room0",
  elderReturn: "scene1.elder-return",
} as const;

const V23_RESUME: Readonly<Record<string, string>> = {
  BUNNY_OP13: SCENE1_RESUME.bunnyCapture,
  BUNNY_RETURN_TO_ROOM0: SCENE1_RESUME.bunnyReturnRoom0,
  ELDER_RETURN: SCENE1_RESUME.elderReturn,
};

const asRecord = (value: unknown): Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Raw) : {};

/**
 * v23 (the first web slice save) was shaped around the Scene 1 tutorial: `resumeMode`,
 * `quest.bunnyCaught/elderComplete`, flat `sceneId/roomIndex/player`. v24 moves those into the
 * chapter-neutral `location`, `resume`, `progress` and `story` sections.
 */
function v23ToV24(save: Raw): Raw {
  const player = asRecord(save.player),
    quest = asRecord(save.quest);
  const {
    schemaVersion: _v,
    sceneId,
    roomIndex,
    player: _p,
    resumeMode,
    quest: _q,
    ...rest
  } = save;
  return {
    ...rest,
    format: SAVE_FORMAT,
    version: 24,
    location: {
      sceneId,
      roomIndex,
      x: player.x,
      y: player.y,
      direction: player.direction,
    },
    resume: { owner: V23_RESUME[String(resumeMode)] ?? String(resumeMode) },
    // v23 read quest.* and fell back to the chapter's initial values, never to world.*.
    progress: {
      ...(quest.activeTask !== undefined ? { activeTask: quest.activeTask } : {}),
      ...(quest.mainTaskProgress !== undefined ? { mainTaskProgress: quest.mainTaskProgress } : {}),
    },
    story: {
      [SCENE1_STORY]: {
        bunnyCaught: quest.bunnyCaught === true,
        elderComplete: quest.elderComplete === true,
      },
    },
  };
}

/**
 * Some v24 builds persisted the high-level Scene 1 facts without the source event ledger that
 * produced them. On resume the collision dispatcher could therefore replay the opening Bunny hint
 * even after Bunny had been caught and Elder had been defeated. Repair only groups implied by
 * those durable facts; unrelated groups remain untouched.
 */
function v24ToV25(save: Raw): Raw {
  const story = asRecord(asRecord(save.story)[SCENE1_STORY]),
    states = { ...asRecord(save.eventStates) };
  if (story.bunnyCaught === true || story.elderComplete === true) {
    states["1:0:0"] = 3; // Scene 1 opening / east Bunny hint
    states["1:1:0"] = 3; // Bunny capture
  }
  if (story.elderComplete === true) {
    states["1:0:2"] = 3; // return Bunny to Elder
    states["1:0:3"] = 3; // starter choice
    states["1:0:6"] = 3; // Elder challenge
  }
  return { ...save, version: 25, eventStates: states };
}

/** v26 persists the JavaSE pet companion selection and both spendable currencies. */
function v25ToV26(save: Raw): Raw {
  return {
    ...save,
    version: 26,
    companionPetSlot: -1,
    currency: { money: 0, badges: 0 },
  };
}

/**
 * v27 persists the Đồ giám (`PetCollectionProgression`) and the play time (`PlayTimeProgression`). Like JavaSE's
 * `SaveSessionSnapshotMapper`, an older save starts with every pet it owns marked collected.
 */
function v26ToV27(save: Raw): Raw {
  const collection: number[] = new Array(276).fill(0),
    pets = Array.isArray(save.pets) ? save.pets : [];
  for (const pet of pets) {
    const species = (pet as { speciesId?: unknown })?.speciesId;
    if (typeof species === "number" && Number.isInteger(species) && species >= 0 && species < 276)
      collection[species] = 2;
  }
  return { ...save, version: 27, collection, playTimeMillis: 0 };
}

/** v28 persists the three remaining gamemenu meta systems. */
function v27ToV28(save: Raw): Raw {
  return {
    ...save,
    version: 28,
    meta: {
      fashion: { selected: "FASH-BASE-NEIL", owned: ["FASH-BASE-NEIL"] },
      redeemedGiftCodes: [],
      rematchLastWon: {},
      battlePass: {
        seasonKey: "vqsv-fan-card-s1",
        seasonStartEpochMillis: Math.max(0, Date.parse(String(save.savedAt)) || 0),
        xp: 0,
        vipUnlocked: false,
        claimedFree: [],
        claimedVip: [],
        missions: [0, 0, 0, 0, 0, 0],
        appliedEvents: [],
      },
    },
  };
}

/** v29 records the JavaSE three-per-day rematch counter, not only a last-win timestamp. */
function v28ToV29(save: Raw): Raw {
  const meta = asRecord(save.meta);
  const { rematchLastWon: _legacy, ...rest } = meta;
  return { ...save, version: 29, meta: { ...rest, rematches: {} } };
}

/** v30 persists the campaign foundation: bank, eggs, daily reward, rides, charms and world RNG. */
function v29ToV30(save: Raw): Raw {
  const meta = asRecord(save.meta),
    seed = Math.trunc(Math.max(0, Date.parse(String(save.savedAt)) || 0)) % 0x7fffffff;
  return {
    ...save,
    version: 30,
    meta: { ...meta, campaign: defaultCampaignState(seed) },
  };
}

/** v31 persists the remaining duration of Tị Quái Hoàn across save/load. */
function v30ToV31(save: Raw): Raw {
  return { ...save, version: 31, repelSteps: 0 };
}

/** v32 persists JavaSE's post-level-up skill decisions across autosave/load. */
function v31ToV32(save: Raw): Raw {
  return { ...save, version: 32, pendingSkillLearns: [] };
}

/** v33 persists blind bags, fragments and the isolated deterministic fashion draw cursor. */
function v32ToV33(save: Raw): Raw {
  const meta = asRecord(save.meta),
    fashion = asRecord(meta.fashion),
    millis = Math.max(0, Date.parse(String(save.savedAt)) || 0);
  return {
    ...save,
    version: 33,
    meta: {
      ...meta,
      fashion: { ...fashion, economy: defaultFashionEconomyState(BigInt(millis)) },
    },
  };
}

/**
 * v34: the web shiny redesign gives every new shiny one of the hand-made colours. A shiny already
 * owned (roster or bank, nature 7..9) keeps the look it had: it is marked with the legacy colour
 * (-1), Java's palette. Any colour a v33 save carries came from a build before the release, so a
 * shiny is marked whatever it holds.
 */
function v33ToV34(save: Raw): Raw {
  const legacy = (value: unknown) =>
    Array.isArray(value)
      ? value.map((pet) => {
          const raw = asRecord(pet),
            nature = typeof raw.nature === "number" ? raw.nature : 0;
          return nature >= 7 && nature <= 9 ? { ...raw, shinyColor: -1 } : pet;
        })
      : value;
  const meta = asRecord(save.meta),
    campaign = asRecord(meta.campaign);
  return {
    ...save,
    version: 34,
    pets: legacy(save.pets),
    ...(save.meta === undefined
      ? {}
      : {
          meta: {
            ...meta,
            ...(meta.campaign === undefined
              ? {}
              : { campaign: { ...campaign, petBank: legacy(campaign.petBank) } }),
          },
        }),
  };
}

const MIGRATIONS: Readonly<Record<number, Migration>> = {
  23: v23ToV24,
  24: v24ToV25,
  25: v25ToV26,
  26: v26ToV27,
  27: v27ToV28,
  28: v28ToV29,
  29: v29ToV30,
  30: v30ToV31,
  31: v31ToV32,
  32: v32ToV33,
  33: v33ToV34,
};

/** The schema version a stored value claims, or undefined when it is not a VQSV web save. */
export function saveVersionOf(value: unknown): number | undefined {
  const raw = asRecord(value);
  if (raw.format === SAVE_FORMAT && typeof raw.version === "number") return raw.version;
  if (typeof raw.schemaVersion === "number") return raw.schemaVersion; // v23 and earlier
  return undefined;
}

/**
 * Upgrade any supported stored value to the current schema. Returns undefined when the value is
 * not a save, is newer than this build understands, has no migration path, or fails validation.
 */
export function upgradeSave(value: unknown): GameSave | undefined {
  let version = saveVersionOf(value);
  if (version === undefined || version > CURRENT_SAVE_VERSION) return undefined;
  let raw = structuredClone(asRecord(value));
  while (version < CURRENT_SAVE_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) return undefined;
    raw = migrate(raw);
    version = saveVersionOf(raw);
    if (version === undefined) return undefined;
  }
  return isGameSave(raw) ? raw : undefined;
}
