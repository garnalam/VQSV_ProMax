import { viewport } from "../core/Viewport";
import { SAFARI_BALLS, SAFARI_FEE } from "../game/meta/Safari";
import { shieldTrackRects, shieldTrackUnit } from "../game/battle/ShieldTrack";
import { BATTLE_SEATS } from "../game/battle/BattleSeats";
import type { GameAssets } from "../game/story/GameAssets";
import { SAFARI_BUTTONS, SAFARI_COMMANDS, type SafariSession } from "../game/world/SafariSession";
import type { PanelFontRenderer } from "./PanelFontRenderer";
import type { CanvasRenderer } from "./CanvasRenderer";
import type { SourceUiLayout } from "./SourceUiLayout";
import { drawCaptureBall, drawCapturedPetEffect } from "./CaptureAnimationRenderer";
import { sourceHorizontalScrollOffset } from "./BattleRenderer";

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
/** The battle screen's own art: sprite 257's cells and the JAR `battle.ui` widget layout. */
export type SafariBattleUi = {
  cell: (index: number) => HTMLImageElement | undefined;
  layout: SourceUiLayout;
};

/** Where the wild pet and the hero stand in an encounter (sprite origins, UI space). */
export const SAFARI_ENEMY = { x: 172, y: 136 } as const;
export const SAFARI_HERO = { x: 58, y: 212 } as const;
/** How long a message stays up on the map before it fades out (ticks). */
const MESSAGE_TICKS = 90;
const COMMAND_LABELS = ["Ném bóng", "Ném mồi", "Ném đá", "Chạy"] as const;
/** The battle band's own six tiles (cell 93): "Bắt được" (1) and "Chạy trốn" (5) are reused. */
const BAND_TILE = { top: 40, width: 40 } as const;

/** Safari draws with the battle screen's art and the same bitmap text as every ProMax panel. */
export function drawSafari(
  renderer: CanvasRenderer,
  safari: SafariSession,
  assets: GameAssets,
  font: PanelFontRenderer,
  art: SafariArt,
  ui: SafariBattleUi,
  badges: number,
  saving: boolean,
  failed: boolean,
): void {
  const g = renderer.context,
    // A run that just ended stays on screen while the boat home sets off.
    run = safari.run ?? safari.departing?.run,
    animation = safari.throwAnimation,
    image = (name: string) => assets.pack.imageElement(`safari.${name}.png`);
  // During the wild-battle entry wipe the map is still what is under it.
  const encounter =
    animation?.encounter ?? (safari.entryTick >= 0 ? null : (run?.encounter ?? null));
  const walking = !!run && !encounter;
  renderer.worldSpace();
  if (walking) drawMap(g, safari, assets, art);
  else {
    // The jungle backdrop covers the whole canvas; the UI box draws it again, crisp, on top.
    const background = image("battle-background"),
      scale = Math.max(viewport.width / 240, viewport.height / 235);
    g.fillStyle = "#0b1d16";
    g.fillRect(0, 0, viewport.width, viewport.height);
    if (background.complete && background.naturalWidth) {
      const smoothing = g.imageSmoothingEnabled;
      g.imageSmoothingEnabled = false;
      g.drawImage(
        background,
        Math.floor((viewport.width - 240 * scale) / 2),
        Math.floor((viewport.height - 235 * scale) / 2),
        240 * scale,
        235 * scale,
      );
      g.imageSmoothingEnabled = smoothing;
    }
    g.fillStyle = encounter ? "rgba(0,0,0,0.45)" : "rgba(4,16,24,0.55)";
    g.fillRect(0, 0, viewport.width, viewport.height);
  }
  renderer.uiSpace();
  const kit = new Kit(g, font);
  if (encounter) drawEncounter(g, safari, assets, art, ui, kit, image);
  else if (walking) {
    kit.panel(3, 3, 112, 22);
    drawBallIcon(g, assets, safari, 8, 9);
    kit.text(`${run!.balls}/${SAFARI_BALLS} bóng`, 22, 8);
    if (safari.caughtThisVisit > 0) kit.text(`· bắt ${safari.caughtThisVisit}`, 76, 8, "#fff16a");
  } else drawEntry(g, kit, image, badges, safari.usedToday);
  if (safari.run || animation) kit.button(SAFARI_BUTTONS.exit, "Rời", false, [196, 4, 40, 20]);

  // The message: always shown under an encounter, for a while on the map and the entry screen.
  const message = failed
    ? "Lưu lỗi. Chạm hoặc Enter để thử lại."
    : animation
      ? animationText(safari)
      : saving
        ? "Đang lưu..."
        : safari.message;
  const fresh = safari.tickCount - safari.messageTick < MESSAGE_TICKS;
  if (encounter) {
    kit.wrap(message || "Chọn cách bắt pet bên dưới.", 8, 238, 224, 2, failed ? "#ffb7a3" : "#fff");
  } else if (message && (fresh || failed || saving || !run)) {
    const lines = kit.lines(message, 220).length > 1 ? 2 : 1,
      height = lines === 2 ? 36 : 22;
    kit.panel(4, 316 - height, 232, height);
    kit.wrap(message, 10, 321 - height, 220, 2, failed ? "#ffb7a3" : "#fff");
  }
  if (safari.confirmExit) drawConfirm(g, run?.balls ?? 0, kit);
}

