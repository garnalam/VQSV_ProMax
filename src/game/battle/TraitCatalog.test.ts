import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Every characteristic in the balance workbook (`balance/pet-design-traits.json`), one mechanic family
 * at a time: the numbers its description names, the value the fight is built with and what a live
 * strike measures must all agree. A family's block lists every pet that disagrees.
 */
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
type DesignTraitUnit = import("./DesignTraits").DesignTraitUnit;
type Balance = import("../../data/GameData").PackDesignTraitBalance;
type Projection = import("./DesignTraitProjection").DesignTraitProjection;

const data = new GameData(await Pack.load());
const rules = await loadBattleRules(data);
const balance = (await data.designTraitBalance()).traits;
const records = await data.petDesignSkills();
const await_talents = await data.physicalTraits();
const element = new Map(
  (await data.species()).rows.map((row) => [row.speciesId, row.element] as const),
);

/** Every roll answers `value`; crit and jitter stay off and every hit lands. */
class Rolls extends BattleRandom {
  constructor(private readonly value = 0) {
    super();
  }
  override percent(label: string): number {
    return /crit|jitter|hitroll/.test(label) ? 99 : this.value;
  }
}

/** A pet of `speciesId` on `side` with 1000 HP, 200 ATK, 60 DEF, 100 SPD, carrying its trait. */
function pet(side: number, speciesId: number, speed = 100, attack = 200): DesignTraitUnit {
  const made = rules.traits.unit({
    speciesId,
    ownerSide: side,
    formationSlot: side === 0 ? 1 : 0,
    base: { hp: 1000, attack, defense: 60, speed },
  });
  made.restoreStatsForCheck();
  return made;
}
/** One strike walked through the fight's trait projection, in round `round`. */
function strike(
  attacker: DesignTraitUnit,
  receiver: DesignTraitUnit,
  skillId: number,
  round = 1,
  roll = 0,
  options: {
    actedFirst?: boolean;
    projection?: Projection;
    random?: InstanceType<typeof BattleRandom>;
  } = {},
): number {
  const random = options.random ?? new Rolls(roll),
    before = receiver.hp();
  // The runtime writes the selected skill before the strike; the heal families read it.
  attacker.selectedSkillId = skillId;
  resolveP7Strike({
    attacker,
    receiver,
    skillId,
    rules,
    random,
    attackerSpriteId: -2,
    receiverSpriteId: -2,
    allowsHpFloor: false,
    postSkill: resolveP7PostSkill,
    trait: {
      projection: options.projection ?? rules.newTraitProjection((label) => random.percent(label)),
      attacker,
      receiver,
      attackerSlot: attacker.formationSlot,
      receiverSlot: receiver.formationSlot,
      roundIndex: round,
      actedFirst: options.actedFirst ?? true,
    },
  });
  return before - receiver.hp();
}
/** Species 68 (Điện Miêu, an Kiếm Khí-free target) is the neutral receiver. */
const TARGET = 68;
/** The plain Power-100 skill of a pet's own element, and a second one of the same element. */
const mainSkill = (speciesId: number) => element.get(speciesId)! * 10;
const otherSkill = (speciesId: number) => element.get(speciesId)! * 10 + 3;
/** Đằng chi bích lũy: a Power-0 self buff (Kinh Cức) that always lands and leaves damage alone. */
const UTILITY_SKILL = 14;
/** Đằng Phược: a damaging hit that plants a debuff. */
const DEBUFF_SKILL = 12;
const FAMILY_CHARGE = 17;
const family = (type: string) => balance.filter((trait) => trait.type === type);
const numbers = (trait: Balance, pattern: RegExp): number[] => {
  const match = pattern.exec(trait.description);
  if (!match) throw new Error(`${trait.key}: description does not read "${pattern}"`);
  return match.slice(1).map(Number);
};
/** Whether `boosted` is `plain` raised by `power` flat Power out of the skill's 100 (±2 rounding). */
const raisedBy = (plain: number, boosted: number, power: number) =>
  Math.abs(boosted - (plain * (100 + power)) / 100) <= 2;
/** A plain main-element hit from a fresh pet of `speciesId`, the baseline every bonus is read off. */
const plainHit = (speciesId: number) =>
  strike(pet(0, speciesId), pet(1, TARGET), mainSkill(speciesId));

