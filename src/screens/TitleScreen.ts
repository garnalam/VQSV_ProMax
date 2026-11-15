import type { BootAssets } from "../pack/boot";
import type { InputSnapshot } from "../core/input/InputSnapshot";
import { KEY } from "../core/input/KeyCode";
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from "../core/constants";
import { centeredPoint, LAND_CENTER, landPoint, landSpace } from "../core/LandCenter";
import { viewport } from "../core/Viewport";
import type { Screen } from "../core/ScreenManager";
import type { CanvasRenderer } from "../rendering/CanvasRenderer";
import { HELP_EFFECT_LABELS } from "../game/system/HelpContent";
import {
  TitleFlowModel,
  type SettingsLevel,
  type StartRequest,
  type TitleCommand,
} from "./title/TitleFlowModel";

const OUTLINE = [0x3c67bf, 0x3c67bf, 0x3c67bf, 0x6e8dce, 0x6e8dce, 0x97b0f7];
const RECTS = [
  [28, 3, 21, 22],
  [50, 5, 17, 17],
] as const;
/** `updateTitleMenu`: up/left (arrow, numpad, digit) is previous; down/right is next. */
const PREVIOUS_KEYS = [KEY.UP, KEY.NUMPAD8, KEY.D8, KEY.LEFT, KEY.NUMPAD4, KEY.D4] as const;
const NEXT_KEYS = [KEY.DOWN, KEY.NUMPAD2, KEY.D2, KEY.RIGHT, KEY.NUMPAD6, KEY.D6] as const;
/** The bottom 42px band the title menu's three pointer zones live in. */
const MENU_BAND_TOP = LOGICAL_HEIGHT - 42;

/**
 * Where the title's press landed, on the 240x320 layout: in landscape the panels are drawn at full
 * size in the middle of the APK's 320x240 screen (`LAND_CENTER`).
 */
function press(input: InputSnapshot): { x: number; y: number } | null {
  const p = input.pointer;
  return p.pressed ? centeredPoint(p.pressX, p.pressY) : null;
}
/**
 * The landscape APK title picture's menu band (`tex/menu.mid`): the dark strip at rows 196..219
 * between the ◀ arrow (x 150..165) and the ▶ arrow (x 282..300), on the 320x240 screen. The label
 * is centred between the arrows; a press left of the label steps back, right of it forward.
 */
const LAND_MENU_BAND = { top: 186, bottom: 230, left: 175, right: 272, labelX: 223, baseline: 212 };
/** The title menu's bottom band: 42 rows, the 320x240 screen's bottom ones in landscape. */
const bandTop = () => (viewport.landscape ? 240 - 42 - LAND_CENTER.y : MENU_BAND_TOP),
  bandBottom = () => (viewport.landscape ? 240 - LAND_CENTER.y : LOGICAL_HEIGHT);
function pressedIn(input: InputSnapshot, x0: number, y0: number, x1: number, y1: number) {
  const at = press(input);
  return !!at && at.x >= x0 && at.x <= x1 && at.y >= y0 && at.y <= y1;
}
/** `clickedSelectedMenu`: 80 < x < 160 inside the bottom band. */
function clickedSelectedMenu(input: InputSnapshot): boolean {
  return pressedIn(input, 81, bandTop(), 159, bandBottom());
}
/** A press on the bottom softkeys (the 320x240 screen's corners in landscape): which side, or null. */
function softkeyPressed(input: InputSnapshot): "left" | "right" | null {
  const p = input.pointer;
  if (!p.pressed) return null;
  if (!viewport.landscape) return p.pressY >= 286 ? (p.pressX < 120 ? "left" : "right") : null;
  const at = landPoint(p.pressX, p.pressY);
  return at.y >= 212 ? (at.x < 160 ? "left" : "right") : null;
}
/** The two softkey plates (1,296) and (197,296); landscape's sit in the 320x240 screen's corners. */
const softkeys = (): [{ x: number; y: number }, { x: number; y: number }] =>
  viewport.landscape
    ? [
        { x: 2 - LAND_CENTER.x, y: 215 - LAND_CENTER.y },
        { x: 275 - LAND_CENTER.x, y: 215 - LAND_CENTER.y },
      ]
    : [
        { x: 1, y: 296 },
        { x: 197, y: 296 },
      ];

