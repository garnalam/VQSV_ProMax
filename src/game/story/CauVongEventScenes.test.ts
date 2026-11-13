import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { StoryDataRegistry, type StorySourceRegistryDocument } from "./StoryDataRegistry";
import { DoorGraph } from "./StoryGraph";

type ArgSpec = { name: string; signed?: boolean };
type OpSpec = {
  op: number;
  name: string;
  args?: ArgSpec[];
  layout?: "choice" | "dialogue" | "card" | "pairs";
  status: string;
  policy: string;
  meaning: string;
  evidence: string[];
  lietHoa: { op: number; note: string } | null;
  ir: string | null;
};
type OpTable = {
  schema: string;
  statusLevels: Record<string, string>;
  policies: Record<string, string>;
  opcodes: OpSpec[];
};
type JarIndex = {
  provenance: { jar_sha256: string };
  failures: { map: number; event: number; error: string }[];
  maps: {
    map: number;
    events: {
      id: number;
      bytes: number;
      commands: { offset: number; opcode: number; args_hex: string }[];
    }[];
  }[];
};

const read = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const table = read<OpTable>("public/pack/story/cau-vong-opcodes.json"),
  cauVong = read<StorySourceRegistryDocument & { summary: Record<string, unknown> }>(
    "public/pack/story/cau-vong-event-scenes.json",
  ),
  lietHoa = read<StorySourceRegistryDocument>("public/pack/story/event-scenes.json"),
  // The jar index the bake reads (`ExportCauVongEventScenes`), straight from the Java resources.
  // It is only there when web-native sits in the VQSV-WebNative tree; a standalone clone skips the
  // checks that compare against it, as it skips the oracle/ suite.
  jarPath = "../rebuild_game/src/main/resources/vqsv/data/cau-vong/jar-source-index.json",
  jarIndex = existsSync(jarPath) ? read<JarIndex>(jarPath) : null,
  jar = jarIndex as JarIndex,
  specs = new Map(table.opcodes.map((spec) => [spec.op, spec])),
  scene = cauVong.scenes[0];
/** A check against the Java jar index: skipped when the Java tree is not next to web-native. */
const withJar = it.skipIf(jarIndex === null);

/** The RuntimeStoryEvent kinds the Liệt Hỏa compiler already produces. */
const SHARED_EVENTS = new Set([
  "text",
  "delay",
  "effect",
  "active",
  "hide",
  "move",
  "cameraActor",
  "action",
  "actorEffect",
  "load",
  "place",
  "item",
  "battle",
  "retire",
  "markComplete",
  "savePrompt",
]);

describe("Cầu Vồng opcode table", () => {
  withJar("declares every opcode the JAR script uses, once, and nothing else", () => {
    const used = new Set(
      jar.maps.flatMap((map) => map.events.flatMap((event) => event.commands.map((c) => c.opcode))),
    );
    expect([...specs.keys()].sort((a, b) => a - b)).toEqual([...used].sort((a, b) => a - b));
    expect(specs.size).toBe(table.opcodes.length);
  });

  it("gives every opcode a meaning, evidence, a known status and a policy that fits it", () => {
    for (const spec of table.opcodes) {
      const at = `op${spec.op}`;
      expect(Object.keys(table.statusLevels), at).toContain(spec.status);
      expect(Object.keys(table.policies), at).toContain(spec.policy);
      expect(spec.meaning.length, at).toBeGreaterThan(10);
      expect(spec.evidence.length, at).toBeGreaterThan(0);
      expect(!!spec.args !== !!spec.layout, `${at} needs exactly one of args/layout`).toBe(true);
      // Nothing is executed on a guess: unknown opcodes stay opaque, and only what Java itself
      // presents may be compiled straight to a presentation event.
      if (spec.status === "unknown") expect(spec.policy, at).toBe("opaque");
      if (spec.policy === "present") {
        expect(spec.status, at).toBe("java-executed");
        expect(spec.ir, at).not.toBeNull();
      }
      if (spec.ir !== null) expect(SHARED_EVENTS.has(spec.ir), `${at} → ${spec.ir}`).toBe(true);
    }
  });

  it("names the Liệt Hỏa counterpart without assuming the numbers agree", () => {
    const sameNumberSameMeaning = table.opcodes.filter((spec) => spec.lietHoa?.op === spec.op);
    expect(sameNumberSameMeaning.map((spec) => spec.op)).toEqual([]);
    // The well-known clashes the dialect split exists for.
    expect(specs.get(12)?.name).toBe("choice");
    expect(specs.get(47)?.lietHoa?.op).toBe(12);
    expect(specs.get(28)?.lietHoa?.op).toBe(4);
  });
});

