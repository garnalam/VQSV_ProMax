import { describe, expect, it } from "vitest";
import { StoryEventInterpreter } from "./StoryEventInterpreter";
import { StoryRuntime, type StorySceneAdapter } from "./StoryRuntime";
import { StoryDataRegistry, type StorySourceRegistryDocument } from "./StoryDataRegistry";
const scene = (id: string): StorySceneAdapter =>
  ({
    id,
    complete: false,
    ticks: 0,
    confirm() {},
    tick() {
      (this as any).ticks++;
    },
  }) as StorySceneAdapter & { ticks: number };
describe("shared StoryRuntime architecture", () => {
  it("interprets one event at a time with source-style elapsed ticks", () => {
    const seen: string[] = [];
    const interpreter = new StoryEventInterpreter(["a", "b"], (event, _ctx, elapsed) => {
      seen.push(`${event}:${elapsed}`);
      return elapsed === 2 ? "complete" : "continue";
    });
    for (let i = 0; i < 5; i++) interpreter.tick({});
    expect(seen).toEqual(["a:1", "a:2", "b:1", "b:2"]);
  });
  it("switches scene adapters without changing the engine owner", () => {
    const first = scene("scene0"),
      second = scene("scene1"),
      runtime = new StoryRuntime(first);
    runtime.register(second);
    runtime.tick();
    expect((first as any).ticks).toBe(1);
    runtime.switchTo("scene1");
    runtime.tick();
    expect((second as any).ticks).toBe(1);
    expect(runtime.scene.id).toBe("scene1");
  });
  it("exposes the original scene/room source block through the active adapter", () => {
    const first = { ...scene("scene0"), sourceSceneId: 0, sourceRoomIndex: 0 },
      document = {
        format: "vqsv-source-event-registry",
        version: 1,
        generatedFrom: "modules/event/decoded",
        sceneCount: 1,
        scenes: [
          {
            format: "event_scene",
            sceneId: 0,
            sourceFile: "modules/event/decoded/data__event__scene_0.mid.json",
            blockCount: 1,
            blockSizes: [1],
            rooms: [
              {
                roomIndex: 0,
                roomName: "Bản đồ trống",
                blockSize: 1,
                roomStart: 0,
                stringPool: [],
                actors: [],
                eventGroups: [],
                postActorStrings: [],
                unknownAb: 0,
                unknownSkip: 0,
              },
            ],
          },
        ],
      } as StorySourceRegistryDocument,
      runtime = new StoryRuntime(first, new StoryDataRegistry(document));
    expect(runtime.sourceRoom?.roomName).toBe("Bản đồ trống");
  });
});
