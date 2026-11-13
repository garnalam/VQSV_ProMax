import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(
    import.meta.dirname,
    "../../../public",
    decodeURIComponent(String(input).split("?")[0].replace(/^\//, "")),
  );
  if (!existsSync(file)) return { ok: false, status: 404 };
  const bytes = readFileSync(file);
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(bytes.toString("utf8")),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
  };
});

const { GameData } = await import("../../data/GameData");
const { Pack } = await import("../../pack/Pack");
const { loadBattleRules } = await import("./BattleRules");
const { resolveP7Strike } = await import("./P7Strike");
const { resolveP7PostSkill } = await import("./P7PostSkill");
const { BattleRandom } = await import("./BattleRandom");
const { BUFF_BANK, DEBUFF_BANK, RAINBOW_BANK } = await import("./StatusState");
type StatusUnit = import("./StatusState").StatusUnit;

const data = new GameData(await Pack.load());
const rules = await loadBattleRules(data);
const effects = rules.status,
  web = rules.web!;

/** Every roll answers `value`; crit and jitter stay off and every hit lands. */
class FixedRandom extends BattleRandom {
  constructor(private readonly value: number) {
    super();
  }
  override percent(label: string): number {
    return /crit|jitter|hitroll/.test(label) ? 99 : this.value;
  }
}

/** Attack 200 into defense 60: a 100-Power hit is 140. */
/**
 * The power checks run element-neutral: a unified skill attacks with its own element family
 * (`relationTo(target, skill)`), so the test pets carry a species id outside the element chart —
 * no element on either side, no relation multiplier — and every hit reads its Power directly.
 */
const NEUTRAL_SPECIES = -1;
function unit(side: number, base: Partial<{ speed: number }> = {}) {
  return effects.unit({
    speciesId: NEUTRAL_SPECIES,
    ownerSide: side,
    formationSlot: 0,
    base: { hp: 1000, attack: 200, defense: 60, speed: 100, ...base },
  });
}

function strike(attacker: StatusUnit, receiver: StatusUnit, skillId: number, roll = 0) {
  return resolveP7Strike({
    attacker,
    receiver,
    skillId,
    rules,
    random: new FixedRandom(roll),
    attackerSpriteId: -2,
    receiverSpriteId: -2,
    allowsHpFloor: false,
    postSkill: resolveP7PostSkill,
  });
}

/** A fresh pair, the user at 500/1000 HP. */
function hit(skillId: number, prep?: (a: StatusUnit, b: StatusUnit) => void, roll = 0) {
  const a = unit(0),
    b = unit(1);
  a.setHp(500);
  prep?.(a, b);
  const before = b.hp(),
    trace = strike(a, b, skillId, roll);
  return { a, b, dealt: before - b.hp(), healed: a.hp() - 500, trace };
}

/** Hủ Thực planted fresh on `b`, the way a Cầu Vồng skill plants it. */
const corrode = (_: StatusUnit, b: StatusUnit) => web.applyRainbowDebuff(b, 5, { turns: 3 });
const bleed = (_: StatusUnit, b: StatusUnit) =>
  web.applyRainbowDebuff(b, 7, { turns: 2, primary: 4 });

describe("Cầu Vồng skills are usable under the web rules", () => {
  it("every CV-SKILL row resolves; the Java-parity formula still refuses them", async () => {
    const skills = (await data.skills()).filter((row) => row.stableKey.startsWith("CV-SKILL-"));
    expect(skills.length).toBe(33);
    for (const skill of skills)
      expect(web.skillUsable(rules.damage.skillRow(skill.runtimeId), unit(0))).toBe(true);
    const java = await loadBattleRules(data, { web: false });
    expect(() =>
      resolveP7Strike({
        attacker: unit(0),
        receiver: unit(1),
        skillId: 70,
        rules: java,
        random: new FixedRandom(0),
        attackerSpriteId: -2,
        receiverSpriteId: -2,
        allowsHpFloor: false,
      }),
    ).toThrow(/unified-v5/);
  });
});

