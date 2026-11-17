import type { WorldPanel } from "../game/world/WorldPanel";
import {
  battlePassClaimed,
  battlePassDaysRemaining,
  battlePassLevel,
  battlePassLevelXp,
} from "../game/meta/BattlePass";
import { displayRemaining } from "../game/meta/RegionalChallenges";
import type { PanelFontRenderer } from "./PanelFontRenderer";

const box = (
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  stroke = "#4b99bd",
) => {
  g.fillStyle = fill;
  g.beginPath();
  g.roundRect(x, y, w, h, 7);
  g.fill();
  g.strokeStyle = stroke;
  g.stroke();
};
const text = (
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  value: string,
  x: number,
  y: number,
  color = "#fff",
) => font.drawTagged(g, value, x, y, color);
const centered = (
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  value: string,
  x: number,
  y: number,
  w: number,
  color = "#fff",
) => font.centered(g, value, x, w, y, color);
const base = (g: CanvasRenderingContext2D, font: PanelFontRenderer, title: string) => {
  g.fillStyle = "rgba(3,18,28,.58)";
  g.fillRect(0, 31, 240, 270);
  box(g, 9, 42, 222, 246, "#102f42", "#e5bd5c");
  box(g, 12, 45, 216, 25, "#286e99", "#f2c862");
  centered(g, font, title, 12, 52, 216);
};
const action = (
  g: CanvasRenderingContext2D,
  font: PanelFontRenderer,
  value: string,
  x: number,
  selected = false,
) => {
  box(g, x, 265, 78, 19, selected ? "#68468f" : "#173f56", selected ? "#f2c862" : "#75aaa9");
  centered(g, font, value, x, 270, 78);
};

export function drawChallenge(
  g: CanvasRenderingContext2D,
  panel: WorldPanel,
  font: PanelFontRenderer,
): void {
  if (panel.mode === "giftCode") {
    base(g, font, "GIFTCODE");
    text(g, font, "Nhập mã quà tặng", 22, 84, "#a8cddd");
    box(g, 18, 106, 204, 31, "#071f2c", "#f2c862");
    text(g, font, panel.giftCodeInput || "_", 27, 116, "#fff16a");
    text(g, font, "A-Z, 0-9, - và _", 23, 148, "#719aaa");
    if (panel.giftCodeMessage) {
      box(g, 18, 172, 204, 60, "#153c50", "#75aaa9");
      text(g, font, panel.giftCodeMessage, 24, 181, "#e7f6f8");
    }
    action(g, font, "Đổi mã", 18, true);
    action(g, font, "Quay lại", 144);
    return;
  }
  base(g, font, "TÁI ĐẤU & QUÀ TẶNG");
  const rematch = panel.challengeRematch,
    status = panel.challengeStatus;
  box(g, 48, 76, 144, 23, "#183f56", "#75aaa9");
  centered(g, font, rematch ? `◀ ${rematch.name} ▶` : "Chưa mở khu vực", 48, 82, 144, "#fff16a");
  box(g, 17, 108, 206, 52, panel.selected === 0 ? "#3b507a" : "#173f56", "#8ecbe3");
  text(g, font, rematch?.title ?? "Tái đấu thủ lĩnh", 25, 116);
  text(g, font, `Thưởng: ${rematch?.rewardMoney ?? 0} kim tiền`, 25, 133, "#f2c862");
  text(
    g,
    font,
    status.clockRollback
      ? "Đồng hồ chưa hợp lệ"
      : `${status.remainingUses}/3 lượt · reset ${displayRemaining(status.remainingMillis)}`,
    25,
    146,
    status.available ? "#a5e0b0" : "#e89b91",
  );
  box(g, 17, 169, 206, 42, panel.selected === 1 ? "#3b507a" : "#173f56", "#8ecbe3");
  text(g, font, "Giftcode", 25, 179, "#fff16a");
  text(g, font, "Nhập mã để nhận quà", 25, 194, "#a8cddd");
  if (panel.giftCodeMessage) text(g, font, panel.giftCodeMessage, 20, 225, "#ffb3a7");
  action(g, font, "Chọn", 18, true);
  action(g, font, "Quay lại", 144);
}

export function drawBattlePass(
  g: CanvasRenderingContext2D,
  panel: WorldPanel,
  font: PanelFontRenderer,
): void {
  const catalog = panel.battlePassSource.catalog(),
    state = panel.battlePassSource.state();
  base(g, font, panel.mode === "battlePassHelp" ? "NHIỆM VỤ MÙA" : "THẺ FAN CỨNG VQSV");
  if (!catalog || !state) {
    centered(g, font, "Dữ liệu mùa chưa sẵn sàng", 15, 150, 210, "#ffb3a7");
    return;
  }
  if (panel.mode === "battlePassHelp") {
    catalog.missions.forEach((mission, index) => {
      const y = 78 + index * 29,
        value = state.missions[index] ?? 0;
      box(g, 17, y, 206, 25, "#173f56", value >= mission.target ? "#79c789" : "#4b99bd");
      text(g, font, mission.label, 24, y + 5);
      text(g, font, `${value}/${mission.target}  +${mission.xp} XP`, 145, y + 5, "#f2c862");
    });
    action(g, font, "Quay lại", 81, true);
    return;
  }
  const current = battlePassLevel(catalog, state),
    level = Math.min(catalog.maxLevel, Math.max(1, panel.battlePassLevel)),
    row = catalog.levels[level - 1];
  text(g, font, `Cấp ${current}/${catalog.maxLevel}`, 20, 78, "#fff16a");
  text(g, font, `${battlePassDaysRemaining(catalog, state, Date.now())} ngày`, 143, 78, "#a8cddd");
  box(g, 201, 72, 21, 20, "#68468f", "#f2c862");
  centered(g, font, "?", 201, 77, 21, "#fff16a");
  box(g, 18, 95, 204, 10, "#071f2c", "#75aaa9");
  g.fillStyle = "#e5bd5c";
  g.fillRect(20, 97, Math.floor((200 * battlePassLevelXp(catalog, state)) / catalog.xpPerLevel), 6);
  centered(g, font, `◀  CẤP ${level}  ▶`, 18, 113, 204, "#fff16a");
  ([false, true] as const).forEach((vip, index) => {
    const y = 136 + index * 53,
      selected = panel.battlePassVipTrack === vip,
      claimed = battlePassClaimed(state, vip, level),
      locked = vip && !state.vipUnlocked;
    box(g, 17, y, 206, 46, selected ? "#3b507a" : "#173f56", selected ? "#f2c862" : "#4b99bd");
    text(
      g,
      font,
      vip ? `VIP${locked ? " (khóa)" : ""}` : "MIỄN PHÍ",
      24,
      y + 5,
      vip ? "#ffca68" : "#a5e0b0",
    );
    text(
      g,
      font,
      row ? (vip ? row.vip : row.free).map((r) => r.label).join(" · ") : "",
      24,
      y + 21,
      "#d9edf2",
    );
    text(
      g,
      font,
      claimed ? "Đã nhận" : level <= current ? "Có thể nhận" : "Chưa mở",
      157,
      y + 5,
      claimed ? "#79c789" : "#fff",
    );
  });
  if (panel.battlePassMessage) text(g, font, panel.battlePassMessage, 20, 242, "#ffda84");
  action(
    g,
    font,
    state.vipUnlocked
      ? "Nhận"
      : panel.battlePassVipTrack
        ? `Mở VIP (${catalog.vipPriceBadges})`
        : "Nhận",
    18,
    true,
  );
  action(g, font, "Quay lại", 144);
}