function drawMap(
  g: CanvasRenderingContext2D,
  safari: SafariSession,
  assets: GameAssets,
  art: SafariArt,
): void {
  const map = safari.map,
    position = safari.run ?? safari.departing?.run;
  g.fillStyle = "#123b34";
  g.fillRect(0, 0, viewport.width, viewport.height);
  if (!position || !map) return;
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
  // The gate's sign stands in front of a hero walking under it, so it sorts by its posts' feet.
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

function drawEncounter(
  g: CanvasRenderingContext2D,
  safari: SafariSession,
  assets: GameAssets,
  art: SafariArt,
  ui: SafariBattleUi,
  kit: Kit,
  image: (name: string) => HTMLImageElement,
): void {
  const run = safari.run,
    animation = safari.throwAnimation;
  const encounter = animation?.encounter ?? run!.encounter!;
  const pet = encounter.pet,
    row = assets.petStats.speciesRow(pet.speciesId),
    sprite = pet.visualSpriteId ?? row?.spriteId ?? 0;
  const enemy = SAFARI_ENEMY,
    hero = SAFARI_HERO;
  drawImage(g, image("battle-background"), 0, 0);
  drawImage(g, image("battle-platform"), enemy.x - 57, enemy.y - 13, 110, 45);
  drawImage(g, image("player-platform"), hero.x - 42, hero.y - 22);

  const ball = safari.captureVisual;
  const impact = animation
    ? animation.tick - (animation.action === "ball" ? safari.captureTicks : 14)
    : -1;
  const fleeing = animation?.outcome === "fled" && impact >= 4;
  const petX =
    enemy.x +
    (fleeing
      ? (impact - 4) * 12
      : impact >= 0 && impact < 5 && animation?.action === "rock"
        ? impact % 2
          ? -3
          : 3
        : 0);
  const petY =
    enemy.y -
    (impact >= 0 && impact < 8 && animation?.action === "bait"
      ? Math.abs(Math.sin((impact * Math.PI) / 4)) * 4
      : 0);
  // A new pet slides in from the right during its first ticks on screen.
  const entering = !animation && safari.tickCount - safari.messageTick < 8 && encounter.turns === 0;
  const slide =
    entering && safari.message === "Gặp pet hoang dã!"
      ? (8 - (safari.tickCount - safari.messageTick)) * 9
      : 0;
  g.save();
  if (fleeing) g.globalAlpha = Math.max(0, 1 - (impact - 4) / 7);
  if (
    !ball?.hideEnemy &&
    !(animation?.action === "ball" && animation.outcome === "caught" && !ball)
  )
    art.pet(g, sprite, pet.nature ?? 0, pet.shinyColor ?? -1, petX + slide, petY);
  g.restore();
  art.hero(g, hero.x, hero.y, 2, false);
  if (ball) {
    const enemyActor = { spriteId: sprite, origin: { x: enemy.x, y: enemy.y } };
    const player = { spriteId: art.heroSprite, origin: { x: hero.x, y: hero.y } };
    // The ground marker sits where the battle seats put it against the enemy (`BATTLE_SEATS`), so
    // the ball lands, shakes and rests where it does in a wild fight.
    drawCaptureBall(
      g,
      assets,
      ball,
      {
        enemy: enemyActor,
        player,
        marker: {
          x: enemy.x + BATTLE_SEATS.enemyMarker.x - BATTLE_SEATS.enemy.x,
          y: enemy.y + BATTLE_SEATS.enemyMarker.y - BATTLE_SEATS.enemy.y,
        },
      },
      (effect) => drawCapturedPetEffect(g, assets, enemyActor, effect),
    );
  }
  if (animation && animation.action !== "ball") {
    const progress = Math.min(1, animation.tick / 14);
    const x = hero.x + (enemy.x - hero.x) * progress;
    const y =
      hero.y - 30 + (enemy.y - 14 - (hero.y - 30)) * progress - 52 * Math.sin(progress * Math.PI);
    if (animation.tick < 17) {
      const icon = image(animation.action);
      g.save();
      g.translate(Math.round(x), Math.round(y));
      g.rotate(progress * Math.PI * 2);
      drawImage(g, icon, -Math.floor(icon.naturalWidth / 2), -Math.floor(icon.naturalHeight / 2));
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
        g.fillRect(enemy.x + dx * radius, enemy.y - 10 + dy * radius, 2, 2);
    }
  }

  // The wild pet's HUD: the battle's own top-left plate (widget 1), name, level, element, HP.
  const layout = ui.layout,
    widget = (id: number) => layout.widget(id);
  const plate = ui.cell(92),
    plateAt = widget(1);
  if (plate && plateAt) g.drawImage(plate, plateAt.x, plateAt.y);
  const nameAt = widget(15),
    levelAt = widget(16),
    hpAt = widget(14),
    elementAt = widget(18);
  if (nameAt)
    kit.clipped(row?.name ?? "Pet hoang dã", nameAt.x, nameAt.y, nameAt.w - 3, safari.tickCount);
  if (levelAt) kit.text(`lv${pet.level}`, levelAt.x, levelAt.y);
  if (hpAt)
    for (const rect of shieldTrackRects(
      shieldTrackUnit(1, 1, 0),
      hpAt.x,
      hpAt.y,
      hpAt.w,
      hpAt.h || 4,
    )) {
      g.fillStyle = rect.color;
      g.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  const element = row?.element ?? -1,
    elementIcon = element >= 0 ? ui.cell(94 + element) : undefined;
  if (elementAt && elementIcon) {
    const x = elementAt.x - 4,
      y = Math.max(0, elementAt.y - 3);
    g.fillStyle = "rgba(0,23,36,.86)";
    g.fillRect(x, y, 17, 16);
    g.strokeStyle =
      ["#ff5520", "#35bc5a", "#b98642", "#328ddd", "#f4da31", "#b65ade", "#44cbd3"][element] ??
      "#fff";
    g.strokeRect(x + 0.5, y + 0.5, 16, 15);
    g.drawImage(elementIcon, x + 1, y + 2, 15, 13);
  }
  // Mood and odds, so bait and rocks mean something: what each throw does is in its message.
  const odds = safari.odds,
    mood = run?.encounter ?? encounter;
  kit.panel(3, 27, 112, 36);
  kit.text(
    mood.effect === "bait"
      ? `Đang ăn mồi · ${mood.turns} lượt`
      : mood.effect === "rock"
        ? `Đang nổi giận · ${mood.turns} lượt`
        : "Bình thường",
    8,
    31,
    mood.effect === "bait" ? "#fff16a" : mood.effect === "rock" ? "#ff9a7a" : "#fff",
  );
  if (odds) {
    kit.text(`Bắt ${odds.catch}%`, 8, 46, "#9cf29c");
    kit.text(`Bỏ chạy ${odds.flee}%`, 56, 46, "#ffb7a3");
  }

  // The command band: the battle band's floor, the message on top, the battle's tiles below.
  const band = ui.cell(93);
  g.fillStyle = "#223355";
  g.fillRect(0, 235, 240, 85);
  g.fillStyle = "#e8f4ff";
  g.fillRect(0, 235, 240, 1);
  const balls = animation?.balls ?? run?.balls ?? 0;
  const tileH = 38;
  for (const [i, [x, y, w]] of SAFARI_COMMANDS.entries()) {
    if (band) {
      // "Ném bóng" is the battle's "Bắt được" tile, "Chạy trốn" its own; bait and rock get a clean
      // tile (the "Đạo cụ" tile with its icon painted over by its own background column).
      const source = i === 0 ? 1 : i === 3 ? 5 : 2;
      g.drawImage(band, BAND_TILE.width * source, BAND_TILE.top, w, tileH, x, y, w, tileH);
      if (i === 1 || i === 2) {
        g.drawImage(
          band,
          BAND_TILE.width * source + 3,
          BAND_TILE.top,
          1,
          tileH,
          x + 4,
          y,
          w - 8,
          tileH,
        );
        const icon = image(i === 1 ? "bait-large" : "rock-large");
        drawImage(g, icon, x + Math.floor((w - icon.naturalWidth) / 2), y + 3);
      }
    }
    const selected = safari.selection === i && !animation,
      color = selected ? "#fff16a" : "#fff";
    kit.shadowed(COMMAND_LABELS[i], x - 10, w + 20, y + tileH + 3, color);
    if (i === 0) {
      // The balls left, as a badge on the ball tile.
      const label = `${balls}`,
        width = kit.width(label) + 6;
      g.fillStyle = "#7a1d1d";
      g.fillRect(x + w - width + 3, y - 3, width, 12);
      g.strokeStyle = "#fff16a";
      g.strokeRect(x + w - width + 3.5, y - 2.5, width - 1, 11);
      kit.text(label, x + w - width + 6, y - 2, "#fff16a");
    }
    if (selected) {
      g.strokeStyle = "#fff16a";
      g.strokeRect(x - 1.5, y - 1.5, w + 3, tileH + 3);
    }
  }
  if (animation) {
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(0, SAFARI_COMMANDS[0][1], 240, 320 - SAFARI_COMMANDS[0][1]);
  }
}

function drawEntry(
  g: CanvasRenderingContext2D,
  kit: Kit,
  image: (name: string) => HTMLImageElement,
  badges: number,
  usedToday: boolean,
): void {
  const sign = image("title-sign");
  drawImage(g, sign, Math.floor((240 - (sign.naturalWidth || 126)) / 2), 26);
  kit.panel(16, 74, 208, 136);
  const rows: [string, string][] = [
    ["Khu Safari rừng nhiệt đới", "#fff16a"],
    [`Phí vào: ${SAFARI_FEE} huy hiệu`, "#fff"],
    [`Nhận ${SAFARI_BALLS} bóng, hết bóng là hết lượt`, "#fff"],
    ["Pet cấp 30-40, có pet hiếm cấp 40", "#fff"],
    [
      usedToday ? "Hết lượt hôm nay, mở lại lúc 0:00" : "Mỗi ngày 1 lượt, mở lại lúc 0:00",
      usedToday ? "#ff9a7a" : "#9cf29c",
    ],
    ["Ném mồi: khó bắt, ít bỏ chạy", "#c6e8ff"],
    ["Ném đá: dễ bắt, dễ bỏ chạy", "#c6e8ff"],
  ];
  for (const [i, [line, color]] of rows.entries()) kit.text(line, 24, 81 + i * 15, color);
  const short = badges < SAFARI_FEE;
  kit.text(
    `Bạn có ${badges} huy hiệu`,
    24,
    81 + rows.length * 15 + 4,
    short ? "#ff9a7a" : "#9cf29c",
  );
  kit.button(
    SAFARI_BUTTONS.enter,
    usedToday ? "Hết lượt" : short ? "Thiếu huy hiệu" : "Vào Safari",
    !short && !usedToday,
  );
  kit.button(SAFARI_BUTTONS.close, "Đóng", false);
}

function drawConfirm(g: CanvasRenderingContext2D, balls: number, kit: Kit): void {
  g.fillStyle = "rgba(0,0,0,0.5)";
  g.fillRect(0, 0, 240, 320);
  kit.panel(16, 112, 208, 104);
  kit.centered("Rời khu Safari?", 16, 208, 122, "#fff16a");
  kit.centered(`Bỏ ${balls} bóng còn lại.`, 16, 208, 142, "#fff");
  kit.centered("Phí vào không được hoàn lại.", 16, 208, 156, "#fff");
  kit.button(SAFARI_BUTTONS.leave, "Rời khu", true);
  kit.button(SAFARI_BUTTONS.stay, "Ở lại", false);
}

function animationText(safari: SafariSession): string {
  const animation = safari.throwAnimation!;
  if (animation.action === "ball") {
    const ball = safari.captureVisual;
    return ball?.phase === "throw" ? "Ném bóng..." : ball ? "Bóng đang lắc..." : safari.message;
  }
  return animation.tick < 14
    ? animation.action === "bait"
      ? "Ném mồi..."
      : "Ném đá..."
    : safari.message;
}

function drawBallIcon(
  g: CanvasRenderingContext2D,
  assets: GameAssets,
  safari: SafariSession,
  x: number,
  y: number,
): void {
  const frame = assets.frameAtCursor(safari.captureSpec.captureSpriteId, 0, 0);
  if (!frame) return;
  const image = assets.imageFor(frame);
  if (image.complete && image.naturalWidth) g.drawImage(image, x, y, 10, 10);
}

function drawImage(
  g: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  w?: number,
  h?: number,
): void {
  if (!image.complete || !image.naturalWidth) return;
  if (w === undefined || h === undefined) g.drawImage(image, x, y);
  else g.drawImage(image, x, y, w, h);
}

/** The battle UI's panel, button and text styles (`BattleUiRenderer.panel` / `button`). */
class Kit {
  constructor(
    private readonly g: CanvasRenderingContext2D,
    private readonly font: PanelFontRenderer,
  ) {}
  text(value: string, x: number, y: number, color = "#fff"): void {
    this.font.draw(this.g, value, x, y, color);
  }
  centered(value: string, x: number, w: number, y: number, color = "#fff"): void {
    this.font.centered(this.g, value, x, w, y, color);
  }
  /** Centred, with a dark drop shadow so it reads over a tile's art. */
  shadowed(value: string, x: number, w: number, y: number, color: string): void {
    this.font.centered(this.g, value, x + 1, w, y + 1, "#0b1424");
    this.font.centered(this.g, value, x, w, y, color);
  }
  width(value: string): number {
    return this.font.width(value);
  }
  clipped(value: string, x: number, y: number, w: number, tick = 0): void {
    const g = this.g;
    g.save();
    g.beginPath();
    g.rect(x, y - 1, w, this.font.height + 2);
    g.clip();
    const width = this.font.width(value),
      offset = width > w ? sourceHorizontalScrollOffset(width, w, tick) : 0;
    this.font.draw(g, value, x - offset, y, "#fff");
    g.restore();
  }
  panel(x: number, y: number, w: number, h: number): void {
    const g = this.g;
    g.fillStyle = "rgba(0,22,32,.58)";
    g.fillRect(x + 2, y + 3, w, h);
    g.fillStyle = "rgba(20,62,88,.94)";
    g.fillRect(x, y, w, h);
    g.strokeStyle = "#e8f4ff";
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    g.strokeStyle = "#345869";
    g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  }
  /** `rect` is the tap target; `drawn` (optional) a smaller face drawn inside it. */
  button(
    rect: readonly number[],
    label: string,
    primary: boolean,
    drawn?: readonly number[],
  ): void {
    const [x, y, w, h] = drawn ?? rect,
      g = this.g;
    g.fillStyle = "rgba(0,22,32,.58)";
    g.fillRect(x + 2, y + 2, w, h);
    g.fillStyle = primary ? "#247ca4" : "#506d7b";
    g.fillRect(x, y, w, h);
    g.strokeStyle = primary ? "#fff16a" : "#fff";
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    this.centered(
      label,
      x,
      w,
      y + Math.floor((h - this.font.height) / 2),
      primary ? "#fff16a" : "#fff",
    );
  }
  /** Word-wrapped lines no wider than `width`; a word wider than a line is cut by characters. */
  lines(value: string, width: number): string[] {
    const out: string[] = [];
    let line = "";
    for (const word of value.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (this.font.width(next) <= width) line = next;
      else {
        if (line) out.push(line);
        line = word;
        while (this.font.width(line) > width) {
          let cut = line.length - 1;
          while (cut > 1 && this.font.width(line.slice(0, cut)) > width) cut--;
          out.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      }
    }
    if (line) out.push(line);
    return out;
  }
  wrap(value: string, x: number, y: number, width: number, max: number, color: string): void {
    const lines = this.lines(value, width);
    for (let i = 0; i < Math.min(max, lines.length); i++) {
      let line = lines[i];
      if (i === max - 1 && lines.length > max) {
        while (line && this.font.width(`${line}...`) > width) line = line.slice(0, -1);
        line += "...";
      }
      this.text(line, x, y + i * 13, color);
    }
  }
}
