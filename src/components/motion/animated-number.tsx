"use client";

import { AnimatePresence, m } from "motion/react";
import { useState } from "react";
import { spring } from "@/lib/motion/tokens";
import { rollDigits } from "@/lib/motion/digits";
import { cx } from "../ui";

/**
 * A count that rolls when it changes: digits that moved slide out upwards and
 * in from below, downwards when the value fell.
 *
 * The cells are a fixed character width and the widest value seen is held, so
 * a vote count going from 9 to 10 never nudges the title beside it. Screen
 * readers get the final value as text immediately — they should not have to
 * wait out an animation, and they should never hear a half-rolled number.
 *
 * The maths lives in `lib/motion/digits`, which is where its tests are.
 */
export function AnimatedNumber({
  value,
  format,
  minWidth = 0,
  className,
  live = false,
}: {
  value: number;
  /** Defaults to plain digits. Pass a formatter for grouped thousands. */
  format?: (value: number) => string;
  /** Cells to reserve even when the value is shorter. */
  minWidth?: number;
  className?: string;
  /** Announce changes as they happen. For counts the reader caused, not feeds. */
  live?: boolean;
}) {
  const text = format ? format(value) : String(value);

  // Derived from the props rather than kept in a ref: what the cells show is
  // rendering state, and the widest value ever seen has to survive a render
  // that did not change anything.
  const [seen, setSeen] = useState(() => ({
    previous: value,
    current: value,
    widest: Math.max(minWidth, text.length),
  }));

  let state = seen;
  if (seen.current !== value) {
    state = {
      previous: seen.current,
      current: value,
      widest: Math.max(seen.widest, minWidth, text.length),
    };
    setSeen(state);
  }

  // Not memoised: it is a few character comparisons, and the cell keys come
  // from the place values, so recomputing cannot restart a roll in flight.
  const roll = rollDigits(state.previous, state.current, {
    format,
    minWidth: state.widest,
  });

  return (
    <span className={cx("tnum inline-flex items-baseline", className)}>
      <span className="sr-only" aria-live={live ? "polite" : undefined}>
        {text}
      </span>
      <span aria-hidden="true" className="inline-flex">
        {roll.slots.map((slot) => (
          <span
            key={slot.key}
            className="relative inline-block overflow-hidden text-right"
            style={{ width: "1ch" }}
          >
            {/* Sizes the cell and keeps it on the text baseline. */}
            <span className="invisible">0</span>
            <AnimatePresence initial={false}>
              <m.span
                key={slot.char === "" ? "blank" : slot.char}
                className="absolute inset-0 text-right"
                initial={
                  slot.direction === "none"
                    ? false
                    : { y: slot.direction === "up" ? "100%" : "-100%" }
                }
                animate={{ y: "0%" }}
                exit={{ y: slot.direction === "up" ? "-100%" : "100%" }}
                transition={spring.snappy}
              >
                {slot.char}
              </m.span>
            </AnimatePresence>
          </span>
        ))}
      </span>
    </span>
  );
}
