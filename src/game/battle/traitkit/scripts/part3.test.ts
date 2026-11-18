import { describe, expect, it, vi } from "vitest";
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

// Chỉ nạp kịch bản phần 3: các phần khác đang được viết song song (có thể chưa biên dịch được) và
// đặc tính của pet phụ trong tình huống (34, đồng đội) không được làm nhiễu điều kiện kích hoạt.
vi.mock("./index", async () => {
  const { PART_3 } = await import("./part3");
  return {
    TRAIT_SCRIPTS: new Map(Object.entries(PART_3).map(([id, script]) => [Number(id), script])),
  };
});

const { duel, double, pet, dummy, skillId } = await import("../TraitScenario.testutil");
const { PART_3 } = await import("./part3");
type DoubleSlot = import("../TraitScenario.testutil").DoubleSlot;
type Setup = ReturnType<typeof pet>;

const SLOW = { speed: 1 };
const FAST = { speed: 9999 };
const TANK = { hp: 99999 };
const HT = () => skillId("Hỏa trảo");
/** Đối thủ đánh đau, rất trâu; mặc định đánh trước. */
const bruiser = (speed = 9999, skills = [30]) => pet(34, { skills, stats: { speed, hp: 99999 } });
/** Đối thủ không gây sát thương: chỉ dùng chiêu hỗ trợ lên chính nó. */
const idle = (options: { hpPct?: number } = {}) =>
  pet(34, { skills: [34], hpPct: options.hpPct, stats: { speed: 1, hp: 99999 } });
const slowDummy = (hpPct?: number) => dummy(34, { hpPct, stats: SLOW });
const fastDummy = (hpPct?: number) => dummy(34, { hpPct, stats: FAST });
/** Đồng đội phụ trong 2v2 (đặc tính 90 vô hại với các tình huống khác). */
const mate = (options: { skills?: number[]; hpPct?: number; stats?: object } = {}, species = 90) =>
  pet(species, {
    skills: options.skills ?? [HT()],
    hpPct: options.hpPct,
    stats: { ...SLOW, ...TANK, ...options.stats },
  });
/** `n` vòng 2v2 với cùng lệnh [ô chiêu, ô mục tiêu] cho pet ô 2 và ô 3. */
const rounds = (
  a: [number, DoubleSlot],
  b: [number, DoubleSlot],
  n = 3,
): [number, DoubleSlot][][] => Array.from({ length: n }, () => [a, b]);
/** 1v1: pet đang trên sân của phe `side`, để kiểm hiệu ứng thật. */
const live1 = (r: { core: unknown }, side: "player" | "enemy" = "player") =>
  (
    r.core as {
      activeUnit(s: string): {
        hp(): number;
        maxHp(): number;
        shieldHp(): number;
        activeDebuffCount(): number;
        currentStats: { defense: number };
        baseStats: { defense: number };
        statuses: { has(bank: number, id: number): boolean };
      };
    }
  ).activeUnit(side);
/** Loài bị tác động của từng lần kích hoạt `label`. */
const procOn = (
  r: { log: { speciesId: number; label: string; targetSpecies?: number }[] },
  S: number,
  label: string,
) => r.log.filter((p) => p.speciesId === S && p.label === label).map((p) => p.targetSpecies);
const vs2 = (player: Setup[], enemy: Setup[], plan: [number, DoubleSlot][][]) =>
  double(player, enemy, plan);

