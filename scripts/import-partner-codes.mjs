import { loadEnv } from "./env.mjs";
loadEnv();

/**
 * Load partner promo codes into the pool.
 *
 * The codes themselves are minted in the partner's own system — for Bernn
 * that is `apps/api/scripts/create-promo-code.mjs`, which writes a row in
 * Bernn's `promo_codes` table and prints the code. This script only records
 * here that those codes exist and are ours to give away; it cannot create a
 * code Bernn would honour.
 *
 * Usage:
 *   node scripts/import-partner-codes.mjs codes.txt
 *   node scripts/import-partner-codes.mjs codes.txt --partner bernn --trial-days 30
 *
 * The file is one code per line. Blank lines and anything after a `#` are
 * ignored, so the output of the minting script can be pasted in unedited.
 *
 * Re-running with a file you have already imported is safe: codes already in
 * the pool are skipped rather than duplicated, and a code that has already
 * been handed to somebody is never touched.
 */

import { readFileSync } from "node:fs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set");

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: node scripts/import-partner-codes.mjs <file> [--partner bernn] [--trial-days 30]");
  process.exit(1);
}
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const partner = flag("partner", "bernn");
const trialDays = Number(flag("trial-days", "30"));
if (!Number.isInteger(trialDays) || trialDays <= 0) {
  throw new Error("--trial-days must be a positive integer");
}

const codes = [
  ...new Set(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => line.split("#")[0].trim().toUpperCase())
      .filter(Boolean),
  ),
];

if (!codes.length) {
  console.error(`No codes found in ${file}.`);
  process.exit(1);
}

const h = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };

// `ignore-duplicates` rather than merge: a code already in the pool may
// already have been given to somebody, and rewriting its row would be a way
// to quietly change what a founder was promised.
const res = await fetch(`${url}/rest/v1/partner_codes`, {
  method: "POST",
  headers: { ...h, Prefer: "resolution=ignore-duplicates,return=representation" },
  body: JSON.stringify(codes.map((code) => ({ code, partner, trial_days: trialDays }))),
});

if (!res.ok) {
  console.error(res.status, await res.text());
  process.exit(1);
}

const inserted = await res.json();
console.log(`Read ${codes.length} code${codes.length === 1 ? "" : "s"} from ${file}`);
console.log(`Added ${inserted.length} new to the ${partner} pool (${codes.length - inserted.length} already present)`);

// Anyone who qualified while the pool was empty is owed one. Settle them now
// rather than waiting for the next qualifying purchase to notice.
const filled = await fetch(`${url}/rest/v1/rpc/fill_partner_grants`, {
  method: "POST",
  headers: h,
  body: JSON.stringify({ p_partner: partner }),
}).then((r) => r.json());

if (filled > 0) console.log(`Settled ${filled} workspace${filled === 1 ? "" : "s"} that were owed a code`);

const status = await fetch(`${url}/rest/v1/rpc/partner_pool_status`, {
  method: "POST",
  headers: h,
  body: JSON.stringify({ p_partner: partner }),
}).then((r) => r.json());

const row = Array.isArray(status) ? status[0] : status;
console.log(`Pool now: ${row?.available ?? "?"} available, ${row?.owed ?? "?"} still owed`);
