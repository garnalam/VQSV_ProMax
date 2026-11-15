import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from "./constants";

/**
 * The canvas the game draws on, in logical pixels.
 *
 * - Portrait (the default, and what every test runs with): the source's 240x320 screen.
 * - Landscape (the browser game): the APK's 240-pixel-tall screen, as wide as the device's shape
 *   allows (`LANDSCAPE_MIN_WIDTH`..`LANDSCAPE_MAX_WIDTH`). The world fills the whole canvas; a
 *   screen still laid out for 240x320 is drawn in `ui`, that box scaled to the canvas height and
 *   centred.
 *
 * `backing` is how many device pixels the canvas keeps per logical pixel. In landscape it is a
 * multiple of 4, so the 3/4 UI box lands on whole device pixels and pixel art stays crisp.
 */
export const LANDSCAPE_HEIGHT = 240;
export const LANDSCAPE_MIN_WIDTH = 320;
export const LANDSCAPE_MAX_WIDTH = 576;

export interface UiBox {
  /** Logical pixels per UI pixel. */
  scale: number;
  x: number;
  y: number;
}

export const viewport = {
  landscape: false,
  width: LOGICAL_WIDTH,
  height: LOGICAL_HEIGHT,
  ui: { scale: 1, x: 0, y: 0 } as UiBox,
};

/** The canvas width for a screen of this shape: 240 tall, as wide as it is, within the limits. */
export function landscapeWidthFor(screenWidth: number, screenHeight: number): number {
  const wide = Math.round((LANDSCAPE_HEIGHT * screenWidth) / Math.max(1, screenHeight));
  // Even widths keep the centred UI box and the camera's half-width on whole pixels.
  const even = wide - (wide % 2);
  return Math.max(LANDSCAPE_MIN_WIDTH, Math.min(LANDSCAPE_MAX_WIDTH, even));
}

export function useLandscape(width: number): void {
  viewport.landscape = true;
  viewport.width = width;
  viewport.height = LANDSCAPE_HEIGHT;
  const scale = LANDSCAPE_HEIGHT / LOGICAL_HEIGHT;
  viewport.ui = { scale, x: (width - LOGICAL_WIDTH * scale) / 2, y: 0 };
}

export function usePortrait(): void {
  viewport.landscape = false;
  viewport.width = LOGICAL_WIDTH;
  viewport.height = LOGICAL_HEIGHT;
  viewport.ui = { scale: 1, x: 0, y: 0 };
}

/** A canvas point (logical pixels) in the 240x320 UI box. */
export function toUi(x: number, y: number): { x: number; y: number } {
  const { scale, x: left, y: top } = viewport.ui;
  return { x: Math.floor((x - left) / scale), y: Math.floor((y - top) / scale) };
}

/** A corner of the screen an overlay is pinned to. */
export type Corner = "tl" | "tr" | "bl" | "br";

/**
 * Where a piece of 240x320 UI laid out against `corner` moves to on the canvas, at full size: the
 * world's HUD in landscape sits in the canvas corners rather than shrunk into the centred box. The
 * identity in portrait, where the canvas is the 240x320 screen itself.
 */
export function cornerShift(corner: Corner): { x: number; y: number } {
  return {
    x: corner === "tr" || corner === "br" ? viewport.width - LOGICAL_WIDTH : 0,
    y: corner === "bl" || corner === "br" ? viewport.height - LOGICAL_HEIGHT : 0,
  };
}

/** A UI-box point (what the input reports) back on the canvas, in logical pixels. */
export function fromUi(x: number, y: number): { x: number; y: number } {
  const { scale, x: left, y: top } = viewport.ui;
  return { x: x * scale + left, y: y * scale + top };
}

/**
 * Where the APK's 320x240 battle screen starts on the canvas, in logical pixels: centred at full
 * size in landscape, 0 in portrait (where the JAR's own 240x320 screen is drawn instead).
 */
export function battleFrameX(): number {
  return viewport.landscape ? (viewport.width - 320) / 2 : 0;
}
