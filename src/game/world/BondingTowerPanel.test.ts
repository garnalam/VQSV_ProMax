import { describe, expect, it, vi } from "vitest";
import { SourceUiLayout } from "../../rendering/SourceUiLayout";
import { WorldPanel } from "./WorldPanel";

const layout = new SourceUiLayout({} as never);

function enterTower() {
  const panel = new WorldPanel();
  const calls: string[] = [];
  let sweepCost = 25;
  panel.towerSource = {
    view: () => ({
      highest: 5,
      hearts: 14,
      fragments: 42,
      floors: Array.from({ length: 13 }, (_, i) => ({
        floor: i + 1,
        level: 20,
        quality: 2,
        double: false,
        boss: i === 4 || i === 9,
        team: [{ id: 10, name: "Hỏa Long" }],
        status: i < 5 ? "practice" : i === 5 ? "first" : "locked",
      })),
      pets: [
        { index: 1, name: "Rùa", level: 10, quality: 2, bond: 4 },
        { index: 4, name: "Dơi", level: 12, quality: 3, bond: 247 },
      ],
      sweep: {
        used: 1,
        limit: 3,
        nextCost: sweepCost,
        group: { start: 1, end: 5, count: 4 },
        canSweep: true,
        detail: "Còn 4 tầng có thưởng.",
      },
    }),
    challenge: (floor) => {
      calls.push("floor " + floor);
      return null;
    },
    craft: (count) => {
      calls.push("craft " + count);
      return null;
    },
    nurture: (index, count) => {
      calls.push(`pet ${index} +${count}`);
      return null;
    },
    sweep: () => {
      calls.push("sweep");
      return null;
    },
  };
  panel.open();
  panel.selected = panel.labels.findIndex((label) => label === "Tháp Gắn Kết");
  panel.tick(["confirm"]);
  expect(panel.mode).toBe("bondingTower");
  return {
    panel,
    calls,
    changeSweepCost: (cost: number) => (sweepCost = cost),
    click: (x: number, y: number) => {
      panel.click(layout, x, y);
      panel.tick([]);
    },
  };
}

describe("Tháp Gắn Kết world panel", () => {
  it("loads the ranking when the player opens the BXH tab and can refresh it", async () => {
    const { panel, click, calls } = enterTower();
    const rows = [{ username: "huypham", highest: 42 }];
    const leaderboard = vi.fn().mockResolvedValue(rows);
    panel.towerSource.leaderboard = leaderboard;
    click(216, 78);
    expect(panel.bondingTower.tab).toBe("leaderboard");
    expect(panel.bondingTower.ranking.status).toBe("loading");
    await vi.waitFor(() => expect(panel.bondingTower.ranking).toEqual({ status: "ready", rows }));
    panel.tick(["confirm"]);
    expect(leaderboard).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([]);
  });

  it("opens on the next uncrossed floor and closes when the challenge starts", () => {
    const { panel, calls } = enterTower();
    panel.tick(["confirm"]);
    expect(calls).toEqual(["floor 6"]);
    expect(panel.visible).toBe(false);
  });

  it("lets touch browse page rows and keeps locked floors from starting", () => {
    const { calls, click } = enterTower();
    click(98, 105);
    click(36, 123);
    click(45, 302);
    expect(calls).toEqual([]);
    click(23, 105);
    click(23, 105);
    click(38, 208);
    click(45, 302);
    expect(calls).toEqual(["floor 5"]);
  });

  it("crafts all available hearts with keyboard navigation", () => {
    const { panel, calls } = enterTower();
    panel.tick(["right"]);
    panel.tick(["down"]);
    panel.tick(["confirm"]);
    expect(calls).toEqual(["craft 2"]);
  });

  it("nurtures the touched party member up to the cap using that pet's source index", () => {
    const { calls, click } = enterTower();
    click(148, 78);
    click(58, 132);
    click(188, 302);
    expect(calls).toEqual(["pet 4 +8"]);
  });

  it("rechecks a paid sweep quote and requires a fresh confirmation when it changes", () => {
    const { panel, calls, changeSweepCost, click } = enterTower();
    click(201, 79);
    click(43, 302);
    expect(calls).toEqual([]);
    changeSweepCost(30);
    panel.tick(["confirm"]);
    expect(calls).toEqual([]);
    panel.tick(["confirm"]);
    panel.tick(["confirm"]);
    expect(calls).toEqual(["sweep"]);
  });

  it("returns to the tower menu entry with back", () => {
    const { panel } = enterTower();
    panel.tick(["back"]);
    expect(panel.mode).toBe("gamemenu");
    expect(panel.labels[panel.selected]).toBe("Tháp Gắn Kết");
  });
});
