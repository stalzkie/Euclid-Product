import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkSiteUrl,
  inlineStyles,
  isFetchableHost,
  matchSitePalette,
  stylesheetLinks,
} from "@/server/site-palette";

/**
 * This module makes our server fetch a URL a founder supplied, so the guards
 * are the part worth testing hardest: a private address must be refused at
 * every hop, not only the first, because a redirect is the obvious way to turn
 * a public URL into an internal one.
 */

describe("isFetchableHost", () => {
  it("accepts an ordinary public host", () => {
    expect(isFetchableHost("driftnote.app")).toBe(true);
    expect(isFetchableHost("www.example.org")).toBe(true);
  });

  it("refuses loopback and the names that resolve to it", () => {
    expect(isFetchableHost("localhost")).toBe(false);
    expect(isFetchableHost("127.0.0.1")).toBe(false);
    expect(isFetchableHost("127.1.1.1")).toBe(false);
    expect(isFetchableHost("::1")).toBe(false);
    expect(isFetchableHost("[::1]")).toBe(false);
    expect(isFetchableHost("0.0.0.0")).toBe(false);
  });

  it("refuses every private range", () => {
    expect(isFetchableHost("10.0.0.1")).toBe(false);
    expect(isFetchableHost("192.168.1.1")).toBe(false);
    expect(isFetchableHost("172.16.0.1")).toBe(false);
    expect(isFetchableHost("172.31.255.255")).toBe(false);
    // The cloud metadata endpoint, which is the one that actually matters.
    expect(isFetchableHost("169.254.169.254")).toBe(false);
    expect(isFetchableHost("fd00::1")).toBe(false);
    expect(isFetchableHost("[fe80::1]")).toBe(false);
  });

  it("does not refuse a public address that merely looks private", () => {
    // 172.32 and 11.x are outside the private ranges.
    expect(isFetchableHost("172.32.0.1")).toBe(true);
    expect(isFetchableHost("11.0.0.1")).toBe(true);
  });

  it("refuses internal-only suffixes and bare names", () => {
    expect(isFetchableHost("printer.local")).toBe(false);
    expect(isFetchableHost("vault.internal")).toBe(false);
    expect(isFetchableHost("intranet")).toBe(false);
    expect(isFetchableHost("")).toBe(false);
  });

  it("refuses our own hostnames", () => {
    expect(isFetchableHost("euclidhq.com")).toBe(false);
    expect(isFetchableHost("app.euclidhq.com")).toBe(false);
  });
});

describe("checkSiteUrl", () => {
  it("assumes https when a founder pastes a bare domain", () => {
    const res = checkSiteUrl("driftnote.app");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.url.toString()).toBe("https://driftnote.app/");
  });

  it("keeps a path, which is where a landing page often lives", () => {
    const res = checkSiteUrl("https://driftnote.app/product");
    expect(res.ok && res.url.pathname).toBe("/product");
  });

  it("refuses schemes that are not the web", () => {
    expect(checkSiteUrl("file:///etc/passwd").ok).toBe(false);
    expect(checkSiteUrl("ftp://example.com").ok).toBe(false);
    // A bare path is not a site.
    expect(checkSiteUrl("/etc/passwd").ok).toBe(false);
  });

  it("refuses credentials in the URL", () => {
    expect(checkSiteUrl("https://user:pass@example.com").ok).toBe(false);
  });

  it("refuses a private target", () => {
    expect(checkSiteUrl("http://127.0.0.1:3000").ok).toBe(false);
    expect(checkSiteUrl("http://169.254.169.254/latest/meta-data/").ok).toBe(false);
  });

  it("asks for a URL when there is none", () => {
    const res = checkSiteUrl("   ");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("project profile");
  });
});

