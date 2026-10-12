import { notFound, redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { requireFounder } from "@/server/context";
import { PLANS } from "@/lib/plans";
import { hasAnthropic } from "@/lib/ai/client";
import { defaultTargetFor } from "@/lib/ai/targets";
import { postIdForNumber, postSubject, profileSummary, promptHistory, themeSubject } from "@/server/prompts";
import { PromptWorkbench } from "../prompt-workbench";
import type { PromptTarget } from "@/lib/types";

/** 09 · Build Prompt, before anything is generated. */
/**
 * Generating a Build Prompt is one long model call, and the action that
 * does it posts back to this route.
 */
export const maxDuration = 60;

export default async function NewPromptPage({
  searchParams,
}: {
  searchParams: Promise<{ post?: string; theme?: string; target?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requireFounder();
  const plan = PLANS[ctx.workspace.plan];

  // Nothing picked yet: send the founder to the list, which offers the
  // top requests to start from.
  if (!params.post && !params.theme) redirect("/prompts");

  const subject = params.post
    ? await postSubject(ctx.board.id, Number(params.post))
    : await themeSubject(params.theme!);
  if (!subject) notFound();

  const postId = params.post
    ? ((await postIdForNumber(ctx.board.id, Number(params.post))) ?? undefined)
    : undefined;

  const history = await promptHistory({ postId, themeId: params.theme });

  return (
    <Shell active="prompts" ctx={ctx} wide>
      <PromptWorkbench
        subject={subject}
        profile={profileSummary(ctx)}
        initialPrompt={null}
        history={history}
        promptsLeft={Math.max(0, plan.buildPrompts - ctx.workspace.prompts_used)}
        promptLimit={plan.buildPrompts}
        defaultTarget={
          (params.target as PromptTarget | undefined) ??
          defaultTargetFor(ctx.workspace.coding_tools)
        }
        aiReady={hasAnthropic()}
      />
    </Shell>
  );
}
