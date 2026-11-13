import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/** Node has no image decoder; the panels never read pixels (see gameplayTrace.test.ts). */
class StubImage {
  complete = true;
  naturalWidth = 1;
  naturalHeight = 1;
  width = 1;
  height = 1;
  src = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
}
vi.stubGlobal("Image", StubImage);
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
const { NewGameScreen } = await import("./NewGameScreen");
const { applyUrlParityCheckpoint } = await import("../dev/parityCheckpoints");
const { InputSnapshot } = await import("../core/input/InputSnapshot");
const { SWIPE_ROW, SWIPE_START } = await import("../core/input/TouchSwipe");
type PointerFields = import("../core/input/InputSnapshot").PointerFields;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);

/** The bag open on its first tab, with enough rows to scroll, and the screen unfrozen. */
function openBag() {
  const screen = new NewGameScreen(
    false,
    assets,
    boot,
    new SaveRepository(new MemorySaveStore()),
    () => {},
  );
  expect(applyUrlParityCheckpoint(screen, new URLSearchParams("worldPanel=bag"))).toBe(true);
  screen.frozen = false;
  const panel = screen.host.panel;
  expect(panel.mode).toBe("bag");
  return { screen, panel };
}
const tick = (screen: ReturnType<typeof openBag>["screen"], pointer: Partial<PointerFields>) =>
  screen.tick(new InputSnapshot({ pointer }));

describe("swiping a list with a finger (web touch)", () => {
  it("a drag walks the bag like the wheel and does not click the row under the finger", () => {
    const { screen, panel } = openBag();
    const rows = panel.bagRows.length;
    expect(rows).toBeGreaterThan(3);
    expect(panel.selected).toBe(0);
    const x = 120,
      y = 200;
    tick(screen, { pressed: true, down: true, pressX: x, pressY: y, x, y, touch: true });
    expect(panel.selected).toBe(0); // the press alone does nothing yet
    tick(screen, { moved: true, down: true, x, y: y - SWIPE_START });
    tick(screen, { moved: true, down: true, x, y: y - SWIPE_START - 2 * SWIPE_ROW });
    expect(panel.selected).toBe(2);
    tick(screen, { released: true, releaseX: x, releaseY: y - 40, x, y: y - 40 });
    expect(panel.selected).toBe(2);
    expect(panel.mode).toBe("bag");
  });

  it("a finger tap still clicks, on release; a mouse press clicks at once as in Java", () => {
    const { screen, panel } = openBag();
    const before = panel.selected;
    // Find a press point that picks another row: scan the list area for a slot below the cursor.
    let target: { x: number; y: number } | null = null;
    for (let yy = 40; yy < 300 && !target; yy += 2) {
      const probe = openBag();
      probe.screen.tick(
        new InputSnapshot({ pointer: { pressed: true, pressX: 120, pressY: yy, x: 120, y: yy } }),
      );
      if (probe.panel.mode === "bag" && probe.panel.selected > before) target = { x: 120, y: yy };
    }
    expect(target).not.toBeNull();
    const { x, y } = target!;
    tick(screen, { pressed: true, down: true, pressX: x, pressY: y, x, y, touch: true });
    expect(panel.selected).toBe(before);
    tick(screen, { released: true, releaseX: x, releaseY: y, x, y });
    expect(panel.selected).toBeGreaterThan(before);
  });
});

describe("saving when the phone hides the tab", () => {
  const fresh = (params: string) => {
    const saves = new SaveRepository(new MemorySaveStore()),
      screen = new NewGameScreen(false, assets, boot, saves, () => {});
    expect(applyUrlParityCheckpoint(screen, new URLSearchParams(params))).toBe(true);
    screen.frozen = false;
    return { screen, saves };
  };

  it("saves where the hero stands when nothing is open", async () => {
    // The bag checkpoint stands the hero in the world; Back closes the panels over it.
    const { screen, saves } = fresh("worldPanel=bag");
    for (let i = 0; i < 10 && screen.host.panel.visible; i++) screen.step(["back"]);
    for (let i = 0; i < 5; i++) screen.step([]);
    expect(screen.host.panel.visible).toBe(false);
    const world = screen.host.world!;
    expect(world.restingForSuspendSave).toBe(true);
    screen.suspend();
    await vi.waitFor(async () => expect(await saves.load()).toBeDefined());
    const save = (await saves.load())!;
    expect(save.location).toMatchObject({
      sceneId: world.sceneId,
      roomIndex: world.roomIndex,
      x: world.player.x,
      y: world.player.y,
    });
  });

  it("does not save with a panel open, so nothing half-done is written", async () => {
    const { screen, saves } = fresh("worldPanel=bag");
    expect(screen.host.saveBeforeSuspend()).toBe(false);
    screen.suspend();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await saves.load()).toBeUndefined();
  });
});
