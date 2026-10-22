import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EVENT_CATALOGUE,
  EVENT_NAMES,
  MAX_BATCH,
  MAX_PROPS,
  MAX_PROP_LENGTH,
  ONBOARDING_STEPS,
  cleanBatch,
  cleanProps,
  eventLabel,
  isEventName,
  normalisePath,
} from "@/lib/analytics/events";

/**
 * What a browser is allowed to write into `analytics_events`.
 *
 * This is the only table in the schema whose rows originate outside the
 * server, so it is the only one where "what did the client send" is a
 * security question rather than a correctness one. Everything here is about
 * the two ways that goes wrong: a name nobody can account for, and a property
 * carrying something that should never have left the browser.
 */

describe("the catalogue", () => {
  it("admits only names it knows", () => {
    expect(isEventName("screen.designer")).toBe(true);
    expect(isEventName("screen.nonsense")).toBe(false);
    expect(isEventName("")).toBe(false);
    expect(isEventName(null)).toBe(false);
    expect(isEventName(42)).toBe(false);
  });

  it("does not admit inherited object properties", () => {
    // `name in catalogue` is true for "constructor" and "toString" unless the
    // check is written carefully, and either would be a row the console
    // cannot label.
    expect(isEventName("constructor")).toBe(false);
    expect(isEventName("toString")).toBe(false);
    expect(isEventName("__proto__")).toBe(false);
  });

  it("holds only names the database will accept", () => {
    /*
      0032 puts a check constraint on `name` as the floor under this
      catalogue. A name that passes here and fails there would be an event
      that is silently never recorded — the route logs a warning nobody
      reads, and the panel is simply empty.
    */
    const constraint = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,3}$/;
    for (const name of EVENT_NAMES) {
      expect(name, `${name} would be refused by the 0032 check constraint`).toMatch(constraint);
    }
  });

  it("matches the check constraint the migration actually declares", () => {
    // Read rather than restated: the pair above is only a guarantee while the
    // two regexes are the same one.
    const sql = readFileSync(
      join(process.cwd(), "supabase", "migrations", "0032_analytics_events.sql"),
      "utf8",
    );
    expect(sql).toContain("^[a-z][a-z0-9_]*(\\.[a-z0-9_]+){1,3}$");
  });

  it("labels every name, and falls back rather than printing nothing", () => {
    for (const name of EVENT_NAMES) {
      expect(eventLabel(name).length).toBeGreaterThan(0);
    }
    // A row written by an older deploy whose name has since been removed.
    expect(eventLabel("screen.retired")).toBe("screen.retired");
  });

  it("walks the onboarding steps in the product's order", () => {
    // Alphabetical is wrong here: app, then profile, then install.
    expect(ONBOARDING_STEPS).toEqual([
      "onboarding.app",
      "onboarding.profile",
      "onboarding.install",
    ]);
    for (const step of ONBOARDING_STEPS) expect(step in EVENT_CATALOGUE).toBe(true);
  });

  it("captures nothing that state already records", () => {
    /*
      The rule the table exists under: no captured event may duplicate a fact
      the database holds. Each of these was considered and cut —
      `build_prompts.copied`, `boards.design` and a polling effect
      respectively — and the test is here so adding one back is a deliberate
      argument rather than an oversight.
    */
    for (const name of ["prompt.copied", "designer.saved", "install.doctor_run"]) {
      expect(isEventName(name), `${name} is derivable from state`).toBe(false);
    }
  });
});

