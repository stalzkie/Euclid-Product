/**
 * The project signs access tokens with an asymmetric key (ES256), so a JWT can
 * be verified locally instead of asking the auth server about it. Verifying
 * needs the public JWKS, and `supabaseServer()` hands out a fresh client per
 * request — whose own JWKS cache is therefore always cold. Caching the key set
 * here, for the life of the process, is what turns `getClaims()` into a local
 * operation: without it every page load pays a round trip to fetch the same
 * two-line document.
 */

interface Jwks {
  keys: { kid?: string; [k: string]: unknown }[];
}

const TTL_MS = 10 * 60_000;

let cached: Jwks | null = null;
let cachedAt = 0;
let inflight: Promise<Jwks | null> | null = null;

/** The project's public key set, or null if it cannot be fetched. */
export async function getJwks(): Promise<Jwks | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;

  if (cached && Date.now() - cachedAt < TTL_MS) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch(`${url}/auth/v1/.well-known/jwks.json`, {
        // Next would otherwise try to cache this inside the render it happens
        // to run in; the TTL above is the cache.
        cache: "no-store",
      });
      if (!res.ok) return null;
      const body = (await res.json()) as Jwks;
      if (!body?.keys?.length) return null;
      cached = body;
      cachedAt = Date.now();
      return body;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Drops the cached key set. Only used by tests. */
export function resetJwksCache() {
  cached = null;
  cachedAt = 0;
  inflight = null;
}
