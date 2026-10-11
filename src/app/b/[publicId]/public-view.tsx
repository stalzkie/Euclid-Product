"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon, Logo } from "@/components/icons";
import { cx } from "@/components/ui";
import { resolveTheme } from "@/lib/design-presets";
import { longDate } from "@/lib/format";
import { STATUS_LABEL, type BoardDesign, type IdentityMode } from "@/lib/types";
import type { WidgetChangelog, WidgetPost } from "@/components/board-widget";
import { SubmitPanel } from "./submit-panel";

type Tab = "ideas" | "roadmap" | "changelog";

const COLUMN_DOT: Record<"planned" | "in_progress" | "shipped", string> = {
  planned: "#1A8CFF",
  in_progress: "#F59E0B",
  shipped: "#16A34A",
};

/**
 * 16 · The hosted public board. Same data as the widget, laid out for a full
 * page so it can be shared in a newsletter or on X.
 */
export function PublicBoardView({
  publicId,
  appName,
  appUrl,
  design,
  showBadge,
  categories,
  identityMode,
  viewerLabel,
  posts: initialPosts,
  changelog,
  initialTab,
  justVerified,
}: {
  publicId: string;
  appName: string;
  appUrl: string | null;
  design: BoardDesign;
  showBadge: boolean;
  categories: string[];
  identityMode: IdentityMode;
  viewerLabel: string | null;
  posts: WidgetPost[];
  changelog: WidgetChangelog[];
  initialTab: Tab;
  justVerified: boolean;
}) {
  const t = resolveTheme(design);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [posts, setPosts] = useState(initialPosts);
  const [submitOpen, setSubmitOpen] = useState(false);

  const vote = async (postId: string) => {
    const before = posts;
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId
          ? { ...p, voted: !p.voted, votes: p.votes + (p.voted ? -1 : 1) }
          : p,
      ),
    );
    const res = await fetch("/api/public/vote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ board: publicId, postId }),
    });
    if (!res.ok) setPosts(before);
    else {
      const json = (await res.json()) as { voted: boolean; votes: number };
      setPosts((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, voted: json.voted, votes: json.votes } : p)),
      );
    }
  };

  const columns = (["planned", "in_progress", "shipped"] as const).map((status) => ({
    status,
    name: STATUS_LABEL[status],
    cards: posts.filter((p) => p.status === status),
  }));

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "ideas", label: "Ideas", show: true },
    { id: "roadmap", label: "Roadmap", show: design.showRoadmap },
    { id: "changelog", label: "Changelog", show: design.showChangelog },
  ];

  const card = (post: WidgetPost) => (
    <article
      key={post.id}
      className="flex items-start gap-3 rounded-card border p-3"
      style={{ borderColor: t.border, background: t.card }}
    >
      <button
        type="button"
        aria-pressed={post.voted}
        aria-label={`Vote for ${post.title}`}
        onClick={() => void vote(post.id)}
        className="flex h-11 w-10 shrink-0 flex-col items-center justify-center gap-[1px] rounded-chip border text-[12.5px] font-semibold"
        style={{
          borderColor: post.voted ? t.accent : t.border,
          background: post.voted ? t.accent : "transparent",
          color: post.voted ? t.onAccent : t.fg,
        }}
      >
        <Icon name="caretUp" size={12} strokeWidth={2.4} />
        {design.showVoteCounts && <span className="tnum">{post.votes}</span>}
      </button>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[13.5px] font-medium" style={{ color: t.fg }}>
          {post.title}
        </span>
        <span className="text-[12px]" style={{ color: t.sub }}>
          {design.showStatuses && STATUS_LABEL[post.status]}
          {design.showStatuses && design.showComments && " · "}
          {design.showComments &&
            `${post.comments} comment${post.comments === 1 ? "" : "s"}`}
        </span>
      </span>
    </article>
  );

  return (
    <div className="min-h-screen" style={{ background: t.bg, color: t.fg }}>
      {/* Header */}
      <header className="border-b" style={{ borderColor: t.border }}>
        <div className="mx-auto flex max-w-[1080px] flex-wrap items-center justify-between gap-3 px-6 py-4">
          <span className="flex items-center gap-2">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-chip text-[13px] font-semibold"
              style={{ background: t.accent, color: t.onAccent }}
            >
              {appName.slice(0, 1).toUpperCase()}
            </span>
            <span className="text-[15px] font-semibold">{appName}</span>
            <span className="text-[13px]" style={{ color: t.sub }}>
              Feedback
            </span>
          </span>
          <span className="flex items-center gap-4 text-[13px]">
            {appUrl && (
              <a
                href={appUrl}
                className="no-underline hover:underline"
                style={{ color: t.sub }}
              >
                Back to {appName}
              </a>
            )}
          </span>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1080px] flex-col gap-6 px-6 py-10">
        {justVerified && (
          <div
            role="status"
            className="rounded-control border px-4 py-3 text-[13px]"
            style={{ borderColor: "#BBF7D0", background: "#ECFDF3", color: "#15803D" }}
          >
            Email confirmed. Your votes and posts are tied to it now, and we will email
            you when something you voted for ships.
          </div>
        )}

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-[28px] font-semibold leading-[1.2] tracking-[-0.02em]">
              {design.heading}
            </h1>
            <p className="max-w-[620px] text-[14px] leading-[1.6]" style={{ color: t.sub }}>
              {design.subheading}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setTab("ideas");
              setSubmitOpen(true);
            }}
            className="flex h-10 items-center gap-2 rounded-control px-4 text-[13.5px] font-medium"
            style={{ background: t.accent, color: t.onAccent }}
          >
            <Icon name="plus" size={15} strokeWidth={2} />
            {design.submitCta}
          </button>
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          aria-label="Board"
          className="flex gap-5 border-b"
          style={{ borderColor: t.border }}
        >
          {tabs
            .filter((x) => x.show)
            .map((x) => {
              const on = x.id === tab;
              return (
                <button
                  key={x.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setTab(x.id)}
                  className="-mb-px border-b-2 pb-[10px] text-[13.5px] font-medium"
                  style={{
                    borderColor: on ? t.accent : "transparent",
                    color: on ? t.fg : t.sub,
                  }}
                >
                  {x.label}
                </button>
              );
            })}
        </div>

        {/* Ideas */}
        {tab === "ideas" && (
          <div className="flex flex-wrap items-start gap-6">
            <div className="flex min-w-0 flex-[999_1_420px] flex-col gap-3">
              {posts.length === 0 ? (
                <p className="py-8 text-[13.5px]" style={{ color: t.sub }}>
                  Nothing suggested yet. Yours would be the first.
                </p>
              ) : (
                posts.map(card)
              )}
            </div>
            <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-3">
              <SubmitPanel
                publicId={publicId}
                appName={appName}
                design={design}
                categories={categories}
                identityMode={identityMode}
                viewerLabel={viewerLabel}
                open={submitOpen}
                onPosted={(post) => setPosts((prev) => [post, ...prev])}
              />
            </aside>
          </div>
        )}

        {/* Roadmap */}
        {tab === "roadmap" && (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {columns.map((col) => (
              <section key={col.status} className="flex flex-col gap-3">
                <h2 className="flex items-center gap-2 text-[13px] font-semibold">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: COLUMN_DOT[col.status] }}
                  />
                  {col.name}
                  <span className="tnum text-[12px] font-normal" style={{ color: t.sub }}>
                    {col.cards.length}
                  </span>
                </h2>
                {col.cards.length === 0 ? (
                  <p className="text-[12.5px]" style={{ color: t.sub }}>
                    Nothing here yet.
                  </p>
                ) : (
                  col.cards.map(card)
                )}
              </section>
            ))}
          </div>
        )}

        {/* Changelog */}
        {tab === "changelog" && (
          <div className="flex flex-col gap-8">
            {changelog.length === 0 ? (
              <p className="py-8 text-[13.5px]" style={{ color: t.sub }}>
                Nothing shipped yet.
              </p>
            ) : (
              changelog.map((entry) => (
                <article key={entry.id} className="flex flex-wrap gap-6">
                  <span
                    className="w-[120px] shrink-0 pt-1 text-[12.5px]"
                    style={{ color: t.sub }}
                  >
                    {entry.publishedAt ? longDate(entry.publishedAt) : "Draft"}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <h2 className="text-[18px] font-semibold tracking-[-0.01em]">
                      {entry.title}
                    </h2>
                    <p
                      className="whitespace-pre-wrap text-[14px] leading-[1.65]"
                      style={{ color: t.sub }}
                    >
                      {entry.body}
                    </p>
                  </div>
                </article>
              ))
            )}
          </div>
        )}
      </main>

      {showBadge && (
        <footer
          className="border-t py-6 text-center"
          style={{ borderColor: t.border }}
        >
          <Link
            href="/"
            className={cx(
              "inline-flex items-center gap-2 text-[12px] no-underline",
            )}
            style={{ color: t.sub }}
          >
            <Logo size={16} />
            Powered by Euclid
          </Link>
        </footer>
      )}
    </div>
  );
}
