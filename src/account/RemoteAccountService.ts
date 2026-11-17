import { SaveRepository } from "../persistence/SaveRepository";
import type { SaveStore } from "../persistence/save/SaveStore";
import { decodeJavaSaveBytes } from "../persistence/save/JavaSaveEnvelope";
import { AccountError, type Account, type AccountService } from "./AccountService";
import { buildKey } from "./BuildKey";
import { buildKeyId, envelopeAad, openSave, sealSave } from "./SaveEnvelope";

/** The row this game keeps for each account; the Java game's own row is never written. */
export const WEB_NATIVE_VERSION = "web-native";
const WEB_NATIVE_NAME = "Save web-native";
const WEB_NATIVE_FILE = "vqsv-web-native.json";
/** The Java (WASM) build's save row, read once to carry an old player over. */
const JAVA_VERSION = "web";

type SaveRow = { id: string; gameVersion: string; revision: number; updatedAt?: number };

/** How the server's answers reach the code: a fetch bound to the API's base path. */
export type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

export const defaultFetch: ApiFetch = (path, init) =>
  fetch(`/api${path}`, { credentials: "same-origin", cache: "no-store", ...init });

/** A refusal from the server, carrying its own Vietnamese message. */
async function refusal(response: Response): Promise<AccountError> {
  let message = "";
  try {
    message = String(((await response.json()) as { error?: unknown }).error ?? "");
  } catch {
    // Not JSON (a proxy or network page): the generic message is shown.
  }
  const code =
    response.status === 409 ? "exists" : response.status === 401 ? "wrongPassword" : "invalidName";
  return new AccountError(code, message || `Máy chủ trả lỗi ${response.status}.`);
}

/**
 * Email accounts and saves kept on the Cloudflare server (the same D1 database the Java build
 * uses). The session lives in an HttpOnly cookie the server sets; nothing secret is kept here.
 */
export class RemoteAccountService implements AccountService {
  constructor(private readonly api: ApiFetch = defaultFetch) {}

  register(email: string, password: string): Promise<Account> {
    return this.authenticate("register", email, password);
  }

  login(email: string, password: string): Promise<Account> {
    return this.authenticate("login", email, password);
  }

  saves(): SaveRepository {
    return new SaveRepository(new RemoteSaveStore(this.api));
  }

  /** The Java build's save text for this account, if it has one (to carry the player over). */
  async legacyJavaSave(): Promise<string | undefined> {
    const row = (await listSaves(this.api))
      .filter((save) => save.gameVersion === JAVA_VERSION)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
    if (!row) return undefined;
    // The current copy first; the backup when the current one is damaged.
    let failure: unknown;
    for (const copy of ["", "/backup"]) {
      const response = await this.api(`/saves/${row.id}${copy}`);
      if (!response.ok) continue;
      try {
        return await decodeJavaSaveBytes(new Uint8Array(await response.arrayBuffer()));
      } catch (error) {
        failure = error;
      }
    }
    if (failure) throw failure;
    return undefined;
  }

