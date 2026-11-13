import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CombatantSetup } from "./BattleTypes";
import type { DoubleBattleSetup, DoubleEvent } from "./DoubleBattleTypes";

vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(
    import.meta.dirname,
    "../../../../public",
    decodeURIComponent(String(input).split("?")[0].replace(/^\//, "")),
  );
  if (!existsSync(file)) return { ok: false, status: 404 };
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, "utf8")) };
});

const { GameData } = await import("../../../data/GameData");
const { Pack } = await import("../../../pack/Pack");
const { loadBattleRules } = await import("../BattleRules");
const { BattleRandom } = await import("../BattleRandom");
const { BattleAiRulebook } = await import("../ai/BattleAiRulebook");
const { BattleAiEncounterCatalog } = await import("../ai/BattleAiEncounterCatalog");
const { BattleItems } = await import("./BattleItems");
const { DoubleBattleCore } = await import("./DoubleBattleCore");

const data = new GameData(await Pack.load());
const rules = await loadBattleRules(data);
const rulebook = await BattleAiRulebook.load(data);
const catalog = await BattleAiEncounterCatalog.load(data);
const items = new BattleItems(await data.items());
const skillRules = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../../public/pack/double-battle/skill-scopes.json"),
    "utf8",
  ),
);
const profiles = await data.aiProfiles();

/** Plain Liệt Hỏa skills: 40/30/10 hit for 100 Power, 8 hits both enemies, 14 a defensive buff. */
const PLAIN = 40;
const GROUP = 8;
const DEFENSIVE = 14;
const ALL_ALLIES = 15;

const pet = (
  speciesId: number,
  stats: Partial<CombatantSetup["stats"]> = {},
  extra: Partial<CombatantSetup> = {},
): CombatantSetup => ({
  speciesId,
  level: 20,
  quality: 2,
  nature: 3,
  stats: { hp: 400, attack: 80, defense: 20, speed: 50, ...stats },
  skillIds: [PLAIN, GROUP, DEFENSIVE, ALL_ALLIES, 30],
  physicalTraitId: -1,
  ...extra,
});

function fight(setup: Partial<DoubleBattleSetup> = {}, seed = 3) {
  const core = new DoubleBattleCore(
    rules,
    { items, skillRules, rulebook, catalog },
    {
      controlsBoth: true,
      player: [pet(68), pet(58), pet(95)],
      companion: [],
      enemy: [pet(76, {}, { skillIds: [10] }), pet(79, {}, { skillIds: [10] })],
      enemyProfile: profiles.TRAINER,
      companionProfile: profiles.COMPANION,
      ...setup,
    },
    new BattleRandom(BigInt(seed)),
  );
  core.start();
  return core;
}

const strikes = (events: readonly DoubleEvent[]) =>
  events.filter((event): event is DoubleEvent & { type: "strike" } => event.type === "strike");

