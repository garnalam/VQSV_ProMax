import type {
  GameData,
  PackBattleAiProfile,
  PackDesignTraitBalance,
  PackSpeciesRow,
  PackTrait,
} from "../../../data/GameData";
import type { SavedPet } from "../../../persistence/save/GameSave";
import { BattleRandom } from "../BattleRandom";
import { EnemyLevel } from "../EnemyLevel";
import type { EventBattleDescriptor } from "../EventBattle";
import type { BattleRules } from "../BattleRules";
import type { PetStatCalculator } from "../PetStatCalculator";
import { BattleAiEncounterCatalog } from "../ai/BattleAiEncounterCatalog";
import { BattleAiRulebook } from "../ai/BattleAiRulebook";
import { RUNTIME_MODES } from "../ai/BattleAiV2RuntimeSelector";
import { AiV2EnemyController } from "./AiV2EnemyController";
import { BattleCore, type BattleCoreDeps } from "./BattleCore";
import { BattleItems } from "./BattleItems";
import { BasicEnemyAi, type EnemyController } from "./EnemyController";
import { PetProgression } from "./PetProgression";
import { DivinePetSeal } from "../../pet/DivinePetSeal";
import type { DoubleSkillRules } from "./DoubleBattleTypes";
import { ENCOUNTER_NATURE_FALLBACK, type BattleSetup, type CombatantSetup } from "./BattleTypes";
import {
  NO_BADGE_PROFILE,
  badgeParamsFromItems,
  battleBadgeProfile,
  postExpBadgeHeal,
  type BadgeParams,
  type BadgeStates,
  type BattleBadgeProfile,
} from "../BattleBadges";

/** What the pet screen tells about a pet beyond its numbers. */
export type PetProfile = {
  /** Đặc tính: the species' characteristic. */
  trait?: { name: string; description: string };
  /** Thiên phú: the talent this pet was rolled with. */
  talent?: { name: string; description: string };
  /** The held item's name, or undefined for none. */
  held?: string;
  /** "Chủng": `taxonomy.species.displayName`, when the taxonomy knows the species. */
  species?: string;
  /** "Hóa": `VqsvBattlePetStateView.evolutionText`; "" is a final form. */
  evolution?: string;
};

/** Pet State facts baked from JavaSE catalogs outside the battle rules. */
export type PetStateFacts = {
  species: (speciesId: number) => string | undefined;
  evolution: (speciesId: number) => string | undefined;
};

/**
 * Everything a fight on the battle core needs beyond the rules, loaded once per session: the bag
 * items, the species relation the catch reads, the AI v2 rulebook and encounter catalog, and the
 * level/learnset progression the settlement writes with.
 */
export class BattleServices {
  private constructor(
    readonly rules: BattleRules,
    readonly petStats: PetStatCalculator,
    readonly items: BattleItems,
    private readonly speciesRows: ReadonlyMap<number, PackSpeciesRow>,
    readonly rulebook: BattleAiRulebook,
    readonly catalog: BattleAiEncounterCatalog,
    readonly progression: PetProgression,
    readonly enemyLevel: EnemyLevel,
    private readonly events: ReadonlyMap<string, EventBattleDescriptor>,
    private readonly traits: ReadonlyMap<number, PackDesignTraitBalance>,
    private readonly talents: ReadonlyMap<number, PackTrait>,
    private readonly talentByKey: ReadonlyMap<string, number>,
    private readonly itemNames: ReadonlyMap<number, string>,
    /** `double-battle/skill-scopes.json`: what a 2v2 core aims and orders by. */
    readonly doubleSkillRules: DoubleSkillRules,
    /** `BattleAiProfile.COMPANION`: the brain of a lent 2v2 pet. */
    readonly companionProfile: PackBattleAiProfile,
    /** `BattleAiProfile.TRAINER` (`defaultFor(true)`): the profile a request without a descriptor fights on. */
    readonly trainerProfile: PackBattleAiProfile,
  ) {}

