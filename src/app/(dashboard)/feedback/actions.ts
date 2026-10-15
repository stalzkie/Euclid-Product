"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuid } from "@/lib/validation";
import { supabaseServer } from "@/lib/supabase/server";
import { requireFounder } from "@/server/context";
import { embed, postEmbeddingText } from "@/lib/ai/embeddings";
import { scanForInjection } from "@/lib/ai/safety";
import { DUPLICATE_SUGGESTION } from "@/lib/ai/thresholds";
import { STATUS_LABEL, type PostStatus } from "@/lib/types";
import { enqueueIntegrationEvent } from "@/server/integrations";
import { drainAfterResponse } from "@/server/dispatch";
import { appOrigin } from "@/lib/origin";

/**
 * Founder-side mutations on posts. Everything runs through the caller's
 * session, so RLS is the backstop on workspace isolation.
 */

const StatusInput = z.object({
  postIds: z.array(uuid()).min(1),
  status: z.enum(["under_review", "planned", "in_progress", "shipped", "declined"]),
});

export async function setStatus(input: z.infer<typeof StatusInput>) {
  const { postIds, status } = StatusInput.parse(input);
  const ctx = await requireFounder();
  const db = await supabaseServer();

  const shipped = status === "shipped";

  // Read the old status first: a notification that says only where a post
  // landed is much less useful than one that says where it came from.
  const { data: before } = await db
    .from("posts")
    .select("id,number,title,body,category,status,vote_count")
    .in("id", postIds);

  const { error } = await db
    .from("posts")
    .update({
      status,
      shipped_at: shipped ? new Date().toISOString() : null,
    })
    .in("id", postIds);

  if (error) return { ok: false as const, error: error.message };

  const origin = await appOrigin();
  for (const post of before ?? []) {
    if (post.status === status) continue;
    await enqueueIntegrationEvent(ctx.board.id, "post.status_changed", {
      number: post.number,
      title: post.title,
      body: post.body,
      category: post.category,
      status,
      previousStatus: post.status,
      votes: post.vote_count,
      url: `${origin}/b/${ctx.board.public_id}`,
      boardName: ctx.board.name,
    });
  }

  // Chat integrations hear about the change once this action has returned,
  // so the founder's screen does not wait on Slack.
  drainAfterResponse({ emails: false });

  // Marking a post Shipped creates a changelog entry the founder can edit,
  // rather than publishing anything on their behalf.
  if (shipped) {
    const { data: posts } = await db
      .from("posts")
      .select("id,number,title")
      .in("id", postIds);

    for (const post of posts ?? []) {
      const { data: entry } = await db
        .from("changelog_entries")
        .insert({
          board_id: ctx.board.id,
          title: post.title,
          body: "",
          published: false,
        })
        .select("id")
        .single();

      if (entry) {
        await db.from("changelog_posts").insert({ entry_id: entry.id, post_id: post.id });
      }

      await db.from("activity").insert({
        workspace_id: ctx.workspace.id,
        board_id: ctx.board.id,
        post_id: post.id,
        kind: "ship",
        text: `Shipped: ${post.title}`,
        meta: "Changelog draft created · voters not yet emailed",
      });
    }
  }

  revalidatePath("/feedback");
  revalidatePath("/");
  revalidatePath("/changelog");
  return { ok: true as const, label: STATUS_LABEL[status as PostStatus] };
}

