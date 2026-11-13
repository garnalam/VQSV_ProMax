import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TextLayout, visibleLength, type TextMetricsDocument } from "./TextLayout";

const layout = new TextLayout(
  JSON.parse(readFileSync("public/pack/font/text-metrics.json", "utf8")) as TextMetricsDocument,
);

/** Every string value in a JSON document. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => strings(v, out));
  return out;
}

describe("TextLayout (JavaSE UiFont / TextBox rules)", () => {
  it("measures with the exported Tahoma 9 advances; a space is 3 px", () => {
    expect(layout.charWidth(" ")).toBe(3);
    expect(layout.spaceWord).toBe([..."nhung1"].reduce((sum, ch) => sum + layout.charWidth(ch), 0));
  });

  it("has a width for every character the story and quest data can show", () => {
    const missing = new Set<string>();
    for (const file of [
      "public/pack/story/event-scenes.json",
      "public/pack/story/world-contract.json",
    ])
      for (const text of strings(JSON.parse(readFileSync(file, "utf8"))))
        for (const ch of text) if (!layout.has(ch) && ch >= " ") missing.add(ch);
    expect([...missing]).toEqual([]);
  });

  it("drops the space at a soft break and keeps the words on separate lines", () => {
    const text = "Sophie, đã qua vài năm tôi muốn gặp cha mẹ cậu. ".repeat(3).trim(),
      lines = layout.wrap(text, 230);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => !line.startsWith(" "))).toBe(true);
    expect(lines.join(" ")).toBe(text);
  });

  it("paginates four lines per page, each page opening with the colour in force", () => {
    const long = "#000000" + "một hai ba bốn năm sáu bảy tám chín mười ".repeat(12).trim(),
      pages = layout.paginate(long, 230, 4);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0].startsWith("#FFFFFF#000000")).toBe(true);
    expect(pages.slice(1).every((page) => page.startsWith("#000000"))).toBe(true);
    for (const page of pages)
      expect(layout.wrap(page.replace(/#[0-9A-F]{6}/g, ""), 230).length).toBeLessThanOrEqual(4);
    const words = (s: string) => s.replace(/#[0-9A-F]{6}/g, "").replace(/\s+/g, "");
    expect(pages.map(words).join("")).toBe(words(long));
  });

  it("marks each break inside a page, so no word runs into the next (Java drew 'luậtcủ|a')", () => {
    const text =
        "Ổn chứ, nơi này là đấu trường Lục Hành Điểu, luật của trò chơi chính là tính thời gian thi chạy ~ nếu trong thời gian quy định đến được đích, sẽ nhận được phần thưởng ~ Bắt đầu chứ?",
      pages = layout.paginate("#000000" + text, 224, 4),
      lines = pages.flatMap((page) => page.replace(/#[0-9A-F]{6}/g, "").split("\n"));
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.join(" ")).toBe(text);
    for (const line of lines)
      expect([...line].reduce((w, ch) => w + layout.charWidth(ch), 0)).toBeLessThanOrEqual(
        224 - 10,
      );
  });

  it("counts typing length without colour tags", () => {
    expect(visibleLength("#FFFFFF#000000abc")).toBe(3);
    expect(visibleLength("#1x")).toBe(1);
  });
});
