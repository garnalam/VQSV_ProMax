import type { InputCommand } from "../../core/input/GameCommand";
import type { EggCatalogRow } from "../campaign/CampaignSystems";
import {
  CAU_VONG_SLOTS,
  type CauVongIncubation,
  type CauVongIncubationResult,
  firstEmptySlot,
} from "../campaign/CauVongIncubator";

/** What the incubator panel reads and writes; the host binds it to the world. */
export type CauVongIncubatorSource = {
  state: () => CauVongIncubation | undefined;
  /** `CauVongEggCatalog.items()` with their recipes. */
  eggs: () => EggCatalogRow[];
  owned: (item: number) => number;
  materialCount: (id: number) => number;
  admit: (slot: number, item: number) => CauVongIncubationResult;
  hatch: (slot: number) => CauVongIncubationResult;
  discard: (slot: number) => void;
};

export const CAU_VONG_INCUBATOR_TEXT = {
  title: "ẤP TRỨNG CẦU VỒNG · 5 Ô",
  initial: "Đánh trận nhận EXP để ấp cả 5 ô.",
  discarded: "Đã bỏ trứng. Trứng không được hoàn lại.",
  empty: "Ô trống: chọn trứng trong túi để ấp.",
  occupied: ["Cho trứng nở", "Bỏ trứng"],
  confirm: ["Xác nhận bỏ trứng (không hoàn lại)", "Giữ trứng"],
} as const;

/** `CauVongIncubatorPanel.confirm`'s result lines. */
export function incubatorMessage(result: CauVongIncubationResult, slot: number): string {
  switch (result) {
    case "ADMITTED":
      return `Đã đưa 1 trứng vào ô ${slot + 1}.`;
    case "HATCHED":
      return "Trứng đã nở! Pet vào đội hoặc kho.";
    case "NOT_READY":
      return "Trứng chưa đạt 200 điểm.";
    case "MISSING_MATERIALS":
      return "Chưa đủ nguyên liệu để nở.";
    case "STORAGE_FULL":
      return "Đội và kho đầy. Trứng vẫn được giữ.";
    case "MISSING_EGG":
      return "Bạn không có loại trứng này.";
    default:
      return "Chưa thể thực hiện; trứng vẫn được giữ.";
  }
}

const mod = (value: number, size: number) => ((value % size) + size) % size;

/**
 * JavaSE `CauVongIncubatorPanel`: menu 0 the five slots, 1 the owned eggs for an empty slot (and
 * "Quay lại"), 2 an occupied slot's actions, 3 the discard confirmation (which starts on "Giữ
 * trứng"). Back returns to the slots, and closes from there. The message survives a reopen.
 */
export class CauVongIncubatorPanelState {
  selected = 0;
  menu = 0;
  action = 0;
  message: string = CAU_VONG_INCUBATOR_TEXT.initial;
  choices: number[] = [];
  eggScroll = 0;

  open(): void {
    this.selected = 0;
    this.menu = 0;
    this.action = 0;
  }
  /** `selectEmpty`: the bag's egg row opens the panel on the first empty slot. */
  selectEmpty(state: CauVongIncubation | undefined): void {
    const empty = state ? firstEmptySlot(state) : -1;
    if (empty >= 0) this.selected = empty;
  }

  /** `tick`: true once the panel closes. */
  tick(pressed: readonly InputCommand[], source: CauVongIncubatorSource): boolean {
    if (pressed.includes("back")) {
      if (this.menu !== 0) this.menu = 0;
      else return true;
    } else if (pressed.includes("up") || pressed.includes("left")) {
      if (this.menu === 0) this.selected = (this.selected + 4) % CAU_VONG_SLOTS;
      else this.action = mod(this.action - 1, this.menu === 1 ? this.choices.length : 2);
    } else if (pressed.includes("down") || pressed.includes("right")) {
      if (this.menu === 0) this.selected = (this.selected + 1) % CAU_VONG_SLOTS;
      else this.action = (this.action + 1) % (this.menu === 1 ? this.choices.length : 2);
    } else if (pressed.includes("confirm")) this.confirm(source);
    if (this.menu === 1) {
      if (this.action < this.eggScroll) this.eggScroll = this.action;
      if (this.action >= this.eggScroll + 8) this.eggScroll = this.action - 7;
    }
    return false;
  }
  private confirm(source: CauVongIncubatorSource): void {
    const state = source.state();
    if (!state) return;
    if (this.menu === 0) {
      this.menu = state.items[this.selected] === 0 ? 1 : 2;
      this.action = 0;
      this.eggScroll = 0;
      if (this.menu === 1)
        this.choices = [
          ...source
            .eggs()
            .map((row) => row.itemId)
            .filter((id) => source.owned(id) > 0),
          0,
        ];
      return;
    }
    if (this.menu === 1 && this.choices[this.action] === 0) {
      this.menu = 0;
      return;
    }
    if (this.menu === 3) {
      if (this.action === 0) {
        source.discard(this.selected);
        this.message = CAU_VONG_INCUBATOR_TEXT.discarded;
      }
      this.menu = 0;
      return;
    }
    if (this.menu === 2 && this.action === 1) {
      this.menu = 3;
      this.action = 1;
      return;
    }
    const result =
      this.menu === 1
        ? source.admit(this.selected, this.choices[this.action])
        : source.hatch(this.selected);
    this.message = incubatorMessage(result, this.selected);
    this.menu = 0;
  }

  /** `click`: the softkeys, the egg rows and arrows, a slot (select only), an action (confirm). */
  click(x: number, y: number): InputCommand[] {
    if (y >= 296) return [x < 120 ? "confirm" : "back"];
    if (this.menu === 1 && x >= 10 && x < 230 && y >= 45 && y < 245) {
      const row = this.eggScroll + Math.floor((y - 45) / 25);
      if (row < this.choices.length) {
        this.action = row;
        return ["confirm"];
      }
      return [];
    }
    if (this.menu === 1 && y >= 248 && y < 275) return [x < 120 ? "up" : "down"];
    if (this.menu === 0 && x >= 10 && x < 230 && y >= 36 && y < 186)
      this.selected = Math.floor((y - 36) / 30);
    else if (this.menu >= 2 && y >= 224 && y < 272) {
      this.action = Math.floor((y - 224) / 24);
      return ["confirm"];
    }
    return [];
  }
}
