import { loadEnv } from "./env.mjs";
loadEnv();

/**
 * Drains the email outbox once, the same way /api/jobs/run does. Handy for
 * checking what publishing a changelog actually queued.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };

const queued = await fetch(`${url}/rest/v1/email_outbox?select=id,to_email,subject,kind&sent_at=is.null&order=created_at`, { headers: h }).then(r => r.json());
console.log(`${queued.length} queued`);
for (const e of queued) console.log(`  ${e.kind.padEnd(12)} ${e.to_email.padEnd(30)} ${e.subject}`);

if (process.argv[2] === "--send") {
  const res = await fetch("http://localhost:3000/api/jobs/run", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  console.log("\ndrain ->", res.status, await res.text());
} else {
  console.log("\n(dry run — pass --send to actually dispatch)");
}
