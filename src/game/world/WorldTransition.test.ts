// The Cầu Vồng chapter's walk-in connections come only from its exported /4 table 1, so these
// tests read the shipped scene document and check the table against Java's own arithmetic.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { StoryDataRegistry } from "../story/StoryDataRegistry";
import { DIRECTION_DOWN, DIRECTION_LEFT, DIRECTION_RIGHT, DIRECTION_UP } from "./MapCollision";
import { worldEventTriggers } from "./WorldEventCatalog";
import { EventStateLedger } from "./EventStateLedger";
import {
  CAU_VONG_DOOR_RULES,
  CAU_VONG_PORTAL_ROWS,
  nativeFacingToEngineDirection,
  roomDoorArrival,
  roomDoorRow,
  roomDoorTriggerRect,
  roomDoorUnlocked,
  roomEntryArrival,
  roomPortalTriggerRect,
  roomPortalUnlocked,
  sourceDoors,
  sourceRoomDoors,
  sourceRoomPortals,
} from "./WorldTransition";

const cvSceneId = 98;
const registry = StoryDataRegistry.combine(
  JSON.parse(readFileSync("public/pack/story/event-scenes.json", "utf8")),
  JSON.parse(readFileSync("public/pack/story/cau-vong-event-scenes.json", "utf8")),
);
const cvRooms = registry.scene(cvSceneId)!.rooms;
const rawRows = cvRooms.flatMap((room) => room.doors ?? []);

describe("Cầu Vồng door table", () => {
  it("keeps each chapter's door engine to its own dialect", () => {
    expect(sourceRoomDoors(registry, 1, 0)).toEqual([]);
    expect(sourceRoomDoors(registry, 1, 1)).toEqual([]);
    for (const room of cvRooms)
      expect(sourceDoors(registry, cvSceneId, room.roomIndex)).toEqual([]);
    // The opcode numbers in the Liệt Hỏa catalog mean other commands here, so the chapter's event
    // groups stay unread until its own compiler exists.
    for (const room of [0, 1, 2, 3, 9, 57])
      expect(worldEventTriggers(registry, cvSceneId, room)).toEqual([]);
  });
  it("counts every row of the table and keeps the unresolved ones inert", () => {
    expect(cvRooms).toHaveLength(68);
    expect(rawRows).toHaveLength(314);
    let usable = 0;
    const inert: string[] = [];
    for (const room of cvRooms) {
      const listed = sourceRoomDoors(registry, cvSceneId, room.roomIndex);
      usable += listed.length;
      for (const door of room.doors ?? [])
        if (!listed.some((candidate) => candidate.row === door.row))
          inert.push(`${room.roomIndex}:${door.row}->${door.target?.room}:${door.target?.entry}`);
    }
    // Java throws over those rows; its own room owners keep them out of the loop because they place
    // the player themselves. A browser frame stops at inert instead.
    expect(usable).toBe(300);
    expect(inert).toEqual([
      "43:0->0:255",
      "43:1->0:255",
      "43:2->0:255",
      "43:3->0:255",
      "46:0->0:255",
      "46:1->0:255",
      "47:0->0:255",
      "47:1->0:255",
      "47:2->0:255",
      "47:3->0:255",
      "56:0->1:255",
      "56:1->1:255",
      "56:2->1:255",
      "56:3->1:255",
    ]);
  });
  it("triggers on the door's own 20px tile and arrives through the destination row", () => {
    const door = sourceRoomDoors(registry, cvSceneId, 1)[0];
    expect(door).toMatchObject({
      room: 1,
      row: 0,
      x: 2,
      y: 0,
      facing: 1,
      target: { scene: cvSceneId, room: 0, entry: 1 },
    });
    expect(roomDoorTriggerRect(door)).toEqual({ x: 40, y: 0, width: 20, height: 20 });
    const destination = roomDoorRow(registry, cvSceneId, 0, 1)!;
    expect(destination).toMatchObject({ x: 10, y: 31, facing: 2, row: 1 });
    // Tile centre plus feet line, then one tile back along the way the destination door faces out.
    expect(roomDoorArrival(destination)).toEqual({ x: 210, y: 619, direction: DIRECTION_UP });
    expect(nativeFacingToEngineDirection(1)).toBe(DIRECTION_DOWN);
    expect(nativeFacingToEngineDirection(2)).toBe(DIRECTION_UP);
    expect(nativeFacingToEngineDirection(3)).toBe(DIRECTION_RIGHT);
    expect(nativeFacingToEngineDirection(4)).toBe(DIRECTION_LEFT);
    expect(nativeFacingToEngineDirection(0)).toBe(-1);
    expect(roomDoorArrival({ ...destination, facing: 1 })).toEqual({
      x: 210,
      y: 659,
      direction: DIRECTION_DOWN,
    });
    expect(roomDoorArrival({ ...destination, facing: 3 })).toEqual({
      x: 230,
      y: 639,
      direction: DIRECTION_RIGHT,
    });
    expect(roomDoorArrival({ ...destination, facing: 4 })).toEqual({
      x: 190,
      y: 639,
      direction: DIRECTION_LEFT,
    });
  });
  it("closes the connections Java gates on events or on one adopted exit", () => {
    const ledger = new EventStateLedger();
    for (const rule of CAU_VONG_DOOR_RULES) {
      expect(roomDoorUnlocked(ledger, cvSceneId, rule.room, rule.target)).toBe(!rule.requires);
      if (rule.requires)
        ledger.op14CompleteEvent(cvSceneId, rule.requires.room, rule.requires.event);
      expect(roomDoorUnlocked(ledger, cvSceneId, rule.room, rule.target)).toBe(true);
    }
    // Three rooms' owners read one native connection at a time, so every other row there stays shut.
    expect(roomDoorUnlocked(ledger, cvSceneId, 3, 2)).toBe(false);
    expect(roomDoorUnlocked(ledger, cvSceneId, 6, 5)).toBe(false);
    expect(roomDoorUnlocked(ledger, cvSceneId, 10, 5)).toBe(false);
    expect(roomDoorUnlocked(ledger, cvSceneId, 1, 0)).toBe(true);
  });
  it("places the hero by table in all 68 chapter rooms", () => {
    const arrivals = cvRooms.map((room) => roomEntryArrival(registry, cvSceneId, room.roomIndex));
    expect(arrivals.filter((arrival) => arrival !== null)).toHaveLength(68);
    for (const [index, arrival] of arrivals.entries())
      expect(arrival, `room ${index}`).toMatchObject({
        x: expect.any(Number),
        y: expect.any(Number),
        direction: expect.any(Number),
      });
    // The first room's own south-side rows are the way back down the hill, so its arrival is the
    // row the academy town points at, facing up into town.
    expect(arrivals[0]).toEqual({ x: 210, y: 619, direction: DIRECTION_UP });
  });
});