describe("Hủ Thực family (Mộc)", () => {
  it("Mạn Độc Triền Sinh: 60 Power and a sure Hủ Thực that bites 3%, 6%, 9%", () => {
    const { b, dealt } = hit(70);
    expect(dealt).toBe(84);
    expect([1, 2, 3].map(() => web.ownerTurnStart(b).damage)).toEqual([30, 60, 90]);
    expect(b.statuses.has(RAINBOW_BANK, 5)).toBe(false);
  });

  it("Phấn Linh Xuyên Diệp: on a corroded target, heal 35% (≤8%) and DEF +10%; else 30% Hủ Thực", () => {
    const fed = hit(71, corrode);
    expect(fed.dealt).toBe(126);
    expect(fed.healed).toBe(44);
    expect(fed.a.currentStats.defense).toBe(66);
    expect(hit(71, undefined, 29).b.statuses.has(RAINBOW_BANK, 5)).toBe(true);
    expect(hit(71, undefined, 30).b.statuses.has(RAINBOW_BANK, 5)).toBe(false);
  });

  it("Bạo Chủng Liên Thứ: every bite left lands now (18%), the user heals half (≤12%), −15% damage", () => {
    const { b, dealt, healed } = hit(72, corrode);
    expect(dealt).toBe(154 + 180);
    expect(healed).toBe(90);
    expect(b.statuses.has(RAINBOW_BANK, 5)).toBe(false);
    expect(b.statuses.get(DEBUFF_BANK, 6)!.primaryValue).toBe(15);
    // Nothing to detonate: only the hit, no heal, no debuff.
    const dry = hit(72);
    expect([dry.dealt, dry.healed, dry.b.hasDebuff(6)]).toEqual([154, 0, false]);
  });

  it("Diệp Nhẫn Cuồng Lam: a corroded target loses 20% DEF to the hit and 15% DEF after it", () => {
    expect(hit(73).dealt).toBe(196);
    const { b, dealt } = hit(73, corrode);
    expect(dealt).toBe(212);
    expect(b.currentStats.defense).toBe(51);
    expect(b.statuses.has(RAINBOW_BANK, 5)).toBe(true);
  });

  it("Vạn Mộc Tận Thực: Hủ Thực whose first bite lands now, half back to the user, −20% dmg −15% Linh xảo", () => {
    const { b, dealt, healed } = hit(74);
    expect(dealt).toBe(238 + 30);
    expect(healed).toBe(15);
    expect(b.statuses.get(DEBUFF_BANK, 6)!.primaryValue).toBe(20);
    expect(b.currentStats.speed).toBe(85);
    expect([web.ownerTurnStart(b).damage, web.ownerTurnStart(b).damage]).toEqual([60, 90]);
  });
});

describe("the fight's projection of the supplemental damage (Long Ấn)", () => {
  /** `commitUnifiedAfterDamage(hit, dealt, heal, longAn::project)` on a repeated skill: 70%. */
  const longAn = (amount: number) => Math.trunc((Math.max(0, amount) * 70) / 100);
  const heal = {
    project: (_: StatusUnit, __: StatusUnit, amount: number) => amount,
    commit: (_: StatusUnit, receiver: StatusUnit, amount: number) => {
      receiver.setHp(receiver.hp() + amount);
      return amount;
    },
    afterHealing: () => {},
  };
  function afterHit(skillId: number, prep?: (a: StatusUnit, b: StatusUnit) => void) {
    const a = unit(0),
      b = unit(1);
    a.setHp(500);
    prep?.(a, b);
    const before = b.hp(),
      healed = web
        .unifiedStrike(a, b, skillId, false, () => 0)!
        .afterDamage(true, 0, () => 0, heal, longAn);
    return { lost: before - b.hp(), healed };
  }

  it("Bạo Chủng Liên Thứ's detonation lands at 70%, and the heal follows what it took", () => {
    // 18% of 1000 is 180 without the projection; 126 with it, half of which comes back.
    expect(afterHit(72, corrode)).toEqual({ lost: 126, healed: 63 });
  });

  it("Vạn Mộc Tận Thực's first bite lands at 70%", () => {
    // The 3% bite (30) is cut to 21; half of it heals the user.
    expect(afterHit(74)).toEqual({ lost: 21, healed: 10 });
  });
});

