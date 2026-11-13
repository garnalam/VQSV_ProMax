import type { WorldPanel } from "../game/world/WorldPanel";
import { fashionLabel, fashionName, label, rounded, type WardrobeArt } from "./WardrobeRenderer";

export type FashionShopArt = WardrobeArt & {
  bagIcon: HTMLImageElement;
  fashionIcon: HTMLImageElement;
  openSheet: HTMLImageElement;
};
const CARDS = [
  { x: 106, y: 66, w: 126, h: 48 },
  { x: 106, y: 118, w: 126, h: 48 },
  { x: 106, y: 170, w: 126, h: 48 },
  { x: 8, y: 250, w: 224, h: 28 },
];
const tierColor = (tier?: string) =>
  tier === "LEGENDARY"
    ? 0xffc65b
    : tier === "EPIC"
      ? 0xc58cff
      : tier === "RARE"
        ? 0x65bfff
        : 0x9ed9d6;
const image = (
  g: CanvasRenderingContext2D,
  value: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) => {
  if (value.complete && value.naturalWidth) g.drawImage(value, x, y, w, h);
};
function backdrop(g: CanvasRenderingContext2D, p: WorldPanel, a: FashionShopArt, title: string) {
  const gradient = g.createLinearGradient(0, 0, 0, 320);
  gradient.addColorStop(0, "#071f2a");
  gradient.addColorStop(1, "#164c57");
  g.fillStyle = gradient;
  g.fillRect(0, 0, 240, 320);
  g.fillStyle = "#0e414e";
  g.fillRect(0, 0, 240, 32);
  g.strokeStyle = "#66a2a8";
  g.beginPath();
  g.moveTo(0, 32.5);
  g.lineTo(240, 32.5);
  g.stroke();
  image(g, a.fashionIcon, 7, 4, 24, 24);
  label(g, a.font, title, 38, 10);
  rounded(g, 8, 37, 224, 22, 0x0a2731, 0x315d69, 6);
  label(g, a.font, `K ${p.wardrobeSource.money()}`, 13, 43, 0xeaf8f5);
  image(g, a.bagIcon, 89, 40, 18, 18);
  label(g, a.font, String(p.wardrobeSource.bags()), 112, 43);
  label(g, a.font, `Mảnh ${p.wardrobeSource.fragments()}`, 164, 43);
  g.strokeStyle = "#315d69";
  g.beginPath();
  g.moveTo(81.5, 41);
  g.lineTo(81.5, 55);
  g.moveTo(156.5, 41);
  g.lineTo(156.5, 55);
  g.stroke();
}
function soft(g: CanvasRenderingContext2D, a: FashionShopArt, left: string, right: string) {
  rounded(g, 0, 286, 112, 34, 0x286e99, 0xf2c862, 0);
  rounded(g, 128, 286, 112, 34, 0x173f56, 0x75aaa9, 0);
  label(g, a.font, left, 18, 297);
  label(g, a.font, right, 153, 297);
}
function shop(g: CanvasRenderingContext2D, p: WorldPanel, a: FashionShopArt) {
  backdrop(g, p, a, "Thương điểm thời trang");
  rounded(g, 8, 66, 90, 174, 0x0d2c36, 0x4f8993);
  label(g, a.font, "ĐANG MẶC", 18, 75, 0x9ed9d6);
  const equipped = p.wardrobeRows.find((r) => r.key === p.wardrobeSource.selected());
  if (equipped) {
    const rainbow = equipped.kind === "cau-vong" ? a.rainbowPreview(equipped.key) : undefined,
      f =
        equipped.kind === "cau-vong"
          ? undefined
          : a.preview(equipped.resourceId, equipped.animationBase, p.openedTicks);
    if (rainbow?.complete && rainbow.naturalWidth) g.drawImage(rainbow, 12, 92, 82, 104);
    else if (f) g.drawImage(f.image, 52 + f.ox, 160 + f.oy);
    label(g, a.font, fashionLabel(equipped).slice(0, 12), 15, 204);
  }
  CARDS.forEach((c, row) => {
    const active = p.selected === row;
    rounded(g, c.x, c.y, c.w, c.h, active ? 0x1b5360 : 0x102f39, active ? 0xf2c862 : 0x315d69);
    if (row < 3) image(g, row < 2 ? a.bagIcon : a.fashionIcon, c.x + 7, c.y + 8, 32, 32);
    if (row === 0) {
      label(g, a.font, "Mua túi mù", c.x + 43, c.y + 8);
      label(g, a.font, "500 K / túi", c.x + 43, c.y + 25, active ? 0xffdc83 : 0x9bc5c5);
    } else if (row === 1) {
      label(g, a.font, "Mở túi", c.x + 43, c.y + 8);
      label(
        g,
        a.font,
        `Hiện có ${p.wardrobeSource.bags()}`,
        c.x + 43,
        c.y + 25,
        active ? 0xffdc83 : 0x9bc5c5,
      );
    } else if (row === 2) {
      label(g, a.font, "Đổi mảnh", c.x + 43, c.y + 8);
      label(
        g,
        a.font,
        `${p.wardrobeSource.fragments()} mảnh • 35 mẫu`,
        c.x + 43,
        c.y + 25,
        active ? 0xffdc83 : 0x9bc5c5,
      );
    } else label(g, a.font, "Rời cửa hàng", c.x + 65, c.y + 8);
  });
  label(g, a.font, "TỶ LỆ", 106, 218, 0x6fa5a8);
  label(g, a.font, "55% • 27% • 14% • 4%", 110, 229, 0x9bc5c5);
  soft(g, a, p.selected === 3 ? "Rời đi" : "Chọn", "Quay lại");
}
function confirm(g: CanvasRenderingContext2D, p: WorldPanel, a: FashionShopArt, opening: boolean) {
  shop(g, p, a);
  rounded(g, 34, 75, 172, 158, 0x102f39, 0xf2c862);
  label(g, a.font, opening ? "Mở túi mù?" : "Mua túi mù", 72, 82);
  image(g, a.bagIcon, 104, 99, 32, 32);
  if (opening) {
    label(g, a.font, "Sẽ tiêu hao 1 túi mù", 48, 139, 0xe7f5f2);
    label(g, a.font, "Kết quả theo tỷ lệ công bố", 44, 161, 0x9bc5c5);
  } else {
    const price = p.wardrobeSource.catalog()?.bagPrice ?? 500;
    label(g, a.font, `${p.fashionPurchaseQuantity} túi`, 56, 132, 0xe7f5f2);
    label(g, a.font, `= ${p.fashionPurchaseQuantity * price} K`, 118, 132, 0xffdc83);
    rounded(g, 48, 151, 48, 32, 0x2f8290, 0x75aaa9);
    rounded(g, 144, 151, 48, 32, 0x2f8290, 0x75aaa9);
    label(g, a.font, "-", 68, 159);
    label(g, a.font, "+", 163, 159);
    label(g, a.font, String(p.fashionPurchaseQuantity), 108, 159);
  }
  rounded(g, 42, 196, 156, 32, 0x286e99, 0xf2c862);
  label(g, a.font, opening ? "Mở 1 túi" : "Mua ngay", 91, 205);
  soft(g, a, opening ? "Mở túi" : "Mua", "Hủy");
}
function exchange(
  g: CanvasRenderingContext2D,
  p: WorldPanel,
  a: FashionShopArt,
  confirmMode: boolean,
) {
  backdrop(g, p, a, "Đổi mảnh thời trang");
  const rows = p.fashionEntries,
    first = Math.max(0, Math.min(p.listScroll, Math.max(0, rows.length - 5)));
  for (let slot = 0; slot < 5; slot++) {
    const at = first + slot,
      row = rows[at],
      y = 64 + slot * 36,
      active = at === p.selected;
    rounded(g, 8, y, 112, 33, active ? 0x1b5360 : 0x102f39, active ? 0xf2c862 : 0x315d69);
    if (row) {
      label(
        g,
        a.font,
        row.record ? fashionLabel(row.record).slice(0, 13) : fashionName(row.key).slice(0, 13),
        14,
        y + 5,
        active ? 0xffffff : 0xb9dcda,
      );
      label(
        g,
        a.font,
        p.wardrobeSource.owned(row.key) ? "Đã có" : `${row.tierInfo?.exchangeFragments ?? 0} mảnh`,
        14,
        y + 19,
        tierColor(row.tier),
      );
    }
  }
  const current = rows[p.selected];
  rounded(g, 128, 64, 104, 154, 0x0d2c36, tierColor(current?.tier), 8);
  if (current) {
    label(
      g,
      a.font,
      current.record ? fashionLabel(current.record) : fashionName(current.key),
      134,
      74,
    );
    g.fillStyle = "#153d47";
    g.beginPath();
    g.ellipse(180, 123, 34, 34, 0, 0, Math.PI * 2);
    g.fill();
    if (current.record?.kind === "cau-vong") {
      const rainbow = a.rainbowPreview(current.record.key);
      if (rainbow?.complete && rainbow.naturalWidth) g.drawImage(rainbow, 134, 84, 92, 122);
    } else if (current.record) {
      const frame = a.preview(
        current.record.resourceId,
        current.record.animationBase,
        p.openedTicks,
      );
      if (frame) {
        g.save();
        g.beginPath();
        g.rect(132, 82, 96, 128);
        g.clip();
        g.drawImage(frame.image, 180 + frame.ox, 190 + frame.oy);
        g.restore();
      }
    }
    label(g, a.font, current.tierInfo?.label ?? current.tier, 151, 197, tierColor(current.tier));
  }
  const exchangeEnabled = !!current && !p.wardrobeSource.owned(current.key);
  rounded(
    g,
    128,
    226,
    104,
    30,
    exchangeEnabled ? 0x1b5360 : 0x263e44,
    exchangeEnabled ? 0xf2c862 : 0x718489,
    6,
  );
  label(
    g,
    a.font,
    exchangeEnabled ? `Đổi ${current?.tierInfo?.exchangeFragments ?? 0} mảnh` : "Đã sở hữu",
    139,
    234,
    exchangeEnabled ? 0xffffff : 0x9aa6a8,
  );
  label(g, a.font, `Mảnh: ${p.wardrobeSource.fragments()}`, 150, 262, 0xbde8d7);
  soft(g, a, "Chọn đổi", "Quay lại");
  if (confirmMode) {
    rounded(g, 34, 75, 172, 158, 0x102f39, 0xf2c862);
    label(g, a.font, "Xác nhận đổi", 72, 83);
    label(
      g,
      a.font,
      current
        ? current.record
          ? fashionLabel(current.record)
          : fashionName(current.key)
        : "Trang phục",
      58,
      125,
      0xffdc83,
    );
    label(g, a.font, `Dùng ${current?.tierInfo?.exchangeFragments ?? 0} mảnh`, 72, 151, 0xe7f5f2);
    rounded(g, 42, 196, 156, 32, 0x286e99, 0xf2c862);
    label(g, a.font, "Đổi trang phục", 76, 205);
    soft(g, a, "Đổi", "Hủy");
  }
}
function reveal(g: CanvasRenderingContext2D, p: WorldPanel, a: FashionShopArt) {
  const r = p.fashionReveal,
    anim = p.openedTicks < 24 && !r?.exchange;
  backdrop(g, p, a, anim ? "Mở túi mù" : (r?.title ?? "Trang phục"));
  if (anim) {
    const d = [4, 2, 2, 2, 1, 2, 2, 3, 6];
    let remain = p.openedTicks,
      frame = 0;
    while (frame < 8 && remain >= d[frame]) remain -= d[frame++];
    if (a.openSheet.complete && a.openSheet.naturalWidth)
      g.drawImage(
        a.openSheet,
        (frame % 3) * 128,
        Math.trunc(frame / 3) * 128,
        128,
        128,
        56,
        76,
        128,
        128,
      );
    soft(g, a, "Bỏ qua", "");
    return;
  }
  const record = p.wardrobeRows.find((x) => x.key === r?.key);
  rounded(g, 50, 72, 140, 145, 0x153d47, tierColor(r?.tier));
  if (record) {
    const rainbow = record.kind === "cau-vong" ? a.rainbowPreview(record.key) : undefined,
      f =
        record.kind === "cau-vong"
          ? undefined
          : a.preview(record.resourceId, record.animationBase, p.openedTicks);
    if (rainbow?.complete && rainbow.naturalWidth) g.drawImage(rainbow, 68, 78, 104, 130);
    else if (f) g.drawImage(f.image, 118 + f.ox, 170 + f.oy);
    label(g, a.font, fashionLabel(record), 72, 181);
  }
  label(g, a.font, r?.detail ?? "", 32, 229, 0xffdc83);
  soft(g, a, "Tiếp tục", "");
}
export function drawFashionShop(g: CanvasRenderingContext2D, p: WorldPanel, a: FashionShopArt) {
  if (p.mode === "fashionShop") shop(g, p, a);
  else if (p.mode === "fashionBuyConfirm") confirm(g, p, a, false);
  else if (p.mode === "fashionOpenConfirm") confirm(g, p, a, true);
  else if (p.mode === "fashionExchange" || p.mode === "fashionExchangeConfirm")
    exchange(g, p, a, p.mode === "fashionExchangeConfirm");
  else if (p.mode === "fashionReveal") reveal(g, p, a);
}
