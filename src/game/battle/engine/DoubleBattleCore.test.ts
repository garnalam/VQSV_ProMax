import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

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
const { BattleAiRulebook } = await import("../ai/BattleAiRulebook");
const { BattleAiEncounterCatalog } = await import("../ai/BattleAiEncounterCatalog");
const { BattleItems } = await import("./BattleItems");
const { DoubleBattleCore } = await import("./DoubleBattleCore");

type GoldenUnit = {
  speciesId: number;
  level: number;
  nature: number;
  quality: number;
  spriteId: number;
  physicalTraitId: number;
  heldItemId: number;
  base: { hp: number; attack: number; defense: number; speed: number };
  hp: number;
  skillIds: number[];
  skillPp: number[];
};
type GoldenScenario = {
  name: string;
  symbol: string;
  seed: number;
  controlsBoth: boolean;
  result: number;
  units: { enemy: GoldenUnit[]; player: GoldenUnit[]; companion: GoldenUnit[] };
  trace: string[];
};

const root = resolve(import.meta.dirname, "../../../../public/pack");
const golden = JSON.parse(
  readFileSync(resolve(root, "double-battle/golden-double-battle.json"), "utf8"),
) as { scenarios: GoldenScenario[] };
const skillRules = JSON.parse(
  readFileSync(resolve(root, "double-battle/skill-scopes.json"), "utf8"),
);

const data = new GameData(await Pack.load());
const rules = await loadBattleRules(data, { traitScripts: false }); // golden: đặc tính cũ, không kit
const rulebook = await BattleAiRulebook.load(data);
const catalog = await BattleAiEncounterCatalog.load(data);
const items = new BattleItems(await data.items());
const descriptors = await data.battleEvents();
const companionProfile = await data.aiProfileForTier("COMPANION");
const trainerProfile = await data.aiProfileForTier("TRAINER");
/** `ProbeWebDoubleBattle.TAN_NGUYET`: the boss fight, built from `TanNguyetLongMaBossRuntime.battleRequest()`. */
const TAN_NGUYET = "TAN_NGUYET_LONG_MA";

const combatant = (unit: GoldenUnit) => ({
  speciesId: unit.speciesId,
  level: unit.level,
  quality: unit.quality,
  nature: unit.nature,
  stats: { ...unit.base },
  hp: unit.hp,
  skillIds: unit.skillIds,
  skillPp: unit.skillPp,
  physicalTraitId: unit.physicalTraitId,
  heldItemId: unit.heldItemId,
  spriteId: unit.spriteId,
});

const field = (line: string, key: string) => line.match(new RegExp(`\\b${key}=(-?\\w+)`))?.[1];
const num = (line: string, key: string) => Number(field(line, key));

/** Replays one golden fight: the recorded player commands and replacements into the web core. */
function replay(scenario: GoldenScenario) {
  const random = new BattleRandom(BigInt(scenario.seed)),
    core = new DoubleBattleCore(
      rules,
      { items, skillRules, rulebook, catalog },
      {
        controlsBoth: scenario.controlsBoth,
        player: scenario.units.player.map(combatant),
        companion: scenario.units.companion.map(combatant),
        enemy: scenario.units.enemy.map(combatant),
        // The boss request carries `BattleAiProfile.defaultFor(true)` and no AI-v2 encounter.
        enemyProfile:
          scenario.symbol === TAN_NGUYET ? trainerProfile : descriptors[scenario.symbol].aiProfile,
        companionProfile,
        encounterKey:
          scenario.symbol === TAN_NGUYET
            ? undefined
            : catalog.keyForDescriptorSymbol(scenario.symbol),
        permanentStatsApplied: true,
        boss: scenario.symbol === TAN_NGUYET ? "tan-nguyet-long-ma" : undefined,
      },
      random,
    ),
    commands = scenario.trace.filter((line) =>
      line.startsWith("PORTED source op54 player command"),
    ),
    replacements = scenario.trace.filter(
      (line) =>
        line.startsWith("PORTED source op54 P15 replacement") &&
        num(line, "slot") >= 2 &&
        (scenario.controlsBoth || num(line, "slot") === 2),
    );
  let error: unknown;
  try {
    core.start();
    for (let guard = 0; guard < 400 && core.request.kind !== "ended"; guard++) {
      const request = core.request;
      if (request.kind === "command") {
        const line = commands.shift();
        if (!line || num(line, "slot") !== request.slot) break;
        const unit = core.unit(request.slot),
          skillIndex = unit.skillIds.indexOf(num(line, "skill"));
        core.submit({
          kind: "skill",
          skillIndex,
          target: num(line, "targetSlot") as 0 | 1 | 2 | 3,
        });
      } else if (request.kind === "replacement") {
        const line = replacements.shift();
        if (!line) break;
        const species = num(line, "newSpecies");
        let member = -1;
        for (let index = 0; index < core.playerCount && member < 0; index++)
          if (core.playerUnit(index).speciesId === species && core.playerUnit(index).alive())
            member = index;
        core.submit({ kind: "member", member });
      }
    }
  } catch (thrown) {
    error = thrown;
  }
  return { core, random, error };
}

