import { defaultFetch, type ApiFetch } from "./RemoteAccountService";

/** What the Admin Tool asks the server to approve (the server normalizes and returns it). */
export type AdminGrantRequest =
  | { action: "addItem"; kind: AdminItemKind; id: number; quantity: number }
  | { action: "setCurrency"; money: number; badges: number }
  | { action: "buffPet"; slot: number }
  | { action: "addPet"; speciesId: number; quality?: number; talentId?: number };

export type AdminItemKind = "BAG" | "EQUIPMENT" | "MATERIAL" | "SPECIAL";

/** A grant the server approved: only this is applied to the save. */
export type AdminGrant =
  | { action: "addItem"; kind: AdminItemKind; id: number; quantity: number }
  | { action: "setCurrency"; money: number; badges: number }
  /** A gift from the server (gift code or mailbox): money and badges added to what the save has. */
  | { action: "addCurrency"; money: number; badges: number }
  | { action: "buffPet"; slot: number; levels: number }
  | {
      action: "addPet";
      speciesId: number;
      nature: number;
      shiny: boolean;
      /** The talent roll's entropy, a decimal 64-bit integer drawn by the server. */
      talentSeed: string;
      /** Phẩm chất (stars, 1..5) the admin chose; absent = the species default. */
      quality?: number;
      /** The talent the admin chose (physical trait runtime id); absent = rolled from talentSeed. */
      talentId?: number;
    };

/** The server refused (not an admin, a bad request, no connection). */
export class AdminRefusal extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AdminRefusal";
  }
}

/**
 * `/api/admin/*`. The server checks the session's role on every call, so this is the only door:
 * the client applies a grant only after the server has answered it with its own normalized copy.
 */
export class AdminApi {
  constructor(private readonly api: ApiFetch = defaultFetch) {}

  async authorize(request: AdminGrantRequest): Promise<AdminGrant> {
    let response: Response;
    try {
      response = await this.api("/admin/grant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
    } catch {
      throw new AdminRefusal("Không kết nối được máy chủ.", 0);
    }
    let body: { ok?: boolean; grant?: AdminGrant; error?: string } = {};
    try {
      body = await response.json();
    } catch {
      // Not JSON: the generic message below.
    }
    if (!response.ok || !body.ok || !body.grant || body.grant.action !== request.action)
      // A 404 means the deployed Pages Function predates `/api/admin` (its catch-all answers
      // "Không tìm thấy API."), so say what to do rather than echo that.
      throw new AdminRefusal(
        response.status === 404
          ? "Máy chủ chưa có API admin: cần deploy bản mới của functions/api lên Cloudflare."
          : body.error || `Máy chủ trả lỗi ${response.status}.`,
        response.status,
      );
    return body.grant;
  }
}
