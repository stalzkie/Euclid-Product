import { defineConfig, devices } from "@playwright/test";
import { loadEnv } from "vite";

/**
 * Browser end-to-end tests.
 *
 * These are the only tests that run the product the way a person does: a real
 * Chromium, a real Shadow DOM, real cookies written by real responses. The
 * integration suite already drives the public API over HTTP, so nothing here
 * re-asserts a status code — these specs exist for the things only a browser
 * can see. The widget mounting inside a shadow root under a hostile host
 * stylesheet is the clearest example: `scripts/widget-e2e.mjs` has exercised
 * that API for months and has never once opened a page.
 *
 * They need a running app and a Supabase stack, the same two as the
 * integration suite, and they read the same env. In CI the workflow provides
 * both; locally, `supabase start` and a built `npm run start`.
 */

// Same contract as vitest.integration.config.ts: the keys live in .env.local,
// so a laptop run needs no exported variables. The empty prefix loads every
// key, not just VITE_ ones. Anything already exported wins, which is how CI
// points these at its own local stack.
const fileEnv = loadEnv("test", process.cwd(), "");
for (const [key, value] of Object.entries(fileEnv)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const baseURL = process.env.TEST_APP_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",

  // Serial, for the same reason the integration suite is: these specs share
  // one database and one rate limiter, and concurrent runs would turn board
  // state into a source of flake that looks like a product bug.
  fullyParallel: false,
  workers: 1,

  forbidOnly: Boolean(process.env.CI),

  // No retries, deliberately. A spec that passes on the second attempt is a
  // spec nobody will trust the first time; this repo's convention is to fix
  // the race rather than paper over it.
  retries: 0,

  // A cold Next.js route can take a few seconds to compile and render on the
  // first hit, and every assertion here waits on a remote database.
  timeout: 90_000,
  expect: { timeout: 15_000 },

  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],

  use: {
    baseURL,
    // Enough to debug a CI failure without storing a video per run.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  // Chromium only. The widget's own code is ES5 with a Shadow DOM feature
  // check, and tripling the CI time to learn that Firefox also has
  // `attachShadow` is not worth it. Add a project here when a real
  // cross-browser bug turns up.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  // In CI the app is already up, so this reuses it. Locally it starts the
  // built app for you — note `npm run start`, not `dev`: `next dev` and
  // `next build` clobber each other's `.next`.
  webServer: {
    command: "npm run start",
    url: `${baseURL}/widget.js`,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
