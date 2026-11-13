import type { BattleSide } from "./BattleDefinition";

export type SourceAnimationOwner = "caster" | "target";

export type SourceActorChunk = {
  owner: SourceAnimationOwner;
  kind: "actor";
  effectId: number;
  state: number;
  nextFrame: number;
  baseStateFrame: number;
  baseState: number;
  spriteId: number;
  frameTicks: number[];
};

export type SourceSpecialChunk = {
  owner: SourceAnimationOwner;
  kind: "special";
  effectId: number;
  state: number;
  nextFrame: number;
  baseStateFrame: number;
  baseState: number;
  specialType: number;
};

export type SourceAnimationChunk = SourceActorChunk | SourceSpecialChunk;
export type SourceSkillAnimationDocument = {
  schema: "vqsv-source-skill-animation-v1";
  tickMs: 66;
  chunkWidth: 7;
  actorEffects: { sourceEffectId: number; spriteId: number }[];
  specialEffects: { id: number; type: number; durationTicks: number; values: number[] }[];
  effects: { skillId: number; raw: number[]; chunks: SourceAnimationChunk[] }[];
  /** `bloodRow` 0 (the damage number) and 1 (the miss or status name): `[dx, dy]` per tick, flattened. */
  bloodRows?: number[][];
};

export type SourceActorPlacement = {
  side: BattleSide;
  sprite: number;
  state: number;
  elapsed: number;
};

export type SourceSpecialPlacement = {
  side: BattleSide;
  type: number;
  values: readonly number[];
  elapsed: number;
  duration: number;
};

type RoleFrame = {
  actors: { owner: SourceAnimationOwner; sprite: number; state: number; elapsed: number }[];
  special?: {
    owner: SourceAnimationOwner;
    type: number;
    values: readonly number[];
    elapsed: number;
    duration: number;
  };
  casterState: number;
  targetState: number;
  casterStateElapsed: number;
  targetStateElapsed: number;
};

const sideOf = (owner: SourceAnimationOwner, caster: BattleSide, target: BattleSide): BattleSide =>
  owner === "caster" ? caster : target;

/**
 * Shared effect.mid/speffect.mid player. It expands Java's seven-column chunks into a deterministic
 * 66 ms timeline once, then every battle reads the same projection instead of assigning sprites to
 * individual skills.
 */
export class SourceSkillAnimation {
  private readonly effects = new Map<number, RoleFrame[]>();
  private readonly rawChunks = new Map<number, readonly SourceAnimationChunk[]>();
  private readonly specialRows: ReadonlyMap<
    number,
    SourceSkillAnimationDocument["specialEffects"][number]
  >;

  constructor(readonly document: SourceSkillAnimationDocument) {
    if (document.schema !== "vqsv-source-skill-animation-v1")
      throw new Error(`source-skill-animations.json: unknown schema ${document.schema}`);
    const specials = new Map(document.specialEffects.map((row) => [row.id, row]));
    this.specialRows = specials;
    for (const effect of document.effects)
      if (effect.chunks.length) {
        this.rawChunks.set(effect.skillId, effect.chunks);
        this.effects.set(effect.skillId, this.compile(effect.chunks, specials));
      }
  }

  has(skillId: number): boolean {
    return this.effects.has(skillId);
  }

  totalTicks(skillId: number): number {
    return this.effects.get(skillId)?.length ?? 0;
  }

  frame(
    skillId: number,
    tick: number,
    caster: BattleSide,
    target: BattleSide,
  ):
    | {
        actors: SourceActorPlacement[];
        special?: SourceSpecialPlacement;
        states: Record<BattleSide, number>;
        stateElapsed: Record<BattleSide, number>;
        hidden: BattleSide[];
      }
    | undefined {
    const frames = this.effects.get(skillId);
    if (!frames?.length || tick < 0 || tick >= frames.length) return;
    const source = frames[tick],
      special = source.special
        ? {
            side: sideOf(source.special.owner, caster, target),
            type: source.special.type,
            values: source.special.values,
            elapsed: source.special.elapsed,
            duration: source.special.duration,
          }
        : undefined;
    return {
      actors: source.actors.map((actor) => ({
        side: sideOf(actor.owner, caster, target),
        sprite: actor.sprite,
        state: actor.state,
        elapsed: actor.elapsed,
      })),
      ...(special ? { special } : {}),
      states: {
        [caster]: source.casterState,
        [target]: source.targetState,
      } as Record<BattleSide, number>,
      stateElapsed: {
        [caster]: source.casterStateElapsed,
        [target]: source.targetStateElapsed,
      } as Record<BattleSide, number>,
      hidden: special ? [special.side] : [],
    };
  }

  /** The skill's effect.mid row as its seven-column chunks, uncompiled (`VqsvBattleAnimationTables.effectRow`). */
  chunks(skillId: number): readonly SourceAnimationChunk[] {
    return this.rawChunks.get(skillId) ?? [];
  }

