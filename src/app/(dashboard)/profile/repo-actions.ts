"use server";

import { revalidatePath } from "next/cache";
import { requireFounder } from "@/server/context";
import { supabaseAdmin } from "@/lib/supabase/server";
import { refreshRepoSnapshot } from "@/server/repo-context";

export interface RepoStatus {
  connected: boolean;
  repo: string | null;
  branch: string | null;
  fileCount: number;
  truncated: boolean;
  fetchedAt: string | null;
  lastError: string | null;
}

export async function readRepoStatus(boardId: string): Promise<RepoStatus> {
  const db = supabaseAdmin();

  const [{ data: integration }, { data: snapshot }] = await Promise.all([
    db
      .from("integrations")
      .select("config")
      .eq("board_id", boardId)
      .eq("kind", "github")
      .eq("active", true)
      .maybeSingle(),
    db
      .from("repo_snapshots")
      .select("repo,branch,file_count,truncated,fetched_at,last_error")
      .eq("board_id", boardId)
      .maybeSingle(),
  ]);

  return {
    connected: Boolean(integration),
    repo: snapshot?.repo ?? ((integration?.config as Record<string, string>)?.repo ?? null),
    branch: snapshot?.branch ?? null,
    fileCount: snapshot?.file_count ?? 0,
    truncated: Boolean(snapshot?.truncated),
    fetchedAt: snapshot?.fetched_at ?? null,
    lastError: snapshot?.last_error ?? null,
  };
}

export async function refreshRepo(): Promise<
  { ok: true; status: RepoStatus; message: string } | { ok: false; error: string }
> {
  const ctx = await requireFounder();

  const result = await refreshRepoSnapshot(ctx.board.id);
  if (!result.ok) return { ok: false, error: result.error ?? "Could not read the repository." };

  revalidatePath("/profile");

  const count = result.snapshot?.paths.length ?? 0;
  return {
    ok: true,
    status: await readRepoStatus(ctx.board.id),
    message: result.truncated
      ? `Read ${count} files. The repository is larger than that, so the listing is partial.`
      : `Read ${count} files.`,
  };
}