describe("stylesheetLinks", () => {
  const base = new URL("https://driftnote.app/");

  it("resolves relative and protocol-relative hrefs", () => {
    const html = `
      <link rel="stylesheet" href="/app.css">
      <link rel=stylesheet href='//cdn.example.com/x.css'>
      <link rel="preload stylesheet" href="https://driftnote.app/b.css">
    `;
    expect(stylesheetLinks(html, base)).toEqual([
      "https://driftnote.app/app.css",
      "https://cdn.example.com/x.css",
      "https://driftnote.app/b.css",
    ]);
  });

  it("ignores links that are not stylesheets", () => {
    const html = `<link rel="icon" href="/favicon.ico"><link rel="canonical" href="/">`;
    expect(stylesheetLinks(html, base)).toEqual([]);
  });

  it("will not follow a stylesheet href to a private address", () => {
    const html = `
      <link rel="stylesheet" href="http://169.254.169.254/x.css">
      <link rel="stylesheet" href="http://localhost/y.css">
      <link rel="stylesheet" href="data:text/css,body{}">
    `;
    expect(stylesheetLinks(html, base)).toEqual([]);
  });

  it("lists each sheet once", () => {
    const html = `<link rel=stylesheet href="/a.css"><link rel=stylesheet href="/a.css">`;
    expect(stylesheetLinks(html, base)).toEqual(["https://driftnote.app/a.css"]);
  });
});

describe("inlineStyles", () => {
  it("takes the contents of style tags", () => {
    expect(inlineStyles("<style>body{color:red}</style>")).toContain("body{color:red}");
    expect(inlineStyles(`<style type="text/css">a{}</style>`)).toContain("a{}");
  });

  it("wraps style attributes into something readable as a rule", () => {
    expect(inlineStyles(`<div style="background:#0A72DC">`)).toContain("{background:#0A72DC}");
  });

  it("is empty for a page with no styles at all", () => {
    expect(inlineStyles("<p>hello</p>").trim()).toBe("");
  });
});

describe("matchSitePalette", () => {
  afterEach(() => vi.unstubAllGlobals());

  const page = (body: string, headers: Record<string, string> = {}) =>
    new Response(body, { status: 200, headers: { "content-type": "text/html", ...headers } });

  it("reads a palette off the page and the stylesheets it links", async () => {
    const fetchMock = vi.fn(async (input: URL | string) => {
      const url = String(input);
      if (url.endsWith("app.css")) {
        return page(".btn{background:#0A72DC;border-radius:10px}");
      }
      return page(`<link rel="stylesheet" href="/app.css"><style>body{background:#FFF}</style>`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await matchSitePalette("driftnote.app");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.match.accent).toBe("#0A72DC");
    expect(res.match.theme).toBe("Light");
    expect(res.match.radius).toBe("Soft");
    expect(res.stylesheets).toBe(1);
  });

  it("refuses a private URL without making a request at all", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await matchSitePalette("http://169.254.169.254/");
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("will not follow a redirect into a private address", async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn(async (input: URL | string) => {
      const url = String(input);
      seen.push(url);
      if (url.includes("driftnote.app")) {
        return new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data/" },
        });
      }
      return page("secrets");
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await matchSitePalette("https://driftnote.app");
    expect(res.ok).toBe(false);
    expect(seen.some((u) => u.includes("169.254"))).toBe(false);
  });

  it("follows an ordinary redirect, which every apex does", async () => {
    const fetchMock = vi.fn(async (input: URL | string) => {
      const url = String(input);
      if (url === "https://driftnote.app/") {
        return new Response(null, {
          status: 301,
          headers: { location: "https://www.driftnote.app/" },
        });
      }
      return page("<style>body{background:#0B0B0F}.btn{background:#7C3AED}</style>");
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await matchSitePalette("driftnote.app");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.match.theme).toBe("Dark");
      expect(res.url).toBe("https://www.driftnote.app/");
    }
  });

  it("gives up rather than looping on a redirect chain", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: "https://example.com/next" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await matchSitePalette("https://example.com");
    expect(res.ok).toBe(false);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("reports a site that cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ENOTFOUND");
      }),
    );
    const res = await matchSitePalette("driftnote.app");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("driftnote.app");
  });

  it("reports a page whose styles are all unreadable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page("<p>no styles here</p>")));
    const res = await matchSitePalette("driftnote.app");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("styles");
  });
});
