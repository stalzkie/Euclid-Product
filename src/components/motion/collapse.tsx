"use client";

import { m } from "motion/react";
import { useState, type ReactNode } from "react";
import { dur, ease } from "@/lib/motion/tokens";

/**
 * Height 0 ↔ auto, for content that appears or disappears in the flow.
 *
 * Height is the one layout property the spec lets us animate, and only here,
 * so that every expanding section in the app behaves identically. The content
 * fades slightly after the height starts moving — opening reads as the box
 * making room and then filling it, rather than text sliding around.
 *
 * `overflow: hidden` is on only while something is moving; leaving it on would
 * clip focus rings and popovers inside an open section.
 */
export function Collapse({
  open,
  children,
  className,
  id,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const [moving, setMoving] = useState(false);

  return (
    <m.div
      id={id}
      className={className}
      // No mount animation: an open section renders open, including on the
      // server, so nothing expands in front of the reader on first paint.
      initial={false}
      animate={{ height: open ? "auto" : 0 }}
      transition={{ duration: dur.moderate, ease: ease.standard }}
      onAnimationStart={() => setMoving(true)}
      onAnimationComplete={() => setMoving(false)}
      style={{ overflow: moving || !open ? "hidden" : undefined }}
      aria-hidden={open ? undefined : true}
    >
      <m.div
        initial={false}
        animate={{ opacity: open ? 1 : 0 }}
        transition={{
          duration: dur.fast,
          ease: open ? ease.out : ease.in,
          // Behind the height on the way in, with it on the way out.
          delay: open ? dur.contentLag : 0,
        }}
      >
        {children}
      </m.div>
    </m.div>
  );
}

/**
 * The same collapse as an exit, for a row leaving a list — a merged duplicate,
 * a confirmed assumption, a post that no longer matches the filter. Put it
 * inside an `AnimatePresence` and give it a key.
 *
 * It never animates in: the row is already there, and only its departure needs
 * explaining.
 */
export function CollapseOut({
  children,
  className,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "li" | "tr";
}) {
  const Tag = as === "li" ? m.li : as === "tr" ? m.tr : m.div;

  return (
    <Tag
      className={className}
      initial={false}
      style={{ overflow: "hidden" }}
      exit={{
        height: 0,
        opacity: 0,
        transition: { duration: dur.moderate, ease: ease.standard },
      }}
    >
      {children}
    </Tag>
  );
}
