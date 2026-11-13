import { describe, expect, it } from "vitest";
import { BootProgress } from "../pack/BootProgress";
import { BootLoaderRenderer } from "./BootLoaderRenderer";

/** The calls a real canvas would receive, in order, with the fill style each one was painted under. */
type DrawCall = { op: "rect" | "text"; style: string; x: number; y: number; w: number; h: number };

function recorder() {
  const calls: DrawCall[] = [];
  let style = "";
  const g = {
    set fillStyle(value: string) {
      style = value;
    },
    get fillStyle() {
      return style;
    },
    font: "",
    textAlign: "",
    fillRect: (x: number, y: number, w: number, h: number) =>
      calls.push({ op: "rect", style, x, y, w, h }),
    fillText: (text: string, x: number, y: number) =>
      calls.push({ op: "text", style, x, y, w: Array.from(text).length, h: 0 }),
  };
  return { calls, g: g as unknown as CanvasRenderingContext2D };
}

function bar(progress: BootProgress) {
  const { calls, g } = recorder();
  new BootLoaderRenderer(g, progress).draw();
  return calls;
}

describe("boot loader renderer", () => {
  it("draws the source map-loading bar with nothing in it before any file is known", () => {
    expect(bar(new BootProgress())).toEqual([
      { op: "rect", style: "#000000", x: 0, y: 0, w: 240, h: 320 },
      { op: "rect", style: "#000000", x: 45, y: 272, w: 150, h: 5 },
      { op: "rect", style: "#783322", x: 46, y: 273, w: 148, h: 3 },
      { op: "rect", style: "#feee84", x: 46, y: 273, w: 0, h: 3 },
      { op: "text", style: "#ffffff", x: 120, y: 250, w: 23, h: 0 },
    ]);
  });

  it("labels the real file count", () => {
    const progress = new BootProgress();
    progress.book("/pack/pack.json");
    progress.complete("/pack/pack.json");
    progress.book("/pack/world/rooms.json");
    const label = bar(progress)[4];
    expect(label.op).toBe("text");
    expect(label.w).toBe(Array.from("Đang tải tài nguyên 1/2").length);
  });

  it("holds the bar back until every file it knows about has come back", () => {
    const progress = new BootProgress();
    const pixels = () =>
      new BootLoaderRenderer({} as CanvasRenderingContext2D, progress).progressPixels();
    for (const url of ["/a", "/b", "/c", "/d"]) progress.book(url);
    progress.complete("/a");
    progress.complete("/b");
    expect(pixels()).toBe(74);
    progress.complete("/c");
    progress.complete("/d");
    // Everything known has landed, so this is the real end of the load.
    expect(pixels()).toBe(148);
    // The room indexes then book hundreds of sprite files: the share of what is known is still one,
    // but the bar steps back to its cap instead of claiming the load is over.
    for (let i = 0; i < 600; i++) progress.book(`/pack/world/sprites/${i}.png`);
    expect(pixels()).toBe(141);
    expect([progress.loaded, progress.total]).toEqual([4, 604]);
    progress.complete("/pack/world/sprites/0.png");
    expect(pixels()).toBe(141);
  });
});
