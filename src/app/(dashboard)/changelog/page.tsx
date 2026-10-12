import { Shell } from "@/components/shell";
import { requireFounder } from "@/server/context";
import { supabaseServer } from "@/lib/supabase/server";
import { listChangelog, listPostSummaries } from "@/server/queries";
import { hasAnthropic } from "@/lib/ai/client";
import { ChangelogView } from "./changelog-view";
import type { ChangelogEntry } from "@/lib/types";

/** 13 · Changelog. */
export default async function ChangelogPage({
  searchParams,
}: {
  searchParams: Promise<{ entry?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requireFounder();
  const db = await supabaseServer();

  // Neither of these depends on the other.
  const [entries, candidates] = await Promise.all([
    listChangelog(ctx.board.id),
    // Candidates to link: anything in progress or recently planned.
    listPostSummaries(ctx.board.id, 20),
  ]);

  const selected =
    entries.find((e) => e.id === params.entry) ??
    entries.find((e) => !e.published) ??
    entries[0] ??
    null;

  // Which posts this entry ships, and how many voters that reaches.
  let linked: { id: string; number: number; title: string; voters: number }[] = [];
  if (selected) {
    const { data: links } = await db
      .from("changelog_posts")
      .select("post_id, posts(id,number,title,vote_count)")
      .eq("entry_id", selected.id);

    linked = (links ?? [])
      .map((l) => {
        const p = Array.isArray(l.posts)
          ? l.posts[0]
          : (l.posts as { id: string; number: number; title: string; vote_count: number } | null);
        return p
          ? { id: p.id, number: p.number, title: p.title, voters: p.vote_count }
          : null;
      })
      .filter((p): p is { id: string; number: number; title: string; voters: number } =>
        Boolean(p),
      );
  }

  return (
    <Shell active="changelog" ctx={ctx} wide>
      <ChangelogView
        entries={entries as ChangelogEntry[]}
        selected={selected as ChangelogEntry | null}
        linked={linked}
        candidates={candidates
          .filter((p) => !linked.some((l) => l.id === p.id))
          .map((p) => ({ number: p.number, title: p.title, votes: p.vote_count }))}
        publicUrl={`/b/${ctx.board.public_id}?tab=changelog`}
        founderName={ctx.name}
        appName={ctx.workspace.app_name ?? ctx.workspace.name}
        aiReady={hasAnthropic()}
      />
    </Shell>
  );
}
