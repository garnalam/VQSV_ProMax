import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BattleRuntime, StatusStripSlot } from "../game/battle/BattleRuntime";
import type { BootAssets } from "../pack/boot";
import type { GameAssets } from "../game/story/GameAssets";
import { BattleRenderer } from "./BattleRenderer";
import { SourceUiLayout } from "./SourceUiLayout";

const layout = new SourceUiLayout(
  JSON.parse(readFileSync("public/pack/ui/layout/battle.json", "utf8")),
);

/** The Cầu Vồng sheet only has bytes for some identities, so the pack declares only those. */
const shippedRainbowIcons = new Set(["e0", "e3", "e4", "e5", "e6"]);

function renderer() {
  const draws: unknown[][] = [],
    boot = {
      battleLayout: layout,
      cell: (sprite: number, index: number) => ({ sprite, index }) as never,
      statusIcon: (name: string) =>
        shippedRainbowIcons.has(name) ? ({ name } as never) : undefined,
    } as unknown as BootAssets,
    subject = new BattleRenderer({} as GameAssets, boot),
    context = {
      drawImage: (...args: unknown[]) => draws.push(args),
    } as unknown as CanvasRenderingContext2D;
  return {
    call: (side: "player" | "enemy", slots: StatusStripSlot[]) => {
      const battle = { statusStrip: () => slots } as unknown as BattleRuntime;
      const before = draws.length;
      (
        subject as unknown as {
          statusSlots(g: CanvasRenderingContext2D, battle: BattleRuntime, side: string): void;
        }
      ).statusSlots(context, battle, side);
      return draws.slice(before);
    },
  };
}

const atlasSlot = (cell: number, badgeCell: number): StatusStripSlot =>
  ({
    lietHoaAtlasCell: cell,
    badgeCell,
    iconKind: "LIET_HOA_ATLAS",
    resourcePath: "",
  }) as StatusStripSlot;

const rainbowSlot = (file: string, badgeCell: number): StatusStripSlot =>
  ({
    lietHoaAtlasCell: -1,
    badgeCell,
    iconKind: "RAINBOW_RESOURCE",
    resourcePath: `/vqsv/status/rainbow/icons/${file}.png`,
  }) as StatusStripSlot;

describe("battle status strip", () => {
  it("walks the enemy strip inward from the source icon and badge anchors", () => {
    const { call } = renderer();
    expect(call("enemy", [atlasSlot(12, 135), atlasSlot(16, 145)])).toEqual([
      [{ sprite: 325, index: 12 }, 2, 25],
      [{ sprite: 257, index: 135 }, 10, 30],
      [{ sprite: 325, index: 16 }, 17, 25],
      [{ sprite: 257, index: 145 }, 25, 30],
    ]);
  });
  it("walks the player strip inward the other way, on the player's own row pair", () => {
    const { call } = renderer();
    expect(call("player", [atlasSlot(1, 136), atlasSlot(7, 137)])).toEqual([
      [{ sprite: 325, index: 1 }, 226, 221],
      [{ sprite: 257, index: 136 }, 234, 226],
      [{ sprite: 325, index: 7 }, 211, 221],
      [{ sprite: 257, index: 137 }, 219, 226],
    ]);
  });
  it("uses the resource picture when the identity is a Cầu Vồng one, and nothing when it has no bytes", () => {
    const { call } = renderer();
    expect(call("enemy", [rainbowSlot("e0", 145), rainbowSlot("e7", 145)])).toEqual([
      [{ name: "e0" }, 2, 25],
      [{ sprite: 257, index: 145 }, 10, 30],
      [{ sprite: 257, index: 145 }, 25, 30],
    ]);
  });
  it("draws nothing for a unit with no slot, because the source's six blanks are transparent", () => {
    expect(renderer().call("player", [])).toEqual([]);
    expect(renderer().call("enemy", [])).toEqual([]);
  });
});
