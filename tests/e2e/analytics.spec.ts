import type { Page } from "@playwright/test";
import { expect, test, type E2EFounder } from "./fixture";
import { SUPABASE_URL, db, dbHeaders } from "../integration/setup";

/**
 * Capture, in a real browser.
 *
 * Worth a browser test rather than a unit one because every part of this path
 * only exists in a browser: the tracker fires in a mount effect, the batch is
 * flushed on a timer or by `sendBeacon`, and the route reads the session from
 * cookies the browser attached itself. A unit test of `track()` would assert
 * that a queue has an item in it, which is not the thing that can be wrong.
 *
 * What can be wrong, and what this covers: a screen that never reports,
 * identity taken from the client instead of the session, and a path that
 * carries a query string into the table.
 *
 * Skips when `analytics_events` is not in the database. Migrations here are
 * applied by hand through the Supabase SQL editor, so a checkout ahead of its
 * migration is a normal state and not a red suite.
 */

async function tableExists(): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/analytics_events?select=id&limit=1`, {
    headers: dbHeaders,
  });
  return res.ok;
}

/**
 * Signed in, and *landed*.
 *
 * `signIn` resolves when the document it navigated to has loaded, which is
 * `/auth/hash` — and the session does not exist yet at that point. The token
 * arrives in a fragment the server never sees, so the browser calls
 * `setSession` and only then writes the cookies and navigates on. A `fetch`
 * issued before that lands at the route with no cookies at all, which is
 * exactly what the first version of these two tests did: the route answered
 * 204, correctly, and the test read it as a failure to record.
 *
 * Waiting on the dashboard heading is the same thing `dashboard.spec.ts`
 * does, and it is the cheapest proof the chain finished.
 */
async function signedIn(page: Page, founder: E2EFounder, next?: string): Promise<void> {
  await founder.signIn(page, next);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test.describe("captured events", () => {
  // Checked per test rather than once at module scope: Playwright transpiles
  // specs to CommonJS, where a top-level await is a syntax error.
  test.beforeEach(async () => {
    test.skip(
      !(await tableExists()),
      "analytics_events is not in the database — apply supabase/migrations/0032_analytics_events.sql",
    );
  });

  test("opening a screen records it against the founder, with no query string", async ({
    page,
    founder,
  }) => {
    // A query parameter on the way in, to prove the stored path drops it.
    await signedIn(page, founder, "/designer?from=e2e");

    // The client batches on a 1.5-second timer; give it that plus slack
    // rather than asserting against a race.
    await expect
      .poll(
        async () => {
          const rows = await db.select<{ id: number }>(
            `analytics_events?user_id=eq.${founder.userId}&name=eq.screen.designer&select=id&limit=1`,
          );
          return rows.length;
        },
        { timeout: 15_000, message: "the designer screen view never landed" },
      )
      .toBeGreaterThan(0);

    const [row] = await db.select<{
      name: string;
      path: string;
      user_id: string;
      session_id: string | null;
      source: string;
    }>(
      `analytics_events?user_id=eq.${founder.userId}&name=eq.screen.designer` +
        "&select=name,path,user_id,session_id,source&order=created_at.desc&limit=1",
    );

    expect(row.path).toBe("/designer");
    expect(row.source).toBe("dashboard");
    // A per-tab id, minted in sessionStorage by the client.
    expect(row.session_id).toBeTruthy();
  });

  test("the route takes identity from the session, not from the caller", async ({
    page,
    founder,
  }) => {
    await signedIn(page, founder);

    // Post as the signed-in founder, but claim to be somebody else entirely.
    // Every one of these fields must be ignored.
    const posted = await page.evaluate(async () => {
      const res = await fetch("/api/analytics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          events: [
            {
              name: "screen.themes",
              path: "/themes?token=secret",
              session: "e2e-identity",
              props: { who: "someone@example.com", nested: { a: 1 }, framework: "next" },
              user_id: "00000000-0000-0000-0000-000000000000",
              workspace_id: "00000000-0000-0000-0000-000000000000",
              created_at: "1999-01-01T00:00:00.000Z",
            },
          ],
        }),
      });
      // Status and text, not `.json()`: a 204 would otherwise surface as a
      // JSON syntax error, which says nothing about what the route decided.
      return { status: res.status, body: await res.text() };
    });

    expect(posted.status, posted.body).toBe(200);
    expect(JSON.parse(posted.body)).toEqual({ written: 1 });

    const [row] = await db.select<{
      user_id: string;
      path: string;
      props: Record<string, unknown>;
      created_at: string;
    }>(
      "analytics_events?session_id=eq.e2e-identity&select=user_id,path,props,created_at&limit=1",
    );

    // The session won: the row belongs to the founder who sent it.
    expect(row.user_id).toBe(founder.userId);
    // The query string was dropped, with the token in it.
    expect(row.path).toBe("/themes");
    // The address-shaped prop and the nested object were scrubbed; the
    // ordinary one survived.
    expect(row.props).toEqual({ framework: "next" });
    // The database stamped the time, so the client's 1999 was ignored.
    expect(new Date(row.created_at).getUTCFullYear()).toBeGreaterThan(2020);
  });

  test("an unknown event name is dropped without failing the batch", async ({ page, founder }) => {
    await signedIn(page, founder);

    const posted = await page.evaluate(async () => {
      const res = await fetch("/api/analytics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          events: [
            { name: "screen.nonsense", path: "/x", session: "e2e-unknown" },
            { name: "screen.insights", path: "/insights", session: "e2e-unknown" },
          ],
        }),
      });
      return { status: res.status, body: await res.text() };
    });

    // One of the two: a tab running a stale bundle must not lose the event
    // beside the one it got wrong.
    expect(posted.status, posted.body).toBe(200);
    expect(JSON.parse(posted.body)).toEqual({ written: 1 });

    const rows = await db.select<{ name: string }>(
      "analytics_events?session_id=eq.e2e-unknown&select=name",
    );
    expect(rows.map((r) => r.name)).toEqual(["screen.insights"]);
  });

  test("capture is closed to a visitor with no session", async ({ page }) => {
    // Somewhere on the origin, so the relative fetch below has one. /signup is
    // the one dashboard-adjacent page a visitor with no session may load.
    await page.goto("/signup");

    const status = await page.evaluate(async () => {
      const res = await fetch("/api/analytics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: [{ name: "screen.home", session: "e2e-anon" }] }),
      });
      return res.status;
    });

    // 204 rather than 401: nothing is written, and a session that expired in
    // an open tab should not produce an error in a founder's console.
    expect(status).toBe(204);
    expect(await db.select("analytics_events?session_id=eq.e2e-anon&select=id")).toHaveLength(0);
  });
});
