"use client";

import { AnimatePresence, m } from "motion/react";
import type { ReactNode } from "react";
import { dur, ease, exitOf } from "@/lib/motion/tokens";
import { cx } from "../ui";

/**
 * Swaps one icon for another in the same slot: copy becoming a tick, a spinner
 * becoming a check, "Publish" becoming "Published".
 *
 * The outgoing icon shrinks slightly as it fades and the incoming one grows
 * into place, which reads as a replacement rather than a flicker. The slot is
 * a fixed size so nothing beside it moves.
 */
export function IconSwap({
  swapKey,
  children,
  size = 14,
  className,
}: {
  /** Change this to swap. Usually the state the icon represents. */
  swapKey: string;
  children: ReactNode;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cx("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <AnimatePresence initial={false}>
        <m.span
          key={swapKey}
          className="absolute inset-0 grid place-items-center"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8, transition: exitOf(dur.fast) }}
          transition={{ duration: dur.fast, ease: ease.out }}
        >
          {children}
        </m.span>
      </AnimatePresence>
    </span>
  );
}
