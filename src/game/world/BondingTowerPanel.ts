import type { InputCommand } from "../../core/input/GameCommand";
import { contains, type Rect } from "../battle/BattleListLayout";
import { HEART_FRAGMENTS, TOWER_BOND_LIMIT } from "../meta/BondingTower";

export type TowerPanelFloor = {
  floor: number;
  level: number;
  quality: number;
  double: boolean;
  boss: boolean;
  team: readonly { id: number; name: string }[];
  status: "locked" | "first" | "reward" | "practice";
  factors?: readonly number[];
};

export type TowerPanelPet = {
  index: number;
  name: string;
  level: number;
  quality: number;
  bond: number;
  visualId?: number;
};

type TowerSweepView = {
  used: number;
  limit: number;
  nextCost: number | null;
  group?: { start: number; end: number; count: number };
  canSweep: boolean;
  detail: string;
};

export type TowerPanelView = {
  highest: number;
  hearts: number;
  fragments: number;
  floors: readonly TowerPanelFloor[];
  pets: readonly TowerPanelPet[];
  sweep: TowerSweepView;
  last?: string;
};

export type TowerPanelSource = {
  view: () => TowerPanelView | undefined;
  challenge: (floor: number) => string | null;
  craft: (count: number) => string | null;
  nurture: (index: number, count: number) => string | null;
  sweep: () => string | null;
};

type SweepQuote = NonNullable<TowerSweepView["group"]> & { used: number; cost: number };
type Tab = "floors" | "craft" | "nurture" | "sweep";

export const TOWER_TABS: readonly { tab: Tab; label: string; rect: Rect }[] = [
  { tab: "floors", label: "Khiêu chiến", rect: { x: 13, y: 69, w: 57, h: 22 } },
  { tab: "craft", label: "Ghép tim", rect: { x: 72, y: 69, w: 47, h: 22 } },
  { tab: "nurture", label: "Bồi dưỡng", rect: { x: 121, y: 69, w: 55, h: 22 } },
  { tab: "sweep", label: "Quét tầng", rect: { x: 178, y: 69, w: 49, h: 22 } },
];

export const TOWER_FLOORS_PER_PAGE = 5;
export const TOWER_PETS_PER_PAGE = 6;
export const TOWER_LAYOUT = {
  close: { x: 205, y: 19, w: 22, h: 25 },
  previous: { x: 13, y: 97, w: 22, h: 19 },
  next: { x: 87, y: 97, w: 22, h: 19 },
  floorRow: (slot: number) => ({ x: 13, y: 120 + slot * 21, w: 96, h: 19 }),
  petRow: (slot: number) => ({ x: 13, y: 107 + slot * 22, w: 214, h: 20 }),
  action: { x: 13, y: 291, w: 115, h: 23 },
  back: { x: 145, y: 291, w: 82, h: 23 },
  craft: [
    { x: 13, y: 291, w: 103, h: 23 },
    { x: 121, y: 291, w: 106, h: 23 },
  ],
  nurture: [
    { x: 13, y: 291, w: 65, h: 23 },
    { x: 82, y: 291, w: 65, h: 23 },
    { x: 151, y: 291, w: 76, h: 23 },
  ],
} as const;

function clampIndex(index: number, count: number): number {
  return Math.min(Math.max(0, count - 1), Math.max(0, index));
}

export function towerCraftCounts(fragments: number): readonly [number, number] {
  return [fragments >= HEART_FRAGMENTS ? 1 : 0, Math.floor(fragments / HEART_FRAGMENTS)];
}

export function towerNurtureCounts(
  hearts: number,
  bond: number,
): readonly [number, number, number] {
  const max = Math.max(0, Math.min(hearts, TOWER_BOND_LIMIT - bond));
  return [max >= 1 ? 1 : 0, max >= 10 ? 10 : 0, max];
}

/** Interaction state for the four tower tabs. All resource changes go through the host. */
export class BondingTowerPanelState {
  tab: Tab = "floors";
  message = "";
  private floorIndex: number | undefined;
  petIndex = 0;
  craftAction = 0;
  nurtureAction = -1;
  pendingSweep: SweepQuote | undefined;

  open(): void {
    this.tab = "floors";
    this.message = "";
    this.floorIndex = undefined;
    this.petIndex = 0;
    this.craftAction = 0;
    this.nurtureAction = -1;
    this.pendingSweep = undefined;
  }

  activeFloorIndex(view: TowerPanelView): number {
    if (this.floorIndex !== undefined) return clampIndex(this.floorIndex, view.floors.length);
    const next = view.floors.findIndex((row) => row.floor > view.highest);
    return next < 0 ? Math.max(0, view.floors.length - 1) : next;
  }

  firstFloorIndex(view: TowerPanelView): number {
    return Math.floor(this.activeFloorIndex(view) / TOWER_FLOORS_PER_PAGE) * TOWER_FLOORS_PER_PAGE;
  }

  firstPetIndex(): number {
    return Math.floor(this.petIndex / TOWER_PETS_PER_PAGE) * TOWER_PETS_PER_PAGE;
  }

  page(view: TowerPanelView, direction: number): void {
    const first = this.firstFloorIndex(view) + direction * TOWER_FLOORS_PER_PAGE;
    if (first < 0 || first >= view.floors.length) return;
    this.floorIndex = first;
    this.message = "";
  }

  private selectTab(tab: Tab): void {
    if (this.tab === tab) return;
    this.tab = tab;
    this.message = "";
    this.pendingSweep = undefined;
  }

