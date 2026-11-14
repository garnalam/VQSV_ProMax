import { describe, expect, it } from "vitest";
import { PetCollection, collectionFamily } from "./PetCollection";
import { BadgeProgression } from "../world/WorldFlags";
import { claimCollectionReward, synchronizeGoldenBadgeBankReward } from "./GoldenBadgeBankReward";
import { decideReserveShare, expAward, reserveExpAward } from "../battle/BattleOutcomeEngine";
import type { SavedPet } from "../../persistence/save/GameSave";
import { petmapRows } from "../record/RecordBook";
import type { PackSpeciesRow } from "../../data/GameData";
import { WorldPanel } from "../world/WorldPanel";
import { SourceUiLayout } from "../../rendering/SourceUiLayout";
import { badgeEntries, recordStats } from "../record/RecordBook";

describe("Test Huy collection and golden badges", () => {
  it("counts normal and three shiny forms independently for all eight one-time milestones", () => {
    const collection = new PetCollection();
    for (let id = 0; id < 281; id++) collection.markCollected(id);
    expect(collection.allCollectedSpeciesCount()).toBe(281);
    expect(collection.goldenShinyCollectedCount()).toBe(0);
    expect(collection.convenienceRewardCollectedCount(0)).toBe(202);
    expect(collection.convenienceRewardCollectedCount(6)).toBe(281);
    expect(collection.convenienceRewardReady(7)).toBe(false);
    const badges = new BadgeProgression();
    for (let tier = 0; tier < 6; tier++) {
      expect(collection.nextConvenienceRewardTier()).toBe(tier);
      expect(claimCollectionReward(collection, badges, tier)).toMatchObject({ claimed: true, badgeCurrency: 1 });
      expect(claimCollectionReward(collection, badges, tier).claimed).toBe(false);
    }
    expect(claimCollectionReward(collection, badges, 6)).toMatchObject({ claimed: true, badgeCurrency: 0, goldenTier: 1 });
    for (let nature = 7; nature <= 9; nature++)
      for (let id = 0; id < 281; id++) collection.markCollected(id, nature);
    expect(collection.goldenShinyCollectedCount()).toBe(843);
    expect(claimCollectionReward(collection, badges, 7).goldenTier).toBe(2);
    expect(collection.nextConvenienceRewardTier()).toBe(8);
    const restored = new PetCollection(collection.snapshot());
    restored.restoreConvenienceRewards(collection.convenienceRewardsSnapshot());
    expect(restored.nextConvenienceRewardTier()).toBe(8);
    expect(restored.convenienceRewardMilestone(8)).toBe(-1);
  });

  it("maps the four Liệt Hỏa additions and three Cầu Vồng additions into the recovered families", () => {
    const totals = [0, 0, 0];
    for (let id = 0; id < 281; id++) totals[collectionFamily(id)]++;
    expect(totals).toEqual([104, 105, 72]);
    expect([274, 276, 277, 279].map(collectionFamily)).toEqual([0, 0, 0, 0]);
    expect([275, 278, 280].map(collectionFamily)).toEqual([1, 1, 1]);
    expect(collectionFamily(281)).toBe(-1);
  });

  it("counts all 281 species on the record page while early milestones retain their 202-species counter", () => {
    const collection = new PetCollection();
    collection.markCollected(280);
    expect(recordStats({ collection, ownedPets: 1, species: () => undefined, badges: 0, playTimeMillis: 0 }).collected).toBe(1);
    expect(collection.collectedSpeciesCount()).toBe(0);
  });

  it("renders one family and variant without leaking normal ownership into unseen shiny pages", () => {
    const collection = new PetCollection();
    const species = (id: number) => ({ speciesId: id, name: `Pet ${id}`, spriteId: id, element: 0, validForBattle: true }) as PackSpeciesRow;
    collection.markCollected(279, 8);
    expect(petmapRows(species, collection, 0, 0, 0)).toHaveLength(104);
    expect(petmapRows(species, collection, 0, 0, 2).find(row => row.speciesId === 279)).toMatchObject({ owned: true });
    expect(petmapRows(species, collection, 0, 0, 1).find(row => row.speciesId === 279)).toMatchObject({ seen: false, owned: false });
    expect(petmapRows(species, collection, 0, 2, 0)).toHaveLength(72);
  });

  it("cycles twelve book pages and resets the cursor, then wraps to normal Liệt Hỏa", () => {
    const panel = new WorldPanel();
    panel.visible = true;
    panel.mode = "petmap";
    const pages: number[][] = [];
    for (let i = 0; i < 12; i++) {
      pages.push([panel.petmapFamily, panel.petmapVariant]);
      panel.selected = 5;
      panel.listScroll = 4;
      panel.tick(["confirm"]);
      expect([panel.selected, panel.listScroll]).toEqual([0, 0]);
    }
    expect(pages).toEqual(Array.from({ length: 12 }, (_, index) => [Math.trunc(index / 4), index % 4]));
    expect([panel.petmapFamily, panel.petmapVariant]).toEqual([0, 0]);
  });

  it("restores rank two only with an achieved golden badge and leaves normal enhancement disabled", () => {
    const badges = new BadgeProgression();
    expect(badges.goldenTier()).toBe(0);
    expect(badges.upgradeGolden()).toBe(false);
    badges.grant(7);
    expect(badges.goldenPartyExperiencePercent()).toBe(30);
    expect(badges.enhance(7)).toBe(false);
    expect(badges.upgradeGolden()).toBe(true);
    const restored = new BadgeProgression();
    restored.restore(badges.achievedSnapshot(), badges.enhancedSnapshot());
    expect(restored.goldenTier()).toBe(2);
    restored.restore([], badges.enhancedSnapshot());
    expect(restored.goldenTier()).toBe(0);
    expect(restored.enhanced(7)).toBe(false);
  });

  it("changes family/form by the recovered header hit boxes and cycles with the left softkey", () => {
    const panel = new WorldPanel();
    panel.visible = true;
    panel.mode = "petmap";
    const layout = new SourceUiLayout({ widgets: [] } as never);
    panel.click(layout, 60, 55);
    expect([panel.petmapFamily, panel.petmapVariant]).toEqual([1, 0]);
    panel.click(layout, 150, 55);
    expect([panel.petmapFamily, panel.petmapVariant]).toEqual([1, 1]);
    panel.click(layout, 20, 300);
    panel.tick([]);
    expect([panel.petmapFamily, panel.petmapVariant]).toEqual([1, 2]);
  });

  it("displays the golden badge's two ranks and recovered descriptions", () => {
    const badges = new BadgeProgression();
    const entry = () => badgeEntries(badges, undefined, [])[7];
    expect(entry().description).toContain("281");
    badges.grant(7);
    expect(entry()).toMatchObject({ name: "Hoàng Kim Chương", status: "Bậc 1" });
    expect(entry().description).toContain("30% EXP");
    badges.upgradeGolden();
    expect(entry().status).toBe("Bậc 2");
    expect(entry().description).toContain("5 sao");
  });

  it("upgrades only bank pets at rank two, preserving rounded HP, fainting and five-star pets", () => {
    const badges = new BadgeProgression();
    badges.grant(7);
    const bank: SavedPet[] = [
      { speciesId: 0, level: 1, quality: 1, currentHp: 2 },
      { speciesId: 1, level: 1, quality: 2, currentHp: 0 },
      { speciesId: 2, level: 1, quality: 5, currentHp: 1 },
      { speciesId: 3, level: 1, quality: 1 },
    ];
    const maxHp = (pet: SavedPet) => pet.quality === 5 ? 11 : 3;
    expect(synchronizeGoldenBadgeBankReward(badges, bank, maxHp)).toBe(0);
    badges.upgradeGolden();
    expect(synchronizeGoldenBadgeBankReward(badges, bank, maxHp)).toBe(3);
    expect(bank.map(pet => [pet.quality, pet.currentHp])).toEqual([[5, 7], [5, 0], [5, 1], [5, 11]]);
    expect(bank[0].maxHp).toBe(11);
    expect(synchronizeGoldenBadgeBankReward(badges, bank, maxHp)).toBe(0);
  });

  it("applies the golden percentage after EXP truncation and keeps held item six at 100 percent", () => {
    const input = { enemyLevel: 17, enemyNature: 3, levelFactorLevel: 12, participantCount: 2, divisor: 1000, heldItem5: false, heldItem5Multiplier: 0, experienceMultiplierPercent: 113, experienceMultiplierStackable: true };
    const share = decideReserveShare({ globalShare: false, goldenSharePercent: 30, heldItem6: false });
    expect(share).toMatchObject({ outcome: "SHARE", divisor: 1000, percent: 30 });
    expect(reserveExpAward(input, share)).toBe(Math.trunc(expAward(input) * 30 / 100));
    const item = decideReserveShare({ globalShare: false, goldenSharePercent: 30, heldItem6: true });
    expect(item.percent).toBe(100);
    expect(reserveExpAward(input, item)).toBe(expAward(input));
  });
});
