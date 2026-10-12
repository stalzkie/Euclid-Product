"use client";

import { m } from "motion/react";
import { cx } from "./ui";
import { dur, ease } from "@/lib/motion/tokens";

/**
 * The install check's indicator: the one thing in Euclid that waits.
 *
 * While nothing has arrived, a ring expands out of a grey dot and fades — an
 * allowed loop, because the founder is genuinely waiting on something outside
 * the app and a static dot would not say so. The moment the first ping lands
 * the ring stops, the dot goes green and a tick draws itself in, which is the
 * one small piece of celebration the flow gets.
 */
export function InstallPing({ seen }: { seen: boolean }) {
  return (
    <span
      className={cx(
        "eu-crossfade relative flex h-7 w-7 items-center justify-center rounded-full",
        seen ? "bg-ok-bright text-white" : "bg-line text-ink-3",
      )}
    >
      {seen ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          {/*
            Drawn rather than faded in: the stroke unwinds from nothing, which
            is the one animation in the app that is allowed to feel like a
            small reward.
          */}
          <m.path
            d="m5 12 5 5 9-10"
            stroke="currentColor"
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: dur.slow, ease: ease.out }}
          />
        </svg>
      ) : (
        <>
          {/* The ring, which stops existing the moment the ping arrives. */}
          <span className="eu-ping-ring absolute inset-0 rounded-full border border-ink-3" />
          <span className="relative h-2 w-2 rounded-full bg-ink-3" />
        </>
      )}
    </span>
  );
}
