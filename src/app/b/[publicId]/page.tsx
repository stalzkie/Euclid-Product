import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import {
  VISITOR_COOKIE,
  getPublicBoard,
  listPublicChangelog,
  listPublicPosts,
  resolveViewer,
} from "@/server/public-board";
import { PublicBoardView } from "./public-view";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ publicId: string }>;
}): Promise<Metadata> {
  const { publicId } = await params;
  const board = await getPublicBoard(publicId);
  if (!board) return { title: "Board not found" };

  return {
    title: `${board.design.heading} · ${board.appName ?? board.name}`,
    description: board.design.subheading,
    openGraph: {
      title: board.design.heading,
      description: board.design.subheading,
    },
  };
}

/** 16 · Public board — ideas, roadmap and changelog on a shareable URL. */
export default async function PublicBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<{ tab?: string; verified?: string }>;
}) {
  const { publicId } = await params;
  const query = await searchParams;

  const board = await getPublicBoard(publicId);
  if (!board) notFound();

  const store = await cookies();
  const email = store.get(`euclid_email_${board.id}`)?.value ?? null;

  const viewer = await resolveViewer({
    board,
    cookieKey: store.get(VISITOR_COOKIE)?.value ?? null,
    token: null,
    email,
  });

  const [posts, changelog] = await Promise.all([
    listPublicPosts(board.id, viewer?.id ?? null, { limit: 100 }),
    listPublicChangelog(board.id),
  ]);

  return (
    <PublicBoardView
      publicId={board.publicId}
      appName={board.appName ?? board.workspaceName}
      appUrl={board.appUrl}
      design={board.design}
      showBadge={board.showBadge}
      categories={board.categories}
      identityMode={board.identityMode}
      viewerLabel={viewer?.label ?? null}
      posts={posts}
      changelog={changelog}
      initialTab={
        query.tab === "changelog"
          ? "changelog"
          : query.tab === "ideas"
            ? "ideas"
            : "roadmap"
      }
      justVerified={query.verified === "1"}
    />
  );
}
