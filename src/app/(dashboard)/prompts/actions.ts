"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuid } from "@/lib/validation";
import { supabaseServer } from "@/lib/supabase/server";
import { requireFounder } from "@/server/context";
import { PLANS, hasPromptAllowance, spendAllowance } from "@/lib/plans";
import {
  assemblePrompt,
  generateDraft,
  toAssumptions,
  type DemandContext,
  type GenerateInput,
} from "@/lib/ai/build-prompt";
import { AiUnavailableError, explainAiError } from "@/lib/ai/client";
import { targetSpec } from "@/lib/ai/targets";
import {
  type Assumption,
  type BuildPrompt,
  type PromptIncludes,
  type PromptTarget,
} from "@/lib/types";
import { getRepoSnapshot } from "@/server/repo-context";

/**
 * Build Prompt generation and refinement. Every call checks the workspace's
 * monthly allowance before it spends a token — AI cost control is a product
 * requirement, not an afterthought.
 */

const Generate = z.object({
  postNumber: z.number().int().positive().optional(),
  themeId: uuid().optional(),
  target: z.enum(["claude", "codex", "cursor", "builder", "generic"]),
  includes: z.object({
    quotes: z.boolean(),
    demand: z.boolean(),
    profile: z.boolean(),
    rules: z.boolean(),
    notes: z.boolean(),
  }),
  founderNotes: z.string().max(2000).nullable(),
  /** Set when the founder typed a refinement instead of starting fresh. */
  refinement: z.string().max(500).nullable().optional(),
  previousId: uuid().nullable().optional(),
  assumptions: z
    .array(z.object({ id: z.number(), text: z.string(), confirmed: z.boolean() }))
    .optional(),
});

export type GenerateArgs = z.infer<typeof Generate>;

export type GenerateResponse =
  | { ok: true; prompt: BuildPrompt; promptsLeft: number }
  | { ok: false; error: string; code?: "limit" | "no_key" | "not_found" };

export async function generateBuildPrompt(args: GenerateArgs): Promise<GenerateResponse> {
  const parsed = Generate.safeParse(args);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const input = parsed.data;

  const ctx = await requireFounder();
  const db = await supabaseServer();
  const plan = PLANS[ctx.workspace.plan];

  const extraPrompts = ctx.workspace.extra_prompts ?? 0;
  if (!hasPromptAllowance(ctx.workspace.plan, ctx.workspace.prompts_used, extraPrompts)) {
    return {
      ok: false,
      code: "limit",
      error: `You have used all ${plan.buildPrompts} Build Prompts on the ${plan.name} plan this month.`,
    };
  }

  // Gather the context the prompt rests on.
  const demand = await collectDemand(input);
  if (!demand) return { ok: false, code: "not_found", error: "That post no longer exists." };

  const genInput: GenerateInput = {
    target: input.target as PromptTarget,
    includes: input.includes as PromptIncludes,
    post: demand.post,
    demand: demand.context,
    profile: ctx.profile,
    founderNotes: input.founderNotes,
    refinement: input.refinement ?? null,
    previous: demand.previousBody,
    repo: await getRepoSnapshot(ctx.board.id),
  };

  let draft;
  try {
    draft = await generateDraft(genInput);
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      return { ok: false, code: "no_key", error: err.message };
    }
    return {
      ok: false,
      error: explainAiError(err),
    };
  }

  // Keep assumptions the founder already confirmed; they drop out of the body.
  const confirmed = new Set(
    (input.assumptions ?? []).filter((a) => a.confirmed).map((a) => a.text),
  );
  const assumptions: Assumption[] = toAssumptions(draft.assumptions).map((a) => ({
    ...a,
    confirmed: confirmed.has(a.text),
  }));

  const result = assemblePrompt(genInput, draft, assumptions);

  const { data: existing } = await db
    .from("build_prompts")
    .select("version")
    .eq(input.postNumber ? "post_id" : "theme_id", demand.subjectId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: saved, error } = await db
    .from("build_prompts")
    .insert({
      workspace_id: ctx.workspace.id,
      post_id: demand.postId,
      theme_id: input.themeId ?? null,
      target: input.target,
      version: (existing?.version ?? 0) + 1,
      title: result.title,
      body: result.body,
      context_block: result.contextBlock,
      assumptions: result.assumptions,
      includes: input.includes,
      founder_notes: input.founderNotes,
      token_estimate: result.tokenEstimate,
      created_by: ctx.userId,
    })
    .select("*")
    .single();

  if (error) return { ok: false, error: error.message };

  if (input.refinement) {
    await db.from("build_prompt_messages").insert([
      { build_prompt_id: saved.id, role: "user", content: input.refinement },
      {
        build_prompt_id: saved.id,
        role: "assistant",
        content: `Regenerated as v${saved.version} with that change applied.`,
      },
    ]);
  }

  // Meter the spend: the monthly allowance first, a purchased balance only
  // once that is gone. Both columns are written together, because which one
  // moved is decided by `spendAllowance` and not by this call site.
  const spent = spendAllowance({
    used: ctx.workspace.prompts_used,
    limit: plan.buildPrompts,
    extra: extraPrompts,
  });
  await db
    .from("workspaces")
    .update({ prompts_used: spent.used, extra_prompts: spent.extra })
    .eq("id", ctx.workspace.id);

  await db.from("activity").insert({
    workspace_id: ctx.workspace.id,
    board_id: ctx.board.id,
    post_id: demand.postId,
    kind: "prompt",
    text: `Build Prompt ${input.refinement ? "refined" : "generated"} for ${result.title} (${
      targetSpec(input.target as PromptTarget).label
    })`,
    meta: `v${saved.version} · ${result.assumptions.length} assumptions to check`,
  });

  revalidatePath("/prompts");
  revalidatePath("/");

  return {
    ok: true,
    prompt: saved as BuildPrompt,
    promptsLeft: Math.max(0, plan.buildPrompts - (ctx.workspace.prompts_used + 1)),
  };
}

