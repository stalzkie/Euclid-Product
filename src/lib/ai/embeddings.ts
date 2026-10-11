/**
 * Embeddings for duplicate detection and theme clustering.
 *
 * Anthropic does not serve an embeddings endpoint, so this is the one place
 * the product talks to a second provider — the PRD's stack note allows for
 * "one LLM provider API for chat and Build Prompt, plus an embeddings model".
 * The provider is swappable behind `embed()`; the vector width (1536) is fixed
 * by the `vector(1536)` columns in the schema.
 *
 * With no embeddings key configured, `embed()` falls back to a deterministic
 * hashed bag-of-words vector. It is not semantically smart, but it is stable
 * and cosine-comparable, so duplicate detection and clustering keep working in
 * local development instead of silently going dark.
 */

export const EMBEDDING_DIMS = 1536;
const MODEL = process.env.EMBEDDINGS_MODEL ?? "text-embedding-3-small";

export function hasEmbeddingProvider(): boolean {
  return Boolean(process.env.EMBEDDINGS_API_KEY);
}

/**
 * A small in-process cache. The type-ahead nudge embeds nearly the same string
 * on every keystroke pause, and a submitted post is embedded again moments
 * later by duplicate detection — both are exact repeats worth not paying for.
 */
const CACHE_MAX = 500;
const cache = new Map<string, number[]>();

function remember(key: string, vector: number[]): number[] {
  if (cache.size >= CACHE_MAX) {
    // Oldest insertion first; Map preserves insertion order.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, vector);
  return vector;
}

export async function embed(text: string): Promise<number[]> {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 8000);
  if (!clean) return new Array(EMBEDDING_DIMS).fill(0);

  const cached = cache.get(clean);
  if (cached) return cached;

  if (!hasEmbeddingProvider()) return remember(clean, hashEmbedding(clean));

  const base = process.env.EMBEDDINGS_BASE_URL ?? "https://api.openai.com/v1";
  try {
    const res = await fetch(`${base}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.EMBEDDINGS_API_KEY}`,
      },
      body: JSON.stringify({ model: MODEL, input: clean, dimensions: EMBEDDING_DIMS }),
    });
    if (!res.ok) throw new Error(`embeddings ${res.status}`);
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    const vector = json.data?.[0]?.embedding;
    if (!vector || vector.length !== EMBEDDING_DIMS) {
      throw new Error("unexpected embedding shape");
    }
    return remember(clean, vector);
  } catch (err) {
    // An embeddings outage must not block a post from being submitted.
    console.warn("[euclid] embedding failed, using fallback:", err);
    return hashEmbedding(clean);
  }
}

/** Embed the text that a post is compared on: title carries most of the signal. */
export function postEmbeddingText(title: string, body?: string | null): string {
  return [title, title, body ?? ""].join("\n").trim();
}

/**
 * Deterministic fallback. Tokens are hashed into buckets with a small amount
 * of character-trigram spill so near-identical wording lands close together.
 */
function hashEmbedding(text: string): number[] {
  const vec = new Array(EMBEDDING_DIMS).fill(0);
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

  const bump = (key: string, amount: number) => {
    const h = fnv1a(key);
    vec[h % EMBEDDING_DIMS] += amount;
  };

  for (const word of words) {
    if (STOP.has(word)) continue;
    bump(word, 1);
    for (let i = 0; i + 3 <= word.length; i++) {
      bump(word.slice(i, i + 3), 0.35);
    }
  }
  for (let i = 0; i + 1 < words.length; i++) {
    bump(`${words[i]}_${words[i + 1]}`, 0.6);
  }

  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

const STOP = new Set(
  ("a an and are as at be but by for from have i if in into is it its of on or " +
    "that the to was will with would could should you your my me we our")
    .split(" "),
);

/** Cosine similarity, used by the in-process clustering pass. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
