"use client";

import { cubicBezier } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { dur, ease } from "@/lib/motion/tokens";
import { useReduceMotion } from "./reduce-motion";
import { cx } from "../ui";

const easeOut = cubicBezier(ease.out[0], ease.out[1], ease.out[2], ease.out[3]);

/**
 * Counts from zero to the value, once, the first time it comes into view.
 *
 * Deliberately once per session per metric: a KPI that counts up every time
 * the founder opens Home is a tic, not a signal. The marker is kept in
 * sessionStorage, which is unavailable in some privacy modes, so every access
 * is guarded and a failure simply means the count-up runs.
 *
 * It renders the final value first, so the server markup is correct and a
 * reader with no JavaScript sees the number rather than a zero.
 */
export function CountUp({
  value,
  format,
  metric,
  className,
}: {
  value: number;
  format?: (value: number) => string;
  /** Identifies this number across the session. Use something stable. */
  metric: string;
  className?: string;
}) {
  const reduce = useReduceMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState<number | null>(null);

  useEffect(() => {
    // No count-ups under reduced motion, and nothing to count to from zero.
    if (reduce || value <= 0) return;

    const key = `eu-countup:${metric}`;
    if (readSeen(key)) return;

    const el = ref.current;
    if (!el) return;

    let frame = 0;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        markSeen(key);

        const started = performance.now();
        const total = dur.data * 1000;

        const step = (now: number) => {
          const progress = Math.min(1, (now - started) / total);
          if (progress >= 1) {
            // Back to rendering the real value, so later changes are exact.
            setShown(null);
            return;
          }
          setShown(Math.round(easeOut(progress) * value));
          frame = requestAnimationFrame(step);
        };

        frame = requestAnimationFrame(step);
      },
      { threshold: 0.4 },
    );

    observer.observe(el);

    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [value, metric, reduce]);

  const display = shown ?? value;

  return (
    <span ref={ref} className={cx("tnum", className)}>
      {/* The destination is what gets announced, not each step on the way. */}
      <span className="sr-only">{format ? format(value) : value}</span>
      <span aria-hidden="true">{format ? format(display) : display}</span>
    </span>
  );
}

function readSeen(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function markSeen(key: string): void {
  try {
    window.sessionStorage.setItem(key, "1");
  } catch {
    // Private modes block this. Counting up again is a small price.
  }
}
