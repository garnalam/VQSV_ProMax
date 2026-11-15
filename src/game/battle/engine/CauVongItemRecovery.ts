import type { DesignTraitUnit } from "../DesignTraits";
import type { BattleItem } from "./BattleItems";

/** `vg_CauVongItemRecovery_apply`: one free recovery after the player's own item succeeds. */
export function applyCauVongItemRecovery(
  context: { sceneId?: number; capturePolicy?: string; pvp?: boolean },
  item: BattleItem,
  active: readonly DesignTraitUnit[],
  reserves: readonly DesignTraitUnit[],
  ppMax: (skillId: number) => number,
): { target: DesignTraitUnit; hpGained: number; ppGained: number; revived: false } | undefined {
  if (
    context.sceneId !== 98 ||
    context.capturePolicy !== "TRAINER_OWNED_FORBIDDEN" ||
    context.pvp ||
    item.kind !== "recovery" ||
    item.mechanic === "cleanse_status"
  )
    return;
  const healsHp = item.mechanic !== "restore_pp" && (item.hpPercent > 0 || item.hpFlat > 0);
  const ppAmount = item.ppFlat ?? 0;
  const totalPp = (unit: DesignTraitUnit, maximum = false) =>
    unit.skillIds.reduce((sum, id, slot) => {
      if (id < 0) return sum;
      const max = Math.max(0, ppMax(id));
      return sum + (maximum ? max : Math.min(max, Math.max(0, unit.skillPp[slot])));
    }, 0);
  const needsHp = (unit: DesignTraitUnit) => healsHp && unit.hp() < unit.maxHp();
  const weakest = (units: readonly DesignTraitUnit[]) => {
    let chosen: DesignTraitUnit | undefined;
    for (const unit of units) {
      if (unit.ownerSide !== 1 || !unit.alive()) continue;
      const hp = needsHp(unit);
      if (!hp && !(ppAmount > 0 && totalPp(unit) < totalPp(unit, true))) continue;
      if (
        !chosen ||
        (hp && !needsHp(chosen)) ||
        (hp === needsHp(chosen) &&
          (hp
            ? unit.hp() * chosen.maxHp() < chosen.hp() * unit.maxHp()
            : totalPp(unit) * totalPp(chosen, true) < totalPp(chosen) * totalPp(unit, true)))
      )
        chosen = unit;
    }
    return chosen;
  };
  const target = weakest(active) ?? weakest(reserves);
  if (!target) return;
  const hpBefore = target.hp(),
    ppBefore = totalPp(target);
  if (healsHp)
    target.heal(Math.max(0, Math.trunc((target.maxHp() * item.hpPercent) / 100) + item.hpFlat));
  if (ppAmount > 0)
    target.skillIds.forEach((id, slot) => {
      if (id >= 0) target.skillPp[slot] = Math.min(ppMax(id), target.skillPp[slot] + ppAmount);
    });
  return {
    target,
    hpGained: target.hp() - hpBefore,
    ppGained: totalPp(target) - ppBefore,
    revived: false,
  };
}
