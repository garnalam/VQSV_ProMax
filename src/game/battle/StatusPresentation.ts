import type {
  PackStatusDurationBadge,
  PackStatusIdentity,
  PackStatusPresentation,
} from "../../data/GameData";
import { type StatusUnit } from "./StatusState";

/**
 * One visible strip slot: what the battle HUD draws for one status, or for the opening pressure a
 * characteristic owns. `BattleStatusPresentation` is the source, and the golden `presentation` rows
 * carry the same fields, so a projected strip can be compared to Java's answer field for field.
 */
export type StatusPresentationSlot = {
  sourceBank: number;
  sourceNumericId: number;
  stableKey: string;
  displayName: string;
  iconKind: string;
  lietHoaAtlasCell: number;
  resourcePath: string;
  remainingDuration: number;
  actionOwned: boolean;
};

/**
 * `BattleStatusPresentationProjector`: the six slots the battle HUD puts beside one combatant.
 *
 * Which picture and which name a status shows as is harvested into the pack, because only that one
 * Java method says it — a buff is cell `id + 12` of the Liệt Hỏa sheet, a debuff `id + 1`, and the
 * signature identities above the Liệt Hỏa half of bank 0 deliberately reuse another buff's artwork.
 * What lives here is the walk around that table: the bank order, the round-robin that keeps one bank
 * from starving another under the cap, the badge a characteristic draws without owning a status, and
 * which of an instance's two counters the duration reads.
 *
 * `golden-status-presentation.json`'s `presentation` and `copy` sections are the Java projector walking
 * this same order over seeded units, and its `durationCells` section is `VqsvBattleRenderer.durationCell`
 * sampled over every duration it can be handed.
 */
export class StatusPresentationProjector {
  /** The harvested identities by `bank:id`; an id with no row is one the projector refuses. */
  private readonly identities = new Map<string, PackStatusIdentity>();

  constructor(private readonly table: PackStatusPresentation) {
    for (const row of table.rows) {
      this.identities.set(sourceKey(row.sourceBank, row.sourceNumericId), row);
    }
  }

  /** `BattleStatusPresentationProjector.MAX_VISIBLE`, read off the harvest rather than restated here. */
  get maxVisible(): number {
    return this.table.maxVisible;
  }

  /**
   * `BattleStatusPresentationProjector.project`.
   *
   * The slot limit is spent in the order Java spends it: the opening-pressure badge first if the unit
   * carries any, then rank by rank across the banks, so a unit holding five buffs and three debuffs
   * shows three of each rather than five buffs and a blank.
   */
  project(unit: StatusUnit): StatusPresentationSlot[] {
    const active = this.table.bankOrder.map((bank) => unit.activeStatusIds(bank));
    const out: StatusPresentationSlot[] = [];

    const suppressionActions = unit.openingAttackSuppressionActions();
    if (suppressionActions > 0) {
      // Reuse the native "Nhụt Chí" attack-down artwork while keeping its own identity and the exact
      // number of actions left, which is what the source does and what the harvest records.
      out.push(slot(this.table.openingSuppression, true, suppressionActions));
    }

    for (let rank = 0; out.length < this.table.maxVisible; rank++) {
      let found = false;
      for (
        let index = 0;
        index < this.table.bankOrder.length && out.length < this.table.maxVisible;
        index++
      ) {
        if (rank >= active[index].length) continue;
        found = true;
        const bank = this.table.bankOrder[index];
        const numericId = active[index][rank];
        const identity = this.identities.get(sourceKey(bank, numericId));
        // A refused identity still spends its turn at the table, exactly as it does in the source.
        if (!identity || !identity.visible) continue;
        const instance = unit.statuses.get(bank, numericId);
        if (!instance) continue;
        const actionOwned =
          instance.remainingActions > 0 &&
          (instance.definition.consumePolicy === "ACTION" ||
            instance.definition.consumePolicy === "CHARGE");
        out.push(
          slot(
            identity,
            actionOwned,
            actionOwned ? instance.remainingActions : instance.remainingTurns,
          ),
        );
      }
      if (!found) break;
    }
    return out;
  }

  /**
   * `VqsvBattleRenderer.durationCell`, read off the sampled mapping: the numeral badge over one slot.
   * The bake proves the mapping has already flattened at both ends, so clamping a duration into the
   * sampled range is the same answer the renderer gives.
   */
  durationBadgeCell(duration: number): number {
    return durationBadgeCell(this.table.durationBadge, duration);
  }
}

/** The source cell for one duration, looked up in the harvested badge mapping. */
export function durationBadgeCell(badge: PackStatusDurationBadge, duration: number): number {
  const clamped = Math.max(badge.sampleMin, Math.min(duration, badge.sampleMax));
  const row = badge.cells.find((cell) => cell.duration === clamped);
  if (!row) {
    throw new Error(`the harvested duration badge has no cell for ${clamped}`);
  }
  return row.cell;
}

function sourceKey(bank: number, numericId: number): string {
  return `${bank}:${numericId}`;
}

/** One harvested identity plus the duration this particular unit has left on it. */
function slot(
  identity: PackStatusIdentity,
  actionOwned: boolean,
  remainingDuration: number,
): StatusPresentationSlot {
  return {
    sourceBank: identity.sourceBank,
    sourceNumericId: identity.sourceNumericId,
    stableKey: identity.stableKey ?? "",
    displayName: identity.displayName ?? "",
    iconKind: identity.iconKind ?? "LIET_HOA_ATLAS",
    lietHoaAtlasCell: identity.lietHoaAtlasCell ?? -1,
    resourcePath: identity.resourcePath ?? "",
    // `BattleStatusPresentation`'s own constructor clamps the counter it is handed at zero.
    remainingDuration: Math.max(0, remainingDuration),
    actionOwned,
  };
}
