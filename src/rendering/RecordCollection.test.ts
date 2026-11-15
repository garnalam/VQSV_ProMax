import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { drawRecordPanel } from "./RecordRenderer";
import { SourceUiLayout } from "./SourceUiLayout";
import type { PanelFontRenderer } from "./PanelFontRenderer";
import { WorldPanel } from "../game/world/WorldPanel";
import { badgeEntries } from "../game/record/RecordBook";
import { BadgeProgression } from "../game/world/WorldFlags";

describe("collection page rendering", () => {
  it("renders the recovered rank-two golden icon at 28 pixels and its 64-pixel preview", () => {
    const layout = (name: string) =>
      new SourceUiLayout(JSON.parse(readFileSync(`public/pack/ui/layout/${name}.json`, "utf8")));
    const badgeLayout = layout("badge");
    const panel = new WorldPanel();
    const badges = new BadgeProgression();
    badges.grant(7);
    badges.upgradeGolden();
    panel.mode = "badge";
    panel.selected = 7;
    panel.recordSource.badges = () => badgeEntries(badges, undefined, []);
    const pixels: number[][] = [];
    const g = new Proxy(
      {
        fillRect: (x: number, y: number, w: number, h: number) => {
          if (w === 1 && h === 1) pixels.push([x, y]);
        },
      },
      {
        get: (target, key) =>
          key in target ? target[key as keyof typeof target] : () => undefined,
      },
    ) as unknown as CanvasRenderingContext2D;
    drawRecordPanel(
      g,
      panel,
      { record: layout("record"), petmap: layout("petmap"), badge: badgeLayout },
      {
        font: {
          height: 12,
          taggedWidth: (value: string) => value.length * 5,
          drawTagged: () => undefined,
        } as unknown as PanelFontRenderer,
        cell: () => undefined,
        badgeIcon: () => undefined,
        idle: () => undefined,
      },
    );
    const icon = badgeLayout.widget(32)!;
    expect(
      pixels.some(([x, y]) => x >= icon.x && x < icon.x + 28 && y >= icon.y && y < icon.y + 28),
    ).toBe(true);
    expect(pixels.some(([x, y]) => x >= 125 && x < 189 && y >= 174 && y < 238)).toBe(true);
  });

  it("shows recovered selectors and draws seen shiny previews returned as canvas images", () => {
    const layout = (name: string) =>
      new SourceUiLayout(JSON.parse(readFileSync(`public/pack/ui/layout/${name}.json`, "utf8")));
    const panel = new WorldPanel();
    panel.mode = "petmap";
    panel.changePetmapPage(2, 3);
    panel.recordSource.petmapRows = () => [
      { speciesId: 202, spriteId: 202, name: "Pet 202", seen: true, owned: false },
    ];
    const texts: string[] = [],
      previews: number[][] = [],
      drawn: unknown[] = [];
    const canvas = { width: 16, height: 16 } as HTMLCanvasElement;
    const g = new Proxy(
      { drawImage: (image: unknown) => drawn.push(image) },
      {
        get: (target, key) =>
          key in target ? target[key as keyof typeof target] : () => undefined,
      },
    ) as unknown as CanvasRenderingContext2D;
    drawRecordPanel(
      g,
      panel,
      { record: layout("record"), petmap: layout("petmap"), badge: layout("badge") },
      {
        font: {
          taggedWidth: (value: string) => value.length * 5,
          drawTagged: (_g: unknown, text: string) => texts.push(text),
        } as unknown as PanelFontRenderer,
        cell: () => undefined,
        badgeIcon: () => undefined,
        idle: (spriteId, shinyColor) => {
          previews.push([spriteId, shinyColor ?? -1]);
          return { image: canvas, ox: 0, oy: 0 };
        },
      },
    );
    // Page 3 of V4 is shiny colour 2 (Bình minh), drawn between its own arrows.
    expect(texts).toContain("< V4 >");
    expect(texts).toEqual(expect.arrayContaining(["<", "Bình minh", ">"]));
    expect(texts).toContain("Đổi mục");
    expect(previews).toEqual([[202, 2]]);
    expect(drawn).toContain(canvas);
  });
});
