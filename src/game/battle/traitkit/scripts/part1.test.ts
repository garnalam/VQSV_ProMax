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
import { PART_1 } from "./part1";

const { duel, double, pet, dummy, skillId } = await import("../TraitScenario.testutil");
type Order = [number, 0 | 1 | 2 | 3];

const SLOW = { speed: 1 };
const FAST = { speed: 9999 };
/** Đối thủ đánh trước, đủ đau để pet mất máu, rất trâu. */
const bruiser = () => pet(34, { skills: [30], stats: { speed: 9999, hp: 99999 } });
/** Đối thủ đánh sau, rất trâu. */
const slowHitter = () => pet(34, { skills: [30], stats: { speed: 1, hp: 99999 } });
/** Đối thủ dùng chiêu Hỏa, đánh trước. */
const fireFoe = () => pet(34, { skills: [0], stats: { speed: 9999, hp: 99999 } });
/** Đồng đội mặc định (2v2). */
const mate = (options: Parameters<typeof pet>[1] = {}) =>
  pet(68, { skills: [0], ...options, stats: { hp: 99999, ...SLOW, ...options.stats } });
/**
 * Đồng đội đánh rất yếu: AI đối thủ nhắm pet đe dọa hơn, nên với đồng đội này đối thủ đánh vào pet
 * đang kiểm. Có 2 chiêu để lệnh ô 1 vẫn hợp lệ khi pet đang kiểm đã gục.
 */
const meek = () => pet(68, { skills: [0, 3], stats: { hp: 99999, attack: 1, ...SLOW } });
/** `n` vòng 2v2 lặp lại cùng lệnh cho pet ô 2 và ô 3. */
const rounds = (n: number, a: Order, b: Order = [0, 0]): Order[][] =>
  Array.from({ length: n }, () => [a, b]);
const times = (n: number, slot = 0) => Array.from({ length: n }, () => slot);
/** Pet trên sân sau kịch bản, để kiểm hiệu ứng thật (máu, khiên, chỉ số, trạng thái). */
type Live = {
  speciesId: number;
  hp(): number;
  maxHp(): number;
  shieldHp(): number;
  currentStats: { defense: number };
  baseStats: { defense: number };
  statuses: { has(bank: number, id: number): boolean };
};
/** 1v1: pet đang trên sân của phe `side`. */
const live1 = (r: { core: unknown }, side: "player" | "enemy" = "player") =>
  (r.core as { activeUnit(s: string): Live }).activeUnit(side);
/** Loài bị tác động của từng lần kích hoạt `label`. */
const procOn = (
  r: { log: { speciesId: number; label: string; targetSpecies?: number }[] },
  S: number,
  label: string,
) => r.log.filter((p) => p.speciesId === S && p.label === label).map((p) => p.targetSpecies);

