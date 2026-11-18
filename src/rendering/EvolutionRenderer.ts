import type { PanelFontRenderer } from "./PanelFontRenderer";
import type { EvolutionSession } from "../game/pet/EvolutionSession";

export type EvolutionArt = {
  font: PanelFontRenderer;
  /** A pet frame; `nature` 7..9 with `shinyColor` draws it in its shiny colours. */
  sprite: (
    id: number,
    x: number,
    y: number,
    w: number,
    h: number,
    tick: number,
    nature?: number,
    shinyColor?: number,
  ) => void;
  icon: (materialId: number, x: number, y: number) => void;
};
const color = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const round = (
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  g.beginPath();
  g.roundRect(x, y, w, h, r / 2);
};
const centered = (
  g: CanvasRenderingContext2D,
  a: EvolutionArt,
  s: string,
  x: number,
  y: number,
  w: number,
  c: number | string,
) => a.font.centered(g, s, x, w, y, typeof c === "number" ? color(c) : c);

/** Faithful Canvas port of `VqsvBattleRenderer.renderEvolutionOverlay`. */
export function drawEvolution(
  g: CanvasRenderingContext2D,
  art: EvolutionArt,
  view: EvolutionSession,
  tick: number,
): void {
  const mutation = view.rule.kind === "mutation",
    title = mutation ? "Dị hoá" : "Tiến hóa";
  g.fillStyle = "rgba(0,24,35,.706)";
  round(g, 7, 39, 226, 249, 12);
  g.fill();
  g.fillStyle = color(13498111);
  round(g, 9, 41, 222, 245, 10);
  g.fill();
  g.strokeStyle = color(1527657);
  round(g, 9.5, 41.5, 221, 244, 10);
  g.stroke();
  g.fillStyle = color(mutation ? 7819688 : 2197933);
  round(g, 11, 43, 218, 27, 8);
  g.fill();
  g.fillRect(11, 61, 218, 9);
  centered(g, art, title, 70, 47, 100, "#fff");
  pill(
    g,
    art,
    mutation ? "Nhánh dị hóa" : "Nhánh thường",
    151,
    48,
    69,
    mutation ? 12159711 : 8575464,
  );
  card(g, art, 14, view, false, tick);
  card(g, art, 137, view, true, tick);
  g.fillStyle = color(mutation ? 9395636 : 2923388);
  round(g, 108, 99, 18, 6, 5);
  g.fill();
  g.beginPath();
  g.moveTo(124, 94);
  g.lineTo(124, 110);
  g.lineTo(133, 102);
  g.fill();
  g.strokeStyle = "#fff";
  g.beginPath();
  g.moveTo(110, 100.5);
  g.lineTo(124, 100.5);
  g.stroke();
  if (view.phase === 1) effect(g, tick);
  stats(g, art, view);
  materials(g, art, view, tick);
  const ready = view.ready,
    eligibilityColor = view.phase === 1 ? 2651542 : ready ? 2326369 : 11818325;
  g.fillStyle = color(view.phase === 1 ? 14807544 : ready ? 14677736 : 16771561);
  round(g, 14, 266, 212, 17, 7);
  g.fill();
  g.strokeStyle = color(eligibilityColor);
  round(g, 14.5, 266.5, 211, 16, 7);
  g.stroke();
  centered(g, art, view.eligibility, 18, 267, 204, eligibilityColor);
  softkey(
    g,
    art,
    1,
    view.phase === 1 ? "Đang..." : ready ? "Xác nhận" : "Kiểm tra",
    view.phase === 1 ? 7505034 : ready ? 2857842 : 9208177,
  );
  softkey(g, art, 190, "Quay lại", 2651542);
}

