import type { InputCommand } from "../../core/input/GameCommand";
import { viewport } from "../../core/Viewport";

/**
 * The original game's area map: `game.l` state 4, opened from the free map. It draws every room of
 * the current area (`aS[aD]`) as a rounded box on a 16 x 8 px grid over a frozen picture of the
 * world, marks the room the hero stands in, its doors, Đạo quán door and dock, and pans with the
 * arrow keys. Everything here follows `l.java`; the JavaSE rebuild's task route board is not used.
 */

/** `public/pack/story/area-maps.json` (scripts/export-area-maps.mjs). */
export type AreaMapDocument = {
  noMapScenes: number[];
  /** `petRide.mid[v[scene] + room][4]`: the area a room belongs to, -1 for none. */
  roomArea: Record<string, number>;
  areas: AreaMapArea[];
  gymDoors: AreaMapPoint[];
  docks: AreaMapPoint[];
};
export type AreaMapArea = {
  /** `aR[aD * 2]` / `aR[aD * 2 + 1]`: box fill and name colour. */
  fill: number;
  text: number;
  /**
   * The grid cell's width in px: 16 in Liệt Hỏa (`x << 4`); 13 for a Cầu Vồng area (`at.b`,
   * `g[room][0] * 13`). Cells are 8 px high in both. Absent means 16.
   */
  cellW?: number;
  /** `aT[aD * 2]` / `aT[aD * 2 + 1]`: the area's extent in 5-cell blocks (80 x 40 px each). */
  blocksX: number;
  blocksY: number;
  rooms: AreaMapRoom[];
};
/** One `aS` record: grid cell, room, `chs.mid` name row and size in cells. */
export type AreaMapRoom = {
  x: number;
  y: number;
  scene: number;
  room: number;
  nameRow: number;
  name: string;
  w: number;
  h: number;
};
/**
 * `cau-vong-world/area-map.json` (rebuild_game/tools/ExportWebCauVongAreaMap.java): the Cầu Vồng
 * JAR's own area map, `data/map.d` and the data.d room names, as JavaSE's `CauVongWorldMap` holds them.
 */
export type CauVongAreaMapDocument = {
  /** Rooms per area; a leading -1 marks an outdoor area, whose rooms all get 78 x 48 boxes. */
  groups: number[][];
  /** Per scene-98 room: `[x, y, up, down, left, right]` (+ `[w, h]` indoors), in 13 x 8 px cells. */
  nodes: number[][];
  names: string[];
};

/** `at.b(Graphics)`: every Cầu Vồng box is drawn in this colour, the hero's as the Liệt Hỏa one. */
export const CAU_VONG_AREA_COLORS = { fill: 12313343, text: 1908277 } as const;
const CAU_VONG_SCENE = 98,
  CAU_VONG_CELL_W = 13,
  /** `at.b(BBIZ)`: an outdoor box is 78 x 48 px, 6 x 6 cells. */
  CAU_VONG_OUTDOOR_CELLS = 6;

/**
 * The owner's call (2026-11-13): in scene 98 the map keeps the Liệt Hỏa look and only takes the Cầu
 * Vồng areas, rooms, positions and names. Each `groups` row becomes one more area after the Liệt
 * Hỏa ones, its boxes shifted so the area starts at cell (0, 0); a room in several rows belongs to
 * the first (`CauVongWorldMap.open`).
 */
export function withCauVongAreas(
  document: AreaMapDocument,
  cauVong: CauVongAreaMapDocument | undefined,
): AreaMapDocument {
  if (!cauVong) return document;
  const roomArea = { ...document.roomArea },
    areas = [...document.areas];
  cauVong.groups.forEach((group) => {
    const indoor = group[0] >= 0,
      ids = group.filter((id) => id >= 0 && (cauVong.nodes[id]?.length ?? 0) > 0);
    if (ids.length === 0) return;
    const boxes = ids.map((id) => {
        const node = cauVong.nodes[id];
        return {
          id,
          x: node[0],
          y: node[1],
          w: indoor ? node[6] : CAU_VONG_OUTDOOR_CELLS,
          h: indoor ? node[7] : CAU_VONG_OUTDOOR_CELLS,
        };
      }),
      left = Math.min(...boxes.map((b) => b.x)),
      top = Math.min(...boxes.map((b) => b.y)),
      right = Math.max(...boxes.map((b) => b.x + b.w)) - left,
      bottom = Math.max(...boxes.map((b) => b.y + b.h)) - top,
      area = areas.length;
    for (const { id } of boxes) roomArea[`${CAU_VONG_SCENE}:${id}`] ??= area;
    areas.push({
      ...CAU_VONG_AREA_COLORS,
      cellW: CAU_VONG_CELL_W,
      blocksX: Math.ceil(right / 5),
      blocksY: Math.ceil(bottom / 5),
      rooms: boxes.map((b) => ({
        x: b.x - left,
        y: b.y - top,
        scene: CAU_VONG_SCENE,
        room: b.id,
        nameRow: -1,
        name: cauVong.names[b.id] ?? "",
        w: b.w,
        h: b.h,
      })),
    });
  });
  return { ...document, roomArea, areas };
}

