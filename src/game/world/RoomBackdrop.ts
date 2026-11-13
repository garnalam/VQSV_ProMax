/**
 * What JavaSE paints behind a room's map layers (`VqsvSceneView.renderWorld`): the fill colour
 * from `NguyenMocRoutePresentationPolicy.background`, then the `backgroundImage` strip tiled
 * across the screen (`renderSourceBackPic`), fixed to the screen rather than the map. Thiên
 * Giới (7:0–7:12) and its guardian routes (10:1–10:7) hang in the sky gradient (img 19); Hắc
 * Thạch's dark rooms (5:0, 5:2–5:5) over the abyss (img 20).
 */

/** `DEFAULT_BACK_PIC` and `ROOM3_BACK_PIC`. */
const DEFAULT_BACK_PIC = "#2db9c4";
const ROOM3_BACK_PIC = "#00a4ae";

/** `NguyenMocRoutePresentationPolicy.owns`: the rooms this presentation policy paints. */
function owns(scene: number, room: number): boolean {
  return (
    (scene === 2 && room === 7) ||
    (scene === 3 && room >= 0 && room <= 7) ||
    (scene === 4 && room >= 0 && room <= 12) ||
    (scene === 5 && room >= 0 && room <= 6) ||
    (scene === 7 && room >= 0 && room <= 12) ||
    (scene === 8 && room >= 0 && room <= 6) ||
    (scene === 9 && ((room >= 1 && room <= 5) || room === 7)) ||
    (scene === 10 && ((room >= 1 && room <= 8) || room === 0 || room === 13 || room === 14)) ||
    (scene === 11 &&
      ((room >= 0 && room <= 3) || room === 12 || room === 13 || (room >= 16 && room <= 28)))
  );
}

/** `background(s)`: the fill under a map room; black where the policy names none. */
export function roomBackdropColor(scene: number, room: number): string {
  if (scene === 8 && room >= 0 && room <= 6) return "#000000";
  if (scene === 10 && room === 14) return "#000000";
  if ((scene === 3 && room >= 3 && room <= 7) || (scene === 10 && room === 13))
    return ROOM3_BACK_PIC;
  if (scene === 10 && room === 0) return ROOM3_BACK_PIC;
  return owns(scene, room) ? DEFAULT_BACK_PIC : "#000000";
}

/** `backgroundImage(s)`: the `backpic` pack entry tiled over the fill, if any. */
export function roomBackPic(scene: number, room: number): "sky" | "abyss" | null {
  if ((scene === 7 && room >= 0 && room <= 12) || (scene === 10 && room >= 1 && room <= 7))
    return "sky";
  if (scene === 5 && (room === 0 || (room >= 2 && room <= 5))) return "abyss";
  return null;
}