  /** Returns the transition the world panel should apply after this tick. */
  tick(pressed: readonly InputCommand[], source: TowerPanelSource): "menu" | "battle" | undefined {
    if (!pressed.length) return;
    if (pressed.includes("back")) {
      if (!this.pendingSweep) return "menu";
      this.pendingSweep = undefined;
      this.message = "";
      return;
    }
    if (!this.pendingSweep && (pressed.includes("left") || pressed.includes("right"))) {
      const at = TOWER_TABS.findIndex((entry) => entry.tab === this.tab);
      this.selectTab(
        TOWER_TABS[clampIndex(at + (pressed.includes("left") ? -1 : 1), TOWER_TABS.length)].tab,
      );
      return;
    }
    const view = source.view();
    if (!view) return;
    if (!this.pendingSweep && (pressed.includes("up") || pressed.includes("down"))) {
      const direction = pressed.includes("up") ? -1 : 1;
      this.message = "";
      if (this.tab === "floors")
        this.floorIndex = clampIndex(this.activeFloorIndex(view) + direction, view.floors.length);
      else if (this.tab === "craft") this.craftAction = clampIndex(this.craftAction + direction, 2);
      else if (this.tab === "nurture" && view.pets.length) {
        if (this.nurtureAction >= 0)
          this.nurtureAction = Math.min(2, this.nurtureAction + direction);
        else if (direction > 0 && this.petIndex >= view.pets.length - 1) this.nurtureAction = 0;
        else this.petIndex = clampIndex(this.petIndex + direction, view.pets.length);
      }
      return;
    }
    if (!pressed.includes("confirm")) return;
    switch (this.tab) {
      case "floors": {
        const floor = view.floors[this.activeFloorIndex(view)];
        if (!floor || floor.status === "locked") return;
        const error = source.challenge(floor.floor);
        if (error === null) return "battle";
        this.message = error;
        return;
      }
      case "craft": {
        const count = towerCraftCounts(view.fragments)[this.craftAction];
        if (count) this.message = source.craft(count) ?? `Đã ghép ${count} trái tim.`;
        return;
      }
      case "nurture": {
        const pet = view.pets[this.petIndex];
        if (!pet) return;
        if (this.nurtureAction < 0) {
          this.nurtureAction = 0;
          return;
        }
        const count = towerNurtureCounts(view.hearts, pet.bond)[this.nurtureAction];
        if (count)
          this.message = source.nurture(pet.index, count) ?? `Đã bồi dưỡng ${pet.name} +${count}.`;
        return;
      }
      case "sweep":
        this.confirmSweep(view.sweep, source);
    }
  }

  private confirmSweep(sweep: TowerSweepView, source: TowerPanelSource): void {
    const { group, nextCost, used } = sweep;
    const previous = this.pendingSweep;
    this.pendingSweep = undefined;
    if (
      previous &&
      (!sweep.canSweep ||
        !group ||
        previous.cost !== nextCost ||
        previous.used !== used ||
        previous.start !== group.start ||
        previous.end !== group.end ||
        previous.count !== group.count)
    ) {
      this.message = "Lượt quét đã thay đổi. Hãy chọn lại.";
      return;
    }
    if (!sweep.canSweep || !group || nextCost === null) return;
    if (!previous && nextCost > 0) {
      this.pendingSweep = { ...group, used, cost: nextCost };
      this.message = "";
      return;
    }
    this.message = source.sweep() ?? "Đã nhận thưởng quét tháp.";
  }

  click(x: number, y: number, view?: TowerPanelView): InputCommand[] {
    const hit = (rect: Rect) => contains(x, y, rect);
    if (hit(TOWER_LAYOUT.close)) return ["back"];
    if (this.pendingSweep) {
      if (hit(TOWER_LAYOUT.back)) return ["back"];
      return hit(TOWER_LAYOUT.action) ? ["confirm"] : [];
    }
    const tab = TOWER_TABS.find((entry) => hit(entry.rect));
    if (tab) {
      this.selectTab(tab.tab);
      return [];
    }
    if (!view) return [];
    if ((this.tab === "floors" || this.tab === "sweep") && hit(TOWER_LAYOUT.back)) return ["back"];
    if (this.tab === "floors") {
      if (hit(TOWER_LAYOUT.action)) return ["confirm"];
      if (hit(TOWER_LAYOUT.previous)) this.page(view, -1);
      else if (hit(TOWER_LAYOUT.next)) this.page(view, 1);
      else {
        const start = this.firstFloorIndex(view);
        for (
          let slot = 0;
          slot < TOWER_FLOORS_PER_PAGE && start + slot < view.floors.length;
          slot++
        ) {
          if (!hit(TOWER_LAYOUT.floorRow(slot))) continue;
          this.floorIndex = start + slot;
          this.message = "";
          break;
        }
      }
    } else if (this.tab === "craft") {
      const action = TOWER_LAYOUT.craft.findIndex(hit);
      if (action < 0) return [];
      this.craftAction = action;
      return ["confirm"];
    } else if (this.tab === "nurture") {
      const action = TOWER_LAYOUT.nurture.findIndex(hit);
      if (action >= 0) {
        this.nurtureAction = action;
        return ["confirm"];
      }
      const start = this.firstPetIndex();
      for (let slot = 0; slot < TOWER_PETS_PER_PAGE && start + slot < view.pets.length; slot++) {
        if (!hit(TOWER_LAYOUT.petRow(slot))) continue;
        this.petIndex = start + slot;
        this.nurtureAction = -1;
        this.message = "";
        break;
      }
    } else if (hit(TOWER_LAYOUT.action)) return ["confirm"];
    return [];
  }
}
