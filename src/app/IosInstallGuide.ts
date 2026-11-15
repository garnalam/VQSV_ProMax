import {
  addSheet,
  bottomToolbar,
  floatingBar,
  homeScreen,
  moreMenu,
  shareSheet,
  shareSheetMore,
  topToolbar,
} from "./IosInstallFigures";

/**
 * The picture guide for putting the game on an iPhone / iPad home screen. Apple gives pages no
 * install button, so the player has to tap through Safari themselves; each step shows a drawing of
 * the screen they will see with the button to press ringed and pointed at. On the first step a
 * phone held upright also gets an arrow at the bottom edge of the page, right above the real
 * Safari button.
 *
 * Safari moved Share: up to iOS 18 it sits in the middle of the bottom toolbar; from Safari 26
 * it hides behind the "⋯" button at the bottom right; on iPad (and Chrome on iPhone) it is at the
 * top right.
 */

export type IosFlavor = "toolbar" | "floating" | "top";

type Step = { figure: string; text: string };

export function iosFlavor(ua = navigator.userAgent): IosFlavor {
  if (!/iPhone|iPod/.test(ua) || /CriOS|FxiOS|EdgiOS/.test(ua)) return "top";
  const safari = Number(/Version\/(\d+)/.exec(ua)?.[1] ?? 0);
  return safari >= 26 ? "floating" : "toolbar";
}

export function iosSteps(flavor: IosFlavor, host = location.host): Step[] {
  const add = "Kéo danh sách xuống, chọn <b>Thêm vào MH chính</b>.";
  const done = {
    figure: homeScreen(),
    text: "Xong! Từ giờ mở game bằng biểu tượng <b>VQSV</b> trên màn hình chính: chơi toàn màn hình, không cần vào web nữa.",
  };
  if (flavor === "floating")
    return [
      {
        figure: floatingBar(host),
        text: "Nhấn nút <b>⋯</b> ở góc dưới bên phải màn hình.",
      },
      { figure: moreMenu(), text: "Chọn <b>Chia sẻ</b>." },
      {
        figure: shareSheetMore(host),
        text: "Trong bảng Chia sẻ, nhấn <b>Xem thêm</b> ở cuối danh sách để mở hết các mục.",
      },
      { figure: shareSheet(), text: add },
      {
        figure: addSheet(host, true),
        text: "Bật <b>Mở dưới dạng ứng dụng web</b>, rồi nhấn <b>Thêm</b> ở góc trên bên phải.",
      },
      done,
    ];
  return [
    flavor === "top"
      ? {
          figure: topToolbar(host),
          text: "Nhấn nút <b>Chia sẻ</b> (ô vuông có mũi tên lên) ở góc trên bên phải.",
        }
      : {
          figure: bottomToolbar(),
          text: "Nhấn nút <b>Chia sẻ</b> (ô vuông có mũi tên lên) ở giữa thanh dưới cùng. Không thấy thanh thì chạm nhẹ vào mép dưới màn hình.",
        },
    { figure: shareSheet(), text: add },
    { figure: addSheet(host, false), text: "Nhấn <b>Thêm</b> ở góc trên bên phải." },
    done,
  ];
}

const CLOSE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>`;
const DOWN = `<svg viewBox="0 0 24 32" aria-hidden="true"><path d="M12 31 L2 17 H8 V1 H16 V17 H22 Z" fill="#ff8c3f" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>`;

export function showIosInstallGuide(flavor = iosFlavor()): void {
  document.getElementById("ios-install")?.remove();
  const steps = iosSteps(flavor);
  const root = document.createElement("div");
  root.id = "ios-install";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Thêm game vào màn hình chính");
  root.innerHTML = `
    <div class="ig-card">
      <button type="button" class="ig-close" aria-label="Đóng">${CLOSE}</button>
      <div class="ig-head"><span class="ig-step"></span><h2>Thêm VQSV vào màn hình chính</h2></div>
      <div class="ig-body">
        <div class="ig-figure"></div>
        <div class="ig-text">
          <p class="ig-caption"></p>
          <p class="ig-land-tip">Mẹo: dựng dọc máy để thấy rõ thanh công cụ của Safari.</p>
        </div>
      </div>
      <div class="ig-nav">
        <button type="button" class="secondary ig-back">Quay lại</button>
        <div class="ig-dots"></div>
        <button type="button" class="primary ig-next">Tiếp</button>
      </div>
    </div>
    <div class="ig-pointer" data-at="${flavor === "floating" ? "right" : "center"}"><span>Nút ở đây</span>${DOWN}</div>`;
  document.body.append(root);

  const $ = <T extends HTMLElement>(selector: string): T => root.querySelector<T>(selector)!;
  const dots = $(".ig-dots");
  dots.innerHTML = steps
    .map((_, i) => `<button type="button" aria-label="Bước ${i + 1}" data-step="${i}"></button>`)
    .join("");
  let index = 0;
  const show = (next: number): void => {
    index = Math.max(0, Math.min(steps.length - 1, next));
    const step = steps[index]!;
    $(".ig-step").textContent = `Bước ${index + 1}/${steps.length}`;
    $(".ig-figure").innerHTML = step.figure;
    $(".ig-caption").innerHTML = step.text;
    $<HTMLButtonElement>(".ig-back").disabled = index === 0;
    $(".ig-next").textContent = index === steps.length - 1 ? "Đã hiểu" : "Tiếp";
    dots.querySelectorAll("button").forEach((dot, i) => dot.classList.toggle("on", i === index));
    // The arrow over the real toolbar only means something on the step that taps it.
    $(".ig-pointer").hidden = !(index === 0 && flavor !== "top");
  };
  const close = (): void => root.remove();

  root.addEventListener("click", (event) => {
    const target = event.target as Element;
    if (target === root || target.closest(".ig-close")) close();
    else if (target.closest(".ig-back")) show(index - 1);
    else if (target.closest(".ig-next")) {
      if (index === steps.length - 1) close();
      else show(index + 1);
    } else {
      const dot = target.closest<HTMLElement>("[data-step]");
      if (dot) show(Number(dot.dataset.step));
    }
  });
  // Keys belong to the guide while it is open, not to the game behind it.
  root.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") close();
    else if (event.key === "ArrowRight") show(index + 1);
    else if (event.key === "ArrowLeft") show(index - 1);
  });
  root.addEventListener("keyup", (event) => event.stopPropagation());
  show(0);
  $<HTMLButtonElement>(".ig-next").focus({ preventScroll: true });
}
