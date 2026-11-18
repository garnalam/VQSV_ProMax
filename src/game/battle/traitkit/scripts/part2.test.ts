import { describe, expect, it } from "vitest";
import {
  KIT_STATUS,
  renderTraitText as renderTuned,
  setTraitTuning,
  traitTuning,
} from "../TraitKit";

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
import { PART_2 } from "./part2";

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
/** Đối thủ đánh sau, rất trâu. */
const slowDummy = () => dummy(34, { stats: SLOW });

/** `n` vòng 2v2 giống nhau. */
const rounds = (n: number, me: Order, ally: Order = [0, 0]): Order[][] =>
  Array.from({ length: n }, () => [me, ally]);

/** 1v1: pet đang trên sân của phe `side`, để kiểm hiệu ứng thật. */
const live1 = (r: { core: unknown }, side: "player" | "enemy" = "player") =>
  (
    r.core as {
      activeUnit(s: string): {
        statuses: { has(bank: number, id: number): boolean };
        currentStats: { speed: number };
        baseStats: { speed: number };
      };
    }
  ).activeUnit(side);

function has(result: Result, species: number, labels: string[]): void {
  expect(result.procs(species)).toEqual(expect.arrayContaining(labels));
}

/** Đồng đội trung tính hệ Hỏa (Nhiên Dực Bức không có kịch bản trong phần này). */
const mate = (extra: Parameters<typeof pet>[1] = {}): Setup =>
  pet(68, { skills: sk("Hỏa trảo"), ...extra, stats: { hp: 99999, ...extra.stats } });

