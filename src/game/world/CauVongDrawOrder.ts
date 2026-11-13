import type { StoryActor } from "../story/StoryActor";

/** The free-world hero's actor id. */
const PLAYER_ID = -1;

/**
 * `VqsvSceneView`'s Cầu Vồng (scene 98) actor order for one layer. Layers 0 and 2 draw in source
 * row order (`Actor.sourceOrder`). Layer 1 draws by foot y (`sourceFootY` = y + renderOffsetY), then
 * source row; the hero, whose foot is its y, goes in before the first actor standing below it, so an
 * actor whose foot is level with the hero's draws first.
 */
export function cauVongDrawOrder(actors: StoryActor[], layer: number): StoryActor[] {
  const order = (a: StoryActor) => a.sourceOrder ?? 0;
  if (layer !== 1) return [...actors].sort((a, b) => order(a) - order(b) || a.id - b.id);
  const player = actors.find((a) => a.id === PLAYER_ID),
    cast = actors
      .filter((a) => a.id !== PLAYER_ID)
      .sort(
        (a, b) =>
          a.y + a.renderOffsetY - (b.y + b.renderOffsetY) || order(a) - order(b) || a.id - b.id,
      );
  if (!player) return cast;
  const before = cast.findIndex((a) => player.y < a.y + a.renderOffsetY);
  cast.splice(before < 0 ? cast.length : before, 0, player);
  return cast;
}
