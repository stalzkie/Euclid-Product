import { supabaseAdmin, hasServiceRole } from "@/lib/supabase/server";

/**
 * Recording server errors so the admin page can group them.
 *
 * See 0027_error_events.sql for why this exists at all rather than leaning on
 * the log tail: grouping. One row per distinct fault with a count, not one row
 * per occurrence.
 */

/**
 * The route, reduced to the part that identifies the code rather than the
 * request.
 *
 * The query string has to go. Next appends a cache-busting `?_rsc=<random>`
 * to every RSC payload request, so without this the *same* fault on the same
 * page fingerprints differently on every occurrence and the table fills with
 * one row per error — which is the exact failure the fingerprint exists to
 * prevent. Found by looking at the first real row this ever captured.
 *
 * Dropping genuine parameters with it is the right trade anyway: `?tier=pro`
 * and `?tier=indie` failing the same way is one bug, and ids in a query
 * string are the most variable thing a route can carry.
 */
export function normaliseRoute(route: string | null): string | null {
  if (!route) return null;
  const cut = route.indexOf("?");
  return (cut === -1 ? route : route.slice(0, cut)).trim() || null;
}

/**
 * What makes two errors "the same error".
 *
 * The message with its variable parts removed, plus where it happened. A
 * fingerprint that included the raw message would make every
 * `No workspace for subscription sub_abc123` its own fault and the list would
 * be as useless as the log it replaces; one that ignored the message entirely
 * would collapse unrelated failures in the same route into one row.
 *
 * Normalising is a judgement call rather than a science, so it is small and
 * explicit: ids, numbers and quoted strings are the parts that vary between
 * two occurrences of one bug.
 */
export function fingerprint(kind: string, message: string, route: string | null): string {
  const normalised = message
    // uuids
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    // provider ids: polar's sub_/cus_/ord_, our euc_ keys, bern's codes
    .replace(/\b[a-z]{3,4}_[A-Za-z0-9]{6,}\b/g, "<id>")
    // anything quoted, which is nearly always the specific value that failed
    .replace(/"[^"]*"|'[^']*'/g, "<value>")
    // bare numbers, including ports and counts
    .replace(/\b\d+\b/g, "<n>")
    .trim()
    .slice(0, 300);

  return hash(`${kind}|${normalised}|${normaliseRoute(route) ?? ""}`);
}

/**
 * A plain string hash, deliberately not SHA-256.
 *
 * `node:crypto` cannot be loaded in the Edge runtime, and `instrumentation.ts`
 * is loaded in both — so importing it here meant errors raised in middleware,
 * which runs on Edge, were the one class of error this could never record.
 * Turbopack said so as a build warning.
 *
 * Web Crypto would work in both but is async, and this is called from a
 * synchronous fingerprint on an error path. The simpler answer is that a
 * fingerprint has no security property at all: it is a grouping key, nobody
 * is attacking it, and the only cost of a collision is two unrelated faults
 * sharing a row. Two rounds of cyrb53 with different seeds give 106 bits,
 * which makes that vanishingly unlikely.
 */
function hash(input: string): string {
  const round = (seed: number) => {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < input.length; i++) {
      const ch = input.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
  };
  return `${round(0)}${round(0x9e3779b9)}`.slice(0, 32);
}

/**
 * Record one occurrence. Never throws.
 *
 * Called from the error path, so anything it does wrong happens while
 * something is already broken. A failure to record must not become a second
 * error, and must never replace the original in the logs.
 */
export async function recordError(
  error: unknown,
  route: string | null = null,
): Promise<void> {
  if (!hasServiceRole()) return;

  try {
    const kind = error instanceof Error ? error.name : typeof error;
    const message = error instanceof Error ? error.message : String(error);
    // The first frames are where the fault is; the rest is framework.
    const stack =
      error instanceof Error && error.stack
        ? error.stack.split("\n").slice(0, 12).join("\n").slice(0, 4000)
        : null;

    // Stored normalised as well as fingerprinted on it, so the row reads as
    // the route it belongs to rather than whichever request happened to be
    // the most recent one.
    const path = normaliseRoute(route);

    await supabaseAdmin().rpc("record_error", {
      p_fingerprint: fingerprint(kind, message, route),
      p_kind: kind.slice(0, 120),
      p_message: message.slice(0, 1000),
      p_route: path?.slice(0, 300) ?? null,
      p_stack: stack,
    });
  } catch {
    // Deliberately silent. The original error has already been logged by
    // whoever called this, and a stack trace from the error recorder on top
    // of it makes the real one harder to find.
  }
}
