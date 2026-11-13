import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { sourcePackRoot } from "./source-pack.mjs";
const root = resolve(sourcePackRoot(), "modules", "event", "decoded"),
  output = resolve(process.cwd(), "public", "pack", "story", "event-scenes.json");
const names = (await readdir(root))
  .filter((name) => /^data__event__scene_\d+\.(mid|mib)\.json$/.test(name))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const scenes = [];
for (const name of names) {
  const source = JSON.parse(await readFile(join(root, name), "utf8"));
  const rooms = (source.rooms ?? []).map((room) => ({
    roomIndex: room.room_index,
    roomName: room.room_name,
    blockSize: room.block_size,
    roomStart: room.room_start,
    stringPool: room.string_pool,
    actors: room.actors,
    eventGroups: room.event_groups,
    postActorStrings: room.post_actor_strings,
    unknownAb: room.unknown_ab,
    unknownSkip: room.unknown_skip,
  }));
  scenes.push({
    format: source.format,
    sceneId: source.scene_id ?? null,
    sourceFile: `modules/event/decoded/${name}`,
    blockCount: source.block_count ?? null,
    blockSizes: source.block_sizes ?? [],
    rooms,
    root: source.root ?? null,
    signature: source.signature ?? null,
  });
}
await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  JSON.stringify(
    {
      format: "vqsv-source-event-registry",
      version: 1,
      generatedFrom: "modules/event/decoded",
      sceneCount: scenes.length,
      scenes,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Exported source event registry scenes=${scenes.length} rooms=${scenes.reduce((n, s) => n + s.rooms.length, 0)} -> ${output}`,
);
