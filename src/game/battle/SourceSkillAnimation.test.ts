import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SourceSkillAnimation, type SourceSkillAnimationDocument } from "./SourceSkillAnimation";

const document = JSON.parse(
  await readFile(
    resolve(import.meta.dirname, "../../../public/pack/data/battle/source-skill-animations.json"),
    "utf8",
  ),
) as SourceSkillAnimationDocument;
const animation = new SourceSkillAnimation(document);

describe("source effect.mid/speffect.mid animation", () => {
  it("ships every Java row and the generic AH actor mapping", () => {
    expect(document.effects).toHaveLength(70);
    expect(document.specialEffects).toHaveLength(34);
    expect(document.actorEffects).toEqual(
      [262, 263, 264, 265, 266, 267, 268, 299, 300, 301, 304, 306, 307, 308, 309].map(
        (spriteId, index) => ({ sourceEffectId: index + 20, spriteId }),
      ),
    );
  });

  it("plays a single actor chunk from the exported frame timing", () => {
    expect(document.effects[0].raw).toEqual([0, 0, 20, 0, -1, -1, 0]);
    const frames = Array.from({ length: animation.totalTicks(0) }, (_, tick) =>
      animation.frame(0, tick, "player", "enemy"),
    );
    expect(frames.some((frame) => frame?.actors.some((actor) => actor.sprite === 262))).toBe(true);
    expect(frames.every((frame) => frame?.special === undefined)).toBe(true);
  });

  it("walks multi-chunk skills into their speffect instead of stopping at chunk zero", () => {
    const specials = (skillId: number) =>
      Array.from(
        { length: animation.totalTicks(skillId) },
        (_, tick) => animation.frame(skillId, tick, "player", "enemy")?.special?.type,
      ).filter((type): type is number => type !== undefined);
    expect(specials(2)).toContain(9);
    expect(specials(21)).toContain(9);
    expect(specials(41)).toContain(7);
    expect(animation.totalTicks(2)).toBeGreaterThan(animation.totalTicks(0));
  });

  it("uses chunk ownership for caster-side and target-side effects", () => {
    const bunnyFrames = Array.from({ length: animation.totalTicks(21) }, (_, tick) =>
      animation.frame(21, tick, "player", "enemy"),
    );
    expect(
      bunnyFrames.some((frame) =>
        frame?.actors.some((actor) => actor.sprite === 264 && actor.side === "enemy"),
      ),
    ).toBe(true);
    expect(bunnyFrames.some((frame) => frame?.special?.side === "player")).toBe(true);
  });

  it("resets a changed base pose once, then advances it by authored frame duration", () => {
    const player = new SourceSkillAnimation({
      schema: "vqsv-source-skill-animation-v1",
      tickMs: 66,
      chunkWidth: 7,
      actorEffects: [],
      specialEffects: [],
      effects: [
        {
          skillId: 999,
          raw: [],
          chunks: [
            {
              owner: "caster",
              kind: "actor",
              effectId: 0,
              state: 0,
              nextFrame: -1,
              baseStateFrame: 1,
              baseState: 4,
              spriteId: -1,
              frameTicks: [2, 3],
            },
          ],
        },
      ],
    });
    expect(player.frame(999, 3, "player", "enemy")?.states.player).toBe(4);
    expect(player.frame(999, 3, "player", "enemy")?.stateElapsed.player).toBe(0);
    expect(player.frame(999, 4, "player", "enemy")?.stateElapsed.player).toBe(1);
  });
});
