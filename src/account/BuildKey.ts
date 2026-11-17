import { DEV_BUILD_KEY_HEX, hexBytes } from "./SaveEnvelope";

/** Set by vite.config.ts from deploy/build-keys.txt (masked bytes), or undefined. */
declare const __VQSV_BK__: number[] | undefined;

/** This build's save envelope key (`SaveEnvelope`); the dev key when the build has none. */
export function buildKey(): Uint8Array {
  const masked = typeof __VQSV_BK__ === "undefined" ? undefined : __VQSV_BK__;
  if (!masked) return hexBytes(DEV_BUILD_KEY_HEX);
  return Uint8Array.from(masked, (value, index) => value ^ ((index * 73 + 41) & 255));
}
