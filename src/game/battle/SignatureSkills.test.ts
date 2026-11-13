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
const { SIGNATURE_HANDLERS } = await import("./SignatureSkills");
type StatusUnit = import("./StatusState").StatusUnit;

const data = new GameData(await Pack.load());
const [web, java] = await Promise.all([
  loadBattleRules(data),
  loadBattleRules(data, { web: false }),
]);
const effects = web.status,
  signatures = web.web!.signatures!;

/** Every roll answers `value`; crit and jitter stay off and every hit lands. */
class FixedRandom extends BattleRandom {
  constructor(private readonly value: number) {
    super();
  }
  override percent(label: string): number {
    return /crit|jitter|hitroll/.test(label) ? 99 : this.value;
  }
}

/**
 * Attack 200 into defense 60: a 100-Power hit is 140. The pets carry a species outside the element
 * chart, so a unified skill (which attacks with its own element family) meets no relation.
 */
function unit(side: number, base: Partial<{ hp: number; speed: number; defense: number }> = {}) {
  return effects.unit({
    speciesId: -1,
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
    rules: web,
    random: new FixedRandom(roll),
    attackerSpriteId: -2,
    receiverSpriteId: -2,
    allowsHpFloor: false,
    postSkill: resolveP7PostSkill,
  });
}

/** Hit `skillId` from a fresh pair and report the damage dealt. */
function dealt(skillId: number, prep?: (a: StatusUnit, b: StatusUnit) => void, roll = 0) {
  const a = unit(0),
    b = unit(1);
  prep?.(a, b);
  const before = b.hp();
  strike(a, b, skillId, roll);
  return { a, b, damage: before - b.hp() };
}

describe("the signature catalog", () => {
  it("reads all 258 PD-SIG records into the twelve handlers, and Phệ Thuẫn U Minh", async () => {
    const records = await data.petDesignSkills(),
      seen = new Set<string>();
    for (const record of records) {
      expect(signatures.has(record.runtimeId)).toBe(true);
      seen.add(signatures.spec(record.runtimeId)!.handler);
    }
    expect(records.length).toBe(258);
    expect([...seen].sort()).toEqual([...SIGNATURE_HANDLERS].sort());
    expect(signatures.has(2000)).toBe(true);
  });

  it("the Java-parity formula still refuses them; the web rules resolve them", () => {
    expect(() => resolveP7Strike({ ...strikeRequest(1000), rules: java })).toThrow(/unified-v5/);
    expect(dealt(1000).damage).toBeGreaterThan(0);
  });

  it("a signature is usable, a sacrifice only with the HP to pay", () => {
    const a = unit(0);
    expect(web.web!.skillUsable(web.damage.skillRow(1000), a)).toBe(true);
    expect(web.web!.skillUsable(web.damage.skillRow(1001), a)).toBe(true);
    a.setHp(180);
    expect(web.web!.skillUsable(web.damage.skillRow(1001), a)).toBe(false);
  });
});

function strikeRequest(skillId: number) {
  return {
    attacker: unit(0),
    receiver: unit(1),
    skillId,
    rules: web,
    random: new FixedRandom(0),
    attackerSpriteId: -2,
    receiverSpriteId: -2,
    allowsHpFloor: false,
  };
}

