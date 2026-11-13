import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SkillFx, type SkillFxDocument } from "./SkillFx";

const document = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../public/pack/skill-fx/animations.json"),
    "utf8",
  ),
) as SkillFxDocument;
const fx = new SkillFx(document);
const stage = (targetPlayerSide: boolean) => ({
  player: { x: 70, y: 223 },
  enemy: { x: 177, y: 103 },
  casterPlayerSide: true,
  targetPlayerSide,
});

describe("skill-fx/animations.json", () => {
  it("every Cầu Vồng skill and Phệ Thuẫn U Minh has an effect that draws", () => {
    const keys = [
      ...Array.from({ length: 33 }, (_, n) => `CV-SKILL-${String(n).padStart(2, "0")}`),
      "USER-SKILL-QUY-SHIELD-BREAK",
    ];
    for (const key of keys) {
      expect(fx.has(key)).toBe(true);
      const frames = fx.durations(key);
      expect(frames.length).toBeGreaterThan(0);
      // A frame may be a deliberate blank (CV-SKILL-27's ninth), but every effect draws something.
      const drawn = frames.filter((_, frame) => fx.draws(key, frame, stage(false)).length > 0);
      expect(drawn.length).toBeGreaterThanOrEqual(frames.length - 1);
    }
    expect(fx.document.skills["USER-SKILL-QUY-SHIELD-BREAK"]).toEqual(
      fx.document.skills["CV-SKILL-20"],
    );
  });

  it("times frames by their ticks and ends after the last one", () => {
    const durations = fx.durations("CV-SKILL-00"),
      total = fx.totalTicks("CV-SKILL-00");
    expect(total).toBe(durations.reduce((sum, ticks) => sum + ticks, 0));
    expect(fx.frameAt("CV-SKILL-00", 0)).toBe(0);
    expect(fx.frameAt("CV-SKILL-00", durations[0])).toBe(1);
    expect(fx.frameAt("CV-SKILL-00", total - 1)).toBe(durations.length - 1);
    expect(fx.frameAt("CV-SKILL-00", total)).toBe(-1);
  });

  it("an atlas effect sits on the target's seat, mirrored when the target is on the player side", () => {
    const [onEnemy] = fx.draws("CV-SKILL-00", 0, stage(false)),
      [onPlayer] = fx.draws("CV-SKILL-00", 0, stage(true)),
      [, dx, dy] = document.groups[0].cells[document.groups[0].animations[0][0][0]][0];
    expect([onEnemy.x, onEnemy.y]).toEqual([177 + dx, 103 - 6 + dy]);
    expect(onPlayer.y).toBe(223 - 17 + dy);
    expect(onPlayer.x).toBe(70 - 24 - dx - onPlayer.width);
    expect(onPlayer.transform).not.toBe(onEnemy.transform);
  });

  it("CV-SKILL-32 plays its sheet against the opponent, one frame-high slice at a time", () => {
    const sheet = document.sheets[0],
      [piece] = fx.draws("CV-SKILL-32", 2, stage(false));
    expect(piece.image).toBe("sheet-32");
    expect([piece.sy, piece.width, piece.height]).toEqual([2 * sheet.frameHeight, 91, 80]);
    expect([piece.x, piece.y]).toEqual([
      177 + sheet.anchorX - 177 + sheet.originX,
      103 + sheet.anchorY - 97 + sheet.originY,
    ]);
  });

  it("Lam Tuyền Chữa Lành and Hải Tâm Tái Tạo play over the caster's own seat", () => {
    for (const key of ["CV-SKILL-27", "CV-SKILL-28"]) {
      const [piece] = fx.draws(key, 0, stage(true)),
        entry = document.skills[key] as { group: number; animation: number },
        group = document.groups[entry.group],
        [, , dy] = group.cells[group.animations[entry.animation][0][0]][0];
      expect(piece.y).toBe(223 - 17 + dy);
    }
  });
});
