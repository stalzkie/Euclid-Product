"use client";

import { useState, useTransition } from "react";
import { ago } from "@/lib/format";
import { resolveError } from "./actions";

/**
 * One grouped fault.
 *
 * The count is the thing to read first: a fault seen four hundred times is a
 * different problem from one seen twice, and the message is usually the same
 * either way.
 */
export function ErrorRow({
  error,
}: {
  error: {
    fingerprint: string;
    kind: string;
    message: string;
    route: string | null;
    count: number;
    lastSeen: string;
  };
}) {
  const [gone, setGone] = useState(false);
  const [, start] = useTransition();

  if (gone) return null;

  return (
    <li className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-0">
      <span className="mt-[2px] min-w-[2.5rem] rounded-chip bg-bad-wash px-2 py-[2px] text-center font-mono text-[11.5px] text-bad">
        {error.count}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="truncate text-[13px] text-ink" title={error.message}>
          <span className="font-medium">{error.kind}</span> — {error.message}
        </span>
        <span className="text-[12px] text-ink-3">
          {error.route ?? "no route"} · last {ago(error.lastSeen)}
        </span>
      </span>
      <button
        type="button"
        onClick={() => {
          // Optimistic: it reopens by itself if the fault recurs, so being
          // wrong here costs nothing.
          setGone(true);
          start(async () => {
            await resolveError(error.fingerprint);
          });
        }}
        className="shrink-0 rounded-control px-2 py-1 text-[12.5px] font-medium text-ink-3 hover:bg-subtle hover:text-ink"
      >
        Resolve
      </button>
    </li>
  );
}
