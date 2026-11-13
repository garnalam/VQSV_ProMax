/**
 * The Cầu Vồng skill effects (`skill-fx/animations.json`, baked by `scripts/bake-skill-fx.mjs`), and
 * where `VqsvBattleRenderer.drawRainbowSkillAnimation` / `drawVqsv4SkillAnimation` put each piece.
 * This module only answers geometry and timing; the renderer draws the commands it returns.
 */

/** One atlas group: frames `[x, y, w, h]`, cells `[frame, dx, dy, transform]`, animations `[cell, ticks]`. */
export type SkillFxGroup = {
  id: number;
  image: string;
  frames: number[][];
  cells: number[][][];
  animations: number[][][];
};

/** One vertical sheet: equal frames stacked top to bottom, ticks already in game ticks. */
export type SkillFxSheet = {
  id: string;
  image: string;
  frameWidth: number;
  frameHeight: number;
  durationTicks: number[];
  anchor: "caster" | "opponent";
  anchorX: number;
  anchorY: number;
  originX: number;
  originY: number;
  globalTransform: number;
};

export type SkillFxDocument = {
  schema: "vqsv-web-skill-fx-v1";
  groups: SkillFxGroup[];
  sheets: SkillFxSheet[];
  skills: Record<string, { group: number; animation: number } | { sheet: string }>;
  flipToCaster: string[];
};

/**
 * The two seats' anchor points (`p7ActorX/Y`), and which side cast and which side is hit. A 2v2
 * names the caster's and the target's formation slots instead, which may stand on one side.
 */
export type SkillFxStage = {
  player: { x: number; y: number };
  enemy: { x: number; y: number };
  caster?: { x: number; y: number };
  target?: { x: number; y: number };
  casterPlayerSide: boolean;
  targetPlayerSide: boolean;
};

/** One piece to draw: a source rectangle of a pack image, its MIDP transform and its top-left. */
export type SkillFxDraw = {
  image: string;
  sx: number;
  sy: number;
  width: number;
  height: number;
  /** `MidpTransform` 0..7. */
  transform: number;
  x: number;
  y: number;
};

/** The source's transform encoding → `MidpTransform`, as both draw paths index it. */
const SOURCE_TO_MIDP = [0, 5, 3, 6, 2, 4, 1, 7];

/** `MidpTransform` 4..7 swap the axes. */
export function swapsAxes(transform: number): boolean {
  return transform >= 4;
}

/**
 * The canvas matrix `(a, b, c, d, e, f)` that draws a `width × height` region with a MIDP transform,
 * its result's top-left at the origin — the pixel mapping of `MidpTransform.transform`.
 */
export function midpMatrix(
  transform: number,
  width: number,
  height: number,
): [number, number, number, number, number, number] {
  switch (transform) {
    case 1: // MIRROR_ROT180
      return [1, 0, 0, -1, 0, height];
    case 2: // MIRROR
      return [-1, 0, 0, 1, width, 0];
    case 3: // ROT180
      return [-1, 0, 0, -1, width, height];
    case 4: // MIRROR_ROT270
      return [0, 1, 1, 0, 0, 0];
    case 5: // ROT90
      return [0, 1, -1, 0, height, 0];
    case 6: // ROT270
      return [0, -1, 1, 0, 0, width];
    case 7: // MIRROR_ROT90
      return [0, -1, -1, 0, height, width];
    default:
      return [1, 0, 0, 1, 0, 0];
  }
}

export class SkillFx {
  private readonly sheets: Map<string, SkillFxSheet>;
  constructor(readonly document: SkillFxDocument) {
    if (document.schema !== "vqsv-web-skill-fx-v1")
      throw new Error(`skill-fx/animations.json: unknown schema ${document.schema}`);
    this.sheets = new Map(document.sheets.map((sheet) => [sheet.id, sheet]));
  }

  has(stableKey: string): boolean {
    return stableKey in this.document.skills;
  }

  /** The effect's per-frame ticks, in game ticks. */
  durations(stableKey: string): number[] {
    const entry = this.document.skills[stableKey];
    if (!entry) return [];
    if ("sheet" in entry) return [...(this.sheets.get(entry.sheet)?.durationTicks ?? [])];
    return (this.document.groups[entry.group]?.animations[entry.animation] ?? []).map(
      (frame) => frame[1],
    );
  }

  /** How long the effect plays: the action's damage lands when it ends. */
  totalTicks(stableKey: string): number {
    return this.durations(stableKey).reduce((sum, ticks) => sum + ticks, 0);
  }

  /** `RainbowSkillAnimationPlayback`: the frame showing `tick` game ticks in, or -1 once it ended. */
  frameAt(stableKey: string, tick: number): number {
    let elapsed = 0;
    const durations = this.durations(stableKey);
    for (let frame = 0; frame < durations.length; frame++) {
      elapsed += durations[frame];
      if (tick < elapsed) return frame;
    }
    return -1;
  }

