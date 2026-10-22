import { loadEnv } from "./env.mjs";
loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: key, authorization: `Bearer ${key}` };

const tables = [
  "workspaces", "workspace_members", "project_profiles", "boards", "end_users",
  "themes", "posts", "votes", "comments", "duplicate_suggestions",
  "build_prompts", "build_prompt_messages", "changelog_entries", "changelog_posts",
  "chat_threads", "chat_messages", "recommendations", "activity",
  "rate_limits", "email_outbox", "magic_links", "jobs",
  "analytics_events",
];

let ok = 0;
for (const t of tables) {
  const r = await fetch(`${url}/rest/v1/${t}?select=*&limit=0`, { headers: h });
  if (r.ok) ok += 1;
  else console.log(`  MISSING ${t} -> ${r.status} ${(await r.text()).slice(0, 120)}`);
}
console.log(`tables: ${ok}/${tables.length}`);

// Functions the app calls through RPC.
const rpcs = [
  ["board_daily_series", { p_board: "00000000-0000-0000-0000-000000000000", p_days: 7 }],
  ["board_votes_by_plan", { p_board: "00000000-0000-0000-0000-000000000000" }],
  ["board_time_to_ship", { p_board: "00000000-0000-0000-0000-000000000000" }],
  ["post_paying_share", { p_post: "00000000-0000-0000-0000-000000000000" }],
  ["post_vote_velocity", { p_board: "00000000-0000-0000-0000-000000000000", p_days: 7 }],
  ["roll_usage_period", { p_workspace: "00000000-0000-0000-0000-000000000000" }],
  ["check_rate_limit", { p_board: "00000000-0000-0000-0000-000000000000", p_bucket: "t", p_actor: "t", p_max: 1, p_window: "1 hour" }],
  ["match_posts", { p_board: "00000000-0000-0000-0000-000000000000", p_embedding: new Array(1536).fill(0), p_exclude: null, p_threshold: 0.8, p_limit: 1 }],
  // 36500 days, so existence is checked without deleting anything: the
  // function removes rows older than the window it is given.
  ["prune_analytics_events", { p_days: 36500 }],
];

let rok = 0;
for (const [name, args] of rpcs) {
  const r = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { ...h, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  // A foreign-key failure is fine here; "function does not exist" is not.
  if (r.ok) rok += 1;
  else {
    const body = await r.text();
    if (/does not exist|Could not find/i.test(body)) console.log(`  MISSING rpc ${name} -> ${body.slice(0, 160)}`);
    else { rok += 1; }
  }
}
console.log(`rpcs: ${rok}/${rpcs.length}`);

// pgvector must be live for duplicate detection.
const v = await fetch(`${url}/rest/v1/rpc/match_posts`, {
  method: "POST",
  headers: { ...h, "content-type": "application/json" },
  body: JSON.stringify({ p_board: "00000000-0000-0000-0000-000000000000", p_embedding: new Array(1536).fill(0.01), p_exclude: null, p_threshold: 0.1, p_limit: 1 }),
});
console.log("pgvector match_posts ->", v.status, (await v.text()).slice(0, 120));
