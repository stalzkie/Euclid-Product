import { createHmac } from "node:crypto";

/**
 * Turning a request into a rate-limit bucket that survives clearing cookies.
 *
 * Every public limit was keyed on `viewer.id`, which for an anonymous visitor
 * is the `anon_…` value in `VISITOR_COOKIE`. Clearing cookies mints a new one,
 * so "5 posts an hour" was really "5 posts per cookie" and nothing in `src/`
 * had ever read an IP header. This is the second key, checked alongside the
 * first rather than instead of it: a cookie identifies a person across
 * networks, an address identifies a network across people, and spam usually
 * breaks only one of the two.
 *
 * The address is never stored. What goes in `rate_limits.actor` is an HMAC of
 * it, which is one-way and useless for joining rows to a person — IPv4 is only
 * four billion addresses, so a plain SHA-256 would be a lookup table rather
 * than a hash, and the keyed construction is what stops that.
 */

/**
 * The client address, as far as the platform will say.
 *
 * Order matters. `x-vercel-forwarded-for` and `x-real-ip` are written by the
 * proxy and cannot be set by the caller; `x-forwarded-for` is a list that a
 * caller may already have put something in. On a platform that *overwrites*
 * that header — Vercel does — the leftmost entry is the real client and this
 * is correct. On one that merely appends, the leftmost entry is whatever the
 * caller sent, and this would be reading an attacker's choice of bucket.
 *
 * That is why the forgeable header is last and the two trustworthy ones come
 * first: anywhere the platform sets either of them, the list is never
 * consulted at all.
 */
export function clientIp(header: (name: string) => string | null): string | null {
  const direct = header("x-vercel-forwarded-for") ?? header("x-real-ip");
  if (direct?.trim()) return direct.trim();

  const forwarded = header("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || null;
}

/**
 * Narrow an address to the thing worth counting.
 *
 * IPv4 is used whole. IPv6 is cut to its /64, because a single customer is
 * routinely handed a whole /64 and rotates freely inside it — counting the
 * full address would make an IPv6 visitor effectively unlimited while an IPv4
 * one is held to the limit.
 *
 * Returns null for anything unparseable, so a malformed header disables the
 * IP check rather than creating one shared bucket that every such request
 * falls into — which would rate-limit unrelated people against each other.
 */
export function ipPrefix(raw: string): string | null {
  const addr = raw.split("%")[0].trim().replace(/^\[|\]$/g, "");
  if (!addr) return null;

  // IPv4, including the ::ffff:1.2.3.4 form a dual-stack listener reports.
  // Without this branch every mapped address truncates to ::/64 and the whole
  // IPv4 internet shares one bucket.
  const v4 = addr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4) {
    const parts = v4[1].split(".");
    return parts.every((p) => Number(p) <= 255) ? v4[1] : null;
  }

  if (!addr.includes(":")) return null;

  const [head, tail] = addr.split("::");
  const h = head ? head.split(":").filter(Boolean) : [];
  const t = tail ? tail.split(":").filter(Boolean) : [];
  const groups = addr.includes("::")
    ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t]
    : h;

  if (groups.length < 4 || groups.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  return groups
    .slice(0, 4)
    .map((g) => g.toLowerCase().padStart(4, "0"))
    .join(":");
}

/**
 * The key a request is counted under, or null when there is no usable address.
 *
 * Null is the normal case in local development, where no proxy sets any of
 * these headers. Callers skip the IP check entirely rather than lumping every
 * such request into one bucket.
 *
 * `secret` is HMAC key material and never appears in the output. The service
 * role key is the sensible default: the public API cannot run without it, so
 * there is no deployment where this silently falls back to unkeyed hashing —
 * an optional security control that defaults to off is a disabled one.
 */
export function ipBucket(ip: string | null, secret: string | undefined): string | null {
  if (!ip || !secret) return null;
  const prefix = ipPrefix(ip);
  if (!prefix) return null;

  // Domain-separated, so this can never collide with another use of the same
  // key material, and truncated because 128 bits is already far beyond what a
  // bucket label needs.
  return (
    "ip_" +
    createHmac("sha256", secret).update(`euclid-ip-bucket|${prefix}`).digest("hex").slice(0, 32)
  );
}

/** The bucket for one request. The one call site shape the routes need. */
export function requestIpBucket(headers: Headers): string | null {
  return ipBucket(
    clientIp((name) => headers.get(name)),
    process.env.IP_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}
