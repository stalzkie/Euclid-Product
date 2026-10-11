"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { AiLabel, Banner, Button, Card, EmptyState, cx } from "@/components/ui";
import { Spinner } from "@/components/controls";
import { dismissDuplicate, mergePost, type MergeGroup } from "./actions";

/**
 * The merge queue. Each group is one survivor plus its likely duplicates;
 * merging combines the votes and keeps every comment.
 */
export function MergeQueue({
  groups,
  boardName,
}: {
  groups: MergeGroup[];
  boardName: string;
}) {
  const router = useRouter();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const key = (source: string, target: string) => `${source}:${target}`;

  const run = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    id: string,
    message: string,
  ) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        setDone((prev) => new Set(prev).add(id));
        setToast(message);
        router.refresh();
      } else {
        setToast(res.error ?? "Could not merge");
      }
      setTimeout(() => setToast(null), 3500);
    });

  const total = groups.reduce((a, g) => a + g.members.length, 0);

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] font-semibold tracking-[-0.015em]">Merge queue</h1>
          <p className="text-[14px] text-ink-2">
            {total} likely duplicate{total === 1 ? "" : "s"} on {boardName}, in{" "}
            {groups.length} group{groups.length === 1 ? "" : "s"}. Merging keeps every
            vote and comment.
          </p>
        </div>
        <Link
          href="/feedback"
          className="flex h-9 items-center gap-[6px] rounded-control border border-line-strong px-[14px] text-[13.5px] font-medium text-ink no-underline hover:bg-subtle"
        >
          Back to inbox
        </Link>
      </header>

      {toast && (
        <Banner tone="ok" icon="check">
          {toast}
        </Banner>
      )}

      {groups.length === 0 ? (
        <Card>
          <EmptyState
            icon="merge"
            title="Nothing to merge"
            body="Euclid compares every new post against the board. When two say the same thing, the pair shows up here."
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
        groups.map((group) => (
          <Card key={group.targetId} className="flex flex-col gap-3 p-[18px]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <AiLabel>Likely duplicates</AiLabel>
                <Link
                  href={`/posts/${group.targetNumber}`}
                  className="text-[16px] font-semibold text-ink no-underline hover:underline"
                >
                  #{group.targetNumber} {group.targetTitle}
                </Link>
                <p className="text-[12.5px] text-ink-3">
                  Keeps {group.targetVotes} votes today · {group.combinedVotes} if you
                  merge all {group.members.length}
                </p>
              </div>
              <Button
                variant="primary"
                icon="merge"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    for (const m of group.members) {
                      if (done.has(key(m.id, group.targetId))) continue;
                      await mergePost(m.id, group.targetId);
                    }
                    setDone((prev) => {
                      const next = new Set(prev);
                      group.members.forEach((m) => next.add(key(m.id, group.targetId)));
                      return next;
                    });
                    setToast(
                      `Merged ${group.members.length} posts · ${group.combinedVotes} votes combined`,
                    );
                    router.refresh();
                    setTimeout(() => setToast(null), 3500);
                  })
                }
              >
                Merge all
              </Button>
            </div>

            <div className="flex flex-col divide-y divide-hairline">
              {group.members.map((m) => {
                const id = key(m.id, group.targetId);
                const settled = done.has(id);
                return (
                  <div key={m.id} className="flex flex-wrap items-center gap-3 py-[10px]">
                    <span
                      className={cx(
                        "tnum w-12 shrink-0 rounded-chip px-2 py-[3px] text-center text-[12px] font-semibold",
                        m.similarity >= 0.9
                          ? "bg-ai-wash text-ai-deep"
                          : "bg-muted text-ink-2",
                      )}
                    >
                      {Math.round(m.similarity * 100)}%
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <Link
                        href={`/posts/${m.number}`}
                        className="truncate text-[13.5px] font-medium text-ink no-underline hover:underline"
                      >
                        #{m.number} {m.title}
                      </Link>
                      <span className="text-[12px] text-ink-3">{m.votes} votes</span>
                    </span>
                    {settled ? (
                      <span className="flex items-center gap-[6px] text-[12.5px] font-medium text-ok">
                        <Icon name="check" size={13} strokeWidth={2.4} />
                        Merged
                      </span>
                    ) : (
                      <span className="flex gap-2">
                        <Button
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => mergePost(m.id, group.targetId),
                              id,
                              `Merged #${m.number} · ${m.votes} votes combined`,
                            )
                          }
                        >
                          Merge
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => dismissDuplicate(m.id, group.targetId),
                              id,
                              "Kept separate",
                            )
                          }
                        >
                          Keep separate
                        </Button>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {pending && (
              <span className="flex items-center gap-2 text-[12.5px] text-ink-3">
                <Spinner /> Working…
              </span>
            )}
          </Card>
        ))
      )}
    </>
  );
}
