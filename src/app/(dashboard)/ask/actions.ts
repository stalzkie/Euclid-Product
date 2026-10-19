"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuid } from "@/lib/validation";
import { supabaseServer } from "@/lib/supabase/server";
import { requireFounder } from "@/server/context";
import { askEuclid } from "@/lib/ai/assistant";
import { AiUnavailableError, explainAiError } from "@/lib/ai/client";
import { PLANS, hasChatAllowance } from "@/lib/plans";
import { RATE_LIMITED, withinLimit } from "@/server/limits";
import type { ChatMessage } from "@/lib/types";

/** Ask Euclid. One credit per question; answers always cite their posts. */

const Ask = z.object({
  threadId: uuid().nullable(),
  question: z.string().min(2).max(1000),
});

export type AskResponse =
  | { ok: true; threadId: string; message: ChatMessage; creditsLeft: number }
  | { ok: false; error: string; code?: "limit" | "no_key" | "plan" };

export async function ask(input: z.infer<typeof Ask>): Promise<AskResponse> {
  const parsed = Ask.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Ask a question first." };

  const ctx = await requireFounder();
  const db = await supabaseServer();
  const plan = PLANS[ctx.workspace.plan];

  // Ahead of the plan and allowance checks for the reason given on the Build
  // Prompt path: it is the cheapest refusal and the one that bounds how many
  // simultaneous questions can pass a check none of them has been counted
  // against yet. It matters more here — a question is four to seven credits.
  if (!(await withinLimit(ctx.workspace.id, "ask", ctx.userId))) {
    return { ok: false, error: RATE_LIMITED };
  }

  if (!plan.chatAssistant) {
    return {
      ok: false,
      code: "plan",
      error: `Ask Euclid is on the Pro plan. You are on ${plan.name}.`,
    };
  }
  const extraCredits = ctx.workspace.extra_chat_credits ?? 0;
  if (!hasChatAllowance(ctx.workspace.plan, ctx.workspace.chat_credits_used, extraCredits)) {
    return {
      ok: false,
      code: "limit",
      error: `You have used all ${plan.chatCredits} chat credits this month.`,
    };
  }

  // Start or continue a thread.
  let threadId: string | null = parsed.data.threadId;
  if (!threadId) {
    const { data: thread, error } = await db
      .from("chat_threads")
      .insert({
        workspace_id: ctx.workspace.id,
        board_id: ctx.board.id,
        title: parsed.data.question.slice(0, 80),
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error || !thread) {
      return { ok: false, error: error?.message ?? "Could not start a thread." };
    }
    threadId = thread.id;
  }

  const { data: priorRows } = await db
    .from("chat_messages")
    .select("role,content")
    .eq("thread_id", threadId)
    .order("created_at")
    .limit(20);

  const history = (priorRows ?? []).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  await db.from("chat_messages").insert({
    thread_id: threadId,
    role: "user",
    content: parsed.data.question,
  });

  let answer;
  try {
    answer = await askEuclid(ctx.board.id, history, parsed.data.question);
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      return { ok: false, code: "no_key", error: err.message };
    }
    return {
      ok: false,
      error: explainAiError(err),
    };
  }

  const { data: saved, error } = await db
    .from("chat_messages")
    .insert({
      thread_id: threadId,
      role: "assistant",
      content: answer.content,
      steps: answer.steps,
      citations: answer.citations,
      follow_ups: answer.followUps,
    })
    .select("*")
    .single();

  if (error || !saved) {
    return { ok: false, error: error?.message ?? "Could not save the answer." };
  }

  // One credit per step the model took, with a floor of one, so a cheap
  // question costs less than an expensive one.
  const cost = Math.max(1, answer.steps.length);

  /*
    The monthly allowance first, a purchased balance only once it is gone. A
    question costing more credits than remain is allowed to finish: it is
    already answered by the time this runs, and billing someone by killing an
    answer they are reading would be the wrong trade. `spend_allowance` keeps
    that floor.

    Through the function rather than a read-compute-write from here, for the
    reason in 0022_atomic_allowance.sql: this call site wrote an absolute
    value derived from a snapshot taken when the request started, so parallel
    questions each overwrote the others' increment and cost nothing. It
    mattered more here than on Build Prompts, because a question is four to
    seven credits rather than one.
  */
  const { data: spent, error: spendError } = await db
    .rpc("spend_allowance", {
      p_workspace: ctx.workspace.id,
      p_kind: "credits",
      p_cost: cost,
      p_limit: plan.chatCredits,
    })
    .maybeSingle<{ used: number; extra: number }>();

  // Swallowed for the same reason as on the Build Prompt path: the answer is
  // saved and about to be rendered, and failing the request over an
  // accounting error would lose it.
  if (spendError) {
    console.error(`[ask] could not meter spend for ${ctx.workspace.id}: ${spendError.message}`);
  }

  revalidatePath("/ask");

  return {
    ok: true,
    threadId: threadId as string,
    message: saved as ChatMessage,
    // What the spend wrote, for the reason given on the Build Prompt path:
    // the opening snapshot plus the cost is wrong whenever two questions
    // overlap, and here the cost is four to seven rather than one.
    creditsLeft: Math.max(
      0,
      plan.chatCredits - (spent?.used ?? ctx.workspace.chat_credits_used + cost),
    ),
  };
}

export async function listThreads() {
  const ctx = await requireFounder();
  const db = await supabaseServer();
  const { data } = await db
    .from("chat_threads")
    .select("id,title,created_at")
    .eq("workspace_id", ctx.workspace.id)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []) as { id: string; title: string; created_at: string }[];
}

export async function deleteThread(threadId: string) {
  await requireFounder();
  const db = await supabaseServer();
  const { error } = await db.from("chat_threads").delete().eq("id", threadId);
  revalidatePath("/ask");
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}