describe("Cầu Vồng portal pads", () => {
  it("belong to the chapter scene and to no other", () => {
    expect(sourceRoomPortals(1, 9)).toEqual([]);
    expect(CAU_VONG_PORTAL_ROWS).toHaveLength(13);
    expect(sourceRoomPortals(cvSceneId, 9)).toHaveLength(4);
    expect(sourceRoomPortals(cvSceneId, 12).map((portal) => portal.target.room)).toEqual([9]);
  });
  it("warp to the script's own arrival tile, not to a door row", () => {
    const [portal] = sourceRoomPortals(cvSceneId, 9);
    expect(portal).toEqual({
      scene: cvSceneId,
      room: 9,
      x: 17,
      y: 20,
      target: { scene: cvSceneId, room: 12 },
      arrival: { x: 1 * 20 + 10, y: 15 * 20 + 19, direction: DIRECTION_DOWN },
    });
    expect(roomPortalTriggerRect(portal)).toEqual({ x: 340, y: 400, width: 20, height: 20 });
    // The one pad that arrives facing right, between the sea shelf and the wreck.
    const sea = sourceRoomPortals(cvSceneId, 19)[0];
    expect(sea.arrival).toEqual({ x: 3 * 20 + 10, y: 16 * 20 + 19, direction: DIRECTION_RIGHT });
  });
  it("stay shut until the chapter event their flag column names completes", () => {
    const ledger = new EventStateLedger();
    const pads = sourceRoomPortals(cvSceneId, 9);
    expect(pads.map((portal) => roomPortalUnlocked(ledger, cvSceneId, portal))).toEqual([
      true,
      false,
      false,
      false,
    ]);
    for (const event of [101, 103, 104]) ledger.op14CompleteEvent(cvSceneId, 9, event);
    for (const portal of pads) expect(roomPortalUnlocked(ledger, cvSceneId, portal)).toBe(true);
  });
});