describe("Hóa Đá, Giam Cầm, Ngủ", () => {
  it("Nham Chùy Khai Giáp: 70% Hóa Đá, which takes the next action", () => {
    const { b } = hit(75, undefined, 69);
    expect(web.beforeAction(b, () => 99)).toEqual({ blocked: true, status: "Hóa Đá" });
    expect(hit(75, undefined, 70).b.statuses.has(RAINBOW_BANK, 0)).toBe(false);
  });

  it("Bá Kim Trảm Địa does not refresh a Hóa Đá already standing", () => {
    const { b } = hit(79, (_, target) => {
      web.applyRainbowDebuff(target, 0, { turns: 1, primary: 30 });
      target.statuses.get(RAINBOW_BANK, 0)!.secondaryValue = 7;
    });
    expect(b.statuses.get(RAINBOW_BANK, 0)!.secondaryValue).toBe(7);
  });

  it("Long Quyển Phong Tỏa: a sure Giam Cầm for 2 turns", () => {
    const { b } = hit(81);
    expect(b.statuses.get(RAINBOW_BANK, 4)!.remainingTurns).toBe(2);
    expect(web.switchAndItemsLocked(b)).toBe(true);
  });

  it("Thiên Lôi Thịnh Nộ: Giam Cầm on 25%, 40% when it moves first", () => {
    const slow = (roll: number) => {
      const a = unit(0, { speed: 80 }),
        b = unit(1);
      strike(a, b, 84, roll);
      return b.statuses.has(RAINBOW_BANK, 4);
    };
    const fast = (roll: number) => {
      const a = unit(0, { speed: 120 }),
        b = unit(1);
      strike(a, b, 84, roll);
      return b.statuses.has(RAINBOW_BANK, 4);
    };
    expect([slow(24), slow(25), fast(39), fast(40)]).toEqual([true, false, true, false]);
  });

  it("Miên Ca Lam Mộng: no damage, 70% Ngủ for one action", () => {
    const { b, dealt } = hit(100, undefined, 69);
    expect(dealt).toBe(0);
    expect(b.statuses.has(RAINBOW_BANK, 8)).toBe(true);
    expect(hit(100, undefined, 70).b.statuses.has(RAINBOW_BANK, 8)).toBe(false);
  });
});

describe("DEF layers and pierce (Thổ, Điện)", () => {
  it("Thiết Phật Trấn Sơn: +7% DEF per hit, 3 layers at most", () => {
    const a = unit(0),
      b = unit(1);
    for (let i = 0; i < 4; i++) strike(a, b, 76);
    expect(a.currentStats.defense).toBe(72);
    expect(a.statuses.get(BUFF_BANK, 4)!.stackCount).toBe(3);
  });

  it("Lôi Thiết Bạo Vũ: +20 Power per layer it consumes", () => {
    const { a, dealt } = hit(77, (user, target) => {
      for (let i = 0; i < 3; i++) strike(user, target, 76);
    });
    expect(a.hasBuff(4)).toBe(false);
    expect(dealt).toBe(238);
    expect(hit(77).dealt).toBe(154);
  });

  it("Toản Tinh Liệt Phá ignores 25% DEF", () => {
    expect(hit(78).dealt).toBe(209);
  });
});

describe("Phong", () => {
  it("Phi Vũ Đoạn Không: Power 110 when it moves first, 95 otherwise", () => {
    const fast = unit(0, { speed: 120 }),
      slow = unit(0, { speed: 80 }),
      b1 = unit(1),
      b2 = unit(1);
    strike(fast, b1, 80);
    strike(slow, b2, 80);
    expect([1000 - b1.hp(), 1000 - b2.hp()]).toEqual([154, 133]);
  });

  it("Tật Phong Trụy Không: Linh xảo +15% for 2 turns, no stacking", () => {
    const a = unit(0),
      b = unit(1);
    strike(a, b, 82);
    strike(a, b, 82);
    expect(a.currentStats.speed).toBe(115);
  });

  it("Thánh Dực Xá Tội: clears one debuff on the user", () => {
    const { a } = hit(83, (user, target) => {
      effects.pendingDebuffFromProducer(target, user, 1, 0)!.commit();
      effects.pendingDebuffFromProducer(target, user, 2, 1)!.commit();
    });
    expect(a.activeStatusIds(DEBUFF_BANK)).toEqual([1]);
  });
});

