import { viewport } from "../core/Viewport";
import type { GameAssets } from "../game/story/GameAssets";
import type { SafariSession } from "../game/world/SafariSession";
import type { PanelFontRenderer } from "./PanelFontRenderer";
import type { CanvasRenderer } from "./CanvasRenderer";

type SafariArt = {
  hero: (
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    direction: number,
    moving: boolean,
  ) => void;
  pet: (
    g: CanvasRenderingContext2D,
    sprite: number,
    nature: number,
    color: number,
    x: number,
    y: number,
  ) => void;
};

/** Safari uses the original pixel layers and the same bitmap text as every ProMax panel. */
export function drawSafari(
  renderer: CanvasRenderer,
  safari: SafariSession,
  assets: GameAssets,
  font: PanelFontRenderer,
  art: SafariArt,
  badges: number,
  saving: boolean,
  failed: boolean,
): void {
  const g = renderer.context,
    map = safari.map,
    run = safari.run;
  renderer.worldSpace();
  g.fillStyle = "#123b34";
  g.fillRect(0, 0, viewport.width, viewport.height);
  if (run && map) {
    const cameraX = Math.max(0, Math.min(map.width - viewport.width, run.x - viewport.width / 2));
    const cameraY = Math.max(
      0,
      Math.min(map.height - viewport.height, run.y - viewport.height / 2),
    );
    g.save();
    g.translate(-Math.floor(cameraX), -Math.floor(cameraY));
    g.drawImage(assets.pack.imageElement("safari.ground.png"), 0, 0);
    const water = map.water,
      frame = Math.floor((safari.tickCount * 50) / water.frameMs) % water.frameCount;
    g.drawImage(
      assets.pack.imageElement("safari.water.png"),
      frame * water.width,
      0,
      water.width,
      water.height,
      water.x,
      water.y,
      water.width,
      water.height,
    );
    let drawn = false;
    for (const object of [...map.objects, { atlas: -1, source: [0, 0, 112, 54], ...map.gate }].sort(
      (a, b) => a.footY - b.footY,
    )) {
      if (!drawn && object.footY > run.y) {
        art.hero(g, run.x, run.y, run.direction, safari.moving);
        drawn = true;
      }
      const [sx, sy, w, h] = object.source;
      const image = assets.pack.imageElement(
        object.atlas === -1 ? "safari.gate.png" : `safari.atlas-${object.atlas}.png`,
      );
      g.drawImage(image, sx, sy, w, h, object.x, object.y, w, h);
    }
    if (!drawn) art.hero(g, run.x, run.y, run.direction, safari.moving);
    g.restore();
  }
  renderer.uiSpace();
  const text = (s: string, x: number, y: number, color = "#ffffff") => font.draw(g, s, x, y, color);
  const band = (y: number, height: number) => {
    g.fillStyle = "rgba(10,35,30,0.94)";
    g.fillRect(0, y, 240, height);
    g.strokeStyle = "#d6c879";
    g.strokeRect(1, y + 1, 238, height - 2);
  };
  band(0, 35);
  text(run ? `Safari · ${run.balls} bóng` : "Safari", 8, 10);
  text("Rời", 198, 10);
  if (!run) {
    band(80, 184);
    text("Safari rừng nhiệt đới", 15, 96);
    text("Phí vào khu: 20 huy hiệu", 15, 122);
    text("Nhận 30 bóng Safari", 15, 143);
    text(`Bạn có ${badges} huy hiệu`, 15, 167);
    text("Vào Safari", 72, 211, "#ffdc66");
    text("Enter để vào · B để đóng", 15, 241);
  } else if (run.encounter) {
    const pet = run.encounter.pet,
      row = assets.petStats.speciesRow(pet.speciesId);
    g.fillStyle = "#101d1b";
    g.fillRect(0, 35, 240, 201);
    g.drawImage(assets.pack.imageElement("safari.battle-platform.png"), 115, 132, 110, 45);
    art.pet(
      g,
      pet.visualSpriteId ?? row?.spriteId ?? 0,
      pet.nature ?? 0,
      pet.shinyColor ?? -1,
      175,
      145,
    );
    art.hero(g, 57, 217, 2, false);
    text(row?.name ?? "Pet hoang dã", 8, 48);
    text(`Cấp ${pet.level} · HP đầy`, 8, 69);
    text(
      run.encounter.effect === "bait"
        ? "Đang ăn mồi"
        : run.encounter.effect === "rock"
          ? "Đang nổi giận"
          : "Bình thường",
      8,
      90,
    );
    band(236, 56);
    for (const [i, label] of ["Bóng", "Mồi", "Đá", "Chạy"].entries()) {
      const x = (i % 2) * 120 + 12,
        y = 242 + Math.floor(i / 2) * 27;
      text(
        (safari.selection === i ? "> " : "  ") + label,
        x,
        y,
        safari.selection === i ? "#ffdc66" : "#ffffff",
      );
    }
  }
  if (safari.confirmExit) {
    band(130, 105);
    text("Rời khu và bỏ bóng còn lại?", 8, 147);
    text("Enter để rời · B để tiếp tục", 8, 202);
  }
  band(294, 26);
  const message = failed ? "Lưu lỗi. Enter để thử lại." : saving ? "Đang lưu..." : safari.message;
  let line = message;
  while (font.width(line) > 224) line = line.slice(0, -1);
  text(line, 8, 301, failed ? "#ffb7a3" : "#ffffff");
}
