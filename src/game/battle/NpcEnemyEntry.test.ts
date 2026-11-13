import { describe, expect, it } from "vitest";
import { NPC_ENEMY_ENTRY_TICKS, npcEnemyEntryAt, npcEnemyEntryView } from "./NpcEnemyEntry";

/** `VqsvBattleNpcEnemyEntryRenderState` / `tickNpcVsEntry` (the trainer fight's VS card). */
describe("NPC VS entry card", () => {
  it("shows one timeline frame a tick, 23 in all, before P0", () => {
    expect(NPC_ENEMY_ENTRY_TICKS).toBe(23);
    expect(npcEnemyEntryAt(0)).toEqual({ step: 0, frame: 0 });
    expect(npcEnemyEntryAt(4)).toEqual({ step: 4, frame: 4 });
    expect(npcEnemyEntryAt(8)).toEqual({ step: 4, frame: 8 });
    expect(npcEnemyEntryAt(12)).toEqual({ step: 7, frame: 12 });
    expect(npcEnemyEntryAt(22)).toEqual({ step: 11, frame: 22 });
    expect(npcEnemyEntryAt(99)).toEqual({ step: 11, frame: 22 });
  });

  it("slides the portraits 2/3 → 34/35 → 4/5 and fills one coloured slot per pet", () => {
    expect(npcEnemyEntryView(1, 1, 1, 1).visible[2]).toBe(true);
    const moved = npcEnemyEntryView(2, 2, 1, 1);
    expect([moved.visible[2], moved.visible[34]]).toEqual([false, true]);
    // Long Vương's fight: one enemy pet, one of the player's.
    const filled = npcEnemyEntryView(5, 9, 1, 1);
    expect([filled.visible[4], filled.visible[5]]).toEqual([true, true]);
    expect(filled.cells.slice(6, 18)).toEqual([6, 6, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]);
    expect(filled.cells.slice(18, 30)).toEqual([6, 6, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]);
  });

  it("puts V and S apart, then together, flashes, and sends the rows out", () => {
    const apart = npcEnemyEntryView(6, 10, 6, 6);
    expect([apart.cells[30], apart.cells[31], apart.cells[32]]).toEqual([8, 7, -1]);
    const together = npcEnemyEntryView(7, 12, 6, 6);
    expect([together.cells[30], together.cells[32], together.cells[33]]).toEqual([-1, 8, 7]);
    expect(npcEnemyEntryView(8, 13, 6, 6).overlay36).toBe(true);
    const exit = npcEnemyEntryView(10, 21, 6, 6);
    expect([exit.mainCell, exit.exitSlotRows, exit.visible[4], exit.cells[32]]).toEqual([
      4,
      true,
      false,
      -1,
    ]);
    const done = npcEnemyEntryView(11, 22, 6, 6);
    expect([done.mainCell, done.exitSlotRows, done.cells[7], done.cells[19]]).toEqual([
      0,
      false,
      -1,
      -1,
    ]);
  });
});
