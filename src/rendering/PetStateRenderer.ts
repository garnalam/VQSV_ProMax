import type { BattleUiPet, BattleUiState } from "../game/battle/BattleUiState";
import type { PanelFontRenderer } from "./PanelFontRenderer";
import type { SpriteFrame } from "../game/story/GameAssets";
import type { Rect } from "../game/battle/BattleListLayout";
import { natureStatTrend } from "../game/battle/PetStatCalculator";

/**
 * JavaSE `VqsvBattleRenderer.renderPetStateOverlay` and its `drawPetState*` family, shared by the
 * fight ("Xuất chiến") and the map's "Sủng vật" ("Xác định"). Every shape, colour, and animation
 * comes from the JavaSE port:
 *
 * - a white sheen sliding along the header (`43 + tick * 3 % 148`);
 * - the selected roster card blinking its lighter strip every 4 ticks;
 * - the overview's pulsing glow behind the pet and its 1 px idle bob;
 * - long names and values scrolling (`drawMarqueeTinyBattleText`);
 * - polygon stars, raised softkeys with a highlight strip.
 *
 * `tick` is `petstateUiTick`: the ticks since the dashboard opened.
 */
export type PetStateArt = {
  font: PanelFontRenderer;
  /** A `257` UI atlas cell (the skill element icons, 94 + element). */
  cell: (index: number) => HTMLImageElement | undefined;
  /** The pet's idle frame at `tick`, its animation bounds, and its image. */
  sprite: (
    spriteId: number,
    tick: number,
    nature?: number,
    shinyColor?: number,
  ) =>
    | {
        frame: SpriteFrame;
        /** Only once loaded; a nature 7..9 pet comes in its shiny palette. */
        image: HTMLImageElement | HTMLCanvasElement;
        bounds: { x: number; y: number; width: number; height: number };
      }
    | undefined;
};

const WHITE = 0xffffff;
/** A stat a shiny nature raises (green) or lowers (red) on the Chỉ số cards. */
const STAT_RAISED = 0x1f9d3a;
const STAT_LOWERED = 0xd8283a;
const SOURCE_UI_TEXT = 1862801;
const hex = (value: number) => `#${((value & 0xffffff) | 0x1000000).toString(16).slice(1)}`;

/** `skillElementColor`, which `petStateAccent` reuses. */
export function petStateAccent(element: number): number {
  return [14048321, 4954969, 11700805, 4231114, 13676601, 9133494, 5220751][element] ?? 2391970;
}
/** `darkerColor`: 65 % of each channel. */
export function darkerColor(rgb: number): number {
  const part = (shift: number) => Math.trunc((((rgb >>> shift) & 255) * 65) / 100);
  return (part(16) << 16) | (part(8) << 8) | part(0);
}
/** `lighterColor`: each channel +95, capped. */
export function lighterColor(rgb: number): number {
  const part = (shift: number) => Math.min(255, ((rgb >>> shift) & 255) + 95);
  return (part(16) << 16) | (part(8) << 8) | part(0);
}
/** `drawMarqueeTinyBattleText`'s offset: a long text enters from the right half and loops. */
export function marqueeOffset(textWidth: number, width: number, tick: number): number {
  if (textWidth <= width) return 0;
  return ((Math.max(0, tick) + Math.trunc(width / 2)) % Math.max(1, textWidth + width)) - width;
}
/** `sourceHorizontalScrollOffset`: steps 2 px a tick from `-w/2`, wrapping to `-w`. */
export function sourceScrollOffset(textWidth: number, width: number, tick: number): number {
  let offset = -Math.trunc(width / 2);
  const steps = Math.max(0, tick) + 1;
  for (let i = 0; i < steps; i++) offset = textWidth > offset ? offset + 2 : -width;
  return offset;
}
/** The header sheen's left edge. */
export const sheenX = (tick: number) => 43 + ((tick * 3) % 148);
/** The overview glow's size, a 0..7 triangle wave over 16 ticks plus 20. */
export const glowSize = (tick: number) => 20 + (tick % 16 < 8 ? tick % 8 : 15 - (tick % 16));

