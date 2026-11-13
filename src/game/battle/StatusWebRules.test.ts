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
const { BUFF_BANK, DEBUFF_BANK, RAINBOW_BANK } = await import("./StatusState");
const { resolveP7Strike } = await import("./P7Strike");
const { resolveP7PostSkill } = await import("./P7PostSkill");
const { BattleRandom } = await import("./BattleRandom");
type StatusUnit = import("./StatusState").StatusUnit;

const data = new GameData(await Pack.load());
const [web, java] = await Promise.all([
  loadBattleRules(data),
  loadBattleRules(data, { web: false }),
]);
const rules = web.web!;
const effects = web.status;

/**
 * Two plain units on opposite sides. A plain StatusUnit carries no characteristic, so nothing else
 * moves; the species stays under 255 because Thực Loại packs its planter's species in one byte.
 */
function pair() {
  const make = (side: number) =>
    effects.unit({
      speciesId: 68,
      ownerSide: side,
      formationSlot: 0,
      base: { hp: 1000, attack: 200, defense: 60, speed: 100 },
    });
  return { a: make(0), b: make(1) };
}

/** Plant a Liệt Hỏa debuff through its own producer skill, the way a hit does. */
function debuff(source: StatusUnit, target: StatusUnit, skillId: number, debuffId: number) {
  effects.pendingDebuffFromProducer(source, target, skillId, debuffId)!.commit();
}

/** No crit, no jitter flip, every chance gate fails unless a test says otherwise. */
const noLuck = () => 99;

function hit(
  calculator: typeof web.damage,
  attacker: StatusUnit,
  target: StatusUnit,
  skillId: number,
) {
  const side = (unit: StatusUnit) => ({
    speciesId: unit.speciesId,
    attack: unit.currentStats.attack,
    defense: unit.currentStats.defense,
    visualSpriteId: -1,
    unit,
  });
  return calculator.damage({
    attacker: side(attacker),
    target: side(target),
    skillId,
    randomPercent: noLuck,
  });
}

describe("round passes count statuses down and do their per-round work", () => {
  it("Gieo Hạt: 3% max HP at the start of each of the owner's 3 turns, then it is gone", () => {
    const { a, b } = pair();
    debuff(a, b, 1, 0);
    for (let turn = 1; turn <= 3; turn++) {
      expect(b.hasDebuff(0)).toBe(true);
      expect(rules.ownerTurnStart(b).damage).toBe(30);
    }
    expect(b.hasDebuff(0)).toBe(false);
    expect(b.hp()).toBe(910);
  });

  it("Khôi phục: 8% at once, then 7% at the end of each of 3 turns", () => {
    const { a } = pair();
    a.setHp(500);
    expect(effects.applySourceBuff(a, 3, 15)).toBe(80);
    for (let turn = 1; turn <= 3; turn++) expect(rules.ownerTurnEnd(a).heal).toBe(70);
    expect(a.hasBuff(3)).toBe(false);
    expect(a.hp()).toBe(790);
  });

  it("a Liệt Hỏa buff with a duration expires (Phá Phủ, 3 turns)", () => {
    const { a } = pair();
    effects.applySourceBuff(a, 1, 5);
    for (let turn = 1; turn <= 3; turn++) {
      expect(a.hasBuff(1)).toBe(true);
      rules.ownerTurnStart(a);
    }
    expect(a.hasBuff(1)).toBe(false);
  });

  it("Thực Loại: after 2 turns the frozen hit lands and the planter heals", () => {
    const { a, b } = pair();
    a.setHp(500);
    debuff(a, b, 13, 3);
    const resolver = (side: number) => (side === 0 ? a : b);
    expect(rules.ownerTurnStart(b, resolver).damage).toBe(0);
    const bite = rules.ownerTurnStart(b, resolver).damage;
    expect(bite).toBeGreaterThan(0);
    expect(b.hasDebuff(3)).toBe(false);
    expect(a.hp()).toBe(580);
  });

  it("Hủ Thực: 3%, 6%, 9% of max HP, then it is gone", () => {
    const { b } = pair();
    rules.applyRainbowDebuff(b, 5, { turns: 3 });
    expect([1, 2, 3].map(() => rules.ownerTurnStart(b).damage)).toEqual([30, 60, 90]);
    expect(b.statuses.has(RAINBOW_BANK, 5)).toBe(false);
  });

  it("Thạch Hóa clears a Cầu Vồng debuff too, then heals 5% at each turn end", () => {
    const { a } = pair();
    a.setHp(500);
    rules.applyRainbowDebuff(a, 4, { turns: 2, primary: 15 });
    effects.applySourceBuff(a, 13, 24);
    expect(a.statuses.has(RAINBOW_BANK, 4)).toBe(false);
    expect(rules.ownerTurnEnd(a).heal).toBe(50);
  });
});

