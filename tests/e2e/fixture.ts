import { test as base, type Page } from "@playwright/test";
import { APP_URL, SERVICE_KEY, SUPABASE_URL, db, dbHeaders } from "../integration/setup";

/**
 * Fixtures for the browser suite.
 *
 * The plumbing — `db`, `dbHeaders`, the env contract — is the integration
 * harness's, imported rather than copied so there is one answer to "which
 * database are the tests writing to". What is new here is two things a browser
 * needs and an HTTP client does not:
 *
 *   - posts that carry an embedding, so the duplicate nudge actually appears.
 *     Rows inserted straight into the table have a null `embedding`, and the
 *     semantic pass then finds nothing and wipes the keyword pass's result
 *     half a second after it lands. So the fixture's posts go in through
 *     `/api/public/post` like a visitor's would, which is also the only way
 *     they get an author vote and a real post number.
 *   - a signed-in founder, which means a real magic link and a real trip
 *     through `/auth/callback`.
 *
 * Both are worker-scoped: one workspace per run rather than per test. The
 * specs are written not to care what else has happened on the board — they
 * address posts by title and read counts before they change them — and a
 * fresh workspace per test would pay for an embedding round-trip each time.
 */

export interface E2EPost {
  id: string;
  number: number;
  title: string;
}

export interface E2EBoard {
  workspaceId: string;
  boardId: string;
  publicId: string;
  posts: E2EPost[];
  /** The post the duplicate-nudge specs type at. */
  exportPost: E2EPost;
}

export interface E2EFounder {
  email: string;
  userId: string;
  /**
   * Signs in by following a real magic link, which is the only way to exercise
   * the implicit-flow leg: the token arrives in a URL fragment, so
   * `/auth/callback` bounces to `/auth/hash`, the browser finishes the job and
   * `/auth/land` decides where the founder belongs. Links are single use, so
   * each call mints its own.
   */
  signIn(page: Page, next?: string): Promise<void>;
}

/** The two posts every board fixture starts with. */
const SEED_POSTS = [
  {
    title: "Export entries to CSV and Markdown",
    body: "One file per entry with the date in the filename.",
  },
  {
    title: "Dark mode for the editor",
    body: "Writing at night is painful.",
  },
];

function requireStack(): void {
  if (SUPABASE_URL && SERVICE_KEY) return;
  throw new Error(
    "The browser suite needs a database. Set TEST_SUPABASE_URL and " +
      "TEST_SERVICE_ROLE_KEY, or put NEXT_PUBLIC_SUPABASE_URL and " +
      "SUPABASE_SERVICE_ROLE_KEY in .env.local. Unlike the integration " +
      "suite this fails rather than skips: you ran it on purpose.",
  );
}

const authHeaders = () => dbHeaders;

async function createBoard(): Promise<E2EBoard> {
  const suffix = Math.random().toString(36).slice(2, 8);

  const [workspace] = await db.insert<{ id: string }>("workspaces", {
    name: `E2E ${suffix}`,
    slug: `e2e-${suffix}`,
    plan: "pro",
    app_name: "Driftnote",
    onboarded_at: new Date().toISOString(),
  });
  if (!workspace) throw new Error("could not create the e2e workspace");

  const [board] = await db.insert<{ id: string; public_id: string }>("boards", {
    workspace_id: workspace.id,
    public_id: `brd_e2e${suffix}`,
    name: "Feature requests",
    slug: "feature-requests",
    // Anonymous, so an end user can post, vote and comment without a mailbox.
    // The email-identity panel has its own spec.
    identity_mode: "anonymous",
    // Set rather than inherited: a spec must not start failing because a
    // schema default moved.
    anon_vote_limit: 5,
    allowed_domains: [],
    require_approval: false,
    categories: ["Feature", "Bug"],
  });
  if (!board) throw new Error("could not create the e2e board");

  const posts: E2EPost[] = [];
  for (const seed of SEED_POSTS) {
    // No cookie jar, so each post gets its own anonymous author. That keeps
    // the fixture clear of the five-posts-an-hour limit and leaves the
    // visitor the specs use completely fresh.
    const res = await fetch(`${APP_URL}/api/public/post`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP_URL },
      body: JSON.stringify({ board: board.public_id, ...seed, category: "Feature" }),
    });
    const json = (await res.json()) as { id?: string; number?: number; error?: string };
    if (!res.ok || !json.id || typeof json.number !== "number") {
      throw new Error(
        `seeding "${seed.title}" failed: ${res.status} ${json.error ?? JSON.stringify(json)}`,
      );
    }
    posts.push({ id: json.id, number: json.number, title: seed.title });
  }

  return {
    workspaceId: workspace.id,
    boardId: board.id,
    publicId: board.public_id,
    posts,
    exportPost: posts[0],
  };
}

