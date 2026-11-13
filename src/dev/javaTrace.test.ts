import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/** Pack images are 1x1 stand-ins under Node; the host never reads pixels. */
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
    "../../public",
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

const { Pack } = await import("../pack/Pack");
const { loadBootAssets } = await import("../pack/boot");
const { GameAssets } = await import("../game/story/GameAssets");
const { MemorySaveStore } = await import("../persistence/save/SaveStore");
const { SaveRepository } = await import("../persistence/SaveRepository");
const { SaveService } = await import("../persistence/SaveService");
const { GameplayHost, gameplaySources } = await import("../game/session/GameplayHost");
type SessionStart = import("../game/session/GameplayHost").SessionStart;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);

const sources = gameplaySources(assets, boot);
const session = (start: SessionStart) => ({
  host: new GameplayHost(
    sources,
    new SaveService(new SaveRepository(new MemorySaveStore())),
    { onExit: () => {} },
    start,
  ),
});

const { recordWebTrace, diffTraces } = await import("./javaTrace");
type JavaTrace = import("./javaTrace").JavaTrace;

/** Java `Animation.cursor()`: the frame index the tick counter is on. */
const cursor = (sprite: number, state: number, tick: number): number => {
  const states = assets.sprites[String(sprite)]?.states,
    frames = states?.[String(state)] ?? states?.["0"];
  if (!frames?.length) return 0;
  const total = frames.reduce((sum, f) => sum + Math.max(1, f.ticks), 0);
  let left = total ? tick % total : 0;
  for (let i = 0; i < frames.length; i++) {
    if (left < Math.max(1, frames[i].ticks)) return i;
    left -= Math.max(1, frames[i].ticks);
  }
  return 0;
};

const TRACES = resolve(import.meta.dirname, "../../oracle/traces");
const java = (name: string) =>
  JSON.parse(readFileSync(resolve(TRACES, `${name}.java.json`), "utf8")) as JavaTrace;

/**
 * Each scenario replays the same input policy as `RecordGameplayTrace.java` and compares every tick.
 * Known divergences are pinned in `<name>.divergence.json` next to the Java trace: the test fails
 * when that summary changes, so a fix (fewer divergences) or a regression both show up as a diff.
 * After an intended change: `VQSV_RECORD_DIVERGENCE=1 npx vitest run src/dev/javaTrace.test.ts`.
 * `VQSV_WRITE_WEB_TRACE=1` also writes the web rows (`<name>.web.json`, not committed) for digging.
 */
const SCENARIOS: { name: string; start: SessionStart }[] = [
  { name: "opening", start: { kind: "opening" } },
];

describe("web gameplay against the Java trace, tick for tick", () => {
  for (const scenario of SCENARIOS)
    it(scenario.name, () => {
      const reference = java(scenario.name);
      const { host } = session(scenario.start);
      const web = recordWebTrace(host, reference.rows.length, cursor);
      if (process.env.VQSV_WRITE_WEB_TRACE)
        writeFileSync(resolve(TRACES, `${scenario.name}.web.json`), JSON.stringify(web));
      const summary = diffTraces(reference.rows, web),
        file = resolve(TRACES, `${scenario.name}.divergence.json`);
      if (process.env.VQSV_RECORD_DIVERGENCE || !existsSync(file)) {
        writeFileSync(file, JSON.stringify(summary, null, 1) + "\n");
        return;
      }
      expect(summary).toEqual(JSON.parse(readFileSync(file, "utf8")));
    });
});
