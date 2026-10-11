import { describe, expect, it } from "vitest";
import { originAllowed, type PublicBoard } from "@/server/public-board";
import { DEFAULT_DESIGN, mergeDesign, resolveTheme } from "@/lib/design-presets";
import { uuid } from "@/lib/validation";

/**
 * The allow-list is what stops someone else embedding a founder's board on
 * their own site, so the cases that matter are the near misses: a domain that
 * merely *contains* the allowed one, and a subdomain that legitimately should.
 */

function board(allowedDomains: string[]): PublicBoard {
  return {
    id: "board-1",
    publicId: "brd_test",
    name: "Feature requests",
    workspaceName: "Driftnote",
    appName: "Driftnote",
    appUrl: "https://driftnote.app",
    design: DEFAULT_DESIGN,
    identityMode: "email",
    allowedDomains,
    anonVoteLimit: 10,
    requireApproval: false,
    showBadge: false,
    categories: ["Feature"],
  };
}

describe("originAllowed", () => {
  it("allows the exact domain", () => {
    expect(originAllowed(board(["driftnote.app"]), "https://driftnote.app")).toBe(true);
  });

  it("allows a subdomain of an allowed domain", () => {
    expect(originAllowed(board(["driftnote.app"]), "https://app.driftnote.app")).toBe(true);
  });

  it("refuses a lookalike domain that merely ends in the same words", () => {
    // The attack: register notdriftnote.app and embed someone else's board.
    expect(originAllowed(board(["driftnote.app"]), "https://notdriftnote.app")).toBe(false);
  });

  it("refuses an unrelated domain", () => {
    expect(originAllowed(board(["driftnote.app"]), "https://evil.example")).toBe(false);
  });

  it("refuses a domain that only contains the allowed one as a prefix", () => {
    expect(originAllowed(board(["driftnote.app"]), "https://driftnote.app.evil.com")).toBe(
      false,
    );
  });

  it("allows localhost so a founder can test before deploying", () => {
    expect(originAllowed(board(["driftnote.app"]), "http://localhost:3000")).toBe(true);
    expect(originAllowed(board(["driftnote.app"]), "http://127.0.0.1:5173")).toBe(true);
  });

  it("allows anything when the founder has not locked the board down", () => {
    // Permitted while testing, and flagged in the dashboard.
    expect(originAllowed(board([]), "https://anywhere.example")).toBe(true);
  });

  it("refuses a request with no origin once a list exists", () => {
    expect(originAllowed(board(["driftnote.app"]), null)).toBe(false);
  });

  it("refuses an unparseable origin", () => {
    expect(originAllowed(board(["driftnote.app"]), "not a url")).toBe(false);
  });

  it("ignores case, since hostnames are case insensitive", () => {
    expect(originAllowed(board(["DriftNote.app"]), "https://DRIFTNOTE.APP")).toBe(true);
  });

  it("honours a wildcard entry", () => {
    expect(originAllowed(board(["*.driftnote.app"]), "https://staging.driftnote.app")).toBe(
      true,
    );
  });
});

describe("mergeDesign", () => {
  it("fills in every default for a board that stored nothing", () => {
    expect(mergeDesign(null)).toEqual(DEFAULT_DESIGN);
    expect(mergeDesign({})).toEqual(DEFAULT_DESIGN);
  });

  it("keeps what the founder set and defaults the rest", () => {
    const merged = mergeDesign({ accent: "#D1347A", heading: "Tell us" });

    expect(merged.accent).toBe("#D1347A");
    expect(merged.heading).toBe("Tell us");
    expect(merged.submitCta).toBe(DEFAULT_DESIGN.submitCta);
  });
});

describe("resolveTheme", () => {
  it("renders a dark board on a dark surface", () => {
    const light = resolveTheme({ ...DEFAULT_DESIGN, theme: "Light" });
    const dark = resolveTheme({ ...DEFAULT_DESIGN, theme: "Dark" });

    expect(light.bg).not.toBe(dark.bg);
    expect(dark.fg).not.toBe(light.fg);
  });

  it("carries the founder's accent through unchanged", () => {
    expect(resolveTheme({ ...DEFAULT_DESIGN, accent: "#7C3AED" }).accent).toBe("#7C3AED");
  });

  it("gives round corners a larger radius than sharp ones", () => {
    const sharp = resolveTheme({ ...DEFAULT_DESIGN, radius: "Sharp" });
    const round = resolveTheme({ ...DEFAULT_DESIGN, radius: "Round" });

    expect(parseInt(round.r16, 10)).toBeGreaterThan(parseInt(sharp.r16, 10));
  });
});

describe("uuid validation", () => {
  const schema = uuid();

  it("accepts a v4 uuid, which is what the database mints", () => {
    expect(schema.safeParse("3f1a9c2e-7b64-4d3a-9f21-2b7c8e5d1a04").success).toBe(true);
  });

  it("accepts a readable fixture id that Postgres also accepts", () => {
    // Stricter-than-the-database validation rejects real rows. This exact
    // shape is what seeded data uses.
    expect(schema.safeParse("55555555-0000-0000-0000-000000000142").success).toBe(true);
  });

  it("accepts upper case", () => {
    expect(schema.safeParse("3F1A9C2E-7B64-4D3A-9F21-2B7C8E5D1A04").success).toBe(true);
  });

  it("refuses anything that is not 8-4-4-4-12 hex", () => {
    for (const bad of ["", "not-a-uuid", "55555555-0000-0000-0000", "zzzzzzzz-0000-0000-0000-000000000142"]) {
      expect(schema.safeParse(bad).success).toBe(false);
    }
  });
});
