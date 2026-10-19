import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";

/**
 * Every rate limit Euclid applies, in one module.
 *
 * Two of them, because there are two kinds of caller and they authorise
 * differently. `withinLimit` is keyed on a workspace and runs on the founder's
 * session, so it goes through `check_workspace_rate_limit` — a definer whose
 * `is_member` check is the authorisation. `boardLimit` is keyed on a board and
 * runs with the service role, for callers who have no session at all: the
 * public widget API and the MCP endpoint's API keys. See 0023_rate_limits.sql
 * for why those are two SQL functions rather than one with a nullable column.
 */

/**
 * What a bucket costs. Named rather than passed as numbers at the call site,
 * so the ceilings are in one place and can be read against each other.
 *
 * These are not the budget — the monthly allowance in `plans.ts` is. They are
 * a ceiling on how fast a budget can be spent, which is a different job: the
 * allowance says how much an AI path may cost over a month, and this says that
 * twenty requests fired at once cannot all get through the check before any of
 * them has been counted. `spend_allowance` made the counting correct;
 * this bounds how far past the line a stampede can reach.
 *
 * Ten a minute is far above what anyone generating a Build Prompt and reading
 * it can do, and far below what a script can. The number only has to separate
 * those two.
 */
export const LIMITS = {
  prompt: { max: 10, window: "1 minute", failOpen: false },
  ask: { max: 10, window: "1 minute", failOpen: false },
  /*
    The billing routes: checkout, top-up and the customer portal, sharing one
    bucket because they are one resource — each is a call to Polar's API with
    our organisation token, and what is being protected is that token's
    standing with Polar rather than anything of ours.

    `failOpen` is the difference that matters. The AI buckets fail closed
    because a limiter that is down must not hand out unmetered model calls.
    This one fails open because the worst case on the other side is a few
    redundant checkout sessions, and the cost of being wrong is refusing to
    let someone pay us — which is a far worse trade than the one it guards.
  */
  billing: { max: 10, window: "1 minute", failOpen: true },
} as const;

export type LimitBucket = keyof typeof LIMITS;

/**
 * Whether this workspace may do one more of `bucket` right now.
 *
 * `actor` is the user rather than the workspace, so one founder hammering a
 * tab does not lock out the teammate sitting next to them.
 *
 * Whether a failure to check blocks or allows is the bucket's own decision —
 * see `failOpen` on each. There is no answer that is right for all of them:
 * an outage that lets model calls through costs money, and one that blocks
 * checkouts costs revenue.
 */
export async function withinLimit(
  workspaceId: string,
  bucket: LimitBucket,
  actor: string,
): Promise<boolean> {
  const { max, window, failOpen } = LIMITS[bucket];
  const db = await supabaseServer();

  const { data, error } = await db.rpc("check_workspace_rate_limit", {
    p_workspace: workspaceId,
    p_bucket: bucket,
    p_actor: actor,
    p_max: max,
    p_window: window,
  });

  if (error) {
    console.error(`[limits] ${bucket} check failed for ${workspaceId}: ${error.message}`);
    return failOpen;
  }
  return data === true;
}

/**
 * The board-scoped limiter, for callers with no founder session: the public
 * widget API, and the MCP endpoint's API keys.
 *
 * Lives here next to the workspace one so there is a single place that knows
 * how Euclid rate limits anything. It was previously a private helper inside
 * `public-board.ts`, which was fine until a second caller needed it.
 *
 * Fails **open**, always. Every caller is either an end user trying to leave
 * feedback or an agent reading a board, and a limiter that is down must not
 * take the product offline. Nothing expensive sits behind this one; the
 * buckets that guard money are the workspace-scoped ones above.
 */
export async function boardLimit(
  boardId: string,
  bucket: string,
  actor: string,
  max: number,
  window: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin().rpc("check_rate_limit", {
    p_board: boardId,
    p_bucket: bucket,
    p_actor: actor,
    p_max: max,
    p_window: window,
  });
  if (error) return true;
  return data !== false;
}

/** What to tell someone who hit one. Deliberately vague about the ceiling. */
export const RATE_LIMITED = "That is a lot of requests at once. Wait a moment and try again.";