  /** `VqsvBattleAnimationTables.bloodRow(row)`. */
  bloodRow(row: 0 | 1): readonly number[] {
    return this.document.bloodRows?.[row] ?? [];
  }

  /** One speffect.mid row: its AH type, the source duration and the raw values. */
  special(id: number): SourceSkillAnimationDocument["specialEffects"][number] | undefined {
    return this.specialRows.get(id);
  }

  actorSpriteStates(): [number, number][] {
    const pairs = new Map<string, [number, number]>();
    for (const effect of this.document.effects)
      for (const chunk of effect.chunks)
        if (chunk.kind === "actor" && chunk.spriteId >= 0)
          pairs.set(`${chunk.spriteId}/${chunk.state}`, [chunk.spriteId, chunk.state]);
    return [...pairs.values()];
  }

  private compile(
    chunks: readonly SourceAnimationChunk[],
    specials: ReadonlyMap<number, SourceSkillAnimationDocument["specialEffects"][number]>,
  ): RoleFrame[] {
    const frames: RoleFrame[] = [],
      base = { caster: chunks[0]?.owner === "target" ? 1 : 0, target: 0 },
      baseElapsed = { caster: 0, target: 0 },
      carry: {
        owner: SourceAnimationOwner;
        sprite: number;
        state: number;
        elapsed: number;
        left: number;
      }[] = [];
    const push = (
      frame: Omit<RoleFrame, "actors" | "casterStateElapsed" | "targetStateElapsed"> & {
        actors?: RoleFrame["actors"];
      },
    ) => {
      const carried = carry.map(({ owner, sprite, state, elapsed }) => ({
        owner,
        sprite,
        state,
        elapsed,
      }));
      frames.push({
        ...frame,
        casterStateElapsed: baseElapsed.caster,
        targetStateElapsed: baseElapsed.target,
        actors: [...carried, ...(frame.actors ?? [])],
      });
      baseElapsed.caster++;
      baseElapsed.target++;
      for (let index = carry.length - 1; index >= 0; index--) {
        carry[index].elapsed++;
        if (--carry[index].left <= 0) carry.splice(index, 1);
      }
    };

    // Java lets the caster reach frame 1 before an initial target-side actor effect begins.
    if (chunks[0]?.owner === "target")
      for (let gate = 0; gate < 2; gate++)
        push({ casterState: base.caster, targetState: base.target });

    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      if (chunk.kind === "special") {
        const special = specials.get(chunk.effectId),
          duration = Math.max(1, special?.durationTicks ?? 8),
          values = special?.values ?? [];
        base.caster = 0;
        baseElapsed.caster = 0;
        for (let elapsed = 0; elapsed < duration; elapsed++)
          push({
            casterState: base.caster,
            targetState: base.target,
            special: {
              owner: chunk.owner,
              type: special?.type ?? chunk.specialType,
              values,
              elapsed,
              duration,
            },
          });
        continue;
      }

      const ticks = chunk.frameTicks.length
          ? chunk.frameTicks.map((tick) => Math.max(1, tick))
          : [8],
        fullDuration = 1 + ticks.reduce((sum, tick) => sum + tick, 0),
        startOfFrame = (frame: number) =>
          1 + ticks.slice(0, Math.max(0, Math.min(frame, ticks.length))).reduce((a, b) => a + b, 0),
        transition =
          chunk.nextFrame >= 0 && index + 1 < chunks.length
            ? Math.min(fullDuration, startOfFrame(chunk.nextFrame))
            : fullDuration;
      let previousFrame = -1;
      for (let elapsed = 0; elapsed < transition; elapsed++) {
        let cursor = Math.max(0, elapsed - 1),
          frame = 0;
        while (frame < ticks.length - 1 && cursor >= ticks[frame]) cursor -= ticks[frame++];
        if (
          chunk.baseStateFrame >= 0 &&
          frame === chunk.baseStateFrame &&
          frame !== previousFrame
        ) {
          base[chunk.owner] = chunk.baseState;
          baseElapsed[chunk.owner] = 0;
        }
        push({
          casterState: base.caster,
          targetState: base.target,
          actors:
            chunk.spriteId < 0
              ? []
              : [{ owner: chunk.owner, sprite: chunk.spriteId, state: chunk.state, elapsed }],
        });
        previousFrame = frame;
      }
      // P7 preserves a target-side actor when its frame trigger opens the following chunk.
      if (chunk.owner === "target" && transition < fullDuration && chunk.spriteId >= 0)
        carry.push({
          owner: chunk.owner,
          sprite: chunk.spriteId,
          state: chunk.state,
          elapsed: transition,
          left: fullDuration - transition,
        });
    }
    return frames.length
      ? frames
      : [
          {
            actors: [],
            casterState: base.caster,
            targetState: base.target,
            casterStateElapsed: 0,
            targetStateElapsed: 0,
          },
        ];
  }
}
