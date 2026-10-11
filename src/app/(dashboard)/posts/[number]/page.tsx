import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { requireFounder } from "@/server/context";
import { getPost, listThemes } from "@/server/queries";
import { PLANS } from "@/lib/plans";
import { PostDetailView } from "./post-view";

/** 07 · Post detail. */
export default async function PostPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const { number } = await params;
  const ctx = await requireFounder();
  const n = Number(number);
  if (!Number.isFinite(n)) notFound();

  const post = await getPost(ctx.board.id, n);
  if (!post) notFound();

  const themes = await listThemes(ctx.board.id);
  const plan = PLANS[ctx.workspace.plan];

  return (
    <Shell active="feedback" ctx={ctx}>
      <PostDetailView
        post={post}
        boardName={ctx.board.name}
        boardColor={ctx.board.color}
        boardPublicId={ctx.board.public_id}
        identityMode={ctx.board.identity_mode}
        themes={themes.map((t) => ({ id: t.id, name: t.name }))}
        founderName={ctx.name}
        promptsLeft={Math.max(0, plan.buildPrompts - ctx.workspace.prompts_used)}
        codingTools={ctx.workspace.coding_tools}
      />
    </Shell>
  );
}