describe("Power families (flat Power from the balance workbook)", () => {
  it("the fight is built with the workbook's value for every one of the 280 pets", () => {
    const wrong = balance.filter(
      (trait) => rules.traits.spec(pet(0, trait.speciesId))?.value !== trait.value,
    );
    expect(wrong.map((trait) => trait.key)).toEqual([]);
  });

  it("utility_next_power: a Power-0 skill marks the next damaging skill +X Power, once", () => {
    const pattern =
        /^Sau chiêu Power 0: chiêu damage kế tiếp \+(\d+) Power trong (\d+) lượt rồi xóa dấu, tối đa 1 dấu\. Không lặp để tích nhiều tầng\.$/,
      wrong: string[] = [];
    expect(family("utility_next_power").length).toBe(10);
    for (const trait of family("utility_next_power")) {
      const [power, turns] = numbers(trait, pattern);
      if (power !== trait.value || turns !== 2)
        wrong.push(`${trait.key}: described ${power}/${turns}`);
      const user = pet(0, trait.speciesId),
        plain = plainHit(trait.speciesId);
      strike(user, user, UTILITY_SKILL);
      strike(user, user, UTILITY_SKILL);
      if (user.statuses.get(0, FAMILY_CHARGE)?.stackCount !== 1)
        wrong.push(`${trait.key}: ${user.statuses.get(0, FAMILY_CHARGE)?.stackCount} marks`);
      const boosted = strike(user, pet(1, TARGET), mainSkill(trait.speciesId));
      if (!raisedBy(plain, boosted, power)) wrong.push(`${trait.key}: ${plain} → ${boosted}`);
      if (strike(user, pet(1, TARGET), mainSkill(trait.speciesId)) !== plain)
        wrong.push(`${trait.key}: the mark outlived its hit`);
    }
    expect(wrong).toEqual([]);
  });

  it("alternating_skill_combo: two different direct skills in a row raise the next one", () => {
    const pattern =
        /^Dùng 2 chiêu trực tiếp khác nhau liên tiếp: chiêu trực tiếp tiếp theo \+(\d+) Power rồi xóa đà\. Không tích từ hit phụ; khống chế bỏ lượt\/đổi pet xóa đà\.$/,
      wrong: string[] = [];
    expect(family("alternating_skill_combo").length).toBe(7);
    for (const trait of family("alternating_skill_combo")) {
      const [power] = numbers(trait, pattern);
      if (power !== trait.value) wrong.push(`${trait.key}: described ${power}`);
      const id = trait.speciesId,
        plain = plainHit(id);
      // The same skill twice builds nothing.
      const same = pet(0, id);
      strike(same, pet(1, TARGET), mainSkill(id), 1);
      strike(same, pet(1, TARGET), mainSkill(id), 2);
      if (strike(same, pet(1, TARGET), mainSkill(id), 3) !== plain)
        wrong.push(`${trait.key}: the same skill twice built đà`);
      // Two different ones do; the third hit takes it and the đà is gone.
      const user = pet(0, id);
      strike(user, pet(1, TARGET), mainSkill(id), 1);
      strike(user, pet(1, TARGET), otherSkill(id), 2);
      const boosted = strike(user, pet(1, TARGET), mainSkill(id), 3);
      if (!raisedBy(plain, boosted, power)) wrong.push(`${trait.key}: ${plain} → ${boosted}`);
      if (user.statuses.has(0, FAMILY_CHARGE)) wrong.push(`${trait.key}: đà left`);
      // A round with no action of its own (a lost turn) wipes the đà.
      const stunned = pet(0, id),
        seats = rules.newTraitProjection(() => 0);
      strike(stunned, pet(1, TARGET), mainSkill(id), 1);
      strike(stunned, pet(1, TARGET), otherSkill(id), 2);
      seats.onRoundEnd(stunned, 1, 3, 0);
      if (stunned.statuses.has(0, FAMILY_CHARGE)) wrong.push(`${trait.key}: a lost turn kept đà`);
    }
    expect(wrong).toEqual([]);
  });

  for (const [type, pattern, count] of [
    [
      "status_followup",
      /^Sau khi tự đặt thành công debuff mới: đòn trực tiếp tiếp theo \+(\d+) Power trong (\d+) lượt rồi tiêu dấu\. 1 dấu; không kích từ làm mới cùng debuff\.$/,
      12,
    ],
    [
      "debuff_resonance",
      /^Đặt mới debuff bằng chiêu: nhận 1 dấu âm trong (\d+) lượt; chiêu trực tiếp kế tiếp \+(\d+) Power rồi xóa dấu\. Không tích từ DOT tick, tối đa 1 dấu\.$/,
      6,
    ],
  ] as const) {
    it(`${type}: a new debuff marks the next direct hit; a refreshed one does not`, () => {
      const wrong: string[] = [];
      expect(family(type).length).toBe(count);
      for (const trait of family(type)) {
        const read = numbers(trait, pattern),
          [power, turns] = type === "status_followup" ? read : [read[1], read[0]];
        if (power !== trait.value || turns !== 2) wrong.push(`${trait.key}: described ${read}`);
        const id = trait.speciesId,
          plain = plainHit(id),
          user = pet(0, id),
          foe = pet(1, TARGET);
        strike(user, foe, DEBUFF_SKILL);
        if (foe.activeDebuffCount() === 0) wrong.push(`${trait.key}: setup planted nothing`);
        if (!user.statuses.has(0, FAMILY_CHARGE)) wrong.push(`${trait.key}: no mark`);
        const boosted = strike(user, pet(1, TARGET), mainSkill(id));
        if (!raisedBy(plain, boosted, power)) wrong.push(`${trait.key}: ${plain} → ${boosted}`);
        // The same debuff again on a target that still carries it builds nothing.
        strike(user, foe, DEBUFF_SKILL);
        if (user.statuses.has(0, FAMILY_CHARGE)) wrong.push(`${trait.key}: a refresh marked`);
      }
      expect(wrong).toEqual([]);
    });
  }

  it("electric_charge: hitting or being hit stores X Power a round; a main-element hit spends all", () => {
    const pattern =
        /^Mỗi lần trực tiếp đánh trúng hoặc bị đánh trúng: tích (\d+) Power, cộng dồn tối đa 3 tầng, (\d+) lượt\. Đòn hệ chính kế tiếp tiêu hết tầng; tối đa 1 tầng\/lượt\.$/,
      wrong: string[] = [];
    expect(family("electric_charge").length).toBe(13);
    for (const trait of family("electric_charge")) {
      const [power, turns] = numbers(trait, pattern);
      if (power !== trait.value || turns !== 3) wrong.push(`${trait.key}: described ${power}`);
      const id = trait.speciesId,
        plain = plainHit(id),
        user = pet(0, id),
        foe = pet(1, TARGET);
      // Round 1: it hits (one tier), is hit back (same round: no second tier).
      strike(user, foe, otherSkill(id), 1);
      strike(foe, user, mainSkill(TARGET), 1);
      // Round 2: it is hit again — a second tier.
      strike(foe, user, mainSkill(TARGET), 2);
      const tiers = user.statuses.get(0, FAMILY_CHARGE)?.stackCount ?? 0;
      if (tiers !== 2) wrong.push(`${trait.key}: ${tiers} tiers after two rounds`);
      const boosted = strike(user, pet(1, TARGET), mainSkill(id), 3);
      if (!raisedBy(plain, boosted, power * 2)) wrong.push(`${trait.key}: ${plain} → ${boosted}`);
    }
    expect(wrong).toEqual([]);
  });

  it("low_hp_power_trade: under 50% HP the next damaging skill +X Power, then pays 5%", () => {
    const pattern =
        /^HP dưới (\d+)%: chiêu damage kế tiếp \+(\d+) Power, sau đó trả (\d+)% HP tối đa, không tự gục\. 1 lần\/(\d+) lượt, không kích nếu HP không đủ trả\.$/,
      wrong: string[] = [];
    expect(family("low_hp_power_trade").length).toBe(3);
    for (const trait of family("low_hp_power_trade")) {
      const [below, power, pay, every] = numbers(trait, pattern);
      if (below !== 50 || power !== trait.value || pay !== 5 || every !== 3)
        wrong.push(`${trait.key}: described ${below}/${power}/${pay}/${every}`);
      const id = trait.speciesId,
        plain = plainHit(id),
        user = pet(0, id);
      user.setHp(499);
      const boosted = strike(user, pet(1, TARGET), mainSkill(id), 1);
      if (!raisedBy(plain, boosted, power)) wrong.push(`${trait.key}: ${plain} → ${boosted}`);
      if (user.hp() !== 449) wrong.push(`${trait.key}: paid ${499 - user.hp()}`);
      if (strike(user, pet(1, TARGET), mainSkill(id), 2) !== plain)
        wrong.push(`${trait.key}: fired twice inside 3 turns`);
      const healthy = pet(0, id);
      healthy.setHp(500);
      if (strike(healthy, pet(1, TARGET), mainSkill(id), 1) !== plain || healthy.hp() !== 500)
        wrong.push(`${trait.key}: fired at exactly 50%`);
    }
    expect(wrong).toEqual([]);
  });
});

