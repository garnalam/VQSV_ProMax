import type { StatusUnit } from "../StatusState";

/**
 * Tàn Nguyệt Long Ma, the authored custom boss of Cứ điểm Thánh Điện (`TanNguyetLongMaCatalog`,
 * `TanNguyetLongMaBattleMechanics`, `TanNguyetLongMaBossRuntime`): a 2v2 "Ma Mộc Cộng Sinh" where
 * Hoa Tiên Tử (CV-089) stands in slot 0 and the boss in slot 1, at level 50, and the player commands
 * both of its slots.
 *
 * This file is the boss-only arithmetic, ported as written; the fight state that strings it together
 * (the one revive, the Hoa rescue penalty, the enrage, the once-per-round shared heal) lives in the
 * 2v2 core, the way it lives in `VqsvDoubleBattleRuntime`.
 */

/** `TanNguyetLongMaCatalog`. */
export const TAN_NGUYET_LONG_MA = {
  speciesId: 278,
  spriteId: 3004,
  stableKey: "BOSS-TAN-NGUYET-LONG-MA",
  name: "Tàn Nguyệt Long Ma",
} as const;

/** `TanNguyetLongMaBossRuntime`: where it stands, who may challenge it, what a win pays. */
export const TAN_NGUYET_BOSS = {
  sceneId: 5,
  roomIndex: 3,
  x: 337,
  y: 368,
  /** The Thánh Điện statue the boss replaces: sprite 289 facing 8 within 8 px of (x, y). */
  statueSprite: 289,
  statueDirection: 8,
  requiredPartySize: 6,
  requiredPetLevel: 50,
  allySpeciesId: 189,
  bossLevel: 50,
  /** `Encounter` triples carry nature 5 for both pets. */
  nature: 5,
  victoryMoney: 50000,
  victoryBadges: 100,
  victoryPetSpeciesId: 2,
  victoryPetLevel: 5,
  victoryPetQuality: 5,
  victoryPetNature: 2,
  /** `sourceWorldFlags`: set by the win; and once its reward notice has been read. */
  victoryCompletedFlag: 910044,
  victoryNoticeSeenFlag: 910045,
  interactionDistance: 34,
  /** `BattleRequest.RuntimeProfile.repeatableRewardContext`, the key every boss hook checks. */
  rewardContext: "tan-nguyet-long-ma",
} as const;

/** `TanNguyetLongMaBattleMechanics`'s numbers. */
export const MA_MOC = {
  lifeStealPercent: 10,
  symbiosisLifeStealPercent: 15,
  symbiosisDamageReductionPercent: 15,
  symbiosisSharedHealPercent: 30,
  hoaControlChanceBonus: 20,
  reviveHpPercent: 50,
  hoaRescueHpCostPercent: 30,
  hoaRescueSpeedPenaltyPercent: 20,
  hoaRescuePenaltyActions: 2,
  enrageStrengthPercent: 30,
  enrageDefensePenaltyPercent: 15,
  finalCurseDamageTakenPercent: 80,
  ghostMirrorDebuffId: 8,
  hoaTienTuSpeciesId: 189,
  longMaMaxHp: 5999,
  longMaStrength: 712,
  longMaDefense: 355,
  hoaTienTuMaxHp: 2145,
  hoaTienTuDefense: 400,
  hoaTienTuSpeed: 46,
  corrosionBurnReductionPercent: 75,
  /** Quỷ (`PetCombatElement.QUY`), the element Toàn Tinh Liệt Phá hunts. */
  ghostElement: 5,
} as const;

/** The two decks `configureEncounterUnit` replaces the learned ones with. */
export const MA_MOC_SKILL = {
  chuPhuocQuyLao: 57,
  longQuyenPhongToa: 112,
  thanhDucXaToi: 114,
  loiNguyenCuoiCung: 59,
  toanTinhLietPha: 109,
  dangChiBichLuy: 14,
  thaoNguyenThuat: 15,
  dangPhuoc: 12,
  vanMocTanThuc: 105,
  baoPhongToanTran: 81,
} as const;

export const LONG_MA_DECK: readonly number[] = [
  MA_MOC_SKILL.chuPhuocQuyLao,
  MA_MOC_SKILL.longQuyenPhongToa,
  MA_MOC_SKILL.thanhDucXaToi,
  MA_MOC_SKILL.loiNguyenCuoiCung,
  MA_MOC_SKILL.toanTinhLietPha,
];
export const HOA_TIEN_TU_DECK: readonly number[] = [
  MA_MOC_SKILL.dangChiBichLuy,
  MA_MOC_SKILL.thaoNguyenThuat,
  MA_MOC_SKILL.dangPhuoc,
  MA_MOC_SKILL.vanMocTanThuc,
  MA_MOC_SKILL.baoPhongToanTran,
];