type Particle = { x: number; y: number; frame: number; dx: number; dy: number; done: boolean };

export class TitleScreen implements Screen {
  private colorTick = 0;
  private paused = false;
  private pauseTicks = 0;
  private particles = this.newParticles();
  constructor(
    private readonly assets: BootAssets,
    readonly model: TitleFlowModel,
    private readonly start: (request: StartRequest) => void,
    private readonly deleteSave: () => Promise<void>,
    /** Backing out of the skip-prologue question when it was asked straight after signing in. */
    private readonly leave?: () => void,
  ) {}
  tick(input: InputSnapshot): void {
    this.colorTick = (this.colorTick + 1) % OUTLINE.length;
    this.tickParticles();
    const command = this.command(input);
    if (!command) return;
    const before = this.model.mode;
    const request =
      command === "toggleSpeed" ? (this.model.toggleSpeed(), null) : this.apply(command);
    if (before === "overwrite" && this.model.mode === "skipIntro") void this.deleteSave();
    if (request) this.start(request);
    else if (before === "skipIntro" && this.model.mode === "menu" && this.leave) this.leave();
  }

  private apply(command: TitleCommand | SettingsLevel): StartRequest | null {
    if (typeof command === "number") {
      this.model.settingsLevel = command;
      return null;
    }
    return this.model.command(command);
  }

  /**
   * One title action per tick, following the `if / else if` chains in `BootFlowState`. Keyboard and
   * pointer are read from the same snapshot, so a recorded trace replays exactly.
   */
  private command(input: InputSnapshot): TitleCommand | SettingsLevel | "toggleSpeed" | null {
    switch (this.model.mode) {
      case "menu":
        // updateTitleMenu
        if (input.anyPressed(...PREVIOUS_KEYS)) return "previous";
        if (input.anyPressed(...NEXT_KEYS)) return "next";
        if (input.confirmPressed()) return "confirm";
        if (viewport.landscape) {
          // The APK picture's band: its ◀ arrow, the label between, its ▶ arrow.
          const p = input.pointer;
          if (!p.pressed) return null;
          const at = landPoint(p.pressX, p.pressY),
            band = LAND_MENU_BAND;
          if (at.y < band.top || at.y > band.bottom) return null;
          return at.x < band.left ? "previous" : at.x > band.right ? "next" : "confirm";
        }
        if (input.pointerPressedIn(0, MENU_BAND_TOP, 80, LOGICAL_HEIGHT)) return "previous";
        if (input.pointerPressedIn(160, MENU_BAND_TOP, LOGICAL_WIDTH - 1, LOGICAL_HEIGHT))
          return "next";
        if (clickedSelectedMenu(input)) return "confirm";
        return null;
      case "overwrite":
        // updateNewGameOverwritePrompt
        if (input.softLeftPressed() || input.confirmPressed()) return "softLeft";
        if (input.softRightPressed() || input.backPressed()) return "softRight";
        return null;
      case "skipIntro":
        // updateSkipIntroPrompt
        if (input.softLeftPressed() || input.confirmPressed()) return "softLeft";
        if (input.softRightPressed()) return "softRight";
        if (input.backPressed()) return "back";
        return null;
      case "about":
        // updateTitleInfo
        if (
          input.softRightPressed() ||
          input.backPressed() ||
          input.confirmPressed() ||
          clickedSelectedMenu(input)
        )
          return "back";
        return null;
      case "settings":
        return this.settingsCommand(input);
      case "help":
        return this.helpCommand(input);
      case "gameBoundary":
      case "exit":
        return input.backPressed() || input.pointer.pressed ? "back" : null;
    }
  }

  /** Title options panel. Pointer zones match the drawn widgets. */
  private settingsCommand(
    input: InputSnapshot,
  ): TitleCommand | SettingsLevel | "toggleSpeed" | null {
    if (input.pointer.pressed) {
      const { x, y } = press(input)!,
        key = softkeyPressed(input);
      if (key) return key === "left" ? "toggleSpeed" : "back";
      if (x >= 84 && x <= 158 && y >= 179 && y <= 199) return "toggleSpeed";
      if (x >= 112 && x <= 166 && y >= 136 && y <= 174) return x < 133 ? 1 : x < 147 ? 2 : 3;
      return null;
    }
    if (input.anyPressed(...PREVIOUS_KEYS)) return "previous";
    if (input.anyPressed(...NEXT_KEYS)) return "next";
    if (input.confirmPressed()) return "confirm";
    if (input.backPressed() || input.softRightPressed()) return "back";
    if (input.softLeftPressed()) return "toggleSpeed";
    return null;
  }