/** `drawSourceUiFill`. */
function fill(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: number) {
  if (w <= 0 || h <= 0) return;
  g.fillStyle = hex(c);
  g.fillRect(x, y, w, h);
}
/** Java `drawRect(x, y, w, h)`: the outline covers `x..x+w`, `y..y+h`. */
function rect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: number) {
  g.strokeStyle = hex(c);
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, w, h);
}
/** Java `fillRoundRect` / `drawRoundRect` with its arc diameter. */
function roundFill(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  arc: number,
  style: string,
) {
  g.fillStyle = style;
  g.beginPath();
  g.roundRect(x, y, w, h, arc / 2);
  g.fill();
}
function roundStroke(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  arc: number,
  c: number,
) {
  g.strokeStyle = hex(c);
  g.lineWidth = 1;
  g.beginPath();
  g.roundRect(x + 0.5, y + 0.5, w, h, arc / 2);
  g.stroke();
}
function polygon(
  g: CanvasRenderingContext2D,
  xs: readonly number[],
  ys: readonly number[],
  fillColor: number | null,
  strokeColor: number | null = null,
) {
  const path = () => {
    g.beginPath();
    xs.forEach((x, i) => (i ? g.lineTo(x + 0.5, ys[i] + 0.5) : g.moveTo(x + 0.5, ys[i] + 0.5)));
    g.closePath();
  };
  if (fillColor !== null) {
    g.fillStyle = hex(fillColor);
    path();
    g.fill();
  }
  if (strokeColor !== null) {
    g.strokeStyle = hex(strokeColor);
    g.lineWidth = 1;
    path();
    g.stroke();
  }
}

export class PetStateRenderer {
  constructor(private readonly art: PetStateArt) {}

  private get font(): PanelFontRenderer {
    return this.art.font;
  }

  /** `drawTinyBattleText`: clipped to `w` and 18 px from `y - 1`. */
  private tiny(
    g: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    w: number,
    c: number,
  ) {
    g.save();
    g.beginPath();
    g.rect(x, y - 1, Math.max(1, w), 18);
    g.clip();
    this.font.drawTagged(g, text, x, y, hex(c));
    g.restore();
  }
  /** `drawCenteredTinyText`. */
  private centered(
    g: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    w: number,
    c: number,
  ) {
    const width = Math.min(w, this.font.width(text));
    this.tiny(g, text, x + Math.max(0, Math.trunc((w - width) / 2)), y, w, c);
  }
  /** `drawMarqueeTinyBattleText`. */
  private marquee(
    g: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    w: number,
    c: number,
    tick: number,
  ) {
    const offset = marqueeOffset(this.font.taggedWidth(text), w, tick);
    g.save();
    g.beginPath();
    g.rect(x, y - 1, Math.max(1, w), 18);
    g.clip();
    this.font.drawTagged(g, text, x - offset, y, hex(c));
    g.restore();
  }
  /** `drawSourceWidgetText` with `b == 4`: centred, or scrolling when it overflows. */
  private widgetText(
    g: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    w: number,
    h: number,
    c: number,
    tick: number,
  ) {
    const width = this.font.taggedWidth(text),
      drawX =
        width > w
          ? x - sourceScrollOffset(width, w, tick)
          : x + Math.max(0, Math.trunc((w - width) / 2)),
      drawY = y + Math.max(0, Math.trunc((h - 10) / 2));
    g.save();
    g.beginPath();
    g.rect(x, y, w, Math.max(1, h));
    g.clip();
    this.font.drawTagged(g, text, drawX, drawY, hex(c));
    g.restore();
  }

