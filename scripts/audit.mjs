import { loadEnv } from "./env.mjs";
loadEnv();

/**
 * Walks the paths that matter and reports which actually work against the
 * live stack, so "is it done" has an evidence-based answer.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
const q = (p) => fetch(`${url}/rest/v1/${p}`, { headers: h }).then((r) => r.json());

const rows = [];
const check = (area, detail, ok) => rows.push({ area, detail, ok });

// --- data the product depends on -------------------------------------------
const posts = await q("posts?select=id,embedding,theme_id,approved");
check("posts", `${posts.length} posts`, posts.length > 0);
check("embeddings", `${posts.filter(p => p.embedding).length}/${posts.length} embedded`,
  posts.every(p => p.embedding));
check("themes assigned", `${posts.filter(p => p.theme_id).length}/${posts.length} in a theme`,
  posts.filter(p => p.theme_id).length > 0);

const themes = await q("themes?select=id,name,centroid");
check("themes", `${themes.length} themes`, themes.length > 0);
check("theme centroids", `${themes.filter(t => t.centroid).length}/${themes.length} clustered by Euclid`,
  themes.every(t => t.centroid));

const dupes = await q("duplicate_suggestions?select=id,state");
check("merge queue", `${dupes.filter(d => d.state === "pending").length} pending`, dupes.length > 0);

const prompts = await q("build_prompts?select=id,target,copied");
check("build prompts", `${prompts.length} generated, ${prompts.filter(p => p.copied).length} copied`,
  prompts.length > 0);

const chats = await q("chat_messages?select=id");
check("ask euclid", `${chats.length} chat messages`, chats.length > 0);

const logs = await q("changelog_entries?select=id,published,voters_notified");
check("changelog", `${logs.length} entries, ${logs.filter(l => l.published).length} published`, logs.length > 0);
check("voter emails sent", `${logs.reduce((a,l)=>a+l.voters_notified,0)} notified via the app`,
  logs.some(l => l.voters_notified > 0));

const outbox = await q("email_outbox?select=id,kind,sent_at");
check("email outbox", `${outbox.length} queued/sent by the app`, outbox.length > 0);

const recs = await q("recommendations?select=id,created_at");
check("recommendations", `${recs.length} (seeded, not AI-generated)`, recs.length > 0);

const eu = await q("end_users?select=id,kind");
const kinds = eu.reduce((a,u)=>{a[u.kind]=(a[u.kind]||0)+1;return a;},{});
check("identity: anonymous", `${kinds.anonymous ?? 0} visitors`, (kinds.anonymous ?? 0) > 0);
check("identity: email", `${kinds.email ?? 0} verified`, (kinds.email ?? 0) > 0);
check("identity: jwt", `${kinds.jwt ?? 0} signed-in`, (kinds.jwt ?? 0) > 0);

const magic = await q("magic_links?select=token");
check("end-user magic links", `${magic.length} issued`, magic.length > 0);

const held = posts.filter(p => !p.approved);
check("moderation queue", `${held.length} held for approval`, held.length > 0);

console.log("\n  STATUS  AREA                      DETAIL");
for (const r of rows) {
  console.log(`  ${(r.ok ? "  ok  " : " NOT  ")}  ${r.area.padEnd(24)}  ${r.detail}`);
}
const untested = rows.filter(r => !r.ok);
console.log(`\n${rows.length - untested.length}/${rows.length} exercised against the live stack`);
if (untested.length) {
  console.log("not yet exercised:");
  untested.forEach(r => console.log(`  - ${r.area}`));
}
