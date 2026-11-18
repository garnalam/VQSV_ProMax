import type { PanelFontRenderer } from "./PanelFontRenderer";
import type { SavedPet } from "../persistence/save/GameSave";
import type { QualityUpgradeSession } from "../game/pet/QualityUpgradeSession";
import {
  CORE_START_TICK,
  QUALITY_FX,
  STREAM_START_TICK,
  qualityAfterFailure,
  qualityFrameIndex,
  qualityPercent,
} from "../game/pet/QualityUpgrade";

/**
 * JavaSE `VqsvBattleRenderer.renderQualityUpgradeOverlay`: the NÂNG PHẨM screen. Two phôi cards
 * around the main pet card, the star rows before and after, the 20-segment success bar, the
 * button, the status line and the softkeys; the picker replaces the cards while it is open. The
 * charge plays the energy core and streams, the result the success or failure burst, from the
 * JavaSE `PetQualityUpgradeAssets` frames (`quality-fx` pack domain).
 */
export type QualityUpgradeArt = {
  font: PanelFontRenderer;
  /** A `quality-fx` frame by name ("star-state-1", "energy-core-03"...). */
  fx: (name: string) => HTMLImageElement | undefined;
  /** Web only: the guard charm's icon (`items.icons/QUALITY-GUARD-CHARM.png`). */
  guardIcon?: () => HTMLImageElement | undefined;
  /** The pet's species name and idle sprite. */
  pet: (pet: SavedPet) => { name: string; spriteId: number };
  /**
   * Draws a sprite's idle frame bottom-centred in a box (`drawBattleSprite` align 7), in the shiny
   * palette for a nature 7..9 pet.
   */
  sprite: (
    spriteId: number,
    x: number,
    y: number,
    w: number,
    h: number,
    tick: number,
    nature?: number,
    shinyColor?: number,
  ) => void;
};

const hex = (value: number) => `#${((value & 0xffffff) | 0x1000000).toString(16).slice(1)}`;
const two = (i: number) => (i < 10 ? `0${i}` : String(i));

function roundFill(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  arc: number,
  c: number,
) {
  g.fillStyle = hex(c);
  g.beginPath();
  g.roundRect(x, y, w, h, arc / 2);
  g.fill();
}
function roundStroke(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  arc: number,
  c: number,
) {
  g.strokeStyle = hex(c);
  g.lineWidth = 1;
  g.beginPath();
  g.roundRect(x + 0.5, y + 0.5, w, h, arc / 2);
  g.stroke();
}

