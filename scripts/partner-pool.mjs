import { loadEnv } from "./env.mjs";
loadEnv();

/**
 * Check the Bernn promo-code wiring, and run a top-up on demand.
 *
 * Usage:
 *   node scripts/partner-pool.mjs            # status + a non-destructive probe
 *   node scripts/partner-pool.mjs --run      # make the app actually top up
 *   node scripts/partner-pool.mjs --run --at https://app.euclidhq.com
 *
 * THE PROBE MINTS NOTHING
 *
 * Verifying a mint endpoint by minting leaves rows behind every time you
 * check, which is a poor way to test something whose whole job is handing out
 * redeemable credit. So the probe sends `count: 0` with the real token: Bernn
 * checks the Authorization header before it parses the body, so a 400 from
 * the schema proves the token was accepted and nothing was written. A 401
 * means the token is wrong, and a 503 means Bernn has no PARTNER_MINT_TOKEN
 * set at all — three outcomes that are easy to confuse from a log line and
 * trivial to tell apart here.
 *
 * `--run` deliberately does not reimplement the top-up. It calls the app's own
 * cron endpoint, so what gets exercised is the same `topUpPartnerPool` that
 * runs in production rather than a copy of it that can drift.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const h = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
const ok = (s) => `\x1b[32m${s}\x1b[0m`;
const bad = (s) => `\x1b[31m${s}\x1b[0m`;
const warn = (s) => `\x1b[33m${s}\x1b[0m`;

async function poolStatus() {
  const res = await fetch(`${url}/rest/v1/rpc/partner_pool_status`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ p_partner: "bernn" }),
  }).then((r) => r.json());
  return Array.isArray(res) ? res[0] : res;
}

/*
 * Everything runs inside main() so it can return rather than call
 * process.exit(). Exiting while a fetch handle is still open trips a libuv
 * assertion on Windows, which makes a perfectly clean "not configured" read
 * like a crash.
 */
async function main() {
  const pool = await poolStatus();
  console.log("Euclid pool");
  console.log(`  available ${pool?.available ?? "?"}`);
  console.log(`  owed      ${pool?.owed ?? "?"}`);
  if ((pool?.owed ?? 0) > 0) {
    console.log(warn("  ^ workspaces that qualified while the pool was empty. They are"));
    console.log(warn("    settled automatically by the next successful top-up."));
  }

  const mintUrl = process.env.BERNN_MINT_URL;
  const mintToken = process.env.BERNN_MINT_TOKEN;

  console.log("\nBernn wiring");
  if (!mintUrl || !mintToken) {
    console.log(warn("  not configured — set BERNN_MINT_URL and BERNN_MINT_TOKEN"));
    console.log("  Until then the pool is filled by hand:");
    console.log("    node scripts/import-partner-codes.mjs codes.txt");
    return 0;
  }
  console.log(`  url ${mintUrl}`);

  let probe;
  try {
    probe = await fetch(mintUrl, {
      method: "POST",
      headers: { authorization: mintToken, "content-type": "application/json" },
      body: JSON.stringify({ count: 0 }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    console.log(bad(`  unreachable: ${err.message}`));
    console.log("  The pool drains until this is fixed; the low-water email will say so.");
    return 1;
  }

  const detail = await probe.text();
  switch (probe.status) {
    case 400:
      console.log(ok("  reachable, token accepted, nothing minted"));
      break;
    case 401:
      console.log(bad("  401 — BERNN_MINT_TOKEN does not match PARTNER_MINT_TOKEN on Bernn"));
      return 1;
    case 503:
      console.log(bad("  503 — Bernn has no PARTNER_MINT_TOKEN set, so it refuses everything"));
      return 1;
    case 404:
      console.log(bad("  404 — nothing there. Check the URL ends in /partners/promo-codes"));
      return 1;
    default:
      console.log(warn(`  unexpected ${probe.status}: ${detail.slice(0, 160)}`));
      return 1;
  }

  if (!args.includes("--run")) {
    console.log("\nRun the real top-up with --run (goes through the app's cron endpoint).");
    return 0;
  }

  const at = flag("at", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
  const cron = process.env.CRON_SECRET;
  if (!cron) {
    console.log(bad("\nCRON_SECRET must be set to call the job endpoint"));
    return 1;
  }

  console.log(`\nTopping up via ${at}/api/jobs/run`);
  const run = await fetch(`${at}/api/jobs/run`, {
    method: "POST",
    headers: { authorization: `Bearer ${cron}` },
    signal: AbortSignal.timeout(60_000),
  });
  const body = await run.json().catch(() => ({}));
  console.log(`  ${run.status} ${JSON.stringify(body.partner ?? body)}`);

  const now = await poolStatus();
  console.log(`  pool now: ${now?.available ?? "?"} available, ${now?.owed ?? "?"} owed`);
  return run.ok ? 0 : 1;
}

process.exitCode = await main();
