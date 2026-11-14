import { describe, expect, it } from "vitest";
import { battleLossRecovery, legacyRecoveryCheckpoint, reachedRecoveryHub } from "./RecoveryCheckpoint";

describe("regional loss checkpoints", () => {
  it.each([
    [1, 0, "village"], [2, 1, "bich-thuy"], [3, 3, "nguyen-moc"],
    [4, 0, "niem-tho"], [5, 3, "hac-thach-north"], [5, 5, "hac-thach-south"], [7, 2, "blc"],
  ])("commissions only the actual hub %i:%i", (scene, room, key) => {
    expect(reachedRecoveryHub(scene, room)).toBe(key);
  });
  it("does not replace a commissioned hub with an arbitrary road", () => {
    expect(reachedRecoveryHub(3, 1)).toBeNull();
    expect(battleLossRecovery("bich-thuy", 3, 1)).toEqual({
      key: "bich-thuy", scene: 2, room: 1, actor: 9,
    });
  });
  it("keeps the two source special recovery destinations", () => {
    expect(battleLossRecovery("village", 10, 7)).toMatchObject({scene: 10, room: 6, actor: 5});
    expect(battleLossRecovery("village", 98, 49)).toMatchObject({scene: 98, room: 50});
  });
  it("migrates old locations with the story gate at Bich Thuy's approach", () => {
    expect(legacyRecoveryCheckpoint(2, 0, false)).toBe("village");
    expect(legacyRecoveryCheckpoint(2, 0, true)).toBe("bich-thuy");
    expect(legacyRecoveryCheckpoint(11, 23, true)).toBe("hac-thach-north");
    expect(legacyRecoveryCheckpoint(98, 5, true)).toBe("village");
  });
});