/** `isBlockedItemStableKey`: the three bag items Ma Mộc Cộng Sinh seals. */
export const MA_MOC_BLOCKED_ITEM_KEYS: readonly string[] = [
  "LH-ITEM-4-05",
  "LH-ITEM-4-09",
  "LH-ITEM-4-12",
];

/** The battle text the fight shows for its boss beats (`VqsvDoubleBattleRuntime`). */
export const MA_MOC_TEXT = {
  sealedItem: "Ma Mộc Cộng Sinh phong ấn đạo cụ này.",
  hoaRescue: "Hoa Tiên Tử hiến 30% HP, cứu Long Ma với 50% HP!",
  revive: "Tàn Nguyệt Long Ma hồi sinh với 50% HP!",
  enrage: "Hoa Tiên Tử gục ngã — Long Ma Cuồng Nộ đến hết trận!",
  victorySuffix: " +100 Huy hiệu, +1 Nhiên Liệp Sư cấp 5, 5 sao.",
} as const;

type Stats = { hp: number; attack: number; defense: number; speed: number };

export function isTanNguyetBoss(unit: { speciesId: number } | null | undefined): boolean {
  return !!unit && unit.speciesId === TAN_NGUYET_LONG_MA.speciesId;
}

export function isHoaTienTu(unit: { speciesId: number } | null | undefined): boolean {
  return !!unit && unit.speciesId === MA_MOC.hoaTienTuSpeciesId;
}

/** `(short)` — the stat columns are Java shorts. */
function toShort(value: number): number {
  return ((value << 16) >> 16) | 0;
}

/** `BattleUnit.hpPercentValue`: whole percent of the maximum, truncated. */
export function hpPercentValue(unit: StatusUnit): number {
  return Math.trunc((unit.currentStats.hp * 100) / Math.max(1, unit.baseStats.hp));
}

/**
 * `configureEncounterUnit`'s stats: the boss gets all four, Hoa Tiên Tử its HP, defense and speed (its
 * attack stays the one its level, quality and talent gave it). `-1` keeps a stat.
 */
export function maMocBattleStats(speciesId: number, stats: Stats): Stats {
  if (speciesId === TAN_NGUYET_LONG_MA.speciesId)
    return {
      hp: MA_MOC.longMaMaxHp,
      attack: MA_MOC.longMaStrength,
      defense: MA_MOC.longMaDefense,
      speed: stats.speed,
    };
  if (speciesId === MA_MOC.hoaTienTuSpeciesId)
    return {
      hp: MA_MOC.hoaTienTuMaxHp,
      attack: stats.attack,
      defense: MA_MOC.hoaTienTuDefense,
      speed: MA_MOC.hoaTienTuSpeed,
    };
  return stats;
}

/** `configureEncounterUnit`'s deck, or `undefined` for any other species. */
export function maMocBattleDeck(speciesId: number): readonly number[] | undefined {
  if (speciesId === TAN_NGUYET_LONG_MA.speciesId) return LONG_MA_DECK;
  if (speciesId === MA_MOC.hoaTienTuSpeciesId) return HOA_TIEN_TU_DECK;
  return undefined;
}

/**
 * `configureEncounterUnit` on a built unit: `setBattleOnlyStats` writes base and current together and
 * fills HP to the new maximum.
 */
export function configureMaMocUnit(unit: StatusUnit): void {
  const stats = maMocBattleStats(unit.speciesId, {
    hp: unit.baseStats.hp,
    attack: unit.baseStats.attack,
    defense: unit.baseStats.defense,
    speed: unit.baseStats.speed,
  });
  if (!maMocBattleDeck(unit.speciesId)) return;
  unit.baseStats.hp = toShort(stats.hp);
  unit.currentStats.hp = toShort(stats.hp);
  unit.baseStats.attack = toShort(stats.attack);
  unit.currentStats.attack = toShort(stats.attack);
  unit.baseStats.defense = toShort(stats.defense);
  unit.currentStats.defense = toShort(stats.defense);
  unit.baseStats.speed = toShort(stats.speed);
  unit.currentStats.speed = toShort(stats.speed);
}

/**
 * `reduceIncomingDamage`: while both stand, the boss takes 15% less (never below 1); Lời Nguyền Cuối
 * Cùng aimed at it lands for 80%.
 */
export function reduceIncomingDamage(
  target: StatusUnit,
  damage: number,
  bothAlive: boolean,
  skillId = -1,
): number {
  let reduced = Math.max(0, damage);
  if (reduced <= 0 || !isTanNguyetBoss(target)) return reduced;
  if (bothAlive)
    reduced = Math.max(
      1,
      Math.trunc((reduced * (100 - MA_MOC.symbiosisDamageReductionPercent)) / 100),
    );
  if (skillId === MA_MOC_SKILL.loiNguyenCuoiCung)
    reduced = Math.max(1, Math.trunc((reduced * MA_MOC.finalCurseDamageTakenPercent) / 100));
  return reduced;
}

