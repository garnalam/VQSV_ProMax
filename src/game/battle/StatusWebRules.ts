import type { GameData, PackSkill, PackSkillRow, PackStatusWebRules } from "../../data/GameData";
import type { P7HealSeams } from "./P7PostSkill";
import { RainbowSkills, type RainbowPpEffect } from "./RainbowSkills";
import { SignatureSkills, type SignatureStrike } from "./SignatureSkills";
import {
  BUFF_BANK,
  DEBUFF_BANK,
  RAINBOW_BANK,
  signatureSkillOwned,
  StatusInstance,
  type StatusEffects,
  type StatusUnit,
} from "./StatusState";

/** The status ids these rules name, by bank, so the code reads like the descriptions. */
export const SUC_LUC = 0;
export const DIEN_AP = 8;
export const GIA_TOC = 12;
export const QUY_MI = 8;
export const HON_LOAN = 9;
export const TE_LIET = 10;
export const HOA_DA = 0;
export const MI_HOAC = 3;
export const GIAM_CAM = 4;
export const HU_THUC = 5;
export const NGU = 8;

export type RoundPassResult = { damage: number; heal: number };

/** Why an action did not happen, for the battle text. */
export type ActionBlock = { blocked: false } | { blocked: true; status: string };

export type SelfHitDecision = {
  /** The skill the owner actually uses (Hỗn Loạn may replace the chosen one). */
  skillIndex: number;
  /** True when the damaging skill turns on its user instead of its target. */
  selfHit: boolean;
  /** The control debuff spent by this action, if any. */
  spent: "Quỷ Mị" | "Hỗn Loạn" | null;
};

/** Hủ Thực, `RainbowCharmCorrosionMechanics.CORROSION_ID`. */
const RAINBOW_CORROSION_ID = 5;
const percentOf = (value: number, percent: number): number =>
  Math.trunc((Math.max(0, value) * percent) / 100);

/**
 * The buff/debuff behaviour the web build runs on top of the Java-ported engines, read from
 * `battle/status-web-rules.json`. The engines (`StatusEffects`, `DamageCalculator`, `P7Strike`) keep
 * their Java answers when no rules are passed, which is what the golden parity tests grade; a live
 * fight always passes these.
 */
export class StatusWebRules {
  /** The 33 Cầu Vồng skills, which plant their statuses through these rules. */
  readonly rainbow?: RainbowSkills;

  private constructor(
    readonly document: PackStatusWebRules,
    private readonly effects: StatusEffects,
    private readonly selfHitChance: ReadonlyMap<number, number>,
    /** The pet-design signature skills and Phệ Thuẫn U Minh, which only these rules can resolve. */
    readonly signatures?: SignatureSkills,
    unified: readonly PackSkill[] = [],
  ) {
    if (unified.length > 0) this.rainbow = RainbowSkills.from(unified, effects, () => this);
  }

  static async load(data: GameData, effects: StatusEffects): Promise<StatusWebRules> {
    const [document, mechanics, petDesign, catalog, authored, debuffs] = await Promise.all([
      data.statusWebRules(),
      data.statusMechanics(),
      data.petDesignSkills(),
      data.skills(),
      data.userAuthoredSkills(),
      data.debuffProducers(),
    ]);
    // Java looks a skill up by id, not by the file it was exported from: `byRuntimeId` answers both
    // the catalog dump and the hand-authored records, and Phệ Thuẫn U Minh (2000) is only in the second.
    const unified = [...catalog, ...authored];
    return StatusWebRules.from(
      document,
      effects,
      mechanics.debuffActionSelfHitChance,
      SignatureSkills.from(
        petDesign,
        unified,
        effects,
        debuffs.rules.find((rule) => rule.id === TE_LIET)?.primary ?? 0,
      ),
      unified,
    );
  }

  static from(
    document: PackStatusWebRules,
    effects: StatusEffects,
    selfHitChance: readonly { debuffId: number; chance: number }[],
    signatures?: SignatureSkills,
    unified: readonly PackSkill[] = [],
  ): StatusWebRules {
    if (document.schema !== "vqsv-web-status-rules-v1")
      throw new Error(`battle/status-web-rules.json: unknown schema ${document.schema}`);
    return new StatusWebRules(
      document,
      effects,
      new Map(selfHitChance.map((row) => [row.debuffId, row.chance])),
      signatures,
      unified,
    );
  }

