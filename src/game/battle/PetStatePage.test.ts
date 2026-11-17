import { describe, expect, it } from "vitest";
import { petStatePageAt, stepPetStatePage, type PetStatePage } from "./BattleListLayout";

const page = (tab: number, talent = false): PetStatePage => ({ tab, talent });

describe("pet dashboard pages (PetStateDetailUiState)", () => {
  it("walks Hồ sơ, Chỉ số, Đặc tính, Thiên phú, Kỹ năng with right, and back with left", () => {
    const right: PetStatePage[] = [page(0)];
    for (let i = 0; i < 5; i++) right.push(stepPetStatePage(right[right.length - 1], true));
    expect(right).toEqual([page(0), page(1), page(2), page(2, true), page(3), page(0)]);
    const left: PetStatePage[] = [page(0)];
    for (let i = 0; i < 5; i++) left.push(stepPetStatePage(left[left.length - 1], false));
    expect(left).toEqual([page(0), page(3), page(2, true), page(2), page(1), page(0)]);
  });

  it("lets a tap pick the Thiên phú row on the Đặc tính tab, and the Đặc tính row back", () => {
    expect(petStatePageAt(page(2), 100, 134)).toEqual(page(2, true));
    expect(petStatePageAt(page(2, true), 100, 118)).toEqual(page(2));
    // The rows only answer on the Đặc tính tab; elsewhere the same spot is not a control.
    expect(petStatePageAt(page(0), 100, 134)).toBeNull();
    // The tabs still answer, keeping the row the trait page had.
    expect(petStatePageAt(page(2, true), 50, 72)).toEqual(page(0, true));
    expect(petStatePageAt(page(0, true), 140, 72)).toEqual(page(2, true));
  });
});
