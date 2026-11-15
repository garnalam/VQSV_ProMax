import { describe, expect, it } from "vitest";
import { AccountError, LocalAccountService } from "./AccountService";
import { MemorySaveStore, type SaveStore } from "../persistence/save/SaveStore";
import { scene1Save } from "../dev/parityCheckpoints";
import { createTowerState } from "../game/meta/BondingTower";
import { upgradeSave } from "../persistence/save/migrations";

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
  it("ranks the ten highest current saves, ordering ties by login name", async () => {
    const accounts = service();
    const save = upgradeSave({
      ...scene1Save({
        location: { sceneId: 1, roomIndex: 0, x: 0, y: 0, direction: 0 },
        owner: "scene1.bunny-capture", bunnyCaught: false,
        pets: [{ speciesId: 68, level: 6, quality: 2 }],
      }),
      version: 27,
    })!;
    for (let i = 0; i < 12; i++) {
      const account = await accounts.register(`player_${i}`, "secret1");
      const highest = i === 10 ? 11 : i;
      await accounts.saves(account).save({
        ...save, meta: { ...save.meta!, tower: { ...createTowerState(), highest } },
      });
    }
    const rows = await accounts.towerLeaderboard();
    expect(rows).toHaveLength(10);
    expect(rows.slice(0, 2)).toEqual([
      { username: "player_10", highest: 11 }, { username: "player_11", highest: 11 },
    ]);
    await accounts.saves(await accounts.login("player_10", "secret1")).deleteAll();
    expect((await accounts.towerLeaderboard())[0].username).toBe("player_11");
  });

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