  /**
   * Whether a skill can be cast under these rules right now: its damage branch is one the web build
   * resolves (the 33 Cầu Vồng skills are not ported yet) and a sacrifice signature has the HP to pay.
   */
  skillUsable(row: PackSkillRow | undefined, unit: StatusUnit): boolean {
    if (!row) return false;
    // `canUseSourceSkillId`: under Kỹ năng Phong Bế the sealed leading slots replace the tier
    // test; otherwise Phong Bế (2/6) shuts tiers 2 and 3.
    if (unit.rainbowCharmSealed()) {
      const skills = (unit as { skillIds?: readonly number[] }).skillIds ?? [];
      for (let slot = 0; slot < unit.rainbowCharmSealedSkillSlots; slot++)
        if (skills[slot] === row.skillId) return false;
    } else if (!unit.canUseSkillTier(row.learnTier)) return false;
    if (row.damageBranch !== "unified") return true;
    if (this.rainbow?.has(row.skillId)) return true;
    return !!this.signatures?.has(row.skillId) && this.signatures.mayUse(unit, row.skillId);
  }

  // ------------------------------------------------------------------ unified-branch skills

  /** Whether a unified-branch skill has no damage step (a heal, a shield, a pure status). */
  unifiedNoDamage(skillId: number): boolean {
    return !!(this.signatures?.isNoDamage(skillId) || this.rainbow?.isNoDamage(skillId));
  }

  /** Resolve a zero-Power unified skill; returns the HP it healed. */
  resolveUnifiedNoDamage(
    attacker: StatusUnit,
    target: StatusUnit,
    skillId: number,
    roll: (label: string) => number,
    heal: P7HealSeams,
  ): number {
    if (this.signatures?.isNoDamage(skillId))
      return this.signatures.noDamage(attacker, target, skillId, heal);
    if (this.rainbow?.isNoDamage(skillId))
      return this.rainbow.noDamage(attacker, target, skillId, roll, heal);
    return 0;
  }

  /**
   * A damaging unified-branch skill — a pet-design signature, Phệ Thuẫn U Minh or a Cầu Vồng skill —
   * read before the hit. `pp` is set only for a Cầu Vồng skill that refunds or burns PP.
   */
  unifiedStrike(
    attacker: StatusUnit,
    target: StatusUnit,
    skillId: number,
    actedFirst: boolean,
    roll: (label: string) => number,
  ): (SignatureStrike & { pp?: RainbowPpEffect }) | undefined {
    return (
      this.signatures?.strike(attacker, target, skillId, actedFirst) ??
      this.rainbow?.strike(attacker, target, skillId, actedFirst, roll)
    );
  }

  /**
   * Bug fix: the Power a Hỗn Loạn / Quỷ Mị self-hit takes from a unified skill (a Cầu Vồng skill or
   * a signature). The self-hit is "its own damage, none of its effects", so it is the record's plain
   * Power; without it the damage formula refused the skill and the fight threw mid-round.
   */
  selfHitPower(skillId: number): number | undefined {
    return this.rainbow?.record(skillId)?.power ?? this.signatures?.basePower(skillId);
  }

  /** The description a Cầu Vồng or signature skill carries in its own record. */
  skillDescription(skillId: number): string | undefined {
    return (
      this.rainbow?.record(skillId)?.description ??
      this.signatures?.spec(skillId)?.skill.description
    );
  }

  /** The Hủ Thực ramp a Cầu Vồng debuff bites with (3 → 3%, 6%, 9%), or 0. */
  rampPercent(id: number): number {
    return this.rainbowRule(id)?.rampPercent ?? 0;
  }

  private rainbowRule(id: number) {
    return this.document.rainbowDebuffs.find((row) => row.id === id);
  }

  // ------------------------------------------------------------------ round passes