describe("cleanProps", () => {
  it("keeps flat scalars and trims them", () => {
    expect(cleanProps({ framework: "  next  ", count: 3, ok: true })).toEqual({
      framework: "next",
      count: 3,
      ok: true,
    });
  });

  it("drops anything shaped like an address", () => {
    // The one hard rule. This table has no RLS policies and the route already
    // knows who sent the event, so an address in a property is the same fact
    // recorded a second time in the least protected place.
    expect(cleanProps({ who: "founder@example.com" })).toEqual({});
    expect(cleanProps({ note: "write to a.b@c.co about it" })).toEqual({});
    // Not an address, and should survive.
    expect(cleanProps({ handle: "@someone" })).toEqual({ handle: "@someone" });
  });

  it("drops nested values rather than storing them", () => {
    expect(
      cleanProps({ nested: { a: 1 }, list: [1, 2], nothing: null, missing: undefined }),
    ).toEqual({});
  });

  it("refuses a number that is not JSON", () => {
    expect(cleanProps({ a: Number.NaN, b: Number.POSITIVE_INFINITY, c: 1.5 })).toEqual({ c: 1.5 });
  });

  it("refuses keys the console could not render", () => {
    expect(cleanProps({ "Mixed-Case": "x", "a b": "y", ok_key: "z" })).toEqual({ ok_key: "z" });
  });

  it("truncates a long string instead of losing the event", () => {
    const long = "x".repeat(400);
    const out = cleanProps({ note: long });
    expect((out.note as string).length).toBe(MAX_PROP_LENGTH);
  });

  it("stops at the key limit", () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_PROPS + 8 }, (_, i) => [`k${i}`, i]),
    );
    expect(Object.keys(cleanProps(many))).toHaveLength(MAX_PROPS);
  });

  it("takes nothing from a non-object", () => {
    expect(cleanProps(null)).toEqual({});
    expect(cleanProps("framework=next")).toEqual({});
    expect(cleanProps([1, 2, 3])).toEqual({});
  });
});

describe("normalisePath", () => {
  it("drops the query string and the hash", () => {
    // Where a token, an address or a promo code ends up, and none of them
    // belong in a table the console reads in bulk.
    expect(normalisePath("/billing?upgraded=1&promo=indie3")).toBe("/billing");
    expect(normalisePath("/install#snippet")).toBe("/install");
  });

  it("collapses ids so one screen is one row", () => {
    expect(normalisePath("/posts/42")).toBe("/posts/:n");
    expect(normalisePath("/prompts/0b3f3e2a-6c1f-4a44-9f1e-7a2b9c8d1e5f")).toBe("/prompts/:id");
    expect(normalisePath("/b/brd_itest01/p/7")).toBe("/b/:board/p/:n");
  });

  it("keeps the root as the root", () => {
    expect(normalisePath("/")).toBe("/");
  });

  it("refuses anything that is not a path", () => {
    // An absolute URL would carry a host, and a bare word carries nothing.
    expect(normalisePath("https://evil.test/steal")).toBeNull();
    expect(normalisePath("designer")).toBeNull();
    expect(normalisePath(null)).toBeNull();
    expect(normalisePath(17)).toBeNull();
  });
});

describe("cleanBatch", () => {
  it("drops an unknown name without failing the batch", () => {
    // A tab running a cached bundle from before a rename is the common case,
    // and rejecting the whole request would turn that into an error on a
    // screen somebody is trying to use.
    const out = cleanBatch([
      { name: "screen.designer", path: "/designer" },
      { name: "screen.whatever", path: "/designer" },
      { name: "install.snippet_copied", path: "/install", props: { framework: "next" } },
    ]);
    expect(out.map((e) => e.name)).toEqual(["screen.designer", "install.snippet_copied"]);
    expect(out[1].props).toEqual({ framework: "next" });
  });

  it("caps how much one request may write", () => {
    const many = Array.from({ length: MAX_BATCH + 20 }, () => ({ name: "screen.home" }));
    expect(cleanBatch(many)).toHaveLength(MAX_BATCH);
  });

  it("refuses a session id that is not one", () => {
    const [clean] = cleanBatch([{ name: "screen.home", session: "abc-123_XYZ" }]);
    expect(clean.session).toBe("abc-123_XYZ");

    const [dirty] = cleanBatch([{ name: "screen.home", session: "a'; drop table --" }]);
    expect(dirty.session).toBeNull();
  });

  it("takes nothing from a body that is not a list", () => {
    expect(cleanBatch(undefined)).toEqual([]);
    expect(cleanBatch({ name: "screen.home" })).toEqual([]);
    expect(cleanBatch("screen.home")).toEqual([]);
  });

  it("never carries a timestamp, however hard the caller tries", () => {
    // The database stamps `created_at`. A client clock is the thing 0030 took
    // out of the retry schedule, and the same argument applies here.
    const [clean] = cleanBatch([
      { name: "screen.home", createdAt: "1999-01-01T00:00:00.000Z" } as never,
    ]);
    expect(Object.keys(clean).sort()).toEqual(["name", "path", "props", "session"]);
  });
});
