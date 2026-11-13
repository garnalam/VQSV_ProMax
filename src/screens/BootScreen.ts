import type { BootAssets } from "../pack/boot";
import type { InputSnapshot } from "../core/input/InputSnapshot";
import type { Screen } from "../core/ScreenManager";
import type { CanvasRenderer } from "../rendering/CanvasRenderer";
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from "../core/constants";

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
    if (this.phase !== "musicPrompt") {
      renderer.centeredImage(this.assets.logo);
      return;
    }
    const g = renderer.context,
      font = this.assets.sourceFont,
      mid = LOGICAL_HEIGHT / 2;
    font.centeredAtBaseline(g, "Bạn có muốn bật nhạc không?", mid - 12, "#ffffff");
    font.centeredAtBaseline(g, "Tắt nhạc có thể tăng tốc độ chơi", mid + 12, "#ff6600");
    font.drawAtBaseline(g, "Có", 2, LOGICAL_HEIGHT - 2, "#ffffff");
    font.rightAtBaseline(g, "Không", LOGICAL_WIDTH - 2, LOGICAL_HEIGHT - 2, "#ffffff");
  }
  private switch(phase: Phase): void {
    this.phase = phase;
    this.ticks = 0;
  }
}
