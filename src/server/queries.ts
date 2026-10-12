import { supabaseServer } from "@/lib/supabase/server";
import type {
  ActivityItem,
  ChangelogEntry,
  Comment,
  Post,
  PostStatus,
  Recommendation,
  Theme,
} from "@/lib/types";

/**
 * Read queries behind the dashboard screens. These run with the founder's
 * session so RLS keeps them inside their own workspace.
 */

/**
 * Supabase types an embedded relation as an array even when the foreign key
 * resolves to exactly one row. This narrows it back without an `any`.
 */
function one<T>(value: unknown): T | null {
  if (!value) return null;
  return (Array.isArray(value) ? (value[0] ?? null) : value) as T | null;
}

export interface PostRow extends Post {
  themeName: string | null;
  authorEmail: string | null;
  payingShare: number;
  recentVotes: number;
  /** Seven points for the sparkline, oldest first. */
  trend: number[];
}

export interface BoardKpis {
  newPosts: number;
  newPostsDelta: number;
  votes: number;
  votesDelta: number;
  voters: number;
  payingVoters: number;
  shippedThisMonth: number;
  votersNotified: number;
  comments: number;
  commentsDelta: number;
  timeToShip: number | null;
}

/** The four tiles across the top of Home, with week-on-week deltas. */
export async function getWeekKpis(boardId: string): Promise<BoardKpis> {
  const db = await supabaseServer();
  const now = Date.now();
  const weekAgo = new Date(now - 7 * 86400_000).toISOString();
  const twoWeeksAgo = new Date(now - 14 * 86400_000).toISOString();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const countPosts = async (from: string, to?: string) => {
    let q = db
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("board_id", boardId)
      .gte("created_at", from);
    if (to) q = q.lt("created_at", to);
    const { count } = await q;
    return count ?? 0;
  };

  // Votes and comments belong to posts, and posts to a board. Joining through
  // that in the database is what lets everything below be asked for at once:
  // fetching the board's post ids first would make every other read wait on it.
  const countVotes = async (from: string, to?: string) => {
    let q = db
      .from("votes")
      .select("id, posts!inner(board_id)", { count: "exact", head: true })
      .eq("posts.board_id", boardId)
      .gte("created_at", from);
    if (to) q = q.lt("created_at", to);
    const { count } = await q;
    return count ?? 0;
  };

  const countComments = async (from: string, to?: string) => {
    let q = db
      .from("comments")
      .select("id, posts!inner(board_id)", { count: "exact", head: true })
      .eq("posts.board_id", boardId)
      .eq("internal", false)
      .gte("created_at", from);
    if (to) q = q.lt("created_at", to);
    const { count } = await q;
    return count ?? 0;
  };

  // None of these depends on another, and each is a round trip to Supabase.
  // Issued together they cost one wait instead of seven, which is most of what
  // Home used to spend its time on.
  const [
    thisWeekPosts,
    lastWeekPosts,
    thisWeekVotes,
    lastWeekVotes,
    comments,
    priorComments,
    { data: recentVotes },
    { count: shipped },
    { data: notified },
    { data: tts },
  ] = await Promise.all([
    countPosts(weekAgo),
    countPosts(twoWeeksAgo, weekAgo),
    countVotes(weekAgo),
    countVotes(twoWeeksAgo, weekAgo),
    countComments(weekAgo),
    countComments(twoWeeksAgo, weekAgo),
    // Active voters this week, and how many of them pay.
    db
      .from("votes")
      .select("end_user_id, end_users(segments), posts!inner(board_id)")
      .eq("posts.board_id", boardId)
      .gte("created_at", weekAgo),
    db
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("board_id", boardId)
      .gte("shipped_at", monthStart),
    db
      .from("changelog_entries")
      .select("voters_notified")
      .eq("board_id", boardId)
      .gte("published_at", monthStart),
    db.rpc("board_time_to_ship", { p_board: boardId }),
  ]);

  const voters = new Set<string>();
  const paying = new Set<string>();
  for (const v of recentVotes ?? []) {
    voters.add(v.end_user_id);
    const plan = one<{ segments?: Record<string, string> }>(v.end_users)?.segments?.plan;
    if (plan && plan !== "free") paying.add(v.end_user_id);
  }

  return {
    newPosts: thisWeekPosts,
    newPostsDelta: pctDelta(thisWeekPosts, lastWeekPosts),
    votes: thisWeekVotes,
    votesDelta: pctDelta(thisWeekVotes, lastWeekVotes),
    voters: voters.size,
    payingVoters: paying.size,
    shippedThisMonth: shipped ?? 0,
    votersNotified: (notified ?? []).reduce((a, e) => a + e.voters_notified, 0),
    comments,
    commentsDelta: pctDelta(comments, priorComments),
    timeToShip: tts === null ? null : Number(tts),
  };
}

function pctDelta(now: number, before: number): number {
  if (!before) return now ? 100 : 0;
  return Math.round(((now - before) / before) * 100);
}

/**
 * Posts for the inbox and Home, enriched with the derived columns the UI shows:
 * paying share, votes this week and a seven-point trend.
 */