  static async load(
    data: GameData,
    rules: BattleRules,
    petStats: PetStatCalculator,
  ): Promise<BattleServices> {
    const [
      items,
      species,
      rulebook,
      catalog,
      learnsets,
      traits,
      balance,
      talents,
      renames,
      enemyLevel,
      battleEvents,
      initialPools,
      doubleSkillRules,
      companionProfile,
      trainerProfile,
    ] = await Promise.all([
      data.items(),
      data.species(),
      BattleAiRulebook.load(data),
      BattleAiEncounterCatalog.load(data),
      data.learnsets(),
      data.designTraits(),
      data.designTraitBalanceBySpecies(),
      data.physicalTraits(),
      data.traitDescriptionBalance(),
      EnemyLevel.load(data),
      data.battleEvents(),
      data.initialSkillPools(),
      data.doubleSkillRules(),
      data.aiProfileForTier("COMPANION"),
      data.aiProfileForTier("TRAINER"),
    ]);
    // The web's renamed sentences over the Java talent descriptions.
    const renamed = new Map(
      renames.overrides
        .filter((row) => row.field === "description")
        .map((row) => [row.stableKey, row.value]),
    );
    // Java keys its runtime descriptors by the constant name, which the dump uses as the record key.
    const events = new Map<string, EventBattleDescriptor>();
    for (const [symbol, event] of Object.entries(battleEvents)) {
      events.set(symbol, { symbol, ...event });
      const at = `${event.sceneId}:${event.roomIndex}:${event.groupIndex}:${event.op67ActorId}`;
      if (!events.has(at)) events.set(at, { symbol, ...event });
    }
    const services = new BattleServices(
      rules,
      petStats,
      new BattleItems(items),
      new Map(species.rows.map((row) => [row.speciesId, row])),
      rulebook,
      catalog,
      new PetProgression(
        petStats,
        learnsets,
        new Map([
          ...traits.map((row) => [row.speciesId, row.petKey] as const),
          ...species.rows.flatMap((row) =>
            row.growth.kind === "authored-flat"
              ? [[row.speciesId, row.growth.record.stableKey] as const]
              : [],
          ),
        ]),
        (id) => rules.damage.skillRow(id)?.ppMax ?? 0,
        initialPools,
      ),
      enemyLevel,
      events,
      balance,
      new Map(
        talents.map((row) => [
          row.runtimeId,
          { ...row, description: renamed.get(row.stableKey) ?? row.description },
        ]),
      ),
      new Map(talents.map((row) => [row.stableKey, row.runtimeId])),
      new Map(items.map((row) => [row.runtimeId, row.name])),
      doubleSkillRules,
      companionProfile,
      trainerProfile,
    );
    services.badgeRows = badgeParamsFromItems(items);
    return services;
  }

  /**
   * The op32 record one event group opens, found the way Java's descriptor is reached at runtime: by
   * its scene, room, group and the actor op67 named. Undefined means the group declares no battle.
   */
  eventBattleAt(
    sceneId: number,
    roomIndex: number,
    groupIndex: number,
    actorId: number,
  ): EventBattleDescriptor | undefined {
    // A descriptor built with actor -1 (`SCENE2_ROOM4_GROUP0_RARE`) is the group's fight whatever
    // actor its op67 names: Java's room runtime reaches it by the constant, not by the actor.
    return (
      this.events.get(`${sceneId}:${roomIndex}:${groupIndex}:${actorId}`) ??
      this.events.get(`${sceneId}:${roomIndex}:${groupIndex}:-1`)
    );
  }

  /** A Java descriptor constant, used by panel-launched regional rematches. */
  eventBattle(symbol: string): EventBattleDescriptor | undefined {
    return this.events.get(symbol);
  }

  /** The species row the battle tables hold for `speciesId` (name, element, sprite). */
  speciesRow(speciesId: number): PackSpeciesRow | undefined {
    return this.speciesRows.get(speciesId);
  }

  /** `PetTraitCatalog.byStableKey`: the thiên phú an authored member is pinned to. */
  talentRuntimeId(stableKey: string): number | undefined {
    return this.talentByKey.get(stableKey);
  }

  /** The characteristic, the talent and the held item of a seated pet. */
  profile(setup: CombatantSetup): PetProfile {
    const trait = this.traits.get(setup.speciesId),
      talent =
        setup.physicalTraitId !== undefined && setup.physicalTraitId >= 0
          ? this.talents.get(setup.physicalTraitId)
          : undefined,
      held =
        setup.heldItemId !== undefined && setup.heldItemId >= 0
          ? (this.itemNames.get(setup.heldItemId) ?? `Vật phẩm ${setup.heldItemId}`)
          : undefined;
    return {
      trait: trait ? { name: trait.name, description: trait.description } : undefined,
      talent: talent ? { name: talent.name, description: talent.description } : undefined,
      held,
      species: this.petFacts?.species(setup.speciesId),
      evolution: this.petFacts?.evolution(setup.speciesId),
    };
  }
  /** Set once by `GameAssets` from the baked taxonomy and evolution catalogs. */
  petFacts?: PetStateFacts;