describe("damage", () => {
  it("Súc Lực never lowers a hit: a 195-Power skill keeps its own Power", () => {
    const plain = pair(),
      buffed = pair();
    effects.applySourceBuff(buffed.a, 0, 4);
    const base = hit(web.damage, plain.a, plain.b, 9).damage,
      withBuff = hit(web.damage, buffed.a, buffed.b, 9).damage;
    expect(withBuff).toBe(base);
    expect(buffed.a.hasBuff(0)).toBe(false);
    // The Java formula replaces the hit with raw × 190%, which is lower for this skill.
    const javaPair = pair();
    effects.applySourceBuff(javaPair.a, 0, 4);
    expect(hit(java.damage, javaPair.a, javaPair.b, 9).damage).toBeLessThan(base);
  });

  it("Súc Lực lifts a weaker skill to 190% Power", () => {
    const plain = pair(),
      buffed = pair();
    effects.applySourceBuff(buffed.a, 0, 4);
    const base = hit(web.damage, plain.a, plain.b, 6).damage,
      withBuff = hit(web.damage, buffed.a, buffed.b, 6).damage;
    expect(withBuff).toBeGreaterThan(base);
  });

  it("skill 7 detonates the Gieo Hạt ticks still to come and clears it", () => {
    const { a, b } = pair();
    debuff(a, b, 1, 0);
    const outcome = hit(web.damage, a, b, 7);
    expect(outcome.supplementalDamage).toBe(90);
    outcome.pendingDebuff!.commit();
    expect(b.hasDebuff(0)).toBe(false);
    // The Java-parity formula still refuses the case it never graded.
    const j = pair();
    debuff(j.a, j.b, 1, 0);
    expect(() => hit(java.damage, j.a, j.b, 7)).toThrow(/detonates/);
  });

  it("Gia Tốc: the next two damaging skills hit again at 60% Power, then it is gone", () => {
    const { a, b } = pair();
    effects.applySourceBuff(a, 12, 65);
    const first = hit(web.damage, a, b, 6);
    expect(first.followUpDamage).toBeGreaterThan(0);
    expect(effects.buffRemainingActions(a, 12)).toBe(1);
    expect(hit(web.damage, a, b, 6).followUpDamage).toBeGreaterThan(0);
    expect(a.hasBuff(12)).toBe(false);
    expect(hit(web.damage, a, b, 6).followUpDamage).toBe(0);
  });

  it("Mị Hoặc takes 15% off the damage its owner deals; Hóa Đá 30% off the damage taken", () => {
    const base = hit(web.damage, pair().a, pair().b, 6).damage;
    const charmed = pair();
    rules.applyRainbowDebuff(charmed.a, 3, { turns: 2 });
    // Within a point: the percent lands before the type relation rounds.
    expect(
      Math.abs(hit(web.damage, charmed.a, charmed.b, 6).damage - base * 0.85),
    ).toBeLessThanOrEqual(1);
    const stone = pair();
    rules.applyRainbowDebuff(stone.b, 0, { turns: 1 });
    expect(Math.abs(hit(web.damage, stone.a, stone.b, 6).damage - base * 0.7)).toBeLessThanOrEqual(
      1,
    );
  });

  it("skills that read a status clear it, and the buff strippers strip one", () => {
    const { a, b } = pair();
    debuff(a, b, 1, 0);
    web.damage.afterHitStatusEffects(9, b);
    expect(b.hasDebuff(0)).toBe(false);
    effects.applySourceBuff(b, 1, 5);
    effects.applySourceBuff(b, 7, 42);
    expect(web.damage.afterHitStatusEffects(43, b)).toEqual(["Phá Phủ"]);
    expect(b.activeStatusIds(BUFF_BANK)).toEqual([7]);
  });
});

