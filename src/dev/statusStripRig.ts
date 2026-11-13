import type { BattleSide } from "../game/battle/BattleDefinition";
import type { BattleRuntime } from "../game/battle/BattleRuntime";
import { StatusInstance } from "../game/battle/StatusState";

/**
 * One status the strip checkpoint puts on a unit, with both counters.
 *
 * The projector reads the turn counter for a `DURATION` status and the action counter for an
 * `ACTION`/`CHARGE` one, so a seed names both and the strip decides which one the numeral shows —
 * the same decision the source makes, and the same two counters `ProbeWebBattleMath` recorded in the
 * golden `presentation` rows.
 */
export type StatusStripSeed = {
  bank: number;
  numericId: number;
  turns: number;
  actions: number;
  /**
   * The magnitude the status holds, which is `StatusInstance`'s primary value. Only one entry needs
   * it: `Khiên`'s pool is what the health bar reads, so the checkpoint that shows the strip can show
   * the bar's blue segment on the same frame.
   */
  pool?: number;
};

/**
 * The two strips the `?statusStrip=1` checkpoint shows, and why each entry is in it.
 *
 * A tutorial fight never carries enough statuses to fill the HUD, so the projector's walk — the bank
 * order, the six-slot cap, the opening-pressure badge drawn ahead of every status, and the choice
 * between the two counters — has no live frame to be seen in. These seeds give it one, on both sides
 * at once, and they were chosen to put every branch of that walk on screen:
 *
 * - both Liệt Hỏa banks and the Cầu Vồng bank in one strip, so the round-robin that keeps one bank
 *   from starving another is visible rather than argued;
 * - the opening-pressure badge, which belongs to no bank and still takes the first slot;
 * - `Khiên`, a signature status above the Liệt Hỏa half of bank 0 that the source draws with another
 *   buff's picture on purpose, and whose pool is what puts a blue segment and a `+pool` field on the
 *   enemy's health bar in the same frame;
 * - `ACTION` statuses whose two counters deliberately differ from their turn count, so the numeral
 *   proves which counter the strip read;
 * - `Ngủ`, whose Cầu Vồng picture the source has no bytes for, so the slot must show its numeral
 *   with no icon — which is exactly what the Java battle draws;
 * - more statuses on the player's side than the six-slot cap holds, so the tail that never reaches
 *   the strip is something to look at rather than a claim.
 *
 * The seeds are dev input, not an answer: what each one must turn into is pinned in the test that
 * reads this table, against the projector the Java harvest grades.
 */
export const STATUS_STRIP_CHECKPOINT: Record<
  BattleSide,
  { held: StatusStripSeed[]; suppressionActions: number }
> = {
  player: {
    held: [
      { bank: 0, numericId: 4, turns: 10, actions: 0 },
      { bank: 0, numericId: 9, turns: 3, actions: 0 },
      { bank: 0, numericId: 12, turns: 5, actions: 4 },
      { bank: 1, numericId: 0, turns: 6, actions: 0 },
      { bank: 1, numericId: 8, turns: 7, actions: 2 },
      { bank: 2, numericId: 0, turns: 3, actions: 1 },
      { bank: 2, numericId: 3, turns: 5, actions: 0 },
    ],
    suppressionActions: 4,
  },
  enemy: {
    held: [
      { bank: 0, numericId: 0, turns: 9, actions: 7 },
      { bank: 0, numericId: 15, turns: 10, actions: 0, pool: 300 },
      { bank: 1, numericId: 6, turns: 2, actions: 0 },
      { bank: 1, numericId: 9, turns: 5, actions: 3 },
      { bank: 2, numericId: 5, turns: 4, actions: 0 },
      { bank: 2, numericId: 8, turns: 6, actions: 5 },
    ],
    suppressionActions: 0,
  },
};

/**
 * Put one checkpoint strip onto the unit this side fights with.
 *
 * The seeding is `StatusState.put` with the same eleven arguments the Java probe used to build the
 * units its golden rows measured, so the frame shows the HUD's own walk over a state the source could
 * have reached — it installs no rule and reorders nothing.
 */
export function plantStatusStrip(battle: BattleRuntime, side: BattleSide): void {
  const unit = battle.statusUnit(side);
  const rules = battle.rules;
  if (!unit || !rules) {
    throw new Error(`the status strip checkpoint needs an engine-scored battle on ${side}`);
  }
  const seed = STATUS_STRIP_CHECKPOINT[side];
  for (const held of seed.held) {
    const definition = rules.status.catalog.definition(held.bank, held.numericId);
    if (!definition) {
      throw new Error(
        `the status strip checkpoint plants ${held.bank}/${held.numericId}, which the catalog does not register`,
      );
    }
    unit.statuses.put(
      new StatusInstance(
        definition,
        held.turns,
        held.actions,
        held.pool ?? 0,
        0,
        1,
        unit.ownerSide,
        unit.formationSlot,
        -1,
        0,
      ),
    );
  }
  if (seed.suppressionActions > 0) unit.applyOpeningAttackSuppression(seed.suppressionActions);
}
