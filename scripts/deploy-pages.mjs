// `npm run deploy:pages`: build, then deploy dist/ + functions/ to the `vqsv-web-native` Pages
// project. The project must live in the same Cloudflare account as its D1 database
// (`vqsv-test-huy-db`), so the account is pinned here instead of left to Wrangler's default, and
// the branch is pinned to the project's production branch so every deploy goes live.
import { spawnSync } from "node:child_process";

const ACCOUNT_ID = "e6f08a5c04c58971a67bd315b92b9252"; // Huy.dencosluxury@gmail.com's Account
const PRODUCTION_BRANCH = "ban-test-moi-nhat";

const run = (command, args, env = {}) => {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run("npm", ["run", "build"]);
run("npx", ["wrangler", "pages", "deploy", "--branch", PRODUCTION_BRANCH, "--commit-dirty=true"], {
  CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? ACCOUNT_ID,
});
