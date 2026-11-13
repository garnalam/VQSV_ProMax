import { defineConfig } from "vitest/config";

// `npm test` covers the web game only and needs nothing outside this folder. Checks that compare
// the pack against the Java source tree live in oracle/ and run with `npm run test:oracle`.
export default defineConfig({
  test: {
    include: [
      "src/**/*.test.ts",
      "scripts/pack-discipline.test.mjs",
      "scripts/pack-layout.test.mjs",
    ],
  },
});
