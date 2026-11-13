import type { SignatureFx, SkillFx } from "./SkillFx";
import type { SourceAnimationChunk, SourceSkillAnimation } from "./SourceSkillAnimation";

/** Which of the action's two pets a piece of the effect belongs to. */
export type DoubleFxRole = "actor" | "target";

/** The three effect sources an action can play, as `BattleRules` loads them. */
export type DoubleFxSources = {
  sourceFx: SourceSkillAnimation;
  fx: SkillFx;
  signatureFx: SignatureFx;
};

/** `P7ActorAnimation`: an actor-effect sprite played once and held on its last frame. */
type ActorAnimation = {
  effectId: number;
  sprite: number;
  state: number;
  ticks: readonly number[];
  cursor: number;
  elapsed: number;
  stopped: boolean;
};

/** speffect.mid AH types `VqsvBattleRenderer.drawP7SpecialEffect` draws. */
const SUPPORTED_SPECIAL = new Set([1, 7, 8, 9, 12]);

/**
 * One 2v2 action's skill effect, `VqsvDoubleBattleRuntime`'s P7 sequence: a Cầu Vồng or
 * pet-design signature skill plays its `RainbowSkillAnimationPlayback`; any other skill walks its
 * effect.mid chunks — an actor-effect sprite over the owning pet (`P7ActorAnimation`, cut short
 * when the chunk's next-frame trigger opens the following chunk) or a speffect.mid transform that
 * replaces the owning pet's draw for its duration. The hit lands on the tick `tick` returns false.
 *
 * A group target's second hit carries no effect row, so its damage lands on the first tick.
 */
export class DoubleActionFx {
  /** The pet the current chunk plays over (`actionEffectSlot`), or null once the effect ended. */
  effectRole: DoubleFxRole | null = null;
  /** The pet a supported speffect transform hides (`actionHidden`). */
  hiddenRole: DoubleFxRole | null = null;
  private readonly chunks: readonly SourceAnimationChunk[];
  private chunk = 0;
  private anim: ActorAnimation | null = null;
  private special: {
    type: number;
    values: readonly number[];
    duration: number;
    ticks: number;
  } | null = null;
  private readonly rainbow: { kind: "skillFx" | "signature"; key: string; total: number } | null;
  private rainbowTick = 0;

  constructor(
    private readonly sources: DoubleFxSources,
    skillId: number,
    stableKey: string | undefined,
    secondary: boolean,
    /** `setActionSpriteState` on one of the two pets. */
    private readonly setState: (role: DoubleFxRole, state: number) => void,
  ) {
    const key = secondary ? undefined : stableKey;
    // `RainbowSkillAnimationPlayback.start`: a signature first, then a Cầu Vồng descriptor.
    this.rainbow = !key
      ? null
      : sources.signatureFx.has(key)
        ? { kind: "signature", key, total: sources.signatureFx.totalTicks(key) }
        : sources.fx.has(key)
          ? { kind: "skillFx", key, total: sources.fx.totalTicks(key) }
          : null;
    this.chunks = secondary ? [] : sources.sourceFx.chunks(skillId);
    if (this.rainbow) {
      this.effectRole = "target";
      setState("actor", 1);
    } else this.enterChunk();
  }

  /** `tickActionEffectSequence`: true while the effect still plays this tick. */
  tick(): boolean {
    if (this.rainbow) {
      if (this.rainbowTick < this.rainbow.total) {
        this.rainbowTick++;
        if (this.rainbowTick < this.rainbow.total) return true;
      }
      this.setState("actor", 0);
      return false;
    }
    if (this.chunk >= this.chunks.length) return false;
    if (this.special) {
      this.special.ticks++;
      if (this.special.ticks <= this.special.duration) return true;
      this.hiddenRole = null;
      return this.advance();
    }
    const anim = this.anim,
      chunk = this.chunks[this.chunk];
    if (!anim) return this.advance();
    if (chunk.baseStateFrame >= 0 && this.atFrame(anim, chunk.baseStateFrame))
      this.setState(this.effectRole!, chunk.baseState);
    if (
      chunk.nextFrame >= 0 &&
      this.atFrame(anim, chunk.nextFrame) &&
      this.chunk + 1 < this.chunks.length
    ) {
      anim.stopped = true;
      return this.advance();
    }
    if (anim.sprite < 0 || anim.cursor >= anim.ticks.length - 1) {
      anim.stopped = true;
      return this.advance();
    }
    // `SpriteAnimator.tickHoldLast`.
    if (++anim.elapsed >= Math.max(1, anim.ticks[anim.cursor])) {
      anim.cursor++;
      anim.elapsed = 0;
    }
    return true;
  }

  /** The actor-effect sprite showing over `effectRole` (`battleP7ActorEffect*`). */
  get actorEffect(): { sprite: number; state: number; cursor: number; sourceId: number } | null {
    const anim = this.anim;
    return anim && !anim.stopped && anim.sprite >= 0
      ? { sprite: anim.sprite, state: anim.state, cursor: anim.cursor, sourceId: anim.effectId }
      : null;
  }

  /** The speffect transform drawn in place of `effectRole`'s pet (`battleP7Special*`). */
  get specialEffect(): {
    type: number;
    values: readonly number[];
    ticks: number;
    duration: number;
  } | null {
    const special = this.special;
    return special && SUPPORTED_SPECIAL.has(special.type) && special.ticks <= special.duration
      ? { ...special }
      : null;
  }

  /** The Cầu Vồng or signature effect and how many ticks it has played (`battleRainbowSkillAnimation`). */
  get rainbowEffect(): { kind: "skillFx" | "signature"; key: string; tick: number } | null {
    const rainbow = this.rainbow;
    return rainbow && this.rainbowTick < rainbow.total
      ? { kind: rainbow.kind, key: rainbow.key, tick: this.rainbowTick }
      : null;
  }

  private atFrame(anim: ActorAnimation, frame: number): boolean {
    return !anim.stopped && anim.cursor === frame;
  }

  private advance(): boolean {
    this.chunk++;
    if (this.chunk >= this.chunks.length) {
      this.anim = null;
      this.special = null;
      this.effectRole = null;
      return false;
    }
    this.enterChunk();
    return true;
  }

  /** `enterActionEffectChunk`. */
  private enterChunk(): void {
    if (this.chunk >= this.chunks.length) {
      this.anim = null;
      this.special = null;
      this.effectRole = null;
      return;
    }
    const chunk = this.chunks[this.chunk];
    this.effectRole = chunk.owner === "target" ? "target" : "actor";
    if (this.chunk === 0 && chunk.owner === "target") this.setState("actor", 1);
    this.anim = null;
    this.special = null;
    if (chunk.kind === "special") {
      const row = this.sources.sourceFx.special(chunk.effectId),
        type = row?.type ?? -1;
      this.special = {
        type,
        values: row?.values ?? [],
        duration: row?.durationTicks ?? 8,
        ticks: 0,
      };
      this.hiddenRole = SUPPORTED_SPECIAL.has(type) ? this.effectRole : null;
      return;
    }
    this.anim = {
      effectId: chunk.effectId,
      sprite: chunk.spriteId,
      state: Math.max(0, chunk.state),
      ticks: chunk.frameTicks.length ? chunk.frameTicks : [1],
      cursor: 0,
      elapsed: 0,
      stopped: false,
    };
  }
}