/** The cell width of an area (16 unless it says otherwise). */
export function areaCellW(area: AreaMapArea | undefined): number {
  return area?.cellW ?? 16;
}

/** `aP` / `aQ` record: a marker at map pixel (x, y) of room scene:room. */
export type AreaMapPoint = { scene: number; room: number; x: number; y: number };

/** A door of the current room (`l.o`: kind-1 actors visible when the room loaded). */
export type AreaMapDoor = { x: number; y: number; direction: number };

export const AREA_MAP_NO_MAP_TEXT = "Khu này không có bản đồ";
/** `aO`: the slide and pan speed, pixels per tick. */
export const AREA_MAP_STEP = 8;
/** The legend band at the bottom (`h() - 30`); a press there closes the map. */
export const AREA_MAP_LEGEND_H = 30;
export const AREA_MAP_SCREEN = { w: 240, h: 320 } as const;
/**
 * The screen the map fills: the source's 240x320, or in landscape the whole canvas (the owner's
 * call, 2026-11-14), so the area spreads across the wide screen instead of a portrait strip.
 */
export function areaMapScreen(): { w: number; h: number } {
  return viewport.landscape ? { w: viewport.width, h: viewport.height } : AREA_MAP_SCREEN;
}
/** `a(0, 270, g(), 30)`: the touch rectangle that closes the map. */
export const AREA_MAP_CLOSE_RECT = { x: 0, y: 270, w: 240, h: 30 } as const;
/** `aM`: the hero marker, sprite 0 state 3. `aN`: the four arrows, sprite 223 states 0..3. */
export const AREA_MAP_HERO = { sprite: 0, state: 3 } as const;
export const AREA_MAP_ARROW_SPRITE = 223;

/** `a.e.a(int, int, int, int)`: the source's integer square root of the squared distance. */
export function sourceDistance(x1: number, y1: number, x2: number, y2: number): number {
  let rest = (x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2),
    root = 0;
  for (let bit = 0x40000000; bit > 0; bit >>>= 2) {
    if (rest >= root + bit) {
      rest -= root + bit;
      root = (root >> 1) + bit;
    } else root >>= 1;
  }
  return root;
}

export class AreaMapCatalog {
  constructor(readonly document: AreaMapDocument) {}

  /** `aD` for a room, or -1 when the room has no area. */
  areaOf(scene: number, room: number): number {
    return this.document.roomArea[`${scene}:${room}`] ?? -1;
  }
  /**
   * The key-1 gate: scenes in `as` (the Đạo quán halls 9, the ruins 10, the towns 11) have no map;
   * the web also refuses a room with no area (a Cầu Vồng room in no `map.d` group, as
   * `CauVongWorldMap.open` leaves `group` at -1).
   */
  hasMap(scene: number, room: number): boolean {
    if (this.document.noMapScenes.includes(scene)) return false;
    const area = this.areaOf(scene, room);
    return area >= 0 && area < this.document.areas.length;
  }
  /** `aE` / `aF`: the room's Đạo quán door and dock markers. */
  gymDoor(scene: number, room: number): AreaMapPoint | undefined {
    return this.document.gymDoors.find((p) => p.scene === scene && p.room === room);
  }
  dock(scene: number, room: number): AreaMapPoint | undefined {
    return this.document.docks.find((p) => p.scene === scene && p.room === room);
  }
}

/**
 * State 4's own fields. `aH`/`aI` (the pan) and `aG` (the hero's box) live on `game.l` and are never
 * reset, so a second opening slides from wherever the last one left off; keep one instance per
 * session to do the same.
 */
export class AreaMapView {
  /** `aH`, `aI`: the area's top-left on screen. */
  offsetX = 0;
  offsetY = 0;
  /** `aG`: the index of the hero's box in the area (kept when the room is not on the map). */
  heroBox = 0;
  /** `aJ`, `aK`, `aL`: where the opening slide is heading, and whether it still runs. */
  private targetX = 0;
  private targetY = 0;
  sliding = false;
  /** Ticks since opening (drives the hero and arrow animations). */
  ticks = 0;

  scene = 0;
  room = 0;
  area = -1;
  /** `d2.c` / `d2.d`: the current room's map size in pixels. */
  mapWidth = 1;
  mapHeight = 1;
  doors: AreaMapDoor[] = [];

  constructor(readonly catalog: AreaMapCatalog) {}

  get data(): AreaMapArea | undefined {
    return this.catalog.document.areas[this.area];
  }

