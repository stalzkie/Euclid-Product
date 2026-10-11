import { loadEnv } from "./env.mjs";
loadEnv();

const base = process.env.EMBEDDINGS_BASE_URL ?? "https://api.openai.com/v1";
const res = await fetch(`${base}/embeddings`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${process.env.EMBEDDINGS_API_KEY}`,
  },
  body: JSON.stringify({
    model: process.env.EMBEDDINGS_MODEL ?? "text-embedding-3-small",
    input: "Export my entries to CSV",
    dimensions: 1536,
  }),
});
if (!res.ok) {
  console.log("embeddings FAILED", res.status, (await res.text()).slice(0, 300));
  process.exit(0);
}
const json = await res.json();
const v = json.data[0].embedding;
console.log(`embeddings OK · ${v.length} dims · model ${json.model}`);

// Semantic sanity: these two should be close, the third far.
const embed = async (t) => {
  const r = await fetch(`${base}/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.EMBEDDINGS_API_KEY}` },
    body: JSON.stringify({ model: process.env.EMBEDDINGS_MODEL, input: t, dimensions: 1536 }),
  });
  return (await r.json()).data[0].embedding;
};
const cos = (a, b) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i]*b[i]; na += a[i]**2; nb += b[i]**2; }
  return d / Math.sqrt(na*nb);
};
const [a, b, c] = await Promise.all([
  embed("Export entries to CSV and Markdown"),
  embed("Download all my entries as Markdown files"),
  embed("Dark mode for the editor"),
]);
console.log(`similar pair:   ${cos(a,b).toFixed(3)}  (should be high)`);
console.log(`unrelated pair: ${cos(a,c).toFixed(3)}  (should be low)`);
