import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MapCollision } from "./MapCollision";
import {
  DIRECTION_DOWN,
  DIRECTION_LEFT,
  DIRECTION_RIGHT,
  DIRECTION_UP,
  PLAYER_HALF_SIZE,
  TERRAIN_BADGE_GATED,
  TERRAIN_BLOCKED,
  passable,
  stepWithTerrain,
  terrainAtWorld,
} from "./MapCollision";

const exportedMap = (mapId: number): MapCollision =>
  JSON.parse(readFileSync(`public/pack/world/maps/${mapId}/collision.json`, "utf8"));

// Mirrors the Java anchor fixture MapBounds(true, 320, 320, 8) with a uniform terrain lambda.
const uniform = (terrain: string): MapCollision => ({
  format: "vqsv-web-map-collision",
  version: 1,
  mapId: 0,
  modId: 0,
  tileSize: 16,
  widthTiles: 20,
  heightTiles: 20,
  widthPixels: 320,
  heightPixels: 320,
  layerCount: 1,
  terrainLayerType: 0,
  rows: Array.from({ length: 20 }, () => terrain.repeat(20)),
});

const withBlockedTile = (map: MapCollision, tileX: number, tileY: number): MapCollision => ({
  ...map,
  rows: map.rows.map((row, y) =>
    y === tileY ? row.slice(0, tileX) + "1" + row.slice(tileX + 1) : row,
  ),
});

describe("Java WorldEngine terrain contract", () => {
  it("reads terrain by tile and blocks everything outside the map bounds", () => {
    const map = uniform("0");
    expect(terrainAtWorld(map, 72, 8)).toBe(0);
    expect(terrainAtWorld(map, 88, 8)).toBe(0);
    expect(terrainAtWorld(withBlockedTile(map, 5, 0), 88, 8)).toBe(TERRAIN_BLOCKED);
    expect(terrainAtWorld(map, 0, 100)).toBe(TERRAIN_BLOCKED);
    expect(terrainAtWorld(map, 100, 0)).toBe(TERRAIN_BLOCKED);
    expect(terrainAtWorld(map, 320, 100)).toBe(TERRAIN_BLOCKED);
    expect(terrainAtWorld(map, 100, 320)).toBe(TERRAIN_BLOCKED);
  });

  it("keeps badge-gated terrain owned by the badge", () => {
    expect(passable(0, false)).toBe(true);
    expect(passable(TERRAIN_BLOCKED, true)).toBe(false);
    expect(passable(TERRAIN_BADGE_GATED, false)).toBe(false);
    expect(passable(TERRAIN_BADGE_GATED, true)).toBe(true);
  });

  it("reproduces the four source movement anchors", () => {
    const blockedTerrain = stepWithTerrain(uniform("1"), 100, 100, DIRECTION_UP);
    expect(blockedTerrain.moved).toBe(false);
    expect(blockedTerrain).toEqual({ x: 100, y: 100, direction: DIRECTION_UP, moved: false });

    const waterWithoutBadge = stepWithTerrain(uniform("2"), 100, 100, DIRECTION_UP, false);
    expect(waterWithoutBadge.moved).toBe(false);

    const waterWithBadge = stepWithTerrain(uniform("2"), 100, 100, DIRECTION_UP, true);
    expect(waterWithBadge).toEqual({ x: 100, y: 96, direction: DIRECTION_UP, moved: true });

    const mapBoundary = stepWithTerrain(uniform("0"), 10, 100, DIRECTION_LEFT);
    expect(mapBoundary.moved).toBe(false);
    expect(mapBoundary.x).toBe(10);
  });

  it("slides along a leading wall in the Java sample order", () => {
    // The right shoulder tile is blocked while the upper-right tile stays open, so Java
    // resolveLeadingEdge turns the step into the first slide direction, DIRECTION_UP.
    const map = withBlockedTile(uniform("0"), 6, 6);
    expect(terrainAtWorld(map, 103, 99)).toBe(TERRAIN_BLOCKED);
    expect(terrainAtWorld(map, 103, 92)).toBe(0);
    expect(stepWithTerrain(map, 100, 100, DIRECTION_RIGHT)).toEqual({
      x: 100,
      y: 100 - 4,
      direction: DIRECTION_UP,
      moved: true,
    });
  });

  it("walks the source 16-pixel player box and honours an explicit speed", () => {
    expect(PLAYER_HALF_SIZE).toBe(8);
    const map = withBlockedTile(uniform("0"), 6, 6);
    // right = x + half - 1 = 107, so a speed of 2 still reaches the blocked column 6.
    expect(stepWithTerrain(map, 100, 100, DIRECTION_RIGHT, false, 2)).toEqual({
      x: 100,
      y: 98,
      direction: DIRECTION_UP,
      moved: true,
    });
  });
});

