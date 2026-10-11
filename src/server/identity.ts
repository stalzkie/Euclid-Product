import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Identity for end users, in the three levels the PRD sets out.
 *
 * JWT verification is done here with node's crypto rather than a library: the
 * only algorithm accepted is HS256 with the board's shared secret, so the
 * surface is small enough to be worth owning.
 */

export interface JwtClaims {
  sub: string;
  email?: string;
  name?: string;
  plan?: string;
  /** Anything else the host app sends becomes a segment attribute. */
  [key: string]: unknown;
}

/** Per-board cookie holding a verified end-user email. */
export const EMAIL_COOKIE = "euclid_email";

export class JwtError extends Error {}

export function verifyJwt(token: string, secret: string): JwtClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new JwtError("Malformed token");

  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString("utf8"));
  } catch {
    throw new JwtError("Unreadable header");
  }

  // Only HS256. Refusing "none" and asymmetric algorithms here closes the
  // classic algorithm-confusion hole.
  if (header.alg !== "HS256") throw new JwtError(`Unsupported algorithm ${header.alg}`);

  const expected = createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const given = base64UrlDecode(signatureB64);

  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new JwtError("Bad signature");
  }

  let payload: JwtClaims & { exp?: number; nbf?: number };
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
  } catch {
    throw new JwtError("Unreadable payload");
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < now) {
    throw new JwtError("Token expired");
  }
  if (typeof payload.nbf === "number" && payload.nbf > now + 60) {
    throw new JwtError("Token not yet valid");
  }
  if (!payload.sub) throw new JwtError("Token has no subject");

  return payload;
}

/** Everything that is not a reserved claim becomes a segment attribute. */
const RESERVED = new Set(["sub", "iss", "aud", "exp", "nbf", "iat", "jti", "email", "name"]);

export function segmentsFrom(claims: JwtClaims): Record<string, string> {
  const segments: Record<string, string> = {};
  for (const [key, value] of Object.entries(claims)) {
    if (RESERVED.has(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      segments[key] = String(value);
    }
  }
  return segments;
}

/**
 * Plan-weighted votes. A paying voter's vote counts for more, but only enough
 * to break ties — not enough that free users feel ranked by payment.
 */
export function voteWeightFor(plan: string | undefined): number {
  switch ((plan ?? "free").toLowerCase()) {
    case "team":
    case "business":
    case "enterprise":
      return 1.5;
    case "pro":
    case "paid":
    case "premium":
      return 1.25;
    default:
      return 1;
  }
}

/** Opaque cookie value for anonymous visitors. */
export function newVisitorKey(): string {
  return `anon_${randomBytes(16).toString("hex")}`;
}

export function newMagicToken(): string {
  return randomBytes(24).toString("base64url");
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Lightweight spam scoring. Nothing clever — just the shapes that show up on
 * an open board. A score at or above 0.8 is held for approval.
 */
export function spamScore(title: string, body: string | null): number {
  const text = `${title}\n${body ?? ""}`;
  let score = 0;

  const links = (text.match(/https?:\/\//g) ?? []).length;
  if (links >= 3) score += 0.4;
  else if (links === 2) score += 0.2;

  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length > 12) {
    const caps = (text.match(/[A-Z]/g) ?? []).length / letters.length;
    if (caps > 0.6) score += 0.3;
  }

  if (/\b(viagra|casino|crypto\s?giveaway|seo\s?service|buy\s?followers)\b/i.test(text)) {
    score += 0.6;
  }
  if (/(.)\1{7,}/.test(text)) score += 0.2;
  if (title.trim().length < 6) score += 0.2;
  if (/[Ѐ-ӿ一-鿿]/.test(title) && /[a-z]/i.test(title) === false) {
    // Mixed-script titles on an English board are usually spam, but this only
    // nudges the score rather than blocking.
    score += 0.1;
  }

  return Math.min(1, Number(score.toFixed(2)));
}
