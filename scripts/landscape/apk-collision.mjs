// collision.json from the APK map binaries (export-map-collision.mjs's decode), with the map's
// origin (GameAssets.prepareMap sizes the rooms from it at load).
// Usage: node apk-collision.mjs <apkMapsDir> <webPackWorldDir> id:dx:dy ...
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function decodeMap(bytes, mapId) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const byte = () => view.getInt8(p++),
    short = () => {
      const v = view.getInt16(p, false);
      p += 2;
      return v;
    };
  const compact = byte() === 1,
    size = () => (compact ? byte() : short()),
    modId = byte(),
    widthTiles = size(),
    heightTiles = size(),
    tileSize = byte(),
    layerCount = byte(),
    layers = [];
  for (let order = 0; order < layerCount; order++) {
    const layerIndex = byte(),
      layerType = byte(),
      recordCount = short(),
      cells = new Array(widthTiles * heightTiles).fill(-1);
    for (let r = 0; r < recordCount; r++) {
      const x = compact ? byte() : short(),
        y = compact ? byte() : short(),
        raw = short();
      if (layerType === 0) cells[x * heightTiles + y] = raw & 0x0fff;
      else if (layerType === 1) cells[x * heightTiles + y] = raw;
    }
    if (layerIndex >= 0 && layerIndex < layerCount) layers[layerIndex] = { layerType, cells };
  }
  if (!layers[0]) throw new Error(`map_${mapId}: no terrain layer`);
  return { modId, widthTiles, heightTiles, tileSize, layerCount, terrain: layers[0], consumed: p, total: bytes.byteLength };
}

const terrainClass = (v) => (v === 1 ? "1" : v === 2 ? "2" : v === 3 ? "3" : "0");
/**
 * Tiles the APK terrain leaves open although the art shows raised ground, as [col, row, w, h].
 * Map 59 (4:10 Lối vào di tích): the widened ring round the pit (left ledge, top, right, bottom
 * row) is drawn as cliff top; only the dark path up from the west door (cols 0-3, rows 16-22) is
 * floor. Left open, the hero walked from the door round onto the ledge and could not get down.
 */
const HAND_BLOCKED = {
  59: [
    [0, 0, 23, 2],
    [0, 2, 4, 14],
    [19, 2, 4, 21],
    [5, 22, 14, 1],
  ],
};
const [apkDir, worldDir, ...specs] = process.argv.slice(2);
const origins = new Map();
for (const spec of specs) {
  const [id, dx, dy] = spec.split(":").map(Number),
    map = decodeMap(readFileSync(join(apkDir, `map_${id}.mid`)), id),
    histogram = {},
    rows = [];
  for (const v of map.terrain.cells) histogram[v] = (histogram[v] ?? 0) + 1;
  for (let y = 0; y < map.heightTiles; y++) {
    let row = "";
    for (let x = 0; x < map.widthTiles; x++) row += terrainClass(map.terrain.cells[x * map.heightTiles + y]);
    rows.push(row);
  }
  for (const [c0, r0, w, h] of HAND_BLOCKED[id] ?? [])
    for (let y = r0; y < r0 + h; y++)
      rows[y] = rows[y].slice(0, c0) + "1".repeat(w) + rows[y].slice(c0 + w);
  const originX = dx * map.tileSize,
    originY = dy * map.tileSize,
    document = {
      format: "vqsv-web-map-collision",
      version: 1,
      mapId: id,
      modId: map.modId,
      tileSize: map.tileSize,
      widthTiles: map.widthTiles,
      heightTiles: map.heightTiles,
      widthPixels: map.widthTiles * map.tileSize,
      heightPixels: map.heightTiles * map.tileSize,
      // The APK pixel where the JAR map's (0, 0) lies: the game keeps the JAR's coordinates and
      // reads this terrain at (x + originX, y + originY).
      originX,
      originY,
      source: "apk",
      layerCount: map.layerCount,
      terrainLayerType: map.terrain.layerType,
      classes: {
        0: "passable",
        1: "blocked",
        2: "badge-gated until badge 3",
        ...(histogram[3] ? { 3: "passable; ice in XhtC3Runtime's room (10:0)" } : {}),
      },
      rows,
      histogram,
      sourceBytes: { consumed: map.consumed, total: map.total },
    };
  writeFileSync(join(worldDir, "maps", String(id), "collision.json"), `${JSON.stringify(document, undefined, 2)}\n`);
  origins.set(id, { originX, originY, width: document.widthPixels, height: document.heightPixels });
}
// rooms.json is left as it is: GameAssets.prepareMap gives every room on a map with an origin
// the APK map's size and origin when the map loads.
console.log(`collision for ${origins.size} maps`);
