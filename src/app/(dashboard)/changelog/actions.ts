"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuid } from "@/lib/validation";
import { supabaseServer, supabaseAdmin, hasServiceRole } from "@/lib/supabase/server";
import { requireFounder } from "@/server/context";
import { draftChangelog } from "@/lib/ai/clustering";
import { AiUnavailableError, explainAiError } from "@/lib/ai/client";
import type { ChangelogEntry } from "@/lib/types";

/**
 * Changelog. Marking a post Shipped creates a draft; publishing optionally
 * emails everyone who voted for it and flips the post to Shipped on the
 * public roadmap.
 */

export async function createEntry() {
  const ctx = await requireFounder();
  const db = await supabaseServer();
  const { data, error } = await db
    .from("changelog_entries")
    .insert({ board_id: ctx.board.id, title: "Untitled entry", body: "" })
    .select("id")
    .single();

  revalidatePath("/changelog");
  return error
    ? { ok: false as const, error: error.message }
    : { ok: true as const, id: data.id };
}

const Save = z.object({
  id: uuid(),
  title: z.string().min(1).max(120),
  body: z.string().max(20000),
  notifyVoters: z.boolean(),
  showBadge: z.boolean(),
});

export async function saveEntry(input: z.infer<typeof Save>) {
  const parsed = Save.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  await requireFounder();
  const db = await supabaseServer();

  const { error } = await db
    .from("changelog_entries")
    .update({
      title: parsed.data.title,
      body: parsed.data.body,
      notify_voters: parsed.data.notifyVoters,
      show_badge: parsed.data.showBadge,
    })
    .eq("id", parsed.data.id);

  revalidatePath("/changelog");
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

export async function linkPost(entryId: string, postNumber: number) {
  const ctx = await requireFounder();
  const db = await supabaseServer();

  const { data: post } = await db
    .from("posts")
    .select("id")
    .eq("board_id", ctx.board.id)
    .eq("number", postNumber)
    .maybeSingle();
  if (!post) return { ok: false as const, error: `No post #${postNumber} on this board.` };

  const { error } = await db
    .from("changelog_posts")
    .upsert({ entry_id: entryId, post_id: post.id }, { ignoreDuplicates: true });

  revalidatePath("/changelog");
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

export async function unlinkPost(entryId: string, postId: string) {
  await requireFounder();
  const db = await supabaseServer();
  const { error } = await db
    .from("changelog_posts")
    .delete()
    .eq("entry_id", entryId)
    .eq("post_id", postId);
  revalidatePath("/changelog");
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

/** Lets Euclid write the entry from the posts it links to. */
export async function draftEntry(entryId: string) {
  const ctx = await requireFounder();
  const db = await supabaseServer();

  const { data: entry } = await db
    .from("changelog_entries")
    .select("id,title")
    .eq("id", entryId)
    .maybeSingle();
  if (!entry) return { ok: false as const, error: "Entry not found." };

  const { data: links } = await db
    .from("changelog_posts")
    .select("posts(id,number,title,vote_count,body)")
    .eq("entry_id", entryId);

  const posts = (links ?? [])
    .map((l) =>
      Array.isArray(l.posts)
        ? l.posts[0]
        : (l.posts as { id: string; number: number; title: string; vote_count: number; body: string | null } | null),
    )
    .filter(
      (p): p is { id: string; number: number; title: string; vote_count: number; body: string | null } =>
        Boolean(p),
    );

  if (!posts.length) {
    return {
      ok: false as const,
      error: "Link at least one shipped post first — the draft is written from them.",
    };
  }

  const { data: comments } = await db
    .from("comments")
    .select("body")
    .in(
      "post_id",
      posts.map((p) => p.id),
    )
    .eq("internal", false)
    .limit(20);

  try {
    const body = await draftChangelog({
      title: entry.title,
      posts: posts.map((p) => ({
        number: p.number,
        title: p.title,
        votes: p.vote_count,
        body: p.body,
      })),
      quotes: (comments ?? []).map((c) => c.body),
      appName: ctx.workspace.app_name ?? ctx.workspace.name,
    });

    await db.from("changelog_entries").update({ body }).eq("id", entryId);
    revalidatePath("/changelog");
    return { ok: true as const, body };
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      return { ok: false as const, error: err.message };
    }
    return {
      ok: false as const,
      error: explainAiError(err),
    };
  }
}

/**
 * Publishing. Flips every linked post to Shipped and queues one email per
 * voter with an address — the emails land in an outbox table that a worker
 * drains, so publishing stays fast and nothing is lost if the mailer is down.
 */
export async function publishEntry(entryId: string) {
  const ctx = await requireFounder();
  const db = await supabaseServer();

  const { data: entry } = await db
    .from("changelog_entries")
    .select("*")
    .eq("id", entryId)
    .maybeSingle();
  if (!entry) return { ok: false as const, error: "Entry not found." };
  if (!entry.body.trim()) {
    return { ok: false as const, error: "Write the entry before publishing it." };
  }

  const { data: links } = await db
    .from("changelog_posts")
    .select("post_id, posts(number,title)")
    .eq("entry_id", entryId);

  const postIds = (links ?? []).map((l) => l.post_id);

  // Mark the linked posts Shipped.
  if (postIds.length) {
    await db
      .from("posts")
      .update({ status: "shipped", shipped_at: new Date().toISOString() })
      .in("id", postIds);
  }

  // Queue the voter emails.
  let notified = 0;
  if (entry.notify_voters && postIds.length) {
    const { data: voters } = await db
      .from("votes")
      .select("end_users(email)")
      .in("post_id", postIds);

    const emails = new Set(
      (voters ?? [])
        .map((v) =>
          Array.isArray(v.end_users)
            ? v.end_users[0]?.email
            : (v.end_users as { email: string | null } | null)?.email,
        )
        .filter((e): e is string => Boolean(e)),
    );

    notified = emails.size;

    if (emails.size && hasServiceRole()) {
      const appName = ctx.workspace.app_name ?? ctx.workspace.name;
      const admin = supabaseAdmin();
      await admin.from("email_outbox").insert(
        [...emails].map((to) => ({
          to_email: to,
          subject: `You asked, we shipped: ${entry.title}`,
          body: voterEmail({
            appName,
            founder: ctx.name,
            title: entry.title,
            body: entry.body,
          }),
          kind: "changelog",
        })),
      );
    }
  }

  const { error } = await db
    .from("changelog_entries")
    .update({
      published: true,
      published_at: new Date().toISOString(),
      voters_notified: notified,
    })
    .eq("id", entryId);

  if (error) return { ok: false as const, error: error.message };

  const first = (links ?? [])[0];
  const firstPost = first
    ? Array.isArray(first.posts)
      ? first.posts[0]
      : (first.posts as { number: number; title: string } | null)
    : null;

  await db.from("activity").insert({
    workspace_id: ctx.workspace.id,
    board_id: ctx.board.id,
    post_id: postIds[0] ?? null,
    kind: "ship",
    text: `Published: ${entry.title}`,
    meta: `${notified} voter${notified === 1 ? "" : "s"} emailed${
      firstPost ? ` · #${firstPost.number} marked Shipped` : ""
    }`,
  });

  revalidatePath("/changelog");
  revalidatePath("/");
  revalidatePath("/feedback");

  return { ok: true as const, notified, postNumber: firstPost?.number ?? null };
}

export async function deleteEntry(entryId: string) {
  await requireFounder();
  const db = await supabaseServer();
  const { error } = await db.from("changelog_entries").delete().eq("id", entryId);
  revalidatePath("/changelog");
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

/** The email voters receive. Plain text so it renders anywhere. */
function voterEmail(args: {
  appName: string;
  founder: string;
  title: string;
  body: string;
}): string {
  return [
    "Hi there,",
    "",
    `You voted for "${args.title}" on ${args.appName}'s feedback board. It is live today.`,
    "",
    args.body,
    "",
    `— ${args.founder}`,
    "",
    `You are getting this because you voted on ${args.appName}'s feedback board.`,
    "Reply to this email to unsubscribe.",
  ].join("\n");
}

export type { ChangelogEntry };