  /** The key-1 handler: false (and nothing changes) when the area has no map. */
  open(
    scene: number,
    room: number,
    mapSize: { width: number; height: number },
    doors: AreaMapDoor[],
  ): boolean {
    if (!this.catalog.hasMap(scene, room)) return false;
    this.scene = scene;
    this.room = room;
    this.area = this.catalog.areaOf(scene, room);
    this.mapWidth = Math.max(1, mapSize.width);
    this.mapHeight = Math.max(1, mapSize.height);
    this.doors = doors;
    const rooms = this.data!.rooms,
      found = rooms.findIndex((r) => r.scene === scene && r.room === room);
    if (found >= 0) this.heroBox = found;
    const box = rooms[this.heroBox] ?? rooms[0],
      cellW = areaCellW(this.data),
      screen = areaMapScreen();
    if (this.data!.cellW === undefined) {
      this.targetX = (screen.w >> 1) - (box.x << 4) - 40;
      this.targetY = (screen.h >> 1) - (box.y << 3) - 20;
    } else {
      // A Cầu Vồng area: the hero's box centred, whatever its size.
      this.targetX = (screen.w >> 1) - box.x * cellW - Math.trunc((box.w * cellW) / 2);
      this.targetY = (screen.h >> 1) - (box.y << 3) - ((box.h << 3) >> 1);
    }
    this.sliding = true;
    this.ticks = 0;
    return true;
  }

  /** The area's full size on screen: `aT` blocks of 5 cells. */
  get extentW(): number {
    return (this.data?.blocksX ?? 0) * areaCellW(this.data) * 5;
  }
  get extentH(): number {
    return ((this.data?.blocksY ?? 0) << 3) * 5;
  }

  /**
   * One state-4 tick. The opening slide runs first; only once it stops do held arrows pan (8 px,
   * never past the area's edges) and Back close the map. Returns true when the map closes.
   */
  tick(commands: readonly InputCommand[], closePressed = false): boolean {
    this.ticks++;
    if (this.sliding) {
      if (this.offsetX === this.targetX && this.offsetY === this.targetY) this.sliding = false;
      const distance = sourceDistance(this.offsetX, this.offsetY, this.targetX, this.targetY);
      if (distance < AREA_MAP_STEP) {
        this.offsetX = this.targetX;
        this.offsetY = this.targetY;
      } else {
        this.offsetX += Math.trunc(((this.targetX - this.offsetX) * AREA_MAP_STEP) / distance);
        this.offsetY += Math.trunc(((this.targetY - this.offsetY) * AREA_MAP_STEP) / distance);
      }
    }
    if (this.sliding) return false;
    const screen = areaMapScreen();
    if (commands.includes("holdLeft")) {
      if (this.offsetX < 0) this.offsetX += AREA_MAP_STEP;
    } else if (commands.includes("holdRight")) {
      if (this.offsetX + this.extentW > screen.w) this.offsetX -= AREA_MAP_STEP;
    } else if (commands.includes("holdUp")) {
      if (this.offsetY < 0) this.offsetY += AREA_MAP_STEP;
    } else if (commands.includes("holdDown")) {
      if (this.offsetY + this.extentH > screen.h - AREA_MAP_LEGEND_H) this.offsetY -= AREA_MAP_STEP;
    } else if (commands.includes("back") || closePressed) return true;
    return false;
  }

  /**
   * Web touch: a finger drags the area by (dx, dy) screen px. It goes no further than the held
   * arrows would (never past the area's edges), and waits for the opening slide like they do.
   */
  drag(dx: number, dy: number): void {
    if (this.sliding) return;
    const screen = areaMapScreen(),
      minX = Math.min(this.offsetX, screen.w - this.extentW),
      maxX = Math.max(this.offsetX, 0),
      minY = Math.min(this.offsetY, screen.h - AREA_MAP_LEGEND_H - this.extentH),
      maxY = Math.max(this.offsetY, 0);
    this.offsetX = Math.max(minX, Math.min(maxX, this.offsetX + Math.trunc(dx)));
    this.offsetY = Math.max(minY, Math.min(maxY, this.offsetY + Math.trunc(dy)));
  }

  /** `o(n)`: which of the four arrows (up, down, left, right) shows more map beyond the edge. */
  arrowVisible(index: number): boolean {
    const screen = areaMapScreen();
    switch (index) {
      case 0:
        return this.offsetY < 0;
      case 1:
        return this.offsetY + this.extentH > screen.h;
      case 2:
        return this.offsetX < 0;
      default:
        return this.offsetX + this.extentW > screen.w;
    }
  }

  /** `aN[i].b(...)`: the arrows' anchors. */
  static arrowAt(index: number): { x: number; y: number } {
    const { w, h } = areaMapScreen();
    return index <= 1
      ? { x: w >> 1, y: 20 + index * (h - 20) }
      : { x: 10 + (index % 2) * (w - 20), y: h >> 1 };
  }

  /** A point of the hero's room (map pixels) scaled into the hero's box on screen. */
  inHeroBox(px: number, py: number): { x: number; y: number } {
    const box = this.data!.rooms[this.heroBox],
      cellW = areaCellW(this.data);
    return {
      x: Math.trunc((px * box.w * cellW) / this.mapWidth) + box.x * cellW + this.offsetX,
      y: Math.trunc(((py * box.h) << 3) / this.mapHeight) + (box.y << 3) + this.offsetY,
    };
  }
}
