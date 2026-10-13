"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon, Logo } from "@/components/icons";
import { resolveTheme } from "@/lib/design-presets";
import { ago, longDate } from "@/lib/format";
import { STATUS_LABEL, type BoardDesign, type PostStatus } from "@/lib/types";

interface PublicPost {
  id: string;
  number: number;
  title: string;
  body: string | null;
  status: PostStatus;
  votes: number;
  comments: number;
  voted: boolean;
  createdAt: string;
}

/** One post on the public board: vote, read the thread, add to it. */
export function PublicPostView({
  publicId,
  appName,
  design,
  showBadge,
  post: initial,
  comments: initialComments,
  canComment,
}: {
  publicId: string;
  appName: string;
  design: BoardDesign;
  showBadge: boolean;
  post: PublicPost;
  comments: { id: string; author: string | null; body: string; createdAt: string }[];
  canComment: boolean;
}) {
  const t = resolveTheme(design);
  const [post, setPost] = useState(initial);
  const [comments, setComments] = useState(initialComments);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vote = async () => {
    const before = post;
    setPost((p) => ({ ...p, voted: !p.voted, votes: p.votes + (p.voted ? -1 : 1) }));
    const res = await fetch("/api/public/vote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ board: publicId, postId: post.id }),
    });
    if (!res.ok) {
      setPost(before);
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setError(json.error ?? "Could not vote.");
    } else {
      const json = (await res.json()) as { voted: boolean; votes: number };
      setPost((p) => ({ ...p, voted: json.voted, votes: json.votes }));
    }
  };

  const comment = async () => {
    setPosting(true);
    setError(null);
    const res = await fetch("/api/public/comment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ board: publicId, postId: post.id, body: draft.trim() }),
    });
    setPosting(false);
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setError(json.error ?? "Could not post that.");
      return;
    }
    const json = (await res.json()) as { id: string };
    setComments((prev) => [
      ...prev,
      { id: json.id, author: "You", body: draft.trim(), createdAt: new Date().toISOString() },
    ]);
    setDraft("");
  };

  return (
    <div className="min-h-screen" style={{ background: t.bg, color: t.fg }}>
      <header className="border-b" style={{ borderColor: t.border }}>
        <div className="mx-auto flex max-w-[760px] items-center gap-2 px-6 py-4">
          <Link
            href={`/b/${publicId}`}
            className="flex items-center gap-2 no-underline"
            style={{ color: t.fg }}
          >
            <span
              className="flex h-7 w-7 items-center justify-center rounded-chip text-[13px] font-semibold"
              style={{ background: t.accent, color: t.onAccent }}
            >
              {appName.slice(0, 1).toUpperCase()}
            </span>
            <span className="text-[15px] font-semibold">{appName}</span>
          </Link>
          <span className="text-[13px]" style={{ color: t.sub }}>
            Feedback
          </span>
        </div>
      </header>

      <main className="mx-auto flex max-w-[760px] flex-col gap-7 px-6 py-10">
        <Link
          href={`/b/${publicId}`}
          className="flex w-fit items-center gap-[6px] text-[13px] no-underline hover:underline"
          style={{ color: t.sub }}
        >
          <Icon name="chevronRight" size={13} className="rotate-180" />
          All ideas
        </Link>

        <article className="flex gap-4">
          <button
            type="button"
            aria-pressed={post.voted}
            aria-label={post.voted ? "Remove your vote" : "Vote for this"}
            onClick={vote}
            className="flex h-[52px] w-12 shrink-0 flex-col items-center justify-center gap-[1px] rounded-[10px] border text-[13px] font-semibold"
            style={{
              borderColor: post.voted ? t.accent : t.border,
              background: post.voted ? t.accent : "transparent",
              color: post.voted ? t.onAccent : t.fg,
            }}
          >
            <Icon name="caretUp" size={14} strokeWidth={2.2} />
            <span className="tnum">{post.votes}</span>
          </button>

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <h1 className="text-[24px] font-semibold leading-[1.25] tracking-[-0.015em]">
              {post.title}
            </h1>
            <span className="flex flex-wrap items-center gap-2 text-[12.5px]" style={{ color: t.sub }}>
              <span>#{post.number}</span>
              <span aria-hidden="true">·</span>
              <span>{longDate(post.createdAt)}</span>
              {design.showStatuses && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{STATUS_LABEL[post.status]}</span>
                </>
              )}
            </span>
            {post.body && (
              <p className="whitespace-pre-wrap text-[14.5px] leading-[1.65]" style={{ color: t.sub }}>
                {post.body}
              </p>
            )}
          </div>
        </article>

        {design.showComments && (
          <section className="flex flex-col gap-5 border-t pt-7" style={{ borderColor: t.border }}>
            <h2 className="text-[15px] font-semibold">
              {comments.length} comment{comments.length === 1 ? "" : "s"}
            </h2>

            {comments.map((c) => (
              <div key={c.id} className="flex flex-col gap-1">
                <span className="text-[12.5px]" style={{ color: t.sub }}>
                  <strong className="font-semibold" style={{ color: t.fg }}>
                    {c.author ?? "anonymous"}
                  </strong>{" "}
                  · {ago(c.createdAt)}
                </span>
                <p className="whitespace-pre-wrap text-[13.5px] leading-[1.6]" style={{ color: t.sub }}>
                  {c.body}
                </p>
              </div>
            ))}

            <div className="flex flex-col gap-2">
              <textarea
                rows={3}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Add what you are trying to do — it helps us build the right thing."
                className="rounded-control border px-3 py-2 text-[13.5px] outline-none"
                style={{ borderColor: t.border, background: t.card, color: t.fg }}
              />
              <button
                type="button"
                onClick={comment}
                disabled={posting || draft.trim().length < 2 || !canComment}
                className="h-9 w-fit rounded-control px-4 text-[13px] font-medium disabled:opacity-55"
                style={{ background: t.accent, color: t.onAccent }}
              >
                {posting ? "Posting…" : "Comment"}
              </button>
              {error && (
                <p role="alert" className="text-[12.5px]" style={{ color: "#DC2626" }}>
                  {error}
                </p>
              )}
            </div>
          </section>
        )}
      </main>

      {showBadge && (
        <footer className="border-t py-6 text-center" style={{ borderColor: t.border }}>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[12px] no-underline"
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
