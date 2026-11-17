import { viewport } from "../core/Viewport";
import type { GameAssets } from "../game/story/GameAssets";
import type { SafariSession } from "../game/world/SafariSession";
import type { PanelFontRenderer } from "./PanelFontRenderer";
import type { CanvasRenderer } from "./CanvasRenderer";
import { drawSafariItem } from "./SafariItemRenderer";
import { drawCaptureBall, drawCapturedPetEffect } from "./CaptureAnimationRenderer";

type SafariArt = {
  heroSprite: number;
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
  const position = run ?? safari.throwAnimation?.position;
  if (position && map) {
    const cameraX = Math.max(
      0,
      Math.min(map.width - viewport.width, position.x - viewport.width / 2),
    );
    const cameraY = Math.max(
      0,
      Math.min(map.height - viewport.height, position.y - viewport.height / 2),
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
      if (!drawn && object.footY > position.y) {
        art.hero(g, position.x, position.y, position.direction, safari.moving);
        drawn = true;
      }
      const [sx, sy, w, h] = object.source;
      const image = assets.pack.imageElement(
        object.atlas === -1 ? "safari.gate.png" : `safari.atlas-${object.atlas}.png`,
      );
      g.drawImage(image, sx, sy, w, h, object.x, object.y, w, h);
    }
    if (!drawn) art.hero(g, position.x, position.y, position.direction, safari.moving);
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
  text(
    run || safari.throwAnimation
      ? `Safari · ${run?.balls ?? safari.throwAnimation!.balls} bóng`
      : "Safari",
    8,
    10,
  );
  text("Rời", 198, 10);
  if (!run && !safari.throwAnimation) {
    band(80, 184);
    text("Safari rừng nhiệt đới", 15, 96);
    text("Phí vào khu: 20 huy hiệu", 15, 122);
    text("Nhận 30 bóng Safari", 15, 143);
    text(`Bạn có ${badges} huy hiệu`, 15, 167);
    text("Vào Safari", 72, 211, "#ffdc66");
    text("Enter để vào · B để đóng", 15, 241);
  } else if (run?.encounter || safari.throwAnimation) {
    const animation = safari.throwAnimation;
    const encounter = animation?.encounter ?? run!.encounter!;
    const pet = encounter.pet,
      row = assets.petStats.speciesRow(pet.speciesId);
    g.fillStyle = "#101d1b";
    g.fillRect(0, 35, 240, 201);
    g.drawImage(assets.pack.imageElement("safari.battle-platform.png"), 115, 132, 110, 45);
    const ball = safari.captureVisual;
    const impact = animation
      ? animation.tick - (animation.action === "ball" ? safari.captureTicks : 14)
      : -1;
    const fleeing = animation?.outcome === "fled" && impact >= 4;
    const petX =
      175 +
      (fleeing
        ? (impact - 4) * 12
        : impact >= 0 && impact < 5 && animation?.action === "rock"
          ? impact % 2
            ? -3
            : 3
          : 0);
    const petY =
      145 -
      (impact >= 0 && impact < 8 && animation?.action === "bait"
        ? Math.abs(Math.sin((impact * Math.PI) / 4)) * 4
        : 0);
    g.save();
    if (fleeing) g.globalAlpha = Math.max(0, 1 - (impact - 4) / 7);
    if (
      !ball?.hideEnemy &&
      !(animation?.action === "ball" && animation.outcome === "caught" && !ball)
    )
      art.pet(
        g,
        pet.visualSpriteId ?? row?.spriteId ?? 0,
        pet.nature ?? 0,
        pet.shinyColor ?? -1,
        petX,
        petY,
      );
    g.restore();
    art.hero(g, 57, 217, 2, false);
    if (ball) {
      const enemy = {
        spriteId: pet.visualSpriteId ?? row?.spriteId ?? 0,
        origin: { x: 175, y: 145 },
      };
      const player = { spriteId: art.heroSprite, origin: { x: 57, y: 217 } };
      const marker = assets.animationBounds(294, 0);
      if (marker)
        drawCaptureBall(
          g,
          assets,
          ball,
          {
            enemy,
            player,
            marker: {
              x: 175 - marker.x - marker.width / 2,
              y: 145 - marker.y - marker.height / 2,
            },
          },
          (effect) => drawCapturedPetEffect(g, assets, enemy, effect),
        );
    }
    if (animation && animation.action !== "ball") {
      const progress = Math.min(1, animation.tick / 14);
      const x = 57 + (175 - 57) * progress;
      const y = 188 + (133 - 188) * progress - 52 * Math.sin(progress * Math.PI);
      if (animation.tick < 17) {
        g.save();
        g.translate(x, y);
        g.rotate(progress * Math.PI * 2);
        drawSafariItem(g, animation.action, -5, -4);
        g.restore();
      }
      if (impact >= 0 && impact < 5) {
        g.fillStyle = animation.action === "rock" ? "#d0d8d1" : "#f3cd61";
        const radius = 4 + impact * 2;
        for (const [dx, dy] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ])
          g.fillRect(175 + dx * radius, 135 + dy * radius, 2, 2);
      }
    }
    text(row?.name ?? "Pet hoang dã", 8, 48);
    text(`Cấp ${pet.level} · HP đầy`, 8, 69);
    text(
      encounter.effect === "bait"
        ? "Đang ăn mồi"
        : encounter.effect === "rock"
          ? "Đang nổi giận"
          : "Bình thường",
      8,
      90,
    );
    band(236, 56);
    for (const [i, label] of ["Bóng", "Mồi", "Đá", "Chạy"].entries()) {
      const x = (i % 2) * 120 + 12,
        y = 242 + Math.floor(i / 2) * 27;
      if (i === 1 || i === 2) drawSafariItem(g, i === 1 ? "bait" : "rock", x + 10, y + 1);
      if (i === 0) {
        const frame = assets.frameAtCursor(safari.captureSpec.captureSpriteId, 0, 0);
        if (frame) {
          const image = assets.imageFor(frame);
          if (image.complete && image.naturalWidth) g.drawImage(image, x + 10, y, 10, 10);
        }
      }
      text(label, x + 25, y, safari.selection === i ? "#ffdc66" : "#ffffff");
      if (safari.selection === i) text(">", x, y, "#ffdc66");
    }
  }
  if (safari.confirmExit) {
    band(130, 105);
    text("Rời khu và bỏ bóng còn lại?", 8, 147);
    text("Enter để rời · B để tiếp tục", 8, 202);
  }
  band(294, 26);
  const animation = safari.throwAnimation;
  const ball = safari.captureVisual;
  const message = failed
    ? "Lưu lỗi. Enter để thử lại."
    : animation
      ? animation.action === "ball"
        ? ball?.phase === "throw"
          ? "Đang ném bóng..."
          : ball
            ? "Đang bắt pet..."
            : "Pet hoang đang phản ứng..."
        : animation.tick < 14
          ? animation.action === "bait"
            ? "Đang ném mồi..."
            : "Đang ném đá..."
          : "Pet hoang đang phản ứng..."
      : saving
        ? "Đang lưu..."
        : safari.message;
  let line = message;
  while (font.width(line) > 224) line = line.slice(0, -1);
  text(line, 8, 301, failed ? "#ffb7a3" : "#ffffff");
}
