import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GameData } from "../../../data/GameData";
import type {
  GoldenBattleAiDecisionRecord,
  GoldenBattleAiRow,
  GoldenBattleAiTable,
  GoldenBattleUnit,
  PackDebuffProducer,
  PackSkillRow,
} from "../../../data/GameData";
import { Pack } from "../../../pack/Pack";
import type { BattleRules } from "../BattleRules";
import { loadBattleRules } from "../BattleRules";
import type { DesignTraitUnit } from "../DesignTraits";
import { BattleAiActorKey } from "./BattleAiActorKey";
import type { BattleAiActionCandidate } from "./BattleAiActionCandidate";
import {
  BattleAiCanaryDecisionAdapter,
  type BattleAiCanaryResult,
} from "./BattleAiCanaryDecisionAdapter";
import { BattleAiDecision } from "./BattleAiDecision";
import { BattleAiDecisionEngine, tierOfProfile } from "./BattleAiDecisionEngine";
import { BattleAiEncounterCatalog } from "./BattleAiEncounterCatalog";
import { BattleAiMemory } from "./BattleAiMemory";
import { type BattleAiObservation, type UnitView } from "./BattleAiObservation";
import {
  BattleAiObservationInput,
  type BattleAiItemEntry,
  type OwnedUnit,
} from "./BattleAiObservationFactory";
import { policyBiasSetToString } from "./BattleAiPolicyBias";
import type { BattleAiPolicyProjection } from "./BattleAiPolicyProjection";
import { BattleAiRulebook } from "./BattleAiRulebook";
import type { BattleAiItemOption } from "./BattleAiRulebook";
import { BattleAiShadowPlanner } from "./BattleAiShadowPlanner";
import { LiveBattleAiUnit, type BattleAiUnit } from "./BattleAiUnit";
import { RUNTIME_MODES, type BattleAiV2RuntimeMode } from "./BattleAiV2RuntimeSelector";
import { sha256Hex } from "./Sha256Hex";

const root = resolve(import.meta.dirname, "..", "..", "..", "..");

/** A catalog edit standing in for a mistake a port could make, cleared once the rig is loaded. */
let mutation: ((file: string, json: unknown) => unknown) | undefined;

vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(root, "public", decodeURIComponent(input.replace(/^\//, "")));
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const value = mutation && file.endsWith(".json") ? mutation(file, parsed) : parsed;
  return { ok: true, status: 200, json: async () => value };
});

/** `ProbeWebBattleMath.STATUS_SKILL_SCAN_LIMIT`: the id space the probe swept for producers. */
const SCAN_LIMIT = 800;

/** `BattleUnit.STAT_*`, the columns the probe slices out of the seven-wide stat row. */
const STAT_HP = 1;
const STAT_ATTACK = 2;
const STAT_DEFENSE = 3;
const STAT_SPEED = 4;

/**
 * `ProbeWebBattleMath.planDebuff(…, roll 0)`: the scripted plan always answers the debuff chance with
 * the row's own roll, so a producer below 100 percent still lands.
 */
const silent = () => 0;

function eq(found: string[], label: string, field: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    found.push(`${label} ${field} ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  }
}

/**
 * Walk the recorded answer and compare every key it carries.
 *
 * The golden block is the question: a field the port does not answer is a finding, an extra field it
 * invents is not graded here, and lists are compared element by element so one wrong candidate row
 * reports itself instead of hiding inside a serialised blob.
 */
function grade(found: string[], label: string, mine: unknown, row: unknown): void {
  if (Array.isArray(row)) {
    if (!Array.isArray(mine)) {
      found.push(`${label} is not a list`);
      return;
    }
    if (mine.length !== row.length) {
      found.push(`${label} length ${mine.length} != ${row.length}`);
      return;
    }
    row.forEach((each, index) => grade(found, `${label}[${index}]`, mine[index], each));
    return;
  }
  if (row !== null && typeof row === "object") {
    if (mine === null || typeof mine !== "object" || Array.isArray(mine)) {
      found.push(`${label} has no answer block`);
      return;
    }
    const answers = mine as Record<string, unknown>;
    for (const field of Object.keys(row)) {
      if (!(field in answers)) {
        found.push(`${label} has no answer for ${field}`);
        continue;
      }
      grade(found, `${label} ${field}`, answers[field], (row as Record<string, unknown>)[field]);
    }
    return;
  }
  eq(found, label, "value", mine, row);
}

/** One combatant the rig built, with the actor key the decision path names it by. */
type RigUnit = {
  readonly design: DesignTraitUnit;
  readonly live: BattleAiUnit;
  readonly key: BattleAiActorKey;
};

/** The projection answers, in the same shapes the probe printed them. */
function unitViewRecord(each: UnitView) {
  return {
    actorKey: each.actorKey.toString(),
    memberSlot: each.memberSlot,
    petKey: each.petKey,
    speciesId: each.speciesId,
    level: each.level,
    active: each.active,
    alive: each.alive,
    hp: each.hp,
    maxHp: each.maxHp,
    hpPercent: each.hpPercent,
    combatElementId: each.combatElementId,
    attack: each.attack,
    defense: each.defense,
    agility: each.agility,
    physicalTraitKey: each.physicalTraitKey,
    speciesTraitKey: each.speciesTraitKey,
    skills: each.skills.map((skill) => ({ ...skill })),
    statuses: each.statuses.map((status) => ({
      bank: status.bank,
      effectId: status.effectId,
      remainingActions: status.remainingActions,
      stacks: status.stacks,
      stableKey: status.stableKey(),
    })),
  };
}

/** `ProbeWebBattleMath.aiObservation`, the enum columns spelled the way Java's `toString()` spells them. */
function observationRecord(mine: BattleAiObservation) {
  return {
    profileVersion: mine.profileVersion,
    encounterKey: mine.encounterKey,
    turn: mine.turn,
    battleFormat: `BattleFormat.${mine.battleFormat}`,
    intelligenceProfile: `IntelligenceProfile.${mine.intelligenceProfile}`,
    personaKey: mine.personaKey,
    informationPolicy: `InformationPolicy.${mine.informationPolicy}`,
    phaseKey: mine.phaseKey,
    activeActor: mine.activeActor.toString(),
    turnsSinceNpcSwitch: mine.turnsSinceNpcSwitch,
    consecutiveNonDamageActions: mine.consecutiveNonDamageActions,
    ownRoster: mine.ownRoster.map(unitViewRecord),
    visibleOpponents: mine.visibleOpponents.map(unitViewRecord),
    itemLoadout: mine.itemLoadout.map((each) => ({ ...each })),
    memoryEvents: [...mine.memoryEvents],
  };
}

/** `ProbeWebBattleMath.aiCandidate`, with the rank the probe passed in. */
function candidateRecord(each: BattleAiActionCandidate, rank: number) {
  return {
    rank,
    actionKey: each.actionKey,
    type: each.type,
    legality: each.legality,
    actor: each.actor?.toString() ?? "",
    target: each.target === null ? "" : each.target.toString(),
    skillKey: each.skillKey,
    skillRuntimeId: each.skillRuntimeId,
    itemKey: each.itemKey,
    itemRuntimeId: each.itemRuntimeId,
    switchMemberSlot: each.switchMemberSlot,
    evaluated: each.evaluated,
    immediateValue: each.immediateValue,
    koAndSurvivalValue: each.koAndSurvivalValue,
    statusAndSetupValue: each.statusAndSetupValue,
    tempoValue: each.tempoValue,
    ppAndResourceValue: each.ppAndResourceValue,
    teamFutureValue: each.teamFutureValue,
    riskCost: each.riskCost,
    repetitionOrLoopCost: each.repetitionOrLoopCost,
    personaModifier: each.personaModifier,
    controlledJitter: each.controlledJitter,
    finalUtility: each.finalUtility,
    rationaleTokens: [...each.rationaleTokens],
  };
}

/** `ProbeWebBattleMath.aiPolicy`, with the bias set printed the way Java's `EnumSet` prints it. */
function policyRecord(mine: BattleAiPolicyProjection) {
  return {
    commissioned: mine.commissioned,
    encounterKey: mine.encounterKey,
    personaKey: mine.personaKey,
    phaseKey: mine.phaseKey,
    biases: [...mine.biases],
    biasesSetToString: policyBiasSetToString(mine.biases),
    personaPreferenceBonus: mine.personaPreferenceBonus,
    phasePreferenceBonus: mine.phasePreferenceBonus,
    modifiers: { ...mine.modifiers },
  };
}

/**
 * The 31 enemy decision points the Java runtime wrote, replayed through the port.
 *
 * `units`, `scenario`, `memoryScript` and `v1` are the inputs the probe handed the decision path;
 * `observation`, `policy`, `candidates`, `utility`, `invariant`, `canary` and `committed` are the
 * answers and are graded, including the SHA-256 shadow fingerprint.
 */
class Rig {
  private constructor(
    readonly rules: BattleRules,
    readonly rulebook: BattleAiRulebook,
    readonly catalog: BattleAiEncounterCatalog,
    readonly golden: GoldenBattleAiTable,
    private readonly skillRows: Map<number, PackSkillRow>,
    private readonly producers: PackDebuffProducer[],
    readonly mode: BattleAiV2RuntimeMode,
  ) {}

  /**
   * `VqsvBattleRuntime.battleAiItemOptions`: the lowest item id carrying each behavior 1..6.
   *
   * The scan is the runtime's own, so the loadout the bot may spend is graded against the table's
   * `itemOptions` instead of being re-derived here.
   */
  get itemOptions(): BattleAiItemOption[] {
    return (this.itemOptionsCache ??= this.rulebook.itemLoadoutOptions());
  }

  private itemOptionsCache?: BattleAiItemOption[];

  static async load(mutate?: (file: string, json: unknown) => unknown): Promise<Rig> {
    mutation = mutate;
    try {
      const data = new GameData(await Pack.load());
      const rules = await loadBattleRules(data);
      const [rulebook, catalog, golden, skills, debuffs] = await Promise.all([
        BattleAiRulebook.load(data),
        BattleAiEncounterCatalog.load(data),
        data.goldenBattleAi(),
        data.skillRows(),
        data.debuffProducers(),
      ]);
      return new Rig(
        rules,
        rulebook,
        catalog,
        golden,
        new Map(skills.rows.map((row) => [row.skillId, row])),
        debuffs.producers,
        RUNTIME_MODES[golden.runtimeMode as keyof typeof RUNTIME_MODES],
      );
    } finally {
      mutation = undefined;
    }
  }

  /** `ProbeWebBattleMath.producerSkillFor`: the lowest skill id that plants this debuff. */
  private seedSkillFor(debuffId: number): number | undefined {
    return this.producers
      .filter((row) => row.debuffId === debuffId && row.skillId < SCAN_LIMIT)
      .map((row) => row.skillId)
      .sort((a, b) => a - b)[0];
  }

  /** `ProbeWebBattleMath.seedDebuff`: one debuff on the target through the engine's producer path. */
  private seedDebuff(attacker: DesignTraitUnit, target: DesignTraitUnit, debuffId: number): void {
    const skillId = this.seedSkillFor(debuffId);
    const row = skillId === undefined ? undefined : this.skillRows.get(skillId);
    if (skillId === undefined || row === undefined) {
      throw new Error(`no producer skill plants debuff ${debuffId}`);
    }
    const pending = this.rules.status.planTargetDebuff(
      attacker,
      target,
      skillId,
      row.effectId,
      silent,
    );
    if (!pending || !pending.appliesStatus()) {
      throw new Error(`debuff ${debuffId} is not plantable through skill ${skillId}`);
    }
    pending.commit();
  }

  /** `ProbeWebBattleMath.aiSkillKey`. */
  private skillKeyOf(runtimeId: number): string {
    const record = this.rulebook.unifiedSkill(runtimeId);
    if (record === undefined) throw new Error(`no active Skill for runtime id ${runtimeId}`);
    return record.stableKey;
  }

  /** `ProbeWebBattleMath.aiItemKey`, over the loadout options the table declared. */
  private itemKeyOf(runtimeId: number): string {
    return this.golden.itemOptions.find((each) => each.itemId === runtimeId)?.itemKey ?? "";
  }

  /** `ProbeWebBattleMath.aiActorKey`: the bare member name, or nothing for an untargeted command. */
  private actorKeyOf(text: string): BattleAiActorKey | null {
    if (text === "") return null;
    if (text.startsWith("NPC-M")) return BattleAiActorKey.of("NPC", text);
    if (text.startsWith("PLAYER-M")) return BattleAiActorKey.of("PLAYER", text);
    throw new Error(`unknown AI actor key ${text}`);
  }

  /**
   * One combatant, from the row's own configured state.
   *
   * `formationSlot` is `-1` because that is what Java leaves it at: `enemyFromEncounter` and the
   * starter adapter never write the column, so every unit in the probe's roster carries the default.
   * The recorded `baseStats` are already the permanent trait stats, so the rig never re-applies them.
   */
  private unit(record: GoldenBattleUnit, key: BattleAiActorKey, side: number): RigUnit {
    const design = this.rules.traits.unit({
      speciesId: record.speciesId,
      ownerSide: side,
      formationSlot: -1,
      base: {
        hp: record.baseStats[STAT_HP],
        attack: record.baseStats[STAT_ATTACK],
        defense: record.baseStats[STAT_DEFENSE],
        speed: record.baseStats[STAT_SPEED],
      },
      skillIds: record.skillIds,
      skillPp: record.skillPp,
      physicalTraitId: record.physicalTraitId,
    });
    design.speciesTraitId = record.speciesTraitId;
    design.characteristicTraitId = record.characteristicTraitId;
    design.restoreStatsForCheck();
    return {
      design,
      live: new LiveBattleAiUnit(design, record.level, this.rules.status, this.rulebook),
      key,
    };
  }

  /**
   * `ProbeWebBattleMath`'s v1 stage: the real engine run over the row's own input, plus its answer.
   *
   * The probe built the Java `Input` from four things this rig already has — the active enemy as both
   * the actor and the sole ally, the player as the sole opponent, the whole party as the reserves
   * (including the active member, because Java passes the array it was given), and the descriptor's
   * own profile — and pinned the roller so every skill draw lands in the middle of its band, which
   * makes the v1 jitter exactly zero, while the switch draw is scripted per row.
   *
   * `draws` is graded before the decision because it is the stricter answer: a port that scores a
   * different set of skills logs a different list even when it happens to pick the same move, and a
   * port that reaches the switch roll its Java baseline never reached logs a draw out of nowhere.
   */
  private runV1(
    row: GoldenBattleAiRow,
    found: string[],
    active: RigUnit,
    player: RigUnit,
    party: RigUnit[],
  ): BattleAiDecision {
    const at = `${row.name} v1`;
    const scenario = row.scenario;
    const profile = this.catalog.profileForDescriptor(row.descriptor);
    if (profile === undefined) {
      found.push(`${at}: descriptor ${row.descriptor} has no v1 profile`);
      return BattleAiDecision.none("no-profile");
    }
    eq(found, at, "tier", tierOfProfile(profile), row.v1.tier);
    eq(found, at, "itemBudget", profile.itemBudget, scenario.itemBudget);
    eq(
      found,
      at,
      "turnsSinceSwitch",
      Math.max(0, scenario.turn - scenario.lastTacticalSwitchTurn),
      row.v1.turnsSinceSwitch,
    );

    const draws: string[] = [];
    const decision = new BattleAiDecisionEngine(this.rulebook).decide({
      actor: active.live,
      allies: [active.live],
      opponents: [player.live],
      reserves: party.map((member) => member.live),
      profile,
      itemOptions: this.itemOptions,
      // The probe resolved this itself: a negative scenario column means "the profile's whole budget".
      itemBudgetRemaining: scenario.itemBudgetRemaining,
      lastSkillId: scenario.lastSkillSlot < 0 ? -1 : active.live.skillAt(scenario.lastSkillSlot),
      repeatedUses: scenario.repeatedUses,
      turn: scenario.turn,
      turnsSinceSwitch: scenario.turn - scenario.lastTacticalSwitchTurn,
      roller: {
        nextInt: (label, bound) => {
          const value = label.startsWith("switch")
            ? Math.max(0, Math.min(bound - 1, scenario.switchRoll))
            : Math.trunc(bound / 2);
          draws.push(`${label}=${value}`);
          return value;
        },
      },
    });
    eq(found, at, "draws", draws, row.v1.draws);
    return decision;
  }

  /** The replay of one row, in the order `VqsvBattleRuntime.selectEnemyAiDecision` runs it. */
  replay(row: GoldenBattleAiRow): string[] {
    const found: string[] = [];
    const label = row.name;
    const shipped = this.catalog.encounterForDescriptor(
      row.identity.sceneId,
      row.identity.roomIndex,
      row.identity.groupIndex,
      row.identity.sourceActorId,
      row.identity.op37Encounter,
    );
    if (shipped === undefined) {
      return [`${label}: descriptor has no AI-v2 encounter identity`];
    }
    found.push(...gradeBlock(`${label} encounter`, shipped.encounter, row.encounter));
    const spec = this.catalog.spec(shipped.encounter.encounterKey)!;
    if (spec.battleFormat === "SIMULTANEOUS_2V2") {
      found.push(`${label}: the 1v1 table routed a 2v2 encounter`);
      return found;
    }

    // ------------------------------------------------------------------ the two sides
    const player = this.unit(row.units.player, BattleAiActorKey.playerMember(1), 0);
    const party = row.units.enemyParty.map((record, index) =>
      this.unit(record, BattleAiActorKey.npcMember(index + 1), 1),
    );
    for (const slot of row.scenario.deadMemberSlots) party[slot - 1].design.setHp(0);
    const activeIndex = row.scenario.activeMemberSlot - 1;
    const active = party[activeIndex];
    if (row.scenario.enemyHpPercent < 100) {
      active.design.setHp(
        Math.max(1, Math.trunc((active.design.maxHp() * row.scenario.enemyHpPercent) / 100)),
      );
    }
    party.forEach((member, index) => {
      if (
        index === activeIndex ||
        member.design.hp() === 0 ||
        row.scenario.reserveHpPercent === 100
      ) {
        return;
      }
      member.design.setHp(
        Math.max(1, Math.trunc((member.design.maxHp() * row.scenario.reserveHpPercent) / 100)),
      );
    });
    if (row.scenario.playerHpPercent < 100) {
      player.design.setHp(
        Math.max(1, Math.trunc((player.design.maxHp() * row.scenario.playerHpPercent) / 100)),
      );
    }
    if (row.scenario.enemyControlDebuffId >= 0) {
      this.seedDebuff(player.design, active.design, row.scenario.enemyControlDebuffId);
    }
    for (const buffId of row.scenario.enemyBuffIds) {
      this.rules.status.applySourceBuff(active.design, buffId, 0);
    }
    for (const buffId of row.scenario.playerBuffIds) {
      this.rules.status.applySourceBuff(player.design, buffId, 0);
    }
    if (row.scenario.zeroAllPp) {
      for (let slot = 0; slot < active.design.skillPp.length; slot++) {
        active.design.skillPp[slot] = 0;
      }
    } else if (row.scenario.zeroPpSlot >= 0) {
      active.design.skillPp[row.scenario.zeroPpSlot] = 0;
    }

    // ------------------------------------------------------------------ the units block
    const gradeUnit = (each: RigUnit, record: GoldenBattleUnit, name: string) => {
      const at = `${label} unit ${name}`;
      const stats = each.design.currentStats;
      eq(found, at, "speciesId", each.design.speciesId, record.speciesId);
      eq(found, at, "level", record.level, each.live.level);
      eq(found, at, "physicalTraitId", each.design.physicalTraitId, record.physicalTraitId);
      eq(found, at, "speciesTraitId", each.design.speciesTraitId, record.speciesTraitId);
      eq(
        found,
        at,
        "characteristicTraitId",
        each.design.characteristicTraitId,
        record.characteristicTraitId,
      );
      eq(found, at, "hp", each.design.hp(), record.hp);
      eq(found, at, "maxHp", each.design.maxHp(), record.maxHp);
      eq(found, at, "base hp", record.baseStats[STAT_HP], each.design.baseStats.hp);
      eq(found, at, "base attack", record.baseStats[STAT_ATTACK], each.design.baseStats.attack);
      eq(found, at, "base defense", record.baseStats[STAT_DEFENSE], each.design.baseStats.defense);
      eq(found, at, "base speed", record.baseStats[STAT_SPEED], each.design.baseStats.speed);
      eq(found, at, "attack", stats.attack, record.currentStats[STAT_ATTACK]);
      eq(found, at, "defense", stats.defense, record.currentStats[STAT_DEFENSE]);
      eq(found, at, "speed", stats.speed, record.currentStats[STAT_SPEED]);
      eq(found, at, "skillIds", each.design.skillIds, record.skillIds);
      eq(found, at, "skillPp", each.design.skillPp, record.skillPp);
    };
    gradeUnit(player, row.units.player, "player");
    party.forEach((member, index) =>
      gradeUnit(member, row.units.enemyParty[index], `enemy${index + 1}`),
    );
    eq(
      found,
      `${label} aliveMembers`,
      "value",
      party.map((member) => (member.design.alive() ? 1 : 0)),
      row.units.aliveMembers,
    );

    // ------------------------------------------------------------------ the scripted memory
    const turn = Math.max(1, row.scenario.turn);
    const loadout = this.catalog.items(spec.encounterKey);
    const memory = new BattleAiMemory(spec.memoryHorizon);
    const stored: string[] = [];
    row.memoryScript.forEach((event, index) => {
      const at = `${label} memory[${index}]`;
      const value = this.resolveToken(event.token, active, player, loadout);
      eq(found, at, "value", value, event.value);
      const actor = this.actorKeyOf(event.actor);
      const target = this.actorKeyOf(event.target);
      const before = memory.eventCount(event.turn);
      switch (event.kind) {
        case "SKILL":
          memory.observeSkill(event.turn, actor!, value, event.numeric === 1);
          break;
        case "TRAIT":
          memory.observeTrait(event.turn, actor!, value);
          break;
        case "DAMAGE":
          memory.observeDamage(event.turn, actor!, target!, event.numeric);
          break;
        case "STATUS":
          memory.observeStatus(event.turn, actor!, target, value);
          break;
        case "SWITCH":
          memory.observeSwitch(event.turn, actor, target!);
          break;
        case "KNOCKOUT":
          memory.observeKnockout(event.turn, target!);
          break;
        case "ITEM":
          memory.observeItem(event.turn, actor!, value);
          break;
        default:
          found.push(`${at} unknown kind ${event.kind}`);
      }
      const after = memory.events(event.turn);
      stored.push(after.length > before ? after[after.length - 1].canonical() : "");
      eq(found, at, "storedAs", stored[index], event.storedAs);
    });
    // What survived on its own, measured before the planner is allowed to add a phase line.
    const survived = new Set(memory.events(turn).map((event) => event.canonical()));
    let scriptedVisible = 0;
    row.memoryScript.forEach((event, index) => {
      const visible = survived.has(stored[index]);
      eq(found, `${label} memory[${index}]`, "visible", visible, event.visible);
      if (visible) scriptedVisible++;
    });
    eq(
      found,
      `${label} memoryCounts`,
      "value",
      {
        scripted: row.memoryScript.length,
        scriptedVisible,
        survivedPruning: survived.size,
        horizonTurns: spec.memoryHorizon,
      },
      row.memoryCounts,
    );

    // ------------------------------------------------------------------ the decision path
    const keys = new Map<BattleAiUnit, BattleAiActorKey>();
    for (const member of party) keys.set(member.live, member.key);
    keys.set(player.live, player.key);
    const ownRoster: OwnedUnit[] = party.map((member, index) => ({
      actorKey: member.key,
      memberSlot: index + 1,
      unit: member.live,
      active: index === activeIndex,
    }));
    const input = new BattleAiObservationInput(
      spec,
      row.scenario.turn,
      active.key,
      ownRoster,
      [{ actorKey: player.key, unit: player.live }],
      memory,
      loadout,
    );
    const production = this.runV1(row, found, active, player, party);
    const productionKey = this.actionKeyOf(production, keys, player, active, party.length);
    eq(found, `${label} v1`, "productionActionKey", productionKey, row.v1.productionActionKey);
    eq(found, `${label} v1`, "decision", this.recordOf(production, keys), row.v1.decision);

    const shadow = new BattleAiShadowPlanner(this.rulebook, this.catalog).inspect(
      input,
      production,
      productionKey,
      row.scenario.decisionSeed,
    );
    found.push(
      ...gradeBlock(`${label} observation`, observationRecord(shadow.observation), row.observation),
    );
    found.push(...gradeBlock(`${label} policy`, policyRecord(shadow.policy), row.policy));
    found.push(
      ...gradeBlock(
        `${label} candidates`,
        shadow.candidates.map((each, index) => candidateRecord(each, index)),
        row.candidates,
      ),
    );
    found.push(
      ...gradeBlock(
        `${label} utility`,
        {
          selectedCandidateKey: shadow.selectedCandidateKey,
          fingerprint: shadow.fingerprint,
          traceLine: shadow.traceLine(),
        },
        row.utility,
      ),
    );

    const canary = this.mode.gameplayCommitEnabled
      ? new BattleAiCanaryDecisionAdapter(this.catalog).project(
          this.mode,
          input,
          shadow,
          production,
        )
      : null;
    found.push(
      ...gradeBlock(
        `${label} invariant`,
        {
          shadowControlsGameplay: shadow.controlsGameplay,
          decisionForCommitIsProduction: shadow.decisionForCommit() === production,
          canaryRan: canary !== null,
        },
        row.invariant,
      ),
    );
    found.push(
      ...gradeBlock(
        `${label} canary`,
        this.canaryRecord(canary, production, keys, spec.encounterKey),
        row.canary,
      ),
    );
    const committed = canary === null ? production : canary.decision;
    found.push(
      ...gradeBlock(
        `${label} committed`,
        {
          decision: this.recordOf(committed, keys),
          actionKey: this.actionKeyOf(committed, keys, player, active, party.length),
          fromV2: canary !== null && canary.controlsGameplay,
        },
        row.committed,
      ),
    );
    return found;
  }

  /** `ProbeWebBattleMath.aiResolveToken`: the scripted event's own value, read off this row. */
  private resolveToken(
    token: string,
    active: RigUnit,
    player: RigUnit,
    loadout: BattleAiItemEntry[],
  ): string {
    if (!token.startsWith("@")) return token;
    if (token === "@activePhysicalTrait") {
      return this.rulebook.physicalTraitKey(active.design.physicalTraitId);
    }
    if (token === "@playerPhysicalTrait") {
      return this.rulebook.physicalTraitKey(player.design.physicalTraitId);
    }
    const open = token.indexOf("[");
    const close = token.indexOf("]");
    const base = token.slice(1, open);
    const index = Number.parseInt(token.slice(open + 1, close), 10);
    if (base === "item") return loadout[index].itemKey;
    const owner = base === "activeSkill" ? active : player;
    const runtimeId = owner.design.skillIds[index] ?? -1;
    if (runtimeId < 0) throw new Error(`${token} is not an authored skill slot`);
    return this.skillKeyOf(runtimeId);
  }

  /** `ProbeWebBattleMath.aiDecision`: the decision as the probe prints it. */
  private recordOf(
    decision: BattleAiDecision,
    keys: Map<BattleAiUnit, BattleAiActorKey>,
  ): GoldenBattleAiDecisionRecord {
    return {
      type: decision.type,
      skillId: decision.skillId,
      skillKey: decision.skillId < 0 ? "" : this.skillKeyOf(decision.skillId),
      itemId: decision.itemId,
      itemKey: decision.itemId < 0 ? "" : this.itemKeyOf(decision.itemId),
      switchIndex: decision.switchIndex,
      target: decision.target === null ? "" : (keys.get(decision.target)?.toString() ?? ""),
      score: decision.score,
      rationale: decision.rationale,
    };
  }

  /** `ProbeWebBattleMath.aiProductionActionKey`: the string the runtime hands the planner. */
  private actionKeyOf(
    decision: BattleAiDecision,
    keys: Map<BattleAiUnit, BattleAiActorKey>,
    player: RigUnit,
    active: RigUnit,
    partyLength: number,
  ): string {
    const actorText = (unit: BattleAiUnit | null, fallback: RigUnit) =>
      unit === null ? fallback.key.toString() : (keys.get(unit)?.toString() ?? "");
    switch (decision.type) {
      case "SKILL":
        return `SKILL:${this.skillKeyOf(decision.skillId)}:${actorText(decision.target, player)}`;
      case "ITEM": {
        const itemKey = this.itemKeyOf(decision.itemId);
        if (itemKey === "") return "";
        return `ITEM:${itemKey}:${actorText(decision.target, active)}`;
      }
      case "SWITCH":
        if (decision.switchIndex < 0 || decision.switchIndex >= partyLength) return "";
        return `SWITCH:${BattleAiActorKey.npcMember(decision.switchIndex + 1).toString()}`;
      default:
        return "";
    }
  }

  /** `ProbeWebBattleMath.aiRow`'s canary block, including the mode-does-not-commit shape. */
  private canaryRecord(
    canary: BattleAiCanaryResult | null,
    production: BattleAiDecision,
    keys: Map<BattleAiUnit, BattleAiActorKey>,
    encounterKey: string,
  ) {
    if (canary === null) {
      return {
        ran: false,
        reason: "mode-does-not-commit",
        decision: this.recordOf(production, keys),
      };
    }
    return {
      ran: true,
      controlsGameplay: canary.controlsGameplay,
      fallback: canary.fallback,
      selectedCandidateKey: canary.selectedCandidateKey,
      reason: canary.reason,
      decision: this.recordOf(canary.decision, keys),
      traceLine: canary.traceLine(encounterKey),
    };
  }
}

function gradeBlock(label: string, mine: unknown, row: unknown): string[] {
  const found: string[] = [];
  grade(found, label, mine, row);
  return found;
}

/** The number of disagreements each deliberate catalog mistake produces, measured from a real run. */
const MUTATION_COUNTS = {
  wrongImmediateWeight: 36,
  wrongPersonaBonus: 229,
  wrongItemQuantity: 82,
  wrongMemoryHorizon: 145,
  wrongRandomness: 22,
  wrongHealingThreshold: 10,
};

describe("battle AI v2 golden decisions", () => {
  it("digests the fingerprint material the way MessageDigest does", () => {
    // FIPS 180-4 vectors plus the two-block boundary the material strings cross. A corrupted round
    // constant is invisible everywhere else in this suite: only the golden fingerprint reads it.
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
    expect(sha256Hex("a".repeat(56))).toBe(
      "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a",
    );
    expect(sha256Hex("x".repeat(200))).toBe(
      "aa20c23e3201834050679e1d88941b9a6fed0557c9a705cb2c315e2e63fd486d",
    );
  });

  it("replays every decision point the Java runtime wrote", async () => {
    const rig = await Rig.load();
    expect(rig.golden.shadowEnabled).toBe(true);
    expect(rig.golden.rows.length).toBe(31);
    const found: string[] = [];
    for (const row of rig.golden.rows) found.push(...rig.replay(row));
    expect(found.slice(0, 25)).toEqual([]);
  });

  it("scans the item loadout the Java runtime hands the bot", async () => {
    // `VqsvBattleRuntime.battleAiItemOptions` keeps the lowest item id carrying each behavior 1..6,
    // so the rescue the bot can attempt is a catalog answer, not a choice the port makes.
    const rig = await Rig.load();
    expect(rig.itemOptions).toEqual(
      rig.golden.itemOptions.map((each) => ({
        itemId: each.itemId,
        behavior: each.behavior,
        itemKey: each.itemKey,
      })),
    );
  });

  it("has teeth: a wrong catalog entry disagrees with the golden decisions", async () => {
    const cases: [
      string,
      (file: string, json: unknown) => unknown,
      keyof typeof MUTATION_COUNTS,
    ][] = [
      [
        "immediate weight",
        (file, json) => {
          if (!file.endsWith("ai-v2-catalog.json")) return json;
          const catalog = json as { profileWeights: Record<string, { immediatePercent: number }> };
          catalog.profileWeights.INSTINCT.immediatePercent += 20;
          return json;
        },
        "wrongImmediateWeight",
      ],
      [
        "persona bonus",
        (file, json) => {
          if (!file.endsWith("ai-v2-catalog.json")) return json;
          const catalog = json as {
            encounters: { projections: Record<string, { personaPreferenceBonus: number }> }[];
          };
          for (const row of catalog.encounters) row.projections.NONE.personaPreferenceBonus += 5;
          return json;
        },
        "wrongPersonaBonus",
      ],
      [
        "loadout quantity",
        (file, json) => {
          if (!file.endsWith("ai-v2-catalog.json")) return json;
          const catalog = json as { encounters: { items: { quantity: number }[] }[] };
          for (const row of catalog.encounters) {
            for (const item of row.items) item.quantity = 0;
          }
          return json;
        },
        "wrongItemQuantity",
      ],
      [
        "memory horizon",
        (file, json) => {
          if (!file.endsWith("ai-v2-catalog.json")) return json;
          const catalog = json as { encounters: { encounter: { memoryHorizon: number } }[] };
          for (const row of catalog.encounters) row.encounter.memoryHorizon = -1;
          return json;
        },
        "wrongMemoryHorizon",
      ],
      // The two v1-only mistakes, each aimed at a part of the engine the v2 shadow cannot see. The
      // profiles live inside the runtime descriptors, so a wrong band is a wrong draw log even when
      // the pinned mid-band draw still scores zero jitter — the draws column is what catches it.
      [
        "v1 randomness band",
        (file, json) => {
          if (!file.endsWith("event-descriptors.json")) return json;
          const events = json as Record<string, { aiProfile: { randomness: number } }>;
          for (const event of Object.values(events)) event.aiProfile.randomness += 1;
          return json;
        },
        "wrongRandomness",
      ],
      [
        "v1 healing threshold",
        (file, json) => {
          if (!file.endsWith("event-descriptors.json")) return json;
          const events = json as Record<string, { aiProfile: { healingThresholdPercent: number } }>;
          for (const event of Object.values(events)) event.aiProfile.healingThresholdPercent = 100;
          return json;
        },
        "wrongHealingThreshold",
      ],
    ];

    const counts: Record<string, number> = {};
    for (const [name, mutate, key] of cases) {
      const rig = await Rig.load(mutate);
      const found: string[] = [];
      for (const row of rig.golden.rows) found.push(...rig.replay(row));
      counts[key] = found.length;
      expect(`${name}: ${found.length > 0 ? "caught" : "invisible"}`).toBe(`${name}: caught`);
    }
    expect(counts).toEqual(MUTATION_COUNTS);
  });
});
