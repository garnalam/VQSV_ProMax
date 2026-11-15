import {
  AREA_MAP_ARROW_SPRITE,
  AREA_MAP_HERO,
  AREA_MAP_SCREEN,
  AreaMapView,
  areaCellW,
  areaMapScreen,
} from "../game/world/AreaMap";
import type { SourceFontRenderer } from "./font/SourceFontRenderer";

/**
 * Paints `game.l.a(Graphics)` for state 4, the original area map, over whatever the screen already
 * drew (the frozen world stands in for the source's snapshot image `game.a.B().m`).
 */
export type AreaMapArt = {
  font: SourceFontRenderer;
  /** Draw sprite `sprite` state `state` at its anchor (x, y), `tick` ticks into the animation. */
  sprite: (sprite: number, state: number, tick: number, x: number, y: number) => void;
};

const hex = (value: number) => `#${((value & 0xffffff) | 0x1000000).toString(16).slice(1)}`;

/** MIDP `fillRoundRect` / `drawRoundRect`: `arc` is the corner's diameter; outlines cover x..x+w. */
function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  arc: number,
  fill: number | null,
  stroke: number | null,
): void {
  if (fill !== null) {
    g.fillStyle = hex(fill);
    g.beginPath();
    g.roundRect(x, y, w, h, arc / 2);
    g.fill();
  }
  if (stroke !== null) {
    g.strokeStyle = hex(stroke);
    g.lineWidth = 1;
    g.beginPath();
    g.roundRect(x + 0.5, y + 0.5, w, h, arc / 2);
    g.stroke();
  }
}

/**
 * `game.n.a(String, int)`: the source's wrap. Character by character with the bitmap font's
 * advances; a line breaks when it would pass `width`, or at a space once it is within the width of
 * "nhung1" of the edge. The breaking space is dropped.
 */
export function wrapSourceText(font: SourceFontRenderer, text: string, width: number): string[] {
  const slack = width - font.width("nhung1"),
    lines: string[] = [];
  let line = "",
    used = 0;
  for (const ch of text) {
    const advance = font.width(ch);
    used += advance;
    if (used > width || (ch === " " && used > slack)) {
      lines.push(line);
      if (ch !== " ") {
        line = ch;
        used = advance;
      } else {
        line = "";
        used = 0;
      }
    } else line += ch;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * `game.n.b(g, s, x, y, 17)`: horizontally centred, top-anchored. The source measures with
 * `n.a(String)`, which skips the last character, so the centring is that much to the right.
 */
function drawCentered(
  g: CanvasRenderingContext2D,
  font: SourceFontRenderer,
  text: string,
  x: number,
  y: number,
  color: number,
): void {
  const measured = font.width(Array.from(text).slice(0, -1).join(""));
  font.draw(g, text, x - Math.trunc(measured / 2), y, hex(color));
}

export function drawAreaMap(g: CanvasRenderingContext2D, view: AreaMapView, art: AreaMapArt): void {
  const area = view.data;
  if (!area) return;
  const font = art.font,
    lineStep = font.height + 1,
    cellW = areaCellW(area);
  // The rooms: the hero's in light purple, the rest in the area's colour, all outlined in black.
  area.rooms.forEach((box, index) => {
    const x = view.offsetX + box.x * cellW,
      y = view.offsetY + (box.y << 3),
      w = box.w * cellW,
      h = box.h << 3,
      here = view.scene === box.scene && view.room === box.room;
    roundRect(g, x, y, w, h, 12, here ? (188 << 16) | (122 << 8) | 255 : area.fill, 0x000000);
    const centerX = x + Math.trunc((cellW * box.w) / 2),
      centerY = y + Math.trunc((8 * box.h) / 2);
    if (index === view.heroBox)
      art.sprite(AREA_MAP_HERO.sprite, AREA_MAP_HERO.state, view.ticks, centerX, centerY + 20);
    const lines = wrapSourceText(font, box.name, w),
      half = Math.trunc(lines.length / 2);
    lines.forEach((line, n) =>
      drawCentered(g, font, line, centerX, centerY + (n - half) * lineStep, area.text),
    );
  });

  // The hero's room: its doors (green bars across the way through), Đạo quán door, dock.
  g.fillStyle = hex(0x00ff00);
  for (const door of view.doors) {
    const at = view.inHeroBox(door.x, door.y);
    if (door.direction === 0 || door.direction === 1) g.fillRect(at.x, at.y - 2, 9, 3);
    else g.fillRect(at.x, at.y - 5, 3, 9);
  }
  const gym = view.catalog.gymDoor(view.scene, view.room);
  if (gym) {
    const at = view.inHeroBox(gym.x, gym.y);
    g.fillStyle = hex(0xff0000);
    g.fillRect(at.x, at.y, 6, 6);
  }
  const dock = view.catalog.dock(view.scene, view.room);
  if (dock) {
    const at = view.inHeroBox(dock.x, dock.y);
    g.fillStyle = hex(2758133);
    g.fillRect(at.x, at.y, 6, 6);
  }

  // `aN`: the four arrows, shown where more of the area lies beyond the screen.
  for (let i = 0; i < 4; i++) {
    if (!view.arrowVisible(i)) continue;
    const at = AreaMapView.arrowAt(i);
    art.sprite(AREA_MAP_ARROW_SPRITE, i, view.ticks, at.x, at.y);
  }

  // The legend band: each label is written in its swatch's colour (`n.a(g, s, x, y)` keeps it).
  // A wide (landscape) screen stretches the band and centres the three entries on it.
  const screen = areaMapScreen(),
    top = screen.h - 30,
    shift = Math.trunc((screen.w - AREA_MAP_SCREEN.w) / 2);
  g.fillStyle = hex(1862801);
  g.fillRect(0, top, screen.w, 30);
  const legend: [number, number, number, string][] = [
    [0x00ff00, 15, 35, "Cửa ra vào"],
    [2758133, 90, 110, "Bến tàu"],
    [0xff0000, 150, 168, "Cửa Đạo quán"],
  ];
  for (const [color, swatchX, textX, label] of legend) {
    g.fillStyle = hex(color);
    g.fillRect(shift + swatchX, screen.h - 22, 16, 16);
    font.draw(g, label, shift + textX, screen.h - 18, hex(color));
  }
}
