"use client";

import { useState, useTransition } from "react";
import { ago, longDate } from "@/lib/format";
import { resolveError } from "./actions";

/**
 * One grouped fault.
 *
 * The count is the thing to read first: a fault seen four hundred times is a
 * different problem from one seen twice, and the message is usually the same
 * either way. Resolving is optimistic because it reopens by itself if the
 * same fingerprint occurs again — `record_error` clears `resolved_at` on
 * conflict — so being wrong here costs nothing and a regression cannot hide
 * behind a tick.
 *
 * Its own markup rather than the table primitives from `parts.tsx`: this is
 * the console's only client component, and keeping it self-contained keeps
 * the rest of the furniture out of the browser bundle.
 */
export function ErrorRow({
  error,
}: {
  error: {
    fingerprint: string;
    kind: string;
    message: string;
    route: string | null;
    stack: string | null;
    count: number;
    firstSeen: string;
    lastSeen: string;
    resolvedAt: string | null;
  };
}) {
  const [resolved, setResolved] = useState(Boolean(error.resolvedAt));
  const [, start] = useTransition();

  return (
    <tr className="border-b border-hairline align-top last:border-0 hover:bg-subtle">
      <td className="tnum px-3 py-[7px] text-right">
        <span
          className={`rounded-chip px-1.5 py-[1px] font-mono text-[11.5px] ${
            resolved ? "bg-subtle text-ink-3" : "bg-bad-wash text-bad"
          }`}
        >
          {error.count}
        </span>
      </td>
      <td className="px-3 py-[7px]">
        <span className="flex flex-col gap-1">
          <span className="text-[12.5px] text-ink">
            <span className="font-medium">{error.kind}</span> — {error.message}
          </span>
          {error.stack && (
            <details>
              <summary className="cursor-pointer list-none text-[11.5px] text-ink-3 hover:text-ink">
                stack
              </summary>
              <pre className="mt-1 max-w-[680px] overflow-x-auto whitespace-pre-wrap rounded-control bg-subtle p-2 font-mono text-[11px] text-ink-2">
                {error.stack}
              </pre>
            </details>
          )}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-[7px] font-mono text-[11.5px] text-ink-2">
        {error.route ?? "no route"}
      </td>
      <td className="whitespace-nowrap px-3 py-[7px] text-[12.5px] text-ink-2" title={longDate(error.firstSeen)}>
        {ago(error.firstSeen)}
      </td>
      <td className="whitespace-nowrap px-3 py-[7px] text-[12.5px] text-ink-2" title={longDate(error.lastSeen)}>
        {ago(error.lastSeen)}
      </td>
      <td className="whitespace-nowrap px-3 py-[7px] text-right">
        {resolved ? (
          <span className="text-[11.5px] text-ink-3">resolved</span>
        ) : (
          <button
            type="button"
            onClick={() => {
              setResolved(true);
              start(async () => {
                await resolveError(error.fingerprint);
              });
            }}
            className="rounded-control px-2 py-1 text-[12px] font-medium text-ink-3 hover:bg-subtle hover:text-ink"
          >
            Resolve
          </button>
        )}
      </td>
    </tr>
  );
}
