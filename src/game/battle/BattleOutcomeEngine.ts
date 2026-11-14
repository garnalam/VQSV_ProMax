/**
 * The battle's outcome decisions, ported from `vqsv.battle.BattleOutcomeEngine`.
 *
 * Every function is pure and the arithmetic is Java's: `int` division truncates toward zero, so each
 * `/` below is a `Math.trunc`, and the operand order matters because Java truncates after every step
 * rather than once at the end — `chance * itemParamA / 100` is not `chance * (itemParamA / 100)`.
 *
 * Three held items act here rather than in the damage formula: Mật Phong Sào (5) multiplies the EXP a
 * participant earns, Ký Cư Giải Xác (6) is the only thing that shares EXP with the reserve, and Sủng
 * vật lôi đạt (11) multiplies a capture chance. The capture ball's own `paramA` is the other half of
 * the chance and comes from `golden-catch.json`'s `itemTable`.
 *
 * `golden-exp.json`, `golden-catch.json` and the `outcome` / `evolution` sections of
 * `golden-flow.json` are the Java engine's answers over a full input grid, and
 * `BattleOutcomeEngine.test.ts` grades every row, so a reordered operand fails a test instead of
 * reaching the player. Two of those grids walk the multiplier each item's own catalog row carries, so
 * the column read and the formula are graded on the number the shipped game supplies, not only on the
 * synthetic ones around it.
 *
 * One member of the Java class is deliberately absent: `expDisplayEligible` is the only one no golden
 * row asks about, and nothing in this port shows an EXP bar yet. It arrives with the post-battle flow
 * that needs it, refereed then.
 */

/** `BattleOutcomeEngine.CatchStorageOutcome`. */
export type CatchStorageOutcome = "ROSTER" | "BANK" | "RELEASE";

/** `BattleOutcomeEngine.CatchOpenBoxOutcome`. */
export type CatchOpenBoxOutcome = "WAIT" | "SHOW_BANK_NOTICE" | "COMPLETE";

/** `BattleOutcomeEngine.CatchFailureOutcome`. */
export type CatchFailureOutcome = "QUEUE_BUNNY_RETRY" | "RETURN_DISPATCH";

/** `BattleOutcomeEngine.ReserveShareOutcome`. */
export type ReserveShareOutcome = "SKIP" | "SHARE";

/** `BattleOutcomeEngine.ExpCompletionOutcome`. */
export type ExpCompletionOutcome = "OPEN_SKILL_LEARN" | "LEVEL_AGAIN" | "FINISH_PET";

/** `BattleOutcomeEngine.LoseOutcome`. */
export type LoseOutcome = "SHOW_REVIVE_PROMPT" | "RESET_TO_WORLD";

/** `BattleOutcomeEngine.LoseReviveOutcome`. */
export type LoseReviveOutcome = "FALLBACK_TO_WORLD" | "REVIVE" | "SHOW_INSUFFICIENT";

/**
 * `BattleOutcomeEngine.CatchInput`, in the constructor's own parameter order, which is also the order
 * the probe wrote each golden row's `input` array in.
 *
 * `status` is not an input: Java derives it from the four booleans below, in a fixed precedence.
 */
export type CatchInput = {
  itemId: number;
  /** The ball's own `paramA` from the item table; a missing row reads 100, as the runtime does. */
  itemParamA: number;
  enemyHp: number;
  enemyMaxHp: number;
  enemyNature: number;
  targetDebuff1: boolean;
  targetDebuff2: boolean;
  targetDebuff10: boolean;
  /** Sủng vật lôi đạt (held item 11) on the capturing side. */
  attackerHeldItem11: boolean;
  /** That item's column 5, read only when the pet holds it. */
  heldItem11Bonus: number;
  captureBonusPoints: number;
  /**
   * Web rules: Sủng vật lôi đạt adds its 20% once, on top of whatever status bonus the target's
   * debuffs give. Java also counts the item as the strongest status, which replaces a Tê Liệt or
   * sleep bonus and multiplies a second time (+44% in all). Omitted, the Java answer stands.
   */
  web?: boolean;
  enemyRelationClass: number;
  enemyLevel: number;
  roll: number;
  forceFail: boolean;
};

export type CatchResult = { chance: number; caught: boolean };

export type CatchStorageInput = {
  rosterSize: number;
  bankSize: number;
  /** Java's two-argument constructor leaves this at the default below. */
  bankCapacity?: number;
};

export type CatchStorageResult = { outcome: CatchStorageOutcome; sourceResult: number };

