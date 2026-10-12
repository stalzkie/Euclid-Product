import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { isConfigured, supabaseServer } from "@/lib/supabase/server";
import { getJwks } from "@/lib/supabase/jwks";
import type { Board, ProjectProfile, Workspace } from "@/lib/types";

/**
 * The founder's context for one request: who they are, which workspace they
 * are in, which board is selected. Every dashboard page starts here.
 *
 * Everything in here is on the critical path of every navigation, so it is
 * written to cost as few round trips to Supabase as it can: the session is
 * verified locally, the workspace, boards and profile arrive in one embedded
 * select, and the sidebar's per-board counts are issued together.
 */
export interface FounderContext {
  userId: string;
  email: string;
  name: string;
  initials: string;
  workspace: Workspace;
  profile: ProjectProfile | null;
  boards: Board[];
  board: Board;
  boardCounts: Record<string, number>;
}

const BOARD_COOKIE = "euclid_board";

/** A board as it arrives from the query below: with its open-post count. */
type BoardRow = Board & { posts: { count: number }[] | null };

interface MembershipRow {
  name: string | null;
  role: string;
  workspaces:
    | (Workspace & {
        boards: BoardRow[] | null;
        project_profiles: ProjectProfile[] | null;
      })
    | null;
}

/**
 * Memoised for the duration of one request: a page and the server action it
 * renders both ask for the context, and React's cache keeps that to one set of
 * queries rather than two.
 */
export const getFounderContext = cache(
  async function getFounderContext(): Promise<FounderContext | null> {
    if (!isConfigured()) return null;

    const supabase = await supabaseServer();

    // `getClaims` verifies the access token against the project's public key
    // set rather than asking the auth server to do it, which `getUser` does on
    // every single call. Middleware has already refreshed and validated the
    // session for this request, so the extra round trip bought nothing.
    const jwks = await getJwks();
    const { data: claimed } = await supabase.auth.getClaims(
      undefined,
      // supabase-js does not export its JWK type, so the shape the cache
      // returns is asserted here rather than duplicated there.
      jwks ? ({ jwks } as ClaimsOptions) : undefined,
    );
    const claims = claimed?.claims;

    let userId = typeof claims?.sub === "string" ? claims.sub : "";
    let email = typeof claims?.email === "string" ? claims.email : "";
    let metaName = (claims?.user_metadata as { full_name?: string } | undefined)?.full_name;

    // No verifiable token — either the project signs symmetrically or the
    // cookie is unreadable. Fall back to the authoritative check.
    if (!userId) {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) redirect("/signup");
      userId = auth.user.id;
      email = auth.user.email ?? "";
      metaName = auth.user.user_metadata?.full_name as string | undefined;
    }

    // Membership, workspace, its boards with their open-post counts, and the
    // project profile: one request for everything the frame of every dashboard
    // screen needs. The counts are aggregated in the database, so no post rows
    // cross the wire. RLS keeps the embedded rows inside the caller's own
    // workspace.
    //
    // This used to be four requests and then one more per board. Against a
    // remote database each is most of a second, which the founder saw as a
    // pause on every single navigation.
    const { data: memberships } = await supabase
      .from("workspace_members")
      .select("name, role, workspaces(*, boards(*, posts(count)), project_profiles(*))")
      .eq("user_id", userId)
      .is("workspaces.boards.posts.merged_into", null)
      .eq("workspaces.boards.posts.approved", true)
      .order("created_at", { ascending: true })
      .order("created_at", { referencedTable: "workspaces.boards", ascending: true })
      .limit(1);

    const membership = (memberships?.[0] ?? null) as MembershipRow | null;
    const workspace = membership?.workspaces ?? null;
    if (!workspace) redirect("/onboarding/app");

    const boardRows = (workspace.boards ?? []) as BoardRow[];
    if (!boardRows.length) redirect("/onboarding/app");

    const boards = boardRows.map(stripCount);
    const counts = Object.fromEntries(
      boardRows.map((b) => [b.id, b.posts?.[0]?.count ?? 0]),
    ) as Record<string, number>;

    const profile = (workspace.project_profiles ?? [])[0] ?? null;

    const store = await cookies();
    const preferred = store.get(BOARD_COOKIE)?.value;
    const board = boards.find((b) => b.id === preferred) ?? boards[0];

    // A dormant workspace still gets a fresh monthly allowance, but the
    // function that grants it is a no-op for all but the first visit of a
    // month. The row we just read says whether this is that visit, so the
    // other navigations do not pay for a write that changes nothing.
    const rolled = needsRoll(workspace.usage_period_start);
    if (rolled) {
      await supabase.rpc("roll_usage_period", { p_workspace: workspace.id });
    }

    const name = membership?.name || metaName || email.split("@")[0] || "Founder";

    return {
      userId,
      email,
      name,
      initials: initialsOf(name),
      workspace: rolled
        ? { ...stripEmbeds(workspace), prompts_used: 0, chat_credits_used: 0 }
        : stripEmbeds(workspace),
      profile: profile as ProjectProfile | null,
      boards,
      board: board as Board,
      boardCounts: counts,
    };
  },
);

type Supa = Awaited<ReturnType<typeof supabaseServer>>;
type ClaimsOptions = NonNullable<Parameters<Supa["auth"]["getClaims"]>[1]>;

/**
 * Whether the workspace's usage period predates this month, and so whether
 * `roll_usage_period` has anything to do. The comparison is on month
 * boundaries, so this machine's clock running a little ahead of the
 * database's can only make it ask on a navigation where the answer is no —
 * never skip one where the answer is yes.
 */
export function needsRoll(periodStart: string | null | undefined, now = new Date()): boolean {
  if (!periodStart) return true;
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  return periodStart.slice(0, 10) < monthStart;
}

/** A board row without the aggregate that was embedded into it. */
function stripCount(row: BoardRow): Board {
  const copy = { ...row } as Record<string, unknown>;
  delete copy.posts;
  return copy as unknown as Board;
}

/** The workspace row without the relations that were embedded into it. */
function stripEmbeds(
  workspace: Workspace & { boards?: unknown; project_profiles?: unknown },
): Workspace {
  const copy = { ...workspace } as Record<string, unknown>;
  delete copy.boards;
  delete copy.project_profiles;
  return copy as unknown as Workspace;
}

/**
 * Same as above but throws past the null case, for pages that are always
 * behind the auth middleware. Returns null only when Supabase is unconfigured,
 * which the layout turns into a setup notice.
 */
export async function requireFounder(): Promise<FounderContext> {
  const ctx = await getFounderContext();
  if (!ctx) redirect("/setup");
  return ctx;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "··";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export { BOARD_COOKIE };
