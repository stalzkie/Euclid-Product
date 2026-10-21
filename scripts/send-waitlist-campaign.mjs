import { loadEnv } from "./env.mjs";
loadEnv();
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { createPolar } from "@polar-sh/sdk/2027-01";

/**
 * Sends the waitlist its free month — once per address, ever.
 *
 *   node scripts/send-waitlist-campaign.mjs            # what would go out
 *   node scripts/send-waitlist-campaign.mjs --send     # queue it
 *   node scripts/send-waitlist-campaign.mjs --send --drain
 *
 * THE EXPIRY IS NOT TYPED IN
 *
 * The e-mail tells the reader how long the link is good for, and the only
 * thing that actually decides that is `ends_at` on the Polar discount. A
 * number written in the copy is a number that drifts from the discount the
 * first time either is changed, and the direction it drifts does not matter:
 * promising less than Polar allows wastes the promotion, promising more sends
 * somebody to a checkout that prices at $12 on a date we told them was fine.
 *
 * So the campaign reads `ends_at` and counts the days itself, and refuses to
 * send at all if the discount has no end date. That is deliberate: it is the
 * one claim in the e-mail nothing else can check.
 *
 * WHY THE OUTBOX
 *
 * Rows go into `email_outbox` rather than straight to Resend. The outbox is
 * already the thing with the retry schedule, the claim-once semantics and the
 * multipart columns (0015, 0029) — and, for a campaign, it is the only record
 * of who has been written to. `waitlist_signups` belongs to the marketing
 * site and this app does not write to it, so "already sent" cannot be a
 * column there. It is the presence of a `waitlist_offer` row here.
 *
 * Which makes a second run safe, and that matters more than it sounds: the
 * failure this guards against is a founder being told twice that their first
 * month is free, which reads as either a mistake or a second offer.
 */

const send = process.argv.includes("--send");
const drain = process.argv.includes("--drain");

const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const origin = process.env.EMAIL_ORIGIN || "https://app.euclidhq.com";

if (!supabase || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

const db = {
  apikey: serviceKey,
  authorization: `Bearer ${serviceKey}`,
  "content-type": "application/json",
};

/* ------------------------------------------------- what the discount allows */

const discountId = process.env.POLAR_DISCOUNT_WAITLIST;
if (!discountId) {
  console.error("POLAR_DISCOUNT_WAITLIST is not set — there is no free month to offer.");
  process.exit(1);
}

const polar = createPolar({
  accessToken: process.env.POLAR_ACCESS_TOKEN,
  environment: process.env.POLAR_SERVER || "sandbox",
});

const discount = await polar.discounts.get(discountId);
const endsAt = discount.endsAt ?? discount.ends_at;

if (!endsAt) {
  console.error(
    `"${discount.name}" has no end date.\n` +
      "The e-mail says how long the link is good for, and nothing but `ends_at`\n" +
      "decides that. Set it in Polar, then run this again.",
  );
  process.exit(1);
}

const expiresInDays = Math.floor((new Date(endsAt) - Date.now()) / 86_400_000);
if (expiresInDays < 1) {
  console.error(`"${discount.name}" ends ${endsAt}, which is not far enough away to offer.`);
  process.exit(1);
}

/* ------------------------------------------------------------ who gets it */

const signups = await fetch(
  `${supabase}/rest/v1/waitlist_signups?select=email,queue_position&order=queue_position.asc`,
  { headers: db },
).then((r) => r.json());

const already = await fetch(
  `${supabase}/rest/v1/email_outbox?select=to_email,sent_at&kind=eq.waitlist_offer`,
  { headers: db },
).then((r) => r.json());

const writtenTo = new Set(already.map((r) => r.to_email.trim().toLowerCase()));

// One row per address, not per sign-up: the same person joining twice is one
// person, and the free month is one per customer at Polar anyway.
const seen = new Set();
const recipients = [];
for (const row of signups) {
  const address = row.email?.trim();
  if (!address) continue;
  const key = address.toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);
  recipients.push({ address, position: row.queue_position, done: writtenTo.has(key) });
}

/* ------------------------------------------------------------- the e-mail */

const out = path.join(os.tmpdir(), `euclid-campaign-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: ["src/lib/emails/waitlist-offer.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  alias: { "@": "./src" },
  outfile: out,
  logLevel: "warning",
});
const { WAITLIST_OFFER_SUBJECT, WAITLIST_PROMO, waitlistOfferHtml, waitlistOfferText } =
  await import(pathToFileURL(out).href);
fs.rmSync(out, { force: true });

const signOff = process.env.EMAIL_SIGN_OFF || "Stal from Euclid";
const replyTo = process.env.EMAIL_REPLY_TO || null;

const content = (address) => ({
  claimUrl: `${origin}/signup?promo=${WAITLIST_PROMO}`,
  monthlyPrice: 12,
  expiresInDays,
  recipient: address,
  signOff,
  origin,
});

/* ----------------------------------------------------------------- report */

console.log(`\n  discount  ${discount.name} (-100%, one month on Indie Monthly)`);
console.log(`  ends      ${endsAt}  →  the e-mail will say ${expiresInDays} days`);
console.log(`  subject   ${WAITLIST_OFFER_SUBJECT}`);
console.log(`  claim     ${content("x").claimUrl}\n`);

const pending = recipients.filter((r) => !r.done);
for (const r of recipients) {
  console.log(`  ${r.done ? "skip" : "send"}  #${String(r.position).padEnd(3)} ${r.address}`);
}
console.log(
  `\n  ${recipients.length} on the waitlist · ${pending.length} to write to · ` +
    `${recipients.length - pending.length} already written to`,
);

if (!send) {
  console.log("\n  (dry run — pass --send to queue these)\n");
  await esbuild.stop();
  process.exitCode = 0;
} else if (!pending.length) {
  console.log("\n  Nothing to do.\n");
  await esbuild.stop();
  process.exitCode = 0;
} else {
  const rows = pending.map(({ address }) => ({
    to_email: address,
    subject: WAITLIST_OFFER_SUBJECT,
    body: waitlistOfferText(content(address)),
    html: waitlistOfferHtml(content(address)),
    reply_to: replyTo,
    kind: "waitlist_offer",
  }));

  const res = await fetch(`${supabase}/rest/v1/email_outbox`, {
    method: "POST",
    headers: { ...db, prefer: "return=representation" },
    body: JSON.stringify(rows),
  });
  const body = await res.text();
  console.log(`\n  queued ${res.status} — ${res.ok ? `${rows.length} row(s)` : body.slice(0, 300)}`);

  if (res.ok && drain) {
    const endpoint = `${origin}/api/jobs/run`;
    const run = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    console.log(`  drain  ${run.status} — ${(await run.text()).slice(0, 300)}`);
  } else if (res.ok) {
    console.log("  (queued only — pass --drain to dispatch now, or wait for the scheduler)");
  }

  await esbuild.stop();
  process.exitCode = res.ok ? 0 : 1;
}
