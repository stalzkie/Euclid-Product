/**
 * Integration harness.
 *
 * These tests drive the public API the way a visitor's browser does: real
 * HTTP, real cookies, a real database. Nothing is mocked, because the bugs
 * worth catching here live in the seams between the route, the SQL and the
 * identity rules — exactly the places a mock would paper over.
 *
 * They need a running app and a Supabase stack. In CI that is provided by the
 * workflow; locally, start `supabase start` and `npm run dev` first. Without
 * them the suite skips rather than fails, so `npm test` stays useful on a
 * laptop with nothing running.
 */

export const APP_URL = process.env.TEST_APP_URL ?? "http://localhost:3000";
export const SUPABASE_URL =
  process.env.TEST_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SERVICE_KEY =
  process.env.TEST_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** The board the fixtures create. Tests address it by this public id. */
export const TEST_BOARD_PUBLIC_ID = "brd_itest01";

export const dbHeaders = {
  apikey: SERVICE_KEY,
  authorization: `Bearer ${SERVICE_KEY}`,
  "content-type": "application/json",
};

export async function stackIsUp(): Promise<boolean> {
  if (!SUPABASE_URL || !SERVICE_KEY) return false;
  try {
    const [app, db] = await Promise.all([
      fetch(`${APP_URL}/widget.js`, { method: "HEAD" }),
      fetch(`${SUPABASE_URL}/rest/v1/boards?select=id&limit=1`, { headers: dbHeaders }),
    ]);
    const up = app.ok && db.ok;
    // These tests write real rows. Say where, so nobody discovers afterwards
    // that the target was the production project rather than a local stack.
    if (up) console.info(`  integration target: ${APP_URL} against ${new URL(SUPABASE_URL).host}`);
    return up;
  } catch {
    return false;
  }
}

/** A browser-ish client: keeps cookies and always sends an Origin. */
export function createVisitor(origin = APP_URL) {
  const jar = new Map<string, string>();

  return {
    get cookies() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    async call<T = Record<string, unknown>>(
      path: string,
      init: RequestInit = {},
    ): Promise<{ status: number; body: T }> {
      const res = await fetch(APP_URL + path, {
        ...init,
        headers: {
          "content-type": "application/json",
          origin,
          ...(jar.size ? { cookie: this.cookies } : {}),
          ...(init.headers ?? {}),
        },
      });
      for (const raw of res.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
      }
      const text = await res.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      return { status: res.status, body: body as T };
    },
  };
}

export const db = {
  async select<T = Record<string, unknown>>(path: string): Promise<T[]> {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: dbHeaders });
    return res.ok ? ((await res.json()) as T[]) : [];
  },
  async patch(path: string, body: unknown): Promise<void> {
    await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method: "PATCH",
      headers: dbHeaders,
      body: JSON.stringify(body),
    });
  },
  /**
   * A PATCH that hands back the response, for the tests that assert on a
   * write being *refused*. Going through here rather than a hand-rolled
   * fetch is what keeps a test pointed at the same database as the rest of
   * the suite.
   */
  async patchRaw(path: string, body: unknown): Promise<Response> {
    return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method: "PATCH",
      headers: dbHeaders,
      body: JSON.stringify(body),
    });
  },
  async insert<T = Record<string, unknown>>(table: string, rows: unknown): Promise<T[]> {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: { ...dbHeaders, Prefer: "return=representation" },
      body: JSON.stringify(rows),
    });
    return res.ok ? ((await res.json()) as T[]) : [];
  },
  async remove(path: string): Promise<void> {
    await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: "DELETE", headers: dbHeaders });
  },
  /**
   * Calls a Postgres function.
   *
   * A `returns void` function answers 204 with no body at all, so parsing the
   * response unconditionally throws "Unexpected end of JSON input" on a call
   * that in fact succeeded — which reads as a broken function rather than a
   * broken helper. `apply_subscription` is the one that found this.
   */
  async rpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T | null> {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: dbHeaders,
      body: JSON.stringify(args),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text ? ((JSON.parse(text) as T) ?? null) : null;
  },
};

export interface Fixture {
  workspaceId: string;
  boardId: string;
  publicId: string;
  posts: { id: string; number: number; title: string }[];
}

/**
 * Builds an isolated workspace and board for one test file, so suites never
 * see each other's rows and a failure leaves nothing behind.
 */
export async function createFixture(label: string): Promise<Fixture> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const slug = `itest-${label}-${suffix}`;

  const [workspace] = await db.insert<{ id: string }>("workspaces", {
    name: `Integration ${label}`,
    slug,
    plan: "pro",
    app_name: "Testbed",
  });

  const [board] = await db.insert<{ id: string; public_id: string }>("boards", {
    workspace_id: workspace.id,
    public_id: `${TEST_BOARD_PUBLIC_ID}_${suffix}`.slice(0, 40),
    name: "Feature requests",
    slug: "feature-requests",
    identity_mode: "email",
    allowed_domains: [],
    categories: ["Feature", "Bug"],
  });

  const posts = await db.insert<{ id: string; number: number; title: string }>("posts", [
    {
      board_id: board.id,
      title: "Export entries to CSV and Markdown",
      body: "One file per entry with the date in the filename.",
      category: "Feature",
      status: "planned",
    },
    {
      board_id: board.id,
      title: "Dark mode for the editor",
      body: "Writing at night is painful.",
      category: "Feature",
      status: "under_review",
    },
  ]);

  return {
    workspaceId: workspace.id,
    boardId: board.id,
    publicId: board.public_id,
    posts,
  };
}

/** Deleting the workspace cascades to everything the fixture created. */
export async function destroyFixture(fixture: Fixture): Promise<void> {
  await db.remove(`workspaces?id=eq.${fixture.workspaceId}`);
}
