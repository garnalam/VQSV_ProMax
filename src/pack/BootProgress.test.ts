import { describe, expect, it } from "vitest";
import { BootProgress } from "./BootProgress";

describe("BootProgress", () => {
  it("counts each url once and only after it comes back", () => {
    const progress = new BootProgress();
    progress.book("/pack/pack.json");
    expect([progress.loaded, progress.total]).toEqual([0, 1]);
    progress.book("/pack/pack.json");
    expect([progress.loaded, progress.total]).toEqual([0, 1]);
    progress.complete("/pack/pack.json");
    expect([progress.loaded, progress.total]).toEqual([1, 1]);
    progress.complete("/pack/pack.json");
    expect([progress.loaded, progress.total]).toEqual([1, 1]);
  });

  it("still counts a file that was fetched without being booked first", () => {
    const progress = new BootProgress();
    progress.complete("/pack/world/rooms.json");
    expect([progress.loaded, progress.total]).toEqual([1, 1]);
  });

  it("never lets the bar move backwards when a later burst grows the total", () => {
    const progress = new BootProgress();
    expect(progress.fraction()).toBe(0);
    for (const url of ["/a.png", "/b.png"]) progress.book(url);
    progress.complete("/a.png");
    expect(progress.fraction()).toBeCloseTo(0.5, 6);
    progress.complete("/b.png");
    expect(progress.fraction()).toBeCloseTo(1, 6);
    // The room indexes arrive and book hundreds of frames: the count is honest, the bar is not.
    for (let i = 0; i < 200; i++) progress.book(`/pack/world/sprites/${i}.png`);
    expect(progress.total).toBe(202);
    expect(progress.fraction()).toBeCloseTo(1, 6);
    progress.complete("/pack/world/sprites/0.png");
    expect(progress.fraction()).toBeCloseTo(1, 6);
  });

  it("stops counting once the boot is closed", () => {
    const progress = new BootProgress();
    progress.book("/pack/pack.json");
    progress.close();
    progress.book("/pack/world/rooms.json");
    progress.complete("/pack/world/sprites/1.png");
    expect([progress.loaded, progress.total]).toEqual([0, 1]);
  });

  it("reports every count change to its listeners until they unsubscribe", () => {
    const progress = new BootProgress();
    const seen: [number, number][] = [];
    const off = progress.onChange((state) => seen.push([state.loaded, state.total]));
    progress.book("/a");
    progress.complete("/a");
    progress.book("/b");
    off();
    progress.complete("/b");
    expect(seen).toEqual([
      [0, 1],
      [1, 1],
      [1, 2],
    ]);
  });
});
