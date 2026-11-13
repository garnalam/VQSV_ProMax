import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeSourceFont, sourceTextWidth } from "./SourceFont";

const font = decodeSourceFont(new Uint8Array(readFileSync("public/pack/font/font.bin")));

/** Render one glyph as rows of '#'/'.' for exact pixel assertions. */
function glyph(ch: string): string[] {
  const g = font.glyphs.get(ch.codePointAt(0)!)!;
  return Array.from({ length: font.height }, (_, y) =>
    Array.from({ length: g.w }, (_, x) =>
      font.mask[y * font.atlasWidth + g.x + x] ? "#" : ".",
    ).join(""),
  );
}

describe("font.bin (original game bitmap font)", () => {
  it("decodes the 227-glyph table at 10px with an 8px ascent", () => {
    expect(font.glyphs.size).toBe(227);
    expect(font.height).toBe(10);
    expect(font.ascent).toBe(8);
    expect(font.atlasWidth).toBe(1264);
  });

  it("decodes glyph pixels LSB-first", () => {
    expect(glyph("A")).toEqual([
      ".......",
      "..##...",
      "..##...",
      ".#..#..",
      ".#..#..",
      "######.",
      "#....#.",
      "#....#.",
      ".......",
      ".......",
    ]);
    expect(glyph("g").slice(7)).toEqual([".###.", "...#.", ".##.."]);
  });

  it("covers every string the boot and title screens draw", () => {
    const strings = [
      "Bạn có muốn bật nhạc không?",
      "Tắt nhạc có thể tăng tốc độ chơi",
      "Chơi mới sẽ xóa dữ liệu cũ.",
      "Bạn có chắc muốn tiếp tục?",
      "Bỏ qua đoạn giới thiệu?",
      "Nhảy tới mười năm sau",
      "Chơi tiếp Chơi mới Tùy chọn Trợ giúp Giới thiệu Thoát Quay lại Có Không Xóa Hủy",
      "VQSV Liệt Hỏa Rebuild",
      "Bản rebuild đang được hoàn thiện",
      "theo từng chức năng gameplay.",
      "Trình duyệt không cho trang tự đóng",
      "Bạn có thể đóng tab này.",
      "World Runtime chưa triển khai",
      "Trạng thái menu đã hoàn tất",
      "Ranh giới chưa triển khai",
      "World/Panel sẽ được nối sau",
    ];
    const missing = new Set<string>();
    for (const text of strings)
      for (const ch of text) if (!font.glyphs.has(ch.codePointAt(0)!)) missing.add(ch);
    expect([...missing]).toEqual([]);
  });

  it("measures text as the sum of advances", () => {
    expect(sourceTextWidth(font, "AA")).toBe(14);
    expect(sourceTextWidth(font, " ")).toBe(3);
  });

  it("rejects a truncated file", () => {
    expect(() => decodeSourceFont(new Uint8Array([0, 5, 65]))).toThrow();
  });
});
