import { isReserved } from "@/lib/domains";
import { matchDesign, type DesignMatch } from "@/lib/design-match";

/**
 * Fetching a founder's own site so the designer can match its colours.
 *
 * The URL comes from the founder, which makes this a request our server makes
 * to somewhere they choose — so the guards here are the point of the module.
 * It will only follow http(s), only to a public hostname, re-checks every
 * redirect hop, and stops reading at a fixed number of bytes.
 */

export type PaletteResult =
  | { ok: true; url: string; match: DesignMatch; stylesheets: number }
  | { ok: false; error: string };

/** Enough of a page to carry its palette; far short of enough to be a problem. */
const MAX_BYTES = 1_500_000;
const MAX_STYLESHEETS = 4;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8_000;

/** Hostnames that resolve inside the network this server runs in. */
const PRIVATE_PATTERNS = [
  /^localhost$/i,
  /^\[?::1\]?$/,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  // Link-local and unique-local IPv6, with or without the URL's brackets.
  /^\[?f[cde][0-9a-f]{2}:/i,
];

/**
 * Whether a hostname may be fetched. Literal private addresses and the names
 * that resolve to them are refused; a public name that later resolves to a
 * private address is not something this can see, which is why the result is
 * only ever read as colours and never shown back as a body.
 */
export function isFetchableHost(host: string): boolean {
  const value = host.trim().toLowerCase();
  if (!value) return false;
  if (PRIVATE_PATTERNS.some((p) => p.test(value))) return false;
  // `localhost`, `.local`, `.internal`, `.test` and our own apex.
  if (isReserved(value)) return false;
  if (!value.includes(".")) return false;
  return true;
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; error: string };

/** The founder's `app_url`, checked and normalised into something fetchable. */
export function checkSiteUrl(raw: string): UrlCheck {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Add your app's URL to the project profile first." };

  let parsed: URL;
  try {
    parsed = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, error: `"${trimmed}" is not a URL.` };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "Only http and https addresses can be read." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "Remove the username and password from the URL." };
  }
  if (!isFetchableHost(parsed.hostname)) {
    return { ok: false, error: `${parsed.hostname} is not a public address.` };
  }
  return { ok: true, url: parsed };
}

/** `<link rel=stylesheet>` hrefs, in the order the page declares them. */
export function stylesheetLinks(html: string, base: URL): string[] {
  const out: string[] = [];
  const tag = /<link\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(html))) {
    const el = match[0];
    if (!/\brel\s*=\s*["']?[^"'>]*stylesheet/i.test(el)) continue;
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(el);
    const value = href?.[1] ?? href?.[2] ?? href?.[3];
    if (!value) continue;
    try {
      const resolved = new URL(value, base);
      if (resolved.protocol !== "https:" && resolved.protocol !== "http:") continue;
      if (!isFetchableHost(resolved.hostname)) continue;
      out.push(resolved.toString());
    } catch {
      // A malformed href is the page's problem, not ours.
    }
  }
  return [...new Set(out)];
}

/** Everything between `<style>` tags, which is where a bundler often puts it. */
export function inlineStyles(html: string): string {
  const out: string[] = [];
  const tag = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(html))) out.push(match[1]);

  // Inline `style="..."` attributes carry the colours of hand-written pages.
  // Wrapped in a rule so the declaration reader sees them like any other.
  const attr = /\bstyle\s*=\s*"([^"]*)"/gi;
  while ((match = attr.exec(html))) out.push(`.inline{${match[1]}}`);

  return out.join("\n");
}

/**
 * Fetches one resource with every guard applied, following redirects by hand
 * so each hop's host is checked rather than only the first.
 */
async function fetchText(start: URL): Promise<{ url: URL; body: string } | null> {
  let url = start;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        cache: "no-store",
        headers: {
          // Identifying the caller is the courteous thing to do, and makes
          // this easy to block for anyone who would rather we did not.
          "user-agent": "EuclidBoard/1.0 (+https://euclidhq.com; design matcher)",
          accept: "text/html,text/css;q=0.9,*/*;q=0.1",
        },
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return null;
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        return null;
      }
      // A redirect is the obvious way to turn a public URL into an internal
      // one, so every hop is checked exactly like the first.
      if (next.protocol !== "https:" && next.protocol !== "http:") return null;
      if (!isFetchableHost(next.hostname)) return null;
      url = next;
      continue;
    }

    if (!res.ok || !res.body) return null;
    return { url, body: await readCapped(res) };
  }

  return null;
}

/** Reads a response, stopping at MAX_BYTES rather than trusting its length. */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let out = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (total >= MAX_BYTES) {
      await reader.cancel();
      break;
    }
  }
  return out;
}

/**
 * Reads a site and proposes a board design from it. The founder sees the
 * proposal and the reasoning behind it; nothing is saved until they publish.
 */
export async function matchSitePalette(rawUrl: string): Promise<PaletteResult> {
  const checked = checkSiteUrl(rawUrl);
  if (!checked.ok) return { ok: false, error: checked.error };

  const page = await fetchText(checked.url);
  if (!page) {
    return {
      ok: false,
      error: `Could not read ${checked.url.hostname}. Check the URL is public and the site is up.`,
    };
  }

  const links = stylesheetLinks(page.body, page.url).slice(0, MAX_STYLESHEETS);
  const sheets = await Promise.all(
    links.map(async (href) => {
      try {
        return (await fetchText(new URL(href)))?.body ?? "";
      } catch {
        return "";
      }
    }),
  );

  const loaded = sheets.filter(Boolean);
  const css = [inlineStyles(page.body), ...loaded].join("\n");

  if (!css.trim()) {
    return {
      ok: false,
      error: `${checked.url.hostname} loaded, but none of its styles could be read.`,
    };
  }

  return {
    ok: true,
    url: page.url.toString(),
    match: matchDesign(css),
    stylesheets: loaded.length,
  };
}
