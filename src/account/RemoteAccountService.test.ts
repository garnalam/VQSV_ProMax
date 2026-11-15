import { describe, expect, it } from "vitest";
import { AccountError, accountMessage } from "./AccountService";
import { RemoteAccountService, RemoteSaveStore, type ApiFetch } from "./RemoteAccountService";
import { SaveRepository } from "../persistence/SaveRepository";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { importJavaSave } from "../persistence/save/JavaSaveImport";
import type { GameSave } from "../persistence/save/GameSave";

const yes = () => true;
const sample = importJavaSave(
  readFileSync(
    resolve(import.meta.dirname, "../persistence/save/fixtures/java-save-scene3.properties"),
    "utf8",
  ),
  {
    species: yes,
    skill: yes,
    bagItem: yes,
    equipment: yes,
    material: yes,
    special: yes,
    fashion: yes,
  },
)!.save;
const createNewGameSave = (): GameSave => structuredClone(sample);

type Row = {
  id: string;
  gameVersion: string;
  revision: number;
  updatedAt: number;
  current: Uint8Array<ArrayBuffer>;
  backup: Uint8Array<ArrayBuffer>;
};

/** The Cloudflare API's save routes, in memory, as the Pages Function answers them. */
function fakeServer(rows: Row[] = []) {
  const calls: string[] = [];
  let next = 1;
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json" },
    });
  const pub = ({ id, gameVersion, revision, updatedAt }: Row) => ({
    id,
    gameVersion,
    revision,
    updatedAt,
  });
  const api: ApiFetch = async (path, init = {}) => {
    const method = init.method ?? "GET";
    calls.push(`${method} ${path}`);
    if (path === "/auth/login") {
      const { email, password } = JSON.parse(String(init.body));
      return password === "dung-mat-khau"
        ? json({ user: { id: "u1", email, role: email === "admin@b.vn" ? "admin" : "user" } })
        : json({ error: "Email hoặc mật khẩu không đúng." }, 401);
    }
    if (path === "/auth/register") return json({ error: "Email này đã có tài khoản." }, 409);
    if (path === "/saves" && method === "GET") return json({ saves: rows.map(pub) });
    const bytes = async () =>
      new Uint8Array(await ((init.body as FormData).get("file") as Blob).arrayBuffer());
    if (path === "/saves" && method === "POST") {
      const data = await bytes(),
        row: Row = {
          id: `id-${next++}`,
          gameVersion: String((init.body as FormData).get("gameVersion")),
          revision: 1,
          updatedAt: Date.now(),
          current: data,
          backup: data,
        };
      rows.push(row);
      return json(pub(row), 201);
    }
    const [, , id, copy] = path.split("/"),
      row = rows.find((entry) => entry.id === id);
    if (!row) return json({ error: "Không tìm thấy bản save." }, 404);
    if (method === "GET") return new Response(copy === "backup" ? row.backup : row.current);
    if (method === "DELETE") {
      rows.splice(rows.indexOf(row), 1);
      return json({ ok: true });
    }
    if (method === "PUT") {
      const revision = Number((init.body as FormData).get("revision"));
      if (revision !== row.revision) return json({ error: "Bản save đã thay đổi." }, 409);
      row.backup = row.current;
      row.current = await bytes();
      row.revision++;
      return json(pub(row));
    }
    return json({ error: "?" }, 405);
  };
  return { api, rows, calls };
}

const javaRow = (text: string): Row => {
  const data = new TextEncoder().encode(text);
  return { id: "java", gameVersion: "web", revision: 3, updatedAt: 1, current: data, backup: data };
};

describe("RemoteAccountService", () => {
  it("signs in by email and shows the server's own refusal", async () => {
    const { api } = fakeServer(),
      accounts = new RemoteAccountService(api);
    expect(await accounts.login(" a@b.vn ", "dung-mat-khau")).toEqual({
      id: "u1",
      username: "a@b.vn",
      admin: false,
    });
    expect((await accounts.login("admin@b.vn", "dung-mat-khau")).admin).toBe(true);
    const wrong = await accounts.login("a@b.vn", "sai").catch((error) => error);
    expect(wrong).toBeInstanceOf(AccountError);
    expect(accountMessage(wrong)).toBe("Email hoặc mật khẩu không đúng.");
    const taken = await accounts.register("a@b.vn", "12345678").catch((error) => error);
    expect([taken.code, accountMessage(taken)]).toEqual(["exists", "Email này đã có tài khoản."]);
  });

  it("reads the Java build's save without writing to its row", async () => {
    const server = fakeServer([javaRow("version=22\nscene=3\n")]),
      accounts = new RemoteAccountService(server.api);
    expect(await accounts.legacyJavaSave()).toBe("version=22\nscene=3\n");
    expect(await accounts.saves().hasAnySave()).toBe(false);
    expect(server.calls.filter((call) => !call.startsWith("GET"))).toEqual([]);
  });

  it("opens the Java build's encrypted save, falling back to its backup", async () => {
    const encrypted = new Uint8Array(
        readFileSync(
          resolve(import.meta.dirname, "../persistence/save/fixtures/java-save-scene3.v1.bin"),
        ),
      ),
      row = javaRow("");
    // A damaged current copy: the header promises more bytes than there are.
    row.current = new Uint8Array([86, 81, 83, 86, 83, 65, 86, 69, 1, 1, 12, 0, 0, 0, 0, 99]);
    row.backup = encrypted;
    const text = await new RemoteAccountService(fakeServer([row]).api).legacyJavaSave();
    expect(text).toContain("worldResumeMode=SCENE2_ROOM1_FREE_WORLD");
  });
});

describe("RemoteSaveStore", () => {
  it("keeps the web game's save in a row of its own, with the server's backup", async () => {
    const server = fakeServer([javaRow("version=22\n")]),
      first = createNewGameSave(),
      second = { ...createNewGameSave(), playTimeMillis: 42_000 };
    const repo = new SaveRepository(new RemoteSaveStore(server.api));
    await repo.save(first);
    await repo.save(second);
    expect(server.rows.map((row) => [row.gameVersion, row.revision])).toEqual([
      ["web", 3],
      ["web-native", 2],
    ]);
    // A fresh visit reads it back from the server.
    const again = new SaveRepository(new RemoteSaveStore(server.api));
    expect((await again.load())?.playTimeMillis).toBe(42_000);
    expect(await new RemoteSaveStore(server.api).get("backup")).toMatchObject({
      playTimeMillis: first.playTimeMillis,
    });
    await again.deleteAll();
    expect(server.rows.map((row) => row.gameVersion)).toEqual(["web"]);
  });

  it("wins over a second tab that saved in between", async () => {
    const server = fakeServer(),
      a = new SaveRepository(new RemoteSaveStore(server.api)),
      b = new SaveRepository(new RemoteSaveStore(server.api));
    await a.save(createNewGameSave());
    await b.load();
    await a.save({ ...createNewGameSave(), playTimeMillis: 1 });
    await b.save({ ...createNewGameSave(), playTimeMillis: 2 });
    expect(server.rows).toHaveLength(1);
    expect((await new SaveRepository(new RemoteSaveStore(server.api)).load())?.playTimeMillis).toBe(
      2,
    );
  });
});
