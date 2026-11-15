import { describe, expect, it } from "vitest";
import type { SavedPet } from "../../persistence/save/GameSave";
import type { EggCatalogRow } from "./CampaignSystems";
import {
  CAU_VONG_TARGET,
  admitCauVongEgg,
  advanceCauVongIncubation,
  emptyCauVongIncubation,
  firstEmptySlot,
  hatchCauVongSlot,
  validCauVongIncubation,
  type CauVongHatchContext,
} from "./CauVongIncubator";
import {
  CauVongIncubatorPanelState,
  type CauVongIncubatorSource,
} from "../world/CauVongIncubatorPanel";

const EGG = 9001,
  OTHER = 9002;
const isEgg = (item: number) => item === EGG || item === OTHER;
const recipe: NonNullable<EggCatalogRow["incubator"]> = {
  species: 300,
  speciesName: "Thử",
  level: 30,
  materials: [{ source: 1, kind: "MATERIAL", id: 3000, name: "Đá", count: 2 }],
};
const pet = (speciesId: number) => ({ speciesId, slot: 0, level: 30 }) as unknown as SavedPet;

function context(over: Partial<CauVongHatchContext> = {}) {
  const materials: Record<number, number> = { 3000: 2 };
  const collected: number[] = [];
  const c: CauVongHatchContext = {
    state: emptyCauVongIncubation(),
    roster: [],
    bank: [],
    bankCapacity: 100,
    recipe: (item) => (item === EGG ? recipe : undefined),
    count: (m) => materials[m.id] ?? 0,
    remove: (m, n) => {
      materials[m.id] -= n;
    },
    create: (species) => pet(species),
    markCollected: (hatched) => {
      collected.push(hatched.speciesId);
    },
    ...over,
  };
  return { c, materials, collected };
}

describe("Cầu Vồng five-slot incubator (CauVongIncubationProgression/Runtime)", () => {
  it("admits an owned egg into an empty slot and takes it from the bag", () => {
    const state = emptyCauVongIncubation(),
      specials = [EGG, 5, EGG];
    expect(admitCauVongEgg(state, specials, 2, EGG, isEgg)).toBe("ADMITTED");
    expect(state.items).toEqual([0, 0, EGG, 0, 0]);
    expect(specials).toEqual([5, EGG]);
    expect(admitCauVongEgg(state, specials, 2, EGG, isEgg)).toBe("OCCUPIED");
    expect(admitCauVongEgg(state, specials, 0, OTHER, isEgg)).toBe("MISSING_EGG");
    expect(admitCauVongEgg(state, specials, 0, 5, isEgg)).toBe("MISSING_EGG");
    expect(firstEmptySlot(state)).toBe(0);
  });

  it("battle EXP fills every occupied slot by a tenth (at least 1), capped at 200", () => {
    const state = emptyCauVongIncubation();
    state.items[0] = EGG;
    state.items[3] = OTHER;
    advanceCauVongIncubation(state, 5);
    expect(state.progress).toEqual([1, 0, 0, 1, 0]);
    advanceCauVongIncubation(state, 1234);
    expect(state.progress).toEqual([124, 0, 0, 124, 0]);
    advanceCauVongIncubation(state, 5000);
    expect(state.progress).toEqual([200, 0, 0, 200, 0]);
    advanceCauVongIncubation(state, 0);
    expect(state.progress[1]).toBe(0);
  });

  it("hatches a full slot: checks first, then the pet, the materials and the slot", () => {
    const { c, materials, collected } = context();
    expect(hatchCauVongSlot(c, 0).result).toBe("EMPTY");
    c.state.items[0] = EGG;
    c.state.progress[0] = CAU_VONG_TARGET - 1;
    expect(hatchCauVongSlot(c, 0).result).toBe("NOT_READY");
    c.state.progress[0] = CAU_VONG_TARGET;
    materials[3000] = 1;
    expect(hatchCauVongSlot(c, 0).result).toBe("MISSING_MATERIALS");
    expect(c.roster).toEqual([]);
    materials[3000] = 3;
    expect(hatchCauVongSlot(c, 0)).toMatchObject({ result: "HATCHED", storage: 0 });
    expect(c.roster.map((p) => p.speciesId)).toEqual([300]);
    expect(materials[3000]).toBe(1);
    expect(c.state.items[0]).toBe(0);
    expect(collected).toEqual([300]);
  });

  it("a full party sends the pet to the bank; a full bank keeps the egg", () => {
    const six = Array.from({ length: 6 }, () => pet(1));
    const bank = context({ roster: six });
    bank.c.state.items[1] = EGG;
    bank.c.state.progress[1] = CAU_VONG_TARGET;
    expect(hatchCauVongSlot(bank.c, 1)).toMatchObject({ result: "HATCHED", storage: 1 });
    expect(bank.c.bank).toHaveLength(1);
    const full = context({ roster: [...six], bank: [pet(1)], bankCapacity: 1 });
    full.c.state.items[1] = EGG;
    full.c.state.progress[1] = CAU_VONG_TARGET;
    expect(hatchCauVongSlot(full.c, 1).result).toBe("STORAGE_FULL");
    expect(full.c.state.items[1]).toBe(EGG);
    expect(full.materials[3000]).toBe(2);
  });

  it("refuses a malformed saved state", () => {
    const of = (items: number[], progress: number[]) =>
      validCauVongIncubation({ items, progress }, isEgg);
    expect(validCauVongIncubation(emptyCauVongIncubation(), isEgg)).toBe(true);
    expect(of([0, 0, 0, 0], [0, 0, 0, 0])).toBe(false);
    expect(of([5, 0, 0, 0, 0], [0, 0, 0, 0, 0])).toBe(false);
    expect(of([0, 0, 0, 0, 0], [3, 0, 0, 0, 0])).toBe(false);
    expect(of([EGG, 0, 0, 0, 0], [201, 0, 0, 0, 0])).toBe(false);
  });
});

