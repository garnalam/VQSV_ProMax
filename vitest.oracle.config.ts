import { defineConfig } from "vitest/config";

// Oracle checks: compare the committed pack with the Java source pack (../rebuild_game,
// ../modules). Optional; requires the VQSV-WebNative source tree next to web-native.
export default defineConfig({
  test: {
    include: ["oracle/**/*.test.mjs"],
  },
});