describe("kịch bản đặc tính phần 3: chạy trong 1v1 và 2v2", () => {
  it("80 Độc nhãn quái: Mắt Ác giảm sát thương, ra đòn sau thì +25%; 2v2 che đồng đội", () => {
    const S = 80;
    const me = () => pet(S, { skills: [HT()], stats: { ...SLOW, ...TANK } });
    const one = duel([me()], [bruiser()], [0, 0]);
    expect(one.procs(S)).toContain("mắt ác");
    expect(one.procs(S)).toContain("mắt ác giảm");
    expect(one.procs(S)).toContain("hậu phán");
    const two = vs2([me(), mate()], [bruiser(), bruiser()], rounds([0, 0], [0, 0], 4));
    expect(two.procs(S)).toContain("mắt ác");
    expect(two.procs(S)).toContain("hậu phán");
    expect(two.procs(S)).toContain("mắt ác che đồng đội");
  });

  it("81 Độc nhãn cự thần: Mắt Phán Quyết giảm 25% và phạt 6%; 2v2 che đồng đội", () => {
    const S = 81;
    const me = () => pet(S, { skills: [HT()], stats: { ...FAST, ...TANK } });
    const one = duel([me()], [bruiser(1)], [0, 0]);
    expect(one.procs(S)).toContain("mắt phán quyết");
    expect(one.procs(S)).toContain("phán quyết giảm");
    expect(one.procs(S)).toContain("phạt");
    const two = vs2(
      [me(), mate({ hpPct: 20 })],
      [bruiser(1), bruiser(1)],
      rounds([0, 0], [0, 0], 6),
    );
    expect(two.procs(S)).toContain("mắt phán quyết");
    expect(two.procs(S)).toContain("phạt");
    expect(two.procs(S)).toContain("phán quyết che đồng đội");
  });

  it("82 Túi quỷ: đòn đầu Giam Cầm, rồi +20% và hút máu; 2v2 đồng đội +10%", () => {
    const S = 82;
    const me = () => pet(S, { skills: [HT()], hpPct: 50, stats: FAST });
    const one = duel([me()], [slowDummy()], [0, 0]);
    expect(one.procs(S)).toContain("giam cầm");
    expect(one.procs(S)).toContain("giam cầm +sát thương");
    expect(one.procs(S)).toContain("hút giam cầm");
    const two = vs2([me(), mate()], [slowDummy(), slowDummy()], rounds([0, 0], [0, 0], 2));
    expect(two.procs(S)).toContain("giam cầm");
    expect(two.procs(S)).toContain("đồng đội +sát thương");
  });

  it("83 Thi Đại Quỷ: đánh mục tiêu Giam Cầm +20%; dưới 35% thì hoán mệnh", () => {
    const S = 83;
    const binder = () =>
      pet(S, { skills: [skillId("Quỷ Đại Hoán Mệnh · Tỏa"), HT()], stats: { ...FAST, ...TANK } });
    expect(duel([binder()], [slowDummy()], [0, 1]).procs(S)).toContain("giam cầm +sát thương");
    const low = () => pet(S, { skills: [HT()], hpPct: 45, stats: SLOW });
    const one = duel([low()], [bruiser()], [0]);
    expect(one.procs(S)).toContain("hoán mệnh");
    const two = vs2([low(), mate()], [bruiser(), bruiser()], rounds([0, 0], [0, 0], 2));
    expect(two.procs(S)).toContain("hoán mệnh");
    const swap = two.log.find((p) => p.speciesId === S && p.label === "hoán mệnh");
    expect(swap?.targetSide).toBe(1);
  });

  it("84 Kính ma: gương tích sát thương rồi xả; 2v2 đòn trúng đồng đội cũng nạp", () => {
    const S = 84;
    const me = () => pet(S, { skills: [HT()], stats: { ...SLOW, ...TANK } });
    const one = duel([me()], [bruiser()], [0, 0]);
    expect(one.procs(S)).toContain("nạp gương");
    expect(one.procs(S)).toContain("xả gương");
    const two = vs2([me(), mate()], [bruiser(), bruiser()], rounds([0, 0], [0, 0], 4));
    expect(two.procs(S)).toContain("nạp gương đồng đội");
    expect(two.procs(S)).toContain("xả gương");
  });

  it("85 Phá kính tà linh: phản 30% đòn lớn; dưới 60% gương vỡ, xuyên giáp", () => {
    const S = 85;
    const me = () => pet(S, { skills: [HT()], hpPct: 70, stats: SLOW });
    const one = duel([me()], [bruiser()], [0, 0]);
    expect(one.procs(S)).toContain("phản đòn");
    expect(one.procs(S)).toContain("gương vỡ");
    expect(one.procs(S)).toContain("xuyên giáp");
    const two = vs2([me(), mate()], [bruiser(), bruiser()], rounds([0, 0], [0, 0], 2));
    expect(two.procs(S)).toContain("gương vỡ");
    expect(two.procs(S)).toContain("xuyên giáp");
  });

  it("86 Hư không hành giả: đòn đầu −45%; · Chuyển cho khiên 15% và 2v2 khiên đồng đội", () => {
    const S = 86;
    const pivot = skillId("Hành Giả Hư Bộ · Chuyển");
    const me = () => pet(S, { skills: [pivot], stats: { ...SLOW, ...TANK } });
    const one = duel([me(), pet(34, { skills: [30] })], [bruiser()], [0]);
    expect(one.procs(S)).toContain("hư bộ");
    expect(one.procs(S)).toContain("khai lộ");
    const core = one.core as {
      request: { kind: string };
      submit(a: unknown): void;
      activeUnit(side: string): { speciesId: number; shieldHp(): number; maxHp(): number };
    };
    // Người chơi được hỏi đổi pet, hoặc engine tự đổi sang pet dự bị duy nhất.
    if (core.request.kind === "pivot") core.submit({ kind: "member", member: 1 });
    const next = core.activeUnit("player");
    expect(next.speciesId).toBe(34);
    expect(next.shieldHp()).toBeGreaterThanOrEqual(Math.trunc(next.maxHp() * 0.15) - 1);
    const two = vs2([me(), mate()], [bruiser(), bruiser()], rounds([0, 0], [0, 0], 1));
    expect(two.procs(S)).toContain("khiên đồng đội");
  });

  it("87 Minh vương Long: đối thủ dưới 40% +30% và hút; hạ gục để lại Hồn", () => {
    const S = 87;
    const me = () => pet(S, { skills: [HT()], hpPct: 50, stats: FAST });
    const one = duel([me()], [slowDummy(30)], [0]);
    expect(one.procs(S)).toContain("thu hồn");
    expect(one.procs(S)).toContain("hút hồn");
    const weak = () => pet(34, { skills: [30], hpPct: 1, stats: SLOW });
    expect(duel([me()], [weak(), slowDummy()], [0, 0]).procs(S)).toContain("hồn");
    const two = vs2(
      [me(), mate()],
      [weak(), slowDummy(30)],
      [
        [
          [0, 0],
          [0, 1],
        ],
        [
          [0, 1],
          [0, 1],
        ],
      ],
    );
    expect(two.procs(S)).toContain("hồn");
    expect(two.procs(S)).toContain("thu hồn");
  });

  it("88 Lắc lắc: đòn trúng thêm hiệu ứng xấu, xấu kéo dài 1 lượt, mục tiêu ≥2 xấu +25%; 2v2 kéo dài của đồng đội", () => {
    const S = 88;
    const curse = skillId("Chú oán"),
      slowdown = skillId("Lôi thiểm");
    // Chỉ đòn thường: đặc tính tự chồng hiệu ứng xấu đến khi đủ 2 loại.
    const plain = duel([pet(S, { skills: [HT()], stats: FAST })], [slowDummy()], [0, 0, 0]);
    expect(plain.procs(S)).toContain("chấn âm phụ");
    expect(plain.procs(S)).toContain("kéo dài");
    expect(plain.procs(S)).toContain("chấn âm");
    expect(live1(plain, "enemy").activeDebuffCount()).toBeGreaterThanOrEqual(2);
    const one = duel(
      [pet(S, { skills: [curse, slowdown, HT()], stats: FAST })],
      [slowDummy()],
      [0, 1, 2],
    );
    expect(one.procs(S)).toContain("kéo dài");
    expect(one.procs(S)).toContain("chấn âm");
    const two = vs2(
      [pet(S, { skills: [HT(), slowdown], stats: FAST }), mate({ skills: [curse] })],
      [slowDummy(), slowDummy()],
      [
        [
          [0, 1],
          [0, 0],
        ],
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
    expect(two.procs(S)).toContain("chấn âm phụ");
    expect(procOn(two, S, "kéo dài")).toContain(34);
    expect(two.procs(S)).toContain("chấn âm");
  });

  it("89 Chim xanh: đi trước thì đòn đầu −25%; · Tật trúng nâng thành 35%", () => {
    const S = 89;
    const me = () =>
      pet(S, { skills: [skillId("Tai Tước Không Sát · Tật")], stats: { ...FAST, ...TANK } });
    const one = duel([me()], [bruiser(1)], [0, 0]);
    expect(one.procs(S)).toContain("tật");
    expect(one.procs(S)).toContain("lướt gió");
    expect(one.procs(S)).toContain("lướt gió mạnh");
    // Pet ít máu hơn hẳn đồng đội để AI đối thủ dồn vào nó.
    const low = pet(S, {
      skills: [skillId("Tai Tước Không Sát · Tật")],
      hpPct: 30,
      stats: { ...FAST, ...TANK },
    });
    const two = vs2([low, mate()], [bruiser(1), bruiser(1)], rounds([0, 0], [0, 0], 3));
    expect(two.procs(S)).toContain("tật");
    expect(two.procs(S).some((l) => l.startsWith("lướt gió"))).toBe(true);
  });

  it("90 Tai tước: lượt trước không mất HP +30%; đi trước thì đòn đầu −20%", () => {
    const S = 90;
    const me = () => pet(S, { skills: [HT()], stats: { ...FAST, ...TANK } });
    const one = duel([me()], [bruiser(1)], [0, 0]);
    expect(one.procs(S)).toContain("phục kích");
    expect(one.procs(S)).toContain("đi trước giảm");
    expect(one.log.filter((p) => p.label === "phục kích").length).toBe(1);
    const two = vs2([me(), mate()], [bruiser(1), bruiser(1)], rounds([0, 0], [0, 0], 2));
    expect(two.procs(S)).toContain("phục kích");
  });

  it("91 Hải âu: lượt dùng chiêu hỗ trợ −35%, giải trừ, hồi 6%; 2v2 giải trừ đồng đội", () => {
    const S = 91;
    const pray = skillId("Đằng chi bích lũy");
    const cursers = () => pet(34, { skills: [skillId("Chú oán")], stats: { ...SLOW, ...TANK } });
    const one = duel([pet(S, { skills: [pray], hpPct: 50, stats: FAST })], [cursers()], [0, 0]);
    expect(one.procs(S)).toContain("che sóng");
    expect(one.procs(S)).toContain("che sóng giảm");
    expect(one.procs(S)).toContain("hồi cuối lượt");
    expect(one.procs(S)).toContain("giải trừ");
    const two = vs2(
      [pet(S, { skills: [pray], stats: { ...FAST, ...TANK } }), mate({ hpPct: 40 })],
      [cursers(), cursers()],
      rounds([0, 3], [0, 0], 3),
    );
    expect(two.procs(S)).toContain("che sóng");
    const cleanse = two.log.filter((p) => p.speciesId === S && p.label === "giải trừ");
    expect(cleanse.some((p) => p.targetSpecies === 90)).toBe(true);
  });

  it("92 Dực thần: hồi tràn thành khiên; đánh thì hút cho pet ít HP nhất", () => {
    const S = 92;
    const heal = skillId("Thánh Dực Tịnh Phong · Dưỡng");
    const one = duel([pet(S, { skills: [heal, HT()], hpPct: 90 })], [slowDummy()], [1, 0]);
    expect(one.procs(S)).toContain("hút cho đồng đội");
    expect(one.procs(S)).toContain("khiên tràn");
    const two = vs2(
      [pet(S, { skills: [heal, HT()], stats: FAST }), mate({ hpPct: 90, stats: { hp: 2000 } })],
      [slowDummy(), slowDummy()],
      [
        [
          [1, 0],
          [0, 0],
        ],
        [
          [0, 3],
          [0, 0],
        ],
      ],
    );
    const leech = two.log.find((p) => p.speciesId === S && p.label === "hút cho đồng đội");
    expect(leech?.targetSpecies).toBe(90);
    expect(two.procs(S)).toContain("khiên tràn");
  });

  it("93 Hồng nhạn: ra sân khiên cả đội; mỗi pet tụt dưới 50% có khiên cứu nguy; chiêu hồi hồi thêm", () => {
    const S = 93;
    const heal = skillId("Thủy Linh Hồi Sinh");
    const one = duel([pet(S, { skills: [HT()], hpPct: 55, stats: SLOW })], [bruiser()], [0, 0]);
    expect(one.procs(S)).toContain("khiên vào sân");
    expect(procOn(one, S, "khiên cứu nguy")).toEqual([S]);
    const healed = duel([pet(S, { skills: [heal], hpPct: 40, stats: SLOW })], [idle()], [0]);
    expect(healed.procs(S)).toContain("hồi thêm");
    expect(live1(healed).shieldHp()).toBeGreaterThan(0);
    const two = vs2(
      [
        pet(S, { skills: [HT()], hpPct: 55, stats: { ...SLOW, hp: 1200 } }),
        mate({ hpPct: 55, stats: { hp: 1200 } }),
      ],
      [bruiser(), bruiser()],
      rounds([0, 0], [0, 0], 3),
    );
    expect(procOn(two, S, "khiên vào sân")).toContain(90);
    // Mỗi pet phe mình một lần.
    const rescued = procOn(two, S, "khiên cứu nguy");
    expect(rescued).toContain(90);
    expect(rescued.filter((s) => s === 90).length).toBe(1);
  });

  it("94 Phi Dực Thú: đi trước nhận Lông Vũ, tiêu để giảm đòn, còn lông thì +10%", () => {
    const S = 94;
    const me = () => pet(S, { skills: [HT()], stats: { ...FAST, ...TANK } });
    const quiet = duel([me()], [idle()], [0, 0]);
    expect(quiet.procs(S)).toContain("lông vũ");
    expect(quiet.procs(S)).toContain("lông cộng sát thương");
    expect(duel([me()], [bruiser(1)], [0, 0]).procs(S)).toContain("tiêu lông");
    const two = vs2(
      [me(), mate({ hpPct: 20 })],
      [bruiser(1), bruiser(1)],
      rounds([0, 0], [0, 0], 6),
    );
    expect(two.procs(S)).toContain("lông vũ");
    expect(two.procs(S)).toContain("lông che đồng đội");
  });

  it("95 Đậu ưng: Con Mồi −15% Linh xảo, pet +15%; 2v2 đồng đội +8%", () => {
    const S = 95;
    const me = () => pet(S, { skills: [HT()], stats: FAST });
    const one = duel([me()], [slowDummy()], [0]);
    expect(one.procs(S)).toContain("con mồi");
    expect(one.procs(S)).toContain("đánh con mồi");
    const two = vs2([me(), mate()], [slowDummy(50), slowDummy()], rounds([0, 0], [0, 0], 2));
    const prey = two.log.find((p) => p.speciesId === S && p.label === "con mồi");
    expect(prey?.targetSide).toBe(1);
    expect(two.procs(S)).toContain("đánh con mồi");
    expect(two.procs(S)).toContain("đồng đội đánh con mồi");
  });

  it("96 Liệt ưng: Con Mồi dưới 35% thì sà kích ưu tiên; 2v2 đồng đội +8%", () => {
    const S = 96;
    const me = () => pet(S, { skills: [HT()], stats: { speed: 1, hp: 99999 } });
    const one = duel([me()], [fastDummy(30)], [0]);
    expect(one.procs(S)).toContain("con mồi");
    expect(one.procs(S)).toContain("sà kích");
    expect(one.procs(S)).toContain("đánh con mồi");
    const two = vs2([me(), mate()], [fastDummy(30), fastDummy()], rounds([0, 0], [0, 0], 1));
    expect(two.procs(S)).toContain("sà kích");
    expect(two.procs(S)).toContain("đồng đội đánh con mồi");
  });

  it("97 Quáng thạch dực long: chiêu Thổ trúng gây Mê Muội và tích tầng DEF, mỗi tầng giảm sát thương nhận", () => {
    const S = 97;
    const me = () => pet(S, { skills: [skillId("Hất bụi")], stats: { ...FAST, hp: 99999 } });
    const one = duel([me()], [bruiser(1)], [0, 0, 0]);
    expect(one.procs(S)).toContain("mê muội");
    expect(one.procs(S).filter((l) => l === "tầng DEF").length).toBe(3);
    expect(one.procs(S)).toContain("giáp cát");
    const self = live1(one);
    expect(self.currentStats.defense).toBeGreaterThan(self.baseStats.defense);
    const two = vs2([me(), mate()], [bruiser(1), bruiser(1)], rounds([0, 0], [0, 1], 2));
    expect(two.procs(S)).toContain("mê muội");
    expect(two.procs(S)).toContain("tầng DEF");
  });

  it("98 Tà ma dực long: Liệt Giáp giảm DEF, phá khiên +40%", () => {
    const S = 98;
    const me = () => pet(S, { skills: [HT()], stats: SLOW });
    const guard = () =>
      pet(34, { skills: [skillId("Tà Dực Liệt Giáp · Thủ")], stats: { ...FAST, ...TANK } });
    const one = duel([me()], [guard()], [0, 0]);
    expect(one.procs(S)).toContain("liệt giáp");
    expect(one.procs(S)).toContain("phá khiên");
    const two = vs2([me(), mate()], [guard(), guard()], rounds([0, 0], [0, 0], 2));
    expect(two.log.find((p) => p.speciesId === S && p.label === "liệt giáp")?.targetSide).toBe(1);
  });

  it("99 Tinh Vân Hạc: đi trước tích Tinh Quang, đủ 3 tầng hit phụ lên đối thủ còn lại", () => {
    const S = 99;
    const me = () => pet(S, { skills: [HT()], stats: FAST });
    const one = duel([me()], [slowDummy()], [0, 0, 0]);
    expect(one.procs(S).filter((l) => l === "tinh quang").length).toBe(3);
    expect(one.procs(S)).toContain("hit phụ");
    const two = vs2([me(), mate()], [slowDummy(), slowDummy()], rounds([0, 0], [0, 0], 3));
    expect(two.procs(S)).toContain("hit phụ");
    const extra = two.log.find((p) => p.speciesId === S && p.label === "hit phụ");
    expect(extra?.targetSide).toBe(1);
    const lost = duel(
      [pet(S, { skills: [HT()], stats: { ...SLOW, ...TANK } })],
      [bruiser()],
      [0, 0],
    );
    expect(lost.procs(S)).not.toContain("tinh quang");
  });

  it("100 Thụ quái: cuối lượt mọc Rễ (DEF, hồi 3%); 2v2 đồng đội DEF +3%", () => {
    const S = 100;
    const me = () => pet(S, { skills: [HT()], hpPct: 50, stats: FAST });
    const one = duel([me()], [slowDummy()], [0, 0]);
    expect(one.procs(S)).toContain("rễ");
    const two = vs2([me(), mate()], [slowDummy(), slowDummy()], rounds([0, 0], [0, 0], 2));
    expect(two.procs(S)).toContain("rễ");
    expect(two.procs(S)).toContain("rễ đồng đội");
  });

  it("101 Bụi gai: đủ 2 Rễ thì gai bật, tối đa 3 lần mỗi lần ra sân; 2v2 đòn trúng đồng đội cũng cho Rễ", () => {
    const S = 101;
    const me = () => pet(S, { skills: [HT()], stats: { ...SLOW, ...TANK } });
    expect(duel([me()], [bruiser()], [0]).procs(S)).not.toContain("rễ gai");
    expect(duel([me()], [bruiser()], [0, 0]).procs(S)).toContain("rễ gai");
    const long = duel([me()], [bruiser()], [0, 0, 0, 0, 0, 0, 0, 0]);
    expect(long.procs(S).filter((l) => l === "rễ gai").length).toBe(3);
    const two = vs2([me(), mate({ hpPct: 20 })], [bruiser(), bruiser()], rounds([0, 0], [0, 0], 3));
    expect(two.procs(S)).toContain("rễ từ đồng đội");
  });

  it("102 Cây chứa dịch độc: độc của pet trừ máu thì mọc Rễ, Rễ cộng sát thương", () => {
    const S = 102;
    const me = () =>
      pet(S, { skills: [skillId("Cổ Mộc Tận Thực · Thực"), HT()], hpPct: 50, stats: FAST });
    const one = duel([me()], [slowDummy()], [0, 1, 1]);
    expect(one.procs(S)).toContain("rễ độc");
    expect(one.procs(S)).toContain("rễ cộng sát thương");
    const two = vs2(
      [me(), mate()],
      [slowDummy(), slowDummy()],
      [
        [
          [0, 0],
          [0, 0],
        ],
        [
          [0, 1],
          [0, 0],
        ],
        [
          [1, 0],
          [0, 0],
        ],
      ],
    );
    expect(two.procs(S)).toContain("rễ độc");
    expect(two.procs(S)).toContain("rễ cộng sát thương");
  });

  it("103 Cổ Thụ Chi Vương: 3 Rễ thì chiêu Mộc xả cộng 25% DEF; 2v2 đồng đội DEF", () => {
    const S = 103;
    const me = () => pet(S, { skills: [skillId("Diệp Toàn")], stats: FAST });
    const one = duel([me()], [slowDummy()], [0, 0, 0, 0]);
    expect(one.procs(S)).toContain("rễ");
    expect(one.procs(S)).toContain("xả rễ");
    const two = vs2([me(), mate()], [slowDummy(), slowDummy()], rounds([0, 0], [0, 0], 4));
    expect(two.procs(S)).toContain("rễ đồng đội");
    expect(two.procs(S)).toContain("xả rễ");
  });

  it("104 Cỏ thơm: chiêu hồi được ưu tiên và hồi thêm; bị đánh thì Mị Hoặc kẻ đánh (2 lượt 1 lần)", () => {
    const S = 104;
    const heal = skillId("Thủy Linh Hồi Sinh");
    const one = duel(
      [pet(S, { skills: [heal, HT()], hpPct: 40, stats: { ...SLOW, ...TANK } })],
      [fastDummy()],
      [0, 1, 1],
    );
    expect(one.procs(S)).toContain("hồi ưu tiên");
    expect(one.procs(S)).toContain("hồi thêm");
    expect(one.procs(S).filter((l) => l === "mị hoặc").length).toBe(2);
    const charm = KIT_STATUS.charm;
    const once = duel([pet(S, { skills: [HT()], stats: SLOW })], [bruiser()], [0]);
    expect(live1(once, "enemy").statuses.has(charm.bank, charm.id)).toBe(true);
    const two = vs2(
      [pet(S, { skills: [heal], stats: { ...SLOW, ...TANK } }), mate({ hpPct: 40 })],
      [fastDummy(), fastDummy()],
      rounds([0, 3], [0, 0], 1),
    );
    expect(procOn(two, S, "hồi thêm")).toContain(90);
  });

  it("105 Hoa ngũ sắc: chiêu hồi tặng cánh hoa; chiêu tấn công hút 15%", () => {
    const S = 105;
    const heal = skillId("Ngũ Sắc Dẫn Hồn · Dưỡng");
    const one = duel([pet(S, { skills: [heal, HT()], hpPct: 50 })], [slowDummy()], [1, 0]);
    expect(one.procs(S)).toContain("hút máu");
    expect(one.procs(S).some((l) => l.startsWith("cánh hoa"))).toBe(true);
    const two = vs2(
      [pet(S, { skills: [heal], stats: FAST }), mate({ hpPct: 50 })],
      [slowDummy(), slowDummy()],
      rounds([0, 3], [0, 0], 1),
    );
    const petal = two.log.find((p) => p.speciesId === S && p.label.startsWith("cánh hoa"));
    expect(petal?.targetSpecies).toBe(90);
  });

  it("106 Hoa ăn thịt người: đòn trúng gây Mị Hoặc; mục tiêu Mị Hoặc hoặc dưới 50% thì hút", () => {
    const S = 106;
    const me = () => pet(S, { skills: [HT()], hpPct: 50, stats: FAST });
    const one = duel([me()], [slowDummy()], [0, 0]);
    expect(one.procs(S)).toContain("mị hoặc");
    expect(one.procs(S)).toContain("hút mồi");
    // Mục tiêu dưới 50% HP: hút ngay đòn đầu.
    const low = duel([me()], [slowDummy(40)], [0]);
    expect(low.procs(S)).toContain("hút mồi");
    expect(live1(low).hp()).toBeGreaterThan(live1(low).maxHp() / 2);
    const two = vs2([me(), mate()], [slowDummy(), slowDummy()], rounds([0, 0], [0, 0], 2));
    expect(two.procs(S)).toContain("mị hoặc");
    expect(two.procs(S)).toContain("hút mồi");
  });

  it("107 Thảo quả: độc của pet bén lửa thành Thiêu Đốt; chiêu Hỏa lên Gieo Hạt +15%", () => {
    const S = 107;
    const me = () => pet(S, { skills: [skillId("Dương viêm"), HT()], stats: FAST });
    const one = duel([me()], [slowDummy()], [0, 1, 1]);
    expect(one.procs(S)).toContain("bén lửa");
    expect(one.procs(S)).toContain("thiêu đốt");
    expect(one.procs(S)).toContain("hỏa lên gieo hạt");
    const two = vs2(
      [me(), mate()],
      [slowDummy(), slowDummy()],
      [
        [
          [0, 0],
          [0, 0],
        ],
        [
          [0, 1],
          [0, 0],
        ],
        [
          [1, 0],
          [0, 0],
        ],
      ],
    );
    const fire = two.log.filter((p) => p.speciesId === S && p.label === "bén lửa");
    expect(fire.length).toBeGreaterThan(0);
    expect(two.procs(S)).toContain("hỏa lên gieo hạt");
  });

  it("108 Mạn đà la: đánh thức mục tiêu Ngủ +40% và Mê Muội; gây xấu mới hồi 5%", () => {
    const S = 108;
    const me = () =>
      pet(S, { skills: [skillId("Miên Ca Lam Mộng"), HT()], hpPct: 50, stats: FAST });
    // 1v1: Ngủ "1 hành động" tự hết khi đối thủ tới lượt, nên chỉ kiểm phần hồi máu ở đây.
    const one = duel([me()], [slowDummy()], [0, 1]);
    expect(one.procs(S)).toContain("hồi máu");
    // 2v2: đồng đội (nhanh hơn pet, chậm hơn đối thủ) ru ngủ mục tiêu ngay trước khi pet đánh.
    const two = vs2(
      [
        pet(S, { skills: [HT()], stats: { ...SLOW, ...TANK } }),
        mate({ skills: [skillId("Miên Ca Lam Mộng")], stats: { speed: 500 } }),
      ],
      [fastDummy(), fastDummy()],
      rounds([0, 0], [0, 0], 1),
    );
    expect(two.procs(S)).toContain("đánh thức");
    expect(two.procs(S)).toContain("mê muội");
  });

  it("109 Hoa Mạn đà la: đòn trúng phủ khói Giảm chính xác; mỗi loại xấu +10% (cả của đồng đội)", () => {
    const S = 109;
    const me = () => pet(S, { skills: [HT()], stats: FAST });
    const one = duel([me()], [slowDummy()], [0, 0]);
    expect(one.procs(S)).toContain("khói mạn đà");
    expect(one.procs(S)).toContain("huyễn hỏa");
    const acc = KIT_STATUS.accuracy_down;
    expect(live1(one, "enemy").statuses.has(acc.bank, acc.id)).toBe(true);
    // 2v2: đồng đội (nhanh hơn) gây hiệu ứng xấu trước, pet đánh ngay lượt đó đã được cộng.
    const two = vs2(
      [
        pet(S, { skills: [HT()], stats: { ...SLOW, ...TANK } }),
        mate({ skills: [skillId("Chú oán")], stats: { speed: 500 } }),
      ],
      [slowDummy(), slowDummy()],
      rounds([0, 0], [0, 0], 1),
    );
    expect(procOn(two, S, "huyễn hỏa")).toContain(34);
    expect(two.procs(S)).toContain("khói mạn đà");
  });

  it("110 Tiên Nhân Chưởng: ra sân có khiên, gai phạt 2 lượt 1 lần, tối đa 2 lần mỗi lần ra sân", () => {
    const S = 110;
    const me = () => pet(S, { skills: [HT()], stats: { ...SLOW, ...TANK } });
    const one = duel([me()], [bruiser()], [0, 0]);
    expect(one.procs(S)).toContain("khiên vào sân");
    expect(one.procs(S).filter((l) => l === "gai").length).toBe(1);
    const long = duel([me()], [bruiser()], [0, 0, 0, 0, 0, 0]);
    expect(long.procs(S).filter((l) => l === "gai").length).toBe(2);
    const two = vs2([me(), mate({}, 110)], [bruiser(), bruiser()], rounds([0, 0], [0, 0], 3));
    expect(two.procs(S)).toContain("khiên vào sân");
    expect(two.procs(S)).toContain("gai");
  });

  it("111 Gai khổng lồ: gai 4% đâm 2 lượt 1 lần, giữa hai lần dài thêm +2%; 2v2 đòn trúng đồng đội làm gai dài", () => {
    const S = 111;
    const me = () => pet(S, { skills: [HT()], stats: { ...SLOW, ...TANK } });
    const one = duel([me()], [bruiser()], [0, 0, 0]);
    expect(one.procs(S)).toEqual(["gai 4%", "gai 6%"]);
    const two = vs2([me(), mate()], [bruiser(), bruiser()], rounds([0, 0], [0, 0], 3));
    expect(two.procs(S)).toContain("gai dài");
  });

  it("112 Gai độc: gai 6% kèm Hủ Thực; đánh mục tiêu Hủ Thực hút 15%", () => {
    const S = 112;
    const me = () => pet(S, { skills: [HT()], hpPct: 50, stats: { ...FAST, ...TANK } });
    const one = duel([me()], [bruiser(1)], [0, 0]);
    expect(one.procs(S)).toContain("gai độc");
    expect(one.procs(S)).toContain("hủ thực");
    expect(one.procs(S)).toContain("hút hủ thực");
    const two = vs2([me(), mate()], [bruiser(1), bruiser(1)], rounds([0, 0], [0, 0], 2));
    expect(two.procs(S)).toContain("hủ thực");
  });

  it("113 Quả Tử Tiểu Tả: đi trước rắc Hủ Thực; chiêu Phong lên Hủ Thực +20%", () => {
    const S = 113;
    const me = () => pet(S, { skills: [skillId("Phong nhận")], stats: FAST });
    const one = duel([me()], [slowDummy()], [0, 0]);
    expect(one.procs(S)).toContain("rắc độc");
    expect(one.procs(S)).toContain("phong lên hủ thực");
    const two = vs2(
      [me(), mate()],
      [slowDummy(), slowDummy()],
      [
        [
          [0, 0],
          [0, 0],
        ],
        [
          [0, 1],
          [0, 0],
        ],
      ],
    );
    const rot = two.log.filter((p) => p.speciesId === S && p.label === "rắc độc");
    expect(rot.length).toBe(2);
  });

  it("114 Tứ Diệp Tiểu Tả: Lá giảm sát thương, · Dưỡng tiêu Lá; 2v2 trao Lá cho đồng đội", () => {
    const S = 114;
    const heal = skillId("Tứ Diệp Hồi Tuyền · Dưỡng");
    const bubble = skillId("Bong bóng");
    const one = duel(
      [pet(S, { skills: [bubble, heal], hpPct: 50, stats: { ...FAST, hp: 3000 } })],
      [bruiser(1)],
      [0, 0, 1],
    );
    expect(one.procs(S)).toContain("lá");
    expect(one.procs(S)).toContain("lá giảm");
    expect(one.procs(S)).toContain("tiêu lá");
    // Pet đứng ô 3, đồng đội ô 2 (ô AI đối thủ hay nhắm): · Dưỡng nhắm đồng đội ở ô 2.
    const two = vs2(
      [
        mate({ hpPct: 30, stats: { hp: 3000 } }),
        pet(S, { skills: [bubble, heal], stats: { ...FAST, hp: 3000 } }),
      ],
      [bruiser(1), bruiser(1)],
      [
        [
          [0, 0],
          [0, 0],
        ],
        [
          [0, 0],
          [1, 2],
        ],
        [
          [0, 0],
          [0, 0],
        ],
      ],
    );
    const gift = two.log.find((p) => p.speciesId === S && p.label === "trao lá");
    expect(gift?.targetSpecies).toBe(90);
    // "lá che đồng đội" (guardAlly) chưa dựng được: AI huấn luyện viên luôn nhắm pet 114.
  });

  it("115 Bá Vương Hoa: HP trên 60% chiêu Hỏa +12%; kích nổ Gieo Hạt hồi 15%", () => {
    const S = 115;
    const me = () =>
      pet(S, { skills: [skillId("Dương viêm"), skillId("Chước nhiệt chi xúc")], stats: FAST });
    const one = duel([me()], [slowDummy()], [0, 1]);
    expect(one.procs(S)).toContain("quang hợp");
    expect(one.procs(S)).toContain("hấp hạt");
    const two = vs2(
      [
        pet(S, { skills: [skillId("Chước nhiệt chi xúc")], stats: SLOW }),
        mate({ skills: [skillId("Dương viêm")], stats: FAST }),
      ],
      [slowDummy(), slowDummy()],
      rounds([0, 0], [0, 0], 1),
    );
    expect(two.procs(S)).toContain("hấp hạt");
  });

  it("116 Ái Tâm Thảo: chiêu hồi sạc Tim Điện (+25%, Tê Liệt), lượt hồi −25%", () => {
    const S = 116;
    const heal = skillId("Tâm Thảo Trợ Lực · Dưỡng");
    const one = duel(
      [pet(S, { skills: [heal, HT()], hpPct: 50, stats: { ...FAST, hp: 3000 } })],
      [bruiser(1)],
      [0, 1],
    );
    expect(one.procs(S)).toContain("tim điện");
    expect(one.procs(S)).toContain("tâm điện giảm");
    expect(one.procs(S)).toContain("tim điện xả");
    expect(one.procs(S)).toContain("tê liệt");
    const two = vs2(
      [pet(S, { skills: [heal], stats: FAST }), mate({ hpPct: 50 })],
      [slowDummy(), slowDummy()],
      rounds([0, 3], [0, 0], 1),
    );
    const charge = two.log.find((p) => p.speciesId === S && p.label === "tim điện");
    expect(charge?.targetSpecies).toBe(90);
    expect(two.procs(S)).toContain("tim điện đồng đội");
    expect(two.procs(S)).toContain("tê liệt");
  });

  it("117 Bạch Liệt Sư: ra sân gầm −10% sát thương đối thủ; đánh mục tiêu mang xấu +10%", () => {
    const S = 117;
    const me = () => pet(S, { skills: [HT()], stats: FAST });
    const one = duel([me()], [slowDummy()], [0]);
    expect(one.procs(S)).toContain("gầm");
    expect(one.procs(S)).toContain("đánh mục tiêu mang xấu");
    const two = vs2([me(), mate()], [slowDummy(), slowDummy()], rounds([0, 0], [0, 0], 1));
    const roars = two.log.filter((p) => p.speciesId === S && p.label === "gầm");
    expect(roars.length).toBe(2);
    expect(two.procs(S)).toContain("đánh mục tiêu mang xấu");
  });

  it("118 Vương Sư: ra sân gầm −12%; bị đánh tích Nộ", () => {
    const S = 118;
    const me = () => pet(S, { skills: [HT()], stats: { ...SLOW, ...TANK } });
    const one = duel([me()], [bruiser()], [0, 0]);
    expect(one.procs(S)).toContain("gầm");
    expect(one.procs(S)).toContain("nộ");
    const two = vs2([me(), mate()], [bruiser(), bruiser()], rounds([0, 0], [0, 0], 2));
    expect(two.log.filter((p) => p.speciesId === S && p.label === "gầm").length).toBe(2);
    expect(two.procs(S)).toContain("nộ");
  });

  it("119 Đế Vương Sư: ra sân gầm; hạ gục thì gầm lại và hồi 10%", () => {
    const S = 119;
    const me = () => pet(S, { skills: [HT()], hpPct: 50, stats: FAST });
    const weak = () => pet(34, { skills: [30], hpPct: 1, stats: SLOW });
    const one = duel([me()], [weak(), slowDummy()], [0, 0]);
    expect(one.procs(S)).toContain("gầm");
    expect(one.procs(S)).toContain("uy áp");
    const two = vs2([me(), mate()], [weak(), slowDummy()], rounds([0, 0], [0, 1], 1));
    expect(
      two.log.filter((p) => p.speciesId === S && p.label === "gầm").length,
    ).toBeGreaterThanOrEqual(2);
    expect(two.procs(S)).toContain("uy áp");
  });
});

describe("kịch bản đặc tính phần 3: một mô tả duy nhất", () => {
  it("pet 80..119 chỉ có một mô tả, mọi số trong mô tả đều lấy từ params", () => {
    for (let id = 80; id <= 119; id++) {
      const script = PART_3[id];
      expect(script, `kịch bản ${id}`).toBeDefined();
      expect(script.text2v2, `text2v2 ${id}`).toBeUndefined();
      expect(script.text, `text ${id}`).not.toMatch(/1v1|2v2/i);
      expect(renderTraitText(id, script), `render ${id}`).not.toMatch(/[{}]/);
    }
  });
});
