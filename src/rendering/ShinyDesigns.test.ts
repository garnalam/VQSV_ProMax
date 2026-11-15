import { describe, expect, it } from "vitest";
import {
  LEGACY_SHINY_COLOR,
  SHINY_COLOR_COUNT,
  giveShinyColor,
  SHINY_THEMES,
  analyzeSprite,
  defaultShinyColor,
  recolorPixels,
  rgbToLch,
  rollShinyColor,
  shinyTheme,
} from "./ShinyDesigns";

/** A 12x12 sprite: a black outline ring, a red body, a small blue patch, transparent corners. */
function sprite(): { data: Uint8ClampedArray; width: number; height: number } {
  const width = 12,
    height = 12,
    data = new Uint8ClampedArray(width * height * 4);
  const put = (x: number, y: number, rgb: number) => {
    const i = (y * width + x) * 4;
    data[i] = (rgb >>> 16) & 255;
    data[i + 1] = (rgb >>> 8) & 255;
    data[i + 2] = rgb & 255;
    data[i + 3] = 255;
  };
  for (let y = 1; y < 11; y++)
    for (let x = 1; x < 11; x++) {
      const edge = x === 1 || y === 1 || x === 10 || y === 10;
      if (edge) put(x, y, 0x101010);
      else if (x >= 7 && y >= 7) put(x, y, 0x3060e0);
      else put(x, y, y < 5 ? 0xe05040 : 0xa02818);
    }
  return { data, width, height };
}

describe("shiny themes (web redesign)", () => {
  it("has 13 hand-made themes of three six-stop ramps, ids unique", () => {
    expect(SHINY_COLOR_COUNT).toBe(13);
    expect(new Set(SHINY_THEMES.map((t) => t.id)).size).toBe(13);
    for (const theme of SHINY_THEMES) {
      expect(theme.ramps).toHaveLength(3);
      for (const ramp of theme.ramps) expect(ramp).toHaveLength(6);
    }
    expect(SHINY_THEMES.map((t) => t.id)).not.toContain("platinum");
    expect(SHINY_THEMES.map((t) => t.id)).not.toContain("frost");
    expect(SHINY_THEMES.map((t) => t.id)).not.toContain("abyss");
  });

  it("rolls a colour in range and wraps any index onto a theme", () => {
    expect(rollShinyColor(() => 0)).toBe(0);
    expect(rollShinyColor(() => 0.9999999)).toBe(12);
    for (let i = 0; i < 50; i++) {
      const color = rollShinyColor();
      expect(color).toBeGreaterThanOrEqual(0);
      expect(color).toBeLessThan(13);
    }
    expect(shinyTheme(13)).toBe(SHINY_THEMES[0]);
    expect(shinyTheme(-1)).toBe(SHINY_THEMES[12]);
  });

  it("gives an unowned shiny a fixed colour per visual and nature", () => {
    expect(defaultShinyColor(155, 7)).toBe(defaultShinyColor(155, 7));
    const seen = new Set<number>();
    for (let visual = 0; visual < 200; visual++) seen.add(defaultShinyColor(visual, 8));
    expect(seen.size).toBe(13);
  });

  it("reads the largest colour region as the main one", () => {
    const { data } = sprite(),
      { regions } = analyzeSprite(data);
    expect(regions[0].role).toBe(0);
    expect(rgbToLch(0xe05040).h).toBeCloseTo(regions[0].hue, -2);
    expect(regions.some((region) => region.role !== 0)).toBe(true);
  });

  it("changes colour but keeps the sprite's light and dark, and leaves transparency alone", () => {
    const original = sprite(),
      analysis = analyzeSprite(original.data);
    for (const theme of SHINY_THEMES) {
      const { data, width, height } = sprite();
      recolorPixels(data, width, height, { theme, analysis });
      for (let i = 0; i < data.length; i += 4) {
        expect(data[i + 3]).toBe(original.data[i + 3]);
        if (!original.data[i + 3]) continue;
        const before = rgbToLch(
            (original.data[i] << 16) | (original.data[i + 1] << 8) | original.data[i + 2],
          ),
          after = rgbToLch((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
        expect(Math.abs(after.l - before.l), theme.name).toBeLessThan(0.16);
      }
      // The red body really changed colour.
      const body = (3 * width + 4) * 4;
      expect((data[body] << 16) | (data[body + 1] << 8) | data[body + 2], theme.name).not.toBe(
        0xe05040,
      );
    }
  });

  it("draws a colour once for a new shiny and never touches an old one", () => {
    const fresh: { nature?: number; shinyColor?: number } = { nature: 8 };
    giveShinyColor(fresh, () => 0.5);
    expect(fresh.shinyColor).toBe(6);
    giveShinyColor(fresh, () => 0);
    expect(fresh.shinyColor).toBe(6);
    const old = { nature: 9, shinyColor: LEGACY_SHINY_COLOR };
    giveShinyColor(old, () => 0.5);
    expect(old.shinyColor).toBe(-1);
    const plain: { nature?: number; shinyColor?: number } = { nature: 3 };
    giveShinyColor(plain);
    expect(plain.shinyColor).toBeUndefined();
  });
});
