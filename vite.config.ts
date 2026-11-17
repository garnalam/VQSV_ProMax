import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vitest/config";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Where `npm run dev` sends `/api` (accounts and saves): the Cloudflare Pages deployment by
 * default, or VQSV_API for another server. The browser only sees localhost, so the session cookie
 * stays first-party.
 */
const API = process.env.VQSV_API ?? "https://test-huy.vqsv-test-huy.pages.dev";

/**
 * `/api/admin/*` on the dev server, answered by the same rules as the Pages Function
 * (`shared/admin-api.mjs`), so the Admin Tool works on localhost before that function is deployed.
 * The role still comes from Cloudflare: the request's own session cookie is sent to the deployed
 * `/api/auth/me`, and only an account that answers `role: "admin"` is served. Every other `/api`
 * call goes through the proxy as before.
 */
function adminDevApi(api: string): Plugin {
  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify(body));
  };
  const readBody = async (req: IncomingMessage): Promise<unknown> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      return {};
    }
  };
  return {
    name: "vqsv-admin-dev-api",
    configureServer(server) {
      const sharedAdmin = resolve(__dirname, "../../shared/admin-api.mjs");
      // A standalone checkout sends admin requests through the normal API proxy.
      if (!existsSync(sharedAdmin)) return;
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? "").split("?")[0];
        if (!path.startsWith("/api/admin/")) return next();
        try {
          const { adminRoute } = await import(/* @vite-ignore */ pathToFileURL(sharedAdmin).href);
          const me = await fetch(`${api}/api/auth/me`, {
            headers: { cookie: req.headers.cookie ?? "" },
            cache: "no-store",
          });
          if (!me.ok) return send(res, 401, { error: "Phiên đăng nhập đã hết hạn." });
          const { user } = (await me.json()) as { user?: { id?: string; role?: string } };
          const method = (req.method ?? "GET").toUpperCase(),
            rest = path.slice("/api/admin/".length).split("/").filter(Boolean),
            body = method === "POST" ? await readBody(req) : {},
            answer = adminRoute(user?.role, rest, method, body);
          if (answer.body.grant)
            server.config.logger.info(
              `VQSV_ADMIN_GRANT ${user?.id} ${JSON.stringify(answer.body.grant)}`,
            );
          send(res, answer.status, answer.body);
        } catch (error) {
          server.config.logger.error(`VQSV_ADMIN_DEV_API ${String(error)}`);
          send(res, 502, { error: "Không hỏi được máy chủ tài khoản." });
        }
      });
    },
  };
}

// `npm test` covers the web game only and needs nothing outside this folder. Checks that compare
// the pack against the Java source tree live in oracle/ and run with `npm run test:oracle`.
export default defineConfig({
  plugins: [adminDevApi(API)],
  build: {
    rollupOptions: {
      input: {
        game: resolve(__dirname, "index.html"),
        ...(existsSync(resolve(__dirname, "wiki.html"))
          ? { wiki: resolve(__dirname, "wiki.html") }
          : {}),
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: API,
        changeOrigin: true,
        secure: true,
        configure(proxy) {
          // The server refuses writes whose Origin is not its own; the proxy is that origin here.
          proxy.on("proxyReq", (request) => request.removeHeader("origin"));
        },
      },
    },
  },
  test: {
    include: [
      "src/**/*.test.ts",
      "scripts/pack-discipline.test.mjs",
      "scripts/pack-layout.test.mjs",
    ],
  },
});
