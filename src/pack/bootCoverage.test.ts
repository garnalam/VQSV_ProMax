import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Node has no image decoder. The loader only needs to know a file came back, so every pack image is
 * a stand-in that reports itself loaded the moment `src` is set; the JSON and binary resources are
 * the real files from public/.
 */
class StubImage {
  complete = false;
  naturalWidth = 1;
  naturalHeight = 1;
  width = 1;
  height = 1;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private source = "";
  set src(value: string) {
    this.source = value;
    requested.add(value);
    this.complete = true;
  }
  get src(): string {
    return this.source;
  }
}

/** Every file the startup path asked the pack for, by url, however it was asked. */
const requested = new Set<string>();

vi.stubGlobal("Image", StubImage);
vi.stubGlobal("fetch", async (input: string) => {
  const url = String(input).split("?")[0];
  requested.add(url);
  const file = resolve(
    import.meta.dirname,
    "../../public",
    decodeURIComponent(url.replace(/^\//, "")),
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

const { BootProgress } = await import("./BootProgress");
const { Pack } = await import("./Pack");
const { loadBootAssets } = await import("./boot");
const { GameAssets } = await import("../game/story/GameAssets");
const { BootLoaderRenderer } = await import("../rendering/BootLoaderRenderer");

describe("the boot loader counts the whole startup", () => {
  it("books and completes every file the real boot path asks for", async () => {
    requested.clear();
    const progress = new BootProgress();
    const pack = await Pack.load(progress);
    const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
    expect(boot.battleLayout).toBeDefined();
    expect(assets.roomName(1, 0)).not.toBe("");
    // Nothing fetched by boot escaped the counter, and nothing the counter named was never fetched.
    expect(progress.total).toBe(requested.size);
    expect(progress.loaded).toBe(requested.size);
    // Most of these are the room layers and actor frames the startup preloads, not the hand-written
    // lists: the floor is here to fail loudly if a whole group stops being counted.
    expect(progress.total).toBeGreaterThan(1000);
    expect(progress.fraction()).toBe(1);
  });

  it("fills the whole bar once the files are in", async () => {
    requested.clear();
    const progress = new BootProgress();
    const pack = await Pack.load(progress);
    await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
    const noContext = {} as CanvasRenderingContext2D;
    expect(new BootLoaderRenderer(noContext, progress).progressPixels()).toBe(148);
    const nothingBack = new BootProgress();
    nothingBack.book("/pack/pack.json");
    expect(new BootLoaderRenderer(noContext, nothingBack).progressPixels()).toBe(0);
  });
});
