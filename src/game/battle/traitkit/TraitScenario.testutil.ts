/**
 * Khung test cho kịch bản đặc tính: dựng một trận 1v1 (`BattleCore`) và một trận 2v2
 * (`DoubleBattleCore`) thật, ra lệnh từng vòng, rồi trả nhật ký kích hoạt của kit (`k.proc`).
 * Chỉ test dùng file này.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { vi } from "vitest";
import type { KitProc } from "./TraitKit";

vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(
    import.meta.dirname,
    "../../../../public",
    decodeURIComponent(String(input).split("?")[0].replace(/^\//, "")),
  );
  if (!existsSync(file)) return { ok: false, status: 404 };
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, "utf8")) };
});

const { GameData } = await import("../../../data/GameData");
const { Pack } = await import("../../../pack/Pack");
const { loadBattleRules } = await import("../BattleRules");
const { BattleRandom } = await import("../BattleRandom");
const { PetStatCalculator } = await import("../PetStatCalculator");
const { BattleServices } = await import("../engine/BattleServices");
const { BattleCore } = await import("../engine/BattleCore");
const { DoubleBattleCore } = await import("../engine/DoubleBattleCore");
const { BasicEnemyAi } = await import("../engine/EnemyController");
const { setTraitTuning } = await import("./TraitKit");
// Test kiểm cơ chế với tham số mặc định đã duyệt, không phụ thuộc số cân bằng trong tuning.json.
setTraitTuning({});
type CombatantSetup = import("../engine/BattleTypes").CombatantSetup;

const data = new GameData(await Pack.load());
export const rules = await loadBattleRules(data);
export const services = await BattleServices.load(data, rules, await PetStatCalculator.load(data));
const species = (await data.species()).rows;
const companionProfile = await data.aiProfileForTier("COMPANION");
const trainerProfile = await data.aiProfileForTier("TRAINER");
const skillRules = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../../public/pack/double-battle/skill-scopes.json"),
    "utf8",
  ),
);

/** Mọi tỉ lệ trạng thái và kit đều qua, không chí mạng, mọi đòn đều trúng. */
class Sure extends BattleRandom {
  override percent(label: string): number {
    return /crit|jitter|hitroll/.test(label) ? 99 : 0;
  }
}

export type PetOptions = {
  /** Chiêu mang theo (id). Mặc định: chiêu loài học được ở cấp 60. */
  skills?: number[];
  /** HP hiện tại, % HP tối đa. */
  hpPct?: number;
  level?: number;
  /** Ghi đè chỉ số (sau khi tính theo cấp). */
  stats?: Partial<{ hp: number; attack: number; defense: number; speed: number }>;
};

/** Một pet cấp 60 phẩm chất 4 (mặc định), như mô phỏng cân bằng. */
export function pet(speciesId: number, options: PetOptions = {}): CombatantSetup {
  const base = services.encounterPet(speciesId, options.level ?? 60, 4);
  const stats = { ...base.stats, ...options.stats };
  return {
    ...base,
    stats,
    skillIds: options.skills ?? base.skillIds,
    hp:
      options.hpPct === undefined
        ? undefined
        : Math.max(1, Math.trunc((stats.hp * options.hpPct) / 100)),
  };
}

/** Pet đánh rất yếu, rất trâu: để trận kéo dài nhiều vòng. */
export function dummy(speciesId = 34, options: PetOptions = {}): CombatantSetup {
  return pet(speciesId, {
    skills: [30],
    ...options,
    stats: { attack: 1, hp: 99999, ...options.stats },
  });
}

type Core = { projection: { kit: { log: KitProc[] } } };

export type ScenarioResult = {
  log: KitProc[];
  /** Nhãn kích hoạt của loài `speciesId` (phe người chơi mặc định). */
  procs(speciesId: number, side?: number): string[];
  core: unknown;
};

function result(core: unknown): ScenarioResult {
  const log = (core as Core).projection.kit.log;
  return {
    log,
    core,
    procs: (speciesId, side = 0) =>
      log.filter((p) => p.speciesId === speciesId && p.side === side).map((p) => p.label),
  };
}

/**
 * Trận 1v1: người chơi dùng chiêu ở ô `slots[i]` (0-based trong `skills`) mỗi vòng; đối thủ do AI cơ
 * bản điều khiển. Phe người chơi là side 0.
 */
export function duel(
  player: CombatantSetup[],
  enemy: CombatantSetup[],
  slots: number[],
): ScenarioResult {
  const core = new BattleCore(
    rules,
    { items: services.items, relationClass: (id: number) => species[id]?.relationClass ?? 0 },
    { format: "1v1", kind: "trainer", player, enemy },
    new Sure(),
    new BasicEnemyAi(rules),
  );
  core.start();
  for (const slot of slots) {
    answerChoices(core);
    if (core.request.kind === "command") core.submit({ kind: "skill", slot });
    answerChoices(core);
  }
  return result(core);
}

/**
 * 1v1: trả lời bước chọn pet (đổi pet sau chiêu Chuyển, thay pet gục) bằng pet dự bị còn sống đầu
 * tiên trong đội.
 */
function answerChoices(core: InstanceType<typeof BattleCore>): void {
  for (let guard = 0; guard < 4; guard++) {
    const kind = core.request.kind;
    if (kind !== "pivot" && kind !== "replacement") return;
    let answered = false;
    for (let member = 0; member < 6 && !answered; member++) {
      try {
        core.submit({ kind: "member", member });
        answered = true;
      } catch {
        // pet đang trên sân, đã gục hoặc không có: thử pet kế
      }
    }
    if (!answered) return;
  }
}

/** Ô trên sân 2v2: 0 và 1 là đối thủ, 2 và 3 là phe người chơi. */
export type DoubleSlot = 0 | 1 | 2 | 3;

/**
 * Trận 2v2 người chơi điều khiển cả hai pet: `rounds[i]` là [lệnh pet ô 2, lệnh pet ô 3], mỗi lệnh là
 * [ô chiêu, ô mục tiêu]. `player[0]` đứng ô 2, `player[1]` ô 3. Đối thủ do AI huấn luyện viên.
 */
export function double(
  player: CombatantSetup[],
  enemy: CombatantSetup[],
  rounds: [number, DoubleSlot][][],
): ScenarioResult {
  const core = new DoubleBattleCore(
    rules,
    { items: services.items, skillRules, rulebook: services.rulebook, catalog: services.catalog },
    {
      controlsBoth: true,
      player,
      companion: [],
      enemy,
      enemyProfile: trainerProfile,
      companionProfile,
    },
    new Sure(),
  );
  core.start();
  for (const orders of rounds)
    for (const [skillIndex, target] of orders)
      if (core.request.kind === "command") core.submit({ kind: "skill", skillIndex, target });
  return result(core);
}

/** Id chiêu theo tên (đúng chữ, không phân biệt hoa thường). */
export function skillId(name: string): number {
  const row = skillRows.find((r) => r.name.toLowerCase() === name.toLowerCase());
  if (!row) throw new Error(`không có chiêu "${name}"`);
  return row.skillId;
}
const skillRows = (await data.skillRows()).rows;
