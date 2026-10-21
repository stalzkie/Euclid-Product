import { loadEnv } from "./env.mjs";
loadEnv();
import { createPolar } from "@polar-sh/sdk/2027-01";

/**
 * Creates the waitlist promotion's discount in Polar, once.
 *
 *   node scripts/make-waitlist-discount.mjs
 *   POLAR_SERVER=sandbox node scripts/make-waitlist-discount.mjs
 *
 * One month at -100% on Indie Monthly, after which the subscription renews at
 * $12 rather than ending. Codeless, like the other three: this deployment
 * applies discounts by id from the server, so nothing is typed at Polar's
 * checkout page and nothing can be shared further than the link.
 *
 * WHY A SCRIPT AND NOT THE DASHBOARD
 *
 * Four fields have to agree with four places in the code — the product, the
 * duration, the basis points and the cap — and a discount built by hand in a
 * form fails silently when one of them is wrong: the checkout succeeds, the
 * founder is charged, and the e-mail that promised a free month is the thing
 * that turns out to have been lying. Here the values sit next to the reasons
 * for them, and a second run prints the existing discount rather than making
 * another.
 *
 * THE CAP
 *
 * `max_redemptions` is the only thing bounding what a -100% discount can cost,
 * and it is set well above the waitlist (7 rows on 2026-10-21) so that people
 * who join between now and the announcement are not turned away, while still
 * being a number somebody would notice being reached. One per customer, so a
 * founder cannot re-run it on a second workspace from the same Polar customer.
 *
 * Eligibility is enforced twice over regardless: `onWaitlist` checks the
 * signed-in address against `waitlist_signups` before the checkout is created,
 * so the cap is a backstop rather than the gate.
 */

const NAME = "Waitlist free month";
const MAX_REDEMPTIONS = 25;

const token = process.env.POLAR_ACCESS_TOKEN;
const product = process.env.POLAR_PRODUCT_INDIE_MONTHLY;
const server = process.env.POLAR_SERVER || "sandbox";

if (!token) {
  console.error("POLAR_ACCESS_TOKEN is not set.");
  process.exit(1);
}
if (!product) {
  // Without it the discount would apply to every product, which on a -100%
  // discount means a free month of Pro as well.
  console.error("POLAR_PRODUCT_INDIE_MONTHLY is not set; refusing to create an unrestricted discount.");
  process.exit(1);
}

const polar = createPolar({ accessToken: token, environment: server });

/** Both casings, because the SDK's reads and writes do not agree on one. */
const field = (obj, snake, camel) => obj?.[camel] ?? obj?.[snake];

function describe(d) {
  const products = (d.products ?? []).map((p) => p.name).join(", ") || "(all products)";
  return [
    `  id        ${d.id}`,
    `  name      ${d.name}`,
    `  discount  ${field(d, "basis_points", "basisPoints") / 100}%`,
    `  duration  ${d.duration} x ${field(d, "duration_in_months", "durationInMonths")} month(s)`,
    `  products  ${products}`,
    `  cap       ${field(d, "max_redemptions", "maxRedemptions")} total, ` +
      `${field(d, "max_redemptions_per_customer", "maxRedemptionsPerCustomer")} per customer`,
    `  redeemed  ${field(d, "redemptions_count", "redemptionsCount") ?? 0}`,
    `  code      ${d.code ?? "(none — applied by the server)"}`,
  ].join("\n");
}

const existing = (await polar.discounts.list({ limit: 100 })).items ?? [];
const already = existing.find((d) => d.name === NAME);

if (already) {
  console.log(`${NAME} already exists on ${server}:`);
  console.log(describe(already));
  console.log(`\nPOLAR_DISCOUNT_WAITLIST=${already.id}`);
  // Not `process.exit`. Node on Windows trips a libuv assertion when the
  // process is torn down with the SDK's keep-alive sockets still open, which
  // reports a failure for a run that did exactly what it should.
  process.exitCode = 0;
}

if (!already) {
const created = await polar.discounts.create({
  name: NAME,
  type: "percentage",
  basis_points: 10_000,
  duration: "repeating",
  duration_in_months: 1,
  products: [product],
  max_redemptions: MAX_REDEMPTIONS,
  max_redemptions_per_customer: 1,
  metadata: { promo: "waitlist" },
});

console.log(`Created on ${server}:`);
console.log(describe(created));
console.log(`\nPOLAR_DISCOUNT_WAITLIST=${created.id}`);
}
