import { loadEnv } from "./env.mjs";
loadEnv();

/**
 * Creates (or reuses) a confirmed user, attaches them to the seeded Driftnote
 * workspace, and prints a magic link that signs them in. Local setup only.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const app = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const email = process.argv[2];
if (!email) { console.error("usage: node scripts/make-session.mjs <email>"); process.exit(1); }

const h = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };

// Create the user if they don't exist yet.
const list = await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers: h }).then(r => r.json());
let user = (list.users ?? []).find(u => u.email?.toLowerCase() === email.toLowerCase());
if (!user) {
  const created = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST", headers: h,
    body: JSON.stringify({ email, email_confirm: true, user_metadata: { full_name: "Maya Reyes" } }),
  });
  user = await created.json();
  if (!user.id) { console.error("create failed:", user); process.exit(1); }
  console.log("created user", user.id);
} else {
  console.log("reusing user", user.id);
}

// Attach to the seeded workspace so the dashboard has data.
const member = await fetch(`${url}/rest/v1/workspace_members`, {
  method: "POST",
  headers: { ...h, Prefer: "resolution=merge-duplicates" },
  body: JSON.stringify({
    workspace_id: "11111111-1111-1111-1111-111111111111",
    user_id: user.id,
    role: "owner",
    name: "Maya Reyes",
  }),
});
console.log("membership ->", member.status === 201 || member.status === 200 ? "ok" : await member.text());

// A magic link that logs straight in.
//
// `redirect_to` goes at the top level. Nesting it under `options` is the
// supabase-js convention, not the REST one: GoTrue ignores the unknown key and
// silently falls back to the project's Site URL. The token then lands as a
// fragment on "/", which the middleware bounces to /signup, and the sign-in is
// lost with no error anywhere.
const link = await fetch(`${url}/auth/v1/admin/generate_link`, {
  method: "POST", headers: h,
  body: JSON.stringify({ type: "magiclink", email, redirect_to: `${app}/auth/callback` }),
}).then(r => r.json());

const action = link.properties?.action_link ?? link.action_link;
if (!action) { console.error("generate_link failed:", link); process.exit(1); }
console.log("\nSIGN-IN LINK:\n" + action);
