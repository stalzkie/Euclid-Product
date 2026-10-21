import { loadEnv } from "./env.mjs";
loadEnv();
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { createPolar } from "@polar-sh/sdk/2027-01";

/**
 * Checks the waitlist promotion by its effect, not by its configuration.
 *
 *   node scripts/check-waitlist-promo.mjs
 *
 * Four things have to be true at once for a waitlist founder to get their
 * free month, and each one fails quietly on its own:
 *
 *   1. The address is recognised as being on the waitlist — against the real
 *      `waitlist_signups` table, because that table belongs to the marketing
 *      site and nothing in this repo would notice it being renamed.
 *   2. Somebody who is not on it is not recognised, which is the half that
 *      costs money when it is wrong.
 *   3. The app picks the waitlist discount over the standing launch offer,
 *      and still yields to the student rate.
 *   4. Polar prices Indie Monthly at $0 with that discount id.
 *
 * The last one creates a real checkout session on the production
 * organisation. Nothing is charged: a checkout is a quote until someone pays
 * it, which is the same method the 4-for-3 promotion was verified with.
 *
 * Exits non-zero if any of it is wrong, so it can gate a deploy.
 */

const out = path.join(os.tmpdir(), `euclid-promo-check-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: ["scripts/_promo-check-entry.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  alias: { "@": "./src" },
  outfile: out,
  logLevel: "warning",
});
const app = await import(pathToFileURL(out).href);
fs.rmSync(out, { force: true });

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `  (got ${actual}, want ${expected})`}`);
}

/* ---------------------------------------------------------------- the gate */

console.log("\nWho the free month is for");

// Read a real address out of the table rather than hard-coding one: the point
// is that the lookup finds whoever is actually on the list today.
const member = await app.firstWaitlistEmail();
if (!member) {
  console.log("  FAIL  the waitlist is empty, so nothing here can be checked");
  process.exitCode = 1;
} else {
  check(`${member} is on the waitlist`, await app.onWaitlist(member), true);
  check(
    "the same address shouted is the same person",
    await app.onWaitlist(member.toUpperCase()),
    true,
  );
  check(
    "  ...and with the whitespace a copy-paste leaves behind",
    await app.onWaitlist(`  ${member}  `),
    true,
  );
}

check(
  "a stranger is not",
  await app.onWaitlist("definitely-not-on-the-list@example.test"),
  false,
);
// A LIKE wildcard must not match everyone. `%@%` is what an attacker would
// try if the address went into the filter unescaped.
check("a wildcard is an address, not a pattern", await app.onWaitlist("%@%"), false);
check("an empty address is nobody", await app.onWaitlist(""), false);

/* ------------------------------------------------------------ which discount */

console.log("\nWhich discount a waitlist checkout carries");

check(
  "Indie monthly qualifies",
  app.promoEligible(app.WAITLIST, "indie", "monthly"),
  true,
);
check("Pro does not", app.promoEligible(app.WAITLIST, "pro", "monthly"), false);
check("yearly does not", app.promoEligible(app.WAITLIST, "indie", "yearly"), false);
check(
  "it beats the standing launch offer",
  app.discountForCheckout(false, app.WAITLIST),
  process.env.POLAR_DISCOUNT_WAITLIST,
);
check(
  "a verified student still gets the student rate",
  app.discountForCheckout(true, app.WAITLIST),
  process.env.POLAR_DISCOUNT_STUDENT,
);
check(
  "a checkout that did not ask for it is unaffected",
  app.discountForCheckout(false),
  process.env.POLAR_DISCOUNT_FIRST_PURCHASE,
);

/* ------------------------------------------------------------- what it costs */

console.log("\nWhat Polar actually charges");

const discount = process.env.POLAR_DISCOUNT_WAITLIST;
const product = process.env.POLAR_PRODUCT_INDIE_MONTHLY;
if (!discount || !product) {
  console.log("  FAIL  POLAR_DISCOUNT_WAITLIST or POLAR_PRODUCT_INDIE_MONTHLY is unset");
  failures += 1;
} else {
  const polar = createPolar({
    accessToken: process.env.POLAR_ACCESS_TOKEN,
    environment: process.env.POLAR_SERVER || "sandbox",
  });

  const list = await polar.checkouts.create({ products: [product] });
  const promo = await polar.checkouts.create({ products: [product], discount_id: discount });

  const amount = (c) => c.totalAmount ?? c.total_amount;
  const dollars = (cents) => `$${(cents / 100).toFixed(2)}`;

  console.log(`  list price   ${dollars(amount(list))}`);
  console.log(`  with promo   ${dollars(amount(promo))}`);
  check("the first month is free", amount(promo), 0);
  // Guards against a discount that prices at zero because the product does.
  check("and the thing being discounted is not already free", amount(list) > 0, true);
}

await esbuild.stop();
console.log(failures ? `\n${failures} check(s) failed.\n` : "\nAll checks passed.\n");
process.exitCode = failures ? 1 : 0;
