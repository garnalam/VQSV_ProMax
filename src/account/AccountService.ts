import { SaveRepository } from "../persistence/SaveRepository";
import { IndexedDbSaveStore, type SaveStore } from "../persistence/save/SaveStore";

/** A signed-in player. `id` never changes; `username` is what they typed when registering. */
export type Account = {
  readonly id: string;
  readonly username: string;
  /** The server's `users.role` is `admin`: the menu lists the Admin Tool (the server re-checks). */
  readonly admin?: boolean;
};

export type AccountErrorCode =
  "invalidName" | "weakPassword" | "exists" | "unknown" | "wrongPassword";

export class AccountError extends Error {
  /** `serverMessage`: the server's own wording, shown instead of the stock one. */
  constructor(
    readonly code: AccountErrorCode,
    readonly serverMessage?: string,
  ) {
    super(serverMessage ?? code);
    this.name = "AccountError";
  }
}

/** What the login screen shows for each refusal. */
export const ACCOUNT_MESSAGES: Record<AccountErrorCode, string> = {
  invalidName: "Tên tài khoản gồm 3–20 chữ cái, chữ số hoặc dấu _.",
  weakPassword: "Mật khẩu cần từ 6 đến 64 ký tự.",
  exists: "Tên tài khoản này đã có người dùng.",
  unknown: "Tài khoản không tồn tại.",
  wrongPassword: "Sai mật khẩu.",
};

/**
 * Sign-in and the save that belongs to each account. The login screen and the game only talk to
 * this interface, so the local stand-in below can be swapped for the VPS server without touching
 * either of them.
 */
export interface AccountService {
  register(username: string, password: string): Promise<Account>;
  login(username: string, password: string): Promise<Account>;
  /** The account's own save slot. */
  saves(account: Account): SaveRepository;
  /** The Java build's save text for this account, when the backend keeps one. */
  legacyJavaSave?(account: Account): Promise<string | undefined>;
}

/** What the login panel shows for a refusal. */
export function accountMessage(error: AccountError): string {
  return error.serverMessage || ACCOUNT_MESSAGES[error.code];
}

const NAME = /^[A-Za-z0-9_]{3,20}$/;

export function checkCredentials(username: string, password: string): void {
  if (!NAME.test(username)) throw new AccountError("invalidName");
  if (password.length < 6 || password.length > 64) throw new AccountError("weakPassword");
}

type StoredAccount = { id: string; username: string; salt: string; hash: string };

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(hex.match(/../g)!.map((pair) => parseInt(pair, 16)));

/**
 * Accounts kept in this browser until the server exists. Passwords are stored only as salted
 * PBKDF2 hashes; names are matched without regard to case. Each account's save lives in its own
 * store, apart from the single pre-account save the game used before.
 */
export class LocalAccountService implements AccountService {
  constructor(
    private readonly store: SaveStore = new IndexedDbSaveStore("vqsv-accounts", "accounts"),
    private readonly saveStore: (accountId: string) => SaveStore = (id) =>
      new IndexedDbSaveStore(`vqsv-save-${id}`, "saves"),
    private readonly iterations = 120_000,
  ) {}

  async register(username: string, password: string): Promise<Account> {
    username = username.trim();
    checkCredentials(username, password);
    const key = this.key(username);
    if ((await this.store.get(key)) !== undefined) throw new AccountError("exists");
    const salt = crypto.getRandomValues(new Uint8Array(16)),
      stored: StoredAccount = {
        id: crypto.randomUUID(),
        username,
        salt: toHex(salt),
        hash: await this.hash(password, salt),
      };
    await this.store.putAll([[key, stored]]);
    return { id: stored.id, username };
  }

  async login(username: string, password: string): Promise<Account> {
    username = username.trim();
    if (!username) throw new AccountError("invalidName");
    const stored = (await this.store.get(this.key(username))) as StoredAccount | undefined;
    if (!stored) throw new AccountError("unknown");
    if ((await this.hash(password, fromHex(stored.salt))) !== stored.hash)
      throw new AccountError("wrongPassword");
    return { id: stored.id, username: stored.username };
  }

  saves(account: Account): SaveRepository {
    return new SaveRepository(this.saveStore(account.id));
  }

  private key(username: string): string {
    return `account:${username.toLowerCase()}`;
  }

  private async hash(password: string, salt: Uint8Array<ArrayBuffer>): Promise<string> {
    const material = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        "PBKDF2",
        false,
        ["deriveBits"],
      ),
      bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt, iterations: this.iterations },
        material,
        256,
      );
    return toHex(new Uint8Array(bits));
  }
}
