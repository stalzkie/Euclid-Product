import { loadEnv } from "./env.mjs";
loadEnv();

/** Embeds every post that has none. Mirrors server/jobs.ts backfillEmbeddings. */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const base = process.env.EMBEDDINGS_BASE_URL ?? "https://api.openai.com/v1";
const h = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };

const posts = await fetch(`${url}/rest/v1/posts?select=id,title,body&embedding=is.null`, { headers: h }).then(r => r.json());
console.log(`${posts.length} posts need embedding`);
if (!posts.length) process.exit(0);

// One batched call rather than one per post.
const inputs = posts.map(p => [p.title, p.title, p.body ?? ""].join("\n").replace(/\s+/g, " ").trim().slice(0, 8000));
const res = await fetch(`${base}/embeddings`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${process.env.EMBEDDINGS_API_KEY}` },
  body: JSON.stringify({ model: process.env.EMBEDDINGS_MODEL, input: inputs, dimensions: 1536 }),
});
if (!res.ok) { console.error("embeddings failed:", res.status, (await res.text()).slice(0, 300)); process.exit(1); }
const vectors = (await res.json()).data.sort((a, b) => a.index - b.index).map(d => d.embedding);

let done = 0;
for (let i = 0; i < posts.length; i++) {
  const r = await fetch(`${url}/rest/v1/posts?id=eq.${posts[i].id}`, {
    method: "PATCH", headers: h, body: JSON.stringify({ embedding: vectors[i] }),
  });
  if (r.ok) done += 1; else console.error("  failed", posts[i].title, r.status, (await r.text()).slice(0, 120));
}
console.log(`embedded ${done}/${posts.length}`);
