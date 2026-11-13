import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SourceOpcodeInterpreter } from "./SourceOpcodeInterpreter";
import { ROUTE_ID, SourceRouteCatalog, type SourceRoutesDocument } from "./SourceRoutes";
import { StoryDataRegistry } from "./StoryDataRegistry";
import { createStorySceneRuntime } from "./StorySceneRuntime";

const registry = new StoryDataRegistry(
  JSON.parse(readFileSync("public/pack/story/event-scenes.json", "utf8")),
);
const document = JSON.parse(
  readFileSync("public/pack/story/routes.json", "utf8"),
) as SourceRoutesDocument;
const services = { room: () => undefined, animationTicks: () => 1 };

describe("route patches (JavaSE deviations kept as data)", () => {
  it("the opening compiles to one command per Scene0IntroScript event", () => {
    const route = new SourceRouteCatalog(document).require(ROUTE_ID.openingIntro),
      program = new SourceOpcodeInterpreter(registry).compile(route);
    expect(program.events.find((e) => e.type === "followActor")).toEqual({
      type: "followActor",
      actor: 30,
    });
    expect(program.events.filter((e) => e.type === "atomic")).toHaveLength(2);
  });

  it("a patch whose expected source events moved fails the compile instead of shifting", () => {
    const broken = structuredClone(document),
      opening = broken.routes.find((route) => route.id === ROUTE_ID.openingIntro)!;
    opening.patches![0] = { ...opening.patches![0], at: opening.patches![0].at + 1 };
    const route = new SourceRouteCatalog(broken).require(ROUTE_ID.openingIntro);
    expect(() => new SourceOpcodeInterpreter(registry).compile(route)).toThrow(/no longer matches/);
  });

  it("an atomic block runs its instant commands and starts the waiting one in the same tick", () => {
    const routes = new SourceRouteCatalog(document),
      runtime = createStorySceneRuntime(registry, routes.require(ROUTE_ID.openingIntro), services);
    const at = runtime.program.events.findIndex(
      (e) => e.type === "atomic" && e.events.some((child) => child.type === "text"),
    );
    (runtime as unknown as { interpreter: { reset(i: number): void } }).interpreter.reset(at);
    runtime.tick();
    expect(runtime.renderScene).toBe(5);
    expect(runtime.currentText).toContain("Một ngày sau đó");
    expect(runtime.complete).toBe(false);
  });
});
