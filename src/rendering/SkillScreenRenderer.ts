import type { PanelFontRenderer } from "./PanelFontRenderer";
import type { SpriteFrame } from "../game/story/GameAssets";
import { wrapChoiceDescription } from "./SourceChoiceRenderer";
import { skillStateColor, type SkillState } from "../game/pet/PetSkillPool";

/**
 * JavaSE `VqsvSceneView.renderSourceSkillUi`: "QUẢN LÝ KỸ NĂNG", the pet's Kỹ năng screen. A dimmed
 * frame, the pet card with its two chips, the TRANG BỊ / BỂ CHIÊU tabs, four rows with a state mark
 * and status, the bar past four rows, the selected skill's detail box and the two softkeys.
 */
export type SkillScreenRow = {
  name: string;
  status: string;
  state: SkillState;
};
export type SkillScreenView = {
  petName: string;
  level: number;
  spriteId: number;
  /** The pet's nature: 7..9 draws it in its shiny palette (`drawSkillDashboardPet`). */
  nature?: number;
  /** The pet's own shiny colour (`SavedPet.shinyColor`), when it has one. */
  shinyColor?: number;
  equippedCount: number;
  poolUnlocked: number;
  poolTotal: number;
  pool: boolean;
  rows: readonly SkillScreenRow[];
  selected: number;
  scroll: number;
  /** The selected skill's detail lines: its full status, meta line and description. */
  detail: { name: string; status: string; state: SkillState; meta: string; description: string };
  action: string;
};
export type SkillScreenArt = {
  font: PanelFontRenderer;
  sprite: (
    spriteId: number,
    nature?: number,
    shinyColor?: number,
  ) =>
    | {
        frame: SpriteFrame;
        image: HTMLImageElement | HTMLCanvasElement;
        bounds: { x: number; y: number; width: number; height: number };
      }
    | undefined;
};

export const SKILL_VISIBLE_ROWS = 4;
const hex = (value: number) => `#${((value & 0xffffff) | 0x1000000).toString(16).slice(1)}`;

function fill(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
}
/** Java `drawRect(x, y, w, h)`. */
function rect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: number) {
  g.strokeStyle = hex(c);
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, w, h);
}

/** `fitSkillDashboardText`: cut with ".." until it fits. */
export function fitSkillText(measure: (t: string) => number, text: string, width: number): string {
  if (measure(text) <= width) return text;
  let end = text.length;
  while (end > 0 && measure(text.slice(0, end) + "..") > width) end--;
  return `${text.slice(0, end)}..`;
}

