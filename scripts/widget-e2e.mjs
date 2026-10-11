import { loadEnv } from "./env.mjs";
loadEnv();

/** Exercises the public widget API the way a real end user's browser does. */
const app = "http://localhost:3000";
const BOARD = "brd_8f2k1x";
const jar = [];
const cookieHeader = () => jar.join("; ");
const keep = (res) => {
  const set = res.headers.getSetCookie?.() ?? [];
  for (const c of set) jar.push(c.split(";")[0]);
};

const call = async (path, init = {}) => {
  const res = await fetch(app + path, {
    ...init,
    headers: {
      "content-type": "application/json",
      origin: app,
      cookie: cookieHeader(),
      ...(init.headers ?? {}),
    },
  });
  keep(res);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  return { status: res.status, body };
};

console.log("1. load board");
const board = await call(`/api/public/board?board=${BOARD}`);
console.log(`   ${board.status} · ${board.body.posts?.length} posts · ${board.body.changelog?.length} changelog · heading "${board.body.board?.design?.heading}"`);

console.log("\n2. duplicate nudge while typing");
const sim = await call(`/api/public/similar?board=${BOARD}&title=${encodeURIComponent("let me download all my entries as markdown")}`);
console.log(`   ${sim.status} · ${sim.body.posts?.length} similar`);
for (const p of sim.body.posts ?? []) console.log(`     #${p.number} ${p.title}`);

console.log("\n3. vote on the top post");
const top = board.body.posts[0];
const v1 = await call("/api/public/vote", { method: "POST", body: JSON.stringify({ board: BOARD, postId: top.id }) });
console.log(`   ${v1.status} · #${top.number} ${top.votes} -> ${v1.body.votes} (voted=${v1.body.voted}) ${v1.status !== 200 ? JSON.stringify(v1.body) : ""}`);
const v2 = await call("/api/public/vote", { method: "POST", body: JSON.stringify({ board: BOARD, postId: top.id }) });
console.log(`   toggle back: ${v2.body.votes} (voted=${v2.body.voted})`);

console.log("\n4. submit a new post (should create duplicate suggestions)");
const title = `Let me export everything as Markdown files ${Date.now() % 1000}`;
const post = await call("/api/public/post", { method: "POST", body: JSON.stringify({ board: BOARD, title, body: "One file per entry please.", website: "" }) });
console.log(`   ${post.status} · #${post.body.number} held=${post.body.held}`);

console.log("\n5. honeypot must be rejected");
const spam = await call("/api/public/post", { method: "POST", body: JSON.stringify({ board: BOARD, title: "Buy cheap followers now", website: "http://spam.example" }) });
console.log(`   ${spam.status} · ${JSON.stringify(spam.body)}`);

console.log("\n6. comment on the new post");
const c = await call("/api/public/comment", { method: "POST", body: JSON.stringify({ board: BOARD, postId: post.body.id, body: "Strongly agree, with dates in the filename." }) });
console.log(`   ${c.status} · ${c.body.id ? "created" : JSON.stringify(c.body)}`);

console.log("\n7. duplicate suggestions created for the new post");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dupes = await fetch(`${url}/rest/v1/duplicate_suggestions?select=similarity,state,posts!duplicate_suggestions_target_id_fkey(number,title)&post_id=eq.${post.body.id}`, {
  headers: { apikey: key, authorization: `Bearer ${key}` },
}).then(r => r.json());
if (!dupes.length) console.log("   none — threshold may still be too high");
for (const d of dupes) console.log(`   ${Number(d.similarity).toFixed(3)} -> #${d.posts?.number} ${d.posts?.title}`);
