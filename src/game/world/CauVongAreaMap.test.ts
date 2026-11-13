import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AreaMapCatalog,
  AreaMapView,
  CAU_VONG_AREA_COLORS,
  withCauVongAreas,
  type AreaMapDocument,
  type CauVongAreaMapDocument,
} from "./AreaMap";

const read = <T>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T;
const lietHoa = read<AreaMapDocument>("public/pack/story/area-maps.json"),
  cauVong = read<CauVongAreaMapDocument>("public/pack/cau-vong-world/area-map.json"),
  merged = withCauVongAreas(lietHoa, cauVong),
  catalog = new AreaMapCatalog(merged);

/** `CauVongWorldMap` (the JAR's data/map.d and data.d names) in the Liệt Hỏa map's frame. */
describe("Cầu Vồng area map", () => {
  it("bakes the JAR's 13 areas and 82 named rooms", () => {
    expect(cauVong.groups).toHaveLength(13);
    expect(cauVong.nodes).toHaveLength(82);
    expect(cauVong.names[0]).toBe("Khu Quý tộc");
    expect(cauVong.names[47]).toBe("Thành Đấu trường Cầu Vồng");
    expect(cauVong.nodes[1]).toEqual([0, 6, 0, 11, -1, 68]);
  });

  it("adds them after the Liệt Hỏa areas, which stay as they were", () => {
    expect(merged.areas.slice(0, lietHoa.areas.length)).toEqual(lietHoa.areas);
    expect(merged.areas).toHaveLength(lietHoa.areas.length + 13);
    const square = merged.areas[catalog.areaOf(98, 1)];
    expect(square).toMatchObject({ ...CAU_VONG_AREA_COLORS, cellW: 13 });
    // Outdoors every box is 78 x 48 (6 x 6 cells), shifted so the area starts at cell 0.
    expect(square.rooms.map((r) => [r.room, r.x, r.y, r.w, r.h])).toEqual([
      [0, 0, 0, 6, 6],
      [1, 3, 6, 6, 6],
      [68, 9, 6, 6, 6],
      [5, 3, 18, 6, 6],
      [6, 3, 24, 6, 6],
      [10, 9, 27, 6, 6],
      [11, 3, 12, 6, 6],
      [60, 12, 21, 6, 6],
    ]);
  });

  it("sizes indoor boxes from the node and has no map for rooms in no group", () => {
    const academy = merged.areas[catalog.areaOf(98, 3)];
    expect(academy.rooms[0]).toMatchObject({ room: 2, x: 0, y: 0, w: 54, h: 30 });
    expect(academy.rooms.find((r) => r.room === 3)).toMatchObject({ x: 9, y: 9, w: 8, h: 6 });
    expect(catalog.hasMap(98, 49)).toBe(false);
    expect(catalog.hasMap(98, 47)).toBe(false);
    expect(catalog.hasMap(98, 0)).toBe(true);
  });

  it("opens on the hero's room and slides its box to the screen's centre", () => {
    const view = new AreaMapView(catalog);
    expect(view.open(98, 11, { width: 240, height: 320 }, [])).toBe(true);
    expect(view.data!.rooms[view.heroBox].name).toBe("Bên ngoài thành phía nam");
    for (let i = 0; i < 100; i++) view.tick([]);
    // Box (3, 12) of 78 x 48: its centre lands on (120, 160).
    expect([view.offsetX + 3 * 13 + 39, view.offsetY + 12 * 8 + 24]).toEqual([120, 160]);
  });
});
