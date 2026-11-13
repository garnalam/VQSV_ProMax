import { CAU_VONG_SLOTS, CAU_VONG_TARGET } from "../game/campaign/CauVongIncubator";
import {
  CAU_VONG_INCUBATOR_TEXT,
  type CauVongIncubatorPanelState,
  type CauVongIncubatorSource,
} from "../game/world/CauVongIncubatorPanel";
import type { PanelFontRenderer } from "./PanelFontRenderer";

/**
 * JavaSE `CauVongIncubatorPanel.render`: a flat 240×320 sheet — the five rounded slots with their
 * progress bars, the selected egg's species, level and materials, the action rows, the message and
 * the softkeys; or the owned-egg list (eight 23 px rows, 25 px apart) with its arrows.
 */
const hex = (value: number) => `#${((value & 0xffffff) | 0x1000000).toString(16).slice(1)}`;

export function drawCauVongIncubator(
  g: CanvasRenderingContext2D,
  panel: CauVongIncubatorPanelState,
  source: CauVongIncubatorSource,
  font: PanelFontRenderer,
): void {
  const text = (value: string, x: number, y: number, color: number) =>
    font.drawTagged(g, value, x, y, hex(color));
  const rect = (color: number, x: number, y: number, w: number, h: number) => {
    g.fillStyle = hex(color);
    g.fillRect(x, y, w, h);
  };
  const eggs = source.eggs(),
    recipe = (item: number) => eggs.find((row) => row.itemId === item)?.incubator,
    name = (item: number) => recipe(item)?.speciesName ?? "Pet";
  rect(0x102b3c, 0, 0, 240, 320);
  text(CAU_VONG_INCUBATOR_TEXT.title, 12, 12, 0xffe19a);
  if (panel.menu === 1) {
    text(`Chọn trứng sở hữu · ô ${panel.selected + 1}`, 12, 29, 0xffffff);
    const choices = panel.choices;
    for (let i = panel.eggScroll; i < Math.min(choices.length, panel.eggScroll + 8); i++) {
      const y = 45 + (i - panel.eggScroll) * 25,
        id = choices[i];
      rect(i === panel.action ? 0x58704a : 0x264659, 10, y, 220, 23);
      text(id === 0 ? "Quay lại" : `${name(id)} ×${source.owned(id)}`, 14, y + 5, 0xffffff);
    }
    rect(0x264659, 10, 248, 105, 25);
    rect(0x264659, 125, 248, 105, 25);
    text("↑ Trước", 25, 255, 0xffffff);
    text("↓ Tiếp", 146, 255, 0xffffff);
    text("5 xác nhận · quay lại hủy", 12, 278, 0xffe19a);
    text("Xác nhận / 5", 12, 304, 0xffffff);
    text("Quay lại", 177, 304, 0xffffff);
    return;
  }
  const state = source.state();
  for (let i = 0; i < CAU_VONG_SLOTS; i++) {
    const y = 36 + i * 30,
      item = state?.items[i] ?? 0;
    g.fillStyle = hex(i === panel.selected ? 0x376478 : 0x183d50);
    g.beginPath();
    g.roundRect(10, y, 220, 27, 3);
    g.fill();
    text(`${i + 1}. ${item === 0 ? "Trống" : name(item)}`, 15, y + 3, 0xffffff);
    if (item !== 0) {
      const progress = state?.progress[i] ?? 0;
      rect(0x091e2b, 16, y + 18, 147, 4);
      rect(0x85ddb6, 16, y + 18, Math.trunc((147 * progress) / CAU_VONG_TARGET), 4);
      text(`${progress}/${CAU_VONG_TARGET}`, 174, y + 14, 0xffe19a);
    }
  }
  const item = state?.items[panel.selected] ?? 0,
    row = item !== 0 ? recipe(item) : undefined;
  if (item !== 0) {
    text(`${name(item)} · cấp ${row?.level ?? 0}`, 12, 190, 0xffe19a);
    (row?.materials ?? []).forEach((material, i) =>
      text(
        `${material.name} ${source.materialCount(material.id)}/${material.count}`,
        12,
        204 + i * 12,
        0xffffff,
      ),
    );
  } else text(CAU_VONG_INCUBATOR_TEXT.empty, 12, 194, 0xffffff);
  if (panel.menu !== 0) {
    const labels =
      panel.menu === 2 ? CAU_VONG_INCUBATOR_TEXT.occupied : CAU_VONG_INCUBATOR_TEXT.confirm;
    for (let i = 0; i < 2; i++) {
      rect(i === panel.action ? 0x58704a : 0x264659, 10, 224 + i * 24, 220, 22);
      text(labels[i], 14, 230 + i * 24, 0xffffff);
    }
  }
  text(panel.message, 12, 278, 0xffe19a);
  text(panel.menu === 0 ? "Chọn / 5" : "Xác nhận / 5", 12, 304, 0xffffff);
  text("Quay lại", 177, 304, 0xffffff);
}
