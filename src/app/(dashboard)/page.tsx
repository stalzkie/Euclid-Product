import Link from "next/link";
import { Shell } from "@/components/shell";
import { Icon } from "@/components/icons";
import {
  AiCard,
  AiLabel,
  ButtonLink,
  Card,
  EmptyState,
  SectionTitle,
  Sparkline,
  SplitButton,
  Stat,
  StatusChip,
} from "@/components/ui";
import { Stagger } from "@/components/motion";
import { ago, greeting, signedPct } from "@/lib/format";
import { requireFounder } from "@/server/context";
import {
  getActivity,
  getMergeQueueCount,
  getRecommendation,
  getWeekKpis,
  listPosts,
  listThemes,
} from "@/server/queries";

/** 05 · Home — what this board's users asked for this week. */
export default async function HomePage() {
  const ctx = await requireFounder();
  const board = ctx.board;

  const [kpis, top, activity, rec, themes, dupes] = await Promise.all([
    getWeekKpis(board.id),
    listPosts(board.id, { limit: 5 }),
    getActivity(ctx.workspace.id, 4),
    getRecommendation(board.id),
    listThemes(board.id),
    getMergeQueueCount(board.id),
  ]);

  const rising = themes.filter((t) => t.growth > 0).slice(0, 3);
  const appName = ctx.workspace.app_name ?? ctx.workspace.name;

  return (
    <Shell active="home" ctx={ctx}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] font-semibold tracking-[-0.015em]">
            {greeting()}, {ctx.name.split(" ")[0]}
          </h1>
          <p className="text-[14px] text-ink-2">
            Here is what {appName} users asked for this week.
          </p>
        </div>
        <div className="flex gap-2">
          <ButtonLink href={`/b/${board.public_id}`} iconAfter="arrowUpRight" target="_blank">
            View public board
          </ButtonLink>
          <SplitButton href="/prompts/new" label="New Build Prompt" />
        </div>
      </header>

      {/* This week */}
      <section
        aria-label="This week"
        className="grid grid-cols-2 rounded-card border border-line md:grid-cols-4"
      >
        <Stat
          label="New posts"
          metric="home-new-posts"
          value={kpis.newPosts}
          delta={signedPct(kpis.newPostsDelta)}
          deltaTone={kpis.newPostsDelta >= 0 ? "ok" : "bad"}
          className="border-b border-r border-line md:border-b-0"
        />
        <Stat
          label="Votes cast"
          metric="home-votes-cast"
          value={kpis.votes}
          delta={signedPct(kpis.votesDelta)}
          deltaTone={kpis.votesDelta >= 0 ? "ok" : "bad"}
          className="border-b border-line md:border-b-0 md:border-r"
        />
        <Stat
          label="Active voters"
          metric="home-active-voters"
          value={kpis.voters}
          note={`${kpis.payingVoters} paying`}
          className="border-r border-line"
        />
        <Stat
          label="Shipped this month"
          metric="home-shipped-this-month"
          value={kpis.shippedThisMonth}
          note={`${kpis.votersNotified} voters notified`}
        />
      </section>

      <div className="flex flex-wrap items-start gap-7">
        {/* Top requests + activity */}
        <section
          aria-labelledby="top-title"
          className="flex min-w-0 flex-[999_1_520px] flex-col gap-3"
        >
          <div className="flex items-center justify-between">
            <SectionTitle id="top-title">Top requests this week</SectionTitle>
            <Link
              href="/feedback"
              className="eu-colors flex items-center gap-[6px] text-[13px] font-medium text-ink-2 no-underline hover:text-ink"
            >
              View all
              <Icon name="arrowRight" size={14} strokeWidth={1.8} />
            </Link>
          </div>

          <Card className="overflow-hidden">
            {top.length === 0 ? (
              <EmptyState
                icon="feedback"
                title="No posts yet"
                body="Once the widget is live on your app, the first suggestions land here. Submit a test post from your own board to see the loop."
                action={
                  <ButtonLink href="/install" variant="primary">
                    Install the widget
                  </ButtonLink>
                }
              />
            ) : (
              /*
                First mount only, and only once the app has hydrated — a list
                the server already rendered appears in place rather than
                cascading in front of someone who is mid-read.
              */
              <Stagger>
                {top.map((p, i) => (
                <Link
                  key={p.id}
                  href={`/posts/${p.number}`}
                  className={`eu-colors flex items-center gap-[14px] px-4 py-3 no-underline text-ink hover:bg-subtle ${
                    i < top.length - 1 ? "border-b border-hairline" : ""
                  }`}
                >
                  <span className="flex h-12 w-11 shrink-0 flex-col items-center justify-center rounded-[10px] border border-line-strong bg-canvas text-[13px] font-semibold">
                    <Icon name="caretUp" size={12} strokeWidth={2.4} />
                    <span className="tnum">{p.vote_count}</span>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-[14px] font-medium">{p.title}</span>
                    <span className="flex items-center gap-2 text-[12px] text-ink-3">
                      <span>{p.themeName ?? p.category ?? "Untriaged"}</span>
                      <span aria-hidden="true">·</span>
                      <span>{p.payingShare}% paying</span>
                      {p.recentVotes > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-ok">+{p.recentVotes} this week</span>
                        </>
                      )}
                    </span>
                  </span>
                  <StatusChip status={p.status} />
                </Link>
                ))}
              </Stagger>
            )}
          </Card>

          <SectionTitle>Recent activity</SectionTitle>
          <div className="flex flex-col">
            {activity.length === 0 ? (
              <p className="py-3 text-[13px] text-ink-3">
                Nothing has happened on this board yet.
              </p>
            ) : (
              <Stagger>
                {activity.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-3 border-b border-hairline px-[2px] py-[10px]"
                >
                  <span
                    className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-white"
                    style={{ background: ACTIVITY_DOT[a.kind] ?? "#17171A" }}
                  >
                    <Icon
                      name={ACTIVITY_ICON[a.kind] ?? "plus"}
                      size={12}
                      strokeWidth={2.4}
                    />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
                    <span className="truncate text-[13.5px]">{a.text}</span>
                    {a.meta && <span className="text-[12px] text-ink-3">{a.meta}</span>}
                  </span>
                  <span className="whitespace-nowrap text-[12px] text-ink-3">
                    {ago(a.created_at)}
                  </span>
                </div>
                ))}
              </Stagger>
            )}
          </div>
        </section>

        {/* Right rail */}
        <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
          {rec ? (
            <AiCard>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <AiLabel>Euclid recommends</AiLabel>
                  <span className="text-[11.5px] text-ink-3">Weekly digest · Mon</span>
                </div>
                <h2 className="text-[17px] font-semibold leading-[1.35] tracking-[-0.01em]">
                  {rec.headline}
                </h2>
                <ul className="flex list-disc flex-col gap-[6px] pl-[18px] text-[13.5px] leading-[1.45] text-ink-body">
                  {rec.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-[6px]">
                  {rec.source_posts.map((p) => (
                    <Link
                      key={p.number}
                      href={`/posts/${p.number}`}
                      className="eu-colors rounded-chip border border-line bg-canvas px-2 py-[3px] text-[12px] font-medium text-ink-body no-underline hover:bg-subtle"
                    >
                      #{p.number} {p.title}
                    </Link>
                  ))}
                </div>
                <div className="flex gap-2">
                  <ButtonLink
                    href={
                      rec.source_posts[0]
                        ? `/prompts/new?post=${rec.source_posts[0].number}`
                        : "/prompts/new"
                    }
                    variant="ai"
                    icon="sparkle"
                    className="flex-1"
                  >
                    Generate Build Prompt
                  </ButtonLink>
                  <ButtonLink href={`/ask?q=${encodeURIComponent(`Why is ${rec.headline.toLowerCase()} the right call?`)}`}>
                    Ask why
                  </ButtonLink>
                </div>
              </div>
            </AiCard>
          ) : (
            <AiCard>
              <div className="flex flex-col gap-3">
                <AiLabel>Euclid recommends</AiLabel>
                <p className="text-[13.5px] leading-[1.5] text-ink-body">
                  Once this board has a few dozen votes, Euclid ranks what to build
                  next and shows the reasons behind it.
                </p>
                <ButtonLink href="/insights" variant="secondary">
                  See the numbers so far
                </ButtonLink>
              </div>
            </AiCard>
          )}

          {dupes > 0 && (
            <section
              aria-labelledby="dup-title"
              className="flex flex-col gap-[10px] rounded-[14px] border border-line px-[18px] py-4"
            >
              <div className="flex items-center gap-[10px]">
                <span className="flex h-[30px] w-[30px] items-center justify-center rounded-control bg-state-wash text-state">
                  <MergeGlyph />
                </span>
                <span className="flex flex-col">
                  <span id="dup-title" className="text-[14px] font-semibold">
                    {dupes} likely duplicate{dupes === 1 ? "" : "s"}
                  </span>
                  <span className="text-[12px] text-ink-3">
                    Merging combines votes
                  </span>
                </span>
              </div>
              <Link
                href="/feedback?view=merges"
                className="flex h-[34px] items-center justify-center rounded-control border border-line-strong text-[13px] font-medium text-ink no-underline hover:bg-subtle"
              >
                Review merges
              </Link>
            </section>
          )}

          {rising.length > 0 && (
            <section
              aria-labelledby="rise-title"
              className="flex flex-col gap-3 rounded-[14px] border border-line px-[18px] py-4"
            >
              <h2 id="rise-title" className="text-[14px] font-semibold">
                Rising themes
              </h2>
              {rising.map((t) => (
                <Link
                  key={t.id}
                  href={`/themes#${t.id}`}
                  className="flex items-center gap-3 text-ink no-underline"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                    <span className="truncate text-[13.5px] font-medium">{t.name}</span>
                    <span className="text-[12px] text-ink-3">{t.votes} votes</span>
                  </span>
                  <Sparkline points={t.trend} width={72} height={24} color="#1A8CFF" />
                  <span className="w-11 text-right text-[12px] font-medium text-ok">
                    +{t.growth}%
                  </span>
                </Link>
              ))}
            </section>
          )}

          {/* Setup nudge until the widget has seen traffic. */}
          {kpis.votes === 0 && top.length === 0 && (
            <section className="flex flex-col gap-[10px] rounded-[14px] border border-line px-[18px] py-4">
              <h2 className="text-[14px] font-semibold">Finish setup</h2>
              <p className="text-[13px] leading-[1.5] text-ink-3">
                One script tag puts this board in your app. Changes you make in the
                designer go live without redeploying.
              </p>
              <ButtonLink href="/install" variant="primary">
                Copy the script tag
              </ButtonLink>
            </section>
          )}
        </aside>
      </div>
    </Shell>
  );
}

/* The merge glyph is three nodes and a curve, not a single path. */
function MergeGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path d="M6 7v10M6 7c0 3 3 5 10 5" />
    </svg>
  );
}

const ACTIVITY_DOT: Record<string, string> = {
  post: "#17171A",
  merge: "#1A8CFF",
  ship: "#16A34A",
  prompt: "#D1347A",
  vote: "#17171A",
};

const ACTIVITY_ICON: Record<string, "plus" | "merge" | "check" | "sparkle"> = {
  post: "plus",
  merge: "merge",
  ship: "check",
  prompt: "sparkle",
  vote: "plus",
};