  /**
   * `compact`: the landscape battle screen's dashboard (`LAND_PET_STATE`), shorter, its softkeys in
   * the screen's corners.
   */
  render(
    g: CanvasRenderingContext2D,
    ui: BattleUiState,
    tick: number,
    inBattle: boolean,
    compact?: { height: number; action: Rect; back: Rect },
  ): void {
    const start = Math.max(0, ui.scroll),
      size = ui.rows.length,
      selectedSlot = Math.max(0, Math.min(5, ui.selectedIndex - start)),
      selected = ui.rows[start + selectedSlot]?.pet,
      tab = ui.tab ?? 0;
    this.staticWidgets(g, ui, selected, tick, tab === 1, compact?.height ?? 249);
    this.pageTabs(g, tab);
    if (ui.selectedIndex > 0) this.arrow(g, 203, 225, true);
    if (ui.selectedIndex < size - 1) this.arrow(g, 203, 244, false);
    for (let slot = 0; slot < 6; slot++) this.row(g, ui, slot, tick);
    if (size === 0) this.centered(g, "...", 43, 131, 66, SOURCE_UI_TEXT);
    if (selected) {
      const name = ui.rows[start + selectedSlot]?.name ?? "";
      if (tab === 1) this.stats(g, name, selected, tick);
      else if (tab === 2) this.traits(g, name, selected, tick, ui.talent === true);
      else if (tab === 3) this.skills(g, name, selected, tick);
      else this.overview(g, name, selected, tick);
    }
    const action = ui.prompt || (inBattle ? "Xuất chiến" : "Xác định");
    const at = compact ?? {
      action: { x: 42, y: 263, w: 64, h: 22 },
      back: { x: 144, y: 263, w: 56, h: 22 },
    };
    this.softkey(g, at.action.x, at.action.y, at.action.w, at.action.h, action, true, tick);
    this.softkey(g, at.back.x, at.back.y, at.back.w, at.back.h, "Quay lại", false, tick);
  }

