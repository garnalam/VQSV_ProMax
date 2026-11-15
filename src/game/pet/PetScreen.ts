import type { SavedPet } from "../../persistence/save/GameSave";
import type { BattleUiRow } from "../battle/BattleUiState";
import { MAX_PET_LEVEL, requiredExp } from "../battle/engine/PetProgression";
import type { BattleServices } from "../battle/engine/BattleServices";
import type { BagCatalog } from "../inventory/Bag";

/**
 * The JavaSE pet screen over the free world (`VqsvGameRuntime.openWorldPetstate`): the same pet
 * dashboard the fight uses (`renderPetStateOverlay`, here with "Xác định"), the `petsetting.ui`
 * menu (`tickSourcePetSetting`), the release question and using a bag item on a pet
 * (`confirmPanelBagState17` through `PetItemService.useBattleItem`). Pure: no DOM, no panel state.
 */

/** One row of `public/pack/story/pet-species.json` (db.mid group 0). */
export type PetSpeciesRow = {
  id: number;
  name: string;
  element: number;
  elementName: string;
  columns: number[];
};
export type PetSpeciesDocument = { species: PetSpeciesRow[] };

export class PetSpeciesCatalog {
  constructor(readonly document: PetSpeciesDocument) {}
  row(species: number): PetSpeciesRow | undefined {
    return this.document.species[species];
  }
  column(species: number, column: number, fallback = -1): number {
    return this.row(species)?.columns[column] ?? fallback;
  }
  /** `sourceReleaseProtectedPet`: column 22 = 2 marks a divine beast. */
  divine(species: number): boolean {
    return this.column(species, 22) === 2;
  }
}

/** `sourcePetLiving`: the pet can fight (HP above 0). */
export const petAlive = (pet: SavedPet) => (pet.currentHp ?? pet.maxHp ?? 1) > 0;

const ELEMENT_NAMES = ["Hỏa", "Mộc", "Thổ", "Thủy", "Điện", "Quỷ", "Phong"];

/**
 * `PetBattleViewAdapter.toPetStateView` for a roster pet: what the dashboard's four tabs show. The
 * fighting pet is the first one; the status chip reads as `drawPetStateInfoChip` writes it.
 */
export function worldPetCard(pet: SavedPet, index: number, services: BattleServices): BattleUiRow {
  const setup = services.partyMember(pet),
    profile = services.profile(setup),
    alive = petAlive(pet),
    level = pet.level,
    need = level >= MAX_PET_LEVEL ? 0 : requiredExp(level + 1),
    maxHp = setup.stats.hp,
    hp = Math.max(0, Math.min(maxHp, pet.currentHp ?? maxHp)),
    name = setup.name ?? `Pet ${pet.speciesId}`;
  return {
    name,
    value: `${alive ? `lv${level}` : "KO"} ${hp}/${maxHp}`,
    pet: {
      spriteId: setup.spriteId ?? 0,
      nature: pet.nature,
      shinyColor: pet.shinyColor,
      element: setup.element ?? -1,
      elementName: ELEMENT_NAMES[setup.element ?? -1],
      level,
      hp,
      maxHp,
      expPercent: need > 0 ? Math.floor((100 * Math.min(need, pet.experience ?? 0)) / need) : 100,
      quality: pet.quality,
      status: alive ? (index === 0 ? "Xuất chiến" : "Sẵn sàng") : "Không thể chiến",
      active: index === 0 && alive,
      divineSealed: services.divinePercent?.(pet.speciesId) === 30,
      held: profile.held ?? "Trống",
      stats: [maxHp, setup.stats.attack, setup.stats.defense, setup.stats.speed],
      trait: profile.trait,
      talent: profile.talent,
      speciesName: profile.species,
      evolution: profile.evolution,
      skills: setup.skillIds.flatMap((id, slot) => {
        const row = services.rules.damage.skillRow(id);
        return id >= 0
          ? [
              {
                name: row?.name ?? `Skill ${id}`,
                pp: `${setup.skillPp?.[slot] ?? 0}/${row?.ppMax ?? 0}`,
                element: row?.elementFamily,
              },
            ]
          : [];
      }),
    },
  };
}

