import { loadEnv } from "./env.mjs";
loadEnv();

/**
 * Re-runs duplicate detection across a whole board. Useful after a seed, after
 * changing the embeddings model, or after moving the thresholds.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
const BOARD = "22222222-0000-0000-0000-000000000001";
const THRESHOLD = 0.42;

const posts = await fetch(`${url}/rest/v1/posts?select=id,number,title,embedding&board_id=eq.${BOARD}&merged_into=is.null`, { headers: h }).then(r => r.json());
console.log(`${posts.length} posts`);

// Clear stale suggestions, then rebuild.
await fetch(`${url}/rest/v1/duplicate_suggestions?board_id=eq.${BOARD}`, { method: "DELETE", headers: h });

let made = 0;
const seen = new Set();
for (const p of posts) {
  if (!p.embedding) continue;
  const vec = typeof p.embedding === "string" ? JSON.parse(p.embedding) : p.embedding;
  const matches = await fetch(`${url}/rest/v1/rpc/match_posts`, {
    method: "POST", headers: h,
    body: JSON.stringify({ p_board: BOARD, p_embedding: vec, p_exclude: p.id, p_threshold: THRESHOLD, p_limit: 3 }),
  }).then(r => r.json());

  for (const m of matches) {
    // Only keep one direction per pair: the lower-voted post merges upward.
    const pairKey = [p.id, m.id].sort().join("|");
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);

    const target = posts.find(x => x.id === m.id);
    const sourceIsSmaller = p.number < (target?.number ?? 0);
    const source = sourceIsSmaller ? p : target;
    const dest = sourceIsSmaller ? target : p;
    if (!source || !dest) continue;

    const r = await fetch(`${url}/rest/v1/duplicate_suggestions`, {
      method: "POST", headers: { ...h, Prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify({ board_id: BOARD, post_id: source.id, target_id: dest.id, similarity: Number(m.similarity.toFixed(3)) }),
    });
    if (r.ok) { made += 1; console.log(`  ${m.similarity.toFixed(3)}  #${source.number} ${source.title.slice(0,34)}  ->  #${dest.number} ${dest.title.slice(0,34)}`); }
  }
}
console.log(`\n${made} suggestions`);