describe("exported map collision data", () => {
  const mapIds = [1, 2, 5, 6, 7, 8, 9, 20, 64, 100];

  it("keeps every exported map structurally consistent with its header", () => {
    for (const mapId of mapIds) {
      const map = exportedMap(mapId);
      expect(map.mapId).toBe(mapId);
      expect(map.tileSize).toBe(16);
      expect(map.widthPixels).toBe(map.widthTiles * map.tileSize);
      expect(map.heightPixels).toBe(map.heightTiles * map.tileSize);
      expect(map.rows.length).toBe(map.heightTiles);
      expect(map.rows.every((row) => row.length === map.widthTiles)).toBe(true);
      expect(map.rows.every((row) => /^[012]+$/.test(row))).toBe(true);
    }
  });

  it("carries the source wall band of the Scene0 exterior map", () => {
    // The APK's landscape map: one tile row added on top, the JAR room at origin (0, 16).
    const map = exportedMap(2);
    expect([map.originX, map.originY]).toEqual([0, 16]);
    expect(map.rows[1]).toBe("00000100011111110000000000");
    expect(terrainAtWorld(map, 4 * 16 + 8, 8)).toBe(0);
    expect(terrainAtWorld(map, 5 * 16 + 8, 8)).toBe(TERRAIN_BLOCKED);
    const cells = map.rows.slice(1, 21).join("").split("");
    expect(cells.filter((cell) => cell === "1").length).toBe(125);
    expect(cells.length).toBe(26 * 20);
  });

  it("blocks and slides free-world steps on the real exterior map", () => {
    const map = exportedMap(2);
    // Open floor at tile (2,2) with the source wall directly above it.
    expect(terrainAtWorld(map, 40, 40)).toBe(0);
    expect(stepWithTerrain(map, 40, 40, DIRECTION_UP)).toEqual({
      x: 40,
      y: 40,
      direction: DIRECTION_UP,
      moved: false,
    });
    expect(stepWithTerrain(map, 40, 40, DIRECTION_DOWN)).toEqual({
      x: 40,
      y: 44,
      direction: DIRECTION_DOWN,
      moved: true,
    });

    // Tile (1,2) touches the same band: Java turns the blocked upward step into a left slide.
    expect(terrainAtWorld(map, 24, 40)).toBe(0);
    expect(stepWithTerrain(map, 24, 40, DIRECTION_UP)).toEqual({
      x: 20,
      y: 40,
      direction: DIRECTION_LEFT,
      moved: true,
    });

    // Tile (1,7) is a pocket walled to the north and west, so a right step slides down.
    expect(terrainAtWorld(map, 24, 120)).toBe(0);
    expect(stepWithTerrain(map, 24, 120, DIRECTION_UP).moved).toBe(false);
    expect(stepWithTerrain(map, 24, 120, DIRECTION_LEFT).moved).toBe(false);
    expect(stepWithTerrain(map, 24, 120, DIRECTION_RIGHT)).toEqual({
      x: 24,
      y: 124,
      direction: DIRECTION_DOWN,
      moved: true,
    });
  });

  it("keeps the interior hall walls and floor from the source map", () => {
    // The APK's landscape hall: two tile columns added each side, the JAR room at origin (32, 0).
    const map = exportedMap(20);
    expect(map.widthPixels).toBe(640);
    expect(map.heightPixels).toBe(384);
    expect([map.originX, map.originY]).toEqual([32, 0]);
    expect(map.rows[0]).toBe("1".repeat(40));
    // Tile (18,2) is an enclosed wall block; the hall floor at (18,6) walks freely.
    expect(terrainAtWorld(map, 296, 40)).toBe(TERRAIN_BLOCKED);
    expect(terrainAtWorld(map, 296, 104)).toBe(0);
    for (const direction of [DIRECTION_UP, DIRECTION_DOWN, DIRECTION_LEFT, DIRECTION_RIGHT])
      expect(stepWithTerrain(map, 296, 40, direction).moved).toBe(false);
    expect(stepWithTerrain(map, 296, 104, DIRECTION_DOWN)).toEqual({
      x: 296,
      y: 108,
      direction: DIRECTION_DOWN,
      moved: true,
    });
    expect(stepWithTerrain(map, 296, 104, DIRECTION_UP)).toEqual({
      x: 296,
      y: 100,
      direction: DIRECTION_UP,
      moved: true,
    });
    // The hall's north wall at tile (4,2) turns an upward step into the Java left slide.
    expect(terrainAtWorld(map, 72, 56)).toBe(0);
    expect(terrainAtWorld(map, 72, 40)).toBe(TERRAIN_BLOCKED);
    expect(stepWithTerrain(map, 72, 56, DIRECTION_UP)).toEqual({
      x: 68,
      y: 56,
      direction: DIRECTION_LEFT,
      moved: true,
    });
  });
});
