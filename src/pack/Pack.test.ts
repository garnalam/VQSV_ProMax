import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { BootProgress } from "./BootProgress";
import { Pack } from "./Pack";

const manifestText = readFileSync(new URL("../../public/pack/pack.json", import.meta.url), "utf8");

function newPack(): Promise<Pack> {
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    status: 200,
    json: async () => JSON.parse(manifestText),
  }));
  return Pack.load();
}

describe("Pack key resolution", () => {
  it("maps declared entries and templates onto pack urls", async () => {
    const pack = await newPack();
    expect(pack.url("brand.logo")).toBe("/pack/brand/logo.png");
    expect(pack.url("font.panel-metrics")).toBe("/pack/font/panel.json");
    expect(pack.url("ui-layout.battle")).toBe("/pack/ui/layout/battle.json");
    expect(pack.url("ui-cell.257.12")).toBe("/pack/ui/cell/257/cell-12.png");
    expect(pack.url("effect.fire-0")).toBe("/pack/effect/fire-0.png");
    expect(pack.url("audio.menu-0")).toBe("/pack/audio/menu-0.wav");
  });

  it("maps the world bake through its indexes and shapes", async () => {
    const pack = await newPack();
    expect(pack.url("world.rooms")).toBe("/pack/world/rooms.json");
    expect(pack.url(pack.worldKey("maps/20/meta.json"))).toBe("/pack/world/maps/20/meta.json");
    expect(pack.url(pack.worldKey("maps/20/layer-3.png"))).toBe("/pack/world/maps/20/layer-3.png");
    expect(pack.url(pack.worldKey("sprites/0/0/0-mirror.png"))).toBe(
      "/pack/world/sprites/0/0/0-mirror.png",
    );
  });

  it("refuses anything the manifest does not declare", async () => {
    const pack = await newPack();
    expect(() => pack.url("brand.menu")).toThrow(/not declared/);
    expect(() => pack.url("ui-layout.secretPanel")).toThrow(/not declared/);
    expect(() => pack.url("story.routes.extra")).toThrow(/not declared/);
    expect(() => pack.url("wat.something")).toThrow(/no domain/);
    expect(() => pack.url("brand")).toThrow(/<domain>\.<name>/);
  });

  it("refuses world paths that are not a declared shape or try to escape", async () => {
    const pack = await newPack();
    expect(() => pack.url(pack.worldKey("maps/20/layer-9.jpg"))).toThrow(/no declared shape/);
    expect(() => pack.url(pack.worldKey("rooms.json"))).toThrow(/no declared shape/);
    expect(() => pack.url(pack.worldKey("../../secrets"))).toThrow(/not pack-relative/);
    expect(() => pack.url(pack.worldKey("/world/rooms.json"))).toThrow(/not pack-relative/);
  });

  it("keeps cell indexes inside the declared set", async () => {
    const pack = await newPack();
    expect(() => pack.url("ui-cell.257.176")).toThrow(/outside 0\.\.175/);
    expect(pack.url("ui-cell.325.0")).toBe("/pack/ui/cell/325/cell-0.png");
    expect(() => pack.url("ui-cell.999.0")).toThrow(/not declared/);
    expect(pack.cellSprites()).toEqual([257, 258, 296, 325, 260]);
  });

  it("exposes the manifest lists the screens used to hardcode", async () => {
    const pack = await newPack();
    expect(pack.names("ui-layout")).toContain("petstate");
    expect(pack.names("effect")).toEqual([
      "fire-0",
      "fire-1",
      "fire-2",
      "star-0",
      "star-1",
      "star-2",
      "star-3",
      "ikon-1",
      "ikon-2",
      "down-0",
      "down-1",
      "down-2",
      "down-3",
    ]);
    expect(pack.introSpriteIds()).toContain(85);
    expect(pack.entry("story", "world-contract").producer?.what).toContain(
      "ExportScene1QuestWebData",
    );
  });

  it("rejects a manifest from another schema", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => ({ schema: "other", baseUrl: "/pack", domains: [], preload: {} }),
    }));
    await expect(Pack.load()).rejects.toThrow(/schema/);
  });
});

/** Node has no image decoder, so this stand-in finishes loading one microtask after `src` is set. */
class LateImage {
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
    queueMicrotask(() => {
      this.complete = true;
      this.onload?.();
    });
  }
  get src(): string {
    return this.source;
  }
}

describe("Pack boot progress", () => {
  async function trackedPack(): Promise<[Pack, BootProgress]> {
    const progress = new BootProgress();
    vi.stubGlobal("Image", LateImage);
    vi.stubGlobal("fetch", async (input: string) => {
      const url = String(input);
      return {
        ok: true,
        status: 200,
        json: async () => (url === "/pack/pack.json" ? JSON.parse(manifestText) : {}),
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    });
    return [await Pack.load(progress), progress];
  }

  it("books a url when it asks and completes it when it comes back", async () => {
    const [pack, progress] = await trackedPack();
    expect([progress.loaded, progress.total]).toEqual([1, 1]);
    await pack.json("font.panel-metrics");
    expect([progress.loaded, progress.total]).toEqual([2, 2]);
    await pack.image("brand.logo");
    expect([progress.loaded, progress.total]).toEqual([3, 3]);
  });

  it("counts a file once however often it is asked for", async () => {
    const [pack, progress] = await trackedPack();
    await pack.json("font.panel-metrics");
    await pack.json("font.panel-metrics");
    await pack.imagesFor(["brand.logo", "brand.logo"]);
    await pack.image("brand.logo");
    expect([progress.loaded, progress.total]).toEqual([3, 3]);
  });

  it("counts nothing after the app stops tracking", async () => {
    const [pack, progress] = await trackedPack();
    pack.stopTracking();
    await pack.json("story.routes");
    await pack.image("brand.title-background");
    expect([progress.loaded, progress.total]).toEqual([1, 1]);
  });
});
