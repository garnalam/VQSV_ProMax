/**
 * Drawings of the Safari screens a player taps through to put the game on the home screen, one
 * per step, each with a glowing ring and a bobbing arrow on the button to press. They are plain
 * SVG strings (no photos of the real UI): cropped close-ups, so they stay readable in a short
 * landscape card as well as a tall portrait one.
 */

const HL = "#ff8c3f";
const BLUE = "#0a84ff";
const FONT = `font-family="-apple-system, system-ui, 'Segoe UI', Roboto, sans-serif"`;

const escape = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const svg = (body: string): string =>
  `<svg viewBox="0 0 320 180" xmlns="http://www.w3.org/2000/svg" ${FONT} aria-hidden="true">${body}</svg>`;

/** An arrow whose tip sits on (x, y); `dir` is where it points. */
function arrow(x: number, y: number, dir: "down" | "up" | "left" | "right"): string {
  const turn = { down: 0, up: 180, left: 90, right: -90 }[dir];
  return `<g transform="translate(${x} ${y}) rotate(${turn})"><g class="ig-bob"><path d="M0 0 L-10 -14 H-4.5 V-32 H4.5 V-14 H10 Z" fill="${HL}" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/></g></g>`;
}

/** A steady ring plus a copy that swells and fades, round a circular button. */
const ring = (cx: number, cy: number, r: number): string =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${HL}" stroke-width="3"/><circle class="ig-pulse" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${HL}" stroke-width="3"/>`;

/** The same round a rectangle (a menu row, a word button, an icon). */
const box = (x: number, y: number, w: number, h: number, rx = 8): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="none" stroke="${HL}" stroke-width="3"/><rect class="ig-pulse" x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="none" stroke="${HL}" stroke-width="3"/>`;

