import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { fileURLToPath } from "node:url";

/**
 * Integration tests run against a live app and database, so they are serial
 * and patient. They are a separate config from the unit suite so that
 * `npm test` stays fast and needs nothing running.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // Without this the suite finds no database and skips itself, which looks
    // like a pass. The empty prefix loads every key, not just VITE_ ones.
    env: loadEnv("test", process.cwd(), ""),
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Fixtures share a database; running files in parallel invites
    // cross-talk that looks like a flaky product rather than a flaky suite.
    fileParallelism: false,
  },
});