/** `sourcePetSettingActionLabel`: seven rows, or eight when the pet can evolve. */
export function petSettingLabels(evolution: string | null, companion: boolean): string[] {
  const rows = ["Đạo cụ", "Chiến đấu", "Vật phẩm trang sức", "Phóng sinh", "Kỹ năng", "Nâng phẩm"];
  if (evolution) rows.push(evolution);
  rows.push(companion ? "Ngừng đồng hành" : "Dắt đi theo");
  return rows;
}

/** `TextBox.msgWarm`'s prompt on the JavaSE map. */
export const PET_PROMPT = "Nhấn nút 5 để tiếp tục";

/** `sourceItemChoiceWarning(validation)`. */
export const PET_ITEM_REFUSALS: Record<number, string> = {
  0: "Sủng vật này đã tử vong, không thể sử dụng",
  1: "Sủng vật này không có, không thể sử dụng",
  2: "Máu đầy, không cần sử dụng",
  3: "Kỹ năng giá trị đã đầy, không cần sử dụng",
  4: "Trên người đều bị lợi hiệu quả",
  5: "Trong hưng phấn, không thể dùng",
  6: "Đạo cụ này không thể sử dụng",
  7: "Máu và kỹ năng đều đã đầy, không cần sử dụng",
  8: "Sủng vật đã chết, không thể sử dụng",
};
export const PET_ITEM_USED = "Thành công sử dụng đạo cụ";
export const PET_ITEM_MISSING = "Đã không có đạo này cụ, thỉnh mua sắm";

/** The item row's kind (`[5]`) and its parameters (`[6]`, `[7]`, `[8]`). */
const kindOf = (bag: BagCatalog, item: number) => bag.consumable(item)?.columns ?? [];

/**
 * `BattleUnit.validateBattleItem(id)`: -1 when the item can be used on this pet, otherwise the
 * refusal code. Out of a fight the web keeps no status ailments, so a cure finds nothing (code 4).
 */
export function petItemCheck(
  pet: SavedPet,
  item: number,
  bag: BagCatalog,
  ppMax: (skill: number) => number,
): number {
  const kind = kindOf(bag, item)[5] ?? -1,
    alive = petAlive(pet),
    hpFull = (pet.currentHp ?? 0) >= (pet.maxHp ?? 0),
    ppFull = (pet.skillIds ?? []).every((id, i) => (pet.skillPp?.[i] ?? 0) >= ppMax(id));
  if (!alive && kind !== 4) return 8;
  switch (kind) {
    case 0:
      return 6;
    case 1:
      return hpFull ? 2 : -1;
    case 2:
      return ppFull ? 3 : -1;
    case 3:
      return ppFull && (hpFull || !alive) ? 7 : -1;
    case 4:
      return alive ? 1 : -1;
    case 5:
      return 4;
    default:
      return -1;
  }
}

/**
 * `BattleUnit.applyBattleItem(id)` on a pet `petItemCheck` accepted: heals (`max * [6] / 100 +
 * [7]`), restores `[6]` (or `[8]`) PP to every skill, revives. The caller takes the item away.
 */
export function applyPetItem(
  pet: SavedPet,
  item: number,
  bag: BagCatalog,
  ppMax: (skill: number) => number,
): void {
  const row = kindOf(bag, item),
    max = pet.maxHp ?? 0,
    heal = Math.trunc((max * (row[6] ?? 0)) / 100) + (row[7] ?? 0),
    setHp = (value: number) => (pet.currentHp = Math.max(0, Math.min(max, value))),
    restorePp = (amount: number) => {
      pet.skillPp = (pet.skillIds ?? []).map((id, i) =>
        Math.min(ppMax(id), (pet.skillPp?.[i] ?? 0) + amount),
      );
    };
  switch (row[5]) {
    case 1:
      setHp((pet.currentHp ?? 0) + heal);
      break;
    case 2:
      restorePp(row[6] ?? 0);
      break;
    case 3:
      setHp((pet.currentHp ?? 0) + heal);
      restorePp(row[8] ?? 0);
      break;
    case 4:
      setHp(heal);
      restorePp(row[8] ?? 0);
      break;
  }
}
