import { loadEnv } from "./env.mjs";
loadEnv();
const key = process.env.ANTHROPIC_API_KEY ?? "";
const h = {
  "x-api-key": key,
  "anthropic-version": "2023-06-01",
  "content-type": "application/json",
};

// Reuse one if it already exists, so this is safe to re-run.
const list = await fetch("https://api.anthropic.com/v1/organizations/workspaces", { headers: h })
  .then((r) => r.json());
let ws = (list.data ?? []).find((w) => w.name === "Euclid");

if (!ws) {
  const res = await fetch("https://api.anthropic.com/v1/organizations/workspaces", {
    method: "POST",
    headers: h,
    body: JSON.stringify({ name: "Euclid" }),
  });
  const body = await res.text();
  if (!res.ok) { console.log("create failed:", res.status, body.slice(0, 400)); process.exit(1); }
  ws = JSON.parse(body);
  console.log("created workspace:", ws.name);
} else {
  console.log("reusing workspace:", ws.name);
}

console.log("ANTHROPIC_WORKSPACE_ID=" + ws.id);

// Prove it works.
const msg = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { ...h, "anthropic-workspace-id": ws.id },
  body: JSON.stringify({
    model: "claude-haiku-4-5",
    max_tokens: 24,
    messages: [{ role: "user", content: "Reply with exactly: ok" }],
  }),
});
const out = await msg.text();
console.log("\ntest call ->", msg.status, out.slice(0, 220));