/**
 * Pulls together the request, the real wording users used, and the demand
 * behind it. Quotes come from the post body, its comments and anything merged
 * into it — the "short quotes from posts and comments" the PRD calls for.
 */
async function collectDemand(input: GenerateArgs): Promise<{
  post: GenerateInput["post"];
  context: DemandContext;
  postId: string | null;
  subjectId: string;
  previousBody: string | null;
} | null> {
  const ctx = await requireFounder();
  const db = await supabaseServer();

  let previousBody: string | null = null;
  if (input.previousId) {
    const { data } = await db
      .from("build_prompts")
      .select("body")
      .eq("id", input.previousId)
      .maybeSingle();
    previousBody = data?.body ?? null;
  }

  // Theme-level prompt: the whole cluster becomes the request.
  if (input.themeId && !input.postNumber) {
    const { data: theme } = await db
      .from("themes")
      .select("id,name,summary")
      .eq("id", input.themeId)
      .maybeSingle();
    if (!theme) return null;

    const { data: posts } = await db
      .from("posts")
      .select("id,title,body,vote_count")
      .eq("theme_id", theme.id)
      .is("merged_into", null)
      .order("vote_count", { ascending: false })
      .limit(10);

    const votes = (posts ?? []).reduce((a, p) => a + p.vote_count, 0);
    const quotes = (posts ?? [])
      .map((p) => p.body)
      .filter((b): b is string => Boolean(b))
      .slice(0, 6);

    return {
      post: {
        number: 0,
        title: theme.name,
        body:
          `${theme.summary ?? ""}\n\nThe posts in this theme:\n` +
          (posts ?? []).map((p) => `- ${p.title} (${p.vote_count} votes)`).join("\n"),
        theme: theme.name,
      },
      context: {
        votes,
        payingShare: 0,
        mergedCount: 0,
        commentCount: 0,
        quotes,
        segments: [],
      },
      postId: null,
      subjectId: theme.id,
      previousBody,
    };
  }

  const { data: post } = await db
    .from("posts")
    .select("id,number,title,body,vote_count,comment_count,founder_notes,themes(name)")
    .eq("board_id", ctx.board.id)
    .eq("number", input.postNumber ?? -1)
    .maybeSingle();
  if (!post) return null;

  const [{ data: comments }, { data: merged }, { data: payingShare }, { data: segments }] =
    await Promise.all([
      db
        .from("comments")
        .select("body")
        .eq("post_id", post.id)
        .eq("internal", false)
        .order("created_at", { ascending: false })
        .limit(24),
      db.from("posts").select("id,title,body").eq("merged_into", post.id),
      db.rpc("post_paying_share", { p_post: post.id }),
      db.rpc("board_votes_by_plan", { p_board: ctx.board.id }),
    ]);

  // The post body and the merged posts' bodies are user wording too.
  const quotes = [
    ...(comments ?? []).map((c) => c.body),
    ...(merged ?? []).map((m) => m.body).filter((b): b is string => Boolean(b)),
  ]
    .filter((q) => q.trim().length > 12)
    .slice(0, 8);

  const themeName =
    (Array.isArray(post.themes) ? post.themes[0]?.name : (post.themes as { name?: string } | null)?.name) ??
    null;

  return {
    post: {
      number: post.number,
      title: post.title,
      body: post.body,
      theme: themeName,
    },
    context: {
      votes: post.vote_count,
      payingShare: Number(payingShare ?? 0),
      mergedCount: (merged ?? []).length,
      commentCount: post.comment_count,
      quotes,
      segments: ((segments ?? []) as { plan: string; votes: number }[]).map((s) => ({
        plan: s.plan,
        votes: Number(s.votes),
      })),
    },
    postId: post.id,
    subjectId: post.id,
    previousBody,
  };
}