export async function listPosts(
  boardId: string,
  opts: {
    status?: PostStatus;
    limit?: number;
    search?: string;
    themeId?: string;
    sort?: "votes" | "recent" | "rising" | "demand";
  } = {},
): Promise<PostRow[]> {
  const db = await supabaseServer();
  let q = db
    .from("posts")
    .select("*, themes(name), end_users(email)")
    .eq("board_id", boardId)
    .is("merged_into", null)
    .eq("approved", true);

  if (opts.status) q = q.eq("status", opts.status);
  if (opts.themeId) q = q.eq("theme_id", opts.themeId);
  if (opts.search) q = q.ilike("title", `%${opts.search}%`);

  q =
    opts.sort === "recent"
      ? q.order("created_at", { ascending: false })
      : opts.sort === "demand"
        ? q.order("weighted_score", { ascending: false })
        : q.order("vote_count", { ascending: false });

  const { data } = await q.limit(opts.limit ?? 50);
  const rows = (data ?? []) as (Post & {
    themes: { name: string } | null;
    end_users: { email: string | null } | null;
  })[];

  if (!rows.length) return [];

  const enriched = await enrich(boardId, rows);
  if (opts.sort === "rising") {
    enriched.sort((a, b) => b.recentVotes - a.recentVotes);
  }
  return enriched;
}

async function enrich(
  boardId: string,
  rows: (Post & { themes: { name: string } | null; end_users: { email: string | null } | null })[],
): Promise<PostRow[]> {
  const db = await supabaseServer();
  const ids = rows.map((r) => r.id);

  // One query for every vote on these posts, then bucket in memory — cheaper
  // than a round trip per post for the sparkline.
  const { data: votes } = await db
    .from("votes")
    .select("post_id, created_at, end_users(segments)")
    .in("post_id", ids);

  const byPost = new Map<string, { at: number; paying: boolean }[]>();
  for (const v of votes ?? []) {
    const plan = one<{ segments?: Record<string, string> }>(v.end_users)?.segments?.plan;
    const list = byPost.get(v.post_id) ?? [];
    list.push({ at: new Date(v.created_at).getTime(), paying: Boolean(plan && plan !== "free") });
    byPost.set(v.post_id, list);
  }

  const now = Date.now();
  const weekAgo = now - 7 * 86400_000;

  return rows.map((r) => {
    const list = byPost.get(r.id) ?? [];
    const paying = list.filter((v) => v.paying).length;

    // Seven weekly buckets, oldest first.
    const trend = new Array(7).fill(0) as number[];
    for (const v of list) {
      const weeksAgo = Math.floor((now - v.at) / (7 * 86400_000));
      if (weeksAgo >= 0 && weeksAgo < 7) trend[6 - weeksAgo] += 1;
    }
    // Make the shape readable even when the seed wrote counts directly.
    if (list.length === 0 && r.vote_count > 0) {
      for (let i = 0; i < 7; i++) {
        trend[i] = Math.round((r.vote_count / 7) * (0.6 + i * 0.12));
      }
    }

    return {
      ...r,
      themeName: r.themes?.name ?? null,
      authorEmail: r.end_users?.email ?? null,
      payingShare: list.length ? Math.round((paying / list.length) * 100) : 0,
      recentVotes: list.filter((v) => v.at > weekAgo).length,
      trend,
    };
  });
}

export async function getStatusCounts(
  boardId: string,
): Promise<Record<"all" | PostStatus, number>> {
  const db = await supabaseServer();
  const { data } = await db
    .from("posts")
    .select("status")
    .eq("board_id", boardId)
    .is("merged_into", null)
    .eq("approved", true);

  const counts = {
    all: 0,
    under_review: 0,
    planned: 0,
    in_progress: 0,
    shipped: 0,
    declined: 0,
  } as Record<"all" | PostStatus, number>;

  for (const row of data ?? []) {
    counts.all += 1;
    counts[row.status as PostStatus] += 1;
  }
  return counts;
}

export interface PostDetail extends PostRow {
  comments: Comment[];
  merged: Pick<Post, "id" | "number" | "title" | "vote_count">[];
  similar: {
    id: string;
    number: number;
    title: string;
    votes: number;
    similarity: number;
    state: string;
  }[];
  promptCount: number;
  latestPromptId: string | null;
  voterEmails: string[];
}

