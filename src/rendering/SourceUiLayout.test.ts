import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SourceUiLayout } from "./SourceUiLayout";
describe("decoded Java battle.ui contract", () => {
  const layout = new SourceUiLayout(
    JSON.parse(readFileSync("public/pack/ui/layout/battle.json", "utf8")),
  );
  it("keeps source frame and HUD widget geometry", () => {
    expect(layout.widget(1)).toMatchObject({ x: 0, y: 0, w: 103, altId: 92 });
    expect(layout.widget(2)).toMatchObject({ x: 0, y: 235, w: 240, altId: 93 });
    expect(layout.widget(14)).toMatchObject({ x: 5, y: 16, w: 82, h: 4, bandHeight: 4 });
    expect(layout.widget(11)).toMatchObject({ x: 153, y: 252, w: 82, h: 4, bandHeight: 4 });
    expect(layout.widget(9)).toMatchObject({ x: 29, y: 261, w: 202, h: 4, bandHeight: 4 });
  });
  it("keeps source labels and element anchors", () => {
    expect(layout.widget(15)).toMatchObject({ x: 3, y: 2, w: 60, b: 3 });
    expect(layout.widget(12)).toMatchObject({ x: 153, y: 238, w: 60, b: 3 });
    expect(layout.widget(18)).toMatchObject({ x: 92, y: 2, altId: 94 });
    expect(layout.widget(17)).toMatchObject({ x: 139, y: 249, altId: 94 });
  });
});