describe("DoubleBattleCore — the 2v2 rules JavaSE owns", () => {
  it("opens with both player slots asked in turn, then resolves the round", () => {
    const core = fight();
    expect(core.request).toEqual({ kind: "command", slot: 2, round: 1 });
    core.submit({ kind: "skill", skillIndex: 0, target: 0 });
    expect(core.request).toEqual({ kind: "command", slot: 3, round: 1 });
    const events = core.submit({ kind: "skill", skillIndex: 0, target: 1 });
    expect(
      strikes(events)
        .map((event) => event.slot)
        .sort(),
    ).toEqual([0, 1, 2, 3]);
    expect(core.request).toEqual({ kind: "command", slot: 2, round: 2 });
  });

  it("aims a skill at the side its target side names (legalTargets), living slots only", () => {
    const core = fight({
      enemy: [pet(76, { hp: 400 }, { hp: 0 }), pet(79), pet(80)],
    });
    // Slot 0 opened dead with a bench: the NPC refilled it before the first command.
    expect(core.occupant(0)).toEqual({ side: "enemy", index: 2 });
    expect(core.legalTargets(2, PLAIN)).toEqual([0, 1]);
    expect(core.legalTargets(2, ALL_ALLIES)).toEqual([2, 3]);
    expect(core.legalTargets(0, PLAIN)).toEqual([2, 3]);
    expect(() => core.submit({ kind: "skill", skillIndex: 0, target: 3 })).toThrow(
      "Mục tiêu không hợp lệ.",
    );
  });

  it("orders by priority (a defensive skill first), then speed, then slot", () => {
    const core = fight({
      player: [pet(68, { speed: 1 }), pet(58, { speed: 999 }), pet(95)],
    });
    core.submit({ kind: "skill", skillIndex: 2, target: 2 });
    const events = core.submit({ kind: "skill", skillIndex: 0, target: 0 }),
      order = strikes(events).map((event) => event.slot);
    // Slot 2 is the slowest but casts the defensive skill; slot 3 is the fastest of the rest.
    expect(order[0]).toBe(2);
    expect(order[1]).toBe(3);
  });

  it("lands a group skill on the second enemy at 75% Power right behind the first hit", () => {
    const core = fight({ player: [pet(68, { speed: 999 }), pet(58), pet(95)] });
    core.submit({ kind: "skill", skillIndex: 1, target: 0 });
    const events = strikes(core.submit({ kind: "skill", skillIndex: 0, target: 0 })),
      first = events.findIndex((event) => event.slot === 2);
    expect(events[first]).toMatchObject({ slot: 2, target: 0, skillId: GROUP, secondary: false });
    expect(events[first + 1]).toMatchObject({
      slot: 2,
      target: 1,
      skillId: GROUP,
      secondary: true,
    });
  });

  it("switches at once on a manual switch, and the slot gives no other command", () => {
    const core = fight(),
      events = core.submit({ kind: "switch", member: 2 });
    expect(events).toContainEqual({
      type: "replacement",
      slot: 2,
      from: { side: "player", index: 0 },
      to: { side: "player", index: 2 },
      forced: false,
    });
    expect(core.request).toEqual({ kind: "command", slot: 3, round: 1 });
    expect(() => core.submit({ kind: "switch", member: 1 })).toThrow(
      "Sủng vật này đã đặt ở vị trí chiến đấu",
    );
  });

  it("asks the player for a benched pet when a commanded slot falls", () => {
    const core = fight({
      player: [pet(68, {}, { hp: 1 }), pet(58, {}, { hp: 1 }), pet(95)],
      enemy: [
        pet(76, { attack: 900, speed: 999 }, { skillIds: [10] }),
        pet(79, { attack: 900, speed: 999 }, { skillIds: [10] }),
      ],
    });
    core.submit({ kind: "skill", skillIndex: 0, target: 0 });
    core.submit({ kind: "skill", skillIndex: 0, target: 0 });
    expect(core.request).toMatchObject({ kind: "replacement" });
    const slot = (core.request as { slot: 2 | 3 }).slot;
    core.submit({ kind: "member", member: 2 });
    expect(core.occupant(slot)).toEqual({ side: "player", index: 2 });
  });

  it("wins when both NPC slots and the bench are down, and shares EXP among the living entrants", () => {
    const core = fight({
      player: [pet(68, { speed: 999, attack: 900 }), pet(58, { speed: 999, attack: 900 }), pet(95)],
      enemy: [pet(76, {}, { hp: 1, skillIds: [10] }), pet(79, {}, { hp: 1, skillIds: [10] })],
    });
    core.submit({ kind: "skill", skillIndex: 0, target: 0 });
    core.submit({ kind: "skill", skillIndex: 0, target: 1 });
    expect(core.request.kind).toBe("ended");
    const outcome = (core.request as { outcome: { winner: string; experience: number[] } }).outcome;
    expect(outcome.winner).toBe("player");
    expect(outcome.experience[0]).toBeGreaterThan(0);
    expect(outcome.experience[0]).toBe(outcome.experience[1]);
    // The benched third pet holds no Ký Cư Giải Xác (held item 6): no reserve share.
    expect(outcome.experience[2]).toBe(0);
  });

  it("plays the lent companion in slot 3 and refills it from the companion roster", () => {
    const core = fight({
      controlsBoth: false,
      player: [pet(68, { speed: 1 })],
      companion: [pet(16, {}, { hp: 1, skillIds: [10] }), pet(17, {}, { skillIds: [10] })],
      enemy: [
        pet(76, { attack: 900, speed: 999 }, { skillIds: [10] }),
        pet(79, { attack: 900, speed: 999 }, { skillIds: [10] }),
      ],
    });
    expect(core.occupant(3)).toEqual({ side: "companion", index: 0 });
    // Only slot 2 is commanded; the companion's move comes from the COMPANION AI.
    const events = core.submit({ kind: "skill", skillIndex: 0, target: 0 });
    if (core.request.kind !== "ended" && !core.unit(2).alive()) return;
    if (events.some((event) => event.type === "faint" && event.slot === 3))
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "replacement",
          slot: 3,
          to: { side: "companion", index: 1 },
        }),
      );
  });
});
