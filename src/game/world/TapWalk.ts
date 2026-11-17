/**
 * Web only (touch accessibility): a tap on the map walks the hero there. A breadth-first search over
 * the hero's own steps — the same step the arrow keys take, so every wall, ledge, badge gate and
 * actor that stops a held key stops the route too. The route is then held one key per tick.
 */
export type WalkStep = { x: number; y: number; moved: boolean };

export type WalkPlanInput = {
  start: { x: number; y: number };
  /** The four directions, in the order ties are broken. */
  directions: readonly number[];
  /** Where pressing `direction` at (x, y) puts the hero (unmoved when refused). */
  step: (x: number, y: number, direction: number) => WalkStep;
  /** True when this step is the end of the route (pressed from `from`). */
  goal: (to: { x: number; y: number }, direction: number, moved: boolean, from: { x: number; y: number }) => boolean;
  /** A step that must not be taken unless it is the goal (a door out of the room). */
  forbidden?: (to: { x: number; y: number }, from: { x: number; y: number }) => boolean;
  /** How far a spot is from where the player wanted to go: the closest is used when no goal is reached. */
  distance?: (x: number, y: number) => number;
  /** The farthest a fallback spot may be (in `distance` units); beyond it there is no route. */
  fallbackWithin?: number;
  limit?: number;
};

/** The keys to hold, and the spot each one is pressed from (`at[i]` before `directions[i]`). */
export type WalkPlan = { directions: number[]; at: string[]; end: string; reachesGoal: boolean };

export const walkKey = (x: number, y: number) => `${x},${y}`;

export function planWalk(input: WalkPlanInput): WalkPlan | null {
  const { start, step, goal, forbidden, distance } = input,
    limit = input.limit ?? 25000,
    startKey = walkKey(start.x, start.y),
    prev = new Map<string, [string, number] | null>([[startKey, null]]),
    queue: [number, number][] = [[start.x, start.y]];
  let best: { key: string; score: number } | null = distance
    ? { key: startKey, score: distance(start.x, start.y) }
    : null;
  const route = (key: string, end: string, last?: number, reachesGoal = true): WalkPlan => {
    const directions: number[] = last === undefined ? [] : [last],
      at: string[] = last === undefined ? [] : [key];
    for (let link = prev.get(key); link; link = prev.get(link[0])) {
      directions.push(link[1]);
      at.push(link[0]);
    }
    return { directions: directions.reverse(), at: at.reverse(), end, reachesGoal };
  };
  if (goal(start, -1, false, start))
    return { directions: [], at: [], end: startKey, reachesGoal: true };
  for (let head = 0; head < queue.length && head < limit; head++) {
    const [x, y] = queue[head],
      from = { x, y },
      key = walkKey(x, y);
    for (const direction of input.directions) {
      const to = step(x, y, direction);
      if (goal(to, direction, to.moved, from))
        return route(key, walkKey(to.x, to.y), direction);
      if (!to.moved) continue;
      if (forbidden?.(to, from)) continue;
      const next = walkKey(to.x, to.y);
      if (prev.has(next)) continue;
      prev.set(next, [key, direction]);
      queue.push([to.x, to.y]);
      if (distance) {
        const score = distance(to.x, to.y);
        if (!best || score < best.score) best = { key: next, score };
      }
    }
  }
  if (!best || best.key === startKey) return null;
  if (input.fallbackWithin !== undefined && best.score > input.fallbackWithin) return null;
  return route(best.key, best.key, undefined, false);
}
