"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { m } from "motion/react";
import {
  Banner,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Sparkline,
  cx,
} from "@/components/ui";
import { Spinner } from "@/components/controls";
import { ago, signedPct } from "@/lib/format";
import { Collapse, Shimmer, Stagger } from "@/components/motion";
import { spring } from "@/lib/motion/tokens";
import { recluster } from "./actions";

export interface ThemeCard {
  id: string;
  name: string;
  summary: string | null;
  votes: number;
  posts: number;
  payingShare: number;
  growth: number;
  trend: number[];
  top: { number: number; title: string; votes: number }[];
  updatedAt: string;
}

type Sort = "votes" | "rising" | "paying";

const SORTS: { value: Sort; label: string }[] = [
  { value: "votes", label: "Most votes" },
  { value: "rising", label: "Fastest rising" },
  { value: "paying", label: "Most paying" },
];

export function ThemesView({
  themes,
  postCount,
  aiReady,
}: {
  themes: ThemeCard[];
  postCount: number;
  aiReady: boolean;
}) {
  const router = useRouter();
  const [sort, setSort] = useState<Sort>("votes");
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  const sorted = useMemo(() => {
    const list = [...themes];
    if (sort === "votes") list.sort((a, b) => b.votes - a.votes);
    if (sort === "rising") list.sort((a, b) => b.growth - a.growth);
    if (sort === "paying") list.sort((a, b) => b.payingShare - a.payingShare);
    return list;
  }, [themes, sort]);

  /*
    A re-cluster returns the new clustering, not a diff, so the only way to
    know which themes changed is to remember what was on screen and compare.
    Derived from props rather than tracked in an effect: it is rendering
    state, and it has to be right on the render that first shows the new data.
  */
  const fingerprints = useMemo(() => fingerprintThemes(themes), [themes]);
  const signature = useMemo(() => JSON.stringify(fingerprints), [fingerprints]);

  const [tracked, setTracked] = useState(() => ({
    signature,
    fingerprints,
    changed: new Set<string>(),
  }));

  if (tracked.signature !== signature) {
    setTracked({
      signature,
      fingerprints,
      changed: changedThemeIds(tracked.fingerprints, fingerprints),
    });
  }

  const changed = tracked.signature === signature ? tracked.changed : new Set<string>();

  const fastest = useMemo(
    () => [...themes].sort((a, b) => b.growth - a.growth)[0]?.id,
    [themes],
  );

  const lastUpdated = themes.reduce<string | null>(
    (latest, t) => (!latest || t.updatedAt > latest ? t.updatedAt : latest),
    null,
  );

  const run = () =>
    start(async () => {
      setMessage(null);
      const res = await recluster();
      setFailed(!res.ok);
      setMessage(
        res.ok
          ? `Re-clustered into ${res.themes} theme${res.themes === 1 ? "" : "s"}.`
          : res.error,
      );
      if (res.ok) router.refresh();
    });

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] font-semibold tracking-[-0.015em]">Themes</h1>
          <p className="text-[14px] text-ink-2">
            Euclid groups posts by meaning, not keywords.{" "}
            {themes.length > 0
              ? `${postCount} posts became ${themes.length} theme${
                  themes.length === 1 ? "" : "s"
                }.`
              : "Nothing is clustered yet."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-[12px] text-ink-3">Updated {ago(lastUpdated)}</span>
          )}
          <Button icon="refresh" onClick={run} disabled={pending || !aiReady}>
            {pending ? <Spinner /> : null}
            Re-cluster
          </Button>
        </div>
      </header>

      {/* The one loop allowed here, and only while the model is working. */}
      {pending && <Shimmer label="Re-clustering this board" />}

      <Collapse open={Boolean(message)}>
        <Banner tone={failed ? "warn" : "ok"} icon={failed ? "warn" : "check"}>
          {message}
        </Banner>
      </Collapse>

      {themes.length > 0 && (
        <div role="radiogroup" aria-label="Sort themes" className="flex flex-wrap gap-2">
          {SORTS.map((s) => {
            const on = s.value === sort;
            return (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setSort(s.value)}
                className={cx(
                  "eu-press h-8 rounded-control border px-3 text-[12.5px] font-medium",
                  on
                    ? "border-ink bg-ink text-white"
                    : "border-line-strong bg-canvas text-ink hover:bg-subtle",
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      )}

      {themes.length === 0 ? (
        <Card>
          <EmptyState
            icon="themes"
            title="No themes yet"
            body="Once a board has a couple of dozen posts, Euclid clusters them by meaning and names each group, so hundreds of scattered requests become a short list."
            action={
              <Button icon="refresh" onClick={run} disabled={pending || !aiReady}>
                Cluster now
              </Button>
            }
          />
        </Card>
      ) : (
        <Stagger className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {sorted.map((t) => {
            const rising = t.id === fastest && t.growth > 0;
            return (
              /*
                `layout` moves a card to its new place when the sort changes,
                rather than the grid re-flowing underneath it. The flash is
                one-shot and only on the themes a re-cluster actually touched:
                flashing all of them would say nothing.
              */
              <m.article
                key={t.id}
                id={t.id}
                layout
                transition={spring.smooth}
                className={cx(
                  "flex flex-col gap-3 rounded-[14px] border p-[18px]",
                  rising ? "border-ai-line" : "border-line",
                  changed.has(t.id) && "eu-flash-border",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[16px] font-semibold tracking-[-0.01em]">{t.name}</h2>
                  {rising && (
                    <span className="rounded-full bg-ai-wash px-[9px] py-[3px] text-[11.5px] font-semibold text-ai-deep">
                      Rising fastest
                    </span>
                  )}
                </div>

                {t.summary && (
                  <p className="text-[13.5px] leading-[1.5] text-ink-2">{t.summary}</p>
                )}

                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="flex gap-5">
                    <span className="flex flex-col">
                      <span className="tnum text-[22px] font-semibold tracking-[-0.02em]">
                        {t.votes}
                      </span>
                      <span className="text-[12px] text-ink-3">votes</span>
                    </span>
                    <span className="flex flex-col">
                      <span className="tnum text-[22px] font-semibold tracking-[-0.02em]">
                        {t.posts}
                      </span>
                      <span className="text-[12px] text-ink-3">posts</span>
                    </span>
                    <span className="flex flex-col">
                      <span className="tnum text-[22px] font-semibold tracking-[-0.02em]">
                        {t.payingShare}%
                      </span>
                      <span className="text-[12px] text-ink-3">paying</span>
                    </span>
                  </div>
                  <span className="flex items-center gap-2">
                    <Sparkline
                      points={t.trend}
                      width={88}
                      height={26}
                      color={t.growth < 0 ? "#DC2626" : "#15803D"}
                    />
                    <span
                      className={cx(
                        "text-[12px] font-medium",
                        t.growth < 0 ? "text-bad" : "text-ok",
                      )}
                    >
                      {signedPct(t.growth)} in 7 weeks
                    </span>
                  </span>
                </div>

                {t.top.length > 0 && (
                  <ul className="flex flex-col gap-[6px] border-t border-hairline pt-3">
                    {t.top.map((p) => (
                      <li key={p.number} className="flex items-center gap-3">
                        <span className="tnum w-9 shrink-0 text-right text-[12.5px] font-semibold text-ink-2">
                          {p.votes}
                        </span>
                        <Link
                          href={`/posts/${p.number}`}
                          className="eu-colors min-w-0 flex-1 truncate text-[13px] text-ink-body no-underline hover:text-ink hover:underline"
                        >
                          {p.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex gap-2">
                  <ButtonLink href={`/feedback?theme=${t.id}`} className="flex-1">
                    View {t.posts} post{t.posts === 1 ? "" : "s"}
                  </ButtonLink>
                  <ButtonLink
                    href={`/prompts/new?theme=${t.id}`}
                    variant="ai"
                    icon="sparkle"
                  >
                    Build Prompt
                  </ButtonLink>
                </div>
              </m.article>
            );
          })}
        </Stagger>
      )}

      {!aiReady && (
        <Banner tone="warn" icon="warn">
          Clustering needs an Anthropic key to name the groups. Set{" "}
          <code className="font-mono text-[12.5px]">ANTHROPIC_API_KEY</code> to switch it on.
        </Banner>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A fingerprint per theme: how many posts it holds and which ones lead it.
 * Enough to notice that a re-cluster moved things around, and cheap enough to
 * compute on every render.
 */
function fingerprintThemes(themes: ThemeCard[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const theme of themes) {
    out[theme.id] = `${theme.posts}:${theme.top.map((p) => p.number).join(",")}`;
  }
  return out;
}

/**
 * Which themes changed between two clusterings.
 *
 * A theme that did not exist before is not a change — on a board's first
 * clustering every card would flash, which would tell the founder nothing.
 */
function changedThemeIds(
  before: Record<string, string>,
  after: Record<string, string>,
): Set<string> {
  const changed = new Set<string>();
  for (const [id, fingerprint] of Object.entries(after)) {
    const was = before[id];
    if (was !== undefined && was !== fingerprint) changed.add(id);
  }
  return changed;
}