  get deps(): BattleCoreDeps {
    return {
      items: this.items,
      relationClass: (id) => this.speciesRows.get(id)?.relationClass ?? 0,
    };
  }

  /** A party pet as the core seats it: the save's level, quality, nature, HP, skills, talent and item. */
  partyMember(pet: SavedPet, name?: string): CombatantSetup {
    const row = this.speciesRows.get(pet.speciesId),
      // `DivinePetSeal.scale`: an owned Divine pet fights at 30% (120% once the golden title is won).
      percent = this.divinePercent?.(pet.speciesId) ?? 100,
      stats = DivinePetSeal.scaleStats(
        this.petStats.coreStats(pet.speciesId, pet.level, pet.quality, pet.nature ?? 0),
        percent,
      ),
      skillIds = pet.skillIds?.length
        ? [...pet.skillIds]
        : this.progression.initialSkills(pet.speciesId, pet.level),
      skillPp =
        pet.skillPp?.length === skillIds.length
          ? [...pet.skillPp]
          : this.progression.fullPp(skillIds);
    return {
      speciesId: pet.speciesId,
      level: pet.level,
      quality: pet.quality,
      // `BattleUnit.fromPet` hands the unit the save's nature byte, and an unset one is 0.
      nature: pet.nature ?? 0,
      stats,
      hp:
        percent === 100
          ? (pet.currentHp ?? stats.hp)
          : DivinePetSeal.carryHp(pet.currentHp, pet.maxHp, stats.hp),
      skillIds,
      skillPp,
      physicalTraitId:
        pet.physicalTraitId !== undefined && pet.physicalTraitId >= 0
          ? pet.physicalTraitId
          : undefined,
      heldItemId: pet.heldEquipmentId,
      name: name ?? row?.name,
      spriteId: pet.visualSpriteId ?? row?.spriteId,
      element: row?.element,
    };
  }

  /**
   * A wild or trainer pet: full HP, stats for its level and quality, and the last five skills its
   * learnset has unlocked (or `fallbackSkills` for a species with no learnset). The nature is the
   * encounter record's own; `enemyFromEncounter` reads 3 for a record too short to carry one.
   */
  encounterPet(
    speciesId: number,
    level: number,
    quality: number,
    nature: number = ENCOUNTER_NATURE_FALLBACK,
    look: { name?: string; spriteId?: number; element?: number; fallbackSkills?: number[] } = {},
  ): CombatantSetup {
    const row = this.speciesRows.get(speciesId),
      learned = this.progression.initialSkills(speciesId, level);
    return {
      speciesId,
      level,
      // `fromSpeciesInternal` stores `row.resolveQuality(quality)`: a -1 request is the species default.
      quality: this.petStats.resolveQuality(speciesId, quality),
      nature,
      stats: this.petStats.coreStats(speciesId, level, quality, nature),
      skillIds: learned.length > 0 ? learned : (look.fallbackSkills ?? []),
      name: look.name ?? row?.name,
      spriteId: look.spriteId ?? row?.spriteId,
      element: look.element ?? row?.element,
    };
  }

  // ------------------------------------------------------------------ badges

  /** `VqsvBattleTables.badge(id)` for every badge: raw table 2 of `battle/items.json`. */
  badgeRows: ReadonlyMap<number, BadgeParams> = new Map();
  /** `DivinePetSeal.percent` of an owned species, which the world hands over with the badges. */
  divinePercent?: (speciesId: number) => number;
  /** `session.progression.badges`, which the world hands over once it has restored them. */
  badges?: BadgeStates;

  /** `PetBattleAdapter.battleBadgeProfile(badges)`: what every player pet carries into a fight. */
  badgeProfile(): BattleBadgeProfile {
    return this.badges ? battleBadgeProfile(this.badges, this.badgeRows) : NO_BADGE_PROFILE;
  }

  goldenPartyExperiencePercent(): number {
    return this.badges?.achieved(7) ? 30 : 0;
  }

