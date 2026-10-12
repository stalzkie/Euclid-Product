import { Shell } from "@/components/shell";
import { requireFounder } from "@/server/context";
import { supabaseServer } from "@/lib/supabase/server";
import {
  getDailySeries,
  getStatusCounts,
  getVotesByPlan,
  getWeekKpis,
} from "@/server/queries";
import { PLANS } from "@/lib/plans";
import { InsightsView } from "./insights-view";
import type { PromptTarget } from "@/lib/types";

/** 11 · Insights. */
export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requireFounder();
  const db = await supabaseServer();
  const plan = PLANS[ctx.workspace.plan];

  const days = params.range === "7" ? 7 : params.range === "90" ? 90 : 30;

  const [
    series,
    kpis,
    statusCounts,
    plans,
    { data: prompts },
    { data: shippedPrompts },
    { data: sources },
  ] = await Promise.all([
    getDailySeries(ctx.board.id, days),
    getWeekKpis(ctx.board.id),
    getStatusCounts(ctx.board.id),
    getVotesByPlan(ctx.board.id),
    db.from("build_prompts").select("target,copied").eq("workspace_id", ctx.workspace.id),
    db
      .from("build_prompts")
      .select("target, posts!inner(status)")
      .eq("workspace_id", ctx.workspace.id)
      .eq("posts.status", "shipped"),
    // Where posts come from. The widget stamps nothing today, so this reads
    // the author identity kind as a proxy and labels it honestly.
    db.from("posts").select("author_id, end_users(kind)").eq("board_id", ctx.board.id),
  ]);

  // Period totals for the KPI row, from the series rather than the week view.
  const totals = series.reduce(
    (acc, d) => ({ votes: acc.votes + d.votes, posts: acc.posts + d.posts }),
    { votes: 0, posts: 0 },
  );

  const byTool = new Map<PromptTarget, { generated: number; copied: number; shipped: number }>();
  for (const p of prompts ?? []) {
    const row = byTool.get(p.target as PromptTarget) ?? {
      generated: 0,
      copied: 0,
      shipped: 0,
    };
    row.generated += 1;
    if (p.copied) row.copied += 1;
    byTool.set(p.target as PromptTarget, row);
  }
  for (const p of shippedPrompts ?? []) {
    const row = byTool.get(p.target as PromptTarget);
    if (row) row.shipped += 1;
  }

  const sourceCounts = { widget: 0, hosted: 0, founder: 0 };
  for (const row of sources ?? []) {
    if (!row.author_id) sourceCounts.founder += 1;
    else {
      const kind = Array.isArray(row.end_users)
        ? row.end_users[0]?.kind
        : (row.end_users as { kind?: string } | null)?.kind;
      if (kind === "jwt") sourceCounts.widget += 1;
      else sourceCounts.hosted += 1;
    }
  }

  return (
    <Shell active="insights" ctx={ctx}>
      <InsightsView
        days={days}
        series={series}
        totals={totals}
        kpis={kpis}
        statusCounts={statusCounts}
        plans={plans}
        promptsByTool={[...byTool.entries()].map(([target, row]) => ({ target, ...row }))}
        sources={sourceCounts}
        analyticsEnabled={plan.analytics}
        planName={plan.name}
        identityMode={ctx.board.identity_mode}
      />
    </Shell>
  );
}