  private async authenticate(
    route: "login" | "register",
    email: string,
    password: string,
  ): Promise<Account> {
    email = email.trim();
    let response: Response;
    try {
      response = await this.api(`/auth/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      throw new AccountError("unknown", "Không kết nối được máy chủ. Hãy kiểm tra mạng.");
    }
    if (!response.ok) throw await refusal(response);
    const { user } = (await response.json()) as {
      user: { id: string; email: string; role?: string };
    };
    return { id: user.id, username: user.email, admin: user.role === "admin" };
  }
}

async function listSaves(api: ApiFetch): Promise<SaveRow[]> {
  return (await listing(api)).saves;
}

/** The account's save rows and this session's envelope ticket (`SaveEnvelope`). */
async function listing(api: ApiFetch): Promise<{ saves: SaveRow[]; ticket: string }> {
  const response = await api("/saves");
  if (!response.ok) throw await refusal(response);
  const body = (await response.json()) as { saves?: SaveRow[]; ticket?: string };
  return { saves: body.saves ?? [], ticket: body.ticket ?? "" };
}

const STALE_BUILD = "Game vừa được cập nhật. Hãy tải lại trang (Ctrl+F5) để chơi tiếp.";
const ADMIN_CHANGED = "Quản trị viên vừa chỉnh tiến trình của bạn. Game sẽ tải lại.";
/** Dispatched on `window` when the server says an admin changed the save: the page reloads it. */
export const ADMIN_RELOAD_EVENT = "vqsv:admin-reload";

/**
 * The save repository's store, backed by the account's own row on the server. The server keeps
 * the previous copy as the row's backup when a new one is written, so only the active save is
 * uploaded; the revision guards against a second tab writing in between.
 */
export class RemoteSaveStore implements SaveStore {
  private row: SaveRow | null | undefined;
  private ticket = "";
  private readonly key = buildKey();
  private readonly cache = new Map<string, unknown>();

  constructor(private readonly api: ApiFetch = defaultFetch) {}

  async get(key: string): Promise<unknown> {
    if (this.cache.has(key)) return structuredClone(this.cache.get(key));
    const row = await this.ownRow();
    let value: unknown;
    if (row && (key === "active" || key === "backup")) {
      // The save comes down sealed (`SaveEnvelope`) in this build's key; an older tab is asked to reload.
      const response = await this.api(`/saves/${row.id}${key === "backup" ? "/backup" : ""}`, {
        headers: { "x-vqsv-build": await buildKeyId(this.key) },
      });
      if (response.status === 426) throw new AccountError("unknown", STALE_BUILD);
      if (response.ok) {
        const text = await openSave(
          new Uint8Array(await response.arrayBuffer()),
          this.ticket,
          [this.key],
          envelopeAad(row.id, row.revision, "down"),
        );
        try {
          value = text === null ? undefined : JSON.parse(text);
        } catch {
          value = undefined;
        }
      }
    }
    this.cache.set(key, value);
    return structuredClone(value);
  }

  async putAll(entries: ReadonlyArray<readonly [string, unknown]>): Promise<void> {
    const active = entries.find(([key]) => key === "active");
    if (active) await this.upload(active[1]);
    for (const [key, value] of entries) this.cache.set(key, structuredClone(value));
  }

  async clear(): Promise<void> {
    const row = await this.ownRow();
    if (row) {
      const response = await this.api(`/saves/${row.id}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw await refusal(response);
    }
    this.row = null;
    this.cache.clear();
  }

  private async upload(value: unknown, retried = false): Promise<void> {
    const row = await this.ownRow(),
      form = new FormData(),
      sealed = await sealSave(
        JSON.stringify(value),
        this.ticket,
        this.key,
        envelopeAad(row?.id ?? null, row?.revision ?? 0, "up"),
      );
    form.set("file", new Blob([sealed as BlobPart], { type: "application/octet-stream" }), WEB_NATIVE_FILE);
    form.set("name", WEB_NATIVE_NAME);
    form.set("gameVersion", WEB_NATIVE_VERSION);
    if (row) form.set("revision", String(row.revision));
    const response = await this.api(row ? `/saves/${row.id}` : "/saves", {
      method: row ? "PUT" : "POST",
      body: form,
    });
    if (response.status === 409) {
      const code = await response
        .clone()
        .json()
        .then((body: { code?: unknown }) => body.code)
        .catch(() => null);
      if (code === "admin_changed") {
        // An admin changed this save after the game loaded it: never write over it — the game
        // reloads the admin's version (GameApp listens).
        if (typeof window !== "undefined") window.dispatchEvent(new Event(ADMIN_RELOAD_EVENT));
        throw new AccountError("unknown", ADMIN_CHANGED);
      }
    }
    if (response.status === 409 && !retried) {
      // Another tab of the same player saved first: the newest play wins, as it does locally.
      this.row = undefined;
      return this.upload(value, true);
    }
    if (!response.ok) {
      const error = await refusal(response);
      if (response.status === 400 && !retried) {
        // A refused envelope: the ticket may be from a session the server renewed. Fetch it again once.
        this.row = undefined;
        return this.upload(value, true);
      }
      throw response.status === 400 ? new AccountError("unknown", STALE_BUILD) : error;
    }
    this.row = (await response.json()) as SaveRow;
  }

  private async ownRow(): Promise<SaveRow | null> {
    if (this.row !== undefined) return this.row;
    const { saves, ticket } = await listing(this.api);
    this.ticket = ticket;
    this.row =
      saves
        .filter((save) => save.gameVersion === WEB_NATIVE_VERSION)
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0] ?? null;
    return this.row;
  }
}
