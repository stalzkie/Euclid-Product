import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  JwtError,
  newMagicToken,
  newVisitorKey,
  segmentsFrom,
  spamScore,
  verifyJwt,
  voteWeightFor,
} from "@/server/identity";

/**
 * Identity is the boundary between the founder's app and Euclid. Everything
 * here decides whether a visitor is who they claim to be, so the cases that
 * matter most are the ones where a token should be refused.
 */

const SECRET = "test-secret-at-least-32-characters-long";

/** Builds a token by hand, so the test does not reuse the verifier's logic. */
function makeToken(
  payload: Record<string, unknown>,
  secret = SECRET,
  header: Record<string, unknown> = { alg: "HS256", typ: "JWT" },
): string {
  const b64 = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const head = b64(header);
  const body = b64(payload);
  const signature = createHmac("sha256", secret)
    .update(`${head}.${body}`)
    .digest("base64url");
  return `${head}.${body}.${signature}`;
}

const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;
const anHourAgo = () => Math.floor(Date.now() / 1000) - 3600;

describe("verifyJwt", () => {
  it("accepts a correctly signed token and returns its claims", () => {
    const token = makeToken({
      sub: "user-1",
      email: "dana@acme.com",
      plan: "pro",
      exp: inAnHour(),
    });

    const claims = verifyJwt(token, SECRET);

    expect(claims.sub).toBe("user-1");
    expect(claims.email).toBe("dana@acme.com");
    expect(claims.plan).toBe("pro");
  });

  it("refuses a token signed with a different secret", () => {
    const token = makeToken({ sub: "user-1", plan: "pro", exp: inAnHour() }, "not-the-secret");

    expect(() => verifyJwt(token, SECRET)).toThrow(JwtError);
  });

  it("refuses a token whose payload was edited after signing", () => {
    // The attack this stops: take a real free-plan token, swap in plan=pro.
    const honest = makeToken({ sub: "user-1", plan: "free", exp: inAnHour() });
    const [header, , signature] = honest.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: "user-1", plan: "pro", exp: inAnHour() }),
    ).toString("base64url");

    expect(() => verifyJwt(`${header}.${forgedPayload}.${signature}`, SECRET)).toThrow(
      JwtError,
    );
  });

  it("refuses alg:none, which would make the signature optional", () => {
    const token = makeToken({ sub: "user-1", exp: inAnHour() }, SECRET, {
      alg: "none",
      typ: "JWT",
    });

    expect(() => verifyJwt(token, SECRET)).toThrow(/unsupported algorithm/i);
  });

  it("refuses an asymmetric algorithm, closing the confusion attack", () => {
    const token = makeToken({ sub: "user-1", exp: inAnHour() }, SECRET, {
      alg: "RS256",
      typ: "JWT",
    });

    expect(() => verifyJwt(token, SECRET)).toThrow(/unsupported algorithm/i);
  });

  it("refuses an expired token", () => {
    const token = makeToken({ sub: "user-1", exp: anHourAgo() });

    expect(() => verifyJwt(token, SECRET)).toThrow(/expired/i);
  });

  it("refuses a token with no subject, which identifies nobody", () => {
    const token = makeToken({ email: "dana@acme.com", exp: inAnHour() });

    expect(() => verifyJwt(token, SECRET)).toThrow(/subject/i);
  });

  it("refuses a malformed token", () => {
    expect(() => verifyJwt("not.a.jwt.at.all", SECRET)).toThrow(JwtError);
    expect(() => verifyJwt("onlyonepart", SECRET)).toThrow(JwtError);
  });

  it("accepts a token with no expiry, since exp is optional", () => {
    const claims = verifyJwt(makeToken({ sub: "user-1" }), SECRET);

    expect(claims.sub).toBe("user-1");
  });
});

describe("segmentsFrom", () => {
  it("keeps custom attributes as segments", () => {
    const segments = segmentsFrom({
      sub: "user-1",
      plan: "pro",
      signup_date: "2025-02-11",
      seats: 4,
      trialing: false,
    });

    expect(segments).toEqual({
      plan: "pro",
      signup_date: "2025-02-11",
      seats: "4",
      trialing: "false",
    });
  });

  it("drops reserved JWT claims, which are not segments", () => {
    const segments = segmentsFrom({
      sub: "user-1",
      email: "dana@acme.com",
      name: "Dana",
      iss: "acme",
      aud: "euclid",
      exp: 123,
      iat: 123,
      jti: "abc",
      plan: "pro",
    });

    expect(segments).toEqual({ plan: "pro" });
  });

  it("drops nested objects, which cannot be a segment value", () => {
    const segments = segmentsFrom({ sub: "u", plan: "pro", meta: { a: 1 } });

    expect(segments).toEqual({ plan: "pro" });
  });
});

describe("voteWeightFor", () => {
  it("weights a team plan above a pro plan above free", () => {
    expect(voteWeightFor("team")).toBeGreaterThan(voteWeightFor("pro"));
    expect(voteWeightFor("pro")).toBeGreaterThan(voteWeightFor("free"));
  });

  it("treats an unknown or missing plan as unweighted", () => {
    expect(voteWeightFor(undefined)).toBe(1);
    expect(voteWeightFor("something-new")).toBe(1);
  });

  it("is case insensitive, since host apps spell plans their own way", () => {
    expect(voteWeightFor("PRO")).toBe(voteWeightFor("pro"));
  });

  it("never weights a paying vote so heavily it buries the crowd", () => {
    // A board must not let one paying voter outvote two free ones.
    expect(voteWeightFor("team")).toBeLessThan(2);
  });
});

describe("spamScore", () => {
  it("scores ordinary feedback as not spam", () => {
    const score = spamScore(
      "Export entries to CSV and Markdown",
      "I have two years of writing and no way to get it out.",
    );

    expect(score).toBeLessThan(0.5);
  });

  it("scores a link farm as spam", () => {
    const score = spamScore(
      "Check these out",
      "https://a.example https://b.example https://c.example https://d.example",
    );

    expect(score).toBeGreaterThanOrEqual(0.4);
  });

  it("scores known spam vocabulary as spam", () => {
    expect(spamScore("Buy followers cheap", "best seo service here")).toBeGreaterThanOrEqual(0.6);
  });

  it("penalises shouting", () => {
    const shouted = spamScore("BUY NOW CHEAP DEALS CLICK HERE", null);
    const normal = spamScore("Buy now cheap deals click here", null);

    expect(shouted).toBeGreaterThan(normal);
  });

  it("never exceeds 1, so the held-for-approval check stays meaningful", () => {
    const worst = spamScore(
      "AAAAAAAAAAAA VIAGRA CASINO",
      "https://a.x https://b.x https://c.x buy followers seo service",
    );

    expect(worst).toBeLessThanOrEqual(1);
  });
});

describe("visitor and magic-link keys", () => {
  it("mints a different visitor key each time", () => {
    const keys = new Set(Array.from({ length: 50 }, newVisitorKey));

    expect(keys.size).toBe(50);
  });

  it("mints magic tokens long enough not to be guessable", () => {
    // 24 random bytes in base64url. Anything materially shorter is brute
    // forceable against a board with a known email.
    expect(newMagicToken().length).toBeGreaterThanOrEqual(32);
  });

  it("mints a different magic token each time", () => {
    const tokens = new Set(Array.from({ length: 50 }, newMagicToken));

    expect(tokens.size).toBe(50);
  });
});
