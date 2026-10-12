import { afterEach, describe, expect, it, vi } from "vitest";
import { initialsOf, needsRoll } from "@/server/context";
import { getJwks, resetJwksCache } from "@/lib/supabase/jwks";

/**
 * Both of these exist to keep a round trip off every dashboard navigation, so
 * the cases that matter are the ones where skipping the round trip would be
 * wrong: a usage period that really has rolled over, and a key set that was
 * never cached.
 */

describe("needsRoll", () => {
  const now = new Date(2026, 9, 12); // 12 October 2026

  it("rolls when the period started in an earlier month", () => {
    expect(needsRoll("2026-09-01", now)).toBe(true);
  });

  it("rolls across a year boundary", () => {
    expect(needsRoll("2025-12-01", now)).toBe(true);
  });

  it("does not roll inside the current month", () => {
    expect(needsRoll("2026-10-01", now)).toBe(false);
    expect(needsRoll("2026-10-12", now)).toBe(false);
  });

  it("does not roll for a period in the future", () => {
    expect(needsRoll("2026-11-01", now)).toBe(false);
  });

  it("rolls when the workspace has no period at all", () => {
    expect(needsRoll(null, now)).toBe(true);
    expect(needsRoll(undefined, now)).toBe(true);
  });

  it("reads a timestamp as the date it falls on", () => {
    expect(needsRoll("2026-10-01T00:00:00.000Z", now)).toBe(false);
    expect(needsRoll("2026-09-30T23:59:59.000Z", now)).toBe(true);
  });

  it("pads single-digit months, which a string comparison needs", () => {
    // Unpadded, this month would read as "2026-1-01", and "2026-01-01" sorts
    // below it — so a workspace that rolled over on the 1st of January would
    // be rolled over again on every navigation for the rest of the month.
    expect(needsRoll("2026-01-01", new Date(2026, 0, 5))).toBe(false);
    expect(needsRoll("2025-12-01", new Date(2026, 0, 5))).toBe(true);
  });
});

describe("initialsOf", () => {
  it("takes the first and last initial", () => {
    expect(initialsOf("Maya Reyes")).toBe("MR");
    expect(initialsOf("Ada Byron Lovelace")).toBe("AL");
  });

  it("takes two letters from a single name", () => {
    expect(initialsOf("maya")).toBe("MA");
  });

  it("falls back when there is no name", () => {
    expect(initialsOf("   ")).toBe("··");
  });
});

describe("getJwks", () => {
  afterEach(() => {
    resetJwksCache();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const keys = { keys: [{ kid: "a", kty: "EC" }] };

  function stubFetch() {
    const fetchMock = vi.fn(async (_url: string) =>
      new Response(JSON.stringify(keys), { status: 200 }),
    );
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("fetches the key set once and serves the rest from memory", async () => {
    const fetchMock = stubFetch();
    expect(await getJwks()).toEqual(keys);
    expect(await getJwks()).toEqual(keys);
    expect(await getJwks()).toEqual(keys);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/auth/v1/.well-known/jwks.json");
  });

  it("shares one request between concurrent callers", async () => {
    const fetchMock = stubFetch();
    await Promise.all([getJwks(), getJwks(), getJwks()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null rather than throwing when the endpoint fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await getJwks()).toBeNull();
  });

  it("does not cache an empty key set", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ keys: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getJwks()).toBeNull();
    expect(await getJwks()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(await getJwks()).toBeNull();
  });
});
