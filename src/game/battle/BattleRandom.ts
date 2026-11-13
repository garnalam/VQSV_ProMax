import { JavaRandom } from "../../core/JavaRandom";

/**
 * `VqsvSourceRandom` — the stream every battle draw comes from.
 *
 * One raw `nextInt()` per draw, unsigned-shifted by one and taken modulo the bound, in the order the
 * engine asks. `data/battle/golden-rng.json` is the Java engine's own stream over six seeds and
 * `BattleRandom.test.ts` grades all of it, so the sequence a battle draws is the sequence the
 * reference game draws from the same seed.
 *
 * The label is not decoration: it is the key the Java trace writes, and the order the labels are
 * asked in is part of the parity. A battle's draws are recorded here in that order so a test or a
 * trace can read them back.
 *
 * Java starts this stream from `System.currentTimeMillis()` for a single-player battle and from the
 * injected seed only for PVP (`VqsvBattleRuntime.java:285-287`, `:2416`). The port cannot replay a
 * clock, so a battle is built from an explicit seed — `BATTLE_SEED` unless the caller supplies one.
 * The draw *shape* and *order* stay Java's; only the starting point is the port's, and it is the
 * same seam Java already uses for an online battle.
 */
export const BATTLE_SEED = 0n;

export class BattleRandom {
  private readonly random: JavaRandom;
  private readonly recorded: string[] = [];

  /** The seed this stream started from, as the Java trace records it. */
  readonly seed: bigint | number;

  constructor(seed: bigint | number = BATTLE_SEED) {
    this.seed = seed;
    this.random = new JavaRandom(seed);
  }

  /** `VqsvSourceRandom.a(label, n)`: `raw >>> 1 % n` on one fresh draw. */
  next(label: string, bound: number): number {
    const value = (this.random.nextInt() >>> 1) % bound;
    this.recorded.push(`${label}=${value}`);
    return value;
  }

  /** `VqsvSourceRandom.nextIntBounded(label, bound)`: `java.util.Random.nextInt(bound)`. */
  nextBounded(label: string, bound: number): number {
    const value = this.random.nextInt(bound);
    this.recorded.push(`${label}=${value}`);
    return value;
  }

  /** `VqsvSourceRandom.b(label, min, max)`: `(raw >>> 1) % (max - min + 1) + min`. */
  range(label: string, min: number, max: number): number {
    const value = ((this.random.nextInt() >>> 1) % (max - min + 1)) + min;
    this.recorded.push(`${label}=${value}`);
    return value;
  }

  /** `BattleUnit.randomPercent` and every `SOURCE_RANDOM.a(label, 100, trace)` call. */
  percent(label: string): number {
    return this.next(label, 100);
  }

  /** Every draw this stream has made, as `label=value`, in order. */
  draws(): readonly string[] {
    return this.recorded;
  }
}
