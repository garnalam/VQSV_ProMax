import type { RoomActor, RoomAsset } from "../story/GameAssets";
import type { StoryDataRegistry } from "../story/StoryDataRegistry";

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
 * `world/apk-events.json` (`scripts/landscape/apk-events.mjs`): the APK's positions for the event
 * records that hold world coordinates (op13 trigger rectangles, op8 places, op22 arrivals, op57/58
 * block tiles), as `[group, record, shortArgs]` per "scene:room", in game coordinates.
 */
export type ApkEventsDocument = {
  format: "vqsv-apk-event-positions";
  version: 1;
  rooms: Record<string, [number, number, number[]][]>;
};

/**
 * Web fixes laid over the APK positions (after them, so they win):
 *
 * 10:12, which `apk-events.mjs` left without APK rects although its guardian moved: the meeting
 * rect moves with him. 10:12: Chiến Thần Đà (29) stands at (292,92) in the APK, (190,81)
 * in the JAR, so g1's and g4's rect [160,80,64,16] at his feet shifts by (+102,+11) too —
 * `XhtC2Runtime.playerIntersectsGuardianTrigger`, laid out for the landscape map.
 */
const APK_EVENT_FIXES: ApkEventsDocument["rooms"] = {
  "10:12": [
    [1, 1, [262, 91, 64, 16]],
    [4, 1, [262, 91, 64, 16]],
  ],
  // 7:2:g6 (`XhtC4Runtime.tryHandleCity`, task 46): Tomas's ritual starts on the plaza where the
  // hero steps in from 7:1 (the way from the temple), [240,352,64,32]. The APK values put it on a
  // 16 px strip at the room's far left edge by the 7:3 door, so coming from the temple nothing
  // happened and Tomas never showed. 7:1's door keeps its JAR spot (289,385) on the APK map.
  "7:2": [[6, 1, [240, 352, 64, 32]]],
};

/** Lays the APK's event positions over the story registry (landscape app only, like the actors). */
export function applyApkEvents(document: ApkEventsDocument, registry: StoryDataRegistry): void {
  for (const [key, edits] of [...Object.entries(document.rooms), ...Object.entries(APK_EVENT_FIXES)]) {
    const [scene, room] = key.split(":").map(Number);
    for (const [group, record, args] of edits) {
      const target = registry.group(scene, room, group)?.records[record];
      if (target && target.short_args.length === args.length) target.short_args = [...args];
    }
  }
}
