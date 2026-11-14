/**
 * JavaSE `vqsv.progression.PetCollectionProgression`: the Đồ giám state, independent of where a pet
 * is kept. Every species is unseen (0), seen (1, met in a fight) or collected (2, owned at least
 * once). The classic `petmap.ui` and its counter cover 0..201; the save also tracks V4, mutation and
 * legendary species through 280.
 */
export const UNSEEN = 0;
export const SEEN = 1;
export const COLLECTED = 2;
export const SPECIES_COUNT = 202;
export const LIET_HOA_SPECIES_COUNT = 100;
export const V4_SPECIES_BASE = 202;
export const V4_SPECIES_COUNT = 72;
export const MUTATION_SPECIES_BASE = 274;
export const MUTATION_SPECIES_COUNT = 2;
/** `snapshot().length`: `KimDiemLongVuongCatalog.RUNTIME_ID + 1`. */
export const COLLECTION_SNAPSHOT_LENGTH = 281;
export const COLLECTION_REWARD_MILESTONES = [10, 15, 20, 30, 40, 50, 281, 843] as const;
export const COLLECTION_FAMILY_NAMES = ["Liệt Hỏa", "Cầu Vồng", "V4"] as const;

/** `PetCollectionCatalog.family`: additions retain their source game's family. */
export function collectionFamily(speciesId: number): number {
  if (!Number.isInteger(speciesId) || speciesId < 0 || speciesId >= 281) return -1;
  if (speciesId < 100) return 0;
  if (speciesId < 202) return 1;
  if (speciesId < 274) return 2;
  return [274, 276, 277, 279].includes(speciesId) ? 0 : 1;
}

const SHINY_SAVE_STRIDE = 512;
const SHINY_FORM_COUNT = 3;
const isShiny = (nature: number): boolean => Number.isInteger(nature) && nature >= 7 && nature <= 9;
const collectionState = (state: number | undefined): CollectionState =>
  state === SEEN || state === COLLECTED ? state : UNSEEN;

export type CollectionState = typeof UNSEEN | typeof SEEN | typeof COLLECTED;

const tracked = (speciesId: number): boolean =>
  Number.isInteger(speciesId) && speciesId >= 0 && speciesId < COLLECTION_SNAPSHOT_LENGTH;

export class PetCollection {
  private readonly states = new Uint8Array(COLLECTION_SNAPSHOT_LENGTH);
  private readonly shinyStates = new Uint8Array(SHINY_SAVE_STRIDE * SHINY_FORM_COUNT);
  private readonly convenienceRewardsClaimed = Array<boolean>(8).fill(false);

  constructor(saved?: readonly number[]) {
    this.restore(saved);
  }

  status(speciesId: number, nature = 0): CollectionState {
    if (!tracked(speciesId)) return UNSEEN;
    return collectionState(
      isShiny(nature)
        ? this.shinyStates[(nature - 7) * SHINY_SAVE_STRIDE + speciesId]
        : this.states[speciesId],
    );
  }
  seen(speciesId: number): boolean {
    return this.status(speciesId) >= SEEN;
  }
  collected(speciesId: number): boolean {
    return this.status(speciesId) === COLLECTED;
  }
  /** `markSeen`: true when the state moved. */
  markSeen(speciesId: number, nature = 0): boolean {
    return this.mark(speciesId, nature, SEEN);
  }
  /** `markCollected`: true when the species or its Shiny form advances. */
  markCollected(speciesId: number, nature = 0): boolean {
    return this.mark(speciesId, nature, COLLECTED);
  }

