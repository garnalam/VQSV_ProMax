import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GameData } from "../../../data/GameData";
import { Pack } from "../../../pack/Pack";
import { DesignTraitMechanics } from "../DesignTraits";
import { StatusEffects, StatusInstance } from "../StatusState";
import { KimDiemDebuffReflection } from "./KimDiemLongAn";

vi.stubGlobal("fetch", async (input: string) => ({
  ok: true,
  status: 200,
  json: async () =>
    JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, "../../../../public", input.replace(/^\//, "")),
        "utf8",
      ),
    ),
}));
const data = new GameData(await Pack.load());
const effects = await StatusEffects.load(data);
const mechanics = await DesignTraitMechanics.load(data, effects);
const unit = (boss = false) =>
  mechanics.unit({
    speciesId: boss ? 280 : 68,
    ownerSide: boss ? 1 : 0,
    formationSlot: boss ? 0 : 1,
    base: { hp: 1000, attack: 100, defense: 100, speed: 100 },
  });
const status = (bank: number, id: number, value = 20) =>
  new StatusInstance(effects.catalog.definition(bank, id)!, 3, 2, value, 7, 1, 0, 1, 12, 9);

describe("Long Ấn debuff reflection", () => {
  it("returns new ordinary and rainbow debuffs with dragon ownership, leaving buffs intact", () => {
    const boss = unit(true),
      attacker = unit(),
      reflection = new KimDiemDebuffReflection(boss);
    boss.statuses.put(status(0, 0));
    boss.statuses.put(status(1, 5));
    boss.statuses.put(status(2, 5));
    expect(reflection.returnTo(attacker)).toBe(true);
    expect(boss.statuses.has(0, 0)).toBe(true);
    expect(boss.statuses.has(1, 5)).toBe(false);
    expect(boss.statuses.has(2, 5)).toBe(false);
    expect(attacker.statuses.get(1, 5)).toMatchObject({
      primaryValue: 20,
      sourceSide: 1,
      sourceSlot: 0,
      sourceSkillId: 12,
      remainingTurns: 3,
      remainingActions: 2,
      flags: 9,
    });
    expect(attacker.statuses.get(2, 5)?.primaryValue).toBe(20);
    expect(attacker.currentStats.speed).toBeLessThan(100);
  });

  it("restores an existing debuff after in-place changes and reflects its changed payload", () => {
    const boss = unit(true),
      attacker = unit();
    boss.statuses.put(status(1, 5));
    const reflection = new KimDiemDebuffReflection(boss);
    boss.statuses.get(1, 5)!.primaryValue = 40;
    boss.statuses.get(1, 5)!.remainingTurns = 8;
    expect(reflection.returnTo(attacker)).toBe(true);
    expect(boss.statuses.get(1, 5)).toMatchObject({ primaryValue: 20, remainingTurns: 3 });
    expect(attacker.statuses.get(1, 5)).toMatchObject({ primaryValue: 40, remainingTurns: 8 });
  });

  it("leaves an unchanged instance alone but reflects an equal replacement", () => {
    const boss = unit(true),
      attacker = unit();
    boss.statuses.put(status(1, 5));
    const reflection = new KimDiemDebuffReflection(boss);
    expect(reflection.returnTo(attacker)).toBe(false);
    expect(attacker.statuses.has(1, 5)).toBe(false);
    boss.statuses.put(status(1, 5));
    expect(reflection.returnTo(attacker)).toBe(true);
    expect(attacker.statuses.has(1, 5)).toBe(true);
  });

  it("removes new debuffs even if the attacker died, and does not undo a cleanse", () => {
    const boss = unit(true),
      attacker = unit();
    boss.statuses.put(status(1, 5));
    const reflection = new KimDiemDebuffReflection(boss);
    boss.statuses.remove(1, 5);
    boss.statuses.put(status(2, 5));
    attacker.setHp(0);
    expect(reflection.returnTo(attacker)).toBe(true);
    expect(boss.statuses.has(1, 5)).toBe(false);
    expect(boss.statuses.has(2, 5)).toBe(false);
    expect(attacker.statuses.has(2, 5)).toBe(false);
  });
});