export type ExpEligibilityInput = {
  enemyPresent: boolean;
  enemyHp: number;
  playerPresent: boolean;
  playerUnitPresent: boolean;
  bunnyCapture: boolean;
};

/**
 * `BattleOutcomeEngine.ExpAwardInput`. `divisor` is 1000 in the runtime's own call and the reserve
 * share's; the grid varies it so the truncation point is graded rather than assumed.
 */
export type ExpAwardInput = {
  enemyLevel: number;
  enemyNature: number;
  levelFactorLevel: number;
  participantCount: number;
  divisor: number;
  /** Mật Phong Sào (held item 5) on this participant. */
  heldItem5: boolean;
  /** That item's column 5, read only when the pet holds it. */
  heldItem5Multiplier: number;
  experienceMultiplierPercent: number;
  experienceMultiplierStackable: boolean;
};

export type ReserveShareInput = {
  /** Retained for older callers. New saves supply the actual golden percentage. */
  globalShare: boolean;
  goldenSharePercent?: number;
  heldItem6: boolean;
};

export type ReserveShareResult = { outcome: ReserveShareOutcome; divisor: number; percent: number };

export type EvolutionInput = {
  currentValid: boolean;
  targetValid: boolean;
  targetSpeciesId: number;
  targetKind: number;
  currentLevel: number;
  materialNeed: number;
  materialCount: number;
};

export type EvolutionResult = {
  eligible: boolean;
  sourceKind: number;
  requiredLevel: number;
  materialEnough: boolean;
};

export type LoseReviveInput = {
  cancelled: boolean;
  insufficientPhase: boolean;
  money: number;
  cost: number;
};

/** `CatchStorageInput`'s bank ceiling, the two-argument Java constructor's default. */
export const DEFAULT_BANK_CAPACITY = 100;

/** `BattleOutcomeEngine.calculateCatchChance`'s HP bands, read against the enemy's max HP. */
const CATCH_HP_BANDS: readonly { percent: number; chance: number }[] = [
  { percent: 15, chance: 85 },
  { percent: 50, chance: 45 },
  { percent: 100, chance: 20 },
];

/** One column per pet quality, addressed as `nature - 1` and clamped into the array. */
const CATCH_QUALITY_FACTOR: readonly number[] = [110, 100, 95, 80, 70];

/**
 * The status that helps a capture, in Java's precedence: each `if` overwrites the last, so Sủng vật
 * lôi đạt beats a paralysis the enemy is already carrying.
 */
const CATCH_STATUS_MULTIPLIER: readonly number[] = [10, 11, 12, 12, 12];

/** The enemy's relation to the player's team, per thousand. */
const CATCH_RELATION_FACTOR: readonly number[] = [1000, 500, 1, 1000];

/** Above this enemy level a ball's chance is capped, by ball id. */
const CATCH_CAP_LEVEL = 20;
const CATCH_CAPS: readonly number[] = [0, 15, 35, 65];

/** `expAward`'s three factor tables, addressed as `quality - 1`, `count - 1` and the level gap. */
const EXP_QUALITY_FACTOR: readonly number[] = [10, 11, 12, 13, 15];
const EXP_COUNT_FACTOR: readonly number[] = [10, 12, 13, 14, 15, 16];
const EXP_LEVEL_FACTORS: readonly number[] = [105, 100, 80, 60, 40, 20, 5];

/** `Integer.MAX_VALUE`, which `decideEvolution` answers for a kind it does not recognise. */
const JAVA_INT_MAX = 2147483647;

