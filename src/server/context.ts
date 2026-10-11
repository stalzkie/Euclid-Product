import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { isConfigured, supabaseServer } from "@/lib/supabase/server";
import type { Board, ProjectProfile, Workspace } from "@/lib/types";

/**
 * The founder's context for one request: who they are, which workspace they
 * are in, which board is selected. Every dashboard page starts here.
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

export async function getFounderContext(): Promise<FounderContext | null> {
  if (!isConfigured()) return null;

  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/signup");

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("name, role, workspaces(*)")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: true })
    .limit(1);

  const workspace = memberships?.[0]?.workspaces as Workspace | undefined;
  if (!workspace) redirect("/onboarding/app");

  // A dormant workspace still gets a fresh monthly allowance.
  await supabase.rpc("roll_usage_period", { p_workspace: workspace.id });

  const { data: boards } = await supabase
    .from("boards")
    .select("*")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: true });

  if (!boards?.length) redirect("/onboarding/app");

  const { data: profile } = await supabase
    .from("project_profiles")
    .select("*")
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  const store = await cookies();
  const preferred = store.get(BOARD_COOKIE)?.value;
  const board = boards.find((b) => b.id === preferred) ?? boards[0];

  // Open-post counts for the sidebar.
  const counts: Record<string, number> = {};
  for (const b of boards) {
    const { count } = await supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("board_id", b.id)
      .is("merged_into", null)
      .eq("approved", true);
    counts[b.id] = count ?? 0;
  }

  const name =
    memberships?.[0]?.name ||
    (auth.user.user_metadata?.full_name as string | undefined) ||
    auth.user.email?.split("@")[0] ||
    "Founder";

  return {
    userId: auth.user.id,
    email: auth.user.email ?? "",
    name,
    initials: initialsOf(name),
    workspace: { ...workspace, usage_period_start: workspace.usage_period_start },
    profile: (profile as ProjectProfile | null) ?? null,
    boards: boards as Board[],
    board: board as Board,
    boardCounts: counts,
  };
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
