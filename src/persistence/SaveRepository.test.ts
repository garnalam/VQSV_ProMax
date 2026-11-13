import { defaultCampaignState } from "../game/campaign/CampaignSystems";
import { describe, expect, it } from "vitest";
import { SaveRepository, isGameSave, type GameSave } from "./SaveRepository";
import { upgradeSave, saveVersionOf } from "./save/migrations";
import { MemorySaveStore, type SaveStore } from "./save/SaveStore";

/** A v23 save exactly as the first web slice wrote it. */
const V23 = {
  schemaVersion: 23,
  savedAt: "2026-01-01T00:00:00.000Z",
  sceneId: 1,
  roomIndex: 1,
  player: { x: 55, y: 279, direction: 2 },
  resumeMode: "BUNNY_OP13",
  quest: {
    bunnyCaught: false,
    elderComplete: false,
    activeTask: "BUNNY_CAPTURE",
    mainTaskProgress: 1,
  },
  world: {
    badgesAchieved: [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    badgesEnhanced: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    gameCf: false,
    mainTaskProgress: 1,
    activeTask: "BUNNY_CAPTURE",
  },
  eventStates: { "1:1:0": 3, "1:0:1": 3 },
  inventory: { items: { "0": 1, "1": 2, "4": 5 } },
  pets: [
    {
      slot: 0,
      speciesId: 68,
      level: 7,
      quality: 2,
      nature: 2,
      currentHp: 179,
      maxHp: 179,
      visualSpriteId: 154,
      skillIds: [40, 45],
      skillPp: [30, 4],
    },
  ],
};

const current = (): GameSave => upgradeSave(V23)!;

describe("save migrations", () => {
  it("upgrades the v23 slice save into the current chapter-neutral shape", () => {
    const save = upgradeSave(V23);
    expect(save).toEqual({
      format: "vqsv-web-save",
      version: 33,
      savedAt: V23.savedAt,
      location: { sceneId: 1, roomIndex: 1, x: 55, y: 279, direction: 2 },
      resume: { owner: "scene1.bunny-capture" },
      progress: { activeTask: "BUNNY_CAPTURE", mainTaskProgress: 1 },
      story: { scene1: { bunnyCaught: false, elderComplete: false } },
      world: V23.world,
      eventStates: V23.eventStates,
      inventory: V23.inventory,
      companionPetSlot: -1,
      currency: { money: 0, badges: 0 },
      // v27: the Đồ giám starts with every owned pet collected, as `SaveSessionSnapshotMapper`.
      collection: Array.from({ length: 276 }, (_, id) => (id === 68 ? 2 : 0)),
      playTimeMillis: 0,
      // v31: no repel was active in older Web saves.
      repelSteps: 0,
      // v32: no unresolved level-up skill existed in older Web saves.
      pendingSkillLearns: [],
      meta: {
        fashion: {
          selected: "FASH-BASE-NEIL",
          owned: ["FASH-BASE-NEIL"],
          economy: {
            profileVersion: "unified-fashion-economy-v1",
            poolVersion: "FASH-POOL-SOURCE-V1",
            blindBagCount: 0,
            fragmentCount: 0,
            drawSeed: String(Date.parse(V23.savedAt)),
            drawIndex: 0,
          },
        },
        redeemedGiftCodes: [],
        rematches: {},
        battlePass: {
          seasonKey: "vqsv-fan-card-s1",
          seasonStartEpochMillis: Date.parse(V23.savedAt),
          xp: 0,
          vipUnlocked: false,
          claimedFree: [],
          claimedVip: [],
          missions: [0, 0, 0, 0, 0, 0],
          appliedEvents: [],
        },
        // v30: the campaign foundation, its world RNG seeded from the save time.
        campaign: defaultCampaignState(Date.parse(V23.savedAt) % 0x7fffffff),
      },
      pets: V23.pets,
    });
    expect(isGameSave(save)).toBe(true);
  });
  it("keeps a negative op31 balance and refuses a collection state outside 0..2", () => {
    expect(isGameSave({ ...current(), currency: { money: -5, badges: 0 } })).toBe(true);
    expect(isGameSave({ ...current(), collection: [0, 3] })).toBe(false);
  });
  it("maps every v23 resume mode", () => {
    for (const [mode, owner] of [
      ["BUNNY_OP13", "scene1.bunny-capture"],
      ["BUNNY_RETURN_TO_ROOM0", "scene1.bunny-return-room0"],
      ["ELDER_RETURN", "scene1.elder-return"],
    ])
      expect(upgradeSave({ ...V23, resumeMode: mode })?.resume.owner).toBe(owner);
  });
  it("keeps an absent v23 quest task absent so the chapter default applies", () => {
    const save = upgradeSave({ ...V23, quest: { bunnyCaught: true, elderComplete: false } });
    expect(save?.progress).toEqual({});
    expect(save?.story.scene1).toEqual({ bunnyCaught: true, elderComplete: false });
  });
  it("repairs the Scene 1 ledger implied by Bunny and Elder completion", () => {
    const v24 = {
      ...current(),
      version: 24,
      story: { scene1: { bunnyCaught: true, elderComplete: true } },
      eventStates: { "1:0:1": 3 },
    };
    expect(upgradeSave(v24)?.eventStates).toEqual({
      "1:0:0": 3,
      "1:0:1": 3,
      "1:1:0": 3,
      "1:0:2": 3,
      "1:0:3": 3,
      "1:0:6": 3,
    });
  });
  it("does not touch the stored object", () => {
    const stored = structuredClone(V23);
    upgradeSave(stored);
    expect(stored).toEqual(V23);
  });
  it("rejects unknown, future and corrupt records", () => {
    expect(saveVersionOf({})).toBeUndefined();
    expect(upgradeSave({ schemaVersion: 22 })).toBeUndefined();
    expect(upgradeSave({ ...current(), version: 99 })).toBeUndefined();
    expect(upgradeSave({ ...V23, pets: [] })).toBeUndefined();
    expect(upgradeSave({ ...V23, player: null })).toBeUndefined();
    expect(upgradeSave({ ...V23, eventStates: { "1:1:0": 7 } })).toBeUndefined();
    expect(upgradeSave({ ...V23, world: { ...V23.world, badgesAchieved: null } })).toBeUndefined();
  });
});

describe("GameSave validation", () => {
  it("rejects a held item that is neither a catalog index nor -1", () => {
    const save = current();
    expect(isGameSave({ ...save, pets: [{ ...save.pets[0], heldEquipmentId: -2 }] })).toBe(false);
    expect(isGameSave({ ...save, pets: [{ ...save.pets[0], heldEquipmentId: -1 }] })).toBe(true);
  });
  it("requires a resume owner and a location", () => {
    const save = current();
    expect(isGameSave({ ...save, resume: { owner: "" } })).toBe(false);
    expect(isGameSave({ ...save, location: undefined })).toBe(false);
  });
});

describe("SaveRepository", () => {
  it("round-trips the current schema", async () => {
    const repo = new SaveRepository(new MemorySaveStore());
    expect(await repo.hasAnySave()).toBe(false);
    await repo.save(current());
    expect(await repo.load()).toEqual(current());
    expect(await repo.hasValidSave()).toBe(true);
  });
  it("loads a v23 save left by an earlier build", async () => {
    const store = new MemorySaveStore();
    await store.putAll([["active", V23]]);
    expect(await new SaveRepository(store).load()).toEqual(current());
  });
  it("rotates the previous save into the backup and falls back to it", async () => {
    const store = new MemorySaveStore(),
      repo = new SaveRepository(store),
      first = current(),
      second = { ...current(), savedAt: "2026-02-02T00:00:00.000Z" };
    await repo.save(first);
    await repo.save(second);
    expect(await store.get("backup")).toEqual(first);
    await store.putAll([["active", { corrupt: true }]]);
    expect(await repo.load()).toEqual(first);
    expect(await repo.hasAnySave()).toBe(true);
  });
  it("refuses to write an invalid snapshot", async () => {
    const repo = new SaveRepository(new MemorySaveStore());
    await expect(repo.save({ ...current(), pets: [] })).rejects.toThrow("Invalid");
  });
  it("fails the save when the read-back differs", async () => {
    const inner = new MemorySaveStore(),
      lossy: SaveStore = {
        get: async (key) => {
          const value = (await inner.get(key)) as GameSave | undefined;
          return value && { ...value, inventory: { items: {} } };
        },
        putAll: (entries) => inner.putAll(entries),
        clear: () => inner.clear(),
      };
    await expect(new SaveRepository(lossy).save(current())).rejects.toThrow("read-back");
  });
  it("deleteAll clears both slots", async () => {
    const repo = new SaveRepository(new MemorySaveStore());
    await repo.save(current());
    await repo.save(current());
    await repo.deleteAll();
    expect(await repo.hasAnySave()).toBe(false);
  });
});