function strikesOf(scenario: GoldenScenario) {
  return scenario.trace
    .filter((line) => line.startsWith("PORTED/PARTIAL source op54 P7 damage"))
    .map(
      (line) =>
        `a${num(line, "actorSlot")}>r${num(line, "damageReceiverSlot")} s${num(line, "skill")} ` +
        `${field(line, "hit")} d${num(line, "damage")} hp${num(line, "targetHp")}`,
    );
}

const outcomeOf = (core: { request: { kind: string; outcome?: { winner: string } } }) => {
  try {
    return core.request.kind === "ended" ? core.request.outcome!.winner : core.request.kind;
  } catch {
    return "no request";
  }
};
const valueOf = (draw: string) => draw.slice(draw.lastIndexOf("=") + 1);

/**
 * How far each recorded Java fight replays identically: strikes (actor, receiver, skill, hit, damage,
 * target HP), battle draws (value by value, in order) and the AI-v2 joint rounds (selected pair and
 * both utilities, character for character).
 *
 * Every fight stays identical until the first place where the web status rules — which 2v2 runs
 * exactly as 1v1 does, by the owner's decision — part from JavaSE 2v2:
 *  - a Cầu Vồng/V4 skill's status: Java rolls `unified.skill.<key>.effect` before the crit roll and
 *    asks the characteristic only when it lands; the web rules roll the characteristic and the status
 *    after the hit (soldiers-a/b: the V4-SKILL-15 Xé Rách lands on the web side only);
 *  - round passes: Java ticks all four slots at the round start, the web ticks each pet at the start
 *    of its own action, so a status can age a round apart (gym-pasili/leader: the joint planner then
 *    sees different statuses on round four);
 *  - Mị Hoặc's −15%: the web applies it with the other status percents, before the relation and the
 *    jitter, Java after the plan (gym-larry: 96 against 97 with every draw identical).
 * gym-leader's thirteenth strike is the group target's second hit at 75% Power, which matches.
 *
 * The two Tàn Nguyệt Long Ma fights (Ma Mộc Cộng Sinh) part at the same first rule: the boss opens
 * with Toản Tinh Liệt Phá (V4-SKILL-08), whose status Java rolls before the crit, so every draw value
 * still matches in order (129 of the level-100 fight's) while the hit roll of Hoa Tiên Tử's second
 * strike reads another one. Up to there the boss rules match number for number: the Ma Mộc reduction
 * (542→460), Hoa's fire neutrality (896→298), the boss sweep of both player slots at 100% Power, and
 * the first six drains with Hoa's once-a-round share (157/47, 72, 157/47, 72).
 *
 * The counts are a floor: a change that moves the first divergence earlier is a regression.
 */
