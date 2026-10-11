import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createFixture,
  createVisitor,
  db,
  destroyFixture,
  stackIsUp,
  type Fixture,
} from "./setup";

/**
 * The public API is the only surface an end user touches. Every test here
 * goes through HTTP with real cookies, because the interesting failures are
 * in the seams: does a vote actually move the count, does an anonymous
 * visitor get capped, does a held post stay hidden.
 */

const up = await stackIsUp();
const suite = up ? describe : describe.skip;

if (!up) {
  console.warn(
    "\n  Integration tests skipped: no app at TEST_APP_URL or no database reachable.\n" +
      "  Start `supabase start` and `npm run dev`, or run them in CI.\n",
  );
}

suite("public board API", () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFixture("api");
  });

  afterAll(async () => {
    if (fixture) await destroyFixture(fixture);
  });

  describe("GET /api/public/board", () => {
    it("returns the board, its design and its posts", async () => {
      const visitor = createVisitor();
      const { status, body } = await visitor.call<{
        board: { publicId: string; design: { heading: string } };
        posts: { number: number; title: string }[];
        viewer: { kind: string };
      }>(`/api/public/board?board=${fixture.publicId}`);

      expect(status).toBe(200);
      expect(body.board.publicId).toBe(fixture.publicId);
      expect(body.board.design.heading).toBeTruthy();
      expect(body.posts.map((p) => p.title)).toContain("Export entries to CSV and Markdown");
    });

    it("404s for a board that does not exist", async () => {
      const { status } = await createVisitor().call("/api/public/board?board=brd_nope");

      expect(status).toBe(404);
    });

    it("400s when no board is named", async () => {
      const { status } = await createVisitor().call("/api/public/board");

      expect(status).toBe(400);
    });

    it("refuses a domain that is not on the allow-list", async () => {
      await db.patch(`boards?id=eq.${fixture.boardId}`, {
        allowed_domains: ["driftnote.app"],
      });

      const stranger = createVisitor("https://someone-elses-site.example");
      const { status } = await stranger.call(`/api/public/board?board=${fixture.publicId}`);

      expect(status).toBe(403);

      await db.patch(`boards?id=eq.${fixture.boardId}`, { allowed_domains: [] });
    });
  });

  describe("POST /api/public/vote", () => {
    it("adds a vote, then removes it when toggled again", async () => {
      const visitor = createVisitor();
      const post = fixture.posts[0];

      const before = await db.select<{ vote_count: number }>(
        `posts?select=vote_count&id=eq.${post.id}`,
      );
      const start = before[0].vote_count;

      const on = await visitor.call<{ voted: boolean; votes: number }>("/api/public/vote", {
        method: "POST",
        body: JSON.stringify({ board: fixture.publicId, postId: post.id }),
      });

      expect(on.status).toBe(200);
      expect(on.body.voted).toBe(true);
      expect(on.body.votes).toBe(start + 1);

      const off = await visitor.call<{ voted: boolean; votes: number }>("/api/public/vote", {
        method: "POST",
        body: JSON.stringify({ board: fixture.publicId, postId: post.id }),
      });

      expect(off.body.voted).toBe(false);
      expect(off.body.votes).toBe(start);
    });

    it("counts two different visitors separately", async () => {
      const post = fixture.posts[1];
      const a = createVisitor();
      const b = createVisitor();

      const first = await a.call<{ votes: number }>("/api/public/vote", {
        method: "POST",
        body: JSON.stringify({ board: fixture.publicId, postId: post.id }),
      });
      const second = await b.call<{ votes: number }>("/api/public/vote", {
        method: "POST",
        body: JSON.stringify({ board: fixture.publicId, postId: post.id }),
      });

      expect(second.body.votes).toBe(first.body.votes + 1);
    });

    it("rejects a post id that is not a uuid", async () => {
      const { status } = await createVisitor().call("/api/public/vote", {
        method: "POST",
        body: JSON.stringify({ board: fixture.publicId, postId: "not-a-uuid" }),
      });

      expect(status).toBe(400);
    });

    it("refuses to vote on a post from another board", async () => {
      const other = await createFixture("other");
      try {
        const { status } = await createVisitor().call("/api/public/vote", {
          method: "POST",
          body: JSON.stringify({ board: fixture.publicId, postId: other.posts[0].id }),
        });

        expect(status).toBe(404);
      } finally {
        await destroyFixture(other);
      }
    });
  });

  describe("POST /api/public/post", () => {
    it("creates a post and gives it the next number on the board", async () => {
      const visitor = createVisitor();
      const { status, body } = await visitor.call<{ number: number; id: string; held: boolean }>(
        "/api/public/post",
        {
          method: "POST",
          body: JSON.stringify({
            board: fixture.publicId,
            title: "Let me filter entries by tag",
            body: "Tags exist but I cannot filter by them.",
          }),
        },
      );

      expect(status).toBe(200);
      expect(body.held).toBe(false);
      expect(body.number).toBeGreaterThan(0);

      const rows = await db.select<{ title: string; vote_count: number }>(
        `posts?select=title,vote_count&id=eq.${body.id}`,
      );
      expect(rows[0].title).toBe("Let me filter entries by tag");
      // The author's own vote, so a new post never shows zero.
      expect(rows[0].vote_count).toBe(1);
    });

    it("rejects a title that is too short to mean anything", async () => {
      const { status } = await createVisitor().call("/api/public/post", {
        method: "POST",
        body: JSON.stringify({ board: fixture.publicId, title: "a" }),
      });

      expect(status).toBe(400);
    });

    it("silently rejects a submission that filled the honeypot", async () => {
      // Invisible to people, irresistible to bots.
      const { status } = await createVisitor().call("/api/public/post", {
        method: "POST",
        body: JSON.stringify({
          board: fixture.publicId,
          title: "Totally legitimate suggestion",
          website: "https://spam.example",
        }),
      });

      expect(status).toBe(400);
    });

    it("holds a post for approval when the board asks for it", async () => {
      await db.patch(`boards?id=eq.${fixture.boardId}`, { require_approval: true });
      try {
        const visitor = createVisitor();
        const created = await visitor.call<{ held: boolean; number: number }>(
          "/api/public/post",
          {
            method: "POST",
            body: JSON.stringify({
              board: fixture.publicId,
              title: "A post awaiting moderation",
            }),
          },
        );

        expect(created.body.held).toBe(true);

        // And it must not appear publicly before the founder approves it.
        const listed = await visitor.call<{ posts: { number: number }[] }>(
          `/api/public/board?board=${fixture.publicId}`,
        );
        expect(listed.body.posts.some((p) => p.number === created.body.number)).toBe(false);
      } finally {
        await db.patch(`boards?id=eq.${fixture.boardId}`, { require_approval: false });
      }
    });
  });

  describe("POST /api/public/comment", () => {
    it("adds a comment and bumps the post's comment count", async () => {
      const post = fixture.posts[0];
      const visitor = createVisitor();

      const { status } = await visitor.call("/api/public/comment", {
        method: "POST",
        body: JSON.stringify({
          board: fixture.publicId,
          postId: post.id,
          body: "Agreed, with the date in the filename please.",
        }),
      });

      expect(status).toBe(200);

      const rows = await db.select<{ comment_count: number }>(
        `posts?select=comment_count&id=eq.${post.id}`,
      );
      expect(rows[0].comment_count).toBeGreaterThan(0);
    });

    it("rejects an empty comment", async () => {
      const { status } = await createVisitor().call("/api/public/comment", {
        method: "POST",
        body: JSON.stringify({
          board: fixture.publicId,
          postId: fixture.posts[0].id,
          body: "",
        }),
      });

      expect(status).toBe(400);
    });
  });

  describe("GET /api/public/similar", () => {
    it("suggests an existing post rather than letting a duplicate through", async () => {
      const { status, body } = await createVisitor().call<{ posts: { title: string }[] }>(
        `/api/public/similar?board=${fixture.publicId}&title=${encodeURIComponent(
          "export my entries to markdown",
        )}&mode=fast`,
      );

      expect(status).toBe(200);
      expect(body.posts.length).toBeGreaterThan(0);
      expect(body.posts.map((p) => p.title)).toContain("Export entries to CSV and Markdown");
    });

    it("suggests nothing for a title too short to judge", async () => {
      const { body } = await createVisitor().call<{ posts: unknown[] }>(
        `/api/public/similar?board=${fixture.publicId}&title=ab`,
      );

      expect(body.posts).toEqual([]);
    });
  });
});

suite("job endpoints", () => {
  it("refuse a request with no credentials", async () => {
    const res = await fetch(`${process.env.TEST_APP_URL ?? "http://localhost:3000"}/api/jobs/run`, {
      method: "POST",
    });

    // Never 200. An unset secret disables the endpoint rather than opening it.
    expect([401, 503]).toContain(res.status);
  });

  it("refuse a wrong token", async () => {
    const res = await fetch(`${process.env.TEST_APP_URL ?? "http://localhost:3000"}/api/jobs/run`, {
      method: "POST",
      headers: { authorization: "Bearer definitely-not-the-secret" },
    });

    expect([401, 503]).toContain(res.status);
  });
});
