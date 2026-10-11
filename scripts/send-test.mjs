import { loadEnv } from "./env.mjs";
loadEnv();

/**
 * Sends one real email through the configured provider, to prove the path
 * works. Run it yourself when you want to verify delivery:
 *
 *   node scripts/send-test.mjs you@example.com
 */
const to = process.argv[2];
if (!to) { console.error("usage: node scripts/send-test.mjs <your-email>"); process.exit(1); }

const key = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM;
if (!key || !from) { console.error("RESEND_API_KEY and EMAIL_FROM must be set."); process.exit(1); }

const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
  body: JSON.stringify({
    from,
    to,
    subject: "You asked, we shipped: CSV and Markdown export",
    text: [
      "Hi there,",
      "",
      'You voted for "Export entries to CSV and Markdown" on Driftnote\'s feedback board. It is live today.',
      "",
      "You can now export every entry from Settings → Data. Pro and Team get one Markdown file per entry, with the date in the filename and your tags as front matter. Free gets a single CSV.",
      "",
      "— Maya",
      "",
      "You are getting this because you voted on Driftnote's feedback board.",
      "(This is a delivery test from Euclid.)",
    ].join("\n"),
  }),
});

console.log(res.status, (await res.text()).slice(0, 300));
