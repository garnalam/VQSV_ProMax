import { InputSnapshot, type InputSnapshotInit } from "../core/input/InputSnapshot";
import type { InputCommand } from "../core/input/GameCommand";
import * as parity from "./parityCheckpoints";
import type { NewGameScreen } from "../screens/NewGameScreen";
import type { StorySceneRuntime } from "../game/story/StorySceneRuntime";

/**
 * Scripted gameplay traces whose per-tick state digests are pinned in a golden file, so any change
 * in tick order, layer priority or save timing shows up as a digest mismatch. First recorded before
 * `GameplayHost` was split out (the split changed nothing); re-recorded after the Java-trace fixes to
 * the opening route, text disposal, blank sprite frames and dialog pagination, which change these
 * digests on purpose; re-recorded once more for the source map-loading screen, which only prepends
 * sixteen input-deaf ticks to the one trace that starts its session inside a room — a checkpoint
 * means "the hero stands in this room", so the harness waits that screen out everywhere else.
 * bunny-battle was re-recorded when new pets started taking Java's `initialSkillIds` deck (the
 * pet-design pool): the bunny now holds 21, a DEFENSIVE-priority skill, so its turn order changed.
 */
export type TraceStep =
  InputCommand[] | { input: InputSnapshotInit } | ((screen: NewGameScreen) => void);
export type TraceDigest = Record<string, unknown>;

/** Everything the simulation exposes that a player could observe or a save could capture. */
export function digest(screen: NewGameScreen): TraceDigest {
  const host = screen.host,
    story = host.story,
    scene = story.scene as Partial<StorySceneRuntime> & { id: string },
    world = host.world,
    prelude = host.prelude;
  return {
    scene: scene.id,
    worldActive: story.worldActive,
    complete: story.complete,
    intro: [
      host.runtime.currentText ?? null,
      host.runtime.visibleChars,
      host.runtime.textReady,
      host.runtime.effect,
      host.runtime.effectTick,
      host.runtime.particleEffect,
      host.runtime.complete,
    ],
    prelude: prelude
      ? [
          prelude.id,
          prelude.currentText ?? null,
          prelude.visibleChars,
          prelude.textKind,
          prelude.effect,
          prelude.effectTick,
          prelude.complete,
          prelude.battle ? prelude.battle.phase.key : null,
        ]
      : null,
    current:
      scene.id !== host.runtime.id && scene.id !== prelude?.id && "currentText" in scene
        ? [scene.currentText ?? null, scene.visibleChars, scene.complete]
        : null,
    world: world
      ? [
          world.phase,
          world.sceneId,
          world.roomIndex,
          world.player.x,
          world.player.y,
          world.player.direction,
          world.cameraX,
          world.cameraY,
          world.battleStage,
          world.opponentHp,
          world.currentText,
          world.presentationTick,
          world.saveSelected,
          world.eventVisible,
        ]
      : null,
    /**
     * The free-world event frame, recorded apart from `world` because its text is what the player
     * reads: a dispatched group is the scene that owns the text, not the cutscene layer.
     */
    event: world?.eventScene
      ? [
          world.eventScene.program.id,
          world.eventScene.currentText ?? null,
          world.eventScene.visibleChars,
          world.eventScene.textKind,
          world.eventScene.textReady,
          world.eventScene.complete,
        ]
      : null,
    panel: host.panel.visible ? [host.panel.mode, host.panel.selected] : null,
    particles: screen.particleCount,
  };
}

function run(screen: NewGameScreen, step: TraceStep): void {
  if (typeof step === "function") step(screen);
  else if (Array.isArray(step)) screen.step(step);
  else screen.tick(new InputSnapshot(step.input));
}

/** Run `steps` and record a digest after every `every`-th tick. */
export function record(screen: NewGameScreen, steps: TraceStep[], every = 1): TraceDigest[] {
  const out: TraceDigest[] = [digest(screen)];
  steps.forEach((step, index) => {
    run(screen, step);
    if ((index + 1) % every === 0 || index === steps.length - 1) out.push(digest(screen));
  });
  return out;
}

const repeat = (count: number, step: TraceStep): TraceStep[] => Array(count).fill(step);
const press = (x: number, y: number): TraceStep => ({
  input: { pointer: { pressed: true, pressX: x, pressY: y, x, y } },
});

export type TraceScenario = {
  name: string;
  skipIntro?: boolean;
  setup?: (screen: NewGameScreen) => void;
  steps: TraceStep[];
  every?: number;
};

/** Confirm every seventh tick: enough to walk any dialogue without skipping a typewriter frame. */
const reading = (ticks: number): TraceStep[] =>
  Array.from({ length: ticks }, (_, i) => (i % 7 === 6 ? ["confirm"] : []));

/** The source's op38/op35 starter interaction, driven through the live world rather than skipped. */
const elderReading = (ticks: number, starter = 53): TraceStep[] =>
  Array.from({ length: ticks }, () => (screen: NewGameScreen) => {
    const world = screen.host.world,
      scene = world?.eventScene,
      ids = scene?.activationIds ?? [],
      actor = ids.length ? world?.actors.get(ids.includes(starter) ? starter : ids[0]) : undefined;
    if (world && actor?.visible) {
      world.player.x = actor.x;
      world.player.y = actor.y + 20;
      world.player.direction = 2;
      screen.step(["confirm"]);
      return;
    }
    screen.step(scene && (scene.choice || scene.textReady) ? ["confirm"] : []);
  });

const unfreeze = (screen: NewGameScreen) => {
  screen.frozen = false;
};

export const SCENARIOS: TraceScenario[] = [
  { name: "new-game-opening", steps: reading(2400), every: 20 },
  {
    name: "new-game-pointer",
    steps: [
      ...repeat(40, []),
      press(120, 200),
      ...repeat(30, []),
      press(120, 244),
      ...reading(200),
    ],
    every: 5,
  },
  { name: "skip-intro-prelude", skipIntro: true, steps: reading(9000), every: 50 },
  {
    name: "save-prompt",
    setup: (s) => {
      parity.worldSavePromptCheckpoint(s);
      unfreeze(s);
    },
    steps: [["left"], ["right"], ["confirm"], ...repeat(30, []), press(40, 300), ...repeat(10, [])],
  },
  {
    name: "free-world-panel",
    setup: (s) => {
      parity.worldPanelCheckpoint(s, "plates");
      unfreeze(s);
    },
    steps: [
      ["back"],
      ["down"],
      ["down"],
      ["up"],
      ["back"],
      ...repeat(3, []),
      press(10, 310),
      ["down"],
      ["back"],
      press(230, 310),
      ["back"],
      ["holdLeft"],
      ["holdLeft"],
      ["holdUp"],
      ...repeat(20, ["holdRight"]),
      ["confirm"],
      ...repeat(10, []),
    ],
  },
  {
    name: "bunny-battle",
    setup: (s) => {
      parity.bunnyBattleCheckpoint(s);
      unfreeze(s);
    },
    steps: [["back"], ...reading(600)],
    every: 3,
  },
  {
    name: "world-event",
    setup: (s) => {
      parity.worldEventCheckpoint(s, 1);
      unfreeze(s);
    },
    steps: reading(200),
    every: 2,
  },
  {
    name: "elder-return",
    setup: (s) => {
      parity.worldElderCheckpoint(s);
    },
    steps: [["back"], ...elderReading(2000), ...repeat(20, ["holdDown"]), ["back"], ["down"]],
    every: 10,
  },
];