  /**
   * Start of the owner's turn: every ACTIVE_OWNER_ROUND status the owner carries is counted down and
   * does its per-round work (Gieo Hạt, Thực Loại, Hủ Thực bite). Characteristic-owned instances keep
   * their own lifecycle, and Xé Rách bleeds at the round end instead.
   */
  ownerTurnStart(
    unit: StatusUnit,
    /** Who planted a status, by the side and slot it stores (Thực Loại heals its planter). */
    sourceResolver?: (sourceSide: number, sourceSlot: number) => StatusUnit | undefined,
    /**
     * The fight's trait seams around one damage-over-time tick (`VqsvBattleRuntime`'s queue arm): the
     * amount goes through `damageProjection` first, and a tick that took HP is reported with the
     * status that paid and the HP before it, so the planter's sustain and the receiver's thresholds
     * hear it.
     */
    dot?: {
      damageProjection?: (amount: number) => number;
      ticked?: (status: StatusInstance, damage: number, hpBefore: number) => void;
      /** A regen buff's heal on its way in (`projectBattleHealing`); omitted is the whole amount. */
      healProjection?: (amount: number) => number;
      /** A Cầu Vồng bite on its way in (the boss's `reduceCorrosionBurn`); omitted is the whole bite. */
      rainbowDamageProjection?: (statusId: number, amount: number) => number;
    },
  ): RoundPassResult {
    const result: RoundPassResult = { damage: 0, heal: 0 };
    if (!unit.alive()) return result;
    for (const bank of [BUFF_BANK, DEBUFF_BANK]) {
      for (const id of unit.activeStatusIds(bank)) {
        const instance = unit.statuses.get(bank, id);
        if (!instance || signatureSkillOwned(instance)) continue;
        if (instance.definition.tickPhase !== "ACTIVE_OWNER_ROUND") continue;
        if (bank === BUFF_BANK)
          result.heal += this.effects.tickSourceBuff(unit, id, dot?.healProjection);
        else {
          const hpBefore = unit.hp();
          result.damage += this.effects.tickSourceDebuff(unit, id, {
            sourceResolver,
            damageProjection: dot?.damageProjection,
          });
          if (unit.hp() < hpBefore) dot?.ticked?.(instance, hpBefore - unit.hp(), hpBefore);
        }
        if (!unit.alive()) return result;
      }
    }
    for (const id of unit.statuses.activeIds(RAINBOW_BANK)) {
      const instance = unit.statuses.get(RAINBOW_BANK, id);
      if (!instance || signatureSkillOwned(instance)) continue;
      if (instance.definition.tickPhase !== "ACTIVE_OWNER_ROUND") continue;
      if (id === 7) continue;
      const hpBefore = unit.hp();
      result.damage += this.tickRainbow(
        unit,
        instance,
        sourceResolver?.(instance.sourceSide, instance.sourceSlot)?.rainbowCharmCorrosionBonus ?? 0,
        dot?.rainbowDamageProjection,
      );
      if (unit.hp() < hpBefore) dot?.ticked?.(instance, hpBefore - unit.hp(), hpBefore);
      if (!unit.alive()) return result;
    }
    return result;
  }

  /** End of the owner's turn: the OWNER_TURN_END buffs (Khôi phục, Thạch Hóa) heal and count down. */
  ownerTurnEnd(unit: StatusUnit, healProjection?: (amount: number) => number): RoundPassResult {
    const result: RoundPassResult = { damage: 0, heal: 0 };
    if (!unit.alive()) return result;
    for (const id of unit.activeStatusIds(BUFF_BANK)) {
      const instance = unit.statuses.get(BUFF_BANK, id);
      if (!instance || signatureSkillOwned(instance)) continue;
      if (instance.definition.tickPhase !== "OWNER_TURN_END") continue;
      result.heal += this.effects.tickSourceBuff(unit, id, healProjection);
    }
    return result;
  }

  /** One round of a Cầu Vồng debuff the ordinary lifecycle owns: Hủ Thực bites, then it ages. */
  private tickRainbow(
    unit: StatusUnit,
    instance: StatusInstance,
    charmBonus = 0,
    projection?: (statusId: number, amount: number) => number,
  ): number {
    const id = instance.definition.sourceNumericId,
      ramp = this.rainbowRule(id)?.rampPercent ?? 0;
    let damage = 0;
    if (ramp > 0) {
      // 3%, 6%, 9%: the bite grows with every round the status has already been held.
      const elapsed = Math.max(0, instance.secondaryValue) + 1,
        before = unit.hp();
      let bite = Math.max(1, percentOf(unit.maxHp(), ramp * elapsed));
      // Nọc độc công kích (`corrosionTickDamage`): the planter's charm raises the bite, rounded half up.
      if (id === RAINBOW_CORROSION_ID && charmBonus > 0)
        bite = Math.max(1, Math.trunc((bite * (100 + charmBonus) + 50) / 100));
      if (projection) bite = projection(id, bite);
      unit.damage(bite);
      damage = Math.max(0, before - unit.hp());
      instance.secondaryValue = elapsed;
    }
    instance.remainingTurns--;
    if (instance.remainingTurns <= 0) unit.statuses.remove(RAINBOW_BANK, id);
    unit.restoreSourceStatusState();
    return damage;
  }

  // ------------------------------------------------------------------ actions

  /**
   * Before the owner acts: Hóa Đá and Ngủ take the action and are spent by it; Tê Liệt takes it on
   * its chance. A blocked action uses no skill and no PP.
   */
  beforeAction(unit: StatusUnit, rollPercent: (label: string) => number): ActionBlock {
    for (const id of [HOA_DA, NGU]) {
      const instance = unit.statuses.get(RAINBOW_BANK, id);
      if (!instance || !this.rainbowRule(id)?.skipsNextAction) continue;
      unit.statuses.remove(RAINBOW_BANK, id);
      unit.restoreSourceStatusState();
      return { blocked: true, status: instance.definition.displayName };
    }
    for (const skip of this.document.turnSkip) {
      if (!unit.hasStatus(skip.bank, skip.id)) continue;
      if (rollPercent(`status.turnSkip.${skip.bank}.${skip.id}`) < skip.chance)
        return { blocked: true, status: skip.name };
    }
    return { blocked: false };
  }

