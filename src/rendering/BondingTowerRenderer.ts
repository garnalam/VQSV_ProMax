import { HEART_FRAGMENTS, TOWER_BOND_LIMIT, towerFloorReward } from "../game/meta/BondingTower";
import {
  TOWER_FLOORS_PER_PAGE,
  TOWER_LAYOUT,
  TOWER_PETS_PER_PAGE,
  TOWER_TABS,
  towerCraftCounts,
  towerNurtureCounts,
  type BondingTowerPanelState,
  type TowerPanelView,
} from "../game/world/BondingTowerPanel";
import type { Rect } from "../game/battle/BattleListLayout";
import type { PanelFontRenderer } from "./PanelFontRenderer";

const { action, back } = TOWER_LAYOUT;
const GOLD = "#f7d481";
const INK = "#e6f7fa";
const DIM = "#adcbd6";
const GREEN = "#9de0bb";
const PINK = "#ffaca8";

function box(
  g: CanvasRenderingContext2D,
  { x, y, w, h }: Rect,
  fill: string,
  stroke: string,
  radius = 6,
): void {
  g.beginPath();
  g.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, radius);
  g.fillStyle = fill;
  g.fill();
  g.strokeStyle = stroke;
  g.stroke();
}

function fit(font: PanelFontRenderer, value: string, width: number): string {
  if (font.width(value) <= width) return value;
  let text = "";
  for (const ch of value) {
    if (font.width(text + ch + "…") > width) break;
    text += ch;
  }
  return text + "…";
}

function label(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  value: string,
  x: number,
  y: number,
  width: number,
  color = INK,
): void {
  font.centered(g, fit(font, value, width), x, width, y, color);
}

function button(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  rect: Rect,
  value: string,
  active = false,
  disabled = false,
): void {
  box(
    g,
    rect,
    disabled ? "#142f3a" : active ? "#524380" : "#1b455b",
    disabled ? "#364e54" : active ? GOLD : "#567e95",
  );
  label(
    g,
    font,
    value,
    rect.x + 2,
    rect.y + Math.floor((rect.h - font.height) / 2),
    rect.w - 4,
    disabled ? "#77939a" : active ? GOLD : INK,
  );
}

function drawImage(
  g: CanvasRenderingContext2D,
  image: HTMLImageElement | undefined,
  x: number,
  y: number,
  size: number,
): void {
  if (!image?.complete || !image.naturalWidth) return;
  const scale = size / Math.max(image.naturalWidth, image.naturalHeight);
  const w = Math.round(image.naturalWidth * scale);
  const h = Math.round(image.naturalHeight * scale);
  g.drawImage(image, Math.round(x + (size - w) / 2), y + size - h, w, h);
}

function wrappedText(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  value: string,
  x: number,
  y: number,
  width: number,
  color: string,
): void {
  let row = "";
  for (const word of value.split(" ")) {
    const next = row ? row + " " + word : word;
    if (row && font.width(next) > width) {
      font.draw(g, fit(font, row, width), x, y, color);
      y += font.height + 2;
      row = word;
    } else row = next;
  }
  if (row) font.draw(g, fit(font, row, width), x, y, color);
}

function drawHeart(g: CanvasRenderingContext2D): void {
  const pattern = [
    ".OO..OO.",
    "O++OO++O",
    "O++++++O",
    "O++++++O",
    ".O++++O.",
    "..O++O..",
    "...OO...",
  ];
  for (const [row, pixels] of pattern.entries())
    for (const [column, pixel] of [...pixels].entries()) {
      if (pixel === ".") continue;
      g.fillStyle = pixel === "O" ? "#57384e" : "#f08aaa";
      g.fillRect(96 + column * 6, 122 + row * 6, 6, 6);
    }
  g.fillStyle = "#ffe3cd";
  g.fillRect(108, 134, 6, 6);
}