/** `reduceCorrosionBurn`: Hủ Thực bites the boss for a quarter. */
export function reduceCorrosionBurn(target: StatusUnit, damage: number): number {
  if (!isTanNguyetBoss(target) || damage <= 0) return Math.max(0, damage);
  return Math.max(1, Math.trunc((damage * (100 - MA_MOC.corrosionBurnReductionPercent)) / 100));
}

/** `shouldPrioritizeBaoPhong`. */
export function shouldPrioritizeBaoPhong(target: StatusUnit | null | undefined): boolean {
  return !!target && target.alive() && hpPercentValue(target) < 50;
}

/** `applyLifeSteal`: 10% of the committed damage (15% while both stand), at least 1; HP actually gained. */
export function applyLifeSteal(
  attacker: StatusUnit,
  committedDamage: number,
  bothAlive: boolean,
): number {
  if (!isTanNguyetBoss(attacker) || committedDamage <= 0 || !attacker.alive()) return 0;
  const before = attacker.hp(),
    percent = bothAlive ? MA_MOC.symbiosisLifeStealPercent : MA_MOC.lifeStealPercent;
  attacker.heal(Math.max(1, Math.trunc((committedDamage * percent) / 100)));
  return Math.max(0, attacker.hp() - before);
}

/** `shareLifeStealWithHoa`: 30% of what the boss drained, at least 1. */
export function shareLifeStealWithHoa(hoa: StatusUnit | undefined, bossHealed: number): number {
  if (!hoa || !isHoaTienTu(hoa) || !hoa.alive() || bossHealed <= 0) return 0;
  const before = hoa.hp();
  hoa.heal(Math.max(1, Math.trunc((bossHealed * MA_MOC.symbiosisSharedHealPercent) / 100)));
  return Math.max(0, hoa.hp() - before);
}

/** `payHoaRescueCost`: 30% of Hoa's current HP, never below 1 HP left. */
export function payHoaRescueCost(hoa: StatusUnit | undefined): number {
  if (!hoa || !isHoaTienTu(hoa) || !hoa.alive()) return 0;
  const cost = Math.max(1, Math.trunc((hoa.hp() * MA_MOC.hoaRescueHpCostPercent) / 100)),
    before = hoa.hp();
  hoa.setHp(Math.max(1, before - cost));
  return before - hoa.hp();
}

/** `applyHoaSpeedPenalty`: speed 46 → 36 until two of its actions have passed. */
export function applyHoaSpeedPenalty(hoa: StatusUnit): number {
  if (!isHoaTienTu(hoa)) return 0;
  hoa.baseStats.speed = toShort(
    Math.max(
      1,
      Math.trunc((MA_MOC.hoaTienTuSpeed * (100 - MA_MOC.hoaRescueSpeedPenaltyPercent)) / 100),
    ),
  );
  hoa.reapplyActiveStatEffects();
  return hoa.currentStats.speed;
}

/** `clearHoaSpeedPenalty`. */
export function clearHoaSpeedPenalty(hoa: StatusUnit): void {
  if (!isHoaTienTu(hoa)) return;
  hoa.baseStats.speed = MA_MOC.hoaTienTuSpeed;
  hoa.reapplyActiveStatEffects();
}

/** `applyEnrage`: attack +30%, defense −15% on the base, to the end of the fight. */
export function applyEnrage(boss: StatusUnit): void {
  if (!isTanNguyetBoss(boss)) return;
  boss.baseStats.attack = toShort(
    Math.max(1, Math.trunc((boss.baseStats.attack * (100 + MA_MOC.enrageStrengthPercent)) / 100)),
  );
  boss.baseStats.defense = toShort(
    Math.max(
      1,
      Math.trunc((boss.baseStats.defense * (100 - MA_MOC.enrageDefensePenaltyPercent)) / 100),
    ),
  );
  boss.reapplyActiveStatEffects();
}

/** `removeGhostMirror`: the boss is immune to debuff 8 (Quỷ Kính). */
export function removeGhostMirror(target: StatusUnit): boolean {
  return isTanNguyetBoss(target) && target.effects.removeDebuff(target, MA_MOC.ghostMirrorDebuffId);
}

/** `reviveAtHalfHp`: once, to half its maximum; the HP it stands at, or 0 when it does not. */
export function reviveAtHalfHp(target: StatusUnit, alreadyRevived: boolean): number {
  if (!isTanNguyetBoss(target) || alreadyRevived || target.alive()) return 0;
  target.setHp(
    Math.max(0, Math.max(1, Math.trunc((target.maxHp() * MA_MOC.reviveHpPercent) / 100))),
  );
  return target.hp();
}
