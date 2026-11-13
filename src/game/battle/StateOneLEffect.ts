/**
 * The state-1 "L" effect: the afterimage a few pets leave while they lunge (`VqsvBattleRuntime
 * .tickP7LEffect` in 1v1, `VqsvDoubleBattleRuntime.tickActionLEffect` in 2v2, drawn by
 * `VqsvBattleRenderer.drawState1LEffect`).
 *
 * Which species have one, the picture every copy is made from (the pet's state 0 frame 0 cell) and
 * the state-1 frame durations its trigger steps through come from `public/pack/l-effect`
 * (rebuild_game/tools/ExportWebStateOneLEffect.java). The speffect row that says how the copies are
 * tinted and where they sit is the `speffect.mid` row already shipped in
 * `battle/source-skill-animations.json`.
 */

export type StateOneLEffectDocument = {
  source?: string;
  species: Record<
    string,
    { speffect: number; visual: number; drawAfter: boolean; state1Ticks: number[] }
  >;
};

export type StateOneLEntry = {
  species: number;
  speffect: number;
  /** The visual whose state 0 frame 0 picture (`l-effect/<visual>.png`) the copies are made of. */
  visual: number;
  /** Species 10 draws its L over the pet; every other one under it. */
  drawAfter: boolean;
  state1Ticks: readonly number[];
  /** `VqsvBattleAnimationTables.speffectRow(speffect)`: `row[0]` is the type (11..15). */
  row: readonly number[];
};

export class StateOneLEffect {
  private readonly entries = new Map<number, StateOneLEntry>();
  constructor(
    document: StateOneLEffectDocument,
    speffectRow: (id: number) => readonly number[] | undefined,
  ) {
    for (const [key, item] of Object.entries(document.species)) {
      const row = speffectRow(item.speffect) ?? [];
      this.entries.set(Number(key), { species: Number(key), ...item, row });
    }
  }
  /** `state1LEffectSpeffectId(species) >= 0` with a non-empty row, or undefined. */
  entry(species: number): StateOneLEntry | undefined {
    const entry = this.entries.get(species);
    return entry && entry.row.length ? entry : undefined;
  }
  get all(): readonly StateOneLEntry[] {
    return [...this.entries.values()];
  }
}

/** `p7LEffectFrameCount` / `actionLEffectFrameCount`. */
export function lEffectFrameCount(row: readonly number[]): number {
  if (row.length < 3) return 0;
  const type = row[0];
  if (type === 11 || type === 14 || type === 15) {
    const count = Math.max(1, row[1]),
      t = 2 + ((count - 1) << 2);
    return t + 1 < row.length ? Math.max(1, row[t + 1]) : 1;
  }
  if (type === 12) return row.length > 5 ? Math.max(1, row[5]) : 1;
  if (type === 13) {
    const t = 2 + Math.max(1, row[1]);
    return t + 1 < row.length ? Math.max(1, row[t + 1]) : 1;
  }
  return 1;
}

/** `SpriteAnimator.cursorAtElapsedTick` over one state's frame durations (0 without frames). */
export function loopedCursor(ticks: readonly number[], elapsed: number): number {
  if (!ticks.length) return 0;
  const total = ticks.reduce((sum, d) => sum + Math.max(1, d), 0),
    wrapped = Math.max(0, elapsed) % total;
  let sum = 0;
  for (let frame = 0; frame < ticks.length; frame++) {
    sum += Math.max(1, ticks[frame]);
    if (wrapped < sum) return frame;
  }
  return 0;
}

/**
 * One L's lifetime: `tickP7LEffect` once per action tick, `resetP7` / `prepareAction` between
 * actions. `owner` is whoever lunged (a 1v1 side or a 2v2 slot).
 */
export class StateOneLEffectTracker<Owner> {
  private active = false;
  private ticks = 0;
  private entry: StateOneLEntry | undefined;
  private owner: Owner | undefined;

  reset(): void {
    this.active = false;
    this.ticks = 0;
    this.entry = undefined;
    this.owner = undefined;
  }

  /**
   * One tick: a playing L counts on and ends after its frames; otherwise one starts when the
   * attacker (with an L of its own) stands in state 1 on cursor 1, `elapsed` ticks into that state.
   */
  tick(attacker: StateOneLEntry | undefined, owner: Owner, state: number, elapsed: number): void {
    if (this.active) {
      this.ticks++;
      if (this.ticks >= lEffectFrameCount(this.entry!.row)) this.active = false;
      return;
    }
    if (!attacker || state !== 1 || loopedCursor(attacker.state1Ticks, elapsed) !== 1) return;
    this.active = true;
    this.ticks = 0;
    this.entry = attacker;
    this.owner = owner;
  }

  /** What the renderer draws (`battleLFrame` clamped to the row's frames), or undefined. */
  get view(): { entry: StateOneLEntry; owner: Owner; frame: number } | undefined {
    if (!this.active || !this.entry) return undefined;
    const frames = lEffectFrameCount(this.entry.row);
    return {
      entry: this.entry,
      owner: this.owner as Owner,
      frame: Math.max(0, Math.min(frames - 1, this.ticks)),
    };
  }
}

