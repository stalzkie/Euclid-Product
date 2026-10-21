import { loadEnv } from "./env.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

loadEnv();

/**
 * Sends the waitlist offer email — the real template, both parts, through
 * the configured provider.
 *
 *   node scripts/send-waitlist-offer.mjs you@example.com
 *
 * The template is TypeScript behind an `@/` alias, so it is bundled with
 * esbuild rather than imported directly. That keeps one copy of the copy:
 * the alternative is a script that reimplements the email and then drifts
 * from the thing that actually ships.
 */
const to = process.argv[2];
if (!to) {
  console.error("usage: node scripts/send-waitlist-offer.mjs <email>");
  process.exit(1);
}

const key = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM;
if (!key || !from) {
  console.error("RESEND_API_KEY and EMAIL_FROM must be set.");
  process.exit(1);
}

/* The inbox is not localhost. Links and the logo have to resolve from a
   phone, so the origin is the deployed app regardless of NEXT_PUBLIC_APP_URL,
   which on this machine points at a dev server. */
const origin = process.env.EMAIL_ORIGIN || "https://app.euclidhq.com";

const out = path.join(os.tmpdir(), `euclid-waitlist-${process.pid}.mjs`);
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

const content = {
  claimUrl: `${origin}/signup?promo=${WAITLIST_PROMO}`,
  monthlyPrice: 12,
  expiresInDays: 30,
  recipient: to,
  signOff: process.env.EMAIL_SIGN_OFF || "Stal from Euclid",
  origin,
};

const replyTo = process.env.EMAIL_REPLY_TO || null;

const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
  body: JSON.stringify({
    from,
    to,
    subject: WAITLIST_OFFER_SUBJECT,
    // Both parts, always. A message with only one of the two is a spam
    // signal on its own — see deliver() in server/jobs.ts.
    text: waitlistOfferText(content),
    html: waitlistOfferHtml(content),
    ...(replyTo ? { reply_to: replyTo } : {}),
  }),
});

const payload = await res.text();
console.log(`to:       ${to}`);
console.log(`from:     ${from}`);
console.log(`reply-to: ${replyTo ?? "(sender)"}`);
console.log(`subject:  ${WAITLIST_OFFER_SUBJECT}`);
console.log(`claim:    ${content.claimUrl}`);
console.log(`resend:   ${res.status} ${payload.slice(0, 300)}`);

/* Shut the bundler's worker down and let node exit on its own. `process.exit`
   here trips a libuv assertion on Windows while esbuild's service is still
   closing, which reports a failure for an email that already went out. */
await esbuild.stop();
process.exitCode = res.ok ? 0 : 1;
