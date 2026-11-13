import { describe, expect, it } from "vitest";
import { WharfTravel, wharfRoute } from "./WharfTravel";

describe("WharfTravel (VqsvWharfTravelRuntime)", () => {
  const run = (boatMode: 0 | 2) => {
    const travel = new WharfTravel(wharfRoute([0, 0, 0, 1, 5, 272, 128, 3, boatMode], "x"));
    const log: { phase: number; alpha: number; boatY: number; bars: number }[] = [];
    for (let i = 0; i < 200 && !travel.done; i++) {
      travel.tick();
      if (travel.landingDue) travel.landed();
      log.push({
        phase: travel.phase,
        alpha: travel.fadeAlpha,
        boatY: travel.boatY,
        bars: travel.bars?.top ?? 0,
      });
    }
    return { travel, log };
  };

  it("fades for 16 ticks, closes the bars over 5, sails 5 px a tick off the screen, then opens them", () => {
    const { travel, log } = run(0);
    expect(travel.done).toBe(true);
    const fade = log.filter((row) => row.phase === 1);
    expect(fade).toHaveLength(16);
    expect(fade.at(-1)!.alpha).toBe(255);
    const sail = log.filter((row) => row.phase === 3);
    // From y 10 down: one step a tick; the last frame drawn is at 320, the next step lands.
    expect(sail[0].boatY).toBe(10);
    expect(sail.at(-1)!.boatY).toBe(320);
    expect(Math.max(...log.filter((row) => row.phase <= 3).map((row) => row.bars))).toBe(30);
    expect(log.at(-1)!.bars).toBe(0);
  });

  it("sails up from the bottom in mode 2 and rejects a malformed route", () => {
    const { log } = run(2);
    expect(log.find((row) => row.phase === 3)!.boatY).toBe(310);
    expect(log.filter((row) => row.phase === 3).at(-1)!.boatY).toBe(0);
    expect(() => wharfRoute([1, 2, 3], "x")).toThrow(/nine values/);
    expect(() => wharfRoute([0, 0, 0, 1, 5, 0, 0, 0, 1], "x")).toThrow(/0 or 2/);
  });
});
