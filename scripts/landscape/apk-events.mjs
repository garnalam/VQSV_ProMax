// world/apk-events.json: the APK's own Liệt Hỏa event records, in game (JAR) coordinates.
// Usage: node apk-events.mjs <jarEventDir> <apkEventDir> <webPackWorldDir>
//
// Both event binaries are decoded whole (`event-decode.mjs`), group by group. The APK keeps every
// room's group count, so group g of a room is group g in both.
//
// - A group whose record list (opcodes, in order) is the JAR's gets `rooms` edits
//   [group, record, shortArgs]: the APK's world positions (op8 place, op13 trigger rect with its
//   size, op22 arrival, op57/58 block tiles) moved into game coordinates, and the APK's other
//   short arguments where they differ (a door's arrival actor, a speaker, a block's tile).
// - A group the APK rewrote (it dropped a trigger rect so the event runs on entering, swapped a
//   rect for an op15 gate, added a rect, cut camera pans) is replaced whole in `groups`: the APK's
//   records, matched to the JAR's by opcode and text, positions moved as above.
//
// Screen-space records (op9/11/21/48/51: laid out for 320x240 there, 240x320 here) and texts keep
// the JAR values whenever the JAR has the matching record. Scene 0 (the opening, no maps) is left
// alone. A position whose room has no map here keeps the JAR value. Groups a story route plays by
// record index (opening, time skip) keep the JAR's list and take only the matching records' positions.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { decodeScene } from "./event-decode.mjs";

/** The [x, y] argument indices of the records that hold world positions. */
const POSITION = { 8: [0, 1], 13: [0, 1], 22: [2, 3], 57: [1, 2], 58: [1, 2] };
const SCREEN = new Set([9, 11, 21, 48, 51]);
const LOADS = new Set([6, 76]);

const [jarDir, apkDir, worldDir] = process.argv.slice(2),
  rooms = JSON.parse(readFileSync(join(worldDir, "rooms.json"), "utf8")).rooms,
  origins = new Map();
function origin(scene, room) {
  const key = `${scene}:${room}`;
  if (origins.has(key)) return origins.get(key);
  const asset = rooms[`${key}#world`] ?? rooms[key];
  let value = null;
  if (asset) {
    const file = join(worldDir, "maps", String(asset.mapId), "collision.json");
    if (existsSync(file)) {
      const c = JSON.parse(readFileSync(file, "utf8"));
      value = [c.originX ?? 0, c.originY ?? 0];
    }
  }
  origins.set(key, value);
  return value;
}

const plain = (text) => (text ?? "").replace(/…/g, "...").replace(/\s+/g, " ").trim();
const key = (record) =>
  `${record.opcode}|${record.string_args.map((s) => plain(s.text)).join("|")}`;

/** Pairs of [jarIndex, apkIndex] that line up (longest common run of opcode + text). */
function align(jar, apk) {
  const a = jar.map(key),
    b = apk.map(key),
    n = a.length,
    m = b.length,
    table = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const pairs = new Map();
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j]) pairs.set(j++, i++);
    else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

// The groups a story route (the opening, the time skip) plays by record index keep the JAR's list;
// they take the APK's values only on the records both have.
const routed = new Set(
  JSON.parse(readFileSync(join(worldDir, "..", "story", "routes.json"), "utf8"))
    .routes.filter((route) => !route.id.startsWith("world:"))
    .flatMap((route) => route.groups.map((g) => `${g.sceneId}:${g.roomIndex}:${g.groupIndex}`)),
);

const stats = { edits: 0, groupsReplaced: 0, apkOnlyScreen: [], noMap: 0 },
  editsOut = {},
  groupsOut = {};