  private mark(speciesId: number, nature: number, state: CollectionState): boolean {
    if (!tracked(speciesId)) return false;
    let changed = this.states[speciesId] < state;
    if (changed) this.states[speciesId] = state;
    if (isShiny(nature)) {
      const index = (nature - 7) * SHINY_SAVE_STRIDE + speciesId;
      if (this.shinyStates[index] < state) {
        this.shinyStates[index] = state;
        changed = true;
      }
    }
    return changed;
  }
  /** `countCollected(filter)`: only the 0..201 range, as JavaSE's `states` array. */
  countCollected(filter: (speciesId: number) => boolean = () => true): number {
    let count = 0;
    for (let id = 0; id < SPECIES_COUNT; id++)
      if (this.states[id] === COLLECTED && filter(id)) count++;
    return count;
  }
  /** `collectedSpeciesCount`. */
  collectedSpeciesCount(): number {
    return this.countCollected();
  }
  /** `lietHoaCollectedSpeciesCount`. */
  lietHoaCollectedSpeciesCount(): number {
    return this.countCollected((id) => id < LIET_HOA_SPECIES_COUNT);
  }
  /** `v4CollectedSpeciesCount`. */
  v4CollectedSpeciesCount(): number {
    let count = 0;
    for (let i = 0; i < V4_SPECIES_COUNT; i++)
      if (this.states[V4_SPECIES_BASE + i] === COLLECTED) count++;
    return count;
  }
  allCollectedSpeciesCount(): number {
    return this.states.reduce((count, state) => count + (state === COLLECTED ? 1 : 0), 0);
  }
  goldenShinyCollectedCount(): number {
    let count = 0;
    for (let nature = 7; nature <= 9; nature++)
      for (let id = 0; id < COLLECTION_SNAPSHOT_LENGTH; id++)
        if (this.status(id, nature) === COLLECTED) count++;
    return count;
  }
  nextConvenienceRewardTier(): number {
    const tier = this.convenienceRewardsClaimed.indexOf(false);
    return tier < 0 ? this.convenienceRewardsClaimed.length : tier;
  }
  convenienceRewardMilestone(tier: number): number {
    return COLLECTION_REWARD_MILESTONES[tier] ?? -1;
  }
  convenienceRewardCollectedCount(tier: number): number {
    return tier === 6 ? this.allCollectedSpeciesCount() : tier === 7 ? this.goldenShinyCollectedCount() : this.collectedSpeciesCount();
  }
  convenienceRewardReady(tier: number): boolean {
    return Number.isInteger(tier) && tier >= 0 && tier < this.convenienceRewardsClaimed.length && !this.convenienceRewardsClaimed[tier] && this.convenienceRewardCollectedCount(tier) >= this.convenienceRewardMilestone(tier);
  }
  claimConvenienceReward(tier: number): boolean {
    if (!this.convenienceRewardReady(tier)) return false;
    this.convenienceRewardsClaimed[tier] = true;
    return true;
  }
  convenienceRewardsSnapshot(): boolean[] {
    return [...this.convenienceRewardsClaimed];
  }
  restoreConvenienceRewards(saved?: readonly boolean[]): void {
    this.convenienceRewardsClaimed.fill(false);
    saved?.slice(0, this.convenienceRewardsClaimed.length).forEach((claimed, tier) => {
      this.convenienceRewardsClaimed[tier] = claimed === true;
    });
  }
  /** Test Huy's save uses species states first, then a 512-entry block per Shiny form. */
  snapshot(): number[] {
    const saved = Array<number>(SHINY_SAVE_STRIDE + this.shinyStates.length).fill(UNSEEN);
    this.states.forEach((state, id) => (saved[id] = state));
    this.shinyStates.forEach((state, id) => (saved[SHINY_SAVE_STRIDE + id] = state));
    return saved;
  }
  /** Restore also accepts the shorter arrays from earlier ProMax saves. */
  restore(saved?: readonly number[]): void {
    this.states.fill(UNSEEN);
    this.shinyStates.fill(UNSEEN);
    if (!saved) return;
    for (let id = 0; id < this.states.length; id++) {
      this.states[id] = collectionState(saved[id]);
      for (let nature = 7; nature <= 9; nature++) {
        const state = collectionState(saved[(nature - 6) * SHINY_SAVE_STRIDE + id]);
        if (state > UNSEEN) this.mark(id, nature, state);
      }
    }
  }
}
