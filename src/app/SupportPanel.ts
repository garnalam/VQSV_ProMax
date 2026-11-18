/**
 * Web only (owner, 2026-11-18): the "Ủng hộ" button beside the game. Support is voluntary and pays
 * for the server; nothing is sold. The panel shows a QR for the owner's MoMo fund that already
 * carries this player's transfer note (`VQSV <code>`), so scanning it fills the note in; the
 * fund's own poster (`/donate-qr.webp`) stays one tap away. An admin reads the transfers, finds
 * the player by the code on the admin page, and sends "Lượng" by hand from the mailbox.
 */
import { qrCanvas } from "./QrCode";

export const SUPPORT_QR_URL = "/donate-qr.webp";
export const LUONG_ICON_URL = "/luong.png";

/** The fund's VietQR string, read from the owner's poster (MoMo "Quỹ Phát Triển VQSV"). */
export const SUPPORT_VIETQR =
  "00020101021138630010A000000727013300069710250119PSG26322128000000420208QRIBFTTA53037045802VN62560334mp_42671155_7qefqqvnmn5t4nwd9c845z0514MM_fund_detail630416A5";

/** A player's short code: the account id's first 8 hex digits. Banks keep it, unlike an email. */
export function supportCode(accountId: string): string {
  return accountId
    .replace(/[^0-9a-f]/gi, "")
    .slice(0, 8)
    .toUpperCase();
}

/** The note a supporter's transfer carries, so the admin knows which account to thank. */
export function supportTransferNote(accountId: string): string {
  return `VQSV ${supportCode(accountId)}`;
}

/** EMVCo CRC-16/CCITT-FALSE, as 4 upper-case hex digits. */
export function emvCrc(text: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte << 8;
    for (let k = 0; k < 8; k++)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function readTlv(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i + 4 <= text.length;) {
    const id = text.slice(i, i + 2),
      length = Number(text.slice(i + 2, i + 4));
    out.push([id, text.slice(i + 4, i + 4 + length)]);
    i += 4 + length;
  }
  return out;
}

const tlv = (id: string, value: string) => id + String(value.length).padStart(2, "0") + value;

/**
 * `vietQr` with the transfer note in its additional data (field 62, sub-field 08, "purpose of
 * transaction"), which bank and wallet apps fill in when they scan it; the CRC is recomputed.
 */
export function vietQrWithNote(vietQr: string, note: string): string {
  let body = "";
  let hasAdditional = false;
  for (const [id, value] of readTlv(vietQr)) {
    if (id === "63") continue;
    if (id === "62") {
      hasAdditional = true;
      const kept = readTlv(value).filter(([sub]) => sub !== "08");
      body += tlv("62", kept.map(([a, b]) => tlv(a, b)).join("") + tlv("08", note));
    } else body += tlv(id, value);
  }
  if (!hasAdditional) body += tlv("62", tlv("08", note));
  body += "6304";
  return body + emvCrc(body);
}

export type DonateRate = { vnd: number; luong: number };

/** "10.000đ → 10 Lượng". */
export const donateRateText = (rate: DonateRate) =>
  `${rate.vnd.toLocaleString("vi-VN")}đ → ${rate.luong.toLocaleString("vi-VN")} Lượng`;

export class SupportPanel {
  readonly button: HTMLButtonElement;
  private readonly root: HTMLDivElement;
  private readonly wallet: HTMLSpanElement;
  private readonly note: HTMLElement;
  private readonly qrBox: HTMLDivElement;
  private readonly save: HTMLAnchorElement;
  private drawnFor = "";
  private readonly rateList: HTMLUListElement;

