/**
 * Landscape: the on-screen joystick and A/B float over the map's bottom corners. A player who plays
 * by tapping alone (the phone laid down, one finger) hides them so the whole map takes taps: the
 * hero walks to a tapped spot and speaks to a tapped NPC (`WorldRuntime` tap walk). The choice is
 * kept on this device.
 */
const KEY = "vqsv.padHidden";

const PAD_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="7" cy="14" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17" cy="11" r="2" fill="currentColor"/><circle cx="19" cy="16" r="2" fill="currentColor"/></svg>';
const HIDDEN_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="7" cy="14" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17" cy="11" r="2" fill="currentColor"/><circle cx="19" cy="16" r="2" fill="currentColor"/><path d="M3 3l18 18" stroke="currentColor" stroke-width="2"/></svg>';

function readHidden(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function writeHidden(hidden: boolean): void {
  try {
    localStorage.setItem(KEY, hidden ? "1" : "0");
  } catch {
    // Private mode: the choice lasts for this visit only.
  }
}

export function mountPadToggle(app: HTMLElement, onChange: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.id = "pad-toggle";
  const paint = (): void => {
    const hidden = app.classList.contains("pad-hidden");
    button.innerHTML = hidden ? HIDDEN_ICON : PAD_ICON;
    const label = hidden ? "Hiện nút điều khiển" : "Ẩn nút điều khiển (chơi bằng chạm)";
    button.setAttribute("aria-label", label);
    button.title = label;
  };
  app.classList.toggle("pad-hidden", readHidden());
  button.addEventListener("click", () => {
    const hidden = !app.classList.contains("pad-hidden");
    app.classList.toggle("pad-hidden", hidden);
    writeHidden(hidden);
    paint();
    onChange();
  });
  // Keep the game keyboard and the pad from seeing this press.
  button.addEventListener("pointerdown", (event) => event.stopPropagation());
  paint();
  app.append(button);
  return button;
}
