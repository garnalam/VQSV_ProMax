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
import { PART_6 } from "./part6";

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
/** Đối thủ đánh trước, có đòn thật, rất trâu. */
const bruiser = () => pet(34, { skills: [30], stats: { speed: 9999, hp: 99999 } });
/** Đối thủ đánh sau, có đòn thật, rất trâu. */
const hitter = () => pet(34, { skills: [30], stats: { speed: 1, hp: 99999 } });
const slowDummy = (hpPct?: number) => dummy(34, { stats: SLOW, hpPct });
const fastDummy = () => dummy(34, { stats: FAST });
const buffer = () => dummy(34, { skills: s("Thiên Hỏa tế"), stats: FAST });
const s = (...names: string[]) => names.map((n) => skillId(n));
/** `n` vòng 2v2: pet ô 2 dùng lệnh `a`, pet ô 3 dùng lệnh `b`. */
const rounds = (
  n: number,
  a: [number, DoubleSlot] = [0, 0],
  b: [number, DoubleSlot] = [0, 0],
): [number, DoubleSlot][][] => Array.from({ length: n }, () => [a, b]);
/** Đồng đội trâu, đánh nhẹ, chậm. */
const mate = (id = 68, hpPct?: number) =>
  pet(id, { skills: [30], stats: { ...SLOW, ...TANK }, hpPct });

