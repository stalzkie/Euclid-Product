import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RETRY_MAX_ATTEMPTS,
  retriesLeft,
  retryDelayMs,
  retryDelaySeconds,
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

describe("retryDelaySeconds", () => {
  it("is the same schedule in the unit the SQL takes", () => {
    // 0030's `fail_queued_email` and `fail_integration_delivery` take whole
    // seconds and do `now() + make_interval(secs => ...)` themselves.
    expect(retryDelaySeconds(1)).toBe(60);
    expect(retryDelaySeconds(2)).toBe(240);
    expect(retryDelaySeconds(3)).toBe(540);
    expect(retryDelaySeconds(4)).toBe(960);
  });

  it("is always a positive whole number of seconds", () => {
    // It is interpolated into an interval. A fraction would be rounded by
    // Postgres anyway, and a zero or negative would mean a row that is due
    // the instant it fails — the exact fault 0030 exists to remove, arriving
    // by a different route.
    for (const attempts of [0, -1, 0.4, Number.NaN, RETRY_MAX_ATTEMPTS]) {
      const seconds = retryDelaySeconds(attempts);
      expect(Number.isInteger(seconds)).toBe(true);
      expect(seconds).toBeGreaterThan(0);
    }
  });

  it("does not offer a timestamp to compute locally", async () => {
    // `deliver_after` is only ever compared against the database's `now()`.
    // A helper here that returned a timestamp would be computing it on a
    // different clock, which is how a server running behind the database
    // ended up scheduling retries that were already due. Removing it is the
    // fix; this keeps it removed.
    const retry = await import("@/lib/retry");
    expect("retryAfter" in retry).toBe(false);
  });
});

/**
 * Nothing may schedule a retry on the application's clock again.
 *
 * This reads source rather than behaviour, for the same reason
 * `outbox-drain.test.ts` does: the fault is a *shape* of code, and the shape
 * is invisible from the outside. A `deliver_after` written from here is
 * correct on any machine whose clock happens to match the database's, which
 * is most of them — including the one that measured the 185-second gap and
 * still passed every test. There is no input that makes it fail.
 *
 * So the rule is the assertion: the column is written by 0030's two functions
 * and by nothing else.
 */
describe("deliver_after is only ever written by the database", () => {
  const SRC = join(process.cwd(), "src");

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [full] : [];
    });
  }

  it("has no source file assigning deliver_after itself", () => {
    const offenders = sourceFiles(SRC).filter((file) =>
      // An object-literal assignment — `deliver_after: something` — which is
      // what a PostgREST `.update()` takes. The RPC calls pass
      // `p_delay_seconds` instead and so do not match.
      /\bdeliver_after\s*:/.test(readFileSync(file, "utf8")),
    );

    expect(
      offenders.map((f) => relative(process.cwd(), f).split(sep).join("/")),
    ).toEqual([]);
  });
});
