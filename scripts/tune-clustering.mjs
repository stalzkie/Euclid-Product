import { loadEnv } from "./env.mjs";
loadEnv();

/**
 * Compares clustering strategies against the real board, so the threshold and
 * the linkage rule are chosen from evidence rather than taste.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: key, authorization: `Bearer ${key}` };

const posts = (await fetch(
  `${url}/rest/v1/posts?select=id,number,title,vote_count,embedding&merged_into=is.null&approved=eq.true`,
  { headers: h },
).then((r) => r.json())).map((p) => ({
  ...p,
  embedding: typeof p.embedding === "string" ? JSON.parse(p.embedding) : p.embedding,
})).filter((p) => p.embedding);

const cos = (a, b) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i]*b[i]; na += a[i]**2; nb += b[i]**2; }
  return d / Math.sqrt(na * nb);
};

// Strategy A: running centroid (what ships today).
const byCentroid = (items, th) => {
  const out = [];
  for (const p of [...items].sort((a,b)=>b.vote_count-a.vote_count)) {
    let best = null, score = th;
    for (const c of out) { const s = cos(p.embedding, c.centroid); if (s > score) { best = c; score = s; } }
    if (best) {
      const n = best.members.length;
      best.centroid = best.centroid.map((v,i)=>(v*n+p.embedding[i])/(n+1));
      best.members.push(p);
    } else out.push({ centroid: [...p.embedding], members: [p] });
  }
  return out;
};

// Strategy B: average linkage against actual members — no drifting average to
// chase, so a cluster cannot widen its own catchment as it grows.
const byAverage = (items, th) => {
  const out = [];
  for (const p of [...items].sort((a,b)=>b.vote_count-a.vote_count)) {
    let best = null, score = th;
    for (const c of out) {
      const avg = c.members.reduce((a,m)=>a+cos(p.embedding,m.embedding),0)/c.members.length;
      if (avg > score) { best = c; score = avg; }
    }
    if (best) best.members.push(p); else out.push({ members: [p] });
  }
  return out;
};

const report = (label, clusters, th) => {
  const kept = clusters.filter(c => c.members.length >= 2);
  const orphans = clusters.filter(c => c.members.length < 2).length;
  console.log(`\n${label}  threshold ${th}  ->  ${kept.length} themes, ${orphans} unthemed`);
  for (const c of kept) {
    console.log("   · " + c.members.map(m => "#" + m.number).join(" ") + "  " +
      c.members[0].title.slice(0, 38));
  }
};

for (const th of [0.38, 0.45, 0.50]) report("centroid", byCentroid(posts, th), th);
for (const th of [0.32, 0.38, 0.42, 0.46]) report("average ", byAverage(posts, th), th);
