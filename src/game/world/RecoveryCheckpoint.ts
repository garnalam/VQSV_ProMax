/** `RecoveryCheckpointService` and `RegionalShopRespawnPolicy` from the deployed runtime. */
const destinations = {
  village: { scene: 1, room: 0, actor: 4 },
  "bich-thuy": { scene: 2, room: 1, actor: 9 },
  "nguyen-moc": { scene: 3, room: 3, actor: 14 },
  "niem-tho": { scene: 4, room: 0, actor: 5 },
  "hac-thach-north": { scene: 5, room: 3, actor: 4 },
  "hac-thach-south": { scene: 5, room: 5, actor: 11 },
  blc: { scene: 4, room: 0, actor: 5 },
  "thien-khong-shop": { scene: 98, room: 50, actor: 0 },
  "thien-gioi-guardian": { scene: 10, room: 6, actor: 5 },
} as const;
export type RecoveryCheckpoint = keyof typeof destinations;

export function isRecoveryCheckpoint(value: unknown): value is RecoveryCheckpoint {
  return typeof value === "string" && Object.hasOwn(destinations, value);
}

export function reachedRecoveryHub(scene: number, room: number): RecoveryCheckpoint | null {
  if (scene === 1 && room === 0) return "village";
  if (scene === 2 && room === 1) return "bich-thuy";
  if (scene === 3 && room === 3) return "nguyen-moc";
  if (scene === 4 && room === 0) return "niem-tho";
  if (scene === 5 && room === 3) return "hac-thach-north";
  if (scene === 5 && room === 5) return "hac-thach-south";
  if (scene === 7 && room === 2) return "blc";
  return null;
}

/** Old saves had no commissioned hub; infer it once using the source room policy. */
export function legacyRecoveryCheckpoint(
  scene: number,
  room: number,
  bichThuyApproachComplete: boolean,
): RecoveryCheckpoint {
  if (scene === 2 && room === 0 && !bichThuyApproachComplete) return "village";
  if (scene === 1) return "village";
  if (scene === 2) return "bich-thuy";
  if (scene === 3) return "nguyen-moc";
  if (scene === 4) return "niem-tho";
  if (scene === 5) return room > 3 ? "hac-thach-south" : "hac-thach-north";
  if (scene === 6) return "hac-thach-south";
  if (scene === 7 || scene === 8) return "blc";
  if (scene === 9)
    return (["bich-thuy", "nguyen-moc", "niem-tho", "niem-tho", "hac-thach-north",
      "hac-thach-south", "hac-thach-south", "blc"] as const)[room] ?? "village";
  if (scene === 10) {
    if (room >= 9 && room <= 11) return "bich-thuy";
    if (room === 13 || room === 14) return "hac-thach-south";
    if (room >= 0 && room <= 12) return "blc";
  }
  if (scene === 11) {
    if ([0, 1, 12, 13, 16].includes(room)) return "nguyen-moc";
    if ([2, 26, 27].includes(room)) return "hac-thach-south";
    if ([3, 28].includes(room)) return "blc";
    if ([4, 5, 6, 7].includes(room)) return "village";
    if ([8, 9, 10, 11, 14].includes(room)) return "bich-thuy";
    if (room >= 17 && room <= 22) return "niem-tho";
    if (room >= 23 && room <= 25) return "hac-thach-north";
  }
  return "village";
}

export function battleLossRecovery(checkpoint: RecoveryCheckpoint, scene: number, room: number) {
  const key = scene === 98 && room === 49 ? "thien-khong-shop"
    : scene === 10 && room === 7 ? "thien-gioi-guardian" : checkpoint;
  return { key, ...destinations[key] };
}
