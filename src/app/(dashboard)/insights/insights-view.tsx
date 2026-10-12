"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { m } from "motion/react";
import { Icon } from "@/components/icons";
import { Banner, Card, Meter, SectionTitle, cx } from "@/components/ui";
import { shortDate, signedPct, thousands } from "@/lib/format";
import { POST_STATUSES, STATUS_LABEL, STATUS_LOOK, type IdentityMode, type PostStatus, type PromptTarget } from "@/lib/types";
import { targetSpec } from "@/lib/ai/targets";
import { AnimatedNumber, CountUp, FadeRise, useReduceMotion } from "@/components/motion";
import { barStagger, dur, ease } from "@/lib/motion/tokens";
import type { BoardKpis, DailyPoint } from "@/server/queries";

const PLAN_COLOR = ["#0A72DC", "#7C3AED", "#D6D6D2", "#16A34A", "#B45309"];

/** 11 · Insights — votes, voters and what you shipped. */
export function InsightsView({
  days,
  series,
  totals,
  kpis,
  statusCounts,
  plans,
  promptsByTool,
  sources,
  analyticsEnabled,
  planName,
  identityMode,
}: {
  days: number;
  series: DailyPoint[];
  totals: { votes: number; posts: number };
  kpis: BoardKpis;
  statusCounts: Record<"all" | PostStatus, number>;
  plans: { plan: string; votes: number }[];
  promptsByTool: { target: PromptTarget; generated: number; copied: number; shipped: number }[];
  sources: { widget: number; hosted: number; founder: number };
  analyticsEnabled: boolean;
  planName: string;
  identityMode: IdentityMode;
}) {
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const [hover, setHover] = useState<number | null>(null);
  const chartRef = useRef<SVGSVGElement>(null);
  const [drawIn, setDrawIn] = useState(false);

  const chart = useMemo(() => buildChart(series), [series]);

  /*
    Draw-in is a first-view animation, so it waits for the chart to actually
    be on screen rather than firing while it is below the fold. It runs once:
    the flag is set before the first paint of the animated elements and never
    cleared, so a range change re-renders the same chart without redrawing it.
  */
  useEffect(() => {
    if (reduceMotion) return;
    const el = chartRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setDrawIn(true);
      },
      { threshold: 0.25 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [reduceMotion]);

  // Second half against first half, which is what the headline claims.
  const half = Math.floor(series.length / 2);
  const recent = series.slice(half).reduce((a, d) => a + d.votes, 0);
  const prior = series.slice(0, half).reduce((a, d) => a + d.votes, 0);
  const lift = prior ? recent / prior : 0;

  const totalPlanVotes = plans.reduce((a, p) => a + p.votes, 0);
  const totalSources = sources.widget + sources.hosted + sources.founder;
  const generated = promptsByTool.reduce((a, t) => a + t.generated, 0);
  const copied = promptsByTool.reduce((a, t) => a + t.copied, 0);

  /*
    `raw` is what counts up; `value` is how it reads. Keeping them apart means
    a formatted tile — "14d", a thousands separator — still animates, and a
    tile with nothing to report ("—") simply has nothing to count to.
  */
  const count = (n: number) => thousands(n);
  const days_ = (n: number) => `${n}d`;
  const dash = () => "—";

  const kpiTiles = [
    { label: "New posts", raw: totals.posts, format: count, delta: signedPct(kpis.newPostsDelta), tone: "ok" as const },
    { label: "Votes", raw: totals.votes, format: count, delta: signedPct(kpis.votesDelta), tone: "ok" as const },
    { label: "Voters", raw: kpis.voters, format: count, delta: `${kpis.payingVoters} paying`, tone: "neutral" as const },
    { label: "Comments", raw: kpis.comments, format: count, delta: signedPct(kpis.commentsDelta), tone: "ok" as const },
    { label: "Shipped", raw: kpis.shippedThisMonth, format: count, delta: `${kpis.votersNotified} notified`, tone: "neutral" as const },
    {
      label: "Time to ship",
      raw: kpis.timeToShip ?? 0,
      // Nothing shipped yet is not a zero to count up to.
      format: kpis.timeToShip === null ? dash : days_,
      delta: kpis.timeToShip === null ? "nothing shipped yet" : "median",
      tone: "neutral" as const,
    },
  ];

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] font-semibold tracking-[-0.015em]">Insights</h1>
          <p className="text-[14px] text-ink-2">
            Votes, voters and what you shipped on this board.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            role="radiogroup"
            aria-label="Date range"
            className="flex gap-[2px] rounded-[9px] bg-muted p-[3px]"
          >
            {[7, 30, 90].map((d) => {
              const on = d === days;
              return (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => router.push(`/insights?range=${d}`)}
                  className={cx(
                    "eu-press h-7 rounded-[7px] px-3 text-[12.5px] font-medium",
                    on ? "bg-canvas text-ink shadow-seg" : "text-ink-2",
                  )}
                >
                  {d} days
                </button>
              );
            })}
          </div>
          <button
            type="button"
            aria-label="Refresh"
            onClick={() => router.refresh()}
            className="eu-press flex h-9 w-9 items-center justify-center rounded-control border border-line-strong text-ink-2 hover:bg-subtle"
          >
            <Icon name="refresh" size={15} />
          </button>
        </div>
      </header>

      {!analyticsEnabled && (
        <Banner tone="state" icon="info">
          Analytics are on the Indie plan and above — you are on {planName}. The
          counts below are live; segments and trends unlock with an upgrade.{" "}
          <Link href="/billing" className="font-medium underline">
            See plans
          </Link>
        </Banner>
      )}

      <section
        aria-label="Totals"
        className="grid grid-cols-2 rounded-card border border-line md:grid-cols-3 lg:grid-cols-6"
      >
        {kpiTiles.map((k, i) => (
          <div
            key={k.label}
            className={cx(
              "flex flex-col gap-[6px] px-4 py-4",
              i < kpiTiles.length - 1 && "border-b border-r border-line lg:border-b-0",
            )}
          >
            <span className="text-[12.5px] text-ink-2">{k.label}</span>
            <CountUp
              value={k.raw}
              format={k.format}
              metric={`insights-kpi-${k.label}`}
              className="text-[26px] font-semibold tracking-[-0.02em]"
            />
            <span
              className={cx(
                "text-[11.5px]",
                k.tone === "ok" ? "text-ok" : "text-ink-3",
              )}
            >
              {k.delta}
            </span>
          </div>
        ))}
      </section>

      {/* The chart */}
      <Card className="flex flex-col gap-4 p-[18px]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-2">
            <SectionTitle id="chart-title">
              {prior === 0
                ? `${totals.votes} votes in the last ${days} days`
                : lift >= 1
                  ? `Votes are up ${lift.toFixed(1)}× in the second half of the period`
                  : `Votes are down ${(1 / lift).toFixed(1)}× in the second half of the period`}
            </SectionTitle>
            <div className="flex flex-wrap gap-4 text-[12px] text-ink-2">
              <span className="flex items-center gap-[6px]">
                <span className="h-[8px] w-[8px] rounded-[2px] bg-state-bright" />
                Votes per day
              </span>
              <span className="flex items-center gap-[6px]">
                <span className="h-[8px] w-[8px] rounded-[2px] bg-ai-bright" />
                New posts per day
              </span>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <div
            aria-hidden="true"
            className="flex h-[238px] w-10 shrink-0 flex-col justify-between text-right text-[11px] text-ink-3"
          >
            {chart.ticks.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>

          <div className="relative min-w-0 flex-1">
            <svg
              ref={chartRef}
              viewBox="0 0 1000 238"
              preserveAspectRatio="none"
              width="100%"
              height={238}
              role="img"
              aria-label={chart.label}
              onMouseLeave={() => setHover(null)}
            >
              <path
                d="M0 8H1000M0 65H1000M0 122H1000M0 179H1000"
                fill="none"
                stroke="#F1F1EF"
              />
              <path d="M0 236H1000" fill="none" stroke="#E7E7E4" />

              {/*
                The bars grow up out of the baseline, 20ms apart, the first
                time the chart is on screen. After that they are simply there:
                a chart that redraws every time you glance at it is a tic.
              */}
              {chart.bars.map((bar, i) => (
                <m.rect
                  key={bar.key}
                  x={bar.x}
                  y={236 - bar.height}
                  width={bar.width}
                  height={bar.height}
                  fill="#EC4899"
                  fillOpacity={0.5}
                  style={{ transformOrigin: "center bottom", transformBox: "fill-box" }}
                  initial={drawIn ? { scaleY: 0 } : false}
                  animate={{ scaleY: 1 }}
                  transition={{
                    duration: dur.moderate,
                    ease: ease.out,
                    delay: i * barStagger,
                  }}
                />
              ))}

              <m.path
                d={chart.area}
                fill="#1A8CFF"
                fillOpacity={0.12}
                initial={drawIn ? { opacity: 0 } : false}
                animate={{ opacity: 1 }}
                transition={{ duration: dur.data, ease: ease.out }}
              />

              {/*
                The line draws itself left to right by unwinding its own dash:
                stroke-dashoffset is one of the few properties the spec lets us
                animate, and it is the only honest way to draw a line on.
              */}
              <m.polyline
                points={chart.line}
                fill="none"
                stroke="#1A8CFF"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={drawIn ? { pathLength: 0 } : false}
                animate={{ pathLength: 1 }}
                transition={{ duration: dur.data, ease: ease.out }}
              />
              {hover !== null && chart.points[hover] && (
                <>
                  <line
                    x1={chart.points[hover].x}
                    x2={chart.points[hover].x}
                    y1={0}
                    y2={236}
                    stroke="#D6D6D2"
                  />
                  <circle
                    cx={chart.points[hover].x}
                    cy={chart.points[hover].y}
                    r={4}
                    fill="#1A8CFF"
                  />
                </>
              )}
              {/* Invisible hit areas, one per day. */}
              {chart.points.map((p, i) => (
                <rect
                  key={i}
                  x={p.x - chart.step / 2}
                  y={0}
                  width={chart.step}
                  height={238}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                />
              ))}
            </svg>

            {hover !== null && series[hover] && (
              <div
                className="pointer-events-none absolute top-2 flex flex-col gap-1 rounded-control border border-line bg-canvas px-3 py-2 shadow-overlay"
                style={{
                  left: `clamp(0px, ${(chart.points[hover].x / 1000) * 100}% - 60px, calc(100% - 140px))`,
                }}
              >
                <span className="text-[11.5px] text-ink-3">
                  {shortDate(series[hover].day)}
                </span>
                <span className="flex items-center gap-2 text-[12px]">
                  <span className="h-[8px] w-[8px] rounded-[2px] bg-state-bright" />
                  Votes
                  <span className="tnum ml-auto font-semibold">{series[hover].votes}</span>
                </span>
                <span className="flex items-center gap-2 text-[12px]">
                  <span className="h-[8px] w-[8px] rounded-[2px] bg-ai-bright" />
                  New posts
                  <span className="tnum ml-auto font-semibold">{series[hover].posts}</span>
                </span>
              </div>
            )}

            <FadeRise
              key={days}
              aria-hidden="true"
              className="mt-2 flex justify-between text-[11px] text-ink-3"
            >
              {chart.xLabels.map((l) => (
                <span key={l}>{l}</span>
              ))}
            </FadeRise>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Votes by plan */}
        <Card className="flex flex-col gap-3 p-[18px]">
          <SectionTitle id="plan-title">Votes by plan</SectionTitle>
          <p className="-mt-2 text-[12.5px] text-ink-3">
            {identityMode === "jwt"
              ? "From the signed user data your app sends."
              : "Pass a signed JWT from your app to split votes by plan exactly."}
          </p>
          {plans.length === 0 ? (
            <p className="py-4 text-[13px] text-ink-3">No votes recorded yet.</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[12px] text-ink-2">
                  <th scope="col" className="pb-2 font-medium">Plan</th>
                  <th scope="col" className="pb-2 font-medium">Share</th>
                  <th scope="col" className="pb-2 text-right font-medium">Votes</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p, i) => (
                  <tr key={p.plan} className="border-t border-hairline">
                    <td className="py-[10px]">{p.plan}</td>
                    <td className="py-[10px]">
                      <span className="flex items-center gap-2">
                        <span className="block w-20">
                          <Meter
                            value={p.votes}
                            max={totalPlanVotes || 1}
                            color={PLAN_COLOR[i % PLAN_COLOR.length]}
                          />
                        </span>
                        <span className="tnum text-[12px] text-ink-2">
                          {totalPlanVotes
                            ? Math.round((p.votes / totalPlanVotes) * 100)
                            : 0}
                          %
                        </span>
                      </span>
                    </td>
                    <td className="tnum py-[10px] text-right">{p.votes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* Where posts come from */}
        <Card className="flex flex-col gap-3 p-[18px]">
          <SectionTitle id="src-title">Where posts come from</SectionTitle>
          <p className="-mt-2 text-[12.5px] text-ink-3">
            Embedded widget, hosted page, or added by you.
          </p>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[12px] text-ink-2">
                <th scope="col" className="pb-2 font-medium">Source</th>
                <th scope="col" className="pb-2 font-medium">Share</th>
                <th scope="col" className="pb-2 text-right font-medium">Posts</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: "Widget, signed-in users", n: sources.widget },
                { label: "Widget or hosted page", n: sources.hosted },
                { label: "Added by you", n: sources.founder },
              ].map((row) => (
                <tr key={row.label} className="border-t border-hairline">
                  <td className="py-[10px]">{row.label}</td>
                  <td className="tnum py-[10px]">
                    {totalSources ? Math.round((row.n / totalSources) * 100) : 0}%
                  </td>
                  <td className="tnum py-[10px] text-right">{row.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* Status funnel */}
        <Card className="flex flex-col gap-3 p-[18px]">
          <SectionTitle id="funnel-title">Status funnel</SectionTitle>
          <p className="-mt-2 text-[12.5px] text-ink-3">
            {statusCounts.all} post{statusCounts.all === 1 ? "" : "s"} from submitted to
            shipped.
          </p>
          <div className="flex flex-col gap-[10px]">
            {POST_STATUSES.map((s) => (
              <Link
                key={s}
                href={`/feedback?status=${s}`}
                className="flex items-center gap-3 text-ink no-underline"
              >
                <span
                  className="h-[8px] w-[8px] shrink-0 rounded-full"
                  style={{ background: STATUS_LOOK[s].dot }}
                />
                <span className="flex-1 text-[13px]">{STATUS_LABEL[s]}</span>
                <span className="block w-24">
                  <Meter
                    value={statusCounts[s]}
                    max={statusCounts.all || 1}
                    color={STATUS_LOOK[s].dot}
                  />
                </span>
                <span className="w-8 text-right text-[13px] font-medium">
                  <AnimatedNumber value={statusCounts[s]} />
                </span>
              </Link>
            ))}
          </div>
        </Card>

        {/* Build Prompts by tool */}
        <Card className="flex flex-col gap-3 p-[18px]">
          <SectionTitle id="bp-usage-title">Build Prompts by tool</SectionTitle>
          <p className="-mt-2 text-[12.5px] text-ink-3">
            {generated} generated, {copied} copied into a tool.
          </p>
          {promptsByTool.length === 0 ? (
            <p className="py-4 text-[13px] text-ink-3">
              No Build Prompts generated yet.{" "}
              <Link href="/prompts" className="font-medium text-ai">
                Generate one
              </Link>
            </p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[12px] text-ink-2">
                  <th scope="col" className="pb-2 font-medium">Tool</th>
                  <th scope="col" className="pb-2 text-right font-medium">Generated</th>
                  <th scope="col" className="pb-2 text-right font-medium">Copied</th>
                  <th scope="col" className="pb-2 text-right font-medium">Shipped</th>
                </tr>
              </thead>
              <tbody>
                {promptsByTool
                  .sort((a, b) => b.generated - a.generated)
                  .map((t) => (
                    <tr key={t.target} className="border-t border-hairline">
                      <td className="py-[10px]">{targetSpec(t.target).label}</td>
                      <td className="tnum py-[10px] text-right">{t.generated}</td>
                      <td className="tnum py-[10px] text-right">{t.copied}</td>
                      <td className="tnum py-[10px] text-right">{t.shipped}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}

/**
 * Builds the dual-series chart: a filled line for votes and bars for new
 * posts, on the design's 1000×238 viewBox.
 */
function buildChart(series: DailyPoint[]) {
  const n = Math.max(1, series.length);
  const maxVotes = Math.max(10, ...series.map((d) => d.votes));
  const maxPosts = Math.max(5, ...series.map((d) => d.posts));
  const headroom = Math.ceil(maxVotes / 30) * 30;

  const step = n > 1 ? (1000 - 24) / (n - 1) : 0;
  const x = (i: number) => 12 + i * step;
  const yVotes = (v: number) => 236 - (v / headroom) * 228;
  const hPosts = (p: number) => (p / maxPosts) * 150;

  const points = series.map((d, i) => ({ x: x(i), y: yVotes(d.votes) }));
  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area =
    points.length > 0
      ? `M${x(0).toFixed(1)} 236 L${points
          .map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
          .join(" L")} L${x(n - 1).toFixed(1)} 236 Z`
      : "";

  // One rect per bar rather than a single path: each has to be able to grow
  // from the baseline on its own, 20ms behind the one to its left.
  const barWidth = Math.max(3, Math.min(18, step * 0.55));
  const bars = series
    .map((d, i) => ({
      key: d.day,
      x: x(i) - barWidth / 2,
      width: barWidth,
      height: hPosts(d.posts),
    }))
    .filter((bar) => bar.height > 0);

  const ticks = [headroom, Math.round(headroom * 0.75), Math.round(headroom * 0.5), Math.round(headroom * 0.25), 0].map(
    String,
  );

  // Eight evenly spaced date labels, or one per point when there are fewer.
  const stride = Math.max(1, Math.ceil(n / 8));
  const xLabels = series.filter((_, i) => i % stride === 0).map((d) => shortDate(d.day));

  const first = series[0];
  const last = series[series.length - 1];
  const label = first
    ? `Votes per day went from ${first.votes} to ${last.votes} between ${shortDate(
        first.day,
      )} and ${shortDate(last.day)}; new posts per day from ${first.posts} to ${last.posts}.`
    : "No data in this period.";

  return { line, area, bars, ticks, xLabels, points, step: step || 1000, label };
}
