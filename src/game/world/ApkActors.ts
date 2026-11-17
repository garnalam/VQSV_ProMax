import type { RoomActor, RoomAsset } from "../story/GameAssets";
import type { StoryDataRegistry, StorySourceRecord } from "../story/StoryDataRegistry";

/**
 * `world/apk-actors.json` (`scripts/landscape/apk-actors.mjs`): where the APK's landscape scenes
 * put each Liệt Hỏa room actor, in game (JAR) coordinates. `actors` is keyed by the rooms.json
 * actor id, `records` by the scene file's record index (the story registry's rows, which the doors
 * and the cutscenes read). `added` are the props and wandering villagers only the APK has, with
 * ids after the room's own.
 */
export type ApkActorsDocument = {
  format: "vqsv-apk-actor-positions";
  version: 1;
  rooms: Record<
    string,
    {
      actors: Record<string, [number, number]>;
      records: Record<string, [number, number]>;
      added?: RoomActor[];
    }
  >;
};

/**
 * Seats every room actor, door marker and story-registry row where the APK draws it. Only the
 * landscape app applies it: the portrait JAR parity (tests, traces) keeps the source positions.
 */
export function applyApkActors(
  document: ApkActorsDocument,
  rooms: Record<string, RoomAsset>,
  registry: StoryDataRegistry,
): void {
  for (const [key, moves] of Object.entries(document.rooms)) {
    const room = rooms[key];
    // `s:r#world` shares its scene file rows with `s:r`: the registry is patched once, first, while
    // the room's actors still stand on their JAR spots.
    if (!key.endsWith("#world")) {
      const [scene, index] = key.split(":").map(Number);
      // A registry row is the rooms.json actor with its index (same sprite, same JAR spot), so it
      // moves with that actor. `records` is not used: the generator numbered it by a byte scan
      // that skips the scene file's kind-3 rows, so after one of those every entry belongs to the
      // next row (1:1's doorway home landed on the fence post below it, out of the hero's reach).
      registry.room(scene, index)?.actors.forEach((row, record) => {
        const spot = moves.actors[record],
          actor = room?.actors.find((own) => own.id === record),
          v = row.values;
        if (
          spot &&
          actor &&
          v.length > 4 &&
          actor.sprite === v[1] &&
          actor.x === v[3] &&
          actor.y === v[4]
        )
          [v[3], v[4]] = spot;
      });
    }
    if (room) {
      for (const actor of room.actors) {
        const spot = moves.actors[actor.id];
        if (spot) [actor.x, actor.y] = spot;
      }
      for (const actor of moves.added ?? [])
        if (!room.actors.some((own) => own.id === actor.id)) room.actors.push({ ...actor });
    }
  }
}

/**
 * `world/apk-events.json` (`scripts/landscape/apk-events.mjs`): the APK's own Liệt Hỏa event records,
 * decoded whole and moved into game coordinates. `rooms`: per "scene:room", `[group, record,
 * shortArgs]` for the groups whose record list is the JAR's (positions: op8, op13 with its size,
 * op22, op57/58; and the APK's other changed arguments). `groups`: per "scene:room", the groups the
 * APK rewrote, whole (a rect dropped so the event runs on entering, a rect swapped for an op15
 * gate, camera pans cut). Screen layout records and texts stay the JAR's.
 */
export type ApkEventsDocument = {
  format: "vqsv-apk-events";
  version: 2;
  rooms: Record<string, [number, number, number[]][]>;
  groups?: Record<string, Record<string, StorySourceRecord[]>>;
};

/**
 * Web fixes laid over the APK records (after them, so they win). None for now: the old
 * per-room position scan mixed up 7:2's and 10:12's rects and they were patched here; the full
 * decode puts the APK's own there (7:2:g6 runs on entering, as in the APK; 10:12:g1/g4 sit at
 * Chiến Thần Đà's feet).
 */
const APK_EVENT_FIXES: ApkEventsDocument["rooms"] = {};

/** Lays the APK's event records over the story registry (landscape app only, like the actors). */
export function applyApkEvents(document: ApkEventsDocument, registry: StoryDataRegistry): void {
  for (const [key, groups] of Object.entries(document.groups ?? {})) {
    const [scene, room] = key.split(":").map(Number);
    for (const [index, records] of Object.entries(groups)) {
      const group = registry.group(scene, room, Number(index));
      if (!group) continue;
      group.records = records.map((record) => ({
        ...record,
        short_args: [...record.short_args],
        string_args: record.string_args.map((arg) => ({ ...arg })),
      }));
      group.record_count = group.records.length;
    }
  }
  for (const [key, edits] of [...Object.entries(document.rooms), ...Object.entries(APK_EVENT_FIXES)]) {
    const [scene, room] = key.split(":").map(Number);
    for (const [group, record, args] of edits) {
      const target = registry.group(scene, room, group)?.records[record];
      if (target && target.short_args.length === args.length) target.short_args = [...args];
    }
  }
}