describe("actions", () => {
  it("Hóa Đá and Ngủ take the owner's next action and are spent by it", () => {
    for (const id of [0, 8]) {
      const { a } = pair();
      rules.applyRainbowDebuff(a, id, { turns: 1 });
      expect(rules.beforeAction(a, noLuck).blocked).toBe(true);
      expect(a.statuses.has(RAINBOW_BANK, id)).toBe(false);
      expect(rules.beforeAction(a, noLuck).blocked).toBe(false);
    }
  });

  it("Ngủ: a direct hit wakes the sleeper", () => {
    const { a } = pair();
    rules.applyRainbowDebuff(a, 8, { turns: 1 });
    expect(rules.wakeOnDirectDamage(a)).toBe(true);
    expect(a.statuses.has(RAINBOW_BANK, 8)).toBe(false);
  });

  it("Tê Liệt loses the action on a roll under 25", () => {
    const { a, b } = pair();
    debuff(a, b, 41, 10);
    expect(rules.beforeAction(b, () => 24)).toEqual({ blocked: true, status: "Tê Liệt" });
    expect(rules.beforeAction(b, () => 25)).toEqual({ blocked: false });
    expect(b.hasDebuff(10)).toBe(true);
  });

  it("Quỷ Mị turns a damaging skill on its user on a roll under 40, and is spent", () => {
    const { a, b } = pair();
    debuff(a, b, 54, 8);
    const usable = [
      { index: 0, damaging: true },
      { index: 1, damaging: false },
    ];
    expect(rules.controlAction(b, 0, usable, () => 39)).toEqual({
      skillIndex: 0,
      selfHit: true,
      spent: "Quỷ Mị",
    });
    expect(b.hasDebuff(8)).toBe(false);
  });

  it("Hỗn Loạn swaps the skill for a random usable one and may turn it on its user", () => {
    const { a, b } = pair();
    debuff(a, b, 55, 9);
    const usable = [
      { index: 0, damaging: true },
      { index: 2, damaging: true },
    ];
    const decision = rules.controlAction(b, 0, usable, (label) =>
      label === "status.honLoan.skill" ? 75 : 10,
    );
    expect(decision).toEqual({ skillIndex: 2, selfHit: true, spent: "Hỗn Loạn" });
    expect(b.hasDebuff(9)).toBe(false);
  });

  it("Điện áp makes each skill cost 2 PP; Giam Cầm locks pets and items", () => {
    const { a } = pair();
    expect(rules.ppCost(a)).toBe(1);
    effects.applySourceBuff(a, 8, 44);
    expect(rules.ppCost(a)).toBe(2);
    expect(rules.switchAndItemsLocked(a)).toBe(false);
    rules.applyRainbowDebuff(a, 4, { turns: 2, primary: 15 });
    expect(rules.switchAndItemsLocked(a)).toBe(true);
  });

  it("Phong Bế (2/6) is in the catalog and shuts tiers 2 and 3 only", () => {
    expect(effects.catalog.definition(RAINBOW_BANK, 6)).toMatchObject({
      displayName: "Phong Bế",
      tickPhase: "ACTIVE_OWNER_ROUND",
    });
    const { a: locked } = pair();
    rules.applyRainbowDebuff(locked, 6, { turns: 2, primary: 1 });
    expect([1, 2, 3, 4].map((tier) => locked.canUseSkillTier(tier))).toEqual([
      true,
      false,
      false,
      true,
    ]);
    expect(effects.catalog.definition(DEBUFF_BANK, 10)?.displayName).toBe("Tê Liệt");
  });
});

