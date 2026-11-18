import type { AdminGrant } from "./AdminApi";
import { defaultFetch, type ApiFetch } from "./RemoteAccountService";

/** A gift waiting in the player's server mailbox (sent from the admin page). */
export type MailGift = {
  id: number;
  title: string;
  body: string;
  rewards: { pets: unknown[] };
  createdAt: number;
};

/** What a claimed gift hands the game: grants drawn and approved by the server. */
export type ClaimedGift = { title: string; body: string; grants: AdminGrant[] };

/** The server refused (no such code, already used, bank full, offline...), with its own message. */
export class RewardRefusal extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "RewardRefusal";
  }
}

/**
 * Gift codes and the mailbox kept on the game server. The server records a redemption or a claim
 * before answering, so a gift is handed out once; the game applies the grants it returns.
 */
export class RewardsApi {
  constructor(private readonly api: ApiFetch = defaultFetch) {}

  /** `bankFree`: the empty slots in the pet bank, so a gift with pets is refused, not lost. */
  async redeem(code: string, bankFree: number): Promise<ClaimedGift> {
    const body = await this.call<{ description: string; grants: AdminGrant[] }>("/gifts/redeem", {
      code,
      bankFree,
    });
    return { title: "Giftcode", body: body.description, grants: body.grants };
  }

  async inbox(): Promise<MailGift[]> {
    return (await this.call<{ mail: MailGift[] }>("/mail")).mail;
  }

  /** The "Ủng hộ" panel's rates, as the admin set them (server/donate.mjs). */
  async donateRates(): Promise<{ vnd: number; luong: number }[]> {
    return (await this.call<{ rates: { vnd: number; luong: number }[] }>("/donate")).rates;
  }

  async claim(id: number, bankFree: number): Promise<ClaimedGift> {
    return this.call<ClaimedGift>(`/mail/${id}/claim`, { bankFree });
  }

  private async call<T>(path: string, json?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.api(
        path,
        json === undefined
          ? undefined
          : {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(json),
            },
      );
    } catch {
      throw new RewardRefusal("Không kết nối được máy chủ.", 0, "offline");
    }
    let body: { error?: string; code?: string } & Record<string, unknown> = {};
    try {
      body = await response.json();
    } catch {
      // Not JSON: the generic message below.
    }
    if (!response.ok)
      throw new RewardRefusal(
        body.error || `Máy chủ trả lỗi ${response.status}.`,
        response.status,
        body.code ?? "",
      );
    return body as T;
  }
}