describe("CauVongIncubatorPanel", () => {
  function panel() {
    const state = emptyCauVongIncubation(),
      specials = [EGG, EGG],
      { c } = context({ state });
    const source: CauVongIncubatorSource = {
      state: () => state,
      eggs: () => [
        { itemId: EGG, hatch: "cauVong", incubator: recipe } as EggCatalogRow,
        { itemId: OTHER, hatch: "cauVong" } as EggCatalogRow,
      ],
      owned: (item) => specials.filter((id) => id === item).length,
      materialCount: () => 2,
      admit: (slot, item) => admitCauVongEgg(state, specials, slot, item, isEgg),
      hatch: (slot) => hatchCauVongSlot(c, slot).result,
      discard: (slot) => {
        state.items[slot] = 0;
        state.progress[slot] = 0;
      },
    };
    const p = new CauVongIncubatorPanelState();
    p.open();
    return { p, source, state, specials };
  }

  it("an empty slot lists the owned eggs and Quay lại; confirming admits one", () => {
    const { p, source, state, specials } = panel();
    p.tick(["down"], source);
    p.tick(["confirm"], source);
    expect([p.menu, p.choices]).toEqual([1, [EGG, 0]]);
    p.tick(["confirm"], source);
    expect(p.menu).toBe(0);
    expect(p.message).toBe("Đã đưa 1 trứng vào ô 2.");
    expect(state.items[1]).toBe(EGG);
    expect(specials).toEqual([EGG]);
  });

  it("an occupied slot hatches or asks before discarding (Giữ trứng first)", () => {
    const { p, source, state } = panel();
    state.items[0] = EGG;
    state.progress[0] = 50;
    p.tick(["confirm"], source);
    expect(p.menu).toBe(2);
    p.tick(["confirm"], source);
    expect(p.message).toBe("Trứng chưa đạt 200 điểm.");
    // Discard: the confirmation starts on "Giữ trứng", which keeps it.
    p.tick(["confirm"], source);
    p.tick(["down"], source);
    p.tick(["confirm"], source);
    expect([p.menu, p.action]).toEqual([3, 1]);
    p.tick(["confirm"], source);
    expect(state.items[0]).toBe(EGG);
    p.tick(["confirm"], source);
    p.tick(["down"], source);
    p.tick(["confirm"], source);
    p.tick(["up"], source);
    p.tick(["confirm"], source);
    expect(state.items[0]).toBe(0);
    expect(p.message).toBe("Đã bỏ trứng. Trứng không được hoàn lại.");
    expect(p.tick(["back"], source)).toBe(true);
  });

  it("selectEmpty goes to the first empty slot; clicks map like Java's", () => {
    const { p, source, state } = panel();
    state.items[0] = EGG;
    p.selectEmpty(state);
    expect(p.selected).toBe(1);
    expect(p.click(50, 36 + 3 * 30 + 5)).toEqual([]);
    expect(p.selected).toBe(3);
    expect(p.click(50, 300)).toEqual(["confirm"]);
    expect(p.click(200, 300)).toEqual(["back"]);
    p.tick(["confirm"], source);
    expect(p.click(50, 50)).toEqual(["confirm"]);
    expect(p.click(200, 260)).toEqual(["down"]);
  });
});
