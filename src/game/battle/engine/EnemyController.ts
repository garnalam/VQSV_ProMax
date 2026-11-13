import type { BattleRules } from "../BattleRules";
import type { DesignTraitUnit } from "../DesignTraits";
import type { BattleCommand, BattleEvent } from "./BattleTypes";

/** What a controller may see when it picks for the enemy: its own party and the foe standing opposite. */
export type EnemyView = {
  round: number;
  party: readonly DesignTraitUnit[];
  active: number;
  foe: DesignTraitUnit;
  /** The foe's index in the player's party. */
  foeMember: number;
  /** A pet's level, by side and party index. */
  level: (side: "player" | "enemy", member: number) => number;
  /** Whether switching is allowed right now (Giam Cầm and friends say no). */
  maySwitch: boolean;
  roll: (label: string) => number;
  /**
   * `VqsvSourceRandom.a(label, bound)`: one draw on the fight's own stream over an arbitrary bound.
   * A bot's jitter band is wider or narrower than a percent (`2 * randomness + 1`), so it needs the
   * raw draw, not `roll` scaled — a scaled draw would skip values and drift from the reference stream.
   */
  next: (label: string, bound: number) => number;
};

/**
 * Who decides for the enemy. The core asks at the start of every round and whenever an enemy pet has
 * to be replaced; it validates the answer like a player's, so a controller cannot cheat a rule.
 *
 * `BasicEnemyAi` is the default. The ported AI v2 (`ai/`) plugs in here too: it reviews a production
 * decision and may replace it, so it wraps a controller like this one rather than replacing the seam.
 */
export interface EnemyController {
  command(view: EnemyView): BattleCommand;
  /** Every event the fight produced, as it produces them: what the controller is allowed to remember. */
  observe?(events: readonly BattleEvent[], round: number): void;
  /** The party member to send in after a faint or a pivot; only living reserves are offered. */
  replacement(view: EnemyView, choices: readonly number[]): number;
}

/**
 * A plain, legal-by-construction opponent:
 * - below 35% HP, a healing skill of its own if it has one;
 * - otherwise the usable damaging skill with the most Power (ties broken by the fight's own roll);
 * - a skill with no damage (a buff, a shield, a status) when that is all it has.
 * It never switches by choice and replaces a fainted pet with the first living reserve.
 */
export class BasicEnemyAi implements EnemyController {
  constructor(private readonly rules: BattleRules) {}

  command(view: EnemyView): BattleCommand {
    const unit = view.party[view.active],
      usable = unit.skillIds.flatMap((id, slot) => {
        if (id <= 0 || unit.skillPp[slot] <= 0) return [];
        const row = this.rules.damage.skillRow(id);
        if (!row || (this.rules.web && !this.rules.web.skillUsable(row, unit))) return [];
        return [{ slot, row }];
      });
    if (usable.length === 0) return { kind: "skill", slot: 0 };
    const low = unit.hp() * 100 < unit.maxHp() * 35,
      heals = usable.filter(
        ({ row }) => row.powerPercent === 0 && row.targetSide === 1 && /HEAL/.test(row.stableKey),
      );
    if (low && heals.length > 0) return { kind: "skill", slot: heals[0].slot };
    const damaging = usable.filter(({ row }) => row.powerPercent > 0),
      pool = damaging.length > 0 ? damaging : usable,
      best = Math.max(...pool.map(({ row }) => row.powerPercent)),
      top = pool.filter(({ row }) => row.powerPercent === best),
      pick =
        top[Math.min(top.length - 1, Math.floor((view.roll("ai.basic.tie") * top.length) / 100))];
    return { kind: "skill", slot: pick.slot };
  }

  replacement(_view: EnemyView, choices: readonly number[]): number {
    return choices[0];
  }
}
