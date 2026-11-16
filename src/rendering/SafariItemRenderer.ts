import type { SafariAction } from "../game/meta/Safari";

const PALETTE: Record<string, string> = {
  d: "#343a38",
  r: "#6c797e",
  l: "#c6d1cc",
  s: "#95a39f",
  b: "#704321",
  t: "#ba8243",
  g: "#548c32",
  y: "#f3cd61",
  o: "#de9645",
};
const ICONS = {
  bait: [
    "    gg    ",
    "   gggg   ",
    "  bbbb    ",
    " bttyybb  ",
    "btyoyottb ",
    "btyyyoytb ",
    " btttttb  ",
    "  bbbbb   ",
  ],
  rock: [
    "   dddd   ",
    "  dlllld  ",
    " dlllssrd ",
    "dllssrrrd ",
    "dlssrrrdd ",
    " dssrrrd  ",
    "  drrdd   ",
    "   dd     ",
  ],
} as const;

/** Small pixel icons, drawn on the same logical grid as the original item cells. */
export function drawSafariItem(
  g: CanvasRenderingContext2D,
  action: Extract<SafariAction, "bait" | "rock">,
  x: number,
  y: number,
  scale = 1,
): void {
  for (const [row, pixels] of ICONS[action].entries()) {
    for (const [column, color] of [...pixels].entries()) {
      if (color === " ") continue;
      g.fillStyle = PALETTE[color];
      g.fillRect(Math.round(x + column * scale), Math.round(y + row * scale), scale, scale);
    }
  }
}