describe("the two mutation forms' own characteristics", () => {
  const form = (speciesId: number) => balance.find((trait) => trait.speciesId === speciesId)!;

  it("Hỏa Vu Mộc Linh — HV-01 Hỏa Tế Đoạt Tiên: a faster foe opens the window, +15% once, 2 turns' rest", () => {
    const trait = form(274);
    expect(trait).toMatchObject({ exclusiveTrait: "HV-01", value: 15, cooldownTurns: 2 });
    const skill = mainSkill(274),
      // Speed never enters the damage formula: a foe no faster gives the plain hit.
      plain = strike(pet(0, 274), pet(1, TARGET, 100), skill),
      raised = plain + Math.trunc((plain * 15) / 100),
      user = pet(0, 274),
      fast = pet(1, TARGET, 120);
    // "ưu tiên hành động": the turn order hears it while the window is open.
    expect(rules.traits.outranked(user, fast)).toBe(true);
    expect(rules.traits.outranked(user, pet(1, TARGET, 100))).toBe(false);
    // "đòn sát thương đầu tiên … tăng 15%".
    expect(strike(user, fast, skill, 1)).toBe(raised);
    // "hồi chiêu 2 lượt": shut for the rest of round 1 and through rounds 2 and 3.
    for (const round of [1, 2, 3]) {
      user.designTraitState.round = round;
      expect(rules.traits.outranked(user, fast), `round ${round}`).toBe(false);
      expect(strike(user, pet(1, TARGET, 120), skill, round), `round ${round}`).toBe(plain);
    }
    user.designTraitState.round = 4;
    expect(rules.traits.outranked(user, fast)).toBe(true);
    expect(strike(user, pet(1, TARGET, 120), skill, 4)).toBe(raised);
    // A foe no faster opens nothing, and nothing is spent.
    const calm = pet(0, 274);
    strike(calm, pet(1, TARGET, 100), skill, 1);
    expect(calm.designTraitState.outrankCooldownUntil).toBeLessThan(0);
  });

  it("Thiên Luân Di Lặc — TL-01 Thiên Luân Kim Thân: six controls never take hold, direct hits −25%", () => {
    const trait = form(275);
    expect(trait).toMatchObject({ exclusiveTrait: "TL-01", value: 25 });
    const web = rules.web!,
      liet = (skillId: number, debuffId: number) => (u: DesignTraitUnit) =>
        rules.status.pendingDebuffFromProducer(pet(1, TARGET), u, skillId, debuffId)!.commit();
    // A pet of another species with no such guard takes every one of them.
    const OPEN = 34;
    const controls: [string, (unit: DesignTraitUnit) => void, number, number][] = [
      ["Mê Muội", liet(2, 1), 1, 1],
      ["Quấn Quanh", liet(12, 2), 1, 2],
      ["Hỗn Loạn", liet(55, 9), 1, 9],
      ["Tê Liệt", liet(41, 10), 1, 10],
      ["Hóa Đá", (u) => web.applyRainbowDebuff(u, 0, { turns: 2 }), 2, 0],
      ["Giam Cầm (chiêu đặc trưng)", (u) => void strike(pet(1, TARGET), u, 1012), 2, 4],
      ["Ngủ", (u) => web.applyRainbowDebuff(u, 8, { turns: 1 }), 2, 8],
    ];
    for (const [name, plant, bank, id] of controls) {
      const guarded = pet(0, 275),
        open = pet(0, OPEN);
      plant(guarded);
      plant(open);
      expect(open.statuses.has(bank, id), `${name} on a pet without TL-01`).toBe(true);
      expect(guarded.statuses.has(bank, id), name).toBe(false);
    }
    // Anything else still takes hold.
    const seeded = pet(0, 275);
    liet(1, 0)(seeded);
    web.applyRainbowDebuff(seeded, 5, { turns: 3 });
    expect([seeded.statuses.has(1, 0), seeded.statuses.has(2, 5)]).toEqual([true, true]);
    // "giảm 25% sát thương trực tiếp nhận vào", through the hook every direct hit is asked at;
    // a hit still costs at least 1, and the guard is not spent.
    const guard = pet(0, 275),
      source = pet(1, TARGET);
    expect([100, 161, 3, 1].map((hit) => rules.traits.incoming(source, guard, hit))).toEqual([
      75, 121, 3, 1,
    ]);
    expect(rules.traits.incoming(source, pet(0, OPEN), 100)).toBe(100);
  });
});

