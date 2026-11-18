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
import type { DoubleSlot, ScenarioResult } from "../TraitScenario.testutil";
import { PART_4 } from "./part4";

const { duel, double, pet, dummy, skillId } = await import("../TraitScenario.testutil");

/** Pet đang trên sân của loài `speciesId` (phe người chơi mặc định). */
type FieldUnit = {
  speciesId: number;
  ownerSide: number;
  hp(): number;
  maxHp(): number;
  shieldHp(): number;
  statuses: { get(bank: number, id: number): { stackCount: number } | undefined };
  kit?: { v: Record<string, number> };
};
function unitOf(res: ScenarioResult, speciesId: number, side = 0): FieldUnit {
  const units = (
    res.core as { projection: { kit: { units(): FieldUnit[] } } }
  ).projection.kit.units();
  const unit = units.find((u) => u.speciesId === speciesId && u.ownerSide === side);
  if (!unit) throw new Error(`không thấy pet ${speciesId} phe ${side} trên sân`);
  return unit;
}
/** Số tầng Phòng ngự thật (buff 4). */
const defenseTiers = (unit: FieldUnit) => unit.statuses.get(0, 4)?.stackCount ?? 0;
/** Số lần nhãn `label` của loài `speciesId` kích hoạt trong mỗi vòng. */
function perRound(res: ScenarioResult, speciesId: number, labels: string[]): number[] {
  const counts = new Map<number, number>();
  for (const p of res.log)
    if (p.speciesId === speciesId && p.side === 0 && labels.includes(p.label))
      counts.set(p.round, (counts.get(p.round) ?? 0) + 1);
  return [...counts.values()];
}

const SLOW = { speed: 1 };
const FAST = { speed: 9999 };
const TANK = { hp: 99999 };
/** Đối thủ đánh trước, đủ đau để pet mất máu, rất trâu. */
const bruiser = () => pet(34, { skills: [30], stats: { speed: 9999, hp: 99999 } });
/** Đối thủ đánh sau, có đòn thật, rất trâu. */
const hitter = () => pet(34, { skills: [30], stats: { speed: 1, hp: 99999 } });
const slowDummy = () => dummy(34, { stats: SLOW });
const s = (...names: string[]) => names.map((n) => skillId(n));
/** `n` vòng 2v2: pet ô 2 dùng lệnh `a`, pet ô 3 dùng lệnh `b`. */
const rounds = (
  n: number,
  a: [number, DoubleSlot] = [0, 0],
  b: [number, DoubleSlot] = [0, 0],
): [number, DoubleSlot][][] => Array.from({ length: n }, () => [a, b]);
/** Đồng đội trâu, đánh nhẹ, chậm. */
const mate = (id = 68) => pet(id, { skills: [30], stats: { ...SLOW, ...TANK } });

