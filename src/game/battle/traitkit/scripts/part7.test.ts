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
import { PART_7 } from "./part7";

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
const bruiser = (skills = [30]) => pet(34, { skills, stats: { speed: 9999, hp: 99999 } });
/** Đối thủ đánh sau, có đòn thật, rất trâu. */
const hitter = (skills = [30]) => pet(34, { skills, stats: { speed: 1, hp: 99999 } });
const slowDummy = () => dummy(34, { stats: SLOW });
const s = (...names: string[]) => names.map((n) => skillId(n));
/** `n` vòng 2v2: pet ô 2 dùng lệnh `a`, pet ô 3 dùng lệnh `b`. */
const rounds = (
  n: number,
  a: [number, DoubleSlot] = [0, 0],
  b: [number, DoubleSlot] = [0, 0],
): [number, DoubleSlot][][] => Array.from({ length: n }, () => [a, b]);
/** Đồng đội trâu, đánh nhẹ, chậm (AI 2v2 đánh pet có Sức mạnh cao hơn: đồng đội ít bị nhắm). */
const mate = (id = 68) => pet(id, { skills: [30], stats: { ...SLOW, ...TANK, attack: 1 } });
/** Đồng đội "mồi": Sức mạnh rất cao nên AI 2v2 nhắm vào nó. */
const bait = (extra: Record<string, number> = {}, hpPct?: number) =>
  pet(68, { skills: [30], hpPct, stats: { ...SLOW, ...TANK, attack: 5000, ...extra } });
/** Mồi cho pet hệ Thủy: AI 2v2 ưu tiên hệ bị khắc, nên mồi cũng hệ Thủy (48) và DEF thấp. */
const baitW = (hpPct?: number) =>
  pet(48, { skills: [30], hpPct, stats: { ...SLOW, ...TANK, attack: 5000, defense: 1 } });
/** Pet kiểm có Sức mạnh 1 để AI 2v2 nhắm vào đồng đội. */
const LOW_ATK = { attack: 1 };

function has(res: ScenarioResult, id: number, labels: string[]): void {
  const got = res.procs(id);
  for (const label of labels) expect(got, `${id}: ${label}`).toContain(label);
}
function hitsOn(res: ScenarioResult, id: number, label: string, target: number): void {
  expect(res.log).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ speciesId: id, side: 0, label, targetSpecies: target }),
    ]),
  );
}

/** Chạy `run` với mọi cú tung trúng/trượt ra 0: đòn có tỉ lệ trượt > 0 (bị giảm chính xác) trượt. */
const probe = duel([pet(34, { skills: [30] })], [slowDummy()], [0]);
function withMisses<T>(run: () => T): T {
  const proto = Object.getPrototypeOf((probe.core as { random: object }).random) as {
    percent(label: string): number;
  };
  const original = proto.percent;
  proto.percent = function (this: unknown, label: string) {
    return /hitroll/.test(label) ? 0 : original.call(this, label);
  };
  try {
    return run();
  } finally {
    proto.percent = original;
  }
}

