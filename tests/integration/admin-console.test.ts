import { describe, expect, it } from "vitest";
import { SERVICE_KEY, SUPABASE_URL, dbHeaders } from "./setup";
import {
  ROW_CAP,
  authUsers,
  estate,
  failedSlices,
  missingSlices,
  truncatedSlices,
} from "@/server/admin-data";
import {
  addressBook,
  boardViews,
  buildIndex,
  deriveEvents,
  funnel,
  funnelRows,
  people,
  retentionGrid,
  revenue,
  visitors,
  workspaceViews,
} from "@/server/admin-model";

/**
 * The operator console against a real database.
 *
 * Read-only — it creates nothing and deletes nothing, which is why it can
 * point at the production project without a fixture. Its whole job is the
 * class of fault a unit test cannot see, because the derivations are pure and
 * their inputs are not: a renamed column, a dropped table, a server-side row
 * cap.
 *
 * The cap is the reason this file exists. `admin-data.ts` originally read each
 * table with `.limit(ROW_CAP)`, and PostgREST returned 1 000 of the 1 085
 * rows in `votes` regardless — its own `db-max-rows` is applied after the
 * limit. Every total on the console was quietly 85 short, and the `truncated`
 * flag said nothing because 1 000 is not 20 000. The assertion below is the
 * one that would have caught it: what the console read must equal what the
 * database counts.
 */

const configured = Boolean(SUPABASE_URL && SERVICE_KEY);
const suite = configured ? describe : describe.skip;

/** The exact count, straight from PostgREST, with no client in between. */
async function countOf(table: string): Promise<number> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, {
    headers: { ...dbHeaders, prefer: "count=exact" },
  });
  // "0-0/1085" — the total is the part after the slash.
  const range = res.headers.get("content-range") ?? "";
  return Number(range.split("/")[1] ?? 0);
}

suite("the operator console", () => {
  it("reads every table it needs", async () => {
    const data = await estate();

    // A renamed or dropped column shows up here as a message rather than as
    // a zero on the screen.
    expect(failedSlices(data)).toEqual([]);

    const users = await authUsers();
    expect(users.error).toBeNull();
  });

  it("reads whole tables, not the first page of them", async () => {
    const data = await estate();

    for (const table of ["votes", "posts", "end_users", "email_outbox"] as const) {
      const slice =
        table === "votes"
          ? data.votes
          : table === "posts"
            ? data.posts
            : table === "end_users"
              ? data.endUsers
              : data.outbox;

      const total = await countOf(table);
      if (total > ROW_CAP) {
        // Past our own cap the slice is allowed to be short, but it must say so.
        expect(slice.truncated).toBe(true);
        continue;
      }
      expect(slice.rows.length).toBe(total);
      expect(slice.truncated).toBe(false);
    }
  });

  it("derives every panel without throwing", async () => {
    const data = await estate();
    const users = await authUsers();
    const index = buildIndex(data, users.rows);
    const events = deriveEvents(data, index);
    const now = new Date();

    // Each of these is one tab of the console. A derivation that throws on
    // real-world nulls — a board with no workspace, a vote by a deleted
    // visitor — takes its whole page down, and only real data has those.
    expect(events.length).toBeGreaterThanOrEqual(data.workspaces.rows.length);
    expect(events.every((e) => typeof e.at === "string" && e.actor.label.length > 0)).toBe(true);

    const steps = funnel(funnelRows(data, index));
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].count).toBeLessThanOrEqual(steps[i - 1].count);
    }
    expect(steps[0].count).toBe(data.workspaces.rows.length);

    expect(revenue(data.workspaces.rows).mrrCents).toBeGreaterThanOrEqual(0);
    expect(addressBook(data, users.rows).total).toBeGreaterThanOrEqual(0);
    expect(people(data, users.rows, events, index, () => false)).toHaveLength(users.rows.length);
    expect(workspaceViews(data, events, index)).toHaveLength(data.workspaces.rows.length);
    expect(boardViews(data, index)).toHaveLength(data.boards.rows.length);
    expect(visitors(data, index)).toHaveLength(data.endUsers.rows.length);
    expect(retentionGrid(data.workspaces.rows, events, 6, now).length).toBeGreaterThanOrEqual(0);
  });

  it("attributes votes and posts to the visitor who made them", async () => {
    const data = await estate();
    const index = buildIndex(data, (await authUsers()).rows);
    const rows = visitors(data, index);

    // Every vote belongs to exactly one visitor, so the two must agree. When
    // they did not, the cause was a short read rather than bad arithmetic.
    expect(rows.reduce((n, v) => n + v.votes, 0)).toBe(data.votes.rows.length);
    expect(rows.reduce((n, v) => n + v.posts, 0)).toBe(
      data.posts.rows.filter((p) => p.author_id).length,
    );
  });

  it("treats a table that is not migrated yet as pending, not as a failure", async () => {
    /*
      Migrations here are applied by hand through the Supabase SQL editor, so
      a deploy ahead of its migration is a normal state for a few minutes.
      `analytics_events` arrived in 0032 and is the first table to exercise
      this: it must read as empty-and-pending rather than as an error, because
      an alarm for something the operator is about to do themselves trains
      them to ignore alarms.
    */
    const data = await estate();
    expect(data.captured.error).toBeNull();

    if (missingSlices(data).includes("captured")) {
      expect(data.captured.rows).toEqual([]);
      expect(data.captured.missing).toBe(true);
    } else {
      expect(data.captured.missing).toBe(false);
    }
  });

  it("says so when a slice came back short", async () => {
    const data = await estate();
    // Nothing should be truncated at today's volume. If this starts failing,
    // the fix is an aggregate in the database, not a bigger ROW_CAP.
    expect(truncatedSlices(data)).toEqual([]);
  });
});
