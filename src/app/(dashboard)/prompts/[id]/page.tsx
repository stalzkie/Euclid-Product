import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { requireFounder } from "@/server/context";
import { supabaseServer } from "@/lib/supabase/server";
import { PLANS } from "@/lib/plans";
import { hasAnthropic } from "@/lib/ai/client";
import { postSubject, profileSummary, promptHistory, themeSubject } from "@/server/prompts";
import { PromptWorkbench } from "../prompt-workbench";
import type { BuildPrompt } from "@/lib/types";

/** A saved Build Prompt, reopened. */
/**
 * Refining a Build Prompt is a model call, and the action that does it
 * posts back to this route.
 */
export const maxDuration = 60;

export default async function PromptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireFounder();
  const db = await supabaseServer();
  const plan = PLANS[ctx.workspace.plan];

  const { data: prompt } = await db
    .from("build_prompts")
    .select("*, posts(number)")
    .eq("id", id)
    .maybeSingle();
  if (!prompt) notFound();

  const postNumber = Array.isArray(prompt.posts)
    ? prompt.posts[0]?.number
    : (prompt.posts as { number?: number } | null)?.number;

  const subject = postNumber
    ? await postSubject(ctx.board.id, postNumber)
    : prompt.theme_id
      ? await themeSubject(prompt.theme_id)
      : null;
  if (!subject) notFound();

  const history = await promptHistory({
    postId: prompt.post_id ?? undefined,
    themeId: prompt.theme_id ?? undefined,
  });

  return (
    <Shell active="prompts" ctx={ctx} wide>
      <PromptWorkbench
        subject={subject}
        profile={profileSummary(ctx)}
        initialPrompt={prompt as BuildPrompt}
        history={history}
        promptsLeft={Math.max(0, plan.buildPrompts - ctx.workspace.prompts_used)}
        promptLimit={plan.buildPrompts}
        defaultTarget={prompt.target}
        aiReady={hasAnthropic()}
      />
    </Shell>
  );
}
