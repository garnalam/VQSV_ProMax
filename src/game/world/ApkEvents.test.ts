// The landscape game's Liệt Hỏa events (`world/apk-events.json` laid over the JAR registry, as
// GameApp does): every free-world group still compiles with its JavaSE route patches, and the
// groups the APK rewrote read as the APK has them.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyApkEvents, type ApkEventsDocument } from "./ApkActors";
import { StoryDataRegistry } from "../story/StoryDataRegistry";
import { SourceOpcodeInterpreter } from "../story/SourceOpcodeInterpreter";
import { SourceRouteCatalog, type SourceRoutesDocument } from "../story/SourceRoutes";
import { worldEventTriggers } from "./WorldEventCatalog";

const root = resolve(import.meta.dirname, "../../../public/pack");
const pack = <T>(path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8")) as T;
const apk = pack<ApkEventsDocument>("world/apk-events.json");
const registry = StoryDataRegistry.combine(pack("story/event-scenes.json"));
applyApkEvents(apk, registry);
const routes = new SourceRouteCatalog(pack<SourceRoutesDocument>("story/routes.json"));

describe("APK Liệt Hỏa events", () => {
  it("compiles every free-world group with its route patches", () => {
    const failures: string[] = [];
    for (let scene = 1; scene <= 11; scene++)
      for (const room of registry.scene(scene)?.rooms ?? [])
        for (const group of room.eventGroups) {
          const id = `world:${scene}:${room.roomIndex}:${group.group_index}`;
          try {
            new SourceOpcodeInterpreter(registry).compile({
              id,
              patches: routes.patchesFor(id),
              groups: [{ sceneId: scene, roomIndex: room.roomIndex, groupIndex: group.group_index }],
              startEvent: 0,
              initialRoom: { scene, room: room.roomIndex, x: 0, y: 0 },
            });
          } catch (error) {
            failures.push(`${id}: ${(error as Error).message}`);
          }
        }
    expect(failures).toEqual([]);
  });

  it("reads the rewritten groups as the APK has them", () => {
    expect(Object.keys(apk.groups ?? {}).length).toBeGreaterThan(0);
    // 9:1:g0 (the Nguyên Mộc gym's welcome) dropped its doorway rect: it runs on entering.
    expect(registry.group(9, 1, 0)!.records.some((r) => r.opcode === 13)).toBe(false);
    // 10:8:g1's torch hint waits on an op15 gate instead of a rect.
    expect(registry.group(10, 8, 1)!.records[0].opcode).toBe(15);
    // 7:2:g1 (the Bạch Long gate) got its own rect by the 7:3 door; g6 (Tomas's ritual) none.
    const rects = worldEventTriggers(registry, 7, 2).filter((t) => t.kind === "rect");
    expect(rects.some((t) => t.group.group === 1)).toBe(true);
    expect(rects.some((t) => t.group.group === 6)).toBe(false);
  });
});