describe("Cầu Vồng events in the shared registry format", () => {
  withJar(
    "is scene 98 in the Cầu Vồng dialect, one room per map and one group per source event",
    () => {
      expect(cauVong.format).toBe(lietHoa.format);
      expect(cauVong.scenes).toHaveLength(1);
      expect(scene.sceneId).toBe(98);
      expect(scene.dialect).toBe("cau-vong");
      expect(scene.rooms.map((room) => room.roomIndex)).toEqual(jar.maps.map((map) => map.map));
      for (const map of jar.maps) {
        const room = scene.rooms[map.map];
        expect(room.eventGroups.map((g) => g.group_index)).toEqual(map.events.map((e) => e.id));
        for (const event of map.events) {
          const group = room.eventGroups[event.id];
          expect(group.record_count).toBe(group.records.length);
          expect(group.records.map((r) => r.offset)).toEqual(event.commands.map((c) => c.offset));
          expect(group.bytes).toBe(event.bytes);
        }
      }
      expect(cauVong.summary).toMatchObject({
        rooms: 68,
        groups: 409,
        framingWarnings: jar.failures.length,
      });
    },
  );

  it("decodes every fixed-size command exactly as the table declares, signed bytes included", () => {
    for (const room of scene.rooms)
      for (const group of room.eventGroups)
        for (const record of group.records) {
          const spec = specs.get(record.opcode)!,
            bytes = (record.args_hex!.match(/../g) ?? []).map((h) => parseInt(h, 16));
          expect(record.total_arg_count).toBe(bytes.length);
          if (!spec.args) continue;
          expect(record.short_args).toEqual(
            bytes.map((b, i) => (spec.args![i].signed && b > 127 ? b - 256 : b)),
          );
        }
  });

  it("carries text as string arguments pooled per room, dialogue as speaker + line", () => {
    let lines = 0;
    for (const room of scene.rooms)
      for (const group of room.eventGroups)
        for (const record of group.records) {
          for (const arg of record.string_args)
            expect(room.stringPool[arg.string_index]).toBe(arg.text);
          if (record.opcode === 28) {
            lines++;
            expect(record.string_args).toHaveLength(2);
            expect(record.string_args[1].text).not.toMatch(/#[0-9]/);
          }
          if (record.opcode === 51) {
            lines++;
            expect(record.string_args).toHaveLength(1);
          }
        }
    expect(lines).toBe(cauVong.summary.textLines);
    // The patched build rewrites the protagonist's lines; the export shows what Java shows.
    const register = scene.rooms[2].eventGroups[1].records.find((r) => r.offset === 103)!;
    expect(register.sourceText).toBe("Tắc Kỳ.");
    expect(register.string_args.map((a) => a.text)).toEqual([
      "Bạn",
      "Tôi vừa đến từ Bộ lạc và muốn đăng ký nhập học.",
    ]);
  });

  it("lands every choice on a command of the same group", () => {
    for (const room of scene.rooms)
      for (const group of room.eventGroups) {
        const offsets = new Set(group.records.map((r) => r.offset));
        for (const record of group.records.filter((r) => r.opcode === 12)) {
          expect(record.string_args.length).toBe(record.short_args.length);
          for (const target of record.short_args)
            expect(
              offsets.has(target) || target === group.bytes,
              `${room.roomIndex}:${group.group_index} choice → ${target}`,
            ).toBe(true);
        }
      }
  });

  withJar(
    "keeps the unverified op13 tails visible on their groups instead of guessing them",
    () => {
      const flagged = scene.rooms.flatMap((room) =>
        room.eventGroups
          .filter((g) => (g.framingWarnings ?? []).length > 0)
          .map((g) => `${room.roomIndex}:${g.group_index}`),
      );
      expect(flagged.sort()).toEqual(
        [...new Set(jar.failures.map((f) => `${f.map}:${f.event}`))].sort(),
      );
    },
  );

  it("records which groups the patched build presents", () => {
    const reviewed = scene.rooms.flatMap((room) =>
      room.eventGroups.filter((g) => g.presentation?.reviewed),
    );
    expect(reviewed.length).toBe(cauVong.summary.reviewedGroups);
    expect(scene.rooms[2].eventGroups[1].presentation?.reviewed).toBe(true);
  });
});

describe("one registry for Liệt Hỏa and Cầu Vồng", () => {
  const registry = StoryDataRegistry.combine(lietHoa, cauVong);

  it("serves both games through the same lookups, each in its own dialect", () => {
    expect(registry.dialect(1)).toBe("lh");
    expect(registry.dialect(98)).toBe("cau-vong");
    expect(registry.group(1, 0, 2)?.records.length).toBeGreaterThan(0);
    expect(registry.group(98, 2, 1)?.records[0].opcode).toBe(2);
    expect(() => StoryDataRegistry.combine(cauVong, cauVong)).toThrow(/declared twice/);
  });

  it("walks Cầu Vồng's door table in the same door graph", () => {
    const doors = new DoorGraph(registry),
      fromAcademy = doors.reachable(98, 2);
    expect(fromAcademy.has("98:1")).toBe(true);
    for (const room of scene.rooms)
      for (const door of room.doors ?? []) {
        expect(door.target, `${room.roomIndex} door ${door.row}`).toBeDefined();
        expect(door.target!.room).toBeLessThan(scene.rooms.length);
      }
    // Liệt Hỏa's graph is unchanged by the merge.
    expect(new DoorGraph(new StoryDataRegistry(lietHoa)).reachable(1, 0)).toEqual(
      doors.reachable(1, 0),
    );
  });
});
