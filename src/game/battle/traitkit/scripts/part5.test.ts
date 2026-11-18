import { describe, expect, it } from "vitest";
import { renderTraitText as renderTuned, setTraitTuning, traitTuning } from "../TraitKit";

/** Mẫu mô tả với tham số mặc định (bỏ qua tuning.json): phải khớp đúng bản phác thảo đã duyệt. */
function renderTraitText(...args: Parameters<typeof renderTuned>): ReturnType<typeof renderTuned> {
  const saved = traitTuning();
  setTraitTuning({});
  try {
    return renderTuned(...args);
  } finally {
    setTraitTuning(saved);
  }
}
import { PART_5 } from "./part5";

const { duel, double, pet, dummy, skillId } = await import("../TraitScenario.testutil");
type Setup = ReturnType<typeof pet>;
type Result = ReturnType<typeof duel>;
type Order = [number, 0 | 1 | 2 | 3];

const SLOW = { speed: 1 };
const FAST = { speed: 9999 };
const sk = (...names: string[]) => names.map(skillId);
/** Đối thủ đánh trước, đủ đau để pet mất máu, rất trâu. */
const bruiser = (extra: Partial<{ attack: number; speed: number }> = {}) =>
  pet(34, { skills: [30], stats: { speed: 9999, hp: 99999, ...extra } });
/** Đối thủ đánh sau (vẫn đánh đau), rất trâu. */
const lateBruiser = () => pet(34, { skills: [30], stats: { speed: 1, hp: 99999 } });
/** Đối thủ đánh sau, rất trâu, đánh rất yếu. */
const slowDummy = (skills?: number[]) => dummy(34, { stats: SLOW, ...(skills ? { skills } : {}) });
/** Đối thủ trâu, đánh sau, đang ở `hpPct`% HP. */
const wounded = (hpPct: number) =>
  pet(68, { skills: [30], hpPct, stats: { hp: 30000, attack: 1, speed: 1 } });
/** Đối thủ gần gục. */
const weak = () => pet(34, { skills: [30], hpPct: 3, stats: { hp: 100, attack: 1, speed: 1 } });

/** `n` vòng 2v2 giống nhau. */
const rounds = (n: number, me: Order, ally: Order = [0, 0]): Order[][] =>
  Array.from({ length: n }, () => [me, ally]);

function has(result: Result, species: number, labels: string[]): void {
  expect(result.procs(species)).toEqual(expect.arrayContaining(labels));
}
/** Có lần kích hoạt `label` tác động lên loài `target` phe `side`. */
function hits(result: Result, species: number, label: string, target: number, side = 0): void {
  expect(
    result.log.some(
      (p) =>
        p.speciesId === species &&
        p.label === label &&
        p.targetSpecies === target &&
        p.targetSide === side,
    ),
    `${label} → ${target}: ${JSON.stringify(result.log.filter((p) => p.speciesId === species))}`,
  ).toBe(true);
}

/** Đồng đội trung tính hệ Hỏa (loài 68 không có kịch bản trong phần này). */
const mate = (extra: Parameters<typeof pet>[1] = {}): Setup =>
  pet(68, { skills: sk("Hỏa trảo"), ...extra, stats: { hp: 99999, ...extra.stats } });