/** Deleting the workspace cascades to the board, its posts and their votes. */
async function destroyBoard(board: E2EBoard): Promise<void> {
  await db.remove(`workspaces?id=eq.${board.workspaceId}`);
}

async function createFounder(workspaceId: string): Promise<E2EFounder> {
  const email = `e2e-${Math.random().toString(36).slice(2, 10)}@euclid.test`;

  const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      email,
      email_confirm: true,
      user_metadata: { full_name: "Maya Reyes" },
    }),
  });
  const user = (await created.json()) as { id?: string; msg?: string };
  if (!user.id) throw new Error(`could not create the e2e user: ${JSON.stringify(user)}`);

  const member = await fetch(`${SUPABASE_URL}/rest/v1/workspace_members`, {
    method: "POST",
    headers: { ...authHeaders(), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      workspace_id: workspaceId,
      user_id: user.id,
      role: "owner",
      name: "Maya Reyes",
    }),
  });
  if (!member.ok) {
    throw new Error(`could not attach the e2e user to the workspace: ${await member.text()}`);
  }

  return {
    email,
    userId: user.id,
    async signIn(page: Page, next?: string) {
      const redirectTo = `${APP_URL}/auth/callback${
        next ? `?next=${encodeURIComponent(next)}` : ""
      }`;

      // `redirect_to` goes at the top level. Nesting it under `options` is the
      // supabase-js convention, not the REST one, and GoTrue drops the unknown
      // key silently — see scripts/make-session.mjs, where the same mistake
      // cost an afternoon.
      const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ type: "magiclink", email, redirect_to: redirectTo }),
      });
      const link = (await res.json()) as {
        action_link?: string;
        properties?: { action_link?: string };
        msg?: string;
      };
      const action = link.properties?.action_link ?? link.action_link;
      if (!action) throw new Error(`generate_link failed: ${JSON.stringify(link)}`);

      // A redirect_to that is not allow-listed is not refused — GoTrue
      // substitutes the project's Site URL and the sign-in lands somewhere
      // else entirely, with no error anywhere. Catch it here, where the
      // message can say what to fix, rather than as a timeout on the
      // dashboard assertion.
      const landing = new URL(action).searchParams.get("redirect_to");
      if (landing && new URL(landing).origin !== new URL(APP_URL).origin) {
        throw new Error(
          `the auth server redirected to ${landing} instead of ${redirectTo}. ` +
            `Add ${new URL(APP_URL).origin} to the project's redirect allow-list ` +
            "(supabase/config.toml for the local stack, Authentication → URL " +
            "Configuration for a hosted one).",
        );
      }

      await page.goto(action);
    },
  };
}

async function destroyFounder(founder: E2EFounder): Promise<void> {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${founder.userId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
}

/** No test-scoped fixtures: both of these are worker-scoped. */
type NoTestFixtures = object;

export const test = base.extend<
  NoTestFixtures,
  { board: E2EBoard; founder: E2EFounder }
>({
  board: [
    async ({}, use) => {
      requireStack();
      // The integration harness prints its target for the same reason: nobody
      // should discover afterwards that the rows went to production.
      console.info(`  e2e target: ${APP_URL} against ${new URL(SUPABASE_URL).host}`);
      const board = await createBoard();
      await use(board);
      await destroyBoard(board);
    },
    { scope: "worker" },
  ],

  founder: [
    async ({ board }, use) => {
      const founder = await createFounder(board.workspaceId);
      await use(founder);
      // The workspace teardown cannot reach an auth user, so this one is
      // deleted by hand. Without it a run against a hosted project leaves a
      // user behind every time.
      await destroyFounder(founder);
    },
    { scope: "worker" },
  ],
});

export { expect } from "@playwright/test";
