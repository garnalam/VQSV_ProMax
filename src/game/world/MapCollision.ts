// JavaSE parity: vqsv/render/GameMap.terrainAtWorld + vqsv/world/WorldEngine
// (resolveTerrainStep / resolveLeadingEdge / slideStep / passable / outside).
// Terrain classes come from /pack/world/maps/<id>/collision.json.
export type MapCollision = {
  format: string;
  version: number;
  mapId: number;
  modId: number;
  tileSize: number;
  widthTiles: number;
  heightTiles: number;
  widthPixels: number;
  heightPixels: number;
  layerCount: number;
  terrainLayerType: number;
  rows: string[];
};

export const DIRECTION_DOWN = 0,
  DIRECTION_RIGHT = 1,
  DIRECTION_UP = 2,
  DIRECTION_LEFT = 3;
export const PLAYER_HALF_SIZE = 8;
export const DEFAULT_MOVE_SPEED = 4;
export const TERRAIN_BLOCKED = 1;
export const TERRAIN_BADGE_GATED = 2;
export const TERRAIN_BADGE_ID = 3;

export type MoveStep = { x: number; y: number; direction: number; moved: boolean };
type EdgeSamples = readonly [number, number, number, number, number, number, number];

export const terrainAtWorld = (map: MapCollision, x: number, y: number): number => {
  if (x <= 0 || x >= map.widthPixels || y <= 0 || y >= map.heightPixels) return TERRAIN_BLOCKED;
  return Number(map.rows[Math.floor(y / map.tileSize)][Math.floor(x / map.tileSize)]);
};

export const passable = (terrain: number, badgeGatedOpen: boolean): boolean =>
  terrain !== TERRAIN_BLOCKED && (terrain !== TERRAIN_BADGE_GATED || badgeGatedOpen);

const outside = (map: MapCollision, x: number, y: number): boolean =>
  x <= 0 || x >= map.widthPixels || y <= 0 || y >= map.heightPixels;

// WorldEngine.resolveLeadingEdge, in the Java sample order:
// cornerA, cornerB, center, farA, farB, sideA, sideB.
function resolveLeadingEdge(
  [cornerA, cornerB, center, farA, farB, sideA, sideB]: EdgeSamples,
  slides: readonly [number, number],
  mainDirection: number,
  speed: number,
  badgeGatedOpen: boolean,
): { direction: number; speed: number } | null {
  const open = (terrain: number) => passable(terrain, badgeGatedOpen),
    passA = open(cornerA),
    passB = open(cornerB);
  if (!passA && !passB) {
    if (!open(farA)) return open(farB) ? { direction: slides[1], speed } : null;
    if (!open(farB)) return open(farA) ? { direction: slides[0], speed } : null;
    if (open(sideB)) return open(farB) ? { direction: slides[1], speed } : null;
    if (open(sideA)) return open(farA) ? { direction: slides[0], speed } : null;
    return null;
  }
  if (!passA) return open(cornerB) ? { direction: slides[1], speed } : null;
  if (!passB) return open(cornerA) ? { direction: slides[0], speed } : null;
  return open(center) ? { direction: mainDirection, speed } : null;
}