/** Java's own truncating `int` division, so every operand order below reads exactly as written. */
function divide(numerator: number, denominator: number): number {
  return Math.trunc(numerator / denominator);
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/** `BattleOutcomeEngine.decideCatch`: the chance, then the one draw that spends it. */
export function decideCatch(input: CatchInput): CatchResult {
  const chance = calculateCatchChance(input);
  return { chance, caught: !input.forceFail && input.roll < chance };
}

/**
 * `BattleOutcomeEngine.calculateCatchChance`.
 *
 * Tất Trung Cầu (item 0) answers 100 before anything else is read, which is why the grid pins it
 * against every HP band, quality and relation class.
 */
export function calculateCatchChance(input: CatchInput): number {
  if (input.itemId === 0) return 100;
  let chance = 1;
  for (const band of CATCH_HP_BANDS) {
    if (input.enemyHp <= divide(input.enemyMaxHp * band.percent, 100)) {
      chance = band.chance;
      break;
    }
  }
  chance = divide(chance * input.itemParamA, 100);
  chance = divide(chance * CATCH_QUALITY_FACTOR[clamp(input.enemyNature - 1, 0, 4)], 100);
  let status = 0;
  if (input.targetDebuff1) status = 1;
  if (input.targetDebuff2) status = 2;
  if (input.targetDebuff10) status = 3;
  if (input.attackerHeldItem11 && !input.web) status = 4;
  chance = divide(chance * CATCH_STATUS_MULTIPLIER[status], 10);
  if (input.attackerHeldItem11) chance = divide(chance * (100 + input.heldItem11Bonus), 100);
  chance = divide(chance * CATCH_RELATION_FACTOR[clamp(input.enemyRelationClass, 0, 3)], 1000);
  if (input.enemyLevel >= CATCH_CAP_LEVEL) {
    const cap = CATCH_CAPS[clamp(input.itemId, 0, CATCH_CAPS.length - 1)];
    if (chance >= cap) chance = cap;
  }
  chance += Math.max(0, input.captureBonusPoints);
  return Math.max(1, Math.min(100, chance));
}

/** `BattleOutcomeEngine.decideCatchStorage`: the roster fills first, then the bank, then the pet goes. */
export function decideCatchStorage(input: CatchStorageInput): CatchStorageResult {
  if (input.rosterSize < 6) return { outcome: "ROSTER", sourceResult: 0 };
  const capacity = Math.max(0, input.bankCapacity ?? DEFAULT_BANK_CAPACITY);
  if (input.bankSize < capacity) return { outcome: "BANK", sourceResult: 1 };
  return { outcome: "RELEASE", sourceResult: 2 };
}

/** `BattleOutcomeEngine.decideCatchOpenBox`: the story state the catch animation ends on. */
export function decideCatchOpenBox(state: number): CatchOpenBoxOutcome {
  if (state === 2) return "SHOW_BANK_NOTICE";
  if (state === 1 || state === 4) return "COMPLETE";
  return "WAIT";
}

/** `BattleOutcomeEngine.decideCatchFailure`: only the tutorial bunny fight requeues a throw. */
export function decideCatchFailure(bunnyForceFail: boolean): CatchFailureOutcome {
  return bunnyForceFail ? "QUEUE_BUNNY_RETRY" : "RETURN_DISPATCH";
}

/** `BattleOutcomeEngine.winResultIndex(boolean, int)`. */
export function winResultIndex(bunnyCapture: boolean, forcedResultIndex: number): number {
  return bunnyCapture ? forcedResultIndex : 0;
}

/** `BattleOutcomeEngine.winResultIndex(boolean, int, boolean, int)`: a catch outranks the win branch. */
export function winResultIndexWithCapture(input: {
  bunnyCapture: boolean;
  forcedResultIndex: number;
  catchSucceeded: boolean;
  captureSuccessResultIndex: number;
}): number {
  if (input.captureSuccessResultIndex >= 0 && input.catchSucceeded)
    return input.captureSuccessResultIndex;
  return winResultIndex(input.bunnyCapture, input.forcedResultIndex);
}

/** `BattleOutcomeEngine.loseResultIndex(int)`. */
export function loseResultIndex(forcedResultIndex: number): number {
  return Math.max(0, forcedResultIndex);
}

/** `BattleOutcomeEngine.loseResultIndex(int, int)`: an authored defeat branch outranks the forced one. */
export function loseResultIndexWithDefeat(
  forcedResultIndex: number,
  playerDefeatResultIndex: number,
): number {
  return playerDefeatResultIndex >= 0
    ? playerDefeatResultIndex
    : loseResultIndex(forcedResultIndex);
}

/** `BattleOutcomeEngine.expEligible`: only a finished enemy in a fight that was not a capture pays. */
export function expEligible(input: ExpEligibilityInput): boolean {
  return (
    input.enemyPresent &&
    input.enemyHp <= 0 &&
    input.playerPresent &&
    input.playerUnitPresent &&
    !input.bunnyCapture
  );
}

/**
 * `BattleOutcomeEngine.expAward`.
 *
 * The trait multiplier and the item multiplier compose in one of two ways, and which one is the
 * trait's own `stackable` flag: a stackable trait multiplies on top of the item, while a
 * non-stackable one at or above 100% replaces it, taking whichever of the two is larger.
 */
export function expAward(input: ExpAwardInput): number {
  const enemyLevel = Math.max(1, input.enemyLevel);
  const quality = clamp(input.enemyNature, 1, 5);
  const base =
    divide(((enemyLevel << 1) * enemyLevel + 50) * EXP_QUALITY_FACTOR[quality - 1], 10) + 400;
  const diff = Math.max(1, input.levelFactorLevel) - enemyLevel;
  const levelFactor =
    diff >= 6
      ? EXP_LEVEL_FACTORS[6]
      : diff > 0
        ? EXP_LEVEL_FACTORS[diff]
        : diff === 0
          ? EXP_LEVEL_FACTORS[1]
          : EXP_LEVEL_FACTORS[0];
  const count = clamp(input.participantCount, 1, 6);
  const award = Math.max(
    0,
    divide(
      divide(base, count) * EXP_COUNT_FACTOR[count - 1] * levelFactor,
      Math.max(1, input.divisor),
    ),
  );
  const itemPercent = input.heldItem5 ? Math.max(0, input.heldItem5Multiplier + 100) : 100;
  const traitPercent = Math.max(0, input.experienceMultiplierPercent);
  let projected: number;
  if (!input.experienceMultiplierStackable && traitPercent >= 100) {
    projected = divide(award * Math.max(itemPercent, traitPercent), 100);
  } else {
    projected = divide(divide(award * itemPercent, 100) * traitPercent, 100);
  }
  return projected > JAVA_INT_MAX ? JAVA_INT_MAX : projected;
}

/**
 * `BattleOutcomeEngine.decideReserveShare`: item 6 keeps its whole share; Hoàng Kim gives 30%.
 */
export function decideReserveShare(input: ReserveShareInput): ReserveShareResult {
  const percent = input.heldItem6 ? 100 : clamp(input.goldenSharePercent ?? 0, 0, 100);
  if (percent > 0) return { outcome: "SHARE", divisor: 1000, percent };
  return { outcome: "SKIP", divisor: 0, percent: 0 };
}

/** Percentage is applied after the normal EXP award, preserving the source's truncation order. */
export function reserveExpAward(input: ExpAwardInput, share: ReserveShareResult): number {
  return share.outcome === "SKIP" ? 0 : Math.trunc(expAward(input) * share.percent / 100);
}

/** `BattleOutcomeEngine.decideExpCompletion`: learning a skill outranks levelling again. */
export function decideExpCompletion(
  hasLearnSkills: boolean,
  canLevelAgain: boolean,
): ExpCompletionOutcome {
  if (hasLearnSkills) return "OPEN_SKILL_LEARN";
  if (canLevelAgain) return "LEVEL_AGAIN";
  return "FINISH_PET";
}

/** `BattleOutcomeEngine.passiveHealAmount`. */
export function passiveHealAmount(baseHp: number, percent: number): number {
  return Math.max(0, divide(baseHp * percent, 100));
}

/**
 * `BattleOutcomeEngine.decideEvolution`. `targetKind` 1 and 2 are the same source kind and differ
 * only in the level they ask for; an unrecognised kind answers `Integer.MAX_VALUE`, which no pet
 * reaches, so it is refused by the level test rather than by an explicit one.
 */
export function decideEvolution(input: EvolutionInput): EvolutionResult {
  const kind =
    input.targetKind === 1 || input.targetKind === 2 ? 1 : input.targetKind === 3 ? 2 : 0;
  const required =
    input.targetKind === 1
      ? 12
      : input.targetKind === 2
        ? 30
        : input.targetKind === 3
          ? 5
          : JAVA_INT_MAX;
  const eligible =
    input.currentValid &&
    input.targetValid &&
    input.targetSpeciesId >= 0 &&
    kind > 0 &&
    input.currentLevel >= required;
  return {
    eligible,
    sourceKind: kind,
    requiredLevel: required,
    materialEnough: input.materialNeed <= 0 || input.materialCount >= input.materialNeed,
  };
}

/** `BattleOutcomeEngine.decideLose`. */
export function decideLose(reviveArmed: boolean): LoseOutcome {
  return reviveArmed ? "SHOW_REVIVE_PROMPT" : "RESET_TO_WORLD";
}

/** `BattleOutcomeEngine.decideLoseRevive`: leaving the prompt early beats the money test. */
export function decideLoseRevive(input: LoseReviveInput): LoseReviveOutcome {
  if (input.cancelled || input.insufficientPhase) return "FALLBACK_TO_WORLD";
  return input.money >= input.cost ? "REVIVE" : "SHOW_INSUFFICIENT";
}
