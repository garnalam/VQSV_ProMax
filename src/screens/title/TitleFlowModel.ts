/** Title-flow actions; each tick's input is reduced to at most one of these by `TitleScreen`. */
export type TitleCommand =
  | "previous"
  | "next"
  | "up"
  | "down"
  | "left"
  | "right"
  | "confirm"
  | "back"
  | "softLeft"
  | "softRight";
export type SettingsLevel = 0 | 1 | 2 | 3;

export type TitleMode =
  "menu" | "settings" | "help" | "about" | "overwrite" | "skipIntro" | "gameBoundary" | "exit";
export type StartRequest = { loadSave: boolean; skipIntro: boolean; speedX2: boolean };
const WITHOUT_SAVE = ["Chơi mới", "Tùy chọn", "Trợ giúp", "Giới thiệu", "Thoát"];
const WITH_SAVE = ["Chơi tiếp", "Chơi mới", "Tùy chọn", "Trợ giúp", "Giới thiệu", "Thoát"];

export class TitleFlowModel {
  mode: TitleMode = "menu";
  selected = 0;
  helpPage = 0;
  settingsLevel: SettingsLevel = 0;
  speedX2 = false;
  constructor(
    public validSave: boolean,
    public anySave: boolean,
  ) {}
  labels(): string[] {
    return this.validSave ? WITH_SAVE : WITHOUT_SAVE;
  }
  command(command: TitleCommand): StartRequest | null {
    if (command === "up" || command === "left") command = "previous";
    else if (command === "down" || command === "right") command = "next";
    if (this.mode === "menu") return this.menu(command);
    if (this.mode === "settings") {
      if (command === "previous")
        this.settingsLevel = Math.max(0, this.settingsLevel - 1) as SettingsLevel;
      else if (command === "next")
        this.settingsLevel = Math.min(3, this.settingsLevel + 1) as SettingsLevel;
      else if (command === "confirm" || command === "back") this.mode = "menu";
    } else if (this.mode === "help") {
      if (command === "previous") this.helpPage = Math.max(0, this.helpPage - 1);
      else if (command === "next") this.helpPage = Math.min(2, this.helpPage + 1);
      else if (command === "back") this.closePanel();
    } else if (this.mode === "about") {
      if (command === "confirm" || command === "back") this.mode = "menu";
    } else if (this.mode === "overwrite") {
      if (command === "confirm" || command === "softLeft") this.mode = "skipIntro";
      else if (command === "back" || command === "softRight") this.mode = "menu";
    } else if (this.mode === "skipIntro") {
      if (command === "confirm" || command === "softLeft") {
        this.mode = "gameBoundary";
        return { loadSave: false, skipIntro: true, speedX2: this.speedX2 };
      }
      if (command === "softRight") {
        this.mode = "gameBoundary";
        return { loadSave: false, skipIntro: false, speedX2: this.speedX2 };
      }
      if (command === "back") this.mode = "menu";
    } else if ((this.mode === "gameBoundary" || this.mode === "exit") && command === "back")
      this.mode = "menu";
    return null;
  }
  toggleSpeed(): void {
    this.speedX2 = !this.speedX2;
  }
  closePanel(): void {
    this.mode = "menu";
    this.helpPage = 0;
  }
  private menu(command: TitleCommand): StartRequest | null {
    const labels = this.labels();
    if (command === "previous") this.selected = (this.selected + labels.length - 1) % labels.length;
    else if (command === "next") this.selected = (this.selected + 1) % labels.length;
    else if (command === "confirm") {
      const label = labels[this.selected];
      if (label === "Chơi tiếp") {
        this.mode = "gameBoundary";
        return { loadSave: true, skipIntro: false, speedX2: this.speedX2 };
      }
      if (label === "Chơi mới") {
        this.mode = this.anySave ? "overwrite" : "skipIntro";
      } else if (label === "Tùy chọn") this.mode = "settings";
      else if (label === "Trợ giúp") {
        this.mode = "help";
        this.helpPage = 0;
      } else if (label === "Giới thiệu") this.mode = "about";
      else if (label === "Thoát") this.mode = "exit";
    }
    if (this.selected >= this.labels().length) this.selected = 0;
    return null;
  }
}
