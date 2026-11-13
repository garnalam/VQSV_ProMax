import type { GameData, PackItem } from "../../data/GameData";

/**
 * `PetState.heldEquipmentId` when a pet holds nothing. `PetBattleAdapter` casts that value straight
 * into the form column, so -1 is also the form slot of an unequipped pet.
 */
export const NO_HELD_ITEM = -1;

/**
 * The raw table the engine reads a held item from. `VqsvBattleTables.heldItem(id)` is `row(3, id)`,
 * which is the same table `status(id)` reads — a held item is a row of the Liệt Hỏa effect table,
 * and `BattleUnit.hasSourceHeldItem(itemId)` is literally `hasFormStatus((byte) itemId)`.
 */
const HELD_ITEM_SOURCE_TABLE = 3;

/**
 * The raw column `effectParametersJson`'s `values` start at. The exporter wrote the row's columns
 * 3 and up into that array, so `values[index - 3]` is the column `param` is asked for.
 */
const FIRST_PARAM_COLUMN = 3;

/**
 * The item a pet holds into a battle, read from the shipped catalog.
 *
 * A held item is not a separate system: it is one byte in the unit's form column, and every effect
 * it has is a `param` read at the point in the battle where the engine reads it — the attack and
 * defense projections, the crit chance, the base attack, the incoming status chance, the post-damage
 * leech, the miss chance and the HP floor. This class owns only the reading; the callers own the
 * arithmetic, exactly as `BattleHeldItemRow` does in Java.
 *
 * Only the twelve ids the battle actually reads are effects at all. Ids 12 to 16 are crafting
 * materials and 17 is a chest: they are in the same table and their params are readable, but no
 * battle code asks for them.
 */
export class HeldItems {
  private constructor(private readonly rows: Map<number, readonly number[]>) {}

  static async load(data: GameData): Promise<HeldItems> {
    return HeldItems.from(await data.items());
  }

  /**
   * The held-item half of `battle/items.json`. The other four source tables in that file are badges,
   * consumables, special rewards and Cầu Vồng equipment, none of which a pet holds into a battle.
   */
  static from(items: readonly PackItem[]): HeldItems {
    const rows = new Map<number, readonly number[]>();
    for (const item of items) {
      if (item.sourceTable !== HELD_ITEM_SOURCE_TABLE) continue;
      if (rows.has(item.runtimeId)) {
        throw new Error(`battle/items.json carries held item ${item.runtimeId} twice`);
      }
      rows.set(item.runtimeId, effectValues(item));
    }
    return new HeldItems(rows);
  }

  /** Every held-item id the catalog carries, ascending — the row indexes of raw table 3. */
  ids(): number[] {
    return [...this.rows.keys()].sort((a, b) => a - b);
  }

  /**
   * `BattleHeldItemRow.param` through `BattleUnit.heldItemParam`: one raw column, or the fallback
   * where the row does not reach that far or does not exist at all.
   */
  param(itemId: number, index: number, fallback: number): number {
    const values = this.rows.get(itemId);
    if (!values) return fallback;
    const column = values[index - FIRST_PARAM_COLUMN];
    return column === undefined ? fallback : column;
  }

  /** `BattleUnit.hasSourceHeldItem`: the form column equals the id, with no "nothing held" case. */
  holds(heldItemId: number, itemId: number): boolean {
    return heldItemId === itemId;
  }

  /**
   * `BattleUnit.projectIncomingStatusChanceForHeldItem`: item 3 takes a percent off any status chance
   * aimed at its holder, applied multiplicatively before the trait resistance points that are a later
   * slice. The clamp runs first, so a producer chance above 100 is reduced from 100 and not from
   * itself — and a reduction that brings the chance to 100 or above still costs no random draw.
   */
  projectIncomingStatusChance(heldItemId: number, chancePercent: number): number {
    const chance = Math.max(0, Math.min(100, chancePercent));
    if (!this.holds(heldItemId, 3)) return chance;
    const reduction = Math.max(0, Math.min(100, this.param(3, 5, 0)));
    return Math.trunc((chance * (100 - reduction)) / 100);
  }

  /**
   * `VqsvBattleRuntime`'s P8 block: Mật Phong Sào's multiplier is read only off a pet that holds it,
   * and `BattleOutcomeEngine.expAward` is handed `heldItem5` beside it so the two cannot disagree.
   */
  experienceMultiplier(heldItemId: number): number {
    return this.holds(heldItemId, 5) ? this.param(5, 5, 0) : 0;
  }

  /** `VqsvBattleRuntime.catchInput`: Sủng vật lôi đạt's capture bonus, same gate as above. */
  captureRateBonus(heldItemId: number): number {
    return this.holds(heldItemId, 11) ? this.param(11, 5, 0) : 0;
  }
}

/**
 * The `values` array of one item's `effectParametersJson`. The exporter stored that JSON the way the
 * source TSV spelled it — wrapped in quotes of its own and with every inner quote doubled — so it is
 * unescaped before it is parsed.
 */
export function effectValues(item: PackItem): readonly number[] {
  const text = item.effectParametersJson.trim();
  const unescaped = (
    text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text
  ).replaceAll('""', '"');
  let parsed: unknown;
  try {
    parsed = JSON.parse(unescaped);
  } catch (error) {
    throw new Error(
      `held item ${item.runtimeId} (${item.stableKey}) has effect parameters this port cannot read`,
      { cause: error },
    );
  }
  const values = (parsed as { values?: unknown }).values;
  if (!Array.isArray(values) || values.some((value) => typeof value !== "number")) {
    throw new Error(`held item ${item.runtimeId} (${item.stableKey}) has no numeric values`);
  }
  return values as readonly number[];
}
