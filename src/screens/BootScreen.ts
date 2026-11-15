import type { BootAssets } from "../pack/boot";
import type { InputSnapshot } from "../core/input/InputSnapshot";
import type { Screen } from "../core/ScreenManager";
import type { CanvasRenderer } from "../rendering/CanvasRenderer";
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from "../core/constants";
import { LAND_CENTER, landSpace } from "../core/LandCenter";
import { viewport } from "../core/Viewport";

type Phase = "logo0" | "cwaLogo" | "musicPrompt";
/** `BootFlowState.LOGO_TICKS`. */
const LOGO_TICKS = 20;

/** `BootFlowState` phases LOGO_0, CWA_LOGO and MUSIC_PROMPT. */
export class BootScreen implements Screen {
  private phase: Phase = "logo0";
  private ticks = 0;
  constructor(
    private readonly assets: BootAssets,
    private readonly chooseMusic: (enabled: boolean) => void,
  ) {}
  tick(input: InputSnapshot): void {
    this.ticks++;
    if (this.phase === "logo0" && this.ticks >= LOGO_TICKS) this.switch("cwaLogo");
    else if (this.phase === "cwaLogo" && this.ticks >= LOGO_TICKS) this.switch("musicPrompt");
    else if (this.phase === "musicPrompt") {
      // MUSIC_PROMPT: softLeft (F1, Left, bottom-left corner) or confirm = on; softRight = off.
      if (input.softLeftPressed() || input.confirmPressed()) this.chooseMusic(true);
      else if (input.softRightPressed()) this.chooseMusic(false);
    }
  }
  render(renderer: CanvasRenderer): void {
    renderer.clear();
    const g = renderer.context,
      land = viewport.landscape,
      k = renderer.backingScale;
    if (this.phase !== "musicPrompt") {
      if (!land) renderer.centeredImage(this.assets.logo);
      else {
        // Landscape: the logo at full size in the middle of the APK's 320x240 screen.
        const logo = this.assets.logo;
        landSpace(g, k);
        g.drawImage(logo, Math.floor((320 - logo.width) / 2), Math.floor((240 - logo.height) / 2));
        renderer.uiSpace();
      }
      return;
    }
    const font = this.assets.sourceFont,
      mid = LOGICAL_HEIGHT / 2;
    if (land) landSpace(g, k, LAND_CENTER);
    font.centeredAtBaseline(g, "Bạn có muốn bật nhạc không?", mid - 12, "#ffffff");
    font.centeredAtBaseline(g, "Tắt nhạc có thể tăng tốc độ chơi", mid + 12, "#ff6600");
    // The softkey labels in the bottom corners of the screen (the 320x240 one in landscape).
    const [right, bottom] = land ? [320, 240] : [LOGICAL_WIDTH, LOGICAL_HEIGHT];
    if (land) landSpace(g, k);
    font.drawAtBaseline(g, "Có", 2, bottom - 2, "#ffffff");
    font.rightAtBaseline(g, "Không", right - 2, bottom - 2, "#ffffff");
    if (land) renderer.uiSpace();
  }
  private switch(phase: Phase): void {
    this.phase = phase;
    this.ticks = 0;
  }
}
