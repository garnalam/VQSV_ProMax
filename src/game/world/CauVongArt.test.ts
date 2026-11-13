import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../public/pack/cau-vong-art");
const read = <T>(file: string): T => JSON.parse(readFileSync(resolve(root, file), "utf8")) as T;
type Piece = { file: string; mirrorFile: string; w: number; h: number } | null;
/** A PNG's size from its IHDR. */
const pngSize = (file: string) => {
  const bytes = readFileSync(resolve(root, file));
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
};

describe("Cầu Vồng art baked by ExportWebCauVongArt", () => {
  it("carries TextBox's seven source portraits", () => {
    for (let i = 0; i <= 6; i++) expect(existsSync(resolve(root, `portraits/${i}.png`))).toBe(true);
  });

  it("carries every SpriteAnimator.loadRainbow* bank no room seats, with all frames", () => {
    const sprites = read<{
      sprites: Record<string, { states: Record<string, { file?: string; mirrorFile?: string }[]> }>;
    }>("sprites.json").sprites;
    expect(Object.keys(sprites).map(Number)).toEqual([
      13000, 13100, 13101, 13102, 13103, 13104, 13105, 13200, 13201, 13202, 13203, 13204, 13205,
      13302,
    ]);
    // loadRainbowEffect: banks 0..4 hold five effects each, bank 5 the rest (ids 25..29).
    for (let group = 0; group <= 4; group++)
      expect(Object.keys(sprites[String(13100 + group)].states).length).toBeGreaterThanOrEqual(5);
    for (const sprite of Object.values(sprites))
      for (const frames of Object.values(sprite.states))
        for (const frame of frames)
          for (const file of [frame.file, frame.mirrorFile])
            if (file) expect(existsSync(resolve(root, file)), file).toBe(true);
  });

  it("keeps the finish-line regions and the arena cell the minigame view draws", () => {
    const banks = read<Record<string, { cells: Piece[]; regions: Piece[] }>>("minigame/banks.json");
    // CauVongMinigameView: finish regions 0 and 1, arena cell 0.
    expect(banks["13300"].regions[0]).not.toBeNull();
    expect(banks["13300"].regions[1]).not.toBeNull();
    expect(banks["13301"].cells[0]).not.toBeNull();
    for (const bank of Object.values(banks))
      for (const piece of [...bank.cells, ...bank.regions])
        if (piece) {
          expect(pngSize(piece.file)).toEqual({ w: piece.w, h: piece.h });
          expect(existsSync(resolve(root, piece.mirrorFile))).toBe(true);
        }
  });

  it("keeps RainbowMinigameArt's icon tables inside their atlases", () => {
    const icons = read<{ ui: number[][]; item: number[][]; itemAlias: Record<string, number> }>(
      "minigame/icons.json",
    );
    expect(icons.itemAlias).toEqual({ "35": 38 });
    for (const [table, atlas] of [
      [icons.ui, "minigame/ui.png"],
      [icons.item, "minigame/item.png"],
    ] as const) {
      const size = pngSize(atlas);
      expect(table.length).toBeGreaterThan(0);
      for (const [x, y, w, h] of table) {
        expect(w > 0 && h > 0).toBe(true);
        expect(x + w <= size.w && y + h <= size.h).toBe(true);
      }
    }
    expect(
      readdirSync(resolve(root, "minigame"))
        .filter((f) => f.endsWith(".png"))
        .sort(),
    ).toEqual(["brow-m0.png", "brow-m2.png", "brow-m3.png", "cloud.png", "item.png", "ui.png"]);
  });

  it("keeps boss.d's 103 rows of four bytes", () => {
    const boss = read<{ rows: number[][] }>("boss.json").rows;
    expect(boss).toHaveLength(103);
    for (const row of boss) expect(row).toHaveLength(4);
  });
});