describe("the other 36 families, pet by pet", () => {
  const web = rules.web!;
  /** A hit raised by `percent` the way `outgoing` raises it. */
  const raised = (plain: number, percent: number) => plain + Math.trunc((plain * percent) / 100);
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  /** A Power-100 skill of the element after the pet's own: never "hệ chính". */
  const offElement = (speciesId: number) => ((element.get(speciesId)! + 1) % 7) * 10;
  /** Plant a Liệt Hỏa debuff the way its producing skill commits it. */
  const liet = (skillId: number, debuffId: number) => (unit: DesignTraitUnit) =>
    rules.status.pendingDebuffFromProducer(pet(1, TARGET), unit, skillId, debuffId)!.commit();
  const giamCam = (unit: DesignTraitUnit) => web.applyRainbowDebuff(unit, 4, { turns: 2 });
  /** Đằng chi bích lũy / Thảo nguyện thuật: Power-0 self skills (Kinh Cức, Khôi phục). */
  const KINH_CUC = 14,
    KHOI_PHUC = 15;
  /** The cleanse heal signature (22% max HP, +6% only after a real cleanse). */
  const HEAL = 1031;
  const SLEEP = 1030,
    DISPEL = 1037,
    SEED_SKILL = 1;
  /** One `it` per family: every pet of it walks `check`, and the block lists who disagreed. */
  const family = (type: string, count: number, check: (trait: Balance, wrong: string[]) => void) =>
    it(`${type} (${count})`, () => {
      const traits = balance.filter((trait) => trait.type === type);
      expect(traits.length).toBe(count);
      const wrong: string[] = [];
      for (const trait of traits) check(trait, wrong);
      expect(wrong).toEqual([]);
    });

  describe("damage bonuses", () => {
    family("first_direct_action_per_entry", 3, (t, wrong) => {
      const id = t.speciesId,
        user = pet(0, id),
        first = strike(user, pet(1, TARGET), mainSkill(id), 1),
        // The second hit of the entry is the plain one.
        plain = strike(user, pet(1, TARGET), mainSkill(id), 2);
      if (!near(first, raised(plain, t.value)))
        wrong.push(`${t.key}: first hit ${first} of ${plain}`);
      // "Giữa hai lần ít nhất 3 lượt": a re-entry two rounds later still waits; four rounds later fires.
      rules.traits.enter(user, 3);
      if (strike(user, pet(1, TARGET), mainSkill(id), 3) !== plain)
        wrong.push(`${t.key}: 3-turn gap`);
      rules.traits.enter(user, 5);
      if (!near(strike(user, pet(1, TARGET), mainSkill(id), 5), raised(plain, t.value)))
        wrong.push(`${t.key}: not back after the gap`);
      // "nếu đi trước".
      const second = pet(0, id);
      if (strike(second, pet(1, TARGET), mainSkill(id), 1, 0, { actedFirst: false }) !== plain)
        wrong.push(`${t.key}: fired going second`);
    });
    family("entry_ambush", 5, (t, wrong) => {
      const id = t.speciesId,
        user = pet(0, id);
      user.setHp(701);
      const first = strike(user, pet(1, TARGET), mainSkill(id), 1),
        // The second hit of the entry is the plain one.
        plain = strike(user, pet(1, TARGET), mainSkill(id), 2);
      if (!near(first, raised(plain, t.value)))
        wrong.push(`${t.key}: at 70.1% ${first} of ${plain}`);
      const low = pet(0, id);
      low.setHp(700);
      if (strike(low, pet(1, TARGET), mainSkill(id), 1) !== plain)
        wrong.push(`${t.key}: fired at 70%`);
    });
    family("slow_target_hunt", 13, (t, wrong) => {
      const id = t.speciesId,
        plain = plainHit(id);
      for (const [name, slow] of [
        ["Chậm Chạp", liet(32, 5)],
        ["Tê Liệt", liet(41, 10)],
        ["Mê Muội", liet(2, 1)],
        ["Giam Cầm", giamCam],
      ] as const) {
        const target = pet(1, TARGET);
        slow(target);
        if (!near(strike(pet(0, id), target, mainSkill(id)), raised(plain, t.value)))
          wrong.push(`${t.key}: not raised against ${name}`);
      }
    });
    family("imprisoned_target_bonus", 5, (t, wrong) => {
      const id = t.speciesId,
        plain = plainHit(id),
        bound = pet(1, TARGET),
        slowed = pet(1, TARGET);
      giamCam(bound);
      liet(32, 5)(slowed);
      if (!near(strike(pet(0, id), bound, mainSkill(id)), raised(plain, t.value)))
        wrong.push(`${t.key}: not raised against Giam Cầm`);
      if (strike(pet(0, id), slowed, mainSkill(id)) !== plain)
        wrong.push(`${t.key}: raised by Chậm Chạp`);
    });
    family("hp_trade_boost", 5, (t, wrong) => {
      const id = t.speciesId,
        user = pet(0, id),
        first = strike(user, pet(1, TARGET), mainSkill(id), 1);
      if (user.hp() !== 970) wrong.push(`${t.key}: paid ${1000 - user.hp()} not 3%`);
      // "tối đa 1 lần/lượt": the second hit of the turn is the plain one, and costs nothing.
      const plain = strike(user, pet(1, TARGET), mainSkill(id), 1);
      if (!near(first, raised(plain, t.value))) wrong.push(`${t.key}: ${first} of ${plain}`);
      if (user.hp() !== 970) wrong.push(`${t.key}: paid twice in one turn`);
      const off = pet(0, id);
      strike(off, pet(1, TARGET), offElement(id));
      if (off.hp() !== 1000) wrong.push(`${t.key}: an off-element skill paid`);
      const broke = pet(0, id);
      broke.setHp(30);
      if (strike(broke, pet(1, TARGET), mainSkill(id)) !== plain || broke.hp() !== 30)
        wrong.push(`${t.key}: fired without HP to pay`);
      const edge = pet(0, id);
      edge.setHp(31);
      strike(edge, pet(1, TARGET), mainSkill(id));
      if (edge.hp() !== 1) wrong.push(`${t.key}: the price left ${edge.hp()}`);
    });
    family("buffed_target_pressure", 8, (t, wrong) => {
      const id = t.speciesId,
        plain = plainHit(id),
        buffed = pet(1, TARGET);
      strike(buffed, buffed, KHOI_PHUC);
      if (buffed.activeBuffCount() === 0) wrong.push(`${t.key}: setup holds no buff`);
      if (!near(strike(pet(0, id), buffed, mainSkill(id)), raised(plain, t.value)))
        wrong.push(`${t.key}: not raised against a buffed foe`);
      const offTarget = pet(1, TARGET);
      strike(offTarget, offTarget, KHOI_PHUC);
      if (
        strike(pet(0, id), offTarget, offElement(id)) !==
        strike(pet(0, id), pet(1, TARGET), offElement(id))
      )
        wrong.push(`${t.key}: raised an off-element hit`);
    });
    family("same_element_momentum", 11, (t, wrong) => {
      const id = t.speciesId,
        plain = plainHit(id),
        user = pet(0, id);
      strike(user, user, KINH_CUC, 1);
      if (user.statuses.has(0, FAMILY_CHARGE)) wrong.push(`${t.key}: a Power-0 skill stacked`);
      strike(user, pet(1, TARGET), mainSkill(id), 1);
      if (!near(strike(user, pet(1, TARGET), mainSkill(id), 2), raised(plain, t.value)))
        wrong.push(`${t.key}: one stack not +${t.value}%`);
      if (!near(strike(user, pet(1, TARGET), mainSkill(id), 3), raised(plain, 2 * t.value)))
        wrong.push(`${t.key}: two stacks not +${2 * t.value}%`);
      const offPlain = strike(pet(0, id), pet(1, TARGET), offElement(id));
      if (strike(user, pet(1, TARGET), offElement(id), 4) !== offPlain)
        wrong.push(`${t.key}: raised an off-element hit`);
    });
    for (const [type, count] of [
      ["buffed_defense_pierce", 8],
      ["faster_target_pierce", 2],
    ] as const)
      family(type, count, (t, wrong) => {
        const id = t.speciesId,
          plain = plainHit(id),
          target = pet(1, TARGET, type === "faster_target_pierce" ? 120 : 100);
        if (type === "buffed_defense_pierce") strike(target, target, KINH_CUC);
        const defense = target.currentStats.defense,
          raw = 200 - Math.trunc((defense * (100 - t.value)) / 100),
          pierced = strike(pet(0, id), target, mainSkill(id));
        // Speed never scores; DEF does, by `atk − DEF × (100 − X)%`.
        if (Math.abs(pierced - (plain * raw) / 140) > 2)
          wrong.push(`${t.key}: ${pierced} vs DEF ${defense} (plain ${plain}, raw ${raw})`);
        // No DEF buff / a foe no faster: no pierce at all.
        if (strike(pet(0, id), pet(1, TARGET, 100), mainSkill(id)) !== plain)
          wrong.push(`${t.key}: pierced without its condition`);
      });
  });

  describe("guards", () => {
    /** What `TARGET`'s Power-100 hit does to a pet of `speciesId`. */
    const taken = (receiver: DesignTraitUnit, round = 1, attacker = pet(1, TARGET)) =>
      strike(attacker, receiver, mainSkill(TARGET), round);
    family("first_hit_guard", 9, (t, wrong) => {
      const user = pet(0, t.speciesId),
        first = taken(user, 1),
        second = taken(user, 1),
        next = taken(user, 2);
      if (first !== second - Math.trunc((second * t.value) / 100))
        wrong.push(`${t.key}: ${first} of ${second} is not −${t.value}%`);
      if (next !== first) wrong.push(`${t.key}: not again the next turn`);
    });
    family("entry_hit_guard", 6, (t, wrong) => {
      const user = pet(0, t.speciesId),
        first = taken(user, 1),
        second = taken(user, 1);
      if (first !== Math.max(0, second - Math.trunc((second * t.value) / 100)))
        wrong.push(`${t.key}: first hit ${first} of ${second}`);
      if (taken(user, 2) !== second) wrong.push(`${t.key}: guarded twice per entry`);
      rules.traits.enter(user, 3);
      if (taken(user, 3) !== second) wrong.push(`${t.key}: re-entry inside 3 turns guarded`);
      rules.traits.enter(user, 4);
      if (taken(user, 4) !== first) wrong.push(`${t.key}: re-entry after 3 turns unguarded`);
    });
    family("accuracy_pressure_guard", 4, (t, wrong) => {
      const blind = pet(1, TARGET);
      liet(31, 4)(blind);
      const full = taken(pet(0, t.speciesId)),
        cut = taken(pet(0, t.speciesId), 1, blind);
      if (cut !== full - Math.trunc((full * t.value) / 100))
        wrong.push(`${t.key}: ${cut} of ${full} from a blinded foe`);
    });
    family("hp_band_defense", 3, (t, wrong) => {
      const user = pet(0, t.speciesId),
        seats = rules.newTraitProjection(() => 0);
      user.setHp(601);
      user.restoreStatsForCheck();
      if (user.currentStats.defense !== 60 + Math.trunc((60 * t.value) / 100))
        wrong.push(`${t.key}: DEF ${user.currentStats.defense} above 60%`);
      user.setHp(600);
      user.restoreStatsForCheck();
      if (user.currentStats.defense !== 60) wrong.push(`${t.key}: DEF raised at 60%`);
      user.setHp(399);
      seats.onRoundEnd(user, 1, 1, 0);
      if (user.hp() !== 599) wrong.push(`${t.key}: below 40% healed to ${user.hp()}`);
      user.setHp(399);
      seats.onRoundEnd(user, 1, 2, 0);
      if (user.hp() !== 399) wrong.push(`${t.key}: healed twice inside 2 turns`);
      const band = pet(0, t.speciesId);
      band.setHp(400);
      seats.onRoundEnd(band, 1, 1, 0);
      if (band.hp() !== 400) wrong.push(`${t.key}: healed at 40%`);
    });
    family("threshold_guard_once", 7, (t, wrong) => {
      const user = pet(0, t.speciesId);
      user.setHp(400);
      taken(user);
      if (
        user.shieldHp() !== Math.trunc((1000 * t.value) / 100) ||
        user.statuses.get(0, 15)?.remainingTurns !== 2
      )
        wrong.push(`${t.key}: shield ${user.shieldHp()} on crossing 30%`);
      const already = pet(0, t.speciesId);
      already.setHp(250);
      taken(already);
      if (already.shieldHp() !== 0) wrong.push(`${t.key}: shield without crossing`);
      const doomed = pet(0, t.speciesId);
      doomed.setHp(50);
      taken(doomed);
      if (doomed.alive() || doomed.shieldHp() !== 0) wrong.push(`${t.key}: saved a lethal hit`);
    });
    family("threshold_regen_once", 1, (t, wrong) => {
      const user = pet(0, t.speciesId);
      user.setHp(400);
      const hit = taken(user);
      if (user.hp() !== Math.min(1000, 400 - hit + Math.trunc((1000 * t.value) / 100)))
        wrong.push(`${t.key}: HP ${user.hp()} after crossing 30%`);
      const doomed = pet(0, t.speciesId);
      doomed.setHp(50);
      taken(doomed);
      if (doomed.alive()) wrong.push(`${t.key}: revived`);
    });
    family("damage_to_shield", 9, (t, wrong) => {
      const user = pet(0, t.speciesId),
        amount = Math.trunc((1000 * t.value) / 100);
      strike(user, pet(1, TARGET), mainSkill(t.speciesId), 1);
      if (user.shieldHp() !== amount || user.statuses.get(0, 15)?.remainingTurns !== 2)
        wrong.push(`${t.key}: shield ${user.shieldHp()}`);
      user.statuses.remove(0, 15);
      strike(user, pet(1, TARGET), mainSkill(t.speciesId), 2);
      if (user.shieldHp() !== 0) wrong.push(`${t.key}: twice inside 2 turns`);
      strike(user, pet(1, TARGET), mainSkill(t.speciesId), 3);
      if (user.shieldHp() !== amount) wrong.push(`${t.key}: not back after 2 turns`);
    });
  });

  describe("answers to a hit", () => {
    const hitBy = (
      user: DesignTraitUnit,
      attacker = pet(1, TARGET),
      round = 1,
      skill = mainSkill(TARGET),
    ) => {
      const before = attacker.hp(),
        dealt = strike(attacker, user, skill, round);
      return { dealt, back: before - attacker.hp(), attacker };
    };
    family("taken_damage_rage", 8, (t, wrong) => {
      const user = pet(0, t.speciesId);
      hitBy(user, undefined, 1);
      hitBy(user, undefined, 1);
      if (user.statuses.get(0, 19)?.stackCount !== 1)
        wrong.push(`${t.key}: two stacks in one turn`);
      hitBy(user, undefined, 2);
      if (user.currentStats.attack !== 200 + Math.trunc((200 * 2 * t.value) / 100))
        wrong.push(`${t.key}: ATK ${user.currentStats.attack} on two stacks`);
      if (user.statuses.get(0, 19)?.remainingTurns !== 3) wrong.push(`${t.key}: not 3 turns`);
    });
    family("reactive_retaliation", 3, (t, wrong) => {
      const user = pet(0, t.speciesId),
        first = hitBy(user, undefined, 1);
      if (first.back !== Math.trunc((first.dealt * t.value) / 100))
        wrong.push(`${t.key}: sent back ${first.back} of ${first.dealt}`);
      if (hitBy(user, undefined, 1).back !== 0) wrong.push(`${t.key}: twice in one turn`);
      // Under 8% of max HP (a 40-point hit) sends nothing back.
      const small = hitBy(pet(0, t.speciesId), pet(1, TARGET, 100, 70));
      if (small.dealt >= 80 || small.back !== 0)
        wrong.push(`${t.key}: small hit ${small.dealt} → ${small.back}`);
    });
    family("thorn_retaliation", 11, (t, wrong) => {
      const user = pet(0, t.speciesId);
      if (hitBy(user, undefined, 1).back !== Math.trunc((1000 * t.value) / 100))
        wrong.push(`${t.key}: thorn not ${t.value}% of its max HP`);
      if (hitBy(user, undefined, 1).back !== 0) wrong.push(`${t.key}: twice in one turn`);
      if (hitBy(user, undefined, 2).back === 0) wrong.push(`${t.key}: not again next turn`);
    });
    family("fire_hit_recovery", 3, (t, wrong) => {
      const user = pet(0, t.speciesId);
      user.setHp(500);
      const healedHit = hitBy(user, undefined, 1, 0).dealt,
        // Round 2 is inside the 2-turn rest: the same Hỏa hit, with nothing healed back.
        bareHit = hitBy(user, undefined, 2, 0).dealt;
      if (healedHit !== bareHit - Math.trunc((1000 * t.value) / 100))
        wrong.push(`${t.key}: net ${healedHit} against a bare ${bareHit}`);
      const water = pet(0, t.speciesId);
      water.setHp(500);
      const plain = hitBy(water, undefined, 1, 30);
      if (water.hp() !== 500 - plain.dealt || plain.dealt <= 0)
        wrong.push(`${t.key}: healed from a non-Hỏa hit`);
    });
    family("reactive_chill", 3, (t, wrong) => {
      const { attacker } = hitBy(pet(0, t.speciesId));
      const chill = attacker.statuses.get(1, 5);
      if (!chill || chill.remainingTurns !== 2 || attacker.currentStats.speed !== 100 - t.value)
        wrong.push(
          `${t.key}: attacker speed ${attacker.currentStats.speed}, ${chill?.remainingTurns} turns`,
        );
      const { attacker: light } = hitBy(pet(0, t.speciesId), pet(1, TARGET, 100, 70));
      if (light.statuses.has(1, 5)) wrong.push(`${t.key}: chilled by a hit under 8%`);
    });
    family("damage_debuff_followup", 7, (t, wrong) => {
      const user = pet(0, t.speciesId),
        foe = pet(1, TARGET);
      strike(user, foe, mainSkill(t.speciesId), 1);
      const down = foe.statuses.get(1, 6);
      if (!down || down.remainingTurns !== 2) wrong.push(`${t.key}: no 2-turn damage-down`);
      const full = strike(pet(1, TARGET), pet(0, TARGET), mainSkill(TARGET)),
        weak = strike(foe, pet(0, TARGET), mainSkill(TARGET));
      if (!near(weak, full - Math.trunc((full * t.value) / 100)))
        wrong.push(`${t.key}: foe hits ${weak} of ${full}`);
      const other = pet(1, TARGET);
      strike(user, other, mainSkill(t.speciesId), 2);
      if (other.statuses.has(1, 6)) wrong.push(`${t.key}: again inside 3 turns`);
    });
    family("first_hit_imprison", 3, (t, wrong) => {
      const user = pet(0, t.speciesId),
        foe = pet(1, TARGET);
      strike(user, foe, mainSkill(t.speciesId), 1);
      if (foe.statuses.get(2, 4)?.remainingTurns !== t.value)
        wrong.push(`${t.key}: Giam Cầm ${foe.statuses.get(2, 4)?.remainingTurns}`);
      if (web.beforeAction(foe, () => 99).blocked) wrong.push(`${t.key}: the foe lost its turn`);
      const other = pet(1, TARGET);
      strike(user, other, mainSkill(t.speciesId), 2);
      if (other.statuses.has(2, 4)) wrong.push(`${t.key}: again inside 3 turns`);
    });
  });

  describe("sustain", () => {
    family("low_target_lifesteal", 5, (t, wrong) => {
      const user = pet(0, t.speciesId),
        foe = pet(1, TARGET);
      user.setHp(300);
      foe.setHp(349);
      const dealt = strike(user, foe, mainSkill(t.speciesId), 1);
      if (user.hp() !== Math.min(1000, 300 + Math.trunc((dealt * t.value) / 100)))
        wrong.push(`${t.key}: healed to ${user.hp()} off ${dealt}`);
      const healthy = pet(0, t.speciesId),
        high = pet(1, TARGET);
      healthy.setHp(300);
      high.setHp(350);
      strike(healthy, high, mainSkill(t.speciesId));
      if (healthy.hp() !== 300) wrong.push(`${t.key}: drank off a 35% target`);
    });
    family("marked_target_lifesteal", 3, (t, wrong) => {
      const user = pet(0, t.speciesId),
        foe = pet(1, TARGET);
      strike(user, foe, SEED_SKILL, 1);
      if (!foe.statuses.has(1, 0)) wrong.push(`${t.key}: setup planted no Gieo Hạt`);
      user.setHp(300);
      const dealt = strike(user, foe, mainSkill(t.speciesId), 3);
      if (user.hp() !== Math.min(1000, 300 + Math.trunc((dealt * t.value) / 100)))
        wrong.push(`${t.key}: healed to ${user.hp()} off ${dealt}`);
      const clean = pet(0, t.speciesId);
      clean.setHp(300);
      strike(clean, pet(1, TARGET), mainSkill(t.speciesId));
      if (clean.hp() !== 300) wrong.push(`${t.key}: drank off an unmarked target`);
    });
    family("status_seed_sustain", 9, (t, wrong) => {
      const user = pet(0, t.speciesId),
        foe = pet(1, TARGET);
      user.setHp(500);
      strike(user, foe, SEED_SKILL, 1);
      if (user.hp() !== 500 + Math.trunc((1000 * t.value) / 100))
        wrong.push(`${t.key}: HP ${user.hp()} after Gieo Hạt`);
      const after = user.hp();
      strike(user, pet(1, TARGET), SEED_SKILL, 2);
      if (user.hp() !== after) wrong.push(`${t.key}: twice inside 2 turns`);
      strike(user, foe, SEED_SKILL, 3);
      if (user.hp() !== after) wrong.push(`${t.key}: a refresh healed`);
    });
    for (const [type, count] of [
      ["dot_tick_sustain", 8],
      ["enemy_dot_heal_support", 3],
    ] as const)
      family(type, count, (t, wrong) => {
        // The live fight: a Gieo Hạt the pet planted ticks at the enemy's turn.
        const user = pet(0, t.speciesId),
          foe = pet(1, TARGET),
          seats = rules.newTraitProjection(() => 0);
        seats.onBattleEnter(foe, 0, 1, 0);
        seats.onBattleEnter(user, 1, 1, 0);
        strike(user, foe, SEED_SKILL, 1, 0, { projection: seats });
        user.setHp(500);
        const before = foe.hp();
        web.ownerTurnStart(foe, () => user, {
          ticked: (status, damage) => seats.designDotTick(foe, status, damage, 2),
        });
        if (foe.hp() >= before) wrong.push(`${t.key}: Gieo Hạt did not tick`);
        if (type === "dot_tick_sustain") {
          if (user.hp() !== 500 + Math.trunc((1000 * t.value) / 100))
            wrong.push(`${t.key}: HP ${user.hp()} after its DOT ticked`);
        } else {
          const charge = user.statuses.get(0, 21);
          if (!charge || charge.remainingTurns !== 2) wrong.push(`${t.key}: no 2-turn heal mark`);
          const before = user.hp();
          strike(user, user, HEAL, 2, 0, { projection: seats });
          if (
            user.hp() - before !==
            Math.min(1000 - before, Math.trunc((1000 * (22 + t.value)) / 100))
          )
            wrong.push(`${t.key}: marked heal ${user.hp() - before}`);
        }
      });
    /** A heal of `amount` on a pet at `hp`, as far as its 1000 max HP lets it go. */
    const capped = (hp: number, amount: number) => Math.min(1000 - hp, amount);
    /** What HEAL does to `user` at `hp`. */
    const healed = (user: DesignTraitUnit, hp: number, round = 1) => {
      user.setHp(hp);
      strike(user, user, HEAL, round);
      return user.hp() - hp;
    };
    family("low_hp_heal_bonus", 8, (t, wrong) => {
      const user = pet(0, t.speciesId);
      if (healed(user, 499, 1) !== capped(499, 220 + Math.trunc((1000 * t.value) / 100)))
        wrong.push(`${t.key}: under 50%`);
      if (healed(user, 499, 2) !== 220) wrong.push(`${t.key}: twice inside 3 turns`);
      if (healed(pet(0, t.speciesId), 500) !== 220) wrong.push(`${t.key}: at 50%`);
    });
    family("utility_reserve", 12, (t, wrong) => {
      const user = pet(0, t.speciesId);
      strike(user, user, KINH_CUC, 1);
      strike(user, user, KINH_CUC, 2);
      const reserve = user.statuses.get(0, 18);
      if (reserve?.stackCount !== 2 || reserve.remainingTurns !== 4)
        wrong.push(`${t.key}: reserve ${reserve?.stackCount}`);
      if (healed(user, 100, 3) !== capped(100, 220 + Math.trunc((1000 * 2 * t.value) / 100)))
        wrong.push(`${t.key}: the heal did not spend two stacks`);
      // Both old stacks are spent; the heal is itself a Power-0 skill, so it lays one fresh stack.
      if (user.statuses.get(0, 18)?.stackCount !== 1)
        wrong.push(`${t.key}: ${user.statuses.get(0, 18)?.stackCount} stacks after the heal`);
    });
    family("charm_heal_charge", 5, (t, wrong) => {
      const user = pet(0, t.speciesId),
        foe = pet(1, TARGET);
      strike(user, foe, SLEEP, 1);
      if (!foe.statuses.has(2, 8)) wrong.push(`${t.key}: setup put nothing to sleep`);
      if (healed(user, 300, 1) !== 220 + Math.trunc((1000 * t.value) / 100))
        wrong.push(`${t.key}: no bonus`);
      if (healed(user, 300, 2) !== 220) wrong.push(`${t.key}: the mark outlived its heal`);
    });
    family("successful_cleanse_heal", 9, (t, wrong) => {
      const user = pet(0, t.speciesId);
      liet(32, 5)(user);
      // 22% + the signature's own 6% for a real cleanse + the characteristic's X%.
      if (healed(user, 100, 1) !== 280 + Math.trunc((1000 * t.value) / 100))
        wrong.push(`${t.key}: after a cleanse`);
      liet(32, 5)(user);
      if (healed(user, 100, 2) !== 280) wrong.push(`${t.key}: twice inside 3 turns`);
      if (healed(pet(0, t.speciesId), 100) !== 220) wrong.push(`${t.key}: nothing to cleanse`);
    });
    family("support_shield", 9, (t, wrong) => {
      const user = pet(0, t.speciesId);
      strike(user, user, KINH_CUC, 1);
      if (
        user.shieldHp() !== Math.trunc((1000 * t.value) / 100) ||
        user.statuses.get(0, 15)?.remainingTurns !== 2
      )
        wrong.push(`${t.key}: shield ${user.shieldHp()}`);
      user.statuses.remove(0, 15);
      strike(user, user, KINH_CUC, 2);
      if (user.shieldHp() !== 0) wrong.push(`${t.key}: twice inside 3 turns`);
    });
    family("successful_dispel_pp", 6, (t, wrong) => {
      const user = pet(0, t.speciesId),
        foe = pet(1, TARGET);
      user.skillIds[0] = DISPEL;
      user.skillPp[0] = 0;
      strike(foe, foe, KHOI_PHUC);
      strike(user, foe, DISPEL, 1);
      const ppMax = rules.damage.skillRow(DISPEL)!.ppMax;
      if (user.skillPp[0] !== Math.min(ppMax, t.value))
        wrong.push(`${t.key}: PP ${user.skillPp[0]} after a dispel`);
      user.skillPp[0] = 0;
      strike(user, pet(1, TARGET), DISPEL, 4);
      if (user.skillPp[0] !== 0) wrong.push(`${t.key}: refunded with nothing to dispel`);
    });
    family("first_move_stacks", 9, (t, wrong) => {
      const user = pet(0, t.speciesId),
        seats = rules.newTraitProjection(() => 0);
      for (const round of [1, 2]) {
        strike(user, pet(1, TARGET), mainSkill(t.speciesId), round);
        seats.onRoundEnd(user, 1, round, 0);
      }
      if (user.currentStats.speed !== 100 + Math.trunc((100 * 2 * t.value) / 100))
        wrong.push(`${t.key}: speed ${user.currentStats.speed} after two first moves`);
      strike(user, pet(1, TARGET), mainSkill(t.speciesId), 3, 0, { actedFirst: false });
      seats.onRoundEnd(user, 1, 3, 0);
      if (user.currentStats.speed !== 100)
        wrong.push(`${t.key}: going second kept ${user.currentStats.speed}`);
    });
    family("switch_ally_shield", 4, (t, wrong) => {
      const pivot = records.find((r) => r.stableKey === "PD-SIG-18-PIVOT")!.runtimeId,
        user = pet(0, t.speciesId),
        next = pet(0, TARGET),
        seats = rules.newTraitProjection(() => 0);
      strike(user, pet(1, TARGET), pivot, 1);
      seats.onSwitch(user, next, 1, 1, 0, false);
      // "khiên tuyệt kỹ và đặc tính lấy giá trị cao hơn": X% beats the skill's own 4%.
      if (next.shieldHp() !== Math.trunc((1000 * Math.max(4, t.value)) / 100))
        wrong.push(`${t.key}: incoming shield ${next.shieldHp()}`);
      const blocked = pet(0, t.speciesId),
        stays = pet(0, TARGET);
      seats.onSwitch(blocked, stays, 1, 1, 0, false);
      if (stays.shieldHp() !== 0) wrong.push(`${t.key}: shield without a pivot`);
    });
  });
});

