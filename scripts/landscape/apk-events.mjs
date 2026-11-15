// world/apk-events.json: the APK's landscape coordinates for the Liệt Hỏa event records that hold
// world positions, in game (JAR) coordinates.
// Usage: node apk-events.mjs <jarDecodedEventDir> <jarEventDir> <apkEventDir> <webPackWorldDir>
//
// A short-only record is stored as [op s16][argc][shortc = argc][shorts]. The JAR decode lists the
// same records in the same order, so the k-th record of an opcode in a room block is the k-th one
// in the decoded room's event groups. The APK keeps that order; a room whose count of an opcode
// changed is left alone for that opcode.
//
//   op13 [x, y, w, h]              a player trigger rectangle, in this room
//   op8  [x, y]                    `place`, in this room
//   op57/op58 [actor, x, y, trig]  a block's gate / reset tile, in this room
//   op22 [?, dir, x, y, w, h]      the arrival spot, in the room the next op6/op76 loads
// The screen-space records (op9/11/21: 240x320 vs 320x240) are not world positions and stay.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const OPS = { 8: [0, 1], 13: [0, 1], 22: [2, 3], 57: [1, 2], 58: [1, 2] };

function scan(file, sizes) {
  const b = readFileSync(file),
    count = b.readInt16BE(0),
    blockSizes = [];
  for (let i = 0; i < count; i++) blockSizes.push(b.readUInt16BE(2 + i * 2));
  let start = 2 + count * 2;
  const rooms = [];
  for (const size of blockSizes) {
    const block = b.subarray(start, start + size),
      records = [];
    for (let o = 0; o + 4 <= block.length; o++) {
      if (block[o] !== 0) continue;
      const op = block[o + 1],
        argc = block[o + 2];
      if (!(op in OPS) || sizes[op] !== argc || block[o + 3] !== argc) continue;
      if (o + 4 + argc * 2 > block.length) continue;
      records.push({ op, args: Array.from({ length: argc }, (_, k) => block.readInt16BE(o + 4 + k * 2)) });
    }
    rooms.push(records);
    start += size;
  }
  return rooms;
}

const [decodedDir, jarDir, apkDir, worldDir] = process.argv.slice(2),
  rooms = JSON.parse(readFileSync(join(worldDir, "rooms.json"), "utf8")).rooms,
  origin = (scene, room) => {
    const asset = rooms[`${scene}:${room}#world`] ?? rooms[`${scene}:${room}`];
    if (!asset) return null;
    const file = join(worldDir, "maps", String(asset.mapId), "collision.json");
    if (!existsSync(file)) return null;
    const c = JSON.parse(readFileSync(file, "utf8"));
    return [c.originX ?? 0, c.originY ?? 0];
  },
  out = {},
  stats = { written: 0, same: 0, skippedCount: 0, noTarget: 0 };
// The argument count each opcode is stored with (the decode's).
const sizes = { 8: 2, 13: 4, 22: 6, 57: 4, 58: 4 };
for (let scene = 0; scene <= 11; scene++) {
  const file = join(decodedDir, `data__event__scene_${scene}.mid.json`);
  if (!existsSync(file)) continue;
  const decoded = JSON.parse(readFileSync(file, "utf8")),
    jar = scan(join(jarDir, `scene_${scene}.mid`), sizes),
    apk = scan(join(apkDir, `scene_${scene}.mid`), sizes);
  decoded.rooms.forEach((room, r) => {
    // The decoded records of each tracked op, in file order, with where they sit.
    const spots = {};
    room.event_groups.forEach((group) =>
      group.records.forEach((record, index) => {
        if (!(record.opcode in OPS) || record.string_args.length) return;
        if (record.short_args.length !== sizes[record.opcode]) return;
        (spots[record.opcode] ??= []).push({ group, index, args: record.short_args });
      }),
    );
    const here = origin(scene, r),
      edits = [];
    for (const [op, list] of Object.entries(spots)) {
      const jarOps = jar[r].filter((x) => x.op === +op),
        apkOps = (apk[r] ?? []).filter((x) => x.op === +op);
      // The decode and the raw scan must agree before the APK list is trusted to line up.
      if (jarOps.length !== list.length || jarOps.some((x, i) => x.args.join() !== list[i].args.join()))
        throw new Error(`scene ${scene} room ${r} op${op}: decode and scan disagree`);
      if (apkOps.length !== list.length) {
        stats.skippedCount += list.length;
        continue;
      }
      list.forEach((spot, i) => {
        const raw = apkOps[i].args,
          [xi, yi] = OPS[op];
        let base = here;
        if (+op === 22) {
          // The arrival belongs to the room the next op6/op76 of the group loads.
          const next = spot.group.records.slice(spot.index + 1).find((x) => x.opcode === 6 || x.opcode === 76);
          base = next ? origin(next.short_args[0], next.short_args[1]) : null;
        }
        if (!base) {
          stats.noTarget++;
          return;
        }
        const args = [...spot.args];
        args[xi] = raw[xi] - base[0];
        args[yi] = raw[yi] - base[1];
        // Only the position moves: a rectangle keeps the APK's size too.
        if (+op === 13) [args[2], args[3]] = [raw[2], raw[3]];
        if (args.join() === spot.args.join()) {
          stats.same++;
          return;
        }
        edits.push([spot.group.group_index, spot.index, args]);
        stats.written++;
      });
    }
    if (edits.length) out[`${scene}:${r}`] = edits;
  });
}
writeFileSync(
  join(worldDir, "apk-events.json"),
  `${JSON.stringify({ format: "vqsv-apk-event-positions", version: 1, rooms: out })}\n`,
);
console.log(JSON.stringify(stats));
