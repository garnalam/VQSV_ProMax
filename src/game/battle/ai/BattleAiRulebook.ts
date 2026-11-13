import type { GameData, PackItem, PackSkill, PackSkillRow } from "../../../data/GameData";
import { speciesPetKey } from "../../../data/GameData";
import type { PackLearnsetEntry, PackTrait } from "../../../data/GameData";

/** The bank/id pair Java's `RainbowControlMechanics.TIER_LOCK_ID` names inside the rainbow bank. */
export const TIER_LOCK_STATUS_ID = 6;

/**
 * `RainbowStatusCatalog.DEBUFF_BANK`, the third bank: Java's rainbow identities live at bank 2 and
 * the observation factory walks that bank for its third status group.
 */
export const RAINBOW_STATUS_BANK = 2;

/** `BattleItemRow.behavior` for an id the item table does not carry; Java's `item == null` branch. */
export const ITEM_BEHAVIOR_NONE = -1;

/**
 * `BattleAiItemOption`: one loadout choice the source-v1 engine may spend its item budget on.
 *
 * Java builds the pair from the item row alone; `itemKey` is what the same runtime id resolves to in
 * the bag inventory, which is how the golden table names the option and how a saved command is read
 * back. The v1 engine never reads it.
 */
export type BattleAiItemOption = {
  readonly itemId: number;
  readonly behavior: number;
  readonly itemKey: string;
};

/**
 * `UnifiedSkillRecord` reduced to what the observation and the utility evaluator read.
 *
 * `owners` and `handler` are only ever used for a `PD-SIG-*` record, which is exactly when Java builds
 * a `SignatureSkillSpec`; the scoring fields (`power`, `mechanicsType`, the random range, `status`, the
 * chance/duration/cap/value numbers and `tier`) are what every mechanics family branches on.
 */
export type BattleAiSkillRecord = {
  readonly stableKey: string;
  readonly runtimeId: number;
  readonly pp: number;
  readonly targetSide: number;
  readonly handler: string;
  readonly owners: ReadonlySet<string>;
  readonly mechanics: Record<string, unknown>;
  readonly mechanicsType: string;
  readonly combatElementId: number;
  readonly tier: number;
  readonly power: number;
  readonly statusChance: number;
  readonly duration: number;
  readonly value: number;
  readonly cap: number;
  readonly chance: number;
  readonly conditionalPower: number;
  readonly heal: number;
  readonly minimumPower: number;
  readonly maximumPower: number;
  readonly status: string;
};

/** `BattleItemRow` reduced to what `validateBattleItem` branches on. */
export type BattleAiItemRow = {
  readonly runtimeId: number;
  readonly behavior: number;
};

function json(text: string): Record<string, unknown> {
  if (text === undefined || text === null || text === "") return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** `PvpJson.integer(mechanics, key, 0)`: a mechanics number the record does not carry as a column. */
export function numberField(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  return typeof value === "number" ? Math.trunc(value) : 0;
}

/** `PvpJson.string(mechanics, key)`: a mechanics name, empty when the record does not set it. */
export function stringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === "string" ? value : "";
}

function booleanField(data: Record<string, unknown>, key: string): boolean {
  return data[key] === true;
}

/**
 * The catalog side of one AI decision, i.e. every lookup Java's observation factory and its two
 * legality checks reach through `VqsvBattleTables` and the unified catalogs.
 *
 * The four unified skill sources are merged into one id space in Java's own competition order —
 * Liệt Hỏa, then Cầu Vồng/V4, then the pet-design signature rows Java falls back to for any id
 * ≥ 1000, then the user-authored record it resolves through a code special case — because the AI
 * only ever asks "which record is this id", never which file it came from. One id still has no
 * unified record, 136, because Java resolves that row from the legacy binary table; the AI treats a
 * missing record the way Java's own `UnifiedSkillCatalog` lookup would, and a memory event that
 * names one is refused rather than guessed at.
 */
export class BattleAiRulebook {
  private readonly petKeyBySpecies = new Map<number, string>();
  private readonly elementBySpecies = new Map<number, number>();
  private readonly relationClassBySpecies = new Map<number, number>();
  private readonly skillByRuntimeId = new Map<number, BattleAiSkillRecord>();
  private readonly skillByStableKey = new Map<string, BattleAiSkillRecord>();
  private readonly lietHoaByRuntimeId = new Map<number, BattleAiSkillRecord>();
  private readonly learnsetByPetKey = new Map<string, PackLearnsetEntry[]>();
  private readonly itemByStableKey = new Map<string, PackItem>();
  private readonly itemRowByRuntimeId = new Map<number, number>();
  private readonly bagItemKeyByRuntimeId = new Map<number, string>();