function shareIcon(cx: number, cy: number, color = BLUE, scale = 1.15): string {
  return `<g transform="translate(${cx} ${cy}) scale(${scale}) translate(-12 -12)"><path d="M8.5 10H6.5v10.5h11V10h-2M12 3.5v11M8.5 7L12 3.5 15.5 7" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}

const plusSquare = (cx: number, cy: number): string =>
  `<g transform="translate(${cx - 9} ${cy - 9})"><rect x="1" y="1" width="16" height="16" rx="4" fill="none" stroke="#1c1c1e" stroke-width="1.6"/><path d="M9 5v8M5 9h8" stroke="#1c1c1e" stroke-width="1.6" stroke-linecap="round"/></g>`;

/** A blurred hint of the game page behind Safari's bars. */
const page = (y: number, h: number): string =>
  `<rect y="${y}" width="320" height="${h}" fill="#cfe6f2"/><text x="160" y="${y + h / 2 + 8}" text-anchor="middle" font-size="24" font-weight="800" fill="#a7c4d6">VQSV</text>`;

const chevron = (x: number, y: number, flip: boolean, color = BLUE): string =>
  `<path d="M${x + (flip ? -4 : 4)} ${y - 8} L${x + (flip ? 4 : -4)} ${y} L${x + (flip ? -4 : 4)} ${y + 8}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;

/** Safari up to iOS 18 on iPhone: the share button in the middle of the bottom toolbar. */
export function bottomToolbar(): string {
  return svg(
    page(0, 124) +
      `<rect y="124" width="320" height="56" fill="#f7f7f9"/><line x1="0" x2="320" y1="124.5" y2="124.5" stroke="#c8c8cc"/>` +
      chevron(40, 150, false) +
      chevron(100, 150, true, "#c7c7cc") +
      shareIcon(160, 149) +
      `<path d="M210 142c4-2 8-2 10 0v16c-2-2-6-2-10 0zM220 142c2-2 6-2 10 0v16c-4-2-8-2-10 0z" fill="none" stroke="${BLUE}" stroke-width="1.7" stroke-linejoin="round"/>` +
      `<rect x="274" y="144" width="11" height="11" rx="2" fill="none" stroke="${BLUE}" stroke-width="1.7"/><path d="M278 141h7a3 3 0 0 1 3 3v7" fill="none" stroke="${BLUE}" stroke-width="1.7"/>` +
      ring(160, 149, 20) +
      arrow(160, 126, "down"),
  );
}

/** Safari 26 on iPhone: a floating bar whose "⋯" button holds Share. */
export function floatingBar(host: string): string {
  return svg(
    page(0, 180) +
      `<circle cx="36" cy="150" r="19" fill="#fff" stroke="#d8d8dc"/>` +
      chevron(36, 150, false, "#1c1c1e") +
      `<rect x="64" y="131" width="190" height="38" rx="19" fill="#fff" stroke="#d8d8dc"/>` +
      `<text x="159" y="155" text-anchor="middle" font-size="13" fill="#1c1c1e">${escape(host)}</text>` +
      `<circle cx="284" cy="150" r="19" fill="#fff" stroke="#d8d8dc"/>` +
      `<circle cx="276" cy="150" r="2.4" fill="#1c1c1e"/><circle cx="284" cy="150" r="2.4" fill="#1c1c1e"/><circle cx="292" cy="150" r="2.4" fill="#1c1c1e"/>` +
      ring(284, 150, 23) +
      arrow(284, 124, "down"),
  );
}

/** The menu that "⋯" opens in Safari 26, Share on top. */
export function moreMenu(): string {
  const rows = ["Chia sẻ", "Thêm dấu trang", "Thêm vào Mục ưa thích", "Tìm trên trang"];
  let list = "";
  rows.forEach((label, i) => {
    const y = 14 + i * 28;
    if (i > 0) list += `<line x1="128" x2="300" y1="${y}" y2="${y}" stroke="#e5e5ea"/>`;
    list += `<text x="136" y="${y + 19}" font-size="13" fill="#1c1c1e">${label}</text>`;
  });
  return svg(
    page(0, 180) +
      `<rect width="320" height="180" fill="rgba(0,0,0,0.12)"/>` +
      `<rect x="120" y="8" width="188" height="122" rx="14" fill="#fff"/>` +
      list +
      shareIcon(288, 27, "#1c1c1e", 0.9) +
      `<circle cx="290" cy="158" r="15" fill="#fff"/><circle cx="283" cy="158" r="2" fill="#1c1c1e"/><circle cx="290" cy="158" r="2" fill="#1c1c1e"/><circle cx="297" cy="158" r="2" fill="#1c1c1e"/>` +
      box(124, 13, 180, 29) +
      arrow(118, 27, "right"),
  );
}

/** iPad Safari and Chrome on iPhone: the share button at the top right. */
export function topToolbar(host: string): string {
  return svg(
    `<rect width="320" height="46" fill="#f7f7f9"/><line x1="0" x2="320" y1="46.5" y2="46.5" stroke="#c8c8cc"/>` +
      page(47, 133) +
      chevron(18, 23, false) +
      chevron(42, 23, true, "#c7c7cc") +
      `<rect x="62" y="9" width="150" height="28" rx="9" fill="#e9e9ee"/>` +
      `<text x="137" y="27.5" text-anchor="middle" font-size="12" fill="#3a3a3c">${escape(host)}</text>` +
      shareIcon(240, 22) +
      `<path d="M270 16v14M263 23h14" stroke="${BLUE}" stroke-width="1.8" stroke-linecap="round"/>` +
      `<rect x="291" y="17" width="11" height="11" rx="2" fill="none" stroke="${BLUE}" stroke-width="1.7"/><path d="M295 14h7a3 3 0 0 1 3 3v7" fill="none" stroke="${BLUE}" stroke-width="1.7"/>` +
      ring(240, 22, 18) +
      arrow(240, 44, "up"),
  );
}

/**
 * The share sheet as newer iPhones first open it: the page, a row of apps and a short action
 * list ending in "Xem thêm", which unfolds the full list holding "Thêm vào MH chính".
 */
export function shareSheetMore(host: string): string {
  const apps: [string, string][] = [
    ["AirDrop", "#0a84ff"],
    ["Tin nhắn", "#34c759"],
    ["Mail", "#1e90ff"],
    ["Ghi chú", "#ffcc00"],
  ];
  let row = "";
  apps.forEach(([label, color], i) => {
    const x = 56 + i * 62;
    row += `<circle cx="${x}" cy="62" r="13" fill="${color}"/>`;
    row += `<text x="${x}" y="87" text-anchor="middle" font-size="9" fill="#3a3a3c">${label}</text>`;
  });
  const actions = ["Sao chép", "Thêm dấu trang", "Xem thêm"];
  let list = "";
  actions.forEach((label, i) => {
    const y = 94 + i * 26;
    if (i > 0) list += `<line x1="36" x2="248" y1="${y}" y2="${y}" stroke="#e5e5ea"/>`;
    const bold = i === 2 ? ` font-weight="700"` : "";
    list += `<text x="36" y="${y + 18}" font-size="13" fill="#1c1c1e"${bold}>${label}</text>`;
  });
  return svg(
    `<rect width="320" height="180" fill="#8e939b"/>` +
      `<rect x="12" y="8" width="296" height="200" rx="16" fill="#f2f2f7"/>` +
      `<clipPath id="ig-sheet-clip"><rect x="26" y="16" width="24" height="24" rx="6"/></clipPath>` +
      `<image href="/apple-touch-icon.png" x="26" y="16" width="24" height="24" clip-path="url(#ig-sheet-clip)" style="image-rendering: pixelated"/>` +
      `<text x="58" y="27" font-size="12" font-weight="700" fill="#1c1c1e">VQSV</text>` +
      `<text x="58" y="40" font-size="10" fill="#8e8e93">${escape(host)}</text>` +
      row +
      `<rect x="24" y="94" width="236" height="78" rx="10" fill="#fff"/>` +
      list +
      `<circle cx="238" cy="159" r="9" fill="none" stroke="#1c1c1e" stroke-width="1.5"/><circle cx="234" cy="159" r="1.4" fill="#1c1c1e"/><circle cx="238" cy="159" r="1.4" fill="#1c1c1e"/><circle cx="242" cy="159" r="1.4" fill="#1c1c1e"/>` +
      box(26, 147, 232, 24) +
      arrow(266, 159, "left"),
  );
}

/** The share sheet's action list, "Thêm vào MH chính" picked out. */
export function shareSheet(): string {
  const rows = [
    "Sao chép",
    "Thêm vào danh sách đọc",
    "Thêm dấu trang",
    "Thêm vào MH chính",
    "Đánh dấu",
  ];
  let list = "";
  rows.forEach((label, i) => {
    const y = 26 + i * 30;
    if (i > 0) list += `<line x1="36" x2="248" y1="${y}" y2="${y}" stroke="#e5e5ea"/>`;
    const bold = i === 3 ? ` font-weight="700"` : "";
    list += `<text x="36" y="${y + 20}" font-size="13" fill="#1c1c1e"${bold}>${label}</text>`;
  });
  return svg(
    `<rect width="320" height="180" fill="#8e939b"/>` +
      `<rect x="12" y="10" width="296" height="200" rx="16" fill="#f2f2f7"/>` +
      `<rect x="24" y="26" width="236" height="160" rx="10" fill="#fff"/>` +
      list +
      plusSquare(238, 131) +
      `<rect x="24" y="168" width="236" height="12" fill="url(#ig-fade)"/>` +
      `<defs><linearGradient id="ig-fade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient></defs>` +
      box(26, 117, 232, 28) +
      arrow(266, 131, "left"),
  );
}

/** The "Thêm vào MH chính" sheet; Safari 26 adds the "open as web app" switch. */
export function addSheet(host: string, webAppSwitch: boolean): string {
  const toggle = webAppSwitch
    ? `<rect x="16" y="124" width="288" height="40" rx="10" fill="#fff"/>` +
      `<text x="28" y="148" font-size="12.5" fill="#1c1c1e">Mở dưới dạng ứng dụng web</text>` +
      `<rect x="250" y="132" width="42" height="24" rx="12" fill="#34c759"/><circle cx="280" cy="144" r="10" fill="#fff"/>` +
      box(246, 128, 50, 32, 16)
    : "";
  return svg(
    `<rect width="320" height="180" fill="#f2f2f7"/>` +
      `<text x="18" y="28" font-size="14" fill="${BLUE}">Hủy</text>` +
      `<text x="138" y="28" text-anchor="middle" font-size="14" font-weight="700" fill="#1c1c1e">Thêm vào MH chính</text>` +
      `<text x="300" y="28" text-anchor="end" font-size="14" font-weight="700" fill="${BLUE}">Thêm</text>` +
      `<rect x="16" y="48" width="288" height="66" rx="10" fill="#fff"/>` +
      `<clipPath id="ig-icon-clip"><rect x="26" y="57" width="48" height="48" rx="11"/></clipPath>` +
      `<image href="/apple-touch-icon.png" x="26" y="57" width="48" height="48" clip-path="url(#ig-icon-clip)" style="image-rendering: pixelated"/>` +
      `<text x="88" y="78" font-size="14" fill="#1c1c1e">VQSV</text><line x1="88" x2="292" y1="84" y2="84" stroke="#e5e5ea"/>` +
      `<text x="88" y="100" font-size="11" fill="#8e8e93">${escape(host)}</text>` +
      toggle +
      box(258, 10, 50, 26) +
      arrow(254, 23, "right"),
  );
}

/** The home screen afterwards, the VQSV icon among the player's apps. */
export function homeScreen(): string {
  const colors = ["#5ac8fa", "#ffcc00", "#34c759", "#ff9500", "#af52de", "#ff2d55", "#8e8e93"];
  let icons = "";
  let n = 0;
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 4; col++) {
      const x = 34 + col * 72,
        y = 22 + row * 76;
      if (row === 0 && col === 1) {
        icons +=
          `<clipPath id="ig-home-clip"><rect x="${x}" y="${y}" width="48" height="48" rx="12"/></clipPath>` +
          `<image href="/apple-touch-icon.png" x="${x}" y="${y}" width="48" height="48" clip-path="url(#ig-home-clip)" style="image-rendering: pixelated"/>` +
          `<text x="${x + 24}" y="${y + 63}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">VQSV</text>` +
          box(x - 4, y - 4, 56, 56, 15);
        continue;
      }
      icons += `<rect x="${x}" y="${y}" width="48" height="48" rx="12" fill="${colors[n++ % colors.length]}" opacity="0.85"/>`;
      icons += `<rect x="${x + 6}" y="${y + 58}" width="36" height="6" rx="3" fill="rgba(255,255,255,0.6)"/>`;
    }
  return svg(
    `<defs><linearGradient id="ig-wall" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#3a6ea5"/><stop offset="1" stop-color="#36b3a8"/></linearGradient></defs>` +
      `<rect width="320" height="180" fill="url(#ig-wall)"/>` +
      icons,
  );
}