  /** The pieces of frame `frame`, placed against the caster and the target the way Java places them. */
  draws(stableKey: string, frame: number, stage: SkillFxStage): SkillFxDraw[] {
    const entry = this.document.skills[stableKey];
    if (!entry || frame < 0) return [];
    if ("sheet" in entry) {
      const sheet = this.sheets.get(entry.sheet);
      return sheet ? [this.sheetDraw(sheet, frame, stage)] : [];
    }
    const group = this.document.groups[entry.group],
      step = group?.animations[entry.animation]?.[frame];
    if (!group || !step) return [];
    // The heals CV-SKILL-27/28 always play over the caster's own seat (Java put them over the opposite
    // seat; the web build draws a heal where the pet it heals stands).
    const mirrored = stage.targetPlayerSide,
      overPlayer = this.document.flipToCaster.includes(stableKey)
        ? stage.casterPlayerSide
        : stage.targetPlayerSide,
      onCasterSeat = this.document.flipToCaster.includes(stableKey),
      seat =
        (onCasterSeat ? stage.caster : stage.target) ?? (overPlayer ? stage.player : stage.enemy),
      anchorX = seat.x + (overPlayer ? -24 : 0),
      anchorY = seat.y + (overPlayer ? -17 : -6),
      out: SkillFxDraw[] = [];
    for (const [frameId, dx, dy, sourceTransform] of group.cells[step[0]] ?? []) {
      const region = group.frames[frameId];
      if (!region) continue;
      const [sx, sy, width, height] = region,
        flipped = mirrored ? (mod8(sourceTransform) + 4) % 8 : mod8(sourceTransform),
        transform = SOURCE_TO_MIDP[flipped],
        drawnWidth = swapsAxes(transform) ? height : width;
      let x = anchorX + dx * (mirrored ? -1 : 1);
      if (mirrored) x -= drawnWidth;
      out.push({ image: group.image, sx, sy, width, height, transform, x, y: anchorY + dy });
    }
    return out;
  }

  /** `drawVqsv4SkillAnimation`: one sheet frame, anchored on the caster or the opponent. */
  private sheetDraw(sheet: SkillFxSheet, frame: number, stage: SkillFxStage): SkillFxDraw {
    const onCaster = sheet.anchor === "caster",
      playerSide = onCaster ? stage.casterPlayerSide : stage.targetPlayerSide,
      seat = (onCaster ? stage.caster : stage.target) ?? (playerSide ? stage.player : stage.enemy),
      baseX = onCaster ? 46 : 177,
      baseY = onCaster ? 206 : 97,
      offsetX = sheet.anchorX - baseX + sheet.originX,
      offsetY = sheet.anchorY - baseY + sheet.originY,
      mirrored = playerSide !== onCaster,
      transform = SOURCE_TO_MIDP[mod8(sheet.globalTransform + (mirrored ? 4 : 0))],
      drawnWidth = swapsAxes(transform) ? sheet.frameHeight : sheet.frameWidth;
    return {
      image: sheet.image,
      sx: 0,
      sy: frame * sheet.frameHeight,
      width: sheet.frameWidth,
      height: sheet.frameHeight,
      transform,
      x: mirrored ? seat.x - offsetX - drawnWidth : seat.x + offsetX,
      y: seat.y + offsetY,
    };
  }
}

function mod8(value: number): number {
  return ((value % 8) + 8) % 8;
}

/** `signature-vfx.tsv`: per pet-design signature, its length and its timed sprite events. */
export type SignatureFxDocument = {
  schema: "vqsv-web-signature-fx-v1";
  skills: Record<
    string,
    { duration: number; events: [number, number, "caster" | "target", number, number][] }
  >;
};

/** One world sprite animation a signature effect is playing, `elapsed` ticks since it started. */
export type SignatureFxSprite = {
  sprite: number;
  state: number;
  elapsed: number;
  onCaster: boolean;
};

/**
 * `SignatureSkillAnimationCatalog`: a signature effect is a list of world sprite animations, each played
 * once from its start tick and held on its last frame until its end tick, over the caster or the target.
 */
export class SignatureFx {
  constructor(readonly document: SignatureFxDocument) {
    if (document.schema !== "vqsv-web-signature-fx-v1")
      throw new Error(`skill-fx/signatures.json: unknown schema ${document.schema}`);
  }
  has(stableKey: string): boolean {
    return stableKey in this.document.skills;
  }
  /** How long the action plays; the hit lands when it ends. */
  totalTicks(stableKey: string): number {
    return this.document.skills[stableKey]?.duration ?? 0;
  }
  /** The events showing `tick` ticks into the action. */
  active(stableKey: string, tick: number): SignatureFxSprite[] {
    return (this.document.skills[stableKey]?.events ?? [])
      .filter(([, , , start, end]) => tick >= start && tick < end)
      .map(([sprite, state, anchor, start]) => ({
        sprite,
        state,
        elapsed: tick - start,
        onCaster: anchor === "caster",
      }));
  }
  /** Every sprite state any signature plays, so they can be loaded ahead of the fight. */
  spriteStates(): [number, number][] {
    const seen = new Map<string, [number, number]>();
    for (const { events } of Object.values(this.document.skills))
      for (const [sprite, state] of events) seen.set(`${sprite}.${state}`, [sprite, state]);
    return [...seen.values()];
  }
}
