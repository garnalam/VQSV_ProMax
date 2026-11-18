/** Timing and sprite registration from the Test Huy Kim Diễm presentation. */
export const KIM_DIEM_INTRO_TICKS = 88;
export const KIM_DIEM_WORLD_VISUAL = 3007;

export function kimDiemImpactShake(tick: number): number {
  const age = tick - 21;
  return age >= 0 && age < 5 ? (age % 2 ? -1 : 1) * (5 - age) : 0;
}

export function kimDiemIntroPose(tick: number) {
  if (tick < 9 || tick >= KIM_DIEM_INTRO_TICKS) return undefined;
  const travel = Math.min(12, tick - 9);
  const landing = tick < 27;
  const roar = tick >= 52 && tick < 58;
  return {
    x: Math.trunc((28 * (12 - travel)) / 12),
    y:
      tick < 21
        ? -121 + Math.trunc((121 * travel * travel) / 144)
        : tick >= 52 && tick < 61
          ? 57 - tick
          : 0,
    state: landing || roar ? 1 : 0,
    elapsed: landing ? tick - 9 : roar ? tick - 45 : tick % 24,
  };
}

export function kimDiemWorldFrame(x: number, y: number, width: number, height: number) {
  const scaleX = 416 / 96;
  const scaleY = 372 / 86;
  return {
    x: -280 + Math.round((x + 48) * scaleX),
    y: -88 + Math.round((y + 78) * scaleY),
    width: Math.round(width * scaleX),
    height: Math.round(height * scaleY),
  };
}