  /** `drawPetStateStaticWidgets`. */
  private staticWidgets(
    g: CanvasRenderingContext2D,
    ui: BattleUiState,
    pet: BattleUiPet | undefined,
    tick: number,
    showingStats: boolean,
    height = 249,
  ) {
    const accent = petStateAccent(pet?.element ?? -1);
    roundFill(g, 18, 44, 208, height, 13, hex(399396));
    roundFill(g, 15, 40, 208, height, 12, hex(15333108));
    roundFill(g, 15, 40, 208, 33, 10, hex(darkerColor(accent)));
    fill(g, 15, 60, 208, 13, darkerColor(accent));
    fill(g, 15, 70, 208, 3, accent);
    roundFill(g, sheenX(tick), 43, 24, 14, 8, "rgba(255,255,255,0.165)");
    roundStroke(g, 15, 40, 207, height - 1, 12, lighterColor(accent));
    roundStroke(g, 17, 42, 203, height - 5, 9, WHITE);
    fill(g, 25, 81, 188, 132, 14676206);
    for (let x = 33; x < 213; x += 16) fill(g, x, 81, 1, 132, 12113876);
    this.choiceFrame(g, 25, 81, 188, 132);
    fill(g, 25, 216, 188, 41, 1591642);
    this.choiceFrame(g, 25, 216, 188, 41);
    // `drawPetStateHeaderBackArrow`.
    polygon(g, [33, 43, 43, 51, 51, 43, 43], [61, 53, 57, 57, 65, 65, 69], 600892);
    polygon(g, [35, 43, 43, 49, 49, 43, 43], [61, 55, 58, 58, 64, 64, 67], 16765802);
    fill(g, 38, 61, 11, 1, WHITE);
    this.marquee(g, "HỒ SƠ SỦNG VẬT", 59, 58, 107, WHITE, tick);
    const count = ui.rows.length ? `${Math.max(0, ui.selectedIndex) + 1}/${ui.rows.length}` : "0/0";
    this.pill(g, count, 174, 53, 28, 14, accent, WHITE);
    if (pet?.divineSealed && showingStats)
      this.tiny(g, "PHONG ẤN: chỉ số -70%", 31, 218, 177, 0xff626b);
    else {
      this.tiny(g, "Đội hình nhanh", 31, 218, 92, 16251903);
      this.tiny(g, "chọn để xem", 128, 218, 69, 10409434);
    }
  }
  /** `drawChoiceFrame`. */
  private choiceFrame(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    rect(g, x, y, w - 1, h - 1, 15267071);
    rect(g, x + 1, y + 1, w - 3, h - 3, 3432558);
  }
  /** `drawPetStatePageTabs`. */
  private pageTabs(g: CanvasRenderingContext2D, tab: number) {
    const tabs = [
      ["Hồ sơ", 30, 73],
      ["Chỉ số", 74, 116],
      ["Đặc tính", 117, 161],
      ["Kỹ năng", 162, 207],
    ] as const;
    tabs.forEach(([label, left, right], i) => {
      const w = Math.max(1, right - left),
        on = i === tab;
      fill(g, left, 68, w, 11, on ? 16765802 : 11196636);
      rect(g, left, 68, w - 1, 10, on ? 6046231 : 6134948);
      this.tiny(g, label, left + 2, 68, w - 4, on ? 6046231 : 2382443);
    });
  }
  /** `drawPetStateArrow`. */
  private arrow(g: CanvasRenderingContext2D, x: number, y: number, up: boolean) {
    const xs = [x + 1, x + 5, x + 9],
      ys = up ? [y + 8, y + 2, y + 8] : [y + 2, y + 8, y + 2];
    polygon(g, xs, ys, 600892, 16765802);
  }
  /** `drawPetStateRow`: the 3 × 2 quick roster under the details. */
  private row(g: CanvasRenderingContext2D, ui: BattleUiState, slot: number, tick: number) {
    const x = 32 + (slot % 3) * 60,
      y = 228 + Math.trunc(slot / 3) * 18,
      w = 52,
      h = 15,
      index = Math.max(0, ui.scroll) + slot,
      row = index < ui.rows.length ? ui.rows[index] : undefined;
    if (!row) {
      // `drawPetStateEmptyRow`.
      fill(g, x, y, w, h, 14017503);
      rect(g, x, y, w - 1, h - 1, 10796733);
      this.miniGauge(g, x + 17, y + 11, 29, 2, 0, 9545384, 12044743);
      this.miniGauge(g, x + 48, y + 11, 14, 2, 0, 9545384, 12044743);
      return;
    }
    const pet = row.pet,
      on = index === ui.selectedIndex,
      accent = petStateAccent(pet?.element ?? -1),
      alive = pet ? pet.hp > 0 : true,
      active = pet?.active ?? pet?.status === "Đang ra trận";
    if (on) fill(g, x + 2, y + 2, w, h, 466733);
    fill(g, x, y, w, h, on ? darkerColor(accent) : alive ? 15529971 : 9413537);
    fill(g, x, y, 4, h, active ? 5429385 : on ? accent : 6662578);
    if (on && (Math.trunc(tick / 4) & 1) === 0)
      fill(g, x + 5, y + 1, w - 7, 2, lighterColor(accent));
    rect(g, x, y, w - 1, h - 1, on ? 16769930 : 8369846);
    this.tiny(g, String(index + 1), x + 6, y + 2, 9, on ? 16769930 : 10967356);
    this.marquee(g, row.name, x + 16, y + 2, 31, on ? WHITE : alive ? 2116696 : 6120805, tick);
    const hpPercent = pet && pet.maxHp > 0 ? Math.trunc((pet.hp * 100) / pet.maxHp) : 0;
    this.miniGauge(g, x + 16, y + 12, 29, 2, hpPercent, alive ? 5622151 : 9071210, 10269357);
  }
  /** `drawPetStateMiniGauge`. */
  private miniGauge(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    percent: number,
    color: number,
    back: number,
  ) {
    fill(g, x, y, w, h, back);
    const filled = Math.max(
      0,
      Math.min(w, Math.trunc((w * Math.max(0, Math.min(100, percent))) / 100)),
    );
    if (filled > 0) fill(g, x, y, filled, h, color);
  }
  /** `drawPetStateGauge`. */
  private gauge(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    percent: number,
    color: number,
    back: number,
  ) {
    fill(g, x, y, w, h, back);
    const filled = Math.max(
      0,
      Math.min(w, Math.trunc((w * Math.max(0, Math.min(100, percent))) / 100)),
    );
    if (filled > 1 && h > 1) fill(g, x + 1, y + 1, filled - 1, h - 1, color);
    rect(g, x, y, w, h, 5275546);
  }
  /** `drawPetStatePill`. */
  private pill(
    g: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    w: number,
    h: number,
    fillColor: number,
    textColor: number,
  ) {
    roundFill(g, x, y, w, h, 7, hex(fillColor));
    roundStroke(g, x, y, w - 1, h - 1, 7, WHITE);
    this.centered(g, text, x + 2, y + 1, w - 4, textColor);
  }
  /** `drawPetStateInfoChip`. */
  private infoChip(
    g: CanvasRenderingContext2D,
    label: string,
    value: string,
    x: number,
    y: number,
    w: number,
    color: number,
    tick: number,
  ) {
    fill(g, x, y, w, 15, 16120824);
    fill(g, x, y, 35, 15, color);
    rect(g, x, y, w - 1, 14, lighterColor(color));
    this.centered(g, label, x + 3, y + 2, 29, WHITE);
    this.marquee(g, value, x + 40, y + 2, w - 44, 1523542, tick);
  }
  /** `drawPetStateStarGlyph`. */
  private star(g: CanvasRenderingContext2D, x: number, y: number) {
    polygon(
      g,
      [x + 3, x + 4, x + 6, x + 4, x + 3, x + 2, x, x + 2],
      [y, y + 2, y + 2, y + 3, y + 5, y + 3, y + 2, y + 2],
      16763215,
      9069601,
    );
  }
  /** `petStateDisplayedStarCount`. */
  private stars(pet: BattleUiPet): number {
    return Math.max(0, Math.min(5, pet.quality));
  }

