import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openingQuestDetail, type CauVongOpeningDocument } from "./CauVongOpening";

const document = JSON.parse(
  readFileSync("public/pack/cau-vong-world/opening.json", "utf8"),
) as CauVongOpeningDocument;
const quest = document.quests.find((row) => row.done[0] === 9 && row.done[1] === 114)!;
const detail = (flags: string[]) => openingQuestDetail(quest, (f) => flags.includes(f.join(":")));

describe("four-gate guidance follows the pending story owner", () => {
  it("finishes the dorm morning before sending the rescued teacher report", () => {
    expect(detail(["26:100", "59:130"])).toContain("Xem hết cuộc nói chuyện sáng hôm sau");
    expect(detail(["26:100", "59:130", "59:131"])).toContain("Đến đấu trường trung cấp");
  });
  it("only sends An Ky Nhi on the campus tour on the academy source route", () => {
    expect(detail(["3:110"])).toContain("hai anh em bắt Hoàng Dực Điểu");
    expect(detail(["3:110", "2:140"])).toContain("tham quan trường");
    expect(detail(["3:110", "4:170", "2:904"])).toContain("nghỉ qua đêm");
  });
});