describe("the twelve handlers", () => {
  it("SCOUT: Power 140 when it moves first, else 115; then Linh xảo +10%", () => {
    const fast = unit(0, { speed: 120 }),
      slow = unit(0, { speed: 80 }),
      b1 = unit(1),
      b2 = unit(1);
    strike(fast, b1, 1000);
    strike(slow, b2, 1000);
    expect(1000 - b1.hp()).toBe(196);
    expect(1000 - b2.hp()).toBe(161);
    expect(fast.currentStats.speed).toBe(132);
  });

  it("SACRIFICE: Power 190, then pays 18% of max HP and never drops itself below 1", () => {
    const { a, damage } = dealt(1001);
    expect(damage).toBe(266);
    expect(a.hp()).toBe(820);
  });

  it("BRUISER: Sức mạnh +10% on the user, or Nhụt Chí 10% on the target", () => {
    const strength = dealt(1002);
    expect(strength.damage).toBe(175);
    expect(strength.a.currentStats.attack).toBe(220);
    const pressure = dealt(1007);
    expect(pressure.b.hasDebuff(6)).toBe(true);
    expect(pressure.b.statuses.get(DEBUFF_BANK, 6)!.primaryValue).toBe(10);
  });

  it("EXEC: Power 200 into a target under 35% HP, 135 otherwise", () => {
    expect(dealt(1003).damage).toBe(189);
    expect(dealt(1003, (_, b) => b.setHp(340)).damage).toBe(280);
  });

  it("COUNTER: the hit leaves a one-turn 20% counter stance capped at 5% max HP", () => {
    const { a, damage } = dealt(1006);
    expect(damage).toBe(147);
    const stance = a.statuses.get(BUFF_BANK, 16)!;
    expect([stance.remainingTurns, stance.primaryValue, stance.secondaryValue]).toEqual([1, 20, 5]);
  });

  it("BURST: Power 190 above 60% of its own HP; a family-charge burst spends the charge", () => {
    expect(dealt(1008).damage).toBe(266);
    expect(dealt(1008, (a) => a.setHp(600)).damage).toBe(217);
    expect(dealt(1106).damage).toBe(217);
    expect(
      dealt(1106, (a, b) => effects.pendingDebuffFromProducer(a, b, 1, 0)!.commit()).damage,
    ).toBe(266);
  });

  it("WALL: DEF +20% and a shield of 8% max HP, which soaks the next hit first", () => {
    const a = unit(0),
      b = unit(1);
    strike(a, a, 1009);
    expect(a.currentStats.defense).toBe(72);
    expect(a.shieldHp()).toBe(80);
    strike(b, a, 0, 99);
    // 200 − 72 = 128: the shield takes 80 of it.
    expect(a.hp()).toBe(1000 - 48);
    expect(a.shieldHp()).toBe(0);
  });

  it("CONTROL: Giam Cầm on 100%, Ngủ on its 65%, never refreshing one already there", () => {
    const bound = dealt(1012);
    expect(bound.damage).toBe(126);
    expect(bound.b.statuses.has(RAINBOW_BANK, 4)).toBe(true);
    expect(web.web!.switchAndItemsLocked(bound.b)).toBe(true);
    expect(dealt(1030, undefined, 64).b.statuses.has(RAINBOW_BANK, 8)).toBe(true);
    expect(dealt(1030, undefined, 65).b.statuses.has(RAINBOW_BANK, 8)).toBe(false);
    const slowed = dealt(1050);
    expect(slowed.b.currentStats.speed).toBe(80);
  });

  it("HEAL: 22% max HP, 28% when its condition holds; a cleanse heal needs a debuff to remove", () => {
    const heal = (skillId: number, prep?: (a: StatusUnit) => void) => {
      const a = unit(0);
      a.setHp(200);
      prep?.(a);
      const before = a.hp();
      strike(a, a, skillId);
      return a.hp() - before;
    };
    expect(heal(1024)).toBe(280); // target (itself) under 40%
    expect(heal(1016, (a) => a.setHp(400))).toBe(220); // not under 30%
    expect(heal(1031)).toBe(220);
    expect(heal(1031, (a) => effects.pendingDebuffFromProducer(unit(1), a, 1, 0)!.commit())).toBe(
      280,
    );
  });

  it("DOT: plants its status if absent; if present, Power 85 + 45 and no refresh", () => {
    const first = dealt(1023);
    expect(first.damage).toBe(119);
    expect(first.b.statuses.has(RAINBOW_BANK, 5)).toBe(true);
    const a = first.a,
      b = first.b,
      before = b.hp();
    b.statuses.get(RAINBOW_BANK, 5)!.remainingTurns = 1;
    strike(a, b, 1023);
    expect(before - b.hp()).toBe(182);
    expect(b.statuses.get(RAINBOW_BANK, 5)!.remainingTurns).toBe(1);
    expect(dealt(1241).b.statuses.get(RAINBOW_BANK, 7)!.primaryValue).toBe(4);
  });

  it("PIVOT: the hit marks a pending switch carrying a 4% shield, unless Giam Cầm holds it", () => {
    const design = (side: number) =>
      web.traits.unit({
        speciesId: 68,
        ownerSide: side,
        formationSlot: 0,
        base: { hp: 1000, attack: 200, defense: 60, speed: 100 },
      });
    const a = design(0),
      b = design(1);
    strike(a, b, 1029);
    expect(1000 - b.hp()).toBe(98);
    expect(a.signatureState.pendingPivot).toBe(true);
    expect(a.signatureState.pivotShieldPct).toBe(4);
    const held = design(0);
    web.web!.applyRainbowDebuff(held, 4, { turns: 2 });
    strike(held, design(1), 1029);
    expect(held.signatureState.pendingPivot).toBe(false);
  });

  it("DISPEL: ignores 20% DEF; Power 155 and one buff gone when the target had one", () => {
    // Defense 60 pierced by 20% is 48: a 100-Power hit would be 152.
    expect(dealt(1037).damage).toBe(190);
    const buffed = dealt(1037, (_, b) => {
      effects.applySourceBuff(b, 7, 42);
      effects.applySourceBuff(b, 4, 21);
    });
    expect(buffed.b.hasBuff(4)).toBe(false);
    expect(buffed.b.hasBuff(7)).toBe(true);
  });
});

describe("Phệ Thuẫn U Minh (2000)", () => {
  it("Power 110 into an unshielded target, 220 into a shielded one, the shield taking its share first", () => {
    expect(dealt(2000).damage).toBe(154);
    const a = unit(0),
      b = unit(1);
    strike(b, b, 1009);
    expect(b.shieldHp()).toBe(80);
    strike(a, b, 2000);
    // 200 − 72 = 128 × 220% = 281: 80 into the shield, 201 into HP.
    expect(b.shieldHp()).toBe(0);
    expect(b.hp()).toBe(1000 - 201);
  });
});
