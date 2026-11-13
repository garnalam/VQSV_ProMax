/**
 * JavaSE `vqsv.progression.PetCollectionProgression`: the Đồ giám state, independent of where a pet
 * is kept. Every species is unseen (0), seen (1, met in a fight) or collected (2, owned at least
 * once). Three ranges are tracked, exactly as JavaSE does:
 *
 * - the classic and Cầu Vồng species 0..201 (`SPECIES_COUNT`), the only ones `petmap.ui` lists and
 *   `collectedSpeciesCount` counts;
 * - the V4 species 202..273, kept but not listed;
 * - the two mutation species 274 (Liệt Hỏa) and 275 (Thiên Luân), kept but not listed.
 *
 * The save keeps `snapshot()`: one state per species id 0..275.
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
/** `snapshot().length`: `ThienLuanMutationCatalog.RUNTIME_ID + 1`. */
export const COLLECTION_SNAPSHOT_LENGTH = MUTATION_SPECIES_BASE + MUTATION_SPECIES_COUNT;

export type CollectionState = typeof UNSEEN | typeof SEEN | typeof COLLECTED;

const tracked = (speciesId: number): boolean =>
  Number.isInteger(speciesId) && speciesId >= 0 && speciesId < COLLECTION_SNAPSHOT_LENGTH;

export class PetCollection {
  private readonly states = new Uint8Array(COLLECTION_SNAPSHOT_LENGTH);

  constructor(saved?: readonly number[]) {
    this.restore(saved);
  }

  status(speciesId: number): CollectionState {
    return tracked(speciesId) ? (this.states[speciesId] as CollectionState) : UNSEEN;
  }
  seen(speciesId: number): boolean {
    return this.status(speciesId) >= SEEN;
  }
  collected(speciesId: number): boolean {
    return this.status(speciesId) === COLLECTED;
  }
  /** `markSeen`: true when the state moved. */
  markSeen(speciesId: number): boolean {
    if (!tracked(speciesId) || this.states[speciesId] >= SEEN) return false;
    this.states[speciesId] = SEEN;
    return true;
  }
  /** `markCollected`: true when the state moved. */
  markCollected(speciesId: number): boolean {
    if (!tracked(speciesId) || this.states[speciesId] === COLLECTED) return false;
    this.states[speciesId] = COLLECTED;
    return true;
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
  /** `snapshot`: one state per species id 0..275. */
  snapshot(): number[] {
    return Array.from(this.states);
  }
  /** `restore`: anything out of 0..2 reads as unseen. */
  restore(saved?: readonly number[]): void {
    this.states.fill(UNSEEN);
    if (!saved) return;
    for (let id = 0; id < COLLECTION_SNAPSHOT_LENGTH && id < saved.length; id++) {
      const state = saved[id];
      this.states[id] = state === SEEN || state === COLLECTED ? state : UNSEEN;
    }
  }
}