function drawFloors(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  state: BondingTowerPanelState,
  view: TowerPanelView,
  portrait: (id: number) => HTMLImageElement | undefined,
): void {
  const first = state.firstFloorIndex(view);
  const selected = state.activeFloorIndex(view);
  const floor = view.floors[selected];
  if (!floor) return;
  const rows = view.floors.slice(first, first + TOWER_FLOORS_PER_PAGE);
  button(g, font, TOWER_LAYOUT.previous, "←", false, first === 0);
  button(g, font, TOWER_LAYOUT.next, "→", false, first + rows.length >= view.floors.length);
  label(g, font, `${rows[0].floor}–${rows[rows.length - 1].floor}`, 35, 100, 52, GOLD);
  rows.forEach((row, index) => {
    const r = TOWER_LAYOUT.floorRow(index);
    const active = first + index === selected;
    const color = row.status === "first" ? GOLD : row.status === "locked" ? DIM : GREEN;
    box(g, r, active ? "#3c4e74" : "#153548", active ? GOLD : "#386075", 4);
    const title = `Tầng ${row.floor}`;
    font.draw(g, title, r.x + 5, r.y + 3, row.boss ? GOLD : INK);
    const status =
      row.status === "first" ? "Sẵn sàng" : row.status === "locked" ? "Chưa mở" : "Đã vượt";
    font.draw(g, status, r.x + r.w - 5 - font.width(status), r.y + 3, color);
  });
  box(g, { x: 114, y: 97, w: 113, h: 126 }, "#102c40", floor.boss ? GOLD : "#456784");
  label(g, font, floor.boss ? "THỦ LĨNH" : `TẦNG ${floor.floor}`, 118, 101, 105, GOLD);
  const lead = floor.team[0];
  g.fillStyle = "#1d435b";
  g.beginPath();
  g.ellipse(170, 172, 34, 8, 0, 0, Math.PI * 2);
  g.fill();
  if (lead) drawImage(g, portrait(lead.id), 134, 112, 72);
  label(g, font, lead?.name ?? "", 119, 181, 103);
  label(g, font, `Cấp ${floor.level} · ${floor.quality} sao`, 119, 194, 103, GOLD);
  label(
    g,
    font,
    `${floor.double ? "Đánh đôi" : "Đánh đơn"} · ${floor.team.length} pet`,
    119,
    207,
    103,
    DIM,
  );

  box(g, { x: 13, y: 227, w: 214, h: 47 }, "#0d2b3d", "#396075", 5);
  floor.team.forEach((pet, index) => {
    const column = index % 2;
    font.draw(
      g,
      fit(font, `${index + 1}. ${pet.name}`, 99),
      19 + column * 105,
      230 + Math.floor(index / 2) * 13,
      index === 0 ? GOLD : DIM,
    );
  });
  const reward = towerFloorReward(floor.floor);
  const prize = reward.hearts ? `×${reward.hearts} trái tim` : `×${reward.fragments} mảnh trái tim`;
  const status = {
    first: `Thưởng lần đầu · ${prize}`,
    reward: `Thưởng hôm nay · ${prize}`,
    locked: `Vượt tầng ${floor.floor - 1} để mở · ${prize}`,
    practice: "Luyện tập · hết thưởng tầng này",
  }[floor.status];
  label(g, font, state.message || status, 14, 276, 212, state.message ? PINK : GOLD);
  const fightLabel =
    floor.status === "first" ? "Khiêu chiến" : floor.status === "locked" ? "Chưa mở" : "Đấu lại";
  button(g, font, action, fightLabel, floor.status !== "locked", floor.status === "locked");
  button(g, font, back, "Quay lại");
}

function drawCraft(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  state: BondingTowerPanelState,
  view: TowerPanelView,
): void {
  const counts = towerCraftCounts(view.fragments);
  box(g, { x: 13, y: 104, w: 214, h: 160 }, "#102c40", "#456784");
  drawHeart(g);
  label(g, font, `${HEART_FRAGMENTS} mảnh → 1 trái tim`, 19, 180, 202, GOLD);
  label(g, font, `Có thể ghép ${counts[1]} trái tim`, 19, 202, 202);
  label(g, font, "Dùng trái tim để bồi dưỡng pet.", 19, 224, 202, DIM);
  if (state.message) label(g, font, state.message, 14, 276, 212, GOLD);
  button(g, font, TOWER_LAYOUT.craft[0], "Ghép 1 trái tim", state.craftAction === 0, !counts[0]);
  button(g, font, TOWER_LAYOUT.craft[1], "Ghép tất cả", state.craftAction === 1, !counts[1]);
}

function drawNurture(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  state: BondingTowerPanelState,
  view: TowerPanelView,
): void {
  const first = state.firstPetIndex();
  const pet = view.pets[state.petIndex];
  label(g, font, "Chọn pet trong đội", 14, 94, 212, GOLD);
  view.pets.slice(first, first + TOWER_PETS_PER_PAGE).forEach((row, slot) => {
    const r = TOWER_LAYOUT.petRow(slot);
    const selected = first + slot === state.petIndex;
    const stats = `Cấp ${row.level} · ${row.quality} sao`;
    box(g, r, selected ? "#3c4e74" : "#153548", selected ? GOLD : "#386075", 4);
    font.draw(g, fit(font, row.name, 127), r.x + 6, r.y + 3, INK);
    font.draw(g, stats, r.x + r.w - 6 - font.width(stats), r.y + 3, DIM);
  });
  if (!pet) {
    label(g, font, "Chưa có pet trong đội.", 14, 140, 212, DIM);
    return;
  }
  const percent = (pet.bond / 10).toFixed(1).replace(".", ",");
  label(
    g,
    font,
    `${pet.bond}/${TOWER_BOND_LIMIT} · +${percent}% HP, Công, Thủ`,
    14,
    240,
    212,
    GOLD,
  );
  box(g, { x: 22, y: 255, w: 196, h: 7 }, "#0d293a", "#3f637c", 3);
  g.fillStyle = "#de9ab1";
  g.fillRect(24, 257, Math.round((192 * pet.bond) / TOWER_BOND_LIMIT), 3);
  label(
    g,
    font,
    state.message || "Mỗi trái tim tăng 0,1% chỉ số.",
    14,
    271,
    212,
    state.message ? GOLD : DIM,
  );
  const counts = towerNurtureCounts(view.hearts, pet.bond);
  const labels = ["Dùng 1 tim", "Dùng 10 tim", `Tối đa (${counts[2]})`];
  TOWER_LAYOUT.nurture.forEach((rect, index) =>
    button(g, font, rect, labels[index], state.nurtureAction === index, !counts[index]),
  );
}

