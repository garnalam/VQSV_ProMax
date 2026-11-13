import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyCauVongActors, type RoomAsset } from "../story/GameAssets";
import type { StoryActor } from "../story/StoryActor";
import { cauVongDrawOrder } from "./CauVongDrawOrder";

const pack = resolve(import.meta.dirname, "../../../public/pack");
const read = <T>(file: string): T => JSON.parse(readFileSync(resolve(pack, file), "utf8")) as T;

describe("Cầu Vồng actors baked by ExportWebCauVongActors", () => {
  const rooms = read<{ rooms: Record<string, RoomAsset> }>("world/rooms.json").rooms,
    baked = read<{ rooms: Record<string, (StoryActor & { sourceOrder: number })[]> }>(
      "cau-vong-world/actors.json",
    ),
    sprites = read<{
      sprites: Record<string, { states: Record<string, { file?: string; mirrorFile?: string }[]> }>;
    }>("cau-vong-world/sprites.json").sprites;

  it("dresses every 98:* room actor that JavaSE dresses, over the placeholder sprite 223", () => {
    expect(Object.keys(baked.rooms)).toHaveLength(68);
    expect(rooms["98:0"].actors.find((a) => a.id === 1)?.sprite).toBe(223);
    applyCauVongActors(rooms, baked);
    const quang = rooms["98:0"].actors.find((a) => a.id === 1)!;
    expect(quang).toMatchObject({ sprite: 10044, renderOffsetX: 10, renderOffsetY: 19 });
    expect(quang.sourceOrder).toBe(1);
    // Besides the exit arrows (sourceKind 1), JavaSE dresses every actor but five no catalog names.
    const left: string[] = [];
    for (const [key, room] of Object.entries(rooms))
      if (key.startsWith("98:"))
        for (const actor of room.actors)
          if (actor.sprite === 223 && actor.sourceKind !== 1) left.push(`${key}#${actor.id}`);
    expect(left).toEqual(["98:49#93", "98:58#153", "98:58#154", "98:58#155", "98:58#156"]);
  });

  it("ships every frame the dressed actors draw with", () => {
    for (const actors of Object.values(baked.rooms))
      for (const actor of actors) {
        const states = sprites[String(actor.sprite)]?.states;
        expect(states, `sprite ${actor.sprite}`).toBeDefined();
        expect(
          states![String(actor.state)],
          `sprite ${actor.sprite} state ${actor.state}`,
        ).toBeDefined();
      }
    for (const sprite of Object.values(sprites))
      for (const frames of Object.values(sprite.states))
        for (const frame of frames)
          for (const file of [frame.file, frame.mirrorFile])
            if (file) expect(existsSync(resolve(pack, "cau-vong-world", file)), file).toBe(true);
  });
});

describe("cauVongDrawOrder (VqsvSceneView scene 98)", () => {
  const actor = (id: number, y: number, sourceOrder: number, renderOffsetY = 19): StoryActor => ({
    id,
    x: 0,
    y,
    state: 0,
    direction: 0,
    variant: 0,
    renderOffsetX: 10,
    renderOffsetY,
    visible: true,
    sprite: 10000,
    layer: 1,
    animationTick: 0,
    sourceOrder,
  });

  it("layers 0 and 2 follow the source row, not y", () => {
    const order = cauVongDrawOrder([actor(1, 50, 3), actor(2, 10, 1), actor(3, 30, 2)], 2);
    expect(order.map((a) => a.id)).toEqual([2, 3, 1]);
  });

  it("layer 1 sorts by foot y then source row, the hero before the first actor below it", () => {
    const hero = { ...actor(-1, 120, 0, 0) };
    const order = cauVongDrawOrder(
      [actor(1, 110, 5), actor(2, 101, 2), actor(3, 101, 1), actor(4, 80, 9), hero],
      1,
    );
    // Feet: #4 99, #3 120, #2 120, #1 129. The hero's foot (120) is level with #3 and #2: they first.
    expect(order.map((a) => a.id)).toEqual([4, 3, 2, -1, 1]);
  });
});
