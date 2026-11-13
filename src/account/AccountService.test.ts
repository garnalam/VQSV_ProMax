import { describe, expect, it } from "vitest";
import { AccountError, LocalAccountService } from "./AccountService";
import { MemorySaveStore, type SaveStore } from "../persistence/save/SaveStore";

function service() {
  const saveStores = new Map<string, SaveStore>();
  return new LocalAccountService(
    new MemorySaveStore(),
    (id) => saveStores.get(id) ?? (saveStores.set(id, new MemorySaveStore()), saveStores.get(id)!),
    1_000,
  );
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AccountError) return error.code;
    throw error;
  }
  return "accepted";
}

describe("LocalAccountService", () => {
  it("registers, then signs in with the same name in any case", async () => {
    const accounts = service(),
      created = await accounts.register("Harry_01", "secret1");
    const signedIn = await accounts.login("harry_01", "secret1");
    expect(signedIn).toEqual(created);
    expect(signedIn.username).toBe("Harry_01");
  });

  it("refuses bad names, short passwords, taken names, unknown names and wrong passwords", async () => {
    const accounts = service();
    expect(await refusal(accounts.register("ab", "secret1"))).toBe("invalidName");
    expect(await refusal(accounts.register("có dấu", "secret1"))).toBe("invalidName");
    expect(await refusal(accounts.register("player", "12345"))).toBe("weakPassword");
    await accounts.register("player", "secret1");
    expect(await refusal(accounts.register("PLAYER", "other12"))).toBe("exists");
    expect(await refusal(accounts.login("nobody", "secret1"))).toBe("unknown");
    expect(await refusal(accounts.login("player", "secret2"))).toBe("wrongPassword");
  });

  it("stores only a salted hash, never the password", async () => {
    const store = new MemorySaveStore(),
      accounts = new LocalAccountService(store, () => new MemorySaveStore(), 1_000);
    await accounts.register("player", "secret1");
    const stored = JSON.stringify(await store.get("account:player"));
    expect(stored).not.toContain("secret1");
    expect(stored).toMatch(/"hash":"[0-9a-f]{64}"/);
  });

  it("gives every account its own save slot", async () => {
    const stores = new Map<string, MemorySaveStore>(),
      accounts = new LocalAccountService(
        new MemorySaveStore(),
        (id) => stores.get(id) ?? (stores.set(id, new MemorySaveStore()), stores.get(id)!),
        1_000,
      ),
      a = await accounts.register("alpha", "secret1"),
      b = await accounts.register("bravo", "secret1");
    expect(a.id).not.toBe(b.id);
    const saveA = accounts.saves(a);
    await stores.get(a.id)!.putAll([["active", { anything: true }]]);
    expect(await saveA.hasAnySave()).toBe(true);
    expect(await accounts.saves(b).hasAnySave()).toBe(false);
  });
});