  /** `drawPetStateOverview`: Hồ sơ. */
  private overview(g: CanvasRenderingContext2D, name: string, pet: BattleUiPet, tick: number) {
    const accent = petStateAccent(pet.element),
      alive = pet.hp > 0,
      active = pet.active ?? pet.status === "Đang ra trận";
    fill(g, 29, 84, 180, 29, darkerColor(accent));
    fill(g, 29, 111, 180, 2, 16768889);
    this.marquee(g, name, 36, 87, 96, WHITE, tick);
    // `"Hệ " + blankAsDash(taxonomyElementName) + "  •  " + blankAsDash(taxonomySpeciesName)`.
    this.tiny(
      g,
      `Hệ ${pet.elementName || "--"}  •  ${pet.speciesName || "--"}`,
      36,
      99,
      113,
      13233648,
    );
    this.pill(g, `Lv ${pet.level}`, 153, 87, 46, 14, lighterColor(accent), 1521991);
    fill(g, 30, 117, 76, 70, 12048853);
    fill(g, 32, 119, 72, 66, 15989752);
    rect(g, 30, 117, 75, 69, accent);
    const glow = glowSize(tick);
    g.fillStyle = `rgba(${(accent >> 16) & 255},${(accent >> 8) & 255},${accent & 255},${34 / 255})`;
    g.beginPath();
    g.ellipse(
      51 - Math.trunc(glow / 4) + (36 + Math.trunc(glow / 2)) / 2,
      133 - Math.trunc(glow / 4) + (36 + Math.trunc(glow / 2)) / 2,
      (36 + Math.trunc(glow / 2)) / 2,
      (36 + Math.trunc(glow / 2)) / 2,
      0,
      0,
      Math.PI * 2,
    );
    g.fill();
    const sprite = this.art.sprite(pet.spriteId, tick, pet.nature, pet.shinyColor);
    if (sprite) {
      // `drawAligned(32, 112 + bob, 72, 73, 7)`: bottom centre of the animation's bounds.
      const bob = (Math.trunc(tick / 7) & 1) === 0 ? 0 : -1,
        b = sprite.bounds,
        drawX = 32 + Math.trunc((72 - b.width) / 2) - b.x,
        drawY = 112 + bob + (73 - b.height) - b.y;
      g.save();
      g.beginPath();
      g.rect(32, 119, 72, 66);
      g.clip();
      g.drawImage(sprite.image, drawX + sprite.frame.ox, drawY + sprite.frame.oy);
      g.restore();
    }
    this.infoChip(
      g,
      "Chiến",
      alive ? (active ? "Xuất chiến" : "Sẵn sàng") : "Không thể chiến",
      111,
      118,
      96,
      alive ? 4367987 : 11752532,
      tick,
    );
    // `drawPetStateStarChip`.
    const starColor = 14064434;
    fill(g, 111, 135, 96, 15, 16120824);
    fill(g, 111, 135, 35, 15, starColor);
    rect(g, 111, 135, 95, 14, lighterColor(starColor));
    this.centered(g, "Sao", 114, 137, 29, WHITE);
    const count = this.stars(pet),
      span = count <= 0 ? 0 : count * 8 - 1,
      left = 151 + Math.max(0, Math.trunc((52 - span) / 2));
    for (let i = 0; i < count; i++) this.star(g, left + i * 8, 140);
    this.infoChip(g, "Đeo", pet.held || "--", 111, 152, 96, 5406640, tick);
    // `compactPetStateEvolution(evolutionText)`, or "Hình thái cuối" for a final form.
    const evolution = pet.evolution ? pet.evolution.replace(/^Có thể /, "") : "Hình thái cuối";
    this.infoChip(g, "Hóa", evolution, 111, 169, 96, 8807338, tick);
    const hpPercent = pet.maxHp > 0 ? Math.trunc((pet.hp * 100) / pet.maxHp) : 0;
    this.gauge(g, 31, 191, 176, 6, hpPercent, 5293180, 10204334);
    this.tiny(g, `HP ${pet.hp}/${pet.maxHp}`, 33, 198, 85, 2382443);
    this.gauge(g, 31, 207, 121, 3, pet.expPercent, 5149656, 11913412);
    this.tiny(g, `EXP ${pet.expPercent}%`, 156, 203, 48, 2382443);
  }

