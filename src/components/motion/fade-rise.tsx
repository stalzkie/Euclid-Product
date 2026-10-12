"use client";

import { m } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { dur, ease, exitOf, rise } from "@/lib/motion/tokens";
import { hasHydrated } from "./hydrated";

/** The handful of tags anything in this app needs to fade in as. */
const TAGS = {
  div: m.div,
  span: m.span,
  li: m.li,
  tr: m.tr,
  p: m.p,
  section: m.section,
  article: m.article,
  header: m.header,
} as const;

export type FadeRiseTag = keyof typeof TAGS;

/**
 * The default entrance: a fade with a 4px rise.
 *
 * The exit is opacity only and shorter, because an element on its way out does
 * not need to explain where it went.
 *
 * On mount it animates only if the app has already hydrated — content the
 * server rendered appears in its final state rather than flashing in. Pass
 * `mountAnimation` to override that, which the first-view animations the spec
 * asks for do.
 */
export function FadeRise({
  children,
  as = "div",
  distance = "sm",
  delay = 0,
  mountAnimation,
  className,
  style,
  layout,
  ...aria
}: {
  children: ReactNode;
  as?: FadeRiseTag;
  /** 4px by default, 8px where the spec asks for more presence. */
  distance?: "sm" | "md";
  delay?: number;
  mountAnimation?: boolean;
  className?: string;
  style?: CSSProperties;
  layout?: boolean;
  /* Passed straight through: a wrapper that swallows them would make the
     thing it wraps unreachable. */
  id?: string;
  role?: string;
  "aria-label"?: string;
  "aria-live"?: "off" | "polite" | "assertive";
  "aria-busy"?: boolean;
}) {
  const Tag = TAGS[as];
  const animateOnMount = mountAnimation ?? hasHydrated();

  return (
    <Tag
      {...aria}
      className={className}
      style={style}
      layout={layout}
      initial={animateOnMount ? { opacity: 0, y: rise[distance] } : false}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: exitOf(dur.base) }}
      transition={{ duration: dur.base, ease: ease.out, delay }}
    >
      {children}
    </Tag>
  );
}