function pill(
  g: CanvasRenderingContext2D,
  art: EvolutionArt,
  text: string,
  x: number,
  y: number,
  w: number,
  fill: number,
): void {
  g.fillStyle = color(fill);
  round(g, x, y, w, 15, 7);
  g.fill();
  g.strokeStyle = color(1589074);
  round(g, x + 0.5, y + 0.5, w - 1, 14, 7);
  g.stroke();
  centered(g, art, text, x, y + 2, w, 1589074);
}
function card(
  g: CanvasRenderingContext2D,
  art: EvolutionArt,
  x: number,
  v: EvolutionSession,
  target: boolean,
  tick: number,
): void {
  g.fillStyle = color(target ? 15400435 : 15268095);
  round(g, x, 74, 89, 64, 8);
  g.fill();
  g.strokeStyle = color(target ? 5811587 : 5087166);
  round(g, x + 0.5, 74.5, 88, 63, 8);
  g.stroke();
  centered(
    g,
    art,
    target ? (v.rule.kind === "mutation" ? "Dị hóa" : "Sau tiến hóa") : "Hiện tại",
    x + 3,
    75,
    83,
    target ? 2585684 : 2319745,
  );
  const sprite = target ? v.newSprite : v.oldSprite;
  if (sprite >= 0) art.sprite(sprite, x + 15, 87, 59, 40, tick, v.pet.nature, v.pet.shinyColor);
  centered(g, art, target ? v.newName : v.oldName, x + 4, 119, 81, 1523279);
  centered(g, art, `Lv ${v.pet.level}`, x + 4, 129, 81, 4355206);
}
function stats(g: CanvasRenderingContext2D, art: EvolutionArt, v: EvolutionSession): void {
  g.fillStyle = color(16121343);
  round(g, 14, 142, 212, 69, 7);
  g.fill();
  g.strokeStyle = color(7387080);
  round(g, 14.5, 142.5, 211, 68, 7);
  g.stroke();
  g.fillStyle = color(13233651);
  round(g, 15, 143, 210, 14, 6);
  g.fill();
  g.fillRect(15, 150, 210, 7);
  art.font.draw(g, "Chỉ số", 19, 143, color(2580080));
  centered(g, art, "Trước", 69, 143, 37, 2580080);
  centered(g, art, "Sau", 122, 143, 37, 2580080);
  centered(g, art, "Thay đổi", 166, 143, 55, 2580080);
  g.strokeStyle = color(10933471);
  for (const x of [67, 108, 162]) {
    g.beginPath();
    g.moveTo(x + 0.5, 144);
    g.lineTo(x + 0.5, 208);
    g.stroke();
  }
  ["Sinh mệnh", "Sức mạnh", "Phòng ngự", "Linh xảo"].forEach((name, i) => {
    const y = 157 + i * 13,
      before = v.oldStats[i],
      after = v.newStats[i],
      delta = after - before;
    if (i & 1) {
      g.fillStyle = color(14939898);
      g.fillRect(15, y - 1, 210, 13);
    }
    art.font.draw(g, name, 19, y, color(2381674));
    centered(g, art, String(before), 70, y, 35, 2706778);
    centered(g, art, String(after), 123, y, 35, 2706778);
    centered(
      g,
      art,
      delta > 0 ? `+${delta}` : String(delta),
      166,
      y,
      55,
      delta > 0 ? 1673044 : delta < 0 ? 12863303 : 6322046,
    );
  });
}
function materials(
  g: CanvasRenderingContext2D,
  art: EvolutionArt,
  v: EvolutionSession,
  tick: number,
): void {
  art.font.draw(g, "Nguyên liệu", 16, 213, color(2645616));
  v.rule.ingredients.slice(0, 4).forEach((item, i) => {
    const x = 14 + (i & 1) * 107,
      y = 225 + (i >> 1) * 20,
      count = v.materialCount(item.materialId),
      ok = count >= item.quantity;
    g.fillStyle = color(ok ? 15137005 : 16772846);
    round(g, x, y, 105, 18, 6);
    g.fill();
    g.strokeStyle = color(ok ? 5613434 : 13003370);
    round(g, x + 0.5, y + 0.5, 104, 17, 6);
    g.stroke();
    art.icon(item.materialId, x + 3, y + 2);
    art.font.draw(g, item.name, x + 19, y + 1, color(2641241));
    centered(
      g,
      art,
      v.phase > 0 ? "Đã trừ" : `${count}/${item.quantity}`,
      x + 69,
      y + 1,
      33,
      v.phase > 0 ? 2651542 : ok ? 1673044 : 12863303,
    );
    void tick;
  });
}
function softkey(
  g: CanvasRenderingContext2D,
  art: EvolutionArt,
  x: number,
  label: string,
  fill: number,
): void {
  g.fillStyle = color(fill);
  round(g, x, 291, 49, 25, 8);
  g.fill();
  g.strokeStyle = "#fff";
  round(g, x + 0.5, 291.5, 48, 24, 8);
  g.stroke();
  centered(g, art, label, x, 299, 49, "#fff");
}
function effect(g: CanvasRenderingContext2D, tick: number): void {
  g.fillStyle = "rgba(10,45,61,.86)";
  round(g, 73, 75, 94, 62, 9);
  g.fill();
  for (let i = 0; i < 12; i++) {
    const a = tick * 0.35 + (i * Math.PI) / 6,
      r = 8 + ((tick * 3 + i * 5) % 35);
    g.fillStyle = `rgba(255,255,210,${0.25 + (i % 3) * 0.2})`;
    g.fillRect(120 + Math.cos(a) * r, 106 + Math.sin(a) * r, 2, 2);
  }
}