describe("kịch bản đặc tính phần 5: chạy trong 1v1 và 2v2", () => {
  it("160 Nanh heo cuồng nộ: tụt 35% thì khiên + Sức mạnh; ra sau +sát thương", () => {
    const S = 160;
    const me = () => pet(S, { skills: sk("Nham bạo"), hpPct: 40, stats: { ...SLOW, hp: 5000 } });
    has(duel([me()], [bruiser({ attack: 400 })], [0, 0]), S, ["cuồng nộ", "ra sau +sát thương"]);
    const two = double(
      [me(), mate()],
      [bruiser({ attack: 400 }), bruiser({ attack: 400 })],
      rounds(2, [0, 0]),
    );
    has(two, S, ["cuồng nộ", "ra sau +sát thương"]);
  });

  it("161 Trư vương bất khuất: tụt 40% thì khiên + 3 tầng DEF, khiên còn thì phản đòn", () => {
    const S = 161;
    const me = () => pet(S, { skills: sk("Nham bạo"), hpPct: 45, stats: { ...SLOW, hp: 5000 } });
    has(duel([me()], [bruiser({ attack: 400 })], [0, 0, 0]), S, ["bất khuất", "phản đòn"]);
    const two = double(
      [me(), mate()],
      [bruiser({ attack: 400 }), bruiser({ attack: 400 })],
      rounds(3, [0, 0]),
    );
    has(two, S, ["bất khuất", "phản đòn"]);
  });

  it("162 Đốm trư đảo nhịp: chiêu Thổ gây Mê Muội, đối thủ bị khống chế thì ưu tiên", () => {
    const S = 162;
    const me = () => pet(S, { skills: sk("Nham bạo"), stats: SLOW });
    const foe = () => dummy(34, { stats: FAST });
    has(duel([me()], [foe()], [0, 0, 0]), S, ["mê muội", "ưu tiên"]);
    has(double([me(), mate()], [foe(), foe()], rounds(3, [0, 0])), S, ["mê muội", "ưu tiên"]);
  });

  it("163 Nanh kiếm rạch thịt: đẩy qua 50% gây Xé Rách, đánh mục tiêu Xé Rách +sát thương", () => {
    const S = 163;
    const me = () => pet(S, { skills: sk("Yến Hồi Thiểm"), stats: FAST });
    const foe = () =>
      pet(34, { skills: [30], hpPct: 52, stats: { hp: 3000, attack: 1, speed: 1 } });
    has(duel([me()], [foe()], [0, 0]), S, ["xé rách", "rạch thịt +sát thương"]);
    const two = double([me(), mate()], [foe(), slowDummy()], rounds(2, [0, 0], [0, 1]));
    has(two, S, ["xé rách", "rạch thịt +sát thương"]);
  });

  it("164 Kiếm nha tuyệt sát: đẩy qua 50% gây Xé Rách; mục tiêu dưới 35% thì ưu tiên", () => {
    const S = 164;
    const me = (stats = FAST) => pet(S, { skills: sk("Yến Hồi Thiểm"), stats });
    const foe = () =>
      pet(34, { skills: [30], hpPct: 52, stats: { hp: 3000, attack: 1, speed: 1 } });
    has(duel([me()], [foe()], [0]), S, ["xé rách"]);
    const low = () =>
      pet(34, { skills: [30], hpPct: 30, stats: { hp: 99999, attack: 1, speed: 9999 } });
    has(duel([me(SLOW)], [low()], [0]), S, ["ưu tiên kết liễu"]);
    has(double([me(SLOW), mate()], [low(), low()], rounds(1, [0, 0])), S, ["ưu tiên kết liễu"]);
    has(double([me(), mate()], [foe(), slowDummy()], rounds(1, [0, 0], [0, 1])), S, ["xé rách"]);
  });

  it("165 Mị ảnh phân thân: ra đòn trước thì đòn đầu nhắm vào pet giảm sát thương", () => {
    const S = 165;
    const me = () => pet(S, { skills: sk("Độc ảnh thứ"), stats: { ...FAST, hp: 99999 } });
    has(duel([me()], [lateBruiser()], [0]), S, ["mị ảnh", "mị ảnh giảm"]);
    has(double([me(), mate()], [lateBruiser(), lateBruiser()], rounds(1, [0, 0])), S, [
      "mị ảnh",
      "mị ảnh giảm",
    ]);
  });

  it("166 Dị lôi luân chuyển: đổi chiêu tích Điện tích, lặp chiêu mất tầng", () => {
    const S = 166;
    const me = () => pet(S, { skills: sk("Tia lửa điện", "Chùm sấm sét"), stats: FAST });
    has(duel([me()], [slowDummy()], [0, 1, 0, 0]), S, [
      "tích điện",
      "điện tích +sát thương",
      "mất điện",
    ]);
    const two = double(
      [me(), mate()],
      [slowDummy(), slowDummy()],
      [...rounds(1, [0, 0]), ...rounds(1, [1, 1]), ...rounds(2, [0, 0])],
    );
    has(two, S, ["tích điện", "điện tích +sát thương", "mất điện"]);
  });

  it("167 Chân dị lôi đà: bị đánh tích Đà, đòn kế tiêu dấu và có thể gây Tê Liệt", () => {
    const S = 167;
    const me = () => pet(S, { skills: sk("Điện giật"), stats: { ...SLOW, hp: 99999 } });
    has(duel([me()], [bruiser()], [0, 0, 0, 0, 0, 0]), S, ["tích đà", "tiêu đà"]);
    has(double([me(), mate()], [bruiser(), bruiser()], rounds(3, [0, 0])), S, [
      "tích đà",
      "tiêu đà",
    ]);
  });

  it("168 Bọt nước hộ thân: dùng chiêu hồi thì có khiên, khiên hết hạn hóa máu", () => {
    const S = 168;
    const me = () =>
      pet(S, { skills: sk("Lam Tuyền Chữa Lành", "Phệ Hồn Ấn"), hpPct: 20, stats: FAST });
    has(duel([me()], [slowDummy()], [0, 1, 1]), S, ["bọt nước", "bọt hóa máu"]);
    has(
      double(
        [me(), mate()],
        [slowDummy(), slowDummy()],
        [...rounds(1, [0, 2]), ...rounds(2, [1, 0])],
      ),
      S,
      ["bọt nước", "bọt hóa máu"],
    );
  });

  it("169 Kình triều dâng: bị đánh tích Triều, cuối lượt hồi máu", () => {
    const S = 169;
    const me = () => pet(S, { skills: sk("Ray lạnh"), hpPct: 60, stats: { ...SLOW, hp: 99999 } });
    has(duel([me()], [bruiser()], [0, 0]), S, ["tích triều", "triều hồi"]);
    has(double([me(), mate()], [bruiser(), bruiser()], rounds(2, [0, 0])), S, [
      "tích triều",
      "triều hồi",
    ]);
  });

  it("170 Kình hống phá lãng: tích Triều, · Tỏa xả Triều thành sát thương", () => {
    const S = 170;
    const me = () =>
      pet(S, {
        skills: sk("Ray lạnh", "Yếu Tắc Hải Thành · Tỏa"),
        hpPct: 60,
        stats: { ...SLOW, hp: 99999 },
      });
    has(duel([me()], [bruiser()], [0, 1]), S, ["tích triều", "triều hồi", "xả triều"]);
    has(
      double([me(), mate()], [bruiser(), bruiser()], [...rounds(1, [0, 0]), ...rounds(1, [1, 0])]),
      S,
      ["tích triều", "xả triều"],
    );
  });

  it("171 Yếu tắc hải thành: tích Triều cả khi đồng đội bị đánh, giảm sát thương, đủ 3 tầng thì rút hồi cả hai", () => {
    const S = 171;
    const me = () => pet(S, { skills: sk("Ray lạnh"), hpPct: 60, stats: { ...SLOW, hp: 99999 } });
    // 2 lượt mới có 2 tầng: chưa rút; lượt 3 đủ 3 tầng thì Triều rút và hồi.
    const early = duel([me()], [bruiser()], [0, 0]);
    has(early, S, ["tích triều", "hải thành giảm"]);
    expect(early.procs(S)).not.toContain("triều rút");
    has(duel([me()], [bruiser()], [0, 0, 0]), S, ["triều rút", "triều hồi"]);
    const two = double(
      [
        me(),
        pet(175, { skills: sk("Ray lạnh"), hpPct: 40, stats: { ...SLOW, hp: 99999, defense: 1 } }),
      ],
      [bruiser(), bruiser()],
      rounds(5, [0, 0]),
    );
    has(two, S, ["tích triều đồng đội", "triều rút", "triều hồi đồng đội", "hải thành giảm"]);
    hits(two, S, "tích triều đồng đội", 175);
    hits(two, S, "triều hồi đồng đội", 175);
  });

  it("172 Băng nhận rạch giáp: phá giáp, gặp buff DEF thì xóa buff", () => {
    const S = 172;
    const me = () => pet(S, { skills: sk("Yến Hồi Thiểm"), stats: FAST });
    const foe = () => slowDummy(sk("Thổ thuẫn"));
    has(duel([me()], [foe()], [0, 0, 0]), S, ["phá giáp", "xóa buff DEF"]);
    has(double([me(), mate()], [foe(), foe()], rounds(3, [0, 0])), S, ["phá giáp", "xóa buff DEF"]);
  });

  it("173 Đao phong đoạt bảo: phá giáp, · Phá gỡ buff thì đoạt buff", () => {
    const S = 173;
    const me = () => pet(S, { skills: sk("Đế Cụt Hải Trảm · Phá"), stats: FAST });
    const foe = () => slowDummy(sk("Thổ thuẫn"));
    has(duel([me()], [foe()], [0, 0, 0]), S, ["phá giáp", "đoạt buff"]);
    has(double([me(), mate()], [foe(), foe()], rounds(3, [0, 0])), S, ["phá giáp", "đoạt buff"]);
  });

  it("174 Đế cụt băng triều: đủ 3 tầng thì +sát thương; 2v2 lan tầng sang đối thủ còn lại", () => {
    const S = 174;
    const me = () => pet(S, { skills: sk("Phi Yến Hoàn Sào"), stats: FAST });
    has(duel([me()], [slowDummy()], [0, 0, 0, 0]), S, ["phá giáp", "giáp vỡ +sát thương"]);
    const two = double([me(), mate()], [slowDummy(), slowDummy()], rounds(4, [0, 0], [0, 1]));
    has(two, S, ["phá giáp", "giáp vỡ +sát thương", "lan phá giáp"]);
    hits(two, S, "lan phá giáp", 34, 1);
  });

  it("175 Mai rùa song thế: trên 50% giảm sát thương, từ 50% trở xuống bị đánh thì thêm giáp", () => {
    const S = 175;
    const me = (hpPct: number) => pet(S, { skills: sk("Thủy Linh Hồi Sinh"), hpPct, stats: SLOW });
    has(duel([me(100)], [bruiser()], [0]), S, ["mai rùa giảm"]);
    has(duel([me(45)], [bruiser()], [0]), S, ["mai rùa giáp"]);
    has(double([me(45), mate()], [bruiser(), bruiser()], rounds(1, [0, 2])), S, ["mai rùa giáp"]);
  });

  it("176 Huyền giáp trinh sát: bị đánh có khiên, kẻ phá khiên bị giảm chính xác", () => {
    const S = 176;
    const me = () => pet(S, { skills: sk("Thủy Linh Hồi Sinh"), stats: { ...SLOW, hp: 5000 } });
    has(duel([me()], [bruiser({ attack: 1500 })], [0, 0]), S, ["huyền giáp", "vỡ khiên mù"]);
    const two = double(
      [me(), mate()],
      [bruiser({ attack: 1500 }), bruiser({ attack: 1500 })],
      rounds(2, [0, 2]),
    );
    has(two, S, ["huyền giáp", "vỡ khiên mù"]);
  });

  it("177 U minh hủ giáp: bị đánh có khiên, đánh vào khiên thì dính Hủ Thực", () => {
    const S = 177;
    const me = () => pet(S, { skills: sk("Phệ Hồn Ấn"), stats: { ...SLOW, hp: 99999 } });
    has(duel([me()], [bruiser()], [0, 0]), S, ["khiên u minh", "hủ giáp"]);
    has(double([me(), mate()], [bruiser(), bruiser()], rounds(2, [0, 0])), S, [
      "khiên u minh",
      "hủ giáp",
    ]);
  });

  it("178 Địa thành cự quy: đòn đầu mỗi lượt giảm sát thương, tầng DEF cộng sát thương", () => {
    const S = 178;
    const me = () => pet(S, { skills: sk("Hàng rào cát đá"), stats: { ...SLOW, hp: 99999 } });
    has(duel([me()], [bruiser()], [0, 0]), S, ["địa thành giảm", "giáp +sát thương"]);
    has(double([me(), mate()], [bruiser(), bruiser()], rounds(2, [0, 0])), S, [
      "địa thành giảm",
      "giáp +sát thương",
    ]);
  });

  it("179 Kim giáp lột xác: chiêu hồi trao 2 tầng DEF; từ 2 tầng thì giảm sát thương", () => {
    const S = 179;
    const me = () => pet(S, { skills: sk("Thủy Linh Hồi Sinh"), hpPct: 50, stats: { hp: 99999 } });
    has(duel([me()], [lateBruiser()], [0, 0]), S, ["kim giáp", "kim giáp giảm"]);
    const two = double([me(), mate({ hpPct: 50 })], [slowDummy(), slowDummy()], rounds(1, [0, 3]));
    hits(two, S, "kim giáp", 68);
  });

  it("180 Ngân giáp tái sinh: tầng DEF hồi máu cuối lượt, đủ 3 tầng thì phản", () => {
    const S = 180;
    const me = () =>
      pet(S, { skills: sk("Hàng rào cát đá"), hpPct: 50, stats: { ...SLOW, hp: 99999 } });
    has(duel([me()], [bruiser()], [0, 0, 0]), S, ["ngân giáp hồi", "ngân giáp phản"]);
    has(double([me(), mate()], [bruiser(), bruiser()], rounds(3, [0, 0])), S, [
      "ngân giáp hồi",
      "ngân giáp phản",
    ]);
  });

  it("181 Thiên giải hồi giáp: chiêu hồi trao giáp, cuối lượt hồi theo tầng giáp đã trao", () => {
    const S = 181;
    const me = () => pet(S, { skills: sk("Thiên Giải Hồi Giáp · Dưỡng"), hpPct: 30, stats: FAST });
    has(duel([me()], [slowDummy()], [0]), S, ["trao giáp", "giáp hồi"]);
    const two = double([me(), mate({ hpPct: 30 })], [slowDummy(), slowDummy()], rounds(1, [0, 3]));
    hits(two, S, "trao giáp", 68);
    hits(two, S, "giáp hồi đồng đội", 68);
  });

  it("182 Âm lôi lan tỏa: chiêu Lôi gây Tê Liệt, đánh mục tiêu bị trói +sát thương; 2v2 giật lan", () => {
    const S = 182;
    const me = () => pet(S, { skills: sk("Tia lửa điện"), stats: FAST });
    has(duel([me()], [slowDummy()], [0, 0]), S, ["tê liệt", "âm lôi +sát thương"]);
    const two = double([me(), mate()], [slowDummy(), slowDummy()], rounds(2, [0, 0], [0, 1]));
    has(two, S, ["tê liệt", "âm lôi +sát thương", "giật lan"]);
    hits(two, S, "giật lan", 34, 1);
  });

  it("183 Hải đồn tiếp sức: không đổi được thì tự nhận khiên và đòn +; 2v2 đồng đội nhanh hơn", () => {
    const S = 183;
    const me = () =>
      pet(S, { skills: sk("Hải Đồn Tật Chuyển · Chuyển", "Yến Hồi Thiểm"), stats: FAST });
    has(duel([me()], [slowDummy()], [0, 1]), S, ["tự tiếp sức", "đòn tiếp sức"]);
    const two = double(
      [me(), mate()],
      [slowDummy(), slowDummy()],
      [...rounds(1, [0, 0]), ...rounds(1, [1, 0])],
    );
    has(two, S, ["tự tiếp sức", "đòn tiếp sức"]);
    hits(two, S, "đồng đội nhanh", 68);
  });

  it("184 Chiến mã xung phong: ra trước/đánh mục tiêu Gieo Hạt tích Đà, · Bạo tiêu Đà", () => {
    const S = 184;
    const me = () => pet(S, { skills: sk("Dương viêm", "Chiến Mã Liệt Xung · Bạo"), stats: FAST });
    has(duel([me()], [slowDummy()], [0, 0, 1]), S, ["tích đà", "đà +sát thương", "tiêu đà"]);
    const two = double(
      [me(), mate()],
      [slowDummy(), slowDummy()],
      [...rounds(2, [0, 0]), ...rounds(1, [1, 0])],
    );
    has(two, S, ["tích đà", "tiêu đà"]);
  });

  it("185 Phán quyết Sổ Sinh Tử: chặn đòn hạ gục, giữ HP, khiên lớn, đòn Quỷ hút máu", () => {
    const S = 185;
    const me = () => pet(S, { skills: sk("Độc ảnh thứ"), hpPct: 60, stats: SLOW });
    has(duel([me()], [bruiser({ attack: 99999 })], [0]), S, [
      "chặn hạ gục",
      "sổ sinh tử",
      "hút hồn",
    ]);
    const two = double(
      [me(), mate()],
      [bruiser({ attack: 99999 }), slowDummy()],
      rounds(1, [0, 1], [0, 1]),
    );
    has(two, S, ["sổ sinh tử", "hút hồn"]);
  });

  it("186 Địa phủ câu hồn: đối thủ dưới 50% thì hút máu; hạ gục thì hồi và ưu tiên", () => {
    const S = 186;
    const me = () => pet(S, { skills: sk("Độc ảnh thứ"), hpPct: 50, stats: SLOW });
    has(duel([me()], [wounded(40)], [0]), S, ["câu hồn"]);
    const fastFoe = () => dummy(34, { stats: FAST });
    has(duel([me()], [weak(), fastFoe()], [0, 0, 0]), S, ["thu hồn", "ưu tiên thu hồn"]);
    const two = double(
      [me(), mate({ stats: SLOW })],
      [weak(), fastFoe()],
      [...rounds(1, [0, 0], [0, 1]), ...rounds(1, [0, 1], [0, 1])],
    );
    has(two, S, ["thu hồn", "ưu tiên thu hồn"]);
  });

  it("187 Rễ mục hút sinh: Hủ Thực của pet trừ máu thì hồi; 2v2 hồi đồng minh thấp máu hơn", () => {
    const S = 187;
    const me = (hpPct = 50) => pet(S, { skills: sk("Mạn Độc Triền Sinh"), hpPct, stats: FAST });
    has(duel([me()], [slowDummy()], [0]), S, ["rễ mục hồi"]);
    const two = double(
      [me(80), mate({ hpPct: 20 })],
      [slowDummy(), slowDummy()],
      rounds(1, [0, 0]),
    );
    hits(two, S, "rễ mục hồi đồng đội", 68);
  });

  it("188 Ngàn năm mục lâm: tick Hủ Thực hồi + giáp; kẻ mang độc gục thì độc lan", () => {
    const S = 188;
    const me = () => pet(S, { skills: sk("Mạn Độc Triền Sinh"), hpPct: 50, stats: FAST });
    const frail = () => pet(34, { skills: [30], stats: { hp: 400, attack: 1, speed: 1 } });
    has(duel([me()], [frail(), slowDummy()], [0, 0, 0, 0]), S, ["mục lâm hồi", "lan hủ thực"]);
    const two = double(
      [me(), mate({ stats: { attack: 1 } })],
      [frail(), slowDummy()],
      rounds(2, [0, 0], [0, 1]),
    );
    has(two, S, ["mục lâm hồi", "lan hủ thực"]);
    hits(two, S, "lan hủ thực", 34, 1);
  });

  it("189 Hoa tiên tịnh thế: hồi cả đội cuối lượt, tẩy hiệu ứng xấu, hồi tràn thành khiên", () => {
    const S = 189;
    const me = (hpPct: number) => pet(S, { skills: sk("Lam Tuyền Chữa Lành"), hpPct, stats: FAST });
    const debuffer = () => slowDummy(sk("Phong áp"));
    has(duel([me(50)], [debuffer()], [0, 0, 0]), S, ["tiên hồi", "tịnh thế", "tiên dưỡng"]);
    has(duel([me(90)], [slowDummy()], [0]), S, ["hồi tràn thành khiên"]);
    const two = double([me(50), mate({ hpPct: 50 })], [debuffer(), debuffer()], rounds(3, [0, 3]));
    hits(two, S, "tiên hồi đồng đội", 68);
    has(two, S, ["tịnh thế", "tiên dưỡng"]);
  });

  it("190 Lân sắt tích giáp: bị đánh thêm giáp, đủ 3 tầng thì phản", () => {
    const S = 190;
    const me = () => pet(S, { skills: sk("Hàng rào cát đá"), stats: { ...SLOW, hp: 99999 } });
    has(duel([me()], [bruiser()], [0, 0]), S, ["lân sắt", "lân sắt phản"]);
    has(double([me(), mate()], [bruiser(), bruiser()], rounds(2, [0, 0])), S, [
      "lân sắt",
      "lân sắt phản",
    ]);
  });

  it("191 Vượt long môn: bị đánh thêm giáp, lần đầu dưới 50% thì hóa rồng", () => {
    const S = 191;
    const me = () =>
      pet(S, { skills: sk("Hàng rào cát đá"), hpPct: 65, stats: { ...SLOW, hp: 5000 } });
    has(duel([me()], [bruiser({ attack: 800 })], [0, 0, 0]), S, ["vảy giáp", "hóa rồng"]);
    const two = double(
      [me(), mate()],
      [bruiser({ attack: 800 }), bruiser({ attack: 800 })],
      rounds(2, [0, 0]),
    );
    has(two, S, ["vảy giáp", "hóa rồng"]);
  });

  it("192 Phá hư đoạn luật: bỏ qua tầng DEF, đòn Quỷ phá buff/khiên, hào quang cắt khiên", () => {
    const S = 192;
    const me = () => pet(S, { skills: sk("Độc ảnh thứ"), stats: FAST });
    const tank = () => slowDummy(sk("Thổ thuẫn"));
    has(duel([me()], [tank()], [0, 0]), S, [
      "bỏ qua tầng DEF",
      "đoạn luật +sát thương",
      "xóa buff",
    ]);
    const guard = () => slowDummy(sk("Yếu Tắc Hải Thành · Thủ"));
    has(duel([me()], [guard()], [0, 0]), S, ["hào quang phá khiên"]);
    const two = double([me(), mate()], [guard(), tank()], rounds(2, [0, 1], [0, 1]));
    has(two, S, ["bỏ qua tầng DEF", "đoạn luật +sát thương", "xóa buff"]);
  });

  it("193 Thánh quang trừng phạt: chiêu hồi bắn sát thương đối thủ, lượt hồi giảm sát thương", () => {
    const S = 193;
    const me = () =>
      pet(S, {
        skills: sk("Thiên Sử Quang Phán · Dưỡng"),
        hpPct: 40,
        stats: { ...FAST, hp: 99999 },
      });
    has(duel([me()], [lateBruiser()], [0]), S, ["thánh quang", "thánh quang giảm"]);
    const two = double(
      [me(), mate({ hpPct: 40 })],
      [lateBruiser(), lateBruiser()],
      rounds(1, [0, 3]),
    );
    hits(two, S, "thánh quang", 34, 1);
    expect(two.log.filter((p) => p.speciesId === S && p.label === "thánh quang").length).toBe(2);
  });

  it("194 Thiên sứ song dực: trên 60% chiêu Hỏa mạnh hơn, từ 60% trở xuống hút máu", () => {
    const S = 194;
    const me = (hpPct: number) =>
      pet(S, { skills: sk("Dương viêm"), hpPct, stats: { ...SLOW, hp: 5000 } });
    has(duel([me(100)], [slowDummy()], [0]), S, ["cánh sáng +sát thương"]);
    has(duel([me(50)], [slowDummy()], [0]), S, ["cánh tối hút máu"]);
    has(duel([me(61)], [bruiser({ attack: 800 })], [0]), S, ["song dực hồi"]);
    has(
      double(
        [me(61), mate()],
        [bruiser({ attack: 800 }), bruiser({ attack: 800 })],
        rounds(1, [0, 0]),
      ),
      S,
      ["song dực hồi"],
    );
  });

  it("195 Huyền nữ định hồn: trúng đòn thì phong ấn chiêu mạnh nhất và giảm sát thương", () => {
    const S = 195;
    const me = () => pet(S, { skills: sk("Độc ảnh thứ"), stats: FAST });
    const foe = () => dummy(34, { skills: [30, skillId("Nham bạo")], stats: SLOW });
    has(duel([me()], [foe()], [0, 0, 0]), S, ["định hồn", "phong ấn", "hết phong ấn"]);
    has(double([me(), mate()], [foe(), foe()], rounds(3, [0, 0], [0, 1])), S, [
      "định hồn",
      "phong ấn",
      "hết phong ấn",
    ]);
  });

  it("196 Sói non vây mồi: dồn mục tiêu +sát thương, mục tiêu chậm thì hút máu", () => {
    const S = 196;
    const me = (stats = FAST) =>
      pet(S, { skills: sk("Phong áp", "Độc ảnh thứ"), hpPct: 50, stats });
    has(duel([me()], [wounded(50)], [0, 1]), S, ["vây mồi", "hút mồi"]);
    const two = double(
      [me(SLOW), mate({ stats: FAST })],
      [slowDummy(), slowDummy()],
      [...rounds(1, [0, 0]), ...rounds(1, [1, 0])],
    );
    has(two, S, ["vây mồi", "hút mồi"]);
  });

  it("197 Ngạo nguyệt tru: dồn mục tiêu +sát thương, hạ gục thì cả đội +Sức mạnh", () => {
    const S = 197;
    const me = (stats = FAST) => pet(S, { skills: sk("Độc ảnh thứ"), hpPct: 50, stats });
    has(duel([me()], [weak(), slowDummy()], [0]), S, ["vây mồi", "nguyệt tru"]);
    const two = double(
      [me(), mate({ stats: SLOW })],
      [weak(), slowDummy()],
      rounds(1, [0, 0], [0, 1]),
    );
    has(two, S, ["nguyệt tru"]);
    hits(two, S, "nguyệt tru đồng đội", 68);
  });

  it("198 Cửu vĩ hoán pháp: gây Mị Hoặc, Mị Hoặc kết thúc thì cướp buff hoặc +Sức mạnh", () => {
    const S = 198;
    const me = () => pet(S, { skills: sk("Độc ảnh thứ"), stats: FAST });
    has(duel([me()], [slowDummy()], [0, 0, 0, 0]), S, ["mị hoặc", "hồ ly +sức mạnh"]);
    const buffer = () => slowDummy(sk("Thổ thuẫn"));
    has(duel([me()], [buffer()], [0, 0, 0, 0]), S, ["mị hoặc", "cướp buff"]);
    has(double([me(), mate()], [slowDummy(), slowDummy()], rounds(4, [0, 0], [0, 1])), S, [
      "mị hoặc",
      "hồ ly +sức mạnh",
    ]);
  });

  it("199 Khứu huyết cuồng sa: đối thủ yếu máu/Xé Rách thì nhanh hơn và mạnh hơn", () => {
    const S = 199;
    const me = () => pet(S, { skills: sk("Hỏa diễm đao"), stats: FAST });
    has(duel([me()], [wounded(40)], [0]), S, ["khứu huyết +sát thương", "khứu huyết linh xảo"]);
    const seeded = () => slowDummy();
    const two = double(
      [pet(S, { skills: sk("Dương viêm"), stats: FAST }), mate()],
      [seeded(), seeded()],
      rounds(2, [0, 0]),
    );
    has(two, S, ["khứu huyết +sát thương", "khứu huyết linh xảo"]);
  });
});

describe("kịch bản đặc tính phần 5: một mô tả duy nhất", () => {
  it("pet 160..199 chỉ có một mô tả, mọi số trong mô tả đều lấy từ params", () => {
    for (let id = 160; id <= 199; id++) {
      const script = PART_5[id];
      expect(script, `kịch bản ${id}`).toBeDefined();
      expect(script.text2v2, `text2v2 ${id}`).toBeUndefined();
      expect(script.text, `text ${id}`).not.toMatch(/1v1|2v2/i);
      expect(renderTraitText(id, script), `render ${id}`).not.toMatch(/[{}]/);
    }
  });
});
