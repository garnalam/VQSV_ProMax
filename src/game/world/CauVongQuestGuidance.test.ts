import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  currentOpeningQuest,
  openingQuestDetail,
  type CauVongOpeningDocument,
} from "./CauVongOpening";

const document = JSON.parse(
  readFileSync("public/pack/cau-vong-world/opening.json", "utf8"),
) as CauVongOpeningDocument;
const quests = document.quests;
const titled = (prefix: string) => quests.find((row) => row.title.startsWith(prefix))!;
const detail = (prefix: string, flags: string[]) =>
  openingQuestDetail(titled(prefix), (f) => flags.includes(f.join(":")));

describe("Cầu Vồng's main rows are the owner's five chapters", () => {
  it("chains the chapters: each is opened by the flag that finishes the one before", () => {
    const main = quests.filter((row) => row.title.startsWith("Cầu Vồng "));
    expect(main.map((row) => row.title)).toEqual([
      "Cầu Vồng 1 — Mở đầu",
      "Cầu Vồng 2 — Học viện",
      "Cầu Vồng 3 — Bốn Cổng",
      "Cầu Vồng 4 — An Kỳ Nhi",
      "Cầu Vồng 5 — Bắc Hải",
    ]);
    expect(main[0].show).toBeNull();
    for (let i = 1; i < main.length; i++) expect(main[i].show).toEqual(main[i - 1].done);
    // Thiên Không is the post-story row, listed last.
    expect(quests.at(-1)!.title).toBe("Thiên Không — Phòng triệu tập");
  });

  it("walks the whole story: one open chapter at a time, each step a new line, in order", () => {
    // The completion order the playthrough tests record, chapter by chapter.
    const route = [
      ["54:100", "1:101", "5:103+5:104+5:105", "6:7007", "6:100"],
      [
        "54:130",
        "55:139",
        "2:101+2:140",
        "8:2",
        "4:104",
        "2:141",
        "59:102",
        "2:142",
        "2:143",
        "3:101",
        "3:102",
      ],
      ["9:101", "9:103", "20:100", "9:1617", "9:104", "59:130", "59:131+26:100", "4:1500"],
      ["3:110", "2:904", "59:907", "3:113", "58:101", "59:121", "4:1501", "9:114"],
      ["30:104", "35:102", "61:102", "61:105", "48:120", "30:124"],
    ];
    const flags: string[] = [];
    const open = () => currentOpeningQuest(quests, (f) => flags.includes(f.join(":")));
    const lines: string[] = [];
    route.forEach((steps, chapter) => {
      const title = `Cầu Vồng ${chapter + 1} `;
      for (const step of steps) {
        const row = open()!;
        expect(row.title.startsWith(title), `${step}: ${row.title}`).toBe(true);
        lines.push(openingQuestDetail(row, (f) => flags.includes(f.join(":"))));
        flags.push(...step.split("+"));
      }
    });
    // Every step shows its own guidance, and the story's end leaves no Cầu Vồng chapter open.
    expect(new Set(lines).size).toBe(lines.length);
    expect(open()).toBeUndefined();
  });

  it("finishes the dorm morning before sending the rescued teacher report", () => {
    expect(detail("Cầu Vồng 3", ["26:100", "59:130"])).toContain(
      "Xem hết cuộc nói chuyện sáng hôm sau",
    );
    expect(detail("Cầu Vồng 3", ["26:100", "59:130", "59:131"])).toContain(
      "Đến đấu trường trung cấp",
    );
  });

  it("only sends An Ky Nhi on the campus tour on the academy source route", () => {
    expect(detail("Cầu Vồng 4", ["3:110"])).toContain("hai anh em bắt Hoàng Dực Điểu");
    expect(detail("Cầu Vồng 4", ["3:110", "2:140"])).toContain("tham quan trường");
    expect(detail("Cầu Vồng 4", ["3:110", "4:170", "2:904"])).toContain("nghỉ qua đêm");
  });
});
