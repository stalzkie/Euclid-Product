import { loadEnv } from "./env.mjs";
loadEnv();

const key = process.env.RESEND_API_KEY;
if (!key) { console.log("No RESEND_API_KEY set."); process.exit(0); }

const res = await fetch("https://api.resend.com/domains", {
  headers: { authorization: `Bearer ${key}` },
});
if (!res.ok) {
  console.log("Resend API error:", res.status, (await res.text()).slice(0, 300));
  process.exit(0);
}
const { data } = await res.json();
if (!data?.length) { console.log("No domains registered in Resend."); process.exit(0); }

for (const d of data) {
  console.log(`\nDOMAIN  ${d.name}   status: ${d.status}   region: ${d.region}`);
  const detail = await fetch(`https://api.resend.com/domains/${d.id}`, {
    headers: { authorization: `Bearer ${key}` },
  }).then(r => r.json());

  console.log("Required DNS records:");
  for (const r of detail.records ?? []) {
    console.log(`  [${r.status}] ${r.type.padEnd(5)} name=${r.name}`);
    console.log(`          value=${r.value}`);
    if (r.priority) console.log(`          priority=${r.priority}`);
    if (r.ttl) console.log(`          ttl=${r.ttl}`);
  }
}
