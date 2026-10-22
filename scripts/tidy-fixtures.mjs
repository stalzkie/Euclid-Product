import { loadEnv } from "./env.mjs";
loadEnv();

/**
 * Find what the test suites left behind in the live database, and remove it on
 * demand.
 *
 * Usage:
 *   node scripts/tidy-fixtures.mjs            # list what it would remove
 *   node scripts/tidy-fixtures.mjs --apply    # remove it
 *
 * WHY THIS EXISTS
 *
 * The integration and browser suites run against the production Supabase
 * project, because there is no Docker on this machine — see HANDOFF.md. They
 * create and destroy their own fixtures, and almost always succeed at the
 * second part. Almost: `referrals.test.ts` kept its cleanup inside the first
 * `describe`, so the workspace its second one created was never removed, and
 * every run left one more `Ref orphan …` row behind.
 *
 * That was invisible until /admin started counting workspaces. Two fixture
 * rows out of five made the activation funnel read "5 signed up, 1 onboarded"
 * when the truth was three real workspaces. The leak itself is fixed; this is
 * for the rows it already left, and for the next suite that forgets.
 *
 * WHAT IT WILL AND WILL NOT TOUCH
 *
 * A fixture is identified by **two** things agreeing, never one: a slug the
 * suites mint (`itest-`, `e2e-`) **and** no members at all. A real workspace
 * always has an owner, because `create_workspace` makes one in the same
 * statement — so the membership count is the guard that makes a slug pattern
 * safe to act on. Anything matching one but not the other is printed and
 * skipped, which is the case worth seeing by eye.
 *
 * Deleting a workspace cascades to its boards, posts, votes, prompts and
 * captured events, so the counts are printed before anything goes.
 *
 * Dry by default. A script that writes to production on no flag is one that
 * eventually runs by accident.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set");
}

const apply = process.argv.includes("--apply");
const h = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };

const ok = (s) => `\x1b[32m${s}\x1b[0m`;
const warn = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

/** Slug prefixes the suites mint. Nothing a founder can type starts with these. */
const FIXTURE_SLUGS = ["itest-", "e2e-"];
/** The domain the integration suite signs its throwaway users up with. */
const FIXTURE_EMAIL = "@euclid-itest.com";

async function rest(path, init = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...h, ...init.headers } });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? [] : res.json();
}

async function count(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { ...h, prefer: "count=exact", range: "0-0" },
  });
  const range = res.headers.get("content-range") ?? "";
  return Number(range.split("/")[1] ?? 0);
}

const workspaces = await rest("workspaces?select=id,name,slug,plan,created_at&order=created_at");

const suspects = [];
for (const w of workspaces) {
  const looksLikeFixture = FIXTURE_SLUGS.some((prefix) => w.slug.startsWith(prefix));
  const members = await count(`workspace_members?workspace_id=eq.${w.id}&select=user_id`);

  if (!looksLikeFixture && members > 0) continue;

  const boards = await count(`boards?workspace_id=eq.${w.id}&select=id`);
  const row = { ...w, members, boards, looksLikeFixture };

  if (looksLikeFixture && members === 0) suspects.push(row);
  else {
    // One signal without the other. Printed rather than acted on: an
    // ownerless real workspace is a bug worth seeing, and a fixture slug with
    // a member means somebody joined one by hand.
    console.log(
      warn("  skipped  ") +
        `${w.name} (${w.slug}) — ${
          looksLikeFixture ? `fixture slug but ${members} member(s)` : "no members but a real slug"
        }`,
    );
  }
}

const users = await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers: h })
  .then((r) => r.json())
  .then((j) => (j.users ?? []).filter((u) => (u.email ?? "").endsWith(FIXTURE_EMAIL)));

console.log(
  `\n${workspaces.length} workspaces, ${suspects.length} look like fixtures; ` +
    `${users.length} fixture login(s).\n`,
);

for (const s of suspects) {
  console.log(
    `  ${s.created_at.slice(0, 10)}  ${s.name}  ${dim(`${s.slug} · ${s.plan} · ${s.boards} board(s)`)}`,
  );
}
for (const u of users) console.log(`  ${u.created_at.slice(0, 10)}  ${u.email}  ${dim(u.id)}`);

if (suspects.length === 0 && users.length === 0) {
  console.log(ok("Nothing to tidy."));
  process.exit(0);
}

if (!apply) {
  console.log(`\n${warn("Dry run.")} Re-run with --apply to remove the rows listed above.`);
  process.exit(0);
}

for (const s of suspects) {
  await rest(`workspaces?id=eq.${s.id}`, { method: "DELETE" });
  console.log(ok(`  removed workspace ${s.name}`));
}
for (const u of users) {
  const res = await fetch(`${url}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: h });
  console.log(res.ok ? ok(`  removed login ${u.email}`) : warn(`  could not remove ${u.email}`));
}

console.log(ok("\nDone."));
