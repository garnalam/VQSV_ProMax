import { TextEntryProxy } from "../core/input/TextEntryProxy";
import { TouchGamepad } from "../core/input/TouchGamepad";
import type { InputState } from "../core/input/InputState";
import { enterFullscreenOnFirstGesture, mountFullscreenButton } from "./FullscreenButton";
import { mountPadToggle } from "./PadToggle";
import { fitStage, liveArea } from "./StageLayout";
import { useLandscape } from "../core/Viewport";

/**
 * The page around the canvas: sizes the game box for the window (`StageLayout`), shows the
 * on-screen gamepad on touch screens and opens the phone keyboard for text fields. Nothing here
 * runs inside the game tick; it only presses keys on the `InputState`.
 */
export function mountPageShell(options: {
  app: HTMLElement;
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
  padLeft: HTMLElement;
  padRight: HTMLElement;
  input: InputState;
  textEntryActive: () => boolean;
}): void {
  const { app, stage, canvas, input } = options;
  // A touch screen shows the pad from the start; a laptop with a touch screen shows it after the
  // first touch, and a mouse never turns it off again (both may be in use).
  let touch = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const gamepad = new TouchGamepad(input, options.padLeft, options.padRight),
    keyboard = new TextEntryProxy(input);
  mountFullscreenButton(app);
  mountPadToggle(app, () => gamepad.releaseAll());
  enterFullscreenOnFirstGesture();

  // What the last layout was measured from: a change seen on any frame lays the page out again, so
  // a resize the browser never announced (iOS after returning from another app) still lands.
  let measured = "";
  const windowSize = (): { width: number; height: number } => ({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const layout = (): void => {
    const outer = windowSize(),
      // A home-screen app on iOS may keep `100dvh` from the old orientation: size the body from the
      // window itself (the CSS falls back to `100dvh` until this runs).
      appHeight = outer.height > 0 ? `${outer.height}px` : "",
      root = document.documentElement.style;
    if (root.getPropertyValue("--app-height") !== appHeight)
      root.setProperty("--app-height", appHeight);
    measured = `${outer.width}x${outer.height}`;
    const style = getComputedStyle(app),
      area = liveArea({ width: app.clientWidth, height: app.clientHeight }, outer),
      width = area.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      height = area.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      fit = width > 0 && height > 0 ? fitStage(width, height, touch) : null;
    // A hidden or minimised page measures 0x0: keep the last layout instead of a 320-wide speck.
    if (!fit) return;
    // The canvas takes the window's shape (the next frame resizes it: `CanvasRenderer.setScale`).
    useLandscape(fit.viewWidth);
    app.dataset.layout = fit.mode;
    stage.style.width = `${fit.width}px`;
    stage.style.height = `${fit.height}px`;
  };
  layout();
  window.addEventListener("resize", layout);
  window.visualViewport?.addEventListener("resize", layout);
  window.addEventListener("orientationchange", layout);
  screen.orientation?.addEventListener?.("change", layout);
  // Coming back from another app: iOS settles the window size a moment after the page shows, so
  // lay out now and again over the next second and a half.
  const settle = (): void => {
    if (document.visibilityState === "hidden") return;
    layout();
    for (const delay of [100, 300, 700, 1500]) window.setTimeout(layout, delay);
  };
  document.addEventListener("visibilitychange", settle);
  window.addEventListener("pageshow", settle);
  window.addEventListener("focus", settle);

  window.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType !== "touch" || touch) return;
      touch = true;
      layout();
    },
    { capture: true },
  );
  // iOS opens the keyboard only from a gesture: a tap on the game while the field is open.
  canvas.addEventListener("pointerdown", () => {
    if (touch && options.textEntryActive()) keyboard.open();
  });
  const follow = (): void => {
    keyboard.sync(touch && options.textEntryActive());
    const outer = windowSize();
    if (`${outer.width}x${outer.height}` !== measured) layout();
    requestAnimationFrame(follow);
  };
  requestAnimationFrame(follow);
  window.addEventListener("pagehide", () => gamepad.releaseAll());
  // A touch held while the player left never sends its pointerup: let go on the way back too.
  window.addEventListener("pageshow", () => gamepad.releaseAll());
}