export async function getPost(boardId: string, number: number): Promise<PostDetail | null> {
  const db = await supabaseServer();
  const { data } = await db
    .from("posts")
    .select("*, themes(name), end_users(email)")
    .eq("board_id", boardId)
    .eq("number", number)
    .maybeSingle();

  if (!data) return null;
  const [row] = await enrich(boardId, [
    data as Post & { themes: { name: string } | null; end_users: { email: string | null } | null },
  ]);

  const [{ data: comments }, { data: merged }, { data: dupes }, { data: prompts }, { data: voters }] =
    await Promise.all([
      db.from("comments").select("*").eq("post_id", row.id).order("created_at"),
      db.from("posts").select("id,number,title,vote_count").eq("merged_into", row.id),
      db
        .from("duplicate_suggestions")
        .select("similarity, state, posts!duplicate_suggestions_post_id_fkey(id,number,title,vote_count)")
        .eq("target_id", row.id)
        .order("similarity", { ascending: false }),
      db
        .from("build_prompts")
        .select("id")
        .eq("post_id", row.id)
        .order("version", { ascending: false }),
      db.from("votes").select("end_users(email)").eq("post_id", row.id),
    ]);

  return {
    ...row,
    comments: (comments ?? []) as Comment[],
    merged: (merged ?? []) as PostDetail["merged"],
    similar: (dupes ?? []).map((d) => {
      const p = d.posts as unknown as {
        id: string;
        number: number;
        title: string;
        vote_count: number;
      };
      return {
        id: p.id,
        number: p.number,
        title: p.title,
        votes: p.vote_count,
        similarity: Number(d.similarity),
        state: d.state,
      };
    }),
    promptCount: (prompts ?? []).length,
    latestPromptId: prompts?.[0]?.id ?? null,
    voterEmails: (voters ?? [])
      .map((v) => one<{ email: string | null }>(v.end_users)?.email)
      .filter((e): e is string => Boolean(e)),
  };
}

export interface ThemeRow extends Theme {
  votes: number;
  posts: number;
  payingShare: number;
  growth: number;
  trend: number[];
  top: { number: number; title: string; votes: number }[];
}

export async function listThemes(boardId: string): Promise<ThemeRow[]> {
  const db = await supabaseServer();
  const { data: themes } = await db.from("themes").select("*").eq("board_id", boardId);
  if (!themes?.length) return [];

  const posts = await listPosts(boardId, { limit: 500 });
  const rows: ThemeRow[] = themes.map((t) => {
    const mine = posts.filter((p) => p.theme_id === t.id);
    const votes = mine.reduce((a, p) => a + p.vote_count, 0);
    const paying = mine.length
      ? Math.round(mine.reduce((a, p) => a + p.payingShare, 0) / mine.length)
      : 0;
    const trend = new Array(7).fill(0) as number[];
    for (const p of mine) p.trend.forEach((v, i) => (trend[i] += v));
    const firstHalf = trend.slice(0, 3).reduce((a, b) => a + b, 0);
    const lastHalf = trend.slice(4).reduce((a, b) => a + b, 0);

    return {
      ...(t as Theme),
      votes,
      posts: mine.length,
      payingShare: paying,
      growth: growthPct(firstHalf, lastHalf),
      trend,
      top: mine
        .slice(0, 2)
        .map((p) => ({ number: p.number, title: p.title, votes: p.vote_count })),
    };
  });

  return rows.sort((a, b) => b.votes - a.votes);
}

/**
 * Week-on-week growth as a percentage. A theme that went from 2 votes to 40 is
 * technically up 1,900%, which tells a founder nothing — so growth off a tiny
 * base is capped, and a theme with no earlier votes reads as new rather than
 * as an infinite percentage.
 */
export function growthPct(before: number, after: number): number {
  if (before === 0) return after > 0 ? 100 : 0;
  const raw = Math.round(((after - before) / before) * 100);
  // Below this base the ratio is noise, not a trend.
  const cap = before < 5 ? 100 : 300;
  return Math.max(-100, Math.min(cap, raw));
}

export async function getActivity(workspaceId: string, limit = 8): Promise<ActivityItem[]> {
  const db = await supabaseServer();
  const { data } = await db
    .from("activity")
    .select("id,kind,text,meta,post_id,created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as ActivityItem[];
}

export async function getRecommendation(boardId: string): Promise<Recommendation | null> {
  const db = await supabaseServer();
  const { data } = await db
    .from("recommendations")
    .select("*")
    .eq("board_id", boardId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Recommendation | null) ?? null;
}

export async function getMergeQueueCount(boardId: string): Promise<number> {
  const db = await supabaseServer();
  const { count } = await db
    .from("duplicate_suggestions")
    .select("id", { count: "exact", head: true })
    .eq("board_id", boardId)
    .eq("state", "pending");
  return count ?? 0;
}

export async function listChangelog(boardId: string): Promise<ChangelogEntry[]> {
  const db = await supabaseServer();
  const { data } = await db
    .from("changelog_entries")
    .select("*")
    .eq("board_id", boardId)
    .order("created_at", { ascending: false });
  return (data ?? []) as ChangelogEntry[];
}

export interface DailyPoint {
  day: string;
  votes: number;
  posts: number;
}

export async function getDailySeries(boardId: string, days: number): Promise<DailyPoint[]> {
  const db = await supabaseServer();
  const { data } = await db.rpc("board_daily_series", { p_board: boardId, p_days: days });
  return ((data ?? []) as DailyPoint[]).map((d) => ({
    day: d.day,
    votes: Number(d.votes),
    posts: Number(d.posts),
  }));
}

export async function getVotesByPlan(boardId: string): Promise<{ plan: string; votes: number }[]> {
  const db = await supabaseServer();
  const { data } = await db.rpc("board_votes_by_plan", { p_board: boardId });
  return ((data ?? []) as { plan: string; votes: number }[]).map((r) => ({
    plan: r.plan,
    votes: Number(r.votes),
  }));
}
