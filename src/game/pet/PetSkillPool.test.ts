import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PetSkillPoolCatalog,
  skillRowStatus,
  skillStatus,
  type PetSkillPoolDocument,
  type PoolEntry,
} from "./PetSkillPool";

const baked = new PetSkillPoolCatalog(
  JSON.parse(
    readFileSync("public/pack/story/pet-skill-pools.json", "utf8"),
  ) as PetSkillPoolDocument,
);

describe("skill.ui pool (UnifiedSkillLearnsetCatalog, baked)", () => {
  it("bakes a family pool for the Liệt Hỏa and Cầu Vồng species", () => {
    expect(baked.entries(68).length).toBeGreaterThan(0);
    expect(baked.entries(58)[0]).toEqual([30, 1, "a", "Thủy Thượng Phiêu"]);
  });

  it("answers sourceSkillStateAt for the pool tab", () => {
    const pool = new PetSkillPoolCatalog({ pools: {}, canonical: { "900": 30 } }),
      own: PoolEntry = [30, 1, "a", "A"],
      later: PoolEntry = [31, 20, "a", "A"],
      evolved: PoolEntry = [32, 1, "d", "Thủy Long"],
      sibling: PoolEntry = [33, 1, "o", "B"];
    expect(pool.poolState(own, [30], 5)).toBe(0);
    // `sameSkill` compares canonical ids.
    expect(pool.poolState(own, [900], 5)).toBe(0);
    expect(pool.poolState(own, [], 5)).toBe(1);
    expect(pool.poolState(later, [], 5)).toBe(2);
    expect(pool.poolState(evolved, [], 50)).toBe(3);
    expect(pool.poolState(sibling, [], 50)).toBe(4);
    expect(skillStatus(1, true)).toBe("Có thể học lại");
    expect(skillStatus(1, false)).toBe("Đã mở");
    expect(skillStatus(2, true, later)).toBe("Mở Lv.20");
    expect(skillStatus(3, true, evolved)).toBe("Cần Thủy Long");
    expect(skillRowStatus(3, true, evolved)).toBe("Khóa tiến hóa");
    expect(skillStatus(4, true, sibling)).toBe("Khác nhánh");
  });

  it("queues only skills newly unlocked by the evolved form", () => {
    const pool = new PetSkillPoolCatalog({
      pools: {
        "68": [
          [10, 1, "a", "Base"],
          [11, 10, "a", "Base"],
        ],
        "69": [
          [10, 1, "a", "Base"],
          [11, 10, "a", "Base"],
          [12, 20, "a", "Evolved"],
          [13, 30, "a", "Evolved"],
          [14, 1, "d", "Descendant"],
        ],
      },
      canonical: {},
    });
    expect(pool.evolutionCandidates(68, 69, 25, [])).toEqual([12]);
    expect(pool.evolutionCandidates(68, 69, 40, [12])).toEqual([13]);
  });
});
