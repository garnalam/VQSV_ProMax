import type { PackItem } from "../../../data/GameData";
import type { DesignTraitUnit } from "../DesignTraits";
import type { StatusEffects } from "../StatusState";

/**
 * The bag items a fight can use, read from `battle/items.json`: the four capture balls and the nine
 * recovery items. `values` preserves the native paramA/B/C; normalized percentage/target hints
 * in the same rows describe a different balance and must not override those native values.
 */
export type BattleItem =
  | { kind: "capture"; id: number; name: string; multiplier: number; guaranteed: boolean }
  | {
      kind: "recovery";
      id: number;
      name: string;
      mechanic: "restore_hp" | "restore_pp" | "restore_hp_pp" | "cleanse_status" | "revive";
      hpPercent: number;
      hpFlat: number;
      ppPercent: number;
      /** Native flat PP restored to every equipped skill; absent for legacy custom items. */
      ppFlat?: number;
      /** "one_skill", "pet_and_one_skill", "pet_and_all_skills", "fainted_pet" or "pet". */
      target: string;
    };

type ItemParameters = {
  values?: number[];
  capture_multiplier?: number;
  guaranteed?: boolean;
  hp_percent?: number;
  hp_flat?: number;
  pp_percent?: number;
  target?: string;
};

/** `effectParametersJson` is a JSON string quoted the CSV way ("" for "), as the export wrote it. */
function parameters(row: PackItem): ItemParameters {
  const raw = (row as unknown as { effectParametersJson?: string }).effectParametersJson ?? "";
  if (!raw) return {};
  const unquoted = raw.startsWith('"') ? raw.slice(1, -1).replace(/""/g, '"') : raw;
  return JSON.parse(unquoted) as ItemParameters;
}

const RECOVERY = ["restore_hp", "restore_pp", "restore_hp_pp", "cleanse_status", "revive"] as const;

export class BattleItems {
  private readonly byId = new Map<number, BattleItem>();

  constructor(rows: readonly PackItem[]) {
    for (const row of rows) {
      const p = parameters(row);
      if (row.category === "capture_ball" && row.mechanicKey === "capture") {
        this.byId.set(row.runtimeId, {
          kind: "capture",
          id: row.runtimeId,
          name: row.name,
          multiplier: p.capture_multiplier ?? 100,
          guaranteed: p.guaranteed === true,
        });
      } else if (
        row.category === "recovery" &&
        (RECOVERY as readonly string[]).includes(row.mechanicKey)
      ) {
        this.byId.set(row.runtimeId, {
          kind: "recovery",
          id: row.runtimeId,
          name: row.name,
          mechanic: row.mechanicKey as (typeof RECOVERY)[number],
          hpPercent: row.mechanicKey === "restore_pp" ? 0 : (p.values?.[0] ?? p.hp_percent ?? 0),
          hpFlat: row.mechanicKey === "restore_pp" ? 0 : (p.values?.[1] ?? p.hp_flat ?? 0),
          ppPercent: p.pp_percent ?? 0,
          ppFlat: p.values
            ? row.mechanicKey === "restore_pp"
              ? (p.values[0] ?? 0)
              : (p.values[2] ?? 0)
            : undefined,
          target: p.values
            ? row.mechanicKey === "revive"
              ? "fainted_pet"
              : "pet_and_all_skills"
            : (p.target ?? "pet"),
        });
      }
    }
  }

  get(id: number): BattleItem | undefined {
    return this.byId.get(id);
  }

  /**
   * Why `item` cannot be used on `unit` (a sentence for the player), or `undefined` when it can.
   * The rules are the items' own descriptions: living-only items refuse a fainted pet, revives refuse
   * a living one, and an item with nothing to restore is refused rather than wasted.
   */
  refusal(
    item: BattleItem,
    unit: DesignTraitUnit,
    skillSlot: number | undefined,
    ppMax: (skillId: number) => number,
  ): string | undefined {
    if (item.kind !== "recovery") return "Vật phẩm này không dùng cho Pet.";
    const alive = unit.alive();
    if (item.mechanic === "revive") return alive ? "Pet này chưa gục." : undefined;
    if (!alive) return "Pet đã gục.";
    const needsSlot =
      item.ppFlat === undefined &&
      (item.target === "one_skill" || item.target === "pet_and_one_skill");
    if (needsSlot) {
      const id = skillSlot === undefined ? undefined : unit.skillIds[skillSlot];
      if (id === undefined || id < 0) return "Chọn một Skill.";
    }
    const hpFull = unit.hp() >= unit.maxHp(),
      ppFull = (slot: number) => unit.skillPp[slot] >= ppMax(unit.skillIds[slot]),
      allPpFull = unit.skillIds.every((id, slot) => id < 0 || ppFull(slot));
    switch (item.mechanic) {
      case "restore_hp":
        return hpFull ? "HP đã đầy." : undefined;
      case "restore_pp":
        return (item.ppFlat === undefined ? ppFull(skillSlot!) : allPpFull)
          ? "PP đã đầy."
          : undefined;
      case "restore_hp_pp":
        if (needsSlot) return hpFull && ppFull(skillSlot!) ? "HP và PP đã đầy." : undefined;
        return hpFull && allPpFull ? "HP và PP đã đầy." : undefined;
      case "cleanse_status":
        return unit.activeDebuffCount() > 0 || unit.statuses.activeIds(2).length > 0
          ? undefined
          : "Không có trạng thái bất lợi.";
    }
  }

  /**
   * Apply a recovery item. `heal` is the fight's received-healing seam, so a talent that cuts healing
   * (TC-09) cuts an item too; a revive sets HP directly, because a fainted pet is not healed.
   */
  apply(
    item: BattleItem & { kind: "recovery" },
    unit: DesignTraitUnit,
    skillSlot: number | undefined,
    ppMax: (skillId: number) => number,
    heal: (amount: number) => number,
    effects: StatusEffects,
  ): { hpGained: number; ppGained: number; revived: boolean } {
    const before = unit.hp(),
      ppBefore = unit.skillPp.reduce((sum, pp) => sum + Math.max(0, pp), 0);
    const restorePp = (slot: number) => {
      const id = unit.skillIds[slot];
      if (id < 0) return;
      const max = ppMax(id);
      unit.skillPp[slot] = Math.min(
        max,
        unit.skillPp[slot] + Math.max(0, item.ppFlat ?? Math.trunc((max * item.ppPercent) / 100)),
      );
    };
    let revived = false;
    switch (item.mechanic) {
      case "revive":
        unit.setHp(Math.max(1, Math.trunc((unit.maxHp() * item.hpPercent) / 100) + item.hpFlat));
        revived = true;
        unit.skillIds.forEach((_, slot) => restorePp(slot));
        break;
      case "cleanse_status":
        effects.clearDebuffs(unit);
        break;
      default: {
        const hp = Math.trunc((unit.maxHp() * item.hpPercent) / 100) + item.hpFlat;
        if (hp > 0) unit.heal(heal(hp));
        if (item.ppFlat !== undefined || item.target === "pet_and_all_skills")
          unit.skillIds.forEach((_, slot) => restorePp(slot));
        else if (skillSlot !== undefined && item.ppPercent > 0) restorePp(skillSlot);
      }
    }
    const ppAfter = unit.skillPp.reduce((sum, pp) => sum + Math.max(0, pp), 0);
    return { hpGained: unit.hp() - before, ppGained: ppAfter - ppBefore, revived };
  }
}
