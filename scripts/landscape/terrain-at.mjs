// Terrain (collision) agreement between old and APK maps at the pixel-matched shift (pixel.txt).
// Prints: id dx dy pixel terrain  (terrain = share of old cells whose class 0/1/2/3 agrees).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function terrain(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const byte = () => view.getInt8(p++),
    short = () => {
      const v = view.getInt16(p, false);
      p += 2;
      return v;
    };
  const compact = byte() === 1,
    size = () => (compact ? byte() : short());
  byte();
  const w = size(),
    h = size();
  byte();
  const layers = byte();
  let cells = null;
  for (let o = 0; o < layers; o++) {
    const index = byte(),
      type = byte(),
      count = short(),
      grid = new Array(w * h).fill(-1);
    for (let r = 0; r < count; r++) {
      const x = compact ? byte() : short(),
        y = compact ? byte() : short(),
        raw = short();
      if (type === 0) grid[x * h + y] = raw & 0xfff;
      else if (type === 1) grid[x * h + y] = raw;
    }
    if (index === 0) cells = grid;
  }
  const cls = (v) => (v === 1 ? 1 : v === 2 ? 2 : v === 3 ? 3 : 0);
  return { w, h, at: (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 1 : cls(cells[x * h + y])) };
}

const [oldDir, newDir, pixelFile, out] = process.argv.slice(2);
const rows = [];
for (const line of readFileSync(pixelFile, "utf8").trim().split(/\r?\n/)) {
  const [id, , , dx, dy, pixel] = line.split(" ");
  if (pixel === undefined || line.includes("ERROR")) continue;
  const a = terrain(readFileSync(join(oldDir, `map_${id}.mid`))),
    b = terrain(readFileSync(join(newDir, `map_${id}.mid`)));
  let hit = 0;
  for (let x = 0; x < a.w; x++)
    for (let y = 0; y < a.h; y++) if (a.at(x, y) === b.at(x + +dx, y + +dy)) hit++;
  rows.push({
    id: +id,
    dx: +dx,
    dy: +dy,
    pixel: +pixel,
    terrain: +(hit / (a.w * a.h)).toFixed(3),
    oldW: a.w,
    oldH: a.h,
    newW: b.w,
    newH: b.h,
  });
}
writeFileSync(out, JSON.stringify(rows, null, 1));
for (const r of rows.filter((r) => r.pixel < 0.9 || r.terrain < 0.9))
  console.log(`map_${r.id} shift(${r.dx},${r.dy}) pixel=${r.pixel} terrain=${r.terrain}`);
console.log(
  `ok (pixel>=0.8 & terrain>=0.9): ${rows.filter((r) => r.pixel >= 0.8 && r.terrain >= 0.9).length}/${rows.length}`,
);