describe("kịch bản đặc tính phần 6: chạy trong 1v1 và 2v2", () => {
  it("200 Sa vương cuồng thực: tầng Cuồng thực, hút máu khi mục tiêu dưới 50%", () => {
    const S = 200;
    const me = () => pet(S, { skills: s("Hỏa trảo"), stats: { ...FAST, ...TANK }, hpPct: 50 });
    const one = duel([me()], [slowDummy(40)], [0, 0, 0]);
    expect(one.procs(S)).toContain("cuồng thực");
    expect(one.procs(S)).toContain("cuồng thực +%");
    expect(one.procs(S)).toContain("hút cuồng thực");
    const two = double([me(), mate()], [slowDummy(40), slowDummy(40)], rounds(3, [0, 0], [0, 1]));
    expect(two.procs(S)).toContain("cuồng thực +%");
    expect(two.procs(S)).toContain("hút cuồng thực");
  });

  it("201 Hải mộng tiên ca: hồi máu gây Mị Hoặc, cả đội hồi cuối lượt", () => {
    const S = 201;
    const me = () =>
      pet(S, { skills: s("Lam Tuyền Chữa Lành"), stats: { ...FAST, ...TANK }, hpPct: 40 });
    const one = duel([me()], [slowDummy()], [0, 0]);
    expect(one.procs(S)).toContain("tiên ca mị hoặc");
    expect(one.procs(S)).toContain("hồi tiên ca");
    expect(one.procs(S)).toContain("tiên ca hồi thêm");
    const two = double([me(), mate(68, 40)], [slowDummy(), slowDummy()], rounds(2, [0, 2], [0, 0]));
    const charms = two.log.filter((p) => p.speciesId === S && p.label === "tiên ca mị hoặc");
    expect(new Set(charms.map((p) => p.targetSide + ":" + p.targetSpecies)).size).toBe(1);
    expect(charms.length).toBe(2);
    expect(
      two.log.some((p) => p.speciesId === S && p.label === "hồi tiên ca" && p.targetSpecies === 68),
    ).toBe(true);
  });

  it.each([202, 203, 204])("%i: rút nhựa đối thủ bị trói cuối lượt", (S) => {
    const me = () => pet(S, { skills: s("Đằng Phược"), stats: { ...FAST, ...TANK }, hpPct: 50 });
    const one = duel([me()], [slowDummy()], [0, 0]);
    expect(one.procs(S)).toContain("rút nhựa");
    expect(one.procs(S)).toContain("hồi nhựa");
    const two = double([me(), mate(68, 50)], [slowDummy(), slowDummy()], rounds(2, [0, 0], [0, 0]));
    expect(two.procs(S)).toContain("rút nhựa");
    if (S === 204) expect(two.procs(S)).toContain("hồi chia đồng đội");
    else expect(two.procs(S)).toContain("hồi nhựa");
  });

  it("203 Kim diệp triền phược: chồng 2 hiệu ứng rút mạnh hơn", () => {
    const S = 203;
    const me = () =>
      pet(S, { skills: s("Đằng Phược", "Mạn Độc Triền Sinh"), stats: { ...FAST, ...TANK } });
    const one = duel([me()], [slowDummy()], [0, 1]);
    expect(one.procs(S).filter((l) => l === "rút nhựa").length).toBeGreaterThanOrEqual(2);
  });

  it("205 Gai non hộ thể: gai thường và gai cứng khi có Đằng chi bích lũy", () => {
    const S = 205;
    const me = () =>
      pet(S, { skills: s("Diệp Toàn", "Đằng chi bích lũy"), stats: { ...FAST, ...TANK } });
    const one = duel([me()], [hitter()], [0, 1]);
    expect(one.procs(S)).toContain("gai");
    expect(one.procs(S)).toContain("gai cứng");
    // AI 2v2 chọn mục tiêu theo khắc hệ: đồng đội loài 100 để đòn dồn vào pet.
    const two = double([mate(100), me()], [hitter(), hitter()], rounds(3));
    expect(two.procs(S)).toContain("gai");
  });

  it("206 Độc thứ hủ cầu: gai và Hủ Thực lên kẻ đánh", () => {
    const S = 206;
    const me = () => pet(S, { skills: [30], stats: { ...FAST, ...TANK } });
    const one = duel([me()], [hitter()], [0, 0]);
    expect(one.procs(S)).toContain("gai");
    expect(one.procs(S)).toContain("gai độc");
    const two = double([mate(), me()], [hitter(), hitter()], rounds(2));
    expect(two.procs(S)).toContain("gai độc");
  });

  it("207 Vạn thứ hộ lâm: 1v1 gai hồi máu, 2v2 gai đồng đội", () => {
    const S = 207;
    const me = () => pet(S, { skills: [30], stats: { ...FAST, ...TANK }, hpPct: 50 });
    const one = duel([me()], [hitter()], [0]);
    expect(one.procs(S)).toContain("gai");
    expect(one.procs(S)).toContain("gai hồi");
    const frail = () =>
      pet(68, { skills: [30], stats: { ...SLOW, hp: 99999, defense: 1 }, hpPct: 20 });
    const two = double([me(), frail()], [hitter(), hitter()], rounds(3));
    expect(two.procs(S)).toContain("gai đồng đội");
    expect(two.procs(S)).not.toContain("gai hồi");
  });

  it("208 Hạt vàng nảy mầm: tích Mầm, giảm sát thương, đủ 3 tầng hồi máu", () => {
    const S = 208;
    const me = () => pet(S, { skills: [30], stats: { ...FAST, ...TANK }, hpPct: 50 });
    const one = duel([me()], [hitter()], [0, 0, 0]);
    expect(one.procs(S)).toContain("mầm");
    expect(one.procs(S)).toContain("mầm giảm");
    expect(one.procs(S)).toContain("nảy mầm");
    const two = double([me(), mate()], [hitter(), hitter()], rounds(3));
    expect(two.procs(S)).toContain("nảy mầm");
  });

  it("202–208: giới hạn mỗi trận (rút nhựa, gai, nảy mầm) và chỉ rút 1 đối thủ mỗi lượt", () => {
    const count = (res: ScenarioResult, S: number, label: string) =>
      res.procs(S).filter((l) => l === label).length;
    const binder = (S: number) =>
      pet(S, { skills: s("Đằng Phược"), stats: { ...FAST, ...TANK }, hpPct: 50 });
    const long = [0, 0, 0, 0, 0, 0, 0, 0];
    expect(count(duel([binder(202)], [slowDummy()], long), 202, "rút nhựa")).toBe(3);
    expect(count(duel([binder(204)], [slowDummy()], long), 204, "rút nhựa")).toBe(2);
    const two = double(
      [binder(202), mate(68, 50)],
      [slowDummy(), slowDummy()],
      rounds(2, [0, 0], [0, 0]),
    );
    expect(perRound(two, 202, ["rút nhựa"]).every((n) => n === 1)).toBe(true);

    const thorny = (S: number) => pet(S, { skills: [30], stats: { ...FAST, ...TANK }, hpPct: 40 });
    expect(count(duel([thorny(205)], [hitter()], long), 205, "gai")).toBe(4);
    const g207 = duel([thorny(207)], [hitter()], long);
    expect(count(g207, 207, "gai")).toBe(3);
    expect(perRound(g207, 207, ["gai"]).length).toBe(3);
    expect(count(duel([thorny(208)], [hitter()], long), 208, "nảy mầm")).toBe(1);
  });

  it("209 Kim tâm kết quả: tầng DEF cuối lượt, Lôi Thiết Bạo Vũ hồi máu", () => {
    const S = 209;
    const me = () =>
      pet(S, { skills: s("Hất bụi", "Lôi Thiết Bạo Vũ"), stats: { ...FAST, ...TANK }, hpPct: 50 });
    const one = duel([me()], [slowDummy()], [0, 0, 1]);
    expect(one.procs(S)).toContain("kết quả giáp");
    expect(one.procs(S)).toContain("giáp hồi máu");
    const two = double(
      [me(), mate()],
      [slowDummy(), slowDummy()],
      [...rounds(2), ...rounds(1, [1, 0], [0, 0])],
    );
    expect(two.procs(S)).toContain("giáp hồi máu");
  });

  it("210 Rễ Kim Tâm: đi sau +15%, hồi máu khi mục tiêu Hủ Thực; 2v2 hồi đồng đội yếu hơn", () => {
    const S = 210;
    const me = () =>
      pet(S, { skills: s("Hoàng Kim Mộc Chấn · Thực"), stats: { ...SLOW, ...TANK }, hpPct: 50 });
    const one = duel([me()], [fastDummy()], [0, 0]);
    expect(one.procs(S)).toContain("đi sau +%");
    expect(one.procs(S)).toContain("rễ hồi máu");
    const two = double([me(), mate(68, 20)], [fastDummy(), fastDummy()], rounds(2));
    const heals = two.log.filter((p) => p.speciesId === S && p.label === "rễ hồi máu");
    expect(heals.some((p) => p.targetSpecies === 68)).toBe(true);
  });

  it("211 Kim Tâm Bất Hoại: tư thế trên 60%, vỡ tâm, đồng đội +15%", () => {
    const S = 211;
    const whole = duel(
      [pet(S, { skills: s("Hất bụi", "Thiên Hỏa tế"), stats: { ...SLOW, ...TANK } })],
      [bruiser()],
      [1],
    );
    expect(whole.procs(S)).toContain("kim tâm");
    expect(whole.procs(S)).toContain("kim tâm hồi");
    const me = () =>
      pet(S, { skills: s("Hất bụi"), stats: { ...SLOW, hp: 30000, defense: 1 }, hpPct: 60.2 });
    const one = duel([me()], [bruiser()], [0, 0]);
    expect(one.procs(S)).toContain("kim tâm vỡ");
    expect(one.procs(S)).toContain("vỡ tâm +%");
    expect(one.procs(S)).toContain("vỡ tâm hút máu");
    const two = double([mate(), me()], [bruiser(), bruiser()], rounds(3));
    expect(two.procs(S)).toContain("kim tâm vỡ");
    expect(two.procs(S)).toContain("vỡ tâm đồng đội");
  });

  it("212 Phấn Cười Mê Hồn: Hủ Thực mới gây Phấn Cười, tick hồi máu (2v2 chia đồng đội)", () => {
    const S = 212;
    const me = () =>
      pet(S, { skills: s("Mạn Độc Triền Sinh"), stats: { ...FAST, ...TANK }, hpPct: 50 });
    const one = duel([me()], [slowDummy()], [0, 0]);
    expect(one.procs(S)).toContain("phấn cười");
    expect(one.procs(S)).toContain("hủ hồi máu");
    const two = double([me(), mate(68, 50)], [slowDummy(), slowDummy()], rounds(2, [0, 0], [0, 0]));
    const ticks = two.log.filter((p) => p.speciesId === S && p.label === "hủ hồi máu");
    expect(ticks.some((p) => p.targetSpecies === 68)).toBe(true);
  });

  it("213 Huyết Bào Lan Tỏa: +15% lên mục tiêu Hủ Thực, kích nổ thì bào tử lan", () => {
    const S = 213;
    const me = () =>
      pet(S, {
        skills: s("Mạn Độc Triền Sinh", "Bạo Chủng Liên Thứ"),
        stats: { ...FAST, ...TANK },
        hpPct: 50,
      });
    const one = duel([me()], [slowDummy()], [0, 1]);
    expect(one.procs(S)).toContain("phấn cười");
    expect(one.procs(S)).toContain("phấn cười +%");
    expect(one.procs(S)).toContain("bào tử lan");
    const two = double(
      [me(), mate()],
      [slowDummy(), slowDummy()],
      [...rounds(1, [0, 0], [0, 0]), ...rounds(1, [1, 0], [0, 0])],
    );
    const spread = two.log.filter((p) => p.speciesId === S && p.label === "bào tử lan");
    expect(spread.some((p) => p.targetSide === 1)).toBe(true);
  });

  it.each([214, 215, 216])("%i: cuộn thân khi bị đánh, lượt sau ra đòn trước", (S) => {
    const me = () => pet(S, { skills: s("Điện giật"), stats: { ...SLOW, ...TANK } });
    const one = duel([me()], [bruiser()], [0, 0]);
    expect(one.procs(S)).toContain("cuộn thân");
    expect(one.procs(S)).toContain("ra đòn trước");
    if (S >= 215) expect(one.procs(S)).toContain("bật nanh +%");
    if (S === 216) expect(one.procs(S)).toContain("bật nanh tê liệt");
    const two = double([mate(), me()], [bruiser(), bruiser()], rounds(2));
    expect(two.procs(S)).toContain("cuộn thân");
    expect(two.procs(S)).toContain("ra đòn trước");
  });

  it("217 Móc Câu Thủy Thủ: gắn Móc, +12%, giảm sát thương nhận; đồng đội cũng +12%", () => {
    const S = 217;
    const me = () => pet(S, { skills: s("Bong bóng"), stats: { ...FAST, ...TANK } });
    const one = duel([me()], [hitter()], [0, 0]);
    expect(one.procs(S)).toContain("móc câu");
    expect(one.procs(S)).toContain("móc +%");
    expect(one.procs(S)).toContain("móc giảm");
    const two = double([me(), mate()], [hitter(), hitter()], rounds(2, [0, 0], [0, 0]));
    expect(two.procs(S)).toContain("móc đồng đội +%");
  });

  it("218 Hắc Triều Cướp Buồm: gỡ buff mục tiêu mang Móc thì nhận khiên", () => {
    const S = 218;
    const me = () => pet(S, { skills: s("Hải Vương Đoạt Câu · Phá"), stats: { ...SLOW, ...TANK } });
    const one = duel([me()], [buffer()], [0, 0]);
    expect(one.procs(S)).toContain("móc câu");
    expect(one.procs(S)).toContain("khiên cướp buồm");
    const two = double([me(), mate()], [buffer(), buffer()], rounds(2, [0, 1], [0, 1]));
    expect(two.procs(S)).toContain("khiên cướp buồm");
    expect(two.procs(S)).toContain("móc đồng đội +%");
  });

  it("219 Hải Vương Thu Lưới: mục tiêu mang Móc dưới 35% thì thu lưới", () => {
    const S = 219;
    const me = () => pet(S, { skills: s("Bong bóng"), stats: { ...FAST, ...TANK }, hpPct: 50 });
    const one = duel([me()], [slowDummy(34)], [0, 0]);
    expect(one.procs(S)).toContain("móc câu");
    expect(one.procs(S)).toContain("thu lưới");
    const two = double([me(), mate()], [slowDummy(34), slowDummy(34)], rounds(3, [0, 0], [0, 1]));
    const hauls = two.log.filter((p) => p.speciesId === S && p.label === "thu lưới");
    expect(hauls.length).toBe(1);
  });

  it.each([220, 221])("%i: vào sân nạp giáp, bị đánh nạp tầng, mỗi tầng cộng sát thương", (S) => {
    const me = () => pet(S, { skills: s("Hất bụi"), stats: { ...SLOW, ...TANK } });
    const one = duel([me()], [bruiser()], [0, 0]);
    expect(one.procs(S)).toContain("nạp giáp");
    expect(one.procs(S)).toContain("pháo tầng +%");
    expect(one.procs(S).filter((l) => l === "nạp tầng").length).toBe(2);
    expect(defenseTiers(unitOf(one, S))).toBe(3);
    const two = double([me(), mate()], [bruiser(), bruiser()], rounds(1));
    expect(two.procs(S)).toContain("nạp giáp");
    expect(two.procs(S)).toContain("pháo tầng +%");
    for (const n of perRound(two, S, ["nạp tầng"])) expect(n).toBe(1);
  });

  it("221 Kim Đảm Đại Pháo: đủ 3 tầng DEF thì xuyên giáp và giữ tầng", () => {
    const S = 221;
    const me = () =>
      pet(S, { skills: s("Thổ thuẫn", "Lôi Thiết Bạo Vũ"), stats: { ...FAST, ...TANK } });
    const one = duel([me()], [slowDummy()], [0, 0, 0]);
    expect(one.procs(S)).toContain("xuyên giáp");
    // Lôi Thiết Bạo Vũ tiêu tầng; bắn với đủ 3 tầng thì các tầng được giữ lại.
    const keep = duel([me()], [slowDummy()], [0, 0, 1]);
    expect(keep.procs(S)).toContain("xuyên giáp");
    expect(keep.procs(S)).toContain("giữ tầng");
    expect(defenseTiers(unitOf(keep, S))).toBe(3);
    const two = double([me(), mate()], [slowDummy(), slowDummy()], rounds(3));
    expect(two.procs(S)).toContain("xuyên giáp");
  });

  it("222 Lôi Dực Phá Xác: đi trước +15%, Lôi Đà giảm sát thương", () => {
    const S = 222;
    const me = () => pet(S, { skills: s("Điện giật"), stats: { ...FAST, ...TANK } });
    const one = duel([me()], [hitter()], [0, 0]);
    expect(one.procs(S)).toContain("đi trước +%");
    expect(one.procs(S)).toContain("lôi đà");
    expect(one.procs(S)).toContain("lôi đà giảm");
    const two = double([me(), mate()], [hitter(), hitter()], rounds(2));
    expect(two.procs(S)).toContain("lôi đà giảm");
  });

  it("223 Tật Điện Truy Phong: Lôi Đà cộng sát thương, chiêu Phong tích đà dù đi sau", () => {
    const S = 223;
    const me = () => pet(S, { skills: s("Điện giật"), stats: { ...FAST, ...TANK } });
    const one = duel([me()], [slowDummy()], [0, 0]);
    expect(one.procs(S)).toContain("lôi đà");
    expect(one.procs(S)).toContain("lôi đà +%");
    const wind = pet(S, { skills: s("Tật Phong Trụy Không"), stats: { ...SLOW, ...TANK } });
    expect(duel([wind], [fastDummy()], [0]).procs(S)).toContain("lôi đà");
    const two = double([me(), mate()], [slowDummy(), slowDummy()], rounds(2));
    expect(two.procs(S)).toContain("lôi đà +%");
  });

  it("224 Long Kỵ Xung Lôi: · Bạo xả hết Lôi Đà", () => {
    const S = 224;
    const me = () =>
      pet(S, { skills: s("Điện giật", "Thiên Lôi Long Phán · Bạo"), stats: { ...FAST, ...TANK } });
    const one = duel([me()], [slowDummy()], [0, 0, 1]);
    expect(one.procs(S)).toContain("lôi đà +%");
    expect(one.procs(S)).toContain("xả lôi đà");
    const two = double(
      [me(), mate()],
      [slowDummy(), slowDummy()],
      [...rounds(2), ...rounds(1, [1, 0], [0, 0])],
    );
    expect(two.procs(S)).toContain("xả lôi đà");
  });

  it("225 Thiên Lôi Long Uy: · Bạo với 3 Lôi Đà gây sét lan; 2v2 lan sang đối thủ còn lại", () => {
    const S = 225;
    const me = () =>
      pet(S, { skills: s("Điện giật", "Thiên Lôi Long Phán · Bạo"), stats: { ...FAST, ...TANK } });
    const one = duel([me()], [slowDummy()], [0, 0, 1]);
    expect(one.procs(S)).toContain("sét lan");
    expect(one.procs(S)).toContain("sét lan tê liệt");
    expect(one.procs(S)).not.toContain("sét lan phụ");
    const two = double(
      [me(), mate()],
      [slowDummy(), slowDummy()],
      [...rounds(2), ...rounds(1, [1, 0], [0, 0])],
    );
    const splash = two.log.filter((p) => p.speciesId === S && p.label === "sét lan phụ");
    expect(splash.length).toBe(1);
  });

  it("226 Hồng Phấn Mê Lộ: rắc Phấn (2v2 cả hai), nhanh hơn thì chịu ít hơn", () => {
    const S = 226;
    const me = () => pet(S, { skills: s("Phong nhận"), stats: { ...FAST, ...TANK } });
    const one = duel([me()], [hitter()], [0]);
    expect(one.procs(S)).toContain("rắc phấn");
    expect(one.procs(S)).toContain("nhanh hơn giảm");
    const two = double([me(), mate()], [hitter(), hitter()], rounds(1));
    expect(two.procs(S).filter((l) => l === "rắc phấn").length).toBe(2);
  });

  it("227 Dạ Phấn Ru Mộng: +18% lên mục tiêu Quấn Quanh, đồng đội +8%", () => {
    const S = 227;
    const me = () => pet(S, { skills: s("Đằng Phược"), stats: { ...FAST, ...TANK } });
    const one = duel([me()], [slowDummy()], [0, 0]);
    expect(one.procs(S)).toContain("rắc phấn");
    expect(one.procs(S)).toContain("ru mộng +%");
    const two = double([me(), mate()], [slowDummy(), slowDummy()], rounds(2));
    expect(two.procs(S)).toContain("ru mộng đồng đội +%");
    expect(two.procs(S).filter((l) => l === "rắc phấn").length).toBeLessThanOrEqual(2);
  });

  it("228 Điệp Hậu Mộng Cảnh: đòn đầu lên mục tiêu Ngủ không đánh thức, +25%", () => {
    const S = 228;
    // 1v1: Ngủ mất ở hành động kế tiếp của mục tiêu, pet không kịp đánh nó trong lúc ngủ; chỉ kiểm Phấn.
    const solo = pet(S, { skills: s("Phong nhận"), stats: { ...FAST, ...TANK } });
    expect(duel([solo], [slowDummy()], [0]).procs(S)).toContain("rắc phấn");
    // 2v2: đồng đội nhanh nhất ru ngủ đối thủ ô 0, pet đánh ngay sau đó.
    const me = () => pet(S, { skills: s("Phong nhận"), stats: { speed: 5000, ...TANK } });
    const singer = () => pet(68, { skills: s("Miên Ca Lam Mộng"), stats: { ...FAST, ...TANK } });
    const two = double([me(), singer()], [slowDummy(), slowDummy()], rounds(1, [0, 0], [0, 0]));
    expect(two.procs(S)).toContain("ru ngủ +%");
    expect(two.procs(S)).toContain("giữ giấc");
    expect(two.procs(S).filter((l) => l === "rắc phấn").length).toBe(2);
  });

  it("229 Hắc Dực Đứt Mạch: Lôi gây Đứt Mạch, buff xong thì ra đòn trước", () => {
    const S = 229;
    const me = () =>
      pet(S, { skills: s("Điện giật", "Điện năng chuyển đổi"), stats: { ...SLOW, ...TANK } });
    const one = duel([me()], [fastDummy()], [1, 0]);
    expect(one.procs(S)).toContain("nạp đi trước");
    expect(one.procs(S)).toContain("ra đòn trước");
    expect(one.procs(S)).toContain("đứt mạch");
    const two = double(
      [me(), mate()],
      [fastDummy(), fastDummy()],
      [...rounds(1, [1, 2], [0, 0]), ...rounds(1, [0, 0], [0, 0])],
    );
    expect(two.procs(S)).toContain("ra đòn trước");
    expect(two.procs(S)).toContain("đứt mạch");
  });

  it("230 Bạch Dực Hộ Mạch: chiêu phòng thủ che khiên cho đồng đội (1v1: chính pet)", () => {
    const S = 230;
    const me = () => pet(S, { skills: s("Điện giật", "Thủy bích"), stats: { ...FAST, ...TANK } });
    const one = duel([me()], [slowDummy()], [0, 1]);
    expect(one.procs(S)).toContain("đứt mạch");
    const guard = one.log.find((p) => p.speciesId === S && p.label === "hộ mạch");
    expect(guard?.targetSpecies).toBe(S);
    const two = double([me(), mate()], [slowDummy(), slowDummy()], rounds(1, [1, 2], [0, 0]));
    const allyGuard = two.log.find((p) => p.speciesId === S && p.label === "hộ mạch");
    expect(allyGuard?.targetSpecies).toBe(68);
  });

  it("231 Kim Dực Đoạt Mạch: gỡ buff thì hồi máu và đòn sau +20%", () => {
    const S = 231;
    const me = () =>
      pet(S, { skills: s("Kim Dực Phá Mạch · Phá"), stats: { ...SLOW, ...TANK }, hpPct: 50 });
    const one = duel([me()], [buffer()], [0, 0]);
    expect(one.procs(S)).toContain("đứt mạch");
    expect(one.procs(S)).toContain("đoạt mạch");
    expect(one.procs(S)).toContain("đoạt mạch +%");
    const two = double([me(), mate()], [buffer(), buffer()], rounds(2, [0, 1], [0, 1]));
    expect(two.procs(S)).toContain("đoạt mạch +%");
  });

  it.each([232, 233, 234, 235])("%i: chiêu Phong mạnh hơn theo chênh lệch Linh xảo", (S) => {
    const me = () => pet(S, { skills: s("Phong nhận"), stats: { ...FAST, ...TANK } });
    const one = duel([me()], [slowDummy()], [0]);
    expect(one.procs(S)).toContain("gió +%");
    const two = double([me(), mate()], [slowDummy(), slowDummy()], rounds(1));
    expect(two.procs(S)).toContain("gió +%");
  });

  it("232 Liệt Phong Sải Cánh: chiêu làm chậm giảm thêm Linh xảo", () => {
    const S = 232;
    const me = () => pet(S, { skills: s("Phong áp"), stats: { ...FAST, ...TANK } });
    expect(duel([me()], [slowDummy()], [0]).procs(S)).toContain("làm chậm thêm");
    const two = double([me(), mate()], [slowDummy(), slowDummy()], rounds(1));
    expect(two.procs(S)).toContain("làm chậm thêm");
  });

  it("233 Điêu Vương Truy Sát: mục tiêu dưới 35% thì ra đòn trước", () => {
    const S = 233;
    const me = () => pet(S, { skills: s("Phong nhận"), stats: { ...SLOW, ...TANK } });
    const prey = () => dummy(34, { stats: FAST, hpPct: 30 });
    expect(duel([me()], [prey()], [0]).procs(S)).toContain("truy sát đi trước");
    const two = double([me(), mate()], [prey(), fastDummy()], rounds(1));
    expect(two.procs(S)).toContain("truy sát đi trước");
  });

  it("234 Phong Sư Áp Trận: đối thủ chậm hơn gây ít hơn; 2v2 che cả đồng đội", () => {
    const S = 234;
    const me = () => pet(S, { skills: s("Phong nhận"), stats: { ...FAST, ...TANK } });
    expect(duel([me()], [hitter()], [0]).procs(S)).toContain("áp trận giảm");
    const frail = () =>
      pet(68, { skills: [30], stats: { ...SLOW, hp: 99999, defense: 1 }, hpPct: 20 });
    const two = double([me(), frail()], [hitter(), hitter()], rounds(3));
    expect(two.procs(S)).toContain("hào quang gió");
  });

  it("235 Thiên Vũ Cuồng Phong: HP trên 60% thì đòn trúng cuốn gió", () => {
    const S = 235;
    const me = () => pet(S, { skills: s("Phong nhận"), stats: { ...FAST, ...TANK } });
    expect(duel([me()], [slowDummy()], [0]).procs(S)).toContain("cuốn gió");
    const low = pet(S, { skills: s("Phong nhận"), stats: { ...FAST, ...TANK }, hpPct: 50 });
    expect(duel([low], [slowDummy()], [0]).procs(S)).not.toContain("cuốn gió");
    const two = double([me(), mate()], [slowDummy(), slowDummy()], rounds(1));
    expect(two.procs(S)).toContain("cuốn gió");
  });

  const heavy = () => pet(34, { skills: [30], stats: { speed: 9999, hp: 99999, attack: 3000 } });

  it("236 Ve Sầu Thoát Xác: dưới 50% HP thì bỏ xác; đòn hạ gục lúc đầy HP thì trụ 1 HP", () => {
    const S = 236;
    const me = (hpPct?: number, hp = 300) =>
      pet(S, { skills: s("Điện giật"), stats: { ...SLOW, hp, defense: 1 }, hpPct });
    // Đòn hạ gục lúc đầy HP: trụ 1 HP, bỏ xác (khiên + Linh xảo), chiêu Lôi kế tiếp được cộng.
    const one = duel([me()], [heavy()], [0]);
    expect(one.procs(S)).toEqual(expect.arrayContaining(["trụ 1 HP", "thoát xác", "xác lôi +%"]));
    expect(unitOf(one, S).hp()).toBe(1);
    // Không hạ gục: tụt xuống dưới 50% vẫn bỏ xác, không ép HP.
    const tough = duel([me(55, 20000)], [heavy()], [0]);
    expect(tough.procs(S)).toContain("thoát xác");
    expect(tough.procs(S)).not.toContain("trụ 1 HP");
    expect(unitOf(tough, S).hp()).toBeGreaterThan(1);
    // Không đầy HP thì đòn hạ gục vẫn hạ gục.
    expect(duel([me(90)], [heavy()], [0]).procs(S)).not.toContain("trụ 1 HP");
    const two = double([me(), mate()], [heavy(), heavy()], rounds(1));
    expect(two.procs(S)).toContain("thoát xác");
  });

  it("237 Lục Dực Tân Sinh: dưới 40% mọc cánh (hồi, Lôi +%, ra đòn trước); đòn hạ gục trên 70% trụ 1 HP", () => {
    const S = 237;
    const me = (hpPct = 80, hp = 300) =>
      pet(S, { skills: s("Điện giật"), stats: { ...SLOW, hp, defense: 1 }, hpPct });
    const one = duel([me()], [heavy()], [0, 0]);
    expect(one.procs(S)).toEqual(
      expect.arrayContaining(["trụ 1 HP", "mọc cánh", "ra đòn trước", "cánh lôi +%"]),
    );
    // Trụ 1 HP rồi hồi 20% HP tối đa.
    const r1 = duel([me()], [heavy()], [0]);
    const u = unitOf(r1, S);
    expect(u.hp()).toBe(1 + Math.trunc(u.maxHp() / 5));
    // Không hạ gục: tụt dưới 40% vẫn mọc cánh, không ép HP; mỗi trận chỉ một lần.
    const tough = duel([me(45, 20000)], [heavy()], [0, 0]);
    expect(tough.procs(S).filter((l) => l === "mọc cánh").length).toBe(1);
    expect(tough.procs(S)).not.toContain("trụ 1 HP");
    const two = double([me(), mate()], [heavy(), heavy()], rounds(1));
    expect(two.procs(S)).toContain("mọc cánh");
  });

  it("238 Triều Dâng Lam Hải: Triều Lên +15%, Triều Rút giảm và hồi; 2v2 cùng họ", () => {
    const S = 238;
    const me = () => pet(S, { skills: s("Bong bóng"), stats: { ...FAST, ...TANK }, hpPct: 50 });
    const one = duel([me()], [hitter()], [0, 0]);
    expect(one.procs(S)).toContain("triều lên +%");
    expect(one.procs(S)).toContain("triều rút giảm");
    expect(one.procs(S)).toContain("triều rút hồi");
    const kin = () => pet(239, { skills: s("Bong bóng"), stats: { ...SLOW, ...TANK }, hpPct: 40 });
    const two = double([me(), kin()], [hitter(), hitter()], rounds(2));
    expect(two.procs(S)).toContain("triều cùng họ +%");
    expect(two.procs(S)).toContain("triều cùng họ giảm");
  });

  it("239 Nguyệt Triều Chiến Ý: chiêu hồi máu đảo pha (cả đồng đội cùng họ)", () => {
    const S = 239;
    const me = () =>
      pet(S, {
        skills: s("Bong bóng", "Thủy Linh Hồi Sinh"),
        stats: { ...FAST, ...TANK },
        hpPct: 50,
      });
    const one = duel([me()], [hitter()], [0, 1, 0]);
    expect(one.procs(S)).toContain("triều lên +%");
    expect(one.procs(S)).toContain("đảo triều");
    // Vòng 2 bị đảo thành Triều Lên, vòng 3 thành Triều Rút: Bong bóng vòng 3 không +%.
    const ups = one.log.filter((p) => p.speciesId === S && p.label === "triều lên +%");
    expect(ups.map((p) => p.round)).toEqual([1]);
    const kin = () => pet(238, { skills: s("Bong bóng"), stats: { ...SLOW, ...TANK } });
    const two = double([me(), kin()], [hitter(), hitter()], rounds(1, [1, 3], [0, 0]));
    expect(two.procs(S)).toContain("đảo triều đồng đội");
  });
});

describe("kịch bản đặc tính phần 6: một mô tả duy nhất", () => {
  it("pet 200..239 chỉ có một mô tả, mọi số trong mô tả đều lấy từ params", () => {
    for (let id = 200; id <= 239; id++) {
      const script = PART_6[id];
      expect(script, `kịch bản ${id}`).toBeDefined();
      expect(script.text2v2, `text2v2 ${id}`).toBeUndefined();
      expect(script.text, `text ${id}`).not.toMatch(/1v1|2v2/i);
      expect(renderTraitText(id, script), `render ${id}`).not.toMatch(/[{}]/);
    }
  });
});
