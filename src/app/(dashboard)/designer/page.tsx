import { Shell } from "@/components/shell";
import { requireFounder } from "@/server/context";
import { listPosts } from "@/server/queries";
import { mergeDesign } from "@/lib/design-presets";
import { PLANS } from "@/lib/plans";
import { DesignerView } from "./designer-view";

/** 12 · Board designer. */
export default async function DesignerPage() {
  const ctx = await requireFounder();
  const posts = await listPosts(ctx.board.id, { limit: 8 });
  const plan = PLANS[ctx.workspace.plan];

  return (
    <Shell active="designer" ctx={ctx} wide>
      <DesignerView
        boardId={ctx.board.id}
        boardName={ctx.board.name}
        boardColor={ctx.board.color}
        design={mergeDesign(ctx.board.design)}
        showBadge={ctx.board.show_badge}
        badgeRemovable={!plan.badge}
        planName={plan.name}
        appUrl={ctx.workspace.app_url}
        posts={posts.map((p) => ({
          id: p.id,
          number: p.number,
          title: p.title,
          status: p.status,
          votes: p.vote_count,
          comments: p.comment_count,
          voted: false,
        }))}
      />
    </Shell>
  );
}
