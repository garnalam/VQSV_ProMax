// world/apk-actors.json: where the APK's landscape scenes put each Liệt Hỏa room actor, in game
// (JAR) coordinates, so a room on an APK map shows its actors where the APK draws them.
// Usage: node apk-actors.mjs <jarEventDir> <apkEventDir> <webPackWorldDir>
//
// Each scene_N.mid room block holds its actor records in order: [len 13|11][kind 0|1][sprite s16]
// [state s16][x s16][y s16]... The APK keeps the JAR's order but moves actors and adds a few, so
// the two lists are aligned by longest common subsequence on (kind, sprite, state). An actor is
// written only when rooms.json's actor is a JAR record (same sprite and spot), and only when it
// moved. Off-stage parking (x > 900) is left alone.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function sceneRooms(file) {
  const b = readFileSync(file),
    count = b.readInt16BE(0),
    sizes = [];
  for (let i = 0; i < count; i++) sizes.push(b.readUInt16BE(2 + i * 2));
  let start = 2 + count * 2;
  const rooms = [];
  for (const size of sizes) {
    const block = b.subarray(start, start + size),
      actors = [];
    for (let o = 0; o < block.length - 10; o++) {
      const len = block[o],
        kind = block[o + 1];
      if (!((len === 13 && kind === 0) || (len === 11 && kind === 1))) continue;
      const sprite = block.readInt16BE(o + 2),
        state = block.readInt16BE(o + 4),
        x = block.readInt16BE(o + 6),
        y = block.readInt16BE(o + 8);
      if (sprite < 0 || sprite > 400 || state < 0 || state > 40) continue;
      if (x < -200 || x > 2000 || y < -200 || y > 2000) continue;
      // After y: visible, behaviour (variant) and layer bytes, then the marker animation (s16).
      const visible = block[o + 10],
        variant = block[o + 11],
        layer = block[o + 12],
        marker = o + 15 <= block.length ? block.readInt16BE(o + 13) : 0;
      actors.push({ kind, sprite, state, x, y, visible, variant, layer, marker });
    }
    rooms.push(actors);
    start += size;
  }
  return rooms;
}

/** Index pairs [i, j] of the longest common subsequence of a and b under `same`. */
function align(a, b, same) {
  const n = a.length,
    m = b.length,
    t = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      t[i][j] = same(a[i], b[j]) ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const pairs = [];
  for (let i = 0, j = 0; i < n && j < m; )
    if (same(a[i], b[j])) pairs.push([i++, j++]);
    else if (t[i + 1][j] >= t[i][j + 1]) i++;
    else j++;
  return pairs;
}

const [jarDir, apkDir, worldDir] = process.argv.slice(2),
  rooms = JSON.parse(readFileSync(join(worldDir, "rooms.json"), "utf8")).rooms,
  scenes = new Map(),
  scene = (dir, id) => {
    const key = `${dir}|${id}`;
    if (!scenes.has(key)) {
      const file = join(dir, `scene_${id}.mid`);
      scenes.set(key, existsSync(file) ? sceneRooms(file) : null);
    }
    return scenes.get(key);
  },
  out = {},
  stats = { rooms: 0, moved: 0, kept: 0, added: 0, skipped: [] };
for (const [key, room] of Object.entries(rooms)) {
  const m = key.match(/^(\d+):(\d+)(#world)?$/);
  if (!m || +m[1] > 11) continue;
  const s = +m[1],
    r = +m[2],
    jar = scene(jarDir, s)?.[r],
    apk = scene(apkDir, s)?.[r],
    collisionFile = join(worldDir, "maps", String(room.mapId), "collision.json");
  if (!jar || !apk || !existsSync(collisionFile)) {
    stats.skipped.push(key);
    continue;
  }
  const collision = JSON.parse(readFileSync(collisionFile, "utf8"));
  if (collision.source !== "apk") continue;
  const ox = collision.originX ?? 0,
    oy = collision.originY ?? 0,
    moved = {},
    // The same moves by story registry row (doors read these), which is the rooms.json actor id.
    byRecord = {};
  const pairs = align(jar, apk, (p, q) => p.kind === q.kind && p.sprite === q.sprite && p.state === q.state);
  // The actors only the APK has: kind-0 actors it shows from the start (one it keeps hidden waits
  // for an APK event this port does not run). Seated after the room's own ids.
  const paired = new Set(pairs.map(([, j]) => j)),
    added = [];
  let nextId = Math.max(-1, ...room.actors.map((a) => a.id)) + 1;
  apk.forEach((q, j) => {
    if (paired.has(j) || q.kind !== 0 || q.visible !== 1 || q.sprite < 2) return;
    // Props (0) and wandering villagers (1) only: a new cuttable tree (7), breakable rock (6) or
    // other gated obstacle has no APK event here to clear it and could wall a path off.
    if (q.variant !== 0 && q.variant !== 1) return;
    const state = q.variant === 1 || q.variant === 18 ? (q.state === 3 ? 1 : Math.max(0, Math.min(2, q.state))) : q.state;
    added.push({
      id: nextId++,
      sprite: q.sprite,
      state,
      direction: q.state,
      variant: q.variant,
      sourceKind: 0,
      renderOrientation: -1,
      renderOffsetX: 0,
      renderOffsetY: 0,
      x: q.x - ox,
      y: q.y - oy,
      visible: true,
      layer: q.layer,
      ...(q.marker > 0 ? { marker: q.marker } : {}),
    });
  });
  stats.added += added.length;
  const apkOf = new Map(pairs);
  for (const actor of room.actors) {
    // The JAR record this actor is: its own index, else the one unique record at the same sprite and
    // spot (a few Java room catalogs renumber their actors).
    const same = (q) => q.sprite === actor.sprite && q.x === actor.x && q.y === actor.y;
    let i = jar[actor.id] && same(jar[actor.id]) ? actor.id : -1;
    if (i < 0) {
      const hits = jar.flatMap((q, k) => (same(q) ? [k] : []));
      if (hits.length === 1) i = hits[0];
    }
    const j = apkOf.get(i);
    if (i < 0 || j === undefined || actor.x > 900) continue;
    const x = apk[j].x - ox,
      y = apk[j].y - oy;
    if (x === actor.x && y === actor.y) {
      stats.kept++;
      continue;
    }
    moved[actor.id] = [x, y];
    // Keyed by the actor id, which is the story registry row: `i` counts only the kind-0/1 records
    // the byte scan found, so it falls behind after every kind-3 row.
    byRecord[actor.id] = [x, y];
    stats.moved++;
  }
  if (Object.keys(moved).length || added.length)
    out[key] = { actors: moved, records: byRecord, ...(added.length ? { added } : {}) };
  stats.rooms++;
}
writeFileSync(
  join(worldDir, "apk-actors.json"),
  `${JSON.stringify({ format: "vqsv-apk-actor-positions", version: 1, rooms: out })}\n`,
);
console.log(
  `rooms=${stats.rooms} moved=${stats.moved} kept=${stats.kept} added=${stats.added} skipped=${stats.skipped.join(",")}`,
);
