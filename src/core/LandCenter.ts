import { battleFrameX, fromUi, viewport } from "./Viewport";

/**
 * Landscape: where a screen still laid out for the JAR's 240x320 sits on the APK's 320x240 one, at
 * full size. `LAND_CENTER` puts the 240x320 screen's centre on the 320x240 one's (the title's
 * panels, the choice box, the notice card); `LAND_BOTTOM` lays its bottom edge on the landscape
 * screen's (the loading bars).
 */
export const LAND_CENTER = { x: 40, y: -40 };
export const LAND_BOTTOM = { x: 40, y: -80 };

type Shift = { x: number; y: number };

/** Draw on the 320x240 screen, moved by `shift`; `k` is device pixels per logical pixel. */
export function landSpace(g: CanvasRenderingContext2D, k: number, shift: Shift = { x: 0, y: 0 }) {
  g.setTransform(k, 0, 0, k, k * (battleFrameX() + shift.x), k * shift.y);
}

/**
 * `body` drawn on the 320x240 screen moved by `shift` (in portrait, as it is). The current transform
 * must be the UI box's (`uiSpace`): the device pixels per logical pixel are read off it.
 */
export function inLandSpace(g: CanvasRenderingContext2D, shift: Shift, body: () => void): void {
  if (!viewport.landscape) {
    body();
    return;
  }
  const k = g.getTransform().a / viewport.ui.scale;
  g.save();
  landSpace(g, k, shift);
  body();
  g.restore();
}

/** A press in the 240x320 UI box (what the input reports) on the 320x240 screen. */
export function landPoint(x: number, y: number): { x: number; y: number } {
  const p = fromUi(x + 0.5, y + 0.5);
  return { x: Math.floor(p.x - battleFrameX()), y: Math.floor(p.y) };
}

/** A press in the UI box on a 240x320 layout drawn with `LAND_CENTER` (unchanged in portrait). */
export function centeredPoint(x: number, y: number): { x: number; y: number } {
  if (!viewport.landscape) return { x, y };
  const p = landPoint(x, y);
  return { x: p.x - LAND_CENTER.x, y: p.y - LAND_CENTER.y };
}
