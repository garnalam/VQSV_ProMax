import { describe, expect, it } from "vitest";
import {
  darkerColor,
  glowSize,
  lighterColor,
  marqueeOffset,
  petStateAccent,
  sheenX,
  sourceScrollOffset,
} from "./PetStateRenderer";

describe("JavaSE petstate animation maths", () => {
  it("slides the header sheen 3 px a tick across 148 px from x 43", () => {
    expect(sheenX(0)).toBe(43);
    expect(sheenX(10)).toBe(73);
    expect(sheenX(49)).toBe(43 + 147);
    expect(sheenX(50)).toBe(43 + 2);
  });

  it("pulses the overview glow 20..27 over 16 ticks", () => {
    expect([0, 4, 7, 8, 12, 15, 16].map(glowSize)).toEqual([20, 24, 27, 27, 23, 20, 20]);
  });

  it("scrolls only overflowing marquee text, entering from the right half", () => {
    expect(marqueeOffset(40, 50, 99)).toBe(0);
    expect(marqueeOffset(80, 50, 0)).toBe(25 - 50);
    expect(marqueeOffset(80, 50, 105)).toBe(0 - 50);
  });

  it("steps softkey text 2 px a tick and wraps to -width", () => {
    expect(sourceScrollOffset(70, 60, 0)).toBe(-28);
    expect(sourceScrollOffset(70, 60, 9)).toBe(-10);
  });

  it("derives accents and their shades like JavaSE", () => {
    expect(petStateAccent(0)).toBe(0xd65c41);
    expect(petStateAccent(-1)).toBe(0x247fa2);
    expect(darkerColor(0xd65c41)).toBe((139 << 16) | (59 << 8) | 42);
    expect(lighterColor(0xd65c41)).toBe((255 << 16) | (187 << 8) | 160);
  });
});
