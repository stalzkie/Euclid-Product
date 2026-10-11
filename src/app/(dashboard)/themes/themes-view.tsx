"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
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

      {message && (
        <Banner tone={failed ? "warn" : "ok"} icon={failed ? "warn" : "check"}>
          {message}
        </Banner>
      )}

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
                  "h-8 rounded-control border px-3 text-[12.5px] font-medium",
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
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {sorted.map((t) => {
            const rising = t.id === fastest && t.growth > 0;
            return (
              <article
                key={t.id}
                id={t.id}
                className={cx(
                  "flex flex-col gap-3 rounded-[14px] border p-[18px]",
                  rising ? "border-ai-line" : "border-line",
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
                          className="min-w-0 flex-1 truncate text-[13px] text-ink-body no-underline hover:text-ink hover:underline"
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
              </article>
            );
          })}
        </div>
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
