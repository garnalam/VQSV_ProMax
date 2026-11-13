import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shinyApplies, shinyRgb, type ShinyPaletteDocument } from "./PetShinyPalette";

const palette = JSON.parse(
    readFileSync("public/pack/shiny/palette.json", "utf8"),
  ) as ShinyPaletteDocument,
  sample = JSON.parse(readFileSync("public/pack/shiny/sample.json", "utf8")) as {
    profiles: Record<string, Record<string, number[]>>;
  };

/** `PetShinyPalette` against what Java produced for real pet colours (`ExportWebShinyPalette`). */
describe("shiny palette (natures 7..9)", () => {
  it("applies to natures 7, 8 and 9 only", () => {
    expect([6, 7, 8, 9, 10, undefined].map(shinyApplies)).toEqual([
      false,
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  for (const [profile, natures] of Object.entries(sample.profiles))
    for (const [nature, pairs] of Object.entries(natures))
      it(`matches Java for profile ${profile}, nature ${nature} (${pairs.length / 2} colours)`, () => {
        const wrong: string[] = [];
        for (let i = 0; i < pairs.length; i += 2) {
          const got = shinyRgb(pairs[i], Number(nature), profile, palette);
          if (got !== pairs[i + 1])
            wrong.push(
              `${pairs[i].toString(16)} -> ${got.toString(16)} != ${pairs[i + 1].toString(16)}`,
            );
        }
        expect(wrong.slice(0, 5)).toEqual([]);
      });
});
