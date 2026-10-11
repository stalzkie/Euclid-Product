/**
 * Custom domain rules. No database and no DNS, so the parts that decide what
 * is allowed can be tested on their own.
 */

/** Where the verification record is published. */
export const VERIFY_PREFIX = "_euclid";

/**
 * Hostnames nobody may claim. A board answering for one of these would let a
 * founder intercept traffic meant for us: our own apex, anything under it,
 * and the loopback and localhost names a developer's browser resolves
 * specially.
 */
const RESERVED_SUFFIXES = ["euclidhq.com", "localhost", "local", "internal", "test", "example"];

export type DomainCheck = { ok: true; host: string } | { ok: false; error: string };

/**
 * Accepts a hostname. Deliberately not a URL: a founder pasting
 * `https://feedback.app.com/board` means the hostname, and guessing which
 * part they meant is how you end up serving the wrong thing.
 */
export function normaliseDomain(raw: string): DomainCheck {
  let value = raw.trim().toLowerCase();
  if (!value) return { ok: false, error: "Enter a domain." };

  // Be forgiving about the two mistakes everyone makes, and strict after.
  value = value.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  if (value.includes("@")) return { ok: false, error: "That looks like an email address." };
  if (value.includes(":")) return { ok: false, error: "Leave the port off the domain." };
  if (value.length > 253) return { ok: false, error: "That domain is too long." };

  const labels = value.split(".");
  if (labels.length < 2) {
    return { ok: false, error: "Use a full domain, like feedback.yourapp.com." };
  }

  const label = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
  for (const part of labels) {
    if (!part) return { ok: false, error: "That domain has an empty part." };
    if (part.length > 63) return { ok: false, error: "One part of that domain is too long." };
    if (!label.test(part)) {
      return { ok: false, error: `"${part}" is not a valid part of a domain name.` };
    }
  }

  // A bare apex works, but it is almost never what someone wants: it would
  // take over the domain their marketing site lives on.
  if (isReserved(value)) {
    return { ok: false, error: "That domain cannot be used for a board." };
  }

  return { ok: true, host: value };
}

export function isReserved(host: string): boolean {
  return RESERVED_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

/** The value the founder publishes to prove the domain is theirs. */
export function verificationRecord(token: string): { name: string; value: string } {
  return { name: VERIFY_PREFIX, value: `euclid-verify=${token}` };
}

/** Does any of the TXT records at _euclid.<domain> carry our token? */
export function tokenMatches(records: string[][], token: string): boolean {
  const expected = `euclid-verify=${token}`;
  // A TXT record longer than 255 bytes arrives as several strings that the
  // resolver expects to be joined, so compare the joined value too.
  return records.some((chunks) => {
    const joined = chunks.join("").trim();
    return joined === expected || chunks.some((chunk) => chunk.trim() === expected);
  });
}

/**
 * Whether a request's Host belongs to this deployment rather than to a
 * board's custom domain. Ports are ignored: the host header carries one in
 * development and not in production.
 */
export function isOwnHost(host: string, appHost: string): boolean {
  const bare = host.split(":")[0].toLowerCase();
  const own = appHost.split(":")[0].toLowerCase();
  if (!bare) return true;
  if (bare === own) return true;
  // The deployment answers on both apex and www.
  if (bare === `www.${own}` || `www.${bare}` === own) return true;
  // Development and preview hosts are never custom domains.
  return bare === "localhost" || bare === "127.0.0.1" || bare === "[::1]";
}