  /** `drawPetStateStatDetails`: Chỉ số. */
  private stats(g: CanvasRenderingContext2D, name: string, pet: BattleUiPet, tick: number) {
    // The seal's red exclamation, drawn first as Java does (the identity band starts left of it).
    if (pet.divineSealed) {
      fill(g, 212, 87, 5, 10, 0xe82d3c);
      fill(g, 212, 100, 5, 4, 0xe82d3c);
    }
    const accent = petStateAccent(pet.element);
    fill(g, 29, 84, 180, 25, darkerColor(accent));
    this.marquee(g, name, 36, 88, 80, WHITE, tick);
    // `drawPetQualityStars(122, 90)`: overlapping stars 4 px apart.
    for (let i = 0; i < this.stars(pet); i++) this.star(g, 121 + i * 4, 90);
    this.pill(g, `Lv ${pet.level}`, 164, 87, 37, 14, lighterColor(accent), 1521991);
    const cards = [
      ["HP", pet.stats[0], 30, 114, 85, 5160824],
      ["SỨC MẠNH", pet.stats[1], 121, 114, 86, 13983061],
      ["PHÒNG NGỰ", pet.stats[2], 30, 157, 85, 4886465],
      ["LINH XẢO", pet.stats[3], 121, 157, 86, 12814902],
    ] as const;
    // Web: a shiny nature (7..9) bends hp, attack and speed; the raised numbers read green and the
    // lowered ones red instead of the usual dark ink.
    const trend = natureStatTrend(pet.nature);
    for (const [index, [label, value, x, y, w, color]] of cards.entries()) {
      // `drawPetStateStatDashboardCard`.
      fill(g, x + 2, y + 2, w, 38, 9087141);
      fill(g, x, y, w, 38, 16186361);
      fill(g, x, y, w, 5, color);
      rect(g, x, y, w - 1, 37, lighterColor(color));
      this.centered(g, label, x + 5, y + 9, w - 10, 4614768);
      const ink = trend[index] > 0 ? STAT_RAISED : trend[index] < 0 ? STAT_LOWERED : 1523542;
      this.centered(g, String(value), x + 5, y + 23, w - 10, ink);
    }
    fill(g, 30, 200, 177, 10, 1523542);
    this.tiny(g, `HP ${pet.hp}/${pet.maxHp}`, 34, 201, 76, 14283762);
    this.tiny(g, `EXP ${pet.expPercent}%`, 111, 201, 42, 12181503);
    const buffs = pet.buffCount ?? 0,
      debuffs = pet.debuffCount ?? 0;
    this.tiny(g, `B${buffs} / D${debuffs}`, 157, 201, 46, debuffs > 0 ? 16757417 : 13101785);
  }