const FLOOR: Record<string, { strikes: number; draws: number; joint: number; boss?: number }> = {
  "soldiers-a": { strikes: 3, draws: 21, joint: 1 },
  "soldiers-b": { strikes: 2, draws: 23, joint: 1 },
  "gym-larry": { strikes: 7, draws: 47, joint: 2 },
  "gym-pasili": { strikes: 9, draws: 84, joint: 3 },
  "gym-leader": { strikes: 13, draws: 102, joint: 3 },
  "tan-nguyet-50": { strikes: 3, draws: 17, joint: 0, boss: 0 },
  "tan-nguyet-100": { strikes: 4, draws: 129, joint: 0, boss: 6 },
};

describe("DoubleBattleCore replays the Java 2v2 golden", () => {
  it("resolves a unified signature turned back on its caster by Quỷ Mị in 2v2", () => {
    const base = combatant(golden.scenarios[0].units.player[0]);
    const caster = { ...base, speciesId: 13, level: 90, skillIds: [1021], skillPp: [10] };
    const ordinary = { ...base, speciesId: 68, skillIds: [40], skillPp: [10] };
    const random = new BattleRandom(7n);
    const percent = random.percent.bind(random);
    random.percent = (label) => (label.includes("status.selfHit.8") ? 0 : percent(label));
    const core = new DoubleBattleCore(
      rules,
      { items, skillRules, rulebook, catalog },
      {
        controlsBoth: true,
        player: [caster, ordinary],
        companion: [],
        enemy: [ordinary, ordinary],
        enemyProfile: trainerProfile,
        companionProfile,
      },
      random,
    );
    core.start();
    rules.status.pendingDebuffFromProducer(core.unit(0), core.unit(2), 54, 8)!.commit();
    core.submit({ kind: "skill", skillIndex: 0, target: 0 });
    core.submit({ kind: "skill", skillIndex: 0, target: 0 });
    expect(core.events).toContainEqual(
      expect.objectContaining({
        type: "strike",
        skillId: 1021,
        slot: 2,
        target: 2,
        receiver: 2,
      }),
    );
  });

  it("pays Hoàng Kim reserve EXP at thirty percent while item six keeps the whole share", () => {
    const base = combatant(golden.scenarios[0].units.player[0]);
    const pet = (extra = {}) => ({
      ...base,
      speciesId: 68,
      level: 10,
      quality: 2,
      nature: 2,
      hp: 10000,
      physicalTraitId: -1,
      heldItemId: -1,
      skillIds: [0],
      skillPp: [99],
      stats: { hp: 10000, attack: 10000, defense: 100, speed: 1000 },
      ...extra,
    });
    const core = new DoubleBattleCore(
      rules,
      { items, skillRules, rulebook, catalog },
      {
        controlsBoth: true,
        goldenPartyExperiencePercent: 30,
        player: [pet(), pet(), pet(), pet({ heldItemId: 6 }), pet({ hp: 0 })],
        companion: [],
        enemy: [pet({ hp: 1 }), pet({ hp: 1 })],
        enemyProfile: trainerProfile,
        companionProfile,
      },
      new BattleRandom(7n),
    );
    core.start();
    for (let guard = 0; guard < 12 && core.request.kind === "command"; guard++) {
      core.submit({ kind: "skill", skillIndex: 0, target: core.unit(0).alive() ? 0 : 1 });
    }
    expect(core.request.kind).toBe("ended");
    if (core.request.kind !== "ended") return;
    const outcome = core.request.outcome;
    expect(outcome.experience[0]).toBeGreaterThan(0);
    expect(outcome.reserveExperience[2]).toBe(
      Math.trunc(((outcome.experience[0] / 2) * 30) / 100) * 2,
    );
    expect(outcome.reserveExperience[3]).toBe(outcome.experience[0]);
    expect(outcome.reserveExperience[4]).toBe(0);
  });

  for (const scenario of golden.scenarios)
    it(`${scenario.name} stays identical up to the first web-status-rule divergence`, () => {
      const { core, random, error } = replay(scenario),
        // Java traces "P7 damage" only for a skill on the damage route; a zero-Power buff or heal
        // completes without one.
        mine = core.events.flatMap((event) =>
          event.type === "strike" && (rules.damage.skillRow(event.skillId)?.powerPercent ?? 0) > 0
            ? [
                `a${event.slot}>r${event.receiver} s${event.skillId} ${event.hit} d${event.damage} hp${event.receiverHp}`,
              ]
            : [],
        ),
        java = strikesOf(scenario),
        javaDraws = scenario.trace
          .filter((line) => line.startsWith("RNG ") && !line.startsWith("RNG fallback"))
          .map((line) => line.slice(4)),
        webDraws = random.draws(),
        javaJoint = scenario.trace
          .filter((line) => line.includes("AI-V2-C simultaneous 2v2 joint round"))
          .map((line) =>
            line
              .replace(/.*joint round encounter=\S+ /, "joint round ")
              .replace(/ controlsGameplay=\w+/, ""),
          ),
        webJoint = core.jointTrace.filter((line) => line.startsWith("joint round"));
      let strikes = 0;
      while (strikes < java.length && mine[strikes] === java[strikes]) strikes++;
      let draws = 0;
      while (
        draws < javaDraws.length &&
        draws < webDraws.length &&
        valueOf(javaDraws[draws]) === valueOf(webDraws[draws])
      )
        draws++;
      let joint = 0;
      while (joint < javaJoint.length && javaJoint[joint] === webJoint[joint]) joint++;
      // The boss beats (`CUSTOM-BOSS ...`), in order: what each drain healed and Hoa's share.
      const javaBoss = scenario.trace.flatMap((line) => {
          if (line.startsWith("CUSTOM-BOSS life-steal")) return [`steal ${num(line, "healed")}`];
          if (line.startsWith("CUSTOM-BOSS Ma Mộc shared heal"))
            return [`share ${field(line, "heal")}`];
          if (line.startsWith("CUSTOM-BOSS Ma Mộc ended")) return ["enrage"];
          if (line.startsWith("CUSTOM-BOSS revive")) return [`revive ${num(line, "hp")}`];
          return [];
        }),
        webBoss = core.events.flatMap((event) =>
          event.type === "lifeSteal"
            ? [`steal ${event.amount}`, ...(event.shared > 0 ? [`share ${event.shared}`] : [])]
            : event.type === "bossEnrage"
              ? ["enrage"]
              : event.type === "bossRevive"
                ? [`revive ${event.hp}`]
                : [],
        );
      let boss = 0;
      while (boss < javaBoss.length && javaBoss[boss] === webBoss[boss]) boss++;
      if (process.env.DBG_DOUBLE === scenario.name) {
        console.log(
          `${scenario.name}: strikes ${strikes}/${java.length} draws ${draws}/${javaDraws.length} joint ${joint}/${javaJoint.length} boss ${boss}/${javaBoss.length} outcome ${outcomeOf(core)} ${error ? String(error) : ""}`,
        );
        for (let i = 0; i < Math.max(javaBoss.length, webBoss.length); i++)
          console.log(
            "B",
            String(i).padStart(3),
            (javaBoss[i] ?? "-").padEnd(20),
            webBoss[i] ?? "-",
          );
        for (let i = 0; i < Math.max(java.length, mine.length); i++)
          console.log("S", String(i).padStart(3), (java[i] ?? "-").padEnd(50), mine[i] ?? "-");
        for (let i = 0; i < Math.max(javaDraws.length, webDraws.length); i++)
          console.log(String(i).padStart(3), (javaDraws[i] ?? "-").padEnd(70), webDraws[i] ?? "-");
      }
      const floor = FLOOR[scenario.name];
      expect(strikes).toBeGreaterThanOrEqual(floor.strikes);
      expect(draws).toBeGreaterThanOrEqual(floor.draws);
      expect(joint).toBeGreaterThanOrEqual(floor.joint);
      expect(boss).toBeGreaterThanOrEqual(floor.boss ?? 0);
    });
});