  private constructor(
    private readonly skillRows: ReadonlyMap<number, PackSkillRow>,
    private readonly physicalTraits: ReadonlyMap<number, PackTrait>,
    private readonly speciesTraits: ReadonlyMap<number, PackTrait>,
    private readonly designTraitKeyBySpecies: ReadonlyMap<number, string>,
    rows: readonly BattleAiSkillRecord[],
    lietHoaRows: readonly BattleAiSkillRecord[],
    items: readonly PackItem[],
    itemBehaviors: readonly { id: number; behavior: number }[],
    petKeys: readonly {
      speciesId: number;
      petKey: string | undefined;
      element: number;
      relationClass: number;
    }[],
    learnsets: Readonly<Record<string, PackLearnsetEntry[]>>,
    /** `BattleUnit.beats`, shipped as the element chart's pair list. */
    private readonly beats: ReadonlySet<string>,
  ) {
    for (const row of rows) {
      this.skillByRuntimeId.set(row.runtimeId, row);
      this.skillByStableKey.set(row.stableKey, row);
    }
    for (const row of lietHoaRows) this.lietHoaByRuntimeId.set(row.runtimeId, row);
    for (const item of items) {
      this.itemByStableKey.set(item.stableKey, item);
      // `UnifiedItemCatalog.byRuntime(BAG, id)`: the AI names the bag copy of an id, of which four
      // inventories can share one runtime id.
      if (item.inventoryKind === "UnifiedItemInventoryKind.BAG") {
        this.bagItemKeyByRuntimeId.set(item.runtimeId, item.stableKey);
      }
    }
    for (const row of itemBehaviors) this.itemRowByRuntimeId.set(row.id, row.behavior);
    for (const row of petKeys) {
      this.elementBySpecies.set(row.speciesId, row.element);
      this.relationClassBySpecies.set(row.speciesId, row.relationClass);
      if (row.petKey !== undefined) this.petKeyBySpecies.set(row.speciesId, row.petKey);
    }
    for (const [petKey, entries] of Object.entries(learnsets)) {
      this.learnsetByPetKey.set(petKey, entries);
    }
  }

  static async load(data: GameData): Promise<BattleAiRulebook> {
    const [
      species,
      skillRows,
      physical,
      speciesTraits,
      design,
      learnsets,
      items,
      catchTable,
      lietHoa,
      userAuthored,
      chart,
    ] = await Promise.all([
      data.species(),
      data.skillRows(),
      data.physicalTraits(),
      data.speciesTraits(),
      data.designTraits(),
      data.learnsets(),
      data.items(),
      data.goldenCatch(),
      data.lietHoaSkills(),
      data.userAuthoredSkills(),
      data.elementChart(),
    ]);
    // The four unified sources cover disjoint id ranges (Liệt Hỏa 0..69, Cầu Vồng 70..100 and
    // 134..135, the V4 copies 101..133, Pet design 1000+, the user-authored shield-break 2000), so
    // one merged id space is Java's `byRuntimeId` lookup, not a rule the client re-derives.
    const records = [
      ...lietHoa.map(toSkillRecord),
      ...(await data.skills()).map(toSkillRecord),
      ...(await data.petDesignSkills()).map(toSkillRecord),
      ...userAuthored.map(toSkillRecord),
    ];
    return new BattleAiRulebook(
      new Map(skillRows.rows.map((row) => [row.skillId, row])),
      new Map(physical.map((row) => [row.runtimeId, row])),
      new Map(speciesTraits.map((row) => [row.runtimeId, row])),
      new Map(design.map((row) => [row.speciesId, row.key])),
      records,
      lietHoa.map(toSkillRecord),
      items,
      catchTable.itemTable,
      species.rows.map((row) => ({
        speciesId: row.speciesId,
        petKey: speciesPetKey(row),
        element: row.element,
        relationClass: row.relationClass,
      })),
      learnsets,
      new Set(chart.beats.map(([attacker, defender]) => `${attacker}>${defender}`)),
    );
  }

  /**
   * `UnifiedSkillLearnsetCatalog.petKey(speciesId)`. The species catalog carries the key for every
   * record-backed form — mutation, boss, V4, evolving line — so only the Liệt Hỏa source rows, which
   * Java spells as `LH-%03d` from the id itself, fall back to the numeric rule.
   */
  petKeyForSpecies(speciesId: number): string {
    const key = this.petKeyBySpecies.get(speciesId);
    if (key !== undefined) return key;
    if (speciesId >= 0 && speciesId < 100) return `LH-${String(speciesId).padStart(3, "0")}`;
    return "";
  }

  /** `VqsvBattleTables.species(speciesId).element`, or `-1` for a species the row table lacks. */
  elementForSpecies(speciesId: number): number {
    return this.elementBySpecies.get(speciesId) ?? -1;
  }

