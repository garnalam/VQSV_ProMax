// Exports the original game's area map (`game.l` state 4, opened with key 1 on the free map) to
// public/pack/story/area-maps.json.
//
// Everything comes from the decoded original, not from the JavaSE rebuild:
//   - modules/source_code/decoded/decompiled_source_cfr/game/l.java: the constant tables
//     aS (rooms per area: x, y, scene, room, name row, w, h), aR (fill/text colour per area),
//     aT (area size in 5-cell blocks), aP (Đạo quán doors), aQ (docks), as (scenes with no map)
//     and v (first petRide.mid row of each scene);
//   - modules/script/original/petRide.mid: byte rows indexed v[scene] + room, column 4 = area;
//   - modules/script/decoded/data__script__chs.mid.json: the text table the name rows point into.
//
// Usage: npm run export:area-maps
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sourcePackRoot } from "./source-pack.mjs";

const root = sourcePackRoot();
const lJava = readFileSync(
  resolve(root, "modules/source_code/decoded/decompiled_source_cfr/game/l.java"),
  "utf8",
);

/**
 * The integer literals of `<target> = new <type>{...}`, nested braces kept as rows. The target must
 * start its own statement, so `v` does not match `this.v` or `w.v`.
 */
function literal(target) {
  const match = new RegExp(`\\n\\s+${target.replace(".", "\\.")} = new `).exec(lJava);
  if (!match) throw new Error(`l.java: ${target} not found`);
  const at = match.index;
  const open = lJava.indexOf("{", at);
  let depth = 0,
    end = open;
  for (; end < lJava.length; end++) {
    if (lJava[end] === "{") depth++;
    else if (lJava[end] === "}" && --depth === 0) break;
  }
  const body = lJava.slice(open, end + 1).replace(/0xFFFFFF/g, String(0xffffff));
  return JSON.parse(body.replace(/\{/g, "[").replace(/\}/g, "]"));
}

const aS = literal("this.aS"),
  aR = literal("this.aR"),
  aT = literal("this.aT"),
  aP = literal("this.aP"),
  aQ = literal("this.aQ"),
  noMapScenes = literal("as"),
  sceneRows = literal("v");

// petRide.mid: short count, then per row a short length and that many signed bytes.
const ride = readFileSync(resolve(root, "modules/script/original/petRide.mid"));
const view = new DataView(ride.buffer, ride.byteOffset, ride.byteLength);
let offset = 0;
const rowCount = view.getInt16(offset);
offset += 2;
const rideRows = [];
for (let i = 0; i < rowCount; i++) {
  const length = view.getInt16(offset);
  offset += 2;
  const row = [];
  for (let j = 0; j < length; j++) row.push(view.getInt8(offset++));
  rideRows.push(row);
}
if (offset !== ride.length) throw new Error(`petRide.mid: ${ride.length - offset} trailing bytes`);

const chs = JSON.parse(
  readFileSync(resolve(root, "modules/script/decoded/data__script__chs.mid.json"), "utf8"),
).rows.map((row) => (Array.isArray(row) ? row.join("") : String(row)));

// `aD = m.R[4]` with `m.R = petRide[v[scene] + room]`: every room's area.
const roomArea = {};
for (let scene = 0; scene < sceneRows.length; scene++) {
  const first = sceneRows[scene],
    next = scene + 1 < sceneRows.length ? sceneRows[scene + 1] : rideRows.length;
  for (let room = 0; first + room < next; room++)
    roomArea[`${scene}:${room}`] = rideRows[first + room][4];
}

const quads = (values) => {
  const out = [];
  for (let i = 0; i < values.length; i += 4)
    out.push({ scene: values[i], room: values[i + 1], x: values[i + 2], y: values[i + 3] });
  return out;
};

const areas = aS.map((rooms, area) => {
  const cells = [];
  for (let i = 0; i < rooms.length; i += 7) {
    const [x, y, scene, room, nameRow, w, h] = rooms.slice(i, i + 7);
    cells.push({ x, y, scene, room, nameRow, name: chs[nameRow] ?? "", w, h });
  }
  return {
    fill: aR[area * 2],
    text: aR[area * 2 + 1],
    blocksX: aT[area * 2],
    blocksY: aT[area * 2 + 1],
    rooms: cells,
  };
});

const document = {
  schema: "vqsv-webnative-area-maps-v1",
  source:
    "Original game state 4 (game/l.java): aS/aR/aT/aP/aQ/as/v constants, petRide.mid column 4 for each room's area, chs.mid rows for the names. Exported by scripts/export-area-maps.mjs.",
  noMapScenes,
  roomArea,
  areas,
  gymDoors: quads(aP),
  docks: quads(aQ),
};
const out = resolve(process.cwd(), "public/pack/story/area-maps.json");
writeFileSync(out, `${JSON.stringify(document, null, 1)}\n`);
console.log(
  `area maps: ${areas.length} areas, ${Object.keys(roomArea).length} rooms, ${document.gymDoors.length} gym doors, ${document.docks.length} docks -> ${out}`,
);