  /** `sourcePostExpPassiveHealAmount(speciesId)` under Liệt Hỏa enhanced, else undefined. */
  postExpBadgeHeal(speciesId: number): number | undefined {
    if (!this.badges) return undefined;
    return postExpBadgeHeal(
      this.badges,
      this.badgeRows,
      this.speciesRows.get(speciesId)?.baseHp ?? 0,
    );
  }

  /** A fight on the core, its enemy decided by `controllerFor(descriptorSymbol)`. */
  /**
   * Where a fight's draw stream starts. Java seeds a single-player fight from the clock; a replay or a
   * recorded trace sets a fixed source here.
   */
  seedSource: () => number = () => Date.now();

  newCore(setup: BattleSetup, descriptorSymbol?: string, seed = this.seedSource()): BattleCore {
    return new BattleCore(
      this.rules,
      this.deps,
      {
        ...setup,
        badgeProfile: setup.badgeProfile ?? this.badgeProfile(),
        goldenPartyExperiencePercent: setup.goldenPartyExperiencePercent ?? this.goldenPartyExperiencePercent(),
        postExpBadgeHeal:
          setup.postExpBadgeHeal ?? ((speciesId) => this.postExpBadgeHeal(speciesId)),
        enemy: setup.enemy.map((pet, member) =>
          this.enemyTalentPet(pet, member, descriptorSymbol, seed),
        ),
      },
      new BattleRandom(seed),
      this.controllerFor(descriptorSymbol),
    );
  }

  /**
   * `PetSourceAdapter.create`: the thiên phú a pet born outside a fight carries — the starter, an
   * egg, a pet the story hands over. Java draws that from `ThreadLocalRandom` and writes it into the
   * save, so a reload never re-rolls; the port replays the same draw from the pet's own identity,
   * which makes a pet without a talent (an old save, a hand-written roster) come back with one
   * stable answer. Kim Diễm Long Vương is the species Java pins to the neutral talent rather than
   * roll, because its record already authored the stats.
   */
  petTalent(
    pet: { speciesId: number; level: number; quality: number; nature?: number },
    slot: number,
  ): number {
    if (this.speciesRows.get(pet.speciesId)?.statPath === "kimDiemBoss") return 0;
    return this.rules.traitRegistry.rollFromIdentity([
      "pet",
      slot,
      pet.speciesId,
      pet.level,
      pet.quality,
      pet.nature ?? 0,
    ]);
  }

  /**
   * `BattleUnit.enemyFromEncounter`: the encounter row says nothing about a thiên phú, so the fight
   * gives the enemy one. Java draws from `ThreadLocalRandom` — no seed to agree with, and nothing
   * taken from the battle's own draw stream — so the port keeps both properties by mixing the
   * identity of this fight instead. Kim Diễm Long Vương is the one species Java leaves talentless;
   * its stats are authored for the boss and the talent pool would move them.
   */
  enemyTalentPet(
    pet: CombatantSetup,
    member: number,
    descriptorSymbol: string | undefined,
    seed: number,
  ): CombatantSetup {
    if ((pet.physicalTraitId ?? -1) >= 0) return pet;
    if (this.speciesRows.get(pet.speciesId)?.statPath === "kimDiemBoss") return pet;
    return {
      ...pet,
      physicalTraitId: this.rules.traitRegistry.rollFromIdentity([
        descriptorSymbol ?? "",
        seed,
        member,
        pet.speciesId,
        pet.level,
        pet.nature,
      ]),
    };
  }

  /**
   * The enemy's controller for an encounter: the source-v1 bot brain, reviewed by AI v2
   * (ALL_ENCOUNTERS_V2, the mode chosen on 2026-11-05). The descriptor's own profile is what makes the
   * brain run, so a fight with no descriptor at all — a trainer battle the catalog never saw — falls
   * back to the basic AI, and a fight with no AI-v2 encounter keeps its v1 pick untouched.
   */
  controllerFor(descriptorSymbol: string | undefined): EnemyController {
    const key = descriptorSymbol
      ? this.catalog.keyForDescriptorSymbol(descriptorSymbol)
      : undefined;
    return new AiV2EnemyController(
      this.rules,
      this.rulebook,
      this.catalog,
      key,
      new BasicEnemyAi(this.rules),
      RUNTIME_MODES.ALL_ENCOUNTERS_V2,
      descriptorSymbol ? this.catalog.profileForDescriptor(descriptorSymbol) : undefined,
    );
  }
}
