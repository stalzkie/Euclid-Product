"use client";

import { useEffect } from "react";
import { BoardWidget, type WidgetChangelog, type WidgetPost } from "@/components/board-widget";
import type { BoardDesign, IdentityMode } from "@/lib/types";

/**
 * Wires the shared board component to the public API, and tells the parent
 * page how tall it needs to be. Nothing here touches the host page directly;
 * the loader owns the frame.
 */
export function EmbeddedBoard({
  publicId,
  boardName,
  appName,
  design,
  showBadge,
  categories,
  identityMode,
  token,
  viewerLabel,
  posts,
  changelog,
}: {
  publicId: string;
  boardName: string;
  appName: string;
  design: BoardDesign;
  showBadge: boolean;
  categories: string[];
  identityMode: IdentityMode;
  token: string | null;
  viewerLabel: string | null;
  posts: WidgetPost[];
  changelog: WidgetChangelog[];
}) {
  // Report height so the loader can size the iframe to its content.
  useEffect(() => {
    const report = () => {
      const height = document.documentElement.scrollHeight;
      window.parent?.postMessage({ type: "euclid:height", height }, "*");
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, []);

  // Escape, forwarded to the loader so it can close the floating panel.
  //
  // The loader focuses this frame as soon as the panel opens, so every
  // keypress after that lands in this document and never reaches the host
  // page's own Escape handler. Without this the panel could not be closed
  // from the keyboard at all.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (window.parent === window) return;
      window.parent.postMessage({ type: "euclid:close" }, "*");
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const vote = async (postId: string) => {
    const res = await fetch("/api/public/vote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ board: publicId, postId, token }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(json.error ?? "Vote failed");
    }
  };

  const submit = async (input: { title: string; body: string }) => {
    const res = await fetch("/api/public/post", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        board: publicId,
        title: input.title,
        body: input.body,
        category: categories[0] ?? null,
        token,
      }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false as const, error: json.error ?? "Could not post that." };
    }
    const json = (await res.json()) as { number: number; held: boolean };
    return { ok: true as const, number: json.number };
  };

  const searchSimilar = async (
    title: string,
    mode: "fast" | "semantic",
  ): Promise<WidgetPost[]> => {
    const params = new URLSearchParams({ board: publicId, title, mode });
    if (token) params.set("token", token);
    try {
      const res = await fetch(`/api/public/similar?${params}`);
      const json = (await res.json()) as { posts: WidgetPost[] };
      return json.posts ?? [];
    } catch {
      return [];
    }
  };

  return (
    <div className="p-0">
      <BoardWidget
        design={design}
        boardName={appName || boardName}
        posts={posts}
        changelog={changelog}
        showBadge={showBadge}
        identityLabel={identityMode === "anonymous" ? null : viewerLabel}
        onVote={vote}
        onSubmit={submit}
        onSearchSimilar={searchSimilar}
      />
    </div>
  );
}
