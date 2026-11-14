import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  WorldEncounterEngine,
  qualityForRoll,
  type EncounterRandom,
  type WorldEncountersDocument,
} from "./WorldEncounterEngine";

const doc = JSON.parse(
  readFileSync("public/pack/story/world-encounters.json", "utf8"),
) as WorldEncountersDocument;

/** The scripted LCG the JavaSE probe drove `WorldEncounterEngine` with. */
function scripted(): EncounterRandom {
  let x = 12345n;
  const draw = () => {
    x = (x * 1103515245n + 12345n) & 0x7fffffffn;
    return Number(x);
  };
  return {
    entry: (_label, bound) => draw() % bound,
    inclusive: (_label, min, max) => min + (draw() % (max - min + 1)),
  };
}

describe("WorldEncounterEngine (JavaSE golden)", () => {
  it("replays JavaSE's own run over the same scripted stream, step for step", () => {
    // Written by EncounterProbe.java against the packaged JavaSE engine and catalogs.
    const golden = readFileSync("src/game/world/WorldEncounterEngine.golden.txt", "utf8")
      .trim()
      .split(/\r?\n/);
    const engine = new WorldEncounterEngine(doc, scripted()),
      cases = [
        [1, 1, 0, 1],
        [1, 2, 0, 3],
        [1, 4, 0, 15],
        [4, 1, 0, 25],
        [98, 3, 0, 30],
        [98, 10, 2, 44],
        [2, 0, 0, 47],
        [1, 1, 3, 1],
      ],
      lines: string[] = [];
    for (const [scene, room, terrain, task] of cases) {
      let state = {
        temporaryActorTicks: 0,
        avoidMonsterTicks: scene === 1 && room === 2 ? 3 : 0,
        encounterStepsRemaining: -1,
      };
      for (let i = 0; i < 400; i++) {
        const r = engine.afterSuccessfulMovement(
          {
            timersEnabled: true,
            scene,
            room,
            rideSuppressesEncounters: false,
            mainTaskProgress: task,
            rareEncounterBonusPercent: 0,
          },
          state,
          () => terrain,
        );
        state = {
          temporaryActorTicks: r.temporaryActorTicks,
          avoidMonsterTicks: r.avoidMonsterTicks,
          encounterStepsRemaining: r.encounterStepsRemaining,
        };
        if (r.request || r.avoidExpired)
          lines.push(
            `${scene}:${room}:${terrain} i=${i} avoid=${r.avoidMonsterTicks} steps=${r.encounterStepsRemaining} exp=${r.avoidExpired}` +
              (r.request
                ? ` req=${r.request.speciesId},${r.request.level},${r.request.nature},${r.request.quality}`
                : ""),
          );
      }
    }
    expect(lines).toEqual(golden);
  });

  it("does nothing before the story's first main task, or in a room without a roster", () => {
    const engine = new WorldEncounterEngine(doc, scripted()),
      state = { temporaryActorTicks: 0, avoidMonsterTicks: 0, encounterStepsRemaining: 1 },
      input = {
        timersEnabled: false,
        scene: 1,
        room: 1,
        rideSuppressesEncounters: false,
        mainTaskProgress: 0,
        rareEncounterBonusPercent: 0,
      };
    expect(engine.afterSuccessfulMovement(input, state, () => 0).request).toBeNull();
    expect(engine.hasArea(1, 0)).toBe(false);
    const village = engine.afterSuccessfulMovement(
      { ...input, timersEnabled: true, room: 0, mainTaskProgress: 2 },
      state,
      () => 0,
    );
    expect([village.request, village.encounterStepsRemaining]).toEqual([null, 1]);
  });

  it.each([
    [false, 2, 1],
    [true, 49, 9],
    [true, 50, 1],
  ])("applies the amulet to wild Shiny odds (equipped %s, roll %i)", (equipped, chance, nature) => {
    const engine = new WorldEncounterEngine(doc, {
      entry: (lane) => (lane === "world.encounter.customNatureChance" ? chance : 0),
      inclusive: (lane, min, max) => (lane === "world.encounter.customNature" ? max : min),
    });
    const result = engine.afterSuccessfulMovement(
      {
        timersEnabled: true,
        scene: 1,
        room: 1,
        rideSuppressesEncounters: false,
        mainTaskProgress: 1,
        rareEncounterBonusPercent: 0,
        shinyGearEquipped: equipped,
      },
      { temporaryActorTicks: 0, avoidMonsterTicks: 0, encounterStepsRemaining: 1 },
      () => 0,
    );
    expect(result.request?.nature).toBe(nature);
  });

  it("raises the stars with the main task (qualityForRoll)", () => {
    expect([qualityForRoll(5, 84), qualityForRoll(5, 85)]).toEqual([1, 2]);
    expect([qualityForRoll(20, 64), qualityForRoll(20, 94), qualityForRoll(20, 95)]).toEqual([
      1, 2, 3,
    ]);
    expect(qualityForRoll(48, 99)).toBe(4);
  });
});
