import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import {
  VISITOR_COOKIE,
  getPublicBoard,
  readBoardView,
} from "@/server/public-board";
import { PublicBoardView } from "./public-view";

/**
 * The public board, rendered the same way whether it was reached at
 * /b/<id> or at a founder's own domain. Only the route differs.
 */
export async function PublicBoard({
  publicId,
  tab,
  verified,
}: {
  publicId: string;
  tab?: string;
  verified?: string;
}) {
  const board = await getPublicBoard(publicId);
  if (!board) notFound();

  const store = await cookies();
  const email = store.get(`euclid_email_${board.id}`)?.value ?? null;

  const { viewer, posts, changelog } = await readBoardView({
    board,
    cookieKey: store.get(VISITOR_COOKIE)?.value ?? null,
    token: null,
    email,
    limit: 100,
  });

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
      initialTab={tab === "changelog" ? "changelog" : tab === "ideas" ? "ideas" : "roadmap"}
      justVerified={verified === "1"}
    />
  );
}
