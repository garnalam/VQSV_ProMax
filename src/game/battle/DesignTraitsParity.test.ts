import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GameData } from "../../data/GameData";
import { Pack } from "../../pack/Pack";
import { DesignTraitMechanics } from "./DesignTraits";
import { StatusEffects } from "./StatusState";
import { loadBattleRules } from "./BattleRules";

vi.stubGlobal("fetch", async (input: string) => ({
  ok: true,
  status: 200,
  json: async () =>
    JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, "../../../public", input.replace(/^\//, "")),
        "utf8",
      ),
    ),
}));

const data = new GameData(await Pack.load());
const effects = await StatusEffects.load(data);
const mechanics = await DesignTraitMechanics.load(data, effects);
const unit = (speciesId: number, ownerSide = 0) =>
  mechanics.unit({
    speciesId,
    ownerSide,
    formationSlot: 0,
    base: { hp: 10_000, attack: 100, defense: 100, speed: 100 },
  });

describe("Test Huy characteristic runtime parity", () => {
  it.each([9, 10])("reduces species %i's first direct hit by 40 percent once each round", async (speciesId) => {
    const rules = await loadBattleRules(data);
    const create = (id: number, ownerSide: number) => rules.traits.unit({
      speciesId: id, ownerSide, formationSlot: 0,
      base: { hp: 10_000, attack: 100, defense: 100, speed: 100 },
    });
    const source = create(280, 1), target = create(speciesId, 0);
    expect(rules.traits.incoming(source, target, 100)).toBe(60);
    expect(rules.traits.incoming(source, target, 100)).toBe(100);
    target.designTraitState.round++;
    expect(rules.traits.incoming(source, target, 100)).toBe(60);
    const balance = (await data.designTraitBalanceBySpecies()).get(speciesId)!;
    expect(balance.value).toBe(40);
    expect(balance.description).toContain("40%");
  });

  it("caps repeated stack gains at three and still refreshes duration", () => {
    const actor = unit(0);
    for (let i = 0; i < 5; i++) mechanics.stack(actor, 19, i + 1, 3, 10);
    expect(actor.statuses.get(0, 19)).toMatchObject({ stackCount: 3, remainingTurns: 5 });
    actor.restoreStatsForCheck();
    expect(actor.currentStats.attack).toBe(130);
    mechanics.stack(actor, 19, 2, 1, 10);
    expect(actor.statuses.get(0, 19)?.stackCount).toBe(1);
  });

  it("stores no more than three electric charges", async () => {
    const rows = await data.designTraits();
    const actor = unit(rows.find((row) => row.type === "electric_charge")!.speciesId);
    const target = unit(280, 1);
    for (let round = 1; round <= 5; round++) {
      actor.designTraitState.round = round;
      mechanics.afterHit(actor, target, 0, 1);
    }
    expect(actor.statuses.get(0, 17)?.stackCount).toBe(3);
  });
  it("reduces species 47's first direct hit by 30 percent once each round", async () => {
    const actor = unit(280, 1),
      target = unit(47);
    expect(mechanics.incoming(actor, target, 100)).toBe(70);
    expect(mechanics.incoming(actor, target, 100)).toBe(100);
    target.designTraitState.round++;
    expect(mechanics.incoming(actor, target, 100)).toBe(70);
    const balance = (await data.designTraitBalanceBySpecies()).get(47)!;
    expect(balance.value).toBe(30);
    expect(balance.description).toContain("30%");
  });
});