describe("Vô hình (Thuật cầu nguyện)", () => {
  /** Every roll answers `value`; crit and jitter stay off and every hit lands. */
  class FixedRandom extends BattleRandom {
    constructor(private readonly value: number) {
      super();
    }
    override percent(label: string): number {
      return /crit|jitter|hitroll/.test(label) ? 99 : this.value;
    }
  }
  const strike = (attacker: StatusUnit, receiver: StatusUnit, skillId: number, roll: number) =>
    resolveP7Strike({
      attacker,
      receiver,
      skillId,
      rules: web,
      random: new FixedRandom(roll),
      attackerSpriteId: -2,
      receiverSpriteId: -2,
      allowsHpFloor: false,
      postSkill: resolveP7PostSkill,
    });

  it("on its 30% the whole hit goes back: the holder takes nothing, the attacker takes it all", () => {
    const { a, b } = pair();
    effects.applySourceBuff(b, 5, 34);
    strike(a, b, 41, 0);
    expect(b.hp()).toBe(1000);
    // Tê Liệt was bounced with the hit, not planted on the holder.
    expect(b.hasDebuff(10)).toBe(false);
    expect(a.hp()).toBe(1000 - 133);
  });

  it("the bounced hit is graded against the attacker's own defense", () => {
    const { b } = pair();
    // Attack 200 against the holder's 60 is a 140 blow; against its own 100 the same blow is 100.
    const a = effects.unit({
      speciesId: 68,
      ownerSide: 0,
      formationSlot: 0,
      base: { hp: 1000, attack: 200, defense: 100, speed: 100 },
    });
    effects.applySourceBuff(b, 5, 34);
    strike(a, b, 6, 0);
    expect(b.hp()).toBe(1000);
    expect(a.hp()).toBe(1000 - Math.trunc((217 * 100) / 140));
  });

  it("the bounced hit is an attack on the attacker: it wakes a sleeper and Hóa Đá softens it", () => {
    const { a, b } = pair();
    effects.applySourceBuff(b, 5, 34);
    rules.applyRainbowDebuff(a, 8, { turns: 1 });
    rules.applyRainbowDebuff(a, 0, { turns: 1 });
    strike(a, b, 6, 0);
    expect(a.statuses.has(RAINBOW_BANK, 8)).toBe(false);
    expect(Math.abs(1000 - a.hp() - Math.trunc(217 * 0.7))).toBeLessThanOrEqual(2);
  });

  it("off its chance the hit lands normally and nothing comes back", () => {
    const { a, b } = pair();
    effects.applySourceBuff(b, 5, 34);
    strike(a, b, 0, 99);
    expect(b.hp()).toBe(1000 - 140);
    expect(a.hp()).toBe(1000);
  });
});

describe("Liệt Hỏa heals and extra hits follow their descriptions", () => {
  class FixedRandom extends BattleRandom {
    constructor(private readonly value: number) {
      super();
    }
    override percent(label: string): number {
      return /crit|jitter|hitroll/.test(label) ? 99 : this.value;
    }
  }
  /** One strike at `roll`; the attacker starts at 500/1000 HP. Returns what it healed and dealt. */
  const strike = (skillId: number, roll: number) => {
    const { a, b } = pair();
    a.setHp(500);
    resolveP7Strike({
      attacker: a,
      receiver: b,
      skillId,
      rules: web,
      random: new FixedRandom(roll),
      attackerSpriteId: -2,
      receiverSpriteId: -2,
      allowsHpFloor: false,
      postSkill: resolveP7PostSkill,
    });
    return { healed: a.hp() - 500, dealt: 1000 - b.hp() };
  };

  it("Quang phản and Diệp chi ân huệ heal 35% / 50% of the damage dealt", () => {
    expect(strike(11, 99)).toEqual({ healed: 44, dealt: 126 });
    expect(strike(17, 99)).toEqual({ healed: 87, dealt: 175 });
  });

  it("the heal stops at its share of max HP", () => {
    // A 300-attack Diệp chi ân huệ deals 300; half of it is over the 12% (120) ceiling.
    const a = effects.unit({
        speciesId: 68,
        ownerSide: 0,
        formationSlot: 0,
        base: { hp: 1000, attack: 300, defense: 60, speed: 100 },
      }),
      { b } = pair();
    a.setHp(500);
    resolveP7Strike({
      attacker: a,
      receiver: b,
      skillId: 17,
      rules: web,
      random: new FixedRandom(99),
      attackerSpriteId: -2,
      receiverSpriteId: -2,
      allowsHpFloor: false,
      postSkill: resolveP7PostSkill,
    });
    expect(a.hp()).toBe(620);
  });

  it("Quỷ độc heals 10% of max HP on a roll under 25", () => {
    expect(strike(52, 24).healed).toBe(100);
    expect(strike(52, 25).healed).toBe(0);
  });

  it("Quỷ độc tín ngưỡng always heals 35% of the damage dealt", () => {
    expect(strike(58, 99)).toEqual({ healed: 61, dealt: 175 });
    expect(strike(58, 0).healed).toBe(61);
  });

  it("Long quyển: on a roll under 20, one more hit at 50% of its Power", () => {
    expect(strike(63, 19).dealt).toBe(147 + 73);
    expect(strike(63, 20).dealt).toBe(147);
  });

  it("Phi Yến Hoàn Sào: on a roll under 35, one more hit at 70% of its Power", () => {
    expect(strike(69, 34).dealt).toBe(217 + 151);
    expect(strike(69, 35).dealt).toBe(217);
  });
});
