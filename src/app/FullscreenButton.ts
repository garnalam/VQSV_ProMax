/**
 * The full-screen toggle beside the game. Entering full screen also locks the screen to the way the
 * phone is held right now (portrait or landscape), so tilting it mid-fight does not swap layouts;
 * leaving full screen unlocks it.
 *
 * Browser support decides what works, and the button never pretends otherwise:
 * - Android Chrome / Edge / Samsung Internet: full screen and the orientation lock both work.
 * - iPad Safari: full screen works; the lock is refused, so the screen keeps rotating.
 * - iPhone Safari: no full screen for pages at all, so the button is not shown. "Add to Home
 *   Screen" (the PWA step) is the way to play without the browser bars there.
 * - Desktop: full screen works; there is nothing to rotate.
 */

type FullscreenDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};
type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: "portrait" | "landscape") => Promise<void>;
};

const doc = document as FullscreenDocument;

export function fullscreenSupported(): boolean {
  return !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
}

function isFullscreen(): boolean {
  return !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

async function enter(): Promise<void> {
  const root = document.documentElement as FullscreenElement;
  if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: "hide" });
  else await root.webkitRequestFullscreen?.();
  const orientation = screen.orientation as LockableOrientation | undefined;
  if (!orientation?.lock) return;
  try {
    await orientation.lock(orientation.type.startsWith("portrait") ? "portrait" : "landscape");
  } catch {
    // iOS and desktop browsers refuse the lock; the game still plays, the screen just rotates.
  }
}

async function exit(): Promise<void> {
  try {
    screen.orientation?.unlock?.();
  } catch {
    // Nothing was locked.
  }
  if (doc.exitFullscreen) await doc.exitFullscreen();
  else await doc.webkitExitFullscreen?.();
}

const ENTER_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
const EXIT_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

/** Opened from the home screen (the manifest's `display`): already without browser bars. */
export function launchedAsApp(): boolean {
  return (
    window.matchMedia?.("(display-mode: fullscreen), (display-mode: standalone)").matches ?? false
  );
}

/**
 * Goes full screen on the player's first press, key or tap: a page may not do it on load, only
 * inside a gesture (`pointerup` / `keydown` / `click` count as one; `pointerdown` from a finger
 * does not). Once it worked, or the player left full screen by hand, it stops trying.
 */
export function enterFullscreenOnFirstGesture(): void {
  if (!fullscreenSupported() || launchedAsApp()) return;
  const events = ["pointerup", "keydown", "click"] as const;
  let done = false;
  const stop = (): void => {
    done = true;
    for (const name of events) document.removeEventListener(name, attempt, true);
  };
  function attempt(event: Event): void {
    if (done || isFullscreen()) return stop();
    // The toggle decides on its own press, and the install button needs the gesture for the
    // browser's install dialog.
    if (event.target instanceof Element && event.target.closest("#fullscreen, [data-act=install]"))
      return;
    void enter().then(stop, () => {
      // Refused (no gesture recognised): the next press tries again.
    });
  }
  for (const name of events) document.addEventListener(name, attempt, true);
}

/** Adds the toggle to `parent`, or nothing when this browser cannot go full screen. */
export function mountFullscreenButton(parent: HTMLElement): HTMLButtonElement | null {
  if (!fullscreenSupported()) return null;
  const button = document.createElement("button");
  button.type = "button";
  button.id = "fullscreen";
  const paint = (): void => {
    const on = isFullscreen();
    button.innerHTML = on ? EXIT_ICON : ENTER_ICON;
    button.setAttribute("aria-label", on ? "Thoát toàn màn hình" : "Toàn màn hình");
    button.title = button.getAttribute("aria-label")!;
  };
  button.addEventListener("click", () => {
    void (isFullscreen() ? exit() : enter()).catch(() => {}).finally(paint);
  });
  // Keep the game keyboard and the pad from seeing this press.
  button.addEventListener("pointerdown", (event) => event.stopPropagation());
  document.addEventListener("fullscreenchange", paint);
  document.addEventListener("webkitfullscreenchange", paint);
  // Leaving with the system Back gesture / Esc must also free the rotation.
  document.addEventListener("fullscreenchange", () => {
    if (!isFullscreen()) {
      try {
        screen.orientation?.unlock?.();
      } catch {
        // Nothing was locked.
      }
    }
  });
  paint();
  parent.append(button);
  return button;
}
