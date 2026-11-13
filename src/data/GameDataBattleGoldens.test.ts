import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Pack } from "../pack/Pack";
import { GameData } from "./GameData";
import type { GoldenDamageRow } from "./GameData";

const root = resolve(import.meta.dirname, "..", "..");

vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(root, "public", decodeURIComponent(input.replace(/^\//, "")));
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(readFileSync(file, "utf8")),
  };
});

async function newData(): Promise<GameData> {
  return new GameData(await Pack.load());
}

/** The two rolls that differ only by the jitter rule, keyed by the fight that produced them. */
function jitterPairs(rows: GoldenDamageRow[]): Map<string, { low: number; high: number }> {
  const byFight = new Map<string, { low?: number; high?: number }>();
  for (const row of rows) {
    if (row.critRoll !== 99) continue;
    const key = `${row.attacker}|${row.defender}|${row.skillId}`;
    const pair = byFight.get(key) ?? {};
    if (row.jitterRoll === 50) pair.low = row.damage;
    if (row.jitterRoll === 51) pair.high = row.damage;
    byFight.set(key, pair);
  }
  const complete = new Map<string, { low: number; high: number }>();
  for (const [key, { low, high }] of byFight)
    if (low !== undefined && high !== undefined) complete.set(key, { low, high });
  return complete;
}

