import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { StoryDataRegistry, type StorySourceRegistryDocument } from "./StoryDataRegistry";
const document = JSON.parse(
  readFileSync("public/pack/story/event-scenes.json", "utf8"),
) as StorySourceRegistryDocument;
describe("source event_scene registry", () => {
  it("preserves the original scene-file registry instead of inventing room files", () => {
    const registry = new StoryDataRegistry(document);
    expect(document.format).toBe("vqsv-source-event-registry");
    expect(document.generatedFrom).toBe("modules/event/decoded");
    expect(document.sceneCount).toBe(14);
    expect(registry.scene(0)?.sourceFile).toContain("data__event__scene_0.mid.json");
    expect(registry.room(1, 0)?.roomName).toBe("Thủy Mộc Thôn");
  });
  it("resolves source event groups by scene, room and group", () => {
    const registry = new StoryDataRegistry(document),
      group = registry.group(1, 0, 0);
    expect(group?.scene_id).toBe(1);
    expect(group?.room_index).toBe(0);
    expect(group?.records.length).toBeGreaterThan(0);
    expect(group?.records[0].opcode).toBe(15);
  });
});
