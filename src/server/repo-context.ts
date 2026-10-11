import { supabaseAdmin } from "@/lib/supabase/server";
import { parseRepo } from "@/lib/integrations";
import { filterTree, type RepoSnapshot } from "@/lib/ai/repo";

/**
 * Read-only repository context.
 *
 * Only the file listing is fetched — never file contents. The point is to let
 * a prompt name real paths instead of saying "the relevant file", and that
 * needs the tree and nothing more. Not reading contents also means a private
 * repo's code never passes through here or reaches a model.
 */

/** GitHub truncates very large trees itself; this is our own ceiling. */
const MAX_PATHS = 4_000;

const TIMEOUT_MS = 15_000;

export interface SnapshotResult {
  ok: boolean;
  error?: string;
  snapshot?: RepoSnapshot;
  truncated?: boolean;
}

/** Pull the current file listing and store it against the board. */
export async function refreshRepoSnapshot(boardId: string): Promise<SnapshotResult> {
  const db = supabaseAdmin();

  const { data: integration } = await db
    .from("integrations")
    .select("config")
    .eq("board_id", boardId)
    .eq("kind", "github")
    .eq("active", true)
    .maybeSingle();

  if (!integration) {
    return { ok: false, error: "Connect GitHub on the Install page first." };
  }

  const config = integration.config as Record<string, string>;
  const repo = parseRepo(config.repo ?? "");
  if (!repo) return { ok: false, error: "The stored repository is not in owner/repo form." };

  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${config.token}`,
    "x-github-api-version": "2022-11-28",
  };

  try {
    // The default branch, rather than assuming main: plenty of repos are
    // still on master, or on something else entirely.
    const meta = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}`, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (meta.status === 404) {
      return { ok: false, error: "GitHub cannot see that repository with this token." };
    }
    if (!meta.ok) return { ok: false, error: `GitHub returned ${meta.status}.` };

    const branch = ((await meta.json()) as { default_branch?: string }).default_branch ?? "main";

    const treeResponse = await fetch(
      `https://api.github.com/repos/${repo.owner}/${repo.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      { headers, signal: AbortSignal.timeout(TIMEOUT_MS) },
    );

    if (!treeResponse.ok) {
      return { ok: false, error: `GitHub returned ${treeResponse.status} for the file list.` };
    }

    const body = (await treeResponse.json()) as {
      tree?: { path: string; type: string }[];
      truncated?: boolean;
    };

    const all = (body.tree ?? []).filter((entry) => entry.type === "blob").map((e) => e.path);
    const kept = filterTree(all);
    const truncated = Boolean(body.truncated) || kept.length > MAX_PATHS;
    const paths = kept.slice(0, MAX_PATHS);

    const snapshot: RepoSnapshot = {
      repo: `${repo.owner}/${repo.repo}`,
      branch,
      paths,
      fetchedAt: new Date().toISOString(),
    };

    await db.from("repo_snapshots").upsert(
      {
        board_id: boardId,
        repo: snapshot.repo,
        branch,
        paths,
        file_count: paths.length,
        truncated,
        fetched_at: snapshot.fetchedAt,
        last_error: null,
      },
      { onConflict: "board_id" },
    );

    return { ok: true, snapshot, truncated };
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub is unreachable.";
    await db
      .from("repo_snapshots")
      .update({ last_error: message })
      .eq("board_id", boardId);
    return { ok: false, error: message };
  }
}

/** The stored snapshot, or null when the board has no repo connected. */
export async function getRepoSnapshot(boardId: string): Promise<RepoSnapshot | null> {
  const { data } = await supabaseAdmin()
    .from("repo_snapshots")
    .select("repo,branch,paths,fetched_at")
    .eq("board_id", boardId)
    .maybeSingle();

  if (!data?.paths?.length) return null;

  return {
    repo: data.repo,
    branch: data.branch,
    paths: data.paths,
    fetchedAt: data.fetched_at,
  };
}
