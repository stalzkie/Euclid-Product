import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminEmails, funnelCounts, isAdminEmail } from "@/server/admin";
import { fingerprint, normaliseRoute } from "@/server/errors";

/**
 * The admin gate, and how errors are grouped.
 *
 * The gate's failure mode is the expensive one in this repo: /admin reads
 * across every workspace, so a bug that opens it is a bug that leaks every
 * founder's operational data at once. The tests below are about it being shut
 * by default rather than about it opening correctly.
 */

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.ADMIN_EMAILS;
  delete process.env.ADMIN_EMAILS;
});
afterEach(() => {
  if (saved === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = saved;
});

describe("the admin allow-list", () => {
  it("admits nobody when unset", () => {
    // Including in development. An admin surface that opens itself when
    // unconfigured is the wrong default for the one page that reads
    // everything.
    expect(adminEmails()).toEqual([]);
    expect(isAdminEmail("anyone@example.com")).toBe(false);
  });

  it("admits nobody when set to an empty string", () => {
    process.env.ADMIN_EMAILS = "";
    expect(isAdminEmail("anyone@example.com")).toBe(false);
  });

  it("admits nobody when set to only separators", () => {
    // ADMIN_EMAILS=", ," is a misconfiguration, not a wildcard.
    process.env.ADMIN_EMAILS = " , , ";
    expect(adminEmails()).toEqual([]);
    expect(isAdminEmail("anyone@example.com")).toBe(false);
  });

  it("admits a listed address, ignoring case and spacing", () => {
    process.env.ADMIN_EMAILS = " Ops@Euclidhq.com , second@euclidhq.com ";
    expect(isAdminEmail("ops@euclidhq.com")).toBe(true);
    expect(isAdminEmail("OPS@EUCLIDHQ.COM")).toBe(true);
    expect(isAdminEmail("second@euclidhq.com")).toBe(true);
  });

  it("refuses an address that is not listed", () => {
    process.env.ADMIN_EMAILS = "ops@euclidhq.com";
    expect(isAdminEmail("ops@euclidhq.com.evil.test")).toBe(false);
    expect(isAdminEmail("notops@euclidhq.com")).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });
});

describe("error fingerprinting", () => {
  it("groups the same fault with different ids into one row", () => {
    /*
      The whole reason this table exists rather than a log tail. Without
      normalising, every failed subscription would be its own "fault" and the
      list would be as unreadable as the log it replaces.
    */
    const a = fingerprint(
      "Error",
      "No workspace for subscription sub_8f2k1xAA",
      "POST /api/billing/webhook",
    );
    const b = fingerprint(
      "Error",
      "No workspace for subscription sub_99zzQQ11",
      "POST /api/billing/webhook",
    );
    expect(a).toBe(b);
  });

  it("groups past uuids, numbers and quoted values", () => {
    const a = fingerprint("Error", 'Board "alpha" has 3 boards', "/x");
    const b = fingerprint("Error", 'Board "beta" has 41 boards', "/x");
    expect(a).toBe(b);
  });

  it("keeps genuinely different faults apart", () => {
    const base = fingerprint("Error", "Polar refused the checkout", "/a");
    expect(base).not.toBe(fingerprint("TypeError", "Polar refused the checkout", "/a"));
    expect(base).not.toBe(fingerprint("Error", "Polar refused the portal", "/a"));
    expect(base).not.toBe(fingerprint("Error", "Polar refused the checkout", "/b"));
  });

  it("is stable across calls", () => {
    expect(fingerprint("Error", "x", "/a")).toBe(fingerprint("Error", "x", "/a"));
  });

  it("ignores Next's RSC cache-buster", () => {
    /*
      Found by looking at the first real row this ever captured, which read
      `GET /?_rsc=fH7YU5buuezjznK`. That parameter is random per request, so
      without normalising it the same fault on the same page would be a new
      row every single time — the exact failure the fingerprint exists to
      prevent.
    */
    const a = fingerprint("ReferenceError", "boom", "GET /?_rsc=fH7YU5buuezjznK");
    const b = fingerprint("ReferenceError", "boom", "GET /?_rsc=9aQQz11bbbbbbbb");
    expect(a).toBe(b);
    expect(a).toBe(fingerprint("ReferenceError", "boom", "GET /"));
  });

  it("still separates different paths", () => {
    expect(fingerprint("Error", "boom", "GET /a?x=1")).not.toBe(
      fingerprint("Error", "boom", "GET /b?x=1"),
    );
  });
});

describe("normaliseRoute", () => {
  it("drops the query string", () => {
    expect(normaliseRoute("GET /billing?upgraded=1")).toBe("GET /billing");
    expect(normaliseRoute("GET /")).toBe("GET /");
  });

  it("passes null through", () => {
    expect(normaliseRoute(null)).toBeNull();
    // A route that is nothing but a query string identifies no code.
    expect(normaliseRoute("?x=1")).toBeNull();
  });
});

/**
 * The funnel.
 *
 * One property matters more than the numbers: a step can never exceed the
 * step above it. The first render of this panel showed "Paid 200%" because
 * the stages were counted independently, and a chart that can print 200% is
 * one nobody can trust the rest of.
 */
describe("funnelCounts", () => {
  type Row = { onboarded: boolean; installed: boolean; paid: boolean };
  const stages = [
    { label: "Signed up", reached: () => true },
    { label: "Onboarded", reached: (r: Row) => r.onboarded },
    { label: "Installed", reached: (r: Row) => r.installed },
    { label: "Paid", reached: (r: Row) => r.paid },
  ];

  it("never lets a step exceed the one above it", () => {
    // The exact shape that produced 200%: paid without onboarding, which is
    // what a workspace seeded straight into SQL looks like.
    const rows: Row[] = [
      { onboarded: false, installed: false, paid: true },
      { onboarded: true, installed: true, paid: true },
    ];
    const steps = funnelCounts(rows, stages);

    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].count).toBeLessThanOrEqual(steps[i - 1].count);
    }
    expect(steps.map((s) => s.count)).toEqual([2, 1, 1, 1]);
  });

  it("never reports a conversion above 100%", () => {
    const rows: Row[] = [
      { onboarded: false, installed: true, paid: true },
      { onboarded: false, installed: true, paid: true },
      { onboarded: true, installed: false, paid: false },
    ];
    for (const step of funnelCounts(rows, stages)) {
      if (step.conversion !== null) expect(step.conversion).toBeLessThanOrEqual(1);
    }
  });

  it("drops a row that skipped a step, even if it reached a later one", () => {
    // The accepted cost of being cumulative, asserted so nobody "fixes" it
    // back into independent counts. The absolute numbers that ignore order
    // live on the billing panel.
    const steps = funnelCounts([{ onboarded: false, installed: false, paid: true }], stages);
    expect(steps.at(-1)!.count).toBe(0);
  });

  it("reports the first step with no conversion", () => {
    const steps = funnelCounts([{ onboarded: true, installed: true, paid: true }], stages);
    expect(steps[0].conversion).toBeNull();
    expect(steps[1].conversion).toBe(1);
  });

  it("handles no rows without dividing by zero", () => {
    const steps = funnelCounts([] as Row[], stages);
    expect(steps.every((s) => s.count === 0)).toBe(true);
    expect(steps[1].conversion).toBe(0);
  });
});
