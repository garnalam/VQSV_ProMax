// Every Liệt Hỏa side quest (data/quest/branch-tasks.json) in the landscape game's layout (APK actors
// and events applied, as GameApp does): accepted at its offer, each step's objective granted, and
// handed in on foot from a doorway of the step's room. A quest that cannot be finished fails here.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal(
  "Image",
  class {
    complete = true;
    naturalWidth = 1;
    width = 1;
    height = 1;
    src = "";
  },
);
vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(
    import.meta.dirname,
    "../../../public",
    decodeURIComponent(String(input).split("?")[0].replace(/^\//, "")),
  );
  if (!existsSync(file)) return { ok: false, status: 404 };
  const bytes = readFileSync(file);
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(bytes.toString("utf8")),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
  };
});

const { Pack } = await import("../../pack/Pack");
const { loadBootAssets } = await import("../../pack/boot");
const { GameAssets } = await import("../story/GameAssets");
const { applyApkActors, applyApkEvents } = await import("../world/ApkActors");
const { MemorySaveStore } = await import("../../persistence/save/SaveStore");
const { SaveRepository } = await import("../../persistence/SaveRepository");
const { SaveService } = await import("../../persistence/SaveService");
const { scene1Save } = await import("../../dev/parityCheckpoints");
const { SCENE1_RESUME } = await import("../../persistence/save/migrations");
const { GameplayHost, gameplaySources } = await import("./GameplayHost");
const { apkWalker, doorArrival } = await import("./ApkWalk");
type GameSave = import("../../persistence/save/GameSave").GameSave;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
applyApkActors(await pack.json("world.apk-actors"), assets.rooms, boot.sourceEvents);
applyApkEvents(await pack.json("world.apk-events"), boot.sourceEvents);
const sources = gameplaySources(assets, boot);
const walker = apkWalker(sources, assets, boot.sourceEvents);
const PARTY = [68, 1, 19, 34, 50].map((speciesId) => ({ speciesId, level: 80, quality: 4 }));
// Rooms load asynchronously in the game; here every Liệt Hỏa room is ready before the walk.
for (const key of Object.keys(assets.rooms)) {
  if (key.endsWith("#world") || key.startsWith("98:") || key.startsWith("-1:")) continue;
  const [scene, room] = key.split(":").map(Number);
  await assets.prepareRoom(scene, room);
}


type Task = { id: number; name: string; offer: Ref; completion: Ref };
type Ref = { scene: number; room: number; group: number };
const TASKS = (await pack.json<{ tasks: Task[] }>("data.quest/branch-tasks.json")).tasks;

/** Every op43/op44 row of a side quest: its offer, its middle steps and its hand-in. */
function steps(task: Task) {
  const out: { ref: Ref; op: number; args: number[] }[] = [];
  for (const scene of boot.sourceEvents.document.scenes)
    for (const room of scene.rooms)
      for (const group of room.eventGroups)
        for (const r of group.records)
          if ((r.opcode === 43 || r.opcode === 44) && r.short_args[0] === task.id && r.short_args[1] === 1)
            out.push({ ref: { scene: scene.sceneId ?? -1, room: room.roomIndex, group: group.group_index }, op: r.opcode, args: r.short_args });
  return out;
}

function startSave(location: GameSave["location"], task: number): GameSave {
  const base = new GameplayHost(
    sources,
    new SaveService(new SaveRepository(new MemorySaveStore())),
    { onExit: () => {} },
    { kind: "resume", save: scene1Save({ location, owner: SCENE1_RESUME.bunnyReturnRoom0, bunnyCaught: true, pets: PARTY }) },
  );
  const save = base.snapshot(base.world!);
  return {
    ...save,
    location,
    progress: { ...save.progress, mainTaskProgress: task },
    world: { ...save.world!, mainTaskProgress: task },
  };
}

/** Every spot the hero can walk in at, one per room that has a door into it. */
function entrances(scene: number, room: number) {
  const out: ReturnType<typeof doorArrival>[] = [];
  for (const k of Object.keys(assets.rooms)) {
    if (k.includes("#")) continue;
    const [s, r] = k.split(":").map(Number);
    try {
      const at = doorArrival(boot.sourceEvents, assets, scene, room, { scene: s, room: r });
      if (!out.some((o) => o.x === at.x && o.y === at.y)) out.push(at);
    } catch {
      // No door from that room.
    }
  }
  return out;
}

/** Plays a step from the first entrance of its room it can be reached from. */
async function playAt(save: GameSave, ref: Ref, choices: number[]) {
  const errors: string[] = [];
  for (const at of entrances(ref.scene, ref.room)) {
    const game = walker.open({ ...save, location: at });
    try {
      await game.play(ref.scene, ref.room, ref.group, { choices });
      return game;
    } catch (error) {
      errors.push((error as Error).message.slice(0, 160));
    }
  }
  throw new Error(errors.join(" || ") || `no way into ${ref.scene}:${ref.room}`);
}
/** YaQila's quiz (23): the fourth answer, as the story walk takes it. */
/** The hand-in's own question: Hughes's password is "Phong Điểu", the second answer. */
const CHOICES: Record<number, number[]> = { 18: [1], 23: [3] };

const key = (r: Ref) => `${r.scene}:${r.room}:${r.group}`;

