import { supabaseServer } from "@/lib/supabase/server";
import type { BuildPrompt } from "@/lib/types";
import type { FounderContext } from "./context";
import type { ProfileSummary, Subject } from "@/app/(dashboard)/prompts/prompt-workbench";

/** Shared loaders for the Build Prompt screens. */

export function profileSummary(ctx: FounderContext): ProfileSummary {
  const profile = ctx.profile;
  const stack = profile?.stack ?? [];
  return {
    hasProfile: stack.length > 0,
    stackLine: stack.length
      ? stack
          .slice(0, 3)
          .map((s) => s.name)
          .join(" · ")
      : "",
    rulesName: profile?.rules_file_name ?? "CLAUDE.md",
    rulesBytes: profile?.rules_file ? new TextEncoder().encode(profile.rules_file).length : 0,
  };
}

/** The post a prompt is about, with the demand numbers the toggles describe. */
export async function postSubject(
  boardId: string,
  number: number,
): Promise<Subject | null> {
  const db = await supabaseServer();
  const { data: post } = await db
    .from("posts")
    .select("id,number,title,vote_count,comment_count,founder_notes,themes(name)")
    .eq("board_id", boardId)
    .eq("number", number)
    .maybeSingle();
  if (!post) return null;

  const [{ count: merged }, { data: payingShare }, { count: quotable }] = await Promise.all([
    db
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("merged_into", post.id),
    db.rpc("post_paying_share", { p_post: post.id }),
    db
      .from("comments")
      .select("id", { count: "exact", head: true })
      .eq("post_id", post.id)
      .eq("internal", false),
  ]);

  const themeName = Array.isArray(post.themes)
    ? (post.themes[0]?.name ?? null)
    : ((post.themes as { name?: string } | null)?.name ?? null);

  return {
    kind: "post",
    number: post.number,
    title: post.title,
    votes: post.vote_count,
    payingShare: Number(payingShare ?? 0),
    commentCount: post.comment_count,
    mergedCount: merged ?? 0,
    quoteCount: Math.min(8, quotable ?? 0),
    founderNotes: post.founder_notes,
    themeName,
  };
}

/** A whole theme as the subject, for prompting at the cluster level. */
export async function themeSubject(themeId: string): Promise<Subject | null> {
  const db = await supabaseServer();
  const { data: theme } = await db
    .from("themes")
    .select("id,name,posts(vote_count,comment_count)")
    .eq("id", themeId)
    .maybeSingle();
  if (!theme) return null;

  const posts = (theme.posts as { vote_count: number; comment_count: number }[] | null) ?? [];
  return {
    kind: "theme",
    themeId: theme.id,
    title: theme.name,
    votes: posts.reduce((a, p) => a + p.vote_count, 0),
    payingShare: 0,
    commentCount: posts.reduce((a, p) => a + p.comment_count, 0),
    mergedCount: 0,
    quoteCount: Math.min(6, posts.length),
    founderNotes: null,
    themeName: theme.name,
  };
}

export async function promptHistory(
  subject: { postId?: string; themeId?: string },
): Promise<Pick<BuildPrompt, "id" | "version" | "target" | "created_at" | "copied">[]> {
  const db = await supabaseServer();
  let q = db
    .from("build_prompts")
    .select("id,version,target,created_at,copied")
    .order("version", { ascending: false });

  if (subject.postId) q = q.eq("post_id", subject.postId);
  else if (subject.themeId) q = q.eq("theme_id", subject.themeId);
  else return [];

  const { data } = await q;
  return (data ?? []) as Pick<
    BuildPrompt,
    "id" | "version" | "target" | "created_at" | "copied"
  >[];
}

export async function postIdForNumber(
  boardId: string,
  number: number,
): Promise<string | null> {
  const db = await supabaseServer();
  const { data } = await db
    .from("posts")
    .select("id")
    .eq("board_id", boardId)
    .eq("number", number)
    .maybeSingle();
  return data?.id ?? null;
}
