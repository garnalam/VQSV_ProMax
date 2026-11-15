import type { SavedPet } from "../../persistence/save/GameSave";
import type { EggCatalogRow } from "./CampaignSystems";

/**
 * JavaSE `CauVongIncubationProgression` + `CauVongIncubationRuntime`: the Cầu Vồng hatchery's five
 * independent slots, separate from the one incubator of the Liệt Hỏa eggs. An egg is reserved from
 * the bag when it goes in; battle EXP (`advanceExperience`, a tenth of the fight's participant EXP,
 * at least 1) fills every occupied slot to 200; a full slot hatches its recipe's species at its
 * level once the materials are there, into the party (fewer than six) or the bank.
 */
export type CauVongIncubation = { items: number[]; progress: number[] };

export const CAU_VONG_SLOTS = 5;
export const CAU_VONG_TARGET = 200;

export const emptyCauVongIncubation = (): CauVongIncubation => ({
  items: new Array(CAU_VONG_SLOTS).fill(0),
  progress: new Array(CAU_VONG_SLOTS).fill(0),
});

/** `restore`: a malformed state is refused as Java throws; the caller starts empty. */
export function validCauVongIncubation(
  state: unknown,
  isEgg: (item: number) => boolean,
): state is CauVongIncubation {
  if (!state || typeof state !== "object") return false;
  const { items, progress } = state as Partial<CauVongIncubation>;
  if (!Array.isArray(items) || !Array.isArray(progress)) return false;
  if (items.length !== CAU_VONG_SLOTS || progress.length !== CAU_VONG_SLOTS) return false;
  return items.every((item, i) => {
    const points = progress[i];
    return (
      Number.isInteger(item) &&
      Number.isInteger(points) &&
      (item === 0 || isEgg(item)) &&
      points >= 0 &&
      points <= CAU_VONG_TARGET &&
      !(item === 0 && points !== 0)
    );
  });
}

export const cauVongReady = (state: CauVongIncubation, slot: number) =>
  state.items[slot] !== 0 && state.progress[slot] === CAU_VONG_TARGET;

export const firstEmptySlot = (state: CauVongIncubation) => state.items.indexOf(0);

/** `advanceExperience`: every occupied slot gains max(1, exp / 10) points, capped at 200. */
export function advanceCauVongIncubation(state: CauVongIncubation, experience: number): void {
  if (experience <= 0) return;
  const points = Math.max(1, Math.trunc(experience / 10));
  for (let i = 0; i < CAU_VONG_SLOTS; i++)
    if (state.items[i] !== 0)
      state.progress[i] = Math.min(CAU_VONG_TARGET, state.progress[i] + points);
}

/** `clear`: the discard (no refund) and the end of a hatch. */
export function clearCauVongSlot(state: CauVongIncubation, slot: number): void {
  state.items[slot] = 0;
  state.progress[slot] = 0;
}

export type CauVongIncubationResult =
  | "ADMITTED"
  | "HATCHED"
  | "EMPTY"
  | "OCCUPIED"
  | "MISSING_EGG"
  | "NOT_READY"
  | "MISSING_MATERIALS"
  | "STORAGE_FULL"
  | "CREATION_FAILED";

/** `admit`: a Cầu Vồng egg the player owns goes into an empty slot, and leaves the bag. */
export function admitCauVongEgg(
  state: CauVongIncubation,
  specials: number[],
  slot: number,
  item: number,
  isEgg: (item: number) => boolean,
): CauVongIncubationResult {
  if (!isEgg(item)) return "MISSING_EGG";
  if (state.items[slot] !== 0) return "OCCUPIED";
  const at = specials.indexOf(item);
  if (at < 0) return "MISSING_EGG";
  state.items[slot] = item;
  state.progress[slot] = 0;
  specials.splice(at, 1);
  return "ADMITTED";
}

export type CauVongHatchContext = {
  state: CauVongIncubation;
  roster: SavedPet[];
  bank: SavedPet[];
  bankCapacity: number;
  recipe: (item: number) => EggCatalogRow["incubator"] | undefined;
  /** `CauVongOpeningSideQuests.count` of a material row. */
  count: (material: CauVongMaterial) => number;
  remove: (material: CauVongMaterial, count: number) => void;
  /** `PetSourceAdapter.create(0, species, level, -1, 2, element * 10, -1)`. */
  create: (speciesId: number, level: number) => SavedPet | undefined;
  /** The hatched pet goes into the Đồ giám (species, shiny nature and colour). */
  markCollected: (pet: SavedPet) => void;
};
export type CauVongMaterial = NonNullable<EggCatalogRow["incubator"]>["materials"][number];

/**
 * `hatch`: every capacity, material and creation check precedes the first write; then the pet
 * joins the party (fewer than six) or the bank, the materials are spent and the slot empties.
 */
export function hatchCauVongSlot(
  c: CauVongHatchContext,
  slot: number,
): { result: CauVongIncubationResult; pet?: SavedPet; storage?: 0 | 1 } {
  const item = c.state.items[slot];
  if (item === 0) return { result: "EMPTY" };
  if (!cauVongReady(c.state, slot)) return { result: "NOT_READY" };
  const storage: 0 | 1 | -1 =
    c.roster.length < 6 ? 0 : c.bank.length < Math.max(0, c.bankCapacity) ? 1 : -1;
  if (storage < 0) return { result: "STORAGE_FULL" };
  const recipe = c.recipe(item);
  if (!recipe) return { result: "CREATION_FAILED" };
  for (const material of recipe.materials)
    if (c.count(material) < material.count) return { result: "MISSING_MATERIALS" };
  const pet = c.create(recipe.species, recipe.level);
  if (!pet) return { result: "CREATION_FAILED" };
  const into = storage === 0 ? c.roster : c.bank;
  pet.slot = into.length;
  into.push(pet);
  for (const material of recipe.materials) c.remove(material, material.count);
  clearCauVongSlot(c.state, slot);
  c.markCollected(pet);
  return { result: "HATCHED", pet, storage: storage === 0 ? 0 : 1 };
}