  constructor(
    parent: HTMLElement,
    private readonly accountId: () => string | null,
    private readonly luong: () => number | null,
    private readonly rates: () => Promise<DonateRate[]> = async () => [],
  ) {
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.id = "support";
    this.button.title = "Ủng hộ server";
    this.button.setAttribute("aria-label", "Ủng hộ server");
    const icon = document.createElement("img");
    icon.src = LUONG_ICON_URL;
    icon.alt = "";
    this.button.append(icon);
    this.button.hidden = true;
    this.button.addEventListener("pointerdown", (event) => event.stopPropagation());
    this.button.addEventListener("click", () => this.show());
    parent.append(this.button);

    this.root = document.createElement("div");
    this.root.id = "support-panel";
    this.root.hidden = true;
    const panel = document.createElement("div");
    panel.className = "support-box";
    const head = document.createElement("div");
    head.className = "support-head";
    const title = document.createElement("h2");
    title.textContent = "Ủng hộ server";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "support-close";
    close.textContent = "✕";
    close.setAttribute("aria-label", "Đóng");
    close.addEventListener("click", () => this.hide());
    this.closeButton = close;
    head.append(title, close);

    const walletLine = document.createElement("p");
    walletLine.className = "support-wallet";
    const walletIcon = document.createElement("img");
    walletIcon.src = LUONG_ICON_URL;
    walletIcon.alt = "";
    this.wallet = document.createElement("span");
    walletLine.append(walletIcon, this.wallet);

    const rateTitle = document.createElement("p");
    rateTitle.className = "support-rate-title";
    rateTitle.textContent = "Bảng quy đổi:";
    this.rateList = document.createElement("ul");
    this.rateList.className = "support-rates";

    const scanLabel = document.createElement("p");
    scanLabel.className = "support-hint";
    scanLabel.textContent =
      "Quét bằng MoMo hoặc app ngân hàng: nội dung chuyển khoản đã có sẵn trong mã.";
    this.qrBox = document.createElement("div");
    this.qrBox.className = "support-qr-box";

    // On the phone that plays, the QR cannot be scanned: save it, then open it from MoMo.
    const actions = document.createElement("div");
    actions.className = "support-actions";
    this.save = document.createElement("a");
    this.save.className = "support-copy";
    this.save.textContent = "Lưu mã QR";
    this.save.download = "vqsv-ung-ho.png";
    const poster = document.createElement("a");
    poster.className = "support-link";
    poster.href = SUPPORT_QR_URL;
    poster.target = "_blank";
    poster.rel = "noopener";
    poster.textContent = "Ảnh QR gốc của Quỹ";
    actions.append(this.save, poster);

    const noteLabel = document.createElement("p");
    noteLabel.textContent = "Nếu app không tự điền, hãy ghi nội dung này:";
    this.note = document.createElement("code");
    this.note.className = "support-note";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "support-copy";
    copy.textContent = "Sao chép";
    copy.addEventListener("click", () => {
      const text = this.note.textContent ?? "";
      void navigator.clipboard?.writeText(text).then(
        () => (copy.textContent = "Đã chép"),
        () => {},
      );
    });
    const noteRow = document.createElement("div");
    noteRow.className = "support-note-row";
    noteRow.append(this.note, copy);

    const info = document.createElement("p");
    info.className = "support-info";
    info.textContent =
      "Ủng hộ là tự nguyện, để trả chi phí server. Không mua bán vật phẩm. Sau khi nhận được, admin sẽ gửi Lượng cảm ơn vào hộp quà của bạn.";

    panel.append(
      head,
      walletLine,
      rateTitle,
      this.rateList,
      scanLabel,
      this.qrBox,
      actions,
      noteLabel,
      noteRow,
      info,
    );
    this.root.append(panel);
    this.root.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      if (event.target === this.root) this.hide();
    });
    // The game listens to the keyboard: keep its keys out while the panel is open.
    this.root.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") this.hide();
    });
    document.body.append(this.root);
  }

  /** Shown while an account plays. */
  setVisible(visible: boolean): void {
    this.button.hidden = !visible;
    if (!visible) this.hide();
  }

  private closeButton?: HTMLButtonElement;

  show(): void {
    const id = this.accountId();
    const note = id ? supportTransferNote(id) : "VQSV";
    this.note.textContent = note;
    if (this.drawnFor !== note) {
      this.drawnFor = note;
      const canvas = qrCanvas(vietQrWithNote(SUPPORT_VIETQR, note), 6);
      canvas.className = "support-qr";
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `Mã QR ủng hộ, nội dung ${note}`);
      this.qrBox.replaceChildren(canvas);
      this.save.href = canvas.toDataURL("image/png");
    }
    const luong = this.luong();
    this.wallet.textContent = `Ví Lượng: ${luong === null ? "—" : luong.toLocaleString("vi-VN")}`;
    this.root.hidden = false;
    // Opened from a merchant by a key press: hold focus so game keys stop at the panel.
    this.closeButton?.focus({ preventScroll: true });
    this.rateList.replaceChildren(this.rateItem("Đang tải…"));
    this.rates().then(
      (rates) =>
        this.rateList.replaceChildren(
          ...(rates.length
            ? rates.map((rate) => this.rateItem(donateRateText(rate)))
            : [this.rateItem("Chưa có bảng quy đổi.")]),
        ),
      () => this.rateList.replaceChildren(this.rateItem("Không tải được bảng quy đổi.")),
    );
  }

  private rateItem(text: string): HTMLLIElement {
    const item = document.createElement("li");
    item.textContent = text;
    return item;
  }

  hide(): void {
    this.root.hidden = true;
  }
}
