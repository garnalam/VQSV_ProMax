import { launchedAsApp } from "./FullscreenButton";

/**
 * "Add the game to the home screen", so players come back from an icon instead of typing the
 * address. What a page may do depends on the browser:
 * - Chrome / Edge / Samsung Internet (Android, desktop): the browser offers `beforeinstallprompt`;
 *   holding on to it lets our own button open the real install dialog.
 * - iPhone / iPad: there is no install API at all. The player has to use Share → "Thêm vào MH
 *   chính" by hand, so all we can do is show them where it is.
 * - In-app browsers (Facebook, Messenger, Zalo, Instagram, TikTok): nothing can be installed from
 *   there; the player first has to open the link in Chrome or Safari.
 * - Already opened from the home screen, or a browser with no install path: nothing to offer.
 */

type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallKind = "prompt" | "ios" | "inapp" | "none";

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((listener) => listener());

// Registered when the module loads: the event may fire before the login panel is built.
window.addEventListener("beforeinstallprompt", (event) => {
  // Keep the browser's own mini bar away; our button opens the dialog instead.
  event.preventDefault();
  deferred = event as BeforeInstallPromptEvent;
  notify();
});
window.addEventListener("appinstalled", () => {
  installed = true;
  deferred = null;
  notify();
});

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS asks for the desktop site and calls itself a Mac; the touch screen gives it away.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function inAppBrowser(): boolean {
  return /FBAN|FBAV|FB_IAB|Messenger|Instagram|Zalo|TikTok|musical_ly|Line\//i.test(
    navigator.userAgent,
  );
}

function standalone(): boolean {
  return launchedAsApp() || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function installKind(): InstallKind {
  if (installed || standalone()) return "none";
  if (inAppBrowser()) return "inapp";
  if (deferred) return "prompt";
  if (isIos()) return "ios";
  return "none";
}

/** Opens the browser's install dialog (only when `installKind()` is "prompt"). */
export async function promptInstall(): Promise<"accepted" | "dismissed"> {
  const event = deferred;
  if (!event) return "dismissed";
  // The event works once; a dismissed dialog comes back as a fresh event later.
  deferred = null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  notify();
  return outcome;
}

export function onInstallChange(listener: () => void): void {
  listeners.add(listener);
}
