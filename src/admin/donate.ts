/**
 * Web only (owner, 2026-11-18): the admin page's "Nạp tiền" view. The support rates the in-game
 * "Ủng hộ" panel lists, and a quick thank-you: find the player by the transfer note
 * ("VQSV 1A2B3C4D"), type the amount received, and the Lượng the rates give goes out by mail.
 */
import { el, number } from "./dom";

export type DonateRate = { vnd: number; luong: number };

/**
 * The Lượng an amount earns: an exact row's Lượng, else the best row at or under the amount,
 * scaled to it (rounded down); 0 under the smallest row.
 */
export function luongForAmount(rates: readonly DonateRate[], vnd: number): number {
  const exact = rates.find((rate) => rate.vnd === vnd);
  if (exact) return exact.luong;
  let best = 0;
  for (const rate of rates)
    if (rate.vnd <= vnd) best = Math.max(best, Math.floor((vnd * rate.luong) / rate.vnd));
  return best;
}

type Api = (path: string, init?: { method?: string; json?: unknown }) => Promise<any>;
type Helpers = {
  api: Api;
  button: (label: string, action: () => unknown, className?: string) => HTMLButtonElement;
  message: (text: string, error?: boolean) => void;
  reload: () => unknown;
};

export async function donateView({ api, button, message, reload }: Helpers): Promise<HTMLElement> {
  const { rates }: { rates: DonateRate[] } = await api("/admin/donate");

  // ---- the rates
  const rows = el("div", { className: "stack" });
  const lines: { vnd: HTMLInputElement; luong: HTMLInputElement; line: HTMLElement }[] = [];
  const addLine = (rate?: DonateRate) => {
    if (lines.length >= 10) return;
    const vnd = el("input", { type: "number", min: "1000", step: "1000", value: rate ? String(rate.vnd) : "", placeholder: "Số tiền (đ)" });
    const luong = el("input", { type: "number", min: "1", value: rate ? String(rate.luong) : "", placeholder: "Lượng" });
    const entry = { vnd, luong, line: el("div", { className: "row" }) };
    entry.line.append(
      vnd,
      el("span", {}, "đ  →"),
      luong,
      el("span", {}, "Lượng"),
      button("Xóa", () => {
        lines.splice(lines.indexOf(entry), 1);
        entry.line.remove();
      }, "danger"),
    );
    lines.push(entry);
    rows.append(entry.line);
  };
  for (const rate of rates) addLine(rate);

  // ---- a quick thank-you
  const who = el("input", { type: "search", placeholder: "Mã ủng hộ (VQSV …) hoặc email" });
  const found = el("small", {}, "");
  const amount = el("input", { type: "number", min: "1000", step: "1000", placeholder: "Số tiền nhận (đ)" });
  const luong = el("input", { type: "number", min: "1", placeholder: "Lượng" });
  let target: { id: string; email: string } | null = null;
  who.onchange = async () => {
    target = null;
    found.textContent = "Đang tìm…";
    const { users }: { users: { id: string; email: string }[] } = await api(
      "/admin/users?" + new URLSearchParams({ q: who.value.trim().toLowerCase() }),
    );
    if (users.length === 1) {
      target = users[0];
      found.textContent = "Người nhận: " + target.email;
    } else found.textContent = users.length ? `Có ${users.length} tài khoản khớp, hãy gõ đủ mã hoặc email.` : "Không tìm thấy tài khoản.";
  };
  amount.oninput = () => {
    const value = Math.trunc(Number(amount.value) || 0);
    luong.value = value > 0 ? String(luongForAmount(rates, value) || "") : "";
  };

  return el(
    "div",
    { className: "stack" },
    el("h1", {}, "Nạp tiền"),
    el(
      "div",
      { className: "card stack" },
      el("h2", {}, "Tỷ giá ủng hộ"),
      el("p", {}, "Bảng này hiện trong game, ở bảng \"Ủng hộ server\" và mục Donate của các NPC bán vật phẩm. Người chơi mở lại bảng là thấy tỷ giá mới."),
      rows,
      el(
        "div",
        { className: "row" },
        button("Thêm dòng", () => addLine()),
        button("Lưu tỷ giá", async () => {
          const value = lines.map((line) => ({ vnd: Math.trunc(Number(line.vnd.value)), luong: Math.trunc(Number(line.luong.value)) }));
          await api("/admin/donate", { method: "PUT", json: { rates: value } });
          message("Đã lưu tỷ giá.");
          await reload();
        }, "primary"),
      ),
    ),
    el(
      "div",
      { className: "card stack" },
      el("h2", {}, "Cộng Lượng cho người ủng hộ"),
      el("p", {}, "Xem lịch sử nhận tiền của Quỹ MoMo, dán nội dung chuyển khoản (VD: VQSV E046445F) vào ô dưới rồi nhấn Enter, nhập số tiền nhận được. Lượng tự tính theo tỷ giá (sửa được), gửi vào hộp quà của người chơi."),
      el("div", { className: "row" }, who, found),
      el("div", { className: "row" }, amount, el("span", {}, "đ  →"), luong, el("span", {}, "Lượng")),
      button("Gửi Lượng", async () => {
        if (!target) throw new Error("Chưa tìm thấy người nhận: dán mã VQSV rồi nhấn Enter.");
        const value = Math.trunc(Number(luong.value) || 0),
          money = Math.trunc(Number(amount.value) || 0);
        if (value < 1) throw new Error("Nhập số Lượng.");
        if (!confirm(`Gửi ${number.format(value)} Lượng cho ${target.email}?`)) return;
        await api("/admin/mail", {
          method: "POST",
          json: {
            target: target.id,
            title: "Cảm ơn bạn đã ủng hộ",
            body: money > 0 ? `Đã nhận ${number.format(money)}đ ủng hộ server. Cảm ơn bạn!` : "Cảm ơn bạn đã ủng hộ server!",
            rewards: { money: 0, badges: 0, luong: value, items: [], pets: [] },
          },
        });
        message(`Đã gửi ${number.format(value)} Lượng cho ${target.email}.`);
        await reload();
      }, "primary"),
    ),
  );
}