export function drawSkillScreen(
  g: CanvasRenderingContext2D,
  art: SkillScreenArt,
  view: SkillScreenView,
): void {
  const font = art.font,
    measure = (t: string) => font.taggedWidth(t),
    // `drawSkillDashboardText`.
    text = (value: string, x: number, y: number, w: number, centred: boolean, c: number) => {
      if (!value || w <= 0) return;
      const fitted = fitSkillText(measure, value, w),
        drawX = centred ? x + Math.max(0, Math.trunc((w - measure(fitted)) / 2)) : x;
      g.save();
      g.beginPath();
      g.rect(x, y - 1, w, 13);
      g.clip();
      font.drawTagged(g, fitted, drawX, y, hex(c));
      g.restore();
    },
    tab = (x: number, y: number, w: number, h: number, label: string, on: boolean) => {
      fill(g, x, y, w, h, hex(on ? 16172879 : 1527145));
      rect(g, x, y, w - 1, h - 1, on ? 8145952 : 8440277);
      text(label, x + 2, y + 5, w - 4, true, on ? 1523282 : 0xffffff);
    },
    chip = (label: string, x: number, y: number, w: number, h: number, c: number) => {
      fill(g, x, y, w, h, hex(c));
      text(label, x + 2, y + 1, w - 4, true, 0xffffff);
    },
    softkey = (left: boolean, label: string) => {
      const x = left ? 0 : 177;
      fill(g, x, 294, 63, 26, hex(409441));
      rect(g, x, 294, 62, 25, 16172879);
      text(label, x + 2, 301, 59, true, 0xffffff);
    };

  fill(g, 0, 0, 240, 320, "rgba(2,12,28,0.608)");
  fill(g, 8, 34, 224, 260, "rgba(2,18,34,0.882)");
  fill(g, 10, 32, 220, 258, hex(16172879));
  fill(g, 12, 34, 216, 254, hex(409441));
  rect(g, 14, 36, 211, 249, 12381425);
  fill(g, 15, 37, 210, 20, hex(554650));
  fill(g, 15, 56, 210, 2, hex(16172879));
  text("QUẢN LÝ KỸ NĂNG", 18, 41, 204, true, 0xffffff);
  fill(g, 15, 60, 210, 47, hex(15398900));
  rect(g, 15, 60, 209, 46, 8440277);
  // `drawSkillDashboardPet`: frame 0 of state 0, bottom centre of the box (align 7).
  const sprite = art.sprite(view.spriteId, view.nature, view.shinyColor);
  if (sprite) {
    const b = sprite.bounds,
      x = 18 + Math.trunc((48 - b.width) / 2) - b.x,
      y = 62 + (43 - b.height) - b.y;
    g.save();
    g.beginPath();
    g.rect(18, 62, 48, 43);
    g.clip();
    g.drawImage(sprite.image, x + sprite.frame.ox, y + sprite.frame.oy);
    g.restore();
  }
  text(view.petName, 70, 64, 147, false, 1195861);
  text(`Cấp ${view.level}`, 70, 77, 56, false, 12991302);
  chip(`Trang bị ${view.equippedCount}/5`, 70, 91, 70, 13, 1535875);
  chip(`Bể ${view.poolUnlocked}/${view.poolTotal}`, 144, 91, 73, 13, 7296916);
  tab(18, 110, 102, 22, `TRANG BỊ ${view.equippedCount}/5`, !view.pool);
  tab(120, 110, 102, 22, `BỂ CHIÊU ${view.poolTotal}`, view.pool);

  for (let slot = 0; slot < SKILL_VISIBLE_ROWS; slot++) {
    const index = view.scroll + slot,
      y = 134 + slot * 19,
      row = index >= 0 && index < view.rows.length ? view.rows[index] : undefined,
      on = !!row && index === view.selected,
      state: SkillState = row ? row.state : 4,
      back = on
        ? 16773018
        : state === 2
          ? 14542051
          : state === 3
            ? 15261424
            : state === 4
              ? 14147042
              : 16055285;
    fill(g, 18, y, 204, 18, hex(back));
    rect(g, 18, y, 203, 17, on ? 14781225 : 7646905);
    if (!row) continue;
    fill(g, 22, y + 4, 5, 10, hex(skillStateColor(state)));
    text(row.name, 31, y + 3, 112, false, state >= 2 ? 6583420 : 1195861);
    text(row.status, 145, y + 3, 72, true, skillStateColor(state));
  }
  if (view.rows.length === 0) text("Chưa có kỹ năng", 22, 163, 196, true, 6583420);

  // `drawSkillDashboardScrollbar`.
  if (view.rows.length > SKILL_VISIBLE_ROWS) {
    const track = 73,
      thumb = Math.max(10, Math.trunc((track * SKILL_VISIBLE_ROWS) / view.rows.length)),
      span = Math.max(1, view.rows.length - SKILL_VISIBLE_ROWS),
      top = 135 + Math.trunc(((track - thumb) * view.scroll) / span);
    fill(g, 224, 135, 3, track, hex(2379618));
    fill(g, 224, top, 3, thumb, hex(16172879));
  }

  fill(g, 18, 212, 204, 75, hex(15398900));
  rect(g, 18, 212, 203, 74, 16172879);
  if (view.rows.length > 0) {
    const d = view.detail;
    text(d.name, 23, 216, 125, false, 1195861);
    text(d.status, 150, 216, 66, true, skillStateColor(d.state));
    text(d.meta, 23, 229, 194, false, 1535875);
    wrapChoiceDescription(measure, d.description.trim(), 194, 3).forEach((line, i) =>
      text(line, 23, 244 + i * 12, 194, false, 3755350),
    );
  } else text("Chọn BỂ CHIÊU để xem lộ trình học.", 23, 242, 194, true, 3755350);

  softkey(true, view.action);
  softkey(false, "Quay lại");
}