  /**
   * Quỷ Mị and Hỗn Loạn on the acting unit: Hỗn Loạn swaps the chosen skill for a random usable one,
   * and either can turn a damaging skill on its user. Both are spent by this action.
   */
  controlAction(
    unit: StatusUnit,
    chosenIndex: number,
    usable: readonly { index: number; damaging: boolean }[],
    rollPercent: (label: string) => number,
  ): SelfHitDecision {
    const confused = unit.hasDebuff(HON_LOAN),
      charmed = unit.hasDebuff(QUY_MI);
    if (!confused && !charmed) return { skillIndex: chosenIndex, selfHit: false, spent: null };
    let skillIndex = chosenIndex;
    if (confused && usable.length > 0) {
      const pick = Math.min(
        usable.length - 1,
        Math.floor((rollPercent("status.honLoan.skill") * usable.length) / 100),
      );
      skillIndex = usable[pick].index;
    }
    const debuffId = confused ? HON_LOAN : QUY_MI,
      damaging = usable.find((row) => row.index === skillIndex)?.damaging ?? false,
      chance = this.selfHitChance.get(debuffId) ?? 0,
      selfHit = damaging && rollPercent(`status.selfHit.${debuffId}`) < chance;
    this.effects.consumeDebuffAction(unit, debuffId);
    return { skillIndex, selfHit, spent: confused ? "Hỗn Loạn" : "Quỷ Mị" };
  }

  /** Điện áp: PP a skill costs its user. */
  ppCost(unit: StatusUnit): number {
    return unit.hasBuff(this.document.electricPp.buffId) ? this.document.electricPp.ppPerSkill : 1;
  }

  /** Giam Cầm: switching pets and using items are refused. */
  switchAndItemsLocked(unit: StatusUnit): boolean {
    return this.document.rainbowDebuffs.some(
      (row) => row.locksSwitchAndItems && unit.statuses.has(RAINBOW_BANK, row.id),
    );
  }

  /** Ngủ: a direct hit wakes the sleeper. Called before the hit's own status lands. */
  wakeOnDirectDamage(unit: StatusUnit): boolean {
    for (const row of this.document.rainbowDebuffs) {
      if (!row.wakesOnDirectDamage || !unit.statuses.has(RAINBOW_BANK, row.id)) continue;
      unit.statuses.remove(RAINBOW_BANK, row.id);
      unit.restoreSourceStatusState();
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ damage

  /** Percent added to damage the attacker deals (Mị Hoặc −15). */
  damageDealtPercent(attacker: StatusUnit): number {
    return this.document.rainbowDebuffs.reduce(
      (sum, row) =>
        sum +
        (row.damageDealtPercent && attacker.statuses.has(RAINBOW_BANK, row.id)
          ? row.damageDealtPercent
          : 0),
      0,
    );
  }

  /** Percent added to damage the target takes (Hóa Đá −30). */
  damageTakenPercent(target: StatusUnit): number {
    return this.document.rainbowDebuffs.reduce(
      (sum, row) =>
        sum +
        (row.damageTakenPercent && target.statuses.has(RAINBOW_BANK, row.id)
          ? row.damageTakenPercent
          : 0),
      0,
    );
  }

  // ------------------------------------------------------------------ planting (tests, future skills)

  /**
   * Plant a Cầu Vồng debuff with the ordinary lifecycle. `turns` is the duration the producing skill
   * names; `primary` its magnitude (Giam Cầm agility, Xé Rách bleed). The Cầu Vồng skills that will
   * call this are not ported yet.
   */
  applyRainbowDebuff(
    unit: StatusUnit,
    id: number,
    options: { turns: number; primary?: number; sourceSkill?: number },
  ): void {
    const definition = this.effects.catalog.definition(RAINBOW_BANK, id);
    if (!definition) throw new Error(`no Cầu Vồng status 2/${id} in battle/statuses.json`);
    const actions = definition.consumePolicy === "ACTION" ? 1 : 0;
    unit.statuses.put(
      new StatusInstance(
        definition,
        Math.max(1, options.turns),
        actions,
        options.primary ?? 0,
        0,
        1,
        unit.ownerSide,
        unit.formationSlot,
        options.sourceSkill ?? 0,
        0,
      ),
    );
    unit.restoreSourceStatusState();
  }
}
