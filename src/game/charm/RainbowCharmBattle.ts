import type { DesignTraitUnit } from "../battle/DesignTraits";
import type { StatusUnit } from "../battle/StatusState";
import {
  CHARM_SLOTS,
  charmValue,
  clampTier,
  REVIVE_HP_PERCENT,
  type CharmDefinition,
  type CharmMechanic,
  type CharmSlot,
  type RainbowCharmCatalog,
} from "./RainbowCharms";

/**
 * One side's charms for one fight, ported from JavaSE `RainbowCharmBattleState`: an immutable
 * snapshot of the three equipped charms plus the per-battle counters (the emergency heal and the
 * revive fire once, the capture bonus accumulates). Every chance is rolled by the caller, which owns
 * the fight's random stream, and handed in as `roll` (`passes(roll, chance)`: roll < chance).
 */
export type CharmLoadoutEntry = { charm: CharmDefinition; tier: number };
/** A side's equipped charms as the fight sees them (slot order). */
export type CharmLoadout = readonly CharmLoadoutEntry[];

const passes = (roll: number, chance: number) =>
  roll >= 0 && roll < Math.max(0, Math.min(100, chance));

/** `RainbowCharmBattleState(state)`'s snapshot: each slot's charm with its tier, if owned. */
export function charmLoadout(
  catalog: RainbowCharmCatalog,
  state: { tiers: Record<string, number>; active: Record<CharmSlot, number> },
): CharmLoadout {
  const loadout: CharmLoadoutEntry[] = [];
  for (const slot of CHARM_SLOTS) {
    const id = state.active[slot],
      charm = catalog.byRuntimeId(id),
      tier = state.tiers[String(id)] ?? 0;
    if (charm && charm.slot === slot && tier > 0) loadout.push({ charm, tier: clampTier(tier) });
  }
  return loadout;
}

export class RainbowCharmBattleState {
  private emergencyHealUsed = false;
  private reviveUsed = false;
  private captureFailureBonus = 0;
  private readonly entryApplied = new Set<StatusUnit>();
  private readonly npcReviveAttempts = new Set<StatusUnit>();

  constructor(
    private readonly catalog: RainbowCharmCatalog,
    readonly loadout: CharmLoadout,
    /** 0 the player's charms, 1 an NPC's. */
    readonly ownerSide: 0 | 1,
  ) {}

  /** `mechanic`: the equipped charm with this mechanic (survival, tactical, exploration order). */
  private active(mechanic: CharmMechanic): CharmLoadoutEntry | undefined {
    return this.loadout.find((entry) => entry.charm.mechanic === mechanic);
  }
  private value(entry: CharmLoadoutEntry): number {
    return charmValue(entry.charm, entry.tier);
  }
  hasMechanic(mechanic: CharmMechanic): boolean {
    return this.active(mechanic) !== undefined;
  }
  /** `activeId` / `activeTier` for the HUD. */
  slot(slot: CharmSlot): CharmLoadoutEntry | undefined {
    return this.loadout.find((entry) => entry.charm.slot === slot);
  }
  /** `matches`: the unit is this side's, and of the charm's species when it names one. */
  private matches(entry: CharmLoadoutEntry | undefined, unit: StatusUnit | undefined): boolean {
    if (!entry || !unit || unit.ownerSide !== this.ownerSide) return false;
    return (
      entry.charm.species < 0 || this.catalog.petSpecies(unit.speciesId) === entry.charm.species
    );
  }

  /** `guaranteesWildEscape`. */
  guaranteesWildEscape(roll: number): boolean {
    const entry = this.active("ESCAPE_RETRY");
    return !!entry && passes(roll, this.value(entry));
  }
  /** `recordCaptureFailureBonus`: a missed ball adds the charm's points, capped at 100. */
  recordCaptureFailureBonus(): number {
    const entry = this.active("PREVENT_CAPTURE_FLEE");
    if (!entry) return 0;
    const before = this.captureFailureBonus;
    this.captureFailureBonus = Math.min(100, this.captureFailureBonus + this.value(entry));
    return this.captureFailureBonus - before;
  }
  captureFailureBonusPoints(): number {
    return this.captureFailureBonus;
  }

