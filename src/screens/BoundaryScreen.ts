import type { BootAssets } from "../pack/boot";
import type { InputSnapshot } from "../core/input/InputSnapshot";
import type { Screen } from "../core/ScreenManager";
import type { CanvasRenderer } from "../rendering/CanvasRenderer";
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from "../core/constants";

/** Placeholder for flows the web has not ported yet; any press returns. */
export class BoundaryScreen implements Screen {
  constructor(
    private readonly assets: BootAssets,
    private readonly back: () => void,
  ) {}
  tick(input: InputSnapshot): void {
    if (input.hasPress) this.back();
  }
  render(renderer: CanvasRenderer): void {
    const g = renderer.context,
      font = this.assets.sourceFont;
    renderer.image(this.assets.menuBackground, 0, 0);
    g.fillStyle = "rgba(0,0,0,.67)";
    g.fillRect(24, 104, 192, 92);
    font.centeredAtBaseline(g, "Ranh giới chưa triển khai", 140, "#ffffff");
    font.centeredAtBaseline(g, "World/Panel sẽ được nối sau", 164, "#ffdd66");
    font.rightAtBaseline(g, "Quay lại", LOGICAL_WIDTH - 2, LOGICAL_HEIGHT - 2, "#ffffff");
  }
}
