import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GameData } from "../../data/GameData";
import { Pack } from "../../pack/Pack";
import type { SavedPet } from "../../persistence/SaveRepository";
import type { WorldContract } from "../story/GameAssets";
import {
  BattleDefinitionRegistry,
  createCaptureTutorialBattleDefinition,
} from "./BattleDefinition";
import { BattleRuntime } from "./BattleRuntime";
import { loadBattleRules } from "./BattleRules";
import { NO_HELD_ITEM } from "./HeldItems";
import { PetStatCalculator } from "./PetStatCalculator";

const root = resolve(import.meta.dirname, "..", "..", "..");
vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(root, "public", decodeURIComponent(input.replace(/^\//, "")));
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, "utf8")) };
});

const contract = JSON.parse(
  readFileSync(resolve(root, "public/pack/story/world-contract.json"), "utf8"),
) as WorldContract;
const data = new GameData(await Pack.load()),
  rules = await loadBattleRules(data),
  petStats = await PetStatCalculator.load(data);

/** The tutorial fight, with a pet that carries `skillIds` instead of the authored two. */
function fight(skillIds: number[]): { battle: BattleRuntime; pet: SavedPet } {
  const stats = {
    player: petStats.coreStats(68, contract.player.level, contract.player.quality),
    opponent: petStats.coreStats(34, contract.opponent.level, contract.opponent.quality),
  };
  const pet: SavedPet = {
    slot: 0,
    speciesId: 68,
    level: contract.player.level,
    quality: contract.player.quality,
    nature: contract.player.nature ?? 0,
    currentHp: stats.player.hp,
    maxHp: stats.player.hp,
    experience: 0,
    visualSpriteId: contract.player.spriteId,
    heldEquipmentId: NO_HELD_ITEM,
    skillIds,
    skillPp: skillIds.map((id) => rules.damage.skillRow(id)!.ppMax),
  };
  const battle = new BattleRuntime(
    {
      actorId: contract.encounter.actorId,
      encounter: contract.encounter.request,
      flags: contract.encounter.flags,
      mode: contract.encounter.mode,
      branchTargets: contract.encounter.branchTargets,
    },
    new BattleDefinitionRegistry([createCaptureTutorialBattleDefinition(contract, pet, stats)]),
    rules,
    pet,
    contract.player.skills ?? [],
    contract.itemCatalog ?? [],
  );
  return { battle, pet };
}

/** fight → skill list → the slot → play the action out; returns what the screen showed. */
function cast(battle: BattleRuntime, slot: number) {
  const inv: Record<string, number> = { "0": 1, "1": 2, "4": 5 };
  battle.handleInput(["confirm"], inv);
  for (let i = 0; i < slot; i++) battle.handleInput(["down"], inv);
  battle.handleInput(["confirm"], inv);
  let fxPieces = 0,
    damage = "";
  for (let i = 0; i < 200 && battle.interactiveStage === "skillAction"; i++) {
    fxPieces = Math.max(fxPieces, battle.skillFxDraws.length);
    damage ||= battle.damage?.text ?? "";
    battle.tick();
  }
  return { fxPieces, damage, stage: battle.interactiveStage };
}

describe("a pet with Cầu Vồng and signature skills in the live fight", () => {
  it("lists them by name, plays the Cầu Vồng effect and lands the damage after it", () => {
    const { battle } = fight([70, 1000]);
    battle.handleInput(["confirm"], {});
    expect(battle.ui.rows.map((row) => row.name)).toEqual(
      expect.arrayContaining([expect.stringContaining("Mạn Độc Triền Sinh")]),
    );
    battle.handleInput(["back"], {});
    const enemyBefore = battle.hp("enemy"),
      shown = cast(battle, 0);
    expect(shown.fxPieces).toBeGreaterThan(0);
    expect(shown.damage).toMatch(/^-\d+$/);
    expect(battle.hp("enemy")).toBeLessThan(enemyBefore);
  });

  it("a signature skill plays its sprite events on caster and target, then lands the hit", () => {
    const { battle } = fight([1000, 70]);
    const enemyBefore = battle.hp("enemy"),
      player = battle.combatant("player").origin,
      enemy = battle.combatant("enemy").origin,
      seen = new Map<number, { x: number; y: number; mirror: boolean }>();
    battle.handleInput(["confirm"], {});
    battle.handleInput(["confirm"], {});
    let ticks = 0;
    for (; ticks < 200 && battle.interactiveStage === "skillAction"; ticks++) {
      expect(battle.skillFxDraws).toEqual([]);
      for (const placed of battle.signatureFxSprites) seen.set(placed.sprite, placed);
      battle.tick();
    }
    // PD-SIG-01-SCOUT: 300 and 266 over the caster (mirrored), 262 over the enemy, 47 ticks.
    expect(ticks).toBeGreaterThanOrEqual(47);
    expect(seen.get(300)).toEqual({ ...seen.get(300), x: player.x, y: player.y, mirror: true });
    expect(seen.get(266)).toEqual({ ...seen.get(266), x: player.x, y: player.y, mirror: true });
    expect(seen.get(262)).toEqual({ ...seen.get(262), x: enemy.x, y: enemy.y, mirror: false });
    expect(battle.hp("enemy")).toBeLessThan(enemyBefore);
  });

  it("a WALL signature plays over the caster, guards it and leaves the enemy untouched", () => {
    const { battle } = fight([1009, 70]);
    const enemyBefore = battle.hp("enemy"),
      player = battle.combatant("player").origin;
    battle.handleInput(["confirm"], {});
    battle.handleInput(["confirm"], {});
    let drawn = 0;
    for (let i = 0; i < 200 && battle.interactiveStage === "skillAction"; i++) {
      for (const placed of battle.signatureFxSprites) {
        expect([placed.x, placed.y, placed.mirror]).toEqual([player.x, player.y, true]);
        drawn++;
      }
      battle.tick();
    }
    expect(drawn).toBeGreaterThan(0);
    expect(battle.hp("enemy")).toBe(enemyBefore);
    expect(battle.statusStrip("player").length).toBeGreaterThan(0);
  });

  it("a PIVOT signature with no reserve still hits, and leaves no pivot standing", () => {
    const { battle } = fight([1029, 70]);
    const enemyBefore = battle.hp("enemy");
    cast(battle, 0);
    expect(battle.hp("enemy")).toBeLessThan(enemyBefore);
    const player = battle.statusUnit("player") as unknown as {
      signatureState: { pendingPivot: boolean };
    };
    // "không có dự bị: vẫn đánh nhưng không đổi/không tạo khiên".
    expect(player.signatureState.pendingPivot).toBe(false);
    expect(battle.shield("player")).toBe(0);
  });

  it("U Minh Triều / Tử Thần Xúc Ấn move the pet's real PP", () => {
    const { battle, pet } = fight([135, 70]);
    cast(battle, 0);
    expect(pet.skillPp).toEqual([0, 0]);
  });
});
