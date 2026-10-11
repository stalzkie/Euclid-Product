import { loadEnv } from "./env.mjs";
loadEnv();
import { createHmac } from "node:crypto";

/** Exercises JWT identity, the magic-link flow, and the moderation queue. */
const app = "http://localhost:3000";
const BOARD = "brd_8f2k1x";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (payload, secret) => {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(payload);
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
};

const call = (path, init = {}) =>
  fetch(app + path, {
    ...init,
    headers: { "content-type": "application/json", origin: app, ...(init.headers ?? {}) },
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

console.log("=== 1. JWT identity");
await fetch(`${url}/rest/v1/boards?public_id=eq.${BOARD}`, {
  method: "PATCH", headers: h, body: JSON.stringify({ identity_mode: "jwt" }),
});

const token = sign(
  { sub: "host-user-42", email: "paying.customer@acme.com", name: "Dana Okafor",
    plan: "pro", signup_date: "2025-02-11", exp: Math.floor(Date.now() / 1000) + 3600 },
  process.env.EUCLID_SECRET,
);
const board = await call(`/api/public/board?board=${BOARD}&token=${encodeURIComponent(token)}`);
console.log(`   board load: ${board.status} · viewer=${board.body.viewer?.kind} (${board.body.viewer?.label})`);

const jwtUser = await fetch(`${url}/rest/v1/end_users?select=kind,email,segments,vote_weight&external_key=eq.jwt:host-user-42`, { headers: h }).then(r => r.json());
console.log("   stored:", JSON.stringify(jwtUser[0] ?? null));

console.log("\n   tampered token must be rejected:");
const bad = sign({ sub: "host-user-42", plan: "pro", exp: Math.floor(Date.now()/1000)+3600 }, "wrong-secret");
const badRes = await call(`/api/public/board?board=${BOARD}&token=${encodeURIComponent(bad)}`);
console.log(`   ${badRes.status} · viewer=${badRes.body.viewer?.kind} (should fall back to anonymous, not pro)`);

const expired = sign({ sub: "host-user-42", plan: "pro", exp: Math.floor(Date.now()/1000)-60 }, process.env.EUCLID_SECRET);
const expRes = await call(`/api/public/board?board=${BOARD}&token=${encodeURIComponent(expired)}`);
console.log(`   expired -> viewer=${expRes.body.viewer?.kind}`);

console.log("\n=== 2. magic link for an end user");
const magic = await call("/api/public/magic", {
  method: "POST", body: JSON.stringify({ board: BOARD, email: "newvoter@example.com" }),
});
console.log(`   request: ${magic.status} ${JSON.stringify(magic.body)}`);
const link = await fetch(`${url}/rest/v1/magic_links?select=token,email,expires_at&order=created_at.desc&limit=1`, { headers: h }).then(r => r.json());
console.log(`   issued: ${link[0] ? link[0].email + " token " + link[0].token.slice(0, 12) + "…" : "none"}`);
const queued = await fetch(`${url}/rest/v1/email_outbox?select=to_email,subject,kind&order=created_at.desc&limit=1`, { headers: h }).then(r => r.json());
console.log(`   queued email: ${queued[0] ? queued[0].kind + " -> " + queued[0].to_email : "none"}`);

if (link[0]) {
  const follow = await fetch(`${app}/api/public/magic?token=${link[0].token}`, { redirect: "manual" });
  console.log(`   following link: ${follow.status} -> ${follow.headers.get("location")}`);
  const verified = await fetch(`${url}/rest/v1/end_users?select=email,email_verified&external_key=eq.email:newvoter@example.com`, { headers: h }).then(r => r.json());
  console.log(`   verified: ${JSON.stringify(verified[0] ?? null)}`);
}

console.log("\n=== 3. moderation queue");
await fetch(`${url}/rest/v1/boards?public_id=eq.${BOARD}`, {
  method: "PATCH", headers: h, body: JSON.stringify({ identity_mode: "email", require_approval: true }),
});
const moderated = await call("/api/public/post", {
  method: "POST",
  body: JSON.stringify({ board: BOARD, title: "A post that should be held for approval", body: "testing the approval queue" }),
});
console.log(`   submitted: ${moderated.status} held=${moderated.body.held} (#${moderated.body.number})`);
const publicList = await call(`/api/public/board?board=${BOARD}`);
const visible = publicList.body.posts?.some(p => p.number === moderated.body.number);
console.log(`   visible on the public board before approval: ${visible} (should be false)`);

// Put the board back and clean up.
await fetch(`${url}/rest/v1/boards?public_id=eq.${BOARD}`, {
  method: "PATCH", headers: h, body: JSON.stringify({ require_approval: false }),
});
if (moderated.body.id) {
  await fetch(`${url}/rest/v1/posts?id=eq.${moderated.body.id}`, { method: "DELETE", headers: h });
  console.log("   cleaned up the test post");
}
