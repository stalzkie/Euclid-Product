import { describe, expect, it } from "vitest";
import {
  RETRY_MAX_ATTEMPTS,
  retriesLeft,
  retryAfter,
  retryDelayMs,
} from "@/lib/retry";

/**
 * The retry schedule both outboxes share.
 *
 * These numbers are not decoration. The email queue exists so that a magic
 * link survives a provider hiccup, and a magic link expires an hour after it
 * is created — so a schedule whose later attempts land beyond that hour would
 * be retrying a token that is already dead. That is the property worth
 * holding, so it is asserted rather than described.
 */

describe("retryDelayMs", () => {
  it("is quadratic in minutes: 1, 4, 9, 16", () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(2)).toBe(4 * 60_000);
    expect(retryDelayMs(3)).toBe(9 * 60_000);
    expect(retryDelayMs(4)).toBe(16 * 60_000);
  });

  it("never retries instantly, whatever it is handed", () => {
    // A first failure arrives as 1 because the claim increments on the way
    // out. Zero would mean a dead provider retried in a tight loop by every
    // request that happens to drain the queue.
    for (const attempts of [0, -1, 0.4, Number.NaN]) {
      expect(retryDelayMs(attempts)).toBe(60_000);
    }
  });

  it("exhausts every attempt inside a magic link's hour", () => {
    let total = 0;
    for (let n = 1; n < RETRY_MAX_ATTEMPTS; n += 1) total += retryDelayMs(n);
    // 1 + 4 + 9 + 16 = 30 minutes, so the last attempt happens while the link
    // it may be carrying is still valid. This is the constraint the schedule
    // exists to satisfy; the exact curve is free to change under it.
    //
    // Note it does not pin the curve — a doubling schedule sums to the same
    // 30 minutes, which a mutation run proved. `is quadratic` above is what
    // holds the shape.
    expect(total).toBeLessThan(60 * 60_000);
  });
});

describe("retriesLeft", () => {
  it("allows attempts up to the limit and refuses the one past it", () => {
    expect(retriesLeft(0)).toBe(true);
    expect(retriesLeft(RETRY_MAX_ATTEMPTS - 1)).toBe(true);
    expect(retriesLeft(RETRY_MAX_ATTEMPTS)).toBe(false);
    expect(retriesLeft(RETRY_MAX_ATTEMPTS + 1)).toBe(false);
  });

  it("agrees with the SQL the claim functions use", () => {
    // Both claim functions filter on `attempts < 5`. If this constant moves
    // without the migration moving, rows become either unclaimable or
    // immortal, and nothing else would say so.
    expect(RETRY_MAX_ATTEMPTS).toBe(5);
  });
});

describe("retryAfter", () => {
  it("offsets from the clock it is given, not the machine's", () => {
    // This machine's clock runs ahead of the database's, so anything that
    // computes a timestamp takes `now` as a parameter.
    const now = new Date("2026-10-13T12:00:00.000Z");
    expect(retryAfter(1, now)).toBe("2026-10-13T12:01:00.000Z");
    expect(retryAfter(4, now)).toBe("2026-10-13T12:16:00.000Z");
  });

  it("is always in the future", () => {
    const now = new Date();
    expect(new Date(retryAfter(1, now)).getTime()).toBeGreaterThan(now.getTime());
  });
});
