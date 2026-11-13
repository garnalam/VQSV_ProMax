import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AREA_MAP_STEP,
  AreaMapCatalog,
  AreaMapView,
  sourceDistance,
  type AreaMapDocument,
} from "./AreaMap";

const document = JSON.parse(
  readFileSync("public/pack/story/area-maps.json", "utf8"),
) as AreaMapDocument;
const catalog = new AreaMapCatalog(document);

describe("baked area maps (game.l aS/aR/aT/aP/aQ, petRide.mid)", () => {
  it("keeps the original's eight areas, their colours and the no-map scenes", () => {
    expect(document.areas.map((a) => a.rooms.length)).toEqual([8, 9, 9, 14, 8, 2, 13, 7]);
    expect(document.areas[0]).toMatchObject({
      fill: 16735795,
      text: 5708544,
      blocksX: 3,
      blocksY: 5,
    });
    expect(document.noMapScenes).toEqual([9, 10, 11]);
    expect(document.areas[0].rooms[0]).toEqual({
      x: 0,
      y: 0,
      scene: 1,
      room: 0,
      nameRow: 386,
      name: "Phượng Chi Thủ Hộ Hương",
      w: 5,
      h: 5,
    });
    expect(document.gymDoors[0]).toEqual({ scene: 2, room: 1, x: 73, y: 158 });
    expect(document.docks[0]).toEqual({ scene: 1, room: 5, x: 265, y: 113 });
  });

  it("maps rooms to areas and refuses the scenes without a map", () => {
    expect([catalog.areaOf(1, 0), catalog.areaOf(2, 3), catalog.areaOf(9, 0)]).toEqual([0, 1, -1]);
    expect([catalog.hasMap(1, 1), catalog.hasMap(9, 0), catalog.hasMap(98, 0)]).toEqual([
      true,
      false,
      false,
    ]);
  });
});

describe("AreaMapView (state 4)", () => {
  it("uses the source's integer square root for the slide distance", () => {
    expect([
      sourceDistance(0, 0, 3, 4),
      sourceDistance(0, 0, 10, 10),
      sourceDistance(5, 5, 5, 5),
    ]).toEqual([5, 14, 0]);
  });

  it("slides from the last pan to centre the hero's box, then pans in 8 px steps inside the area", () => {
    const view = new AreaMapView(catalog);
    expect(view.open(1, 1, { width: 448, height: 320 }, [])).toBe(true);
    // Room 1:1 is box (5, 0): aJ = 120 - 80 - 40 = 0, aK = 160 - 0 - 20 = 140.
    let ticks = 0;
    while (view.sliding && ticks < 100) {
      expect(view.tick([])).toBe(false);
      ticks++;
    }
    expect([view.offsetX, view.offsetY]).toEqual([0, 140]);
    // Left only pans while the area's left edge is off screen.
    view.tick(["holdLeft"]);
    expect(view.offsetX).toBe(0);
    // Area 0 is 3 x 5 blocks = 240 x 200 px: at y 140 its bottom (340) passes 290, so down pans.
    view.tick(["holdDown"]);
    expect(view.offsetY).toBe(140 - AREA_MAP_STEP);
    expect(view.tick(["back"])).toBe(true);
  });

  it("keeps the pan and the hero's box between openings", () => {
    const view = new AreaMapView(catalog);
    view.open(1, 1, { width: 448, height: 320 }, []);
    while (view.sliding) view.tick([]);
    view.open(1, 0, { width: 448, height: 320 }, []);
    // Room 1:0 is box (0, 0): the slide heads for (80, 140) from where the last map stopped.
    expect([view.offsetX, view.offsetY, view.heroBox]).toEqual([0, 140, 0]);
    view.tick([]);
    expect(view.offsetX).toBe(AREA_MAP_STEP);
  });

  it("scales a map pixel of the hero's room into its box and shows only the useful arrows", () => {
    const view = new AreaMapView(catalog);
    view.open(1, 1, { width: 448, height: 320 }, []);
    while (view.sliding) view.tick([]);
    // Box (5, 0), 5 x 5 cells = 80 x 40 px, drawn at (0 + 80, 140 + 0).
    expect(view.inHeroBox(19, 273)).toEqual({ x: 80 + 3, y: 140 + 34 });
    // The area runs 340 px down from y 140: only the down arrow shows.
    expect([0, 1, 2, 3].map((i) => view.arrowVisible(i))).toEqual([false, true, false, false]);
    expect(AreaMapView.arrowAt(0)).toEqual({ x: 120, y: 20 });
    expect(AreaMapView.arrowAt(3)).toEqual({ x: 230, y: 160 });
  });
});