describe("Xé Rách family (Thổ, Điện, Hỏa)", () => {
  it("Nham Nha Phệ Cốt 25% and Liệt Trảo Xé Gió 35% Xé Rách, 4% max HP for 2 turns", () => {
    expect(hit(85, undefined, 24).b.statuses.get(RAINBOW_BANK, 7)!.primaryValue).toBe(4);
    expect(hit(85, undefined, 25).b.statuses.has(RAINBOW_BANK, 7)).toBe(false);
    expect(hit(86, undefined, 34).b.statuses.has(RAINBOW_BANK, 7)).toBe(true);
    const { b } = hit(86, undefined, 0);
    expect(b.tickVqsv4BleedingRoundEnd()).toBe(40);
  });

  it("Huyết Nộ Cuồng Thú: 145 into a bleeding target, which keeps bleeding", () => {
    expect(hit(87).dealt).toBe(154);
    const { b, dealt } = hit(87, bleed);
    expect(dealt).toBe(203);
    expect(b.statuses.has(RAINBOW_BANK, 7)).toBe(true);
  });

  it("Bạo Thú Xung Thiên: 185 into a bleeding target, then the bleed is gone", () => {
    const { b, dealt } = hit(88, bleed);
    expect(dealt).toBe(259);
    expect(b.statuses.has(RAINBOW_BANK, 7)).toBe(false);
  });

  it("Vạn Thú Chấn Hống: 190 when the user is under 35% HP; 30% Xé Rách", () => {
    expect(hit(89, undefined, 30).dealt).toBe(224);
    expect(hit(89, (a) => a.setHp(340), 30).dealt).toBe(266);
    expect(hit(89, undefined, 29).b.statuses.has(RAINBOW_BANK, 7)).toBe(true);
  });
});

describe("Quỷ", () => {
  it("Phệ Hồn Ấn 25% / Địa Ngục Viêm 60% Mị Hoặc, which cuts the target's damage by 15%", () => {
    expect(hit(90, undefined, 24).b.statuses.get(RAINBOW_BANK, 3)!.remainingTurns).toBe(3);
    expect(hit(90, undefined, 25).b.statuses.has(RAINBOW_BANK, 3)).toBe(false);
    const { b } = hit(92, undefined, 59);
    expect(b.statuses.get(RAINBOW_BANK, 3)!.remainingTurns).toBe(2);
    expect(web.damageDealtPercent(b)).toBe(-15);
  });

  it("U Minh Triều gives back 1 PP on 25%", () => {
    const refunded = hit(91, undefined, 24).trace,
      kept = hit(91, undefined, 25).trace;
    expect(!refunded.zeroPower && refunded.unifiedPp).toEqual({ refund: 1, exhaust: false });
    expect(!kept.zeroPower && kept.unifiedPp).toEqual({ refund: 0, exhaust: false });
  });

  it("Hắc Luật Phán Quyết and Huyết Viêm Đoạt Mệnh heal 30% (≤10%) / 35% (≤12%) of the damage", () => {
    expect([hit(93).dealt, hit(93).healed]).toEqual([203, 60]);
    expect([hit(134).dealt, hit(134).healed]).toEqual([168, 58]);
  });

  it("Ma Thần Giáng Thế: 220 into a charmed target, then the charm is gone", () => {
    const { b, dealt } = hit(94, (_, target) => web.applyRainbowDebuff(target, 3, { turns: 2 }));
    expect(dealt).toBe(308);
    expect(b.statuses.has(RAINBOW_BANK, 3)).toBe(false);
    expect(hit(94).dealt).toBe(259);
  });

  it("Tử Thần Xúc Ấn: 250 Power, then every skill's PP goes to zero", () => {
    const { trace, dealt } = hit(135);
    expect(dealt).toBe(350);
    expect(!trace.zeroPower && trace.unifiedPp?.exhaust).toBe(true);
  });
});

describe("Thủy heals and the plain hits", () => {
  it("Thủy Linh Hồi Sinh / Lam Tuyền Chữa Lành / Hải Tâm Tái Tạo heal 20% / 35% / 50%", () => {
    const heal = (id: number) => {
      const a = unit(0);
      a.setHp(300);
      strike(a, a, id);
      return a.hp() - 300;
    };
    expect([heal(96), heal(97), heal(98)]).toEqual([200, 350, 500]);
  });

  it("Địa Mạch Kích hits at 80; Thiên Quang Phán Thủ rolls its Power between 75 and 155", () => {
    expect(hit(95).dealt).toBe(112);
    expect(hit(99, undefined, 0).dealt).toBe(105);
    expect(hit(99, undefined, 99).dealt).toBe(217);
  });
});
