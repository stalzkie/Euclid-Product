"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { resolveTheme } from "@/lib/design-presets";
import { STATUS_LABEL, type BoardDesign, type IdentityMode } from "@/lib/types";
import type { WidgetPost } from "@/components/board-widget";

/**
 * The submit form on the hosted board, with the duplicate nudge that runs while
 * the submitter types and the email step for boards that ask for one.
 */
export function SubmitPanel({
  publicId,
  appName,
  design,
  categories,
  identityMode,
  viewerLabel,
  open,
  onPosted,
}: {
  publicId: string;
  appName: string;
  design: BoardDesign;
  categories: string[];
  identityMode: IdentityMode;
  viewerLabel: string | null;
  open: boolean;
  onPosted: (post: WidgetPost) => void;
}) {
  const t = resolveTheme(design);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState(categories[0] ?? "");
  const [honeypot, setHoneypot] = useState("");
  const [similar, setSimilar] = useState<WidgetPost[]>([]);
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState<{ number: number; held: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open]);

  // Similar posts as you type. The submitter is nudged to vote instead.
  useEffect(() => {
    if (title.trim().length <= 3) {
      setSimilar([]);
      return;
    }
    let live = true;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      const query = encodeURIComponent(title.trim());
      const load = async (mode: "fast" | "semantic") => {
        try {
          const res = await fetch(
            `/api/public/similar?board=${publicId}&title=${query}&mode=${mode}`,
          );
          return ((await res.json()) as { posts: WidgetPost[] }).posts ?? [];
        } catch {
          return [];
        }
      };
      // Keyword first so something appears immediately, semantic after.
      void load("fast").then((found) => {
        if (live && found.length) setSimilar((prev) => (prev.length ? prev : found));
      });
      void load("semantic").then((found) => {
        if (live) setSimilar(found);
      });
    }, 300);

    return () => {
      live = false;
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [title, publicId]);

  const vote = async (post: WidgetPost) => {
    await fetch("/api/public/vote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ board: publicId, postId: post.id }),
    });
    setSimilar((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? { ...p, voted: !p.voted, votes: p.votes + (p.voted ? -1 : 1) }
          : p,
      ),
    );
  };

  const submit = async () => {
    setPosting(true);
    setError(null);
    const res = await fetch("/api/public/post", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        board: publicId,
        title: title.trim(),
        body: body.trim(),
        category,
        website: honeypot,
      }),
    });
    setPosting(false);

    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setError(json.error ?? "Could not post that.");
      return;
    }

    const json = (await res.json()) as { number: number; id: string; held: boolean };
    setPosted({ number: json.number, held: json.held });
    if (!json.held) {
      onPosted({
        id: json.id,
        number: json.number,
        title: title.trim(),
        status: "under_review",
        votes: 1,
        comments: 0,
        voted: true,
      });
    }
    setTitle("");
    setBody("");
    setSimilar([]);
  };

  const sendLink = async () => {
    setError(null);
    const res = await fetch("/api/public/magic", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ board: publicId, email: email.trim() }),
    });
    if (res.ok) setEmailSent(true);
    else {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setError(json.error ?? "Could not send the link.");
    }
  };

  return (
    <div
      className="flex flex-col gap-4 rounded-card border p-4"
      style={{ borderColor: t.border, background: t.card }}
    >
      <h2 className="text-[14px] font-semibold">{design.submitCta}</h2>

      <label className="flex flex-col gap-[6px] text-[12.5px] font-medium">
        Your idea
        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setPosted(null);
          }}
          placeholder={`What would make ${appName} better?`}
          className="h-9 rounded-control border px-3 text-[13.5px] outline-none"
          style={{ borderColor: t.border, background: t.bg, color: t.fg }}
        />
      </label>

      {/* The duplicate nudge */}
      {similar.length > 0 && (
        <div
          className="flex flex-col gap-2 rounded-control border p-3"
          style={{ borderColor: t.border, background: t.hover }}
        >
          <span className="text-[11.5px] font-semibold" style={{ color: t.sub }}>
            Already suggested? Vote instead, it counts more.
          </span>
          {similar.map((p) => (
            <div key={p.id} className="flex items-center gap-2">
              <button
                type="button"
                aria-pressed={p.voted}
                aria-label={`Vote for ${p.title}`}
                onClick={() => void vote(p)}
                className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-chip border text-[11.5px] font-semibold"
                style={{
                  borderColor: p.voted ? t.accent : t.border,
                  background: p.voted ? t.accent : t.bg,
                  color: p.voted ? t.onAccent : t.fg,
                }}
              >
                <Icon name="caretUp" size={10} strokeWidth={2.6} />
                <span className="tnum">{p.votes}</span>
              </button>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[12.5px] font-medium">{p.title}</span>
                <span className="text-[11.5px]" style={{ color: t.sub }}>
                  {STATUS_LABEL[p.status]}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      <label className="flex flex-col gap-[6px] text-[12.5px] font-medium">
        <span>
          Details <span style={{ color: t.sub }}>(optional)</span>
        </span>
        <textarea
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What are you trying to do?"
          className="rounded-control border px-3 py-2 text-[13.5px] outline-none"
          style={{ borderColor: t.border, background: t.bg, color: t.fg }}
        />
      </label>

      {categories.length > 1 && (
        <label className="flex flex-col gap-[6px] text-[12.5px] font-medium">
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 rounded-control border px-2 text-[13.5px]"
            style={{ borderColor: t.border, background: t.bg, color: t.fg }}
          >
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      )}

      {/* Honeypot. Hidden from people, irresistible to bots. */}
      <label
        aria-hidden="true"
        className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0"
      >
        Website
        <input
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        {viewerLabel ? (
          <span className="flex-1 text-[11.5px]" style={{ color: t.sub }}>
            Posting as {viewerLabel}
          </span>
        ) : (
          <span className="flex-1 text-[11.5px]" style={{ color: t.sub }}>
            {identityMode === "anonymous"
              ? "Posting anonymously"
              : "Add your email below to hear when this ships"}
          </span>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={posting || title.trim().length < 3}
          className="h-9 rounded-control px-4 text-[13px] font-medium disabled:opacity-55"
          style={{ background: t.accent, color: t.onAccent }}
        >
          {posting ? "Posting…" : design.submitCta}
        </button>
      </div>

      {posted && (
        <p
          role="status"
          className="rounded-control px-3 py-2 text-[12.5px]"
          style={{ background: "#ECFDF3", color: "#15803D" }}
        >
          {posted.held
            ? `Thanks. Your idea is with the ${appName} team for review.`
            : `Posted as #${posted.number}. We read every post.`}
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-control px-3 py-2 text-[12.5px]"
          style={{ background: "#FEF2F2", color: "#DC2626" }}
        >
          {error}
        </p>
      )}

      {/* Email step, for boards that use it */}
      {identityMode !== "anonymous" && !viewerLabel && (
        <div
          className="flex flex-col gap-2 border-t pt-3"
          style={{ borderColor: t.border }}
        >
          {emailSent ? (
            <p className="text-[12.5px]" style={{ color: t.sub }}>
              Check {email} for a link. Once you confirm it, we will email you when
              something you voted for ships.
            </p>
          ) : (
            <>
              <label className="flex flex-col gap-[6px] text-[12.5px] font-medium">
                Your email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="h-9 rounded-control border px-3 text-[13.5px] outline-none"
                  style={{ borderColor: t.border, background: t.bg, color: t.fg }}
                />
              </label>
              <button
                type="button"
                onClick={sendLink}
                disabled={!email.includes("@")}
                className="h-9 rounded-control border text-[12.5px] font-medium disabled:opacity-55"
                style={{ borderColor: t.border, color: t.fg }}
              >
                Email me a sign-in link
              </button>
              <span className="text-[11px] leading-[1.45]" style={{ color: t.sub }}>
                Only {appName} sees your address. It is used to tell you when a request
                ships, nothing else.
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
