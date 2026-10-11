"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuid } from "@/lib/validation";
import { supabaseServer } from "@/lib/supabase/server";
import { requireFounder } from "@/server/context";
import { askEuclid } from "@/lib/ai/assistant";
import { AiUnavailableError, explainAiError } from "@/lib/ai/client";
import { PLANS } from "@/lib/plans";
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

  if (!plan.chatAssistant) {
    return {
      ok: false,
      code: "plan",
      error: `Ask Euclid is on the Pro plan. You are on ${plan.name}.`,
    };
  }
  if (ctx.workspace.chat_credits_used >= plan.chatCredits) {
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
  await db
    .from("workspaces")
    .update({ chat_credits_used: ctx.workspace.chat_credits_used + cost })
    .eq("id", ctx.workspace.id);

  revalidatePath("/ask");

  return {
    ok: true,
    threadId: threadId as string,
    message: saved as ChatMessage,
    creditsLeft: Math.max(0, plan.chatCredits - (ctx.workspace.chat_credits_used + cost)),
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