export function stepWithTerrain(
  map: MapCollision,
  x: number,
  y: number,
  direction: number,
  badgeGatedOpen = false,
  speed = DEFAULT_MOVE_SPEED,
  /** `CauVongChapterRuntime.terrainForMovement`: the terrain class the step reads (scene 98). */
  movementTerrain: (terrain: number) => number = (terrain) => terrain,
): MoveStep {
  const half = PLAYER_HALF_SIZE,
    left = x - half,
    right = x + half - 1,
    top = y - half,
    bottom = y + half - 1,
    far = half * 2,
    terrain = (sampleX: number, sampleY: number) =>
      movementTerrain(terrainAtWorld(map, sampleX, sampleY)),
    resolve = (): { direction: number; speed: number } | null => {
      switch (direction) {
        case DIRECTION_UP: {
          const leading = top - speed;
          if (outside(map, x, leading)) return null;
          return resolveLeadingEdge(
            [
              terrain(left, leading),
              terrain(right, leading),
              terrain(x, leading),
              terrain(x - far, leading),
              terrain(x + far, leading),
              terrain(x - far, y),
              terrain(x + far, y),
            ],
            [DIRECTION_LEFT, DIRECTION_RIGHT],
            direction,
            speed,
            badgeGatedOpen,
          );
        }
        case DIRECTION_DOWN: {
          const leading = bottom + speed;
          if (outside(map, x, leading)) return null;
          return resolveLeadingEdge(
            [
              terrain(left, leading),
              terrain(right, leading),
              terrain(x, leading),
              terrain(left - far, leading),
              terrain(right + far, leading),
              terrain(x - far, y),
              terrain(x + far, y),
            ],
            [DIRECTION_LEFT, DIRECTION_RIGHT],
            direction,
            speed,
            badgeGatedOpen,
          );
        }
        case DIRECTION_LEFT: {
          const leading = left - speed;
          if (outside(map, leading, y)) return null;
          return resolveLeadingEdge(
            [
              terrain(leading, top),
              terrain(leading, bottom),
              terrain(leading, y),
              terrain(leading, top - far),
              terrain(leading, bottom + far),
              terrain(x, y - far),
              terrain(x, y + far),
            ],
            [DIRECTION_UP, DIRECTION_DOWN],
            direction,
            speed,
            badgeGatedOpen,
          );
        }
        case DIRECTION_RIGHT: {
          const leading = right + speed;
          if (outside(map, leading, y)) return null;
          return resolveLeadingEdge(
            [
              terrain(leading, top),
              terrain(leading, bottom),
              terrain(leading, y),
              terrain(leading, top - far),
              terrain(leading, bottom + far),
              terrain(x, y - far),
              terrain(x, y + far),
            ],
            [DIRECTION_UP, DIRECTION_DOWN],
            direction,
            speed,
            badgeGatedOpen,
          );
        }
        default:
          return null;
      }
    };
  const step = resolve();
  if (!step) return { x, y, direction, moved: false };
  const next = { x, y };
  if (step.direction === DIRECTION_DOWN) next.y += step.speed;
  else if (step.direction === DIRECTION_RIGHT) next.x += step.speed;
  else if (step.direction === DIRECTION_UP) next.y -= step.speed;
  else if (step.direction === DIRECTION_LEFT) next.x -= step.speed;
  const result = { ...next, direction: step.direction, moved: true };
  // The first probe can redirect movement perpendicular to the checked edge.
  // Check the edge that will actually move before allowing that slide.
  if (step.direction !== direction && !terrainEdgeClear(map, result, movementTerrain, badgeGatedOpen))
    return { x, y, direction: step.direction, moved: false };
  return result;
}

/**
 * `CauVongTerrainMechanisms.movementTerrain`: Cầu Vồng water (2), thorns (3) and sky gaps (4) are
 * walls unless the ride they need is the active one, the room allows it and it is owned; water
 * then reads as floor (-1), the others keep their class (neither wall nor badge-gated).
 */
export function cauVongMovementTerrain(
  terrain: number,
  ride: { active: number; allowed: (ride: number) => boolean; owned: (ride: number) => boolean },
  rides: { water: number; plant: number; sky: number },
): number {
  if (terrain < 2 || terrain > 4) return terrain;
  const required = terrain === 2 ? rides.water : terrain === 3 ? rides.plant : rides.sky;
  if (ride.active !== required || !ride.allowed(required) || !ride.owned(required)) return 1;
  return terrain === 2 ? -1 : terrain;
}

/**
 * `CauVongTerrainMechanisms.constrainMovement`: the slide may turn the step onto an edge that is
 * itself a wall at a concave corner, so the crossed edge's three samples must all be open
 * (neither 1 nor 2 after `movementTerrain`), else the hero stays where he was.
 */
export function cauVongEdgeClear(
  map: MapCollision,
  step: MoveStep,
  movementTerrain: (terrain: number) => number,
): boolean {
  return terrainEdgeClear(map, step, movementTerrain, false);
}

function terrainEdgeClear(
  map: MapCollision,
  step: MoveStep,
  movementTerrain: (terrain: number) => number,
  badgeGatedOpen: boolean,
): boolean {
  if (!step.moved) return true;
  const open = (x: number, y: number) => {
    const terrain = movementTerrain(terrainAtWorld(map, x, y));
    return passable(terrain, badgeGatedOpen);
  };
  const left = step.x - 8,
    right = step.x + 7,
    top = step.y - 8,
    bottom = step.y + 7;
  switch (step.direction) {
    case DIRECTION_DOWN:
      return open(left, bottom) && open(step.x, bottom) && open(right, bottom);
    case DIRECTION_RIGHT:
      return open(right, top) && open(right, step.y) && open(right, bottom);
    case DIRECTION_UP:
      return open(left, top) && open(step.x, top) && open(right, top);
    case DIRECTION_LEFT:
      return open(left, top) && open(left, step.y) && open(left, bottom);
    default:
      return false;
  }
}
