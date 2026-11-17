import type { BattleDefinition } from "./BattleDefinition";

export type CaptureSpec = Pick<
  NonNullable<BattleDefinition["tutorial"]>,
  | "captureSpriteId"
  | "captureDurations"
  | "captureEffectDurations"
  | "captureShrinkSteps"
  | "captureRestoreSteps"
>;
export type CaptureVisual = {
  spriteId: number;
  state: number;
  tick: number;
  hideEnemy: boolean;
  phase: "throw" | "capture" | "ground";
  effect?: { scale10: number; dx: number; dy: number };
};

/** The original battle capture phases, shared with Safari. */
export function captureVisualAt(tutorial: CaptureSpec, t: number, caught: boolean): CaptureVisual {
  const [d0, , d2] = tutorial.captureDurations;
  const [shrinkDuration, restoreDuration] = tutorial.captureEffectDurations;
  if (t < d0)
    return {
      spriteId: tutorial.captureSpriteId,
      state: 0,
      tick: t,
      hideEnemy: false,
      phase: "throw",
    };
  let local = t - d0;
  if (local < shrinkDuration)
    return {
      spriteId: tutorial.captureSpriteId,
      state: 1,
      tick: 0,
      hideEnemy: true,
      phase: "capture",
      effect: captureEffectAt(tutorial.captureShrinkSteps, local, shrinkDuration),
    };
  local -= shrinkDuration;
  if (local < d2)
    return {
      spriteId: tutorial.captureSpriteId,
      state: 2,
      tick: local,
      hideEnemy: true,
      phase: "capture",
    };
  local -= d2;
  if (caught)
    return {
      spriteId: tutorial.captureSpriteId,
      state: 3,
      tick: local,
      hideEnemy: true,
      phase: "ground",
    };
  return {
    spriteId: tutorial.captureSpriteId,
    state: 1,
    tick: 0,
    hideEnemy: true,
    phase: "capture",
    effect: captureEffectAt(
      tutorial.captureRestoreSteps,
      Math.min(local, restoreDuration - 1),
      restoreDuration,
    ),
  };
}

export function captureDuration(spec: CaptureSpec, caught: boolean): number {
  return (
    spec.captureDurations[0] +
    spec.captureEffectDurations[0] +
    spec.captureDurations[2] +
    (caught ? spec.captureDurations[3] : spec.captureEffectDurations[1])
  );
}

export function captureEffectAt(
  steps: Array<[number, number, number]>,
  tick: number,
  duration: number,
): { scale10: number; dx: number; dy: number } {
  const span = Math.max(1, Math.floor(duration / Math.max(1, steps.length))),
    index = Math.max(0, Math.min(steps.length - 1, Math.floor(tick / span))),
    step = steps[index] ?? [10, 0, 0];
  return { scale10: step[0], dx: step[1], dy: step[2] };
}