/** The APK record in game coordinates, keeping the JAR's screen layout and texts where it has them. */
function convert(scene, apkRecord, jarRecord, base) {
  const op = apkRecord.opcode,
    raw = apkRecord.short_args;
  let args = [...(jarRecord && jarRecord.short_args.length === raw.length ? jarRecord.short_args : raw)];
  if (SCREEN.has(op)) {
    if (!jarRecord) stats.apkOnlyScreen.push(`${scene} op${op}(${raw})`);
  } else if (op in POSITION) {
    const [xi, yi] = POSITION[op];
    if (base) {
      args[xi] = raw[xi] - base[0];
      args[yi] = raw[yi] - base[1];
      if (op === 13) [args[2], args[3]] = [raw[2], raw[3]];
      // An arrival's last two are the JAR screen (240x320); the APK writes its own.
      if (op === 22 && !jarRecord) [args[4], args[5]] = [240, 320];
    } else {
      stats.noMap++;
      if (!jarRecord) args = [...raw];
    }
  } else args = [...raw];
  return {
    opcode: op,
    total_arg_count: apkRecord.total_arg_count,
    short_args: args,
    string_args: jarRecord ? jarRecord.string_args : apkRecord.string_args.map((s) => ({ ...s, text: plain(s.text) })),
  };
}

for (let scene = 1; scene <= 12; scene++) {
  const jarFile = join(jarDir, `scene_${scene}.mid`),
    apkFile = join(apkDir, `scene_${scene}.mid`);
  if (!existsSync(jarFile) || !existsSync(apkFile)) continue;
  const jar = decodeScene(jarFile, scene),
    apk = decodeScene(apkFile, scene);
  apk.rooms.forEach((apkRoom, r) => {
    const jarRoom = jar.rooms[r];
    if (!jarRoom || jarRoom.event_groups.length !== apkRoom.event_groups.length)
      throw new Error(`${scene}:${r}: group count differs`);
    apkRoom.event_groups.forEach((apkGroup, g) => {
      const J = jarRoom.event_groups[g].records,
        A = apkGroup.records,
        same = J.length === A.length && J.every((x, i) => x.opcode === A[i].opcode),
        pairs = same ? new Map(A.map((_, i) => [i, i])) : align(J, A),
        records = [];
      // Positions read in the room the group is in until an op6/op76 loads another.
      let here = origin(scene, r);
      A.forEach((record, i) => {
        let base = here;
        if (record.opcode === 22) {
          const next = A.slice(i + 1).find((x) => LOADS.has(x.opcode));
          base = next ? origin(next.short_args[0], next.short_args[1]) : null;
        }
        let jarRecord = pairs.has(i) ? J[pairs.get(i)] : null;
        // A screen record the texts did not line up: the JAR one of its kind no APK record took.
        if (!jarRecord && SCREEN.has(record.opcode)) {
          const taken = new Set(pairs.values()),
            k = J.findIndex((x, n) => !taken.has(n) && x.opcode === record.opcode);
          if (k >= 0) {
            pairs.set(i, k);
            jarRecord = J[k];
          }
        }
        records.push(convert(scene, record, jarRecord, base));
        if (LOADS.has(record.opcode)) here = origin(record.short_args[0], record.short_args[1]);
      });
      const keepList = !same && routed.has(`${scene}:${r}:${g}`);
      if (same || keepList) {
        records.forEach((record, i) => {
          if (!pairs.has(i) || (keepList && !(record.opcode in POSITION))) return;
          const j = pairs.get(i);
          if (record.short_args.join() === J[j].short_args.join()) return;
          (editsOut[`${scene}:${r}`] ??= []).push([g, j, record.short_args]);
          stats.edits++;
        });
      } else {
        (groupsOut[`${scene}:${r}`] ??= {})[g] = records;
        stats.groupsReplaced++;
      }
    });
  });
}
writeFileSync(
  join(worldDir, "apk-events.json"),
  `${JSON.stringify({ format: "vqsv-apk-events", version: 2, rooms: editsOut, groups: groupsOut })}\n`,
);
console.log(JSON.stringify(stats, null, 1));
