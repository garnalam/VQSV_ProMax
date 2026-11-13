import { describe, expect, it } from "vitest";
import { GameplayClock } from "./GameplayClock";
import { gameplayCommands, type InputCommand } from "./input/GameCommand";
import { InputSnapshot } from "./input/InputSnapshot";
import { KEY } from "./input/KeyCode";
import { createStorySceneRuntime } from "../game/story/StorySceneRuntime";
import { StoryDataRegistry } from "../game/story/StoryDataRegistry";
import { ROUTE_ID, SourceRouteCatalog } from "../game/story/SourceRoutes";
import { readFileSync } from "node:fs";

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const INTRO_ROUTE = new SourceRouteCatalog(readJson("public/pack/story/routes.json")).require(
  ROUTE_ID.openingIntro,
);
const record = (calls: InputCommand[][]) => (input: InputSnapshot) =>
  calls.push(gameplayCommands(input));

describe("Java gameplay speed x2 contract", () => {
  it("runs one gameplay tick at normal speed", () => {
    const calls: InputCommand[][] = [],
      clock = new GameplayClock();
    clock.tick(record(calls), InputSnapshot.keys(KEY.ENTER));
    expect(calls).toEqual([["confirm"]]);
  });
  it("runs two gameplay ticks while applying input only once", () => {
    const calls: InputCommand[][] = [],
      clock = new GameplayClock();
    clock.setSpeedX2(true);
    clock.tick(record(calls), InputSnapshot.keys(KEY.ENTER));
    expect(calls).toEqual([["confirm"], []]);
  });
  it("keeps held direction state on the extra x2 tick without replaying confirm", () => {
    const calls: InputCommand[][] = [],
      clock = new GameplayClock();
    clock.setSpeedX2(true);
    clock.tick(record(calls), InputSnapshot.keys(KEY.ENTER, KEY.RIGHT));
    expect(calls).toEqual([["right", "holdRight", "confirm"], ["holdRight"]]);
  });
  it("returns to one tick when x2 is disabled", () => {
    const calls: InputCommand[][] = [],
      clock = new GameplayClock();
    clock.setSpeedX2(true);
    clock.setSpeedX2(false);
    clock.tick(record(calls), InputSnapshot.keys(KEY.SPACE));
    expect(calls).toEqual([["confirm"]]);
  });
  it("never repeats a pointer press on the extra x2 tick", () => {
    const seen: boolean[] = [],
      clock = new GameplayClock();
    clock.setSpeedX2(true);
    clock.tick((input) => seen.push(input.pointer.pressed), InputSnapshot.tap(10, 10));
    expect(seen).toEqual([true, false]);
  });
  it("runs one tick per frame while the screen asks that x2 be suppressed", () => {
    const calls: InputCommand[][] = [],
      clock = new GameplayClock();
    clock.setSpeedX2(true);
    clock.tick(record(calls), InputSnapshot.keys(KEY.ENTER), () => true);
    clock.tick(record(calls), InputSnapshot.keys(KEY.ENTER), () => false);
    expect(calls).toEqual([["confirm"], ["confirm"], []]);
  });
  it("advances the Scene0 intro twice as fast without changing simulation state", () => {
    const registry = new StoryDataRegistry(readJson("public/pack/story/event-scenes.json")),
      services = { room: () => undefined, animationTicks: () => 1 },
      normal = createStorySceneRuntime(registry, INTRO_ROUTE, services),
      fast = createStorySceneRuntime(registry, INTRO_ROUTE, services),
      normalClock = new GameplayClock(),
      fastClock = new GameplayClock();
    fastClock.setSpeedX2(true);
    for (let frame = 0; frame < 128; frame++)
      normalClock.tick(() => normal.tick(), InputSnapshot.EMPTY);
    for (let frame = 0; frame < 64; frame++) fastClock.tick(() => fast.tick(), InputSnapshot.EMPTY);
    expect(fast.tickCount).toBe(128);
    expect(fast.digest()).toBe(normal.digest());
  });
  it("completes the whole auto-confirmed Scene0 route in about half the host frames", () => {
    const run = (speedX2: boolean) => {
        const registry = new StoryDataRegistry(readJson("public/pack/story/event-scenes.json")),
          runtime = createStorySceneRuntime(registry, INTRO_ROUTE, {
            room: () => undefined,
            animationTicks: () => 1,
          }),
          clock = new GameplayClock();
        clock.setSpeedX2(speedX2);
        let frames = 0;
        for (; frames < 20000 && !runtime.complete; frames++) {
          if (runtime.textReady) runtime.confirm();
          clock.tick(() => runtime.tick(), InputSnapshot.EMPTY);
        }
        const digest = JSON.parse(runtime.digest()) as Record<string, unknown>;
        delete digest.tick;
        return { frames, digest };
      },
      normal = run(false),
      fast = run(true);
    expect(fast.digest).toEqual(normal.digest);
    expect(fast.frames).toBeLessThanOrEqual(Math.ceil(normal.frames / 2) + 1);
  });
});
