"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AnimatePresence } from "motion/react";
import { Icon } from "@/components/icons";
import { Button, Card, EmptyState, cx } from "@/components/ui";
import { Spinner } from "@/components/controls";
import { CollapseOut, IconSwap, Stagger } from "@/components/motion";
import { useToast } from "@/components/motion";
import { approvePost, rejectPost, type HeldPost } from "./actions";

/**
 * The approval queue. A post lands here when the board requires approval or
 * when it scored high enough on spam to be worth a human glance.
 *
 * The whole post is shown rather than a title and a link, because the title is
 * the one part of a spam post designed to look legitimate — and because the
 * post is not on the board yet, so there is nowhere to click through to.
 */
export function HeldQueue({
  posts,
  boardName,
}: {
  posts: HeldPost[];
  boardName: string;
}) {
  const router = useRouter();
  const [settled, setSettled] = useState<Map<string, "approved" | "rejected">>(new Map());
  const toast = useToast();
  const [pending, start] = useTransition();

  const run = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    id: string,
    outcome: "approved" | "rejected",
    message: string,
  ) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        setSettled((prev) => new Map(prev).set(id, outcome));
        toast(message, { tone: "ok" });
        router.refresh();
      } else {
        toast(res.error ?? "Could not do that", { tone: "bad" });
      }
    });

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] font-semibold tracking-[-0.015em]">
            Held for approval
          </h1>
          <p className="text-[14px] text-ink-2">
            {posts.length} post{posts.length === 1 ? "" : "s"} waiting on {boardName}.
            Nobody can see these yet — not the board, not search, not Ask Euclid.
          </p>
        </div>
        <Link
          href="/feedback"
          className="eu-press flex h-9 items-center gap-[6px] rounded-control border border-line-strong px-[14px] text-[13.5px] font-medium text-ink no-underline hover:bg-subtle"
        >
          Back to inbox
        </Link>
      </header>

      {posts.length === 0 ? (
        <Card>
          <EmptyState
            icon="check"
            title="Nothing waiting"
            body="Posts show up here when the board requires approval, or when one looks enough like spam to be worth a glance. Approving puts a post on the board and tells your integrations about it."
            action={
              <Link
                href="/feedback"
                className="flex h-9 items-center rounded-control border border-line-strong px-[14px] text-[13.5px] font-medium text-ink no-underline hover:bg-subtle"
              >
                Back to inbox
              </Link>
            }
          />
        </Card>
      ) : (
        <Stagger className="flex flex-col gap-4">
          <AnimatePresence initial={false}>
            {posts.map((post) => {
              const outcome = settled.get(post.id);
              return (
                <CollapseOut key={post.id}>
                  <Card className="flex flex-col gap-3 p-[18px]">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-2">
                          {post.spamScore >= 0.8 && (
                            <span className="rounded-chip bg-[#FEF0F0] px-2 py-[3px] text-[12px] font-semibold text-bad">
                              Spam {Math.round(post.spamScore * 100)}%
                            </span>
                          )}
                          {post.injectionFlagged && (
                            <span className="rounded-chip bg-[#FFF6E5] px-2 py-[3px] text-[12px] font-semibold text-[#92510A]">
                              Prompt injection
                            </span>
                          )}
                          {post.category && (
                            <span className="rounded-chip bg-muted px-2 py-[3px] text-[12px] text-ink-2">
                              {post.category}
                            </span>
                          )}
                        </span>
                        <h2 className="text-[16px] font-semibold text-ink">
                          #{post.number} {post.title}
                        </h2>
                        <p className="text-[12.5px] text-ink-3">
                          {post.authorEmail ?? "anonymous"} ·{" "}
                          {new Date(post.createdAt).toLocaleDateString()}
                        </p>
                      </div>

                      {outcome ? (
                        <span
                          className={cx(
                            "eu-crossfade flex items-center gap-[6px] text-[12.5px] font-medium",
                            outcome === "approved" ? "text-ok" : "text-ink-3",
                          )}
                        >
                          <IconSwap swapKey={outcome} size={13}>
                            <Icon
                              name={outcome === "approved" ? "check" : "trash"}
                              size={13}
                              strokeWidth={2.4}
                            />
                          </IconSwap>
                          {outcome === "approved" ? "Approved" : "Rejected"}
                        </span>
                      ) : (
                        <span className="flex gap-2">
                          <Button
                            variant="primary"
                            icon="check"
                            disabled={pending}
                            onClick={() =>
                              run(
                                () => approvePost(post.id),
                                post.id,
                                "approved",
                                `#${post.number} is on the board`,
                              )
                            }
                          >
                            Approve
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={pending}
                            onClick={() =>
                              run(
                                () => rejectPost(post.id),
                                post.id,
                                "rejected",
                                "Rejected and removed",
                              )
                            }
                          >
                            Reject
                          </Button>
                        </span>
                      )}
                    </div>

                    {post.body && (
                      <p className="whitespace-pre-wrap text-[13.5px] leading-[1.55] text-ink-body">
                        {post.body}
                      </p>
                    )}
                  </Card>
                </CollapseOut>
              );
            })}
          </AnimatePresence>
          {pending && (
            <span className="flex items-center gap-2 text-[12.5px] text-ink-3">
              <Spinner /> Working…
            </span>
          )}
        </Stagger>
      )}
    </>
  );
}
