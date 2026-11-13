import type { BootAssets } from "../pack/boot";
import type { BattleRuntime } from "../game/battle/BattleRuntime";

/**
 * What the menus read off a fight: its UI state and clock. A 1v1 `BattleRuntime` carries the rest
 * (the catch list's enemy, the level-up pet); the 2v2 screen never opens those two.
 */
export type BattleUiHost = Pick<BattleRuntime, "ui" | "tickCount" | "catchListOpen"> &
  Partial<Pick<BattleRuntime, "combatant" | "hp">>;
import { battleUiState, type BattleUiState } from "../game/battle/BattleUiState";
import type { SourceUiLayout, SourceUiWidget } from "./SourceUiLayout";
import type { GameAssets } from "../game/story/GameAssets";
import {
  CATCH_LIST,
  ITEM_LIST,
  SKILL_LIST,
  type BattleListLayout,
} from "../game/battle/BattleListLayout";
import { PetStateRenderer } from "./PetStateRenderer";
import { thumbHeight, thumbY } from "../ui/UiScrollbarMath";

export class BattleUiRenderer {
  private readonly petStateRenderer: PetStateRenderer;
  constructor(
    private readonly assets: GameAssets,
    private readonly boot: BootAssets,
  ) {
    this.petStateRenderer = new PetStateRenderer({
      font: boot.panelFont,
      cell: (index) => boot.cell(257, index),
      sprite: (spriteId, tick, nature) => {
        const visual = assets.shinySprite(spriteId, nature),
          frame = assets.frame(visual, 0, tick),
          bounds = assets.animationBounds(visual, 0),
          image = frame ? assets.petImage(frame, visual, nature) : undefined;
        return frame && bounds && image ? { frame, bounds, image } : undefined;
      },
    });
  }
  render(g: CanvasRenderingContext2D, battle: BattleUiHost): void {
    const ui = battle.ui;
    switch (ui.mode) {
      case "COMMAND":
        this.command(g, ui);
        break;
      case "CHOICE":
        this.choice(g, battle as BattleRuntime, ui);
        break;
      case "CHOICE_SKILL":
      case "SKILL":
        this.skills(g, ui, battle.tickCount);
        break;
      case "TARGET":
        this.target(g, ui);
        break;
      case "WARNING":
        this.warning(g, ui, battle.tickCount);
        break;
      case "PET_STATE":
        this.petState(g, ui, battle.tickCount, true);
        break;
      case "LEVEL_UP":
        this.levelUp(g, battle as BattleRuntime, ui);
        break;
      case "SMS_INFO":
        this.sms(g, ui);
        break;
      case "SHOP_BUY":
      case "SHOP_CONFIRM":
        this.shop(g, ui);
        break;
      case "NPC_ENEMY":
      case "CATCH_ANIM":
      case "BATTLE":
        break;
    }
  }
  private command(g: CanvasRenderingContext2D, ui: BattleUiState): void {
    const labels = [
        ["Chiến", "đấu"],
        ["Bắt", "được"],
        ["Đạo", "cụ"],
        ["Sủng", "vật"],
        ["Thương", "điếm"],
        ["Chạy", "trốn"],
      ],
      xs = [7, 48, 88, 128, 168, 208],
      cursor = [20, 56, 98, 137, 176, 218],
      cell = this.boot.cell(257, 31);
    if (cell) g.drawImage(cell, cursor[Math.max(0, Math.min(5, ui.selectedIndex))], 293);
    for (let i = 0; i < labels.length; i++) {
      const color = i === ui.selectedIndex ? "#fff16a" : "#fff";
      this.tiny(g, labels[i][0], xs[i], 299, 34, color);
      this.tiny(g, labels[i][1], xs[i], 309, 34, color);
    }
  }
  private choice(g: CanvasRenderingContext2D, battle: BattleRuntime, ui: BattleUiState): void {
    if (battle.catchListOpen) {
      this.catchChoice(g, battle, ui);
      return;
    }
    // `VqsvBattleRenderer.drawModernBattleChoiceOverlay`: keep the source dashboard and pointer
    // geometry together. This is the Item tab, not a generic modal with an approximate skin.
    const { list, action, back } = ITEM_LIST,
      accent = "#137da1",
      selectedRow = ui.rows[ui.selectedIndex];
    g.fillStyle = "#071f2d";
    g.fillRect(26, 54, 194, 232);
    g.fillStyle = "#b9dfe8";
    g.fillRect(23, 50, 194, 232);
    g.fillStyle = "#103f56";
    g.fillRect(25, 52, 190, 30);
    g.fillStyle = "#fff16a";
    g.fillRect(25, 81, 190, 2);
    g.fillStyle = "#2a9bc3";
    g.fillRect(23, 257, 194, 25);
    g.strokeStyle = "#4c91a5";
    g.strokeRect(23, 50, 193, 231);
    this.center(g, "HÀNH TRANG TRẬN", 31, 58, 112, "#fff");
    this.pill(
      g,
      ui.rows.length ? `${ui.selectedIndex + 1}/${ui.rows.length}` : "0/0",
      151,
      57,
      50,
      16,
      accent,
    );
    for (let i = 0; i < list.visibleRows; i++) {
      const index = ui.scroll + i,
        row = ui.rows[index],
        ry = list.y + i * list.stride,
        selected = index === ui.selectedIndex;
      if (selected && row) {
        g.fillStyle = "#092f40";
        g.fillRect(list.x + 3, ry + 3, list.w, list.rowH);
      }
      g.fillStyle = !row ? "#caeaf1" : selected ? this.darker(accent) : "#e8f7fa";
      g.fillRect(list.x, ry, list.w, list.rowH);
      if (row) {
        g.fillStyle = selected ? "#fff16a" : accent;
        g.fillRect(list.x, ry, 5, list.rowH);
      }
      g.strokeStyle = selected && row ? "#fff16a" : "#4c91a5";
      g.strokeRect(list.x, ry, list.w - 1, list.rowH - 1);
      if (selected && row) {
        g.fillStyle = "#fff16a";
        g.fillRect(list.x + 5, ry + 1, list.w - 6, 2);
      }
      if (!row) continue;
      g.fillStyle = selected ? "#fff16a" : "#ccecf3";
      g.fillRect(list.x + 8, ry + 3, 16, 16);
      g.strokeStyle = "#173f56";
      g.strokeRect(list.x + 8, ry + 3, 15, 15);
      const icon = this.boot.cell(258, row.iconCell ?? 0);
      if (icon) g.drawImage(icon, list.x + 10, ry + 5, 12, 12);
      this.tiny(g, row.name, list.x + 30, ry + 6, 92, selected ? "#fff" : "#1c6c91");
      this.pill(g, row.value ?? "", list.x + 128, ry + 4, 42, 14, selected ? "#fff16a" : accent);
    }
    this.scrollbar(g, ITEM_LIST, ui);
    if (ui.rows.length === 0)
      this.center(g, "Chưa có vật phẩm", list.x, list.y + 50, list.w, "#6e93a5");
    g.fillStyle = "#071f2d";
    g.fillRect(34, 210, 176, 37);
    g.fillStyle = "#173f56";
    g.fillRect(32, 208, 176, 37);
    g.fillStyle = accent;
    g.fillRect(32, 208, 5, 37);
    g.strokeStyle = "#4c91a5";
    g.strokeRect(32, 208, 175, 36);
    this.tiny(g, selectedRow?.name ?? "Chưa có vật phẩm", 42, 212, 156, "#fff16a");
    this.wrap(
      g,
      selectedRow?.description || ui.description || "Chọn đạo cụ để sử dụng trong trận.",
      42,
      223,
      156,
      10,
      "#fff",
      2,
    );
    this.button(
      g,
      action.x,
      action.y,
      action.w,
      action.h,
      ui.prompt || "Sử dụng",
      ui.rows.length > 0,
    );
    this.button(g, back.x, back.y, back.w, back.h, "Quay lại", false);
  }
  /** A list's painted scrollbar (`UiScrollbarMath`), only when the list is longer than its window. */
  private scrollbar(
    g: CanvasRenderingContext2D,
    layout: BattleListLayout,
    ui: BattleUiState,
  ): void {
    const visible = layout.list.visibleRows,
      total = ui.rows.length;
    if (total <= visible) return;
    const bar = layout.scrollbar,
      x = bar.x + 1,
      w = Math.max(3, bar.w - 2),
      thumb = thumbHeight(bar.h, total, visible, bar.minThumbHeight),
      top = thumbY(bar.y, bar.h, thumb, total, visible, ui.scroll);
    g.fillStyle = "#6cb7bb";
    g.fillRect(x, bar.y, w, bar.h);
    g.fillStyle = "#f3fdff";
    g.fillRect(x, top, w, thumb);
    g.strokeStyle = "#1c6c91";
    g.strokeRect(x, top, w - 1, Math.max(1, thumb - 1));
  }
  private catchChoice(g: CanvasRenderingContext2D, battle: BattleRuntime, ui: BattleUiState): void {
    const x = 15,
      y = 44,
      w = 210,
      h = 242,
      accent = "#e48a3a";
    this.panel(g, x, y, w, h, "#ccd0f1");
    g.fillStyle = "#493868";
    g.fillRect(x + 2, y + 2, w - 4, 28);
    g.fillStyle = accent;
    g.fillRect(x + 2, y + 29, w - 4, 3);
    this.tiny(g, "Bắt sủng vật", x + 9, y + 9, 105, "#fff");
    this.pill(
      g,
      ui.rows.length ? `${ui.rows.length} loại` : "0 bóng",
      x + 132,
      y + 7,
      61,
      16,
      accent,
    );
    const enemy = battle.combatant("enemy"),
      hp = Math.round((100 * battle.hp("enemy")) / enemy.maxHp);
    g.fillStyle = "#173356";
    g.fillRect(23, 77, 194, 18);
    g.fillStyle = accent;
    g.fillRect(23, 77, 5, 18);
    this.tiny(g, enemy.name, 32, 81, 112, "#fff");
    this.tiny(g, `HP ${hp}%`, 166, 81, 45, hp <= 25 ? "#ff797d" : "#9ee840");
    for (let i = 0; i < CATCH_LIST.list.visibleRows; i++) {
      const row = ui.rows[ui.scroll + i],
        ry = CATCH_LIST.list.y + i * CATCH_LIST.list.stride,
        selected = ui.scroll + i === ui.selectedIndex;
      g.fillStyle = selected ? "#695e80" : "#eae2fa";
      g.fillRect(23, ry, 92, 21);
      g.fillStyle = selected ? "#ffd95f" : accent;
      g.fillRect(23, ry, 5, 21);
      g.strokeStyle = selected ? "#ffd95f" : "#7ba2b9";
      g.strokeRect(23, ry, 91, 20);
      if (row) {
        g.fillStyle = selected ? "#ffdc7d" : "#c5e5ed";
        g.fillRect(31, ry + 3, 16, 16);
        const icon = this.boot.cell(258, row.iconCell ?? 0);
        if (icon) g.drawImage(icon, 33, ry + 5);
        this.tiny(g, row.name, 52, ry + 6, 56, selected ? "#fff" : "#1c6c91");
      }
    }
    this.scrollbar(g, CATCH_LIST, ui);
    g.fillStyle = "#173356";
    g.fillRect(121, 99, 96, 113);
    g.strokeStyle = "#ffd95f";
    g.strokeRect(121, 99, 95, 112);
    const selected = ui.rows[ui.selectedIndex],
      pulse = Math.abs((battle.tickCount % 24) - 12),
      rate = this.parsePercent(selected?.value ?? "");
    if (selected) {
      this.center(g, selected.name, 129, 105, 80, "#ffe95d");
      g.fillStyle = `rgba(228,138,58,${(55 + (12 - pulse) * 8) / 255})`;
      g.beginPath();
      g.arc(169, 141, 19, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "rgba(255,201,95,.47)";
      g.beginPath();
      g.arc(169, 141, 15 + pulse / 3, 0, Math.PI * 2);
      g.stroke();
      const icon = this.boot.cell(258, selected.iconCell ?? 0);
      if (icon) g.drawImage(icon, 163, 135 - (12 - pulse) / 4);
    }
    this.center(g, "Tỷ lệ bắt", 129, 166, 80, "#b9e2e8");
    this.center(g, selected?.value ?? "--", 129, 179, 80, "#ffd95f");
    g.fillStyle = "#0a272d";
    g.fillRect(131, 195, 76, 6);
    g.fillStyle = rate >= 70 ? "#56c96a" : rate >= 35 ? "#ffd95f" : "#df6d5b";
    g.fillRect(132, 196, Math.max(0, Math.min(74, (rate * 74) / 100)), 4);
    this.description(g, selected?.description ?? "Không có bóng phù hợp.", 23, 216, 194, 38);
    this.button(g, 34, 263, 72, 19, ui.prompt || "Sử dụng", true);
    this.button(g, 137, 263, 69, 19, "Quay lại", false);
  }
  private skills(g: CanvasRenderingContext2D, ui: BattleUiState, tick: number): void {
    const selected = ui.rows[ui.selectedIndex],
      enabled = selected?.enabled !== false,
      element = selected?.element ?? -1,
      accent = this.skillColor(element);
    g.fillStyle = "#0b2838";
    g.fillRect(11, 56, 224, 236);
    g.fillStyle = "#79c7d5";
    g.fillRect(8, 53, 224, 236);
    g.fillStyle = "#126f91";
    g.fillRect(10, 55, 220, 23);
    g.fillStyle = "#fff16a";
    g.fillRect(10, 78, 220, 2);
    g.fillStyle = "#1f8db4";
    g.fillRect(8, 263, 224, 26);
    this.skillFrame(g, 8, 53, 224, 236);
    this.tiny(g, "Kỹ năng", 17, 61, 70, "#fff");
    this.tiny(g, "Số lần", 98, 61, 36, "#fff");
    this.tiny(g, "Đòn đang chọn", 150, 61, 75, "#fff");
    g.fillStyle = "#a8dfe9";
    g.fillRect(14, 88, 121, 115);
    this.skillFrame(g, 14, 88, 121, 115);
    for (let i = 0; i < 5; i++) {
      const index = i + ui.scroll,
        row = ui.rows[index],
        y = 88 + i * 23,
        isSelected = index === ui.selectedIndex;
      if (!row) {
        g.fillStyle = "#d5eef4";
        g.fillRect(15, y + 1, 119, 21);
        g.strokeStyle = "#9ecbd5";
        g.strokeRect(15, y + 1, 118, 20);
        continue;
      }
      const available = row.enabled !== false,
        color = this.skillColor(row.element ?? -1);
      if (isSelected) {
        g.fillStyle = "#092f40";
        g.fillRect(18, y + 4, 119, 21);
      }
      g.fillStyle = isSelected ? this.darker(color) : available ? "#d2eef5" : "#8faab4";
      g.fillRect(15, y + 1, 119, 21);
      g.fillStyle = available ? color : "#829aa2";
      g.fillRect(15, y + 1, 4, 21);
      if (isSelected) {
        g.fillStyle = "#fff16a";
        g.fillRect(19, y + 2, 114, 2);
      }
      g.strokeStyle = isSelected ? "#fff16a" : "#66aec4";
      g.strokeRect(15, y + 1, 118, 20);
      const icon = this.boot.cell(257, 94 + (row.element ?? -1));
      if (icon) g.drawImage(icon, 21, y + 4);
      this.marqueeRect(
        g,
        row.name,
        37,
        y + 4,
        60,
        tick,
        available ? (isSelected ? "#fff" : "#1c6c91") : "#63767d",
      );
      this.tiny(
        g,
        row.value ?? "",
        100,
        y + 4,
        32,
        available ? (isSelected ? "#fff16a" : "#1b789d") : "#63767d",
      );
      const [current, max] = this.pp(row.value);
      g.fillStyle = "#6f8f99";
      g.fillRect(99, y + 16, 31, 3);
      g.fillStyle = available ? color : "#829aa2";
      g.fillRect(99, y + 16, max ? Math.floor((31 * current) / max) : 0, 3);
    }
    g.fillStyle = "#1b7d98";
    g.fillRect(137, 90, 4, 111);
    const bar = SKILL_LIST.scrollbar,
      thumbH = thumbHeight(bar.h, ui.rows.length, 5, bar.minThumbHeight),
      thumb = { y: thumbY(bar.y, bar.h, thumbH, ui.rows.length, 5, ui.scroll), h: thumbH };
    g.fillStyle = "#f3fdff";
    g.fillRect(136, thumb.y, 6, thumb.h);
    g.strokeStyle = "#1c6c91";
    g.strokeRect(136, thumb.y, 5, Math.max(0, thumb.h - 1));
    g.fillStyle = "#356b7b";
    g.fillRect(148, 90, 80, 115);
    g.fillStyle = "#c4eaf2";
    g.fillRect(146, 88, 80, 115);
    this.skillFrame(g, 146, 88, 80, 115);
    if (selected) {
      g.fillStyle = this.darker(accent);
      g.fillRect(148, 90, 76, 20);
      g.fillStyle = "#fff16a";
      g.fillRect(148, 109, 76, 2);
      this.tiny(g, selected.name, 151, 94, 70, "#fff");
      const icon = this.boot.cell(257, 94 + element);
      if (icon) g.drawImage(icon, 152, 116);
      g.fillStyle = "#d8f5fb";
      g.fillRect(168, 115, 52, 14);
      g.strokeStyle = accent;
      g.strokeRect(168, 115, 51, 13);
      this.tiny(g, this.elementName(element), 172, 117, 45, "#1c6c91");
      this.skillMeta(
        g,
        "Độ mạnh",
        (selected.power ?? 0) > 0 ? String(selected.power) : "--",
        151,
        133,
        70,
      );
      this.skillMeta(g, "PP", selected.value ?? "", 151, 146, 70);
      const [current, max] = this.pp(selected.value);
      g.fillStyle = "#b7d4dc";
      g.fillRect(188, 157, 28, 4);
      g.fillStyle = accent;
      g.fillRect(188, 157, max ? Math.floor((28 * current) / max) : 0, 4);
      g.strokeStyle = "#5d95a4";
      g.strokeRect(188, 157, 27, 3);
      this.skillMeta(g, "Bậc", String(Math.max(1, selected.tier ?? 1)), 151, 164, 70);
      this.skillMeta(g, "Đích", selected.targetSide === 1 ? "Bên ta" : "Đối thủ", 151, 177, 70);
      const chance = Math.max(0, selected.chance ?? 0);
      this.skillMeta(
        g,
        "TL",
        chance <= 0 ? "Không" : chance >= 100 ? "100%" : `${chance}%`,
        151,
        190,
        70,
      );
    } else this.tiny(g, "...", 180, 136, 20, "#1c6c91");
    g.fillStyle = "#071f2d";
    g.fillRect(16, 210, 212, 50);
    g.fillStyle = "#173f56";
    g.fillRect(14, 208, 212, 50);
    g.fillStyle = "#fff16a";
    g.fillRect(16, 210, 40, 12);
    this.skillFrame(g, 14, 208, 212, 50);
    this.tiny(g, "Mô tả", 21, 211, 30, "#1c6c91");
    this.wrap(g, ui.description, 19, 224, 202, 10, "#fff", 3);
    this.skillButton(g, 14, 264, 91, 22, "Sử dụng", true, enabled);
    this.skillButton(g, 135, 264, 91, 22, "Quay lại", false, true);
  }
  private target(g: CanvasRenderingContext2D, ui: BattleUiState): void {
    const cell = this.boot.cell(257, 31),
      at = ui.targetSlotPosition,
      x = at ? at.x - 10 : ui.targetPlayerSide ? 55 : 171,
      y = at ? at.y - 38 : ui.targetPlayerSide ? 130 : 60;
    if (cell) g.drawImage(cell, x, y);
    this.panel(g, 72, 268, 96, 18, "rgba(0,0,0,.6)");
    this.tiny(g, ui.targetName, 78, 273, 84, "#fff16a");
  }
  private warning(g: CanvasRenderingContext2D, ui: BattleUiState, tick: number): void {
    const layout = this.layout("msgwarm"),
      frame = this.boot.cell(257, 128);
    this.fillWidget(g, layout, 1, "#c6f3ff");
    this.fillWidget(g, layout, 2, "#bee6f2");
    this.fillWidget(g, layout, 3, "#6cc2fb");
    this.fillWidget(g, layout, 5, "#51d8e9");
    if (frame) g.drawImage(frame, layout.widget(8)?.x ?? 76, layout.widget(8)?.y ?? 106);
    this.marquee(g, ui.message, layout.widget(7), tick, "#1c6c91");
    this.marquee(g, ui.prompt, layout.widget(6), tick, "#1c6c91");
  }
  /**
   * `VqsvBattleRenderer.renderPetStateOverlay`: the pet dashboard, in a fight (`inBattle`, the
   * action reads "Xuất chiến") or over the free world (the menu's "Sủng vật", action "Xác định").
   */
  drawPetDashboard(g: CanvasRenderingContext2D, ui: BattleUiState, tick: number): void {
    this.petState(g, ui, tick, false);
  }
  /** `TextBox.msgWarm(message, prompt)` as the battle's warning box draws it. */
  drawWarningBox(g: CanvasRenderingContext2D, message: string, prompt: string, tick: number): void {
    this.warning(g, { ...battleUiState("WARNING"), message, prompt }, tick);
  }
  private petState(
    g: CanvasRenderingContext2D,
    ui: BattleUiState,
    tick: number,
    inBattle: boolean,
  ): void {
    this.petStateRenderer.render(g, ui, tick, inBattle);
  }
  private levelUp(g: CanvasRenderingContext2D, battle: BattleRuntime, ui: BattleUiState): void {
    const level = ui.levelUp;
    g.fillStyle = "#89d6ef";
    g.fillRect(43, 55, 158, 202);
    g.fillStyle = "#c6f3ff";
    g.fillRect(46, 78, 150, 9);
    g.fillStyle = "#f7f7ff";
    g.fillRect(46, 87, 150, 159);
    g.fillStyle = "#51d8e9";
    g.fillRect(46, 246, 150, 11);
    g.strokeStyle = "#345869";
    g.strokeRect(43, 55, 157, 201);
    for (const [cell, x, y] of [
      [1, 43, 55],
      [8, 78, 94],
      [17, 50, 90],
      [15, 144, 90],
    ] as Array<[number, number, number]>) {
      const image = this.boot.cell(257, cell);
      if (image) g.drawImage(image, x, y);
    }
    this.center(g, "Thăng cấp", 70, 60, 100, "#fff");
    if (!level) return;
    // `drawLevelUpOverlay` draws the pet with its own nature (the shiny palette at 7..9).
    const spriteId = this.assets.shinySprite(
        level.spriteId ?? battle.combatant("player").spriteId,
        level.nature,
      ),
      frame = this.assets.frame(spriteId, 0, battle.tickCount),
      image = frame ? this.assets.petImage(frame, spriteId, level.nature) : undefined;
    if (frame && image) {
      g.save();
      g.beginPath();
      g.rect(78, 90, 90, 88);
      g.clip();
      g.drawImage(image, Math.floor(123 + frame.ox), Math.floor(153 + frame.oy));
      g.restore();
    }
    this.marqueeRect(g, level.name, 53, 84, 72, battle.tickCount, "#1c6c91");
    this.tiny(g, "lv", 150, 82, 12, "#1c6c91");
    this.tiny(g, String(level.level), 165, 82, 24, "#1c6c91");
    const labels = ["Mệnh", "Công", "Phòng", "Min"],
      ys = [182, 196, 209, 222],
      iconYs = [188, 201, 214, 227];
    for (let i = 0; i < 4; i++) {
      const y = ys[i],
        iconY = iconYs[i],
        statCell = i === 0 ? 15 : 16,
        leftIcon = this.boot.cell(257, statCell),
        rightIcon = this.boot.cell(257, statCell),
        arrow = this.boot.cell(257, 22);
      if (leftIcon) g.drawImage(leftIcon, 59, iconY);
      if (rightIcon) g.drawImage(rightIcon, 139, iconY);
      if (arrow) g.drawImage(arrow, 114, iconY - 1);
      this.tiny(g, labels[i], 65, y, 12, "#1c6c91");
      this.tiny(g, String(level.oldStats[i]), 80, y, 24, "#1c6c91");
      this.tiny(g, labels[i], 145, y, 12, "#1c6c91");
      this.tiny(g, String(level.newStats[i]), 160, y, 24, "#1c6c91");
    }
    const news = [
      ...(level.learned ?? []).map((name) => `Học được: ${name}`),
      ...(level.pending ?? []).map((name) => `Muốn học: ${name} (đã đủ 5 chiêu)`),
    ];
    if (news.length > 0)
      this.marqueeRect(g, news.join(", "), 76, 240, 96, battle.tickCount, "#c1572f");
  }
  private sms(g: CanvasRenderingContext2D, ui: BattleUiState): void {
    const layout = this.layout("smsInfo"),
      root = layout.widget(1),
      height = root?.h !== undefined && root.h > 0 ? root.h : 178;
    this.panel(g, root?.x ?? 38, root?.y ?? 71, root?.w ?? 164, height, "#bdeff7");
    this.wrap(g, ui.message, 62, 101, 118, 12, "#1c6c91", 6);
    this.center(g, ui.prompt, 66, 188, 100, "#1c6c91");
    this.button(g, 52, 240, 58, 19, "Xác nhận", true);
    this.button(g, 130, 240, 58, 19, "Phản hồi", false);
  }
  private shop(g: CanvasRenderingContext2D, ui: BattleUiState): void {
    // `VqsvBattleRenderer.drawShopBuyOverlay`: JavaSE's five-row 240x320 battle shop.
    g.fillStyle = "#071f2d";
    g.fillRect(15, 46, 216, 246);
    g.fillStyle = "#c8e9e8";
    g.fillRect(12, 42, 216, 246);
    g.fillStyle = "#184e4f";
    g.fillRect(15, 45, 210, 27);
    g.fillStyle = "#f2c85a";
    g.fillRect(15, 69, 210, 3);
    g.strokeStyle = "#2e9c7b";
    g.strokeRect(12.5, 42.5, 215, 245);
    this.center(g, "THƯƠNG ĐIẾM TRẬN", 22, 53, 126, "#fff");
    this.button(
      g,
      166,
      51,
      51,
      16,
      ui.rows.length ? `${ui.selectedIndex + 1}/${ui.rows.length}` : "0/0",
      true,
    );
    g.fillStyle = "#235f60";
    g.fillRect(20, 76, 200, 19);
    this.tiny(g, "KIM TIỀN", 28, 81, 48, "#bfe9e2");
    this.tiny(g, String(ui.shopMoney ?? 0), 79, 81, 52, "#f2c85a");
    this.tiny(g, "HUY HIỆU", 136, 81, 51, "#bfe9e2");
    this.tiny(g, String(ui.shopBadges ?? 0), 190, 81, 24, "#f2c85a");
    const first = Math.max(0, Math.min(ui.scroll, Math.max(0, ui.rows.length - 5)));
    for (let i = 0; i < 5; i++) {
      const index = first + i,
        row = ui.rows[index],
        ry = 99 + i * 21,
        selected = index === ui.selectedIndex;
      g.fillStyle = selected ? "#092f2f" : "#a5d1d0";
      g.fillRect(23, ry + 2, 196, 19);
      g.fillStyle = selected ? "#286f65" : "#f0fbf8";
      g.fillRect(20, ry, 196, 19);
      g.fillStyle = selected ? "#f2c85a" : "#2e9c7b";
      g.fillRect(20, ry, 5, 19);
      g.strokeStyle = selected ? "#f2c862" : "#75aaa9";
      g.strokeRect(20.5, ry + 0.5, 195, 18);
      if (row) {
        const icon = this.boot.cell(258, row.iconCell ?? 0);
        if (icon) g.drawImage(icon, 29, ry + 3);
        this.tiny(g, row.name, 48, ry + 5, 102, selected ? "#fff" : "#1c6c91");
        g.fillStyle = selected ? "#f2c862" : "#173f56";
        g.fillRect(157, ry + 3, 51, 14);
        g.strokeStyle = selected ? "#fff" : "#69aaa4";
        g.strokeRect(157.5, ry + 3.5, 50, 13);
        this.tiny(g, row.value ?? "", 163, ry + 5, 27, selected ? "#5c481a" : "#fff");
        const currency = this.boot.cell(
          257,
          row.currency === 1 ? 83 : row.currency === 2 ? 74 : 84,
        );
        if (currency) g.drawImage(currency, 191, ry + 4);
      }
    }
    if (ui.rows.length > 5) {
      g.fillStyle = "#245d67";
      g.fillRect(218, 99, 4, 103);
      const height = thumbHeight(103, ui.rows.length, 5, 9),
        y = thumbY(99, 103, height, ui.rows.length, 5, first);
      g.fillStyle = "#f2c85a";
      g.fillRect(217, y, 6, height);
    }
    this.description(g, ui.description || "Chọn món hàng để xem thông tin.", 20, 205, 200, 46);
    this.button(g, 25, 264, 76, 19, "Mua", true);
    this.button(g, 140, 264, 75, 19, "Quay lại", false);
    if (ui.mode === "SHOP_CONFIRM") {
      g.fillStyle = "rgba(0,0,0,.55)";
      g.fillRect(0, 36, 240, 252);
      this.panel(g, 31, 92, 178, 139, "#d4f0ec");
      this.center(g, "XÁC NHẬN MUA", 51, 101, 138, "#fff");
      this.tiny(g, ui.message || "Số lượng 1", 41, 135, 158, "#1c6c91");
      this.button(g, 46, 136, 38, 31, "-", false);
      this.button(g, 156, 136, 38, 31, "+", false);
      this.tiny(g, `Tổng ${ui.shopTotal ?? 0}`, 74, 174, 74, "#1c6c91");
      const currency = this.boot.cell(
        257,
        ui.shopCurrency === 1 ? 83 : ui.shopCurrency === 2 ? 74 : 84,
      );
      if (currency) g.drawImage(currency, 147, 172);
      this.button(g, 45, 200, 64, 20, "Xác nhận", true);
      this.button(g, 132, 200, 64, 20, "Hủy", false);
    }
  }
  private description(
    g: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    g.fillStyle = "#173356";
    g.fillRect(x, y, w, h);
    g.strokeStyle = "#7197aa";
    g.strokeRect(x, y, w - 1, h - 1);
    this.wrap(g, text, x + 4, y + 4, w - 8, 11, "#fff", Math.max(1, Math.floor((h - 7) / 11)));
  }
  private button(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    primary: boolean,
  ): void {
    g.fillStyle = primary ? "#247ca4" : "#506d7b";
    g.fillRect(x, y, w, h);
    g.strokeStyle = primary ? "#fff16a" : "#fff";
    g.strokeRect(x, y, w - 1, h - 1);
    this.center(g, text, x, y + 4, w, "#fff");
  }
  private pill(
    g: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    w: number,
    h: number,
    accent: string,
  ): void {
    g.fillStyle = "#fff16a";
    g.beginPath();
    g.roundRect(x, y, w, h, 7);
    g.fill();
    g.strokeStyle = accent;
    g.stroke();
    this.center(g, text, x + 2, y + 4, w - 4, "#604e57");
  }
  private parsePercent(value: string): number {
    const parsed = Number.parseInt(value.replace("%", "").trim(), 10);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
  }
  private panel(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
  ): void {
    g.fillStyle = "rgba(0,22,32,.58)";
    g.fillRect(x + 3, y + 4, w, h);
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
    g.strokeStyle = "#e8f4ff";
    g.strokeRect(x, y, w - 1, h - 1);
    g.strokeStyle = "#345869";
    g.strokeRect(x + 1, y + 1, w - 3, h - 3);
  }
  private fillWidget(
    g: CanvasRenderingContext2D,
    layout: SourceUiLayout,
    id: number,
    color: string,
  ): void {
    const w = layout.widget(id);
    if (!w) return;
    g.fillStyle = color;
    g.fillRect(w.x, w.y, w.w, w.bandHeight ?? Math.max(1, w.h));
  }
  private marquee(
    g: CanvasRenderingContext2D,
    text: string,
    w: SourceUiWidget | undefined,
    tick: number,
    color: string,
  ): void {
    if (!w) return;
    const width = this.boot.panelFont.width(text),
      offset = width > w.w ? tick % (width + w.w + 12) : 0,
      x = width > w.w ? w.x - offset : w.x + Math.max(0, (w.w - width) / 2);
    g.save();
    g.beginPath();
    g.rect(w.x, w.y, w.w, w.bandHeight ?? 13);
    g.clip();
    this.boot.panelFont.draw(g, text, x, w.y, color);
    g.restore();
  }
  private marqueeRect(
    g: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    w: number,
    _tick: number,
    color: string,
  ): void {
    this.tiny(g, text, x, y, w, color);
  }
  private skillFrame(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    g.strokeStyle = "#e8f4ff";
    g.strokeRect(x, y, w - 1, h - 1);
    g.strokeStyle = "#34606e";
    g.strokeRect(x + 1, y + 1, w - 3, h - 3);
  }
  private skillMeta(
    g: CanvasRenderingContext2D,
    label: string,
    value: string,
    x: number,
    y: number,
    w: number,
  ): void {
    g.fillStyle = "#b7dce6";
    g.fillRect(x, y, w, 13);
    g.strokeStyle = "#5d95a4";
    g.strokeRect(x, y, w - 1, 12);
    this.tiny(g, label, x + 3, y + 2, 38, "#1c6c91");
    this.tiny(g, value, x + 41, y + 2, w - 44, "#0e5f80");
  }
  private skillButton(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    primary: boolean,
    enabled: boolean,
  ): void {
    g.fillStyle = "#0b3a4a";
    g.fillRect(x + 2, y + 2, w, h);
    g.fillStyle = enabled ? (primary ? "#137da1" : "#b7dce6") : "#78929b";
    g.fillRect(x, y, w, h);
    g.fillStyle = enabled ? (primary ? "#5fc9df" : "#e3f6fa") : "#a7bec4";
    g.fillRect(x + 2, y + 2, w - 4, 3);
    g.fillStyle = enabled ? (primary ? "#0d5f7e" : "#71aebd") : "#607a82";
    g.fillRect(x + 2, y + h - 5, w - 4, 3);
    g.strokeStyle = enabled ? (primary ? "#fff16a" : "#34606e") : "#506872";
    // Java's `drawRect` fills whole pixels; a canvas stroke on the pixel edge blends into two.
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    this.center(g, text, x + 3, y + 6, w - 6, enabled ? (primary ? "#fff" : "#1c6c91") : "#d8e5e8");
  }
  private skillColor(element: number): string {
    return (
      ["#d65c41", "#4b9b59", "#b28a45", "#408fca", "#d0b039", "#8b5db6", "#4fa98f"][element] ??
      "#247fa2"
    );
  }
  private darker(color: string): string {
    const value = Number.parseInt(color.slice(1), 16),
      r = Math.floor(((value >> 16) & 255) * 0.65),
      g = Math.floor(((value >> 8) & 255) * 0.65),
      b = Math.floor((value & 255) * 0.65);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
  }
  private elementName(element: number): string {
    return ["Hỏa", "Mộc", "Thổ", "Thủy", "Điện", "Quỷ", "Phong"][element] ?? "Không";
  }
  private pp(value: string | undefined): [number, number] {
    const [current, max] = (value ?? "").split("/").map((item) => Number.parseInt(item, 10));
    return [
      Number.isFinite(current) ? Math.max(0, current) : 0,
      Number.isFinite(max) ? Math.max(0, max) : 0,
    ];
  }
  private tiny(
    g: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    w: number,
    color: string,
  ): void {
    g.save();
    g.beginPath();
    g.rect(x, y, w, this.boot.panelFont.height);
    g.clip();
    this.boot.panelFont.draw(g, text, x, y, color);
    g.restore();
  }
  private center(
    g: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    w: number,
    color: string,
  ): void {
    this.boot.panelFont.centered(g, text, x, w, y, color);
  }
  private wrap(
    g: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    w: number,
    lineHeight: number,
    color: string,
    maxLines: number,
  ): void {
    let line = "",
      width = 0,
      row = 0;
    for (const ch of text) {
      const cw = this.boot.panelFont.width(ch);
      if (width + cw > w && line) {
        this.boot.panelFont.draw(g, line, x, y + row++ * lineHeight, color);
        if (row >= maxLines) return;
        line = ch;
        width = cw;
      } else {
        line += ch;
        width += cw;
      }
    }
    if (line && row < maxLines) this.boot.panelFont.draw(g, line, x, y + row * lineHeight, color);
  }
  private layout(name: string): SourceUiLayout {
    return this.boot.layouts.get(name)!;
  }
}
