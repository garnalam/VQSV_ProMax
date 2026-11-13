import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Every pet-design signature skill, one handler group at a time: the numbers its description names,
 * the numbers its `mechanicsJson` stores and what a live strike measures must all agree. A group's
 * block lists every skill that disagrees, so one bad record names itself.
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
const { SignatureSkills } = await import("./SignatureSkills");
type StatusUnit = import("./StatusState").StatusUnit;
type DesignTraitUnit = import("./DesignTraits").DesignTraitUnit;
type PackSkill = import("../../data/GameData").PackSkill;

const data = new GameData(await Pack.load());
const rules = await loadBattleRules(data);
const records = await data.petDesignSkills();

/** Every roll answers `value`; crit and jitter stay off and every hit lands. */
class FixedRandom extends BattleRandom {
  constructor(private readonly value: number) {
    super();
  }
  override percent(label: string): number {
    return /crit|jitter|hitroll/.test(label) ? 99 : this.value;
  }
}

/** Attack 200 into defense 60: a hit of Power P deals trunc(140 × P / 100). */
const RAW = 140;
/**
 * The power checks run element-neutral: a unified skill attacks with its own element family
 * (`relationTo(target, skill)`), so the test pets carry a species id outside the element chart —
 * no element on either side, no relation multiplier — and every hit reads its Power directly.
 */
const NEUTRAL_SPECIES = -1;
function unit(side: number, base: Partial<{ hp: number; speed: number }> = {}): StatusUnit {
  return rules.status.unit({
    speciesId: NEUTRAL_SPECIES,
    ownerSide: side,
    formationSlot: 0,
    base: { hp: 1000, attack: 200, defense: 60, speed: 100, ...base },
  });
}
function strike(attacker: StatusUnit, receiver: StatusUnit, skillId: number, roll = 0): void {
  resolveP7Strike({
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
/** A unit of `speciesId` carrying its design trait, for strikes walked through the trait projection. */
function traitUnit(
  side: number,
  speciesId: number,
  attack = 200,
  physicalTraitId?: number,
): DesignTraitUnit {
  const made = rules.traits.unit({
    speciesId,
    ownerSide: side,
    formationSlot: 0,
    base: { hp: 1000, attack, defense: 60, speed: 100 },
    physicalTraitId,
  });
  made.restoreStatsForCheck();
  return made;
}
/** A strike walked through the fight's trait projection, as the runtime walks it. */
function traitStrike(
  attacker: DesignTraitUnit,
  receiver: DesignTraitUnit,
  skillId: number,
  random: InstanceType<typeof BattleRandom> = new FixedRandom(0),
): void {
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
      projection: rules.newTraitProjection((label) => random.percent(label)),
      attacker,
      receiver,
      attackerSlot: 1,
      receiverSlot: 0,
      roundIndex: 1,
      actedFirst: true,
    },
  });
}
/** Dấu tích, the family charge a trait builds and a "tiêu dấu" burst spends. */
const FAMILY_CHARGE = 17;
/** The species that learn `stableKey`, from the learnsets and the design traits' pet → species. */
function owners(stableKey: string): number[] {
  const read = (file: string) =>
      JSON.parse(
        readFileSync(
          resolve(import.meta.dirname, "../../../public/pack/data/battle", file),
          "utf8",
        ),
      ),
    learnsets = read("skill-learnsets.json") as Record<string, { skillKey: string }[]>,
    traits = read("pet-design-traits.json") as { petKey: string; speciesId: number }[],
    species = new Map(traits.map((t) => [t.petKey, t.speciesId]));
  return Object.entries(learnsets)
    .filter(([, list]) => list.some((entry) => entry.skillKey === stableKey))
    .map(([pet]) => species.get(pet)!)
    .filter((id) => id !== undefined);
}
/**
 * The hit a Power lands: the skill attacks with its own element family, so a species-68 target
 * (`traitUnit`) takes the skill's relation to 68; a neutral `unit()` takes none.
 */
const hit = (power: number, record: PackSkill, target?: { speciesId: number }) =>
  rules.damage.applyRelationTo(
    rules.damage.relationFor(
      NEUTRAL_SPECIES,
      target?.speciesId ?? NEUTRAL_SPECIES,
      record.runtimeId,
    ),
    Math.trunc((RAW * power) / 100),
  );
const mechanics = (record: PackSkill) => JSON.parse(record.mechanicsJson) as Record<string, number>;
const group = (handler: string) =>
  records.filter((record) => JSON.parse(record.mechanicsJson).handler === handler);
/** The numbers a description names, in reading order. */
const numbers = (record: PackSkill, pattern: RegExp): number[] => {
  const match = pattern.exec(record.description);
  if (!match) throw new Error(`${record.stableKey}: description does not read "${pattern}"`);
  return match.slice(1).flatMap((value) => (value === undefined ? [] : [Number(value)]));
};

