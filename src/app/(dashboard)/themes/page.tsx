import { Shell } from "@/components/shell";
import { requireFounder } from "@/server/context";
import { listThemes, getStatusCounts } from "@/server/queries";
import { hasAnthropic } from "@/lib/ai/client";
import { ThemesView } from "./themes-view";

/** 08 · Themes — posts grouped by meaning, not keywords. */
export default async function ThemesPage() {
  const ctx = await requireFounder();
  const [themes, counts] = await Promise.all([
    listThemes(ctx.board.id),
    getStatusCounts(ctx.board.id),
  ]);

  return (
    <Shell active="themes" ctx={ctx}>
      <ThemesView
        themes={themes.map((t) => ({
          id: t.id,
          name: t.name,
          summary: t.summary,
          votes: t.votes,
          posts: t.posts,
          payingShare: t.payingShare,
          growth: t.growth,
          trend: t.trend,
          top: t.top,
          updatedAt: t.updated_at,
        }))}
        postCount={counts.all}
        aiReady={hasAnthropic()}
      />
    </Shell>
  );
}
