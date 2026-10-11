import { loadEnv } from "./env.mjs";
loadEnv();
const key = process.env.RESEND_API_KEY;
const h = { authorization: `Bearer ${key}`, "content-type": "application/json" };

const { data } = await fetch("https://api.resend.com/domains", { headers: h }).then(r => r.json());
const target = data.find(d => d.name === "euclidhq.com");
if (!target) { console.log("euclidhq.com not found in Resend"); process.exit(0); }

console.log("triggering verification for euclidhq.com...");
const v = await fetch(`https://api.resend.com/domains/${target.id}/verify`, { method: "POST", headers: h });
console.log("  ->", v.status, (await v.text()).slice(0, 200));

for (let i = 0; i < 8; i++) {
  await new Promise(r => setTimeout(r, 15000));
  const d = await fetch(`https://api.resend.com/domains/${target.id}`, { headers: h }).then(r => r.json());
  const states = (d.records ?? []).map(r => `${r.type}:${r.status}`).join(" ");
  console.log(`  [${(i + 1) * 15}s] domain=${d.status}  ${states}`);
  if (d.status === "verified") { console.log("\nVERIFIED"); break; }
}