/** Confirming an assumption drops it out of the prompt body. */
export async function confirmAssumption(promptId: string, assumptionId: number) {
  await requireFounder();
  const db = await supabaseServer();

  const { data: prompt } = await db
    .from("build_prompts")
    .select("assumptions, body")
    .eq("id", promptId)
    .maybeSingle();
  if (!prompt) return { ok: false as const, error: "Prompt not found." };

  const assumptions = (prompt.assumptions as Assumption[]).map((a) =>
    a.id === assumptionId ? { ...a, confirmed: true } : a,
  );

  const open = assumptions.filter((a) => !a.confirmed);
  const body = rewriteAssumptionSection(prompt.body as string, open);

  const { error } = await db
    .from("build_prompts")
    .update({ assumptions, body })
    .eq("id", promptId);

  revalidatePath("/prompts");
  return error
    ? { ok: false as const, error: error.message }
    : { ok: true as const, assumptions, body };
}

/**
 * Rewrites just the assumptions block, so confirming one does not cost a
 * regeneration.
 */
function rewriteAssumptionSection(body: string, open: Assumption[]): string {
  const marker = "## Assumptions to verify before coding";
  const start = body.indexOf(marker);
  if (start === -1) return body;

  const after = body.indexOf("\n## ", start + marker.length);
  const tail = after === -1 ? "" : body.slice(after);

  if (!open.length) return `${body.slice(0, start).trimEnd()}${tail ? `\n\n${tail.trim()}` : "\n"}`;

  const section = `${marker}\n${open.map((a, i) => `${i + 1}. ${a.text}`).join("\n")}`;
  return `${body.slice(0, start)}${section}${tail}`;
}

export async function markCopied(promptId: string) {
  await requireFounder();
  const db = await supabaseServer();
  await db.from("build_prompts").update({ copied: true }).eq("id", promptId);
  return { ok: true as const };
}

export async function setPromptNotes(promptId: string, notes: string) {
  await requireFounder();
  const db = await supabaseServer();
  await db
    .from("build_prompts")
    .update({ founder_notes: notes.slice(0, 2000) })
    .eq("id", promptId);
  return { ok: true as const };
}

