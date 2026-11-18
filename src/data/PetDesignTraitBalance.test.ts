import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Pack } from "../pack/Pack";
import {
  GameData,
  type DesignTraitLimits,
  type PackDesignTrait,
  type PackDesignTraitBalance,
  type PackDesignTraitBalanceTable,
} from "./GameData";

const root = resolve(import.meta.dirname, "..", "..");

/**
 * The seam the mutation proof at the bottom pulls: every fetch is parsed and then handed to this
 * before the reader sees it, so a wrong number can be injected without touching the pack on disk.
 */
let mutate: (file: string, json: unknown) => unknown = (_file, json) => json;

vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(root, "public", decodeURIComponent(input.replace(/^\//, "")));
  return {
    ok: true,
    status: 200,
    json: async () => mutate(file, JSON.parse(readFileSync(file, "utf8"))),
  };
});

/** The workbook the balance table was transcribed from, pinned so a re-transcription is visible. */
const WORKBOOK_SHA256 = "483963d3b9936edde429ebb3984768a406ae00ffa54b9fad747f164b73ad00ee";

/**
 * The six families whose number changes meaning, not just size. Java reads them as a percent of
 * the skill's own Power and multiplies the computed damage; the workbook authors flat Power added
 * to the skill. These are the only rows where Java cannot be the referee.
 */
const POWER_FAMILIES = [
  "low_hp_power_trade",
  "alternating_skill_combo",
  "utility_next_power",
  "status_followup",
  "electric_charge",
  "debuff_resonance",
];

/** How many of the 280 each family carries, as the workbook states it. */
const FAMILY_COUNTS: Record<string, number> = {
  first_direct_action_per_entry: 3,
  low_hp_power_trade: 3,
  taken_damage_rage: 8,
  entry_ambush: 5,
  first_move_stacks: 9,
  reactive_retaliation: 3,
  fire_hit_recovery: 3,
  first_hit_guard: 9,
  slow_target_hunt: 13,
  alternating_skill_combo: 7,
  threshold_regen_once: 1,
  status_seed_sustain: 9,
  thorn_retaliation: 11,
  imprisoned_target_bonus: 5,
  low_hp_heal_bonus: 8,
  utility_reserve: 12,
  utility_next_power: 10,
  switch_ally_shield: 4,
  status_followup: 12,
  successful_cleanse_heal: 9,
  support_shield: 9,
  successful_dispel_pp: 6,
  hp_band_defense: 3,
  faster_target_pierce: 2,
  damage_to_shield: 9,
  threshold_guard_once: 7,
  dot_tick_sustain: 8,
  reactive_chill: 3,
  low_target_lifesteal: 5,
  accuracy_pressure_guard: 4,
  charm_heal_charge: 5,
  buffed_defense_pierce: 8,
  electric_charge: 13,
  same_element_momentum: 11,
  hp_trade_boost: 5,
  damage_debuff_followup: 7,
  entry_hit_guard: 6,
  debuff_resonance: 6,
  buffed_target_pressure: 8,
  first_hit_imprison: 3,
  marked_target_lifesteal: 3,
  enemy_dot_heal_support: 3,
  // The two mutation forms' own characteristics, which replace their workbook rows.
  agility_outrank_priority: 1,
  hard_control_immunity: 1,
};

/** Species 274 and 275 fight with their form characteristic, not the workbook row (2026-11-05). */
const EXCLUSIVE = { 274: "HV-01", 275: "TL-01" } as const;

/** The four families whose ceiling is 100% instead of "no ceiling". */
const DAMAGE_REDUCTION_FAMILIES = [
  "first_hit_guard",
  "accuracy_pressure_guard",
  "damage_debuff_followup",
  "entry_hit_guard",
];

const CAPPED: DesignTraitLimits = "damageReductionCappedAt100";

type Rig = {
  balance: PackDesignTraitBalanceTable;
  traits: PackDesignTraitBalance[];
  java: Map<number, PackDesignTrait>;
  speciesName: Map<number, string>;
};

async function load(): Promise<Rig> {
  const data = new GameData(await Pack.load());
  const [balance, javaRows, species] = await Promise.all([
    data.designTraitBalance(),
    data.designTraits(),
    data.species(),
  ]);
  return {
    balance,
    traits: balance.traits,
    java: new Map(javaRows.map((row) => [row.speciesId, row])),
    speciesName: new Map(species.rows.map((row) => [row.speciesId, row.name])),
  };
}

/**
 * The workbook's own arithmetic, restated: the strength factor lifts the source number, and only
 * the four damage-reduction families are capped. Reproducing all 280 values from it is what makes
 * the table a transcription of a rule rather than a list of 280 typed-in numbers.
 */
function expectedValue(trait: PackDesignTraitBalance, cap: number): number {
  // Test Huy runtime @61245 explicitly overrides this first-hit guard after workbook scaling.
  if (trait.speciesId === 47) return 30;
  const lifted = trait.sourceValue * trait.factor;
  return trait.limits === CAPPED ? Math.min(cap, lifted) : lifted;
}

type Violations = {
  strengthRule: number;
  javaStructure: number;
  javaAgreement: number;
  petName: number;
  family: number;
  limits: number;
  shape: number;
};

/**
 * Every way a row can disagree with the three sources it is answerable to, counted per class. The
 * baseline is zero across the board; the mutation proof at the bottom moves one number at a time
 * and pins the count that class reports, so a guard that could not fail is a failing test.
 */
function count(rig: Rig): Violations {
  const cap = rig.balance.strengthRule.damageReductionCapPercent;
  const powerFamilies = new Set(rig.balance.powerRule.families);
  const violations: Violations = {
    strengthRule: 0,
    javaStructure: 0,
    javaAgreement: 0,
    petName: 0,
    family: 0,
    limits: 0,
    shape: 0,
  };
  for (const trait of rig.traits) {
    // The two form characteristics answer to their own test below, not to the workbook's rules.
    if (trait.exclusiveTrait) continue;
    const java = rig.java.get(trait.speciesId);
    if (expectedValue(trait, cap) !== trait.value) violations.strengthRule++;
    if (
      !java ||
      java.type !== trait.type ||
      java.petKey !== trait.petKey ||
      java.key !== trait.key ||
      java.name !== trait.name ||
      java.sourceValue !== trait.sourceValue
    )
      violations.javaStructure++;
    const agrees = !!java && java.value === trait.value && java.description === trait.description;
    if (agrees !== trait.matchesJavaExport) violations.javaAgreement++;
    if (rig.speciesName.get(trait.speciesId) !== trait.pet) violations.petName++;
    if (FAMILY_COUNTS[trait.type] === undefined) violations.family++;
    const capped = trait.limits === CAPPED;
    if (capped !== DAMAGE_REDUCTION_FAMILIES.includes(trait.type)) violations.limits++;
    if (capped && trait.value > cap) violations.limits++;
    // The factor is the group's, the unit is the family's, and neither is free per row.
    const group = trait.group === "Tấn công" ? 6 : trait.group === "Phòng thủ / hỗ trợ" ? 10 : -1;
    const unit = powerFamilies.has(trait.type)
      ? "Power"
      : trait.type === "successful_dispel_pp"
        ? "PP"
        : trait.type === "first_hit_imprison"
          ? "Lượt"
          : "%";
    if (group !== trait.factor || unit !== trait.unit) violations.shape++;
  }
  return violations;
}

describe("pet design trait balance", () => {
  it("carries all 280 characteristics, one per species, over the 42 families and two forms", async () => {
    const rig = await load();
    expect(rig.balance.schema).toBe("vqsv-webnative-balance-pet-design-traits-v1");
    expect(rig.traits.length).toBe(280);
    expect(rig.balance.source.traitCount).toBe(280);
    expect(rig.balance.source.sha256).toBe(WORKBOOK_SHA256);
    expect(rig.balance.source.balanceVersion).toBe("user-trait-strength-20261022-v1");

    const ids = rig.traits.map((trait) => trait.speciesId).sort((a, b) => a - b);
    expect(new Set(ids).size).toBe(280);
    expect(ids[0]).toBe(0);
    expect(ids[279]).toBe(279);
    expect(new Set(rig.traits.map((trait) => trait.name)).size).toBe(280);

    const families = new Map<string, number>();
    for (const trait of rig.traits) families.set(trait.type, (families.get(trait.type) ?? 0) + 1);
    expect(families.size).toBe(44);
    expect(Object.fromEntries([...families].sort())).toEqual(
      Object.fromEntries(Object.entries(FAMILY_COUNTS).sort()),
    );
    // The Java catalog is the family authority: a type the balance table invented would be a
    // mechanic the engine cannot dispatch on.
    const workbookFamilies = new Set(
      rig.traits.filter((trait) => !trait.exclusiveTrait).map((trait) => trait.type),
    );
    expect([...workbookFamilies].sort()).toEqual(
      [...new Set([...rig.java.values()].map((row) => row.type))].sort(),
    );
  });

  it("reproduces every value from the strength rule and agrees with Java where it does not override", async () => {
    const rig = await load();
    expect(count(rig)).toEqual({
      strengthRule: 0,
      javaStructure: 0,
      javaAgreement: 0,
      petName: 0,
      family: 0,
      limits: 0,
      shape: 0,
    });

    const overridden = rig.traits.filter(
      (trait) => !trait.matchesJavaExport && !trait.exclusiveTrait,
    );
    expect(overridden.length).toBe(51);
    expect(rig.balance.source.overriddenCount).toBe(51);
    expect(rig.balance.powerRule.overriddenCount).toBe(51);
    expect([...new Set(overridden.map((trait) => trait.type))].sort()).toEqual(
      [...POWER_FAMILIES].sort(),
    );
    expect(POWER_FAMILIES.map((f) => overridden.filter((t) => t.type === f).length)).toEqual([
      3, 7, 10, 12, 13, 6,
    ]);
    expect(overridden.every((trait) => trait.unit === "Power")).toBe(true);

    // The 227 rows the workbook does not change are still Java's rows, byte for byte, so the
    // balance table cannot quietly rewrite a mechanic that was already correct. (Java's other two,
    // 274 and 275, gave way to the forms' own characteristics.)
    const kept = rig.traits.filter((trait) => trait.matchesJavaExport);
    expect(kept.length).toBe(227);
    for (const trait of kept) {
      const java = rig.java.get(trait.speciesId)!;
      expect(trait.value).toBe(java.value);
      expect(trait.description).toBe(java.description);
    }
  });

  it("keeps the two ceiling policies and the damage-reduction clamp Java applies", async () => {
    const rig = await load();
    expect(rig.balance.strengthRule.damageReductionCapPercent).toBe(100);
    expect(Object.keys(rig.balance.limitsText).sort()).toEqual(["capsRemoved", CAPPED].sort());
    expect(rig.balance.strengthRule.limitsCounts).toEqual({ capsRemoved: 254, [CAPPED]: 26 });

    const capped = rig.traits.filter((trait) => trait.limits === CAPPED);
    expect(capped.length).toBe(26);
    const clamped = capped.filter(
      (trait) =>
        trait.sourceValue * trait.factor > rig.balance.strengthRule.damageReductionCapPercent,
    );
    expect(clamped.length).toBe(rig.balance.strengthRule.clampedCount);
    expect(clamped.length).toBe(5);
    expect(clamped.every((trait) => trait.type === "entry_hit_guard")).toBe(true);
    expect(clamped.every((trait) => trait.value === 100)).toBe(true);
    // Java clamps the same four families at 100, so these 26 rows are not an override at all.
    for (const trait of capped) {
      expect(trait.matchesJavaExport, `${trait.name} should still match Java`).toBe(true);
      expect(trait.value).toBe(
        trait.speciesId === 47
          ? 30
          : Math.min(100, trait.sourceValue * rig.java.get(trait.speciesId)!.effectMultiplier),
      );
    }
  });

  it("records the flat-Power divergence instead of hiding it behind Java's percent rule", async () => {
    const rig = await load();
    const rule = rig.balance.powerRule;
    expect([...rule.families].sort()).toEqual([...POWER_FAMILIES].sort());
    expect(rule.unit).toBe("Power");
    expect(rule.java).toMatch(/percent of the skill's original Power/);
    expect(rule.java).toMatch(/POWER_BONUS_CAP_PERCENT \(40\)/);
    expect(rule.web).toMatch(/flat Power added to the skill's own powerPercent/);
    expect(rule.cap).toMatch(/^none/);
    // The claim that has to survive: Java has no flat-Power path, so these 51 magnitudes are
    // web-authored and the golden table can only referee their trigger and rhythm.
    expect(rule.divergence).toMatch(/cannot referee the magnitude of these 51 traits/);
    expect(rule.unresolved).toMatch(/buff 0 \(Suc Luc\)/);

    // Java's own multiplier for these six is 1 because it re-derives a fixed percent instead, so
    // the workbook's factor of 6 is a real change of rule and not a re-spelling of Java's number.
    for (const trait of rig.traits.filter((t) => !t.matchesJavaExport && !t.exclusiveTrait)) {
      expect(rig.java.get(trait.speciesId)!.effectMultiplier).toBe(1);
      expect(trait.factor).toBe(6);
    }
  });

  it("gives the two mutation forms their own characteristic, HV-01 and TL-01", async () => {
    const rig = await load();
    const exclusive = rig.traits.filter((trait) => trait.exclusiveTrait);
    expect(Object.fromEntries(exclusive.map((t) => [t.speciesId, t.exclusiveTrait]))).toEqual(
      EXCLUSIVE,
    );
    expect(rig.balance.source.exclusiveTraits).toMatch(/Decided 2026-11-05/);
    expect(rig.traits.find((t) => t.speciesId === 274)).toMatchObject({
      pet: "Hỏa Vu Mộc Linh",
      // `name` giờ là tên đặc tính kit (bản phác thảo v2 đã duyệt 2026-11-17), không còn tên Java.
      type: "agility_outrank_priority",
      value: 15,
      cooldownTurns: 2,
      matchesJavaExport: false,
      description:
        "Nếu đối thủ có Linh xảo cao hơn sau buff/debuff, được ưu tiên hành động và đòn sát thương" +
        " đầu tiên lên chính đối thủ tăng 15%; hồi chiêu 2 lượt.",
    });
    expect(rig.traits.find((t) => t.speciesId === 275)).toMatchObject({
      pet: "Thiên Luân Di Lặc",
      // `name`: tên đặc tính kit, xem trên.
      type: "hard_control_immunity",
      value: 25,
      immuneStatuses: ["dazed", "bind", "paralysis", "petrification", "confusion", "sleep"],
      matchesJavaExport: false,
      description:
        "Miễn nhiễm Mê Muội, Quấn Quanh hoặc Giam Cầm, Tê Liệt, Hóa Đá, Hỗn Loạn và Ngủ; giảm 25%" +
        " sát thương trực tiếp nhận vào.",
    });
    // They are characteristics, not talents: the talent table holds exactly the 19 rollable ones.
    const talents = await new GameData(await Pack.load()).physicalTraits();
    expect(talents.length).toBe(19);
    expect(talents.every((talent) => talent.rollWeight > 0)).toBe(true);
    expect(talents.map((talent) => talent.stableKey)).not.toContain("HV-01");
    expect(talents.map((talent) => talent.stableKey)).not.toContain("TL-01");
  });

  it("holds the boss row outside the 280 and says who owns it", async () => {
    const rig = await load();
    const boss = rig.balance.boss;
    expect(boss.speciesId).toBe(280);
    expect(boss.pet).toBe("Kim Diễm Long Vương");
    expect(boss.name).toBe("Long Ấn");
    expect(boss.type).toBe("long_an_repeat_skill");
    expect(boss.version).toBe(rig.balance.source.bossVersion);
    expect(rig.traits.some((trait) => trait.speciesId === boss.speciesId)).toBe(false);
    expect(rig.traits.some((trait) => trait.type === boss.type)).toBe(false);
    expect(rig.java.has(boss.speciesId)).toBe(false);
    expect(rig.speciesName.get(boss.speciesId)).toBe(boss.pet);
    // Not covered here on purpose: Java implements it as vqsv.game.KimDiemLongAn inside
    // VqsvBattleRuntime, which belongs to the boss battle slice.
    expect(boss.scope).toMatch(/vqsv\.game\.KimDiemLongAn/);
    expect(boss.scope).toMatch(/boss battle slice/);
  });

  it("exposes the balance through the pack key and indexes it by species", async () => {
    const data = new GameData(await Pack.load());
    const bySpecies = await data.designTraitBalanceBySpecies();
    expect(bySpecies.size).toBe(280);
    expect(bySpecies.get(0)).toMatchObject({
      petKey: "LH-000",
      type: "first_direct_action_per_entry",
      sourceValue: 11,
      factor: 6,
      value: 66,
      unit: "%",
      matchesJavaExport: true,
    });
    expect(bySpecies.get(1)).toMatchObject({
      type: "low_hp_power_trade",
      sourceValue: 21,
      value: 126,
      unit: "Power",
      matchesJavaExport: false,
    });
    expect(bySpecies.get(280)).toBeUndefined();
    expect(await data.designTraitBalanceBySpecies()).toBe(bySpecies);
  });
});

describe("pet design trait balance mutation proof", () => {
  const BALANCE = /[\\/]balance[\\/]pet-design-traits\.json$/;

  async function countWith(edit: (table: PackDesignTraitBalanceTable) => void) {
    const before = mutate;
    mutate = (file, json) => {
      if (!BALANCE.test(file)) return json;
      const table = structuredClone(json) as PackDesignTraitBalanceTable;
      edit(table);
      return table;
    };
    try {
      return count(await load());
    } finally {
      mutate = before;
    }
  }

  const trait = (table: PackDesignTraitBalanceTable, speciesId: number) => {
    const found = table.traits.find((row) => row.speciesId === speciesId);
    if (!found) throw new Error(`no balance row for species ${speciesId}`);
    return found;
  };

  it("fails on each single wrong number, with a count that says how wide the break is", async () => {
    const found = {
      // One of the 229 rows Java still owns, moved off both the strength rule and Java's value.
      wrongValue: await countWith((t) => (trait(t, 0).value = 67)),
      // One row given the 100% ceiling its family does not have, which also leaves 126 above it.
      wrongLimits: await countWith((t) => (trait(t, 1).limits = CAPPED)),
      // One row re-typed into a damage-reduction family while keeping its uncapped policy.
      wrongType: await countWith((t) => (trait(t, 0).type = "entry_hit_guard")),
      // One row's factor moved off its group, so 66 is no longer 11 * 6.
      wrongFactor: await countWith((t) => (trait(t, 0).factor = 10)),
      // One row's stored agreement flag flipped, with nothing else changed.
      wrongFlag: await countWith((t) => (trait(t, 0).matchesJavaExport = false)),
      // One pet renamed, so the row no longer names the species it is keyed to.
      wrongPet: await countWith((t) => (trait(t, 0).pet = "Nhiên Dực Bức khác")),
      // One clamp removed: entry_hit_guard 86 goes back to 150% instead of the 100% ceiling.
      wrongClamp: await countWith((t) => (trait(t, 86).value = 150)),
      // One row given a family the engine has no mechanic for.
      wrongFamily: await countWith((t) => (trait(t, 0).type = "invented_family")),
    };
    expect(found).toEqual({
      wrongValue: {
        strengthRule: 1,
        javaStructure: 0,
        javaAgreement: 1,
        petName: 0,
        family: 0,
        limits: 0,
        shape: 0,
      },
      wrongLimits: {
        strengthRule: 1,
        javaStructure: 0,
        javaAgreement: 0,
        petName: 0,
        family: 0,
        // Both ceiling checks fire: the family is not one of the four, and 126 is above the cap.
        limits: 2,
        shape: 0,
      },
      wrongType: {
        strengthRule: 0,
        javaStructure: 1,
        javaAgreement: 0,
        petName: 0,
        family: 0,
        limits: 1,
        shape: 0,
      },
      wrongFactor: {
        strengthRule: 1,
        javaStructure: 0,
        javaAgreement: 0,
        petName: 0,
        family: 0,
        limits: 0,
        shape: 1,
      },
      wrongFlag: {
        strengthRule: 0,
        javaStructure: 0,
        javaAgreement: 1,
        petName: 0,
        family: 0,
        limits: 0,
        shape: 0,
      },
      wrongPet: {
        strengthRule: 0,
        javaStructure: 0,
        javaAgreement: 0,
        petName: 1,
        family: 0,
        limits: 0,
        shape: 0,
      },
      wrongClamp: {
        strengthRule: 1,
        javaStructure: 0,
        javaAgreement: 1,
        petName: 0,
        family: 0,
        limits: 1,
        shape: 0,
      },
      wrongFamily: {
        strengthRule: 0,
        javaStructure: 1,
        javaAgreement: 0,
        petName: 0,
        family: 1,
        limits: 0,
        shape: 0,
      },
    });
  });
});