/** How one copy of the picture is coloured (`tintOpaque`, `adjustRgb`, `alphaCopy`, or as is). */
export type LEffectPaint =
  | { kind: "base" }
  | { kind: "tint"; a: number; r: number; g: number; b: number }
  | { kind: "adjust"; multiply: number; add: number }
  | { kind: "alpha"; a: number };

/** One copy, in draw order, offset from `state1LEffectX/Y`. */
export type LEffectDraw = { paint: LEffectPaint; dx: number; dy: number };

/** The copies `drawState1LEffect` (types 11..15, direction 0) draws for `frame` of `row`. */
export function lEffectDraws(row: readonly number[], frame: number): LEffectDraw[] {
  const out: LEffectDraw[] = [],
    type = row[0],
    count = Math.max(1, row[1] ?? 0);
  const clampFrame = (frames: number) => Math.max(0, Math.min(frames - 1, frame));
  const tint = (k: number): LEffectPaint => {
    const c = 2 + ((k - 1) << 2);
    return { kind: "tint", a: row[c], r: row[c + 1], g: row[c + 2], b: row[c + 3] };
  };
  if (type === 11 || type === 14) {
    const c1 = count - 1,
      t = 2 + (c1 << 2);
    if ((type === 14 && c1 <= 0) || t + 4 >= row.length) return out;
    const f = Math.max(0, Math.min(frame, Math.max(0, row[t + 1] - 1)));
    for (let i = 1; i < count; i++) {
      const c = 2 + ((i - 1) << 2),
        o = t + 4 + ((f * c1 + i - 1) << 1);
      if (o + 1 >= row.length) continue;
      if (type === 11) {
        if (c + 3 >= row.length) continue;
        out.push({ paint: tint(i), dx: row[o], dy: row[o + 1] });
      } else {
        if (c + 1 >= row.length) continue;
        out.push({
          paint: { kind: "adjust", multiply: row[c], add: row[c + 1] },
          dx: row[o],
          dy: row[o + 1],
        });
      }
    }
    return out;
  }
  if (type === 13) {
    const t = 2 + count;
    if (t + 4 >= row.length) return out;
    const f = clampFrame(Math.max(1, row[t + 1]));
    for (let i = 0; i < count; i++) {
      const o = t + 4 + ((f * count + i) << 1);
      if (2 + i >= row.length || o + 1 >= row.length) continue;
      out.push({ paint: { kind: "alpha", a: row[2 + i] }, dx: row[o], dy: row[o + 1] });
    }
    return out;
  }
  if (type === 15) {
    const t = 2 + ((count - 1) << 2);
    if (t + 4 >= row.length) return out;
    const e = t + 4 + clampFrame(Math.max(1, row[t + 1])) * 3;
    if (e + 2 >= row.length) return out;
    const k = Math.max(0, Math.min(count - 1, row[e]));
    if (k > 0 && 2 + ((k - 1) << 2) + 3 >= row.length) return out;
    out.push({ paint: k > 0 ? tint(k) : { kind: "base" }, dx: row[e + 1], dy: row[e + 2] });
    return out;
  }
  if (type === 12) {
    if (row.length < 10 || count < 2) return out;
    const n = Math.max(1, row[5]),
      fc = clampFrame(n),
      a = 8 + fc * 2,
      b = 8 + (n << 1) + fc * 2;
    if (b + 1 >= row.length) return out;
    out.push({
      paint: { kind: "alpha", a: row[3] },
      dx: row[b] + row[a],
      dy: row[a + 1] - row[b + 1],
    });
    out.push({ paint: { kind: "alpha", a: row[2] }, dx: row[a], dy: row[a + 1] });
  }
  return out;
}

const clampByte = (v: number) => Math.max(0, Math.min(255, v));

/**
 * Colours RGBA pixels of the L picture in place. A clear pixel is the picture's `0x00FFFFFF`
 * (`normalizeJavaMeEffectPixels` turned every clear, pure white and pure black pixel into it), so
 * each helper leaves it clear as Java does.
 */
export function paintLEffectPixels(data: Uint8ClampedArray, paint: LEffectPaint): void {
  if (paint.kind === "base") return;
  if (paint.kind === "alpha" && (paint.a < 0 || paint.a > 255)) return;
  const tintAlpha = paint.kind === "tint" && paint.a >= 0 && paint.a <= 255 ? paint.a : 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    switch (paint.kind) {
      case "tint":
        data[i] = paint.r & 0xff;
        data[i + 1] = paint.g & 0xff;
        data[i + 2] = paint.b & 0xff;
        data[i + 3] = tintAlpha;
        break;
      case "adjust":
        data[i] = clampByte(data[i] * paint.multiply + paint.add);
        data[i + 1] = clampByte(data[i + 1] * paint.multiply + paint.add);
        data[i + 2] = clampByte(data[i + 2] * paint.multiply + paint.add);
        break;
      case "alpha":
        if (data[i + 3] === 255 && !data[i] && !data[i + 1] && !data[i + 2]) data[i + 3] = 0;
        else data[i + 3] = paint.a;
        break;
    }
  }
}
