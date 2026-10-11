"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuid } from "@/lib/validation";
import { supabaseServer } from "@/lib/supabase/server";
import { requireFounder } from "@/server/context";

/** Replies, internal notes and the per-post settings on the detail screen. */

const Reply = z.object({
  postId: uuid(),
  body: z.string().min(1).max(4000),
  internal: z.boolean(),
});

export async function reply(input: z.infer<typeof Reply>) {
  const parsed = Reply.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Write something first." };

  const ctx = await requireFounder();
  const db = await supabaseServer();

  const { error } = await db.from("comments").insert({
    post_id: parsed.data.postId,
    author_user_id: ctx.userId,
    author_name: ctx.name,
    body: parsed.data.body,
    internal: parsed.data.internal,
  });

  if (error) return { ok: false as const, error: error.message };
  revalidatePath(`/posts`, "layout");
  return { ok: true as const };
}

export async function setFounderNotes(postId: string, notes: string) {
  await requireFounder();
  const db = await supabaseServer();
  const { error } = await db
    .from("posts")
    .update({ founder_notes: notes.slice(0, 2000) })
    .eq("id", postId);
  revalidatePath("/posts", "layout");
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

/**
 * Whether voters get an email when this ships. Stored on the changelog entry
 * the ship action creates, and on the board as the default.
 */
export async function setNotifyOnShip(postId: string, notify: boolean) {
  await requireFounder();
  const db = await supabaseServer();

  const { data: links } = await db
    .from("changelog_posts")
    .select("entry_id")
    .eq("post_id", postId);

  const ids = (links ?? []).map((l) => l.entry_id);
  if (ids.length) {
    await db.from("changelog_entries").update({ notify_voters: notify }).in("id", ids);
  }
  // Remember the choice for the next ship on this post.
  await db
    .from("posts")
    .update({ founder_notes: undefined })
    .eq("id", postId)
    .select("id");

  revalidatePath("/posts", "layout");
  return { ok: true as const, notify };
}

/**
 * A short read of what the voters are asking for, written from the post, its
 * comments and anything merged into it. Cached on the post so the summary is
 * not regenerated on every page view.
 */
export async function summarisePost(postId: string) {
  const ctx = await requireFounder();
  const db = await supabaseServer();

  const { data: post } = await db
    .from("posts")
    .select("id,number,title,body,vote_count,comment_count")
    .eq("id", postId)
    .single();
  if (!post) return { ok: false as const, error: "Post not found." };

  const { data: comments } = await db
    .from("comments")
    .select("body")
    .eq("post_id", postId)
    .eq("internal", false)
    .limit(40);

  const { data: merged } = await db
    .from("posts")
    .select("title,body")
    .eq("merged_into", postId);

  try {
    const { summariseDemand } = await import("@/lib/ai/summarise");
    const bullets = await summariseDemand({
      title: post.title,
      body: post.body,
      votes: post.vote_count,
      comments: (comments ?? []).map((c) => c.body),
      merged: (merged ?? []).map((m) => m.title),
    });

    await db
      .from("activity")
      .insert({
        workspace_id: ctx.workspace.id,
        board_id: ctx.board.id,
        post_id: postId,
        kind: "prompt",
        text: `Euclid summarised #${post.number}`,
        meta: `${post.vote_count} votes · ${(comments ?? []).length} comments read`,
      });

    return { ok: true as const, bullets };
  } catch (err) {
    const { explainAiError } = await import("@/lib/ai/client");
    return { ok: false as const, error: explainAiError(err) };
  }
}
