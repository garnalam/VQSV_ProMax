// Export the JavaSE map terrain grid (GameMap.load) into a browser-ready collision
// artifact for every map the runtime already loads. Reads the pack binaries only.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sourcePackRoot } from "./source-pack.mjs";

const mapsRoot = resolve(sourcePackRoot(), "modules", "map", "original"),
  roomsFile = resolve(process.cwd(), "public", "pack", "world", "rooms.json"),
  mapsOut = resolve(process.cwd(), "public", "pack", "world", "maps");

// Java BinaryReader: readByte() is a signed byte, readShort() is a signed BE int16.
function reader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let position = 0;
  const take = (size, read) => {
    if (position + size > bytes.byteLength)
      throw new Error(`Map read overran ${bytes.byteLength} bytes at ${position}`);
    const value = read(position);
    position += size;
    return value;
  };
  return {
    byte: () => take(1, (p) => view.getInt8(p)),
    short: () => take(2, (p) => view.getInt16(p, false)),
    consumed: () => position,
    total: bytes.byteLength,
  };
}

// GameMap.load: the compact flag picks 1- or 2-byte sizes and cell coordinates; layer
// type 0 keeps raw & 0x0FFF, type 1 keeps the raw short, other types are sparse rows.
function decodeMap(bytes, mapId) {
  const source = reader(bytes),
    compact = source.byte() === 1,
    size = () => (compact ? source.byte() : source.short()),
    modId = source.byte(),
    widthTiles = size(),
    heightTiles = size(),
    tileSize = source.byte(),
    layerCount = source.byte(),
    layers = [];
  if (widthTiles <= 0 || heightTiles <= 0 || tileSize <= 0 || layerCount <= 0)
    throw new Error(`map_${mapId}: implausible header (${widthTiles}x${heightTiles}@${tileSize})`);
  for (let order = 0; order < layerCount; order++) {
    const layerIndex = source.byte(),
      layerType = source.byte(),
      recordCount = source.short(),
      cells = new Array(widthTiles * heightTiles).fill(-1);
    for (let record = 0; record < recordCount; record++) {
      const x = compact ? source.byte() : source.short(),
        y = compact ? source.byte() : source.short(),
        raw = source.short();
      if (layerType === 0) cells[x * heightTiles + y] = raw & 0x0fff;
      else if (layerType === 1) cells[x * heightTiles + y] = raw;
    }
    if (layerIndex >= 0 && layerIndex < layerCount) layers[layerIndex] = { layerType, cells };
  }
  const terrain = layers[0];
  if (!terrain) throw new Error(`map_${mapId}: layer 0 was never written`);
  return { modId, widthTiles, heightTiles, tileSize, layerCount, terrain, source };
}

// WorldEngine.passable: terrain 1 blocks, terrain 2 blocks until badge id 3 (Thuy Lam);
// every other code, including the -1 default and 0, is walkable. Terrain 3 keeps its own class:
// it is walkable, but XhtC3Runtime.tickIceWorld slides the hero across it (Tương Quân Giải's ice,
// 10:0) and the raw-terrain checks that test for 0 see it as the source does.
// Bug fix: Cầu Vồng's clouds (4) need the sky ride (CauVongTerrainMechanisms.movementTerrain); folding
// them into 0 let any mount walk the sky of 24, 25, 26 and 49.
const terrainClass = (value) =>
  value === 1 ? "1" : value === 2 ? "2" : value === 3 ? "3" : value === 4 ? "4" : "0";

function collisionDocument(mapId, map) {
  const { modId, widthTiles, heightTiles, tileSize, terrain, source, layerCount } = map,
    histogram = {};
  for (const value of terrain.cells) histogram[value] = (histogram[value] ?? 0) + 1;
  const rows = [];
  for (let y = 0; y < heightTiles; y++) {
    let row = "";
    for (let x = 0; x < widthTiles; x++) row += terrainClass(terrain.cells[x * heightTiles + y]);
    rows.push(row);
  }
  return {
    format: "vqsv-web-map-collision",
    version: 1,
    mapId,
    modId,
    tileSize,
    widthTiles,
    heightTiles,
    widthPixels: widthTiles * tileSize,
    heightPixels: heightTiles * tileSize,
    layerCount,
    terrainLayerType: terrain.layerType,
    classes: {
      0: "passable",
      1: "blocked",
      2: "badge-gated until badge 3",
      ...(histogram[3] ? { 3: "passable; ice in XhtC3Runtime's room (10:0)" } : {}),
      ...(histogram[4] ? { 4: "Cầu Vồng clouds: the sky ride only" } : {}),
    },
    rows,
    histogram,
    sourceBytes: { consumed: source.consumed(), total: source.total },
  };
}

const rooms = JSON.parse(await readFile(roomsFile, "utf8")).rooms,
  only = process.argv.slice(2).map(Number),
  mapIds = [...new Set(Object.values(rooms).map((room) => room.mapId))]
    .filter((id) => only.length === 0 || only.includes(id))
    .sort((a, b) => a - b);
for (const mapId of mapIds) {
  const bytes = await readFile(resolve(mapsRoot, `map_${mapId}.mid`)),
    map = decodeMap(bytes, mapId),
    document = collisionDocument(mapId, map),
    count = (digit) =>
      document.rows.reduce((sum, row) => sum + [...row].filter((c) => c === digit).length, 0),
    target = resolve(mapsOut, String(mapId), "collision.json");
  await writeFile(target, `${JSON.stringify(document, undefined, 2)}\n`, "utf8");
  console.log(
    `map_${mapId} ${document.widthTiles}x${document.heightTiles}@${document.tileSize} ` +
      `layerType=${document.terrainLayerType} blocked=${count("1")} badgeGated=${count("2")} ` +
      `bytes=${document.sourceBytes.consumed}/${document.sourceBytes.total}`,
  );
}
console.log(`Exported collision for ${mapIds.length} maps referenced by rooms.json`);
