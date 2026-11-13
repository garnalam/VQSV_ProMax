import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { musicTrackFor, type MusicTable } from "./AudioManager";

const table = JSON.parse(readFileSync("public/pack/audio/music.json", "utf8")) as MusicTable;
const at = (scene: number, room: number, battle = false, group: number | null = null) =>
  musicTrackFor(table, {
    scene,
    room,
    battle,
    group: group === null ? null : { scene, room, group },
  });

describe("music choice (game.l + media.mid)", () => {
  it("plays each room's own track", () => {
    expect([at(0, 0), at(0, 1), at(1, 0), at(1, 1), at(1, 3)]).toEqual([1, 0, 3, 3, 0]);
  });
  it("plays track 4 for a fight unless the group names its own", () => {
    expect(at(1, 1, true, 0)).toBe(4);
    expect(at(1, 3, true, 0)).toBe(0);
    expect(table.battleMusic).toBe(4);
  });
  it("lets a running event group override the room", () => {
    expect(at(1, 0, false, 10)).toBe(0);
    expect(at(1, 0, false, 2)).toBe(3);
  });
  it("falls back to the menu track off the map", () => {
    expect(at(-1, -1)).toBe(table.menuMusic);
  });
  it("loops every track at its MIDI length", () => {
    expect(Object.keys(table.tracks)).toEqual(["0", "1", "2", "3", "4", "5", "6", "8"]);
    expect(table.tracks["0"].loopMicros).toBe(109396942);
  });
});
