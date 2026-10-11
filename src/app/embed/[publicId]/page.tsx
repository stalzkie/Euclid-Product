import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import {
  VISITOR_COOKIE,
  getPublicBoard,
  listPublicChangelog,
  listPublicPosts,
  originAllowed,
  resolveViewer,
} from "@/server/public-board";
import { hasServiceRole, supabaseAdmin } from "@/lib/supabase/server";
import { EmbeddedBoard } from "./embedded-board";

/**
 * The embedded board. The widget loader drops an iframe pointing here, which
 * is what gives the board its own origin — the host page's CSS cannot reach in,
 * and the board's CSS cannot leak out.
 */
export default async function EmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<{ token?: string; mode?: string }>;
}) {
  const { publicId } = await params;
  const query = await searchParams;

  const board = await getPublicBoard(publicId);
  if (!board) notFound();

  const headerList = await headers();
  const origin = headerList.get("referer");

  if (!originAllowed(board, origin)) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="max-w-[360px] text-center text-[13px] leading-[1.6] text-ink-3">
          This board is not allow-listed for this domain. Add it under Install widget in
          the Euclid dashboard.
        </p>
      </main>
    );
  }

  const store = await cookies();
  const email = store.get(`euclid_email_${board.id}`)?.value ?? null;

  const viewer = await resolveViewer({
    board,
    cookieKey: store.get(VISITOR_COOKIE)?.value ?? null,
    token: query.token ?? null,
    email,
  });

  const [posts, changelog] = await Promise.all([
    listPublicPosts(board.id, viewer?.id ?? null, { limit: 60 }),
    board.design.showChangelog ? listPublicChangelog(board.id) : Promise.resolve([]),
  ]);

  // Record that the widget was actually served, which is the install signal the
  // onboarding screen polls for.
  if (hasServiceRole()) {
    await supabaseAdmin().rpc("check_rate_limit", {
      p_board: board.id,
      p_bucket: "load",
      p_actor: "widget",
      p_max: 1_000_000,
      p_window: "1 day",
    });
  }

  return (
    <EmbeddedBoard
      publicId={board.publicId}
      boardName={board.name}
      appName={board.appName ?? board.workspaceName}
      design={{
        ...board.design,
        mode: query.mode === "inline" ? "inline" : board.design.mode,
      }}
      showBadge={board.showBadge}
      categories={board.categories}
      identityMode={board.identityMode}
      token={query.token ?? null}
      viewerLabel={viewer?.label ?? null}
      posts={posts}
      changelog={changelog}
    />
  );
}