describe("golden battle tables", () => {
  it("ships every table the probe wrote, under the profile it pinned", async () => {
    const data = await newData();
    const meta = await data.goldenBattleMeta();
    expect(meta.schema).toBe("vqsv-webnative-battle-golden-v1");
    // The dump is only a referee while the runtime it referee'd is the default one.
    expect(meta.petStatProfile).toBe("unified-pet-growth-v6");
    expect(meta.skillProfile).toBe("unified-v5");
    expect(meta.battleTables).toContain("g0=100");
    expect(meta.levelMax).toBe(100);
    // The referee's own ceiling is the enemy one: a Cầu Vồng fight is levelled past PetLevel.MAX, and
    // the growth grid runs out to it.
    expect(meta.enemyLevelRule.maxEnemyLevel).toBe(150);

    expect((await data.goldenPetStats()).schema).toBe("vqsv-webnative-battle-golden-pet-stats-v3");
    expect((await data.goldenBattleUnits()).schema).toBe("vqsv-webnative-battle-golden-units-v1");
    expect((await data.goldenDamage()).schema).toBe("vqsv-webnative-battle-golden-damage-v1");
    expect((await data.goldenSkillBranch()).schema).toBe(
      "vqsv-webnative-battle-golden-skill-branch-v1",
    );
    expect((await data.goldenStatusLifecycle()).schema).toBe(
      "vqsv-webnative-battle-golden-status-lifecycle-v1",
    );
    expect((await data.goldenStatusPresentation()).schema).toBe(
      "vqsv-webnative-battle-golden-status-presentation-v1",
    );
    expect((await data.goldenHeldItems()).schema).toBe(
      "vqsv-webnative-battle-golden-held-items-v1",
    );
    expect((await data.statusMechanics()).schema).toBe("vqsv-webnative-battle-status-mechanics-v1");
    expect((await data.goldenCatch()).schema).toBe("vqsv-webnative-battle-golden-catch-v1");
    expect((await data.goldenExp()).schema).toBe("vqsv-webnative-battle-golden-exp-v1");
    expect((await data.goldenFlow()).schema).toBe("vqsv-webnative-battle-golden-flow-v1");
    expect((await data.goldenRng()).schema).toBe("vqsv-webnative-battle-golden-rng-v1");
    expect((await data.goldenTraits()).schema).toBe("vqsv-webnative-battle-golden-traits-v1");
    expect((await data.goldenPhysicalTraits()).schema).toBe(
      "vqsv-webnative-battle-golden-physical-traits-v1",
    );
    expect((await data.goldenShieldTrack()).schema).toBe(
      "vqsv-webnative-battle-golden-shield-track-v1",
    );
    expect((await data.goldenTraitBattle()).schema).toBe(
      "vqsv-webnative-battle-golden-trait-battle-v1",
    );

    const shipped = readdirSync(resolve(root, "public", "pack", "data", "battle")).filter((name) =>
      name.startsWith("golden-"),
    );
    // One file per `write(root, "golden-…")` line in ProbeWebBattleMath.main, so a table the probe
    // stops writing shows up here instead of leaving its grader silently reading nothing.
    // golden-battle-ai.json is the enemy decision table written by the same probe's battleAi pass.
    expect(shipped.length).toBe(17);
  });

  it("grades the post-skill decision, the HUD strip and the badge cell the Java runtime hands over", async () => {
    const data = await newData();
    const [table, mechanics, statuses] = await Promise.all([
      data.goldenStatusPresentation(),
      data.statusMechanics(),
      data.statuses(),
    ]);

    // The resolution rows are the same 24 routes the mechanics table already lists, each swept over
    // the three booleans the runtime passes in, so no route can be ported without its branches.
    const routeSkills = mechanics.postSkillRoutes
      .map((route) => route.skillId)
      .sort((a, b) => a - b);
    const resolutionSkills = [
      ...new Set(table.postSkillResolution.map((row) => row.inputs.skillId)),
    ];
    expect(resolutionSkills.length).toBe(routeSkills.length);
    expect(resolutionSkills.sort((a, b) => a - b)).toEqual(routeSkills);
    for (const skillId of resolutionSkills) {
      const rows = table.postSkillResolution.filter((row) => row.inputs.skillId === skillId);
      expect(rows.length, `skill ${skillId}`).toBe(8);
      const combos = new Set(
        rows.map(
          (row) =>
            `${row.inputs.attackHit}/${row.inputs.targetAvailable}/${row.inputs.leechRollPassed}`,
        ),
      );
      expect(combos.size, `skill ${skillId}`).toBe(8);
      for (const row of rows) {
        expect(row.routeMode).not.toBe("NONE");
        // a buff always arrives with an owner
        if (row.buffId >= 0) expect(row.buffOwner, `${skillId}/${row.mode}`).not.toBe("NONE");
      }
    }
    // but an owner alone is not a buff: the leech routes carry effectId -1, so a walk keyed off the
    // owner alone would apply a status Java never applies
    expect(
      table.postSkillResolution.some((row) => row.buffId < 0 && row.buffOwner !== "NONE"),
    ).toBe(true);
    // the four decisions the interactive fight has to reach, each present at least once
    expect(table.postSkillResolution.some((row) => row.heal > 0)).toBe(true);
    expect(table.postSkillResolution.some((row) => row.noDamageDebuff)).toBe(true);
    expect(table.postSkillResolution.some((row) => row.copyTargetBuffs)).toBe(true);
    expect(table.postSkillResolution.some((row) => row.buffOwner === "TARGET")).toBe(true);

    const cap = Math.max(...table.presentation.map((row) => row.slots.length));
    for (const row of table.presentation) {
      expect(row.slots.length, row.label).toBeLessThanOrEqual(cap);
      const held = new Set(row.held.map((status) => `${status.bank}:${status.numericId}`));
      expect(
        row.slots.map((slot) => slot.index),
        row.label,
      ).toEqual([...row.slots.keys()]);
      for (const slot of row.slots) {
        if (slot.sourceBank < 0) {
          // the opening-suppression entry is synthetic: no status owns it, so it is not in held
          expect(slot.stableKey, row.label).toBe("HTTC-OPENING-SUPPRESSION");
          expect(slot.sourceNumericId, row.label).toBe(-1);
          expect(row.suppressionActions > 0, row.label).toBe(true);
          expect(slot.index, row.label).toBe(0);
          continue;
        }
        expect(
          held.has(`${slot.sourceBank}:${slot.sourceNumericId}`),
          `${row.label}/${slot.index}`,
        ).toBe(true);
        const rainbow = slot.sourceBank === 2;
        expect(slot.iconKind, `${row.label}/${slot.index}`).toBe(
          rainbow ? "RAINBOW_RESOURCE" : "LIET_HOA_ATLAS",
        );
        expect(slot.resourcePath !== "", `${row.label}/${slot.index}`).toBe(rainbow);
        expect(slot.lietHoaAtlasCell >= 0, `${row.label}/${slot.index}`).toBe(!rainbow);
        // a badge always reads a duration the projector resolved, never the raw turn count
        const status = row.held.find(
          (each) => each.bank === slot.sourceBank && each.numericId === slot.sourceNumericId,
        )!;
        expect(slot.remainingDuration, `${row.label}/${slot.index}`).toBe(
          slot.actionOwned ? status.remainingActions : status.remainingTurns,
        );
      }
    }
    // the strip is genuinely capped: the widest seed holds more statuses than the HUD can show
    const widest = table.presentation.find((row) => row.held.length > row.slots.length);
    expect(
      widest,
      "no seeded unit overflowed the strip, so the cap was never measured",
    ).toBeDefined();
    expect(widest!.slots.map((slot) => `${slot.sourceBank}:${slot.sourceNumericId}`)).toEqual(
      widest!.held
        .slice(0, widest!.slots.length)
        .map((status) => `${status.bank}:${status.numericId}`),
    );
    // round robin: the banks interleave, so one bank cannot starve another out of the visible strip
    const mixed = table.presentation.find((row) => row.label === "round robin")!;
    expect(mixed.slots.map((slot) => slot.sourceBank)).toEqual([0, 1, 2, 0, 1, 2]);
    // a Cầu Vồng id Java excludes or only aliases has to be invisible or canonical, not a blank cell
    for (const row of table.presentation.filter((each) => each.label.startsWith("rainbow"))) {
      const numericId = Number(row.label.slice("rainbow ".length));
      if (row.held.length === 0) expect(row.slots, row.label).toEqual([]);
      if (numericId === 2)
        expect(row.held.map((each) => `${each.bank}:${each.numericId}`)).toEqual(["1:10"]);
    }

    // the text the runtime prints is the effect row's own name, and it is empty exactly where the
    // legacy effect table has no row: the signature statuses and every Cầu Vồng status
    const byId = new Map(table.effectNames.map((row) => [`${row.bank}:${row.numericId}`, row]));
    for (const status of statuses) {
      const row = byId.get(`${status.sourceBank}:${status.sourceNumericId}`);
      expect(row, status.stableKey).toBeDefined();
      expect(row!.hasDefinition, status.stableKey).toBe(true);
      expect(row!.displayName, status.stableKey).toBe(status.displayName);
      const legacyRow = status.sourceBank < 2 && !status.stableKey.startsWith("PD-EFFECT-");
      expect(row!.effectRowName !== "", status.stableKey).toBe(legacyRow);
      if (legacyRow) expect(row!.effectRowName, status.stableKey).toBe(status.displayName);
    }
    expect(byId.has("2:1"), "the reserved Cầu Vồng id must have no definition").toBeDefined();
    expect(byId.get("2:1")!.hasDefinition).toBe(false);

    const cellByDuration = new Map(table.durationCells.map((row) => [row.duration, row.cell]));
    const expired = cellByDuration.get(0)!;
    for (const duration of [-2, -1, 0]) expect(cellByDuration.get(duration)).toBe(expired);
    // one cell per visible count, then the clamp — and the clamp lands on the same cell as "expired",
    // which is Java's own collision and must not be tidied away
    const counted = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((d) => cellByDuration.get(d)));
    expect(counted.size).toBe(10);
    for (const duration of [11, 12, 13, 14]) expect(cellByDuration.get(duration)).toBe(expired);
  });

  it("records every one of the 280 characteristics, each under its own family's scenarios", async () => {
    const traits = await (await newData()).goldenTraits();
    expect(traits.rows.length).toBe(traits.rowCount);
    expect(traits.rows.length).toBe(1070);

    const species = new Set(traits.rows.map((row) => row.speciesId));
    expect(species.size).toBe(280);
    for (let id = 0; id < 280; id++)
      expect(species.has(id), `species ${id} has no recorded row`).toBe(true);

    expect(traits.families.length).toBe(42);
    expect(traits.families.reduce((sum, family) => sum + family.species, 0)).toBe(280);
    for (const family of traits.families) {
      const rows = traits.rows.filter((row) => row.type === family.type);
      expect(rows.length, family.type).toBe(family.species * family.scenarios.length);
      // every species of a family runs the same scenario list, so a scenario can never be
      // quietly skipped for the species whose value would expose a wrong clamp
      for (const row of rows) {
        const own = traits.rows
          .filter((each) => each.speciesId === row.speciesId)
          .map((each) => each.scenario)
          .sort();
        expect(own, `${row.speciesId}/${row.type}`).toEqual([...family.scenarios].sort());
        expect(row.valueUnit).toBe(family.valueUnit);
      }
    }

    // the table is a replay script, so a step without a resulting state grades nothing
    for (const row of traits.rows) {
      expect(row.steps.length, `${row.speciesId}/${row.scenario}`).toBeGreaterThan(0);
      for (const step of row.steps) {
        expect(step.state.a, `${row.type} ${step.op}`).toBeDefined();
        expect(step.state.a.ss).toBeInstanceOf(Array);
      }
    }
    // every draw is pinned, otherwise the recorded answers are not reproducible
    expect(traits.randomness).toMatchObject({ mode: "fixed", roll: 0 });
  });

  it("records the 19 rollable talents and nothing else, each under its own family's scenarios", async () => {
    const data = await newData();
    const [talents, pool] = await Promise.all([data.goldenPhysicalTraits(), data.physicalTraits()]);
    expect(talents.rows.length).toBe(talents.rowCount);

    // "thien phu" is exactly the rollable pool of 19. HV-01 and TL-01 are the mutation forms'
    // characteristics, not talents, and are no longer in the talent table at all.
    const rollable = pool.filter((trait) => trait.rollWeight > 0).map((trait) => trait.runtimeId);
    expect(rollable.length).toBe(19);
    expect([...new Set(talents.rows.map((row) => row.traitId))].sort((a, b) => a - b)).toEqual(
      [...rollable].sort((a, b) => a - b),
    );
    for (const row of talents.rows) {
      const definition = pool.find((trait) => trait.runtimeId === row.traitId)!;
      expect(row.stableKey, `${row.traitId}`).toBe(definition.stableKey);
      expect(row.name, row.stableKey).toBe(definition.name);
      expect(row.parametersJson, row.stableKey).toBe(definition.parametersJson);
    }

    // every talent runs its family's full scenario list on the species with no characteristic, so
    // a scenario can never be quietly skipped for the value that would expose a wrong clamp
    expect(talents.families.length).toBe(9);
    for (const family of talents.families) {
      const rows = talents.rows.filter((row) => row.family === family.family);
      expect(new Set(rows.map((row) => row.stableKey)).size, family.family).toBe(family.traits);
      for (const stableKey of new Set(rows.map((row) => row.stableKey))) {
        const own = rows
          .filter((row) => row.stableKey === stableKey && !row.combined)
          .map((row) => row.scenario)
          .sort();
        expect(own, stableKey).toEqual([...family.scenarios].sort());
      }
    }
    // and one talent per family repeats that list on characteristic species 0, which is what grades
    // the composition of the two systems rather than either one alone
    const combined = new Set(
      talents.rows.filter((row) => row.combined).map((row) => row.family + "/" + row.stableKey),
    );
    expect(combined.size).toBe(9);
    for (const row of talents.rows.filter((each) => each.combined)) {
      expect(row.speciesId, row.stableKey).toBe(0);
      const own = talents.rows
        .filter((each) => each.stableKey === row.stableKey && each.combined)
        .map((each) => each.scenario)
        .sort();
      expect(own, row.stableKey).toEqual(
        [...talents.families.find((family) => family.family === row.family)!.scenarios].sort(),
      );
    }
    for (const row of talents.rows.filter((each) => !each.combined))
      expect(row.speciesId, row.stableKey).toBe(280);

    // a replay script whose step records no state grades nothing
    for (const row of talents.rows) {
      expect(row.steps.length, `${row.stableKey}/${row.scenario}`).toBeGreaterThan(0);
      for (const step of row.steps) {
        const actor = step.state.a;
        expect(actor, `${row.stableKey} ${step.op}`).toBeDefined();
        expect(actor.mh, `${row.stableKey} ${step.op}`).toBeGreaterThan(0);
        expect(actor.bs, `${row.stableKey} ${step.op}`).toHaveLength(4);
        expect(actor.tt.cs, `${row.stableKey} ${step.op}`).toHaveLength(5);
      }
    }

    // Every draw is pinned to one of two rolls under an empty trace context, so the engine is asked
    // with the bare label and the answers stay reproducible.
    expect(talents.randomness).toMatchObject({ mode: "fixed-per-scenario", rolls: [0, 99] });
    expect(talents.randomness.context).toBe("");
    for (const row of talents.rows) expect(row.roll === 0 || row.roll === 99).toBe(true);
    const seams = new Set(talents.rows.flatMap((row) => row.randomLabels));
    expect([...seams].sort()).toEqual([
      "trait.V4-TRAIT-00.incoming-direct-damage",
      "trait.V4-TRAIT-01.revive",
      "trait.V4-TRAIT-03.incoming-direct-damage",
      "trait.V4-TRAIT-04.low-hp-loss",
    ]);

    // TC-10 declares blocked_by ["burn", "corrosion"], but RainbowStatusCatalog registers no
    // definition for bank 2 / id 1, so BattleUnit.synchronizeTraitCanonicalStatuses can never set
    // canonical burn in production: no row may grade a burn block, and corrosion carries the branch.
    expect(
      talents.rows.some((row) => /burn/i.test(row.scenario)),
      "a burn-block row would grade a state the game cannot reach",
    ).toBe(false);
    for (const row of talents.rows)
      for (const step of row.steps)
        for (const unit of Object.values(step.state)) expect(unit.tt.cs[0]).toBe(0);
    expect(
      talents.rows
        .filter((row) => row.scenario === "blockedByCorrosion")
        .map((row) => row.stableKey),
    ).toEqual(["TC-10", "TC-10"]);

    // TC-00 is the only talent with no parameters, which is what lets the port keep refusing every
    // other talent until its family is implemented
    expect(talents.rows.filter((row) => JSON.parse(row.parametersJson).length === 0).length).toBe(
      2,
    );
  });

  it("has teeth: the power families scale the hit, and the 40 % cap binds through stacks", async () => {
    const traits = await (await newData()).goldenTraits();
    expect(traits.powerRule.families).toEqual([
      "alternating_skill_combo",
      "debuff_resonance",
      "electric_charge",
      "low_hp_power_trade",
      "status_followup",
      "utility_next_power",
    ]);
    expect(traits.powerRule.capPercent).toBe(40);
    const powerFamilies = traits.families
      .filter((family) => family.valueUnit === "percent_of_skill_power")
      .map((family) => family.type);
    expect(powerFamilies).toEqual(traits.powerRule.families);
    expect(
      traits.families
        .filter((f) => powerFamilies.includes(f.type))
        .reduce((s, f) => s + f.species, 0),
    ).toBe(51);

    const scaled = traits.rows.flatMap((row) =>
      row.steps
        .filter((step) => step.op === "applyPowerBonus")
        .map((step) => ({ row, damage: step.args[1] as number, result: step.result as number })),
    );
    expect(scaled.length).toBe(35);
    const percent = (value: number, by: number) => Math.trunc((value * by) / 100);
    // The workbook writes these six as "+N Power". Read flat, every recorded answer is wrong;
    // read as a percentage of the computed hit, every one of them is right.
    expect(
      scaled.filter(
        ({ row, damage, result }) => result === damage + percent(damage, Math.min(40, row.value)),
      ).length,
    ).toBe(scaled.length);
    expect(scaled.filter(({ row, damage, result }) => result === damage + row.value).length).toBe(
      0,
    );

    // No single species carries a value above the cap, so the ceiling is only ever reached at 40
    // itself: for electric_charge that means two stacks of 20, which a port that clamps the
    // catalog value instead of the computed bonus never reproduces.
    expect(
      traits.rows.filter((row) => powerFamilies.includes(row.type) && row.value > 40).length,
    ).toBe(0);
    const atCap = traits.rows.flatMap((row) =>
      row.steps
        .filter((step) => step.op === "powerBonusPercent" && step.result === 40)
        .map(() => `${row.type}/${row.scenario}`),
    );
    expect(atCap.length).toBe(29);
    expect(new Set(atCap)).toEqual(
      new Set(["electric_charge/twoStacks", "electric_charge/cap", "low_hp_power_trade/core"]),
    );
    for (const row of traits.rows.filter((each) => each.type === "electric_charge"))
      expect(row.value, "electric_charge caps only through stacks").toBeLessThanOrEqual(20);
    for (const row of traits.rows.filter(
      (each) => each.type === "low_hp_power_trade" && each.scenario === "core",
    ))
      expect(row.value, "low_hp_power_trade sits on the cap itself").toBe(40);
  });

  it("carries what each buff writes onto the unit, which is not what its rule says", async () => {
    const mechanics = await (await newData()).statusMechanics();
    const stored = mechanics.buffStoredValues;
    const rules = mechanics.buffRules;
    // one row per Liệt Hỏa buff id, in id order, so a port can index the array by buff id
    expect(stored.map((row) => row.buffId)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
    expect(stored.filter((row) => !row.installs).map((row) => row.buffId)).toEqual([11]);
    expect(stored.filter((row) => row.clearsOneDebuff).map((row) => row.buffId)).toEqual([13]);
    expect(stored.filter((row) => row.clearsDebuffs).map((row) => row.buffId)).toEqual([14]);
    expect(stored.filter((row) => row.heal).map((row) => row.buffId)).toEqual([3, 5]);

    // Buff 1's rule primary is 50 but the engine stores 25 % of base defense: a port that reads
    // buffRules instead of buffStoredValues is wrong here and nothing else would tell it.
    expect(rules[1].primary).toBe(50);
    expect(stored[1].primary).toEqual({
      percentFrom: "literal",
      percent: 25,
      stat: "baseDefense",
    });
    // Buff 5 stores 30 and 100 where its rule reads 10 and 30, and heals on top of it.
    expect([rules[5].primary, rules[5].secondary]).toEqual([10, 30]);
    expect(stored[5].primary).toEqual({ percentFrom: "literal", percent: 30, stat: "none" });
    expect(stored[5].secondary).toEqual({ percentFrom: "literal", percent: 100, stat: "none" });
    expect(stored[5].heal).toEqual({ percentFrom: "literal", percent: 10, stat: "maxHp" });
    // Buff 3 stores its rule's *secondary* as the regeneration and heals its rule's primary.
    expect([rules[3].primary, rules[3].secondary]).toEqual([8, 7]);
    expect(stored[3].primary).toEqual({ percentFrom: "literal", percent: 7, stat: "maxHp" });
    expect(stored[3].heal).toEqual({ percentFrom: "literal", percent: 8, stat: "maxHp" });
    // Buff 4 is the only magnitude that scales per stack, against a cap of three.
    expect(stored[4].primary).toEqual({
      percentFrom: "rulePrimaryPerStack",
      percent: 0,
      stat: "baseDefense",
    });
    expect([rules[4].primary, rules[4].stackCap]).toEqual([7, 3]);

    // Every stat a magnitude is taken of is a base one: the projection cannot feed back into it,
    // so a port can compute the magnitude before it knows what else is active on the unit.
    const magnitudes = stored.flatMap((row) => [row.primary, row.secondary, row.heal]);
    const stats = new Set(magnitudes.flatMap((value) => (value ? [value.stat] : [])));
    expect([...stats].sort()).toEqual(["baseAttack", "baseDefense", "baseSpeed", "maxHp", "none"]);
    const sources = new Set(magnitudes.flatMap((value) => (value ? [value.percentFrom] : [])));
    expect([...sources].sort()).toEqual([
      "literal",
      "producerValue",
      "rulePrimary",
      "rulePrimaryPerStack",
      "ruleSecondary",
    ]);
  });

  it("pins the grid that had to prove the storage rows before the bake wrote them", async () => {
    const proof = (await (await newData()).statusMechanics()).buffStoredValueVerification;
    expect(proof.cells).toBe(proof.speciesIds.length * proof.levels.length);
    expect(proof.cells).toBe(64);
    // 26 (row, skill, stack-seed) combinations over 64 cells, plus one base-stat pass per row and
    // skill: a replay that quietly skipped the seeds or the overrides would drop this number.
    expect(proof.applications).toBe(1682);
    expect(proof.applications).toBeGreaterThan(proof.cells * 15);
    // 12 stat-based magnitudes, replayed again at every producer override and every stack seed
    expect(proof.separatedMagnitudes).toBe(23);
    expect(proof.percentSpace).toBe(200);
    expect(proof.stackSeeds).toEqual([0, 1, 2, 3, 4]);
    // level 150 builds the same unit as level 100, which is the point of shipping both
    expect(proof.levels).toEqual([20, 60, 100, 150]);
  });

  it("pins the stat slots, the quality percents and the natures that actually change stats", async () => {
    const meta = await (await newData()).goldenBattleMeta();
    expect(meta.statIndices).toEqual({
      quality: 0,
      hp: 1,
      attack: 2,
      defense: 3,
      speed: 4,
      form: 5,
      sideFlag: 6,
    });
    expect(meta.quality["5"].statPercent).toBe(125);
    expect(meta.quality["1"].statPercent).toBe(90);
    // out-of-range quality resolves to neutral rather than clamping to a neighbour
    expect(meta.quality["-2"].resolveNeutral).toBe(3);
    expect(meta.quality["7"].resolveNeutral).toBe(3);

    const baseline = meta.natureAppliedToHpAttackDefenseSpeed["1"];
    for (const type of ["2", "3", "4", "5", "6", "10"])
      expect(
        meta.natureAppliedToHpAttackDefenseSpeed[type],
        `nature ${type} must not move a stat`,
      ).toEqual(baseline);
    // Only three natures do anything, and none of them touches the defense slot: a port that
    // applies a nature curve to every type, or to defense, would disagree with the engine here.
    const moves = Object.entries(meta.natureAppliedToHpAttackDefenseSpeed)
      .filter(([, stats]) => stats.join() !== baseline.join())
      .map(([type]) => type);
    expect(moves).toEqual(["7", "8", "9"]);
    for (const type of moves)
      expect(meta.natureAppliedToHpAttackDefenseSpeed[type][2]).toBe(baseline[2]);
    const [hp, attack, , speed] = baseline;
    expect(meta.natureAppliedToHpAttackDefenseSpeed["7"][0]).toBeLessThan(hp);
    expect(meta.natureAppliedToHpAttackDefenseSpeed["7"][3]).toBeGreaterThan(speed);
    expect(meta.natureAppliedToHpAttackDefenseSpeed["8"][1]).toBeGreaterThan(attack);
    expect(meta.natureAppliedToHpAttackDefenseSpeed["8"][3]).toBeLessThan(speed);
    expect(meta.natureAppliedToHpAttackDefenseSpeed["9"][0]).toBeGreaterThan(hp);
    expect(meta.natureAppliedToHpAttackDefenseSpeed["9"][3]).toBeLessThan(speed);
  });

  it("carries the scene1 cast, every skill it knows, and a floor of one damage", async () => {
    const data = await newData();
    const [damage, units, meta] = await Promise.all([
      data.goldenDamage(),
      data.goldenBattleUnits(),
      data.goldenBattleMeta(),
    ]);
    expect(damage.cast.length).toBe(11);
    expect(damage.cast.map((each) => each.label)[0]).toBe("starter");
    expect(Object.keys(units.encounters).length).toBe(109);
    // every attacker/defender pair, every authored skill of the attacker, three scripted roll pairs
    expect(damage.rows.length).toBe(825);
    expect(damage.levelScaling.length).toBe(54);
    expect(Math.min(...damage.rows.map((row) => row.damage))).toBe(1);
    expect(new Set(damage.rows.map((row) => row.relation))).toEqual(new Set([-1, 0, 1]));

    for (const roll of [0, 99])
      for (const row of damage.rows.filter((each) => each.critRoll === roll))
        expect(row.critFlag, `critRoll ${roll} on ${row.attacker}/${row.skillId}`).toBe(
          roll === 0 ? 1 : 0,
        );
    // the starter's built attack is the number every damage row was measured against
    expect(units.starter.currentStats[meta.statIndices.attack]).toBe(111);
  });

  it("records the random draws the engine asked for, including the ones it skips", async () => {
    const rows = (await (await newData()).goldenDamage()).rows;
    const labels = new Set(
      rows.flatMap((row) => row.draws ?? []).map((draw) => draw.split("=")[0]),
    );
    expect([...labels].sort()).toEqual(["damage.crit", "damage.debuff", "damage.jitter"]);

    const noJitter = rows.filter((row) => !hasDraw(row, "damage.jitter"));
    // A hit floored to 1 never reaches the jitter roll, so a port that always draws three values
    // would consume the shared stream differently from Java.
    expect(noJitter.length).toBe(66);
    for (const row of noJitter) {
      expect(row.damage).toBe(1);
      expect(row.draws?.length).toBe(1);
    }
    expect(rows.filter((row) => hasDraw(row, "damage.debuff")).length).toBe(99);
    expect(rows.filter((row) => hasDraw(row, "damage.jitter")).length).toBe(759);
  });

  function hasDraw(row: GoldenDamageRow, label: string): boolean {
    return (row.draws ?? []).some((draw) => draw.startsWith(`${label}=`));
  }

  it("keeps the jitter rule exactly where the engine put it", async () => {
    const rows = (await (await newData()).goldenDamage()).rows;
    const pairs = jitterPairs(rows);
    expect(pairs.size).toBe(275);
    let moved = 0;
    for (const { low, high } of pairs.values()) {
      if (low === high) {
        // unchanged means either the +-1 nudge was out of reach (>= 50 damage) or the floor held
        expect(high === 1 || high >= 50, `damage ${high} should have moved`).toBe(true);
        continue;
      }
      moved++;
      expect(high - low <= 2, `${low} -> ${high}`).toBe(true);
      expect(high).toBeLessThan(51);
    }
    // a hand-typed formula that assumes jitter is decoration fails 64 of these 275 pairs
    expect(moved).toBe(64);
  });

  it("answers every dispatch cell once, in the engine's own priority order", async () => {
    const flow = await (await newData()).goldenFlow();
    expect(flow.inputOrder).toEqual([
      "playerAlive",
      "enemyAlive",
      "kidnapping",
      "playerActed",
      "enemyActed",
      "playerHeldItem7",
      "enemyHeldItem7",
      "playerTraitPriority",
      "enemyTraitPriority",
    ]);
    const cells = new Set(
      flow.dispatch.map((row) => `${row.bits.join(",")}|${row.speed.join(",")}`),
    );
    expect(flow.dispatch.length).toBe(1536);
    expect(cells.size).toBe(1536); // 512 boolean masks x 3 speed pairs, no duplicates

    const bit = (row: (typeof flow.dispatch)[number], index: number) => row.bits[index];
    // the two defeats short-circuit everything else, in that order
    for (const row of flow.dispatch.filter((each) => !bit(each, 0)))
      expect([row.command, row.reason]).toEqual(["PLAYER_DEFEATED", "PLAYER_DEFEATED"]);
    for (const row of flow.dispatch.filter((each) => bit(each, 0) && !bit(each, 1)))
      expect([row.command, row.reason]).toEqual(["ENEMY_DEFEATED", "ENEMY_DEFEATED"]);
    for (const row of flow.dispatch.filter((each) => bit(each, 0) && bit(each, 1) && bit(each, 2)))
      expect([row.command, row.reason]).toEqual(["ENEMY_TURN", "KIDNAPPING"]);
    expect(new Set(flow.dispatch.map((row) => row.reason)).size).toBe(9);
  });

  it("has teeth: a wrong priority rule disagrees with the grid", async () => {
    const flow = await (await newData()).goldenFlow();
    const fresh = flow.dispatch.filter(
      (row) => row.bits[0] && row.bits[1] && !row.bits[2] && !row.bits[3] && !row.bits[4],
    );
    expect(fresh.length).toBe(48);

    type Rule = (row: { bits: boolean[]; speed: number[] }) => string;
    const engineOrder: Rule = ({ bits, speed }) => {
      if (bits[5] || bits[6]) return bits[5] ? "PLAYER_TURN" : "ENEMY_TURN";
      if (bits[7] || bits[8]) return bits[7] && !bits[8] ? "PLAYER_TURN" : "ENEMY_TURN";
      return speed[1] > speed[0] ? "ENEMY_TURN" : "PLAYER_TURN";
    };
    const forgetsItem7: Rule = ({ bits, speed }) => {
      if (bits[7] || bits[8]) return bits[7] && !bits[8] ? "PLAYER_TURN" : "ENEMY_TURN";
      return speed[1] > speed[0] ? "ENEMY_TURN" : "PLAYER_TURN";
    };
    const tiesGoToEnemy: Rule = ({ bits, speed }) => {
      if (bits[5] || bits[6]) return bits[5] ? "PLAYER_TURN" : "ENEMY_TURN";
      if (bits[7] || bits[8]) return bits[7] && !bits[8] ? "PLAYER_TURN" : "ENEMY_TURN";
      return speed[1] >= speed[0] ? "ENEMY_TURN" : "PLAYER_TURN";
    };
    const speedFirst: Rule = ({ bits, speed }) => {
      if (bits[5] || bits[6]) return bits[5] ? "PLAYER_TURN" : "ENEMY_TURN";
      if (speed[1] > speed[0]) return "ENEMY_TURN";
      return bits[7] && !bits[8] ? "PLAYER_TURN" : "ENEMY_TURN";
    };

    const rules: [string, Rule, number][] = [
      ["the engine's own order", engineOrder, 0],
      ["held item 7 forgotten", forgetsItem7, 19],
      ["equal speed handed to the enemy", tiesGoToEnemy, 1],
      ["speed read before the trait priority", speedFirst, 3],
    ];
    for (const [name, rule, expected] of rules) {
      const disagreements = fresh.filter((row) => rule(row) !== row.command).length;
      expect(disagreements, name).toBe(expected);
    }
    // 0 for the shipped order, non-zero for every rule a port could mis-type: the grid decides.
    expect(rules.filter(([, , expected]) => expected > 0).length).toBe(3);
  });

  it("keeps the catch and exp answers the outcome engines gave", async () => {
    const data = await newData();
    const [catchTable, expTable] = await Promise.all([data.goldenCatch(), data.goldenExp()]);
    const allCatch = [...Object.values(catchTable.isolated).flat(), ...catchTable.combinations];
    for (const row of allCatch) {
      expect(row.chance).toBeGreaterThanOrEqual(1);
      expect(row.chance).toBeLessThanOrEqual(100);
    }
    // no item is a 100 % catch; the first banded item starts at 9 % on a healthy enemy
    expect(catchTable.isolated.itemId[0]).toMatchObject({ chance: 100, caught: true });
    expect(catchTable.isolated.itemId.slice(1).map((row) => row.chance)).toEqual([9, 9, 9, 9, 9]);
    expect(catchTable.itemTable.length).toBe(15);
    expect(catchTable.storage.length).toBe(16);
    expect(catchTable.storage[0].outcome).toBe("ROSTER");

    expect(expTable.requiredExpPerLevel.length).toBe(100);
    expect(expTable.requiredExpPerLevel.slice(0, 4)).toEqual([1, 1, 1, 40]);
    expect(expTable.combinations.length).toBe(60);
    expect(expTable.levelGap.length).toBe(324);
    // EXP is awarded once the enemy is at or below zero, and never through a capture
    expect(expTable.eligibility["enemyHp-1"]).toBe(true);
    expect(expTable.eligibility["enemyHp0"]).toBe(true);
    expect(expTable.eligibility["enemyHp1"]).toBe(false);
    expect(expTable.eligibility.bunnyCapture).toBe(false);
    expect(expTable.expCompletion.map((row) => row.outcome)).toEqual([
      "OPEN_SKILL_LEARN",
      "OPEN_SKILL_LEARN",
      "LEVEL_AGAIN",
      "FINISH_PET",
    ]);
    expect(expTable.eligibility.reserveShare).toEqual({ heldItem6: 1000, plain: "SKIP" });
  });

  it("grades the trait composition the live battle actually runs", async () => {
    const data = await newData();
    const [table, units, traits, design] = await Promise.all([
      data.goldenTraitBattle(),
      data.goldenBattleUnits(),
      data.physicalTraits(),
      data.designTraits(),
    ]);

    // The fight is the scene1 tutorial, so its two units must be the same two units the unit table
    // already grades — otherwise this would be evidence about a fight the player never sees.
    expect(table.units.playerSpecies).toBe(units.starter.speciesId);
    const bunny = units.encounters["SCENE1_ROOM1_GROUP0_BUNNY"];
    expect(table.units.enemySpecies).toBe(bunny.enemy.speciesId);
    expect(table.units.enemyEncounter).toEqual(bunny.encounter);
    // The fight is the scene1 tutorial, so its two units must be built from the same two units the
    // unit table already grades. Only the side that does not carry the talent can match it exactly:
    // the owner's permanent stats are the talent resolver's answer on top of the build, and that is
    // part of what this table is here to grade.
    const starterStats = {
      hp: units.starter.hp,
      maxHp: units.starter.maxHp,
      attack: units.starter.currentStats[2],
      defense: units.starter.currentStats[3],
      speed: units.starter.currentStats[4],
    };
    const bunnyStats = {
      maxHp: bunny.enemy.maxHp,
      attack: bunny.enemy.currentStats[2],
      defense: bunny.enemy.currentStats[3],
      speed: bunny.enemy.currentStats[4],
    };
    for (const row of table.battles) {
      const plain = row.talentOwner === "player" ? "enemy" : "player";
      expect(row.beforeEnter[plain]).toMatchObject({
        physicalTraitId: 0,
        ...(plain === "player" ? starterStats : bunnyStats),
      });
      // Talent 0 (Bình hòa) is neutral, so on those rows the owner is an ordinary unit too and the
      // whole fight starts from the two units the unit table already grades.
      if (row.talent === 0) {
        expect(row.beforeEnter.player).toMatchObject(starterStats);
        expect(row.beforeEnter.enemy).toMatchObject(bunnyStats);
      }
      // The low band is the harness's own clip, run after the unit is built and before the
      // projection is asked for anything, so the Bunny still carries the defense its full-HP build
      // wrote. A port that refreshed the band on the HP write would answer 12 here instead.
      expect(row.beforeEnter.enemy.hp).toBe(
        Math.floor((row.beforeEnter.enemy.maxHp * row.enemyHpPercent) / 100),
      );
      expect(row.beforeEnter.enemy.defense).toBe(bunny.enemy.currentStats[3]);
      // The owner's max HP is the resolver's own answer for the built unit, read out of the other
      // section of this table rather than recomputed here, and the neutral side is the plain build.
      const resolverAnswer = (talent: number, base: number[]) =>
        table.permanentStats.find(
          (stat) =>
            stat.physicalTraitId === talent && JSON.stringify(stat.base) === JSON.stringify(base),
        )!.projected[0];
      expect(row.beforeEnter.player.maxHp).toBe(
        resolverAnswer(row.talentOwner === "player" ? row.talent : 0, [
          units.starter.maxHp,
          units.starter.currentStats[2],
          starterStats.defense,
          starterStats.speed,
        ]),
      );
      expect(row.beforeEnter.enemy.maxHp).toBe(
        resolverAnswer(row.talentOwner === "enemy" ? row.talent : 0, [
          bunny.enemy.maxHp,
          bunnyStats.attack,
          bunnyStats.defense,
          bunnyStats.speed,
        ]),
      );
    }

    // The characteristic is live on both sides yet neither identity field is set, because Java forces
    // them to -1 for any species the design catalog covers and resolves the trait by species instead.
    const bySpecies = new Map(design.map((row) => [row.speciesId, row]));
    for (const [speciesId, want] of [
      [table.units.playerSpecies, table.units.playerCharacteristic],
      [table.units.enemySpecies, table.units.enemyCharacteristic],
    ] as const) {
      const row = bySpecies.get(speciesId)!;
      expect(want).toMatchObject({ speciesId, key: row.key, type: row.type, value: row.value });
    }
    for (const row of table.battles)
      for (const snapshot of [row.beforeEnter, row.afterEnter])
        for (const side of ["player", "enemy"] as const)
          expect(snapshot[side]).toMatchObject({
            speciesTraitId: -1,
            characteristicTraitId: -1,
            characteristicEnabled: true,
          });

    // The grid is 8 rollable talents x either owner x either HP band, and the eight are the eight the
    // battle projection is graded for in golden-physical-traits.json.
    expect(table.battles).toHaveLength(8 * 2 * 2);
    expect([...new Set(table.battles.map((row) => row.talent))].sort((a, b) => a - b)).toEqual([
      0, 2, 4, 8, 11, 12, 13, 16,
    ]);
    for (const row of table.battles) {
      expect(
        row.talentOwner === "player" ? row.beforeEnter.player : row.beforeEnter.enemy,
      ).toMatchObject({ physicalTraitId: row.talent });
      expect(
        row.talentOwner === "player" ? row.beforeEnter.enemy : row.beforeEnter.player,
      ).toMatchObject({ physicalTraitId: 0 });
    }

    // The band actually moves: the Bunny is hit through the defense its full-HP build wrote, and the
    // round that leaves it under the band takes that defense away, so the next hit lands harder. A
    // port that projects the characteristic once, or never, answers one of these two the same.
    const healthy = table.battles.find(
      (row) => row.talent === 0 && row.talentOwner === "player" && row.enemyHpPercent === 100,
    )!;
    expect(healthy.beforeEnter.enemy.defense).toBe(bunny.enemy.currentStats[3]);
    expect(healthy.beforeEnter.enemy.baseDefense).toBe(bunny.enemy.baseStats[3]);
    expect(healthy.beforeEnter.enemy.defense).toBeGreaterThan(
      healthy.beforeEnter.enemy.baseDefense,
    );
    expect(healthy.rounds[0].enemy.defense).toBe(healthy.rounds[0].enemy.baseDefense);
    expect(healthy.rounds[1].planDamage).toBeGreaterThan(healthy.rounds[0].planDamage);
    // and the starter keeps what it earned: acting first grows its speed and never shrinks it.
    const speeds = healthy.rounds.map((round) => round.afterRoundEnd.player.speed);
    expect(speeds).toHaveLength(2);
    expect(speeds[0]).toBeGreaterThan(healthy.afterEnter.player.speed);
    expect(speeds[1]).toBeGreaterThan(speeds[0]);
    // The low band never regains the defense it was carrying when it was built, so its first hit is
    // the same size as the healthy side's: the projection is not re-run to catch up with the HP.
    const clipped = table.battles.find(
      (row) => row.talent === 0 && row.talentOwner === "player" && row.enemyHpPercent === 30,
    )!;
    expect(clipped.rounds[0].planDamage).toBe(healthy.rounds[0].planDamage);

    // The two identity rules the save has to reproduce. The entropy is a string because the sweep
    // reaches Long.MIN_VALUE and Long.MAX_VALUE, which a JSON number would round to another integer.
    const rollable = traits.filter((row) => row.rollWeight > 0);
    expect(table.roller.totalWeight).toBe(rollable.length);
    const weightOf = (id: number) => rollable.find((row) => row.runtimeId === id)!.rollWeight;
    let cursor = 0n;
    const walk = new Map<bigint, number>();
    for (const row of rollable) {
      for (let i = 0; i < weightOf(row.runtimeId); i++) walk.set(cursor + BigInt(i), row.runtimeId);
      cursor += BigInt(weightOf(row.runtimeId));
    }
    for (const row of table.roller.rows)
      expect(row.physicalTraitId, `entropy ${row.entropy}`).toBe(
        walk.get(((BigInt(row.entropy) % cursor) + cursor) % cursor)!,
      );
    expect(table.roller.sanitize.every((row) => row.result === row.physicalTraitId)).toBe(false);
    for (const row of table.roller.valid)
      expect(row.valid).toBe(rollable.some((trait) => trait.runtimeId === row.physicalTraitId));

    // Only the eight percent-stat talents move a permanent stat, each only its own slot.
    const percentStat = /"(max_hp|strength|defense|agility)_percent"/;
    const movers = new Set(
      table.permanentStats
        .filter((row) => JSON.stringify(row.base) !== JSON.stringify(row.projected))
        .map((row) => row.physicalTraitId),
    );
    expect([...movers].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const row of table.permanentStats) {
      const spec = traits.find((trait) => trait.runtimeId === row.physicalTraitId);
      const parameter = spec?.parametersJson.match(percentStat)?.[1];
      const slot = parameter
        ? (["max_hp", "strength", "defense", "agility"] as const).indexOf(
            parameter as "max_hp" | "strength" | "defense" | "agility",
          )
        : -1;
      const percent = parameter
        ? Number(spec!.parametersJson.match(new RegExp(`"${parameter}_percent":(-?\\d+)`))![1])
        : 0;
      row.base.forEach((base, index) => {
        expect(row.projected[index], `${row.physicalTraitId}/${index}`).toBe(
          index === slot
            ? Math.max(1, Math.trunc((base * (100 + percent)) / 100))
            : Math.max(1, base),
        );
      });
    }
  });
});
