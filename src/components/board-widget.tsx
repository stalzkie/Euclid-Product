"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons";
import { resolveTheme } from "@/lib/design-presets";
import { STATUS_LABEL, type BoardDesign, type PostStatus } from "@/lib/types";

/**
 * The board itself, as end users see it. One component serves three surfaces —
 * the designer's live preview, the embedded widget, and the hosted page — so
 * what the founder designs is literally what ships.
 *
 * Styling is inline rather than Tailwind on purpose: this subtree renders
 * inside a Shadow DOM in the embed, where the host page's stylesheet (and
 * ours) does not reach.
 */

export interface WidgetPost {
  id: string;
  number: number;
  title: string;
  body?: string | null;
  status: PostStatus;
  votes: number;
  comments: number;
  voted: boolean;
}

export interface WidgetChangelog {
  id: string;
  title: string;
  body: string;
  publishedAt: string | null;
}

export type WidgetTab = "ideas" | "roadmap" | "changelog";

export interface BoardWidgetProps {
  design: BoardDesign;
  boardName: string;
  posts: WidgetPost[];
  changelog?: WidgetChangelog[];
  identityLabel?: string | null;
  showBadge: boolean;
  /** Preview mode disables every write and the similar-posts lookup. */
  preview?: boolean;
  width?: string;
  onVote?: (postId: string) => Promise<void> | void;
  onSubmit?: (input: { title: string; body: string }) => Promise<
    { ok: true; number: number } | { ok: false; error: string }
  >;
  /**
   * Live duplicate lookup while the submitter types. Called twice per pause:
   * once for the instant keyword pass, once for the slower semantic one.
   */
  onSearchSimilar?: (
    title: string,
    mode: "fast" | "semantic",
  ) => Promise<WidgetPost[]>;
  onOpenPost?: (post: WidgetPost) => void;
}

const STATUS_TINT: Record<PostStatus, string> = {
  under_review: "#737379",
  planned: "#1A8CFF",
  in_progress: "#F59E0B",
  shipped: "#16A34A",
  declined: "#DC2626",
};