  /**
   * `applyUnitModifiers`, once per unit of this side: Thép thiết cốt's defense, Nọc độc công kích's
   * Hủ Thực bonus and Răng nanh răng nhọn's paralysis extension, each only on a matching species.
   */
  applyUnitModifiers(unit: StatusUnit, random: (label: string) => number): void {
    if (unit.ownerSide !== this.ownerSide || this.entryApplied.has(unit)) return;
    this.entryApplied.add(unit);
    const defense = this.active("METAL_DEFENSE");
    unit.setRainbowCharmDefenseBonus(this.matches(defense, unit) ? this.value(defense!) : 0);
    unit.restoreSourceStatusState();
    const corrosion = this.active("CORROSION_POWER");
    unit.setRainbowCharmCorrosionBonus(this.matches(corrosion, unit) ? this.value(corrosion!) : 0);
    const paralysis = this.active("PARALYSIS_DURATION"),
      matches = this.matches(paralysis, unit);
    unit.setRainbowCharmParalysisExtension(
      matches ? this.value(paralysis!) : 0,
      matches ? (paralysis!.tier >= 3 ? 2 : 1) : 0,
    );
    unit.charmRandom = (label) => random(`battle.${label}`);
  }

  /** `tryEmergencyHeal`: once a fight, a pet of this side under half HP heals the charm's percent. */
  tryEmergencyHeal(unit: StatusUnit): number {
    if (unit.ownerSide === this.ownerSide && unit.alive()) this.npcReviveAttempts.delete(unit);
    const entry = this.active("EMERGENCY_HEAL");
    if (
      !entry ||
      this.emergencyHealUsed ||
      unit.ownerSide !== this.ownerSide ||
      !unit.alive() ||
      unit.hp() * 100 >= unit.maxHp() * 50
    )
      return 0;
    this.emergencyHealUsed = true;
    const before = unit.hp();
    unit.heal(Math.max(1, Math.trunc((unit.maxHp() * this.value(entry)) / 100)));
    return unit.hp() - before;
  }

  /** `tryRevive`: once a fight, a fallen pet of this side comes back on the charm's chance. */
  tryRevive(unit: StatusUnit, roll: number): number {
    const entry = this.active("BATTLE_REVIVE");
    if (!entry || this.reviveUsed || unit.ownerSide !== this.ownerSide || unit.alive()) return 0;
    // Several KO gates may see the same NPC death; it still gets one roll.
    if (this.ownerSide === 1) {
      if (this.npcReviveAttempts.has(unit)) return 0;
      this.npcReviveAttempts.add(unit);
    }
    if (!passes(roll, this.value(entry))) return 0;
    this.reviveUsed = true;
    const hp = Math.max(1, Math.trunc((unit.maxHp() * REVIVE_HP_PERCENT[entry.tier]) / 100));
    unit.setHp(hp);
    return hp;
  }

  /** `tryEvade`: a blow at this side's pet misses on the charm's chance, unless it is a sure hit. */
  tryEvade(defender: StatusUnit, sureHit: boolean, roll: number): boolean {
    const entry = this.active("EVASION");
    return (
      !!entry &&
      defender.ownerSide === this.ownerSide &&
      !sureHit &&
      passes(roll, this.value(entry))
    );
  }

  /**
   * `trySeal`: on the charm's chance the enemy's first three skill slots close for two rounds. An
   * NPC's seal spares the player's last usable skill: it closes at most known - 1 slots, and fewer
   * until a usable skill stays open behind them.
   */
  trySeal(
    enemy: DesignTraitUnit,
    roll: number,
    usable: (unit: DesignTraitUnit, slot: number) => boolean,
  ): boolean {
    const entry = this.active("SKILL_SEAL");
    if (!entry || enemy.ownerSide === this.ownerSide || !passes(roll, this.value(entry)))
      return false;
    let sealed = 3;
    if (this.ownerSide === 1) {
      const known = enemy.skillIds.filter((skill) => skill >= 0).length;
      sealed = Math.min(3, Math.max(0, known - 1));
      while (sealed > 0) {
        let open = false;
        for (let slot = sealed; slot < enemy.skillIds.length; slot++)
          if (enemy.skillIds[slot] >= 0 && enemy.skillPp[slot] > 0 && usable(enemy, slot))
            open = true;
        if (open) break;
        sealed--;
      }
      if (sealed === 0) return false;
    }
    enemy.sealRainbowCharmSkills(sealed, 2, this.ownerSide);
    return true;
  }

