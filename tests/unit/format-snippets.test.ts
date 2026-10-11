import { describe, expect, it } from "vitest";
import { ago, plural, signedPct, slugify, thousands } from "@/lib/format";
import { agentInstallPrompt, installSnippet } from "@/lib/snippets";
import { defaultTargetFor, targetSpec } from "@/lib/ai/targets";

/**
 * Install snippets are copied into someone else's codebase, so the board id
 * and the loader URL have to be right. Formatting is here because "1 comments"
 * shipped once already.
 */

describe("plural", () => {
  it("uses the singular for exactly one", () => {
    expect(plural(1, "comment")).toBe("1 comment");
  });

  it("uses the plural for none and for many", () => {
    expect(plural(0, "comment")).toBe("0 comments");
    expect(plural(2, "comment")).toBe("2 comments");
  });

  it("takes an irregular plural when given one", () => {
    expect(plural(2, "person", "people")).toBe("2 people");
    expect(plural(1, "person", "people")).toBe("1 person");
  });
});

describe("ago", () => {
  it("reads as just now for the last minute", () => {
    expect(ago(new Date().toISOString())).toBe("just now");
  });

  it("counts minutes, then hours, then days", () => {
    const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

    expect(ago(minutesAgo(5))).toBe("5m");
    expect(ago(minutesAgo(90))).toBe("1h");
    expect(ago(minutesAgo(60 * 24))).toBe("yesterday");
    expect(ago(minutesAgo(60 * 24 * 3))).toBe("3d");
    expect(ago(minutesAgo(60 * 24 * 14))).toBe("2w");
  });

  it("falls back to a date once a timestamp is old", () => {
    const longAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 200).toISOString();

    expect(ago(longAgo)).toMatch(/[A-Z][a-z]{2} \d{1,2}/);
  });
});

describe("signedPct and thousands", () => {
  it("marks a rise with a plus and a fall with a minus", () => {
    expect(signedPct(38)).toBe("+38%");
    expect(signedPct(-12)).toBe("-12%");
    expect(signedPct(0)).toBe("+0%");
  });

  it("groups thousands so vote counts stay readable", () => {
    expect(thousands(1942)).toBe("1,942");
  });
});

describe("slugify", () => {
  it("makes a board name URL safe", () => {
    expect(slugify("Feature Requests")).toBe("feature-requests");
    expect(slugify("Bugs & Issues!")).toBe("bugs-issues");
  });

  it("never returns an empty slug", () => {
    expect(slugify("!!!")).toBe("board");
    expect(slugify("")).toBe("board");
  });
});

describe("installSnippet", () => {
  const args = { boardId: "brd_8f2k1x", mode: "floating" as const, origin: "https://euclidhq.com" };

  it("embeds the board id and the loader URL in every framework", () => {
    for (const framework of ["html", "next", "react", "vue", "nocode"]) {
      const snippet = installSnippet(framework, args);

      expect(snippet).toContain("brd_8f2k1x");
      expect(snippet).toContain("https://euclidhq.com/widget.js");
    }
  });

  it("carries the chosen embed mode through", () => {
    expect(installSnippet("html", { ...args, mode: "inline" })).toContain("inline");
    expect(installSnippet("html", args)).toContain("floating");
  });

  it("uses next/script for Next.js, not a raw tag", () => {
    expect(installSnippet("next", args)).toContain("next/script");
  });

  it("emits a complete script tag the founder can paste as-is", () => {
    // The snippet is documentation: it has to be valid where it lands, so
    // the closing tag belongs in the output even though the source splits it.
    const html = installSnippet("html", args);

    expect(html).toContain("<script");
    expect(html).toContain("</scr" + "ipt>");
    expect(html).toContain("async");
  });

  it("marks the script async so it cannot block the host page", () => {
    // A widget outage must never slow down the founder's own app.
    expect(installSnippet("html", args)).toMatch(/async/);
    expect(installSnippet("next", args)).toMatch(/lazyOnload/);
    expect(installSnippet("react", args)).toMatch(/s\.async = true/);
  });

  it("falls back to the plain HTML tag for an unknown framework", () => {
    expect(installSnippet("brand-new-thing", args)).toContain("brd_8f2k1x");
  });
});

describe("agentInstallPrompt", () => {
  const base = {
    boardId: "brd_8f2k1x",
    mode: "floating" as const,
    origin: "https://euclidhq.com",
    stack: [{ kind: "Framework", name: "Next.js 15 (App Router)" }],
    identityMode: "anonymous",
  };

  it("names the founder's own framework", () => {
    expect(agentInstallPrompt(base)).toContain("Next.js 15 (App Router)");
  });

  it("asks for a diff before writing, so nothing lands unseen", () => {
    expect(agentInstallPrompt(base)).toMatch(/diff before you write/i);
  });

  it("explains the signed-token step only when the board uses one", () => {
    expect(agentInstallPrompt(base)).not.toContain("EUCLID_SECRET");
    expect(agentInstallPrompt({ ...base, identityMode: "jwt" })).toContain("EUCLID_SECRET");
  });
});

describe("defaultTargetFor", () => {
  it("picks the tool the founder actually uses", () => {
    expect(defaultTargetFor(["Claude Code", "Cursor"])).toBe("claude");
    expect(defaultTargetFor(["Cursor"])).toBe("cursor");
    expect(defaultTargetFor(["Codex"])).toBe("codex");
    expect(defaultTargetFor(["Lovable"])).toBe("builder");
  });

  it("falls back to generic when it recognises nothing", () => {
    expect(defaultTargetFor([])).toBe("generic");
    expect(defaultTargetFor(["Hand-coded"])).toBe("generic");
  });
});

describe("targetSpec", () => {
  it("tells repo-aware tools apart from chat-only builders", () => {
    // A tool with no repo access must never be handed file paths.
    expect(targetSpec("claude").repoAware).toBe(true);
    expect(targetSpec("builder").repoAware).toBe(false);
  });

  it("gives every target a distinct download filename", () => {
    const names = (["claude", "codex", "cursor", "builder", "generic"] as const).map(
      (t) => targetSpec(t).file,
    );

    expect(new Set(names).size).toBe(names.length);
  });
});
