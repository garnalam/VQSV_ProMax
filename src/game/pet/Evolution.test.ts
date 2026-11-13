import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EvolutionSession } from "./EvolutionSession";
import type { BattleServices } from "../battle/engine/BattleServices";
import { BagCatalog, type BagItemsDocument } from "../inventory/Bag";
import { UnifiedItemCatalog, type UnifiedItemsDocument } from "../../data/UnifiedItems";

describe("evolution material icons", () => {
  it("come from the unified catalog: a sprite-258 cell for Liệt Hỏa, the record's PNG for Cầu Vồng", () => {
    const json = <T>(file: string) => JSON.parse(readFileSync(file, "utf8")) as T,
      bag = new BagCatalog(
        json<BagItemsDocument>("public/pack/story/bag-items.json"),
        new UnifiedItemCatalog(json<UnifiedItemsDocument>("public/pack/items/catalog.json")),
      );
    expect(bag.material(12)).toMatchObject({ icon: 13, iconKey: undefined });
    expect(bag.material(3009)).toMatchObject({
      icon: 16,
      iconKey: "items.icons/CV-ITEM-0-16.png",
      name: "Cứng cỏi thạch",
    });
  });
});

describe("evolution preview", () => {
  it("resolves the target species sprite instead of retaining the current form override", () => {
    const services = {
        partyMember: (pet: { speciesId: number; visualSpriteId?: number }) => ({
          spriteId: pet.visualSpriteId ?? pet.speciesId + 1000,
          name: `Pet ${pet.speciesId}`,
          stats: { hp: 10, attack: 10, defense: 10, speed: 10 },
        }),
      } as unknown as BattleServices,
      pet = { speciesId: 68, visualSpriteId: 154, level: 7, quality: 2, experience: 0 },
      session = new EvolutionSession(
        0,
        pet,
        {
          key: "test",
          kind: "evolution",
          fromSpecies: 68,
          toSpecies: 69,
          requiredLevel: 1,
          requiredQuality: 1,
          ingredients: [],
        },
        {},
        services,
      );
    expect([session.oldSprite, session.newSprite]).toEqual([154, 1069]);
  });
});
