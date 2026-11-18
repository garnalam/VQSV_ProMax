// Web only (owner, 2026-11-18): pets hatched from the paid eggs ("Trứng sủng vật", item 0, and
// "Trứng Pet V4", item 11) must not be weaker than the pets the world hands out for free; they are
// meant to be the key against the hard Cầu Vồng trainers. Only an OWNED egg pet is raised; trainers
// and companions that field the same species keep their baseline.
//
// Each final form has its own buff (owner: "phải làm buff riêng từng con"): HP, attack and defense in
// percent, speed in whole points, because one or two points of speed decide who moves first. The
// numbers come from comparing the pet with the 87 free final-form pets: its simulated strength
// (win %, its trait included) sets the budget, 5% for a pet already at the free pets' 70th
// percentile (68.8) and up to 25% for the weakest, and the budget goes mostly to the stats it
// ranks low in. Speed is +1 to +5. Earlier forms take their final form's buff. A Divine species in
// the pools (185, 186, 189...) keeps the Divine rule instead.
//
// Like the Divine seal, the buff is never written into saved stats: `BattleServices.partyMember`
// applies it and `WorldRuntime` carries HP's fraction when the maximum changes.
import type { PetCoreStats } from "../battle/PetStatCalculator";

/** HP %, attack %, defense %, speed points, by final form. */
const FINAL_BUFFS = new Map<number, readonly [number, number, number, number]>([
  [0, [30, 26, 29, 5]], // Nhiên Dực Bức: sức mạnh 20
  [56, [18, 20, 21, 5]], // Mực Ma: sức mạnh 53.8
  [58, [20, 32, 27, 5]], // Thủy Thượng Phiêu: sức mạnh 17.5
  [73, [7, 3, 7, 1]], // Chuột Lôi Điện: sức mạnh 70
  [96, [7, 4, 7, 1]], // Liệt ưng: sức mạnh 68.8
  [114, [21, 33, 20, 5]], // Tứ Diệp Tiểu Tả: sức mạnh 47.5
  [115, [11, 6, 12, 3]], // Bá Vương Hoa: sức mạnh 63.8
  [116, [27, 30, 26, 5]], // Ái Tâm Thảo: sức mạnh 21.3
  [124, [21, 28, 18, 5]], // Xích Kim Xà Hậu: sức mạnh 52.5
  [128, [4, 3, 6, 2]], // Song Đao Tướng Quân: sức mạnh 68.8
  [129, [3, 5, 3, 2]], // Đao Thương Tướng Quân: sức mạnh 71.3
  [133, [24, 27, 23, 5]], // Người điện: sức mạnh 50
  [148, [4, 5, 5, 2]], // Thiên Mã Vương: sức mạnh 73.8
  [158, [6, 3, 7, 1]], // Ngựa lưỡi liềm khổng lồ: sức mạnh 71.3
  [162, [21, 29, 17, 5]], // Heo đốm: sức mạnh 35
  [178, [5, 16, 4, 3]], // Rùa khổng lồ biển sâu: sức mạnh 62.5
  [188, [10, 16, 8, 3]], // Thụ tinh ngàn năm: sức mạnh 62.5
  [191, [4, 5, 3, 2]], // Cá Chép Rồng sắt: sức mạnh 75
  [194, [5, 5, 6, 1]], // Thiên Sử Trường: sức mạnh 81.3
  [197, [7, 5, 9, 1]], // Sói Vương Cao Ngạo: sức mạnh 67.5
  [200, [4, 3, 7, 2]], // Sa Vương Cuồng Bạo: sức mạnh 77.5
  [204, [9, 22, 10, 3]], // U Lâm Nhiếp Thụ: sức mạnh 58.8
  [207, [8, 12, 6, 3]], // Vạn Thứ Yêu Mộc: sức mạnh 62.5
  [211, [8, 5, 8, 2]], // Hoàng Kim Mộc Linh: sức mạnh 65
  [213, [19, 9, 16, 3]], // Huyết Độc Ma Cô: sức mạnh 60
  [216, [5, 3, 5, 2]], // Điện Giáp Xà Vương: sức mạnh 75
  [219, [5, 3, 6, 2]], // Hải Vương Thiết Câu: sức mạnh 73.8
  [221, [10, 7, 5, 3]], // Kim Đảm Pháo Thú: sức mạnh 63.8
  [225, [7, 2, 8, 1]], // Thiên Lôi Long Vương: sức mạnh 81.3
  [228, [9, 11, 10, 1]], // Ngân Dực Điệp Hậu: sức mạnh 65
  [231, [7, 7, 6, 2]], // Kim Dực Thiên Lôi: sức mạnh 67.5
  [235, [6, 3, 8, 1]], // Thiên Vũ Chiến Ưng: sức mạnh 86.3
  [237, [20, 5, 20, 2]], // Lục Dực Điện Thiền: sức mạnh 61.3
  [240, [2, 6, 2, 2]], // Huyền Giáp Hải Hùng: sức mạnh 77.5
  [244, [3, 7, 2, 2]], // Thiên Lôi Dương Vương: sức mạnh 77.5
  [247, [5, 20, 9, 3]], // Hải Khiếu Câm Thú: sức mạnh 60
  [250, [6, 3, 6, 1]], // Liệt Hỏa Hổ Vương: sức mạnh 73.8
  [252, [9, 4, 10, 2]], // Cổ Mộc Hầu Tiên: sức mạnh 66.3
  [256, [5, 4, 6, 1]], // U Minh Hồn Vương: sức mạnh 80
  [259, [19, 17, 19, 3]], // Độ Hồn Minh Sư: sức mạnh 56.3
  [262, [11, 6, 8, 2]], // Lam Dực Mộc Hậu: sức mạnh 66.3
  [265, [11, 22, 11, 3]], // Cổ Diễm Đăng Vương: sức mạnh 57.5
  [268, [7, 20, 8, 3]], // Tam Đồng Địa Ma: sức mạnh 58.8
]);