  /** Title help panel. Pointer zones match the page arrows and the back softkey. */
  private helpCommand(input: InputSnapshot): TitleCommand | null {
    if (input.pointer.pressed) {
      const { x, y } = press(input)!;
      if (softkeyPressed(input)) return "back";
      if (y >= 232 && y <= 270) return x < 120 ? "previous" : "next";
      return null;
    }
    if (input.anyPressed(...PREVIOUS_KEYS)) return "previous";
    if (input.anyPressed(...NEXT_KEYS)) return "next";
    if (input.backPressed() || input.softRightPressed() || input.confirmPressed()) return "back";
    return null;
  }

  render(r: CanvasRenderer): void {
    if (this.model.mode === "overwrite" || this.model.mode === "skipIntro") {
      this.prompt(r);
      return;
    }
    this.background(r);
    // Landscape: everything laid out for 240x320 sits at full size in the 320x240 screen's middle.
    if (viewport.landscape) landSpace(r.context, r.backingScale, LAND_CENTER);
    this.content(r);
    if (viewport.landscape) r.uiSpace();
  }
  private content(r: CanvasRenderer): void {
    switch (this.model.mode) {
      case "menu":
        this.menu(r);
        break;
      case "settings":
        this.settings(r);
        break;
      case "help":
        this.help(r);
        break;
      case "about":
        this.about(r);
        break;
      case "gameBoundary":
        this.boundary(r);
        break;
      case "exit":
        this.exit(r);
        break;
    }
  }
  private menu(r: CanvasRenderer): void {
    const g = r.context,
      font = this.assets.sourceFont,
      text = this.model.labels()[this.model.selected],
      land = viewport.landscape,
      // Landscape: in the APK picture's band, between its two arrows (centred layout coordinates).
      x = land
        ? Math.floor(LAND_MENU_BAND.labelX - font.width(text) / 2) - LAND_CENTER.x
        : Math.floor((LOGICAL_WIDTH - font.width(text)) / 2),
      y = land ? LAND_MENU_BAND.baseline - LAND_CENTER.y : LOGICAL_HEIGHT - 20,
      outline = `#${OUTLINE[this.colorTick].toString(16).padStart(6, "0")}`;
    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ])
      font.drawAtBaseline(g, text, x + dx, y + dy, outline);
    font.drawAtBaseline(g, text, x, y, "#ffffff");
  }
  private panel(r: CanvasRenderer, title: string): void {
    const g = r.context,
      frame = this.assets.cell(257, 1),
      softkey = this.assets.cell(257, 28);
    g.fillStyle = "#c6f0ff";
    g.fillRect(46, 78, 150, 9);
    g.fillStyle = "#bee7f2";
    g.fillRect(46, 87, 150, 158);
    g.fillStyle = "#6cb7bb";
    g.fillRect(46, 245, 150, 8);
    if (frame) r.image(frame, 43, 55);
    const [left, right] = softkeys();
    if (softkey) {
      r.image(softkey, left.x, left.y);
      r.image(softkey, right.x, right.y);
    }
    this.assets.panelFont.draw(g, title, 70, 59, "#ffffff");
    this.assets.panelFont.draw(g, "Quay lại", right.x, right.y, "#ffffff");
  }
  private settings(r: CanvasRenderer): void {
    this.panel(r, "Tùy chọn");
    const g = r.context,
      font = this.assets.panelFont;
    font.draw(g, "Âm lượng", 88, 159, "#1c6c91");
    for (let i = 1; i <= 3; i++) {
      g.fillStyle = i <= this.model.settingsLevel ? "#fff79c" : "#7da884";
      g.fillRect(111 + i * 13, 157 - (i - 1) * 7, i === 1 ? 6 : 7, 12);
      g.strokeStyle = "#31526b";
      g.strokeRect(111 + i * 13, 157 - (i - 1) * 7, i === 1 ? 6 : 7, 12);
    }
    g.fillStyle = "#d8f7ff";
    g.fillRect(84, 179, 74, 20);
    g.strokeStyle = "#31526b";
    g.strokeRect(84, 179, 74, 20);
    g.strokeStyle = this.model.speedX2 ? "#d0010e" : "#1c6c91";
    g.strokeRect(88, 184, 10, 10);
    if (this.model.speedX2) {
      g.beginPath();
      g.moveTo(90, 189);
      g.lineTo(92, 192);
      g.lineTo(97, 186);
      g.stroke();
    }
    font.draw(g, "Speed x2", 104, 185, this.model.speedX2 ? "#d0010e" : "#1c6c91");
    const [left] = softkeys();
    font.centered(g, `x2: ${this.model.speedX2 ? "Bật" : "Tắt"}`, left.x, 43, left.y, "#ffffff");
  }
  private help(r: CanvasRenderer): void {
    this.panel(r, "Trợ giúp");
    const g = r.context,
      font = this.assets.panelFont;
    if (this.model.helpPage === 0) {
      const lines = [
        "Nhấn nút 2, 4, 6, 8 để di chuyển",
        "Nút 5: công kích, đối thoại, xác nhận",
        "Nút 1: Xem nhiệm vụ",
        "Nút 9: lựa chọn sủng vật cưỡi",
        "Nút 0: Xem bản đồ",
        "Nút mềm trái: menu hệ thống",
        "Nút mềm phải: menu trò chơi",
      ];
      lines.forEach((line, i) => font.draw(g, line, 57, 95 + i * 14, "#1c6c91"));
    } else {
      const start = (this.model.helpPage - 1) * 14;
      for (let row = 0; row < 14 && start + row < HELP_EFFECT_LABELS.length; row++) {
        const rowY = Math.floor(row / 2),
          icon = this.assets.cell(325, start + row + 1);
        if (icon) r.image(icon, row % 2 === 0 ? 68 : 132, 100 + rowY * 20);
        font.draw(
          g,
          HELP_EFFECT_LABELS[start + row],
          row % 2 === 0 ? 88 : 152,
          100 + rowY * 20,
          "#1c6c91",
        );
      }
    }
    font.centered(g, `${this.model.helpPage + 1}/3`, 102, 30, 240, "#1c6c91");
    const prev = this.assets.cell(257, 88),
      next = this.assets.cell(257, 90);
    if (this.model.helpPage > 0 && prev) r.image(prev, 94, 245);
    if (this.model.helpPage < 2 && next) r.image(next, 134, 245);
  }
  private about(r: CanvasRenderer): void {
    const g = r.context;
    g.fillStyle = "rgba(0,0,0,.67)";
    g.beginPath();
    g.roundRect(24, 86, 192, 128, 12);
    g.fill();
    g.strokeStyle = "#527a9e";
    g.stroke();
    const font = this.assets.sourceFont;
    font.centeredAtBaseline(g, "Giới thiệu", 112, "#ffffff");
    font.drawAtBaseline(g, "VQSV Liệt Hỏa Rebuild", 40, 140, "#ffffff");
    font.drawAtBaseline(g, "Bản rebuild đang được hoàn thiện", 40, 160, "#ffffff");
    font.drawAtBaseline(g, "theo từng chức năng gameplay.", 40, 180, "#ffffff");
    this.corner(r, "right", "Quay lại", "#ffffff");
  }
  private prompt(r: CanvasRenderer): void {
    r.clear();
    const g = r.context,
      font = this.assets.sourceFont,
      mid = LOGICAL_HEIGHT / 2;
    if (viewport.landscape) landSpace(g, r.backingScale, LAND_CENTER);
    if (this.model.mode === "overwrite") {
      font.centeredAtBaseline(g, "Chơi mới sẽ xóa dữ liệu cũ.", mid - 20, "#ffffff");
      font.centeredAtBaseline(g, "Bạn có chắc muốn tiếp tục?", mid, "#ffdd66");
      this.corner(r, "left", "Xóa", "#ffffff");
      this.corner(r, "right", "Hủy", "#ffffff");
    } else {
      font.centeredAtBaseline(g, "Bỏ qua đoạn giới thiệu?", mid - 12, "#ffffff");
      font.centeredAtBaseline(g, "Nhảy tới mười năm sau", mid + 12, "#ffdd66");
      this.corner(r, "left", "Có", "#ffffff");
      this.corner(r, "right", "Không", "#ffffff");
    }
    if (viewport.landscape) r.uiSpace();
  }
  /**
   * A softkey label in a bottom corner of the screen: the 320x240 one in landscape, where it is
   * drawn under the centred layout's transform (`LAND_CENTER`).
   */
  private corner(r: CanvasRenderer, side: "left" | "right", text: string, color: string): void {
    const g = r.context,
      font = this.assets.sourceFont,
      land = viewport.landscape,
      left = land ? -LAND_CENTER.x : 0,
      right = land ? 320 - LAND_CENTER.x : LOGICAL_WIDTH,
      bottom = (land ? 240 - LAND_CENTER.y : LOGICAL_HEIGHT) - 2;
    if (side === "left") font.drawAtBaseline(g, text, left + 2, bottom, color);
    else font.rightAtBaseline(g, text, right - 2, bottom, color);
  }
  private boundary(r: CanvasRenderer): void {
    const g = r.context;
    g.fillStyle = "rgba(0,0,0,.67)";
    g.fillRect(24, 104, 192, 92);
    const font = this.assets.sourceFont;
    font.centeredAtBaseline(g, "World Runtime chưa triển khai", 140, "#ffffff");
    font.centeredAtBaseline(g, "Trạng thái menu đã hoàn tất", 164, "#ffdd66");
    this.corner(r, "right", "Quay lại", "#ffffff");
  }
  private exit(r: CanvasRenderer): void {
    const g = r.context;
    g.fillStyle = "rgba(0,0,0,.75)";
    g.fillRect(24, 112, 192, 72);
    const font = this.assets.sourceFont;
    font.centeredAtBaseline(g, "Trình duyệt không cho trang tự đóng", 140, "#ffffff");
    font.centeredAtBaseline(g, "Bạn có thể đóng tab này.", 162, "#ffdd66");
    this.corner(r, "right", "Quay lại", "#ffffff");
  }
  private background(r: CanvasRenderer): void {
    if (viewport.landscape) {
      this.landBackground(r);
      return;
    }
    r.image(this.assets.menuBackground, 0, 0);
    if (this.paused) return;
    for (const p of this.particles) {
      if (p.done) continue;
      const [sx, sy, w, h] = RECTS[p.frame];
      r.context.drawImage(
        this.assets.menuParticles,
        sx,
        sy,
        w,
        h,
        Math.floor(p.x),
        Math.floor(p.y),
        w,
        h,
      );
    }
  }
  /**
   * Landscape: the APK's own 320x240 title picture, black either side of it, and the particles
   * rising across it (their 240x320 paths stretched to its shape).
   */
  private landBackground(r: CanvasRenderer): void {
    const g = r.context;
    r.clear();
    landSpace(g, r.backingScale);
    g.drawImage(this.assets.menuBackgroundLand, 0, 0);
    if (!this.paused)
      for (const p of this.particles) {
        if (p.done) continue;
        const [sx, sy, w, h] = RECTS[p.frame];
        g.drawImage(
          this.assets.menuParticles,
          sx,
          sy,
          w,
          h,
          Math.floor((p.x * 320) / 240),
          Math.floor((p.y * 240) / 320),
          w,
          h,
        );
      }
    r.uiSpace();
  }
  private tickParticles(): void {
    if (this.paused) {
      if (++this.pauseTicks >= 100) {
        this.particles = this.newParticles();
        this.paused = false;
        this.pauseTicks = 0;
      }
      return;
    }
    for (const p of this.particles) {
      p.x += p.dx;
      p.y -= p.dy;
      p.done ||= p.x > 240 || p.y < 0;
    }
    if (this.particles.every((p) => p.done)) this.paused = true;
  }
  private newParticles(): Particle[] {
    return Array.from({ length: 10 }, () => ({
      x: -Math.floor(Math.random() * 30),
      y: 320 + Math.floor(Math.random() * 30),
      frame: Math.floor(Math.random() * 2),
      dx: 1 + Math.floor(Math.random() * 5),
      dy: 3 + Math.floor(Math.random() * 3),
      done: false,
    }));
  }
}
