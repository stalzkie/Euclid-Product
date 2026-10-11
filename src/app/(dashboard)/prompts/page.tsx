import Link from "next/link";
import { Shell } from "@/components/shell";
import { requireFounder } from "@/server/context";
import { supabaseServer } from "@/lib/supabase/server";
import { listPosts, listThemes } from "@/server/queries";
import {
  Card,
  EmptyState,
  Meter,
  PageHeader,
  SectionTitle,
  StatusChip,
  ButtonLink,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { PLANS } from "@/lib/plans";
import { targetSpec } from "@/lib/ai/targets";
import { ago } from "@/lib/format";
import type { PromptTarget } from "@/lib/types";

/** Build Prompts: what has been generated, and what to generate next. */
export default async function PromptsPage() {
  const ctx = await requireFounder();
  const db = await supabaseServer();
  const plan = PLANS[ctx.workspace.plan];

  const [{ data: prompts }, posts, themes] = await Promise.all([
    db
      .from("build_prompts")
      .select("id,version,target,title,copied,created_at,token_estimate,assumptions,posts(number)")
      .eq("workspace_id", ctx.workspace.id)
      .order("created_at", { ascending: false })
      .limit(30),
    listPosts(ctx.board.id, { limit: 6 }),
    listThemes(ctx.board.id),
  ]);

  const rows = (prompts ?? []).map((p) => ({
    id: p.id,
    version: p.version,
    target: p.target as PromptTarget,
    title: p.title,
    copied: p.copied,
    createdAt: p.created_at,
    tokens: p.token_estimate,
    openAssumptions: ((p.assumptions as { confirmed: boolean }[]) ?? []).filter(
      (a) => !a.confirmed,
    ).length,
    postNumber: Array.isArray(p.posts)
      ? p.posts[0]?.number
      : (p.posts as { number?: number } | null)?.number,
  }));

  const copiedShare = rows.length
    ? Math.round((rows.filter((r) => r.copied).length / rows.length) * 100)
    : 0;

  const unprompted = posts.filter(
    (p) => !rows.some((r) => r.postNumber === p.number),
  );

  return (
    <Shell active="prompts" ctx={ctx}>
      <PageHeader
        title="Build Prompts"
        subtitle="Every prompt you have generated, and the requests worth prompting next."
        actions={
          unprompted[0] ? (
            <ButtonLink
              href={`/prompts/new?post=${unprompted[0].number}`}
              variant="ai"
              icon="sparkle"
            >
              Prompt the top request
            </ButtonLink>
          ) : undefined
        }
      />

      <section className="grid grid-cols-1 rounded-card border border-line md:grid-cols-3">
        <div className="flex flex-col gap-[6px] border-b border-line px-5 py-4 md:border-b-0 md:border-r">
          <span className="text-[13px] text-ink-2">Used this month</span>
          <span className="tnum text-[30px] font-semibold tracking-[-0.02em]">
            {ctx.workspace.prompts_used}
            <span className="text-[16px] font-normal text-ink-3"> / {plan.buildPrompts}</span>
          </span>
          <Meter value={ctx.workspace.prompts_used} max={plan.buildPrompts} />
        </div>
        <div className="flex flex-col gap-[6px] border-b border-line px-5 py-4 md:border-b-0 md:border-r">
          <span className="text-[13px] text-ink-2">Copied after generating</span>
          <span className="tnum text-[30px] font-semibold tracking-[-0.02em]">
            {copiedShare}%
          </span>
          <span className="text-[12px] text-ink-3">
            The honest read on prompt quality
          </span>
        </div>
        <div className="flex flex-col gap-[6px] px-5 py-4">
          <span className="text-[13px] text-ink-2">Assumptions open</span>
          <span className="tnum text-[30px] font-semibold tracking-[-0.02em]">
            {rows.reduce((a, r) => a + r.openAssumptions, 0)}
          </span>
          <span className="text-[12px] text-ink-3">Across all drafts</span>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>Recent prompts</SectionTitle>
        <Card className="overflow-hidden">
          {rows.length === 0 ? (
            <EmptyState
              icon="sparkle"
              title="No Build Prompts yet"
              body="Pick a request your users care about and Euclid writes the brief: goal, acceptance criteria, edge cases, test plan, and the assumptions it had to make."
              action={
                posts[0] ? (
                  <ButtonLink
                    href={`/prompts/new?post=${posts[0].number}`}
                    variant="ai"
                    icon="sparkle"
                  >
                    Generate your first
                  </ButtonLink>
                ) : (
                  <ButtonLink href="/install" variant="primary">
                    Install the widget first
                  </ButtonLink>
                )
              }
            />
          ) : (
            rows.map((r, i) => (
              <Link
                key={r.id}
                href={`/prompts/${r.id}`}
                className={`flex flex-wrap items-center gap-3 px-4 py-3 text-ink no-underline hover:bg-subtle ${
                  i < rows.length - 1 ? "border-b border-hairline" : ""
                }`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-ai-wash text-ai">
                  <Icon name="sparkle" size={16} strokeWidth={1.9} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                  <span className="truncate text-[14px] font-medium">{r.title}</span>
                  <span className="text-[12px] text-ink-3">
                    {targetSpec(r.target).label} · v{r.version} ·{" "}
                    {r.postNumber ? `#${r.postNumber}` : "theme"} · about {r.tokens} tokens
                  </span>
                </span>
                {r.openAssumptions > 0 && (
                  <span className="rounded-full bg-warn-wash px-[9px] py-[3px] text-[12px] font-medium text-warn">
                    {r.openAssumptions} to check
                  </span>
                )}
                <span
                  className={`rounded-full px-[9px] py-[3px] text-[12px] font-medium ${
                    r.copied ? "bg-ok-wash text-ok" : "bg-muted text-ink-2"
                  }`}
                >
                  {r.copied ? "Copied" : "Draft"}
                </span>
                <span className="w-[72px] text-right text-[12px] text-ink-3">
                  {ago(r.createdAt)}
                </span>
              </Link>
            ))
          )}
        </Card>
      </section>

      {unprompted.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle>Worth prompting next</SectionTitle>
          <Card className="overflow-hidden">
            {unprompted.map((p, i) => (
              <div
                key={p.id}
                className={`flex flex-wrap items-center gap-3 px-4 py-3 ${
                  i < unprompted.length - 1 ? "border-b border-hairline" : ""
                }`}
              >
                <span className="tnum inline-flex h-[26px] shrink-0 items-center gap-1 rounded-[7px] border border-line-strong px-2 text-[13px] font-semibold">
                  <Icon name="caretUp" size={11} strokeWidth={2.6} />
                  {p.vote_count}
                </span>
                <Link
                  href={`/posts/${p.number}`}
                  className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink no-underline hover:underline"
                >
                  {p.title}
                </Link>
                <StatusChip status={p.status} />
                <ButtonLink
                  href={`/prompts/new?post=${p.number}`}
                  variant="ai"
                  icon="sparkle"
                >
                  Build Prompt
                </ButtonLink>
              </div>
            ))}
          </Card>
        </section>
      )}

      {themes.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle>Or prompt a whole theme</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {themes.slice(0, 6).map((t) => (
              <Link
                key={t.id}
                href={`/prompts/new?theme=${t.id}`}
                className="flex items-center gap-2 rounded-control border border-line bg-canvas px-3 py-2 text-[13px] text-ink no-underline hover:bg-subtle"
              >
                <Icon name="themes" size={14} />
                {t.name}
                <span className="tnum text-[12px] text-ink-3">{t.votes}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </Shell>
  );
}