describe("kịch bản đặc tính phần 7: chạy trong 1v1 và 2v2", () => {
  it("240 Huyền Giáp Hải Hùng: Triều Rút giảm + hồi, Triều Lên dội; 2v2 sóng che", () => {
    const S = 240;
    const me = (stats = {}) =>
      pet(S, { skills: s("Bong bóng"), hpPct: 60, stats: { ...SLOW, ...TANK, ...stats } });
    has(duel([me()], [bruiser()], [0, 0, 0]), S, ["triều rút", "triều hồi", "triều lên"]);
    const two = double([baitW(30), me(LOW_ATK)], [bruiser(), bruiser()], rounds(3));
    has(two, S, ["sóng che chắn", "triều hồi"]);
    hitsOn(two, S, "sóng che chắn", 48);
  });

  it("241 Hải Nguyệt Hùng Mẫu: cứu dưới 40%, hồi máu thì chịu ít hơn", () => {
    const S = 241;
    const me = (hpPct: number, stats = {}) =>
      pet(S, { skills: s("Thủy Linh Hồi Sinh"), hpPct, stats });
    has(duel([me(41, { ...SLOW, hp: 2000, defense: 1 })], [bruiser()], [0]), S, ["cứu"]);
    has(duel([me(80, { ...FAST, ...TANK })], [hitter()], [0]), S, ["che con"]);
    const weak = pet(48, { skills: [30], hpPct: 41, stats: { ...SLOW, hp: 2000, defense: 1 } });
    const two = double(
      [weak, me(80, { ...SLOW, ...TANK, ...LOW_ATK })],
      [bruiser(), bruiser()],
      rounds(1, [0, 0], [0, 3]),
    );
    hitsOn(two, S, "cứu", 48);
  });

  for (const [S, extra] of [
    [242, ""],
    [243, "Lôi Thiết Bạo Vũ"],
    [244, ""],
  ] as const) {
    it(`${S} Tĩnh Điện: bị đánh tích tầng và gây Tê Liệt, chiêu Lôi xả`, () => {
      const me = () => pet(S, { skills: s(extra || "Điện giật"), stats: { ...SLOW, ...TANK } });
      const one = duel([me()], [bruiser()], [0, 0]);
      has(one, S, ["tĩnh điện", "tê liệt", "xả tĩnh điện"]);
      if (S === 243) has(one, S, ["bạo vũ tĩnh điện"]);
      const two = double([me(), mate()], [bruiser(), bruiser()], rounds(2));
      has(two, S, ["tĩnh điện", "tê liệt", "xả tĩnh điện"]);
      if (S === 244) {
        // Đủ 3 tầng (không dùng chiêu Lôi), giải Băng lao bằng Địa Giới: lần gây mới bị chặn.
        const wall = () =>
          pet(S, {
            skills: s("Nham Nha Phệ Cốt", "Người bảo vệ Địa Giới"),
            stats: { ...SLOW, ...TANK },
          });
        has(duel([wall()], [bruiser(s("Băng lao"))], [0, 0, 0, 1, 0]), S, ["lôi thành miễn"]);
      }
    });
  }

  it("245 Thủy Nang Oa: hồi máu phun sương, đòn trượt hồi máu", () => {
    const S = 245;
    const me = (stats = {}) =>
      pet(S, { skills: s("Thủy Linh Hồi Sinh"), hpPct: 50, stats: { ...FAST, ...TANK, ...stats } });
    const one = withMisses(() => duel([me()], [hitter()], [0, 0]));
    has(one, S, ["phun sương", "trượt hồi"]);
    const two = withMisses(() =>
      double([baitW(30), me(LOW_ATK)], [hitter(), hitter()], rounds(2, [0, 0], [0, 3])),
    );
    has(two, S, ["phun sương"]);
    hitsOn(two, S, "trượt hồi", 48);
  });

  it("246 Cự Khẩu Triều Oa: đánh đối thủ mờ mắt, nuốt sương khi bị trượt", () => {
    const S = 246;
    const me = () => pet(S, { skills: s("Băng lao"), hpPct: 50, stats: { ...FAST, ...TANK } });
    const one = withMisses(() => duel([me()], [hitter()], [0, 0, 0]));
    has(one, S, ["đánh mờ mắt", "nuốt sương", "nuốt sương +%"]);
    const two = withMisses(() => double([me(), mate()], [hitter(), hitter()], rounds(3)));
    has(two, S, ["đánh mờ mắt", "nuốt sương"]);
  });

  it("247 Hải Khiếu Câm Thú: sương chắn, trượt thì gầm Mị Hoặc", () => {
    const S = 247;
    const me = () => pet(S, { skills: s("Băng lao"), hpPct: 50, stats: { ...FAST, ...TANK } });
    has(duel([me()], [hitter()], [0, 0]), S, ["sương chắn"]);
    has(
      withMisses(() => duel([me()], [hitter()], [0, 0])),
      S,
      ["gầm mị hoặc"],
    );
    const two = withMisses(() => double([me(), mate()], [hitter(), hitter()], rounds(2)));
    has(two, S, ["gầm mị hoặc"]);
  });

  it("248 Viêm Trảo Hổ Binh: Nộ vào sân, khi bị đánh; 2v2 đồng đội bị đánh", () => {
    const S = 248;
    const me = (stats = {}) =>
      pet(S, { skills: s("Hỏa trảo"), stats: { ...SLOW, ...TANK, ...stats } });
    const one = duel([me()], [bruiser()], [0, 0]);
    expect(one.procs(S).filter((l) => l === "nộ").length).toBeGreaterThanOrEqual(3);
    const two = double([me(LOW_ATK), bait()], [bruiser(), bruiser()], rounds(2));
    expect(two.procs(S).filter((l) => l === "nộ").length).toBeGreaterThanOrEqual(3);
  });

  it("249 Xích Diễm Hổ Tướng: đủ 3 Nộ thì đòn kế gây Xé Rách", () => {
    const S = 249;
    const me = () => pet(S, { skills: s("Hỏa trảo"), stats: { ...SLOW, ...TANK } });
    has(duel([me()], [bruiser()], [0, 0, 0]), S, ["nộ", "xé rách"]);
    has(double([me(), mate()], [bruiser(), bruiser()], rounds(3)), S, ["nộ", "xé rách"]);
  });

  it("250 Liệt Hỏa Hổ Vương: báo thù (1v1 dưới 35%, 2v2 đồng đội gục)", () => {
    const S = 250;
    const me = (hpPct?: number, stats = {}) =>
      pet(S, { skills: s("Hỏa trảo"), hpPct, stats: { ...SLOW, ...stats } });
    has(duel([me(36, { hp: 2000, defense: 1 })], [bruiser()], [0, 0]), S, ["nộ", "báo thù"]);
    const frail = pet(68, { skills: [30], hpPct: 5, stats: { ...SLOW, hp: 100, defense: 1 } });
    has(
      double([me(undefined, { ...TANK, ...LOW_ATK }), frail], [bruiser(), bruiser()], rounds(2)),
      S,
      ["báo thù"],
    );
  });

  it("251 Linh Quả Tiểu Hầu: đổi chiêu nhận Côn Ấn, lặp chiêu mất hết", () => {
    const S = 251;
    const me = () =>
      pet(S, { skills: s("Diệp Toàn", "Diệp chi ân huệ"), stats: { ...FAST, ...TANK } });
    has(duel([me()], [slowDummy()], [0, 1, 0, 0]), S, ["côn ấn", "côn ấn +%", "mất côn ấn"]);
    const two = double(
      [me(), mate()],
      [slowDummy(), slowDummy()],
      [...rounds(1, [0, 0]), ...rounds(1, [1, 0]), ...rounds(1, [0, 0])],
    );
    has(two, S, ["côn ấn", "côn ấn +%"]);
  });

  it("252 Cổ Mộc Hầu Tiên: đủ 3 Côn Ấn xả Quấn Quanh + hồi", () => {
    const S = 252;
    const me = () =>
      pet(S, { skills: s("Diệp Toàn", "Châm Diệp Trảm"), hpPct: 50, stats: { ...FAST, ...TANK } });
    has(duel([me()], [slowDummy()], [0, 1, 0, 1]), S, ["côn ấn", "xả côn ấn", "quấn quanh"]);
    const alt = [
      ...rounds(1, [0, 0]),
      ...rounds(1, [1, 0]),
      ...rounds(1, [0, 0]),
      ...rounds(1, [1, 0]),
    ];
    has(double([me(), mate()], [slowDummy(), slowDummy()], alt), S, ["xả côn ấn"]);
  });

  for (const S of [253, 254, 255, 256]) {
    it(`${S} hư ảnh: đòn đầu giảm, kẻ đánh bị Ám/Vương Ấn`, () => {
      const me = (stats = {}) =>
        pet(S, { skills: s("Ảnh thứ"), stats: { ...SLOW, ...TANK, ...stats } });
      const one = duel([me()], [bruiser()], [0, 0, 0]);
      has(one, S, ["hư ảnh", "dội ngược"]);
      has(one, S, [S === 256 ? "vương ấn" : "ám"]);
      if (S === 255) has(one, S, ["phản phệ"]);
      if (S === 256) has(one, S, ["đánh vương ấn"]);
      const two = double([me(), mate()], [bruiser(), bruiser()], rounds(3));
      has(two, S, ["hư ảnh", S === 256 ? "vương ấn" : "ám"]);
      if (S === 253 || S === 256) {
        // Kẻ bị Ám / mang ấn đánh đồng đội cũng có thể dội ngược.
        // Vòng 1 đối thủ đánh pet (máu thấp nhất) và bị Ám; đồng đội hồi cho pet, vòng 2 đối thủ
        // chuyển sang đánh đồng đội.
        const healer = pet(68, {
          skills: s("Thủy Linh Hồi Sinh"),
          hpPct: 50,
          stats: { ...SLOW, ...TANK, attack: 1 },
        });
        const low = pet(S, { skills: s("Ảnh thứ"), hpPct: 45, stats: { ...SLOW, ...TANK } });
        const guard = double([low, healer], [bruiser(), bruiser()], rounds(2, [0, 0], [0, 2]));
        has(guard, S, ["hư ảnh"]);
        hitsOn(guard, S, "dội ngược", 34);
      }
      if (S === 254) {
        const pivot = () =>
          pet(S, { skills: s("U Minh Hư Phán · Chuyển"), stats: { ...FAST, ...TANK } });
        hitsOn(duel([pivot(), mate()], [slowDummy()], [0]), S, "hư thể", 68);
      }
    });
  }

  it("257 Triều Vụ U Linh: thu Hồn từ Hủ Thực, đòn kế tiêu Hồn", () => {
    const S = 257;
    const me = () =>
      pet(S, {
        skills: s("Mạn Độc Triền Sinh", "Bong bóng"),
        hpPct: 50,
        stats: { ...FAST, ...TANK },
      });
    has(duel([me()], [slowDummy()], [0, 1, 1]), S, ["thu hồn", "hồn +%", "tiêu hồn"]);
    const two = double(
      [me(), mate()],
      [slowDummy(), slowDummy()],
      [...rounds(1, [0, 0]), ...rounds(1, [0, 1]), ...rounds(1, [1, 0])],
    );
    has(two, S, ["thu hồn", "hồn +%", "tiêu hồn"]);
  });

  it("258 Hải Oán Tà Linh: thu Hồn, đối thủ mang hai loại mất máu yếu đi", () => {
    const S = 258;
    const me = (stats = {}) =>
      pet(S, {
        skills: s("Mạn Độc Triền Sinh", "Độ Hồn Hải Ấn · Thực", "Bong bóng"),
        stats: { ...FAST, ...TANK, ...stats },
      });
    has(duel([me()], [hitter()], [0, 1, 2]), S, ["thu hồn", "oán yếu", "hồn +%"]);
    const two = double(
      [baitW(), me(LOW_ATK)],
      [hitter(), hitter()],
      [
        ...rounds(1, [0, 0], [0, 0]),
        ...rounds(1, [0, 0], [1, 0]),
        ...rounds(1, [0, 0], [0, 1]),
        ...rounds(1, [0, 0], [1, 1]),
      ],
    );
    has(two, S, ["thu hồn", "oán yếu đồng đội"]);
  });

  it("259 Độ Hồn Minh Sư: thu Hồn khi đánh mục tiêu mang hiệu ứng xấu, hồi máu tiêu Hồn", () => {
    const S = 259;
    const me = (stats = {}) =>
      pet(S, {
        skills: s("Mạn Độc Triền Sinh", "Thủy Linh Hồi Sinh", "Bong bóng"),
        hpPct: 50,
        stats: { ...FAST, ...TANK, ...stats },
      });
    has(duel([me()], [hitter()], [0, 1]), S, ["thu hồn", "độ hồn", "hồn che"]);
    // Vòng 2 đánh mục tiêu đang Hủ Thực: tiêu Hồn cũ (+%) rồi thu Hồn mới từ chính đòn đó.
    const atk = duel([me()], [hitter()], [0, 2]);
    has(atk, S, ["thu hồn", "thu hồn khi đánh", "hồn +%", "tiêu hồn"]);
    expect(unitOf(atk, S).kit?.v.soul ?? 0).toBeGreaterThanOrEqual(1);
    const two = double(
      [baitW(50), me(LOW_ATK)],
      [hitter(), hitter()],
      [...rounds(1, [0, 0], [0, 0]), ...rounds(1, [0, 0], [1, 2])],
    );
    hitsOn(two, S, "độ hồn", 48);
    has(two, S, ["hồn che đồng đội"]);
  });

  it("260 Dạ Diệp Yêu Tinh: ra đòn trước thì lá che đòn đầu (2v2: đồng đội)", () => {
    const S = 260;
    const me = (stats = {}) =>
      pet(S, { skills: s("Diệp Toàn"), stats: { ...FAST, ...TANK, ...stats } });
    has(duel([me()], [hitter()], [0]), S, ["lá che"]);
    const two = double([me(LOW_ATK), bait()], [hitter(), hitter()], rounds(1));
    hitsOn(two, S, "lá che", 68);
  });

  it("261 Hắc Lâm Tinh Vương: trên 60% trả máu cộng đòn, dưới thì hút máu", () => {
    const S = 261;
    const me = (hpPct?: number) =>
      pet(S, { skills: s("Diệp Toàn"), hpPct, stats: { ...FAST, ...TANK } });
    has(duel([me()], [slowDummy()], [0]), S, ["trả máu", "huyết ước +%"]);
    has(duel([me(50)], [slowDummy()], [0]), S, ["hút máu"]);
    has(double([me(), mate()], [slowDummy(), slowDummy()], rounds(1)), S, [
      "trả máu",
      "huyết ước +%",
    ]);
    has(double([me(50), mate()], [slowDummy(), slowDummy()], rounds(1)), S, ["hút máu"]);
  });

  it("262 Lam Dực Mộc Hậu: Rễ Ước giảm sát thương + hồi, hồi đi trước lượt đầu", () => {
    const S = 262;
    const me = (stats = {}) =>
      pet(S, { skills: s("Thảo nguyện thuật"), hpPct: 50, stats: { ...SLOW, ...TANK, ...stats } });
    has(duel([me()], [hitter()], [0]), S, ["hồi đi trước", "rễ ước", "rễ che", "rễ hồi"]);
    const two = double(
      [me(LOW_ATK), bait({}, 50)],
      [hitter(), hitter()],
      rounds(1, [0, 3], [0, 0]),
    );
    hitsOn(two, S, "rễ ước", 68);
    hitsOn(two, S, "rễ che", 68);
  });

  for (const S of [263, 264, 265]) {
    it(`${S} đèn Gieo Hạt: kéo dài Gieo Hạt, đối thủ mang nó yếu đi`, () => {
      const second = S === 264 ? "Chước nhiệt chi xúc" : "Thủy Linh Hồi Sinh";
      const me = (stats = {}) =>
        pet(S, {
          skills: s("Dương viêm", second),
          hpPct: 50,
          stats: { ...FAST, ...TANK, ...stats },
        });
      const one = duel([me()], [hitter()], [0, 1]);
      has(one, S, ["gieo hạt +1", "đèn soi"]);
      if (S === 264) has(one, S, ["dầu đèn hồi"]);
      if (S === 265) has(one, S, ["đèn bùng"]);
      const two = double([me(LOW_ATK), bait()], [hitter(), hitter()], rounds(2, [0, 0], [0, 0]));
      has(two, S, ["gieo hạt +1", "đèn soi đồng đội"]);
    });
  }

  for (const S of [266, 267, 268]) {
    it(`${S} Nhãn Ấn: đòn trúng gắn Ấn, đối thủ yếu đi`, () => {
      const me = (stats = {}) =>
        pet(S, { skills: s("Hất bụi"), stats: { ...FAST, ...TANK, ...stats } });
      const one = duel([me()], [hitter()], [0, 0, 0]);
      has(one, S, ["nhãn ấn", "nhãn yếu"]);
      if (S === 267) has(one, S, ["mê muội"]);
      if (S === 268) has(one, S, ["thạch hóa"]);
      const two = double([me(LOW_ATK), bait()], [hitter(), hitter()], rounds(3));
      has(two, S, ["nhãn ấn", "nhãn yếu đồng đội"]);
      if (S === 267) has(two, S, ["mê muội"]);
      if (S === 268) has(two, S, ["thạch hóa"]);
    });
  }

  it("269 Lôi Long Thiên Tướng: tiên phong, Lôi Lệnh, mất khi bị đi trước; 2v2 cầm cờ", () => {
    const S = 269;
    const me = (stats = {}) => pet(S, { skills: s("Điện giật"), stats: { ...TANK, ...stats } });
    has(duel([me(FAST)], [slowDummy()], [0, 0]), S, ["lôi lệnh", "lôi lệnh +%", "tê liệt"]);
    has(duel([me(SLOW)], [bruiser()], [0, 0]), S, ["tiên phong", "lôi lệnh", "mất lôi lệnh"]);
    const two = double(
      [me(FAST), pet(68, { skills: s("Hỏa trảo"), stats: { ...SLOW, ...TANK } })],
      [slowDummy(), slowDummy()],
      rounds(2),
    );
    has(two, S, ["lôi lệnh", "lôi lệnh +%"]);
    hitsOn(two, S, "cờ lôi lệnh", 68);
  });

  it("270 Cổ Giới Thiết Thần: Kết Giới chặn và dội, nứt thì tầng DEF giảm", () => {
    const S = 270;
    const me = (stats = {}) =>
      pet(S, { skills: s("Thổ thuẫn"), stats: { ...FAST, ...TANK, ...stats } });
    has(duel([me()], [hitter()], [0, 0]), S, ["kết giới", "dội kết giới", "giáp nứt"]);
    const two = double([me(LOW_ATK), bait()], [hitter(), hitter()], rounds(1));
    hitsOn(two, S, "kết giới", 68);
    has(two, S, ["dội kết giới"]);
  });

  it("271 Vạn Hoa Thánh Mẫu: hồi cả đội, Dự Trữ từ Hủ Thực, hồi sinh một lần", () => {
    const S = 271;
    const me = (hpPct?: number, stats = {}) =>
      pet(S, { skills: s("Mạn Độc Triền Sinh"), hpPct, stats: { ...SLOW, ...TANK, ...stats } });
    has(duel([me()], [slowDummy()], [0, 0]), S, ["vạn hoa hồi", "dự trữ"]);
    const dying = pet(S, {
      skills: s("Mạn Độc Triền Sinh"),
      stats: { ...SLOW, hp: 50, defense: 1 },
    });
    has(duel([dying], [bruiser()], [0]), S, ["tái sinh"]);
    const frail = pet(68, {
      skills: [30],
      hpPct: 10,
      stats: { ...SLOW, hp: 2000, defense: 1, attack: 5000 },
    });
    const two = double([frail, me(undefined, LOW_ATK)], [bruiser(), bruiser()], rounds(1));
    hitsOn(two, S, "tái sinh", 68);
    hitsOn(two, S, "vạn hoa hồi", 68);
  });

  it("272 U Minh Thần Đồng: hiệu ứng xấu mới cho khiên + cộng đòn; Tử Thần giữ nửa PP", () => {
    const S = 272;
    const me = () => pet(S, { skills: s("Chú oán"), stats: { ...FAST, ...TANK } });
    has(duel([me()], [slowDummy()], [0, 0]), S, ["thần ấn", "thần ấn +%"]);
    has(double([me(), mate()], [slowDummy(), slowDummy()], rounds(2, [0, 0])), S, [
      "thần ấn",
      "thần ấn +%",
    ]);
    const death = pet(S, { skills: s("Tử Thần Xúc Ấn", "Ảnh thứ"), stats: { ...FAST, ...TANK } });
    // Đội còn pet khác (không thua vì cạn PP); đối thủ chậm hành động sau → PP được trả.
    const one = duel([death, pet(68)], [slowDummy()], [0, 1]);
    has(one, S, ["giữ nửa PP"]);
  });

  it("273 Phúc Triều Thần Miêu: đổi vận ném ngược hiệu ứng xấu, hồi mỗi lượt", () => {
    const S = 273;
    const me = (stats = {}) =>
      pet(S, { skills: s("Bong bóng"), hpPct: 50, stats: { ...SLOW, ...TANK, ...stats } });
    has(duel([me()], [bruiser(s("Băng lao"))], [0, 0]), S, ["đổi vận", "vận may +%", "miêu hồi"]);
    const two = double(
      [baitW(), me(LOW_ATK)],
      [bruiser(s("Băng lao")), bruiser(s("Băng lao"))],
      rounds(1),
    );
    hitsOn(two, S, "đổi vận", 48);
  });

  it("274 Hỏa Vu Mộc Linh: song chủng cộng đòn, nảy mầm hút máu", () => {
    const S = 274;
    const me = () =>
      pet(S, {
        skills: s("Dương viêm", "Mạn Độc Triền Sinh", "Hỏa trảo"),
        hpPct: 50,
        stats: { ...FAST, ...TANK },
      });
    has(duel([me()], [slowDummy()], [0, 1, 2]), S, ["đơn chủng +%", "song chủng +%", "nảy mầm"]);
    const two = double(
      [me(), mate()],
      [slowDummy(), slowDummy()],
      [...rounds(1, [0, 0]), ...rounds(1, [1, 0]), ...rounds(1, [2, 0])],
    );
    has(two, S, ["song chủng +%", "nảy mầm"]);
  });

  it("275 Thiên Luân Di Lặc: miễn khống chế cứng, quay nấc rồi xả; 2v2 rút khống chế đồng đội", () => {
    const S = 275;
    const me = (stats = {}) =>
      pet(S, { skills: s("Phong nhận"), stats: { ...SLOW, ...TANK, ...stats } });
    has(duel([me()], [bruiser(s("Lôi thiểm"))], [0, 0]), S, [
      "kim thân miễn",
      "thiên luân",
      "xả thiên luân",
    ]);
    const two = double(
      [me(LOW_ATK), bait()],
      [bruiser(s("Lôi thiểm")), bruiser(s("Lôi thiểm"))],
      rounds(1),
    );
    hitsOn(two, S, "rút khống chế", 68);
  });

  it("276 Hỏa Diễm Hầu Vương: đổi hệ tích dấu Côn, · Bạo tiêu 2 dấu gây Xé Rách", () => {
    const S = 276;
    const me = () =>
      pet(S, {
        skills: s("Hỏa trảo", "Điện giật", "Hầu Vương Liệt Côn · Bạo"),
        stats: { ...FAST, ...TANK },
      });
    has(duel([me()], [slowDummy()], [0, 1, 0, 2]), S, [
      "dấu côn",
      "dấu côn +%",
      "liệt côn bạo",
      "xé rách",
    ]);
    const seq = [
      ...rounds(1, [0, 0]),
      ...rounds(1, [1, 0]),
      ...rounds(1, [0, 0]),
      ...rounds(1, [2, 0]),
    ];
    has(double([me(), mate()], [slowDummy(), slowDummy()], seq), S, [
      "dấu côn",
      "liệt côn bạo",
      "xé rách",
    ]);
  });

  it("277 Thiên Viêm Hồ: ra đòn trước để lại Tàn Ảnh, chiêu Hỏa kế được cộng", () => {
    const S = 277;
    const me = () => pet(S, { skills: s("Hỏa trảo"), stats: { ...FAST, ...TANK } });
    has(duel([me()], [hitter()], [0, 0]), S, ["tàn ảnh", "tàn ảnh +%"]);
    has(double([me(), mate()], [hitter(), hitter()], rounds(2)), S, ["tàn ảnh", "tàn ảnh +%"]);
  });

  it("278 Tàn Nguyệt Long Ma: Huyết Nguyệt khiên, cộng đòn hút máu; vỡ khiên thì Thạch Hóa", () => {
    const S = 278;
    const me = (stats = {}) =>
      pet(S, { skills: s("Ảnh thứ"), hpPct: 31, stats: { ...SLOW, ...stats } });
    has(duel([me()], [bruiser()], [0, 0]), S, ["huyết nguyệt", "huyết nguyệt +%", "hút huyết"]);
    const two = double([me(), mate()], [bruiser(), bruiser()], rounds(2));
    has(two, S, ["huyết nguyệt", "lan huyết"]);
    // Hai đối thủ mạnh dồn phá khiên 140% trong 3 lượt: Long Ma bị Thạch Hóa.
    const heavy = () => pet(34, { skills: [30], stats: { speed: 9999, hp: 99999, attack: 2000 } });
    const pet40 = pet(S, { skills: s("Ảnh thứ"), hpPct: 40, stats: SLOW });
    has(double([pet40, mate()], [heavy(), heavy()], rounds(3)), S, [
      "huyết nguyệt",
      "vỡ khiên thạch hóa",
    ]);
  });

  it("279 Huyền Thiết Tán Cô: ô thép đỡ đòn đầu mỗi lượt và dội lại; rút bằng chiêu đổi pet cho khiên", () => {
    const S = 279;
    const me = (stats = {}) =>
      pet(S, { skills: s("Diệp Toàn"), stats: { ...SLOW, ...TANK, ...stats } });
    const one = duel([me()], [bruiser()], [0, 0]);
    expect(one.procs(S).filter((l) => l === "ô thép").length).toBe(2);
    expect(one.procs(S).filter((l) => l === "ô dội").length).toBe(2);
    hitsOn(one, S, "ô dội", 34);
    const pivot = pet(S, {
      skills: s("Thiết Tán Hồi Chuyển · Chuyển"),
      stats: { ...FAST, ...TANK },
    });
    const swap = duel([pivot, mate()], [slowDummy()], [0]);
    hitsOn(swap, S, "khiên ô thép", 68);
    const next = unitOf(swap, 68);
    expect(next.shieldHp()).toBeGreaterThanOrEqual(Math.trunc(next.maxHp() / 4) - 1);
    // 2v2: ô dùng chung cho cả phe, mỗi lượt một lần; đồng đội bị đánh cũng được đỡ và dội.
    const two = double([me(LOW_ATK), bait()], [bruiser(), bruiser()], rounds(2));
    hitsOn(two, S, "ô thép đồng đội", 68);
    expect(two.procs(S)).toContain("ô dội");
    for (const n of perRound(two, S, ["ô thép", "ô thép đồng đội"])) expect(n).toBe(1);
  });
});

describe("kịch bản đặc tính phần 7: một mô tả duy nhất", () => {
  it("pet 240..279 chỉ có một mô tả, mọi số trong mô tả đều lấy từ params", () => {
    for (let id = 240; id <= 279; id++) {
      const script = PART_7[id];
      expect(script, `kịch bản ${id}`).toBeDefined();
      expect(script.text2v2, `text2v2 ${id}`).toBeUndefined();
      expect(script.text, `text ${id}`).not.toMatch(/1v1|2v2/i);
      expect(renderTraitText(id, script), `render ${id}`).not.toMatch(/[{}]/);
    }
  });
});