  unifiedSkill(runtimeId: number): BattleAiSkillRecord | undefined {
    return this.skillByRuntimeId.get(runtimeId);
  }

  /**
   * `BattleAiObservationFactory.skill(stableKey)`: an `LH-SKILL-nn` memory token is a runtime id in
   * disguise, anything else is a Cầu Vồng/V4 stable key.
   */
  unifiedSkillByKey(stableKey: string): BattleAiSkillRecord | undefined {
    if (stableKey.startsWith("LH-SKILL-")) {
      const runtimeId = Number.parseInt(stableKey.slice("LH-SKILL-".length), 10);
      return Number.isNaN(runtimeId) ? undefined : this.skillByRuntimeId.get(runtimeId);
    }
    return this.skillByStableKey.get(stableKey);
  }

  /** `VqsvBattleTables.instance().skill(id)` — the resolved row, after the three sources competed. */
  skillRow(runtimeId: number): PackSkillRow | undefined {
    return this.skillRows.get(runtimeId);
  }

  physicalTraitKey(runtimeId: number): string {
    return this.physicalTraits.get(runtimeId)?.stableKey ?? "";
  }

  speciesTraitKey(runtimeId: number): string {
    return this.speciesTraits.get(runtimeId)?.stableKey ?? "";
  }

  /** `PetDesignTraitCatalog.bySpecies(speciesId).key`, or the empty string for an uncovered species. */
  designTraitKey(speciesId: number): string {
    return this.designTraitKeyBySpecies.get(speciesId) ?? "";
  }

  /** `UnifiedItemCatalog.instance().requireActive(itemKey)`, which Java refuses for a dead row. */
  itemRecord(itemKey: string): PackItem {
    const item = this.itemByStableKey.get(itemKey);
    if (item === undefined) throw new Error(`no active battle item ${itemKey}`);
    return item;
  }

  /** `UnifiedItemCatalog.instance().requireActive(itemKey).runtimeId`. */
  itemRuntimeId(itemKey: string): number {
    return this.itemRecord(itemKey).runtimeId;
  }

  /** `VqsvBattleTables.instance().item(id).behavior`; a row the table lacks behaves as `-1`. */
  itemBehavior(runtimeId: number): number {
    return this.itemRowByRuntimeId.get(runtimeId) ?? ITEM_BEHAVIOR_NONE;
  }

  /** `UnifiedSkillLearnsetCatalog.mayLearn`, over the merged learnset Java resolves against. */
  mayLearn(petKey: string, level: number, runtimeId: number): boolean {
    for (const entry of this.learnsetByPetKey.get(petKey) ?? []) {
      if (entry.runtimeSkillId === runtimeId && entry.unlockLevel <= level) return true;
    }
    return false;
  }

  /**
   * `SignatureSkillMechanics.mayUse`, i.e. the whole reason a legal-looking signature slot can still
   * refuse. `signatureState.ready()` is not consulted: JavaSE's implementation returns true for every
   * id, so a cooldown would be invented arithmetic.
   */
  mayUseSignatureSkill(
    record: BattleAiSkillRecord,
    input: {
      petKey: string;
      level: number;
      ownerSide: number;
      isTanNguyetLongMa: boolean;
      alive: boolean;
      hp: number;
      maxHp: number;
    },
  ): boolean {
    if (!record.stableKey.startsWith("PD-SIG-")) return true;
    if (input.isTanNguyetLongMa && input.ownerSide === 0) return false;
    if (!input.alive) return false;
    if (!record.owners.has(input.petKey)) return false;
    if (!this.mayLearn(input.petKey, input.level, record.runtimeId)) return false;
    if (!booleanField(record.mechanics, "requireHpAboveCost")) return true;
    const costPercent = numberField(record.mechanics, "selfHpCostPct");
    return input.hp > Math.max(0, Math.trunc((input.maxHp * costPercent) / 100));
  }

  /**
   * `RainbowControlMechanics.canUseSkillTier`: Phong Bế blocks tiers 2 and 3 and nothing else, so an
   * unlisted tier answers true even while the seal is on.
   */
  canUseSkillTier(hasTierLock: boolean, skillTier: number): boolean {
    return !hasTierLock || skillTier < 2 || skillTier > 3;
  }

