import {
  cauVongEdgeClear,
  passable,
  PLAYER_HALF_SIZE,
  stepWithTerrain,
  terrainAtWorld,
  type MapCollision,
} from "./MapCollision";

type Point = { x: number; y: number };

/** Old room arrivals that could already have been written into a save. */
const blockedArrivals: Readonly<Record<string, readonly [number, number]>> = {
  "11:7": [176, 112],
  "7:12": [192, 48],
  "9:6": [168, 224],
  "10:7": [264, 368],
  "11:0": [40, 256],
};

export function wasBlockedArrival(scene: number, room: number, at: Point): boolean {
  const blocked = blockedArrivals[`${scene}:${room}`];
  return blocked?.[0] === at.x && blocked[1] === at.y;
}

/** Repair an embedded or immobile spawn without nudging a player who can already walk out. */
export function safeRoomArrival(
  map: MapCollision,
  at: Point,
  speed: number,
  terrain: (raw: number) => number,
  badgeGatedOpen: boolean,
  cauVong: boolean,
  preserveEscapable: boolean,
  actorBlocks: (x: number, y: number, direction: number, speed: number) => boolean,
): Point | null {
  const open = (x: number, y: number) =>
    passable(terrain(terrainAtWorld(map, x, y)), badgeGatedOpen);
  const fits = (x: number, y: number) => {
    for (const dx of [-PLAYER_HALF_SIZE, 0, PLAYER_HALF_SIZE - 1])
      for (const dy of [-PLAYER_HALF_SIZE, 0, PLAYER_HALF_SIZE - 1])
        if (!open(x + dx, y + dy)) return false;
    return true;
  };
  const canStep = (x: number, y: number) =>
    [0, 1, 2, 3].some((direction) => {
      const step = stepWithTerrain(map, x, y, direction, badgeGatedOpen, speed, terrain);
      return (
        step.moved &&
        (!cauVong || cauVongEdgeClear(map, step, terrain)) &&
        !actorBlocks(x, y, direction, speed) &&
        !actorBlocks(x, y, step.direction, speed)
      );
    });
  if (fits(at.x, at.y) || ((preserveEscapable || open(at.x, at.y)) && canStep(at.x, at.y)))
    return null;

  let best: Point | null = null;
  let nearest = Infinity;
  for (let ty = 0; ty < map.heightTiles; ty++) {
    for (let tx = 0; tx < map.widthTiles; tx++) {
      const x = tx * map.tileSize + Math.floor(map.tileSize / 2);
      const y = ty * map.tileSize + Math.floor(map.tileSize / 2);
      const distance = (x - at.x) ** 2 + (y - at.y) ** 2;
      if (distance >= nearest || !fits(x, y) || actorBlocks(x, y, 0, 0) || !canStep(x, y)) continue;
      best = { x, y };
      nearest = distance;
    }
  }
  return best;
}
