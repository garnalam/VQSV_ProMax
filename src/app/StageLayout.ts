import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from "../core/constants";

/**
 * Where the 240x320 game box goes on the page and how big it is.
 *
 * - `desktop`: no on-screen controls; the box fills the window.
 * - `portrait` (touch, taller than wide): the box sits on top, the gamepad takes the space below.
 * - `landscape` (touch, wider than tall): the box sits in the middle, the pad and A/B on its sides.
 *
 * The box is scaled by a whole number when that keeps most of the size (every source pixel the same
 * size on screen), otherwise by the largest fraction that fits, so a phone does not waste a third
 * of its width for pixel-perfect x1.
 */
export type LayoutMode = "desktop" | "portrait" | "landscape";

export interface StageFit {
  mode: LayoutMode;
  /** CSS pixels. */
  width: number;
  height: number;
  /** CSS pixels per logical pixel. */
  scale: number;
}

/** Height kept under the box for the D-pad and A/B in portrait. */
export const PORTRAIT_PAD_SPACE = 200;
/** Width kept on each side of the box in landscape. */
export const LANDSCAPE_PAD_SPACE = 150;
/** A whole-number scale is used when it keeps at least this share of the fitting size. */
const WHOLE_SCALE_SHARE = 0.85;
const MAX_SCALE = 4;

export function layoutMode(width: number, height: number, touch: boolean): LayoutMode {
  if (!touch) return "desktop";
  return width > height ? "landscape" : "portrait";
}

export function fitStage(width: number, height: number, touch: boolean): StageFit {
  const mode = layoutMode(width, height, touch),
    availableWidth = mode === "landscape" ? width - 2 * LANDSCAPE_PAD_SPACE : width,
    availableHeight = mode === "portrait" ? height - PORTRAIT_PAD_SPACE : height,
    fit = Math.max(
      0.25,
      Math.min(availableWidth / LOGICAL_WIDTH, availableHeight / LOGICAL_HEIGHT, MAX_SCALE),
    ),
    whole = Math.floor(fit),
    scale = whole >= 1 && whole / fit >= WHOLE_SCALE_SHARE ? whole : fit;
  return {
    mode,
    width: Math.floor(LOGICAL_WIDTH * scale),
    height: Math.floor(LOGICAL_HEIGHT * scale),
    scale,
  };
}
