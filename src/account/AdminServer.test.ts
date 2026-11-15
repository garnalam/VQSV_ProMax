import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { AdminApi, AdminRefusal } from "./AdminApi";

/**
 * The Cloudflare Pages Function itself (`functions/api/[[path]].js`) over a real SQLite database
 * with the D1 surface it uses, so the role check is tested where it runs, not in the client.
 */
const root = resolve(import.meta.dirname, "../../../..");
const functionUrl = pathToFileURL(resolve(root, "functions/api/[[path]].js")).href;
const { onRequest } = (await import(/* @vite-ignore */ functionUrl)) as {
  onRequest: (context: { request: Request; env: { DB: unknown } }) => Promise<Response>;
};

function d1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(resolve(root, "migrations/0001_cloud_saves.sql"), "utf8"));
  const statement = (sql: string, params: unknown[] = []) => ({
    bind: (...values: unknown[]) => statement(sql, values),
    first: async () => sqlite.prepare(sql).get(...(params as never[])) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...(params as never[])) }),
    run: async () => sqlite.prepare(sql).run(...(params as never[])),
  });
  return {
    sqlite,
    DB: {
      prepare: (sql: string) => statement(sql),
      batch: async (list: { run: () => Promise<unknown> }[]) => {
        for (const item of list) await item.run();
      },
    },
  };
}

const db = d1();
const call = (path: string, init: RequestInit = {}, cookie = "") =>
  onRequest({
    request: new Request(`https://vqsv.test/api${path}`, {
      ...init,
      headers: { ...(init.headers as object), ...(cookie ? { cookie } : {}) },
    }),
    env: { DB: db.DB },
  });

async function account(email: string, role: "user" | "admin"): Promise<string> {
  const response = await call("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "mat-khau-thu" }),
  });
  expect(response.status).toBe(200);
  db.sqlite.prepare("UPDATE users SET role = ? WHERE email = ?").run(role, email);
  return response.headers.get("set-cookie")!.split(";")[0];
}

const admin = await account("admin@vqsv.test", "admin");
const player = await account("player@vqsv.test", "user");
/** `AdminApi` bound to one session cookie, as the browser would send it. */
const apiAs = (cookie: string) => new AdminApi((path, init) => call(path, init, cookie));
const grant = (cookie: string, body: unknown) =>
  call(
    "/admin/grant",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    cookie,
  );

describe("/api/admin", () => {
  it("refuses anyone who is not signed in as an admin", async () => {
    expect((await call("/admin/status")).status).toBe(401);
    expect((await call("/admin/status", {}, player)).status).toBe(403);
    const refused = await apiAs(player)
      .authorize({ action: "setCurrency", money: 1, badges: 1 })
      .catch((error) => error);
    expect(refused).toBeInstanceOf(AdminRefusal);
    expect(refused.status).toBe(403);
    expect(refused.message).toBe("Tài khoản không có quyền quản trị.");
    expect((await call("/admin/status", {}, admin)).status).toBe(200);
  });

  it("re-reads the role on every call", async () => {
    const cookie = await account("demoted@vqsv.test", "admin");
    expect((await call("/admin/status", {}, cookie)).status).toBe(200);
    db.sqlite.prepare("UPDATE users SET role = 'user' WHERE email = ?").run("demoted@vqsv.test");
    expect((await grant(cookie, { action: "buffPet", slot: 0 })).status).toBe(403);
  });

  it("validates and normalizes each grant", async () => {
    const api = apiAs(admin);
    expect(await api.authorize({ action: "addItem", kind: "BAG", id: 3, quantity: 50 })).toEqual({
      action: "addItem",
      kind: "BAG",
      id: 3,
      quantity: 50,
    });
    expect(await api.authorize({ action: "setCurrency", money: 99999, badges: 300 })).toEqual({
      action: "setCurrency",
      money: 99999,
      badges: 300,
    });
    // The server, not the client, fixes the buff at 15 levels.
    expect(
      await grant(admin, { action: "buffPet", slot: 2, levels: 99 }).then((r) => r.json()),
    ).toEqual({ ok: true, grant: { action: "buffPet", slot: 2, levels: 15 } });
    for (const bad of [
      { action: "addItem", kind: "BADGE", id: 1, quantity: 1 },
      { action: "addItem", kind: "BAG", id: 1, quantity: 0 },
      { action: "addItem", kind: "BAG", id: 1, quantity: 10000 },
      { action: "addItem", kind: "BAG", id: 1.5, quantity: 1 },
      { action: "setCurrency", money: -1, badges: 0 },
      { action: "setCurrency", money: 2 ** 31, badges: 0 },
      { action: "buffPet", slot: 6 },
      { action: "addPet", speciesId: 278 },
      { action: "addPet", speciesId: 280 },
      { action: "deleteEverything" },
    ])
      expect((await grant(admin, bad)).status, JSON.stringify(bad)).toBe(400);
  });

  it("draws a new pet's shiny, nature and talent entropy", async () => {
    const api = apiAs(admin),
      natures = new Set<number>();
    for (let i = 0; i < 60; i++) {
      const result = await api.authorize({ action: "addPet", speciesId: 68 });
      if (result.action !== "addPet") throw new Error("wrong grant");
      expect(result.speciesId).toBe(68);
      expect(result.shiny ? [7, 8, 9] : [2]).toContain(result.nature);
      expect(BigInt(result.talentSeed) >= 0n).toBe(true);
      natures.add(result.nature);
    }
    // 60 draws: both plain and shiny appear (the odds of missing one are about 1 in 10^17).
    expect(natures.has(2)).toBe(true);
    expect([7, 8, 9].some((n) => natures.has(n))).toBe(true);
  });
});