  /**
   * `afterSkillPp`: after this side's skill, Tinh thần công kích may take one more PP from the
   * target's chosen skill and Triều tịch năng lượng may hand one back to the user's.
   */
  afterSkillPp(
    source: DesignTraitUnit,
    target: DesignTraitUnit,
    usedSkillId: number,
    drainRoll: number,
    refundRoll: number,
    ppMax: (skillId: number) => number,
  ): boolean {
    let changed = false;
    const drain = this.active("ENEMY_PP_DRAIN");
    if (drain && this.matches(drain, source) && passes(drainRoll, this.value(drain)))
      changed = drainSelectedSkillPp(target, 1) || changed;
    const refund = this.active("SELF_PP_REFUND");
    if (refund && this.matches(refund, source) && passes(refundRoll, this.value(refund))) {
      const slot = source.skillIds.indexOf(usedSkillId);
      if (slot >= 0) {
        const before = source.skillPp[slot];
        source.skillPp[slot] = Math.min(ppMax(usedSkillId), Math.max(0, before) + 1);
        changed = source.skillPp[slot] > before || changed;
      }
    }
    return changed;
  }
}

/** `BattleUnit.drainSelectedSkillPp`: the chosen skill's slot, else the first with PP left. */
function drainSelectedSkillPp(unit: DesignTraitUnit, amount: number): boolean {
  let slot = unit.skillIds.indexOf(unit.selectedSkillId);
  if (slot < 0) slot = unit.skillIds.findIndex((id, index) => id >= 0 && unit.skillPp[index] > 0);
  if (slot < 0 || unit.skillPp[slot] <= 0) return false;
  unit.skillPp[slot] = Math.max(0, unit.skillPp[slot] - Math.max(0, amount));
  return true;
}

// ------------------------------------------------------------------ CauVongNpcCharms

/** `CauVongNpcCharms.GENERIC` / `SPECIES` (the species set by `PetSpecies.runtimeId`). */
const NPC_GENERIC = [5039, 5037, 5047, 5057] as const,
  NPC_SPECIES = [5040, 5042, 5043, 5041, 5044] as const;

/**
 * `CauVongNpcCharms.choose`: a team with one species in the strict majority (and at least two of
 * it) carries that species' charm; any other team draws one of the four generic charms.
 */
export function chooseNpcCharm(
  catalog: RainbowCharmCatalog,
  speciesIds: readonly number[],
  random: (bound: number) => number,
): number {
  const counts = new Array<number>(NPC_SPECIES.length).fill(0);
  for (const id of speciesIds) {
    const species = catalog.petSpecies(id);
    if (species >= 0 && species < counts.length) counts[species]++;
  }
  let best = -1,
    count = 1,
    tied = false;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > count) {
      best = i;
      count = counts[i];
      tied = false;
    } else if (best >= 0 && counts[i] === count) tied = true;
  }
  if (best >= 0 && !tied) return NPC_SPECIES[best];
  const pick = random(NPC_GENERIC.length);
  return NPC_GENERIC[((pick % NPC_GENERIC.length) + NPC_GENERIC.length) % NPC_GENERIC.length];
}

/**
 * `CauVongNpcCharms.create`: a Cầu Vồng trainer (scene 98, trainer-owned, not PvP) fights with one
 * charm at tier IV or V. Returns the loadout, or null for any other fight.
 */
export function npcCharmLoadout(
  catalog: RainbowCharmCatalog,
  context: { sceneId: number; trainerOwned: boolean; pvp: boolean },
  speciesIds: readonly number[],
  random: (bound: number) => number,
): CharmLoadout | null {
  if (context.sceneId !== 98 || context.pvp || !context.trainerOwned || speciesIds.length === 0)
    return null;
  const id = chooseNpcCharm(catalog, speciesIds, random),
    tier = 4 + (((random(2) % 2) + 2) % 2),
    charm = catalog.byRuntimeId(id);
  return charm ? [{ charm, tier }] : null;
}