describe("the 19 talents (thiên phú)", () => {
  const talents = await_talents;
  const web = rules.web!;
  /** A pet of species 68 wearing talent `id`, seated in a fresh fight so its talent projects. */
  const wearing = (id: number, side = 0, attack = 200) => {
    const made = rules.traits.unit({
      speciesId: TARGET,
      ownerSide: side,
      formationSlot: side === 0 ? 1 : 0,
      base: { hp: 1000, attack, defense: 60, speed: 100 },
      physicalTraitId: id,
    });
    made.restoreStatsForCheck();
    const seats = rules.newTraitProjection(() => 0);
    seats.onBattleEnter(made, made.formationSlot, 1, 0);
    return { unit: made, seats };
  };
  const talent = (key: string) => talents.find((t) => t.stableKey === key)!.runtimeId;
  /** Rolls by label: `hitroll` and the talent's own roll are set, crit and jitter stay off. */
  class Rolls2 extends BattleRandom {
    constructor(private readonly by: Record<string, number>) {
      super();
    }
    override percent(label: string): number {
      for (const [part, value] of Object.entries(this.by)) if (label.includes(part)) return value;
      return /crit|jitter|hitroll/.test(label) ? 99 : 0;
    }
  }

  it("the table is exactly the 19 rollable talents", () => {
    expect(talents.length).toBe(19);
    expect(talents.every((t) => t.rollWeight > 0)).toBe(true);
  });

  it("TC-00 … TC-08: no change, or one final stat ±8%", () => {
    const expected: Record<string, [string, number]> = {
      "TC-01": ["maxHp", 920],
      "TC-02": ["maxHp", 1080],
      "TC-03": ["attack", 184],
      "TC-04": ["attack", 216],
      "TC-05": ["defense", 55],
      "TC-06": ["defense", 64],
      "TC-07": ["speed", 92],
      "TC-08": ["speed", 108],
    };
    const read = (unit: DesignTraitUnit) => ({
      maxHp: unit.maxHp(),
      attack: unit.currentStats.attack,
      defense: unit.currentStats.defense,
      speed: unit.currentStats.speed,
    });
    expect(read(wearing(talent("TC-00")).unit)).toEqual({
      maxHp: 1000,
      attack: 200,
      defense: 60,
      speed: 100,
    });
    for (const [key, [stat, value]] of Object.entries(expected))
      expect(read(wearing(talent(key)).unit)[stat as "maxHp"], key).toBe(value);
  });

  it("TC-09: every heal it receives is 25% smaller", () => {
    const { unit } = wearing(talent("TC-09"));
    unit.setHp(300);
    strike(unit, unit, 1031);
    expect(unit.hp() - 300).toBe(220 - 55);
  });

  it("TC-10: 2% at the round end, paused under Gieo Hạt or Hủ Thực", () => {
    const { unit, seats } = wearing(talent("TC-10"));
    unit.setHp(500);
    seats.onRoundEnd(unit, unit.formationSlot, 1, 0);
    expect(unit.hp()).toBe(520);
    const seeded = wearing(talent("TC-10"));
    seeded.unit.setHp(500);
    rules.status.pendingDebuffFromProducer(pet(1, TARGET), seeded.unit, 1, 0)!.commit();
    seeded.seats.onRoundEnd(seeded.unit, seeded.unit.formationSlot, 1, 0);
    expect(seeded.unit.hp()).toBe(500);
    const corroded = wearing(talent("TC-10"));
    corroded.unit.setHp(500);
    web.applyRainbowDebuff(corroded.unit, 5, { turns: 3 });
    corroded.seats.onRoundEnd(corroded.unit, corroded.unit.formationSlot, 1, 0);
    expect(corroded.unit.hp()).toBe(500);
  });

  it("TC-11 / TC-12: damage −8% / +8%, accuracy +5 / −5 points", () => {
    const plain = strike(pet(0, TARGET), pet(1, TARGET), mainSkill(TARGET));
    // adjustByPercent: the whole hit times 92% / 108%, truncated.
    expect(strike(wearing(talent("TC-11")).unit, pet(1, TARGET), mainSkill(TARGET))).toBe(
      Math.trunc((plain * 92) / 100),
    );
    expect(strike(wearing(talent("TC-12")).unit, pet(1, TARGET), mainSkill(TARGET))).toBe(
      Math.trunc((plain * 108) / 100),
    );
    // A blinded attacker (Mục, −15 accuracy) misses under 15; TC-11 brings that to 10, TC-12 to 20.
    const blind = (unit: DesignTraitUnit) => {
      rules.status.pendingDebuffFromProducer(pet(1, TARGET), unit, 31, 4)!.commit();
      return unit;
    };
    const lands = (unit: DesignTraitUnit, roll: number) =>
      strike(unit, pet(1, TARGET), mainSkill(TARGET), 1, 0, {
        random: new Rolls2({ hitroll: roll }),
      }) > 0;
    expect([
      lands(blind(pet(0, TARGET)), 12),
      lands(blind(wearing(talent("TC-11")).unit), 12),
    ]).toEqual([false, true]);
    expect([
      lands(blind(pet(0, TARGET)), 17),
      lands(blind(wearing(talent("TC-12")).unit), 17),
    ]).toEqual([true, false]);
  });

  it("V4-TRAIT-00 / 03: on 30% of hits, half the damage / half again", () => {
    const plain = strike(pet(1, TARGET), pet(0, TARGET), mainSkill(TARGET));
    const hit = (key: string, roll: number) =>
      strike(pet(1, TARGET), wearing(talent(key)).unit, mainSkill(TARGET), 1, 0, {
        random: new Rolls2({ [key]: roll }),
      });
    expect([hit("V4-TRAIT-00", 29), hit("V4-TRAIT-00", 30)]).toEqual([
      plain - Math.trunc((plain * 50) / 100),
      plain,
    ]);
    expect([hit("V4-TRAIT-03", 29), hit("V4-TRAIT-03", 30)]).toEqual([
      plain + Math.trunc((plain * 50) / 100),
      plain,
    ]);
  });

  it("V4-TRAIT-01: a fainting blow is survived at 30% HP on 40% of rolls, once a battle", () => {
    const killer = () => pet(1, TARGET, 100, 2000);
    const saved = wearing(talent("V4-TRAIT-01")).unit;
    strike(killer(), saved, mainSkill(TARGET), 1, 0, { random: new Rolls2({ "V4-TRAIT-01": 39 }) });
    expect([saved.alive(), saved.hp()]).toEqual([true, 300]);
    strike(killer(), saved, mainSkill(TARGET), 2, 0, { random: new Rolls2({ "V4-TRAIT-01": 0 }) });
    expect(saved.alive()).toBe(false);
    const unlucky = wearing(talent("V4-TRAIT-01")).unit;
    strike(killer(), unlucky, mainSkill(TARGET), 1, 0, {
      random: new Rolls2({ "V4-TRAIT-01": 40 }),
    });
    expect(unlucky.alive()).toBe(false);
  });

  it("V4-TRAIT-04: the first drop under 30% costs 30% more on 40% of rolls, never below 1", () => {
    const drop = (roll: number, hp = 400) => {
      const unit = wearing(talent("V4-TRAIT-04")).unit;
      unit.setHp(hp);
      const dealt = strike(pet(1, TARGET), unit, mainSkill(TARGET), 1, 0, {
        random: new Rolls2({ "V4-TRAIT-04": roll }),
      });
      return { unit, dealt };
    };
    const plain = strike(pet(1, TARGET), pet(0, TARGET), mainSkill(TARGET));
    // From 400 the hit leaves 260 (under 30%); 30% more would pass zero, so it stops at 1.
    expect(drop(39).unit.hp()).toBe(1);
    expect(drop(40).dealt).toBe(plain);
    // From higher up there is room: 1000 → 1000 − hit is not under 30%, nothing happens.
    expect(drop(0, 1000).dealt).toBe(plain);
    const once = drop(0);
    once.unit.setHp(400);
    const again = strike(pet(1, TARGET), once.unit, mainSkill(TARGET), 2, 0, {
      random: new Rolls2({ "V4-TRAIT-04": 0 }),
    });
    expect(again).toBe(plain);
  });

  it("V4-TRAIT-02 / 05: the award multiplier is ×1.5 / ×0.5", () => {
    const multiplier = (key: string) => {
      const { unit, seats } = wearing(talent(key));
      return seats.projectExperience(unit, unit.formationSlot, 1, 0);
    };
    expect(multiplier("V4-TRAIT-02")).toEqual({ multiplierPercent: 150, stackable: false });
    expect(multiplier("V4-TRAIT-05")).toEqual({ multiplierPercent: 50, stackable: false });
  });
});
