import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SourceUiLayout } from "../../rendering/SourceUiLayout";
import { SHORTCUT_TOGGLE, talkEligible, WorldHud } from "./WorldHud";

const layout = new SourceUiLayout(
  JSON.parse(readFileSync("public/pack/ui/layout/world.json", "utf8")) as never,
);
/** Sprite 257 animation 3 (the banner) lasts 48 ticks: four in, 40 held, four out. */
const ticks = (sprite: number, state: number) => (sprite === 257 && state === 3 ? 48 : 0);

describe("WorldHud (Java WorldUi)", () => {
  it("drops the room banner, shows the name while it holds, and clears it", () => {
    const hud = new WorldHud(ticks);
    hud.showRoomTitle("  Đường nhỏ phía Đông ");
    expect([hud.roomTitle, hud.titleAnimationTick, hud.titleTextVisible]).toEqual([
      "Đường nhỏ phía Đông",
      0,
      false,
    ]);
    for (let i = 0; i < 4; i++) hud.tick(-1);
    expect(hud.titleTextVisible).toBe(true);
    for (let i = 0; i < 40; i++) hud.tick(-1);
    expect([hud.titleTextVisible, hud.titleAnimationTick]).toEqual([false, 44]);
    for (let i = 0; i < 4; i++) hud.tick(-1);
    expect(hud.titleAnimationTick).toBe(-1);
    hud.showRoomTitle("");
    expect(hud.titleAnimationTick).toBe(-1);
  });

  it("slides the shortcut strip in and out, and only takes presses while it is open", () => {
    const hud = new WorldHud(ticks),
      task = { x: 50, y: 290 };
    expect(hud.buttonAt(layout, task.x, task.y)).toBe("none");
    expect(hud.buttonAt(layout, SHORTCUT_TOGGLE.x + 3, SHORTCUT_TOGGLE.y + 3)).toBe("toggle");
    hud.toggleShortcuts();
    expect([hud.shortcutsOpen, hud.shortcutAnimationTick]).toEqual([true, 0]);
    for (let i = 0; i < 10; i++) hud.tick(-1);
    expect(hud.shortcutAnimationTick).toBe(4);
    expect(hud.buttonAt(layout, task.x, task.y)).toBe("task");
    expect(hud.buttonAt(layout, 110, 290)).toBe("map");
    expect(hud.buttonAt(layout, 160, 290)).toBe("ride");
    hud.toggleShortcuts();
    expect([hud.shortcutsOpen, hud.shortcutsExpanded, hud.shortcutAnimationTick]).toEqual([
      false,
      true,
      44,
    ]);
    for (let i = 0; i < 4; i++) hud.tick(-1);
    expect(hud.shortcutsExpanded).toBe(false);
  });

  it("maps the x2 box and the two softkey plates", () => {
    const hud = new WorldHud(ticks);
    expect(hud.buttonAt(layout, 200, 10)).toBe("speed");
    expect(hud.buttonAt(layout, 5, 310)).toBe("system");
    expect(hud.buttonAt(layout, 230, 310)).toBe("menu");
    expect(hud.buttonAt(layout, 120, 160)).toBe("none");
  });

  it("restarts the talk bubble's animation when it moves to another NPC", () => {
    const hud = new WorldHud(ticks);
    hud.tick(5);
    hud.tick(5);
    hud.tick(5);
    expect(hud.promptTick).toBe(2);
    hud.tick(7);
    expect(hud.promptTick).toBe(0);
  });

  it("offers the bubble only to talkable people (WorldTalkPromptEngine)", () => {
    const npc = { sourceKind: 0, variant: 1, sprite: 23, visible: true };
    expect(talkEligible(npc)).toBe(true);
    expect(talkEligible({ ...npc, variant: 18, sprite: 137 })).toBe(true);
    expect(talkEligible({ ...npc, visible: false })).toBe(false);
    expect(talkEligible({ ...npc, sourceKind: 1 })).toBe(false);
    expect(talkEligible({ ...npc, variant: 0 })).toBe(false);
    expect(talkEligible({ ...npc, sprite: 120 })).toBe(false);
  });
});
