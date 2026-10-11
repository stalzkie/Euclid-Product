import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixture, db, destroyFixture, stackIsUp, type Fixture } from "./setup";

/**
 * Custom domain routing, driven by the Host header against the running app.
 *
 * The property that matters is not "the board renders" — it is that a
 * hostname nobody has proved they own gets nothing, and that the dashboard
 * can never be reached on a customer's domain however the path is written.
 */

const APP = process.env.TEST_APP_URL ?? "http://localhost:3000";
const DOMAIN = "feedback.itest-euclid.example";

const up = await stackIsUp();
const suite = up ? describe : describe.skip;

let fixture: Fixture;

/**
 * Request the app as if it arrived on the custom domain. fetch refuses to
 * set a Host header, so this uses x-forwarded-host — which is also what a
 * real proxy in front of the app sends.
 */
function asHost(host: string, path = "/") {
  return fetch(`${APP}${path}`, {
    headers: { "x-forwarded-host": host },
    redirect: "manual",
  });
}

suite("custom domain", () => {
  beforeAll(async () => {
    fixture = await createFixture("domain");
  });

  afterAll(async () => {
    if (fixture) await destroyFixture(fixture);
  });

  it("serves the board once the domain is verified", async () => {
    await db.patch(`boards?id=eq.${fixture.boardId}`, {
      custom_domain: DOMAIN,
      custom_domain_token: "itest-token",
      custom_domain_verified_at: new Date().toISOString(),
    });

    try {
      const response = await asHost(DOMAIN);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain(fixture.posts[0].title);
    } finally {
      await db.patch(`boards?id=eq.${fixture.boardId}`, {
        custom_domain: null,
        custom_domain_token: null,
        custom_domain_verified_at: null,
      });
    }
  });

  it("serves nothing for a domain that is claimed but not verified", async () => {
    // Claiming is not owning. Anyone can point DNS at us.
    await db.patch(`boards?id=eq.${fixture.boardId}`, {
      custom_domain: DOMAIN,
      custom_domain_token: "itest-token",
      custom_domain_verified_at: null,
    });

    try {
      expect((await asHost(DOMAIN)).status).toBe(404);
    } finally {
      await db.patch(`boards?id=eq.${fixture.boardId}`, {
        custom_domain: null,
        custom_domain_token: null,
        custom_domain_verified_at: null,
      });
    }
  });

  it("serves nothing for a hostname no board has claimed", async () => {
    expect((await asHost("nobody.itest-euclid.example")).status).toBe(404);
  });

  it.each(["/feedback", "/install", "/billing", "/prompts", "/onboarding/app"])(
    "never serves the dashboard path %s on a customer domain",
    async (path) => {
      await db.patch(`boards?id=eq.${fixture.boardId}`, {
        custom_domain: DOMAIN,
        custom_domain_token: "itest-token",
        custom_domain_verified_at: new Date().toISOString(),
      });

      try {
        const response = await asHost(DOMAIN, path);
        expect(response.status).toBe(404);
        // Not a redirect to sign-in either: the dashboard should not exist
        // on this hostname at all.
        expect(response.headers.get("location")).toBeNull();
      } finally {
        await db.patch(`boards?id=eq.${fixture.boardId}`, {
          custom_domain: null,
          custom_domain_token: null,
          custom_domain_verified_at: null,
        });
      }
    },
  );

  it("refuses to let two boards hold the same domain", async () => {
    const other = await createFixture("domain-rival");

    await db.patch(`boards?id=eq.${fixture.boardId}`, {
      custom_domain: DOMAIN,
      custom_domain_verified_at: new Date().toISOString(),
    });

    try {
      // The unique index is what stops a second board taking a verified
      // hostname, so it is checked here rather than trusted.
      const response = await fetch(
        `${process.env.TEST_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/boards?id=eq.${other.boardId}`,
        {
          method: "PATCH",
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
            authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ custom_domain: DOMAIN }),
        },
      );

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await response.text()).toContain("duplicate key");
    } finally {
      await db.patch(`boards?id=eq.${fixture.boardId}`, {
        custom_domain: null,
        custom_domain_verified_at: null,
      });
      await destroyFixture(other);
    }
  });

  it("still serves the dashboard on the app's own host", async () => {
    // The guard must not be so eager that it breaks the product.
    const response = await fetch(`${APP}/feedback`, { redirect: "manual" });
    expect([200, 307, 302]).toContain(response.status);
    expect(response.status).not.toBe(404);
  });
});
