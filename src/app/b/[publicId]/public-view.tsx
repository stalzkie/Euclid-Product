"use client";

import Link from "next/link";
import { AnimatePresence, m } from "motion/react";
import { useId, useState } from "react";
import { Icon, Logo } from "@/components/icons";
import { cx } from "@/components/ui";
import { AnimatedNumber, Stagger, useToast } from "@/components/motion";
import { dur, ease, spring } from "@/lib/motion/tokens";
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
  const toast = useToast();
  const tabUnderline = useId();
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
    if (!res.ok) {
      // Roll the digits back the way they came, and say why.
      setPosts(before);
      toast("That vote did not go through. Try again.", { tone: "bad" });
    } else {
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
    <PostCard
      key={post.id}
      post={post}
      theme={t}
      design={design}
      onVote={() => void vote(post.id)}
    />
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
                  className="eu-colors relative -mb-px pb-[10px] text-[13.5px] font-medium"
                  style={{ color: on ? t.fg : t.sub }}
                >
                  {x.label}
                  {on && (
                    <m.span
                      layoutId={tabUnderline}
                      transition={spring.snappy}
                      className="absolute -bottom-px left-0 right-0 h-[2px]"
                      style={{ background: t.accent }}
                    />
                  )}
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
                <AnimatePresence initial={false}>{posts.map(card)}</AnimatePresence>
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
                  <Stagger className="flex flex-col gap-3">{col.cards.map(card)}</Stagger>
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
            <Logo size={16} variant={design.theme === "Dark" ? "dark" : "light"} />
            Powered by Euclid
          </Link>
        </footer>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * One idea, on the board's own theme.
 *
 * The vote is the signature interaction, so it gets the full sequence: the
 * press scales the button, the chevron hops three pixels and settles, the fill
 * crossfades to the board's accent and the count rolls up — all before the
 * request comes back, because a vote that waits does not feel like a vote.
 *
 * `layoutId` is what lets a card move between roadmap columns when its status
 * changes, rather than vanishing from one and appearing in the next.
 */
function PostCard({
  post,
  theme,
  design,
  onVote,
}: {
  post: WidgetPost;
  theme: ReturnType<typeof resolveTheme>;
  design: BoardDesign;
  onVote: () => void;
}) {
  const [hop, setHop] = useState(0);

  return (
    <m.article
      layout
      layoutId={post.id}
      transition={spring.smooth}
      initial={{ opacity: 0, y: "var(--eu-rise-sm)" }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: dur.fast, ease: ease.in } }}
      className="flex items-start gap-3 rounded-card border p-3"
      style={{ borderColor: theme.border, background: theme.card }}
    >
      <button
        type="button"
        aria-pressed={post.voted}
        aria-label={`Vote for ${post.title}`}
        onClick={() => {
          if (!post.voted) setHop((n) => n + 1);
          onVote();
        }}
        className={cx(
          "eu-press flex h-11 w-10 shrink-0 flex-col items-center justify-center gap-[1px]",
          "rounded-chip border text-[12.5px] font-semibold",
          "active:scale-[var(--eu-vote-scale)]",
        )}
        style={{
          borderColor: post.voted ? theme.accent : theme.border,
          background: post.voted ? theme.accent : "transparent",
          color: post.voted ? theme.onAccent : theme.fg,
        }}
      >
        <m.span
          key={hop}
          initial={hop === 0 ? false : { y: 0 }}
          animate={hop === 0 ? undefined : { y: ["0px", "var(--eu-hop)", "0px"] }}
          transition={{ duration: dur.hop, ease: ease.out, times: [0, 0.45, 1] }}
          className="block"
        >
          <Icon name="caretUp" size={12} strokeWidth={2.4} />
        </m.span>
        {design.showVoteCounts && <AnimatedNumber value={post.votes} live />}
      </button>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[13.5px] font-medium" style={{ color: theme.fg }}>
          {post.title}
        </span>
        <span className="text-[12px]" style={{ color: theme.sub }}>
          {design.showStatuses && STATUS_LABEL[post.status]}
          {design.showStatuses && design.showComments && " · "}
          {design.showComments &&
            `${post.comments} comment${post.comments === 1 ? "" : "s"}`}
        </span>
      </span>
    </m.article>
  );
}