describe("signature effects", () => {
  it("every one of the 258 skills plays an effect built from sprite states the world pack has", () => {
    const sprites = (
      JSON.parse(
        readFileSync(
          resolve(import.meta.dirname, "../../../public/pack/world/sprites.json"),
          "utf8",
        ),
      ) as { sprites: Record<string, { states: Record<string, unknown[]> }> }
    ).sprites;
    const wrong: string[] = [];
    expect(records.length).toBe(258);
    for (const record of records) {
      if (!rules.signatureFx.has(record.stableKey)) wrong.push(`${record.stableKey}: no effect`);
      for (const event of rules.signatureFx.document.skills[record.stableKey]?.events ?? []) {
        const [sprite, state, , start, end] = event;
        if (!sprites[sprite]?.states[state]?.length)
          wrong.push(`${record.stableKey}: sprite ${sprite}.${state} missing`);
        if (end <= start || end > rules.signatureFx.totalTicks(record.stableKey))
          wrong.push(`${record.stableKey}: event ${sprite} ${start}..${end}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("SCOUT (first_move_speed_attack)", () => {
  const skills = group("first_move_speed_attack"),
    pattern =
      /^Power (\d+); nếu đi trước: Power (\d+)\. Sau đòn trúng, Linh xảo \+(\d+)% trong (\d+) lượt, không cộng dồn$/;

  it("has 35 skills, every one described in the same words", () => {
    expect(skills.length).toBe(35);
    for (const record of skills) expect(record.description).toMatch(pattern);
  });

  it("description, record and live strike agree for every skill", () => {
    const wrong: string[] = [];
    for (const record of skills) {
      const [power, first, speedPct, turns] = numbers(record, pattern),
        m = mechanics(record);
      if (
        power !== record.power ||
        first !== m.conditionalPower ||
        speedPct !== m.speedPct ||
        turns !== m.durationTurns
      )
        wrong.push(
          `${record.stableKey}: record ${record.power}/${m.conditionalPower}/${m.speedPct}/${m.durationTurns}`,
        );
      const slow = unit(0, { speed: 80 }),
        fast = unit(0, { speed: 120 }),
        b1 = unit(1),
        b2 = unit(1);
      strike(slow, b1, record.runtimeId);
      strike(fast, b2, record.runtimeId);
      strike(fast, unit(1), record.runtimeId);
      const buff = fast.statuses.get(0, 7);
      if (1000 - b1.hp() !== hit(power, record, b1))
        wrong.push(
          `${record.stableKey}: second-mover hit ${1000 - b1.hp()} ≠ ${hit(power, record)}`,
        );
      if (1000 - b2.hp() !== hit(first, record, b2))
        wrong.push(
          `${record.stableKey}: first-mover hit ${1000 - b2.hp()} ≠ ${hit(first, record)}`,
        );
      // "+X% … không cộng dồn": two hits still leave one X% buff on the base 120.
      if (fast.currentStats.speed !== 120 + Math.trunc((120 * speedPct) / 100))
        wrong.push(`${record.stableKey}: speed ${fast.currentStats.speed}`);
      if (buff?.remainingTurns !== turns)
        wrong.push(`${record.stableKey}: buff turns ${buff?.remainingTurns}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe("BURST (conditional_burst)", () => {
  const skills = group("conditional_burst"),
    patterns: Record<string, RegExp> = {
      self_hp_above_60:
        /^Power (\d+); HP bản thân trên (\d+)%: Power (\d+)(?:\. Trả (\d+)% HP sau đòn, không tự gục)?$/,
      target_has_debuff: /^Power (\d+); địch đang có debuff: Power (\d+)$/,
      has_family_charge:
        /^Power (\d+); có (?:từ (\d+) )?đà\/dấu tích từ đặc tính \(tiêu dấu\): Power (\d+)$/,
    };
  const condition = (record: PackSkill) => JSON.parse(record.mechanicsJson).condition as string;

  /**
   * Java's `signature-skills.tsv` gives the four combo bursts one mark and the six charge, storm and
   * static ones two, and writes no number into the sentence. The stacks are declared here so a TSV edit
   * that asks a third mark — or starts naming one in the words — has to be read, not absorbed.
   */
  const FAMILY_CHARGE_STACKS: Record<string, number> = {
    "PD-SIG-10-BURST": 1,
    "PD-SIG-30-BURST": 2,
    "PD-SIG-43-BURST": 1,
    "PD-SIG-49-BURST": 2,
    "PD-SIG-72-BURST": 2,
    "PD-SIG-74-BURST": 1,
    "PD-SIG-79-BURST": 2,
    "PD-SIG-85-BURST": 2,
    "PD-SIG-91-BURST": 1,
    "PD-SIG-118-BURST": 2,
  };

  it("has 31 skills under three conditions, each described in its own words", () => {
    expect(skills.length).toBe(31);
    for (const record of skills) expect(record.description).toMatch(patterns[condition(record)]);
    const charged = skills.filter((record) => condition(record) === "has_family_charge");
    expect(
      Object.fromEntries(
        charged.map((record) => [record.stableKey, mechanics(record).minimumCharge]),
      ),
    ).toEqual(FAMILY_CHARGE_STACKS);
    for (const record of charged) expect(record.description).not.toMatch(/có từ \d+ đà/);
  });

  it("description, record and live strike agree for every skill", () => {
    const wrong: string[] = [];
    for (const record of skills) {
      const m = mechanics(record),
        key = record.stableKey,
        id = record.runtimeId,
        cond = condition(record),
        read = numbers(record, patterns[cond]);
      const power = read[0],
        conditional = cond === "self_hp_above_60" ? read[2] : read[read.length - 1];
      // "có từ N đà/dấu tích" would name the stack the burst spends. Java's ten sentences name none, so
      // the record is the only answer for them — and the third test grades the stack it asks for.
      if (cond === "has_family_charge" && read.length === 3 && read[1] !== m.minimumCharge)
        wrong.push(`${key}: minimum charge ${m.minimumCharge}, described ${read[1]}`);
      const cost = cond === "self_hp_above_60" ? (read[3] ?? 0) : 0;
      if (power !== record.power || conditional !== m.conditionalPower)
        wrong.push(`${key}: record ${record.power}/${m.conditionalPower}`);
      if (cost !== (m.selfHpCostPct ?? 0)) wrong.push(`${key}: cost ${m.selfHpCostPct}`);
      if (cond === "self_hp_above_60") {
        if (read[1] !== 60) wrong.push(`${key}: threshold ${read[1]}`);
        // Strictly above 60%: at 601 the burst, at exactly 600 the base.
        for (const [hp, want] of [
          [601, conditional],
          [600, power],
        ]) {
          const a = unit(0),
            b = unit(1);
          a.setHp(hp);
          strike(a, b, id);
          if (1000 - b.hp() !== hit(want, record, b))
            wrong.push(`${key}: at HP ${hp} hit ${1000 - b.hp()}`);
          const paid = hp - a.hp();
          if (paid !== Math.trunc((1000 * cost) / 100)) wrong.push(`${key}: paid ${paid} at ${hp}`);
        }
        if (cost > 0) {
          // "không tự gục": the price never takes the last point.
          const a = unit(0);
          a.setHp(30);
          strike(a, unit(1), id);
          if (a.hp() !== 1) wrong.push(`${key}: low-HP payer left at ${a.hp()}`);
        }
      }
      if (cond === "target_has_debuff") {
        const plain = unit(1),
          marked = unit(1);
        rules.status.pendingDebuffFromProducer(unit(0), marked, 1, 0)!.commit();
        strike(unit(0), plain, id);
        const before = marked.hp();
        strike(unit(0), marked, id);
        if (1000 - plain.hp() !== hit(power, record, plain))
          wrong.push(`${key}: clean target ${1000 - plain.hp()}`);
        if (before - marked.hp() < hit(conditional, record))
          wrong.push(`${key}: debuffed target ${before - marked.hp()}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  // Java read the condition after the owner's trait had spent the charge on its own bonus (combo,
  // utility, electric), and asked two marks of a utility trait that only ever holds one: seven of the ten
  // "tiêu dấu" bursts could never fire. The burst now takes the charge first, at the stack it names.
  it("each owner's burst fires on its described charge, and spends it", () => {
    const wrong: string[] = [];
    for (const record of skills.filter((r) => condition(r) === "has_family_charge")) {
      const conditional = mechanics(record).conditionalPower,
        minimum = mechanics(record).minimumCharge;
      for (const speciesId of owners(record.stableKey)) {
        const plain = traitUnit(1, 68),
          charged = traitUnit(1, 68),
          a = traitUnit(0, speciesId);
        traitStrike(traitUnit(0, speciesId), plain, record.runtimeId);
        for (let i = 0; i < minimum; i++) rules.traits.stack(a, FAMILY_CHARGE, 3, 3, 20);
        traitStrike(a, charged, record.runtimeId);
        const base = 1000 - plain.hp(),
          burst = 1000 - charged.hp();
        // The burst's own step: Power 155 → 190 on the same unit, whatever else the trait adds.
        if (Math.abs(burst * record.power - base * conditional) > conditional)
          wrong.push(`${record.stableKey} (species ${speciesId}): ${base} → charged ${burst}`);
        // Spent: what is left is at most the one mark a storm or electric trait builds after the hit.
        const left = a.statuses.get(0, FAMILY_CHARGE)?.stackCount ?? 0;
        if (left > 1) wrong.push(`${record.stableKey} (species ${speciesId}): ${left} marks left`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("WALL (defense_and_shield)", () => {
  const skills = group("defense_and_shield"),
    pattern =
      /^DEF \+(\d+)% và khiên (\d+)% HP tối đa trong (\d+) lượt\. Không cộng dồn; tẩy được$/,
    SHIELD = 15,
    DEFENSE_UP = 4,
    DISPEL_SKILL = 1037;

  it("has 31 skills, every one described in the same words", () => {
    expect(skills.length).toBe(31);
    for (const record of skills) expect(record.description).toMatch(pattern);
  });

  it("description, record and live cast agree for every skill", () => {
    const wrong: string[] = [];
    for (const record of skills) {
      const [defensePct, shieldPct, turns] = numbers(record, pattern),
        m = mechanics(record),
        key = record.stableKey,
        id = record.runtimeId;
      if (
        defensePct !== m.defensePct ||
        shieldPct !== m.shieldMaxHpPct ||
        turns !== m.durationTurns ||
        record.power !== 0
      )
        wrong.push(`${key}: record ${m.defensePct}/${m.shieldMaxHpPct}/${m.durationTurns}`);
      const defense = 60 + Math.trunc((60 * defensePct) / 100),
        shield = Math.trunc((1000 * shieldPct) / 100);
      // "Không cộng dồn": a second cast leaves the same DEF and the same shield.
      const a = traitUnit(0, 68);
      traitStrike(a, a, id);
      traitStrike(a, a, id);
      if (a.currentStats.defense !== defense) wrong.push(`${key}: DEF ${a.currentStats.defense}`);
      if (a.shieldHp() !== shield) wrong.push(`${key}: shield ${a.shieldHp()}`);
      // "trong N lượt": still standing after N − 1 round ends past the cast round, gone after N.
      const projection = rules.newTraitProjection(() => 0);
      projection.onRoundEnd(a, 1, 1, 0);
      for (let round = 2; round <= turns; round++) projection.onRoundEnd(a, 1, round, 0);
      if (a.currentStats.defense !== defense || a.shieldHp() !== shield)
        wrong.push(`${key}: gone before ${turns} turns`);
      projection.onRoundEnd(a, 1, turns + 1, 0);
      if (a.currentStats.defense !== 60 || a.shieldHp() !== 0)
        wrong.push(`${key}: DEF ${a.currentStats.defense} / shield ${a.shieldHp()} after ${turns}`);
      // "tẩy được": a dispel takes the DEF first, the next one the shield (a dispeller too weak to
      // dent the shield, so it is the dispel and not the hit that removes it).
      const b = traitUnit(0, 68);
      traitStrike(b, b, id);
      traitStrike(traitUnit(1, 68, 1), b, DISPEL_SKILL);
      if (b.statuses.has(0, DEFENSE_UP) || !b.statuses.has(0, SHIELD))
        wrong.push(`${key}: first dispel left DEF ${b.statuses.has(0, DEFENSE_UP)}`);
      traitStrike(traitUnit(1, 68, 1), b, DISPEL_SKILL);
      if (b.statuses.has(0, SHIELD)) wrong.push(`${key}: shield survives a second dispel`);
    }
    expect(wrong).toEqual([]);
  });
});

/** Each roll answers the first rule its label matches, else `fallback`; crit and jitter stay off. */
class Rolls extends BattleRandom {
  constructor(
    private readonly rules: [RegExp, number][],
    private readonly fallback = 0,
  ) {
    super();
  }
  override percent(label: string): number {
    for (const [pattern, value] of this.rules) if (pattern.test(label)) return value;
    return /crit|jitter|hitroll/.test(label) ? 99 : this.fallback;
  }
}

describe("CONTROL (damage_apply_control)", () => {
  const skills = group("damage_apply_control"),
    patterns: Record<string, RegExp> = {
      imprison:
        /^Power (\d+); Giam Cầm (\d+) lượt \(không đổi pet\/vật phẩm, vẫn đánh được\)\. Không làm mới khi còn trạng thái$/,
      sleep:
        /^Power (\d+); (\d+)% Ngủ (\d+) lượt, nhận damage trực tiếp sẽ tỉnh\. Không làm mới khi còn trạng thái$/,
      paralysis: /^Power (\d+); (\d+)% Tê Liệt (\d+) lượt\. Không làm mới khi còn trạng thái$/,
      speed_down:
        /^Power (\d+); giảm (\d+)% Linh xảo (\d+) lượt\. Không làm mới khi còn trạng thái$/,
      accuracy_down:
        /^Power (\d+); giảm (\d+)% chính xác (\d+) lượt\. Không làm mới khi còn trạng thái$/,
      damage_down:
        /^Power (\d+); giảm (\d+)% damage (\d+) lượt\. Không làm mới khi còn trạng thái$/,
    },
    KEYS: Record<string, [number, number]> = {
      imprison: [2, 4],
      sleep: [2, 8],
      paralysis: [1, 10],
      speed_down: [1, 5],
      accuracy_down: [1, 4],
      damage_down: [1, 6],
    },
    /** Chance-free statuses name no percent; their chance is the record's 100. */
    CHANCED = new Set(["sleep", "paralysis"]);
  const status = (record: PackSkill) => JSON.parse(record.mechanicsJson).status as string;
  const web = rules.web!;

  it("has 27 skills, each status described in its own words", () => {
    expect(skills.length).toBe(27);
    for (const record of skills) expect(record.description).toMatch(patterns[status(record)]);
  });

  it("description, record and live strike agree for every skill", () => {
    const wrong: string[] = [];
    for (const record of skills) {
      const m = mechanics(record),
        name = status(record),
        [bank, statusId] = KEYS[name],
        key = record.stableKey,
        id = record.runtimeId,
        read = numbers(record, patterns[name]);
      const power = read[0],
        turns = read[read.length - 1],
        chance = CHANCED.has(name) ? read[1] : 100,
        value = CHANCED.has(name) || name === "imprison" ? 0 : read[1];
      if (
        power !== record.power ||
        chance !== m.chancePct ||
        turns !== m.durationTurns ||
        value !== (m.valuePct ?? 0)
      )
        wrong.push(
          `${key}: record ${record.power}/${m.chancePct}/${m.valuePct}/${m.durationTurns}`,
        );
      const plant = (roll: number) => {
        const a = traitUnit(0, 68),
          b = traitUnit(1, 68);
        traitStrike(a, b, id, new Rolls([[/status/, roll]]));
        return { a, b };
      };
      // The chance: a roll under it plants, a roll at it does not; the hit is Power 90 either way.
      const { b } = plant(chance - 1);
      if (1000 - b.hp() !== hit(power, record, b)) wrong.push(`${key}: hit ${1000 - b.hp()}`);
      if (!b.statuses.has(bank, statusId)) wrong.push(`${key}: not planted at roll ${chance - 1}`);
      if (chance < 100 && plant(chance).b.statuses.has(bank, statusId))
        wrong.push(`${key}: planted at roll ${chance}`);
      // "Không làm mới khi còn trạng thái": a second hit leaves the running count alone.
      const held = b.statuses.get(bank, statusId)!;
      held.remainingTurns = 1;
      b.statuses.put(held);
      traitStrike(traitUnit(0, 68), b, id);
      if (b.statuses.get(bank, statusId)?.remainingTurns !== 1)
        wrong.push(`${key}: refreshed to ${b.statuses.get(bank, statusId)?.remainingTurns}`);
      // "N lượt": still there after N − 1 round ends past the cast round, gone after N.
      const aged = plant(0).b,
        projection = rules.newTraitProjection(() => 0);
      for (let round = 1; round <= turns; round++) projection.onRoundEnd(aged, 0, round, 0);
      if (!aged.statuses.has(bank, statusId)) wrong.push(`${key}: gone before ${turns} turns`);
      // Ngủ is counted in actions, not rounds: it lasts until the one action it takes (below).
      projection.onRoundEnd(aged, 0, turns + 1, 0);
      if (name !== "sleep" && aged.statuses.has(bank, statusId))
        wrong.push(`${key}: still there after ${turns}`);
      // What the status does.
      const hold = plant(0).b;
      switch (name) {
        case "imprison":
          if (!web.switchAndItemsLocked(hold)) wrong.push(`${key}: switch/items not locked`);
          if (web.beforeAction(hold, () => 0).blocked) wrong.push(`${key}: imprisoned cannot act`);
          break;
        case "sleep": {
          if (!web.beforeAction(hold, () => 99).blocked) wrong.push(`${key}: sleeper acts`);
          if (hold.statuses.has(bank, statusId)) wrong.push(`${key}: sleep outlives its action`);
          const woken = plant(0).b;
          traitStrike(traitUnit(0, 68), woken, 1000);
          if (woken.statuses.has(bank, statusId)) wrong.push(`${key}: a direct hit did not wake`);
          break;
        }
        case "paralysis":
          if (!web.beforeAction(hold, () => 24).blocked) wrong.push(`${key}: roll 24 still acts`);
          if (web.beforeAction(hold, () => 25).blocked) wrong.push(`${key}: roll 25 lost its turn`);
          break;
        case "speed_down":
          if (hold.currentStats.speed !== 100 - value)
            wrong.push(`${key}: speed ${hold.currentStats.speed}`);
          break;
        case "accuracy_down": {
          // Equal speeds leave no evasion of their own: the whole miss chance is the debuff's.
          const miss = traitUnit(1, 68),
            land = traitUnit(1, 68);
          traitStrike(hold, miss, 1000, new Rolls([[/hitroll/, value - 1]]));
          traitStrike(hold, land, 1000, new Rolls([[/hitroll/, value]]));
          if (miss.hp() !== 1000) wrong.push(`${key}: roll ${value - 1} still hits`);
          if (land.hp() === 1000) wrong.push(`${key}: roll ${value} misses`);
          break;
        }
        case "damage_down": {
          const victim = traitUnit(0, 68),
            plain = traitUnit(0, 68);
          traitStrike(hold, victim, 1000);
          traitStrike(traitUnit(1, 68), plain, 1000);
          const full = 1000 - plain.hp(),
            cut = full - Math.trunc((full * value) / 100);
          if (1000 - victim.hp() !== cut) wrong.push(`${key}: ${1000 - victim.hp()} ≠ ${cut}`);
          break;
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("COUNTER (damage_counter_stance)", () => {
  const skills = group("damage_counter_stance"),
    pattern =
      /^Power (\d+); đòn trực tiếp kế tiếp làm mất HP trong (\d+) lượt bị phản (\d+)% damage thực, tối đa (\d+)% HP tối đa người dùng\. Không phản hit phụ\/DOT\/phản đòn$/,
    STANCE = 16,
    BLEED_SKILL = 1241;

  it("has 24 skills, every one described in the same words", () => {
    expect(skills.length).toBe(24);
    for (const record of skills) expect(record.description).toMatch(pattern);
  });

  it("description, record and live strikes agree for every skill", () => {
    const wrong: string[] = [];
    for (const record of skills) {
      const [power, turns, pct, cap] = numbers(record, pattern),
        m = mechanics(record),
        key = record.stableKey,
        id = record.runtimeId;
      if (
        power !== record.power ||
        turns !== m.counterDurationTurns ||
        pct !== m.counterIncomingPct ||
        cap !== m.counterIncomingMaxHpCapPct ||
        m.counterHits !== 1
      )
        wrong.push(`${key}: record ${record.power}/${m.counterDurationTurns}/${pct}/${cap}`);
      /** The user takes the stance by hitting `foe`; `attack` sets how hard the foe answers. */
      const stance = (attack = 200) => {
        const user = traitUnit(0, 68),
          foe = traitUnit(1, 68, attack);
        traitStrike(user, foe, id);
        return { user, foe, foeHp: foe.hp() };
      };
      {
        const { user, foe, foeHp } = stance();
        if (1000 - foeHp !== hit(power, record, foe)) wrong.push(`${key}: hit ${1000 - foeHp}`);
        // The next direct hit: 20% of what the user lost comes back; the stance is spent.
        traitStrike(foe, user, 1000);
        const lost = 1000 - user.hp(),
          back = Math.min(Math.trunc((lost * pct) / 100), Math.trunc((1000 * cap) / 100));
        if (foeHp - foe.hp() !== back)
          wrong.push(`${key}: reflected ${foeHp - foe.hp()} ≠ ${back}`);
        if (user.statuses.has(0, STANCE)) wrong.push(`${key}: stance outlives its counter`);
        const after = foe.hp();
        traitStrike(foe, user, 1000);
        if (foe.hp() !== after) wrong.push(`${key}: countered twice`);
      }
      {
        // "tối đa 5% HP tối đa người dùng": a heavy hit sends back no more than 50 of 1000.
        const { user, foe, foeHp } = stance(400);
        traitStrike(foe, user, 1000);
        if (foeHp - foe.hp() !== Math.trunc((1000 * cap) / 100))
          wrong.push(`${key}: capped reflect ${foeHp - foe.hp()}`);
      }
      {
        // "làm mất HP": a hit the shield swallows whole leaves the stance waiting.
        const { user, foe, foeHp } = stance();
        traitStrike(user, user, 1009);
        const shield = user.statuses.get(0, 15)!;
        shield.primaryValue = 900;
        user.statuses.put(shield);
        traitStrike(foe, user, 1000);
        if (user.hp() !== 1000) wrong.push(`${key}: the shield let ${1000 - user.hp()} through`);
        if (foe.hp() !== foeHp) wrong.push(`${key}: a fully shielded hit was countered`);
        if (!user.statuses.has(0, STANCE)) wrong.push(`${key}: a shielded hit spent the stance`);
      }
      {
        // "Không phản phản đòn": two stances — the user's counter does not set off the foe's.
        const { user, foe } = stance();
        traitStrike(foe, traitUnit(0, 68), id);
        const foeHp = foe.hp(),
          userBefore = user.hp();
        traitStrike(foe, user, 1000);
        const lost = userBefore - user.hp(),
          back = Math.min(Math.trunc((lost * pct) / 100), Math.trunc((1000 * cap) / 100));
        if (foeHp - foe.hp() !== back) wrong.push(`${key}: counter chain ${foeHp - foe.hp()}`);
        if (user.hp() !== userBefore - lost) wrong.push(`${key}: counter countered`);
      }
      {
        // "Không phản DOT": the user bleeds at the round end; nothing goes back to the foe.
        const user = traitUnit(0, 68),
          foe = traitUnit(1, 68);
        traitStrike(foe, user, BLEED_SKILL);
        traitStrike(user, foe, id);
        const foeHp = foe.hp(),
          userHp = user.hp(),
          projection = rules.newTraitProjection(() => 0);
        for (let round = 1; round <= 3; round++) projection.onRoundEnd(user, 1, round, 0);
        if (user.hp() >= userHp) wrong.push(`${key}: the bleed never ticked`);
        if (foe.hp() !== foeHp) wrong.push(`${key}: a bleed tick was countered`);
      }
      {
        // "trong N lượt": gone after N round ends past the cast round, unused.
        const { user } = stance(),
          projection = rules.newTraitProjection(() => 0);
        for (let round = 1; round <= turns; round++) projection.onRoundEnd(user, 1, round, 0);
        if (!user.statuses.has(0, STANCE)) wrong.push(`${key}: stance gone before ${turns}`);
        projection.onRoundEnd(user, 1, turns + 1, 0);
        if (user.statuses.has(0, STANCE)) wrong.push(`${key}: stance still up after ${turns}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("HEAL (heal_with_family_condition)", () => {
  const skills = group("heal_with_family_condition"),
    tail = "; chịu chống hồi\\.$",
    head = "^Hồi (\\d+)% HP tối đa mục tiêu; thêm (\\d+)% nếu ",
    patterns: Record<string, RegExp> = {
      self_hp_below_30: new RegExp(head + "bản thân dưới (\\d+)% HP" + tail),
      target_hp_below_40: new RegExp(head + "mục tiêu dưới (\\d+)% HP" + tail),
      has_reserve: new RegExp(head + "có dự trữ \\(tiêu dự trữ\\)" + tail),
      removed_one_debuff: new RegExp(
        head + "thực sự tẩy (\\d+) debuff\\. Tẩy (\\d+) debuff trước hồi" + tail,
      ),
      target_is_charmed_or_asleep: new RegExp(head + "địch đang Mị Hoặc\\/Ngủ" + tail),
    },
    RESERVE = 18,
    /** TC-09: the talent that takes 25% off every heal its pet receives. */
    LESS_HEALING = 9;
  const condition = (record: PackSkill) => JSON.parse(record.mechanicsJson).condition as string;

  it("has 24 skills under five conditions, each described in its own words", () => {
    expect(skills.length).toBe(24);
    for (const record of skills) expect(record.description).toMatch(patterns[condition(record)]);
  });

  it("description, record and live heal agree for every skill", () => {
    const wrong: string[] = [];
    for (const record of skills) {
      const m = mechanics(record),
        cond = condition(record),
        key = record.stableKey,
        id = record.runtimeId,
        [healPct, bonusPct, third] = numbers(record, patterns[cond]);
      if (healPct !== m.healMaxHpPct || bonusPct !== m.bonusHealPct || record.power !== 0)
        wrong.push(`${key}: record ${m.healMaxHpPct}/${m.bonusHealPct}`);
      if (cond === "removed_one_debuff" && third !== m.cleanseCount)
        wrong.push(`${key}: cleanse ${m.cleanseCount}`);
      const base = Math.trunc((1000 * healPct) / 100),
        raised = Math.trunc((1000 * (healPct + bonusPct)) / 100);
      /** The user, both seated in a fight against `foe`, heals itself from `hp`. */
      const heal = (hp: number, prep?: (user: DesignTraitUnit, foe: DesignTraitUnit) => void) => {
        const user = traitUnit(0, 68),
          foe = traitUnit(1, 68),
          seats = rules.newTraitProjection(() => 0);
        seats.onBattleEnter(user, 1, 1, 0);
        seats.onBattleEnter(foe, 0, 1, 0);
        user.setHp(hp);
        prep?.(user, foe);
        const before = user.hp();
        traitStrike(user, user, id);
        return { healed: user.hp() - before, user, foe };
      };
      if (heal(500).healed !== base) wrong.push(`${key}: plain heal ${heal(500).healed}`);
      switch (cond) {
        case "self_hp_below_30":
        case "target_hp_below_40": {
          // "dưới N%": strictly below — N% itself is the plain heal.
          const edge = 10 * third;
          if (heal(edge - 1).healed !== raised) wrong.push(`${key}: at ${edge - 1}`);
          if (heal(edge).healed !== base) wrong.push(`${key}: at ${edge}`);
          break;
        }
        case "has_reserve": {
          const used = heal(500, (user) => rules.traits.stack(user, RESERVE, 4, 3, 20));
          if (used.healed !== raised) wrong.push(`${key}: with reserve ${used.healed}`);
          if (used.user.statuses.has(0, RESERVE)) wrong.push(`${key}: reserve not spent`);
          break;
        }
        case "removed_one_debuff": {
          const cleansed = heal(500, (user, foe) =>
            rules.status.pendingDebuffFromProducer(foe, user, 1, 0)!.commit(),
          );
          if (cleansed.healed !== raised) wrong.push(`${key}: after a cleanse ${cleansed.healed}`);
          if (cleansed.user.activeDebuffCount() !== 0) wrong.push(`${key}: debuff left`);
          break;
        }
        case "target_is_charmed_or_asleep":
          for (const [name, statusId] of [
            ["Ngủ", 8],
            ["Mị Hoặc", 3],
          ] as const) {
            const raisedBy = heal(500, (_, foe) =>
              rules.web!.applyRainbowDebuff(foe, statusId, { turns: 2 }),
            );
            if (raisedBy.healed !== raised) wrong.push(`${key}: foe ${name} ${raisedBy.healed}`);
            // It is the foe's state that counts, not the healer's own.
            const self = heal(500, (user) =>
              rules.web!.applyRainbowDebuff(user, statusId, { turns: 2 }),
            );
            if (self.healed !== base) wrong.push(`${key}: own ${name} ${self.healed}`);
          }
          break;
      }
      // "chịu chống hồi": TC-09 takes a quarter off; and no heal goes past full HP.
      {
        const user = traitUnit(0, 68, 200, LESS_HEALING);
        user.setHp(500);
        traitStrike(user, user, id);
        const want = base - Math.trunc((base * 25) / 100);
        if (user.hp() - 500 !== want)
          wrong.push(`${key}: under TC-09 ${user.hp() - 500} ≠ ${want}`);
      }
      if (heal(950).user.hp() !== 1000) wrong.push(`${key}: healed past full`);
    }
    expect(wrong).toEqual([]);
  });
});

describe("DOT (damage_apply_or_cash_dot)", () => {
  const skills = group("damage_apply_or_cash_dot"),
    patterns: Record<string, RegExp> = {
      seed: /^Power (\d+); đặt Gieo Hạt (\d+) lượt \((\d+)% HP\/lượt\) nếu chưa có; nếu đã có, Power (\d+) và không làm mới\/xóa DOT$/,
      corrosion:
        /^Power (\d+); đặt Hủ Thực (\d+) lượt \((\d+)%\/(\d+)%\/(\d+)% HP\) nếu chưa có; nếu đã có, Power (\d+) và không làm mới\/xóa DOT$/,
      bleed:
        /^Power (\d+); đặt Xé Rách (\d+) lượt \((\d+)% HP\/lượt\) nếu chưa có; nếu đã có, Power (\d+) và không làm mới\/xóa DOT$/,
    },
    KEYS: Record<string, [number, number]> = { seed: [1, 0], corrosion: [2, 5], bleed: [2, 7] };
  const status = (record: PackSkill) => JSON.parse(record.mechanicsJson).status as string;

  it("has 18 skills under three DOTs, each described in its own words", () => {
    expect(skills.length).toBe(18);
    for (const record of skills) expect(record.description).toMatch(patterns[status(record)]);
  });

  it("description, record and live strikes and ticks agree for every skill", () => {
    const wrong: string[] = [];
    for (const record of skills) {
      const m = mechanics(record) as unknown as Record<string, number | number[]>,
        name = status(record),
        [bank, statusId] = KEYS[name],
        key = record.stableKey,
        id = record.runtimeId,
        read = numbers(record, patterns[name]);
      const power = read[0],
        turns = read[1],
        cash = read[read.length - 1],
        ticks =
          name === "corrosion" ? read.slice(2, 5) : Array.from({ length: turns }, () => read[2]);
      if (
        power !== record.power ||
        turns !== m.durationTurns ||
        cash !== power + (m.activeDotBonusPower as number) ||
        JSON.stringify(ticks) !== JSON.stringify(m.tickMaxHpPct) ||
        m.consumeDot !== (false as unknown)
      )
        wrong.push(`${key}: record ${JSON.stringify(m.tickMaxHpPct)}/${m.activeDotBonusPower}`);
      const user = traitUnit(0, 68),
        foe = traitUnit(1, 68);
      traitStrike(user, foe, id);
      if (1000 - foe.hp() !== hit(power, record, foe))
        wrong.push(`${key}: first hit ${1000 - foe.hp()}`);
      const planted = foe.statuses.get(bank, statusId);
      if (!planted) {
        wrong.push(`${key}: no ${name}`);
        continue;
      }
      // Already there: Power 130, and the running DOT is neither refreshed nor removed.
      planted.remainingTurns = 2;
      foe.statuses.put(planted);
      const before = foe.hp();
      traitStrike(user, foe, id);
      if (before - foe.hp() !== hit(cash, record, foe))
        wrong.push(`${key}: cash hit ${before - foe.hp()}`);
      if (foe.statuses.get(bank, statusId)?.remainingTurns !== 2)
        wrong.push(`${key}: DOT now ${foe.statuses.get(bank, statusId)?.remainingTurns} turns`);
      // The ticks, round by round, on a fresh target: the described % of max HP, then gone.
      const target = traitUnit(1, 68),
        projection = rules.newTraitProjection(() => 0);
      traitStrike(traitUnit(0, 68), target, id);
      projection.onRoundEnd(target, 0, 1, 0);
      const seen: number[] = [];
      for (let round = 2; round <= turns + 2; round++) {
        const hp = target.hp();
        projection.onRoundEnd(target, 0, round, 0);
        if (hp !== target.hp()) seen.push(((hp - target.hp()) * 100) / 1000);
      }
      if (JSON.stringify(seen) !== JSON.stringify(ticks))
        wrong.push(`${key}: ticks ${JSON.stringify(seen)} ≠ ${JSON.stringify(ticks)}`);
      if (target.statuses.has(bank, statusId)) wrong.push(`${key}: ${name} outlives its turns`);
    }
    expect(wrong).toEqual([]);
  });
});

describe("EXEC (conditional_execute)", () => {
  const skills = group("conditional_execute"),
    pattern =
      /^Power (\d+); mục tiêu dưới (\d+)% HP: Power (\d+)(?:, hút (\d+)% damage thật, tối đa (\d+)% HP bản thân)?\. Không hạ gục tức thì$/;

  it("has 17 skills, every one described in the same words", () => {
    expect(skills.length).toBe(17);
    for (const record of skills) expect(record.description).toMatch(pattern);
  });

  it("description, record and live strike agree for every skill", () => {
    const wrong: string[] = [];
    for (const record of skills) {
      const [power, below, conditional, drain = 0, cap = 0] = numbers(record, pattern),
        m = mechanics(record),
        key = record.stableKey,
        id = record.runtimeId;
      if (
        power !== record.power ||
        below !== m.targetHpBelowPct ||
        conditional !== m.conditionalPower ||
        drain !== m.lowHpTargetHealPct ||
        (drain > 0 && cap !== m.healCapMaxHpPct)
      )
        wrong.push(`${key}: record ${m.targetHpBelowPct}/${m.conditionalPower}/${drain}/${cap}`);
      const strikeAt = (targetHp: number) => {
        // An element-neutral target: the edge reads the Power, not a relation that would finish it.
        const user = traitUnit(0, 68),
          target = traitUnit(1, NEUTRAL_SPECIES);
        user.setHp(500);
        target.setHp(targetHp);
        traitStrike(user, target, id);
        return { dealt: targetHp - target.hp(), drank: user.hp() - 500, left: target.hp() };
      };
      const edge = 10 * below;
      // "dưới 35%": strictly below — 349 of 1000 takes Power 200, 350 takes Power 135.
      const low = strikeAt(edge - 1),
        high = strikeAt(edge);
      if (low.dealt !== hit(conditional, record))
        wrong.push(`${key}: at ${edge - 1} dealt ${low.dealt}`);
      if (high.dealt !== hit(power, record)) wrong.push(`${key}: at ${edge} dealt ${high.dealt}`);
      // "Không hạ gục tức thì": the bigger Power is all it is — a target with HP to spare stands.
      if (low.left !== edge - 1 - hit(conditional, record)) wrong.push(`${key}: left ${low.left}`);
      // The drain: only on the low-HP hit, 15% of what landed, at most 4% of the user's max HP.
      const want = drain ? Math.min(Math.trunc((low.dealt * drain) / 100), (1000 * cap) / 100) : 0;
      if (low.drank !== want) wrong.push(`${key}: drank ${low.drank} ≠ ${want}`);
      if (high.drank !== 0) wrong.push(`${key}: drank ${high.drank} off a healthy target`);
      if (drain) {
        // Under the cap: a 100-HP target gives up 100, of which 15 comes back.
        const small = strikeAt(100);
        if (small.drank !== Math.trunc((100 * drain) / 100))
          wrong.push(`${key}: drank ${small.drank} of a 100-HP finish`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("DISPEL (damage_dispel_conditional)", () => {
  const skills = group("damage_dispel_conditional"),
    pattern =
      /^Power (\d+); gỡ (\d+) buff theo ưu tiên DEF > damage > tốc độ > khiên > hồi\. Có buff trước đòn: Power (\d+)(?:\. Bỏ qua (\d+)% DEF, tổng tối đa (\d+)%)?$/,
    DEFENSE_UP = 4,
    SPEED_UP = 7,
    SHIELD = 15,
    WALL = 1009,
    SCOUT = 1000;

  it("has 16 skills, every one described in the same words", () => {
    expect(skills.length).toBe(16);
    for (const record of skills) expect(record.description).toMatch(pattern);
  });

  it("description, record and live strike agree for every skill", () => {
    const wrong: string[] = [];
    for (const record of skills) {
      const [power, count, conditional, ignore = 0, cap = 35] = numbers(record, pattern),
        m = mechanics(record),
        key = record.stableKey,
        id = record.runtimeId;
      if (
        power !== record.power ||
        count !== m.dispelCount ||
        conditional !== m.conditionalPower ||
        ignore !== (m.defenseIgnorePct ?? 0) ||
        cap !== 35
      )
        wrong.push(`${key}: record ${m.dispelCount}/${m.conditionalPower}/${m.defenseIgnorePct}`);
      // Bỏ qua X% DEF: 60 DEF counts as 60 − X%; the hit is scored off that.
      const raw = 200 - (60 - Math.trunc((60 * ignore) / 100)),
        // The species-68 targets take the skill element's relation to 68.
        scored = (p: number) =>
          rules.damage.applyRelationTo(
            rules.damage.relationFor(NEUTRAL_SPECIES, 68, id),
            Math.trunc((raw * p) / 100),
          );
      const plain = traitUnit(1, 68);
      traitStrike(traitUnit(0, 68), plain, id);
      if (1000 - plain.hp() !== scored(power))
        wrong.push(`${key}: no-buff hit ${1000 - plain.hp()}`);
      // A target holding a buff before the hit takes Power 155, and loses that one buff.
      const buffed = traitUnit(1, 68);
      traitStrike(buffed, traitUnit(0, 68), SCOUT);
      if (!buffed.statuses.has(0, SPEED_UP)) wrong.push(`${key}: setup has no speed buff`);
      const before = buffed.hp();
      traitStrike(traitUnit(0, 68), buffed, id);
      if (before - buffed.hp() !== scored(conditional))
        wrong.push(`${key}: buffed hit ${before - buffed.hp()} ≠ ${scored(conditional)}`);
      if (buffed.statuses.has(0, SPEED_UP)) wrong.push(`${key}: speed buff survived`);
      // Priority, one per hit: DEF, then speed, then the shield (a dispeller too weak to dent it).
      const wall = traitUnit(1, 68);
      traitStrike(wall, wall, WALL);
      traitStrike(wall, traitUnit(0, 68), SCOUT);
      const order: string[] = [];
      for (let i = 0; i < 3; i++) {
        traitStrike(traitUnit(0, 68, 1), wall, id);
        order.push(
          [
            [DEFENSE_UP, "DEF"],
            [SPEED_UP, "tốc độ"],
            [SHIELD, "khiên"],
          ]
            .filter(([statusId]) => wall.statuses.has(0, statusId as number))
            .map(([, label]) => label)
            .join("+"),
        );
      }
      if (order.join(" | ") !== "tốc độ+khiên | khiên | ")
        wrong.push(`${key}: dispel order left ${order.join(" | ")}`);
    }
    // "tổng tối đa 35%": the skill's pierce on top of a talent's stops at 35.
    expect([
      SignatureSkills.pierce(0, 20),
      SignatureSkills.pierce(10, 20),
      SignatureSkills.pierce(30, 20),
    ]).toEqual([20, 30, 35]);
    expect(wrong).toEqual([]);
  });
});

describe("PIVOT (damage_optional_pivot)", () => {
  const skills = group("damage_optional_pivot"),
    pattern =
      /^Power (\d+), sau đòn chọn đổi sang (\d+) pet còn sống; pet vào nhận khiên (\d+)% HP trong (\d+) lượt\. Bị Giam Cầm\/không có dự bị: vẫn đánh nhưng không đổi\/không tạo khiên$/;

  it("has 7 skills, every one described in the same words", () => {
    expect(skills.length).toBe(7);
    for (const record of skills) expect(record.description).toMatch(pattern);
  });

  it("description, record and live strike and switch agree for every skill", () => {
    const wrong: string[] = [];
    for (const record of skills) {
      const [power, pets, shieldPct, turns] = numbers(record, pattern),
        m = mechanics(record),
        key = record.stableKey,
        id = record.runtimeId;
      if (
        power !== record.power ||
        pets !== 1 ||
        shieldPct !== m.transferShieldMaxHpPct ||
        turns !== m.transferDurationTurns
      )
        wrong.push(`${key}: record ${m.transferShieldMaxHpPct}/${m.transferDurationTurns}`);
      const user = traitUnit(0, 68),
        foe = traitUnit(1, 68);
      traitStrike(user, foe, id);
      if (1000 - foe.hp() !== hit(power, record, foe)) wrong.push(`${key}: hit ${1000 - foe.hp()}`);
      if (!user.signatureState.pendingPivot) wrong.push(`${key}: no switch offered`);
      // The pet that comes in carries the shield; the one that left keeps nothing.
      const next = traitUnit(0, 68),
        projection = rules.newTraitProjection(() => 0);
      projection.onSwitch(user, next, 1, 1, 0, false);
      if (next.shieldHp() !== Math.trunc((1000 * shieldPct) / 100))
        wrong.push(`${key}: incoming shield ${next.shieldHp()}`);
      if (next.statuses.get(0, 15)?.remainingTurns !== turns)
        wrong.push(`${key}: shield turns ${next.statuses.get(0, 15)?.remainingTurns}`);
      if (user.signatureState.pendingPivot || user.shieldHp() !== 0)
        wrong.push(`${key}: the departing pet kept the pivot`);
      // Giam Cầm: the hit still lands, no switch is offered.
      const bound = traitUnit(0, 68),
        target = traitUnit(1, 68);
      rules.web!.applyRainbowDebuff(bound, 4, { turns: 2 });
      traitStrike(bound, target, id);
      if (1000 - target.hp() !== hit(power, record, target))
        wrong.push(`${key}: imprisoned hit ${1000 - target.hp()}`);
      if (bound.signatureState.pendingPivot) wrong.push(`${key}: imprisoned pet offered a switch`);
    }
    expect(wrong).toEqual([]);
  });
});

describe("SACRIFICE (hp_cost_attack)", () => {
  const skills = group("hp_cost_attack"),
    pattern =
      /^Power (\d+); cần HP lớn hơn (\d+)% HP tối đa, trả (\d+)% HP tối đa sau khi gây damage\. Nếu không đủ HP, không chọn được chiêu; không tự gục$/;

  it("has 1 skill, described in these words", () => {
    expect(skills.length).toBe(1);
    expect(skills[0].description).toMatch(pattern);
  });

  it("description, record and live strike agree", () => {
    const wrong: string[] = [];
    for (const record of skills) {
      const [power, need, pay] = numbers(record, pattern),
        m = mechanics(record),
        key = record.stableKey,
        id = record.runtimeId,
        row = rules.damage.skillRow(id);
      if (power !== record.power || need !== m.selfHpCostPct || pay !== m.selfHpCostPct)
        wrong.push(`${key}: record ${m.selfHpCostPct}`);
      if (!m.requireHpAboveCost || m.selfKo) wrong.push(`${key}: guards ${m.requireHpAboveCost}`);
      const edge = 10 * need,
        user = traitUnit(0, 68);
      // "lớn hơn 18%": 181 of 1000 may cast, 180 may not.
      user.setHp(edge);
      if (rules.web!.skillUsable(row, user)) wrong.push(`${key}: castable at ${edge}`);
      user.setHp(edge + 1);
      if (!rules.web!.skillUsable(row, user)) wrong.push(`${key}: refused at ${edge + 1}`);
      // Pays 180 after the hit, never the last point.
      const foe = traitUnit(1, 68);
      user.setHp(800);
      traitStrike(user, foe, id);
      if (1000 - foe.hp() !== hit(power, record, foe)) wrong.push(`${key}: hit ${1000 - foe.hp()}`);
      if (user.hp() !== 800 - 10 * pay) wrong.push(`${key}: paid ${800 - user.hp()}`);
      user.setHp(edge + 1);
      traitStrike(user, traitUnit(1, 68), id);
      if (user.hp() !== 1) wrong.push(`${key}: left at ${user.hp()} after paying from ${edge + 1}`);
    }
    expect(wrong).toEqual([]);
  });
});
