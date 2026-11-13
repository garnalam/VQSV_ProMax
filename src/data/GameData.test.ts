import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Pack } from "../pack/Pack";
import { GameData, speciesPetKey } from "./GameData";

const root = resolve(import.meta.dirname, "..", "..");

vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(root, "public", decodeURIComponent(input.replace(/^\//, "")));
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(readFileSync(file, "utf8")),
  };
});

async function newData(): Promise<GameData> {
  return new GameData(await Pack.load());
}

describe("pack data catalogs", () => {
  it("loads every row the Java catalog counts declare", async () => {
    const data = await newData();
    const species = await data.species();
    expect(species.schema).toBe("vqsv-webnative-battle-species-v1");
    expect(species.rows.length).toBe(281);
    expect(species.speciesCount).toBe(species.rows.length);
    // 66 is the Java catalog: 33 Cầu Vồng records plus the 33 V4 rows that clone their numbers.
    // The user-authored shield-break is its own dump because Java resolves that id through a code
    // special case in front of the table lookup, so it never appears in records().
    expect((await data.skills()).length).toBe(66);
    expect((await data.userAuthoredSkills()).map((row) => row.runtimeId)).toEqual([2000]);
    expect((await data.items()).length).toBe(87);
    // The 40 of the Java catalog, Phong Bế (2:6) included.
    expect((await data.statuses()).length).toBe(40);
    expect((await data.charms()).length).toBe(12);
    expect((await data.badges()).length).toBe(9);
    // The 19 rollable talents; HV-01 and TL-01 are the mutation forms' characteristics.
    expect((await data.physicalTraits()).length).toBe(19);
    expect((await data.evolutions()).length).toBe(88);
    expect(Object.keys(await data.learnsets()).length).toBe(280);
    expect(Object.keys(await data.taskOffers()).length).toBe(30);
    expect((await data.npcRoster()).length).toBe(72);
    expect((await data.acquisitionRoutes()).length).toBe(202);
  });

  it("resolves species, skills and learnsets the way Java indexes them", async () => {
    const data = await newData();
    const first = await data.speciesByPetKey("CV-000");
    expect(first).toMatchObject({ speciesId: 100, name: "Thụ quái", element: 1, spriteId: 1000 });
    const growth = first?.growth;
    if (growth?.kind !== "unified-record") throw new Error("CV-000 is not a unified record");
    expect(growth.record.base).toEqual([70, 95, 5, 7]);
    expect(speciesPetKey((await data.speciesByRuntimeId(100))!)).toBe("CV-000");
    expect(await data.speciesByRuntimeId(9999)).toBeUndefined();
    // The V4 species are catalogued with their anchors but resolve through a branch the golden
    // tables do not grade yet, so the key index reaches them without the stat layer depending on it.
    expect(speciesPetKey((await data.speciesByPetKey("V4-004"))!)).toBe("V4-004");
    expect(await data.speciesByPetKey("NO-SUCH-KEY")).toBeUndefined();
    expect((await data.learnset("CV-000")).length).toBeGreaterThan(0);
    expect(await data.learnset("NO-SUCH-PET")).toEqual([]);
    const skill = await data.skillByRuntimeId(70);
    expect(skill?.stableKey).toBe("CV-SKILL-00");
    expect((await data.evolutionsFrom("CV-000")).length).toBeGreaterThan(0);
  });

  it("keeps status and trait rows readable", async () => {
    const data = await newData();
    const status = await data.statusByStableKey("LH-EFFECT-6-00");
    expect(status).toMatchObject({ displayName: "Súc Lực", sourceBank: 0, stackCap: 1 });
    expect((await data.physicalTraits())[0]).toMatchObject({ stableKey: "TC-00" });
    expect((await data.charms())[0].tierValues.length).toBe(6);
  });

  it("serves the text holders, including the prompt the quest export already uses", async () => {
    const data = await newData();
    const contract = JSON.parse(
      readFileSync(resolve(root, "public", "pack", "story", "world-contract.json"), "utf8"),
    );
    expect((await data.text("Common")).SAVE_PROMPT).toBe(contract.text.savePrompt);
    expect(Object.keys(await data.text("Battle")).length).toBeGreaterThan(0);
    await expect(data.text("NoSuchGroup")).rejects.toThrow(/no VqsvText group/);
    const stories = readdirSync(resolve(root, "public", "pack", "data", "text")).filter((name) =>
      name.startsWith("story-"),
    );
    expect(stories.length).toBe(29);
    expect(Object.keys(await data.storyText("BlcC1StoryData")).length).toBeGreaterThan(0);
  });

  it("carries the battle groups, effect tunables and flag numbers the engine declares", async () => {
    const data = await newData();
    const events = await data.battleEvents();
    expect(Object.keys(events).length).toBe(109);
    expect(events.SCENE1_ROOM1_GROUP0_BUNNY).toMatchObject({
      label: "scene1 room1 group0 Bunny",
      sceneId: 1,
      roomIndex: 1,
      groupIndex: 0,
      op67ActorId: -1,
      op37Encounter: [34, 5, 1],
      battleFlags: [0, 1],
      op32Mode: [0, 0],
      op47BranchTargets: [12, 0, 0],
      sourceOp54Roster: false,
    });
    expect(events.SCENE4_ROOM8_GROUP1_RED.aiProfile).toMatchObject({
      tier: "BattleAiTier.TRAINER",
      healingThresholdPercent: 26,
      itemBudget: 1,
    });
    expect(
      [...new Set(Object.values(events).map((event) => event.sceneId))].sort((a, b) => a - b),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    // a room group can be declared twice, once per slot of a sequential trainer pair.
    expect((await data.battleEventsAt(4, 8, 1)).length).toBe(2);
    expect((await data.battleEventsAt(1, 1, 0))[0]?.label).toBe("scene1 room1 group0 Bunny");
    expect(await data.battleEventsAt(99, 0, 0)).toEqual([]);

    expect(await data.screenEffectConstants()).toMatchObject({
      "ScreenEffect.W": 240,
      "ScreenEffect.H": 320,
      "ScreenEffect.MAX_SCREEN_PARTICLES": 180,
      "ScreenEffect.EFFECT_SPEED": [
        [1, 3],
        [1, 4],
        [2, 5],
        [2, 6],
      ],
      "ScreenEffect.SOURCE_SHAKE_PATTERN_2": [-5, 10, -5],
    });
    expect(await data.screenEffectDefaults()).toMatchObject({
      overlayType: -1,
      overlayDone: true,
      barsDone: true,
      shakeDone: true,
      circleColors: [0xffffff, 9115396],
      particles: [],
    });

    expect(await data.flag("TanNguyetLongMaBossRuntime.VICTORY_COMPLETED_FLAG")).toBe(910044);
    expect(await data.flag("PlayerTitleRuntime.NOTICE_SEEN_FLAG")).toBe(910043);
    expect(await data.flag("NiemThoEggQuestProgress.READY_FLAG")).toBe(16006);
    expect(await data.flag("BattleUnit.STAT_SIDE_FLAG")).toBe(6);
    expect((await data.flagConstants())["SaveEnvelopeCodec.FLAGS_GZIP"]).toBe(1);
    await expect(data.flag("NoSuchRuntime.NO_SUCH_FLAG")).rejects.toThrow(/no flag/);
  });

  it("carries the five Java decision profiles the engine falls back to", async () => {
    const data = await newData();
    const profiles = await data.aiProfiles();
    expect(Object.keys(profiles).sort()).toEqual(["BOSS", "COMPANION", "ELITE", "TRAINER", "WILD"]);
    expect(profiles.WILD).toEqual({
      tier: "BattleAiTier.WILD",
      randomness: 54,
      repetitionPenalty: 22,
      itemBudget: 0,
      tacticalSwitch: false,
      healingThresholdPercent: 0,
      switchCooldownTurns: 0,
      switchChancePercent: 0,
      mayRevive: false,
    });
    expect(profiles.TRAINER).toMatchObject({
      randomness: 34,
      repetitionPenalty: 30,
      itemBudget: 1,
      healingThresholdPercent: 26,
      switchCooldownTurns: 3,
      switchChancePercent: 22,
    });
    expect(profiles.ELITE).toMatchObject({
      randomness: 18,
      repetitionPenalty: 40,
      itemBudget: 1,
      healingThresholdPercent: 34,
      switchCooldownTurns: 2,
      switchChancePercent: 55,
    });
    expect(profiles.BOSS).toMatchObject({
      randomness: 8,
      repetitionPenalty: 48,
      itemBudget: 2,
      healingThresholdPercent: 42,
      switchCooldownTurns: 2,
      switchChancePercent: 85,
      mayRevive: true,
    });
    expect(profiles.COMPANION).toMatchObject({
      randomness: 20,
      repetitionPenalty: 38,
      itemBudget: 0,
      tacticalSwitch: false,
      healingThresholdPercent: 30,
      switchChancePercent: 0,
    });
    // A tier never changes a stat, only a choice, so the tiers have to be strictly ordered by how
    // much the engine is allowed to think.
    const tiers = ["WILD", "TRAINER", "ELITE", "BOSS"] as const;
    for (let i = 1; i < tiers.length; i++) {
      expect(profiles[tiers[i]].randomness).toBeLessThan(profiles[tiers[i - 1]].randomness);
      expect(profiles[tiers[i]].repetitionPenalty).toBeGreaterThan(
        profiles[tiers[i - 1]].repetitionPenalty,
      );
    }
    // Every descriptor's resolved profile is one of these five rows, byte for byte, so a battle with
    // no descriptor can fall back to the tier default without the client inventing numbers.
    const serialized = new Set(Object.values(profiles).map((profile) => JSON.stringify(profile)));
    for (const event of Object.values(await data.battleEvents())) {
      expect(serialized.has(JSON.stringify(event.aiProfile))).toBe(true);
    }
    expect(await data.aiProfileForTier("BOSS")).toEqual(profiles.BOSS);
    await expect(data.aiProfileForTier("NO_SUCH_TIER")).rejects.toThrow(/no Java AI profile/);
  });

  it("still refuses a data path outside the declared shapes", async () => {
    const pack = await Pack.load();
    expect(pack.url("data.battle/species.json")).toBe("/pack/data/battle/species.json");
    expect(pack.url("data.flags/constants.json")).toBe("/pack/data/flags/constants.json");
    expect(() => pack.url("data.species.json")).toThrow(/no declared shape/);
    expect(() => pack.url("data.battle/nested/species.json")).toThrow(/no declared shape/);
    expect(() => pack.url("data.text/../pack.json")).toThrow(/not pack-relative/);
  });
});
