import type { AdminItemKind } from "../../account/AdminApi";
import { FIRST_MATERIAL_ID, type BagCatalog, type ItemDefinition } from "../inventory/Bag";
import { MAX_PET_LEVEL, requiredExp } from "../battle/engine/PetProgression";
import type { SavedPet } from "../../persistence/save/GameSave";

/**
 * The Admin Tool's game-side rules, apart from any DOM or server: which items and species it can
 * hand out, and how a grant the server approved lands in the save's lists.
 */

/** Tàn Nguyệt Long Ma and Kim Diễm Long Vương, which the tool never hands out (the server agrees). */
export const ADMIN_BOSS_SPECIES: ReadonlySet<number> = new Set([278, 280]);
/** How many levels "Buff pet" adds. */
export const ADMIN_BUFF_LEVELS = 15;
/** The largest quantity one grant may add. */
export const ADMIN_MAX_QUANTITY = 9999;
export const ADMIN_MAX_CURRENCY = 0x7fffffff;
/** A bag item stacks to 99 (`GiftCodes`' cap), a special reward too. */
const BAG_STACK = 99;
const SPECIAL_STACK = 99;

export type AdminItemChoice = { kind: AdminItemKind; id: number; name: string };

export const ADMIN_KIND_LABELS: Record<AdminItemKind, string> = {
  BAG: "Vật phẩm",
  EQUIPMENT: "Trang sức",
  MATERIAL: "Nguyên liệu",
  SPECIAL: "Đặc biệt",
};

/**
 * Every item the bag can list, by tab: the db.mid rows and the unified catalog's records, plus the
 * eggs (special rewards the bag draws from their own rows). Sorted by tab, then id.
 */
export function adminItemChoices(
  catalog: BagCatalog,
  eggs: Iterable<{ itemId: number; name: string }> = [],
): AdminItemChoice[] {
  const out = new Map<string, AdminItemChoice>();
  const add = (kind: AdminItemKind, id: number, item: ItemDefinition | undefined) => {
    const name = item?.name.trim();
    if (name && !out.has(`${kind}:${id}`)) out.set(`${kind}:${id}`, { kind, id, name });
  };
  const doc = catalog.document,
    unified = catalog.unified?.records ?? [];
  doc.consumables.forEach((row, id) => row && add("BAG", id, catalog.bagItem(id)));
  for (const record of unified)
    if (record.kind === "BAG" && record.rainbowImported)
      add("BAG", record.runtimeId, catalog.bagItem(record.runtimeId));
  doc.gear.forEach((row, id) => {
    if (!row) return;
    if (id < FIRST_MATERIAL_ID) add("EQUIPMENT", id, catalog.equipment(id));
    else add("MATERIAL", id, catalog.material(id));
  });
  for (const record of unified) {
    if (record.kind === "EQUIPMENT")
      add("EQUIPMENT", record.runtimeId, catalog.equipment(record.runtimeId));
    else if (record.kind === "MATERIAL")
      add("MATERIAL", record.runtimeId, catalog.material(record.runtimeId));
    else if (record.kind === "SPECIAL")
      add("SPECIAL", record.runtimeId, catalog.specialItem(record.runtimeId));
  }
  doc.specials.forEach((row, id) => row && add("SPECIAL", id, catalog.specialItem(id)));
  for (const egg of eggs) {
    const name = egg.name.trim();
    if (name) out.set(`SPECIAL:${egg.itemId}`, { kind: "SPECIAL", id: egg.itemId, name });
  }
  const order: AdminItemKind[] = ["BAG", "EQUIPMENT", "MATERIAL", "SPECIAL"];
  return [...out.values()].sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.id - b.id,
  );
}

export type AdminSpeciesChoice = { speciesId: number; name: string };

/** Every species a save can hold, the two bosses left out. */
export function adminSpeciesChoices(
  rows: Iterable<{ speciesId: number; name: string; validForBattle?: boolean }>,
): AdminSpeciesChoice[] {
  const out: AdminSpeciesChoice[] = [];
  for (const row of rows)
    if (!ADMIN_BOSS_SPECIES.has(row.speciesId) && row.validForBattle !== false && row.name.trim())
      out.push({ speciesId: row.speciesId, name: row.name });
  return out.sort((a, b) => a.speciesId - b.speciesId);
}

/** The save's item lists, as `WorldRuntime` keeps them. */
export type AdminInventory = {
  items: Record<string, number>;
  equipment: number[];
  materials: Record<string, number>;
  specials: number[];
};

/**
 * Put `quantity` of an item into its list, up to that list's stack: 99 for a bag item or a special
 * reward, one copy of a piece of equipment. Returns how many were actually added.
 */
export function grantItem(
  inventory: AdminInventory,
  kind: AdminItemKind,
  id: number,
  quantity: number,
): number {
  const wanted = Math.max(0, Math.min(ADMIN_MAX_QUANTITY, Math.trunc(quantity)));
  const key = String(id);
  switch (kind) {
    case "BAG": {
      const have = inventory.items[key] ?? 0,
        added = Math.max(0, Math.min(wanted, BAG_STACK - have));
      if (added) inventory.items[key] = have + added;
      return added;
    }
    case "MATERIAL": {
      const have = inventory.materials[key] ?? 0,
        added = Math.max(0, Math.min(wanted, ADMIN_MAX_CURRENCY - have));
      if (added) inventory.materials[key] = have + added;
      return added;
    }
    case "SPECIAL": {
      const have = inventory.specials.reduce((n, value) => (value === id ? n + 1 : n), 0),
        added = Math.max(0, Math.min(wanted, SPECIAL_STACK - have));
      for (let i = 0; i < added; i++) inventory.specials.push(id);
      return added;
    }
    case "EQUIPMENT":
      if (wanted < 1 || inventory.equipment.includes(id)) return 0;
      inventory.equipment.push(id);
      return 1;
  }
}

export function setCurrency(
  currency: { money: number; badges: number },
  money: number,
  badges: number,
): void {
  const clamp = (value: number) => Math.max(0, Math.min(ADMIN_MAX_CURRENCY, Math.trunc(value)));
  currency.money = clamp(money);
  currency.badges = clamp(badges);
}

/** The EXP that takes `pet` up `levels` levels (capped at level 100), counting what it already has. */
export function experienceForLevels(pet: SavedPet, levels: number): number {
  const target = Math.min(MAX_PET_LEVEL, pet.level + Math.max(0, Math.trunc(levels)));
  let need = 0;
  for (let level = pet.level + 1; level <= target; level++) need += requiredExp(level);
  return Math.max(0, need - (pet.experience ?? 0));
}