describe("kịch bản đặc tính phần 2: chạy trong 1v1 và 2v2", () => {
  it("40 Hắc châm bão xạ: tích Kim, bắn đủ 3 Kim gây Xé Rách; 2v2 Kim lạc", () => {
    const S = 40;
    const me = () => pet(S, { skills: sk("Hất bụi", "Thiên Hỏa tế"), stats: { hp: 99999 } });
    has(duel([me()], [bruiser()], [1, 1, 1, 0]), S, ["nhận kim", "bắn kim", "xé rách"]);
    const two = double(
      [me(), mate()],
      [bruiser(), bruiser()],
      [...rounds(3, [1, 2]), ...rounds(1, [0, 0])],
    );
    has(two, S, ["nhận kim", "bắn kim", "xé rách", "kim lạc"]);
  });

  it("41 Thi khí hút sinh: hút máu theo HP đã mất", () => {
    const S = 41;
    const me = () => pet(S, { skills: sk("Hất bụi"), hpPct: 50 });
    has(duel([me()], [slowDummy()], [0]), S, ["hút máu"]);
    has(double([me(), mate()], [slowDummy(), slowDummy()], rounds(1, [0, 0])), S, ["hút máu"]);
  });

  it("42 Thi long bất diệt: hút máu, khiên khi tụt 30%; 2v2 đồng đội gục thì cuồng hút", () => {
    const S = 42;
    const me = (hpPct = 32) => pet(S, { skills: sk("Hất bụi"), hpPct, stats: { hp: 5000 } });
    has(duel([me()], [bruiser({ attack: 400 })], [0, 0]), S, ["hút máu", "khiên bất diệt"]);
    const two = double(
      [me(80), mate({ hpPct: 1, stats: { hp: 50 } })],
      [bruiser({ attack: 400 }), bruiser({ attack: 400 })],
      rounds(3, [0, 0]),
    );
    has(two, S, ["cuồng hút", "hút máu"]);
  });

  it("43 Tơ độc dính chân: Hủ Thực và làm chậm", () => {
    const S = 43;
    const me = () => pet(S, { skills: sk("Hất bụi") });
    has(duel([me()], [slowDummy()], [0]), S, ["hủ thực", "tơ chậm"]);
    has(double([me(), mate()], [slowDummy(), slowDummy()], rounds(1, [0, 0])), S, [
      "hủ thực",
      "tơ chậm",
    ]);
  });

  it("44 Lưới kén truyền độc: đòn trúng rải Hủ Thực, mục tiêu chậm và nhận thêm sát thương, độc nhảy khi gục", () => {
    const S = 44;
    const me = (stats = {}) => pet(S, { skills: sk("Hất bụi"), stats: { attack: 1, ...stats } });
    const weak = () => pet(34, { skills: [30], hpPct: 5, stats: { hp: 100, attack: 1, speed: 1 } });
    const one = duel([me()], [weak(), slowDummy()], [0, 0, 0, 0]);
    has(one, S, ["rải độc", "kén chậm", "độc +sát thương", "độc nhảy"]);
    const corrosion = KIT_STATUS.corrosion;
    const one1 = duel([me()], [dummy(34, { stats: { speed: 100 } })], [0]);
    expect(live1(one1, "enemy").statuses.has(corrosion.bank, corrosion.id)).toBe(true);
    expect(live1(one1, "enemy").currentStats.speed).toBeLessThan(
      live1(one1, "enemy").baseStats.speed,
    );
    // 2v2: pet rải độc, đồng đội hạ mục tiêu bằng đòn thường; độc nhảy sang đối thủ còn lại.
    const prey = pet(34, { skills: [30], stats: { hp: 100, attack: 1, speed: 1 } });
    const two = double([me(FAST), mate({ stats: SLOW })], [prey, slowDummy()], rounds(1, [0, 0]));
    has(two, S, ["rải độc", "kén chậm", "độc nhảy"]);
    expect(two.log.find((p) => p.speciesId === S && p.label === "độc nhảy")?.targetSide).toBe(1);
  });

  it("45 Lấy đà khủng giác: tích Đà, Đà cộng sát thương", () => {
    const S = 45;
    const me = () => pet(S, { skills: sk("Hất bụi") });
    has(duel([me()], [slowDummy()], [0, 0]), S, ["tích đà", "đà +sát thương"]);
    has(double([me(), mate()], [slowDummy(), slowDummy()], rounds(2, [0, 0])), S, [
      "tích đà",
      "đà +sát thương",
    ]);
  });

  it("46 Khủng giác xuyên trận: tiêu 3 Đà bằng chiêu độc quyền; 2v2 húc xuyên", () => {
    const S = 46;
    const me = () => pet(S, { skills: sk("Hất bụi", "Khủng Giác Nghiền Giáp · Bạo") });
    has(duel([me()], [slowDummy()], [0, 0, 0, 1]), S, ["tích đà", "đà +sát thương", "tiêu đà"]);
    const two = double(
      [me(), mate()],
      [slowDummy(), slowDummy()],
      [...rounds(3, [0, 0]), ...rounds(1, [1, 0])],
    );
    has(two, S, ["tiêu đà", "húc xuyên"]);
  });

  it("47 Chiến thần tích ý: chặn đòn đầu, Chiến Ý cộng vào đòn kế", () => {
    const S = 47;
    const me = () => pet(S, { skills: sk("Hất bụi"), stats: { ...SLOW, hp: 99999 } });
    has(duel([me()], [bruiser()], [0, 0]), S, ["chặn đòn", "chiến ý"]);
    has(double([me(), mate()], [bruiser(), bruiser()], rounds(2, [0, 0])), S, [
      "chặn đòn",
      "chiến ý",
      "khiêu khích",
    ]);
  });

  it("48 Hơi lạnh tuyết cầu: tầng Băng lên kẻ đánh và kẻ bị đánh", () => {
    const S = 48;
    const me = () => pet(S, { skills: sk("Bong bóng"), stats: { hp: 99999 } });
    const one = duel([me()], [bruiser()], [0]);
    has(one, S, ["băng"]);
    expect(one.procs(S).filter((p) => p === "băng").length).toBe(2);
    has(double([me(), mate()], [bruiser(), bruiser()], rounds(1, [0, 0])), S, ["băng"]);
  });

  it("49 Thân tuyết đông kết: đủ 3 tầng Băng thì Hóa Đá", () => {
    const S = 49;
    const me = () => pet(S, { skills: sk("Bong bóng"), stats: { hp: 99999 } });
    has(duel([me()], [bruiser()], [0, 0]), S, ["băng", "đông cứng"]);
    has(double([me(), mate()], [bruiser(), bruiser()], rounds(3, [0, 0])), S, [
      "băng",
      "đông cứng",
    ]);
  });

  it("50 Cự linh băng phong: Hóa Đá rồi đánh thêm; 2v2 đồng đội +12%", () => {
    const S = 50;
    const me = () => pet(S, { skills: sk("Bong bóng"), stats: { hp: 99999, speed: 500 } });
    has(duel([me()], [bruiser()], [0, 0, 0]), S, ["băng", "đông cứng", "đánh hóa đá"]);
    const two = double(
      [me(), mate({ stats: { speed: 2 } })],
      [bruiser(), bruiser()],
      rounds(4, [0, 0]),
    );
    has(two, S, ["đông cứng", "đồng đội đánh hóa đá"]);
  });

  it("51 Con nước thủy thủ: Triều Dâng/Rút; 2v2 đồng đội hệ Thủy chung triều", () => {
    const S = 51;
    const me = () => pet(S, { skills: sk("Bong bóng"), hpPct: 50, stats: { hp: 99999 } });
    has(duel([me()], [bruiser()], [0, 0]), S, ["triều dâng", "triều rút", "triều hồi"]);
    const water = pet(48, { skills: sk("Bong bóng"), hpPct: 50, stats: { hp: 99999 } });
    const two = double([me(), water], [bruiser(), bruiser()], rounds(2, [0, 0]));
    has(two, S, ["đồng đội triều dâng", "đồng đội triều hồi"]);
    expect(two.procs(S).some((p) => p === "triều rút" || p === "đồng đội triều rút")).toBe(true);
  });

  it("52 Bá tước triều cường: Triều Rút kéo dài giảm sát thương", () => {
    const S = 52;
    const me = () =>
      pet(S, { skills: sk("Bong bóng", "Thủy trụ"), hpPct: 50, stats: { hp: 99999 } });
    has(duel([me()], [bruiser()], [0, 1]), S, ["triều dâng", "triều rút", "triều kéo dài"]);
    const water = pet(48, { skills: sk("Bong bóng"), stats: { hp: 99999 } });
    has(double([me(), water], [bruiser(), bruiser()], rounds(2, [0, 0])), S, [
      "triều dâng",
      "đồng đội triều dâng",
    ]);
  });

  it("53 Võ thần hải triều: Triều Dâng giảm sát thương mục tiêu", () => {
    const S = 53;
    const me = () => pet(S, { skills: sk("Bong bóng"), hpPct: 50, stats: { hp: 99999 } });
    has(duel([me()], [bruiser()], [0, 0]), S, ["triều dâng", "triều áp", "triều rút"]);
    const water = pet(48, { skills: sk("Bong bóng"), stats: { hp: 99999 } });
    has(double([me(), water], [bruiser(), bruiser()], rounds(1, [0, 0])), S, [
      "triều áp",
      "đồng đội triều dâng",
    ]);
  });

  it("54 Gió đầu triều: ưu tiên lượt đầu, giảm sát thương, khiên cho đồng đội", () => {
    const S = 54;
    const me = () => pet(S, { skills: sk("Bong bóng"), stats: { hp: 99999 } });
    has(duel([me()], [bruiser()], [0]), S, ["ưu tiên", "gió nén", "khiên trinh sát"]);
    const two = double([me(), mate()], [bruiser(), bruiser()], rounds(1, [0, 0]));
    has(two, S, ["gió nén", "khiên trinh sát"]);
    expect(
      two.log.some(
        (p) => p.speciesId === S && p.label === "khiên trinh sát" && p.targetSpecies === 68,
      ),
    ).toBe(true);
  });

  it("55 Đại khẩu nuốt chửng: hút máu mục tiêu yếu, nuốt chửng khi hạ gục", () => {
    const S = 55;
    const me = () => pet(S, { skills: sk("Bong bóng"), hpPct: 50, stats: FAST });
    const weak = () => pet(34, { skills: [30], hpPct: 20, stats: { hp: 400, speed: 1 } });
    has(duel([me()], [weak(), slowDummy()], [0, 0]), S, ["hút máu", "nuốt chửng"]);
    const turns: Order[][] = [
      [
        [0, 0],
        [0, 1],
      ],
      [
        [0, 1],
        [0, 1],
      ],
    ];
    has(double([me(), mate({ stats: SLOW })], [weak(), slowDummy()], turns), S, [
      "hút máu",
      "nuốt chửng",
    ]);
  });

  it("56 Mực đen ám hải: phun mực, giảm sát thương; 2v2 mực lan và che đồng đội", () => {
    const S = 56;
    const me = () => pet(S, { skills: sk("Bong bóng"), stats: { hp: 99999 } });
    has(duel([me()], [bruiser()], [0, 0]), S, ["phun mực", "mực che"]);
    const two = double([me(), mate()], [bruiser(), bruiser()], rounds(3, [0, 0]));
    has(two, S, ["phun mực", "mực lan"]);
    expect(two.procs(S).some((p) => p === "mực che" || p === "mực che đồng đội")).toBe(true);
  });

  it("57 Đèn dụ lạc lối: hồi máu gây Mị Hoặc, đối thủ đánh nhầm", () => {
    const S = 57;
    const me = () =>
      pet(S, { skills: sk("Lam Tuyền Chữa Lành"), hpPct: 50, stats: { ...FAST, hp: 99999 } });
    has(duel([me()], [bruiser({ speed: 1 })], [0, 0]), S, ["mị hoặc", "tự đánh"]);
    const two = double(
      [me(), mate()],
      [bruiser({ speed: 1 }), bruiser({ speed: 1 })],
      rounds(2, [0, 2]),
    );
    has(two, S, ["mị hoặc"]);
  });

  it("58 Phiêu thủy tiếp sức: hồi máu giải và cộng đòn kế; khiên tiếp sức", () => {
    const S = 58;
    const me = () =>
      pet(S, {
        skills: sk("Lam Tuyền Chữa Lành", "Bong bóng", "Phiêu Thủy Tiếp Sức · Chuyển"),
        hpPct: 50,
      });
    has(duel([me()], [slowDummy()], [0, 1]), S, ["tiếp sức", "đòn tiếp sức"]);
    // Rút bằng Phiêu Thủy Tiếp Sức: pet được đổi vào nhận khiên.
    const relay = duel([me(), mate()], [slowDummy()], [2]);
    expect(relay.log).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ speciesId: S, label: "khiên tiếp sức", targetSpecies: 68 }),
      ]),
    );
    const two = double(
      [me(), mate({ hpPct: 50 })],
      [slowDummy(), slowDummy()],
      [
        [
          [0, 3],
          [0, 0],
        ],
        [
          [1, 0],
          [0, 0],
        ],
      ],
    );
    has(two, S, ["tiếp sức", "đồng đội đòn tiếp sức"]);
  });

  it("59 Gai độc hải mã: kẻ đánh trúng độc và yếu đi", () => {
    const S = 59;
    const me = () => pet(S, { skills: sk("Bong bóng"), stats: { hp: 99999 } });
    has(duel([me()], [bruiser()], [0, 0]), S, ["gai độc", "độc yếu"]);
    const two = double([me(), mate()], [bruiser(), bruiser()], rounds(2, [0, 0]));
    has(two, S, ["gai độc"]);
  });

  it("60 Mũi kiếm xuyên khiên: bỏ qua DEF và đánh xuyên khiên", () => {
    const S = 60;
    const me = () => pet(S, { skills: sk("Bong bóng") });
    has(duel([me()], [dummy(63, { stats: SLOW })], [0]), S, ["xuyên giáp", "xuyên khiên"]);
    has(double([me(), mate()], [dummy(63, { stats: SLOW }), slowDummy()], rounds(1, [0, 0])), S, [
      "xuyên giáp",
      "xuyên khiên",
    ]);
  });

  it("61 Cốt kiếm đoạt giáp: xuyên DEF và khiên, đòn gỡ buff thì +sát thương; 2v2 đồng đội +10%", () => {
    const S = 61;
    const me = (stats = {}) => pet(S, { skills: sk("Bong bóng"), stats });
    /** Đối thủ tự buff (Thiên Hỏa tế) trước khi pet đánh. */
    const buffer = () => pet(34, { skills: [4], stats: { ...FAST, hp: 99999 } });
    const one = duel([me()], [buffer()], [0, 0, 0]);
    has(one, S, ["xuyên giáp", "đoạt giáp", "đoạt giáp +sát thương"]);
    // Gỡ 2 lượt 1 lần.
    expect(one.procs(S).filter((l) => l === "đoạt giáp").length).toBe(2);
    has(duel([me()], [dummy(63, { stats: SLOW })], [0]), S, ["xuyên khiên"]);
    const two = double(
      [me({ speed: 5000 }), mate({ stats: SLOW })],
      [buffer(), buffer()],
      rounds(1, [0, 1], [0, 1]),
    );
    has(two, S, ["đoạt giáp", "đoạt giáp +sát thương"]);
    expect(
      two.log.find((p) => p.speciesId === S && p.label === "đồng đội đoạt giáp")?.targetSpecies,
    ).toBe(68);
  });

  it("62 Lân vàng phản quang: được hồi máu thì phản quang; lượt hồi máu nhận ít hơn", () => {
    const S = 62;
    const me = () => pet(S, { skills: sk("Lam Tuyền Chữa Lành"), hpPct: 50 });
    has(duel([me()], [bruiser({ speed: 1 })], [0]), S, ["phản quang", "lân che"]);
    const two = double([me(), mate({ hpPct: 50 })], [slowDummy(), slowDummy()], rounds(1, [0, 3]));
    has(two, S, ["phản quang đồng đội"]);
  });

  it("63 Thần giáp càng kẹp: Giáp Thần vỡ thì trói kẻ phá; 2v2 càng kẹp", () => {
    const S = 63;
    const me = () => pet(S, { skills: sk("Bong bóng"), stats: { hp: 6000 } });
    has(duel([me()], [bruiser({ attack: 2500 })], [0, 0, 0, 0, 0, 0]), S, [
      "giáp thần",
      "giáp vỡ",
      "vỏ mới",
    ]);
    const two = double(
      [me(), mate({ stats: { hp: 3000 } })],
      [bruiser({ attack: 2500 }), bruiser({ attack: 2500 })],
      rounds(3, [0, 0]),
    );
    has(two, S, ["giáp thần", "càng kẹp"]);
  });

  it("64 Hầu vương xoay côn: đổi hệ chiêu được cộng", () => {
    const S = 64;
    const me = () => pet(S, { skills: sk("Điện giật", "Nham Nha Phệ Cốt") });
    has(duel([me()], [slowDummy()], [0, 1]), S, ["xoay côn"]);
    has(
      double(
        [me(), mate()],
        [slowDummy(), slowDummy()],
        [...rounds(1, [0, 0]), ...rounds(1, [1, 0])],
      ),
      S,
      ["xoay côn"],
    );
  });

  it("65 Tĩnh điện mây: tích điện, xả gây Tê Liệt; 2v2 tích khi đồng đội bị chiêu Lôi", () => {
    const S = 65;
    const me = () => pet(S, { skills: sk("Điện giật"), stats: { hp: 99999 } });
    has(duel([me()], [slowDummy()], [0, 0, 0, 0]), S, [
      "tích điện",
      "điện +sát thương",
      "xả điện",
      "tê liệt",
    ]);
    const zapper = () => pet(65, { skills: sk("Điện giật"), stats: { hp: 99999, attack: 1 } });
    const two = double([me(), mate()], [zapper(), zapper()], rounds(4, [0, 0]));
    has(two, S, ["tích điện", "xả điện"]);
  });

  it("66 Điện nhãn khóa mục: xả chắc chắn Tê Liệt", () => {
    const S = 66;
    const me = () => pet(S, { skills: sk("Điện giật"), stats: { hp: 99999 } });
    has(duel([me()], [slowDummy()], [0, 0, 0, 0]), S, ["tích điện", "xả điện", "tê liệt"]);
    has(double([me(), mate()], [slowDummy(), slowDummy()], rounds(4, [0, 0])), S, [
      "xả điện",
      "tê liệt",
    ]);
  });

  it("67 Thân sĩ lôi phán: xả gỡ buff, Tê Liệt; 2v2 sét nảy", () => {
    const S = 67;
    const me = () => pet(S, { skills: sk("Điện giật"), stats: { hp: 99999 } });
    has(duel([me()], [slowDummy()], [0, 0, 0, 0]), S, ["xả điện", "tê liệt"]);
    has(double([me(), mate()], [slowDummy(), slowDummy()], rounds(4, [0, 0])), S, [
      "xả điện",
      "sét nảy",
    ]);
  });

  it("68 Đuổi kịp tia chớp: bị đi trước thì tăng tốc và cộng sát thương", () => {
    const S = 68;
    const me = () => pet(S, { skills: sk("Điện giật"), stats: { ...SLOW, hp: 99999 } });
    has(duel([me()], [bruiser()], [0]), S, ["đuổi kịp", "đuổi +sát thương"]);
    has(double([me(), mate()], [bruiser(), bruiser()], rounds(1, [0, 0])), S, [
      "đuổi kịp",
      "đuổi +sát thương",
    ]);
  });

  it("69 Thiểm điện song kích: đi trước bắn tia phụ; 2v2 tia phụ sang đối thủ kia", () => {
    const S = 69;
    const fast = () => pet(S, { skills: sk("Điện giật"), stats: FAST });
    const slow = () => pet(S, { skills: sk("Điện giật"), stats: { ...SLOW, hp: 99999 } });
    has(duel([fast()], [slowDummy()], [0]), S, ["tia chớp phụ"]);
    has(duel([slow()], [bruiser()], [0]), S, ["tăng tốc"]);
    const two = double([fast(), mate()], [slowDummy(), slowDummy()], rounds(1, [0, 0]));
    has(two, S, ["tia chớp phụ"]);
    expect(
      two.log.find((p) => p.speciesId === S && p.label === "tia chớp phụ")?.targetSpecies,
    ).toBe(34);
  });

  it("70 Song phong dẫn lôi: đổi hệ Lôi ↔ Phong; 2v2 chiêu đồng đội mở điều kiện", () => {
    const S = 70;
    const me = () =>
      pet(S, { skills: sk("Điện giật", "Phi Vũ Đoạn Không", "Quỷ Long Lôi Vực · Thủ") });
    has(duel([me()], [slowDummy()], [0, 1]), S, ["đổi hệ", "dẫn lôi khống chế"]);
    has(duel([me()], [slowDummy()], [0, 2, 0]), S, ["tích đổi hệ", "đổi hệ"]);
    const two = double(
      [me(), mate({ stats: FAST })],
      [slowDummy(), slowDummy()],
      rounds(1, [0, 0]),
    );
    has(two, S, ["đổi hệ"]);
  });

  it("71 Quỷ lôi song vực: đổi hệ cộng; mục tiêu Hủ Thực bị Tê Liệt", () => {
    const S = 71;
    const me = () => pet(S, { skills: sk("Điện giật", "Ảnh thứ", "Quỷ Long Lôi Vực · Thực") });
    has(duel([me()], [slowDummy()], [0, 1]), S, ["đổi hệ"]);
    // Đồng đội 78 đi trước đặt Hủ Thực; chiêu độc quyền luôn tính đổi hệ.
    const plague = pet(78, { skills: sk("Ảnh thứ"), stats: { ...FAST, hp: 99999 } });
    const two = double([me(), plague], [slowDummy(), slowDummy()], rounds(1, [2, 0]));
    has(two, S, ["đổi hệ", "song vực tê liệt"]);
  });

  it("72 Tĩnh điện đoản mạch: cộng Lôi, trả máu; dưới 50% đoản mạch", () => {
    const S = 72;
    has(duel([pet(S, { skills: sk("Điện giật") })], [slowDummy()], [0]), S, [
      "tĩnh điện",
      "trả máu",
    ]);
    const low = () => pet(S, { skills: sk("Điện giật"), hpPct: 40 });
    has(duel([low()], [slowDummy()], [0]), S, ["đoản mạch"]);
    has(double([low(), mate()], [slowDummy(), slowDummy()], rounds(1, [0, 0])), S, [
      "đoản mạch",
      "trả máu",
    ]);
  });

  it("73 Lôi thử hoàn điện: trả máu tích lại, dưới 30% thành khiên", () => {
    const S = 73;
    const me = (hpPct: number) => pet(S, { skills: sk("Điện giật"), hpPct });
    has(duel([me(32)], [slowDummy()], [0]), S, ["lôi thử", "trả máu", "hoàn điện"]);
    const two = double(
      [me(32), mate({ hpPct: 10 })],
      [slowDummy(), slowDummy()],
      rounds(1, [0, 0]),
    );
    has(two, S, ["hoàn điện"]);
    expect(two.log.find((p) => p.speciesId === S && p.label === "hoàn điện")?.targetSpecies).toBe(
      68,
    );
  });

  it("74 Hiệp đạo đoạt lôi: cướp buff vừa gỡ, đi trước cộng sát thương", () => {
    const S = 74;
    const me = () => pet(S, { skills: sk("Điện giật", "Nghịch Phong Đoạt"), stats: FAST });
    has(duel([me()], [dummy(63, { stats: SLOW })], [1, 0]), S, ["cướp buff", "hiệp đạo đi trước"]);
    const two = double(
      [me(), mate()],
      [dummy(63, { stats: SLOW }), slowDummy()],
      rounds(1, [1, 0]),
    );
    has(two, S, ["cướp buff"]);
    expect(two.log.find((p) => p.speciesId === S && p.label === "cướp buff")?.targetSpecies).toBe(
      68,
    );
  });

  it("75 Kỳ lân thiên phạt: dấu Thiên Lôi, đủ 3 giáng sét cả sân", () => {
    const S = 75;
    const me = () => pet(S, { skills: sk("Điện giật", "Kỳ Lân Thiên Phạt · Bạo") });
    has(duel([me()], [slowDummy()], [0, 0, 0]), S, [
      "dấu thiên lôi",
      "thiên lôi +sát thương",
      "giáng sét",
      "tê liệt",
    ]);
    const two = double([me(), mate()], [slowDummy(), slowDummy()], rounds(1, [1, 0]));
    has(two, S, ["giáng sét"]);
    expect(two.procs(S).filter((p) => p === "sét thiên phạt").length).toBe(2);
  });

  it("76 Bào tử ăn mòn: đòn đầu gây Hủ Thực, đối thủ trúng độc yếu đi", () => {
    const S = 76;
    const me = () => pet(S, { skills: sk("Ảnh thứ"), stats: { ...FAST, hp: 99999 } });
    has(duel([me()], [bruiser({ speed: 1 })], [0, 0]), S, ["hủ thực", "bào tử yếu"]);
    const two = double(
      [me(), mate()],
      [bruiser({ speed: 1 }), bruiser({ speed: 1 })],
      rounds(3, [0, 0]),
    );
    has(two, S, ["hủ thực"]);
    expect(two.procs(S).some((p) => p === "bào tử yếu" || p === "bào tử che đồng đội")).toBe(true);
  });

  it("77 Độc dịch lan tràn: Hủ Thực, hút độc; 2v2 độc bắn sang", () => {
    const S = 77;
    const me = () => pet(S, { skills: sk("Ảnh thứ"), hpPct: 50 });
    has(duel([me()], [slowDummy()], [0, 0, 0]), S, ["hủ thực", "hút độc"]);
    has(double([me(), mate()], [slowDummy(), slowDummy()], rounds(3, [0, 0])), S, [
      "hủ thực",
      "độc bắn",
    ]);
  });

  it("78 Dịch vương mục cốt: Hủ Thực mọi đòn, xuyên DEF, hút máu, lây khi gục", () => {
    const S = 78;
    const me = () => pet(S, { skills: sk("Ảnh thứ"), hpPct: 50, stats: { attack: 1 } });
    const weak = () => pet(34, { skills: [30], hpPct: 5, stats: { hp: 100, attack: 1, speed: 1 } });
    has(duel([me()], [weak(), slowDummy()], [0, 0, 0, 0, 0, 0]), S, [
      "hủ thực",
      "mục cốt",
      "dịch đón",
    ]);
    const strong = pet(S, { skills: sk("Ảnh thứ"), hpPct: 50 });
    has(duel([strong], [slowDummy()], [0, 0]), S, ["mục cốt", "hút máu"]);
    const fastMe = pet(S, { skills: sk("Ảnh thứ"), stats: { ...FAST, attack: 1 } });
    const prey = pet(34, { skills: [30], stats: { hp: 100, attack: 1, speed: 1 } });
    const two = double([fastMe, mate({ stats: SLOW })], [prey, slowDummy()], rounds(1, [0, 0]));
    has(two, S, ["hủ thực", "dịch lây"]);
  });

  it("79 Ác nhãn dò xét: Mắt Ác giảm sát thương; 2v2 che đồng đội", () => {
    const S = 79;
    const me = () => pet(S, { skills: sk("Ảnh thứ"), stats: { hp: 99999 } });
    has(duel([me()], [bruiser()], [0, 0]), S, ["mắt ác", "mắt ác giảm", "đánh mắt ác"]);
    const two = double([me(), mate()], [bruiser(), bruiser()], rounds(3, [0, 0]));
    has(two, S, ["mắt ác"]);
    expect(two.procs(S).some((p) => p === "mắt ác giảm" || p === "mắt ác che đồng đội")).toBe(true);
  });
});

describe("kịch bản đặc tính phần 2: một mô tả duy nhất", () => {
  it("pet 40..79 chỉ có một mô tả, mọi số trong mô tả đều lấy từ params", () => {
    for (let id = 40; id <= 79; id++) {
      const script = PART_2[id];
      expect(script, `kịch bản ${id}`).toBeDefined();
      expect(script.text2v2, `text2v2 ${id}`).toBeUndefined();
      expect(script.text, `text ${id}`).not.toMatch(/1v1|2v2/i);
      expect(renderTraitText(id, script), `render ${id}`).not.toMatch(/[{}]/);
    }
  });
});
