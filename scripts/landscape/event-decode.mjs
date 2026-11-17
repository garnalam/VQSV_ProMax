// Decodes a Liệt Hỏa scene_N.mid event file the way the game reads it: game/l.java a(int,int,String)
// (strings, room name, actors) and game/e.java + b/a.java + b/b.java (event groups, records). On the
// JAR originals it reproduces modules/event/decoded byte for byte; the APK files read the same way.
import { readFileSync } from "node:fs";
export function decodeScene(file, sceneId) {
  const b = readFileSync(file);
  let o = 0;
  const s16 = () => { const v = b.readInt16BE(o); o += 2; return v; };
  const s8 = () => { const v = b.readInt8(o); o += 1; return v; };
  const chars = (n) => { let s = ""; for (let i = 0; i < n; i++) { s += String.fromCharCode(b.readUInt16BE(o)); o += 2; } return s; };
  const count = s16(), sizes = [];
  for (let i = 0; i < count; i++) sizes.push(b.readUInt16BE(o + i * 2));
  o += count * 2;
  const rooms = [];
  let start = o;
  for (let r = 0; r < count; r++) {
    o = start;
    const nPool = s16();
    let pool = null;
    if (nPool > 0) { pool = []; for (let i = 0; i < nPool; i++) pool.push(chars(s16())); }
    const name = chars(s8());
    const unknown_ab = s16(), unknown_skip = s16(), nActors = s16();
    const actors = [];
    for (let i = 0; i < nActors; i++) {
      const len = s16(), v = new Array(len).fill(0);
      v[0] = s8(); v[1] = s16(); v[2] = s16(); v[3] = s16(); v[4] = s16(); v[5] = s8(); v[6] = s8();
      switch (v[0]) {
        case 1: v[7] = s8(); v[8] = s16(); v[9] = s16(); v[10] = s16(); break;
        case 2: v[7] = s16(); if (v[7] === 1) { for (let k = 8; k <= 12; k++) v[k] = s8(); } break;
        case 0: v[7] = s8(); v[8] = s8(); v[9] = s8(); v[10] = s8(); v[11] = s16(); v[12] = s16(); break;
        case 3: v[7] = s8(); v[8] = s8(); v[9] = s8(); v[10] = s16(); v[11] = s16(); break;
      }
      actors.push({ kind: v[0], param_len: len, values: v });
    }
    const post = [];
    if (nActors > 0) { const n = s16(); for (let i = 0; i < n; i++) post.push(chars(s8())); }
    const nGroups = s16(), groups = [];
    for (let g = 0; g < nGroups; g++) {
      const nRec = s16(), records = [];
      for (let k = 0; k < nRec; k++) {
        const opcode = s16(), total = s8(), nShort = s8(), short_args = [];
        for (let i = 0; i < nShort; i++) short_args.push(s16());
        const string_args = [];
        if (pool) for (let i = 0; i < total - nShort; i++) { const si = s16(); string_args.push({ string_index: si, text: pool[si] }); }
        records.push({ opcode, total_arg_count: total, short_args, string_args });
      }
      groups.push({ group_index: g, scene_id: sceneId, room_index: r, world_key: (sceneId << 8) | r, record_count: nRec, records });
    }
    rooms.push({ room_index: r, block_size: sizes[r], room_start: start, room_name: name, string_pool_count: nPool,
      string_pool: pool ?? [], unknown_ab, unknown_skip, actor_count: nActors, actors, post_actor_strings: post,
      event_group_count: nGroups, event_groups: groups, bytes_consumed_in_room: o - start, declared_block_size: sizes[r] });
    start += sizes[r];
  }
  return { format: "event_scene", scene_id: sceneId, block_count: count, block_sizes: sizes, rooms };
}
