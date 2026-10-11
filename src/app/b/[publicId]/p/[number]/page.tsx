import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { supabaseAdmin, hasServiceRole } from "@/lib/supabase/server";
import { VISITOR_COOKIE, getPublicBoard, resolveViewer } from "@/server/public-board";
import { EMAIL_COOKIE } from "@/server/identity";
import { PublicPostView } from "./post-view";
import type { PostStatus } from "@/lib/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ publicId: string; number: string }>;
}): Promise<Metadata> {
  const { publicId, number } = await params;
  const board = await getPublicBoard(publicId);
  if (!board || !hasServiceRole()) return { title: "Not found" };

  const { data } = await supabaseAdmin()
    .from("posts")
    .select("title")
    .eq("board_id", board.id)
    .eq("number", Number(number))
    .maybeSingle();

  return data
    ? { title: `${data.title} · ${board.appName ?? board.name}` }
    : { title: "Not found" };
}

/** A single post on the public board, so a permalink can be shared. */
export default async function PublicPostPage({
  params,
}: {
  params: Promise<{ publicId: string; number: string }>;
}) {
  const { publicId, number } = await params;
  const board = await getPublicBoard(publicId);
  if (!board || !hasServiceRole()) notFound();

  const db = supabaseAdmin();
  const { data: post } = await db
    .from("posts")
    .select("id,number,title,body,status,vote_count,comment_count,created_at,merged_into")
    .eq("board_id", board.id)
    .eq("number", Number(number))
    .maybeSingle();

  if (!post) notFound();

  // A merged post redirects its readers to the survivor.
  if (post.merged_into) {
    const { data: target } = await db
      .from("posts")
      .select("number")
      .eq("id", post.merged_into)
      .maybeSingle();
    if (target) {
      const { redirect } = await import("next/navigation");
      redirect(`/b/${publicId}/p/${target.number}`);
    }
  }

  const store = await cookies();
  const viewer = await resolveViewer({
    board,
    cookieKey: store.get(VISITOR_COOKIE)?.value ?? null,
    token: null,
    email: store.get(`${EMAIL_COOKIE}_${board.id}`)?.value ?? null,
  });

  const [{ data: comments }, { data: myVote }] = await Promise.all([
    db
      .from("comments")
      .select("id,author_name,body,created_at")
      .eq("post_id", post.id)
      .eq("internal", false)
      .order("created_at", { ascending: true })
      .limit(100),
    viewer
      ? db
          .from("votes")
          .select("id")
          .eq("post_id", post.id)
          .eq("end_user_id", viewer.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return (
    <PublicPostView
      publicId={board.publicId}
      appName={board.appName ?? board.workspaceName}
      design={board.design}
      showBadge={board.showBadge}
      post={{
        id: post.id,
        number: post.number,
        title: post.title,
        body: post.body,
        status: post.status as PostStatus,
        votes: post.vote_count,
        comments: post.comment_count,
        voted: Boolean(myVote),
        createdAt: post.created_at,
      }}
      comments={(comments ?? []).map((c) => ({
        id: c.id,
        author: c.author_name,
        body: c.body,
        createdAt: c.created_at,
      }))}
      canComment={Boolean(viewer)}
    />
  );
}
