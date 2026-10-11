import { loadEnv } from "./env.mjs";
loadEnv();
const base = process.env.EMBEDDINGS_BASE_URL ?? "https://api.openai.com/v1";
const embed = async (t) => {
  const r = await fetch(`${base}/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.EMBEDDINGS_API_KEY}` },
    body: JSON.stringify({ model: process.env.EMBEDDINGS_MODEL, input: t, dimensions: 1536 }),
  });
  return (await r.json()).data[0].embedding;
};
const cos = (a, b) => { let d=0,na=0,nb=0; for (let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]**2;nb+=b[i]**2;} return d/Math.sqrt(na*nb); };

// Pairs a founder would call duplicates, and pairs they would not.
const dupes = [
  ["Export entries to CSV and Markdown", "Download all my entries as Markdown files"],
  ["Export entries to CSV and Markdown", "Backup my journal to Dropbox"],
  ["Dark mode for the editor", "Please add a dark theme"],
  ["Offline mode on iOS", "Let me write without an internet connection on my phone"],
  ["Sync with Notion databases", "Notion export please"],
  ["Search inside attachments", "Full text search in my PDFs"],
];
const notDupes = [
  ["Export entries to CSV and Markdown", "Dark mode for the editor"],
  ["Offline mode on iOS", "Cheaper yearly plan for students"],
  ["Search inside attachments", "Sync with Notion databases"],
  ["Dark mode for the editor", "Family plan"],
  ["Zapier trigger on new entry", "Editor freezes when pasting long text"],
];

const score = async (pairs) => {
  const out = [];
  for (const [a, b] of pairs) {
    const [x, y] = await Promise.all([embed(a), embed(b)]);
    out.push({ pair: `${a.slice(0,28)} / ${b.slice(0,28)}`, s: cos(x, y) });
  }
  return out;
};

const d = await score(dupes);
const n = await score(notDupes);
console.log("DUPLICATES");
d.forEach(r => console.log(`  ${r.s.toFixed(3)}  ${r.pair}`));
console.log("NOT DUPLICATES");
n.forEach(r => console.log(`  ${r.s.toFixed(3)}  ${r.pair}`));

const dupMin = Math.min(...d.map(r => r.s));
const notMax = Math.max(...n.map(r => r.s));
console.log(`\nlowest duplicate:  ${dupMin.toFixed(3)}`);
console.log(`highest non-dupe:  ${notMax.toFixed(3)}`);
console.log(`clean gap: ${dupMin > notMax ? "yes" : "NO — overlapping"}`);
console.log(`suggested nudge threshold (catch most):  ${(notMax + 0.02).toFixed(2)}`);
console.log(`suggested merge threshold (high conf.):  ${((dupMin + notMax) / 2 + 0.05).toFixed(2)}`);
