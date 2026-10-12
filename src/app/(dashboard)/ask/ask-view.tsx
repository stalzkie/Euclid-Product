"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { m } from "motion/react";
import { Icon } from "@/components/icons";
import {
  AiLabel,
  Banner,
  Button,
  ButtonLink,
  Card,
  Meter,
  SectionTitle,
  Textarea,
  cx,
} from "@/components/ui";
import { Spinner } from "@/components/controls";
import {
  Collapse,
  FadeRise,
  IconSwap,
  useReduceMotion,
} from "@/components/motion";
import { dur, stagger } from "@/lib/motion/tokens";
import { ago } from "@/lib/format";
import type { ChatMessage } from "@/lib/types";
import { ask } from "./actions";

const SUGGESTIONS = [
  "What do paying users want most this month?",
  "Which requests are quick wins?",
  "What are Free users asking for?",
  "Summarise the bug reports this week",
];

/**
 * 10 · Ask Euclid. The model answers by calling read-only tools, and the
 * answer shows which tools it used and which posts it rests on.
 */
export function AskEuclidView({
  threadId,
  threads,
  initialMessages,
  prefill,
  boardName,
  founderInitials,
  creditsLeft,
  creditLimit,
  planName,
  chatEnabled,
  aiReady,
}: {
  threadId: string | null;
  threads: { id: string; title: string; created_at: string }[];
  initialMessages: ChatMessage[];
  prefill: string;
  boardName: string;
  founderInitials: string;
  creditsLeft: number;
  creditLimit: number;
  planName: string;
  chatEnabled: boolean;
  aiReady: boolean;
}) {
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState(prefill);
  const [thread, setThread] = useState(threadId);
  const [left, setLeft] = useState(creditsLeft);
  const [error, setError] = useState<string | null>(null);
  const [openSteps, setOpenSteps] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  // Ids for the optimistic message shown while the answer is being worked
  // out. A counter rather than a clock: two questions sent in the same
  // millisecond would collide, and reading the clock mid-render is not
  // something a component may do.
  const optimisticId = useRef(0);

  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "end",
    });
  }, [messages.length, pending, reduceMotion]);

  const send = (question: string) => {
    const text = question.trim();
    if (!text) return;

    // Show the question immediately; the answer arrives when the tools finish.
    const optimistic: ChatMessage = {
      id: `pending-${(optimisticId.current += 1)}`,
      thread_id: thread ?? "",
      role: "user",
      content: text,
      steps: [],
      citations: [],
      follow_ups: [],
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft("");
    setError(null);

    start(async () => {
      const res = await ask({ threadId: thread, question: text });
      if (res.ok) {
        setThread(res.threadId);
        setMessages((prev) => [...prev, res.message]);
        setLeft(res.creditsLeft);
        router.replace(`/ask?thread=${res.threadId}`);
      } else {
        setError(res.error);
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setDraft(text);
      }
    });
  };

  const latest = [...messages].reverse().find((m) => m.role === "assistant");
  const sources = latest?.citations ?? [];
  const creditsUsed = creditLimit - left;

  return (
    <div className="flex flex-wrap items-start gap-6">
      <main className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-[-0.015em]">
              <Icon name="sparkle" size={19} strokeWidth={1.9} className="text-ai" />
              {messages[0]?.content.slice(0, 60) ?? "Ask Euclid"}
            </h1>
            <span className="text-[13px] text-ink-2">
              Reading {boardName} · {creditsUsed} credit{creditsUsed === 1 ? "" : "s"} this
              session
            </span>
          </div>
          {thread && (
            <ButtonLink href="/ask" icon="plus">
              New question
            </ButtonLink>
          )}
        </header>

        {!chatEnabled && (
          <Banner tone="state" icon="info">
            Ask Euclid is on the Pro plan — you are on {planName}.{" "}
            <Link href="/billing" className="font-medium underline">
              See plans
            </Link>
          </Banner>
        )}

        {chatEnabled && !aiReady && (
          <Banner tone="warn" icon="warn">
            No Anthropic key is configured, so Ask Euclid is switched off. Set{" "}
            <code className="font-mono text-[12.5px]">ANTHROPIC_API_KEY</code> to turn it on.
          </Banner>
        )}

        {error && (
          <Banner tone="bad" icon="warn">
            {error}
          </Banner>
        )}

        {/* Transcript */}
        <div className="flex flex-col gap-6">
          {messages.length === 0 && (
            <Card className="flex flex-col gap-4 p-7">
              <span className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-ai-wash text-ai">
                <Icon name="sparkle" size={20} strokeWidth={1.8} />
              </span>
              <div className="flex flex-col gap-2">
                <p className="text-[17px] font-semibold">
                  Ask about your feedback in plain language
                </p>
                <p className="max-w-[560px] text-[13.5px] leading-[1.55] text-ink-2">
                  Euclid answers by querying your board — counting votes, reading
                  comments, comparing periods — and cites the posts it used, so you can
                  check it. It reads only. It never changes a post or emails anyone.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={!chatEnabled || !aiReady}
                    onClick={() => send(s)}
                    className="eu-press rounded-control border border-line bg-canvas px-3 py-2 text-left text-[13px] text-ink-body hover:bg-subtle disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </Card>
          )}

          {messages.map((m) =>
            m.role === "user" ? (
              <FadeRise key={m.id} className="flex items-start justify-end gap-3">
                <p className="max-w-[560px] rounded-[14px] rounded-tr-[4px] bg-muted px-4 py-3 text-[14px] leading-[1.55]">
                  {m.content}
                </p>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ai-tint text-[10.5px] font-semibold text-ai-deep">
                  {founderInitials}
                </span>
              </FadeRise>
            ) : (
              <FadeRise key={m.id} className="flex flex-col gap-3">
                <AiLabel>Euclid</AiLabel>

                {m.steps.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      aria-expanded={openSteps.has(m.id)}
                      onClick={() =>
                        setOpenSteps((prev) => {
                          const next = new Set(prev);
                          if (next.has(m.id)) next.delete(m.id);
                          else next.add(m.id);
                          return next;
                        })
                      }
                      className="eu-press flex w-fit items-center gap-[6px] rounded-control border border-line bg-subtle px-[10px] py-[6px] text-[12.5px] font-medium text-ink-2 hover:bg-muted"
                    >
                      {/* The tools have finished by the time the pill exists,
                          so it arrives as a check rather than a spinner. */}
                      <IconSwap swapKey="done" size={13}>
                        <Icon name="check" size={13} strokeWidth={2.4} className="text-ok" />
                      </IconSwap>
                      <Icon
                        name={openSteps.has(m.id) ? "chevronDown" : "chevronRight"}
                        size={13}
                        strokeWidth={2}
                      />
                      Read {m.citations.length} source
                      {m.citations.length === 1 ? "" : "s"} in {m.steps.length} step
                      {m.steps.length === 1 ? "" : "s"}
                    </button>
                    <Collapse open={openSteps.has(m.id)}>
                      <ol className="flex flex-col gap-1 rounded-control border border-line bg-subtle px-4 py-3 font-mono text-[12px] text-ink-2">
                        {m.steps.map((s, i) => (
                          <FadeRise as="li" key={`${s.tool}-${i}`} mountAnimation
                            delay={Math.min(i, stagger.max - 1) * stagger.step}>
                            {i + 1}. {s.tool}({s.detail})
                          </FadeRise>
                        ))}
                      </ol>
                    </Collapse>
                  </div>
                )}

                <div className="flex max-w-[680px] flex-col gap-3 text-[14px] leading-[1.6] text-ink-body">
                  {renderAnswer(m.content, m.id)}
                </div>

                {m.follow_ups.length > 0 && (
                  <FadeRise
                    as="section"
                    distance="md"
                    // After the paragraphs have finished arriving, so the
                    // layout does not shift while the answer is being read.
                    delay={stagger.max * stagger.step}
                    aria-label="What next"
                    className="flex flex-col gap-2 rounded-[14px] border border-ai-line bg-ai-wash p-4"
                  >
                    <p className="text-[12.5px] font-semibold text-ai-deep">
                      What should I do next?
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {m.follow_ups.map((f) => (
                        <button
                          key={f}
                          type="button"
                          disabled={pending || !chatEnabled}
                          onClick={() => send(f)}
                          className="eu-press rounded-control border border-line bg-canvas px-3 py-2 text-left text-[13px] text-ink-body hover:bg-subtle disabled:opacity-50"
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </FadeRise>
                )}
              </FadeRise>
            ),
          )}

          {pending && (
            <FadeRise className="flex items-center gap-2 text-[13px] text-ink-3" role="status">
              <Spinner /> Euclid is querying your board…
            </FadeRise>
          )}
          <div ref={endRef} />
        </div>

        {/* Composer */}
        <Card className="flex flex-col gap-3 p-4">
          <label className="flex flex-col gap-[6px]">
            <span className="sr-only">Message Euclid</span>
            <Textarea
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(draft);
              }}
              placeholder="Ask about your feedback, or mention a post by its number"
              disabled={!chatEnabled || !aiReady}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-chip bg-muted px-2 py-[3px] text-[12px] text-ink-2">
              {boardName}
            </span>
            <span className="rounded-chip bg-muted px-2 py-[3px] text-[12px] text-ink-2">
              Last 30 days
            </span>
            <span className="flex-1" />
            <span className="text-[12px] text-ink-3">{left} credits left</span>
            <Button
              variant="ai"
              icon="send"
              disabled={pending || !draft.trim() || !chatEnabled || !aiReady || left === 0}
              onClick={() => send(draft)}
            >
              {pending ? <Spinner /> : null}
              Send
            </Button>
          </div>
          <p className="text-[11.5px] leading-[1.45] text-ink-3">
            Euclid reads your feedback only. It never changes a post or emails anyone
            without you doing it.
          </p>
        </Card>
      </main>

      {/* Right rail */}
      <aside aria-label="Chat details" className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
        <Card className="flex flex-col gap-3 p-[18px]">
          <SectionTitle>Details</SectionTitle>
          <dl className="grid grid-cols-[72px_1fr] gap-y-[10px] text-[13px]">
            <dt className="text-ink-3">Scope</dt>
            <dd>{boardName} · 30 days</dd>
            <dt className="text-ink-3">Messages</dt>
            <dd>{messages.length}</dd>
            {messages[0] && (
              <>
                <dt className="text-ink-3">Started</dt>
                <dd>{ago(messages[0].created_at)}</dd>
              </>
            )}
          </dl>
          <div className="flex flex-col gap-2 border-t border-hairline pt-3">
            <div className="flex justify-between text-[12px]">
              <span className="text-ink-2">Credits used</span>
              <span className="tnum">{creditsUsed}</span>
            </div>
            <Meter value={creditsUsed} max={creditLimit || 1} />
            <span className="text-[11.5px] text-ink-3">
              {left} of {creditLimit} left this month
            </span>
          </div>
        </Card>

        {sources.length > 0 && (
          <Card className="flex flex-col gap-2 p-[18px]">
            <SectionTitle>Sources cited</SectionTitle>
            {sources.map((s) => (
              <Link
                key={s.number}
                href={`/posts/${s.number}`}
                className="flex items-center gap-2 rounded-control px-2 py-[7px] text-ink no-underline hover:bg-subtle"
              >
                <span className="tnum w-10 shrink-0 text-[12px] font-semibold text-ink-3">
                  #{s.number}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px]">{s.title}</span>
                <span className="tnum text-[12px] text-ink-3">{s.votes}</span>
              </Link>
            ))}
          </Card>
        )}

        <Card className="flex flex-col gap-2 p-[18px]">
          <SectionTitle>Try asking</SectionTitle>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={pending || !chatEnabled || !aiReady}
              onClick={() => send(s)}
              className="rounded-control border border-line bg-canvas px-3 py-2 text-left text-[12.5px] text-ink-body hover:bg-subtle disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </Card>

        {threads.length > 0 && (
          <Card className="flex flex-col gap-1 p-[18px]">
            <SectionTitle>Earlier questions</SectionTitle>
            {threads.map((t) => (
              <Link
                key={t.id}
                href={`/ask?thread=${t.id}`}
                className={cx(
                  "flex flex-col gap-[2px] rounded-control px-2 py-[7px] no-underline hover:bg-subtle",
                  t.id === thread ? "bg-muted" : "",
                )}
              >
                <span className="truncate text-[13px] text-ink">{t.title}</span>
                <span className="text-[11.5px] text-ink-3">{ago(t.created_at)}</span>
              </Link>
            ))}
          </Card>
        )}
      </aside>
    </div>
  );
}