describe("kịch bản đặc tính phần 1: chạy trong 1v1 và 2v2", () => {
  it("0 Nhiên Dực Bức: đi trước đặt Gieo Hạt, rồi hút máu; 2v2 đồng đội +10%", () => {
    const S = 0;
    const me = () => pet(S, { skills: [skillId("Hỏa trảo")], hpPct: 50, stats: FAST });
    const one = duel([me()], [dummy(34, { stats: SLOW })], [0, 0]);
    expect(one.procs(S)).toContain("gieo hạt");
    expect(one.procs(S)).toContain("hút máu");
    const two = double(
      [me(), pet(68, { skills: [skillId("Hỏa trảo")], stats: SLOW })],
      [dummy(34, { stats: SLOW }), dummy(34, { stats: SLOW })],
      [
        [
          [0, 0],
          [0, 0],
        ],
        [
          [0, 0],
          [0, 0],
        ],
      ],
    );
    expect(two.procs(S)).toContain("gieo hạt");
    expect(two.procs(S)).toContain("đồng đội +10%");
    expect(two.procs(S)).toContain("hút máu");
  });

  it("1 Bom tinh nghịch: tự trả HP tích Ngòi, Ngòi cộng sát thương, gục thì nổ", () => {
    const S = 1;
    const me = () => pet(S, { skills: [1001, 3], stats: { ...FAST, hp: 1000 } });
    const one = duel([me()], [bruiser()], [0, ...times(12, 1)]);
    expect(one.procs(S)).toContain("ngòi");
    expect(one.procs(S)).toContain("ngòi +sát thương");
    expect(one.procs(S)).toContain("nổ");
    // AI đối thủ đánh ô 3: pet đứng ô 3 để bị hạ.
    const two = double(
      [meek(), me()],
      [bruiser(), bruiser()],
      [
        [
          [0, 0],
          [0, 0],
        ],
        ...rounds(12, [0, 0], [1, 0]),
      ],
    );
    expect(two.procs(S)).toContain("ngòi");
    const blasts = two.log.filter((p) => p.speciesId === S && p.label === "nổ");
    expect(blasts.length).toBe(2);
  });

  it("2 Nhiên Liệp Sư: bị đánh tích giận, đủ 3 tầng bùng nộ gây Xé Rách; 2v2 đồng đội gục thì trả thù", () => {
    const S = 2;
    const me = () => pet(S, { skills: [0], stats: { ...SLOW, hp: 99999 } });
    const one = duel([me()], [bruiser()], times(4));
    expect(one.procs(S)).toContain("giận");
    expect(one.procs(S)).toContain("bùng nộ");
    expect(one.procs(S)).toContain("xé rách");
    const two = double(
      [me(), mate({ stats: { hp: 1 } })],
      [bruiser(), bruiser()],
      rounds(4, [0, 0]),
    );
    expect(two.procs(S)).toContain("trả thù");
    expect(two.procs(S)).toContain("bùng nộ");
  });

  it("3 Hắc Thán Báo: đánh mòn theo HP mục tiêu đã mất; hạ gục thì hồi, được ưu tiên và truy sát", () => {
    const S = 3;
    const me = () => pet(S, { skills: [0], hpPct: 50, stats: { speed: 50 } });
    const weak = () => pet(34, { skills: [30], stats: { hp: 1, speed: 1 } });
    const one = duel([me()], [weak(), dummy(34, { hpPct: 40, stats: FAST })], times(3));
    for (const label of ["hạ gục", "hồi khi hạ gục", "ưu tiên", "truy sát", "đánh mòn"])
      expect(one.procs(S)).toContain(label);
    // Hồi 15% HP tối đa sau khi hạ gục: từ 50% lên trên 60%.
    const self = live1(one);
    expect(self.hp()).toBeGreaterThan(self.maxHp() * 0.6);
    const two = double(
      [me(), mate()],
      [weak(), dummy(34, { hpPct: 40, stats: FAST })],
      [
        [
          [0, 0],
          [0, 1],
        ],
        ...rounds(2, [0, 1], [0, 1]),
      ],
    );
    for (const label of ["hạ gục", "hồi khi hạ gục", "truy sát", "đánh mòn"])
      expect(two.procs(S)).toContain(label);
  });

  it("4 Hỏa Diễm Hồ: đi trước để ảo ảnh né đòn; 2v2 ảo ảnh đặt lên đồng đội", () => {
    const S = 4;
    const me = () => pet(S, { skills: [0], stats: { ...FAST, hp: 99999 } });
    const one = duel([me()], [slowHitter()], times(2));
    expect(one.procs(S)).toContain("ảo ảnh");
    expect(one.procs(S)).toContain("né");
    const two = double([me(), mate()], [slowHitter(), slowHitter()], rounds(3, [0, 0]));
    const cast = two.log.find((p) => p.speciesId === S && p.label === "ảo ảnh");
    expect(cast?.targetSpecies).toBe(68);
  });

  it("5 Viêm Ma: trúng đòn nặng thì phản, lần hai gây Xé Rách; 2v2 phản thay đồng đội", () => {
    const S = 5;
    const me = () => pet(S, { skills: [0], stats: { ...SLOW, hp: 1500 } });
    const one = duel([me()], [bruiser()], times(3));
    expect(one.procs(S)).toContain("phản");
    expect(one.procs(S)).toContain("xé rách");
    const two = double(
      [pet(S, { skills: [0], stats: { ...SLOW, hp: 99999 } }), mate({ stats: { hp: 1500 } })],
      [bruiser(), bruiser()],
      rounds(3, [0, 0]),
    );
    expect(two.procs(S)).toContain("phản thay");
  });

  it("6 Long bảo bối: lần đầu bị đánh nuốt lửa, chiêu Hỏa kế +25%, kháng chiêu Hỏa", () => {
    const S = 6;
    const me = () => pet(S, { skills: [0], hpPct: 50, stats: { ...SLOW, hp: 99999 } });
    for (const r of [
      duel([me()], [fireFoe()], times(2)),
      double([me(), mate()], [fireFoe(), fireFoe()], rounds(2, [0, 0])),
    ]) {
      expect(r.procs(S)).toContain("nuốt lửa");
      expect(r.procs(S)).toContain("lửa +25%");
      expect(r.procs(S)).toContain("kháng hỏa");
    }
  });

  it("7 Phệ Hỏa Thú: tích Than khi bị đánh, Than cộng chiêu Hỏa; 2v2 tích cả khi đồng đội trúng Hỏa", () => {
    const S = 7;
    const me = () => pet(S, { skills: [0], stats: { ...SLOW, hp: 99999 } });
    const one = duel([me()], [fireFoe()], times(3));
    expect(one.procs(S)).toContain("than");
    expect(one.procs(S)).toContain("than +sát thương");
    expect(one.procs(S)).toContain("kháng hỏa");
    const two = double([me(), mate()], [fireFoe(), fireFoe()], rounds(4, [0, 0]));
    expect(two.procs(S)).toContain("than +sát thương");
    expect(two.procs(S).some((l) => l === "than" || l === "than đồng đội")).toBe(true);
  });

  it("8 Bạo Long Thú: đủ 3 Than xả Gieo Hạt và hồi máu; 2v2 hồi đồng đội thấp máu", () => {
    const S = 8;
    const me = () => pet(S, { skills: [0], hpPct: 50, stats: { ...SLOW, hp: 99999 } });
    const one = duel([me()], [fireFoe()], times(4));
    expect(one.procs(S)).toContain("than");
    expect(one.procs(S)).toContain("xả than");
    expect(one.procs(S)).toContain("kháng hỏa");
    const two = double([me(), mate({ hpPct: 30 })], [fireFoe(), fireFoe()], rounds(4, [0, 0]));
    expect(two.procs(S)).toContain("xả than");
    expect(two.procs(S)).toContain("hồi đồng đội");
  });

  it("9 Ly Ngưu Ngưu: ra đòn sau khi mất máu thì húc trả", () => {
    const S = 9;
    const me = () => pet(S, { skills: [skillId("Hỏa trảo")], stats: { ...SLOW, hp: 99999 } });
    const one = duel([me()], [bruiser()], [0, 0]);
    expect(one.procs(S)).toContain("húc trả");
    const two = double(
      [me(), pet(68, { skills: [skillId("Hỏa trảo")], stats: { hp: 99999 } })],
      [bruiser(), bruiser()],
      [
        [
          [0, 0],
          [0, 0],
        ],
      ],
    );
    expect(two.procs(S)).toContain("húc trả");
  });

  it("10 Ly Ngưu Thản Khắc: ra đòn sau khi mất máu thì húc trả (3 lượt 1 lần)", () => {
    const S = 10;
    const me = () => pet(S, { skills: [0], stats: { ...SLOW, hp: 99999 } });
    expect(duel([me()], [bruiser()], times(2)).procs(S)).toContain("húc trả");
    const two = double([me(), mate()], [bruiser(), bruiser()], rounds(2, [0, 0]));
    expect(two.procs(S)).toContain("húc trả");
  });

  it("11 Nhiệt Bạo Phong Tốc Khuyển: vượt tốc cộng sát thương, đòn đầu giảm tốc", () => {
    const S = 11;
    const me = () => pet(S, { skills: [0], stats: { speed: 300 } });
    for (const r of [
      duel([me()], [dummy(34, { stats: { speed: 100 } })], times(2)),
      double(
        [me(), mate()],
        [dummy(34, { stats: { speed: 100 } }), dummy(34, { stats: { speed: 100 } })],
        rounds(2, [0, 1]),
      ),
    ]) {
      expect(r.procs(S)).toContain("vượt tốc");
      expect(r.procs(S).filter((l) => l === "giảm tốc").length).toBe(1);
    }
  });

  it("12 Tuyệt Đối Linh Độ Khuyển: đánh mục tiêu bị Giam Cầm thì giảm tốc; 2v2 cả đội vượt tốc", () => {
    const S = 12;
    const me = () => pet(S, { skills: [1012, 3], stats: { speed: 300 } });
    const foe = () => dummy(34, { stats: { speed: 100 } });
    const one = duel([me()], [foe()], [0, 1, 1]);
    expect(one.procs(S)).toContain("vượt tốc");
    expect(one.procs(S)).toContain("giam cầm chậm");
    const two = double(
      [me(), mate()],
      [foe(), foe()],
      [
        [
          [0, 0],
          [0, 1],
        ],
        ...rounds(2, [1, 0]),
      ],
    );
    expect(two.procs(S)).toContain("giam cầm chậm");
    expect(two.procs(S)).toContain("cả đội vượt tốc");
  });

  it("13 Hỏa Diễm Tường Vân Khuyển: đánh tích Vân, 2 Vân tiêu thành +25%; 2v2 đồng đội nhận Vân", () => {
    const S = 13;
    const me = () => pet(S, { skills: [0], stats: FAST });
    const one = duel([me()], [slowHitter()], times(4));
    expect(one.procs(S)).toContain("vân");
    expect(one.procs(S)).toContain("tiêu vân");
    expect(one.procs(S)).toContain("vân chắn");
    const two = double([me(), mate()], [slowHitter(), slowHitter()], rounds(4, [0, 0]));
    expect(two.procs(S)).toContain("tiêu vân");
    const gift = two.log.find((p) => p.speciesId === S && p.label === "vân đồng đội");
    expect(gift?.targetSpecies).toBe(68);
  });

  it("14 Tà Vân Khuyển Thần: đòn nào cũng khắc Tà Ấn, chiêu Hỏa tiêu ấn và hồi; 2v2 đồng đội Hỏa tiêu ấn", () => {
    const S = 14;
    // Ảnh thứ (Quỷ) rồi Hỏa Vân triệu (Hỏa); cũng thử chỉ dùng chiêu Hỏa.
    const me = () => pet(S, { skills: [50, 3], hpPct: 50, stats: FAST });
    const one = duel([me()], [dummy(34, { stats: SLOW })], [0, 0, 1]);
    expect(one.procs(S).filter((l) => l === "tà ấn").length).toBe(2);
    expect(one.procs(S)).toContain("tiêu ấn");
    expect(one.procs(S)).toContain("hút ấn");
    const fireOnly = duel([me()], [dummy(34, { stats: SLOW })], [1, 1]);
    expect(fireOnly.procs(S)).toEqual(expect.arrayContaining(["tà ấn", "tiêu ấn", "hút ấn"]));
    const two = double(
      [me(), mate()],
      [dummy(34, { stats: SLOW }), dummy(34, { stats: SLOW })],
      rounds(2, [0, 0], [0, 0]),
    );
    expect(two.procs(S)).toContain("tà ấn");
    expect(procOn(two, S, "đồng đội tiêu ấn")).toContain(68);
  });

  it("15 Hỏa Phượng Hoàng: tái sinh một lần, chiêu Hỏa +25%, chiêu hồi máu hồi thêm; 2v2 hồi đồng đội và gieo hạt", () => {
    const S = 15;
    const me = () => pet(S, { skills: [0, 1016], stats: { ...SLOW, hp: 1200 } });
    const one = duel([me()], [bruiser()], [1, ...times(8)]);
    expect(one.procs(S)).toContain("hồi thêm");
    expect(one.procs(S)).toContain("tái sinh");
    expect(one.procs(S)).toContain("hỏa +25%");
    expect(one.procs(S).filter((l) => l === "tái sinh").length).toBe(1);
    const two = double([me(), mate({ hpPct: 50 })], [bruiser(), bruiser()], rounds(8, [0, 0]));
    expect(two.procs(S)).toContain("tái sinh");
    expect(two.procs(S)).toContain("lửa hồi đồng đội");
    expect(two.procs(S).filter((l) => l === "niết bàn gieo hạt").length).toBe(2);
  });

  it("16 Diệp Tán Oa: Gieo Hạt của pet trừ máu thì hút nhựa", () => {
    const S = 16;
    const me = () => pet(S, { skills: [1], hpPct: 50 });
    expect(duel([me()], [dummy()], times(2)).procs(S)).toContain("hút nhựa");
    const two = double(
      [me(), mate()],
      [dummy(), dummy()],
      [
        [
          [0, 0],
          [0, 0],
        ],
        [
          [0, 1],
          [0, 1],
        ],
      ],
    );
    const ticks = two.log.filter((p) => p.speciesId === S && p.label === "hút nhựa");
    expect(new Set(ticks.map((p) => p.targetSpecies)).size).toBeGreaterThan(0);
  });

  it("17 Thụ Tán Oa: hút nhựa tối đa 8% và khóa đổi pet", () => {
    const S = 17;
    const me = () => pet(S, { skills: [1], hpPct: 50 });
    for (const r of [
      duel([me()], [dummy()], times(2)),
      double([me(), mate()], [dummy(), dummy()], rounds(2, [0, 0])),
    ]) {
      expect(r.procs(S)).toContain("hút nhựa");
      expect(r.procs(S)).toContain("khóa đổi pet");
    }
  });

  it("18 Long Oa: hút nhựa, dư thành khiên; 2v2 nuôi đồng đội thấp máu", () => {
    const S = 18;
    expect(duel([pet(S, { skills: [1] })], [dummy()], times(2)).procs(S)).toContain("khiên rễ");
    const two = double(
      [pet(S, { skills: [1], hpPct: 90 }), mate({ hpPct: 30 })],
      [dummy(), dummy()],
      rounds(2, [0, 0]),
    );
    expect(two.procs(S)).toContain("nuôi đồng đội");
  });

  it("19 Tiên Nhân Cầu Bảo Bảo: gai phản kẻ đánh", () => {
    const S = 19;
    const me = () => pet(S, { skills: [0], stats: { hp: 99999 } });
    expect(duel([me()], [bruiser()], times(3)).procs(S)).toContain("gai");
    const two = double([meek(), me()], [bruiser(), bruiser()], rounds(3, [0, 0]));
    expect(two.procs(S)).toContain("gai");
  });

  it("20 Tiên Nhân Chưởng Thú: gai phản kẻ đánh", () => {
    const S = 20;
    const me = () => pet(S, { skills: [0], stats: { hp: 99999 } });
    expect(duel([me()], [bruiser()], times(3)).procs(S)).toContain("gai");
    const two = double([meek(), me()], [bruiser(), bruiser()], rounds(3, [0, 0]));
    expect(two.procs(S)).toContain("gai");
  });

  it("21 Thiết Tý Phách Vương Thụ: gai phản; 2v2 gai bảo kê đồng đội", () => {
    const S = 21;
    const me = () => pet(S, { skills: [0], stats: { hp: 99999 } });
    expect(duel([me()], [bruiser()], times(3)).procs(S)).toContain("gai");
    const two = double([me(), mate()], [bruiser(), bruiser()], rounds(4, [0, 0]));
    expect(two.procs(S)).toContain("gai bảo kê");
  });

  it("22 Khẩu Đại Thảo: kẻ đánh đầu tiên bị Quấn Quanh, đánh mục tiêu bị trói +22%; 2v2 đồng đội +10%", () => {
    const S = 22;
    const me = () => pet(S, { skills: [0], stats: { ...SLOW, hp: 99999 } });
    const one = duel([me()], [bruiser()], times(2));
    expect(one.procs(S)).toContain("bẫy");
    expect(one.procs(S)).toContain("cắn mồi");
    const two = double([meek(), me()], [bruiser(), dummy()], rounds(3, [0, 0], [0, 0]));
    expect(two.procs(S)).toContain("bẫy");
    expect(two.procs(S)).toContain("đồng đội +10%");
  });

  it("23 Khốc Tị Mộc Linh: hồi máu gieo hạt và che 25%, đánh mục tiêu bị Gieo Hạt thì hút; 2v2 che đồng đội", () => {
    const S = 23;
    const me = () => pet(S, { skills: [1024, 3], hpPct: 50, stats: { ...FAST, hp: 99999 } });
    const one = duel([me()], [slowHitter()], [0, 1]);
    expect(one.procs(S)).toContain("gieo hạt");
    expect(one.procs(S)).toContain("che 25%");
    expect(one.procs(S)).toContain("hút huyết");
    const two = double(
      [me(), mate({ hpPct: 50 })],
      [slowHitter(), slowHitter()],
      [
        [
          [0, 3],
          [0, 0],
        ],
        ...rounds(3, [0, 3], [0, 0]),
      ],
    );
    expect(two.procs(S)).toContain("gieo hạt");
    expect(two.procs(S)).toContain("che đồng đội");
  });

  it("24 La Phục Thảo: khiên củ khi ra sân và mỗi 3 lượt, dư thành máu, có khiên thì hồi thêm; 2v2 khiên đồng đội", () => {
    const S = 24;
    const heal = skillId("La Phục Dưỡng Căn · Dưỡng");
    const me = () => pet(S, { skills: [heal, 0], hpPct: 50 });
    const first = duel([me()], [dummy()], [0]);
    expect(first.procs(S)).toContain("khiên củ");
    expect(first.procs(S)).toContain("củ hồi thêm");
    expect(live1(first).shieldHp()).toBeGreaterThan(0);
    const one = duel([me()], [dummy()], times(5, 1));
    expect(one.procs(S).filter((l) => l === "khiên củ").length).toBeGreaterThanOrEqual(2);
    expect(one.procs(S)).toContain("củ hồi máu");
    const two = double([me(), mate()], [dummy(), dummy()], rounds(4, [1, 0]));
    expect(two.procs(S).filter((l) => l === "khiên củ").length).toBeGreaterThanOrEqual(2);
    expect(procOn(two, S, "khiên đồng đội").length).toBeGreaterThanOrEqual(2);
    expect(procOn(two, S, "khiên đồng đội")).toContain(68);
  });

  it("25 La phục Oa Oa: khiên ra sân, chiêu phòng thủ làm mới khiên", () => {
    const S = 25;
    const me = () => pet(S, { skills: [1026, 3], hpPct: 50 });
    for (const r of [
      duel([me()], [dummy()], [1, 1, 0, 1]),
      double(
        [me(), mate()],
        [dummy(), dummy()],
        [
          ...rounds(2, [1, 0]),
          [
            [0, 2],
            [0, 0],
          ],
        ],
      ),
    ]) {
      expect(r.procs(S)).toContain("khiên củ");
      expect(r.procs(S)).toContain("củ hồi máu");
      expect(r.procs(S)).toContain("làm mới khiên");
    }
  });

  it("26 Tây Quan Tiểu Hương Trư: chiêu phòng thủ giảm sát thương, có tăng DEF thì húc thêm; 2v2 đồng đội DEF", () => {
    const S = 26;
    const me = () => pet(S, { skills: [14, 3], stats: { ...FAST, hp: 99999 } });
    const one = duel([me()], [slowHitter()], [0, 1]);
    expect(one.procs(S)).toContain("thủ thế");
    expect(one.procs(S)).toContain("gạc húc");
    const two = double(
      [me(), mate()],
      [slowHitter(), slowHitter()],
      [
        [
          [0, 2],
          [0, 0],
        ],
        [
          [1, 0],
          [0, 0],
        ],
      ],
    );
    expect(two.procs(S)).toContain("gạc húc");
    const buff = two.log.find((p) => p.speciesId === S && p.label === "đồng đội DEF");
    expect(buff?.targetSpecies).toBe(68);
  });

  it("27 Trư Lộc Điệp: chiêu phòng thủ hồi 6% và giảm sát thương; 2v2 đồng đội +8%", () => {
    const S = 27;
    const me = () => pet(S, { skills: [14, 3], hpPct: 50, stats: { ...FAST, hp: 99999 } });
    const one = duel([me()], [slowHitter()], [0, 1]);
    expect(one.procs(S)).toContain("hồi 6%");
    expect(one.procs(S)).toContain("thủ thế");
    expect(one.procs(S)).toContain("gạc húc");
    const two = double(
      [me(), mate()],
      [slowHitter(), slowHitter()],
      [
        [
          [0, 2],
          [0, 0],
        ],
        [
          [1, 0],
          [0, 0],
        ],
      ],
    );
    expect(two.procs(S)).toContain("đồng đội +8%");
  });

  it("28 Cương Tán Ma Cô: ô thép đỡ đòn đầu mỗi lượt, 2 lần đỡ thì khiên, rút bằng · Chuyển cho khiên; 2v2 che đồng đội", () => {
    const S = 28;
    const one = duel([pet(S, { skills: [0], stats: { hp: 3000 } })], [bruiser()], times(3));
    expect(one.procs(S).filter((l) => l === "ô đỡ").length).toBe(3);
    expect(procOn(one, S, "khiên ô")).toContain(S);
    const pivot = pet(S, { skills: [skillId("Thiết Tán Hồi Chuyển · Chuyển")], stats: FAST });
    const swap = duel([pivot, mate()], [dummy(34, { stats: SLOW })], [0]);
    expect(procOn(swap, S, "khiên đổi gác")).toContain(68);
    const next = live1(swap);
    expect(next.speciesId).toBe(68);
    expect(next.shieldHp()).toBeGreaterThan(0);
    // Pet đánh rất yếu: AI đối thủ nhắm đồng đội, ô che đồng đội và trao khiên cho nó.
    const two = double(
      [pet(S, { skills: [0], stats: { hp: 99999, attack: 1 } }), mate({ stats: { hp: 3000 } })],
      [bruiser(), bruiser()],
      rounds(3, [0, 0]),
    );
    expect(procOn(two, S, "ô đỡ")).toContain(68);
    expect(procOn(two, S, "khiên ô")).toContain(68);
  });

  it("29 Uy Qua Đệ Đệ: đòn trúng ru Ngủ (3 lượt 1 lần), tỉnh thì Mơ Màng giảm sát thương; 2v2 đồng đội +10%", () => {
    const S = 29;
    const me = (speed: number) => pet(S, { skills: [0], stats: { speed, hp: 99999 } });
    const one = duel(
      [me(9999)],
      [pet(34, { skills: [30], stats: { ...SLOW, hp: 99999 } })],
      times(4),
    );
    expect(one.procs(S).filter((l) => l === "ru ngủ").length).toBe(2);
    expect(one.procs(S)).toContain("tỉnh mơ màng");
    expect(one.procs(S)).toContain("mơ màng");
    const two = double(
      [me(9999), mate({ stats: { speed: 50 } })],
      [
        pet(34, { skills: [30], stats: { ...SLOW, hp: 99999 } }),
        pet(34, { skills: [30], stats: { ...SLOW, hp: 99999 } }),
      ],
      rounds(3, [0, 0], [0, 0]),
    );
    expect(two.procs(S)).toContain("ru ngủ");
    expect(procOn(two, S, "đồng đội +10%")).toContain(68);
    expect(two.procs(S)).toContain("tỉnh mơ màng");
  });

  it("30 Thảo Diệp Cô: trả hiệu ứng xấu về kẻ gây, sạch thì hồi 5%", () => {
    const S = 30;
    const me = () => pet(S, { skills: [0], hpPct: 50, stats: { hp: 99999 } });
    const seeder = () => pet(34, { skills: [1], stats: { speed: 9999, hp: 99999 } });
    const one = duel([me()], [seeder()], times(3));
    expect(one.procs(S)).toContain("phản ương");
    expect(one.procs(S)).toContain("trả ương");
    expect(one.procs(S)).toContain("tịnh diệp");
    const two = double([me(), mate()], [seeder(), seeder()], rounds(3, [0, 0]));
    expect(two.procs(S)).toContain("trả ương");
  });

  it("31 Linh Quang Lộc: hồi tràn thành khiên, mục tiêu được hồi +30% đòn kế; 2v2 cho đồng đội", () => {
    const S = 31;
    const me = () => pet(S, { skills: [1032, 3], stats: FAST });
    const one = duel([me()], [dummy()], [0, 1]);
    expect(one.procs(S)).toContain("khiên tràn");
    expect(one.procs(S)).toContain("chúc phúc");
    expect(one.procs(S)).toContain("phúc +30%");
    const two = double(
      [me(), mate()],
      [dummy(), dummy()],
      [
        [
          [0, 3],
          [0, 0],
        ],
      ],
    );
    const boost = two.log.find((p) => p.speciesId === S && p.label === "phúc +30%");
    expect(boost?.targetSpecies).toBe(68);
    expect(two.procs(S)).toContain("khiên tràn");
  });

  it("32 Kim Chỉ Ốc: mỗi lượt chặn đòn nặng đầu tiên, tích tầng Phòng ngự", () => {
    const S = 32;
    const me = () => pet(S, { skills: [0], stats: { hp: 400 } });
    const one = duel([me()], [bruiser()], times(3));
    expect(one.procs(S).filter((l) => l === "vỏ chặn").length).toBeGreaterThanOrEqual(2);
    const self = live1(one);
    if (self.hp() > 0) expect(self.currentStats.defense).toBeGreaterThan(self.baseStats.defense);
    const two = double(
      [meek(), me()],
      [bruiser(), bruiser()],
      [
        [
          [0, 0],
          [0, 0],
        ],
      ],
    );
    expect(two.procs(S)).toContain("vỏ chặn");
  });

  it("33 Mèo YeDoon: đòn trúng gây Mê Muội; mục tiêu Mê Muội thì ưu tiên và +20%; 2v2 đồng đội cũng +10%", () => {
    const S = 33;
    const me = () => pet(S, { skills: [0], stats: { speed: 50 } });
    const one = duel([me()], [dummy(34, { stats: FAST })], times(3));
    expect(one.procs(S)).toContain("mê muội");
    const daze = KIT_STATUS.daze;
    const once = duel([me()], [dummy(34, { stats: FAST })], [0]);
    expect(live1(once, "enemy").statuses.has(daze.bank, daze.id)).toBe(true);
    // Chiêu Mê Muội 2 lượt của pet (Diễm kích) để còn Mê Muội ở lượt sau: ưu tiên và +20%.
    const skill = () => pet(S, { skills: [2, 0], stats: { speed: 50 } });
    const r = duel([skill()], [dummy(34, { stats: FAST })], [0, 1, 1]);
    expect(r.procs(S)).toContain("ưu tiên");
    expect(r.procs(S)).toContain("vờn");
    // 2v2: Mê Muội và ưu tiên/+20% lên đối thủ bị pet làm Mê Muội; đồng đội đánh nó +10%.
    const two = double(
      [skill(), mate()],
      [dummy(34, { stats: FAST }), dummy(34, { stats: FAST })],
      [
        [
          [0, 0],
          [0, 0],
        ],
        ...rounds(2, [1, 0]),
      ],
    );
    expect(two.procs(S)).toContain("ưu tiên");
    expect(procOn(two, S, "vờn")).toContain(34);
    expect(two.procs(S)).toContain("đồng đội vờn");
  });

  it("34 Thỏ Di Lặc Bunny: Tĩnh giảm sát thương, Động tăng sát thương và hồi; 2v2 đồng đội tốc", () => {
    const S = 34;
    const me = () => pet(S, { skills: [0], hpPct: 55, stats: { ...SLOW, hp: 3000 } });
    const one = duel([me()], [bruiser()], times(3));
    expect(one.procs(S)).toContain("tĩnh");
    expect(one.procs(S)).toContain("chuyển động");
    expect(one.procs(S)).toContain("động");
    const two = double([me(), mate()], [bruiser(), bruiser()], rounds(3, [0, 0]));
    const haste = two.log.find((p) => p.speciesId === S && p.label === "đồng đội tốc");
    expect(haste?.targetSpecies).toBe(68);
  });

  it("35 Toản Địa Khâu Dẫn: đánh trúng phá giáp mục tiêu", () => {
    const S = 35;
    const me = () => pet(S, { skills: [0], stats: SLOW });
    expect(duel([me()], [dummy(34, { stats: FAST })], times(2)).procs(S)).toContain("phá giáp");
    const two = double([me(), mate()], [dummy(34, { stats: FAST }), dummy()], rounds(2, [0, 0]));
    const hit = two.log.find((p) => p.speciesId === S && p.label === "phá giáp");
    expect(hit?.targetSide).toBe(1);
  });

  it("36 Toái nham Khâu Dẫn: đủ 3 tầng phá giáp thì gỡ buff", () => {
    const S = 36;
    const me = () => pet(S, { skills: [0], stats: SLOW });
    const buffer = () => pet(34, { skills: [14], stats: { attack: 1, hp: 99999, speed: 9999 } });
    for (const r of [
      duel([me()], [buffer()], times(3)),
      double([me(), mate()], [buffer(), buffer()], rounds(3, [0, 0], [0, 1])),
    ]) {
      expect(r.procs(S)).toContain("phá giáp");
      expect(r.procs(S)).toContain("gỡ buff");
    }
  });

  it("37 Nham Nham Quy: bị đánh thì rụt cổ có khiên", () => {
    const S = 37;
    const me = () => pet(S, { skills: [0], stats: { hp: 99999 } });
    expect(duel([me()], [bruiser()], times(2)).procs(S)).toContain("rụt cổ");
    expect(double([meek(), me()], [bruiser(), bruiser()], rounds(2, [0, 0])).procs(S)).toContain(
      "rụt cổ",
    );
  });

  it("38 Kiếm Giáp Hạn Quy: dưới 50% HP bị đánh thì có khiên, khiên vỡ thì nổ vào kẻ phá khiên", () => {
    const S = 38;
    const me = () => pet(S, { skills: [0], hpPct: 49, stats: { hp: 1500 } });
    // Khiên 33% HP tối đa: cần đối thủ đánh mạnh mới phá kịp trong 2 lượt.
    const breaker = () => pet(34, { skills: [30], stats: { speed: 9999, hp: 99999, attack: 800 } });
    // Còn trên 50% HP thì chưa dựng khiên.
    expect(
      duel([pet(S, { skills: [0], stats: { hp: 99999 } })], [bruiser()], times(2)).procs(S),
    ).not.toContain("kiếm giáp");
    for (const r of [
      duel([me()], [breaker()], times(4)),
      double([meek(), me()], [breaker(), breaker()], rounds(4, [0, 0])),
    ]) {
      expect(r.procs(S)).toContain("kiếm giáp");
      expect(r.procs(S)).toContain("khiên nổ");
    }
  });

  it("39 Bạch Châm Bảo Bảo: bị đánh tích Kim, đòn kế bắn Kim; 2v2 tích khi đồng đội bị đánh", () => {
    const S = 39;
    const me = () => pet(S, { skills: [0], stats: { ...SLOW, hp: 99999 } });
    const one = duel([me()], [bruiser()], times(2));
    expect(one.procs(S)).toContain("kim");
    expect(one.procs(S)).toContain("bắn kim");
    const two = double([me(), mate()], [bruiser(), bruiser()], rounds(3, [0, 0]));
    expect(two.procs(S)).toContain("bắn kim");
    expect(two.procs(S).some((l) => l === "kim" || l === "kim đồng đội")).toBe(true);
  });
});

describe("kịch bản đặc tính phần 1: một mô tả duy nhất", () => {
  it("pet 0..39 chỉ có một mô tả, mọi số trong mô tả đều lấy từ params", () => {
    for (let id = 0; id <= 39; id++) {
      const script = PART_1[id];
      expect(script, `kịch bản ${id}`).toBeDefined();
      expect(script.text2v2, `text2v2 ${id}`).toBeUndefined();
      expect(script.text, `text ${id}`).not.toMatch(/1v1|2v2/i);
      expect(renderTraitText(id, script), `render ${id}`).not.toMatch(/[{}]/);
    }
  });
});