/** An earlier form → the final form whose buff it takes. */
const EARLIER_FORMS: Readonly<Record<number, number>> = {
  72: 73,
  95: 96,
  187: 188,
  190: 191,
  193: 194,
  196: 197,
  199: 200,
  202: 204,
  203: 204,
  205: 207,
  206: 207,
  208: 211,
  209: 211,
  210: 211,
  212: 213,
  214: 216,
  215: 216,
  217: 219,
  218: 219,
  220: 221,
  222: 225,
  223: 225,
  224: 225,
  226: 228,
  227: 228,
  229: 231,
  230: 231,
  232: 235,
  233: 235,
  234: 235,
  236: 237,
  238: 240,
  239: 240,
  242: 244,
  243: 244,
  245: 247,
  246: 247,
  248: 250,
  249: 250,
  251: 252,
  253: 256,
  254: 256,
  255: 256,
  257: 259,
  258: 259,
  260: 262,
  261: 262,
  263: 265,
  264: 265,
  266: 268,
  267: 268,
};

export type EggPetBuff = { hp: number; attack: number; defense: number; speed: number };

/** The buff an owned pet of this species fights with, or undefined for a pet that has none. */
export function eggPetBuff(speciesId: number): EggPetBuff | undefined {
  const row = FINAL_BUFFS.get(EARLIER_FORMS[speciesId] ?? speciesId);
  return row ? { hp: row[0], attack: row[1], defense: row[2], speed: row[3] } : undefined;
}

const SHORT_MAX = 32767;
const raise = (value: number, percent: number) =>
  Math.max(1, Math.min(SHORT_MAX, Math.floor((value * (100 + percent)) / 100)));

/** `stats` with this species' egg buff, or `stats` itself when it has none. */
export function applyEggPetBuff(speciesId: number, stats: PetCoreStats): PetCoreStats {
  const buff = eggPetBuff(speciesId);
  if (!buff) return stats;
  return {
    hp: raise(stats.hp, buff.hp),
    attack: raise(stats.attack, buff.attack),
    defense: raise(stats.defense, buff.defense),
    speed: Math.min(SHORT_MAX, stats.speed + buff.speed),
  };
}
