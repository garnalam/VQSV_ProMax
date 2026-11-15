import { KIM_DIEM_AMULET_SHINY_PERCENT } from "../campaign/EggService";

/**
 * JavaSE `vqsv.world.WorldEncounterEngine` (unified profile): the free-world random wild encounter.
 * After every tick the hero actually moves, the step countdown runs down (40..100, room 4:1 4..8);
 * at zero the terrain under the hero picks a pool from `petArea.mid` (plus the 68 Cầu Vồng rosters),
 * mixed with the unified weighted overlay, and in Cầu Vồng a 35 % chance of a V4 pet by tier.
 * The level, the nature (2 % a rare 7..9) and the stars (`qualityForRoll` by main task) follow.
 *
 * The pools are baked from the JavaSE catalogs into `public/pack/story/world-encounters.json` by
 * `rebuild_game/tools/ExportWebWorldEncounters.java`.
 */

export type WorldEncountersDocument = {
  schema: "vqsv-world-encounters-v1";
  areas: {
    scene: number;
    room: number;
    minLevel: number;
    maxLevel: number;
    /** Per terrain id: `[speciesId, minNature, maxNature]` in `entriesForTerrain` order. */
    terrains: Record<string, [number, number, number][]>;
  }[];
  /** `[scene, room, terrain, speciesId, minLevel, maxLevel, weight, minNature, maxNature]`. */
  unified: [number, number, number, number, number, number, number, number, number][];
  v4: {
    chancePercent: number;
    tierWeights: number[];
    entries: { species: number; tier: number; rooms: number[]; terrains: number[] }[];
  };
};

/** `WorldEncounterEngine.RandomPort` over the world's source stream. */
export type EncounterRandom = {
  /** `nextEntryIndex` → `nextIntBounded(label, bound)`. */
  entry(label: string, bound: number): number;
  /** `nextInclusive` → `b(label, min, max)`. */
  inclusive(label: string, min: number, max: number): number;
};

export type EncounterState = {
  temporaryActorTicks: number;
  /** `avoidMonsterTicks`: the repel (item 13); -1 once it has run out. */
  avoidMonsterTicks: number;
  /** `encounterStepsRemaining`: -1 before the first countdown. */
  encounterStepsRemaining: number;
};
export type EncounterRequest = {
  speciesId: number;
  level: number;
  nature: number;
  quality: number;
};
export type EncounterResult = EncounterState & {
  avoidExpired: boolean;
  terrain: number;
  request: EncounterRequest | null;
};

const DEFAULT_MIN_STEPS = 40;
const DEFAULT_MAX_STEPS = 100;
const CUSTOM_NATURE_CHANCE_PERCENT = 2;
const CUSTOM_NATURE_MIN = 7;
const CUSTOM_NATURE_MAX = 9;
const CAU_VONG_SCENE = 98;

/** `UnifiedWorldAcquisitionCatalog.qualityForRoll`. */
export function qualityForRoll(mainTaskProgress: number, roll: number): number {
  if (mainTaskProgress <= 11) return roll < 85 ? 1 : 2;
  if (mainTaskProgress <= 20) return roll < 65 ? 1 : roll < 95 ? 2 : 3;
  if (mainTaskProgress <= 40) return roll < 45 ? 1 : roll < 80 ? 2 : 3;
  if (mainTaskProgress <= 46) return roll < 25 ? 1 : roll < 60 ? 2 : roll < 90 ? 3 : 4;
  return roll < 15 ? 1 : roll < 45 ? 2 : roll < 80 ? 3 : 4;
}

export class WorldEncounterEngine {
  constructor(
    private readonly doc: WorldEncountersDocument,
    private readonly random: EncounterRandom,
  ) {}

  private area(scene: number, room: number) {
    return this.doc.areas.find((area) => area.scene === scene && area.room === room);
  }
  /** Whether the room has a `petArea` roster at all. */
  hasArea(scene: number, room: number): boolean {
    return this.area(scene, room) !== undefined;
  }

