import type { RewardsApi } from "../account/RewardsApi";
import type { GameplayHost } from "../game/session/GameplayHost";

/** How often a waiting notice is retried, and how often the server mailbox is read. */
const NOTICE_MS = 2_000;
const INBOX_MS = 30_000;

/**
 * The server mailbox while an online account plays: gifts an admin sent are claimed one at a time
 * while the hero stands free on the map, applied to the save, and announced on a notice card.
 * A gift whose pets would not fit in the pet bank waits on the server, with a notice saying why.
 */
export class GiftMailbox {
  private timer: number | undefined;
  private lastInbox = 0;
  private busy = false;
  private readonly warned = new Set<number>();

  constructor(
    private readonly api: RewardsApi,
    private readonly host: () => GameplayHost | null,
  ) {}

  start(): void {
    this.stop();
    // The first read waits a little, so the world is on screen before a notice opens.
    this.lastInbox = Date.now() - INBOX_MS + 5_000;
    this.timer = window.setInterval(() => void this.tick(), NOTICE_MS);
  }

  stop(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    const host = this.host();
    if (!host || this.busy) return;
    host.showGiftNotice();
    if (document.visibilityState === "hidden" || Date.now() - this.lastInbox < INBOX_MS) return;
    if (!host.readyForGift) return;
    this.lastInbox = Date.now();
    this.busy = true;
    try {
      for (const gift of await this.api.inbox()) {
        const current = this.host();
        if (!current?.readyForGift) return;
        if (gift.rewards.pets.length > current.petBankFree) {
          if (!this.warned.has(gift.id)) {
            this.warned.add(gift.id);
            current.queueGiftNotice(
              "Hộp quà",
              `Bạn có quà "${gift.title}" kèm ${gift.rewards.pets.length} pet. Hãy dọn chỗ trong ngân hàng sủng vật để nhận.`,
            );
          }
          continue;
        }
        const claimed = await this.api.claim(gift.id, current.petBankFree);
        // Claimed on the server: it lands in this session's save now, whatever is on screen.
        const receiver = this.host() ?? current;
        receiver.expectLedger(`mail:${gift.id}`);
        receiver.deliverGift({ ...claimed, title: `Quà: ${claimed.title}` });
        return;
      }
    } catch {
      // Offline or the session ended: the gift stays on the server for the next read.
    } finally {
      this.busy = false;
    }
  }
}
