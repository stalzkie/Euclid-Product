"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Icon } from "./icons";
import { SectionTitle, cx } from "./ui";
import type { SetupStep } from "@/lib/setup";

/**
 * What is left to set up, on the dashboard home.
 *
 * Every row links somewhere rather than explaining how — the screens already
 * explain themselves, and a checklist that teaches as well as tracks becomes
 * a second set of docs to keep true.
 *
 * Dismissal is optimistic: the card goes immediately and the write follows.
 * The worst case is a card that comes back on the next load, which is a far
 * better failure than a button that appears to do nothing while a round trip
 * happens.
 */
export function SetupChecklist({
  steps,
  onDismiss,
}: {
  steps: SetupStep[];
  onDismiss: () => Promise<{ ok: boolean }>;
}) {
  const [hidden, setHidden] = useState(false);
  const [, startDismiss] = useTransition();

  if (hidden) return null;

  const done = steps.filter((s) => s.done).length;
  // The first thing not yet done. Highlighted rather than the whole list,
  // because six equal rows is a wall and one obvious next thing is a nudge.
  const nextId = steps.find((s) => !s.done)?.id;

  return (
    <section
      aria-labelledby="setup-title"
      className="flex flex-col gap-4 rounded-card border border-line bg-canvas p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <SectionTitle id="setup-title">Finish setting up</SectionTitle>
          <p className="text-[13px] text-ink-2">
            {done} of {steps.length} done.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setHidden(true);
            startDismiss(async () => {
              await onDismiss();
            });
          }}
          className="rounded-control px-2 py-1 text-[12.5px] font-medium text-ink-3 hover:bg-subtle hover:text-ink"
        >
          Dismiss
        </button>
      </div>

      {/* One bar rather than six ticks: progress is the thing being shown. */}
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-ok-bright transition-[width] duration-500"
          style={{ width: `${(done / steps.length) * 100}%` }}
        />
      </div>

      <ol className="flex flex-col">
        {steps.map((step) => (
          <li key={step.id}>
            <Link
              href={step.href}
              className={cx(
                "flex items-start gap-3 rounded-control px-2 py-[10px] no-underline hover:bg-subtle",
                step.done && "opacity-60",
              )}
            >
              <span
                className={cx(
                  "mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border",
                  step.done
                    ? "border-ok-line bg-ok-bright text-white"
                    : step.id === nextId
                      ? "border-ink-3 bg-canvas"
                      : "border-line bg-canvas",
                )}
              >
                {step.done && <Icon name="check" size={11} strokeWidth={2.6} />}
              </span>
              <span className="flex min-w-0 flex-col gap-[2px]">
                <span
                  className={cx(
                    "text-[13px] text-ink",
                    step.done ? "line-through" : step.id === nextId && "font-medium",
                  )}
                >
                  {step.title}
                </span>
                {!step.done && (
                  <span className="text-[12.5px] leading-[1.45] text-ink-3">{step.detail}</span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
