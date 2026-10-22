import { Shell } from "@/components/shell";
import { requireFounder } from "@/server/context";
import { supabaseServer } from "@/lib/supabase/server";
import { PLANS } from "@/lib/plans";
import { hasAnthropic } from "@/lib/ai/client";
import { AskEuclidView } from "./ask-view";
import { listThreads } from "./actions";
import type { ChatMessage } from "@/lib/types";
import { TrackScreen } from "@/components/track";

/** 10 · Ask Euclid. */
/**
 * Ask Euclid runs a tool loop against a model; its action posts back to
 * this route.
 */
export const maxDuration = 60;

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string; q?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requireFounder();
  const db = await supabaseServer();
  const plan = PLANS[ctx.workspace.plan];

  const threads = await listThreads();
  const threadId = params.thread ?? null;

  let messages: ChatMessage[] = [];
  if (threadId) {
    const { data } = await db
      .from("chat_messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at");
    messages = (data ?? []) as ChatMessage[];
  }

  return (
    <Shell active="none" ctx={ctx} wide>
      <TrackScreen name="screen.ask" />
      <AskEuclidView
        threadId={threadId}
        threads={threads}
        initialMessages={messages}
        prefill={params.q ?? ""}
        boardName={ctx.board.name}
        founderInitials={ctx.initials}
        creditsLeft={Math.max(0, plan.chatCredits - ctx.workspace.chat_credits_used)}
        creditLimit={plan.chatCredits}
        planName={plan.name}
        chatEnabled={plan.chatAssistant}
        aiReady={hasAnthropic()}
      />
    </Shell>
  );
}