export function BoardWidget({
  design,
  boardName,
  posts,
  changelog = [],
  identityLabel,
  showBadge,
  preview = false,
  width,
  onVote,
  onSubmit,
  onSearchSimilar,
  onOpenPost,
}: BoardWidgetProps) {
  const t = resolveTheme(design);
  const [tab, setTab] = useState<WidgetTab>("ideas");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [similar, setSimilar] = useState<WidgetPost[]>([]);
  const [votes, setVotes] = useState<Record<string, boolean>>(
    Object.fromEntries(posts.map((p) => [p.id, p.voted])),
  );
  const [bumps, setBumps] = useState<Record<string, number>>({});
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Nudge the submitter toward an existing post while they type.
  //
  // The keyword pass answers in milliseconds and goes up straight away; the
  // semantic pass needs an embeddings round-trip and replaces it when it
  // lands. Waiting only for the good answer means the suggestion arrives
  // after the person has already posted.
  useEffect(() => {
    if (preview || !onSearchSimilar) return;
    const query = title.trim();
    if (query.length <= 3) {
      setSimilar([]);
      return;
    }

    let live = true;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      void onSearchSimilar(query, "fast").then((found) => {
        // Never let the fast pass overwrite a semantic result already shown.
        if (live && found.length) setSimilar((prev) => (prev.length ? prev : found));
      });
      void onSearchSimilar(query, "semantic").then((found) => {
        if (live) setSimilar(found);
      });
    }, 300);

    return () => {
      live = false;
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [title, preview, onSearchSimilar]);

  const roadmap = useMemo(
    () => ({
      planned: posts.filter((p) => p.status === "planned"),
      in_progress: posts.filter((p) => p.status === "in_progress"),
      shipped: posts.filter((p) => p.status === "shipped"),
    }),
    [posts],
  );

  const voteFor = async (post: WidgetPost) => {
    if (preview || !onVote) return;
    const on = votes[post.id];
    setVotes((prev) => ({ ...prev, [post.id]: !on }));
    setBumps((prev) => ({ ...prev, [post.id]: (prev[post.id] ?? 0) + (on ? -1 : 1) }));
    try {
      await onVote(post.id);
    } catch {
      // Put the optimistic vote back if the write failed.
      setVotes((prev) => ({ ...prev, [post.id]: on }));
      setBumps((prev) => ({ ...prev, [post.id]: (prev[post.id] ?? 0) + (on ? 1 : -1) }));
    }
  };

  const countFor = (post: WidgetPost) => post.votes + (bumps[post.id] ?? 0);

  const submit = async () => {
    if (preview || !onSubmit || title.trim().length < 3) return;
    setPosting(true);
    setError(null);
    const res = await onSubmit({ title: title.trim(), body: body.trim() });
    setPosting(false);
    if (res.ok) {
      setPosted(res.number);
      setTitle("");
      setBody("");
      setSimilar([]);
      setTimeout(() => setPosted(null), 6000);
    } else {
      setError(res.error);
    }
  };

  const tabs: { id: WidgetTab; label: string; show: boolean }[] = [
    { id: "ideas", label: "Ideas", show: true },
    { id: "roadmap", label: "Roadmap", show: design.showRoadmap },
    { id: "changelog", label: "Changelog", show: design.showChangelog },
  ];

  const row = (post: WidgetPost) => (
    <div
      key={post.id}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 12px",
        borderRadius: t.r8,
        background: "transparent",
        cursor: onOpenPost ? "pointer" : "default",
      }}
      onClick={() => onOpenPost?.(post)}
    >
      <button
        type="button"
        aria-pressed={votes[post.id] ?? false}
        aria-label={`Vote for ${post.title}`}
        onClick={(e) => {
          e.stopPropagation();
          void voteFor(post);
        }}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 1,
          width: 40,
          height: 44,
          flexShrink: 0,
          borderRadius: t.r8,
          border: `1px solid ${votes[post.id] ? t.accent : t.border}`,
          background: votes[post.id] ? t.accent : "transparent",
          color: votes[post.id] ? t.onAccent : t.fg,
          font: "600 12.5px inherit",
          cursor: preview ? "default" : "pointer",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <Icon name="caretUp" size={12} strokeWidth={2.4} />
        {design.showVoteCounts ? countFor(post) : ""}
      </button>
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
        <span
          style={{
            fontSize: 13.5,
            fontWeight: 500,
            color: t.fg,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {post.title}
        </span>
        <span style={{ fontSize: 11.5, color: t.sub }}>
          {design.showStatuses && (
            <span style={{ color: STATUS_TINT[post.status] }}>
              {STATUS_LABEL[post.status]}
            </span>
          )}
          {design.showStatuses && design.showComments && " · "}
          {design.showComments &&
            `${post.comments} comment${post.comments === 1 ? "" : "s"}`}
        </span>
      </span>
    </div>
  );

  return (
    <section
      aria-label={`${boardName} feedback`}
      style={{
        width: width ?? "100%",
        maxWidth: "100%",
        display: "flex",
        flexDirection: "column",
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.border}`,
        borderRadius: t.r16,
        overflow: "hidden",
        fontFamily:
          "'Geist', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
        boxShadow: "0 12px 32px rgba(23,23,26,0.08)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 16px",
          borderBottom: `1px solid ${t.border}`,
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            borderRadius: 6,
            background: t.accent,
            color: t.onAccent,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {boardName.slice(0, 1).toUpperCase()}
        </span>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>
          {design.heading}
        </span>
      </header>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Board sections"
        style={{
          display: "flex",
          gap: 16,
          padding: "0 16px",
          borderBottom: `1px solid ${t.border}`,
        }}
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
                style={{
                  padding: "10px 0",
                  border: 0,
                  borderBottom: `2px solid ${on ? t.accent : "transparent"}`,
                  background: "transparent",
                  color: on ? t.fg : t.sub,
                  font: "500 13px inherit",
                  cursor: "pointer",
                }}
              >
                {x.label}
              </button>
            );
          })}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          padding: 16,
          maxHeight: 520,
          overflowY: "auto",
        }}
      >
        {tab === "ideas" && (
          <>
            {design.subheading && (
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: t.sub }}>
                {design.subheading}
              </p>
            )}

            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, fontWeight: 500 }}>
              Your idea
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`What would make ${boardName} better?`}
                disabled={preview}
                style={{
                  height: 36,
                  padding: "0 10px",
                  borderRadius: t.r8,
                  border: `1px solid ${t.border}`,
                  background: t.card,
                  color: t.fg,
                  font: "400 13.5px inherit",
                  outline: "none",
                }}
              />
            </label>

            {/* Duplicate nudge */}
            {similar.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  padding: 10,
                  borderRadius: t.r10,
                  border: `1px solid ${t.border}`,
                  background: t.hover,
                }}
              >
                <span style={{ fontSize: 11.5, fontWeight: 600, color: t.sub }}>
                  Already suggested? Vote instead, it counts more.
                </span>
                {similar.map(row)}
              </div>
            )}

            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, fontWeight: 500 }}>
              <span>
                Details <span style={{ fontWeight: 400, color: t.sub }}>(optional)</span>
              </span>
              <textarea
                rows={2}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="What are you trying to do?"
                disabled={preview}
                style={{
                  padding: "8px 10px",
                  borderRadius: t.r8,
                  border: `1px solid ${t.border}`,
                  background: t.card,
                  color: t.fg,
                  font: "400 13.5px inherit",
                  outline: "none",
                  resize: "vertical",
                }}
              />
            </label>

            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {identityLabel && (
                <span style={{ flex: 1, minWidth: 140, fontSize: 11.5, color: t.sub }}>
                  Posting as {identityLabel}
                </span>
              )}
              <button
                type="button"
                onClick={submit}
                disabled={preview || posting || title.trim().length < 3}
                style={{
                  height: 34,
                  padding: "0 14px",
                  marginLeft: identityLabel ? undefined : "auto",
                  border: 0,
                  borderRadius: t.r8,
                  background: t.accent,
                  color: t.onAccent,
                  font: "500 13px inherit",
                  cursor: preview || posting ? "default" : "pointer",
                  opacity: title.trim().length < 3 ? 0.55 : 1,
                }}
              >
                {posting ? "Posting…" : posted ? "Posted" : design.submitCta}
              </button>
            </div>

            {posted && (
              <p
                role="status"
                style={{
                  margin: 0,
                  padding: "8px 10px",
                  borderRadius: t.r8,
                  background: "#ECFDF3",
                  color: "#15803D",
                  fontSize: 12.5,
                }}
              >
                Posted as #{posted}. We read every post.
              </p>
            )}
            {error && (
              <p
                role="alert"
                style={{
                  margin: 0,
                  padding: "8px 10px",
                  borderRadius: t.r8,
                  background: "#FEF2F2",
                  color: "#DC2626",
                  fontSize: 12.5,
                }}
              >
                {error}
              </p>
            )}

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                paddingTop: 4,
                borderTop: `1px solid ${t.border}`,
              }}
            >
              <span style={{ fontSize: 11.5, fontWeight: 600, color: t.sub }}>
                Popular ideas
              </span>
            </div>
            {posts.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12.5, color: t.sub }}>
                Nothing suggested yet. Yours would be the first.
              </p>
            ) : (
              posts.slice(0, 8).map(row)
            )}
          </>
        )}

        {tab === "roadmap" && (
          <>
            {(["planned", "in_progress", "shipped"] as const).map((key) => (
              <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: t.sub,
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: STATUS_TINT[key],
                    }}
                  />
                  {STATUS_LABEL[key]}
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    {roadmap[key].length}
                  </span>
                </span>
                {roadmap[key].length === 0 ? (
                  <p style={{ margin: "0 0 0 15px", fontSize: 12, color: t.sub }}>
                    Nothing here yet.
                  </p>
                ) : (
                  roadmap[key].map(row)
                )}
              </div>
            ))}
          </>
        )}

        {tab === "changelog" && (
          <>
            {changelog.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12.5, color: t.sub }}>
                Nothing shipped yet.
              </p>
            ) : (
              changelog.map((entry) => (
                <article
                  key={entry.id}
                  style={{ display: "flex", flexDirection: "column", gap: 4 }}
                >
                  <span style={{ fontSize: 11.5, color: t.sub }}>
                    {entry.publishedAt
                      ? new Date(entry.publishedAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      : "Draft"}
                  </span>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{entry.title}</h3>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 12.5,
                      lineHeight: 1.55,
                      color: t.sub,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {entry.body}
                  </p>
                </article>
              ))
            )}
          </>
        )}
      </div>

      {showBadge && (
        <footer
          style={{
            padding: "9px 16px",
            borderTop: `1px solid ${t.border}`,
            fontSize: 11,
            color: t.sub,
            textAlign: "center",
          }}
        >
          Powered by Euclid
        </footer>
      )}
    </section>
  );
}
