"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requireFounder } from "@/server/context";
import { clusterPosts, nameCluster, type ClusterInput } from "@/lib/ai/clustering";
import { embed, postEmbeddingText } from "@/lib/ai/embeddings";
import { AiUnavailableError, explainAiError } from "@/lib/ai/client";
import { PLANS } from "@/lib/plans";

/**
 * Re-clustering. Embeds anything missing an embedding, clusters by cosine
 * distance, then asks a cheap model to name each cluster. Themes that already
 * exist keep their id so links to them do not break.
 */
export async function recluster() {
  const ctx = await requireFounder();
  if (!PLANS[ctx.workspace.plan].analytics) {
    return {
      ok: false as const,
      error: "Theme clustering is on the Indie plan and above.",
    };
  }

  const db = await supabaseServer();

  const { data: posts } = await db
    .from("posts")
    .select("id,title,body,vote_count,embedding")
    .eq("board_id", ctx.board.id)
    .is("merged_into", null)
    .eq("approved", true);

  if (!posts?.length) {
    return { ok: false as const, error: "No posts to cluster yet." };
  }

  // Backfill embeddings for posts that arrived before the provider was wired
  // up, or whose text changed.
  const prepared: ClusterInput[] = [];
  for (const post of posts) {
    let vector = parseVector(post.embedding);
    if (!vector) {
      vector = await embed(postEmbeddingText(post.title, post.body));
      await db.from("posts").update({ embedding: vector }).eq("id", post.id);
    }
    prepared.push({
      id: post.id,
      title: post.title,
      body: post.body,
      votes: post.vote_count,
      embedding: vector,
    });
  }

  const clusters = clusterPosts(prepared).filter((c) => c.postIds.length >= 2);
  if (!clusters.length) {
    return {
      ok: false as const,
      error: "Not enough similar posts to form a theme yet.",
    };
  }

  const { data: existing } = await db
    .from("themes")
    .select("id,name")
    .eq("board_id", ctx.board.id);

  const byName = new Map((existing ?? []).map((t) => [t.name.toLowerCase(), t.id]));
  const keptIds = new Set<string>();

  try {
    for (const cluster of clusters) {
      const named = await nameCluster(cluster.titles);
      const key = named.name.toLowerCase();
      let themeId = byName.get(key);

      if (themeId) {
        await db
          .from("themes")
          .update({ summary: named.summary, centroid: cluster.centroid })
          .eq("id", themeId);
      } else {
        const { data: created } = await db
          .from("themes")
          .insert({
            board_id: ctx.board.id,
            name: named.name,
            summary: named.summary,
            centroid: cluster.centroid,
          })
          .select("id")
          .single();
        themeId = created?.id;
        if (themeId) byName.set(key, themeId);
      }

      if (!themeId) continue;
      keptIds.add(themeId);
      await db.from("posts").update({ theme_id: themeId }).in("id", cluster.postIds);
    }
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      return { ok: false as const, error: err.message };
    }
    return {
      ok: false as const,
      error: explainAiError(err),
    };
  }

  // Drop themes that no longer hold any posts.
  const stale = (existing ?? []).filter((t) => !keptIds.has(t.id)).map((t) => t.id);
  if (stale.length) {
    await db.from("posts").update({ theme_id: null }).in("theme_id", stale);
    await db.from("themes").delete().in("id", stale);
  }

  revalidatePath("/themes");
  revalidatePath("/");
  return { ok: true as const, themes: keptIds.size };
}

export async function renameTheme(themeId: string, name: string) {
  await requireFounder();
  const db = await supabaseServer();
  const { error } = await db
    .from("themes")
    .update({ name: name.slice(0, 80) })
    .eq("id", themeId);
  revalidatePath("/themes");
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

/**
 * pgvector hands embeddings back as a string like "[0.1,0.2,...]" over the
 * REST API, so it has to be parsed before it can be compared.
 */
function parseVector(value: unknown): number[] | null {
  if (Array.isArray(value)) return value as number[];
  if (typeof value === "string" && value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value) as number[];
      return parsed.length ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}