export function drawQualityUpgrade(
  g: CanvasRenderingContext2D,
  art: QualityUpgradeArt,
  s: QualityUpgradeSession,
  tick: number,
): void {
  const font = art.font,
    image = (name: string, x: number, y: number, w: number, h: number) => {
      const frame = art.fx(name);
      if (frame && frame.complete && frame.naturalWidth > 0) g.drawImage(frame, x, y, w, h);
    },
    // `drawTinyBattleText` / `drawCenteredTinyText`.
    tiny = (text: string, x: number, y: number, w: number, c: number) => {
      g.save();
      g.beginPath();
      g.rect(x, y - 1, Math.max(1, w), 18);
      g.clip();
      font.drawTagged(g, text, x, y, hex(c));
      g.restore();
    },
    centered = (text: string, x: number, y: number, w: number, c: number) => {
      const width = Math.min(w, font.width(text));
      tiny(text, x + Math.max(0, Math.trunc((w - width) / 2)), y, w, c);
    },
    // `drawEvolutionSoftkey`.
    softkey = (x: number, y: number, w: number, h: number, label: string, c: number) => {
      roundFill(g, x + 1, y + 1, w, h, 8, 800070);
      roundFill(g, x, y, w, h, 8, c);
      centered(label, x + 2, y + 5, w - 4, 0xffffff);
    },
    result = s.result,
    before = result ? result.qualityBefore : s.main.quality,
    after = result ? result.qualityAfter : Math.min(5, before + 1);

  roundFill(g, 5, 34, 230, 255, 12, 133390);
  roundFill(g, 7, 36, 226, 251, 10, 597803);
  roundStroke(g, 7, 36, 225, 250, 10, 2850711);
  roundFill(g, 9, 38, 222, 29, 8, 1195344);
  g.fillStyle = hex(1195344);
  g.fillRect(9, 57, 222, 10);
  g.fillStyle = hex(14133555);
  g.fillRect(12, 65, 216, 2);
  centered(`NÂNG PHẨM  +${before}  →  +${after}`, 35, 46, 170, 16180643);

  if (s.pickerVisible) {
    drawPicker();
    return;
  }

  fodderCard(s.fodders[0], 11, 78, 53, 97, "PHÔI 1", s.focus === 0, s.phase === 2);
  fodderCard(s.fodders[1], 176, 78, 53, 97, "PHÔI 2", s.focus === 1, s.phase === 2);
  mainCard(70, 72, 100, 113, result ? after : before);
  if (s.phase === 1) charging();
  else if (s.phase === 2 && result) {
    const success = result.outcome === "SUCCESS",
      frames = success ? QUALITY_FX.success : QUALITY_FX.failure,
      index = qualityFrameIndex(frames, s.ticks, false);
    image(`${success ? "success" : "failure"}-${two(index)}`, 72, 78, 96, 96);
  }
  // `drawQualityStars`: before, an arrow, after.
  starGroup(36, 188, before, false);
  g.strokeStyle = hex(2978184);
  g.lineWidth = 1;
  g.beginPath();
  for (const [x1, y1, x2, y2] of [
    [105, 198, 130, 198],
    [125, 193, 130, 198],
    [125, 203, 130, 198],
  ]) {
    g.moveTo(x1 + 0.5, y1 + 0.5);
    g.lineTo(x2 + 0.5, y2 + 0.5);
  }
  g.stroke();
  starGroup(136, 188, after, true);

  centered("XÁC SUẤT THÀNH CÔNG", 12, 207, 216, 8964312);
  const rate = s.rateBasisPoints,
    lit = Math.round((20 * Math.max(0, Math.min(10000, rate))) / 10000);
  for (let i = 0; i < 20; i++) {
    const x = 14 + i * 8;
    roundFill(g, x, 219, 6, 10, 3, i < lit ? 14002488 : 2572620);
    if (i < lit) {
      g.fillStyle = hex(16112762);
      g.fillRect(x + 1, 220, 4, 2);
    }
  }
  centered(qualityPercent(rate), 188, 217, 40, rate > 0 ? 15981170 : 8360858);
  const ready = s.resultReady;
  if (s.phase === 2) {
    const text = !ready
      ? "ĐANG XÁC ĐỊNH..."
      : result!.outcome === "SUCCESS"
        ? `THÀNH CÔNG  +${result!.qualityAfter}`
        : `THẤT BẠI  CÒN +${result!.qualityAfter}`;
    centered(
      text,
      12,
      237,
      216,
      !ready ? 10406871 : result!.outcome === "SUCCESS" ? 6939818 : 16744584,
    );
  } else
    centered(
      `Thành công: +${Math.min(5, before + 1)}   |   Thất bại: +${qualityAfterFailure(before, s.guardActive)}`,
      12,
      237,
      216,
      10406871,
    );

  const canUpgrade = rate > 0 && s.main.quality < 5;
  roundFill(
    g,
    70,
    251,
    100,
    28,
    7,
    s.focus === 2 && s.phase === 0
      ? canUpgrade
        ? 12817711
        : 4477786
      : canUpgrade
        ? 9137964
        : 4477786,
  );
  roundStroke(g, 70, 251, 99, 27, 7, canUpgrade ? 16045679 : 7307656);
  guardSlot();
  centered(
    s.phase === 1 ? "ĐANG CƯỜNG HÓA" : s.phase === 2 ? (ready ? "TIẾP TỤC" : "...") : "NÂNG PHẨM",
    73,
    259,
    94,
    0xffffff,
  );
  centered(
    s.status,
    10,
    281,
    220,
    s.phase === 2 && result?.outcome === "FAILURE" ? 16747925 : 9423062,
  );
  softkey(
    1,
    291,
    58,
    25,
    s.phase === 2 && ready ? "Tiếp tục" : s.phase === 0 ? "Chọn phôi" : "",
    2854259,
  );
  softkey(181, 291, 58, 25, s.phase !== 1 && s.phase !== 2 ? "Quay lại" : "", 2651542);

  /**
   * Web only: the charm slot left of the button — the guard charm's icon and how many the bag
   * holds; lit while it protects this attempt, dim when the bag has none or none is needed.
   */
  function guardSlot() {
    const count = s.guardCount,
      active = s.guardActive;
    roundFill(g, 12, 251, 54, 28, 7, active ? 6105616 : 2572620);
    roundStroke(g, 12, 251, 53, 27, 7, active ? 16045679 : 7307656);
    const icon = art.guardIcon?.();
    if (icon && icon.complete && icon.naturalWidth > 0) {
      g.save();
      if (!active) g.globalAlpha = 0.4;
      g.drawImage(icon, 14, 253, 24, 24);
      g.restore();
    }
    tiny(`x${count}`, 40, 259, 26, active ? 0xffffff : 8360858);
  }
  /** `drawQualityStarGroup`. */
  function starGroup(x: number, y: number, quality: number, target: boolean) {
    const count = Math.max(1, Math.min(5, quality));
    for (let i = 0; i < 5; i++) {
      let state = i < count ? 1 : 0;
      if (target && s.phase === 1 && i === count - 1) state = 2;
      else if (target && s.phase === 0 && s.rateBasisPoints > 0 && i === count - 1) state = 2;
      else if (target && s.phase === 2 && result) {
        if (result.outcome === "SUCCESS" && i === result.qualityAfter - 1) state = 3;
        else if (
          result.outcome === "FAILURE" &&
          result.qualityAfter < result.qualityBefore &&
          i === result.qualityBefore - 1
        )
          state = 4;
      }
      image(`star-state-${state}`, x + i * 14, y, 16, 16);
    }
  }
  /** `drawQualityCharging`. */
  function charging() {
    const core = s.ticks - CORE_START_TICK,
      stream = s.ticks - STREAM_START_TICK;
    if (stream >= 0) {
      const name = `energy-stream-${two(qualityFrameIndex(QUALITY_FX.energyStream, stream, false))}`,
        frame = art.fx(name);
      if (frame && frame.complete && frame.naturalWidth > 0) {
        // `drawImage(img, dx1, dy1, dx2, dy2, ...)`: the right stream is mirrored (185 → 129).
        if (s.fodders[0]) g.drawImage(frame, 55, 112, 56, 20);
        if (s.fodders[1]) {
          g.save();
          g.translate(185, 112);
          g.scale(-1, 1);
          g.drawImage(frame, 0, 0, 56, 20);
          g.restore();
        }
      }
    }
    if (core >= 0)
      image(
        `energy-core-${two(qualityFrameIndex(QUALITY_FX.energyCore, core, false))}`,
        96,
        99,
        48,
        48,
      );
    const next = Math.min(5, s.main.quality + 1);
    image(
      `star-glow-${two(qualityFrameIndex(QUALITY_FX.starGlow, s.ticks, true))}`,
      132 + (next - 1) * 14,
      184,
      24,
      24,
    );
  }
  /** `drawQualityMainCard`. */
  function mainCard(x: number, y: number, w: number, h: number, quality: number) {
    const pulse = s.phase === 1 ? Math.trunc(s.ticks / 2) & 1 : 0;
    roundFill(g, x - 2 - pulse, y - 2 - pulse, w + 4 + pulse * 2, h + 4 + pulse * 2, 10, 132875);
    roundFill(g, x, y, w, h, 9, s.phase === 1 ? 5559784 : 13673017);
    roundFill(g, x + 2, y + 2, w - 4, h - 4, 7, 863032);
    roundFill(g, x + 5, y + 22, w - 10, 63, 6, 1457999);
    roundFill(g, x + 7, y + 6, 28, 18, 6, 14068285);
    centered(`+${quality}`, x + 8, y + 10, 26, 0xffffff);
    centered("PET CHÍNH", x + 37, y + 8, w - 42, 10801371);
    const info = art.pet(s.main);
    if (info.spriteId >= 0) {
      g.save();
      g.beginPath();
      g.rect(x + 12, y + 23, w - 24, 60);
      g.clip();
      art.sprite(info.spriteId, x + 12, y + 18, w - 24, 70, tick, s.main.nature, s.main.shinyColor);
      g.restore();
    }
    centered(info.name, x + 5, y + 86, w - 10, 16054778);
    centered(`Lv ${s.main.level}  |  ${quality} sao`, x + 5, y + 99, w - 10, 8567238);
  }
  /** `drawQualityFodderCard`. */
  function fodderCard(
    pet: SavedPet | null,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    focused: boolean,
    used: boolean,
  ) {
    roundFill(g, x, y, w, h, 7, focused ? 13870138 : 3235693);
    roundFill(g, x + 2, y + 2, w - 4, h - 4, 5, 731188);
    centered(used ? "ĐÃ DÙNG" : label, x + 2, y + 4, w - 4, focused ? 16112501 : 9355982);
    if (used) {
      image("star-state-0", x + 14, y + 30, 24, 24);
      centered("Hấp thụ", x + 2, y + 69, w - 4, 7180955);
    } else if (!pet) {
      roundStroke(g, x + 12, y + 29, 28, 28, 6, focused ? 14002755 : 5668231);
      centered("+", x + 13, y + 34, 27, focused ? 16112501 : 7379362);
      centered("Chọn", x + 2, y + 68, w - 4, 7904678);
    } else {
      const info = art.pet(pet);
      if (info.spriteId >= 0) {
        g.save();
        g.beginPath();
        g.rect(x + 6, y + 18, w - 12, 45);
        g.clip();
        art.sprite(info.spriteId, x + 5, y + 14, w - 10, 54, tick, pet.nature, pet.shinyColor);
        g.restore();
      }
      centered(info.name, x + 2, y + 65, w - 4, 15398648);
      centered(`${pet.quality} sao`, x + 2, y + 80, w - 4, 14992989);
    }
  }
  /** `renderQualityUpgradePicker`: five candidate rows, labelled by party/bank ownership. */
  function drawPicker() {
    centered(`Chọn phôi cho ô ${s.focus + 1}`, 12, 72, 216, 15849589);
    for (let slot = 0; slot < 5; slot++) {
      const index = s.pickerScroll + slot,
        y = 82 + slot * 34,
        on = index === s.pickerIndex;
      roundFill(g, 12, y, 216, 31, 7, on ? 1460314 : 862774);
      roundStroke(g, 12, y, 215, 30, 7, on ? 13738810 : 3632508);
      const pet = s.candidates[index];
      if (!pet) continue;
      const info = art.pet(pet);
      if (info.spriteId >= 0) {
        g.save();
        g.beginPath();
        g.rect(16, y + 2, 34, 27);
        g.clip();
        art.sprite(info.spriteId, 17, y, 32, 30, tick, pet.nature, pet.shinyColor);
        g.restore();
      }
      const distance = s.candidateDistance(pet);
      font.drawTagged(g, `${info.name} [${s.candidateLocation(pet)}]`, 54, y + 4, hex(15399163));
      // `drawTaggedLine(.., 40, ..)`: at most 40 visible characters.
      const meta = `${pet.quality} sao | +${qualityPercent(s.candidateRate(pet))} | ${
        distance === 0 ? "Cùng form" : `Form trước ${distance}`
      }`;
      font.drawTagged(g, Array.from(meta).slice(0, 40).join(""), 54, y + 16, hex(8633802));
    }
    if (s.candidates.length === 0) centered("Không có Pet phôi phù hợp", 20, 150, 200, 16747925);
    softkey(181, 291, 58, 25, "Quay lại", 2651542);
  }
}
