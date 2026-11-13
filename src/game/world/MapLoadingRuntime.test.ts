import { describe, expect, it } from "vitest";
import {
  MAP_LOADING_TIPS,
  MAP_LOADING_TIP_LABEL,
  MAP_LOADING_TOTAL_TICKS,
  MapLoadingRuntime,
} from "./MapLoadingRuntime";

/** The calls a real canvas would receive, in order, with the fill style each rect was painted under. */
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
    fillRect: (x: number, y: number, w: number, h: number) =>
      calls.push({ op: "rect", style, x, y, w, h }),
  };
  // A fixed-pitch stand-in for the panel font: 6 px a code point, so the centring math is checkable.
  const font = {
    width: (text: string) => Array.from(text).length * 6,
    draw: (_g: unknown, text: string, x: number, y: number, color: string): void =>
      void calls.push({
        op: "text",
        style: color,
        x,
        y,
        w: Array.from(text).length,
        h: 0,
      }),
  };
  return { calls, g: g as unknown as CanvasRenderingContext2D, font };
}

describe("map-loading runtime (VqsvMapLoadingRuntime)", () => {
  it("draws the whole screen from Java's exact geometry on the first tick", () => {
    const { calls, g, font } = recorder();
    MapLoadingRuntime.begin(() => 0).render(g, font);
    const glyphs = Array.from(MAP_LOADING_TIPS[0]).length;
    expect(calls).toEqual([
      { op: "rect", style: "#000000", x: 0, y: 0, w: 240, h: 320 },
      { op: "rect", style: "#000000", x: 45, y: 272, w: 150, h: 5 },
      // Java's `new Color(7877410)` track and `new Color(16707204)` fill.
      { op: "rect", style: "#783322", x: 46, y: 273, w: 148, h: 3 },
      { op: "rect", style: "#feee84", x: 46, y: 273, w: 0, h: 3 },
      { op: "text", style: "#ffffff", x: (240 - glyphs * 6) / 2, y: 250, w: glyphs, h: 0 },
    ]);
  });

  it("holds the world back for exactly sixteen ticks, then closes on its own", () => {
    const loading = MapLoadingRuntime.begin(() => 3);
    const active: boolean[] = [];
    for (let i = 0; i < MAP_LOADING_TOTAL_TICKS; i++) {
      expect(loading.tick()).toBe(true);
      active.push(loading.active);
    }
    expect(active.filter(Boolean)).toHaveLength(MAP_LOADING_TOTAL_TICKS - 1);
    expect(loading.tick()).toBe(false);
  });

  it("ramps the bar ten pixels a tick and clamps it to the track", () => {
    const loading = MapLoadingRuntime.begin(() => 0);
    const widths: number[] = [];
    for (let i = 0; i < MAP_LOADING_TOTAL_TICKS; i++) {
      loading.tick();
      widths.push(loading.progressPixels());
    }
    expect(widths).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 148, 148]);
  });

  it("draws the tip once, on the source label and the tip count", () => {
    const draws: [string, number][] = [];
    MapLoadingRuntime.begin((label, bound) => (draws.push([label, bound]), 6));
    expect(draws).toEqual([[MAP_LOADING_TIP_LABEL, 7]]);
  });

  it("keeps the seven elemental tips in Java's order", () => {
    expect(MAP_LOADING_TIPS).toEqual([
      "Hỏa hệ khắc mộc hệ",
      "Mộc hệ khắc thổ hệ",
      "Thổ hệ khắc thủy hệ",
      "Thủy hệ khắc hỏa hệ",
      "Quỷ hệ khắc phong hệ",
      "Phong hệ khắc điện hệ",
      "Điện hệ khắc quỷ hệ",
    ]);
    for (let i = 0; i < MAP_LOADING_TIPS.length; i++)
      expect(MapLoadingRuntime.begin(() => i).tip).toBe(MAP_LOADING_TIPS[i]);
  });
});
