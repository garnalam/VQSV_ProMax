import { viewport } from "../../core/Viewport";

/** A room's extent in game (JAR) coordinates: an APK landscape map starts at (-originX, -originY). */
export interface RoomFrame {
  width: number;
  height: number;
  originX?: number;
  originY?: number;
  /** The JAR room's size: the portrait camera keeps to it, as JavaSE does. */
  jarWidth?: number;
  jarHeight?: number;
}

/**
 * `VqsvSceneView.centerCamera` for any canvas: the view's top-left so that `focus` is centred,
 * kept inside the room. In landscape a room narrower (or shorter) than the canvas sits centred on
 * it; in the source's portrait it is pinned to the room's edge, as JavaSE does.
 */
export function cameraGoal(
  room: RoomFrame | undefined,
  focusX: number,
  focusY: number,
  fallback: { width: number; height: number } = { width: 240, height: 320 },
): { x: number; y: number } {
  const axis = (low: number, size: number, view: number, focus: number): number => {
    if (size <= view) return viewport.landscape ? low - Math.floor((view - size) / 2) : low;
    return Math.max(low, Math.min(low + size - view, focus - view / 2));
  };
  // Portrait is the JAR's own screen: the camera keeps to the JAR room, as JavaSE does.
  const wide = viewport.landscape,
    // `|| 0`: no -0 for a room without an origin.
    left = wide ? -(room?.originX ?? 0) || 0 : 0,
    top = wide ? -(room?.originY ?? 0) || 0 : 0,
    width = (wide ? room?.width : (room?.jarWidth ?? room?.width)) ?? fallback.width,
    height = (wide ? room?.height : (room?.jarHeight ?? room?.height)) ?? fallback.height;
  return {
    x: axis(left, width, viewport.width, focusX),
    y: axis(top, height, viewport.height, focusY),
  };
}

/**
 * Landscape: the camera as the canvas shows it now. The runtimes centre their camera only when the
 * hero moves or a room opens, so a canvas resized since (full screen on, a phone turned) would
 * keep the old offset: a narrow room off to one side, or a wide one shown past its edge. Each
 * frame re-fits it: a room narrower (or shorter) than the canvas centred on it, a larger one's
 * view kept inside it. Portrait keeps the source camera untouched.
 */
export function fitCamera(
  room: RoomFrame | undefined,
  camera: { x: number; y: number },
): { x: number; y: number } {
  if (!viewport.landscape || !room) return camera;
  const axis = (low: number, size: number, view: number, at: number): number =>
    size <= view
      ? low - Math.floor((view - size) / 2)
      : Math.max(low, Math.min(low + size - view, at));
  return {
    x: axis(-(room.originX ?? 0) || 0, room.width, viewport.width, camera.x),
    y: axis(-(room.originY ?? 0) || 0, room.height, viewport.height, camera.y),
  };
}

/** The room's walkable box in game coordinates, `margin` in from every edge. */
export function roomClamp(
  room: RoomFrame | undefined,
  x: number,
  y: number,
  margin: number,
  fallback: { width: number; height: number } = { width: 240, height: 320 },
): { x: number; y: number } {
  const left = -(room?.originX ?? 0),
    top = -(room?.originY ?? 0),
    width = room?.width ?? fallback.width,
    height = room?.height ?? fallback.height;
  return {
    x: Math.max(left + margin, Math.min(x, left + width - margin)),
    y: Math.max(top + margin, Math.min(y, top + height - margin)),
  };
}
