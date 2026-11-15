import { LANDSCAPE_HEIGHT, LANDSCAPE_MIN_WIDTH, landscapeWidthFor } from "../core/Viewport";

/**
 * Where the game canvas goes on the page and how big it is. The canvas is the APK's landscape
 * screen: 240 logical pixels tall, `viewWidth` wide (`Viewport`).
 *
 * - `desktop`: no on-screen controls; the canvas fills the window, as wide as its shape.
 * - `landscape` (touch, wider than tall): the same, full screen; the joystick and A/B float over
 *   the canvas edges.
 * - `portrait` (touch, taller than wide): the narrowest landscape canvas across the top, the
 *   gamepad in the space below.
 */
export type LayoutMode = "desktop" | "portrait" | "landscape";

export interface StageFit {
  mode: LayoutMode;
  /** The canvas width in logical pixels (its height is always `LANDSCAPE_HEIGHT`). */
  viewWidth: number;
  /** CSS pixels. */
  width: number;
  height: number;
  /** CSS pixels per logical pixel. */
  scale: number;
}

/** Height kept under the canvas for the joystick and A/B in portrait. */
export const PORTRAIT_PAD_SPACE = 200;

export function layoutMode(width: number, height: number, touch: boolean): LayoutMode {
  if (!touch) return "desktop";
  return width > height ? "landscape" : "portrait";
}

export function fitStage(width: number, height: number, touch: boolean): StageFit {
  const mode = layoutMode(width, height, touch),
    availableHeight = mode === "portrait" ? height - PORTRAIT_PAD_SPACE : height,
    viewWidth =
      mode === "portrait" ? LANDSCAPE_MIN_WIDTH : landscapeWidthFor(width, availableHeight),
    scale = Math.max(0.25, Math.min(width / viewWidth, availableHeight / LANDSCAPE_HEIGHT));
  return {
    mode,
    viewWidth,
    width: Math.floor(viewWidth * scale),
    height: Math.floor(LANDSCAPE_HEIGHT * scale),
    scale,
  };
}

/**
 * The space the game really has: the page box, but never more than the window. iOS (a home-screen
 * app especially) can hand back a page box still sized for the old orientation after the player
 * switches to another app and comes back sideways, e.g. 844x844 on an 844x390 screen; laid out as
 * is, that reads as an upright phone, zooms the map past the screen and pushes the joystick off it.
 * The window's own size updates first, so it caps the box.
 */
export function liveArea(
  box: { width: number; height: number },
  window: { width: number; height: number },
): { width: number; height: number } {
  const cap = (own: number, outer: number): number => (outer > 0 ? Math.min(own, outer) : own);
  return { width: cap(box.width, window.width), height: cap(box.height, window.height) };
}