  /** `drawPetStateTraitDetails`: Đặc tính or Thiên phú, whichever row is selected. */
  private traits(
    g: CanvasRenderingContext2D,
    name: string,
    pet: BattleUiPet,
    tick: number,
    talent: boolean,
  ) {
    const accent = petStateAccent(pet.element);
    fill(g, 30, 84, 178, 27, darkerColor(accent));
    fill(g, 30, 109, 178, 2, lighterColor(accent));
    this.marquee(g, name, 36, 88, 74, WHITE, tick);
    this.marquee(g, `Hệ: ${pet.elementName || "--"}`, 114, 88, 86, 12380142, tick);
    this.marquee(g, `Chủng: ${pet.speciesName || "--"}`, 36, 99, 164, 12380142, tick + 17);
    this.traitRow(g, `Đặc tính: ${pet.trait?.name ?? ""}`, 113, !talent, tick);
    this.traitRow(g, `Thiên phú: ${pet.talent?.name ?? ""}`, 128, talent, tick);
    fill(g, 30, 148, 176, 62, 15924217);
    fill(g, 30, 148, 176, 12, talent ? 13985106 : 2980994);
    rect(g, 30, 148, 175, 61, 8239288);
    this.marquee(g, talent ? "Mô tả thiên phú" : "Mô tả đặc tính", 36, 150, 164, WHITE, tick);
    const shown = talent ? pet.talent : pet.trait;
    this.wrapped(g, shown?.description ?? "", 36, 164, 164, 41, tick);
  }
  /** `drawPetStateTraitRow`. */
  private traitRow(
    g: CanvasRenderingContext2D,
    text: string,
    y: number,
    on: boolean,
    tick: number,
  ) {
    fill(g, 30, y, 176, 14, on ? 16765802 : 14282733);
    fill(g, 30, y, 5, 14, on ? 11883090 : 7254711);
    rect(g, 30, y, 175, 13, on ? 6046231 : 7711401);
    this.marquee(g, text, 39, y + 2, 160, on ? 6046231 : 2382443, tick);
  }
  /** `drawWrappedPetStateText`: 10 px lines; an overflowing text pages every 45 ticks. */
  private wrapped(
    g: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    w: number,
    h: number,
    tick: number,
  ) {
    const lines: string[] = [];
    let line = "";
    for (const word of text.trim().split(/\s+/)) {
      if (!word) continue;
      const candidate = line ? `${line} ${word}` : word;
      if (line && this.font.taggedWidth(candidate) > w) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    if (line) lines.push(line);
    if (!lines.length) lines.push("");
    const visible = Math.max(1, Math.trunc(h / 10)),
      extra = Math.max(0, lines.length - visible),
      first = extra === 0 ? 0 : Math.trunc(Math.max(0, tick) / 45) % (extra + 1);
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    for (let i = 0; i < visible && first + i < lines.length; i++)
      this.tiny(g, lines[first + i], x, y + i * 10, w, SOURCE_UI_TEXT);
    g.restore();
  }

  /** `drawPetStateSkillDetails`: Kỹ năng. */
  private skills(g: CanvasRenderingContext2D, name: string, pet: BattleUiPet, tick: number) {
    const accent = petStateAccent(pet.element);
    fill(g, 29, 84, 180, 25, darkerColor(accent));
    this.marquee(g, name, 36, 88, 93, WHITE, tick);
    this.pill(g, `${pet.skills.length}/5 chiêu`, 143, 87, 58, 14, lighterColor(accent), 1521991);
    for (let i = 0; i < 5; i++) {
      const y = 113 + i * 19,
        skill = pet.skills[i];
      if (!skill) {
        fill(g, 30, y, 177, 17, 13097430);
        rect(g, 30, y, 176, 16, 10204851);
        this.tiny(g, String(i + 1), 35, y + 3, 9, 7506827);
        this.tiny(g, "Chưa trang bị kỹ năng", 51, y + 3, 116, 7506827);
        continue;
      }
      const element = skill.element ?? -1,
        color = petStateAccent(element),
        [current, maximum] = skill.pp.split("/").map((part) => Number.parseInt(part, 10)),
        pp = Number.isFinite(current) ? Math.max(0, current) : 0,
        ppMax = Math.max(1, Number.isFinite(maximum) ? maximum : 1);
      fill(g, 30, y, 177, 17, 16055288);
      fill(g, 30, y, 5, 17, color);
      rect(g, 30, y, 176, 16, lighterColor(color));
      // `drawPetStateSlotBadge`.
      g.fillStyle = hex(color);
      g.beginPath();
      g.ellipse(37 + 5.5, y + 2 + 5.5, 5.5, 5.5, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#fff";
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(37 + 5.5, y + 2 + 5.5, 5, 5, 0, 0, Math.PI * 2);
      g.stroke();
      this.centered(g, String(i + 1), 38, y + 2, 9, WHITE);
      if (element >= 0) {
        const icon = this.art.cell(94 + element);
        if (icon && icon.complete && icon.naturalWidth > 0) g.drawImage(icon, 51, y + 3);
      }
      this.marquee(g, skill.name, 66, y + 3, 76, 1855070, tick + i * 11);
      this.tiny(g, `${pp}/${ppMax}`, 161, y + 3, 41, pp > 0 ? 2584455 : 11750990);
      this.miniGauge(
        g,
        148,
        y + 13,
        54,
        2,
        Math.trunc((pp * 100) / ppMax),
        pp > 0 ? color : 10123127,
        11452348,
      );
    }
  }

  /** `drawPetStateSoftkey`. */
  private softkey(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    primary: boolean,
    tick: number,
  ) {
    fill(g, x + 2, y + 2, w, h, 600892);
    fill(g, x, y, w, h, primary ? 13985106 : 3573924);
    fill(g, x + 2, y + 2, w - 4, 2, primary ? 16756883 : 9556444);
    rect(g, x, y, w - 1, h - 1, primary ? 16765802 : 12315376);
    this.widgetText(g, label, x + 2, y, w - 4, h, WHITE, tick);
  }
}
