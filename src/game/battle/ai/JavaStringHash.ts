/**
 * `java.lang.String.hashCode()`, the 31-multiplied 32-bit signed fold.
 *
 * The AI-v2 utility scorer hashes its decision material with this function (`Math.floorMod` of the
 * result over the controlled-randomness band), so the Web port has to fold the same way down to the
 * signed overflow — `Math.imul` gives the truncated 32-bit product Java's `int` arithmetic gives.
 * UTF-16 code units, surrogate pairs included, exactly as Java walks the string.
 */
export function javaStringHashCode(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(index)) | 0;
  }
  return hash;
}

/** `Math.floorMod(hash, modulus)` for the positive modulus the randomness band always is. */
export function floorMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}
