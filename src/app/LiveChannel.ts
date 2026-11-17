import { defaultFetch, type ApiFetch } from "../account/RemoteAccountService";
import type { GameplayHost } from "../game/session/GameplayHost";

/** How often the game tells the server it is playing and asks for admin commands. */
const BEAT_MS = 15_000;

/** One command from the admin page (server/live.mjs). */
export type LiveCommand = { id: number; kind: string; payload: { text?: string; reason?: string } | null };

/**
 * The admin page's line into the running game, for an online account. Every 15 s the game says
 * where the player is (the admin page's online list) and runs what an admin queued for it:
 * - `reload`: the page reloads, so the game plays on from the cloud save — after an admin changed
 *   that save (teleport, quest steps, flags, a stuck ride...) or to clear a stuck fight or panel;
 * - `message`: a notice card from the admin, shown once the hero stands free.
 * A command is reported done to the server before it runs, so a reload never repeats.
 */
export class LiveChannel {
  private timer: number | undefined;
  private first = true;
  private busy = false;
  private lastInput = Date.now();
  private readonly onInput = () => {
    this.lastInput = Date.now();
  };

  constructor(
    private readonly host: () => GameplayHost | null,
    private readonly reload: (reason: string | undefined) => void,
    private readonly api: ApiFetch = defaultFetch,
  ) {}

  start(): void {
    this.stop();
    this.first = true;
    window.addEventListener("keydown", this.onInput, { passive: true });
    window.addEventListener("pointerdown", this.onInput, { passive: true });
    this.timer = window.setInterval(() => void this.beat(), BEAT_MS);
    // The first beat soon after the game opens: it spends reloads queued before this load.
    window.setTimeout(() => void this.beat(), 2_000);
  }

  stop(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    window.removeEventListener("keydown", this.onInput);
    window.removeEventListener("pointerdown", this.onInput);
  }

  private async beat(): Promise<void> {
    if (this.busy || this.timer === undefined) return;
    this.busy = true;
    try {
      const host = this.host(),
        response = await this.api("/live", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            first: this.first,
            where: host?.livePresence() ?? { layer: "menu" },
            idleMs: Math.min(86_400_000, Date.now() - this.lastInput),
            hidden: document.visibilityState === "hidden",
          }),
        });
      if (!response.ok) return;
      this.first = false;
      const { commands } = (await response.json()) as { commands?: LiveCommand[] };
      for (const command of commands ?? []) if (!(await this.run(command))) break;
    } catch {
      // Offline: the commands wait on the server for the next beat.
    } finally {
      this.busy = false;
    }
  }

  /** Runs one command; false stops the rest of this beat (a reload, or a notice that must wait). */
  private async run(command: LiveCommand): Promise<boolean> {
    switch (command.kind) {
      case "reload":
        await this.done(command, true, "Game đã tải lại.");
        this.reload(command.payload?.reason);
        return false;
      case "message": {
        const host = this.host();
        // Still at the login or a loading screen: the message waits for the next beat.
        if (!host) return false;
        host.queueGiftNotice("Thông báo", command.payload?.text ?? "");
        await this.done(command, true, "Đã hiện cho người chơi.");
        return true;
      }
      default:
        await this.done(command, false, "Bản game này không biết lệnh đó (hãy tải lại trang).");
        return true;
    }
  }

  private async done(command: LiveCommand, ok: boolean, result: string): Promise<void> {
    await this.api(`/live/${command.id}/done`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok, result }),
    });
  }
}