describe("kịch bản đặc tính phần 4: chạy trong 1v1 và 2v2", () => {
  it("120 Thủy Tinh Hùng Sư: gầm, xuyên giáp, gỡ buff làm mới gầm", () => {
    const S = 120;
    const me = () => pet(S, { skills: s("Sóng điện từ"), stats: { ...SLOW, ...TANK } });
    const buffer = () => dummy(34, { skills: s("Thiên Hỏa tế"), stats: FAST });
    const one = duel([me()], [buffer()], [0, 0]);
    expect(one.procs(S)).toContain("gầm");
    expect(one.procs(S)).toContain("xuyên giáp");
    expect(one.procs(S)).toContain("làm mới gầm");
    const two = double([me(), mate()], [buffer(), buffer()], rounds(2, [0, 0], [0, 1]));
    const roars = two.log.filter((p) => p.speciesId === S && p.label === "gầm");
    expect(new Set(roars.map((p) => p.targetSpecies + ":" + p.targetSide)).size).toBe(1);
    expect(roars.length).toBe(2);
    expect(two.procs(S)).toContain("làm mới gầm");
  });

  it("121 Xích Đồng Xà: Vòng Siết khi đánh liên tiếp", () => {
    const S = 121;
    const me = () => pet(S, { skills: s("Điện giật"), stats: { ...FAST, ...TANK } });
    const one = duel([me()], [slowDummy()], [0, 0, 0]);
    expect(one.procs(S)).toContain("vòng siết");
    expect(one.procs(S)).toContain("siết +%");
    const two = double([me(), mate()], [slowDummy(), slowDummy()], rounds(3));
    expect(two.procs(S)).toContain("vòng siết");
    expect(two.procs(S)).toContain("siết +%");
  });

  it("122 Thiết Giáp Xà: mục tiêu bị siết đánh pet thì mất máu", () => {
    const S = 122;
    const me = () => pet(S, { skills: s("Điện giật"), stats: { ...FAST, ...TANK } });
    const one = duel([me()], [hitter()], [0, 0, 0]);
    expect(one.procs(S)).toContain("vòng siết");
    expect(one.procs(S)).toContain("gai siết");
    // Gai siết chỉ 1 lần mỗi lần ra sân.
    const long = duel([me()], [hitter()], [0, 0, 0, 0, 0, 0]);
    expect(long.procs(S).filter((l) => l === "gai siết").length).toBe(1);
    const two = double([me(), mate()], [hitter(), hitter()], rounds(3));
    expect(two.procs(S)).toContain("gai siết");
  });

  it("123 Xích Kim Xà Vương: · Bạo tiêu 3 Vòng, gây Tê Liệt", () => {
    const S = 123;
    const me = () =>
      pet(S, { skills: s("Điện giật", "Xà Vương Lôi Tỏa · Bạo"), stats: { ...FAST, ...TANK } });
    const one = duel([me()], [slowDummy()], [0, 0, 0, 0, 1]);
    expect(one.procs(S)).toContain("nghiền cốt");
    expect(one.procs(S)).toContain("tê liệt");
    const two = double(
      [me(), mate()],
      [slowDummy(), slowDummy()],
      [...rounds(4), ...rounds(1, [1, 0], [0, 0])],
    );
    expect(two.procs(S)).toContain("nghiền cốt");
    expect(two.procs(S)).toContain("tê liệt");
  });

  it("124 Xích Kim Xà Hậu: Lôi gây Tê Liệt, đánh mục tiêu Tê Liệt thì hút", () => {
    const S = 124;
    const me = () => pet(S, { skills: s("Lôi thiểm"), stats: { ...FAST, ...TANK }, hpPct: 50 });
    const one = duel([me()], [slowDummy()], [0, 0, 0]);
    expect(one.procs(S)).toContain("hút sinh lực");
    const two = double([me(), mate()], [slowDummy(), slowDummy()], rounds(3));
    expect(two.procs(S)).toContain("hút sinh lực");
  });

  it("125 Binh lính Thiết Giáp: vào sân và mỗi lượt bị đánh lần đầu thêm tầng giáp; che đồng đội", () => {
    const S = 125;
    const me = () => pet(S, { skills: [30], stats: { ...SLOW, ...TANK } });
    const one = duel([me()], [bruiser()], [0, 0]);
    expect(one.procs(S)).toContain("nhận tầng giáp");
    expect(one.procs(S)).toContain("giáp tầng");
    expect(one.procs(S).filter((l) => l === "bị đánh thêm tầng").length).toBe(2);
    // 1 tầng khi vào sân + 1 mỗi lượt bị đánh = 3 tầng Phòng ngự thật (buff 4).
    expect(defenseTiers(unitOf(one, S))).toBe(3);
    // 2v2: hai đối thủ cùng đánh pet, mỗi lượt chỉ thêm 1 tầng.
    const both = double(
      [pet(S, { skills: [30], stats: { ...SLOW, ...TANK, attack: 5000 } }), mate()],
      [bruiser(), bruiser()],
      rounds(2),
    );
    for (const n of perRound(both, S, ["bị đánh thêm tầng"])) expect(n).toBe(1);
    const two = double([me(), mate()], [bruiser(), bruiser()], rounds(1));
    expect(two.procs(S)).toContain("che đồng đội");
  });

  it("126 Đội trưởng Thiết Giáp: Lôi Thiết Bạo Vũ đổi tầng thành khiên", () => {
    const S = 126;
    const me = () => pet(S, { skills: s("Lôi Thiết Bạo Vũ"), stats: { ...FAST, ...TANK } });
    const one = duel([me()], [slowDummy()], [0]);
    expect(one.procs(S)).toContain("giáp thành khiên");
    const two = double([me(), mate()], [slowDummy(), slowDummy()], rounds(1));
    expect(two.procs(S)).toContain("khiên chia đồng đội");
  });

  it("127 Tướng Thiết Giáp: đủ 3 tầng phản đòn nặng", () => {
    const S = 127;
    const me = () => pet(S, { skills: s("Thổ thuẫn"), stats: { ...FAST, hp: 6000, defense: 1 } });
    const heavy = () => pet(34, { skills: [30], stats: { speed: 1, hp: 99999, attack: 1500 } });
    const one = duel([me()], [heavy()], [0, 0]);
    expect(one.procs(S)).toContain("phản giáp");
    const two = double([me(), mate()], [heavy(), slowDummy()], rounds(2));
    expect(two.procs(S)).toContain("phản giáp");
    // Khiêu khích: đối thủ định đánh đồng đội yếu bị kéo về pet.
    const taunt = double(
      [me(), pet(68, { skills: [30], hpPct: 5, stats: { ...SLOW, hp: 30000 } })],
      [hitter(), hitter()],
      rounds(3),
    );
    expect(taunt.procs(S)).toContain("khiêu khích");
  });

  it("128 Song Đao Tướng Quân: đổi chiêu tích dấu, chém nhát thứ hai", () => {
    const S = 128;
    const me = () =>
      pet(S, {
        skills: s("Hỏa trảo", "Hỏa diễm đao", "Song Đao Liên Trảm · Bạo"),
        stats: { ...FAST, ...TANK },
      });
    const one = duel([me()], [slowDummy()], [0, 1, 0, 1, 0, 1, 2]);
    expect(one.procs(S)).toContain("dấu liên trảm");
    expect(one.procs(S)).toContain("nhát thứ hai");
    expect(one.procs(S)).toContain("liên trảm bạo");
    const two = double(
      [me(), mate()],
      [slowDummy(), slowDummy()],
      [...rounds(1, [0, 0]), ...rounds(1, [1, 0]), ...rounds(1, [0, 0]), ...rounds(1, [1, 0])],
    );
    const second = two.log.find((p) => p.speciesId === S && p.label === "nhát thứ hai");
    expect(second).toBeDefined();
  });

  it("129 Đao Thương Tướng Quân: đòn nặng cho khiên, phá khiên bị phạt", () => {
    const S = 129;
    const me = () => pet(S, { skills: [30], stats: { ...FAST, hp: 6000, defense: 1 } });
    const heavy = () => pet(34, { skills: [30], stats: { speed: 1, hp: 99999, attack: 1500 } });
    const one = duel([me()], [heavy()], [0, 0]);
    expect(one.procs(S)).toContain("khiên phản trận");
    expect(one.procs(S)).toContain("thuẫn vỡ");
    const two = double([me(), mate()], [heavy(), heavy()], rounds(2));
    expect(two.procs(S)).toContain("khiên phản trận");
  });

  it("130 Thiết Đầu: chiêu Thổ đi sau gây Hóa Đá", () => {
    const S = 130;
    const me = () => pet(S, { skills: s("Hất bụi"), stats: { ...SLOW, ...TANK } });
    const fastDummy = () => dummy(34, { stats: FAST });
    const one = duel([me()], [fastDummy()], [0]);
    expect(one.procs(S)).toContain("hóa đá (đi sau)");
    const two = double([me(), mate()], [fastDummy(), fastDummy()], rounds(1));
    expect(two.procs(S)).toContain("hóa đá (đi sau)");
  });

  it("131 Thiết Cự Nhân: tích Chấn Lực, chiêu Thổ xả và Hóa Đá", () => {
    const S = 131;
    const me = () => pet(S, { skills: s("Hỏa trảo", "Hất bụi"), stats: { ...SLOW, ...TANK } });
    const one = duel([me()], [bruiser()], [0, 0, 0, 1]);
    expect(one.procs(S)).toContain("chấn lực");
    expect(one.procs(S)).toContain("xả chấn lực");
    expect(one.procs(S)).toContain("hóa đá");
    const two = double(
      [me(), mate()],
      [bruiser(), bruiser()],
      [...rounds(2), ...rounds(1, [1, 0])],
    );
    expect(two.procs(S).filter((l) => l === "chấn lực").length).toBeGreaterThanOrEqual(3);
    expect(two.procs(S)).toContain("hóa đá");
  });

  it("132 Thiết Cự Linh: đủ 3 Chấn Lực thì dư chấn mọi đối thủ", () => {
    const S = 132;
    const me = () => pet(S, { skills: s("Hỏa trảo", "Hất bụi"), stats: { ...SLOW, ...TANK } });
    const one = duel([me()], [bruiser()], [0, 0, 0, 1]);
    expect(one.procs(S)).toContain("xả chấn lực");
    expect(one.procs(S)).toContain("dư chấn");
    const two = double(
      [me(), mate()],
      [bruiser(), bruiser()],
      [...rounds(2), ...rounds(1, [1, 0])],
    );
    const shocks = two.log.filter((p) => p.speciesId === S && p.label === "dư chấn");
    expect(shocks.length).toBe(2);
  });

  it("133 Người điện: gỡ buff thành Điện Áp, chiêu Lôi xả", () => {
    const S = 133;
    const me = () => pet(S, { skills: s("Điện giật"), stats: { ...SLOW, ...TANK } });
    const buffer = () => dummy(34, { skills: s("Thiên Hỏa tế"), stats: FAST });
    const one = duel([me()], [buffer()], [0, 0]);
    expect(one.procs(S)).toContain("gỡ buff/khiên");
    expect(one.procs(S)).toContain("điện áp");
    expect(one.procs(S)).toContain("xả điện áp");
    expect(duel([me()], [slowDummy()], [0]).procs(S)).toContain("lôi +10%");
    const zap = pet(S, { skills: s("Sóng điện từ"), stats: { ...SLOW, ...TANK } });
    const two = double([zap, mate()], [buffer(), buffer()], rounds(3));
    expect(two.procs(S)).toContain("xả điện áp");
  });

  it("134 Đồng Cầu huynh đệ: nảy bật sau đòn nặng; 2v2 anh em song cầu", () => {
    const S = 134;
    const me = () => pet(S, { skills: [30], stats: { ...FAST, hp: 6000, defense: 1 } });
    const heavy = () => pet(34, { skills: [30], stats: { speed: 1, hp: 99999, attack: 1500 } });
    const one = duel([me()], [heavy()], [0, 0]);
    expect(one.procs(S)).toContain("vỏ cầu đỡ đòn");
    expect(one.procs(S)).toContain("nảy bật");
    expect(one.procs(S)).toContain("nảy bật +30%");
    const two = double(
      [me(), pet(135, { skills: [30], stats: TANK })],
      [heavy(), slowDummy()],
      rounds(2),
    );
    expect(two.procs(S)).toContain("anh em song cầu");
    expect(two.procs(135)).toContain("anh em song cầu");
    expect(two.procs(S)).toContain("nảy bật +30%");
  });

  it("135 Thiết Cầu huynh đệ: xuống dưới 50% thì phản lực; 2v2 khiên cho anh em", () => {
    const S = 135;
    const me = () => pet(S, { skills: [30], stats: { ...FAST, hp: 6000, defense: 1 } });
    const heavy = () => pet(34, { skills: [30], stats: { speed: 1, hp: 99999, attack: 1500 } });
    const one = duel([me()], [heavy()], [0, 0, 0]);
    expect(one.procs(S)).toContain("phản lực");
    const two = double(
      [
        pet(S, { skills: [30], hpPct: 55, stats: { ...FAST, hp: 6000, defense: 1 } }),
        pet(134, { skills: [30], hpPct: 10, stats: { ...SLOW, hp: 99999, defense: 9999 } }),
      ],
      [heavy(), heavy()],
      rounds(3),
    );
    const p = two.log.find((x) => x.speciesId === S && x.label === "phản lực");
    expect(p?.targetSpecies).toBe(134);
  });

  it("136 Ấu Long: Thiên Điện tăng sát thương Lôi", () => {
    const S = 136;
    const me = () => pet(S, { skills: s("Điện giật"), stats: { ...FAST, ...TANK } });
    const one = duel([me()], [slowDummy()], [0, 0]);
    expect(one.procs(S)).toContain("thiên điện");
    expect(one.procs(S)).toContain("thiên điện +%");
    const two = double([me(), mate()], [slowDummy(), slowDummy()], rounds(2));
    expect(two.procs(S)).toContain("thiên điện +%");
  });

  it("137 Tiểu Bạch Long: đủ 3 tầng chiêu Lôi gây Tê Liệt", () => {
    const S = 137;
    const me = () => pet(S, { skills: s("Điện giật"), stats: { ...FAST, ...TANK } });
    const one = duel([me()], [slowDummy()], [0, 0, 0, 0]);
    expect(one.procs(S)).toContain("tê liệt");
    const two = double([me(), mate()], [slowDummy(), slowDummy()], rounds(4));
    expect(two.procs(S)).toContain("tê liệt");
  });

  it("138 Kim Dực Long: · Bạo tiêu tầng thành khiên; 2v2 khiên cho đồng đội yếu", () => {
    const S = 138;
    const me = () =>
      pet(S, { skills: s("Điện giật", "Bạch Kim Thiên Điện · Bạo"), stats: { ...FAST, ...TANK } });
    const one = duel([me()], [slowDummy()], [0, 0, 1]);
    expect(one.procs(S)).toContain("tầng thành khiên");
    const weak = pet(68, { skills: [30], hpPct: 10, stats: { ...SLOW, hp: 99999 } });
    const two = double(
      [me(), weak],
      [slowDummy(), slowDummy()],
      [...rounds(2), ...rounds(1, [1, 0])],
    );
    const p = two.log.find((x) => x.speciesId === S && x.label === "tầng thành khiên");
    expect(p?.targetSpecies).toBe(68);
  });

  it("139 Bạch Kim Long: đủ 3 tầng tỏa long uy", () => {
    const S = 139;
    const me = () => pet(S, { skills: s("Điện giật"), stats: { ...FAST, ...TANK } });
    const one = duel([me()], [slowDummy()], [0, 0, 0]);
    expect(one.procs(S)).toContain("long uy");
    const two = double([me(), mate()], [slowDummy(), slowDummy()], rounds(3));
    const p = two.log.find((x) => x.speciesId === S && x.label === "long uy");
    expect(p?.targetSpecies).toBe(68);
  });

  it("140 Ưng: đi trước +12% và tăng tốc; đi sau chiêu Phong hãm tốc", () => {
    const S = 140;
    const fastMe = () => pet(S, { skills: s("Phong nhận"), stats: { ...FAST, ...TANK } });
    const slowMe = () => pet(S, { skills: s("Phong nhận"), stats: { ...SLOW, ...TANK } });
    const fastDummy = () => dummy(34, { stats: FAST });
    const one = duel([fastMe()], [slowDummy()], [0]);
    expect(one.procs(S)).toContain("đi trước +%");
    expect(one.procs(S)).toContain("tăng tốc");
    expect(duel([slowMe()], [fastDummy()], [0]).procs(S)).toContain("hãm tốc");
    const two = double([slowMe(), mate()], [fastDummy(), fastDummy()], rounds(1));
    expect(two.procs(S)).toContain("hãm tốc");
    const two2 = double([fastMe(), mate()], [slowDummy(), slowDummy()], rounds(1));
    expect(two2.procs(S)).toContain("tăng tốc");
  });

  it("141 Vương Thứu: mục tiêu dưới 35% HP luôn tính như đi trước", () => {
    const S = 141;
    const me = () => pet(S, { skills: s("Phong nhận"), stats: { ...SLOW, ...TANK } });
    const low = () =>
      pet(34, { skills: [30], hpPct: 20, stats: { speed: 9999, hp: 30000, attack: 1 } });
    expect(duel([me()], [low()], [0]).procs(S)).toContain("đi trước +%");
    expect(duel([me()], [dummy(34, { stats: FAST })], [0]).procs(S)).toContain("hãm tốc");
    // 2v2: đồng đội nhanh đánh mục tiêu xuống thấp, pet kết liễu như đi trước.
    const target = () =>
      pet(34, { skills: [30], stats: { speed: 9999, hp: 4000, defense: 1, attack: 1 } });
    const opener = pet(68, {
      skills: s("Hỏa diễm đao"),
      stats: { speed: 5000, attack: 2500, ...TANK },
    });
    const two = double([me(), opener], [target(), target()], rounds(1));
    expect(two.procs(S)).toContain("đi trước +%");
  });

  it("142 Sư Thứu: hạ gục thì lượt kế được ưu tiên", () => {
    const S = 142;
    const me = () => pet(S, { skills: s("Phong nhận"), stats: { speed: 500, ...TANK } });
    const frail = () => pet(34, { skills: [30], stats: { speed: 9999, hp: 1 } });
    const fastDummy = () => dummy(34, { stats: FAST });
    const one = duel([me()], [frail(), fastDummy()], [0, 0]);
    expect(one.procs(S)).toContain("hạ gục → ưu tiên");
    expect(one.procs(S)).toContain("ưu tiên");
    const two = double([me(), mate()], [frail(), fastDummy(), fastDummy()], rounds(2));
    expect(two.procs(S)).toContain("hạ gục → ưu tiên");
    expect(two.procs(S)).toContain("ưu tiên");
  });

  it("143 Dơi khổng lồ: hút máu, mục tiêu bị khống chế hút mạnh và +10%", () => {
    const S = 143;
    const me = () =>
      pet(S, {
        skills: s("Ảnh thứ", "Long Quyển Phong Tỏa"),
        stats: { ...FAST, ...TANK },
        hpPct: 50,
      });
    const one = duel([me()], [slowDummy()], [0, 1, 0]);
    expect(one.procs(S)).toContain("hút máu");
    expect(one.procs(S)).toContain("hút máu mạnh");
    expect(one.procs(S)).toContain("đánh mục tiêu bị khống chế");
    const two = double(
      [me(), mate()],
      [slowDummy(), slowDummy()],
      [...rounds(1, [1, 0]), ...rounds(1)],
    );
    expect(two.procs(S)).toContain("hút máu mạnh");
  });

  it("144 Răng nanh của dơi: hút máu theo khống chế", () => {
    const S = 144;
    const me = () =>
      pet(S, {
        skills: s("Ảnh thứ", "Long Quyển Phong Tỏa"),
        stats: { ...FAST, ...TANK },
        hpPct: 50,
      });
    const one = duel([me()], [slowDummy()], [0, 1, 0]);
    expect(one.procs(S)).toContain("hút máu");
    expect(one.procs(S)).toContain("đánh mục tiêu bị khống chế");
    const two = double(
      [me(), mate()],
      [slowDummy(), slowDummy()],
      [...rounds(1, [1, 0]), ...rounds(1)],
    );
    expect(two.procs(S)).toContain("hút máu mạnh");
  });

  it("145 Tần số của dơi: hút dư thành khiên cho đồng đội thấp máu nhất", () => {
    const S = 145;
    const me = () => pet(S, { skills: s("Ảnh thứ"), stats: { ...FAST, ...TANK } });
    const one = duel([me()], [slowDummy()], [0]);
    expect(one.procs(S)).toContain("hút dư thành khiên");
    const weak = pet(68, { skills: [30], hpPct: 30, stats: { ...SLOW, hp: 99999 } });
    const two = double([me(), weak], [slowDummy(), slowDummy()], rounds(1));
    const p = two.log.find((x) => x.speciesId === S && x.label === "hút dư thành khiên");
    expect(p?.targetSpecies).toBe(68);
  });

  it("146 Thiên Mã cánh bạc: ưu tiên chữa, xóa thêm hiệu ứng xấu, che 30%", () => {
    const S = 146;
    const me = () =>
      pet(S, { skills: s("Lam Tuyền Chữa Lành"), stats: { ...SLOW, ...TANK }, hpPct: 50 });
    const curser = () => pet(34, { skills: s("Chú oán"), stats: { speed: 9999, hp: 99999 } });
    const one = duel([me()], [curser()], [0, 0]);
    expect(one.procs(S)).toContain("ưu tiên chữa");
    expect(one.procs(S)).toContain("xóa thêm hiệu ứng xấu");
    expect(one.procs(S)).toContain("che chở");
    expect(one.procs(S)).toContain("che chở giảm");
    const hurt = pet(68, { skills: [30], hpPct: 50, stats: { ...SLOW, hp: 99999 } });
    const two = double([me(), hurt], [curser(), curser()], rounds(2, [0, 3], [0, 0]));
    const cover = two.log.find((x) => x.speciesId === S && x.label === "che chở");
    expect(cover?.targetSpecies).toBe(68);
  });

  it("147 Thiên Mã một sừng: xuyên Thạch Hóa, chiêu Thổ làm nhụt chí", () => {
    const S = 147;
    const me = () => pet(S, { skills: s("Bão cát"), stats: { speed: 500, ...TANK } });
    const one = duel([me()], [slowDummy()], [0, 0]);
    expect(one.procs(S)).toContain("nhụt chí");
    expect(one.procs(S)).toContain("xuyên thạch");
    // 2v2: đồng đội nhanh gây Thạch Hóa, pet đánh ngay sau trong cùng lượt.
    const stoner = pet(68, { skills: s("Bá Kim Trảm Địa"), stats: { ...FAST, ...TANK } });
    const two = double([me(), stoner], [slowDummy(), slowDummy()], rounds(1));
    expect(two.procs(S)).toContain("xuyên thạch");
    expect(two.procs(S)).toContain("phá giảm thạch hóa");
  });

  it("148 Thiên Mã Vương: có khiên thì hộ giá; Thánh Hộ · Thủ chia khiên", () => {
    const S = 148;
    const me = () => pet(S, { skills: s("Thiên Mã Thánh Hộ · Thủ"), stats: { ...FAST, ...TANK } });
    const one = duel([me()], [hitter()], [0, 0]);
    expect(one.procs(S)).toContain("khiên thánh hộ");
    expect(one.procs(S)).toContain("hộ giá (1v1)");
    const two = double([me(), mate()], [hitter(), hitter()], rounds(2, [0, 2]));
    const p = two.log.find((x) => x.speciesId === S && x.label === "khiên thánh hộ");
    expect(p?.targetSpecies).toBe(68);
    expect(two.procs(S)).toContain("hộ giá");
  });

  it("149 Mao Cầu Điểu: chiêu Phong làm mù, đối thủ dính hiệu ứng xấu đánh yếu hơn", () => {
    const S = 149;
    const me = () => pet(S, { skills: s("Phong nhận"), stats: { ...FAST, ...TANK } });
    const one = duel([me()], [hitter()], [0, 0]);
    expect(one.procs(S)).toContain("mù mắt");
    expect(one.procs(S)).toContain("phấn giảm sát thương");
    const two = double([me(), mate()], [hitter(), hitter()], rounds(2));
    expect(two.procs(S)).toContain("phấn giảm sát thương");
  });

  it("150 Phiêu Phù Mao Cầu: mục tiêu sạch bị chậm, có hiệu ứng xấu thì +%", () => {
    const S = 150;
    const me = () => pet(S, { skills: s("Phong nhận"), stats: { ...FAST, ...TANK } });
    const one = duel([me()], [slowDummy()], [0, 0]);
    expect(one.procs(S)).toContain("chậm chạp");
    expect(one.procs(S)).toContain("bạo phấn +%");
    const two = double([me(), mate()], [slowDummy(), slowDummy()], rounds(2));
    expect(two.procs(S)).toContain("bạo phấn +%");
  });

  it("151 Pháp Quan Mao Cầu: đánh trúng ru Ngủ, đánh mục tiêu bị khống chế +%, chiêu khống chế thì giảm sát thương", () => {
    const S = 151;
    const me = () =>
      pet(S, { skills: s("Phong nhận", "Long Quyển Phong Tỏa"), stats: { ...FAST, ...TANK } });
    // Vòng 1 ru Ngủ, vòng 2 Giam Cầm (chiêu khống chế: pet chịu ít hơn), vòng 3 đánh mục tiêu bị Giam Cầm.
    const one = duel([me()], [hitter()], [0, 1, 0]);
    expect(one.procs(S)).toContain("ru ngủ");
    expect(one.procs(S)).toContain("pháp quan thủ");
    expect(one.procs(S)).toContain("đánh kẻ bị khống chế");
    // Ru Ngủ 3 lượt 1 lần: 4 vòng đánh thường chỉ ru ở vòng 1 và vòng 4.
    const sleeps = duel([me()], [hitter()], [0, 0, 0, 0]).log.filter(
      (p) => p.speciesId === S && p.label === "ru ngủ",
    );
    expect(sleeps.map((p) => p.round)).toEqual([1, 4]);
    // Giấc ngủ là trạng thái thật: đối thủ đi sau mất lượt nên pet không mất máu ở vòng 1.
    const lull = duel([me()], [hitter()], [0]);
    expect(unitOf(lull, S).hp()).toBe(unitOf(lull, S).maxHp());
    // 2v2: pet Giam Cầm đối thủ ô 0, đồng đội đánh nó cũng được cộng.
    const two = double([me(), mate()], [hitter(), hitter()], rounds(1, [1, 0], [0, 0]));
    expect(two.procs(S)).toContain("đồng đội đánh kẻ bị khống chế");
    expect(double([me(), mate()], [hitter(), hitter()], rounds(1)).procs(S)).toContain("ru ngủ");
  });

  it("152 Hổ Thú: bị đánh tích nộ", () => {
    const S = 152;
    const me = () => pet(S, { skills: s("Nham Nha Phệ Cốt"), stats: { ...SLOW, ...TANK } });
    const one = duel([me()], [bruiser()], [0, 0]);
    expect(one.procs(S)).toContain("nộ");
    const two = double([me(), mate()], [bruiser(), bruiser()], rounds(1));
    expect(two.procs(S)).toContain("nộ");
  });

  it("153 Công phu hổ: từ 2 tầng nộ thì phản đòn", () => {
    const S = 153;
    const me = () => pet(S, { skills: [30], stats: { ...SLOW, ...TANK } });
    const one = duel([me()], [bruiser()], [0, 0, 0]);
    expect(one.procs(S)).toContain("hổ quyền phản");
    const two = double([me(), mate()], [bruiser(), bruiser()], rounds(4));
    expect(two.procs(S)).toContain("hổ quyền phản");
  });

  it("154 Hổ Dũng Sĩ: đòn nặng tích nộ, chiêu thường xả bớt, Tù Trường Liệt Quyền · Chiến xả hết và hồi máu", () => {
    const S = 154;
    const me = (hp = 9000) =>
      pet(S, {
        skills: s("Hỏa trảo", "Tù Trường Liệt Quyền · Chiến"),
        stats: { ...SLOW, hp, defense: 1 },
      });
    const heavy = () => pet(34, { skills: [30], stats: { speed: 9999, hp: 99999, attack: 1500 } });
    const one = duel([me()], [heavy()], [0, 0, 1]);
    expect(one.procs(S)).toContain("nộ");
    expect(one.procs(S)).toContain("xả bớt nộ");
    expect(one.procs(S)).toContain("xả nộ");
    expect(one.procs(S)).toContain("hồi nộ");
    // Đòn nhẹ (dưới 10% HP tối đa) không tích nộ.
    expect(duel([me(99999)], [bruiser()], [0, 0, 1]).procs(S)).not.toContain("nộ");
    const two = double([me(), mate()], [heavy(), heavy()], rounds(1, [1, 0]));
    expect(two.procs(S).filter((l) => l === "nộ").length).toBe(1);
    expect(two.procs(S)).toContain("xả nộ");
  });

  it("155 Hổ Tù Trường: vào sân có nộ; 2v2 đồng đội bị đánh cũng tích nộ", () => {
    const S = 155;
    const me = () => pet(S, { skills: [30], stats: { ...SLOW, ...TANK } });
    expect(duel([me()], [slowDummy()], [0]).procs(S)).toContain("nộ");
    const two = double([me(), mate()], [bruiser(), bruiser()], rounds(2));
    expect(two.procs(S)).toContain("trả thù cho bầy");
  });

  it("156 Ngựa núi: đi trước tích Đà, Đà tăng sát thương", () => {
    const S = 156;
    const me = () => pet(S, { skills: s("Diệp Toàn"), stats: { ...FAST, ...TANK } });
    const one = duel([me()], [slowDummy()], [0, 0]);
    expect(one.procs(S)).toContain("đà");
    expect(one.procs(S)).toContain("đà +%");
    const two = double([me(), mate()], [slowDummy(), slowDummy()], rounds(2));
    expect(two.procs(S)).toContain("đà +%");
  });

  it("157 Ngựa vằn: HP dưới 70% chiêu Mộc tiêu Đà để hút máu", () => {
    const S = 157;
    const me = () => pet(S, { skills: s("Diệp Toàn"), stats: { ...FAST, ...TANK }, hpPct: 50 });
    const one = duel([me()], [slowDummy()], [0, 0]);
    expect(one.procs(S)).toContain("đà +%");
    expect(one.procs(S)).toContain("tiêu đà hút máu");
    const two = double([me(), mate()], [slowDummy(), slowDummy()], rounds(2));
    expect(two.procs(S)).toContain("tiêu đà hút máu");
  });

  it("158 Ngựa lưỡi liềm: +30% lên mục tiêu có buff, gỡ buff thì tăng Sức mạnh", () => {
    const S = 158;
    const me = () => pet(S, { skills: s("Sóng điện từ"), stats: { ...SLOW, ...TANK } });
    const buffer = () => dummy(34, { skills: s("Thiên Hỏa tế"), stats: FAST });
    const one = duel([me()], [buffer()], [0]);
    expect(one.procs(S)).toContain("liềm +30%");
    expect(one.procs(S)).toContain("phá giáp tăng sức");
    expect(duel([me()], [slowDummy()], [0]).procs(S)).toContain("liềm +10%");
    const two = double([me(), mate()], [buffer(), buffer()], rounds(2));
    expect(two.procs(S)).toContain("phá giáp tăng sức");
  });

  it("159 Heo núi: đi sau +10%, tụt sâu thì nhận khiên lì đòn", () => {
    const S = 159;
    const me = () => pet(S, { skills: [30], stats: { ...SLOW, hp: 6000, defense: 1 } });
    const heavy = () => pet(34, { skills: [30], stats: { speed: 9999, hp: 99999, attack: 1500 } });
    const one = duel([me()], [heavy()], [0, 0, 0]);
    expect(one.procs(S)).toContain("đi sau +10%");
    expect(one.procs(S)).toContain("lì đòn");
    const two = double([me(), mate()], [heavy(), heavy()], rounds(2));
    expect(two.procs(S)).toContain("lì đòn");
  });
});

describe("kịch bản đặc tính phần 4: một mô tả duy nhất", () => {
  it("pet 120..159 chỉ có một mô tả, mọi số trong mô tả đều lấy từ params", () => {
    for (let id = 120; id <= 159; id++) {
      const script = PART_4[id];
      expect(script, `kịch bản ${id}`).toBeDefined();
      expect(script.text2v2, `text2v2 ${id}`).toBeUndefined();
      expect(script.text, `text ${id}`).not.toMatch(/1v1|2v2/i);
      expect(renderTraitText(id, script), `render ${id}`).not.toMatch(/[{}]/);
    }
  });
});
