import { Shell } from "@/components/shell";
import { requireFounder } from "@/server/context";
import {
  getHeldCount,
  getMergeQueueCount,
  getStatusCounts,
  listPosts,
  listThemes,
} from "@/server/queries";
import { InboxTable } from "./inbox-table";
import { MergeQueue } from "./merge-queue";
import { HeldQueue } from "./held-queue";
import { listHeldPosts, listMergeQueue } from "./actions";

/** 06 · Feedback inbox — every post on this board, ranked by votes. */
export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requireFounder();
  const board = ctx.board;

  const [posts, counts, themes, dupeCount, heldCount] = await Promise.all([
    listPosts(board.id, { limit: 200, search: params.q }),
    getStatusCounts(board.id),
    listThemes(board.id),
    getMergeQueueCount(board.id),
    getHeldCount(board.id),
  ]);

  const showMerges = params.view === "merges";
  const showHeld = params.view === "held";
  const groups = showMerges ? await listMergeQueue(board.id) : [];
  const held = showHeld ? await listHeldPosts(board.id) : [];

  return (
    <Shell active="feedback" ctx={ctx}>
      {showHeld ? (
        <HeldQueue posts={held} boardName={board.name} />
      ) : showMerges ? (
        <MergeQueue groups={groups} boardName={board.name} />
      ) : (
        <InboxTable
          posts={posts}
          counts={counts}
          themes={themes.map((t) => ({ id: t.id, name: t.name }))}
          boardName={board.name}
          boardCount={ctx.boards.length}
          duplicateCount={dupeCount}
          heldCount={heldCount}
          search={params.q ?? ""}
          categories={board.categories}
        />
      )}
    </Shell>
  );
}