  /**
   * `BattleUnit.relationTo(target, skill)` reduced to the ids it reads: 0 when the attacker's element
   * beats the defender's, 1 when it is beaten, -1 otherwise.
   *
   * Two things are easy to get wrong here. The two `relationClass == 2` species are the only gate: a
   * class-2 attacker cannot be hurt by a non-class-2 defender and vice versa, but two class-2 species
   * exchange both ways. And a `unifiedV5` row whose family is known replaces the *attacker's* element
   * only — the defender always answers with its species element — which is why a skill id is an
   * argument rather than a second chart. An id the row table lacks behaves as Java's null skill.
   */
  elementRelationTo(attackerSpeciesId: number, targetSpeciesId: number, runtimeId = -1): number {
    const selfClass = this.relationClassBySpecies.get(attackerSpeciesId) ?? 0,
      otherClass = this.relationClassBySpecies.get(targetSpeciesId) ?? 0,
      selfSpeciesElement = this.elementBySpecies.get(attackerSpeciesId) ?? -1,
      otherElement = this.elementBySpecies.get(targetSpeciesId) ?? -1;
    const row = this.skillRows.get(runtimeId),
      selfElement =
        row !== undefined && row.damageBranch === "unified" && row.elementFamily >= 0
          ? row.elementFamily
          : selfSpeciesElement;
    const attackerEffective = !(selfClass !== 2 && otherClass === 2),
      defenderEffective = !(selfClass === 2 && otherClass !== 2);
    if (attackerEffective && this.beats.has(`${selfElement}>${otherElement}`)) return 0;
    if (defenderEffective && this.beats.has(`${otherElement}>${selfElement}`)) return 1;
    return -1;
  }

  /**
   * `VqsvBattleRuntime.battleAiItemOptions`: the bag is scanned by runtime id and the first id seen
   * for each behavior 1..6 is what the AI is offered, so one behavior never competes with itself and
   * the list is in ascending id order.
   */
  /** `aiV2ItemKey`: a bag item's unified stable key, or "". */
  bagItemKey(runtimeId: number): string {
    return this.bagItemKeyByRuntimeId.get(runtimeId) ?? "";
  }

  itemLoadoutOptions(): BattleAiItemOption[] {
    const out: BattleAiItemOption[] = [];
    const seen = new Array<boolean>(7).fill(false);
    for (let id = 0; id < 256; id++) {
      const behavior = this.itemRowByRuntimeId.get(id) ?? ITEM_BEHAVIOR_NONE;
      if (behavior < 1 || behavior >= seen.length || seen[behavior]) continue;
      seen[behavior] = true;
      out.push({ itemId: id, behavior, itemKey: this.bagItemKeyByRuntimeId.get(id) ?? "" });
    }
    return out;
  }

  /**
   * `EarthPetrificationPriority.preference`, i.e. the chance column of the row the enemy would use.
   *
   * Java reads the *resolved* `BattleSkillRow`, so the guard conditions are the row's own columns and
   * the mechanics come from the record the row carries as `approvedBalance`: the Liệt Hóa record for a
   * `liet-hoa` row, the record that built a `unified` row, and nothing at all for a code-aliased row.
   * Only earth (element 2) enemies on a hostile, living, unpetrified target get past the first test.
   */
  earthPetrificationPreference(input: {
    element: number;
    enemyActor: boolean;
    hostileTarget: boolean;
    targetAlive: boolean;
    alreadyPetrified: boolean;
    skillRuntimeId: number;
  }): number {
    if (
      input.element !== 2 ||
      !input.enemyActor ||
      !input.hostileTarget ||
      !input.targetAlive ||
      input.alreadyPetrified
    ) {
      return 0;
    }
    const row = this.skillRows.get(input.skillRuntimeId);
    if (row === undefined || row.targetSide === 1 || row.ppMax <= 0) return 0;
    const balance = this.approvedBalance(row);
    if (balance === undefined) return 0;
    return balance.mechanicsType === "apply_status" && balance.status === "petrified"
      ? Math.max(0, balance.statusChance)
      : 0;
  }

  /** `BattleSkillRow.approvedBalance`, i.e. the unified record behind a resolved row, if it has one. */
  approvedBalance(row: PackSkillRow): BattleAiSkillRecord | undefined {
    if (row.damageBranch === "source") return undefined;
    return row.damageBranch === "liet-hoa"
      ? this.lietHoaByRuntimeId.get(row.skillId)
      : this.skillByRuntimeId.get(row.skillId);
  }
}

function toSkillRecord(row: PackSkill): BattleAiSkillRecord {
  const mechanics = json(row.mechanicsJson);
  const owners = json(row.provenanceJson)["owners"];
  return {
    stableKey: row.stableKey,
    runtimeId: row.runtimeId,
    pp: row.pp,
    targetSide: row.targetSide,
    handler: stringField(mechanics, "handler"),
    owners: new Set(Array.isArray(owners) ? owners.map(String) : []),
    mechanics,
    mechanicsType: row.mechanicsType,
    combatElementId: row.combatElementId,
    tier: row.tier,
    power: row.power,
    statusChance: row.statusChance,
    duration: row.duration,
    value: row.value,
    cap: row.cap,
    chance: row.chance,
    conditionalPower: row.conditionalPower,
    heal: row.heal,
    minimumPower: row.minimumPower,
    maximumPower: row.maximumPower,
    status: row.status,
  };
}