  afterSuccessfulMovement(
    input: {
      /** `mainTaskProgress != 0`: the source timers run only once the story has begun. */
      timersEnabled: boolean;
      scene: number;
      room: number;
      rideSuppressesEncounters: boolean;
      mainTaskProgress: number;
      rareEncounterBonusPercent: number;
      shinyGearEquipped?: boolean;
    },
    state: EncounterState,
    terrainAtPlayer: () => number,
  ): EncounterResult {
    const none = (s: EncounterState, avoidExpired: boolean): EncounterResult => ({
      ...s,
      avoidExpired,
      terrain: -1,
      request: null,
    });
    if (!input.timersEnabled) return none(state, false);
    const temporaryActorTicks = Math.max(0, state.temporaryActorTicks - 1);
    let avoidMonsterTicks = state.avoidMonsterTicks,
      avoidExpired = false;
    if (avoidMonsterTicks > 0) {
      avoidMonsterTicks--;
      avoidExpired = avoidMonsterTicks === 0;
    }
    if (avoidExpired)
      return none(
        {
          temporaryActorTicks,
          avoidMonsterTicks: -1,
          encounterStepsRemaining: state.encounterStepsRemaining,
        },
        true,
      );
    const area = this.area(input.scene, input.room);
    if (!area || avoidMonsterTicks > 0 || input.rideSuppressesEncounters)
      return none(
        {
          temporaryActorTicks,
          avoidMonsterTicks,
          encounterStepsRemaining: state.encounterStepsRemaining,
        },
        avoidExpired,
      );
    let steps = state.encounterStepsRemaining;
    if (steps < 0) steps = this.resetCountdown(input.scene, input.room);
    if (steps > 0) steps--;
    if (steps > 0)
      return none(
        { temporaryActorTicks, avoidMonsterTicks, encounterStepsRemaining: steps },
        avoidExpired,
      );

    const terrain = terrainAtPlayer(),
      sourceCandidates = area.terrains[String(terrain)] ?? [],
      overlayCandidates = this.doc.unified.filter(
        (row) => row[0] === input.scene && row[1] === input.room && row[2] === terrain,
      );
    if (sourceCandidates.length === 0 && overlayCandidates.length === 0)
      return none(
        {
          temporaryActorTicks,
          avoidMonsterTicks,
          encounterStepsRemaining: this.resetCountdown(input.scene, input.room),
        },
        avoidExpired,
      );

    let sourceEntry: [number, number, number] | null = null,
      overlayEntry: WorldEncountersDocument["unified"][number] | null = null,
      v4Species: number | null = null;
    // This authored pool only augments existing Cầu Vồng wild habitats.
    if (input.scene === CAU_VONG_SCENE && sourceCandidates.length > 0) {
      const v4 = this.doc.v4.entries.filter(
        (entry) => entry.rooms.includes(input.room) && entry.terrains.includes(terrain),
      );
      if (
        v4.length > 0 &&
        this.random.entry("world.encounter.v4Chance", 100) < this.doc.v4.chancePercent
      ) {
        const weights = this.doc.v4.tierWeights,
          has = (tier: number) => v4.some((entry) => entry.tier === tier),
          total = [0, 1, 2].reduce((sum, tier) => sum + (has(tier) ? weights[tier] : 0), 0);
        let roll = this.random.entry("world.encounter.v4Tier", total),
          tierEntries = v4;
        for (const tier of [0, 1, 2]) {
          if (!has(tier)) continue;
          if (roll < weights[tier]) {
            tierEntries = v4.filter((entry) => entry.tier === tier);
            break;
          }
          roll -= weights[tier];
        }
        v4Species =
          tierEntries[this.random.entry("world.encounter.v4Entry", tierEntries.length)].species;
      }
    }
    if (v4Species === null) {
      const sourceWeight = sourceCandidates.length * 100,
        totalWeight = overlayCandidates.reduce((sum, row) => sum + row[6], sourceWeight);
      let selection = this.random.entry("world.encounter.weightedEntry", totalWeight);
      if (selection < sourceWeight) sourceEntry = sourceCandidates[Math.trunc(selection / 100)];
      else {
        selection -= sourceWeight;
        for (const row of overlayCandidates) {
          if (selection < row[6]) {
            overlayEntry = row;
            break;
          }
          selection -= row[6];
        }
        if (!overlayEntry) throw new Error("Unified encounter weight selection overflow");
      }
    }
    const speciesId = v4Species ?? (sourceEntry ? sourceEntry[0] : overlayEntry![3]),
      fromArea = v4Species !== null || sourceEntry !== null,
      minLevel = fromArea ? area.minLevel : overlayEntry![4],
      maxLevel = fromArea ? area.maxLevel : overlayEntry![5],
      minNature = v4Species !== null ? 1 : sourceEntry ? sourceEntry[1] : overlayEntry![7],
      maxNature = v4Species !== null ? 1 : sourceEntry ? sourceEntry[2] : overlayEntry![8],
      level = this.random.inclusive("world.encounter.level", minLevel, maxLevel),
      nature = this.resolveWildNature(minNature, maxNature, input.shinyGearEquipped ?? false),
      quality = qualityForRoll(
        input.mainTaskProgress,
        Math.min(
          99,
          this.random.entry("world.encounter.quality", 100) + input.rareEncounterBonusPercent,
        ),
      );
    return {
      temporaryActorTicks,
      avoidMonsterTicks,
      encounterStepsRemaining: this.resetCountdown(input.scene, input.room),
      avoidExpired,
      terrain,
      request: { speciesId, level, nature, quality },
    };
  }

  /** `resolveWildNature`: 2% Shiny, or 30% with the Kim Diễm amulet (owner's rate). */
  private resolveWildNature(
    minNature: number,
    maxNature: number,
    shinyGearEquipped: boolean,
  ): number {
    if (minNature === -1 && !shinyGearEquipped) return -1;
    const rare = this.random.entry("world.encounter.customNatureChance", 100);
    if (
      rare >= 0 &&
      rare < (shinyGearEquipped ? KIM_DIEM_AMULET_SHINY_PERCENT : CUSTOM_NATURE_CHANCE_PERCENT)
    )
      return this.random.inclusive(
        "world.encounter.customNature",
        CUSTOM_NATURE_MIN,
        CUSTOM_NATURE_MAX,
      );
    return minNature === -1
      ? -1
      : this.random.inclusive("world.encounter.nature", minNature, maxNature);
  }
  /** `resetCountdown`: 40..100 steps, 4..8 in room 4:1. */
  private resetCountdown(scene: number, room: number): number {
    const fast = scene === 4 && room === 1;
    return this.random.inclusive(
      "world.encounter.countdown",
      fast ? 4 : DEFAULT_MIN_STEPS,
      fast ? 8 : DEFAULT_MAX_STEPS,
    );
  }
}