/**
 * Renders the answer, turning #142 references into links so the founder can
 * jump to the post an assertion rests on.
 *
 * Each paragraph fades from 0.35 to full as it lands, 30ms behind the one
 * before it and never more than eight deep, so a long answer still finishes
 * arriving inside a quarter of a second. No typewriter and no cursor: the text
 * is already written, and pretending otherwise would slow the reader down.
 */
function renderAnswer(content: string, messageId: string) {
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line, i) => {
      const bullet = /^\s*[-*]\s+/.test(line);
      const text = line.replace(/^\s*[-*]\s+/, "");
      const parts = text.split(/(#\d+)/g);
      const body = parts.map((part, j) =>
        /^#\d+$/.test(part) ? (
          <Link
            key={j}
            href={`/posts/${part.slice(1)}`}
            className="font-medium text-state no-underline hover:underline"
          >
            {part}
          </Link>
        ) : (
          <span key={j}>{renderBold(part)}</span>
        ),
      );

      const delay = Math.min(i, stagger.max - 1) * stagger.step;

      return (
        <Chunk key={`${messageId}-${i}`} delay={delay}>
          {bullet ? (
            <p className="flex gap-2 pl-1">
              <span aria-hidden="true" className="text-ink-3">
                ·
              </span>
              <span>{body}</span>
            </p>
          ) : (
            <p>{body}</p>
          )}
        </Chunk>
      );
    });
}

/**
 * One chunk of a streamed-feeling answer: it starts dim rather than invisible,
 * so nothing the founder is waiting for is ever actually hidden.
 */
function Chunk({ delay, children }: { delay: number; children: React.ReactNode }) {
  return (
    <m.div
      initial={{ opacity: 0.35 }}
      animate={{ opacity: 1 }}
      transition={{ duration: dur.fast, delay }}
    >
      {children}
    </m.div>
  );
}

/** Minimal **bold** support; the model writes plain prose otherwise. */
function renderBold(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((chunk, i) =>
    chunk.startsWith("**") && chunk.endsWith("**") ? (
      <strong key={i} className="font-semibold text-ink">
        {chunk.slice(2, -2)}
      </strong>
    ) : (
      chunk
    ),
  );
}