export async function setTheme(postIds: string[], themeId: string | null) {
  await requireFounder();
  const db = await supabaseServer();
  const { error } = await db.from("posts").update({ theme_id: themeId }).in("id", postIds);
  revalidatePath("/feedback");
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

export async function deletePosts(postIds: string[]) {
  await requireFounder();
  const db = await supabaseServer();
  const { error } = await db.from("posts").delete().in("id", postIds);
  revalidatePath("/feedback");
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

const NewPost = z.object({
  title: z.string().min(3).max(140),
  body: z.string().max(4000).optional(),
  category: z.string().optional(),
  status: z
    .enum(["under_review", "planned", "in_progress", "shipped", "declined"])
    .default("under_review"),
});

/** A post the founder adds by hand, e.g. from a DM or an email. */
export async function addPost(input: z.infer<typeof NewPost>) {
  const parsed = NewPost.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const ctx = await requireFounder();
  const db = await supabaseServer();

  const scan = scanForInjection(parsed.data.title, parsed.data.body);
  const vector = await embed(postEmbeddingText(parsed.data.title, parsed.data.body));

  const { data, error } = await db
    .from("posts")
    .insert({
      board_id: ctx.board.id,
      title: parsed.data.title,
      body: parsed.data.body ?? null,
      category: parsed.data.category ?? null,
      status: parsed.data.status,
      embedding: vector,
      injection_flagged: scan.flagged,
    })
    .select("id,number")
    .single();

  if (error) return { ok: false as const, error: error.message };

  await findDuplicates(ctx.board.id, data.id, vector);

  await db.from("activity").insert({
    workspace_id: ctx.workspace.id,
    board_id: ctx.board.id,
    post_id: data.id,
    kind: "post",
    text: `New post: ${parsed.data.title}`,
    meta: `${ctx.board.name} · added by you`,
  });

  revalidatePath("/feedback");
  return { ok: true as const, number: data.number };
}

/**
 * Writes duplicate suggestions for one post. Called after any insert so the
 * merge queue stays current without a nightly sweep.
 */
export async function findDuplicates(
  boardId: string,
  postId: string,
  vector: number[],
): Promise<number> {
  const db = await supabaseServer();
  const { data } = await db.rpc("match_posts", {
    p_board: boardId,
    p_embedding: vector,
    p_exclude: postId,
    p_threshold: DUPLICATE_SUGGESTION,
    p_limit: 4,
  });

  const matches = (data ?? []) as { id: string; similarity: number }[];
  if (!matches.length) return 0;

  await db.from("duplicate_suggestions").upsert(
    matches.map((m) => ({
      board_id: boardId,
      post_id: postId,
      target_id: m.id,
      similarity: Number(m.similarity.toFixed(3)),
    })),
    { onConflict: "post_id,target_id", ignoreDuplicates: true },
  );

  return matches.length;
}

export interface MergeGroup {
  targetId: string;
  targetNumber: number;
  targetTitle: string;
  targetVotes: number;
  members: {
    id: string;
    number: number;
    title: string;
    votes: number;
    similarity: number;
  }[];
  combinedVotes: number;
}

/** Groups the pending suggestions by the post they would merge into. */
export async function listMergeQueue(boardId: string): Promise<MergeGroup[]> {
  const db = await supabaseServer();
  const { data } = await db
    .from("duplicate_suggestions")
    .select(
      "similarity," +
        "source:posts!duplicate_suggestions_post_id_fkey(id,number,title,vote_count)," +
        "target:posts!duplicate_suggestions_target_id_fkey(id,number,title,vote_count)",
    )
    .eq("board_id", boardId)
    .eq("state", "pending")
    .order("similarity", { ascending: false });

  type Row = {
    similarity: number;
    source: { id: string; number: number; title: string; vote_count: number };
    target: { id: string; number: number; title: string; vote_count: number };
  };

  const groups = new Map<string, MergeGroup>();
  for (const raw of (data ?? []) as unknown as Row[]) {
    if (!raw.source || !raw.target) continue;

    // Always offer the better-supported post as the survivor. The stored pair
    // records which post was written second, which is not the same thing — a
    // late duplicate can easily out-vote the original, and collapsing a
    // 185-vote post into a 97-vote one is never what the founder meant.
    const [survivor, duplicate] =
      raw.target.vote_count >= raw.source.vote_count
        ? [raw.target, raw.source]
        : [raw.source, raw.target];

    const group =
      groups.get(survivor.id) ??
      ({
        targetId: survivor.id,
        targetNumber: survivor.number,
        targetTitle: survivor.title,
        targetVotes: survivor.vote_count,
        members: [],
        combinedVotes: survivor.vote_count,
      } satisfies MergeGroup);

    // A post can be suggested against several survivors; keep it in one group.
    if (!group.members.some((m) => m.id === duplicate.id)) {
      group.members.push({
        id: duplicate.id,
        number: duplicate.number,
        title: duplicate.title,
        votes: duplicate.vote_count,
        similarity: Number(raw.similarity),
      });
      group.combinedVotes += duplicate.vote_count;
    }
    groups.set(survivor.id, group);
  }

  return [...groups.values()].sort((a, b) => b.combinedVotes - a.combinedVotes);
}

/** One click combines posts and their votes. */
export async function mergePost(sourceId: string, targetId: string) {
  const ctx = await requireFounder();
  const db = await supabaseServer();

  const { data: pair } = await db
    .from("posts")
    .select("id,title,vote_count")
    .in("id", [sourceId, targetId]);

  const { error } = await db.rpc("merge_posts", {
    p_source: sourceId,
    p_target: targetId,
  });
  if (error) return { ok: false as const, error: error.message };

  const target = pair?.find((p) => p.id === targetId);
  const source = pair?.find((p) => p.id === sourceId);

  await db.from("activity").insert({
    workspace_id: ctx.workspace.id,
    board_id: ctx.board.id,
    post_id: targetId,
    kind: "merge",
    text: `Merged "${source?.title ?? "a duplicate"}" into ${target?.title ?? "a post"}`,
    meta: `${source?.vote_count ?? 0} votes combined · you approved`,
  });

  revalidatePath("/feedback");
  revalidatePath("/");
  return { ok: true as const };
}

export async function dismissDuplicate(sourceId: string, targetId: string) {
  await requireFounder();
  const db = await supabaseServer();
  const { error } = await db
    .from("duplicate_suggestions")
    .update({ state: "dismissed" })
    .eq("post_id", sourceId)
    .eq("target_id", targetId);
  revalidatePath("/feedback");
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

/** CSV of every post on the board, for the Export button. */
export async function exportPostsCsv(): Promise<string> {
  const ctx = await requireFounder();
  const db = await supabaseServer();
  const { data } = await db
    .from("posts")
    .select("number,title,status,vote_count,comment_count,category,created_at,themes(name)")
    .eq("board_id", ctx.board.id)
    .order("vote_count", { ascending: false });

  const header = "number,title,status,votes,comments,category,theme,created_at";
  const rows = (data ?? []).map((p) =>
    [
      p.number,
      csv(p.title),
      STATUS_LABEL[p.status as PostStatus],
      p.vote_count,
      p.comment_count,
      csv(p.category ?? ""),
      csv((p.themes as { name?: string } | null)?.name ?? ""),
      p.created_at,
    ].join(","),
  );
  return [header, ...rows].join("\n");
}

function csv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/* --------------------------------------------------------------------------
 * Held posts
 *
 * `submitPost` writes `approved: false` when a board requires approval or the
 * spam score reaches 0.8, and every read path on both sides filters for
 * `approved = true`. Without what follows, a held post is written and then
 * invisible to everyone for good — including the founder, who is the one
 * person being asked to review it.
 * ------------------------------------------------------------------------ */

export type HeldPost = {
  id: string;
  number: number;
  title: string;
  body: string | null;
  category: string | null;
  spamScore: number;
  injectionFlagged: boolean;
  createdAt: string;
  authorEmail: string | null;
};

/** Everything waiting on the founder, oldest first — it has waited longest. */
export async function listHeldPosts(boardId: string): Promise<HeldPost[]> {
  const db = await supabaseServer();
  const { data } = await db
    .from("posts")
    .select(
      "id,number,title,body,category,spam_score,injection_flagged,created_at," +
        "author:end_users(email)",
    )
    .eq("board_id", boardId)
    .eq("approved", false)
    .order("created_at", { ascending: true });

  type Row = {
    id: string;
    number: number;
    title: string;
    body: string | null;
    category: string | null;
    spam_score: number;
    injection_flagged: boolean;
    created_at: string;
    author: { email: string | null } | null;
  };

  return ((data ?? []) as unknown as Row[]).map((p) => ({
    id: p.id,
    number: p.number,
    title: p.title,
    body: p.body,
    category: p.category,
    spamScore: Number(p.spam_score),
    injectionFlagged: p.injection_flagged,
    createdAt: p.created_at,
    authorEmail: p.author?.email ?? null,
  }));
}

/**
 * Release a held post onto the board.
 *
 * This is where the `post.created` integration event finally fires. It is
 * deliberately skipped at submission time for a held post, because announcing
 * one into Slack would leak a submission the founder has not read yet — which
 * is the whole point of holding it.
 */
export async function approvePost(postId: string) {
  const ctx = await requireFounder();
  const db = await supabaseServer();

  const { data: post, error: readError } = await db
    .from("posts")
    .select("id,number,title,body,category,status,vote_count,approved")
    .eq("id", postId)
    .single();

  if (readError || !post) {
    return { ok: false as const, error: readError?.message ?? "Post not found." };
  }

  // Approving twice would announce the post to Slack twice. The founder can
  // get here from a stale tab, so check rather than assume.
  if (post.approved) return { ok: true as const, number: post.number };

  const { error } = await db.from("posts").update({ approved: true }).eq("id", postId);
  if (error) return { ok: false as const, error: error.message };

  await enqueueIntegrationEvent(ctx.board.id, "post.created", {
    number: post.number,
    title: post.title,
    body: post.body,
    category: post.category,
    status: post.status,
    votes: post.vote_count,
    url: `${await appOrigin()}/b/${ctx.board.public_id}`,
    boardName: ctx.board.name,
  });

  await db.from("activity").insert({
    workspace_id: ctx.workspace.id,
    board_id: ctx.board.id,
    post_id: post.id,
    kind: "post",
    text: `Approved: ${post.title}`,
    meta: "Held for review · now on the board",
  });

  drainAfterResponse({ emails: false });

  revalidatePath("/feedback");
  revalidatePath("/");
  return { ok: true as const, number: post.number };
}

/**
 * Reject a held post, which deletes it.
 *
 * Leaving it at `approved = false` would be the gentler-looking option and the
 * worse one: the row would sit in the queue for ever, and a founder clearing
 * spam would have to keep re-reading the same rejected posts. Nothing links to
 * a post that was never public, so there is nothing to orphan.
 */
export async function rejectPost(postId: string) {
  const ctx = await requireFounder();
  const db = await supabaseServer();

  const { data: post } = await db
    .from("posts")
    .select("id,title,approved")
    .eq("id", postId)
    .single();

  // Refuse to delete a post that is already on the board. Only held posts are
  // this action's business, and a mis-sent id should not take a live post with
  // its votes and comments down.
  if (post?.approved) {
    return { ok: false as const, error: "That post is already on the board." };
  }

  const { error } = await db.from("posts").delete().eq("id", postId);
  if (error) return { ok: false as const, error: error.message };

  await db.from("activity").insert({
    workspace_id: ctx.workspace.id,
    board_id: ctx.board.id,
    kind: "post",
    text: `Rejected: ${post?.title ?? "a held post"}`,
    meta: "Held for review · removed, never public",
  });

  revalidatePath("/feedback");
  return { ok: true as const };
}
