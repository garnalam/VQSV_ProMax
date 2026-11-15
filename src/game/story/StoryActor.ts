export type StoryActor = {
  id: number;
  x: number;
  y: number;
  state: number;
  direction: number;
  variant: number;
  sourceKind?: number;
  renderOrientation?: number;
  renderOffsetX: number;
  renderOffsetY: number;
  visible: boolean;
  sprite: number;
  layer: number;
  animationTick: number;
  /** A Cầu Vồng actor's source row (`Actor.sourceOrder`), for `cauVongDrawOrder`. */
  sourceOrder?: number;
  /** `VqsvWorldActors.paletteNature`: 7..9 draws the pet companion in its shiny palette. */
  paletteNature?: number;
  /** The companion's own shiny colour (`SavedPet.shinyColor`). */
  paletteColor?: number;
};