// A hand-in reads the Đồ giám as the original does (game/e.java b(b.b) case 0): each catch, hatch
// or evolution quest here is granted through the collection only, never by a pet in the party.
describe("every Liệt Hỏa side quest, accepted and handed in on foot (APK layout)", () => {
  it("reports which ones cannot be finished", async () => {
    const report: string[] = [];
    for (const task of TASKS) {
      const rows = steps(task),
        stepKeys = new Set(rows.map((r) => key(r.ref)));
      let game: ReturnType<typeof walker.open> | undefined;
      try {
        // Bạch Long Thành and Tachi (scenes 7, 8) open late: the main story and every badge.
        const late = task.offer.scene >= 7 || task.completion.scene >= 7,
          save = startSave(doorArrival(boot.sourceEvents, assets, task.offer.scene, task.offer.room), late ? 46 : 30);
        if (late) save.world = { ...save.world!, badgesAchieved: Array.from({ length: 8 }, () => 1) };
        // Dây cương 3 (Hải âu): the way up to Thiên Giới, owned by anyone who got there.
        if (late && !(save.inventory.specials ?? []).includes(3)) save.inventory = { ...save.inventory, specials: [...(save.inventory.specials ?? []), 3] };
        // Gates outside the quest's own steps (story beats, prerequisites) count as played.
        const states: Record<string, number> = { ...save.eventStates };
        // Late quests: the story played up to them (every group of scenes 1–8 and the side rooms,
        // bar this quest's own steps and the groups waiting on them), as a real save there has.
        if (late)
          for (const scene of boot.sourceEvents.document.scenes) {
            const id = scene.sceneId ?? -1;
            if (id < 1 || id > 11 || id === 10 || id === 9 || id === 7) continue;
            for (const room of scene.rooms)
              for (const group of room.eventGroups) {
                const k = `${id}:${room.roomIndex}:${group.group_index}`;
                if (stepKeys.has(k)) continue;
                const waits = group.records.some(
                  (x) => (x.opcode === 15 || x.opcode === 86) && stepKeys.has(x.short_args.slice(0, 3).join(":")),
                );
                const branch = group.records.some((x) => x.opcode === 43 || x.opcode === 44);
                if (!waits && !branch) states[k] = 3;
              }
          }
        // A chain's earlier quests (Dây may mắn 1 and 2 before 3) are done by then.
        for (const other of TASKS)
          if (other.id < task.id) for (const row of steps(other)) if (!stepKeys.has(key(row.ref))) states[key(row.ref)] = 3;
        for (const row of rows) {
          const g = boot.sourceEvents.group(row.ref.scene, row.ref.room, row.ref.group)!;
          for (const r of g.records)
            if ((r.opcode === 15 || r.opcode === 86) && !stepKeys.has(r.short_args.slice(0, 3).join(":")))
              states[r.short_args.slice(0, 3).join(":")] = 3;
          const pre = { scene: row.args[5], room: row.args[6], group: row.args[7] };
          if (pre.group >= 0 && !stepKeys.has(key(pre))) states[key(pre)] = 3;
        }
        game = await playAt({ ...save, eventStates: states }, task.offer, [0]);
        const w = () => game!.world();
        const log = () => game!.host.director?.log;
        // Zuzu (22) takes the party at once when it already shows the four elements.
        if (log()?.branchStatus(task.id) !== 1 && !(task.id === 22 && log()?.branchStatus(task.id) === 3))
          throw new Error(`after the offer status ${log()?.branchStatus(task.id)}`);
        // The middle steps, then the hand-in; each objective granted just before its step.
        const rest = rows.filter((r) => key(r.ref) !== key(task.offer));
        rest.sort((a, b) => (a.op === 44 ? 1 : 0) - (b.op === 44 ? 1 : 0));
        for (const row of rest) {
          if (w().eventState.sourceEventState(row.ref.scene, row.ref.room, row.ref.group) >= 3) continue;
          const a = row.args;
          if (a[8] === 0) w().collection.markCollected(a[10]);
          if (a[8] === 1) w().flags.mutateSourceWorldFlag(0, a[9]);
          if (a[8] === 3) w().inventory[String(a[9])] = Math.max(w().inventory[String(a[9])] ?? 0, a[10]);
          if ((a[8] === 2 || a[8] === 4) && a[7] >= 0 && !stepKeys.has(`${a[5]}:${a[6]}:${a[7]}`))
            w().eventState.op23MarkEventComplete(a[5], a[6], a[7]);
          // Each step from its own room's doorway (the walk across the map is the story tests' job).
          game = await playAt(await game.snapshot(), row.ref, CHOICES[task.id] ?? [0]);
        }
        const status = log()?.branchStatus(task.id);
        report.push(`${status === 3 ? "OK " : "LỖI"} ${task.id} ${task.name}: trạng thái ${status} (${rest.map((r) => key(r.ref)).join(", ")})`);
      } catch (error) {
        report.push(`LỖI ${task.id} ${task.name}: ${(error as Error).message.slice(0, 300)} | trạng thái ${game?.host.director?.log.branchStatus(task.id)}`);
      }
    }
    console.log("BRANCH REPORT\n" + report.join("\n"));
    expect(report.length).toBe(TASKS.length);
    expect(report.filter((line) => !line.startsWith("OK"))).toEqual([]);
  }, 3_600_000);
});
