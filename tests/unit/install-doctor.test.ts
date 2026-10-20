import { describe, expect, it } from "vitest";
import { diagnose, type InstallSignal } from "@/lib/install-doctor";
import { isLoopbackHost, signalHost } from "@/server/public-board";

/**
 * The install doctor exists because "still waiting" was the same message for
 * three different situations, one of which was a broken install nobody could
 * see. These tests are about keeping those three apart.
 */

const signal = (over: Partial<InstallSignal> = {}): InstallSignal => ({
  origin: "app.driftnote.io",
  reason: "blocked",
  count: 1,
  lastSeen: "2026-10-21T10:00:00.000Z",
  ...over,
});

describe("diagnose", () => {
  it("says nothing once the board is live", () => {
    // Even with refusals on the record: a founder who fixed their allow-list
    // an hour ago should not still be told about it.
    expect(diagnose(true, [signal()])).toEqual({ kind: "installed" });
  });

  it("reports silence when nothing has arrived", () => {
    expect(diagnose(false, [])).toEqual({ kind: "silent" });
  });

  it("names the refused origin and totals every refusal", () => {
    const d = diagnose(false, [
      signal({ origin: "app.driftnote.io", count: 40 }),
      signal({ origin: "staging.driftnote.io", count: 2 }),
    ]);
    expect(d).toEqual({
      kind: "blocked",
      origins: ["app.driftnote.io", "staging.driftnote.io"],
      count: 42,
    });
  });

  it("puts the most recent refusal first", () => {
    const d = diagnose(false, [
      signal({ origin: "old.driftnote.io", lastSeen: "2026-10-20T09:00:00.000Z" }),
      signal({ origin: "new.driftnote.io", lastSeen: "2026-10-21T09:00:00.000Z" }),
    ]);
    // The first origin is the one the fix button offers, so this decides
    // which domain a founder adds with one click.
    expect(d.kind === "blocked" && d.origins[0]).toBe("new.driftnote.io");
  });

  it("explains a localhost-only board rather than calling it silent", () => {
    const d = diagnose(false, [signal({ origin: "localhost", reason: "local" })]);
    expect(d).toEqual({ kind: "local", origins: ["localhost"] });
  });

  it("reports the fault ahead of the reassurance when both are true", () => {
    // A founder developing locally while their staging domain is refused is
    // in both states. Leading with "working on localhost" would bury the one
    // thing that needs doing.
    const d = diagnose(false, [
      signal({ origin: "localhost", reason: "local", count: 90 }),
      signal({ origin: "staging.driftnote.io", reason: "blocked", count: 3 }),
    ]);
    expect(d.kind).toBe("blocked");
  });
});

describe("isLoopbackHost", () => {
  it("knows the founder's own machine by every name it uses", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "app.localhost"]) {
      expect(isLoopbackHost(host)).toBe(true);
    }
  });

  it("is not fooled by a hostname that merely ends in the word", () => {
    // `notlocalhost` must not match, or buying that domain is a way past the
    // allow-list for as long as a board has never been served live.
    expect(isLoopbackHost("notlocalhost")).toBe(false);
    expect(isLoopbackHost("localhost.evil.com")).toBe(false);
    expect(isLoopbackHost("app.driftnote.io")).toBe(false);
  });
});

describe("signalHost", () => {
  it("reduces an origin to the hostname a founder would recognise", () => {
    expect(signalHost("https://app.driftnote.io")).toBe("app.driftnote.io");
    expect(signalHost("http://localhost:3000")).toBe("localhost");
    // A referer carries a path; the diagnosis is about the host.
    expect(signalHost("https://app.driftnote.io/pricing?x=1")).toBe("app.driftnote.io");
  });

  it("lowercases, so one domain is one row", () => {
    expect(signalHost("https://App.Driftnote.IO")).toBe("app.driftnote.io");
  });

  it("returns null for anything that is not a URL", () => {
    expect(signalHost(null)).toBeNull();
    expect(signalHost("")).toBeNull();
    expect(signalHost("not a url")).toBeNull();
  });
});
