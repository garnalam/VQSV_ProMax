/**
 * `java.util.Random`, kept bit for bit.
 *
 * The game's own dice are Java's, so a rewritten sequence would move a crit, a capture or a particle
 * spawn away from where the baseline puts it. The seed is masked the same way `setSeed` masks it and
 * every draw takes the same high bits, so a value here is the value the reference game answers.
 */
const MULTIPLIER = 0x5deece66dn;
const ADDEND = 0xbn;
const MASK = (1n << 48n) - 1n;

export class JavaRandom {
  private seed: bigint;

  constructor(seed: bigint | number) {
    this.seed = (BigInt(seed) ^ MULTIPLIER) & MASK;
  }

  private next(bits: number): number {
    this.seed = (this.seed * MULTIPLIER + ADDEND) & MASK;
    return Number(this.seed >> BigInt(48 - bits));
  }

  /** `Random.nextInt()`, or `Random.nextInt(bound)` when a bound is given. */
  nextInt(): number;
  nextInt(bound: number): number;
  nextInt(bound?: number): number {
    if (bound === undefined) return this.next(32) | 0;
    if ((bound & -bound) === bound) return Math.floor((bound * this.next(31)) / 0x80000000);
    let bits: number, value: number;
    do {
      bits = this.next(31);
      value = bits % bound;
    } while (bits - value + (bound - 1) >= 0x80000000);
    return value;
  }
}
