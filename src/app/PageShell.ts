import { TextEntryProxy } from "../core/input/TextEntryProxy";
import { TouchGamepad } from "../core/input/TouchGamepad";
import type { InputState } from "../core/input/InputState";
import { mountFullscreenButton } from "./FullscreenButton";
import { fitStage } from "./StageLayout";

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

  const layout = (): void => {
    const style = getComputedStyle(app),
      width = app.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      height = app.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      fit = fitStage(width, height, touch);
    app.dataset.layout = fit.mode;
    stage.style.width = `${fit.width}px`;
    stage.style.height = `${fit.height}px`;
  };
  layout();
  window.addEventListener("resize", layout);
  window.visualViewport?.addEventListener("resize", layout);

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
    requestAnimationFrame(follow);
  };
  requestAnimationFrame(follow);
  window.addEventListener("pagehide", () => gamepad.releaseAll());
}