function drawSweep(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  state: BondingTowerPanelState,
  view: TowerPanelView,
): void {
  const { used, limit, nextCost, group, canSweep, detail } = view.sweep;
  const pending = state.pendingSweep;
  box(g, { x: 13, y: 104, w: 214, h: 157 }, "#102c40", pending ? GOLD : "#456784");
  label(g, font, pending ? "XÁC NHẬN QUÉT TẦNG" : "QUÉT TẦNG ĐÃ VƯỢT", 20, 117, 200, GOLD);
  if (pending) {
    label(g, font, `Dùng ${pending.cost} huy hiệu?`, 20, 156, 200);
    label(g, font, `Nhận thưởng ${pending.count} tầng`, 20, 177, 200, DIM);
    label(g, font, `Cụm tầng ${pending.start}–${pending.end}`, 20, 196, 200, DIM);
  } else {
    label(g, font, `Hôm nay còn ${limit - used}/${limit} lượt`, 20, 142, 200);
    if (group)
      label(
        g,
        font,
        `Cụm ${group.start}–${group.end} · ${group.count} tầng có thưởng`,
        20,
        165,
        200,
        GREEN,
      );
    if (nextCost !== null) {
      label(
        g,
        font,
        nextCost === 0 ? "Lượt này miễn phí" : `Phí lượt này: ${nextCost} huy hiệu`,
        20,
        188,
        200,
        canSweep ? GOLD : DIM,
      );
    }
    if (!canSweep) wrappedText(g, font, detail, 24, 215, 193, PINK);
  }
  const feedback = state.message || view.last;
  if (feedback) label(g, font, feedback, 14, 275, 212, GOLD);
  button(g, font, action, pending ? "Xác nhận" : "Quét tầng", canSweep, !canSweep);
  button(g, font, back, pending ? "Hủy" : "Quay lại");
}

type TowerArt = {
  icon: HTMLImageElement | undefined;
  portrait: (id: number) => HTMLImageElement | undefined;
};

export function drawBondingTower(
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  state: BondingTowerPanelState,
  view: TowerPanelView | undefined,
  art: TowerArt,
): void {
  g.save();
  g.imageSmoothingEnabled = false;
  g.fillStyle = "rgba(3,18,28,.70)";
  g.fillRect(0, 0, 240, 320);
  box(g, { x: 6, y: 15, w: 228, h: 302 }, "#112f40", "#d6aa5d", 8);
  box(g, { x: 11, y: 19, w: 218, h: 27 }, "#225a7c", "#9ed0dc");
  drawImage(g, art.icon, 15, 21, 22);
  label(g, font, "THÁP GẮN KẾT", 39, 26, 160, GOLD);
  button(g, font, TOWER_LAYOUT.close, "X");
  if (!view) {
    label(g, font, "Thông tin tháp chưa sẵn sàng.", 14, 150, 212, DIM);
    g.restore();
    return;
  }
  font.draw(g, `${view.hearts} tim · ${view.fragments} mảnh`, 15, 52, GOLD);
  const progress = `Đã vượt ${view.highest}/${view.floors.length}`;
  font.draw(g, progress, 225 - font.width(progress), 52, DIM);
  for (const tab of TOWER_TABS)
    button(
      g,
      font,
      tab.rect,
      tab.label,
      state.tab === tab.tab,
      !!state.pendingSweep && state.tab !== tab.tab,
    );
  switch (state.tab) {
    case "floors":
      drawFloors(g, font, state, view, art.portrait);
      break;
    case "craft":
      drawCraft(g, font, state, view);
      break;
    case "nurture":
      drawNurture(g, font, state, view);
      break;
    case "sweep":
      drawSweep(g, font, state, view);
      break;
  }
  g.restore();
}
