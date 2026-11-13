import { describe, expect, it } from "vitest";
import {
  clampIndexIntoVisible,
  dragScroll,
  maxScroll,
  pageScroll,
  pressScrollbar,
  scrollToShow,
  thumbHeight,
  thumbY,
} from "./UiScrollbarMath";

/** Nine rows in a five-row window on the skill list's 111px track (Java: thumb 61, travel 50). */
const bar = { x: 137, y: 90, w: 4, h: 111, rowCount: 9, visibleRows: 5, minThumbHeight: 8 };

describe("UiScrollbarMath (Java port)", () => {
  it("sizes and places the thumb with Java's integer math", () => {
    expect(maxScroll(9, 5)).toBe(4);
    expect(thumbHeight(111, 9, 5, 8)).toBe(61);
    expect(thumbHeight(111, 40, 5, 18)).toBe(18);
    expect(thumbHeight(111, 3, 5, 8)).toBe(111);
    expect([0, 1, 2, 3, 4, 9].map((s) => thumbY(90, 111, 61, 9, 5, s))).toEqual([
      90, 102, 115, 127, 140, 140,
    ]);
  });

  it("pages on the track and drags the thumb to the nearest row", () => {
    expect(pageScroll(200, 0, bar)).toBe(4);
    expect(pageScroll(91, 4, bar)).toBe(0);
    expect(pageScroll(100, 0, bar)).toBe(0);
    expect(dragScroll(90 + 25, 0, bar)).toBe(2);
    expect(dragScroll(500, 0, bar)).toBe(4);
    expect(dragScroll(0, 0, bar)).toBe(0);
    expect(dragScroll(120, 30, bar)).toBe(0);
  });

  it("tells a thumb grab from a track page, and ignores a short list", () => {
    expect(pressScrollbar(138, 100, 0, bar)).toEqual({ drag: 10 });
    expect(pressScrollbar(138, 190, 0, bar)).toEqual({ scroll: 4 });
    expect(pressScrollbar(120, 100, 0, bar)).toBeNull();
    expect(pressScrollbar(138, 100, 0, { ...bar, rowCount: 5 })).toBeNull();
  });

  it("keeps a cursor inside the window", () => {
    expect(clampIndexIntoVisible(0, 3, 9, 5)).toBe(3);
    expect(clampIndexIntoVisible(8, 0, 9, 5)).toBe(4);
    expect(clampIndexIntoVisible(5, 3, 9, 5)).toBe(5);
    expect(scrollToShow(7, 0, 9, 5)).toBe(3);
    expect(scrollToShow(1, 3, 9, 5)).toBe(1);
  });
});
